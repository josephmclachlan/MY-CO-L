// PRODUCTION RECORDS (build G4): flush log with BE%, strain scorecard, fading-strain warning, strain trials,
// split a lot. Pure functions: no React, no store. Screens hand in rows.
//
// BE% (biological efficiency) = fresh kg picked / dry substrate kg x 100.
// Dry substrate per block = 4 lb (Joseph's block: 10 lb = 4 lb dry sawdust/soy hull + 6 lb water),
// unless the lot carries its own `dry_kg_per_block`. Blocks = blocks still alive (knocked minus logged losses).

import { SPECIES } from '../data/species'
import { ROOMS } from '../data/rooms'
import { addDays, daysBetween, parseDay, isoDay, type BlockLot, type Strain } from './xeno'
import type { Row } from './store'
import type { Harvest } from './ledger'
import type { LotLoss } from './hazard'
import type { CookRun } from './cook'
import { expectFor, lotLost } from './mission'
import { LB_TO_KG } from './runplan'

/** Rooms a lot can sit in. Incubation and fruiting hold blocks; the others are listed for odd cases. */
export const ROOM_CHOICES = ROOMS.map((r) => ({ id: r.id as string, name: r.name.toUpperCase() }))
export const roomName = (id: string | null | undefined) => (id ? ROOM_CHOICES.find((r) => r.id === id)?.name ?? id.toUpperCase() : 'NOT SET')

export const BLOCK_DRY_LB = 4
export const BLOCK_DRY_KG = BLOCK_DRY_LB * LB_TO_KG

// ---------- rows ----------

export interface FlushLog extends Row {
  id: string
  block_lot_id: string
  flush: number
  pinned_on: string
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface StrainTrial extends Row {
  id: string
  name: string
  species_key: string
  status: 'running' | 'done'
  started_on: string
  ended_on: string | null
  question: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

// ---------- small helpers ----------

export const kgFmt = (n: number | null, d = 2) => (n === null ? '-' : n.toFixed(d))
export const pctFmt = (n: number | null) => (n === null ? '-' : `${n.toFixed(1)}%`)
export const daysFmt = (n: number | null) => (n === null ? '-' : n.toFixed(1))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** ISO week label of a day, like 2026-W45 (weeks start Monday). */
export function isoWeek(day: string): string {
  const d = parseDay(day)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dow)
  const y = t.getUTCFullYear()
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7)
  return `${y}-W${String(w).padStart(2, '0')}`
}

/** Monday of the ISO week, for a readable label. */
export function weekStart(day: string): string {
  const d = parseDay(day)
  const dow = d.getDay() || 7
  d.setDate(d.getDate() - (dow - 1))
  return isoDay(d)
}

export const dryKgPerBlock = (lot: BlockLot) => (lot.dry_kg_per_block && lot.dry_kg_per_block > 0 ? Number(lot.dry_kg_per_block) : BLOCK_DRY_KG)
export const survivors = (lot: BlockLot, losses: LotLoss[]) => Math.max(0, lot.bag_count - lotLost(losses, lot.id))

// ---------- flush log and per-lot record ----------

export interface FlushRow {
  flush: number
  kg: number
  picks: number
  firstPick: string | null
  lastPick: string | null
  pinnedOn: string | null
  daysPinToPick: number | null
  be: number | null // this flush alone
  cumBe: number | null // flushes 1..n together
  kgPerBlock: number | null
  grades: Record<string, number>
}

export interface LotRecord {
  lot: BlockLot
  blocks: number // alive now
  lost: number
  contamPct: number | null // lost / knocked
  dryKg: number // dry substrate of the surviving blocks
  kg: number
  kgPerBlock: number | null
  be: number | null
  expectedBe: number | null // Catawba's real pick for the species, as BE%
  vsExpectedPct: number | null // BE as a share of expected
  flushes: FlushRow[]
  daysToPin: number | null // knock to the first pins
  daysToFirstPick: number | null
  firstPick: string | null
  /** All the species' flushes are in, or the lot is spent. Only complete lots count in yield averages. */
  complete: boolean
}

