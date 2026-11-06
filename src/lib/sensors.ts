// CLIMATE SENSORS (build G8, basic): readings, set-point bands, alarms, Govee CSV import and mock data.
// Pure functions only. Writes live in sensorActions.ts, feed adapters in sensorFeeds.ts.
//
// Moments are UTC ISO text in the database. Days and clock times shown are the FARM's (Costa Rica, UTC-6),
// using the same helpers as FACILITY LOGS.

import type { Row } from './store'
import { farmDay, farmTime, fromFarm, isoOf, stamp, fmtMin } from './facility'

export const SENSORS_ID = 'sensors'
const MIN = 60000
const HOUR = 60 * MIN

// ---------- places and measures ----------

export type PlaceId = 'lab' | 'fridge' | 'packing' | 'coldroom' | 'incubation' | 'fruiting' | 'boiling' | 'outside'
export interface Place {
  id: PlaceId
  label: string
  /** Longer name for the place picker and graphs. */
  long: string
  /** The DECK PLAN room it sits in. */
  room: 'lab' | 'packing' | 'incubation' | 'fruiting' | 'boiling' | 'outside'
}
export const PLACES: Place[] = [
  { id: 'lab', label: 'LAB', long: 'LAB AIR', room: 'lab' },
  { id: 'fridge', label: 'CULTURE FRIDGE', long: 'CULTURE FRIDGE (LAB CHEST FRIDGE)', room: 'lab' },
  { id: 'packing', label: 'PACKING', long: 'PACKING / FRUITING SUPPLY PLENUM', room: 'packing' },
  { id: 'coldroom', label: 'COLD ROOMS', long: 'COLD ROOMS (PACKING)', room: 'packing' },
  { id: 'incubation', label: 'INCUBATION', long: 'INCUBATION AIR', room: 'incubation' },
  { id: 'fruiting', label: 'FRUITING', long: 'FRUITING AIR', room: 'fruiting' },
  { id: 'boiling', label: 'BOILING ROOM', long: 'BOILING ROOM', room: 'boiling' },
  { id: 'outside', label: 'OUTSIDE', long: 'OUTSIDE (SHADE)', room: 'outside' },
]
export const PLACE_IDS = PLACES.map((p) => p.id)
export const PLACE_LABEL = Object.fromEntries(PLACES.map((p) => [p.id, p.label])) as Record<PlaceId, string>
export const isPlace = (v: unknown): v is PlaceId => typeof v === 'string' && (PLACE_IDS as string[]).includes(v)

export type Measure = 'temp' | 'rh' | 'co2'
export const MEASURES: { id: Measure; label: string; long: string; unit: string; col: 'temp_c' | 'rh' | 'co2_ppm'; dp: number; lo: number; hi: number }[] = [
  { id: 'temp', label: 'TEMP', long: 'TEMPERATURE', unit: 'C', col: 'temp_c', dp: 1, lo: -20, hi: 60 },
  { id: 'rh', label: 'RH', long: 'RELATIVE HUMIDITY', unit: '%', col: 'rh', dp: 0, lo: 0, hi: 100 },
  { id: 'co2', label: 'CO2', long: 'CARBON DIOXIDE', unit: 'PPM', col: 'co2_ppm', dp: 0, lo: 0, hi: 20000 },
]
export const MEASURE = Object.fromEntries(MEASURES.map((m) => [m.id, m])) as Record<Measure, (typeof MEASURES)[number]>
export const valueOf = (r: Reading, m: Measure): number | null => {
  const v = r[MEASURE[m].col]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
export const fmtVal = (v: number | null, m: Measure) => (v === null ? '--' : `${v.toFixed(MEASURE[m].dp)}${m === 'temp' ? ' C' : m === 'rh' ? '%' : ' PPM'}`)

// ---------- set-point bands ----------

export interface Band {
  lo: number | null
  hi: number | null
}
export type PlaceBands = Partial<Record<Measure, Band>>

/**
 * Alarm bands per place. The limits that are written in the farm's HVAC plan are used as they are
 * (fridge and cold rooms 1-4 C, incubation alarm at 21 C air, fruiting alarm at 19 C air, fruiting RH 80%).
 * The rest are working numbers: GUESS - REVIEW (listed in SENSOR_GUESSES).
 */
export const DEFAULT_BANDS: Record<PlaceId, PlaceBands> = {
  lab: { temp: { lo: 16, hi: 21 } },
  fridge: { temp: { lo: 1, hi: 4 } },
  packing: { temp: { lo: 10, hi: 16 }, co2: { lo: null, hi: 600 } },
  coldroom: { temp: { lo: 1, hi: 4 } },
  incubation: { temp: { lo: 15, hi: 21 }, co2: { lo: null, hi: 4000 } },
  fruiting: { temp: { lo: 13, hi: 19 }, rh: { lo: 80, hi: 96 }, co2: { lo: null, hi: 1200 } },
  boiling: {},
  outside: {},
}

/** What each place is aiming for, in words (from the farm's set points). Shown beside the bands. */
export const TARGETS: Record<PlaceId, string> = {
  lab: 'AIR 18-19 C, POSITIVE PRESSURE',
  fridge: '1-4 C',
  packing: 'PLENUM AIR 12-14 C, DO NOT HUMIDIFY, CO2 AT OR BELOW ~450 PPM',
  coldroom: '1-4 C',
  incubation: 'AIR ~18 C, BLOCK CORES AT OR BELOW 21-22 C, CO2 EXHAUST ON AT 3,000 PPM',
  fruiting: 'AIR 16 C (14-17, MAX 18), RH 80-90%, CO2 EXHAUST ON 900 / OFF 600 PPM',
  boiling: 'NO CLIMATE TARGET. RECORD ONLY.',
  outside: 'NO TARGET. FOR COMPARISON (THE SITE AVERAGES ~25 C AND ~88% RH).',
}

export interface SensorSettings {
  /** Changes to the alarm bands (only what Joseph changed; the rest comes from DEFAULT_BANDS). */
  bands: Partial<Record<PlaceId, PlaceBands>>
  /** Minutes a place must stay out of its band before it alarms (door openings, defrost). */
  delayMin: Record<PlaceId, number>
  /** An automatic sensor with no reading for this many minutes is SILENT. */
  silentMin: number
  /** Readings older than this many hours no longer raise an alarm (the screen says how old they are). */
  staleHours: number
  /** Alarm key -> when it was acknowledged (ISO). */
  acks: Record<string, string>
  /** Unit the Govee cloud reports temperature in. Its own sample shows Fahrenheit. */
  goveeUnit: 'F' | 'C'
}

export const DEFAULT_SENSOR_SETTINGS: SensorSettings = {
  bands: {},
  delayMin: { lab: 15, fridge: 30, packing: 15, coldroom: 30, incubation: 20, fruiting: 15, boiling: 15, outside: 15 },
  silentMin: 30,
  staleHours: 12,
  acks: {},
  goveeUnit: 'F',
}

const numIn = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d)
const limOk = (v: unknown, m: Measure): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= MEASURE[m].lo && v <= MEASURE[m].hi ? v : null)

