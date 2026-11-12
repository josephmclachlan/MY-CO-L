// Mock trials and stress tests for the Google Sheet mirror. The REAL sheet script (sheets/Code.gs) runs
// against a pretend spreadsheet, so both halves are tested together.
// Joseph's rule (6 Nov 2026): mock trials of each function, data logging, historical resilience,
// outputs checked against expected data, and stress tests.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKUP_TABLES, MemoryBackend, Store, type Row } from '../store'
import type { EditEntry } from '../history'
import { rng } from '../testkit'
import { cellKey, fromCell, toCell } from './convert'
import { SheetSync, SYNC_DEFAULTS, type SyncOptions } from './engine'
import { FakeSpreadsheet, ScriptClient, loadScript, typeInto, type FakeSheet } from './fakeSheet'
import { ACTION, EDITED, MIRRORED, SHEET_BY_TABLE, SHEET_TABLES, tabColumns, tabName } from './schema'
import { MemoryState } from './state'
import { AppsScriptClient, checkUrl } from './client'
// @ts-expect-error plain .mjs script without types
import { generate } from '../../../scripts/sheet-columns.mjs'

Store.GROUP_MS = 0
const KEY = 'test-key-0123456789'

/** A farm with a few records, a sheet, the script and a sync, all on one test clock. */
async function farm(opts: Partial<SyncOptions> = {}) {
  // The sheet's clock starts 3 hours behind the device, so app edits made now are later than sheet edits
  // unless a test moves the sheet clock ahead on purpose.
  let t = Date.now() - 3 * 3600000
  const clock = () => new Date(t)
  const tick = (ms = 1000) => (t += ms)
  const st = new Store(new MemoryBackend())
  st.who = 'JOSEPH'
  await st.action('SEED', async () => {
    await st.put('strains', [
      { id: 'bo', code: 'BO-01', species_key: 'blue-oyster', active: true, notes: null },
      { id: 'lm', code: 'LM-01', species_key: 'lions-mane', active: true, notes: 'from Avery' },
    ])
    await st.put('cultures', [
      { id: 'c1', strain_id: 'bo', kind: 'plate', p_level: 1, made_on: '2026-11-01', status: 'clean', label: 'BO-01 P1 A', updated_at: '2026-11-01T10:00:00.000Z' },
      { id: 'c2', strain_id: 'lm', kind: 'slant', p_level: 0, made_on: '2026-10-20', status: 'cold_storage', label: 'LM-01 P0', updated_at: '2026-11-01T10:00:00.000Z' },
    ])
    await st.put('block_lots', { id: 'lot', lot_code: 'B1103', strain_id: 'bo', bag_count: 60, status: 'incubating', knock_date: '2026-11-03' })
    await st.put('harvests', { id: 'h1', block_lot_id: 'lot', harvested_on: '2026-11-06', flush: 1, kg: 4.2, grade: 'A' })
    await st.put('cash_moves', { id: 'm1', day: '2026-11-05', line: 'fuel', amount_crc: 18500, notes: '=SUM(A1)' })
    await st.put('fx_rates', { id: '2026-11-05', day: '2026-11-05', crc_per_usd: 506.12, source: 'AUTO' })
  })
  const ss = new FakeSpreadsheet()
  const script = loadScript(ss, KEY, clock)
  const client = new ScriptClient(script, KEY)
  const saved = new MemoryState()
  const sync = new SheetSync(st, client, saved, { ...SYNC_DEFAULTS, ...opts }, clock)
  return { st, ss, script, client, saved, sync, tick, clock }
}

/** Every mirrored table: the sheet shows exactly what the app holds. */
function expectMirror(f: Awaited<ReturnType<typeof farm>>) {
  for (const s of SHEET_TABLES) {
    if (s.table === 'sensor_readings' && !f.sync.opts.readings) continue
    const rows = f.st.rows(s.table)
    const sh = f.ss.getSheetByName(s.tab)
    if (!sh) {
      expect(rows.length, `${s.tab} has rows but no tab`).toBe(0)
      continue
    }
    const cols = tabColumns(s.table, rows).filter((c) => c.name !== ACTION && c.name !== EDITED)
    const want = s.table === 'edit_log' ? Math.min(rows.length, f.sync.opts.historyMax) : rows.length
    expect(sh.dataRows(), `${s.tab} row count`).toBe(want)
    if (s.table === 'edit_log') continue
    for (const r of rows) {
      const cells = f.sync.cellsOf(s.table, r, cols)
      expect(sh.rowOf(r.id), `${s.tab} ${r.id} in sheet`).toBeGreaterThan(0)
      for (const c of cols) expect(cellKey(sh.cell(r.id, c.name) as never), `${s.tab} ${r.id} ${c.name}`).toBe(cellKey(cells[c.name]))
    }
  }
}

