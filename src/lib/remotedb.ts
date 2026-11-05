// Supabase backend. Used when the database is linked and the owner is signed in.
// Every successful read is also saved to a cache in this browser, so with no
// signal the screens still open with the last copy (read only).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Backend, Row } from './store'
import { LocalBackend } from './localdb'

const PAGE = 1000
const CHUNK = 400

export class RemoteBackend implements Backend {
  readonly kind = 'remote' as const
  stale = false
  note?: string
  constructor(
    private sb: SupabaseClient,
    private cache: LocalBackend | null,
  ) {}

  async load(table: string): Promise<Row[]> {
    try {
      const out: Row[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await this.sb.from(table).select('*').order('id').range(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        out.push(...(data as Row[]))
        if (!data || data.length < PAGE) break
      }
      this.stale = false
      this.note = undefined
      await this.cache?.replace(table, out).catch(() => undefined)
      return out
    } catch (e) {
      if (this.cache && !navigator.onLine) {
        this.stale = true
        this.note = 'OFFLINE. SHOWING THE LAST SAVED COPY.'
        return this.cache.load(table)
      }
      throw e
    }
  }

  async put(table: string, rows: Row[]): Promise<void> {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await this.sb.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }
    await this.cache?.put(table, rows).catch(() => undefined)
  }

  async del(table: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await this.sb.from(table).delete().in('id', ids.slice(i, i + CHUNK))
      if (error) throw new Error(error.message)
    }
    await this.cache?.del(table, ids).catch(() => undefined)
  }
}