export function mergeSensorSettings(v: unknown): SensorSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const d = DEFAULT_SENSOR_SETTINGS
  const bands: Partial<Record<PlaceId, PlaceBands>> = {}
  const ob = (o.bands && typeof o.bands === 'object' ? o.bands : {}) as Record<string, unknown>
  for (const p of PLACE_IDS) {
    const pb = ob[p]
    if (!pb || typeof pb !== 'object') continue
    const out: PlaceBands = {}
    for (const m of MEASURES) {
      const b = (pb as Record<string, unknown>)[m.id]
      if (b === null) out[m.id] = { lo: null, hi: null } // band switched off
      else if (b && typeof b === 'object') {
        const lo = limOk((b as Band).lo, m.id)
        const hi = limOk((b as Band).hi, m.id)
        out[m.id] = lo !== null && hi !== null && lo >= hi ? { lo: null, hi } : { lo, hi }
      }
    }
    if (Object.keys(out).length) bands[p] = out
  }
  const od = (o.delayMin && typeof o.delayMin === 'object' ? o.delayMin : {}) as Record<string, unknown>
  const delayMin = Object.fromEntries(PLACE_IDS.map((p) => [p, Math.round(numIn(od[p], 0, 24 * 60, d.delayMin[p]))])) as Record<PlaceId, number>
  const acks: Record<string, string> = {}
  if (o.acks && typeof o.acks === 'object') for (const [k, t] of Object.entries(o.acks as Record<string, unknown>)) if (typeof t === 'string' && k.length < 200) acks[k] = t
  return {
    bands,
    delayMin,
    silentMin: Math.round(numIn(o.silentMin, 5, 24 * 60, d.silentMin)),
    staleHours: numIn(o.staleHours, 1, 24 * 14, d.staleHours),
    acks,
    goveeUnit: o.goveeUnit === 'C' ? 'C' : 'F',
  }
}

/** The band in force for one place and measure (Joseph's change, else the default). null = no alarm. */
export function bandFor(s: SensorSettings, p: PlaceId, m: Measure): Band | null {
  const b = s.bands[p]?.[m] ?? DEFAULT_BANDS[p][m] ?? null
  return b && (b.lo !== null || b.hi !== null) ? b : null
}

export type Side = 'ok' | 'low' | 'high'
export const sideOf = (v: number, b: Band | null): Side => (!b ? 'ok' : b.lo !== null && v < b.lo ? 'low' : b.hi !== null && v > b.hi ? 'high' : 'ok')
export const bandText = (b: Band | null, m: Measure) => {
  if (!b) return 'NO ALARM'
  const u = m === 'temp' ? ' C' : m === 'rh' ? '%' : ' PPM'
  if (b.lo !== null && b.hi !== null) return `${b.lo}-${b.hi}${u}`
  if (b.lo !== null) return `AT LEAST ${b.lo}${u}`
  return `AT MOST ${b.hi}${u}`
}

// ---------- records ----------

export type Vendor = 'govee' | 'lennox' | 'co2meter' | 'inkbird' | 'hand' | 'other'
export const VENDORS: { id: Vendor; label: string }[] = [
  { id: 'govee', label: 'GOVEE' },
  { id: 'co2meter', label: 'CO2METER' },
  { id: 'inkbird', label: 'INKBIRD' },
  { id: 'lennox', label: 'LENNOX' },
  { id: 'hand', label: 'HAND METER' },
  { id: 'other', label: 'OTHER' },
]
export const VENDOR_LABEL = Object.fromEntries(VENDORS.map((v) => [v.id, v.label])) as Record<Vendor, string>

