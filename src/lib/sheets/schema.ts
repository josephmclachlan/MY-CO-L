// How each record table is laid out in the Google Sheet: tab name, tab colour, which columns, in what order,
// which are read only, and the kind of value each column holds.

import { BACKUP_TABLES, type Row } from '../store'
import { LINKS } from '../dataExport'
import { TABLE_NAMES } from '../history'
import { SPECIES } from '../../data/species'
import { DB_COLUMNS } from './columns.gen'
import type { ColumnKind, ColumnSpec, SheetColumn } from './types'

/** The ACTION column: type DELETE to delete the record. */
export const ACTION = '_action'
/** Stamped by the sheet script when a person edits the row. */
export const EDITED = '_edited_at'
export const DELETE_WORDS = new Set(['DELETE', 'BORRAR', 'DEL'])

/** Tab groups, in order, with a tab colour each (the sheet's tab strip reads like the app's menu). */
const GROUPS: { name: string; color: string; tables: string[] }[] = [
  { name: 'GENETICS', color: '#2e7d32', tables: ['species', 'strains', 'cultures', 'bank_tests', 'viability_checks', 'strain_trials'] },
  { name: 'PRODUCTION', color: '#558b2f', tables: ['grain_runs', 'block_lots', 'flush_log', 'harvests', 'lot_losses', 'photos'] },
  { name: 'COOK', color: '#c62828', tables: ['cook_runs', 'cook_readings'] },
  { name: 'CONTAMINATION', color: '#f9a825', tables: ['contaminants', 'hazard_logs'] },
  { name: 'STOCK', color: '#6d4c41', tables: ['items', 'item_prices', 'stock_moves'] },
  { name: 'SALES AND MONEY', color: '#1565c0', tables: ['sales', 'sale_lots', 'standing_orders', 'order_weeks', 'cash_moves', 'budget_lines', 'waste_log', 'energy_bills', 'labour_entries', 'fx_rates'] },
  { name: 'FACILITY', color: '#00838f', tables: ['rooms', 'circuits', 'equipment', 'power_cuts', 'water_tests', 'maint_items', 'maint_log', 'clean_log', 'checklist_runs', 'reminders'] },
  { name: 'CLIMATE', color: '#4527a0', tables: ['sensors', 'ac_log', 'sensor_readings'] },
  { name: 'REFERENCE', color: '#757575', tables: ['reference_entries', 'app_settings', 'edit_log'] },
]

/** Whole tabs that are read only. Exchange rates: every money record keeps its own day's rate, changed only in the app. */
const READ_ONLY_TABLES = new Set(['fx_rates', 'edit_log', 'sensor_readings'])
/** Columns left out of the sheet (a photo is too big for a cell). */
const OMIT: Record<string, string[]> = { photos: ['data_url'] }
/** Read-only id and time columns, placed at the far right. */
const TAIL = ['id', 'created_at', 'updated_at']

/** Plain tab names: "Block lots", "T/E tests". */
const TAB_NAMES: Record<string, string> = {
  edit_log: 'Edit history',
  items: 'Stock items',
  flush_log: 'Flush log',
  order_weeks: 'Order weeks',
  maint_items: 'Upkeep items',
  maint_log: 'Upkeep log',
  clean_log: 'Cleaning log',
  checklist_runs: 'Checklists',
  app_settings: 'App settings',
  reference_entries: 'Reference',
  energy_bills: 'Power bills',
}
export function tabName(table: string): string {
  if (TAB_NAMES[table]) return TAB_NAMES[table]
  const many = TABLE_NAMES[table]?.[1] ?? table.replace(/_/g, ' ').toUpperCase()
  return (many.charAt(0) + many.slice(1).toLowerCase()).replace(/^t\/e\b/i, 'T/E').replace(/^ac\b/i, 'A/C')
}

export interface SheetTable {
  table: string
  tab: string
  group: string
  color: string
  order: number
  readOnly: boolean
}

export const SHEET_TABLES: SheetTable[] = GROUPS.flatMap((g) => g.tables.map((t) => ({ table: t, tab: tabName(t), group: g.name, color: g.color, readOnly: READ_ONLY_TABLES.has(t) }))).map(
  (s, i) => ({ ...s, order: i + 1 }),
)
export const SHEET_BY_TABLE = new Map(SHEET_TABLES.map((s) => [s.table, s]))
export const SHEET_BY_TAB = new Map(SHEET_TABLES.map((s) => [s.tab, s]))

