import { Select } from '../components/Select'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SHEET_COLS, type SheetCol } from '../data/cook'
import {
  crParts,
  fToC,
  hm,
  MIN,
  parseLoggerCsv,
  peakWindows,
  psiPts,
  readingsFromCsv,
  toPts,
  zoneNames,
  type CookReading,
  type CookRun,
  type CsvParse,
  type RunAnalysis,
} from '../lib/cook'
import { uuid } from '../lib/store'

// ---------- small inputs (same look as CARGO) ----------

/** A field that saves when you leave it or press Enter. */
export function Field({ label, value, onSave, type = 'text', wide, placeholder, inputMode, disabled, hint }: { label: string; value: string; onSave: (v: string) => void; type?: string; wide?: boolean; placeholder?: string; inputMode?: 'decimal' | 'numeric' | 'text'; disabled?: boolean; hint?: string }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  const commit = () => draft !== value && onSave(draft.trim())
  return (
    <label className={`ck-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <input
        type={type}
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), commit())}
      />
      {hint && <em>{hint}</em>}
    </label>
  )
}

export function Pick<T extends string>({ label, value, options, onPick, wide }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (v: T) => void; wide?: boolean }) {
  return (
    <label className={`ck-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <Select value={value} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

/** A button that asks twice before doing something that cannot be undone. */
export function Confirm({ label, onYes, disabled }: { label: string; onYes: () => void; disabled?: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <button type="button" className={`btn danger ${sure ? 'on' : ''}`} disabled={disabled} onClick={() => (sure ? (setSure(false), onYes()) : setSure(true))} onBlur={() => setSure(false)}>
      {sure ? 'SURE? TAP AGAIN' : label}
    </button>
  )
}

export const Guess = () => <span className="ck-guess" title="A best guess. Not in Joseph's files. Waiting for his review.">GUESS - REVIEW</span>

/** Nudge label heights apart so they stay readable: keeps order, enforces a minimum gap. */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const idx = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(ys.length)
  let prev = lo - gap
  for (const [y, i] of idx) {
    prev = Math.max(y, prev + gap)
    out[i] = prev
  }
  // push back up if the last ones ran past the bottom
  let next = hi + gap
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k][1]
    next = Math.min(out[i], next - gap)
    out[i] = next
  }
  return out
}

// ---------- the temperature curve ----------

const DASH = ['', '7 3', '2 3', '9 3 2 3', '1 4']
const LINES: { f: number; label: string; cls: string }[] = [
  { f: 140, label: '140', cls: 'ck-l' },
  { f: 160, label: '160', cls: 'ck-l' },
  { f: 180, label: '180', cls: 'ck-l' },
  { f: 190, label: '190', cls: 'ck-l ck-lk' },
  { f: 198, label: '198', cls: 'ck-l ck-lk' },
  { f: 200, label: '200 HOLD', cls: 'ck-l ck-lk hold' },
  { f: 205, label: '205 OVER', cls: 'ck-l ck-lk over' },
]

