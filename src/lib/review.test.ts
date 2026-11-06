// G12 final review: regression checks for what the review found and fixed.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import { MODULES } from '../data/farm'
import { DEFAULT_SENSOR_SETTINGS, bandFor, bandText } from './sensors'
import type { EditEntry } from './history'

const settle = () => new Promise((r) => setTimeout(r, 5))

describe('G12 review: harvest that also moves the lot to fruiting', () => {
  // MISSION > HARVEST used to save the lot move and the pick as two separate writes (two UNDO steps).
  it('is one UNDO step and one history action, and UNDO puts both back', async () => {
    const st = new Store(new MemoryBackend())
    await st.ensure('block_lots')
    await st.ensure('harvests')
    await st.ensure(EDIT_LOG)
    const lot: Row = { id: 'L1', lot_code: 'BO-1104', status: 'incubating', room: 'incubation', to_fruiting_on: null, bag_count: 40 }
    await st.put('block_lots', lot, { label: 'TEST SEED' })
    await settle()
    const before = st.undoList().length

    await st.action('HARVEST BO-1104', async () => {
      await st.put('block_lots', { ...lot, status: 'fruiting', to_fruiting_on: '2026-11-06', room: 'fruiting' })
      await st.put('harvests', { id: 'H1', block_lot_id: 'L1', harvested_on: '2026-11-06', flush: 1, kg: 4.2, grade: 'A', initials: 'JM' })
    })
    await settle()
    expect(st.undoList().length).toBe(before + 1)
    expect(st.undoList()[0].label).toBe('HARVEST BO-1104')
    const log = st.rows<EditEntry>(EDIT_LOG).filter((e) => e.table_name !== EDIT_LOG)
    const tables = new Set(log.filter((e) => e.row_id === 'H1' || (e.row_id === 'L1' && e.op === 'update')).map((e) => e.table_name))
    expect([...tables].sort()).toEqual(['block_lots', 'harvests'])

    await st.undo()
    await settle()
    expect(st.rows('harvests').find((h) => h.id === 'H1')).toBeUndefined()
    expect(st.rows('block_lots').find((l) => l.id === 'L1')?.status).toBe('incubating')
  })
})

describe('G12 review: menu order', () => {
  it('lists modules by their number (11 MANUAL before 12 MISSION)', () => {
    const nums = MODULES.map((m) => m.num)
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
    expect(new Set(nums).size).toBe(nums.length)
  })
})

describe('G12 review: alarm bands', () => {
  // ATMOSPHERICS NOW and LOG READING both read bandFor(); LOG READING now names the place next to the band.
  it('gives each place one band, the same on every screen', () => {
    expect(bandText(bandFor(DEFAULT_SENSOR_SETTINGS, 'lab', 'temp'), 'temp')).toBe(bandText({ lo: 16, hi: 21 }, 'temp'))
    expect(bandText(bandFor(DEFAULT_SENSOR_SETTINGS, 'fruiting', 'temp'), 'temp')).toBe(bandText({ lo: 13, hi: 19 }, 'temp'))
  })
})
