// Test helper: a pretend Google spreadsheet that runs the REAL sheets/Code.gs, so the tests cover both halves.
// Only the tests import this file.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Cell, PullResult, PushRequest, SheetClient } from './types'

type V = Cell | Date | null

class FakeRange {
  constructor(readonly sh: FakeSheet, readonly r: number, readonly c: number, readonly nr: number, readonly nc: number) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc}`)
    if (r + nr - 1 > sh.maxRows) throw new Error(`range past the last row (${r + nr - 1} > ${sh.maxRows})`)
  }
  getSheet() { return this.sh }
  getRow() { return this.r }
  getLastRow() { return this.r + this.nr - 1 }
  getValues(): V[][] {
    const out: V[][] = []
    for (let i = 0; i < this.nr; i++) {
      const row: V[] = []
      for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j))
      out.push(row)
    }
    return out
  }
  setValues(v: V[][]) {
    if (v.length !== this.nr || v.some((r) => r.length !== this.nc)) throw new Error('setValues size does not match the range')
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, v[i][j])
    return this
  }
  setValue(v: V) { this.sh.set(this.r, this.c, v); return this }
  setNumberFormat(f: string) { for (let j = 0; j < this.nc; j++) this.sh.formats.set(this.c + j, f); return this }
  setBackground() { return this }
  setFontWeight() { return this }
  setFontColor() { return this }
  setFontSize() { return this }
  setNote(n: string) { this.sh.notes.set(this.c, n); return this }
  setNotes(n: string[][]) { n[0].forEach((x, j) => this.sh.notes.set(this.c + j, x)); return this }
  setNumberFormats(f: string[][]) {
    if (f.length !== this.nr) throw new Error('setNumberFormats size does not match the range')
    f[0].forEach((x, j) => this.sh.formats.set(this.c + j, x))
    return this
  }
  setDataValidation(v: unknown) { this.sh.validation.set(this.c, v); return this }
  protect() { return new FakeProtection() }
}
class FakeProtection {
  setWarningOnly() { return this }
  setDescription() { return this }
}

export class FakeSheet {
  rows: V[][] = []
  maxRows = 1000
  formats = new Map<number, string>()
  notes = new Map<number, string>()
  validation = new Map<number, unknown>()
  constructor(public name: string) {}
  getName() { return this.name }
  get(r: number, c: number): V {
    const v = this.rows[r - 1]?.[c - 1]
    return v === undefined || v === null ? '' : v
  }
  set(r: number, c: number, v: V) {
    while (this.rows.length < r) this.rows.push([])
    const row = this.rows[r - 1]
    while (row.length < c) row.push('')
    // Like Sheets: a leading apostrophe is hidden (forces text) and not part of the value.
    row[c - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v ?? ''
  }
  getLastRow() {
    for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some((v) => v !== '' && v !== null)) return i
    return 0
  }
  getLastColumn() {
    let m = 0
    for (const r of this.rows) for (let j = r.length; j > m; j--) if (r[j - 1] !== '' && r[j - 1] !== null) { m = j; break }
    return m
  }
  getMaxRows() { return this.maxRows }
  insertRowsAfter(_after: number, n: number) { this.maxRows += n }
  getRange(r: number, c: number, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc) }
  deleteRows(start: number, n: number) {
    this.rows.splice(start - 1, n)
    this.maxRows -= n
  }
  setFrozenRows() {}
  setTabColor() {}
  protect() { return new FakeProtection() }
  clearContents() { this.rows = [] }

  // --- test helpers: what a person does ---
  header(): string[] { return (this.rows[0] ?? []).map((v) => String(v)) }
  col(name: string) { const i = this.header().indexOf(name); if (i < 0) throw new Error(`no column ${name} in ${this.name}`); return i + 1 }
  /** Sheet row number of a record. */
  rowOf(id: string) {
    const c = this.col('id')
    for (let i = 2; i <= this.rows.length; i++) if (this.get(i, c) === id) return i
    return 0
  }
  cell(id: string, name: string): V { return this.get(this.rowOf(id), this.col(name)) }
  dataRows() { return Math.max(0, this.getLastRow() - 1) }
}

export class FakeSpreadsheet {
  sheets: FakeSheet[] = []
  getName() { return 'MY/CO/L farm records' }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/fake/edit' }
  getSpreadsheetTimeZone() { return 'America/Costa_Rica' }
  getSheetByName(n: string) { return this.sheets.find((s) => s.name === n) ?? null }
  getSheets() { return this.sheets }
  insertSheet(n: string, i?: number) {
    const s = new FakeSheet(n)
    if (i === undefined) this.sheets.push(s)
    else this.sheets.splice(i, 0, s)
    return s
  }
  private active: FakeSheet | null = null
  setActiveSheet(s: FakeSheet) { this.active = s }
  moveActiveSheet(pos: number) {
    if (!this.active) return
    this.sheets = this.sheets.filter((s) => s !== this.active)
    this.sheets.splice(pos - 1, 0, this.active)
  }
  tab(n: string) { const s = this.getSheetByName(n); if (!s) throw new Error(`no tab ${n}`); return s }
}

const CODE = readFileSync(join(__dirname, '..', '..', '..', 'sheets', 'Code.gs'), 'utf8')

let uuidN = 0
/** Load the real sheet script against a fake spreadsheet. clock() is the Google server's time. */
export function loadScript(ss: FakeSpreadsheet, key: string, clock: () => Date = () => new Date()) {
  const Validation = () => {
    const b = { requireValueInList: () => b, requireCheckbox: () => b, setAllowInvalid: () => b, setHelpText: () => b, build: () => ({}) }
    return b
  }
  const SpreadsheetApp = { getActiveSpreadsheet: () => ss, newDataValidation: Validation }
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ s, setMimeType() { return this } }) }
  const LockService = { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) }
  const pad = (n: number) => String(n).padStart(2, '0')
  const Utilities = {
    getUuid: () => `sheet-${(++uuidN).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    // Costa Rica is UTC-6 all year.
    formatDate: (d: Date, _tz: string, f: string) => {
      const t = new Date(d.getTime() - 6 * 3600000)
      return f === 'yyyy-MM-dd' ? `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` : `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`
    },
  }
  // The script reads `new Date()` for its clock: give it the test clock.
  const RealDate = Date
  const FakeDate = function (this: unknown, ...a: unknown[]) {
    return a.length ? new (RealDate as unknown as new (...x: unknown[]) => Date)(...a) : new RealDate(clock().getTime())
  } as unknown as DateConstructor
  Object.defineProperty(FakeDate, "prototype", { value: RealDate.prototype })
  FakeDate.now = () => clock().getTime()
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  const src = CODE.replace('__MYCOL_KEY__', key)
  const make = new Function('SpreadsheetApp', 'ContentService', 'LockService', 'Utilities', 'Date', `${src}\nreturn { doPost: doPost, onEdit: onEdit, doGet: doGet };`)
  return make(SpreadsheetApp, ContentService, LockService, Utilities, FakeDate) as {
    doPost(e: { postData: { contents: string } }): { s: string }
    onEdit(e: { range: FakeRange }): void
    doGet(): { s: string }
  }
}

