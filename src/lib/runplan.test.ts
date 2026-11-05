import { describe, expect, it } from 'vitest'
import { allot } from './runplan'
import { SPECIES } from '../data/species'

const pick = (...ids: string[]) => ids.map((id) => SPECIES.find((s) => s.id === id)!)

describe('run planner', () => {
  it('splits 130 bags by the crop plan and uses every bag', () => {
    const a = allot(130, pick('blue-oyster', 'lions-mane', 'comb-tooth', 'golden-oyster'))
    expect(a.reduce((n, x) => n + x.bags, 0)).toBe(130)
    expect(a[0].bags).toBe(52)
  })
  it('gives a single species the whole run', () => {
    expect(allot(77, pick('blue-oyster'))[0].bags).toBe(77)
  })
  it('handles any bag count', () => {
    for (const n of [1, 7, 50, 100, 333]) expect(allot(n, pick('blue-oyster', 'lions-mane', 'pink-oyster')).reduce((s, x) => s + x.bags, 0)).toBe(n)
  })
  it('halves golden and phoenix when both are chosen', () => {
    const a = allot(26, pick('golden-oyster', 'phoenix-oyster'))
    expect(a[0].bags).toBe(13)
    expect(a[1].bags).toBe(13)
  })
})
