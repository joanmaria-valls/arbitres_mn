import type { ParticipantCategory, ParticipantEntry, ParticipantGender } from '../types'
import type { DorsalSummary } from './penalties'

export const PARTICIPANT_CATEGORIES: ParticipantCategory[] = [
  'Infantil',
  'Cadet',
  'Junior',
  'Promesa',
  'Sènior',
  'Veterà A',
  'Veterà B',
  'Veterà C',
  'Veterà D',
]

export const PARTICIPANT_GENDERS: ParticipantGender[] = ['M', 'F', '-']

export type ClassificationFilter = {
  title: string
  gender?: ParticipantGender
  category?: ParticipantCategory
}

export type ClassificationRow = ParticipantEntry & {
  penaltyTimeEffective: string
  bonusTimeEffective: string
  netTimeEffective: string
}

export type ClassificationBibRow = {
  bib: number
  fullName: string
  gender?: ParticipantGender | ''
  category?: ParticipantCategory | ''
}

export type ClassificationSections = {
  finished: ClassificationRow[]
  expelled: ClassificationBibRow[]
  withdrawn: ClassificationBibRow[]
  noShows: ClassificationBibRow[]
}

export function sanitizeParticipantName(raw: string) {
  return String(raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, 30)
    .toLocaleUpperCase('ca-ES')
}

export function applyGrossTimeInput(nextRaw: string, previousRaw = '') {
  const prevDigits = sanitizeParticipantDigits(previousRaw, 8)
  const nextDigits = sanitizeParticipantDigits(nextRaw, 8)
  if (nextDigits.length <= prevDigits.length) return formatParticipantDigits(nextDigits, [2, 2, 2, 2])

  const isValidAt = (digits: string) => {
    const idx = digits.length - 1
    const value = Number(digits[idx])
    if (idx === 2 || idx === 4) return value <= 5
    return true
  }

  if (nextDigits.startsWith(prevDigits) && nextDigits.length === prevDigits.length + 1) {
    return isValidAt(nextDigits) ? formatParticipantDigits(nextDigits, [2, 2, 2, 2]) : formatParticipantDigits(prevDigits, [2, 2, 2, 2])
  }

  let accepted = ''
  for (const ch of nextDigits) {
    const candidate = accepted + ch
    const idx = candidate.length - 1
    const value = Number(ch)
    if ((idx === 2 || idx === 4) && value > 5) continue
    accepted = candidate
    if (accepted.length >= 8) break
  }
  return formatParticipantDigits(accepted, [2, 2, 2, 2])
}

export function sanitizeParticipantDigits(raw: string, maxDigits: number) {
  return String(raw || '').replace(/\D/g, '').slice(0, maxDigits)
}

export function formatParticipantDigits(raw: string, groups: number[]) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return ''
  const parts: string[] = []
  let offset = 0
  for (const size of groups) {
    if (offset >= digits.length) break
    parts.push(digits.slice(offset, offset + size))
    offset += size
  }
  return parts.join(':')
}

export function normalizeGrossTime(raw: string) {
  const digits = sanitizeParticipantDigits(raw, 8)
  const formatted = digits.length === 8 ? formatParticipantDigits(digits, [2, 2, 2, 2]) : ''
  return formatted && parseGrossTimeToCentis(formatted) != null ? formatted : ''
}

export function normalizeDeltaTime(raw: string) {
  const digits = sanitizeParticipantDigits(raw, 4)
  return digits.length === 4 ? formatParticipantDigits(digits, [2, 2]) : ''
}

export function isValidGrossTime(raw: string) {
  return parseGrossTimeToCentis(raw) != null
}

export function isValidDeltaTime(raw: string) {
  return sanitizeParticipantDigits(raw, 4).length === 4
}

export function parseGrossTimeToCentis(raw?: string) {
  const digits = sanitizeParticipantDigits(raw || '', 8)
  if (digits.length !== 8) return null
  const hh = Number(digits.slice(0, 2))
  const mm = Number(digits.slice(2, 4))
  const ss = Number(digits.slice(4, 6))
  const dd = Number(digits.slice(6, 8))
  if (mm > 59 || ss > 59 || dd > 99) return null
  return (((hh * 60 + mm) * 60) + ss) * 100 + dd
}

export function parseDeltaTimeToCentis(raw?: string) {
  const digits = sanitizeParticipantDigits(raw || '', 4)
  if (digits.length !== 4) return null
  const mm = Number(digits.slice(0, 2))
  const ss = Number(digits.slice(2, 4))
  if (mm > 99 || ss > 59) return null
  return (mm * 60 + ss) * 100
}

