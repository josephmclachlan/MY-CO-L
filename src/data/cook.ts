// PROPULSION: the cook and sterilization log. Targets, equipment and the log sheet layout.
//
// Every number has a source label. Sources are Joseph's own files only:
//   SHEET       Joseph's substrate temperature log (templates/substrate-temperature-log.pdf)
//   JOSEPH      what Joseph confirmed (4 h steam hold, 5 Nov 2026)
//   FAB REV D   the steam box and boiler fab sheet (rev D) and the steam box sizing notes
//   AVERY       Avery's grain method in the weekly grain spawn workflow (MegaChef and 75X)
//   ELECTRICAL  Joseph's electrical package (4 Nov 2026)
// Anything not in those files is marked GUESS - REVIEW, here and on screen.
//
// Textbook sentences are NOT in this file. They live in src/data/cook/context.json, which the
// public build empties (see vite.config.ts), like the contaminant library.

export type CookKind = 'steam_box' | 'megachef' | 'pressure_75x' | 'other'
export type Purpose = 'substrate' | 'grain' | 'agar' | 'other'

export const KIND_LABEL: Record<CookKind, string> = {
  steam_box: 'STEAM BOX',
  megachef: 'MEGACHEF',
  pressure_75x: '75X',
  other: 'OTHER',
}
export const KIND_LONG: Record<CookKind, string> = {
  steam_box: 'STEAM BOX (9 KW GENERATOR, ROLL-IN CART)',
  megachef: 'MEGACHEF COOKERS (GRAIN)',
  pressure_75x: 'ALL AMERICAN 75X (PRESSURE STERILIZER)',
  other: 'OTHER VESSEL',
}
export const PURPOSE_LABEL: Record<Purpose, string> = { substrate: 'SUBSTRATE', grain: 'GRAIN', agar: 'AGAR', other: 'OTHER' }
export const DEFAULT_PURPOSE: Record<CookKind, Purpose> = { steam_box: 'substrate', megachef: 'grain', pressure_75x: 'grain', other: 'other' }

/** The marker that goes on screen and in the PR for every best guess. */
export const GUESS = 'GUESS - REVIEW'

// ---------- ICE tariff (ELECTRICAL, 4 Nov 2026) ----------
export const ICE_RATE_CRC = 59.67 // per kWh, binomic
export const ICE_DEMAND_CRC_PER_KW = 9861.68 // above 8 kW, on top of the kWh charge
export const ICE_TAX = 1.16
export const ICE_RATE_SOURCE = 'ELECTRICAL: ICE BINOMIC ₡59.67/KWH (4 NOV 2026). BEFORE 16% TAXES AND THE DEMAND CHARGE.'

// ---------- power while a run is going ----------
export const MEGACHEF_W = 1600 // each of 4: 1,600 W / 120 V nameplate (ELECTRICAL equipment list, 8 Nov 2026 spec sheets)
export const X75_W = 1650 // electric, 110 V (ELECTRICAL)
/** Average steam box power during the hold. FAB REV D sizing notes: "holding only needs to cover the losses (1 to 2 kW)". */
export const STEAM_HOLD_KW = 1.5
/** Fraction of full power a 75X draws while holding pressure. */
export const X75_HOLD_FRACTION = 0.5

// ---------- thresholds, °F (SHEET) ----------
export const F_THRESHOLDS = [190, 198, 200, 205] as const
export const HOLD_F = 200 // the hold counts above this (SHEET >200 and JOSEPH 93 C core)
export const CONFIRMED_HOLD_MIN = 240 // JOSEPH, 5 Nov 2026: 4 h
/** The SHEET's "killing time" minimums, low end of each range, in minutes. */
export const SHEET_MINS: { f: 190 | 198 | 200; min: number; range: string }[] = [
  { f: 190, min: 360, range: '6-8 H' },
  { f: 198, min: 270, range: '4.5-5 H' },
  { f: 200, min: 240, range: '4-6 H' },
]
export const OVER_205_MAX_MIN = 180 // SHEET: T < 3 on the 205+ column
export const FERMENT_MAX_MIN = 60 // SHEET: T < 1 on the 115-140 column
export const GAP_WARN_MIN = 45 // readings further apart than this are flagged (GUESS - REVIEW)

