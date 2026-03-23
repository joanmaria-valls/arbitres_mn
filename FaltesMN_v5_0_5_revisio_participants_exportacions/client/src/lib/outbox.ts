import type { ColorCode, CategoryCode, EventType, ParticipantEntry } from '../types'

export type OutboxEvent = {
  id: string
  competitionId: string
  kind?: 'event'
  bib: number
  faultCode: string
  faultText: string
  color: ColorCode
  category: CategoryCode
  eventType?: EventType
  assistTargetBib?: number
  assistDurationSeconds?: number
  capturedAt: string
  createdAt: string
}

export type OutboxCheck = {
  id: string
  competitionId: string
  kind: 'check'
  eventId: string
  checked: boolean
  createdAt: string
}

export type OutboxAlertAck = {
  id: string
  competitionId: string
  kind: 'alertAck'
  eventId: string
  acknowledged: boolean
  createdAt: string
}

export type OutboxPenaltyCompletion = {
  id: string
  competitionId: string
  kind: 'penaltyCompletion'
  eventId: string
  completed: boolean
  createdAt: string
}

export type OutboxParticipant = {
  id: string
  competitionId: string
  kind: 'participant'
  bib: number
  fullName: string
  gender: ParticipantEntry['gender']
  category: ParticipantEntry['category']
  grossTime: string
  penaltyTime: string
  bonusTime: string
  noShow?: boolean
  createdAt: string
}

export type OutboxItem = OutboxEvent | OutboxCheck | OutboxAlertAck | OutboxPenaltyCompletion | OutboxParticipant

const DB_NAME = 'faltesmn-db'
const DB_VERSION = 1
const STORE = 'outbox'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function outboxPut(item: OutboxItem) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function outboxRemove(id: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function outboxList(): Promise<OutboxItem[]> {
  const db = await openDb()
  const items = await new Promise<OutboxItem[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve((req.result || []) as OutboxItem[])
    req.onerror = () => reject(req.error)
  })
  db.close()
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return items
}

export async function outboxCount(): Promise<number> {
  const db = await openDb()
  const n = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).count()
    req.onsuccess = () => resolve(req.result || 0)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return n
}