/** One sensor (a Govee thermo-hygrometer, a CO2 meter, a hand thermometer ...). */
export interface Sensor extends Row {
  name: string
  place: PlaceId
  vendor: Vendor
  /** Maker's model, e.g. H5179. */
  model: string | null
  /** The maker's device id (Govee: the MAC-like id the app shows). */
  device_id: string | null
  measures: Measure[]
  /** True = it should report by itself (a feed). An automatic sensor that goes quiet raises SILENT. */
  auto: boolean
  active: boolean
  /** Made by MOCK TEST: removed with the mock readings. */
  mock: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type Source = 'hand' | 'csv' | 'mock' | 'govee' | 'lennox' | 'bridge'
export const SOURCE_LABEL: Record<Source, string> = { hand: 'BY HAND', csv: 'CSV FILE', mock: 'MOCK', govee: 'GOVEE FEED', lennox: 'LENNOX FEED', bridge: 'BRIDGE' }

export interface Reading extends Row {
  sensor_id: string | null
  place: PlaceId
  taken_at: string
  temp_c: number | null
  rh: number | null
  co2_ppm: number | null
  source: Source
  /** Rows saved together (one CSV file, one mock run) share a batch, so they can be removed together. */
  batch: string | null
  who: string | null
  note: string | null
  created_at: string
}

export type AcMode = 'cool' | 'dry' | 'fan' | 'heat' | 'auto' | 'off'
export const AC_MODES: { id: AcMode; label: string }[] = [
  { id: 'cool', label: 'COOL' },
  { id: 'dry', label: 'DRY' },
  { id: 'fan', label: 'FAN' },
  { id: 'auto', label: 'AUTO' },
  { id: 'heat', label: 'HEAT' },
  { id: 'off', label: 'OFF' },
]
export type AcState = 'running' | 'stopped' | 'fault'
export const AC_STATES: { id: AcState; label: string }[] = [
  { id: 'running', label: 'RUNNING' },
  { id: 'stopped', label: 'NOT RUNNING' },
  { id: 'fault', label: 'FAULT / ERROR CODE' },
]
/** The four Lennox inverter mini-splits on the electrical plan. */
export const AC_UNITS: { id: string; label: string; place: PlaceId }[] = [
  { id: 'lennox36a', label: 'LENNOX 36K #1', place: 'packing' },
  { id: 'lennox36b', label: 'LENNOX 36K #2', place: 'packing' },
  { id: 'lennox12a', label: 'LENNOX 12K #1', place: 'incubation' },
  { id: 'lennox12b', label: 'LENNOX 12K #2', place: 'incubation' },
]
export const AC_LABEL = Object.fromEntries(AC_UNITS.map((u) => [u.id, u.label])) as Record<string, string>

/** A hand check of one air conditioner (there is no usable Lennox feed yet). */
export interface AcCheck extends Row {
  unit: string
  logged_at: string
  mode: AcMode
  set_c: number | null
  /** Temperature the unit's own display or remote shows. */
  shown_c: number | null
  state: AcState
  fault_code: string | null
  notes: string | null
  who: string | null
  created_at: string
  updated_at: string
}

// ---------- checks ----------

const clean = (s: string | null | undefined, max = 200): string | null => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null
export const cleanNote = clean

export interface ReadingInput {
  place: PlaceId | null
  sensor_id: string | null
  /** Moment (ms). NaN = not a real day/time. */
  at: number | null
  temp: number | null
  rh: number | null
  co2: number | null
  note: string
  who: string
}
export const EARLIEST = Date.UTC(2020, 0, 1)

/** null = fine, or the problem in plain words. now lets the check refuse readings in the future. */
export function checkReading(i: ReadingInput, now: number): string | null {
  if (!i.place || !isPlace(i.place)) return 'PICK WHERE THE READING WAS TAKEN.'
  if (i.at === null || !Number.isFinite(i.at)) return 'THE DAY OR TIME IS NOT REAL.'
  if (i.at > now + 5 * MIN) return 'THAT TIME IS IN THE FUTURE.'
  if (i.at < EARLIEST) return 'THAT DAY IS BEFORE 2020.'
  const vals = [i.temp, i.rh, i.co2]
  if (vals.some((v) => v !== null && !Number.isFinite(v))) return 'A NUMBER IS NOT READABLE. USE DIGITS AND A DOT.'
  if (vals.every((v) => v === null)) return 'TYPE AT LEAST ONE VALUE: TEMPERATURE, HUMIDITY OR CO2.'
  for (const m of MEASURES) {
    const v = m.id === 'temp' ? i.temp : m.id === 'rh' ? i.rh : i.co2
    if (v !== null && (v < m.lo || v > m.hi)) return `${m.label} ${v} IS OUTSIDE WHAT A SENSOR CAN READ (${m.lo} TO ${m.hi}${m.id === 'temp' ? ' C' : m.id === 'rh' ? '%' : ' PPM'}).`
  }
  return null
}

export interface SensorInput {
  name: string
  place: PlaceId | null
  vendor: Vendor
  model: string
  device_id: string
  measures: Measure[]
  auto: boolean
  notes: string
}
export function checkSensor(i: SensorInput, others: Sensor[], id: string | null): string | null {
  const name = clean(i.name, 60)
  if (!name) return 'GIVE THE SENSOR A NAME, E.G. FRUITING NORTH.'
  if (!i.place || !isPlace(i.place)) return 'PICK WHERE THE SENSOR IS.'
  if (!i.measures.length) return 'PICK WHAT IT MEASURES.'
  if (others.some((s) => s.id !== id && s.active && s.name.toUpperCase() === name.toUpperCase())) return 'ANOTHER SENSOR HAS THAT NAME.'
  const dev = clean(i.device_id, 80)
  if (dev && others.some((s) => s.id !== id && s.active && s.device_id && s.device_id.toUpperCase() === dev.toUpperCase())) return 'ANOTHER SENSOR HAS THAT DEVICE ID.'
  return null
}

export interface AcInput {
  unit: string
  at: number | null
  mode: AcMode
  set: number | null
  shown: number | null
  state: AcState
  fault: string
  notes: string
  who: string
}
export function checkAc(i: AcInput, now: number): string | null {
  if (!AC_LABEL[i.unit]) return 'PICK THE AIR CONDITIONER.'
  if (i.at === null || !Number.isFinite(i.at)) return 'THE DAY OR TIME IS NOT REAL.'
  if (i.at > now + 5 * MIN) return 'THAT TIME IS IN THE FUTURE.'
  if (i.at < EARLIEST) return 'THAT DAY IS BEFORE 2020.'
  for (const [v, w] of [[i.set, 'SET'], [i.shown, 'SHOWN']] as const) {
    if (v !== null && !Number.isFinite(v)) return `THE ${w} TEMPERATURE IS NOT READABLE.`
    if (v !== null && (v < 0 || v > 40)) return `THE ${w} TEMPERATURE SHOULD BE 0-40 C.`
  }
  if (i.state === 'fault' && !clean(i.fault)) return 'TYPE THE ERROR CODE OR WHAT THE UNIT SHOWS.'
  return null
}

// ---------- series (fast lookups over many readings) ----------

export interface Series {
  place: PlaceId
  /** Moments (ms), oldest first, same order as rows. */
  t: number[]
  rows: Reading[]
}
export type SeriesIndex = Map<PlaceId, Series>

/** Group readings by place, oldest first. Unreadable times are skipped. */
export function indexReadings(readings: Reading[]): SeriesIndex {
  const by = new Map<PlaceId, { t: number; r: Reading }[]>()
  for (const r of readings) {
    const t = Date.parse(r.taken_at)
    if (!Number.isFinite(t) || !isPlace(r.place)) continue
    let a = by.get(r.place)
    if (!a) by.set(r.place, (a = []))
    a.push({ t, r })
  }
  const out: SeriesIndex = new Map()
  for (const [p, a] of by) {
    a.sort((x, y) => x.t - y.t || x.r.id.localeCompare(y.r.id))
    out.set(p, { place: p, t: a.map((x) => x.t), rows: a.map((x) => x.r) })
  }
  return out
}

/** First index with t >= ms (binary search). */
export function lowerBound(t: number[], ms: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] < ms) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Index of the newest reading at or before `upto` that has this measure, or -1. Looks back at most `limit` rows. */
export function lastWith(s: Series, m: Measure, upto = s.rows.length - 1, limit = 20000): number {
  for (let i = upto, n = 0; i >= 0 && n < limit; i--, n++) if (valueOf(s.rows[i], m) !== null) return i
  return -1
}

// ---------- place status (the NOW board) ----------