// F value, referenced to 97 C / 206 F as printed on the SHEET. z is not on the sheet.
export const F_REF_C = 97
export const F_Z_C = 10 // GUESS - REVIEW: a common working value for bacterial spores (textbook T12)
export const F_IDEAL: [number, number] = [6, 8] // SHEET "6-8 ideal", hours

// ---------- pressure runs (AVERY, ELECTRICAL) ----------
export const PSI_MIN = 15 // GUESS - REVIEW: minutes at or above this count as "at pressure" (121 C); the 75X gauge wobbles
export const PSI_AVERY = 17
export const X75_GRAIN_HOLD_MIN = 105 // AVERY: 1 h 45 min at 17 psi, stopcock model
export const X75_OTHER_HOLD_MIN = 35 // GUESS - REVIEW: no agar figure in the sources; textbook minimum for jars and grain
export const MEGA_COMEUP: [number, number] = [10, 12] // AVERY cooker clip 1:30, minutes to pressure
export const MEGA_COOK: [number, number] = [12, 15] // AVERY cooker clip 0:46-1:14, minutes

/** How long a run is expected to take, for the "start now" peak check. Minutes. */
export function expectedMinutes(kind: CookKind, heaterW: number): { comeUp: number; hold: number } {
  if (kind === 'steam_box') {
    // FAB REV D run table: coldest bag to 200 F in about 7 h at 9 kW (the 4 h in the older sizing notes is superseded);
    // scaled by power for the 6.5 kW option (GUESS - REVIEW).
    const comeUp = Math.round((7 * 60 * 9000) / Math.max(1000, heaterW))
    return { comeUp, hold: CONFIRMED_HOLD_MIN }
  }
  if (kind === 'megachef') return { comeUp: 11, hold: 14 }
  if (kind === 'pressure_75x') return { comeUp: 60, hold: X75_GRAIN_HOLD_MIN } // 1 h to pressure is AVERY's ASSUMPTION in the workflow
  return { comeUp: 0, hold: 0 }
}

// ---------- equipment ----------
export interface CookUnit {
  id: string
  kind: CookKind
  label: string
  purpose: Purpose
}
export const UNITS: CookUnit[] = [
  { id: 'steam', kind: 'steam_box', label: 'STEAM BOX', purpose: 'substrate' },
  { id: 'mega-batch', kind: 'megachef', label: 'MEGACHEFS (BATCH)', purpose: 'grain' },
  { id: '75x', kind: 'pressure_75x', label: '75X STERILIZER', purpose: 'grain' },
]

// ---------- zones ----------
/** Probe positions on the steam box (FAB REV D: PT100 for box air, needle in the coldest bag). */
export const ZONES: { id: string; label: string; judged: boolean }[] = [
  { id: 'AIR', label: 'BOX AIR (PT100)', judged: false },
  { id: 'CORE', label: 'CORE: COLDEST BAG, BOTTOM SHELF, CENTRE', judged: true },
  { id: 'TOP', label: 'CORE: TOP SHELF', judged: true },
  { id: 'MID', label: 'CORE: MIDDLE SHELF', judged: true },
  { id: 'BOTTOM', label: 'CORE: BOTTOM SHELF, BACK', judged: true },
]
export const DEFAULT_ZONES: Record<CookKind, string[]> = {
  steam_box: ['AIR', 'CORE'],
  megachef: [],
  pressure_75x: ['GAUGE'],
  other: ['PROBE 1'],
}
/** Zones with these names are not judged: the box air and the pressure gauge. */
export const isJudged = (zone: string) => !/^(AIR|GAUGE|ROOM)/i.test(zone.trim())

// ---------- the log sheet, in the layout of Joseph's PDF ----------
export interface SheetCol {
  key: string
  head: string
  sub: string
  tone: string // header colour (the sheet's own)
  tint: string // body tint
  sup?: string // text above the header
  supSpan?: number // how many columns that text covers
  span?: number // how many columns the heading covers
}

