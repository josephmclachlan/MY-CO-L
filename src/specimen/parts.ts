// Anatomy parts shared by the species models: caps with a true cross-section
// (top skin, flesh, gill surface, gill edges, rolled or upturned margin),
// stems, partial veils that stretch and tear, cap scales, pins, droplets and
// the grow block with its bag. All original geometry, built from maths.
import { B, type Ln, type Sketch, gridNormal, picks, surface } from './sketch'
import {
  type Frame,
  type Rnd,
  type V3,
  TAU,
  add,
  clamp,
  cross,
  dist,
  dot,
  frameOf,
  inF,
  lerp,
  lerp3,
  madd,
  mul,
  norm,
  qbez,
  rr,
  smooth,
  spline,
  sub,
  transport,
} from './math'

// ---------------------------------------------------------------- cap

export interface CapShape {
  /** Largest radius in plan (cm). */
  R: number
  /** Dome: total bend of the top skin from the centre out (radians). */
  phi: number
  /** Extra bend at the margin: + rolled under (young), - turned up (old). */
  curl: number
  /** Where along the radius the margin bend starts (0..1). */
  curlAt?: number
  /** Central dip (radians of rise from the centre): + makes a funnel. */
  dip?: number
  /** Rounded bump in the centre (fraction of R). */
  umbo?: number
  /** Flesh thickness at the centre and at the margin (fractions of R). */
  thick: number
  edge?: number
  /** Plan radius multiplier by angle (1 = round). */
  plan?: (th: number) => number
  /** Vertical wave of the margin by angle (fraction of R). */
  ruffle?: (th: number) => number
  /** Margin bend multiplier by angle (oysters roll more at the front). */
  curlBy?: (th: number) => number
  /** Angular span: TAU for a round cap, less for a fan (opening at the back). */
  span?: number
  /** Concentric growth ridges on the top (reishi): how many, and their height (fraction of R). */
  zones?: number
  zoneAmp?: number
}

export interface GillSpec {
  /** Full-length gills around the whole cap (scaled for fans). */
  n: number
  /** Short gills between them: 0, 1 or 2 tiers. */
  tiers?: number
  /** Gill depth (fraction of R). */
  depth: number
  /** How they meet the stem. */
  attach?: 'free' | 'notched' | 'adnate' | 'decurrent'
  b?: number
}

export interface CapOpts {
  /** Where the cap's underside meets the top of the stem. */
  at: V3
  /** Cap axis (underside to top) and the forward direction (fans open toward it). */
  axis: V3
  fwd?: V3
  shape: CapShape
  gills?: GillSpec | null
  /** Stem radius at the top, so gills start at the stem. */
  stemR?: number
  /** Grid size: around and out. */
  nu?: number
  nv?: number
  /** Number of radial skin lines and which rings to draw (fractions of the radius). */
  meridians?: number
  rings?: number[]
  b?: number
  occlude?: boolean
  /** Draw the underside skin lines (pore surface or gill base). */
  under?: number[]
}

export interface Cap {
  f: Frame
  at: V3
  R: number
  span: number
  /** Points on the cap: s = 0 centre .. 1 margin tip, th = angle from forward. */
  top(s: number, th: number): V3
  topN(s: number, th: number): V3
  under(s: number, th: number): V3
  gillEdge(s: number, th: number): V3
  /** Fraction of the radius where the gills start (at the stem). */
  s0: number
  rim(th: number): V3
  /** Plan radius at th (cm). */
  planR(th: number): number
}

interface Prof {
  rho: number[]
  z: number[]
  phi: number[]
}

/** Integrate the cap's cross-section: angle of the skin from the centre out. */
function profile(sh: CapShape, curlMul: number, steps: number): Prof {
  const sub_ = 6
  const N = steps * sub_
  const ca = sh.curlAt ?? 0.62
  const dip = sh.dip ?? 0
  const rho = [0]
  const z = [0]
  const ph = [0]
  let r = 0
  let h = 0
  const ang = (s: number) => sh.phi * s + sh.curl * curlMul * smooth(ca, 1, s) - dip * (1 - smooth(0, 0.55, s)) * (1 - s)
  for (let k = 1; k <= N; k++) {
    const s = (k - 0.5) / N
    const a = ang(s)
    r += Math.cos(a) / N
    h -= Math.sin(a) / N
    if (k % sub_ === 0) {
      rho.push(r)
      z.push(h)
      ph.push(ang(k / N))
    }
  }
  // scale so the widest point is at radius 1
  const m = Math.max(...rho) || 1
  return { rho: rho.map((x) => x / m), z: z.map((x) => x / m), phi: ph }
}

const sample = (arr: number[], s: number) => {
  const n = arr.length - 1
  const g = clamp(s) * n
  const i = Math.min(n - 1, Math.floor(g))
  return lerp(arr[i], arr[i + 1], g - i)
}

