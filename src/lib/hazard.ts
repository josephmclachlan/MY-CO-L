// HAZARD INDEX logic: kinds, filters, the diagnose helper and logged-loss counts.
import { HAZARDS } from '../data/hazards'
import type { Colour, Hazard, Kind, Place, Smell, Stage, Texture } from '../data/hazards/types'
import type { Row } from './store'

export const KIND_ORDER: Kind[] = ['mould', 'bacteria', 'yeast', 'disease', 'pest', 'water', 'other', 'notcontam']
export const KIND_LABEL: Record<Kind, string> = {
  mould: 'MOULD',
  bacteria: 'BACTERIA',
  yeast: 'YEAST',
  disease: 'DISEASE',
  pest: 'PEST',
  water: 'WATER + ROOM',
  other: 'PROCESS FAULT',
  notcontam: 'NOT CONTAM',
}
export const KIND_NOTE: Partial<Record<Kind, string>> = {
  yeast: 'THE SOURCES NAME NO YEAST CONTAMINANT. NOTHING IS FILLED FROM OUTSIDE THEM. FERMENTED GRAIN AND BLOCKS ARE UNDER BACTERIA.',
  notcontam: 'THINGS THAT LOOK WRONG BUT ARE NOT CONTAMINATION. CHECK HERE BEFORE YOU THROW ANYTHING AWAY.',
  other: 'NOT AN ORGANISM. A FAULT IN THE PROCESS THAT LETS ORGANISMS IN. PICK ONE WHEN YOU KNOW THE CAUSE BUT NOT THE MOULD.',
}

export const STAGES: Stage[] = ['plate', 'grain', 'cook', 'block', 'fruit', 'after', 'stock']
export const STAGE_LABEL: Record<Stage, string> = {
  plate: 'PLATE',
  grain: 'GRAIN SPAWN',
  cook: 'COOK + COOL-DOWN',
  block: 'INCUBATION',
  fruit: 'FRUITING',
  after: 'HARVEST + PACK',
  stock: 'RAW MATERIALS',
}

export const COLOURS: Colour[] = ['green', 'orange', 'white', 'yellow', 'brown', 'black', 'grey', 'pink', 'multi', 'clear']
export const COLOUR_LABEL: Record<Colour, string> = { green: 'GREEN', orange: 'ORANGE', white: 'WHITE / CREAM', yellow: 'YELLOW', brown: 'BROWN / RUST', black: 'BLACK', grey: 'GREY / BLUE', pink: 'PINK', multi: 'MANY COLOURS', clear: 'CLEAR / GLOSSY' }
export const SMELLS: Smell[] = ['sour', 'bad']
export const SMELL_LABEL: Record<Smell, string> = { sour: 'SOUR (DIRTY SOCKS, WINE)', bad: 'BAD / ROTTEN' }
export const TEXTURES: Texture[] = ['powdery', 'fuzzy', 'slimy', 'wet', 'hard', 'wispy', 'mushy', 'dry']
export const TEXTURE_LABEL: Record<Texture, string> = { powdery: 'POWDERY', fuzzy: 'FUZZY / COBWEB', slimy: 'SLIMY / FILM', wet: 'WET / LIQUID', hard: 'HARD / CRUSTY', wispy: 'WISPY / GREASY', mushy: 'MUSHY / SOFT', dry: 'DRY / DEAD' }
export const PLACES: Place[] = ['top', 'bottom', 'seal', 'spots', 'patches', 'whole', 'cap', 'stem', 'cut', 'plate', 'room']
export const PLACE_LABEL: Record<Place, string> = {
  top: 'TOP OF BLOCK / HEADSPACE',
  bottom: 'BOTTOM OF BAG',
  seal: 'GUSSET, SEAL OR PATCH',
  spots: 'SPOTS AT INOCULATION POINTS',
  patches: 'PATCHES IN BLOCK OR GRAIN',
  whole: 'THROUGH THE WHOLE BAG / LOT',
  cap: 'CAPS OF THE FRUIT',
  stem: 'STEMS',
  cut: 'CUT SITES / BAG OPENINGS',
  plate: 'ON A PLATE',
  room: 'ROOM, RACKS, WATER, AIR',
}

export interface Clues {
  colour?: Colour
  smell?: Smell
  texture?: Texture
  stage?: Stage
  place?: Place
}
export const noClues = (c: Clues) => !c.colour && !c.smell && !c.texture && !c.stage && !c.place

export interface Match {
  h: Hazard
  score: number
  hits: string[]
  misses: string[]
}

const WEIGHT = { colour: 3, smell: 3, texture: 2, place: 2 } as const

/**
 * Likely matches for what you see. Stage is a hard filter (a plate problem is not
 * a fruit-room problem). Each other clue scores when the entry lists it, and counts
 * as a miss when the entry lists that kind of clue but not this one. Entries that
 * list nothing for a clue are neither helped nor hurt.
 */
