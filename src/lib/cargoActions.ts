// Writes for CARGO. Every change to a count is a stock move; nothing edits a count in place.

import { SEED_ITEMS } from '../data/cargo'
import { uuid, type Store } from './store'
import { today, type Item, type Move, type Price } from './cargo'
import type { UseLine } from './stockplan'

const SEEDED = 'mycol.cargo.seeded.v1'

/** First run (or on request): add the starter items. Counts, reorder points and prices stay empty. */
export async function seedStarter(store: Store, force: boolean): Promise<number> {
  if (store.backend.kind === 'locked' || store.backend.stale) return 0
  try {
    if (!force && localStorage.getItem(SEEDED)) return 0
  } catch {
    // storage blocked: seed only if the table is empty
  }
  await store.ensure('items')
  const have = store.rows<Item>('items')
  if (!force && have.length) {
    try { localStorage.setItem(SEEDED, '1') } catch { /* ignore */ }
    return 0
  }
  const codes = new Set(have.map((i) => i.code))
  const names = new Set(have.map((i) => i.name.toLowerCase()))
  const add: Item[] = SEED_ITEMS.filter((s) => !codes.has(s.code) && !names.has(s.name.toLowerCase())).map((s) => ({
    id: uuid(),
    code: s.code,
    name: s.name,
    category: s.category,
    unit: s.unit,
    reorder_point: null,
    lead_time_days: null,
    supplier: s.supplier ?? null,
    room: s.room,
    use_per_week: null,
    notes: s.notes,
  }))
  try {
    if (add.length) await store.put('items', add)
    try { localStorage.setItem(SEEDED, '1') } catch { /* ignore */ }
  } catch {
    return 0
  }
  return add.length
}

export function newItem(partial: Partial<Item> & { name: string; unit: string }): Item {
  return {
    id: uuid(),
    code: null,
    category: null,
    reorder_point: null,
    lead_time_days: null,
    supplier: null,
    room: null,
    use_per_week: null,
    notes: null,
    ...partial,
  }
}

export function newMove(itemId: string, qty: number, reason: string, extra: Partial<Move> = {}): Move {
  return { id: uuid(), item_id: itemId, moved_at: new Date().toISOString(), qty, reason, run_ref: null, notes: null, ...extra }
}

/** A delivery adds stock. With a price it also adds a price-history row (price per item unit, in colones). */
export async function receive(store: Store, itemId: string, qty: number, priceCrc: number | null, supplier: string | null, notes: string | null = null) {
  await store.put('stock_moves', newMove(itemId, qty, 'delivery', { notes }))
  if (priceCrc !== null) await addPrice(store, itemId, priceCrc, supplier)
}

export async function addPrice(store: Store, itemId: string, priceCrc: number, supplier: string | null) {
  const p: Price = { id: uuid(), item_id: itemId, priced_on: today(), price_crc: priceCrc, supplier, created_at: new Date().toISOString() }
  await store.put('item_prices', p)
}

/** Set the count to a number. Records the difference as a count move, so history stays honest. */
export async function setCount(store: Store, itemId: string, current: number, target: number) {
  await store.put('stock_moves', newMove(itemId, Math.round((target - current) * 1000) / 1000, 'count', { notes: `COUNTED ${target}` }))
}

/** Removing an item removes its moves and prices first (the database keeps moves tied to items). */
export async function removeItem(store: Store, itemId: string) {
  await store.ensure('stock_moves')
  await store.ensure('item_prices')
  const moves = store.rows<Move>('stock_moves').filter((m) => m.item_id === itemId).map((m) => m.id)
  const prices = store.rows<Price>('item_prices').filter((p) => p.item_id === itemId).map((p) => p.id)
  if (moves.length) await store.del('stock_moves', moves)
  if (prices.length) await store.del('item_prices', prices)
  await store.del('items', itemId)
}

/** Book a whole bag run: one use move per item, all sharing a run reference. */
export async function bookRun(store: Store, runRef: string, lines: UseLine[], items: Item[], note: string): Promise<{ booked: number; missing: string[] }> {
  const moves: Move[] = []
  const missing: string[] = []
  for (const l of lines) {
    const item = items.find((i) => i.code === l.code)
    if (!item) {
      missing.push(l.code)
      continue
    }
    if (l.book > 0) moves.push(newMove(item.id, -l.book, 'run', { run_ref: runRef, notes: note }))
  }
  if (moves.length) await store.put('stock_moves', moves)
  return { booked: moves.length, missing }
}

export async function undoRun(store: Store, runRef: string) {
  await store.ensure('stock_moves')
  const ids = store.rows<Move>('stock_moves').filter((m) => m.run_ref === runRef).map((m) => m.id)
  if (ids.length) await store.del('stock_moves', ids)
}
