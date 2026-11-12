// One capped mushroom (stem, cap, gills, veil) at a given maturity. Shared by the
// species with a central or near-central stem: chestnut, pioppino, shiitake,
// king oyster and black pearl.
import { type Cap, type CapShape, type GillSpec, type Stem, type VeilOut, cap, capScales, capSpeckle, capStreaks, decurrentRidges, keys, stem, stemFibres, stemScales, veil } from './parts'
import { B, type Sketch } from './sketch'
import { type Rnd, type V3, cross, lerp, madd, norm, smooth, wobble } from './math'

/** Cap shape at a maturity m (0..1): keyframes of [m, value]. */
export interface ShapeKeys {
  R: [number, number][]
  phi: [number, number][]
  curl: [number, number][]
  dip?: [number, number][]
  umbo?: [number, number][]
  thick: number
  edge?: number
  /** Margin waviness amplitude by maturity. */
  ruffle?: [number, number][]
  /** Plan irregularity amplitude (lobes) by maturity. */
  lobes?: [number, number][]
  ecc?: number
}

export interface AgaricOpts {
  rnd: Rnd
  /** Where the stem leaves the substrate, and the direction it starts in. */
  base: V3
  dir: V3
  /** Maturity 0 (pin) .. 1 (old). */
  m: number
  /** Full stem length and radius (cm), how the stem tapers (top radius / base radius). */
  L: (m: number) => number
  r: number
  taper?: number
  /** Swelling at the base (club) and a bulge (king). */
  club?: number
  /** Bend of the stem: sideways lean (cm at the top) and droop when old. */
  lean: number
  droop?: (m: number) => number
  shape: ShapeKeys
  gills: GillSpec
  /** Partial veil: where it joins the stem, how it tears, and the maturity window it tears in. */
  veil?: { ringAt: number; tear: 'margin' | 'stem' | 'both'; from: number; to: number; fibrous?: boolean }
  scales?: { rows: number; per: number; size: number; from?: number; to?: number; shape?: 'chevron' | 'tuft' | 'patch'; lift?: number }
  speckle?: number
  streaks?: number
  stemScales?: { from: number; to: number; rows: number; per: number; size: number }
  fibres?: number
  decurrent?: number
  /** Brightness multiplier (lagging, background mushrooms are dimmer). */
  b?: number
  meridians?: number
  nu?: number
  /** Cap tilt away from the stem axis (radians) by maturity, e.g. old caps droop. */
  tilt?: (m: number) => number
  tiltDir?: V3
  /** Sideways direction for the stem's lean (default: across dir). */
  side?: V3
  /** Turn the cap toward straight up (0..1): side shoots face the light. */
  capUp?: number
}

export interface Agaric {
  cap: Cap
  stem: Stem
  veil?: VeilOut
  top: V3
}

