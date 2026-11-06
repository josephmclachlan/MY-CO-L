import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { loadPrefs, savePrefs, type CargoPrefs } from '../lib/cargo'
import { seedStarter } from '../lib/cargoActions'
import { useApp } from '../settings/AppContext'
import { supabase } from '../lib/supabase'
import { Store, MemoryBackend, type Backend, type Row } from '../lib/store'
import { LocalBackend } from '../lib/localdb'
import { useFx } from './useFx'
import { setManualRate } from '../lib/fx'
import { RemoteBackend } from '../lib/remotedb'

const Ctx = createContext<Store | null>(null)

async function makeBackend(userId: string | null): Promise<Backend> {
  if (supabase) {
    if (!userId) return new MemoryBackend('locked', 'DATABASE LOCKED. PRESS F8 TO LOG IN.')
    // Cache lives in its own database so it never mixes with local-mode data.
    const cache = await LocalBackend.create(`mycol-cache-${userId}`).catch(() => null)
    return new RemoteBackend(supabase, cache)
  }
  try {
    return await LocalBackend.create()
  } catch {
    const m = new MemoryBackend('memory', 'THIS BROWSER BLOCKS STORAGE. NOTHING IS SAVED. USE EXPORT BEFORE YOU LEAVE.')
    return m
  }
}

/** Gives every screen the same Store. Local mode until Supabase is linked and the owner is signed in. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { session } = useApp()
  const userId = session?.user.id ?? null
  const [store, setStore] = useState<Store | null>(null)

  useEffect(() => {
    let live = true
    void makeBackend(userId).then((b) => {
      if (!live) return
      const st = new Store(b)
      setStore(st)
      void seedStarter(st, false)
    })
    return () => {
      live = false
    }
  }, [userId])

  // Until the backend opens, screens get an empty memory store so hooks never see null.
  const idle = useMemo(() => new Store(new MemoryBackend('memory')), [])
  return <Ctx.Provider value={store ?? idle}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore must be used inside StoreProvider')
  return s
}

/** Live rows of one table. Re-renders when anything in the store changes. */
export function useTable<T extends Row = Row>(table: string): T[] {
  const s = useStore()
  useSyncExternalStore(s.subscribe, s.version)
  return s.rows<T>(table)
}

/** Re-render on any store change (status, errors). */
export function useStoreStatus() {
  const s = useStore()
  useSyncExternalStore(s.subscribe, s.version)
  return { status: s.status, kind: s.backend.kind, note: s.backend.note, error: s.error }
}

// ---------- device preferences for CARGO (exchange rate, substrate form) ----------

let prefs = loadPrefs()
const prefListeners = new Set<() => void>()
export function useCargoPrefs(): [CargoPrefs, (p: Partial<CargoPrefs>) => void] {
  const p = useSyncExternalStore(
    (fn) => (prefListeners.add(fn), () => void prefListeners.delete(fn)),
    () => prefs,
  )
  // The exchange rate is today's rate from the daily record (fx_rates); typing one here sets today's rate.
  const store = useStore()
  const fx = useFx()
  const set = (patch: Partial<CargoPrefs>) => {
    if (patch.fx !== undefined && patch.fx > 0 && patch.fx !== fx.today.rate) void setManualRate(store, fx.todayDay, patch.fx).catch(() => undefined)
    prefs = { ...prefs, ...patch }
    savePrefs(prefs)
    for (const l of prefListeners) l()
  }
  const merged = useMemo(() => (p.fx === fx.today.rate ? p : { ...p, fx: fx.today.rate }), [p, fx.today.rate])
  return [merged, set]
}