/** Build a cap and draw it. Returns point functions for gills, veils, scales and labels. */
export function cap(sk: Sketch, o: CapOpts): Cap {
  const sh = o.shape
  const span = sh.span ?? TAU
  const full = span >= TAU - 1e-6
  const det = sk.detail
  const nu = Math.max(12, Math.round((o.nu ?? 48) * (full ? 1 : span / TAU + 0.35) * det))
  const nv = o.nv ?? 14
  const f = frameOf(o.axis, o.fwd ?? [1, 0, 0])
  const R = sh.R
  const thAt = (j: number) => (full ? (j / nu) * TAU : -span / 2 + (span * j) / (nu - 1))
  const plan0 = sh.plan ?? (() => 1)
  const ruffle0 = sh.ruffle ?? (() => 0)
  const curlBy = sh.curlBy ?? (() => 1)
  // the same angles come up again and again (grid columns, gill lines): remember them
  const pc = new Map<number, number>()
  const rc = new Map<number, number>()
  const plan = (th: number) => {
    let v = pc.get(th)
    if (v === undefined) pc.set(th, (v = plan0(th)))
    return v
  }
  const ruffle = (th: number) => {
    let v = rc.get(th)
    if (v === undefined) rc.set(th, (v = ruffle0(th)))
    return v
  }
  const T0 = sh.thick * R
  const edgeT = (sh.edge ?? 0.012) * R
  // one profile per column (the margin may roll differently around the cap)
  const cache = new Map<number, Prof>()
  const kc = new Map<number, number>()
  const prof = (th: number) => {
    let key = kc.get(th)
    if (key === undefined) kc.set(th, (key = Math.round(curlBy(th) * 200)))
    let p = cache.get(key)
    if (!p) {
      p = profile(sh, key / 200, nv)
      cache.set(key, p)
    }
    return p
  }
  const thick = (s: number) => T0 * Math.pow(1 - s, 1.3) + edgeT
  const local = (s: number, th: number, layer: number): [number, number, number, number] => {
    // returns (x, y, z) in the cap frame plus the skin angle
    const p = prof(th)
    const k = R * plan(th)
    const rho = sample(p.rho, s) * k
    let zz = sample(p.z, s) * k + T0
    const a = sample(p.phi, s)
    zz += (sh.umbo ?? 0) * R * Math.exp(-((s / 0.28) ** 2))
    zz += ruffle(th) * R * smooth(0.5, 1, s)
    if (sh.zones) zz += (sh.zoneAmp ?? 0.02) * R * (0.5 - 0.5 * Math.cos(TAU * sh.zones * s)) * smooth(0.1, 0.3, s) * (1 - smooth(0.9, 1, s))
    // normal of the cross-section (pointing out of the top skin)
    const nr = Math.sin(a)
    const nz = Math.cos(a)
    let off = 0
    if (layer >= 1) off += thick(s)
    if (layer >= 2) off += gillDepth(s)
    const x = rho - nr * off
    const z = zz - nz * off
    return [x * Math.cos(th), x * Math.sin(th), z, a]
  }
  const gs = o.gills
  let s0 = 0.08
  const stemR = o.stemR ?? 0
  // gills start where the underside reaches the stem
  for (let k = 0; k <= 60; k++) {
    const s = k / 60
    const [x, y] = local(s, 0, 1)
    if (Math.hypot(x, y) >= stemR * 1.02) {
      s0 = s
      break
    }
  }
  const gillDepth = (s: number) => {
    if (!gs) return 0
    const x = clamp((s - s0) / (1 - s0))
    const D = gs.depth * R
    switch (gs.attach ?? 'adnate') {
      case 'free':
        return D * Math.pow(Math.sin(Math.PI * clamp(x * 0.92 + 0.04)), 0.7) * (1 - 0.35 * x)
      case 'notched':
        return D * (0.45 + 0.55 * Math.sin(Math.PI * clamp(0.18 + x * 0.82))) * (1 - smooth(0.82, 1, x)) * smooth(-0.15, 0.2, x)
      case 'decurrent':
        return D * (0.75 + 0.25 * Math.sin(Math.PI * x)) * (1 - smooth(0.78, 1, x))
      default:
        return D * (0.62 + 0.38 * Math.sin(Math.PI * clamp(x * 0.9))) * (1 - smooth(0.8, 1, x))
    }
  }
  const P = (s: number, th: number, layer: number): V3 => {
    const [x, y, z] = local(s, th, layer)
    return inF(o.at, f, x, y, z)
  }
  const N = (s: number, th: number): V3 => {
    const e = 1e-3
    const a = P(s, th, 0)
    const b = P(Math.min(1, s + e), th, 0)
    const c = P(s, th + (full ? e : e), 0)
    let n = norm(cross(sub(b, a), sub(c, a)))
    // keep it facing away from the underside
    const u = P(s, th, 1)
    if (dot(n, sub(a, u)) < 0) n = mul(n, -1)
    return n
  }

  // --- skins
  const topRows: V3[][] = []
  const undRows: V3[][] = []
  for (let i = 0; i <= nv; i++) {
    const s = i / nv
    const tr: V3[] = []
    const ur: V3[] = []
    for (let j = 0; j < nu; j++) {
      const th = thAt(j)
      tr.push(P(s, th, 0))
      ur.push(P(s, th, 1))
    }
    topRows.push(tr)
    undRows.push(ur)
  }
  const bb = o.b ?? 1
  const merK = Math.max(4, Math.round((o.meridians ?? 16) * (full ? 1 : span / TAU + 0.3) * Math.max(0.6, det)))
  const rings = o.rings ?? [0.3, 0.55, 0.8]
  const ringIdx = rings.map((s) => Math.round(s * nv))
  const out = (i: number, j: number) => sub(topRows[i][j], undRows[Math.min(nv, i)][j])
  surface(sk, topRows, {
    closedU: full,
    rowsAt: ringIdx,
    colsAt: picks(nu, merK, full),
    rowB: B.MAIN * 0.8 * bb,
    colB: B.MAIN * bb,
    outward: (i, j) => {
      const d = out(i, j)
      return d[0] === 0 && d[1] === 0 && d[2] === 0 ? f.w : d
    },
    occlude: o.occlude !== false,
  })
  // margin: the line the shape is read by
  const marg = topRows[nv]
  sk.line(marg, { b: B.EDGE * bb, closed: full, n: marg.map((_, j) => gridNormal(topRows, nv, j, full, sub(marg[j], undRows[nv][j]))) })
  if (!full) {
    // the two cut edges of a fan run back to the stem
    sk.line(topRows.map((r) => r[0]), { b: B.MAIN * bb })
    sk.line(topRows.map((r) => r[nu - 1]), { b: B.MAIN * bb })
  }
  // underside skin (the gill or pore surface base)
  surface(sk, undRows, {
    closedU: full,
    rowsAt: (o.under ?? []).map((s) => Math.round(s * nv)),
    rowB: B.SOFT * bb,
    outward: (i, j) => mul(out(i, j), -1),
    occlude: o.occlude !== false,
  })
  // close the margin between the skins
  if (o.occlude !== false) sk.grid([marg, undRows[nv]], full)

  // --- gills
  if (gs)
    sk.inPart('gills', () => {
    const gb = (gs.b ?? B.FINE) * bb
    const nFull = Math.max(6, Math.round(gs.n * (full ? 1 : span / TAU) * Math.max(0.55, det)))
    const tiers = gs.tiers ?? 1
    const per = 1 << tiers
    const total = nFull * per
    const steps = Math.max(8, Math.round(nv * 1.2))
    for (let g = 0; g < total; g++) {
      const th = full ? (g / total) * TAU : -span / 2 + span * ((g + 0.5) / total)
      // which tier: full gills every `per`, then halves, then quarters
      let lvl = 0
      for (let t = per; t > 1; t >>= 1) if (g % t !== 0) lvl++
      const sStart = lvl === 0 ? s0 : lvl === 1 && tiers === 2 ? lerp(s0, 1, 0.38) : lerp(s0, 1, tiers === 2 ? 0.66 : 0.45)
      const pts: V3[] = []
      for (let k = 0; k <= steps; k++) {
        const s = lerp(sStart, 1, k / steps)
        pts.push(P(s, th, 2))
      }
      // short gills rise to the underside where they begin
      if (lvl > 0) pts.unshift(P(sStart, th, 1))
      sk.line(pts, { b: gb * (lvl === 0 ? 1 : 0.8), hid: 0.6 })
    }
  })

  return {
    f,
    at: o.at,
    R,
    span,
    s0,
    top: (s, th) => P(s, th, 0),
    topN: N,
    under: (s, th) => P(s, th, 1),
    gillEdge: (s, th) => P(s, th, 2),
    rim: (th) => P(1, th, 0),
    planR: (th) => R * plan(th),
  }
}

