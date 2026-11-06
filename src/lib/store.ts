// MY/CO/L data store: one small layer every module reuses.
//
// Rows are plain objects named after the database tables in supabase/migrations
// (items, stock_moves, cultures, ...). Each row has a string `id`.
//
// - LOCAL MODE (Supabase not linked): rows are saved in this browser's IndexedDB.
//   JSON export and import make backups and carry the data to Supabase later.
// - LINKED MODE: the same calls go to Supabase. Row level security (0002
//   migration) lets only the owner's login read or write.
//
// Screens never talk to a backend. They call the Store, which keeps an
// in-memory copy so React can re-draw instantly, then writes through.

import { autoLabel, diffRow, same, SUMMARY_OVER, type EditEntry, type EditOp, type EditVia } from './history'

export type Row = { id: string } & Record<string, unknown>

/** Tables the backup file carries, in an order that satisfies foreign keys.
 *  sensor_readings is left out on purpose: it grows without limit. */
export const BACKUP_TABLES = [
  'species', 'strains', 'cultures', 'rooms', 'circuits', 'equipment', 'cook_runs', 'cook_readings',
  'grain_runs', 'block_lots', 'contaminants', 'lot_losses', 'hazard_logs', 'harvests', 'sales', 'sale_lots',
  'items', 'item_prices', 'stock_moves', 'energy_bills', 'labour_entries', 'reference_entries', 'app_settings', 'fx_rates',
  'bank_tests', 'viability_checks', 'strain_trials', 'flush_log', 'photos',
  'edit_log',
] as const

/** Edit history table (see src/lib/history.ts). Written by the Store itself, never journaled. */
export const EDIT_LOG = 'edit_log'

/** Delete order is the reverse, so children go before parents. */
export const BACKUP_FORMAT = 1

export interface Backend {
  readonly kind: 'local' | 'remote' | 'memory' | 'locked'
  /** True when the last load could not reach the database and used the saved copy. Writes are refused. */
  stale: boolean
  /** A human sentence about why the backend is degraded, if it is. */
  note?: string
  load(table: string): Promise<Row[]>
  /** base = each record before this change (null = new). The offline queue uses it to spot conflicts. */
  put(table: string, rows: Row[], base?: Map<string, Row | null>): Promise<void>
  del(table: string, ids: string[], base?: Map<string, Row | null>): Promise<void>
  /** The backend changed rows on its own (a sync merge). The Store copies them in. */
  onChange?: (table: string, put: Row[], removed: string[]) => void
  /** Sync state changed (lamp). */
  onStatus?: () => void
}

/** Plain in-memory backend. Used by tests, and as the fallback when the browser blocks storage. */
export class MemoryBackend implements Backend {
  readonly kind: 'memory' | 'locked'
  stale = false
  note?: string
  private t = new Map<string, Map<string, Row>>()
  constructor(kind: 'memory' | 'locked' = 'memory', note?: string) {
    this.kind = kind
    this.note = note
  }
  async load(table: string) {
    return [...(this.t.get(table)?.values() ?? [])].map((r) => ({ ...r }))
  }
  async put(table: string, rows: Row[]) {
    if (this.kind === 'locked') throw new Error('DATABASE LOCKED. LOGIN FIRST.')
    const m = this.t.get(table) ?? new Map<string, Row>()
    for (const r of rows) m.set(r.id, { ...r })
    this.t.set(table, m)
  }
  async del(table: string, ids: string[]) {
    if (this.kind === 'locked') throw new Error('DATABASE LOCKED. LOGIN FIRST.')
    for (const id of ids) this.t.get(table)?.delete(id)
  }
}

export type StoreStatus = 'loading' | 'ready' | 'stale' | 'locked' | 'error'

export function uuid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c?.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const EMPTY: Row[] = []

export class Store {
  readonly backend: Backend
  private data = new Map<string, Row[]>()
  private loading = new Map<string, Promise<void>>()
  private listeners = new Set<() => void>()
  private ver = 0
  error: string | null = null

