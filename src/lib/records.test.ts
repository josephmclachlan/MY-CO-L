// Mock trials and unit tests for G4 (production records, bulk actions, photos, scan).
// Joseph's rule (6 Nov 2026): mock trial of each function with realistic farm data, outputs checked against
// hand-worked numbers, every write in the edit history, old data surviving, then stress (records.stress.test.ts).
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store } from './store'
import type { EditEntry } from './history'
import type { BlockLot, Culture, GrainRun, Strain } from './xeno'
import type { Harvest } from './ledger'
import type { LotLoss } from './hazard'
import type { CookRun } from './cook'
import {
  allRecords, BLOCK_DRY_KG, fadingStrains, flushTest, groupStats, isoWeek, lotRecord, nextPinFlush, pickerTotals, planSplit, scorecard, splitCode, survivors, trialArms, trialVerdict,
  type FlushLog, type StrainTrial,
} from './records'
import { bulkLots, createTrial, dropExtras, harvestSession, inoculateCart, logPins, setLotPlace, splitLot } from './recordsActions'
import { dataUrlBytes, fitSize, isImageDataUrl, addPhoto, photosOf, type Photo } from './photos'
import { cartUrl, parseScan, resolveScan } from './scan'

Store.GROUP_MS = 0
const settle = () => new Promise((r) => setTimeout(r, 0))

const DRY = 4 * 0.45359237 // 1.81436948 kg of dry substrate in one 10 lb block

const strain = (id: string, code: string, sp = 'blue-oyster'): Strain => ({ id, species_key: sp, code, name: null, source: null, active: true, notes: null })
const lot = (id: string, code: string, o: Partial<BlockLot> = {}): BlockLot => ({
  id, lot_code: code, species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 40, knock_date: '2026-08-10', status: 'fruiting', notes: null, ...o,
})
const harv = (id: string, lotId: string, day: string, kg: number, flush = 1, who = 'AB'): Harvest => ({ id, block_lot_id: lotId, harvested_on: day, flush, kg, grade: 'A', initials: who, notes: null })
const loss = (id: string, lotId: string, n: number): LotLoss => ({ id, block_lot_id: lotId, hazard_key: null, bag_count: n, cause: null, noted_on: '2026-08-12', notes: null })
const pin = (id: string, lotId: string, flush: number, day: string): FlushLog => ({ id, block_lot_id: lotId, flush, pinned_on: day, notes: null })

// ---- the mock farm: two blue oyster strains over five lots, hand-worked in the comments ----
const S1 = strain('s1', 'BO-01')
const S2 = strain('s2', 'BO-02')
const COOKS = [
  { id: 'c1', kind: 'steam_box', unit_label: 'STEAM BOX', started_at: '2026-08-02T08:00:00Z' },
  { id: 'c2', kind: 'steam_box', unit_label: 'STEAM BOX', started_at: '2026-08-09T08:00:00Z' },
] as unknown as CookRun[]
const LOTS: BlockLot[] = [
  lot('A', 'B0803', { strain_id: 's1', cook_run_id: 'c1', knock_date: '2026-08-03', bag_count: 50, room: 'fruiting', knocked_by: 'AB', status: 'spent' }),
  lot('B', 'B0810', { strain_id: 's1', cook_run_id: 'c1', knock_date: '2026-08-10', bag_count: 40, room: 'fruiting', knocked_by: 'AB', status: 'spent' }),
  lot('C', 'B0810-2', { strain_id: 's2', cook_run_id: 'c2', knock_date: '2026-08-10', bag_count: 40, room: 'fruiting', knocked_by: 'CD', status: 'spent' }),
  lot('D', 'B0817', { strain_id: 's2', cook_run_id: 'c2', knock_date: '2026-08-17', bag_count: 40, room: 'fruiting', knocked_by: 'CD', status: 'spent' }),
  lot('E', 'B0914', { strain_id: 's1', cook_run_id: 'c2', knock_date: '2026-09-14', bag_count: 40, room: 'incubation', knocked_by: 'AB', status: 'incubating' }),
]
const LOSSES = [loss('l1', 'B', 2), loss('l2', 'C', 8)]
const HARV = [
  harv('h1', 'A', '2026-08-15', 28), harv('h2', 'A', '2026-08-17', 18), // A: 46 kg
  harv('h3', 'B', '2026-08-22', 36), // B: 36 kg
  harv('h4', 'C', '2026-08-23', 20, 1, 'CD'), // C: 20 kg
  harv('h5', 'D', '2026-08-30', 38, 1, 'CD'), // D: 38 kg
]
const PINS = [pin('p1', 'A', 1, '2026-08-11'), pin('p2', 'B', 1, '2026-08-18'), pin('p3', 'C', 1, '2026-08-19'), pin('p4', 'D', 1, '2026-08-26')]