export interface MeasureNow {
  measure: Measure
  value: number | null
  at: number | null
  band: Band | null
  side: Side
  /** When the current out-of-band run started (ms), if out. */
  outSince: number | null
  /** Minutes the place has been out so far (to the newest reading). */
  outMin: number
  /** Out long enough to alarm (or a hand spot check out of band). */
  alarm: boolean
  /** The reading is older than staleHours: shown, but not alarmed. */
  stale: boolean
  source: Source | null
}
export interface PlaceNow {
  place: PlaceId
  last: number | null
  measures: MeasureNow[]
  /** Any measure in alarm. */
  alarm: boolean
  /** Any measure outside its band (alarm or still inside the delay). */
  out: boolean
}

export function measureNow(s: Series | undefined, p: PlaceId, m: Measure, st: SensorSettings, now: number): MeasureNow {
  const band = bandFor(st, p, m)
  const none: MeasureNow = { measure: m, value: null, at: null, band, side: 'ok', outSince: null, outMin: 0, alarm: false, stale: false, source: null }
  if (!s) return none
  const i = lastWith(s, m)
  if (i < 0) return none
  const v = valueOf(s.rows[i], m) as number
  const at = s.t[i]
  const stale = now - at > st.staleHours * HOUR
  const side = sideOf(v, band)
  const out: MeasureNow = { ...none, value: v, at, side, stale, source: s.rows[i].source }
  if (side === 'ok') return out
  // Walk back while readings stay out on the same side.
  let start = at
  for (let j = i - 1, n = 0; j >= 0 && n < 50000; j--, n++) {
    const w = valueOf(s.rows[j], m)
    if (w === null) continue
    if (sideOf(w, band) !== side) break
    start = s.t[j]
  }
  const outMin = Math.round((at - start) / MIN)
  const delay = st.delayMin[p]
  const spot = s.rows[i].source === 'hand'
  return { ...out, outSince: start, outMin, alarm: !stale && (spot || outMin >= delay) }
}

export function placeNow(idx: SeriesIndex, p: PlaceId, st: SensorSettings, now: number): PlaceNow {
  const s = idx.get(p)
  const measures = MEASURES.map((m) => measureNow(s, p, m.id, st, now))
  const ats = measures.map((x) => x.at).filter((x): x is number => x !== null)
  return { place: p, last: ats.length ? Math.max(...ats) : null, measures, alarm: measures.some((x) => x.alarm), out: measures.some((x) => x.side !== 'ok' && !x.stale) }
}

// ---------- alarms ----------

export type AlarmKind = 'HIGH' | 'LOW' | 'SILENT' | 'ALL SILENT' | 'POWER' | 'AC FAULT'
export interface Alarm {
  key: string
  kind: AlarmKind
  /** How far past the limit, in steps of 1 C, 5% RH or 250 ppm CO2 (for ranking HIGH and LOW alarms). */
  over: number
  place: PlaceId | null
  measure: Measure | null
  text: string
  since: number
  acked: boolean
}

/** The newest reading from each sensor (ms), from the index. */
export function lastBySensor(idx: SeriesIndex): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of idx.values()) {
    for (let i = s.rows.length - 1; i >= 0; i--) {
      const id = s.rows[i].sensor_id
      if (id && !((out.get(id) ?? -Infinity) >= s.t[i])) out.set(id, s.t[i])
    }
  }
  return out
}

const STEP: Record<Measure, number> = { temp: 1, rh: 5, co2: 250 }

export interface AlarmInput {
  idx: SeriesIndex
  sensors: Sensor[]
  ac: AcCheck[]
  settings: SensorSettings
  now: number
  /** An open power cut from FACILITY LOGS, if any. */
  openCut: { id: string; down_at: string } | null
  /** lastBySensor(idx), if already worked out. */
  lastSeen?: Map<string, number>
}

export function alarms(i: AlarmInput): Alarm[] {
  const { idx, settings: st, now } = i
  const out: Alarm[] = []
  const acked = (key: string) => key in st.acks
  if (i.openCut) {
    const key = `power:${i.openCut.id}`
    out.push({ key, kind: 'POWER', over: 0, place: null, measure: null, since: Date.parse(i.openCut.down_at), acked: acked(key), text: `POWER IS OUT SINCE ${stamp(Date.parse(i.openCut.down_at))}. AIR CONDITIONERS AND FRIDGES MAY BE OFF: CHECK THE CULTURE FRIDGE AND COLD ROOMS.` })
  }
  for (const p of PLACE_IDS) {
    const pn = placeNow(idx, p, st, now)
    for (const m of pn.measures) {
      if (!m.alarm || m.value === null || m.outSince === null) continue
      const kind: AlarmKind = m.side === 'high' ? 'HIGH' : 'LOW'
      const key = `${p}:${m.measure}:${m.side}:${isoOf(m.outSince)}`
      const lim = (m.side === 'high' ? m.band?.hi : m.band?.lo) as number
      const by = Math.abs(m.value - lim)
      const u = m.measure === 'temp' ? ' C' : m.measure === 'rh' ? '%' : ' PPM'
      out.push({
        key, kind, place: p, measure: m.measure, since: m.outSince, acked: acked(key), over: by / STEP[m.measure],
        text: `${PLACE_LABEL[p]} ${MEASURE[m.measure].label} ${kind}: ${fmtVal(m.value, m.measure)}, ${by.toFixed(MEASURE[m.measure].dp)}${u} ${m.side === 'high' ? 'OVER THE' : 'UNDER THE'} ${lim}${u} ${m.side === 'high' ? 'LIMIT' : 'FLOOR'} // ${m.outMin ? `OUT FOR ${fmtMin(m.outMin)}` : 'HAND READING'} SINCE ${stamp(m.outSince)}`,
      })
    }
  }
  const last = i.lastSeen ?? lastBySensor(idx)
  const auto = i.sensors.filter((s) => s.active && s.auto)
  const silent: { s: Sensor; at: number }[] = []
  for (const s of auto) {
    const at = last.get(s.id)
    const since = at ?? Date.parse(s.created_at)
    if (!Number.isFinite(since)) continue
    if (now - since > st.silentMin * MIN) silent.push({ s, at: since })
  }
  if (auto.length >= 2 && silent.length === auto.length) {
    const newest = Math.max(...silent.map((x) => x.at))
    const key = `allsilent:${isoOf(newest)}`
    out.push({ key, kind: 'ALL SILENT', over: 0, place: null, measure: null, since: newest, acked: acked(key), text: `ALL ${auto.length} AUTOMATIC SENSORS ARE SILENT SINCE ${stamp(newest)}. POWER OR INTERNET MAY BE DOWN AT THE FARM.` })
  } else {
    for (const x of silent) {
      const key = `silent:${x.s.id}:${isoOf(x.at)}`
      const seen = last.has(x.s.id)
      out.push({ key, kind: 'SILENT', over: 0, place: x.s.place, measure: null, since: x.at, acked: acked(key), text: `${x.s.name} (${PLACE_LABEL[x.s.place]}) ${seen ? `HAS SENT NOTHING SINCE ${stamp(x.at)}` : 'HAS NEVER SENT A READING'}. CHECK ITS BATTERY, WI-FI OR GATEWAY.` })
    }
  }
  for (const c of latestAc(i.ac)) {
    if (c.state !== 'fault') continue
    const key = `acfault:${c.id}`
    out.push({ key, kind: 'AC FAULT', over: 0, place: AC_UNITS.find((u) => u.id === c.unit)?.place ?? null, measure: null, since: Date.parse(c.logged_at), acked: acked(key), text: `${AC_LABEL[c.unit] ?? c.unit} FAULT${c.fault_code ? ` ${c.fault_code}` : ''} SINCE ${stamp(Date.parse(c.logged_at))}.` })
  }
  // Worst first: power, all silent, then readings out of band by how far out, then AC faults and single silent sensors.
  const rank: Record<AlarmKind, number> = { POWER: 0, 'ALL SILENT': 1, HIGH: 2, LOW: 2, 'AC FAULT': 3, SILENT: 4 }
  return out.sort((a, b) => Number(a.acked) - Number(b.acked) || rank[a.kind] - rank[b.kind] || b.over - a.over || a.since - b.since)
}

