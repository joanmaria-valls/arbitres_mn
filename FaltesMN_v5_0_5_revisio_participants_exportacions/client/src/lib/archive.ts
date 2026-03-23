import type { Session, Snapshot } from '../types'

const DB_NAME = 'faltesmn-archive-db'
const DB_VERSION = 1
const STORE = 'archives'

export type CompetitionArchive = {
  key: string
  competitionId: string
  actorRole: Session['actor']['role']
  actorName: string
  actorId: string
  joinToken: string
  savedAt: string
  snapshot: Snapshot
}

function archiveKey(session: Session) {
  return `${session.competition.id}::${session.actor.role}::${session.actor.name.trim().toLowerCase()}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveCompetitionArchive(session: Session, snapshot: Snapshot) {
  const db = await openDb()
  const entry: CompetitionArchive = {
    key: archiveKey(session),
    competitionId: session.competition.id,
    actorRole: session.actor.role,
    actorName: session.actor.name,
    actorId: session.actor.id,
    joinToken: session.joinToken,
    savedAt: new Date().toISOString(),
    snapshot,
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadCompetitionArchive(session: Session): Promise<CompetitionArchive | null> {
  const db = await openDb()
  const key = archiveKey(session)
  const entry = await new Promise<CompetitionArchive | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as CompetitionArchive | undefined) || null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return entry
}

export async function clearCompetitionArchive(session: Session) {
  const db = await openDb()
  const key = archiveKey(session)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