/** Gills that run down the stem (oysters, king): ridges on the stem below the cap. */
export function decurrentRidges(sk: Sketch, c: Cap, st: Stem, n: number, length: number, b = B.FINE) {
  sk.inPart('gills', () => ridges(sk, c, st, n, length, b))
}
function ridges(sk: Sketch, c: Cap, st: Stem, n: number, length: number, b: number) {
  const m = Math.max(6, Math.round(n * sk.detail))
  for (let g = 0; g < m; g++) {
    const th0 = (c.span >= TAU - 1e-6 ? (g / m) * TAU : -c.span / 2 + c.span * ((g + 0.5) / m))
    const start = c.gillEdge(c.s0 + 0.02, th0)
    const pts: V3[] = [start]
    const k = 6
    for (let i = 1; i <= k; i++) {
      const s = 1 - (i / k) * length
      // the angle around the stem nearest the gill
      const ax = st.axis(s)
      const cen = st.centre(s)
      const d = sub(start, cen)
      const radial = norm(sub(d, mul(ax, dot(d, ax))))
      pts.push(madd(cen, radial, st.radius(s) * 1.01))
    }
    sk.line(pts, { b: (i) => b * (1 - i / (k + 1)) })
  }
}

// ---------------------------------------------------------------- stem

export interface StemOpts {
  /** Control points from the base up to the cap. */
  path: V3[]
  /** Radius along the stem (s = 0 base .. 1 top). */
  r: (s: number) => number
  n?: number
  m?: number
  longs?: number
  rings?: number[]
  b?: number
  occlude?: boolean
  /** Close the top with a disc (cut stems, antler tips). */
  capTop?: boolean
}

export interface Stem {
  pts: V3[]
  frames: Frame[]
  centre(s: number): V3
  axis(s: number): V3
  radius(s: number): number
  /** Point on the surface at height s, angle th (around the stem), pushed out by dr. */
  at(s: number, th: number, dr?: number): V3
  nrm(s: number, th: number): V3
}

export function stem(sk: Sketch, o: StemOpts): Stem {
  const n = o.n ?? 14
  const m = Math.max(8, Math.round((o.m ?? 16) * Math.max(0.6, sk.detail)))
  const pts = spline(o.path, n)
  const fr = transport(pts, [0, 0, 1])
  const rows: V3[][] = []
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1)
    const r = o.r(s)
    const row: V3[] = []
    for (let j = 0; j < m; j++) {
      const a = (j / m) * TAU
      row.push(add(pts[i], add(mul(fr[i].u, Math.cos(a) * r), mul(fr[i].v, Math.sin(a) * r))))
    }
    rows.push(row)
  }
  const bb = o.b ?? 1
  const longs = Math.max(3, Math.round((o.longs ?? 8) * Math.max(0.6, sk.detail)))
  surface(sk, rows, {
    closedU: true,
    rowsAt: (o.rings ?? [0]).map((s) => Math.round(s * (n - 1))),
    colsAt: picks(m, longs, true),
    rowB: B.SOFT * bb,
    colB: B.MAIN * 0.85 * bb,
    outward: (i, j) => sub(rows[i][j], pts[i]),
    occlude: o.occlude !== false,
  })
  if (o.capTop && o.occlude !== false) sk.fan(pts[n - 1], rows[n - 1])
  const idx = (s: number) => {
    const g = clamp(s) * (n - 1)
    const i = Math.min(n - 2, Math.floor(g))
    return [i, g - i] as const
  }
  const centre = (s: number): V3 => {
    const [i, t] = idx(s)
    return lerp3(pts[i], pts[i + 1], t)
  }
  const frameAt = (s: number): Frame => {
    const [i, t] = idx(s)
    const a = fr[i]
    const b = fr[i + 1]
    const w = norm(lerp3(a.w, b.w, t))
    const u = norm(lerp3(a.u, b.u, t))
    return { u, v: cross(w, u), w }
  }
  return {
    pts,
    frames: fr,
    centre,
    axis: (s) => frameAt(s).w,
    radius: o.r,
    at: (s, th, dr = 0) => {
      const F = frameAt(s)
      const r = o.r(s) + dr
      return add(centre(s), add(mul(F.u, Math.cos(th) * r), mul(F.v, Math.sin(th) * r)))
    },
    nrm: (s, th) => {
      const F = frameAt(s)
      return norm(add(mul(F.u, Math.cos(th)), mul(F.v, Math.sin(th))))
    },
  }
}

