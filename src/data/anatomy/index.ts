// Growth stages and callout labels for each species' wireframe model.
// One JSON file per species sits beside this file (same id as the species).
//   k  short name shown on screen (stage chip, label tag)
//   a  plain general description of the part (not from the sources; marked GENERAL)
//   v  what the textbook says, in plain words
//   s  textbook fact ids behind v
//   on the stages a label shows in;  part  the drawing part it lights up
//   at the model anchor the label points to (default: its id), so two labels can share one

export interface StageText {
  id: string
  k: string
  v?: string
  a?: string
  s?: string[]
}

export interface LabelText {
  id: string
  k: string
  a?: string
  v?: string
  s?: string[]
  on: string[]
  part?: string
  at?: string
}

export interface Anatomy {
  id: string
  /** Shown when the drawing goes beyond the sources (cordyceps). */
  note?: string
  stages: StageText[]
  labels: LabelText[]
}

const files = import.meta.glob<Anatomy>('./*.json', { eager: true, import: 'default' })

export const ANATOMY: Record<string, Anatomy> = Object.fromEntries(Object.values(files).map((a) => [a.id, a]))

export const anatomyFor = (id: string): Anatomy | undefined => ANATOMY[id]
