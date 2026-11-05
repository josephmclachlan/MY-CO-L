// Real farm facts used for boot, idle and menu text. Sources: Joseph's
// electrical package (status 4 Nov 2026) and the 100-bag farm schedule.
// The "noise" on boot and idle screens is made of these codes, never nonsense.

export const STATION = {
  company: 'NEGRA BAY BIOLOGICS',
  station: 'TALAMANCA STATION',
  place: 'PLAYA NEGRA // LIMON // CR',
  system: 'MY/CO/L',
  longName: 'MYCOLOGICAL CONTROL LATTICE',
  build: '0.2.0',
}

// Species letters used in lot codes (species letter + knock date MMDD, e.g. B1020).
// Letters other than B are a first guess; correct them here if yours differ.
export const SPECIES_LETTERS = ['B', 'L', 'C', 'G', 'P'] as const

// Breaker tags on the 18-circuit sub-panel.
export const BREAKERS = Array.from({ length: 18 }, (_, i) => `S${i + 1}`)

export const SELF_TEST: [string, string][] = [
  ['MAINS 120/240V 60HZ SPLIT PHASE', 'OK'],
  ['ICE SERVICE 125A / MAIN 200A', 'OK'],
  ['FEEDER 3/0 AL 115M', 'OK'],
  ['SUBPANEL S1-S18 60A 2P', '18 CKT'],
  ['BASELINE L1 53.8A  L2 53.1A', '43%'],
  ['HVAC 2x36K + 2x12K INVERTER', 'NOMINAL'],
  ['HEPA FFU x3', 'NOMINAL'],
  ['COLD ROOMS x2', 'NOMINAL'],
  ['GENERATOR XP15000HX', 'STANDBY'],
  ['KNOCK PLAN', '100 BLK/WK'],
]

/** A plausible lot code from recent Tuesdays (knock day). */
export function lotCode(offsetWeeks = 0): string {
  const d = new Date()
  const back = (d.getDay() + 5) % 7 // days since last Tuesday
  d.setDate(d.getDate() - back - offsetWeeks * 7)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const s = SPECIES_LETTERS[Math.floor(Math.random() * SPECIES_LETTERS.length)]
  return `${s}${mm}${dd}`
}

/** One row of farm-code noise for the data columns. */
export function codeRow(): string {
  const r = Math.random()
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0')
  if (r < 0.3) return `${lotCode(Math.floor(Math.random() * 6))} ${hex()}`
  if (r < 0.55) {
    const b = BREAKERS[Math.floor(Math.random() * BREAKERS.length)].padEnd(3, ' ')
    return `${b} ${(Math.random() * 30).toFixed(1).padStart(4, '0')}A`
  }
  if (r < 0.7) return `P${1 + Math.floor(Math.random() * 4)}.${String(Math.floor(Math.random() * 17) + 1).padStart(2, '0')} ${hex()}`
  if (r < 0.85) return `${(15 + Math.random() * 4).toFixed(1)}C ${(85 + Math.random() * 10).toFixed(0)}%`
  return `${hex()} ${hex()}`
}

export interface ModuleDef {
  key: string // what to type at the prompt
  num: number
  name: string
  what: string
  build: number // which build thread delivers it
}

export const MODULES: ModuleDef[] = [
  { key: 'SPECIMEN', num: 1, name: 'SPECIMEN FILES', what: 'SPECIES READOUTS', build: 3 },
  { key: 'VITALS', num: 2, name: 'VITALS', what: 'POWER AND BREAKERS', build: 2 },
  { key: 'DECK', num: 3, name: 'DECK PLAN', what: 'ROOMS AND EQUIPMENT', build: 2 },
  { key: 'CARGO', num: 4, name: 'CARGO', what: 'STOCK MANIFEST', build: 4 },
  { key: 'XENO', num: 5, name: 'XENOGENETICS', what: 'STRAINS AND CULTURES', build: 5 },
  { key: 'HAZARD', num: 6, name: 'HAZARD INDEX', what: 'CONTAMINANTS AND PESTS', build: 8 },
  { key: 'PROPULSION', num: 7, name: 'PROPULSION', what: 'STEAM AND COOK LOG', build: 6 },
  { key: 'LEDGER', num: 8, name: 'LEDGER', what: 'COST OF GOODS', build: 9 },
  { key: 'TRADE', num: 9, name: 'TRADE', what: 'SALES', build: 9 },
]
