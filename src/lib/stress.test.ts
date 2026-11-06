// Mock trials and stress tests for G2 (offline saving, undo, edit history).
// Joseph's rule (6 Nov 2026): mock trials of each function, data logging, historical resilience,
// outputs checked against expected data, and stress tests.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import { SyncBackend } from './sync'
import type { EditEntry } from './history'
import { FakeDb, MemCache, rng } from './testkit'

Store.GROUP_MS = 0
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const tableState = (st: Store, t: string) => Object.fromEntries(st.rows(t).map((r) => [r.id, clean(r)]))
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Rebuild every record from the edit history alone. If logging is complete, this equals the live data. */
async function replay(st: Store): Promise<Record<string, Record<string, Row>>> {
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
  for (const t of Object.keys(out)) for (const id of Object.keys(out[t])) out[t][id] = clean(out[t][id]) as Row
  return out
}
async function expectLogMatches(st: Store, tables: string[]) {
  const rebuilt = await replay(st)
  for (const t of tables) expect(rebuilt[t] ?? {}, `history replay of ${t}`).toEqual(tableState(st, t))
}

describe('mock trial: one farm week in local mode', () => {
  it('logs every step, undoes, restores, and survives export + import with the same numbers', async () => {
    const st = new Store(new MemoryBackend())
    st.who = 'JOSEPH'
    // Monday: strain and a lot (one action each)
    st.screen = 'XENOGENETICS'
    await st.action('STRAIN BO-01 REGISTERED', () => st.put('strains', { id: 'bo', code: 'BO-01', species_key: 'blue-oyster', active: true }))
    await st.action('LOT B1103 LOGGED', async () => {
      await st.put('grain_runs', { id: 'g2', strain_id: 'bo', generation: 'G2', bag_count: 7, status: 'ready' })
      await st.put('block_lots', { id: 'lot', lot_code: 'B1103', strain_id: 'bo', grain_run_id: 'g2', bag_count: 60, status: 'incubating', knock_date: '2026-11-03' })
    })
    // A day's exchange rate fetched by the app (must never be undone with the user's edits)
    await st.put('fx_rates', { id: '2026-11-05', day: '2026-11-05', crc_per_usd: 505.3, source: 'AUTO' }, { label: 'EXCHANGE RATE FETCHED' })
    // Wednesday: harvests (MISSION) and a sale (TRADE)
    st.screen = 'MISSION CONTROL'
    await st.action('HARVEST LOGGED', async () => {
      await st.put('block_lots', { id: 'lot', status: 'fruiting', to_fruiting_on: '2026-11-04' })
      await st.put('harvests', { id: 'h1', block_lot_id: 'lot', harvested_on: '2026-11-05', flush: 1, kg: 12.4 })
    })
    await st.put('harvests', { id: 'h2', block_lot_id: 'lot', harvested_on: '2026-11-05', flush: 1, kg: 3.1 })
    st.screen = 'TRADE'
    await st.put('sales', { id: 's1', sold_on: '2026-11-05', kg: 10, amount_crc: 115000, channel: 'market' })
    // a wrong kg typed then fixed with UNDO
    await st.put('harvests', { id: 'h2', kg: 31 })
    expect(await st.undo()).toBe('CHANGED HARVEST')
    // a harvest deleted by mistake, brought back from the history
    await st.del('harvests', 'h1')
    await settle()
    await st.ensure(EDIT_LOG)
    const delEntry = st.rows<EditEntry>(EDIT_LOG).filter((e) => e.op === 'delete' && e.row_id === 'h1').at(-1)!
    expect(await st.restore(delEntry)).toBe('RECORD RESTORED')

    // Expected outputs, worked by hand
    const kg = st.rows<Row>('harvests').reduce((n, h) => n + Number(h.kg), 0)
    expect(Math.round(kg * 10) / 10).toBe(15.5) // 12.4 + 3.1
    expect(st.rows('sales')[0].amount_crc).toBe(115000)
    expect(st.rows('block_lots')[0]).toMatchObject({ status: 'fruiting', to_fruiting_on: '2026-11-04' })
    expect(st.rows('fx_rates')[0].crc_per_usd).toBe(505.3)

    // Data logging: every record can be rebuilt from its history
    await expectLogMatches(st, ['strains', 'grain_runs', 'block_lots', 'harvests', 'sales', 'fx_rates'])
    const log = st.rows<EditEntry>(EDIT_LOG)
    expect(log.filter((e) => e.via === 'undo')).toHaveLength(1)
    expect(log.filter((e) => e.via === 'restore')).toHaveLength(1)
    expect(log.find((e) => e.table_name === 'fx_rates')!.who).toBe('APP')
    expect(log.filter((e) => e.table_name !== 'fx_rates').every((e) => e.who === 'JOSEPH')).toBe(true)
    expect(log.find((e) => e.table_name === 'sales')!.screen).toBe('TRADE')

    // Historical resilience: export, import into a fresh device, same data and same history
    const text = await st.exportJson()
    const st2 = new Store(new MemoryBackend())
    await st2.importJson(text)
    for (const t of ['strains', 'grain_runs', 'block_lots', 'harvests', 'sales', 'fx_rates']) expect(tableState(st2, t)).toEqual(tableState(st, t))
    await st2.ensure(EDIT_LOG)
    const ids = new Set(st2.rows(EDIT_LOG).map((r) => r.id))
    expect(log.every((e) => ids.has(e.id))).toBe(true) // every old line came across untouched
    // importing the same file twice changes nothing and duplicates no history
    const before = st2.rows(EDIT_LOG).length
    await st2.importJson(text)
    expect(tableState(st2, 'harvests')).toEqual(tableState(st, 'harvests'))
    expect(st2.rows(EDIT_LOG).filter((e) => ids.has(e.id))).toHaveLength(ids.size)
    expect(st2.rows(EDIT_LOG).length).toBeGreaterThanOrEqual(before)
  })
})

