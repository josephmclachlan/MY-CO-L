// The Google Sheet sync for this device: settings, one SheetSync per Store, status for the screen,
// and the timer that syncs every few minutes while the app is open.

import { useEffect, useSyncExternalStore } from 'react'
import type { Store } from '../lib/store'
import { AppsScriptClient, checkUrl } from '../lib/sheets/client'
import { SheetSync, SYNC_DEFAULTS, type SyncReport, type SyncState } from '../lib/sheets/engine'
import { IdbState, loadSheetSettings, saveSheetSettings, type SheetSettings } from '../lib/sheets/state'
import { useStore } from './StoreContext'
import { useRole } from '../settings/RoleContext'

export interface SheetStatus {
  settings: SheetSettings
  running: boolean
  error: string | null
  lastRun: SyncReport | null
  state: SyncState | null
  linkedTo: string | null
}

class SheetController {
  settings = loadSheetSettings()
  running = false
  error: string | null = null
  linkedTo: string | null = null
  private sync: SheetSync | null = null
  private saved = new IdbState()
  private subs = new Set<() => void>()
  private snap: SheetStatus | null = null
  constructor(readonly store: Store) {
    saveSheetSettings(this.settings) // keep the key made on first open
    void this.engine()?.init().then(() => this.bump())
  }

  subscribe = (f: () => void) => {
    this.subs.add(f)
    return () => void this.subs.delete(f)
  }
  status = (): SheetStatus => {
    if (!this.snap) this.snap = { settings: this.settings, running: this.running, error: this.error, lastRun: this.sync?.state.lastRun ?? null, state: this.sync?.state ?? null, linkedTo: this.linkedTo }
    return this.snap
  }
  private bump() {
    this.snap = null
    for (const f of this.subs) f()
  }

  private engine(): SheetSync | null {
    const s = this.settings
    if (checkUrl(s.url)) return null
    if (!this.sync || (this.sync.client as AppsScriptClient).url !== s.url) {
      this.sync = new SheetSync(this.store, new AppsScriptClient(s.url, s.key), this.saved, { ...SYNC_DEFAULTS, readings: s.readings })
    }
    this.sync.opts = { ...this.sync.opts, readings: s.readings }
    return this.sync
  }

  update(p: Partial<SheetSettings>) {
    const urlChanged = p.url !== undefined && p.url.trim() !== this.settings.url
    const keyChanged = p.key !== undefined && p.key !== this.settings.key
    this.settings = { ...this.settings, ...p, url: (p.url ?? this.settings.url).trim() }
    saveSheetSettings(this.settings)
    if (keyChanged) this.sync = null
    if (urlChanged || keyChanged) {
      this.linkedTo = null
      this.error = null
    }
    this.bump()
  }

  async test(): Promise<string> {
    const bad = checkUrl(this.settings.url)
    if (bad) throw new Error(bad)
    const r = await new AppsScriptClient(this.settings.url, this.settings.key).hello()
    this.linkedTo = r.sheet
    this.bump()
    return r.sheet
  }

  /** A new sheet: forget what was synced, so the next run writes everything. */
  async forget() {
    const e = this.engine()
    if (e) await e.reset()
    else await this.saved.save({ cursor: null, base: {}, lastFull: null, lastRun: null, notes: [] })
    this.bump()
  }

  async run(full = false): Promise<SyncReport | null> {
    const e = this.engine()
    if (!e) throw new Error(checkUrl(this.settings.url) ?? 'NO SHEET LINKED.')
    if (this.running) return null
    this.running = true
    this.bump()
    try {
      const r = await e.run(full)
      this.error = null
      return r
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      this.running = false
      this.bump()
    }
  }
}

const controllers = new WeakMap<Store, SheetController>()
export function sheetController(store: Store): SheetController {
  let c = controllers.get(store)
  if (!c) {
    c = new SheetController(store)
    controllers.set(store, c)
  }
  return c
}

export function useSheetSync() {
  const store = useStore()
  const c = sheetController(store)
  const status = useSyncExternalStore(c.subscribe, c.status)
  return { c, status }
}

/** Syncs every few minutes while the app is open, and when the signal comes back. Owner only. Draws nothing. */
export function SheetAutoSync() {
  const store = useStore()
  const { role } = useRole()
  const c = sheetController(store)
  const s = useSyncExternalStore(c.subscribe, c.status).settings
  const on = role === 'owner' && s.auto && !checkUrl(s.url) && store.backend.kind !== 'locked' && !store.placeholder
  useEffect(() => {
    if (!on) return
    const go = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void c.run().catch(() => undefined) // the error shows on DATA > GOOGLE SHEET
    }
    const first = setTimeout(go, 15000)
    const every = setInterval(go, Math.max(1, s.everyMin) * 60000)
    window.addEventListener('online', go)
    return () => {
      clearTimeout(first)
      clearInterval(every)
      window.removeEventListener('online', go)
    }
  }, [on, c, s.everyMin])
  return null
}
