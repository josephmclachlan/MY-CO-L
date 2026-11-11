// PIOPPINO (Agrocybe aegerita): wild fluff on the block top, then amber droplets
// (open the bag now), then a carpet of golden pin nodules; then a cluster of long
// slender stems with small domed caps, each held by a skin-like veil that leaves a
// ring on the stem when the cap breaks away from the stem edge and flattens.
import { agaric } from '../agaric'
import { bag, block, droplet, fluff, pin } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, clamp, norm, rng, rr, smooth, wobble } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 127

export const pioppino: SpecimenModel = {
  id: 'pioppino',
  seed: SEED,
  stages: [
    { id: 'fluff', at: 0, elev: 0.55 },
    { id: 'droplets', at: 0.12, hold: 1.2, elev: 0.55 },
    { id: 'carpet', at: 0.24, elev: 0.45 },
    { id: 'stems', at: 0.38, elev: 0.3 },
    { id: 'pick', at: 0.6, hold: 3.2 },
    { id: 'late', at: 0.82 },
  ],
  rest: 'pick',
  elev: 0.22,
  frame: { c: [0, 3, 0], r: 6.5, low: 0.6 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 17
    const H = 12
    const D = 12
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, 4, 0]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [10, 19], rnd, grain: 90 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 2.5, mode: 'open', focus, fade: [10, 19], rnd })
    void blk
    // wild fluff over the top
    const fk = smooth(0, 0.08, t) * (1 - smooth(0.3, 0.45, t))
    const fr = rng(SEED + 1)
    if (fk > 0.02)
      sk.inPart('fluff', () => {
        fluff(sk, [0, 0.05, 0], [0, 1, 0], 6.5, fr, 90, 1.4 * fk, B.SOFT * 1.25)
        sk.anchor('fluff', [3.2, 1.1 * fk, 1.6], [0, 1, 0])
      })
    // amber droplets on the fluff
    const dr = rng(SEED + 2)
    const drops: V3[] = []
    for (let i = 0; i < 16; i++) {
      const a = dr() * TAU
      const d = Math.sqrt(dr()) * 6
      drops.push([Math.cos(a) * d, rr(dr, 0.5, 1.1), Math.sin(a) * d * 0.8])
    }
    const dk = smooth(0.1, 0.16, t) * (1 - smooth(0.3, 0.4, t))
    if (dk > 0.02)
      sk.inPart('drops', () => {
        for (const p of drops) droplet(sk, p, [0, 1, 0], 0.24 * dk, B.FINE * 1.3)
        sk.anchor('drops', drops[0], [0, 1, 0])
      })
    // the carpet of golden nodules
    const ck = smooth(0.22, 0.32, t) * (1 - 0.5 * smooth(0.45, 0.6, t))
    const cr = rng(SEED + 3)
    const nods: V3[] = []
    for (let i = 0; i < 70; i++) {
      const a = cr() * TAU
      const d = Math.sqrt(cr()) * 5.5
      nods.push([Math.cos(a) * d, 0, Math.sin(a) * d * 0.85])
    }
    if (ck > 0.02)
      sk.inPart('carpet', () => {
        for (const p of nods) pin(sk, p, [0, 1, 0], 0.45 * ck * rr(cr, 0.7, 1.2), 0.22 * ck, B.FINE * 0.9, 0.6)
        sk.anchor('carpet', [nods[4][0], 0.5 * ck, nods[4][2]], [0, 1, 0])
      })

    // the cluster
    const N = 14
    const ms = []
    for (let i = 0; i < N; i++) {
      const a = i * 2.39996 + rr(rnd, -0.2, 0.2)
      const ring = Math.sqrt((i + 0.5) / N)
      ms.push({
        base: [Math.cos(a) * 2.4 * ring, 0, Math.sin(a) * 1.9 * ring] as V3,
        dir: norm([Math.cos(a) * 0.3 * ring, 1, Math.sin(a) * 0.28 * ring]),
        delay: rr(rnd, 0.3, 0.36),
        grow: rr(rnd, 0.6, 0.7),
        size: rr(rnd, 0.75, 1.1),
        len: rr(rnd, 7.5, 11) * (1.08 - 0.25 * ring),
        lean: rr(rnd, -1.6, 1.6),
        seed: Math.floor(rnd() * 1e9),
      })
    }
    ms[0].base = [0.6, 0, 1.3]
    ms[0].dir = norm([0.12, 1, 0.22])
    ms[0].size = 1.12
    ms[0].len = 10
    ms.forEach((m, i) => {
      const mm = clamp((t - m.delay) / m.grow)
      if (mm <= 0.01) return
      const r = rng(m.seed)
      const wr = wobble(r, 4, 9, 1)
      void wr
      const ag = agaric(sk, {
        rnd: rng(m.seed + 1),
        base: m.base,
        dir: m.dir,
        m: mm,
        L: (q) => m.len * smooth(0, 0.62, q) * (0.25 + 0.75 * smooth(0, 0.5, q)),
        r: 0.4 * m.size,
        taper: 0.82,
        club: 0.1,
        lean: m.lean,
        droop: (q) => smooth(0.9, 1, q) * 0.25,
        shape: {
          R: [
            [0, 0.3],
            [0.3, 0.75],
            [0.55, 1.3],
            [0.72, 1.85],
            [0.86, 2.4],
            [1, 2.8],
          ].map(([q, r]) => [q, r * m.size]) as [number, number][],
          phi: [
            [0, 1.75],
            [0.3, 1.6],
            [0.55, 1.4],
            [0.7, 1.1],
            [0.86, 0.5],
            [1, 0.25],
          ],
          curl: [
            [0, 0.9],
            [0.3, 0.8],
            [0.55, 0.62],
            [0.7, 0.35],
            [0.86, 0.0],
            [1, -0.3],
          ],
          umbo: [
            [0.5, 0.0],
            [1, 0.08],
          ],
          ruffle: [
            [0.8, 0],
            [1, 0.05],
          ],
          lobes: [
            [0.6, 0.02],
            [1, 0.08],
          ],
          thick: 0.3,
          edge: 0.02,
        },
        gills: { n: 40, tiers: 1, depth: 0.15, attach: 'adnate' },
        veil: { ringAt: 0.86, tear: 'margin', from: 0.62, to: 0.76 },
        streaks: 10,
        fibres: 14,
        meridians: 12,
        nu: 34,
        b: i === 0 ? 1 : 0.84,
      })
      if (i === 0) {
        const c = ag.cap
        sk.anchor('cap', c.top(0.3, 0.6), c.topN(0.3, 0.6))
        sk.anchor('margin', c.rim(0.6), c.topN(0.98, 0.6))
        if (ag.veil) {
          sk.anchor('veil', ag.veil.mid)
          sk.anchor('ring', ag.veil.ring)
        }
        sk.anchor('stem', ag.stem.at(0.45, 0.6), ag.stem.nrm(0.45, 0.6))
        sk.anchor('gills', c.gillEdge(0.55, 3), [0, -1, 0])
      }
    })
  },
}
