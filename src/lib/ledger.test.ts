import { describe, expect, it } from 'vitest'
import { BILL_ESTIMATE } from '../data/ledger'
import { DEFAULT_RATES, iceBill, mergeRates, salePrice, setLiveRates } from './rates'
import { buildLedger, DEFAULT_LEDGER_PREFS, mergeBasis, planRoomRate, planWeek, weekOf, costPerKg, type LedgerInput, type LedgerLot } from './ledger'
import type { CookRun } from './cook'

const lot = (p: Partial<LedgerLot> & { id: string }): LedgerLot => ({ lot_code: 'B1103', species_key: 'blue-oyster', bag_count: 100, knock_date: '2026-11-03', status: 'incubating', ...p })
const empty = (lots: LedgerLot[], more: Partial<LedgerInput> = {}): LedgerInput => ({
  lots, losses: [], harvests: [], items: [], prices: [], moves: [], cooks: [], bills: [], labour: [], prefs: DEFAULT_LEDGER_PREFS, ...more,
})

describe('ICE bill', () => {
  it('matches the electrical package range at the central case', () => {
    // Package: 4,762 kWh, 8.78 kW off peak (10 kW billed) -> ₡362k; heater on a peak adds 6.5 kW (15.28) -> ₡422k.
    expect(iceBill(BILL_ESTIMATE.kwh, 8.78) / 1000).toBeCloseTo(362, -1)
    expect(iceBill(BILL_ESTIMATE.kwh, 15.28) / 1000).toBeCloseTo(422, -1)
  })
  it('bills a 10 kW minimum', () => {
    expect(iceBill(4000, 2)).toBe(iceBill(4000, 10))
  })
})

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(weekOf('2026-11-03')).toBe('2026-11-02') // Tuesday
    expect(weekOf('2026-11-08')).toBe('2026-11-02') // Sunday
    expect(weekOf('2026-11-09')).toBe('2026-11-09')
  })
  it('merges bases', () => {
    expect(mergeBasis('NONE', 'ACTUAL')).toBe('ACTUAL')
    expect(mergeBasis('ACTUAL', 'ESTIMATE')).toBe('MIXED')
  })
})

describe('ledger', () => {
  it('uses stock moves at the last price and splits by bags', () => {
    const items = [{ id: 'i1', code: 'SAWDUST', name: 'Sawdust', category: null, unit: 'kg', reorder_point: null, lead_time_days: null, supplier: null, room: null, use_per_week: null, notes: null }]
    const prices = [
      { id: 'p1', item_id: 'i1', priced_on: '2026-10-01', price_crc: 100, supplier: null },
      { id: 'p2', item_id: 'i1', priced_on: '2026-11-01', price_crc: 200, supplier: null },
    ]
    const moves = [{ id: 'm1', item_id: 'i1', moved_at: '2026-11-02T15:00:00Z', qty: -150, reason: 'run', run_ref: null, notes: null }]
    const l = buildLedger(empty([lot({ id: 'a', bag_count: 100 }), lot({ id: 'b', species_key: 'lions-mane', bag_count: 50 })], { items, prices, moves }))
    const w = l.weeks[0]
    expect(w.all.parts.consumables.crc).toBeCloseTo(30000)
    expect(w.all.parts.consumables.basis).toBe('ACTUAL')
    const blue = w.species.find((s) => s.key === 'blue-oyster')!
    expect(blue.parts.consumables.crc).toBeCloseTo(20000)
  })

  it('falls back to estimates with no data, and tags them', () => {
    const l = buildLedger(empty([lot({ id: 'a' })]))
    const c = l.weeks[0].all
    expect(c.parts.consumables.basis).toBe('NONE') // no prices yet
    expect(c.parts.cook.basis).toBe('ESTIMATE')
    expect(c.parts.room.basis).toBe('ESTIMATE')
    expect(c.kgBasis).toBe('ESTIMATE')
    expect(c.kg).toBeCloseTo(100 * 2.03 * 0.45359237)
    expect(c.parts.labour.crc).toBe(0)
  })

  it('room energy with a real bill is the bill less cook runs, shared by bag-days', () => {
    const cook = { id: 'c1', kind: 'steam_box', started_at: '2026-11-02T14:00:00Z', cost_crc: 1000 } as unknown as CookRun
    const bills = [{ id: 'e1', month: '2026-11-01', kwh: 4000, billed_kw: 12, total_crc: 300000, notes: null }]
    const l = buildLedger(empty([lot({ id: 'a' }), lot({ id: 'b', knock_date: '2026-11-10' })], { bills, cooks: [cook] }))
    const nov = l.months.find((m) => m.month === '2026-11')!
    expect(nov.billBasis).toBe('ACTUAL')
    expect(nov.room).toBeCloseTo(300000 - 1160)
    const novRoom = l.weeks.flatMap((w) => w.lots).reduce((n, c) => n + c.parts.room.crc, 0)
    // both lots end in December, which has no bill: the November part adds up to the November pool exactly
    const decRoom = l.weeks.flatMap((w) => w.lots).reduce((n, c) => n + (c.parts.room.basis === 'MIXED' ? 1 : 0), 0)
    expect(decRoom).toBe(2)
    expect(novRoom).toBeGreaterThan(nov.room - 1)
  })

  it('cook runs linked to a lot go to that lot', () => {
    const cook = { id: 'c1', kind: 'steam_box', started_at: '2026-11-02T14:00:00Z', cost_crc: 1000 } as unknown as CookRun
    const l = buildLedger(empty([lot({ id: 'a', cook_run_id: 'c1' }), lot({ id: 'b', species_key: 'lions-mane' })], { cooks: [cook] }))
    const a = l.weeks[0].lots.find((x) => x.lot.id === 'a')!
    const b = l.weeks[0].lots.find((x) => x.lot.id === 'b')!
    expect(a.parts.cook.crc).toBeCloseTo(1160)
    expect(b.parts.cook.crc).toBe(0)
  })

  it('labour counts only with the switch on and a rate', () => {
    const labour = [{ id: 'h1', worked_on: '2026-11-03', person: 'J', hours: 10, task: null, block_lot_id: null, notes: null }]
    const noRate = buildLedger(empty([lot({ id: 'a' })], { labour }))
    expect(noRate.weeks[0].all.hours).toBe(10)
    expect(noRate.weeks[0].all.parts.labour.crc).toBe(0)
    const rate = buildLedger(empty([lot({ id: 'a' })], { labour, prefs: { ...DEFAULT_LEDGER_PREFS, rate: 2000, labourOn: true } }))
    expect(rate.weeks[0].all.parts.labour.crc).toBe(20000)
    const off = buildLedger(empty([lot({ id: 'a' })], { labour, prefs: { ...DEFAULT_LEDGER_PREFS, rate: 2000, labourOn: false } }))
    expect(off.weeks[0].all.parts.labour.crc).toBe(0)
  })

  it('uses harvests for kilos when they exist', () => {
    const harvests = [{ id: 'k1', block_lot_id: 'a', harvested_on: '2026-11-27', flush: 1, kg: 80, grade: null, initials: null, notes: null }]
    const l = buildLedger(empty([lot({ id: 'a', status: 'spent' })], { harvests }))
    expect(l.weeks[0].all.kg).toBe(80)
    expect(l.weeks[0].all.kgBasis).toBe('ACTUAL')
    expect(l.weeks[0].all.perKg).toBeCloseTo(l.weeks[0].all.total / 80)
  })

  it('a plan week costs something per kg and every part is tagged', () => {
    const w = planWeek({ items: [], prices: [], prefs: DEFAULT_LEDGER_PREFS }, '2026-11-10')
    expect(w.all.blocks).toBe(130)
    expect(w.all.perKg).toBeGreaterThan(0)
    expect(planRoomRate()).toBeGreaterThan(0)
    expect(costPerKg({ weeks: [], species: [], months: [], unallocated: { consumables: 0, cook: 0, labourHours: 0 } }, 'blue-oyster', w).basis).toBe('ESTIMATE')
  })
})

