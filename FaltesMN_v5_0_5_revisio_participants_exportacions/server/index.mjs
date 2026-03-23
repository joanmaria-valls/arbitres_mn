import crypto from "node:crypto";
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { Store } from './lib/store.mjs';
import { sha256, makeToken, nowIso, requireAdminKey, requirePrincipalSession, requireActorSession, isTableRole } from './lib/auth.mjs';

const PORT = Number(process.env.PORT || 10000);
const store = new Store();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    now: nowIso(),
    schemaVersion: store.data.schemaVersion,
    competitions: Object.keys(store.data.competitions || {}).length,
    openCompetitions: Object.values(store.data.competitions || {}).filter((c) => c.status === 'open').length,
    actors: Object.keys(store.data.actors || {}).length,
    principalSessions: Object.keys(store._principalSessions || {}).length,
    actorSessions: Object.keys(store._actorSessions || {}).length,
  });
});

function httpError(res, err) {
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: err.message || 'Error' });
}

function ensureCompByCode(code) {
  const comp = Object.values(store.data.competitions).find(c => c.code === code);
  if (!comp) {
    const err = new Error('Competició no trobada');
    err.status = 404;
    throw err;
  }
  return comp;
}

function ensureCompById(id) {
  const comp = store.data.competitions[id];
  if (!comp) {
    const err = new Error('Competició no trobada');
    err.status = 404;
    throw err;
  }
  return comp;
}

function requireOpenCompetition(comp) {
  if (comp.status !== 'open') {
    const err = new Error('La competició està tancada');
    err.status = 409;
    throw err;
  }
}

function requirePrincipalActorForCompetition(req, competitionId) {
  const sess = requireActorSession(store, req);
  if (sess.competitionId !== competitionId) throw Object.assign(new Error('No autoritzat'), { status: 403 });
  if (sess.role !== 'principal') throw Object.assign(new Error('Només el perfil Principal pot accedir a aquesta zona'), { status: 403 });
  return sess;
}

function makeCompetitionCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

const PARTICIPANT_CATEGORIES = ['Infantil', 'Cadet', 'Junior', 'Promesa', 'Sènior', 'Veterà A', 'Veterà B', 'Veterà C', 'Veterà D'];
const PARTICIPANT_GENDERS = ['M', 'F', '-', ''];

function sanitizeParticipantName(raw) {
  return String(raw || '').replace(/[\r\n\t]+/g, ' ').slice(0, 30);
}

function onlyDigits(raw, maxDigits) {
  return String(raw || '').replace(/\D/g, '').slice(0, maxDigits);
}

