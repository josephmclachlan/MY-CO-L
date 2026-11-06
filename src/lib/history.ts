// Edit history: who changed what, when, from what to what.
//
// Every write that goes through the Store adds rows to the `edit_log` table:
// one row per record touched, listing each field's old and new value.
// The HISTORY screen reads them, and can put an old value back.

import type { Row } from './store'

export type EditOp = 'create' | 'update' | 'delete'
/** Why the write happened: a normal edit, an UNDO, a RESTORE from history, an import, or the app itself (starter list). */
export type EditVia = 'edit' | 'undo' | 'restore' | 'import' | 'system' | 'assistant'

export interface FieldChange {
  f: string
  old: unknown
  new: unknown
}

export interface EditEntry extends Row {
  id: string
  at: string
  who: string
  action_id: string
  label: string
  screen: string | null
  table_name: string
  row_id: string
  op: EditOp
  via: EditVia
  changes: FieldChange[]
  /** The whole record as it was, kept on deletes so it can be restored. */
  snapshot: Row | null
}

/** Fields that change on every save and say nothing useful in a history list. */
const QUIET = new Set(['id', 'updated_at', 'created_at'])
/** Fields too big to copy into every history line. */
const BIG = new Set(['data_url'])

/** Same value? Treats missing and null as the same, and compares objects by content. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Field-by-field difference between two versions of one record. */
export function diffRow(before: Row | null, after: Row | null): FieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const out: FieldChange[] = []
  for (const f of keys) {
    if (QUIET.has(f)) continue
    const o = before ? before[f] : null
    const n = after ? after[f] : null
    if (same(o, n)) continue
    // A photo is thousands of characters: the history says THAT it changed, and keeps the picture only in a delete's copy.
    if (BIG.has(f)) out.push({ f, old: o ? '[PHOTO]' : null, new: n ? '[PHOTO]' : null })
    else out.push({ f, old: o ?? null, new: n ?? null })
  }
  return out
}

/** Plain names for the tables, used in labels and the HISTORY screen. [one, many] */
export const TABLE_NAMES: Record<string, [string, string]> = {
  species: ['SPECIES', 'SPECIES'],
  strains: ['STRAIN', 'STRAINS'],
  cultures: ['CULTURE', 'CULTURES'],
  rooms: ['ROOM', 'ROOMS'],
  circuits: ['CIRCUIT', 'CIRCUITS'],
  equipment: ['EQUIPMENT', 'EQUIPMENT'],
  cook_runs: ['COOK RUN', 'COOK RUNS'],
  cook_readings: ['COOK READING', 'COOK READINGS'],
  grain_runs: ['GRAIN RUN', 'GRAIN RUNS'],
  block_lots: ['BLOCK LOT', 'BLOCK LOTS'],
  contaminants: ['CONTAMINANT', 'CONTAMINANTS'],
  lot_losses: ['LOT LOSS', 'LOT LOSSES'],
  hazard_logs: ['CONTAM LOG', 'CONTAM LOGS'],
  harvests: ['HARVEST', 'HARVESTS'],
  sales: ['SALE', 'SALES'],
  sale_lots: ['SALE LOT', 'SALE LOTS'],
  items: ['STOCK ITEM', 'STOCK ITEMS'],
  item_prices: ['ITEM PRICE', 'ITEM PRICES'],
  stock_moves: ['STOCK MOVE', 'STOCK MOVES'],
  energy_bills: ['POWER BILL', 'POWER BILLS'],
  labour_entries: ['LABOUR ENTRY', 'LABOUR ENTRIES'],
  reference_entries: ['REFERENCE', 'REFERENCES'],
  app_settings: ['SETTING', 'SETTINGS'],
  fx_rates: ['EXCHANGE RATE', 'EXCHANGE RATES'],
  bank_tests: ['T/E TEST', 'T/E TESTS'],
  viability_checks: ['TUBE CHECK', 'TUBE CHECKS'],
  strain_trials: ['STRAIN TRIAL', 'STRAIN TRIALS'],
  flush_log: ['FLUSH PIN DAY', 'FLUSH PIN DAYS'],
  photos: ['PHOTO', 'PHOTOS'],
  standing_orders: ['STANDING ORDER', 'STANDING ORDERS'],
  order_weeks: ['ORDER WEEK CHANGE', 'ORDER WEEK CHANGES'],
  cash_moves: ['MONEY ENTRY', 'MONEY ENTRIES'],
  budget_lines: ['BUDGET FIGURE', 'BUDGET FIGURES'],
  waste_log: ['WASTE ENTRY', 'WASTE ENTRIES'],
  power_cuts: ['POWER CUT', 'POWER CUTS'],
  water_tests: ['WATER TEST', 'WATER TESTS'],
  maint_items: ['MAINTENANCE ITEM', 'MAINTENANCE ITEMS'],
  maint_log: ['MAINTENANCE LOG LINE', 'MAINTENANCE LOG LINES'],
  clean_log: ['CLEANING ENTRY', 'CLEANING ENTRIES'],
  checklist_runs: ['CHECKLIST SIGN-OFF', 'CHECKLIST SIGN-OFFS'],
  reminders: ['REMINDER', 'REMINDERS'],
  sensor_readings: ['SENSOR READING', 'SENSOR READINGS'],
  sensors: ['SENSOR', 'SENSORS'],
  ac_log: ['AC CHECK', 'AC CHECKS'],
}

