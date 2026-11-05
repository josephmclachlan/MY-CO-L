import { useEffect, useRef } from 'react'
import { useApp } from '../settings/AppContext'

/**
 * The MY/CO/L mark drawn as a line-art wireframe: a hex lattice cell with a
 * branching hypha. It draws itself in, with data chatter for exactly as long
 * as the lines are drawing.
 */
export function Wireframe({ size = 200, drawMs = 1600, instant }: { size?: number; drawMs?: number; instant?: boolean }) {
  const { sound } = useApp()
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (instant) return
    sound.beginData()
    const t = window.setTimeout(() => sound.endData(), drawMs)
    return () => {
      window.clearTimeout(t)
      sound.endData()
    }
  }, [instant, drawMs, sound])

  const hex = (cx: number, cy: number, r: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
    }).join(' ')

  // Lattice: a ring of small cells around the main one.
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i
    return hex(100 + 86 * Math.cos(a), 100 + 86 * Math.sin(a), 22)
  })

  return (
    <svg
      ref={ref}
      className={`wire ${instant ? 'wire-static' : ''}`}
      style={{ ['--draw' as string]: `${drawMs}ms`, width: size, height: size }}
      viewBox="0 0 200 200"
      aria-label="MY/CO/L mark"
    >
      <g className="faint">
        {ring.map((p, i) => (
          <polygon key={i} points={p} pathLength={1} />
        ))}
        <circle cx="100" cy="100" r="96" pathLength={1} />
      </g>
      <polygon points={hex(100, 100, 62)} pathLength={1} />
      <path
        pathLength={1}
        d="M100 150 V112 M100 112 L78 90 M100 112 L122 90 M78 90 V66 M78 90 L62 80 M122 90 V66 M122 90 L138 80 M100 112 V82"
      />
      <g className="nodes">
        <circle cx="78" cy="64" r="4" />
        <circle cx="122" cy="64" r="4" />
        <circle cx="61" cy="79" r="3" />
        <circle cx="139" cy="79" r="3" />
        <circle cx="100" cy="80" r="3.5" />
      </g>
    </svg>
  )
}
