// Where the sync keeps its memory on this device: settings in localStorage, the synced copy (base) in IndexedDB
// (it is as big as the records, too big for localStorage).

import { uuid } from '../store'
import type { StateStore, SyncState } from './engine'
import SCRIPT from '../../../sheets/Code.gs?raw'

export interface SheetSettings {
  url: string
  key: string
  /** Sync every few minutes while the app is open. */
  auto: boolean
  everyMin: number
  readings: boolean
}

const KEY = 'mycol.sheets.v1'
/** GUESS - REVIEW: sync every 5 minutes while the app is open. */
export const EVERY_MIN = 5

export function newKey(): string {
  return `${uuid()}${uuid()}`.replace(/-/g, '')
}

export function loadSheetSettings(): SheetSettings {
  let s: Partial<SheetSettings> = {}
  try {
    s = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<SheetSettings>
  } catch {
    s = {}
  }
  return { url: s.url ?? '', key: s.key || newKey(), auto: s.auto ?? true, everyMin: s.everyMin ?? EVERY_MIN, readings: s.readings ?? false }
}

export function saveSheetSettings(s: SheetSettings) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: settings last until the page closes */
  }
}

/** The script to paste into the sheet, with this device's key filled in. */
export function scriptWithKey(key: string): string {
  return SCRIPT.replace('__MYCOL_KEY__', key)
}

export class MemoryState implements StateStore {
  s: SyncState | null = null
  async load() {
    return this.s ? (JSON.parse(JSON.stringify(this.s)) as SyncState) : null
  }
  async save(s: SyncState) {
    this.s = JSON.parse(JSON.stringify(s)) as SyncState
  }
}

/** One record in its own small IndexedDB database. Falls back to memory if the browser blocks storage. */
export class IdbState implements StateStore {
  private mem = new MemoryState()
  private db: Promise<IDBDatabase | null>
  constructor(name = 'mycol-sheets') {
    this.db = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null)
        const req = indexedDB.open(name, 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  async load(): Promise<SyncState | null> {
    const db = await this.db
    if (!db) return this.mem.load()
    return new Promise((resolve) => {
      const r = db.transaction('kv').objectStore('kv').get('state')
      r.onsuccess = () => resolve((r.result as SyncState | undefined) ?? null)
      r.onerror = () => resolve(null)
    })
  }
  async save(s: SyncState): Promise<void> {
    const db = await this.db
    if (!db) return this.mem.save(s)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(s, 'state')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('SYNC MEMORY COULD NOT BE SAVED'))
    })
  }
}
