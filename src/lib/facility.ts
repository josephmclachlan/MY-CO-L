// FACILITY LOGS (build G7): power-cut log, water quality log, maintenance + equipment register, cleaning log,
// sign-off checklists and reminders. Everything here is plain functions on rows: no screen, no storage.
//
// Time rule: the farm is in Costa Rica (UTC-6, no daylight saving). Every moment is saved as an exact UTC
// time, and every day or month the app shows or adds up is the FARM's day or month, whatever the phone says.

import type { Row } from './store'
import { addDays, daysBetween } from './xeno'
import { addMonths, monthLabel } from './money'
import type { RoomId } from '../data/power'
import type { TodayItem } from './mission'
import { CHECKLISTS, type CheckTemplate } from '../data/checklists'

export const FACILITY_ID = 'facility'
const MIN = 60000

// ---------- farm time ----------

export const FARM_OFFSET_MIN = -360
const shifted = (ms: number) => new Date(ms + FARM_OFFSET_MIN * MIN)
/** The farm's calendar day (yyyy-mm-dd) at this moment. */
export const farmDay = (ms: number) => shifted(ms).toISOString().slice(0, 10)
/** The farm's clock (HH:MM) at this moment. */
export const farmTime = (ms: number) => shifted(ms).toISOString().slice(11, 16)
export const farmMonth = (ms: number) => farmDay(ms).slice(0, 7)
/** A day and time typed on the farm's clock -> the exact moment. null if either is not real. */
export function fromFarm(day: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const ms = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]) - FARM_OFFSET_MIN * MIN
  if (!Number.isFinite(ms) || farmDay(ms) !== day || farmTime(ms) !== time) return null
  return ms
}
export const isoOf = (ms: number) => new Date(ms).toISOString()
/** Whole minute, so two buttons pressed in the same minute give the same time. */
export const wholeMin = (ms: number) => Math.floor(ms / MIN) * MIN
export const monthStart = (month: string): number => fromFarm(`${month}-01`, '00:00') as number