/** A SheetClient that calls the real script straight away (as the web app would), with JSON in between like the wire. */
export class ScriptClient implements SheetClient {
  calls = 0
  /** Signal drops after this many more calls. */
  dropAfter: number | null = null
  constructor(readonly script: ReturnType<typeof loadScript>, readonly key: string) {}
  private call<T>(op: string, body: object = {}): T {
    this.calls++
    if (this.dropAfter !== null && this.dropAfter-- <= 0) {
      this.dropAfter = null
      throw new Error('NO SIGNAL')
    }
    const out = JSON.parse(this.script.doPost({ postData: { contents: JSON.stringify({ key: this.key, op, ...body }) } }).s)
    if (out.error) throw new Error(`GOOGLE SHEET: ${out.error}`)
    return out as T
  }
  async hello() { return this.call<{ version: number; sheet: string }>('hello') }
  async pull(req: { since: string | null; full: boolean; tabs: string[] }) { return this.call<PullResult>('pull', req) }
  async push(req: PushRequest) { return this.call<{ now: string; written: number }>('push', req) }
}

/** A person typing into the sheet: sets the cells, then the sheet runs onEdit like Google does. */
export function typeInto(script: ReturnType<typeof loadScript>, sh: FakeSheet, row: number, values: Record<string, V>) {
  let lo = Infinity
  let hi = 0
  for (const [k, v] of Object.entries(values)) {
    const c = sh.col(k)
    sh.set(row, c, v)
    lo = Math.min(lo, c)
    hi = Math.max(hi, c)
  }
  script.onEdit({ range: sh.getRange(row, lo, 1, hi - lo + 1) })
}
