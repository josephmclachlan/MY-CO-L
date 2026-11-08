// Load arithmetic and operating rules for VITALS and DECK PLAN.
// Same maths as Joseph's planner (project_data.py legs() and feeder_drop_V()):
//   240 V circuit: W/240 added to both legs.  120 V circuit: W/120 on its own leg.
//   worst leg = max(L1, L2).  Utility % = worst / 125 A.  Generator % = total W / generator running W.
//   Feeder drop V = 2 x 21.2 x worst A x (115 m x 3.28084 ft/m) / 167,800 cmil.

import {
  AC_IDS,
  allCircuits,
  CEILING_A,
  COMPRESSORS,
  EMERG,
  GENERATOR,
  HEATER_IDS,
  ICE_PEAKS,
  MEGACHEFS,
  NEAR_LIMIT,
  OUTLET_ROOM,
  SERVICE,
  TIMEZONE,
  type Circuit,
  type Fuel,
  type HeaterOption,
  type RoomId,
  type Source,
} from '../data/power'

export interface PowerConfig {
  heater: HeaterOption
  source: Source
  fuel: Fuel
  /** Generator running watts in use (slider or preset). */
  genW: number
  /** Watt overrides for estimated items, by item id. */
  overrides: Record<string, number>
}

export type Level = 'ok' | 'near' | 'over'

export interface Reading {
  l1: number
  l2: number
  worst: number
  watts: number
  /** Share of the active limit (amps vs 125 A on utility, watts vs generator on generator). */
  share: number
  level: Level
  status: string
  dropV: number
  dropPct: number
  voltsAtPanel: number
  /** Sub-panel feed amps per leg (S-circuits only), against the 60 A sub-feed. */
  subL1: number
  subL2: number
  /** Live watts by room. */
  rooms: Record<RoomId, number>
}

const ROOM_IDS: RoomId[] = ['lab', 'packing', 'incubation', 'fruiting', 'boiling', 'outside']

export function itemWatts(id: string, w: number, overrides: Record<string, number>): number {
  const o = overrides[id]
  return typeof o === 'number' && Number.isFinite(o) && o >= 0 ? o : w
}

export function circuitWatts(c: Circuit, overrides: Record<string, number> = {}): number {
  // Rounded to the milliwatt so 3.3 + 3.3 + 3.4 W sums to exactly 10 W.
  return Math.round(c.items.reduce((n, i) => n + itemWatts(i.id, i.w, overrides), 0) * 1000) / 1000
}

export function feederDropV(amps: number): number {
  return (2 * SERVICE.kAluminum * amps * (SERVICE.feederLengthM * 3.28084)) / SERVICE.feederCmil
}

export function utilityStatus(worst: number): { level: Level; status: string } {
  if (worst > SERVICE.feederAmpacity75C) return { level: 'over', status: 'Over cable rating' }
  if (worst > CEILING_A) return { level: 'over', status: 'Over 125 A meter' }
  if (worst > NEAR_LIMIT * CEILING_A) return { level: 'near', status: 'Near ceiling' }
  return { level: 'ok', status: 'OK' }
}

export function generatorStatus(pct: number): { level: Level; status: string } {
  if (pct > 100) return { level: 'over', status: 'Overload' }
  if (pct > NEAR_LIMIT * 100) return { level: 'near', status: 'No surge headroom' }
  return { level: 'ok', status: 'OK' }
}

/** Amps per leg and watts for the breakers that are on. */
export function legs(on: Set<string>, heater: HeaterOption, overrides: Record<string, number> = {}) {
  let l1 = 0
  let l2 = 0
  let watts = 0
  let subL1 = 0
  let subL2 = 0
  const rooms = Object.fromEntries(ROOM_IDS.map((r) => [r, 0])) as Record<RoomId, number>
  for (const c of allCircuits(heater)) {
    if (!on.has(c.id)) continue
    const w = circuitWatts(c, overrides)
    watts += w
    let a1 = 0
    let a2 = 0
    if (c.leg === 'B') a1 = a2 = w / 240
    else if (c.leg === 'L1') a1 = w / 120
    else a2 = w / 120
    l1 += a1
    l2 += a2
    if (c.panel === 'sub') {
      subL1 += a1
      subL2 += a2
    }
    for (const i of c.items) rooms[i.room] += itemWatts(i.id, i.w, overrides)
  }
  return { l1, l2, watts, subL1, subL2, rooms }
}

