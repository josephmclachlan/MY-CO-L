import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../settings/AppContext'

/** A tile of random grain, made once. */
function makeNoise(): string {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    if (!g) return ''
    const img = g.createImageData(128, 128)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
    return c.toDataURL()
  } catch {
    return ''
  }
}

/**
 * The bulge map for a convex tube. Red holds the sideways shift and green the
 * up-down shift (128 = no shift). Points near the edges and corners sample
 * from further out, so the picture bows outward like old curved glass and the
 * corners fall away into the dark bezel.
 */
function makeBarrelMap(aspect: number): string {
  try {
    const n = 256
    const c = document.createElement('canvas')
    c.width = c.height = n
    const g = c.getContext('2d')
    if (!g) return ''
    const img = g.createImageData(n, n)
    // Shift scale per axis so the bulge looks round on wide and tall screens.
    const ax = aspect >= 1 ? 1 : aspect
    const ay = aspect >= 1 ? 1 / aspect : 1
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1
        const y = (j / (n - 1)) * 2 - 1
        const dx = x * y * y * ax
        const dy = y * x * x * ay
        const o = (j * n + i) * 4
        img.data[o] = Math.round(127.5 + 127.5 * dx)
        img.data[o + 1] = Math.round(127.5 + 127.5 * dy)
        img.data[o + 2] = 128
        img.data[o + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    return c.toDataURL()
  } catch {
    return ''
  }
}

// Safari (and every iPhone browser) can't run SVG warps on page content, so
// there the curve is drawn with shading only: vignette, rounded glass and glare.
const canWarp = (() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isWebKitOnly = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Firefox|FxiOS|CriOS/.test(ua)
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return !isWebKitOnly && !isIOS
})()

/**
 * The glass: theme colours, phosphor glow, scanlines, a real convex bulge,
 * colour fringing toward the edges, glare, grain and flicker. Every effect
 * scales with the STRENGTH slider; CLEAN mode turns them all off. BRIGHTNESS
 * works in both, on the whole screen.
 */
export function Crt({ children, alert, powered = true }: { children: ReactNode; alert?: boolean; powered?: boolean }) {
  const { settings, sound } = useApp()
  const { look } = settings
  const [glitch, setGlitch] = useState(false)
  const noise = useMemo(makeNoise, [])
  const screenRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(
    () =>
      sound.onGlitch((ms) => {
        setGlitch(true)
        window.setTimeout(() => setGlitch(false), ms)
      }),
    [sound],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = alert ? 'ALERT' : look.theme
  }, [look.theme, alert])

  useLayoutEffect(() => {
    const el = screenRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect
      setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const k = look.clean ? 0 : look.strength
  const curveK = k * look.curve
  // Maximum shift at the corners, in pixels. Kept modest so taps near the edge still land.
  const warpPx = curveK * 0.055 * Math.max(size.w, size.h)
  const useWarp = canWarp && warpPx > 0.5 && size.w > 0
  const barrel = useMemo(
    () => (useWarp ? makeBarrelMap(size.w / Math.max(1, size.h)) : ''),
    // Only rebuild when the shape of the screen changes noticeably.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [useWarp, Math.round((size.w / Math.max(1, size.h)) * 20)],
  )

  const style = {
    '--glow-k': k * look.glow,
    '--scan-k': k * look.scanlines,
    '--curve-k': curveK,
    '--flicker-k': k * look.flicker,
    '--noise-k': k * look.noise,
    '--text-scale': look.textSize,
    '--noise-img': noise ? `url(${noise})` : 'none',
    // BRIGHTNESS lifts or dims the whole screen; at 100% no filter is drawn at all
    filter: Math.abs(look.brightness - 1) > 0.005 ? `brightness(${look.brightness.toFixed(2)})` : undefined,
  } as React.CSSProperties

  return (
    <div
      className={`crt ${look.clean ? 'clean' : ''} ${glitch ? 'glitching' : ''} ${alert ? 'alert-flash' : ''} ${
        powered ? 'on' : 'off'
      } font-${look.dataFont === 'VT323' ? 'vt' : 'stm'}`}
      style={style}
    >
      <div className="crt-screen" ref={screenRef}>
        <div className="crt-warp" style={useWarp && barrel ? { filter: 'url(#crt-barrel)' } : undefined}>
          <div className="crt-content">{children}</div>
          <div className="fx fx-scan" aria-hidden />
        </div>
        <div className="fx fx-flicker" aria-hidden />
        <div className="fx fx-noise" aria-hidden />
        <div className="fx fx-vignette" aria-hidden />
        <div className="fx fx-glare" aria-hidden />
      </div>
      {useWarp && barrel && (
        <svg className="crt-defs" width="0" height="0" aria-hidden focusable="false">
          <filter
            id="crt-barrel"
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={size.w}
            height={size.h}
            colorInterpolationFilters="sRGB"
          >
            <feImage href={barrel} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={warpPx * 2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
    </div>
  )
}
