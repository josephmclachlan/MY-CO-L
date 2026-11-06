// The culture bank (G3): slants and water tubes only, no cryo freezer (Joseph, 6 Nov 2026).
//
// Pure functions only, so they can be tested. The rules come from textbook t08 "Our farm: the culture
// bank without a freezer" (anchors t08-our-farm, t08-our-refresh, t08-our-te, t08-our-log), t09 "Our farm"
// (one master and G2 line per species, monthly strain check) and t16 "Our farm" (contamination below 5%
// at every stage). Numbers that are farm choices or guesses say so.

import type { Row } from './store'
import type { LotLoss } from './hazard'
import type { Harvest } from './ledger'
import {
  addDays,
  daysBetween,
  isActiveCulture,
  todayIso,
  type AgeCheck,
  type AgeLimit,
  type BlockLot,
  type Culture,
  type GrainRun,
  type Strain,
} from './xeno'

// ---------- practice defaults (app_settings row 'practice') ----------

export type SmallLineRoute = 'weekly' | 'fortnight' | 'direct'

export interface Practice {
  /** Contamination target per stage, % (t16 Our farm: below 5% at every stage). */
  contamTargetPct: number
  /** Share of each species' blocks kept as spares on top of what is promised to buyers, % (t22 surplus: "keep spare blocks"). GUESS default. */
  spareBlockPct: number
  /** Extra masters made each week for a failed bag (t09 Our farm: one or two). Default 0 because two 75X runs have no free slot (t09-our-75x). */
  spareMasters: number
  /** Species too small for a weekly master: Joseph 6 Nov 2026 = still one master a week ('weekly'). The others are options. */
  smallLineRoute: SmallLineRoute
  /** 75X capacity check (t09-our-75x): bags a run and runs on a grain day. 6 is OPEN until the first run is measured. */
  bagsPer75xRun: number
  runsPerGrainDay: number
  /** Bank batch sizes (t08: 3-5 slants and 3-5 water tubes from one P1). */
  bankSlants: number
  bankWater: number
  /** Replace slants this many days after banking (t08 Our farm: within 6 months). */
  slantReplaceDays: number
  /** Water tubes: check at 6 months, overdue at 12 (t08 Our farm: check every 6-12 months). */
  waterCheckDays: number
  waterOverDays: number
  /** Any tube older than this is suspect until a T/E test passes (t08 Our farm: 2 years). */
  suspectDays: number
  /** A check this much slower than the strain's baseline days to cover is WATCH, % (GUESS: "clearly slower"). */
  slowerPct: number
  /** Monthly strain check: a yield drop this big against the strain's history is slipping, % (GUESS). */
  yieldDropPct: number
  /** One buyer's share of a week's standing orders (by value) above which the order list marks them, % (Joseph 6 Nov 2026: 30%, unconfirmed). */
  buyerCapPct: number
}

export const PRACTICE_ID = 'practice'

export const DEFAULT_PRACTICE: Practice = {
  contamTargetPct: 5,
  spareBlockPct: 5,
  spareMasters: 0,
  smallLineRoute: 'weekly',
  bagsPer75xRun: 6,
  runsPerGrainDay: 2,
  bankSlants: 4,
  bankWater: 4,
  slantReplaceDays: 183,
  waterCheckDays: 183,
  waterOverDays: 365,
  suspectDays: 730,
  slowerPct: 25,
  yieldDropPct: 15,
  buyerCapPct: 30,
}

/** Which defaults are guesses waiting on Joseph (shown on screen and in the PR). */
export const PRACTICE_GUESS: Partial<Record<keyof Practice, string>> = {
  spareBlockPct: 'GUESS: 5% (ABOUT 7 OF 130). THE TEXTBOOK SAYS KEEP SPARES BUT GIVES NO NUMBER.',
  spareMasters: 'TEXTBOOK SAYS 1-2 A WEEK, BUT TWO 75X RUNS HAVE NO FREE SLOT, SO 0 UNTIL THE FIRST RUN IS MEASURED.',
  bagsPer75xRun: 'OPEN: 5-6 G2 BAGS A LOAD. 4 LB MASTERS MAY LET MORE FIT. MEASURE THE FIRST RUN.',
  bankSlants: 'TEXTBOOK SAYS 3-5. 4 PICKED.',
  bankWater: 'TEXTBOOK SAYS 3-5. 4 PICKED.',
  slowerPct: 'GUESS: THE TEXTBOOK SAYS "CLEARLY SLOWER" WITHOUT A NUMBER.',
  yieldDropPct: 'GUESS: NO SOURCE GIVES A NUMBER FOR A SLIPPING STRAIN.',
  buyerCapPct: 'JOSEPH SAID 30% BUT MARKED IT UNCONFIRMED. THE TEXTBOOK SAYS ONLY "ONE-BUYER CAP".',
}