/** Line-art curves, one line per probe, with the sheet's temperature lines and the ICE peak windows along the bottom. */
export function Curve({ run, an, readings }: { run: CookRun; an: RunAnalysis; readings: CookReading[] }) {
  const mine = readings.filter((r) => r.cook_run_id === run.id)
  const zones = zoneNames(mine.filter((r) => r.temp_f !== null))
  const series = zones.map((z) => ({ z, pts: toPts(mine.filter((r) => r.zone === z)) })).filter((s) => s.pts.length)
  const pp = psiPts(mine)
  if (!series.length && !pp.length) return <div className="dim">NO READINGS YET. ADD THEM ON THE READINGS TAB.</div>

  const W = 760
  const H = 380
  const L = 40
  const R = 132
  const T = 12
  const B = 40
  const origin = an.origin ?? Math.min(...[...series.flatMap((s) => s.pts.map((p) => p.t)), ...pp.map((p) => p.t)])
  const last = Math.max(...[...series.flatMap((s) => s.pts.map((p) => p.t)), ...pp.map((p) => p.t)], an.end ?? 0)
  const end = Math.max(last, origin + 3600000)
  const x = (t: number) => L + ((t - origin) / (end - origin)) * (W - L - R)
  const temps = series.flatMap((s) => s.pts.map((p) => p.f))
  const lo = temps.length ? Math.min(60, Math.floor((Math.min(...temps) - 5) / 10) * 10) : 60
  const hi = temps.length ? Math.max(215, Math.ceil((Math.max(...temps) + 5) / 5) * 5) : 215
  const y = (f: number) => T + (1 - (f - lo) / (hi - lo)) * (H - T - B)
  const ticks: number[] = []
  const step = (end - origin) / 3600000 > 12 ? 2 : 1
  const startHour = Math.ceil((origin - 6 * 3600000) / 3600000)
  for (let h = startHour; (h * 3600000 + 6 * 3600000) <= end; h += step) ticks.push(h * 3600000 + 6 * 3600000)
  const path = (pts: { t: number; f: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.f).toFixed(1)}`).join('')
  const peaks = peakWindows(origin, end)
  const slow = an.slow
  const holdAt = slow?.t200 !== null && slow?.t200 !== undefined ? origin + slow.t200 * MIN : null
  const shownLines = LINES.filter((l) => l.f > lo && l.f < hi)
  const lineY = spread(shownLines.map((l) => y(l.f) + 3), 11, T + 6, H - B - 2)
  const endPts = series.map((s) => s.pts[s.pts.length - 1])
  const endY = spread(endPts.map((p) => y(p.f) + 3), 11, T + 6, H - B - 2)
  const yTicks: number[] = []
  for (let f = Math.ceil(lo / 20) * 20; f <= hi; f += 20) yTicks.push(f)

  return (
    <div className="ck-chart">
      {series.length > 0 && (
        <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperature curves for this run" className="ck-svg">
        <defs>
          <pattern id="ck-hold" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5L5 0" stroke="currentColor" strokeWidth="0.7" opacity="0.5" /></pattern>
          <pattern id="ck-over" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0L5 5M5 0L0 5" stroke="var(--hazard)" strokeWidth="0.7" opacity="0.7" /></pattern>
          <pattern id="ck-pk" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 4L4 0" stroke="var(--hazard)" strokeWidth="1" /></pattern>
          <clipPath id="ck-clip"><rect x={L} y={T} width={W - L - R} height={H - T - B} /></clipPath>
        </defs>
        {/* working band 200-205 and overprocessing above 205 */}
        <rect x={L} y={y(205)} width={W - L - R} height={y(200) - y(205)} fill="url(#ck-hold)" />
        <rect x={L} y={y(hi)} width={W - L - R} height={y(205) - y(hi)} fill="url(#ck-over)" opacity="0.5" />
        {yTicks.map((f) => (
          <g key={f}>
            <path d={`M${L} ${y(f)}H${W - R}`} className="ck-grid" />
            <text x={L - 5} y={y(f) + 3} textAnchor="end" className="ck-tx">{f}</text>
          </g>
        ))}
        {shownLines.map((l, i) => (
          <g key={l.f}>
            <path d={`M${L} ${y(l.f)}H${W - R}`} className={l.cls} />
            <path d={`M${W - R} ${y(l.f)}L${W - R + 5} ${lineY[i] - 3}`} className="ck-lead" />
            <text x={W - R + 7} y={lineY[i]} className={`ck-tx ck-txl ${l.cls.includes('over') ? 'over' : ''}`}>{l.label}</text>
          </g>
        ))}
        <text x={5} y={T + 8} className="ck-tx" transform={`rotate(-90 5 ${T + 40})`}>DEG F</text>
        {ticks.map((t) => (
          <g key={t}>
            <path d={`M${x(t)} ${H - B}v4`} className="ck-ax" />
            <text x={x(t)} y={H - B + 15} textAnchor="middle" className="ck-tx">{crParts(t).time}</text>
          </g>
        ))}
        <path d={`M${L} ${H - B}H${W - R}`} className="ck-ax" />
        {peaks.map((w) => {
          const a = Math.max(x(Math.max(w.from, origin)), L)
          const b = Math.min(x(Math.min(w.to, end)), W - R)
          return b > a ? <rect key={w.from} x={a} y={H - B + 20} width={b - a} height={6} fill="url(#ck-pk)" stroke="var(--hazard)" strokeWidth="0.8" /> : null
        })}
        {peaks.length > 0 && <text x={L} y={H - 2} className="ck-tx ck-warn">ICE PEAK WINDOWS</text>}
        {holdAt !== null && (
          <g>
            <path d={`M${x(holdAt)} ${T}V${H - B}`} className="ck-mark" />
            <text x={x(holdAt) + 4} y={T + 10} className="ck-tx">{slow?.zone} AT 200 F</text>
          </g>
        )}
        <g clipPath="url(#ck-clip)">
          {series.map((s, i) => (
            <path key={s.z} d={path(s.pts)} className="ck-line" strokeDasharray={DASH[i % DASH.length]} />
          ))}
        </g>
        {series.map((s, i) => {
          const p = endPts[i]
          return (
            <g key={s.z}>
              <path d={`M${x(p.t)} ${y(p.f)}L${W - R + 62} ${endY[i] - 3}`} className="ck-lead name" />
              <text x={W - R + 64} y={endY[i]} className="ck-tx ck-name">{s.z.slice(0, 7)} {Math.round(p.f)}</text>
            </g>
          )
        })}
      </svg>
      <div className="ck-legend tiny">
        {series.map((s, i) => (
          <span key={s.z} className="ck-key">
            <svg width="34" height="8" aria-hidden><path d="M0 4H34" className="ck-line" strokeDasharray={DASH[i % DASH.length]} /></svg> {s.z}
          </span>
        ))}
        <span className="dim">HATCHED BAND = 200-205 F WORKING ZONE // CROSSED = OVER 205 F // BOTTOM BARS = ICE PEAK</span>
      </div>
        </>
      )}
      {pp.length > 0 && <PsiCurve pts={pp} origin={origin} end={end} />}
      <div className="ck-zstats">
        {series.map((s) => {
          const z = an.zones.find((q) => q.zone === s.z)
          return z ? (
            <div key={s.z} className="ck-zrow">
              <b>{z.zone}{z.judged ? '' : ' (NOT JUDGED)'}</b>
              <span>MAX {z.maxF.toFixed(1)} F / {fToC(z.maxF).toFixed(1)} C</span>
              <span>TO 200 F {hm(z.t200)}</span>
              <span>ABOVE 200 F {hm(z.above[200])}</span>
              <span>F {z.f.toFixed(1)} H</span>
            </div>
          ) : null
        })}
      </div>
    </div>
  )
}

function PsiCurve({ pts, origin, end }: { pts: { t: number; f: number }[]; origin: number; end: number }) {
  const W = 760
  const H = 170
  const L = 40
  const R = 132
  const T = 10
  const B = 22
  const hi = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.f)) + 2))
  const x = (t: number) => L + ((t - origin) / (end - origin)) * (W - L - R)
  const y = (v: number) => T + (1 - v / hi) * (H - T - B)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pressure curve" className="ck-svg ck-psi">
      {[0, 5, 10, 15, 20].filter((v) => v <= hi).map((v) => (
        <g key={v}>
          <path d={`M${L} ${y(v)}H${W - R}`} className="ck-grid" />
          <text x={L - 5} y={y(v) + 3} textAnchor="end" className="ck-tx">{v}</text>
        </g>
      ))}
      <path d={`M${L} ${y(15)}H${W - R}`} className="ck-l ck-lk hold" />
      <text x={W - R + 4} y={y(15) + 3} className="ck-tx ck-txl">15 PSI</text>
      <path d={`M${L} ${y(17)}H${W - R}`} className="ck-l ck-lk" />
      <text x={W - R + 4} y={y(17) + 3} className="ck-tx ck-txl">17 AVERY</text>
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.f).toFixed(1)}`).join('')} className="ck-line" />
      <text x={5} y={T + 8} className="ck-tx" transform={`rotate(-90 5 ${T + 30})`}>PSI</text>
      <path d={`M${L} ${H - B}H${W - R}`} className="ck-ax" />
    </svg>
  )
}