/** Every backup table must have a tab (the test checks this), plus the sensor readings. */
export const MIRRORED: readonly string[] = [...BACKUP_TABLES, 'sensor_readings']

const SPECIES_IDS = SPECIES.map((s) => s.id)

function inferKind(rows: Row[], f: string): ColumnKind {
  let k: ColumnKind | null = null
  for (const r of rows) {
    const v = r[f]
    if (v === null || v === undefined) continue
    const kk: ColumnKind = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : typeof v === 'object' ? 'json' : 'text'
    if (k && k !== kk) return 'text'
    k = kk
  }
  return k ?? 'text'
}

/** The rule for one field: the database's, or worked out from the values for a field only the app has. */
export function specOf(table: string, field: string, rows: Row[] = []): ColumnSpec {
  const db = DB_COLUMNS[table]?.[field]
  if (field === 'species_key') return { kind: 'text', choices: SPECIES_IDS, required: db?.required }
  if (db) return db
  return { kind: inferKind(rows, field) }
}

const KIND_NOTE: Record<ColumnKind, string> = {
  text: 'Text.',
  number: 'A number.',
  bool: 'Tick box.',
  date: 'A date: yyyy-mm-dd, e.g. 2026-11-07.',
  datetime: 'A UTC time: yyyy-mm-dd hh:mm, e.g. 2026-11-07 14:30 (farm clock is UTC-6).',
  json: 'A list or record written as JSON text, e.g. ["a","b"].',
}

/**
 * The columns of one tab. Database order first, then any field only the app holds, then the look-up
 * columns, then the id and times. Columns already in the sheet keep their place (the script only appends).
 */
export function tabColumns(table: string, rows: Row[]): SheetColumn[] {
  const st = SHEET_BY_TABLE.get(table)
  const ro = !!st?.readOnly
  const omit = new Set([...(OMIT[table] ?? []), ...TAIL])
  const fields: string[] = []
  const seen = new Set<string>()
  const add = (f: string) => {
    if (seen.has(f) || omit.has(f) || f.startsWith('_')) return
    seen.add(f)
    fields.push(f)
  }
  for (const f of Object.keys(DB_COLUMNS[table] ?? {})) add(f)
  for (const r of rows) for (const f of Object.keys(r)) add(f)
  const cols: SheetColumn[] = []
  if (!ro) cols.push({ name: ACTION, kind: 'text', ro: false, note: 'Type DELETE here to delete this record. Deleting the row itself does not delete it (the app puts it back).', choices: ['DELETE'] })
  for (const f of fields) {
    const s = specOf(table, f, rows)
    const note = [KIND_NOTE[s.kind], s.choices ? `One of: ${s.choices.join(', ')}.` : '', s.required ? 'Needed for a new record.' : '', f.endsWith('_id') ? 'The id of another record; easier to type the code in the look-up column instead.' : '']
    cols.push({ name: f, kind: s.kind, ro, choices: s.choices, note: note.filter(Boolean).join(' ') })
  }
  for (const [fk, ref, pick, name] of LINKS[table] ?? []) {
    if (seen.has(name) || !seen.has(fk)) continue
    cols.push({ name, kind: 'text', ro, note: `Look-up: the ${pick.replace(/_/g, ' ')} of the record in ${tabName(ref)} that ${fk} points at. Type another one here to point at that record.`, link: { fk, ref, pick } })
  }
  if (seen.has('species_key')) cols.push({ name: 'species_name', kind: 'text', ro: true, note: 'Look-up: the species name for species_key (read only).' })
  const tail = TAIL.filter((f) => f === 'id' || f in (DB_COLUMNS[table] ?? {}) || rows.some((r) => f in r))
  for (const f of tail) cols.push({ name: f, kind: f === 'id' ? 'text' : 'datetime', ro: true, note: f === 'id' ? 'The record id. The sheet makes one for a new row. Do not change it.' : 'Set by the app.' })
  cols.push({ name: EDITED, kind: 'datetime', ro: true, note: 'When a person last edited this row in the sheet (UTC). Set by the sheet.' })
  return cols
}
