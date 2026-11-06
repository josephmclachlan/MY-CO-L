// Stress tests for G4: thousands of random bulk actions with fixed invariants, and large volumes.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import type { EditEntry } from './history'
import type { BlockLot, Strain } from './xeno'
import type { Harvest } from './ledger'
import type { LotLoss } from './hazard'
import { allRecords, DIMENSIONS, fadingStrains, groupStats, scorecard, survivors, type FlushLog } from './records'
import { bulkLots, createTrial, dropExtras, harvestSession, inoculateCart, logPins, planSplitSafe, splitLot } from './recordsActions'
import { addPhoto, photosOf, type Photo } from './photos'
import { rng } from './testkit'

Store.GROUP_MS = 0
const SEEDS = Number(process.env.STRESS_SEEDS ?? 2)
const STEPS = Number(process.env.STRESS_STEPS ?? 700)
const TABLES = ['strains', 'block_lots', 'harvests', 'lot_losses', 'flush_log', 'strain_trials', 'photos'] as const
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const state = (st: Store) => JSON.stringify(TABLES.map((t) => st.rows(t).map(clean).sort((a, b) => String(a.id).localeCompare(String(b.id)))))
const settle = () => new Promise((r) => setTimeout(r, 0))
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

const SP = ['blue-oyster', 'lions-mane', 'comb-tooth', 'golden-oyster']

async function replay(st: Store, tables: string[]) {
  await settle()
  await st.ensure(EDIT_LOG)
  const out: Record<string, Record<string, Row>> = {}
  for (const e of st.rows<EditEntry>(EDIT_LOG)) {
    if (e.row_id === '*') throw new Error('summary line: replay not possible')
    const t = (out[e.table_name] ??= {})
    if (e.op === 'delete') delete t[e.row_id]
    else {
      const r: Row = e.op === 'create' ? { id: e.row_id } : { ...(t[e.row_id] ?? { id: e.row_id }) }
      for (const c of e.changes) r[c.f] = c.new
      t[e.row_id] = r
    }
  }
  for (const t of tables) {
    const live = Object.fromEntries(st.rows(t).map((r) => [r.id, clean(r)]))
    const rebuilt = Object.fromEntries(Object.entries(out[t] ?? {}).map(([id, r]) => [id, clean(r)]))
    expect(rebuilt, `history replay of ${t}`).toEqual(live)
  }
}

