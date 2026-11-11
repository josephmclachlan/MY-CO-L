import { useEffect, useMemo, useRef, useState } from 'react'
import { farmDay, farmTime, dayLong } from '../lib/facility'
import { MEASURE, buckets, fmtVal, type Band, type Measure, type Series } from '../lib/sensors'

// History graph for one place and one measure. Drawn in screen pixels (measured), so the text stays readable on a phone.
// The line is the average of each time slice; the faint area behind it is the lowest to highest reading in that slice.
// Dashed amber lines are the alarm band.

export const RANGES = [
  { id: '6h', label: '6 H', ms: 6 * 3600000 },
  { id: '24h', label: '24 H', ms: 24 * 3600000 },
  { id: '7d', label: '7 D', ms: 7 * 86400000 },
  { id: '30d', label: '30 D', ms: 30 * 86400000 },
  { id: '1y', label: '1 YEAR', ms: 365 * 86400000 },
] as const
export type RangeId = (typeof RANGES)[number]['id']

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1
  const raw = span / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

export function ClimateGraph({ series, measure, band, from, to, label }: { series: Series | undefined; measure: Measure; band: Band | null; from: number; to: number; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))))
    ro.observe(el)
    setW(Math.max(260, Math.floor(el.clientWidth)))
    return () => ro.disconnect()
  }, [])
  const narrow = w < 480
  const H = narrow ? 190 : 230
  const padL = narrow ? 40 : 48
  const padR = 10
  const padT = 10
  const padB = 24
  const n = Math.max(20, Math.min(400, Math.floor((w - padL - padR) / 2)))
  const bs = useMemo(() => buckets(series, measure, from, to, n), [series, measure, from, to, n])
  const m = MEASURE[measure]
  if (!bs.length) {
    return (
      <div ref={box} className="at-graph at-empty" role="img" aria-label={`${label}: no readings in this time`}>
        <span className="dim">NO {m.label} READINGS IN THIS TIME. PICK A LONGER RANGE, OR ADD READINGS (LOG READING, IMPORT CSV, MOCK TEST).</span>
      </div>
    )
  }
  let lo = Math.min(...bs.map((b) => b.min))
  let hi = Math.max(...bs.map((b) => b.max))
  if (band?.lo !== null && band?.lo !== undefined) lo = Math.min(lo, band.lo)
  if (band?.hi !== null && band?.hi !== undefined) hi = Math.max(hi, band.hi)
  const padV = (hi - lo) * 0.08 || (measure === 'co2' ? 50 : 1)
  lo -= padV
  hi += padV
  if (measure === 'rh') {
    lo = Math.max(0, lo)
    hi = Math.min(100, hi)
  }
  const X = (t: number) => padL + ((t - from) / (to - from)) * (w - padL - padR)
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const slice = (to - from) / n
  // Break the line only where readings stop for much longer than usual. Hand-logged readings come every few
  // hours, so "usual" is the median gap between slices, not one slice. A run of one slice is drawn as a dot.
  const gaps = bs
    .slice(1)
    .map((b, i) => b.t0 - bs[i].t1)
    .filter((g) => g >= 0)
    .sort((a, b) => a - b)
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0
  const breakAt = Math.max(3 * slice, 3 * (typical + slice))
  const runs: { x: number; y: number }[][] = [[]]
  bs.forEach((b, i) => {
    if (i > 0 && b.t0 - bs[i - 1].t1 > breakAt) runs.push([])
    runs[runs.length - 1].push({ x: X((b.t0 + b.t1) / 2), y: Y(b.avg) })
  })
  const parts = runs.filter((r) => r.length > 1).map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
  const dots = runs.filter((r) => r.length === 1).map((r) => r[0])
  const area = bs.map((b) => `M${X(b.t0).toFixed(1)},${Y(b.max).toFixed(1)}H${Math.max(X(b.t1), X(b.t0) + 1).toFixed(1)}V${Y(b.min).toFixed(1)}H${X(b.t0).toFixed(1)}Z`).join('')
  const yt = niceTicks(lo, hi, narrow ? 3 : 4)
  const span = to - from
  const nx = narrow ? 3 : 5
  const xt = Array.from({ length: nx + 1 }, (_, i) => from + (i * span) / nx)
  const fmtX = (t: number) => (span <= 36 * 3600000 ? farmTime(t) : dayLong(farmDay(t)))
  const hb = hover !== null ? bs[hover] : null
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const t = from + ((e.clientX - r.left - padL) / (w - padL - padR)) * span
    let best = 0
    for (let i = 1; i < bs.length; i++) if (Math.abs((bs[i].t0 + bs[i].t1) / 2 - t) < Math.abs((bs[best].t0 + bs[best].t1) / 2 - t)) best = i
    setHover(best)
  }
  const last = bs[bs.length - 1]
  const summary = `${label}: ${bs.length} time slices from ${fmtX(from)} to ${fmtX(to)}. Lowest ${fmtVal(Math.min(...bs.map((b) => b.min)), measure)}, highest ${fmtVal(Math.max(...bs.map((b) => b.max)), measure)}, latest ${fmtVal(last.avg, measure)}.`
  return (
    <div ref={box} className="at-graph">
      <div className="at-readout" aria-live="polite">
        {hb ? (
          <>
            <b>{dayLong(farmDay(hb.t0))} {farmTime(hb.t0)}{hb.t1 - hb.t0 > 60000 * 2 ? `-${farmTime(hb.t1)}` : ''}</b> // {fmtVal(hb.avg, measure)}
            {hb.n > 1 ? ` (${hb.min.toFixed(m.dp)}-${hb.max.toFixed(m.dp)}, ${hb.n} READINGS)` : ''}
          </>
        ) : (
          <span className="dim">{narrow ? 'TOUCH' : 'POINT AT'} THE GRAPH TO READ A VALUE. LINE = AVERAGE, SHADE = LOWEST TO HIGHEST, AMBER DASHES = ALARM LIMITS.</span>
        )}
      </div>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={summary} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}>
        {band && band.lo !== null && band.hi !== null && <rect className="at-ok" x={padL} width={w - padL - padR} y={Y(band.hi)} height={Math.max(0, Y(band.lo) - Y(band.hi))} />}
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line className="at-grid" x1={padL} x2={w - padR} y1={Y(v)} y2={Y(v)} />
            <text className="at-ylab" x={padL - 4} y={Y(v) + 4} textAnchor="end">{measure === 'co2' ? Math.round(v) : v}</text>
          </g>
        ))}
        {xt.map((t, i) => (
          <text key={`x${i}`} className="at-xlab" x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === nx ? 'end' : 'middle'}>{fmtX(t)}</text>
        ))}
        <path className="at-range" d={area} />
        {band?.hi !== null && band?.hi !== undefined && <line className="at-lim" x1={padL} x2={w - padR} y1={Y(band.hi)} y2={Y(band.hi)} />}
        {band?.lo !== null && band?.lo !== undefined && <line className="at-lim" x1={padL} x2={w - padR} y1={Y(band.lo)} y2={Y(band.lo)} />}
        {parts.map((d, i) => <path key={i} className="at-line" d={d} />)}
        {dots.map((p, i) => <circle key={`d${i}`} className="at-pt" cx={p.x} cy={p.y} r="2.5" />)}
        {hb && <line className="at-cursor" x1={X((hb.t0 + hb.t1) / 2)} x2={X((hb.t0 + hb.t1) / 2)} y1={padT} y2={H - padB} />}
        {hb && <circle className="at-dot" cx={X((hb.t0 + hb.t1) / 2)} cy={Y(hb.avg)} r="3" />}
        <text className="at-unit" x={padL + 4} y={padT + 11}>{m.unit === 'C' ? '°C' : m.unit}</text>
      </svg>
    </div>
  )
}
