// BULK EDIT: pick many records of one kind (usually from a search), apply ONE change, ONE undo step.
//
// What is already bulk elsewhere (G4 and G6): MISSION CONTROL > BULK (harvest session, inoculate a cart, change
// many lots, split a lot) and MONEY > OWED (mark many paid or written off). This adds what was missing:
// cultures, grain runs and lots (status, place, delete), sales (paid, owed, written off, delete), harvests
// (grade, delete) and a stock take (count many items in one go). Every call here is wrapped by the screen in
// store.action(), so the whole change is one UNDO step and one history label.

import type { Store } from './store'
import type { BlockLot, Culture, CultureStatus, GrainRun, GrainStatus, LotStatus } from './xeno'
import { todayIso } from './xeno'
import type { Harvest } from './ledger'
import type { Sale } from './trade'
import { bulkLots, dropExtras } from './recordsActions'
import { markOwed, markPaid, writeOff } from './moneyActions'
import { newMove } from './cargoActions'
import type { LotLoss } from './hazard'

export type BulkTable = 'cultures' | 'grain_runs' | 'block_lots' | 'sales' | 'harvests'

export const CULTURE_STATUSES: CultureStatus[] = ['clean', 'cold_storage', 'used_up', 'contaminated', 'discarded']
export const GRAIN_STATUSES: GrainStatus[] = ['incubating', 'ready', 'cold_storage', 'used_up', 'contaminated', 'discarded']
export const LOT_STATUSES: LotStatus[] = ['incubating', 'fruiting', 'spent', 'lost']

const pick = <T extends { id: string }>(rows: T[], ids: string[]): T[] => {
  const want = new Set(ids)
  return rows.filter((r) => want.has(r.id))
}
const needSome = (n: number) => {
  if (!n) throw new Error('TICK AT LEAST ONE RECORD.')
}

/** Status on many cultures or grain runs. Entering cold storage starts the cold clock; leaving keeps the old date. */
export async function setStatusMany(store: Store, table: 'cultures' | 'grain_runs' | 'block_lots', ids: string[], status: string, losses: LotLoss[] = []): Promise<number> {
  await store.ensure(table)
  const rows = pick(store.rows(table), ids)
  needSome(rows.length)
  if (table === 'block_lots') {
    if (!LOT_STATUSES.includes(status as LotStatus)) throw new Error('PICK A LOT STATUS.')
    return bulkLots(store, rows as BlockLot[], { status: status as LotStatus }, losses)
  }
  const ok = table === 'cultures' ? CULTURE_STATUSES : GRAIN_STATUSES
  if (!ok.includes(status as never)) throw new Error('PICK A STATUS.')
  const day = todayIso()
  await store.put(
    table,
    (rows as (Culture | GrainRun)[]).map((r) => ({ ...r, status, cold_since: status === 'cold_storage' ? (r.status === 'cold_storage' ? r.cold_since : day) : r.cold_since })),
  )
  return rows.length
}

/** Place on many cultures or grain runs (the shelf, fridge or rack text). Blank clears it. */
export async function setPlaceMany(store: Store, table: 'cultures' | 'grain_runs', ids: string[], location: string): Promise<number> {
  await store.ensure(table)
  const rows = pick(store.rows(table), ids)
  needSome(rows.length)
  const loc = location.trim().toUpperCase().slice(0, 40) || null
  await store.put(table, rows.map((r) => ({ ...r, location: loc })))
  return rows.length
}

export interface DeleteResult {
  deleted: number
  skipped: { id: string; why: string }[]
}

/** Delete many records. A culture that other cultures or grain runs came from, and a lot that was split, are kept and listed.
 *  Photos, pin days and the like that belong to a deleted record go with it (same as deleting one). */
