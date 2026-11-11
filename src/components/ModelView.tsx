// SPECIMEN FILES wireframe. A growth time-lapse of the specimen, drawn like a
// vector display and turning slowly, with square-line callouts that name its
// parts stage by stage. Drawings are built off the main thread
// (src/specimen/builder.ts); the time-lapse itself is src/specimen/director.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { WebGLRenderer } from 'three'
import { useApp } from '../settings/AppContext'
import { MODELS } from '../specimen/models'
import { EL_MAX, EL_MIN, SpecimenScene, fitModel } from '../specimen/render'
import { Builder } from '../specimen/builder'
import { Director } from '../specimen/director'
import { MARK, leaderPath, placeLabels, type LabelIn } from '../specimen/labels'
import { elevAt, stageAt, stageShowT, type SpecimenModel } from '../specimen/registry'
import { anatomyFor, type LabelText } from '../data/anatomy'
import { TypedRows, type Row } from './TypedRows'
import type { Species } from '../data/species/types'

/** Shown if a note has no textbook sentence (none do today); the fact ids still apply. */
const LOCKED = 'NO TEXTBOOK SENTENCE ON FILE FOR THIS YET. THE SOURCE IDS STILL APPLY.'
/** Turning speed in radians a second: one turn about every 21 s. */
const TURN = 0.3
/** Radians of turn and of tilt for each pixel dragged. A finger only turns it:
 * swiping up or down over the picture scrolls the page, so a phone never gets stuck. */
const DRAG_TURN = 0.011
const DRAG_TILT = 0.008
/** One press of a tilt button (radians, about 15°). */
const TILT_STEP = 0.26
/** Two taps this close together (ms) set the tilt back to the stage's own angle. */
const DOUBLE_TAP = 350
/** A press that wanders less than this (px) from where it started is a tap; fingers wobble more than a mouse. */
const TAP_SLOP_TOUCH = 10
const TAP_SLOP = 5
const TAGS_KEY = 'mycol.specimen.labels'
/** How far above its anchor a label would like to sit (px). */
const KINK = 16

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const pad2 = (n: number) => String(n).padStart(2, '0')
const readColour = () => getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#5dff8a'

function loadTagsPref() {
  try {
    return localStorage.getItem(TAGS_KEY) !== 'off'
  } catch {
    return true
  }
}
function saveTagsPref(on: boolean) {
  try {
    localStorage.setItem(TAGS_KEY, on ? 'on' : 'off')
  } catch {
    // private mode: the choice lasts until the page closes
  }
}

/** A callout's place on screen, eased frame to frame. */
interface Tag {
  a: number
  side: -1 | 0 | 1
  bx: number
  by: number
  placed: boolean
  w: number
  h: number
}

interface Engine {
  r: WebGLRenderer
  sc: SpecimenScene
  b: Builder
  d: Director | null
  id: string
  detail: number
  slowMs: number
  lastDrop: number
  spin: number
  swing: number
  drag: number
  /** Extra camera height from dragging up or down, or the tilt buttons (radians). */
  tilt: number
  /** Where the tilt is easing to: a tilt button press, or 0 (the stage's own angle) after a double tap. */
  tiltGoal: number | null
  dragging: boolean
  /** A drawing of this species is on screen. */
  shown: boolean
  /** Height range of the whole drawing (block and bag too), for the sweeps. */
  yLo: number
  yHi: number
  dataOn: boolean
  W: number
  H: number
  colW: number
  /** Camera height now (radians), easing toward the stage's own angle. */
  elev: number
  measure: boolean
  tags: Map<string, Tag>
  visible: boolean
  colour: string
  stage: number
  playing: boolean
}

/** Everything the frame loop reads from the latest render. */
interface Live {
  model: SpecimenModel | undefined
  labels: LabelText[]
  tagsOn: boolean
  /** TUNE > WIREFRAMES. */
  bright: number
  focus: string | null
  hover: string | null
  reduced: boolean
  sound: ReturnType<typeof useApp>['sound']
  onStage: (i: number) => void
  onPlaying: (p: boolean) => void
  onTap: () => void
}

function detailRows(x: { a?: string; v?: string; s?: string[] } | undefined, none: string): Row[] {
  if (!x) return [{ id: 'none', value: none }]
  const out: Row[] = []
  if (x.a) out.push({ id: 'a', label: 'DRAWING', value: x.a })
  if (x.v !== undefined) out.push({ id: 'v', label: 'TEXTBOOK', value: x.v === '' ? LOCKED : x.v, why: x.s?.length ? { s: x.s } : null })
  else if (x.s?.length) out.push({ id: 'v', label: 'TEXTBOOK', value: 'SEE THE SOURCES.', why: { s: x.s } })
  return out
}

