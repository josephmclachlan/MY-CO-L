// LEDGER and TRADE constants. Every figure names where it came from.
// Anything not in Joseph's files is marked GUESS and shown on screen as GUESS - REVIEW.

export { GUESS } from './cook'

// ---------- ICE bill (electrical package, 4 Nov 2026: calculations/build_data.py) ----------

/** Binomic tariff: energy + demand above 8 kW (10 kW minimum), fixed charge, x1.16 taxes. */
export const ICE = {
  energyCrcPerKwh: 59.67,
  demandCrcPerKw: 9861.68,
  demandFreeKw: 8,
  demandMinKw: 10,
  fixedCrc: 7924.29,
  tax: 1.16,
  source: 'ELECTRICAL PACKAGE 4 NOV 2026 (BUILD_DATA.PY): ₡59.67/KWH + ₡9,861.68/KW ABOVE 8 KW (10 KW MIN) + ₡7,924 FIXED, X1.16 TAXES',
}

/** The package's monthly bill range at the central HVAC case (4,762 kWh): heavy loads off peak vs heater on a hot peak. */
export const BILL_ESTIMATE = { low: 362000, high: 422000, kwh: 4762, source: 'ELECTRICAL PACKAGE: ₡362,000-422,000 PER MONTH, CENTRAL HVAC CASE, 4,762 KWH' }
export const BILL_ESTIMATE_MID = (BILL_ESTIMATE.low + BILL_ESTIMATE.high) / 2

/** What ICE should bill for a month, from the meter figures. */
export function iceBill(kwh: number, billedKw: number | null): number {
  const kw = Math.max(billedKw ?? ICE.demandMinKw, ICE.demandMinKw)
  return (ICE.fixedCrc + ICE.energyCrcPerKwh * kwh + Math.max(0, kw - ICE.demandFreeKw) * ICE.demandCrcPerKw) * ICE.tax
}

// ---------- the crop (farm facts, Joseph 5 Nov 2026) ----------

export const WEEK_BAGS = 130
/** The 130-bag split from the farm notes. Golden alternates with phoenix week to week. */
export const PLAN_SPLIT: { key: string; bags: number }[] = [
  { key: 'blue-oyster', bags: 52 },
  { key: 'lions-mane', bags: 46 },
  { key: 'comb-tooth', bags: 16 },
  { key: 'golden-oyster', bags: 16 },
]

export const LB_KG = 0.45359237

/** Fresh lb per block, Catawba's real yields (farm facts). Phoenix uses Catawba's Italian as a stand-in. */
export const YIELD_LB: Record<string, { lb: number; guess?: boolean; note: string }> = {
  'blue-oyster': { lb: 2.03, note: 'CATAWBA RECORDS' },
  'lions-mane': { lb: 1.63, note: 'CATAWBA RECORDS' },
  'comb-tooth': { lb: 2.03, note: 'CATAWBA RECORDS' },
  'golden-oyster': { lb: 1.28, note: 'CATAWBA RECORDS' },
  'phoenix-oyster': { lb: 1.09, note: "CATAWBA'S ITALIAN OYSTER AS A STAND-IN" },
  'pink-oyster': { lb: 1.44, note: 'CATAWBA RECORDS' },
}

/** Days a block sits in the rooms, knock to last pick. Knock to first harvest is from the farm facts;
 *  the picking days after it are a GUESS (one flush for oysters about a week; lion's mane two flushes). */
export const ROOM_DAYS: Record<string, { first: number; pick: number }> = {
  'blue-oyster': { first: 23, pick: 7 },
  'lions-mane': { first: 24, pick: 21 },
  'comb-tooth': { first: 31, pick: 7 },
  'golden-oyster': { first: 26.5, pick: 7 },
  'phoenix-oyster': { first: 21, pick: 7 },
  'pink-oyster': { first: 18, pick: 7 },
}
export const ROOM_DAYS_OTHER = { first: 30, pick: 14 } // GUESS for species with no figure
export const roomDays = (key: string) => {
  const d = ROOM_DAYS[key] ?? ROOM_DAYS_OTHER
  return d.first + d.pick
}

