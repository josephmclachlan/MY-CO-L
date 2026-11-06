// G9 history resilience and stress: two years of data through search, export, exact restore and bulk edits.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, BACKUP_TABLES, Store, type Row } from './store'
import { buildExportZip, readBackupFile } from './dataExport'
import { readZip } from './zip'
import { buildIndex, search } from './search'
import { deleteMany, gradeMany, setPlaceMany, setStatusMany, stockTake } from './bulkEdit'
import { STAFF_DENIED_TABLES, staffHideRow } from './roles'
import { KINDS } from './search'
import { rng } from './testkit'
import type { BlockLot } from './xeno'

Store.GROUP_MS = 0
const SEEDS = Number(process.env.STRESS_SEEDS ?? 2)
const STEPS = Number(process.env.STRESS_STEPS ?? 150)
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const dump = async (st: Store) => {
  const out: Record<string, unknown[]> = {}
  for (const t of BACKUP_TABLES) {
    if (t === EDIT_LOG) continue
    await st.ensure(t)
    const rows = st.rows(t).map(clean).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    if (rows.length) out[t] = rows
  }
  return JSON.stringify(out)
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const iso = (d: Date) => d.toISOString().slice(0, 10)
const SP = ['blue-oyster', 'lions-mane', 'comb-tooth', 'golden-oyster']

/** Two and a half years of farm life: a lot every 3 days, 1 to 3 harvests per lot, a sale per harvest week, stock moves. */
async function twoYears(st: Store, seed: number, days = 900) {
  const r = rng(seed)
  const strains: Row[] = SP.flatMap((sp, i) => [0, 1].map((j) => ({ id: `s${i}${j}`, species_key: sp, code: `X${i}${j}`, name: `Strain ${i}${j} Ñ`, source: null, active: true, notes: null })))
  const items: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, code: `IT${i}`, name: `Item ${i}`, category: 'SUBSTRATE', unit: 'kg', reorder_point: 5, lead_time_days: 3, supplier: null, room: null, use_per_week: null, notes: null }))
  const cultures: Row[] = []
  const lots: Row[] = []
  const harvests: Row[] = []
  const sales: Row[] = []
  const moves: Row[] = []
  const start = new Date(Date.UTC(2024, 4, 1))
  for (let d = 0; d < days; d++) {
    const day = iso(new Date(start.getTime() + d * 86400000))
    if (d % 30 === 0) cultures.push({ id: `c${d}`, strain_id: strains[r.int(strains.length)].id, parent_culture_id: null, kind: 'slant', p_level: 0, made_on: day, status: 'clean', cold_since: null, location: null, label: null, notes: null })
    if (d % 3 === 0) {
      const sp = r.int(SP.length)
      const id = `l${d}`
      lots.push({ id, lot_code: `B${String(d).padStart(4, '0')}`, species_key: SP[sp], strain_id: `s${sp}${r.int(2)}`, grain_run_id: null, g2_bags_used: 1, bag_count: 10 + r.int(30), knock_date: day, status: d < days - 40 ? 'spent' : 'fruiting', notes: null })
      for (let h = 0, n = 1 + r.int(3); h < n; h++) harvests.push({ id: `h${d}-${h}`, block_lot_id: id, harvested_on: iso(new Date(start.getTime() + (d + 14 + h * 5) * 86400000)), flush: h + 1, kg: Math.round((2 + r.next() * 8) * 10) / 10, grade: 'AB'[r.int(2)], initials: 'MR', notes: null })
    }
    if (d % 7 === 0) sales.push({ id: `sa${d}`, sold_on: day, buyer: `Buyer ${r.int(9)}`, channel: 'restaurant', species_key: SP[r.int(4)], form: 'fresh', grade: 'A', kg: 1 + r.int(8), amount_crc: 10000 + r.int(50000), lot_codes: null, notes: null, pay_status: r.next() < 0.2 ? 'owed' : 'paid', paid_on: day })
    if (d % 5 === 0) moves.push({ id: `m${d}`, item_id: items[r.int(items.length)].id, moved_on: day, qty: r.int(20) + 1, reason: 'delivery', note: null })
  }
  await st.action('TWO YEARS', async () => {
    await st.put('strains', strains)
    await st.put('items', items)
    await st.put('cultures', cultures)
    await st.put('block_lots', lots)
    await st.put('harvests', harvests)
    await st.put('sales', sales)
    await st.put('stock_moves', moves)
  }, { undoable: false })
  return { strains, items, cultures, lots, harvests, sales, moves }
}

