import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** A QR code drawn as one SVG path (crisp at any print size). */
export function QrSvg({ text }: { text: string }) {
  const path = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let dd = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) dd += `M${c + 2} ${r + 2}h1v1h-1z`
    return { dd, n: n + 4 }
  }, [text])
  return (
    <svg className="qr" viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" aria-label="QR code">
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.dd} fill="#000" />
    </svg>
  )
}
