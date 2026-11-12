// CORDYCEPS (Cordyceps militaris) on rice media in a filter bag. The sources say
// little about how it looks: rice media, dark early incubation, fast fruiting in
// high-exchange bags, and stalled white heads. The rest of this drawing (a white
// mat, pins, then slender clubs with swollen, pimpled fertile heads) is drawn
// from general knowledge and is labelled as such.
import { bag, block, fluff, pin, stem } from '../parts'
import { B, type Sketch } from '../sketch'
import { type V3, TAU, add, clamp, frameOf, inF, lerp, madd, norm, rng, rr, smooth, sub } from '../math'
import type { SpecimenModel } from '../registry'

const SEED = 191

interface Club {
  base: V3
  h: number
  r: number
  lean: V3
  wig: number
  delay: number
  stalled: boolean
  seed: number
}

export const cordyceps: SpecimenModel = {
  id: 'cordyceps',
  seed: SEED,
  stages: [
    { id: 'rice', at: 0, elev: 0.5 },
    { id: 'mat', at: 0.14, elev: 0.5 },
    { id: 'pins', at: 0.3, elev: 0.42 },
    { id: 'clubs', at: 0.45, hold: 0.8 },
    { id: 'pick', at: 0.64, hold: 3.2 },
  ],
  rest: 'pick',
  elev: 0.3,
  frame: { c: [0, 3.5, 0], r: 5, low: 0.5 },
  build(sk: Sketch, t: number) {
    const rnd = rng(SEED)
    const W = 14
    const H = 6
    const D = 10
    const top: V3 = [0, 0, 0]
    const focus: V3 = [0, 3, 0]
    const fade: [number, number] = [9, 18]
    const blk = block(sk, { top, w: W, h: H, d: D, focus, fade, rnd, grain: 0 })
    bag(sk, { blk, top, w: W, h: H, d: D, head: 14, mode: 'closed', patch: true, focus, fade, rnd: rng(SEED + 1) })
    sk.anchor('bag', [W / 2 + 0.4, 9, D / 2 + 0.4], [1, 0, 1])
    // rice grains: little long ovals over the media
    const gr = rng(SEED + 2)
    sk.inPart('rice', () => {
      sk.ctx = true
      const faces = ['top', 'front', 'side'] as const
      for (let i = 0; i < Math.round(150 * sk.detail); i++) {
        const fc = faces[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]
        const p = blk.face(fc, rr(gr, -0.92, 0.92), rr(gr, -0.92, 0.92))
        const k = blk.fadeAt(p)
        if (k < 0.05) continue
        const n = blk.normal(fc)
        const f = frameOf(n, [Math.cos(gr() * TAU), 0.3, Math.sin(gr() * TAU)])
        const L = rr(gr, 0.28, 0.4)
        const w = L * 0.36
        const pts: V3[] = []
        for (let q = 0; q < 8; q++) {
          const a = (q / 8) * TAU
          pts.push(inF(madd(p, n, 0.03), f, Math.cos(a) * L * 0.5, Math.sin(a) * w * 0.5, 0))
        }
        sk.line(pts, { b: B.CTX * 1.6 * k, closed: true, n, hid: 0.1 })
      }
      sk.ctx = false
      sk.anchor('rice', blk.face('front', 0.25, 0.1), [0, 0, 1])
    })
    // the white mat over the rice
    const mat = smooth(0.12, 0.24, t)
    const fr = rng(SEED + 3)
    if (mat > 0.02)
      sk.inPart('mat', () => {
        fluff(sk, [0, 0.02, 0], [0, 1, 0], 5.6, fr, 80, 0.5 * mat, B.SOFT * 1.2 * mat)
        sk.anchor('mat', [-3.2, 0.3 * mat, 2.2], [0, 1, 0])
      })

    // the club plan
    const clubs: Club[] = []
    const N = 34
    for (let i = 0; i < N; i++) {
      const a = i * 2.39996 + rr(rnd, -0.3, 0.3)
      const d = Math.sqrt((i + 0.5) / N)
      const stalled = i % 11 === 5
      clubs.push({
        base: [Math.cos(a) * d * 5.4, 0, Math.sin(a) * d * 3.8],
        h: stalled ? rr(rnd, 1.1, 1.7) : rr(rnd, 4.2, 7.2) * (1.1 - 0.25 * d),
        r: rr(rnd, 0.15, 0.22),
        lean: [Math.cos(a) * d * 0.35 + rr(rnd, -0.15, 0.15), 1, Math.sin(a) * d * 0.3 + rr(rnd, -0.15, 0.15)],
        wig: rr(rnd, -1, 1),
        delay: rr(rnd, 0.28, 0.36),
        stalled,
        seed: Math.floor(rnd() * 1e9),
      })
    }
    // pins, clubs rising, then the fertile heads swell
    let leadHead: V3 | null = null
    let leadStalk: V3 | null = null
    let stalledHead: V3 | null = null
    sk.inPart('clubs', () => {
      clubs.forEach((c, i) => {
        const g = clamp((t - c.delay) / 0.4)
        if (g <= 0.01) return
        const grow = c.stalled ? smooth(0, 0.35, g) : smooth(0, 0.85, g)
        const L = Math.max(0.15, c.h * grow)
        if (L < 0.5) {
          // still a pin
          pin(sk, c.base, norm(c.lean), L, c.r * 1.3, B.FINE * 1.1, 0.2)
          return
        }
        const r2 = rng(c.seed)
        const dir = norm(c.lean)
        const side: V3 = norm([dir[1], -dir[0] + 0.3, 0.2])
        const p1 = madd(madd(c.base, dir, L * 0.35), side, c.wig * 0.05 * L)
        const p2 = madd(madd(c.base, dir, L * 0.7), side, c.wig * 0.08 * L)
        const p3 = madd(madd(c.base, dir, L), side, c.wig * 0.06 * L)
        const head = c.stalled ? 0 : smooth(0.55, 1, g)
        const st = stem(sk, {
          path: [c.base, p1, p2, p3],
          // slender stalk, swelling into the fertile head over the top third
          r: (s) => {
            const hk = smooth(0.56, 0.68, s) * (0.5 + 0.9 * head)
            const tipRound = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.max(0, s - 0.9) / 0.1, 2)))
            return c.r * (1 + (c.stalled ? 1.2 : 1) * hk + (c.stalled ? 0.5 * smooth(0.5, 0.9, s) : 0)) * tipRound
          },
          n: 10,
          m: 8,
          longs: 3,
          rings: c.stalled ? [] : [0.62],
          b: c.stalled ? 0.8 : 0.95,
        })
        // the fertile head is pimpled with tiny flask-shaped bumps
        if (head > 0.05) {
          const nb = Math.round(16 * head * Math.max(0.6, sk.detail))
          for (let q = 0; q < nb; q++) {
            const s = rr(r2, 0.66, 0.93)
            const th = r2() * TAU
            const p = st.at(s, th, 0.02)
            const n = st.nrm(s, th)
            sk.seg(p, madd(p, n, 0.07 * head), { b: B.FINE, n, hid: 0 })
          }
        }
        if (!c.stalled && !leadHead && c.base[2] > 1.5) {
          leadHead = st.at(0.8, 1.2, 0.05)
          leadStalk = st.at(0.35, 1.2)
        }
        if (c.stalled && !stalledHead) stalledHead = st.at(0.9, 1.2)
        void i
      })
    })
    if (leadHead) sk.anchor('head', leadHead, [0, 0, 1])
    if (leadStalk) sk.anchor('stalk', leadStalk, [0, 0, 1])
    if (stalledHead) sk.anchor('stalled', stalledHead, [0, 0, 1])
    const pinsK = smooth(0.28, 0.36, t) * (1 - smooth(0.5, 0.6, t))
    if (pinsK > 0.02) sk.anchor('pins', add(clubs[2].base, [0, 0.4, 0]), [0, 0, 1])
    void lerp
    void sub
  },
}
