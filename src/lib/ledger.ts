// LEDGER maths: what a block and a kilo cost, by species and knock week.
// Pure functions, covered by ledger.test.ts. Screens only draw what this returns.
//
// A lot's cost has five parts, each tagged ACTUAL (from logged data), ESTIMATE (from the plan) or NONE:
//   CONSUMABLES   CARGO use moves in the knock week at the item's last price, else the run plan at last price
//   COOK ENERGY   PROPULSION runs in the knock week (linked lots first), else the week's planned cooks
//   ROOM ENERGY   the month's ICE bill less its cook runs, shared by bag-days in the rooms
//   LABOUR        hours from labour_entries x the hourly rate (switch and rate in LEDGER)
//   WEAR          optional ₡ per block

import { BILL_ESTIMATE_MID, ICE, LB_KG, WEEK_BAGS, YIELD_LB, roomDays } from '../data/ledger'
import { averageSplit, weekSplit } from '../data/cropplan'
import { ICE_RATE_CRC } from '../data/cook'
import { plannedPeaks, segKwh, type CookRun } from './cook'
import { runLines } from './stockplan'
import type { Item, Move, Price } from './cargo'
import type { Row } from './store'
import type { LotLoss } from './hazard'

export interface Harvest extends Row {
  block_lot_id: string
  harvested_on: string
  flush: number
  kg: number
  grade: string | null
  initials: string | null
  notes: string | null
}

export interface EnergyBill extends Row {
  month: string // yyyy-mm-01
  kwh: number
  billed_kw: number | null
  total_crc: number
  notes: string | null
}

export interface LabourEntry extends Row {
  worked_on: string
  person: string
  hours: number
  task: string | null
  block_lot_id: string | null
  notes: string | null
}

export interface LedgerLot {
  id: string
  lot_code: string
  species_key: string
  bag_count: number
  knock_date: string
  status: string
  cook_run_id?: string | null
}

export interface LedgerPrefs {
  labourOn: boolean
  rate: number | null // ₡ per hour
  wearOn: boolean
  wearPerBlock: number | null
}
export const DEFAULT_LEDGER_PREFS: LedgerPrefs = { labourOn: true, rate: null, wearOn: false, wearPerBlock: null }

export type Basis = 'ACTUAL' | 'ESTIMATE' | 'MIXED' | 'NONE'
export interface Part {
  crc: number
  basis: Basis
  notes: string[]
}
export type PartKey = 'consumables' | 'cook' | 'room' | 'labour' | 'wear'
export const PART_KEYS: PartKey[] = ['consumables', 'cook', 'room', 'labour', 'wear']
export const PART_LABEL: Record<PartKey, string> = { consumables: 'CONSUMABLES', cook: 'COOK ENERGY', room: 'ROOM ENERGY', labour: 'LABOUR', wear: 'WEAR' }
export type Parts = Record<PartKey, Part>

export interface Cost {
  key: string // species key, lot id or 'ALL'
  label: string
  blocks: number
  alive: number
  parts: Parts
  total: number
  perBlock: number | null
  kg: number
  kgBasis: Basis
  perKg: number | null
  hours: number
}

export interface LotCost extends Cost {
  lot: LedgerLot
  partial: boolean // harvests logged but the lot is still fruiting
}

export interface WeekCost {
  week: string // Monday, yyyy-mm-dd
  lots: LotCost[]
  species: Cost[]
  all: Cost
}

export interface MonthEnergy {
  month: string // yyyy-mm
  bill: number
  billBasis: Basis
  cook: number // cook-run energy inside the bill, with taxes
  room: number // what is left for the rooms
  bagDays: number
  perBagDay: number
}

export interface LedgerInput {
  lots: LedgerLot[]
  losses: LotLoss[]
  harvests: Harvest[]
  items: Item[]
  prices: Price[]
  moves: Move[]
  cooks: CookRun[]
  bills: EnergyBill[]
  labour: LabourEntry[]
  prefs: LedgerPrefs
}

export interface Ledger {
  weeks: WeekCost[] // newest first
  species: Cost[] // all weeks together
  months: MonthEnergy[]
  unallocated: { consumables: number; cook: number; labourHours: number }
}

// ---------- dates (local calendar days, as the rest of the app) ----------