/** Fine fibres or streaks running along a stem. */
export function stemFibres(sk: Sketch, st: Stem, rnd: Rnd, count: number, from = 0.05, to = 0.95, b = B.SOFT) {
  const k = Math.round(count * sk.detail)
  for (let i = 0; i < k; i++) {
    const th = rnd() * TAU
    const a = rr(rnd, from, to - 0.15)
    const l = rr(rnd, 0.08, 0.3)
    const pts: V3[] = []
    for (let q = 0; q <= 4; q++) pts.push(st.at(Math.min(to, a + (l * q) / 4), th + q * 0.02, 0.002))
    sk.line(pts, { b, n: st.nrm(a, th) })
  }
}

/** Small recurved scales on a stem (below a ring zone). */
export function stemScales(sk: Sketch, st: Stem, rnd: Rnd, rows: number, per: number, from: number, to: number, size: number, b = B.FINE) {
  const pr = Math.max(4, Math.round(per * Math.max(0.6, sk.detail)))
  for (let r = 0; r < rows; r++) {
    const s = lerp(from, to, (r + 0.5) / rows)
    for (let i = 0; i < pr; i++) {
      const th = ((i + (r % 2) * 0.5) / pr) * TAU + rr(rnd, -0.15, 0.15)
      const p = st.at(s, th, 0)
      const nn = st.nrm(s, th)
      const ax = st.axis(s)
      const side = cross(ax, nn)
      // a little chevron that lifts away from the stem, pointing down
      const tip = madd(madd(p, ax, -size), nn, size * 0.5)
      sk.line([madd(p, side, size * 0.45), tip, madd(p, side, -size * 0.45)], { b, n: nn })
    }
  }
}

// ---------------------------------------------------------------- cap decoration

/** Raised scales in rings over a cap (chestnut, shiitake margin). */
export function capScales(
  sk: Sketch,
  c: Cap,
  rnd: Rnd,
  o: { rows: number; per: number; from: number; to: number; size: number; lift?: number; b?: number; shape?: 'chevron' | 'tuft' | 'patch' },
) {
  const b = o.b ?? B.FINE
  for (let r = 0; r < o.rows; r++) {
    const s = lerp(o.from, o.to, o.rows === 1 ? 0.5 : r / (o.rows - 1))
    const count = Math.max(3, Math.round(o.per * (0.4 + s) * Math.max(0.55, sk.detail)))
    for (let i = 0; i < count; i++) {
      let th = ((i + (r % 2) * 0.5 + rr(rnd, -0.25, 0.25)) / count) * c.span
      if (c.span < TAU - 1e-6) th -= c.span / 2
      const ss = clamp(s + rr(rnd, -0.03, 0.03), 0.02, 0.98)
      const p = c.top(ss, th)
      const n = c.topN(ss, th)
      const out = norm(sub(c.top(Math.min(1, ss + 0.02), th), p))
      const side = norm(cross(n, out))
      const z = o.size * (0.65 + 0.35 * (1 - ss)) * rr(rnd, 0.75, 1.2)
      const lift = (o.lift ?? 0.35) * z
      if (o.shape === 'patch') {
        // a flat irregular patch (cracked skin, veil flecks)
        const q: V3[] = []
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + rr(rnd, -0.3, 0.3)
          q.push(madd(madd(madd(p, out, Math.cos(a) * z * 0.6), side, Math.sin(a) * z * 0.45), n, lift * 0.2))
        }
        sk.line(q, { b, n, closed: true })
      } else if (o.shape === 'tuft') {
        sk.line([madd(p, side, -z * 0.2), madd(madd(p, out, z * 0.8), n, lift)], { b, n })
        sk.line([madd(p, side, z * 0.2), madd(madd(madd(p, out, z * 0.7), side, z * 0.25), n, lift)], { b, n })
      } else {
        // chevron pointing outward, its tip lifted off the skin (recurved scale)
        sk.line([madd(p, side, -z * 0.45), madd(madd(p, out, z * 0.8), n, lift), madd(p, side, z * 0.45)], { b, n })
      }
    }
  }
}

/** Fine speckle on a cap (king oyster's granite cap when cool). */
export function capSpeckle(sk: Sketch, c: Cap, rnd: Rnd, count: number, size: number, b = B.SOFT, from = 0.05, to = 0.95) {
  const k = Math.round(count * sk.detail)
  for (let i = 0; i < k; i++) {
    const s = Math.sqrt(rr(rnd, from * from, to * to))
    let th = rnd() * c.span
    if (c.span < TAU - 1e-6) th -= c.span / 2
    const p = c.top(s, th)
    const n = c.topN(s, th)
    sk.mark(madd(p, n, size * 0.15), n, size * rr(rnd, 0.6, 1.2), { b }, rnd() * TAU)
  }
}

/** Radial streaks on a cap skin (oyster fibrils, growth lines). */
export function capStreaks(sk: Sketch, c: Cap, rnd: Rnd, count: number, b = B.SOFT, from = 0.25, to = 0.95) {
  const k = Math.round(count * sk.detail)
  for (let i = 0; i < k; i++) {
    let th = rnd() * c.span
    if (c.span < TAU - 1e-6) th -= c.span / 2
    const a = rr(rnd, from, to - 0.25)
    const l = rr(rnd, 0.15, 0.4)
    const pts: V3[] = []
    for (let q = 0; q <= 4; q++) {
      const s = Math.min(to, a + (l * q) / 4)
      pts.push(madd(c.top(s, th), c.topN(s, th), 0.004))
    }
    sk.line(pts, { b, n: c.topN(a, th) })
  }
}

/** Pore mouths on the underside of a polypore cap (maitake fronds, reishi): tiny rings. */
export function pores(sk: Sketch, c: Cap, rnd: Rnd, count: number, size: number, b = B.SOFT, from = 0.2, to = 0.94) {
  const k = Math.round(count * Math.max(0.5, sk.detail))
  for (let i = 0; i < k; i++) {
    const s = Math.sqrt(rr(rnd, from * from, to * to))
    let th = rnd() * c.span
    if (c.span < TAU - 1e-6) th -= c.span / 2
    const n = mul(c.topN(s, th), -1)
    const p = madd(c.under(s, th), n, size * 0.2)
    const f = frameOf(n)
    const r = size * rr(rnd, 0.7, 1.2)
    const q: V3[] = []
    for (let a = 0; a < 5; a++) {
      const ang = (a / 5) * TAU
      q.push(add(p, add(mul(f.u, Math.cos(ang) * r), mul(f.v, Math.sin(ang) * r))))
    }
    sk.line(q, { b, n, closed: true, hid: 0.2 })
  }
}

