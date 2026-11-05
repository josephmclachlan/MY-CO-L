import type { Hazard, Kind } from './types'

const mods = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, Hazard[]>

const ORDER: Kind[] = ['mould', 'bacteria', 'yeast', 'disease', 'pest', 'water', 'other', 'notcontam']

/** Every entry, grouped by kind in the order of KINDS, then in file order. */
export const HAZARDS: Hazard[] = Object.values(mods)
  .flat()
  .map((h, i) => ({ h, i }))
  .sort((a, b) => ORDER.indexOf(a.h.kind) - ORDER.indexOf(b.h.kind) || a.i - b.i)
  .map((x) => x.h)

export const hazardById = (id: string | null | undefined): Hazard | undefined => (id ? HAZARDS.find((h) => h.id === id) : undefined)

export const hazardsForSpecies = (speciesId: string): Hazard[] => HAZARDS.filter((h) => h.kind !== 'notcontam' && h.species.includes(speciesId))
