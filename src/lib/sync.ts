// Offline saving for LINKED MODE (Supabase).
//
// Every write lands in this browser first (the cache) and joins a queue (the
// outbox). When there is signal the queue is sent to the database in order.
// With no signal the screens keep working and the title bar lamp says
// WAITING n. Nothing is ever refused for being offline.
//
// Conflict rule (two devices changed the same record while one was offline):
//   - Fields only one side changed: that side's value is kept. No conflict.
//   - A field BOTH sides changed to different values: the later write wins
//     (the database row's updated_at against the time this device saved it),
//     and the pair is listed under HISTORY > SYNC as a conflict.
//   - Edited here, deleted there: the edit puts the record back, listed.
//   - Deleted here, changed there: the later of the two wins, listed.
//   - The database refuses a write (bad value, permission): listed as REFUSED
//     with the values, and the queue moves on so one bad row never blocks the rest.

import type { Backend, Row } from './store'
import { same } from './history'
import { uuid } from './store'

/** Thrown by a RemoteApi when the database cannot be reached (no signal, timeout, server down). Retry later. */
export class NetError extends Error {}
/** A failed fetch (TypeError) also means no connection. */
const isNet = (e: unknown) => e instanceof NetError || e instanceof TypeError

/** The few database calls the queue needs. remotedb.ts has the Supabase one; tests use a fake. */
export interface RemoteApi {
  load(table: string): Promise<Row[]>
  get(table: string, ids: string[]): Promise<Row[]>
  upsert(table: string, rows: Row[]): Promise<void>
  remove(table: string, ids: string[]): Promise<void>
}

/** The browser copy (IndexedDB). */
export interface Cache {
  load(table: string): Promise<Row[]>
  put(table: string, rows: Row[]): Promise<void>
  del(table: string, ids: string[]): Promise<void>
  replace(table: string, rows: Row[]): Promise<void>
}

export interface OutOp {
  id: string
  seq: number
  table: string
  kind: 'put' | 'del'
  /** put: the rows as saved here. del: empty. */
  rows: Row[]
  ids: string[]
  /** Each record as it was before this change (null = it did not exist). */
  base: Record<string, Row | null>
  at: string
}

export type ConflictKind = 'both-changed' | 'deleted-there' | 'deleted-here' | 'refused'
export interface Conflict {
  id: string
  at: string
  table: string
  row_id: string
  kind: ConflictKind
  field: string | null
  mine: unknown
  theirs: unknown
  kept: 'mine' | 'theirs'
  note: string
  seen: boolean
}

const OUTBOX = '_outbox'
const CONFLICTS = '_conflicts'
const NEVER_COMPARE = new Set(['id', 'updated_at'])

const time = (v: unknown) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * Merge one record by the conflict rule.
 * base = the record before this device's change, mine = after it, theirs = what the database holds now.
 */
export function mergeRow(base: Row | null, mine: Row, theirs: Row | null, myAt: string): { row: Row; conflicts: Omit<Conflict, 'id' | 'at' | 'seen'>[] } {
  if (!theirs) {
    // Not in the database. New here, or deleted on another device after we last saw it.
    if (!base) return { row: mine, conflicts: [] }
    return {
      row: mine,
      conflicts: [{ table: '', row_id: mine.id, kind: 'deleted-there', field: null, mine: null, theirs: null, kept: 'mine', note: 'DELETED ON ANOTHER DEVICE. YOUR EDIT PUT IT BACK.' }],
    }
  }
  const theirT = time(theirs.updated_at)
  const theirsLater = theirT !== null && theirT > (time(myAt) ?? 0)
  const out: Row = { ...theirs }
  const conflicts: Omit<Conflict, 'id' | 'at' | 'seen'>[] = []
  for (const f of Object.keys(mine)) {
    if (NEVER_COMPARE.has(f)) continue
    const iChanged = base ? !same(mine[f], base[f]) : true
    if (!iChanged) continue // keep the database value: maybe the other device changed it
    const theyChanged = base ? !same(theirs[f], base[f]) : f in theirs
    if (theyChanged && !same(theirs[f], mine[f])) {
      const kept = theirsLater ? 'theirs' : 'mine'
      out[f] = kept === 'mine' ? mine[f] : theirs[f]
      conflicts.push({ table: '', row_id: mine.id, kind: 'both-changed', field: f, mine: mine[f] ?? null, theirs: theirs[f] ?? null, kept, note: kept === 'mine' ? 'BOTH CHANGED. YOURS WAS LATER, KEPT.' : 'BOTH CHANGED. THE OTHER DEVICE WAS LATER, KEPT ITS VALUE.' })
    } else out[f] = mine[f]
  }
  if ('updated_at' in mine && !theirsLater) out.updated_at = mine.updated_at
  return { row: out, conflicts }
}