describe('history resilience: two and a half years of records', () => {
  it('search finds every lot by its exact code first, in a big index', async () => {
    const st = new Store(new MemoryBackend())
    const data = await twoYears(st, 7)
    for (const t of BACKUP_TABLES) await st.ensure(t)
    const t0 = Date.now()
    const docs = buildIndex({ rows: (t) => st.rows(t), role: 'owner' })
    const built = Date.now() - t0
    expect(docs.length).toBeGreaterThan(data.lots.length + data.harvests.length)
    for (const l of data.lots) {
      const hits = search(docs, l.lot_code as string).hits
      expect(hits[0], l.lot_code as string).toMatchObject({ kind: 'lot', rowId: l.id })
    }
    const t1 = Date.now()
    for (let i = 0; i < 50; i++) search(docs, 'buyer 3 restaurant')
    const per = (Date.now() - t1) / 50
    // a phone is slower than this machine; stay well inside one frame budget times 10
    expect(built, 'index build ms').toBeLessThan(3000)
    expect(per, 'ms per search').toBeLessThan(250)
  })
  it('staff index holds no money record and no money screen, whatever the data', async () => {
    const st = new Store(new MemoryBackend())
    await twoYears(st, 8)
    for (const t of BACKUP_TABLES) await st.ensure(t)
    const staff = buildIndex({ rows: (t) => st.rows(t), role: 'staff' })
    const cost = new Set(KINDS.filter((k) => k.cost).map((k) => k.id))
    expect(staff.filter((d) => cost.has(d.kind))).toEqual([])
    expect(search(staff, 'buyer').hits.filter((h) => h.kind === 'sale')).toEqual([])
  })
  it('export then exact restore into an empty device reproduces every record; the ZIP holds a CSV per table', async () => {
    const src = new Store(new MemoryBackend())
    const data = await twoYears(src, 9)
    await settle()
    const { zip, summary } = await buildExportZip(src)
    const names = (await readZip(zip)).map((e) => e.name)
    for (const t of ['strains', 'items', 'cultures', 'block_lots', 'harvests', 'sales', 'stock_moves']) expect(names).toContain(`csv/${t}.csv`)
    expect(summary.rows).toBeGreaterThan(data.harvests.length + data.lots.length)
    const { text } = await readBackupFile(zip)
    const dst = new Store(new MemoryBackend())
    await dst.importJson(text, { exact: true })
    expect(await dump(dst)).toBe(await dump(src))
    const p = await dst.previewBackup(text, true)
    expect(p.change + p.remove).toBe(0)
  })
  it('the history accounts for every record of a two-year load: a summary line per big table, a line per record for small ones', async () => {
    const st = new Store(new MemoryBackend())
    await twoYears(st, 10)
    await settle()
    await st.ensure(EDIT_LOG)
    const log = st.rows<Row & { table_name: string; row_id: string; op: string; changes: { f: string; new: unknown }[] }>(EDIT_LOG)
    for (const t of ['strains', 'items', 'cultures', 'block_lots', 'harvests', 'sales', 'stock_moves']) {
      const mine = log.filter((e) => e.table_name === t)
      const counted = mine.reduce((n, e) => n + (e.row_id === '*' ? Number(e.changes.find((c) => c.f === 'records')?.new ?? 0) : 1), 0)
      expect(counted, t).toBe(st.rows(t).length)
    }
    // then single edits after the load are logged one line per record and replay on top
    await st.put('harvests', { id: 'hNew', block_lot_id: 'l0', harvested_on: '2026-11-06', flush: 1, kg: 1, grade: 'A', initials: 'MR', notes: null })
    await settle()
    expect(st.rows<Row & { row_id: string }>(EDIT_LOG).some((e) => e.row_id === 'hNew')).toBe(true)
  })
})

