// Mock trials and unit tests for G5 (standing orders, harvest forecast, pick list, WhatsApp text).
// Joseph's rule (6 Nov 2026): realistic farm data end to end, outputs checked against hand-worked numbers, every write
// in the edit history, old records surviving price changes / reloads / backup, then stress (orders.stress.test.ts).
import { describe, expect, it, vi } from 'vitest'

// The hand-worked forecasts below were worked out with picking windows of 7 days (21 for lion's mane).
// They test the arithmetic, so they keep those windows; the real Catawba windows are checked in their own test.
vi.mock('../data/ledger', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/ledger')>()
  const ROOM_DAYS = Object.fromEntries(Object.entries(real.ROOM_DAYS).map(([k, v]) => [k, { ...v, pick: k === 'lions-mane' ? 21 : 7 }]))
  return { ...real, ROOM_DAYS, ROOM_DAYS_OTHER: { first: 30, pick: 14 } }
})
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import type { EditEntry } from './history'
import type { BlockLot } from './xeno'
import type { Harvest } from './ledger'
import type { LotLoss } from './hazard'
import type { Sale } from './trade'
import { allRecords } from './records'
import { mergePractice } from './bank'
import {
  PAYMENT_RULE,
  activeIn,
  blocksNeeded,
  capReachable,
  checkOrder,
  dependence,
  deliveredFor,
  deliveryDay,
  figuresFor,
  fillRate,
  forecastAll,
  forecastLot,
  forecastWeeks,
  kgBetween,
  mondayOf,
  offerKg,
  offers,
  orderLines,
  orderState,
  pickSheetText,
  pickedByWeek,
  weekPlan,
  weekRowId,
  weekValue,
  whatsappText,
  type OrderWeek,
  type StandingOrder,
} from './orders'
import { changeTerms, createOrder, deleteOrder, deliverAll, deliverLine, endOrder, restartOrder, setNote, setWeekKg } from './ordersActions'

Store.GROUP_MS = 0
const settle = () => new Promise((r) => setTimeout(r, 0))

const NOW = '2026-11-09' // a Monday
const BLUE = 0.9207925110999999 // kg per block: Catawba 2.03 lb x 0.45359237
const LM = 0.7393555631 // lion's mane 1.63 lb

const lot = (id: string, code: string, o: Partial<BlockLot> = {}): BlockLot => ({
  id, lot_code: code, species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 40, knock_date: '2026-10-20', status: 'fruiting', notes: null, ...o,
})
const harv = (id: string, lotId: string, day: string, kg: number, flush = 1): Harvest => ({ id, block_lot_id: lotId, harvested_on: day, flush, kg, grade: 'A', initials: 'AB', notes: null })
const loss = (id: string, lotId: string, n: number): LotLoss => ({ id, block_lot_id: lotId, hazard_key: null, bag_count: n, cause: null, noted_on: '2026-10-25', notes: null })
const order = (id: string, buyer: string, o: Partial<StandingOrder> = {}): StandingOrder => ({
  id, buyer, channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', kg: 10, price_crc_per_kg: 11500, day_of_week: 5, start_on: '2026-11-02', end_on: null, confirmed: true, prev_id: null, notes: null, ...o,
})
const close = (a: number, b: number, d = 4) => expect(a).toBeCloseTo(b, d)

describe('dates and weeks', () => {
  it('delivery day is the Monday plus the day number, and an order is active by its delivery day', () => {
    const o = order('o', 'CASA', { day_of_week: 5, start_on: '2026-11-13' })
    expect(deliveryDay(o, '2026-11-09')).toBe('2026-11-13')
    expect(activeIn(o, '2026-11-09')).toBe(true) // Friday 13 Nov is the start
    expect(activeIn(o, '2026-11-02')).toBe(false) // Friday 6 Nov is before
    const e = order('e', 'CASA', { end_on: '2026-11-13' })
    expect(activeIn(e, '2026-11-09')).toBe(true) // last delivery that Friday
    expect(activeIn(e, '2026-11-16')).toBe(false)
  })
  it('a Monday-start order that delivers on Monday starts that week; Sunday delivery ends the week', () => {
    const mon = order('m', 'X', { day_of_week: 1, start_on: '2026-11-09' })
    const sun = order('s', 'X', { day_of_week: 7, start_on: '2026-11-09', end_on: '2026-11-15' })
    expect(activeIn(mon, '2026-11-09')).toBe(true)
    expect(activeIn(sun, '2026-11-09')).toBe(true)
    expect(activeIn(sun, '2026-11-16')).toBe(false)
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
  })
  it('order state words', () => {
    expect(orderState(order('a', 'X'), NOW)).toEqual({ text: 'RUNNING', running: true })
    expect(orderState(order('a', 'X', { start_on: '2026-11-16' }), NOW).text).toBe('STARTS 2026-11-16')
    expect(orderState(order('a', 'X', { end_on: '2026-11-06' }), NOW)).toEqual({ text: 'ENDED 2026-11-06', running: false })
    expect(orderState(order('a', 'X', { end_on: '2026-11-20' }), NOW).text).toBe('ENDS 2026-11-20')
  })
})

describe('order checks', () => {
  const ok = { buyer: 'CASA', species_key: 'blue-oyster', form: 'fresh' as const, kg: 10, price: 11500, day_of_week: 5, start_on: NOW }
  it('accepts a good order and explains each bad one', () => {
    expect(checkOrder(ok)).toBeNull()
    expect(checkOrder({ ...ok, buyer: '  ' })).toMatch(/BUYER/)
    expect(checkOrder({ ...ok, buyer: 'X'.repeat(41) })).toMatch(/TOO LONG/)
    expect(checkOrder({ ...ok, kg: null })).toMatch(/KG/)
    expect(checkOrder({ ...ok, kg: 0 })).toMatch(/KG/)
    expect(checkOrder({ ...ok, kg: -3 })).toMatch(/KG/)
    expect(checkOrder({ ...ok, kg: Number.NaN })).toMatch(/KG/)
    expect(checkOrder({ ...ok, kg: 5000 })).toMatch(/1,000/)
    expect(checkOrder({ ...ok, price: null })).toMatch(/₡/)
    expect(checkOrder({ ...ok, price: 0 })).toMatch(/₡/)
    expect(checkOrder({ ...ok, price: 5_000_000 })).toMatch(/TOO HIGH/)
    expect(checkOrder({ ...ok, day_of_week: 0 })).toMatch(/DAY/)
    expect(checkOrder({ ...ok, day_of_week: 8 })).toMatch(/DAY/)
    expect(checkOrder({ ...ok, start_on: 'soon' })).toMatch(/WEEK/)
    expect(checkOrder({ ...ok, start_on: '2026-02-31x' })).toMatch(/WEEK/)
  })
  it('cash on delivery is a rule in words, and no order field mentions terms', () => {
    expect(PAYMENT_RULE).toMatch(/CASH ON DELIVERY/)
    expect(PAYMENT_RULE).toMatch(/NO CREDIT/)
    const keys = Object.keys(order('a', 'X'))
    expect(keys.some((k) => /term|credit|due|invoice/i.test(k))).toBe(false)
  })
})

