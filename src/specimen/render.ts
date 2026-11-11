// Renders a specimen model as a vector-display wireframe:
//   1. an invisible skin writes depth (so lines behind a cap or stem are hidden),
//   2. visible lines glow with a brighter rim where the surface turns away,
//      fading with depth, with a slow scan band and a draw-in sweep,
//   3. the same lines again, a pixel over and fainter, so they read bolder,
//   4. hidden lines come back as faint dashes, like an engineering drawing.
// TUNE > WIREFRAMES scales all of it (setBrightness).
// The same class drives the SPECIMEN FILES viewer and the test gallery.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  GreaterDepth,
  Group,
  LessEqualDepth,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three'
import { Sketch, type Built } from './sketch'
import type { SpecimenModel } from './registry'
import { type Fit, fitModel } from './fit'

const VERT = /* glsl */ `
attribute vec3 aNormal;
attribute vec4 aInfo;
uniform float uNear;
uniform float uFar;
uniform float uScan;
uniform float uScanW;
uniform float uReveal;
uniform float uFocus;
uniform float uPulse;
uniform float uHidden;
uniform vec2 uShift;
varying float vB;
varying float vD;
varying float vDash;
varying float vY;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.xy += uShift * gl_Position.w;
  float b = aInfo.x;
  if (dot(aNormal, aNormal) > 0.01) {
    vec3 n = normalize(normalMatrix * aNormal);
    vec3 v = normalize(-mv.xyz);
    float f = 1.0 - abs(dot(n, v));
    b *= mix(0.62, 1.32, f * f);
  }
  float d = clamp((-mv.z - uNear) / max(0.001, uFar - uNear), 0.0, 1.0);
  b *= mix(1.05, 0.42, d);
  float s = (position.y - uScan) / uScanW;
  b += 0.55 * aInfo.x * exp(-s * s);
  if (uFocus > 0.5 && abs(aInfo.w - uFocus) < 0.5) b = b * (1.5 + 0.5 * uPulse) + 0.15;
  vB = b;
  vD = aInfo.y;
  vDash = aInfo.z;
  vY = position.y;
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGain;
uniform float uHidden;
uniform float uDashLen;
uniform float uReveal;
uniform float uRevealW;
varying float vB;
varying float vD;
varying float vDash;
varying float vY;
void main() {
  if (vY > uReveal) discard;
  float a = vB * uOpacity * uGain;
  float edge = 1.0 - clamp((uReveal - vY) / uRevealW, 0.0, 1.0);
  a += edge * 0.9;
  if (uHidden > 0.5) {
    if (vDash == 0.0) discard;
    a *= abs(vDash);
    if (mod(vD, uDashLen * 2.0) > uDashLen) discard;
  } else if (vDash < 0.0) {
    if (mod(vD, uDashLen * 1.6) > uDashLen) discard;
  }
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
}
`

function lineMaterial(hidden: boolean) {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new Color('#5dff8a') },
      uOpacity: { value: hidden ? 0.2 : 1 },
      uGain: { value: 1 },
      uShift: { value: new Vector2(0, 0) },
      uNear: { value: 1 },
      uFar: { value: 10 },
      uScan: { value: -1e3 },
      uScanW: { value: 1 },
      uReveal: { value: 1e6 },
      uRevealW: { value: 1 },
      uFocus: { value: 0 },
      uPulse: { value: 0 },
      uHidden: { value: hidden ? 1 : 0 },
      uDashLen: { value: 0.25 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: hidden ? GreaterDepth : LessEqualDepth,
    blending: AdditiveBlending,
  })
}

