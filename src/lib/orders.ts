// STANDING ORDERS and HARVEST FORECAST (build G5). Pure functions: no React, no store. Screens hand in rows.
//
// Rules from Joseph (6 Nov 2026): every buyer pays cash on delivery (no credit terms, so there is no terms field);
// one buyer should not be more than 30% of the week's orders (30% is unconfirmed, a setting); money is kept in
// colones and US$ is shown at the day's own rate; the spare-block buffer is kept back from what is promised.
//
// Where the forecast numbers come from (shown on screen):
//  - kg per block and days from knock to first pick: the farm's own finished lots once there are 3 or more of that
//    species (OWN), else Catawba's real picks (CATAWBA).
//  - days of picking after the first pick: LEDGER's picking days (7 for most, 21 for lion's mane), a GUESS.
//  - kg still to come = expected kg of the lot minus what was already picked, spread evenly over the pick window.

import type { Row } from './store'
import type { Channel } from '../data/ledger'
import { ROOM_DAYS, ROOM_DAYS_OTHER } from '../data/ledger'
import { addDays, daysBetween, parseDay, type BlockLot } from './xeno'
import { expectFor } from './mission'
import { weekStart, type LotRecord } from './records'

export type OrderForm = 'fresh' | 'dried'

export interface StandingOrder extends Row {
  id: string
  buyer: string
  channel: Channel
  species_key: string
  form: OrderForm
  kg: number // per week
  price_crc_per_kg: number
  day_of_week: number // 1 = Monday ... 7 = Sunday
  start_on: string
  end_on: string | null // last day the order applies (inclusive); null = still running
  confirmed: boolean
  prev_id: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

/** One week's change to one order. kg 0 = skip that week. */
export interface OrderWeek extends Row {
  id: string
  order_id: string
  week_start: string
  kg: number
  note: string | null
  created_at?: string
  updated_at?: string
}

export const weekRowId = (orderId: string, week: string) => `${orderId}:${week}`

/** Cash on delivery for every buyer, new or old (Joseph, 6 Nov 2026). */
export const PAYMENT_RULE = 'CASH ON DELIVERY, EVERY BUYER. NO CREDIT TERMS.'

export const DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
export const DAY_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
/** GUESS: deliveries default to Friday (the week's selling days are Friday and Saturday). */
export const DEFAULT_DELIVERY_DAY = 5

export const EPS = 0.0005
export const round2 = (n: number) => Math.round(n * 100) / 100
export const buyerKey = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(parseDay(s).getTime())
export const isMonday = (s: string) => isDay(s) && parseDay(s).getDay() === 1

/** The Monday of the week a day falls in. */
export const mondayOf = weekStart

// ---------- orders and their weeks ----------

export interface OrderInput {
  buyer: string
  species_key: string
  form: OrderForm
  kg: number | null
  price: number | null
  day_of_week: number
  start_on: string
}

/** What is wrong with a new order, or null. Messages are shown as they are. */
export function checkOrder(i: OrderInput): string | null {
  if (!i.buyer.trim()) return 'TYPE THE BUYER NAME.'
  if (i.buyer.trim().length > 40) return 'BUYER NAME IS TOO LONG (40 LETTERS AT MOST).'
  if (!i.species_key) return 'PICK A SPECIES.'
  if (i.kg === null || !Number.isFinite(i.kg) || i.kg <= 0) return 'TYPE THE KG PER WEEK (MORE THAN 0).'
  if (i.kg > 1000) return 'THAT IS OVER 1,000 KG A WEEK. CHECK THE NUMBER.'
  if (i.price === null || !Number.isFinite(i.price) || i.price <= 0) return 'TYPE THE ₡ PER KG (NO LIST PRICE FOR THIS PRODUCT).'
  if (i.price > 1_000_000) return 'THAT ₡ PER KG LOOKS TOO HIGH. CHECK THE NUMBER.'
  if (!Number.isInteger(i.day_of_week) || i.day_of_week < 1 || i.day_of_week > 7) return 'PICK A DELIVERY DAY.'
  if (!isDay(i.start_on)) return 'PICK THE FIRST DELIVERY WEEK.'
  return null
}

export const deliveryDay = (o: Pick<StandingOrder, 'day_of_week'>, week: string) => addDays(week, o.day_of_week - 1)

/** Does the order deliver in this week (Monday)? Judged by its delivery day, so the dates are exact. */
export function activeIn(o: StandingOrder, week: string): boolean {
  const d = deliveryDay(o, week)
  return d >= o.start_on && (!o.end_on || d <= o.end_on)
}

export interface OrderLine {
  order: StandingOrder
  week: string
  deliveryOn: string
  kg: number // after any change for this week
  standardKg: number
  skipped: boolean
  changed: boolean
  note: string | null
  crc: number
}

/** The lines due in one week, soonest delivery first. A skipped week keeps its line (kg 0) so it can be put back. */
export function orderLines(orders: StandingOrder[], weeks: OrderWeek[], week: string): OrderLine[] {
  const over = new Map<string, OrderWeek>()
  for (const w of weeks) if (w.week_start === week) over.set(w.order_id, w)
  const out: OrderLine[] = []
  for (const o of orders) {
    if (!activeIn(o, week)) continue
    const ov = over.get(o.id)
    const kg = ov ? Math.max(0, Number(ov.kg)) : Number(o.kg)
    out.push({
      order: o,
      week,
      deliveryOn: deliveryDay(o, week),
      kg,
      standardKg: Number(o.kg),
      skipped: kg === 0,
      changed: !!ov && kg !== Number(o.kg),
      note: ov?.note ?? null,
      crc: Math.round(kg * Number(o.price_crc_per_kg)),
    })
  }
  return out.sort((a, b) => a.deliveryOn.localeCompare(b.deliveryOn) || a.order.buyer.localeCompare(b.order.buyer) || a.order.species_key.localeCompare(b.order.species_key))
}

/** Order status in words for a list: RUNNING, STARTS 2026-11-13, ENDED 2026-12-04. */
export function orderState(o: StandingOrder, today: string): { text: string; running: boolean } {
  if (o.end_on && o.end_on < today) return { text: `ENDED ${o.end_on}`, running: false }
  if (o.start_on > today) return { text: `STARTS ${o.start_on}`, running: false }
  if (o.end_on) return { text: `ENDS ${o.end_on}`, running: true }
  return { text: 'RUNNING', running: true }
}

// ---------- buyer over-dependence ----------

export type DepLevel = 'ok' | 'near' | 'over'
export interface Dep {
  buyer: string
  kg: number
  crc: number
  sharePct: number // of the week's order value
  level: DepLevel
  unconfirmedCrc: number
}
export interface DepSummary {
  rows: Dep[]
  totalKg: number
  totalCrc: number
  unconfirmedPct: number
  buyers: number
  capPct: number
}

/** NEAR starts at this share of the cap (GUESS: 80%). */
export const NEAR_OF_CAP = 0.8

/** Each buyer's share of one week's orders by value (colones), flagged against the cap. Largest first. */
export function dependence(lines: OrderLine[], capPct: number): DepSummary {
  const m = new Map<string, Dep>()
  let totalKg = 0
  let totalCrc = 0
  let unc = 0
  for (const l of lines) {
    if (l.kg <= 0) continue
    const k = buyerKey(l.order.buyer)
    const d = m.get(k) ?? { buyer: l.order.buyer.trim(), kg: 0, crc: 0, sharePct: 0, level: 'ok' as DepLevel, unconfirmedCrc: 0 }
    d.kg += l.kg
    d.crc += l.crc
    if (!l.order.confirmed) d.unconfirmedCrc += l.crc
    m.set(k, d)
    totalKg += l.kg
    totalCrc += l.crc
    if (!l.order.confirmed) unc += l.crc
  }
  const rows = [...m.values()].sort((a, b) => b.crc - a.crc || a.buyer.localeCompare(b.buyer))
  for (const r of rows) {
    r.sharePct = totalCrc > 0 ? (r.crc / totalCrc) * 100 : 0
    r.level = r.sharePct > capPct + EPS ? 'over' : r.sharePct >= capPct * NEAR_OF_CAP - EPS ? 'near' : 'ok'
  }
  return { rows, totalKg, totalCrc, unconfirmedPct: totalCrc > 0 ? (unc / totalCrc) * 100 : 0, buyers: rows.length, capPct }
}

/** With the cap at 30%, fewer than 4 buyers can never all be under it. The screen says so instead of crying wolf. */
export const capReachable = (buyers: number, capPct: number) => buyers * capPct >= 100

// ---------- the harvest forecast ----------

/** Finished lots of one species before the farm's own figures replace Catawba's. GUESS. */
export const OWN_MIN_LOTS = 3

export interface Figures {
  kgPerBlock: number | null
  firstDays: number
  pickDays: number
  src: 'OWN' | 'CATAWBA' | 'NONE'
  /** The picking days are a guess either way. */
  pickGuess: boolean
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function figuresFor(species: string, finished: LotRecord[]): Figures {
  const ex = expectFor(species)
  const known = ROOM_DAYS[species]
  const pickDays = (known ?? ROOM_DAYS_OTHER).pick
  const mine = finished.filter((r) => r.lot.species_key === species && r.complete && r.kgPerBlock !== null)
  if (mine.length >= OWN_MIN_LOTS) {
    const first = mean(mine.map((r) => r.daysToFirstPick).filter((n): n is number => n !== null))
    return {
      kgPerBlock: mean(mine.map((r) => r.kgPerBlock as number)),
      firstDays: Math.round(first ?? ex.firstDays ?? ROOM_DAYS_OTHER.first),
      pickDays,
      src: 'OWN',
      pickGuess: true,
    }
  }
  return {
    kgPerBlock: ex.kgPerBlock,
    firstDays: Math.round(ex.firstDays ?? (known ?? ROOM_DAYS_OTHER).first),
    pickDays,
    src: ex.kgPerBlock === null ? 'NONE' : 'CATAWBA',
    pickGuess: true,
  }
}

export type ForecastFlag = 'WAIT' | 'DUE' | 'PICKING' | 'LATE' | 'PAST WINDOW' | 'DONE' | 'NO FIGURE'

export interface LotForecast {
  lot: BlockLot
  species: string
  blocks: number
  fig: Figures
  expectedKg: number
  pickedKg: number
  remainingKg: number // still to come (0 when past its window)
  from: string | null // first day the remaining kg is spread over
  to: string | null
  flag: ForecastFlag
}

/** Forecast for one active lot. `now` is today. */
export function forecastLot(rec: LotRecord, fig: Figures, now: string): LotForecast {
  const lot = rec.lot
  const base = { lot, species: lot.species_key, blocks: rec.blocks, fig, pickedKg: rec.kg, from: null, to: null }
  if (fig.kgPerBlock === null) return { ...base, expectedKg: 0, remainingKg: 0, flag: 'NO FIGURE' }
  const expectedKg = rec.blocks * fig.kgPerBlock
  const rem = Math.max(0, expectedKg - rec.kg)
  if (rec.blocks === 0 || rem <= EPS) return { ...base, expectedKg, remainingKg: 0, flag: 'DONE' }
  const start = addDays(lot.knock_date, fig.firstDays)
  const end = addDays(start, Math.max(1, fig.pickDays) - 1)
  if (now > end) {
    // The window is over. Picks were made: the lot is finishing, nothing more is counted. No picks: it has slipped, assume it starts now.
    if (rec.kg > 0) return { ...base, expectedKg, remainingKg: 0, flag: 'PAST WINDOW' }
    return { ...base, expectedKg, remainingKg: rem, from: now, to: addDays(now, Math.max(1, fig.pickDays) - 1), flag: 'LATE' }
  }
  if (now > start) return { ...base, expectedKg, remainingKg: rem, from: now, to: end, flag: rec.kg > 0 ? 'PICKING' : 'DUE' }
  return { ...base, expectedKg, remainingKg: rem, from: start, to: end, flag: now === start ? 'DUE' : 'WAIT' }
}

/** Lots that can still give mushrooms: incubating or fruiting. */
export const isLive = (l: BlockLot) => l.status === 'incubating' || l.status === 'fruiting'

export function forecastAll(recs: LotRecord[], now: string): LotForecast[] {
  // Species figures once each, so thousands of lots stay quick.
  const finishedBy = new Map<string, LotRecord[]>()
  for (const r of recs) if (r.complete) (finishedBy.get(r.lot.species_key) ?? finishedBy.set(r.lot.species_key, []).get(r.lot.species_key)!).push(r)
  const figs = new Map<string, Figures>()
  const out: LotForecast[] = []
  for (const r of recs) {
    if (!isLive(r.lot)) continue
    let f = figs.get(r.lot.species_key)
    if (!f) figs.set(r.lot.species_key, (f = figuresFor(r.lot.species_key, finishedBy.get(r.lot.species_key) ?? [])))
    out.push(forecastLot(r, f, now))
  }
  return out.sort((a, b) => (a.from ?? '9999').localeCompare(b.from ?? '9999') || a.lot.lot_code.localeCompare(b.lot.lot_code))
}

/** Kilos of a lot's forecast that fall on days a..b (inclusive). */
export function kgBetween(f: LotForecast, a: string, b: string): number {
  if (!f.from || !f.to || f.remainingKg <= 0) return 0
  const lo = a > f.from ? a : f.from
  const hi = b < f.to ? b : f.to
  if (hi < lo) return 0
  const days = daysBetween(f.from, f.to) + 1
  return (f.remainingKg * (daysBetween(lo, hi) + 1)) / days
}

export interface LotPick {
  lot_code: string
  kg: number
}

/** Kilos picked in the week, by species, from the harvest log. */
export function pickedByWeek(harvests: { block_lot_id: string; harvested_on: string; kg: number }[], speciesOfLot: Map<string, string>, week: string): Map<string, number> {
  const end = addDays(week, 6)
  const m = new Map<string, number>()
  for (const h of harvests) {
    if (h.harvested_on < week || h.harvested_on > end) continue
    const sp = speciesOfLot.get(h.block_lot_id)
    if (!sp) continue
    m.set(sp, (m.get(sp) ?? 0) + Number(h.kg))
  }
  return m
}

export interface WeekForecast {
  week: string
  /** kg per species still to come in this week (today onward). */
  byKg: Map<string, number>
  totalKg: number
}

/** Forecast kilos per species for each of `n` weeks starting with the week of `now`. Days before today are not counted (they are picks, not forecast). */
export function forecastWeeks(fc: LotForecast[], now: string, n: number): WeekForecast[] {
  const out: WeekForecast[] = []
  const first = mondayOf(now)
  for (let i = 0; i < n; i++) {
    const week = addDays(first, 7 * i)
    const a = week > now ? week : now
    const b = addDays(week, 6)
    const byKg = new Map<string, number>()
    let total = 0
    if (b >= now)
      for (const f of fc) {
        const kg = kgBetween(f, a, b)
        if (kg <= 0) continue
        byKg.set(f.species, (byKg.get(f.species) ?? 0) + kg)
        total += kg
      }
    out.push({ week, byKg, totalKg: total })
  }
  return out
}

// ---------- the weekly pick list ----------

export type PlanStatus = 'OK' | 'SPARE' | 'SHORT' | 'NO ORDERS'

export interface SpeciesWeek {
  species: string
  week: string
  forecastKg: number
  pickedKg: number
  supplyKg: number // picked so far this week + forecast
  ordersKg: number // fresh orders
  confirmedKg: number
  unconfirmedKg: number
  spareKg: number // kept back as the spare buffer
  promisableKg: number // supply minus the spare buffer
  status: PlanStatus
  shortKg: number // orders beyond the whole supply
  spareUsedKg: number // orders that dip into the spare buffer
  surplusKg: number // can still be offered to others without touching the spare buffer
  blocksShort: number | null
  kgPerBlock: number | null
  lots: LotPick[] // lots that give kg in this week, biggest first
}

export interface WeekPlanIn {
  week: string
  now: string
  forecasts: LotForecast[]
  lines: OrderLine[]
  picked: Map<string, number>
  spareBlockPct: number
}

/** Orders against supply for one week, per species (fresh only: dried orders are filled from the dryer, see GUESSES). */
export function weekPlan(i: WeekPlanIn): SpeciesWeek[] {
  const end = addDays(i.week, 6)
  const a = i.week > i.now ? i.week : i.now
  const species = new Set<string>()
  const orders = new Map<string, { all: number; conf: number }>()
  for (const l of i.lines) {
    if (l.order.form !== 'fresh' || l.kg <= 0) continue
    species.add(l.order.species_key)
    const o = orders.get(l.order.species_key) ?? { all: 0, conf: 0 }
    o.all += l.kg
    if (l.order.confirmed) o.conf += l.kg
    orders.set(l.order.species_key, o)
  }
  const fcKg = new Map<string, number>()
  const lotsBy = new Map<string, LotPick[]>()
  const kpb = new Map<string, number | null>()
  if (end >= i.now)
    for (const f of i.forecasts) {
      kpb.set(f.species, f.fig.kgPerBlock)
      const kg = kgBetween(f, a, end)
      if (kg <= 0) continue
      fcKg.set(f.species, (fcKg.get(f.species) ?? 0) + kg)
      ;(lotsBy.get(f.species) ?? lotsBy.set(f.species, []).get(f.species)!).push({ lot_code: f.lot.lot_code, kg })
      species.add(f.species)
    }
  for (const sp of i.picked.keys()) species.add(sp)
  for (const f of i.forecasts) if (!kpb.has(f.species)) kpb.set(f.species, f.fig.kgPerBlock)
  const spare = Math.max(0, Math.min(100, i.spareBlockPct)) / 100
  const rows: SpeciesWeek[] = []
  for (const sp of species) {
    const forecastKg = fcKg.get(sp) ?? 0
    const pickedKg = i.picked.get(sp) ?? 0
    const supply = forecastKg + pickedKg
    const o = orders.get(sp) ?? { all: 0, conf: 0 }
    const spareKg = supply * spare
    const promisable = supply - spareKg
    const shortKg = Math.max(0, o.all - supply)
    const spareUsed = Math.max(0, Math.min(o.all, supply) - promisable)
    const status: PlanStatus = o.all <= EPS ? 'NO ORDERS' : shortKg > EPS ? 'SHORT' : spareUsed > EPS ? 'SPARE' : 'OK'
    const perBlock = kpb.get(sp) ?? null
    rows.push({
      species: sp,
      week: i.week,
      forecastKg,
      pickedKg,
      supplyKg: supply,
      ordersKg: o.all,
      confirmedKg: o.conf,
      unconfirmedKg: o.all - o.conf,
      spareKg,
      promisableKg: promisable,
      status,
      shortKg,
      spareUsedKg: spareUsed,
      surplusKg: Math.max(0, promisable - o.all),
      blocksShort: shortKg > EPS && perBlock ? Math.ceil(shortKg / perBlock - EPS) : null,
      kgPerBlock: perBlock,
      lots: (lotsBy.get(sp) ?? []).sort((x, y) => y.kg - x.kg || x.lot_code.localeCompare(y.lot_code)),
    })
  }
  // Short first, then spare, then the rest by size.
  const rank: Record<PlanStatus, number> = { SHORT: 0, SPARE: 1, OK: 2, 'NO ORDERS': 3 }
  return rows.sort((x, y) => rank[x.status] - rank[y.status] || y.supplyKg - x.supplyKg || x.species.localeCompare(y.species))
}

/** Blocks to knock each week to cover a weekly order: losses at the contamination target, then the spare buffer on top. */
export function blocksNeeded(kgPerWeek: number, kgPerBlock: number | null, contamPct: number, sparePct: number): { base: number; withLoss: number; spare: number; total: number } | null {
  if (kgPerBlock === null || kgPerBlock <= 0 || kgPerWeek <= 0) return null
  const base = kgPerWeek / kgPerBlock
  const c = Math.min(95, Math.max(0, contamPct)) / 100
  const withLoss = Math.ceil(base / (1 - c) - EPS)
  const spare = Math.round((withLoss * Math.max(0, sparePct)) / 100)
  return { base, withLoss, spare, total: withLoss + spare }
}

// ---------- deliveries (sales made from the pick list) ----------

export interface OrderSale {
  id: string
  order_id?: string | null
  sold_on: string
  kg: number
  amount_crc: number
}

/** Sales ticked off from this order in this week. */
export function deliveredFor(l: OrderLine, sales: OrderSale[]): OrderSale[] {
  const end = addDays(l.week, 6)
  return sales.filter((s) => s.order_id === l.order.id && s.sold_on >= l.week && s.sold_on <= end)
}

export interface Fill {
  orderedKg: number
  deliveredKg: number
  deliveredCrc: number
  pct: number | null
  lines: number
  done: number
}

/** How much of the week's orders went out. */
export function fillRate(lines: OrderLine[], sales: OrderSale[]): Fill {
  let orderedKg = 0
  let deliveredKg = 0
  let deliveredCrc = 0
  let n = 0
  let done = 0
  for (const l of lines) {
    // A line changed to 0 kg after a delivery still counts what went out.
    const d = deliveredFor(l, sales)
    if (l.kg <= 0 && !d.length) continue
    n++
    orderedKg += l.kg
    if (d.length) done++
    for (const s of d) {
      deliveredKg += Number(s.kg)
      deliveredCrc += Number(s.amount_crc)
    }
  }
  return { orderedKg, deliveredKg, deliveredCrc, pct: orderedKg > 0 ? (deliveredKg / orderedKg) * 100 : null, lines: n, done }
}

/** Value of a week's orders in colones. */
export const weekValue = (lines: OrderLine[]) => lines.reduce((n, l) => n + l.crc, 0)

// ---------- WhatsApp text: availability and price list ----------

export type Lang = 'EN' | 'ES'

/** Spanish names are a GUESS for Joseph to correct. */
export const NAME_ES: Record<string, string> = {
  'blue-oyster': 'Ostra azul',
  'lions-mane': 'Melena de león',
  'comb-tooth': 'Hericium coral',
  'golden-oyster': 'Ostra dorada',
  'phoenix-oyster': 'Ostra fénix',
  'pink-oyster': 'Ostra rosada',
  'black-pearl': 'Ostra perla negra',
  'king-oyster': 'Ostra rey',
  shiitake: 'Shiitake',
  maitake: 'Maitake',
  chestnut: 'Hongo castaño',
  pioppino: 'Pioppino',
  reishi: 'Reishi',
  cordyceps: 'Cordyceps',
}
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Offer at least this many kg, rounded down to half a kilo. GUESS. */
export const MIN_OFFER_KG = 1
export const offerKg = (n: number) => (n < MIN_OFFER_KG ? 0 : Math.floor(n * 2 + EPS) / 2)

export interface OfferRow {
  species: string
  name: string
  kg: number
  price: number | null
}

/** Species with something free to sell (not promised, not the spare buffer), by name. */
export function offers(rows: SpeciesWeek[], priceOf: (species: string) => number | null, nameOf: (species: string) => string): OfferRow[] {
  return rows
    .map((r) => ({ species: r.species, name: nameOf(r.species), kg: offerKg(r.surplusKg), price: priceOf(r.species) }))
    .filter((o) => o.kg > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

const crcText = (n: number, lang: Lang) => {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'ES' ? '.' : ',')
  return `₡${s}`
}
const kgText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export interface WhatsIn {
  lang: Lang
  week: string
  offers: OfferRow[]
  farm: string
  /** Species names in Spanish; falls back to the English name. */
  nameEs?: (species: string) => string
}

/** The message to paste into WhatsApp. Prices in colones, cash on delivery. */
export function whatsappText(i: WhatsIn): string {
  const d = parseDay(i.week)
  const es = i.lang === 'ES'
  const date = es ? `${d.getDate()} de ${MONTHS_ES[d.getMonth()]}` : `${d.getDate()} ${MONTHS_EN[d.getMonth()]}`
  const lines: string[] = []
  lines.push(es ? `${i.farm}: hongos frescos` : `${i.farm}: fresh mushrooms`)
  lines.push(es ? `Semana del ${date}` : `Week of ${date}`)
  lines.push('')
  if (i.offers.length) {
    lines.push(es ? 'Disponible esta semana (kg aproximados):' : 'Available this week (kg are approximate):')
    for (const o of i.offers) {
      const nm = es ? i.nameEs?.(o.species) ?? o.name : o.name
      const price = o.price ? `${crcText(o.price, i.lang)}/kg` : es ? 'precio a consultar' : 'price on request'
      lines.push(`- ${nm}: ${kgText(o.kg)} kg, ${price}`)
    }
  } else {
    lines.push(es ? 'Esta semana no hay producto libre para nuevos pedidos.' : 'Nothing free for new orders this week.')
  }
  lines.push('')
  lines.push(es ? 'Pago contra entrega.' : 'Payment on delivery.')
  lines.push(es ? 'Escríbanos para reservar.' : 'Message us to reserve.')
  return lines.join('\n')
}

/** A plain-text pick and pack sheet for one week (copy to a note or print). */
export function pickSheetText(week: string, plan: SpeciesWeek[], lines: OrderLine[], nameOf: (species: string) => string): string {
  const out: string[] = [`PICK AND PACK // WEEK OF ${week}`, PAYMENT_RULE, '']
  out.push('PICK')
  for (const p of plan.filter((r) => r.ordersKg > 0 || r.forecastKg > 0)) {
    out.push(`${nameOf(p.species)}: ORDERS ${round2(p.ordersKg)} KG, SUPPLY ${round2(p.supplyKg)} KG // ${p.status}${p.shortKg > EPS ? ` SHORT ${round2(p.shortKg)} KG` : ''}`)
  }
  out.push('', 'PACK')
  let day = ''
  for (const l of lines.filter((x) => x.kg > 0)) {
    if (l.deliveryOn !== day) {
      day = l.deliveryOn
      out.push(`${DAY_NAMES[l.order.day_of_week - 1]} ${day}`)
    }
    out.push(`  ${l.order.buyer.toUpperCase()}: ${round2(l.kg)} KG ${nameOf(l.order.species_key)} ${l.order.form.toUpperCase()} @ ₡${Math.round(l.order.price_crc_per_kg)}/KG = ₡${l.crc}`)
  }
  return out.join('\n')
}