/** 195 -> "3 H 15 MIN", 45 -> "45 MIN", 1500 -> "1 D 1 H". */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} MIN`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} H ${m % 60} MIN` : `${h} H`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} D ${h % 24} H` : `${d} D`
}
/** Hours with one decimal: 7.5 H. */
export const fmtHours = (min: number) => `${(Math.round((min / 60) * 10) / 10).toFixed(1)} H`
export const dayLong = (day: string) => {
  const [, m, d] = day.split('-')
  return `${Number(d)} ${MONTH3[Number(m) - 1]}`
}
const MONTH3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
/** "6 NOV 14:05" on the farm's clock. */
export const stamp = (ms: number) => `${dayLong(farmDay(ms))} ${farmTime(ms)}`

const clean = (s: string | null | undefined, max = 200): string | null => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null
export const cleanText = clean
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromFarm(s, '00:00') !== null

// ---------- settings ----------

export type WaterPoint = 'raw' | 'filtered' | 'ro' | 'tank' | 'mix'
export const WATER_POINTS: { id: WaterPoint; label: string; where: string }[] = [
  { id: 'raw', label: 'RAW SOURCE', where: 'Water as it arrives: tap, well or rain tank.' },
  { id: 'filtered', label: 'AFTER FILTERS', where: 'After the particle filter, softener and carbon.' },
  { id: 'ro', label: 'AFTER RO (HUMIDIFIER FEED)', where: 'Reverse-osmosis water that feeds the humidifier.' },
  { id: 'tank', label: 'HUMIDIFIER TANK', where: 'Inside the humidifier, after any bleach or chlorine dioxide.' },
  { id: 'mix', label: 'SUBSTRATE MIX WATER', where: 'The water used to wet sawdust and soy hulls.' },
]
export const WATER_LABEL = Object.fromEntries(WATER_POINTS.map((p) => [p.id, p.label])) as Record<WaterPoint, string>

export type WaterField = 'ph' | 'tds' | 'hardness' | 'cl'
export const WATER_FIELDS: { id: WaterField; label: string; unit: string; col: string }[] = [
  { id: 'ph', label: 'PH', unit: '', col: 'ph' },
  { id: 'tds', label: 'TDS', unit: 'PPM', col: 'tds_ppm' },
  { id: 'hardness', label: 'HARDNESS', unit: 'PPM', col: 'hardness_ppm' },
  { id: 'cl', label: 'CHLORINE / BLEACH', unit: 'PPM', col: 'cl_ppm' },
]
export interface Limit {
  min?: number
  max?: number
}
export type PointLimits = Partial<Record<WaterField, Limit>>

/** GUESS - REVIEW: working limits per sampling point. Joseph tunes them on the WATER screen. */
export const DEFAULT_LIMITS: Record<WaterPoint, PointLimits> = {
  raw: { ph: { min: 6.0, max: 8.5 }, tds: { max: 500 }, hardness: { max: 150 } },
  filtered: { ph: { min: 6.0, max: 8.5 }, tds: { max: 500 }, hardness: { max: 150 }, cl: { max: 0.5 } },
  ro: { ph: { min: 5.0, max: 8.0 }, tds: { max: 30 }, hardness: { max: 5 }, cl: { max: 0.1 } },
  tank: { ph: { min: 5.0, max: 8.5 }, tds: { max: 100 }, hardness: { max: 10 }, cl: { min: 150, max: 250 } },
  mix: { ph: { min: 6.0, max: 8.5 }, tds: { max: 500 }, hardness: { max: 200 }, cl: { max: 2 } },
}

export const ROOM_LIST: { id: Exclude<RoomId, 'outside'>; label: string }[] = [
  { id: 'lab', label: 'LAB' },
  { id: 'packing', label: 'PACKING' },
  { id: 'incubation', label: 'INCUBATION' },
  { id: 'fruiting', label: 'FRUITING' },
  { id: 'boiling', label: 'BOILING ROOM' },
]
export const ROOM_LABEL: Record<string, string> = { ...Object.fromEntries(ROOM_LIST.map((r) => [r.id, r.label])), outside: 'OUTSIDE' }

export interface FacilitySettings {
  /** Days between water tests at each point. 0 = do not remind. */
  waterEvery: Record<WaterPoint, number>
  /** Changes to the working limits (only the fields Joseph changed). */
  limits: Partial<Record<WaterPoint, PointLimits>>
  /** Days between cleans of each room. */
  cleanEvery: Record<string, number>
  /** Days between sign-offs for each checklist. 0 = no schedule. */
  checkEvery: Record<string, number>
  /** Show the weekly routine (Monday cook, Tuesday knock ...) as reminders. */
  routineOn: boolean
  /** Show reminders this many days before they are due. */
  leadDays: number
  /** Reminder key -> hidden until (and including) this day. */
  snoozed: Record<string, string>
  /** Ask the phone to show an alert for what is due, while the app is open. */
  phoneAlerts: boolean
}

/** GUESS - REVIEW: cleaning cadence and the other working numbers. */
export const DEFAULT_FACILITY: FacilitySettings = {
  waterEvery: { raw: 30, filtered: 14, ro: 7, tank: 7, mix: 30 },
  limits: {},
  cleanEvery: { lab: 2, packing: 3, incubation: 14, fruiting: 7, boiling: 7 },
  checkEvery: Object.fromEntries(CHECKLISTS.map((c) => [c.key, c.every ?? 0])),
  routineOn: true,
  leadDays: 2,
  snoozed: {},
  phoneAlerts: false,
}

const numIn = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d)

export function mergeFacility(v: unknown): FacilitySettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const rec = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {})
  const d = DEFAULT_FACILITY
  const water = rec(o.waterEvery)
  const cleanE = rec(o.cleanEvery)
  const checkE = rec(o.checkEvery)
  const limitsIn = rec(o.limits)
  const limits: FacilitySettings['limits'] = {}
  for (const p of WATER_POINTS) {
    const pl = rec(limitsIn[p.id])
    const out: PointLimits = {}
    for (const f of WATER_FIELDS) {
      const l = rec(pl[f.id])
      const lim: Limit = {}
      if (typeof l.min === 'number' && Number.isFinite(l.min)) lim.min = l.min
      if (typeof l.max === 'number' && Number.isFinite(l.max)) lim.max = l.max
      if ('min' in lim || 'max' in lim) out[f.id] = lim
    }
    if (Object.keys(out).length) limits[p.id] = out
  }
  const snoozed: Record<string, string> = {}
  for (const [k, val] of Object.entries(rec(o.snoozed))) if (isDay(val)) snoozed[k] = val
  return {
    waterEvery: Object.fromEntries(WATER_POINTS.map((p) => [p.id, numIn(water[p.id], 0, 365, d.waterEvery[p.id])])) as Record<WaterPoint, number>,
    limits,
    cleanEvery: Object.fromEntries(ROOM_LIST.map((r) => [r.id, numIn(cleanE[r.id], 0, 365, d.cleanEvery[r.id])])),
    checkEvery: Object.fromEntries(CHECKLISTS.map((c) => [c.key, numIn(checkE[c.key], 0, 365, d.checkEvery[c.key])])),
    routineOn: typeof o.routineOn === 'boolean' ? o.routineOn : d.routineOn,
    leadDays: numIn(o.leadDays, 0, 30, d.leadDays),
    snoozed,
    phoneAlerts: typeof o.phoneAlerts === 'boolean' ? o.phoneAlerts : d.phoneAlerts,
  }
}

/** The limit in force for a point and field: Joseph's change if he made one, else the working default. */
export function limitFor(s: FacilitySettings, p: WaterPoint, f: WaterField): Limit {
  return s.limits[p]?.[f] ?? DEFAULT_LIMITS[p][f] ?? {}
}

// ==========================================================================================
// POWER CUTS
// ==========================================================================================

export type Fuel = 'propane' | 'gasoline'
export const FUELS: { id: Fuel; label: string; unit: string }[] = [
  { id: 'propane', label: 'PROPANE', unit: 'KG' },
  { id: 'gasoline', label: 'GASOLINE', unit: 'LITRES' },
]
export interface GenRun {
  on: string
  off: string | null
}
export interface PowerCut extends Row {
  /** cut = the grid went out. test = a generator test run with no outage (counts hours, not downtime). */
  kind: 'cut' | 'test'
  down_at: string
  up_at: string | null
  gen_runs: GenRun[] | null
  /** Hours read off the generator's meter, when the on/off times are not known. */
  gen_hours: number | null
  fuel: Fuel | null
  fuel_amount: number | null
  affected: string[] | null
  losses: string | null
  notes: string | null
  who: string | null
  created_at?: string
  updated_at?: string
}

type Span = [number, number]
function mergeSpans(spans: Span[]): Span[] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out: Span[] = []
  for (const [a, b] of s) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}
const spanLen = (s: Span[]) => s.reduce((n, [a, b]) => n + (b - a), 0)
const clip = (s: Span[], a: number, b: number): Span[] => s.map(([x, y]) => [Math.max(x, a), Math.min(y, b)] as Span).filter(([x, y]) => y > x)

export const isOpenCut = (c: PowerCut) => c.kind === 'cut' && c.up_at === null

/** Generator run spans. A run left open ends when the power came back (or now, while the cut or test is still going). */
function runSpans(c: PowerCut, now: number): Span[] {
  const cap = c.kind === 'cut' && c.up_at ? Date.parse(c.up_at) : now
  return mergeSpans((c.gen_runs ?? []).map((r) => [Date.parse(r.on), r.off ? Date.parse(r.off) : cap] as Span).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)))
}

export interface CutStats {
  open: boolean
  /** Minutes the grid was down. */
  gridMin: number
  /** Minutes of the outage the generator was running. */
  onGenMin: number
  /** Minutes with no grid and no generator: the farm fully dark. */
  darkMin: number
  /** Generator run hours (meter hours if typed, else from the on/off times). */
  genHours: number
}

export function cutStats(c: PowerCut, now: number): CutStats {
  const spans = runSpans(c, now)
  const timeHours = spanLen(spans) / MIN / 60
  const genHours = c.gen_hours !== null && c.gen_hours !== undefined ? Number(c.gen_hours) : timeHours
  if (c.kind === 'test') return { open: false, gridMin: 0, onGenMin: 0, darkMin: 0, genHours }
  const down = Date.parse(c.down_at)
  const up = c.up_at ? Date.parse(c.up_at) : now
  const gridMin = Math.max(0, (up - down) / MIN)
  const onGenMin = Math.min(gridMin, spanLen(clip(spans, down, up)) / MIN)
  return { open: c.up_at === null, gridMin, onGenMin, darkMin: gridMin - onGenMin, genHours }
}

export interface MonthOut {
  month: string
  cuts: number
  tests: number
  /** Minutes the grid was down in this month. */
  gridMin: number
  onGenMin: number
  darkMin: number
  genHours: number
  propaneKg: number
  gasolineL: number
  longestMin: number
  /** Share of the month's minutes (so far, for this month) the grid was up. */
  gridUpPct: number
}

const emptyMonth = (month: string): MonthOut => ({ month, cuts: 0, tests: 0, gridMin: 0, onGenMin: 0, darkMin: 0, genHours: 0, propaneKg: 0, gasolineL: 0, longestMin: 0, gridUpPct: 100 })

/** Minutes of the month that have happened so far (all of it for a past month, none for a future one). */
export function monthMinutes(month: string, now: number): number {
  const a = monthStart(month)
  const b = monthStart(addMonths(month, 1))
  return Math.max(0, (Math.min(b, now) - a) / MIN)
}

/**
 * Totals per farm month. A cut that crosses midnight at the end of a month is split: each month gets the
 * minutes that fall inside it. The cut itself, its fuel and its longest-cut mark belong to the month it started.
 */
export function monthlyOutage(cuts: PowerCut[], now: number): MonthOut[] {
  const by = new Map<string, MonthOut>()
  const get = (m: string) => {
    let r = by.get(m)
    if (!r) by.set(m, (r = emptyMonth(m)))
    return r
  }
  for (const c of cuts) {
    const down = Date.parse(c.down_at)
    if (!Number.isFinite(down)) continue
    const home = get(farmMonth(down))
    if (c.kind === 'cut') home.cuts++
    else home.tests++
    if (c.fuel && c.fuel_amount) {
      if (c.fuel === 'propane') home.propaneKg += Number(c.fuel_amount)
      else home.gasolineL += Number(c.fuel_amount)
    }
    const st = cutStats(c, now)
    home.longestMin = Math.max(home.longestMin, st.gridMin)
    const spans = runSpans(c, now)
    const up = c.up_at ? Date.parse(c.up_at) : now
    const end = c.kind === 'cut' ? Math.max(up, down) : Math.max(down, ...spans.map((s) => s[1]))
    const typed = c.gen_hours !== null && c.gen_hours !== undefined
    if (typed) home.genHours += Number(c.gen_hours)
    for (let m = farmMonth(down); monthStart(m) <= end; m = addMonths(m, 1)) {
      const a = monthStart(m)
      const b = monthStart(addMonths(m, 1))
      const row = get(m)
      if (c.kind === 'cut') {
        const lo = Math.max(down, a)
        const hi = Math.min(up, b)
        if (hi > lo) {
          const onGen = spanLen(clip(clip(spans, down, up), lo, hi)) / MIN
          row.gridMin += (hi - lo) / MIN
          row.onGenMin += onGen
          row.darkMin += (hi - lo) / MIN - onGen
        }
      }
      if (!typed) row.genHours += spanLen(clip(spans, a, b)) / MIN / 60
    }
  }
  const out = [...by.values()].sort((x, y) => x.month.localeCompare(y.month))
  for (const r of out) {
    const total = monthMinutes(r.month, now)
    r.gridUpPct = total > 0 ? Math.max(0, 100 * (1 - r.gridMin / total)) : 100
  }
  return out
}

/** The last `n` farm months ending at the month of `now`, zero rows where nothing happened. */
export function lastMonths(cuts: PowerCut[], now: number, n = 12): MonthOut[] {
  const have = new Map(monthlyOutage(cuts, now).map((r) => [r.month, r]))
  const end = farmMonth(now)
  const out: MonthOut[] = []
  for (let i = n - 1; i >= 0; i--) {
    const m = addMonths(end, -i)
    const r = have.get(m)
    if (r) out.push(r)
    else {
      out.push(emptyMonth(m))
    }
  }
  return out
}

export interface OutageSummary {
  open: PowerCut | null
  last: PowerCut | null
  thisMonth: MonthOut
  year: { cuts: number; gridMin: number; darkMin: number; onGenMin: number; genHours: number; longestMin: number }
}
export function outageSummary(cuts: PowerCut[], now: number): OutageSummary {
  const months = lastMonths(cuts, now, 12)
  const real = cuts.filter((c) => c.kind === 'cut')
  const open = real.find((c) => c.up_at === null) ?? null
  const done = real.filter((c) => c.up_at !== null).sort((a, b) => Date.parse(b.up_at as string) - Date.parse(a.up_at as string))
  return {
    open,
    last: done[0] ?? null,
    thisMonth: months[months.length - 1],
    year: {
      cuts: months.reduce((n, m) => n + m.cuts, 0),
      gridMin: months.reduce((n, m) => n + m.gridMin, 0),
      darkMin: months.reduce((n, m) => n + m.darkMin, 0),
      onGenMin: months.reduce((n, m) => n + m.onGenMin, 0),
      genHours: months.reduce((n, m) => n + m.genHours, 0),
      longestMin: months.reduce((n, m) => Math.max(n, m.longestMin), 0),
    },
  }
}

/** Generator run hours that started after the end of `sinceDay` (the service day itself counts as before the service). */
export function genHoursSince(cuts: PowerCut[], sinceDay: string | null, now: number): number {
  const from = sinceDay ? (fromFarm(addDays(sinceDay, 1), '00:00') as number) : -Infinity
  let h = 0
  for (const c of cuts) {
    const typed = c.gen_hours !== null && c.gen_hours !== undefined
    if (typed) {
      if (Date.parse(c.down_at) >= from) h += Number(c.gen_hours)
      continue
    }
    for (const [a, b] of runSpans(c, now)) {
      const lo = Math.max(a, from)
      if (b > lo) h += (b - lo) / MIN / 60
    }
  }
  return h
}

export interface CutInput {
  kind: 'cut' | 'test'
  down: number | null
  up: number | null
  runs: { on: number | null; off: number | null }[]
  genHours: number | null
  fuel: Fuel | null
  fuelAmount: number | null
  affected: string[]
  losses?: string | null
  notes?: string | null
  who?: string | null
}

const MAX_CUT_DAYS = 30
const FUTURE_SLACK = 5 * MIN

/** What is wrong with this entry, in plain words, or null if it can be saved. `others` are the other cuts already saved. */
export function checkCut(i: CutInput, now: number, others: PowerCut[] = []): string | null {
  if (i.down === null || !Number.isFinite(i.down)) return 'TYPE THE DAY AND TIME THE POWER WENT OUT.'
  if (i.down > now + FUTURE_SLACK) return 'THE START IS IN THE FUTURE.'
  if (i.kind === 'cut') {
    if (i.up !== null) {
      if (!Number.isFinite(i.up)) return 'TYPE A REAL DAY AND TIME FOR POWER BACK.'
      if (i.up <= i.down) return 'POWER CANNOT COME BACK BEFORE IT WENT OUT.'
      if (i.up > now + FUTURE_SLACK) return 'POWER BACK IS IN THE FUTURE. LEAVE IT BLANK IF THE POWER IS STILL OUT.'
      if (i.up - i.down > MAX_CUT_DAYS * 86400000) return `A CUT OF MORE THAN ${MAX_CUT_DAYS} DAYS: CHECK THE DATES. IF THE START WAS PRESSED BY MISTAKE, USE EDIT ON THE LIST TO FIX IT.`
    }
    const hi = i.up ?? now
    for (const o of others) {
      if (o.kind !== 'cut') continue
      const a = Date.parse(o.down_at)
      const b = o.up_at ? Date.parse(o.up_at) : now
      if (i.down < b && hi > a) return `THIS OVERLAPS A CUT ALREADY LOGGED (${stamp(a)} TO ${o.up_at ? stamp(b) : 'STILL OUT'}).`
    }
  } else if (!i.runs.length) return 'A TEST RUN NEEDS THE TIME THE GENERATOR STARTED.'
  if (i.runs.length > 10) return 'MORE THAN 10 GENERATOR RUNS: LOG THE EXTRA RUNS AS ANOTHER ENTRY.'
  for (const r of i.runs) {
    if (r.on === null || !Number.isFinite(r.on)) return 'TYPE THE DAY AND TIME EACH GENERATOR RUN STARTED.'
    if (r.on > now + FUTURE_SLACK) return 'A GENERATOR START IS IN THE FUTURE.'
    if (r.off !== null) {
      if (!Number.isFinite(r.off) || r.off <= r.on) return 'THE GENERATOR CANNOT STOP BEFORE IT STARTED.'
      if (r.off - r.on > MAX_CUT_DAYS * 86400000) return 'A GENERATOR RUN OF MORE THAN 30 DAYS: CHECK THE DATES.'
    }
    if (i.kind === 'cut' && r.on < i.down - 12 * 3600000) return 'A GENERATOR RUN STARTS MORE THAN 12 HOURS BEFORE THE CUT.'
  }
  if (i.genHours !== null && (!Number.isFinite(i.genHours) || i.genHours < 0 || i.genHours > 720)) return 'GENERATOR HOURS MUST BE 0 TO 720.'
  if (i.fuelAmount !== null) {
    if (!Number.isFinite(i.fuelAmount) || i.fuelAmount < 0 || i.fuelAmount > 1000) return 'FUEL USED MUST BE 0 TO 1000.'
    if (i.fuelAmount > 0 && !i.fuel) return 'PICK THE FUEL: PROPANE OR GASOLINE.'
  }
  for (const a of i.affected) if (!(a in ROOM_LABEL)) return 'UNKNOWN ROOM IN WHAT WAS AFFECTED.'
  return null
}

/** The same cut as a short line: "6 NOV 14:05 -> 16:50  2 H 45 MIN". */
export function cutLine(c: PowerCut, now: number): string {
  const st = cutStats(c, now)
  const a = Date.parse(c.down_at)
  if (c.kind === 'test') return `${stamp(a)} TEST RUN  ${fmtHours(st.genHours * 60)}`
  if (!c.up_at) return `${stamp(a)} -> STILL OUT  ${fmtMin(st.gridMin)} SO FAR`
  return `${stamp(a)} -> ${stamp(Date.parse(c.up_at))}  ${fmtMin(st.gridMin)}`
}

/** Text for WhatsApp or a message to ICE: what the log says about a stretch of months. */
export function outageReport(cuts: PowerCut[], now: number, months = 12): string {
  const rows = lastMonths(cuts, now, months)
  const lines = rows.map((r) => `${monthLabel(r.month)}: ${r.cuts} CUT${r.cuts === 1 ? '' : 'S'}, ${fmtHours(r.gridMin)} NO GRID, ${fmtHours(r.darkMin)} FULLY DARK`)
  const tot = rows.reduce((n, r) => n + r.gridMin, 0)
  return [`POWER CUTS, LAST ${months} MONTHS (FARM TIME)`, ...lines, `TOTAL NO GRID: ${fmtHours(tot)}`].join('\n')
}

// ==========================================================================================
// WATER
// ==========================================================================================

export interface WaterTest extends Row {
  tested_on: string
  tested_time: string | null
  point: WaterPoint
  ph: number | null
  tds_ppm: number | null
  hardness_ppm: number | null
  cl_ppm: number | null
  temp_c: number | null
  action: string | null
  notes: string | null
  who: string | null
  created_at?: string
  updated_at?: string
}

export interface WaterIssue {
  field: WaterField
  value: number
  limit: Limit
  side: 'low' | 'high'
  text: string
}

const valOf = (t: WaterTest, f: WaterField): number | null => {
  const v = t[WATER_FIELDS.find((x) => x.id === f)!.col as keyof WaterTest]
  return v === null || v === undefined ? null : Number(v)
}
const limText = (l: Limit) => (l.min !== undefined && l.max !== undefined ? `${l.min}-${l.max}` : l.max !== undefined ? `UP TO ${l.max}` : `AT LEAST ${l.min}`)

/** Which of this test's readings are outside the working limits for its sampling point. */
export function evalWater(t: WaterTest, s: FacilitySettings = DEFAULT_FACILITY): WaterIssue[] {
  const out: WaterIssue[] = []
  for (const f of WATER_FIELDS) {
    const v = valOf(t, f.id)
    if (v === null) continue
    const l = limitFor(s, t.point, f.id)
    const name = f.id === 'cl' && t.point === 'tank' ? 'BLEACH DOSE' : f.label
    if (l.min !== undefined && v < l.min) out.push({ field: f.id, value: v, limit: l, side: 'low', text: `${name} ${v}${f.unit ? ' ' + f.unit : ''} IS LOW (WANT ${limText(l)})` })
    else if (l.max !== undefined && v > l.max) out.push({ field: f.id, value: v, limit: l, side: 'high', text: `${name} ${v}${f.unit ? ' ' + f.unit : ''} IS HIGH (WANT ${limText(l)})` })
  }
  return out
}

export interface WaterInput {
  day: string
  time?: string | null
  point: WaterPoint
  ph: number | null
  tds: number | null
  hardness: number | null
  cl: number | null
  temp: number | null
  action?: string | null
  notes?: string | null
  who?: string | null
}
const RANGE: Record<string, [number, number, string]> = {
  ph: [0, 14, 'PH MUST BE 0 TO 14.'],
  tds: [0, 5000, 'TDS MUST BE 0 TO 5000 PPM.'],
  hardness: [0, 2000, 'HARDNESS MUST BE 0 TO 2000 PPM.'],
  cl: [0, 1000, 'CHLORINE OR BLEACH MUST BE 0 TO 1000 PPM.'],
  temp: [0, 60, 'WATER TEMPERATURE MUST BE 0 TO 60 C.'],
}
export function checkWater(i: WaterInput, today: string): string | null {
  if (!isDay(i.day)) return 'PICK THE DAY OF THE TEST.'
  if (i.day > today) return 'THE TEST DAY IS IN THE FUTURE.'
  if (!WATER_POINTS.some((p) => p.id === i.point)) return 'PICK WHERE THE SAMPLE WAS TAKEN.'
  if (i.time && !/^\d{2}:\d{2}$/.test(i.time)) return 'TIME MUST LOOK LIKE 14:30.'
  const vals = { ph: i.ph, tds: i.tds, hardness: i.hardness, cl: i.cl, temp: i.temp }
  let any = false
  for (const [k, v] of Object.entries(vals)) {
    if (v === null) continue
    any = true
    const [lo, hi, msg] = RANGE[k]
    if (!Number.isFinite(v) || v < lo || v > hi) return msg
  }
  if (!any) return 'TYPE AT LEAST ONE READING.'
  return null
}

export type DueState = 'never' | 'ok' | 'soon' | 'due' | 'late' | 'off'
export interface WaterDue {
  point: WaterPoint
  last: WaterTest | null
  every: number
  dueOn: string | null
  /** Days from today to the due day (negative = overdue). */
  left: number | null
  state: DueState
  issues: WaterIssue[]
}
const soonOf = (every: number) => Math.min(7, Math.max(1, Math.ceil(every * 0.2)))
export function dueState(left: number, every: number): DueState {
  return left < 0 ? 'late' : left === 0 ? 'due' : left <= soonOf(every) ? 'soon' : 'ok'
}
export const lastWater = (tests: WaterTest[], point: WaterPoint): WaterTest | null => {
  let best: WaterTest | null = null
  for (const t of tests) {
    if (t.point !== point) continue
    if (!best || t.tested_on > best.tested_on || (t.tested_on === best.tested_on && (t.tested_time ?? '') > (best.tested_time ?? '')) || (t.tested_on === best.tested_on && (t.tested_time ?? '') === (best.tested_time ?? '') && (t.created_at ?? '') > (best.created_at ?? ''))) best = t
  }
  return best
}
export function waterDue(tests: WaterTest[], today: string, s: FacilitySettings = DEFAULT_FACILITY): WaterDue[] {
  return WATER_POINTS.map((p) => {
    const last = lastWater(tests, p.id)
    const every = s.waterEvery[p.id]
    const issues = last ? evalWater(last, s) : []
    if (!last) return { point: p.id, last, every, dueOn: null, left: null, state: every ? ('never' as const) : ('off' as const), issues }
    if (!every) return { point: p.id, last, every, dueOn: null, left: null, state: 'off' as const, issues }
    const dueOn = addDays(last.tested_on, every)
    const left = daysBetween(today, dueOn)
    return { point: p.id, last, every, dueOn, left, state: dueState(left, every), issues }
  })
}
/** Readings of one field at one point, oldest first, for a small chart. */
export function waterSeries(tests: WaterTest[], point: WaterPoint, field: WaterField, n = 12): { day: string; v: number }[] {
  return tests
    .filter((t) => t.point === point && valOf(t, field) !== null)
    .sort((a, b) => a.tested_on.localeCompare(b.tested_on) || (a.tested_time ?? '').localeCompare(b.tested_time ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .slice(-n)
    .map((t) => ({ day: t.tested_on, v: valOf(t, field) as number }))
}
/** Share of the last `n` tests (all points) that had nothing outside the limits. */
export function waterPassRate(tests: WaterTest[], s: FacilitySettings, n = 20): number | null {
  const last = [...tests].sort((a, b) => b.tested_on.localeCompare(a.tested_on) || (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, n)
  if (!last.length) return null
  return (100 * last.filter((t) => evalWater(t, s).length === 0).length) / last.length
}

// ==========================================================================================
// MAINTENANCE + EQUIPMENT REGISTER
// ==========================================================================================

export const MAINT_CATEGORIES = ['air', 'cold', 'steam', 'power', 'water', 'lab', 'safety', 'other'] as const
export type MaintCategory = (typeof MAINT_CATEGORIES)[number]
export const MAINT_CAT_LABEL: Record<MaintCategory, string> = { air: 'AIR + HVAC', cold: 'COLD STORAGE', steam: 'STEAM + COOKING', power: 'POWER', water: 'WATER', lab: 'LAB', safety: 'SAFETY', other: 'OTHER' }

export interface MaintItem extends Row {
  name: string
  category: MaintCategory
  room_id: string | null
  make_model: string | null
  serial: string | null
  installed_on: string | null
  /** Do it every this many days. null = no calendar schedule. */
  every_days: number | null
  /** Do it every this many generator run hours. */
  every_hours: number | null
  last_done_on: string | null
  /** The clock starts here when it has never been done. */
  started_on: string
  notes: string | null
  active: boolean
  created_at?: string
  updated_at?: string
}
export interface MaintLog extends Row {
  item_id: string
  done_on: string
  who: string | null
  notes: string | null
  created_at?: string
}

export interface StdMaint {
  name: string
  category: MaintCategory
  room: string | null
  days: number | null
  hours: number | null
  note: string
}
/** GUESS - REVIEW: a starting schedule for the farm's equipment. Intervals are working numbers, not the maker's. */
export const STANDARD_MAINT: StdMaint[] = [
  { name: 'HEPA PRE-FILTERS WASH OR CHANGE', category: 'air', room: 'lab', days: 30, hours: null, note: 'Pre-filters protect the HEPA. Change when grey.' },
  { name: 'HEPA PRESSURE + FILTER CHECK', category: 'air', room: 'lab', days: 90, hours: null, note: 'Read the pressure drop; replace the HEPA when it is past the maker limit.' },
  { name: 'MINI-SPLIT FILTERS WASH', category: 'air', room: null, days: 30, hours: null, note: 'All Lennox units. Humid air loads filters fast.' },
  { name: 'MINI-SPLIT COILS + DRAIN LINES', category: 'air', room: null, days: 180, hours: null, note: 'Clear drain lines: algae blocks them in humid rooms.' },
  { name: 'COLD ROOM + FRIDGE COILS CLEAN', category: 'cold', room: 'packing', days: 90, hours: null, note: 'Fogel cold rooms and reach-in fridges.' },
  { name: 'CO2 METERS CALIBRATE', category: 'air', room: null, days: 180, hours: null, note: 'All CO2Meter units against fresh outdoor air or a reference.' },
  { name: 'STEAM GENERATOR DESCALE', category: 'steam', room: 'boiling', days: 60, hours: null, note: 'Sooner if the water test shows hard water.' },
  { name: 'STEAM BOX DOOR SEAL CHECK', category: 'steam', room: 'boiling', days: 90, hours: null, note: 'Look for cracks, flat spots, steam leaks at the corners.' },
  { name: '75X GASKET + SAFETY VALVE CHECK', category: 'steam', room: 'lab', days: 90, hours: null, note: 'Follow the maker manual for the pressure valve.' },
  { name: 'HUMIDIFIER CLEAN + TANK DRAIN', category: 'water', room: 'fruiting', days: 14, hours: null, note: 'Drain and scrub the tank; check the transducer.' },
  { name: 'WATER FILTER CARTRIDGES CHANGE', category: 'water', room: null, days: 90, hours: null, note: 'Particle and carbon cartridges.' },
  { name: 'SOFTENER SALT CHECK', category: 'water', room: null, days: 30, hours: null, note: 'Top up before it runs low.' },
  { name: 'UV LAMP REPLACE', category: 'water', room: null, days: 365, hours: null, note: 'Lamps lose strength before they go dark.' },
  { name: 'GENERATOR TEST RUN UNDER LOAD', category: 'power', room: 'outside', days: 30, hours: null, note: 'Run 20-30 minutes with the emergency list on. Log it as a TEST RUN in POWER CUTS.' },
  { name: 'GENERATOR OIL CHANGE', category: 'power', room: 'outside', days: 365, hours: 100, note: 'First change after the first 20 hours (break-in), then every 100 hours or each year. Counts hours from the POWER CUTS log.' },
  { name: 'ALUMINIUM FEEDER LUGS RE-TORQUE', category: 'power', room: null, days: 180, hours: null, note: 'Qualified electrician. Re-torque after the first 2-3 months, then twice a year.' },
  { name: 'FIRE EXTINGUISHERS CHECK', category: 'safety', room: null, days: 30, hours: null, note: 'Gauge in the green, pin in place, not blocked.' },
]

export interface MaintStatus {
  item: MaintItem
  state: DueState | 'none'
  dueOn: string | null
  /** Days to the calendar due day (negative = overdue). */
  daysLeft: number | null
  hoursSince: number | null
  hoursLeft: number | null
  text: string
}
const SEVERITY: Record<string, number> = { late: 0, due: 1, soon: 2, ok: 3, never: 4, none: 5, off: 6 }
export const severity = (s: string) => SEVERITY[s] ?? 9

export function maintStatus(item: MaintItem, cuts: PowerCut[], today: string, now: number): MaintStatus {
  const base = item.last_done_on ?? item.started_on
  let daysLeft: number | null = null
  let dueOn: string | null = null
  let state: DueState | 'none' = 'none'
  let hoursSince: number | null = null
  let hoursLeft: number | null = null
  const bits: string[] = []
  if (item.every_days) {
    dueOn = addDays(base, item.every_days)
    daysLeft = daysBetween(today, dueOn)
    state = dueState(daysLeft, item.every_days)
    bits.push(daysLeft < 0 ? `${-daysLeft} D OVERDUE` : daysLeft === 0 ? 'DUE TODAY' : `DUE ${dueOn} (${daysLeft} D)`)
  }
  if (item.every_hours) {
    hoursSince = genHoursSince(cuts, item.last_done_on, now)
    hoursLeft = item.every_hours - hoursSince
    const hs: DueState = hoursLeft < 0 ? 'late' : hoursLeft === 0 ? 'due' : hoursLeft <= item.every_hours * 0.1 ? 'soon' : 'ok'
    if (state === 'none' || severity(hs) < severity(state)) state = hs
    bits.push(hoursLeft < 0 ? `${(-hoursLeft).toFixed(1)} H PAST` : `${hoursSince.toFixed(1)} OF ${item.every_hours} H RUN`)
  }
  if (state === 'none') bits.push('NO SCHEDULE')
  return { item, state, dueOn, daysLeft, hoursSince, hoursLeft, text: bits.join(' // ') }
}
export function maintBoard(items: MaintItem[], cuts: PowerCut[], today: string, now: number): MaintStatus[] {
  return items
    .filter((i) => i.active !== false)
    .map((i) => maintStatus(i, cuts, today, now))
    .sort((a, b) => severity(a.state) - severity(b.state) || (a.dueOn ?? '9').localeCompare(b.dueOn ?? '9') || a.item.name.localeCompare(b.item.name))
}

export interface MaintInput {
  name: string
  category: MaintCategory
  room: string | null
  make: string | null
  serial: string | null
  installed: string | null
  everyDays: number | null
  everyHours: number | null
  startedOn: string
  notes?: string | null
}
export function checkMaint(i: MaintInput): string | null {
  if (!clean(i.name)) return 'GIVE THE EQUIPMENT OR JOB A NAME.'
  if (!MAINT_CATEGORIES.includes(i.category)) return 'PICK A KIND.'
  if (i.room && !(i.room in ROOM_LABEL)) return 'UNKNOWN ROOM.'
  if (!isDay(i.startedOn)) return 'PICK THE DAY THE CLOCK STARTS.'
  if (i.installed && !isDay(i.installed)) return 'PICK A REAL INSTALL DAY.'
  if (i.everyDays !== null && (!Number.isInteger(i.everyDays) || i.everyDays < 1 || i.everyDays > 3650)) return 'DAYS BETWEEN JOBS MUST BE A WHOLE NUMBER, 1 TO 3650.'
  if (i.everyHours !== null && (!Number.isFinite(i.everyHours) || i.everyHours < 1 || i.everyHours > 100000)) return 'HOURS BETWEEN JOBS MUST BE 1 TO 100000.'
  return null
}

// ==========================================================================================
// CLEANING
// ==========================================================================================

export const CLEAN_TASKS = [
  { id: 'wipe', label: 'WIPE SURFACES' },
  { id: 'mop', label: 'MOP FLOOR' },
  { id: 'sanitise', label: 'SANITISE' },
  { id: 'drains', label: 'DRAINS + SINKS' },
  { id: 'deep', label: 'DEEP CLEAN (WALLS, SHELVES, UNDER)' },
  { id: 'waste', label: 'WASTE OUT' },
] as const
export type CleanTask = (typeof CLEAN_TASKS)[number]['id']
export const CLEAN_LABEL = Object.fromEntries(CLEAN_TASKS.map((t) => [t.id, t.label])) as Record<CleanTask, string>

export interface CleanEntry extends Row {
  cleaned_on: string
  room_id: string
  tasks: CleanTask[]
  product: string | null
  who: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}
export interface CleanInput {
  day: string
  room: string
  tasks: CleanTask[]
  product?: string | null
  who?: string | null
  notes?: string | null
}
export function checkClean(i: CleanInput, today: string): string | null {
  if (!isDay(i.day)) return 'PICK THE DAY.'
  if (i.day > today) return 'THE DAY IS IN THE FUTURE.'
  if (!ROOM_LIST.some((r) => r.id === i.room)) return 'PICK THE ROOM.'
  if (!i.tasks.length) return 'TICK AT LEAST ONE JOB THAT WAS DONE.'
  if (i.tasks.some((t) => !(t in CLEAN_LABEL))) return 'UNKNOWN JOB.'
  return null
}
export interface CleanDue {
  room: string
  last: CleanEntry | null
  every: number
  dueOn: string | null
  left: number | null
  state: DueState
}
export function cleanDue(entries: CleanEntry[], today: string, s: FacilitySettings = DEFAULT_FACILITY): CleanDue[] {
  return ROOM_LIST.map((r) => {
    let last: CleanEntry | null = null
    for (const e of entries) if (e.room_id === r.id && (!last || e.cleaned_on > last.cleaned_on || (e.cleaned_on === last.cleaned_on && (e.created_at ?? '') > (last.created_at ?? '')))) last = e
    const every = s.cleanEvery[r.id] ?? 0
    if (!every) return { room: r.id, last, every, dueOn: null, left: null, state: 'off' as const }
    if (!last) return { room: r.id, last, every, dueOn: null, left: null, state: 'never' as const }
    const dueOn = addDays(last.cleaned_on, every)
    const left = daysBetween(today, dueOn)
    return { room: r.id, last, every, dueOn, left, state: dueState(left, every) }
  })
}

// ==========================================================================================
// CHECKLISTS
// ==========================================================================================

export interface CheckItemState {
  id: string
  state: 'ok' | 'skip'
  note?: string | null
}
export interface ChecklistRun extends Row {
  template: string
  done_on: string
  finished_at: string
  who: string | null
  items: CheckItemState[]
  note: string | null
  created_at?: string
}
/** A signed-off run needs every step answered; a skipped step needs a reason. */
export function checkRun(t: CheckTemplate, items: CheckItemState[], who: string | null): string | null {
  if (!clean(who)) return 'TYPE YOUR NAME OR INITIALS TO SIGN OFF.'
  for (const s of t.steps) {
    const it = items.find((x) => x.id === s.id)
    if (!it) return `STEP NOT ANSWERED: ${s.text.slice(0, 50).toUpperCase()}...`
    if (it.state === 'skip' && !clean(it.note)) return `SAY WHY YOU SKIPPED: ${s.text.slice(0, 40).toUpperCase()}...`
  }
  return null
}
export interface CheckDue {
  template: CheckTemplate
  last: ChecklistRun | null
  every: number
  dueOn: string | null
  left: number | null
  state: DueState
}
export function checkDue(runs: ChecklistRun[], today: string, s: FacilitySettings = DEFAULT_FACILITY): CheckDue[] {
  return CHECKLISTS.map((t) => {
    let last: ChecklistRun | null = null
    for (const r of runs) if (r.template === t.key && (!last || r.done_on > last.done_on || (r.done_on === last.done_on && r.finished_at > last.finished_at))) last = r
    const every = s.checkEvery[t.key] ?? 0
    if (!every) return { template: t, last, every, dueOn: null, left: null, state: 'off' as const }
    if (!last) return { template: t, last, every, dueOn: null, left: null, state: 'never' as const }
    const dueOn = addDays(last.done_on, every)
    const left = daysBetween(today, dueOn)
    return { template: t, last, every, dueOn, left, state: dueState(left, every) }
  })
}

// ==========================================================================================
// REMINDERS
// ==========================================================================================

export interface Custom extends Row {
  due_on: string
  text: string
  repeat_days: number | null
  done_on: string | null
  created_at?: string
  updated_at?: string
}
export function checkCustom(due: string, text: string, repeat: number | null): string | null {
  if (!isDay(due)) return 'PICK THE DAY.'
  if (!clean(text)) return 'TYPE WHAT TO REMEMBER.'
  if (repeat !== null && (!Number.isInteger(repeat) || repeat < 1 || repeat > 3650)) return 'REPEAT MUST BE A WHOLE NUMBER OF DAYS, 1 TO 3650.'
  return null
}
/** Done today: a repeating reminder moves to its next day after today; a one-off is closed. */
export function completeCustom(r: Custom, today: string): Partial<Custom> {
  if (!r.repeat_days) return { done_on: today }
  let next = r.due_on
  let guard = 0
  while (next <= today && guard++ < 5000) next = addDays(next, r.repeat_days)
  return { due_on: next, done_on: null }
}

export type ReminderKind = 'POWER' | 'MOVE' | 'HARVEST' | 'PLATES' | 'STORAGE' | 'STOCK' | 'ROUTINE' | 'FILTER' | 'MAINT' | 'CLEAN' | 'WATER' | 'CHECKLIST' | 'MONEY' | 'CUSTOM'
export interface Reminder {
  key: string
  kind: ReminderKind
  text: string
  warn: boolean
  /** The day it is due (null = right now). */
  due: string | null
  /** Where to fix it. */
  go: { screen: 'FACILITY' | 'MONEY' | 'MISSION' | 'XENO' | 'CARGO' | 'TRADE'; tab?: string } | null
}

/** The farm's week as Joseph runs it. 1 = Monday. */
export const ROUTINE: Record<number, { text: string; check?: string }> = {
  1: { text: 'MONDAY: SUBSTRATE MIX AND STEAM RUN. OPEN THE STEAM RUN CHECKLIST.', check: 'cook' },
  2: { text: 'TUESDAY IS KNOCK DAY. OPEN THE KNOCK DAY CHECKLIST.', check: 'knock' },
  3: { text: 'WEDNESDAY: GRAIN. MEGACHEFS AND 75X RUNS. CHECK THE POWER PLAN FIRST.' },
  4: { text: 'THURSDAY: CULTURES AND AGAR.' },
  5: { text: 'FRIDAY: PICK AND SELL. OPEN STANDING ORDERS FOR THE PICK LIST.' },
  6: { text: 'SATURDAY: SALES. COLLECT CASH ON DELIVERY.' },
}
const dowOf = (day: string) => {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)))
  return ((d.getUTCDay() + 6) % 7) + 1
}

export interface ReminderInput {
  today: string
  settings: FacilitySettings
  /** From MISSION: moves, harvests, culture ages and reorders. */
  todayItems: TodayItem[]
  /** Bank warnings per strain, from the culture bank. */
  bankWarnings: { strain: string; text: string }[]
  maint: MaintStatus[]
  water: WaterDue[]
  clean: CleanDue[]
  checks: CheckDue[]
  owed: { buyer: string; crc: number; days: number }[]
  custom: Custom[]
  openCut: PowerCut | null
  now: number
}

const KIND_ORDER: ReminderKind[] = ['POWER', 'MOVE', 'HARVEST', 'MONEY', 'STOCK', 'PLATES', 'STORAGE', 'FILTER', 'MAINT', 'WATER', 'CLEAN', 'CHECKLIST', 'ROUTINE', 'CUSTOM']
const crcShort = (n: number) => `₡${Math.round(n).toLocaleString('en-US')}`

export function buildReminders(i: ReminderInput): Reminder[] {
  const out: Reminder[] = []
  const { today, settings: s } = i
  const lead = s.leadDays
  if (i.openCut) out.push({ key: `power:${i.openCut.id}`, kind: 'POWER', warn: true, due: null, text: `POWER IS OUT SINCE ${stamp(Date.parse(i.openCut.down_at))}. WHEN IT RETURNS PRESS POWER IS BACK.`, go: { screen: 'FACILITY', tab: 'POWER CUTS' } })
  for (const t of i.todayItems) {
    const kind: ReminderKind = t.kind === 'MOVE' ? 'MOVE' : t.kind === 'HARVEST' ? 'HARVEST' : t.kind === 'REORDER' ? 'STOCK' : 'PLATES'
    out.push({ key: `today:${t.kind}:${t.ref ?? t.text}`, kind, warn: t.warn, due: null, text: t.text, go: { screen: t.kind === 'REORDER' ? 'CARGO' : t.kind === 'CULTURE' ? 'XENO' : 'MISSION' } })
  }
  for (const b of i.bankWarnings) out.push({ key: `bank:${b.strain}:${b.text}`, kind: 'STORAGE', warn: /OVERDUE|DUE|NOTHING/.test(b.text), due: null, text: `${b.strain}: ${b.text}`, go: { screen: 'XENO' } })
  for (const m of i.maint) {
    if (m.state === 'none' || m.state === 'ok' || m.state === 'never' || m.state === 'off') continue
    if (m.state === 'soon' && (m.daysLeft === null || m.daysLeft > lead) && (m.hoursLeft === null || m.hoursLeft > 0)) continue
    const filter = /FILTER|PRE-FILTER|CARTRIDGE|UV LAMP/.test(m.item.name)
    out.push({ key: `maint:${m.item.id}`, kind: filter ? 'FILTER' : 'MAINT', warn: m.state === 'late' || m.state === 'due', due: m.dueOn, text: `${m.item.name}: ${m.text}`, go: { screen: 'FACILITY', tab: 'MAINTENANCE' } })
  }
  for (const w of i.water) {
    if (w.state === 'never') {
      if (w.point === 'ro' || w.point === 'tank') out.push({ key: `water:${w.point}`, kind: 'WATER', warn: false, due: null, text: `NO WATER TEST LOGGED FOR ${WATER_LABEL[w.point]} YET`, go: { screen: 'FACILITY', tab: 'WATER' } })
      continue
    }
    if (w.last && w.issues.length) out.push({ key: `waterbad:${w.point}:${w.last.id}`, kind: 'WATER', warn: true, due: null, text: `${WATER_LABEL[w.point]}: ${w.issues[0].text}${w.issues.length > 1 ? ` +${w.issues.length - 1} MORE` : ''}`, go: { screen: 'FACILITY', tab: 'WATER' } })
    if (w.state === 'off' || w.state === 'ok' || w.left === null) continue
    if (w.state === 'soon' && w.left > lead) continue
    out.push({ key: `water:${w.point}`, kind: 'WATER', warn: w.state === 'late', due: w.dueOn, text: `WATER TEST ${w.state === 'late' ? `OVERDUE ${-w.left} D` : w.state === 'due' ? 'DUE TODAY' : `DUE ${w.dueOn}`}: ${WATER_LABEL[w.point]}`, go: { screen: 'FACILITY', tab: 'WATER' } })
  }
  for (const c of i.clean) {
    if (c.state === 'off' || c.state === 'ok' || c.state === 'never' || c.left === null) continue
    if (c.state === 'soon' && c.left > lead) continue
    out.push({ key: `clean:${c.room}`, kind: 'CLEAN', warn: c.state === 'late', due: c.dueOn, text: `CLEAN ${ROOM_LABEL[c.room]}: ${c.state === 'late' ? `${-c.left} D OVERDUE` : c.state === 'due' ? 'DUE TODAY' : `DUE ${c.dueOn}`}`, go: { screen: 'FACILITY', tab: 'CLEANING' } })
  }
  for (const c of i.checks) {
    if (c.state === 'off' || c.state === 'ok' || c.state === 'never' || c.left === null) continue
    if (c.state === 'soon' && c.left > lead) continue
    out.push({ key: `chk:${c.template.key}`, kind: 'CHECKLIST', warn: c.state === 'late', due: c.dueOn, text: `${c.template.title}: ${c.state === 'late' ? `${-c.left} D SINCE IT WAS DUE` : c.state === 'due' ? 'SIGN-OFF DUE TODAY' : `NEXT BY ${c.dueOn}`}`, go: { screen: 'FACILITY', tab: 'CHECKLISTS' } })
  }
  for (const o of i.owed) out.push({ key: `owed:${o.buyer}`, kind: 'MONEY', warn: o.days > 14, due: null, text: `${o.buyer} OWES ${crcShort(o.crc)} // ${o.days} D`, go: { screen: 'MONEY', tab: 'OWED' } })
  if (s.routineOn) {
    const r = ROUTINE[dowOf(today)]
    if (r) out.push({ key: `routine:${today}`, kind: 'ROUTINE', warn: false, due: today, text: r.text, go: r.check ? { screen: 'FACILITY', tab: 'CHECKLISTS' } : null })
  }
  for (const c of i.custom) {
    if (c.done_on) continue
    const left = daysBetween(today, c.due_on)
    if (left > lead) continue
    out.push({ key: `custom:${c.id}`, kind: 'CUSTOM', warn: left < 0, due: c.due_on, text: `${c.text}${left < 0 ? ` // ${-left} D OVERDUE` : left === 0 ? ' // TODAY' : ` // ${c.due_on}`}`, go: { screen: 'FACILITY', tab: 'REMINDERS' } })
  }
  const live = out.filter((r) => !((s.snoozed[r.key] ?? '') >= today))
  return live.sort((a, b) => Number(b.warn) - Number(a.warn) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.text.localeCompare(b.text))
}

/** Reminders to hand to the phone as an alert: warnings and anything due today, not shown before today. */
export function toNotify(rs: Reminder[], sent: { day: string; keys: string[] }, today: string): Reminder[] {
  const already = new Set(sent.day === today ? sent.keys : [])
  return rs.filter((r) => (r.warn || r.due === today || r.due === null) && r.kind !== 'ROUTINE' && !already.has(r.key))
}

// ---------- phone calendar file (.ics) ----------

const icsEsc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDay = (d: string) => d.replace(/-/g, '')
/**
 * Calendar file of what is coming up. A phone calendar rings by itself, even when the app is closed.
 * Each item is an all-day event with an alert at 08:00 on the day.
 */
export function icsFor(rs: Reminder[], today: string, stampMs: number): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MYCOL//FACILITY//EN', 'CALSCALE:GREGORIAN']
  const dt = isoOf(stampMs).replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  for (const r of rs) {
    const day = r.due && r.due > today ? r.due : today
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.key.replace(/[^A-Za-z0-9:_-]/g, '_')}-${icsDay(day)}@mycol`,
      `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${icsDay(day)}`,
      `DTEND;VALUE=DATE:${icsDay(addDays(day, 1))}`,
      `SUMMARY:${icsEsc(r.text.slice(0, 120))}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEsc(r.text.slice(0, 120))}`,
      'TRIGGER:PT8H',
      'END:VALARM',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// ---------- the main-menu status board ----------

export interface BoardLine {
  label: string
  value: string
  warn: boolean
}
export function statusLines(i: { now: number; today: string; cuts: PowerCut[]; reminders: Reminder[]; water: WaterDue[]; maint: MaintStatus[]; owedCrc: number }): BoardLine[] {
  const o = outageSummary(i.cuts, i.now)
  const lines: BoardLine[] = []
  if (o.open) lines.push({ label: 'POWER', value: `OUT FOR ${fmtMin(cutStats(o.open, i.now).gridMin)}`, warn: true })
  else lines.push({ label: 'POWER', value: o.last ? `GRID UP // LAST CUT ${stamp(Date.parse(o.last.up_at as string))}` : 'GRID UP // NO CUT LOGGED', warn: false })
  lines.push({ label: 'NO GRID THIS MONTH', value: `${fmtHours(o.thisMonth.gridMin)} // ${o.thisMonth.cuts} CUT${o.thisMonth.cuts === 1 ? '' : 'S'}`, warn: false })
  const warned = i.reminders.filter((r) => r.warn).length
  lines.push({ label: 'REMINDERS', value: i.reminders.length ? `${i.reminders.length}${warned ? ` // ${warned} URGENT` : ''}` : 'NONE', warn: warned > 0 })
  const late = i.maint.filter((m) => m.state === 'late' || m.state === 'due').length
  lines.push({ label: 'MAINTENANCE', value: late ? `${late} DUE OR OVERDUE` : 'ALL ON TIME', warn: late > 0 })
  const tested = i.water.filter((w) => w.last).map((w) => w.last as WaterTest).sort((a, b) => b.tested_on.localeCompare(a.tested_on))
  const bad = i.water.filter((w) => w.issues.length).length
  lines.push({ label: 'WATER', value: tested.length ? `LAST TEST ${dayLong(tested[0].tested_on)}${bad ? ` // ${bad} OUT OF LIMIT` : ''}` : 'NO TEST LOGGED', warn: bad > 0 })
  if (i.owedCrc > 0) lines.push({ label: 'OWED', value: crcShort(i.owedCrc), warn: true })
  return lines
}