const TABLES = ['harvests', 'sales', 'stock_moves', 'cultures'] as const
const FIELDS = ['kg', 'notes', 'status', 'qty', 'location']
const VALUES = [1, 2.5, 7, 'A', 'B', 'CLEAN', 'COLD', null, 'LAB FRIDGE', 0]

/** One random user step. Returns false when the step is not possible right now. */
async function randomStep(st: Store, r: ReturnType<typeof rng>, n: { id: number }) {
  const t = r.pick(TABLES)
  const have = st.rows(t)
  const roll = r.next()
  if (roll < 0.35 || !have.length) {
    const row: Row = { id: `${t}-${n.id++}` }
    for (const f of FIELDS) if (r.chance(0.5)) row[f] = r.pick(VALUES)
    await st.put(t, row)
  } else if (roll < 0.7) {
    const row = r.pick(have)
    const patch: Row = { id: row.id }
    for (let k = 0; k < 1 + r.int(3); k++) patch[r.pick(FIELDS)] = r.pick(VALUES)
    await st.put(t, patch)
  } else if (roll < 0.85) {
    await st.del(t, r.pick(have).id)
  } else {
    // a multi-record action across two tables
    await st.action('BULK', async () => {
      await st.put(t, { id: `${t}-${n.id++}`, kg: r.pick(VALUES) })
      const t2 = r.pick(TABLES)
      const h2 = st.rows(t2)
      if (h2.length) await st.put(t2, { id: r.pick(h2).id, notes: r.pick(VALUES) })
    })
  }
}

