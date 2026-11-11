// TURKEY TAIL (Trametes versicolor): thin, leathery brackets with no stem,
// out of two long slits in the side of a bag, row over row like roof shingles.
// White knobs push out of the slits, fuse, and flatten into little shelves that
// grow outward, not upward. Behind the pale growing edge, concentric colour
// zones form one ring at a time, the bands alternately velvety and smooth. The
// underside is a white pore surface (no gills). Left too long, the edge stops
// growing, curls under and the brackets dry stiff and fade.
import { type Cap, bag, block, cap, faceCut, fluff, keys, pin, pores } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, add, clamp, lerp, madd, mul, norm, rng, rr, smooth, wobble } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 191
const W = 18
const H = 26
const D = 12
/** The two slits across the front face: height and ends (cm). */
const SLITS = [
  { y: 3.8, x0: -6.2, x1: 6.0 },
  { y: -2.6, x0: -6.6, x1: 5.6 },
]

interface Bracket {
  slit: number
  /** Along the slit, and up or down from it (cm). */
  x: number
  y: number
  /** Upper layer of the shingles (smaller, later). */
  upper: boolean
  /** Turned this far sideways from straight out (radians), and how far the shelf
   * slopes down from its base to its margin, like a roof tile. */
  yaw: number
  droop: number
  /** Final size (plan radius, cm). */
  size: number
  delay: number
  grow: number
  seed: number
  /** Where its colour zones fall, from the base out (fractions of the radius). */
  zones: number[]
}

/** Every bracket, planned once (fixed random order). */
function plan(): Bracket[] {
  const rnd = rng(SEED + 3)
  const out: Bracket[] = []
  SLITS.forEach((sl, si) => {
    const len = sl.x1 - sl.x0
    // a lower row of four big shelves, and three smaller ones over the gaps
    const rows: { u: number; upper: boolean }[] = [
      { u: 0.11, upper: false },
      { u: 0.37, upper: false },
      { u: 0.63, upper: false },
      { u: 0.89, upper: false },
      { u: 0.24, upper: true },
      { u: 0.5, upper: true },
      { u: 0.76, upper: true },
    ]
    for (const r of rows) {
      const x = sl.x0 + len * (r.u + rr(rnd, -0.03, 0.03))
      // the shelves at the ends of a slit turn out sideways, as they do on a log
      const yaw = (x / (len / 2)) * 0.42 + rr(rnd, -0.08, 0.08)
      // irregular zone widths: narrow and wide bands, never evenly spaced
      const zones: number[] = []
      let s = rr(rnd, 0.1, 0.14)
      while (s < 0.86) {
        zones.push(s)
        s += rr(rnd, 0.06, 0.13)
      }
      out.push({
        slit: si,
        x,
        y: sl.y + (r.upper ? rr(rnd, 1.0, 1.35) : rr(rnd, -0.6, -0.3)),
        upper: r.upper,
        yaw,
        droop: r.upper ? rr(rnd, 0.2, 0.3) : rr(rnd, 0.1, 0.2),
        size: (r.upper ? rr(rnd, 2.3, 2.9) : rr(rnd, 3.1, 3.9)) * (si === 1 ? 1.06 : 1),
        delay: (r.upper ? rr(rnd, 0.15, 0.19) : rr(rnd, 0.1, 0.13)) + si * 0.012,
        grow: rr(rnd, 0.56, 0.62),
        seed: Math.floor(rnd() * 1e9),
        zones,
      })
    }
  })
  return out
}
const BRACKETS = plan()
/** The bracket that carries the labels: a middle shelf of the upper slit's lower row. */
const LEAD = 2
/** An upper-row shelf over it shows the tiers. */
const TIER = 5

/** Plan of a bracket seen from above, by angle from straight out: wider than deep,
 * narrowing to its base at the slit. */