describe('mock trial: BE%, flush log, scorecard and strain trial against hand-worked numbers', () => {
  const recs = allRecords(LOTS, LOSSES, HARV, PINS)
  const by = (id: string) => recs.find((r) => r.lot.id === id)!

  it('dry weight per block is 4 lb', () => {
    expect(BLOCK_DRY_KG).toBeCloseTo(DRY, 8)
  })

  it('per lot: alive blocks, kg per block and BE% (kg / (alive blocks x 1.81437 kg dry))', () => {
    const a = by('A')
    expect(a.blocks).toBe(50)
    expect(a.kg).toBe(46)
    expect(a.kgPerBlock).toBeCloseTo(0.92, 5)
    expect(a.be).toBeCloseTo(50.7063, 3) // 46 / (50 x 1.81437)
    const b = by('B')
    expect(b.blocks).toBe(38) // 40 knocked, 2 lost
    expect(b.contamPct).toBeCloseTo(5, 5)
    expect(b.be).toBeCloseTo(52.2147, 3) // 36 / (38 x 1.81437)
    const c = by('C')
    expect(c.blocks).toBe(32)
    expect(c.be).toBeCloseTo(34.4472, 3)
    expect(c.contamPct).toBeCloseTo(20, 5)
    expect(by('E').be).toBeNull() // nothing picked yet: no BE, never a zero
    expect(by('E').complete).toBe(false)
  })

  it('expected BE comes from Catawba (2.03 lb per block = 50.75%)', () => {
    expect(by('A').expectedBe).toBeCloseTo((2.03 / 4) * 100, 2)
    expect(by('A').vsExpectedPct).toBeCloseTo(50.7063 / 50.75 * 100, 1)
  })

  it('flush log: pins, days pin to pick, picks, cumulative BE%', () => {
    const f = by('A').flushes
    expect(f).toHaveLength(1)
    expect(f[0].pinnedOn).toBe('2026-08-11')
    expect(f[0].picks).toBe(2)
    expect(f[0].firstPick).toBe('2026-08-15')
    expect(f[0].lastPick).toBe('2026-08-17')
    expect(f[0].daysPinToPick).toBe(4)
    expect(f[0].cumBe).toBeCloseTo(50.7063, 3)
    expect(by('A').daysToPin).toBe(8) // 3 Aug -> 11 Aug
    expect(by('A').daysToFirstPick).toBe(12)
    expect(by('D').daysToPin).toBe(9)
  })

  it('two flushes: per-flush BE% adds up to the cumulative figure', () => {
    const l = lot('LM', 'L0803', { species_key: 'lions-mane', bag_count: 20, knock_date: '2026-08-03', status: 'spent' })
    const r = lotRecord(l, [], [harv('x1', 'LM', '2026-08-20', 9, 1), harv('x2', 'LM', '2026-09-05', 6, 2)], [pin('q1', 'LM', 1, '2026-08-16'), pin('q2', 'LM', 2, '2026-09-01')])
    const dry = 20 * DRY
    expect(r.flushes.map((f) => f.flush)).toEqual([1, 2])
    expect(r.flushes[0].be).toBeCloseTo((9 / dry) * 100, 5)
    expect(r.flushes[1].be).toBeCloseTo((6 / dry) * 100, 5)
    expect(r.flushes[1].cumBe).toBeCloseTo((15 / dry) * 100, 5)
    expect(r.be).toBeCloseTo(r.flushes[1].cumBe!, 8)
    expect(r.complete).toBe(true) // lion's mane gets 2 flushes and both are picked
    // one flush picked, status still fruiting: not finished
    expect(lotRecord({ ...l, status: 'fruiting' }, [], [harv('x1', 'LM', '2026-08-20', 9, 1)], []).complete).toBe(false)
  })

  it('a lot with its own dry weight uses it', () => {
    const r = lotRecord({ ...LOTS[0], dry_kg_per_block: 1.5 }, [], HARV.slice(0, 2), PINS)
    expect(r.be).toBeCloseTo((46 / (50 * 1.5)) * 100, 6)
  })

  it('scorecard by strain: lots, lost %, kg per block, BE%, days to pins', () => {
    const rows = scorecard('STRAIN', recs, { strains: [S1, S2], cooks: COOKS })
    const s1 = rows.find((r) => r.label === 'BO-01')!
    const s2 = rows.find((r) => r.label === 'BO-02')!
    expect(s1.stats.lots).toBe(3)
    expect(s1.stats.knocked).toBe(130)
    expect(s1.stats.lost).toBe(2)
    expect(s1.stats.contamPct).toBeCloseTo(1.5385, 3)
    expect(s1.stats.yieldLots).toBe(2) // E is still incubating
    expect(s1.stats.kg).toBe(82)
    expect(s1.stats.kgPerBlock).toBeCloseTo(0.931818, 5) // 82 / 88
    expect(s1.stats.be).toBeCloseTo(51.3577, 3)
    expect(s1.stats.daysToPin).toBe(8)
    expect(s2.stats.kgPerBlock).toBeCloseTo(0.805556, 5) // 58 / 72
    expect(s2.stats.be).toBeCloseTo(44.3987, 3)
    expect(s2.stats.contamPct).toBe(10)
    expect(s2.stats.daysToPin).toBe(9)
    expect(rows[0].label).toBe('BO-01') // best BE first
    expect(s1.best).toBe(true)
    expect(s2.worst).toBe(true)
  })

  it('scorecard by cook run, room, week and worker', () => {
    const ctx = { strains: [S1, S2], cooks: COOKS }
    const cook = scorecard('COOK RUN', recs, ctx)
    expect(cook.map((r) => r.label).sort()).toEqual(['2026-08-02 STEAM BOX', '2026-08-09 STEAM BOX'])
    const c1 = cook.find((r) => r.label.startsWith('2026-08-02'))!
    expect(c1.stats.lots).toBe(2) // A, B
    expect(c1.stats.kg).toBe(82)
    const room = scorecard('ROOM', recs, ctx)
    expect(room.find((r) => r.label === 'FRUITING')!.stats.lots).toBe(4)
    expect(room.find((r) => r.label === 'INCUBATION')!.stats.lots).toBe(1)
    const wk = scorecard('WEEK', recs, ctx)
    expect(wk.map((r) => r.label)).toEqual(['2026-W38', '2026-W34', '2026-W33', '2026-W32']) // newest first
    expect(wk.find((r) => r.label === '2026-W33')!.stats.lots).toBe(2)
    const who = scorecard('WORKER', recs, ctx)
    expect(who.find((r) => r.label === 'AB')!.stats.kg).toBe(82)
    expect(who.find((r) => r.label === 'CD')!.stats.kg).toBe(58)
    expect(pickerTotals(HARV)).toEqual([
      { who: 'AB', kg: 82, picks: 3, lots: 2 },
      { who: 'CD', kg: 58, picks: 2, lots: 2 },
    ])
  })

  it('species filter and a lot with no strain', () => {
    const extra = lot('F', 'B1001', { species_key: 'lions-mane', knock_date: '2026-10-01' })
    const all = allRecords([...LOTS, extra], LOSSES, HARV, PINS)
    expect(scorecard('STRAIN', all, { strains: [S1, S2], cooks: COOKS }, 'blue-oyster').some((r) => r.label === 'NOT SET')).toBe(false)
    expect(scorecard('STRAIN', all, { strains: [S1, S2], cooks: COOKS }).some((r) => r.label === 'NOT SET')).toBe(true)
  })

  it('strain trial: arms, winners and a plain verdict', () => {
    const trial: StrainTrial = { id: 't1', name: 'BO-01 VS BO-02', species_key: 'blue-oyster', status: 'running', started_on: '2026-08-03', ended_on: null, question: null, notes: null }
    const inTrial = LOTS.map((l) => (['A', 'B', 'C', 'D'].includes(l.id) ? { ...l, trial_id: 't1' } : l))
    const arms = trialArms(trial, allRecords(inTrial, LOSSES, HARV, PINS), [S1, S2])
    expect(arms.map((a) => a.label)).toEqual(['BO-01', 'BO-02'])
    expect(arms[0].stats.lots).toBe(2) // E is not in the trial
    expect(arms[0].bestBe).toBe(true)
    expect(arms[1].bestBe).toBe(false)
    expect(arms[0].bestPin).toBe(true) // 8 days beats 9
    expect(arms[0].bestContam).toBe(true)
    const v = trialVerdict(arms)
    expect(v.text).toMatch(/^BO-01 LEADS ON BE%/)
    expect(v.text).toContain('51.4% AGAINST 44.4%')
    expect(trialVerdict([arms[0]]).warn).toBe(true)
    const tie = trialVerdict(arms.map((a) => ({ ...a, stats: { ...a.stats, be: 50 } })))
    expect(tie.text).toContain('TIE')
  })

  it('fading strain: newest three finished lots fall 15% under the earlier ones', () => {
    const mk = (i: number, kg: number) => ({ l: lot(`f${i}`, `B${i}`, { strain_id: 's1', knock_date: `2026-0${1 + i}-05`, bag_count: 50, status: 'spent' as const }), h: harv(`fh${i}`, `f${i}`, `2026-0${1 + i}-25`, kg) })
    const good = [46, 46, 46].map((k, i) => mk(i, k))
    const bad = [36, 35, 34].map((k, i) => mk(i + 3, k))
    const L = [...good, ...bad]
    const f = fadingStrains([S1], allRecords(L.map((x) => x.l), [], L.map((x) => x.h), []), 15)
    expect(f).toHaveLength(1)
    expect(f[0].fading).toBe(true)
    expect(f[0].earlierBe).toBeCloseTo((46 / (50 * DRY)) * 100, 4)
    expect(f[0].recentBe).toBeCloseTo((35 / (50 * DRY)) * 100, 4)
    expect(f[0].dropPct).toBeCloseTo(((46 - 35) / 46) * 100, 3)
    expect(f[0].recentCodes).toEqual(['B3', 'B4', 'B5'])
    // steady lots: not fading; too few lots: not listed
    const steady = fadingStrains([S1], allRecords(good.concat(good.map((_g, i) => mk(i + 3, 45))).map((x) => x.l), [], good.concat(good.map((_g, i) => mk(i + 3, 45))).map((x) => x.h), []), 15)
    expect(steady[0].fading).toBe(false)
    expect(fadingStrains([S1], allRecords(good.map((x) => x.l), [], good.map((x) => x.h), []), 15)).toEqual([])
  })

  it('ISO week and the next flush to pin', () => {
    expect(isoWeek('2026-08-03')).toBe('2026-W32')
    expect(isoWeek('2026-01-01')).toBe('2026-W01')
    expect(isoWeek('2025-12-29')).toBe('2026-W01')
    expect(isoWeek('2027-01-03')).toBe('2026-W53')
    expect(nextPinFlush('A', HARV, PINS)).toBe(2) // flush 1 pinned and picked
    expect(nextPinFlush('A', [], [])).toBe(1)
    expect(nextPinFlush('A', [], [pin('x', 'A', 1, '2026-08-11')])).toBe(1) // pinned, not picked yet: re-log flush 1
  })
})

