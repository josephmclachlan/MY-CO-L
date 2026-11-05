// Writes for XENOGENETICS. Screens call these; they build complete rows and hand them to the Store.

import { uuid, type Store } from './store'
import type { HazardLog, LotLoss } from './hazard'
import {
  childP,
  cultureLabel,
  grainLabel,
  todayIso,
  type BlockLot,
  type Culture,
  type CultureKind,
  type CultureStatus,
  type GrainRun,
  type GrainStatus,
  type LotStatus,
  type Strain,
} from './xeno'

export const DEFAULT_SOURCE = 'Cap n Stem (CNS)'

export function newStrain(p: Partial<Strain> & { species_key: string; code: string }): Strain {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    species_key: p.species_key,
    code: p.code.toUpperCase().trim(),
    name: p.name?.trim() || null,
    source: p.source?.trim() || DEFAULT_SOURCE,
    active: p.active ?? true,
    notes: p.notes?.trim() || null,
    created_at: now,
    updated_at: now,
  }
}

/** Next free number for a label on this day: "-1", "-2" ... */
function nextN(existing: (string | null)[], stem: string): number {
  let n = 0
  for (const l of existing) {
    if (!l || !l.startsWith(stem + '-')) continue
    const k = Number(l.slice(stem.length + 1))
    if (Number.isFinite(k)) n = Math.max(n, k)
  }
  return n + 1
}

export interface NewCultures {
  strain: Strain
  parent: Culture | null
  kind: CultureKind
  count: number
  p_level?: number
  made_on?: string
  location?: string | null
  existing: Culture[]
}

/** Make `count` cultures from a parent (or masters when parent is null). Each gets its own label. */
export async function addCultures(store: Store, o: NewCultures): Promise<Culture[]> {
  const made_on = o.made_on || todayIso()
  const p = o.p_level ?? childP(o.parent, o.kind)
  const now = new Date().toISOString()
  const stem = cultureLabel(o.strain, { kind: o.kind, p_level: p, made_on }, 0).replace(/-0$/, '')
  let n = nextN(o.existing.filter((c) => c.strain_id === o.strain.id).map((c) => c.label), stem)
  const rows: Culture[] = []
  for (let i = 0; i < Math.max(1, Math.min(60, Math.floor(o.count))); i++) {
    rows.push({
      id: uuid(),
      strain_id: o.strain.id,
      parent_culture_id: o.parent?.id ?? null,
      kind: o.kind,
      p_level: p,
      made_on,
      status: 'clean',
      cold_since: null,
      location: o.location ?? o.parent?.location ?? null,
      label: `${stem}-${n++}`,
      notes: null,
      created_at: now,
      updated_at: now,
    })
  }
  await store.put('cultures', rows)
  return rows
}

export interface NewGrain {
  strain: Strain
  generation: 'G1' | 'G2'
  parentCulture: Culture | null
  parentRun: GrainRun | null
  bags: number
  mastersUsed?: number
  inoculated_on?: string
  existing: GrainRun[]
}

export async function addGrainRun(store: Store, o: NewGrain): Promise<GrainRun> {
  if (o.parentRun?.generation === 'G2') throw new Error('NO G3. G2 GOES TO BLOCKS ONLY (F03-0006).')
  if (!o.parentCulture && !o.parentRun) throw new Error('A GRAIN RUN NEEDS A PARENT PLATE, LC OR MASTER.')
  const inoculated_on = o.inoculated_on || todayIso()
  const now = new Date().toISOString()
  const stem = grainLabel(o.strain, { generation: o.generation, inoculated_on }, 0).replace(/-0$/, '')
  const n = nextN(o.existing.filter((g) => g.strain_id === o.strain.id).map((g) => g.label), stem)
  const row: GrainRun = {
    id: uuid(),
    generation: o.generation,
    strain_id: o.strain.id,
    parent_culture_id: o.parentRun ? null : o.parentCulture!.id,
    parent_grain_run_id: o.parentRun?.id ?? null,
    parent_bags_used: o.parentRun ? Math.max(0, o.mastersUsed ?? 1) : null,
    bag_count: Math.max(1, Math.floor(o.bags)),
    bags_lost: 0,
    inoculated_on,
    status: 'incubating',
    cold_since: null,
    location: null,
    label: `${stem}-${n}`,
    result: null,
    notes: null,
    created_at: now,
    updated_at: now,
  }
  await store.put('grain_runs', row)
  return row
}

export interface NewLot {
  strain: Strain
  run: GrainRun
  lot_code: string
  blocks: number
  g2Used: number
  knock_date?: string
}

