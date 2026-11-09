// LEDGER and TRADE constants. Every figure names where it came from.
// Anything not in Joseph's files is marked GUESS and shown on screen as GUESS - REVIEW.

export { GUESS } from './cook'

// ---------- ICE bill (electrical package, 4 Nov 2026: calculations/build_data.py) ----------

// The numbers themselves are editable on PRICES + COSTS (src/lib/rates.ts). These are the source notes.
export const ICE = {
  source: 'BUILT-IN: ELECTRICAL PACKAGE 4 NOV 2026 (BUILD_DATA.PY): ₡59.67/KWH + ₡9,861.68/KW ABOVE 8 KW (10 KW MIN) + ₡7,924 FIXED, X1.16 TAXES',
}
/** The package's monthly bill range at the central HVAC case (4,762 kWh): heavy loads off peak vs heater on a hot peak. */
export const BILL_ESTIMATE = { kwh: 4762, source: 'ELECTRICAL PACKAGE: ₡362,000-422,000 PER MONTH, CENTRAL HVAC CASE, 4,762 KWH' }

// ---------- the crop (farm facts, Joseph 5 Nov 2026) ----------

export const WEEK_BAGS = 130
// The weekly split (core + rotating secondary slot) lives in src/data/cropplan.ts.

export const LB_KG = 0.45359237

/** Fresh lb per block, Catawba's real yields (farm facts). Phoenix uses Catawba's Italian as a stand-in. */
export const YIELD_LB: Record<string, { lb: number; guess?: boolean; note: string }> = {
  'blue-oyster': { lb: 2.03, note: 'CATAWBA RECORDS' },
  'lions-mane': { lb: 1.63, note: 'CATAWBA RECORDS' },
  'comb-tooth': { lb: 2.03, note: 'CATAWBA RECORDS' },
  'golden-oyster': { lb: 1.28, note: 'CATAWBA RECORDS' },
  'phoenix-oyster': { lb: 1.09, note: "CATAWBA'S ITALIAN OYSTER AS A STAND-IN" },
  'pink-oyster': { lb: 1.44, note: 'CATAWBA RECORDS' },
  chestnut: { lb: 1.41, note: 'CATAWBA RECORDS' },
  pioppino: { lb: 0.86, note: 'CATAWBA RECORDS' },
  'black-pearl': { lb: 1.15, note: 'CATAWBA RECORDS' },
  'king-oyster': { lb: 0.86, note: 'CATAWBA RECORDS' },
  maitake: { lb: 0.67, note: 'CATAWBA RECORDS' },
}

/** Days a block sits in the rooms, knock to last pick. Both numbers are Catawba's 2026 harvest log (Joseph, 9 Nov 2026:
 *  Catawba is the baseline for all growth and harvest planning). first = median knock to first harvest;
 *  pick = days from first to last pick of a lot, 90th percentile (most lots are picked in 0-3 days, one flush). */
export const ROOM_DAYS: Record<string, { first: number; pick: number }> = {
  'blue-oyster': { first: 23, pick: 3 },
  'lions-mane': { first: 24, pick: 4 },
  'comb-tooth': { first: 31, pick: 3 },
  'golden-oyster': { first: 26.5, pick: 6 },
  'phoenix-oyster': { first: 21, pick: 3 }, // Catawba's Italian oyster as the stand-in
  'pink-oyster': { first: 18, pick: 4 },
  chestnut: { first: 65, pick: 6 },
  pioppino: { first: 34, pick: 6 },
  'black-pearl': { first: 32, pick: 5 },
  'king-oyster': { first: 36, pick: 7 },
  maitake: { first: 59, pick: 8 },
}
export const ROOM_DAYS_OTHER = { first: 30, pick: 5 } // GUESS for species with no Catawba figure (pick = Catawba's typical 90th percentile)
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
// The price used on the sale form: salePrice() in src/lib/rates.ts (your price, else this default).

// ---------- the guesses, listed on screen ----------

export const LEDGER_GUESSES = [
  'LABOUR IS PART OF THE COST WHEN THE SWITCH IS ON (DEFAULT ON). THE HOURLY RATE STARTS BLANK, SO LABOUR SHOWS HOURS BUT ₡0 UNTIL YOU TYPE ONE.',
  'EQUIPMENT WEAR IS OFF BY DEFAULT. TURN IT ON AND TYPE ₡ PER BLOCK.',
  'ROOM ENERGY: THE BILL LESS THE COOK RUNS, SHARED BY BAG-DAYS IN THE ROOMS. A MONTH WITH NO BILL USES THE PACKAGE ESTIMATE SHARED OVER A FULL 130-BAG FARM.',
  'DAYS IN THE ROOMS = KNOCK TO FIRST HARVEST PLUS PICKING DAYS, BOTH FROM CATAWBA\'S 2026 HARVEST LOG (YOUR CALL, 9 NOV 2026). PICKING DAYS = FIRST TO LAST PICK OF A LOT, 90TH PERCENTILE: 3-4 FOR BLUE, LION\'S MANE, COMB TOOTH, PINK; 6 FOR GOLDEN.',
  'CONSUMABLES AND COOK ENERGY OF A WEEK ARE SHARED EQUALLY PER BLOCK ACROSS THAT WEEK\'S LOTS (SPAWN IS NOT TRACKED BY SPECIES YET).',
]

export const TRADE_GUESSES = [
  'CHANNELS: MARKET, RESTAURANT, SHOP, DIRECT, DELIVERY (PLUS OTHER).',
  'DEFAULT FRESH PRICE: OYSTERS ₡11,500/KG (MIDDLE OF YOUR ₡10,000-13,000). LION\'S MANE AND CORAL +20% = ₡13,800/KG.',
  'GRADES: A, B, SECONDS.',
  'DRIED HAS NO DEFAULT PRICE. TYPE THE ₡ AMOUNT.',
]
