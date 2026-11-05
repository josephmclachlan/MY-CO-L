import { describe, expect, it } from 'vitest'
import { outcomeFor } from './cookOutcome'
import type { BlockLot, GrainRun } from './xeno'
import type { HazardLog, LotLoss } from './hazard'

const lot = (id: string, run: string | null, bags: number): BlockLot => ({ id, lot_code: `B${id}`, species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, cook_run_id: run, bag_count: bags, knock_date: '2026-11-03', status: 'incubating', notes: null })
const grain = (id: string, run: string | null, bags: number, lost: number): GrainRun => ({ id, generation: 'G2', strain_id: 's', parent_culture_id: null, parent_grain_run_id: null, parent_bags_used: null, bag_count: bags, bags_lost: lost, cook_run_id: run, inoculated_on: '2026-11-04', status: 'incubating', cold_since: null, location: null, label: null, result: null, notes: null })
const loss = (id: string, lotId: string, bags: number, key: string | null): LotLoss => ({ id, block_lot_id: lotId, hazard_key: key, bag_count: bags, cause: null, noted_on: '2026-11-10', notes: null })
const log = (id: string, gid: string, key: string | null): HazardLog => ({ id, hazard_key: key, source_kind: 'grain', source_id: gid, strain_id: null, bag_count: 1, noted_on: '2026-11-10', notes: null })

describe('outcomeFor', () => {
  it('adds up loaded and lost across the lots and grain runs linked to one cook', () => {
    const o = outcomeFor('r1', [lot('1', 'r1', 52), lot('2', 'r1', 46), lot('3', 'r2', 99)], [grain('g1', 'r1', 8, 2), grain('g2', null, 8, 8)], [loss('a', '1', 3, 'trichoderma'), loss('b', '1', 2, null), loss('c', '3', 50, 'trichoderma')], [log('x', 'g1', 'neurospora')])
    expect(o.loaded).toBe(52 + 46 + 8)
    expect(o.lost).toBe(5 + 0 + 2)
    expect(o.lots).toHaveLength(2)
    expect(o.lots[0].causes).toHaveLength(1)
    expect(o.grain[0].causes).toHaveLength(1)
  })
  it('is empty when nothing is linked', () => {
    const o = outcomeFor('none', [lot('1', 'r1', 52)], [], [], [])
    expect(o.loaded).toBe(0)
    expect(o.lost).toBe(0)
  })
})