describe('split a lot', () => {
  const L = lot('P', 'B1020', { bag_count: 60, knock_date: '2026-10-20', status: 'incubating' })
  it('rules', () => {
    expect(planSplit(L, [], [], [L], 20)).toMatchObject({ ok: true, childCode: 'B1020-S1', parentLeft: 40, childBlocks: 20 })
    expect(planSplit(L, [], [], [L], 0).ok).toBe(false)
    expect(planSplit(L, [], [], [L], 1.5).ok).toBe(false)
    expect(planSplit(L, [], [], [L], 60).error).toMatch(/FEWER THAN 60/)
    expect(planSplit(L, [loss('x', 'P', 10)], [], [L], 50).ok).toBe(false) // only 50 alive: cannot split all
    expect(planSplit(L, [loss('x', 'P', 10)], [], [L], 49).ok).toBe(true)
    expect(planSplit(L, [], [harv('h', 'P', '2026-11-12', 3)], [L], 5).error).toMatch(/PICKS ALREADY/)
    expect(planSplit({ ...L, status: 'spent' }, [], [], [L], 5).ok).toBe(false)
  })
  it('codes count up and never repeat', () => {
    const c1 = lot('c1', 'B1020-S1', { knock_date: '2026-10-20' })
    expect(splitCode(L, [L, c1])).toBe('B1020-S2')
    expect(splitCode(c1, [L, c1])).toBe('B1020-S2') // splitting a child keeps the family code
  })
  it('splitting conserves blocks and writes both lots as one undo step', async () => {
    const st = new Store(new MemoryBackend())
    await st.put('block_lots', L)
    const c = await st.action('SPLIT', () => splitLot(st, { lot: L, losses: [], harvests: [], lots: st.rows<BlockLot>('block_lots'), n: 25, cart: 'c-09', room: 'fruiting' }))
    const rows = st.rows<BlockLot>('block_lots')
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === 'P')!.bag_count).toBe(35)
    expect(c.bag_count).toBe(25)
    expect(c.cart).toBe('C-09')
    expect(c.room).toBe('fruiting')
    expect(c.parent_lot_id).toBe('P')
    expect(rows.reduce((n, r) => n + r.bag_count, 0)).toBe(60)
    await st.undo()
    expect(st.rows<BlockLot>('block_lots')).toHaveLength(1)
    expect(st.rows<BlockLot>('block_lots')[0].bag_count).toBe(60)
  })
})

