// The time-lapse director: where the growth line is now (t), what plays next,
// and the wipes between loops. Nothing is drawn here, so it can be tested alone.
//
//   start     waiting for the first drawing (the picking picture)
//   wipe-in   the drawing sweeps in from the bottom
//   intro     the picking picture holds for a few seconds
//   wipe-out  the drawing sweeps away from the top
//   reset     waiting for the drawing at t = 0
//   grow      t runs on to the next stage picture
//   hold      a stage picture holds (its labels stay up)
//   seek      t eases to a stage the user picked
//   idle      paused
import { type SpecimenModel, stageShowT } from './registry'

/** Growth line per second while playing (about 13 s from cut to the end). */
export const GROW_SPEED = 0.075
export const INTRO_S = 3.6
export const WIPE_IN_S = 0.95
export const WIPE_OUT_S = 0.5
export const HOLD_S = 1.3
export const END_HOLD_S = 1.8

export type Phase =
  | { k: 'start'; then: 'intro' | 'idle' }
  | { k: 'wipe-in'; p: number; then: 'intro' | 'play' | 'idle'; first: boolean }
  | { k: 'intro'; left: number }
  | { k: 'wipe-out'; p: number }
  | { k: 'reset' }
  | { k: 'grow'; to: number }
  | { k: 'hold'; left: number; end: boolean }
  | { k: 'seek'; to: number }
  | { k: 'idle' }

/** 'draw-in' and 'drawn' bracket the first sweep (the data sound runs between them). */
export type DirectorEvent = 'draw-in' | 'drawn' | 'loop'

export interface DirectorOpts {
  /** Start the time-lapse by itself after the first picture. */
  autoplay: boolean
  /** Reduced motion: no sweeps, no easing, nothing starts by itself. */
  reduced: boolean
}

const EPS = 1e-4

export class Director {
  t: number
  phase: Phase
  /** Stage pictures in order, then the end of the line. */
  readonly targets: number[]
  /** Seconds each target holds. */
  readonly holds: number[]
  private events: DirectorEvent[] = []

  constructor(
    readonly model: SpecimenModel,
    readonly opts: DirectorOpts,
  ) {
    this.targets = model.stages.map((s) => stageShowT(model, s.id))
    this.holds = model.stages.map((s) => Math.max(1, s.hold ?? HOLD_S))
    if (this.targets[this.targets.length - 1] < 1 - 1e-3) {
      this.targets.push(1)
      this.holds.push(END_HOLD_S)
    } else this.holds[this.holds.length - 1] = Math.max(this.holds[this.holds.length - 1], END_HOLD_S)
    this.t = this.restT
    this.phase = { k: 'start', then: opts.autoplay && !opts.reduced ? 'intro' : 'idle' }
  }

  /** The picking picture: shown first, and whenever nothing plays. */
  get restT() {
    return stageShowT(this.model, this.model.rest)
  }

  /** True while the time-lapse runs by itself. */
  get playing() {
    const p = this.phase
    switch (p.k) {
      case 'start':
        return p.then === 'intro'
      case 'wipe-in':
        return p.then !== 'idle'
      case 'seek':
      case 'idle':
        return false
      default:
        return true
    }
  }

  /** How much of the drawing shows, bottom up (0..1), or null for all of it. */
  get reveal(): number | null {
    const p = this.phase
    if (p.k === 'start' || p.k === 'reset') return 0
    if (p.k === 'wipe-in') return p.p
    if (p.k === 'wipe-out') return 1 - p.p
    return null
  }

  /** True while a sweep is on or a drawing is awaited (labels stay down). */
  get sweeping() {
    return this.reveal !== null
  }

  /** Events since the last call (in order). */
  drain(): DirectorEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  /** The next stage picture after t, or -1 past the last one. */
  nextTarget(t: number) {
    return this.targets.findIndex((x) => x > t + EPS)
  }

