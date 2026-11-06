// G9 mock trials: export and restore, search, bulk edits, staff access, device PIN lock, glove pad keys.
// Joseph's test rules: mock trials of each function, data logging, outputs checked against expected values.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, BACKUP_TABLES, type Row } from './store'
import type { EditEntry } from './history'
import { backupAgeDays, backupNag, BACKUP_STALE_DAYS, buildExportZip, EXPORT_TABLES, readBackupFile, stamp, tableCsv } from './dataExport'
import { bytesOf, makeZip, readZip } from './zip'
import { parseCsv } from './csv'
import { buildIndex, countByKind, KINDS, norm, search, type Doc, type Kind } from './search'
import { deleteMany, gradeMany, salesMany, setPlaceMany, setStatusMany, stockTake } from './bulkEdit'
import {
  canOpenModule, canSeeMoney, loadLock, lockToStaff, OWNER_ONLY_MODULES, PIN_TRIES, PIN_WAIT_MS, roleFromUser, saveLock, setOwnerPin,
  STAFF_DENIED_TABLES, STAFF_HIDDEN_SETTINGS, STAFF_MODULES, staffHideRow, unlockWithPin, validPin, type KV,
} from './roles'
import { padKey } from './padKey'
import { MODULES } from '../data/farm'
import { rng } from './testkit'