const C = {
  cyan: ['#4dd0e1', '#e0f7fa'],
  green: ['#63d297', '#e6f8ee'],
  amber: ['#f7ca4e', '#fdf3d4'],
  blue: ['#5b97f9', '#e3ecfd'],
  orange: ['#f56a22', '#fde3d5'],
  teal: ['#26a69a', '#dcf1ee'],
  tan: ['#cda677', '#f6ece0'],
  dred: ['#c93d24', '#f6d3cc'],
  red: ['#e06666', '#f8d6d6'],
  pink: ['#ea9999', '#fae1e1'],
  grey: ['#bbbbbb', '#ececec'],
  rose: ['#ff0000', '#e06666'],
  lime: ['#8bc34a', '#f0f7e3'],
  plain: ['#f3f3f3', '#ffffff'],
} as const
const col = (key: string, head: string, sub: string, c: keyof typeof C, sup?: string, supSpan?: number): SheetCol => ({ key, head, sub, tone: C[c][0], tint: C[c][1], sup, supSpan })

export const SHEET_COLS: SheetCol[] = [
  { ...col('date', 'Data Point', 'date', 'plain', 'T = time'), span: 3 },
  col('vessel', '', 'vessel', 'plain'),
  col('location', '', 'location', 'plain'),
  col('b140', 'Early Biological & Chemical Activity', 'T = 140-160', 'cyan', 'preconditioning'),
  col('b160', 'Hemicellulose Hydrolysis Onset', 'T = 160-180', 'green', 'nutes break down'),
  col('b180', 'Highest Chemical & Structural Damage', 'T = 180-200', 'amber', 'rapid maillard reaction'),
  col('b200', 'Effective Sterilization', 'T = 200-205', 'blue', 'main working zone'),
  col('b205', 'Peak Zone / Overprocessing', 'T = 205+', 'orange', 'T < 3'),
  { ...col('r140', 'Inefficiencies / Damage Accumulation', '140-180 ramp', 'teal', 'fastest here wins', 3), span: 3 },
  col('r180', '', '180-200 ramp', 'teal'),
  col('r200', '', '200-peak ramp', 'teal'),
  { ...col('t160', 'Thermal Penetration Curve', 'time to 160', 'tan', 'how heat moves through substrate', 3), span: 3 },
  col('t180', '', 'time to 180', 'tan'),
  col('t200', '', 'time to 200', 'tan'),
  col('h190', 'Minimum 6-8 hours', 'T > 190', 'dred', 'killing time', 4),
  col('h198', 'Minimum 4.5-5 hours', 'T > 198', 'red'),
  col('h200', 'Minimum 4-6 hours', 'T > 200', 'pink'),
  col('h205', 'Overprocessing', 'T > 205', 'grey'),
  col('a140', 'Microbial Activity / Chemistry Modification', 'ambient - 140', 'cyan', 'move quickly'),
  col('f80', 'Primary Fermentation', 'time in 80-115', 'amber'),
  col('f115', 'Microbial Activity Zone', 'time in 115-140', 'orange', 'T < 1'),
  col('max', 'Max temp', 'max temp', 'rose'),
  col('f', '(F) Lethality / Kill zone', 'F = 97C/206F', 'lime', '6-8 ideal'),
]

