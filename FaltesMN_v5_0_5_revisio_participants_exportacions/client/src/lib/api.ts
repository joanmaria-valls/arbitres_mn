import type {
  Competition,
  EventItem,
  PrincipalSession,
  Session,
  Snapshot,
  CheckState,
  PenaltyCompletion,
  RefStatus,
  AlertAckState,
  ParticipantEntry
} from '../types'

function apiUrl(path: string) {
  return path
}

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = 10000
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(apiUrl(path), {
      ...init,
      signal: init.signal || controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers || {})
      }
    })
    const data = (await res.json().catch(() => ({}))) as any
    if (!res.ok || data?.ok === false) {
      const msg = data?.error || `Error HTTP ${res.status}`
      throw new Error(msg)
    }
    return data as T
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('Temps d’espera esgotat amb el servidor')
    }
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}

export function isActorSessionError(error: unknown) {
  const msg = String((error as any)?.message || error || '')
  return msg.includes('Sessió invàlida') || msg.includes('No autoritzat (actor)')
}

export function isPrincipalSessionError(error: unknown) {
  const msg = String((error as any)?.message || error || '')
  return msg.includes('Sessió de principal caducada o invàlida') || msg.includes('No autoritzat (principal)')
}

export async function principalLogin(principalKey: string): Promise<PrincipalSession> {
  const r = await http<{ ok: true; sessionToken: string; principal: { id: string; name: string } }>(
    '/api/principal/login',
    { method: 'POST', body: JSON.stringify({ principalKey }) }
  )
  return { sessionToken: r.sessionToken, principal: r.principal }
}

export async function getPrincipalSessionInfo(principalToken: string): Promise<PrincipalSession['principal']> {
  const r = await http<{ ok: true; principal: { id: string; name: string } }>(
    '/api/principal/session',
    { headers: { authorization: `Bearer ${principalToken}` } }
  )
  return r.principal
}

export async function createCompetition(principalToken: string, name: string): Promise<Competition & { joinTokens: { principal?: string; referee: string; table: string } }>
{
  const r = await http<{ ok: true; competition: any }>(
    '/api/competitions',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${principalToken}` },
      body: JSON.stringify({ name })
    }
  )
  return r.competition
}

export async function closeCompetition(principalToken: string, competitionId: string): Promise<void> {
  await http<{ ok: true }>(`/api/competitions/${competitionId}/close`, {
    method: 'POST',
    headers: { authorization: `Bearer ${principalToken}` }
  })
}


export async function principalEnterCompetition(principalToken: string, competitionId: string): Promise<Session> {
  const r = await http<any>(`/api/competitions/${competitionId}/principal-enter`, {
    method: 'POST',
    headers: { authorization: `Bearer ${principalToken}` }
  })

  return {
    actorToken: r.actorToken,
    actor: r.actor,
    competition: r.competition,
    joinToken: r.joinToken || ''
  }
}


export async function principalDirectEnter(principalKey: string, competitionId: string): Promise<Session> {
  const r = await http<any>('/api/principal/direct-enter', {
    method: 'POST',
    body: JSON.stringify({ principalKey, competitionId })
  })

  return {
    actorToken: r.actorToken,
    actor: r.actor,
    competition: r.competition,
    joinToken: r.joinToken || ''
  }
}

export type JoinPreview = {
  competition: Pick<Competition, 'code' | 'name' | 'status'>
  role: 'referee' | 'table' | 'principal'
}

export async function fetchJoinPreview(code: string, joinToken: string): Promise<JoinPreview> {
  const params = new URLSearchParams({ code: code.trim().toUpperCase(), token: joinToken.trim() })
  const r = await http<{ ok: true; competition: Pick<Competition, 'code' | 'name' | 'status'>; role: 'referee' | 'table' | 'principal' }>(`/api/join-preview?${params.toString()}`)
  return { competition: r.competition, role: r.role }
}

export async function joinCompetition(code: string, joinToken: string, name: string): Promise<Session> {
  const r = await http<any>('/api/join', {
    method: 'POST',
    body: JSON.stringify({ code, joinToken, name })
  })

  return {
    actorToken: r.actorToken,
    actor: r.actor,
    competition: r.competition,
    joinToken
  }
}

export async function fetchSnapshot(actorToken: string, competitionId: string): Promise<Snapshot> {
  const r = await http<{ ok: true } & Snapshot>(`/api/competitions/${competitionId}/snapshot`, {
    headers: { authorization: `Bearer ${actorToken}` }
  })
  return {
    competition: r.competition,
    events: r.events,
    checks: r.checks,
    penaltyCompletions: r.penaltyCompletions,
    alertAcks: (r as any).alertAcks || {},
    status: r.status,
    actors: r.actors,
    participants: (r as any).participants || {}
  }
}

export async function saveParticipant(actorToken: string, competitionId: string, payload: {
  bib: number
  fullName: string
  gender: ParticipantEntry['gender']
  category: ParticipantEntry['category']
  grossTime: string
  penaltyTime: string
  bonusTime: string
  noShow?: boolean
}): Promise<ParticipantEntry> {
  const r = await http<{ ok: true; participant: ParticipantEntry }>(`/api/competitions/${competitionId}/participants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify(payload)
  })
  return r.participant
}


