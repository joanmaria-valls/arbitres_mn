import raw from './faltes.json'
import type { Fault } from '../types'

export const FALTES: Fault[] = raw as Fault[]

const STOP_WORDS = new Set([
  'atencio',
  'atensio',
  'tencio',
  'falta',
  'faltes',
  'numero',
  'número',
  'el',
  'la',
  'els',
  'les',
  'de',
  'del',
  'des',
  'per',
  'amb',
  'una',
  'un',
  'i',
  'o',
  'quan',
  'durant',
  'qualsevol',
  'sigui',
  'forma'
])

const DESC_STOP_WORDS = new Set([
  ...STOP_WORDS,
  'a',
  'al',
  'dels',
  'ni',
  'no',
  'es',
  'lo'
])

export function faultById(id: string): Fault | undefined {
  return FALTES.find((f) => f.id === id)
}

function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\baxillar\b/g, 'axilar')
    .replace(/\baxil lar\b/g, 'axilar')
    .replace(/\bbaston\b/g, 'basto')
    .replace(/\bbastones\b/g, 'bastons')
    .replace(/\bpastor\b/g, 'basto')
    .replace(/\btorsal\b/g, 'dorsal')
    .replace(/\bi per extensio\b/g, 'hiperextensio')
    .replace(/\bhabitualment\b/g, 'avituallament')
    .replace(/\bde tenir se\b/g, 'detenir')
    .replace(/\bde tenir\b/g, 'detenir')
    .replace(/\bdeternir\b/g, 'detenir')
    .replace(/\bpats\b/g, 'pads')
    .replace(/\bpat\b/g, 'pad')
    .replace(/\bal qual\b/g, 'alcohol')
    .replace(/\bel qual\b/g, 'alcohol')
    .replace(/\balcol\b/g, 'alcohol')
    .replace(/\balcool\b/g, 'alcohol')
    .replace(/\bpuntera\b/g, 'punta')
    .replace(/\btrota\b/g, 'trotar')
    .replace(/\bsalto\b/g, 'saltar')
    .replace(/\bsalta\b/g, 'saltar')
    .replace(/\bcorre\b/g, 'correr')
    .replace(/\bcorriendo\b/g, 'correr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function tokenize(s: string): string[] {
  const n = normalizeToken(s)
  if (!n) return []
  return n.split(/\s+/g).filter((t) => Boolean(t) && t.length > 1)
}

export type Match = { fault: Fault; score: number }

type FaultTerms = {
  idTerms: string[]
  keywordTerms: string[]
  descTerms: string[]
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs))
}

function faultTerms(f: Fault): FaultTerms {
  return {
    idTerms: uniq([f.id, ...tokenize(f.id)]),
    keywordTerms: uniq(f.k.flatMap((k) => tokenize(k))),
    descTerms: uniq(tokenize(f.desc).filter((t) => !DESC_STOP_WORDS.has(t)))
  }
}

function hasPrefixMatch(t: string, terms: string[], minLen = 4): boolean {
  return t.length >= minLen && terms.some((k) => k.length >= minLen && (k.startsWith(t) || t.startsWith(k)))
}

function hasContainsMatch(t: string, terms: string[], minLen = 6): boolean {
  return t.length >= minLen && terms.some((k) => k.length >= minLen && (k.includes(t) || t.includes(k)))
}

/**
 * Matching tolerant per veu/tecleig.
 * Dona més pes a les paraules clau definides a "k",
 * manté suport pel codi i deixa la descripció com a ajuda secundària.
 */
export function matchFaults(phrase: string, limit = 6): Match[] {
  const tokens = tokenize(phrase).filter((t) => !STOP_WORDS.has(t))
  if (!tokens.length) return []

  const out: Match[] = []
  for (const f of FALTES) {
    const { idTerms, keywordTerms, descTerms } = faultTerms(f)
    let score = 0

    for (const t of tokens) {
      if (!t) continue

      if (keywordTerms.includes(t) || idTerms.includes(t)) {
        score += 4
        continue
      }
      if (hasPrefixMatch(t, keywordTerms) || hasPrefixMatch(t, idTerms)) {
        score += 2
        continue
      }
      if (descTerms.includes(t)) {
        score += 1.5
        continue
      }
      if (hasPrefixMatch(t, descTerms)) {
        score += 0.75
        continue
      }
      if (hasContainsMatch(t, keywordTerms)) {
        score += 1
      }
    }

    if (score > 0) out.push({ fault: f, score })
  }

  out.sort((a, b) => b.score - a.score || a.fault.id.localeCompare(b.fault.id))
  return out.slice(0, limit)
}
