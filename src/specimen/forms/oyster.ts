// OYSTERS (Pleurotus): shelf clusters out of a cut in the side of a bag.
// Each cap is a fan on a short side stem; the stems fuse into one base in the
// cut; the gills run down the stems. Young caps are spoon-shaped with the margin
// rolled under; as they mature the margin unrolls and the caps flatten, then
// turn up, go wavy and drop spores. Blue, pink and the phoenix stand-in share it.
import { type Cap, bag, block, cap, capStreaks, decurrentRidges, faceCut, keys, pin, stem } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, add, clamp, cross, lerp, madd, mul, norm, rng, rr, smooth, wobble } from '../math'
import type { SpecimenModel, StageDef } from '../registry'

export interface OysterKind {
  id: string
  seed: number
  caps: number
  /** Cap radius multiplier, flesh thickness, margin ruffle when old, how far the caps cup. */
  size: number
  thick: number
  ruffle: number
  dip: number
  /** Stem length and radius (cm). */
  stemL: number
  stemR: number
  /** Fan opening (radians): wider wraps further round the stem. */
  span: number
  /** Long tongue-shaped caps (phoenix) vs round fans (blue). */
  tongue: number
  gills: number
  streaks: number
  /** Late margins split into lobes. */
  lobes: number
}

export const OYSTER_STAGES: StageDef[] = [
  { id: 'cut', at: 0 },
  { id: 'pins', at: 0.12 },
  { id: 'young', at: 0.3 },
  { id: 'pick', at: 0.5, hold: 3.2 },
  { id: 'flat', at: 0.68, hold: 1.2 },
  { id: 'late', at: 0.84 },
]

interface Plan {
  dir: V3
  tier: number
  delay: number
  grow: number
  size: number
  len: number
  tilt: number
  seed: number
  roll: number
}

