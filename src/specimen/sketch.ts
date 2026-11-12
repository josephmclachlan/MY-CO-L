// The line builder every specimen model draws into.
//
// A model is drawn as glowing vector lines (what you see) plus an invisible
// "occluder" skin (what hides the lines behind it). Each line vertex carries:
//   position, surface normal (for the bright rim where a surface turns away),
//   info = [brightness, distance along the line (for dashes), hidden-pass weight
//   (negative = always dashed, e.g. bag plastic), part id (for the label highlight)].
// The builder only grows its arrays, so rebuilding a model every frame of an
// animation makes no garbage.
import { type V3, cross, dot, frameOf, len, norm, sub } from './math'

class F32 {
  a: Float32Array
  n = 0
  constructor(cap = 4096) {
    this.a = new Float32Array(cap)
  }
  need(k: number) {
    if (this.n + k <= this.a.length) return
    const b = new Float32Array(Math.max(this.a.length * 2, this.n + k))
    b.set(this.a.subarray(0, this.n))
    this.a = b
  }
}
class U32 {
  a: Uint32Array
  n = 0
  constructor(cap = 4096) {
    this.a = new Uint32Array(cap)
  }
  need(k: number) {
    if (this.n + k <= this.a.length) return
    const b = new Uint32Array(Math.max(this.a.length * 2, this.n + k))
    b.set(this.a.subarray(0, this.n))
    this.a = b
  }
}

/** Line brightness levels: the hierarchy that keeps a dense drawing readable. */
export const B = {
  EDGE: 1, // rims, outlines, the edge you read the shape by
  MAIN: 0.62, // main contour lines over a surface
  FINE: 0.4, // gills, scales, spines, fibres
  SOFT: 0.28, // texture
  CTX: 0.2, // block, bag and other context
}

export interface Ln {
  /** Brightness (0..1, see B), or a function of the point index. */
  b?: number | ((i: number, n: number) => number)
  /** Always dashed (plastic, context). */
  dash?: boolean
  /** Weight in the hidden-line pass (0 = never shown when hidden). Default 1. */
  hid?: number
  /** Surface normal: one for the whole line or one per point. Omitted = no rim effect. */
  n?: V3 | V3[]
  closed?: boolean
}

export interface Anchor {
  p: V3
  n?: V3
}

/** A finished drawing, copied out of a Sketch so it can move between threads. */
export interface Built {
  t: number
  detail: number
  /** Line vertices: position, normal, info (see the top of this file). */
  lp: Float32Array
  ln: Float32Array
  li: Float32Array
  /** Occluder skin: positions and triangle indices. */
  op: Float32Array
  oi: Uint32Array
  anchors: Record<string, Anchor>
  /** Part name to id, for the label highlight. */
  parts: [string, number][]
  /** Bounds of the specimen (context left out). */
  lo: V3
  hi: V3
  /** Furthest the specimen reaches from its turning axis (context left out). */
  rad: number
}

export class Sketch {
  readonly lp = new F32(1 << 14)
  readonly ln = new F32(1 << 14)
  readonly li = new F32(1 << 15)
  readonly op = new F32(1 << 13)
  readonly oi = new U32(1 << 14)
  readonly anchors: Record<string, Anchor> = {}
  private parts = new Map<string, number>()
  private part = 0
  /** Brightness multiplier for everything drawn while it is set. */
  gain = 1
  /** Context drawing (block, bag): left out of the framing box. */
  ctx = false
  /** Level of detail: 1 = full, lower on small or slow screens. */
  detail = 1
  readonly lo: V3 = [Infinity, Infinity, Infinity]
  readonly hi: V3 = [-Infinity, -Infinity, -Infinity]
  /** The vertical axis the specimen turns about (x, z), for `rad`. */
  axis: [number, number] = [0, 0]
  private rad2 = 0

  reset() {
    this.lp.n = this.ln.n = this.li.n = this.op.n = this.oi.n = 0
    for (const k of Object.keys(this.anchors)) delete this.anchors[k]
    this.parts.clear()
    this.part = 0
    this.gain = 1
    this.ctx = false
    this.lo[0] = this.lo[1] = this.lo[2] = Infinity
    this.hi[0] = this.hi[1] = this.hi[2] = -Infinity
    this.rad2 = 0
  }

  /** Lines drawn inside fn belong to the named part (a label can light it up). */
  inPart(name: string, fn: () => void) {
    let id = this.parts.get(name)
    if (id === undefined) {
      id = this.parts.size + 1
      this.parts.set(name, id)
    }
    const was = this.part
    this.part = id
    fn()
    this.part = was
  }
  partId(name: string): number {
    return this.parts.get(name) ?? -1
  }

