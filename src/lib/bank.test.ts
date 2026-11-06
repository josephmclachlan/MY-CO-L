// G3 culture bank + practice defaults: mock trials, logging, history resilience, expected outputs, stress.
// Joseph's rule (6 Nov 2026): every function's task run end to end with farm data, outputs checked by hand.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import type { EditEntry } from './history'
import { rng } from './testkit'
import { addDays, planChain, type BlockLot, type Culture, type GrainRun, type Strain } from './xeno'
import { addCultures, addGrainRun, addLot, lossLot, newStrain } from './xenoActions'
import {
  DEFAULT_PRACTICE,
  PRACTICE_ID,
  bankAge,
  bankStatus,
  baselineDays,
  chainSurvival,
  fit75x,
  isHeld,
  mergePractice,
  spareBlocks,
  spawnLines,
  stageContam,
  strainCheck,
  suggestResult,
  type BankTest,
  type ViabilityCheck,
} from './bank'
import { bankBatch, decideTest, logCheck, plateMaster, savePractice, setOffsite, startTest, watchStrain } from './bankActions'
import { runLines, speciesSpawnBags } from './stockplan'
import type { LotLoss } from './hazard'
import type { Harvest } from './ledger'

Store.GROUP_MS = 0
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const tableState = (st: Store, t: string) => Object.fromEntries(st.rows(t).map((r) => [r.id, clean(r)]))
const settle = () => new Promise((r) => setTimeout(r, 0))
const TABLES = ['strains', 'cultures', 'bank_tests', 'viability_checks', 'app_settings']

async function replay(st: Store) {
  await settle()
  await st.ensure(EDIT_LOG)
  const out: Record<string, Record<string, Row>> = {}
  for (const e of st.rows<EditEntry>(EDIT_LOG)) {
    const t = (out[e.table_name] ??= {})
    if (e.op === 'delete') delete t[e.row_id]
    else {
      const r: Row = e.op === 'create' ? { id: e.row_id } : { ...(t[e.row_id] ?? { id: e.row_id }) }
      for (const c of e.changes) r[c.f] = c.new
      t[e.row_id] = r
    }
  }
  for (const t of Object.keys(out)) for (const id of Object.keys(out[t])) out[t][id] = clean(out[t][id]) as Row
  return out
}
async function expectLogMatches(st: Store) {
  const rebuilt = await replay(st)
  for (const t of TABLES) expect(rebuilt[t] ?? {}, `history replay of ${t}`).toEqual(tableState(st, t))
}
async function fresh() {
  const st = new Store(new MemoryBackend())
  st.who = 'JOSEPH'
  st.screen = 'XENOGENETICS'
  for (const t of [...TABLES, 'grain_runs', 'block_lots', 'lot_losses', 'harvests', EDIT_LOG]) await st.ensure(t)
  return st
}
const C = (st: Store) => st.rows<Culture>('cultures')
const T = (st: Store) => st.rows<BankTest>('bank_tests')
const K = (st: Store) => st.rows<ViabilityCheck>('viability_checks')