/** The cluster at growth point t. */
export function oysterCluster(sk: Sketch, t: number, k: OysterKind) {
  const rnd = rng(k.seed)
  const W = 18
  const H = 26
  const D = 12
  const top: V3 = [0, H / 2, 0]
  // the cut sits in the middle of the front face
  const cutC: V3 = [0, 0, D / 2 + 0.05]
  const focus: V3 = [0, 1.5, D / 2 + 4]
  const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [9, 18], rnd, grain: 120 })
  bag(sk, { blk, top, w: W, h: H, d: D, head: 6, mode: 'closed', patch: true, focus, fade: [9, 18], rnd })
  faceCut(sk, cutC, [0, 0, 1], [0, 1, 0], 5.6, 'x', smooth(0.02, 0.2, t), B.CTX * 1.3)
  sk.anchor('cut', [2.1, 1.6, D / 2 + 0.3], [0, 0, 1])

  // plan every cap first (fixed random order): a fan of side stems in tiers
  const plans: Plan[] = []
  for (let i = 0; i < k.caps; i++) {
    const tier = i < Math.ceil(k.caps * 0.42) ? 0 : i < Math.ceil(k.caps * 0.78) ? 1 : 2
    const inTier = tier === 0 ? i : tier === 1 ? i - Math.ceil(k.caps * 0.42) : i - Math.ceil(k.caps * 0.78)
    const nTier = tier === 0 ? Math.ceil(k.caps * 0.42) : tier === 1 ? Math.ceil(k.caps * 0.78) - Math.ceil(k.caps * 0.42) : k.caps - Math.ceil(k.caps * 0.78)
    // sideways angle across the face, wider for the lower tiers
    const spread = tier === 0 ? 1.25 : tier === 1 ? 1.0 : 0.7
    const yaw = nTier === 1 ? 0 : lerp(-spread, spread, inTier / (nTier - 1)) + rr(rnd, -0.12, 0.12)
    const pitch = (tier === 0 ? -0.38 : tier === 1 ? 0.16 : 0.62) + rr(rnd, -0.08, 0.08)
    plans.push({
      dir: norm([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]),
      tier,
      delay: rr(rnd, 0.12, 0.16) + tier * 0.03,
      grow: rr(rnd, 0.68, 0.76),
      size: (tier === 0 ? rr(rnd, 0.92, 1.08) : tier === 1 ? rr(rnd, 0.72, 0.88) : rr(rnd, 0.5, 0.66)) * k.size,
      len: k.stemL * rr(rnd, 0.85, 1.2) * (tier === 2 ? 0.75 : tier === 1 ? 0.9 : 1.1),
      tilt: rr(rnd, 0.2, 0.34) + tier * 0.06,
      seed: Math.floor(rnd() * 1e9),
      roll: rr(rnd, -0.15, 0.15),
    })
  }
  // the front cap of the bottom tier carries the labels
  const front = plans.reduce((b, p, i) => (p.tier === 0 && Math.abs(p.dir[0]) < Math.abs(plans[b].dir[0]) ? i : b), 0)
  ;[plans[0], plans[front]] = [plans[front], plans[0]]

  // the shared base: a stout stump out of the cut
  const grow0 = smooth(0.1, 0.4, t)
  const stump = 1.2 * grow0 + 0.1
  const baseEnd: V3 = add(cutC, [0, 0, stump])
  if (grow0 > 0.02)
    stem(sk, {
      path: [madd(cutC, [0, 0, 1], -0.6), madd(cutC, [0, 0, 1], stump * 0.5), baseEnd],
      r: (s) => (1.15 - 0.3 * s) * (0.35 + 0.65 * grow0),
      n: 6,
      m: 14,
      longs: 7,
      rings: [0.5],
    })

  // pins: a crowded bouquet of knobs in the cut
  const pinK = smooth(0.1, 0.22, t) * (1 - smooth(0.3, 0.45, t))
  if (pinK > 0.01)
    sk.inPart('pins', () => {
      const pr = rng(k.seed + 7)
      for (let i = 0; i < 26; i++) {
        const a = pr() * TAU
        const d = Math.sqrt(pr()) * 1.6
        const p: V3 = [Math.cos(a) * d, Math.sin(a) * d * 0.8, cutC[2] + 0.1]
        const dir = norm([Math.cos(a) * 0.5, Math.sin(a) * 0.5 + 0.2, 1])
        pin(sk, p, dir, 0.9 * pinK * rr(pr, 0.6, 1.2), 0.32 * Math.sqrt(pinK) * rr(pr, 0.7, 1.2), B.FINE, 0.5)
      }
      sk.anchor('pins', [0.6, 0.9, cutC[2] + 0.9 * pinK], [0, 0, 1])
    })

  const lead: { c?: Cap; att?: V3; stemMid?: V3 } = {}
  const late = smooth(0.84, 1, t)
  plans.forEach((p, i) => {
    const m = clamp((t - p.delay) / p.grow)
    if (m <= 0.01) return
    const r = rng(p.seed)
    const wob = wobble(r, 3, 8, 1)
    const lob = wobble(r, 2, 5, 1)
    const L = p.len * smooth(0, 0.5, m)
    const out = norm([p.dir[0], 0, p.dir[2]])
    // side stem: out of the stump, curving up into the cap
    const s0 = madd(baseEnd, p.dir, -0.3)
    const s1 = madd(madd(s0, p.dir, L * 0.55), [0, 1, 0], L * 0.08)
    const att = madd(madd(s0, p.dir, L), [0, 1, 0], L * 0.3)
    let st: ReturnType<typeof stem> = null as unknown as ReturnType<typeof stem>
    sk.inPart('stem', () => {
    st = stem(sk, {
      path: [s0, s1, att],
      r: (s) => k.stemR * (1.2 - 0.35 * s) * (0.5 + 0.5 * smooth(0, 0.4, m)) * (p.tier === 2 ? 0.8 : 1),
      n: 7,
      m: 12,
      longs: 6,
      rings: [],
      b: p.tier === 0 ? 1 : 0.85,
    })
    })
    // cap axis: up, leaning out (young caps stand up like spoons, old ones lie flat)
    const lean = lerp(p.tilt + 0.3, p.tilt, smooth(0.2, 0.9, m))
    const axis = norm(add(mul([0, 1, 0], Math.cos(lean)), mul(out, Math.sin(lean))))
    const side = norm(cross(axis, out))
    const fwd = norm(add(out, mul(side, p.roll)))
    const lobA = keys(m, [[0.4, 0.03], [1, k.lobes]])
    const rufA = keys(m, [[0.55, 0.0], [0.78, k.ruffle * 0.35], [1, k.ruffle]])
    const R = keys(m, [
      [0, 0.3],
      [0.22, 0.9],
      [0.45, 2.3],
      [0.62, 3.3],
      [0.8, 4.0],
      [1, 4.4],
    ]) * p.size
    let c: Cap = null as unknown as Cap
    sk.inPart('cap', () => {
    c = cap(sk, {
      at: att,
      axis,
      fwd,
      shape: {
        R,
        phi: keys(m, [
          [0, 0.75],
          [0.3, 0.6],
          [0.5, 0.42],
          [0.65, 0.26],
          [0.8, 0.14],
          [1, 0.06],
        ]),
        curl: keys(m, [
          [0, 1.6],
          [0.3, 1.35],
          [0.5, 0.95],
          [0.6, 0.62],
          [0.72, 0.1],
          [0.86, -0.25],
          [1, -0.55],
        ]),
        curlAt: 0.62,
        dip: keys(m, [
          [0, 0.15],
          [0.5, k.dip * 0.8],
          [1, k.dip],
        ]),
        thick: k.thick,
        edge: 0.018,
        span: k.span,
        plan: (th) => (0.1 + 0.9 * Math.pow((1 + Math.cos(th)) / 2, 1.1 + k.tongue)) * (1 + lobA * lob(th)),
        curlBy: (th) => 0.65 + 0.35 * Math.cos(th),
        ruffle: (th) => rufA * wob(th),
      },
      gills: { n: k.gills, tiers: 1, depth: 0.065, attach: 'decurrent' },
      stemR: k.stemR * 0.8,
      nu: 48,
      nv: 12,
      meridians: 14,
      rings: [0.45, 0.78],
      b: p.tier === 0 ? 1 : 0.85,
    })
    })
    capStreaks(sk, c, r, k.streaks, B.SOFT * (p.tier === 0 ? 1 : 0.8), 0.3, 0.92)
    decurrentRidges(sk, c, st, Math.round(k.gills * 0.35), 0.75, B.FINE * 0.8)
    if (i === 0) {
      lead.c = c
      lead.att = att
      lead.stemMid = st.at(0.5, 0.6)
    }
  })
  const c = lead.c
  if (c) {
    sk.anchor('margin', c.rim(0.15), c.topN(0.95, 0.15))
    sk.anchor('cap', c.top(0.55, -0.5), c.topN(0.55, -0.5))
    sk.anchor('gills', c.gillEdge(0.55, 0.9), mul(c.f.w, -1))
    if (lead.stemMid) sk.anchor('stem', lead.stemMid)
  }
  // spores drifting down from the gills when old
  if (late > 0.02) {
    const sr = rng(k.seed + 99)
    sk.inPart('spores', () => {
      for (let i = 0; i < 46; i++) {
        const x0 = rr(sr, -6, 6)
        const z0 = rr(sr, 7, 13)
        const y0 = rr(sr, -1, 3)
        const ph = sr()
        const fall = ((t * 9 + ph) % 1) * 7
        const p: V3 = [x0 + Math.sin(ph * 9 + t * 20) * 0.3, y0 - fall, z0]
        sk.mark(p, [0, 0, 1], 0.12, { b: B.FINE * late * (1 - fall / 7), hid: 0 }, ph * 6)
        if (i === 3) sk.anchor('spores', p, [0, 0, 1])
      }
    })
  }
}

