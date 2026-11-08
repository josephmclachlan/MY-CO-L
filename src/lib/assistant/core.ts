// FARM ASSISTANT (build G10): shared types, word matching and date ranges.
//
// The assistant's only knowledge is this app's own records and screens. Every answer comes from a TOOL
// (src/lib/assistant/tools.ts) that reads the Store; every save is a PLAN the person confirms, and the
// plan's apply() runs inside store.action(), so it is one UNDO step with an edit-history line.
// The words in here are used by both brains: the rule parser (rules.ts) and the local model (llm.ts),
// whose tool arguments are cleaned up through the same resolvers.

import { SPECIES } from '../../data/species'
import { ROOMS } from '../../data/rooms'
import { STRAIN_PREFIX, addDays } from '../xeno'
import { weekOf } from '../ledger'
import { PLACES, type PlaceId } from '../sensors'
import type { Role } from '../roles'
import type { Store } from '../store'
import type { Go, Doc } from '../search'

export type { Go }

/** Where an answer came from: a screen (and tab) the person can open to check it. */
export interface Cite {
  label: string
  go: Go
}

/** A save the person must confirm. Nothing is written until apply() runs. */
export interface Plan {
  tool: string
  /** One line for the edit history and the UNDO list. */
  label: string
  /** What will be saved, line by line, shown before CONFIRM. */
  lines: string[]
  cite: Cite[]
  /** Writes the records. Called inside store.action(). Returns the line shown after saving. */
  apply: (store: Store) => Promise<string>
}

export type ToolOut =
  | { kind: 'answer'; lines: string[]; cite: Cite[] }
  | { kind: 'open'; lines: string[]; cite: Cite[]; go: Go }
  | { kind: 'plan'; plan: Plan }
  /** More is needed before anything can be done (which lot? how many kg?). */
  | { kind: 'ask'; lines: string[]; cite: Cite[] }
  /** STAFF asked for money. */
  | { kind: 'denied'; lines: string[] }

export interface AskCtx {
  store: Store
  role: Role
  /** Now (ms) and the farm's calendar day. */
  now: number
  today: string
  /** Initials saved on this device by the harvest forms, for harvest lines. */
  initials: string
  /** The search index, when the screen has it (FIND tool). */
  docs?: Doc[]
}

export type Args = Record<string, unknown>

// ---------- text ----------