// ---------- the log sheet, in the layout of Joseph's PDF ----------

type SheetRow = Record<string, string>

/** Header cells that cover several columns: a cell opens where `text` is set and swallows the next `span - 1` columns. */
function walk(cols: SheetCol[], text: (c: SheetCol) => string | undefined, span: (c: SheetCol) => number, style: (c: SheetCol) => CSSProperties, rot = false): ReactNode[] {
  const out: ReactNode[] = []
  for (let i = 0; i < cols.length; ) {
    const c = cols[i]
    const t = text(c)
    const n = t === undefined ? 1 : Math.max(1, span(c))
    out.push(
      <th key={c.key} colSpan={n} style={style(c)} title={t}>
        {rot ? <span className="ck-rot">{t ?? ''}</span> : (t ?? '')}
      </th>,
    )
    i += n
  }
  return out
}

/** One probe per row. `print` draws the sheet's own colours, rotated headings and blank cells to write in. */
export function SheetTable({ rows, print, blank = 0 }: { rows: SheetRow[]; print?: boolean; blank?: number }) {
  const headFor = (i: number) => {
    for (let k = i; k >= 0; k--) if (SHEET_COLS[k].head) return SHEET_COLS[k].head
    return ''
  }
  const all: SheetRow[] = [...rows, ...Array.from({ length: blank }, () => ({}))]
  return (
    <table className={`ck-sheet ${print ? 'print' : ''}`}>
      {print && (
        <colgroup>
          {SHEET_COLS.map((c) => (
            <col key={c.key} style={['date', 'vessel', 'location'].includes(c.key) ? { width: '15mm' } : undefined} />
          ))}
        </colgroup>
      )}
      <thead>
        <tr className="ck-sup">{walk(SHEET_COLS, (c) => c.sup, (c) => c.supSpan ?? 1, () => ({}))}</tr>
        <tr className="ck-hd">{walk(SHEET_COLS, (c) => (c.head !== '' ? c.head : undefined), (c) => c.span ?? 1, (c) => (print ? { background: c.tone } : {}), true)}</tr>
        <tr className="ck-sub">
          {SHEET_COLS.map((c, i) => (
            <th key={c.key} style={print ? { background: c.tone } : undefined} title={headFor(i)}>{c.sub}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {all.map((r, i) => (
          <tr key={i}>
            {SHEET_COLS.map((c) => (
              <td key={c.key} style={print ? { background: c.tint } : undefined}>{r[c.key] ?? ''}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Opens the print dialog for a sheet. Mounted only while printing, directly under <body>, so the rest of the page is hidden. */
export function PrintSheet({ title, rows, blank, onDone }: { title: string; rows: SheetRow[]; blank: number; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      window.print()
      onDone()
    }, 120)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <div className="cook-print">
      <style media="print">{'@page { size: letter landscape; margin: 8mm; }'}</style>
      <div className="ck-ph">
        <svg className="ck-mark-svg" viewBox="0 0 40 40" aria-hidden>
          {/* static print mark: a wireframe globe under the corp name (the screen logo is WebGL and does not print) */}
          <g fill="none" stroke="#000" strokeWidth="1.1">
            <circle cx="20" cy="20" r="17" />
            <ellipse cx="20" cy="20" rx="17" ry="6" />
            <ellipse cx="20" cy="20" rx="7" ry="17" />
            <path d="M20 3V37M3 20H37" />
          </g>
        </svg>
        <div className="ck-ph-t">
          <b>BLACK FLAG FUNGI CORP // NEGRA BAY BIOLOGICS, TALAMANCA STATION</b>
          <span>THE LATTICE HOLDS</span>
          <span>{title}</span>
          <span>MY/CO/L PROPULSION LOG SHEET. LAYOUT AFTER THE SUBSTRATE TEMPERATURE METRICS SHEET. TIMES ARE H:MM. TEMPERATURES IN F.</span>
        </div>
      </div>
      <SheetTable rows={rows} print blank={blank} />
      <div className="ck-pf">
        KEEP: HOLD ABOVE 200 F 4 H ON THE SLOWEST CORE (JOSEPH, CONFIRMED) // SHEET MINIMUMS ABOVE 190 F 6-8 H, 198 F 4.5-5 H, 200 F 4-6 H // OVER 205 F UNDER 3 H // 115-140 F UNDER 1 H // F AT 97C/206F 6-8 IDEAL
      </div>
    </div>,
    document.body,
  )
}

// ---------- CSV import ----------

export function CsvImport({ run, zones, onImport, say }: { run: CookRun; zones: string[]; onImport: (rows: CookReading[]) => Promise<void>; say: (t: string, warn?: boolean) => void }) {
  const [text, setText] = useState('')
  const [parse, setParse] = useState<CsvParse | null>(null)
  const [chan, setChan] = useState<CsvParse['channels']>([])
  const [order, setOrder] = useState<CsvParse['dateOrder']>('DMY')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const read = (t: string) => {
    setText(t)
    const p = parseLoggerCsv(t)
    setParse(p)
    setChan(p.channels)
    setOrder(p.dateOrder)
  }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) return say('THAT FILE IS OVER 8 MB. EXPORT A SHORTER RANGE FROM THE LOGGER.', true)
    read(await f.text())
  }
  const base = run.started_at ? Date.parse(run.started_at) : Date.now()
  const built = parse?.ok ? readingsFromCsv({ ...parse, dateOrder: order, channels: chan }, run.id, base, uuid) : null
  const set = (i: number, p: Partial<CsvParse['channels'][number]>) => setChan((c) => c.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const go = async () => {
    if (!built?.readings.length) return
    setBusy(true)
    try {
      await onImport(built.readings)
      say(`${built.readings.length} READINGS IMPORTED${built.skipped ? `, ${built.skipped} ROWS SKIPPED` : ''}`)
      setText('')
      setParse(null)
      if (file.current) file.current.value = ''
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ck-box">
      <div className="section-title">IMPORT FROM A LOGGER (CSV)</div>
      <div className="dim tiny">MADGETECH, GOVEE OR ANY SPREADSHEET SAVED AS CSV: A TIME COLUMN, THEN ONE COLUMN PER PROBE. CLOCK TIMES ARE READ AS COSTA RICA TIME. ONE READING PER PROBE PER MINUTE IS KEPT.</div>
      <div className="ck-row">
        <input ref={file} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Choose a CSV file" />
      </div>
      <details className="ck-paste">
        <summary>OR PASTE THE TEXT</summary>
        <textarea rows={5} value={text} onChange={(e) => read(e.target.value)} placeholder="Date and Time,Channel 1 (F),Channel 2 (F)&#10;02/11/2026 06:30:00,78.1,80.2" />
      </details>
      {parse && !parse.ok && <div className="warn">{parse.error}</div>}
      {parse?.ok && (
        <div className="ck-map">
          <div className="tiny dim">
            {parse.rows.length} ROWS // DELIMITER {parse.delimiter === '\t' ? 'TAB' : parse.delimiter} // TIME {parse.timeKind === 'datetime' ? 'CLOCK' : parse.timeKind.toUpperCase().replace('-', ' ')}
          </div>
          {parse.timeKind === 'datetime' && (
            <Pick label="DATE ORDER (DAY FIRST IS COSTA RICA STYLE)" value={order} options={[{ id: 'DMY', label: 'DAY / MONTH / YEAR' }, { id: 'MDY', label: 'MONTH / DAY / YEAR' }, { id: 'YMD', label: 'YEAR - MONTH - DAY' }]} onPick={setOrder} />
          )}
          {parse.timeKind !== 'datetime' && <div className="tiny dim">ELAPSED TIME COUNTS FROM THE RUN START ({run.started_at ? crParts(base).time : 'NOT SET'}).</div>}
          {chan.map((c, i) => (
            <div key={c.col} className="ck-chan">
              <span className="ck-cn" title={c.name}>{c.name}</span>
              <Select value={c.unit} onChange={(e) => set(i, { unit: e.target.value as 'F' | 'C' | 'PSI' })} aria-label={`Unit of ${c.name}`}>
                <option value="F">DEG F</option>
                <option value="C">DEG C</option>
                <option value="PSI">PSI</option>
              </Select>
              <input list="ck-zones" value={c.zone} onChange={(e) => set(i, { zone: e.target.value.toUpperCase() })} placeholder="PROBE NAME, EMPTY = SKIP" aria-label={`Probe name for ${c.name}`} />
            </div>
          ))}
          <datalist id="ck-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          {built && (
            <div className="ck-prev tiny">
              {built.readings.length} READINGS READY{built.skipped ? `, ${built.skipped} ROWS WITH NO READABLE TIME` : ''}
              {built.readings.length > 0 && ` // FIRST ${crParts(Date.parse(built.readings[0].taken_at)).date} ${crParts(Date.parse(built.readings[0].taken_at)).time} // LAST ${crParts(Date.parse(built.readings[built.readings.length - 1].taken_at)).time}`}
              {built.readings.length > 6000 && <span className="warn"> // OVER 6,000 ROWS: FINE, BUT A SHORTER EXPORT IS QUICKER</span>}
            </div>
          )}
          <button type="button" className="btn" disabled={busy || !built?.readings.length} onClick={() => void go()}>
            {busy ? 'IMPORTING...' : `IMPORT ${built?.readings.length ?? 0} READINGS`}
          </button>
        </div>
      )}
    </div>
  )
}

export function Row({ children, cls }: { children: ReactNode; cls?: string }) {
  return <div className={`ck-line-row ${cls ?? ''}`}>{children}</div>
}
