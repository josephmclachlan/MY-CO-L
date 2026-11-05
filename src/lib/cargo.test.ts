import { describe, expect, it } from 'vitest'
import { MemoryBackend, Store, uuid } from './store'
import { meterShape, nextRunRef, onHandMap, stockState, weeklyUse, weeksLeft, type Item, type Move } from './cargo'
import { runLines, weeklyPlanUse } from './stockplan'
import { bookRun, newItem, newMove, receive, removeItem, seedStarter, setCount, undoRun } from './cargoActions'
import { SEED_ITEMS } from '../data/cargo'

const item = (p: Partial<Item> = {}): Item => newItem({ name: 'Thing', unit: 'kg', ...p })
const mv = (id: string, qty: number, reason = 'use', days = 0): Move => ({ ...newMove(id, qty, reason), moved_at: new Date(Date.now() - days * 86400000).toISOString() })

describe('run plan stock use', () => {
  const by = (n: number, o = {}) => new Map(runLines(n, o).map((l) => [l.code, l]))
  it('130 bags: 4 lb dry per bag split 60:40 by default (hot, humid site)', () => {
    const m = by(130)
    expect(m.get('SAWDUST')!.book).toBeCloseTo(141.5, 1)
    expect(m.get('SOY-HULL')!.book).toBeCloseTo(94.3, 1)
    expect(m.get('BAG-10')!.book).toBe(130)
  })
  it('grain follows the 0.3 lb spawn rate, G1 masters and hydration', () => {
    const g = by(130).get('GRAIN')!
    // 39 lb G2 + 6.5/12 x 4 lb G1 = 41.17 lb hydrated -> x 0.52/0.90 -> 23.8 lb dry
    expect(g.qty / 0.45359237).toBeCloseTo(23.79, 1)
    const s = by(130).get('SPAWN-BAG')!
    expect(s.qty).toBeCloseTo(6.5 + 6.5 / 12, 3)
    expect(s.book).toBe(8)
  })
  it('combo pellets replace sawdust and soy', () => {
    const m = by(130, { form: 'combo' })
    expect(m.has('SAWDUST')).toBe(false)
    expect(m.get('COMBO')!.book).toBeCloseTo(235.9, 1)
  })
  it('soy share is capped at 50%', () => {
    expect(by(100, { soyShare: 0.9 }).get('SOY-HULL')!.qty).toBeCloseTo(by(100, { soyShare: 0.5 }).get('SOY-HULL')!.qty)
  })
  it('zero bags use nothing; weekly plan keys by code', () => {
    expect(runLines(0)).toEqual([])
    expect(weeklyPlanUse(130).has('GRAIN')).toBe(true)
  })
})

describe('stock maths', () => {
  it('count is the sum of moves', () => {
    const a = item()
    const m = [mv(a.id, 10, 'delivery'), mv(a.id, -2.5), mv(a.id, -0.1)]
    expect(onHandMap(m).get(a.id)).toBe(7.4)
  })
  it('weekly use: manual beats plan beats history', () => {
    const a = item({ use_per_week: 5 })
    expect(weeklyUse(a, 9, [])).toEqual({ perWeek: 5, source: 'MANUAL' })
    expect(weeklyUse(item(), 9, [])).toEqual({ perWeek: 9, source: 'PLAN' })
    const b = item()
    const h = weeklyUse(b, undefined, [mv(b.id, -8, 'use', 14), mv(b.id, -8, 'use', 1), mv(b.id, 50, 'delivery', 20)])
    expect(h!.source).toBe('HISTORY')
    expect(h!.perWeek).toBeCloseTo(8, 0) // 16 over about 2 weeks
  })
  it('count corrections are not counted as use', () => {
    const b = item()
    expect(weeklyUse(b, undefined, [mv(b.id, -8, 'count', 3)])).toBeNull()
  })
  it('states: no count, ok, low by point, low by lead time, out', () => {
    const a = item({ reorder_point: 10 })
    expect(stockState(a, 0, false, null)).toBe('NO COUNT')
    expect(stockState(a, 25, true, null)).toBe('OK')
    expect(stockState(a, 10, true, null)).toBe('LOW')
    expect(stockState(a, 0, true, null)).toBe('OUT')
    const l = item({ lead_time_days: 14 })
    expect(stockState(l, 20, true, 1.5)).toBe('LOW') // 10.5 days left < 14 day lead
    expect(stockState(l, 40, true, 4)).toBe('OK')
  })
  it('weeks left', () => {
    expect(weeksLeft(30, { perWeek: 10, source: 'PLAN' })).toBe(3)
    expect(weeksLeft(-2, { perWeek: 10, source: 'PLAN' })).toBe(0)
    expect(weeksLeft(5, null)).toBeNull()
  })
  it('meter marks the reorder point at a third', () => {
    expect(meterShape(item({ reorder_point: 10 }), 15, null)).toEqual({ frac: 0.5, mark: 1 / 3 })
    expect(meterShape(item({ reorder_point: 10 }), 99, null).frac).toBe(1)
  })
  it('run references count up through the day', () => {
    const a = item()
    const d = new Date('2026-11-05T12:00:00Z')
    expect(nextRunRef([], d)).toBe('RUN-20261105-1')
    expect(nextRunRef([{ ...mv(a.id, -1), run_ref: 'RUN-20261105-1' }], d)).toBe('RUN-20261105-2')
  })
})