function normalizeGrossTime(raw) {
  const digits = onlyDigits(raw, 8);
  if (digits.length !== 8) return '';
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}:${digits.slice(6, 8)}`;
}

function normalizeDeltaTime(raw) {
  const digits = onlyDigits(raw, 4);
  if (digits.length !== 4) return '';
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

function participantHasData(row) {
  return !!(row.noShow || row.fullName || row.gender || row.category || row.grossTime || row.penaltyTime || row.bonusTime);
}

function normalizeParticipantRow(bib, body, updatedBy = '') {
  return {
    bib,
    noShow: body.noShow === true,
    fullName: sanitizeParticipantName(body.fullName),
    gender: PARTICIPANT_GENDERS.includes(body.gender || '') ? (body.gender || '') : '',
    category: PARTICIPANT_CATEGORIES.includes(body.category || '') ? (body.category || '') : '',
    grossTime: normalizeGrossTime(body.grossTime),
    penaltyTime: normalizeDeltaTime(body.penaltyTime),
    bonusTime: normalizeDeltaTime(body.bonusTime),
    updatedAt: nowIso(),
    updatedBy,
  };
}

function buildPrincipalActorSession(comp, principal) {
  let actor = Object.values(store.data.actors).find(
    a => a.competitionId === comp.id && a.role === 'principal' && a.name === principal.name
  );

  if (!actor) {
    const actorId = crypto.randomUUID();
    actor = {
      id: actorId,
      competitionId: comp.id,
      name: principal.name,
      role: 'principal',
      joinedAt: nowIso(),
    };
    store.data.actors[actorId] = actor;
  }

  const actorToken = makeToken();
  store._actorSessions[actorToken] = { actorId: actor.id, competitionId: comp.id, role: 'principal', createdAt: nowIso(), updatedAt: nowIso() };

  store.data.status[comp.id] = store.data.status[comp.id] || {};
  store.data.status[comp.id][actor.id] = { lastSeenAt: nowIso(), pendingCount: 0 };
  store.markDirty();

  broadcast(comp.id, { type: 'actor_joined', actor, status: store.data.status[comp.id][actor.id] });

  return {
    competition: { id: comp.id, code: comp.code, name: comp.name, status: comp.status },
    actor: { id: actor.id, name: actor.name, role: actor.role },
    actorToken,
    joinToken: comp.joinTokens?.principal || ''
  };
}

// -------------------- PLATFORM ADMIN --------------------
app.post('/api/admin/principals', (req, res) => {
  try {
    requireAdminKey(req);
    const body = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
    const id = crypto.randomUUID();
    const principalKey = makeToken().slice(0, 24); // shorter, still strong
    store.data.principals[id] = {
      id,
      name: body.name,
      keyHash: sha256(principalKey),
      createdAt: nowIso(),
    };
    store.markDirty();
    store.logOperation('principal_created', { principalId: id, name: body.name });
    res.json({ ok: true, principal: { id, name: body.name }, principalKey });
  } catch (err) {
    httpError(res, err);
  }
});

app.post('/api/admin/principals/:id/revoke', (req, res) => {
  try {
    requireAdminKey(req);
    const p = store.data.principals[req.params.id];
    if (!p) throw Object.assign(new Error('Principal no trobat'), { status: 404 });
    p.revokedAt = nowIso();
    store.markDirty();
    store.logOperation('principal_revoked', { principalId: p.id, name: p.name });
    res.json({ ok: true });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- PRINCIPAL LOGIN --------------------
app.post('/api/principal/login', (req, res) => {
  try {
    const body = z.object({ principalKey: z.string().min(8) }).parse(req.body);
    const keyHash = sha256(body.principalKey);
    const principal = Object.values(store.data.principals).find(p => p.keyHash === keyHash && !p.revokedAt);
    if (!principal) throw Object.assign(new Error('Clau de principal incorrecta o revocada'), { status: 401 });
    const sessionToken = makeToken();
    store._principalSessions[sessionToken] = { principalId: principal.id, createdAt: nowIso(), updatedAt: nowIso() };
    store.markDirty();
    store.logOperation('principal_login', { principalId: principal.id, name: principal.name });
    res.json({ ok: true, sessionToken, principal: { id: principal.id, name: principal.name } });
  } catch (err) {
    httpError(res, err);
  }
});

app.get('/api/principal/session', (req, res) => {
  try {
    const sess = requirePrincipalSession(store, req);
    const principal = store.data.principals[sess.principalId];
    if (!principal || principal.revokedAt) throw Object.assign(new Error('Sessió de principal caducada o invàlida'), { status: 401 });
    res.json({ ok: true, principal: { id: principal.id, name: principal.name } });
  } catch (err) {
    httpError(res, err);
  }
});

// Create competition (by principal)
app.post('/api/competitions', (req, res) => {
  try {
    const sess = requirePrincipalSession(store, req);
    const body = z.object({ name: z.string().min(2).max(120) }).parse(req.body);
    const id = crypto.randomUUID();
    let code = makeCompetitionCode();
    // Ensure unique code
    while (Object.values(store.data.competitions).some(c => c.code === code)) {
      code = makeCompetitionCode();
    }
    const joinTokens = { principal: makeToken().slice(0, 20), referee: makeToken().slice(0, 20), table: makeToken().slice(0, 20) };
    store.data.competitions[id] = {
      id,
      code,
      name: body.name,
      status: 'open',
      createdAt: nowIso(),
      createdByPrincipalId: sess.principalId,
      joinTokens,
    };
    store.data.events[id] = [];
    store.data.status[id] = {};
    store.data.participants[id] = {};
    store.markDirty();
    store.logOperation('competition_created', { competitionId: id, code, name: body.name, principalId: sess.principalId });
    res.json({ ok: true, competition: store.data.competitions[id] });
  } catch (err) {
    httpError(res, err);
  }
});

app.post('/api/competitions/:id/close', (req, res) => {
  try {
    const sess = requirePrincipalSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (comp.createdByPrincipalId !== sess.principalId) {
      // Platform admin override could be added later
      throw Object.assign(new Error('No autoritzat per tancar aquesta competició'), { status: 403 });
    }
    comp.status = 'closed';
    comp.closedAt = nowIso();
    store.markDirty();
    store.logOperation('competition_closed', { competitionId: comp.id, code: comp.code, closedAt: comp.closedAt });
    broadcast(comp.id, { type: 'competition_closed', competitionId: comp.id, closedAt: comp.closedAt });
    res.json({ ok: true });
  } catch (err) {
    httpError(res, err);
  }
});


app.post('/api/competitions/:id/principal-enter', (req, res) => {
  try {
    const sess = requirePrincipalSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (comp.createdByPrincipalId !== sess.principalId) {
      throw Object.assign(new Error('No autoritzat per entrar com a principal en aquesta competició'), { status: 403 });
    }

    const principal = store.data.principals[sess.principalId];
    if (!principal) throw Object.assign(new Error('Principal no trobat'), { status: 404 });

    res.json({ ok: true, ...buildPrincipalActorSession(comp, principal) });
  } catch (err) {
    httpError(res, err);
  }
});

app.post('/api/principal/direct-enter', (req, res) => {
  try {
    const body = z.object({ principalKey: z.string().min(8), competitionId: z.string().uuid() }).parse(req.body);
    const keyHash = sha256(body.principalKey);
    const principal = Object.values(store.data.principals).find(p => p.keyHash === keyHash && !p.revokedAt);
    if (!principal) throw Object.assign(new Error('Clau de principal incorrecta o revocada'), { status: 401 });

    const comp = ensureCompById(body.competitionId);
    if (comp.createdByPrincipalId !== principal.id) {
      throw Object.assign(new Error('No autoritzat per entrar com a principal en aquesta competició'), { status: 403 });
    }

    res.json({ ok: true, ...buildPrincipalActorSession(comp, principal) });
  } catch (err) {
    httpError(res, err);
  }
});

app.get('/api/join-preview', (req, res) => {
  try {
    const code = String(req.query.code || '').trim().toUpperCase();
    const token = String(req.query.token || '').trim();
    if (!code || !token) throw Object.assign(new Error("Falten dades d'accés"), { status: 400 });
    const comp = ensureCompByCode(code);
    const principalJoinToken = comp.joinTokens?.principal || '';
    if (comp.joinTokens.referee !== token && comp.joinTokens.table !== token && principalJoinToken !== token) {
      throw Object.assign(new Error('Token d’entrada incorrecte'), { status: 401 });
    }
    const role = comp.joinTokens.table === token
      ? 'table'
      : principalJoinToken === token
        ? 'principal'
        : 'referee';
    res.json({ ok: true, competition: { code: comp.code, name: comp.name, status: comp.status }, role });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- JOIN (REFEREE/TABLE) --------------------
app.post('/api/join', (req, res) => {
  try {
    const body = z.object({ code: z.string().min(4), joinToken: z.string().min(6), name: z.string().min(2).max(80) }).parse(req.body);
    const comp = ensureCompByCode(body.code);
    const principalJoinToken = comp.joinTokens?.principal || '';
    if (comp.joinTokens.referee !== body.joinToken && comp.joinTokens.table !== body.joinToken && principalJoinToken !== body.joinToken) {
      throw Object.assign(new Error('Token d’entrada incorrecte'), { status: 401 });
    }
    const role = comp.joinTokens.table === body.joinToken
      ? 'table'
      : principalJoinToken === body.joinToken
        ? 'principal'
        : 'referee';
    const principal = role === 'principal' ? store.data.principals[comp.createdByPrincipalId] : null;
    const actorName = role === 'principal' ? (principal?.name || body.name) : body.name;

    const actorId = crypto.randomUUID();
    const actorToken = makeToken();
    store.data.actors[actorId] = {
      id: actorId,
      competitionId: comp.id,
      name: actorName,
      role,
      joinedAt: nowIso(),
    };
    store._actorSessions[actorToken] = { actorId, competitionId: comp.id, role, createdAt: nowIso(), updatedAt: nowIso() };
    store.markDirty();

    // Create initial status entry
    store.data.status[comp.id] = store.data.status[comp.id] || {};
    store.data.status[comp.id][actorId] = { lastSeenAt: nowIso(), pendingCount: 0 };
    store.markDirty();

    broadcast(comp.id, { type: 'actor_joined', actor: store.data.actors[actorId], status: store.data.status[comp.id][actorId] });
    store.logOperation('actor_joined', { competitionId: comp.id, actorId, actorName, role });

    res.json({
      ok: true,
      competition: { id: comp.id, code: comp.code, name: comp.name, status: comp.status },
      actor: { id: actorId, name: actorName, role },
      actorToken,
    });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- PUBLIC READ APIs (need actor session) --------------------
app.get('/api/competitions/:id/snapshot', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    if (sess.competitionId !== req.params.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });
    const comp = ensureCompById(req.params.id);
    const events = store.data.events[comp.id] || [];
    const checks = store.data.checks;
    const penaltyCompletions = store.data.penaltyCompletions;
    const alertAcks = store.data.alertAcks || {};
    const status = store.data.status[comp.id] || {};
    const participants = store.data.participants[comp.id] || {};
    res.json({ ok: true, competition: comp, events, checks, penaltyCompletions, alertAcks, status, actors: store.data.actors, participants });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- PARTICIPANTS (table/principal) --------------------
app.post('/api/competitions/:id/participants', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (sess.competitionId !== comp.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });
    if (!isTableRole(sess.role)) throw Object.assign(new Error('Només Taula/Principal pot modificar participants'), { status: 403 });
    requireOpenCompetition(comp);

    const body = z.object({
      bib: z.number().int().min(1).max(500),
      fullName: z.string().max(80).default(''),
      gender: z.enum(PARTICIPANT_GENDERS).default(''),
      category: z.enum(['', ...PARTICIPANT_CATEGORIES]).default(''),
      noShow: z.boolean().optional().default(false),
      grossTime: z.string().max(32).default(''),
      penaltyTime: z.string().max(16).default(''),
      bonusTime: z.string().max(16).default(''),
    }).parse(req.body);

    const actor = store.data.actors[sess.actorId];
    const participant = normalizeParticipantRow(body.bib, body, actor?.name || sess.actorId);

    store.data.participants[comp.id] = store.data.participants[comp.id] || {};
    if (participantHasData(participant)) {
      store.data.participants[comp.id][String(body.bib)] = participant;
    } else {
      delete store.data.participants[comp.id][String(body.bib)];
    }
    store.markDirty();
    store.logOperation('participant_upserted', { competitionId: comp.id, bib: body.bib, updatedBy: actor?.name || sess.actorId, noShow: participant.noShow === true });

    const payload = participantHasData(participant)
      ? participant
      : { bib: body.bib, noShow: false, fullName: '', gender: '', category: '', grossTime: '', penaltyTime: '', bonusTime: '', updatedAt: nowIso(), updatedBy: actor?.name || sess.actorId };

    broadcast(comp.id, { type: 'participant_updated', participant: payload });
    res.json({ ok: true, participant: payload });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- EVENTS --------------------
app.post('/api/competitions/:id/events', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (sess.competitionId !== comp.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });
    requireOpenCompetition(comp);

    const body = z.object({
      id: z.string().min(10),
      bib: z.number().int().positive().max(99999),
      faultCode: z.string().min(2).max(4),
      faultText: z.string().min(2).max(200),
      color: z.enum(['B', 'G', 'V', 'A']),
      category: z.enum(['T', 'R', 'C']),
      capturedAt: z.string().min(10),
      eventType: z.enum(['fault', 'assist', 'withdraw']).optional().default('fault'),
      assistTargetBib: z.number().int().positive().max(99999).optional(),
      assistDurationSeconds: z.number().int().min(0).max(24 * 3600).optional(),
    }).parse(req.body);

    store.data.events[comp.id] = store.data.events[comp.id] || [];

    // Idempotency
    if (store.data.events[comp.id].some(e => e.id === body.id)) {
      return res.json({ ok: true, duplicate: true });
    }

    const actor = store.data.actors[sess.actorId];
    if (!actor) throw Object.assign(new Error('Actor desconegut'), { status: 401 });

    const evt = {
      id: body.id,
      competitionId: comp.id,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      bib: body.bib,
      faultCode: body.faultCode,
      faultText: body.faultText,
      color: body.color,
      category: body.category,
      capturedAt: body.capturedAt,
      receivedAt: nowIso(),
      eventType: body.eventType || 'fault',
      assistTargetBib: body.assistTargetBib,
      assistDurationSeconds: body.assistDurationSeconds,
    };

    store.data.events[comp.id].push(evt);
    store.markDirty();
    store.logOperation('event_created', { competitionId: comp.id, eventId: evt.id, actorId: actor.id, actorRole: actor.role, bib: evt.bib, faultCode: evt.faultCode, color: evt.color, eventType: evt.eventType });

    broadcast(comp.id, { type: 'event_created', event: evt });
    res.json({ ok: true, event: evt });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- CHECKS (table/principal) --------------------
app.post('/api/competitions/:id/checks', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (sess.competitionId !== comp.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });
    if (!isTableRole(sess.role)) throw Object.assign(new Error('Només Taula/Principal pot marcar checks'), { status: 403 });

    const body = z.object({ eventId: z.string().min(10), checked: z.boolean() }).parse(req.body);
    const actor = store.data.actors[sess.actorId];

    store.data.checks[body.eventId] = {
      checked: body.checked,
      checkedAt: nowIso(),
      checkedBy: actor?.name || sess.actorId,
    };
    store.markDirty();
    store.logOperation('check_updated', { competitionId: comp.id, eventId: body.eventId, checked: body.checked, by: actor?.name || sess.actorId });

    broadcast(comp.id, { type: 'check_updated', eventId: body.eventId, check: store.data.checks[body.eventId] });
    res.json({ ok: true });
  } catch (err) {
    httpError(res, err);
  }
});


// -------------------- ALERT ACKS (table/principal) --------------------
app.post('/api/competitions/:id/alert-acks', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (sess.competitionId !== comp.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });
    if (!isTableRole(sess.role)) throw Object.assign(new Error('Només Taula/Principal pot marcar avisos com a vistos'), { status: 403 });

    const body = z.object({ eventId: z.string().min(10), acknowledged: z.boolean() }).parse(req.body);
    const actor = store.data.actors[sess.actorId];

    store.data.alertAcks[body.eventId] = {
      acknowledged: body.acknowledged,
      acknowledgedAt: nowIso(),
      acknowledgedBy: actor?.name || sess.actorId,
    };
    store.markDirty();
    store.logOperation('alert_ack_updated', { competitionId: comp.id, eventId: body.eventId, acknowledged: body.acknowledged, by: actor?.name || sess.actorId });

    broadcast(comp.id, { type: 'alert_ack_updated', eventId: body.eventId, alertAck: store.data.alertAcks[body.eventId] });
    res.json({ ok: true });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- PENALTY COMPLETIONS (table/principal) --------------------
app.post('/api/competitions/:id/penalty-completions', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (sess.competitionId !== comp.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });
    if (!isTableRole(sess.role)) throw Object.assign(new Error('Només Taula/Principal pot marcar penalització complerta'), { status: 403 });

    const body = z.object({ eventId: z.string().min(10), completed: z.boolean() }).parse(req.body);
    const actor = store.data.actors[sess.actorId];

    store.data.penaltyCompletions[body.eventId] = {
      completed: body.completed,
      completedAt: nowIso(),
      completedBy: actor?.name || sess.actorId,
    };
    store.markDirty();
    store.logOperation('penalty_completion_updated', { competitionId: comp.id, eventId: body.eventId, completed: body.completed, by: actor?.name || sess.actorId });

    broadcast(comp.id, { type: 'penalty_completion_updated', eventId: body.eventId, completion: store.data.penaltyCompletions[body.eventId] });
    res.json({ ok: true });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- MAINTENANCE (principal only) --------------------
app.get('/api/competitions/:id/maintenance/summary', (req, res) => {
  try {
    const comp = ensureCompById(req.params.id);
    const sess = requirePrincipalActorForCompetition(req, comp.id);
    const backups = store.listBackups(comp.id);
    const actor = store.data.actors[sess.actorId];
    res.json({
      ok: true,
      competition: { id: comp.id, code: comp.code, name: comp.name, status: comp.status },
      actor: actor ? { id: actor.id, name: actor.name, role: actor.role } : { id: sess.actorId, role: 'principal' },
      health: {
        now: nowIso(),
        schemaVersion: store.data.schemaVersion,
        openCompetitions: Object.values(store.data.competitions || {}).filter((c) => c.status === 'open').length,
        principalSessions: Object.keys(store._principalSessions || {}).length,
        actorSessions: Object.keys(store._actorSessions || {}).length,
      },
      stats: {
        events: (store.data.events?.[comp.id] || []).length,
        participants: Object.keys(store.data.participants?.[comp.id] || {}).length,
        checks: Object.keys(store.data.checks || {}).length,
        alertAcks: Object.keys(store.data.alertAcks || {}).length,
        penaltyCompletions: Object.keys(store.data.penaltyCompletions || {}).length,
        backups: backups.length,
        backupsForCompetition: backups.filter((b) => b.containsCompetition).length,
      },
      latestBackup: backups[0] || null,
    });
  } catch (err) {
    httpError(res, err);
  }
});

app.get('/api/competitions/:id/maintenance/backups', (req, res) => {
  try {
    const comp = ensureCompById(req.params.id);
    requirePrincipalActorForCompetition(req, comp.id);
    res.json({ ok: true, backups: store.listBackups(comp.id) });
  } catch (err) {
    httpError(res, err);
  }
});

app.post('/api/competitions/:id/maintenance/backups', (req, res) => {
  try {
    const comp = ensureCompById(req.params.id);
    const sess = requirePrincipalActorForCompetition(req, comp.id);
    const actor = store.data.actors[sess.actorId];
    const created = store.createManualBackup(`manual-${comp.code}`);
    store.logOperation('manual_backup_created', { competitionId: comp.id, filename: created.filename, by: actor?.name || sess.actorId });
    res.json({ ok: true, created });
  } catch (err) {
    httpError(res, err);
  }
});

app.post('/api/competitions/:id/maintenance/restore', (req, res) => {
  try {
    const comp = ensureCompById(req.params.id);
    const sess = requirePrincipalActorForCompetition(req, comp.id);
    const body = z.object({ filename: z.string().min(5) }).parse(req.body);
    const backups = store.listBackups(comp.id);
    const selected = backups.find((b) => b.filename === body.filename);
    if (!selected) throw Object.assign(new Error('Backup no trobat'), { status: 404 });
    if (!selected.containsCompetition) throw Object.assign(new Error('Aquest backup no conté la competició actual.'), { status: 409 });
    const actor = store.data.actors[sess.actorId];
    const result = store.restoreBackup(body.filename, { preserveSessions: true });
    store.logOperation('backup_restored', { competitionId: comp.id, filename: body.filename, by: actor?.name || sess.actorId });
    broadcast(comp.id, { type: 'maintenance_restored', competitionId: comp.id, restoredAt: result.restoredAt });
    res.json({ ok: true, restored: result });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- HEARTBEAT / STATUS --------------------
app.post('/api/competitions/:id/status', (req, res) => {
  try {
    const sess = requireActorSession(store, req);
    const comp = ensureCompById(req.params.id);
    if (sess.competitionId !== comp.id) throw Object.assign(new Error('No autoritzat'), { status: 403 });

    const body = z.object({ pendingCount: z.number().int().min(0).max(9999) }).parse(req.body);
    store.data.status[comp.id] = store.data.status[comp.id] || {};
    store.data.status[comp.id][sess.actorId] = { lastSeenAt: nowIso(), pendingCount: body.pendingCount };
    store.markDirty();

    broadcast(comp.id, { type: 'status_updated', actorId: sess.actorId, status: store.data.status[comp.id][sess.actorId] });

    res.json({ ok: true });
  } catch (err) {
    httpError(res, err);
  }
});

// -------------------- WEBSOCKET --------------------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`FaltesMN server escoltant al port ${PORT}`);
  console.log('Nota: configura PLATFORM_ADMIN_KEY al .env per crear claus de principals.');
  store.save({ forceBackup: true });
});

const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const compSockets = new Map();

function broadcast(competitionId, msg) {
  const set = compSockets.get(competitionId);
  if (!set) return;
  const payload = JSON.stringify(msg);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const compId = url.searchParams.get('compId') || '';
    const token = url.searchParams.get('token') || '';
    if (!compId || !token) {
      ws.close(1008, 'Missing compId/token');
      return;
    }
    const sess = store._actorSessions[token];
    if (!sess || sess.competitionId !== compId) {
      ws.close(1008, 'Invalid token');
      return;
    }

    if (!compSockets.has(compId)) compSockets.set(compId, new Set());
    compSockets.get(compId).add(ws);

    ws.on('close', () => {
      compSockets.get(compId)?.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'hello', competitionId: compId }));
  } catch {
    ws.close(1011, 'Error');
  }
});

process.on('SIGINT', () => {
  store.save({ forceBackup: true });
  process.exit(0);
});
process.on('SIGTERM', () => {
  store.save({ forceBackup: true });
  process.exit(0);
});
