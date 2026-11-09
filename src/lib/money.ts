// MONEY maths (build G6): receipts, money owed and its age, the cash-on-delivery hold, buyer share,
// week-on-week trends, buyers who stopped ordering, the waste log against the 25% line, trace and recall,
// monthly profit and loss, the 12-month cash flow, budget against actual, break-even and the what-if planner.
//
// Pure functions, covered by money.test.ts and money.stress.test.ts. Screens only draw what this returns.
//
// Money rules (Joseph, 6 Nov 2026):
//   - every amount is stored in colones; US$ is worked out at the record's OWN day's rate, never today's;
//   - every buyer pays cash on delivery, no credit terms. A sale not paid on delivery is an exception:
//     it shows as OWED, and that buyer is ON HOLD (no more deliveries) until it is paid;
//   - mark any buyer whose share of sales passes the cap (Practice buyerCapPct, 30%: Joseph confirmed 6 Nov 2026).

import type { Row } from './store'
import type { Sale } from './trade'
import type { EnergyBill, LabourEntry } from './ledger'
import type { Item, Move, Price } from './cargo'
import type { BlockLot, Culture, GrainRun, Strain } from './xeno'
import type { CookRun } from './cook'
import { addDays, parseDay } from './xeno'
import { weekOf } from './ledger'
import { buyerKey, EPS, NEAR_OF_CAP } from './orders'

// ---------- small helpers ----------