/** Growable GPU buffers, refilled each time the model is rebuilt. */
class Buffers {
  lines = new BufferGeometry()
  occ = new BufferGeometry()
  private cap = { l: 0, o: 0, i: 0 }
  load(b: Built) {
    const lv = b.lp.length / 3
    if (lv > this.cap.l) {
      this.cap.l = Math.ceil(lv * 1.3) + 64
      this.lines.setAttribute('position', new BufferAttribute(new Float32Array(this.cap.l * 3), 3))
      this.lines.setAttribute('aNormal', new BufferAttribute(new Float32Array(this.cap.l * 3), 3))
      this.lines.setAttribute('aInfo', new BufferAttribute(new Float32Array(this.cap.l * 4), 4))
    }
    const P = this.lines.getAttribute('position') as BufferAttribute
    const N = this.lines.getAttribute('aNormal') as BufferAttribute
    const I = this.lines.getAttribute('aInfo') as BufferAttribute
    ;(P.array as Float32Array).set(b.lp)
    ;(N.array as Float32Array).set(b.ln)
    ;(I.array as Float32Array).set(b.li)
    P.needsUpdate = N.needsUpdate = I.needsUpdate = true
    this.lines.setDrawRange(0, lv)
    const ov = b.op.length / 3
    const oi = b.oi.length
    if (ov > this.cap.o || oi > this.cap.i) {
      this.cap.o = Math.max(this.cap.o, Math.ceil(ov * 1.3) + 64)
      this.cap.i = Math.max(this.cap.i, Math.ceil(oi * 1.3) + 64)
      this.occ.setAttribute('position', new BufferAttribute(new Float32Array(this.cap.o * 3), 3))
      this.occ.setIndex(new BufferAttribute(new Uint32Array(this.cap.i), 1))
    }
    const OP = this.occ.getAttribute('position') as BufferAttribute
    ;(OP.array as Float32Array).set(b.op)
    OP.needsUpdate = true
    const IX = this.occ.getIndex()!
    ;(IX.array as Uint32Array).set(b.oi)
    IX.needsUpdate = true
    this.occ.setDrawRange(0, oi)
  }
  dispose() {
    this.lines.dispose()
    this.occ.dispose()
  }
}

export { type Fit, fitModel }

export interface ViewOpts {
  /** Horizontal room left for labels at each side (fraction of the width). */
  sideRoom: number
  /** Camera height above the specimen centre, as an angle (radians). */
  elev: number
  /** Extra camera height from dragging up or down (radians), on top of elev. */
  tilt?: number
}

/** Lowest and highest camera angle (radians): a little below the caps (to see the gills) up to nearly overhead. */
export const EL_MIN = -0.4
export const EL_MAX = 1.45
/** The drawing's own brightness at WIREFRAMES 100% (the first cut read too dim on a phone). */
export const BASE_GAIN = 1.6

/** How far back the camera must sit (vertically) to see a h tall, r wide specimen from angle el. */
export function fitDistance(h: number, r: number, el: number, tanV: number) {
  const c = Math.abs(Math.cos(el))
  const s = Math.abs(Math.sin(el))
  // a cylinder seen from el: its outline, plus room for the near side coming forward
  return ((h / 2) * c + r * s) / tanV + 0.7 * (r * c + (h / 2) * s)
}