describe('mock trial: banking a new Cap n Stem strain at intake (t08-proc-our-intake)', () => {
  it('master, P1, a 4+4 batch with an off-site copy, a T/E test that holds dish E, then passes', async () => {
    const st = await fresh()
    const s = newStrain({ species_key: 'blue-oyster', code: 'BO-01' })
    let master!: Culture
    await st.action('STRAIN BO-01 REGISTERED WITH ITS MASTER', async () => {
      await st.put('strains', s)
      ;[master] = await addCultures(st, { strain: s, parent: null, kind: 'plate', count: 1, p_level: 0, made_on: '2026-11-02', existing: [] })
    })
    expect(master.p_level).toBe(0)
    // Before anything is banked
    expect(bankStatus(s, C(st), K(st), T(st), DEFAULT_PRACTICE, '2026-11-02').warnings[0]).toMatch(/NOTHING IN THE BANK/)

    const p1 = await st.action('P1', () => plateMaster(st, s, master, C(st), '2026-11-02'))
    expect(p1.p_level).toBe(1)

    const tubes = await st.action('BANK BATCH', () => bankBatch(st, { strain: s, from: p1, slants: 4, water: 4, offsiteSlants: 1, offsiteWater: 1, on: '2026-11-09', existing: C(st) }))
    expect(tubes).toHaveLength(8)
    expect(tubes.map((t) => t.label)).toEqual([
      'BO-01 S1 P1 2026-11-09', 'BO-01 S2 P1 2026-11-09', 'BO-01 S3 P1 2026-11-09', 'BO-01 S4 P1 2026-11-09',
      'BO-01 W1 P1 2026-11-09', 'BO-01 W2 P1 2026-11-09', 'BO-01 W3 P1 2026-11-09', 'BO-01 W4 P1 2026-11-09',
    ])
    expect(new Set(tubes.map((t) => t.bank_batch)).size).toBe(1)
    expect(tubes.every((t) => t.parent_culture_id === p1.id && t.status === 'cold_storage' && t.cold_since === '2026-11-09')).toBe(true)
    expect(tubes.filter((t) => t.offsite).map((t) => t.label)).toEqual(['BO-01 S4 P1 2026-11-09', 'BO-01 W4 P1 2026-11-09'])

    let b = bankStatus(s, C(st), K(st), T(st), DEFAULT_PRACTICE, '2026-11-09')
    expect([b.slants, b.water, b.offsiteSlants, b.offsiteWater, b.lowestP]).toEqual([3, 3, 1, 1, 1])
    expect(b.warnings).toEqual(['NO T/E TEST ON FILE: TEST BEFORE THE STRAIN FEEDS PRODUCTION'])
    expect(b.nextDue).toBe('2027-05-11') // slants replaced 183 days after banking

    // T/E test: E dish is held
    const test = await st.action('T/E', () => startTest(st, { strain: s, tube: tubes[0], reason: 'intake', on: '2026-11-10', existing: C(st) }))
    const e = C(st).find((c) => c.id === test.e_plate_id)!
    const t = C(st).find((c) => c.id === test.t_plate_id)!
    expect(e.p_level).toBe(2)
    expect(t.parent_culture_id).toBe(tubes[0].id)
    expect(isHeld(e, C(st), T(st))?.id).toBe(test.id)
    expect(isHeld(t, C(st), T(st))).toBeNull()
    b = bankStatus(s, C(st), K(st), T(st), DEFAULT_PRACTICE, '2026-11-10')
    expect(b.pendingTests).toBe(1)
    expect(b.warnings).toEqual([])

    // Decided: pass releases E
    await st.action('PASS', () => decideTest(st, test, { result: 'pass', on: '2026-12-15', days_to_colonize: 14, days_to_pin: 19, kg_per_block: 0.92, form: 'TRUE' }, C(st)))
    const done = T(st)[0]
    expect([done.result, done.decided_on, done.days_to_pin, done.kg_per_block]).toEqual(['pass', '2026-12-15', 19, 0.92])
    expect(isHeld(e, C(st), T(st))).toBeNull()
    await expect(decideTest(st, done, { result: 'fail' }, C(st))).rejects.toThrow(/ALREADY DECIDED/)

    // Every write is in the edit history and rebuilds the same data
    await expectLogMatches(st)
    const labels = new Set(st.rows<EditEntry>(EDIT_LOG).map((x) => x.label))
    expect(labels).toEqual(new Set(['STRAIN BO-01 REGISTERED WITH ITS MASTER', 'P1', 'BANK BATCH', 'T/E', 'PASS']))
    expect(st.rows<EditEntry>(EDIT_LOG).every((x) => x.who === 'JOSEPH' && x.screen === 'XENOGENETICS')).toBe(true)
  })

  it('a failed test discards dish E; UNDO puts it back in one step', async () => {
    const st = await fresh()
    const s = newStrain({ species_key: 'lions-mane', code: 'LM-01' })
    await st.put('strains', s)
    const [p1] = await addCultures(st, { strain: s, parent: null, kind: 'plate', count: 1, p_level: 1, made_on: '2026-11-01', existing: [] })
    const tubes = await bankBatch(st, { strain: s, from: p1, slants: 3, water: 3, offsiteSlants: 1, offsiteWater: 1, on: '2026-11-05', existing: C(st) })
    const test = await startTest(st, { strain: s, tube: tubes[3], reason: 'intake', on: '2026-11-06', existing: C(st) })
    await st.action('FAIL', () => decideTest(st, test, { result: 'fail', on: '2026-12-10' }, C(st)))
    expect(C(st).find((c) => c.id === test.e_plate_id)!.status).toBe('discarded')
    expect(T(st)[0].result).toBe('fail')
    await st.undo()
    expect(C(st).find((c) => c.id === test.e_plate_id)!.status).toBe('clean')
    expect(T(st)[0].result).toBe('pending')
  })

  it('refuses bad input: wrong strain, not a plate, nothing to bank, dirty plate', async () => {
    const st = await fresh()
    const a = newStrain({ species_key: 'blue-oyster', code: 'BO-01' })
    const b2 = newStrain({ species_key: 'lions-mane', code: 'LM-01' })
    await st.put('strains', [a, b2])
    const [plate] = await addCultures(st, { strain: a, parent: null, kind: 'plate', count: 1, p_level: 1, existing: [] })
    const [slant] = await addCultures(st, { strain: a, parent: null, kind: 'slant', count: 1, p_level: 0, existing: C(st) })
    await expect(bankBatch(st, { strain: b2, from: plate, slants: 3, water: 3, offsiteSlants: 0, offsiteWater: 0, existing: C(st) })).rejects.toThrow(/ANOTHER STRAIN/)
    await expect(bankBatch(st, { strain: a, from: slant, slants: 3, water: 3, offsiteSlants: 0, offsiteWater: 0, existing: C(st) })).rejects.toThrow(/FROM A PLATE/)
    await expect(bankBatch(st, { strain: a, from: plate, slants: 0, water: 0, offsiteSlants: 0, offsiteWater: 0, existing: C(st) })).rejects.toThrow(/HOW MANY/)
    await expect(bankBatch(st, { strain: a, from: { ...plate, p_level: 0 }, slants: 3, water: 3, offsiteSlants: 0, offsiteWater: 0, existing: C(st) })).rejects.toThrow(/MASTER \(P0\)/)
    await expect(bankBatch(st, { strain: a, from: { ...plate, status: 'contaminated' }, slants: 3, water: 3, offsiteSlants: 0, offsiteWater: 0, existing: C(st) })).rejects.toThrow(/NOT CLEAN/)
    // Off-site counts above the batch are capped, NaN is zero, huge counts capped at 12
    const rows = await bankBatch(st, { strain: a, from: plate, slants: 99, water: Number('x'), offsiteSlants: 50, offsiteWater: 3, existing: C(st) })
    expect(rows.filter((r) => r.kind === 'slant')).toHaveLength(12)
    expect(rows.filter((r) => r.kind === 'water')).toHaveLength(0)
    expect(rows.filter((r) => r.offsite)).toHaveLength(12)
  })

  it('warnings: one storage method only, no off-site copy, off-site missing a kind', async () => {
    const st = await fresh()
    const s = newStrain({ species_key: 'comb-tooth', code: 'CT-01' })
    await st.put('strains', s)
    const [p1] = await addCultures(st, { strain: s, parent: null, kind: 'plate', count: 1, p_level: 1, made_on: '2026-11-01', existing: [] })
    await bankBatch(st, { strain: s, from: p1, slants: 3, water: 0, offsiteSlants: 0, offsiteWater: 0, on: '2026-11-02', existing: C(st) })
    let w = bankStatus(s, C(st), K(st), T(st), DEFAULT_PRACTICE, '2026-11-02').warnings
    expect(w).toContain('ONLY SLANTS: MAKE WATER TUBES THIS WEEK')
    expect(w).toContain('NO OFF-SITE COPY: MOVE ONE SLANT AND ONE WATER TUBE OFF SITE')
    await setOffsite(st, C(st).find((c) => c.kind === 'slant')!, true)
    w = bankStatus(s, C(st), K(st), T(st), DEFAULT_PRACTICE, '2026-11-02').warnings
    expect(w).toContain('OFF-SITE COPY HAS NO WATER TUBE')
    // A retired strain raises no warnings
    expect(bankStatus({ ...s, active: false }, C(st), K(st), T(st)).warnings).toEqual([])
  })
})