export function formatCentisToGrossTime(totalCentis: number | null | undefined) {
  if (totalCentis == null || !Number.isFinite(totalCentis)) return ''
  const safe = Math.max(0, Math.round(totalCentis))
  const dd = safe % 100
  const totalSeconds = Math.floor(safe / 100)
  const ss = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const mm = totalMinutes % 60
  const hh = Math.floor(totalMinutes / 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(dd).padStart(2, '0')}`
}

export function formatCentisToDeltaTime(totalCentis: number | null | undefined) {
  if (totalCentis == null || !Number.isFinite(totalCentis)) return ''
  const safe = Math.max(0, Math.round(totalCentis))
  const totalSeconds = Math.floor(safe / 100)
  const mm = Math.floor(totalSeconds / 60)
  const ss = totalSeconds % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function computeNetTime(grossTime?: string, penaltyTime?: string, bonusTime?: string) {
  const gross = parseGrossTimeToCentis(grossTime)
  if (gross == null) return ''
  const penalty = parseDeltaTimeToCentis(penaltyTime) || 0
  const bonus = parseDeltaTimeToCentis(bonusTime) || 0
  return formatCentisToGrossTime(Math.max(0, gross + penalty - bonus))
}

export function participantHasData(row?: Partial<ParticipantEntry> | null) {
  if (!row) return false
  return !!(
    row.noShow ||
    sanitizeParticipantName(row.fullName || '') ||
    row.gender ||
    row.category ||
    normalizeGrossTime(row.grossTime || '') ||
    normalizeDeltaTime(row.penaltyTime || '') ||
    normalizeDeltaTime(row.bonusTime || '')
  )
}

export function extraPenaltyCentisFromSummary(summary?: DorsalSummary | null) {
  if (!summary) return 0
  return (summary.penalties || []).reduce((acc, item) => acc + (item.completed ? 0 : item.minutes * 60 * 100), 0)
}

export function extraBonusCentisFromSummary(summary?: DorsalSummary | null) {
  if (!summary) return 0
  return Math.max(0, Number(summary.greenAssistSeconds || 0)) * 100
}

export function computeEffectiveParticipantTimes(row: ParticipantEntry, summary?: DorsalSummary | null): ClassificationRow {
  const penaltyCentis = extraPenaltyCentisFromSummary(summary)
  const bonusCentis = extraBonusCentisFromSummary(summary)
  const penaltyTimeEffective = penaltyCentis > 0 ? formatCentisToDeltaTime(penaltyCentis) : ''
  const bonusTimeEffective = bonusCentis > 0 ? formatCentisToDeltaTime(bonusCentis) : ''
  return {
    ...row,
    penaltyTimeEffective,
    bonusTimeEffective,
    netTimeEffective: computeNetTime(row.grossTime, penaltyTimeEffective, bonusTimeEffective),
  }
}

export function sortParticipantsForClassification(rows: ClassificationRow[]) {
  return rows.slice().sort((a, b) => {
    const ta = parseGrossTimeToCentis(a.netTimeEffective) ?? Number.MAX_SAFE_INTEGER
    const tb = parseGrossTimeToCentis(b.netTimeEffective) ?? Number.MAX_SAFE_INTEGER
    return ta - tb || a.bib - b.bib || (a.fullName || '').localeCompare(b.fullName || '')
  })
}

function matchesFilter(row: Pick<ParticipantEntry, 'gender' | 'category'>, filter: ClassificationFilter) {
  if (filter.gender && row.gender !== filter.gender) return false
  if (filter.category && row.category !== filter.category) return false
  return true
}

function compactBibRow(row: ParticipantEntry): ClassificationBibRow {
  return {
    bib: row.bib,
    fullName: row.fullName || '',
    gender: row.gender || '',
    category: row.category || '',
  }
}

export function buildClassificationSections(rows: ParticipantEntry[], filter: ClassificationFilter, summaries?: Map<number, DorsalSummary>) {
  const prepared = rows
    .map((row) => ({ raw: row, effective: computeEffectiveParticipantTimes(row, summaries?.get(row.bib)), summary: summaries?.get(row.bib) }))
    .filter(({ raw, effective, summary }) => !!raw.fullName?.trim() && (raw.noShow || summary?.withdrawn || summary?.dsq || !!normalizeGrossTime(effective.grossTime || '')))
    .filter(({ raw }) => matchesFilter(raw, filter))

  const finished = sortParticipantsForClassification(
    prepared
      .filter(({ raw, effective, summary }) => {
        if (raw.noShow) return false
        if (summary?.dsq) return false
        if (summary?.withdrawn) return false
        if (!normalizeGrossTime(effective.grossTime || '')) return false
        return true
      })
      .map(({ effective }) => effective)
  )

  const expelled = prepared
    .filter(({ raw, summary }) => !raw.noShow && !!summary?.dsq)
    .map(({ raw }) => compactBibRow(raw))
    .sort((a, b) => a.bib - b.bib || a.fullName.localeCompare(b.fullName))

  const withdrawn = prepared
    .filter(({ raw, summary }) => !raw.noShow && !summary?.dsq && summary?.withdrawn)
    .map(({ raw }) => compactBibRow(raw))
    .sort((a, b) => a.bib - b.bib || a.fullName.localeCompare(b.fullName))

  const noShows = prepared
    .filter(({ raw }) => !!raw.noShow)
    .map(({ raw }) => compactBibRow(raw))
    .sort((a, b) => a.bib - b.bib || a.fullName.localeCompare(b.fullName))

  return { finished, expelled, withdrawn, noShows }
}

export function filterParticipantsForClassification(rows: ParticipantEntry[], filter: ClassificationFilter, summaries?: Map<number, DorsalSummary>) {
  return buildClassificationSections(rows, filter, summaries).finished
}
