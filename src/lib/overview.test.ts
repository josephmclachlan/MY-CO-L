// Deck overview figures and COLD STORE, checked against a small farm worked out by hand.
import { describe, expect, it } from 'vitest'
import { cohort, coldStore, contamByStrain, costPerKgParts, dueGroups, lastWeeks, ordersDue, pipeline, planKgPerWeek, salesByDay, topBuyers, weeklyKg, weeklySales } from './overview'
import type { Harvest, WeekCost } from './ledger'
import type { LotLoss } from './hazard'
import type { OrderWeek, StandingOrder } from './orders'
import { expectFor } from './mission'
import type { Sale } from './trade'
import type { WasteEntry } from './money'
import type { BlockLot, Strain } from './xeno'
import type { Reminder } from './facility'

// Wednesday 11 Nov 2026. Its week starts Monday 9 Nov.
const TODAY = '2026-11-11'

const lot = (id: string, species: string, bags: number, status: BlockLot['status'], knock: string): BlockLot =>
  ({ id, lot_code: id.toUpperCase(), species_key: species, strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: bags, knock_date: knock, status, notes: null }) as BlockLot
const pick = (id: string, lotId: string, day: string, kg: number): Harvest => ({ id, block_lot_id: lotId, harvested_on: day, flush: 1, kg, grade: null, initials: null, notes: null }) as Harvest
const sale = (id: string, day: string, kg: number, crc: number, extra: Partial<Sale> = {}): Sale =>
  ({ id, sold_on: day, buyer: 'SODA LUZ', channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', grade: null, kg, amount_crc: crc, lot_codes: null, notes: null, ...extra }) as Sale
const waste = (id: string, day: string, kg: number, species = 'blue-oyster'): WasteEntry => ({ id, logged_on: day, species_key: species, kg, route: 'compost', lot_codes: null, notes: null }) as WasteEntry

describe('weeks', () => {
  it('lists the Mondays of the last weeks, oldest first, ending this week', () => {
    expect(lastWeeks(TODAY, 3)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
  })
  it('adds kg picked per week, and ignores picks outside the window', () => {
    const h = [pick('a', 'l1', '2026-11-09', 2), pick('b', 'l1', '2026-11-11', 1.5), pick('c', 'l1', '2026-11-08', 4), pick('d', 'l1', '2026-01-01', 99)]
    expect(weeklyKg(h, TODAY, 2)).toEqual([
      { week: '2026-11-02', kg: 4 },
      { week: '2026-11-09', kg: 3.5 },
    ])
  })
  it('adds sales per week and leaves written-off sales out', () => {
    const s = [sale('a', '2026-11-10', 1, 10000), sale('b', '2026-11-03', 1, 12000), sale('c', '2026-11-10', 1, 5000, { pay_status: 'written_off' })]
    expect(weeklySales(s, TODAY, 2)).toEqual([
      { week: '2026-11-02', crc: 12000 },
      { week: '2026-11-09', crc: 10000 },
    ])
  })
  it('puts this week beside last week, day by day', () => {
    const s = [sale('a', '2026-11-09', 1, 10000), sale('b', '2026-11-02', 1, 8000), sale('c', '2026-11-04', 1, 6000)]
    const d = salesByDay(s, TODAY)
    expect(d.map((x) => x.name)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
    expect(d[0]).toMatchObject({ day: '2026-11-09', now: 10000, last: 8000, future: false })
    expect(d[2]).toMatchObject({ day: '2026-11-11', now: 0, last: 6000, future: false })
    expect(d[3].future).toBe(true)
  })
  it('ranks buyers by colones over 30 days, with no buyer as WALK-IN', () => {
    const s = [sale('a', '2026-11-01', 2, 20000), sale('b', '2026-11-05', 1, 9000, { buyer: 'FERIA' }), sale('c', '2026-10-01', 9, 90000, { buyer: 'OLD' }), sale('d', '2026-11-10', 1, 30000, { buyer: null })]
    expect(topBuyers(s, TODAY)).toEqual([
      { buyer: 'WALK-IN', crc: 30000, kg: 1 },
      { buyer: 'SODA LUZ', crc: 20000, kg: 2 },
      { buyer: 'FERIA', crc: 9000, kg: 1 },
    ])
  })
})

describe('COLD STORE', () => {
  const lots = [lot('l1', 'blue-oyster', 10, 'fruiting', '2026-10-01'), lot('l2', 'lions-mane', 10, 'fruiting', '2026-10-01')]
  it('counts picked minus sold minus written off, oldest picks first', () => {
    // Blue oyster: 5 kg on the 6th, 4 kg on the 10th = 9 kg. Sold 3 on the 8th (from the 6th), wasted 1 on the 10th (from the 6th).
    // Left: 1 kg from the 6th (5 days old) and 4 kg from the 10th (1 day old) = 5 kg on hand, oldest 5 days.
    const h = [pick('a', 'l1', '2026-11-06', 5), pick('b', 'l1', '2026-11-10', 4)]
    const c = coldStore(h, lots, [sale('s', '2026-11-08', 3, 30000)], [waste('w', '2026-11-10', 1)], TODAY, 7)
    expect(c.onHand).toBeCloseTo(5)
    expect(c.oldest).toBe(5)
    expect(c.stale).toBe(0)
    const bo = c.species[0]
    expect(bo).toMatchObject({ species: 'blue-oyster', picked7: 9, sold7: 3, wasted7: 1 })
    expect(bo.batches).toEqual([
      { day: '2026-11-06', kg: 1, age: 5 },
      { day: '2026-11-10', kg: 4, age: 1 },
    ])
  })
  it('moves picks past the shelf life out of ON HAND and into STALE', () => {
    const h = [pick('a', 'l1', '2026-11-01', 6), pick('b', 'l1', '2026-11-11', 2)]
    const c = coldStore(h, lots, [sale('s', '2026-11-02', 2, 20000)], [], TODAY, 7)
    expect(c.onHand).toBeCloseTo(2)
    expect(c.stale).toBeCloseTo(4)
    expect(c.oldest).toBe(0)
  })
  it('never takes a fresh sale from a pick already past its shelf life that day', () => {
    // A gap in old records: 5 kg picked 20 Oct were never logged. Tuesday's sale comes off Monday's pick.
    const h = [pick('old', 'l1', '2026-10-20', 5), pick('mon', 'l1', '2026-11-09', 4)]
    const c = coldStore(h, lots, [sale('s', '2026-11-10', 3, 30000)], [], TODAY, 7)
    expect(c.onHand).toBeCloseTo(1)
    expect(c.species[0].batches).toEqual([{ day: '2026-11-09', kg: 1, age: 2 }])
    // 22 days old today: past the 7-day shelf life and inside the 30-day STALE window.
    expect(c.stale).toBeCloseTo(5)
  })
  it('lets surplus or waste clear picks that went off, oldest first', () => {
    const h = [pick('a', 'l1', '2026-11-01', 3), pick('b', 'l1', '2026-11-10', 2)]
    const c = coldStore(h, lots, [], [waste('w', '2026-11-10', 3)], TODAY, 7)
    expect(c.stale).toBe(0)
    expect(c.onHand).toBeCloseTo(2)
  })
  it('leaves out picks that went off more than 30 days ago', () => {
    // 1 Sep is 71 days ago: shelf life 7 + window 30 = 37 days, so neither on hand nor stale.
    const c = coldStore([pick('a', 'l1', '2026-09-01', 10), pick('b', 'l1', '2026-10-10', 2)], lots, [], [], TODAY, 7)
    expect(c.onHand).toBe(0)
    expect(c.stale).toBeCloseTo(2)
  })
  it('never takes a sale from a pick made after it, and ignores dried sales and other species', () => {
    const h = [pick('a', 'l1', '2026-11-10', 3), pick('b', 'l2', '2026-11-10', 2)]
    const s = [sale('early', '2026-11-05', 5, 50000), sale('dried', '2026-11-10', 1, 30000, { form: 'dried' })]
    const c = coldStore(h, lots, s, [], TODAY, 7)
    expect(c.species.find((x) => x.species === 'blue-oyster')!.onHand).toBeCloseTo(3)
    expect(c.species.find((x) => x.species === 'lions-mane')!.onHand).toBeCloseTo(2)
    expect(c.onHand).toBeCloseTo(5)
  })
  it('selling more than was picked leaves nothing on hand, never less than zero', () => {
    const c = coldStore([pick('a', 'l1', '2026-11-10', 1)], lots, [sale('s', '2026-11-10', 4, 40000)], [], TODAY, 7)
    expect(c.onHand).toBe(0)
    expect(c.species[0].onHand).toBe(0)
  })
  it('stress: 3,000 random picks, sales and waste keep on hand + stale within what was picked', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const h: Harvest[] = []
    const s: Sale[] = []
    const w: WasteEntry[] = []
    for (let i = 0; i < 1000; i++) {
      const day = `2026-${String(9 + Math.floor(rnd() * 3)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`
      h.push(pick(`h${i}`, rnd() < 0.5 ? 'l1' : 'l2', day, Math.round(rnd() * 80) / 10))
      s.push(sale(`s${i}`, day, Math.round(rnd() * 50) / 10, 1000, { species_key: rnd() < 0.5 ? 'blue-oyster' : 'lions-mane' }))
      w.push(waste(`w${i}`, day, Math.round(rnd() * 10) / 10, rnd() < 0.5 ? 'blue-oyster' : 'lions-mane'))
    }
    const t0 = Date.now()
    const c = coldStore(h, lots, s, w, TODAY, 7)
    expect(Date.now() - t0).toBeLessThan(3000)
    const picked = h.filter((x) => x.harvested_on <= TODAY).reduce((t, x) => t + x.kg, 0)
    expect(c.onHand).toBeGreaterThanOrEqual(0)
    expect(c.onHand + c.stale).toBeLessThanOrEqual(picked + 1e-6)
    for (const sp of c.species) for (const b of sp.batches) expect(b.age).toBeLessThan(7)
  })
})

describe('BRIDGE work list', () => {
  const r = (key: string, due: string | null, warn = false): Reminder => ({ key, kind: 'CUSTOM', text: key, warn, due, go: null }) as Reminder
  it('groups by urgency: overdue, today, this week, later', () => {
    const g = dueGroups([r('late', '2026-11-01'), r('now', null), r('alarm', null, true), r('today', TODAY), r('fri', '2026-11-13'), r('next', '2026-11-30')], TODAY)
    expect(g.overdue.map((x) => x.key)).toEqual(['late', 'alarm'])
    expect(g.today.map((x) => x.key)).toEqual(['now', 'today'])
    expect(g.week.map((x) => x.key)).toEqual(['fri'])
    expect(g.later.map((x) => x.key)).toEqual(['next'])
  })
})

describe('GROW DECK pipeline', () => {
  it('counts surviving blocks per stage and recent losses', () => {
    const lots = [lot('a', 'blue-oyster', 20, 'incubating', '2026-11-03'), lot('b', 'blue-oyster', 30, 'fruiting', '2026-10-13'), lot('c', 'blue-oyster', 10, 'spent', '2026-09-01'), lot('d', 'blue-oyster', 8, 'lost', '2026-10-20'), lot('e', 'pink-oyster', 12, 'spent', '2026-01-05')]
    const lost = new Map([['a', 2], ['b', 3], ['d', 2]])
    const p = pipeline(lots, lost, TODAY, 90)
    expect(p.incubating).toBe(18)
    expect(p.fruiting).toBe(27)
    // In the 90 days: a 20 (2 lost), b 30 (3 lost), c 10 spent, d 8 all lost = 68 started, 13 lost.
    expect(p.lost).toBe(13)
    expect(p.spent).toBe(10)
    expect(p.lostPct).toBeCloseTo((13 / 68) * 100)
  })
})

describe('GROW DECK blocks of the last 90 days', () => {
  it('splits every block knocked in the window by where it is now, adding up to the blocks knocked', () => {
    const lots = [lot('a', 'blue-oyster', 20, 'incubating', '2026-11-03'), lot('b', 'blue-oyster', 30, 'fruiting', '2026-10-13'), lot('c', 'blue-oyster', 10, 'spent', '2026-09-01'), lot('d', 'blue-oyster', 8, 'lost', '2026-10-20'), lot('e', 'pink-oyster', 12, 'spent', '2026-01-05')]
    // a: 18 incubating + 2 lost. b: 27 fruiting + 3 lost. c: 10 spent. d: all 8 lost (marked LOST). e: before the window.
    const c = cohort(lots, new Map([['a', 2], ['b', 3], ['d', 2]]), TODAY, 90)
    expect(c).toEqual({ incubating: 18, fruiting: 27, spent: 10, lost: 13, started: 68 })
    expect(c.incubating + c.fruiting + c.spent + c.lost).toBe(c.started)
  })
})

describe('XENOLAB contamination per strain', () => {
  it('counts blocks lost over blocks knocked in the last 90 days, a LOST lot in full, worst first', () => {
    const strains = [
      { id: 's1', code: 'BO-01', species_key: 'blue-oyster', active: true },
      { id: 's2', code: 'LM-01', species_key: 'lions-mane', active: true },
      { id: 's3', code: 'PO-01', species_key: 'pink-oyster', active: true },
    ] as Strain[]
    const withStrain = (l: BlockLot, strain: string) => ({ ...l, strain_id: strain }) as BlockLot
    const lots = [
      withStrain(lot('a', 'blue-oyster', 20, 'fruiting', '2026-10-01'), 's1'),
      withStrain(lot('b', 'blue-oyster', 10, 'lost', '2026-11-03'), 's1'),
      withStrain(lot('c', 'lions-mane', 25, 'fruiting', '2026-09-20'), 's2'),
      withStrain(lot('d', 'lions-mane', 30, 'spent', '2026-05-01'), 's2'),
    ]
    const loss = (id: string, lotId: string, bags: number) => ({ id, block_lot_id: lotId, bag_count: bags, hazard_key: null, cause: null, noted_on: TODAY, notes: null }) as LotLoss
    // BO-01: 20 + 10 = 30 knocked; 2 lost from a, all 10 of b (marked LOST) = 12 lost = 40%.
    // LM-01: only c is in the window (d was knocked in May): 25 knocked, none lost = 0%. PO-01 has no lots.
    const c = contamByStrain(strains, lots, [loss('x', 'a', 2), loss('y', 'b', 3), loss('z', 'd', 30)], TODAY)
    expect(c.map((r) => r.code)).toEqual(['BO-01', 'LM-01'])
    expect(c[0]).toMatchObject({ lots: 2, blocks: 30, lost: 12 })
    expect(c[0].pct).toBeCloseTo(40)
    expect(c[1]).toMatchObject({ lots: 1, blocks: 25, lost: 0, pct: 0 })
  })
})

describe('TRADE DOCK orders still to deliver', () => {
  const order = (id: string, species: string, kg: number, day: number, extra: Partial<StandingOrder> = {}): StandingOrder =>
    ({ id, buyer: 'SODA LUZ', channel: 'restaurant', species_key: species, form: 'fresh', kg, price_crc_per_kg: 13000, day_of_week: day, start_on: '2026-10-01', end_on: null, confirmed: true, prev_id: null, notes: null, ...extra }) as StandingOrder
  it('adds this week\'s fresh kilos from today on, with this week\'s changes, per species', () => {
    // Week of Monday 9 Nov. Today is Wednesday 11 Nov.
    const orders = [
      order('o1', 'blue-oyster', 5, 5), // Friday 13: 5 kg still to go
      order('o2', 'lions-mane', 3, 1), // Monday 9: already past
      order('o3', 'blue-oyster', 2, 5, { form: 'dried' }), // dried: not from the cold store
      order('o4', 'blue-oyster', 4, 4), // Thursday 12, changed to 1.5 kg this week
      order('o5', 'pink-oyster', 2, 6, { start_on: '2026-11-20' }), // starts later
    ]
    const weeks = [{ id: 'w1', order_id: 'o4', week_start: '2026-11-09', kg: 1.5, note: null }] as OrderWeek[]
    const due = ordersDue(orders, weeks, TODAY)
    expect([...due.keys()]).toEqual(['blue-oyster'])
    expect(due.get('blue-oyster')).toBeCloseTo(6.5)
  })
})

describe('GROW DECK plan line', () => {
  it('multiplies blocks a week by the species kg per block, and skips species with no figure', () => {
    const per = expectFor('blue-oyster').kgPerBlock as number
    expect(per).toBeGreaterThan(0)
    expect(planKgPerWeek([{ key: 'blue-oyster', bags: 10 }, { key: 'no-such-species', bags: 5 }])).toBeCloseTo(10 * per)
    expect(planKgPerWeek([{ key: 'no-such-species', bags: 5 }])).toBeNull()
  })
})

describe('BURSAR cost per kg', () => {
  const part = (crc: number) => ({ crc, basis: 'ACTUAL' as const, notes: [] })
  const week = (w: string, kg: number, partial: boolean, c: [number, number, number, number, number]): WeekCost =>
    ({
      week: w,
      lots: [{ partial }],
      species: [],
      all: { kg, parts: { consumables: part(c[0]), cook: part(c[1]), room: part(c[2]), labour: part(c[3]), wear: part(c[4]) } },
    }) as unknown as WeekCost
  it('uses the newest weeks that are done picking, kilos weighted', () => {
    // Newest week still picking: left out. The two done weeks: 30 kg for 60,000 = 2,000 a kg.
    // Consumables 32,000 / 30 = 1,066.67; cook 6,000 / 30 = 200; room 9,000 / 30 = 300; labour 13,000 / 30 = 433.33.
    const weeks = [week('2026-11-02', 10, true, [9e9, 0, 0, 0, 0]), week('2026-10-26', 20, false, [20000, 4000, 6000, 10000, 0]), week('2026-10-19', 10, false, [12000, 2000, 3000, 3000, 0])]
    const c = costPerKgParts(weeks)!
    expect(c.weeks).toBe(2)
    expect(c.partial).toBe(false)
    expect(c.kg).toBe(30)
    expect(c.perKg).toBeCloseTo(2000)
    expect(c.parts.consumables).toBeCloseTo(1066.67, 1)
    expect(c.parts.cook).toBeCloseTo(200)
    expect(c.parts.room).toBeCloseTo(300)
    expect(c.parts.labour).toBeCloseTo(433.33, 1)
    expect(c.parts.wear).toBe(0)
  })
  it('falls back to weeks still picking, says so, and gives nothing without picks', () => {
    const c = costPerKgParts([week('2026-11-02', 4, true, [4000, 0, 0, 0, 0])])!
    expect(c).toMatchObject({ weeks: 1, partial: true, kg: 4 })
    expect(c.perKg).toBeCloseTo(1000)
    expect(costPerKgParts([week('2026-11-02', 0, true, [4000, 0, 0, 0, 0])])).toBeNull()
  })
})
