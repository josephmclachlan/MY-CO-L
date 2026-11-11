// MAITAKE (Grifola frondosa, hen of the woods): weeks of undisturbed incubation
// in a closed bag. "Spider eyes" (moisture bubbles) come up on a pillowy top,
// primordia build across it, and they rise toward the patch as a lumpy "fist".
// When the fist splits into "fingers" the bag top is cut off (not down to the
// block) and the sides slit; the tops darken and spoon-shaped fronds form fast on
// a branching white base. Fronds have pores underneath, not gills.
import { bag, block, bubbles, cap, capStreaks, keys, pores, stem } from '../parts'
import { B, type Sketch, surface, picks } from '../sketch'
import { type V3, TAU, add, clamp, cross, lerp, lerp3, madd, mul, norm, rng, rr, smooth, sub, wobble } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 151

interface Frond {
  /** Which branch it sits on. */
  br: number
  a: number
  /** Tier height 0 (outer, low) .. 1 (inner, top). */
  h: number
  /** Final stalk end (where the frond joins its stalk). */
  A: V3
  /** Where its finger comes out of the fist (direction from the fist centre). */
  u: V3
  R: number
  lean: number
  delay: number
  grow: number
  seed: number
  roll: number
}

export const maitake: SpecimenModel = {
  id: 'maitake',
  seed: SEED,
  stages: [
    { id: 'eyes', at: 0, elev: 0.55 },
    { id: 'primordia', at: 0.14, elev: 0.5 },
    { id: 'fist', at: 0.28, hold: 0.8, elev: 0.4 },
    { id: 'cut', at: 0.42, hold: 1, elev: 0.4 },
    { id: 'fronds', at: 0.54 },
    { id: 'pick', at: 0.7, hold: 3.2 },
  ],
  rest: 'pick',
  elev: 0.34,
  frame: { c: [0, 3, 0], r: 4.3, low: 0.5 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 17
    const H = 20
    const D = 12
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, 3, 0]
    const fade: [number, number] = [10, 20]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade, rnd, grain: 90 })
    // the bag: closed with its patch, then the top cut off a few cm above the
    // block and the sides slit
    const cutK = smooth(0.43, 0.47, t)
    const HEAD = 10
    const KEEP = 3.5
    if (cutK < 0.99) bag(sk, { blk, top, w: W, h: H, d: D, head: HEAD, mode: 'closed', patch: true, focus, fade, rnd: rng(SEED + 1), k: 1 - cutK })
    if (cutK > 0.01) bag(sk, { blk, top, w: W, h: H, d: D, head: KEEP, mode: 'open', focus, fade, rnd: rng(SEED + 1), k: cutK })
    const hw = W / 2 + 0.35
    const hd = D / 2 + 0.35
    // the cut line flares as it is made
    const flare = smooth(0.42, 0.45, t) * (1 - smooth(0.47, 0.52, t))
    if (flare > 0.02) {
      const ring: V3[] = [
        [-hw, KEEP, hd],
        [hw, KEEP, hd],
        [hw, KEEP, -hd],
        [-hw, KEEP, -hd],
      ]
      sk.ctx = true
      sk.line(ring, { b: B.MAIN * flare, closed: true, hid: 0.3 })
      sk.ctx = false
    }
    // one or two side slits so the cluster can push out and CO2 can spill
    if (cutK > 0.01) {
      sk.ctx = true
      const o = 0.35 * cutK
      const slits: [V3, V3, V3][] = [
        [[-2.6, KEEP, hd], [-2.6, -0.8, hd], [1, 0, 0]],
        [[hw, KEEP, 1.2], [hw, -0.8, 1.2], [0, 0, 1]],
      ]
      for (const [a, b, s] of slits) {
        const m1 = madd(lerp3(a, b, 0.5), s, o)
        const m2 = madd(lerp3(a, b, 0.5), s, -o)
        sk.line([a, m1, b], { b: B.CTX * 1.3 * cutK, hid: 0.3 })
        sk.line([a, m2, b], { b: B.CTX * 1.3 * cutK, hid: 0.3 })
      }
      sk.ctx = false
      sk.anchor('slit', [-2.6 + o, KEEP * 0.45, hd + 0.1], [0, 0, 1])
    }
    sk.anchor('cut', [4.5, KEEP + (1 - cutK) * (HEAD - KEEP) * 0.0, hd + 0.05], [0, 0, 1])

    // the pillowy top
    const pillow = 0.55 * smooth(0, 0.1, t)
    const pr = rng(SEED + 2)
    const pillowY = (x: number, z: number) => pillow * Math.max(0, 1 - (x / (W * 0.5)) ** 4) * Math.max(0, 1 - (z / (D * 0.5)) ** 4)
    sk.inPart('pillow', () => {
      for (const k of [0.82, 0.58, 0.32]) {
        const pts: V3[] = []
        for (let a = 0; a < 28; a++) {
          const ang = (a / 28) * TAU
          const x = Math.cos(ang) * W * 0.5 * k
          const z = Math.sin(ang) * D * 0.5 * k
          const sx = Math.sign(Math.cos(ang)) * Math.pow(Math.abs(Math.cos(ang)), 0.6) * W * 0.5 * k
          const sz = Math.sign(Math.sin(ang)) * Math.pow(Math.abs(Math.sin(ang)), 0.6) * D * 0.5 * k
          pts.push([lerp(x, sx, 0.7), pillowY(sx, sz) + 0.03, lerp(z, sz, 0.7)])
        }
        sk.line(pts, { b: B.SOFT * 0.9 * (1 - 0.5 * smooth(0.4, 0.6, t)), closed: true, n: [0, 1, 0], hid: 0.2 })
      }
    })
    // "spider eyes": moisture bubbles on the pillow
    const eyes = smooth(0.02, 0.08, t) * (1 - smooth(0.2, 0.3, t))
    const eyeP: V3[] = []
    const eyeR: number[] = []
    for (let i = 0; i < 30; i++) {
      const x = rr(pr, -0.85, 0.85) * W * 0.5
      const z = rr(pr, -0.85, 0.85) * D * 0.5
      eyeP.push([x, pillowY(x, z), z])
      eyeR.push(rr(pr, 0.18, 0.42))
    }
    if (eyes > 0.02)
      sk.inPart('eyes', () => {
        bubbles(
          sk,
          eyeP,
          [0, 1, 0],
          eyeR.map((r) => r * (0.4 + 0.6 * eyes)),
          B.FINE * 1.1 * eyes,
        )
        sk.anchor('eyes', eyeP[3], [0, 1, 0])
      })
    // primordia build across the top, then stall as the fist takes over
    const prim = smooth(0.13, 0.26, t) * (1 - 0.55 * smooth(0.42, 0.62, t))
    const knobs: { p: V3; h: number; r: number }[] = []
    for (let i = 0; i < 46; i++) {
      const a = pr() * TAU
      const d = Math.sqrt(rr(pr, 0.08, 1))
      const x = Math.cos(a) * d * W * 0.42
      const z = Math.sin(a) * d * D * 0.42
      knobs.push({ p: [x, pillowY(x, z), z], h: rr(pr, 0.3, 0.6), r: rr(pr, 0.4, 0.75) })
    }
    if (prim > 0.02)
      sk.inPart('primordia', () => {
        knobs.forEach((k, i) => lump(sk, k.p, k.r * Math.sqrt(prim), k.h * prim, SEED * 3 + i))
        const k = knobs.reduce((b, q) => (q.p[2] > b.p[2] && Math.abs(q.p[0]) < 3 ? q : b), knobs[0])
        sk.anchor('primordia', [k.p[0], k.p[1] + k.h * prim, k.p[2]], [0, 0, 1])
      })

    // ---- the frond plan (fixed random draws): stout branches off a white base,
    // each ending in a fan of overlapping fronds; low branches reach out wide,
    // high ones stand in the middle, and the fronds hide the branching
    const fronds: Frond[] = []
    const branches: { C: V3; B: V3; hb: number }[] = []
    const NB = 10
    const order = [0, 6, 2, 8, 4, 1, 7, 3, 9, 5]
    order.forEach((oi, b) => {
      const hb = oi / (NB - 1)
      const ab = (b / NB) * TAU + rr(rnd, -0.22, 0.22)
      const rb = lerp(3.7, 0.5, hb) + rr(rnd, -0.3, 0.3)
      const yb = lerp(0.9, 4.0, hb) + rr(rnd, -0.25, 0.25)
      branches.push({
        C: [Math.cos(ab) * 0.7, 0.5 + 0.5 * hb, Math.sin(ab) * 0.6],
        B: [Math.cos(ab) * rb * 0.5, yb * 0.62, Math.sin(ab) * rb * 0.5 * 0.82],
        hb,
      })
      const n = hb > 0.85 ? 4 : 4 + Math.floor(rnd() * 2)
      for (let j = 0; j < n; j++) {
        const a = ab + (j - (n - 1) / 2) * lerp(0.3, 0.7, hb) + rr(rnd, -0.1, 0.1)
        const h = clamp(hb + rr(rnd, -0.06, 0.06))
        const r = rb + rr(rnd, -0.4, 0.4) - (j % 2) * 0.35
        const A: V3 = [Math.cos(a) * r, yb + (j % 3) * 0.32 + rr(rnd, -0.25, 0.25), Math.sin(a) * r * 0.82]
        const u = norm([A[0] / 4.0, (A[1] + 0.8) / 4.2, A[2] / 3.3])
        fronds.push({
          br: b,
          a,
          h,
          A,
          u,
          R: lerp(2.7, 1.7, hb) * rr(rnd, 0.8, 1.2),
          lean: lerp(-0.28, 0.3, hb) + rr(rnd, -0.15, 0.15),
          delay: 0.425 + h * 0.035 + rr(rnd, 0, 0.03),
          grow: rr(rnd, 0.36, 0.4),
          seed: Math.floor(rnd() * 1e9),
          roll: rr(rnd, -0.3, 0.3),
        })
      }
    })
    // the label frond: low, facing the front
    const lead = fronds.reduce((b, f, i) => (f.h <= 0.25 && f.A[2] > fronds[b].A[2] ? i : b), 0)

    // ---- the fist: a lumpy, brain-like mound of primordia, with knuckles where
    // the fingers will come; it splits into fingers and resolves into the base
    const fistK = smooth(0.2, 0.38, t)
    const shrink = 1 - 0.58 * smooth(0.47, 0.66, t)
    const fingers = smooth(0.4, 0.5, t)
    const dark = smooth(0.44, 0.56, t)
    const FX = 4.0
    const FY = 3.8
    const FZ = 3.3
    const fx = FX * fistK * shrink
    const fy = FY * fistK * shrink
    const fz = FZ * fistK * shrink
    const fc: V3 = [0, -0.5, 0]
    const brain = wobble(rng(SEED + 4), 4, 9, 1)
    const brain2 = wobble(rng(SEED + 5), 3, 7, 1)
    const fistB = 1 - smooth(0.52, 0.66, t)
    // knuckles where the fingers will come (the strongest nearby one wins)
    const bump = (u: V3) => {
      let s = 0
      const w = 0.24 + 0.04 * fingers
      for (const f of fronds) {
        const c = u[0] * f.u[0] + u[1] * f.u[1] + u[2] * f.u[2]
        if (c < 0.7) continue
        const ang = Math.acos(Math.min(1, c))
        s = Math.max(s, Math.exp(-((ang / w) ** 2)))
      }
      return s * (0.13 + 0.3 * fingers)
    }
    const FP = (el: number, az: number): V3 => {
      const u: V3 = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)]
      const k = 1 + bump(u) + 0.06 * brain(az * 2 + el * 3) + 0.045 * brain2(el * 5 - az * 2)
      return [fc[0] + u[0] * fx * k, fc[1] + Math.pow(Math.max(0, u[1]), 0.8) * fy * k, fc[2] + u[2] * fz * k]
    }
    if (fistK > 0.02 && fistB > 0.02) {
      const nr = 12
      const nu = Math.max(24, Math.round(44 * sk.detail))
      const rows: V3[][] = []
      for (let i = 0; i <= nr; i++) {
        const el = 0.12 + (Math.PI / 2 - 0.12) * (i / nr)
        const row: V3[] = []
        for (let j = 0; j < nu; j++) row.push(FP(el, (j / nu) * TAU))
        rows.push(row)
      }
      sk.inPart('fist', () => {
        sk.gain = fistB
        surface(sk, rows, {
          closedU: true,
          rowsAt: [1, 3, 5, 7, 9, 11],
          colsAt: picks(nu, 14, true),
          rowB: B.MAIN * 0.75,
          colB: B.MAIN * 0.8,
          outward: (i, j) => sub(rows[i][j], fc),
        })
        // brain-like folds wandering over the mound
        const sr = rng(SEED + 6)
        for (let q = 0; q < Math.round(64 * sk.detail); q++) {
          let el = rr(sr, 0.2, 1.35)
          let az = sr() * TAU
          let da = rr(sr, -1, 1)
          const pts: V3[] = []
          for (let k = 0; k < 7; k++) {
            pts.push(FP(el, az))
            da += rr(sr, -0.9, 0.9)
            az += Math.cos(da) * 0.07
            el = clamp(el + Math.sin(da) * 0.07, 0.15, 1.45)
          }
          sk.line(pts, { b: B.FINE * 0.85, hid: 0 })
        }
        // the tops darken after the cut: hatching over the upper knuckles
        if (dark > 0.02) {
          for (const f of fronds) {
            if (f.u[1] < 0.35) continue
            const el = Math.asin(clamp(f.u[1], -1, 1))
            const az = Math.atan2(f.u[2], f.u[0])
            const n = Math.round(5 * dark)
            for (let q = 0; q < n; q++) {
              const e0 = el + (q - n / 2) * 0.05
              sk.line([FP(e0, az - 0.12), FP(e0 + 0.02, az), FP(e0, az + 0.12)], { b: B.FINE * dark, hid: 0 })
            }
          }
        }
        sk.gain = 1
        const top = FP(1.0, 1.3)
        sk.anchor('fist', top, norm(sub(top, fc)))
      })
    }

    // ---- fingers and fronds
    const core: V3 = [0, -0.4, 0]
    const coreK = smooth(0.42, 0.6, t)
    let stalkMid: V3 | null = null
    if (coreK > 0.02)
      sk.inPart('stalks', () => {
        stem(sk, { path: [madd(core, [0, 1, 0], -0.2), [0, 0.6, 0], [0, 1.4 * coreK + 0.2, 0]], r: (s) => (2.0 - 0.5 * s) * (0.5 + 0.5 * coreK), n: 5, m: 16, longs: 8, rings: [0.5], b: 0.85 })
        // the branches: stout, white, forking toward each fan of fronds
        branches.forEach((br) => {
          const bt = lerp3(br.C, br.B, coreK)
          const st = stem(sk, { path: [br.C, add(lerp3(br.C, bt, 0.5), [0, 0.25, 0]), bt], r: (s) => (0.85 - 0.25 * s) * (0.6 + 0.4 * coreK), n: 5, m: 10, longs: 5, rings: [], b: 0.85 })
          if (!stalkMid && br.hb < 0.2) stalkMid = st.at(0.6, 1.2)
        })
      })
    let leadCap: ReturnType<typeof cap> | null = null
    let fingerTip: V3 | null = null
    sk.inPart('fronds', () => {
      fronds.forEach((f, i) => {
        const m = clamp((t - f.delay) / f.grow)
        if (m <= 0.005) return
        const r2 = rng(f.seed)
        const wob = wobble(r2, 3, 7, 1)
        const lob = wobble(r2, 2, 5, 1)
        const out: V3 = norm([Math.cos(f.a), 0, Math.sin(f.a) * 0.82])
        // the finger starts at a knuckle of the fist and travels out to its place
        const F: V3 = add(fc, [f.u[0] * FX * 1.1, Math.pow(Math.max(0, f.u[1]), 0.8) * FY * 1.1, f.u[2] * FZ * 1.1])
        const e = smooth(0.0, 0.85, m)
        const A = lerp3(F, f.A, e)
        const br = branches[f.br]
        const C = lerp3(br.C, br.B, coreK)
        const mid = add(lerp3(C, A, 0.5), [0, 0.2 + 0.25 * (1 - f.h), 0])
        // fingers are thick; as the frond opens the stalk slims
        const sr = lerp(0.62, 0.34, smooth(0.15, 0.7, m)) * (f.h > 0.6 ? 0.85 : 1)
        stem(sk, { path: [C, mid, A], r: (s) => sr * (1.15 - 0.3 * s), n: 5, m: 9, longs: 4, rings: [], b: 0.85 })
        // the frond: a knob on the finger tip that flattens into a spoon
        const L = f.lean
        const axF = norm(add(mul([0, 1, 0], Math.cos(L)), mul(out, -Math.sin(L))))
        const fwF = norm(add(mul(out, Math.cos(L)), mul([0, 1, 0], Math.sin(L))))
        const k0 = smooth(0.1, 0.6, m)
        const tipDir = norm(sub(A, mid))
        const axis = norm(lerp3(tipDir, axF, k0))
        let fw = norm(lerp3(norm(cross(cross(tipDir, out), tipDir)), fwF, k0))
        if (!isFinite(fw[0])) fw = fwF
        const lobA = keys(m, [[0.3, 0.03], [1, 0.17]])
        const rufA = keys(m, [[0.45, 0], [1, 0.15]])
        const c = cap(sk, {
          at: A,
          axis,
          fwd: norm(add(fw, mul(cross(axis, fw), f.roll))),
          shape: {
            R: f.R * keys(m, [
              [0, 0.2],
              [0.15, 0.26],
              [0.35, 0.44],
              [0.6, 0.76],
              [0.85, 0.95],
              [1, 1],
            ]),
            phi: keys(m, [
              [0, 1.25],
              [0.2, 1.05],
              [0.4, 0.68],
              [0.65, 0.3],
              [1, 0.12],
            ]),
            curl: keys(m, [
              [0, 1.35],
              [0.25, 1.1],
              [0.45, 0.72],
              [0.7, 0.26],
              [0.88, 0.04],
              [1, -0.08],
            ]),
            curlAt: 0.58,
            dip: keys(m, [
              [0.3, 0],
              [0.7, 0.2],
              [1, 0.34],
            ]),
            thick: 0.12,
            edge: 0.016,
            span: 3.9,
            plan: (th) => (0.14 + 0.86 * Math.pow((1 + Math.cos(th)) / 2, 1.3)) * (1 + lobA * lob(th)),
            curlBy: (th) => 0.72 + 0.28 * Math.cos(th),
            ruffle: (th) => rufA * wob(th),
          },
          gills: null,
          stemR: sr * 0.85,
          nu: 30,
          nv: 9,
          meridians: 8,
          rings: [0.5, 0.86],
          under: [0.6],
          b: f.h >= 0.75 ? 0.95 : 0.9,
        })
        // dark tops: radial fibrils; white pores underneath
        capStreaks(sk, c, r2, Math.round(lerp(3, 12, dark) * (0.6 + 0.4 * m)), B.SOFT * 1.1, 0.2, 0.95)
        if (m > 0.35) pores(sk, c, r2, Math.round(18 * smooth(0.35, 0.8, m)), 0.07 * f.R, B.SOFT, 0.25, 0.92)
        if (i === lead) {
          leadCap = c
          fingerTip = c.top(0.2, 0)
        }
      })
    })
    const lc = leadCap as ReturnType<typeof cap> | null
    if (lc) {
      sk.anchor('fingers', fingerTip ?? lc.top(0.2, 0), lc.topN(0.2, 0))
      sk.anchor('fronds', lc.top(0.62, 0.35), lc.topN(0.62, 0.35))
      sk.anchor('pores', lc.under(0.7, -0.5), mul(lc.topN(0.7, -0.5), -1))
    }
    if (stalkMid) sk.anchor('stalks', stalkMid, [0, 0, 1])
  },
}

