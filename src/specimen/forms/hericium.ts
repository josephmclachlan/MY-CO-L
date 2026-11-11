// LION'S MANE (Hericium erinaceus) and COMB TOOTH (Hericium coralloides).
// Lion's mane: one compact pom-pom pushed out of a side cut, covered in spines
// that hang down; pick while the spines are short and even; late spines grow
// long, droop and drop spores. Comb tooth: grows out as a column, then branches
// again and again like Romanesco cauliflower, with rows of teeth hanging under
// the branches; late heads droop and go spongy.
import { bag, block, faceCut, stem } from '../parts'
import { B, type Sketch, surface, picks } from '../sketch'
import { type V3, TAU, add, cross, lerp, lerp3, madd, mul, norm, rng, rr, smooth, sub, wobble, GOLD } from '../math'
import type { SpecimenModel } from '../registry'

// ---------------------------------------------------------------- lion's mane

const LM_SEED = 23

export const lionsMane: SpecimenModel = {
  id: 'lions-mane',
  seed: LM_SEED,
  stages: [
    { id: 'cut', at: 0 },
    { id: 'knob', at: 0.12 },
    { id: 'ball', at: 0.3 },
    { id: 'pick', at: 0.5, hold: 3.2 },
    { id: 'late', at: 0.76 },
  ],
  rest: 'pick',
  elev: 0.2,
  swing: 1.15,
  frame: { c: [0, 0, 10], r: 5.2 },
  build(sk: Sketch, t: number) {
    const rnd = rng(LM_SEED)
    const W = 18
    const H = 26
    const D = 12
    const top: V3 = [0, H / 2, 0]
    const cutC: V3 = [0, 0, D / 2 + 0.05]
    const focus: V3 = [0, 0, D / 2 + 4]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [9, 18], rnd, grain: 110 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 6, mode: 'closed', patch: true, focus, fade: [9, 18], rnd })
    faceCut(sk, cutC, [0, 0, 1], [0, 1, 0], 7, 'slit', smooth(0, 0.12, t), B.CTX * 1.6)
    sk.anchor('cut', [2.8, 0.1, D / 2 + 0.2], [0, 0, 1])

    // body: a lumpy, round pom-pom pushed out of the cut
    const grow = smooth(0.08, 0.5, t) * 0.88 + smooth(0.5, 1, t) * 0.12
    const R = lerp(0.5, 4.8, grow)
    const lump = wobble(rnd, 3, 7, 1)
    const lump2 = wobble(rnd, 2, 6, 1)
    const knobby = 1 - smooth(0.22, 0.5, t)
    // late fruit swells with water and sags a little
    const swell = 1 + 0.08 * smooth(0.78, 1, t)
    const c: V3 = [0, -0.15 * R, cutC[2] + R * 0.8]
    const nr = 14
    const nu = Math.max(18, Math.round(32 * sk.detail))
    const rows: V3[][] = []
    const P = (el: number, az: number): V3 => {
      const k = (1 + 0.06 * lump(az + el * 1.7) + 0.045 * lump2(el * 2.3 - az) + knobby * 0.14 * Math.sin(az * 5) * Math.sin(el * 4 + 0.5)) * swell
      const rx = R * 1.0 * k
      const ry = R * 0.94 * k * (1 + 0.05 * smooth(0.78, 1, t) * Math.max(0, -Math.sin(el)))
      const rz = R * 0.9 * k
      return [c[0] + Math.cos(el) * Math.cos(az) * rx, c[1] + Math.sin(el) * ry, c[2] + Math.cos(el) * Math.sin(az) * rz]
    }
    for (let i = 0; i <= nr; i++) {
      const el = -Math.PI / 2 + (Math.PI * i) / nr
      const row: V3[] = []
      for (let j = 0; j < nu; j++) row.push(P(el, (j / nu) * TAU))
      rows.push(row)
    }
    // once the spines come, the skin under them fades back: the spines carry the shape
    const skinB = lerp(1, 0.55, smooth(0.3, 0.5, t))
    sk.inPart('body', () =>
      surface(sk, rows, {
        closedU: true,
        rowsAt: [4, 7, 10, 12],
        colsAt: picks(nu, 10, true),
        rowB: B.SOFT * skinB,
        colB: B.SOFT * 1.15 * skinB,
        outward: (i, j) => sub(rows[i][j], c),
      }),
    )
    // attachment to the block: a short neck into the cut
    stem(sk, { path: [madd(cutC, [0, 0, 1], -0.4), [0, -0.1 * R, cutC[2] + R * 0.25]], r: () => Math.min(2.4, R * 0.5), n: 3, m: 14, longs: 7, rings: [] })

    // spines: a fuzz first, then short and even (pick), then long and drooping
    const spineLen = smooth(0.28, 0.5, t) * 0.8 + smooth(0.6, 0.95, t) * 2.0
    const droop = smooth(0.58, 0.95, t)
    const n = Math.round(1500 * sk.detail)
    if (spineLen > 0.01)
      sk.inPart('spines', () => {
        for (let i = 0; i < n; i++) {
          // even spread over the ball (golden spiral)
          const y = 1 - (2 * (i + 0.5)) / n
          const az = i * GOLD
          const el = Math.asin(y)
          if (el > 1.25) continue // the crown stays nearly bald
          const base = P(el, az)
          const out = norm(sub(base, c))
          // short on the crown, longest underneath
          const lowK = 0.35 + 0.65 * smooth(0.95, -0.7, y)
          const L = spineLen * lowK * (0.8 + 0.4 * (((i * 7919) % 17) / 17))
          // hang: spines point down, more so as they lengthen and droop
          const dn = lerp(0.62, 0.95, droop)
          const dir = norm(add(mul(out, 1 - dn), [0, -dn, 0]))
          const mid = madd(madd(base, out, L * 0.22), dir, L * 0.3)
          const tip = madd(mid, norm(add(dir, [0, -droop * 0.7, 0])), L * 0.62)
          sk.line([base, mid, tip], { b: (k) => B.FINE * (0.7 + 0.3 * k), hid: 0.2, n: out })
        }
      })
    // overripe: spores drift down from the spines
    const late = smooth(0.84, 1, t)
    if (late > 0.02) {
      const sr = rng(LM_SEED + 9)
      sk.inPart('spores', () => {
        for (let i = 0; i < 36; i++) {
          const ph = sr()
          const fall = ((t * 9 + ph) % 1) * 6
          const p: V3 = [rr(sr, -4, 4), c[1] - R * 0.6 - fall, c[2] + rr(sr, -3, 3)]
          sk.mark(p, [0, 0, 1], 0.12, { b: B.FINE * late * (1 - fall / 6), hid: 0 }, ph * 6)
          if (i === 2) sk.anchor('spores', p, [0, 0, 1])
        }
      })
    }
    sk.anchor('body', P(1.0, 1.25), norm(sub(P(1.0, 1.25), c)))
    sk.anchor('spines', P(-0.35, 1.45), [0, 0, 1])
    sk.anchor('long', P(-1.05, 1.75), [0, 0, 1])
  },
}

