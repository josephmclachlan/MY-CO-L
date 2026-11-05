import { describe, expect, it } from 'vitest'
import { averageSplit, frequencyText, planBagsFor, setSlot, setWeek, slotSpecies, weekSplit, type CropPlan } from '../data/cropplan'

describe('crop plan', () => {
  it('every week is exactly 130 bags, whatever the slot holds', () => {
    for (const slot of ['golden-oyster', 'pink-oyster', 'chestnut', 'reishi']) {
      const p: CropPlan = { slot, weeks: {} }
      expect(weekSplit('2026-11-10', p).reduce((n, x) => n + x.bags, 0)).toBe(130)
      expect(averageSplit(p).reduce((n, x) => n + x.bags, 0)).toBe(130)
    }
  })
  it('the picked species fills every week; a single week can be set to another', () => {
    setSlot('pink-oyster')
    setWeek('2026-11-17', 'chestnut')
    expect(slotSpecies('2026-11-10')).toBe('pink-oyster')
    expect(slotSpecies('2026-11-17')).toBe('chestnut')
    expect(slotSpecies('2026-11-19')).toBe('chestnut') // same week
    expect(slotSpecies('2026-11-24')).toBe('pink-oyster')
    setWeek('2026-11-17', null)
    expect(slotSpecies('2026-11-17')).toBe('pink-oyster')
  })
  it('picking a new usual species clears week choices that match it', () => {
    setSlot('golden-oyster')
    setWeek('2026-12-01', 'phoenix-oyster')
    setSlot('phoenix-oyster')
    expect(slotSpecies('2026-12-01')).toBe('phoenix-oyster')
  })
  it('reports bags and frequency', () => {
    const p: CropPlan = { slot: 'pink-oyster', weeks: {} }
    expect(planBagsFor('blue-oyster', p)).toBe(52)
    expect(planBagsFor('pink-oyster', p)).toBe(16)
    expect(planBagsFor('golden-oyster', p)).toBeNull()
    expect(frequencyText('comb-tooth', p)).toBe('EVERY WEEK')
  })
})