  /** Number of line vertices (2 per segment). */
  get lineVerts() {
    return this.lp.n / 3
  }
  get occVerts() {
    return this.op.n / 3
  }
  get occIdx() {
    return this.oi.n
  }

  private vert(p: V3, n: V3 | null, b: number, d: number, hid: number) {
    const { lp, ln, li } = this
    lp.need(3)
    ln.need(3)
    li.need(4)
    const i = lp.n
    lp.a[i] = p[0]
    lp.a[i + 1] = p[1]
    lp.a[i + 2] = p[2]
    lp.n = i + 3
    const j = ln.n
    ln.a[j] = n ? n[0] : 0
    ln.a[j + 1] = n ? n[1] : 0
    ln.a[j + 2] = n ? n[2] : 0
    ln.n = j + 3
    const k = li.n
    li.a[k] = b
    li.a[k + 1] = d
    li.a[k + 2] = hid
    li.a[k + 3] = this.part
    li.n = k + 4
    if (!this.ctx) {
      for (let c = 0; c < 3; c++) {
        if (p[c] < this.lo[c]) this.lo[c] = p[c]
        if (p[c] > this.hi[c]) this.hi[c] = p[c]
      }
      const dx = p[0] - this.axis[0]
      const dz = p[2] - this.axis[1]
      const q = dx * dx + dz * dz
      if (q > this.rad2) this.rad2 = q
    }
  }

  /** A polyline. */
  line(pts: V3[], o: Ln = {}) {
    const n = pts.length
    if (n < 2) return
    const hid = (o.hid ?? (this.ctx ? 0.35 : 1)) * (o.dash ? -1 : 1)
    const bf = o.b ?? B.MAIN
    const nn = o.n
    const nAt = (i: number): V3 | null => (!nn ? null : Array.isArray(nn[0]) ? (nn as V3[])[i % n] : (nn as V3))
    const bAt = (i: number) => (typeof bf === 'function' ? bf(i, n) : bf) * this.gain
    let d = 0
    const last = o.closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      this.vert(a, nAt(i), bAt(i), d, hid)
      d += l
      this.vert(b, nAt((i + 1) % n), bAt((i + 1) % n), d, hid)
    }
  }
  seg(a: V3, b: V3, o: Ln = {}) {
    this.line([a, b], o)
  }

  /** A small mark on a surface: a cross lying in the surface plane. */
  mark(p: V3, n: V3, size: number, o: Ln = {}, ang = 0) {
    const f = frameOf(n, [Math.cos(ang), 0, Math.sin(ang)])
    const s = size / 2
    this.seg([p[0] - f.u[0] * s, p[1] - f.u[1] * s, p[2] - f.u[2] * s], [p[0] + f.u[0] * s, p[1] + f.u[1] * s, p[2] + f.u[2] * s], { ...o, n })
    this.seg([p[0] - f.v[0] * s, p[1] - f.v[1] * s, p[2] - f.v[2] * s], [p[0] + f.v[0] * s, p[1] + f.v[1] * s, p[2] + f.v[2] * s], { ...o, n })
  }

  /**
   * Occluder skin from a grid of points: rows[i][j]. Consecutive rows are joined
   * into quads; closedU joins the last column back to the first.
   */
  grid(rows: V3[][], closedU = false) {
    const R = rows.length
    if (R < 2) return
    const C = rows[0].length
    const { op, oi } = this
    const base = op.n / 3
    op.need(R * C * 3)
    for (const row of rows)
      for (const p of row) {
        op.a[op.n++] = p[0]
        op.a[op.n++] = p[1]
        op.a[op.n++] = p[2]
      }
    const cols = closedU ? C : C - 1
    oi.need((R - 1) * cols * 6)
    for (let i = 0; i < R - 1; i++)
      for (let j = 0; j < cols; j++) {
        const a = base + i * C + j
        const b = base + i * C + ((j + 1) % C)
        const c = base + (i + 1) * C + ((j + 1) % C)
        const d = base + (i + 1) * C + j
        oi.a[oi.n++] = a
        oi.a[oi.n++] = b
        oi.a[oi.n++] = c
        oi.a[oi.n++] = a
        oi.a[oi.n++] = c
        oi.a[oi.n++] = d
      }
  }

  /** Occluder triangle fan (caps the end of a tube). */
  fan(centre: V3, ring: V3[]) {
    const { op, oi } = this
    const base = op.n / 3
    op.need((ring.length + 1) * 3)
    op.a[op.n++] = centre[0]
    op.a[op.n++] = centre[1]
    op.a[op.n++] = centre[2]
    for (const p of ring) {
      op.a[op.n++] = p[0]
      op.a[op.n++] = p[1]
      op.a[op.n++] = p[2]
    }
    oi.need(ring.length * 3)
    for (let j = 0; j < ring.length; j++) {
      oi.a[oi.n++] = base
      oi.a[oi.n++] = base + 1 + j
      oi.a[oi.n++] = base + 1 + ((j + 1) % ring.length)
    }
  }

  anchor(id: string, p: V3, n?: V3) {
    this.anchors[id] = { p, n }
  }

  /** Copy the drawing out (for the GPU or another thread). */
  export(t: number): Built {
    return {
      t,
      detail: this.detail,
      lp: this.lp.a.slice(0, this.lp.n),
      ln: this.ln.a.slice(0, this.ln.n),
      li: this.li.a.slice(0, this.li.n),
      op: this.op.a.slice(0, this.op.n),
      oi: this.oi.a.slice(0, this.oi.n),
      anchors: Object.fromEntries(Object.entries(this.anchors).map(([k, a]) => [k, { p: [a.p[0], a.p[1], a.p[2]] as V3, n: a.n ? ([a.n[0], a.n[1], a.n[2]] as V3) : undefined }])),
      parts: [...this.parts.entries()],
      lo: [this.lo[0], this.lo[1], this.lo[2]],
      hi: [this.hi[0], this.hi[1], this.hi[2]],
      rad: Math.sqrt(this.rad2),
    }
  }
}

