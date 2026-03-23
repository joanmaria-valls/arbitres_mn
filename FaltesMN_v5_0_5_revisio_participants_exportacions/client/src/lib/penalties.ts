import type { EventItem, PenaltyCompletion } from '../types'

export type PenaltyInstance = {
  eventId: string
  stage: 1 | 2
  minutes: 2 | 4
  triggeredBy: string
  triggerCodes: string[]
  capturedAt: string
  completed: boolean
}

export type AssistInstance = {
  eventId: string
  targetBib?: number
  durationSeconds: number
  capturedAt: string
}

export type WithdrawalInstance = {
  eventId: string
  capturedAt: string
  actorName?: string
}

export type DorsalSummary = {
  bib: number
  whiteRemainder: number
  yellowCount: number
  penaltyTotalMinutes: number
  penalties: PenaltyInstance[]
  dsq: boolean
  dsqReason?: string
  dsqEventId?: string
  dsqDisplayCode?: string
  dsqTriggerCodes?: string[]
  dsqCapturedAt?: string
  dsqCompleted?: boolean
  greenAssistCount: number
  greenAssistSeconds: number
  assists: AssistInstance[]
  withdrawn: boolean
  withdrawnEventId?: string
  withdrawnCapturedAt?: string
  withdrawals: WithdrawalInstance[]
  lastCapturedAt?: string
  lastFault?: string
}

function formatTriggerCodes(codes: string[]) {
  return codes.filter(Boolean).join(' + ')
}

export function computeByDorsal(events: EventItem[], completions: Record<string, PenaltyCompletion>): Map<number, DorsalSummary> {
  const by = new Map<number, EventItem[]>()
  for (const e of events) {
    const arr = by.get(e.bib) || []
    arr.push(e)
    by.set(e.bib, arr)
  }

  const out = new Map<number, DorsalSummary>()

  for (const [bib, arr] of by.entries()) {
    arr.sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id))

    let whiteRemainder = 0
    let yellowCount = 0
    let dsq = false
    let dsqReason: string | undefined
    let dsqEventId: string | undefined
    let dsqDisplayCode: string | undefined
    let dsqTriggerCodes: string[] | undefined
    let dsqCapturedAt: string | undefined
    let dsqCompleted = false
    let withdrawn = false
    let withdrawnEventId: string | undefined
    let withdrawnCapturedAt: string | undefined
    const penalties: PenaltyInstance[] = []
    const whiteBuffer: EventItem[] = []
    const yellowSources: string[][] = []
    const assists: AssistInstance[] = []
    const withdrawals: WithdrawalInstance[] = []
    let greenAssistCount = 0
    let greenAssistSeconds = 0

    for (const ev of arr) {
      const isWithdraw = ev.eventType === 'withdraw' || ev.faultCode === 'ABD'
      const isAssist = ev.eventType === 'assist' || (!ev.eventType && ev.color === 'A' && ev.faultCode === 'VERD')
      if (isWithdraw) {
        withdrawn = true
        withdrawnEventId = ev.id
        withdrawnCapturedAt = ev.capturedAt
        withdrawals.push({ eventId: ev.id, capturedAt: ev.capturedAt, actorName: ev.actorName })
        continue
      }

      if (isAssist) {
        greenAssistCount += 1
        greenAssistSeconds += Math.max(0, Number(ev.assistDurationSeconds || 0))
        assists.push({
          eventId: ev.id,
          targetBib: ev.assistTargetBib,
          durationSeconds: Math.max(0, Number(ev.assistDurationSeconds || 0)),
          capturedAt: ev.capturedAt,
        })
        continue
      }

      if (dsq) break

      if (ev.color === 'V') {
        dsq = true
        dsqEventId = ev.id
        dsqDisplayCode = ev.faultCode
        dsqTriggerCodes = [ev.faultCode]
        dsqCapturedAt = ev.capturedAt
        dsqReason = `${ev.faultCode} (vermella)`
        dsqCompleted = completions[ev.id]?.completed === true
        break
      }

      if (ev.color === 'G') {
        const directCodes = [ev.faultCode]
        if (yellowCount < 2) {
          const stage = (yellowCount + 1) as 1 | 2
          const minutes = stage === 1 ? 2 : 4
          penalties.push({
            eventId: ev.id,
            stage,
            minutes,
            triggeredBy: ev.faultCode,
            triggerCodes: directCodes,
            capturedAt: ev.capturedAt,
            completed: completions[ev.id]?.completed === true,
          })
        }
        yellowCount += 1
        yellowSources.push(directCodes)
        whiteRemainder = 0
        whiteBuffer.length = 0
        if (yellowCount >= 3) {
          const triggerCodes = yellowSources.flat()
          dsq = true
          dsqEventId = ev.id
          dsqDisplayCode = 'V1'
          dsqTriggerCodes = triggerCodes
          dsqCapturedAt = ev.capturedAt
          dsqReason = `V1 (per acumulació: ${formatTriggerCodes(triggerCodes)})`
          dsqCompleted = completions[ev.id]?.completed === true
          break
        }
        continue
      }

      if (yellowCount === 0) {
        whiteRemainder += 1
        whiteBuffer.push(ev)
        if (whiteRemainder >= 3) {
          const triggerCodes = whiteBuffer.map((item) => item.faultCode)
          whiteRemainder = 0
          whiteBuffer.length = 0
          yellowCount += 1
          yellowSources.push(triggerCodes)
          penalties.push({
            eventId: ev.id,
            stage: 1,
            minutes: 2,
            triggeredBy: formatTriggerCodes(triggerCodes),
            triggerCodes,
            capturedAt: ev.capturedAt,
            completed: completions[ev.id]?.completed === true,
          })
        }
      } else {
        const triggerCodes = [...yellowSources.flat(), ev.faultCode]
        if (yellowCount < 2) {
          const stage = (yellowCount + 1) as 1 | 2
          const minutes = stage === 1 ? 2 : 4
          penalties.push({
            eventId: ev.id,
            stage,
            minutes,
            triggeredBy: formatTriggerCodes(triggerCodes),
            triggerCodes,
            capturedAt: ev.capturedAt,
            completed: completions[ev.id]?.completed === true,
          })
        }
        yellowCount += 1
        yellowSources.push([ev.faultCode])
        whiteRemainder = 0
        whiteBuffer.length = 0
        if (yellowCount >= 3) {
          const dsqCodes = [...yellowSources.flat()]
          dsq = true
          dsqEventId = ev.id
          dsqDisplayCode = 'V1'
          dsqTriggerCodes = dsqCodes
          dsqCapturedAt = ev.capturedAt
          dsqReason = `V1 (per acumulació: ${formatTriggerCodes(dsqCodes)})`
          dsqCompleted = completions[ev.id]?.completed === true
          break
        }
      }
    }

    const penaltyTotalMinutes = yellowCount === 0 ? 0 : yellowCount === 1 ? 2 : yellowCount === 2 ? 6 : 0
    const last = arr[arr.length - 1]

    out.set(bib, {
      bib,
      whiteRemainder,
      yellowCount: Math.min(yellowCount, 2),
      penaltyTotalMinutes,
      penalties,
      dsq,
      dsqReason,
      dsqEventId,
      dsqDisplayCode,
      dsqTriggerCodes,
      dsqCapturedAt,
      dsqCompleted,
      greenAssistCount,
      greenAssistSeconds,
      assists,
      withdrawn,
      withdrawnEventId,
      withdrawnCapturedAt,
      withdrawals,
      lastCapturedAt: last?.capturedAt,
      lastFault: last ? `${last.faultCode} ${last.faultText}` : undefined,
    })
  }

  return out
}