export const monthOf = (day: string) => day.slice(0, 7)
export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
/** Whole days from a to b (b later = positive). Local calendar days. */
export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000)
const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
export const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`

// ---------- payment state of a sale ----------

export type PayStatus = 'paid' | 'owed' | 'written_off'
export const PAYMENT_RULE = 'CASH ON DELIVERY, EVERY BUYER. NO CREDIT TERMS.'

/** Sales saved before G6 have no pay_status: they were cash on delivery, so they count as paid on the sale day. */
export const payStatus = (s: Pick<Sale, 'pay_status'>): PayStatus => (s.pay_status === 'owed' || s.pay_status === 'written_off' ? s.pay_status : 'paid')
/** The day the cash came in (null = not yet, or never). */
export const paidDay = (s: Sale): string | null => (payStatus(s) === 'paid' ? s.paid_on || s.sold_on : null)

// ---------- receipts ----------

/** Receipt numbers run per month of the sale: R2611-001, R2611-002 ... A number once given never changes. */
export function nextReceiptNo(sales: Pick<Sale, 'sold_on' | 'receipt_no'>[], day: string): string {
  const stem = `R${day.slice(2, 4)}${day.slice(5, 7)}-`
  let max = 0
  for (const s of sales) {
    const r = s.receipt_no
    if (typeof r === 'string' && r.startsWith(stem)) max = Math.max(max, Number(r.slice(stem.length)) || 0)
  }
  return `${stem}${String(max + 1).padStart(3, '0')}`
}

export interface ReceiptIn {
  sale: Sale
  farm: string
  place: string
  speciesName: (key: string) => string
  /** ₡ per US$ on the SALE day. */
  fx: number
}

/** A receipt as plain text, ready for WhatsApp or a printer. It is not a factura electrónica (see the accountant checklist). */
export function receiptText({ sale: s, farm, place, speciesName, fx }: ReceiptIn): string {
  const kg = n(s.kg)
  const crc = n(s.amount_crc)
  const st = payStatus(s)
  const lines = [
    `${farm}`,
    `${place}`,
    `RECEIPT ${s.receipt_no ?? '(NOT ISSUED)'}`,
    `DATE ${s.sold_on}`,
    `BUYER ${(s.buyer ?? 'CASH SALE').toUpperCase()}`,
    '',
    `${speciesName(s.species_key ?? 'unknown')} ${s.form.toUpperCase()}${s.grade ? ` GRADE ${s.grade}` : ''}`,
    `${kg.toFixed(2)} KG x ₡${(kg > 0 ? Math.round(crc / kg) : 0).toLocaleString('en-US')}/KG`,
    `TOTAL ₡${Math.round(crc).toLocaleString('en-US')} (ABOUT US$${(crc / fx).toFixed(2)} AT ₡${fx}/US$ ON ${s.sold_on})`,
  ]
  if (s.lot_codes?.length) lines.push(`LOTS ${s.lot_codes.join(' ')}`)
  lines.push('')
  if (st === 'paid') lines.push(`PAID IN FULL ${paidDay(s)}. ${PAYMENT_RULE}`)
  else if (st === 'owed') lines.push(`NOT PAID. ${PAYMENT_RULE} PLEASE PAY BEFORE THE NEXT DELIVERY.`)
  else lines.push('WRITTEN OFF.')
  lines.push('THIS IS A RECEIPT, NOT AN ELECTRONIC INVOICE (FACTURA ELECTRONICA).')
  return lines.join('\n')
}

// ---------- money owed and its age ----------

export const AGE_BUCKETS = [
  { id: '0-7', label: '0-7 DAYS', max: 7 },
  { id: '8-14', label: '8-14 DAYS', max: 14 },
  { id: '15-30', label: '15-30 DAYS', max: 30 },
  { id: '31+', label: 'OVER 30 DAYS', max: Infinity },
] as const
export type AgeBucket = (typeof AGE_BUCKETS)[number]['id']
export const bucketOf = (days: number): AgeBucket => AGE_BUCKETS.find((b) => days <= b.max)!.id

export interface OwedSale {
  sale: Sale
  days: number
  bucket: AgeBucket
}
export interface OwedBuyer {
  buyer: string
  crc: number
  n: number
  oldest: string
  days: number
  sales: OwedSale[]
}
export interface Owed {
  rows: OwedSale[]
  buyers: OwedBuyer[]
  total: number
  buckets: Record<AgeBucket, number>
}

/** Every unpaid sale, its age on `today`, and the total per buyer and per age bucket. Oldest first. */
export function owed(sales: Sale[], today: string): Owed {
  const rows: OwedSale[] = []
  const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b.id, 0])) as Record<AgeBucket, number>
  for (const s of sales) {
    if (payStatus(s) !== 'owed') continue
    const days = Math.max(0, daysBetween(s.sold_on, today))
    const bucket = bucketOf(days)
    rows.push({ sale: s, days, bucket })
    buckets[bucket] += n(s.amount_crc)
  }
  rows.sort((a, b) => b.days - a.days || a.sale.id.localeCompare(b.sale.id))
  const m = new Map<string, OwedBuyer>()
  for (const r of rows) {
    const name = (r.sale.buyer ?? '').trim() || 'NO NAME'
    const k = buyerKey(name)
    const b = m.get(k) ?? { buyer: name, crc: 0, n: 0, oldest: r.sale.sold_on, days: r.days, sales: [] }
    b.crc += n(r.sale.amount_crc)
    b.n++
    if (r.sale.sold_on < b.oldest) b.oldest = r.sale.sold_on
    b.days = Math.max(b.days, r.days)
    b.sales.push(r)
    m.set(k, b)
  }
  const buyers = [...m.values()].sort((a, b) => b.crc - a.crc || a.buyer.localeCompare(b.buyer))
  return { rows, buyers, total: rows.reduce((t, r) => t + n(r.sale.amount_crc), 0), buckets }
}

/** Cash on delivery: a buyer who owes anything is ON HOLD. Returns the owed summary for that buyer, or null when clear. */
export function holdFor(o: Owed, buyer: string | null | undefined): OwedBuyer | null {
  if (!buyer?.trim()) return null
  return o.buyers.find((b) => buyerKey(b.buyer) === buyerKey(buyer)) ?? null
}

// ---------- buyer share of real sales (over-dependence) ----------

export type ShareLevel = 'ok' | 'near' | 'over'
export interface BuyerShare {
  buyer: string
  crc: number
  kg: number
  n: number
  sharePct: number
  level: ShareLevel
  last: string
}

/** Each named buyer's share of sales by ₡ value from `from` to `to` (inclusive). Unnamed (market) sales count in the total. */
export function buyerShare(sales: Sale[], from: string, to: string, capPct: number): { rows: BuyerShare[]; total: number; unnamed: number } {
  const m = new Map<string, BuyerShare>()
  let total = 0
  let unnamed = 0
  for (const s of sales) {
    if (s.sold_on < from || s.sold_on > to || payStatus(s) === 'written_off') continue
    const c = n(s.amount_crc)
    total += c
    const name = (s.buyer ?? '').trim()
    if (!name) {
      unnamed += c
      continue
    }
    const k = buyerKey(name)
    const b = m.get(k) ?? { buyer: name, crc: 0, kg: 0, n: 0, sharePct: 0, level: 'ok' as ShareLevel, last: s.sold_on }
    b.crc += c
    b.kg += n(s.kg)
    b.n++
    if (s.sold_on >= b.last) b.last = s.sold_on
    m.set(k, b)
  }
  const rows = [...m.values()].sort((a, b) => b.crc - a.crc || a.buyer.localeCompare(b.buyer))
  for (const r of rows) {
    r.sharePct = total > 0 ? (r.crc / total) * 100 : 0
    r.level = r.sharePct > capPct + EPS ? 'over' : r.sharePct >= capPct * NEAR_OF_CAP - EPS ? 'near' : 'ok'
  }
  return { rows, total, unnamed }
}

// ---------- trends week on week ----------

export type TrendBy = 'species' | 'channel' | 'buyer'
export interface Trend {
  key: string
  weeks: string[] // Mondays, oldest first
  crc: number[]
  kg: number[]
  total: number
  /** Least-squares slope of ₡ per week, and as % of the average week. */
  slope: number
  slopePct: number | null
  /** This week against last week, %. null when last week was 0. */
  wow: number | null
  /** Last 4 weeks against the 4 before, %. */
  fourOnFour: number | null
  /** Straight trend line at the first and last week, for drawing. */
  line: [number, number]
}

export function mondays(endWeek: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(endWeek, (i - count + 1) * 7))
}

/** Least squares fit y = a + b x over x = 0..n-1. */
export function fit(y: number[]): { a: number; b: number } {
  const k = y.length
  if (k < 2) return { a: y[0] ?? 0, b: 0 }
  const mx = (k - 1) / 2
  const my = y.reduce((t, v) => t + v, 0) / k
  let num = 0
  let den = 0
  for (let i = 0; i < k; i++) {
    num += (i - mx) * (y[i] - my)
    den += (i - mx) ** 2
  }
  const b = den ? num / den : 0
  return { a: my - b * mx, b }
}
const pct = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null)

export const trendKey = (s: Sale, by: TrendBy) =>
  by === 'species' ? s.species_key ?? 'unknown' : by === 'channel' ? s.channel : (s.buyer ?? '').trim() ? buyerKey(s.buyer as string) : '(NO NAME)'

/** ₡ and kg per week for each species, channel or buyer over `count` weeks ending the week of `endWeek`. Biggest first. */
export function trends(sales: Sale[], by: TrendBy, endWeek: string, count = 12): Trend[] {
  const weeks = mondays(weekOf(endWeek), count)
  const first = weeks[0]
  const last = addDays(weeks[weeks.length - 1], 6)
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const m = new Map<string, { crc: number[]; kg: number[]; name: string }>()
  for (const s of sales) {
    if (s.sold_on < first || s.sold_on > last || payStatus(s) === 'written_off') continue
    const i = idx.get(weekOf(s.sold_on))
    if (i === undefined) continue
    const k = trendKey(s, by)
    const t = m.get(k) ?? { crc: weeks.map(() => 0), kg: weeks.map(() => 0), name: by === 'buyer' && (s.buyer ?? '').trim() ? (s.buyer as string).trim() : k }
    t.crc[i] += n(s.amount_crc)
    t.kg[i] += n(s.kg)
    m.set(k, t)
  }
  const out: Trend[] = []
  for (const [, t] of m) {
    const total = t.crc.reduce((a, b) => a + b, 0)
    const { a, b } = fit(t.crc)
    const avg = total / count
    const L = count
    const sum = (arr: number[], from: number, to: number) => arr.slice(Math.max(0, from), to).reduce((x, y) => x + y, 0)
    out.push({
      key: t.name,
      weeks,
      crc: t.crc,
      kg: t.kg,
      total,
      slope: b,
      slopePct: avg > 0 ? (b / avg) * 100 : null,
      wow: pct(t.crc[L - 1], t.crc[L - 2] ?? 0),
      fourOnFour: L >= 8 ? pct(sum(t.crc, L - 4, L), sum(t.crc, L - 8, L - 4)) : null,
      line: [a, a + b * (count - 1)],
    })
  }
  return out.sort((x, y) => y.total - x.total || x.key.localeCompare(y.key))
}

/** All sales together, per week. */
export function totalTrend(sales: Sale[], endWeek: string, count = 12): Trend {
  const all = trends(sales.map((s) => ({ ...s, channel: 'market' as const, species_key: 'all' })), 'species', endWeek, count)
  return all[0] ?? { key: 'all', weeks: mondays(weekOf(endWeek), count), crc: Array(count).fill(0), kg: Array(count).fill(0), total: 0, slope: 0, slopePct: null, wow: null, fourOnFour: null, line: [0, 0] }
}

// ---------- buyers who stopped ordering ----------

export type BuyerState = 'ACTIVE' | 'SLIPPING' | 'STOPPED'
export interface BuyerGap {
  buyer: string
  n: number
  first: string
  last: string
  /** Middle gap between their orders, in days. */
  usualGap: number | null
  sinceLast: number
  state: BuyerState
  crc: number
  /** ₡ per week while they were buying: what has stopped coming in. */
  perWeek: number
}

/** GUESS - REVIEW: a buyer is SLIPPING after 1.5x their usual gap (at least 14 days), STOPPED after 2x (at least 21). */
export const SLIP_X = 1.5
export const STOP_X = 2
export const SLIP_MIN = 14
export const STOP_MIN = 21

/** Named buyers with at least 2 sales, by how long it is since they last ordered against their usual gap. */
export function buyerGaps(sales: Sale[], today: string): BuyerGap[] {
  const m = new Map<string, { name: string; days: string[]; crc: number }>()
  for (const s of sales) {
    const name = (s.buyer ?? '').trim()
    if (!name || s.sold_on > today) continue
    const k = buyerKey(name)
    const b = m.get(k) ?? { name, days: [], crc: 0 }
    b.days.push(s.sold_on)
    b.crc += n(s.amount_crc)
    m.set(k, b)
  }
  const out: BuyerGap[] = []
  for (const b of m.values()) {
    const days = [...new Set(b.days)].sort()
    if (days.length < 2) continue
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d)).sort((x, y) => x - y)
    const mid = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2
    const first = days[0]
    const last = days[days.length - 1]
    const sinceLast = daysBetween(last, today)
    const state: BuyerState = sinceLast > Math.max(STOP_MIN, STOP_X * mid) ? 'STOPPED' : sinceLast > Math.max(SLIP_MIN, SLIP_X * mid) ? 'SLIPPING' : 'ACTIVE'
    const spanWeeks = Math.max(1, (daysBetween(first, last) + 7) / 7)
    out.push({ buyer: b.name, n: b.days.length, first, last, usualGap: mid, sinceLast, state, crc: b.crc, perWeek: b.crc / spanWeeks })
  }
  const rank = { STOPPED: 0, SLIPPING: 1, ACTIVE: 2 }
  return out.sort((a, b) => rank[a.state] - rank[b.state] || b.perWeek - a.perWeek || a.buyer.localeCompare(b.buyer))
}

// ---------- the waste log ----------

export type WasteRoute = 'unsold' | 'dried' | 'donated' | 'compost'
/** The surplus steps in order (textbook t22 Our farm surplus plan): sell, dry, donate, compost last. */
export const WASTE_ROUTES: { id: WasteRoute; label: string }[] = [
  { id: 'unsold', label: 'UNSOLD (THROWN OUT)' },
  { id: 'dried', label: 'DRIED' },
  { id: 'donated', label: 'DONATED' },
  { id: 'compost', label: 'COMPOSTED' },
]
export interface WasteEntry extends Row {
  logged_on: string
  species_key: string
  kg: number // fresh kg
  route: WasteRoute
  lot_codes: string[] | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface WasteWeek {
  week: string
  soldKg: number
  byRoute: Record<WasteRoute, number>
  surplusKg: number
  /** Surplus as a share of everything picked that week (sold + surplus), %. */
  surplusPct: number | null
  /** Thrown out or composted: no money back at all. */
  lostKg: number
  over: boolean
}

/** Sold fresh kg against surplus kg, per week, oldest first. `linePct` is the waste line (25%). */
export function wasteWeeks(sales: Sale[], waste: WasteEntry[], endWeek: string, count: number, linePct: number): WasteWeek[] {
  const weeks = mondays(weekOf(endWeek), count)
  const idx = new Map(weeks.map((w, i) => [w, i]))
  const rows: WasteWeek[] = weeks.map((week) => ({ week, soldKg: 0, byRoute: { unsold: 0, dried: 0, donated: 0, compost: 0 }, surplusKg: 0, surplusPct: null, lostKg: 0, over: false }))
  for (const s of sales) {
    if (s.form !== 'fresh' || payStatus(s) === 'written_off') continue
    const i = idx.get(weekOf(s.sold_on))
    if (i !== undefined) rows[i].soldKg += n(s.kg)
  }
  for (const w of waste) {
    const i = idx.get(weekOf(w.logged_on))
    if (i === undefined) continue
    const r = rows[i]
    const route: WasteRoute = (WASTE_ROUTES.some((x) => x.id === w.route) ? w.route : 'unsold') as WasteRoute
    r.byRoute[route] += n(w.kg)
  }
  for (const r of rows) {
    r.surplusKg = r.byRoute.unsold + r.byRoute.dried + r.byRoute.donated + r.byRoute.compost
    r.lostKg = r.byRoute.unsold + r.byRoute.compost
    const all = r.soldKg + r.surplusKg
    r.surplusPct = all > 0 ? (r.surplusKg / all) * 100 : null
    r.over = r.surplusPct !== null && r.surplusPct > linePct + EPS
  }
  return rows
}

export function checkWaste(i: { day: string; species: string; kg: number | null; route: string }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day)) return 'PICK THE DAY.'
  if (!i.species) return 'PICK THE SPECIES.'
  if (i.kg === null || !(i.kg > 0)) return 'TYPE THE FRESH KG (MORE THAN 0).'
  if (i.kg > 10000) return 'THAT IS MORE THAN 10 TONNES. CHECK THE KG.'
  if (!WASTE_ROUTES.some((r) => r.id === i.route)) return 'PICK WHERE IT WENT.'
  return null
}

// ---------- trace and recall ----------

export interface TraceLot {
  lot: BlockLot
  cook: CookRun | null
  grain: GrainRun | null
  /** The G1 master the G2 bag came from, when the lot was knocked from G2. */
  master: GrainRun | null
  culture: Culture | null
  strain: Strain | null
  room: string | null
  harvests: { day: string; kg: number; flush: number }[]
  losses: number
}

export interface TraceDb {
  lots: BlockLot[]
  cooks: CookRun[]
  grains: GrainRun[]
  cultures: Culture[]
  strains: Strain[]
  harvests: { block_lot_id: string; harvested_on: string; kg: number; flush: number }[]
  losses: { block_lot_id: string; bag_count: number }[]
}

/** One lot's whole chain: cook run, grain bag, master, plate, strain, room, harvests. */
export function traceLot(lot: BlockLot, db: TraceDb): TraceLot {
  const cook = lot.cook_run_id ? db.cooks.find((c) => c.id === lot.cook_run_id) ?? null : null
  const grain = lot.grain_run_id ? db.grains.find((g) => g.id === lot.grain_run_id) ?? null : null
  const master = grain?.parent_grain_run_id ? db.grains.find((g) => g.id === grain.parent_grain_run_id) ?? null : null
  const cid = master?.parent_culture_id ?? grain?.parent_culture_id ?? null
  const culture = cid ? db.cultures.find((c) => c.id === cid) ?? null : null
  const sid = lot.strain_id ?? grain?.strain_id ?? culture?.strain_id ?? null
  const strain = sid ? db.strains.find((s) => s.id === sid) ?? null : null
  const harvests = db.harvests.filter((h) => h.block_lot_id === lot.id).map((h) => ({ day: h.harvested_on, kg: n(h.kg), flush: n(h.flush) })).sort((a, b) => a.day.localeCompare(b.day))
  const losses = db.losses.filter((l) => l.block_lot_id === lot.id).reduce((t, l) => t + n(l.bag_count), 0)
  return { lot, cook, grain, master, culture, strain, room: lot.room ?? null, harvests, losses }
}

/** Lots whose code matches (ignoring case). A split child (B1020-S1) matches its own code only. */
export const lotsByCode = (lots: BlockLot[], code: string) => lots.filter((l) => l.lot_code.toUpperCase() === code.trim().toUpperCase())

/** Sales that name any of these lot codes. */
export function salesOfLots(sales: Sale[], codes: string[]): Sale[] {
  const want = new Set(codes.map((c) => c.toUpperCase()))
  return sales.filter((s) => (s.lot_codes ?? []).some((c) => want.has(c.toUpperCase()))).sort((a, b) => a.sold_on.localeCompare(b.sold_on) || a.id.localeCompare(b.id))
}

export type RecallBy = 'lot' | 'cook' | 'grain' | 'strain'

/** Every lot touched by one lot code, cook run, grain run (a master takes all its G2 children with it) or strain. */
export function recallLots(by: RecallBy, id: string, db: TraceDb): BlockLot[] {
  if (by === 'lot') return lotsByCode(db.lots, id)
  if (by === 'cook') return db.lots.filter((l) => l.cook_run_id === id)
  if (by === 'strain') {
    const grains = new Set(db.grains.filter((g) => g.strain_id === id).map((g) => g.id))
    return db.lots.filter((l) => l.strain_id === id || (l.grain_run_id && grains.has(l.grain_run_id)))
  }
  const runs = new Set([id, ...db.grains.filter((g) => g.parent_grain_run_id === id).map((g) => g.id)])
  return db.lots.filter((l) => l.grain_run_id && runs.has(l.grain_run_id))
}

export interface RecallRow {
  buyer: string
  sales: Sale[]
  kg: number
  crc: number
  first: string
  last: string
}

/** Who got product from these lots: one row per buyer, oldest sale first, plus sales with no buyer name. */
export function recallList(sales: Sale[], lots: BlockLot[]): { rows: RecallRow[]; sales: Sale[]; codes: string[] } {
  const codes = [...new Set(lots.map((l) => l.lot_code.toUpperCase()))].sort()
  const hit = salesOfLots(sales, codes)
  const m = new Map<string, RecallRow>()
  for (const s of hit) {
    const name = (s.buyer ?? '').trim() || 'NO NAME (MARKET OR CASH SALE)'
    const k = buyerKey(name)
    const r = m.get(k) ?? { buyer: name, sales: [], kg: 0, crc: 0, first: s.sold_on, last: s.sold_on }
    r.sales.push(s)
    r.kg += n(s.kg)
    r.crc += n(s.amount_crc)
    if (s.sold_on < r.first) r.first = s.sold_on
    if (s.sold_on > r.last) r.last = s.sold_on
    m.set(k, r)
  }
  return { rows: [...m.values()].sort((a, b) => a.first.localeCompare(b.first) || a.buyer.localeCompare(b.buyer)), sales: hit, codes }
}

export function recallText(title: string, list: ReturnType<typeof recallList>, nameOf: (k: string) => string): string {
  const out = [`RECALL LIST // ${title}`, `LOTS: ${list.codes.join(' ') || 'NONE'}`, `${list.rows.length} BUYERS // ${list.sales.length} SALES`, '']
  for (const r of list.rows) {
    out.push(`${r.buyer.toUpperCase()} // ${r.kg.toFixed(2)} KG // ${r.first}${r.last !== r.first ? ` TO ${r.last}` : ''}`)
    for (const s of r.sales) out.push(`  ${s.sold_on} ${nameOf(s.species_key ?? 'unknown')} ${n(s.kg).toFixed(2)} KG ${s.receipt_no ?? ''} LOTS ${(s.lot_codes ?? []).join(' ')}`.trimEnd())
  }
  return out.join('\n')
}

