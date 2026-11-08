// App value <-> sheet cell. Pure functions.
//
// Values are compared in CELL form (what the sheet shows), so a value only counts as changed when the
// sheet would show something different. That keeps number and date formats from causing false edits.

import type { Cell, ColumnSpec } from './types'

/** The cell the sheet should show for an app value. */
export function toCell(v: unknown, spec: ColumnSpec): Cell {
  // A tick box cannot show "empty": an unset yes/no shows as unticked, and only a tick the person changes is saved.
  if ((v === null || v === undefined) && spec.kind === 'bool') return false
  if (v === null || v === undefined) return ''
  switch (spec.kind) {
    case 'number':
      if (typeof v === 'number') return Number.isFinite(v) ? v : ''
      if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
    case 'bool':
      if (typeof v === 'boolean') return v
      return String(v)
    case 'json':
      return typeof v === 'string' ? v : JSON.stringify(v)
    default:
      if (typeof v === 'object') return JSON.stringify(v)
      return typeof v === 'string' ? v : String(v)
  }
}

/** One text form of a cell, for comparing. */
export function cellKey(c: Cell | undefined | null): string {
  if (c === undefined || c === null || c === '') return ''
  if (typeof c === 'number') return Number.isFinite(c) ? String(c) : ''
  if (typeof c === 'boolean') return c ? 'true' : 'false'
  return c
}

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string }

const YES = new Set(['true', 'yes', 'y', 'si', 'sí', '1', 'x', 'verdadero'])
const NO = new Set(['false', 'no', 'n', '0', 'falso'])

function validDay(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
const p2 = (n: number) => String(n).padStart(2, '0')

/** Read a cell typed in the sheet back into an app value. Refuses values that do not fit, in a plain sentence. */
export function fromCell(c: Cell, spec: ColumnSpec): Parsed {
  if (c === '' || c === null || c === undefined || (typeof c === 'string' && !c.trim())) return { ok: true, value: null }
  switch (spec.kind) {
    case 'number': {
      if (typeof c === 'number') return Number.isFinite(c) ? { ok: true, value: c } : { ok: false, error: 'WANTS A NUMBER' }
      if (typeof c === 'boolean') return { ok: false, error: 'WANTS A NUMBER' }
      const s = c.replace(/[₡$,\s]/g, '').replace(/^US/i, '')
      const n = Number(s)
      return s && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'WANTS A NUMBER' }
    }
    case 'bool': {
      if (typeof c === 'boolean') return { ok: true, value: c }
      const s = String(c).trim().toLowerCase()
      if (YES.has(s)) return { ok: true, value: true }
      if (NO.has(s)) return { ok: true, value: false }
      return { ok: false, error: 'WANTS A TICK (TRUE OR FALSE)' }
    }
    case 'date': {
      const s = String(c).trim()
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s)
      if (!m || !validDay(+m[1], +m[2], +m[3])) return { ok: false, error: 'WANTS A DATE LIKE 2026-11-07' }
      return { ok: true, value: `${m[1]}-${p2(+m[2])}-${p2(+m[3])}` }
    }
    case 'datetime': {
      const s = String(c).trim()
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i.exec(s)
      if (!m || !validDay(+m[1], +m[2], +m[3])) return { ok: false, error: 'WANTS A TIME LIKE 2026-11-07 14:30 (UTC)' }
      const [h, mi, se] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)]
      if (h > 23 || mi > 59 || se > 59) return { ok: false, error: 'WANTS A TIME LIKE 2026-11-07 14:30 (UTC)' }
      let zone = (m[8] ?? 'Z').toUpperCase()
      if (zone === 'UTC') zone = 'Z'
      if (zone !== 'Z' && !zone.includes(':')) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`
      const iso = `${m[1]}-${p2(+m[2])}-${p2(+m[3])}T${p2(h)}:${p2(mi)}:${p2(se)}${m[7] ?? ''}${zone}`
      const t = Date.parse(iso)
      return Number.isFinite(t) ? { ok: true, value: new Date(t).toISOString() } : { ok: false, error: 'WANTS A TIME LIKE 2026-11-07 14:30 (UTC)' }
    }
    case 'json': {
      if (typeof c !== 'string') return { ok: false, error: 'WANTS A LIST LIKE ["a","b"]' }
      try {
        return { ok: true, value: JSON.parse(c) }
      } catch {
        return { ok: false, error: 'WANTS A LIST LIKE ["a","b"]' }
      }
    }
    default: {
      const s = typeof c === 'string' ? c : String(c)
      if (spec.choices?.length) {
        const hit = spec.choices.find((x) => x === s) ?? spec.choices.find((x) => x.toLowerCase() === s.trim().toLowerCase())
        if (hit === undefined) return { ok: false, error: `NOT ON THE LIST (${spec.choices.join(', ')})` }
        return { ok: true, value: hit }
      }
      return { ok: true, value: s }
    }
  }
}
