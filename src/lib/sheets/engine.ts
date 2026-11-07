// Two-way sync between the Store and the Google Sheet (see docs/GOOGLE-SHEET.md).
//
// One run:
//   1. PULL the rows people edited in the sheet since the last run (all ids too on a full check).
//   2. APPLY those edits to the app as ONE action: one UNDO step, signed GOOGLE SHEET in HISTORY.
//   3. PUSH what changed in the app since the last run, put back anything the sheet must not change,
//      and remove rows of records deleted in the app.
//   4. Remember what both sides now show (the BASE) and the sheet's clock (the CURSOR).
//
// The base is kept in cell form per column, so "changed" always means "the sheet would show something else".
// Conflict rule (same as the offline queue): a field only one side changed takes that side's value; a field
// both changed takes the later change (sheet edit time against the app's edit history), and is listed.

import { BACKUP_TABLES, type Row, type Store } from '../store'
import { SPECIES } from '../../data/species'
import { cellKey, fromCell, toCell } from './convert'
import { ACTION, DELETE_WORDS, EDITED, SHEET_TABLES, specOf, tabColumns, tabName, type SheetTable } from './schema'
import type { Cell, PullResult, PulledRow, PushRequest, PushTab, SheetClient, SheetColumn } from './types'

export type Base = Record<string, Record<string, Record<string, Cell>>>

export interface SyncNote {
  at: string
  kind: 'conflict' | 'refused' | 'put_back' | 'deleted_in_app' | 'needs' | 'restored_row'
  table: string
  id: string
  field?: string
  sheet?: string
  app?: string
  winner?: 'sheet' | 'app'
  text: string
}

export interface SyncState {
  cursor: string | null
  base: Base
  lastFull: string | null
  lastRun: SyncReport | null
  notes: SyncNote[]
}

export interface StateStore {
  load(): Promise<SyncState | null>
  save(s: SyncState): Promise<void>
}

export interface SyncOptions {
  /** Mirror the sensor readings tab (it grows by thousands of lines a day). GUESS: off. */
  readings: boolean
  /** Days of sensor readings kept in the sheet. GUESS: 14. */
  readingDays: number
  /** Newest edit history lines kept in the sheet. GUESS: 5000. */
  historyMax: number
  /** A full check (every id, rows deleted in the sheet put back) at least this often. GUESS: 60 min. */
  fullEveryMin: number
}
export const SYNC_DEFAULTS: SyncOptions = { readings: false, readingDays: 14, historyMax: 5000, fullEveryMin: 60 }

export interface SyncReport {
  at: string
  full: boolean
  pulled: number
  added: number
  changed: number
  deleted: number
  pushed: number
  removed: number
  notes: number
  ms: number
}

/** How many notes the screen keeps. */
export const NOTES_KEPT = 200
export const SHEET_WHO = 'GOOGLE SHEET'

export const emptyState = (): SyncState => ({ cursor: null, base: {}, lastFull: null, lastRun: null, notes: [] })

/** The tables this run mirrors. */
function tablesFor(o: SyncOptions): SheetTable[] {
  return SHEET_TABLES.filter((s) => s.table !== 'sensor_readings' || o.readings)
}

/** Rows of a table as the sheet holds them (the edit history and readings are cut to a window). */
function rowsFor(store: Store, table: string, o: SyncOptions, now: Date): Row[] {
  const rows = store.rows(table)
  if (table === 'edit_log') {
    if (rows.length <= o.historyMax) return rows
    return [...rows].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, o.historyMax)
  }
  if (table === 'sensor_readings') {
    const from = new Date(now.getTime() - o.readingDays * 86400000).toISOString()
    return rows.filter((r) => String(r.taken_at ?? '') >= from)
  }
  return rows
}

const LINK_KEY = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : s === null || s === undefined ? '' : String(s).toLowerCase())
const SPECIES_NAME = new Map(SPECIES.map((s) => [s.id, s.name]))

export class SheetSync {
  state: SyncState = emptyState()
  private loaded = false
  running = false