const pd = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (s: string, n: number) => {
  const d = pd(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}
/** Monday of the week a day falls in. */
export function weekOf(day: string): string {
  const d = pd(day)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}
/** Local calendar day of an ISO timestamp or a plain date. */
export const dayOf = (ts: string) => (ts.length <= 10 ? ts : iso(new Date(ts)))
const DAY = 86400000
const dayNum = (s: string) => Math.round(pd(s).getTime() / DAY)
const monthOf = (day: string) => day.slice(0, 7)
const DAYS_PER_MONTH = 365.25 / 12

// ---------- small helpers ----------

const part = (crc = 0, basis: Basis = 'NONE', notes: string[] = []): Part => ({ crc, basis, notes })
const emptyParts = (): Parts => ({ consumables: part(), cook: part(), room: part(), labour: part(), wear: part() })

export function mergeBasis(a: Basis, b: Basis): Basis {
  if (a === 'NONE') return b
  if (b === 'NONE' || a === b) return a
  return 'MIXED'
}
function addPart(into: Part, p: Part) {
  into.crc += p.crc
  into.basis = mergeBasis(into.basis, p.basis)
  for (const n of p.notes) if (!into.notes.includes(n)) into.notes.push(n)
}

/** Newest price per item. */
export function lastPrices(prices: Price[]): Map<string, number> {
  const best = new Map<string, Price>()
  for (const p of prices) {
    const b = best.get(p.item_id)
    if (!b || p.priced_on > b.priced_on || (p.priced_on === b.priced_on && (p.created_at ?? '') > (b.created_at ?? ''))) best.set(p.item_id, p)
  }
  return new Map([...best].map(([k, v]) => [k, Number(v.price_crc)]))
}

/** Cook energy of one planned week, with taxes: one steam run, one MegaChef batch, three 75X runs (two grain, one agar). */
export function planWeekCookCrc(): number {
  const t = Date.UTC(2026, 0, 5, 8) // any start: only the kWh is used
  const kwh =
    segKwh(plannedPeaks('steam_box', '2x4500', t).segs) +
    segKwh(plannedPeaks('megachef', '2x4500', t, 4).segs) +
    3 * segKwh(plannedPeaks('pressure_75x', '2x4500', t).segs)
  return kwh * ICE_RATE_CRC * ICE.tax
}

/** Bag-days in the rooms in a month of a full 130-bag farm (steady state). */
export function planBagDaysPerMonth(): number {
  return averageSplit().reduce((n, s) => n + (s.bags * roomDays(s.key)) / 7, 0) * DAYS_PER_MONTH
}

/** Room energy per bag-day for a month with no bill: the package estimate less planned cooks, over a full farm. */
export function planRoomRate(): number {
  const room = BILL_ESTIMATE_MID - planWeekCookCrc() * (DAYS_PER_MONTH / 7)
  return Math.max(0, room) / planBagDaysPerMonth()
}

/** The window a lot is in the rooms: the day before knock (substrate day) to the last pick. Day numbers, end exclusive. */
function window(l: LedgerLot): [number, number] {
  const k = dayNum(l.knock_date)
  return [k - 1, k + Math.ceil(roomDays(l.species_key))]
}
function overlap(a: [number, number], b: [number, number]) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))
}
function monthRange(ym: string): [number, number] {
  const [y, m] = ym.split('-').map(Number)
  return [Math.round(new Date(y, m - 1, 1).getTime() / DAY), Math.round(new Date(y, m, 1).getTime() / DAY)]
}

/** Split an amount over lots by a weight. */
function share<T>(amount: number, list: T[], w: (x: T) => number): Map<T, number> {
  const sum = list.reduce((n, x) => n + w(x), 0)
  return new Map(list.map((x) => [x, sum > 0 ? (amount * w(x)) / sum : 0]))
}

function finish(c: Omit<Cost, 'total' | 'perBlock' | 'perKg'>): Cost {
  const total = PART_KEYS.reduce((n, k) => n + c.parts[k].crc, 0)
  return { ...c, total, perBlock: c.blocks > 0 ? total / c.blocks : null, perKg: c.kg > 0 ? total / c.kg : null }
}

