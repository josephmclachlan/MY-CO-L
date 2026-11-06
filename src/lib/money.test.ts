// G6 MONEY: hand-worked numbers, mock trials of every function, two years of history, and scale.
// Every expected value below was worked out by hand in the comment next to it.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import type { EditEntry } from './history'
import type { Sale } from './trade'
import { newSale } from './trade'
import type { EnergyBill, LabourEntry } from './ledger'
import type { Move, Price } from './cargo'
import type { BlockLot, Culture, GrainRun, Strain } from './xeno'
import type { CookRun } from './cook'
import { addDays } from './xeno'
import {
  DEFAULT_MONEY,
  addMonths,
  bookGet,
  bookMonth,
  books,
  breakEven,
  budgetBook,
  buyerGaps,
  buyerShare,
  cashFlow,
  cargoSpend,
  daysBetween,
  fit,
  holdFor,
  lastDay,
  mergeMoney,
  monthLabel,
  nextReceiptNo,
  owed,
  paidDay,
  payStatus,
  planWeekSales,
  pnlMonth,
  priceOn,
  receiptText,
  recallList,
  recallLots,
  recallText,
  splitBags,
  totalTrend,
  traceLot,
  trends,
  wasteWeeks,
  whatIf,
  type BudgetLine,
  type CashMove,
  type MoneyDb,
  type TraceDb,
  type WasteEntry,
} from './money'
import { addMove, addWaste, deleteMoves, fillBudget, issueReceipts, markOwed, markPaid, saveMoney, seedBudget, setBudget, writeOff } from './moneyActions'