export function lotRecord(lot: BlockLot, losses: LotLoss[], harvests: Harvest[], pins: FlushLog[]): LotRecord {
  const ex = expectFor(lot.species_key)
  const lost = lotLost(losses, lot.id)
  const blocks = Math.max(0, lot.bag_count - lost)
  const dry = dryKgPerBlock(lot)
  const dryKg = blocks * dry
  const mine = harvests.filter((h) => h.block_lot_id === lot.id)
  const myPins = pins.filter((p) => p.block_lot_id === lot.id)
  const nums = [...new Set([...mine.map((h) => h.flush), ...myPins.map((p) => p.flush)])].sort((a, b) => a - b)
  let cum = 0
  const flushes: FlushRow[] = nums.map((f) => {
    const hs = mine.filter((h) => h.flush === f)
    const kg = hs.reduce((n, h) => n + Number(h.kg), 0)
    cum += kg
    const days = hs.map((h) => h.harvested_on).sort()
    const pin = myPins.filter((p) => p.flush === f).map((p) => p.pinned_on).sort()[0] ?? null
    const grades: Record<string, number> = {}
    for (const h of hs) grades[h.grade ?? '-'] = (grades[h.grade ?? '-'] ?? 0) + Number(h.kg)
    return {
      flush: f,
      kg,
      picks: hs.length,
      firstPick: days[0] ?? null,
      lastPick: days[days.length - 1] ?? null,
      pinnedOn: pin,
      daysPinToPick: pin && days[0] ? daysBetween(pin, days[0]) : null,
      be: dryKg > 0 && hs.length ? (kg / dryKg) * 100 : null,
      cumBe: dryKg > 0 ? (cum / dryKg) * 100 : null,
      kgPerBlock: blocks > 0 && hs.length ? kg / blocks : null,
      grades,
    }
  })
  const kg = mine.reduce((n, h) => n + Number(h.kg), 0)
  const firstPick = mine.map((h) => h.harvested_on).sort()[0] ?? null
  const pin1 = flushes.find((f) => f.flush === 1)?.pinnedOn ?? flushes.find((f) => f.pinnedOn)?.pinnedOn ?? null
  const be = dryKg > 0 && mine.length ? (kg / dryKg) * 100 : null
  const expectedBe = ex.kgPerBlock !== null ? (ex.kgPerBlock / dry) * 100 : null
  const flushesDone = new Set(mine.map((h) => h.flush)).size
  return {
    lot,
    blocks,
    lost,
    contamPct: lot.bag_count > 0 ? (lost / lot.bag_count) * 100 : null,
    dryKg,
    kg,
    kgPerBlock: blocks > 0 && mine.length ? kg / blocks : null,
    be,
    expectedBe,
    vsExpectedPct: be !== null && expectedBe ? (be / expectedBe) * 100 : null,
    flushes,
    daysToPin: pin1 ? daysBetween(lot.knock_date, pin1) : null,
    daysToFirstPick: firstPick ? daysBetween(lot.knock_date, firstPick) : null,
    firstPick,
    complete: lot.status !== 'lost' && mine.length > 0 && (lot.status === 'spent' || flushesDone >= ex.flushes),
  }
}

export function allRecords(lots: BlockLot[], losses: LotLoss[], harvests: Harvest[], pins: FlushLog[]): LotRecord[] {
  // Index once so thousands of lots stay quick.
  const lossBy = groupBy(losses, (l) => l.block_lot_id)
  const harvBy = groupBy(harvests, (h) => h.block_lot_id)
  const pinBy = groupBy(pins, (p) => p.block_lot_id)
  return lots.map((l) => lotRecord(l, lossBy.get(l.id) ?? [], harvBy.get(l.id) ?? [], pinBy.get(l.id) ?? []))
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const a = m.get(k)
    if (a) a.push(x)
    else m.set(k, [x])
  }
  return m
}