// ---------- spending, cash in, budget ----------

export type LineKind = 'in' | 'out'
export interface MoneyLine {
  id: string
  kind: LineKind
  label: string
  /** Filled by the app from other screens; cannot be typed on SPENDING. */
  auto?: boolean
  /** Counts in profit and loss. Equipment and loans are cash only (capital and financing). */
  pnl: boolean
  /** Break-even: a fixed cost (paid whatever is sold) or variable (grows with the crop). GUESS - REVIEW. */
  fixed?: boolean
}

/** The lines of the textbook's 12-month cash flow template (t22 Our farm), plus what the app fills itself. */
export const LINES: MoneyLine[] = [
  { id: 'sales_fresh', kind: 'in', label: 'FRESH SALES', auto: true, pnl: true },
  { id: 'sales_other', kind: 'in', label: 'DRIED AND OTHER SALES', auto: true, pnl: true },
  { id: 'other_income', kind: 'in', label: 'OTHER INCOME (TOURS, WORKSHOPS)', pnl: true },
  { id: 'loan_in', kind: 'in', label: 'LOANS, SAVINGS ADDED', pnl: false },
  { id: 'electricity', kind: 'out', label: 'ELECTRICITY (ICE BILLS IN LEDGER)', auto: true, pnl: true, fixed: true },
  { id: 'cargo', kind: 'out', label: 'STOCK DELIVERIES (CARGO, AT LAST PRICE)', auto: true, pnl: true, fixed: false },
  { id: 'labour_hours', kind: 'out', label: 'LOGGED HOURS X RATE (LEDGER)', auto: true, pnl: true, fixed: true },
  { id: 'fuel', kind: 'out', label: 'PROPANE OR FUEL (STEAM, GENERATOR)', pnl: true, fixed: false },
  { id: 'substrate', kind: 'out', label: 'SUBSTRATE: SAWDUST, SOY HULLS, GRAIN', pnl: true, fixed: false },
  { id: 'packaging', kind: 'out', label: 'BAGS, FILTERS, LABELS, PACKAGING', pnl: true, fixed: false },
  { id: 'water', kind: 'out', label: 'WATER TREATMENT AND CONSUMABLES', pnl: true, fixed: false },
  { id: 'cultures', kind: 'out', label: 'CULTURES AND TEST BLOCKS', pnl: true, fixed: false },
  { id: 'labour', kind: 'out', label: 'WAGES AND CCSS PAID', pnl: true, fixed: true },
  { id: 'transport', kind: 'out', label: 'TRANSPORT AND DELIVERY', pnl: true, fixed: false },
  { id: 'repairs', kind: 'out', label: 'REPAIRS AND MAINTENANCE', pnl: true, fixed: true },
  { id: 'admin', kind: 'out', label: 'ACCOUNTANT, PERMITS, INSURANCE, MUNICIPAL', pnl: true, fixed: true },
  { id: 'other_out', kind: 'out', label: 'OTHER COSTS', pnl: true, fixed: true },
  { id: 'bad_debt', kind: 'out', label: 'WRITTEN-OFF SALES', auto: true, pnl: true, fixed: true },
  { id: 'equipment', kind: 'out', label: 'EQUIPMENT BOUGHT (CAPITAL)', pnl: false },
  { id: 'loan_pay', kind: 'out', label: 'LOAN PAYMENTS', pnl: false },
]
export const LINE = new Map(LINES.map((l) => [l.id, l]))
export const lineLabel = (id: string) => LINE.get(id)?.label ?? id.toUpperCase()
/** Lines a person types on the SPENDING tab. */
export const TYPED_LINES = LINES.filter((l) => !l.auto)

