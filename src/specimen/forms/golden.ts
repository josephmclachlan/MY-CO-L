// GOLDEN OYSTER (Pleurotus citrinopileatus): a bouquet of small funnel caps on
// slender stems fused at the base, out of a side cut. The primordia look coral-like
// before the caps open; the caps cup into funnels with thin wavy margins and gills
// running down the stems.
import { agaric } from '../agaric'
import { bag, block, faceCut, keys, stem } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, add, clamp, madd, norm, rng, rr, smooth } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 41

/** Coral-like primordia: short branching knobs. */
function coralPins(sk: Sketch, base: V3, dir: V3, len: number, depth: number, r: () => number) {
  const tip = madd(base, dir, len)
  stem(sk, { path: [base, madd(base, dir, len * 0.5), tip], r: (s) => len * 0.16 * (1 - 0.4 * s), n: 4, m: 8, longs: 4, rings: [], capTop: true, b: 0.8 })
  if (depth <= 0) return
  for (let k = 0; k < 2; k++) {
    const a = r() * TAU
    const d = norm(add(dir, [Math.cos(a) * 0.7, 0.25, Math.sin(a) * 0.7]))
    coralPins(sk, tip, d, len * 0.62, depth - 1, r)
  }
}

export const goldenOyster: SpecimenModel = {
  id: 'golden-oyster',
  seed: SEED,
  stages: [
    { id: 'cut', at: 0 },
    { id: 'coral', at: 0.12, hold: 0.8 },
    { id: 'young', at: 0.32 },
    { id: 'pick', at: 0.52, hold: 3.2 },
    { id: 'flat', at: 0.7 },
    { id: 'late', at: 0.85 },
  ],
  rest: 'pick',
  elev: 0.48,
  swing: 1.1,
  frame: { c: [0, 1.5, 8], r: 4 },
  build(sk, t) {
    const rnd = rng(SEED)
    const W = 18
    const H = 26
    const D = 12
    const top: V3 = [0, H / 2, 0]
    const cutC: V3 = [0, 0, D / 2 + 0.05]
    const focus: V3 = [0, 3, D / 2 + 3]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [9, 18], rnd, grain: 120 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 6, mode: 'closed', patch: true, focus, fade: [9, 18], rnd })
    faceCut(sk, cutC, [0, 0, 1], [0, 1, 0], 4, 'slit', smooth(0.02, 0.18, t), B.CTX * 1.5)
    sk.anchor('cut', [1.6, 0.1, D / 2 + 0.2], [0, 0, 1])

    // coral-like primordia
    const coral = smooth(0.1, 0.24, t) * (1 - smooth(0.32, 0.46, t))
    const cr = rng(SEED + 5)
    const cps: { b: V3; d: V3 }[] = []
    for (let i = 0; i < 13; i++) {
      const a = cr() * TAU
      const d = Math.sqrt(cr()) * 1.3
      cps.push({ b: [Math.cos(a) * d, Math.sin(a) * d * 0.5, cutC[2]], d: norm([Math.cos(a) * 0.45, 0.9, 0.85]) })
    }
    if (coral > 0.02)
      sk.inPart('coral', () => {
        for (const c of cps) coralPins(sk, c.b, c.d, 2.3 * coral, 2, cr)
        sk.anchor('coral', madd(cps[0].b, cps[0].d, 2.6 * coral), [0, 0, 1])
      })

    // the bouquet
    const N = 21
    const ms = []
    for (let i = 0; i < N; i++) {
      const a = i * 2.39996
      const ring = Math.sqrt((i + 0.5) / N)
      ms.push({
        base: [Math.cos(a) * 0.5 * ring, Math.sin(a) * 0.3 * ring, cutC[2] + 0.2] as V3,
        dir: norm([Math.cos(a) * 1.05 * ring, 0.9 + 0.45 * (1 - ring), 0.62 + Math.sin(a) * 0.42 * ring]),
        delay: rr(rnd, 0.2, 0.27),
        grow: rr(rnd, 0.66, 0.74),
        size: rr(rnd, 0.75, 1.1) * (1.05 - ring * 0.25),
        len: rr(rnd, 4.2, 6.2) * (1.15 - ring * 0.35),
        lean: rr(rnd, -0.8, 0.8),
        seed: Math.floor(rnd() * 1e9),
      })
    }
    ms[0].dir = norm([0.1, 0.8, 0.8])
    ms[0].size = 1.15
    // stems fuse low down: a short trunk
    const g0 = smooth(0.24, 0.5, t)
    if (g0 > 0.02) stem(sk, { path: [madd(cutC, [0, 0, 1], -0.5), madd(cutC, [0, 0.2, 1], 0.6)], r: () => 0.9 * g0, n: 4, m: 12, longs: 6, rings: [] })
    ms.forEach((m, i) => {
      const mm = clamp((t - m.delay) / m.grow)
      if (mm <= 0.01) return
      const ag = agaric(sk, {
        rnd: rng(m.seed),
        base: m.base,
        dir: m.dir,
        m: mm,
        L: (q) => m.len * smooth(0, 0.55, q),
        r: 0.3,
        taper: 0.75,
        lean: m.lean,
        shape: {
          R: [
            [0, 0.25],
            [0.3, 0.8],
            [0.55, 1.5],
            [0.75, 1.9],
            [1, 2.2],
          ].map(([q, r]) => [q, r * m.size]) as [number, number][],
          phi: [
            [0, 1.3],
            [0.25, 0.85],
            [0.45, 0.1],
            [0.6, -0.3],
            [0.8, -0.45],
            [1, -0.55],
          ],
          curl: [
            [0, 1.3],
            [0.25, 1.1],
            [0.45, 0.8],
            [0.6, 0.5],
            [0.8, 0.1],
            [1, -0.3],
          ],
          dip: [
            [0, 0.1],
            [0.3, 0.4],
            [0.6, 0.6],
            [1, 0.65],
          ],
          ruffle: [
            [0.5, 0.0],
            [0.8, 0.07],
            [1, 0.14],
          ],
          lobes: [
            [0.5, 0.03],
            [1, 0.14],
          ],
          thick: 0.16,
          edge: 0.015,
          ecc: 0.12,
        },
        gills: { n: 30, tiers: 1, depth: 0.08, attach: 'decurrent' },
        decurrent: 14,
        meridians: 10,
        nu: 30,
        b: i === 0 ? 1 : 0.82,
      })
      if (i === 0) {
        const c = ag.cap
        sk.anchor('funnel', c.top(0.12, 0.4), c.topN(0.12, 0.4))
        sk.anchor('margin', c.rim(0.9), c.topN(0.98, 0.9))
        sk.anchor('gills', c.gillEdge(0.5, 3.5), [0, -1, 0])
        sk.anchor('stem', ag.stem.at(0.45, 0.4), ag.stem.nrm(0.45, 0.4))
      }
    })
    void keys
  },
}