  constructor(
    readonly store: Store,
    readonly client: SheetClient,
    readonly saved: StateStore,
    public opts: SyncOptions = SYNC_DEFAULTS,
    readonly clock: () => Date = () => new Date(),
  ) {}

  async init(): Promise<SyncState> {
    if (!this.loaded) {
      this.state = (await this.saved.load()) ?? emptyState()
      this.loaded = true
    }
    return this.state
  }

  /** Forget what was synced (a new sheet): the next run writes everything again. */
  async reset() {
    this.state = emptyState()
    this.loaded = true
    await this.saved.save(this.state)
  }

  /** One sync. full = also check every id (rows deleted in the sheet are put back). */
  async run(force = false): Promise<SyncReport> {
    if (this.running) throw new Error('A SYNC IS ALREADY RUNNING.')
    if (this.store.isDenied('cash_moves')) throw new Error('ONLY THE OWNER CAN SYNC THE GOOGLE SHEET.')
    if (this.store.placeholder || this.store.backend.kind === 'locked') throw new Error('THE RECORDS ARE NOT OPEN YET. TRY AGAIN IN A MOMENT.')
    this.running = true
    const t0 = Date.now()
    try {
      await this.init()
      const now = this.clock()
      const st = this.state
      const tables = tablesFor(this.opts)
      for (const s of tables) await this.store.ensure(s.table)
      await this.store.ensure('edit_log')
      const full =
        force || !st.cursor || !st.lastFull || now.getTime() - Date.parse(st.lastFull) >= this.opts.fullEveryMin * 60000
      const pull = await this.client.pull({ since: full ? null : st.cursor, full, tabs: tables.map((s) => s.tab) })
      const notes: SyncNote[] = []
      const applied = await this.apply(pull, tables, notes, now)
      const { req, removed, pushed, nextBase } = this.plan(pull, tables, full, notes, now)
      await this.client.push(req)
      const report: SyncReport = {
        at: now.toISOString(),
        full,
        pulled: Object.values(pull.tabs).reduce((n, t) => n + t.rows.length, 0),
        ...applied,
        pushed,
        removed,
        notes: notes.length,
        ms: Date.now() - t0,
      }
      this.state = {
        cursor: pull.now,
        base: nextBase,
        lastFull: full ? now.toISOString() : st.lastFull,
        lastRun: report,
        notes: [...notes, ...st.notes].slice(0, NOTES_KEPT),
      }
      await this.saved.save(this.state)
      return report
    } finally {
      this.running = false
    }
  }

  // ---------- 1+2: sheet edits into the app ----------

  /** When the app last changed this field (edit history), or '' if it never did. */
  private appTimes: Map<string, { at: string; fields: Set<string> | null }[]> | null = null
  private appTime(table: string, id: string, field: string, row: Row | undefined): string {
    if (!this.appTimes) {
      this.appTimes = new Map()
      for (const e of this.store.rows('edit_log')) {
        const k = `${e.table_name}|${e.row_id}`
        const l = this.appTimes.get(k) ?? []
        const ch = Array.isArray(e.changes) ? (e.changes as { f: string }[]) : []
        l.push({ at: String(e.at ?? ''), fields: e.op === 'update' ? new Set(ch.map((c) => c.f)) : null })
        this.appTimes.set(k, l)
      }
    }
    let best = ''
    for (const x of this.appTimes.get(`${table}|${id}`) ?? []) if ((!x.fields || x.fields.has(field)) && x.at > best) best = x.at
    return best || String(row?.updated_at ?? '')
  }

  private lookups = new Map<string, { byId: Map<string, Row>; byPick: Map<string, string> }>()
  private lookup(ref: string, pick: string) {
    const k = `${ref}.${pick}`
    let l = this.lookups.get(k)
    if (!l) {
      const rows = this.store.rows(ref)
      l = { byId: new Map(rows.map((r) => [r.id, r])), byPick: new Map() }
      for (const r of rows) {
        const key = LINK_KEY(r[pick])
        if (key && !l.byPick.has(key)) l.byPick.set(key, r.id)
      }
      this.lookups.set(k, l)
    }
    return l
  }

