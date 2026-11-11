// KING OYSTER (Pleurotus eryngii): one or a few big mushrooms from the top centre
// of the block, inside a plastic collar left when the bag top is cut off. The crop
// is the thick white stem; the cap is small, rolled under when young, round under
// even bright light, speckled like granite when the room is cool.
import { agaric } from '../agaric'
import { bag, block, droplet, pin } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, clamp, norm, rng, rr, smooth } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 83

export const kingOyster: SpecimenModel = {
  id: 'king-oyster',
  seed: SEED,
  stages: [
    { id: 'collar', at: 0, elev: 0.5 },
    { id: 'pins', at: 0.14, elev: 0.45 },
    { id: 'stems', at: 0.32, elev: 0.3 },
    { id: 'pick', at: 0.6, hold: 3.2 },
    { id: 'late', at: 0.84 },
  ],
  rest: 'pick',
  elev: 0.24,
  frame: { c: [0, 4, 0], r: 6, low: 0.75 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 16
    const H = 18
    const D = 12
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, 6, 0]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [10, 20], rnd, grain: 100 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 5.5, mode: 'collar', focus, fade: [10, 20], rnd })
    sk.anchor('collar', [W / 2 + 0.4, 4.6, 2], [1, 0, 0])
    // condensation on the inside of the collar, running down
    const cond = smooth(0.02, 0.12, t) * (1 - smooth(0.5, 0.7, t))
    const cr = rng(SEED + 2)
    const drops: V3[] = []
    for (let i = 0; i < 14; i++) {
      const side = Math.floor(cr() * 4)
      const u = rr(cr, -0.8, 0.8)
      const y = rr(cr, 1, 4.6)
      drops.push(side === 0 ? [u * W * 0.5, y, D / 2 + 0.2] : side === 1 ? [W / 2 + 0.2, y, u * D * 0.5] : side === 2 ? [u * W * 0.5, y, -D / 2 - 0.2] : [-W / 2 - 0.2, y, u * D * 0.5])
    }
    if (cond > 0.02)
      sk.inPart('wet', () => {
        sk.ctx = true
        for (const p of drops) droplet(sk, p, [0, 1, 0], 0.2 * cond, B.FINE)
        sk.ctx = false
        sk.anchor('wet', drops[1], [0, 0, 1])
      })
    // pins across the top; most stall, a few go on
    const pk = smooth(0.12, 0.24, t) * (1 - 0.6 * smooth(0.34, 0.5, t))
    const pr = rng(SEED + 4)
    const pins: V3[] = []
    for (let i = 0; i < 16; i++) {
      const a = pr() * TAU
      const d = Math.sqrt(pr()) * 4.5
      pins.push([Math.cos(a) * d, 0, Math.sin(a) * d * 0.7])
    }
    if (pk > 0.02)
      sk.inPart('pins', () => {
        for (const p of pins) pin(sk, p, [rr(pr, -0.15, 0.15), 1, rr(pr, -0.15, 0.15)], 1.2 * pk * rr(pr, 0.6, 1.1), 0.5 * pk, B.FINE, 0.7)
        sk.anchor('pins', [pins[0][0], 1 * pk, pins[0][2]], [0, 0, 1])
      })

    const kings = [
      { base: [0.2, 0, 0.4] as V3, dir: norm([0.04, 1, 0.05]), size: 1, len: 12, delay: 0.2, grow: 0.7, lean: 0.4 },
      { base: [-2.6, 0, -1.2] as V3, dir: norm([-0.25, 1, -0.12]), size: 0.66, len: 8, delay: 0.26, grow: 0.76, lean: -0.6 },
      { base: [2.4, 0, -1.6] as V3, dir: norm([0.25, 1, -0.15]), size: 0.5, len: 6.5, delay: 0.3, grow: 0.8, lean: 0.5 },
    ]
    kings.forEach((k, i) => {
      const m = clamp((t - k.delay) / k.grow)
      if (m <= 0.01) return
      const ag = agaric(sk, {
        rnd: rng(SEED * 10 + i),
        base: k.base,
        dir: k.dir,
        m,
        L: (q) => k.len * smooth(0, 0.62, q) * (0.3 + 0.7 * smooth(0, 0.5, q)),
        r: 1.9 * k.size,
        taper: 0.72,
        club: 0.45,
        lean: k.lean,
        shape: {
          R: [
            [0, 0.9],
            [0.3, 1.6],
            [0.55, 2.4],
            [0.75, 2.95],
            [1, 3.6],
          ].map(([q, r]) => [q, r * k.size]) as [number, number][],
          phi: [
            [0, 1.5],
            [0.4, 1.3],
            [0.7, 1.0],
            [0.85, 0.6],
            [1, 0.22],
          ],
          curl: [
            [0, 1.05],
            [0.4, 0.98],
            [0.7, 0.72],
            [0.85, 0.28],
            [1, -0.35],
          ],
          dip: [
            [0.55, 0.0],
            [1, 0.4],
          ],
          ruffle: [
            [0.75, 0.0],
            [1, 0.05],
          ],
          lobes: [
            [0.6, 0.02],
            [1, 0.06],
          ],
          thick: 0.36,
          edge: 0.03,
          ecc: 0.1,
        },
        gills: { n: 60, tiers: 1, depth: 0.06, attach: 'decurrent' },
        decurrent: 26,
        speckle: i === 0 ? 70 : 30,
        fibres: 10,
        meridians: 14,
        nu: 44,
        b: i === 0 ? 1 : 0.82,
      })
      if (i === 0) {
        const c = ag.cap
        sk.anchor('cap', c.top(0.45, 0.5), c.topN(0.45, 0.5))
        sk.anchor('margin', c.rim(0.2), c.topN(0.98, 0.2))
        sk.anchor('stem', ag.stem.at(0.45, 0.6), ag.stem.nrm(0.45, 0.6))
        sk.anchor('gills', c.gillEdge(0.5, 2.8), [0, -1, 0])
      }
    })
  },
}
