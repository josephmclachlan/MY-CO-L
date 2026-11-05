// PROPULSION logic: temperature curves, hold times, pass/fail, energy and peak windows.
// Pure functions, no screen code. Rows follow the cook_runs / cook_readings tables.
//
// Readings are stored in °F (the log sheet's unit). A curve between two readings is a straight
// line, so "minutes above 200 F" is worked out exactly at the crossing point, not rounded to
// the reading interval. That matters with hand readings every 15 to 30 minutes.

import {
  CONFIRMED_HOLD_MIN,
  DEFAULT_PURPOSE,
  expectedMinutes,
  FERMENT_MAX_MIN,
  F_IDEAL,
  F_REF_C,
  F_THRESHOLDS,
  F_Z_C,
  GAP_WARN_MIN,
  isJudged,
  MEGACHEF_W,
  MEGA_COMEUP,
  MEGA_COOK,
  OVER_205_MAX_MIN,
  PSI_AVERY,
  PSI_MIN,
  SHEET_MINS,
  STEAM_HOLD_KW,
  X75_GRAIN_HOLD_MIN,
  X75_HOLD_FRACTION,
  X75_OTHER_HOLD_MIN,
  X75_W,
  type CookKind,
  type Purpose,
} from '../data/cook'
import { ICE_PEAKS, HEATER_OPTIONS, type HeaterOption } from '../data/power'
import type { Row } from './store'
import { rates } from './rates'

export const MIN = 60000
const HOUR = 3600000

export interface CookRun extends Row {
  id: string
  kind: CookKind
  purpose: Purpose | null
  unit_label: string | null
  load_desc: string | null
  bag_count: number | null
  started_at: string | null
  ended_at: string | null
  come_up_minutes: number | null
  hold_min_190f: number | null
  hold_min_198f: number | null
  hold_min_200f: number | null
  hold_min_205f: number | null
  max_temp_f: number | null
  f_value: number | null
  hold_min_psi: number | null
  heater_option: HeaterOption | null
  pots: number | null
  cook_minutes: number | null // typed by hand: MegaChef cook, or pressure hold when there is no gauge log
  kwh_metered: number | null
  heater_on_min: number | null
  kwh: number | null
  kwh_basis: 'METERED' | 'ON-TIME' | 'ESTIMATE' | null
  cost_crc: number | null
  result: 'pending' | 'pass' | 'fail'
  seq_run_ref: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface CookReading extends Row {
  id: string
  cook_run_id: string
  taken_at: string
  zone: string
  temp_f: number | null
  psi: number | null
  created_at?: string
}

// ---------- units ----------
export const cToF = (c: number) => (c * 9) / 5 + 32
export const fToC = (f: number) => ((f - 32) * 5) / 9

// ---------- Costa Rica clock (UTC-6, no daylight saving) ----------
const CR_MS = 6 * HOUR

/** Date and time as written in Costa Rica: YYYY-MM-DD and HH:MM. */
export function crParts(ms: number): { date: string; time: string; minuteOfDay: number } {
  const d = new Date(ms - CR_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}
/** A Costa Rica date and time (as typed) to a timestamp. Returns NaN for junk. */
export function crToMs(date: string, time: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim())
  if (!m || !t) return NaN
  const h = Number(t[1])
  const mi = Number(t[2])
  if (h > 23 || mi > 59) return NaN
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, Number(t[3] ?? 0)) + CR_MS
}

/** Minutes as H:MM. */
export const hm = (min: number | null | undefined): string => {
  if (min === null || min === undefined || !Number.isFinite(min)) return '--'
  const m = Math.round(min)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

// ---------- curves ----------
export interface Pt {
  t: number // ms
  f: number // °F
}

/** Minutes a straight-line curve spends at or above `th`. */
export function minutesAbove(pts: Pt[], th: number): number {
  let ms = 0
  for (let i = 1; i < pts.length; i++) {
    const { t: t0, f: f0 } = pts[i - 1]
    const { t: t1, f: f1 } = pts[i]
    const dt = t1 - t0
    if (dt <= 0) continue
    const a = f0 >= th
    const b = f1 >= th
    if (a && b) ms += dt
    else if (a !== b) ms += (dt * (a ? f0 - th : f1 - th)) / Math.abs(f1 - f0)
  }
  return ms / MIN
}

/** Minutes between `lo` (inclusive) and `hi` (exclusive). `hi` of Infinity means "and above". */
export function minutesBetween(pts: Pt[], lo: number, hi: number): number {
  return Math.max(0, minutesAbove(pts, lo) - (hi === Infinity ? 0 : minutesAbove(pts, hi)))
}

/** The first time (ms) the curve reaches `th`, or null if it never does. */
export function firstReach(pts: Pt[], th: number): number | null {
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].f >= th) {
      if (i === 0) return pts[0].t
      const { t: t0, f: f0 } = pts[i - 1]
      const { t: t1, f: f1 } = pts[i]
      return f1 === f0 ? t1 : t0 + ((th - f0) / (f1 - f0)) * (t1 - t0)
    }
  }
  return null
}