/** Little moisture bubbles lying on a surface ("spider eyes" on a maitake top). */
export function bubbles(sk: Sketch, pts: V3[], n: V3, rads: number[], b = B.FINE) {
  const f = frameOf(n)
  pts.forEach((p, i) => {
    const r = rads[i % rads.length]
    const ring: V3[] = []
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * TAU
      ring.push(add(madd(p, n, r * 0.35), add(mul(f.u, Math.cos(ang) * r), mul(f.v, Math.sin(ang) * r))))
    }
    sk.line(ring, { b, n, closed: true, hid: 0.2 })
    // the glint: a short arc on the dome of the bubble
    const g: V3[] = []
    for (let a = 0; a <= 4; a++) {
      const ang = 2.2 + (a / 4) * 1.1
      g.push(add(madd(p, n, r * 0.62), add(mul(f.u, Math.cos(ang) * r * 0.5), mul(f.v, Math.sin(ang) * r * 0.5))))
    }
    sk.line(g, { b: b * 0.8, n, hid: 0 })
  })
}

// ---------------------------------------------------------------- partial veil

export interface VeilOpts {
  cap: Cap
  stem: Stem
  /** Height on the stem where the veil is joined (0..1). */
  ringAt: number
  /** 0 intact and tight .. 0.45 stretched .. 0.75 torn .. 1 settled. */
  state: number
  /** Where it tears: 'margin' leaves a ring on the stem, 'stem' leaves flecks on the cap edge, 'both' does both. */
  tear: 'margin' | 'stem' | 'both'
  threads?: number
  rnd: Rnd
  b?: number
  /** Fibrous (cobweb-like) rather than a skin. */
  fibrous?: boolean
}

export interface VeilOut {
  /** A point on the veil or its remnant, for a label. */
  mid: V3
  ring: V3
  margin: V3
}

export function veil(sk: Sketch, o: VeilOpts): VeilOut {
  const n = Math.max(12, Math.round((o.threads ?? 30) * Math.max(0.6, sk.detail)))
  const st = clamp(o.state)
  const b = (o.b ?? B.FINE) * (1 - 0.25 * smooth(0.75, 1, st))
  const down = mul(o.stem.axis(o.ringAt), -1)
  const threads: { top: V3; bot: V3; cut: number }[] = []
  const tearT = (i: number) => 0.45 + 0.25 * ((Math.sin(i * 2.3 + 1.1) * 0.5 + 0.5) * 0.7 + o.rnd() * 0.3)
  const upper: V3[] = []
  const lower: V3[] = []
  const midRing: V3[] = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU
    const top = o.cap.under(0.97, th)
    const bot = o.stem.at(o.ringAt, th, 0.002)
    threads.push({ top, bot, cut: tearT(i) })
  }
  let mid: V3 = threads[0].bot
  for (let i = 0; i < n; i++) {
    const { top, bot, cut } = threads[i]
    const torn = smooth(cut, cut + 0.12, st)
    const len_ = dist(top, bot)
    // intact: a slightly sagging skin from the cap edge to the stem
    const sag = madd(lerp3(top, bot, 0.5), down, len_ * 0.12)
    const at = o.tear === 'margin' ? 0.92 : o.tear === 'stem' ? 0.1 : 0.5
    const brk = qbez(bot, sag, top, at)
    // after the tear each side falls and settles
    const sr = o.stem.radius(o.ringAt)
    const drop = Math.min(len_ * (o.tear === 'margin' ? 0.55 : 0.28), sr * (o.tear === 'margin' ? 2.2 : 1.5))
    const ringDrop = madd(madd(bot, down, drop), norm(sub(bot, o.stem.centre(o.ringAt))), Math.min(len_ * 0.12, sr * 0.45))
    const flap = madd(top, down, len_ * (o.tear === 'stem' ? 0.35 : 0.18))
    const lowEnd = lerp3(brk, ringDrop, torn)
    const upEnd = lerp3(brk, flap, torn)
    const lowMid = lerp3(qbez(bot, sag, top, at * 0.5), lerp3(bot, ringDrop, 0.55), torn)
    const upMid = lerp3(qbez(bot, sag, top, (1 + at) / 2), lerp3(top, flap, 0.5), torn)
    if (o.tear !== 'stem') sk.line([bot, lowMid, lowEnd], { b, hid: 0.7 })
    else sk.line([bot, lowMid, lowEnd], { b: b * (1 - torn), hid: 0.7 })
    if (o.tear !== 'margin') sk.line([top, upMid, upEnd], { b: b * (o.fibrous ? 0.85 : 1), hid: 0.7 })
    else sk.line([top, upMid, upEnd], { b: b * (1 - torn), hid: 0.7 })
    lower.push(lowEnd)
    upper.push(upEnd)
    midRing.push(lerp3(bot, top, 0.35))
    if (i === Math.floor(n * 0.15)) mid = torn > 0.5 ? lowEnd : brk
  }
  // the edge of the skin: one ring while whole, two ragged rings once torn
  const whole = 1 - smooth(0.5, 0.72, st)
  if (whole > 0.02) sk.line(midRing.map((p, i) => lerp3(p, lower[i], 0)), { b: b * 0.8 * whole, closed: true, hid: 0.6 })
  if (o.tear !== 'stem') sk.line(lower, { b: b * (0.6 + 0.4 * smooth(0.6, 0.9, st)), closed: true, hid: 0.6 })
  if (o.tear !== 'margin') {
    const jag = upper.map((p, i) => (i % 2 ? madd(p, down, dist(threads[i].top, threads[i].bot) * 0.05 * smooth(0.6, 0.9, st)) : p))
    sk.line(jag, { b: b * 0.85, closed: true, hid: 0.6 })
  }
  // fibrous veils show a web of fine crossing threads while intact
  if (o.fibrous && whole > 0.05) {
    for (let i = 0; i < n; i += 2) {
      const a = threads[i]
      const c = threads[(i + 3) % n]
      sk.seg(lerp3(a.bot, a.top, 0.25), lerp3(c.bot, c.top, 0.75), { b: b * 0.5 * whole, hid: 0.4 })
    }
  }
  return { mid, ring: threads[Math.floor(n * 0.3)].bot, margin: threads[Math.floor(n * 0.6)].top }
}