describe('due dates (t08 Our farm refresh rules)', () => {
  const p = DEFAULT_PRACTICE
  const tube = (kind: 'slant' | 'water', made: string, id = 'x', batch = 'b1'): Culture => ({ id, strain_id: 's', parent_culture_id: null, kind, p_level: 1, made_on: made, status: 'cold_storage', cold_since: made, location: null, label: id, notes: null, bank_batch: batch })
  it('slants: replace 183 days after banking, warn 30 days before', () => {
    const c = tube('slant', '2026-01-01')
    expect(bankAge(c, [c], [], [], p, '2026-05-01').state).toBe('ok')
    expect(bankAge(c, [c], [], [], p, '2026-06-03').state).toBe('warn') // 30 days before 2026-07-03
    expect(bankAge(c, [c], [], [], p, '2026-07-03').text).toBe('REPLACE BY 2026-07-03')
    expect(bankAge(c, [c], [], [], p, '2026-07-10')).toMatchObject({ state: 'over', text: 'REPLACE: 7 D OVERDUE' })
  })
  it('water tubes: check at 6 months, overdue at 12; a passed check on a batch-mate restarts the clock', () => {
    const a = tube('water', '2026-01-01', 'a')
    const b = tube('water', '2026-01-01', 'b')
    expect(bankAge(a, [a, b], [], [], p, '2026-07-02')).toMatchObject({ state: 'ok', due: '2026-07-03' })
    expect(bankAge(a, [a, b], [], [], p, '2026-07-03').state).toBe('warn')
    expect(bankAge(a, [a, b], [], [], p, '2027-01-02').state).toBe('over')
    const chk: ViabilityCheck = { id: 'k', culture_id: 'b', strain_id: 's', checked_on: '2026-07-10', days_to_cover: 9, appearance: null, contamination: null, result: 'pass', notes: null, initials: null }
    expect(bankAge(a, [a, b], [chk], [], p, '2026-12-01')).toMatchObject({ state: 'ok', due: '2027-01-09' })
    // ...but not for a tube in another batch
    const other = tube('water', '2026-01-01', 'c', 'b2')
    expect(bankAge(other, [a, b, other], [chk], [], p, '2026-12-01').state).toBe('warn')
  })
  it('any tube over 2 years is suspect until a T/E test from its batch passes after that day', () => {
    const a = tube('water', '2024-01-01', 'a')
    const chk: ViabilityCheck = { id: 'k', culture_id: 'a', strain_id: 's', checked_on: '2025-12-15', days_to_cover: 9, appearance: null, contamination: null, result: 'pass', notes: null, initials: null }
    expect(bankAge(a, [a], [chk], [], p, '2025-12-30').state).toBe('ok')
    const late = bankAge(a, [a], [chk], [], p, '2026-01-05')
    expect(late.state).toBe('over')
    expect(late.text).toMatch(/T\/E TEST BEFORE USE/)
    const t: BankTest = { id: 't', strain_id: 's', source_culture_id: 'a', t_plate_id: 'x', e_plate_id: 'y', reason: 'old_tube', started_on: '2026-01-02', result: 'pass', decided_on: '2026-02-01', days_to_colonize: null, days_to_pin: null, kg_per_block: null, form: null, notes: null }
    expect(bankAge(a, [a], [chk], [t], p, '2026-02-02').text).not.toMatch(/T\/E TEST/)
    expect(bankAge(a, [a], [chk], [{ ...t, result: 'pending' }], p, '2026-02-02').state).toBe('over')
  })
  it('watch and fail checks override the dates', () => {
    const a = tube('slant', '2026-10-01', 'a')
    const k = (result: 'watch' | 'fail'): ViabilityCheck => ({ id: result, culture_id: 'a', strain_id: 's', checked_on: '2026-10-20', days_to_cover: 14, appearance: null, contamination: null, result, notes: null, initials: null })
    expect(bankAge(a, [a], [k('watch')], [], p, '2026-10-21')).toMatchObject({ state: 'warn', watch: true })
    expect(bankAge(a, [a], [k('fail')], [], p, '2026-10-21')).toMatchObject({ state: 'over', text: 'FAILED CHECK: DISCARD' })
  })
  it('practice settings change the dates (slants at 4 months)', () => {
    const a = tube('slant', '2026-01-01')
    expect(bankAge(a, [a], [], [], mergePractice({ slantReplaceDays: 122 }), '2026-05-04').state).toBe('over')
  })
})