/** The newest check of each unit. */
export function latestAc(ac: AcCheck[]): AcCheck[] {
  const by = new Map<string, AcCheck>()
  for (const c of ac) {
    const have = by.get(c.unit)
    if (!have || c.logged_at > have.logged_at || (c.logged_at === have.logged_at && c.id > have.id)) by.set(c.unit, c)
  }
  return AC_UNITS.flatMap((u) => (by.has(u.id) ? [by.get(u.id)!] : []))
}

/** Text for a phone message (WhatsApp or Telegram). */
export function alarmMessage(list: Alarm[], now: number): string {
  const live = list.filter((a) => !a.acked)
  if (!live.length) return `MY/CO/L CLIMATE ${stamp(now)}: ALL CLEAR.`
  return [`MY/CO/L CLIMATE ALARM ${stamp(now)} (${live.length})`, ...live.slice(0, 12).map((a) => `- ${a.text}`), ...(live.length > 12 ? [`+${live.length - 12} MORE`] : [])].join('\n')
}

// ---------- history: excursions, time in band, daily figures ----------

export interface Excursion {
  side: 'low' | 'high'
  start: number
  /** First reading back inside the band; null = still out at the newest reading. */
  end: number | null
  /** Highest (high) or lowest (low) value seen. */
  peak: number
  minutes: number
  readings: number
  /** Lasted the alarm delay (or a hand reading). */
  alarmed: boolean
}

/** Every out-of-band run of one measure between `from` and `to` (ms), oldest first. */
export function excursions(s: Series | undefined, m: Measure, band: Band | null, delayMin: number, from = -Infinity, to = Infinity): Excursion[] {
  if (!s || !band) return []
  const out: Excursion[] = []
  let cur: Excursion | null = null
  let lastT = 0
  const i0 = Number.isFinite(from) ? lowerBound(s.t, from) : 0
  for (let i = i0; i < s.rows.length && s.t[i] <= to; i++) {
    const v = valueOf(s.rows[i], m)
    if (v === null) continue
    const side = sideOf(v, band)
    const t = s.t[i]
    if (cur && side !== cur.side) {
      cur.end = t
      cur.minutes = Math.round((t - cur.start) / MIN)
      cur.alarmed = cur.alarmed || cur.minutes >= delayMin
      out.push(cur)
      cur = null
    }
    if (side !== 'ok') {
      if (!cur) cur = { side, start: t, end: null, peak: v, minutes: 0, readings: 0, alarmed: false }
      cur.peak = side === 'high' ? Math.max(cur.peak, v) : Math.min(cur.peak, v)
      cur.readings++
      if (s.rows[i].source === 'hand') cur.alarmed = true
    }
    lastT = t
  }
  if (cur) {
    cur.minutes = Math.round((lastT - cur.start) / MIN)
    cur.alarmed = cur.alarmed || cur.minutes >= delayMin
    out.push(cur)
  }
  return out
}

/**
 * Share of time inside the band between from and to. Each reading stands until the next one, but never
 * for more than `holdMin` (a gap in the data counts as unknown, not as good or bad).
 */
export function timeInBand(s: Series | undefined, m: Measure, band: Band | null, from: number, to: number, holdMin = 60): { pct: number | null; knownMin: number; outMin: number } {
  if (!s || !band) return { pct: null, knownMin: 0, outMin: 0 }
  let known = 0
  let outside = 0
  let prev: { t: number; side: Side } | null = null
  const i0 = Math.max(0, lowerBound(s.t, from) - 1)
  const add = (a: { t: number; side: Side }, until: number) => {
    const st = Math.max(a.t, from)
    const en = Math.min(until, a.t + holdMin * MIN, to)
    if (en <= st) return
    known += en - st
    if (a.side !== 'ok') outside += en - st
  }
  for (let i = i0; i < s.rows.length && s.t[i] <= to; i++) {
    const v = valueOf(s.rows[i], m)
    if (v === null) continue
    const cur = { t: s.t[i], side: sideOf(v, band) }
    if (prev) add(prev, cur.t)
    prev = cur
  }
  if (prev) add(prev, to)
  const knownMin = Math.round(known / MIN)
  return { pct: known ? Math.round(((known - outside) / known) * 1000) / 10 : null, knownMin, outMin: Math.round(outside / MIN) }
}