describe('mock trial: a harvest session, a cart and bulk changes, all in the edit history', () => {
  it('runs a week end to end and checks every number', async () => {
    const st = new Store(new MemoryBackend())
    await st.put('strains', [S1, S2])
    // Tuesday knock: one cart, three lines.
    const lots0 = st.rows<BlockLot>('block_lots')
    const made = await st.action('INOCULATE CART', () => inoculateCart(st, { cart: 'c-07', knock: '2026-11-03', by: 'ab', cookId: null, lines: [
      { species: 'blue-oyster', strainId: 's1', grainId: null, blocks: 52 },
      { species: 'lions-mane', strainId: null, grainId: null, blocks: 46 },
      { species: 'blue-oyster', strainId: 's2', grainId: null, blocks: 16 },
    ], lots: lots0, strains: [S1, S2], grain: [] }))
    expect(made.map((l) => l.lot_code)).toEqual(['B1103', 'L1103', 'B1103-2'])
    expect(made.every((l) => l.cart === 'C-07' && l.room === 'incubation' && l.knocked_by === 'AB')).toBe(true)
    expect(made.reduce((n, l) => n + l.bag_count, 0)).toBe(114)
    expect(st.undoPeek()?.label).toBe('INOCULATE CART')

    // Move the whole cart to fruiting.
    const lots = () => st.rows<BlockLot>('block_lots')
    await st.action('MOVE CART', () => bulkLots(st, lots(), { status: 'fruiting', day: '2026-11-10' }, []))
    expect(lots().every((l) => l.status === 'fruiting' && l.room === 'fruiting' && l.to_fruiting_on === '2026-11-10')).toBe(true)

    // Pins, then a harvest session: ONE undo step, three picks.
    const B = lots().find((l) => l.lot_code === 'B1103')!
    const LM = lots().find((l) => l.lot_code === 'L1103')!
    await st.action('PINS', () => logPins(st, B, 1, '2026-11-11', []))
    await st.ensure('flush_log')
    await expect(logPins(st, B, 1, '2026-11-01', [])).rejects.toThrow(/BEFORE THE KNOCK/)
    const picks = await st.action('SESSION', () => harvestSession(st, { day: '2026-11-14', initials: 'cd', rows: [
      { lot: B, kg: 24.5, flush: 1, grade: 'A' },
      { lot: LM, kg: 19.25, flush: 1, grade: 'B' },
      { lot: lots().find((l) => l.lot_code === 'B1103-2')!, kg: 0, flush: 1, grade: 'A' }, // blank row is skipped
    ] }))
    expect(picks).toHaveLength(2)
    expect(st.rows<Harvest>('harvests').reduce((n, h) => n + Number(h.kg), 0)).toBeCloseTo(43.75, 6)
    expect(st.rows<Harvest>('harvests').every((h) => h.initials === 'CD' && h.harvested_on === '2026-11-14')).toBe(true)
    await expect(harvestSession(st, { day: '2026-11-14', initials: '', rows: [{ lot: B, kg: 1, flush: 1, grade: 'A' }] })).rejects.toThrow(/INITIALS/)
    await expect(harvestSession(st, { day: '2026-11-14', initials: 'x', rows: [{ lot: B, kg: 1, flush: 12, grade: 'A' }] })).rejects.toThrow(/FLUSH/)
    await expect(harvestSession(st, { day: '2026-11-14', initials: 'x', rows: [] })).rejects.toThrow(/AT LEAST ONE/)
    // BE% of the new lot: 24.5 kg over 52 blocks.
    const rec = lotRecord(lots().find((l) => l.lot_code === 'B1103')!, [], st.rows<Harvest>('harvests'), st.rows<FlushLog>('flush_log'))
    expect(rec.be).toBeCloseTo((24.5 / (52 * DRY)) * 100, 6)
    expect(rec.daysToPin).toBe(8) // 3 Nov -> 11 Nov
    expect(rec.daysToFirstPick).toBe(11)

    // Lose the whole third line to green mould: one bulk action, loss line for every live block.
    const third = lots().find((l) => l.lot_code === 'B1103-2')!
    await st.action('LOST', () => bulkLots(st, [third], { status: 'lost', hazard: 'trichoderma' }, []))
    expect(lots().find((l) => l.id === third.id)!.status).toBe('lost')
    expect(survivors(third, st.rows<LotLoss>('lot_losses'))).toBe(0)
    expect(st.rows<LotLoss>('lot_losses')).toHaveLength(1)

    // Trial: add two lots, take one out.
    const t = await st.action('TRIAL', () => createTrial(st, { name: ' blue shoot-out ', species_key: 'blue-oyster' }))
    await expect(createTrial(st, { name: '  ', species_key: 'blue-oyster' })).rejects.toThrow(/NAME/)
    await st.action('ADD', () => bulkLots(st, [B], { trialId: t.id }, []))
    expect(lots().find((l) => l.id === B.id)!.trial_id).toBe(t.id)
    await setLotPlace(st, B, { cart: 'c-08', room: 'incubation', knocked_by: 'zz', dry_kg_per_block: 1.7 })
    expect(lots().find((l) => l.id === B.id)).toMatchObject({ cart: 'C-08', room: 'incubation', knocked_by: 'ZZ', dry_kg_per_block: 1.7 })
    await expect(setLotPlace(st, B, { dry_kg_per_block: -1 })).rejects.toThrow(/DRY WEIGHT/)

    // Every write is in the edit history with a label.
    await settle()
    await st.ensure(EDIT_LOG)
    const log = st.rows<EditEntry>(EDIT_LOG)
    const labels = new Set(log.map((e) => e.label))
    for (const want of ['INOCULATE CART', 'MOVE CART', 'PINS', 'SESSION', 'LOST', 'TRIAL', 'ADD']) expect(labels.has(want)).toBe(true)
    expect(log.filter((e) => e.label === 'SESSION').every((e) => e.table_name === 'harvests' || e.table_name === 'block_lots')).toBe(true)

    // UNDO of the cart move brings every lot back to incubating in one step.
    await st.undo() // trial add / place edit etc. are newer; undo them first
    while (st.undoPeek() && st.undoPeek()!.label !== 'MOVE CART') await st.undo()
    await st.undo()
    expect(lots().filter((l) => l.status === 'incubating')).toHaveLength(3)
  })
})

