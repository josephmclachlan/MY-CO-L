import { describe, expect, it } from 'vitest'
import { fetchRate, fxOn, monthEnd, readFeed, sortRates, syncRates, type FxRate } from './fx'
import { MemoryBackend, Store } from './store'
import { buildLedger, DEFAULT_LEDGER_PREFS } from './ledger'
import { margin, newSale, usdOf, byChannel } from './trade'

const r = (day: string, rate: number, source: 'AUTO' | 'MANUAL' = 'AUTO'): FxRate => ({ id: day, day, crc_per_usd: rate, source })

describe('exchange rate by day', () => {
  const rows = sortRates([r('2026-11-03', 505), r('2026-10-01', 520), r('2026-11-05', 500, 'MANUAL')])
  it('uses the day itself, else the last day before it', () => {
    expect(fxOn('2026-11-05', rows, 510)).toMatchObject({ rate: 500, exact: true, source: 'MANUAL' })
    expect(fxOn('2026-11-04', rows, 510)).toMatchObject({ rate: 505, exact: false })
    expect(fxOn('2026-10-15', rows, 510).rate).toBe(520)
  })
  it('before the first rate uses the first one; with none, the fallback', () => {
    expect(fxOn('2025-01-01', rows, 510).rate).toBe(520)
    expect(fxOn('2026-11-05', [], 510)).toMatchObject({ rate: 510, source: 'FALLBACK' })
  })
  it('month end for bills', () => {
    expect(monthEnd('2026-02-01')).toBe('2026-02-28')
    expect(monthEnd('2026-11')).toBe('2026-11-30')
  })
  it('reads both feed shapes and refuses nonsense', () => {
    expect(readFeed({ date: '2026-11-05', usd: { crc: 503.2 } })).toEqual({ day: '2026-11-05', rate: 503.2 })
    expect(readFeed({ rates: { CRC: 504 }, time_last_update_utc: 'Thu, 05 Nov 2026 00:02:31 +0000' })).toEqual({ day: '2026-11-05', rate: 504 })
    expect(readFeed({ usd: { crc: 1 } })).toBeNull()
  })
  it('falls through mirrors', async () => {
    const seen: string[] = []
    const got = await fetchRate('2026-10-01', async (u) => {
      seen.push(u)
      if (u.includes('jsdelivr')) throw new Error('down')
      return { date: '2026-10-01', usd: { crc: 512 } }
    })
    expect(got?.rate).toBe(512)
    expect(seen).toHaveLength(2)
  })
  it('sync fills today and the days records need, and never replaces a typed rate', async () => {
    const st = new Store(new MemoryBackend())
    await st.put('fx_rates', r('2026-10-02', 499, 'MANUAL'))
    const n = await syncRates(st, ['2026-10-01', '2026-10-02'], '2026-11-05', { get: async (u) => ({ date: u.includes('latest') ? '2026-11-05' : u.match(/@(\d{4}-\d{2}-\d{2})/)?.[1] ?? '2026-10-01', usd: { crc: 505 } }) })
    expect(n).toBe(2)
    const rows = st.rows<FxRate>('fx_rates')
    expect(rows.find((x) => x.day === '2026-10-02')?.crc_per_usd).toBe(499)
    expect(rows.find((x) => x.day === '2026-11-05')?.source).toBe('AUTO')
  })
})

describe('history keeps its own rate', () => {
  const rows = sortRates([r('2026-01-05', 500), r('2026-11-02', 520)])
  const rate = (d: string) => fxOn(d, rows, 510).rate
  it('sales convert at their own day', () => {
    const list = [
      newSale({ sold_on: '2026-01-06', channel: 'market', kg: 10, amount_crc: 100000, species_key: 'blue-oyster' }),
      newSale({ sold_on: '2026-11-03', channel: 'market', kg: 10, amount_crc: 104000, species_key: 'blue-oyster' }),
    ]
    expect(usdOf(list, rate)).toBeCloseTo(200 + 200)
    expect(byChannel(list, rate)[0].usd).toBeCloseTo(400)
    expect(margin(list, () => 5000, rate).m.usd.cost).toBeCloseTo(100 + 50000 / 520)
  })
  it('lot costs convert at the knock day', () => {
    const lot = { id: 'a', lot_code: 'B0106', species_key: 'blue-oyster', bag_count: 100, knock_date: '2026-01-06', status: 'spent' }
    const l = buildLedger({ lots: [lot], losses: [], harvests: [], items: [], prices: [], moves: [], cooks: [], bills: [], labour: [], prefs: DEFAULT_LEDGER_PREFS }, undefined, rate)
    const c = l.weeks[0].all
    expect(c.usd).toBeCloseTo(c.total / 500)
    expect(c.fx).toBeCloseTo(500)
  })
})