export interface DayStat {
  day: string
  n: number
  min: number
  max: number
  avg: number
}
/** Min, max and average per farm day, newest first, for the last `days` farm days up to `now`. */
export function dailyStats(s: Series | undefined, m: Measure, now: number, days = 14): DayStat[] {
  if (!s) return []
  const today = farmDay(now)
  const firstDay = farmDay(now - (days - 1) * 24 * HOUR)
  const from = fromFarm(firstDay, '00:00') as number
  const by = new Map<string, { n: number; min: number; max: number; sum: number }>()
  for (let i = lowerBound(s.t, from); i < s.rows.length; i++) {
    const v = valueOf(s.rows[i], m)
    if (v === null) continue
    const d = farmDay(s.t[i])
    if (d > today) break
    const a = by.get(d) ?? { n: 0, min: Infinity, max: -Infinity, sum: 0 }
    a.n++
    a.min = Math.min(a.min, v)
    a.max = Math.max(a.max, v)
    a.sum += v
    by.set(d, a)
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, a]) => ({ day, n: a.n, min: a.min, max: a.max, avg: Math.round((a.sum / a.n) * 100) / 100 }))
}

export interface Bucket {
  t0: number
  t1: number
  n: number
  min: number
  max: number
  avg: number
}
/** Readings between from and to cut into n equal time slices, for drawing. Empty slices are left out. */
export function buckets(s: Series | undefined, m: Measure, from: number, to: number, n: number): Bucket[] {
  if (!s || to <= from || n < 1) return []
  const w = (to - from) / n
  const acc: { n: number; min: number; max: number; sum: number }[] = []
  for (let i = lowerBound(s.t, from); i < s.rows.length && s.t[i] <= to; i++) {
    const v = valueOf(s.rows[i], m)
    if (v === null) continue
    const k = Math.min(n - 1, Math.floor((s.t[i] - from) / w))
    const a = acc[k] ?? (acc[k] = { n: 0, min: Infinity, max: -Infinity, sum: 0 })
    a.n++
    a.min = Math.min(a.min, v)
    a.max = Math.max(a.max, v)
    a.sum += v
  }
  const out: Bucket[] = []
  acc.forEach((a, k) => {
    if (a) out.push({ t0: from + k * w, t1: from + (k + 1) * w, n: a.n, min: a.min, max: a.max, avg: a.sum / a.n })
  })
  return out
}

// ---------- Govee CSV import ----------

export interface CsvRow {
  ms: number
  temp_c: number | null
  rh: number | null
  co2_ppm: number | null
}
export interface CsvParse {
  rows: CsvRow[]
  errors: { line: number; text: string }[]
  /** Unit the temperature column was in. */
  unit: 'C' | 'F' | null
  /** Columns found, in words. */
  found: string[]
  /** How the dates were read. */
  dates: 'ISO' | 'MONTH FIRST' | 'DAY FIRST' | 'NUMBER' | null
}

