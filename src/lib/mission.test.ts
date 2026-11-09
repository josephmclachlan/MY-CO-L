import { describe, expect, it } from 'vitest'
import { board, boardRow, expectFor, nextFlush, suggestCode, todayList, setLiveFlushPlan } from './mission'
import { TEST_FLUSH_MAX } from './bank'
import type { BlockLot } from './xeno'
import type { Harvest } from './ledger'

const lot = (p: Partial<BlockLot>): BlockLot => ({ id: 'l1', lot_code: 'B1020', species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 52, knock_date: '2026-10-20', status: 'incubating', notes: null, ...p }) as BlockLot
const hv = (p: Partial<Harvest>): Harvest => ({ id: 'h', block_lot_id: 'l1', harvested_on: '2026-11-12', flush: 1, kg: 10, grade: 'A', initials: 'JM', notes: null, ...p }) as Harvest

describe('mission control', () => {
  it('uses the memory day counts', () => {
    expect(expectFor('blue-oyster').firstDays).toBe(23)
    expect(expectFor('lions-mane').firstDays).toBe(24)
    expect(expectFor('comb-tooth').firstDays).toBe(31)
    expect(expectFor('pink-oyster').firstDays).toBe(18)
    // Every crop is IN TEST until a count is committed (Joseph 6 Nov 2026).
    expect(expectFor('lions-mane').flushes).toBe(TEST_FLUSH_MAX)
    expect(expectFor('lions-mane').flushTest).toBe(true)
    setLiveFlushPlan({ 'lions-mane': 2 })
    expect(expectFor('lions-mane').flushes).toBe(2)
    expect(expectFor('lions-mane').flushTest).toBe(false)
    expect(expectFor('blue-oyster').flushTest).toBe(true)
    setLiveFlushPlan({})
  })
  it('shows NO DATA for a species without figures', () => {
    const r = boardRow(lot({ species_key: 'reishi' }), [], [], '2026-11-05')
    expect(r.harvestFlag).toBe('NO DATA')
    expect(r.expKg).toBeNull()
  })
  it('flags the move window and expected harvest', () => {
    expect(boardRow(lot({}), [], [], '2026-10-28').move).toBe('WAIT')
    expect(boardRow(lot({}), [], [], '2026-10-31').move).toBe('DUE')
    expect(boardRow(lot({}), [], [], '2026-11-05').move).toBe('LATE')
    const r = boardRow(lot({ status: 'fruiting' }), [], [], '2026-11-12')
    expect(r.harvestOn).toBe('2026-11-12')
    expect(r.harvestFlag).toBe('DUE')
    expect(boardRow(lot({ status: 'fruiting' }), [], [], '2026-11-14').harvestFlag).toBe('LATE')
  })
  it('takes lost blocks off the expected kg and counts logged kg', () => {
    const full = boardRow(lot({}), [], [], '2026-11-01')
    const lost = boardRow(lot({}), [{ id: 'x', block_lot_id: 'l1', hazard_key: null, bag_count: 2, cause: null, noted_on: '', notes: null, created_at: '' }], [hv({})], '2026-11-01')
    expect(lost.blocks).toBe(50)
    expect(lost.expKg!).toBeCloseTo(full.expKg! * 50 / 52, 6)
    expect(lost.gotKg).toBe(10)
    expect(lost.harvestFlag).toBe('PICKING')
  })
  it('hides finished lots and picks the next flush', () => {
    expect(board([lot({ status: 'spent' }), lot({ id: 'l2' })], [], [], '2026-11-01')).toHaveLength(1)
    expect(nextFlush([hv({ flush: 1 })], 'l1')).toBe(2)
    expect(nextFlush([], 'l1')).toBe(1)
  })
  it('suggests a free lot code', () => {
    expect(suggestCode('blue-oyster', '2026-10-20', [])).toBe('B1020')
    expect(suggestCode('blue-oyster', '2026-10-20', [lot({})])).toBe('B1020-2')
    expect(suggestCode('comb-tooth', '2026-11-03', [])).toBe('CT1103') // Catawba letters
    expect(suggestCode('golden-oyster', '2026-11-03', [])).toBe('Y1103')
  })
  it('builds the TODAY list', () => {
    const rows = board([lot({}), lot({ id: 'l2', lot_code: 'L1013', species_key: 'lions-mane', knock_date: '2026-10-13', status: 'fruiting' })], [], [], '2026-11-06')
    const t = todayList({ rows, cultures: [], grain: [], strains: [], reorders: [{ id: 'i1', name: 'Soy hulls', state: 'LOW', weeks: 1.5 }], now: '2026-11-06' })
    expect(t.map((x) => x.kind)).toEqual(['MOVE', 'HARVEST', 'REORDER'])
  })
})