/** The flush a new "pins showed" belongs to: the one pinned but not yet picked, else the next one. */
export function nextPinFlush(lotId: string, harvests: Harvest[], pins: FlushLog[]): number {
  const picked = Math.max(0, ...harvests.filter((h) => h.block_lot_id === lotId).map((h) => h.flush))
  const pinned = Math.max(0, ...pins.filter((p) => p.block_lot_id === lotId).map((p) => p.flush))
  return Math.min(9, pinned > picked ? pinned : picked + 1)
}

// ---------- group statistics ----------

export interface GroupStats {
  lots: number
  knocked: number // blocks inoculated
  lost: number
  contamPct: number | null
  yieldLots: number // complete lots that feed the yield figures
  yieldBlocks: number
  kg: number
  kgPerBlock: number | null
  be: number | null
  daysToPin: number | null
  daysToFirstPick: number | null
}

export function groupStats(recs: LotRecord[]): GroupStats {
  const knocked = recs.reduce((n, r) => n + r.lot.bag_count, 0)
  const lost = recs.reduce((n, r) => n + r.lost, 0)
  const y = recs.filter((r) => r.complete && r.blocks > 0)
  const kg = y.reduce((n, r) => n + r.kg, 0)
  const blocks = y.reduce((n, r) => n + r.blocks, 0)
  const dry = y.reduce((n, r) => n + r.dryKg, 0)
  return {
    lots: recs.length,
    knocked,
    lost,
    contamPct: knocked ? (lost / knocked) * 100 : null,
    yieldLots: y.length,
    yieldBlocks: blocks,
    kg,
    kgPerBlock: blocks ? kg / blocks : null,
    be: dry ? (kg / dry) * 100 : null,
    daysToPin: mean(recs.flatMap((r) => (r.daysToPin === null ? [] : [r.daysToPin]))),
    daysToFirstPick: mean(recs.flatMap((r) => (r.daysToFirstPick === null ? [] : [r.daysToFirstPick]))),
  }
}

// ---------- scorecard ----------

export type Dimension = 'STRAIN' | 'COOK RUN' | 'ROOM' | 'WEEK' | 'WORKER'
export const DIMENSIONS: Dimension[] = ['STRAIN', 'COOK RUN', 'ROOM', 'WEEK', 'WORKER']

export interface ScoreRow {
  key: string
  label: string
  sub: string
  stats: GroupStats
  best: boolean // top BE of the table (needs 2+ rows with BE)
  worst: boolean
}

export interface ScoreCtx {
  strains: Strain[]
  cooks: CookRun[]
}

const NOT_SET = 'NOT SET'

export function dimKey(d: Dimension, lot: BlockLot): string {
  switch (d) {
    case 'STRAIN':
      return lot.strain_id ?? ''
    case 'COOK RUN':
      return lot.cook_run_id ?? ''
    case 'ROOM':
      return lot.room ?? ''
    case 'WEEK':
      return isoWeek(lot.knock_date)
    case 'WORKER':
      return (lot.knocked_by ?? '').trim().toUpperCase()
  }
}

function dimLabel(d: Dimension, key: string, ctx: ScoreCtx): { label: string; sub: string } {
  if (!key && d !== 'WEEK') return { label: NOT_SET, sub: '' }
  switch (d) {
    case 'STRAIN': {
      const s = ctx.strains.find((x) => x.id === key)
      return { label: s?.code ?? '?', sub: s?.name ?? '' }
    }
    case 'COOK RUN': {
      const c = ctx.cooks.find((x) => x.id === key)
      return { label: c ? `${(c.started_at ?? c.created_at ?? '').slice(0, 10)} ${c.unit_label ?? String(c.kind).toUpperCase()}` : '?', sub: c?.load_desc ?? '' }
    }
    case 'ROOM':
      return { label: (ROOMS.find((r) => r.id === key)?.name ?? key).toUpperCase(), sub: '' }
    case 'WEEK':
      return { label: key, sub: '' }
    case 'WORKER':
      return { label: key, sub: '' }
  }
}

