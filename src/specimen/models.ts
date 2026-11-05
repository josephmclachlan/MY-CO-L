// Procedural line-only models, one generator per growth form. Original
// geometry: fans, domes, tubes and branches built from maths, no scans and
// no film or game assets. Each returns flat segment pairs (x,y,z,x,y,z).
import type { Form } from '../data/species/types'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type V = [number, number, number]

class Lines {
  p: number[] = []
  seg(a: V, b: V) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2])
  }
  poly(pts: V[], close = false) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1])
    if (close && pts.length > 2) this.seg(pts[pts.length - 1], pts[0])
  }
}

/** Fan-shaped cap (oyster shelf, maitake frond, reishi kidney). */
function fan(L: Lines, base: V, phi: number, R: number, span: number, o: { tilt?: number; droop?: number; ruffle?: number; ribs?: number; rings?: number[] } = {}) {
  const { tilt = 0.1, droop = 0.4, ruffle = 0.05, ribs = 7, rings = [0.45, 0.75] } = o
  const pt = (u: number, th: number): V => {
    const a = u * R * Math.cos(th)
    const b = u * R * Math.sin(th)
    const h = tilt * u - droop * u * u * (1 - 0.3 * Math.abs(th)) + (u > 0.9 ? ruffle * Math.sin(th * 9) : 0)
    return [base[0] + a * Math.cos(phi) - b * Math.sin(phi), base[1] + h * R, base[2] + a * Math.sin(phi) + b * Math.cos(phi)]
  }
  const N = 22
  const rim: V[] = []
  for (let i = 0; i <= N; i++) rim.push(pt(1, -span + (2 * span * i) / N))
  L.poly(rim)
  L.seg(pt(0.05, -span), rim[0])
  L.seg(pt(0.05, span), rim[N])
  for (const u of rings) {
    const arc: V[] = []
    for (let i = 0; i <= 14; i++) arc.push(pt(u, -span + (2 * span * i) / 14))
    L.poly(arc)
  }
  for (let r = 0; r < ribs; r++) {
    const th = -span + (2 * span * r) / (ribs - 1)
    L.seg(pt(0.1, th), pt(1, th))
  }
}

function shelf(L: Lines, rnd: () => number) {
  L.poly([[-0.1, -0.9, 0], [-0.08, 0.5, 0.02]])
  L.poly([[0.1, -0.9, 0], [0.08, 0.5, 0.02]])
  const n = 6
  for (let i = 0; i < n; i++) {
    const y = -0.7 + (1.2 * i) / (n - 1)
    const phi = i * 2.399 + rnd() * 0.4
    fan(L, [Math.cos(phi) * 0.09, y, Math.sin(phi) * 0.09], phi, 0.55 + rnd() * 0.3 - i * 0.03, 0.95 + rnd() * 0.2, { tilt: 0.12, droop: 0.45, ruffle: 0.07 })
  }
}

function pom(L: Lines, rnd: () => number) {
  const R = 0.8
  for (let k = 1; k <= 3; k++) {
    const y = (R * k) / 4
    const r = Math.sqrt(R * R - y * y)
    const ring: V[] = []
    for (let i = 0; i <= 36; i++) ring.push([r * Math.cos((i / 36) * 6.283), y + 0.1, r * Math.sin((i / 36) * 6.283)])
    L.poly(ring)
  }
  for (let m = 0; m < 8; m++) {
    const a = (m / 8) * 6.283
    const arc: V[] = []
    for (let i = 0; i <= 8; i++) {
      const el = (i / 8) * 1.5
      arc.push([R * Math.cos(el) * Math.cos(a), R * Math.sin(el) + 0.1, R * Math.cos(el) * Math.sin(a)])
    }
    L.poly(arc)
  }
  // hanging teeth over the lower sphere
  for (let i = 0; i < 160; i++) {
    const a = rnd() * 6.283
    const el = -rnd() * 1.2
    const sx = R * Math.cos(el) * Math.cos(a)
    const sy = R * Math.sin(el) + 0.1
    const sz = R * Math.cos(el) * Math.sin(a)
    const len = 0.22 + rnd() * 0.25
    L.seg([sx, sy, sz], [sx * 1.04, sy - len, sz * 1.04])
  }
  L.poly([[0, 0.9, 0], [0, 1.15, 0]])
}