// ---------------------------------------------------------------- comb tooth

const CT_SEED = 37

interface Br {
  a: V3
  b: V3
  dir: V3
  r: number
  depth: number
  born: number
  /** Distance along the plan from the trunk top (for sagging). */
  reach: number
}

export const combTooth: SpecimenModel = {
  id: 'comb-tooth',
  seed: CT_SEED,
  stages: [
    { id: 'cut', at: 0, elev: 0.5 },
    { id: 'column', at: 0.12, elev: 0.45 },
    { id: 'branching', at: 0.3, hold: 0.8, elev: 0.32 },
    { id: 'pick', at: 0.56, hold: 3.2 },
    { id: 'late', at: 0.8 },
  ],
  rest: 'pick',
  elev: 0.26,
  frame: { c: [0, 4.2, 0], r: 4.6, low: 0.75 },
  build(sk: Sketch, t: number) {
    const rnd = rng(CT_SEED)
    const W = 17
    const H = 12
    const D = 12
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, 4, 0]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade: [10, 19], rnd, grain: 90 })
    // the bag folded down over the top and an X cut through it
    bag(sk, { blk, top, w: W, h: H, d: D, head: 0, mode: 'folded', focus, fade: [10, 19], rnd })
    faceCut(sk, [0, 0.28, 0], [0, 1, 0], [0, 0, -1], 5, 'x', smooth(0, 0.1, t), B.CTX * 1.5)
    sk.anchor('cut', [1.7, 0.3, 1.3], [0, 1, 0])

    // the branching plan, built once with fixed random draws; each branch is
    // "born" at a growth point and grows out over a short window
    const brs: Br[] = []
    const trunkTop: V3 = [0, 1.7, 0]
    brs.push({ a: [0, -0.3, 0], b: trunkTop, dir: [0, 1, 0], r: 1.45, depth: 0, born: 0.12, reach: 0 })
    const MAXD = 5
    const growBr = (from: V3, dir: V3, len: number, r: number, depth: number, born: number, reach: number) => {
      const to = madd(from, dir, len)
      brs.push({ a: from, b: to, dir, r, depth, born, reach: reach + len })
      if (depth >= MAXD) return
      const kids = depth <= 2 ? 3 : rnd() < 0.35 ? 3 : 2
      const s0 = cross(dir, [0.31, 0.12, 0.94])
      const side = norm(s0)
      const side2 = cross(dir, side)
      const spin = rnd() * TAU
      for (let k = 0; k < kids; k++) {
        const ang = spin + (k / kids) * TAU + rr(rnd, -0.35, 0.35)
        const sv = add(mul(side, Math.cos(ang)), mul(side2, Math.sin(ang)))
        // spread out and keep climbing a little: a rounded, cloud-like head
        const nd = norm(add(add(mul(dir, 0.7), mul(sv, 0.52 + depth * 0.05)), [0, 0.2, 0]))
        growBr(to, nd, len * rr(rnd, 0.64, 0.74), r * 0.7, depth + 1, born + 0.048, reach + len)
      }
    }
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * TAU + 0.45 + rr(rnd, -0.15, 0.15)
      const up = k === 4 ? 1.6 : 0.8
      growBr(trunkTop, norm([Math.cos(ang) * 0.72, up, Math.sin(ang) * 0.72]), 1.75, 0.8, 1, 0.28, 0)
    }
    // tooth draws are fixed per branch too
    const tr = rng(CT_SEED + 3)
    const toothK = brs.map(() => [rr(tr, 0.7, 1.25), rr(tr, 0.7, 1.25), rr(tr, -0.2, 0.2)])

    // growth: column, branches, then teeth; late heads droop and go spongy
    const col = smooth(0.1, 0.3, t)
    const droop = smooth(0.8, 1, t)
    const spongy = 1 + 0.35 * droop
    const sag = (p: V3, reach: number): V3 => madd(p, [0, -1, 0], droop * 0.055 * reach * reach)
    const tips: { p: V3; r: number }[] = []
    let anchorBr: V3 | null = null
    let anchorTooth: V3 | null = null
    const teethLen = smooth(0.42, 0.62, t) * 0.85 + droop * 0.55
    const drawn: { a: V3; b: V3; dir: V3; r: number; k: number; i: number; depth: number }[] = []
    brs.forEach((br, i) => {
      const k = br.depth === 0 ? col : smooth(br.born, br.born + 0.1, t)
      if (k <= 0.02) return
      const a = br.depth === 0 ? br.a : sag(br.a, br.reach - dist3(br.a, br.b))
      let b = br.depth === 0 ? lerp3(br.a, br.b, 0.25 + 0.75 * k) : lerp3(a, sag(br.b, br.reach), k)
      if (br.depth === 0) b = lerp3(br.a, br.b, 0.25 + 0.75 * k)
      const r = br.r * (0.55 + 0.45 * k) * spongy
      const isTip = br.depth === MAXD
      const mid = madd(lerp3(a, b, 0.5), [0, 1, 0], 0.05 * dist3(a, b))
      sk.inPart(br.depth === 0 ? 'column' : 'branches', () =>
        stem(sk, {
          path: [a, mid, b],
          // growing tips round off; inner joints stay full
          r: (s) => r * (1 - 0.28 * s) * (isTip || k < 0.98 ? Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.max(0, s - 0.7) / 0.3, 2))) : 1),
          n: br.depth <= 1 ? 5 : 4,
          m: br.depth <= 1 ? 12 : 8,
          longs: br.depth <= 1 ? 6 : br.depth <= 3 ? 4 : 3,
          rings: br.depth === 0 ? [0.55] : [],
          b: br.depth <= 1 ? 0.95 : 0.85,
        }),
      )
      drawn.push({ a, b, dir: norm(sub(b, a)), r, k, i, depth: br.depth })
      if (isTip) tips.push({ p: b, r })
      if (br.depth === 2 && !anchorBr) anchorBr = lerp3(a, b, 0.6)
    })
    // teeth: rows hanging under every outer branch, like the teeth of a comb
    if (teethLen > 0.02)
      sk.inPart('teeth', () => {
        for (const d of drawn) {
          if (d.depth < 2) continue
          const L0 = teethLen * d.k * (d.depth >= 4 ? 1 : 0.8)
          if (L0 < 0.02) continue
          const len = dist3(d.a, d.b)
          let sx = cross(d.dir, [0, 1, 0])
          if (Math.hypot(sx[0], sx[1], sx[2]) < 0.1) sx = [1, 0, 0]
          const side = norm(sx)
          const count = Math.max(2, Math.round((len / 0.24) * Math.max(0.6, sk.detail)))
          const [k1, k2, lean] = toothK[d.i]
          for (let q = 0; q < count; q++) {
            const u = (q + 0.5) / count
            const p = lerp3(d.a, d.b, u)
            for (const sd of [-1, 1]) {
              const base = madd(madd(p, side, sd * d.r * 0.6), [0, -1, 0], d.r * 0.55)
              const L = L0 * (sd < 0 ? k1 : k2) * (0.85 + 0.3 * Math.sin(q * 2.1 + d.i))
              const tip = add(base, [side[0] * sd * lean * L + 0.08 * droop * L, -L, side[2] * sd * lean * L])
              const midp = madd(lerp3(base, tip, 0.5), side, sd * 0.06 * L * (1 + droop))
              sk.line([base, midp, tip], { b: B.FINE, hid: 0.2 })
              if (!anchorTooth && d.depth === 4 && q === 1) anchorTooth = lerp3(base, tip, 0.6)
            }
          }
        }
        // a tassel at each growing tip
        for (const tp of tips) {
          const n = Math.max(3, Math.round(5 * sk.detail))
          for (let q = 0; q < n; q++) {
            const a = (q / n) * TAU
            const base = add(tp.p, [Math.cos(a) * tp.r * 0.8, -tp.r * 0.4, Math.sin(a) * tp.r * 0.8])
            sk.seg(base, add(base, [0.05 * droop, -teethLen * 0.9, 0]), { b: B.FINE * 0.9, hid: 0.2 })
          }
        }
      })
    sk.anchor('column', [0.95, 1.2 * col, 0.9], [1, 0, 1])
    if (anchorBr) sk.anchor('branches', anchorBr, [0, 0, 1])
    if (anchorTooth) sk.anchor('teeth', anchorTooth, [0, 0, 1])
  },
}

const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