describe('stress: thousands of random edits, undos and restores (local mode)', () => {
  it.each([20261106, 1, 2])('3,000 random steps (seed %i): history always rebuilds the data exactly', async (seed) => {
    const st = new Store(new MemoryBackend())
    for (const t of TABLES) await st.ensure(t)
    const r = rng(seed)
    const n = { id: 0 }
    let undos = 0
    let restores = 0
    for (let i = 0; i < 3000; i++) {
      const roll = r.next()
      if (roll < 0.12) {
        if (await st.undo()) undos++
      } else if (roll < 0.17) {
        await st.ensure(EDIT_LOG)
        const log = st.rows<EditEntry>(EDIT_LOG)
        if (log.length) {
          try {
            await st.restore(r.pick(log))
            restores++
          } catch (e) {
            // the only allowed refusals are the plain-English ones
            expect(String(e)).toMatch(/ALREADY BACK|ALREADY GONE|WAS DELETED|NO COPY/)
          }
        }
      } else await randomStep(st, r, n)
      if (i % 500 === 499) await expectLogMatches(st, [...TABLES])
    }
    await expectLogMatches(st, [...TABLES])
    expect(undos).toBeGreaterThan(200)
    expect(restores).toBeGreaterThan(20)
  })

  it.each([7, 8, 9])('50 rounds (seed %i): any run of up to 40 changes undoes back to exactly where it started', async (seed) => {
    const st = new Store(new MemoryBackend())
    for (const t of TABLES) await st.ensure(t)
    const r = rng(seed)
    const n = { id: 0 }
    for (let round = 0; round < 50; round++) {
      const start = Object.fromEntries(TABLES.map((t) => [t, tableState(st, t)]))
      const k = 1 + r.int(40)
      const depth0 = st.undoList().length
      for (let i = 0; i < k; i++) await randomStep(st, r, n)
      const made = Math.min(st.undoList().length - depth0 + Math.max(0, depth0 + k - Store.UNDO_DEPTH), k)
      for (let i = 0; i < made; i++) await st.undo()
      const end = Object.fromEntries(TABLES.map((t) => [t, tableState(st, t)]))
      if (depth0 + k <= Store.UNDO_DEPTH) expect(end, `round ${round}`).toEqual(start)
    }
  })

  it('10,000 records in one action: logged as a summary, undone in one step, quickly', async () => {
    const st = new Store(new MemoryBackend())
    const t0 = Date.now()
    await st.action('BIG IMPORT', () => st.put('stock_moves', Array.from({ length: 10000 }, (_, i) => ({ id: `m${i}`, qty: i % 7, item_id: 'rye' }))))
    expect(st.rows('stock_moves')).toHaveLength(10000)
    await st.undo()
    expect(st.rows('stock_moves')).toHaveLength(0)
    expect(Date.now() - t0).toBeLessThan(3000)
    await settle()
    await st.ensure(EDIT_LOG)
    const log = st.rows<EditEntry>(EDIT_LOG)
    expect(log.filter((e) => e.row_id === '*')).toHaveLength(2) // one for the import, one for its undo
  })
})

/** A device: its own browser cache and queue, talking to the shared database. */
function device(db: FakeDb, cache = new MemCache(), up: () => boolean = () => db.up) {
  const b = new SyncBackend(db, cache, up)
  return { b, st: new Store(b), cache }
}
const dbState = async (db: FakeDb, t: string) => {
  const was = db.up
  db.up = true
  const rows = await db.load(t)
  db.up = was
  return Object.fromEntries(rows.map((r) => [r.id, clean(r)]))
}

