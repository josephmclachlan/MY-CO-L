import { createContext, useContext } from 'react'

/** The tabs the open station owns. Null when the screen is not open as a station: then every tab shows. */
export const StationTabsContext = createContext<readonly string[] | null>(null)

/** A screen's own tab list, cut down to the open station's tabs (the whole list when no station owns any of them). */
export function useStationTabs<T extends string>(all: readonly T[]): T[] {
  const allowed = useContext(StationTabsContext)
  if (!allowed) return [...all]
  const mine = all.filter((t) => allowed.includes(t))
  return mine.length ? mine : [...all]
}