function sumCosts(key: string, label: string, list: Cost[]): Cost {
  const parts = emptyParts()
  let kgBasis: Basis = 'NONE'
  for (const c of list) {
    for (const k of PART_KEYS) addPart(parts[k], c.parts[k])
    kgBasis = mergeBasis(kgBasis, c.kgBasis)
  }
  return finish({
    key,
    label,
    blocks: list.reduce((n, c) => n + c.blocks, 0),
    alive: list.reduce((n, c) => n + c.alive, 0),
    parts,
    kg: list.reduce((n, c) => n + c.kg, 0),
    kgBasis,
    hours: list.reduce((n, c) => n + c.hours, 0),
  })
}

// ---------- the ledger ----------

export function buildLedger(inp: LedgerInput, speciesName: (key: string) => string = (k) => k.toUpperCase()): Ledger {
  const lots = inp.lots.filter((l) => l.knock_date && Number(l.bag_count) > 0)
  const byWeek = new Map<string, LedgerLot[]>()
  for (const l of lots) {
    const w = weekOf(l.knock_date)
    byWeek.set(w, [...(byWeek.get(w) ?? []), l])
  }
  const weekBags = (w: string) => (byWeek.get(w) ?? []).reduce((n, l) => n + Number(l.bag_count), 0)
  const parts = new Map<string, Parts>(lots.map((l) => [l.id, emptyParts()]))
  const hours = new Map<string, number>(lots.map((l) => [l.id, 0]))
  const lostBags = new Map<string, number>()
  for (const x of inp.losses) lostBags.set(x.block_lot_id, (lostBags.get(x.block_lot_id) ?? 0) + Number(x.bag_count))
  const alive = (l: LedgerLot) => Math.max(0, Number(l.bag_count) - (lostBags.get(l.id) ?? 0))
  const unallocated = { consumables: 0, cook: 0, labourHours: 0 }

  // ---- consumables ----
  const price = lastPrices(inp.prices)
  const codeToId = new Map(inp.items.filter((i) => i.code).map((i) => [i.code as string, i.id]))
  const useByWeek = new Map<string, { crc: number; unpriced: number; n: number }>()
  for (const m of inp.moves) {
    if (!(Number(m.qty) < 0) || m.reason === 'count') continue
    const w = weekOf(dayOf(m.moved_at))
    const u = useByWeek.get(w) ?? { crc: 0, unpriced: 0, n: 0 }
    const p = price.get(m.item_id)
    if (p === undefined) u.unpriced++
    else u.crc += -Number(m.qty) * p
    u.n++
    useByWeek.set(w, u)
  }
  for (const [w, u] of useByWeek) if (!byWeek.has(w)) unallocated.consumables += u.crc
  for (const [w, wl] of byWeek) {
    const u = useByWeek.get(w)
    let pool: Part
    if (u && u.n > 0) {
      pool = part(u.crc, 'ACTUAL', u.unpriced ? [`${u.unpriced} STOCK MOVE(S) HAVE NO PRICE IN CARGO`] : [])
    } else {
      let crc = 0
      let missing = 0
      for (const line of runLines(weekBags(w))) {
        const id = codeToId.get(line.code)
        const p = id ? price.get(id) : undefined
        if (p === undefined) missing++
        else crc += line.qty * p
      }
      pool = missing && crc === 0 ? part(0, 'NONE', ['NO PRICES IN CARGO YET']) : part(crc, 'ESTIMATE', ['NO STOCK MOVES THIS WEEK: RUN PLAN AT LAST PRICE', ...(missing ? [`${missing} PLAN ITEM(S) HAVE NO PRICE`] : [])])
    }
    for (const [l, crc] of share(pool.crc, wl, (x) => Number(x.bag_count))) addPart(parts.get(l.id)!.consumables, { ...pool, crc })
  }

  // ---- cook energy ----
  const planCook = planWeekCookCrc()
  const cookCrc = (r: CookRun) => Number(r.cost_crc ?? 0) * ICE.tax
  const cookDay = (r: CookRun) => dayOf(r.started_at ?? (r.created_at as string | undefined) ?? '')
  const looseByWeek = new Map<string, number>()
  const cookWeeks = new Set<string>()
  for (const r of inp.cooks) {
    const day = cookDay(r)
    if (!day) continue
    const w = weekOf(day)
    cookWeeks.add(w)
    const linked = lots.filter((l) => l.cook_run_id === r.id)
    if (linked.length) {
      for (const [l, crc] of share(cookCrc(r), linked, (x) => Number(x.bag_count))) addPart(parts.get(l.id)!.cook, part(crc, 'ACTUAL', r.kwh_basis === 'ESTIMATE' ? ['RUN KWH IS PROPULSION\'S ESTIMATE'] : []))
    } else looseByWeek.set(w, (looseByWeek.get(w) ?? 0) + cookCrc(r))
  }
  for (const [w, crc] of looseByWeek) if (!byWeek.has(w)) unallocated.cook += crc
  for (const [w, wl] of byWeek) {
    if (cookWeeks.has(w)) {
      const loose = looseByWeek.get(w) ?? 0
      if (loose > 0) for (const [l, crc] of share(loose, wl, (x) => Number(x.bag_count))) addPart(parts.get(l.id)!.cook, part(crc, 'ACTUAL'))
    } else {
      const pool = (planCook * weekBags(w)) / WEEK_BAGS
      for (const [l, crc] of share(pool, wl, (x) => Number(x.bag_count))) addPart(parts.get(l.id)!.cook, part(crc, 'ESTIMATE', ['NO COOK RUNS LOGGED THIS WEEK: PLANNED RUNS']))
    }
  }

  // ---- room energy ----
  const months = new Set<string>()
  for (const l of lots) {
    const [a, b] = window(l)
    for (let d = a; d < b; d += 1) months.add(monthOf(iso(new Date(d * DAY + DAY / 2))))
  }
  for (const b of inp.bills) months.add(b.month.slice(0, 7))
  const billBy = new Map(inp.bills.map((b) => [b.month.slice(0, 7), b]))
  const rate = planRoomRate()
  const monthRows: MonthEnergy[] = []
  for (const ym of [...months].sort()) {
    const mr = monthRange(ym)
    const inMonth = lots.map((l) => [l, alive(l) * overlap(window(l), mr)] as const).filter(([, bd]) => bd > 0)
    const bagDays = inMonth.reduce((n, [, bd]) => n + bd, 0)
    const bill = billBy.get(ym)
    const cook = inp.cooks.filter((r) => monthOf(cookDay(r)) === ym).reduce((n, r) => n + cookCrc(r), 0)
    if (bill) {
      const room = Math.max(0, Number(bill.total_crc) - cook)
      const per = bagDays > 0 ? room / bagDays : 0
      monthRows.push({ month: ym, bill: Number(bill.total_crc), billBasis: 'ACTUAL', cook, room, bagDays, perBagDay: per })
      for (const [l, bd] of inMonth) addPart(parts.get(l.id)!.room, part(bd * per, 'ACTUAL'))
    } else {
      monthRows.push({ month: ym, bill: BILL_ESTIMATE_MID, billBasis: 'ESTIMATE', cook, room: rate * bagDays, bagDays, perBagDay: rate })
      for (const [l, bd] of inMonth) addPart(parts.get(l.id)!.room, part(bd * rate, 'ESTIMATE', [`NO ICE BILL FOR ${ym}: PACKAGE ESTIMATE`]))
    }
  }

  // ---- labour ----
  for (const e of inp.labour) {
    const h = Number(e.hours)
    if (!(h > 0)) continue
    if (e.block_lot_id && parts.has(e.block_lot_id)) {
      hours.set(e.block_lot_id, hours.get(e.block_lot_id)! + h)
      continue
    }
    const d = dayNum(e.worked_on)
    const here = lots.filter((l) => {
      const [a, b] = window(l)
      return d >= a && d < b
    })
    if (!here.length) {
      unallocated.labourHours += h
      continue
    }
    for (const [l, hh] of share(h, here, (x) => alive(x))) hours.set(l.id, hours.get(l.id)! + hh)
  }
  const rateSet = inp.prefs.rate !== null && inp.prefs.rate > 0
  for (const l of lots) {
    const h = hours.get(l.id)!
    if (!inp.prefs.labourOn) parts.get(l.id)!.labour = part(0, 'NONE', ['LABOUR SWITCHED OFF'])
    else if (h <= 0) parts.get(l.id)!.labour = part(0, 'NONE', ['NO HOURS LOGGED'])
    else if (!rateSet) parts.get(l.id)!.labour = part(0, 'NONE', ['NO HOURLY RATE SET'])
    else parts.get(l.id)!.labour = part(h * (inp.prefs.rate as number), 'ACTUAL')
  }

  // ---- wear ----
  for (const l of lots) {
    if (inp.prefs.wearOn && inp.prefs.wearPerBlock && inp.prefs.wearPerBlock > 0) parts.get(l.id)!.wear = part(Number(l.bag_count) * inp.prefs.wearPerBlock, 'ESTIMATE', ['WEAR ₡ PER BLOCK (YOUR FIGURE)'])
    else parts.get(l.id)!.wear = part(0, 'NONE', ['WEAR SWITCHED OFF'])
  }

  // ---- kilos ----
  const kgBy = new Map<string, number>()
  for (const h of inp.harvests) kgBy.set(h.block_lot_id, (kgBy.get(h.block_lot_id) ?? 0) + Number(h.kg))
  const lotCost = (l: LedgerLot): LotCost => {
    const got = kgBy.get(l.id)
    const y = YIELD_LB[l.species_key]
    let kg = 0
    let kgBasis: Basis = 'NONE'
    if (got !== undefined) {
      kg = got
      kgBasis = 'ACTUAL'
    } else if (l.status === 'lost') {
      kgBasis = 'ACTUAL'
    } else if (y) {
      kg = alive(l) * y.lb * LB_KG
      kgBasis = 'ESTIMATE'
    }
    return {
      ...finish({ key: l.id, label: l.lot_code, blocks: Number(l.bag_count), alive: alive(l), parts: parts.get(l.id)!, kg, kgBasis, hours: hours.get(l.id)! }),
      lot: l,
      partial: got !== undefined && (l.status === 'fruiting' || l.status === 'incubating'),
    }
  }

  const weeks: WeekCost[] = [...byWeek.keys()].sort().reverse().map((w) => {
    const lc = byWeek.get(w)!.map(lotCost)
    const keys = [...new Set(lc.map((c) => c.lot.species_key))]
    const species = keys.map((k) => sumCosts(k, speciesName(k), lc.filter((c) => c.lot.species_key === k))).sort((a, b) => b.blocks - a.blocks)
    return { week: w, lots: lc, species, all: sumCosts('ALL', 'ALL SPECIES', lc) }
  })
  const allLots = weeks.flatMap((w) => w.lots)
  const keys = [...new Set(allLots.map((c) => c.lot.species_key))]
  const species = keys.map((k) => sumCosts(k, speciesName(k), allLots.filter((c) => c.lot.species_key === k))).sort((a, b) => b.blocks - a.blocks)
  return { weeks, species, months: monthRows, unallocated }
}