// ---------- TRADE ----------

export type Channel = 'market' | 'restaurant' | 'shop' | 'direct' | 'delivery' | 'other'
/** GUESS - REVIEW: the channel list. The database already had market, restaurant, shop, direct, other; delivery is added by 0006. */
export const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'market', label: 'MARKET' },
  { id: 'restaurant', label: 'RESTAURANT' },
  { id: 'shop', label: 'SHOP' },
  { id: 'direct', label: 'DIRECT' },
  { id: 'delivery', label: 'DELIVERY' },
  { id: 'other', label: 'OTHER' },
]

export type Form = 'fresh' | 'dried' | 'other'
export const FORMS: { id: Form; label: string }[] = [
  { id: 'fresh', label: 'FRESH' },
  { id: 'dried', label: 'DRIED' },
  { id: 'other', label: 'OTHER' },
]

/** GUESS - REVIEW: grade names. */
export const GRADES = ['A', 'B', 'SECONDS'] as const

/** Species offered on the sale form: the crop plan first, then the rest that have a lot letter. */
export const SALE_SPECIES = ['blue-oyster', 'lions-mane', 'comb-tooth', 'golden-oyster', 'phoenix-oyster', 'pink-oyster', 'black-pearl', 'king-oyster', 'chestnut', 'pioppino', 'shiitake', 'maitake', 'reishi', 'cordyceps']

/** Fresh price per kg. Oysters ₡10,000-13,000 (Joseph). Lion's mane and coral +20% is a GUESS. Dried has no default. */
export const OYSTER_PRICE: [number, number] = [10000, 13000]
export const PREMIUM = 1.2
export const PREMIUM_SPECIES = new Set(['lions-mane', 'comb-tooth'])
export function defaultPrice(key: string, form: Form): { lo: number; hi: number; mid: number; guess: boolean } | null {
  if (form !== 'fresh') return null
  const prem = PREMIUM_SPECIES.has(key)
  const oyster = key.endsWith('-oyster') || key === 'black-pearl'
  if (!prem && !oyster) return null
  const k = prem ? PREMIUM : 1
  const lo = OYSTER_PRICE[0] * k
  const hi = OYSTER_PRICE[1] * k
  return { lo, hi, mid: (lo + hi) / 2, guess: prem }
}

// ---------- the guesses, listed on screen ----------

export const LEDGER_GUESSES = [
  'LABOUR IS PART OF THE COST WHEN THE SWITCH IS ON (DEFAULT ON). THE HOURLY RATE STARTS BLANK, SO LABOUR SHOWS HOURS BUT ₡0 UNTIL YOU TYPE ONE.',
  'EQUIPMENT WEAR IS OFF BY DEFAULT. TURN IT ON AND TYPE ₡ PER BLOCK.',
  'ROOM ENERGY: THE BILL LESS THE COOK RUNS, SHARED BY BAG-DAYS IN THE ROOMS. A MONTH WITH NO BILL USES THE PACKAGE ESTIMATE SHARED OVER A FULL 130-BAG FARM.',
  'DAYS IN THE ROOMS = KNOCK TO FIRST HARVEST (FARM FACTS) PLUS 7 PICKING DAYS (21 FOR LION\'S MANE, TWO FLUSHES).',
  'CONSUMABLES AND COOK ENERGY OF A WEEK ARE SHARED EQUALLY PER BLOCK ACROSS THAT WEEK\'S LOTS (SPAWN IS NOT TRACKED BY SPECIES YET).',
]

export const TRADE_GUESSES = [
  'CHANNELS: MARKET, RESTAURANT, SHOP, DIRECT, DELIVERY (PLUS OTHER).',
  'DEFAULT FRESH PRICE: OYSTERS ₡11,500/KG (MIDDLE OF YOUR ₡10,000-13,000). LION\'S MANE AND CORAL +20% = ₡13,800/KG.',
  'GRADES: A, B, SECONDS.',
  'DRIED HAS NO DEFAULT PRICE. TYPE THE ₡ AMOUNT.',
]