export async function deleteMany(store: Store, table: BulkTable, ids: string[]): Promise<DeleteResult> {
  await store.ensure(table)
  const rows = pick(store.rows(table), ids)
  needSome(rows.length)
  const skipped: { id: string; why: string }[] = []
  let go = rows.map((r) => r.id)
  if (table === 'cultures') {
    await Promise.all([store.ensure('cultures'), store.ensure('grain_runs')])
    const parents = new Set<string>()
    for (const c of store.rows<Culture>('cultures')) if (c.parent_culture_id) parents.add(c.parent_culture_id)
    for (const g of store.rows<GrainRun>('grain_runs')) if (g.parent_culture_id) parents.add(g.parent_culture_id)
    const keep = go.filter((id) => parents.has(id))
    for (const id of keep) skipped.push({ id, why: 'OTHER RECORDS CAME FROM IT' })
    go = go.filter((id) => !parents.has(id))
  } else if (table === 'grain_runs') {
    await Promise.all([store.ensure('grain_runs'), store.ensure('block_lots')])
    const parents = new Set<string>()
    for (const g of store.rows<GrainRun>('grain_runs')) if (g.parent_grain_run_id) parents.add(g.parent_grain_run_id)
    for (const l of store.rows<BlockLot>('block_lots')) if (l.grain_run_id) parents.add(l.grain_run_id)
    const keep = go.filter((id) => parents.has(id))
    for (const id of keep) skipped.push({ id, why: 'OTHER RECORDS CAME FROM IT' })
    go = go.filter((id) => !parents.has(id))
  } else if (table === 'block_lots') {
    // A lot that has picks logged keeps its records: delete the picks first, on purpose, one lot at a time.
    await Promise.all([store.ensure('harvests'), store.ensure('lot_losses')])
    const picked = new Set(store.rows<Harvest>('harvests').map((h) => h.block_lot_id))
    for (const id of go.filter((i) => picked.has(i))) skipped.push({ id, why: 'HARVESTS ARE LOGGED AGAINST IT' })
    go = go.filter((i) => !picked.has(i))
    const gone = new Set(go)
    const dropL = store.rows<LotLoss>('lot_losses').filter((l) => gone.has(l.block_lot_id)).map((l) => l.id)
    if (dropL.length) await store.del('lot_losses', dropL)
  }
  if (!go.length) return { deleted: 0, skipped }
  if (table === 'cultures' || table === 'grain_runs' || table === 'block_lots') await dropExtras(store, table, go)
  await store.del(table, go)
  return { deleted: go.length, skipped }
}

/** Money status on many sales. */
export async function salesMany(store: Store, ids: string[], what: 'paid' | 'owed' | 'written_off', day: string): Promise<number> {
  await store.ensure('sales')
  needSome(pick(store.rows<Sale>('sales'), ids).length)
  if (what === 'paid') return markPaid(store, ids, day)
  if (what === 'owed') return markOwed(store, ids)
  return writeOff(store, ids, day)
}

/** Grade on many harvest records. */
export async function gradeMany(store: Store, ids: string[], grade: string): Promise<number> {
  await store.ensure('harvests')
  const rows = pick(store.rows<Harvest>('harvests'), ids)
  needSome(rows.length)
  const g = grade.trim().toUpperCase()
  if (!g) throw new Error('PICK A GRADE.')
  await store.put('harvests', rows.map((r) => ({ ...r, grade: g })))
  return rows.length
}

export interface CountLine {
  itemId: string
  /** On hand now, from the stock manifest. */
  current: number
  /** What was counted. */
  target: number
}

/** Stock take: one count move per item whose count changed (the difference, reason "count"), so history stays honest. */
export async function stockTake(store: Store, lines: CountLine[]): Promise<number> {
  const bad = lines.find((l) => !Number.isFinite(l.target) || l.target < 0)
  if (bad) throw new Error('A COUNT CANNOT BE BELOW ZERO OR EMPTY.')
  const moves = lines
    .filter((l) => Math.round((l.target - l.current) * 1000) !== 0)
    .map((l) => newMove(l.itemId, Math.round((l.target - l.current) * 1000) / 1000, 'count', { notes: `COUNTED ${l.target}` }))
  needSome(lines.length)
  if (moves.length) await store.put('stock_moves', moves)
  return moves.length
}