/** Best first by BE%, then by lots. Rows without BE go last. */
export function scorecard(d: Dimension, recs: LotRecord[], ctx: ScoreCtx, speciesKey: string | null = null): ScoreRow[] {
  const use = speciesKey ? recs.filter((r) => r.lot.species_key === speciesKey) : recs
  const groups = groupBy(use, (r) => dimKey(d, r.lot))
  const rows: ScoreRow[] = [...groups].map(([key, rs]) => {
    const l = dimLabel(d, key, ctx)
    return { key, label: l.label, sub: d === 'WEEK' ? `MON ${weekStart(rs[0].lot.knock_date)}` : l.sub, stats: groupStats(rs), best: false, worst: false }
  })
  rows.sort((a, b) => {
    if (d === 'WEEK') return b.key.localeCompare(a.key) // newest week first
    const A = a.stats.be
    const B = b.stats.be
    if (A === null && B === null) return b.stats.lots - a.stats.lots || a.label.localeCompare(b.label)
    if (A === null) return 1
    if (B === null) return -1
    return B - A || a.label.localeCompare(b.label)
  })
  const withBe = rows.filter((r) => r.stats.be !== null)
  if (withBe.length >= 2) {
    const hi = Math.max(...withBe.map((r) => r.stats.be!))
    const lo = Math.min(...withBe.map((r) => r.stats.be!))
    if (hi !== lo) for (const r of withBe) (r.best = r.stats.be === hi), (r.worst = r.stats.be === lo)
  }
  return rows
}

/** Kg picked by whoever did the picking (harvest initials). */
export interface PickerRow {
  who: string
  kg: number
  picks: number
  lots: number
}
export function pickerTotals(harvests: Harvest[]): PickerRow[] {
  const m = new Map<string, { kg: number; picks: number; lots: Set<string> }>()
  for (const h of harvests) {
    const k = (h.initials ?? '').trim().toUpperCase() || NOT_SET
    const e = m.get(k) ?? { kg: 0, picks: 0, lots: new Set<string>() }
    e.kg += Number(h.kg)
    e.picks++
    e.lots.add(h.block_lot_id)
    m.set(k, e)
  }
  return [...m].map(([who, e]) => ({ who, kg: e.kg, picks: e.picks, lots: e.lots.size })).sort((a, b) => b.kg - a.kg || a.who.localeCompare(b.who))
}

// ---------- fading strains ----------

export interface Fading {
  strain: Strain
  lots: number // complete lots with a BE figure
  recentBe: number
  earlierBe: number
  dropPct: number
  recentCodes: string[]
  fading: boolean
}

/**
 * A strain is FADING when the newest three finished lots average a BE% lower than all its earlier finished lots
 * by the slipping percentage (default 15%, a GUESS shared with the culture bank). Needs 2 earlier lots.
 */
export function fadingStrains(strains: Strain[], recs: LotRecord[], dropPct = 15): Fading[] {
  const byStrain = groupBy(
    recs.filter((r) => r.lot.strain_id && r.complete && r.be !== null),
    (r) => r.lot.strain_id!,
  )
  const out: Fading[] = []
  for (const s of strains) {
    const rs = (byStrain.get(s.id) ?? []).slice().sort((a, b) => a.lot.knock_date.localeCompare(b.lot.knock_date) || a.lot.lot_code.localeCompare(b.lot.lot_code))
    if (rs.length < 5) continue
    const recent = rs.slice(-3)
    const earlier = rs.slice(0, -3)
    const rb = mean(recent.map((r) => r.be!))!
    const eb = mean(earlier.map((r) => r.be!))!
    const drop = eb > 0 ? ((eb - rb) / eb) * 100 : 0
    out.push({ strain: s, lots: rs.length, recentBe: rb, earlierBe: eb, dropPct: drop, recentCodes: recent.map((r) => r.lot.lot_code), fading: drop >= dropPct })
  }
  return out.sort((a, b) => b.dropPct - a.dropPct)
}

// ---------- strain trials ----------

export interface TrialArm {
  strainId: string | null
  label: string
  stats: GroupStats
  lotCodes: string[]
  bestBe: boolean
  bestKg: boolean
  bestPin: boolean
  bestContam: boolean
}