const historyOf = (st: Store) => st.rows<EditEntry>('edit_log')

describe('sheet layout', () => {
  it('has a tab for every backup table and the sensor readings, with unique plain names', () => {
    for (const t of MIRRORED) expect(SHEET_BY_TABLE.has(t), t).toBe(true)
    expect(SHEET_TABLES.length).toBe(MIRRORED.length)
    const names = SHEET_TABLES.map((s) => s.tab)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n.length).toBeLessThan(40)
    expect(tabName('block_lots')).toBe('Block lots')
    expect(tabName('bank_tests')).toBe('T/E tests')
    expect(tabName('ac_log')).toBe('A/C checks')
    expect(tabName('edit_log')).toBe('Edit history')
  })

  it('column rules are generated from the migrations and up to date', () => {
    const file = readFileSync(join(__dirname, 'columns.gen.ts'), 'utf8')
    expect(file).toBe(generate())
  })

  it('puts ACTION first, look-ups after the fields, id and times at the right, and drops the photo data', () => {
    const cols = tabColumns('cultures', [{ id: 'x', strain_id: 's', kind: 'plate', app_only: 3 }]).map((c) => c.name)
    expect(cols[0]).toBe(ACTION)
    expect(cols.slice(-4)).toEqual(['id', 'created_at', 'updated_at', EDITED])
    expect(cols).toContain('strain_code')
    expect(cols.indexOf('strain_code')).toBeGreaterThan(cols.indexOf('app_only'))
    expect(tabColumns('photos', []).map((c) => c.name)).not.toContain('data_url')
    expect(tabColumns('fx_rates', []).every((c) => c.ro)).toBe(true)
    const kind = tabColumns('cultures', []).find((c) => c.name === 'kind')!
    expect(kind.choices).toContain('slant')
    expect(tabColumns('strains', []).find((c) => c.name === 'active')!.kind).toBe('bool')
  })
})

describe('cell conversion', () => {
  it('round trips every kind of value', () => {
    const cases: [unknown, Parameters<typeof toCell>[1]][] = [
      [4.25, { kind: 'number' }],
      [0, { kind: 'number' }],
      [true, { kind: 'bool' }],
      [false, { kind: 'bool' }],
      ['2026-11-07', { kind: 'date' }],
      ['2026-11-07T14:30:05.120Z', { kind: 'datetime' }],
      [['a', 'b'], { kind: 'json' }],
      [{ on: '2026-11-07T01:00:00.000Z', off: null }, { kind: 'json' }],
      ['=SUM(A1)', { kind: 'text' }],
      ['0012', { kind: 'text' }],
      ['clean', { kind: 'text', choices: ['clean', 'used_up'] }],
    ]
    for (const [v, spec] of cases) {
      const p = fromCell(toCell(v, spec), spec)
      expect(p, JSON.stringify(v)).toEqual({ ok: true, value: v })
    }
  })

  it('reads what a person types', () => {
    expect(fromCell('₡18,500', { kind: 'number' })).toEqual({ ok: true, value: 18500 })
    expect(fromCell('2026-11-7', { kind: 'date' })).toEqual({ ok: true, value: '2026-11-07' })
    expect(fromCell('2026-11-07 14:30', { kind: 'datetime' })).toEqual({ ok: true, value: '2026-11-07T14:30:00.000Z' })
    expect(fromCell('2026-11-07 08:30 -06:00', { kind: 'datetime' })).toEqual({ ok: true, value: '2026-11-07T14:30:00.000Z' })
    expect(fromCell('sí', { kind: 'bool' })).toEqual({ ok: true, value: true })
    expect(fromCell('CLEAN', { kind: 'text', choices: ['clean'] })).toEqual({ ok: true, value: 'clean' })
    expect(fromCell('', { kind: 'number' })).toEqual({ ok: true, value: null })
  })

  it('refuses values that do not fit, in plain words', () => {
    expect(fromCell('four', { kind: 'number' })).toMatchObject({ ok: false, error: 'WANTS A NUMBER' })
    expect(fromCell('2026-02-30', { kind: 'date' })).toMatchObject({ ok: false })
    expect(fromCell('soon', { kind: 'datetime' })).toMatchObject({ ok: false })
    expect(fromCell('maybe', { kind: 'bool' })).toMatchObject({ ok: false })
    expect(fromCell('dirty', { kind: 'text', choices: ['clean', 'used_up'] })).toMatchObject({ ok: false, error: 'NOT ON THE LIST (clean, used_up)' })
    expect(fromCell('[a', { kind: 'json' })).toMatchObject({ ok: false })
  })
})

