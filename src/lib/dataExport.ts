// EXPORT and BACKUP: every table as CSV, one ZIP with everything, and reading a backup back in.
// Pure helpers plus the Store calls. The screen (src/screens/Data.tsx) only adds buttons.

import { BACKUP_TABLES, type Row, type Store } from './store'
import { columnsOf, toCsv } from './csv'
import { bytesOf, isZip, makeZip, readZip, textOf, type ZipFile } from './zip'
import { SPECIES } from '../data/species'
import { tableName } from './history'

/** Everything that can be exported as CSV: the backup tables plus the sensor readings (too big for the backup file). */
export const EXPORT_TABLES: string[] = [...BACKUP_TABLES.filter((t) => t !== 'edit_log'), 'sensor_readings', 'edit_log']

/** Columns that are only a code or a name for a record another column points at, added to the end of the CSV
 *  so a spreadsheet reader does not have to match long ids by eye. [pointer column, table it points at, field to copy, new column] */
const LINKS: Record<string, [string, string, string, string][]> = {
  cultures: [['strain_id', 'strains', 'code', 'strain_code']],
  grain_runs: [['strain_id', 'strains', 'code', 'strain_code']],
  block_lots: [['strain_id', 'strains', 'code', 'strain_code']],
  harvests: [['block_lot_id', 'block_lots', 'lot_code', 'lot_code']],
  flush_log: [['block_lot_id', 'block_lots', 'lot_code', 'lot_code']],
  lot_losses: [['block_lot_id', 'block_lots', 'lot_code', 'lot_code']],
  sale_lots: [['block_lot_id', 'block_lots', 'lot_code', 'lot_code']],
  stock_moves: [['item_id', 'items', 'name', 'item_name']],
  item_prices: [['item_id', 'items', 'name', 'item_name']],
  hazard_logs: [['strain_id', 'strains', 'code', 'strain_code']],
  bank_tests: [['strain_id', 'strains', 'code', 'strain_code']],
  viability_checks: [['culture_id', 'cultures', 'label', 'culture_label']],
}
const SPECIES_NAME = new Map(SPECIES.map((s) => [s.id, s.name]))

/** One table as CSV text. Unreadable ids get a code or name column beside them. */
export async function tableCsv(store: Store, table: string): Promise<{ csv: string; rows: number }> {
  await store.ensure(table)
  const rows = store.rows(table)
  const extra = LINKS[table] ?? []
  const lookups = new Map<string, Map<string, Row>>()
  for (const [, ref] of extra) {
    if (lookups.has(ref)) continue
    await store.ensure(ref)
    lookups.set(ref, new Map(store.rows(ref).map((r) => [r.id, r])))
  }
  const hasSpecies = rows.some((r) => 'species_key' in r)
  const out: Record<string, unknown>[] = rows.map((r) => {
    const o: Record<string, unknown> = { ...r }
    for (const [fk, ref, pick, name] of extra) {
      if (name in o) continue
      const hit = typeof r[fk] === 'string' ? lookups.get(ref)?.get(r[fk] as string) : undefined
      o[name] = hit ? hit[pick] ?? null : null
    }
    if (hasSpecies && !('species_name' in o)) o.species_name = typeof r.species_key === 'string' ? SPECIES_NAME.get(r.species_key) ?? r.species_key : null
    return o
  })
  return { csv: toCsv(out, columnsOf(out)), rows: rows.length }
}

export interface ExportSummary {
  files: number
  rows: number
  byTable: { table: string; rows: number }[]
  bytes: number
}

