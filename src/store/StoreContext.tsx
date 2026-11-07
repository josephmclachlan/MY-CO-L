import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { loadPrefs, savePrefs, type CargoPrefs } from '../lib/cargo'
import { seedStarter } from '../lib/cargoActions'
import { useApp } from '../settings/AppContext'
import { useRole } from '../settings/RoleContext'
import { STAFF_DENIED_TABLES, staffHideRow, type Role } from '../lib/roles'
import { supabase } from '../lib/supabase'
import { Store, MemoryBackend, type Backend, type Row } from '../lib/store'
import { LocalBackend } from '../lib/localdb'
import { useFx } from './useFx'
import { setManualRate } from '../lib/fx'
import { remoteBackend } from '../lib/remotedb'
import { getOperator, setOperator } from '../lib/history'
import type { SyncBackend } from '../lib/sync'

const Ctx = createContext<Store | null>(null)

/** Ask the browser to keep this site's saved data even when the device runs low on space.
 *  Saved data is the only copy in local mode, so this matters. Browsers may say no; HISTORY > SAVING + SYNC shows the answer. */
function keepStorage() {
  try {
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    /* not supported */
  }
}

async function makeBackend(userId: string | null): Promise<Backend> {
  keepStorage()
  if (supabase) {
    if (!userId) return new MemoryBackend('locked', 'DATABASE LOCKED. PRESS F8 TO LOG IN.')
    // Cache lives in its own database so it never mixes with local-mode data.
    const cache = await LocalBackend.create(`mycol-cache-${userId}`).catch(() => null)
    return remoteBackend(supabase, cache)
  }
  try {
    return await LocalBackend.create()
  } catch {
    const m = new MemoryBackend('memory', 'THIS BROWSER BLOCKS STORAGE. NOTHING IS SAVED. USE EXPORT BEFORE YOU LEAVE.')
    return m
  }
}

/** The name written in the edit history: the login email when linked, else the operator name set on this device. */
const whoFor = (email: string | null) => (email ? email.toUpperCase() : getOperator())

/** STAFF reads the money tables as empty and cannot write them (the database refuses them too: migration 0016). */
const limitFor = (st: Store, role: Role) => (role === 'staff' ? st.setAccess(STAFF_DENIED_TABLES, staffHideRow) : st.setAccess([]))

/** Gives every screen the same Store. Local mode until Supabase is linked and the owner is signed in. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const { session } = useApp()
  const userId = session?.user.id ?? null
  const email = session?.user.email ?? null
  const { role } = useRole()
  const roleRef = useRef(role)
  roleRef.current = role
  const [store, setStore] = useState<Store | null>(null)

  useEffect(() => {
    let live = true
    void makeBackend(userId).then((b) => {
      if (!live) return
      const st = new Store(b)
      st.who = whoFor(email)
      limitFor(st, roleRef.current)
      setStore(st)
      void st.action('STARTER LIST', () => seedStarter(st, false), { undoable: false, via: 'system' })
    })
    return () => {
      live = false
    }
  }, [userId])
  // Locking or unlocking this device (or another login) changes what the same data copy may show.
  useEffect(() => {
    if (store) limitFor(store, role)
  }, [role, store])
  // Only the newest data copy may send the offline queue.
  useEffect(() => () => (store?.backend as { stop?: () => void } | undefined)?.stop?.(), [store])

  // Until the backend opens, screens get an empty memory store so hooks never see null.
  const idle = useMemo(() => {
    const s = new Store(new MemoryBackend('memory'))
    s.placeholder = true
    return s
  }, [])
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

/** The operator name for the history (local mode). Linked mode uses the login email. */
export function useOperator(): [string, (name: string) => void, boolean] {
  const s = useStore()
  const { session } = useApp()
  useSyncExternalStore(s.subscribe, s.version)
  const email = session?.user.email ?? null
  const set = (name: string) => {
    setOperator(name)
    s.who = whoFor(email)
    s.touch()
  }
  return [s.who, set, !!email]
}

export type LampState = 'LOCAL' | 'SYNCED' | 'WAITING' | 'CONFLICT' | 'OFFLINE' | 'LOCKED' | 'NOT SAVED'
/** What the title-bar lamp shows, plus the queue and conflict lists for HISTORY > SYNC. */
export function useSync() {
  const s = useStore()
  useSyncExternalStore(s.subscribe, s.version)
  const b = s.backend
  const sb = 'info' in b ? (b as unknown as SyncBackend) : null
  const info = sb?.info() ?? null
  let lamp: LampState
  if (b.kind === 'locked') lamp = 'LOCKED'
  else if (b.kind === 'memory') lamp = 'NOT SAVED'
  else if (!sb) lamp = 'LOCAL'
  else if (info!.conflicts) lamp = 'CONFLICT'
  else if (info!.waiting) lamp = 'WAITING'
  else if (!info!.online) lamp = 'OFFLINE'
  else lamp = 'SYNCED'
  return { lamp, info, backend: sb, store: s }
}

/** The newest undoable action, for the UNDO button. */
export function useUndo() {
  const s = useStore()
  useSyncExternalStore(s.subscribe, s.version)
  return { last: s.undoPeek(), list: s.undoList(), undo: () => s.undo(), store: s }
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