  /** Who is making changes, for the history (login email, or the operator name in local mode). */
  who = 'OWNER'
  /** The screen on show, for the history. */
  screen: string | null = null

  constructor(backend: Backend) {
    this.backend = backend
    backend.onChange = (table, put, removed) => {
      const have = this.data.get(table)
      if (!have) return
      const m = new Map(have.map((r) => [r.id, r]))
      for (const r of put) m.set(r.id, { ...(m.get(r.id) ?? {}), ...r })
      for (const id of removed) m.delete(id)
      this.data.set(table, [...m.values()])
      this.bump()
    }
    backend.onStatus = () => this.bump()
  }

  get status(): StoreStatus {
    if (this.backend.kind === 'locked') return 'locked'
    if (this.error) return 'error'
    if (this.backend.stale) return 'stale'
    return this.loading.size ? 'loading' : 'ready'
  }

  // --- React hooks use these two (useSyncExternalStore) ---
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  version = () => this.ver

  /** Tell the screens something changed (operator name, lamp). */
  touch() {
    this.bump()
  }

  private bump() {
    this.ver++
    for (const l of this.listeners) l()
  }

  /** Rows of a table. Returns the same array until the table changes. Triggers a load the first time. */
  rows<T extends Row = Row>(table: string): T[] {
    const have = this.data.get(table)
    if (!have) {
      void this.ensure(table)
      return EMPTY as T[]
    }
    return have as T[]
  }

  ensure(table: string): Promise<void> {
    if (this.data.has(table)) return Promise.resolve()
    let p = this.loading.get(table)
    if (!p) {
      p = this.backend
        .load(table)
        .then((rows) => {
          this.data.set(table, rows)
          this.error = null
        })
        .catch((e) => {
          this.data.set(table, [])
          this.error = e instanceof Error ? e.message : String(e)
        })
        .finally(() => {
          this.loading.delete(table)
          this.bump()
        })
      this.loading.set(table, p)
      queueMicrotask(() => this.bump()) // never notify while a screen is rendering
    }
    return p
  }

  private writable() {
    if (this.backend.kind === 'locked') throw new Error('DATABASE LOCKED. LOGIN FIRST.')
  }

  /** Insert or update rows by id (fields not given are kept). Updates the screen first, rolls back if the write fails. */
  put(table: string, input: Row | Row[], opts?: BackgroundWrite): Promise<void> {
    return this.write(table, input, false, opts)
  }

  private async write(table: string, input: Row | Row[], replace: boolean, opts?: BackgroundWrite): Promise<void> {
    this.writable()
    await this.ensure(table)
    const rows = Array.isArray(input) ? input : [input]
    if (!rows.length) return
    const now = new Date().toISOString()
    const before = this.data.get(table) ?? []
    const byId = new Map(before.map((r) => [r.id, r]))
    const base = new Map(rows.map((r) => [r.id, byId.get(r.id) ?? null]))
    // Tables that carry updated_at get it refreshed (Supabase does the same with a trigger).
    const stamped = rows.map((r) => ('updated_at' in r || 'updated_at' in (byId.get(r.id) ?? {}) ? { ...r, updated_at: now } : r)) as Row[]
    for (const r of stamped) byId.set(r.id, replace ? r : { ...(byId.get(r.id) ?? {}), ...r })
    this.data.set(table, [...byId.values()])
    this.bump()
    const after = stamped.map((r) => byId.get(r.id)!)
    try {
      await this.backend.put(table, after, base)
    } catch (e) {
      this.data.set(table, before)
      this.bump()
      throw e
    }
    this.journal(table, after.map((a) => ({ before: base.get(a.id) ?? null, after: a })), opts)
  }