describe('web client', () => {
  it('checks the address and turns answers into plain errors', async () => {
    expect(checkUrl('')).toMatch(/PASTE/)
    expect(checkUrl('https://script.google.com/macros/s/AKfy-123_x/dev')).toMatch(/\/dev/)
    expect(checkUrl('https://example.com/x')).toMatch(/NOT A WEB APP/)
    expect(checkUrl('https://script.google.com/macros/s/AKfy-123_x/exec')).toBeNull()
    const sent: RequestInit[] = []
    const ok = new AppsScriptClient('u', 'k', async (_u, i) => (sent.push(i), { ok: true, status: 200, text: async () => '{"version":1,"sheet":"S"}' }))
    expect(await ok.hello()).toEqual({ version: 1, sheet: 'S' })
    expect((sent[0].headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/)
    expect(JSON.parse(String(sent[0].body))).toEqual({ key: 'k', op: 'hello' })
    const html = new AppsScriptClient('u', 'k', async () => ({ ok: true, status: 200, text: async () => '<html>sign in</html>' }))
    await expect(html.hello()).rejects.toThrow(/ANYONE/)
    const bad = new AppsScriptClient('u', 'k', async () => ({ ok: true, status: 200, text: async () => '{"error":"WRONG KEY."}' }))
    await expect(bad.hello()).rejects.toThrow('GOOGLE SHEET: WRONG KEY.')
    const off = new AppsScriptClient('u', 'k', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(off.hello()).rejects.toThrow(/NO SIGNAL/)
  })

  it('the script refuses a wrong key and a script with no key', () => {
    const ss = new FakeSpreadsheet()
    const out = JSON.parse(loadScript(ss, KEY).doPost({ postData: { contents: JSON.stringify({ key: 'nope', op: 'hello' }) } }).s)
    expect(out.error).toMatch(/WRONG KEY/)
    const raw = JSON.parse(loadScript(ss, '__MYCOL_KEY__').doPost({ postData: { contents: JSON.stringify({ key: '__MYCOL_KEY__', op: 'hello' }) } }).s)
    expect(raw.error).toMatch(/NO KEY/)
    expect(loadScript(ss, KEY).doGet().s).toMatch(/running/)
  })
})

describe('mock trial: a week of farm records in the sheet', () => {
  it('first sync writes every record, the READ ME and the tabs in order', async () => {
    const f = await farm()
    const rep = await f.sync.run()
    expect(rep.full).toBe(true)
    expect(f.ss.sheets[0].name).toBe('READ ME')
    expect(String(f.ss.tab('READ ME').get(1, 1))).toBe('MY/CO/L FARM RECORDS')
    // Tabs in the app's order after the READ ME.
    const order = f.ss.sheets.slice(1).map((s) => s.name)
    expect(order).toEqual(SHEET_TABLES.filter((s) => s.table !== 'sensor_readings').map((s) => s.tab))
    const cult = f.ss.tab('Cultures')
    expect(cult.cell('c1', 'status')).toBe('clean')
    expect(cult.cell('c1', 'strain_code')).toBe('BO-01')
    expect(cult.cell('c1', 'p_level')).toBe(1)
    expect(f.ss.tab('Strains').cell('bo', 'active')).toBe(true)
    expect(f.ss.tab('Strains').cell('bo', 'species_name')).toMatch(/oyster/i)
    // A text that looks like a formula is stored as text, never run.
    expect(f.ss.tab('Money entries').cell('m1', 'notes')).toBe('=SUM(A1)')
    expect(f.ss.tab('Harvests').cell('h1', 'lot_code')).toBe('B1103')
    // Formats and notes: text columns are plain text (no date guessing), numbers grouped, every header explained.
    expect(cult.formats.get(cult.col('label'))).toBe('@')
    expect(cult.formats.get(cult.col('made_on'))).toBe('@')
    expect(cult.formats.get(cult.col('p_level'))).toBe('#,##0.###')
    expect(cult.notes.get(cult.col('kind'))).toMatch(/One of: plate, slant/)
    expect(cult.validation.has(cult.col('status'))).toBe(true)
    expectMirror(f)
    // The sync wrote nothing into the app and left no history of its own.
    expect(historyOf(f.st).some((e) => e.via === 'sheet')).toBe(false)
  })

  it('a sheet edit reaches the app as one UNDO step signed GOOGLE SHEET, and UNDO flows back to the sheet', async () => {
    const f = await farm()
    await f.sync.run()
    const cult = f.ss.tab('Cultures')
    f.tick(60000)
    typeInto(f.script, cult, cult.rowOf('c1'), { status: 'used_up', notes: 'went to G1' })
    typeInto(f.script, f.ss.tab('Harvests'), f.ss.tab('Harvests').rowOf('h1'), { kg: '4.45' })
    f.tick(60000)
    const rep = await f.sync.run()
    expect(rep.changed).toBe(2)
    const c1 = f.st.rows('cultures').find((r) => r.id === 'c1')!
    expect(c1.status).toBe('used_up')
    expect(c1.notes).toBe('went to G1')
    expect(f.st.rows('harvests')[0].kg).toBe(4.45)
    const lines = historyOf(f.st).filter((e) => e.via === 'sheet')
    expect(lines.length).toBe(2)
    expect(lines.every((e) => e.who === 'GOOGLE SHEET' && e.label.startsWith('GOOGLE SHEET EDITS'))).toBe(true)
    expect(lines.find((e) => e.table_name === 'harvests')!.changes).toEqual([{ f: 'kg', old: 4.2, new: 4.45 }])
    expect(f.st.who).toBe('JOSEPH')
    // UNDO takes both back in one step.
    expect(f.st.undoPeek()!.label).toMatch(/GOOGLE SHEET EDITS: 2 CHANGED/)
    await f.st.undo()
    expect(f.st.rows('cultures').find((r) => r.id === 'c1')!.status).toBe('clean')
    expect(f.st.rows('harvests')[0].kg).toBe(4.2)
    f.tick(60000)
    await f.sync.run()
    expect(cult.cell('c1', 'status')).toBe('clean')
    expect(f.ss.tab('Harvests').cell('h1', 'kg')).toBe(4.2)
    expectMirror(f)
  })

  it('a row typed into the sheet becomes a record, finding the strain by its code', async () => {
    const f = await farm()
    await f.sync.run()
    const cult = f.ss.tab('Cultures')
    const row = cult.getLastRow() + 1
    f.tick()
    typeInto(f.script, cult, row, { strain_code: 'lm-01', kind: 'Plate', p_level: 1, made_on: '2026-11-07', status: 'clean', label: 'LM-01 P1 A' })
    const id = String(cult.get(row, cult.col('id')))
    expect(id).toMatch(/^sheet-/)
    expect(String(cult.get(row, cult.col(EDITED)))).toBe(f.clock().toISOString())
    f.tick()
    const rep = await f.sync.run()
    expect(rep.added).toBe(1)
    const c = f.st.rows('cultures').find((r) => r.id === id)!
    expect(c).toMatchObject({ strain_id: 'lm', kind: 'plate', p_level: 1, made_on: '2026-11-07', label: 'LM-01 P1 A' })
    expect(historyOf(f.st).find((e) => e.row_id === id)!.op).toBe('create')
    expectMirror(f)
  })

  it('a new row missing a needed field waits, and is saved once it is filled in', async () => {
    const f = await farm()
    await f.sync.run()
    const h = f.ss.tab('Harvests')
    const row = h.getLastRow() + 1
    f.tick()
    typeInto(f.script, h, row, { harvested_on: '2026-11-07', kg: 3 })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('harvests').length).toBe(1)
    expect(f.sync.state.notes[0]).toMatchObject({ kind: 'needs' })
    expect(f.sync.state.notes[0].text).toMatch(/block_lot_id/)
    // The row is left alone in the sheet.
    expect(h.get(row, h.col('kg'))).toBe(3)
    f.tick()
    typeInto(f.script, h, row, { lot_code: 'B1103' })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('harvests').length).toBe(2)
    expect(f.st.rows('harvests').find((r) => r.id !== 'h1')).toMatchObject({ block_lot_id: 'lot', kg: 3 })
    expectMirror(f)
  })

  it('DELETE in the action cell deletes the record; deleting the row itself only gets it put back', async () => {
    const f = await farm()
    await f.sync.run()
    const cult = f.ss.tab('Cultures')
    f.tick()
    typeInto(f.script, cult, cult.rowOf('c2'), { [ACTION]: 'delete' })
    f.tick()
    const rep = await f.sync.run()
    expect(rep.deleted).toBe(1)
    expect(f.st.rows('cultures').map((r) => r.id)).toEqual(['c1'])
    expect(cult.rowOf('c2')).toBe(0)
    const del = historyOf(f.st).find((e) => e.row_id === 'c2' && e.op === 'delete')!
    expect(del.snapshot).toMatchObject({ label: 'LM-01 P0' })
    // A slip of the mouse: the whole row is deleted in the sheet.
    cult.deleteRows(cult.rowOf('c1'), 1)
    f.tick()
    await f.sync.run(true)
    expect(f.st.rows('cultures').length).toBe(1)
    expect(cult.rowOf('c1')).toBeGreaterThan(0)
    expect(f.sync.state.notes[0].kind).toBe('restored_row')
    expectMirror(f)
  })

  it('a value that does not fit is refused, listed, and the app value is put back', async () => {
    const f = await farm()
    await f.sync.run()
    const h = f.ss.tab('Harvests')
    const cult = f.ss.tab('Cultures')
    f.tick()
    typeInto(f.script, h, h.rowOf('h1'), { kg: 'four' })
    typeInto(f.script, cult, cult.rowOf('c1'), { status: 'dirty', strain_code: 'XX-99' })
    typeInto(f.script, cult, cult.rowOf('c2'), { kind: '' })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('harvests')[0].kg).toBe(4.2)
    expect(f.st.rows('cultures').find((r) => r.id === 'c1')).toMatchObject({ status: 'clean', strain_id: 'bo' })
    expect(f.st.rows('cultures').find((r) => r.id === 'c2')!.kind).toBe('slant')
    const notes = f.sync.state.notes.map((n) => n.text)
    expect(notes.some((n) => /kg: "four" WANTS A NUMBER/.test(n))).toBe(true)
    expect(notes.some((n) => /NOT ON THE LIST/.test(n))).toBe(true)
    expect(notes.some((n) => /IS NOT IN STRAINS/.test(n))).toBe(true)
    expect(notes.some((n) => /kind: CANNOT BE EMPTY/.test(n))).toBe(true)
    expect(h.cell('h1', 'kg')).toBe(4.2)
    expect(cult.cell('c1', 'status')).toBe('clean')
    expect(cult.cell('c1', 'strain_code')).toBe('BO-01')
    expect(historyOf(f.st).some((e) => e.via === 'sheet')).toBe(false)
    expectMirror(f)
  })

  it('read-only cells and tabs are put back; exchange rates change only in the app', async () => {
    const f = await farm()
    await f.sync.run()
    const fx = f.ss.tab('Exchange rates')
    const cult = f.ss.tab('Cultures')
    f.tick()
    typeInto(f.script, fx, fx.rowOf('2026-11-05'), { crc_per_usd: 999 })
    typeInto(f.script, cult, cult.rowOf('c1'), { updated_at: 'tampered' })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('fx_rates')[0].crc_per_usd).toBe(506.12)
    expect(fx.cell('2026-11-05', 'crc_per_usd')).toBe(506.12)
    expect(cult.cell('c1', 'updated_at')).toBe(f.st.rows('cultures').find((r) => r.id === 'c1')!.updated_at)
    expectMirror(f)
  })

  it('changes made in the app reach the sheet, deletes remove the row', async () => {
    const f = await farm()
    await f.sync.run()
    await f.st.action('LOT SPENT', () => f.st.put('block_lots', { id: 'lot', status: 'spent' }))
    await f.st.action('ADD MOVE', () => f.st.put('cash_moves', { id: 'm2', day: '2026-11-07', line: 'substrate', amount_crc: 42000 }))
    await f.st.action('DEL', () => f.st.del('harvests', 'h1'))
    f.tick()
    const rep = await f.sync.run()
    expect(rep).toMatchObject({ added: 0, changed: 0, removed: 1 })
    expect(f.ss.tab('Block lots').cell('lot', 'status')).toBe('spent')
    expect(f.ss.tab('Money entries').cell('m2', 'amount_crc')).toBe(42000)
    expect(f.ss.tab('Harvests').dataRows()).toBe(0)
    expectMirror(f)
  })

  it('a field changed on both sides keeps the later change and lists it', async () => {
    const f = await farm()
    await f.sync.run()
    const cult = f.ss.tab('Cultures')
    // Sheet first, app later: the app wins.
    f.tick()
    typeInto(f.script, cult, cult.rowOf('c1'), { location: 'shelf 2' })
    await new Promise((r) => setTimeout(r, 5))
    await f.st.action('MOVE', () => f.st.put('cultures', { id: 'c1', location: 'fridge B' }))
    f.tick()
    await f.sync.run()
    expect(f.st.rows('cultures').find((r) => r.id === 'c1')!.location).toBe('fridge B')
    expect(cult.cell('c1', 'location')).toBe('fridge B')
    expect(f.sync.state.notes[0]).toMatchObject({ kind: 'conflict', winner: 'app', field: 'location' })
    // App first, sheet later (sheet clock ahead): the sheet wins.
    await f.st.action('MOVE', () => f.st.put('cultures', { id: 'c1', location: 'fridge C' }))
    f.tick(4 * 3600000)
    typeInto(f.script, cult, cult.rowOf('c1'), { location: 'shelf 3' })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('cultures').find((r) => r.id === 'c1')!.location).toBe('shelf 3')
    expect(f.sync.state.notes[0]).toMatchObject({ kind: 'conflict', winner: 'sheet' })
    // A different field on each side: both kept, no conflict.
    const before = f.sync.state.notes.length
    await f.st.action('LABEL', () => f.st.put('cultures', { id: 'c1', label: 'BO-01 P1 RELABEL' }))
    f.tick()
    typeInto(f.script, cult, cult.rowOf('c1'), { notes: 'checked' })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('cultures').find((r) => r.id === 'c1')).toMatchObject({ label: 'BO-01 P1 RELABEL', notes: 'checked' })
    expect(f.sync.state.notes.length).toBe(before)
    expectMirror(f)
  })

  it('a sheet edit to a record deleted in the app does not bring it back, and says so', async () => {
    const f = await farm()
    await f.sync.run()
    const cult = f.ss.tab('Cultures')
    f.tick()
    typeInto(f.script, cult, cult.rowOf('c2'), { notes: 'still good' })
    await f.st.action('DEL', () => f.st.del('cultures', 'c2'))
    f.tick()
    await f.sync.run()
    expect(f.st.rows('cultures').some((r) => r.id === 'c2')).toBe(false)
    expect(cult.rowOf('c2')).toBe(0)
    expect(f.sync.state.notes[0].kind).toBe('deleted_in_app')
  })

  it('money: an amount edited in the sheet keeps colones and never touches the day\'s rate', async () => {
    const f = await farm()
    await f.sync.run()
    const m = f.ss.tab('Money entries')
    f.tick()
    typeInto(f.script, m, m.rowOf('m1'), { amount_crc: '₡19,000' })
    f.tick()
    await f.sync.run()
    expect(f.st.rows('cash_moves')[0].amount_crc).toBe(19000)
    expect(f.st.rows('fx_rates')).toEqual([{ id: '2026-11-05', day: '2026-11-05', crc_per_usd: 506.12, source: 'AUTO' }])
  })

  it('survives a lost signal half way, and a reset sync memory', async () => {
    const f = await farm()
    await f.sync.run()
    const cult = f.ss.tab('Cultures')
    f.tick()
    typeInto(f.script, cult, cult.rowOf('c1'), { status: 'contaminated' })
    await f.st.action('ADD', () => f.st.put('cultures', { id: 'c3', strain_id: 'bo', kind: 'liquid', status: 'clean' }))
    f.client.dropAfter = 1 // pull works, push fails
    f.tick()
    await expect(f.sync.run()).rejects.toThrow(/NO SIGNAL/)
    expect(f.sync.running).toBe(false)
    expect(f.st.rows('cultures').find((r) => r.id === 'c1')!.status).toBe('contaminated')
    f.tick()
    await f.sync.run()
    expect(historyOf(f.st).filter((e) => e.via === 'sheet').length).toBe(1)
    expectMirror(f)
    // The device forgets what was synced (new phone): the app copy wins, nothing is doubled.
    await f.sync.reset()
    f.tick()
    await f.sync.run()
    expect(f.ss.tab('Cultures').dataRows()).toBe(3)
    expectMirror(f)
    // The sync memory survives a reload.
    const again = new SheetSync(f.st, f.client, f.saved, f.sync.opts, f.clock)
    await again.init()
    expect(again.state.cursor).toBe(f.sync.state.cursor)
    expect(Object.keys(again.state.base.cultures)).toHaveLength(3)
  })

  it('history and readings tabs are windows, read only', async () => {
    const f = await farm({ readings: true, readingDays: 1, historyMax: 3 })
    // Reading times are set from the test clock (fixed dates went stale a day after they were written).
    const ago = (h: number) => new Date(f.clock().getTime() - h * 3600000).toISOString()
    await f.st.put('sensor_readings', [
      { id: 'r-old', room_id: 'fruiting', place: 'fruiting', taken_at: ago(6 * 24), temp_c: 16 },
      { id: 'r-new', room_id: 'fruiting', place: 'fruiting', taken_at: ago(1), temp_c: 16.4 },
    ])
    await f.sync.run()
    expect(f.ss.tab('Sensor readings').dataRows()).toBe(1)
    expect(f.ss.tab('Edit history').dataRows()).toBe(3)
    const newest = [...historyOf(f.st)].sort((a, b) => b.at.localeCompare(a.at))[0]
    expect(f.ss.tab('Edit history').rowOf(newest.id)).toBeGreaterThan(0)
  })

  it('only the owner syncs', async () => {
    const f = await farm()
    f.st.setAccess(['cash_moves'])
    await expect(f.sync.run()).rejects.toThrow(/ONLY THE OWNER/)
  })
})