describe('history resilience: two years of back data stays true', () => {
  it('old lots keep their numbers when new data, new settings and a backup round-trip arrive', async () => {
    const lots: BlockLot[] = []
    const harvests: Harvest[] = []
    const pins: FlushLog[] = []
    // 104 weekly lots over 2 years, 2 strains alternating, BE 50% (2025) then 45% (2026) for strain s2.
    for (let w = 0; w < 104; w++) {
      const d = new Date(Date.UTC(2024, 10, 5 + w * 7))
      const day = d.toISOString().slice(0, 10)
      const id = `old${w}`
      const sid = w % 2 ? 's2' : 's1'
      lots.push(lot(id, `B${w}`, { strain_id: sid, knock_date: day, bag_count: 60, status: 'spent', room: 'fruiting', knocked_by: 'AB' }))
      const be = sid === 's2' && w >= 52 ? 0.45 : 0.5
      harvests.push(harv(`oh${w}`, id, new Date(Date.UTC(2024, 10, 5 + w * 7 + 20)).toISOString().slice(0, 10), +(be * 60 * DRY).toFixed(3)))
      pins.push(pin(`op${w}`, id, 1, new Date(Date.UTC(2024, 10, 5 + w * 7 + 9)).toISOString().slice(0, 10)))
    }
    const before = allRecords(lots, [], harvests, pins)
    const snap = JSON.stringify(before.map((r) => [r.lot.id, r.be, r.kgPerBlock, r.daysToPin, r.complete]))
    expect(before.every((r) => r.complete && Math.abs(r.be! - (r.lot.strain_id === 's2' && Number(r.lot.id.slice(3)) >= 52 ? 45 : 50)) < 0.01)).toBe(true)
    // New data arrives (more lots, a retired strain, a changed dry weight on ONE new lot) ...
    const more = [...lots, lot('new', 'B999', { strain_id: 's9', knock_date: '2026-11-03', bag_count: 10, dry_kg_per_block: 1.2, status: 'incubating' })]
    const after = allRecords(more, [], harvests, pins)
    // ... old records are byte-for-byte the same.
    expect(JSON.stringify(after.slice(0, 104).map((r) => [r.lot.id, r.be, r.kgPerBlock, r.daysToPin, r.complete]))).toBe(snap)
    // The scorecard shows strain s2 down year on year, via the week view split.
    const f = fadingStrains([S1, S2], after, 15)
    expect(f.find((x) => x.strain.id === 's2')?.fading).toBe(false) // 5.7% down is under the 15% line
    expect(fadingStrains([S1, S2], after, 5).find((x) => x.strain.id === 's2')?.fading).toBe(true) // the same data, a tighter line (last 3 at 45% vs 47.7% before = 5.7% down)
    expect(fadingStrains([S1, S2], after, 15).find((x) => x.strain.id === 's1')?.fading).toBe(false)
    // Export + import into a fresh store keeps every row and the numbers.
    const a = new Store(new MemoryBackend())
    await a.put('strains', [S1, S2])
    await a.put('block_lots', lots)
    await a.put('harvests', harvests)
    await a.put('flush_log', pins)
    await a.put('strain_trials', { id: 't', name: 'T', species_key: 'blue-oyster', status: 'running', started_on: '2026-01-01', ended_on: null, question: null, notes: null })
    const text = await a.exportJson()
    const b = new Store(new MemoryBackend())
    const counts = await b.importJson(text)
    expect(counts.block_lots).toBe(104)
    expect(counts.flush_log).toBe(104)
    expect(counts.strain_trials).toBe(1)
    const again = allRecords(b.rows<BlockLot>('block_lots'), [], b.rows<Harvest>('harvests'), b.rows<FlushLog>('flush_log'))
    const byId = (rs: typeof again) => JSON.stringify(rs.map((r) => [r.lot.id, r.be, r.kgPerBlock, r.daysToPin, r.complete]).sort())
    expect(byId(again)).toBe(byId(before))
    await b.importJson(text) // a second import changes nothing
    expect(b.rows('block_lots')).toHaveLength(104)
  })

  it('a lot that has no new fields (older data) still works everywhere', () => {
    const old = { id: 'o', lot_code: 'B0101', species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 30, knock_date: '2025-01-07', status: 'spent', notes: null } as BlockLot
    const r = lotRecord(old, [], [harv('z', 'o', '2025-01-30', 27.2)], [])
    expect(r.be).toBeCloseTo((27.2 / (30 * DRY)) * 100, 6)
    expect(r.daysToPin).toBeNull()
    expect(scorecard('ROOM', [r], { strains: [], cooks: [] })[0].label).toBe('NOT SET')
    expect(groupStats([r]).yieldLots).toBe(1)
  })
})