describe('stress: offline queue with signal cuts, restarts and two devices', () => {
  it.each(Array.from({ length: Number(process.env.STRESS_SEEDS ?? 3) }, (_, i) => 42 + i))('one device, 1,500 steps with random signal cuts and restarts (seed %i): the database ends equal to the device', async (seed) => {
    const db = new FakeDb()
    let d = device(db)
    const r = rng(seed)
    const n = { id: 0 }
    for (const t of TABLES) await d.st.ensure(t)
    for (let i = 0; i < 1500; i++) {
      if (r.chance(0.05)) db.up = !db.up
      if (r.chance(0.02)) db.dropAfter = r.int(4) // signal lost in the middle of a sync
      if (r.chance(0.01)) {
        // app closed and opened again: queue must come back from the browser copy
        await d.b.flush()
        d.b.stop()
        d = device(db, d.cache)
        for (const t of TABLES) await d.st.ensure(t)
      }
      if (r.chance(0.1)) await d.st.undo()
      else await randomStep(d.st, r, n)
      if (r.chance(0.1)) await d.b.flush()
    }
    db.up = true
    db.dropAfter = null
    await d.b.flush()
    expect(d.b.info().waiting).toBe(0)
    expect(d.b.conflictList().filter((c) => c.kind === 'refused')).toHaveLength(0)
    for (const t of TABLES) expect(await dbState(db, t), t).toEqual(tableState(d.st, t))
    // a fresh device that opens the app sees the same thing
    const fresh = device(db)
    for (const t of TABLES) {
      await fresh.st.ensure(t)
      expect(tableState(fresh.st, t)).toEqual(tableState(d.st, t))
    }
    expect(db.calls).toBeGreaterThan(500)
  })

  it.each(Array.from({ length: Number(process.env.STRESS_SEEDS ?? 3) }, (_, i) => 99 + i))('two devices editing the same records offline (seed %i): both converge to the database, nothing silently lost', async (seed) => {
    const db = new FakeDb()
    const upA = { v: true }
    const upB = { v: true }
    const A = device(db, new MemCache(), () => upA.v && db.up)
    const B = device(db, new MemCache(), () => upB.v && db.up)
    const r = rng(seed)
    const n = { id: 0 }
    const deleted = new Set<string>()
    const created = new Set<string>()
    for (let i = 0; i < 1200; i++) {
      if (r.chance(0.06)) upA.v = !upA.v
      if (r.chance(0.06)) upB.v = !upB.v
      const D = r.chance(0.5) ? A : B
      // see the other device's work now and then (like reopening a screen)
      if (r.chance(0.05)) for (const t of TABLES) await D.st.refresh(t)
      for (const t of TABLES) await D.st.ensure(t)
      const t = r.pick(TABLES)
      const have = D.st.rows(t)
      if (r.chance(0.4) || !have.length) {
        const id = `${t}-${n.id++}`
        created.add(id)
        await D.st.put(t, { id, kg: r.pick(VALUES), notes: r.pick(VALUES) })
      } else if (r.chance(0.85)) {
        await D.st.put(t, { id: r.pick(have).id, [r.pick(FIELDS)]: r.pick(VALUES) })
      } else {
        const id = r.pick(have).id
        deleted.add(id)
        await D.st.del(t, id)
      }
      if (r.chance(0.2)) await D.b.flush()
    }
    upA.v = upB.v = true
    await A.b.flush()
    await B.b.flush()
    await A.b.flush() // A again, in case B's merges changed what A should see
    expect(A.b.info().waiting + B.b.info().waiting).toBe(0)
    for (const t of TABLES) {
      await A.st.refresh(t)
      await B.st.refresh(t)
      const want = await dbState(db, t)
      expect(tableState(A.st, t), `A ${t}`).toEqual(want)
      expect(tableState(B.st, t), `B ${t}`).toEqual(want)
      // nothing created and never deleted by anyone went missing
      for (const id of created) if (id.startsWith(t) && !deleted.has(id)) expect(want[id], `${id} lost`).toBeDefined()
    }
    // every conflict listed is complete and says what was kept
    const conflicts = [...A.b.conflictList(), ...B.b.conflictList()]
    expect(conflicts.length).toBeGreaterThan(0)
    for (const c of conflicts) {
      expect(c.kind).not.toBe('refused')
      expect(['mine', 'theirs']).toContain(c.kept)
      expect(c.note.length).toBeGreaterThan(10)
      if (c.kind === 'both-changed') expect(c.field).toBeTruthy()
    }
  })
})

describe('stress: checked after every step', () => {
  it.each(Array.from({ length: Number(process.env.STRESS_SEEDS ?? 10) }, (_, i) => 1000 + i))(
    'seed %i: whenever the queue is empty and there is signal, the database equals the device',
    async (seed) => {
      const db = new FakeDb()
      let d = device(db)
      const r = rng(seed)
      const n = { id: 0 }
      for (const t of TABLES) await d.st.ensure(t)
      let checks = 0
      for (let i = 0; i < 1500; i++) {
        if (r.chance(0.05)) db.up = !db.up
        if (r.chance(0.02)) db.dropAfter = r.int(4)
        if (r.chance(0.01)) {
          await d.b.flush()
          d.b.stop()
          d = device(db, d.cache)
          for (const t of TABLES) await d.st.ensure(t)
        }
        if (r.chance(0.1)) await d.st.undo()
        else await randomStep(d.st, r, n)
        if (db.up && db.dropAfter === null) {
          await d.b.flush()
          if (!d.b.info().waiting) {
            checks++
            for (const t of TABLES) expect(await dbState(db, t), `step ${i} ${t}`).toEqual(tableState(d.st, t))
          }
        }
      }
      expect(checks).toBeGreaterThan(100)
    },
  )
})