// ---------------------------------------------------------------- small growths

/** A pin (primordium): a small rounded knob, with a hint of a cap when `capped` > 0. */
export function pin(sk: Sketch, base: V3, dir: V3, h: number, r: number, b = B.MAIN, capped = 0) {
  const f = frameOf(dir)
  const rings = 5
  const m = 9
  const rows: V3[][] = []
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    // a column that rounds over into a dome; capped knobs swell at the top
    const dome = t < 0.45 ? 1 : Math.cos(((t - 0.45) / 0.55) * (Math.PI / 2))
    const rad = r * (0.82 + 0.18 * t + capped * 0.45 * smooth(0.3, 0.7, t)) * Math.max(0.08, dome)
    const z = h * (t < 0.45 ? t / 0.45 * 0.6 : 0.6 + 0.4 * Math.sin(((t - 0.45) / 0.55) * (Math.PI / 2)))
    const row: V3[] = []
    for (let j = 0; j < m; j++) {
      const a = (j / m) * TAU
      row.push(inF(base, f, Math.cos(a) * rad, Math.sin(a) * rad, z))
    }
    rows.push(row)
  }
  surface(sk, rows, { closedU: true, rowsAt: [2, 4], colsAt: picks(m, 5, true), rowB: b * 0.7, colB: b, outward: (i, j) => sub(rows[i][j], inF(base, f, 0, 0, (h * i) / rings * 0.5)) })
  sk.fan(inF(base, f, 0, 0, h), rows[rings])
}

/** A droplet of exudate: a small teardrop outline that always faces the viewer's side. */
export function droplet(sk: Sketch, p: V3, n: V3, r: number, b = B.FINE) {
  const f = frameOf(n)
  const pts: V3[] = []
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * TAU
    const rad = r * (1 - 0.35 * Math.max(0, Math.cos(a)))
    pts.push(inF(p, f, Math.cos(a) * rad, 0, r + Math.sin(a) * rad))
  }
  sk.line(pts, { b })
  const g: V3[] = []
  for (let k = 0; k <= 10; k++) {
    const a = (k / 10) * TAU
    g.push(inF(p, f, 0, Math.cos(a) * r * 0.8, r + Math.sin(a) * r * 0.8))
  }
  sk.line(g, { b: b * 0.6 })
}

/** Cobweb fluff over a surface patch: loose arcs. */
export function fluff(sk: Sketch, centre: V3, n: V3, rad: number, rnd: Rnd, count: number, height: number, b = B.SOFT) {
  const f = frameOf(n)
  const k = Math.round(count * sk.detail)
  for (let i = 0; i < k; i++) {
    const a = rnd() * TAU
    const d = Math.sqrt(rnd()) * rad
    const a2 = a + rr(rnd, -1.2, 1.2)
    const d2 = Math.min(rad, d + rr(rnd, -rad * 0.4, rad * 0.4))
    const p0 = inF(centre, f, Math.cos(a) * d, Math.sin(a) * d, 0)
    const p1 = inF(centre, f, Math.cos(a2) * Math.abs(d2), Math.sin(a2) * Math.abs(d2), 0)
    const h = height * rr(rnd, 0.3, 1)
    const c = madd(lerp3(p0, p1, 0.5), f.w, h)
    const pts: V3[] = []
    for (let q = 0; q <= 5; q++) pts.push(qbez(p0, c, p1, q / 5))
    sk.line(pts, { b, hid: 0.3 })
  }
}

// ---------------------------------------------------------------- grow block and bag

export interface BlockOpts {
  /** Centre of the block's top face. */
  top: V3
  /** Width (x), height (y), depth (z) in cm. */
  w: number
  h: number
  d: number
  /** Brightness fades out with distance from this point (the specimen). */
  focus: V3
  fade: [number, number]
  /** Surface texture marks (sawdust, soy hull). */
  grain?: number
  rnd: Rnd
  /** Browned, bumpy skin (shiitake). */
  skin?: number
  /** Bag left as a rim at the bottom (stripped shiitake), or none. */
  occlude?: boolean
  b?: number
}

export interface Block {
  /** Point on a face: face 'front' (z+), 'top', 'side' (x+), u,v in -1..1. */
  face(face: 'front' | 'top' | 'side' | 'back' | 'left', u: number, v: number): V3
  normal(face: 'front' | 'top' | 'side' | 'back' | 'left'): V3
  fadeAt(p: V3): number
}

