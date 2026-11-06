// Roles: OWNER sees everything, STAFF logs the work and never sees money.
//
// Where the role comes from:
//  - LINKED to Supabase: the login's app_metadata.role ("staff"), which only the dashboard or SQL can set.
//    (user_metadata is NOT used: a person can edit their own.) No role = owner. The database enforces it too
//    (migration 0016): staff cannot read the money tables even with the app's code changed.
//  - LOCAL mode (no accounts yet): the owner can lock THIS DEVICE to staff with a PIN. That is a convenience lock
//    to keep a helper out of the money screens. It is NOT security: the data sits in this browser and anyone who
//    knows how can reach it. Real separation needs the Supabase login.

export type Role = 'owner' | 'staff'

/** Screens STAFF may open. Money screens, edit history, export and the textbook are owner only. */
export const STAFF_MODULES: readonly string[] = ['SPECIMEN', 'VITALS', 'DECK', 'CARGO', 'XENO', 'HAZARD', 'PROPULSION', 'SEQUENCE', 'MISSION', 'YIELD', 'FACILITY', 'ATMOS', 'SEARCH', 'STAFF', 'ASK', 'GUIDE']
/** Owner-only screens, listed so the tests and the screen can say it. */
export const OWNER_ONLY_MODULES: readonly string[] = ['LEDGER', 'TRADE', 'ORDERS', 'MONEY', 'HISTORY', 'DATA', 'MANUAL']

export const canOpenModule = (role: Role, key: string): boolean => role === 'owner' || STAFF_MODULES.includes(key)
/** Prices, costs, sales, owed money. */
export const canSeeMoney = (role: Role): boolean => role === 'owner'

/** Role from a Supabase user. Only app_metadata counts. */
export function roleFromUser(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): Role {
  return String(user?.app_metadata?.role ?? '').toLowerCase() === 'staff' ? 'staff' : 'owner'
}

// ---------- the device lock (local mode) ----------

export interface DeviceLock {
  role: Role
  /** Hex PBKDF2 of the owner PIN, and its salt. Absent until a PIN is set. */
  hash?: string
  salt?: string
  /** Wrong tries in a row, and the time (ms) until which tries are refused. */
  fails?: number
  until?: number
}

const KEY = 'mycol.devicerole.v1'
export interface KV {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}
const ls = (): KV | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadLock(kv: KV | null = ls()): DeviceLock {
  try {
    const raw = kv?.getItem(KEY)
    if (!raw) return { role: 'owner' }
    const d = JSON.parse(raw) as DeviceLock
    return { ...d, role: d.role === 'staff' ? 'staff' : 'owner' }
  } catch {
    return { role: 'owner' }
  }
}
export function saveLock(d: DeviceLock, kv: KV | null = ls()) {
  try {
    kv?.setItem(KEY, JSON.stringify(d))
  } catch {
    /* storage blocked: the lock cannot be kept */
  }
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, key, 256))
}
export const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer)

export const PIN_MIN = 8 // Joseph 6 Nov 2026: an 8-digit PIN
export const PIN_MAX = 8
export const PIN_TRIES = 5
export const PIN_WAIT_MS = 30000
export const validPin = (pin: string) => /^\d+$/.test(pin) && pin.length >= PIN_MIN && pin.length <= PIN_MAX

export async function setOwnerPin(pin: string, kv: KV | null = ls()): Promise<DeviceLock> {
  if (!validPin(pin)) throw new Error(PIN_MIN === PIN_MAX ? `THE PIN IS ${PIN_MIN} DIGITS.` : `THE PIN IS ${PIN_MIN} TO ${PIN_MAX} DIGITS.`)
  const salt = newSalt()
  const d: DeviceLock = { ...loadLock(kv), salt, hash: await hashPin(pin, salt), fails: 0, until: 0 }
  saveLock(d, kv)
  return d
}

/** Lock this device to STAFF. Needs a PIN to exist, so the owner can get back in. */
export function lockToStaff(kv: KV | null = ls()): DeviceLock {
  const d = loadLock(kv)
  if (!d.hash) throw new Error('SET AN OWNER PIN FIRST. WITHOUT ONE NOBODY COULD UNLOCK THIS DEVICE.')
  const n: DeviceLock = { ...d, role: 'staff' }
  saveLock(n, kv)
  return n
}

/** Try a PIN. Five wrong tries in a row make the device refuse tries for 30 seconds. */
export async function unlockWithPin(pin: string, now = Date.now(), kv: KV | null = ls()): Promise<{ ok: boolean; wait?: number; left?: number }> {
  const d = loadLock(kv)
  if (!d.hash || !d.salt) return { ok: false }
  if ((d.until ?? 0) > now) return { ok: false, wait: Math.ceil(((d.until ?? 0) - now) / 1000) }
  const ok = (await hashPin(pin, d.salt)) === d.hash
  if (ok) {
    saveLock({ ...d, role: 'owner', fails: 0, until: 0 }, kv)
    return { ok: true }
  }
  const fails = (d.fails ?? 0) + 1
  if (fails >= PIN_TRIES) {
    saveLock({ ...d, fails: 0, until: now + PIN_WAIT_MS }, kv)
    return { ok: false, wait: PIN_WAIT_MS / 1000 }
  }
  saveLock({ ...d, fails }, kv)
  return { ok: false, left: PIN_TRIES - fails }
}

// ---------- what STAFF may not read ----------

/** Tables with money in them (and the history, which holds old values). Staff read these as empty and cannot write them.
 *  The same list is in migration 0016, where the database refuses them too. */
export const STAFF_DENIED_TABLES: readonly string[] = [
  'sales', 'sale_lots', 'item_prices', 'energy_bills', 'labour_entries', 'standing_orders', 'order_weeks',
  'cash_moves', 'budget_lines', 'waste_log', 'fx_rates', 'edit_log',
]
/** app_settings rows staff may not read: the money plan and the price tables. Practice, facility and sensor settings stay. */
export const STAFF_HIDDEN_SETTINGS: readonly string[] = ['money', 'rates']

export const staffHideRow = (table: string, r: { id: string }) => table === 'app_settings' && STAFF_HIDDEN_SETTINGS.includes(r.id)