function splitCsv(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === delim) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Text of a date and time on the farm's clock -> ms, or null. dayFirst decides 03/04/2026. */
export function parseStamp(s: string, dayFirst: boolean | null): { ms: number; how: CsvParse['dates'] } | null {
  const t = s.trim().replace(/\s+/g, ' ')
  if (/^\d{9,13}$/.test(t)) {
    const n = Number(t)
    const ms = t.length >= 12 ? n : n * 1000
    return ms >= EARLIEST ? { ms, how: 'NUMBER' } : null
  }
  const time = (h: string, mi: string, se: string | undefined, ap: string | undefined) => {
    let hh = Number(h)
    if (ap) {
      const pm = /p/i.test(ap)
      if (hh < 1 || hh > 12) return null
      hh = (hh % 12) + (pm ? 12 : 0)
    }
    if (hh > 23 || Number(mi) > 59 || Number(se ?? 0) > 59) return null
    return { hm: `${pad(hh)}:${pad(Number(mi))}`, sec: Number(se ?? 0) }
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?: ?([AaPp]\.?[Mm]\.?))?$/.exec(t)
  if (m) {
    const tm = time(m[4], m[5], m[6], m[7])
    if (!tm) return null
    const ms = fromFarm(`${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, tm.hm)
    return ms === null ? null : { ms: ms + tm.sec * 1000, how: 'ISO' }
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AaPp]\.?[Mm]\.?))?$/.exec(t)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const df = dayFirst ?? (a > 12 ? true : b > 12 ? false : false)
    const day = df ? a : b
    const mon = df ? b : a
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const tm = time(m[4], m[5], m[6], m[7])
    if (!tm) return null
    const ms = fromFarm(`${yr}-${pad(mon)}-${pad(day)}`, tm.hm)
    return ms === null ? null : { ms: ms + tm.sec * 1000, how: df ? 'DAY FIRST' : 'MONTH FIRST' }
  }
  return null
}

const toNum = (s: string, commaDecimal: boolean): number | null => {
  let t = s.replace(/[%°\s]|ppm|[CF]$/gi, '')
  if (commaDecimal) t = t.replace(',', '.')
  if (!t) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : Number.NaN
}

/**
 * Read a CSV file as the Govee Home app exports it (time, temperature, humidity; some models add CO2).
 * Tolerant of other loggers: finds the columns by their headings, in English or Spanish.
 * Times are taken as the FARM clock. Temperatures in Fahrenheit are turned into Celsius.
 * dayFirst: null = work it out (a first number over 12 means day first; otherwise month first, as the Govee app writes).
 */
export function parseSensorCsv(text: string, opts: { dayFirst?: boolean | null; unit?: 'C' | 'F' | null } = {}): CsvParse {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const res: CsvParse = { rows: [], errors: [], unit: null, found: [], dates: null }
  const hi = lines.findIndex((l) => l.trim())
  if (hi < 0) {
    res.errors.push({ line: 0, text: 'THE FILE IS EMPTY.' })
    return res
  }
  const head = lines[hi]
  const counts = [',', ';', '\t'].map((d) => ({ d, n: head.split(d).length }))
  const delim = counts.sort((a, b) => b.n - a.n)[0].d
  const cols = splitCsv(head, delim).map((c) => c.toLowerCase())
  const find = (re: RegExp) => cols.findIndex((c) => re.test(c))
  const ti = find(/time|date|fecha|hora|timestamp/)
  const tc = find(/temp/)
  const hc = find(/humid|^rh|\brh\b|humedad/)
  const cc = find(/co2|co₂|carbon/)
  if (ti < 0) {
    res.errors.push({ line: hi + 1, text: 'NO TIME COLUMN FOUND. THE FIRST LINE SHOULD NAME THE COLUMNS (TIME, TEMPERATURE, HUMIDITY).' })
    return res
  }
  if (tc < 0 && hc < 0 && cc < 0) {
    res.errors.push({ line: hi + 1, text: 'NO TEMPERATURE, HUMIDITY OR CO2 COLUMN FOUND.' })
    return res
  }
  res.found = [tc >= 0 ? 'TEMPERATURE' : '', hc >= 0 ? 'HUMIDITY' : '', cc >= 0 ? 'CO2' : ''].filter(Boolean)
  let unit: 'C' | 'F' | null = opts.unit ?? null
  if (!unit && tc >= 0) {
    const h = cols[tc]
    if (/fahrenheit|°f|℉|\(f\)|_f\b|\bf\)?$/.test(h)) unit = 'F'
    else if (/celsius|°c|℃|\(c\)|_c\b|\bc\)?$/.test(h)) unit = 'C'
  }
  const comma = delim !== ','
  // Work out day order from the whole file first (one date like 25/10 settles it).
  let dayFirst: boolean | null = opts.dayFirst ?? null
  if (dayFirst === null) {
    for (let i = hi + 1; i < lines.length && dayFirst === null; i++) {
      const c = splitCsv(lines[i], delim)[ti]
      const m = c ? /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(c.trim()) : null
      if (m && +m[1] > 12) dayFirst = true
      else if (m && +m[2] > 12) dayFirst = false
    }
    // A Spanish phone writes the day first (05/11/2026 = 5 November).
    if (dayFirst === null && /fecha|hora|temperatura|humedad/.test(cols.join(' '))) dayFirst = true
  }
  const raw: { ms: number; t: number | null; h: number | null; c: number | null; line: number }[] = []
  for (let i = hi + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    const c = splitCsv(l, delim)
    const st = parseStamp(c[ti] ?? '', dayFirst)
    if (!st) {
      if (res.errors.length < 50) res.errors.push({ line: i + 1, text: `TIME NOT READABLE: "${(c[ti] ?? '').slice(0, 30)}"` })
      continue
    }
    res.dates = res.dates ?? st.how
    const t = tc >= 0 ? toNum(c[tc] ?? '', comma) : null
    const h = hc >= 0 ? toNum(c[hc] ?? '', comma) : null
    const k = cc >= 0 ? toNum(c[cc] ?? '', comma) : null
    if ([t, h, k].some((v) => v !== null && Number.isNaN(v))) {
      if (res.errors.length < 50) res.errors.push({ line: i + 1, text: 'A NUMBER IS NOT READABLE.' })
      continue
    }
    if (t === null && h === null && k === null) continue
    raw.push({ ms: st.ms, t, h, c: k, line: i + 1 })
  }
  if (!unit && tc >= 0) {
    const ts = raw.map((r) => r.t).filter((v): v is number => v !== null).sort((a, b) => a - b)
    unit = ts.length && ts[Math.floor(ts.length / 2)] > 45 ? 'F' : 'C'
  }
  res.unit = tc >= 0 ? unit : null
  for (const r of raw) {
    const tC = r.t === null ? null : unit === 'F' ? fToC(r.t) : Math.round(r.t * 100) / 100
    const row: CsvRow = { ms: r.ms, temp_c: tC, rh: r.h, co2_ppm: r.c === null ? null : Math.round(r.c) }
    const bad = (tC !== null && (tC < -20 || tC > 60)) || (r.h !== null && (r.h < 0 || r.h > 100)) || (r.c !== null && (r.c < 0 || r.c > 20000))
    if (bad) {
      if (res.errors.length < 50) res.errors.push({ line: r.line, text: 'A VALUE IS OUTSIDE WHAT A SENSOR CAN READ.' })
      continue
    }
    res.rows.push(row)
  }
  res.rows.sort((a, b) => a.ms - b.ms)
  return res
}

export const fToC = (f: number) => Math.round(((f - 32) * 5 / 9) * 100) / 100
export const cToF = (c: number) => Math.round((c * 9 / 5 + 32) * 100) / 100

export interface ImportPlan {
  add: CsvRow[]
  /** Same sensor (or same place, for readings with no sensor) and same minute as a saved reading or an earlier line. */
  dup: number
  from: number | null
  to: number | null
}
/** Which parsed rows are new. A reading in the same minute from the same sensor is a duplicate. */
export function planImport(rows: CsvRow[], target: { sensor_id: string | null; place: PlaceId }, idx: SeriesIndex): ImportPlan {
  const s = idx.get(target.place)
  const seen = new Set<number>()
  if (s) for (let i = 0; i < s.rows.length; i++) if ((s.rows[i].sensor_id ?? null) === target.sensor_id) seen.add(Math.floor(s.t[i] / MIN))
  const add: CsvRow[] = []
  let dup = 0
  for (const r of rows) {
    const k = Math.floor(r.ms / MIN)
    if (seen.has(k)) {
      dup++
      continue
    }
    seen.add(k)
    add.push(r)
  }
  return { add, dup, from: add.length ? add[0].ms : null, to: add.length ? add[add.length - 1].ms : null }
}

/** All readings as one CSV (for a backup or a spreadsheet). Farm clock. */
export function readingsCsv(readings: Reading[], sensors: Sensor[]): string {
  const name = new Map(sensors.map((s) => [s.id, s.name]))
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows = [...readings].sort((a, b) => a.taken_at.localeCompare(b.taken_at))
  const lines = ['farm_day,farm_time,utc,place,sensor,temp_c,rh,co2_ppm,source,note']
  for (const r of rows) {
    const t = Date.parse(r.taken_at)
    lines.push([farmDay(t), farmTime(t), r.taken_at, r.place, q(r.sensor_id ? name.get(r.sensor_id) ?? r.sensor_id : ''), r.temp_c ?? '', r.rh ?? '', r.co2_ppm ?? '', r.source, q(r.note ?? '')].join(','))
  }
  return lines.join('\n') + '\n'
}

// ---------- mock data ----------

export type MockFault = 'none' | 'ac-fail' | 'door' | 'silent' | 'power'
export const MOCK_FAULTS: { id: MockFault; label: string; what: string }[] = [
  { id: 'none', label: 'ALL NORMAL', what: 'STEADY ROOMS WITH A SMALL DAY-NIGHT SWING.' },
  { id: 'ac-fail', label: 'AC FAILS', what: 'THE ROOM WARMS TOWARD THE OUTSIDE AIR FROM THE FAULT TIME.' },
  { id: 'door', label: 'DOOR LEFT OPEN', what: 'A 40-MINUTE WARM SPIKE (FRIDGE OR COLD ROOM DOOR).' },
  { id: 'silent', label: 'SENSOR GOES SILENT', what: 'THE SENSOR STOPS SENDING AT THE FAULT TIME.' },
  { id: 'power', label: 'POWER CUT', what: 'EVERY ROOM WARMS AND CO2 BUILDS UP (FANS OFF).' },
]

function rand(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Typical values per place for the mock: temperature, day swing, RH, CO2 low/high (sawtooth from the exhaust fan). */
const MOCK_BASE: Record<PlaceId, { t: number; swing: number; rh: number | null; co2: [number, number] | null }> = {
  lab: { t: 18.5, swing: 0.3, rh: 58, co2: null },
  fridge: { t: 2.5, swing: 0.6, rh: 72, co2: null },
  packing: { t: 13, swing: 0.4, rh: 62, co2: [420, 460] },
  coldroom: { t: 2.5, swing: 0.5, rh: 80, co2: null },
  incubation: { t: 18, swing: 0.3, rh: 70, co2: [1500, 3000] },
  fruiting: { t: 16, swing: 0.4, rh: 86, co2: [600, 900] },
  boiling: { t: 29, swing: 2, rh: 75, co2: null },
  outside: { t: 25, swing: 3, rh: 88, co2: null },
}
export const MOCK_HAS_CO2 = (p: PlaceId) => MOCK_BASE[p].co2 !== null

export interface MockSpec {
  place: PlaceId
  sensorId: string | null
  from: number
  to: number
  stepMin: number
  seed: number
  fault: MockFault
  /** When the fault starts (ms). */
  faultAt: number
  co2: boolean
  rh: boolean
}
export interface MockPoint {
  sensor_id: string | null
  place: PlaceId
  taken_at: string
  temp_c: number | null
  rh: number | null
  co2_ppm: number | null
  source: 'mock'
  note: null
}
/** Realistic made-up readings (deterministic for a seed). Rows have no id yet. */
export function mockSeries(sp: MockSpec): MockPoint[] {
  const b = MOCK_BASE[sp.place]
  const r = rand(sp.seed)
  const out: MockPoint[] = []
  const step = Math.max(1, sp.stepMin) * MIN
  const start = Math.ceil(sp.from / step) * step
  const period = b.co2 ? 45 * MIN : 1
  for (let t = start; t <= sp.to; t += step) {
    const after = sp.fault !== 'none' && t >= sp.faultAt
    if (after && sp.fault === 'silent') break
    const hourOfDay = ((t / HOUR - 6) % 24 + 24) % 24 // farm clock
    const day = Math.sin(((hourOfDay - 8) / 24) * 2 * Math.PI) // peak about 14:00
    let temp = b.t + b.swing * day + (r() - 0.5) * 0.2
    let rh = b.rh === null ? null : b.rh + (r() - 0.5) * 2 - day * (sp.place === 'outside' ? 6 : 1)
    let co2 = b.co2 ? b.co2[0] + ((t % period) / period) * (b.co2[1] - b.co2[0]) + (r() - 0.5) * 20 : null
    const minIn = (t - sp.faultAt) / MIN
    if (after && (sp.fault === 'ac-fail' || sp.fault === 'power')) {
      const k = 1 - Math.exp(-minIn / 90)
      temp += (27 - temp) * k
      if (rh !== null) rh += (88 - rh) * k * 0.6
      if (sp.fault === 'power' && b.co2 && co2 !== null) co2 = Math.min(9000, b.co2[1] + minIn * (sp.place === 'incubation' ? 25 : 12))
    }
    if (after && sp.fault === 'door' && minIn <= 40) temp += 6 * Math.sin((minIn / 40) * Math.PI)
    out.push({
      sensor_id: sp.sensorId,
      place: sp.place,
      taken_at: isoOf(t),
      temp_c: Math.round(temp * 100) / 100,
      rh: rh === null || !sp.rh ? null : Math.round(Math.min(100, Math.max(0, rh)) * 10) / 10,
      co2_ppm: co2 === null || !sp.co2 ? null : Math.round(co2),
      source: 'mock',
      note: null,
    })
  }
  return out
}

// ---------- the main-menu status line ----------

export function climateLine(list: Alarm[], placesWithData: number): { label: string; value: string; warn: boolean } {
  const live = list.filter((a) => !a.acked)
  if (live.length) return { label: 'CLIMATE', value: `${live.length} ALARM${live.length === 1 ? '' : 'S'} // ${live[0].kind} ${live[0].place ? PLACE_LABEL[live[0].place] : ''}`.trim(), warn: true }
  return { label: 'CLIMATE', value: placesWithData ? `ALL IN BAND // ${placesWithData} PLACE${placesWithData === 1 ? '' : 'S'} REPORTING` : 'NO READINGS YET', warn: false }
}

export const SENSOR_GUESSES = [
  'Alarm bands. Taken from the farm\'s HVAC plan as written: culture fridge and cold rooms 1-4 C, incubation alarm at 21 C air, fruiting alarm at 19 C air, fruiting RH floor 80%. Working numbers (not in Joseph\'s files): lab 16-21 C, packing plenum 10-16 C, incubation floor 15 C, fruiting floor 13 C, fruiting RH ceiling 96%, CO2 ceilings packing 600, incubation 4,000, fruiting 1,200 ppm (the exhaust fans should hold 450, 3,000 and 900). Change them on SET POINTS.',
  'Alarm delay: a place must stay outside its band for 15 minutes (fridge and cold rooms 30, incubation 20) before it alarms, so a door opening does not ring. A reading typed by hand alarms at once: it is a spot check.',
  'Readings older than 12 hours are shown with their age but do not raise an alarm. An automatic sensor that sends nothing for 30 minutes is SILENT. If every automatic sensor goes silent at once, the alarm says power or internet may be down.',
  'The Govee cloud reports temperature in Fahrenheit (its own sample reads 79.52 next to 61.2% RH). The app turns it into Celsius. If the first real readings look wrong, switch the unit on FEEDS.',
  'Govee CSV dates: 03/04/2026 is read month first (as the Govee app writes), unless the file shows a day over 12 first. Times are taken as the farm clock.',
  'Air conditioner checks are by hand until a Lennox feed is found (see FEEDS). Which Lennox app the mini-splits use is not known yet: Joseph to read the model number on the indoor units.',
  'Places: LAB, CULTURE FRIDGE, PACKING (the fruiting supply plenum), COLD ROOMS, INCUBATION, FRUITING, BOILING ROOM, OUTSIDE. One place can have several sensors.',
  'Readings are not in the JSON backup file (they grow without limit). Use EXPORT READINGS CSV on GRAPHS for a copy.',
]