  async del(table: string, ids: string | string[], opts?: BackgroundWrite): Promise<void> {
    this.writable()
    await this.ensure(table)
    const list = Array.isArray(ids) ? ids : [ids]
    if (!list.length) return
    const before = this.data.get(table) ?? []
    const gone = new Set(list)
    const base = new Map<string, Row | null>(list.map((id) => [id, before.find((r) => r.id === id) ?? null]))
    this.data.set(table, before.filter((r) => !gone.has(r.id)))
    this.bump()
    try {
      await this.backend.del(table, list, base)
    } catch (e) {
      this.data.set(table, before)
      this.bump()
      throw e
    }
    this.journal(table, list.flatMap((id) => (base.get(id) ? [{ before: base.get(id)!, after: null }] : [])), opts)
  }

  /** Re-read a table from the backend (after a sync, or to pick up another device's changes). */
  async refresh(table: string): Promise<void> {
    if (!this.data.has(table)) return this.ensure(table)
    try {
      this.data.set(table, await this.backend.load(table))
      this.error = null
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
    this.bump()
  }

  // ---------- actions, undo and edit history ----------

  private cur: Action | null = null
  private lastAuto: { a: Action; t: number } | null = null
  private undoStack: Action[] = []

  /**
   * Run several writes as ONE action: one UNDO step and one label in the history.
   * label null = take the label from fn's return value if it is text (the screens' messages).
   */
  async action<T>(label: string | null, fn: () => Promise<T>, opts: { undoable?: boolean; via?: EditVia } = {}): Promise<T> {
    if (this.cur) return fn() // already inside one: join it
    const a = newAction(label ?? '', this.screen, opts.via ?? 'edit', opts.undoable ?? true)
    this.cur = a
    this.lastAuto = null
    let out: T
    try {
      out = await fn()
      if (!label && typeof out === 'string') a.label = out
    } finally {
      this.cur = null
      if (!a.label) a.label = autoLabel(a.changes.map(changeOp))
      await this.writeLog(a, a.changes)
    }
    return out
  }

  /** Writes made outside action() are grouped if they come within this many ms of each other. */
  static GROUP_MS = 700

  private journal(table: string, list: { before: Row | null; after: Row | null }[], bg?: BackgroundWrite) {
    if (table === EDIT_LOG || !list.length) return
    const changes: Change[] = list.filter((c) => c.before !== null || c.after !== null).map((c) => ({ table, ...c }))
    if (!changes.length) return
    if (bg) {
      // The app writing on its own (a fetched exchange rate): logged, never mixed into the user's UNDO.
      const a = newAction(bg.label, null, 'system', false)
      a.changes.push(...changes)
      void this.writeLog(a, changes, 'APP')
      return
    }
    let a = this.cur
    if (!a) {
      const now = Date.now()
      if (this.lastAuto && now - this.lastAuto.t < Store.GROUP_MS) a = this.lastAuto.a
      else a = newAction('', this.screen, 'edit', true)
      this.lastAuto = { a, t: now }
      a.changes.push(...changes)
      a.label = autoLabel(a.changes.map(changeOp))
      this.pushUndo(a)
      void this.writeLog(a, changes)
      return
    }
    a.changes.push(...changes)
    this.pushUndo(a)
  }

  private pushUndo(a: Action) {
    if (!a.undoable || this.undoStack.includes(a)) return
    this.undoStack.push(a)
    if (this.undoStack.length > Store.UNDO_DEPTH) this.undoStack.shift()
    this.bump()
  }
  static UNDO_DEPTH = 40

  /** The newest action UNDO would reverse. */
  undoPeek(): { label: string; screen: string | null; at: string; count: number } | null {
    const a = this.undoStack[this.undoStack.length - 1]
    return a ? { label: a.label, screen: a.screen, at: a.at, count: a.changes.length } : null
  }
  undoList(): { id: string; label: string; screen: string | null; at: string; count: number }[] {
    return [...this.undoStack].reverse().map((a) => ({ id: a.id, label: a.label, screen: a.screen, at: a.at, count: a.changes.length }))
  }

  /**
   * Reverse the newest action. A field someone changed again since is left alone, so UNDO never
   * wipes a later edit. Returns the label undone, or null when there is nothing to undo.
   */
  async undo(): Promise<string | null> {
    this.writable()
    const a = this.undoStack.pop()
    if (!a) return null
    this.bump()
    try {
      await this.action(`UNDO ${a.label}`, () => this.reverse(a.changes), { undoable: false, via: 'undo' })
    } catch (e) {
      this.undoStack.push(a)
      this.bump()
      throw e
    }
    return a.label
  }

  private async reverse(changes: Change[]) {
    // Newest first, so children are removed before parents and parents come back before children.
    let i = changes.length - 1
    while (i >= 0) {
      const table = changes[i].table
      await this.ensure(table)
      // Work out where each record should end up, then write once. A record can appear more than
      // once in one action (added, then edited), so changes are applied to a plan, newest first.
      const plan = new Map<string, Row | null>()
      const live = new Map(this.rows(table).map((r) => [r.id, r]))
      for (; i >= 0 && changes[i].table === table; i--) {
        const c = changes[i]
        const id = (c.after ?? c.before)!.id
        const cur = plan.has(id) ? plan.get(id) ?? null : live.get(id) ?? null
        let next: Row | null
        if (!c.before) next = null
        else if (!cur) next = c.before
        else if (!c.after) next = cur
        else {
          next = { ...cur }
          for (const f of new Set([...Object.keys(c.before), ...Object.keys(c.after)])) {
            if (f === 'id' || f === 'updated_at') continue
            if (same(cur[f], c.after[f])) next[f] = c.before[f] ?? null
          }
        }
        plan.set(id, next)
      }
      const dels = [...plan].filter(([id, r]) => !r && live.has(id)).map(([id]) => id)
      const puts = [...plan.values()].filter((r): r is Row => !!r && !same(r, live.get(r.id)))
      if (dels.length) await this.del(table, dels)
      if (puts.length) await this.write(table, puts, true)
    }
  }

  /** Put old values back from a history entry: a deleted record, or some fields of an edit. */
  async restore(e: EditEntry): Promise<string> {
    const what = `${e.label}`.slice(0, 40)
    return this.action(`RESTORE ${what}`, async () => {
      await this.ensure(e.table_name)
      const cur = this.rows(e.table_name).find((r) => r.id === e.row_id) ?? null
      if (e.op === 'delete') {
        if (cur) throw new Error('THAT RECORD IS ALREADY BACK.')
        if (!e.snapshot) throw new Error('NO COPY OF THAT RECORD WAS KEPT.')
        await this.write(e.table_name, e.snapshot, true)
        return 'RECORD RESTORED'
      }
      if (e.op === 'create') {
        if (!cur) throw new Error('THAT RECORD IS ALREADY GONE.')
        await this.del(e.table_name, e.row_id)
        return 'RECORD REMOVED'
      }
      if (!cur) throw new Error('THAT RECORD WAS DELETED. RESTORE THE DELETE FIRST.')
      const patch: Row = { id: e.row_id }
      for (const c of e.changes) patch[c.f] = c.old
      await this.write(e.table_name, { ...cur, ...patch }, true)
      return 'OLD VALUES PUT BACK'
    }, { via: 'restore' })
  }

  private async writeLog(a: Action, changes: Change[], who = this.who) {
    if (!changes.length) return
    const rows: EditEntry[] = []
    const byTable = new Map<string, Change[]>()
    for (const c of changes) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])
    for (const [table, list] of byTable) {
      if (list.length > SUMMARY_OVER) {
        rows.push(entry(a, who, table, '*', 'update', [{ f: 'records', old: null, new: list.length }], null))
        continue
      }
      for (const c of list) {
        const op = changeOp(c).op
        const diff = op === 'delete' ? [] : diffRow(c.before, c.after)
        // A write that changed nothing (re-importing the same backup) leaves no history line.
        if (op === 'update' && !diff.length) continue
        rows.push(entry(a, who, table, (c.after ?? c.before)!.id, op, diff, op === 'delete' ? c.before : null))
      }
    }
    if (!rows.length) return
    // Keep the screen's copy current if the HISTORY screen has it open; then save.
    await this.loading.get(EDIT_LOG)?.catch(() => undefined)
    const have = this.data.get(EDIT_LOG)
    if (have) {
      this.data.set(EDIT_LOG, [...have, ...rows])
      this.bump()
    }
    try {
      await this.backend.put(EDIT_LOG, rows)
    } catch {
      // History must never block real work. A locked or failing log is skipped.
    }
  }

  // ---------- backup ----------

  async exportJson(): Promise<string> {
    const tables: Record<string, Row[]> = {}
    for (const t of BACKUP_TABLES) {
      await this.ensure(t)
      const rows = this.data.get(t) ?? []
      if (rows.length) tables[t] = rows
    }
    return JSON.stringify({ app: 'MY/CO/L', format: BACKUP_FORMAT, exported_at: new Date().toISOString(), mode: this.backend.kind, tables }, null, 1)
  }

  /** Merge a backup file into the store by id. Rows in the file win; rows not in the file are left alone. */
  async importJson(text: string): Promise<Record<string, number>> {
    this.writable()
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      throw new Error('NOT A MY/CO/L BACKUP: FILE IS NOT JSON.')
    }
    const d = doc as { app?: unknown; format?: unknown; tables?: unknown }
    if (!d || d.app !== 'MY/CO/L' || typeof d.tables !== 'object' || d.tables === null) throw new Error('NOT A MY/CO/L BACKUP FILE.')
    if (d.format !== BACKUP_FORMAT) throw new Error(`BACKUP FORMAT ${String(d.format)} IS NOT SUPPORTED. THIS APP READS FORMAT ${BACKUP_FORMAT}.`)
    const tables = d.tables as Record<string, unknown>
    // Check everything before writing anything.
    for (const [t, rows] of Object.entries(tables)) {
      if (!(BACKUP_TABLES as readonly string[]).includes(t)) throw new Error(`UNKNOWN TABLE IN BACKUP: ${t}.`)
      if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || typeof (r as Row).id !== 'string' || !(r as Row).id))
        throw new Error(`BAD ROWS IN BACKUP TABLE ${t}.`)
    }
    const counts: Record<string, number> = {}
    await this.action('IMPORT BACKUP', async () => {
      for (const t of BACKUP_TABLES) {
        const rows = tables[t] as Row[] | undefined
        if (!rows?.length) continue
        if (t === EDIT_LOG) {
          // The old history comes back as it was, not as new edits.
          await this.ensure(t)
          const have = new Set(this.rows(t).map((r) => r.id))
          const add = rows.filter((r) => !have.has(r.id))
          if (add.length) {
            this.data.set(t, [...this.rows(t), ...add])
            await this.backend.put(t, add)
          }
        } else await this.put(t, rows)
        counts[t] = rows.length
      }
    }, { via: 'import' })
    return counts
  }
}

// ---------- action journal ----------

/** A write the app makes by itself, not the person: kept out of UNDO, signed APP in the history. */
export interface BackgroundWrite {
  label: string
}

interface Change {
  table: string
  before: Row | null
  after: Row | null
}
interface Action {
  id: string
  label: string
  screen: string | null
  at: string
  via: EditVia
  undoable: boolean
  changes: Change[]
}
function newAction(label: string, screen: string | null, via: EditVia, undoable: boolean): Action {
  return { id: uuid(), label, screen, at: new Date().toISOString(), via, undoable, changes: [] }
}
function changeOp(c: Change): { table: string; op: EditOp } {
  return { table: c.table, op: !c.before ? 'create' : !c.after ? 'delete' : 'update' }
}
function entry(a: Action, who: string, table: string, rowId: string, op: EditOp, changes: EditEntry['changes'], snapshot: Row | null): EditEntry {
  return { id: uuid(), at: new Date().toISOString(), who, action_id: a.id, label: a.label || autoLabel([{ table, op }]), screen: a.screen, table_name: table, row_id: rowId, op, via: a.via, changes, snapshot }
}
