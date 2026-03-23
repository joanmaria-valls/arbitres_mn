import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Competition, EventItem, Fault, LogoutPayload, ParticipantEntry, ParticipantGender, Session } from '../types'
import { Card, Button, Divider, Input, Pill, BandTitle } from '../components/ui'
import { InfoButton } from '../components/AppInfo'
import { Modal } from '../components/Modal'
import { VoskController } from '../lib/vosk'
import { matchFaults, tokenize, FALTES } from '../data/faltes'
import { useCompetition } from '../lib/useCompetition'
import { competitionJoinLink, effectiveJoinBaseUrl, principalAccessLink } from '../lib/baseUrl'
import { exportBibNamePdf, exportClassificationPdf, exportPdfByDorsal, exportPdfGlobal, exportPdfPerReferee, exportSnapshotJson, suggestedRefereePdfFilename } from '../lib/pdf'
import { computeByDorsal, type DorsalSummary } from '../lib/penalties'
import { loadJoinBaseUrl, loadPrincipalAccessKey, loadPrincipalCompetition, savePrincipalCompetition } from '../lib/storage'
import { copyText } from '../lib/clipboard'
import { formatDurationSeconds, formatDurationShort } from '../lib/time'
import {
  PARTICIPANT_CATEGORIES,
  PARTICIPANT_GENDERS,
  buildClassificationSections,
  computeEffectiveParticipantTimes,
  formatCentisToDeltaTime,
  formatParticipantDigits,
  isValidDeltaTime,
  isValidGrossTime,
  normalizeDeltaTime,
  normalizeGrossTime,
  sanitizeParticipantDigits,
  applyGrossTimeInput,
  sanitizeParticipantName,
  extraBonusCentisFromSummary,
  extraPenaltyCentisFromSummary,
  type ClassificationFilter
} from '../lib/participants'
import { useWakeLock } from '../lib/useWakeLock'
import { createMaintenanceBackup, getMaintenanceSummary, listMaintenanceBackups, restoreMaintenanceBackup, type MaintenanceBackupItem, type MaintenanceSummary } from '../lib/api'

function fmtAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return `${m}m`
}

function colorBg(c: 'B' | 'G' | 'V' | 'A') {
  if (c === 'G') return '#fef3c7'
  if (c === 'V') return '#fee2e2'
  if (c === 'A') return '#dcfce7'
  return '#ffffff'
}

function colorBorder(c: 'B' | 'G' | 'V' | 'A') {
  if (c === 'G') return '#f59e0b'
  if (c === 'V') return '#dc2626'
  if (c === 'A') return '#16a34a'
  return '#9ca3af'
}

function colorLabel(c: 'B' | 'G' | 'V' | 'A') {
  return c === 'B' ? 'Blanca' : c === 'G' ? 'Groga' : c === 'V' ? 'Vermella' : 'Verda'
}

function categoryLabel(t: 'T' | 'R' | 'C') {
  return t === 'T' ? 'Tècnica' : t === 'R' ? 'Reglament' : 'Conducta'
}

function speakFaultLabel(f: Fault) {
  if (f.id === 'VERD') return 'targeta verda'
  if (f.id === 'ABD') return 'abandó'
  const match = /^([BGVA])(\d+)$/i.exec(f.id || '')
  if (!match) return f.id
  const letter = match[1].toUpperCase()
  const number = match[2]
  if (letter === 'V') return `ve baixa ${number}`
  if (letter === 'B') return `be ${number}`
  if (letter === 'G') return `ge ${number}`
  return `a ${number}`
}

function roleLabel(role: 'referee' | 'table' | 'principal') {
  return role === 'table' ? 'Àrbitre de taula' : role === 'principal' ? 'Àrbitre principal' : 'Àrbitre'
}

const PARTICIPANT_BIBS = Array.from({ length: 500 }, (_, idx) => idx + 1)
const PARTICIPANT_GENDER_SYMBOLS: Record<ParticipantGender, string> = { M: '♂', F: '♀', '-': '⚧' }
const ALERT_SOUND_URLS = {
  warn: '/sounds/warn-loop.mp3',
  danger: '/sounds/danger-loop.mp3',
} as const

function isWithdrawEvent(e: Pick<EventItem, 'eventType' | 'faultCode'>) {
  return e.eventType === 'withdraw' || e.faultCode === 'ABD'
}

function isAssistEvent(e: Pick<EventItem, 'eventType' | 'color' | 'faultCode'>) {
  return e.eventType === 'assist' || (!e.eventType && e.color === 'A' && e.faultCode === 'VERD')
}

function eventBadgeBg(e: Pick<EventItem, 'eventType' | 'color' | 'faultCode'>) {
  if (isWithdrawEvent(e as EventItem)) return '#f3e8ff'
  return colorBg((e as EventItem).color)
}

function eventBadgeBorder(e: Pick<EventItem, 'eventType' | 'color' | 'faultCode'>) {
  if (isWithdrawEvent(e as EventItem)) return '#7c3aed'
  return colorBorder((e as EventItem).color)
}

function compactSelectStyle(extra?: CSSProperties): CSSProperties {
  return {
    width: '100%',
    minWidth: 0,
    padding: '7px 8px',
    borderRadius: 8,
    border: '1px solid #c8dcc7',
    fontSize: 13,
    background: '#ffffff',
    color: '#1f2937',
    ...extra,
  }
}

const PARTICIPANT_CELL_ORDER = ['fullName', 'gender', 'category', 'grossTime'] as const

function participantCellId(bib: number, field: typeof PARTICIPANT_CELL_ORDER[number]) {
  return `participant-${bib}-${field}`
}

function focusParticipantCell(bib: number, field: typeof PARTICIPANT_CELL_ORDER[number]) {
  const el = document.getElementById(participantCellId(bib, field)) as HTMLInputElement | HTMLSelectElement | null
  if (!el) return false
  el.focus()
  if (el instanceof HTMLInputElement) {
    const pos = el.value.length
    try { el.setSelectionRange(pos, pos) } catch {}
  }
  return true
}

function moveParticipantCellHorizontal(bib: number, field: typeof PARTICIPANT_CELL_ORDER[number], direction: -1 | 1) {
  const idx = PARTICIPANT_CELL_ORDER.indexOf(field)
  if (idx < 0) return false
  const nextField = PARTICIPANT_CELL_ORDER[idx + direction]
  if (!nextField) return false
  return focusParticipantCell(bib, nextField)
}

function participantRowFromSource(bib: number, source?: Partial<ParticipantEntry> | null): ParticipantEntry {
  return {
    bib,
    noShow: source?.noShow === true,
    fullName: sanitizeParticipantName(source?.fullName || ''),
    gender: source?.gender || '',
    category: source?.category || '',
    grossTime: source?.grossTime || '',
    penaltyTime: source?.penaltyTime || '',
    bonusTime: source?.bonusTime || '',
    updatedAt: source?.updatedAt,
    updatedBy: source?.updatedBy,
  }
}

function participantDraftMatchesSaved(a: Pick<ParticipantEntry, 'noShow' | 'fullName' | 'gender' | 'category' | 'grossTime'>, b: Pick<ParticipantEntry, 'noShow' | 'fullName' | 'gender' | 'category' | 'grossTime'>) {
  return (
    (a.noShow === true) === (b.noShow === true) &&
    sanitizeParticipantName(a.fullName || '') === sanitizeParticipantName(b.fullName || '') &&
    (a.gender || '') === (b.gender || '') &&
    (a.category || '') === (b.category || '') &&
    normalizeGrossTime(a.grossTime || '') === normalizeGrossTime(b.grossTime || '')
  )
}

function classificationButtonLabel(title: string, gender?: ParticipantGender) {
  if (!gender) return title
  if (gender === 'M') return `${title} MASCULÍ`
  if (gender === 'F') return `${title} FEMENÍ`
  return `${title} NO BINARI`
}

function classificationButtonNode(title: string, gender?: ParticipantGender): ReactNode {
  if (!gender) return title
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3, width: '100%', fontSize: 10.5, lineHeight: 1, fontWeight: 800 }}>
      <span>{title}</span>
      <span style={{ fontSize: gender === '-' ? 18 : 22, lineHeight: 0.9, fontWeight: 900 }}>{PARTICIPANT_GENDER_SYMBOLS[gender]}</span>
    </span>
  )
}

function participantDerivedView(row: ParticipantEntry, summary?: DorsalSummary) {
  const effective = computeEffectiveParticipantTimes(row, summary)
  return {
    ...effective,
    autoPenaltyTime: formatCentisToDeltaTime(extraPenaltyCentisFromSummary(summary)),
    autoBonusTime: formatCentisToDeltaTime(extraBonusCentisFromSummary(summary)),
    isExpelled: summary?.dsq === true,
    isWithdrawn: summary?.withdrawn === true,
  }
}

const AUTO_VOICE = '__auto__'

function sanitizeAssistDigits(raw: string) {
  return String(raw || '').replace(/\D/g, '').slice(0, 4)
}

