import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function makeToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

export function nowIso() {
  return new Date().toISOString();
}

export function requireAdminKey(req) {
  const adminKey = process.env.PLATFORM_ADMIN_KEY;
  if (!adminKey) {
    const err = new Error('PLATFORM_ADMIN_KEY no configurada al servidor');
    err.status = 500;
    throw err;
  }
  const key = (req.headers['x-admin-key'] || '').toString();
  if (!key || key !== adminKey) {
    const err = new Error('No autoritzat (admin)');
    err.status = 401;
    throw err;
  }
}

export function getBearer(req) {
  const h = (req.headers.authorization || '').toString();
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : '';
}

export function requirePrincipalSession(store, req) {
  const token = getBearer(req);
  if (!token) {
    const err = new Error('No autoritzat (principal)');
    err.status = 401;
    throw err;
  }
  // We store principal sessions in-memory only for simplicity.
  const session = store._principalSessions?.[token];
  if (!session) {
    const err = new Error('Sessió de principal caducada o invàlida');
    err.status = 401;
    throw err;
  }
  return session; // { principalId }
}

export function requireActorSession(store, req) {
  const token = getBearer(req);
  if (!token) {
    const err = new Error('No autoritzat (actor)');
    err.status = 401;
    throw err;
  }
  const session = store._actorSessions?.[token];
  if (!session) {
    const err = new Error('Sessió invàlida');
    err.status = 401;
    throw err;
  }
  return session; // { actorId, competitionId, role }
}

export function isTableRole(role) {
  return role === 'table' || role === 'principal' || role === 'platform_admin';
}

