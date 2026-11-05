// Contaminant library shapes. One JSON file per group sits beside this file.
// Every readout carries its sources: textbook fact IDs (s) and a note (n).
// Video timestamps (w) sit on the entry and are the manual's videos nearest the topic.
// Nothing here is filled from outside the sources. A fact with f:'nodata' says so.
import type { Fact } from '../species/types'

export type Kind = 'mould' | 'bacteria' | 'yeast' | 'pest' | 'disease' | 'water' | 'other' | 'notcontam'
export type Stage = 'plate' | 'grain' | 'cook' | 'block' | 'fruit' | 'after' | 'stock'
export type Colour = 'green' | 'orange' | 'white' | 'yellow' | 'brown' | 'black' | 'grey' | 'pink' | 'multi' | 'clear'
export type Smell = 'sour' | 'bad'
export type Texture = 'powdery' | 'fuzzy' | 'slimy' | 'wet' | 'hard' | 'wispy' | 'mushy' | 'dry'
export type Place = 'top' | 'bottom' | 'seal' | 'spots' | 'patches' | 'whole' | 'cap' | 'stem' | 'cut' | 'plate' | 'room'

export interface Hazard {
  id: string
  name: string
  aka?: string
  kind: Kind
  stages: Stage[]
  colours: Colour[]
  smells: Smell[]
  textures: Texture[]
  places: Place[]
  /** species keys most at risk (same keys as SPECIMEN FILES) */
  species: string[]
  spot: Fact[]
  look: Fact[]
  cause: Fact[]
  treat: Fact[]
  prevent: Fact[]
  risk: Fact[]
  /** manual videos near this topic, e.g. "neurospora 0:09:56" */
  w: string[]
}