function formatAssistDigits(raw: string) {
  const digits = sanitizeAssistDigits(raw)
  const padded = digits.padEnd(4, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`
}

function parseAssistDigitsToSeconds(raw: string) {
  const digits = sanitizeAssistDigits(raw)
  const padded = digits.padEnd(4, '0')
  const minutes = Math.max(0, Number(padded.slice(0, 2) || '0'))
  const seconds = Math.max(0, Math.min(59, Number(padded.slice(2, 4) || '0')))
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0
  return Math.floor(minutes) * 60 + Math.floor(seconds)
}

function nextAssistDigitsFromKey(current: string, key: string) {
  const digits = sanitizeAssistDigits(current)
  if (/^[0-9]$/.test(key)) return sanitizeAssistDigits(`${digits}${key}`)
  return digits
}

function loadVoices() {
  try {
    return window.speechSynthesis.getVoices().slice().sort((a, b) => {
      const aCa = /^ca(-|_)?/i.test(a.lang) || /catal/i.test(`${a.name} ${a.voiceURI}`)
      const bCa = /^ca(-|_)?/i.test(b.lang) || /catal/i.test(`${b.name} ${b.voiceURI}`)
      if (aCa !== bCa) return aCa ? -1 : 1
      return `${a.name} ${a.lang}`.localeCompare(`${b.name} ${b.lang}`)
    })
  } catch {
    return [] as SpeechSynthesisVoice[]
  }
}

function isCatalanVoice(voice: SpeechSynthesisVoice) {
  return /^ca(-|_)?/i.test(voice.lang) || /catal/i.test(`${voice.name} ${voice.voiceURI}`)
}

function preferredVoice(voices: SpeechSynthesisVoice[], selectedVoiceUri = AUTO_VOICE) {
  if (selectedVoiceUri && selectedVoiceUri !== AUTO_VOICE) {
    const selected = voices.find((v) => v.voiceURI === selectedVoiceUri)
    if (selected) return selected
  }

  return voices.find((v) => isCatalanVoice(v)) || voices.find((v) => /^es(-|_)?/i.test(v.lang)) || voices[0] || null
}

function primeSpeechSynthesis() {
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.rate = 1
    synth.cancel()
    synth.resume?.()
    synth.speak(u)
  } catch {
    // ignore
  }
}

function speakWithReplay(text: string, voices: SpeechSynthesisVoice[], selectedVoiceUri = AUTO_VOICE) {
  speak(text, voices, selectedVoiceUri)
  window.setTimeout(() => speak(text, voices, selectedVoiceUri), 180)
}

function speak(text: string, voices: SpeechSynthesisVoice[], selectedVoiceUri = AUTO_VOICE) {
  try {
    if (!text?.trim()) return
    const synth = window.speechSynthesis
    if (!synth) return
    const availableVoices = voices.length ? voices : loadVoices()

    const emit = (fallback = false) => {
      const u = new SpeechSynthesisUtterance(text)
      const voice = preferredVoice(availableVoices, selectedVoiceUri)
      if (voice && !fallback) {
        u.voice = voice
        u.lang = voice.lang || 'ca-ES'
      } else {
        u.lang = fallback ? 'es-ES' : 'ca-ES'
      }
      u.rate = 0.96
      u.pitch = 1
      u.volume = 1
      synth.cancel()
      synth.resume?.()
      synth.speak(u)
    }

    emit(false)
    window.setTimeout(() => {
      try {
        if (!synth.speaking && !synth.pending) emit(true)
      } catch {
        // ignore
      }
    }, 240)
    window.setTimeout(() => {
      try {
        if (!synth.speaking && !synth.pending) emit(true)
      } catch {
        // ignore
      }
    }, 700)
  } catch {
    // ignore
  }
}

function sortByTypeThenColor(list: Fault[]) {
  const categoryOrder = { T: 0, R: 1, C: 2 }
  const colorOrder = { B: 0, G: 1, V: 2, A: 3 }
  return list
    .slice()
    .sort((a, b) => categoryOrder[a.t] - categoryOrder[b.t] || colorOrder[a.c] - colorOrder[b.c] || a.id.localeCompare(b.id))
}

function sortByColorThenType(list: Fault[]) {
  const categoryOrder = { T: 0, R: 1, C: 2 }
  const colorOrder = { B: 0, G: 1, V: 2, A: 3 }
  return list
    .slice()
    .sort((a, b) => colorOrder[a.c] - colorOrder[b.c] || categoryOrder[a.t] - categoryOrder[b.t] || a.id.localeCompare(b.id))
}

function groupedFaults(list: Fault[], sortMode: 'TYPE' | 'COLOR') {
  const groups: { key: string; title: string; items: Fault[] }[] = []
  if (sortMode === 'TYPE') {
    for (const t of ['T', 'R', 'C'] as const) {
      const items = list.filter((f) => f.t === t)
      if (items.length) groups.push({ key: t, title: categoryLabel(t), items })
    }
    return groups
  }

  for (const c of ['B', 'G', 'V', 'A'] as const) {
    const items = list.filter((f) => f.c === c)
    if (items.length) groups.push({ key: c, title: colorLabel(c), items })
  }
  return groups
}

type AlertItem = { id: string; eventId: string; text: string; kind: 'warn' | 'danger' | 'success' | 'withdraw'; capturedAt: string }

type ExpelledWarning = { bib: number; priorCardCode?: string }

type StoredPrincipalCompetition = Competition & { joinTokens?: { principal?: string; referee: string; table: string } }

async function makeQrDataUrl(text: string): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return await QRCode.toDataURL(text, { margin: 1, width: 260 })
}



function commandTextFromSpeech(text: string) {
  const tokens = tokenize(text)
  const wakeWords = ['atencio', 'atensio', 'tencio']
  const idx = tokens.findIndex((x) => wakeWords.includes(x))
  return idx === -1 ? '' : tokens.slice(idx + 1).join(' ')
}

function isGreenAssistCommand(text: string) {
  const command = commandTextFromSpeech(text)
  if (!command) return false
  const normalized = tokenize(command).join(' ')
  return normalized === 'verd' ||
    normalized === 'verda' ||
    normalized === 'verde' ||
    normalized === 'targeta verd' ||
    normalized === 'targeta verda' ||
    normalized === 'auxili verd' ||
    normalized === 'auxili verda'
}

function shouldAutoSelect(matches: { fault: Fault; score: number }[]) {
  const top = matches[0]
  if (!top) return false
  const second = matches[1]
  if (!second) return true
  return top.score >= 4 && top.score - second.score >= 1.5
}

function eventSummaryText(e: EventItem) {
  if (isWithdrawEvent(e)) return 'Abandó del/de la competidor/a'
  if (isAssistEvent(e)) {
    return `Dorsal ${e.bib} ha prestat auxili a dorsal ${e.assistTargetBib ?? '-'} durant ${formatDurationSeconds(e.assistDurationSeconds || 0)} que se li han de descomptar del total`
  }
  return e.faultText
}

function bestMatchesFromSpeech(text: string, limit = 6) {
  const command = commandTextFromSpeech(text)
  if (!command) return []
  const commandTokens = tokenize(command)
  const variants = Array.from(
    new Set([
      command,
      commandTokens.slice(-3).join(' '),
      commandTokens.slice(-2).join(' '),
    ].map((x) => String(x || '').trim()).filter(Boolean))
  )

  let best: { fault: Fault; score: number }[] = []
  for (const variant of variants) {
    const matches = matchFaults(variant, limit)
    if (!matches.length) continue
    if (!best.length) {
      best = matches
      continue
    }
    const bestScore = best[0]?.score || 0
    const candidateScore = matches[0]?.score || 0
    if (candidateScore > bestScore) best = matches
  }
  return best
}

function dsqStatusForBib(events: { bib: number; id: string; capturedAt: string; faultCode: string; faultText: string; color: 'B'|'G'|'V'|'A'; category: 'T'|'R'|'C' }[], bib: number) {
  const byDorsal = computeByDorsal(events as any, {})
  const s = byDorsal.get(bib)
  if (!s?.dsq) return null
  return { bib, priorCardCode: s.dsqDisplayCode || 'VERMELLA' }
}

function playExpelledAlarm() {
  let ctx: AudioContext | null = null
  let osc: OscillatorNode | null = null
  let gain: GainNode | null = null
  let timer: number | null = null
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (AudioCtx) {
      ctx = new AudioCtx()
      osc = ctx.createOscillator()
      gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 980
      gain.gain.value = 0.0001
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      let on = false
      timer = window.setInterval(() => {
        on = !on
        if (!gain) return
        const now = ctx?.currentTime || 0
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(on ? 0.22 : 0.0001, now + 0.03)
      }, 280)
    }
  } catch {
    // ignore
  }

  try {
    if ('vibrate' in navigator) navigator.vibrate?.([180, 100, 180, 100, 180])
  } catch {
    // ignore
  }

  return () => {
    try { if (timer) window.clearInterval(timer) } catch {}
    try { gain?.gain.cancelScheduledValues(ctx?.currentTime || 0) } catch {}
    try { gain?.gain.setValueAtTime(0.0001, ctx?.currentTime || 0) } catch {}
    try { osc?.stop() } catch {}
    try { ctx?.close() } catch {}
    try { if ('vibrate' in navigator) navigator.vibrate?.(0) } catch {}
  }
}

function fallbackPlayAlertChime(kind: 'warn' | 'danger') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const master = ctx.createGain()
    master.gain.value = kind === 'danger' ? 1.0 : 0.88
    master.connect(ctx.destination)

    if (kind === 'danger') {
      const sweeps = [
        { at: 0.00, from: 1700, to: 2450, dur: 0.26 },
        { at: 0.28, from: 2450, to: 1700, dur: 0.26 },
        { at: 0.62, from: 1750, to: 2550, dur: 0.26 },
        { at: 0.90, from: 2550, to: 1750, dur: 0.26 },
      ]
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.connect(gain)
      gain.connect(master)
      gain.gain.value = 0.0001
      sweeps.forEach((s) => {
        osc.frequency.setValueAtTime(s.from, ctx.currentTime + s.at)
        osc.frequency.linearRampToValueAtTime(s.to, ctx.currentTime + s.at + s.dur)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + s.at)
        gain.gain.linearRampToValueAtTime(0.95, ctx.currentTime + s.at + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + s.at + s.dur)
      })
      osc.start()
      const total = sweeps[sweeps.length - 1].at + sweeps[sweeps.length - 1].dur + 0.08
      osc.stop(ctx.currentTime + total)
      window.setTimeout(() => { void ctx.close().catch(() => undefined) }, Math.ceil(total * 1000) + 220)
    } else {
      const rings = [
        { at: 0.00, freqA: 2150, freqB: 2580, dur: 0.16 },
        { at: 0.19, freqA: 2150, freqB: 2580, dur: 0.16 },
        { at: 0.48, freqA: 2150, freqB: 2580, dur: 0.16 },
        { at: 0.67, freqA: 2150, freqB: 2580, dur: 0.16 },
      ]
      rings.forEach((b) => {
        const oscA = ctx.createOscillator()
        const oscB = ctx.createOscillator()
        const gainA = ctx.createGain()
        const gainB = ctx.createGain()
        oscA.type = 'square'
        oscB.type = 'square'
        oscA.frequency.setValueAtTime(b.freqA, ctx.currentTime + b.at)
        oscB.frequency.setValueAtTime(b.freqB, ctx.currentTime + b.at)
        gainA.gain.setValueAtTime(0.0001, ctx.currentTime + b.at)
        gainB.gain.setValueAtTime(0.0001, ctx.currentTime + b.at)
        gainA.gain.linearRampToValueAtTime(0.92, ctx.currentTime + b.at + 0.012)
        gainB.gain.linearRampToValueAtTime(0.58, ctx.currentTime + b.at + 0.012)
        gainA.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + b.at + b.dur)
        gainB.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + b.at + b.dur)
        oscA.connect(gainA)
        oscB.connect(gainB)
        gainA.connect(master)
        gainB.connect(master)
        oscA.start(ctx.currentTime + b.at)
        oscB.start(ctx.currentTime + b.at)
        oscA.stop(ctx.currentTime + b.at + b.dur + 0.02)
        oscB.stop(ctx.currentTime + b.at + b.dur + 0.02)
      })
      const total = rings[rings.length - 1].at + rings[rings.length - 1].dur + 0.08
      window.setTimeout(() => { void ctx.close().catch(() => undefined) }, Math.ceil(total * 1000) + 220)
    }
  } catch {
    // ignore
  }

  try {
    if ('vibrate' in navigator) navigator.vibrate?.(kind === 'danger' ? [280, 90, 320, 90, 360] : [120, 60, 120, 220, 120, 60, 120])
  } catch {
    // ignore
  }
}

function startRepeatingAlertChime(kind: 'warn' | 'danger') {
  const audio = new Audio(ALERT_SOUND_URLS[kind])
  audio.loop = true
  audio.preload = 'auto'
  audio.volume = 1
  audio.playbackRate = kind === 'danger' ? 1.12 : 1.0
  fallbackPlayAlertChime(kind)
  let fallbackTimer: number | null = null
  void audio.play().catch(() => {
    const every = kind === 'danger' ? 1500 : 2200
    fallbackTimer = window.setInterval(() => fallbackPlayAlertChime(kind), every)
  })
  return () => {
    try {
      audio.pause()
      audio.currentTime = 0
    } catch {}
    try { if (fallbackTimer) window.clearInterval(fallbackTimer) } catch {}
    try { if ('vibrate' in navigator) navigator.vibrate?.(0) } catch {}
  }
}

export function Dashboard(props: { session: Session; onLogout: (payload?: LogoutPayload) => void; onInvalidSession: () => void; onSessionRecovered?: (s: Session) => void; addToast: (t: { text: string; kind?: 'info' | 'warn' | 'danger' }) => void }) {
  const { snapshot, error, pendingCount, canTable, addEvent, toggleAlertAck, toggleCheck, togglePenaltyCompletion, upsertParticipant, reload } = useCompetition(props.session, { onInvalidSession: props.onInvalidSession, onSessionRecovered: props.onSessionRecovered })
  const defaultTab = props.session.actor.role === 'referee' ? 'Arbitrar' : 'Entrades'
  const [tab, setTab] = useState<string>(defaultTab)
  const [qrOpen, setQrOpen] = useState(false)
  const [expelledWarning, setExpelledWarning] = useState<ExpelledWarning | null>(null)
  const wakeLock = useWakeLock(snapshot?.competition.status === 'open')

  useEffect(() => {
    setTab(defaultTab)
  }, [props.session.actor.role])

  const comp = snapshot?.competition
  const events = snapshot?.events || []
  const checks = snapshot?.checks || {}
  const alertAcks = snapshot?.alertAcks || {}
  const completions = snapshot?.penaltyCompletions || {}
  const status = snapshot?.status || {}
  const actors = snapshot?.actors || {}
  const participants = snapshot?.participants || {}
  const dorsalSummaries = useMemo(() => computeByDorsal(events, completions), [events, completions])


  const handleLogout = async () => {
    if (props.session.actor.role !== 'referee') {
      props.onLogout()
      return
    }

    const mine = events.filter((e) => e.actorId === props.session.actor.id)
    const meta = {
      competitionName: comp?.name || props.session.competition.name,
      competitionCode: comp?.code || props.session.competition.code,
      refereeName: props.session.actor.name,
      generatedAt: new Date().toISOString(),
    }

    try {
      if (mine.length) {
        await exportPdfPerReferee(meta, mine, {
          filename: suggestedRefereePdfFilename(meta),
          mode: 'download',
        })
        props.onLogout({
          farewell: {
            actorName: props.session.actor.name,
            competitionName: meta.competitionName,
            actorRole: props.session.actor.role,
            pdfStatus: 'started',
            pdfMessage: 'S’ha iniciat la descàrrega del PDF amb el teu registre d’arbitratge.',
          },
        })
        return
      }

      props.onLogout({
        farewell: {
          actorName: props.session.actor.name,
          competitionName: meta.competitionName,
          actorRole: props.session.actor.role,
          pdfStatus: 'skipped',
          pdfMessage: 'No hi havia cap incidència registrada; per això no s’ha generat cap PDF en sortir.',
        },
      })
    } catch {
      props.onLogout({
        farewell: {
          actorName: props.session.actor.name,
          competitionName: meta.competitionName,
          actorRole: props.session.actor.role,
          pdfStatus: 'failed',
          pdfMessage: 'No s’ha pogut generar automàticament el PDF en sortir. Pots tornar a entrar i usar “Exporta PDF (meu)”.',
        },
      })
    }
  }

  const savedPrincipalComp = useMemo<StoredPrincipalCompetition | null>(() => {
    if (props.session.actor.role !== 'principal') return null
    return loadPrincipalCompetition<StoredPrincipalCompetition>()
  }, [props.session.actor.role, comp?.id, comp?.code])

  const principalComp = useMemo<StoredPrincipalCompetition | null>(() => {
    if (props.session.actor.role !== 'principal') return null
    const liveComp = comp as StoredPrincipalCompetition | undefined
    if (liveComp?.joinTokens) return liveComp
    return savedPrincipalComp
  }, [props.session.actor.role, comp, savedPrincipalComp])

  useEffect(() => {
    if (props.session.actor.role !== 'principal') return
    if (!principalComp?.joinTokens) return
    savePrincipalCompetition(principalComp)
  }, [props.session.actor.role, principalComp?.id, principalComp?.code, principalComp?.joinTokens?.principal, principalComp?.joinTokens?.referee, principalComp?.joinTokens?.table])

  const joinBaseUrl = useMemo(() => effectiveJoinBaseUrl(loadJoinBaseUrl()), [comp?.id, comp?.code])
  const principalAccessKey = useMemo(() => loadPrincipalAccessKey() || '', [comp?.id, comp?.code])

  const principalLinks = useMemo(() => {
    if (!principalComp?.joinTokens) return null
    return {
      principalLink: principalComp.joinTokens?.principal ? competitionJoinLink(joinBaseUrl, principalComp.code, principalComp.joinTokens.principal, props.session.actor.name || 'Principal') : (principalAccessKey.trim() ? principalAccessLink(joinBaseUrl, principalAccessKey.trim(), principalComp.id) : ''),
      refereeLink: competitionJoinLink(joinBaseUrl, principalComp.code, principalComp.joinTokens.referee),
      tableLink: competitionJoinLink(joinBaseUrl, principalComp.code, principalComp.joinTokens.table)
    }
  }, [principalComp, joinBaseUrl, principalAccessKey, props.session.actor.name])

  const [qrPrincipal, setQrPrincipal] = useState('')
  const [qrRef, setQrRef] = useState('')
  const [qrTable, setQrTable] = useState('')

  useEffect(() => {
    ;(async () => {
      if (!principalLinks) {
        setQrPrincipal('')
        setQrRef('')
        setQrTable('')
        return
      }
      setQrPrincipal(principalLinks.principalLink ? await makeQrDataUrl(principalLinks.principalLink) : '')
      setQrRef(await makeQrDataUrl(principalLinks.refereeLink))
      setQrTable(await makeQrDataUrl(principalLinks.tableLink))
    })().catch(() => undefined)
  }, [principalLinks?.principalLink, principalLinks?.refereeLink, principalLinks?.tableLink])

  const bannerAlerts = useMemo<AlertItem[]>(() => {
    if (!canTable) return []
    const summaries = computeByDorsal(events as any, completions as any)
    const alerts: AlertItem[] = []

    for (const ev of events as EventItem[]) {
      if (isWithdrawEvent(ev) && alertAcks[ev.id]?.acknowledged !== true) {
        alerts.push({
          id: `withdraw:${ev.id}`,
          eventId: ev.id,
          capturedAt: ev.capturedAt,
          kind: 'withdraw',
          text: `Dorsal ${ev.bib} ha abandonat la competició`,
        })
      }
      if (isAssistEvent(ev) && alertAcks[ev.id]?.acknowledged !== true) {
        alerts.push({
          id: `assist:${ev.id}`,
          eventId: ev.id,
          capturedAt: ev.capturedAt,
          kind: 'success',
          text: `Dorsal ${ev.bib} ha prestat auxili a dorsal ${ev.assistTargetBib ?? '-'} durant ${formatDurationSeconds(ev.assistDurationSeconds || 0)} que se li han de descomptar del total`,
        })
      }
    }

    for (const [bib, s] of summaries.entries()) {
      for (const p of s.penalties) {
        if (alertAcks[p.eventId]?.acknowledged === true) continue
        alerts.push({
          id: `penalty:${p.eventId}:${p.stage}`,
          eventId: p.eventId,
          capturedAt: p.capturedAt,
          kind: 'warn',
          text: p.triggerCodes.length > 1
            ? `Dorsal ${bib}: GROGA per acumulació (${p.triggeredBy})`
            : `Dorsal ${bib}: GROGA (${p.triggeredBy})`
        })
      }

      if (s.dsq && s.dsqEventId && alertAcks[s.dsqEventId]?.acknowledged !== true) {
        alerts.push({
          id: `dsq:${s.dsqEventId}`,
          eventId: s.dsqEventId,
          capturedAt: s.dsqCapturedAt || s.lastCapturedAt || '',
          kind: 'danger',
          text: s.dsqDisplayCode && s.dsqDisplayCode !== 'V1'
            ? `Dorsal ${bib}: VERMELLA / desqualificació (${s.dsqDisplayCode})`
            : `Dorsal ${bib}: VERMELLA per acumulació (V1)`
        })
      }
    }

    return alerts.sort((a, b) => (b.capturedAt + b.id).localeCompare(a.capturedAt + a.id))
  }, [canTable, events, alertAcks, completions])

  const prevAlertIdsRef = useRef<Set<string> | null>(null)
  const repeatingAlertStopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!canTable) return
    const prev = prevAlertIdsRef.current
    const newAlerts = prev ? bannerAlerts.filter((a) => !prev.has(a.id)) : []
    if (newAlerts.length) {
      for (const a of newAlerts) props.addToast({ text: a.text, kind: a.kind === 'success' ? 'info' : a.kind === 'withdraw' ? 'warn' : a.kind })
      if (newAlerts.some((a) => a.kind === 'danger')) fallbackPlayAlertChime('danger')
      else if (newAlerts.some((a) => a.kind === 'warn')) fallbackPlayAlertChime('warn')
    }
    prevAlertIdsRef.current = new Set(bannerAlerts.map((a) => a.id))
  }, [canTable, bannerAlerts, props.addToast])

  useEffect(() => {
    repeatingAlertStopRef.current?.()
    repeatingAlertStopRef.current = null
    if (!canTable) return
    if (bannerAlerts.some((a) => a.kind === 'danger')) {
      repeatingAlertStopRef.current = startRepeatingAlertChime('danger')
    } else if (bannerAlerts.some((a) => a.kind === 'warn')) {
      repeatingAlertStopRef.current = startRepeatingAlertChime('warn')
    }
    return () => {
      repeatingAlertStopRef.current?.()
      repeatingAlertStopRef.current = null
    }
  }, [canTable, bannerAlerts.map((a) => `${a.id}:${a.kind}`).join('|')])

  useEffect(() => {
    if (!expelledWarning) return
    const stopAlarm = playExpelledAlarm()
    return () => stopAlarm()
  }, [expelledWarning])

  const isControlRole = props.session.actor.role === 'principal' || props.session.actor.role === 'table'

  const statusRow = (
    <div className="dash-status-row">
      <Pill bg={navigator.onLine ? '#dcfce7' : '#fee2e2'} fg="#111827">
        {navigator.onLine ? 'ONLINE' : 'OFFLINE'}
      </Pill>
      <Pill bg={pendingCount > 0 ? '#fef3c7' : '#f3f4f6'}>Pendents: {pendingCount}</Pill>
      <Pill bg={wakeLock.enabled ? '#dcfce7' : '#f3f4f6'}>
        {wakeLock.supported ? (wakeLock.enabled ? 'Pantalla desperta' : 'Pantalla activa no fixada') : 'Wake Lock no disponible'}
      </Pill>
      {comp?.status === 'closed' ? <Pill bg="#fee2e2">TANCADA</Pill> : null}
    </div>
  )

  const buttonRow = (
    <div className={`dash-button-row ${isControlRole ? 'dash-button-row--control' : 'dash-button-row--referee'}`}>
      {props.session.actor.role === 'principal' && principalLinks ? (
        <Button variant="secondary" onClick={() => setQrOpen(true)}>
          Veure QR i accessos
        </Button>
      ) : null}
      <InfoButton />
      <Button variant="secondary" onClick={reload}>
        Refresca
      </Button>
      <Button variant="secondary" onClick={() => { void handleLogout() }}>
        Sortir
      </Button>
    </div>
  )

  const header = (
    <div className={`dash-header ${isControlRole ? 'dash-header--control' : 'dash-header--referee'}`}>
      <div className="dash-header-top">
        <div className="dash-header-main">
          <div className="dash-title">FaltesMN (CAT)</div>
          {comp ? (
            <div className="dash-meta-row" aria-label="Competició i àrbitre">
              <span className="dash-meta-pill dash-meta-pill--primary" title={comp.name}>{comp.name}</span>
              <span className="dash-meta-sep" aria-hidden="true">–</span>
              <span className="dash-meta-pill dash-meta-pill--secondary" title={props.session.actor.name}>{props.session.actor.name}</span>
            </div>
          ) : (
            <div style={{ color: '#6b7280', marginTop: 4, fontWeight: 700 }}>Carregant…</div>
          )}
        </div>

        {isControlRole ? (
          <div className="dash-header-top-actions dash-header-top-actions--control">
            {statusRow}
            {buttonRow}
          </div>
        ) : (
          <div className="dash-header-top-actions dash-header-top-actions--referee">
            {statusRow}
            {buttonRow}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 14 }}>
      {header}
      {expelledWarning ? (
        <div
          className="alert-expelled-pulse"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(185, 28, 28, 0.96)',
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            padding: 20
          }}
        >
          <div style={{ maxWidth: 760, width: '100%', background: 'rgba(127, 29, 29, 0.75)', border: '3px solid #fecaca', borderRadius: 22, padding: 22, boxShadow: '0 10px 30px rgba(0,0,0,0.35)', display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 34, fontWeight: 1000, lineHeight: 1.1, textAlign: 'center', textTransform: 'uppercase' }}>DORSAL {expelledWarning.bib}</div>
            <div style={{ fontSize: 22, fontWeight: 900, textAlign: 'center', textTransform: 'uppercase' }}>DORSAL JA EXPULSAT ABANS PER TARGETA {expelledWarning.priorCardCode || 'VERMELLA'}</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Button onClick={() => setExpelledWarning(null)} style={{ padding: '14px 18px', fontSize: 18, fontWeight: 900 }}>Tanca l’avís</Button>
            </div>
          </div>
        </div>
      ) : null}
      {error ? <div style={{ marginTop: 10, color: '#b91c1c', fontWeight: 800 }}>{error}</div> : null}

      {canTable && bannerAlerts.length ? (
        <div style={{ marginTop: 12, position: 'sticky', top: 8, zIndex: 40 }}>
          <PersistentAlerts
            alerts={bannerAlerts}
            onAck={(eventId) =>
              toggleAlertAck(eventId, true).catch((e) => props.addToast({ text: String(e?.message || e), kind: 'danger' }))
            }
          />
        </div>
      ) : null}

      <div style={{ height: 12 }} />

      <NavTabs role={props.session.actor.role} tab={tab} setTab={setTab} />

      <div style={{ height: 12 }} />

      {tab === 'Arbitrar' ? <RefereeArbitra disabled={comp?.status !== 'open'} addEvent={addEvent} addToast={props.addToast} events={events} onExpelledWarning={setExpelledWarning} /> : null}
      {tab === 'Catàleg' ? <CatalogPicker disabled={comp?.status !== 'open'} addEvent={addEvent} addToast={props.addToast} events={events} onExpelledWarning={setExpelledWarning} /> : null}
      {tab === 'Registre' ? <RefereeLog session={props.session} events={events} addToast={props.addToast} /> : null}

      {tab === 'Entrades' ? (
        <TableEntries
          canTable={canTable}
          events={events}
          checks={checks}
          onToggle={(id, v) => toggleCheck(id, v).catch((e) => props.addToast({ text: String(e?.message || e), kind: 'danger' }))}
        />
      ) : null}

      {tab === 'Dorsals' ? (
        <TableDorsals
          canTable={canTable}
          events={events}
          completions={completions}
          onTogglePenalty={(id, v) =>
            togglePenaltyCompletion(id, v).catch((e) => props.addToast({ text: String(e?.message || e), kind: 'danger' }))
          }
        />
      ) : null}

      {tab === 'Estat' ? <TableStatus actors={actors} status={status} /> : null}

      {tab === 'Participants' ? (
        <Modal
          open={true}
          title={`Participants · ${comp?.name || props.session.competition.name}`}
          onClose={() => setTab('Entrades')}
          maxWidth="min(1280px, 100%)"
        >
          <TableParticipants
            canEdit={canTable}
            competitionOpen={comp?.status === 'open'}
            participants={participants}
            summaries={dorsalSummaries}
            competitionName={comp?.name || props.session.competition.name}
            competitionCode={comp?.code || props.session.competition.code}
            onBack={() => setTab('Entrades')}
            onSave={(row) => upsertParticipant(row)}
            addToast={props.addToast}
          />
        </Modal>
      ) : null}

      {tab === 'Exporta' ? (
        <Exports
          session={props.session}
          competitionName={comp?.name || ''}
          competitionCode={comp?.code || ''}
          events={events}
          checks={checks}
          completions={completions}
          snapshot={snapshot}
          participants={participants}
          summaries={dorsalSummaries}
          addToast={props.addToast}
        />
      ) : null}

      {tab === 'Manteniment' && props.session.actor.role === 'principal' ? (
        <PrincipalMaintenance
          session={props.session}
          snapshot={snapshot}
          addToast={props.addToast}
          reloadCompetition={reload}
        />
      ) : null}

      <PrincipalAccessModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        competition={principalComp}
        links={principalLinks}
        qrPrincipal={qrPrincipal}
        qrRef={qrRef}
        qrTable={qrTable}
        addToast={props.addToast}
      />
    </div>
  )
}

function PrincipalAccessModal(props: {
  open: boolean
  onClose: () => void
  competition: StoredPrincipalCompetition | null
  links: { principalLink: string; refereeLink: string; tableLink: string } | null
  qrPrincipal: string
  qrRef: string
  qrTable: string
  addToast: (t: { text: string; kind?: 'info' | 'warn' | 'danger' }) => void
}) {
  if (!props.competition || !props.links) return null

  const handleCopy = async (value: string, okText: string, errText: string) => {
    if (await copyText(value)) props.addToast({ text: okText, kind: 'info' })
    else props.addToast({ text: errText, kind: 'danger' })
  }

  return (
    <Modal open={props.open} title="QR i accessos de la competició" onClose={props.onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ background: '#b91c1c', color: '#fff', borderRadius: 12, padding: '10px 12px', fontWeight: 900, lineHeight: 1.35 }}>
          Atenció: els accessos amb QR només estan preparats per funcionar amb <b>CHROME</b> (Android) o <b>SAFARI</b> (iOS).
        </div>
        <div style={{ fontWeight: 900 }}>Nom de la competició: {props.competition.name}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill>Codi de la competició: {props.competition!.code}</Pill>
          <Pill>{props.competition.status === 'open' ? 'OBERTA' : 'TANCADA'}</Pill>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {props.links.principalLink ? (
            <div style={{ border: '1px solid #c8dcc7', borderRadius: 12, padding: 10, display: 'grid', gap: 7, background: '#fbfefb', alignContent: 'start' }}>
              <div style={{ fontWeight: 900 }}>Accés àrbitre principal</div>
              {props.qrPrincipal ? <img src={props.qrPrincipal} alt="QR principal" style={{ width: 132, maxWidth: '100%', border: '1px solid #c8dcc7', borderRadius: 12, justifySelf: 'center' }} /> : null}
              <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflowX: 'auto', color: '#4b5563', lineHeight: 1.2 }}>{props.links.principalLink}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="secondary" onClick={() => { void handleCopy(props.links!.principalLink, 'Enllaç del principal copiat.', 'No s’ha pogut copiar l’enllaç del principal.') }}>Copia enllaç</Button>
              </div>
            </div>
          ) : null}

          <div style={{ border: '1px solid #c8dcc7', borderRadius: 12, padding: 10, display: 'grid', gap: 7, background: '#fbfefb', alignContent: 'start' }}>
            <div style={{ fontWeight: 900 }}>Accés àrbitres de recorregut</div>
            {props.qrRef ? <img src={props.qrRef} alt="QR recorregut" style={{ width: 132, maxWidth: '100%', border: '1px solid #c8dcc7', borderRadius: 12, justifySelf: 'center' }} /> : null}
            <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflowX: 'auto', color: '#4b5563', lineHeight: 1.2 }}>{props.links.refereeLink}</div>
            <Pill>Token: {props.competition!.joinTokens?.referee}</Pill>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => { void handleCopy(props.links!.refereeLink, 'Enllaç de recorregut copiat.', 'No s’ha pogut copiar l’enllaç de recorregut.') }}>Copia enllaç</Button>
              <Button variant="secondary" onClick={() => { void handleCopy(props.competition!.joinTokens!.referee, 'Token de recorregut copiat.', 'No s’ha pogut copiar el token de recorregut.') }}>Copia token</Button>
            </div>
          </div>

          <div style={{ border: '1px solid #c8dcc7', borderRadius: 12, padding: 10, display: 'grid', gap: 7, background: '#fbfefb', alignContent: 'start' }}>
            <div style={{ fontWeight: 900 }}>Accés àrbitre de taula</div>
            {props.qrTable ? <img src={props.qrTable} alt="QR taula" style={{ width: 132, maxWidth: '100%', border: '1px solid #c8dcc7', borderRadius: 12, justifySelf: 'center' }} /> : null}
            <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflowX: 'auto', color: '#4b5563', lineHeight: 1.2 }}>{props.links.tableLink}</div>
            <Pill>Token: {props.competition!.joinTokens?.table}</Pill>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => { void handleCopy(props.links!.tableLink, 'Enllaç de taula copiat.', 'No s’ha pogut copiar l’enllaç de taula.') }}>Copia enllaç</Button>
              <Button variant="secondary" onClick={() => { void handleCopy(props.competition!.joinTokens!.table, 'Token de taula copiat.', 'No s’ha pogut copiar el token de taula.') }}>Copia token</Button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill>Codi manual: {props.competition!.code}</Pill>
          <Button variant="secondary" onClick={() => { void handleCopy(props.competition!.code, 'Codi manual copiat.', 'No s’ha pogut copiar el codi manual.') }}>Copia el codi</Button>
        </div>
      </div>
    </Modal>
  )
}

function PersistentAlerts(props: { alerts: AlertItem[]; onAck: (eventId: string) => void }) {
  return (
    <div style={{ display: 'grid', gap: 8, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.08))' }}>
      {props.alerts.map((a) => (
        <div
          key={a.id}
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 12,
            borderRadius: 12,
            border: `2px solid ${a.kind === 'danger' ? '#dc2626' : a.kind === 'success' ? '#16a34a' : a.kind === 'withdraw' ? '#7c3aed' : '#f59e0b'}`,
            background: a.kind === 'danger' ? '#fee2e2' : a.kind === 'success' ? '#dcfce7' : a.kind === 'withdraw' ? '#f3e8ff' : '#fef3c7'
          }}
        >
          <div style={{ fontWeight: 900 }}>{a.text}</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, whiteSpace: 'nowrap' }}>
            <input type="checkbox" onChange={() => props.onAck(a.eventId)} />
            Vist
          </label>
        </div>
      ))}
    </div>
  )
}

function NavTabs(props: { role: 'referee' | 'table' | 'principal'; tab: string; setTab: (t: string) => void }) {
  if (props.role === 'referee') {
    const tabs = ['Arbitrar', 'Catàleg', 'Registre']
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <Button key={t} variant={props.tab === t ? 'primary' : 'secondary'} onClick={() => props.setTab(t)}>
            {t}
          </Button>
        ))}
      </div>
    )
  }

  const controlTabs = props.role === 'principal'
    ? ['Entrades', 'Dorsals', 'Estat', 'Participants', 'Exporta', 'Manteniment']
    : ['Entrades', 'Dorsals', 'Estat', 'Participants', 'Exporta']
  const arbitrationTabs = ['Arbitrar', 'Catàleg', 'Registre']

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <BandTitle>CONTROL COMPETICIÓ</BandTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {controlTabs.map((t) => (
            <Button key={t} variant={props.tab === t ? 'primary' : 'secondary'} onClick={() => props.setTab(t)}>
              {t}
            </Button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <BandTitle>ARBITRATGE</BandTitle>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {arbitrationTabs.map((t) => (
            <Button key={t} variant={props.tab === t ? 'primary' : 'secondary'} onClick={() => props.setTab(t)}>
              {t}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

function RefereeArbitra(props: { disabled: boolean; addEvent: any; addToast: (t: { text: string; kind?: 'info' | 'warn' | 'danger' }) => void; events: any[]; onExpelledWarning: (w: ExpelledWarning | null) => void }) {
  const [isListening, setIsListening] = useState(false)
  const [spoken, setSpoken] = useState('')
  const [partial, setPartial] = useState('')
  const [selected, setSelected] = useState<Fault | null>(null)
  const [candidates, setCandidates] = useState<{ fault: Fault; score: number }[]>([])
  const [speakEnabled, setSpeakEnabled] = useState(true)
  const voskRef = useRef<VoskController | null>(null)
  const [dorsalModal, setDorsalModal] = useState(false)
  const [dorsal, setDorsal] = useState('')
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [engineLabel, setEngineLabel] = useState('sense inicialitzar')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceUri, setSelectedVoiceUri] = useState<string>(AUTO_VOICE)
  const [assistModal, setAssistModal] = useState(false)
  const [assistBib, setAssistBib] = useState('')
  const [injuredBib, setInjuredBib] = useState('')
  const [assistDigits, setAssistDigits] = useState('')
  const [withdrawModal, setWithdrawModal] = useState(false)
  const [withdrawBib, setWithdrawBib] = useState('')
  const dorsalInputRef = useRef<HTMLInputElement | null>(null)
  const assistBibInputRef = useRef<HTMLInputElement | null>(null)
  const withdrawBibInputRef = useRef<HTMLInputElement | null>(null)
  const lastPickRef = useRef<{ id: string; at: number } | null>(null)
  const lastNoMatchRef = useRef<{ text: string; at: number } | null>(null)
  const startToastShownRef = useRef(false)

  useEffect(() => {
    const update = () => setVoices(loadVoices())
    update()
    window.speechSynthesis?.getVoices?.()
    window.speechSynthesis?.addEventListener?.('voiceschanged', update)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', update)
  }, [])

  useEffect(() => {
    return () => {
      try { voskRef.current?.stop() } catch {}
      try { window.speechSynthesis?.cancel() } catch {}
    }
  }, [])

  const activeVoice = useMemo(() => preferredVoice(voices, selectedVoiceUri), [voices, selectedVoiceUri])
  const hasCatalanVoice = useMemo(() => voices.some((v) => isCatalanVoice(v)), [voices])

  useEffect(() => {
    if (!selected) return
    if (dorsalModal) return
    setDorsal('')
    setDorsalModal(true)
    window.setTimeout(() => dorsalInputRef.current?.focus(), 60)
  }, [selected, dorsalModal])

  const openAssistModal = () => {
    stop()
    setCandidates([])
    setSelected(null)
    setDorsal('')
    setDorsalModal(false)
    setAssistBib('')
    setInjuredBib('')
    setAssistDigits('')
    setAssistModal(true)
    window.setTimeout(() => assistBibInputRef.current?.focus(), 60)
  }


  const openWithdrawModal = () => {
    stop()
    setCandidates([])
    setSelected(null)
    setDorsal('')
    setDorsalModal(false)
    setWithdrawBib('')
    setWithdrawModal(true)
    window.setTimeout(() => withdrawBibInputRef.current?.focus(), 60)
  }

  const start = async () => {
    if (props.disabled) {
      props.addToast({ text: 'Competició tancada: no es poden afegir faltes.', kind: 'warn' })
      return
    }
    if (!voskRef.current) voskRef.current = new VoskController()
    primeSpeechSynthesis()
    startToastShownRef.current = false
    setEngineState('loading')
    setIsListening(true)
    await voskRef.current.start('/vosk/model-ca.tar.gz', {
      onPartial: (t) => setPartial(t),
      onResult: (t) => {
        setPartial('')
        setSpoken(t)
        handleText(t)
      },
      onLoad: (engine) => {
        setEngineState('ready')
        setEngineLabel(engine === 'native' ? 'reconeixement del navegador' : 'VOSK local')
        if (!startToastShownRef.current) {
          props.addToast({ text: engine === 'native' ? 'Micròfon actiu amb el reconeixement del navegador.' : 'Model VOSK carregat. Ja pots dictar la falta.', kind: 'info' })
          startToastShownRef.current = true
        }
      },
      onError: (m) => {
        const msg = String(m || '')
        if (/no-speech/i.test(msg)) return
        props.addToast({ text: msg, kind: 'danger' })
        setEngineState('idle')
        setIsListening(false)
      }
    }, { lang: 'ca-ES' })
  }

  const stop = () => {
    startToastShownRef.current = false
    setIsListening(false)
    setEngineState('idle')
    setEngineLabel('aturat')
    voskRef.current?.stop()
  }

  const handleText = (t: string) => {
    const after = commandTextFromSpeech(t)
    if (!t.trim()) return
    if (!after) return
    if (isGreenAssistCommand(t)) {
      openAssistModal()
      return
    }
    const matches = bestMatchesFromSpeech(t, 6)
    if (!matches.length) {
      const normalized = tokenize(after || t).join(' ')
      const now = Date.now()
      const last = lastNoMatchRef.current
      if (!last || last.text !== normalized || now - last.at > 2500) {
        props.addToast({ text: normalized ? `No he trobat cap falta per a: ${normalized}` : 'No he trobat cap falta.', kind: 'warn' })
        lastNoMatchRef.current = { text: normalized, at: now }
      }
      return
    }
    stop()
    if (shouldAutoSelect(matches)) {
      selectFault(matches[0].fault)
      return
    }
    if (speakEnabled) speakWithReplay('He trobat diverses possibles faltes.', voices, selectedVoiceUri)
    setCandidates(matches)
    setSelected(null)
  }

  const selectFault = (f: Fault) => {
    primeSpeechSynthesis()
    stop()
    setSelected(f)
    setCandidates([])
    setDorsal('')
    setDorsalModal(true)
    if (speakEnabled) window.setTimeout(() => speakWithReplay(`${speakFaultLabel(f)}. ${f.desc}`, voices, selectedVoiceUri), 80)
    window.setTimeout(() => dorsalInputRef.current?.focus(), 60)
  }

  const submitDorsal = async () => {
    const bib = Number(dorsal)
    if (!Number.isFinite(bib) || bib <= 0) {
      props.addToast({ text: 'Dorsal incorrecte', kind: 'danger' })
      return
    }
    if (!selected) return

    try {
      const priorDsq = dsqStatusForBib(props.events as any, bib)
      const r = await props.addEvent({
        bib,
        faultCode: selected.id,
        faultText: selected.desc,
        color: selected.c,
        category: selected.t,
        capturedAt: new Date().toISOString(),
        eventType: 'fault',
      })
      props.addToast({ text: r.queued ? `Enregistrat (PENDENT): ${bib}-${selected.id}` : `Enregistrat: ${bib}-${selected.id}`, kind: r.queued ? 'warn' : 'info' })
      if (priorDsq) {
        props.onExpelledWarning({ bib, priorCardCode: priorDsq.priorCardCode })
      }
      setDorsalModal(false)
      setDorsal('')
      setSelected(null)
      setCandidates([])
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e), kind: 'danger' })
    }
  }

  const submitAssist = async () => {
    const bib = Number(assistBib)
    const target = Number(injuredBib)
    const durationSeconds = parseAssistDigitsToSeconds(assistDigits)
    if (!Number.isFinite(bib) || bib <= 0 || !Number.isFinite(target) || target <= 0) {
      props.addToast({ text: 'Dorsals incorrectes per a la targeta verda.', kind: 'danger' })
      return
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      props.addToast({ text: 'Indica un temps d’auxili superior a zero.', kind: 'danger' })
      return
    }

    try {
      const r = await props.addEvent({
        bib,
        faultCode: 'VERD',
        faultText: `Ha prestat auxili a dorsal ${target} durant ${formatDurationSeconds(durationSeconds)} que se li han de descomptar del total`,
        color: 'A',
        category: 'R',
        capturedAt: new Date().toISOString(),
        eventType: 'assist',
        assistTargetBib: target,
        assistDurationSeconds: durationSeconds,
      })
      props.addToast({ text: r.queued ? `Targeta verda pendent: ${bib} → ${target}` : `Targeta verda enregistrada: ${bib} → ${target}`, kind: r.queued ? 'warn' : 'info' })
      setAssistDigits('')
      setAssistModal(false)
      setDorsal('')
      setSelected(null)
      setCandidates([])
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e), kind: 'danger' })
    }
  }


  const submitWithdraw = async () => {
    const bib = Number(withdrawBib)
    if (!Number.isFinite(bib) || bib <= 0) {
      props.addToast({ text: 'Dorsal incorrecte per marcar l’abandó.', kind: 'danger' })
      return
    }
    try {
      const r = await props.addEvent({
        bib,
        faultCode: 'ABD',
        faultText: 'Abandó del/de la competidor/a',
        color: 'A',
        category: 'C',
        capturedAt: new Date().toISOString(),
        eventType: 'withdraw',
      })
      props.addToast({ text: r.queued ? `Abandó pendent: dorsal ${bib}` : `Abandó comunicat: dorsal ${bib}`, kind: r.queued ? 'warn' : 'info' })
      setWithdrawModal(false)
      setDorsal('')
      setSelected(null)
      setDorsal('')
      setSelected(null)
      setDorsal('')
      setSelected(null)
      setCandidates([])
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e), kind: 'danger' })
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="Arbitrar per veu">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={start} disabled={isListening || props.disabled}>{engineState === 'loading' ? 'Carregant…' : 'Activa micròfon'}</Button>
          <Button variant="secondary" onClick={stop} disabled={!isListening}>Atura</Button>
          <Button variant="secondary" onClick={openAssistModal} disabled={props.disabled} style={{ background: '#dcfce7', borderColor: '#16a34a', color: '#166534' }}>Targeta verda / auxili</Button>
          <Button variant="secondary" onClick={openWithdrawModal} disabled={props.disabled} style={{ background: '#f3e8ff', borderColor: '#7c3aed', color: '#6d28d9' }}>Abandona</Button>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800 }}>
            <input type="checkbox" checked={speakEnabled} onChange={(e) => setSpeakEnabled(e.target.checked)} />
            Llegeix la falta en veu alta
          </label>

          <Pill>Paraula clau obligatòria: “atenció”</Pill>
        </div>

        <Divider />

        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ color: '#6b7280', fontWeight: 700, fontSize: 13, display: 'grid', gap: 6 }}>
            <div>
              {partial ? `… ${partial}` : spoken ? `Últim: ${spoken}` : 'Parla i digues “atenció …” i, tot seguit, la falta. Per a targeta verda, digues “atenció verda” o “atenció targeta verda”.'}
            </div>
            <div>
              Estat del motor: {engineState === 'loading' ? 'carregant micròfon/reconeixement' : engineState === 'ready' ? 'preparat' : 'aturat'}
            </div>
            <div>
              Motor actiu: <b>{engineLabel}</b>
            </div>
            <div>
              Veu de lectura: <b>{activeVoice ? `${activeVoice.name} (${activeVoice.lang})` : 'automàtica amb idioma ca-ES'}</b>
            </div>
            {!hasCatalanVoice ? <div style={{ color: '#92400e' }}>No s’ha detectat cap veu catalana al navegador. Es força l’idioma ca-ES, però la pronunciació pot no ser bona.</div> : null}
          </div>

          {voices.length ? (
            <div style={{ display: 'grid', gap: 6, maxWidth: 440 }}>
              <label style={{ fontWeight: 800, fontSize: 13 }}>Tria la veu de lectura</label>
              <select
                value={selectedVoiceUri}
                onChange={(e) => setSelectedVoiceUri(e.target.value)}
                style={{ border: '1px solid #c8dcc7', borderRadius: 10, padding: '10px 12px', fontWeight: 700, background: '#fff' }}
              >
                <option value={AUTO_VOICE}>Automàtica (força ca-ES)</option>
                {voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </Card>

      <Modal
        open={candidates.length > 0}
        title="He trobat diverses possibles faltes"
        onClose={() => setCandidates([])}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setCandidates([])}>Tanca</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {candidates.map((m) => (
            <button
              key={m.fault.id}
              type="button"
              onClick={() => selectFault(m.fault)}
              onTouchEnd={(e) => { e.preventDefault(); selectFault(m.fault) }}
              style={{
                textAlign: 'left',
                padding: 10,
                borderRadius: 12,
                border: `2px solid ${colorBorder(m.fault.c)}`,
                background: colorBg(m.fault.c),
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 900 }}>{m.fault.id}</span>
                <span style={{ fontWeight: 800 }}>{m.fault.desc}</span>
                <span style={{ color: '#6b7280', fontWeight: 700, fontSize: 12 }}>score {m.score}</span>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={dorsalModal}
        title="Assigna dorsal"
        onClose={() => { setDorsalModal(false); setDorsal(''); setSelected(null); setCandidates([]) }}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setDorsalModal(false); setDorsal(''); setSelected(null); setCandidates([]) }}>Cancel·la</Button>
            <Button onClick={submitDorsal} disabled={!selected || dorsal.trim().length === 0}>Envia</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {selected ? <FaultBanner fault={selected} compact /> : null}
          <Input
            value={dorsal}
            onChange={setDorsal}
            placeholder="Dorsal"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            autoFocus
            inputRef={dorsalInputRef}
            pattern="[0-9]*"
            enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === 'Enter') submitDorsal() }}
            style={{ background: '#ffffff', fontWeight: 800 }}
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Consell: tecleja el dorsal per evitar errors.</div>
        </div>
      </Modal>

      <Modal
        open={assistModal}
        title="Targeta verda / auxili"
        onClose={() => setAssistModal(false)}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setAssistModal(false)}>Cancel·la</Button>
            <Button onClick={submitAssist} disabled={!assistBib.trim() || !injuredBib.trim() || parseAssistDigitsToSeconds(assistDigits) <= 0}>Envia</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 10, borderRadius: 12, border: '2px solid #16a34a', background: '#dcfce7', fontWeight: 900 }}>VERDA · Auxili prestat a un altre corredor</div>
          <Input
            value={assistBib}
            onChange={setAssistBib}
            placeholder="Dorsal de l’auxiliador"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            inputRef={assistBibInputRef}
            pattern="[0-9]*"
          />
          <Input
            value={formatAssistDigits(assistDigits)}
            onChange={(v) => setAssistDigits(sanitizeAssistDigits(v))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { submitAssist(); return }
              if (e.key === 'Backspace') { e.preventDefault(); setAssistDigits((curr) => curr.slice(0, -1)); return }
              if (e.key === 'Delete') { e.preventDefault(); setAssistDigits(''); return }
              if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setAssistDigits((curr) => nextAssistDigitsFromKey(curr, e.key)); return }
              if (e.key === ':' || e.key === 'Tab' || e.key.startsWith('Arrow')) return
              e.preventDefault()
            }}
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData('text')
              setAssistDigits(sanitizeAssistDigits(pasted))
            }}
            placeholder="Temps d’auxili (mm:ss)"
            inputMode="numeric"
            type="text"
            autoComplete="off"
            pattern="[0-9]*"
            enterKeyHint="done"
            maxLength={5}
            style={{ fontWeight: 800, letterSpacing: 1, textAlign: 'center' }}
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Escriu directament <b>4 xifres</b> (<b>mmss</b>) i el símbol <b>:</b> es mantindrà fix. Exemple: <b>0125</b> = <b>01:25</b>.</div>
          <Input
            value={injuredBib}
            onChange={setInjuredBib}
            placeholder="Dorsal del lesionat auxiliat"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            pattern="[0-9]*"
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Es comunicarà a Taula i Principal perquè descomptin aquest temps del total del dorsal auxiliador.</div>
        </div>
      </Modal>
      <Modal
        open={withdrawModal}
        title="Abandó competidor/a"
        onClose={() => setWithdrawModal(false)}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setWithdrawModal(false)}>Cancel·la</Button>
            <Button onClick={submitWithdraw} disabled={!withdrawBib.trim()}>Envia</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 10, borderRadius: 12, border: '2px solid #7c3aed', background: '#f3e8ff', fontWeight: 900 }}>LILA · Abandó del/de la competidor/a</div>
          <Input
            value={withdrawBib}
            onChange={setWithdrawBib}
            placeholder="Dorsal que abandona"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            inputRef={withdrawBibInputRef}
            pattern="[0-9]*"
            enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === 'Enter') submitWithdraw() }}
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Es comunicarà a Taula i Principal perquè consti com a dorsal retirat.</div>
        </div>
      </Modal>
    </div>
  )
}

function CatalogPicker(props: { disabled: boolean; addEvent: any; addToast: (t: { text: string; kind?: 'info' | 'warn' | 'danger' }) => void; events: any[]; onExpelledWarning: (w: ExpelledWarning | null) => void }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'T' | 'R' | 'C'>('ALL')
  const [sortMode, setSortMode] = useState<'TYPE' | 'COLOR'>('TYPE')
  const [speakEnabled, setSpeakEnabled] = useState(true)
  const [selected, setSelected] = useState<Fault | null>(null)
  const [dorsalModal, setDorsalModal] = useState(false)
  const [dorsal, setDorsal] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceUri] = useState<string>(AUTO_VOICE)
  const [assistModal, setAssistModal] = useState(false)
  const [assistBib, setAssistBib] = useState('')
  const [injuredBib, setInjuredBib] = useState('')
  const [assistDigits, setAssistDigits] = useState('')
  const [withdrawModal, setWithdrawModal] = useState(false)
  const [withdrawBib, setWithdrawBib] = useState('')
  const dorsalInputRef = useRef<HTMLInputElement | null>(null)
  const assistBibInputRef = useRef<HTMLInputElement | null>(null)
  const withdrawBibInputRef = useRef<HTMLInputElement | null>(null)
  const lastPickRef = useRef<{ id: string; at: number } | null>(null)

  useEffect(() => {
    const update = () => setVoices(loadVoices())
    update()
    window.speechSynthesis?.getVoices?.()
    window.speechSynthesis?.addEventListener?.('voiceschanged', update)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', update)
  }, [])

  const baseList = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return FALTES.filter((f) => {
      if (filter !== 'ALL' && f.t !== filter) return false
      if (!qq) return true
      return f.id.toLowerCase().includes(qq) || f.desc.toLowerCase().includes(qq) || f.k.some((k) => k.toLowerCase().includes(qq))
    })
  }, [q, filter])

  const list = useMemo(() => {
    if (filter === 'ALL') return sortMode === 'TYPE' ? sortByTypeThenColor(baseList) : sortByColorThenType(baseList)
    return sortByTypeThenColor(baseList)
  }, [baseList, filter, sortMode])

  const groups = useMemo(() => {
    if (filter !== 'ALL') return [{ key: filter, title: categoryLabel(filter), items: list }]
    return groupedFaults(list, sortMode)
  }, [list, filter, sortMode])

  useEffect(() => {
    if (!selected) return
    if (dorsalModal) return
    setDorsal('')
    setDorsalModal(true)
    window.setTimeout(() => dorsalInputRef.current?.focus(), 60)
  }, [selected, dorsalModal])

  const openAssistModal = () => {
    if (props.disabled) {
      props.addToast({ text: 'Competició tancada: no es poden afegir faltes.', kind: 'warn' })
      return
    }
    setSelected(null)
    setDorsal('')
    setDorsalModal(false)
    setAssistBib('')
    setInjuredBib('')
    setAssistDigits('')
    setAssistModal(true)
    window.setTimeout(() => assistBibInputRef.current?.focus(), 60)
  }

  const openWithdrawModal = () => {
    if (props.disabled) {
      props.addToast({ text: 'Competició tancada: no es poden afegir faltes.', kind: 'warn' })
      return
    }
    setSelected(null)
    setDorsal('')
    setDorsalModal(false)
    setWithdrawBib('')
    setWithdrawModal(true)
    window.setTimeout(() => withdrawBibInputRef.current?.focus(), 60)
  }

  const submitAssist = async () => {
    const bib = Number(assistBib)
    const target = Number(injuredBib)
    const durationSeconds = parseAssistDigitsToSeconds(assistDigits)
    if (!Number.isFinite(bib) || bib <= 0 || !Number.isFinite(target) || target <= 0) {
      props.addToast({ text: 'Dorsals incorrectes per a la targeta verda.', kind: 'danger' })
      return
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      props.addToast({ text: 'Indica un temps d’auxili superior a zero.', kind: 'danger' })
      return
    }

    try {
      const r = await props.addEvent({
        bib,
        faultCode: 'VERD',
        faultText: `Ha prestat auxili a dorsal ${target} durant ${formatDurationSeconds(durationSeconds)} que se li han de descomptar del total`,
        color: 'A',
        category: 'R',
        capturedAt: new Date().toISOString(),
        eventType: 'assist',
        assistTargetBib: target,
        assistDurationSeconds: durationSeconds,
      })
      props.addToast({ text: r.queued ? `Targeta verda pendent: ${bib} → ${target}` : `Targeta verda enregistrada: ${bib} → ${target}`, kind: r.queued ? 'warn' : 'info' })
      setAssistModal(false)
      setAssistDigits('')
      setDorsal('')
      setSelected(null)
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e), kind: 'danger' })
    }
  }

  const submitWithdraw = async () => {
    const bib = Number(withdrawBib)
    if (!Number.isFinite(bib) || bib <= 0) {
      props.addToast({ text: 'Dorsal incorrecte per marcar l’abandó.', kind: 'danger' })
      return
    }
    try {
      const r = await props.addEvent({
        bib,
        faultCode: 'ABD',
        faultText: 'Abandó del/de la competidor/a',
        color: 'A',
        category: 'C',
        capturedAt: new Date().toISOString(),
        eventType: 'withdraw',
      })
      props.addToast({ text: r.queued ? `Abandó pendent: dorsal ${bib}` : `Abandó comunicat: dorsal ${bib}`, kind: r.queued ? 'warn' : 'info' })
      setWithdrawModal(false)
      setDorsal('')
      setSelected(null)
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e), kind: 'danger' })
    }
  }

  const pick = (f: Fault) => {
    primeSpeechSynthesis()
    const now = Date.now()
    const last = lastPickRef.current
    if (last && last.id === f.id && now - last.at < 350) return
    lastPickRef.current = { id: f.id, at: now }
    if (props.disabled) {
      props.addToast({ text: 'Competició tancada: no es poden afegir faltes.', kind: 'warn' })
      return
    }
    setSelected(f)
    setDorsal('')
    setDorsalModal(true)
    if (speakEnabled) window.setTimeout(() => speakWithReplay(`${speakFaultLabel(f)}. ${f.desc}`, voices, selectedVoiceUri), 80)
    window.setTimeout(() => dorsalInputRef.current?.focus(), 60)
  }

  const submit = async () => {
    const bib = Number(dorsal)
    if (!selected) return
    if (!Number.isFinite(bib) || bib <= 0) {
      props.addToast({ text: 'Dorsal incorrecte', kind: 'danger' })
      return
    }
    try {
      const priorDsq = dsqStatusForBib(props.events as any, bib)
      const r = await props.addEvent({
        bib,
        faultCode: selected.id,
        faultText: selected.desc,
        color: selected.c,
        category: selected.t,
        capturedAt: new Date().toISOString()
      })
      props.addToast({ text: r.queued ? `Enregistrat (PENDENT): ${bib}-${selected.id}` : `Enregistrat: ${bib}-${selected.id}`, kind: r.queued ? 'warn' : 'info' })
      if (priorDsq) {
        props.onExpelledWarning({ bib, priorCardCode: priorDsq.priorCardCode })
      }
      setDorsalModal(false)
      setDorsal('')
      setSelected(null)
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e), kind: 'danger' })
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="Catàleg de faltes">
        <div style={{ display: 'grid', gap: 10 }}>
          <Input value={q} onChange={setQ} placeholder="Cerca (codi, text o paraula clau)" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} translate="no">
            <Button variant={filter === 'ALL' ? 'primary' : 'secondary'} onClick={() => setFilter('ALL')}>Totes</Button>
            <Button variant={filter === 'T' ? 'primary' : 'secondary'} onClick={() => setFilter('T')}>Tècnica</Button>
            <Button variant={filter === 'R' ? 'primary' : 'secondary'} onClick={() => setFilter('R')}>Reglament</Button>
            <Button variant={filter === 'C' ? 'primary' : 'secondary'} onClick={() => setFilter('C')}>Conducta</Button>
            <Button variant="secondary" onClick={openAssistModal} disabled={props.disabled} style={{ background: '#dcfce7', borderColor: '#16a34a', color: '#166534' }}>Targeta verda / auxili</Button>
            <Button variant="secondary" onClick={openWithdrawModal} disabled={props.disabled} style={{ background: '#f3e8ff', borderColor: '#7c3aed', color: '#6d28d9' }}>Abandona</Button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800 }}>
              <input type="checkbox" checked={speakEnabled} onChange={(e) => setSpeakEnabled(e.target.checked)} />
              Llegeix la falta en veu alta
            </label>
            {filter === 'ALL' ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant={sortMode === 'TYPE' ? 'primary' : 'secondary'} onClick={() => setSortMode('TYPE')}>
                  Ordena per tipus
                </Button>
                <Button variant={sortMode === 'COLOR' ? 'primary' : 'secondary'} onClick={() => setSortMode('COLOR')}>
                  Ordena per color
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title={`Resultats (${list.length})`}>
        <div style={{ display: 'grid', gap: 12 }}>
          {groups.map((group) => (
            <div key={group.key} style={{ display: 'grid', gap: 8 }}>
              {filter === 'ALL' ? (
                <div style={{ fontWeight: 900, fontSize: 15, borderBottom: '2px solid #111827', paddingBottom: 4 }}>{group.title}</div>
              ) : null}
              {group.items.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => pick(f)}
                  onTouchEnd={(e) => { e.preventDefault(); pick(f) }}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    borderRadius: 12,
                    border: `2px solid ${colorBorder(f.c)}`,
                    background: colorBg(f.c),
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 900 }}>{f.id}</span>
                    <span style={{ fontWeight: 800 }}>{f.desc}</span>
                    <Pill>{categoryLabel(f.t)}</Pill>
                    <Pill bg={colorBg(f.c)}>{colorLabel(f.c)}</Pill>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={dorsalModal}
        title="Assigna dorsal"
        onClose={() => { setDorsalModal(false); setDorsal(''); setSelected(null) }}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setDorsalModal(false); setDorsal(''); setSelected(null) }}>Cancel·la</Button>
            <Button onClick={submit} disabled={!selected || dorsal.trim().length === 0}>Envia</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {selected ? <FaultBanner fault={selected} compact /> : null}
          <Input
            value={dorsal}
            onChange={setDorsal}
            placeholder="Dorsal"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            autoFocus
            inputRef={dorsalInputRef}
            pattern="[0-9]*"
            enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            style={{ background: '#ffffff', fontWeight: 800 }}
          />
        </div>
      </Modal>

      <Modal
        open={assistModal}
        title="Targeta verda / auxili"
        onClose={() => setAssistModal(false)}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setAssistModal(false)}>Cancel·la</Button>
            <Button onClick={submitAssist} disabled={!assistBib.trim() || !injuredBib.trim() || parseAssistDigitsToSeconds(assistDigits) <= 0}>Envia</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 10, borderRadius: 12, border: '2px solid #16a34a', background: '#dcfce7', fontWeight: 900 }}>VERDA · Auxili prestat a un altre corredor</div>
          <Input
            value={assistBib}
            onChange={setAssistBib}
            placeholder="Dorsal de l’auxiliador"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            inputRef={assistBibInputRef}
            pattern="[0-9]*"
          />
          <Input
            value={formatAssistDigits(assistDigits)}
            onChange={(v) => setAssistDigits(sanitizeAssistDigits(v))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { submitAssist(); return }
              if (e.key === 'Backspace') { e.preventDefault(); setAssistDigits((curr) => curr.slice(0, -1)); return }
              if (e.key === 'Delete') { e.preventDefault(); setAssistDigits(''); return }
              if (/^[0-9]$/.test(e.key)) { e.preventDefault(); setAssistDigits((curr) => nextAssistDigitsFromKey(curr, e.key)); return }
              if (e.key === ':' || e.key === 'Tab' || e.key.startsWith('Arrow')) return
              e.preventDefault()
            }}
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData('text')
              setAssistDigits(sanitizeAssistDigits(pasted))
            }}
            placeholder="Temps d’auxili (mm:ss)"
            inputMode="numeric"
            type="text"
            autoComplete="off"
            pattern="[0-9]*"
            enterKeyHint="done"
            maxLength={5}
            style={{ fontWeight: 800, letterSpacing: 1, textAlign: 'center' }}
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Escriu directament <b>4 xifres</b> (<b>mmss</b>) i el símbol <b>:</b> es mantindrà fix. Exemple: <b>0125</b> = <b>01:25</b>.</div>
          <Input
            value={injuredBib}
            onChange={setInjuredBib}
            placeholder="Dorsal del lesionat auxiliat"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            pattern="[0-9]*"
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Es comunicarà a Taula i Principal perquè descomptin aquest temps del total del dorsal auxiliador.</div>
        </div>
      </Modal>
      <Modal
        open={withdrawModal}
        title="Abandó competidor/a"
        onClose={() => setWithdrawModal(false)}
        actions={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setWithdrawModal(false)}>Cancel·la</Button>
            <Button onClick={submitWithdraw} disabled={!withdrawBib.trim()}>Envia</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 10, borderRadius: 12, border: '2px solid #7c3aed', background: '#f3e8ff', fontWeight: 900 }}>LILA · Abandó del/de la competidor/a</div>
          <Input
            value={withdrawBib}
            onChange={setWithdrawBib}
            placeholder="Dorsal que abandona"
            inputMode="numeric"
            type="number"
            min={1}
            step={1}
            autoComplete="off"
            inputRef={withdrawBibInputRef}
            pattern="[0-9]*"
            enterKeyHint="done"
            onKeyDown={(e) => { if (e.key === 'Enter') submitWithdraw() }}
          />
          <div style={{ fontSize: 13, color: '#6b7280' }}>Es comunicarà a Taula i Principal perquè consti com a dorsal retirat.</div>
        </div>
      </Modal>
    </div>
  )
}

function FaultBanner(props: { fault: Fault; compact?: boolean }) {
  return (
    <div
      style={{
        background: colorBg(props.fault.c),
        border: `2px solid ${colorBorder(props.fault.c)}`,
        borderRadius: 16,
        padding: props.compact ? 10 : 14
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: props.compact ? 22 : 32, fontWeight: 900 }}>{props.fault.id}</div>
        <Pill>{categoryLabel(props.fault.t)}</Pill>
        <Pill bg={colorBg(props.fault.c)}>{colorLabel(props.fault.c)}</Pill>
      </div>
      <div style={{ marginTop: 6, fontSize: props.compact ? 15 : 16, fontWeight: 800 }}>{props.fault.desc}</div>
    </div>
  )
}

function RefereeLog(props: { session: Session; events: any[]; addToast: (t: any) => void }) {
  const mine = useMemo(() => props.events.filter((e) => e.actorId === props.session.actor.id), [props.events, props.session.actor.id])

  const exportMine = async () => {
    if (!mine.length) {
      props.addToast({ text: 'No tens cap falta registrada encara.', kind: 'warn' })
      return
    }
    await exportPdfPerReferee(
      {
        competitionName: props.session.competition.name,
        competitionCode: props.session.competition.code,
        refereeName: props.session.actor.name,
        generatedAt: new Date().toISOString()
      },
      mine
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="El meu registre">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button onClick={exportMine}>Exporta PDF (meu)</Button>
        </div>
      </Card>

      <Card title={`Entrades (${mine.length})`}>
        <div style={{ display: 'grid', gap: 4 }}>
          {mine
            .slice()
            .sort((a, b) => (b.capturedAt + b.id).localeCompare(a.capturedAt + a.id))
            .map((e) => (
              <div key={e.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 8 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Pill>{new Date(e.capturedAt).toLocaleTimeString()}</Pill>
                  <Pill>Dorsal {e.bib}</Pill>
                  <span style={{ fontWeight: 900, padding: '2px 8px', borderRadius: 10, border: `1px solid ${eventBadgeBorder(e)}`, background: eventBadgeBg(e) }}>
                    {e.faultCode}
                  </span>
                  <span style={{ fontWeight: 800 }}>{eventSummaryText(e)}</span>
                </div>
              </div>
            ))}
        </div>
      </Card>
    </div>
  )
}

function FixedGridHeader(props: { columns: string; cells: React.ReactNode[] }) {
  return (
    <div style={{ minWidth: 860 }}>
      <div style={{ display: 'grid', gridTemplateColumns: props.columns, gap: 8, fontWeight: 900, fontSize: 12, color: '#374151', padding: '0 10px 8px 10px' }}>
        {props.cells.map((cell, idx) => (
          <div key={idx}>{cell}</div>
        ))}
      </div>
    </div>
  )
}

function TableEntries(props: { canTable: boolean; events: any[]; checks: Record<string, any>; onToggle: (id: string, v: boolean) => void }) {
  const sorted = useMemo(() => props.events.slice().sort((a, b) => (b.capturedAt + b.id).localeCompare(a.capturedAt + a.id)), [props.events])
  const columns = '48px 112px minmax(110px,1.2fr) 108px 96px 92px minmax(260px,2.2fr)'

  return (
    <Card title={`Entrades (${sorted.length})`}>
      <div style={{ overflowX: 'auto' }}>
        <FixedGridHeader columns={columns} cells={['Check', 'Hora', 'Àrbitre', 'Perfil', 'Dorsal', 'Codi', 'Descripció']} />
        <div style={{ display: 'grid', gap: 8, minWidth: 860 }}>
          {sorted.map((e) => {
            const checked = props.checks[e.id]?.checked === true
            return (
              <div
                key={e.id}
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: 12,
                  padding: 10,
                  opacity: checked ? 0.65 : 1,
                  textDecoration: checked ? 'line-through' : 'none',
                  textDecorationStyle: checked ? 'double' : 'solid',
                  background: checked ? '#f9fafb' : '#fbfefb'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 8, alignItems: 'start' }}>
                  <div>{props.canTable ? <input type="checkbox" checked={checked} onChange={(ev) => props.onToggle(e.id, ev.target.checked)} style={{ transform: 'scale(1.2)' }} /> : null}</div>
                  <div>
                    <div style={{ fontWeight: 800 }}>{new Date(e.capturedAt).toLocaleTimeString()}</div>
                    <div style={{ color: '#9ca3af', fontWeight: 700, fontSize: 12 }}>{new Date(e.receivedAt).toLocaleTimeString()}</div>
                  </div>
                  <div style={{ fontWeight: 900, overflowWrap: 'anywhere' }}>{e.actorName}</div>
                  <div style={{ fontWeight: 700 }}>{roleLabel(e.actorRole)}</div>
                  <div style={{ fontWeight: 800 }}>Dorsal {e.bib}</div>
                  <div>
                    <span style={{ display: 'inline-block', fontWeight: 900, padding: '2px 8px', borderRadius: 10, border: `1px solid ${eventBadgeBorder(e)}`, background: eventBadgeBg(e) }}>{e.faultCode}</span>
                  </div>
                  <div style={{ fontWeight: 800, whiteSpace: 'normal' }}>{eventSummaryText(e)}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function TableStatus(props: { actors: Record<string, any>; status: Record<string, any> }) {
  const rows = useMemo(() => {
    const out: { id: string; name: string; role: string; lastSeenAt: string; pending: number }[] = []
    for (const [actorId, st] of Object.entries(props.status || {})) {
      const a = props.actors[actorId]
      if (!a) continue
      out.push({ id: actorId, name: a.name, role: a.role, lastSeenAt: st.lastSeenAt, pending: st.pendingCount })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }, [props.status, props.actors])

  const now = Date.now()
  const columns = 'minmax(180px,1.5fr) 170px 150px 140px 120px'

  return (
    <Card title="Estat d'àrbitres">
      <div style={{ overflowX: 'auto' }}>
        <FixedGridHeader columns={columns} cells={['Nom', 'Perfil', 'Estat', 'Últim senyal', 'Pendents']} />
        <div style={{ display: 'grid', gap: 8, minWidth: 760 }}>
          {rows.map((r) => {
            const ageSec = (now - new Date(r.lastSeenAt).getTime()) / 1000
            const state = ageSec > 55 ? 'desconnectat' : ageSec > 25 ? 'inactiu' : 'connectat'
            const bg = state === 'desconnectat' ? '#fee2e2' : state === 'inactiu' ? '#fef3c7' : '#dcfce7'
            const label = state === 'desconnectat' ? 'DESCONECTAT' : state === 'inactiu' ? 'INACTIU' : 'CONNECTAT'
            return (
              <div key={r.id} style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 10, background: '#fbfefb' }}>
                <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 900 }}>{r.name}</div>
                  <div>{roleLabel(r.role as any)}</div>
                  <div>
                    <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 999, background: bg, fontWeight: 800 }}>{label}</span>
                  </div>
                  <div style={{ fontWeight: 700 }}>{fmtAgo(r.lastSeenAt)}</div>
                  <div><Pill bg={r.pending > 0 ? '#fef3c7' : '#f3f4f6'}>pendents: {r.pending}</Pill></div>
                </div>
              </div>
            )
          })}

          {!rows.length ? <div style={{ color: '#6b7280' }}>Encara no hi ha estat d'àrbitres.</div> : null}
        </div>
      </div>
    </Card>
  )
}

function TableDorsals(props: { canTable: boolean; events: any[]; completions: Record<string, any>; onTogglePenalty: (id: string, v: boolean) => void }) {
  const summaries = useMemo(() => computeByDorsal(props.events, props.completions), [props.events, props.completions])
  const dorsals = useMemo(() => {
    return Array.from(summaries.keys()).sort((a, b) => {
      const sa = summaries.get(a)!
      const sb = summaries.get(b)!
      const pa = sa.dsq && !sa.dsqCompleted ? 0 : sa.penalties.some((p) => !p.completed) ? 1 : 2
      const pb = sb.dsq && !sb.dsqCompleted ? 0 : sb.penalties.some((p) => !p.completed) ? 1 : 2
      return pa - pb || a - b
    })
  }, [summaries])
  const [openBib, setOpenBib] = useState<number | null>(null)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title={`Dorsals (${dorsals.length})`}>
        <div style={{ display: 'grid', gap: 10 }}>
          {dorsals.map((bib) => {
            const s = summaries.get(bib)!
            const pending = s.penalties.filter((p) => !p.completed)
            return (
              <div key={bib} style={{ border: '2px solid #6b7280', borderRadius: 12, padding: 10, background: '#fbfefb' }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ background: '#111827', color: '#ffffff', borderRadius: 10, padding: '8px 10px', fontWeight: 900, letterSpacing: 0.5 }}>
                    DORSAL {bib}
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {s.dsq ? <Pill bg="#fecaca">VERMELLA</Pill> : null}
                    {!s.dsq && s.yellowCount > 0 ? <Pill bg="#fde68a">Grogues: {s.yellowCount}</Pill> : null}
                    {s.yellowCount === 0 && s.whiteRemainder > 0 ? <Pill>Blanques: {s.whiteRemainder}</Pill> : null}
                    {!s.dsq && s.penaltyTotalMinutes > 0 ? <Pill bg="#fef3c7">Penalització: {s.penaltyTotalMinutes} min</Pill> : null}
                    {s.greenAssistCount > 0 ? <Pill bg="#dcfce7">Verdes: {s.greenAssistCount} (-{formatDurationShort(s.greenAssistSeconds)})</Pill> : null}
                    <span style={{ color: '#6b7280', fontWeight: 700, fontSize: 12 }}>{s.lastCapturedAt ? new Date(s.lastCapturedAt).toLocaleTimeString() : ''}</span>
                    <Button variant="secondary" onClick={() => setOpenBib(openBib === bib ? null : bib)}>{openBib === bib ? 'Amaga' : 'Detall'}</Button>
                  </div>

                  {s.dsqReason ? <div style={{ color: '#991b1b', fontWeight: 800 }}>{s.dsqReason}</div> : null}

                  {s.dsq && s.dsqEventId && !s.dsqCompleted ? (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderRadius: 10, background: '#fee2e2', border: '1px solid #fca5a5' }}>
                      {props.canTable ? <input type="checkbox" checked={!!s.dsqCompleted} onChange={(e) => props.onTogglePenalty(s.dsqEventId!, e.target.checked)} style={{ transform: 'scale(1.2)' }} /> : null}
                      <div style={{ fontWeight: 900 }}>Expulsió pendent de fer efectiva</div>
                    </div>
                  ) : null}

                  {pending.length ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 900 }}>Stop&amp;Go / penalitzacions pendents</div>
                      {pending.map((p) => (
                        <div key={p.eventId} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          {props.canTable ? <input type="checkbox" checked={p.completed} onChange={(e) => props.onTogglePenalty(p.eventId, e.target.checked)} style={{ transform: 'scale(1.2)' }} /> : null}
                          <Pill bg="#fef3c7">+{p.minutes} min</Pill>
                          <Pill>{p.triggeredBy}</Pill>
                          <span style={{ color: '#6b7280', fontWeight: 700, fontSize: 12 }}>{new Date(p.capturedAt).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {openBib === bib ? <DorsalDetail bib={bib} events={props.events} /> : null}
                </div>
              </div>
            )
          })}

          {!dorsals.length ? <div style={{ color: '#6b7280' }}>Encara no hi ha faltes.</div> : null}
        </div>
      </Card>
    </div>
  )
}

function DorsalDetail(props: { bib: number; events: any[] }) {
  const list = useMemo(
    () => props.events.filter((e) => e.bib === props.bib).slice().sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id)),
    [props.events, props.bib]
  )

  return (
    <div style={{ marginTop: 6, borderTop: '2px solid #6b7280', paddingTop: 10, display: 'grid', gap: 6 }}>
      <div style={{ fontWeight: 900 }}>Historial dorsal {props.bib}</div>
      {list.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill>{new Date(e.capturedAt).toLocaleTimeString()}</Pill>
          <Pill>{e.actorName}</Pill>
          <span style={{ fontWeight: 900, padding: '2px 8px', borderRadius: 10, border: `1px solid ${eventBadgeBorder(e)}`, background: eventBadgeBg(e) }}>{e.faultCode}</span>
          <span style={{ fontWeight: 800 }}>{eventSummaryText(e)}</span>
        </div>
      ))}
    </div>
  )
}



function TableParticipants(props: {
  canEdit: boolean
  competitionOpen: boolean
  competitionName: string
  competitionCode: string
  participants: Record<string, ParticipantEntry>
  summaries: Map<number, DorsalSummary>
  onBack: () => void
  onSave: (row: {
    bib: number
    noShow?: boolean
    fullName: string
    gender: ParticipantEntry['gender']
    category: ParticipantEntry['category']
    grossTime: string
    penaltyTime: string
    bonusTime: string
  }) => Promise<ParticipantEntry | null>
  addToast: (t: { text: string; kind?: 'info' | 'warn' | 'danger' }) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, ParticipantEntry>>(() => {
    const next: Record<string, ParticipantEntry> = {}
    for (const bib of PARTICIPANT_BIBS) next[String(bib)] = participantRowFromSource(bib, props.participants[String(bib)])
    return next
  })
  const draftsRef = useRef<Record<string, ParticipantEntry>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const timersRef = useRef<Map<number, number>>(new Map())
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleteBib, setDeleteBib] = useState<number | null>(null)

  const buildSeedRows = () => PARTICIPANT_BIBS.map((bib) => draftsRef.current[String(bib)] || participantRowFromSource(bib, props.participants[String(bib)])).filter((row) => !!(row.fullName || row.gender || row.category))

  const downloadParticipantSeed = () => {
    const rows = buildSeedRows().map((row) => ({ bib: row.bib, fullName: sanitizeParticipantName(row.fullName || ''), gender: row.gender || '', category: row.category || '' }))
    if (!rows.length) {
      props.addToast({ text: 'Encara no hi ha participants per exportar.', kind: 'warn' })
      return
    }
    const payload = {
      schema: 'faltesmn-participants-v1',
      competitionName: props.competitionName,
      competitionCode: props.competitionCode,
      exportedAt: new Date().toISOString(),
      rows,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${props.competitionName || 'COMPETICIO'}__participants_${props.competitionCode || 'sense_codi'}.json`.replace(/[^A-Za-z0-9._-]+/g, '_')
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1200)
    props.addToast({ text: 'Fitxer de participants exportat.', kind: 'info' })
  }

  const importParticipantSeed = async (file: File) => {
    if (!props.canEdit || !props.competitionOpen) return
    setImporting(true)
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw)
      const incoming = Array.isArray(parsed) ? parsed : parsed?.rows
      if (!Array.isArray(incoming)) throw new Error('El fitxer no té un format de participants vàlid.')
      let imported = 0
      for (const item of incoming) {
        const bib = Number(item?.bib)
        if (!Number.isFinite(bib) || bib < 1 || bib > 500) continue
        const key = String(bib)
        const current = draftsRef.current[key] || participantRowFromSource(bib, props.participants[key])
        const nextRow: ParticipantEntry = {
          ...current,
          bib,
          fullName: sanitizeParticipantName(String(item?.fullName || '')),
          gender: (PARTICIPANT_GENDERS.includes(item?.gender) ? item.gender : '') as ParticipantEntry['gender'],
          category: (PARTICIPANT_CATEGORIES.includes(item?.category) ? item.category : '') as ParticipantEntry['category'],
        }
        draftsRef.current = { ...draftsRef.current, [key]: nextRow }
        dirtyRef.current.add(key)
        setDrafts((prev) => ({ ...prev, [key]: nextRow }))
        const saved = await props.onSave(nextRow)
        const normalized = participantRowFromSource(bib, saved || nextRow)
        draftsRef.current = { ...draftsRef.current, [key]: normalized }
        dirtyRef.current.delete(key)
        setDrafts((prev) => ({ ...prev, [key]: normalized }))
        imported += 1
      }
      props.addToast({ text: imported ? `Participants importats: ${imported}` : 'El fitxer no contenia participants importables.', kind: imported ? 'info' : 'warn' })
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e || 'No s’han pogut importar els participants.'), kind: 'danger' })
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }
  const dirtyRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const bib of PARTICIPANT_BIBS) {
        const key = String(bib)
        if (!dirtyRef.current.has(key) || !prev[key]) next[key] = participantRowFromSource(bib, props.participants[key])
      }
      draftsRef.current = next
      return next
    })
  }, [props.participants])

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  const saveBib = async (bib: number, options?: { silentInvalid?: boolean; sourceField?: 'fullName' | 'gender' | 'category' | 'grossTime' | 'noShow' }) => {
    const key = String(bib)
    const row = draftsRef.current[key] || participantRowFromSource(bib, props.participants[key])
    const silentInvalid = options?.silentInvalid === true

    const grossTimeNormalized = normalizeGrossTime(row.grossTime || '')

    if ((row.grossTime || '').trim() && !grossTimeNormalized) {
      if (!silentInvalid) props.addToast({ text: `Dorsal ${bib}: el temps brut ha de tenir el format hh:mm:ss:dd.`, kind: 'warn' })
      return false
    }

    const payload = {
      bib,
      noShow: row.noShow === true,
      fullName: sanitizeParticipantName(row.fullName || ''),
      gender: row.gender || '',
      category: row.category || '',
      grossTime: grossTimeNormalized,
      penaltyTime: '',
      bonusTime: '',
    }

    setSaving((prev) => ({ ...prev, [key]: true }))
    try {
      const saved = await props.onSave(payload)
      const latest = draftsRef.current[key] || participantRowFromSource(bib, props.participants[key])
      if (!participantDraftMatchesSaved(latest, payload)) {
        dirtyRef.current.add(key)
        scheduleSave(bib)
        return true
      }
      dirtyRef.current.delete(key)
      if (saved) {
        const nextRow = participantRowFromSource(bib, saved)
        draftsRef.current = { ...draftsRef.current, [key]: nextRow }
        setDrafts((prev) => ({ ...prev, [key]: nextRow }))
      }
      return true
    } catch (e: any) {
      if (!silentInvalid) props.addToast({ text: String(e?.message || e), kind: 'danger' })
      return false
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }

  const scheduleSave = (bib: number) => {
    if (!props.canEdit || !props.competitionOpen) return
    const prev = timersRef.current.get(bib)
    if (prev) window.clearTimeout(prev)
    const timer = window.setTimeout(() => {
      timersRef.current.delete(bib)
      void saveBib(bib, { silentInvalid: true })
    }, 550)
    timersRef.current.set(bib, timer)
  }

  const flushSave = (bib: number, sourceField?: 'fullName' | 'gender' | 'category' | 'grossTime' | 'noShow') => {
    const prev = timersRef.current.get(bib)
    if (prev) {
      window.clearTimeout(prev)
      timersRef.current.delete(bib)
    }
    if (!props.canEdit || !props.competitionOpen) return
    if (sourceField === 'fullName' || sourceField === 'gender') return
    void saveBib(bib, { sourceField })
  }

  const setField = <K extends keyof ParticipantEntry>(bib: number, field: K, value: ParticipantEntry[K], immediate = false) => {
    const key = String(bib)
    const current = draftsRef.current[key] || participantRowFromSource(bib, props.participants[key])
    const nextRow = { ...current, [field]: value }
    dirtyRef.current.add(key)
    draftsRef.current = { ...draftsRef.current, [key]: nextRow }
    setDrafts((prev) => ({ ...prev, [key]: nextRow }))

    if (field === 'noShow') {
      flushSave(bib, 'noShow')
      return
    }

    if (field === 'grossTime') {
      const normalized = normalizeGrossTime(String(value || ''))
      if (normalized && isValidGrossTime(normalized)) flushSave(bib, 'grossTime')
      return
    }
  }

  const handleDeleteBib = async () => {
    if (!deleteBib || !props.canEdit || !props.competitionOpen) return
    const bib = deleteBib
    const key = String(bib)
    const emptyRow = participantRowFromSource(bib)
    dirtyRef.current.add(key)
    draftsRef.current = { ...draftsRef.current, [key]: emptyRow }
    setDrafts((prev) => ({ ...prev, [key]: emptyRow }))
    setDeleteBib(null)
    try {
      const saved = await props.onSave({
        bib,
        noShow: false,
        fullName: '',
        gender: '',
        category: '',
        grossTime: '',
        penaltyTime: '',
        bonusTime: '',
      })
      const normalized = participantRowFromSource(bib, saved || emptyRow)
      draftsRef.current = { ...draftsRef.current, [key]: normalized }
      dirtyRef.current.delete(key)
      setDrafts((prev) => ({ ...prev, [key]: normalized }))
      props.addToast({ text: `Participant del dorsal ${bib} esborrat.`, kind: 'info' })
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e || 'No s’ha pogut esborrar el participant.'), kind: 'danger' })
    }
  }

  const columns = '56px 22px 22px 226px 58px 116px 106px 80px 80px 106px 30px'

  return (
    <>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0 8px 0', background: '#ffffff' }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontWeight: 900 }}>Llistat de participants (dorsals 1–500)</div>
            <div style={{ fontSize: 12, color: '#4b5563' }}>Formats: temps brut <b>hh:mm:ss:dd</b>, penalització <b>mm:ss</b>, bonificació <b>mm:ss</b>. Columna <b>NP</b>: no presentat. Columna <b>Ret</b>: retirat.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!props.competitionOpen ? <Pill bg="#fee2e2">Competició tancada · només lectura</Pill> : null}
            <Button variant="secondary" onClick={downloadParticipantSeed} disabled={!props.canEdit}>Exporta participants</Button>
            <Button variant="secondary" onClick={() => importInputRef.current?.click()} disabled={!props.canEdit || !props.competitionOpen || importing}>
              {importing ? 'Important…' : 'Importa participants'}
            </Button>
            <input ref={importInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const file = e.target.files?.[0]; if (file) void importParticipantSeed(file) }} />
          </div>
        </div>

        <div style={{ overflow: 'auto', maxHeight: 'calc(100dvh - 185px)', border: '1px solid #dbe7d9', borderRadius: 12, background: '#ffffff' }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 4, background: '#eef6ee', borderBottom: '1px solid #dbe7d9', display: 'grid', gridTemplateColumns: columns, gap: 6, padding: '10px 12px', fontWeight: 900, fontSize: 12, color: '#374151' }}>
              <div>Dorsal</div>
              <div style={{ textAlign: 'center' }}>NP</div>
              <div style={{ textAlign: 'center' }}>Ret</div>
              <div>Cognoms i nom</div>
              <div>Gènere</div>
              <div>Categoria</div>
              <div>Temps brut</div>
              <div>Penalització</div>
              <div>Bonificació</div>
              <div>Temps net</div>
              <div style={{ textAlign: 'center' }}>✕</div>
            </div>
            <div style={{ display: 'grid' }}>
              {PARTICIPANT_BIBS.map((bib) => {
                const row = drafts[String(bib)] || participantRowFromSource(bib, props.participants[String(bib)])
                return (
                  <ParticipantRow
                    key={bib}
                    row={row}
                    summary={props.summaries.get(bib)}
                    saving={saving[String(bib)] === true}
                    editable={props.canEdit && props.competitionOpen}
                    onFieldChange={(field, value, immediate) => setField(bib, field, value as never, immediate)}
                    onBlur={(field) => flushSave(bib, field)}
                    onDeleteRequest={() => setDeleteBib(bib)}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={deleteBib != null}
        title="Esborrar participant"
        onClose={() => setDeleteBib(null)}
        showCloseButton={false}
        actions={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="secondary" onClick={() => setDeleteBib(null)}>No</Button>
            <Button onClick={() => { void handleDeleteBib() }} style={{ background: '#b91c1c', borderColor: '#991b1b' }}>Sí</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 14, border: '2px solid #dc2626', background: '#fee2e2', color: '#7f1d1d', fontWeight: 900 }}>
            Realment vols esborrar aquest participant?
          </div>
          <div style={{ color: '#4b5563' }}>
            Es buidaran totes les dades del dorsal <b>{deleteBib ? String(deleteBib).padStart(3, '0') : '—'}</b>.
          </div>
        </div>
      </Modal>
    </>
  )
}

const ParticipantRow = memo(function ParticipantRow(props: {
  row: ParticipantEntry
  summary?: DorsalSummary
  saving: boolean
  editable: boolean
  onFieldChange: (field: keyof ParticipantEntry, value: string | boolean, immediate?: boolean) => void
  onBlur: (field: 'fullName' | 'gender' | 'category' | 'grossTime' | 'noShow') => void
  onDeleteRequest: () => void
}) {
  const [focusField, setFocusField] = useState<'' | 'grossTime'>('')
  const grossDigits = sanitizeParticipantDigits(props.row.grossTime || '', 8)
  const grossInvalid = focusField === 'grossTime' && grossDigits.length === 8 && !isValidGrossTime(props.row.grossTime)
  const derived = participantDerivedView(props.row, props.summary)
  const disabledTimes = props.row.noShow === true

  const moveGrossTimeVertical = (direction: -1 | 1) => {
    const targetBib = props.row.bib + direction
    if (targetBib < PARTICIPANT_BIBS[0] || targetBib > PARTICIPANT_BIBS[PARTICIPANT_BIBS.length - 1]) return false
    return focusParticipantCell(targetBib, 'grossTime')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '56px 22px 22px 226px 58px 116px 106px 80px 80px 106px 30px', gap: 6, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #eef2ee', background: derived.isExpelled ? '#fff1f2' : derived.isWithdrawn ? '#f5f3ff' : (props.row.noShow ? '#f3f4f6' : (props.row.bib % 2 === 0 ? '#fbfefb' : '#ffffff')) }}>
      <div style={{ fontWeight: 900 }}>{String(props.row.bib).padStart(3, '0')}</div>
      <label style={{ display: 'grid', justifyItems: 'center', gap: 2, fontSize: 10, color: '#4b5563', marginLeft: -2 }}>
        <input type="checkbox" tabIndex={-1} checked={props.row.noShow === true} disabled={!props.editable} onChange={(e) => props.onFieldChange('noShow', e.target.checked, true)} />
      </label>
      <label style={{ display: 'grid', justifyItems: 'center', gap: 2, fontSize: 10, color: derived.isWithdrawn ? '#6d28d9' : '#4b5563', fontWeight: derived.isWithdrawn ? 800 : undefined }}>
        <input type="checkbox" checked={derived.isWithdrawn === true} readOnly tabIndex={-1} style={{ accentColor: '#7c3aed', pointerEvents: 'none' }} />
      </label>
      <Input
        id={participantCellId(props.row.bib, 'fullName')}
        value={props.row.fullName}
        onChange={(v) => props.onFieldChange('fullName', sanitizeParticipantName(v))}
        onKeyDown={(e) => { if (e.key === 'Enter') moveParticipantCellHorizontal(props.row.bib, 'fullName', 1) }}
        onPaste={(e) => {
          e.preventDefault()
          props.onFieldChange('fullName', sanitizeParticipantName(e.clipboardData.getData('text')))
        }}
        onBlur={() => props.onBlur('fullName')}
        placeholder="Cognoms i nom"
        maxLength={30}
        autoComplete="off"
        disabled={!props.editable}
        style={{ padding: '7px 8px', fontSize: 13, minWidth: 0, textTransform: 'uppercase' }}
      />
      <select
        id={participantCellId(props.row.bib, 'gender')}
        value={props.row.gender || ''}
        onChange={(e) => props.onFieldChange('gender', e.target.value)}
        onBlur={() => props.onBlur('gender')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            moveParticipantCellHorizontal(props.row.bib, 'gender', -1)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            moveParticipantCellHorizontal(props.row.bib, 'gender', 1)
          }
        }}
        disabled={!props.editable}
        style={compactSelectStyle({ opacity: props.editable ? 1 : 0.75 })}
      >
        <option value="">—</option>
        {PARTICIPANT_GENDERS.map((gender) => (
          <option key={gender} value={gender}>{gender === '-' ? '⚧' : gender}</option>
        ))}
      </select>
      <select
        id={participantCellId(props.row.bib, 'category')}
        value={props.row.category || ''}
        onChange={(e) => props.onFieldChange('category', e.target.value)}
        onBlur={() => props.onBlur('category')}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            const targetBib = e.shiftKey ? props.row.bib - 1 : props.row.bib + 1
            focusParticipantCell(Math.min(Math.max(targetBib, PARTICIPANT_BIBS[0]), PARTICIPANT_BIBS[PARTICIPANT_BIBS.length - 1]), 'fullName')
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            moveParticipantCellHorizontal(props.row.bib, 'category', -1)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            moveParticipantCellHorizontal(props.row.bib, 'category', 1)
          }
        }}
        disabled={!props.editable}
        style={compactSelectStyle({ opacity: props.editable ? 1 : 0.75 })}
      >
        <option value="">—</option>
        {PARTICIPANT_CATEGORIES.map((category) => (
          <option key={category} value={category}>{category}</option>
        ))}
      </select>
      <Input
        id={participantCellId(props.row.bib, 'grossTime')}
        value={props.row.grossTime}
        onFocus={() => setFocusField('grossTime')}
        onChange={(v) => props.onFieldChange('grossTime', applyGrossTimeInput(v, props.row.grossTime))}
        onKeyDown={(e) => {
          const complete = grossDigits.length === 8 && isValidGrossTime(props.row.grossTime)
          if (e.key === 'Enter') {
            props.onBlur('grossTime')
            return
          }
          if (!complete) return
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
            e.preventDefault()
            props.onBlur('grossTime')
            moveGrossTimeVertical(-1)
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'Tab') {
            e.preventDefault()
            props.onBlur('grossTime')
            moveGrossTimeVertical(1)
          }
        }}
        onPaste={(e) => {
          e.preventDefault()
          props.onFieldChange('grossTime', applyGrossTimeInput(e.clipboardData.getData('text'), props.row.grossTime))
        }}
        onBlur={() => {
          setFocusField('')
          props.onBlur('grossTime')
        }}
        placeholder="hh:mm:ss:dd"
        inputMode="numeric"
        maxLength={11}
        autoComplete="off"
        disabled={!props.editable || disabledTimes}
        style={{ padding: '7px 8px', fontSize: 13, minWidth: 0, textAlign: 'center', letterSpacing: 0.6, borderColor: grossInvalid ? '#dc2626' : undefined, background: grossInvalid ? '#fef2f2' : '#ffffff' }}
      />
      <div
        style={{
          width: '100%',
          padding: '7px 8px',
          borderRadius: 10,
          border: `1px solid ${derived.penaltyTimeEffective ? '#dc2626' : '#c8dcc7'}`,
          fontSize: 13,
          minWidth: 0,
          textAlign: 'center',
          letterSpacing: 0.5,
          background: derived.penaltyTimeEffective ? '#fef2f2' : '#f9fafb',
          color: derived.penaltyTimeEffective ? '#b91c1c' : '#6b7280',
          fontWeight: derived.penaltyTimeEffective ? 800 : 600,
          opacity: disabledTimes ? 0.75 : 1,
        }}
      >
        {derived.penaltyTimeEffective || '—'}
      </div>
      <div
        style={{
          width: '100%',
          padding: '7px 8px',
          borderRadius: 10,
          border: `1px solid ${derived.bonusTimeEffective ? '#15803d' : '#c8dcc7'}`,
          fontSize: 13,
          minWidth: 0,
          textAlign: 'center',
          letterSpacing: 0.5,
          background: derived.bonusTimeEffective ? '#f0fdf4' : '#f9fafb',
          color: derived.bonusTimeEffective ? '#15803d' : '#6b7280',
          fontWeight: derived.bonusTimeEffective ? 800 : 600,
          opacity: disabledTimes ? 0.75 : 1,
        }}
      >
        {derived.bonusTimeEffective || '—'}
      </div>
      <div style={{ display: 'grid', gap: 2, justifyItems: 'center' }}>
        <div style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: derived.isExpelled ? '#b91c1c' : derived.isWithdrawn ? '#6d28d9' : (derived.netTimeEffective ? '#111827' : '#9ca3af') }}>
          {derived.isExpelled ? 'EXPULSAT' : derived.isWithdrawn ? 'RETIRAT' : (props.row.noShow ? 'NO PRESENTAT' : (derived.netTimeEffective || '—'))}
        </div>
        {props.saving ? <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>desant…</div> : null}
      </div>
      <div style={{ display: 'grid', justifyItems: 'center' }}>
        <button
          type="button"
          onClick={props.onDeleteRequest}
          disabled={!props.editable || !(props.row.fullName || props.row.gender || props.row.category || props.row.grossTime || props.row.noShow)}
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            border: '1px solid #dc2626',
            background: props.editable ? '#fee2e2' : '#f3f4f6',
            color: '#b91c1c',
            fontWeight: 900,
            cursor: props.editable ? 'pointer' : 'default',
            lineHeight: 1,
            padding: 0,
          }}
          tabIndex={-1}
          aria-label={`Esborra participant del dorsal ${props.row.bib}`}
          title="Esborra participant"
        >
          ×
        </button>
      </div>
    </div>
  )
}, (prev, next) => {
  const prevSummary = prev.summary
  const nextSummary = next.summary
  const summaryEqual =
    prevSummary?.dsq === nextSummary?.dsq &&
    prevSummary?.withdrawn === nextSummary?.withdrawn &&
    prevSummary?.greenAssistSeconds === nextSummary?.greenAssistSeconds &&
    (prevSummary?.penalties?.length || 0) === (nextSummary?.penalties?.length || 0) &&
    (prevSummary?.penalties || []).every((item, idx) => {
      const other = nextSummary?.penalties?.[idx]
      return other && item.minutes === other.minutes && item.completed === other.completed
    })
  return prev.row === next.row && prev.saving === next.saving && prev.editable === next.editable && summaryEqual
})

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let idx = 0
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024
    idx += 1
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`
}

function PrincipalMaintenance(props: { session: Session; snapshot: any; addToast: (t: any) => void; reloadCompetition: () => Promise<any> | void }) {
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null)
  const [backups, setBackups] = useState<MaintenanceBackupItem[]>([])
  const [busy, setBusy] = useState<'refresh' | 'backup' | `restore:${string}` | null>(null)
  const [selectedRestore, setSelectedRestore] = useState('')

  const refresh = async () => {
    setBusy('refresh')
    try {
      const [nextSummary, nextBackups] = await Promise.all([
        getMaintenanceSummary(props.session.actorToken, props.session.competition.id),
        listMaintenanceBackups(props.session.actorToken, props.session.competition.id),
      ])
      setSummary(nextSummary)
      setBackups(nextBackups)
      if (!selectedRestore || !nextBackups.some((b) => b.filename === selectedRestore && b.containsCompetition)) {
        setSelectedRestore(nextBackups.find((b) => b.containsCompetition)?.filename || '')
      }
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e || 'No s’ha pogut carregar el manteniment.'), kind: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void refresh()
  }, [props.session.actorToken, props.session.competition.id])

  const compatibleBackups = useMemo(() => backups.filter((b) => b.containsCompetition), [backups])

  const handleCreateBackup = async () => {
    setBusy('backup')
    try {
      const created = await createMaintenanceBackup(props.session.actorToken, props.session.competition.id)
      props.addToast({ text: `Backup manual creat: ${created.filename}`, kind: 'info' })
      await refresh()
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e || 'No s’ha pogut crear el backup.'), kind: 'danger' })
      setBusy(null)
    }
  }

  const handleRestore = async () => {
    if (!selectedRestore) {
      props.addToast({ text: 'Tria abans un backup compatible amb aquesta competició.', kind: 'warn' })
      return
    }
    const ok = window.confirm(`Restaurar el backup ${selectedRestore}?

