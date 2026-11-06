// Writes for PRODUCTION RECORDS (build G4). Each function is ONE user action: the screens call them inside
// store.action(label, ...) so a whole cart or harvest session is a single UNDO step and one history label.

import { uuid, type Store } from './store'
import type { Harvest } from './ledger'
import type { LotLoss } from './hazard'
import { lossLot } from './xenoActions'
import { suggestCode } from './mission'
import { RATIO } from './xeno'
import { planSplit, survivors, type FlushLog, type StrainTrial } from './records'
import { todayIso, type BlockLot, type GrainRun, type LotStatus, type Strain } from './xeno'

const nowIso = () => new Date().toISOString()
const cleanInitials = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().slice(0, 4) || null
export const cleanCart = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, '-').slice(0, 20) || null

// ---------- split ----------

export { planSplit as planSplitSafe } from './records'

export interface SplitIn {
  lot: BlockLot
  losses: LotLoss[]
  harvests: Harvest[]
  lots: BlockLot[]
  n: number
  cart?: string | null
  room?: string | null
}

/** Move `n` live blocks of a lot into a new lot (same knock day, strain, grain and cook). */
export async function splitLot(store: Store, o: SplitIn): Promise<BlockLot> {
  const plan = planSplit(o.lot, o.losses, o.harvests, o.lots, o.n)
  if (!plan.ok) throw new Error(plan.error)
  const now = nowIso()
  const child: BlockLot = {
    ...o.lot,
    id: uuid(),
    lot_code: plan.childCode,
    bag_count: plan.childBlocks,
    g2_bags_used: null,
    parent_lot_id: o.lot.id,
    cart: o.cart === undefined ? o.lot.cart ?? null : cleanCart(o.cart),
    room: o.room === undefined ? o.lot.room ?? null : o.room || null,
    notes: `SPLIT FROM ${o.lot.lot_code}`,
    created_at: now,
    updated_at: now,
  }
  await store.put('block_lots', { ...o.lot, bag_count: o.lot.bag_count - plan.childBlocks })
  await store.put('block_lots', child)
  return child
}

// ---------- harvest session ----------

export interface SessionRow {
  lot: BlockLot
  kg: number
  flush: number
  grade: string
}
export interface SessionIn {
  day: string
  initials: string
  rows: SessionRow[]
}

/** Log many picks at once. A lot still incubating moves to fruiting on the pick day, like the single form does. */
export async function harvestSession(store: Store, o: SessionIn): Promise<Harvest[]> {
  const who = cleanInitials(o.initials)
  if (!who) throw new Error('TYPE YOUR INITIALS.')
  const rows = o.rows.filter((r) => r.kg > 0)
  if (!rows.length) throw new Error('TYPE THE KG FOR AT LEAST ONE LOT.')
  for (const r of rows) {
    if (!Number.isFinite(r.kg)) throw new Error(`BAD KG FOR ${r.lot.lot_code}.`)
    if (!Number.isInteger(r.flush) || r.flush < 1 || r.flush > 9) throw new Error(`FLUSH FOR ${r.lot.lot_code} MUST BE 1 TO 9.`)
  }
  const out: Harvest[] = []
  const moved: BlockLot[] = []
  for (const r of rows) {
    if (r.lot.status === 'incubating') moved.push({ ...r.lot, status: 'fruiting', to_fruiting_on: r.lot.to_fruiting_on ?? o.day, room: 'fruiting' })
    out.push({ id: uuid(), block_lot_id: r.lot.id, harvested_on: o.day, flush: r.flush, kg: Math.round(r.kg * 1000) / 1000, grade: r.grade, initials: who, notes: null, created_at: nowIso() })
  }
  if (moved.length) await store.put('block_lots', moved)
  await store.put('harvests', out)
  return out
}

// ---------- inoculate a cart ----------

export interface CartLine {
  species: string
  strainId: string | null
  grainId: string | null
  blocks: number
  trialId?: string | null
}
export interface CartIn {
  cart: string
  knock: string
  by: string
  cookId: string | null
  room?: string | null
  lines: CartLine[]
  lots: BlockLot[] // existing, for unique codes
  strains: Strain[]
  grain: GrainRun[]
}

/** One lot per line, all on the same cart and knock day. Returns the new lots. */
export async function inoculateCart(store: Store, o: CartIn): Promise<BlockLot[]> {
  const cart = cleanCart(o.cart)
  if (!cart) throw new Error('GIVE THE CART A NAME, LIKE C-07.')
  const lines = o.lines.filter((l) => l.blocks > 0)
  if (!lines.length) throw new Error('ADD AT LEAST ONE LINE WITH BLOCKS.')
  for (const l of lines) if (!Number.isInteger(l.blocks)) throw new Error('BLOCKS MUST BE WHOLE NUMBERS.')
  const made: BlockLot[] = []
  const now = nowIso()
  for (const l of lines) {
    const grain = l.grainId ? o.grain.find((g) => g.id === l.grainId) ?? null : null
    const strain = o.strains.find((s) => s.id === (l.strainId || grain?.strain_id)) ?? null
    made.push({
      id: uuid(),
      lot_code: suggestCode(l.species, o.knock, [...o.lots, ...made]),
      species_key: l.species,
      strain_id: strain?.id ?? null,
      grain_run_id: grain?.id ?? null,
      g2_bags_used: grain ? Math.ceil(l.blocks / RATIO.blocksPerG2) : null,
      cook_run_id: o.cookId || null,
      bag_count: l.blocks,
      knock_date: o.knock,
      status: 'incubating',
      notes: null,
      cart,
      room: o.room === undefined ? 'incubation' : o.room || null,
      knocked_by: cleanInitials(o.by),
      parent_lot_id: null,
      trial_id: l.trialId || null,
      created_at: now,
      updated_at: now,
    })
  }
  await store.put('block_lots', made)
  return made
}