describe('stress: random edits on both sides', () => {
  const SEEDS = Number(process.env.STRESS_SEEDS ?? 6)
  const STEPS = Number(process.env.STRESS_STEPS ?? 160)
  const STATUSES = ['clean', 'contaminated', 'used_up', 'cold_storage', 'discarded']
  it(`${SEEDS} seeds x ${STEPS} steps: sheet and app end up the same, nothing lost, every app write logged`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rr = rng(seed)
      const r = rr.next
      const f = await farm()
      const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
      let made = 0
      await f.sync.run()
      for (let step = 0; step < STEPS; step++) {
        const op = r()
        const cult = f.ss.tab('Cultures')
        const sheetIds = [] as string[]
        for (let i = 2; i <= cult.getLastRow(); i++) {
          const id = String(cult.get(i, cult.col('id')))
          if (id) sheetIds.push(id)
        }
        const appIds = f.st.rows('cultures').map((x) => x.id)
        f.tick(1000 + Math.floor(r() * 60000))
        if (op < 0.2 && appIds.length) await f.st.action('APP EDIT', () => f.st.put('cultures', { id: pick(appIds), status: pick(STATUSES), p_level: Math.floor(r() * 4) }))
        else if (op < 0.3) await f.st.action('APP ADD', () => f.st.put('cultures', { id: `a${seed}-${made++}`, strain_id: pick(['bo', 'lm']), kind: 'plate', status: 'clean', label: `L${made}` }))
        else if (op < 0.36 && appIds.length > 1) await f.st.action('APP DEL', () => f.st.del('cultures', pick(appIds)))
        else if (op < 0.6 && sheetIds.length) typeInto(f.script, cult, cult.rowOf(pick(sheetIds)), { status: pick([...STATUSES, 'oops']), notes: r() < 0.5 ? `n${step}` : '' })
        else if (op < 0.68) typeInto(f.script, cult, cult.getLastRow() + 1, { strain_code: pick(['BO-01', 'LM-01', 'NOPE']), kind: pick(['plate', 'slant', 'bad']), label: `S${step}` })
        else if (op < 0.72 && sheetIds.length > 1) typeInto(f.script, cult, cult.rowOf(pick(sheetIds)), { [ACTION]: 'DELETE' })
        else if (op < 0.75 && sheetIds.length > 1) cult.deleteRows(cult.rowOf(pick(sheetIds)), 1)
        else if (op < 0.78) typeInto(f.script, cult, cult.rowOf(pick(sheetIds)) || 2, { p_level: pick([1, 2, 'x', '']) })
        else if (op < 0.8) await f.st.undo().catch(() => null)
        else if (op < 0.84) f.client.dropAfter = Math.floor(r() * 2)
        if (r() < 0.35) {
          await f.sync.run(r() < 0.3).catch((e: Error) => {
            if (!/NO SIGNAL/.test(e.message)) throw e
          })
          f.client.dropAfter = null
        }
      }
      f.client.dropAfter = null
      // Rows still being typed (refused or missing a field) stay in the sheet only: clear them like a person would.
      f.tick()
      await f.sync.run(true)
      const cult = f.ss.tab('Cultures')
      for (let i = cult.getLastRow(); i >= 2; i--) {
        const id = String(cult.get(i, cult.col('id')))
        if (!f.st.rows('cultures').some((x) => x.id === id)) cult.deleteRows(i, 1)
      }
      f.tick()
      await f.sync.run(true)
      f.tick()
      const quiet = await f.sync.run(true)
      expect(quiet, `seed ${seed}: a quiet sync changes nothing`).toMatchObject({ added: 0, changed: 0, deleted: 0, pushed: 0, removed: 0 })
      expectMirror(f)
      // Every culture still has a known strain and an allowed kind and status.
      for (const c of f.st.rows('cultures')) {
        expect(['bo', 'lm']).toContain(c.strain_id)
        expect(['plate', 'slant', 'liquid', 'water', 'cryo', 'spore_print', 'other']).toContain(c.kind)
        if (c.status !== null && c.status !== undefined) expect(STATUSES).toContain(c.status)
      }
      // The edit history rebuilds the cultures exactly (every write, from either side, is logged).
      const rebuilt = new Map<string, Row>()
      for (const e of historyOf(f.st)) {
        if (e.table_name !== 'cultures') continue
        if (e.op === 'delete') rebuilt.delete(e.row_id)
        else {
          const x: Row = e.op === 'create' ? { id: e.row_id } : { ...(rebuilt.get(e.row_id) ?? { id: e.row_id }) }
          for (const ch of e.changes) x[ch.f] = ch.new
          rebuilt.set(e.row_id, x)
        }
      }
      const norm = (x: Row) => JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k, v]) => k !== 'updated_at' && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b))))
      expect(new Set([...rebuilt.values()].map(norm)), `seed ${seed}: history replay`).toEqual(new Set(f.st.rows('cultures').map(norm)))
    }
  }, 120000)

  it('a big farm (5,000 records) syncs both ways', async () => {
    const f = await farm()
    const lots = Array.from({ length: 5000 }, (_, i) => ({ id: `L${i}`, lot_code: `B${10000 + i}`, strain_id: i % 2 ? 'bo' : 'lm', bag_count: 60, knock_date: '2026-11-01', status: 'incubating' }))
    await f.st.action('BIG', () => f.st.put('block_lots', lots))
    await f.sync.run()
    const bl = f.ss.tab('Block lots')
    expect(bl.dataRows()).toBe(5001)
    f.tick()
    typeInto(f.script, bl, bl.rowOf('L4321'), { status: 'fruiting' })
    f.tick()
    const rep = await f.sync.run()
    expect(rep.pulled).toBe(1)
    // Only that lot (its updated_at) and the new history line go back.
    expect(rep.pushed).toBe(2)
    expect(f.st.rows('block_lots').find((x) => x.id === 'L4321')!.status).toBe('fruiting')
  }, 60000)
})