describe('photos', () => {
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
  it('sizes and checks', () => {
    expect(fitSize(4000, 3000)).toEqual({ w: 960, h: 720 })
    expect(fitSize(600, 400)).toEqual({ w: 600, h: 400 }) // never enlarged
    expect(fitSize(0, 10)).toEqual({ w: 0, h: 0 })
    expect(isImageDataUrl(jpeg)).toBe(true)
    expect(isImageDataUrl('data:text/html;base64,AAAA')).toBe(false)
    expect(isImageDataUrl('javascript:alert(1)')).toBe(false)
    expect(dataUrlBytes('data:image/png;base64,QUJD')).toBe(3)
    expect(dataUrlBytes('data:image/png;base64,QUI=')).toBe(2)
  })
  it('saves, lists newest first, stays out of the history text, and goes with its record', async () => {
    const st = new Store(new MemoryBackend())
    await st.put('block_lots', lot('L', 'B1'))
    const mk = (cap: string) => ({ data_url: jpeg, w: 10, h: 10, mime: 'image/jpeg', cap })
    const p1 = await st.action('ADD PHOTO', () => addPhoto(st, 'block_lots', 'L', mk(''), [], 'first'))
    await new Promise((r) => setTimeout(r, 3))
    await st.action('ADD PHOTO', () => addPhoto(st, 'block_lots', 'L', mk(''), st.rows<Photo>('photos'), 'second'))
    const ph = photosOf(st.rows<Photo>('photos'), 'block_lots', 'L')
    expect(ph.map((p) => p.caption)).toEqual(['second', 'first'])
    expect(p1.bytes).toBe(dataUrlBytes(jpeg))
    await expect(addPhoto(st, 'harvests', 'L', mk(''), [])).rejects.toThrow(/CANNOT BE ATTACHED/)
    await expect(addPhoto(st, 'block_lots', 'L', { ...mk(''), data_url: 'data:text/plain;base64,AA==' }, [])).rejects.toThrow(/NOT A PICTURE/)
    await settle()
    await st.ensure(EDIT_LOG)
    const create = st.rows<EditEntry>(EDIT_LOG).find((e) => e.table_name === 'photos' && e.op === 'create')!
    expect(JSON.stringify(create.changes)).not.toContain('/9j/')
    expect(create.changes.find((c) => c.f === 'data_url')?.new).toBe('[PHOTO]')
    // the lot is deleted: its photos and pin days go too, and a split child is released
    await st.put('flush_log', pin('pp', 'L', 1, '2026-08-01'))
    await st.put('block_lots', lot('K', 'B1-S1', { parent_lot_id: 'L' }))
    await dropExtras(st, 'block_lots', ['L'])
    await st.del('block_lots', 'L')
    expect(st.rows('photos')).toHaveLength(0)
    expect(st.rows('flush_log')).toHaveLength(0)
    expect(st.rows<BlockLot>('block_lots')[0].parent_lot_id).toBeNull()
  })
  it('the 24 photo limit', async () => {
    const st = new Store(new MemoryBackend())
    const img = { data_url: jpeg, w: 1, h: 1, mime: 'image/jpeg' }
    for (let i = 0; i < 24; i++) await addPhoto(st, 'cultures', 'c', img, st.rows<Photo>('photos'))
    await expect(addPhoto(st, 'cultures', 'c', img, st.rows<Photo>('photos'))).rejects.toThrow(/24 PHOTOS/)
  })
})