describe('viability log: baseline and suggested result', () => {
  it('the first days-to-cover is the baseline; 25% slower is WATCH', async () => {
    const st = await fresh()
    const s = newStrain({ species_key: 'blue-oyster', code: 'BO-01' })
    await st.put('strains', s)
    const [p1] = await addCultures(st, { strain: s, parent: null, kind: 'plate', count: 1, p_level: 1, existing: [] })
    const [w] = await bankBatch(st, { strain: s, from: p1, slants: 0, water: 2, offsiteSlants: 0, offsiteWater: 0, on: '2026-01-01', existing: C(st) })
    expect(suggestResult(9, null, 'EVEN AND WHITE', null).why).toMatch(/BASELINE/)
    await logCheck(st, { tube: w, on: '2026-06-01', days_to_cover: 9, appearance: 'EVEN AND WHITE', contamination: 'NONE', result: 'pass' })
    await logCheck(st, { tube: w, on: '2026-12-01', days_to_cover: 12, appearance: 'EVEN AND WHITE', contamination: null, result: 'watch' })
    expect(baselineDays(s.id, K(st))).toBe(9)
    expect(suggestResult(11, 9, 'EVEN AND WHITE', 'NONE').result).toBe('pass') // 11 <= 11.25
    expect(suggestResult(12, 9, 'EVEN AND WHITE', '').result).toBe('watch')
    expect(suggestResult(9, 9, 'SECTORING', null).result).toBe('watch')
    expect(suggestResult(9, 9, 'EVEN AND WHITE', 'GREEN SPOT').result).toBe('fail')
    // Bad numbers are stored as empty, not as NaN or 0
    const bad = await logCheck(st, { tube: w, days_to_cover: Number('x'), appearance: null, contamination: null, result: 'pass' })
    expect(bad.days_to_cover).toBeNull()
  })
})

describe('contamination by stage (t16 Our farm)', () => {
  it('four-week roll-up per stage, against the 5% target', () => {
    const now = '2026-11-30'
    const cultures = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, kind: 'plate', made_on: '2026-11-10', status: i < 2 ? 'contaminated' : 'clean' })),
      { id: 'old', kind: 'plate', made_on: '2026-10-01', status: 'contaminated' }, // outside the window
    ] as Culture[]
    const runs = [
      { id: 'g1', generation: 'G1', bag_count: 4, bags_lost: 0, inoculated_on: '2026-11-05' },
      { id: 'g2a', generation: 'G2', bag_count: 8, bags_lost: 1, inoculated_on: '2026-11-12' },
      { id: 'g2b', generation: 'G2', bag_count: 8, bags_lost: 0, inoculated_on: '2026-11-19' },
    ] as GrainRun[]
    const lots = [
      { id: 'l1', bag_count: 52, knock_date: '2026-11-03' },
      { id: 'l2', bag_count: 46, knock_date: '2026-11-03' },
      { id: 'l3', bag_count: 130, knock_date: '2026-10-27' }, // 34 days ago: outside
    ] as BlockLot[]
    const lotLoss = [
      { id: 'x1', block_lot_id: 'l1', bag_count: 2 },
      { id: 'x2', block_lot_id: 'l2', bag_count: 1 },
      { id: 'x3', block_lot_id: 'l3', bag_count: 30 },
    ] as LotLoss[]
    const r = stageContam({ cultures, runs, lots, lotLoss }, 5, now)
    expect(r.map((x) => [x.made, x.lost])).toEqual([[20, 2], [4, 0], [16, 1], [98, 3]])
    expect(r.map((x) => x.pct === null ? null : Math.round(x.pct * 100) / 100)).toEqual([10, 0, 6.25, 3.06])
    expect(r.map((x) => x.over)).toEqual([true, false, true, false])
    expect(chainSurvival([5, 5, 5, 5])).toBeCloseTo(0.8145, 4)
    expect(stageContam({ cultures: [], runs: [], lots: [], lotLoss: [] }, 5, now).every((x) => x.pct === null && !x.over)).toBe(true)
  })
})