Store.GROUP_MS = 0
const rate = (day: string) => (day < '2026-07-01' ? 500 : 520)
const sale = (p: Partial<Sale> & Pick<Sale, 'id' | 'sold_on' | 'kg' | 'amount_crc'>): Sale =>
  ({ buyer: null, channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', grade: 'A', lot_codes: null, notes: null, created_at: `${p.sold_on}T12:00:00Z`, ...p }) as Sale

// ---------- the worked example: October 2026 ----------

const S: Sale[] = [
  sale({ id: 's1', sold_on: '2026-10-05', kg: 4, amount_crc: 46000, buyer: 'Casa Luna', pay_status: 'paid', paid_on: '2026-10-05' }),
  sale({ id: 's2', sold_on: '2026-10-12', kg: 2, amount_crc: 27600, buyer: 'casa  luna', species_key: 'lions-mane', pay_status: 'owed', paid_on: null }),
  sale({ id: 's3', sold_on: '2026-10-20', kg: 0.5, amount_crc: 20000, buyer: 'Ana', form: 'dried', pay_status: 'paid', paid_on: '2026-11-02' }),
  sale({ id: 's4', sold_on: '2026-09-28', kg: 3, amount_crc: 30000, buyer: 'Hotel Sol', pay_status: 'written_off', paid_on: '2026-10-30' }),
  sale({ id: 's5', sold_on: '2026-11-03', kg: 1, amount_crc: 11500 }), // saved before G6: no pay_status at all
]
const MOVES: CashMove[] = [
  { id: 'm1', day: '2026-10-03', line: 'substrate', amount_crc: 50000, who: 'ASERRADERO', notes: null },
  { id: 'm2', day: '2026-10-15', line: 'equipment', amount_crc: 200000, who: null, notes: 'SCALE' },
  { id: 'm3', day: '2026-10-01', line: 'loan_in', amount_crc: 500000, who: 'SAVINGS', notes: null },
  { id: 'm4', day: '2026-10-02', line: 'cargo', amount_crc: 999999, who: null, notes: 'auto line typed by hand: ignored' },
]
const BILLS: EnergyBill[] = [{ id: 'b1', month: '2026-10-01', kwh: 4800, billed_kw: 12, total_crc: 380000, notes: null }]
const LABOUR: LabourEntry[] = [{ id: 'l1', worked_on: '2026-10-10', person: 'JOSEPH', hours: 10, task: null, block_lot_id: null, notes: null }]
const STOCK: Move[] = [
  { id: 'k1', item_id: 'A', moved_at: '2026-10-08T09:00:00Z', qty: 10, reason: 'delivery', run_ref: null, notes: null },
  { id: 'k2', item_id: 'A', moved_at: '2026-10-20T09:00:00Z', qty: 5, reason: 'delivery', run_ref: null, notes: null },
  { id: 'k3', item_id: 'A', moved_at: '2026-10-21T09:00:00Z', qty: -3, reason: 'use', run_ref: null, notes: null },
  { id: 'k4', item_id: 'B', moved_at: '2026-10-21T09:00:00Z', qty: 2, reason: 'delivery', run_ref: null, notes: null },
]
const PRICES: Price[] = [
  { id: 'p1', item_id: 'A', priced_on: '2026-09-01', price_crc: 1000, supplier: null },
  { id: 'p2', item_id: 'A', priced_on: '2026-10-09', price_crc: 1200, supplier: null },
]
const BUDGET: BudgetLine[] = [
  { id: '2026-12:sales_fresh', month: '2026-12', line: 'sales_fresh', amount_crc: 1000000 },
  { id: '2026-12:electricity', month: '2026-12', line: 'electricity', amount_crc: 400000 },
  { id: '2026-10:substrate', month: '2026-10', line: 'substrate', amount_crc: 40000 },
  { id: '2026-10:sales_fresh', month: '2026-10', line: 'sales_fresh', amount_crc: 100000 },
]
const DB: MoneyDb = { sales: S, moves: MOVES, bills: BILLS, labour: LABOUR, stock: STOCK, prices: PRICES, budget: BUDGET, labourRate: 2000, labourOn: true, settings: DEFAULT_MONEY }

describe('payment state', () => {
  it('a sale saved before G6 is paid on its own day (cash on delivery)', () => {
    expect(payStatus(S[4])).toBe('paid')
    expect(paidDay(S[4])).toBe('2026-11-03')
    expect(paidDay(S[1])).toBeNull()
    expect(paidDay(S[3])).toBeNull()
    expect(paidDay(S[2])).toBe('2026-11-02')
  })
  it('newSale is paid on its sale day by default', () => {
    const s = newSale({ sold_on: '2026-11-04', channel: 'market', kg: 1, amount_crc: 100 })
    expect(s.pay_status).toBe('paid')
    expect(s.paid_on).toBe('2026-11-04')
  })
})

describe('receipts', () => {
  it('numbers run per month of the sale and never reuse a number', () => {
    expect(nextReceiptNo([], '2026-11-05')).toBe('R2611-001')
    expect(nextReceiptNo([{ sold_on: '2026-11-01', receipt_no: 'R2611-007' }, { sold_on: '2026-10-01', receipt_no: 'R2610-099' }], '2026-11-30')).toBe('R2611-008')
    expect(nextReceiptNo([{ sold_on: '2026-11-01', receipt_no: 'R2611-007' }], '2026-12-01')).toBe('R2612-001')
  })
  it('receipt text shows the total, the sale-day rate and the payment state', () => {
    const t = receiptText({ sale: { ...S[0], receipt_no: 'R2610-001' }, farm: 'FARM', place: 'PLACE', speciesName: (k) => k.toUpperCase(), fx: 520 })
    expect(t).toContain('RECEIPT R2610-001')
    expect(t).toContain('4.00 KG x ₡11,500/KG') // 46,000 / 4
    expect(t).toContain('TOTAL ₡46,000 (ABOUT US$88.46 AT ₡520/US$ ON 2026-10-05)') // 46000/520 = 88.4615
    expect(t).toContain('PAID IN FULL 2026-10-05')
    expect(receiptText({ sale: S[1], farm: 'F', place: 'P', speciesName: (k) => k, fx: 520 })).toContain('NOT PAID')
  })
})

describe('money owed, hold and share', () => {
  it('ages each unpaid sale and groups buyers ignoring case and spaces', () => {
    const o = owed(S, '2026-11-06')
    expect(o.rows.map((r) => r.sale.id)).toEqual(['s2'])
    expect(o.rows[0].days).toBe(25) // 12 Oct -> 6 Nov
    expect(o.rows[0].bucket).toBe('15-30')
    expect(o.total).toBe(27600)
    expect(o.buckets).toEqual({ '0-7': 0, '8-14': 0, '15-30': 27600, '31+': 0 })
    expect(holdFor(o, 'CASA LUNA')?.crc).toBe(27600)
    expect(holdFor(o, 'Ana')).toBeNull()
    expect(holdFor(o, '')).toBeNull()
  })
  it('buyer share is by value over all sales in the window, written-off sales left out', () => {
    // 1-31 Oct: s1 46,000 + s2 27,600 (Casa Luna 73,600) + s3 20,000 (Ana). Total 93,600. s4 is written off.
    const b = buyerShare(S, '2026-10-01', '2026-10-31', 30)
    expect(b.total).toBe(93600)
    expect(b.rows[0].buyer).toBe('Casa Luna')
    expect(b.rows[0].sharePct).toBeCloseTo(78.632, 2)
    expect(b.rows[0].level).toBe('over')
    expect(b.rows[1].sharePct).toBeCloseTo(21.368, 2) // 20,000 / 93,600; near starts at 24%
    expect(b.rows[1].level).toBe('ok')
  })
})

describe('the books: profit and loss against cash', () => {
  const bk = books(DB, rate)
  it('October profit and loss, worked by hand', () => {
    // income: fresh 46,000 + 27,600 = 73,600; dried 20,000. costs: substrate 50,000, electricity 380,000,
    // hours 10 x 2,000 = 20,000, CARGO 10 x 1,000 (price on 8 Oct) + 5 x 1,200 (price on 20 Oct) = 16,000,
    // written-off s4 30,000. Equipment and the loan are cash only. The typed 'cargo' line is ignored.
    expect(bookGet(bk.pnl, '2026-10', 'sales_fresh')).toBe(73600)
    expect(bookGet(bk.pnl, '2026-10', 'sales_other')).toBe(20000)
    expect(bookGet(bk.pnl, '2026-10', 'cargo')).toBe(16000)
    expect(bookGet(bk.pnl, '2026-10', 'labour_hours')).toBe(20000)
    expect(bookGet(bk.pnl, '2026-10', 'bad_debt')).toBe(30000)
    expect(bookGet(bk.pnl, '2026-10', 'equipment')).toBe(0)
    expect(bookGet(bk.pnl, '2026-09', 'sales_fresh')).toBe(30000)
    expect(bk.unpricedDeliveries).toBe(1)
    const p = pnlMonth('2026-10', bk.pnl, budgetBook(BUDGET), S)
    expect(p.revenue).toBe(93600)
    expect(p.cost).toBe(496000)
    expect(p.profit).toBe(-402400)
    expect(p.kgSold).toBe(6) // fresh only: 4 + 2
    const sub = p.costs.find((r) => r.line === 'substrate')!
    expect(sub.budget).toBe(40000)
    expect(sub.better).toBe(-10000) // spent 10,000 more than budget
    expect(p.income.find((r) => r.line === 'sales_fresh')!.better).toBe(-26400) // 73,600 - 100,000
  })
  it('October cash: a sale counts when paid, loans and equipment move cash', () => {
    // in: s1 46,000 + loan 500,000 = 546,000. out: 50,000 + 200,000 + 380,000 + 20,000 + 16,000 = 666,000.
    expect(bookMonth(bk.cash, '2026-10', 'in')).toBe(546000)
    expect(bookMonth(bk.cash, '2026-10', 'out')).toBe(666000)
    expect(bookGet(bk.cash, '2026-11', 'sales_other')).toBe(20000) // s3 paid 2 Nov
    expect(bookGet(bk.cash, '2026-11', 'sales_fresh')).toBe(11500) // s5, old sale counted paid
    expect(bookGet(bk.cash, '2026-10', 'bad_debt')).toBe(0)
  })
  it('US$ uses each record\'s own day, so a new rate today changes nothing in October', () => {
    expect(bookGet(bk.pnlUsd, '2026-10', 'sales_fresh')).toBeCloseTo(73600 / 520, 9)
    expect(bookGet(bk.pnlUsd, '2026-09', 'sales_fresh')).toBeCloseTo(30000 / 520, 9)
    expect(bookGet(bk.pnlUsd, '2026-10', 'electricity')).toBeCloseTo(380000 / 520, 9) // bill at 31 Oct
    const later = books(DB, (d) => (d >= '2026-11-06' ? 900 : rate(d)))
    expect(bookGet(later.pnlUsd, '2026-10', 'sales_fresh')).toBe(bookGet(bk.pnlUsd, '2026-10', 'sales_fresh'))
  })
  it('the CARGO and hours switches stop double counting', () => {
    const off = books({ ...DB, settings: { ...DEFAULT_MONEY, cargoAsSpend: false, hoursAsSpend: false } }, rate)
    expect(bookGet(off.pnl, '2026-10', 'cargo')).toBe(0)
    expect(bookGet(off.pnl, '2026-10', 'labour_hours')).toBe(0)
    const noRate = books({ ...DB, labourRate: null }, rate)
    expect(bookGet(noRate.pnl, '2026-10', 'labour_hours')).toBe(0)
  })
  it('prices: the newest on or before the day, else the first one', () => {
    expect(priceOn(PRICES, 'A', '2026-10-08')).toBe(1000)
    expect(priceOn(PRICES, 'A', '2026-10-09')).toBe(1200)
    expect(priceOn(PRICES, 'A', '2026-01-01')).toBe(1000)
    expect(priceOn(PRICES, 'B', '2026-10-09')).toBeNull()
    expect(cargoSpend(STOCK, PRICES).byDay.map((d) => d.crc)).toEqual([10000, 6000])
  })
})

describe('12-month cash flow', () => {
  it('actual months from the cash book, later months from the budget, floor = 3 months of operating cash out', () => {
    const bk = books(DB, rate)
    const cf = cashFlow(bk.cash, budgetBook(BUDGET), '2026-10', '2026-11-06', 100000, 3)
    expect(cf.months.map((m) => m.basis).slice(0, 3)).toEqual(['ACTUAL', 'NOW', 'PLAN'])
    expect(cf.months[0].net).toBe(-120000) // 546,000 - 666,000
    expect(cf.months[0].end).toBe(-20000) // 100,000 - 120,000
    expect(cf.months[1].end).toBe(11500) // + 20,000 + 11,500
    expect(cf.months[2].end).toBe(611500) // + 1,000,000 - 400,000
    expect(cf.months[11].end).toBe(611500) // no budget after December
    // operating: Oct 666,000 - 200,000 equipment = 466,000; Dec 400,000. avg 433,000 x 3.
    expect(cf.floor).toBe(1299000)
    expect(cf.below.length).toBe(12)
    expect(cf.low).toEqual({ month: '2026-10', end: -20000 })
  })
})

describe('break-even', () => {
  it('fixed costs / (price per kg - variable cost per kg), over 3 months', () => {
    const bk = books(DB, rate)
    // Aug-Oct: revenue 30,000 + 93,600 = 123,600; fixed: 380,000 + 20,000 + 30,000 = 430,000;
    // variable: 50,000 + 16,000 = 66,000; fresh kg 3 + 4 + 2 = 9. A month: 41,200 / 143,333.33 / 22,000 / 3 kg.
    const be = breakEven(['2026-08', '2026-09', '2026-10'], bk.pnl, S, 0.8)
    expect(be.pricePerKg).toBeCloseTo(13733.333, 2)
    expect(be.varPerKg).toBeCloseTo(7333.333, 2)
    expect(be.kgPerMonth).toBeCloseTo(143333.333 / 6400, 4) // 22.3958
    expect(be.blocksPerWeek).toBeCloseTo(22.3958 / 0.8 / (52 / 12), 3)
    expect(be.basis).toBe('ACTUAL')
  })
  it('never breaks even when a kilo costs more than it sells for, and says NONE with no sales', () => {
    const pnl = new Map([['2026-10', new Map([['sales_fresh', 1000], ['substrate', 5000], ['electricity', 100]])]])
    const be = breakEven(['2026-10'], pnl, [sale({ id: 'x', sold_on: '2026-10-01', kg: 1, amount_crc: 1000 })], 1)
    expect(be.kgPerMonth).toBeNull()
    expect(breakEven(['2025-01'], new Map(), [], 1).basis).toBe('NONE')
  })
})

describe('trends and buyers who stopped', () => {
  it('least squares fit', () => {
    expect(fit([1, 2, 3])).toEqual({ a: 1, b: 1 })
    expect(fit([5])).toEqual({ a: 5, b: 0 })
  })
  it('week on week by species, 4 on 4, and a straight trend line', () => {
    // 12 Mondays ending 2 Nov 2026. Blue oyster: ₡1,000 x week number (1..12) on each Wednesday.
    const end = '2026-11-02'
    const list: Sale[] = []
    for (let i = 0; i < 12; i++) list.push(sale({ id: `t${i}`, sold_on: addDays(end, (i - 11) * 7 + 2), kg: 1, amount_crc: 1000 * (i + 1) }))
    list.push(sale({ id: 'old', sold_on: '2025-01-01', kg: 1, amount_crc: 99999 })) // outside the window
    const [t] = trends(list, 'species', '2026-11-05', 12)
    expect(t.total).toBe(78000) // 1+..+12 = 78
    expect(t.wow).toBeCloseTo(((12 - 11) / 11) * 100, 6)
    expect(t.fourOnFour).toBeCloseTo(((9 + 10 + 11 + 12 - (5 + 6 + 7 + 8)) / 26) * 100, 6) // 42 vs 26
    expect(t.slope).toBeCloseTo(1000, 6)
    expect(t.line[0]).toBeCloseTo(1000, 6)
    expect(t.line[1]).toBeCloseTo(12000, 6)
    expect(t.slopePct).toBeCloseTo((1000 / 6500) * 100, 6)
    expect(totalTrend(list, '2026-11-05').total).toBe(78000)
    expect(trends(list, 'buyer', '2026-11-05')[0].key).toBe('(NO NAME)')
  })
  it('flags a buyer STOPPED after 2x the usual gap (21 days at least), SLIPPING after 1.5x (14 at least)', () => {
    const wk = (buyer: string, first: string, n: number) => Array.from({ length: n }, (_, i) => sale({ id: `${buyer}${i}`, sold_on: addDays(first, i * 7), kg: 1, amount_crc: 1000, buyer }))
    const list = [...wk('A', '2026-09-01', 4), ...wk('B', '2026-09-13', 4), ...wk('C', '2026-09-24', 4), sale({ id: 'one', sold_on: '2026-10-01', kg: 1, amount_crc: 5, buyer: 'D' })]
    const g = buyerGaps(list, '2026-10-20')
    const by = Object.fromEntries(g.map((x) => [x.buyer, x]))
    expect(by.A.sinceLast).toBe(28) // last 22 Sep
    expect(by.A.state).toBe('STOPPED')
    expect(by.B.sinceLast).toBe(16) // last 4 Oct
    expect(by.B.state).toBe('SLIPPING')
    expect(by.C.state).toBe('ACTIVE')
    expect(by.D).toBeUndefined() // one sale is not a pattern
    expect(g[0].buyer).toBe('A')
    expect(by.A.perWeek).toBe(1000) // 4 sales over 4 weeks
  })
})

describe('waste log against the 25% line', () => {
  it('surplus share per week, worked by hand', () => {
    const sales = [sale({ id: 'w1', sold_on: '2026-11-03', kg: 10, amount_crc: 1 }), sale({ id: 'w2', sold_on: '2026-11-03', kg: 5, amount_crc: 1, form: 'dried' })]
    const w = (id: string, route: WasteEntry['route'], kg: number): WasteEntry => ({ id, logged_on: '2026-11-04', species_key: 'blue-oyster', kg, route, lot_codes: null, notes: null })
    const waste = [w('a', 'unsold', 2), w('b', 'dried', 1), w('c', 'donated', 0.5), w('d', 'compost', 0.5)]
    const rows = wasteWeeks(sales, waste, '2026-11-06', 2, 25)
    const r = rows[1]
    expect(r.week).toBe('2026-11-02')
    expect(r.soldKg).toBe(10) // dried sales are not fresh
    expect(r.surplusKg).toBe(4)
    expect(r.lostKg).toBe(2.5)
    expect(r.surplusPct).toBeCloseTo(28.5714, 3) // 4 / 14
    expect(r.over).toBe(true)
    expect(rows[0].surplusPct).toBeNull()
  })
})

// ---------- trace and recall ----------

const STRAINS: Strain[] = [
  { id: 'st1', species_key: 'blue-oyster', code: 'BO-01', name: null, source: null, active: true, notes: null },
  { id: 'st2', species_key: 'lions-mane', code: 'LM-01', name: null, source: null, active: true, notes: null },
]
const CULT: Culture[] = [{ id: 'cu1', strain_id: 'st1', parent_culture_id: null, kind: 'plate', p_level: 1, made_on: '2026-09-01', status: 'active', cold_since: null, location: null, label: 'BO-01 P1', notes: null } as unknown as Culture]
const g = (id: string, generation: 'G1' | 'G2', strain: string, parent: string | null, culture: string | null): GrainRun =>
  ({ id, generation, strain_id: strain, parent_culture_id: culture, parent_grain_run_id: parent, parent_bags_used: null, bag_count: 6, bags_lost: 0, inoculated_on: '2026-09-10', status: 'used_up', cold_since: null, location: null, label: id.toUpperCase(), result: null }) as GrainRun
const GRAINS = [g('g1', 'G1', 'st1', null, 'cu1'), g('g2', 'G2', 'st1', 'g1', null), g('g3', 'G2', 'st1', 'g1', null), g('g5', 'G1', 'st2', null, null), g('g4', 'G2', 'st2', 'g5', null)]
const lot = (id: string, code: string, cook: string, grain: string, strain: string | null): BlockLot =>
  ({ id, lot_code: code, species_key: strain === 'st2' ? 'lions-mane' : 'blue-oyster', strain_id: strain, grain_run_id: grain, g2_bags_used: 1, cook_run_id: cook, bag_count: 20, knock_date: '2026-10-20', status: 'fruiting', notes: null, room: 'fruiting' }) as BlockLot
const LOTS = [lot('L1', 'B1020', 'c1', 'g2', 'st1'), lot('L2', 'B1027', 'c1', 'g3', null), lot('L3', 'L1022', 'c2', 'g4', 'st2')]
const COOKS = [{ id: 'c1', kind: 'steam_box', unit_label: 'STEAM BOX', started_at: '2026-10-19T08:00:00Z', result: 'pass' }, { id: 'c2', kind: 'steam_box', unit_label: 'STEAM BOX', started_at: '2026-10-21T08:00:00Z', result: 'pass' }] as CookRun[]
const TDB: TraceDb = {
  lots: LOTS,
  cooks: COOKS,
  grains: GRAINS,
  cultures: CULT,
  strains: STRAINS,
  harvests: [{ block_lot_id: 'L1', harvested_on: '2026-11-12', kg: 8, flush: 1 }, { block_lot_id: 'L1', harvested_on: '2026-11-10', kg: 2, flush: 1 }],
  losses: [{ block_lot_id: 'L1', bag_count: 2 }],
}
const TS: Sale[] = [
  sale({ id: 'r1', sold_on: '2026-11-13', kg: 3, amount_crc: 1, buyer: 'Casa Luna', lot_codes: ['B1020'] }),
  sale({ id: 'r2', sold_on: '2026-11-14', kg: 2, amount_crc: 1, buyer: 'Ana', lot_codes: ['b1027', 'L1022'] }),
  sale({ id: 'r3', sold_on: '2026-11-15', kg: 1, amount_crc: 1, lot_codes: ['B1020'] }),
  sale({ id: 'r4', sold_on: '2026-11-15', kg: 1, amount_crc: 1, buyer: 'casa luna', lot_codes: ['L1022'] }),
]

describe('trace and recall', () => {
  it('one lot: cook, G2 bag, its master, the plate, the strain, the room, the harvests', () => {
    const t = traceLot(LOTS[0], TDB)
    expect(t.cook?.id).toBe('c1')
    expect(t.grain?.id).toBe('g2')
    expect(t.master?.id).toBe('g1')
    expect(t.culture?.id).toBe('cu1')
    expect(t.strain?.code).toBe('BO-01')
    expect(t.room).toBe('fruiting')
    expect(t.harvests.map((h) => h.day)).toEqual(['2026-11-10', '2026-11-12'])
    expect(t.losses).toBe(2)
    // A lot with no strain on it finds the strain through its grain.
    expect(traceLot(LOTS[1], TDB).strain?.code).toBe('BO-01')
  })
  it('recall by lot, cook run, master and strain', () => {
    expect(recallLots('lot', 'b1020', TDB).map((l) => l.id)).toEqual(['L1'])
    expect(recallLots('cook', 'c1', TDB).map((l) => l.id)).toEqual(['L1', 'L2'])
    expect(recallLots('grain', 'g1', TDB).map((l) => l.id)).toEqual(['L1', 'L2']) // a master takes its G2 lots
    expect(recallLots('grain', 'g2', TDB).map((l) => l.id)).toEqual(['L1'])
    expect(recallLots('strain', 'st1', TDB).map((l) => l.id)).toEqual(['L1', 'L2'])
    const r = recallList(TS, recallLots('cook', 'c1', TDB))
    expect(r.codes).toEqual(['B1020', 'B1027'])
    expect(r.sales.map((s) => s.id)).toEqual(['r1', 'r2', 'r3'])
    expect(r.rows.map((x) => [x.buyer, x.kg])).toEqual([['Casa Luna', 3], ['Ana', 2], ['NO NAME (MARKET OR CASH SALE)', 1]])
    const txt = recallText('COOK C1', r, (k) => k)
    expect(txt).toContain('3 BUYERS // 3 SALES')
    expect(txt).toContain('CASA LUNA // 3.00 KG // 2026-11-13')
  })
})

// ---------- what-if ----------

describe('what-if planner', () => {
  it('bags are whole and add up', () => {
    expect(splitBags(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(splitBags(130, [52, 46, 16, 16])).toEqual([52, 46, 16, 16])
    expect(splitBags(0, [1, 2])).toEqual([0, 0])
    expect(splitBags(5, [0, 0])).toEqual([0, 0])
  })
  it('100 bags, two species, worked by hand', () => {
    const o = whatIf({
      bagsPerWeek: 100,
      sellPct: 75,
      costPerBlock: 500,
      powerAtPlan: 400000,
      planBags: 130,
      powerVariablePct: 60,
      fixedPerMonth: 0,
      species: [
        { key: 'a', sharePct: 50, kgPerBlock: 1, pricePerKg: 10000 },
        { key: 'b', sharePct: 50, kgPerBlock: 0.5, pricePerKg: 12000 },
      ],
    })
    expect(o.kgWeek).toBe(75)
    expect(o.soldKgWeek).toBe(56.25)
    expect(o.salesWeek).toBe(600000) // 37.5 x 10,000 + 18.75 x 12,000
    expect(o.suppliesWeek).toBe(50000)
    expect(o.powerMonth).toBeCloseTo(160000 + (240000 / 130) * 100, 6) // 344,615.38
    expect(o.profitWeek).toBeCloseTo(600000 - 50000 - o.powerMonth / (52 / 12), 6)
    // per bag 6,000 - 500 - 1,846.15/4.333 = 5,073.96; fixed 160,000/4.333 = 36,923.08 -> 7.277 bags
    expect(o.breakEvenBags).toBeCloseTo(36923.0769 / 5073.9645, 3)
  })
  it('a mix that loses money never breaks even; 0 bags still works', () => {
    const base = { sellPct: 75, costPerBlock: 50000, powerAtPlan: 1, planBags: 130, powerVariablePct: 60, fixedPerMonth: 0, species: [{ key: 'a', sharePct: 100, kgPerBlock: 1, pricePerKg: 1000 }] }
    expect(whatIf({ ...base, bagsPerWeek: 100 }).breakEvenBags).toBeNull()
    const z = whatIf({ ...base, bagsPerWeek: 0, costPerBlock: 0, powerAtPlan: 130000 })
    expect(z.salesWeek).toBe(0)
    expect(z.breakEvenBags).toBeGreaterThan(0)
  })
  it('the plan week: 130 bags at Catawba yields and 75% sold', () => {
    const w = planWeekSales([{ key: 'a', bags: 10 }, { key: 'b', bags: 5 }], (k) => (k === 'a' ? 1 : null), () => 10000, 75)
    expect(w.kg).toBe(7.5)
    expect(w.crc).toBe(75000)
  })
})

describe('settings and dates', () => {
  it('bad settings fall back to defaults and are clamped', () => {
    expect(mergeMoney(null)).toEqual(DEFAULT_MONEY)
    expect(mergeMoney({ floorMonths: 99, wasteLinePct: -5, startMonth: '2026-13x', cargoAsSpend: 'yes' })).toEqual({ ...DEFAULT_MONEY, floorMonths: 24, wasteLinePct: 0 })
  })
  it('month helpers', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(lastDay('2028-02')).toBe('2028-02-29')
    expect(monthLabel('2026-11')).toBe('NOV 26')
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1)
  })
})

// ---------- mock trial: a month of the farm, end to end through the Store, with undo and history ----------

const log = (st: Store) => st.rows<EditEntry & Row>(EDIT_LOG)

describe('mock trial: November on the farm', () => {
  it('sales, an unpaid delivery, a late payment, a write-off, spending, budget, waste, receipts, undo and history', async () => {
    const st = new Store(new MemoryBackend())
    await st.ensure(EDIT_LOG)
    // Week 1: three sales, one not paid on delivery.
    const a = newSale({ sold_on: '2026-11-02', buyer: 'Casa Luna', channel: 'restaurant', species_key: 'blue-oyster', kg: 5, amount_crc: 57500 })
    const b = newSale({ sold_on: '2026-11-03', buyer: 'Hotel Sol', channel: 'restaurant', species_key: 'lions-mane', kg: 2, amount_crc: 27600, pay_status: 'owed', paid_on: null })
    const c = newSale({ sold_on: '2026-11-04', buyer: null, channel: 'market', species_key: 'blue-oyster', kg: 3, amount_crc: 34500 })
    await st.action('SALES', () => st.put('sales', [a, b, c]))
    expect(owed(st.rows<Sale>('sales'), '2026-11-06').total).toBe(27600)
    // Receipts for all three: one action, numbers in sale order.
    await st.action('RECEIPTS', () => issueReceipts(st, [c.id, a.id, b.id]))
    const byId = new Map(st.rows<Sale>('sales').map((s) => [s.id, s.receipt_no]))
    expect([byId.get(a.id), byId.get(b.id), byId.get(c.id)]).toEqual(['R2611-001', 'R2611-002', 'R2611-003'])
    // Giving numbers again changes nothing.
    await st.action('RECEIPTS AGAIN', () => issueReceipts(st, [a.id]))
    expect(st.rows<Sale>('sales').find((s) => s.id === a.id)!.receipt_no).toBe('R2611-001')
    // Paid before the sale day is refused; paid on the 10th works.
    await expect(markPaid(st, [b.id], '2026-11-01')).rejects.toThrow(/BEFORE THE SALE/)
    await st.action('PAID', () => markPaid(st, [b.id], '2026-11-10'))
    expect(owed(st.rows<Sale>('sales'), '2026-11-12').total).toBe(0)
    // Undo puts the debt back exactly.
    expect(await st.undo()).toBe('PAID')
    expect(owed(st.rows<Sale>('sales'), '2026-11-12').rows.map((r) => r.sale.id)).toEqual([b.id])
    // Write-off: only owed money; it becomes a cost in the write-off month.
    await expect(writeOff(st, [a.id], '2026-11-20')).rejects.toThrow(/ONLY MONEY OWED/)
    await st.action('WRITE OFF', () => writeOff(st, [b.id], '2026-12-02'))
    await expect(markOwed(st, [])).rejects.toThrow(/NO SALE/)
    // Spending, a loan, the budget and waste.
    await st.action('SPEND', () => addMove(st, { day: '2026-11-05', line: 'substrate', amount: 60000, who: ' Aserradero  Sur ' }))
    await expect(addMove(st, { day: '2026-11-05', line: 'electricity', amount: 1 })).rejects.toThrow(/PICK A LINE/)
    await expect(addMove(st, { day: '2026-11-05', line: 'fuel', amount: 0 })).rejects.toThrow(/AMOUNT/)
    await st.action('LOAN', () => addMove(st, { day: '2026-11-01', line: 'loan_in', amount: 300000 }))
    await st.action('BUDGET', () => fillBudget(st, '2026-11', 12, 'sales_fresh', 800000))
    expect(st.rows('budget_lines').length).toBe(12)
    await st.action('BUDGET ZERO', () => setBudget(st, '2027-10', 'sales_fresh', 0))
    expect(st.rows('budget_lines').length).toBe(11)
    await st.action('SEED', () => seedBudget(st, '2026-11', 2, { electricity: 392000.4 }))
    expect(st.rows<BudgetLine>('budget_lines').find((r) => r.id === '2026-12:electricity')!.amount_crc).toBe(392000)
    await st.action('WASTE', () => addWaste(st, { day: '2026-11-04', species: 'blue-oyster', kg: 1.5, route: 'donated' }))
    await expect(addWaste(st, { day: '2026-11-04', species: 'blue-oyster', kg: -1, route: 'donated' })).rejects.toThrow(/KG/)
    await st.action('SETTINGS', () => saveMoney(st, DEFAULT_MONEY, { openingCash: 250000, startMonth: '2026-11' }))

    const db: MoneyDb = { sales: st.rows<Sale>('sales'), moves: st.rows<CashMove>('cash_moves'), bills: [], labour: [], stock: [], prices: [], budget: st.rows<BudgetLine>('budget_lines'), labourRate: null, labourOn: true, settings: mergeMoney(st.rows('app_settings')[0].value) }
    const bk = books(db, rate)
    // November P&L: sales 57,500 + 27,600 + 34,500 = 119,600; costs: substrate 60,000. Bad debt is December.
    const nov = pnlMonth('2026-11', bk.pnl, budgetBook(db.budget), db.sales)
    expect(nov.revenue).toBe(119600)
    expect(nov.cost).toBe(60000)
    expect(nov.profit).toBe(59600)
    expect(bookGet(bk.pnl, '2026-12', 'bad_debt')).toBe(27600)
    // November cash: paid sales 57,500 + 34,500 = 92,000 + loan 300,000 in; 60,000 out.
    const cf = cashFlow(bk.cash, budgetBook(db.budget), db.settings.startMonth!, '2026-11-20', db.settings.openingCash, 3)
    expect(cf.months[0].cashIn).toBe(392000)
    expect(cf.months[0].end).toBe(250000 + 392000 - 60000)
    expect(cf.months[1].end).toBe(582000 + 800000 - 392000) // December from the budget

    // Every save landed in the history, with a label, and money stays in colones.
    const labels = new Set(log(st).map((e) => e.label))
    for (const l of ['SALES', 'RECEIPTS', 'PAID', 'UNDO PAID', 'WRITE OFF', 'SPEND', 'LOAN', 'BUDGET', 'WASTE', 'SETTINGS']) expect(labels).toContain(l)
    expect(labels).not.toContain('RECEIPTS AGAIN') // nothing changed, no history line
    const spend = st.rows<CashMove>('cash_moves').find((m) => m.line === 'substrate')!
    expect(spend.who).toBe('Aserradero Sur')
    // Delete and undo the delete: the entry comes back the same.
    await st.action('DEL', () => deleteMoves(st, [spend.id]))
    expect(st.rows('cash_moves').length).toBe(1)
    await st.undo()
    expect(st.rows<CashMove>('cash_moves').find((m) => m.id === spend.id)).toMatchObject({ amount_crc: 60000, line: 'substrate' })

    // Backup and restore into a new device: the books come out identical.
    const json = await st.exportJson()
    const st2 = new Store(new MemoryBackend())
    await st2.importJson(json)
    const db2 = { ...db, sales: st2.rows<Sale>('sales'), moves: st2.rows<CashMove>('cash_moves'), budget: st2.rows<BudgetLine>('budget_lines') }
    const db1 = { ...db, moves: st.rows<CashMove>('cash_moves') }
    const sortBook = (b: Map<string, Map<string, number>>) => JSON.stringify([...b].map(([m, x]) => [m, [...x].sort()]).sort())
    expect(sortBook(books(db2, rate).pnl)).toBe(sortBook(books(db1, rate).pnl))
    expect(sortBook(books(db2, rate).cash)).toBe(sortBook(books(db1, rate).cash))
  })
})

// ---------- two years of history ----------

describe('historical resilience: two years of back data', () => {
  // Nov 2024 to Oct 2026: weekly sales to four buyers with a price rise in 2026, a retired buyer, edits,
  // monthly bills and supply spending, and a rate that moves every day.
  const day0 = '2024-11-04'
  const fx = (d: string) => 480 + (daysBetween(day0, d) % 90) // changes every day
  const all: Sale[] = []
  const moves: CashMove[] = []
  const bills: EnergyBill[] = []
  for (let w = 0; w < 104; w++) {
    const mon = addDays(day0, w * 7)
    const price = mon >= '2026-01-01' ? 12000 : 11000
    for (const [i, b] of ['Casa Luna', 'Hotel Sol', 'Soda Tica', 'Market'].entries()) {
      if (b === 'Hotel Sol' && mon >= '2026-06-01') continue // stopped ordering
      all.push(sale({ id: `h${w}-${i}`, sold_on: addDays(mon, 4), kg: 5 + i, amount_crc: (5 + i) * price, buyer: b === 'Market' ? null : b, pay_status: 'paid', paid_on: addDays(mon, 4) }))
    }
    moves.push({ id: `mv${w}`, day: addDays(mon, 1), line: 'substrate', amount_crc: 40000, who: null, notes: null })
  }
  for (let m = 0; m < 24; m++) bills.push({ id: `b${m}`, month: `${addMonths('2024-11', m)}-01`, kwh: 4762, billed_kw: 12, total_crc: 392000, notes: null })
  const db: MoneyDb = { sales: all, moves, bills, labour: [], stock: [], prices: [], budget: [], labourRate: null, labourOn: true, settings: DEFAULT_MONEY }

  it('old months keep their totals and their own-day US$ after a new year of data, a price change and today\'s rate jumping', () => {
    const before = books({ ...db, sales: all.filter((s) => s.sold_on < '2025-12-01'), moves: moves.filter((m) => m.day < '2025-12-01') }, fx)
    const after = books(db, (d) => (d >= '2026-10-01' ? 999 : fx(d)))
    for (let m = 0; m < 12; m++) {
      const month = addMonths('2024-11', m)
      expect(bookMonth(after.pnl, month)).toBe(bookMonth(before.pnl, month))
      expect(bookMonth(after.pnlUsd, month)).toBeCloseTo(bookMonth(before.pnlUsd, month), 9)
    }
    // A March 2025 hand total: sales on 4 Fridays (7,14,21,28 Mar) x (5+6+7+8 kg) x 11,000 = 4 x 286,000.
    expect(bookGet(after.pnl, '2025-03', 'sales_fresh')).toBe(4 * 26 * 11000)
    // Same month in 2026 at the new price and without Hotel Sol after June.
    expect(bookGet(after.pnl, '2026-03', 'sales_fresh')).toBe(4 * 26 * 12000)
    expect(bookGet(after.pnl, '2026-07', 'sales_fresh')).toBe(5 * (26 - 6) * 12000) // 5 Fridays in July 2026
  })
  it('editing an old sale changes only its own month; the buyer who stopped is found', () => {
    const edited = all.map((s) => (s.id === 'h20-0' ? { ...s, amount_crc: 1 } : s))
    const a = books(db, fx)
    const b = books({ ...db, sales: edited }, fx)
    const month = monthOf(all.find((s) => s.id === 'h20-0')!.sold_on)
    for (let m = 0; m < 24; m++) {
      const mm = addMonths('2024-11', m)
      if (mm === month) expect(bookMonth(b.pnl, mm)).toBe(bookMonth(a.pnl, mm) - 55000 + 1)
      else expect(bookMonth(b.pnl, mm)).toBe(bookMonth(a.pnl, mm))
    }
    const gaps = buyerGaps(all, '2026-10-30')
    expect(gaps[0]).toMatchObject({ buyer: 'Hotel Sol', state: 'STOPPED' })
    expect(gaps.filter((x) => x.state === 'ACTIVE').map((x) => x.buyer).sort()).toEqual(['Casa Luna', 'Soda Tica'])
  })
  it('a 12-month P&L summary over two years adds up to the books', () => {
    const bk = books(db, fx)
    let rev = 0
    for (let m = 0; m < 24; m++) rev += pnlMonth(addMonths('2024-11', m), bk.pnl, new Map(), all).revenue
    expect(rev).toBe(all.reduce((t, s) => t + s.amount_crc, 0))
  })
})

const monthOf = (d: string) => d.slice(0, 7)

// ---------- scale ----------

describe('scale: thousands of sales stay exact and fast', () => {
  it('20,000 sales, 5,000 spending entries, 3,000 waste entries', () => {
    const sales: Sale[] = []
    let total = 0
    for (let i = 0; i < 20000; i++) {
      const amt = 1000 + (i % 97) * 10
      total += amt
      const st = i % 13 === 0 ? 'owed' : 'paid'
      sales.push(sale({ id: `z${i}`, sold_on: addDays('2024-01-01', i % 1000), kg: 1 + (i % 5), amount_crc: amt, buyer: `BUYER ${i % 40}`, pay_status: st, paid_on: st === 'paid' ? addDays('2024-01-01', i % 1000) : null, lot_codes: [`B${String(1000 + (i % 300))}`] }))
    }
    const moves: CashMove[] = Array.from({ length: 5000 }, (_, i) => ({ id: `mm${i}`, day: addDays('2024-01-01', i % 1000), line: 'fuel', amount_crc: 777, who: null, notes: null }))
    const waste: WasteEntry[] = Array.from({ length: 3000 }, (_, i) => ({ id: `ww${i}`, logged_on: addDays('2026-08-01', i % 90), species_key: 'blue-oyster', kg: 0.5, route: 'dried', lot_codes: null, notes: null }))
    const t0 = performance.now()
    const bk = books({ sales, moves, bills: [], labour: [], stock: [], prices: [], budget: [], labourRate: null, labourOn: true, settings: DEFAULT_MONEY }, rate)
    let rev = 0
    let out = 0
    for (const [, m] of bk.pnl) {
      rev += (m.get('sales_fresh') ?? 0)
      out += m.get('fuel') ?? 0
    }
    expect(rev).toBe(total)
    expect(out).toBe(5000 * 777)
    const o = owed(sales, '2026-12-31')
    expect(o.rows.length).toBe(Math.ceil(20000 / 13))
    expect(trends(sales, 'buyer', '2026-09-26').length).toBe(40)
    expect(wasteWeeks(sales, waste, '2026-10-30', 14, 25).reduce((t, w) => t + w.byRoute.dried, 0)).toBe(1500)
    expect(recallList(sales, [{ lot_code: 'B1000' } as BlockLot]).sales.length).toBe(Math.ceil(20000 / 300))
    expect(buyerGaps(sales, '2026-12-31').length).toBe(40)
    expect(performance.now() - t0).toBeLessThan(4000)
  })
})
