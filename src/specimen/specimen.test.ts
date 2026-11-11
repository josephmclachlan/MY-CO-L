// The species wireframes: every model draws cleanly at every growth point, its
// stages and callouts match the stage and label notes, and the time-lapse and
// the callout layout behave.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODELS } from './models'
import { Sketch, type Built } from './sketch'
import { fitModel } from './fit'
import { elevAt, stageAt, stageShowT } from './registry'
import { Director, GROW_SPEED } from './director'
import { leaderPath, placeLabels, stack } from './labels'
import { ANATOMY } from '../data/anatomy'
import { SPECIES } from '../data/species'

const sk = new Sketch()
function draw(id: string, t: number, detail = 0.5): Built {
  const m = MODELS[id]
  sk.reset()
  sk.detail = detail
  const f = fitModel(m, detail)
  sk.axis = [f.cx, f.cz]
  m.build(sk, t)
  return sk.export(t)
}
const finite = (a: ArrayLike<number>) => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

describe('species models', () => {
  it('every species has a model and stage notes', () => {
    for (const sp of SPECIES) {
      expect(MODELS[sp.id], sp.id).toBeDefined()
      expect(ANATOMY[sp.id], sp.id).toBeDefined()
    }
  })

  for (const [id, m] of Object.entries(MODELS)) {
    describe(id, () => {
      it('stages run in order from 0, and the rest stage exists', () => {
        expect(m.stages[0].at).toBe(0)
        for (let i = 1; i < m.stages.length; i++) expect(m.stages[i].at).toBeGreaterThan(m.stages[i - 1].at)
        expect(m.stages.at(-1)!.at).toBeLessThan(1)
        expect(m.stages.some((s) => s.id === m.rest)).toBe(true)
        for (const s of m.stages) {
          const t = stageShowT(m, s.id)
          expect(stageAt(m, t)).toBe(m.stages.indexOf(s))
        }
      })

      it('the camera height shows each stage at its own angle and never jumps', () => {
        for (const s of m.stages) expect(elevAt(m, stageShowT(m, s.id)), s.id).toBeCloseTo(s.elev ?? m.elev ?? 0.22, 6)
        let prev = elevAt(m, 0)
        for (let k = 1; k <= 2000; k++) {
          const e = elevAt(m, k / 2000)
          expect(Math.abs(e - prev), `t=${k / 2000}`).toBeLessThan(0.01)
          expect(e).toBeGreaterThan(0)
          expect(e).toBeLessThan(1.2)
          prev = e
        }
      })

      it('draws finite, bounded geometry at every growth point', () => {
        for (let k = 0; k <= 10; k++) {
          const b = draw(id, k / 10)
          expect(b.lp.length % 6, 'whole segments').toBe(0)
          expect(b.lp.length / 3).toBe(b.ln.length / 3)
          expect(b.li.length).toBe((b.lp.length / 3) * 4)
          expect(b.oi.length % 3).toBe(0)
          expect(finite(b.lp) && finite(b.ln) && finite(b.li) && finite(b.op), `t=${k / 10}`).toBe(true)
          // indices point inside the skin
          const nv = b.op.length / 3
          for (let i = 0; i < b.oi.length; i++) if (b.oi[i] >= nv) throw new Error(`bad index at t=${k / 10}`)
          // never so big that a phone chokes on it
          expect(b.lp.length / 3).toBeLessThan(400_000)
          for (const a of Object.values(b.anchors)) expect(finite(a.p)).toBe(true)
          expect(Number.isFinite(b.rad)).toBe(true)
        }
      })

      it('draws the same thing twice (no randomness between frames)', () => {
        const a = draw(id, 0.63)
        const c = draw(id, 0.63)
        expect(a.lp.length).toBe(c.lp.length)
        expect(Array.from(a.lp.slice(0, 600))).toEqual(Array.from(c.lp.slice(0, 600)))
        expect(Array.from(a.lp.slice(-600))).toEqual(Array.from(c.lp.slice(-600)))
      })

      it('full detail draws too', () => {
        for (const t of [0.2, 0.7, 1]) {
          const b = draw(id, t, 1)
          expect(finite(b.lp)).toBe(true)
        }
      })
    })
  }
})