describe('monthly strain check from production lots (t09-our-testbags)', () => {
  const s = { id: 's1', code: 'BO-01', species_key: 'blue-oyster', active: true } as Strain
  const lot = (id: string, knock: string, moved: string): BlockLot => ({ id, lot_code: id, species_key: 'blue-oyster', strain_id: 's1', grain_run_id: null, g2_bags_used: 3, bag_count: 50, knock_date: knock, to_fruiting_on: moved, status: 'spent', notes: null })
  const lots = [lot('a', '2026-08-04', '2026-08-18'), lot('b', '2026-08-18', '2026-09-01'), lot('c', '2026-09-01', '2026-09-15'), lot('r', '2026-11-10', '2026-11-28')]
  const h = (lotId: string, kg: number, day: string): Harvest => ({ id: `${lotId}${day}`, block_lot_id: lotId, harvested_on: day, flush: 1, kg, grade: null, initials: null, notes: null })
  const harvests = [h('a', 46, '2026-08-27'), h('b', 45, '2026-09-10'), h('c', 47, '2026-09-24'), h('r', 35, '2026-11-30')]
  it('reads the last 4 weeks against the strain history: yield and speed slipping', () => {
    const c = strainCheck(s, lots, [], harvests, DEFAULT_PRACTICE, '2026-12-01')
    expect(c.recent.lots).toBe(1)
    expect(c.history.lots).toBe(3)
    expect(c.history.kgPerBlock).toBeCloseTo(138 / 150, 6) // 0.92
    expect(c.recent.kgPerBlock).toBeCloseTo(0.7, 6)
    expect(c.history.daysToFruit).toBe(14)
    expect(c.recent.daysToFruit).toBe(18) // 18 > 14 * 1.25 = 17.5
    expect(c.verdict).toBe('slipping')
    expect(c.slipping).toEqual(['YIELD 0.70 KG/BLOCK AGAINST 0.92', '18.0 D TO FRUITING AGAINST 14.0'])
  })
  it('steady strain, a strain with no recent lots, and too little history', () => {
    const steady = [...lots.slice(0, 3), { ...lot('r', '2026-11-10', '2026-11-24') }]
    const hs = [...harvests.slice(0, 3), h('r', 46, '2026-11-30')]
    expect(strainCheck(s, steady, [], hs, DEFAULT_PRACTICE, '2026-12-01').verdict).toBe('ok')
    expect(strainCheck(s, lots, [], harvests, DEFAULT_PRACTICE, '2027-03-01').verdict).toBe('no_lots')
    expect(strainCheck(s, lots.slice(2), [], harvests, DEFAULT_PRACTICE, '2026-12-01').verdict).toBe('no_history')
  })
  it('contamination at the target flags a strain even with no history', () => {
    const loss = [{ id: 'z', block_lot_id: 'r', bag_count: 3 } as LotLoss] // 3/50 = 6%
    const c = strainCheck(s, [lots[3]], loss, [], DEFAULT_PRACTICE, '2026-12-01')
    expect(c.verdict).toBe('slipping')
    expect(c.slipping[0]).toBe('CONTAMINATION 6.0% (TARGET BELOW 5%)')
  })
  it('MARK WATCH logs a WATCH line on every tube, in one UNDO step', async () => {
    const st = await fresh()
    const strain = newStrain({ species_key: 'blue-oyster', code: 'BO-02' })
    await st.put('strains', strain)
    const [p1] = await addCultures(st, { strain, parent: null, kind: 'plate', count: 1, p_level: 1, existing: [] })
    const tubes = await bankBatch(st, { strain, from: p1, slants: 3, water: 3, offsiteSlants: 1, offsiteWater: 1, on: '2026-11-01', existing: C(st) })
    await st.action('WATCH', () => watchStrain(st, tubes, 'YIELD DOWN', '2026-12-01'))
    expect(K(st)).toHaveLength(6)
    expect(bankStatus(strain, C(st), K(st), T(st), DEFAULT_PRACTICE, '2026-12-01').watch).toBe(6)
    await st.undo()
    expect(K(st)).toHaveLength(0)
  })
})

