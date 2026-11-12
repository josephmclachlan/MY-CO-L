import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

// Chart parts for the deck overviews and the money screens. House rules (docs/DESIGN.md):
// one phosphor colour per screen, series told apart by hatching and brightness (never a second hue),
// amber only for warnings and always with words, one value axis per chart, hairline grid,
// a readout line for the value under the finger or pointer, and a <title> on every mark.
// They draw in once (CSS: lines trace, bars rise) and stay still under reduced motion.

/** Width of an element in CSS pixels, kept up to date. Charts draw in real pixels so text stays readable. */
export function useWidth(min = 200): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(Math.max(min, Math.floor(el.clientWidth)))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, w]
}

/** Round axis steps: 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, n = 3): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0]
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw)))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step)
  return out.length ? out : [lo]
}

/** Short money and number labels for axes: 1.2M, 450K, 12. */
export function shortNum(v: number): string {
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`
  if (a > 0 && a < 10) return `${s}${a.toFixed(1).replace(/\.0$/, '')}`
  return `${s}${Math.round(a)}`
}

/** Short colones: ₡1.2M, ₡450K, -₡14K (the minus goes before the sign). */
export const shortCrc = (v: number): string => `${v < 0 ? '-' : ''}₡${shortNum(Math.abs(v))}`

/** The diagonal hatch that tells a second series apart without a second colour. */
function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" className="cx-hatch-bg" />
        <line x1="0" y1="0" x2="0" y2="5" className="cx-hatch-line" />
      </pattern>
    </defs>
  )
}

/** True when the person asked the device for less motion: charts and counters then show their final state. */
export const stillMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A number that counts up to its value (from the last value shown), in about 0.7 s. */
export function Count({ value, fmt = shortNum, ms = 700 }: { value: number; fmt?: (v: number) => string; ms?: number }) {
  const shown = useRef(stillMotion() ? value : 0)
  const [v, setV] = useState(shown.current)
  useEffect(() => {
    const from = shown.current
    if (stillMotion() || !Number.isFinite(value) || from === value) {
      shown.current = value
      setV(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const x = from + (value - from) * (1 - (1 - k) ** 3)
      shown.current = x
      setV(x)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{fmt(v)}</>
}

// ---------- sparkline ----------

/** A small trend line: the last point is marked; a warn line is drawn in amber. */
export function Spark({ values, label, width = 96, height = 26, warn = false }: { values: number[]; label: string; width?: number; height?: number; warn?: boolean }) {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length < 2) return <svg className="cx-spark" width={width} height={height} role="img" aria-label={`${label}: not enough data yet`} />
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const span = hi - lo || 1
  const X = (i: number) => 2 + (i * (width - 6)) / (v.length - 1)
  const Y = (x: number) => 3 + (height - 6) * (1 - (x - lo) / span)
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join('')
  return (
    <svg className={`cx-spark ${warn ? 'warn' : ''}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: from ${shortNum(v[0])} to ${shortNum(v[v.length - 1])}`}>
      <path className="cx-line cx-draw" pathLength={1} d={d} />
      <circle className="cx-end" cx={X(v.length - 1)} cy={Y(v[v.length - 1])} r="2.6" />
    </svg>
  )
}

// ---------- stat tile ----------

/** One headline figure with its label, an optional trend line and a plain note. Tapping opens where it comes from. */
export function Tile({ label, value, sub, spark, sparkLabel, warn = false, onClick, tip }: { label: string; value: ReactNode; sub?: ReactNode; spark?: number[]; sparkLabel?: string; warn?: boolean; onClick?: () => void; tip?: string }) {
  const body = (
    <>
      <span className="cx-tile-label">{label}</span>
      <b className="cx-tile-value">{value}</b>
      {spark && <Spark values={spark} label={sparkLabel ?? label} warn={warn} />}
      {sub && <span className="cx-tile-sub">{sub}</span>}
    </>
  )
  return onClick ? (
    <button type="button" className={`cx-tile ${warn ? 'warn' : ''}`} onClick={onClick} data-tip={tip}>
      {body}
    </button>
  ) : (
    <div className={`cx-tile ${warn ? 'warn' : ''}`} data-tip={tip}>
      {body}
    </div>
  )
}

// ---------- columns ----------

export interface Col {
  key: string
  /** Under the column. Long labels are thinned out when the columns are narrow. */
  label: string
  value: number
  /** A second series (drawn hatched beside the first), same unit. */
  alt?: number
  warn?: boolean
  /** The words for the readout and the mark's title. */
  title?: string
}

/**
 * Columns on one value axis, with a zero line (values may go below it). An optional second series is hatched,
 * an optional line (same unit) runs over the columns, and an optional band marks a level (a floor or a target).
 */
export function Columns({
  data,
  label,
  fmt = shortNum,
  height = 160,
  legend,
  line,
  band,
  onPick,
  selected,
}: {
  data: Col[]
  label: string
  fmt?: (v: number) => string
  height?: number
  legend?: [string, string?, string?]
  line?: number[]
  /** A level across the chart: a floor (shaded below), a ceiling (shaded above) or a plain target line. */
  band?: { at: number; label: string; shade?: 'below' | 'above' | 'none' }
  onPick?: (key: string) => void
  selected?: string | null
}) {
  const [box, w] = useWidth(220)
  const [hover, setHover] = useState<number | null>(null)
  const hatch = `cx-h${useId().replace(/:/g, '')}`
  const narrow = w < 420
  const H = narrow ? Math.max(120, height - 20) : height
  const padL = narrow ? 34 : 44
  const padR = 6
  const padT = 8
  const padB = 20
  const vals = data.flatMap((d) => [d.value, d.alt ?? 0]).concat(line ?? [], band ? [band.at] : [], [0])
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi === lo) hi = lo + 1
  const ticks = niceTicks(lo, hi, narrow ? 2 : 3)
  lo = Math.min(lo, ticks[0])
  hi = Math.max(hi, ticks[ticks.length - 1])
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)
  const n = Math.max(1, data.length)
  const slot = (w - padL - padR) / n
  const gap = Math.max(2, Math.min(10, slot * 0.25))
  const two = data.some((d) => d.alt !== undefined)
  const bw = Math.max(2, two ? (slot - gap) * 0.58 : slot - gap)
  const aw = Math.max(2, (slot - gap) * 0.38)
  const X = (i: number) => padL + i * slot + gap / 2
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - padL) / (narrow ? 34 : 40)))))
  const zero = Y(0)
  const cur = hover !== null ? data[hover] : selected ? data.find((d) => d.key === selected) ?? null : null
  const pickAt = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - padL) / slot)
    setHover(i >= 0 && i < n ? i : null)
  }
  const bar = (v: number, x: number, width: number, cls: string, key: string, title: string, fill?: string) => {
    const y0 = Math.min(Y(v), zero)
    const h = Math.max(v === 0 ? 0 : 1, Math.abs(Y(v) - zero))
    return (
      <rect key={key} className={`cx-col ${cls} ${v < 0 ? 'neg' : ''}`} x={x} y={y0} width={width} height={h} style={fill ? { fill } : undefined}>
        <title>{title}</title>
      </rect>
    )
  }
  const lineD = line && line.length === n ? line.map((v, i) => `${i ? 'L' : 'M'}${(X(i) + (slot - gap) / 2).toFixed(1)},${Y(v).toFixed(1)}`).join('') : null
  return (
    <div ref={box} className="cx-chart">
      <div className="cx-readout" aria-live="polite">
        {cur ? (
          <>
            <b>{cur.title ?? cur.label}</b> // {fmt(cur.value)}
            {cur.alt !== undefined && legend?.[1] ? ` // ${legend[1]} ${fmt(cur.alt)}` : ''}
            {line && legend?.[2] && hover !== null ? ` // ${legend[2]} ${fmt(line[hover])}` : ''}
          </>
        ) : (
          <span className="dim">{narrow ? 'TOUCH' : 'POINT AT'} A COLUMN TO READ IT.</span>
        )}
      </div>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-label={`${label}: ${data.map((d) => `${d.title ?? d.label} ${fmt(d.value)}`).join(', ')}`}
        onPointerMove={(e) => pickAt(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pickAt(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        onClick={() => hover !== null && onPick?.(data[hover].key)}
        className={onPick ? 'cx-pickable' : ''}
      >
        <Hatch id={hatch} />
        {band && (
          <g>
            {band.shade !== 'none' && <rect className="cx-band" x={padL} width={w - padL - padR} y={band.shade === 'above' ? padT : Y(band.at)} height={band.shade === 'above' ? Math.max(0, Y(band.at) - padT) : Math.max(0, H - padB - Y(band.at))} />}
            <line className="cx-band-line" x1={padL} x2={w - padR} y1={Y(band.at)} y2={Y(band.at)} />
            <text className="cx-lab cx-band-lab" x={w - padR - 2} y={Y(band.at) - 3} textAnchor="end">{band.label}</text>
          </g>
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'cx-zero' : 'cx-grid'} x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} />
            <text className="cx-lab" x={padL - 4} y={Y(t) + 3.5} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {lo < 0 && !ticks.includes(0) && <line className="cx-zero" x1={padL} x2={w - padR} y1={zero} y2={zero} />}
        <g className="cx-rise">
          {data.map((d, i) => (
            <g key={d.key} className={hover === i || selected === d.key ? 'cx-on' : ''} style={{ ['--i' as string]: i }}>
              {bar(d.value, X(i), bw, d.warn ? 'warn' : '', `${d.key}-a`, `${d.title ?? d.label}: ${fmt(d.value)}${d.warn ? ' (WARNING)' : ''}`)}
              {d.alt !== undefined && bar(d.alt, X(i) + bw + 1, aw, 'alt', `${d.key}-b`, `${d.title ?? d.label}: ${legend?.[1] ?? ''} ${fmt(d.alt)}`, `url(#${hatch})`)}
            </g>
          ))}
        </g>
        {lineD && <path className="cx-case" d={lineD} />}
        {lineD && <path className="cx-line cx-draw" pathLength={1} d={lineD} />}
        {lineD && line!.map((v, i) => <circle key={i} className="cx-pt" cx={X(i) + (slot - gap) / 2} cy={Y(v)} r={3.5} />)}
        {data.map((d, i) => (i % every === 0 || i === n - 1) && (
          <text key={`l${d.key}`} className="cx-lab" x={X(i) + (slot - gap) / 2} y={H - 6} textAnchor="middle">{d.label}</text>
        ))}
      </svg>
      {legend && (legend[1] || legend[2]) && (
        <div className="cx-legend">
          <span><i className="cx-sw solid" />{legend[0]}</span>
          {legend[1] && <span><i className="cx-sw hatch" />{legend[1]}</span>}
          {legend[2] && <span><i className="cx-sw line" />{legend[2]}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- horizontal bars ----------

export interface BarRow {
  key: string
  label: string
  value: number
  /** A tick on the bar's track: a reorder point, a target. */
  mark?: number
  warn?: boolean
  /** Words after the value. */
  note?: string
  onClick?: () => void
}

/** A ranked list of bars on one scale, label left, value right. */
export function BarList({ rows, fmt = shortNum, max, label, markLabel }: { rows: BarRow[]; fmt?: (v: number) => string; max?: number; label: string; markLabel?: string }) {
  const top = Math.max(1e-9, max ?? Math.max(...rows.map((r) => Math.max(r.value, r.mark ?? 0)), 0))
  return (
    <div className="cx-bars" role="list" aria-label={label}>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="cx-bar-label">{r.label}</span>
            <span className="cx-track" aria-hidden="true">
              <i className={`cx-fill ${r.warn ? 'warn' : ''}`} style={{ width: `${Math.max(0, Math.min(100, (r.value / top) * 100))}%` }} />
              {r.mark !== undefined && r.mark > 0 && <i className="cx-mark" style={{ left: `${Math.min(100, (r.mark / top) * 100)}%` }} title={markLabel} />}
            </span>
            <span className={`cx-bar-value ${r.warn ? 'warn' : ''}`}>
              {fmt(r.value)}
              {r.note ? <small> {r.note}</small> : null}
            </span>
          </>
        )
        return r.onClick ? (
          <button type="button" role="listitem" key={r.key} className="cx-bar-row" onClick={r.onClick}>
            {inner}
          </button>
        ) : (
          <div role="listitem" key={r.key} className="cx-bar-row">
            {inner}
          </div>
        )
      })}
      {markLabel && rows.some((r) => r.mark) && <div className="cx-legend"><span><i className="cx-sw mark" />{markLabel}</span></div>}
    </div>
  )
}

// ---------- one stacked bar ----------

export interface Part {
  key: string
  label: string
  value: number
  /** How the segment is filled: bright, mid, hatched, cross-hatched, faint, or amber for a warning. */
  tone: 'solid' | 'mid' | 'hatch' | 'cross' | 'faint' | 'warn'
}

/** A whole split into its parts, with the legend underneath (label and value for each part). */
export function StackBar({ parts, fmt = shortNum, label, onPick }: { parts: Part[]; fmt?: (v: number) => string; label: string; onPick?: (key: string) => void }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0)
  return (
    <div className="cx-stack" aria-label={`${label}: ${parts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}`} role="img">
      <div className="cx-stack-bar" aria-hidden="true">
        {total > 0 ? parts.filter((p) => p.value > 0).map((p) => <i key={p.key} className={`cx-seg ${p.tone}`} style={{ flexGrow: p.value }} title={`${p.label}: ${fmt(p.value)}`} />) : <i className="cx-seg empty" style={{ flexGrow: 1 }} />}
      </div>
      <div className="cx-legend">
        {parts.map((p) =>
          onPick ? (
            <button type="button" key={p.key} className="cx-leg-btn" onClick={() => onPick(p.key)}>
              <i className={`cx-sw ${p.tone}`} />
              {p.label} <b>{fmt(p.value)}</b>
            </button>
          ) : (
            <span key={p.key}>
              <i className={`cx-sw ${p.tone}`} />
              {p.label} <b>{fmt(p.value)}</b>
            </span>
          ),
        )}
      </div>
    </div>
  )
}

// ---------- gauge ----------

/** A half dial: the shaded arc is the good band, the bright arc runs to the value. */
export function Gauge({ value, min, max, lo, hi, label, text, warn = false, size = 112 }: { value: number | null; min: number; max: number; lo?: number | null; hi?: number | null; label: string; text: string; warn?: boolean; size?: number }) {
  const W = size
  const H = Math.round(size * 0.62)
  const cx = W / 2
  const cy = H - 6
  const r = W / 2 - 8
  const ang = (v: number) => Math.PI * (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min || 1))
  const pt = (a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`
  const arc = (a0: number, a1: number) => `M${pt(a0)}A${r},${r} 0 0 1 ${pt(a1)}`
  const bandD = lo != null && hi != null ? arc(ang(lo), ang(hi)) : null
  return (
    <div className={`cx-gauge ${warn ? 'warn' : ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${text}${warn ? ', outside its band' : ''}`}>
        <path className="cx-g-track" d={arc(Math.PI, 0)} />
        {bandD && <path className="cx-g-band" d={bandD} />}
        {value !== null && <path className={`cx-g-val cx-draw ${warn ? 'warn' : ''}`} pathLength={1} d={arc(Math.PI, ang(value))} />}
        {value !== null && <circle className={`cx-g-tip ${warn ? 'warn' : ''}`} cx={cx + r * Math.cos(ang(value))} cy={cy - r * Math.sin(ang(value))} r="3" />}
      </svg>
      <b className={warn ? 'warn' : ''}>{text}</b>
      <span>{label}</span>
    </div>
  )
}
