// SHIITAKE (Lentinula edodes): a browned block, stripped of its bag (a rim left
// at the bottom to catch the drip) and flipped. Pins come as white bumps, then
// brown dots, then separating stems. Caps are rolled under with pale flecks of
// veil near the edge; pick while the rim is still curled and the thin veil is just
// cracking; late caps go flat like saucers.
import { agaric } from '../agaric'
import { bag, block, pin } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, add, clamp, madd, mul, norm, rng, rr, smooth } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 97

export const shiitake: SpecimenModel = {
  id: 'shiitake',
  seed: SEED,
  stages: [
    { id: 'browned', at: 0 },
    { id: 'bumps', at: 0.12 },
    { id: 'dots', at: 0.24 },
    { id: 'stems', at: 0.36 },
    { id: 'pick', at: 0.56, hold: 3.2 },
    { id: 'late', at: 0.8 },
  ],
  rest: 'pick',
  elev: 0.3,
  frame: { c: [0, 1, 0], r: 9.5 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 17
    const H = 13
    const D = 11
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, -1, 2]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [12, 22], rnd, grain: 60, skin: 70, b: B.CTX * 1.25 })
    // the bag stripped down to a rim at the bottom
    bag(sk, { blk, top, w: W, h: H, d: D, head: 0, mode: 'rim', rim: 2.5, focus, fade: [12, 22], rnd })
    sk.anchor('block', blk.face('side', 0.3, -0.2), [1, 0, 0])
    sk.anchor('rim', [W / 2 - 2, -H + 1.6, D / 2 + 0.4], [0, 0, 1])

    // where the mushrooms break out: top and three faces, each with its own pace
    type Site = { p: V3; n: V3; delay: number; grow: number; size: number; len: number; lean: number }
    const sites: Site[] = [
      { p: blk.face('top', 0.1, -0.05), n: [0, 1, 0], delay: 0.2, grow: 0.68, size: 1.1, len: 4.2, lean: 0.4 },
      { p: blk.face('top', -0.55, 0.45), n: [0, 1, 0], delay: 0.24, grow: 0.72, size: 0.9, len: 3.6, lean: -0.6 },
      { p: blk.face('top', 0.6, 0.5), n: [0, 1, 0], delay: 0.3, grow: 0.78, size: 0.7, len: 3, lean: 0.5 },
      { p: blk.face('front', -0.35, -0.1), n: [0, 0, 1], delay: 0.22, grow: 0.7, size: 0.95, len: 3.6, lean: 0.3 },
      { p: blk.face('front', 0.45, -0.55), n: [0, 0, 1], delay: 0.28, grow: 0.76, size: 0.75, len: 3, lean: -0.3 },
      { p: blk.face('side', 0.2, 0.2), n: [1, 0, 0], delay: 0.25, grow: 0.74, size: 0.85, len: 3.3, lean: 0.2 },
      { p: blk.face('left', -0.3, -0.3), n: [-1, 0, 0], delay: 0.27, grow: 0.76, size: 0.8, len: 3.2, lean: -0.2 },
      { p: blk.face('back', 0.1, 0.1), n: [0, 0, -1], delay: 0.24, grow: 0.72, size: 0.9, len: 3.4, lean: 0.2 },
    ]
    // extra bumps that stay small
    const extra: { p: V3; n: V3 }[] = []
    const fcs = ['top', 'front', 'side', 'left'] as const
    for (let i = 0; i < 22; i++) {
      const fc = fcs[Math.floor(rnd() * fcs.length)]
      extra.push({ p: blk.face(fc, rr(rnd, -0.8, 0.8), rr(rnd, -0.7, 0.8)), n: blk.normal(fc) })
    }
    const bump = smooth(0.1, 0.22, t)
    const dots = smooth(0.22, 0.32, t)
    if (bump > 0.02)
      sk.inPart('bumps', () => {
        for (const e of extra) {
          const k = bump * (1 - 0.3 * smooth(0.5, 0.8, t))
          pin(sk, e.p, e.n, 0.55 * k, 0.4 * k, B.FINE, 0.2)
          // the brown dot: a small ring on the top of the bump
          if (dots > 0.02) {
            const c = madd(e.p, e.n, 0.56 * k)
            const f = norm(e.n)
            const u: V3 = Math.abs(f[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
            const a = norm([f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]])
            const b2: V3 = [f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]]
            const pts: V3[] = []
            for (let q = 0; q <= 8; q++) {
              const ang = (q / 8) * Math.PI * 2
              pts.push(add(c, add(mul(a, Math.cos(ang) * 0.22 * k * dots), mul(b2, Math.sin(ang) * 0.22 * k * dots))))
            }
            sk.line(pts, { b: B.FINE * dots })
          }
        }
        sk.anchor('bumps', madd(extra[2].p, extra[2].n, 0.5), extra[2].n)
      })

    sites.forEach((s, i) => {
      const m = clamp((t - s.delay) / s.grow)
      if (m <= 0.01) return
      // side shoots turn up toward the light as they grow
      const dir = norm(add(mul(s.n, 1), [0, s.n[1] > 0.5 ? 0 : 0.9, 0]))
      const ag = agaric(sk, {
        rnd: rng(SEED * 7 + i),
        base: madd(s.p, s.n, -0.2),
        dir,
        m,
        L: (q) => s.len * smooth(0.05, 0.6, q),
        r: 0.62 * s.size,
        taper: 0.8,
        club: 0.1,
        lean: s.lean,
        shape: {
          R: [
            [0, 0.35],
            [0.25, 1.1],
            [0.5, 2.2],
            [0.7, 3.0],
            [0.85, 3.5],
            [1, 3.8],
          ].map(([q, r]) => [q, r * s.size]) as [number, number][],
          phi: [
            [0, 1.6],
            [0.3, 1.45],
            [0.55, 1.15],
            [0.72, 0.8],
            [0.86, 0.3],
            [1, 0.1],
          ],
          curl: [
            [0, 1.1],
            [0.3, 1.0],
            [0.55, 0.78],
            [0.72, 0.42],
            [0.86, 0.02],
            [1, -0.18],
          ],
          ruffle: [
            [0.75, 0],
            [1, 0.04],
          ],
          lobes: [
            [0.5, 0.03],
            [1, 0.07],
          ],
          thick: 0.36,
          edge: 0.022,
          ecc: 0.12,
        },
        gills: { n: 56, tiers: 1, depth: 0.1, attach: 'notched' },
        veil: { ringAt: 0.92, tear: 'stem', from: 0.52, to: 0.66, fibrous: true },
        scales: { rows: 3, per: 14, size: 0.2, from: 0.6, to: 0.93, shape: 'patch', lift: 0.1 },
        fibres: 8,
        meridians: 14,
        nu: 44,
        b: i === 0 ? 1 : 0.86,
        tilt: (q) => smooth(0.88, 1, q) * 0.15,
        capUp: s.n[1] > 0.5 ? 0 : 0.72,
      })
      if (i === 0) {
        const c = ag.cap
        sk.anchor('cap', c.top(0.4, 2.2), c.topN(0.4, 2.2))
        sk.anchor('flecks', c.top(0.82, 0.8), c.topN(0.82, 0.8))
        sk.anchor('margin', c.rim(0.5), c.topN(0.98, 0.5))
        sk.anchor('gills', c.gillEdge(0.55, 3.2), [0, -1, 0])
        if (ag.veil) sk.anchor('veil', ag.veil.margin)
        sk.anchor('stem', ag.stem.at(0.4, 0.8), ag.stem.nrm(0.4, 0.8))
      }
    })
  },
}
