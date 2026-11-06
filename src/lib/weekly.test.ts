// Joseph's answers 6 Nov 2026: Catawba-style weekly sheets, Friday culture check, hours per task, no future dates.
// Mock trials with hand-worked expected outputs.

import { describe, expect, it } from 'vitest'
import type { BlockLot, Culture, GrainRun, Strain } from './xeno'
import { notFuture } from './xeno'
import type { Harvest, LabourEntry } from './ledger'
import type { Sale } from './trade'
import { knockChart, lastWeeks, weeklyHarvest } from './records'
import { fridayCheck } from './bank'
import { taskOf, taskReport, timerHours } from './tasks'

const TODAY = '2026-11-06' // a Friday; its week starts Monday 2 Nov
const lot = (id: string, sp: string, knock: string, bags: number): BlockLot => ({
  id, lot_code: id.toUpperCase(), species_key: sp, strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: bags, knock_date: knock, status: 'fruiting', notes: null,
})
const harv = (id: string, lotId: string, day: string, kg: number): Harvest => ({ id, block_lot_id: lotId, harvested_on: day, flush: 1, kg, grade: 'A', initials: 'JM', notes: null })
const lab = (id: string, day: string, task: string, hours: number, person = 'JM'): LabourEntry => ({ id, worked_on: day, person, hours, task, block_lot_id: null, notes: null })

describe('lastWeeks', () => {
  it('lists n Mondays ending with this week, oldest first', () => {
    const w = lastWeeks(TODAY, 3)
    expect(w.map((x) => x.monday)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
    expect(new Set(w.map((x) => x.week)).size).toBe(3)
  })
})

describe('weekly harvest sheet', () => {
  const lots = [lot('b1', 'blue-oyster', '2026-10-06', 40), lot('l1', 'lions-mane', '2026-10-06', 20)]
  const hs = [
    harv('h1', 'b1', '2026-10-27', 10), // week of 26 Oct
    harv('h2', 'b1', '2026-10-30', 5.5), // same week
    harv('h3', 'b1', '2026-11-03', 8), // this week
    harv('h4', 'l1', '2026-11-04', 3),
    harv('h5', 'b1', '2026-09-01', 99), // outside the 4-week window
    harv('h6', 'gone', '2026-11-04', 7), // no lot: ignored
  ]
  it('totals kg per species per week, with the 4-week average', () => {
    const s = weeklyHarvest(hs, lots, TODAY, 4)
    expect(s.rows.map((r) => r.species)).toEqual(['blue-oyster', 'lions-mane'])
    expect(s.rows[0].byWeek).toEqual([0, 0, 15.5, 8])
    expect(s.rows[0].total).toBe(23.5)
    expect(s.rows[0].avg4).toBeCloseTo(23.5 / 4)
    expect(s.totals).toEqual([0, 0, 15.5, 11])
  })
})

describe('weekly knock chart', () => {
  it('counts blocks per knock week and expected kg', () => {
    const lots = [lot('b1', 'blue-oyster', '2026-11-03', 40), lot('b2', 'blue-oyster', '2026-10-27', 30), lot('c1', 'chestnut', '2026-11-03', 10)]
    const s = knockChart(lots, TODAY, (sp) => (sp === 'blue-oyster' ? 0.9 : null), 2)
    const bo = s.rows.find((r) => r.species === 'blue-oyster')!
    expect(bo.byWeek).toEqual([30, 40])
    expect(bo.expectedKg).toBeCloseTo(63)
    expect(s.rows.find((r) => r.species === 'chestnut')!.expectedKg).toBeUndefined()
    expect(s.totals).toEqual([30, 50])
  })
})

describe('Friday culture check', () => {
  const s: Strain = { id: 's1', species_key: 'blue-oyster', code: 'BO-01', name: null, source: null, active: true, notes: null }
  const off: Strain = { ...s, id: 's2', code: 'BO-02', active: false }
  const cult = (id: string, kind: Culture['kind'], made: string, p: number | null = 1): Culture => ({
    id, strain_id: 's1', parent_culture_id: null, kind, p_level: p, made_on: made, status: 'clean', cold_since: null, location: null, label: null, notes: null,
  })
  const grain = (id: string, on: string, status: GrainRun['status'] = 'ready'): GrainRun => ({
    id, generation: 'G1', strain_id: 's1', parent_culture_id: null, parent_grain_run_id: null, parent_bags_used: null, bag_count: 4, bags_lost: 0, cook_run_id: null, inoculated_on: on, status, cold_since: null, location: null, label: null, result: null, notes: null,
  })
  it('lists every missing item for an active strain only', () => {
    const rows = fridayCheck([s, off], [], [], [], [], [], undefined, TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].missing).toEqual(['FRESH PLATE', 'SLANT', 'WATER TUBE', 'BACKUP SPAWN'])
  })
  it('passes with a fresh plate, banked tubes and young spawn', () => {
    const rows = fridayCheck([s], [cult('p', 'plate', '2026-10-20'), cult('sl', 'slant', '2026-10-01'), cult('w', 'water', '2026-10-01')], [grain('g', '2026-10-10')], [], [], [], undefined, TODAY)
    expect(rows[0].missing).toEqual([])
    expect(rows[0].plate?.id).toBe('p')
    expect(rows[0].spawn?.id).toBe('g')
  })
  it('does not count an old plate, a P0 master or spawn over 6 weeks', () => {
    const rows = fridayCheck([s], [cult('old', 'plate', '2026-09-01'), cult('m', 'plate', '2026-11-01', 0)], [grain('g', '2026-09-20'), grain('used', '2026-11-01', 'used_up')], [], [], [], undefined, TODAY)
    expect(rows[0].missing).toContain('FRESH PLATE')
    expect(rows[0].missing).toContain('BACKUP SPAWN')
  })
})