/** Lethality in hours at the reference temperature: F = sum of dt x 10^((T - Tref) / z), exact for straight lines. */
export function fValue(pts: Pt[], refC = F_REF_C, zC = F_Z_C): number {
  let h = 0
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / HOUR
    if (dt <= 0) continue
    const ea = (fToC(pts[i - 1].f) - refC) / zC
    const eb = (fToC(pts[i].f) - refC) / zC
    h += Math.abs(eb - ea) < 1e-9 ? dt * 10 ** ea : (dt * (10 ** eb - 10 ** ea)) / ((eb - ea) * Math.LN10)
  }
  return h
}

export interface Gap {
  from: number
  to: number
  minutes: number
}

export interface ZoneStats {
  zone: string
  n: number
  first: number
  last: number
  maxF: number
  maxAt: number
  /** Minutes above 190 / 198 / 200 / 205 F over the whole log. */
  above: Record<190 | 198 | 200 | 205, number>
  /** Time spent in each band while heating up (up to the first time the curve reaches 200 F). */
  b140: number
  b160: number
  b180: number
  b200: number
  b205: number
  f80: number
  f115: number
  a140: number | null
  /** Minutes from the run start to first reaching 160 / 180 / 200 F. */
  t160: number | null
  t180: number | null
  t200: number | null
  r140: number | null
  r180: number | null
  r200: number | null
  f: number
  gaps: Gap[]
  judged: boolean
}