Això substituirà l’estat actual del servidor per la còpia escollida.`)
    if (!ok) return
    setBusy(`restore:${selectedRestore}`)
    try {
      const restored = await restoreMaintenanceBackup(props.session.actorToken, props.session.competition.id, selectedRestore)
      props.addToast({ text: `Backup restaurat: ${restored.filename}`, kind: 'warn' })
      await props.reloadCompetition()
      await refresh()
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e || 'No s’ha pogut restaurar el backup.'), kind: 'danger' })
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="Manteniment tècnic">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#4b5563' }}>
            Aquesta zona és només per al perfil <b>Principal</b>. Des d’aquí pots revisar l’estat del servidor, crear backups manuals, descarregar una còpia JSON local i restaurar una còpia compatible amb la competició actual.
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => { void refresh() }} disabled={busy === 'refresh'}>
              {busy === 'refresh' ? 'Actualitzant…' : 'Actualitza estat'}
            </Button>
            <Button onClick={() => { void handleCreateBackup() }} disabled={busy === 'backup'}>
              {busy === 'backup' ? 'Creant backup…' : 'Crea backup ara'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (props.snapshot) exportSnapshotJson(props.session, props.snapshot)
                else props.addToast({ text: 'Encara no hi ha una còpia local disponible.', kind: 'warn' })
              }}
            >
              Descarrega JSON local
            </Button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 10, background: '#fbfefb' }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 800 }}>COMPETICIÓ</div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{summary?.competition.name || props.session.competition.name}</div>
              <div style={{ color: '#374151', fontWeight: 700, marginTop: 4 }}>Codi: {summary?.competition.code || props.session.competition.code}</div>
            </div>
            <div style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 10, background: '#fbfefb' }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 800 }}>ESDEVENIMENTS</div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{summary?.stats.events ?? '—'}</div>
              <div style={{ color: '#374151', fontWeight: 700, marginTop: 4 }}>Participants: {summary?.stats.participants ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 10, background: '#fbfefb' }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 800 }}>SESSIONS</div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{summary ? `${summary.health.principalSessions} P / ${summary.health.actorSessions} A` : '—'}</div>
              <div style={{ color: '#374151', fontWeight: 700, marginTop: 4 }}>Format intern de dades: {summary?.health.schemaVersion ?? '—'}</div>
            </div>
            <div style={{ border: '1px solid #d1d5db', borderRadius: 12, padding: 10, background: '#fbfefb' }}>
              <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 800 }}>BACKUPS</div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{summary?.stats.backups ?? backups.length}</div>
              <div style={{ color: '#374151', fontWeight: 700, marginTop: 4 }}>Compatibles: {summary?.stats.backupsForCompetition ?? compatibleBackups.length}</div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Restauració i historial de backups">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13, color: '#4b5563' }}>
              El botó de restaurar només permet escollir backups que contenen la competició actual. Després de restaurar, es refresca l’estat del panell.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center' }}>
              <select value={selectedRestore} onChange={(e) => setSelectedRestore(e.target.value)} style={compactSelectStyle({ minHeight: 40 })}>
                <option value="">Tria un backup compatible…</option>
                {compatibleBackups.map((b) => (
                  <option key={b.filename} value={b.filename}>{b.filename}</option>
                ))}
              </select>
              <Button onClick={() => { void handleRestore() }} disabled={!selectedRestore || String(busy || '').startsWith('restore:')} style={{ minHeight: 40 }}>
                {String(busy || '').startsWith('restore:') ? 'Restaurant…' : 'Restaura backup'}
              </Button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760, display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1.7fr) 140px 170px 110px 1fr', gap: 8, fontWeight: 900, fontSize: 12, color: '#374151', padding: '0 8px' }}>
                <div>Fitxer</div>
                <div>Mida</div>
                <div>Modificat</div>
                <div>Versió</div>
                <div>Compatibilitat</div>
              </div>
              {backups.map((b) => (
                <div key={b.filename} style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1.7fr) 140px 170px 110px 1fr', gap: 8, alignItems: 'center', border: '1px solid #d1d5db', borderRadius: 12, padding: 10, background: b.containsCompetition ? '#fbfefb' : '#f9fafb' }}>
                  <div style={{ fontWeight: 800, overflowWrap: 'anywhere' }}>{b.filename}</div>
                  <div>{formatBytes(b.size)}</div>
                  <div>{new Date(b.modifiedAt).toLocaleString()}</div>
                  <div>{b.schemaVersion ?? '—'}</div>
                  <div>
                    {b.containsCompetition ? <Pill bg="#dcfce7">Compatible</Pill> : <Pill bg="#f3f4f6">Altres dades</Pill>}
                    {b.competitionName ? <div style={{ marginTop: 4, color: '#4b5563', fontSize: 12 }}>{b.competitionName}</div> : null}
                  </div>
                </div>
              ))}
              {!backups.length ? <div style={{ color: '#6b7280' }}>Encara no hi ha backups disponibles.</div> : null}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

function Exports(props: { session: Session; competitionName: string; competitionCode: string; events: any[]; checks: Record<string, any>; completions: Record<string, any>; snapshot: any; participants: Record<string, ParticipantEntry>; summaries: Map<number, DorsalSummary>; addToast: (t: any) => void }) {
  type ExportMode = 'preview' | 'download' | 'previewAndDownload'
  type ExportRunOptions = { mode?: ExportMode; silentEmpty?: boolean }
  type SavePromptState = { title: string; multiple?: boolean; onPreview: () => Promise<void>; onPreviewAndSave: () => Promise<void> }

  const mine = useMemo(() => props.events.filter((e) => e.actorId === props.session.actor.id), [props.events, props.session.actor.id])
  const participantRows = useMemo(() => Object.values(props.participants || {}).map((row) => participantRowFromSource(row.bib, row)), [props.participants])
  const allBibRows = useMemo(() => {
    const map = new Map<number, ParticipantEntry>()
    for (const row of participantRows) map.set(row.bib, row)
    for (const bib of props.summaries.keys()) {
      if (!map.has(bib)) map.set(bib, participantRowFromSource(bib, props.participants[String(bib)]))
    }
    return Array.from(map.values()).sort((a, b) => a.bib - b.bib)
  }, [participantRows, props.summaries, props.participants])
  const canManageTable = props.session.actor.role === 'table' || props.session.actor.role === 'principal'
  const [savePrompt, setSavePrompt] = useState<SavePromptState | null>(null)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [savingAll, setSavingAll] = useState(false)

  const metaBase = (refereeName = props.session.actor.name) => ({
    competitionName: props.competitionName,
    competitionCode: props.competitionCode,
    refereeName,
    generatedAt: new Date().toISOString(),
  })

  const hasClassificationRows = (filter: ClassificationFilter) => {
    const sections = buildClassificationSections(participantRows, filter, props.summaries)
    return !!(sections.finished.length || sections.expelled.length || sections.withdrawn.length || sections.noShows.length)
  }

  const availabilityForPrompt = (title: string) => {
    switch (title) {
      case 'el registre d’aquest àrbitre':
        return { ok: mine.length > 0, emptyText: 'Encara no hi ha faltes d’aquest àrbitre.' }
      case 'els registres per àrbitre':
        return { ok: props.events.some((e) => e.actorRole === 'referee'), emptyText: 'Encara no hi ha faltes dels àrbitres de recorregut.' }
      case 'el registre global':
        return { ok: props.events.length > 0, emptyText: 'Encara no hi ha incidències per al llistat global.' }
      case 'el registre per dorsals':
        return { ok: props.events.length > 0, emptyText: 'Encara no hi ha incidències per al llistat per dorsals.' }
      case 'la classificació general':
        return { ok: hasClassificationRows({ title: 'GENERAL' }), emptyText: 'No hi ha participants amb dades per a GENERAL.' }
      case 'la classificació general masculina':
        return { ok: hasClassificationRows({ title: 'GENERAL', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a GENERAL masculina.' }
      case 'la classificació general femenina':
        return { ok: hasClassificationRows({ title: 'GENERAL', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a GENERAL femenina.' }
      case 'la classificació general no binària':
        return { ok: hasClassificationRows({ title: 'GENERAL', gender: '-' }), emptyText: 'No hi ha participants amb dades per a GENERAL no binària.' }
      case 'la classificació infantil masculina':
        return { ok: hasClassificationRows({ title: 'INFANTIL', category: 'Infantil', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a INFANTIL masculina.' }
      case 'la classificació infantil femenina':
        return { ok: hasClassificationRows({ title: 'INFANTIL', category: 'Infantil', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a INFANTIL femenina.' }
      case 'la classificació cadet masculina':
        return { ok: hasClassificationRows({ title: 'CADET', category: 'Cadet', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a CADET masculina.' }
      case 'la classificació cadet femenina':
        return { ok: hasClassificationRows({ title: 'CADET', category: 'Cadet', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a CADET femenina.' }
      case 'la classificació júnior masculina':
        return { ok: hasClassificationRows({ title: 'JUNIOR', category: 'Junior', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a JUNIOR masculina.' }
      case 'la classificació júnior femenina':
        return { ok: hasClassificationRows({ title: 'JUNIOR', category: 'Junior', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a JUNIOR femenina.' }
      case 'la classificació promesa masculina':
        return { ok: hasClassificationRows({ title: 'PROMESA', category: 'Promesa', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a PROMESA masculina.' }
      case 'la classificació promesa femenina':
        return { ok: hasClassificationRows({ title: 'PROMESA', category: 'Promesa', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a PROMESA femenina.' }
      case 'la classificació sènior masculina':
        return { ok: hasClassificationRows({ title: 'SÈNIOR', category: 'Sènior', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a SÈNIOR masculina.' }
      case 'la classificació sènior femenina':
        return { ok: hasClassificationRows({ title: 'SÈNIOR', category: 'Sènior', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a SÈNIOR femenina.' }
      case 'la classificació veterà A masculina':
        return { ok: hasClassificationRows({ title: 'VETERÀ A', category: 'Veterà A', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a VETERÀ A masculina.' }
      case 'la classificació veterà A femenina':
        return { ok: hasClassificationRows({ title: 'VETERÀ A', category: 'Veterà A', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a VETERÀ A femenina.' }
      case 'la classificació veterà B masculina':
        return { ok: hasClassificationRows({ title: 'VETERÀ B', category: 'Veterà B', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a VETERÀ B masculina.' }
      case 'la classificació veterà B femenina':
        return { ok: hasClassificationRows({ title: 'VETERÀ B', category: 'Veterà B', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a VETERÀ B femenina.' }
      case 'la classificació veterà C masculina':
        return { ok: hasClassificationRows({ title: 'VETERÀ C', category: 'Veterà C', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a VETERÀ C masculina.' }
      case 'la classificació veterà C femenina':
        return { ok: hasClassificationRows({ title: 'VETERÀ C', category: 'Veterà C', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a VETERÀ C femenina.' }
      case 'la classificació veterà D masculina':
        return { ok: hasClassificationRows({ title: 'VETERÀ D', category: 'Veterà D', gender: 'M' }), emptyText: 'No hi ha participants amb dades per a VETERÀ D masculina.' }
      case 'la classificació veterà D femenina':
        return { ok: hasClassificationRows({ title: 'VETERÀ D', category: 'Veterà D', gender: 'F' }), emptyText: 'No hi ha participants amb dades per a VETERÀ D femenina.' }
      case 'el llistat d’expulsats':
        return { ok: allBibRows.some((row) => !!row.fullName.trim() && props.summaries.get(row.bib)?.dsq), emptyText: 'No hi ha dorsals expulsats.' }
      case 'el llistat de retirats':
        return { ok: allBibRows.some((row) => !!row.fullName.trim() && props.summaries.get(row.bib)?.withdrawn), emptyText: 'No hi ha dorsals retirats.' }
      case 'el llistat de no presentats':
        return { ok: participantRows.some((row) => row.noShow === true && !!row.fullName.trim()), emptyText: 'No hi ha dorsals marcats com a no presentats.' }
      default:
        return { ok: true, emptyText: '' }
    }
  }

  const previewThenOfferSave = (title: string, previewer: () => Promise<boolean>, previewAndSaver: () => Promise<boolean>, multiple = false) => {
    const availability = availabilityForPrompt(title)
    if (!availability.ok) {
      props.addToast({ text: availability.emptyText, kind: 'warn' })
      return
    }
    setSavePrompt({
      title,
      multiple,
      onPreview: async () => {
        try {
          const shown = await previewer()
          if (!shown) return
          props.addToast({ text: multiple ? `S'han obert els PDFs de ${title.toLowerCase()}.` : `S'ha obert el PDF de ${title.toLowerCase()}.`, kind: 'info' })
        } catch (e: any) {
          props.addToast({ text: String(e?.message || e || 'No s’ha pogut generar el llistat.'), kind: 'danger' })
        }
      },
      onPreviewAndSave: async () => {
        try {
          const saved = await previewAndSaver()
          if (!saved) return
          props.addToast({ text: multiple ? `S'han obert i desat els PDFs de ${title.toLowerCase()}.` : `S'ha obert i desat el PDF de ${title.toLowerCase()}.`, kind: 'info' })
        } catch (e: any) {
          props.addToast({ text: String(e?.message || e || 'No s’ha pogut generar el llistat.'), kind: 'danger' })
        }
      }
    })
  }

  const exportMine = async (options?: ExportRunOptions): Promise<boolean> => {
    if (!mine.length) {
      if (!options?.silentEmpty) props.addToast({ text: 'Encara no hi ha faltes d’aquest àrbitre.', kind: 'warn' })
      return false
    }
    await exportPdfPerReferee(metaBase(props.session.actor.name), mine, {
      filename: suggestedRefereePdfFilename(metaBase(props.session.actor.name)),
      mode: options?.mode || 'preview',
    })
    return true
  }

  const exportAllReferees = async (options?: ExportRunOptions): Promise<boolean> => {
    const rows = props.events.filter((e) => e.actorRole === 'referee')
    if (!rows.length) {
      if (!options?.silentEmpty) props.addToast({ text: 'Encara no hi ha faltes dels àrbitres de recorregut.', kind: 'warn' })
      return false
    }
    const grouped = new Map<string, typeof rows>()
    for (const item of rows) {
      const key = item.actorName || 'Àrbitre'
      const arr = grouped.get(key) || []
      arr.push(item)
      grouped.set(key, arr)
    }
    const names = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b))
    for (const name of names) {
      await exportPdfPerReferee(
        metaBase(name),
        (grouped.get(name) || []).slice().sort((a, b) => (a.capturedAt + a.id).localeCompare(b.capturedAt + b.id)),
        {
          filename: suggestedRefereePdfFilename(metaBase(name)),
          mode: options?.mode || 'preview',
        }
      )
    }
    if ((options?.mode || 'preview') === 'download' && !options?.silentEmpty) {
      props.addToast({ text: `S'han generat ${names.length} PDFs, un per cada àrbitre de recorregut.`, kind: 'info' })
    }
    return true
  }

  const exportGlobal = async (options?: ExportRunOptions): Promise<boolean> => {
    if (!props.events.length) {
      if (!options?.silentEmpty) props.addToast({ text: 'Encara no hi ha incidències per al llistat global.', kind: 'warn' })
      return false
    }
    await exportPdfGlobal(metaBase(), props.events, (id) => props.checks[id]?.checked === true, { mode: options?.mode || 'preview' })
    return true
  }

  const exportByBib = async (options?: ExportRunOptions): Promise<boolean> => {
    if (!props.events.length) {
      if (!options?.silentEmpty) props.addToast({ text: 'Encara no hi ha incidències per al llistat per dorsals.', kind: 'warn' })
      return false
    }
    await exportPdfByDorsal(metaBase(), props.events, props.completions, { mode: options?.mode || 'preview' })
    return true
  }

  const exportClassification = async (filter: ClassificationFilter, options?: ExportRunOptions): Promise<boolean> => {
    const sections = buildClassificationSections(participantRows, filter, props.summaries)
    const hasAnything = !!(sections.finished.length || sections.expelled.length || sections.withdrawn.length || sections.noShows.length)
    if (!hasAnything && !(options?.silentEmpty && options?.mode === 'download')) {
      if (!options?.silentEmpty) props.addToast({ text: `No hi ha participants amb dades per a ${filter.title}.`, kind: 'warn' })
      return false
    }
    const title = classificationButtonLabel(filter.title, filter.gender)
    await exportClassificationPdf({ ...metaBase(), title }, sections, { mode: options?.mode || 'preview' })
    return true
  }

  const exportExpelled = async (options?: ExportRunOptions): Promise<boolean> => {
    const rows = allBibRows
      .filter((row) => !!row.fullName.trim())
      .filter((row) => props.summaries.get(row.bib)?.dsq)
      .map((row) => ({ bib: row.bib, fullName: row.fullName || '', gender: row.gender || '', category: row.category || '' }))
    if (!rows.length && !(options?.silentEmpty && options?.mode === 'download')) {
      if (!options?.silentEmpty) props.addToast({ text: 'No hi ha dorsals expulsats.', kind: 'warn' })
      return false
    }
    await exportBibNamePdf({ ...metaBase(), title: 'EXPULSATS', showOrder: false, emptyMessage: 'No hi ha participants expulsats.' }, rows, { mode: options?.mode || 'preview' })
    return true
  }

  const exportNoShows = async (options?: ExportRunOptions): Promise<boolean> => {
    const rows = participantRows
      .filter((row) => row.noShow === true && !!row.fullName.trim())
      .sort((a, b) => a.bib - b.bib)
      .map((row) => ({ bib: row.bib, fullName: row.fullName || '', gender: row.gender || '', category: row.category || '' }))
    if (!rows.length && !(options?.silentEmpty && options?.mode === 'download')) {
      if (!options?.silentEmpty) props.addToast({ text: 'No hi ha dorsals marcats com a no presentats.', kind: 'warn' })
      return false
    }
    await exportBibNamePdf({ ...metaBase(), title: 'NO_PRESENTATS', showGenderCategory: false, showOrder: false, emptyMessage: 'No hi ha participants no presentats.' }, rows, { mode: options?.mode || 'preview' })
    return true
  }

  const exportWithdrawn = async (options?: ExportRunOptions): Promise<boolean> => {
    const rows = allBibRows
      .filter((row) => !!row.fullName.trim())
      .filter((row) => props.summaries.get(row.bib)?.withdrawn)
      .sort((a, b) => a.bib - b.bib)
      .map((row) => ({ bib: row.bib, fullName: row.fullName || '', gender: row.gender || '', category: row.category || '' }))
    if (!rows.length && !(options?.silentEmpty && options?.mode === 'download')) {
      if (!options?.silentEmpty) props.addToast({ text: 'No hi ha dorsals retirats.', kind: 'warn' })
      return false
    }
    await exportBibNamePdf({ ...metaBase(), title: 'RETIRATS', showGenderCategory: false, showOrder: false, emptyMessage: 'No hi ha participants retirats.' }, rows, { mode: options?.mode || 'preview' })
    return true
  }

  const saveAllLists = async () => {
    if (!canManageTable || savingAll) return
    const ok = window.confirm('Es gravaran de cop tots els llistats finals disponibles. Vols continuar?')
    if (!ok) return
    setSavingAll(true)
    try {
      const tasks: Array<() => Promise<boolean>> = [
        () => exportAllReferees({ mode: 'download', silentEmpty: true }),
        () => exportGlobal({ mode: 'download', silentEmpty: true }),
        () => exportByBib({ mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'GENERAL' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'GENERAL', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'GENERAL', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'GENERAL', gender: '-' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'INFANTIL', category: 'Infantil', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'INFANTIL', category: 'Infantil', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'CADET', category: 'Cadet', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'CADET', category: 'Cadet', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'JUNIOR', category: 'Junior', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'JUNIOR', category: 'Junior', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'PROMESA', category: 'Promesa', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'PROMESA', category: 'Promesa', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'SÈNIOR', category: 'Sènior', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'SÈNIOR', category: 'Sènior', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ A', category: 'Veterà A', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ A', category: 'Veterà A', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ B', category: 'Veterà B', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ B', category: 'Veterà B', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ C', category: 'Veterà C', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ C', category: 'Veterà C', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ D', category: 'Veterà D', gender: 'M' }, { mode: 'download', silentEmpty: true }),
        () => exportClassification({ title: 'VETERÀ D', category: 'Veterà D', gender: 'F' }, { mode: 'download', silentEmpty: true }),
        () => exportExpelled({ mode: 'download', silentEmpty: true }),
        () => exportWithdrawn({ mode: 'download', silentEmpty: true }),
        () => exportNoShows({ mode: 'download', silentEmpty: true }),
      ]
      let saved = 0
      let skipped = 0
      for (const task of tasks) {
        const done = await task()
        if (done) saved += 1
        else skipped += 1
      }
      props.addToast({ text: `Gravació massiva completada. PDFs desats: ${saved}. Sense dades: ${skipped}.`, kind: saved ? 'info' : 'warn' })
    } catch (e: any) {
      props.addToast({ text: String(e?.message || e || 'No s’han pogut gravar tots els llistats.'), kind: 'danger' })
    } finally {
      setSavingAll(false)
    }
  }

  const columns: Array<{ key: string; buttons: Array<{ key: string; label: ReactNode; action: () => void; disabled?: boolean }> }> = [
    {
      key: 'arbitratge',
      buttons: [
        { key: 'mine', label: 'PDF meu', action: () => { void previewThenOfferSave('el registre d’aquest àrbitre', () => exportMine({ mode: 'preview' }), () => exportMine({ mode: 'previewAndDownload' })) } },
        { key: 'refs', label: 'PDF per àrbitre', action: () => { void previewThenOfferSave('els registres per àrbitre', () => exportAllReferees({ mode: 'preview' }), () => exportAllReferees({ mode: 'previewAndDownload' }), true) }, disabled: !canManageTable },
        { key: 'global', label: 'PDF cronològic', action: () => { void previewThenOfferSave('el registre cronològic', () => exportGlobal({ mode: 'preview' }), () => exportGlobal({ mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'bibs', label: 'PDF dorsals', action: () => { void previewThenOfferSave('el registre per dorsals', () => exportByBib({ mode: 'preview' }), () => exportByBib({ mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
    {
      key: 'c1',
      buttons: [
        { key: 'general', label: 'GENERAL', action: () => { void previewThenOfferSave('la classificació general', () => exportClassification({ title: 'GENERAL' }, { mode: 'preview' }), () => exportClassification({ title: 'GENERAL' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'general-m', label: classificationButtonNode('GENERAL', 'M'), action: () => { void previewThenOfferSave('la classificació general masculina', () => exportClassification({ title: 'GENERAL', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'GENERAL', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'general-f', label: classificationButtonNode('GENERAL', 'F'), action: () => { void previewThenOfferSave('la classificació general femenina', () => exportClassification({ title: 'GENERAL', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'GENERAL', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'general-x', label: classificationButtonNode('GENERAL', '-'), action: () => { void previewThenOfferSave('la classificació general no binària', () => exportClassification({ title: 'GENERAL', gender: '-' }, { mode: 'preview' }), () => exportClassification({ title: 'GENERAL', gender: '-' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
    {
      key: 'c2',
      buttons: [
        { key: 'inf-m', label: classificationButtonNode('INFANTIL', 'M'), action: () => { void previewThenOfferSave('la classificació infantil masculina', () => exportClassification({ title: 'INFANTIL', category: 'Infantil', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'INFANTIL', category: 'Infantil', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'inf-f', label: classificationButtonNode('INFANTIL', 'F'), action: () => { void previewThenOfferSave('la classificació infantil femenina', () => exportClassification({ title: 'INFANTIL', category: 'Infantil', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'INFANTIL', category: 'Infantil', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'cad-m', label: classificationButtonNode('CADET', 'M'), action: () => { void previewThenOfferSave('la classificació cadet masculina', () => exportClassification({ title: 'CADET', category: 'Cadet', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'CADET', category: 'Cadet', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'cad-f', label: classificationButtonNode('CADET', 'F'), action: () => { void previewThenOfferSave('la classificació cadet femenina', () => exportClassification({ title: 'CADET', category: 'Cadet', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'CADET', category: 'Cadet', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
    {
      key: 'c3',
      buttons: [
        { key: 'jun-m', label: classificationButtonNode('JUNIOR', 'M'), action: () => { void previewThenOfferSave('la classificació júnior masculina', () => exportClassification({ title: 'JUNIOR', category: 'Junior', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'JUNIOR', category: 'Junior', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'jun-f', label: classificationButtonNode('JUNIOR', 'F'), action: () => { void previewThenOfferSave('la classificació júnior femenina', () => exportClassification({ title: 'JUNIOR', category: 'Junior', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'JUNIOR', category: 'Junior', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'pro-m', label: classificationButtonNode('PROMESA', 'M'), action: () => { void previewThenOfferSave('la classificació promesa masculina', () => exportClassification({ title: 'PROMESA', category: 'Promesa', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'PROMESA', category: 'Promesa', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'pro-f', label: classificationButtonNode('PROMESA', 'F'), action: () => { void previewThenOfferSave('la classificació promesa femenina', () => exportClassification({ title: 'PROMESA', category: 'Promesa', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'PROMESA', category: 'Promesa', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
    {
      key: 'c4',
      buttons: [
        { key: 'sen-m', label: classificationButtonNode('SÈNIOR', 'M'), action: () => { void previewThenOfferSave('la classificació sènior masculina', () => exportClassification({ title: 'SÈNIOR', category: 'Sènior', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'SÈNIOR', category: 'Sènior', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'sen-f', label: classificationButtonNode('SÈNIOR', 'F'), action: () => { void previewThenOfferSave('la classificació sènior femenina', () => exportClassification({ title: 'SÈNIOR', category: 'Sènior', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'SÈNIOR', category: 'Sènior', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'va-m', label: classificationButtonNode('VETERÀ A', 'M'), action: () => { void previewThenOfferSave('la classificació veterà A masculina', () => exportClassification({ title: 'VETERÀ A', category: 'Veterà A', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ A', category: 'Veterà A', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'va-f', label: classificationButtonNode('VETERÀ A', 'F'), action: () => { void previewThenOfferSave('la classificació veterà A femenina', () => exportClassification({ title: 'VETERÀ A', category: 'Veterà A', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ A', category: 'Veterà A', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
    {
      key: 'c5',
      buttons: [
        { key: 'vb-m', label: classificationButtonNode('VETERÀ B', 'M'), action: () => { void previewThenOfferSave('la classificació veterà B masculina', () => exportClassification({ title: 'VETERÀ B', category: 'Veterà B', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ B', category: 'Veterà B', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'vb-f', label: classificationButtonNode('VETERÀ B', 'F'), action: () => { void previewThenOfferSave('la classificació veterà B femenina', () => exportClassification({ title: 'VETERÀ B', category: 'Veterà B', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ B', category: 'Veterà B', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'vc-m', label: classificationButtonNode('VETERÀ C', 'M'), action: () => { void previewThenOfferSave('la classificació veterà C masculina', () => exportClassification({ title: 'VETERÀ C', category: 'Veterà C', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ C', category: 'Veterà C', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'vc-f', label: classificationButtonNode('VETERÀ C', 'F'), action: () => { void previewThenOfferSave('la classificació veterà C femenina', () => exportClassification({ title: 'VETERÀ C', category: 'Veterà C', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ C', category: 'Veterà C', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
    {
      key: 'c6',
      buttons: [
        { key: 'vd-m', label: classificationButtonNode('VETERÀ D', 'M'), action: () => { void previewThenOfferSave('la classificació veterà D masculina', () => exportClassification({ title: 'VETERÀ D', category: 'Veterà D', gender: 'M' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ D', category: 'Veterà D', gender: 'M' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'vd-f', label: classificationButtonNode('VETERÀ D', 'F'), action: () => { void previewThenOfferSave('la classificació veterà D femenina', () => exportClassification({ title: 'VETERÀ D', category: 'Veterà D', gender: 'F' }, { mode: 'preview' }), () => exportClassification({ title: 'VETERÀ D', category: 'Veterà D', gender: 'F' }, { mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'expelled', label: 'EXPULSATS', action: () => { void previewThenOfferSave('el llistat d’expulsats', () => exportExpelled({ mode: 'preview' }), () => exportExpelled({ mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'withdrawn', label: 'RETIRATS', action: () => { void previewThenOfferSave('el llistat de retirats', () => exportWithdrawn({ mode: 'preview' }), () => exportWithdrawn({ mode: 'previewAndDownload' })) }, disabled: !canManageTable },
        { key: 'noshow', label: 'NO PRESENTATS', action: () => { void previewThenOfferSave('el llistat de no presentats', () => exportNoShows({ mode: 'preview' }), () => exportNoShows({ mode: 'previewAndDownload' })) }, disabled: !canManageTable },
      ]
    },
  ]

  return (
    <>
      <Card title="Exportacions">
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
            {!canManageTable ? <div style={{ fontSize: 13, color: '#6b7280' }}>Les classificacions i els PDFs globals només estan habilitats a <b>Taula/Principal</b>.</div> : null}
            <div style={{ fontSize: 12.5, color: '#4b5563' }}>En tocar un llistat, primer et preguntarà si el vols <b>només veure</b> o bé <b>veure i gravar</b>.</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 980, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
                <BandTitle style={{ textAlign: 'center' }}>ARBITRATGE</BandTitle>
                <BandTitle style={{ gridColumn: '2 / 8', textAlign: 'center' }}>CLASSIFICACIONS</BandTitle>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(5, 40px)', gap: 8, alignItems: 'stretch' }}>
                {columns.map((column, columnIdx) => {
                  const slots = Array.from({ length: 5 }, (_, idx) => column.buttons[idx] || null)
                  return slots.map((button, rowIdx) => {
                    if (!button) return null
                    return (
                      <Button
                        key={`${column.key}-${button.key}`}
                        variant="secondary"
                        onClick={button.action}
                        disabled={button.disabled}
                        style={{
                          gridColumn: String(columnIdx + 1),
                          gridRow: String(rowIdx + 1),
                          width: '100%',
                          minHeight: 40,
                          height: 40,
                          fontSize: 11.5,
                          padding: '7px 5px',
                          textAlign: 'center',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {button.label}
                      </Button>
                    )
                  })
                })}
                {canManageTable ? (
                  <Button
                    onClick={() => { void saveAllLists() }}
                    disabled={savingAll}
                    style={{
                      gridColumn: '2 / 7',
                      gridRow: '5',
                      width: '100%',
                      minHeight: 40,
                      height: 40,
                      background: '#b91c1c',
                      borderColor: '#991b1b',
                      color: '#ffffff',
                      fontWeight: 900
                    }}
                  >
                    {savingAll ? 'GRAVANT LLISTATS…' : 'GRAVAR TOTS ELS LLISTATS'}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Modal
        open={!!savePrompt}
        title="Què vols fer amb aquest llistat?"
        onClose={() => { if (!savingPrompt) setSavePrompt(null) }}
        showCloseButton={false}
        actions={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setSavePrompt(null)} disabled={savingPrompt}>Tanca</Button>
            <Button variant="secondary" onClick={async () => {
              if (!savePrompt || savingPrompt) return
              setSavingPrompt(true)
              try {
                await savePrompt.onPreview()
                setSavePrompt(null)
              } finally {
                setSavingPrompt(false)
              }
            }} disabled={savingPrompt}>{savingPrompt ? 'Obrint…' : 'Només veure'}</Button>
            <Button onClick={async () => {
              if (!savePrompt || savingPrompt) return
              setSavingPrompt(true)
              try {
                await savePrompt.onPreviewAndSave()
                setSavePrompt(null)
              } finally {
                setSavingPrompt(false)
              }
            }} disabled={savingPrompt}>{savingPrompt ? 'Preparant…' : (savePrompt?.multiple ? 'Veure i gravar PDFs' : 'Veure i gravar PDF')}</Button>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
          <div style={{ fontWeight: 800 }}>{savePrompt?.title ? `Pots obrir ${savePrompt.title} per revisar-lo.` : 'Pots obrir aquest llistat per revisar-lo.'}</div>
          <div style={{ color: '#4b5563', fontSize: 13 }}>
            Si tries <b>Només veure</b>, s’obrirà el document sense desar-lo. Si tries <b>Veure i gravar</b>, s’obrirà i també es desarà al dispositiu.
          </div>
        </div>
      </Modal>
    </>
  )
}

