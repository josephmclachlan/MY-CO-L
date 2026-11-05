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

export type Row = { id: string } & Record<string, unknown>

/** Tables the backup file carries, in an order that satisfies foreign keys.
 *  sensor_readings is left out on purpose: it grows without limit. */
export const BACKUP_TABLES = [
  'species', 'strains', 'cultures', 'rooms', 'circuits', 'equipment', 'cook_runs', 'cook_readings',
  'grain_runs', 'block_lots', 'contaminants', 'lot_losses', 'hazard_logs', 'harvests', 'sales', 'sale_lots',
  'items', 'item_prices', 'stock_moves', 'energy_bills', 'labour_entries', 'reference_entries', 'app_settings',
] as const

/** Delete order is the reverse, so children go before parents. */
export const BACKUP_FORMAT = 1

export interface Backend {
  readonly kind: 'local' | 'remote' | 'memory' | 'locked'
  /** True when the last load could not reach the database and used the saved copy. Writes are refused. */
  stale: boolean
  /** A human sentence about why the backend is degraded, if it is. */
  note?: string
  load(table: string): Promise<Row[]>
  put(table: string, rows: Row[]): Promise<void>
  del(table: string, ids: string[]): Promise<void>
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

  constructor(backend: Backend) {
    this.backend = backend
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
    if (this.backend.stale) throw new Error('OFFLINE. SHOWING THE LAST SAVED COPY. READ ONLY.')
  }

  /** Insert or replace rows by id. Updates the screen first, rolls back if the write fails. */
  async put(table: string, input: Row | Row[]): Promise<void> {
    this.writable()
    await this.ensure(table)
    const rows = Array.isArray(input) ? input : [input]
    if (!rows.length) return
    const now = new Date().toISOString()
    const before = this.data.get(table) ?? []
    const byId = new Map(before.map((r) => [r.id, r]))
    // Tables that carry updated_at get it refreshed (Supabase does the same with a trigger).
    const stamped = rows.map((r) => ('updated_at' in r || 'updated_at' in (byId.get(r.id) ?? {}) ? { ...r, updated_at: now } : r)) as Row[]
    for (const r of stamped) byId.set(r.id, { ...(byId.get(r.id) ?? {}), ...r })
    this.data.set(table, [...byId.values()])
    this.bump()
    try {
      await this.backend.put(table, stamped.map((r) => byId.get(r.id)!))
    } catch (e) {
      this.data.set(table, before)
      this.bump()
      throw e
    }
  }

  async del(table: string, ids: string | string[]): Promise<void> {
    this.writable()
    await this.ensure(table)
    const list = Array.isArray(ids) ? ids : [ids]
    if (!list.length) return
    const before = this.data.get(table) ?? []
    const gone = new Set(list)
    this.data.set(table, before.filter((r) => !gone.has(r.id)))
    this.bump()
    try {
      await this.backend.del(table, list)
    } catch (e) {
      this.data.set(table, before)
      this.bump()
      throw e
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
    for (const t of BACKUP_TABLES) {
      const rows = tables[t] as Row[] | undefined
      if (!rows?.length) continue
      await this.put(t, rows)
      counts[t] = rows.length
    }
    return counts
  }
}
