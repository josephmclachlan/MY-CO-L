// Test helpers: a pretend database that can lose signal, and an in-memory browser cache.
// Only the tests import this file.
import { MemoryBackend, type Row } from './store'
import { NetError, type RemoteApi } from './sync'

/** A pretend database that can lose signal. */
export class FakeDb implements RemoteApi {
  up = true
  t = new Map<string, Map<string, Row>>()
  refuse: string | null = null
  private tab(t: string) {
    if (!this.t.has(t)) this.t.set(t, new Map())
    return this.t.get(t)!
  }
  /** Signal drops after this many more calls (for cut-mid-sync tests). */
  dropAfter: number | null = null
  calls = 0
  private net() {
    this.calls++
    if (this.dropAfter !== null && this.dropAfter-- <= 0) {
      this.up = false
      this.dropAfter = null
    }
    if (!this.up) throw new NetError('Failed to fetch')
  }
  async load(t: string) {
    this.net()
    return [...this.tab(t).values()].map((r) => ({ ...r }))
  }
  async get(t: string, ids: string[]) {
    this.net()
    return ids.flatMap((id) => (this.tab(t).has(id) ? [{ ...this.tab(t).get(id)! }] : []))
  }
  async upsert(t: string, rows: Row[]) {
    this.net()
    if (this.refuse && rows.some((r) => r.id === this.refuse)) throw new Error('violates check constraint')
    for (const r of rows) this.tab(t).set(r.id, { ...r })
  }
  async remove(t: string, ids: string[]) {
    this.net()
    for (const id of ids) this.tab(t).delete(id)
  }
  /** Another device writes directly. */
  other(t: string, r: Row) {
    this.tab(t).set(r.id, { ...this.tab(t).get(r.id), ...r })
  }
}

export class MemCache extends MemoryBackend {
  async replace(t: string, rows: Row[]) {
    const old = await this.load(t)
    await this.del(t, old.map((r) => r.id))
    await this.put(t, rows)
  }
}


/** Small seeded random numbers, so a failing stress run can be repeated exactly. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  }
}