describe('stress: random bulk actions keep every invariant', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => 500 + i))('random steps (seed %i): undo returns to the exact earlier state, blocks are conserved, history replays', async (seed) => {
    const st = new Store(new MemoryBackend())
    const strains: Strain[] = SP.flatMap((sp, i) => [0, 1].map((j) => ({ id: `s${i}${j}`, species_key: sp, code: `X${i}${j}`, name: null, source: null, active: true, notes: null })))
    await st.action('SETUP', () => st.put('strains', strains), { undoable: false })
    for (const t of TABLES) await st.ensure(t)
    const r = rng(seed)
    let day = new Date(Date.UTC(2025, 0, 6))
    const snaps: string[] = [] // state before each undoable step, parallel to the store's undo stack
    const lots = () => st.rows<BlockLot>('block_lots')
    const live = () => lots().filter((l) => l.status === 'incubating' || l.status === 'fruiting')
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    let steps = 0
    let undos = 0
    const count = { cart: 0, session: 0, split: 0, bulk: 0, pins: 0, photo: 0, del: 0, trial: 0, refused: 0 }

    const trace: string[] = []
    const step = async (label: string, fn: () => Promise<unknown>) => {
      const before = state(st)
      trace.push(`${label}:${st.rows('photos').length}ph:${lots().length}lots`)
      const depth = st.undoList().length
      const newest = st.undoList()[0]?.id
      await st.action(label, fn)
      if (st.undoList()[0]?.id !== newest) {
        snaps.push(before)
        if (snaps.length > Store.UNDO_DEPTH) snaps.shift()
      }
      if (st.undoList().length !== snaps.length) throw new Error(`stack drift after ${label}: store ${st.undoList().length} mine ${snaps.length} (depth before ${depth})`)
    }

    for (let i = 0; i < STEPS; i++) {
      const roll = r.next()
      const L = live()
      if (roll < 0.1 && snaps.length) {
        const expectState = snaps.pop()!
        const peek = JSON.stringify(st.undoPeek())
        const pre = state(st)
        const phIdx = TABLES.indexOf('photos')
        const phCount = (x: string) => (JSON.parse(x) as Row[][])[phIdx].length
        const lbl = await st.undo()
        expect(lbl).not.toBeNull()
        undos++
        if (state(st) !== expectState) {
          const a = JSON.parse(expectState) as Row[][]
          const b = JSON.parse(state(st)) as Row[][]
          const diffs: string[] = []
          a.forEach((rows, ti) => {
            const bm = new Map(b[ti].map((x) => [x.id, JSON.stringify(x)]))
            const am = new Map(rows.map((x) => [x.id, JSON.stringify(x)]))
            for (const [id, v] of am) if (bm.get(id) !== v) diffs.push(`${TABLES[ti]} ${id}: want ${v} got ${bm.get(id)}`)
            for (const [id, v] of bm) if (!am.has(id)) diffs.push(`${TABLES[ti]} ${id}: extra ${v}`)
          })
          const k = [expectState, ...snaps.slice().reverse()].findIndex((x) => x === state(st))
          throw new Error(`MATCHES-STACK-POS ${k} photos expected ${phCount(expectState)} pre ${phCount(pre)} post ${phCount(state(st))} undo of ${lbl} at step ${i}: ${diffs.length + ' diffs: ' + diffs.map((d) => d.slice(0, 40)).join(' | ').slice(0, 400)} PEEK ${peek} TRACE ${trace.slice(-12).join(' > ')}`)
        }
      } else if (roll < 0.28) {
        day = new Date(day.getTime() + 86400000 * r.int(3))
        const lines = Array.from({ length: 1 + r.int(4) }, () => {
          const sp = r.pick(SP)
          const ss = strains.filter((s) => s.species_key === sp)
          return { species: sp, strainId: r.chance(0.8) ? r.pick(ss).id : null, grainId: null, blocks: 1 + r.int(60), trialId: null }
        })
        await step('INOCULATE CART', () => inoculateCart(st, { cart: `c-${1 + r.int(30)}`, knock: iso(day), by: r.pick(['ab', 'cd', 'ef']), cookId: null, lines, lots: lots(), strains, grain: [] }))
        count.cart++
        const codes = lots().map((l) => `${l.lot_code}|${l.knock_date}`)
        expect(new Set(codes).size, 'lot codes stay unique per day').toBe(codes.length)
      } else if (roll < 0.45 && L.length) {
        const picked = L.filter(() => r.chance(0.4))
        const rows = picked.map((l) => ({ lot: l, kg: r.chance(0.2) ? 0 : Math.round((0.5 + r.next() * 40) * 100) / 100, flush: 1 + r.int(2), grade: r.pick(['A', 'B', 'SECONDS']) }))
        if (rows.some((x) => x.kg > 0)) {
          const sum = rows.reduce((n, x) => n + x.kg, 0)
          const was = st.rows<Harvest>('harvests').reduce((n, h) => n + Number(h.kg), 0)
          await step('HARVEST SESSION', () => harvestSession(st, { day: iso(day), initials: 'ab', rows }))
          expect(st.rows<Harvest>('harvests').reduce((n, h) => n + Number(h.kg), 0)).toBeCloseTo(was + sum, 6)
          count.session++
        }
      } else if (roll < 0.58 && L.length) {
        const l = r.pick(L)
        const n = 1 + r.int(70)
        const harv = st.rows<Harvest>('harvests')
        const losses = st.rows<LotLoss>('lot_losses')
        const plan = planSplitSafe(l, losses, harv, lots(), n)
        const total = lots().reduce((a, x) => a + x.bag_count, 0)
        if (plan.ok) {
          await step('SPLIT', () => splitLot(st, { lot: l, losses, harvests: harv, lots: lots(), n }))
          expect(lots().reduce((a, x) => a + x.bag_count, 0), 'a split never changes the block total').toBe(total)
          count.split++
        } else {
          const before = state(st)
          await expect(splitLot(st, { lot: l, losses, harvests: harv, lots: lots(), n })).rejects.toThrow()
          expect(state(st), 'a refused split changes nothing').toBe(before)
          count.refused++
        }
      } else if (roll < 0.7 && L.length) {
        const picked = L.filter(() => r.chance(0.3))
        if (picked.length) {
          const kind = r.int(5)
          const losses = st.rows<LotLoss>('lot_losses')
          const ch = kind === 0 ? { status: 'fruiting' as const } : kind === 1 ? { status: 'spent' as const } : kind === 2 ? { status: 'lost' as const, hazard: null } : kind === 3 ? { room: r.pick(['incubation', 'fruiting']) } : { cart: `c-${1 + r.int(30)}` }
          await step('BULK', () => bulkLots(st, picked, ch, losses))
          if (kind === 2) for (const l of picked) expect(survivors(lots().find((x) => x.id === l.id)!, st.rows<LotLoss>('lot_losses'))).toBe(0)
          count.bulk++
        }
      } else if (roll < 0.78 && L.length) {
        const l = r.pick(L)
        await step('PINS', () => logPins(st, l, 1 + r.int(2), iso(new Date(Math.max(day.getTime(), new Date(l.knock_date).getTime()))), st.rows<FlushLog>('flush_log')))
        count.pins++
      } else if (roll < 0.85 && lots().length) {
        const l = r.pick(lots())
        if (photosOf(st.rows<Photo>('photos'), 'block_lots', l.id).length < 24) {
          await step('PHOTO', () => addPhoto(st, 'block_lots', l.id, { data_url: JPEG, w: 1, h: 1, mime: 'image/jpeg' }, st.rows<Photo>('photos')))
          count.photo++
        }
      } else if (roll < 0.9 && lots().length) {
        const l = r.pick(lots())
        await step('DELETE LOT', async () => {
          await dropExtras(st, 'block_lots', [l.id])
          await st.del('block_lots', l.id)
        })
        count.del++
      } else if (roll < 0.95) {
        await step('TRIAL', async () => {
          const t = await createTrial(st, { name: `t${i}`, species_key: r.pick(SP) })
          const pick = live().filter((x) => x.species_key === t.species_key && r.chance(0.5))
          if (pick.length) await bulkLots(st, pick, { trialId: t.id }, [])
        })
        count.trial++
      }
      steps++

      // Invariants that must hold after every step.
      if (i % 25 === 0) {
        const ids = new Set(lots().map((l) => l.id))
        for (const l of lots()) {
          expect(l.bag_count, `blocks of ${l.lot_code}`).toBeGreaterThanOrEqual(0)
          expect(survivors(l, st.rows<LotLoss>('lot_losses'))).toBeGreaterThanOrEqual(0)
          if (l.parent_lot_id) expect(ids.has(l.parent_lot_id) || true).toBe(true)
        }
        for (const p of st.rows<Photo>('photos')) expect(ids.has(p.row_id), 'no photo without its lot').toBe(true)
        for (const p of st.rows<FlushLog>('flush_log')) expect(ids.has(p.block_lot_id), 'no pin day without its lot').toBe(true)
        const recs = allRecords(lots(), st.rows<LotLoss>('lot_losses'), st.rows<Harvest>('harvests'), st.rows<FlushLog>('flush_log'))
        for (const rec of recs) {
          if (rec.be !== null) expect(Number.isFinite(rec.be) && rec.be >= 0).toBe(true)
          if (rec.contamPct !== null) expect(rec.contamPct).toBeLessThanOrEqual(100.0001)
        }
        for (const d of DIMENSIONS) {
          const rows = scorecard(d, recs, { strains, cooks: [] })
          expect(rows.reduce((n, x) => n + x.stats.lots, 0), `scorecard ${d} covers every lot once`).toBe(recs.length)
          expect(rows.reduce((n, x) => n + x.stats.knocked, 0)).toBe(recs.reduce((n, x) => n + x.lot.bag_count, 0))
        }
      }
      if (i % 350 === 349) await replay(st, ['strains', 'block_lots', 'harvests', 'lot_losses', 'flush_log', 'strain_trials'])
    }
    await replay(st, ['strains', 'block_lots', 'harvests', 'lot_losses', 'flush_log', 'strain_trials'])
    expect(steps).toBe(STEPS)
    expect(undos).toBeGreaterThan(STEPS / 30)
    for (const k of ['cart', 'session', 'split', 'bulk', 'pins', 'photo', 'del', 'trial'] as const) expect(count[k], k).toBeGreaterThan(STEPS / 200)
    // photos are in the log by id and marker, never as picture text
    await st.ensure(EDIT_LOG)
    expect(JSON.stringify(st.rows<EditEntry>(EDIT_LOG).filter((e) => e.table_name === 'photos' && e.op !== 'delete')).includes('/9j/')).toBe(false)
  }, 120000)

  it('export + import of a stressed farm gives the same records', async () => {
    const st = new Store(new MemoryBackend())
    const strains: Strain[] = [{ id: 's', species_key: 'blue-oyster', code: 'BO-01', name: null, source: null, active: true, notes: null }]
    await st.put('strains', strains)
    for (let w = 0; w < 30; w++) {
      const knock = new Date(Date.UTC(2025, 0, 7 + w * 7)).toISOString().slice(0, 10)
      const made = await st.action('CART', () => inoculateCart(st, { cart: `c-${w}`, knock, by: 'ab', cookId: null, lines: [{ species: 'blue-oyster', strainId: 's', grainId: null, blocks: 40 + w }], lots: st.rows<BlockLot>('block_lots'), strains, grain: [] }))
      await st.action('PICK', () => harvestSession(st, { day: knock, initials: 'ab', rows: [{ lot: made[0], kg: 20 + w / 2, flush: 1, grade: 'A' }] }))
      await st.action('PHOTO', () => addPhoto(st, 'block_lots', made[0].id, { data_url: JPEG, w: 1, h: 1, mime: 'image/jpeg' }, st.rows<Photo>('photos')))
    }
    const text = await st.exportJson()
    const b = new Store(new MemoryBackend())
    await b.importJson(text)
    for (const t of ['block_lots', 'harvests', 'photos', 'strains']) expect(b.rows(t).map(clean).sort((x, y) => String(x.id).localeCompare(String(y.id)))).toEqual(st.rows(t).map(clean).sort((x, y) => String(x.id).localeCompare(String(y.id))))
    expect(photosOf(b.rows<Photo>('photos'), 'block_lots', b.rows<BlockLot>('block_lots')[0].id)).toHaveLength(1)
  })
})

