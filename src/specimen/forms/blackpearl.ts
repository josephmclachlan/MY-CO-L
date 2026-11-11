// BLACK PEARL (black oyster hybrid): dense clusters of dark convex caps on long,
// thick, king-like stems, fused at the base, out of a slit in the long face of the
// block. Cobweb fluff and amber droplets come before the pins.
import { agaric } from '../agaric'
import { bag, block, droplet, faceCut, fluff, pin, stem } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, clamp, madd, norm, rng, rr, smooth } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 71

export const blackPearl: SpecimenModel = {
  id: 'black-pearl',
  seed: SEED,
  stages: [
    { id: 'cut', at: 0 },
    { id: 'fluff', at: 0.1, hold: 0.8 },
    { id: 'pins', at: 0.24 },
    { id: 'young', at: 0.38 },
    { id: 'pick', at: 0.56, hold: 3.2 },
    { id: 'late', at: 0.8 },
  ],
  rest: 'pick',
  elev: 0.3,
  swing: 1.1,
  frame: { c: [0, 1.5, 8.5], r: 4.5 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 18
    const H = 26
    const D = 12
    const top: V3 = [0, H / 2, 0]
    const cutC: V3 = [0, -1, D / 2 + 0.05]
    const focus: V3 = [0, 2, D / 2 + 4]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [9, 18], rnd, grain: 120 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 3, mode: 'open', focus, fade: [9, 18], rnd })
    faceCut(sk, cutC, [0, 0, 1], [0, 1, 0], 5, 'x', smooth(0.02, 0.16, t), B.CTX * 1.3)
    sk.anchor('cut', [1.7, 0.6, D / 2 + 0.2], [0, 0, 1])

    // cobweb fluff from the cut, then amber droplets on it
    const fl = smooth(0.08, 0.16, t) * (1 - smooth(0.3, 0.42, t))
    const fr = rng(SEED + 3)
    if (fl > 0.02)
      sk.inPart('fluff', () => {
        fluff(sk, madd(cutC, [0, 0, 1], 0.1), [0, 0, 1], 2.2 * fl, fr, 40, 1.1 * fl, B.SOFT * 1.3)
        sk.anchor('fluff', madd(cutC, [0.8, 1.2, 1], 0.8), [0, 0, 1])
      })
    const dr = rng(SEED + 4)
    const drops: V3[] = []
    for (let i = 0; i < 9; i++) {
      const a = dr() * TAU
      const d = Math.sqrt(dr()) * 1.7
      drops.push([cutC[0] + Math.cos(a) * d, cutC[1] + Math.sin(a) * d, cutC[2] + rr(dr, 0.4, 0.9)])
    }
    const dk = smooth(0.13, 0.2, t) * (1 - smooth(0.3, 0.38, t))
    if (dk > 0.02)
      sk.inPart('drops', () => {
        for (const p of drops) droplet(sk, p, [0, 1, 0], 0.22 * dk, B.FINE * 1.2)
        sk.anchor('drops', drops[2], [0, 0, 1])
      })
    // king-like bumps (primordia)
    const pk = smooth(0.22, 0.32, t) * (1 - smooth(0.42, 0.5, t))
    const pr = rng(SEED + 5)
    if (pk > 0.02)
      sk.inPart('pins', () => {
        for (let i = 0; i < 16; i++) {
          const a = pr() * TAU
          const d = Math.sqrt(pr()) * 1.5
          pin(sk, [cutC[0] + Math.cos(a) * d, cutC[1] + Math.sin(a) * d, cutC[2]], norm([Math.cos(a) * 0.4, 0.5, 1]), 1.1 * pk * rr(pr, 0.7, 1.1), 0.45 * pk, B.FINE, 0.6)
        }
        sk.anchor('pins', [cutC[0] + 0.3, cutC[1] + 0.8, cutC[2] + 1.1 * pk], [0, 0, 1])
      })

    // fused base, then thick stems curving up
    const g0 = smooth(0.3, 0.55, t)
    if (g0 > 0.02) stem(sk, { path: [madd(cutC, [0, 0, 1], -0.6), madd(cutC, [0, 0.3, 1], 1.4 * g0)], r: () => 1.5 * (0.4 + 0.6 * g0), n: 4, m: 14, longs: 7, rings: [] })
    const N = 9
    const ms = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + rr(rnd, -0.2, 0.2)
      ms.push({
        base: [cutC[0] + Math.cos(a) * 0.6, cutC[1] + Math.sin(a) * 0.5, cutC[2] + 1.2] as V3,
        dir: norm([Math.cos(a) * 0.5, 1.15 + Math.sin(a) * 0.25, 0.6]),
        delay: rr(rnd, 0.3, 0.36),
        grow: rr(rnd, 0.6, 0.68),
        size: rr(rnd, 0.8, 1.1),
        len: rr(rnd, 6.5, 9),
        lean: rr(rnd, -1, 1),
        seed: Math.floor(rnd() * 1e9),
      })
    }
    ms[0].dir = norm([0.15, 0.85, 0.75])
    ms[0].size = 1.1
    ms.forEach((m, i) => {
      const mm = clamp((t - m.delay) / m.grow)
      if (mm <= 0.01) return
      const ag = agaric(sk, {
        rnd: rng(m.seed),
        base: m.base,
        dir: m.dir,
        m: mm,
        L: (q) => m.len * smooth(0, 0.6, q),
        r: 0.95 * m.size,
        taper: 0.8,
        club: 0.25,
        lean: m.lean,
        shape: {
          R: [
            [0, 0.5],
            [0.3, 1.2],
            [0.55, 2.0],
            [0.75, 2.6],
            [1, 3.1],
          ].map(([q, r]) => [q, r * m.size]) as [number, number][],
          phi: [
            [0, 1.5],
            [0.35, 1.15],
            [0.55, 0.85],
            [0.75, 0.4],
            [1, 0.15],
          ],
          curl: [
            [0, 1.0],
            [0.35, 0.85],
            [0.55, 0.55],
            [0.75, 0.05],
            [1, -0.55],
          ],
          dip: [
            [0.5, 0.0],
            [1, 0.35],
          ],
          ruffle: [
            [0.7, 0.0],
            [1, 0.09],
          ],
          lobes: [
            [0.5, 0.03],
            [1, 0.1],
          ],
          thick: 0.3,
          edge: 0.02,
          ecc: 0.18,
        },
        gills: { n: 46, tiers: 1, depth: 0.07, attach: 'decurrent' },
        decurrent: 18,
        fibres: 6,
        meridians: 12,
        nu: 38,
        b: i === 0 ? 1 : 0.84,
      })
      if (i === 0) {
        const c = ag.cap
        sk.anchor('cap', c.top(0.4, 0.6), c.topN(0.4, 0.6))
        sk.anchor('margin', c.rim(0.3), c.topN(0.98, 0.3))
        sk.anchor('stem', ag.stem.at(0.45, 0.8), ag.stem.nrm(0.45, 0.8))
        sk.anchor('gills', c.gillEdge(0.5, 3.6), [0, -1, 0])
      }
    })
    // spores when caps turn up
    const late = smooth(0.82, 1, t)
    if (late > 0.02) {
      const sr = rng(SEED + 9)
      sk.inPart('spores', () => {
        for (let i = 0; i < 40; i++) {
          const ph = sr()
          const fall = ((t * 9 + ph) % 1) * 7
          const p: V3 = [rr(sr, -5, 5), rr(sr, 3, 8) - fall, rr(sr, 8, 13)]
          sk.mark(p, [0, 0, 1], 0.12, { b: B.FINE * late * (1 - fall / 7), hid: 0 }, ph * 6)
          if (i === 2) sk.anchor('spores', p, [0, 0, 1])
        }
      })
    }
  },
}
