// MY/CO/L sound engine. Every sound is made here in code with Web Audio;
// there are no sound files.
//
// The rule (Joseph, 5 Nov 2026): sound follows the screen. Nothing in here
// plays on its own timer except the quiet room hum (and the optional ambience
// layer, off by default). Everything else is called by a component at the
// moment something appears on screen:
//   typeChar()            - one character typed onto the screen
//   beginData()/endData() - a data animation starts / stops (columns, wireframes)
//   droneOn()/droneOff()  - a screen is "working" (boot, long jobs)
//   swoop()               - the screen powers on
//   chirp()               - the screen changes
//   confirm()             - a menu appears or a command is accepted
//   granted()             - access granted / record saved
//   whoosh()              - login, or entering CORE
//   warble()              - the PROCESSING indicator shows
//   alarm(true|false)     - the ALERT flash is on screen
// Starting values come from the measured reference tracks (see the plan doc),
// tuned by ear here. They are our own sounds, not copies.

import type { SoundSettings } from '../settings/settings'

type Layer = 'typing' | 'chatter' | 'drone' | 'hum' | 'signals' | 'warble' | 'glitch' | 'ambience'
const LAYERS: Layer[] = ['typing', 'chatter', 'drone', 'hum', 'signals', 'warble', 'glitch', 'ambience']

// How loud each layer can get at slider = 1. Kept low: the reference track
// sits around -51 dB, and this runs all day.
const LAYER_SCALE: Record<Layer, number> = {
  typing: 0.22,
  chatter: 0.16,
  drone: 0.07,
  hum: 0.09,
  signals: 0.22,
  warble: 0.08,
  glitch: 0.12,
  ambience: 0.18,
}

// Blip pitches for typing and chatter: a fixed set between 900 Hz and 2.5 kHz.
const BLIP_SET = [900, 990, 1100, 1210, 1340, 1480, 1630, 1800, 1980, 2200, 2500]
// TICK mode clusters (second reference track): ~500-900 Hz, 1-1.5 kHz, ~3.6 kHz.
const TICK_SET = [560, 680, 820, 1050, 1200, 1420, 3600]

export type GlitchListener = (ms: number) => void

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