  /** The cells the sheet should show for one record. */
  cellsOf(_table: string, row: Row, cols: SheetColumn[]): Record<string, Cell> {
    const out: Record<string, Cell> = {}
    for (const c of cols) {
      if (c.name === ACTION || c.name === EDITED) continue
      if (c.link) {
        const fk = row[c.link.fk]
        const hit = typeof fk === 'string' ? this.lookup(c.link.ref, c.link.pick).byId.get(fk) : undefined
        out[c.name] = hit ? toCell(hit[c.link.pick], { kind: 'text' }) : ''
      } else if (c.name === 'species_name' && !(c.name in row)) {
        const k = row.species_key
        out[c.name] = typeof k === 'string' ? SPECIES_NAME.get(k) ?? k : ''
      } else out[c.name] = toCell(row[c.name], c)
    }
    return out
  }

  private async apply(pull: PullResult, tables: SheetTable[], notes: SyncNote[], now: Date) {
    this.appTimes = null
    this.lookups.clear()
    const at = now.toISOString()
    const puts = new Map<string, Row[]>()
    const dels = new Map<string, string[]>()
    let added = 0
    let changed = 0
    let deleted = 0
    for (const s of tables) {
      const got = pull.tabs[s.tab]
      if (!got?.rows.length || s.readOnly) continue
      const live = new Map(this.store.rows(s.table).map((r) => [r.id, r]))
      const cols = tabColumns(s.table, [...live.values()])
      const editable = cols.filter((c) => !c.ro && c.name !== ACTION)
      const base = this.state.base[s.table] ?? {}
      for (const r of got.rows) {
        if (!r.id) continue
        const app = live.get(r.id)
        const b = base[r.id]
        const act = cellKey(r.cells[ACTION]).trim().toUpperCase()
        if (DELETE_WORDS.has(act)) {
          if (app) {
            dels.set(s.table, [...(dels.get(s.table) ?? []), r.id])
            deleted++
          }
          continue
        }
        if (!app && b) {
          // Deleted in the app since the last sync. The app's delete wins; HISTORY > RESTORE brings it back.
          if (editable.some((c) => c.name in r.cells && cellKey(r.cells[c.name]) !== cellKey(b[c.name])))
            notes.push({ at, kind: 'deleted_in_app', table: s.table, id: r.id, text: `${tabName(s.table)}: A SHEET EDIT TO A RECORD DELETED IN THE APP WAS NOT KEPT. HISTORY > RESTORE CAN BRING THE RECORD BACK.` })
          continue
        }
        // No base but the app has the record (the sync was reset, or a new sheet): the app's copy wins.
        if (app && !b) continue
        const appCells = app ? this.cellsOf(s.table, app, cols) : null
        const patch: Row = { id: r.id }
        let any = false
        let bad = false
        for (const c of editable) {
          if (!(c.name in r.cells)) continue
          const sv = r.cells[c.name]
          const was = b ? b[c.name] : ''
          if (cellKey(sv) === cellKey(was)) continue // the sheet did not change it
          if (appCells && cellKey(appCells[c.name]) !== cellKey(b[c.name])) {
            if (cellKey(appCells[c.name]) === cellKey(sv)) continue // both made the same change
            const field = c.link ? c.link.fk : c.name
            const appAt = this.appTime(s.table, r.id, field, app)
            const sheetWins = (r.edited_at || '') > appAt
            notes.push({
              at,
              kind: 'conflict',
              table: s.table,
              id: r.id,
              field: c.name,
              sheet: cellKey(sv),
              app: cellKey(appCells[c.name]),
              winner: sheetWins ? 'sheet' : 'app',
              text: `${tabName(s.table)} ${c.name}: CHANGED IN BOTH. ${sheetWins ? 'THE SHEET' : 'THE APP'} CHANGED IT LAST, SO ITS VALUE WAS KEPT.`,
            })
            if (!sheetWins) continue
          }
          const val = this.readCell(s.table, c, sv, live)
          if (!val.ok) {
            notes.push({ at, kind: 'refused', table: s.table, id: r.id, field: c.name, sheet: cellKey(sv), text: `${tabName(s.table)} ${c.name}: "${cellKey(sv).slice(0, 40)}" ${val.error}. THE APP VALUE WAS PUT BACK.` })
            if (!app) bad = true
            continue
          }
          if (val.value === null && specOf(s.table, val.field, []).required && app) {
            notes.push({ at, kind: 'refused', table: s.table, id: r.id, field: c.name, text: `${tabName(s.table)} ${c.name}: CANNOT BE EMPTY. THE APP VALUE WAS PUT BACK.` })
            continue
          }
          if (val.value === null && !app) continue
          patch[val.field] = val.value
          any = true
        }
        if (!app) {
          if (bad || !any) continue
          const missing = editable.filter((c) => !c.link && specOf(s.table, c.name, []).required && (patch[c.name] === undefined || patch[c.name] === null)).map((c) => c.name)
          if (missing.length) {
            notes.push({ at, kind: 'needs', table: s.table, id: r.id, text: `${tabName(s.table)}: NEW ROW NOT SAVED YET. IT STILL NEEDS ${missing.join(', ')}.` })
            continue
          }
          puts.set(s.table, [...(puts.get(s.table) ?? []), patch])
          added++
        } else if (any) {
          puts.set(s.table, [...(puts.get(s.table) ?? []), patch])
          changed++
        }
      }
    }
    if (puts.size || dels.size) {
      const bits = [added && `${added} ADDED`, changed && `${changed} CHANGED`, deleted && `${deleted} DELETED`].filter(Boolean).join(', ')
      const who = this.store.who
      this.store.who = SHEET_WHO
      try {
        await this.store.action(`GOOGLE SHEET EDITS: ${bits}`, async () => {
          // Parents before children for adds; children before parents for deletes.
          for (const t of [...BACKUP_TABLES, 'sensor_readings']) {
            const p = puts.get(t)
            if (p?.length) await this.store.put(t, p)
          }
          for (const t of [...BACKUP_TABLES, 'sensor_readings'].reverse()) {
            const d = dels.get(t)
            if (d?.length) await this.store.del(t, d)
          }
        }, { via: 'sheet' })
      } finally {
        this.store.who = who
      }
    }
    return { added, changed, deleted }
  }

