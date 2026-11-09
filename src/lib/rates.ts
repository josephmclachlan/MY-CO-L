// Every price and cost the app uses, in one record you can change on the PRICES + COSTS screen.
// Saved in the app_settings table (row id 'rates'), so phone and laptop agree once Supabase is linked.
// Values left blank fall back to the defaults below, which name their source.

import { FRESH_PRICE, type Form } from '../data/ledger'

export interface IceRates {
  energyCrcPerKwh: number
  demandCrcPerKw: number
  demandFreeKw: number
  demandMinKw: number
  fixedCrc: number
  tax: number // multiplier, 1.16 = +16%
  estimateLow: number // ₡ per month used before a real bill exists
  estimateHigh: number
}

export interface Rates {
  fx: number // ₡ per US$
  ice: IceRates
  labourOn: boolean
  labourRate: number | null // ₡ per hour
  wearOn: boolean
  wearPerBlock: number | null
  /** ₡ per kg by species key and form. A missing entry uses the default price. */
  sale: Record<string, Partial<Record<Form, number>>>
}

export const DEFAULT_ICE: IceRates = {
  energyCrcPerKwh: 59.67,
  demandCrcPerKw: 9861.68,
  demandFreeKw: 8,
  demandMinKw: 10,
  fixedCrc: 7924.29,
  tax: 1.16,
  estimateLow: 362000,
  estimateHigh: 422000,
}

export const DEFAULT_RATES: Rates = {
  fx: 510,
  ice: DEFAULT_ICE,
  labourOn: false, // Joseph 6 Nov 2026: labour not in costs, hours tracked for efficiency
  labourRate: null,
  wearOn: true, // Joseph 6 Nov 2026: count equipment wear
  wearPerBlock: null,
  sale: {},
}

export const RATES_ID = 'rates'

/** Built-in fresh price per kg: ₡13,000 for every mushroom (Joseph, 6 Nov 2026). */
export function builtInPrice(_key: string, form: Form): number | null {
  return form === 'fresh' ? FRESH_PRICE : null
}

const pos = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

/** Merge a saved record over the defaults, dropping anything that is not a usable number. */
export function mergeRates(saved: unknown): Rates {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Rates>
  const ice = { ...DEFAULT_ICE }
  for (const k of Object.keys(DEFAULT_ICE) as (keyof IceRates)[]) {
    const v = (s.ice as Partial<IceRates> | undefined)?.[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) ice[k] = v
  }
  const sale: Rates['sale'] = {}
  if (s.sale && typeof s.sale === 'object')
    for (const [k, v] of Object.entries(s.sale)) {
      const e: Partial<Record<Form, number>> = {}
      for (const f of ['fresh', 'dried', 'other'] as Form[]) {
        const n = pos((v as Record<string, unknown> | undefined)?.[f])
        if (n !== null) e[f] = n
      }
      if (Object.keys(e).length) sale[k] = e
    }
  return {
    fx: pos(s.fx) ?? DEFAULT_RATES.fx,
    ice,
    labourOn: typeof s.labourOn === 'boolean' ? s.labourOn : DEFAULT_RATES.labourOn,
    labourRate: pos(s.labourRate),
    wearOn: typeof s.wearOn === 'boolean' ? s.wearOn : DEFAULT_RATES.wearOn,
    wearPerBlock: pos(s.wearPerBlock),
    sale,
  }
}

// ---------- the live copy every pure function reads ----------

let live: Rates = DEFAULT_RATES
export const rates = (): Rates => live
/** Called by the store hook when the saved record changes. Tests can call it too. */
export function setLiveRates(r: Rates) {
  live = r
}

/** ₡ per kg for a sale: your price if set, else the built-in default. */
export function salePrice(key: string, form: Form, r: Rates = live): { price: number | null; mine: boolean } {
  const mine = r.sale[key]?.[form]
  if (mine) return { price: mine, mine: true }
  return { price: builtInPrice(key, form), mine: false }
}

export const estimateMid = (r: Rates = live) => (r.ice.estimateLow + r.ice.estimateHigh) / 2

/** What ICE should bill for a month, from the meter figures. */
export function iceBill(kwh: number, billedKw: number | null, r: Rates = live): number {
  const i = r.ice
  const kw = Math.max(billedKw ?? i.demandMinKw, i.demandMinKw)
  return (i.fixedCrc + i.energyCrcPerKwh * kwh + Math.max(0, kw - i.demandFreeKw) * i.demandCrcPerKw) * i.tax
}
