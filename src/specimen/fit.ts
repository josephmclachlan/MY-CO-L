// The turning axis of a specimen (no three.js here, so the build worker can use it).
import { Sketch } from './sketch'
import type { SpecimenModel } from './registry'

export interface Fit {
  /** The vertical axis the specimen turns about (model space x, z). */
  cx: number
  cz: number
}

/** The turning axis: the middle of the full-grown specimen, or the model's own frame centre. */
export function fitModel(model: SpecimenModel, detail = 1): Fit {
  const f = model.frame
  if (f) return { cx: f.c[0], cz: f.c[2] }
  const sk = new Sketch()
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const t of [0.5, 0.75, 1]) {
    sk.reset()
    sk.detail = Math.min(detail, 0.5)
    model.build(sk, t)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], sk.lo[k])
      hi[k] = Math.max(hi[k], sk.hi[k])
    }
  }
  return { cx: (lo[0] + hi[0]) / 2, cz: (lo[2] + hi[2]) / 2 }
}