export function trialArms(trial: StrainTrial, recs: LotRecord[], strains: Strain[]): TrialArm[] {
  const mine = recs.filter((r) => r.lot.trial_id === trial.id)
  const groups = groupBy(mine, (r) => r.lot.strain_id ?? '')
  const arms: TrialArm[] = [...groups].map(([sid, rs]) => ({
    strainId: sid || null,
    label: sid ? strains.find((s) => s.id === sid)?.code ?? '?' : NOT_SET,
    stats: groupStats(rs),
    lotCodes: rs.map((r) => r.lot.lot_code).sort(),
    bestBe: false,
    bestKg: false,
    bestPin: false,
    bestContam: false,
  }))
  arms.sort((a, b) => a.label.localeCompare(b.label))
  const mark = (get: (a: TrialArm) => number | null, low: boolean, set: (a: TrialArm) => void) => {
    const xs = arms.filter((a) => get(a) !== null)
    if (xs.length < 2) return
    const vals = xs.map((a) => get(a)!)
    const best = low ? Math.min(...vals) : Math.max(...vals)
    if (Math.min(...vals) === Math.max(...vals)) return
    for (const a of xs) if (get(a) === best) set(a)
  }
  mark((a) => a.stats.be, false, (a) => (a.bestBe = true))
  mark((a) => a.stats.kgPerBlock, false, (a) => (a.bestKg = true))
  mark((a) => a.stats.daysToPin, true, (a) => (a.bestPin = true))
  mark((a) => a.stats.contamPct, true, (a) => (a.bestContam = true))
  return arms
}

export interface TrialVerdict {
  text: string
  warn: boolean
}
/** A plain-words reading of a trial. Warns when it is too early or the arms are not alike. */
export function trialVerdict(arms: TrialArm[]): TrialVerdict {
  if (arms.length < 2) return { text: 'NEEDS 2 OR MORE STRAINS. ADD LOTS OF EACH.', warn: true }
  const open = arms.filter((a) => a.stats.yieldLots === 0)
  if (open.length) return { text: `NO FINISHED LOT YET FOR ${open.map((a) => a.label).join(', ')}. WAIT FOR ALL FLUSHES.`, warn: true }
  const blocks = arms.map((a) => a.stats.yieldBlocks)
  const uneven = Math.max(...blocks) > Math.min(...blocks) * 1.5
  const lead = [...arms].sort((a, b) => (b.stats.be ?? 0) - (a.stats.be ?? 0))[0]
  const second = [...arms].sort((a, b) => (b.stats.be ?? 0) - (a.stats.be ?? 0))[1]
  const gap = lead.stats.be && second.stats.be ? ((lead.stats.be - second.stats.be) / second.stats.be) * 100 : 0
  const small = gap < 10
  return {
    text: `${lead.label} LEADS ON BE% (${pctFmt(lead.stats.be)} AGAINST ${pctFmt(second.stats.be)}, ${gap.toFixed(0)}% AHEAD).${small ? ' UNDER 10% APART: TREAT AS A TIE.' : ''}${uneven ? ' ARMS HAVE VERY DIFFERENT BLOCK COUNTS.' : ''}`,
    warn: small || uneven,
  }
}

// ---------- split a lot ----------

export interface SplitPlan {
  ok: boolean
  error?: string
  childCode: string
  parentLeft: number
  childBlocks: number
}

/** Next free split code: B1020-S1, B1020-S2 ... (checked against the same knock day). */
export function splitCode(parent: BlockLot, lots: BlockLot[]): string {
  const taken = new Set(lots.filter((l) => l.knock_date === parent.knock_date).map((l) => l.lot_code.toUpperCase()))
  const base = parent.lot_code.replace(/-S\d+$/, '')
  for (let i = 1; i < 100; i++) if (!taken.has(`${base}-S${i}`.toUpperCase())) return `${base}-S${i}`
  return `${base}-S99`
}