export function block(sk: Sketch, o: BlockOpts): Block {
  const was = sk.ctx
  sk.ctx = true
  const { w, h, d } = o
  const c: V3 = [o.top[0], o.top[1] - h / 2, o.top[2]]
  const base = o.b ?? B.CTX
  const fadeAt = (p: V3) => 1 - smooth(o.fade[0], o.fade[1], dist(p, o.focus))
  const corner = Math.min(w, d) * 0.12
  // rounded rectangle cross-section
  const ring = (y: number, inset = 0): V3[] => {
    const pts: V3[] = []
    const hw = w / 2 - corner - inset
    const hd = d / 2 - corner - inset
    const cs: [number, number, number][] = [
      [hw, hd, 0],
      [-hw, hd, Math.PI / 2],
      [-hw, -hd, Math.PI],
      [hw, -hd, (3 * Math.PI) / 2],
    ]
    for (const [cx, cz, a0] of cs)
      for (let k = 0; k <= 3; k++) {
        const a = a0 + (k / 3) * (Math.PI / 2)
        pts.push([c[0] + cx + Math.cos(a) * corner, y, c[2] + cz + Math.sin(a) * corner])
      }
    return pts
  }
  const fb = (pts: V3[], k = 1) => (i: number) => base * k * fadeAt(pts[i])
  const yTop = c[1] + h / 2
  const yBot = c[1] - h / 2
  const top = ring(yTop)
  const bot = ring(yBot)
  sk.line(top, { b: fb(top, 1.6), closed: true, hid: 0.3 })
  sk.line(bot, { b: fb(bot), closed: true, hid: 0.2 })
  // vertical edges at the corners and a few contour bands
  for (let i = 0; i < top.length; i += 4) {
    const col: V3[] = []
    for (let k = 0; k <= 8; k++) col.push(lerp3(top[i + 1] ?? top[i], bot[i + 1] ?? bot[i], k / 8))
    sk.line(col, { b: fb(col, 1.2), hid: 0.2 })
  }
  for (const f of [0.18, 0.42, 0.7]) {
    const r = ring(yTop - h * f)
    sk.line(r, { b: fb(r, 0.55), closed: true, hid: 0.15 })
  }
  if (o.occlude !== false) {
    const rows: V3[][] = []
    for (let k = 0; k <= 4; k++) rows.push(ring(yTop - (h * k) / 4))
    sk.grid(rows, true)
    sk.fan([c[0], yTop, c[2]], top)
  }
  const N: Record<string, V3> = { front: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0] }
  const face = (fc: 'front' | 'top' | 'side' | 'back' | 'left', u: number, v: number): V3 => {
    switch (fc) {
      case 'front':
        return [c[0] + (u * w) / 2, c[1] + (v * h) / 2, c[2] + d / 2]
      case 'back':
        return [c[0] - (u * w) / 2, c[1] + (v * h) / 2, c[2] - d / 2]
      case 'side':
        return [c[0] + w / 2, c[1] + (v * h) / 2, c[2] - (u * d) / 2]
      case 'left':
        return [c[0] - w / 2, c[1] + (v * h) / 2, c[2] + (u * d) / 2]
      default:
        return [c[0] + (u * w) / 2, yTop, c[2] - (v * d) / 2]
    }
  }
  // substrate texture: short flecks, brightest near the specimen
  const grain = Math.round((o.grain ?? 70) * sk.detail)
  for (let i = 0; i < grain; i++) {
    const fcs = ['front', 'top', 'side', 'left', 'back'] as const
    const fc = fcs[Math.floor(o.rnd() * fcs.length)]
    const p = face(fc, rr(o.rnd, -0.92, 0.92), rr(o.rnd, -0.92, 0.92))
    const k = fadeAt(p)
    if (k < 0.05) continue
    const n = N[fc]
    sk.mark(madd(p, n, 0.05), n, rr(o.rnd, 0.25, 0.6), { b: base * 0.9 * k, hid: 0.1 }, o.rnd() * TAU)
  }
  // browned skin with bumps and blisters (shiitake)
  if (o.skin) {
    const bumps = Math.round(o.skin * sk.detail)
    for (let i = 0; i < bumps; i++) {
      const fcs = ['front', 'top', 'side', 'left'] as const
      const fc = fcs[Math.floor(o.rnd() * fcs.length)]
      const p = face(fc, rr(o.rnd, -0.85, 0.85), rr(o.rnd, -0.85, 0.85))
      const k = fadeAt(p)
      if (k < 0.05) continue
      const n = N[fc]
      const f = frameOf(n)
      const r = rr(o.rnd, 0.5, 1.4)
      const pts: V3[] = []
      for (let q = 0; q <= 8; q++) {
        const a = (q / 8) * Math.PI
        pts.push(inF(p, f, Math.cos(a) * r, 0, Math.sin(a) * r * 0.45 + 0.05))
      }
      sk.line(pts, { b: base * 1.1 * k, n, hid: 0.15 })
    }
  }
  sk.ctx = was
  return { face, normal: (fc) => N[fc], fadeAt }
}

export interface BagOpts {
  blk: Block
  /** Same box as the block. */
  top: V3
  w: number
  h: number
  d: number
  /** Bag height above the block top (gusset headspace). 0 = trimmed at the block top. */
  head: number
  /** The bag top: gathered closed, cut off (open), a rim only (stripped block),
   * a collar, or folded flat down over the block top. */
  mode: 'closed' | 'open' | 'rim' | 'collar' | 'folded'
  /** Rim height when stripped (cm). */
  rim?: number
  /** Filter patch on the front face near the top. */
  patch?: boolean
  focus: V3
  fade: [number, number]
  rnd: Rnd
  /** Fade the whole bag (stripping it off). */
  k?: number
}