export function compute(on: Set<string>, cfg: PowerConfig): Reading {
  const { l1, l2, watts, subL1, subL2, rooms } = legs(on, cfg.heater, cfg.overrides)
  const worst = Math.max(l1, l2)
  const dropV = feederDropV(worst)
  let share: number
  let st: { level: Level; status: string }
  if (cfg.source === 'utility') {
    share = worst / CEILING_A
    st = utilityStatus(worst)
  } else {
    share = cfg.genW > 0 ? watts / cfg.genW : Infinity
    st = generatorStatus(share * 100)
  }
  return {
    l1,
    l2,
    worst,
    watts,
    share,
    level: st.level,
    status: st.status,
    dropV,
    dropPct: (dropV / SERVICE.nominalV) * 100,
    voltsAtPanel: SERVICE.nominalV - dropV,
    subL1,
    subL2,
    rooms,
  }
}

// ---------------------------------------------------------------- ICE clock

/** Minutes since midnight, Costa Rica time (UTC-6 all year). */
export function crMinutes(d: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
    const h = Number(parts.find((p) => p.type === 'hour')?.value)
    const m = Number(parts.find((p) => p.type === 'minute')?.value)
    if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m
  } catch {
    // Old browsers without time zone data fall through to a fixed offset.
  }
  return (((d.getUTCHours() - 6 + 24) % 24) * 60 + d.getUTCMinutes()) % 1440
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
export const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** A wait in minutes as "3 H 25 M". */
export const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} H ${String(m % 60).padStart(2, '0')} M` : `${m} M`)

export interface PeakState {
  now: number
  inPeak: boolean
  window: { from: string; to: string } | null
  /** Minutes until the current window ends, or until the next one starts. */
  minutes: number
}

export function peakState(d: Date): PeakState {
  const now = crMinutes(d)
  for (const w of ICE_PEAKS) {
    if (now >= toMin(w.from) && now < toMin(w.to)) return { now, inPeak: true, window: w, minutes: toMin(w.to) - now }
  }
  const next = ICE_PEAKS.map((w) => ({ w, s: toMin(w.from) })).map(({ w, s }) => ({ w, wait: (s - now + 1440) % 1440 }))
  next.sort((a, b) => a.wait - b.wait)
  return { now, inPeak: false, window: next[0].w, minutes: next[0].wait }
}

// ---------------------------------------------------------------- rules

export interface Warning {
  id: string
  level: 'warn' | 'note'
  text: string
  rooms: RoomId[]
}

const any = (on: Set<string>, ids: string[]) => ids.some((i) => on.has(i))
const roomsOf = (heater: HeaterOption, ids: string[]): RoomId[] => {
  const set = new Set<RoomId>()
  for (const c of allCircuits(heater)) if (ids.includes(c.id)) for (const i of c.items) set.add(i.room)
  for (const id of ids) if (OUTLET_ROOM[id]) set.add(OUTLET_ROOM[id])
  return [...set]
}

/** Operating rules from section 8 of the electrical brief, checked against the live breakers. */
export function warnings(on: Set<string>, cfg: PowerConfig, r: Reading, peak: PeakState): Warning[] {
  const out: Warning[] = []
  const heat = any(on, HEATER_IDS)
  const mega = any(on, MEGACHEFS)
  const x75 = on.has('x75')
  const ac = any(on, AC_IDS)
  const gen = cfg.source === 'generator'
  const heatOn = HEATER_IDS.filter((i) => on.has(i))
  const megaOn = MEGACHEFS.filter((i) => on.has(i))

  // Rule 1: one heat load at a time.
  if ([heat, mega, x75].filter(Boolean).length >= 2) {
    const names = [heat && 'STEAM HEATER', mega && 'MEGACHEFS', x75 && '75X'].filter(Boolean).join(' + ')
    out.push({
      id: 'heatlock',
      level: 'warn',
      text: `HEAT LOCKOUT: ${names} ON TOGETHER. RUN ONE HEAT LOAD AT A TIME.`,
      rooms: roomsOf(cfg.heater, [...heatOn, ...megaOn, ...(x75 ? ['x75'] : [])]),
    })
  }
  // Rule 2: MegaChefs run as one batch.
  if (megaOn.length > 0 && megaOn.length < 4) {
    out.push({ id: 'megabatch', level: 'note', text: `MEGACHEFS RUN AS ONE BATCH OF 4. ${megaOn.length} OF 4 ON.`, rooms: [] })
  }

  if (!gen) {
    if (r.level === 'over') {
      out.push({ id: 'over', level: 'warn', text: `${r.status.toUpperCase()}: WORST LEG ${r.worst.toFixed(1)} A ON A ${CEILING_A} A CEILING.`, rooms: [] })
    } else if (r.level === 'near') {
      out.push({ id: 'near', level: 'warn', text: `NEAR CEILING: WORST LEG ${r.worst.toFixed(1)} A IS ABOVE ${Math.round(NEAR_LIMIT * 100)}% OF ${CEILING_A} A.`, rooms: [] })
    }
    if (r.dropPct > 3) {
      out.push({ id: 'drop', level: 'note', text: `FEEDER DROP ${r.dropPct.toFixed(1)}% IS ABOVE THE 3% GUIDE. FAR 120 V OUTLETS LOSE MARGIN.`, rooms: [] })
    }
    // Rule 7: keep heavy loads out of ICE peak windows.
    if (peak.inPeak && (heat || mega)) {
      const what = [heat && 'STEAM HEATER', mega && 'MEGACHEFS'].filter(Boolean).join(' + ')
      out.push({
        id: 'peak',
        level: 'warn',
        text: `ICE PEAK ${peak.window!.from}-${peak.window!.to}: ${what} ON. MOVE HEAVY LOADS OUTSIDE PEAK TO HOLD DEMAND DOWN.`,
        rooms: roomsOf(cfg.heater, [...heatOn, ...megaOn]),
      })
    }
  } else {
    const pct = r.share * 100
    if (r.level === 'over') {
      out.push({ id: 'genover', level: 'warn', text: `GENERATOR OVERLOAD: ${Math.round(r.watts).toLocaleString('en-US')} W ON ${cfg.genW.toLocaleString('en-US')} W (${Math.round(pct)}%).`, rooms: [] })
    } else if (r.level === 'near') {
      out.push({ id: 'gennear', level: 'warn', text: `NO SURGE HEADROOM: GENERATOR AT ${Math.round(pct)}%. COMPRESSOR STARTS MAY STALL IT.`, rooms: [] })
    }
    // Rule 6: never heater + AC on the generator.
    if (heat && ac) {
      out.push({ id: 'genheatac', level: 'warn', text: 'NEVER RUN THE STEAM HEATER AND AIR CONDITIONING TOGETHER ON THE GENERATOR.', rooms: roomsOf(cfg.heater, [...heatOn, ...AC_IDS.filter((i) => on.has(i))]) })
    }
    if (cfg.heater === '2x4500' && on.has('c12') && on.has('c12b')) {
      out.push({ id: 'genboth', level: 'warn', text: 'SHED HEATER ELEMENT 2 ON THE GENERATOR. ONE ELEMENT ONLY.', rooms: ['boiling'] })
    }
    // Rule 5: stagger compressor starts.
    if (COMPRESSORS.filter((i) => on.has(i)).length >= 2) {
      out.push({ id: 'stagger', level: 'note', text: 'STAGGER COMPRESSOR STARTS: EMERGENCY LOADS FIRST, THEN ONE 240 V LOAD AT A TIME. FRIDGES 5-10 S APART.', rooms: [] })
    }
    const missing = EMERG.filter((i) => !on.has(i))
    if (missing.length && on.size > 0) {
      out.push({ id: 'emerg', level: 'note', text: `EMERGENCY LIST NOT ALL ON: BREAKER ${missing.map((m) => allCircuits(cfg.heater).find((c) => c.id === m)?.tag ?? m.toUpperCase()).join(', ')} OFF.`, rooms: [] })
    }
  }

  // Leg balance: 120 V loads on one leg only. Flag a gap of 20 A or more.
  const gap = Math.abs(r.l1 - r.l2)
  if (gap >= IMBALANCE_A) {
    const heavy = r.l1 > r.l2 ? 'L1' : 'L2'
    out.push({ id: 'imbalance', level: 'note', text: `LEGS UNEVEN BY ${gap.toFixed(1)} A (${heavy} HEAVY). MOVE A 120 V LOAD TO THE OTHER LEG IF THIS IS A NORMAL RUN.`, rooms: [] })
  }

  // Sub-panel feed (60 A 2-pole), only if a separate sub-panel is kept.
  const sub = Math.max(r.subL1, r.subL2)
  if (sub > SERVICE.subFeedA) {
    out.push({ id: 'subfeed', level: 'warn', text: `SUB-PANEL FEED OVER ${SERVICE.subFeedA} A: ${sub.toFixed(1)} A ON ONE LEG.`, rooms: [] })
  }
  return out
}

/** A leg gap at or above this many amps is flagged. */
export const IMBALANCE_A = 20

/** Generator share against the owned unit on both fuels, as the package CSV prints it. */
export function ownedGeneratorShare(watts: number): { propane: number; gasoline: number } {
  return { propane: (watts / GENERATOR.running.propane) * 100, gasoline: (watts / GENERATOR.running.gasoline) * 100 }
}
