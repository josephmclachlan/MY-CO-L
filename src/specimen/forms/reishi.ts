// REISHI (Ganoderma lingzhi): CO2 sets the shape. Sealed in its bag (high CO2)
// it grows branching "antlers" that take months to reach the bag top. Strip the
// bag (fresh air, low CO2) and the antler tips flatten into kidney-shaped caps
// on side stalks, with concentric growth zones and pores underneath, then shed
// heavy brown spore dust.
import { bag, block, cap, capSpeckle, keys, pores, stem } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, add, clamp, cross, lerp, madd, mul, norm, qbez, rng, rr, smooth, sub } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 167

interface Seg {
  a: V3
  c: V3
  b: V3
  r0: number
  r1: number
  born: number
  dur: number
  /** Index into CAPS when a cap forms on this tip. */
  cap?: number
  /** Has children (not a tip). */
  fork?: boolean
}

/** The caps: which size, and when they form after the bag is stripped. */
const CAPS = [
  { size: 1.12, delay: 0.54, grow: 0.3, tilt: 0.3 },
  { size: 0.8, delay: 0.57, grow: 0.3, tilt: 0.34 },
  { size: 0.62, delay: 0.6, grow: 0.28, tilt: 0.28 },
]

export const reishi: SpecimenModel = {
  id: 'reishi',
  seed: SEED,
  stages: [
    { id: 'bag', at: 0 },
    { id: 'antlers', at: 0.12, hold: 1 },
    { id: 'bag-top', at: 0.32 },
    { id: 'strip', at: 0.46 },
    { id: 'caps', at: 0.56 },
    { id: 'cap', at: 0.7, hold: 3.2 },
    { id: 'spores', at: 0.86 },
  ],
  rest: 'cap',
  elev: 0.42,
  frame: { c: [0, 6.5, 0], r: 6.2 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 16
    const H = 16
    const D = 12
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, 6, 0]
    const fade: [number, number] = [11, 22]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade, rnd, grain: 90 })
    // the sealed bag (A-style filter patch) with tall headroom; stripped later
    const strip = smooth(0.47, 0.53, t)
    const HEAD = 16
    if (strip < 0.99) bag(sk, { blk, top: [0, -7 * strip, 0], w: W, h: H, d: D, head: HEAD, mode: 'closed', patch: true, focus, fade, rnd: rng(SEED + 1), k: 1 - strip })
    sk.anchor('bag', [W / 2 + 0.4, HEAD * 0.55 - 7 * strip, D / 2 + 0.4], [1, 0, 1])

    // ---- the antler plan: three antlers forking toward the bag top
    const segs: Seg[] = []
    const add2 = (a: V3, dir: V3, len: number, bend: V3, r0: number, r1: number, born: number, dur: number): Seg => {
      const b = madd(a, norm(dir), len)
      const c = add(lerp3m(a, b, 0.5), bend)
      const s: Seg = { a, c, b, r0, r1, born, dur }
      segs.push(s)
      return s
    }
    // antler 1: the tall one, forking twice
    const a1 = add2([-2.2, -0.2, 0.9], [-0.1, 1, 0.08], 6.2, [0.35, 0, 0.1], 1.0, 0.82, 0.1, 0.12)
    a1.fork = true
    const a1l = add2(a1.b, [-0.55, 1, 0.2], 4.6, [-0.3, 0, 0.2], 0.8, 0.68, 0.21, 0.12)
    a1l.cap = 0
    const a1r = add2(a1.b, [0.32, 1, -0.12], 5.4, [0.2, 0, -0.1], 0.8, 0.66, 0.21, 0.12)
    a1r.fork = true
    add2(a1r.b, [0.05, 1, 0.3], 3.2, [0.1, 0, 0.1], 0.64, 0.56, 0.31, 0.1)
    add2(a1r.b, [0.6, 1, -0.2], 2.6, [0.2, 0, 0], 0.62, 0.54, 0.31, 0.1)
    // antler 2: medium, one fork, one tip caps
    const a2 = add2([2.2, -0.2, -1.4], [0.22, 1, -0.12], 5.0, [-0.2, 0, 0.1], 0.95, 0.8, 0.13, 0.12)
    a2.fork = true
    const a2l = add2(a2.b, [0.8, 1, 0.25], 3.4, [0.25, 0, 0.15], 0.74, 0.64, 0.24, 0.12)
    a2l.cap = 1
    add2(a2.b, [-0.1, 1, -0.5], 4.4, [-0.15, 0, -0.1], 0.74, 0.62, 0.24, 0.12)
    // antler 3: a short one near the front that caps low
    const a3 = add2([1.0, -0.2, 2.8], [0.2, 1, 0.45], 3.0, [0.1, 0, 0.2], 0.85, 0.72, 0.17, 0.1)
    a3.cap = 2
    // two more that stay antlers: crowding, as in a real bag
    const a4 = add2([-4.6, -0.2, -2.2], [-0.25, 1, -0.2], 4.4, [0.2, 0, 0.1], 0.82, 0.68, 0.15, 0.12)
    a4.fork = true
    add2(a4.b, [-0.6, 1, 0.1], 2.8, [-0.1, 0, 0.1], 0.64, 0.56, 0.26, 0.1)
    add2(a4.b, [0.2, 1, -0.4], 3.4, [0.1, 0, -0.1], 0.64, 0.56, 0.26, 0.1)
    add2([4.4, -0.2, 2.0], [0.35, 1, 0.1], 3.6, [-0.15, 0, 0.1], 0.78, 0.66, 0.19, 0.12)

    // caps form on chosen tips once the bag is off: those tips stop reaching
    const capM = CAPS.map((c) => clamp((t - c.delay) / c.grow))
    const spores = smooth(0.86, 1, t)
    const tips: { p: V3; dir: V3; r: number }[] = []
    let antlerMid: V3 | null = null
    sk.inPart('antlers', () => {
      segs.forEach((s, i) => {
        const g = smooth(s.born, s.born + s.dur, t)
        if (g <= 0.01) return
        const n = 5
        const path: V3[] = []
        for (let q = 0; q <= n; q++) path.push(qbez(s.a, s.c, s.b, (q / n) * g))
        const tip = !s.fork || smooth(s.born + s.dur, s.born + s.dur + 0.08, t) < 0.5
        const capped = s.cap !== undefined && capM[s.cap] > 0.02
        const round = tip && !capped
        const r = (u: number) => {
          // knobbly, lacquered antler: a slight swelling here and there
          const k = lerp(s.r0, s.r1, u * g) * (1 + 0.07 * Math.sin(u * g * 9 + i * 1.7) + 0.12 * Math.exp(-(((u * g) / 0.12) ** 2)) * (i > 0 ? 1 : 0))
          // the soft, rounded growing tip
          return round ? k * Math.sqrt(Math.max(0.03, 1 - Math.pow(Math.max(0, u - 0.8) / 0.2, 2))) : k
        }
        const st = stem(sk, { path, r, n: 8, m: 12, longs: 5, rings: [0.35, 0.7], b: 0.95, capTop: !round })
        if (i === 0) antlerMid = st.at(0.55, 1.2)
        if (round) tips.push({ p: path[n], dir: norm(sub(path[n], path[n - 1])), r: lerp(s.r0, s.r1, g) })
      })
    })
    // white growing tips: a soft halo of fuzz while they are still reaching
    const fuzz = 1 - smooth(0.6, 0.75, t)
    if (fuzz > 0.02)
      sk.inPart('tips', () => {
        for (const tp of tips) {
          const p = tp.p
          const f = tp.dir
          // the pale band of the soft growing tip
          const c = madd(p, f, -0.55)
          let u = cross(f, [0, 0, 1])
          if (Math.hypot(u[0], u[1], u[2]) < 0.1) u = cross(f, [1, 0, 0])
          u = norm(u)
          const v = cross(f, u)
          const ring: V3[] = []
          for (let q = 0; q < 12; q++) {
            const a = (q / 12) * TAU
            ring.push(add(c, add(mul(u, Math.cos(a) * tp.r * 1.03), mul(v, Math.sin(a) * tp.r * 1.03))))
          }
          sk.line(ring, { b: B.FINE * fuzz, closed: true, hid: 0.2 })
        }
        if (tips[0]) sk.anchor('tips', tips[0].p, [0, 1, 0])
      })
    if (antlerMid) sk.anchor('antlers', antlerMid, [0, 0, 1])

    // ---- the caps
    let lead: ReturnType<typeof cap> | null = null
    sk.inPart('cap', () => {
      segs.forEach((s) => {
        if (s.cap === undefined) return
        const cp = CAPS[s.cap]
        const m = capM[s.cap]
        if (m <= 0.02) return
        const r2 = rng(SEED * 5 + s.cap)
        const lean = norm([s.b[0] - s.a[0], 0, s.b[2] - s.a[2]])
        const out = Math.hypot(lean[0], lean[2]) > 0.1 ? lean : ([1, 0, 0] as V3)
        // the cap lies nearly level, its outer edge dipping a little
        const axis = norm(add([0, 1, 0], mul(out, cp.tilt * 0.5)))
        const R = cp.size * keys(m, [
          [0, 0.75],
          [0.25, 1.5],
          [0.55, 2.8],
          [0.8, 3.6],
          [1, 3.9],
        ])
        const zones = 5
        const c = cap(sk, {
          at: madd(s.b, axis, -0.1),
          axis,
          fwd: norm(sub(out, mul(axis, out[0] * axis[0] + out[2] * axis[2]))),
          shape: {
            R,
            phi: keys(m, [
              [0, 1.25],
              [0.3, 0.8],
              [0.7, 0.5],
              [1, 0.42],
            ]),
            curl: keys(m, [
              [0, 1.0],
              [0.4, 0.8],
              [1, 0.6],
            ]),
            curlAt: 0.76,
            thick: 0.28,
            edge: 0.1,
            // kidney: the stalk joins near the back, where the margin is notched
            plan: (th) => (1 + 0.55 * Math.cos(th)) * (1 - 0.38 * Math.exp(-((angDist(th, Math.PI) / 0.45) ** 2))),
            zones,
            zoneAmp: 0.03 * smooth(0.3, 0.8, m),
          },
          gills: null,
          stemR: s.r1,
          nu: 52,
          nv: 14,
          meridians: 7,
          // the growth zones
          rings: [0.2, 0.4, 0.6, 0.8],
          under: [0.4, 0.75],
        })
        // the white growing edge: a band just inside the margin that narrows as
        // the cap finishes growing
        const band = lerp(0.84, 0.95, smooth(0.5, 1, m))
        const edge: V3[] = []
        for (let q = 0; q < 52; q++) edge.push(madd(c.top(band, (q / 52) * TAU), c.topN(band, (q / 52) * TAU), 0.01))
        sk.line(edge, { b: B.EDGE * 0.85, closed: true, n: edge.map((_, q) => c.topN(band, (q / 52) * TAU)) })
        pores(sk, c, r2, Math.round(70 * smooth(0.3, 0.9, m) * cp.size), 0.06 * R / 3.7 + 0.03, B.SOFT, 0.2, 0.9)
        // heavy brown spore dust settles over the tops
        if (spores > 0.02) capSpeckle(sk, c, r2, Math.round(90 * spores * cp.size), 0.16, B.SOFT * 1.2, 0.05, 0.85)
        if (s.cap === 0) lead = c
      })
    })
    const lc = lead as ReturnType<typeof cap> | null
    if (lc) {
      sk.anchor('cap', lc.top(0.5, 0.55), lc.topN(0.5, 0.55))
      sk.anchor('zones', lc.top(0.58, -0.4), lc.topN(0.58, -0.4))
      sk.anchor('edge', lc.rim(0.25), lc.topN(0.95, 0.25))
      sk.anchor('pores', lc.under(0.6, 0.9), mul(lc.topN(0.6, 0.9), -1))
    }
    // spores drifting down
    if (spores > 0.02) {
      const sr = rng(SEED + 9)
      sk.inPart('spores', () => {
        for (let i = 0; i < 44; i++) {
          const ph = sr()
          const fall = ((t * 9 + ph) % 1) * 9
          const p: V3 = [rr(sr, -6, 6), rr(sr, 6, 13) - fall, rr(sr, -4, 6)]
          sk.mark(p, [0, 0, 1], 0.12, { b: B.FINE * spores * (1 - fall / 9), hid: 0 }, ph * 6)
          if (i === 4) sk.anchor('spores', p, [0, 0, 1])
        }
      })
    }
    void cross
  },
}

const lerp3m = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const angDist = (a: number, b: number) => {
  let d = (a - b) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return Math.abs(d)
}