/** Where each sheet column's text comes from, for the TARGETS tab. */
export interface Target {
  id: string
  what: string
  want: string
  source: string
  guess?: boolean
}
export const TARGETS: Target[] = [
  { id: 'hold-farm', what: 'STEAM HOLD, COLDEST CORE ABOVE 200 F (93 C)', want: '4 H (240 MIN)', source: 'JOSEPH 5 NOV 2026 (CONFIRMED). REV D STEAMBOX TIMER SETTING OF 2 H IS SUPERSEDED.' },
  { id: 'sheet-190', what: 'KILLING TIME, CORE ABOVE 190 F', want: '6-8 H. LOW END (6 H) USED AS THE MINIMUM', source: "SHEET: 'MINIMUM 6-8 HOURS, T > 190'" },
  { id: 'sheet-198', what: 'KILLING TIME, CORE ABOVE 198 F', want: '4.5-5 H. LOW END (4.5 H) USED', source: "SHEET: 'MINIMUM 4.5-5 HOURS, T > 198'" },
  { id: 'sheet-200', what: 'KILLING TIME, CORE ABOVE 200 F', want: '4-6 H. LOW END (4 H) USED. SAME AS THE CONFIRMED HOLD', source: "SHEET: 'MINIMUM 4-6 HOURS, T > 200'" },
  { id: 'sheet-any', what: 'HOW THE THREE MINIMUMS COMBINE', want: 'PASS WHEN ANY ONE IS MET ON THE SLOWEST CORE', source: 'SHEET GROUPS THEM UNDER "KILLING TIME". READING THEM AS ALTERNATIVES IS MY GUESS.', guess: true },
  { id: 'over-205', what: 'TIME ABOVE 205 F (OVERPROCESSING)', want: 'UNDER 3 H. A WARNING, NOT A FAIL', source: "SHEET: 'PEAK ZONE / OVERPROCESSING, T < 3'. WARNING-ONLY IS MY GUESS.", guess: true },
  { id: 'ferment', what: 'TIME IN 115-140 F ON THE WAY UP', want: 'UNDER 1 H', source: "SHEET: 'MICROBIAL ACTIVITY ZONE, T < 1'" },
  { id: 'quick', what: 'AMBIENT TO 140 F, AND 80-115 F', want: 'MOVE QUICKLY, KEEP SHORT', source: "SHEET: 'MOVE QUICKLY', 'PRIMARY FERMENTATION'" },
  { id: 'ramps', what: 'RAMPS 140-180, 180-200 AND 200-PEAK', want: 'FASTEST HERE WINS', source: "SHEET: 'INEFFICIENCIES / DAMAGE ACCUMULATION'" },
  { id: 'f', what: 'F VALUE AT 97 C / 206 F', want: '6-8 H IDEAL', source: 'SHEET: F = 97C/206F, 6-8 IDEAL. THE Z VALUE (10 C) IS NOT ON THE SHEET.', guess: true },
  { id: 'judged', what: 'WHICH PROBE JUDGES THE RUN', want: 'THE SLOWEST BAG CORE. BOX AIR IS NOT JUDGED', source: 'FAB REV D: START THE HOLD WHEN THE COLDEST BAG PASSES 93 C. WHICH ZONE NAMES COUNT AS CORES IS MY GUESS.', guess: true },
  { id: 'comeup', what: 'COME-UP TO CORE TEMPERATURE, 9 KW', want: 'ABOUT 7 H (ABOUT 16 H ON ONE 4.5 KW ELEMENT)', source: 'FAB REV D RUN TABLE (130 BAGS, INSULATED BOX). THE OLDER SIZING NOTES SAID 4 H; REV D SUPERSEDES THEM. INFORMATION ONLY.' },
  { id: 'x75', what: '75X GRAIN HOLD AT PRESSURE', want: '1 H 45 MIN AT 17 PSI', source: 'AVERY Q&A, STOPCOCK MODEL. THE LOG COUNTS MINUTES AT 15 PSI OR MORE (GAUGE WOBBLE) - MY GUESS.', guess: true },
  { id: 'x75-agar', what: '75X AGAR / OTHER HOLD AT PRESSURE', want: '35 MIN AT 15 PSI', source: 'NO AGAR FIGURE IN JOSEPH\'S FILES. USED THE TEXTBOOK MINIMUM FOR JARS AND GRAIN.', guess: true },
  { id: 'x75-time', what: '75X HEAT-UP AND COOL-DOWN', want: 'ABOUT 1 H AND 1-1.5 H', source: 'AVERY WORKFLOW ASSUMPTION, NOT MEASURED. YOUR FIRST LOGGED RUN REPLACES IT.' },
  { id: 'mega-up', what: 'MEGACHEF TIME TO PRESSURE', want: '10-12 MIN', source: 'AVERY COOKER CLIP 1:30' },
  { id: 'mega-cook', what: 'MEGACHEF COOK', want: '12-15 MIN (14 WHEN WARM). SLIGHTLY UNDER BEATS OVER', source: 'AVERY COOKER CLIP 0:46-1:14' },
  { id: 'energy', what: 'ENERGY PRICE', want: '₡59.67 PER KWH', source: ICE_RATE_SOURCE },
  { id: 'peak', what: 'PEAK WINDOWS TO AVOID FOR HEAVY LOADS', want: '10:00-12:30 AND 17:30-20:00', source: 'ELECTRICAL: HEAVY LOADS OFF ICE PEAK WINDOWS' },
  { id: 'hold-kw', what: 'STEAM BOX POWER DURING THE HOLD', want: 'ABOUT 1.5 KW AVERAGE', source: 'FAB REV D SIZING: HOLDING ONLY COVERS THE LOSSES, 1-2 KW. THE ENERGY ESTIMATE IS A GUESS; A METER READING OR HEATER ON-TIME REPLACES IT.', guess: true },
]