/**
 * Rules: move 1 or more blocks but not all of them, never more than are alive, and only before the first
 * pick (yield per block would be muddled after that). Losses logged so far stay with the original lot.
 */
export function planSplit(lot: BlockLot, losses: LotLoss[], harvests: Harvest[], lots: BlockLot[], n: number): SplitPlan {
  const alive = survivors(lot, losses)
  const childCode = splitCode(lot, lots)
  const bad = (error: string): SplitPlan => ({ ok: false, error, childCode, parentLeft: alive, childBlocks: 0 })
  if (!Number.isInteger(n) || n < 1) return bad('TYPE HOW MANY WHOLE BLOCKS TO SPLIT OFF.')
  if (lot.status === 'lost' || lot.status === 'spent') return bad(`A ${lot.status.toUpperCase()} LOT CANNOT BE SPLIT.`)
  if (harvests.some((h) => h.block_lot_id === lot.id)) return bad('THIS LOT HAS PICKS ALREADY. SPLIT BEFORE THE FIRST PICK SO KG PER BLOCK STAYS TRUE.')
  if (n >= alive) return bad(`THE LOT HAS ${alive} BLOCKS ALIVE. SPLIT OFF FEWER THAN ${alive}.`)
  return { ok: true, childCode, parentLeft: alive - n, childBlocks: n }
}

export const speciesLabel = (key: string) => SPECIES.find((s) => s.id === key)?.name ?? key.toUpperCase()

// ---------- FLUSH TEST (Joseph 6 Nov 2026: test multiple flushes on every crop before committing) ----------

export interface FlushTestRow {
  flush: number
  /** Finished lots that picked anything on this flush. */
  lots: number
  /** Average kg per block on this flush across ALL finished lots (a lot with no pick on it counts 0). */
  kgPerBlock: number
  /** This flush as a share of the species' total kg on finished lots. */
  sharePct: number
  /** This flush's kg per block as a share of flush 1's. */
  vsFirstPct: number | null
  /** Average days from the first pick of the flush before to the first pick of this one. */
  gapDays: number | null
}

export interface FlushTest {
  species: string
  finished: number
  open: number
  rows: FlushTestRow[]
  /** Smallest flush count that keeps every flush adding at least `minAddPct` of flush 1. Null until 3 finished lots. */
  suggest: number | null
}

/** Lots count once FINISHED (spent, or all the allowed flushes picked). Lost lots are left out. */
export function flushTest(recs: LotRecord[], species: string, minAddPct = 15, minLots = 3): FlushTest {
  const mine = recs.filter((r) => r.lot.species_key === species && r.lot.status !== 'lost')
  const done = mine.filter((r) => r.complete && r.blocks > 0)
  const open = mine.filter((r) => !r.complete && r.kg > 0).length
  const maxF = Math.max(0, ...done.flatMap((r) => r.flushes.filter((f) => f.picks > 0).map((f) => f.flush)))
  const total = done.reduce((n, r) => n + r.kg, 0)
  const rows: FlushTestRow[] = []
  for (let f = 1; f <= maxF; f++) {
    const per = done.map((r) => r.flushes.find((x) => x.flush === f))
    const kgPb = done.reduce((n, r, i) => n + (per[i] && per[i]!.picks > 0 ? per[i]!.kg / r.blocks : 0), 0) / (done.length || 1)
    const kg = done.reduce((n, _r, i) => n + (per[i]?.kg ?? 0), 0)
    const gaps: number[] = []
    if (f > 1)
      done.forEach((r) => {
        const a = r.flushes.find((x) => x.flush === f - 1)?.firstPick
        const b = r.flushes.find((x) => x.flush === f)?.firstPick
        if (a && b) gaps.push(daysBetween(a, b))
      })
    rows.push({
      flush: f,
      lots: per.filter((p) => p && p.picks > 0).length,
      kgPerBlock: kgPb,
      sharePct: total > 0 ? (kg / total) * 100 : 0,
      vsFirstPct: null,
      gapDays: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    })
  }
  const first = rows[0]?.kgPerBlock ?? 0
  for (const r of rows) r.vsFirstPct = first > 0 ? (r.kgPerBlock / first) * 100 : null
  let suggest: number | null = null
  if (done.length >= minLots && rows.length) {
    suggest = 1
    for (const r of rows.slice(1)) {
      if ((r.vsFirstPct ?? 0) >= minAddPct) suggest = r.flush
      else break
    }
  }
  return { species, finished: done.length, open, rows, suggest }
}