describe('prices and costs', () => {
  it('every mushroom ₡13,000 fresh (Joseph 6 Nov 2026), no dried default', () => {
    expect(salePrice('blue-oyster', 'fresh', DEFAULT_RATES)).toEqual({ price: 13000, mine: false })
    expect(salePrice('lions-mane', 'fresh', DEFAULT_RATES).price).toBe(13000)
    expect(salePrice('shiitake', 'fresh', DEFAULT_RATES).price).toBe(13000)
    expect(salePrice('blue-oyster', 'dried', DEFAULT_RATES).price).toBeNull()
  })
  it('your price wins over the built-in one', () => {
    const r = mergeRates({ sale: { 'blue-oyster': { fresh: 12500, dried: -3 } } })
    expect(salePrice('blue-oyster', 'fresh', r)).toEqual({ price: 12500, mine: true })
    expect(salePrice('blue-oyster', 'dried', r).price).toBeNull() // a bad figure is dropped
  })
  it('a saved record keeps defaults for anything missing or broken', () => {
    const r = mergeRates({ fx: 'x', ice: { energyCrcPerKwh: 70, tax: -1 }, labourRate: 2500 })
    expect(r.fx).toBe(510)
    expect(r.ice.energyCrcPerKwh).toBe(70)
    expect(r.ice.tax).toBe(1.16)
    expect(r.labourRate).toBe(2500)
  })
  it('a new electricity rate reaches the bill check and the ledger', () => {
    const base = iceBill(4000, 10, DEFAULT_RATES)
    const dear = mergeRates({ ice: { energyCrcPerKwh: 59.67 * 2 } })
    expect(iceBill(4000, 10, dear)).toBeCloseTo(base + 4000 * 59.67 * 1.16)
    const lots = [lot({ id: 'a' })]
    const before = buildLedger(empty(lots)).weeks[0].all.parts.room.crc
    setLiveRates(mergeRates({ ice: { estimateLow: 724000, estimateHigh: 844000 } }))
    try {
      expect(buildLedger(empty(lots)).weeks[0].all.parts.room.crc).toBeGreaterThan(before * 1.9)
    } finally {
      setLiveRates(DEFAULT_RATES)
    }
  })
  it('labour rate and wear come from the prefs', () => {
    const labour = [{ id: 'h1', worked_on: '2026-11-03', person: 'J', hours: 2, task: null, block_lot_id: null, notes: null }]
    const l = buildLedger(empty([lot({ id: 'a' })], { labour, prefs: { labourOn: true, rate: 1500, wearOn: true, wearPerBlock: 50 } }))
    expect(l.weeks[0].all.parts.labour.crc).toBe(3000)
    expect(l.weeks[0].all.parts.wear.crc).toBe(5000)
  })
})
