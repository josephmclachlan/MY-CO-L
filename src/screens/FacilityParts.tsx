import { useState, type ReactNode } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { PickInput } from '../components/PickInput'
import { farmDay, farmTime, fromFarm } from '../lib/facility'

export type Say = (t: string, warn?: boolean) => void

/** Run one user action: one UNDO step, a click sound, the label on the status line, or the error in red. */
export function useRun(say: Say) {
  const { sound } = useApp()
  const store = useStore()
  return async (label: string, fn: () => Promise<unknown>) => {
    try {
      await store.action(label, fn)
      sound.confirm()
      say(label)
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
      return false
    }
  }
}

export function Buttons<T extends string>({ value, options, onPick, label }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void; label?: string }) {
  const { sound } = useApp()
  return (
    <div className="lg-btns" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={`btn ${o.id === value ? 'on' : ''}`} aria-pressed={o.id === value} onClick={() => (sound.chirp(), onPick(o.id))}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Several can be on at once. */
export function Chips<T extends string>({ value, options, onChange, label }: { value: T[]; options: { id: T; label: string }[]; onChange: (v: T[]) => void; label?: string }) {
  const { sound } = useApp()
  return (
    <div className="lg-btns" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.id)
        return (
          <button key={o.id} type="button" className={`btn ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => (sound.chirp(), onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id]))}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A day and a time on the farm's clock, set with the in-app pickers. */
export function DateTimeField({ label, day, time, onChange, optional }: { label: string; day: string; time: string; onChange: (day: string, time: string) => void; optional?: boolean }) {
  return (
    <div className="ck-field" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="fc-dt">
        <PickInput type="date" aria-label={`${label} day`} value={day} clearable={optional} onChange={(e) => onChange(e.target.value, time || (e.target.value ? farmTime(Date.now()) : ''))} />
        <PickInput type="time" aria-label={`${label} time`} value={time} clearable={optional} onChange={(e) => onChange(day || farmDay(Date.now()), e.target.value)} />
      </div>
    </div>
  )
}

/** Day + time text -> moment. Both blank = null (nothing typed). One blank or not real = NaN, so the checks say so. */
export function momentOf(day: string, time: string): number | null {
  if (!day && !time) return null
  const ms = fromFarm(day, time)
  return ms === null ? Number.NaN : ms
}
export const splitMs = (ms: number) => ({ day: farmDay(ms), time: farmTime(ms) })

export const num = (s: string): number | null => {
  const v = Number(s.replace(/[,\s]/g, ''))
  return s.trim() && Number.isFinite(v) ? v : null
}
export const numOrNaN = (s: string): number | null => (s.trim() ? (Number.isFinite(Number(s.replace(/[,\s]/g, ''))) ? Number(s.replace(/[,\s]/g, '')) : Number.NaN) : null)

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const t = document.createElement('textarea')
      t.value = text
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      const ok = document.execCommand('copy')
      t.remove()
      return ok
    } catch {
      return false
    }
  }
}

const INITIALS_KEY = 'mycol.initials.v1'
export const getInitials = () => {
  try {
    return localStorage.getItem(INITIALS_KEY) ?? ''
  } catch {
    return ''
  }
}
export const setInitials = (v: string) => {
  try {
    if (v.trim()) localStorage.setItem(INITIALS_KEY, v.trim().toUpperCase().slice(0, 24))
  } catch {
    /* storage blocked: the name is just not remembered */
  }
}

/** A small line chart (no axes numbers: min and max written at the ends). */
export function Spark({ values, label, lo, hi, unit }: { values: number[]; label: string; lo?: number; hi?: number; unit?: string }) {
  if (values.length < 2) return <span className="dim tiny">{values.length ? `${values[0]}${unit ?? ''}` : '--'}</span>
  const W = 110
  const H = 28
  const mn = Math.min(...values, lo ?? Infinity)
  const mx = Math.max(...values, hi ?? -Infinity)
  const span = mx - mn || 1
  const x = (i: number) => 3 + (i * (W - 6)) / (values.length - 1)
  const y = (v: number) => H - 3 - ((v - mn) * (H - 6)) / span
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="fc-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${values.map((v) => v).join(', ')}`}>
      {hi !== undefined && <line className="lim" x1="0" x2={W} y1={y(hi)} y2={y(hi)} />}
      {lo !== undefined && <line className="lim" x1="0" x2={W} y1={y(lo)} y2={y(lo)} />}
      <polyline className="line" points={pts} />
      <circle className="pt" cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.2" />
    </svg>
  )
}

export function Box({ title, children, extra }: { title: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="ck-box">
      <div className="section-title">{title} {extra}</div>
      {children}
    </div>
  )
}

/** Collapsible block, closed by default: keeps long settings out of the way. */
export function Fold({ title, children, open: start = false }: { title: string; children: ReactNode; open?: boolean }) {
  const { sound } = useApp()
  const [open, setOpen] = useState(start)
  return (
    <div className="ck-box">
      <button type="button" className={`btn fc-fold ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => (sound.chirp(), setOpen(!open))}>
        {open ? '[-]' : '[+]'} {title}
      </button>
      {open && <div className="fc-foldbody">{children}</div>}
    </div>
  )
}