/** A standard 130-bag week, all estimates: what the cost should look like before any data exists. */
export function planWeek(inp: Pick<LedgerInput, 'items' | 'prices' | 'prefs'>, knock: string, speciesName?: (k: string) => string): WeekCost {
  const lots: LedgerLot[] = weekSplit(knock).map((s) => ({ id: `plan-${s.key}`, lot_code: 'PLAN', species_key: s.key, bag_count: s.bags, knock_date: knock, status: 'incubating' }))
  const l = buildLedger({ ...inp, lots, losses: [], harvests: [], moves: [], cooks: [], bills: [], labour: [] }, speciesName)
  return l.weeks[0]
}

/** Cost per kg of one species, for TRADE's margin: the latest weeks with a figure, weighted by kilos. */
export function costPerKg(ledger: Ledger, key: string, plan: WeekCost | null): { perKg: number | null; basis: Basis } {
  const c = ledger.species.find((s) => s.key === key)
  if (c && c.perKg !== null) return { perKg: c.perKg, basis: mergeBasis(c.kgBasis, PART_KEYS.reduce<Basis>((b, k) => mergeBasis(b, c.parts[k].basis), 'NONE')) }
  const p = plan?.species.find((s) => s.key === key)
  if (p && p.perKg !== null) return { perKg: p.perKg, basis: 'ESTIMATE' }
  return { perKg: null, basis: 'NONE' }
}