/** Did the database copy change since base (ignoring updated_at)? */
function changedSince(base: Row | null, theirs: Row): boolean {
  if (!base) return true
  const keys = new Set([...Object.keys(base), ...Object.keys(theirs)])
  for (const k of keys) if (!NEVER_COMPARE.has(k) && !same(base[k], theirs[k])) return true
  return false
}

export interface SyncInfo {
  waiting: number
  conflicts: number
  syncing: boolean
  online: boolean
  lastSync: string | null
  error: string | null
}

/** Queue order. Always rising, even for many saves in one millisecond or a clock set back. */
let lastSeq = 0
const nextSeq = (floor = 0) => (lastSeq = Math.max(Date.now() * 1000, lastSeq + 1, floor + 1))

/** Linked-mode backend with an offline queue. */
export class SyncBackend implements Backend {
  readonly kind = 'remote' as const
  /** True while showing the browser copy because the database could not be reached. Writes still work. */
  stale = false
  note?: string
  onChange?: (table: string, put: Row[], removed: string[]) => void
  onStatus?: () => void

  private outbox: OutOp[] = []
  private conflicts: Conflict[] = []
  private running: Promise<void> | null = null
  private online = true
  private lastSync: string | null = null
  private error: string | null = null
  private ready: Promise<void>
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private api: RemoteApi,
    private cache: Cache | null,
    private isOnline: () => boolean = () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  ) {
    this.ready = this.restore()
  }

  private async restore() {
    if (!this.cache) return
    try {
      this.outbox = ((await this.cache.load(OUTBOX)) as unknown as OutOp[]).sort((a, b) => a.seq - b.seq)
      this.conflicts = ((await this.cache.load(CONFLICTS)) as unknown as Conflict[]).sort((a, b) => b.at.localeCompare(a.at))
    } catch {
      /* an unreadable queue starts empty */
    }
  }

  private stopped = false
  private unlisten: (() => void) | null = null

  /** Listen for signal coming back, and retry every 30 s while anything is waiting. */
  start() {
    if (typeof window === 'undefined' || this.timer) return
    const kick = () => void this.flush()
    const vis = () => document.visibilityState === 'visible' && kick()
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', vis)
    this.timer = setInterval(() => this.outbox.length && kick(), 30000)
    this.unlisten = () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', vis)
    }
    void this.ready.then(kick)
  }

  /**
   * Retire this copy (logout, or the app swapped to a new one). Only one copy may send the queue,
   * or an older change could reach the database after a newer one. Writes still land in the
   * browser copy and the next copy sends them.
   */
  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unlisten?.()
  }

  /** Pick up changes another copy of the app queued in the same browser copy. */
  private async reread() {
    if (!this.cache) return
    try {
      const have = new Set(this.outbox.map((o) => o.id))
      const more = ((await this.cache.load(OUTBOX)) as unknown as OutOp[]).filter((o) => !have.has(o.id))
      if (more.length) this.outbox = [...this.outbox, ...more].sort((a, b) => a.seq - b.seq)
    } catch {
      /* keep what we have */
    }
  }

  info(): SyncInfo {
    return {
      waiting: this.outbox.length,
      conflicts: this.conflicts.filter((c) => !c.seen).length,
      syncing: !!this.running,
      online: this.online,
      lastSync: this.lastSync,
      error: this.error,
    }
  }
  pending(): OutOp[] {
    return [...this.outbox]
  }
  conflictList(): Conflict[] {
    return [...this.conflicts]
  }
  async markSeen() {
    this.conflicts = this.conflicts.map((c) => ({ ...c, seen: true }))
    await this.cache?.put(CONFLICTS, this.conflicts as unknown as Row[]).catch(() => undefined)
    this.onStatus?.()
  }
  async clearConflicts() {
    const ids = this.conflicts.map((c) => c.id)
    this.conflicts = []
    await this.cache?.del(CONFLICTS, ids).catch(() => undefined)
    this.onStatus?.()
  }

  private status(online: boolean, error: string | null = this.error) {
    this.online = online
    this.error = error
    this.stale = !online
    this.note = online ? undefined : 'NO SIGNAL. SAVING ON THIS DEVICE. IT SYNCS WHEN SIGNAL RETURNS.'
    this.onStatus?.()
  }

  // ---------- Backend ----------

  async load(table: string): Promise<Row[]> {
    await this.ready
    try {
      if (!this.isOnline()) throw new NetError('offline')
      const rows = await this.api.load(table)
      const view = this.overlay(table, rows)
      await this.cache?.replace(table, view).catch(() => undefined)
      this.status(true)
      return view
    } catch (e) {
      if (this.cache && (isNet(e) || !this.isOnline())) {
        this.status(false)
        return this.cache.load(table)
      }
      throw e
    }
  }

  /** Database rows with this device's unsent changes laid on top. */
  private overlay(table: string, rows: Row[]): Row[] {
    const ops = this.outbox.filter((o) => o.table === table)
    if (!ops.length) return rows
    const m = new Map(rows.map((r) => [r.id, r]))
    for (const o of ops) {
      if (o.kind === 'put') for (const r of o.rows) m.set(r.id, r)
      else for (const id of o.ids) m.delete(id)
    }
    return [...m.values()]
  }

  async put(table: string, rows: Row[], base?: Map<string, Row | null>): Promise<void> {
    await this.ready
    if (this.cache) await this.cache.put(table, rows)
    await this.enqueue({ table, kind: 'put', rows, ids: rows.map((r) => r.id), base: Object.fromEntries(rows.map((r) => [r.id, base?.get(r.id) ?? null])) })
  }

  async del(table: string, ids: string[], base?: Map<string, Row | null>): Promise<void> {
    await this.ready
    if (this.cache) await this.cache.del(table, ids)
    await this.enqueue({ table, kind: 'del', rows: [], ids, base: Object.fromEntries(ids.map((id) => [id, base?.get(id) ?? null])) })
  }

  private async enqueue(p: Omit<OutOp, 'id' | 'seq' | 'at'>) {
    const op: OutOp = { id: uuid(), seq: nextSeq(this.outbox.at(-1)?.seq ?? 0), at: new Date().toISOString(), ...p }
    if (!this.cache) {
      // No browser copy to fall back on (storage blocked): send now, and a failure is reported on screen.
      try {
        await this.apply(op)
      } catch (e) {
        if (isNet(e)) throw new Error('NO SIGNAL AND THIS BROWSER BLOCKS STORAGE. NOT SAVED.')
        throw e
      }
      return
    }
    if (!this.stopped) this.outbox.push(op) // a retired copy only saves it; the newer copy sends it
    await this.cache.put(OUTBOX, [op as unknown as Row])
    if (this.stopped) return
    this.onStatus?.()
    void this.flush()
  }

  /** Send everything waiting, oldest first. Stops at the first lost connection. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    // A run already going may have started before signal came back: go again once it ends.
    if (this.running) return this.running.then(() => (this.outbox.length && this.isOnline() ? this.flush() : undefined))
    this.running = this.drain().finally(() => {
      this.running = null
      this.onStatus?.()
    })
    this.onStatus?.()
    return this.running
  }

  private async drain() {
    await this.ready
    await this.reread()
    while (this.outbox.length && !this.stopped) {
      if (!this.isOnline()) return this.status(false)
      const op = this.outbox[0]
      try {
        await this.apply(op)
      } catch (e) {
        if (isNet(e)) return this.status(false, null)
        await this.addConflicts(op.ids.map((id) => ({ table: op.table, row_id: id, kind: 'refused' as const, field: null, mine: op.kind === 'put' ? op.rows.find((r) => r.id === id) ?? null : 'DELETE', theirs: null, kept: 'theirs' as const, note: `DATABASE REFUSED THIS ${op.kind === 'put' ? 'SAVE' : 'DELETE'}: ${e instanceof Error ? e.message : String(e)}`.toUpperCase() })))
      }
      this.outbox.shift()
      await this.cache?.del(OUTBOX, [op.id]).catch(() => undefined)
      this.lastSync = new Date().toISOString()
      this.status(true, null)
    }
  }

  private async apply(op: OutOp) {
    const theirs = new Map((await this.api.get(op.table, op.ids)).map((r) => [r.id, r]))
    if (op.kind === 'put') {
      const merged: Row[] = []
      const found: Omit<Conflict, 'id' | 'at' | 'seen'>[] = []
      const differs: Row[] = []
      for (const mine of op.rows) {
        const m = mergeRow(op.base[mine.id] ?? null, mine, theirs.get(mine.id) ?? null, op.at)
        merged.push(m.row)
        found.push(...m.conflicts.map((c) => ({ ...c, table: op.table })))
        if (!same(m.row, mine)) differs.push(m.row)
      }
      await this.api.upsert(op.table, merged)
      await this.addConflicts(found)
      // Show the merged result here too, unless a newer change on this device is still queued for
      // that record (it would be overwritten by an older state, e.g. a deleted record coming back).
      const show = differs.filter((r) => !this.touchedLater(op, r.id))
      if (show.length) {
        await this.cache?.put(op.table, show).catch(() => undefined)
        this.onChange?.(op.table, show, [])
      }
      return
    }
    const gone: string[] = []
    const kept: Row[] = []
    const found: Omit<Conflict, 'id' | 'at' | 'seen'>[] = []
    for (const id of op.ids) {
      const t = theirs.get(id)
      if (!t) continue // already gone
      const base = op.base[id] ?? null
      if (changedSince(base, t)) {
        const theirT = time(t.updated_at)
        const theirsLater = theirT !== null && theirT > (time(op.at) ?? 0)
        if (theirsLater) {
          kept.push(t)
          found.push({ table: op.table, row_id: id, kind: 'deleted-here', field: null, mine: 'DELETE', theirs: null, kept: 'theirs', note: 'YOU DELETED IT, BUT ANOTHER DEVICE CHANGED IT LATER. KEPT.' })
          continue
        }
        found.push({ table: op.table, row_id: id, kind: 'deleted-here', field: null, mine: 'DELETE', theirs: null, kept: 'mine', note: 'YOU DELETED IT AFTER ANOTHER DEVICE CHANGED IT. DELETED.' })
      }
      gone.push(id)
    }
    if (gone.length) await this.api.remove(op.table, gone)
    await this.addConflicts(found)
    const show = kept.filter((r) => !this.touchedLater(op, r.id))
    if (show.length) {
      await this.cache?.put(op.table, show).catch(() => undefined)
      this.onChange?.(op.table, show, [])
    }
  }

  /** Is a newer queued change on this device about the same record? */
  private touchedLater(op: OutOp, id: string): boolean {
    return this.outbox.some((o) => o !== op && o.seq > op.seq && o.table === op.table && o.ids.includes(id))
  }

  private async addConflicts(list: Omit<Conflict, 'id' | 'at' | 'seen'>[]) {
    if (!list.length) return
    const at = new Date().toISOString()
    const rows: Conflict[] = list.map((c) => ({ ...c, id: uuid(), at, seen: false }))
    this.conflicts = [...rows, ...this.conflicts].slice(0, 300)
    await this.cache?.put(CONFLICTS, rows as unknown as Row[]).catch(() => undefined)
  }
}