export class SpecimenScene {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(30, 1, 0.1, 500)
  /** Turns about the vertical axis. */
  readonly turn = new Group()
  /** Holds the model, shifted so it turns about its own centre. */
  readonly inner = new Group()
  /** Used for drawing on this thread (the gallery, or when no worker is available). */
  readonly sk = new Sketch()
  private buf = new Buffers()
  private vis = lineMaterial(false)
  private bold = lineMaterial(false)
  private hid = lineMaterial(true)
  private boldLines: LineSegments
  private occMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 })
  fit: Fit | null = null
  model: SpecimenModel | null = null
  /** The drawing on screen now. */
  built: Built | null = null
  private parts = new Map<string, number>()
  t = -1
  aspect = 1
  view: ViewOpts = { sideRoom: 0, elev: 0.2 }

  constructor() {
    this.occMat.side = 2 // DoubleSide
    const occ = new Mesh(this.buf.occ, this.occMat)
    occ.renderOrder = 0
    occ.frustumCulled = false
    const lines = new LineSegments(this.buf.lines, this.vis)
    lines.renderOrder = 1
    lines.frustumCulled = false
    const bold = new LineSegments(this.buf.lines, this.bold)
    bold.renderOrder = 1
    bold.frustumCulled = false
    this.boldLines = bold
    const hidden = new LineSegments(this.buf.lines, this.hid)
    hidden.renderOrder = 2
    hidden.frustumCulled = false
    this.inner.add(occ, lines, bold, hidden)
    this.setBrightness(1)
    this.turn.add(this.inner)
    this.scene.add(this.turn)
  }

  setModel(model: SpecimenModel, detail: number, fit?: Fit) {
    this.model = model
    this.sk.detail = detail
    this.fit = fit ?? fitModel(model, detail)
    this.t = -1
    this.built = null
  }

  /** Draw growth point t here, on this thread. */
  setT(t: number, force = false) {
    if (!this.model) return
    if (!force && Math.abs(t - this.t) < 1e-5) return
    const d = this.sk.detail
    this.sk.reset()
    this.sk.detail = d
    if (this.fit) this.sk.axis = [this.fit.cx, this.fit.cz]
    this.model.build(this.sk, t)
    this.apply(this.sk.export(t))
  }

  /** Show a finished drawing (from setT or from the build worker). */
  apply(b: Built) {
    this.built = b
    this.t = b.t
    this.parts = new Map(b.parts)
    this.buf.load(b)
  }

  partId(name: string) {
    return this.parts.get(name) ?? -1
  }

  setColour(css: string) {
    const c = new Color(css)
    for (const m of this.mats) m.uniforms.uColor.value.copy(c)
  }

  private get mats() {
    return [this.vis, this.bold, this.hid]
  }

  setAspect(a: number) {
    this.aspect = a
    this.place()
  }

  /** The camera angle in use now: the stage's own, the slow bob, and any tilt from dragging. */
  elevation() {
    const el = this.view.elev + this.bob + (this.view.tilt ?? 0)
    return Math.min(EL_MAX, Math.max(EL_MIN, el))
  }

  /** Where the camera wants to be for the current drawing: distance and look height. */
  private want = { d: 30, y: 0, span: 10, h: 10 }
  private cur = { d: 30, y: 0, span: 10, h: 10 }
  /** Extra camera height (radians) added to view.elev, for the slow bob. */
  bob = 0

  private aim() {
    const f = this.fit
    const m = this.model
    if (!f || !m) return
    const b = this.built
    const ok = !!b && Number.isFinite(b.lo[1])
    // the specimen: its height range and how far it reaches from the turning axis
    let ylo = ok ? b!.lo[1] : 0
    let yhi = ok ? b!.hi[1] : 0
    let r = ok ? b!.rad : 0
    // never closer than the model's minimum frame
    if (m.frame) {
      const { c, r: fr, low = 0 } = m.frame
      // a small, low specimen: the sphere slides down toward it (never up)
      const yc = ok && low > 0 ? Math.min(c[1], Math.max(c[1] - low * fr, (ylo + yhi) / 2)) : c[1]
      ylo = Math.min(ylo, yc - fr)
      yhi = Math.max(yhi, yc + fr)
      r = Math.max(r, fr * 0.85)
    }
    r = Math.max(r, 0.5)
    const h = yhi - ylo
    const fov = (this.camera.fov * Math.PI) / 180
    const tanV = Math.tan(fov / 2)
    const tanH = Math.max(0.05, tanV * this.aspect * (1 - 2 * this.view.sideRoom))
    const el = this.view.elev + this.bob
    // a turning specimen fills a cylinder: its sides touch the view edges when seen from d
    const dH = (r * Math.sqrt(1 + tanH * tanH)) / tanH
    let dV = (h / 2 + r * Math.abs(Math.sin(el))) / tanV + r * Math.cos(el) * 0.7
    // tilted by hand: back off if the specimen needs more room from there, never come
    // closer; eased in over the first few degrees so the camera doesn't hop as a tilt starts
    const tilt = Math.abs(this.view.tilt ?? 0)
    if (tilt > 0.001) dV = Math.max(dV, dV + (fitDistance(h, r, this.elevation(), tanV) - dV) * Math.min(1, tilt / 0.15))
    const d = Math.max(dH, dV) * 1.04
    this.want = { d, y: (ylo + yhi) / 2, span: Math.max(r, h / 2), h }
  }

  /** Move the camera toward where it wants to be (dt in seconds; 0 = jump). */
  tick(dt: number) {
    this.aim()
    const k = dt <= 0 ? 1 : 1 - Math.exp(-dt / 0.55)
    const c = this.cur
    const w = this.want
    c.d += (w.d - c.d) * k
    c.y += (w.y - c.y) * k
    c.span += (w.span - c.span) * k
    c.h += (w.h - c.h) * k
    this.place()
  }

  frame() {
    this.tick(0)
  }

  private place() {
    const f = this.fit
    if (!f) return
    const cam = this.camera
    cam.aspect = this.aspect
    const c = this.cur
    const el = this.elevation()
    // the model sits so its turning axis passes through the origin; look at the middle height
    this.inner.position.set(-f.cx, -c.y, -f.cz)
    cam.position.set(0, Math.sin(el) * c.d, Math.cos(el) * c.d)
    cam.lookAt(0, 0, 0)
    cam.near = Math.max(0.1, c.d - c.span * 3)
    cam.far = c.d + c.span * 3
    cam.updateProjectionMatrix()
    // the bold pass sits about 0.8 px over and down, whatever the pixel density
    this.bold.uniforms.uShift.value.set(1.6 / Math.max(1, this.px.w), -1.6 / Math.max(1, this.px.h))
    for (const m of this.mats) {
      m.uniforms.uNear.value = c.d - c.span
      m.uniforms.uFar.value = c.d + c.span
      m.uniforms.uScanW.value = c.h * 0.035
      m.uniforms.uRevealW.value = c.h * 0.03
      m.uniforms.uDashLen.value = c.span * 0.02
    }
  }

  /** Scan band height (model space), or off. */
  setScan(y: number | null) {
    const v = y === null ? -1e6 : y
    for (const m of this.mats) m.uniforms.uScan.value = v
  }
  /** Draw-in sweep: lines above y are not drawn yet. */
  setReveal(y: number | null) {
    const v = y === null ? 1e6 : y
    for (const m of this.mats) m.uniforms.uReveal.value = v
  }
  setFocus(part: string | null, pulse: number) {
    const id = part ? this.partId(part) : -1
    for (const m of [this.vis, this.bold]) {
      m.uniforms.uFocus.value = id > 0 ? id : 0
      m.uniforms.uPulse.value = pulse
    }
  }
  /** Size of the drawing on screen in CSS pixels (for the bold pass). */
  px = { w: 460, h: 460 }
  /** Brightness of the whole drawing: 1 = WIREFRAMES 100%, from 0.5 to 2. */
  brightness = 1
  setBrightness(k: number) {
    this.brightness = k
    const b = Math.min(2, Math.max(0.5, Number.isFinite(k) ? k : 1))
    this.vis.uniforms.uGain.value = BASE_GAIN * b
    this.bold.uniforms.uGain.value = BASE_GAIN * b
    // the dashed far side follows more gently, so it stays behind the near side
    this.hid.uniforms.uGain.value = 0.75 + 0.5 * b
    // the bold pass comes in from 50% and is at full strength by 170%
    const w = Math.min(0.6, Math.max(0, (b - 0.5) * 0.5))
    this.bold.uniforms.uOpacity.value = w
    this.boldLines.visible = w > 0.01
  }

  /** Model-space point to pixel position in a w x h view (and whether it faces the camera). */
  project(p: [number, number, number], w: number, h: number, n?: [number, number, number]) {
    const v = new Vector3(p[0], p[1], p[2])
    this.inner.localToWorld(v)
    let facing = true
    if (n) {
      const nn = new Vector3(n[0], n[1], n[2]).transformDirection(this.inner.matrixWorld)
      const toCam = this.camera.position.clone().sub(v).normalize()
      facing = nn.dot(toCam) > -0.15
    }
    v.project(this.camera)
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, z: v.z, facing }
  }

  render(r: WebGLRenderer) {
    this.scene.updateMatrixWorld()
    r.render(this.scene, this.camera)
  }

  dispose() {
    this.buf.dispose()
    this.vis.dispose()
    this.bold.dispose()
    this.hid.dispose()
    this.occMat.dispose()
  }
}