export async function addLot(store: Store, o: NewLot): Promise<BlockLot> {
  if (o.run.generation !== 'G2') throw new Error('BLOCKS ARE SPAWNED FROM G2 BAGS.')
  const now = new Date().toISOString()
  const row: BlockLot = {
    id: uuid(),
    lot_code: o.lot_code.toUpperCase().trim(),
    species_key: o.strain.species_key,
    strain_id: o.strain.id,
    grain_run_id: o.run.id,
    g2_bags_used: Math.max(0, o.g2Used),
    bag_count: Math.max(1, Math.floor(o.blocks)),
    knock_date: o.knock_date || todayIso(),
    status: 'incubating',
    notes: null,
    created_at: now,
    updated_at: now,
  }
  await store.put('block_lots', row)
  return row
}

export async function setCultureStatus(store: Store, c: Culture, status: CultureStatus): Promise<void> {
  const cold_since = status === 'cold_storage' ? (c.status === 'cold_storage' ? c.cold_since : todayIso()) : c.cold_since
  await store.put('cultures', { ...c, status, cold_since })
}

/** Write one loss against a library entry (null = not sure what it was). */
export async function logHazard(
  store: Store,
  o: { hazard_key: string | null; source_kind: HazardLog['source_kind']; source_id: string; strain_id: string | null; bag_count: number; notes?: string | null },
): Promise<HazardLog> {
  const row: HazardLog = {
    id: uuid(),
    hazard_key: o.hazard_key || null,
    source_kind: o.source_kind,
    source_id: o.source_id,
    strain_id: o.strain_id,
    bag_count: Math.max(0, Math.floor(o.bag_count)),
    noted_on: todayIso(),
    notes: o.notes ?? null,
    created_at: new Date().toISOString(),
  }
  await store.put('hazard_logs', row)
  return row
}

/** Mark a culture contaminated and record what it was. */
export async function contaminateCulture(store: Store, c: Culture, hazardKey: string | null): Promise<void> {
  await setCultureStatus(store, c, 'contaminated')
  await logHazard(store, { hazard_key: hazardKey, source_kind: 'culture', source_id: c.id, strain_id: c.strain_id, bag_count: 1 })
}

/** Set the grain run's bags lost; the extra bags since the last figure are logged against the entry. */
export async function lossGrainRun(store: Store, g: GrainRun, bagsLost: number, hazardKey: string | null): Promise<void> {
  const lost = Math.min(g.bag_count, Math.max(0, Math.floor(bagsLost)))
  const extra = lost - (g.bags_lost || 0)
  await setGrainStatus(store, g, g.status, lost)
  if (extra > 0) await logHazard(store, { hazard_key: hazardKey, source_kind: 'grain', source_id: g.id, strain_id: g.strain_id, bag_count: extra })
}

export const lotLosses = (all: LotLoss[], lotId: string) => all.filter((l) => l.block_lot_id === lotId)
export const lotBagsLost = (all: LotLoss[], lotId: string) => lotLosses(all, lotId).reduce((n, l) => n + l.bag_count, 0)

/** Blocks lost from a lot. Losing every block ends the lot. */
export async function lossLot(store: Store, l: BlockLot, existing: LotLoss[], bags: number, hazardKey: string | null, cause?: string | null): Promise<LotLoss> {
  const n = Math.floor(bags)
  if (!(n > 0)) throw new Error('HOW MANY BLOCKS WERE LOST?')
  const already = lotBagsLost(existing, l.id)
  if (already + n > l.bag_count) throw new Error(`THIS LOT HAS ${l.bag_count} BLOCKS AND ${already} ARE ALREADY LOGGED LOST.`)
  const row: LotLoss = {
    id: uuid(),
    block_lot_id: l.id,
    hazard_key: hazardKey || null,
    bag_count: n,
    cause: cause ?? null,
    noted_on: todayIso(),
    notes: null,
    created_at: new Date().toISOString(),
  }
  await store.put('lot_losses', row)
  if (already + n >= l.bag_count) await setLotStatus(store, l, 'lost')
  return row
}

export async function setGrainStatus(store: Store, g: GrainRun, status: GrainStatus, bagsLost?: number): Promise<void> {
  const cold_since = status === 'cold_storage' ? (g.status === 'cold_storage' ? g.cold_since : todayIso()) : g.cold_since
  // Losing some bags does not end the run; losing all of them does.
  if (bagsLost !== undefined) {
    const lost = Math.min(g.bag_count, Math.max(0, Math.floor(bagsLost)))
    await store.put('grain_runs', { ...g, bags_lost: lost, status: lost >= g.bag_count ? 'contaminated' : g.status, cold_since: g.cold_since })
    return
  }
  await store.put('grain_runs', { ...g, status, cold_since })
}

