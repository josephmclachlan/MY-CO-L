// The species models: one growth animation per species, in stages.
import type { Sketch } from './sketch'

export interface StageDef {
  /** Matches a stage in src/data/anatomy/<species>.json. */
  id: string
  /** Where the stage begins on the 0..1 growth line. */
  at: number
  /** Seconds the time-lapse pauses at the start of this stage. */
  hold?: number
  /** Camera height for this stage (radians above level); default the model's elev.
   * Higher looks down onto a block top; lower shows a cluster side on. */
  elev?: number
}

export interface SpecimenModel {
  id: string
  seed: number
  stages: StageDef[]
  /** The stage shown first and whenever the animation is off (the picking picture). */
  rest: string
  /** Camera height as an angle above level (radians); default 0.22. */
  elev?: number
  /** Side-fruiting specimens swing to and fro (this many radians each way) instead
   * of turning all the way round, so the block never hides them. */
  swing?: number
  /** The camera always keeps at least this sphere in view (model space, cm). While the
   * specimen is still small and low (knots on a block top), the sphere may slide down
   * toward it by up to `low` × r, so early stages are not drawn at the bottom of the view. */
  frame?: { c: [number, number, number]; r: number; low?: number }
  /** Draw the specimen at growth point t (0..1) into the sketch. Must be deterministic. */
  build(sk: Sketch, t: number): void
}

/** Where a stage's picture sits: a little way into it, once its change is visible. */
export function stageShowT(m: SpecimenModel, id: string): number {
  const i = m.stages.findIndex((s) => s.id === id)
  if (i < 0) return 0.5
  const a = m.stages[i].at
  const b = i + 1 < m.stages.length ? m.stages[i + 1].at : 1
  return a + (b - a) * 0.55
}

export function stageAt(m: SpecimenModel, t: number): number {
  let k = 0
  for (let i = 0; i < m.stages.length; i++) if (t >= m.stages[i].at - 1e-6) k = i
  return k
}

/** Camera height at growth point t: the stage's own angle, easing into the next
 * stage's over the last 40% of the stage (so a stage's picture shows its own angle). */
export function elevAt(m: SpecimenModel, t: number): number {
  const base = m.elev ?? 0.22
  const st = m.stages
  const i = stageAt(m, t)
  const e0 = st[i].elev ?? base
  if (i + 1 >= st.length) return e0
  const e1 = st[i + 1].elev ?? base
  const a = st[i].at
  const b = st[i + 1].at
  const x = Math.min(1, Math.max(0, (t - (a + (b - a) * 0.6)) / ((b - a) * 0.4)))
  return e0 + (e1 - e0) * x * x * (3 - 2 * x)
}
