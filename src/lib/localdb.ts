// Browser storage backend (IndexedDB). One object store holds every table's rows,
// keyed by [table, id], so a new table needs no database upgrade.
import type { Backend, Row } from './store'

const STORE = 'rows'

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'))
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      const os = db.createObjectStore(STORE, { keyPath: ['t', 'id'] })
      os.createIndex('t', 't')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })

export class LocalBackend implements Backend {
  readonly kind = 'local' as const
  stale = false
  note?: string
  private constructor(private db: IDBDatabase) {}

  /** Opens the database, or throws if the browser blocks storage (private window, etc.). */
  static async create(name = 'mycol-local'): Promise<LocalBackend> {
    return new LocalBackend(await open(name))
  }

  load(table: string): Promise<Row[]> {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction(STORE).objectStore(STORE).index('t').getAll(table)
      req.onsuccess = () => resolve((req.result as ({ t: string } & Row)[]).map(({ t: _t, ...r }) => r as Row))
      req.onerror = () => reject(req.error)
    })
  }

  async put(table: string, rows: Row[]): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    for (const r of rows) os.put({ ...r, t: table })
    await done(tx)
  }

  async del(table: string, ids: string[]): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    for (const id of ids) os.delete([table, id])
    await done(tx)
  }

  /** Replace everything saved for a table. The linked-mode cache uses this. */
  async replace(table: string, rows: Row[]): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    const keys = os.index('t').getAllKeys(table)
    keys.onsuccess = () => {
      for (const k of keys.result) os.delete(k)
      for (const r of rows) os.put({ ...r, t: table })
    }
    await done(tx)
  }
}