describe('buyer over-dependence (cap 30%)', () => {
  // Week of 9 Nov. Values: CASA 30 kg x 11,500 = 345,000; BRISA 20 kg x 11,500 = 230,000; MAR 10 kg x 13,800 = 138,000;
  // TIENDA 5 kg x 11,500 = 57,500; PEZ 5 kg x 11,500 = 57,500. Total 828,000.
  const orders = [
    order('1', 'Casa Verde', { kg: 30 }),
    order('2', 'Brisa', { kg: 20 }),
    order('3', 'Mar', { kg: 10, species_key: 'lions-mane', price_crc_per_kg: 13800 }),
    order('4', 'Tienda', { kg: 5, confirmed: false }),
    order('5', 'Pez', { kg: 5 }),
  ]
  const lines = orderLines(orders, [], '2026-11-09')
  it('shares by colones, largest first, with the right level', () => {
    const d = dependence(lines, 30)
    expect(d.totalCrc).toBe(828000)
    expect(d.totalKg).toBe(70)
    expect(d.buyers).toBe(5)
    expect(d.rows.map((r) => r.buyer)).toEqual(['Casa Verde', 'Brisa', 'Mar', 'Pez', 'Tienda'])
    close(d.rows[0].sharePct, (345000 / 828000) * 100, 6) // 41.67%
    expect(d.rows[0].level).toBe('over')
    close(d.rows[1].sharePct, (230000 / 828000) * 100, 6) // 27.78%: above 24% (80% of cap), under 30%
    expect(d.rows[1].level).toBe('near')
    close(d.rows[2].sharePct, (138000 / 828000) * 100, 6) // 16.67%
    expect(d.rows[2].level).toBe('ok')
    expect(d.rows.reduce((n, r) => n + r.sharePct, 0)).toBeCloseTo(100, 8)
    close(d.unconfirmedPct, (57500 / 828000) * 100, 6)
  })
  it('a lower cap marks more buyers, and the cap setting is read from the practice settings', () => {
    expect(dependence(lines, 20).rows.filter((r) => r.level === 'over').map((r) => r.buyer)).toEqual(['Casa Verde', 'Brisa'])
    expect(mergePractice({}).buyerCapPct).toBe(30)
    expect(mergePractice({ buyerCapPct: 40 }).buyerCapPct).toBe(40)
    expect(mergePractice({ buyerCapPct: 'junk' }).buyerCapPct).toBe(30)
    expect(mergePractice({ buyerCapPct: -4 }).buyerCapPct).toBe(5)
  })
  it('exactly at the cap is not over; names match ignoring case and spaces; skipped weeks do not count', () => {
    const two = orderLines([order('a', 'A  b', { kg: 3 }), order('b', 'a B', { kg: 3 }), order('c', 'Other', { kg: 4 })], [], '2026-11-09')
    const d = dependence(two, 60) // A B = 6 of 10 kg = exactly 60%
    expect(d.buyers).toBe(2)
    expect(d.rows[0].sharePct).toBeCloseTo(60, 8)
    expect(d.rows[0].level).toBe('near')
    const skip: OrderWeek = { id: weekRowId('1', '2026-11-09'), order_id: '1', week_start: '2026-11-09', kg: 0, note: null }
    expect(dependence(orderLines(orders, [skip], '2026-11-09'), 30).buyers).toBe(4)
    expect(dependence([], 30).rows).toEqual([])
  })
  it('with fewer than 4 buyers the 30% cap cannot be met', () => {
    expect(capReachable(3, 30)).toBe(false)
    expect(capReachable(4, 30)).toBe(true)
  })
})

