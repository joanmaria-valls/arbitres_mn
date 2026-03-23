import fs from 'node:fs';
import path from 'node:path';

const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), 'data.json');
const DATA_DIR = path.dirname(DATA_PATH);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const LOG_DIR = process.env.LOG_DIR || path.join(DATA_DIR, 'logs');
const BACKUP_INTERVAL_MS = Math.max(60_000, Number(process.env.BACKUP_INTERVAL_MS || 5 * 60 * 1000));
const MAX_BACKUPS = Math.max(5, Number(process.env.MAX_BACKUPS || 36));

/** @typedef {import('./types.mjs').DataFile} DataFile */

function defaultData() {
  /** @type {DataFile} */
  return {
    schemaVersion: 6,
    principals: {},
    competitions: {},
    actors: {},
    events: {},
    checks: {},
    penaltyCompletions: {},
    alertAcks: {},
    status: {},
    participants: {},
    principalSessions: {},
    actorSessions: {},
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeSessions(source) {
  if (!source || typeof source !== 'object') return {};
  const out = {};
  for (const [token, session] of Object.entries(source)) {
    if (!token || !session || typeof session !== 'object') continue;
    out[token] = { ...session };
  }
  return out;
}

function normalizeDataObject(parsed) {
  const merged = {
    ...defaultData(),
    ...(parsed || {}),
  };
  merged.principalSessions = normalizeSessions(parsed?.principalSessions);
  merged.actorSessions = normalizeSessions(parsed?.actorSessions);
  for (const [compId, arr] of Object.entries(merged.events || {})) {
    merged.events[compId] = Array.isArray(arr) ? arr.map((ev) => ({
      eventType: 'fault',
      ...ev,
    })) : [];
  }
  for (const [compId, rows] of Object.entries(merged.participants || {})) {
    const normalized = {};
    for (const [bib, row] of Object.entries(rows || {})) {
      if (!row || typeof row !== 'object') continue;
      normalized[String(bib)] = {
        bib: Number(row.bib || bib),
        noShow: row.noShow === true,
        fullName: String(row.fullName || ''),
        gender: row.gender || '',
        category: row.category || '',
        grossTime: String(row.grossTime || ''),
        penaltyTime: String(row.penaltyTime || ''),
        bonusTime: String(row.bonusTime || ''),
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    }
    merged.participants[compId] = normalized;
  }
  return merged;
}

function loadData() {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(DATA_PATH)) {
      const d = defaultData();
      fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2));
      return d;
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeDataObject(parsed);
  } catch (err) {
    console.error('Failed to load data.json', err);
    return defaultData();
  }
}

function atomicWrite(filePath, contents) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function backupFilename(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `faltesmn-backup-${stamp}.json`;
}

function todayLogFile(date = new Date()) {
  return `faltesmn-${date.toISOString().slice(0, 10)}.ndjson`;
}

export class Store {
  constructor() {
    this.data = loadData();
    this._dirty = false;
    this._saveTimer = null;
    this._lastBackupAt = 0;
    this._principalSessions = { ...(this.data.principalSessions || {}) };
    this._actorSessions = { ...(this.data.actorSessions || {}) };
    ensureDir(BACKUP_DIR);
    ensureDir(LOG_DIR);
  }

  syncSessionsToData() {
    this.data.principalSessions = { ...(this._principalSessions || {}) };
    this.data.actorSessions = { ...(this._actorSessions || {}) };
  }

  markDirty() {
    this._dirty = true;
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        this.save();
      }, 300);
    }
  }

  save(options = {}) {
    const forceBackup = options.forceBackup === true;
    if (!this._dirty && !forceBackup) return;
    this.syncSessionsToData();
    if (this._dirty) {
      this._dirty = false;
      atomicWrite(DATA_PATH, JSON.stringify(this.data, null, 2));
    }
    if (forceBackup || Date.now() - this._lastBackupAt >= BACKUP_INTERVAL_MS) {
      this.writeBackup();
    }
  }

  writeBackup() {
    try {
      this.syncSessionsToData();
      const filePath = path.join(BACKUP_DIR, backupFilename());
      atomicWrite(filePath, JSON.stringify(this.data, null, 2));
      this._lastBackupAt = Date.now();
      this.pruneBackups();
    } catch (err) {
      console.error('Failed to write rolling backup', err);
    }
  }

  pruneBackups() {
    try {
      const entries = fs.readdirSync(BACKUP_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => ({ name, path: path.join(BACKUP_DIR, name), mtimeMs: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of entries.slice(MAX_BACKUPS)) {
        fs.unlinkSync(entry.path);
      }
    } catch (err) {
      console.error('Failed to prune backups', err);
    }
  }

  logOperation(kind, payload) {
    try {
      const line = JSON.stringify({ at: new Date().toISOString(), kind, payload }) + '\n';
      fs.appendFileSync(path.join(LOG_DIR, todayLogFile()), line, 'utf8');
    } catch (err) {
      console.error('Failed to append audit log', err);
    }
  }

  listBackups(competitionId = '') {
    try {
      ensureDir(BACKUP_DIR);
      return fs.readdirSync(BACKUP_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const filePath = path.join(BACKUP_DIR, name);
          const stat = fs.statSync(filePath);
          let containsCompetition = false;
          let competitionName = '';
          let schemaVersion = null;
          try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (competitionId) {
              containsCompetition = !!parsed?.competitions?.[competitionId];
              competitionName = parsed?.competitions?.[competitionId]?.name || '';
            }
            schemaVersion = Number(parsed?.schemaVersion || 0) || null;
          } catch {
            // ignore metadata parse errors
          }
          return {
            filename: name,
            size: stat.size,
            modifiedAt: new Date(stat.mtimeMs).toISOString(),
            containsCompetition,
            competitionName,
            schemaVersion,
          };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    } catch (err) {
      console.error('Failed to list backups', err);
      return [];
    }
  }

  createManualBackup(label = 'manual') {
    this.syncSessionsToData();
    const safeLabel = String(label || 'manual').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 24) || 'manual';
    const name = backupFilename().replace('.json', `-${safeLabel}.json`);
    const filePath = path.join(BACKUP_DIR, name);
    atomicWrite(filePath, JSON.stringify(this.data, null, 2));
    this._lastBackupAt = Date.now();
    this.pruneBackups();
    return { filename: name, path: filePath };
  }

  restoreBackup(filename, options = {}) {
    const safeName = path.basename(String(filename || ''));
    if (!safeName || safeName !== filename || !safeName.endsWith('.json')) {
      throw Object.assign(new Error('Nom de backup invàlid'), { status: 400 });
    }
    const filePath = path.join(BACKUP_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      throw Object.assign(new Error('Backup no trobat'), { status: 404 });
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const restored = normalizeDataObject(parsed);
    if (options.preserveSessions !== false) {
      restored.principalSessions = { ...(this._principalSessions || {}) };
      restored.actorSessions = { ...(this._actorSessions || {}) };
    }
    this.data = restored;
    this._principalSessions = { ...(restored.principalSessions || {}) };
    this._actorSessions = { ...(restored.actorSessions || {}) };
    this._dirty = true;
    this.save({ forceBackup: true });
    return {
      filename: safeName,
      restoredAt: new Date().toISOString(),
      competitionCount: Object.keys(this.data.competitions || {}).length,
    };
  }

}

export { DATA_PATH, BACKUP_DIR, LOG_DIR };
