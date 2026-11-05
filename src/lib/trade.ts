// TRADE maths: sale rows, totals by channel and product, buyers, margin against LEDGER.
// Pure functions, covered by trade.test.ts.

import type { Channel, Form } from '../data/ledger'
import { uuid, type Row } from './store'

export interface Sale extends Row {
  sold_on: string // yyyy-mm-dd
  buyer: string | null
  channel: Channel
  species_key: string | null
  form: Form
  grade: string | null
  kg: number
  amount_crc: number
  lot_codes: string[] | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export function newSale(p: Partial<Sale> & Pick<Sale, 'sold_on' | 'channel' | 'kg' | 'amount_crc'>): Sale {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    buyer: null,
    species_key: null,
    form: 'fresh',
    grade: null,
    lot_codes: null,
    notes: null,
    created_at: now,
    updated_at: now,
    ...p,
  }
}

/** "B1020, l1022 b1020" -> ['B1020', 'L1022']: upper case, de-duplicated, order kept. */
export function parseLots(text: string): string[] {
  const out: string[] = []
  for (const t of text.toUpperCase().split(/[\s,;/]+/)) if (t && !out.includes(t)) out.push(t)
  return out
}

/** A lot code looks like a species letter and a knock MMDD (B1020). */
export const lotLooksRight = (code: string) => /^[A-Z]\d{4}$/.test(code)

export interface Total {
  key: string
  kg: number
  crc: number
  n: number
  perKg: number | null
}

function totals(list: Sale[], key: (s: Sale) => string): Total[] {
  const m = new Map<string, Total>()
  for (const s of list) {
    const k = key(s)
    const t = m.get(k) ?? { key: k, kg: 0, crc: 0, n: 0, perKg: null }
    t.kg += Number(s.kg)
    t.crc += Number(s.amount_crc)
    t.n++
    m.set(k, t)
  }
  for (const t of m.values()) t.perKg = t.kg > 0 ? t.crc / t.kg : null
  return [...m.values()].sort((a, b) => b.crc - a.crc)
}

export const productKey = (s: Sale) => `${s.species_key ?? 'unknown'}|${s.form}`
export const byChannel = (list: Sale[]) => totals(list, (s) => s.channel)
export const byProduct = (list: Sale[]) => totals(list, productKey)
export const bySpecies = (list: Sale[]) => totals(list, (s) => s.species_key ?? 'unknown')

export interface Buyer {
  name: string
  channel: Channel
  n: number
  kg: number
  crc: number
  last: string
  first: string
}

/** One row per buyer (names matched ignoring case and spaces), the channel they used last. */
export function buyers(list: Sale[]): Buyer[] {
  const m = new Map<string, Buyer>()
  for (const s of [...list].sort((a, b) => a.sold_on.localeCompare(b.sold_on))) {
    const name = (s.buyer ?? '').trim()
    if (!name) continue
    const k = name.toUpperCase().replace(/\s+/g, ' ')
    const b = m.get(k) ?? { name, channel: s.channel, n: 0, kg: 0, crc: 0, last: s.sold_on, first: s.sold_on }
    b.n++
    b.kg += Number(s.kg)
    b.crc += Number(s.amount_crc)
    b.last = s.sold_on
    b.channel = s.channel
    b.name = name
    m.set(k, b)
  }
  return [...m.values()].sort((a, b) => b.crc - a.crc)
}

/** The buyer's last sale, to fill the form when you type a name you have sold to before. */
export function lastSaleTo(list: Sale[], name: string): Sale | null {
  const k = name.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!k) return null
  let best: Sale | null = null
  for (const s of list) {
    if ((s.buyer ?? '').trim().toUpperCase().replace(/\s+/g, ' ') !== k) continue
    if (!best || s.sold_on > best.sold_on || (s.sold_on === best.sold_on && (s.created_at ?? '') > (best.created_at ?? ''))) best = s
  }
  return best
}

export interface Margin {
  revenue: number
  cost: number
  margin: number
  pct: number | null
}

/** Margin of a set of sales when each kilo cost `costPerKg` (fresh only: dried kilos carry the drying loss, so they are left out). */
export function margin(list: Sale[], costPerKg: (key: string) => number | null): { m: Margin; uncosted: number } {
  let revenue = 0
  let cost = 0
  let uncosted = 0
  for (const s of list) {
    const c = s.species_key && s.form === 'fresh' ? costPerKg(s.species_key) : null
    if (c === null) {
      uncosted += Number(s.amount_crc)
      continue
    }
    revenue += Number(s.amount_crc)
    cost += c * Number(s.kg)
  }
  const mg = revenue - cost
  return { m: { revenue, cost, margin: mg, pct: revenue > 0 ? (mg / revenue) * 100 : null }, uncosted }
}

/** Sales in a date range, inclusive. */
export const between = (list: Sale[], from: string | null, to: string | null) => list.filter((s) => (!from || s.sold_on >= from) && (!to || s.sold_on <= to))

/** Kilos and colones per week (Monday), oldest first, for the bar chart. */
export function weekly(list: Sale[], weekOf: (d: string) => string): { week: string; kg: number; crc: number }[] {
  const m = new Map<string, { week: string; kg: number; crc: number }>()
  for (const s of list) {
    const w = weekOf(s.sold_on)
    const r = m.get(w) ?? { week: w, kg: 0, crc: 0 }
    r.kg += Number(s.kg)
    r.crc += Number(s.amount_crc)
    m.set(w, r)
  }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week))
}
