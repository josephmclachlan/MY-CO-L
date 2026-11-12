import type { Species, Fact, TempBands } from './types'
import { planBagsFor } from '../cropplan'

const mods = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, Species>

export const SPECIES: Species[] = Object.values(mods).sort((a, b) => a.order - b.order)

/** Weekly run confirmed by Joseph 5 Nov 2026. The old crop split was written for 100 bags. */
export const WEEKLY_BAGS = 130
export const PLAN_BASE_BAGS = 100
/** Fruiting room set point from the HVAC plan (1 Nov 2026): 16 C, band 14-17, max 18. */
export const FRUIT_ROOM_C = 16

/** Bags in a week this species runs, from the crop plan and the chosen secondary-slot rotation (src/data/cropplan.ts). */
export function planBags(sp: Species): number | null {
  return planBagsFor(sp.id)
}

export type Verdict = { level: 'ideal' | 'range' | 'edge' | 'conflict' | 'none'; text: string }

const inside = (bands: [number, number][] | undefined, t: number) => !!bands?.some(([a, b]) => t >= a && t <= b)
const atEdge = (bands: [number, number][] | undefined, t: number) => !!bands?.some(([a, b]) => t === a || t === b)

/** Does this species' stated fruiting range cover the 16 C room? */
export function fruitVerdict(t: TempBands | null, room = FRUIT_ROOM_C): Verdict {
  if (!t) return { level: 'none', text: 'NO DATA IN SOURCES' }
  if (inside(t.ideal, room)) return atEdge(t.ideal, room) ? { level: 'edge', text: `${room} °C IS THE EDGE OF THE STATED IDEAL BAND` } : { level: 'ideal', text: `${room} °C IS INSIDE THE STATED IDEAL BAND` }
  if (inside(t.range, room)) return { level: 'range', text: `${room} °C IS INSIDE THE STATED RANGE` }
  return { level: 'conflict', text: `${room} °C IS OUTSIDE EVERY BAND THE SOURCES STATE` }
}

export const hasGaps = (facts: Fact[]) => facts.some((f) => f.f === 'nodata')

const REF: [RegExp, string][] = [
  [/^F18-9/, 'Textbook t21 growth metrics (added fact)'],
  [/^F18-/, 'Textbook t21 growth metrics'],
  [/^F17-8/, 'Textbook t20 species profiles: podcast or consult fact'],
  [/^F17-/, 'Textbook t20 species profiles'],
  [/^F00-/, 'Textbook t24 quick-reference cards'],
  [/^F03-/, 'Textbook t07 culture work'],
  [/^F05-/, 'Textbook t09 grain spawn'],
  [/^F07-/, 'Textbook t11 bags and inoculation'],
  [/^F08-/, 'Textbook t12 steam, pasteurizing and sterilizing'],
  [/^F11-/, 'Textbook t13 incubation'],
  [/^F12-/, 'Textbook t14 fruiting'],
  [/^F13-/, 'Textbook t15 harvest, storage and preservation'],
  [/^F14-8/, 'Textbook t16 contamination: consult or podcast fact'],
  [/^F14-9/, 'Textbook t16 contamination: added fact'],
  [/^F14-/, 'Textbook t16 contamination'],
  [/^F15-8/, 'Textbook t17 diseases, pests and water: consult or podcast fact'],
  [/^F15-/, 'Textbook t17 diseases, pests and water'],
  [/^F19-8/, 'Textbook t22 running the business: podcast or consult fact'],
  [/^F19-/, 'Textbook t22 running the business'],
  [/^F20-8/, 'Textbook t02 fungal biology, genetics and history: podcast or consult fact'],
  [/^F20-/, 'Textbook t02 fungal biology, genetics and history'],
  [/^CATAWBA$/, 'Catawba analysis (Ryan\'s 2024-26 records)'],
  [/^FARM-PLAN$/, 'Farm crop plan (handoff notes)'],
]
export function srcLabel(id: string): string {
  return REF.find(([re]) => re.test(id))?.[1] ?? id
}