const num = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

/** Saved settings over the defaults. Bad or missing values fall back; nothing throws. */
export function mergePractice(v: unknown): Practice {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const d = DEFAULT_PRACTICE
  const route = o.smallLineRoute === 'fortnight' || o.smallLineRoute === 'direct' || o.smallLineRoute === 'weekly' ? o.smallLineRoute : d.smallLineRoute
  const waterCheckDays = Math.round(num(o.waterCheckDays, d.waterCheckDays, 30, 730))
  return {
    contamTargetPct: num(o.contamTargetPct, d.contamTargetPct, 0, 100),
    spareBlockPct: num(o.spareBlockPct, d.spareBlockPct, 0, 50),
    spareMasters: Math.round(num(o.spareMasters, d.spareMasters, 0, 12)),
    smallLineRoute: route,
    bagsPer75xRun: Math.round(num(o.bagsPer75xRun, d.bagsPer75xRun, 1, 20)),
    runsPerGrainDay: Math.round(num(o.runsPerGrainDay, d.runsPerGrainDay, 1, 6)),
    bankSlants: Math.round(num(o.bankSlants, d.bankSlants, 0, 12)),
    bankWater: Math.round(num(o.bankWater, d.bankWater, 0, 12)),
    slantReplaceDays: Math.round(num(o.slantReplaceDays, d.slantReplaceDays, 30, 730)),
    waterCheckDays,
    waterOverDays: Math.max(waterCheckDays, Math.round(num(o.waterOverDays, d.waterOverDays, 30, 1095))),
    suspectDays: Math.round(num(o.suspectDays, d.suspectDays, 180, 3650)),
    slowerPct: num(o.slowerPct, d.slowerPct, 1, 200),
    yieldDropPct: num(o.yieldDropPct, d.yieldDropPct, 1, 90),
    buyerCapPct: num(o.buyerCapPct, d.buyerCapPct, 5, 100),
  }
}

// ---------- rows ----------

export type TestReason = 'intake' | 'refresh' | 'old_tube' | 'watch' | 'other'
export type TestResult = 'pending' | 'pass' | 'fail'