describe('hours per task', () => {
  it('matches free text to the standard tasks, longest phrase first', () => {
    expect(taskOf('KNOCK')).toBe('knock')
    expect(taskOf('STEAM RUN // CART C-07')).toBe('steam')
    expect(taskOf('check bags in incubation')).toBe('incubation')
    expect(taskOf('label boxes')).toBe('pack')
    expect(taskOf('agar plates')).toBe('culture')
    expect(taskOf('')).toBe('other')
    expect(taskOf(null)).toBe('other')
    expect(taskOf('chatting')).toBe('other')
  })
  it('sums hours per task and per person, with a rate on the days logged', () => {
    const entries = [
      lab('a', '2026-11-03', 'KNOCK', 4),
      lab('b', '2026-11-03', 'KNOCK', 2, 'ana'),
      lab('c', '2026-11-02', 'STEAM RUN', 5),
      lab('d', '2026-11-04', 'HARVEST', 2),
      lab('e', '2026-11-04', 'cleaning', 1),
      lab('f', '2026-08-01', 'KNOCK', 9), // outside the window
      lab('g', '2026-11-04', 'KNOCK', 0), // zero hours ignored
    ]
    const lots = [lot('b1', 'blue-oyster', '2026-11-03', 60)]
    const sales: Sale[] = []
    const r = taskReport(entries, { lots, harvests: [harv('h', 'b1', '2026-11-04', 10)], sales }, TODAY, 4)
    expect(r.total).toBe(14)
    const knock = r.rows.find((x) => x.task === 'knock')!
    expect(knock.hours).toBe(6)
    expect(knock.output).toBe(60)
    expect(knock.perHour).toBe(10)
    expect(knock.people).toEqual(['ANA', 'JM'])
    expect(knock.byWeek).toEqual([0, 0, 0, 6])
    expect(knock.sharePct).toBeCloseTo((6 / 14) * 100)
    const steam = r.rows.find((x) => x.task === 'steam')!
    expect(steam.output).toBe(60) // blocks knocked the same week
    expect(r.rows.find((x) => x.task === 'harvest')!.perHour).toBe(5)
    expect(r.rows.find((x) => x.task === 'clean')!.perHour).toBeNull()
    expect(r.rows[0].task).toBe('knock')
    expect(r.byPerson).toEqual([{ person: 'JM', hours: 12 }, { person: 'ANA', hours: 2 }])
  })
  it('rounds a timer to 3 minutes, never below 0.05 h', () => {
    expect(timerHours(0, 90 * 60000)).toBe(1.5)
    expect(timerHours(0, 10 * 60000)).toBe(0.15)
    expect(timerHours(0, 30000)).toBe(0.05)
    expect(timerHours(1000, 0)).toBe(0.05)
  })
})

describe('no future dates', () => {
  it('refuses a day after today and a missing day', () => {
    expect(() => notFuture('2026-11-06', 'HARVEST', TODAY)).not.toThrow()
    expect(() => notFuture('2026-11-07', 'HARVEST', TODAY)).toThrow(/FUTURE/)
    expect(() => notFuture('2027-01-09', 'KNOCK', TODAY)).toThrow(/KNOCK DAY 2027-01-09/)
    expect(() => notFuture('', 'KNOCK', TODAY)).toThrow(/PICK THE KNOCK DAY/)
  })
})
