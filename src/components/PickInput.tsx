import { useEffect, useId, useRef, useState } from 'react'
import { DOW, MONTHS, daysIn, isoDate, isoTime, monthGrid, parseDate, parseMonth, parseTime, shiftMonth } from '../lib/pickerDates'

/**
 * In-app date / time / month picker. Replaces <input type="date|time|month"> so
 * phones show a terminal-styled, animated panel instead of the system wheel.
 * onChange gets { target: { value } } like a normal input; value is the same
 * string the native input used (YYYY-MM-DD, HH:MM, YYYY-MM).
 */
export interface PickInputProps {
  type: 'date' | 'time' | 'month'
  value: string
  onChange: (e: { target: { value: string } }) => void
  clearable?: boolean
  disabled?: boolean
  'aria-label'?: string
}

const now = () => new Date()

export function PickInput({ type, value, onChange, clearable, disabled, 'aria-label': ariaLabel }: PickInputProps) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const [up, setUp] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true) }
  }, [open])

  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [open])

  const set = (v: string) => onChange({ target: { value: v } })
  const toggle = () => {
    if (disabled) return
    if (!open) {
      const r = root.current?.getBoundingClientRect()
      if (r) {
        const w = Math.min(280, window.innerWidth * 0.84)
        setShift(Math.max(24 - r.left, Math.min(0, window.innerWidth - 28 - w - r.left)))
        const below = window.innerHeight - r.bottom
        setUp(below < 340 && r.top > below)
      }
    }
    setOpen(!open)
  }

  let shown = value
  if (type === 'date') { const d = parseDate(value); shown = d ? `${String(d.d).padStart(2, '0')} ${MONTHS[d.m - 1]} ${d.y}` : '' }
  if (type === 'month') { const m = parseMonth(value); shown = m ? `${MONTHS[m.m - 1]} ${m.y}` : '' }

  return (
    <span className={`ui-pick ${open ? 'open' : ''}`} ref={root}>
      <button type="button" className="ui-select-btn" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={ariaLabel} onClick={toggle}>
        <span className={`ui-select-val ${shown ? '' : 'dim'}`}>{shown || (type === 'time' ? '--:--' : 'NOT SET')}</span>
        <span className="ui-select-caret" aria-hidden="true">{type === 'time' ? '◷' : '▦'}</span>
      </button>
      {open && (
        <div id={id} ref={panel} role="dialog" onClick={(e) => e.preventDefault()} className={`ui-pick-panel${up ? ' up' : ''}`} style={{ left: shift }}>
          {type === 'date' && <DatePanel value={value} onPick={(v) => { set(v); setOpen(false) }} />}
          {type === 'month' && <MonthPanel value={value} onPick={(v) => { set(v); setOpen(false) }} />}
          {type === 'time' && <TimePanel value={value} onPick={set} />}
          <div className="ui-pick-foot">
            {type === 'date' && <button type="button" onClick={() => { const n = now(); set(isoDate(n.getFullYear(), n.getMonth() + 1, n.getDate())); setOpen(false) }}>TODAY</button>}
            {type === 'month' && <button type="button" onClick={() => { const n = now(); set(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`); setOpen(false) }}>THIS MONTH</button>}
            {type === 'time' && <button type="button" onClick={() => { const n = now(); set(isoTime(n.getHours(), n.getMinutes())) }}>NOW</button>}
            {clearable && value && <button type="button" onClick={() => { set(''); setOpen(false) }}>CLEAR</button>}
            <button type="button" onClick={() => setOpen(false)}>{type === 'time' ? 'DONE' : 'CLOSE'}</button>
          </div>
        </div>
      )}
    </span>
  )
}

function DatePanel({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const cur = parseDate(value)
  const n = now()
  const [view, setView] = useState({ y: cur?.y ?? n.getFullYear(), m: cur?.m ?? n.getMonth() + 1 })
  const [dir, setDir] = useState(1)
  const go = (by: number) => { setDir(by < 0 ? -1 : 1); setView((v) => shiftMonth(v.y, v.m, by)) }
  const today = isoDate(n.getFullYear(), n.getMonth() + 1, n.getDate())
  return (
    <div className="ui-pick-date">
      <div className="ui-pick-head">
        <button type="button" aria-label="Previous year" onClick={() => go(-12)}>&laquo;</button>
        <button type="button" aria-label="Previous month" onClick={() => go(-1)}>&lsaquo;</button>
        <span className="ui-pick-title">{MONTHS[view.m - 1]} {view.y}</span>
        <button type="button" aria-label="Next month" onClick={() => go(1)}>&rsaquo;</button>
        <button type="button" aria-label="Next year" onClick={() => go(12)}>&raquo;</button>
      </div>
      <div className="ui-pick-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div className={`ui-pick-grid ${dir < 0 ? 'from-l' : 'from-r'}`} key={`${view.y}-${view.m}`}>
        {monthGrid(view.y, view.m).flat().map((d, i) => {
          if (!d) return <span key={i} />
          const iso = isoDate(view.y, view.m, d)
          return (
            <button type="button" key={i} className={`${iso === value ? 'sel' : ''} ${iso === today ? 'today' : ''}`} onClick={() => onPick(iso)} disabled={d > daysIn(view.y, view.m)}>
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MonthPanel({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const cur = parseMonth(value)
  const [y, setY] = useState(cur?.y ?? now().getFullYear())
  return (
    <div className="ui-pick-date">
      <div className="ui-pick-head">
        <button type="button" aria-label="Previous year" onClick={() => setY(y - 1)}>&lsaquo;</button>
        <span className="ui-pick-title">{y}</span>
        <button type="button" aria-label="Next year" onClick={() => setY(y + 1)}>&rsaquo;</button>
      </div>
      <div className="ui-pick-months" key={y}>
        {MONTHS.map((mn, i) => {
          const v = `${y}-${String(i + 1).padStart(2, '0')}`
          return <button type="button" key={mn} className={v === value ? 'sel' : ''} onClick={() => onPick(v)}>{mn}</button>
        })}
      </div>
    </div>
  )
}

function TimePanel({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const t = parseTime(value) ?? { h: now().getHours(), min: now().getMinutes() }
  const hRef = useRef<HTMLDivElement>(null)
  const mRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    for (const r of [hRef.current, mRef.current]) r?.querySelector('.sel')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div className="ui-pick-time">
      <div className="ui-pick-col" ref={hRef} aria-label="Hour">
        {Array.from({ length: 24 }, (_, h) => <button type="button" key={h} className={h === t.h ? 'sel' : ''} onClick={() => onPick(isoTime(h, t.min))}>{String(h).padStart(2, '0')}</button>)}
      </div>
      <span className="ui-pick-colon">:</span>
      <div className="ui-pick-col" ref={mRef} aria-label="Minute">
        {Array.from({ length: 60 }, (_, m) => <button type="button" key={m} className={m === t.min ? 'sel' : ''} onClick={() => onPick(isoTime(t.h, m))}>{String(m).padStart(2, '0')}</button>)}
      </div>
    </div>
  )
}