  /** One sheet cell back into a field value. A look-up column finds the record its code names. */
  private readCell(table: string, c: SheetColumn, sv: Cell, live: Map<string, Row>): { ok: true; field: string; value: unknown } | { ok: false; error: string } {
    if (c.link) {
      const key = LINK_KEY(cellKey(sv))
      if (!key) return { ok: true, field: c.link.fk, value: null }
      const id = this.lookup(c.link.ref, c.link.pick).byPick.get(key)
      if (!id) return { ok: false, error: `IS NOT IN ${tabName(c.link.ref).toUpperCase()}` }
      return { ok: true, field: c.link.fk, value: id }
    }
    const spec = specOf(table, c.name, [...live.values()])
    const p = fromCell(sv, spec)
    return p.ok ? { ok: true, field: c.name, value: p.value } : { ok: false, error: p.error }
  }

  // ---------- 3+4: app changes out to the sheet ----------

  private plan(pull: PullResult, tables: SheetTable[], full: boolean, notes: SyncNote[], now: Date) {
    this.lookups.clear()
    const at = now.toISOString()
    const req: PushRequest = { tabs: {}, readme: [] }
    const nextBase: Base = {}
    let pushed = 0
    let removed = 0
    const counts: { s: SheetTable; n: number }[] = []
    for (const s of tables) {
      const rows = rowsFor(this.store, s.table, this.opts, now)
      const cols = tabColumns(s.table, rows)
      const base = this.state.base[s.table] ?? {}
      const got = pull.tabs[s.tab]
      const seen = new Map<string, PulledRow>((got?.rows ?? []).map((r) => [r.id, r]))
      const inSheet = full && got?.ids ? new Set(got.ids) : null
      const tab: PushTab = { columns: cols, upserts: [], deletes: [], color: s.color, order: s.order }
      const nb: Record<string, Record<string, Cell>> = {}
      const keep = new Set<string>()
      for (const r of rows) {
        keep.add(r.id)
        const cur = this.cellsOf(s.table, r, cols)
        nb[r.id] = cur
        const b = base[r.id]
        const sheet = seen.get(r.id)
        const gone = !!(inSheet && !inSheet.has(r.id))
        if (gone && b) notes.push({ at, kind: 'restored_row', table: s.table, id: r.id, text: `${tabName(s.table)}: A ROW WAS DELETED IN THE SHEET. THE RECORD IS STILL IN THE APP, SO THE ROW WAS PUT BACK. TYPE DELETE IN ITS ACTION CELL TO DELETE IT.` })
        if (!b || gone) {
          tab.upserts.push({ id: r.id, cells: { ...cur, ...(s.readOnly ? {} : { [ACTION]: '' }) } })
          continue
        }
        const cells: Record<string, Cell> = {}
        for (const [k, v] of Object.entries(cur)) {
          const differsFromBase = cellKey(v) !== cellKey(b[k])
          const sheetDiffers = sheet && k in sheet.cells && cellKey(sheet.cells[k]) !== cellKey(v)
          if (differsFromBase || sheetDiffers) cells[k] = v
        }
        if (sheet && cellKey(sheet.cells[ACTION]) !== '') cells[ACTION] = ''
        if (Object.keys(cells).length) tab.upserts.push({ id: r.id, cells, fill: s.readOnly ? cur : { ...cur, [ACTION]: '' } })
      }
      for (const id of Object.keys(base)) if (!keep.has(id)) tab.deletes.push(id)
      // A row typed with DELETE that the app never had: clear it from the sheet too.
      for (const r of got?.rows ?? []) {
        if (!keep.has(r.id) && !(r.id in base) && DELETE_WORDS.has(cellKey(r.cells[ACTION]).trim().toUpperCase())) tab.deletes.push(r.id)
      }
      pushed += tab.upserts.length
      removed += tab.deletes.length
      req.tabs[s.tab] = tab
      nextBase[s.table] = nb
      counts.push({ s, n: rows.length })
    }
    req.readme = readme(counts, now, this.opts)
    return { req, pushed, removed, nextBase }
  }
}

