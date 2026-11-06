import { describe, expect, it } from 'vitest'
import { MemoryBackend, Store } from './store'
import {
  buildTree,
  checkAge,
  ageLimit,
  childP,
  cultureAge,
  flatten,
  grainAge,
  grainRemaining,
  keyFromHash,
  nextKnockDay,
  nextStrainCode,
  pCounts,
  planChain,
  recordUrl,
  shortfall,
  strainStock,
  type BlockLot,
  type Culture,
  type GrainRun,
  type Strain,
} from './xeno'
import { addCultures, addGrainRun, addLot, contaminateCulture, loadDemo, lossGrainRun, lossLot, newStrain, removeDemo, setCultureStatus, setGrainStatus } from './xenoActions'
import { lossCounts, type HazardLog, type LotLoss } from './hazard'

const NOW = '2026-11-05'

describe('P-levels (confirmed by Joseph 5 Nov 2026)', () => {
  it('master is P0, a plate is one up, copies keep the level', () => {
    expect(childP(null, 'slant')).toBe(0)
    expect(childP(null, 'plate')).toBe(1)
    expect(childP({ p_level: 0 }, 'plate')).toBe(1)
    expect(childP({ p_level: 1 }, 'plate')).toBe(2)
    expect(childP({ p_level: 1 }, 'slant')).toBe(1)
    expect(childP({ p_level: 2 }, 'liquid')).toBe(2)
  })
})

describe('strain codes', () => {
  it('numbers each species on its own', () => {
    const s = [newStrain({ species_key: 'lions-mane', code: 'LM-01' }), newStrain({ species_key: 'lions-mane', code: 'LM-04' })]
    expect(nextStrainCode('lions-mane', s)).toBe('LM-05')
    expect(nextStrainCode('blue-oyster', s)).toBe('BO-01')
    expect(s[0].source).toBe('Cap n Stem (CNS)')
  })
})

describe('age limits from t07-t09', () => {
  it('plates warn at 60 days and are over at 3 months', () => {
    expect(checkAge(ageLimit('plate'), '2026-08-01', null, NOW).state).toBe('over')
    expect(checkAge(ageLimit('plate'), '2026-09-01', null, NOW).state).toBe('warn')
    expect(checkAge(ageLimit('plate'), '2026-10-20', null, NOW).state).toBe('ok')
  })
  it('G2 counts from the day it went cold: 2 weeks, 3 at most; lion’s mane 2', () => {
    const g = { generation: 'G2', inoculated_on: '2026-10-01', status: 'cold_storage', cold_since: '2026-10-20' } as GrainRun
    expect(grainAge(g, 'blue-oyster', NOW).state).toBe('warn') // 16 days
    expect(grainAge(g, 'lions-mane', NOW).state).toBe('over')
    expect(grainAge({ ...g, cold_since: '2026-10-10' }, 'blue-oyster', NOW).state).toBe('over')
  })
  it('a master left warm past week 3 says use or chill', () => {
    const g = { generation: 'G1', inoculated_on: '2026-10-01', status: 'incubating', cold_since: null } as GrainRun
    expect(grainAge(g, 'blue-oyster', NOW).text).toMatch(/USE OR CHILL/)
  })
  it('LC has no limit in the sources', () => {
    expect(cultureAge({ kind: 'liquid', made_on: '2025-01-01', cold_since: null } as Culture, NOW).state).toBe('none')
  })
})