function coral(L: Lines, rnd: () => number) {
  const branch = (p: V, dir: V, len: number, depth: number) => {
    const e: V = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len]
    L.seg(p, e)
    if (depth === 0) {
      for (let t = 0; t < 3; t++) L.seg(e, [e[0] + (rnd() - 0.5) * 0.06, e[1] - 0.12, e[2] + (rnd() - 0.5) * 0.06])
      return
    }
    const kids = depth > 2 ? 3 : 2
    for (let k = 0; k < kids; k++) {
      const yaw = (k / kids) * 6.283 + rnd() * 0.8
      const sp = 0.5 + rnd() * 0.35
      let d: V = [dir[0] + Math.cos(yaw) * sp, dir[1] * 0.8, dir[2] + Math.sin(yaw) * sp]
      const m = Math.hypot(...d)
      d = [d[0] / m, d[1] / m, d[2] / m]
      branch(e, d, len * 0.68, depth - 1)
    }
  }
  branch([0, -0.9, 0], [0, 1, 0], 0.55, 4)
}

function dome(L: Lines, c: V, R: number, flat: number, withGills: boolean) {
  const rings = 4
  for (let k = 0; k < rings; k++) {
    const el = ((k + 1) / (rings + 0.2)) * 1.5
    const r = R * Math.cos(el)
    const y = c[1] + R * flat * Math.sin(el)
    const ring: V[] = []
    for (let i = 0; i <= 28; i++) ring.push([c[0] + r * Math.cos((i / 28) * 6.283), y, c[2] + r * Math.sin((i / 28) * 6.283)])
    L.poly(ring)
  }
  for (let m = 0; m < 10; m++) {
    const a = (m / 10) * 6.283
    const arc: V[] = []
    for (let i = 0; i <= 6; i++) {
      const el = (i / 6) * 1.5
      arc.push([c[0] + R * Math.cos(el) * Math.cos(a), c[1] + R * flat * Math.sin(el), c[2] + R * Math.cos(el) * Math.sin(a)])
    }
    L.poly(arc)
  }
  if (withGills)
    for (let m = 0; m < 16; m++) {
      const a = (m / 16) * 6.283
      L.seg([c[0] + 0.05 * Math.cos(a), c[1] - 0.02, c[2] + 0.05 * Math.sin(a)], [c[0] + R * Math.cos(a), c[1] - 0.02, c[2] + R * Math.sin(a)])
    }
}

function stem(L: Lines, x: number, z: number, y0: number, y1: number, r0: number, r1: number, lean: number) {
  for (const t of [0, 0.5, 1]) {
    const y = y0 + (y1 - y0) * t
    const r = r0 + (r1 - r0) * t
    const cx = x + lean * t
    const ring: V[] = []
    for (let i = 0; i <= 12; i++) ring.push([cx + r * Math.cos((i / 12) * 6.283), y, z + r * Math.sin((i / 12) * 6.283)])
    L.poly(ring)
  }
  for (let m = 0; m < 6; m++) {
    const a = (m / 6) * 6.283
    L.seg([x + r0 * Math.cos(a), y0, z + r0 * Math.sin(a)], [x + lean + r1 * Math.cos(a), y1, z + r1 * Math.sin(a)])
  }
}

interface CapParams { n: number; capR: number; stemH: number; stemR: number; flat: number; spread: number }
const CAP: Record<string, CapParams> = {
  'king-oyster': { n: 1, capR: 0.55, stemH: 1.2, stemR: 0.24, flat: 0.5, spread: 0 },
  shiitake: { n: 3, capR: 0.7, stemH: 0.5, stemR: 0.08, flat: 0.6, spread: 0.55 },
  chestnut: { n: 5, capR: 0.5, stemH: 0.75, stemR: 0.09, flat: 0.7, spread: 0.6 },
  'black-pearl': { n: 5, capR: 0.34, stemH: 1.0, stemR: 0.16, flat: 0.5, spread: 0.4 },
  pioppino: { n: 9, capR: 0.26, stemH: 1.1, stemR: 0.05, flat: 0.55, spread: 0.7 },
}