describe('forecast from the lots in the rooms (hand-worked)', () => {
  it('figures: Catawba until 3 finished own lots, then the farm\'s own average', () => {
    const f = figuresFor('blue-oyster', [])
    expect(f.src).toBe('CATAWBA')
    close(f.kgPerBlock as number, BLUE, 6)
    expect(f.firstDays).toBe(23)
    expect(f.pickDays).toBe(7)
    expect(figuresFor('lions-mane', []).pickDays).toBe(21)
    expect(figuresFor('lions-mane', []).firstDays).toBe(24)
    // three finished lots: 1.0 kg/block picked on day 20, 1.2 on day 22, 1.1 on day 24 -> own 1.1 kg/block, first pick day 22.
    const fin = [['a', 40, 40, '2026-05-10'], ['b', 40, 48, '2026-05-12'], ['c', 40, 44, '2026-05-14']].map(([id, n, kg, day]) =>
      allRecords([lot(id as string, `B${id}`, { bag_count: n as number, knock_date: '2026-04-20', status: 'spent' })], [], [harv(`h${id}`, id as string, day as string, kg as number)], [])[0])
    const own = figuresFor('blue-oyster', fin)
    expect(own.src).toBe('OWN')
    close(own.kgPerBlock as number, 1.1, 8)
    expect(own.firstDays).toBe(22)
    expect(figuresFor('blue-oyster', fin.slice(0, 2)).src).toBe('CATAWBA')
    expect(figuresFor('shiitake', []).src === 'NONE' || figuresFor('shiitake', []).kgPerBlock !== null).toBe(true)
  })

  it('a lot not yet in its window: kg spread evenly over 7 days; weeks split by days', () => {
    // Knocked 20 Oct, 40 blocks: first pick day 23 = 12 Nov, picking 12-18 Nov. Expected 40 x 0.92079 = 36.8317 kg, 5.2617 kg a day.
    const rec = allRecords([lot('L', 'B1020')], [], [], [])[0]
    const fc = forecastLot(rec, figuresFor('blue-oyster', []), NOW)
    expect(fc.flag).toBe('WAIT')
    expect(fc.from).toBe('2026-11-12')
    expect(fc.to).toBe('2026-11-18')
    close(fc.expectedKg, 40 * BLUE)
    close(fc.remainingKg, 40 * BLUE)
    close(kgBetween(fc, '2026-11-09', '2026-11-15'), (40 * BLUE * 4) / 7) // 12, 13, 14, 15 Nov
    close(kgBetween(fc, '2026-11-16', '2026-11-22'), (40 * BLUE * 3) / 7) // 16, 17, 18 Nov
    close(kgBetween(fc, '2026-11-23', '2026-11-29'), 0)
    close(kgBetween(fc, '2026-11-01', '2026-11-08'), 0)
    close(kgBetween(fc, '2026-11-12', '2026-11-12'), (40 * BLUE) / 7)
  })

  it('lost blocks and picks so far come off; a window already running starts today', () => {
    // 40 knocked, 6 lost = 34 blocks, expected 31.3069 kg. 10 kg picked so far, now in the window (day 25 = 14 Nov).
    const rec = allRecords([lot('L', 'B1020')], [loss('x', 'L', 6)], [harv('h', 'L', '2026-11-12', 10)], [])[0]
    const fc = forecastLot(rec, figuresFor('blue-oyster', []), '2026-11-14')
    expect(fc.flag).toBe('PICKING')
    expect(fc.blocks).toBe(34)
    close(fc.expectedKg, 34 * BLUE)
    close(fc.remainingKg, 34 * BLUE - 10)
    expect(fc.from).toBe('2026-11-14')
    expect(fc.to).toBe('2026-11-18')
    // 21.3069 kg over 14, 15, 16, 17, 18 = 5 days
    close(kgBetween(fc, '2026-11-14', '2026-11-15'), ((34 * BLUE - 10) * 2) / 5)
  })

  it('late (window over, nothing picked) restarts at today; picked and over = finishing, nothing counted; done', () => {
    const late = forecastLot(allRecords([lot('L', 'B1001', { knock_date: '2026-10-01' })], [], [], [])[0], figuresFor('blue-oyster', []), NOW)
    expect(late.flag).toBe('LATE')
    expect(late.from).toBe(NOW)
    expect(late.to).toBe('2026-11-15')
    close(late.remainingKg, 40 * BLUE)
    const past = forecastLot(allRecords([lot('L', 'B1001', { knock_date: '2026-10-01' })], [], [harv('h', 'L', '2026-10-25', 20)], [])[0], figuresFor('blue-oyster', []), NOW)
    expect(past.flag).toBe('PAST WINDOW')
    expect(past.remainingKg).toBe(0)
    const done = forecastLot(allRecords([lot('L', 'B1020')], [], [harv('h', 'L', '2026-11-12', 40)], [])[0], figuresFor('blue-oyster', []), '2026-11-13')
    expect(done.flag).toBe('DONE')
    expect(done.remainingKg).toBe(0)
    const none = forecastLot(allRecords([lot('L', 'B1020', { bag_count: 3 })], [loss('x', 'L', 3)], [], [])[0], figuresFor('blue-oyster', []), NOW)
    expect(none.flag).toBe('DONE')
  })

  it('only incubating and fruiting lots are forecast; weeks add up', () => {
    const lots = [
      lot('A', 'B1020'), // 36.8317 kg, 12-18 Nov
      lot('B', 'L1022', { species_key: 'lions-mane', knock_date: '2026-10-22', bag_count: 20, status: 'incubating' }), // first 24 -> 15 Nov, 21 days to 5 Dec
      lot('C', 'B0901', { status: 'spent' }),
      lot('D', 'B0902', { status: 'lost' }),
    ]
    const recs = allRecords(lots, [], [], [])
    const fc = forecastAll(recs, NOW)
    expect(fc.map((f) => f.lot.id).sort()).toEqual(['A', 'B'])
    const weeks = forecastWeeks(fc, NOW, 3)
    expect(weeks.map((w) => w.week)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23'])
    const lmTotal = 20 * LM // 14.7871
    const lmDay = lmTotal / 21
    close(weeks[0].byKg.get('blue-oyster') ?? 0, (40 * BLUE * 4) / 7)
    close(weeks[0].byKg.get('lions-mane') ?? 0, lmDay * 1) // 15 Nov only
    close(weeks[1].byKg.get('lions-mane') ?? 0, lmDay * 7)
    close(weeks[2].byKg.get('blue-oyster') ?? 0, 0)
    close(weeks[2].byKg.get('lions-mane') ?? 0, lmDay * 7)
    close(weeks[0].totalKg, (40 * BLUE * 4) / 7 + lmDay)
    // the three weeks plus the rest of the window never exceed the lot's total
    const all = weeks.reduce((n, w) => n + w.totalKg, 0)
    expect(all).toBeLessThanOrEqual(40 * BLUE + lmTotal + 1e-9)
  })

  it('the first week counts from today, not before; a past week has no forecast', () => {
    const rec = allRecords([lot('A', 'B1020')], [], [], [])[0]
    const fc = forecastAll([rec], '2026-11-14') // Saturday: only 14, 15 Nov of week 1 left
    const w = forecastWeeks(fc, '2026-11-14', 1)[0]
    close(w.totalKg, (40 * BLUE * 2) / 5) // from 14 to 18 = 5 days, 2 of them this week
    expect(w.week).toBe('2026-11-09')
  })
})

describe('weekly pick list: short, spare and free kg', () => {
  // Blue: lot A (40 blocks) gives 36.8317 kg in total, 21.0467 this week (12-15 Nov), 15.785 next week.
  const recs = allRecords([lot('A', 'B1020')], [], [], [])
  const fc = forecastAll(recs, NOW)
  const plan = (orders: StandingOrder[], spare = 5, weeks: OrderWeek[] = [], harvests: Harvest[] = [], week = '2026-11-09', now = NOW) =>
    weekPlan({
      week,
      now,
      forecasts: forecastAll(allRecords([lot('A', 'B1020')], [], harvests, []), now),
      lines: orderLines(orders, weeks, week),
      picked: pickedByWeek(harvests, new Map([['A', 'blue-oyster']]), week),
      spareBlockPct: spare,
    })

  it('OK: orders under supply minus spare; free kg is the rest', () => {
    const p = plan([order('1', 'CASA', { kg: 10 })])[0]
    const supply = (40 * BLUE * 4) / 7
    close(p.supplyKg, supply)
    close(p.spareKg, supply * 0.05)
    close(p.promisableKg, supply * 0.95)
    expect(p.status).toBe('OK')
    close(p.surplusKg, supply * 0.95 - 10)
    expect(p.shortKg).toBe(0)
    expect(p.lots).toEqual([{ lot_code: 'B1020', kg: expect.any(Number) }])
    expect(fc.length).toBe(1)
  })
  it('SPARE: orders between supply minus spare and supply; SHORT: orders above supply, with blocks short', () => {
    const supply = (40 * BLUE * 4) / 7 // 21.0467
    const spare = plan([order('1', 'CASA', { kg: 20.5 })])[0]
    expect(spare.status).toBe('SPARE')
    close(spare.spareUsedKg, 20.5 - supply * 0.95)
    expect(spare.shortKg).toBe(0)
    expect(spare.surplusKg).toBe(0)
    const short = plan([order('1', 'CASA', { kg: 15 }), order('2', 'BRISA', { kg: 10 })])[0]
    expect(short.status).toBe('SHORT')
    close(short.shortKg, 25 - supply) // 3.9533 kg
    expect(short.blocksShort).toBe(Math.ceil((25 - supply) / BLUE)) // 5 blocks
    expect(short.confirmedKg + short.unconfirmedKg).toBe(25)
  })
  it('unconfirmed kg are counted and split out; dried orders are not checked against fresh supply', () => {
    const p = plan([order('1', 'CASA', { kg: 10 }), order('2', 'MAR', { kg: 4, confirmed: false }), order('3', 'SECO', { kg: 50, form: 'dried' })])[0]
    expect(p.ordersKg).toBe(14)
    expect(p.confirmedKg).toBe(10)
    expect(p.unconfirmedKg).toBe(4)
    expect(p.status).toBe('OK')
  })
  it('picks so far this week add to supply and are not counted twice', () => {
    // 10 kg already picked on 12 Nov; now 13 Nov: remaining 26.83 over 13-18 (6 days); this week 13, 14, 15 = 3 days.
    const h = [harv('h', 'A', '2026-11-12', 10)]
    const p = plan([order('1', 'CASA', { kg: 10 })], 5, [], h, '2026-11-09', '2026-11-13')[0]
    close(p.pickedKg, 10)
    close(p.forecastKg, ((40 * BLUE - 10) * 3) / 6)
    close(p.supplyKg, 10 + ((40 * BLUE - 10) * 3) / 6)
  })
  it('a skipped week removes the order; a changed week uses its kg; a past week has no forecast but shows picks', () => {
    const skip: OrderWeek = { id: weekRowId('1', '2026-11-09'), order_id: '1', week_start: '2026-11-09', kg: 0, note: 'HOLIDAY' }
    expect(plan([order('1', 'CASA', { kg: 10 })], 5, [skip])[0].ordersKg).toBe(0)
    expect(plan([order('1', 'CASA', { kg: 10 })], 5, [skip])[0].status).toBe('NO ORDERS')
    const more: OrderWeek = { ...skip, kg: 12.5, note: null }
    expect(plan([order('1', 'CASA', { kg: 10 })], 5, [more])[0].ordersKg).toBe(12.5)
    const h = [harv('h', 'A', '2026-11-03', 7)]
    const past = weekPlan({ week: '2026-11-02', now: NOW, forecasts: forecastAll(allRecords([lot('A', 'B1020')], [], h, []), NOW), lines: orderLines([order('1', 'CASA', { kg: 6 })], [], '2026-11-02'), picked: pickedByWeek(h, new Map([['A', 'blue-oyster']]), '2026-11-02'), spareBlockPct: 5 })[0]
    expect(past.forecastKg).toBe(0)
    expect(past.pickedKg).toBe(7)
    expect(past.status).toBe('OK')
  })
  it('spare buffer 0 means supply can be promised in full', () => {
    const supply = (40 * BLUE * 4) / 7
    const p = plan([order('1', 'CASA', { kg: 21 })], 0)[0]
    expect(supply).toBeGreaterThan(21)
    expect(p.status).toBe('OK')
    close(p.surplusKg, supply - 21)
  })
  it('blocks needed for an order: losses at the contamination target, then spare', () => {
    // 20 kg / 0.92079 = 21.72 blocks; / 0.95 = 22.86 -> 23; spare 5% of 23 = 1.15 -> 1; total 24.
    const n = blocksNeeded(20, BLUE, 5, 5)!
    close(n.base, 20 / BLUE)
    expect(n.withLoss).toBe(23)
    expect(n.spare).toBe(1)
    expect(n.total).toBe(24)
    expect(blocksNeeded(20, null, 5, 5)).toBeNull()
    expect(blocksNeeded(0, BLUE, 5, 5)).toBeNull()
    expect(blocksNeeded(20, BLUE, 100, 0)!.withLoss).toBe(Math.ceil(20 / BLUE / 0.05)) // contamination capped at 95%
  })
})

describe('WhatsApp availability and price list', () => {
  it('offers round down to half a kilo and drop anything under 1 kg', () => {
    expect(offerKg(0.99)).toBe(0)
    expect(offerKg(1)).toBe(1)
    expect(offerKg(1.49)).toBe(1)
    expect(offerKg(1.5)).toBe(1.5)
    expect(offerKg(12.99)).toBe(12.5)
    expect(offerKg(13)).toBe(13)
  })
  const rows = weekPlan({
    week: '2026-11-09',
    now: NOW,
    forecasts: forecastAll(allRecords([lot('A', 'B1020'), lot('B', 'L1022', { species_key: 'lions-mane', knock_date: '2026-10-22', bag_count: 20, status: 'incubating' })], [], [], []), NOW),
    lines: orderLines([order('1', 'CASA', { kg: 10 })], [], '2026-11-09'),
    picked: new Map(),
    spareBlockPct: 5,
  })
  const price = (s: string) => (s === 'blue-oyster' ? 11500 : null)
  const name = (s: string) => (s === 'blue-oyster' ? 'Blue oyster' : "Lion's mane")
  it('free kg = forecast - spare - orders; lion\'s mane gives under 1 kg this week so it is left out', () => {
    // blue: 21.0467 x 0.95 - 10 = 9.9944 -> 9.5 kg. lion's mane: 14.787/21 = 0.704 kg this week (15 Nov) x 0.95 = 0.669 -> 0.
    const o = offers(rows, price, name)
    expect(o).toEqual([{ species: 'blue-oyster', name: 'Blue oyster', kg: 9.5, price: 11500 }])
  })
  it('English text', () => {
    const t = whatsappText({ lang: 'EN', week: '2026-11-09', offers: offers(rows, price, name), farm: 'NEGRA BAY BIOLOGICS' })
    expect(t).toBe(['NEGRA BAY BIOLOGICS: fresh mushrooms', 'Week of 9 Nov', '', 'Available this week (kg are approximate):', '- Blue oyster: 9.5 kg, ₡11,500/kg', '', 'Payment on delivery.', 'Message us to reserve.'].join('\n'))
  })
  it('Spanish text, with a price missing and nothing available', () => {
    const o = [{ species: 'lions-mane', name: "Lion's mane", kg: 3, price: null }, { species: 'blue-oyster', name: 'Blue oyster', kg: 12, price: 11500 }]
    const t = whatsappText({ lang: 'ES', week: '2026-12-07', offers: o, farm: 'NEGRA BAY BIOLOGICS', nameEs: (s) => (s === 'blue-oyster' ? 'Ostra azul' : 'Melena de león') })
    expect(t).toBe(['NEGRA BAY BIOLOGICS: hongos frescos', 'Semana del 7 de dic', '', 'Disponible esta semana (kg aproximados):', '- Melena de león: 3 kg, precio a consultar', '- Ostra azul: 12 kg, ₡11.500/kg', '', 'Pago contra entrega.', 'Escríbanos para reservar.'].join('\n'))
    expect(whatsappText({ lang: 'EN', week: NOW, offers: [], farm: 'F' })).toMatch(/Nothing free/)
    expect(whatsappText({ lang: 'ES', week: NOW, offers: [], farm: 'F' })).toMatch(/no hay producto libre/)
  })
  it('the pick sheet lists pick, then pack by day with each buyer and total', () => {
    const lines = orderLines([order('1', 'CASA', { kg: 10 }), order('2', 'BRISA', { kg: 5, day_of_week: 6 })], [], '2026-11-09')
    const s = pickSheetText('2026-11-09', rows, lines, name)
    expect(s).toContain('CASH ON DELIVERY')
    expect(s).toContain('FRIDAY 2026-11-13')
    expect(s).toContain('SATURDAY 2026-11-14')
    expect(s).toContain('CASA: 10 KG Blue oyster FRESH @ ₡11500/KG = ₡115000')
    expect(s).toContain('BRISA: 5 KG Blue oyster FRESH @ ₡11500/KG = ₡57500')
  })
})

// ---------- mock trials against a real Store: writes, history, undo ----------

const mk = async () => {
  const st = new Store(new MemoryBackend())
  for (const t of ['standing_orders', 'order_weeks', 'sales', EDIT_LOG]) await st.ensure(t)
  return st
}
const histories = async (st: Store) => {
  await settle()
  return st.rows<EditEntry>(EDIT_LOG)
}
const od = (st: Store) => st.rows<StandingOrder>('standing_orders')
const wk = (st: Store) => st.rows<OrderWeek>('order_weeks')
const sales = (st: Store) => st.rows<Sale>('sales')

describe('mock trial: a restaurant order from first week to a price rise to ending', () => {
  it('create, change terms from a later Monday (old weeks keep the old price), skip a week, end, restart, undo each', async () => {
    const st = await mk()
    const a = await st.action('NEW ORDER', () => createOrder(st, { buyer: ' Casa   Verde ', channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', kg: 10, price: 11000, day_of_week: 5, start_on: '2026-11-02', confirmed: false }))
    expect(a.buyer).toBe('Casa Verde')
    expect(od(st)).toHaveLength(1)
    // price rise from Monday 30 Nov: 12 kg at 11,500, now confirmed
    const b = await st.action('NEW TERMS', () => changeTerms(st, a, { kg: 12, price: 11500, day_of_week: 5, confirmed: true }, '2026-11-30'))
    expect(od(st)).toHaveLength(2)
    const old = od(st).find((o) => o.id === a.id)!
    expect(old.end_on).toBe('2026-11-29')
    expect(old.price_crc_per_kg).toBe(11000)
    expect(b.prev_id).toBe(a.id)
    expect(b.start_on).toBe('2026-11-30')
    const lines = (week: string) => orderLines(od(st), wk(st), week)
    expect(lines('2026-11-23').map((l) => [l.kg, l.crc])).toEqual([[10, 110000]]) // old price
    expect(lines('2026-11-30').map((l) => [l.kg, l.crc])).toEqual([[12, 138000]]) // new price
    expect(lines('2026-10-26')).toEqual([]) // before it started
    // skip the week of 7 Dec for the new order, then set 8 kg for the week of 14 Dec
    await st.action('SKIP', () => setWeekKg(st, b, '2026-12-07', 0, 'CLOSED', wk(st)))
    await st.action('LESS', () => setWeekKg(st, b, '2026-12-14', 8, null, wk(st)))
    expect(lines('2026-12-07')[0]).toMatchObject({ kg: 0, skipped: true, crc: 0, note: 'CLOSED' })
    expect(lines('2026-12-14')[0]).toMatchObject({ kg: 8, changed: true, crc: 92000 })
    expect(lines('2026-12-21')[0]).toMatchObject({ kg: 12, changed: false })
    expect(wk(st)).toHaveLength(2)
    // putting a week back to the standing amount removes its row
    await st.action('BACK', () => setWeekKg(st, b, '2026-12-14', null, null, wk(st)))
    expect(wk(st)).toHaveLength(1)
    await st.action('BACK2', () => setWeekKg(st, b, '2026-12-07', 12, null, wk(st)))
    expect(wk(st)).toHaveLength(0)
    // end after Friday 18 Dec, restart from 11 Jan
    await st.action('END', () => endOrder(st, b, '2026-12-18'))
    expect(lines('2026-12-21')).toEqual([])
    expect(lines('2026-12-14')).toHaveLength(1)
    const c = await st.action('RESTART', () => restartOrder(st, od(st).find((o) => o.id === b.id)!, '2027-01-11'))
    expect(c.kg).toBe(12)
    expect(c.prev_id).toBe(b.id)
    expect(lines('2027-01-11')[0].crc).toBe(138000)
    expect(lines('2026-12-28')).toEqual([])
    // every write is in the history, one per action
    const h = await histories(st)
    expect(h.filter((e) => e.table_name === 'standing_orders' && e.op === 'create')).toHaveLength(3)
    expect(h.some((e) => e.table_name === 'standing_orders' && e.op === 'update' && e.changes.some((x) => x.f === 'end_on' && x.new === '2026-11-29'))).toBe(true)
    // undo walks back: restart, end, ... one step each
    expect(await st.undo()).toBe('RESTART')
    expect(od(st)).toHaveLength(2)
    expect(await st.undo()).toBe('END')
    expect(od(st).find((o) => o.id === b.id)!.end_on).toBeNull()
    await st.undo() // BACK2 (skip row back)
    expect(wk(st)).toHaveLength(1)
    await st.undo() // BACK
    expect(wk(st)).toHaveLength(2)
    await st.undo() // LESS
    await st.undo() // SKIP
    expect(wk(st)).toHaveLength(0)
    expect(await st.undo()).toBe('NEW TERMS')
    expect(od(st)).toHaveLength(1)
    expect(od(st)[0].end_on).toBeNull()
  })

  it('a skipped week set before a change of terms moves to the new row', async () => {
    const st = await mk()
    const a = await createOrder(st, { buyer: 'X', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 5, price: 11000, day_of_week: 5, start_on: '2026-11-02', confirmed: true })
    await setWeekKg(st, a, '2026-12-07', 0, 'HOLIDAY', [])
    await setWeekKg(st, a, '2026-11-16', 3, null, wk(st))
    const b = await st.action('CHANGE', () => changeTerms(st, a, { kg: 6, price: 12000, day_of_week: 5, confirmed: true }, '2026-11-30', wk(st)))
    const lines = (w: string) => orderLines(od(st), wk(st), w)
    expect(lines('2026-12-07')[0]).toMatchObject({ kg: 0, skipped: true, note: 'HOLIDAY' })
    expect(lines('2026-12-07')[0].order.id).toBe(b.id)
    expect(lines('2026-11-16')[0]).toMatchObject({ kg: 3, crc: 33000 }) // the earlier week stays on the old order
    expect(lines('2026-11-16')[0].order.id).toBe(a.id)
    expect(lines('2026-12-14')[0]).toMatchObject({ kg: 6, crc: 72000 })
    await st.undo()
    expect(lines('2026-12-07')[0].order.id).toBe(a.id)
    expect(lines('2026-12-07')[0].skipped).toBe(true)
    expect(od(st)).toHaveLength(1)
  })

  it('refuses bad changes with a clear sentence and writes nothing', async () => {
    const st = await mk()
    const a = await createOrder(st, { buyer: 'X', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 5, price: 11500, day_of_week: 5, start_on: '2026-11-09', confirmed: true })
    await expect(changeTerms(st, a, { kg: 5, price: 11500, day_of_week: 5, confirmed: true }, '2026-11-16')).rejects.toThrow('NOTHING CHANGED')
    await expect(changeTerms(st, a, { kg: 6, price: 11500, day_of_week: 5, confirmed: true }, '2026-11-17')).rejects.toThrow('MONDAY')
    await expect(changeTerms(st, a, { kg: 0, price: 11500, day_of_week: 5, confirmed: true }, '2026-11-16')).rejects.toThrow('KG')
    await expect(changeTerms(st, a, { kg: 6, price: null, day_of_week: 5, confirmed: true }, '2026-11-16')).rejects.toThrow('₡')
    await expect(endOrder(st, a, '2026-11-01')).rejects.toThrow('BEFORE THE ORDER STARTED')
    await expect(restartOrder(st, a, '2026-11-16')).rejects.toThrow('STILL RUNNING')
    await expect(setWeekKg(st, a, '2026-11-10', 3, null, [])).rejects.toThrow('MONDAY')
    await expect(setWeekKg(st, a, '2026-11-02', 3, null, [])).rejects.toThrow('DOES NOT DELIVER')
    await expect(setWeekKg(st, a, '2026-11-09', -1, null, [])).rejects.toThrow('0 OR MORE')
    await expect(createOrder(st, { buyer: '', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 5, price: 11500, day_of_week: 5, start_on: '2026-11-09', confirmed: true })).rejects.toThrow('BUYER')
    expect(od(st)).toHaveLength(1)
    expect(wk(st)).toHaveLength(0)
    await st.action('END', () => endOrder(st, a, '2026-11-20'))
    await expect(endOrder(st, od(st)[0], '2026-11-27')).rejects.toThrow('ALREADY ENDS EARLIER')
    await expect(restartOrder(st, od(st)[0], '2026-11-16')).rejects.toThrow('RAN UNTIL')
    await expect(changeTerms(st, od(st)[0], { kg: 9, price: 11500, day_of_week: 5, confirmed: true }, '2026-11-30')).rejects.toThrow('ALREADY ENDED')
  })

  it('a change before the order has started edits it in place; notes and delete', async () => {
    const st = await mk()
    const a = await createOrder(st, { buyer: 'X', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 5, price: 11500, day_of_week: 5, start_on: '2026-11-16', confirmed: false })
    const r = await changeTerms(st, a, { kg: 7, price: 12000, day_of_week: 4, confirmed: true }, '2026-11-09')
    expect(od(st)).toHaveLength(1)
    expect(r.id).toBe(a.id)
    expect(od(st)[0]).toMatchObject({ kg: 7, price_crc_per_kg: 12000, day_of_week: 4, confirmed: true, start_on: '2026-11-16' })
    await setNote(st, od(st)[0], '  PAYS CASH AT THE DOOR ')
    expect(od(st)[0].notes).toBe('PAYS CASH AT THE DOOR')
    await setNote(st, od(st)[0], 'PAYS CASH AT THE DOOR') // no change, no write
    await st.action('WEEK', () => setWeekKg(st, od(st)[0], '2026-11-16', 3, null, wk(st)))
    await st.action('DEL', () => deleteOrder(st, od(st)[0], wk(st)))
    expect(od(st)).toHaveLength(0)
    expect(wk(st)).toHaveLength(0)
    await st.undo()
    expect(od(st)).toHaveLength(1)
    expect(wk(st)).toHaveLength(1) // the order and its week change come back together
  })
})

describe('mock trial: deliveries become sales paid on the day', () => {
  it('deliver a line, a short delivery, all for a day, refuse doubles, undo, and the fill rate', async () => {
    const st = await mk()
    const casa = await createOrder(st, { buyer: 'Casa Verde', channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', kg: 10, price: 11500, day_of_week: 5, start_on: '2026-11-09', confirmed: true })
    const brisa = await createOrder(st, { buyer: 'Brisa', channel: 'shop', species_key: 'lions-mane', form: 'fresh', kg: 4, price: 13800, day_of_week: 5, start_on: '2026-11-09', confirmed: true })
    await createOrder(st, { buyer: 'Mar', channel: 'market', species_key: 'blue-oyster', form: 'fresh', kg: 3, price: 11500, day_of_week: 6, start_on: '2026-11-09', confirmed: false })
    const lines = () => orderLines(od(st), wk(st), '2026-11-09')
    const L = (id: string) => lines().find((l) => l.order.id === id)!
    expect(fillRate(lines(), sales(st))).toMatchObject({ orderedKg: 17, deliveredKg: 0, pct: 0, lines: 3, done: 0 })
    // Casa: 9.5 kg delivered instead of 10 -> 9.5 x 11,500 = 109,250
    const s = await st.action('DELIVER CASA', () => deliverLine(st, L(casa.id), sales(st), 9.5, '2026-11-13', ['B1020']))
    expect(s).toMatchObject({ order_id: casa.id, buyer: 'Casa Verde', kg: 9.5, amount_crc: 109250, sold_on: '2026-11-13', species_key: 'blue-oyster', channel: 'restaurant', lot_codes: ['B1020'] })
    expect(deliveredFor(L(casa.id), sales(st))).toHaveLength(1)
    await expect(st.action('AGAIN', () => deliverLine(st, L(casa.id), sales(st)))).rejects.toThrow('ALREADY HAS A DELIVERY')
    await expect(st.action('ZERO', () => deliverLine(st, L(brisa.id), sales(st), 0))).rejects.toThrow('KG DELIVERED')
    // all the rest for Friday + Saturday in ONE undo step: Brisa 4 x 13,800 = 55,200; Mar 3 x 11,500 = 34,500
    const n = await st.action('DELIVER ALL', () => deliverAll(st, lines(), sales(st)))
    expect(n).toBe(2)
    expect(sales(st)).toHaveLength(3)
    const f = fillRate(lines(), sales(st))
    expect(f.done).toBe(3)
    close(f.deliveredKg, 9.5 + 4 + 3, 8)
    expect(f.deliveredCrc).toBe(109250 + 55200 + 34500)
    close(f.pct as number, (16.5 / 17) * 100, 6)
    await expect(st.action('NONE', () => deliverAll(st, lines(), sales(st)))).rejects.toThrow('NOTHING LEFT')
    expect(await st.undo()).toBe('DELIVER ALL')
    expect(sales(st)).toHaveLength(1)
    expect(await st.undo()).toBe('DELIVER CASA')
    expect(sales(st)).toHaveLength(0)
    // the sale is in the edit history, tied to the order
    const h = await histories(st)
    expect(h.some((e) => e.table_name === 'sales' && e.op === 'create' && e.changes.some((c) => c.f === 'order_id' && c.new === casa.id))).toBe(true)
    // a week changed to 0 kg after a delivery still counts what went out
    const o1 = await createOrder(st, { buyer: 'Tarde', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 2, price: 11500, day_of_week: 5, start_on: '2026-11-09', confirmed: true })
    await st.action('D', () => deliverLine(st, L(o1.id), sales(st)))
    await st.action('SKIP AFTER', () => setWeekKg(st, o1, '2026-11-09', 0, null, wk(st)))
    expect(fillRate(lines(), sales(st)).deliveredKg).toBe(2)
    await st.undo()
    await st.undo()
    await st.action('DELETE', () => deleteOrder(st, od(st).find((o) => o.id === o1.id)!, wk(st)))
    // a delivery in another week does not count for this week
    const other = await createOrder(st, { buyer: 'Otro', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 2, price: 11500, day_of_week: 5, start_on: '2026-11-09', confirmed: true })
    await st.action('NEXT WEEK', () => deliverLine(st, orderLines(od(st), wk(st), '2026-11-16').find((l) => l.order.id === other.id)!, sales(st)))
    expect(deliveredFor(L(other.id), sales(st))).toHaveLength(0)
    expect(weekValue(lines())).toBe(115000 + 55200 + 34500 + 23000)
  })
})

describe('historical resilience: two years of weekly orders', () => {
  it('every week keeps its own price and kg after later changes, setting changes, reload and backup restore', async () => {
    const st = await mk()
    // Casa Verde: from 6 Jan 2025, 10 kg at 11,000 each Friday; from week 52 (5 Jan 2026) 12 kg at 11,500.
    const a = await createOrder(st, { buyer: 'Casa Verde', channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', kg: 10, price: 11000, day_of_week: 5, start_on: '2025-01-06', confirmed: true })
    const b = await changeTerms(st, a, { kg: 12, price: 11500, day_of_week: 5, confirmed: true }, '2026-01-05')
    // Brisa: lion's mane 4 kg at 13,000 from week 9 (10 Mar 2025) until week 60 (ended), then a different buyer Mar takes over at 14,000.
    const w9 = '2025-03-10'
    const c = await createOrder(st, { buyer: 'Brisa', channel: 'shop', species_key: 'lions-mane', form: 'fresh', kg: 4, price: 13000, day_of_week: 3, start_on: w9, confirmed: true })
    await endOrder(st, c, '2026-03-04') // Wednesday of week 60 (2026-03-02)
    await createOrder(st, { buyer: 'Mar', channel: 'market', species_key: 'lions-mane', form: 'fresh', kg: 4, price: 14000, day_of_week: 6, start_on: '2026-03-09', confirmed: false })
    // holiday skips for Casa in week 51 (2025-12-29, old terms) and week 70
    await setWeekKg(st, od(st).find((o) => o.id === a.id)!, '2025-12-29', 0, 'HOLIDAY', wk(st))
    await setWeekKg(st, b, '2026-05-11', 6, null, wk(st))
    const expectWeek = (w: number): number => {
      let v = 0
      if (w < 52) v += w === 51 ? 0 : 10 * 11000
      else v += (w === 70 ? 6 : 12) * 11500
      if (w >= 9 && w <= 60) v += 4 * 13000
      if (w >= 61) v += 4 * 14000
      return v
    }
    const check = (rows: StandingOrder[], weeks: OrderWeek[]) => {
      for (let w = 0; w < 110; w++) {
        const mon = new Date(Date.UTC(2025, 0, 6) + w * 7 * 86400000).toISOString().slice(0, 10)
        expect(weekValue(orderLines(rows, weeks, mon)), `week ${w} (${mon})`).toBe(expectWeek(w))
      }
    }
    check(od(st), wk(st))
    // The list price changes, the practice settings change, nothing in the past moves.
    const rows = od(st)
    expect(rows).toHaveLength(4)
    // Reload: a new Store on the same backend sees the same rows.
    const json = await st.exportJson()
    const st2 = new Store(new MemoryBackend())
    await st2.importJson(json)
    await st2.ensure('standing_orders')
    await st2.ensure('order_weeks')
    check(st2.rows<StandingOrder>('standing_orders'), st2.rows<OrderWeek>('order_weeks'))
    expect(JSON.parse(json).tables.standing_orders).toHaveLength(4)
    expect(JSON.parse(json).tables.order_weeks).toHaveLength(2)
    // Importing the same backup again changes nothing.
    await st2.importJson(json)
    expect(st2.rows('standing_orders')).toHaveLength(4)
  })

  it('the cap and shares are computed per week, so a buyer who left no longer counts', () => {
    const orders = [order('1', 'A', { kg: 10, start_on: '2026-01-05', end_on: '2026-06-05' }), order('2', 'B', { kg: 10, start_on: '2026-01-05' }), order('3', 'C', { kg: 10, start_on: '2026-01-05' })]
    const before = dependence(orderLines(orders, [], '2026-06-01'), 30)
    const after = dependence(orderLines(orders, [], '2026-06-08'), 30)
    expect(before.buyers).toBe(3)
    expect(after.buyers).toBe(2)
    close(before.rows[0].sharePct, 33.3333, 3)
    close(after.rows[0].sharePct, 50, 8)
  })
})

describe('forecast at scale and over time', () => {
  it('lots that finish and new lots keep the forecast consistent as days pass', () => {
    // One lot, walk "today" from before the window to after it with picks logged each day: kg to come never goes negative,
    // total (picked + to come) stays the expected kg until the window ends, and the lot ends DONE or PAST WINDOW.
    const expected = 40 * BLUE
    const picks: Harvest[] = []
    let day = '2026-11-01'
    let n = 0
    for (let i = 0; i < 30; i++) {
      const rec = allRecords([lot('A', 'B1020')], [], picks, [])[0]
      const fc = forecastLot(rec, figuresFor('blue-oyster', []), day)
      expect(fc.remainingKg).toBeGreaterThanOrEqual(0)
      if (fc.flag === 'WAIT' || fc.flag === 'DUE' || fc.flag === 'PICKING') close(fc.pickedKg + fc.remainingKg, expected, 8)
      // pick what was forecast for today, from the window's first day
      if (fc.from === day && fc.remainingKg > 0) picks.push(harv(`h${n++}`, 'A', day, kgBetween(fc, day, day)))
      day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
    }
    const end = forecastLot(allRecords([lot('A', 'B1020')], [], picks, [])[0], figuresFor('blue-oyster', []), day)
    expect(['DONE', 'PAST WINDOW']).toContain(end.flag)
    close(picks.reduce((s, h) => s + h.kg, 0), expected, 6)
  })

  it('10,000 lots and 5,000 orders: exact totals, quick', () => {
    const t0 = Date.now()
    const lots: BlockLot[] = []
    for (let i = 0; i < 10000; i++)
      lots.push(lot(`L${i}`, `B${i}`, { bag_count: 40, knock_date: new Date(Date.UTC(2026, 9, 1) + (i % 40) * 86400000).toISOString().slice(0, 10), status: i % 5 === 0 ? 'spent' : 'fruiting' }))
    const fc = forecastAll(allRecords(lots, [], [], []), NOW)
    const live = lots.filter((l) => l.status === 'fruiting').length
    expect(fc).toHaveLength(live)
    // every live lot is blue oyster with 40 blocks: total expected = live x 40 x BLUE, and each lot's remaining <= expected
    const exp = live * 40 * BLUE
    close(fc.reduce((n, f) => n + f.expectedKg, 0), exp, 3)
    expect(fc.every((f) => f.remainingKg <= f.expectedKg + 1e-9)).toBe(true)
    const weeks = forecastWeeks(fc, NOW, 3)
    expect(weeks.every((w) => w.totalKg >= 0)).toBe(true)
    const orders: StandingOrder[] = Array.from({ length: 5000 }, (_, i) => order(`o${i}`, `Buyer ${i % 400}`, { kg: 1 + (i % 7), price_crc_per_kg: 10000 + (i % 5) * 500 }))
    const lines = orderLines(orders, [], '2026-11-09')
    expect(lines).toHaveLength(5000)
    let kg = 0
    let crc = 0
    for (let i = 0; i < 5000; i++) {
      kg += 1 + (i % 7)
      crc += (1 + (i % 7)) * (10000 + (i % 5) * 500)
    }
    const d = dependence(lines, 30)
    expect(d.totalKg).toBe(kg)
    expect(d.totalCrc).toBe(crc)
    expect(d.buyers).toBe(400)
    expect(d.rows.reduce((n, r) => n + r.sharePct, 0)).toBeCloseTo(100, 6)
    expect(Date.now() - t0).toBeLessThan(8000)
  })
})

describe('data kept in the backup list', () => {
  it('both new tables are backed up and restored', async () => {
    const st = await mk()
    const a = await createOrder(st, { buyer: 'X', channel: 'shop', species_key: 'blue-oyster', form: 'fresh', kg: 5, price: 11500, day_of_week: 5, start_on: '2026-11-09', confirmed: true })
    await setWeekKg(st, a, '2026-11-09', 2, 'LESS', [])
    const json = JSON.parse(await st.exportJson()) as { tables: Record<string, Row[]> }
    expect(Object.keys(json.tables)).toEqual(expect.arrayContaining(['standing_orders', 'order_weeks']))
    expect(json.tables.order_weeks[0].id).toBe(`${a.id}:2026-11-09`)
  })
})

describe("Catawba's picking windows (Joseph, 9 Nov 2026: Catawba is the baseline)", () => {
  it('the real data uses the 90th percentile first-to-last pick from the 2026 harvest log', async () => {
    const real = await vi.importActual<typeof import('../data/ledger')>('../data/ledger')
    expect(real.ROOM_DAYS['blue-oyster']).toEqual({ first: 23, pick: 3 })
    expect(real.ROOM_DAYS['lions-mane']).toEqual({ first: 24, pick: 4 })
    expect(real.ROOM_DAYS['comb-tooth']).toEqual({ first: 31, pick: 3 })
    expect(real.ROOM_DAYS['golden-oyster']).toEqual({ first: 26.5, pick: 6 })
    expect(real.ROOM_DAYS_OTHER.pick).toBe(5)
  })
})