export function diagnose(c: Clues, list: Hazard[] = HAZARDS): Match[] {
  const soft = !!(c.colour || c.smell || c.texture || c.place)
  const out: Match[] = []
  for (const h of list) {
    if (c.stage && !h.stages.includes(c.stage)) continue
    let score = 0
    const hits: string[] = []
    const misses: string[] = []
    const check = (key: keyof typeof WEIGHT, want: string | undefined, have: readonly string[], label: string) => {
      if (!want || !have.length) return
      if (have.includes(want)) {
        score += WEIGHT[key]
        hits.push(label)
      } else {
        score -= 1
        misses.push(label)
      }
    }
    check('colour', c.colour, h.colours, 'COLOUR')
    check('smell', c.smell, h.smells, 'SMELL')
    check('texture', c.texture, h.textures, 'TEXTURE')
    check('place', c.place, h.places, 'WHERE')
    if (soft && !hits.length) continue
    out.push({ h, score, hits, misses })
  }
  const rank = (m: Match) => KIND_ORDER.indexOf(m.h.kind)
  return out.sort((a, b) => b.score - a.score || rank(a) - rank(b))
}

// ---------- logged losses ----------

export interface HazardLog extends Row {
  id: string
  hazard_key: string | null
  source_kind: 'culture' | 'grain' | 'lot'
  source_id: string | null
  strain_id: string | null
  bag_count: number
  noted_on: string
  notes: string | null
  created_at?: string
}
export interface LotLoss extends Row {
  id: string
  block_lot_id: string
  hazard_key: string | null
  bag_count: number
  cause: string | null
  noted_on: string
  notes: string | null
  created_at?: string
}

export interface LossCount {
  events: number
  bags: number
}

/** Events and bags lost per hazard id, from culture/grain logs and block-lot losses together. */
export function lossCounts(logs: HazardLog[], lotLosses: LotLoss[]): Map<string, LossCount> {
  const m = new Map<string, LossCount>()
  const add = (key: string | null, bags: number) => {
    if (!key) return
    const c = m.get(key) ?? { events: 0, bags: 0 }
    c.events += 1
    c.bags += bags
    m.set(key, c)
  }
  for (const l of logs) add(l.hazard_key, l.bag_count)
  for (const l of lotLosses) add(l.hazard_key, l.bag_count)
  return m
}

/** Find an entry from something typed: id, full name, or a word of its name that is unique (4+ letters). */
export function findHazard(query: string, list: Hazard[] = HAZARDS): Hazard | undefined {
  const q = query.trim().toUpperCase()
  if (!q) return undefined
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const exact = list.find((h) => h.id === slug || h.name === q)
  if (exact) return exact
  if (q.length < 4) return undefined
  const words = (t: string) => t.split(/[^A-Z0-9']+/).filter(Boolean)
  const byName = list.filter((h) => h.id.startsWith(slug) || words(h.name).some((w) => w.startsWith(q)))
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) return undefined
  const byAka = list.filter((h) => words(h.aka ?? '').some((w) => w.startsWith(q)))
  return byAka.length === 1 ? byAka[0] : undefined
}

/** Short label for a logged hazard key. */
export const hazardName = (key: string | null | undefined, list: Hazard[] = HAZARDS) => (key ? list.find((h) => h.id === key)?.name ?? key.toUpperCase() : 'UNKNOWN')

/** Entries you can pick as the cause of a loss: everything except the harmless look-alikes. */
export const lossPickList = (list: Hazard[] = HAZARDS) => list.filter((h) => h.kind !== 'notcontam')

// ---------- reading the pattern across bags, lots and days ----------

export interface Pattern {
  see: string
  source: string
  s: string[]
  hz?: string
}
export const PATTERNS: Pattern[] = [
  { see: 'Many different moulds, plus bacteria, across a lot', source: 'Air during cool-down or in the lab', s: ['F14-0114'], hz: 'dirty-cooldown' },
  { see: 'Patchy through the batch, many types, uneven colonization and yield', source: 'Steaming failure', s: ['F14-0115'], hz: 'undercooked' },
  { see: 'Sporadic, but always near the gussets or the top seal', source: 'Bag manufacturing defect', s: ['F14-0116'], hz: 'bag-failure' },
  { see: 'All blocks (say 20) from one 6 lb (2.7 kg) spawn bag go green', source: 'Spawn', s: ['F14-0117'], hz: 'trichoderma' },
  { see: 'Sporadic chunky spots over 2 weeks, not in every bag of the lot', source: 'Undercooked substrate rather than spawn', s: ['F14-0118'], hz: 'undercooked' },
  { see: 'Many blocks from one spawn lot fail during incubation', source: 'Spawn or substrate supplier. Trace by lot', s: ['F14-0119'] },
  { see: 'Problem only at fruiting', source: 'The fruit room, not the spawn or block supplier', s: ['F14-0120'], hz: 'humidifier-fogger' },
  { see: 'Systemic across everything', source: 'Equipment: the cook or the cool-down air, not a working flowhood unless it has a break', s: ['F14-0121'], hz: 'dirty-cooldown' },
  { see: 'Sporadic infiltration across a whole lot', source: 'Technique, damaged filters or irregular airflow', s: ['F14-0122'], hz: 'lab-air' },
  { see: 'Shiitake surface contamination even after browning and buckling', source: 'Insufficient cook', s: ['F14-0123'], hz: 'undercooked' },
  { see: 'Problem shows only on lion\'s mane', source: 'A systemic fault that hardier species out-compete. Do not blame the culture', s: ['F14-0124'] },
  { see: 'Bought-in blocks fail in your room but fruit fine on a kitchen counter', source: 'Your environment, usually water or humidification', s: ['F14-0125'], hz: 'water-quality' },
  { see: 'Fresh bags perspiring heavily early in colonization', source: 'Likely to contaminate within one or two weeks', s: ['F14-0126'] },
]