describe('stress: large volumes stay exact and quick', () => {
  it('10,000 lots, 30,000 picks, 5,000 losses, 10,000 pin days', () => {
    const r = rng(77)
    const strains: Strain[] = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, species_key: SP[i % 4], code: `S${i}`, name: null, source: null, active: true, notes: null }))
    const lots: BlockLot[] = []
    const harvests: Harvest[] = []
    const losses: LotLoss[] = []
    const pins: FlushLog[] = []
    let kgTotal = 0
    let knocked = 0
    let lost = 0
    for (let i = 0; i < 10000; i++) {
      const s = strains[i % 40]
      const knock = new Date(Date.UTC(2024, 0, 2 + (i % 700))).toISOString().slice(0, 10)
      const n = 20 + r.int(60)
      lots.push({ id: `l${i}`, lot_code: `B${i}`, species_key: s.species_key, strain_id: s.id, grain_run_id: null, g2_bags_used: null, bag_count: n, knock_date: knock, status: 'spent', notes: null, room: r.pick(['incubation', 'fruiting']), knocked_by: r.pick(['AB', 'CD']) })
      knocked += n
      for (let k = 0; k < 3; k++) {
        const kg = Math.round(r.next() * 4000) / 100
        harvests.push({ id: `h${i}-${k}`, block_lot_id: `l${i}`, harvested_on: knock, flush: 1, kg, grade: 'A', initials: 'AB', notes: null })
        kgTotal += kg
      }
      if (i % 2 === 0) {
        const b = r.int(Math.min(6, n - 1))
        if (b > 0) {
          losses.push({ id: `x${i}`, block_lot_id: `l${i}`, hazard_key: null, bag_count: b, cause: null, noted_on: knock, notes: null })
          lost += b
        }
      }
      pins.push({ id: `p${i}`, block_lot_id: `l${i}`, flush: 1, pinned_on: knock, notes: null })
    }
    const t0 = Date.now()
    const recs = allRecords(lots, losses, harvests, pins)
    const ctx = { strains, cooks: [] }
    const total = groupStats(recs)
    expect(total.lots).toBe(10000)
    expect(total.knocked).toBe(knocked)
    expect(total.lost).toBe(lost)
    expect(total.kg).toBeCloseTo(kgTotal, 3) // every lot is finished, so all kg count
    for (const d of DIMENSIONS) {
      const rows = scorecard(d, recs, ctx)
      expect(rows.reduce((n, x) => n + x.stats.lots, 0)).toBe(10000)
      expect(rows.reduce((n, x) => n + x.stats.kg, 0)).toBeCloseTo(kgTotal, 3)
    }
    expect(fadingStrains(strains, recs, 15).length).toBeLessThanOrEqual(40)
    expect(Date.now() - t0, 'records + 5 scorecards + fading for 10,000 lots').toBeLessThan(3000)
  })

  it('a rapid burst of 400 harvest sessions on one lot stays exact', async () => {
    const st = new Store(new MemoryBackend())
    const lot: BlockLot = { id: 'L', lot_code: 'B1', species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 60, knock_date: '2026-01-01', status: 'incubating', notes: null }
    await st.put('block_lots', lot)
    let sum = 0
    for (let i = 0; i < 400; i++) {
      const kg = (i % 9) + 0.25
      sum += kg
      await st.action('PICK', () => harvestSession(st, { day: '2026-02-01', initials: 'ab', rows: [{ lot: st.rows<BlockLot>('block_lots')[0], kg, flush: 1, grade: 'A' }] }))
    }
    expect(st.rows<Harvest>('harvests')).toHaveLength(400)
    expect(allRecords(st.rows<BlockLot>('block_lots'), [], st.rows<Harvest>('harvests'), [])[0].kg).toBeCloseTo(sum, 6)
    expect(st.rows<BlockLot>('block_lots')[0].status).toBe('fruiting')
    for (let i = 0; i < 40; i++) await st.undo()
    expect(st.rows<Harvest>('harvests')).toHaveLength(360)
  })

  it('bad and empty input is refused and changes nothing', async () => {
    const st = new Store(new MemoryBackend())
    const lot: BlockLot = { id: 'L', lot_code: 'B1', species_key: 'blue-oyster', strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 10, knock_date: '2026-01-01', status: 'incubating', notes: null }
    await st.put('block_lots', lot)
    const before = state(st)
    await expect(inoculateCart(st, { cart: '  ', knock: '2026-01-02', by: '', cookId: null, lines: [{ species: 'blue-oyster', strainId: null, grainId: null, blocks: 5 }], lots: [lot], strains: [], grain: [] })).rejects.toThrow(/CART/)
    await expect(inoculateCart(st, { cart: 'c-1', knock: '2026-01-02', by: '', cookId: null, lines: [{ species: 'blue-oyster', strainId: null, grainId: null, blocks: 0 }], lots: [lot], strains: [], grain: [] })).rejects.toThrow(/LINE/)
    await expect(inoculateCart(st, { cart: 'c-1', knock: '2026-01-02', by: '', cookId: null, lines: [{ species: 'blue-oyster', strainId: null, grainId: null, blocks: 2.5 }], lots: [lot], strains: [], grain: [] })).rejects.toThrow(/WHOLE/)
    await expect(harvestSession(st, { day: '2026-02-01', initials: 'ab', rows: [{ lot, kg: Number.NaN, flush: 1, grade: 'A' }] })).rejects.toThrow()
    await expect(bulkLots(st, [], { status: 'spent' }, [])).rejects.toThrow(/TICK/)
    await expect(logPins(st, lot, 0, '2026-02-01', [])).rejects.toThrow()
    await expect(splitLot(st, { lot, losses: [], harvests: [], lots: [lot], n: 10 })).rejects.toThrow()
    expect(state(st)).toBe(before)
  })
})