export async function setLotStatus(store: Store, l: BlockLot, status: LotStatus): Promise<void> {
  await store.put('block_lots', { ...l, status })
}

// ---------- example data, so the screens can be tried before real strains go in ----------

export const DEMO_CODE = 'DEMO-01'

export async function loadDemo(store: Store, have: Strain[]): Promise<void> {
  if (have.some((s) => s.code === DEMO_CODE)) throw new Error('THE EXAMPLE STRAIN IS ALREADY LOADED.')
  const d = (n: number) => {
    const x = new Date()
    x.setDate(x.getDate() - n)
    return x.toISOString().slice(0, 10)
  }
  const s = newStrain({ species_key: 'blue-oyster', code: DEMO_CODE, name: 'Example line (delete me)', notes: 'Example data to try the screens. Remove it with REMOVE EXAMPLE.' })
  await store.put('strains', s)
  const all: Culture[] = []
  const [slant] = await addCultures(store, { strain: s, parent: null, kind: 'slant', count: 1, made_on: d(200), location: 'LAB FRIDGE', existing: all })
  await store.put('cultures', { ...slant, status: 'cold_storage', cold_since: d(186) })
  all.push(slant)
  const [water] = await addCultures(store, { strain: s, parent: null, kind: 'water', count: 1, made_on: d(120), location: 'LAB FRIDGE', existing: all })
  all.push(water)
  const [p1] = await addCultures(store, { strain: s, parent: slant, kind: 'plate', count: 1, made_on: d(40), existing: all })
  all.push(p1)
  const p2 = await addCultures(store, { strain: s, parent: p1, kind: 'plate', count: 5, made_on: d(30), existing: all })
  all.push(...p2)
  await store.put('cultures', { ...p2[1], status: 'cold_storage', cold_since: d(28) })
  await store.put('cultures', { ...p2[2], status: 'contaminated' })
  await store.put('cultures', { ...p2[0], status: 'used_up' })
  const p3 = await addCultures(store, { strain: s, parent: p2[3], kind: 'plate', count: 2, made_on: d(9), existing: all })
  all.push(...p3)
  const runs: GrainRun[] = []
  const g1 = await addGrainRun(store, { strain: s, generation: 'G1', parentCulture: p2[0], parentRun: null, bags: 2, inoculated_on: d(28), existing: runs })
  runs.push(g1)
  const g2 = await addGrainRun(store, { strain: s, generation: 'G2', parentCulture: null, parentRun: g1, bags: 7, mastersUsed: 1, inoculated_on: d(13), existing: runs })
  runs.push(g2)
  await store.put('grain_runs', { ...g2, status: 'cold_storage', cold_since: d(2) })
  await addLot(store, { strain: s, run: { ...g2 }, lot_code: `B${d(1).slice(5, 7)}${d(1).slice(8, 10)}`, blocks: 60, g2Used: 3, knock_date: d(1) })
}

export async function removeDemo(store: Store, strains: Strain[], cultures: Culture[], runs: GrainRun[], lots: BlockLot[]): Promise<void> {
  const s = strains.find((x) => x.code === DEMO_CODE)
  if (!s) return
  const gIds = new Set(runs.filter((g) => g.strain_id === s.id).map((g) => g.id))
  const lotIds = new Set(lots.filter((l) => l.strain_id === s.id || (l.grain_run_id && gIds.has(l.grain_run_id))).map((l) => l.id))
  await Promise.all([store.ensure('hazard_logs'), store.ensure('lot_losses')])
  await store.del('hazard_logs', store.rows<HazardLog>('hazard_logs').filter((h) => h.strain_id === s.id).map((h) => h.id))
  await store.del('lot_losses', store.rows<LotLoss>('lot_losses').filter((h) => lotIds.has(h.block_lot_id)).map((h) => h.id))
  await store.del('block_lots', lots.filter((l) => l.strain_id === s.id || (l.grain_run_id && gIds.has(l.grain_run_id))).map((l) => l.id))
  // Children before parents, for the database's foreign keys.
  const gs = runs.filter((g) => g.strain_id === s.id).sort((a, b) => (a.generation === b.generation ? 0 : a.generation === 'G2' ? -1 : 1))
  await store.del('grain_runs', gs.map((g) => g.id))
  const cs = cultures.filter((c) => c.strain_id === s.id).sort((a, b) => (b.p_level ?? 0) - (a.p_level ?? 0))
  await store.del('cultures', cs.map((c) => c.id))
  await store.del('strains', s.id)
}