describe('one master and one G2 line per species (t09 Our farm)', () => {
  const week = [{ key: 'blue-oyster', bags: 52 }, { key: 'lions-mane', bags: 46 }, { key: 'comb-tooth', bags: 16 }, { key: 'golden-oyster', bags: 16 }]
  it('the 130-bag week: 3/3/1/1 G2, 4 masters, 12 bags, two full 75X runs', () => {
    const lines = spawnLines(week)
    expect(lines.map((l) => [l.g2, l.g1])).toEqual([[3, 1], [3, 1], [1, 1], [1, 1]])
    const fit = fit75x(lines)
    expect(fit).toMatchObject({ g2: 8, masters: 4, bags: 12, capacity: 12, fits: true })
    expect(fit75x(lines, mergePractice({ spareMasters: 1 })).fits).toBe(false)
    expect(fit75x(lines, mergePractice({ spareMasters: 1, bagsPer75xRun: 7 })).fits).toBe(true)
    // Planner agrees for every species
    expect(week.map((w) => planChain(w.key, w.bags, '2026-11-10').g1)).toEqual([1, 1, 1, 1])
  })
  it('CARGO grain: 8 x 6 lb + 4 x 4 lb = 64 lb cooked (t09-our-75x), about 16.8 kg dry', () => {
    expect(speciesSpawnBags(week)).toMatchObject({ g2: 8, g1: 4 })
    const by = new Map(runLines(130, { split: week }).map((l) => [l.code, l]))
    expect(by.get('SPAWN-BAG')!.book).toBe(12)
    // 64 lb hydrated at 48% -> dry at 10%: 64 * 0.52 / 0.9 = 36.98 lb = 16.77 kg
    expect(by.get('GRAIN')!.qty).toBeCloseTo((64 * 0.52 / 0.9) * 0.45359237, 2)
    // The pooled line (no split) is unchanged: 6.5 G2 + 0.54 G1 -> 8 bags booked
    expect(new Map(runLines(130).map((l) => [l.code, l])).get('SPAWN-BAG')!.book).toBe(8)
    expect(new Map(runLines(130, { split: week, spareMasters: 2 }).map((l) => [l.code, l])).get('SPAWN-BAG')!.book).toBe(14)
  })
  it('never more than 24 G2 per master, even for huge single-species weeks', () => {
    for (const bags of [1, 19, 20, 21, 240, 241, 480, 481, 5000]) for (const l of spawnLines([{ key: 'blue-oyster', bags }])) {
      expect(l.g2 / l.g1).toBeLessThanOrEqual(24)
      expect(l.g1).toBeGreaterThanOrEqual(1)
    }
  })
  it('spare-block buffer', () => {
    expect(spareBlocks(130, 5)).toBe(7) // 6.5 rounds to 7
    expect(spareBlocks(52, 5)).toBe(3)
    expect(spareBlocks(0, 5)).toBe(0)
    expect(spareBlocks(-3, 5)).toBe(0)
  })
})

describe('practice defaults', () => {
  it('defaults, bad input and clamps', () => {
    expect(mergePractice(undefined)).toEqual(DEFAULT_PRACTICE)
    expect(mergePractice('junk')).toEqual(DEFAULT_PRACTICE)
    const m = mergePractice({ contamTargetPct: '3', spareBlockPct: -5, smallLineRoute: 'nonsense', bagsPer75xRun: 99, waterCheckDays: 400, waterOverDays: 100, slowerPct: 'x' })
    expect(m.contamTargetPct).toBe(3)
    expect(m.spareBlockPct).toBe(0)
    expect(m.smallLineRoute).toBe('weekly')
    expect(m.bagsPer75xRun).toBe(20)
    expect(m.waterOverDays).toBe(400) // never earlier than the check
    expect(m.slowerPct).toBe(25)
  })
  it('saved in app_settings, logged, undoable', async () => {
    const st = await fresh()
    await st.action('TARGET 3%', () => savePractice(st, DEFAULT_PRACTICE, { contamTargetPct: 3 }))
    expect(mergePractice(st.rows('app_settings').find((r) => r.id === PRACTICE_ID)?.value).contamTargetPct).toBe(3)
    await expectLogMatches(st)
    await st.undo()
    expect(st.rows('app_settings').find((r) => r.id === PRACTICE_ID)).toBeUndefined()
  })
})