export interface CashMove extends Row {
  day: string
  line: string
  amount_crc: number
  who: string | null // supplier or source
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface BudgetLine extends Row {
  /** id = month + ':' + line, so one figure per line per month. */
  month: string // yyyy-mm
  line: string
  amount_crc: number
  updated_at?: string
}
export const budgetId = (month: string, line: string) => `${month}:${line}`

export function checkMove(i: { day: string; line: string; amount: number | null }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day)) return 'PICK THE DAY.'
  const l = LINE.get(i.line)
  if (!l || l.auto) return 'PICK A LINE.'
  if (i.amount === null || !(i.amount > 0)) return 'TYPE THE ₡ AMOUNT (MORE THAN 0).'
  if (i.amount > 1e10) return 'THAT AMOUNT IS TOO BIG. CHECK THE ZEROS.'
  return null
}

// ---------- money settings ----------

export interface MoneySettings {
  /** Cash in hand at the start of the first cash-flow month, ₡. */
  openingCash: number
  /** First month of the 12-month cash flow, yyyy-mm. Blank = this month. */
  startMonth: string | null
  /** The cash floor: this many months of operating cash out (t22: at least three). */
  floorMonths: number
  /** Waste line: plan to sell 100 minus this % of the crop until real waste is measured (t22: 25%). */
  wasteLinePct: number
  /** Count CARGO deliveries (qty x last price) as money spent. Turn off if you log supply bills on SPENDING. */
  cargoAsSpend: boolean
  /** Count LEDGER labour hours x the hourly rate as wages. Turn off if you log wages paid on SPENDING. */
  hoursAsSpend: boolean
}
export const MONEY_ID = 'money'
export const DEFAULT_MONEY: MoneySettings = { openingCash: 0, startMonth: null, floorMonths: 3, wasteLinePct: 25, cargoAsSpend: true, hoursAsSpend: true }

