// CHESTNUT (Pholiota adiposa): a tight cluster of scaly, convex caps on slender
// stems from a slice across the top of a ripened block. Each cap is held to its
// stem by a fibrous partial veil that stretches and then tears as the cap opens;
// clusters do not mature in sync.
import { agaric } from '../agaric'
import { bag, block, droplet, keys, pin } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, clamp, lerp, madd, norm, rng, rr, smooth, TAU } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 113

export const chestnut: SpecimenModel = {
  id: 'chestnut',
  seed: SEED,
  stages: [
    { id: 'cut', at: 0, elev: 0.55 },
    { id: 'knots', at: 0.12, elev: 0.5 },
    { id: 'buttons', at: 0.3, elev: 0.38 },
    { id: 'stretch', at: 0.47, elev: 0.28 },
    { id: 'pick', at: 0.62, hold: 3.2 },
    { id: 'late', at: 0.84 },
  ],
  rest: 'pick',
  frame: { c: [0, 2.2, 0], r: 4.2, low: 0.8 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const focus: V3 = [0, 5.5, 0]
    const top: V3 = [0, 0, 0]
    const blk = block(sk, { top, w: 19, h: 11, d: 12, focus, fade: [8, 16], rnd, grain: 110 })
    bag(sk, { blk, top, w: 19, h: 11, d: 12, head: 1.4, mode: 'open', focus, fade: [8, 16], rnd })
    // a ripe block: a rust-coloured ring in the headspace, drawn as a hatched band
    // on the bag wall just above the block top, and caramel droplets on top
    sk.inPart('rust', () => {
      sk.ctx = true
      const hw = 19 / 2 + 0.36
      const hd = 12 / 2 + 0.36
      const per = 2 * (hw * 2 + hd * 2)
      const n = Math.round(110 * Math.max(0.6, sk.detail))
      for (let i = 0; i < n; i++) {
        let q = ((i + 0.5) / n) * per
        let p: V3
        if (q < hw * 2) p = [-hw + q, 0, hd]
        else if ((q -= hw * 2) < hd * 2) p = [hw, 0, hd - q]
        else if ((q -= hd * 2) < hw * 2) p = [hw - q, 0, -hd]
        else p = [-hw, 0, -hd + (q - hw * 2)]
        const k = 1 - smooth(8, 16, Math.hypot(p[0], p[1] - 5.5, p[2]))
        if (k < 0.05) continue
        const y0 = 0.15 + 0.25 * Math.sin(i * 1.7)
        sk.seg([p[0], y0, p[2]], [p[0], y0 + 0.55 + 0.3 * Math.sin(i * 2.9), p[2]], { b: B.CTX * 1.5 * k, hid: 0.2 })
      }
      sk.ctx = false
      sk.anchor('rust', [hw * 0.55, 0.7, hd], [0, 0, 1])
    })
    const ripe = 1 - smooth(0.12, 0.24, t)
    if (ripe > 0.02)
      sk.inPart('caramel', () => {
        const dr = rng(SEED + 8)
        for (let i = 0; i < 9; i++) {
          const p: V3 = [rr(dr, -6, 6), 0.02, rr(dr, -2.5, 2.5)]
          droplet(sk, p, [0, 1, 0], 0.22 * ripe, B.FINE * 1.1)
          if (i === 2) sk.anchor('caramel', p, [0, 1, 0])
        }
      })
    // the razor slice across the top
    const cutOpen = smooth(0, 0.1, t)
    sk.ctx = true
    const slit: V3[] = []
    const slit2: V3[] = []
    for (let i = 0; i <= 16; i++) {
      const x = lerp(-6.5, 6.5, i / 16)
      const gap = 0.18 * cutOpen * Math.sin((Math.PI * i) / 16)
      slit.push([x, 0.02, gap])
      slit2.push([x, 0.02, -gap])
    }
    sk.line(slit, { b: B.CTX * 2.6 })
    sk.line(slit2, { b: B.CTX * 2 })
    sk.ctx = false
    sk.anchor('cut', [4.2, 0.05, 0.1], [0, 1, 0])

    // hyphal knots along the cut: most stay small, some become mushrooms
    const knots: { x: number; z: number; s: number }[] = []
    for (let i = 0; i < 18; i++) knots.push({ x: rr(rnd, -5.8, 5.8), z: rr(rnd, -0.35, 0.35), s: rr(rnd, 0.6, 1.3) })
    const kGrow = smooth(0.1, 0.28, t) * (1 - 0.35 * smooth(0.4, 0.7, t))
    if (kGrow > 0.01)
      sk.inPart('knots', () => {
        for (const k of knots) pin(sk, [k.x, 0, k.z], [rr(rnd, -0.2, 0.2), 1, rr(rnd, -0.2, 0.2)], 0.55 * k.s * kGrow, 0.28 * k.s * Math.sqrt(kGrow), B.FINE, 0.3)
        sk.anchor('knots', [knots[3].x, 0.45 * kGrow, knots[3].z], [0, 0, 1])
      })

    // the cluster: stems fused low down, splaying out of the cut
    const N = 11
    const mush = []
    for (let i = 0; i < N; i++) {
      const a = i * 2.39996 + rr(rnd, -0.3, 0.3)
      const rad = 0.35 + 1.25 * Math.sqrt((i + 0.5) / N)
      const lead = i < 5
      mush.push({
        base: [Math.cos(a) * rad * 1.5, 0, Math.sin(a) * rad * 0.55] as V3,
        dir: norm([Math.cos(a) * (0.32 + 0.25 * (i / N)), 1, Math.sin(a) * (0.3 + 0.2 * (i / N))]),
        delay: lead ? rr(rnd, 0.17, 0.22) : rr(rnd, 0.26, 0.36),
        grow: lead ? rr(rnd, 0.66, 0.72) : rr(rnd, 0.74, 0.86),
        size: lead ? rr(rnd, 0.92, 1.12) : rr(rnd, 0.62, 0.86),
        len: rr(rnd, 6.2, 8.6),
        lean: rr(rnd, -1.2, 1.2),
        seed: Math.floor(rnd() * 1e9),
      })
    }
    // a leading mushroom faces the front for the labels
    mush[0].base = [0.35, 0, 0.45]
    mush[0].dir = norm([0.12, 1, 0.3])
    mush[0].delay = 0.18
    mush[0].grow = 0.7
    mush[0].size = 1.1
    mush[0].len = 7.4
    let lagging: V3 | null = null
    const sorted = mush.map((m, i) => ({ ...m, i })).sort((p, q) => p.delay - q.delay)
    for (const m of sorted) {
      const mm = clamp((t - m.delay) / m.grow)
      if (mm <= 0.004) continue
      const ag = agaric(sk, {
        rnd: rng(m.seed),
        base: m.base,
        dir: m.dir,
        m: mm,
        L: (q) => m.len * smooth(0, 0.62, q) * (0.35 + 0.65 * smooth(0, 0.45, q)),
        r: 0.48 * m.size,
        taper: 0.78,
        club: 0.15,
        lean: m.lean,
        droop: (q) => smooth(0.86, 1, q) * 0.45,
        shape: {
          R: [
            [0, 0.3],
            [0.25, 0.95],
            [0.45, 1.45],
            [0.62, 1.95],
            [0.8, 2.45],
            [1, 2.75],
          ].map(([q, r]) => [q, r * m.size]) as [number, number][],
          phi: [
            [0, 1.8],
            [0.3, 1.62],
            [0.5, 1.32],
            [0.66, 1.05],
            [0.82, 0.55],
            [1, 0.32],
          ],
          curl: [
            [0, 1.05],
            [0.3, 0.95],
            [0.5, 0.62],
            [0.66, 0.42],
            [0.82, 0.04],
            [1, -0.34],
          ],
          umbo: [
            [0, 0],
            [0.6, 0.06],
            [1, 0.1],
          ],
          ruffle: [
            [0.7, 0],
            [1, 0.05],
          ],
          lobes: [
            [0.6, 0.02],
            [1, 0.06],
          ],
          thick: 0.32,
          edge: 0.02,
        },
        gills: { n: 34, tiers: 1, depth: 0.16, attach: 'adnate' },
        veil: { ringAt: 0.84, tear: 'both', from: 0.5, to: 0.7, fibrous: true },
        scales: { rows: 5, per: 15, size: 0.19, from: 0.06, to: 0.78, lift: 0.16 },
        stemScales: { from: 0.12, to: 0.7, rows: 6, per: 8, size: 0.11 },
        meridians: 12,
        nu: 36,
        b: m.i === 0 ? 1 : 0.86,
        tilt: (q) => smooth(0.85, 1, q) * 0.35,
      })
      if (m.i === 0) {
        sk.inPart('main', () => {})
        const c = ag.cap
        sk.anchor('scales', c.top(0.42, 0.9), c.topN(0.42, 0.9))
        sk.anchor('gills', c.gillEdge(0.6, 1.4), [0, -1, 0])
        sk.anchor('margin', c.rim(0.4), c.topN(0.98, 0.4))
        if (ag.veil) {
          sk.anchor('veil', ag.veil.mid)
          sk.anchor('ring', ag.veil.ring)
        }
        sk.anchor('stem', ag.stem.at(0.4, 1.2), ag.stem.nrm(0.4, 1.2))
      }
      if (m.i === 7) lagging = ag.cap.top(0.2, 1.0)
    }
    if (lagging) sk.anchor('lagging', lagging, [0, 1, 0])
    void TAU
    void madd
    void keys
  },
}