export function agaric(sk: Sketch, o: AgaricOpts): Agaric {
  const m = o.m
  const rnd = o.rnd
  // draw every random number up front, in a fixed order, so the shape is steady frame to frame
  const wob = wobble(rnd, 3, 7, 1)
  const lob = wobble(rnd, 2, 5, 1)
  const bend = rnd() * 2 - 1
  const seedA = Math.floor(rnd() * 1e9)
  const seedB = Math.floor(rnd() * 1e9)
  const seedC = Math.floor(rnd() * 1e9)
  const L = Math.max(0.05, o.L(m))
  const d0 = norm(o.dir)
  const sx = cross(d0, [0, 1, 0])
  const side: V3 = o.side ?? (Math.hypot(sx[0], sx[1], sx[2]) > 0.05 ? norm(sx) : [1, 0, 0])
  const droop = o.droop ? o.droop(m) : 0
  // stem path: rises along dir, curving up and out with a little S-bend
  const up: V3 = [0, 1, 0]
  const pts: V3[] = []
  const K = 5
  for (let i = 0; i <= K; i++) {
    const s = i / K
    let p = madd(o.base, d0, L * s * (1 - 0.35 * s))
    p = madd(p, up, L * 0.35 * s * s)
    p = madd(p, side, o.lean * s * s * 0.6 + bend * 0.12 * L * Math.sin(Math.PI * s))
    // old stems wither and lean
    p = madd(p, d0, droop * L * s * s)
    p = madd(p, up, -droop * L * 0.6 * s * s)
    pts.push(p)
  }
  const taper = o.taper ?? 0.85
  const club = o.club ?? 0
  const wither = smooth(0.85, 1, m) * 0.18
  const rr = (s: number) => o.r * (1 - wither) * (lerp(1, taper, s) + club * Math.exp(-((s / 0.18) ** 2)) * 0.6 + club * 0.25 * Math.sin(Math.PI * s)) * (0.55 + 0.45 * smooth(0, 0.3, m))
  let st: Stem = null as unknown as Stem
  sk.inPart('stem', () => {
    st = stem(sk, {
      path: pts,
      r: rr,
      n: 12,
      m: 14,
      longs: 7,
      rings: [0.0],
      b: o.b,
    })
  })
  const top = pts[K]
  let axis = st.axis(1)
  if (o.capUp) axis = norm([axis[0] * (1 - o.capUp), axis[1] * (1 - o.capUp) + o.capUp, axis[2] * (1 - o.capUp)])
  if (o.tilt) {
    const tdir = o.tiltDir ?? d0
    axis = norm(madd(axis, norm([tdir[0], 0, tdir[2]]), Math.tan(o.tilt(m))))
  }
  const sh = o.shape
  const amp = (k?: [number, number][]) => (k ? keys(m, k) : 0)
  const lobA = amp(sh.lobes)
  const rufA = amp(sh.ruffle)
  const shape: CapShape = {
    R: keys(m, sh.R),
    phi: keys(m, sh.phi),
    curl: keys(m, sh.curl),
    dip: amp(sh.dip),
    umbo: amp(sh.umbo),
    thick: sh.thick,
    edge: sh.edge,
    plan: (th) => 1 + (sh.ecc ?? 0) * Math.cos(th) + lobA * lob(th),
    ruffle: (th) => rufA * wob(th),
  }
  let c: Cap = null as unknown as Cap
  sk.inPart('cap', () => {
    c = cap(sk, {
    at: madd(top, axis, -o.r * 0.1),
    axis,
    fwd: side,
    shape,
    gills: o.gills,
    stemR: rr(1),
    nu: o.nu ?? 40,
    nv: 12,
    meridians: o.meridians ?? 14,
    rings: [0.35, 0.68],
    b: o.b,
  })
  })
  const r2 = (n: number) => {
    let a = n >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  if (o.scales) sk.inPart('scales', () => o.scales && capScales(sk, c, r2(seedA), { rows: o.scales.rows, per: o.scales.per, from: o.scales.from ?? 0.08, to: o.scales.to ?? 0.85, size: o.scales.size * Math.max(0.5, c.R / 2), shape: o.scales.shape, lift: o.scales.lift, b: B.FINE * (o.b ?? 1) }))
  if (o.speckle) capSpeckle(sk, c, r2(seedA), o.speckle, c.R * 0.06, B.SOFT * (o.b ?? 1))
  if (o.streaks) capStreaks(sk, c, r2(seedA), o.streaks, B.SOFT * (o.b ?? 1))
  if (o.stemScales) sk.inPart('scales', () => o.stemScales && stemScales(sk, st, r2(seedB), o.stemScales.rows, o.stemScales.per, o.stemScales.from, o.stemScales.to, o.stemScales.size, B.SOFT * 1.1 * (o.b ?? 1)))
  if (o.fibres) stemFibres(sk, st, r2(seedB), o.fibres, 0.05, 0.9, B.SOFT * (o.b ?? 1))
  if (o.decurrent) decurrentRidges(sk, c, st, o.decurrent, 0.35, B.FINE * (o.b ?? 1))
  let vo: VeilOut | undefined
  if (o.veil) {
    const v = o.veil
    const state = keys(m, [
      [v.from - 0.25, 0],
      [v.from, 0.42],
      [v.to, 0.8],
      [v.to + 0.12, 1],
    ])
    sk.inPart('veil', () => {
      vo = veil(sk, { cap: c, stem: st, ringAt: v.ringAt, state, tear: v.tear, rnd: r2(seedC), b: B.MAIN * 0.95 * (o.b ?? 1), fibrous: v.fibrous, threads: 30 })
    })
  }
  return { cap: c, stem: st, veil: vo, top }
}
