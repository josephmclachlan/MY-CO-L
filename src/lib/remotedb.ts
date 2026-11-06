// Supabase backend. Used when the database is linked and the owner is signed in.
// Writes go to this browser first and are queued (src/lib/sync.ts), so the
// farm keeps logging with no signal; the queue is sent when signal returns.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Row } from './store'
import { LocalBackend } from './localdb'
import { NetError, SyncBackend, type RemoteApi } from './sync'

const PAGE = 1000
const CHUNK = 400

/** No answer, a timeout or a server outage means "try again later", not "this value is wrong". */
function check(res: { error: { message: string } | null; status?: number }) {
  if (!res.error) return
  const s = res.status ?? 0
  if (s === 0 || s === 408 || s === 429 || s >= 500 || /fetch|network|timed? ?out|load failed/i.test(res.error.message)) throw new NetError(res.error.message)
  throw new Error(res.error.message)
}

type Err = { message: string; code?: string } | null
const isDuplicate = (e: Err) => e?.code === '23505'

/** History lines are only ever added. A plain insert needs no read or change right (an upsert does), so a STAFF login can
 *  write its own history lines without being able to read or rewrite anyone's (migration 0016). A line that arrives twice
 *  because the first answer was lost is already there: that is not an error. */
export async function addHistory(sb: Pick<SupabaseClient, 'from'>, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const res = await sb.from('edit_log').insert(chunk)
    if (!isDuplicate(res.error)) {
      check(res)
      continue
    }
    for (const r of chunk) {
      const one = await sb.from('edit_log').insert(r)
      if (!isDuplicate(one.error)) check(one)
    }
  }
}

export class SupabaseApi implements RemoteApi {
  constructor(private sb: SupabaseClient) {}
  async load(table: string): Promise<Row[]> {
    const out: Row[] = []
    for (let from = 0; ; from += PAGE) {
      const res = await this.sb.from(table).select('*').order('id').range(from, from + PAGE - 1)
      check(res)
      const data = (res.data ?? []) as Row[]
      out.push(...data)
      if (data.length < PAGE) break
    }
    return out
  }
  async get(table: string, ids: string[]): Promise<Row[]> {
    const out: Row[] = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await this.sb.from(table).select('*').in('id', ids.slice(i, i + CHUNK))
      check(res)
      out.push(...((res.data ?? []) as Row[]))
    }
    return out
  }
  async upsert(table: string, rows: Row[]): Promise<void> {
    if (table === 'edit_log') return addHistory(this.sb, rows)
    for (let i = 0; i < rows.length; i += CHUNK) check(await this.sb.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' }))
  }
  async remove(table: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += CHUNK) check(await this.sb.from(table).delete().in('id', ids.slice(i, i + CHUNK)))
  }
}

export function remoteBackend(sb: SupabaseClient, cache: LocalBackend | null): SyncBackend {
  const b = new SyncBackend(new SupabaseApi(sb), cache)
  b.start()
  return b
}