// ---------- Catawba-style weekly sheets (Joseph 6 Nov 2026: mirror Catawba's tracking) ----------
// Catawba keeps two weekly records: a harvest side table (pounds picked per variety per week, with averages) and an
// inoculation chart (blocks knocked per variety per week, with expected production). These are the same, in kg.

/** The last `n` ISO weeks ending with the week of `today`, oldest first, as [week id, Monday]. */
export function lastWeeks(today: string, n: number): { week: string; monday: string }[] {
  const out: { week: string; monday: string }[] = []
  const mon = weekStart(today)
  for (let i = n - 1; i >= 0; i--) {
    const m = addDays(mon, -7 * i)
    out.push({ week: isoWeek(m), monday: m })
  }
  return out
}

export interface WeekSheetRow {
  species: string
  /** One figure per week, oldest first (kg for the harvest sheet, blocks for the knock chart). */
  byWeek: number[]
  total: number
  /** Average of the last 4 weeks shown (Catawba's "Averages" column), counting empty weeks as 0. */
  avg4: number
  /** Knock chart only: expected kg from these blocks (Catawba's "Production" column), at the per-block figure used. */
  expectedKg?: number
}
export interface WeekSheet {
  weeks: { week: string; monday: string }[]
  rows: WeekSheetRow[]
  /** Column totals, one per week. */
  totals: number[]
}

function sheet(weeks: { week: string; monday: string }[], items: { species: string; week: string; v: number }[]): WeekSheet {
  const idx = new Map(weeks.map((w, i) => [w.week, i]))
  const by = new Map<string, number[]>()
  for (const it of items) {
    const i = idx.get(it.week)
    if (i === undefined) continue
    if (!by.has(it.species)) by.set(it.species, weeks.map(() => 0))
    by.get(it.species)![i] += it.v
  }
  const rows = [...by.entries()].map(([species, byWeek]) => {
    const last4 = byWeek.slice(-4)
    return { species, byWeek, total: byWeek.reduce((a, b) => a + b, 0), avg4: last4.reduce((a, b) => a + b, 0) / (last4.length || 1) }
  })
  rows.sort((a, b) => b.total - a.total || a.species.localeCompare(b.species))
  return { weeks, rows, totals: weeks.map((_, i) => rows.reduce((n, r) => n + r.byWeek[i], 0)) }
}

/** Kilos picked per species for each calendar week (the harvest day's week, as Catawba's side table). */
export function weeklyHarvest(harvests: Harvest[], lots: BlockLot[], today: string, n = 8): WeekSheet {
  const sp = new Map(lots.map((l) => [l.id, l.species_key]))
  const items = harvests
    .filter((h) => sp.has(h.block_lot_id) && Number(h.kg) > 0)
    .map((h) => ({ species: sp.get(h.block_lot_id)!, week: isoWeek(h.harvested_on), v: Number(h.kg) }))
  return sheet(lastWeeks(today, n), items)
}

/** Blocks knocked per species for each knock week, with expected kg at `kgPerBlock` (Catawba's inoculation chart). */
export function knockChart(lots: BlockLot[], today: string, kgPerBlock: (species: string) => number | null, n = 8): WeekSheet {
  const items = lots.filter((l) => Number(l.bag_count) > 0).map((l) => ({ species: l.species_key, week: isoWeek(l.knock_date), v: Number(l.bag_count) }))
  const s = sheet(lastWeeks(today, n), items)
  for (const r of s.rows) {
    const k = kgPerBlock(r.species)
    r.expectedKg = k === null ? undefined : r.total * k
  }
  return s
}