export function toPts(rs: CookReading[]): Pt[] {
  return rs
    .filter((r) => r.temp_f !== null && Number.isFinite(r.temp_f))
    .map((r) => ({ t: Date.parse(r.taken_at), f: r.temp_f as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
}

export const zoneNames = (rs: CookReading[]): string[] => {
  const seen: string[] = []
  for (const r of rs) if (!seen.includes(r.zone)) seen.push(r.zone)
  return seen
}

/** All the sheet's numbers for one probe. `origin` is the run start (ms). */
export function analyseZone(zone: string, pts: Pt[], origin: number): ZoneStats | null {
  if (!pts.length) return null
  const since = (t: number | null) => (t === null ? null : Math.max(0, (t - origin) / MIN))
  let maxF = -Infinity
  let maxAt = pts[0].t
  for (const p of pts) {
    if (p.f > maxF) {
      maxF = p.f
      maxAt = p.t
    }
  }
  const t140 = firstReach(pts, 140)
  const t160 = firstReach(pts, 160)
  const t180 = firstReach(pts, 180)
  const t200 = firstReach(pts, 200)
  // The heating-up bands only count until the curve first reaches 200 F, so cool-down time is not mixed in.
  const heat = t200 === null ? pts : [...pts.filter((p) => p.t < t200), { t: t200, f: 200 }]
  const gaps: Gap[] = []
  for (let i = 1; i < pts.length; i++) {
    const g = (pts[i].t - pts[i - 1].t) / MIN
    if (g > GAP_WARN_MIN) gaps.push({ from: pts[i - 1].t, to: pts[i].t, minutes: g })
  }
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.max(0, (b - a) / MIN))
  return {
    zone,
    n: pts.length,
    first: pts[0].t,
    last: pts[pts.length - 1].t,
    maxF,
    maxAt,
    above: {
      190: minutesAbove(pts, 190),
      198: minutesAbove(pts, 198),
      200: minutesAbove(pts, 200),
      205: minutesAbove(pts, 205),
    },
    b140: minutesBetween(heat, 140, 160),
    b160: minutesBetween(heat, 160, 180),
    b180: minutesBetween(heat, 180, 200),
    b200: minutesBetween(pts, 200, 205),
    b205: minutesAbove(pts, 205),
    f80: minutesBetween(heat, 80, 115),
    f115: minutesBetween(heat, 115, 140),
    a140: since(t140) === null ? null : Math.max(0, ((t140 as number) - Math.max(origin, 0)) / MIN),
    t160: since(t160),
    t180: since(t180),
    t200: since(t200),
    r140: diff(t140, t180),
    r180: diff(t180, t200),
    r200: diff(t200, maxF >= 200 ? maxAt : null),
    f: fValue(pts),
    gaps,
    judged: isJudged(zone),
  }
}

// ---------- the whole run ----------
export type Status = 'pass' | 'fail' | 'warn' | 'short' | 'info' | 'none'

export interface Check {
  id: string
  label: string
  want: string
  got: string
  status: Status
  source: string
  guess?: boolean
  /** Counts toward the verdict. */
  verdict?: boolean
}

export interface RunAnalysis {
  origin: number | null
  end: number | null
  zones: ZoneStats[]
  /** The slowest judged zone, which decides the run. */
  slow: ZoneStats | null
  psi: { zone: string; atPsi: number; atAvery: number; max: number } | null
  checks: Check[]
  verdict: 'pending' | 'pass' | 'fail'
  verdictText: string
  comeUp: number | null
  gaps: Gap[]
}

const pass = (b: boolean): Status => (b ? 'pass' : 'fail')

export function psiPts(rs: CookReading[]): { t: number; f: number }[] {
  return rs
    .filter((r) => r.psi !== null && Number.isFinite(r.psi))
    .map((r) => ({ t: Date.parse(r.taken_at), f: r.psi as number }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
}

/** Everything the screen shows about a run, worked out from its readings. */
export function analyseRun(run: CookRun, readings: CookReading[], now: number = Date.now()): RunAnalysis {
  const mine = readings.filter((r) => r.cook_run_id === run.id)
  const all = [...toPts(mine), ...psiPts(mine)].map((p) => p.t)
  const startMs = run.started_at ? Date.parse(run.started_at) : NaN
  const origin = Number.isFinite(startMs) ? startMs : all.length ? Math.min(...all) : null
  const endMs = run.ended_at ? Date.parse(run.ended_at) : NaN
  const end = Number.isFinite(endMs) ? endMs : all.length ? Math.max(...all) : null

  const zones: ZoneStats[] = []
  for (const z of zoneNames(mine)) {
    const s = analyseZone(z, toPts(mine.filter((r) => r.zone === z)), origin ?? 0)
    if (s) zones.push(s)
  }
  const judged = zones.filter((z) => z.judged)
  const pool = judged.length ? judged : zones
  // The slowest core: least time above 200 F, then the lowest peak.
  const slow = pool.length ? [...pool].sort((a, b) => a.above[200] - b.above[200] || a.maxF - b.maxF)[0] : null
  const gaps = zones.flatMap((z) => z.gaps)

  // Pressure readings (a gauge zone, or a psi column on any reading).
  const pp = psiPts(mine)
  const psi = pp.length
    ? {
        zone: 'GAUGE',
        atPsi: minutesAbove(pp, PSI_MIN),
        atAvery: minutesAbove(pp, PSI_AVERY),
        max: Math.max(...pp.map((p) => p.f)),
      }
    : null

  let comeUp: number | null = run.come_up_minutes
  if (run.kind === 'steam_box' || run.kind === 'other') comeUp = slow?.t200 ?? null
  else if (run.kind === 'pressure_75x' && psi && origin !== null) {
    const t = firstReach(pp, PSI_MIN)
    comeUp = t === null ? null : Math.max(0, (t - origin) / MIN)
  }
  const checks: Check[] = []
  let verdict: RunAnalysis['verdict'] = 'pending'
  let verdictText = 'NO READINGS YET'

  const purpose = run.purpose ?? DEFAULT_PURPOSE[run.kind]

  if (run.kind === 'steam_box' || (run.kind === 'other' && slow)) {
    if (slow) {
      const h200 = slow.above[200]
      const farm = h200 >= CONFIRMED_HOLD_MIN
      const reached = slow.t200 !== null
      const running = !run.ended_at && end !== null && now - end < 3 * HOUR && !farm
      const sheetHits = SHEET_MINS.filter((s) => slow.above[s.f] >= s.min)
      const sheetOk = sheetHits.length > 0
      checks.push({
        id: 'hold-farm',
        label: 'FARM HOLD: SLOWEST CORE ABOVE 200 F',
        want: `${hm(CONFIRMED_HOLD_MIN)} H`,
        got: `${hm(h200)} ON ${slow.zone}`,
        status: farm ? 'pass' : running || (!reached && !run.ended_at) ? 'info' : 'fail',
        source: 'JOSEPH 5 NOV 2026 (CONFIRMED 4 H). SAME AS THE SHEET >200 MINIMUM.',
        verdict: true,
      })
      for (const s of SHEET_MINS) {
        const got = slow.above[s.f]
        checks.push({
          id: `sheet-${s.f}`,
          label: `SHEET: ABOVE ${s.f} F`,
          want: `${hm(s.min)} (${s.range})`,
          got: hm(got),
          status: got >= s.min ? 'pass' : 'short',
          source: `SHEET KILLING TIME COLUMN, LOW END OF ${s.range}`,
        })
      }
      checks.push({
        id: 'sheet-any',
        label: 'SHEET VERDICT: ANY ONE MINIMUM MET',
        want: 'AT LEAST ONE',
        got: sheetOk ? `MET: ABOVE ${sheetHits.map((s) => s.f).join(', ')} F` : 'NONE MET',
        status: sheetOk ? 'pass' : running || (!reached && !run.ended_at) ? 'info' : 'fail',
        source: 'SHEET GROUPS THE THREE UNDER KILLING TIME. READING THEM AS ALTERNATIVES IS MY GUESS.',
        guess: true,
        verdict: true,
      })
      checks.push({
        id: 'over-205',
        label: 'OVERPROCESSING: ABOVE 205 F',
        want: `UNDER ${hm(OVER_205_MAX_MIN)}`,
        got: hm(slow.above[205]),
        status: slow.above[205] > OVER_205_MAX_MIN ? 'warn' : 'pass',
        source: 'SHEET 205+ COLUMN, T < 3. A WARNING ONLY, NOT A FAIL (MY GUESS).',
        guess: true,
      })
      const hot = zones.filter((z) => z.judged).sort((a, b) => b.above[205] - a.above[205])[0]
      if (hot && hot.zone !== slow.zone && hot.above[205] > OVER_205_MAX_MIN)
        checks.push({
          id: 'over-205-hot',
          label: `OVERPROCESSING ON ${hot.zone}`,
          want: `UNDER ${hm(OVER_205_MAX_MIN)}`,
          got: hm(hot.above[205]),
          status: 'warn',
          source: 'SHEET 205+ COLUMN. THE HOTTEST CORE COOKS LONGEST WHILE THE SLOWEST CATCHES UP.',
        })
      checks.push({
        id: 'ferment',
        label: 'TIME IN 115-140 F ON THE WAY UP',
        want: `UNDER ${hm(FERMENT_MAX_MIN)}`,
        got: hm(slow.f115),
        status: slow.t200 === null && slow.maxF < 140 ? 'none' : slow.f115 > FERMENT_MAX_MIN ? 'warn' : 'pass',
        source: 'SHEET MICROBIAL ACTIVITY ZONE, T < 1',
      })
      const fv = slow.f
      checks.push({
        id: 'f',
        label: 'F VALUE AT 97 C / 206 F',
        want: `${F_IDEAL[0]}-${F_IDEAL[1]} H IDEAL`,
        got: `${fv.toFixed(1)} H`,
        status: fv < F_IDEAL[0] ? 'short' : fv > F_IDEAL[1] ? 'warn' : 'pass',
        source: 'SHEET: F = 97C/206F, 6-8 IDEAL. Z = 10 C IS MY GUESS. INFORMATION ONLY.',
        guess: true,
      })
      if (slow.t200 !== null && run.kind === 'steam_box' && run.heater_option !== '6500')
        checks.push({
          id: 'comeup',
          label: 'COME-UP TO 200 F ON THE SLOWEST CORE',
          want: 'ABOUT 4 H AT 9 KW',
          got: hm(slow.t200),
          status: 'info',
          source: 'FAB REV D SIZING NOTES. INFORMATION ONLY.',
        })
      const lateAir = zones.find((z) => !z.judged && /^AIR/i.test(z.zone))
      if (lateAir && lateAir.t200 !== null && slow.t200 !== null)
        checks.push({
          id: 'air-lag',
          label: 'CORE BEHIND BOX AIR',
          want: 'INFORMATION',
          got: `${hm(slow.t200 - lateAir.t200)} LATER TO 200 F`,
          status: 'info',
          source: 'FAB REV D: THE PT100 CONTROLS BOX AIR AND READS HIGHER THAN THE CORE UNTIL THE CORE CATCHES UP.',
        })
      if (zones.filter((z) => z.judged && z.t200 !== null).length > 1) {
        const ts = zones.filter((z) => z.judged && z.t200 !== null).map((z) => z.t200 as number)
        checks.push({
          id: 'spread',
          label: 'COLD SPOT: SPREAD BETWEEN CORES TO 200 F',
          want: 'INFORMATION',
          got: hm(Math.max(...ts) - Math.min(...ts)),
          status: 'info',
          source: 'SHEET THERMAL PENETRATION CURVE: COMPARE PROBES TO FIND COLD SPOTS',
        })
      }
      if (gaps.length)
        checks.push({
          id: 'gaps',
          label: 'GAPS IN THE READINGS',
          want: `NONE OVER ${GAP_WARN_MIN} MIN`,
          got: `${gaps.length} GAP${gaps.length > 1 ? 'S' : ''}, LONGEST ${hm(Math.max(...gaps.map((g) => g.minutes)))}`,
          status: 'warn',
          source: `THE CURVE IS A STRAIGHT LINE ACROSS A GAP. ${GAP_WARN_MIN} MIN IS MY GUESS.`,
          guess: true,
        })
      if (farm || sheetOk) {
        verdict = 'pass'
        verdictText = farm ? `PASS: ${hm(h200)} ABOVE 200 F ON ${slow.zone}, 4 H HOLD MET` : `PASS ON THE SHEET ONLY (ABOVE ${sheetHits.map((s) => s.f).join(', ')} F). THE 4 H HOLD ABOVE 200 F WAS NOT MET`
      } else if (!reached) {
        verdict = run.ended_at ? 'fail' : 'pending'
        verdictText = run.ended_at ? 'FAIL: ENDED BEFORE THE CORE REACHED 200 F' : 'CORE NOT AT 200 F YET'
      } else if (running) {
        verdict = 'pending'
        verdictText = `HOLDING: ${hm(h200)} OF ${hm(CONFIRMED_HOLD_MIN)} ABOVE 200 F ON ${slow.zone}`
      } else {
        verdict = 'fail'
        verdictText = `FAIL: ONLY ${hm(h200)} ABOVE 200 F ON ${slow.zone}, 4 H NEEDED`
      }
    }
  } else if (run.kind === 'pressure_75x') {
    const want = purpose === 'grain' ? X75_GRAIN_HOLD_MIN : X75_OTHER_HOLD_MIN
    const typed = run.cook_minutes
    const hold = psi ? psi.atPsi : typed
    const basis = psi ? 'FROM THE GAUGE READINGS' : typed !== null ? 'TYPED BY HAND' : null
    if (hold !== null && hold !== undefined) {
      checks.push({
        id: 'x75-hold',
        label: `HOLD AT ${PSI_MIN} PSI OR MORE (${basis})`,
        want: `${hm(want)} (${want} MIN)`,
        got: hm(hold),
        status: pass(hold >= want),
        source: purpose === 'grain' ? 'AVERY Q&A: 1 H 45 MIN AT 17 PSI. COUNTING FROM 15 PSI IS MY GUESS.' : 'NO AGAR FIGURE IN JOSEPH\'S FILES. 35 MIN USED (TEXTBOOK MINIMUM). MY GUESS.',
        guess: true,
        verdict: true,
      })
      if (psi)
        checks.push({
          id: 'x75-17',
          label: `OF WHICH AT ${PSI_AVERY} PSI OR MORE`,
          want: 'INFORMATION',
          got: `${hm(psi.atAvery)}  (PEAK ${psi.max.toFixed(0)} PSI)`,
          status: 'info',
          source: 'AVERY RUNS 17 PSI ON THE STOPCOCK MODEL',
        })
      verdict = hold >= want ? 'pass' : run.ended_at ? 'fail' : 'pending'
      verdictText = hold >= want ? `PASS: ${hm(hold)} AT PRESSURE` : run.ended_at ? `FAIL: ${hm(hold)} AT PRESSURE, ${hm(want)} NEEDED` : `HOLDING: ${hm(hold)} OF ${hm(want)}`
    }
    if (comeUp !== null && comeUp !== undefined && Number.isFinite(comeUp))
      checks.push({
        id: 'x75-up',
        label: 'HEAT-UP TO PRESSURE',
        want: 'ABOUT 1 H (ASSUMPTION)',
        got: hm(comeUp),
        status: 'info',
        source: 'AVERY WORKFLOW ASSUMPTION, NOT MEASURED. THIS RUN REPLACES IT.',
      })
  } else if (run.kind === 'megachef') {
    const up = run.come_up_minutes
    const cook = run.cook_minutes
    if (up !== null && up !== undefined)
      checks.push({
        id: 'mega-up',
        label: 'TIME TO PRESSURE',
        want: `${MEGA_COMEUP[0]}-${MEGA_COMEUP[1]} MIN`,
        got: `${up} MIN`,
        status: up >= MEGA_COMEUP[0] && up <= MEGA_COMEUP[1] ? 'pass' : 'warn',
        source: 'AVERY COOKER CLIP 1:30. A WARNING ONLY (MY GUESS).',
        guess: true,
      })
    if (cook !== null && cook !== undefined) {
      const ok = cook >= MEGA_COOK[0] && cook <= MEGA_COOK[1]
      checks.push({
        id: 'mega-cook',
        label: 'COOK TIME',
        want: `${MEGA_COOK[0]}-${MEGA_COOK[1]} MIN`,
        got: `${cook} MIN`,
        status: ok ? 'pass' : cook < MEGA_COOK[0] ? 'warn' : 'fail',
        source: 'AVERY COOKER CLIP 0:46-1:14: SLIGHTLY UNDER BEATS OVER. UNDER IS A WARNING, OVER IS A FAIL (MY GUESS).',
        guess: true,
        verdict: true,
      })
      verdict = cook > MEGA_COOK[1] ? 'fail' : 'pass'
      verdictText = ok ? `PASS: COOKED ${cook} MIN` : cook < MEGA_COOK[0] ? `PASS, BUT UNDER: ${cook} MIN (RANGE ${MEGA_COOK[0]}-${MEGA_COOK[1]})` : `FAIL: OVERCOOKED, ${cook} MIN`
    } else {
      verdictText = 'TYPE THE COOK TIME TO GET A VERDICT'
    }
  }

  return { origin, end, zones, slow, psi, checks, verdict, verdictText, comeUp: comeUp !== null && comeUp !== undefined && Number.isFinite(comeUp) ? comeUp : null, gaps }
}

// ---------- energy and peak windows ----------
export interface Seg {
  from: number // ms
  to: number
  kw: number
}

/** Full element watts for the heater option chosen in VITALS. */
export const heaterWatts = (opt: HeaterOption | null | undefined) => HEATER_OPTIONS[opt ?? '2x4500'].elements.reduce((n, e) => n + e.w, 0)

/** Power over time while the run is going, for the estimate and the peak check. */
export function powerProfile(run: CookRun, start: number, end: number, comeUpMin: number | null): Seg[] {
  if (!(end > start)) return []
  const w = heaterWatts(run.heater_option)
  if (run.kind === 'megachef') return [{ from: start, to: end, kw: ((run.pots ?? 4) * MEGACHEF_W) / 1000 }]
  const full = run.kind === 'pressure_75x' ? X75_W / 1000 : w / 1000
  const hold = run.kind === 'pressure_75x' ? full * X75_HOLD_FRACTION : STEAM_HOLD_KW
  if (run.kind === 'other') return []
  const up = comeUpMin ?? expectedMinutes(run.kind, w).comeUp
  const split = Math.min(end, start + up * MIN)
  return [
    { from: start, to: split, kw: full },
    ...(split < end ? [{ from: split, to: end, kw: hold }] : []),
  ]
}

export const segKwh = (segs: Seg[]) => segs.reduce((n, s) => n + (s.kw * (s.to - s.from)) / HOUR, 0)

/** Peak windows (CR time) that touch [from, to], as absolute timestamps. */
export function peakWindows(from: number, to: number): { from: number; to: number; label: string }[] {
  const out: { from: number; to: number; label: string }[] = []
  const day0 = Math.floor((from - CR_MS) / (24 * HOUR)) * 24 * HOUR + CR_MS // CR midnight on the start day
  for (let d = day0; d < to + 24 * HOUR; d += 24 * HOUR) {
    for (const w of ICE_PEAKS) {
      const a = d + (Number(w.from.slice(0, 2)) * 60 + Number(w.from.slice(3))) * MIN
      const b = d + (Number(w.to.slice(0, 2)) * 60 + Number(w.to.slice(3))) * MIN
      if (b > from && a < to) out.push({ from: a, to: b, label: `${w.from}-${w.to}` })
    }
  }
  return out
}

export interface PeakHit {
  label: string
  minutes: number
  kwh: number
}

/** How much of the run falls inside ICE peak windows, and the energy used there at the profile's power. */
export function peakOverlap(segs: Seg[]): PeakHit[] {
  if (!segs.length) return []
  const from = segs[0].from
  const to = segs[segs.length - 1].to
  const hits: PeakHit[] = []
  for (const w of peakWindows(from, to)) {
    let ms = 0
    let kwh = 0
    for (const s of segs) {
      const o = Math.min(s.to, w.to) - Math.max(s.from, w.from)
      if (o > 0) {
        ms += o
        kwh += (s.kw * o) / HOUR
      }
    }
    if (ms > 0) hits.push({ label: w.label, minutes: ms / MIN, kwh })
  }
  return hits
}

export interface Energy {
  kwh: number | null
  basis: 'METERED' | 'ON-TIME' | 'ESTIMATE' | null
  cost: number | null
  costTax: number | null
  profile: Seg[]
  peaks: PeakHit[]
  /** kWh of the final figure that fell inside peak windows (the estimate's share applied to it). */
  peakKwh: number
  watts: number
}

/** Energy for a run: a meter reading wins, then heater on-time x element watts, then the estimate from the power profile. */
export function energyFor(run: CookRun, an: RunAnalysis): Energy {
  const start = run.started_at ? Date.parse(run.started_at) : an.origin
  let end: number | null = run.ended_at ? Date.parse(run.ended_at) : an.end
  const typedMin = run.kind === 'megachef' && run.cook_minutes !== null ? (run.come_up_minutes ?? 0) + run.cook_minutes : null
  if ((end === null || !Number.isFinite(end) || (start !== null && end <= start)) && start !== null && typedMin !== null) end = start + typedMin * MIN
  const watts = run.kind === 'steam_box' ? heaterWatts(run.heater_option) : run.kind === 'megachef' ? (run.pots ?? 4) * MEGACHEF_W : run.kind === 'pressure_75x' ? X75_W : 0
  const profile = start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) ? powerProfile(run, start, end, an.comeUp ?? run.come_up_minutes) : []
  const est = segKwh(profile)
  let kwh: number | null = null
  let basis: Energy['basis'] = null
  if (run.kwh_metered !== null && run.kwh_metered !== undefined && run.kwh_metered >= 0) {
    kwh = run.kwh_metered
    basis = 'METERED'
  } else if (run.heater_on_min !== null && run.heater_on_min !== undefined && run.heater_on_min >= 0 && watts > 0) {
    kwh = (run.heater_on_min / 60) * (watts / 1000)
    basis = 'ON-TIME'
  } else if (est > 0) {
    kwh = est
    basis = 'ESTIMATE'
  }
  const peaks = peakOverlap(profile)
  const peakEst = peaks.reduce((n, p) => n + p.kwh, 0)
  const peakKwh = kwh !== null && est > 0 ? (kwh * peakEst) / est : 0
  const r = rates().ice
  return { kwh, basis, cost: kwh === null ? null : kwh * r.energyCrcPerKwh, costTax: kwh === null ? null : kwh * r.energyCrcPerKwh * r.tax, profile, peaks, peakKwh, watts }
}

/** The "if you start now" check, before any readings exist. */
export function plannedPeaks(kind: CookKind, heaterOpt: HeaterOption, startMs: number, pots = 4): { segs: Seg[]; hits: PeakHit[]; minutes: number } {
  const w = heaterWatts(heaterOpt)
  const ex = expectedMinutes(kind, w)
  const probe: CookRun = {
    id: 'plan',
    kind,
    purpose: null,
    unit_label: null,
    load_desc: null,
    bag_count: null,
    started_at: new Date(startMs).toISOString(),
    ended_at: null,
    come_up_minutes: null,
    hold_min_190f: null,
    hold_min_198f: null,
    hold_min_200f: null,
    hold_min_205f: null,
    max_temp_f: null,
    f_value: null,
    hold_min_psi: null,
    heater_option: heaterOpt,
    pots,
    cook_minutes: null,
    kwh_metered: null,
    heater_on_min: null,
    kwh: null,
    kwh_basis: null,
    cost_crc: null,
    result: 'pending',
    seq_run_ref: null,
    notes: null,
  }
  const total = ex.comeUp + ex.hold
  const segs = powerProfile(probe, startMs, startMs + total * MIN, ex.comeUp)
  return { segs, hits: peakOverlap(segs), minutes: total }
}

// ---------- values written back to the run row ----------
export function headline(run: CookRun, an: RunAnalysis, en: Energy): Partial<CookRun> {
  const r = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n))
  const s = an.slow
  const base: Partial<CookRun> = {
    kwh: en.kwh === null ? null : Math.round(en.kwh * 100) / 100,
    kwh_basis: en.basis,
    cost_crc: en.cost === null ? null : Math.round(en.cost),
    result: an.verdict,
  }
  if (run.kind === 'steam_box' || run.kind === 'other') {
    return {
      ...base,
      come_up_minutes: r(an.comeUp),
      hold_min_190f: s ? r(s.above[190]) : null,
      hold_min_198f: s ? r(s.above[198]) : null,
      hold_min_200f: s ? r(s.above[200]) : null,
      hold_min_205f: s ? r(s.above[205]) : null,
      max_temp_f: s ? Math.round(s.maxF * 10) / 10 : null,
      f_value: s ? Math.round(s.f * 10) / 10 : null,
    }
  }
  if (run.kind === 'pressure_75x') return { ...base, come_up_minutes: r(an.comeUp), hold_min_psi: an.psi ? r(an.psi.atPsi) : run.hold_min_psi }
  return base
}

/** Fields that changed, so a save does not rewrite the row for nothing. */
export const changed = (run: CookRun, patch: Partial<CookRun>): boolean => (Object.keys(patch) as (keyof CookRun)[]).some((k) => (run[k] ?? null) !== (patch[k] ?? null))

// ---------- one sheet row per probe, in the log sheet's layout ----------
export function sheetRow(run: CookRun, z: ZoneStats): Record<string, string> {
  const t = (m: number | null) => hm(m)
  const d = run.started_at ? crParts(Date.parse(run.started_at)).date : crParts(z.first).date
  return {
    date: d,
    vessel: run.unit_label ?? run.kind.replace('_', ' ').toUpperCase(),
    location: z.zone,
    b140: t(z.b140),
    b160: t(z.b160),
    b180: t(z.b180),
    b200: t(z.b200),
    b205: t(z.b205),
    r140: t(z.r140),
    r180: t(z.r180),
    r200: t(z.r200),
    t160: t(z.t160),
    t180: t(z.t180),
    t200: t(z.t200),
    h190: t(z.above[190]),
    h198: t(z.above[198]),
    h200: t(z.above[200]),
    h205: t(z.above[205]),
    a140: t(z.a140),
    f80: t(z.f80),
    f115: t(z.f115),
    max: `${z.maxF.toFixed(1)}F / ${fToC(z.maxF).toFixed(1)}C`,
    f: z.f.toFixed(1),
  }
}

export { F_THRESHOLDS }

// ---------- loads and later outcome ----------
export interface LoadLot {
  id: string
  cook_run_id?: string | null
  bag_count: number
  lot_code?: string
}

// ---------- logger CSV import ----------
export interface CsvChannel {
  col: number
  name: string
  unit: 'F' | 'C' | 'PSI'
  zone: string
}
export interface CsvParse {
  ok: boolean
  error?: string
  delimiter: string
  headerRow: number
  /** Column holding the clock time, or elapsed time. */
  timeCol: number
  timeKind: 'datetime' | 'elapsed-min' | 'elapsed-h' | 'elapsed-s'
  dateOrder: 'DMY' | 'MDY' | 'YMD'
  channels: CsvChannel[]
  rows: string[][]
}

const splitLine = (line: string, d: string): string[] => {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"'
        i++
      } else q = !q
    } else if (c === d && !q) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const DATE_RE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/