describe('scan: what a label or a typed code opens', () => {
  const cultures = [{ id: 'cu1', label: 'BO-01 W3 P1 2026-11-09-1', strain_id: 's1' }] as unknown as Culture[]
  const grain = [{ id: 'g1', label: 'G2-BO-01-1', strain_id: 's1' }] as unknown as GrainRun[]
  const lots = [
    lot('b1', 'B1020', { cart: 'C-07', status: 'fruiting', knock_date: '2026-10-20' }),
    lot('b2', 'L1020', { cart: 'c-07', status: 'incubating', species_key: 'lions-mane', knock_date: '2026-10-20' }),
    lot('b3', 'B0901', { cart: 'C-07', status: 'spent', knock_date: '2026-09-01' }), // finished: not on the cart any more
    lot('b4', 'B1020', { status: 'spent', knock_date: '2025-10-20' }), // same code last year
  ]
  const d = { lots, cultures, grain }
  it('parses labels, links, keys and cart tags', () => {
    expect(parseScan('https://josephmclachlan.github.io/MY-CO-L/#xeno/b/b1')).toEqual({ kind: 'lot', id: 'b1' })
    expect(parseScan('#xeno/c/cu1')).toEqual({ kind: 'culture', id: 'cu1' })
    expect(parseScan('g:g1')).toEqual({ kind: 'grain', id: 'g1' })
    expect(parseScan(cartUrl('c-07'))).toEqual({ kind: 'cart', id: 'C-07' })
    expect(parseScan('hello')).toBeNull()
    expect(parseScan('')).toBeNull()
    expect(parseScan('https://example.com/#xeno/x/1')).toBeNull()
    expect(parseScan('#cart/<script>')).toBeNull()
  })
  it('finds records and carts; typed lot codes prefer the newest lot', () => {
    expect(resolveScan('#xeno/b/b1', d)).toMatchObject({ kind: 'lot' })
    expect(resolveScan('#xeno/b/zzz', d)).toBeNull()
    const cart = resolveScan(cartUrl('C-07'), d)
    expect(cart?.kind).toBe('cart')
    if (cart?.kind === 'cart') expect(cart.lots.map((l) => l.id).sort()).toEqual(['b1', 'b2'])
    expect(resolveScan('b1020', d)).toMatchObject({ kind: 'lot', lot: { id: 'b1' } })
    expect(resolveScan('bo-01 w3 p1 2026-11-09-1', d)).toMatchObject({ kind: 'culture' })
    expect(resolveScan('g2-bo-01-1', d)).toMatchObject({ kind: 'grain' })
    expect(resolveScan('nothing here', d)).toBeNull()
    expect(resolveScan('c-99', d)).toBeNull()
  })
  it('cart label address round-trips', () => {
    expect(cartUrl('C-07')).toMatch(/#cart\/C-07$/)
  })
})

describe('flush test (Joseph 6 Nov 2026: test multiple flushes before committing)', () => {
  // Three spent lion's mane lots of 10 blocks (no losses):
  //   L1: flush 1 10 kg (day 1), flush 2 5 kg (day 15), flush 3 1 kg (day 30)
  //   L2: flush 1 12 kg (day 1), flush 2 6 kg (day 13)
  //   L3: flush 1 8 kg (day 1),  flush 2 4 kg (day 14), flush 3 1 kg (day 29)
  // kg/block: flush 1 = (1 + 1.2 + 0.8) / 3 = 1.0; flush 2 = (0.5 + 0.6 + 0.4) / 3 = 0.5; flush 3 = (0.1 + 0 + 0.1) / 3 = 0.0667
  // vs flush 1: 100%, 50%, 6.7% -> suggest 2 (flush 3 adds under 15%). Gaps: f2 (14+12+13)/3 = 13, f3 (15+15)/2 = 15.
  const L = (id: string, status: BlockLot['status'] = 'spent') => lot(id, id, { species_key: 'lions-mane', bag_count: 10, knock_date: '2026-09-01', status })
  const lots = [L('L1'), L('L2'), L('L3'), L('L4', 'fruiting')]
  const h = [
    harv('a1', 'L1', '2026-10-01', 10, 1), harv('a2', 'L1', '2026-10-15', 5, 2), harv('a3', 'L1', '2026-10-30', 1, 3),
    harv('b1', 'L2', '2026-10-01', 12, 1), harv('b2', 'L2', '2026-10-13', 6, 2),
    harv('c1', 'L3', '2026-10-01', 8, 1), harv('c2', 'L3', '2026-10-14', 4, 2), harv('c3', 'L3', '2026-10-29', 1, 3),
    harv('d1', 'L4', '2026-10-20', 9, 1),
  ]
  const recs = allRecords(lots, [], h, [])
  it('a lot in test stays open after flush 1 until marked spent', () => {
    expect(recs.find((r) => r.lot.id === 'L4')!.complete).toBe(false)
    expect(recs.find((r) => r.lot.id === 'L2')!.complete).toBe(true)
  })
  it('shows what each flush gives and suggests a count', () => {
    const t = flushTest(recs, 'lions-mane')
    expect(t.finished).toBe(3)
    expect(t.open).toBe(1)
    expect(t.rows.map((r) => Number(r.kgPerBlock.toFixed(4)))).toEqual([1, 0.5, 0.0667])
    expect(t.rows.map((r) => r.lots)).toEqual([3, 3, 2])
    expect(t.rows[1].vsFirstPct).toBeCloseTo(50, 6)
    expect(t.rows.map((r) => r.gapDays)).toEqual([null, 13, 15])
    expect(t.rows.reduce((n, r) => n + r.sharePct, 0)).toBeCloseTo(100, 6)
    expect(t.suggest).toBe(2)
  })
  it('waits for 3 finished lots before suggesting', () => {
    expect(flushTest(recs.filter((r) => r.lot.id !== 'L3'), 'lions-mane').suggest).toBeNull()
    expect(flushTest(recs, 'blue-oyster')).toMatchObject({ finished: 0, rows: [], suggest: null })
  })
})