/** Lower case, accents off, curly quotes straight, extra spaces gone. Dots, dashes, % and ' stay. */
export function clean(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9.,%'°\-/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
export const numArg = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const n = Number(v.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export const kgText = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)} KG`
export const crcText = (n: number) => `₡${Math.round(n).toLocaleString('en-US')}`
export const plural = (n: number, one: string, many = `${one}S`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

// ---------- species ----------

const SPECIES_WORDS: { key: string; words: string[] }[] = SPECIES.map((s) => {
  const name = clean(s.name)
  const flat = name.replace(/'/g, '')
  const words = new Set([s.id, s.id.replace(/-/g, ' '), name, flat, flat.replace(/s\b/, '')])
  const first = flat.split(' ')[0]
  // A first word on its own names the species unless it is a plain word ("king" is fine, "black" is not).
  if (!['black', 'oyster'].includes(first)) words.add(first)
  if (s.id === 'lions-mane') ['lions', 'lion', 'lion mane', 'lions mane', 'melena', 'melena de leon'].forEach((w) => words.add(w))
  if (s.id === 'blue-oyster') ['blue', 'blues', 'ostra azul'].forEach((w) => words.add(w))
  if (s.id === 'golden-oyster') ['gold', 'yellow oyster'].forEach((w) => words.add(w))
  if (s.id === 'king-oyster') ['king', 'kings', 'king trumpet'].forEach((w) => words.add(w))
  if (s.id === 'black-pearl') ['black pearl', 'pearl'].forEach((w) => words.add(w))
  if (s.id === 'comb-tooth') ['comb', 'combtooth', 'comb tooth'].forEach((w) => words.add(w))
  return { key: s.id, words: [...words].filter(Boolean) }
})
/** Two-letter strain prefixes (LM, BO ...) also name the species. "go" is too common a word to count. */
const PREFIX_TO_SPECIES = new Map(Object.entries(STRAIN_PREFIX).filter(([, p]) => p !== 'GO').map(([k, p]) => [p.toLowerCase(), k]))

export const speciesName = (key: string | null | undefined) => (key ? SPECIES.find((s) => s.id === key)?.name ?? key.toUpperCase() : 'ALL SPECIES')

/** A species key from any way of writing it: id, name, first word, LM/BO prefix. null = none or not sure. */
export function resolveSpecies(v: unknown): string | null {
  const s = clean(str(v)).replace(/\bmushrooms?\b/g, '').trim()
  if (!s) return null
  for (const sp of SPECIES_WORDS) if (sp.words.includes(s)) return sp.key
  if (PREFIX_TO_SPECIES.has(s)) return PREFIX_TO_SPECIES.get(s)!
  return null
}

/** Species named anywhere in a sentence, longest name first ("golden oyster" before "oyster"). */
export function findSpecies(text: string): { key: string; at: number; len: number } | null {
  const t = ` ${clean(text)} `
  let best: { key: string; at: number; len: number } | null = null
  for (const sp of SPECIES_WORDS) {
    for (const w of sp.words) {
      if (w.length < 3) continue
      const at = t.indexOf(` ${w.replace(/'/g, "'")} `)
      const at2 = at < 0 ? t.replace(/'/g, '').indexOf(` ${w.replace(/'/g, '')} `) : at
      if (at2 >= 0 && (!best || w.length > best.len)) best = { key: sp.key, at: at2, len: w.length }
    }
  }
  if (best) return best
  const words = t.trim().split(' ')
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (PREFIX_TO_SPECIES.has(w)) return { key: PREFIX_TO_SPECIES.get(w)!, at: i, len: 2 }
  }
  return null
}

// ---------- rooms and places ----------

const ROOM_WORDS: [string, string[]][] = [
  ['lab', ['lab', 'laboratory', 'clean room', 'laboratorio']],
  ['incubation', ['incubation', 'incubator', 'incubating room', 'spawn room', 'incubacion']],
  ['fruiting', ['fruiting', 'fruit room', 'fruiting room', 'grow room', 'fructificacion']],
  ['packing', ['packing', 'pack room', 'packing room', 'empaque']],
  ['boiling', ['cook room', 'cooking room', 'boiling', 'boiler', 'boiling room', 'steam room', 'caldera']],
]
/** A DECK PLAN room id (where lots sit) from words. */
export function resolveRoom(v: unknown): string | null {
  const s = clean(str(v)).replace(/\broom\b/g, '').trim()
  if (!s) return null
  if (ROOMS.some((r) => r.id === s)) return s
  for (const [id, words] of ROOM_WORDS) if (words.some((w) => w.replace(/\broom\b/g, '').trim() === s)) return id
  return null
}

const PLACE_WORDS: [PlaceId, string[]][] = [
  ['fridge', ['fridge', 'culture fridge', 'chest fridge', 'refrigerator']],
  ['coldroom', ['cold room', 'cold rooms', 'coldroom', 'cooler', 'walk in']],
  ['outside', ['outside', 'outdoors', 'shade']],
  ['lab', ['lab', 'laboratory']],
  ['incubation', ['incubation', 'incubator', 'spawn room']],
  ['fruiting', ['fruiting', 'fruit room', 'grow room']],
  ['packing', ['packing', 'plenum', 'pack room']],
  ['boiling', ['cook room', 'cook', 'boiling', 'boiler']],
]
/** A climate-sensor place from words. */
export function resolvePlace(v: unknown): PlaceId | null {
  const s = clean(str(v)).replace(/\b(the|room|air)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  if (PLACES.some((p) => p.id === s)) return s as PlaceId
  for (const [id, words] of PLACE_WORDS) if (words.includes(s)) return id
  return null
}
/** A place named anywhere in a sentence. Longer names first so "cold room" beats nothing and "culture fridge" beats "fridge". */
export function findPlace(text: string): PlaceId | null {
  const t = ` ${clean(text)} `
  let best: { id: PlaceId; len: number } | null = null
  for (const [id, words] of PLACE_WORDS) for (const w of words) if (t.includes(` ${w} `) && (!best || w.length > best.len)) best = { id, len: w.length }
  return best?.id ?? null
}
export function findRoom(text: string): string | null {
  const t = ` ${clean(text)} `
  for (const [id, words] of ROOM_WORDS) for (const w of words) if (t.includes(` ${w} `)) return id
  return null
}

// ---------- date ranges ----------

export const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'this_year', 'all'] as const
export type Period = (typeof PERIODS)[number]
export const PERIOD_LABEL: Record<Period, string> = {
  today: 'TODAY',
  yesterday: 'YESTERDAY',
  this_week: 'THIS WEEK',
  last_week: 'LAST WEEK',
  last_7_days: 'THE LAST 7 DAYS',
  this_month: 'THIS MONTH',
  last_month: 'LAST MONTH',
  last_30_days: 'THE LAST 30 DAYS',
  this_year: 'THIS YEAR',
  all: 'ALL TIME',
}

export function resolvePeriod(v: unknown, fallback: Period = 'all'): Period {
  const s = clean(str(v)).replace(/[\s-]+/g, '_')
  if ((PERIODS as readonly string[]).includes(s)) return s as Period
  const p = findPeriod(str(v))
  return p ?? fallback
}

/** A period named in a sentence. */
export function findPeriod(text: string): Period | null {
  const t = ` ${clean(text)} `
  if (/ (today|tonight|this morning|hoy) /.test(t)) return 'today'
  if (/ (yesterday|ayer) /.test(t)) return 'yesterday'
  if (/ last week /.test(t)) return 'last_week'
  if (/ (this week|so far this week|esta semana) /.test(t)) return 'this_week'
  if (/ (last|past) 7 days /.test(t)) return 'last_7_days'
  if (/ last month /.test(t)) return 'last_month'
  if (/ (this month|month so far|este mes) /.test(t)) return 'this_month'
  if (/ (last|past) 30 days /.test(t)) return 'last_30_days'
  if (/ (this year|ytd|year to date|este ano) /.test(t)) return 'this_year'
  if (/ (ever|all time|in total|altogether|so far) /.test(t)) return 'all'
  return null
}

/** First and last day (both included) of a period, on the farm's calendar. */
export function periodRange(p: Period, today: string): { from: string; to: string; label: string } {
  const label = PERIOD_LABEL[p]
  switch (p) {
    case 'today':
      return { from: today, to: today, label }
    case 'yesterday': {
      const y = addDays(today, -1)
      return { from: y, to: y, label }
    }
    case 'this_week':
      return { from: weekOf(today), to: today, label }
    case 'last_week': {
      const mon = addDays(weekOf(today), -7)
      return { from: mon, to: addDays(mon, 6), label }
    }
    case 'last_7_days':
      return { from: addDays(today, -6), to: today, label }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today, label }
    case 'last_month': {
      const first = `${today.slice(0, 7)}-01`
      const lastDay = addDays(first, -1)
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay, label }
    }
    case 'last_30_days':
      return { from: addDays(today, -29), to: today, label }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label }
    default:
      return { from: '0000-01-01', to: '9999-12-31', label }
  }
}
export const inRange = (day: string | null | undefined, r: { from: string; to: string }) => !!day && day.slice(0, 10) >= r.from && day.slice(0, 10) <= r.to

/** A day from words: today, yesterday, or yyyy-mm-dd. */
export function resolveDay(v: unknown, today: string): string | null {
  const s = clean(str(v))
  if (!s || s === 'today' || s === 'hoy') return today
  if (s === 'yesterday' || s === 'ayer') return addDays(today, -1)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}