export const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** One ZIP: csv/<table>.csv for every table with records, backup.json (restorable), and a README. */
export async function buildExportZip(store: Store, now = new Date()): Promise<{ zip: Uint8Array; summary: ExportSummary }> {
  const files: ZipFile[] = []
  const byTable: { table: string; rows: number }[] = []
  for (const t of EXPORT_TABLES) {
    const { csv, rows } = await tableCsv(store, t)
    if (!rows) continue
    files.push({ name: `csv/${t}.csv`, data: csv, at: now })
    byTable.push({ table: t, rows })
  }
  const json = await store.exportJson()
  files.unshift({ name: 'backup.json', data: json, at: now })
  const total = byTable.reduce((n, b) => n + b.rows, 0)
  const readme = [
    'MY/CO/L EXPORT',
    `Made ${now.toISOString()} on ${store.backend.kind === 'local' ? 'this browser (local mode)' : 'the linked database'}.`,
    '',
    'backup.json   The restorable backup. Open DATA > RESTORE in the app and pick this ZIP or this file.',
    'csv/          One spreadsheet file per table. Open in Excel, Sheets or Numbers. Dates are yyyy-mm-dd, times are UTC.',
    '              A code or name column is added to the end of some tables (strain_code, lot_code, item_name, species_name).',
    '              Lists and objects are written as JSON text in the cell.',
    '',
    'Tables with records:',
    ...byTable.map((b) => `  ${b.table.padEnd(20)} ${String(b.rows).padStart(7)}   ${tableName(b.table, 2)}`),
    '',
    `${total} records in ${byTable.length} tables.`,
    'sensor_readings is in csv/ but NOT in backup.json (it grows without limit). Keep the csv as its backup.',
    '',
    'Respaldo y exportacion de MY/CO/L: backup.json se restaura desde DATA > RESTORE; la carpeta csv/ se abre en Excel.',
    '',
  ].join('\r\n')
  files.push({ name: 'README.txt', data: readme, at: now })
  const zip = makeZip(files, now)
  return { zip, summary: { files: files.length, rows: total, byTable, bytes: zip.length } }
}

/** Pick the backup text out of whatever file was chosen: a .json backup, or a ZIP made by EXPORT. */
export async function readBackupFile(bytes: Uint8Array): Promise<{ text: string; from: 'json' | 'zip' }> {
  if (isZip(bytes)) {
    const entries = await readZip(bytes)
    const hit = entries.find((e) => e.name === 'backup.json') ?? entries.find((e) => /(^|\/)backup\.json$/.test(e.name))
    if (!hit) throw new Error('THIS ZIP HAS NO backup.json. PICK A ZIP MADE BY EXPORT, OR THE .JSON BACKUP.')
    return { text: textOf(hit.data), from: 'zip' }
  }
  let text = textOf(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return { text, from: 'json' }
}

// ---------- when was the last backup? (per device) ----------

const KEY = 'mycol.lastbackup.v1'
export function markBackup(now = new Date()) {
  try {
    localStorage.setItem(KEY, now.toISOString())
  } catch {
    /* storage blocked: the reminder just keeps asking */
  }
}
export function lastBackup(): Date | null {
  try {
    const v = localStorage.getItem(KEY)
    const d = v ? new Date(v) : null
    return d && Number.isFinite(d.getTime()) ? d : null
  } catch {
    return null
  }
}
/** GUESS - REVIEW: a backup older than this many days is called stale. */
export const BACKUP_STALE_DAYS = 7
export function backupAgeDays(now = Date.now(), last = lastBackup()): number | null {
  return last ? Math.floor((now - last.getTime()) / 86400000) : null
}
export function backupNag(now = Date.now(), last = lastBackup()): { text: string; key: string; vars: Record<string, number>; warn: boolean } {
  const d = backupAgeDays(now, last)
  if (d === null) return { text: 'NO BACKUP MADE ON THIS DEVICE YET', key: 'NO BACKUP MADE ON THIS DEVICE YET', vars: {}, warn: true }
  if (d >= BACKUP_STALE_DAYS) return { text: `LAST BACKUP ${d} DAYS AGO`, key: 'LAST BACKUP {d} DAYS AGO', vars: { d }, warn: true }
  if (d === 0) return { text: 'BACKED UP TODAY', key: 'BACKED UP TODAY', vars: {}, warn: false }
  return { text: d === 1 ? 'LAST BACKUP 1 DAY AGO' : `LAST BACKUP ${d} DAYS AGO`, key: d === 1 ? 'LAST BACKUP 1 DAY AGO' : 'LAST BACKUP {d} DAYS AGO', vars: { d }, warn: false }
}

export { bytesOf }