describe('every table round trips through the sheet', () => {
  it('a record in every editable tab can be edited in the sheet and comes back the same', async () => {
    const f = await farm()
    await f.sync.run()
    // Edit one text-ish field of every row on every editable tab to the same value: nothing changes.
    for (const s of SHEET_TABLES) {
      if (s.readOnly) continue
      const sh = f.ss.getSheetByName(s.tab)
      if (!sh) continue
      for (let i = 2; i <= sh.getLastRow(); i++) script(f, sh, i)
    }
    f.tick()
    const rep = await f.sync.run()
    expect(rep).toMatchObject({ added: 0, changed: 0, deleted: 0 })
    expect(f.sync.state.notes).toEqual([])
    expectMirror(f)
  })
  function script(f: Awaited<ReturnType<typeof farm>>, sh: FakeSheet, row: number) {
    // Re-type every cell as it is (what a paste of the same block does).
    const vals: Record<string, never> = {}
    for (const h of sh.header()) if (h && h !== 'id' && h !== EDITED) vals[h] = sh.get(row, sh.col(h)) as never
    typeInto(f.script, sh, row, vals)
  }
  it('BACKUP_TABLES are all mirrored', () => {
    for (const t of BACKUP_TABLES) expect(SHEET_BY_TABLE.get(t)?.tab, t).toBeTruthy()
  })
})
