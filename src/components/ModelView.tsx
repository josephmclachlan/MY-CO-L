import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { useApp } from '../settings/AppContext'
import { buildModel } from '../specimen/models'
import type { Species } from '../data/species/types'

/**
 * Line-only 3D wireframe of a species. It turns slowly all the time (drag to
 * spin it by hand). When a new species is shown the lines draw in, with data
 * chatter for exactly as long as they are drawing. Clean mode drops the glow.
 */
export function ModelView({ sp }: { sp: Species }) {
  const { settings, sound } = useApp()
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const clean = settings.look.clean
  const theme = settings.look.theme

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    setFailed(false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:pan-y;'

    const scene = new Scene()
    const camera = new PerspectiveCamera(36, 1, 0.1, 20)
    camera.position.set(0, 0.5, 3.6)
    camera.lookAt(0, 0, 0)
    const group = new Group()
    group.rotation.x = 0.18
    scene.add(group)

    const pos = buildModel(sp.form, sp.seed, sp.id)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    const total = pos.length / 3
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#5dff8a'
    const mat = new LineBasicMaterial({ color: colour, transparent: true, opacity: clean ? 1 : 0.92 })
    group.add(new LineSegments(geo, mat))

    const size = () => {
      const w = el.clientWidth || 200
      const h = el.clientHeight || 200
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(el)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let drawn = 0
    const DRAW_MS = 1100
    const t0 = performance.now()
    let drawing = true
    sound.beginData()
    geo.setDrawRange(0, 0)

    let last = t0
    let raf = 0
    let yawDrag = 0
    let dragging = false
    let lastX = 0
    const down = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      yawDrag += (e.clientX - lastX) * 0.012
      lastX = e.clientX
    }
    const up = () => (dragging = false)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (drawing) {
        // segments are 2 vertices each; reveal in whole segments
        const frac = Math.min(1, (now - t0) / DRAW_MS)
        drawn = Math.floor((total / 2) * frac) * 2
        geo.setDrawRange(0, drawn)
        if (frac >= 1) {
          drawing = false
          geo.setDrawRange(0, total)
          sound.endData()
        }
      }
      if (!reduce) group.rotation.y += dt * 0.35 // one slow turn about every 18 s
      group.rotation.y += yawDrag
      yawDrag = 0
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      if (drawing) sound.endData()
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      geo.dispose()
      mat.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // theme and clean change the colour and glow; rebuild is cheap
  }, [sp.id, sp.form, sp.seed, clean, theme, sound])

  return (
    <div ref={host} className={`model-view ${clean ? 'clean' : ''}`} role="img" aria-label={`Rotating wireframe of ${sp.name}`}>
      {failed && <div className="dim model-fail">3D NOT AVAILABLE ON THIS DEVICE</div>}
    </div>
  )
}