describe('expansion planner', () => {
  it('farm rule: 52 blue oyster blocks = 3 G2 from one master every week (t09 Our farm)', () => {
    const p = planChain('blue-oyster', 52, '2026-11-10')
    expect(p.g2).toBe(3)
    expect(p.route).toBe('weekly')
    expect(p.g1).toBe(1)
    expect(p.g2Made).toBe(3)
    expect(p.plates).toBe(1)
    expect(p.g1By).toBe('2026-10-15')
  })
  it('farm rule: the 130-bag week is 3/3/1/1 G2 and 4 masters', () => {
    const w = [['blue-oyster', 52], ['lions-mane', 46], ['comb-tooth', 16], ['golden-oyster', 16]] as const
    const ps = w.map(([k, b]) => planChain(k, b, '2026-11-10'))
    expect(ps.map((p) => p.g2)).toEqual([3, 3, 1, 1])
    expect(ps.map((p) => p.g1)).toEqual([1, 1, 1, 1])
  })
  it('option: 52 blue oyster blocks, one master every 2 weeks', () => {
    const p = planChain('blue-oyster', 52, '2026-11-10', 'fortnight')
    expect(p.g2).toBe(3)
    expect(p.route).toBe('fortnight')
    expect(p.g2Made).toBe(6)
    expect(p.g2By).toBe('2026-10-29') // 12 days
    expect(p.g1By).toBe('2026-10-15') // 2 weeks before
    expect(p.plateBy).toBe('2026-10-07') // oysters 8 days
  })
  it('130 blocks of one species: 7 G2 from one weekly master', () => {
    const p = planChain('lions-mane', 130, '2026-11-10')
    expect(p.g2).toBe(7)
    expect(p.route).toBe('weekly')
    expect(p.g1).toBe(1)
    expect(p.plates).toBe(1)
  })
  it('never plans more than 24 G2 per master; the fortnight option never fewer than 6', () => {
    for (const b of [1, 20, 60, 100, 121, 200, 400, 1000, 5000]) {
      const w = planChain('blue-oyster', b, '2026-11-10')
      if (w.g1) expect(w.g2Made / w.g1).toBeLessThanOrEqual(24)
      const p = planChain('blue-oyster', b, '2026-11-10', 'fortnight')
      if (p.g1) expect(p.g2Made / p.g1).toBeGreaterThanOrEqual(6)
      if (p.g1) expect(p.g2Made / p.g1).toBeLessThanOrEqual(24)
    }
  })
  it('option: small batches go agar-direct', () => {
    const p = planChain('comb-tooth', 16, '2026-11-10', 'direct')
    expect(p.route).toBe('direct')
    expect(p.g1).toBe(0)
    expect(p.plates).toBe(1)
    expect(p.g1By).toBeNull()
  })
  it('walks down the shelf: G2, then masters, then plates', () => {
    const p = planChain('lions-mane', 130, '2026-11-10')
    expect(shortfall(p, { plates: 0, g1: 0, g2: 7 }).level).toBe('ok')
    expect(shortfall(p, { plates: 0, g1: 1, g2: 0 }).next).toMatch(/MASTER/)
    expect(shortfall(p, { plates: 1, g1: 0, g2: 0 }).next).toMatch(/INOCULATE/)
    expect(shortfall(p, { plates: 0, g1: 0, g2: 2 }).level).toBe('short')
  })
  it('knock day is the next Tuesday', () => {
    expect(nextKnockDay('2026-11-05')).toBe('2026-11-10') // Thursday -> Tuesday
    expect(nextKnockDay('2026-11-10')).toBe('2026-11-10')
  })
})

describe('labels and QR links', () => {
  it('round-trips a record key through the address', () => {
    const url = recordUrl('c:1234-abcd')
    expect(url).toBe('https://josephmclachlan.github.io/MY-CO-L/#xeno/c/1234-abcd')
    expect(keyFromHash('#xeno/c/1234-abcd')).toBe('c:1234-abcd')
    expect(keyFromHash('#something')).toBeNull()
  })
})