Store.GROUP_MS = 0
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
/** Every backed-up table except the history, as plain comparable data. */
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
/** A restore preview's totals without the history table. */
const data = (p: { tables: { table: string; add: number; change: number; same: number; remove: number }[] }) => {
  const t = p.tables.filter((x) => x.table !== EDIT_LOG)
  const sum = (k: 'add' | 'change' | 'same' | 'remove') => t.reduce((n, x) => n + x[k], 0)
  return { add: sum('add'), change: sum('change'), same: sum('same'), remove: sum('remove') }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

/** A small, coherent farm. */
async function seed(st: Store) {
  await st.action('SEED', async () => {
    await st.put('strains', [
      { id: 'st1', species_key: 'blue-oyster', code: 'BO-01', name: 'Cap n Stem blue', source: 'Cap n Stem', active: true, notes: null },
      { id: 'st2', species_key: 'lions-mane', code: 'LM-01', name: 'Ñandú lion', source: null, active: true, notes: null },
    ])
    await st.put('cultures', [
      { id: 'c1', strain_id: 'st1', parent_culture_id: null, kind: 'plate', p_level: 0, made_on: '2026-09-01', status: 'clean', cold_since: null, location: null, label: null, notes: null },
      { id: 'c2', strain_id: 'st1', parent_culture_id: 'c1', kind: 'slant', p_level: 1, made_on: '2026-09-10', status: 'clean', cold_since: null, location: 'FRIDGE 1', label: null, notes: null },
      { id: 'c3', strain_id: 'st2', parent_culture_id: null, kind: 'slant', p_level: 0, made_on: '2026-09-12', status: 'clean', cold_since: null, location: null, label: null, notes: null },
    ])
    await st.put('grain_runs', [
      { id: 'g1', generation: 'G1', strain_id: 'st1', parent_culture_id: 'c2', parent_grain_run_id: null, parent_bags_used: null, bag_count: 4, bags_lost: 0, inoculated_on: '2026-10-01', status: 'ready', cold_since: null, location: null, label: null, result: null, notes: null },
      { id: 'g2', generation: 'G1', strain_id: 'st2', parent_culture_id: 'c3', parent_grain_run_id: null, parent_bags_used: null, bag_count: 2, bags_lost: 0, inoculated_on: '2026-10-02', status: 'ready', cold_since: null, location: null, label: null, result: null, notes: null },
    ])
    await st.put('block_lots', [
      { id: 'l1', lot_code: 'B1020', species_key: 'blue-oyster', strain_id: 'st1', grain_run_id: 'g1', g2_bags_used: 1, bag_count: 20, knock_date: '2026-10-20', status: 'fruiting', notes: null },
      { id: 'l2', lot_code: 'B1025', species_key: 'blue-oyster', strain_id: 'st1', grain_run_id: 'g1', g2_bags_used: 1, bag_count: 20, knock_date: '2026-10-25', status: 'incubating', notes: null },
      { id: 'l3', lot_code: 'L1030', species_key: 'lions-mane', strain_id: 'st2', grain_run_id: 'g2', g2_bags_used: 1, bag_count: 10, knock_date: '2026-10-30', status: 'incubating', notes: null },
    ])
    await st.put('harvests', [
      { id: 'h1', block_lot_id: 'l1', harvested_on: '2026-11-01', flush: 1, kg: 6.5, grade: 'A', initials: 'MR', notes: null },
      { id: 'h2', block_lot_id: 'l1', harvested_on: '2026-11-03', flush: 1, kg: 3, grade: 'B', initials: 'MR', notes: null },
    ])
    await st.put('items', [
      { id: 'i1', code: 'SAWDUST', name: 'Sawdust', category: 'SUBSTRATE', unit: 'bag', reorder_point: 5, lead_time_days: 3, supplier: 'Aserradero', room: null, use_per_week: null, notes: null },
      { id: 'i2', code: 'BAGS', name: 'Grow bags', category: 'PACKAGING', unit: 'pc', reorder_point: 100, lead_time_days: 10, supplier: null, room: null, use_per_week: null, notes: null },
    ])
    await st.put('stock_moves', [
      { id: 'm1', item_id: 'i1', moved_on: '2026-11-01', qty: 10, reason: 'delivery', note: null },
      { id: 'm2', item_id: 'i2', moved_on: '2026-11-01', qty: 200, reason: 'delivery', note: null },
    ])
    await st.put('sales', [
      { id: 's1', sold_on: '2026-11-02', buyer: 'Casa Luna', channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', grade: 'A', kg: 4, amount_crc: 46000, lot_codes: ['B1020'], notes: null, pay_status: 'owed', paid_on: null },
      { id: 's2', sold_on: '2026-11-03', buyer: 'Ana', channel: 'market', species_key: 'blue-oyster', form: 'fresh', grade: 'A', kg: 1, amount_crc: 11500, lot_codes: null, notes: null, pay_status: 'owed', paid_on: null },
    ])
    await st.put('app_settings', [
      { id: 'rates', value: { fx: 520, secret: 'prices' } },
      { id: 'money', value: { plan: 1 } },
      { id: 'practice', value: { slant_months: 6 } },
    ])
  }, { undoable: false })
}

const fresh = async () => {
  const st = new Store(new MemoryBackend())
  await seed(st)
  return st
}
const docsFor = (st: Store, role: 'owner' | 'staff') => buildIndex({ rows: (t) => st.rows(t), role })
const loadAll = async (st: Store) => {
  for (const t of BACKUP_TABLES) await st.ensure(t)
}

describe('export', () => {
  it('writes a ZIP with backup.json, one CSV per table that has records, and a README', async () => {
    const st = await fresh()
    const { zip, summary } = await buildExportZip(st, new Date(Date.UTC(2026, 10, 6, 15, 0, 0)))
    const files = await readZip(zip)
    const names = files.map((f) => f.name)
    expect(names[0]).toBe('backup.json')
    expect(names).toContain('README.txt')
    for (const t of ['strains', 'cultures', 'grain_runs', 'block_lots', 'harvests', 'items', 'stock_moves', 'sales', 'app_settings']) expect(names, t).toContain(`csv/${t}.csv`)
    expect(names).not.toContain('csv/cook_runs.csv') // empty tables are left out
    // expected counts by hand: 2 strains, 3 cultures, 2 grain runs, 3 lots, 2 harvests, 2 items, 2 moves, 2 sales, 3 settings = 21 (the history is its own table)
    const by = Object.fromEntries(summary.byTable.map((b) => [b.table, b.rows]))
    expect(by).toMatchObject({ strains: 2, cultures: 3, grain_runs: 2, block_lots: 3, harvests: 2, items: 2, stock_moves: 2, sales: 2, app_settings: 3 })
    expect(summary.files).toBe(files.length)
    expect(summary.bytes).toBe(zip.length)
  })
  it('adds readable code and name columns where a table only holds long ids', async () => {
    const st = await fresh()
    const h = parseCsv((await tableCsv(st, 'harvests')).csv)
    expect(h[0]).toContain('lot_code')
    const row = h.find((r) => r[0] === 'h1')!
    expect(row[h[0].indexOf('lot_code')]).toBe('B1020')
    expect(row[h[0].indexOf('kg')]).toBe('6.5')
    const c = parseCsv((await tableCsv(st, 'cultures')).csv)
    expect(c.find((r) => r[0] === 'c3')![c[0].indexOf('strain_code')]).toBe('LM-01')
    const m = parseCsv((await tableCsv(st, 'stock_moves')).csv)
    expect(m.find((r) => r[0] === 'm1')![m[0].indexOf('item_name')]).toBe('Sawdust')
  })
  it('keeps Ñ, ₡-style text and JSON lists intact in the CSV', async () => {
    const st = await fresh()
    const s = parseCsv((await tableCsv(st, 'strains')).csv)
    expect(s.find((r) => r[0] === 'st2')![s[0].indexOf('name')]).toBe('Ñandú lion')
    const sa = parseCsv((await tableCsv(st, 'sales')).csv)
    expect(JSON.parse(sa.find((r) => r[0] === 's1')![sa[0].indexOf('lot_codes')])).toEqual(['B1020'])
  })
  it('the exported CSV row count equals the table row count for every table (data log check)', async () => {
    const st = await fresh()
    await loadAll(st)
    for (const t of EXPORT_TABLES) {
      const { csv, rows } = await tableCsv(st, t)
      expect(rows, t).toBe(st.rows(t).length)
      if (rows) expect(parseCsv(csv).length - 1, t).toBe(rows)
    }
  })
  it('stamp is yyyy-mm-dd', () => {
    expect(stamp(new Date(2026, 10, 6))).toBe('2026-11-06')
    expect(stamp(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
  it('backup age: never, today, a day, stale at 7 days', () => {
    const now = Date.UTC(2026, 10, 6, 12)
    const ago = (d: number) => new Date(now - d * 86400000 - 3600000)
    expect(backupNag(now, null)).toMatchObject({ warn: true, key: 'NO BACKUP MADE ON THIS DEVICE YET' })
    expect(backupNag(now, new Date(now - 3600000))).toMatchObject({ warn: false, text: 'BACKED UP TODAY' })
    expect(backupNag(now, ago(1))).toMatchObject({ warn: false, text: 'LAST BACKUP 1 DAY AGO' })
    expect(backupNag(now, ago(BACKUP_STALE_DAYS - 1))).toMatchObject({ warn: false })
    expect(backupNag(now, ago(BACKUP_STALE_DAYS))).toMatchObject({ warn: true, key: 'LAST BACKUP {d} DAYS AGO', vars: { d: BACKUP_STALE_DAYS } })
    expect(backupAgeDays(now, null)).toBeNull()
  })
})

describe('restore', () => {
  let src: Store
  let json: string
  beforeEach(async () => {
    src = await fresh()
    json = await src.exportJson()
  })

  it('a ZIP and a .json both open, and BOM text is accepted', async () => {
    const { zip } = await buildExportZip(src)
    expect((await readBackupFile(zip)).from).toBe('zip')
    expect(JSON.parse((await readBackupFile(zip)).text).tables).toEqual(JSON.parse(json).tables)
    expect((await readBackupFile(bytesOf(json))).from).toBe('json')
    expect((await readBackupFile(bytesOf('﻿' + json))).text).toBe(json)
    await expect(readBackupFile(makeZip([{ name: 'x.txt', data: 'nothing' }]))).rejects.toThrow(/NO backup.json/)
  })
  it('rejects files that are not backups, naming the reason, and writes nothing', async () => {
    const empty = new Store(new MemoryBackend())
    expect(() => empty.parseBackup('not json')).toThrow(/NOT JSON/)
    expect(() => empty.parseBackup('{"app":"OTHER","tables":{}}')).toThrow(/NOT A MY\/CO\/L BACKUP/)
    expect(() => empty.parseBackup('{"app":"MY/CO/L","format":99,"tables":{}}')).toThrow(/FORMAT 99/)
    const bad = JSON.stringify({ ...JSON.parse(json), tables: { nope: [] } })
    expect(() => empty.parseBackup(bad)).toThrow(/UNKNOWN TABLE/)
    const noId = JSON.stringify({ ...JSON.parse(json), tables: { strains: [{ code: 'X' }] } })
    expect(() => empty.parseBackup(noId)).toThrow(/BAD ROWS/)
    await expect(empty.importJson('garbage')).rejects.toThrow()
    expect((await dump(empty)) === '{}').toBe(true)
  })
  it('preview into an empty device: everything is added, nothing changes, nothing is written', async () => {
    const dst = new Store(new MemoryBackend())
    const p = await dst.previewBackup(json)
    // 21 data records (the 21 history lines of the seeding come along too and are counted under edit_log)
    expect(data(p)).toMatchObject({ add: 21, change: 0, same: 0, remove: 0 })
    expect(p.tables.find((t) => t.table === EDIT_LOG)!.add).toBeGreaterThan(0)
    expect(p.tables.find((t) => t.table === 'harvests')).toMatchObject({ add: 2 })
    expect(await dump(dst)).toBe('{}')
  })
  it('merge restore reproduces the data exactly and is one undo step', async () => {
    const dst = new Store(new MemoryBackend())
    const before = await dump(dst)
    const counts = await dst.importJson(json)
    expect(counts.harvests).toBe(2)
    expect(await dump(dst)).toBe(await dump(src))
    expect(dst.undoList().length).toBe(1)
    expect(dst.undoList()[0].label).toBe('IMPORT BACKUP')
    await dst.undo()
    expect(await dump(dst)).toBe(before)
  })
  it('restoring the same file twice changes nothing the second time (preview says all same)', async () => {
    const dst = new Store(new MemoryBackend())
    await dst.importJson(json)
    const p = await dst.previewBackup(json)
    expect(data(p)).toMatchObject({ add: 0, change: 0, remove: 0, same: 21 })
  })
  it('merge keeps records that are only on this device; exact removes them; undo brings them back', async () => {
    const dst = new Store(new MemoryBackend())
    await dst.importJson(json)
    await dst.action('LOCAL', async () => {
      await dst.put('harvests', { id: 'hx', block_lot_id: 'l2', harvested_on: '2026-11-05', flush: 1, kg: 9, grade: 'A', initials: 'JO', notes: null })
      await dst.put('strains', { id: 'st1', species_key: 'blue-oyster', code: 'BO-01', name: 'CHANGED HERE', source: 'Cap n Stem', active: true, notes: null })
    })
    const mine = await dump(dst)
    const pm = await dst.previewBackup(json)
    expect(data(pm)).toMatchObject({ add: 0, change: 1, remove: 0 })
    const pe = await dst.previewBackup(json, true)
    expect(data(pe)).toMatchObject({ change: 1, remove: 1 })
    // merge: the file wins on the changed record, the local-only harvest stays
    await dst.importJson(json)
    expect(dst.rows('harvests').map((r) => r.id).sort()).toEqual(['h1', 'h2', 'hx'])
    expect(dst.rows('strains').find((r) => r.id === 'st1')!.name).toBe('Cap n Stem blue')
    await dst.undo()
    expect(await dump(dst)).toBe(mine)
    // exact: the device ends up identical to the file
    await dst.importJson(json, { exact: true })
    expect(await dump(dst)).toBe(await dump(src))
    expect(dst.undoList()[0].label).toBe('RESTORE BACKUP (EXACT COPY)')
    await dst.undo()
    expect(await dump(dst)).toBe(mine)
  })
  it('exact restore never removes the edit history and removes children before parents', async () => {
    const dst = await fresh()
    await dst.action('MORE', async () => {
      await dst.put('strains', { id: 'st9', species_key: 'blue-oyster', code: 'BO-09', name: null, source: null, active: true, notes: null })
      await dst.put('cultures', { id: 'c9', strain_id: 'st9', parent_culture_id: null, kind: 'plate', p_level: 0, made_on: '2026-11-01', status: 'clean', cold_since: null, location: null, label: null, notes: null })
    })
    await settle()
    await dst.ensure(EDIT_LOG)
    const logBefore = dst.rows(EDIT_LOG).length
    expect(logBefore).toBeGreaterThan(0)
    await dst.importJson(json, { exact: true })
    expect(dst.rows('strains').map((r) => r.id).sort()).toEqual(['st1', 'st2'])
    expect(dst.rows('cultures').map((r) => r.id).sort()).toEqual(['c1', 'c2', 'c3'])
    await settle()
    expect(dst.rows(EDIT_LOG).length).toBeGreaterThanOrEqual(logBefore)
  })
  it('the history written during a restore says it was a restore, once', async () => {
    const dst = new Store(new MemoryBackend())
    await dst.importJson(json)
    await settle()
    await dst.ensure(EDIT_LOG)
    const log = dst.rows<EditEntry>(EDIT_LOG).filter((e) => e.label === 'IMPORT BACKUP')
    expect(log.length).toBe(21)
    expect(new Set(log.map((e) => e.action_id)).size).toBe(1)
    expect(new Set(log.map((e) => e.via))).toEqual(new Set(['import']))
  })
  it('staff views cannot export the denied tables or restore', async () => {
    const st = await fresh()
    st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
    const j = JSON.parse(await st.exportJson())
    expect(j.tables.sales).toBeUndefined()
    expect(j.tables.app_settings.map((r: Row) => r.id).sort()).toEqual(['practice'])
    expect(j.tables.harvests.length).toBe(2)
    await expect(st.importJson(json)).rejects.toThrow(/STAFF CANNOT/)
    await expect(st.importJson(json, { exact: true })).rejects.toThrow(/STAFF CANNOT/)
  })
})

describe('search', () => {
  let st: Store
  let owner: Doc[]
  let staff: Doc[]
  beforeEach(async () => {
    st = await fresh()
    await loadAll(st)
    owner = docsFor(st, 'owner')
    staff = docsFor(st, 'staff')
  })
  const top = (docs: Doc[], q: string, kinds?: Kind[]) => search(docs, q, { kinds: kinds ? new Set(kinds) : null }).hits

  it('norm drops case and accents', () => {
    expect(norm('  Ñandú, LION!! ')).toBe('nandu lion')
    expect(norm('Café-Müller')).toBe('cafe muller')
    expect(norm('')).toBe('')
  })
  it('an exact code comes first and opens the right place', () => {
    const h = top(owner, 'B1020')
    expect(h[0]).toMatchObject({ kind: 'lot', title: 'B1020', rowId: 'l1', go: { screen: 'XENO', node: 'b:l1' } })
    expect(top(owner, 'bo-01')[0]).toMatchObject({ kind: 'strain', title: 'BO-01' })
    expect(top(owner, 'lm 01')[0]).toMatchObject({ kind: 'strain', title: 'LM-01' })
  })
  it('every typed word must match, in any order, ignoring accents and capitals', () => {
    expect(top(owner, 'nandu').some((h) => h.rowId === 'st2')).toBe(true)
    expect(top(owner, 'ÑANDÚ lion').some((h) => h.rowId === 'st2')).toBe(true)
    expect(top(owner, 'lion nandu').some((h) => h.rowId === 'st2')).toBe(true)
    expect(top(owner, 'nandu zzzz')).toEqual([])
    expect(top(owner, '')).toEqual([])
    expect(top(owner, '   ')).toEqual([])
  })
  it('finds harvests by lot code and by who picked them', () => {
    const h = top(owner, 'B1020 MR', ['harvest'])
    expect(h.map((x) => x.rowId).sort()).toEqual(['h1', 'h2'])
  })
  it('finds a screen by number or name, and a species and a hazard from the built-in data', () => {
    expect(top(owner, 'search', ['screen'])[0].go.screen).toBe('SEARCH')
    expect(top(owner, 'blotch').some((h) => h.kind === 'hazard')).toBe(true)
    expect(top(owner, 'blue oyster', ['species'])[0].kind).toBe('species')
  })
  it('kind filter and counts', () => {
    const all = top(owner, 'blue')
    const counts = countByKind(all)
    expect(counts.size).toBeGreaterThan(1)
    expect(top(owner, 'blue', ['sale']).every((h) => h.kind === 'sale')).toBe(true)
    expect([...KINDS].length).toBe(19)
  })
  it('limit caps the list but total reports all', () => {
    const r = search(owner, 'a', { limit: 3 })
    expect(r.hits.length).toBe(3)
    expect(r.total).toBeGreaterThan(3)
  })
  it('owner finds sales by buyer; staff never see sales, orders, money, bills, labour or the money screens', () => {
    expect(top(owner, 'casa luna').some((h) => h.kind === 'sale')).toBe(true)
    expect(top(staff, 'casa luna').filter((h) => h.kind === 'sale')).toEqual([])
    const costKinds = new Set(KINDS.filter((k) => k.cost).map((k) => k.id))
    expect(staff.filter((d) => costKinds.has(d.kind))).toEqual([])
    const screens = staff.filter((d) => d.kind === 'screen').map((d) => d.go.screen).sort()
    expect(screens).toEqual([...STAFF_MODULES].sort())
    expect(owner.filter((d) => d.kind === 'screen').length).toBe(MODULES.length)
  })
  it('a hit never carries a long id or a data URL into the searched text', () => {
    for (const d of owner) expect(d.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })
})

describe('bulk edits', () => {
  let st: Store
  beforeEach(async () => {
    st = await fresh()
    await loadAll(st)
  })
  it('status on many cultures is one undo step and cold storage starts the cold clock', async () => {
    const depth = st.undoList().length
    const n = await st.action('BULK', () => setStatusMany(st, 'cultures', ['c1', 'c2'], 'cold_storage'))
    expect(n).toBe(2)
    expect(st.undoList().length).toBe(depth + 1)
    const cs = st.rows('cultures')
    expect(cs.filter((c) => c.status === 'cold_storage').map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(cs.find((c) => c.id === 'c1')!.cold_since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(cs.find((c) => c.id === 'c3')!.status).toBe('clean')
    await st.undo()
    expect(st.rows('cultures').every((c) => c.status === 'clean')).toBe(true)
  })
  it('refuses nothing ticked and a status the table does not have', async () => {
    await expect(setStatusMany(st, 'cultures', [], 'clean')).rejects.toThrow(/TICK AT LEAST ONE/)
    await expect(setStatusMany(st, 'cultures', ['c1'], 'flying')).rejects.toThrow(/PICK A STATUS/)
    await expect(setStatusMany(st, 'block_lots', ['l1'], 'clean')).rejects.toThrow(/PICK A LOT STATUS/)
  })
  it('place on many, blank clears it, text is capitals and capped at 40', async () => {
    await setPlaceMany(st, 'cultures', ['c1', 'c3'], 'fridge 2 shelf 1')
    expect(st.rows('cultures').filter((c) => c.location === 'FRIDGE 2 SHELF 1').length).toBe(2)
    await setPlaceMany(st, 'cultures', ['c1'], '   ')
    expect(st.rows('cultures').find((c) => c.id === 'c1')!.location).toBeNull()
    await setPlaceMany(st, 'grain_runs', ['g1'], 'x'.repeat(80))
    expect(String(st.rows('grain_runs').find((c) => c.id === 'g1')!.location).length).toBe(40)
  })
  it('grade on many harvests', async () => {
    expect(await gradeMany(st, ['h1', 'h2'], ' c ')).toBe(2)
    expect(st.rows('harvests').map((h) => h.grade)).toEqual(['C', 'C'])
    await expect(gradeMany(st, ['h1'], '  ')).rejects.toThrow(/PICK A GRADE/)
  })
  it('paid, owed and written off on many sales', async () => {
    expect(await salesMany(st, ['s1', 's2'], 'paid', '2026-11-05')).toBe(2)
    expect(st.rows('sales').every((s) => s.pay_status === 'paid' && s.paid_on === '2026-11-05')).toBe(true)
    await salesMany(st, ['s1', 's2'], 'owed', '2026-11-05')
    expect(st.rows('sales').find((s) => s.id === 's1')!.pay_status).toBe('owed')
    await expect(salesMany(st, ['s1'], 'written_off', '2026-11-06')).resolves.toBe(1)
    await salesMany(st, ['s2'], 'paid', '2026-11-05')
    await expect(salesMany(st, ['s2'], 'written_off', '2026-11-06')).rejects.toThrow(/ONLY MONEY OWED/)
    await salesMany(st, ['s2'], 'owed', '2026-11-05')
    await salesMany(st, ['s2'], 'written_off', '2026-11-06')
    expect(st.rows('sales').find((s) => s.id === 's2')!.pay_status).toBe('written_off')
  })
  it('delete keeps a culture other records came from, and a lot with harvests; everything else goes', async () => {
    // c1 is the parent of c2; c2 is the parent of grain run g1; c3 is the parent of g2; c4 has no children; l1 has harvests
    await st.put('cultures', { id: 'c4', strain_id: 'st1', parent_culture_id: null, kind: 'plate', p_level: 0, made_on: '2026-11-01', status: 'clean', cold_since: null, location: null, label: null, notes: null })
    const a = await st.action('DEL', () => deleteMany(st, 'cultures', ['c1', 'c2', 'c3', 'c4']))
    expect(a.deleted).toBe(1)
    expect(a.skipped.map((s) => s.id).sort()).toEqual(['c1', 'c2', 'c3'])
    expect(st.rows('cultures').map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3'])
    const b = await st.action('DEL', () => deleteMany(st, 'grain_runs', ['g1', 'g2']))
    expect(b).toMatchObject({ deleted: 0 })
    const c = await st.action('DEL', () => deleteMany(st, 'block_lots', ['l1', 'l2']))
    expect(c.deleted).toBe(1)
    expect(c.skipped).toEqual([{ id: 'l1', why: 'HARVESTS ARE LOGGED AGAINST IT' }])
    expect(st.rows('block_lots').map((l) => l.id).sort()).toEqual(['l1', 'l3'])
    expect(st.rows('harvests').length).toBe(2)
  })
  it('delete then undo restores every record exactly', async () => {
    const before = await dump(st)
    await st.action('DEL', () => deleteMany(st, 'block_lots', ['l2', 'l3']))
    expect(st.rows('block_lots').length).toBe(1)
    await st.undo()
    expect(await dump(st)).toBe(before)
  })
  it('stock take writes a count move only for items whose count differs, by the difference', async () => {
    // manifest: SAWDUST 10, BAGS 200. Counted 8 and 200 -> one move of -2
    const n = await st.action('TAKE', () =>
      stockTake(st, [
        { itemId: 'i1', current: 10, target: 8 },
        { itemId: 'i2', current: 200, target: 200 },
      ]),
    )
    expect(n).toBe(1)
    const moves = st.rows('stock_moves').filter((m) => m.reason === 'count')
    expect(moves.length).toBe(1)
    expect(moves[0]).toMatchObject({ item_id: 'i1', qty: -2 })
    const sum = st.rows('stock_moves').filter((m) => m.item_id === 'i1').reduce((a, m) => a + Number(m.qty), 0)
    expect(sum).toBe(8)
    await expect(stockTake(st, [{ itemId: 'i1', current: 10, target: -1 }])).rejects.toThrow(/BELOW ZERO/)
    await expect(stockTake(st, [{ itemId: 'i1', current: 10, target: NaN }])).rejects.toThrow(/BELOW ZERO/)
  })
})

describe('roles and access', () => {
  const kv = (): KV & { m: Map<string, string> } => {
    const m = new Map<string, string>()
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
  }
  it('the role comes from app_metadata only, never user_metadata', () => {
    expect(roleFromUser({ app_metadata: { role: 'staff' } })).toBe('staff')
    expect(roleFromUser({ app_metadata: { role: 'owner' } })).toBe('owner')
    expect(roleFromUser({ app_metadata: {} })).toBe('owner')
    expect(roleFromUser(null)).toBe('owner')
    expect(roleFromUser({ user_metadata: { role: 'staff' } } as never)).toBe('owner')
  })
  it('modules: staff open the work screens, not money, history, data or the manual', () => {
    for (const k of STAFF_MODULES) expect(canOpenModule('staff', k)).toBe(true)
    for (const k of OWNER_ONLY_MODULES) {
      expect(canOpenModule('staff', k)).toBe(false)
      expect(canOpenModule('owner', k)).toBe(true)
    }
    expect(new Set([...STAFF_MODULES, ...OWNER_ONLY_MODULES])).toEqual(new Set(MODULES.map((m) => m.key)))
    expect(canSeeMoney('owner')).toBe(true)
    expect(canSeeMoney('staff')).toBe(false)
  })
  it('PIN rules', () => {
    // Joseph 6 Nov 2026: exactly 8 digits.
    for (const ok of ['12345678', '00000000']) expect(validPin(ok)).toBe(true)
    for (const bad of ['1234', '1234567', '123456789', '1234a678', '', ' 1234567', '1234.678']) expect(validPin(bad)).toBe(false)
  })
  it('lock needs a PIN first; the right PIN unlocks; the PIN is stored hashed', async () => {
    const k = kv()
    expect(() => lockToStaff(k)).toThrow(/OWNER PIN FIRST/)
    await expect(setOwnerPin('12', k)).rejects.toThrow(/8 DIGITS/)
    await setOwnerPin('48210931', k)
    expect([...k.m.values()].join('')).not.toContain('48210931')
    expect(lockToStaff(k).role).toBe('staff')
    expect(loadLock(k).role).toBe('staff')
    expect((await unlockWithPin('0000', 1000, k)).ok).toBe(false)
    expect(loadLock(k).role).toBe('staff')
    expect((await unlockWithPin('48210931', 2000, k)).ok).toBe(true)
    expect(loadLock(k).role).toBe('owner')
  })
  it('five wrong tries lock the pad for 30 seconds, then it works again', async () => {
    const k = kv()
    await setOwnerPin('48210931', k)
    lockToStaff(k)
    const left: (number | undefined)[] = []
    for (let i = 0; i < PIN_TRIES - 1; i++) left.push((await unlockWithPin('1111', 1000 + i, k)).left)
    expect(left).toEqual([4, 3, 2, 1])
    const fifth = await unlockWithPin('1111', 5000, k)
    expect(fifth).toMatchObject({ ok: false, wait: PIN_WAIT_MS / 1000 })
    // even the right PIN is refused during the wait
    expect(await unlockWithPin('48210931', 5000 + 10000, k)).toMatchObject({ ok: false, wait: 20 })
    expect(loadLock(k).role).toBe('staff')
    expect((await unlockWithPin('48210931', 5000 + PIN_WAIT_MS + 1, k)).ok).toBe(true)
  })
  it('a success clears earlier wrong tries; a broken store falls back to owner (never locks everyone out)', async () => {
    const k = kv()
    await setOwnerPin('48210931', k)
    await unlockWithPin('1', 1, k)
    await unlockWithPin('48210931', 2, k)
    expect(loadLock(k).fails).toBe(0)
    k.m.set([...k.m.keys()][0], '{not json')
    expect(loadLock(k)).toEqual({ role: 'owner' })
    expect(loadLock(null)).toEqual({ role: 'owner' })
    saveLock({ role: 'staff' }, null) // must not throw
  })

  describe('a staff view of the store', () => {
    it('denied tables read empty and refuse every write; work tables work', async () => {
      const st = await fresh()
      st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
      await loadAll(st)
      expect(st.rows('sales')).toEqual([])
      expect(st.rows('harvests').length).toBe(2)
      await expect(st.put('sales', { id: 's9', sold_on: '2026-11-06', kg: 1, amount_crc: 1 })).rejects.toThrow(/STAFF CANNOT CHANGE THAT/)
      await expect(st.del('sales', ['s1'])).rejects.toThrow(/STAFF CANNOT CHANGE THAT/)
      await st.put('harvests', { id: 'h9', block_lot_id: 'l1', harvested_on: '2026-11-06', flush: 2, kg: 1, grade: 'A', initials: 'MR', notes: null })
      expect(st.rows('harvests').length).toBe(3)
      // the real data is still there when the owner looks
      st.setAccess([])
      await loadAll(st)
      expect(st.rows('sales').length).toBe(2)
    })
    it('the money and rates settings rows are hidden and cannot be written; practice rows work', async () => {
      const st = await fresh()
      st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
      await st.ensure('app_settings')
      expect(st.rows('app_settings').map((r) => r.id)).toEqual(['practice'])
      for (const id of STAFF_HIDDEN_SETTINGS) await expect(st.put('app_settings', { id, value: { hack: 1 } })).rejects.toThrow(/STAFF CANNOT CHANGE THAT/)
      await st.put('app_settings', { id: 'practice', value: { slant_months: 9 } })
      st.setAccess([])
      await st.ensure('app_settings')
      expect(st.rows('app_settings').find((r) => r.id === 'rates')!.value).toEqual({ fx: 520, secret: 'prices' })
    })
    it('staff changes are still written to the history, signed with their name', async () => {
      const st = await fresh()
      st.who = 'WORKER@FARM'
      st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
      await st.action('LOG HARVEST', () => st.put('harvests', { id: 'h9', block_lot_id: 'l1', harvested_on: '2026-11-06', flush: 2, kg: 1, grade: 'A', initials: 'MR', notes: null }))
      await settle()
      st.setAccess([])
      await st.ensure(EDIT_LOG)
      const e = st.rows<EditEntry>(EDIT_LOG).find((x) => x.row_id === 'h9')
      expect(e).toBeTruthy()
      expect(e!.who).toBe('WORKER@FARM')
      // and a staff view cannot read the history
      st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
      expect(st.rows(EDIT_LOG)).toEqual([])
    })
    it('going back to owner shows everything again with no reload', async () => {
      const st = await fresh()
      st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
      st.setAccess([])
      await loadAll(st)
      expect(st.rows('sales').length).toBe(2)
      expect(st.rows('app_settings').length).toBe(3)
    })
  })

  it('the denied list matches migration 0016: the same money tables have no staff policy', () => {
    const dir = join(__dirname, '..', '..', 'supabase', 'migrations')
    const sql = readFileSync(join(dir, '0016_staff_role.sql'), 'utf8')
    const list = (name: string) => [...(new RegExp(`${name}[\\s\\S]*?array\\[([\\s\\S]*?)\\]`).exec(sql)?.[1].matchAll(/'([a-z_]+)'/g) ?? [])].map((m) => m[1])
    const granted = new Set([...list('Records staff may add and change'), ...list('Log lines staff may also delete')])
    expect(granted.size).toBeGreaterThan(30)
    // every table the app backs up is either granted to staff, handled specially (settings, history), or denied
    const special = new Set(['app_settings', 'edit_log'])
    const open = BACKUP_TABLES.filter((t) => !granted.has(t) && !special.has(t))
    expect([...open].sort()).toEqual([...STAFF_DENIED_TABLES].filter((t) => !special.has(t)).sort())
    // and a denied table is never granted
    for (const t of STAFF_DENIED_TABLES) expect(granted.has(t), t).toBe(false)
  })
})

describe('glove pad keys', () => {
  it('digits, back, clear', () => {
    expect(padKey('', '1', false)).toBe('1')
    expect(padKey('12', '3', false)).toBe('123')
    expect(padKey('123', 'BACK', false)).toBe('12')
    expect(padKey('', 'BACK', false)).toBe('')
    expect(padKey('999', 'CLEAR', true)).toBe('')
  })
  it('a leading zero is replaced by the next digit', () => {
    expect(padKey('0', '7', false)).toBe('7')
    expect(padKey('-0', '7', true)).toBe('-7')
    expect(padKey('0', '0', true)).toBe('0')
  })
  it('the point only in decimal boxes, only once, and 0. when empty', () => {
    expect(padKey('', '.', true)).toBe('0.')
    expect(padKey('-', '.', true)).toBe('-0.')
    expect(padKey('12', '.', true)).toBe('12.')
    expect(padKey('12.5', '.', true)).toBe('12.5')
    expect(padKey('12', '.', false)).toBe('12')
    expect(padKey('0.', '5', true)).toBe('0.5')
  })
  it('the sign key flips a decimal box only', () => {
    expect(padKey('5', 'SIGN', true)).toBe('-5')
    expect(padKey('-5', 'SIGN', true)).toBe('5')
    expect(padKey('', 'SIGN', true)).toBe('-')
    expect(padKey('5', 'SIGN', false)).toBe('5')
  })
  it('the length limit stops typing, and unknown keys do nothing', () => {
    expect(padKey('1234', '5', false, 4)).toBe('1234')
    expect(padKey('123', '.', true, 4)).toBe('123.')
    expect(padKey('1234', '.', true, 4)).toBe('1234')
    expect(padKey('12', 'X', true)).toBe('12')
  })
  it('random key presses always leave a number-shaped text (seeded)', () => {
    const keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'SIGN', 'BACK', 'CLEAR']
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed)
      let v = ''
      for (let i = 0; i < 80; i++) {
        v = padKey(v, keys[r.int(keys.length)], true, 12)
        expect(v, `seed ${seed} step ${i}`).toMatch(/^-?(\d+\.?\d*)?$/)
        expect(v.length).toBeLessThanOrEqual(12)
      }
    }
  })
})
