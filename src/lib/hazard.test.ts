import { describe, expect, it } from 'vitest'
import { HAZARDS, hazardById, hazardsForSpecies } from '../data/hazards'
import { SPECIES } from '../data/species'
import { PATTERNS, diagnose, findHazard, lossCounts, lossPickList, type HazardLog, type LotLoss } from './hazard'
import { FACT_RE } from '../manual/load'

describe('hazard library data', () => {
  it('has unique ids and every link points at a real entry', () => {
    const ids = HAZARDS.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const h of HAZARDS)
      for (const f of [...h.spot, ...h.look, ...h.cause, ...h.treat, ...h.prevent, ...h.risk]) if (f.hz) expect(hazardById(f.hz), `${h.id} -> ${f.hz}`).toBeTruthy()
    for (const p of PATTERNS) if (p.hz) expect(hazardById(p.hz)).toBeTruthy()
  })
  it('every claim carries a source or says there is no data', () => {
    for (const h of HAZARDS)
      for (const f of [...h.spot, ...h.look, ...h.cause, ...h.treat, ...h.prevent, ...h.risk]) {
        expect(f.s?.length, `${h.id}: ${f.v}`).toBeGreaterThan(0)
        for (const s of f.s!) expect(FACT_RE.test(s), `${h.id} ${s}`).toBe(true)
      }
  })
  it('species keys are real species', () => {
    const keys = new Set(SPECIES.map((s) => s.id))
    for (const h of HAZARDS) for (const k of h.species) expect(keys.has(k), `${h.id} ${k}`).toBe(true)
  })
  it('names the main organisms and the look-alikes', () => {
    for (const id of ['trichoderma', 'neurospora', 'bacterial-blotch', 'stroma', 'rose-comb', 'chestnut-mustard']) expect(hazardById(id)).toBeTruthy()
    expect(HAZARDS.some((h) => h.kind === 'yeast')).toBe(false)
  })
  it('species hazard facts that link out point at real entries', async () => {
    for (const sp of SPECIES) for (const f of sp.hazards) if (f.hz) expect(hazardById(f.hz), `${sp.id} ${f.k} -> ${f.hz}`).toBeTruthy()
    expect(SPECIES.flatMap((s) => s.hazards).filter((f) => f.hz).length).toBeGreaterThan(10)
  })
  it('lists the hazards for a species', () => {
    expect(hazardsForSpecies('lions-mane').map((h) => h.id)).toContain('trichoderma')
    expect(hazardsForSpecies('lions-mane').every((h) => h.kind !== 'notcontam')).toBe(true)
  })
})

describe('diagnose', () => {
  it('orange powder near the headspace is Neurospora first', () => {
    const r = diagnose({ colour: 'orange', texture: 'powdery', place: 'top' })
    expect(r[0].h.id).toBe('neurospora')
    expect(r[0].hits).toEqual(expect.arrayContaining(['COLOUR', 'TEXTURE', 'WHERE']))
  })
  it('golden-mustard chestnut turns up as a look-alike', () => {
    const r = diagnose({ colour: 'yellow', stage: 'block' })
    expect(r.some((m) => m.h.id === 'chestnut-mustard')).toBe(true)
  })
  it('stage is a hard filter', () => {
    const r = diagnose({ stage: 'plate' })
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((m) => m.h.stages.includes('plate'))).toBe(true)
  })
  it('a sour wet bottom points at bacteria', () => {
    const r = diagnose({ smell: 'sour', texture: 'wet', place: 'bottom' })
    expect(['wet-bottom', 'bacterial-film', 'fermented-block']).toContain(r[0].h.id)
  })
  it('no clues returns everything', () => {
    expect(diagnose({}).length).toBe(HAZARDS.length)
  })
})

describe('logged losses', () => {
  it('counts events and bags across both tables', () => {
    const logs = [
      { id: '1', hazard_key: 'neurospora', source_kind: 'grain', source_id: 'g', strain_id: null, bag_count: 3, noted_on: '2026-11-01', notes: null },
      { id: '2', hazard_key: null, source_kind: 'culture', source_id: 'c', strain_id: null, bag_count: 1, noted_on: '2026-11-01', notes: null },
    ] as HazardLog[]
    const lots = [{ id: '3', block_lot_id: 'l', hazard_key: 'neurospora', bag_count: 5, cause: null, noted_on: '2026-11-02', notes: null }] as LotLoss[]
    const m = lossCounts(logs, lots)
    expect(m.get('neurospora')).toEqual({ events: 2, bags: 8 })
    expect(m.size).toBe(1)
  })
  it('finds entries by id, name or unique prefix', () => {
    expect(findHazard('trichoderma')?.id).toBe('trichoderma')
    expect(findHazard('BLOTCH')?.id).toBe('bacterial-blotch')
    expect(findHazard('neuro')?.id).toBe('neurospora')
    expect(findHazard('ab')).toBeUndefined()
  })
  it('the loss picker leaves out look-alikes', () => {
    expect(lossPickList().some((h) => h.kind === 'notcontam')).toBe(false)
  })
})