  /**
   * Advance by dt seconds. `shown` is the growth point of the drawing on screen
   * (null before the first one): holds only count down once it has caught up.
   */
  step(dt: number, shown: number | null) {
    const caught = shown !== null && Math.abs(shown - this.t) < 1e-5
    const p = this.phase
    switch (p.k) {
      case 'start':
        if (!caught) return
        if (this.opts.reduced) this.phase = { k: 'idle' }
        else {
          this.phase = { k: 'wipe-in', p: 0, then: p.then, first: true }
          this.events.push('draw-in')
        }
        return
      case 'wipe-in':
        p.p = Math.min(1, p.p + dt / WIPE_IN_S)
        if (p.p >= 1) {
          if (p.first) this.events.push('drawn')
          if (p.then === 'intro') this.phase = { k: 'intro', left: INTRO_S }
          else if (p.then === 'play') this.goNext()
          else this.phase = { k: 'idle' }
        }
        return
      case 'intro':
        if (caught) p.left -= dt
        if (p.left <= 0) this.phase = { k: 'wipe-out', p: 0 }
        return
      case 'wipe-out':
        p.p = Math.min(1, p.p + dt / WIPE_OUT_S)
        if (p.p >= 1) {
          this.t = 0
          this.phase = { k: 'reset' }
          this.events.push('loop')
        }
        return
      case 'reset':
        if (!caught) return
        if (this.opts.reduced) this.goNext()
        else this.phase = { k: 'wipe-in', p: 0, then: 'play', first: false }
        return
      case 'grow':
        this.t = Math.min(p.to, this.t + GROW_SPEED * dt)
        if (this.t >= p.to - 1e-9) {
          this.t = p.to
          const i = this.targets.indexOf(p.to)
          this.phase = { k: 'hold', left: this.holds[i] ?? HOLD_S, end: i === this.targets.length - 1 }
        }
        return
      case 'hold':
        if (caught) p.left -= dt
        if (p.left <= 0) {
          // at the end: loop round (with reduced motion, stop there)
          if (!p.end) this.goNext()
          else if (this.opts.reduced) this.phase = { k: 'idle' }
          else this.loop()
        }
        return
      case 'seek': {
        const d = p.to - this.t
        const step = Math.max(Math.abs(d) * (1 - Math.exp(-dt / 0.16)), 0.3 * dt)
        if (Math.abs(d) <= step || Math.abs(d) < 0.002) {
          this.t = p.to
          this.phase = { k: 'idle' }
        } else this.t += Math.sign(d) * step
        return
      }
      case 'idle':
        return
    }
  }

  /** Back to the start of the growth line: swept away first, or at once with reduced motion. */
  private loop() {
    if (this.opts.reduced) {
      this.t = 0
      this.phase = { k: 'reset' }
      this.events.push('loop')
    } else this.phase = { k: 'wipe-out', p: 0 }
  }

  private goNext() {
    const i = this.nextTarget(this.t)
    if (i >= 0) this.phase = { k: 'grow', to: this.targets[i] }
    else this.loop()
  }

  /** Run the time-lapse on from where it is (from the start again if at the end). */
  play() {
    if (this.playing) return
    const p = this.phase
    if (p.k === 'wipe-in') {
      p.then = 'play'
      return
    }
    if (p.k === 'start') {
      p.then = 'intro'
      return
    }
    this.goNext()
  }

  /** Stop where it is. A sweep in progress finishes, so the drawing is never left half shown. */
  pause() {
    const p = this.phase
    switch (p.k) {
      case 'start':
        p.then = 'idle'
        return
      case 'wipe-in':
        p.then = 'idle'
        return
      case 'reset':
        // the drawing at 0 is on its way: sweep it in, then stop
        this.phase = this.opts.reduced ? { k: 'idle' } : { k: 'wipe-in', p: 0, then: 'idle', first: false }
        return
      case 'wipe-out':
        // stop the sweep and keep the picture that was going
        this.phase = { k: 'idle' }
        return
      case 'intro':
      case 'grow':
      case 'hold':
      case 'seek':
        this.phase = { k: 'idle' }
        return
      case 'idle':
        return
    }
  }

  /** Go to a growth point the user picked: eased, or at once (scrubbing, reduced motion). */
  seek(to: number, instant = false) {
    const x = Math.min(1, Math.max(0, to))
    const p = this.phase
    if (p.k === 'start') {
      // the first drawing is not here yet: start from the picked point instead
      this.t = x
      p.then = 'idle'
      return
    }
    if (p.k === 'reset' || p.k === 'wipe-in' || p.k === 'wipe-out') {
      // a sweep is on: drop it and go straight there
      this.t = x
      this.phase = { k: 'idle' }
      return
    }
    if (instant || this.opts.reduced) {
      this.t = x
      this.phase = { k: 'idle' }
    } else this.phase = { k: 'seek', to: x }
  }
}