export function mergeMoney(saved: unknown): MoneySettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof MoneySettings, unknown>>
  const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
  return {
    openingCash: num(s.openingCash, DEFAULT_MONEY.openingCash, -1e11, 1e11),
    startMonth: typeof s.startMonth === 'string' && /^\d{4}-\d{2}$/.test(s.startMonth) ? s.startMonth : null,
    floorMonths: num(s.floorMonths, DEFAULT_MONEY.floorMonths, 0, 24),
    wasteLinePct: num(s.wasteLinePct, DEFAULT_MONEY.wasteLinePct, 0, 100),
    cargoAsSpend: typeof s.cargoAsSpend === 'boolean' ? s.cargoAsSpend : DEFAULT_MONEY.cargoAsSpend,
    hoursAsSpend: typeof s.hoursAsSpend === 'boolean' ? s.hoursAsSpend : DEFAULT_MONEY.hoursAsSpend,
  }
}

// ---------- the money book: every amount by line and month ----------

export interface MoneyDb {
  sales: Sale[]
  moves: CashMove[]
  bills: EnergyBill[]
  labour: LabourEntry[]
  stock: Move[]
  prices: Price[]
  items?: Item[]
  budget: BudgetLine[]
  labourRate: number | null
  labourOn: boolean
  settings: MoneySettings
}

/** ₡ by line, per month. Two books: P&L (when it was earned or used) and CASH (when money moved). */
export type Book = Map<string, Map<string, number>>
const add = (b: Book, month: string, line: string, v: number) => {
  if (!v) return
  const m = b.get(month) ?? new Map<string, number>()
  m.set(line, (m.get(line) ?? 0) + v)
  b.set(month, m)
}
export const bookGet = (b: Book, month: string, line: string) => b.get(month)?.get(line) ?? 0

/** The price of an item on a day: the newest price on or before that day, else its first price. */
export function priceOn(prices: Price[], itemId: string, day: string): number | null {
  let best: Price | null = null
  let first: Price | null = null
  for (const p of prices) {
    if (p.item_id !== itemId) continue
    if (!first || p.priced_on < first.priced_on) first = p
    if (p.priced_on <= day && (!best || p.priced_on > best.priced_on || (p.priced_on === best.priced_on && (p.created_at ?? '') > (best.created_at ?? '')))) best = p
  }
  const use = best ?? first
  return use ? n(use.price_crc) : null
}

/** Stock deliveries in CARGO valued at the item's price on the delivery day. Deliveries with no price are counted apart. */
export function cargoSpend(stock: Move[], prices: Price[]): { byDay: { day: string; crc: number }[]; unpriced: number } {
  const byDay: { day: string; crc: number }[] = []
  let unpriced = 0
  for (const m of stock) {
    if (m.reason !== 'delivery' || !(n(m.qty) > 0)) continue
    const day = m.moved_at.slice(0, 10)
    const p = priceOn(prices, m.item_id, day)
    if (p === null) unpriced++
    else byDay.push({ day, crc: p * n(m.qty) })
  }
  return { byDay, unpriced }
}

