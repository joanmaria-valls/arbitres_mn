import type { PrincipalSession, Session } from '../types'

const STORAGE_VERSION = '5'
const PREFIX = 'faltesmn.v2'
const OUTBOX_DB_NAME = 'faltesmn-db'

const STORAGE_VERSION_KEY = `${PREFIX}.storageVersion`
const SESSION_KEY = `${PREFIX}.session`
const PRINCIPAL_KEY = `${PREFIX}.principalSession`
const RECENT_JOINS_KEY = `${PREFIX}.recentJoins`
const PRINCIPAL_COMP_KEY = `${PREFIX}.principalCompetition`
const JOIN_BASE_URL_KEY = `${PREFIX}.joinBaseUrl`
const PRINCIPAL_ACCESS_KEY_KEY = `${PREFIX}.principalAccessKey`

const LEGACY_KEYS = [
  'faltesmn.session',
  'faltesmn.principalSession',
  'faltesmn.recentJoins',
  'faltesmn.principalCompetition',
  'faltesmn.joinBaseUrl',
  'faltesmn.principalAccessKey',
]

export type RecentJoin = {
  code: string
  competitionName?: string
  joinToken: string
  name: string
  roleLabel: string
  savedAt: string
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function deleteOutboxDb() {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(OUTBOX_DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  } catch {
    // ignore
  }
}

async function clearSiteCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
    }
  } catch {
    // ignore
  }

  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map((name) => caches.delete(name)))
    }
  } catch {
    // ignore
  }
}

export async function bootstrapStorage() {
  try {
    const current = localStorage.getItem(STORAGE_VERSION_KEY)
    if (current === STORAGE_VERSION) return

    await Promise.allSettled([deleteOutboxDb(), clearSiteCaches()])

    for (const key of [
      ...LEGACY_KEYS,
      SESSION_KEY,
      PRINCIPAL_KEY,
      RECENT_JOINS_KEY,
      PRINCIPAL_COMP_KEY,
      JOIN_BASE_URL_KEY,
      PRINCIPAL_ACCESS_KEY_KEY,
      STORAGE_VERSION_KEY,
    ]) {
      localStorage.removeItem(key)
    }

    localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION)
  } catch {
    // ignore
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function loadSession(): Session | null {
  return readJson<Session>(SESSION_KEY)
}

export function saveSession(s: Session | null) {
  if (!s) {
    clearSession()
    return
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearPrincipalSession() {
  localStorage.removeItem(PRINCIPAL_KEY)
}

export function loadPrincipalSession(): PrincipalSession | null {
  return readJson<PrincipalSession>(PRINCIPAL_KEY)
}

export function savePrincipalSession(s: PrincipalSession | null) {
  if (!s) {
    clearPrincipalSession()
    return
  }
  localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(s))
}

export function clearPrincipalCompetition() {
  localStorage.removeItem(PRINCIPAL_COMP_KEY)
}

export function rememberJoin(s: Session) {
  try {
    const current = loadRecentJoins()
    const roleLabel = s.actor.role === 'table' ? 'Taula' : s.actor.role === 'principal' ? 'Principal' : 'Recorregut'
    const next: RecentJoin = {
      code: s.competition.code,
      competitionName: s.competition.name,
      joinToken: s.joinToken,
      name: s.actor.name,
      roleLabel,
      savedAt: new Date().toISOString()
    }
    const merged = [
      next,
      ...current.filter((x) => !(x.code === next.code && x.joinToken === next.joinToken && x.name === next.name))
    ].slice(0, 3)
    localStorage.setItem(RECENT_JOINS_KEY, JSON.stringify(merged))
  } catch {
    // ignore
  }
}

export function loadRecentJoins(): RecentJoin[] {
  const parsed = readJson<RecentJoin[]>(RECENT_JOINS_KEY)
  return Array.isArray(parsed) ? parsed : []
}

export function savePrincipalCompetition<T = any>(c: T | null) {
  if (!c) {
    clearPrincipalCompetition()
    return
  }
  localStorage.setItem(PRINCIPAL_COMP_KEY, JSON.stringify(c))
}

export function loadPrincipalCompetition<T = any>(): T | null {
  return readJson<T>(PRINCIPAL_COMP_KEY)
}

export function loadJoinBaseUrl(): string | null {
  try {
    return localStorage.getItem(JOIN_BASE_URL_KEY)
  } catch {
    return null
  }
}

export function saveJoinBaseUrl(value: string) {
  try {
    localStorage.setItem(JOIN_BASE_URL_KEY, value)
  } catch {
    // ignore
  }
}

export function loadPrincipalAccessKey(): string | null {
  try {
    return localStorage.getItem(PRINCIPAL_ACCESS_KEY_KEY)
  } catch {
    return null
  }
}

export function savePrincipalAccessKey(value: string | null) {
  try {
    if (!value?.trim()) {
      localStorage.removeItem(PRINCIPAL_ACCESS_KEY_KEY)
      return
    }
    localStorage.setItem(PRINCIPAL_ACCESS_KEY_KEY, value.trim())
  } catch {
    // ignore
  }
}