/** Reads a data logger export (MadgeTech, Govee, a spreadsheet saved as CSV). Finds the header row, the time column and the channels. */
export function parseLoggerCsv(text: string): CsvParse {
  const fail = (error: string): CsvParse => ({ ok: false, error, delimiter: ',', headerRow: -1, timeCol: -1, timeKind: 'datetime', dateOrder: 'DMY', channels: [], rows: [] })
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) return fail('THE FILE HAS NO ROWS.')
  const count = (l: string, d: string) => splitLine(l, d).length
  const probe = lines.slice(0, 40)
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: probe.reduce((a, l) => a + (count(l, d) > 1 ? count(l, d) : 0), 0) })).sort((a, b) => b.n - a.n)[0].d
  const cells = lines.map((l) => splitLine(l, delimiter))
  const isNum = (s: string) => s !== '' && Number.isFinite(Number(s.replace(',', '.')))
  // First data row: a time-like cell plus at least one number after it.
  const isTime = (s: string) => DATE_RE.test(s) || /^\d{1,2}:\d{2}(:\d{2})?$/.test(s)
  let firstData = -1
  for (let i = 0; i < cells.length; i++) {
    const r = cells[i]
    if ((isTime(r[0]) || isTime(r[1] ?? '') || (isNum(r[0]) && r.length > 1 && i > 0)) && r.slice(1).some(isNum) && r.length >= 2) {
      firstData = i
      break
    }
  }
  if (firstData < 1) return fail('COULD NOT FIND THE DATA ROWS. THE FIRST COLUMN SHOULD BE A DATE AND TIME, THEN ONE COLUMN PER PROBE.')
  const headerRow = firstData - 1
  const head = cells[headerRow]
  const data = cells.slice(firstData).filter((r) => r.length >= 2)
  // Time column: the first column whose first data cell looks like a time or a date.
  let timeCol = data[0].findIndex((c) => isTime(c))
  let timeKind: CsvParse['timeKind'] = 'datetime'
  if (timeCol < 0) {
    // elapsed column: a header that mentions time, minutes, hours or seconds
    timeCol = head.findIndex((h) => /elapsed|time|min|hour|\bh\b|sec/i.test(h) && isNum(data[0][head.indexOf(h)] ?? ''))
    if (timeCol < 0) return fail('NO TIME COLUMN FOUND.')
    const h = head[timeCol]
    timeKind = /sec|\(s\)/i.test(h) ? 'elapsed-s' : /hour|\(h\)|\bh\b/i.test(h) ? 'elapsed-h' : 'elapsed-min'
  }
  // Day-first or month-first: decided from the data when a part is over 12, otherwise day-first (Costa Rica).
  let dateOrder: CsvParse['dateOrder'] = 'DMY'
  if (timeKind === 'datetime') {
    let sawFirstBig = false
    let sawSecondBig = false
    let ymd = false
    for (const r of data.slice(0, 400)) {
      const m = DATE_RE.exec(r[timeCol] ?? '')
      if (!m) continue
      if (m[1].length === 4) ymd = true
      else {
        if (Number(m[1]) > 12) sawFirstBig = true
        if (Number(m[2]) > 12) sawSecondBig = true
      }
    }
    dateOrder = ymd ? 'YMD' : sawSecondBig && !sawFirstBig ? 'MDY' : 'DMY'
  }
  const channels: CsvChannel[] = []
  for (let c = 0; c < head.length; c++) {
    if (c === timeCol) continue
    if (!data.slice(0, 20).some((r) => isNum(r[c] ?? ''))) continue
    const name = head[c] || `COLUMN ${c + 1}`
    const unit: CsvChannel['unit'] = /psi/i.test(name) ? 'PSI' : /°\s*c|\(c\)|celsius|\bdeg\s*c\b|, c$/i.test(name) ? 'C' : /°\s*f|\(f\)|fahrenheit|\bdeg\s*f\b|, f$/i.test(name) ? 'F' : guessUnit(data, c)
    channels.push({ col: c, name, unit, zone: channels.length === 0 ? 'CORE' : `PROBE ${channels.length + 1}` })
  }
  if (!channels.length) return fail('NO READING COLUMNS FOUND.')
  return { ok: true, delimiter, headerRow, timeCol, timeKind, dateOrder, channels, rows: data }
}