describe('stage and label notes', () => {
  for (const [id, a] of Object.entries(ANATOMY)) {
    describe(id, () => {
      const m = MODELS[id]
      it('has one note per model stage, in order', () => {
        expect(m, `no model for ${id}`).toBeDefined()
        expect(a.stages.map((s) => s.id)).toEqual(m.stages.map((s) => s.id))
        for (const s of a.stages) {
          expect(s.k.length, s.id).toBeGreaterThan(0)
          expect(s.k.length, `${s.id} name fits a stage key`).toBeLessThanOrEqual(16)
        }
      })

      it('labels are unique, short, on real stages, and cite fact ids', () => {
        const ids = new Set<string>()
        for (const l of a.labels) {
          expect(ids.has(l.id), `duplicate ${l.id}`).toBe(false)
          ids.add(l.id)
          expect(l.k.length, l.id).toBeLessThanOrEqual(16)
          expect(l.on.length, l.id).toBeGreaterThan(0)
          for (const s of l.on) expect(m.stages.map((x) => x.id), `${l.id} on ${s}`).toContain(s)
        }
        for (const x of [...a.stages, ...a.labels]) for (const f of x.s ?? []) expect(f).toMatch(/^F\d\d-\d{4}$/)
      })

      it('every label points at something drawn in each of its stages', () => {
        for (const l of a.labels) {
          for (const s of l.on) {
            const b = draw(id, stageShowT(m, s))
            expect(b.anchors[l.at ?? l.id], `${l.id} (${l.at ?? l.id}) at ${s}`).toBeDefined()
            if (l.part) expect(b.parts.map(([n]) => n), `${l.id} part ${l.part} at ${s}`).toContain(l.part)
          }
        }
      })

      it('every stage has at least one label, and never more than five', () => {
        for (const s of m.stages) {
          const n = a.labels.filter((l) => l.on.includes(s.id)).length
          expect(n, s.id).toBeGreaterThan(0)
          expect(n, s.id).toBeLessThanOrEqual(5)
        }
      })
    })
  }

  // Locally the textbook sits beside the project files: every cited fact must be in it.
  const BOOK = '/mnt/project-files/knowledge/01-core-knowledge/textbook/chapters'
  it.skipIf(!existsSync(BOOK))('every cited fact id is in the textbook', () => {
    const text = readdirSync(BOOK)
      .map((f) => readFileSync(`${BOOK}/${f}`, 'utf8'))
      .join('\n')
    for (const a of Object.values(ANATOMY)) for (const x of [...a.stages, ...a.labels]) for (const f of x.s ?? []) expect(text.includes(f), `${a.id} ${x.id} ${f}`).toBe(true)
  })
})