function capstem(L: Lines, rnd: () => number, id: string) {
  const P = CAP[id] ?? CAP.shiitake
  for (let i = 0; i < P.n; i++) {
    const a = i * 2.399
    const d = P.n === 1 ? 0 : P.spread * (0.3 + 0.7 * ((i + 1) / P.n))
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    const h = P.stemH * (0.7 + rnd() * 0.5)
    const lean = (rnd() - 0.5) * 0.25
    const s = 0.75 + rnd() * 0.4
    stem(L, x, z, -0.9, -0.9 + h, P.stemR * 1.2, P.stemR, lean)
    dome(L, [x + lean, -0.9 + h, z], P.capR * s, P.flat, true)
  }
}

function rosette(L: Lines, rnd: () => number) {
  const n = 22
  for (let i = 0; i < n; i++) {
    const t = i / n
    const phi = i * 2.399
    const dist = 0.08 + t * 0.45
    fan(L, [Math.cos(phi) * dist * 0.4, -0.7 + t * 1.1, Math.sin(phi) * dist * 0.4], phi, 0.38 + rnd() * 0.18 + (1 - t) * 0.25, 0.55, { tilt: 0.5, droop: 0.9, ruffle: 0.12, ribs: 4, rings: [0.6] })
  }
  stem(L, 0, 0, -0.95, -0.6, 0.18, 0.1, 0)
}

function bracket(L: Lines) {
  // curved stalk then a kidney-shaped cap with growth zones
  const stalk: V[] = []
  for (let i = 0; i <= 8; i++) stalk.push([-0.5 + 0.1 * i * 0.6, -0.9 + i * 0.14, 0])
  L.poly(stalk)
  const stalk2: V[] = stalk.map(([x, y, z]) => [x + 0.14, y, z + 0.06])
  L.poly(stalk2)
  for (let i = 0; i < stalk.length; i += 2) L.seg(stalk[i], stalk2[i])
  fan(L, [-0.3, 0.2, 0], 0, 1.35, 1.7, { tilt: 0.02, droop: 0.15, ruffle: 0.03, ribs: 9, rings: [0.25, 0.45, 0.65, 0.82] })
}

function club(L: Lines, rnd: () => number) {
  for (let i = 0; i < 14; i++) {
    const a = rnd() * 6.283
    const d = rnd() * 0.45
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    const h = 0.7 + rnd() * 0.9
    const lean = (rnd() - 0.5) * 0.3
    stem(L, x, z, -0.9, -0.9 + h, 0.035, 0.03, lean)
    // swollen tip
    for (const t of [0.0, 0.5, 1.0]) {
      const y = -0.9 + h + t * 0.28
      const r = 0.075 * Math.sin(Math.PI * (0.15 + t * 0.7))
      const ring: V[] = []
      for (let k = 0; k <= 10; k++) ring.push([x + lean + r * Math.cos((k / 10) * 6.283), y, z + r * Math.sin((k / 10) * 6.283)])
      L.poly(ring)
    }
    L.seg([x + lean, -0.9 + h, z], [x + lean, -0.9 + h + 0.3, z])
  }
}

export function buildModel(form: Form, seed: number, id: string): Float32Array {
  const rnd = rng(seed)
  const L = new Lines()
  switch (form) {
    case 'shelf': shelf(L, rnd); break
    case 'pom': pom(L, rnd); break
    case 'coral': coral(L, rnd); break
    case 'capstem':
    case 'cluster': capstem(L, rnd, id); break
    case 'rosette': rosette(L, rnd); break
    case 'bracket': bracket(L); break
    case 'club': club(L, rnd); break
  }
  // centre and scale so every model fills the same frame
  const p = L.p
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], p[i])
    hi[i % 3] = Math.max(hi[i % 3], p[i])
  }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
  const k = 1.7 / ext
  const out = new Float32Array(p.length)
  for (let i = 0; i < p.length; i++) out[i] = (p[i] - (lo[i % 3] + hi[i % 3]) / 2) * k
  return out
}