/** Which screen each table is edited on, so the HISTORY filter can say it in the farm's words. */
export const TABLE_SCREEN: Record<string, string> = {
  strains: 'XENOGENETICS',
  cultures: 'XENOGENETICS',
  grain_runs: 'XENOGENETICS',
  bank_tests: 'XENOGENETICS',
  viability_checks: 'XENOGENETICS',
  block_lots: 'MISSION CONTROL',
  harvests: 'MISSION CONTROL',
  lot_losses: 'MISSION CONTROL',
  strain_trials: 'PRODUCTION RECORDS',
  flush_log: 'PRODUCTION RECORDS',
  photos: 'MISSION CONTROL',
  standing_orders: 'STANDING ORDERS',
  order_weeks: 'STANDING ORDERS',
  cash_moves: 'MONEY',
  budget_lines: 'MONEY',
  waste_log: 'MONEY',
  power_cuts: 'FACILITY LOGS',
  sensors: 'ATMOSPHERICS',
  sensor_readings: 'ATMOSPHERICS',
  ac_log: 'ATMOSPHERICS',
  water_tests: 'FACILITY LOGS',
  maint_items: 'FACILITY LOGS',
  maint_log: 'FACILITY LOGS',
  clean_log: 'FACILITY LOGS',
  checklist_runs: 'FACILITY LOGS',
  reminders: 'FACILITY LOGS',
  hazard_logs: 'HAZARD INDEX',
  cook_runs: 'PROPULSION',
  cook_readings: 'PROPULSION',
  items: 'CARGO',
  item_prices: 'CARGO',
  stock_moves: 'CARGO',
  sales: 'TRADE',
  sale_lots: 'TRADE',
  energy_bills: 'LEDGER',
  labour_entries: 'LEDGER',
  app_settings: 'PRICES + COSTS',
  fx_rates: 'PRICES + COSTS',
}

export const tableName = (t: string, n = 1) => {
  const p = TABLE_NAMES[t]
  if (!p) return t.replace(/_/g, ' ').toUpperCase()
  return n === 1 ? p[0] : p[1]
}

/** A short label for a write nobody named: SAVED SALE, DELETED 3 HARVESTS. */
export function autoLabel(parts: { table: string; op: EditOp }[]): string {
  if (!parts.length) return 'NO CHANGE'
  const byKey = new Map<string, { table: string; op: EditOp; n: number }>()
  for (const p of parts) {
    const k = `${p.op}:${p.table}`
    const e = byKey.get(k) ?? { ...p, n: 0 }
    e.n++
    byKey.set(k, e)
  }
  const verb: Record<EditOp, string> = { create: 'ADDED', update: 'CHANGED', delete: 'DELETED' }
  const bits = [...byKey.values()].map((e) => `${verb[e.op]} ${e.n > 1 ? `${e.n} ` : ''}${tableName(e.table, e.n)}`)
  return bits.length > 2 ? `${bits.slice(0, 2).join(', ')} +${bits.length - 2} MORE` : bits.join(', ')
}

/** Plain field names: block_lot_id -> BLOCK LOT, kg -> KG. */
export function fieldName(f: string): string {
  return f.replace(/_id$/, '').replace(/_/g, ' ').toUpperCase()
}

