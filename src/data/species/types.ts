// Species data shapes. One JSON file per species sits beside this file.
// Every number carries its source: textbook fact IDs (s), manual video
// timestamps (w), and a note (n). Nothing is filled from outside knowledge:
// a fact with f:'nodata' and no value shows NO DATA IN SOURCES.

export type Flag = 'nodata' | 'ctx' | 'conflict'
export type Form = 'shelf' | 'pom' | 'coral' | 'capstem' | 'cluster' | 'rosette' | 'bracket' | 'club'

export interface Fact {
  k?: string // label
  v?: string // value text
  f?: Flag // nodata = no figure in sources; ctx = another farm's figure given as context; conflict = sources or farm set points disagree
  s?: string[] // fact IDs, e.g. F18-0181, or CATAWBA / FARM-PLAN
  w?: string[] // video or podcast reference, e.g. "lions-mane-2 0:24:44"
  n?: string // short note
  d?: [number, number] // duration in days (timeline bars)
  hz?: string // id of a HAZARD INDEX entry this fact opens
}

export interface TempBands {
  range?: [number, number][] // stated range, deg C
  ideal?: [number, number][] // stated ideal band
  best?: number // single sweet spot
}

export interface CatawbaFigures {
  lb: number // real pounds per 10 lb block
  d: number // days knock to first harvest
  dr: string // p10-p90
  plan: number // Catawba's own planning figure
}

export interface Species {
  id: string
  order: number
  name: string
  latin: string | null
  tier: 'plan' | 'farm'
  plan?: { share: number; note: string } // share per 100 bags in the original crop plan
  form: Form
  seed: number
  blurb: string
  overview: Fact[]
  cultivation: Fact[]
  timeline: Fact[]
  climate: Fact[]
  yield_: Fact[]
  hazards: Fact[]
  notes: Fact[]
  fruitC: TempBands | null
  cat: CatawbaFigures | null
  strains: { id: string; name: string }[] // filled by the genetics build
}
