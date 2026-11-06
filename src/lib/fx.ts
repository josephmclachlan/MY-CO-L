// Colones per US dollar, kept per day. Every record is stored in colones; dollars are only shown,
// and always at the rate of the record's own day, so old earnings and costs never move when the rate does.
//
// The rate is fetched once a day when the app is online (a free public feed of daily market rates,
// with history, so past days can be filled in too). A rate you type for a day replaces the fetched one.
// With no rate on or before a day, the nearest later day is used, then the fallback on PRICES + COSTS.

import type { Row, Store } from './store'

export interface FxRate extends Row {
  id: string // the day, yyyy-mm-dd: one rate per day
  day: string
  crc_per_usd: number
  source: 'AUTO' | 'MANUAL'
  fetched_at?: string
}

export const FX_TABLE = 'fx_rates'
/** The feed's history starts here. */
export const FX_FIRST_DAY = '2024-03-02'

export interface FxLookup {
  rate: number
  day: string | null // the day the rate belongs to, null = the fallback
  source: 'AUTO' | 'MANUAL' | 'FALLBACK'
  exact: boolean
}

/** Rows sorted by day, ready for lookups. */
export function sortRates(rows: FxRate[]): FxRate[] {
  return rows.filter((r) => r.day && Number(r.crc_per_usd) > 0).sort((a, b) => a.day.localeCompare(b.day))
}

/** The rate for a day: that day's, else the last one before it, else the first after it, else the fallback. */
export function fxOn(day: string, sorted: FxRate[], fallback: number): FxLookup {
  const d = day.slice(0, 10)
  let lo = 0
  let hi = sorted.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].day <= d) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const r = best >= 0 ? sorted[best] : sorted[0]
  if (!r) return { rate: fallback, day: null, source: 'FALLBACK', exact: false }
  return { rate: Number(r.crc_per_usd), day: r.day, source: r.source, exact: r.day === d }
}

/** Dollars for colones spent or earned on a day. */
export const usdOn = (crc: number, day: string, sorted: FxRate[], fallback: number) => crc / fxOn(day, sorted, fallback).rate

/** Last day of a billed month (yyyy-mm or yyyy-mm-dd), for converting a monthly bill. */
export function monthEnd(month: string): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- fetching ----------

type Fetcher = (url: string) => Promise<unknown>
const getJson: Fetcher = async (url) => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Pull CRC out of the feed's reply: { date, usd: { crc } } or { rates: { CRC } }. */
export function readFeed(j: unknown): { day: string | null; rate: number } | null {
  if (!j || typeof j !== 'object') return null
  const o = j as { date?: unknown; usd?: { crc?: unknown }; rates?: { CRC?: unknown }; time_last_update_utc?: unknown }
  const rate = Number(o.usd?.crc ?? o.rates?.CRC)
  if (!(rate > 100 && rate < 5000)) return null // colones per dollar has never been outside this
  let day: string | null = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null
  if (!day && typeof o.time_last_update_utc === 'string') {
    const t = Date.parse(o.time_last_update_utc)
    if (Number.isFinite(t)) day = new Date(t).toISOString().slice(0, 10)
  }
  return { day, rate }
}

/** One day's rate ('latest' for today). Tries the feed on two mirrors, then a second feed for today. */
export async function fetchRate(day: string | 'latest', get: Fetcher = getJson): Promise<{ day: string | null; rate: number } | null> {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${day}/v1/currencies/usd.min.json`,
    `https://${day}.currency-api.pages.dev/v1/currencies/usd.min.json`,
    ...(day === 'latest' ? ['https://open.er-api.com/v6/latest/USD'] : []),
  ]
  for (const u of urls) {
    try {
      const got = readFeed(await get(u))
      if (got) return got
    } catch {
      // next mirror
    }
  }
  return null
}

const inFlight = new Set<string>()
const failed = new Set<string>()

/** Fill in missing days: today first, then up to `max` past days that records need. Never replaces a typed rate. */
export async function syncRates(store: Store, need: string[], today: string, opts: { max?: number; get?: Fetcher } = {}): Promise<number> {
  if (store.backend.kind === 'locked' || store.backend.stale) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  await store.ensure(FX_TABLE)
  const have = new Set(store.rows<FxRate>(FX_TABLE).map((r) => r.day))
  const want = [today, ...[...new Set(need.map((d) => d.slice(0, 10)))].filter((d) => d < today && d >= FX_FIRST_DAY).sort().reverse()]
  const todo = want.filter((d) => !have.has(d) && !inFlight.has(d) && !failed.has(d)).slice(0, opts.max ?? 12)
  let saved = 0
  for (const d of todo) {
    inFlight.add(d)
    try {
      const got = await fetchRate(d === today ? 'latest' : d, opts.get)
      if (!got) {
        failed.add(d)
        continue
      }
      // The feed may answer 'latest' with yesterday's date: keep it under the day it belongs to.
      const day = d === today ? (got.day && got.day <= today ? got.day : today) : d
      const now = store.rows<FxRate>(FX_TABLE).find((r) => r.day === day)
      if (now?.source === 'MANUAL') continue
      await store.put(FX_TABLE, { id: day, day, crc_per_usd: Math.round(got.rate * 100) / 100, source: 'AUTO', fetched_at: new Date().toISOString() }, { label: `EXCHANGE RATE ${day} FETCHED` })
      saved++
    } catch {
      failed.add(d)
    } finally {
      inFlight.delete(d)
    }
  }
  return saved
}

/** A rate you typed for a day. Replaces whatever was there. */
export async function setManualRate(store: Store, day: string, rate: number): Promise<void> {
  await store.put(FX_TABLE, { id: day, day, crc_per_usd: rate, source: 'MANUAL', fetched_at: new Date().toISOString() })
}

/** Forget a typed rate so the fetched one can come back. */
export async function clearRate(store: Store, day: string): Promise<void> {
  await store.del(FX_TABLE, day)
  failed.delete(day)
}