/** Colones per dollar on a day. Each record converts at its own day's rate. */
export type Rate = (day: string) => number

/** Fill both books from every record. The same input always gives the same books.
 *  The US$ books add each record at ITS OWN day's rate (a bill at its month's last day), never today's. */
export function books(db: MoneyDb, rate: Rate = () => 510): { pnl: Book; cash: Book; pnlUsd: Book; cashUsd: Book; unpricedDeliveries: number } {
  const pnl: Book = new Map()
  const cash: Book = new Map()
  const pnlUsd: Book = new Map()
  const cashUsd: Book = new Map()
  const both = (month: string, line: string, v: number, day: string, inPnl: boolean, inCash: boolean, cashMonth = month) => {
    const u = v / rate(day)
    if (inPnl) {
      add(pnl, month, line, v)
      add(pnlUsd, month, line, u)
    }
    if (inCash) {
      add(cash, cashMonth, line, v)
      add(cashUsd, cashMonth, line, u)
    }
  }
  for (const s of db.sales) {
    const line = s.form === 'fresh' ? 'sales_fresh' : 'sales_other'
    const c = n(s.amount_crc)
    const st = payStatus(s)
    // Earned when sold; cash when paid. US$ at the sale day either way (the price was agreed that day).
    both(monthOf(s.sold_on), line, c, s.sold_on, true, st === 'paid', st === 'paid' ? monthOf(paidDay(s) as string) : undefined)
    // A write-off is a cost in the month it was written off (paid_on holds that day), never cash.
    if (st === 'written_off') both(monthOf(s.paid_on || s.sold_on), 'bad_debt', c, s.sold_on, true, false)
  }
  for (const m of db.moves) {
    const l = LINE.get(m.line)
    if (!l || l.auto) continue
    both(monthOf(m.day), m.line, n(m.amount_crc), m.day, l.pnl, true)
  }
  for (const b of db.bills) {
    const month = monthOf(b.month)
    both(month, 'electricity', n(b.total_crc), lastDay(month), true, true) // GUESS: paid in the bill's own month
  }
  let unpriced = 0
  if (db.settings.cargoAsSpend) {
    const cs = cargoSpend(db.stock, db.prices)
    unpriced = cs.unpriced
    for (const d of cs.byDay) both(monthOf(d.day), 'cargo', d.crc, d.day, true, true)
  }
  if (db.settings.hoursAsSpend && db.labourOn && db.labourRate) {
    for (const e of db.labour) both(monthOf(e.worked_on), 'labour_hours', n(e.hours) * db.labourRate, e.worked_on, true, true)
  }
  return { pnl, cash, pnlUsd, cashUsd, unpricedDeliveries: unpriced }
}