// ---------- bulk change on many lots ----------

export interface BulkChange {
  status?: LotStatus
  room?: string | null
  cart?: string | null
  trialId?: string | null
  day?: string
  hazard?: string | null
}

/** Apply one change to many lots. LOST writes a loss line for every surviving block. */
export async function bulkLots(store: Store, lots: BlockLot[], ch: BulkChange, losses: LotLoss[]): Promise<number> {
  if (!lots.length) throw new Error('TICK AT LEAST ONE LOT.')
  const day = ch.day || todayIso()
  let n = 0
  if (ch.status === 'lost') {
    for (const l of lots) {
      const alive = survivors(l, losses)
      if (alive > 0) await lossLot(store, l, losses, alive, ch.hazard || null)
      else await store.put('block_lots', { ...l, status: 'lost' })
      n++
    }
    return n
  }
  const rows: BlockLot[] = lots.map((l) => {
    const r: BlockLot = { ...l }
    if (ch.status) {
      r.status = ch.status
      if (ch.status === 'fruiting' && !r.to_fruiting_on) r.to_fruiting_on = day
      if (ch.status === 'fruiting' && ch.room === undefined) r.room = 'fruiting'
    }
    if (ch.room !== undefined) r.room = ch.room || null
    if (ch.cart !== undefined) r.cart = cleanCart(ch.cart)
    if (ch.trialId !== undefined) r.trial_id = ch.trialId || null
    return r
  })
  await store.put('block_lots', rows)
  return rows.length
}

// ---------- pins (flush log) ----------

/** The day pins showed for a flush. Logging the same flush again replaces the date. */
/** Edit the place and people fields of a lot (cart, room, who knocked it, dry weight). */
export async function setLotPlace(store: Store, lot: BlockLot, p: { cart?: string | null; room?: string | null; knocked_by?: string | null; dry_kg_per_block?: number | null }): Promise<void> {
  const next: BlockLot = { ...lot }
  if (p.cart !== undefined) next.cart = cleanCart(p.cart)
  if (p.room !== undefined) next.room = p.room || null
  if (p.knocked_by !== undefined) next.knocked_by = cleanInitials(p.knocked_by)
  if (p.dry_kg_per_block !== undefined) {
    if (p.dry_kg_per_block !== null && !(p.dry_kg_per_block > 0 && p.dry_kg_per_block < 20)) throw new Error('DRY WEIGHT PER BLOCK MUST BE BETWEEN 0 AND 20 KG.')
    next.dry_kg_per_block = p.dry_kg_per_block
  }
  await store.put('block_lots', next)
}

export async function logPins(store: Store, lot: BlockLot, flush: number, day: string, existing: FlushLog[], notes?: string | null): Promise<FlushLog> {
  if (!Number.isInteger(flush) || flush < 1 || flush > 9) throw new Error('FLUSH MUST BE 1 TO 9.')
  if (day < lot.knock_date) throw new Error(`PINS CANNOT SHOW BEFORE THE KNOCK DAY (${lot.knock_date}).`)
  const have = existing.find((p) => p.block_lot_id === lot.id && p.flush === flush)
  const row: FlushLog = have
    ? { ...have, pinned_on: day, notes: notes ?? have.notes }
    : { id: uuid(), block_lot_id: lot.id, flush, pinned_on: day, notes: notes ?? null, created_at: nowIso(), updated_at: nowIso() }
  await store.put('flush_log', row)
  if (lot.status === 'incubating') await store.put('block_lots', { ...lot, status: 'fruiting', to_fruiting_on: lot.to_fruiting_on ?? day, room: 'fruiting' })
  return row
}

// ---------- trials ----------

export async function createTrial(store: Store, p: { name: string; species_key: string; question?: string | null; started_on?: string }): Promise<StrainTrial> {
  const name = p.name.trim()
  if (!name) throw new Error('NAME THE TRIAL.')
  const row: StrainTrial = { id: uuid(), name, species_key: p.species_key, status: 'running', started_on: p.started_on || todayIso(), ended_on: null, question: p.question?.trim() || null, notes: null, created_at: nowIso(), updated_at: nowIso() }
  await store.put('strain_trials', row)
  return row
}

export async function closeTrial(store: Store, t: StrainTrial, done: boolean): Promise<void> {
  await store.put('strain_trials', { ...t, status: done ? 'done' : 'running', ended_on: done ? todayIso() : null })
}

// ---------- clean-up when a record is deleted ----------

/** Delete the photos (and, for lots, the pin days) that belong to records about to be deleted. Call it first. */
export async function dropExtras(store: Store, table: 'cultures' | 'grain_runs' | 'block_lots', ids: string[]): Promise<void> {
  if (!ids.length) return
  const gone = new Set(ids)
  await store.ensure('photos')
  const ph = store.rows<{ id: string; table_name: string; row_id: string }>('photos').filter((p) => p.table_name === table && gone.has(p.row_id)).map((p) => p.id)
  if (ph.length) await store.del('photos', ph)
  if (table === 'block_lots') {
    await Promise.all([store.ensure('flush_log'), store.ensure('block_lots')])
    const pins = store.rows<FlushLog>('flush_log').filter((p) => gone.has(p.block_lot_id)).map((p) => p.id)
    if (pins.length) await store.del('flush_log', pins)
    const kids = store.rows<BlockLot>('block_lots').filter((l) => l.parent_lot_id && gone.has(l.parent_lot_id) && !gone.has(l.id))
    if (kids.length) await store.put('block_lots', kids.map((k) => ({ ...k, parent_lot_id: null })))
  }
}