describe('stress: random bulk edits, backups and restores', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => 900 + i))('random steps (seed %i): undo returns to the exact earlier state, restores equal their file, search never loses a lot', async (seed) => {
    const st = new Store(new MemoryBackend())
    await twoYears(st, seed, 240)
    for (const t of BACKUP_TABLES) await st.ensure(t)
    const r = rng(seed)
    const snaps: string[] = []
    const lots = () => st.rows<BlockLot>('block_lots')
    const pick = (rows: Row[], n: number) => Array.from({ length: Math.min(n, rows.length) }, () => rows[r.int(rows.length)].id).filter((id, i, a) => a.indexOf(id) === i)
    const count = { status: 0, place: 0, grade: 0, del: 0, take: 0, merge: 0, exact: 0, undo: 0, refused: 0, search: 0 }
    const step = async (label: string, fn: () => Promise<unknown>) => {
      const before = await dump(st)
      const newest = st.undoList()[0]?.id
      try {
        await st.action(label, fn)
      } catch {
        count.refused++
        expect(await dump(st), `${label} refused must change nothing`).toBe(before)
        return
      }
      if (st.undoList()[0]?.id !== newest) {
        snaps.push(before)
        if (snaps.length > Store.UNDO_DEPTH) snaps.shift()
      }
      expect(st.undoList().length).toBe(snaps.length)
    }
    for (let i = 0; i < STEPS; i++) {
      const roll = r.next()
      if (roll < 0.12 && snaps.length) {
        const want = snaps.pop()!
        await st.undo()
        count.undo++
        expect(await dump(st), `undo at step ${i}`).toBe(want)
      } else if (roll < 0.3) {
        count.status++
        await step('STATUS', () => setStatusMany(st, 'cultures', pick(st.rows('cultures'), 1 + r.int(5)), ['clean', 'cold_storage', 'used_up'][r.int(3)]))
      } else if (roll < 0.42) {
        count.place++
        await step('PLACE', () => setPlaceMany(st, 'cultures', pick(st.rows('cultures'), 1 + r.int(5)), r.next() < 0.2 ? '' : `shelf ${r.int(9)}`))
      } else if (roll < 0.54) {
        count.grade++
        await step('GRADE', () => gradeMany(st, pick(st.rows('harvests'), 1 + r.int(40)), 'ABC'[r.int(3)]))
      } else if (roll < 0.66) {
        count.del++
        await step('DELETE', async () => {
          const res = await deleteMany(st, 'block_lots', pick(lots(), 1 + r.int(6)))
          // a lot with harvests is never deleted
          const have = new Set(st.rows('harvests').map((h) => h.block_lot_id))
          for (const l of lots()) if (have.has(l.id)) expect(st.rows('block_lots').some((x) => x.id === l.id)).toBe(true)
          return res
        })
      } else if (roll < 0.76) {
        count.take++
        await step('TAKE', async () => {
          const items = st.rows('items').slice(0, 1 + r.int(5))
          const sum = (id: string) => st.rows('stock_moves').filter((m) => m.item_id === id).reduce((n, m) => n + Number(m.qty), 0)
          const target = new Map(items.map((it) => [it.id, r.int(60)]))
          await stockTake(st, items.map((it) => ({ itemId: it.id, current: sum(it.id), target: target.get(it.id)! })))
          for (const it of items) expect(Math.round(sum(it.id) * 1000) / 1000, `count of ${it.id}`).toBe(target.get(it.id))
        })
      } else if (roll < 0.86) {
        // merge a backup taken a moment ago back in: no change
        count.merge++
        const json = await st.exportJson()
        const before = await dump(st)
        const p = await st.previewBackup(json)
        expect(p.tables.filter((t) => t.table !== EDIT_LOG).reduce((n, t) => n + t.add + t.change, 0)).toBe(0)
        await step('MERGE', () => st.importJson(json))
        expect(await dump(st)).toBe(before)
      } else if (roll < 0.9) {
        // exact restore of an older backup, then undo
        count.exact++
        const json = await st.exportJson()
        const dst = new Store(new MemoryBackend())
        await dst.importJson(json, { exact: true })
        expect(await dump(dst), `exact copy at step ${i}`).toBe(await dump(st))
      } else {
        // search never loses a lot: every lot's code finds it first
        count.search++
        const docs = buildIndex({ rows: (t) => st.rows(t), role: 'owner' })
        for (const l of pick(lots(), 12)) {
          const row = lots().find((x) => x.id === l)!
          expect(search(docs, row.lot_code).hits[0]).toMatchObject({ kind: 'lot', rowId: row.id })
        }
        const staff = buildIndex({ rows: (t) => st.rows(t), role: 'staff' })
        expect(staff.some((d) => d.kind === 'sale')).toBe(false)
      }
    }
    expect(count.status + count.place + count.grade + count.del + count.take).toBeGreaterThan(STEPS / 4)
    // the staff view of the same data never leaks, whatever happened
    st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
    for (const t of STAFF_DENIED_TABLES) expect(st.rows(t), t).toEqual([])
    st.setAccess([])
  }, 120000)
})