/** Last day of a month, yyyy-mm-dd. */
export function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${month}-${String(d.getDate()).padStart(2, '0')}`
}
/** Sum of a month's lines in a book. */
export const bookMonth = (b: Book, month: string, kind?: LineKind, pnlOnly = false) => {
  let t = 0
  for (const [line, v] of b.get(month) ?? []) {
    const l = LINE.get(line)
    if (!l || (kind && l.kind !== kind) || (pnlOnly && !l.pnl)) continue
    t += v
  }
  return t
}

export function budgetBook(budget: BudgetLine[]): Book {
  const b: Book = new Map()
  for (const r of budget) if (LINE.has(r.line)) add(b, r.month, r.line, n(r.amount_crc))
  return b
}

// ---------- profit and loss ----------

export interface PnlRow {
  line: string
  label: string
  kind: LineKind
  actual: number
  budget: number
  /** actual - budget for income, budget - actual for costs: positive = better than budget. */
  better: number
}
export interface Pnl {
  month: string
  income: PnlRow[]
  costs: PnlRow[]
  revenue: number
  cost: number
  profit: number
  marginPct: number | null
  budgetRevenue: number
  budgetCost: number
  budgetProfit: number
  kgSold: number
  hasData: boolean
}

export function pnlMonth(month: string, pnl: Book, budget: Book, sales: Sale[]): Pnl {
  const income: PnlRow[] = []
  const costs: PnlRow[] = []
  for (const l of LINES) {
    if (!l.pnl) continue
    const actual = bookGet(pnl, month, l.id)
    const bud = bookGet(budget, month, l.id)
    if (!actual && !bud && l.auto && l.kind === 'out' && l.id !== 'electricity') continue
    if (!actual && !bud && !l.auto) continue
    const row = { line: l.id, label: l.label, kind: l.kind, actual, budget: bud, better: l.kind === 'in' ? actual - bud : bud - actual }
    ;(l.kind === 'in' ? income : costs).push(row)
  }
  const revenue = income.reduce((t, r) => t + r.actual, 0)
  const cost = costs.reduce((t, r) => t + r.actual, 0)
  const budgetRevenue = income.reduce((t, r) => t + r.budget, 0)
  const budgetCost = costs.reduce((t, r) => t + r.budget, 0)
  const kgSold = sales.filter((s) => monthOf(s.sold_on) === month && s.form === 'fresh').reduce((t, s) => t + n(s.kg), 0)
  return {
    month,
    income,
    costs,
    revenue,
    cost,
    profit: revenue - cost,
    marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
    budgetRevenue,
    budgetCost,
    budgetProfit: budgetRevenue - budgetCost,
    kgSold,
    hasData: revenue !== 0 || cost !== 0,
  }
}

// ---------- the 12-month cash flow ----------

export interface CashMonth {
  month: string
  /** ACTUAL = month is over; NOW = this month so far; PLAN = a month to come (budget figures). */
  basis: 'ACTUAL' | 'NOW' | 'PLAN'
  inLines: Map<string, number>
  outLines: Map<string, number>
  cashIn: number
  cashOut: number
  net: number
  /** Cash at the end of the month. */
  end: number
  /** Operating cash out (no equipment, no loan payments). */
  operating: number
}
export interface CashFlow {
  months: CashMonth[]
  opening: number
  floor: number
  /** Months whose end cash is below the floor. */
  below: string[]
  /** The lowest end-of-month cash and its month. */
  low: { month: string; end: number } | null
}

/** Months before `today`'s month use the cash book; this month uses the cash book so far; later months use the budget. */
export function cashFlow(cash: Book, budget: Book, start: string, today: string, opening: number, floorMonths: number, count = 12): CashFlow {
  const now = monthOf(today)
  const months: CashMonth[] = []
  let end = opening
  for (let i = 0; i < count; i++) {
    const month = addMonths(start, i)
    const basis = month < now ? 'ACTUAL' : month === now ? 'NOW' : 'PLAN'
    const src = basis === 'PLAN' ? budget : cash
    const inLines = new Map<string, number>()
    const outLines = new Map<string, number>()
    let cashIn = 0
    let cashOut = 0
    let operating = 0
    for (const l of LINES) {
      const v = bookGet(src, month, l.id)
      if (!v) continue
      if (l.kind === 'in') {
        inLines.set(l.id, v)
        cashIn += v
      } else {
        outLines.set(l.id, v)
        cashOut += v
        if (l.id !== 'equipment' && l.id !== 'loan_pay') operating += v
      }
    }
    end += cashIn - cashOut
    months.push({ month, basis, inLines, outLines, cashIn, cashOut, net: cashIn - cashOut, end, operating })
  }
  const ops = months.filter((m) => m.operating > 0)
  const avg = ops.length ? ops.reduce((t, m) => t + m.operating, 0) / ops.length : 0
  const floor = avg * floorMonths
  const below = months.filter((m) => m.end < floor - EPS).map((m) => m.month)
  const low = months.length ? months.reduce((a, b) => (b.end < a.end ? b : a)) : null
  return { months, opening, floor, below, low: low ? { month: low.month, end: low.end } : null }
}

// ---------- break-even ----------

export interface BreakEven {
  months: string[]
  revenue: number
  kg: number
  fixed: number
  variable: number
  pricePerKg: number | null
  varPerKg: number | null
  /** kg a month that pays the fixed costs. null when each kilo does not even pay its own variable cost. */
  kgPerMonth: number | null
  /** The same in blocks a week, at the given kg per block. */
  blocksPerWeek: number | null
  /** Revenue a month at break-even. */
  revenueNeeded: number | null
  /** How far the months' average kg sold is above (+) or below (-) break-even, %. */
  marginOfSafetyPct: number | null
  basis: 'ACTUAL' | 'BUDGET' | 'NONE'
}

const WEEKS_PER_MONTH = 52 / 12

/** Break-even from the average of some months of P&L: fixed costs / (average price per kg - variable cost per kg). */
export function breakEven(months: string[], pnl: Book, sales: Sale[], kgPerBlock: number | null, budget?: Book, budgetKgPerMonth?: number | null): BreakEven {
  let revenue = 0
  let fixed = 0
  let variable = 0
  let kg = 0
  let basis: BreakEven['basis'] = 'ACTUAL'
  const sum = (b: Book) => {
    revenue = 0
    fixed = 0
    variable = 0
    for (const m of months) {
      for (const l of LINES) {
        if (!l.pnl) continue
        const v = bookGet(b, m, l.id)
        if (l.kind === 'in') revenue += v
        else if (l.fixed) fixed += v
        else variable += v
      }
    }
  }
  sum(pnl)
  kg = sales.filter((s) => s.form === 'fresh' && months.includes(monthOf(s.sold_on))).reduce((t, s) => t + n(s.kg), 0)
  if (revenue <= 0 && budget) {
    sum(budget)
    kg = (budgetKgPerMonth ?? 0) * months.length
    basis = revenue > 0 ? 'BUDGET' : 'NONE'
  } else if (revenue <= 0) basis = 'NONE'
  const k = Math.max(1, months.length)
  const mRevenue = revenue / k
  const mFixed = fixed / k
  const mVar = variable / k
  const mKg = kg / k
  const pricePerKg = mKg > 0 ? mRevenue / mKg : null
  const varPerKg = mKg > 0 ? mVar / mKg : null
  const unit = pricePerKg !== null && varPerKg !== null ? pricePerKg - varPerKg : null
  const kgPerMonth = unit !== null && unit > 0 ? mFixed / unit : null
  return {
    months,
    revenue: mRevenue,
    kg: mKg,
    fixed: mFixed,
    variable: mVar,
    pricePerKg,
    varPerKg,
    kgPerMonth,
    blocksPerWeek: kgPerMonth !== null && kgPerBlock ? kgPerMonth / kgPerBlock / WEEKS_PER_MONTH : null,
    revenueNeeded: kgPerMonth !== null && pricePerKg !== null ? kgPerMonth * pricePerKg : null,
    marginOfSafetyPct: kgPerMonth !== null && kgPerMonth > 0 && mKg > 0 ? ((mKg - kgPerMonth) / kgPerMonth) * 100 : null,
    basis,
  }
}

// ---------- the what-if planner ----------

export interface WhatIfSpecies {
  key: string
  /** Share of the week's bags, %. */
  sharePct: number
  /** Fresh kg per block (Catawba or the farm's own). null = no figure. */
  kgPerBlock: number | null
  pricePerKg: number | null
}
export interface WhatIfIn {
  bagsPerWeek: number
  species: WhatIfSpecies[]
  /** % of the crop sold (100 - waste line). */
  sellPct: number
  /** Supplies, labour and wear per block, ₡ (not power). */
  costPerBlock: number
  /** The farm's monthly ICE bill at the full plan (130 bags), and how much of it scales with bags. */
  powerAtPlan: number
  planBags: number
  /** Share of the power bill that grows with bags, %. The rest (lab, cold rooms, lights, fixed charge) stays. */
  powerVariablePct: number
  /** Other fixed costs a month (rent, accountant, permits, wages not per block), ₡. */
  fixedPerMonth: number
}
export interface WhatIfRow {
  key: string
  bags: number
  kg: number
  soldKg: number
  sales: number
  noFigure: boolean
}
export interface WhatIfOut {
  rows: WhatIfRow[]
  bags: number
  kgWeek: number
  soldKgWeek: number
  salesWeek: number
  suppliesWeek: number
  powerMonth: number
  powerWeek: number
  fixedWeek: number
  costWeek: number
  profitWeek: number
  profitMonth: number
  salesMonth: number
  costMonth: number
  /** Bags a week where profit is 0 at this mix and these prices. null = never (each bag loses money). */
  breakEvenBags: number | null
  sharesPct: number
}

/** Bags are shared by the mix and rounded to whole bags (the largest remainders get the leftovers). */
export function splitBags(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + Math.max(0, b), 0)
  if (sum <= 0 || total <= 0) return shares.map(() => 0)
  const raw = shares.map((s) => (Math.max(0, s) / sum) * total)
  const out = raw.map(Math.floor)
  let left = Math.round(total) - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i)
  for (let j = 0; left > 0 && j < order.length; j++, left--) out[order[j].i]++
  return out
}

export function whatIf(i: WhatIfIn): WhatIfOut {
  const bags = Math.max(0, Math.round(i.bagsPerWeek))
  const split = splitBags(bags, i.species.map((s) => s.sharePct))
  const sell = Math.min(100, Math.max(0, i.sellPct)) / 100
  const rows: WhatIfRow[] = i.species.map((s, k) => {
    const kg = s.kgPerBlock ? split[k] * s.kgPerBlock : 0
    return { key: s.key, bags: split[k], kg, soldKg: kg * sell, sales: kg * sell * (s.pricePerKg ?? 0), noFigure: !s.kgPerBlock || !s.pricePerKg }
  })
  const kgWeek = rows.reduce((t, r) => t + r.kg, 0)
  const soldKgWeek = rows.reduce((t, r) => t + r.soldKg, 0)
  const salesWeek = rows.reduce((t, r) => t + r.sales, 0)
  const suppliesWeek = bags * i.costPerBlock
  const vp = Math.min(100, Math.max(0, i.powerVariablePct)) / 100
  const fixedPower = i.powerAtPlan * (1 - vp)
  const perBagPower = i.planBags > 0 ? (i.powerAtPlan * vp) / i.planBags : 0
  const powerMonth = fixedPower + perBagPower * bags
  const powerWeek = powerMonth / WEEKS_PER_MONTH
  const fixedWeek = i.fixedPerMonth / WEEKS_PER_MONTH
  const costWeek = suppliesWeek + powerWeek + fixedWeek
  const profitWeek = salesWeek - costWeek
  // Per bag at this mix: sales a bag - supplies a bag - power a bag. Fixed = fixed power + other fixed.
  const salesPerBag = bags > 0 ? salesWeek / bags : (() => {
    const one = whatIf({ ...i, bagsPerWeek: 100 })
    return one.salesWeek / 100
  })()
  const unit = salesPerBag - i.costPerBlock - perBagPower / WEEKS_PER_MONTH
  const fixedAll = fixedPower / WEEKS_PER_MONTH + fixedWeek
  const breakEvenBags = unit > 0 ? fixedAll / unit : null
  return {
    rows,
    bags,
    kgWeek,
    soldKgWeek,
    salesWeek,
    suppliesWeek,
    powerMonth,
    powerWeek,
    fixedWeek,
    costWeek,
    profitWeek,
    profitMonth: profitWeek * WEEKS_PER_MONTH,
    salesMonth: salesWeek * WEEKS_PER_MONTH,
    costMonth: costWeek * WEEKS_PER_MONTH,
    breakEvenBags,
    sharesPct: i.species.reduce((t, s) => t + Math.max(0, s.sharePct), 0),
  }
}

// ---------- seed a budget from the sales plan ----------

/** The weekly ₡ of fresh sales the plan expects: kg per species x price, times the sell share. */
export function planWeekSales(split: { key: string; bags: number }[], kgPerBlock: (k: string) => number | null, price: (k: string) => number | null, sellPct: number): { kg: number; crc: number } {
  let kg = 0
  let crc = 0
  for (const s of split) {
    const y = kgPerBlock(s.key)
    const p = price(s.key)
    if (!y) continue
    const k = s.bags * y * (sellPct / 100)
    kg += k
    if (p) crc += k * p
  }
  return { kg, crc }
}
export { WEEKS_PER_MONTH }

export const MONEY_GUESSES = [
  'SALES SAVED BEFORE THIS BUILD COUNT AS PAID ON THE SALE DAY (CASH ON DELIVERY).',
  'A BUYER WHO OWES ANY MONEY IS ON HOLD: NO DELIVERY UNTIL PAID. THE PICK LIST AND THE SALE FORM SAY SO, BUT DO NOT BLOCK THE SAVE.',
  'AGE BUCKETS FOR MONEY OWED: 0-7, 8-14, 15-30 AND OVER 30 DAYS.',
  'A BUYER IS SLIPPING AFTER 1.5 TIMES THEIR USUAL GAP BETWEEN ORDERS (AT LEAST 14 DAYS) AND STOPPED AFTER 2 TIMES (AT LEAST 21). NEEDS 2 SALES.',
  'BUYER SHARE IN MONEY IS FROM REAL SALES OF THE LAST 4 WEEKS (STANDING ORDERS SHOWS THE SHARE OF ORDERS). SAME 30% CAP, NEAR AT 80% OF IT.',
  'ICE BILLS COUNT AS PAID IN THE BILL\'S OWN MONTH.',
  'CARGO DELIVERIES COUNT AS SPENT ON THE DELIVERY DAY AT THE ITEM\'S PRICE ON THAT DAY. TURN THIS OFF IF YOU TYPE SUPPLY BILLS ON SPENDING, OR THEY COUNT TWICE.',
  'LEDGER HOURS X THE HOURLY RATE COUNT AS WAGES. TURN THIS OFF IF YOU TYPE WAGES PAID ON SPENDING, OR THEY COUNT TWICE.',
  'EQUIPMENT AND LOAN PAYMENTS ARE CASH ONLY, NOT IN PROFIT AND LOSS. LOANS AND SAVINGS ADDED ARE CASH IN, NOT INCOME.',
  'A WRITTEN-OFF SALE IS A COST IN THE MONTH IT IS WRITTEN OFF.',
  'BREAK-EVEN: ELECTRICITY, WAGES, REPAIRS, ADMIN AND OTHER COSTS ARE FIXED; SUPPLIES, FUEL, CULTURES AND TRANSPORT GROW WITH THE CROP. USES THE LAST 3 FULL MONTHS.',
  'CASH FLOW: MONTHS TO COME USE THE BUDGET. THE FLOOR IS 3 MONTHS OF THE AVERAGE OPERATING CASH OUT.',
  'WHAT-IF POWER: 60% OF THE ICE BILL GROWS WITH BAGS, 40% STAYS (LAB, COLD ROOMS, FIXED CHARGE). THE BILL AT 130 BAGS IS THE MIDDLE OF THE PACKAGE ESTIMATE.',
  'WHAT-IF YIELDS: THE FARM\'S OWN KG PER BLOCK ONCE 3 LOTS OF A SPECIES ARE FINISHED, ELSE CATAWBA\'S.',
  'SURPLUS SHARE = SURPLUS KG / (FRESH KG SOLD + SURPLUS KG) IN THE SAME WEEK. DRIED COUNTS AS SURPLUS (IT WAS NOT SOLD FRESH).',
  'RECEIPT NUMBERS RUN PER MONTH OF THE SALE: R2611-001. THEY ARE RECEIPTS, NOT ELECTRONIC INVOICES (ASK THE ACCOUNTANT).',
]