describe('time-lapse director', () => {
  const m = MODELS.chestnut
  /** Run with the drawing always caught up; log where it holds. */
  function run(d: Director, seconds: number, dt = 1 / 30) {
    const holds: number[] = []
    for (let s = 0; s < seconds; s += dt) {
      const was = d.phase.k
      d.step(dt, d.t)
      if (d.phase.k === 'hold' && was !== 'hold') holds.push(d.t)
    }
    return holds
  }

  it('opens on the picking picture, then plays every stage in order and loops', () => {
    const d = new Director(m, { autoplay: true, reduced: false })
    expect(d.t).toBeCloseTo(stageShowT(m, m.rest))
    expect(d.phase.k).toBe('start')
    expect(d.reveal).toBe(0)
    d.step(0.016, null)
    expect(d.phase.k, 'waits for the first drawing').toBe('start')
    d.step(0.016, d.t)
    expect(d.phase.k).toBe('wipe-in')
    expect(d.drain()).toEqual(['draw-in'])
    const holds = run(d, 60)
    const ev = d.drain()
    expect(ev[0]).toBe('drawn')
    expect(ev.filter((e) => e === 'loop').length).toBeGreaterThanOrEqual(1)
    // the first loop holds at every stage picture, then the end
    const first = holds.slice(0, d.targets.length)
    expect(first).toEqual(d.targets)
    expect(d.playing).toBe(true)
  })

  it('never runs ahead of the drawing on screen', () => {
    const d = new Director(m, { autoplay: true, reduced: false })
    d.step(0.016, d.t)
    run(d, 6) // through the intro to the loop
    // the drawing stalls: holds must not count down
    const stuck = -1
    for (let i = 0; i < 200; i++) d.step(0.05, stuck)
    expect(['reset', 'hold', 'grow']).toContain(d.phase.k)
    if (d.phase.k === 'hold') expect(d.phase.left).toBeGreaterThan(0)
  })

  it('grows at the set speed', () => {
    const d = new Director(m, { autoplay: false, reduced: false })
    d.step(0.016, d.t)
    run(d, 2)
    d.seek(0, true)
    d.play()
    const t0 = d.t
    d.step(0.5, d.t)
    expect(d.t - t0).toBeCloseTo(GROW_SPEED * 0.5, 5)
  })

  it('pause stops it; play carries on from there', () => {
    const d = new Director(m, { autoplay: true, reduced: false })
    d.step(0.016, d.t)
    run(d, 9)
    d.pause()
    expect(d.playing).toBe(false)
    const t = d.t
    run(d, 3)
    expect(d.t).toBe(t)
    expect(d.reveal === null || d.reveal === 1).toBe(true)
    d.play()
    expect(d.playing).toBe(true)
  })

  it('seek eases to a stage, or jumps when asked', () => {
    const d = new Director(m, { autoplay: true, reduced: false })
    d.step(0.016, d.t)
    run(d, 1.5)
    const to = stageShowT(m, 'knots')
    d.pause()
    d.seek(to)
    expect(d.phase.k).toBe('seek')
    run(d, 2)
    expect(d.t).toBe(to)
    expect(d.phase.k).toBe('idle')
    d.seek(0.9, true)
    expect(d.t).toBe(0.9)
  })

  it('with reduced motion nothing moves by itself, and a played loop stops at the end', () => {
    const d = new Director(m, { autoplay: true, reduced: true })
    d.step(0.016, d.t)
    expect(d.phase.k).toBe('idle')
    expect(d.reveal).toBeNull()
    run(d, 10)
    expect(d.t).toBeCloseTo(stageShowT(m, m.rest))
    d.play()
    run(d, 120)
    expect(d.phase.k).toBe('idle')
    expect(d.t).toBe(1)
  })
})

describe('callout layout', () => {
  it('stacks boxes without overlap when there is room', () => {
    const c = stack([50, 52, 54, 300], [20, 20, 20, 20], 0, 400, 4)
    for (let i = 1; i < c.length; i++) expect(c[i] - c[i - 1]).toBeGreaterThanOrEqual(24 - 1e-9)
    expect(c[0]).toBeGreaterThanOrEqual(10)
    expect(c[3]).toBe(300)
  })

  it('keeps boxes inside the view', () => {
    const c = stack([395, 398], [20, 20], 0, 400, 4)
    expect(c[1] + 10).toBeLessThanOrEqual(400 + 1e-9)
    expect(c[1] - c[0]).toBeGreaterThanOrEqual(24 - 1e-9)
  })

  it('puts labels on the side of their anchors, inside the view', () => {
    const out = placeLabels(
      [
        { id: 'a', x: 100, y: 100, w: 60, h: 16, side: 0 },
        { id: 'b', x: 300, y: 120, w: 50, h: 16, side: 0 },
        { id: 'c', x: 210, y: 140, w: 50, h: 16, side: -1 },
      ],
      { w: 400, h: 300, pad: 6, padY: 20, gap: 4, mid: 200 },
    )
    const by = Object.fromEntries(out.map((o) => [o.id, o]))
    expect(by.a.side).toBe(-1)
    expect(by.a.bx).toBe(6)
    expect(by.b.side).toBe(1)
    expect(by.b.bx).toBe(400 - 6 - 50)
    // c sits just right of the middle but keeps its side (no flicker)
    expect(by.c.side).toBe(-1)
    for (const o of out) {
      expect(o.by).toBeGreaterThanOrEqual(20 - 1e-9)
      expect(o.by + 16).toBeLessThanOrEqual(280 + 1e-9)
    }
  })

  it('draws a slant then a level run, or one level line', () => {
    expect(leaderPath(100, 100, 200, 80)).toMatch(/^M[\d.,-]+L[\d.,-]+L200,80$/)
    expect(leaderPath(100, 100, 200, 100)).toMatch(/^M103.5,100L200,100$/)
    expect(leaderPath(100, 100, 50, 60)).toMatch(/L50,60$/)
  })
})
