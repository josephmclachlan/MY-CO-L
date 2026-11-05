import { useEffect, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, OrthographicCamera, Scene, WebGLRenderer } from 'three'
import { useApp } from '../settings/AppContext'

/**
 * The MY/CO/L logo: an original wireframe globe that turns slowly, crossed by a
 * band carrying the wordmark, with a mushroom-and-hypha emblem rising from it.
 * The globe is Three.js lines; the band, emblem and text are SVG on top.
 * It draws itself in with data chatter for exactly as long as it is drawing.
 * Respects reduced motion (globe holds still).
 */

/** Globe line segments (pairs of vertices) on a unit sphere: parallels and meridians. */
function globeSegments(): Float32Array {
  const v: number[] = []
  const seg = 48
  const ring = (f: (t: number) => [number, number, number]) => {
    for (let i = 0; i < seg; i++) {
      v.push(...f((i / seg) * Math.PI * 2), ...f(((i + 1) / seg) * Math.PI * 2))
    }
  }
  for (let k = -3; k <= 3; k++) {
    const lat = (k / 4) * (Math.PI / 2)
    ring((t) => [Math.cos(lat) * Math.cos(t), Math.sin(lat), Math.cos(lat) * Math.sin(t)])
  }
  for (let m = 0; m < 8; m++) {
    const a = (m / 8) * Math.PI
    ring((t) => [Math.cos(t) * Math.cos(a), Math.sin(t), Math.cos(t) * Math.sin(a)])
  }
  return new Float32Array(v)
}

export function Wireframe({ size = 200, drawMs = 1600, instant }: { size?: number; drawMs?: number; instant?: boolean }) {
  const { sound, settings } = useApp()
  const host = useRef<HTMLDivElement>(null)
  const theme = settings.look.theme

  useEffect(() => {
    if (instant) return
    sound.beginData()
    const t = window.setTimeout(() => sound.endData(), drawMs)
    return () => {
      window.clearTimeout(t)
      sound.endData()
    }
  }, [instant, drawMs, sound])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // no WebGL: the SVG emblem and wordmark still show
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;'

    const scene = new Scene()
    const camera = new OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10)
    camera.position.set(0, 0, 4)
    const group = new Group()
    group.rotation.x = new URLSearchParams(window.location.search).get('logo') === 'a' ? 0.5 : 0.3 // tilt so the parallels read as ellipses
    scene.add(group)
    const pos = globeSegments()
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#5dff8a'
    const mat = new LineBasicMaterial({ color: colour, transparent: true, opacity: 0.85 })
    group.add(new LineSegments(geo, mat))

    const w = el.clientWidth || size
    renderer.setSize(w, el.clientHeight || size, false)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const total = pos.length / 3
    const t0 = performance.now()
    let last = t0
    let raf = 0
    geo.setDrawRange(0, instant ? total : 0)
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!instant) {
        const frac = Math.min(1, (now - t0) / drawMs)
        geo.setDrawRange(0, Math.floor((total / 2) * frac) * 2)
      }
      if (!reduce) group.rotation.y += dt * 0.3 // one slow turn about every 21 s
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      geo.dispose()
      mat.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [instant, drawMs, size, theme])

  const variant = (() => {
    try {
      return new URLSearchParams(window.location.search).get('logo') ?? ''
    } catch {
      return ''
    }
  })()
  const h = Math.round(size * 1.0)
  return (
    <div
      className={`logo ${variant ? `logo-${variant}` : ''} ${instant ? 'wire-static' : ''}`}
      style={{ ['--draw' as string]: `${drawMs}ms`, width: size * 1.3, height: h }}
      role="img"
      aria-label="MY/CO/L logo: a turning wireframe globe with a mushroom emblem, Black Flag Fungi Corp"
    >
      <div ref={host} className="logo-globe" />
      <svg className="wire logo-svg" viewBox="0 0 260 200" aria-hidden="true">
        {/* band across the globe, masked so the globe lines stop at its edges */}
        <rect className="logo-band" x="14" y="58" width="232" height="34" pathLength={1} />
        {variant === 'b' ? (
          <g>
            <polygon className="logo-cap" pathLength={1} points="130,14 156,29 156,50 130,65 104,50 104,29" />
            <text className="logo-mono" x="130" y="46" textAnchor="middle">BFF</text>
          </g>
        ) : variant === 'c' ? (
          <g>
            <path pathLength={1} d="M106 62 V14" />
            <path className="logo-cap" pathLength={1} d="M106 16 C120 10 128 22 142 16 C150 13 156 16 160 18 V44 C154 41 148 39 142 42 C128 48 120 36 106 42 Z" />
            <path pathLength={1} d="M120 40 C119 29 125 24 133 24 C141 24 147 29 146 40 Z M133 40 V34" />
          </g>
        ) : (
          <g>
            <path className="logo-cap" pathLength={1} d="M104 58 C104 22 156 22 156 58 Z" />
            <path pathLength={1} d="M114 58 C112 44 120 32 130 29 M130 58 V29 M146 58 C148 44 140 32 130 29" />
          </g>
        )}
        {variant === 'a' && <path pathLength={1} d="M14 52 H246 M14 98 H246" />}
        {variant === 'a' && (
          <g>
            <path className="logo-cap" pathLength={1} d="M104 52 C104 18 156 18 156 52 Z" />
            <path pathLength={1} d="M114 52 C112 38 120 26 130 23 M130 52 V23 M146 52 C148 38 140 26 130 23" />
          </g>
        )}
        <text className="logo-corp" x="130" y="80" textAnchor="middle">BLACK FLAG FUNGI CORP</text>
        <text className="logo-word" x="130" y="172" textAnchor="middle">MY/CO/L</text>
        <text className="logo-tag" x="130" y="193" textAnchor="middle">THE LATTICE HOLDS</text>
      </svg>
    </div>
  )
}
