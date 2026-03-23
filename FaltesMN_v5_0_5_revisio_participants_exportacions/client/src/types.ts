export type ColorCode = 'B' | 'G' | 'V' | 'A'
export type EventType = 'fault' | 'assist' | 'withdraw'
export type CategoryCode = 'T' | 'R' | 'C'

export type Fault = {
  id: string
  c: ColorCode
  t: CategoryCode
  desc: string
  k: string[]
}

export type Competition = {
  id: string
  code: string
  name: string
  status: 'open' | 'closed'
  createdAt: string
  closedAt?: string
}

export type ActorRole = 'referee' | 'table' | 'principal'

export type Actor = {
  id: string
  name: string
  role: ActorRole
}

export type EventItem = {
  eventType?: EventType
  id: string
  competitionId: string
  actorId: string
  actorName: string
  actorRole: ActorRole
  bib: number
  faultCode: string
  faultText: string
  color: ColorCode
  category: CategoryCode
  capturedAt: string
  receivedAt: string
  assistTargetBib?: number
  assistDurationSeconds?: number
}

export type CheckState = {
  checked: boolean
  checkedAt: string
  checkedBy: string
}

export type PenaltyCompletion = {
  completed: boolean
  completedAt: string
  completedBy: string
}

export type AlertAckState = {
  acknowledged: boolean
  acknowledgedAt: string
  acknowledgedBy: string
}

export type RefStatus = {
  lastSeenAt: string
  pendingCount: number
}


export type ParticipantGender = 'M' | 'F' | '-'
export type ParticipantCategory = 'Infantil' | 'Cadet' | 'Junior' | 'Promesa' | 'Sènior' | 'Veterà A' | 'Veterà B' | 'Veterà C' | 'Veterà D'

export type ParticipantEntry = {
  bib: number
  noShow?: boolean
  fullName: string
  gender: ParticipantGender | ''
  category: ParticipantCategory | ''
  grossTime: string
  penaltyTime: string
  bonusTime: string
  updatedAt?: string
  updatedBy?: string
}

export type Snapshot = {
  competition: Competition
  events: EventItem[]
  checks: Record<string, CheckState>
  penaltyCompletions: Record<string, PenaltyCompletion>
  alertAcks: Record<string, AlertAckState>
  status: Record<string, RefStatus>
  actors: Record<string, { id: string; competitionId: string; name: string; role: ActorRole; joinedAt: string }>
  participants: Record<string, ParticipantEntry>
}


export type FarewellScreenState = {
  actorName: string
  competitionName: string
  actorRole: ActorRole
  pdfStatus?: 'started' | 'failed' | 'skipped'
  pdfMessage?: string
}

export type LogoutPayload = {
  farewell?: FarewellScreenState | null
}

export type Session = {
  actorToken: string
  actor: Actor
  competition: Competition
  joinToken: string
}

export type PrincipalSession = {
  sessionToken: string
  principal: { id: string; name: string }
}
