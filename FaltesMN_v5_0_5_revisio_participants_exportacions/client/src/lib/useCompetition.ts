import { useEffect, useRef, useState } from 'react'
import type { EventItem, ParticipantEntry, Session, Snapshot } from '../types'
import {
  fetchSnapshot,
  heartbeat,
  isActorSessionError,
  joinCompetition,
  openWs,
  postEvent,
  saveParticipant,
  setAlertAck,
  setCheck,
  setPenaltyCompletion,
  type WsMessage
} from './api'
import { loadCompetitionArchive, saveCompetitionArchive } from './archive'
import { outboxCount, outboxList, outboxPut, outboxRemove, type OutboxEvent, type OutboxParticipant } from './outbox'

function uuid() {
  return crypto.randomUUID()
}

function outboxCheckId(competitionId: string, eventId: string) {
  return `check:${competitionId}:${eventId}`
}

function outboxAlertAckId(competitionId: string, eventId: string) {
  return `alertAck:${competitionId}:${eventId}`
}

function outboxPenaltyId(competitionId: string, eventId: string) {
  return `penalty:${competitionId}:${eventId}`
}

function outboxParticipantId(competitionId: string, bib: number) {
  return `participant:${competitionId}:${bib}`
}

export function useCompetition(
  session: Session | null,
  options?: { onInvalidSession?: () => void; onSessionRecovered?: (session: Session) => void }
) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [pendingCount, setPendingCount] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const invalidHandledRef = useRef(false)

  const actorToken = session?.actorToken || ''
  const competitionId = session?.competition.id || ''

  const tryRecoverSession = async (e: unknown) => {
    if (!session || !isActorSessionError(e)) return false
    if (!session.joinToken) return false

    try {
      const recovered = await joinCompetition(session.competition.code, session.joinToken, session.actor.name)
      invalidHandledRef.current = false
      options?.onSessionRecovered?.(recovered)
      setError('Sessió recuperada automàticament. Continues dins de la competició.')
      return true
    } catch {
      return false
    }
  }

  const handleInvalidSession = async (e: unknown) => {
    if (!isActorSessionError(e)) return false
    if (await tryRecoverSession(e)) return true
    if (invalidHandledRef.current) return true
    invalidHandledRef.current = true
    setError('La sessió ha caducat o ja no és vàlida. Torna a entrar.')
    options?.onInvalidSession?.()
    return true
  }

  const refreshPending = async () => {
    try {
      const n = await outboxCount()
      setPendingCount(n)
      return n
    } catch {
      setPendingCount(0)
      return 0
    }
  }

  const load = async () => {
    if (!session) return
    try {
      const snap = await fetchSnapshot(actorToken, competitionId)
      invalidHandledRef.current = false
      setSnapshot(snap)
      setError(null)
    } catch (e: any) {
      if (await handleInvalidSession(e)) return
      const archived = await loadCompetitionArchive(session).catch(() => null)
      if (archived?.snapshot) {
        setSnapshot(archived.snapshot)
        setError('Servidor no accessible ara mateix. Es mostra la còpia local guardada en aquest dispositiu.')
        return
      }
      setError(String(e?.message || e))
    }
  }

  useEffect(() => {
    invalidHandledRef.current = false
  }, [competitionId, actorToken])

  useEffect(() => {
    if (!session) return
    loadCompetitionArchive(session)
      .then((archived) => {
        if (archived?.snapshot) setSnapshot((prev) => prev || archived.snapshot)
      })
      .catch(() => undefined)
  }, [competitionId, actorToken])

  useEffect(() => {
    if (!session) return
    load()
    refreshPending()
  }, [competitionId, actorToken])

  useEffect(() => {
    if (!session || !snapshot) return
    saveCompetitionArchive(session, snapshot).catch(() => undefined)
  }, [session, snapshot])

  useEffect(() => {
    if (!session) return
    if (!competitionId || !actorToken) return

    try {
      wsRef.current?.close()
    } catch {
      // ignore
    }

    wsRef.current = openWs(
      competitionId,
      actorToken,
      (msg: WsMessage) => {
        setSnapshot((prev) => {
          if (!prev) return prev
          if (msg.type === 'event_created') {
            const exists = prev.events.some((e) => e.id === msg.event.id)
            return exists ? prev : { ...prev, events: [...prev.events, msg.event] }
          }
          if (msg.type === 'check_updated') {
            return { ...prev, checks: { ...prev.checks, [msg.eventId]: msg.check } }
          }
          if (msg.type === 'alert_ack_updated') {
            return { ...prev, alertAcks: { ...(prev.alertAcks || {}), [msg.eventId]: msg.alertAck } }
          }
          if (msg.type === 'penalty_completion_updated') {
            return { ...prev, penaltyCompletions: { ...prev.penaltyCompletions, [msg.eventId]: msg.completion } }
          }
          if (msg.type === 'status_updated') {
            return { ...prev, status: { ...prev.status, [msg.actorId]: msg.status } }
          }
          if (msg.type === 'participant_updated') {
            return { ...prev, participants: { ...(prev.participants || {}), [String(msg.participant.bib)]: msg.participant } }
          }
          if (msg.type === 'actor_joined') {
            return {
              ...prev,
              actors: { ...prev.actors, [msg.actor.id]: msg.actor },
              status: msg.status ? { ...prev.status, [msg.actor.id]: msg.status } : prev.status
            }
          }
          if (msg.type === 'competition_closed') {
            return { ...prev, competition: { ...prev.competition, status: 'closed', closedAt: msg.closedAt } }
          }
          return prev
        })
      },
      () => undefined,
      (e) => {
        handleInvalidSession(e).catch(() => undefined)
      }
    )

    return () => {
      try {
        wsRef.current?.close()
      } catch {
        // ignore
      }
    }
  }, [competitionId, actorToken])

  const flushOutbox = async () => {
    if (!session) return
    const items = await outboxList()
    for (const it of items) {
      try {
        switch (it.kind || 'event') {
          case 'check':
            await setCheck(actorToken, competitionId, it.eventId, it.checked)
            break
          case 'alertAck':
            await setAlertAck(actorToken, competitionId, it.eventId, it.acknowledged)
            break
          case 'penaltyCompletion':
            await setPenaltyCompletion(actorToken, competitionId, it.eventId, it.completed)
            break
          case 'participant':
            await saveParticipant(actorToken, competitionId, {
              bib: it.bib,
              fullName: it.fullName,
              gender: it.gender,
              category: it.category,
              grossTime: it.grossTime,
              penaltyTime: it.penaltyTime,
              bonusTime: it.bonusTime,
              noShow: it.noShow,
            })
            break
          case 'event':
          default:
            await postEvent(actorToken, competitionId, {
              id: it.id,
              bib: it.bib,
              faultCode: it.faultCode,
              faultText: it.faultText,
              color: it.color,
              category: it.category,
              capturedAt: it.capturedAt,
              eventType: it.eventType,
              assistTargetBib: it.assistTargetBib,
              assistDurationSeconds: it.assistDurationSeconds,
            })
            break
        }
        await outboxRemove(it.id)
      } catch (e) {
        if (await handleInvalidSession(e)) return
        break
      }
    }
    await refreshPending()
  }

  useEffect(() => {
    if (!session) return
    const onOnline = () => {
      flushOutbox().catch(() => undefined)
      load().catch(() => undefined)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [competitionId, actorToken])

  useEffect(() => {
    if (!session) return
    const t = setInterval(() => {
      if (navigator.onLine) flushOutbox().catch(() => undefined)
    }, 8000)
    return () => clearInterval(t)
  }, [competitionId, actorToken])

  useEffect(() => {
    if (!session) return
    const t = setInterval(async () => {
      try {
        const n = await refreshPending()
        await heartbeat(actorToken, competitionId, n)
      } catch (e) {
        await handleInvalidSession(e)
      }
    }, 12000)
    return () => clearInterval(t)
  }, [competitionId, actorToken])

  const addEvent = async (payload: {
    bib: number
    faultCode: string
    faultText: string
    color: 'B'|'G'|'V'|'A'
    category: 'T'|'R'|'C'
    capturedAt: string
    eventType?: 'fault'|'assist'|'withdraw'
    assistTargetBib?: number
    assistDurationSeconds?: number
  }): Promise<{ id: string; queued: boolean }> => {
    if (!session) throw new Error('Sense sessió')

    const id = uuid()
    const out: OutboxEvent = {
      id,
      competitionId,
      kind: 'event',
      bib: payload.bib,
      faultCode: payload.faultCode,
      faultText: payload.faultText,
      color: payload.color,
      category: payload.category,
      capturedAt: payload.capturedAt,
      createdAt: new Date().toISOString(),
      eventType: payload.eventType,
      assistTargetBib: payload.assistTargetBib,
      assistDurationSeconds: payload.assistDurationSeconds,
    }

    setSnapshot((prev) => {
      if (!prev) return prev
      const fake: EventItem = {
        id,
        competitionId,
        actorId: session.actor.id,
        actorName: session.actor.name,
        actorRole: session.actor.role,
        bib: payload.bib,
        faultCode: payload.faultCode,
        faultText: payload.faultText,
        color: payload.color,
        category: payload.category,
        capturedAt: payload.capturedAt,
        receivedAt: new Date().toISOString(),
        eventType: payload.eventType || 'fault',
        assistTargetBib: payload.assistTargetBib,
        assistDurationSeconds: payload.assistDurationSeconds,
      }
      return { ...prev, events: [...prev.events, fake] }
    })

    try {
      if (navigator.onLine) {
        await postEvent(actorToken, competitionId, { id, ...payload })
        await refreshPending()
        return { id, queued: false }
      }
    } catch (e) {
      if (await handleInvalidSession(e)) throw new Error('La sessió ha caducat o ja no és vàlida. Torna a entrar.')
    }

    await outboxPut(out)
    await refreshPending()
    return { id, queued: true }
  }

  const toggleCheck = async (eventId: string, checked: boolean) => {
    if (!session) return
    setSnapshot((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        checks: {
          ...prev.checks,
          [eventId]: { checked, checkedAt: new Date().toISOString(), checkedBy: session.actor.name }
        }
      }
    })
    try {
      if (navigator.onLine) {
        await setCheck(actorToken, competitionId, eventId, checked)
        return
      }
    } catch (e) {
      if (await handleInvalidSession(e)) return
    }
    await outboxPut({
      id: outboxCheckId(competitionId, eventId),
      competitionId,
      kind: 'check',
      eventId,
      checked,
      createdAt: new Date().toISOString(),
    })
    await refreshPending()
  }

  const toggleAlertAck = async (eventId: string, acknowledged: boolean) => {
    if (!session) throw new Error('Sense sessió')

    setSnapshot((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        alertAcks: {
          ...(prev.alertAcks || {}),
          [eventId]: { acknowledged, acknowledgedAt: new Date().toISOString(), acknowledgedBy: session.actor.name }
        }
      }
    })

    try {
      if (navigator.onLine) {
        await setAlertAck(actorToken, competitionId, eventId, acknowledged)
        return
      }
    } catch (e) {
      if (await handleInvalidSession(e)) return
    }

    await outboxPut({
      id: outboxAlertAckId(competitionId, eventId),
      competitionId,
      kind: 'alertAck',
      eventId,
      acknowledged,
      createdAt: new Date().toISOString(),
    })
    await refreshPending()
  }

  const togglePenaltyCompletion = async (eventId: string, completed: boolean) => {
    if (!session) return
    setSnapshot((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        penaltyCompletions: {
          ...prev.penaltyCompletions,
          [eventId]: { completed, completedAt: new Date().toISOString(), completedBy: session.actor.name }
        }
      }
    })
    try {
      if (navigator.onLine) {
        await setPenaltyCompletion(actorToken, competitionId, eventId, completed)
        return
      }
    } catch (e) {
      if (await handleInvalidSession(e)) return
    }
    await outboxPut({
      id: outboxPenaltyId(competitionId, eventId),
      competitionId,
      kind: 'penaltyCompletion',
      eventId,
      completed,
      createdAt: new Date().toISOString(),
    })
    await refreshPending()
  }

  const upsertParticipant = async (payload: {
    bib: number
    fullName: string
    gender: ParticipantEntry['gender']
    category: ParticipantEntry['category']
    grossTime: string
    penaltyTime: string
    bonusTime: string
    noShow?: boolean
  }) => {
    if (!session) throw new Error('Sense sessió')

    const optimistic: OutboxParticipant = {
      id: outboxParticipantId(competitionId, payload.bib),
      competitionId,
      kind: 'participant',
      ...payload,
      createdAt: new Date().toISOString(),
    }

    setSnapshot((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        participants: {
          ...(prev.participants || {}),
          [String(payload.bib)]: {
            ...payload,
            updatedAt: optimistic.createdAt,
            updatedBy: session.actor.name,
          },
        }
      }
    })

    try {
      if (navigator.onLine) {
        const saved = await saveParticipant(actorToken, competitionId, payload)
        setSnapshot((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            participants: {
              ...(prev.participants || {}),
              [String(payload.bib)]: saved,
            }
          }
        })
        return saved
      }
    } catch (e) {
      if (await handleInvalidSession(e)) return null
    }

    await outboxPut(optimistic)
    await refreshPending()
    return {
      ...payload,
      updatedAt: optimistic.createdAt,
      updatedBy: session.actor.name,
    }
  }

  const canTable = session?.actor.role === 'table' || session?.actor.role === 'principal'

  return {
    snapshot,
    error,
    pendingCount,
    canTable,
    addEvent,
    toggleAlertAck,
    toggleCheck,
    togglePenaltyCompletion,
    upsertParticipant,
    reload: load,
    flushOutbox,
  }
}