/** One value as text for the history list. Long text is shortened with a marker, never cut by the screen. */
export function showValue(v: unknown, max = 80): string {
  if (v === null || v === undefined || v === '') return '(EMPTY)'
  let s: string
  if (typeof v === 'boolean') s = v ? 'YES' : 'NO'
  else if (typeof v === 'number') s = String(v)
  else if (typeof v === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) s = `#${v.slice(0, 8)}`
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && Number.isFinite(Date.parse(v))) {
      const d = new Date(v)
      const p = (n: number) => String(n).padStart(2, '0')
      s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    } else s = v
  }
  else s = JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

/** A name a person would recognise for a record: its code, lot code, name or label. */
export function rowName(table: string, r: Row | null | undefined): string {
  if (!r) return ''
  if (table === 'fx_rates' && typeof r.day === 'string') return r.day
  if (table === 'budget_lines') return `BUDGET ${String(r.month ?? '')} ${String(r.line ?? '').toUpperCase()}`
  if (table === 'cash_moves') return `${String(r.day ?? '')} ${String(r.line ?? '').toUpperCase()}`
  if (table === 'waste_log') return `WASTE ${String(r.logged_on ?? '')}`
  if (table === 'power_cuts') return `${r.kind === 'test' ? 'TEST RUN' : 'CUT'} ${Number.isFinite(Date.parse(String(r.down_at))) ? new Date(Date.parse(String(r.down_at)) - 6 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : ''}`
  if (table === 'water_tests') return `WATER ${String(r.tested_on ?? '')} ${String(r.point ?? '').toUpperCase()}`
  if (table === 'maint_items') return String(r.name ?? '')
  if (table === 'maint_log') return `DONE ${String(r.done_on ?? '')}`
  if (table === 'clean_log') return `CLEAN ${String(r.room_id ?? '').toUpperCase()} ${String(r.cleaned_on ?? '')}`
  if (table === 'checklist_runs') return `${String(r.template ?? '').toUpperCase()} ${String(r.done_on ?? '')}`
  if (table === 'reminders') return String(r.text ?? '').slice(0, 40)
  if (table === 'sensor_readings') return `${String(r.place ?? '').toUpperCase()} ${Number.isFinite(Date.parse(String(r.taken_at))) ? new Date(Date.parse(String(r.taken_at)) - 6 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : ''}`
  if (table === 'ac_log') return `${String(r.unit ?? '').toUpperCase()} ${Number.isFinite(Date.parse(String(r.logged_at))) ? new Date(Date.parse(String(r.logged_at)) - 6 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : ''}`
  if (table === 'sales' && typeof r.receipt_no === 'string' && r.receipt_no) return `${r.receipt_no} ${String(r.buyer ?? '').toUpperCase()}`.trim()
  const pick = ['code', 'lot_code', 'label', 'name', 'buyer', 'unit_label', 'run_ref', 'checked_on', 'started_on', 'harvested_on', 'sold_on', 'moved_at']
  for (const k of pick) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) return k === 'moved_at' ? v.slice(0, 10) : v.toUpperCase()
  }
  if (table === 'photos') return `PHOTO ${typeof r.caption === 'string' && r.caption ? r.caption.toUpperCase() : String(r.taken_at ?? '').slice(0, 10)}`
  if (table === 'order_weeks') return `WEEK ${String(r.week_start ?? '')}`
  if (table === 'flush_log') return `FLUSH ${String(r.flush)} PINS ${String(r.pinned_on ?? '')}`
  if (table === 'app_settings') return String(r.id).toUpperCase()
  return `#${String(r.id).slice(0, 8)}`
}

// ---------- who is making the change ----------

const OPERATOR_KEY = 'mycol.operator.v1'
/** GUESS - REVIEW: name used in the history when nobody is logged in (local mode). */
export const DEFAULT_OPERATOR = 'OWNER'

export function getOperator(): string {
  try {
    return localStorage.getItem(OPERATOR_KEY)?.trim() || DEFAULT_OPERATOR
  } catch {
    return DEFAULT_OPERATOR
  }
}
export function setOperator(name: string) {
  try {
    const v = name.trim().toUpperCase().slice(0, 24)
    if (v) localStorage.setItem(OPERATOR_KEY, v)
    else localStorage.removeItem(OPERATOR_KEY)
  } catch {
    /* storage blocked: keep the default */
  }
}

/** Above this many records in one action, the history keeps one summary line per table instead of one per record. */
export const SUMMARY_OVER = 200
