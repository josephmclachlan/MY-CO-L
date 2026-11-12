// Small vector and curve helpers for the specimen models. Plain arrays, no Three.js,
// so the geometry can be built and tested in Node.

export type V3 = [number, number, number]

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
/** a + b * k */
export const madd = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const norm = (a: V3): V3 => {
  const l = len(a)
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]
}
export const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const dist = (a: V3, b: V3) => len(sub(a, b))

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Hermite smoothstep from e0 to e1. */
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
/** Progress 0..1 of x across [a, b], eased. */
export const span = (x: number, a: number, b: number) => smooth(a, b, x)
/** Progress 0..1 of x across [a, b], linear. */
export const lin = (x: number, a: number, b: number) => clamp((x - a) / (b - a))
export const TAU = Math.PI * 2
export const UP: V3 = [0, 1, 0]

/** Seeded random numbers (mulberry32): the same seed always draws the same specimen. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export type Rnd = () => number
/** Uniform in [a, b]. */
export const rr = (rnd: Rnd, a: number, b: number) => a + (b - a) * rnd()

/** Rotate v about a unit axis by ang (Rodrigues). */
export function rot(v: V3, axis: V3, ang: number): V3 {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const d = dot(axis, v) * (1 - c)
  const x = cross(axis, v)
  return [v[0] * c + x[0] * s + axis[0] * d, v[1] * c + x[1] * s + axis[1] * d, v[2] * c + x[2] * s + axis[2] * d]
}

export interface Frame {
  u: V3
  v: V3
  w: V3
}
/** An orthonormal frame whose w is the given axis; u is as close to `hint` as it can be. */
export function frameOf(w: V3, hint: V3 = [1, 0, 0]): Frame {
  const W = norm(w)
  let h = sub(hint, mul(W, dot(hint, W)))
  if (len(h) < 1e-6) h = sub([0, 0, 1], mul(W, W[2]))
  if (len(h) < 1e-6) h = sub([1, 0, 0], mul(W, W[0]))
  const U = norm(h)
  return { u: U, v: cross(W, U), w: W }
}
/** Point in a frame: origin + u*x + v*y + w*z. */
export const inF = (o: V3, f: Frame, x: number, y: number, z: number): V3 => [
  o[0] + f.u[0] * x + f.v[0] * y + f.w[0] * z,
  o[1] + f.u[1] * x + f.v[1] * y + f.w[1] * z,
  o[2] + f.u[2] * x + f.v[2] * y + f.w[2] * z,
]
export const dirF = (f: Frame, x: number, y: number, z: number): V3 => inF([0, 0, 0], f, x, y, z)

/** Uniform Catmull-Rom spline through the points, n samples from the first to the last point. */
export function spline(pts: V3[], n: number): V3[] {
  if (pts.length < 2) return pts.slice()
  const out: V3[] = []
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  const segs = pts.length - 1
  for (let k = 0; k < n; k++) {
    const g = (k / (n - 1)) * segs
    const i = Math.min(segs - 1, Math.floor(g))
    const t = g - i
    const p0 = P(i - 1)
    const p1 = P(i)
    const p2 = P(i + 1)
    const p3 = P(i + 2)
    const t2 = t * t
    const t3 = t2 * t
    const c = (j: number) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
    out.push([c(0), c(1), c(2)])
  }
  return out
}

/** Quadratic Bezier point. */
export const qbez = (a: V3, c: V3, b: V3, t: number): V3 => {
  const s = 1 - t
  return [s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1], s * s * a[2] + 2 * s * t * c[2] + t * t * b[2]]
}

/** Tangent frames along a polyline by parallel transport (no twisting). */
export function transport(path: V3[], up: V3 = [0, 0, 1]): Frame[] {
  const n = path.length
  const T: V3[] = path.map((_, i) => norm(sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)])))
  const out: Frame[] = []
  let f = frameOf(T[0], up)
  out.push({ u: f.u, v: f.v, w: T[0] })
  for (let i = 1; i < n; i++) {
    const a = T[i - 1]
    const b = T[i]
    const ax = cross(a, b)
    const s = len(ax)
    let u = out[i - 1].u
    if (s > 1e-9) u = rot(u, mul(ax, 1 / s), Math.atan2(s, dot(a, b)))
    u = norm(sub(u, mul(b, dot(u, b))))
    f = { u, v: cross(b, u), w: b }
    out.push(f)
  }
  return out
}

/** A smooth random periodic wobble around a circle: sum of a few harmonics with random phases. */
export function wobble(rnd: Rnd, kMin: number, kMax: number, amp: number) {
  const K: number[] = []
  const P: number[] = []
  const A: number[] = []
  for (let k = kMin; k <= kMax; k++) {
    K.push(k)
    P.push(rnd() * TAU)
    A.push((rnd() * 0.7 + 0.3) / Math.sqrt(k))
  }
  const tot = A.reduce((s, a) => s + a, 0) || 1
  const n = K.length
  const scale = amp / tot
  return (th: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += A[i] * Math.sin(K[i] * th + P[i])
    return s * scale
  }
}

/** Smooth random 1D noise on [0, 1] (a few sines), for wandering stems and branches. */
export function wander(rnd: Rnd, amp: number) {
  const a = [rnd() * TAU, rnd() * TAU, rnd() * TAU]
  const f = [1 + rnd() * 1.5, 2.5 + rnd() * 2, 5 + rnd() * 3]
  return (t: number) => amp * (0.6 * Math.sin(f[0] * t * Math.PI + a[0]) + 0.3 * Math.sin(f[1] * t * Math.PI + a[1]) + 0.1 * Math.sin(f[2] * t * Math.PI + a[2]))
}

/** Golden angle, for spiral layouts that never line up. */
export const GOLD = Math.PI * (3 - Math.sqrt(5))