export async function postEvent(actorToken: string, competitionId: string, payload: {
  id: string
  bib: number
  faultCode: string
  faultText: string
  color: 'B'|'G'|'V'|'A'
  category: 'T'|'R'|'C'
  capturedAt: string
  eventType?: 'fault'|'assist'|'withdraw'
  assistTargetBib?: number
  assistDurationSeconds?: number
}): Promise<EventItem> {
  const r = await http<{ ok: true; event: EventItem }>(`/api/competitions/${competitionId}/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify(payload)
  })
  return r.event
}

export async function setCheck(actorToken: string, competitionId: string, eventId: string, checked: boolean): Promise<void> {
  await http<{ ok: true }>(`/api/competitions/${competitionId}/checks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify({ eventId, checked })
  })
}


export async function setAlertAck(actorToken: string, competitionId: string, eventId: string, acknowledged: boolean): Promise<void> {
  await http<{ ok: true }>(`/api/competitions/${competitionId}/alert-acks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify({ eventId, acknowledged })
  })
}

export async function setPenaltyCompletion(actorToken: string, competitionId: string, eventId: string, completed: boolean): Promise<void> {
  await http<{ ok: true }>(`/api/competitions/${competitionId}/penalty-completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify({ eventId, completed })
  })
}

export async function heartbeat(actorToken: string, competitionId: string, pendingCount: number): Promise<void> {
  await http<{ ok: true }>(`/api/competitions/${competitionId}/status`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify({ pendingCount })
  })
}

export type WsMessage =
  | { type: 'hello'; competitionId: string }
  | { type: 'competition_closed'; competitionId: string; closedAt: string }
  | { type: 'actor_joined'; actor: { id: string; competitionId: string; name: string; role: 'referee' | 'table' | 'principal'; joinedAt: string }; status?: RefStatus }
  | { type: 'event_created'; event: EventItem }
  | { type: 'check_updated'; eventId: string; check: CheckState }
  | { type: 'penalty_completion_updated'; eventId: string; completion: PenaltyCompletion }
  | { type: 'alert_ack_updated'; eventId: string; alertAck: AlertAckState }
  | { type: 'status_updated'; actorId: string; status: RefStatus }
  | { type: 'participant_updated'; participant: ParticipantEntry }
  | { type: 'maintenance_restored'; competitionId: string; restoredAt: string }

export function openWs(competitionId: string, actorToken: string, onMessage: (msg: WsMessage) => void, onStatus?: (s: 'open'|'closed') => void, onError?: (error: Error) => void) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const url = `${proto}//${host}/ws?compId=${encodeURIComponent(competitionId)}&token=${encodeURIComponent(actorToken)}`

  const ws = new WebSocket(url)
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as WsMessage
      onMessage(msg)
      if (msg.type === 'competition_closed') onStatus?.('closed')
    } catch {
      // ignore
    }
  }
  ws.onclose = (ev) => {
    if (ev.code === 1008) onError?.(new Error('Sessió invàlida'))
  }
  return ws
}


export type MaintenanceSummary = {
  competition: { id: string; code: string; name: string; status: string }
  actor: { id: string; name?: string; role: 'principal' }
  health: { now: string; schemaVersion: number; openCompetitions: number; principalSessions: number; actorSessions: number }
  stats: { events: number; participants: number; checks: number; alertAcks: number; penaltyCompletions: number; backups: number; backupsForCompetition: number }
  latestBackup: MaintenanceBackupItem | null
}

export type MaintenanceBackupItem = {
  filename: string
  size: number
  modifiedAt: string
  containsCompetition: boolean
  competitionName?: string
  schemaVersion?: number | null
}

export async function getMaintenanceSummary(actorToken: string, competitionId: string): Promise<MaintenanceSummary> {
  const r = await http<{ ok: true } & MaintenanceSummary>(`/api/competitions/${competitionId}/maintenance/summary`, {
    headers: { authorization: `Bearer ${actorToken}` }
  })
  return r
}

export async function listMaintenanceBackups(actorToken: string, competitionId: string): Promise<MaintenanceBackupItem[]> {
  const r = await http<{ ok: true; backups: MaintenanceBackupItem[] }>(`/api/competitions/${competitionId}/maintenance/backups`, {
    headers: { authorization: `Bearer ${actorToken}` }
  })
  return r.backups || []
}

export async function createMaintenanceBackup(actorToken: string, competitionId: string): Promise<{ filename: string; path?: string }> {
  const r = await http<{ ok: true; created: { filename: string; path?: string } }>(`/api/competitions/${competitionId}/maintenance/backups`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify({})
  })
  return r.created
}

export async function restoreMaintenanceBackup(actorToken: string, competitionId: string, filename: string): Promise<{ filename: string; restoredAt: string; competitionCount: number }> {
  const r = await http<{ ok: true; restored: { filename: string; restoredAt: string; competitionCount: number } }>(`/api/competitions/${competitionId}/maintenance/restore`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorToken}` },
    body: JSON.stringify({ filename })
  })
  return r.restored
}
