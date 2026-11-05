import { describe, expect, it } from 'vitest'
import { ROTATIONS, averageSplit, frequencyText, planBagsFor, slotSpecies, weekSplit } from '../data/cropplan'

const rot = (id: string) => ROTATIONS.find((r) => r.id === id)!

describe('crop plan', () => {
  it('every week is exactly 130 bags', () => {
    for (const r of ROTATIONS) for (const d of ['2026-11-10', '2026-11-17', '2026-11-24', '2027-01-05']) {
      expect(weekSplit(d, r).reduce((n, x) => n + x.bags, 0)).toBe(130)
    }
  })
  it('golden and phoenix alternate week to week, never in the same week', () => {
    const a = slotSpecies('2026-11-10', rot('gp'))
    const b = slotSpecies('2026-11-17', rot('gp'))
    expect(new Set([a, b])).toEqual(new Set(['golden-oyster', 'phoenix-oyster']))
    expect(slotSpecies('2026-11-24', rot('gp'))).toBe(a)
  })
  it('the cycle is continuous across a year end', () => {
    const seq = ['2026-12-22', '2026-12-29', '2027-01-05', '2027-01-12'].map((d) => slotSpecies(d, rot('spec')))
    expect(new Set(seq).size).toBe(3) // pink, pioppino, pink, chestnut in some order
    expect(seq.filter((s) => s === 'pink-oyster')).toHaveLength(2)
  })
  it('averages slot species over the cycle', () => {
    const avg = averageSplit(rot('pgpp'))
    expect(avg.find((x) => x.key === 'pink-oyster')!.bags).toBe(8)
    expect(avg.find((x) => x.key === 'golden-oyster')!.bags).toBe(4)
    expect(avg.reduce((n, x) => n + x.bags, 0)).toBe(130)
  })
  it('reports bags and frequency', () => {
    expect(planBagsFor('blue-oyster', rot('pink'))).toBe(52)
    expect(planBagsFor('golden-oyster', rot('pink'))).toBeNull()
    expect(frequencyText('pink-oyster', rot('pink'))).toBe('EVERY WEEK')
    expect(frequencyText('chestnut', rot('spec'))).toBe('1 IN 4 WEEKS')
  })
})