/**
 * The species wireframe. It opens on the picking picture, then plays the
 * growth time-lapse round and round: each stage holds while its callouts are
 * up. PLAY/PAUSE, the stage keys and the growth bar take over by hand; a callout
 * lights up its part and fills the readout. Drag to turn it (a mouse also tilts
 * it); the tilt buttons show it from higher or lower on any device.
 */
export function ModelView({ sp }: { sp: Species }) {
  const { settings, sound } = useApp()
  const clean = settings.look.clean
  const model = MODELS[sp.id] as SpecimenModel | undefined
  const anat = anatomyFor(sp.id)
  const labels = useMemo(() => anat?.labels ?? [], [anat])
  const restIdx = model ? Math.max(0, model.stages.findIndex((s) => s.id === model.rest)) : 0

  const [failed, setFailed] = useState(false)
  const [stage, setStage] = useState(restIdx)
  const [playing, setPlaying] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [tagsOn, setTagsOn] = useState(loadTagsPref)
  /** The readout's stage (it follows the time-lapse unless the user picked one). */
  const [read, setRead] = useState(restIdx)
  /** The readout heading that should type itself out (the user asked for it); others show at once. */
  const [typeKey, setTypeKey] = useState<string | null>(null)
  // a new species starts on its own picking picture (reset here, before anything reads the old stage)
  const [forId, setForId] = useState(sp.id)
  if (forId !== sp.id) {
    setForId(sp.id)
    setStage(restIdx)
    setRead(restIdx)
    setFocus(null)
    setHover(null)
    setTypeKey(null)
  }

  const stageEl = useRef<HTMLDivElement>(null)
  const glEl = useRef<HTMLDivElement>(null)
  const scrubEl = useRef<HTMLInputElement>(null)
  const trackEl = useRef<HTMLDivElement>(null)
  const hudT = useRef<HTMLSpanElement>(null)
  const hudYaw = useRef<HTMLSpanElement>(null)
  const hudEl = useRef<HTMLSpanElement>(null)
  const tagEls = useRef(new Map<string, HTMLButtonElement>())
  const lineEls = useRef(new Map<string, SVGGElement>())
  const eng = useRef<Engine | null>(null)
  /** Follow the stage in the readout (playing or scrubbing), or keep what the user picked. */
  const follow = useRef(true)

  const live = useRef<Live>(null as unknown as Live)
  live.current = {
    model,
    labels,
    tagsOn,
    bright: settings.look.models ?? 1,
    focus,
    hover,
    reduced: reducedMotion(),
    sound,
    onStage: (i) => {
      setStage(i)
      if (follow.current) setRead(i)
    },
    onPlaying: setPlaying,
    onTap: () => setFocus(null),
  }

  // the renderer, the scene, the build worker and the frame loop: once per mount
  useEffect(() => {
    const host = stageEl.current
    const gl = glEl.current
    if (!host || !gl) return
    let r: WebGLRenderer
    try {
      r = new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    setFailed(false)
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    r.setClearColor(0x000000, 0)
    gl.appendChild(r.domElement)
    const small = Math.min(screen.width, screen.height) < 600 || (navigator.hardwareConcurrency || 8) <= 4
    const E: Engine = {
      r,
      sc: new SpecimenScene(),
      b: new Builder(),
      d: null,
      id: '',
      detail: small ? 0.7 : 1,
      slowMs: 0,
      lastDrop: 0,
      spin: -0.5,
      swing: 0,
      drag: 0,
      tilt: 0,
      tiltGoal: null,
      dragging: false,
      shown: false,
      yLo: 0,
      yHi: 1,
      dataOn: false,
      W: 1,
      H: 1,
      colW: 90,
      elev: 0.22,
      measure: true,
      tags: new Map(),
      visible: true,
      colour: readColour(),
      stage: -1,
      playing: false,
    }
    E.sc.setColour(E.colour)
    eng.current = E
    if (import.meta.env.DEV) (window as unknown as { __mv: Engine }).__mv = E

    E.b.onBuilt = (id, b) => {
      if (id !== E.id) return
      E.sc.apply(b)
      let lo = Infinity
      let hi = -Infinity
      const p = b.lp
      for (let i = 1; i < p.length; i += 3) {
        const y = p[i]
        if (y < lo) lo = y
        if (y > hi) hi = y
      }
      if (lo < hi) {
        E.yLo = lo
        E.yHi = hi
      }
      if (!E.shown) {
        E.shown = true
        E.sc.frame()
      }
      // level of detail: when growth frames come too slowly, draw a little less
      if (E.d?.phase.k === 'grow') {
        E.slowMs = E.slowMs * 0.75 + E.b.lastMs * 0.25
        const now = performance.now()
        if (E.slowMs > 130 && E.detail > 0.45 && now - E.lastDrop > 3000) {
          E.detail = Math.round((E.detail - 0.15) * 100) / 100
          E.lastDrop = now
        }
      }
    }

    const size = () => {
      const w = Math.max(1, host.clientWidth)
      const h = Math.max(1, host.clientHeight)
      E.W = w
      E.H = h
      r.setSize(w, h, false)
      E.sc.px = { w, h }
      E.sc.setAspect(w / h)
      // labels wrap inside this width
      host.style.setProperty('--colw', `${Math.round(Math.min(132, Math.max(70, w * 0.22)))}px`)
      E.measure = true
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(host)
    const io = new IntersectionObserver((es) => {
      for (const e of es) E.visible = e.isIntersecting
    })
    io.observe(host)

    // drag sideways to turn, up or down (mouse or pen) to tilt; a tap on the picture
    // clears a lit callout, and a double tap sets the tilt back to the stage's own angle
    let lastX = 0
    let lastY = 0
    let startX = 0
    let startY = 0
    let moved = 0
    let pid = -1
    let lastTap = -1e9
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return
      E.dragging = true
      E.tiltGoal = null
      lastX = startX = e.clientX
      lastY = startY = e.clientY
      moved = 0
      pid = e.pointerId
      try {
        host.setPointerCapture(e.pointerId)
      } catch {
        // pointer already gone
      }
      host.classList.add('drag')
    }
    const move = (e: PointerEvent) => {
      if (!E.dragging || e.pointerId !== pid) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY))
      E.drag += dx * DRAG_TURN
      // the picture follows the pointer: drag down and the top of the specimen comes into view
      if (e.pointerType !== 'touch') E.tilt = Math.min(EL_MAX - E.elev, Math.max(EL_MIN - E.elev, E.tilt + dy * DRAG_TILT))
    }
    const up = (e: PointerEvent) => {
      if (!E.dragging || e.pointerId !== pid) return
      E.dragging = false
      host.classList.remove('drag')
      if (moved < (e.pointerType === 'touch' ? TAP_SLOP_TOUCH : TAP_SLOP) && e.type === 'pointerup') {
        live.current.onTap()
        if (e.timeStamp - lastTap < DOUBLE_TAP) {
          E.tiltGoal = 0
          lastTap = -1e9
        } else lastTap = e.timeStamp
      }
    }
    host.addEventListener('pointerdown', down)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', up)
    host.addEventListener('pointercancel', up)

    const tagOf = (id: string) => {
      let t = E.tags.get(id)
      if (!t) E.tags.set(id, (t = { a: 0, side: 0, bx: 0, by: 0, placed: false, w: 80, h: 18 }))
      return t
    }
    const hideTag = (id: string, t: Tag) => {
      const el = tagEls.current.get(id)
      const g = lineEls.current.get(id)
      if (el && el.style.visibility !== 'hidden') {
        el.style.visibility = 'hidden'
        el.style.opacity = '0'
      }
      if (g) g.setAttribute('opacity', '0')
      t.placed = false
    }

    let raf = 0
    let last = performance.now()
    let time = 0
    let colourIn = 1
    let hudIn = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      if (!E.visible || document.hidden) return
      const L = live.current
      const d = E.d
      const m = L.model
      if (!d || !m) return
      time += dt
      // a theme change shows up here within a second
      if ((colourIn -= dt) <= 0) {
        colourIn = 1
        const c = readColour()
        if (c !== E.colour) {
          E.colour = c
          E.sc.setColour(c)
        }
      }

      // the time-lapse, and the drawing it needs
      d.step(dt, E.shown ? E.sc.t : null)
      for (const ev of d.drain()) {
        if (ev === 'draw-in' && !E.dataOn) {
          L.sound.beginData()
          E.dataOn = true
        } else if (ev === 'drawn' && E.dataOn) {
          L.sound.endData()
          E.dataOn = false
        }
      }
      E.b.request(m.id, d.t, E.detail)

      // sweeps
      const rv = d.reveal
      if (!E.shown) E.sc.setReveal(-1e6)
      else if (rv === null) E.sc.setReveal(null)
      else {
        const span = E.yHi - E.yLo
        const mg = span * 0.04 + 0.05
        E.sc.setReveal(E.yLo - mg + rv * (span + 2 * mg))
      }

      // turning: side-fruiting specimens swing to and fro so the block never hides them
      if (!L.reduced && !E.dragging) {
        if (m.swing) E.swing += (dt * TURN) / m.swing
        else E.spin += dt * TURN
      }
      const yaw = (m.swing ? m.swing * Math.sin(E.swing) + (L.reduced ? 0.35 : 0) : E.spin) + E.drag
      E.sc.turn.rotation.y = yaw
      E.sc.bob = L.reduced ? 0 : 0.035 * Math.sin(time * 0.31)
      // a tilt button or a double tap eases the tilt to its goal; the limits follow the stage's own angle
      const tLo = EL_MIN - E.elev
      const tHi = EL_MAX - E.elev
      if (E.tiltGoal !== null) {
        const g = Math.min(tHi, Math.max(tLo, E.tiltGoal))
        E.tilt += (g - E.tilt) * Math.min(1, dt / 0.25)
        if (Math.abs(g - E.tilt) < 0.002) {
          E.tilt = g
          E.tiltGoal = null
        }
      }
      E.tilt = Math.min(tHi, Math.max(tLo, E.tilt))
      E.sc.view.tilt = E.tilt
      if (L.bright !== E.sc.brightness) E.sc.setBrightness(L.bright)

      // a slow scan band down the specimen
      const b = E.sc.built
      if (!L.reduced && b && rv === null && Number.isFinite(b.lo[1]) && b.hi[1] > b.lo[1]) {
        const s = (time % 7.5) / 1.9
        E.sc.setScan(s < 1 ? b.hi[1] - s * (b.hi[1] - b.lo[1]) : null)
      } else E.sc.setScan(null)

      // a lit callout pulses its part
      const lit = L.focus ?? L.hover
      const part = lit ? (L.labels.find((x) => x.id === lit)?.part ?? null) : null
      E.sc.setFocus(part, L.focus ? 0.5 + 0.5 * Math.sin(time * 4.2) : 0.1)

      // room for the label columns (labels may just touch the widest reach of the turn)
      // the widest label in this stage sets the room (they may just touch the widest reach of the turn)
      const sid0 = m.stages[stageAt(m, d.t)].id
      let colW = 0
      if (L.tagsOn) for (const lab of L.labels) if (lab.on.includes(sid0)) colW = Math.max(colW, tagOf(lab.id).w)
      E.colW += (colW - E.colW) * Math.min(1, dt / 0.5)
      E.sc.view.sideRoom = E.colW > 1 ? Math.min(0.3, (E.colW * 0.85 + 10) / E.W) : 0.02
      // the camera rises over a block top and comes down to see a cluster side on;
      // while nothing is drawn (before the first drawing, or the loop's reset) it jumps
      const hidden = d.phase.k === 'start' || d.phase.k === 'reset'
      const el = elevAt(m, d.t)
      E.elev = hidden ? el : E.elev + (el - E.elev) * Math.min(1, dt / 0.6)
      E.sc.view.elev = E.elev
      if (hidden) E.sc.frame()
      else E.sc.tick(dt)
      E.sc.render(E.r)

      // callouts: square marker on the anchor, leader, label in the side column
      const W = E.W
      const H = E.H
      if (E.measure) {
        E.measure = false
        for (const [id, el] of tagEls.current) {
          const t = tagOf(id)
          t.w = el.offsetWidth || t.w
          t.h = el.offsetHeight || t.h
        }
      }
      const si = stageAt(m, d.t)
      const sid = m.stages[si].id
      const items: LabelIn[] = []
      const at = new Map<string, { x: number; y: number; facing: boolean }>()
      const ease = Math.min(1, dt / 0.2)
      for (const lab of L.labels) {
        const t = tagOf(lab.id)
        const an = b?.anchors[lab.at ?? lab.id]
        let want = L.tagsOn && E.shown && !d.sweeping && !!an && lab.on.includes(sid)
        let p: { x: number; y: number; z: number; facing: boolean } | null = null
        if (an) {
          p = E.sc.project(an.p, W, H, an.n)
          if (p.z > 1 || p.x < 4 || p.x > W - 4 || p.y < 4 || p.y > H - 4) want = false
        }
        t.a += ((want ? 1 : 0) - t.a) * ease
        if (!p || t.a < 0.02) {
          hideTag(lab.id, t)
          continue
        }
        at.set(lab.id, p)
        // labels sit a little above their anchors, so each leader has its 45° slant
        items.push({ id: lab.id, x: p.x, y: p.y - KINK, w: t.w, h: t.h, side: t.side })
      }
      const k = Math.min(1, dt / 0.16)
      for (const o of placeLabels(items, { w: W, h: H, pad: 6, padY: 20, gap: 5, mid: W / 2 })) {
        const t = tagOf(o.id)
        const p = at.get(o.id)!
        const el = tagEls.current.get(o.id)
        const g = lineEls.current.get(o.id)
        if (!el || !g) continue
        if (!t.placed || (t.side !== 0 && o.side !== t.side)) {
          // new, or crossing to the other column: jump there and fade in, never slide over the drawing
          if (t.placed) t.a = Math.min(t.a, 0.15)
          t.bx = o.bx
          t.by = o.by
          t.placed = true
        } else {
          t.bx += (o.bx - t.bx) * k
          t.by += (o.by - t.by) * k
        }
        t.side = o.side
        el.style.transform = `translate(${t.bx.toFixed(1)}px,${t.by.toFixed(1)}px)`
        el.style.opacity = t.a.toFixed(3)
        if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
        const ex = t.bx + (t.bx + t.w / 2 < p.x ? t.w : 0)
        const ey = t.by + t.h / 2
        const rect = g.firstElementChild as SVGRectElement
        const path = g.lastElementChild as SVGPathElement
        rect.setAttribute('x', (p.x - MARK).toFixed(1))
        rect.setAttribute('y', (p.y - MARK).toFixed(1))
        path.setAttribute('d', leaderPath(p.x, p.y, ex, ey))
        const isLit = lit === o.id
        g.setAttribute('opacity', (t.a * (p.facing || isLit ? 1 : 0.55)).toFixed(3))
        g.setAttribute('class', `${p.facing ? '' : 'back'}${isLit ? ' lit' : ''}`)
      }

      // the growth bar follows the time-lapse
      trackEl.current?.style.setProperty('--pct', `${(d.t * 100).toFixed(2)}%`)
      if ((hudIn -= dt) <= 0) {
        hudIn = 0.1
        const s = scrubEl.current
        if (s && document.activeElement !== s) s.value = String(Math.round(d.t * 1000))
        if (hudT.current) hudT.current.textContent = `${String(Math.round(d.t * 100)).padStart(3, '0')}%`
        if (hudYaw.current) hudYaw.current.textContent = `${String(Math.round((((yaw * 180) / Math.PI) % 360) + 360) % 360).padStart(3, '0')}°`
        if (hudEl.current) hudEl.current.textContent = `${Math.round((E.sc.elevation() * 180) / Math.PI)}°`
      }
      if (si !== E.stage) {
        E.stage = si
        L.onStage(si)
      }
      if (d.playing !== E.playing) {
        E.playing = d.playing
        L.onPlaying(d.playing)
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      if (E.dataOn) live.current.sound.endData()
      ro.disconnect()
      io.disconnect()
      host.removeEventListener('pointerdown', down)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', up)
      host.removeEventListener('pointercancel', up)
      E.b.dispose()
      E.sc.dispose()
      r.dispose()
      r.domElement.remove()
      eng.current = null
    }
  }, [])

  // a new species: new model, start again from the picking picture
  useEffect(() => {
    const E = eng.current
    if (!E || !model) return
    if (E.dataOn) {
      sound.endData()
      E.dataOn = false
    }
    E.id = model.id
    E.sc.setModel(model, E.detail, fitModel(model))
    E.d = new Director(model, { autoplay: true, reduced: reducedMotion() })
    E.shown = false
    E.tags.clear()
    E.measure = true
    E.stage = -1
    E.playing = !E.d.playing
    E.spin = -0.5
    E.swing = 0
    E.drag = 0
    E.tilt = 0
    E.tiltGoal = null
    E.elev = elevAt(model, E.d.t)
    E.sc.view.elev = E.elev
    E.slowMs = 0
    E.sc.setReveal(-1e6)
    E.b.request(model.id, E.d.t, E.detail)
    follow.current = true
    setFocus(null)
    setHover(null)
    setRead(restIdx)
    setTypeKey(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.id, failed])

  // labels shown or hidden change the column sizes
  useEffect(() => {
    if (eng.current) eng.current.measure = true
  }, [tagsOn, sp.id])

  const N = model?.stages.length ?? 0
  const director = () => eng.current?.d ?? null

  const pickStage = (i: number) => {
    if (!model) return
    const d = director()
    sound.chirp()
    follow.current = false
    if (d) {
      d.pause()
      d.seek(stageShowT(model, model.stages[i].id))
    }
    setPlaying(false)
    setFocus(null)
    setRead(i)
    setTypeKey(`s-${model.stages[i].id}`)
  }
  const togglePlay = () => {
    const d = director()
    if (!d) return
    sound.chirp()
    if (d.playing) d.pause()
    else {
      follow.current = true
      setFocus(null)
      setRead(stage)
      setTypeKey(null)
      d.play()
    }
    setPlaying(d.playing)
  }
  const pickTag = (id: string) => {
    const d = director()
    sound.chirp()
    if (focus === id) {
      setFocus(null)
      return
    }
    follow.current = false
    d?.pause()
    setPlaying(false)
    setFocus(id)
    setTypeKey(`l-${id}`)
  }
  const scrub = (v: number) => {
    const d = director()
    if (!d) return
    follow.current = true
    d.seek(v / 1000, true)
    setPlaying(false)
    setFocus(null)
  }
  /** A tilt button: one step higher (+1) or lower (-1); quick presses add up. */
  const tiltStep = (dir: 1 | -1) => {
    const E = eng.current
    if (!E) return
    sound.chirp()
    const from = E.tiltGoal ?? E.tilt
    E.tiltGoal = Math.min(EL_MAX - E.elev, Math.max(EL_MIN - E.elev, from + dir * TILT_STEP))
  }
  const toggleTags = () => {
    sound.chirp()
    setTagsOn((on) => {
      saveTagsPref(!on)
      return !on
    })
    setFocus(null)
  }

  const focused = focus ? labels.find((l) => l.id === focus) : undefined
  const rows = useMemo<Row[]>(() => {
    if (!model) return []
    if (focused) {
      const n = labels.indexOf(focused) + 1
      return [{ id: `l-${focused.id}`, label: `PART ${pad2(n)}`, value: focused.k, head: true }, ...detailRows(focused, 'NO NOTES FOR THIS PART YET.')]
    }
    const ri = Math.min(read, N - 1)
    const st = model.stages[ri]
    const tx = anat?.stages.find((s) => s.id === st.id)
    const out: Row[] = [{ id: `s-${st.id}`, label: `STAGE ${pad2(ri + 1)}/${pad2(N)}`, value: tx?.k ?? st.id.toUpperCase(), head: true }, ...detailRows(tx, 'NO NOTES FOR THIS STAGE YET.')]
    if (anat?.note) out.push({ id: 'note', label: 'NOTE', value: anat.note })
    return out
  }, [model, anat, focused, labels, read, N])
  const instant = !rows.length || rows[0].id !== typeKey

  if (!model)
    return (
      <div className="mv">
        <div className="mv-stage">
          <div className="dim model-fail">NO WIREFRAME ON FILE FOR {sp.name}</div>
        </div>
      </div>
    )

  const stageName = (i: number) => {
    const st = model.stages[Math.max(0, Math.min(i, N - 1))]
    return anat?.stages.find((s) => s.id === st.id)?.k ?? st.id.toUpperCase()
  }
  const si = Math.max(0, Math.min(stage, N - 1))
  return (
    <div className={`mv ${clean ? 'clean' : ''}`}>
      <div ref={stageEl} className="mv-stage">
        <div ref={glEl} className="mv-gl" role="img" aria-label={`Wireframe of ${sp.name}, growth stage ${si + 1} of ${N}: ${stageName(si)}. Drag to turn it; the tilt buttons show it from higher or lower.`} />
        <svg className="mv-lines" aria-hidden>
          {labels.map((l) => (
            <g
              key={`${sp.id}:${l.id}`}
              opacity="0"
              ref={(el) => {
                if (el) lineEls.current.set(l.id, el)
                else lineEls.current.delete(l.id)
              }}
            >
              <rect width={MARK * 2} height={MARK * 2} className="mk" />
              <path className="ld" />
            </g>
          ))}
        </svg>
        <div className="mv-tags">
          {labels.map((l) => (
            <button
              key={`${sp.id}:${l.id}`}
              type="button"
              className={`mv-tag ${focus === l.id ? 'on' : ''}`}
              style={{ visibility: 'hidden', opacity: 0 }}
              aria-pressed={focus === l.id}
              data-tip={`${l.k}: light it up on the drawing and read about it below.`}
              ref={(el) => {
                if (el) tagEls.current.set(l.id, el)
                else tagEls.current.delete(l.id)
              }}
              onClick={() => pickTag(l.id)}
              onPointerEnter={() => setHover(l.id)}
              onPointerLeave={() => setHover((h) => (h === l.id ? null : h))}
              onFocus={() => setHover(l.id)}
              onBlur={() => setHover((h) => (h === l.id ? null : h))}
            >
              {l.k}
            </button>
          ))}
        </div>
        <div className="mv-hud tl" aria-hidden>
          GROWTH <span ref={hudT}>000%</span>
        </div>
        <div className="mv-hud tr" aria-hidden>
          STAGE {pad2(si + 1)}/{pad2(N)}
        </div>
        <div className="mv-hud bl" aria-hidden>
          AXIS <span ref={hudYaw}>000°</span> ELEV <span ref={hudEl}>0°</span>
        </div>
        <div className="mv-hud br" aria-hidden>
          DRAG TO TURN // ▲▼ TILT
        </div>
        <i className="mv-corner a" aria-hidden />
        <i className="mv-corner b" aria-hidden />
        <i className="mv-corner c" aria-hidden />
        <i className="mv-corner d" aria-hidden />
        {failed && <div className="dim model-fail">3D NOT AVAILABLE ON THIS DEVICE</div>}
      </div>

      <div className="mv-bar" hidden={failed}>
        <button type="button" className="mv-btn mv-play" onClick={togglePlay} aria-pressed={playing} data-tip="Play or pause the growth time-lapse.">
          <i aria-hidden className={playing ? 'ic-pause' : 'ic-play'} />
          {playing ? 'PAUSE' : 'PLAY'}
        </button>
        <div ref={trackEl} className="mv-track" style={{ ['--pct' as string]: `${stageShowT(model, model.rest) * 100}%` }}>
          <span className="mv-fill" />
          {model.stages.map((s, i) =>
            i === 0 ? null : <i key={s.id} className="mv-tick" style={{ left: `${s.at * 100}%` }} />,
          )}
          <span className="mv-head" />
          <input
            ref={scrubEl}
            type="range"
            min={0}
            max={1000}
            step={10}
            defaultValue={Math.round(stageShowT(model, model.rest) * 1000)}
            aria-label="Growth time-lapse position"
            data-tip="Drag through the growth of the specimen."
            onChange={(e) => scrub(Number(e.currentTarget.value))}
          />
        </div>
        <span className="mv-tilt" role="group" aria-label="Tilt the view">
          <button type="button" className="mv-btn" onClick={() => tiltStep(1)} aria-label="Tilt up" data-tip="See the specimen from higher up. Double-tap the picture to level it again.">
            ▲
          </button>
          <button type="button" className="mv-btn" onClick={() => tiltStep(-1)} aria-label="Tilt down" data-tip="See the specimen from lower down. Double-tap the picture to level it again.">
            ▼
          </button>
        </span>
        <button type="button" className={`mv-btn ${tagsOn ? 'on' : ''}`} aria-pressed={tagsOn} onClick={toggleTags} data-tip="Show or hide the callout labels.">
          LABELS
        </button>
      </div>
      <div className="mv-chips" role="group" aria-label="Growth stages">
        {model.stages.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`mv-chip ${i === si ? 'sel' : ''}`}
            aria-current={i === si ? 'step' : undefined}
            onClick={() => pickStage(i)}
            data-tip={`Go to stage ${i + 1}: ${stageName(i)}.`}
          >
            <span className="n">{pad2(i + 1)}</span>
            {stageName(i)}
          </button>
        ))}
      </div>
      <div className="mv-read" onClick={(e) => !(e.target as HTMLElement).closest('button') && setTypeKey(null)}>
        <TypedRows rows={rows} instant={instant} />
      </div>
    </div>
  )
}