/** A primordium: a low, lumpy, brain-like bump on the block top. */
function lump(sk: Sketch, p: V3, r: number, h: number, seed: number) {
  const rnd = rng(seed)
  const wb = wobble(rnd, 2, 5, 1)
  const rows: V3[][] = []
  const nu = 10
  for (let i = 0; i <= 4; i++) {
    const el = (i / 4) * (Math.PI / 2) * 0.96
    const row: V3[] = []
    for (let j = 0; j < nu; j++) {
      const az = (j / nu) * TAU
      const k = 1 + 0.22 * wb(az + el)
      row.push([p[0] + Math.cos(el) * Math.cos(az) * r * k, p[1] + Math.sin(el) * h * k, p[2] + Math.cos(el) * Math.sin(az) * r * k])
    }
    rows.push(row)
  }
  surface(sk, rows, { closedU: true, rowsAt: [0, 2], colsAt: picks(nu, 5, true), rowB: B.FINE * 0.9, colB: B.FINE, outward: (i, j) => sub(rows[i][j], p) })
  // a fold or two across the top
  const a = rnd() * TAU
  sk.line(
    [0, 1, 2, 3, 4].map((q): V3 => {
      const u = (q / 4 - 0.5) * 1.4
      const x = Math.cos(a) * u * r + Math.sin(a) * 0.15 * r * Math.sin(q * 2.2)
      const z = Math.sin(a) * u * r - Math.cos(a) * 0.15 * r * Math.sin(q * 2.2)
      const y = h * Math.sqrt(Math.max(0, 1 - (u * u) / 1.2)) + 0.02
      return [p[0] + x, p[1] + y, p[2] + z]
    }),
    { b: B.FINE * 0.8, hid: 0 },
  )
}