/** The plastic grow bag: wrinkled walls, gusset, filter patch. Always dashed. */
export function bag(sk: Sketch, o: BagOpts) {
  const was = sk.ctx
  sk.ctx = true
  const k0 = (o.k ?? 1) * B.CTX * 1.1
  if (k0 <= 0.002) {
    sk.ctx = was
    return
  }
  const fadeAt = (p: V3) => 1 - smooth(o.fade[0], o.fade[1], dist(p, o.focus))
  const gap = 0.35
  const hw = o.w / 2 + gap
  const hd = o.d / 2 + gap
  const yTop = o.top[1]
  const yBot = yTop - o.h
  const yEnd = o.mode === 'rim' ? yBot + (o.rim ?? 3) : o.mode === 'folded' ? yTop + 0.25 : yTop + o.head
  const cx = o.top[0]
  const cz = o.top[2]
  const fb = (pts: V3[]) => (i: number) => k0 * fadeAt(pts[i])
  // walls: wrinkled verticals
  const cols = Math.round(14 * sk.detail)
  const per = [hw * 2, hd * 2, hw * 2, hd * 2]
  const perim = per.reduce((a, b) => a + b, 0)
  const at = (t: number, y: number, wob: number): V3 => {
    let q = t * perim
    const sides: [V3, V3][] = [
      [[cx - hw, y, cz + hd], [cx + hw, y, cz + hd]],
      [[cx + hw, y, cz + hd], [cx + hw, y, cz - hd]],
      [[cx + hw, y, cz - hd], [cx - hw, y, cz - hd]],
      [[cx - hw, y, cz - hd], [cx - hw, y, cz + hd]],
    ]
    for (let s = 0; s < 4; s++) {
      if (q <= per[s] || s === 3) {
        const [a, b] = sides[s]
        const p = lerp3(a, b, clamp(q / per[s]))
        const out: V3 = s === 0 ? [0, 0, 1] : s === 1 ? [1, 0, 0] : s === 2 ? [0, 0, -1] : [-1, 0, 0]
        return madd(p, out, wob)
      }
      q -= per[s]
    }
    return [cx, y, cz]
  }
  for (let i = 0; i < cols; i++) {
    const t = (i + o.rnd() * 0.5) / cols
    const pts: V3[] = []
    for (let q = 0; q <= 8; q++) {
      const y = lerp(yBot, yEnd, q / 8)
      pts.push(at(t, y, 0.12 * Math.sin(q * 1.7 + i * 2.1)))
    }
    sk.line(pts, { b: fb(pts), dash: true, hid: 0.25 })
  }
  // rings: bottom, block top line, the top edge
  for (const y of [yBot, Math.min(yEnd, yTop), yEnd]) {
    const pts: V3[] = []
    for (let q = 0; q <= 40; q++) pts.push(at(q / 40, y, 0))
    sk.line(pts, { b: fb(pts), dash: true, hid: 0.25 })
  }
  if (o.mode === 'closed') {
    // folded gusset over the top
    const pts: V3[] = [
      [cx - hw, yEnd, cz + hd],
      [cx, yEnd + 1.2, cz + hd * 0.2],
      [cx + hw, yEnd, cz + hd],
    ]
    sk.line(pts, { b: fb(pts), dash: true })
    const pts2: V3[] = [
      [cx - hw, yEnd, cz - hd],
      [cx, yEnd + 1.2, cz - hd * 0.2],
      [cx + hw, yEnd, cz - hd],
    ]
    sk.line(pts2, { b: fb(pts2), dash: true })
  }
  if (o.mode === 'folded') {
    // the sheet folded flat over the top: corner creases and the seam
    const y = yEnd
    const creases: [V3, V3][] = [
      [[cx - hw, y, cz + hd], [cx - hw * 0.5, y, cz]],
      [[cx - hw, y, cz - hd], [cx - hw * 0.5, y, cz]],
      [[cx + hw, y, cz + hd], [cx + hw * 0.5, y, cz]],
      [[cx + hw, y, cz - hd], [cx + hw * 0.5, y, cz]],
      [[cx - hw * 0.5, y, cz], [cx + hw * 0.5, y, cz]],
    ]
    for (const [a, b] of creases) sk.line([a, b], { b: fb([a, b]), dash: true, hid: 0.2 })
  }
  if (o.patch && o.mode !== 'rim' && o.mode !== 'folded') {
    const py = Math.min(yEnd - 2.5, yTop + o.head * 0.5)
    const pw = Math.min(5, hw)
    const ph = 2.4
    const pts: V3[] = [
      [cx - pw / 2, py - ph / 2, cz + hd + 0.05],
      [cx + pw / 2, py - ph / 2, cz + hd + 0.05],
      [cx + pw / 2, py + ph / 2, cz + hd + 0.05],
      [cx - pw / 2, py + ph / 2, cz + hd + 0.05],
    ]
    sk.line(pts, { b: fb(pts), closed: true, hid: 0.2 })
    sk.seg(lerp3(pts[0], pts[3], 0.5), lerp3(pts[1], pts[2], 0.5), { b: (i) => k0 * 0.6 * fadeAt(i ? pts[1] : pts[0]) })
    // for a label: the middle of the patch
    sk.anchor('patch', [cx + pw * 0.22, py, cz + hd + 0.05], [0, 0, 1])
  }
  sk.ctx = was
}

/** A cut in a bag or block face: an X, a slit or an H, opened by `open` (0..1). */
export function faceCut(sk: Sketch, centre: V3, n: V3, up: V3, size: number, kind: 'x' | 'slit' | 'h', open: number, b = B.CTX * 1.6) {
  const f = frameOf(n, up)
  // f.u ~ up direction in the face plane, f.v sideways
  const was = sk.ctx
  sk.ctx = true
  const P = (x: number, y: number, z = 0): V3 => add(centre, add(mul(f.v, x), add(mul(f.u, y), mul(f.w, z))))
  if (kind === 'slit') {
    const o2 = open * size * 0.18
    sk.line([P(-size / 2, 0), P(0, o2, o2 * 0.6), P(size / 2, 0)], { b })
    sk.line([P(-size / 2, 0), P(0, -o2, o2 * 0.6), P(size / 2, 0)], { b })
  } else if (kind === 'x') {
    const s = (size / 2) * 0.7
    const lift = open * s * 0.18
    // four flaps between the arms of the X; their tips (at the centre) lift and fold back
    const flaps: [number, number][] = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]
    for (const [a, c] of flaps) {
      const e1 = P((a - c) * s, (c + a) * s)
      const e2 = P((a + c) * s, (c - a) * s)
      const tip = P(a * s * 0.72 * open, c * s * 0.72 * open, lift)
      sk.line([e1, tip, e2], { b })
    }
  } else {
    sk.line([P(-size / 2, -size / 3), P(-size / 2, size / 3)], { b })
    sk.line([P(size / 2, -size / 3), P(size / 2, size / 3)], { b })
    sk.line([P(-size / 2, 0), P(size / 2, 0)], { b })
  }
  sk.ctx = was
}

/** Points scattered in a disc on a surface (for pin carpets and droplets). */
export function scatter(rnd: Rnd, n: number, rad: number, centre: V3, f: Frame): V3[] {
  const out: V3[] = []
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU
    const d = Math.sqrt(rnd()) * rad
    out.push(inF(centre, f, Math.cos(a) * d, Math.sin(a) * d, 0))
  }
  return out
}

/** Map stage progress t to a value moving through key points: keys = [[t, value], ...]. */
export function keys(t: number, ks: [number, number][]): number {
  if (t <= ks[0][0]) return ks[0][1]
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i][0]) {
      const [t0, v0] = ks[i - 1]
      const [t1, v1] = ks[i]
      return lerp(v0, v1, smooth(t0, t1, t))
    }
  }
  return ks[ks.length - 1][1]
}

export const dirTo = (a: V3, b: V3) => norm(sub(b, a))
export { type Ln }