const fanPlan = (th: number) => {
  const a = Math.abs(th)
  const ell = 1 / Math.sqrt((Math.cos(th) / 0.78) ** 2 + Math.sin(th) ** 2)
  return ell * (1 - 0.5 * smooth(1.05, 1.62, a))
}

export const turkeyTail: SpecimenModel = {
  id: 'turkey-tail',
  seed: SEED,
  stages: [
    { id: 'cut', at: 0, elev: 0.3 },
    { id: 'knobs', at: 0.12, elev: 0.34 },
    { id: 'shelves', at: 0.28, elev: 0.44 },
    { id: 'zones', at: 0.44, elev: 0.6 },
    { id: 'pick', at: 0.6, hold: 3.2, elev: 0.62 },
    { id: 'late', at: 0.82, elev: 0.54 },
  ],
  rest: 'pick',
  elev: 0.46,
  swing: 1.0,
  frame: { c: [0, 0.4, 8.2], r: 6.4 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const top: V3 = [0, H / 2, 0]
    const focus: V3 = [0, 0.5, D / 2 + 4]
    const fade: [number, number] = [10, 20]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade, rnd, grain: 120 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 6, mode: 'closed', patch: true, focus, fade, rnd })
    // the filter patch is up on the bag's head, out of the picture: label the bag face
    sk.anchor('bag', [W / 2 - 1.8, -5.4, D / 2 + 0.3], [0, 0, 1])
    const open = smooth(0.02, 0.18, t)
    // long slits open only a little (a slit's gape grows with its length)
    SLITS.forEach((sl) => faceCut(sk, [(sl.x0 + sl.x1) / 2, sl.y, D / 2 + 0.05], [0, 0, 1], [0, 1, 0], sl.x1 - sl.x0, 'slit', open * 0.32, B.CTX * 1.4))
    sk.anchor('slits', [SLITS[0].x1 - 0.8, SLITS[0].y, D / 2 + 0.25], [0, 0, 1])
    // the block is one tough white mat: it bulges in the open slits
    sk.anchor('mat', [-W / 2 + 1.6, -0.4, D / 2 + 0.2], [0, 0, 1])
    const matK = smooth(0.03, 0.2, t) * (1 - smooth(0.4, 0.6, t))
    if (matK > 0.02)
      sk.inPart('mat', () => {
        const fr = rng(SEED + 5)
        SLITS.forEach((sl) => {
          for (let i = 0; i < 4; i++) {
            const x = lerp(sl.x0 + 1, sl.x1 - 1, (i + 0.5) / 4)
            fluff(sk, [x, sl.y, D / 2 + 0.15], [0, 0, 1], 1.3, fr, 5, 0.35 * matK, B.SOFT * matK)
          }
        })
      })

    // knobs: rounded white lumps crowd out of the slits and fuse; most become
    // shelves (the brackets below start as knobs), a few stay small
    const knobK = smooth(0.08, 0.2, t) * (1 - smooth(0.32, 0.46, t))
    if (knobK > 0.01)
      sk.inPart('knobs', () => {
        const kr = rng(SEED + 7)
        SLITS.forEach((sl, si) => {
          for (let i = 0; i < 11; i++) {
            const x = lerp(sl.x0 + 0.6, sl.x1 - 0.6, (i + kr()) / 11)
            const p: V3 = [x, sl.y + rr(kr, -0.25, 0.25), D / 2 + 0.1]
            const dir = norm([rr(kr, -0.3, 0.3), rr(kr, -0.1, 0.35), 1])
            pin(sk, p, dir, 0.7 * knobK * rr(kr, 0.6, 1.2), 0.42 * Math.sqrt(knobK) * rr(kr, 0.7, 1.25), B.FINE, 0)
            if (si === 0 && i === 3) sk.anchor('knobs', madd(p, dir, 0.7 * knobK), [0, 0, 1])
          }
        })
      })

    const late = smooth(0.84, 1, t)
    const lead: { c?: Cap; band?: number; m?: number } = {}
    const tier: { p?: V3; n?: V3 } = {}
    BRACKETS.forEach((bk, i) => {
      const m = clamp((t - bk.delay) / bk.grow)
      if (m <= 0.01) return
      const r = rng(bk.seed)
      const lob = wobble(r, 2, 5, 1)
      const wav = wobble(r, 4, 9, 1)
      const out = norm([Math.sin(bk.yaw), 0, Math.cos(bk.yaw)])
      // the shelf lies nearly level, sloping down a little to its margin
      const axis = norm(add(mul([0, 1, 0], Math.cos(bk.droop)), mul(out, Math.sin(bk.droop))))
      const fwd = norm(add(out, mul(axis, -(out[0] * axis[0] + out[2] * axis[2]))))
      const att: V3 = [bk.x, bk.y, D / 2 + 0.42]
      const R = keys(m, [
        [0, 0.3],
        [0.12, 0.7],
        [0.3, 1.5],
        [0.55, 2.6],
        [0.8, 3.5],
        [1, 3.8],
      ]) * (bk.size / 3.8)
      const lobA = keys(m, [
        [0.35, 0.02],
        [1, 0.1],
      ]) + 0.03 * late
      const rufA = keys(m, [
        [0.4, 0],
        [0.75, 0.05],
        [1, 0.075],
      ]) + 0.05 * late
      const bb = (bk.upper ? 0.9 : 1) * lerp(1, 0.82, late)
      let c: Cap = null as unknown as Cap
      sk.inPart('brackets', () => {
        c = cap(sk, {
          at: att,
          axis,
          fwd,
          shape: {
            R,
            // a fat round knob first, then a thick white ledge with a rounded
            // edge, then a thin, nearly flat shelf
            phi: keys(m, [
              [0, 0.95],
              [0.2, 0.55],
              [0.42, 0.32],
              [0.7, 0.22],
              [1, 0.18],
            ]),
            curl: keys(m, [
              [0, 0.95],
              [0.25, 0.55],
              [0.5, 0.22],
              [0.8, 0.12],
              [1, 0.14],
            ]) + 0.55 * late,
            curlAt: 0.7,
            thick: keys(m, [
              [0, 0.7],
              [0.2, 0.45],
              [0.45, 0.2],
              [0.7, 0.09],
              [1, 0.055],
            ]),
            edge: 0.012,
            span: Math.PI + 0.24,
            plan: (th) => fanPlan(th) * (1 + lobA * lob(th)),
            ruffle: (th) => rufA * wav(th),
            curlBy: (th) => 0.75 + 0.25 * Math.cos(th),
            zones: 7,
            zoneAmp: 0.012 * smooth(0.45, 0.85, m),
          },
          gills: null,
          nu: 40,
          nv: 16,
          meridians: 6,
          rings: [],
          under: [0.5, 0.85],
          b: bb,
        })
      })
      const span = c.span
      const along = (s: number, lift: number, n = 26) => {
        const pts: V3[] = []
        const ns: V3[] = []
        for (let q = 0; q <= n; q++) {
          const th = -span / 2 + (span * q) / n
          const nn = c.topN(s, th)
          pts.push(madd(c.top(s, th), nn, lift))
          ns.push(nn)
        }
        return { pts, ns }
      }
      // colour zones: rings parallel to the margin, from the base out, each
      // one appearing once the growing edge has passed it
      const front = keys(m, [
        [0.3, 0],
        [0.5, 0.32],
        [0.75, 0.7],
        [1, 0.9],
      ])
      const zs = bk.zones.filter((s) => s < front - 0.04)
      if (zs.length)
        sk.inPart('zones', () => {
          zs.forEach((s, zi) => {
            const { pts, ns } = along(s, 0.012)
            // alternate bands read darker and lighter, like the real banding
            sk.line(pts, { b: (zi % 2 ? B.MAIN : B.EDGE * 0.78) * bb * lerp(1, 0.75, late), n: ns })
          })
        })
      // fine hairs stand on every other band: the velvety ones
      if (zs.length > 1 && m > 0.5)
        sk.inPart('velvet', () => {
          const vr = rng(bk.seed + 11)
          const count = Math.round(34 * sk.detail * smooth(0.5, 0.85, m) * (bk.upper ? 0.7 : 1))
          for (let h = 0; h < count; h++) {
            const zi = 2 * Math.floor(vr() * Math.floor(zs.length / 2))
            const s0 = zs[zi]
            const s1 = zs[zi + 1] ?? Math.min(0.95, s0 + 0.08)
            const s = lerp(s0, s1, rr(vr, 0.15, 0.85))
            const th = rr(vr, -span / 2 + 0.15, span / 2 - 0.15)
            const n = c.topN(s, th)
            const p0 = madd(c.top(s, th), n, 0.01)
            const p1 = madd(c.top(Math.min(0.98, s + 0.035), th + rr(vr, -0.04, 0.04)), n, 0.07)
            sk.line([p0, p1], { b: B.SOFT * 0.9 * bb, n, hid: 0 })
          }
        })
      // the pale growing edge: a band just inside the margin that narrows as the
      // bracket finishes, and is gone once it stops growing
      const band = keys(m, [
        [0.15, 0.72],
        [0.5, 0.86],
        [0.85, 0.93],
        [1, 0.955],
      ])
      const edgeK = smooth(0.12, 0.3, m) * (1 - smooth(0.82, 0.92, t))
      if (edgeK > 0.02)
        sk.inPart('edge', () => {
          const { pts, ns } = along(band, 0.012, 34)
          sk.line(pts, { b: B.EDGE * 0.9 * edgeK * bb, n: ns })
        })
      // no gills: a white pore surface underneath
      if (m > 0.3)
        sk.inPart('pores', () => {
          pores(sk, c, rng(bk.seed + 17), Math.round(46 * smooth(0.3, 0.85, m) * (bk.size / 3.8)), 0.05 + 0.03 * (R / 3.8), B.SOFT, 0.18, 0.9)
        })
      if (i === LEAD) {
        lead.c = c
        lead.band = band
        lead.m = m
      }
      // an upper shelf over the lead one shows the tiers
      if (i === TIER) {
        tier.p = c.rim(0.5)
        tier.n = c.topN(0.95, 0.5)
      }
    })

    const c = lead.c
    if (c && lead.band !== undefined) {
      sk.anchor('shelves', c.top(0.45, 0.25), c.topN(0.45, 0.25))
      sk.anchor('edge', c.top(lead.band, 0.55), c.topN(lead.band, 0.55))
      sk.anchor('zones', c.top(0.42, -0.35), c.topN(0.42, -0.35))
      sk.anchor('velvet', c.top(0.6, 0.95), c.topN(0.6, 0.95))
      sk.anchor('margin', c.rim(-0.85), c.topN(0.95, -0.85))
      sk.anchor('dry', c.rim(0.2), c.topN(0.95, 0.2))
      sk.anchor('pores', c.under(0.62, 0.35), mul(c.topN(0.62, 0.35), -1))
    }
    if (tier.p) sk.anchor('tiers', tier.p, tier.n)

    // fine white spores drift down from the pores when old
    if (late > 0.02) {
      const sr = rng(SEED + 99)
      sk.inPart('spores', () => {
        for (let i = 0; i < 40; i++) {
          const x0 = rr(sr, -6, 6)
          const z0 = rr(sr, 8, 12)
          const y0 = rr(sr, -5, 4)
          const ph = sr()
          const fall = ((t * 9 + ph) % 1) * 7
          const p: V3 = [x0 + Math.sin(ph * 9 + t * 20) * 0.3, y0 - fall, z0]
          sk.mark(p, [0, 0, 1], 0.1, { b: B.FINE * late * (1 - fall / 7), hid: 0 }, ph * 6)
          if (i === 5) sk.anchor('spores', p, [0, 0, 1])
        }
      })
    }
  },
}