describe('logging a line in the store', () => {
  it('master -> plates -> G1 -> G2 -> blocks, with counts and the tree', async () => {
    const store = new Store(new MemoryBackend())
    const s = newStrain({ species_key: 'lions-mane', code: 'LM-01' })
    await store.put('strains', s)
    const [m] = await addCultures(store, { strain: s, parent: null, kind: 'slant', count: 1, existing: [] })
    expect(m.p_level).toBe(0)
    const p1 = await addCultures(store, { strain: s, parent: m, kind: 'plate', count: 3, existing: store.rows<Culture>('cultures') })
    expect(p1.map((c) => c.label)).toEqual(expect.arrayContaining([expect.stringMatching(/^LM-01 P1 PL \d{4}-1$/), expect.stringMatching(/-3$/)]))
    const g1 = await addGrainRun(store, { strain: s, generation: 'G1', parentCulture: p1[0], parentRun: null, bags: 2, existing: [] })
    const g2 = await addGrainRun(store, { strain: s, generation: 'G2', parentCulture: null, parentRun: g1, bags: 12, mastersUsed: 1, existing: store.rows<GrainRun>('grain_runs') })
    await expect(addGrainRun(store, { strain: s, generation: 'G2', parentCulture: null, parentRun: g2, bags: 12, existing: [] })).rejects.toThrow(/NO G3/)
    await addLot(store, { strain: s, run: g2, lot_code: 'L1110', blocks: 100, g2Used: 5 })
    await setCultureStatus(store, p1[2], 'contaminated')

    const cs = store.rows<Culture>('cultures')
    const gs = store.rows<GrainRun>('grain_runs')
    const ls = store.rows<BlockLot>('block_lots')
    expect(pCounts(s.id, cs)).toMatchObject({ master: 1, p: [2, 0, 0, 0] })
    expect(grainRemaining(gs.find((g) => g.id === g1.id)!, gs, ls)).toBe(1)
    expect(grainRemaining(gs.find((g) => g.id === g2.id)!, gs, ls)).toBe(7)
    expect(strainStock(s.id, s.species_key, cs, gs, ls)).toEqual({ plates: 2, g1: 1, g2: 7 })

    await setGrainStatus(store, gs.find((g) => g.id === g2.id)!, 'incubating', 2)
    expect(grainRemaining(store.rows<GrainRun>('grain_runs').find((g) => g.id === g2.id)!, store.rows('grain_runs') as GrainRun[], ls)).toBe(5)

    const tree = buildTree(s, cs, store.rows<GrainRun>('grain_runs'), ls)
    const all = flatten(tree)
    expect(all.map((n) => n.type)).toEqual(['strain', 'culture', 'culture', 'grain', 'grain', 'lot', 'culture', 'culture'])
    expect(Math.max(...all.map((n) => n.x))).toBe(5) // strain > master > P1 > G1 > G2 > lot
  })

  it('loads and removes the example strain cleanly', async () => {
    const store = new Store(new MemoryBackend())
    await loadDemo(store, [])
    const strains = store.rows<Strain>('strains')
    expect(strains).toHaveLength(1)
    expect(store.rows('cultures').length).toBeGreaterThan(5)
    await removeDemo(store, strains, store.rows<Culture>('cultures'), store.rows<GrainRun>('grain_runs'), store.rows<BlockLot>('block_lots'))
    for (const t of ['strains', 'cultures', 'grain_runs', 'block_lots']) expect(store.rows(t)).toHaveLength(0)
  })

  it('logs contamination against the hazard library and counts it', async () => {
    const store = new Store(new MemoryBackend())
    const s = newStrain({ species_key: 'blue-oyster', code: 'BO-01' })
    await store.put('strains', s)
    const [m] = await addCultures(store, { strain: s, parent: null, kind: 'slant', count: 1, existing: [] })
    const [p1] = await addCultures(store, { strain: s, parent: m, kind: 'plate', count: 1, existing: [m] })
    await contaminateCulture(store, p1, 'trichoderma')
    expect(store.rows<Culture>('cultures').find((c) => c.id === p1.id)?.status).toBe('contaminated')
    const g1 = await addGrainRun(store, { strain: s, generation: 'G1', parentCulture: m, parentRun: null, bags: 4, existing: [] })
    await lossGrainRun(store, g1, 2, 'neurospora')
    await lossGrainRun(store, store.rows<GrainRun>('grain_runs')[0], 3, 'neurospora') // one more bag, not three
    const g2 = await addGrainRun(store, { strain: s, generation: 'G2', parentCulture: null, parentRun: g1, bags: 6, mastersUsed: 1, existing: store.rows<GrainRun>('grain_runs') })
    const lot = await addLot(store, { strain: s, run: g2, lot_code: 'B1105', blocks: 10, g2Used: 1 })
    await lossLot(store, lot, [], 4, 'neurospora', 'seal')
    await expect(lossLot(store, lot, store.rows<LotLoss>('lot_losses'), 7, 'neurospora')).rejects.toThrow(/ALREADY LOGGED/)
    await expect(lossLot(store, lot, [], 0, null)).rejects.toThrow(/HOW MANY/)
    const m2 = lossCounts(store.rows<HazardLog>('hazard_logs'), store.rows<LotLoss>('lot_losses'))
    expect(m2.get('trichoderma')).toEqual({ events: 1, bags: 1 })
    expect(m2.get('neurospora')).toEqual({ events: 3, bags: 7 })
    await lossLot(store, lot, store.rows<LotLoss>('lot_losses'), 6, null)
    expect(store.rows<BlockLot>('block_lots').find((l) => l.id === lot.id)?.status).toBe('lost')
  })

  it('removing the example strain also clears its logged losses', async () => {
    const store = new Store(new MemoryBackend())
    await loadDemo(store, [])
    const strains = store.rows<Strain>('strains')
    const lot = store.rows<BlockLot>('block_lots')[0]
    await lossLot(store, lot, [], 5, 'neurospora')
    const c = store.rows<Culture>('cultures')[0]
    await contaminateCulture(store, c, 'trichoderma')
    await removeDemo(store, strains, store.rows<Culture>('cultures'), store.rows<GrainRun>('grain_runs'), store.rows<BlockLot>('block_lots'))
    expect(store.rows('hazard_logs')).toHaveLength(0)
    expect(store.rows('lot_losses')).toHaveLength(0)
  })
})