/** The READ ME tab: what is where, and the editing rules. */
export function readme(counts: { s: SheetTable; n: number }[], now: Date, o: SyncOptions): Cell[][] {
  const out: Cell[][] = [
    ['MY/CO/L FARM RECORDS', '', '', ''],
    [`Last sync from the app: ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC (farm clock is UTC-6).`, '', '', ''],
    ['', '', '', ''],
    ['HOW TO EDIT', '', '', ''],
    ['1. Change any white cell. The app picks it up within 5 minutes, or press SYNC NOW in DATA > GOOGLE SHEET.', '', '', ''],
    ['2. Add a record by typing in the first empty row of a tab. The sheet gives it an id by itself.', '', '', ''],
    ['3. Delete a record by typing DELETE in its _action cell. Deleting the row itself does NOT delete it: the app puts the row back.', '', '', ''],
    ['4. To point at another record, type its code in the look-up column (strain_code, lot_code, item_name). The app finds the id.', '', '', ''],
    ['5. Grey cells and grey tabs are read only. A change there is put back. Exchange rates are changed only in the app: every money record keeps its own day\'s rate.', '', '', ''],
    ['6. A value that does not fit (letters in a number column, a choice not on the list) is refused and listed in the app. Each sync\'s sheet edits are one UNDO step in the app.', '', '', ''],
    ['7. Dates are yyyy-mm-dd. Times are UTC. Money is in colones (₡) as stored; US$ is worked out from each record\'s own day.', '', '', ''],
    ['', '', '', ''],
    ['TAB', 'GROUP', 'RECORDS', 'EDIT?'],
  ]
  for (const { s, n } of counts) out.push([s.tab, s.group, n, s.readOnly ? 'READ ONLY' : 'YES'])
  if (!o.readings) out.push(['Sensor readings', 'CLIMATE', 'not mirrored', 'switch on in the app'])
  return out
}