/** A test-and-expand line from one tube: dish T is tested, dish E is held until T passes (t08-our-te). */
export interface BankTest extends Row {
  id: string
  strain_id: string
  source_culture_id: string // the slant or water tube revived
  t_plate_id: string
  e_plate_id: string
  reason: TestReason
  started_on: string
  result: TestResult
  decided_on: string | null
  days_to_colonize: number | null
  days_to_pin: number | null
  kg_per_block: number | null
  form: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export type CheckResult = 'pass' | 'watch' | 'fail'

/** One line of the viability log (t08-our-log). */
export interface ViabilityCheck extends Row {
  id: string
  culture_id: string
  strain_id: string
  checked_on: string
  days_to_cover: number | null
  appearance: string | null
  contamination: string | null
  result: CheckResult
  notes: string | null
  initials: string | null
  created_at?: string
}

export const REASON_LABEL: Record<TestReason, string> = { intake: 'INTAKE', refresh: 'AFTER REFRESH', old_tube: 'TUBE OVER 18-24 MONTHS', watch: 'TUBE ON WATCH', other: 'OTHER' }
export const APPEARANCES = ['EVEN AND WHITE', 'SECTORING', 'FUZZY PATCHES', 'HARD RHIZOMORPHIC LINES', 'BROWNING'] as const

// ---------- which cultures are bank tubes ----------

export const BANK_KINDS = ['slant', 'water'] as const
export const isBankTube = (c: Culture) => (c.kind === 'slant' || c.kind === 'water') && isActiveCulture(c)

/** Label in the textbook's form: BO-01 W3 P1 2026-11-09 (t08-proc-our-intake step 4). */
export function bankLabel(code: string, kind: 'slant' | 'water', n: number, p: number | null, day: string): string {
  return `${code} ${kind === 'slant' ? 'S' : 'W'}${n} P${p ?? '?'} ${day}`
}

/** Next tube number for a strain and kind (S1, S2 ... keep counting across batches). */
export function nextTubeNo(code: string, kind: 'slant' | 'water', cultures: Culture[], strainId: string): number {
  const re = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${kind === 'slant' ? 'S' : 'W'}(\\d+) `)
  let n = 0
  for (const c of cultures) {
    if (c.strain_id !== strainId || !c.label) continue
    const m = re.exec(c.label)
    if (m) n = Math.max(n, Number(m[1]))
  }
  return n + 1
}

// ---------- T/E tests ----------

/** The pending test holding this plate back, if it is an E dish. */
export function heldBy(cultureId: string, tests: BankTest[]): BankTest | null {
  return tests.find((t) => t.e_plate_id === cultureId && t.result === 'pending') ?? null
}

/** A culture is held if it is a pending E dish, or descends from one (should never happen, but safe). */
export function isHeld(c: Culture, cultures: Culture[], tests: BankTest[]): BankTest | null {
  const byId = new Map(cultures.map((x) => [x.id, x]))
  let cur: Culture | undefined = c
  for (let i = 0; cur && i < 50; i++) {
    const t = heldBy(cur.id, tests)
    if (t) return t
    cur = cur.parent_culture_id ? byId.get(cur.parent_culture_id) : undefined
  }
  return null
}

export const passedTests = (strainId: string, tests: BankTest[]) => tests.filter((t) => t.strain_id === strainId && t.result === 'pass')

// ---------- viability log ----------

export const checksOf = (cultureId: string, checks: ViabilityCheck[]) =>
  checks.filter((c) => c.culture_id === cultureId).sort((a, b) => a.checked_on.localeCompare(b.checked_on) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))

export const lastCheck = (cultureId: string, checks: ViabilityCheck[]) => {
  const xs = checksOf(cultureId, checks)
  return xs.length ? xs[xs.length - 1] : null
}

/** The first days-to-cover ever logged for the strain (t08-our-log: baseline). */
export function baselineDays(strainId: string, checks: ViabilityCheck[]): number | null {
  const xs = checks
    .filter((c) => c.strain_id === strainId && c.days_to_cover !== null && c.days_to_cover > 0)
    .sort((a, b) => a.checked_on.localeCompare(b.checked_on) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  return xs.length ? xs[0].days_to_cover : null
}

/** Result a check should get from the numbers: slower than baseline by more than slowerPct, or contamination, is WATCH. */
export function suggestResult(days: number | null, baseline: number | null, appearance: string | null, contamination: string | null, p: Practice = DEFAULT_PRACTICE): { result: CheckResult; why: string } {
  if (contamination && contamination.trim() && !/^none$/i.test(contamination.trim())) return { result: 'fail', why: 'CONTAMINATED' }
  if (appearance && appearance !== 'EVEN AND WHITE' && appearance.trim()) return { result: 'watch', why: `SIGN OF SENESCENCE: ${appearance}` }
  if (days !== null && baseline !== null && days > baseline * (1 + p.slowerPct / 100)) return { result: 'watch', why: `${days} D TO COVER AGAINST A BASELINE OF ${baseline} D` }
  return { result: 'pass', why: baseline === null ? 'FIRST CHECK: THIS BECOMES THE BASELINE' : 'WITHIN THE BASELINE' }
}

// ---------- a lookup index (screens call bankAge for every tube on every render) ----------

interface BankIndex {
  checks: Map<string, ViabilityCheck[]> // by culture, oldest first
  batch: Map<string, string[]> // batch id -> culture ids
  passes: Map<string, BankTest[]> // passed tests by source culture
}
let lastIdx: { cultures: Culture[]; checks: ViabilityCheck[]; tests: BankTest[]; idx: BankIndex } | null = null

function indexOf(cultures: Culture[], checks: ViabilityCheck[], tests: BankTest[]): BankIndex {
  if (lastIdx && lastIdx.cultures === cultures && lastIdx.checks === checks && lastIdx.tests === tests) return lastIdx.idx
  const idx: BankIndex = { checks: new Map(), batch: new Map(), passes: new Map() }
  for (const k of checks) {
    const xs = idx.checks.get(k.culture_id)
    if (xs) xs.push(k)
    else idx.checks.set(k.culture_id, [k])
  }
  for (const xs of idx.checks.values()) xs.sort((a, b) => a.checked_on.localeCompare(b.checked_on) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  for (const c of cultures) {
    if (!c.bank_batch) continue
    const xs = idx.batch.get(c.bank_batch)
    if (xs) xs.push(c.id)
    else idx.batch.set(c.bank_batch, [c.id])
  }
  for (const t of tests) {
    if (t.result !== 'pass') continue
    const xs = idx.passes.get(t.source_culture_id)
    if (xs) xs.push(t)
    else idx.passes.set(t.source_culture_id, [t])
  }
  lastIdx = { cultures, checks, tests, idx }
  return idx
}

// ---------- due dates ----------

const LIM = (rule: string, warn: number, over: number): AgeLimit => ({ warn, over, basis: 'made', rule, src: 't08' })

/** Due state of a bank tube: slant replace date, water-tube check date, 2-year suspect, and the viability log. */
export function bankAge(c: Culture, all: Culture[], checks: ViabilityCheck[], tests: BankTest[], p: Practice = DEFAULT_PRACTICE, now = todayIso()): AgeCheck & { due: string | null; watch: boolean } {
  const age = daysBetween(c.made_on, now)
  const idx = indexOf(all, checks, tests)
  const mine = idx.checks.get(c.id)
  const last = mine?.length ? mine[mine.length - 1] : null
  if (last?.result === 'fail') return { state: 'over', days: age, due: null, watch: true, limit: LIM('This tube failed its check. Discard it and revive another tube.', 0, 0), text: 'FAILED CHECK: DISCARD' }

  // Over 2 years: suspect until a T/E test from this tube (or its batch) passes after that point.
  const suspectOn = addDays(c.made_on, p.suspectDays)
  const batch = (c.bank_batch && idx.batch.get(c.bank_batch)) || [c.id]
  const provenAfter = (day: string) => batch.some((id) => (idx.passes.get(id) ?? []).some((t) => (t.decided_on ?? t.started_on) >= day))
  if (now >= suspectOn && !provenAfter(suspectOn))
    return { state: 'over', days: age, due: suspectOn, watch: true, limit: LIM('A tube more than 2 years from banking is suspect until a test fruiting proves it.', p.suspectDays, p.suspectDays), text: `${age} D OLD: T/E TEST BEFORE USE` }

  if (last?.result === 'watch') return { state: 'warn', days: age, due: null, watch: true, limit: LIM('Slower than the baseline or showing signs of senescence: do a T/E test from this tube before you use it.', 0, 0), text: 'WATCH: T/E TEST BEFORE USE' }

  if (c.kind === 'slant') {
    const due = addDays(c.made_on, p.slantReplaceDays)
    const left = daysBetween(now, due)
    const rule = 'Replace slants within 6 months of banking. Make the new batch from a plate of the lowest-P healthy tube.'
    const limit = LIM(rule, p.slantReplaceDays - 30, p.slantReplaceDays)
    if (left < 0) return { state: 'over', days: age, due, watch: false, limit, text: `REPLACE: ${-left} D OVERDUE` }
    if (left <= 30) return { state: 'warn', days: age, due, watch: false, limit, text: `REPLACE BY ${due}` }
    return { state: 'ok', days: age, due, watch: false, limit, text: `REPLACE BY ${due}` }
  }

  // Water tubes: a passed check on any tube of the same batch restarts the clock (t08-our-refresh).
  const passes = batch.flatMap((id) => (idx.checks.get(id) ?? []).filter((k) => k.result === 'pass').map((k) => k.checked_on))
  const base = passes.length ? passes.sort().at(-1)! : c.made_on
  const due = addDays(base, p.waterCheckDays)
  const over = addDays(base, p.waterOverDays)
  const rule = 'Check water tubes every 6-12 months: plate one plug, log the days to cover. A healthy result keeps the rest of the batch.'
  const limit = LIM(rule, p.waterCheckDays, p.waterOverDays)
  if (now > over) return { state: 'over', days: age, due, watch: false, limit, text: `CHECK OVERDUE SINCE ${over}` }
  if (now >= due) return { state: 'warn', days: age, due, watch: false, limit, text: `CHECK DUE (BY ${over} AT LATEST)` }
  return { state: 'ok', days: age, due, watch: false, limit, text: `CHECK BY ${due}` }
}

// ---------- strain bank status and warnings ----------

export interface BankStatus {
  slants: number
  water: number
  offsiteSlants: number
  offsiteWater: number
  watch: number
  due: number // tubes warn or over
  lowestP: number | null
  nextDue: string | null
  pendingTests: number
  passed: number
  warnings: string[]
}

export function bankStatus(strain: Strain, cultures: Culture[], checks: ViabilityCheck[], tests: BankTest[], p: Practice = DEFAULT_PRACTICE, now = todayIso()): BankStatus {
  const tubes = cultures.filter((c) => c.strain_id === strain.id && isBankTube(c))
  const out: BankStatus = { slants: 0, water: 0, offsiteSlants: 0, offsiteWater: 0, watch: 0, due: 0, lowestP: null, nextDue: null, pendingTests: 0, passed: 0, warnings: [] }
  for (const t of tubes) {
    const a = bankAge(t, cultures, checks, tests, p, now)
    if (a.state === 'over' && a.text.startsWith('FAILED')) continue // a failed tube is not a usable copy
    if (t.kind === 'slant') (t.offsite ? out.offsiteSlants++ : out.slants++)
    else t.offsite ? out.offsiteWater++ : out.water++
    if (a.watch) out.watch++
    if (a.state === 'warn' || a.state === 'over') out.due++
    if (a.due && (!out.nextDue || a.due < out.nextDue)) out.nextDue = a.due
    if (!a.watch && t.p_level !== null && (out.lowestP === null || t.p_level < out.lowestP)) out.lowestP = t.p_level
  }
  const st = tests.filter((t) => t.strain_id === strain.id)
  out.pendingTests = st.filter((t) => t.result === 'pending').length
  out.passed = st.filter((t) => t.result === 'pass').length

  const sl = out.slants + out.offsiteSlants
  const wt = out.water + out.offsiteWater
  if (!strain.active) return out
  if (sl + wt === 0) out.warnings.push('NOTHING IN THE BANK: BANK THIS STRAIN FROM ONE P1 PLATE')
  else {
    if (sl === 0) out.warnings.push('ONLY WATER TUBES: MAKE SLANTS THIS WEEK')
    if (wt === 0) out.warnings.push('ONLY SLANTS: MAKE WATER TUBES THIS WEEK')
    if (out.offsiteSlants + out.offsiteWater === 0) out.warnings.push('NO OFF-SITE COPY: MOVE ONE SLANT AND ONE WATER TUBE OFF SITE')
    else if (out.offsiteSlants === 0 || out.offsiteWater === 0) out.warnings.push(`OFF-SITE COPY HAS NO ${out.offsiteSlants === 0 ? 'SLANT' : 'WATER TUBE'}`)
  }
  if (out.due) out.warnings.push(`${out.due} TUBE${out.due > 1 ? 'S' : ''} DUE OR ON WATCH`)
  if (sl + wt > 0 && out.passed === 0 && out.pendingTests === 0) out.warnings.push('NO T/E TEST ON FILE: TEST BEFORE THE STRAIN FEEDS PRODUCTION')
  return out
}

// ---------- contamination by stage (t16 Our farm) ----------

export type ContamStage = 'plates' | 'g1' | 'g2' | 'blocks'
export const STAGE_TEXT: Record<ContamStage, string> = { plates: 'AGAR PLATES', g1: 'GRAIN MASTERS (G1)', g2: 'G2 SPAWN', blocks: 'SUBSTRATE BLOCKS' }

export interface StageRate {
  stage: ContamStage
  made: number
  lost: number
  pct: number | null
  over: boolean
}

/** Four-week roll-up per stage: units made in the window, units lost from them. */
export function stageContam(
  d: { cultures: Culture[]; runs: GrainRun[]; lots: BlockLot[]; lotLoss: LotLoss[] },
  targetPct = DEFAULT_PRACTICE.contamTargetPct,
  now = todayIso(),
  days = 28,
): StageRate[] {
  const from = addDays(now, -days + 1)
  const inWin = (day: string | null | undefined) => !!day && day >= from && day <= now
  const plates = d.cultures.filter((c) => c.kind === 'plate' && inWin(c.made_on))
  const g1 = d.runs.filter((g) => g.generation === 'G1' && inWin(g.inoculated_on))
  const g2 = d.runs.filter((g) => g.generation === 'G2' && inWin(g.inoculated_on))
  const lots = d.lots.filter((l) => inWin(l.knock_date))
  const lotIds = new Set(lots.map((l) => l.id))
  const rate = (stage: ContamStage, made: number, lost: number): StageRate => {
    const pct = made > 0 ? (lost / made) * 100 : null
    return { stage, made, lost, pct, over: pct !== null && pct >= targetPct }
  }
  return [
    rate('plates', plates.length, plates.filter((c) => c.status === 'contaminated').length),
    rate('g1', g1.reduce((n, g) => n + g.bag_count, 0), g1.reduce((n, g) => n + (g.bags_lost || 0), 0)),
    rate('g2', g2.reduce((n, g) => n + g.bag_count, 0), g2.reduce((n, g) => n + (g.bags_lost || 0), 0)),
    rate('blocks', lots.reduce((n, l) => n + l.bag_count, 0), d.lotLoss.filter((x) => lotIds.has(x.block_lot_id)).reduce((n, x) => n + x.bag_count, 0)),
  ]
}

/** What is left after every stage loses its share: 4 stages at 5% leave about 81% (t16 Our farm). */
export const chainSurvival = (rates: (number | null)[]) => rates.reduce<number>((a, r) => a * (1 - (r ?? 0) / 100), 1)

// ---------- monthly strain check (t09-our-testbags) ----------

export interface LotStats {
  lots: number
  blocks: number
  lost: number
  contamPct: number | null
  daysToFruit: number | null // knock to fruiting room, average over lots that moved
  kgPerBlock: number | null // over lots with any harvest
}

function statsOf(lots: BlockLot[], lotLoss: LotLoss[], harvests: Harvest[]): LotStats {
  const ids = new Set(lots.map((l) => l.id))
  const blocks = lots.reduce((n, l) => n + l.bag_count, 0)
  const lost = lotLoss.filter((x) => ids.has(x.block_lot_id)).reduce((n, x) => n + x.bag_count, 0)
  const moved = lots.filter((l) => l.to_fruiting_on)
  const dtf = moved.length ? moved.reduce((n, l) => n + daysBetween(l.knock_date, l.to_fruiting_on!), 0) / moved.length : null
  const kgByLot = new Map<string, number>()
  for (const h of harvests) if (ids.has(h.block_lot_id)) kgByLot.set(h.block_lot_id, (kgByLot.get(h.block_lot_id) ?? 0) + Number(h.kg))
  const harvested = lots.filter((l) => kgByLot.has(l.id))
  const hBlocks = harvested.reduce((n, l) => n + l.bag_count, 0)
  const kg = harvested.reduce((n, l) => n + (kgByLot.get(l.id) ?? 0), 0)
  return { lots: lots.length, blocks, lost, contamPct: blocks ? (lost / blocks) * 100 : null, daysToFruit: dtf, kgPerBlock: hBlocks ? kg / hBlocks : null }
}

export interface StrainCheck {
  strain: Strain
  recent: LotStats
  history: LotStats
  slipping: string[]
  verdict: 'ok' | 'slipping' | 'no_lots' | 'no_history'
}

/**
 * Joseph 6 Nov 2026: no separate test bags. Read the last four weeks of production lots against the
 * strain's own history. "Last four weeks" = lots knocked, or harvested, in the 28 days to today.
 */
export function strainCheck(strain: Strain, lots: BlockLot[], lotLoss: LotLoss[], harvests: Harvest[], p: Practice = DEFAULT_PRACTICE, now = todayIso()): StrainCheck {
  const from = addDays(now, -27)
  const mine = lots.filter((l) => l.strain_id === strain.id && l.knock_date <= now)
  const harvestedRecently = new Set(harvests.filter((h) => h.harvested_on >= from && h.harvested_on <= now).map((h) => h.block_lot_id))
  const recentLots = mine.filter((l) => l.knock_date >= from || harvestedRecently.has(l.id))
  const recentIds = new Set(recentLots.map((l) => l.id))
  const histLots = mine.filter((l) => !recentIds.has(l.id))
  const recent = statsOf(recentLots, lotLoss, harvests)
  const history = statsOf(histLots, lotLoss, harvests)
  const slipping: string[] = []
  if (!recent.lots) return { strain, recent, history, slipping, verdict: 'no_lots' }
  if (recent.contamPct !== null && recent.contamPct >= p.contamTargetPct) slipping.push(`CONTAMINATION ${recent.contamPct.toFixed(1)}% (TARGET BELOW ${p.contamTargetPct}%)`)
  if (history.lots < 2) return { strain, recent, history, slipping, verdict: slipping.length ? 'slipping' : 'no_history' }
  if (recent.kgPerBlock !== null && history.kgPerBlock !== null && recent.kgPerBlock < history.kgPerBlock * (1 - p.yieldDropPct / 100))
    slipping.push(`YIELD ${recent.kgPerBlock.toFixed(2)} KG/BLOCK AGAINST ${history.kgPerBlock.toFixed(2)}`)
  if (recent.daysToFruit !== null && history.daysToFruit !== null && recent.daysToFruit > history.daysToFruit * (1 + p.slowerPct / 100))
    slipping.push(`${recent.daysToFruit.toFixed(1)} D TO FRUITING AGAINST ${history.daysToFruit.toFixed(1)}`)
  return { strain, recent, history, slipping, verdict: slipping.length ? 'slipping' : 'ok' }
}

// ---------- weekly spawn plan per species (t09-our-week) ----------

export interface SpawnLine {
  key: string
  blocks: number
  spare: number // blocks of the total kept as spares
  g2: number
  g1: number
}

/** Spare blocks within a species' weekly count. */
export const spareBlocks = (blocks: number, pct: number) => Math.round((Math.max(0, blocks) * Math.max(0, pct)) / 100)

/**
 * One master and one G2 line per species (t09 Our farm). G2 = blocks / 20, rounded up (F05-0014);
 * masters = G2 / 12 rounded up, at least one for any G2 (Joseph 6 Nov 2026: fewer than 6 G2 per master
 * is fine, never more than 24).
 */
export function spawnLines(split: { key: string; bags: number }[], p: Practice = DEFAULT_PRACTICE): SpawnLine[] {
  return split
    .filter((s) => s.bags > 0)
    .map((s) => {
      const g2 = Math.ceil(s.bags / 20)
      return { key: s.key, blocks: s.bags, spare: spareBlocks(s.bags, p.spareBlockPct), g2, g1: g2 > 0 ? Math.max(1, Math.ceil(g2 / 12)) : 0 }
    })
}

export interface Fit75x {
  g2: number
  masters: number
  spares: number
  bags: number
  capacity: number
  fits: boolean
}

export function fit75x(lines: SpawnLine[], p: Practice = DEFAULT_PRACTICE): Fit75x {
  const g2 = lines.reduce((n, l) => n + l.g2, 0)
  const masters = lines.reduce((n, l) => n + l.g1, 0)
  const bags = g2 + masters + p.spareMasters
  const capacity = p.bagsPer75xRun * p.runsPerGrainDay
  return { g2, masters, spares: p.spareMasters, bags, capacity, fits: bags <= capacity }
}