/** Normal of a grid surface at (i, j) from its neighbours, flipped to face `out` if given. */
export function gridNormal(rows: V3[][], i: number, j: number, closedU: boolean, out?: V3): V3 {
  const R = rows.length
  const C = rows[0].length
  const jm = closedU ? (j - 1 + C) % C : Math.max(0, j - 1)
  const jp = closedU ? (j + 1) % C : Math.min(C - 1, j + 1)
  const im = Math.max(0, i - 1)
  const ip = Math.min(R - 1, i + 1)
  const du = sub(rows[i][jp], rows[i][jm])
  const dv = sub(rows[ip][j], rows[im][j])
  let n = cross(du, dv)
  if (len(n) < 1e-12) n = out ?? [0, 1, 0]
  n = norm(n)
  if (out && dot(n, out) < 0) n = [-n[0], -n[1], -n[2]]
  return n
}

/**
 * Draw selected grid lines of a surface (rows = one direction, columns = the other)
 * and add the surface as an occluder. rowsAt / colsAt list which row and column
 * indices to draw. outward(i, j) gives a rough outward direction to orient normals.
 */
export function surface(
  sk: Sketch,
  rows: V3[][],
  o: {
    closedU?: boolean
    rowsAt?: number[]
    colsAt?: number[]
    rowB?: number | ((i: number) => number)
    colB?: number | ((j: number) => number)
    outward?: (i: number, j: number) => V3
    occlude?: boolean
    hid?: number
    dash?: boolean
  },
) {
  const closed = !!o.closedU
  const R = rows.length
  const C = rows[0].length
  const N: V3[][] = rows.map((row, i) => row.map((_, j) => gridNormal(rows, i, j, closed, o.outward?.(i, j))))
  for (const i of o.rowsAt ?? []) {
    if (i < 0 || i >= R) continue
    const b = typeof o.rowB === 'function' ? o.rowB(i) : o.rowB ?? B.MAIN
    sk.line(rows[i], { b, n: N[i], closed, hid: o.hid, dash: o.dash })
  }
  for (const j of o.colsAt ?? []) {
    if (j < 0 || j >= C) continue
    const b = typeof o.colB === 'function' ? o.colB(j) : o.colB ?? B.MAIN
    sk.line(
      rows.map((r) => r[j]),
      { b, n: N.map((r) => r[j]), hid: o.hid, dash: o.dash },
    )
  }
  if (o.occlude !== false) sk.grid(rows, closed)
  return N
}

/** Evenly spread indices: k of them across 0..n-1 (both ends included when closed is false). */
export function picks(n: number, k: number, closed = false): number[] {
  if (k <= 0) return []
  const out: number[] = []
  if (closed) for (let i = 0; i < k; i++) out.push(Math.round((i * n) / k) % n)
  else if (k === 1) out.push(n - 1)
  else for (let i = 0; i < k; i++) out.push(Math.round((i * (n - 1)) / (k - 1)))
  return [...new Set(out)]
}