export function oysterModel(k: OysterKind): SpecimenModel {
  return {
    id: k.id,
    seed: k.seed,
    stages: OYSTER_STAGES,
    rest: 'pick',
    elev: 0.42,
    swing: 1.1,
    frame: { c: [0, 0.5, 8], r: 4 },
    build: (sk, t) => oysterCluster(sk, t, k),
  }
}

export const blueOyster = oysterModel({ id: 'blue-oyster', seed: 11, caps: 11, size: 1, thick: 0.2, ruffle: 0.08, dip: 0.5, stemL: 3.0, stemR: 0.62, span: 5.2, tongue: 0, gills: 64, streaks: 26, lobes: 0.1 })
export const pinkOyster = oysterModel({ id: 'pink-oyster', seed: 61, caps: 15, size: 0.74, thick: 0.13, ruffle: 0.2, dip: 0.35, stemL: 2.2, stemR: 0.42, span: 5.3, tongue: -0.1, gills: 52, streaks: 22, lobes: 0.2 })
export const phoenixOyster = oysterModel({ id: 'phoenix-oyster', seed: 53, caps: 8, size: 0.82, thick: 0.16, ruffle: 0.07, dip: 0.35, stemL: 3.4, stemR: 0.5, span: 4.6, tongue: 0.9, gills: 54, streaks: 18, lobes: 0.08 })
void smooth
void TAU