describe('history resilience: two and a half years of bank records', () => {
  it('old batches, checks and tests keep their results through refreshes, setting changes, export and import', async () => {
    const st = await fresh()
    const s = newStrain({ species_key: 'blue-oyster', code: 'BO-01' })
    await st.put('strains', s)
    let [plate] = await addCultures(st, { strain: s, parent: null, kind: 'plate', count: 1, p_level: 1, made_on: '2024-05-01', existing: [] })
    // Refresh every 6 months from the newest batch, checking and testing as the textbook asks.
    let day = '2024-05-08'
    let batchCount = 0
    for (let i = 0; i < 5; i++) {
      const tubes = await st.action(`BATCH ${i}`, () => bankBatch(st, { strain: s, from: plate, slants: 3, water: 3, offsiteSlants: 1, offsiteWater: 1, on: day, existing: C(st) }))
      batchCount++
      const w = tubes.find((t) => t.kind === 'water')!
      await logCheck(st, { tube: w, on: addDays(day, 150), days_to_cover: 9 + i * 0.5, appearance: 'EVEN AND WHITE', contamination: null, result: 'pass' })
      const test = await startTest(st, { strain: s, tube: tubes[0], reason: i === 0 ? 'intake' : 'refresh', on: addDays(day, 1), existing: C(st) })
      await decideTest(st, test, { result: 'pass', on: addDays(day, 40), kg_per_block: 0.9 + i / 100 }, C(st))
      // Old slants used up at refresh
      for (const t of C(st).filter((c) => c.kind === 'slant' && c.bank_batch !== tubes[0].bank_batch && c.status === 'cold_storage')) await st.put('cultures', { ...t, status: 'used_up' })
      plate = C(st).find((c) => c.id === test.e_plate_id)!
      day = addDays(day, 182)
    }
    // Retire nothing; edit an old check (a typo fixed a year later) and confirm the rest are untouched.
    const firstCheck = [...K(st)].sort((a, b) => a.checked_on.localeCompare(b.checked_on))[0]
    await st.action('FIX OLD CHECK', () => st.put('viability_checks', { ...firstCheck, notes: 'TYPO FIXED' }))
    const now = '2026-11-06'
    const before = {
      tests: T(st).map((t) => [t.started_on, t.result, t.kg_per_block]).sort(),
      baseline: baselineDays(s.id, K(st)),
      status: bankStatus(s, C(st), K(st), T(st), DEFAULT_PRACTICE, now),
      labels: C(st).filter((c) => c.bank_batch).map((c) => c.label).sort(),
    }
    expect(batchCount).toBe(5)
    expect(before.baseline).toBe(9)
    expect(T(st)).toHaveLength(5)
    expect(before.labels).toContain('BO-01 S15 P5 2026-05-06')
    expect(before.labels).toContain('BO-01 W1 P1 2024-05-08')

    // A setting change moves due dates but never rewrites history
    await savePractice(st, DEFAULT_PRACTICE, { slantReplaceDays: 120, contamTargetPct: 3 })
    expect(T(st).map((t) => [t.started_on, t.result, t.kg_per_block]).sort()).toEqual(before.tests)
    expect(baselineDays(s.id, K(st))).toBe(9)

    // Export, then import on a fresh device: identical records and history
    const json = await st.exportJson()
    const st2 = await fresh()
    await st2.importJson(json)
    for (const t of TABLES) expect(tableState(st2, t), t).toEqual(tableState(st, t))
    const ids2 = new Set(st2.rows(EDIT_LOG).map((e) => e.id))
    expect(st.rows(EDIT_LOG).every((e) => ids2.has(e.id))).toBe(true) // every old history line kept
    expect(bankStatus(s, C(st2), K(st2), T(st2), DEFAULT_PRACTICE, now)).toEqual(before.status)
    // Import again: nothing doubles, no record changes
    const n2 = st2.rows(EDIT_LOG).length
    await st2.importJson(json)
    expect(st2.rows(EDIT_LOG).length).toBe(n2)
    for (const t of TABLES) expect(tableState(st2, t), t).toEqual(tableState(st, t))
    await expectLogMatches(st)
  })
})

