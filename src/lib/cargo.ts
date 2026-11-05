// CARGO maths: stock counts, weekly use, weeks left, reorder state, money.
// The count of an item is always the sum of its stock moves, so the history and
// the number can never disagree. Pure functions, covered by cargo.test.ts.

import type { Row } from './store'
import type { RoomId } from '../data/power'
import type { SubstrateForm } from './stockplan'

export interface Item extends Row {
  code: string | null
  name: string
  category: string | null
  unit: string
  reorder_point: number | null
  lead_time_days: number | null
  supplier: string | null
  room: RoomId | null
  use_per_week: number | null
  notes: string | null
}

export interface Price extends Row {
  item_id: string
  priced_on: string // yyyy-mm-dd
  price_crc: number // per item unit
  supplier: string | null
  created_at?: string
}

export interface Move extends Row {
  item_id: string
  moved_at: string // ISO
  qty: number // + delivery, - use
  reason: string | null // delivery | use | count | run | waste
  run_ref: string | null
  notes: string | null
}

export type StockState = 'NO COUNT' | 'OK' | 'LOW' | 'OUT'
export type UseSource = 'MANUAL' | 'PLAN' | 'HISTORY'

const WEEK_MS = 7 * 86400000

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Sum of moves per item. Rounds away floating-point dust. */
export function onHandMap(moves: Move[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of moves) m.set(x.item_id, (m.get(x.item_id) ?? 0) + Number(x.qty))
  for (const [k, v] of m) m.set(k, Math.round(v * 1000) / 1000)
  return m
}

export interface WeeklyUse {
  perWeek: number
  source: UseSource
}

/** Weekly use: a figure typed on the item wins, then the run plan, then the average of recent uses. */
export function weeklyUse(item: Item, plan: number | undefined, moves: Move[], now = Date.now()): WeeklyUse | null {
  const manual = num(item.use_per_week)
  if (manual !== null && manual > 0) return { perWeek: manual, source: 'MANUAL' }
  if (plan !== undefined && plan > 0) return { perWeek: plan, source: 'PLAN' }
  // History: uses (negative moves that are not count corrections) over up to the last 4 weeks.
  const uses = moves.filter((m) => m.item_id === item.id && Number(m.qty) < 0 && m.reason !== 'count')
  if (!uses.length) return null
  const first = Math.min(...uses.map((m) => Date.parse(m.moved_at)))
  const spanWeeks = Math.min(4, Math.max(1, (now - first) / WEEK_MS))
  const since = now - spanWeeks * WEEK_MS
  const total = uses.filter((m) => Date.parse(m.moved_at) >= since).reduce((n, m) => n - Number(m.qty), 0)
  return total > 0 ? { perWeek: total / spanWeeks, source: 'HISTORY' } : null
}

export function weeksLeft(onHand: number, use: WeeklyUse | null): number | null {
  if (!use) return null
  return onHand <= 0 ? 0 : onHand / use.perWeek
}

/** OK / LOW / OUT. LOW means at or under the reorder point, or it will run out before a new order could arrive. */
export function stockState(item: Item, onHand: number, counted: boolean, wl: number | null): StockState {
  if (!counted) return 'NO COUNT'
  if (onHand <= 0) return 'OUT'
  const rp = num(item.reorder_point)
  if (rp !== null && onHand <= rp) return 'LOW'
  const lead = num(item.lead_time_days)
  if (lead !== null && wl !== null && wl * 7 <= lead) return 'LOW'
  return 'OK'
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** Fill 0..1 for the hatched meter and where the reorder tick sits. */
export function meterShape(item: Item, onHand: number, use: WeeklyUse | null): { frac: number; mark: number | null } {
  const rp = num(item.reorder_point)
  if (rp !== null && rp > 0) return { frac: clamp(onHand / (rp * 3)), mark: 1 / 3 }
  if (use) return { frac: clamp(onHand / (use.perWeek * 8)), mark: null }
  return { frac: onHand > 0 ? 1 : 0, mark: null }
}

// ---------- money ----------

/** Colones per US dollar. The electrical package uses 510. Change it in CARGO when the rate moves. */
export const DEFAULT_FX = 510

export const fmtCrc = (n: number) => `₡${Math.round(n).toLocaleString('en-US')}`
export const fmtUsd = (crc: number, fx: number) => {
  const d = crc / fx
  return `US$${d.toFixed(d < 10 ? 2 : 0)}`
}

/** Price history for one item, newest first. */
export function priceHistory(itemId: string, prices: Price[]): Price[] {
  return prices
    .filter((p) => p.item_id === itemId)
    .sort((a, b) => (a.priced_on === b.priced_on ? (b.created_at ?? '').localeCompare(a.created_at ?? '') : a.priced_on < b.priced_on ? 1 : -1))
}

export const fmtQty = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10))
export const fmtWeeks = (w: number | null) => (w === null ? '--' : w < 10 ? w.toFixed(1) : String(Math.round(w)))

export const today = () => new Date().toISOString().slice(0, 10)

/** Next run reference for a day, e.g. RUN-20261105-1. */
export function nextRunRef(moves: Move[], date = new Date()): string {
  const stamp = `RUN-${date.toISOString().slice(0, 10).replace(/-/g, '')}`
  const used = new Set(moves.map((m) => m.run_ref).filter((r): r is string => !!r && r.startsWith(stamp)))
  let n = 1
  while (used.has(`${stamp}-${n}`)) n++
  return `${stamp}-${n}`
}

// ---------- device preferences (not shared between phone and laptop) ----------

export interface CargoPrefs {
  fx: number
  form: SubstrateForm
  soyShare: number
}
const KEY = 'mycol.cargo.v1'
export function loadPrefs(): CargoPrefs {
  const d: CargoPrefs = { fx: DEFAULT_FX, form: 'separate', soyShare: 0.5 }
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CargoPrefs>
    return {
      fx: s.fx && s.fx > 0 ? s.fx : d.fx,
      form: s.form === 'combo' ? 'combo' : 'separate',
      soyShare: typeof s.soyShare === 'number' ? clamp(Math.min(0.5, s.soyShare)) : d.soyShare,
    }
  } catch {
    return d
  }
}
export function savePrefs(p: CargoPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // blocked storage: the preference lasts until reload
  }
}