describe('store', () => {
  const mk = () => new Store(new MemoryBackend())
  it('seeds the starter list once, empty', async () => {
    const s = mk()
    expect(await seedStarter(s, false)).toBe(SEED_ITEMS.length)
    expect(await seedStarter(s, true)).toBe(0) // nothing missing
    const items = s.rows<Item>('items')
    expect(items.every((i) => i.reorder_point === null && i.lead_time_days === null)).toBe(true)
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length)
    expect(s.rows('stock_moves')).toHaveLength(0)
  })
  it('seed codes match what the run plan books', () => {
    const codes = new Set(SEED_ITEMS.map((s) => s.code))
    for (const l of [...runLines(130), ...runLines(130, { form: 'combo' })]) expect(codes.has(l.code)).toBe(true)
  })
  it('deliveries, counts, runs and undo', async () => {
    const s = mk()
    await seedStarter(s, true)
    const items = s.rows<Item>('items')
    const saw = items.find((i) => i.code === 'SAWDUST')!
    await receive(s, saw.id, 500, 300, 'Mill')
    await setCount(s, saw.id, 500, 480)
    expect(onHandMap(s.rows<Move>('stock_moves')).get(saw.id)).toBe(480)
    const r = await bookRun(s, 'RUN-1', runLines(130), items, '130 BAGS')
    expect(r.booked).toBe(5)
    expect(onHandMap(s.rows<Move>('stock_moves')).get(saw.id)).toBeCloseTo(480 - 141.5, 1)
    await undoRun(s, 'RUN-1')
    expect(onHandMap(s.rows<Move>('stock_moves')).get(saw.id)).toBe(480)
    expect(s.rows('item_prices')).toHaveLength(1)
    await removeItem(s, saw.id)
    expect(s.rows('item_prices')).toHaveLength(0)
    expect(s.rows<Move>('stock_moves').some((m) => m.item_id === saw.id)).toBe(false)
  })
  it('a count of zero is still recorded', async () => {
    const s = mk()
    const a = item()
    await s.put('items', a)
    await setCount(s, a.id, 0, 0)
    expect(s.rows<Move>('stock_moves')).toHaveLength(1)
  })
  it('rolls back when a write fails', async () => {
    const b = new MemoryBackend()
    const s = new Store(b)
    b.put = async () => {
      throw new Error('boom')
    }
    await expect(s.put('items', item())).rejects.toThrow('boom')
    expect(s.rows('items')).toHaveLength(0)
  })
  it('refuses writes when locked', async () => {
    const s = new Store(new MemoryBackend('locked'))
    await expect(s.put('items', item())).rejects.toThrow(/LOCKED/)
  })
  it('exports and imports a backup, merging by id', async () => {
    const a = mk()
    await seedStarter(a, true)
    const saw = a.rows<Item>('items')[0]
    await receive(a, saw.id, 12, 100, null)
    const text = await a.exportJson()
    const b = mk()
    const counts = await b.importJson(text)
    expect(counts.items).toBe(SEED_ITEMS.length)
    expect(b.rows('stock_moves')).toHaveLength(1)
    await b.importJson(text) // again: no duplicates
    expect(b.rows('stock_moves')).toHaveLength(1)
    expect(b.rows('items')).toHaveLength(SEED_ITEMS.length)
  })
  it('rejects bad backups before writing anything', async () => {
    const s = mk()
    await expect(s.importJson('nope')).rejects.toThrow(/JSON/)
    await expect(s.importJson('{"app":"other"}')).rejects.toThrow(/NOT A MY/)
    await expect(s.importJson(JSON.stringify({ app: 'MY/CO/L', format: 9, tables: {} }))).rejects.toThrow(/FORMAT/)
    await expect(s.importJson(JSON.stringify({ app: 'MY/CO/L', format: 1, tables: { items: [{ id: 'a' }], evil: [] } }))).rejects.toThrow(/UNKNOWN TABLE/)
    await expect(s.importJson(JSON.stringify({ app: 'MY/CO/L', format: 1, tables: { items: [{ name: 'no id' }] } }))).rejects.toThrow(/BAD ROWS/)
    expect(s.rows('items')).toHaveLength(0)
  })
  it('makes valid uuids', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