/** No unit in the header: temperatures under 130 are taken as °C, as nothing in a steam box is under 130 F once it is hot. */
function guessUnit(data: string[][], c: number): CsvChannel['unit'] {
  const vals = data.map((r) => Number((r[c] ?? '').replace(',', '.'))).filter(Number.isFinite)
  return vals.length && Math.max(...vals) <= 130 ? 'C' : 'F'
}

/** Turn a parsed file into readings for a run. `base` is the run start in ms, used for elapsed-time files. */
export function readingsFromCsv(p: CsvParse, runId: string, base: number, make: () => string): { readings: CookReading[]; skipped: number } {
  const out: CookReading[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const r of p.rows) {
    let ms = NaN
    const raw = r[p.timeCol] ?? ''
    if (p.timeKind === 'datetime') {
      const m = DATE_RE.exec(raw)
      if (m) {
        let a = Number(m[1])
        let b = Number(m[2])
        let c = Number(m[3])
        let y: number, mo: number, d: number
        if (p.dateOrder === 'YMD' || m[1].length === 4) [y, mo, d] = [a, b, c]
        else if (p.dateOrder === 'MDY') [y, mo, d] = [c, a, b]
        else [y, mo, d] = [c, b, a]
        if (y < 100) y += 2000
        let h = Number(m[4])
        const ap = m[7]?.toLowerCase()
        if (ap === 'pm' && h < 12) h += 12
        if (ap === 'am' && h === 12) h = 0
        a = b = c = 0
        ms = Date.UTC(y, mo - 1, d, h, Number(m[5]), Number(m[6] ?? 0)) + CR_MS // logger clocks are farm time (Costa Rica)
      }
    } else {
      const v = Number(raw.replace(',', '.'))
      if (Number.isFinite(v)) ms = base + v * (p.timeKind === 'elapsed-h' ? HOUR : p.timeKind === 'elapsed-s' ? 1000 : MIN)
    }
    if (!Number.isFinite(ms)) {
      skipped++
      continue
    }
    const minute = Math.round(ms / MIN) // one reading per probe per minute is plenty for a curve
    for (const ch of p.channels) {
      const key = `${ch.zone}|${minute}`
      if (!ch.zone.trim() || seen.has(key)) continue
      const v = Number((r[ch.col] ?? '').replace(',', '.'))
      if (!(r[ch.col] ?? '').trim() || !Number.isFinite(v)) continue
      seen.add(key)
      out.push({
        id: make(),
        cook_run_id: runId,
        taken_at: new Date(minute * MIN).toISOString(),
        zone: ch.zone.trim().toUpperCase(),
        temp_f: ch.unit === 'PSI' ? null : ch.unit === 'C' ? Math.round(cToF(v) * 10) / 10 : v,
        psi: ch.unit === 'PSI' ? v : null,
      })
    }
  }
  return { readings: out, skipped }
}

export type { Purpose }
