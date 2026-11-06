import { useCallback, useEffect, useMemo } from 'react'
import { useStore, useTable } from './StoreContext'
import { useRates } from './useRates'
import { FX_TABLE, fxOn, sortRates, syncRates, type FxLookup, type FxRate } from '../lib/fx'

const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface Fx {
  /** The rate for a day (that day's, else the nearest before it). */
  on: (day: string) => FxLookup
  rate: (day: string) => number
  /** Today's rate and where it came from. */
  today: FxLookup
  todayDay: string
  rows: FxRate[]
  fallback: number
}

/** Colones per dollar by day. Every US$ on screen goes through this, at the record's own day. */
export function useFx(): Fx {
  const raw = useTable<FxRate>(FX_TABLE)
  const r = useRates()
  const rows = useMemo(() => sortRates(raw), [raw])
  const on = useCallback((day: string) => fxOn(day, rows, r.fx), [rows, r.fx])
  const todayDay = todayLocal()
  return { on, rate: (d) => on(d).rate, today: on(todayDay), todayDay, rows, fallback: r.fx }
}

/** Fetch today's rate, and the rates of past days the screen shows, if they are missing. */
export function useFxSync(days: string[] = []) {
  const store = useStore()
  const key = [...new Set(days.map((d) => d.slice(0, 10)))].sort().join(',')
  useEffect(() => {
    void syncRates(store, key ? key.split(',') : [], todayLocal())
  }, [store, key])
}