export class SoundEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private duck: GainNode | null = null // used for glitch dropouts
  private bus = {} as Record<Layer, GainNode>
  private noise: AudioBuffer | null = null
  private settings: SoundSettings

  private humNodes: AudioNode[] = []
  private ambienceNodes: AudioNode[] = []
  private droneGain: GainNode | null = null
  private droneOscs: OscillatorNode[] = []
  private droneHolds = 0
  private chatterHolds = 0
  private chatterTimer: number | null = null
  private chatterNext = 0
  private alarmTimer: number | null = null
  private lastBlip = 0
  private lastTickLine = -1
  private lastFeedLine = -1
  private printing = 0
  private glitchListeners = new Set<GlitchListener>()

  constructor(settings: SoundSettings) {
    this.settings = settings
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  /**
   * Browsers only allow sound after a full tap (click) or key press, so call
   * this from one. Resolves once sound is actually running (or after 800 ms),
   * so the boot can wait for it and its first sounds aren't lost.
   */
  unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return Promise.resolve()
      const ctx = new Ctx()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.duck = ctx.createGain()
      // A gentle limiter so stacked layers never clip a phone speaker.
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.ratio.value = 6
      this.master.connect(this.duck).connect(comp).connect(ctx.destination)
      for (const l of LAYERS) {
        const g = ctx.createGain()
        g.connect(this.master)
        this.bus[l] = g
      }
      const len = ctx.sampleRate * 2
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      // When sound starts running (now or later), start whatever the screen
      // already asked for: hum, drone, chatter.
      ctx.onstatechange = () => {
        if (ctx.state === 'running') this.onRunning()
      }
      this.apply(this.settings)
    }
    const ctx = this.ctx
    // iPhones only unlock sound when something actually plays inside the tap,
    // so play one silent sample right now.
    try {
      const silent = ctx.createBufferSource()
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      silent.connect(ctx.destination)
      silent.start()
    } catch {
      // ignore
    }
    if (ctx.state === 'running') return Promise.resolve()
    const resumed = ctx.resume().catch(() => undefined)
    const timeout = new Promise<void>((r) => window.setTimeout(r, 800))
    return Promise.race([resumed, timeout]).then(() => undefined)
  }

  private onRunning() {
    this.apply(this.settings)
    if (this.droneHolds > 0 && !this.droneGain) this.buildDrone()
  }

  /** Apply new slider values. Called whenever settings change. */
  apply(s: SoundSettings): void {
    this.settings = s
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const t = ctx.currentTime
    this.master.gain.setTargetAtTime(s.enabled ? s.master : 0, t, 0.05)
    for (const l of LAYERS) {
      let level = s[l] * LAYER_SCALE[l]
      if (l === 'ambience' && !s.ambienceOn) level = 0
      if (l === 'glitch' && !s.glitchOn) level = 0
      this.bus[l].gain.setTargetAtTime(level, t, 0.05)
    }
    if (s.enabled) this.startHum()
    else this.stopHum()
    if (s.enabled && s.ambienceOn) this.startAmbience()
    else this.stopAmbience()
    if (!s.enabled) {
      this.stopChatterLoop()
      this.alarm(false)
    } else {
      if (this.chatterHolds > 0) this.startChatterLoop()
      if (this.droneHolds > 0 && !this.droneGain) this.buildDrone()
    }
  }

  onGlitch(fn: GlitchListener): () => void {
    this.glitchListeners.add(fn)
    return () => this.glitchListeners.delete(fn)
  }

  private live(): AudioContext | null {
    return this.ctx && this.settings.enabled && this.ctx.state === 'running' ? this.ctx : null
  }

  // ---------- building blocks ----------

  private env(g: GainNode, t: number, peak: number, attack: number, hold: number, release: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setValueAtTime(peak, t + attack + hold)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
  }

  private tone(
    layer: Layer,
    type: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    peak: number,
    opts: { to?: number; filter?: number; attack?: number } = {},
  ) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur)
    let out: AudioNode = o
    if (opts.filter) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = opts.filter
      o.connect(f)
      out = f
    }
    out.connect(g).connect(this.bus[layer])
    const attack = opts.attack ?? 0.004
    this.env(g, t, peak, attack, Math.max(0, dur - attack - 0.02), 0.02)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private noiseBurst(layer: Layer, t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, q = 0.8) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    src.connect(f).connect(g).connect(this.bus[layer])
    this.env(g, t, peak, 0.003, Math.max(0, dur - 0.01), 0.01)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
  }

  // ---------- text typing ----------

  /** Mark that text is printing (glitches only happen while text prints). */
  printBegin(): void {
    this.printing++
  }
  printEnd(): void {
    this.printing = Math.max(0, this.printing - 1)
  }

  /**
   * One step of text has just appeared on screen. `line` keeps the voice steady
   * per line; `group` is how many characters landed in this step (3+ = a long
   * readout, which sounds like a printer rather than a keyboard).
   */
  typeChar(ch: string, line: number, charIndex: number, group = 1): void {
    const ctx = this.live()
    if (!ctx || ch.trim() === '') return
    const t = ctx.currentTime
    if (this.settings.mode === 'TICK') {
      // TICK: one blip per line of output, not per character.
      if (line !== this.lastTickLine || charIndex === 0) {
        this.lastTickLine = line
        this.tick(t)
      }
      return
    }
    // Long fast readouts: cap at ~30 hits a second so it stays a texture.
    if (t - this.lastBlip < 0.033) return
    this.lastBlip = t
    if (this.settings.typingVoice === 'CLACK') {
      // Paper advance (line feed) as each new line starts.
      if (line !== this.lastFeedLine && line < 98) {
        this.lastFeedLine = line
        if (charIndex > 0 || line > 0) this.lineFeed(t)
      }
      if (group >= 3) this.printerRasp(t + 0.004, line)
      else this.keyClack(t, line)
      this.maybeGlitch(t)
      return
    }
    const base = (line * 7 + 3) % BLIP_SET.length
    const idx = Math.min(BLIP_SET.length - 1, Math.max(0, base + Math.floor(rand(-2, 3))))
    const f = BLIP_SET[idx] * rand(0.985, 1.015)
    this.tone('typing', 'square', f, t, rand(0.018, 0.032), 0.5, { filter: 3800, attack: 0.002 })
    this.maybeGlitch(t)
  }

  // ---------- the CLACK voice ----------
  // Chonky and clacky (Joseph, 5 Nov 2026): a heavy mechanical keyboard, a
  // typewriter, a scantron reader and an 80s tractor-feed printer. Built from
  // filtered noise hits with fast decays, plus a short falling thump.

  /** A noise hit with a sharp start and an exponential decay. */
  private hit(t: number, peak: number, decay: number, type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.0008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.0008 + decay * 4)
    src.connect(f).connect(g).connect(this.bus.typing)
    src.start(t, Math.random() * 1.8)
    src.stop(t + decay * 4 + 0.02)
  }

  /** One key: switch click, metal strike, then the heavy bottom-out thock. */
  private keyClack(t: number, line: number) {
    const lineShift = 1 + ((line * 5) % 7) * 0.025 // each line sits a little differently
    // Switch click: bright and very short.
    this.hit(t, 0.55, 0.004, 'highpass', rand(2800, 4200), 0.7)
    // Typebar / plate strike: a short metallic ring.
    this.hit(t + 0.002, 1.4, rand(0.012, 0.02), 'bandpass', rand(1150, 1650) * lineShift, 7)
    // Bottom-out thock a few ms later (key travel), with a falling thump.
    const th = t + rand(0.004, 0.009)
    this.hit(th, 2.4, rand(0.03, 0.045), 'bandpass', rand(170, 250) * lineShift, 2.2)
    this.tone('typing', 'sine', rand(150, 175), th, 0.045, 0.55, { to: 70, attack: 0.001 })
    // Sometimes the spring rattles on the way back up.
    if (Math.random() < 0.3) this.hit(t + rand(0.018, 0.03), 0.22, 0.004, 'bandpass', rand(2200, 3200), 3)
  }

  /** Long readouts: a dot-matrix head rasp (a burst of tiny pin hits ~600/s) with a soft platen knock. */
  private printerRasp(t: number, line: number) {
    const pins = 8 + Math.floor(Math.random() * 7)
    const gap = rand(0.0014, 0.0019)
    const f = (2000 + ((line * 3) % 5) * 180) * rand(0.97, 1.03)
    for (let i = 0; i < pins; i++) this.hit(t + i * gap, rand(0.25, 0.4), 0.0018, 'bandpass', f, 3)
    this.hit(t, 0.7, 0.02, 'bandpass', rand(260, 340), 2)
    if (Math.random() < 0.25) this.keyClack(t + pins * gap + 0.004, line)
  }

  /** Scantron / tractor-feed paper advance: a quick ratchet and a low thud. */
  private lineFeed(t: number) {
    for (let i = 0; i < 3; i++) this.hit(t + i * 0.016, 0.35, 0.006, 'bandpass', rand(850, 1050), 4)
    this.hit(t + 0.05, 0.9, 0.035, 'lowpass', 140, 0.8)
  }

  private tick(t: number) {
    const f = pick(TICK_SET)
    const dur = rand(0.03, 0.09)
    this.tone('typing', f > 3000 ? 'sine' : 'square', f, t, dur, 0.45, { filter: 4500 })
  }

  // ---------- data chatter ----------

  /** A data animation has started on screen. Pair every call with endData(). */
  beginData(): void {
    this.chatterHolds++
    if (this.chatterHolds === 1) this.startChatterLoop()
  }

  endData(): void {
    this.chatterHolds = Math.max(0, this.chatterHolds - 1)
    if (this.chatterHolds === 0) this.stopChatterLoop()
  }

  private startChatterLoop() {
    if (this.chatterTimer !== null || !this.live()) return
    this.chatterNext = this.ctx!.currentTime + 0.02
    // Look-ahead scheduler: every 25 ms, schedule the pulses due in the next 100 ms.
    this.chatterTimer = window.setInterval(() => this.chatterTickLoop(), 25)
  }

  private stopChatterLoop() {
    if (this.chatterTimer !== null) {
      window.clearInterval(this.chatterTimer)
      this.chatterTimer = null
    }
  }

  private chatterTickLoop() {
    const ctx = this.live()
    if (!ctx) return
    while (this.chatterNext < ctx.currentTime + 0.1) {
      const t = this.chatterNext
      if (this.settings.mode === 'TICK') {
        // Sparse: about one tick a second, sometimes a run of 3-4 at 0.16 s.
        if (Math.random() < 0.25) {
          const n = 3 + Math.floor(Math.random() * 2)
          for (let i = 0; i < n; i++) this.tick(t + i * 0.16)
          this.chatterNext = t + n * 0.16 + rand(0.7, 1.2)
        } else {
          this.tick(t)
          this.chatterNext = t + rand(0.7, 1.3)
        }
        continue
      }
      // CHATTER: buzzy pulses 8-12 a second with stacked harmonics and a little hiss.
      const f = pick(BLIP_SET)
      const dur = rand(0.035, 0.085)
      this.tone('chatter', 'square', f, t, dur, 0.55, { filter: 5000 })
      this.tone('chatter', 'sawtooth', f * 2.01, t, dur * 0.8, 0.12, { filter: 7000 })
      if (Math.random() < 0.35) this.noiseBurst('chatter', t, dur * 0.6, 0.18, 'highpass', 4000)
      // Mostly steady gating, with the odd short gap so it reads as bursts.
      this.chatterNext = t + (Math.random() < 0.08 ? rand(0.25, 0.45) : rand(0.083, 0.125))
    }
  }

  // ---------- drone ----------

  /** A screen is working. Pair with droneOff(). */
  droneOn(): void {
    this.droneHolds++
    this.buildDrone()
  }

  private buildDrone(): void {
    const ctx = this.live()
    if (!ctx) return
    if (!this.droneGain) {
      const g = ctx.createGain()
      g.gain.value = 0.0001
      g.connect(this.bus.drone)
      const a = ctx.createOscillator()
      a.type = 'triangle'
      a.frequency.value = 279
      const b = ctx.createOscillator()
      b.type = 'sine'
      b.frequency.value = 541
      const bg = ctx.createGain()
      bg.gain.value = 0.6
      a.connect(g)
      b.connect(bg).connect(g)
      a.start()
      b.start()
      this.droneGain = g
      this.droneOscs = [a, b]
    }
    this.droneGain.gain.cancelScheduledValues(ctx.currentTime)
    this.droneGain.gain.setTargetAtTime(1, ctx.currentTime, 0.45)
  }

  droneOff(): void {
    this.droneHolds = Math.max(0, this.droneHolds - 1)
    if (this.droneHolds > 0 || !this.ctx || !this.droneGain) return
    const t = this.ctx.currentTime
    const g = this.droneGain
    const oscs = this.droneOscs
    g.gain.cancelScheduledValues(t)
    g.gain.setTargetAtTime(0.0001, t, 0.5)
    this.droneGain = null
    this.droneOscs = []
    for (const o of oscs) o.stop(t + 3)
  }

  // ---------- room hum and ambience (the only steady sounds) ----------

  private startHum() {
    const ctx = this.ctx
    if (!ctx || this.humNodes.length) return
    const g = ctx.createGain()
    g.gain.value = 1
    g.connect(this.bus.hum)
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.07 // slow volume drift
    lfoGain.gain.value = 0.25
    lfo.connect(lfoGain).connect(g.gain)
    const freqs: [number, OscillatorType, number][] = [
      [108, 'sine', 0.5],
      [111.5, 'sine', 0.45],
      [217, 'sine', 0.12],
    ]
    const nodes: AudioNode[] = [g, lfo]
    for (const [f, type, level] of freqs) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      const og = ctx.createGain()
      og.gain.value = level
      o.connect(og).connect(g)
      o.start()
      nodes.push(o)
    }
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 180
    const ng = ctx.createGain()
    ng.gain.value = 0.35
    n.connect(lp).connect(ng).connect(g)
    n.start()
    lfo.start()
    nodes.push(n)
    this.humNodes = nodes
  }

  private stopHum() {
    for (const n of this.humNodes) {
      if (n instanceof AudioScheduledSourceNode) n.stop()
      n.disconnect()
    }
    this.humNodes = []
  }

  private startAmbience() {
    const ctx = this.ctx
    if (!ctx || this.ambienceNodes.length) return
    const out = ctx.createGain()
    out.connect(this.bus.ambience)
    // Sub rumble 50-80 Hz.
    const r = ctx.createBufferSource()
    r.buffer = this.noise
    r.loop = true
    const rl = ctx.createBiquadFilter()
    rl.type = 'lowpass'
    rl.frequency.value = 80
    const rg = ctx.createGain()
    rg.gain.value = 1.4
    r.connect(rl).connect(rg).connect(out)
    const sub = ctx.createOscillator()
    sub.frequency.value = 58
    const sg = ctx.createGain()
    sg.gain.value = 0.25
    sub.connect(sg).connect(out)
    // Ventilation hiss, broadband but soft, with a faint tone near 400 Hz.
    const h = ctx.createBufferSource()
    h.buffer = this.noise
    h.loop = true
    const hb = ctx.createBiquadFilter()
    hb.type = 'bandpass'
    hb.frequency.value = 5000
    hb.Q.value = 0.3
    const hg = ctx.createGain()
    hg.gain.value = 0.06
    h.connect(hb).connect(hg).connect(out)
    const t4 = ctx.createOscillator()
    t4.frequency.value = 402
    const t4g = ctx.createGain()
    t4g.gain.value = 0.015
    t4.connect(t4g).connect(out)
    r.start(0, 0.3)
    h.start(0, 1.1)
    sub.start()
    t4.start()
    this.ambienceNodes = [out, r, sub, h, t4]
  }

  private stopAmbience() {
    for (const n of this.ambienceNodes) {
      if (n instanceof AudioScheduledSourceNode) n.stop()
      n.disconnect()
    }
    this.ambienceNodes = []
  }

  // ---------- one-shot signals, each tied to a screen event ----------

  /** The screen powers on (boot). A low swoop. */
  swoop(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(38, t)
    o.frequency.exponentialRampToValueAtTime(190, t + 0.7)
    o.frequency.exponentialRampToValueAtTime(55, t + 1.6)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(200, t)
    f.frequency.exponentialRampToValueAtTime(900, t + 0.7)
    f.frequency.exponentialRampToValueAtTime(150, t + 1.6)
    const g = ctx.createGain()
    o.connect(f).connect(g).connect(this.bus.signals)
    this.env(g, t, 0.55, 0.25, 0.6, 0.8)
    o.start(t)
    o.stop(t + 1.8)
    this.noiseBurst('signals', t + 0.1, 1.2, 0.08, 'bandpass', 600, 0.6)
    // Two short high chirps as the raster settles.
    this.tone('signals', 'sine', 2900, t + 1.25, 0.05, 0.25, { to: 3300 })
    this.tone('signals', 'sine', 3100, t + 1.38, 0.05, 0.2, { to: 3500 })
  }

  /** The screen changes. A short high chirp under the wipe line. */
  chirp(): void {
    const ctx = this.live()
    if (!ctx) return
    this.tone('signals', 'sine', 2800, ctx.currentTime, 0.06, 0.22, { to: 3400 })
  }

  /** A menu appears or a command is accepted. About 2 kHz, ~250 ms. */
  confirm(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone('signals', 'sine', 2000, t, 0.26, 0.4, { attack: 0.008 })
    this.tone('signals', 'sine', 3700, t, 0.26, 0.06, { attack: 0.008 })
    this.tone('signals', 'sine', 1400, t, 0.26, 0.05, { attack: 0.008 })
  }

  /** Access granted / record saved. A rising chirp, about 250 to 600 Hz. */
  granted(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    this.tone('signals', 'triangle', 250, t, 0.12, 0.5, { to: 420 })
    this.tone('signals', 'triangle', 420, t + 0.13, 0.14, 0.5, { to: 600 })
  }

  /** Login or entering CORE. A heavy mechanical whoosh. */
  whoosh(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 0.9
    f.frequency.setValueAtTime(180, t)
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.45)
    f.frequency.exponentialRampToValueAtTime(260, t + 1.3)
    const g = ctx.createGain()
    src.connect(f).connect(g).connect(this.bus.signals)
    this.env(g, t, 0.7, 0.2, 0.3, 0.9)
    src.start(t)
    src.stop(t + 1.5)
    this.tone('signals', 'sine', 70, t, 0.5, 0.6, { to: 42, attack: 0.02 })
  }

  /** The PROCESSING indicator is on screen. ~3 kHz with a 15 Hz wobble, 0.7 s. */
  warble(dur = 0.7): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.frequency.value = 3000
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 15
    const lg = ctx.createGain()
    lg.gain.value = 70
    lfo.connect(lg).connect(o.frequency)
    const g = ctx.createGain()
    o.connect(g).connect(this.bus.warble)
    this.env(g, t, 0.6, 0.02, dur - 0.08, 0.06)
    o.start(t)
    lfo.start(t)
    o.stop(t + dur + 0.05)
    lfo.stop(t + dur + 0.05)
  }

  /** The ALERT flash is on screen: two alternating tones until switched off. */
  alarm(on: boolean): void {
    if (!on) {
      if (this.alarmTimer !== null) window.clearInterval(this.alarmTimer)
      this.alarmTimer = null
      return
    }
    if (this.alarmTimer !== null || !this.live()) return
    let hi = true
    const beat = () => {
      const ctx = this.live()
      if (!ctx) return
      this.tone('signals', 'square', hi ? 1400 : 1050, ctx.currentTime, 0.32, 0.22, { filter: 3000, attack: 0.01 })
      hi = !hi
    }
    beat()
    this.alarmTimer = window.setInterval(beat, 380)
  }

  // ---------- glitches ----------

  /** Rare dropouts and crackle, only while text is printing, always with a visual glitch. */
  private maybeGlitch(t: number) {
    if (!this.settings.glitchOn || this.printing === 0) return
    if (Math.random() > 0.0025 * (0.5 + this.settings.glitch)) return
    this.glitch(t)
  }

  /** Fire one glitch now: a hard cut to silence or a crackle, at random unless asked. */
  glitch(at?: number, kind?: 'cut' | 'crackle'): void {
    const ctx = this.live()
    if (!ctx || !this.duck) return
    const t = at ?? ctx.currentTime
    const ms = rand(50, 200)
    if ((kind ?? (Math.random() < 0.5 ? 'cut' : 'crackle')) === 'cut') {
      // Hard cut to silence.
      this.duck.gain.setValueAtTime(0, t)
      this.duck.gain.setValueAtTime(1, t + ms / 1000)
    } else {
      // Crackle burst.
      for (let i = 0; i < 5; i++) this.noiseBurst('glitch', t + (i * ms) / 5000, ms / 7000, rand(0.3, 0.8), 'highpass', rand(1500, 6000))
    }
    for (const fn of this.glitchListeners) fn(ms)
  }

  /**
   * TUNE's TEST GLITCH: one crackle at the GLITCH level, even while glitches are
   * switched off, and without switching them on. Always the crackle: the other
   * kind is a cut to silence, which would sound like nothing happened.
   */
  testGlitch(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    const g = this.bus.glitch.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(this.settings.glitch * LAYER_SCALE.glitch, t)
    if (!this.settings.glitchOn) g.setValueAtTime(0, t + 0.5)
    this.glitch(t + 0.01, 'crackle')
  }
}