describe('stress: thousands of random bank actions', () => {
  const seeds = Number(process.env.STRESS_SEEDS ?? 3)
  for (let seed = 1; seed <= seeds; seed++) {
    it(`seed ${seed}: invariants hold after every step, history replays, undo returns exactly`, async () => {
      const r = rng(seed * 7919)
      const st = await fresh()
      const strains: Strain[] = []
      for (let i = 0; i < 6; i++) {
        const s = newStrain({ species_key: r.pick(['blue-oyster', 'lions-mane', 'comb-tooth', 'golden-oyster']), code: `ST-${i + 1}` })
        strains.push(s)
        await st.put('strains', s)
        await addCultures(st, { strain: s, parent: null, kind: 'plate', count: 2, p_level: 1, made_on: '2025-01-01', existing: C(st) })
      }
      let day = '2025-01-02'
      const steps = 600
      for (let i = 0; i < steps; i++) {
        day = addDays(day, r.int(3))
        const s = r.pick(strains)
        const mine = C(st).filter((c) => c.strain_id === s.id)
        const plates = mine.filter((c) => c.kind === 'plate' && (c.status === 'clean' || c.status === 'cold_storage') && !isHeld(c, C(st), T(st)))
        const tubes = mine.filter((c) => (c.kind === 'slant' || c.kind === 'water') && (c.status === 'clean' || c.status === 'cold_storage'))
        const op = r.int(9)
        const snap = TABLES.map((t) => JSON.stringify(tableState(st, t)))
        try {
          if (op === 0 && plates.length) await st.action('B', () => bankBatch(st, { strain: s, from: r.pick(plates), slants: r.int(6), water: r.int(6), offsiteSlants: r.int(3), offsiteWater: r.int(3), on: day, existing: C(st) }))
          else if (op === 1 && tubes.length) await st.action('K', () => logCheck(st, { tube: r.pick(tubes), on: day, days_to_cover: r.chance(0.1) ? NaN : 5 + r.int(15), appearance: r.pick(['EVEN AND WHITE', 'SECTORING', null]), contamination: r.chance(0.05) ? 'GREEN' : null, result: r.pick(['pass', 'watch', 'fail'] as const) }))
          else if (op === 2 && tubes.length) await st.action('T', () => startTest(st, { strain: s, tube: r.pick(tubes), reason: 'refresh', on: day, existing: C(st) }))
          else if (op === 3) {
            const pending = T(st).filter((t) => t.result === 'pending')
            if (pending.length) await st.action('D', () => decideTest(st, r.pick(pending), { result: r.pick(['pass', 'fail'] as const), on: day, kg_per_block: r.next() }, C(st)))
          } else if (op === 4 && tubes.length) {
            const t = r.pick(tubes)
            await st.action('O', () => setOffsite(st, t, !t.offsite))
          } else if (op === 5 && tubes.length) {
            const t = r.pick(tubes)
            await st.action('X', () => st.put('cultures', { ...t, status: r.pick(['used_up', 'discarded'] as const) }))
          } else if (op === 6) {
            const label = await st.undo()
            if (label) {
              // undo never leaves a pending test without its plates
              for (const t of T(st)) expect(C(st).some((c) => c.id === t.e_plate_id)).toBe(true)
            }
          } else if (op === 7 && plates.length) await st.action('P', () => addCultures(st, { strain: s, parent: r.pick(plates), kind: 'plate', count: 1 + r.int(3), made_on: day, existing: C(st) }))
          else if (op === 8) await st.action('S', () => savePractice(st, mergePractice(st.rows('app_settings').find((x) => x.id === PRACTICE_ID)?.value), { slantReplaceDays: 120 + r.int(120), contamTargetPct: 1 + r.int(9) }))
        } catch (e) {
          // A refused write must change nothing
          expect(TABLES.map((t) => JSON.stringify(tableState(st, t)))).toEqual(snap)
          expect(String(e)).toMatch(/[A-Z]/)
        }
        // Invariants after every step
        const p = mergePractice(st.rows('app_settings').find((x) => x.id === PRACTICE_ID)?.value)
        for (const s2 of strains) {
          const b = bankStatus(s2, C(st), K(st), T(st), p, day)
          const live = C(st).filter((c) => c.strain_id === s2.id && (c.kind === 'slant' || c.kind === 'water') && (c.status === 'clean' || c.status === 'cold_storage'))
          const failed = live.filter((c) => [...K(st)].filter((k) => k.culture_id === c.id).sort((a, b2) => a.checked_on.localeCompare(b2.checked_on) || String(a.created_at).localeCompare(String(b2.created_at))).at(-1)?.result === 'fail')
          expect(b.slants + b.water + b.offsiteSlants + b.offsiteWater).toBe(live.length - failed.length)
          expect(b.offsiteSlants + b.offsiteWater).toBe(live.filter((c) => c.offsite && !failed.includes(c)).length)
        }
        // A held E plate never has children
        for (const t of T(st).filter((x) => x.result === 'pending')) expect(C(st).some((c) => c.parent_culture_id === t.e_plate_id)).toBe(false)
        // Every tube label is unique per strain
        const labels = C(st).filter((c) => c.bank_batch).map((c) => `${c.strain_id}|${c.label}`)
        expect(new Set(labels).size).toBe(labels.length)
        if (i % 150 === 149) await expectLogMatches(st)
      }
      await expectLogMatches(st)
      // Undo everything that is still on the stack: tables shrink back, never grow
      let n = 0
      while ((await st.undo()) && n < 100) n++
      for (const t of T(st)) expect(C(st).some((c) => c.id === t.e_plate_id)).toBe(true)
    }, 60000)
  }

  it('10,000 tubes and 20,000 checks: status and due dates stay fast and exact', () => {
    const strains = Array.from({ length: 17 }, (_, i) => ({ id: `s${i}`, code: `BO-${i}`, species_key: 'blue-oyster', active: true }) as Strain)
    const cultures: Culture[] = []
    const checks: ViabilityCheck[] = []
    for (let i = 0; i < 10000; i++) {
      const s = strains[i % 17]
      const kind = i % 2 ? 'water' : 'slant'
      cultures.push({ id: `c${i}`, strain_id: s.id, parent_culture_id: null, kind, p_level: 1, made_on: addDays('2024-01-01', i % 900), status: 'cold_storage', cold_since: null, location: null, label: `${s.code} ${i}`, notes: null, bank_batch: `b${Math.floor(i / 8)}`, offsite: i % 8 === 0 })
      checks.push({ id: `k${i}a`, culture_id: `c${i}`, strain_id: s.id, checked_on: addDays('2024-06-01', i % 800), days_to_cover: 9, appearance: null, contamination: null, result: 'pass', notes: null, initials: null })
      checks.push({ id: `k${i}b`, culture_id: `c${i}`, strain_id: s.id, checked_on: addDays('2024-07-01', i % 800), days_to_cover: 10, appearance: null, contamination: null, result: i % 50 ? 'pass' : 'watch', notes: null, initials: null })
    }
    const t0 = performance.now()
    const st = strains.map((s) => bankStatus(s, cultures, checks, [], DEFAULT_PRACTICE, '2026-11-06'))
    const ms = performance.now() - t0
    expect(st.reduce((n, b) => n + b.slants + b.water + b.offsiteSlants + b.offsiteWater, 0)).toBe(10000)
    expect(st.reduce((n, b) => n + b.offsiteSlants + b.offsiteWater, 0)).toBe(1250)
    expect(ms).toBeLessThan(1500) // all 17 strains, on a slow test machine
  }, 120000)
})

// Keep imported helpers referenced (some are only used in typed fixtures).
void addGrainRun
void addLot
void lossLot
