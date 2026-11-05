// XENOGENETICS: strains, cultures, grain runs and block lots.
//
// Pure functions only (no React, no store), so they can be tested.
// Every planning number names the textbook fact it came from (F05-0013 style)
// or FARM-PLAN for the 100-bag farm schedule. Nothing comes from outside sources.

import { SPECIES } from '../data/species'
import type { Species } from '../data/species/types'
import type { Row } from './store'

// ---------- rows (same names as the database columns, see supabase/migrations) ----------

export interface Strain extends Row {
  id: string
  species_key: string // species JSON id, e.g. lions-mane
  code: string // e.g. LM-03
  name: string | null
  source: string | null
  active: boolean
  notes: string | null
  created_at?: string
  updated_at?: string
}

export type CultureKind = 'plate' | 'slant' | 'liquid' | 'water' | 'cryo' | 'spore_print' | 'other'
export type CultureStatus = 'clean' | 'contaminated' | 'used_up' | 'cold_storage' | 'discarded'

export interface Culture extends Row {
  id: string
  strain_id: string
  parent_culture_id: string | null
  kind: CultureKind
  p_level: number | null // 0 = master (stored original), 1-4 working plates
  made_on: string // YYYY-MM-DD
  status: CultureStatus
  cold_since: string | null
  location: string | null
  label: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export type GrainStatus = 'incubating' | 'ready' | 'cold_storage' | 'used_up' | 'contaminated' | 'discarded'

export interface GrainRun extends Row {
  id: string
  generation: 'G1' | 'G2'
  strain_id: string
  parent_culture_id: string | null
  parent_grain_run_id: string | null
  parent_bags_used: number | null // masters (G1 bags) used to make this G2 run
  bag_count: number
  bags_lost: number
  inoculated_on: string
  status: GrainStatus
  cold_since: string | null
  location: string | null
  label: string | null
  result: string | null
  notes: string | null
  created_at?: string
  updated_at?: string
}

export type LotStatus = 'incubating' | 'fruiting' | 'spent' | 'lost'

export interface BlockLot extends Row {
  id: string
  lot_code: string
  species_key: string
  strain_id: string | null
  grain_run_id: string | null
  g2_bags_used: number | null
  bag_count: number
  knock_date: string
  status: LotStatus
  notes: string | null
  created_at?: string
  updated_at?: string
}

export const KIND_LABEL: Record<CultureKind, string> = {
  plate: 'PLATE',
  slant: 'SLANT',
  liquid: 'LC',
  water: 'WATER TUBE',
  cryo: 'CRYOVIAL',
  spore_print: 'SPORE PRINT',
  other: 'OTHER',
}
export const KIND_SHORT: Record<CultureKind, string> = {
  plate: 'PL',
  slant: 'SL',
  liquid: 'LC',
  water: 'WT',
  cryo: 'CV',
  spore_print: 'SP',
  other: 'OT',
}
export const STORAGE_KINDS: CultureKind[] = ['cryo', 'slant', 'water']

// ---------- dates ----------

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const todayIso = () => isoDay(new Date())
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export function addDays(s: string, n: number): string {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86400000)
}
/** MMDD, as in lot codes (B1020). */
export const mmdd = (s: string) => s.slice(5, 7) + s.slice(8, 10)
/** The next Tuesday (knock day) on or after a date. */
export function nextKnockDay(from: string): string {
  const d = parseDay(from)
  const add = (2 - d.getDay() + 7) % 7
  d.setDate(d.getDate() + add)
  return isoDay(d)
}

// ---------- species codes ----------

/** Two-letter strain code prefix per species. Joseph's own codes replace these if he has them. */
export const STRAIN_PREFIX: Record<string, string> = {
  'blue-oyster': 'BO',
  'lions-mane': 'LM',
  'comb-tooth': 'CT',
  'golden-oyster': 'GO',
  'phoenix-oyster': 'PH',
  'pink-oyster': 'PK',
  'black-pearl': 'BP',
  'king-oyster': 'KO',
  chestnut: 'CN',
  pioppino: 'PP',
  shiitake: 'SH',
  maitake: 'MT',
  reishi: 'RS',
  cordyceps: 'CM',
}

/** Lot code letter (species letter + knock MMDD). B is Catawba's; the rest are a first guess, editable on each lot. */
export const LOT_LETTER: Record<string, string> = {
  'blue-oyster': 'B',
  'lions-mane': 'L',
  'comb-tooth': 'C',
  'golden-oyster': 'G',
  'phoenix-oyster': 'P',
  'pink-oyster': 'K',
  'black-pearl': 'N',
  'king-oyster': 'E',
  chestnut: 'A',
  pioppino: 'O',
  shiitake: 'S',
  maitake: 'M',
  reishi: 'R',
  cordyceps: 'Y',
}

export const speciesOf = (key: string): Species | undefined => SPECIES.find((s) => s.id === key)

export function nextStrainCode(speciesKey: string, strains: Strain[]): string {
  const pre = STRAIN_PREFIX[speciesKey] ?? 'XX'
  const used = strains
    .map((s) => new RegExp(`^${pre}-(\\d+)$`).exec(s.code.toUpperCase()))
    .filter(Boolean)
    .map((m) => Number(m![1]))
  const n = used.length ? Math.max(...used) + 1 : 1
  return `${pre}-${String(n).padStart(2, '0')}`
}

// ---------- P-levels ----------
// ASSUMED until Joseph confirms what P1-P4 means to him:
// - A master (cryovial, slant or water tube kept as the stored original) is P0.
// - A plate made from anything is one level up: master -> P1, P1 -> P2.
// - A slant, water tube, cryovial or LC made from something keeps that thing's level.
// Change only this function if Joseph counts differently.
export function childP(parent: Pick<Culture, 'p_level'> | null, kind: CultureKind): number {
  if (!parent) return kind === 'plate' ? 1 : 0
  const p = parent.p_level ?? 0
  return kind === 'plate' ? p + 1 : p
}

export const pLabel = (p: number | null) => (p === null ? 'P?' : p === 0 ? 'MASTER' : `P${p}`)

// ---------- labels ----------

/** Printed label text, e.g. "LM-03 P2 PL 1105-2". n counts same strain, kind and day. */
export function cultureLabel(strain: Strain, c: Pick<Culture, 'kind' | 'p_level' | 'made_on'>, n: number): string {
  const p = c.p_level === 0 ? 'M' : `P${c.p_level ?? '?'}`
  return `${strain.code} ${p} ${KIND_SHORT[c.kind]} ${mmdd(c.made_on)}-${n}`
}
export function grainLabel(strain: Strain, g: Pick<GrainRun, 'generation' | 'inoculated_on'>, n: number): string {
  return `${strain.code} ${g.generation} ${mmdd(g.inoculated_on)}-${n}`
}

// ---------- what is still on the shelf ----------

export const ACTIVE_CULTURE: CultureStatus[] = ['clean', 'cold_storage']
export const isActiveCulture = (c: Culture) => ACTIVE_CULTURE.includes(c.status)

/** Bags of a grain run still on the shelf: made, minus lost, minus used by its children. */
export function grainRemaining(g: GrainRun, runs: GrainRun[], lots: BlockLot[]): number {
  if (g.status === 'used_up' || g.status === 'discarded' || g.status === 'contaminated') return 0
  const used =
    g.generation === 'G1'
      ? runs.filter((r) => r.parent_grain_run_id === g.id).reduce((a, r) => a + (r.parent_bags_used ?? 1), 0)
      : lots.filter((l) => l.grain_run_id === g.id).reduce((a, l) => a + (l.g2_bags_used ?? 0), 0)
  return Math.max(0, g.bag_count - (g.bags_lost || 0) - used)
}

export interface PCounts {
  master: number
  p: [number, number, number, number] // P1..P4
  past: number // P5 and beyond
  lc: number
  plates: number // active plates P1-P4
}

export function pCounts(strainId: string, cultures: Culture[]): PCounts {
  const out: PCounts = { master: 0, p: [0, 0, 0, 0], past: 0, lc: 0, plates: 0 }
  for (const c of cultures) {
    if (c.strain_id !== strainId || !isActiveCulture(c)) continue
    const p = c.p_level ?? 0
    if (c.kind === 'liquid') out.lc++
    if (p === 0) out.master++
    else if (p <= 4) out.p[p - 1]++
    else out.past++
    if (c.kind === 'plate' && p >= 1 && p <= 4) out.plates++
  }
  return out
}

// ---------- cold storage and age limits ----------

export interface AgeLimit {
  /** Days from `basis` when the warning starts. */
  warn: number
  /** Days from `basis` past which the sources say stop. */
  over: number
  basis: 'made' | 'cold'
  rule: string
  src: string
}

/** Limits from textbook t07, t08 and t09. null = the sources give no limit. */
export function ageLimit(kind: CultureKind | 'G1' | 'G2', speciesKey?: string): AgeLimit | null {
  switch (kind) {
    case 'plate':
      return { warn: 60, over: 90, basis: 'made', rule: 'Discard plates older than 3 months, yellowed or with droplets.', src: 'F03-0268' }
    case 'slant':
      return { warn: 183, over: 243, basis: 'made', rule: 'Slants 6-8 months old have been used; one farm now refreshes them sooner.', src: 'F04-0070' }
    case 'water':
      return { warn: 183, over: 365, basis: 'made', rule: 'Check stored cultures every 6-12 months. Water-tube lifetimes are anecdotal ("months to years").', src: 'F04-0236 F04-0244' }
    case 'cryo':
      return { warn: 548, over: 730, basis: 'made', rule: 'A vial that has sat 18-24 months: run a test line before trusting it.', src: 'F04-0061 F04-0236' }
    case 'G1':
      return { warn: 21, over: 30, basis: 'cold', rule: 'Cold G1 masters: about a month, inspecting; beyond a month is a no-go (the only species figure given is black oyster).', src: 'F04-0088' }
    case 'G2':
      if (speciesKey === 'lions-mane')
        return { warn: 10, over: 14, basis: 'cold', rule: "Lion's mane spawn: no more than about 2 weeks cold; it still tries to fruit.", src: 'F04-0091' }
      if (speciesKey === 'comb-tooth')
        return { warn: 10, over: 14, basis: 'cold', rule: 'Comb tooth G2: stop at about 2 weeks, before it fruits.', src: 'F04-0090' }
      return { warn: 14, over: 21, basis: 'cold', rule: 'G2 bags: definitely 2 weeks cold; 3 weeks pushes the limit for any mushroom.', src: 'F04-0089' }
    default:
      return null // LC in the fridge is "being tested" (F04-0096); spore prints: nothing in the sources
  }
}

export type AgeState = 'ok' | 'warn' | 'over' | 'none'

export interface AgeCheck {
  state: AgeState
  days: number
  limit: AgeLimit | null
  text: string
}

export function checkAge(limit: AgeLimit | null, made: string, cold: string | null, now = todayIso()): AgeCheck {
  const basisDay = limit?.basis === 'cold' ? cold : made
  if (!limit) return { state: 'none', days: daysBetween(made, now), limit, text: 'NO LIMIT IN SOURCES' }
  if (!basisDay) return { state: 'ok', days: 0, limit, text: 'NOT IN COLD STORAGE' }
  const days = daysBetween(basisDay, now)
  const word = limit.basis === 'cold' ? 'COLD' : 'OLD'
  if (days > limit.over) return { state: 'over', days, limit, text: `${days} D ${word}, PAST ${limit.over} D` }
  if (days >= limit.warn) return { state: 'warn', days, limit, text: `${days} D ${word}, LIMIT ${limit.over} D` }
  return { state: 'ok', days, limit, text: `${days} D ${word}` }
}

export function cultureAge(c: Culture, now?: string): AgeCheck {
  return checkAge(ageLimit(c.kind), c.made_on, c.cold_since, now)
}
export function grainAge(g: GrainRun, speciesKey: string, now = todayIso()): AgeCheck {
  const lim = ageLimit(g.generation, speciesKey)
  if (g.status === 'cold_storage') return checkAge(lim, g.inoculated_on, g.cold_since ?? g.inoculated_on, now)
  // Not chilled yet: masters are fully grown about 2 weeks after inoculation, use or chill by week 3 (F05-0143, F05-0148).
  const days = daysBetween(g.inoculated_on, now)
  if (g.generation === 'G1' && days > 21) return { state: 'warn', days, limit: { warn: 21, over: 21, basis: 'made', rule: 'Fully grown about 2 weeks after inoculation; use it or chill it by week 3.', src: 'F05-0143 F05-0148' }, text: `${days} D, USE OR CHILL` }
  return { state: 'ok', days, limit: lim, text: `${days} D SINCE INOCULATION` }
}

// ---------- lineage tree ----------

export type NodeType = 'strain' | 'culture' | 'grain' | 'lot'

export interface TreeNode {
  key: string // c:<id>, g:<id>, b:<id>, s:<id>
  type: NodeType
  id: string
  children: TreeNode[]
  depth: number
  x: number
  y: number
}

export function nodeKey(type: 'culture' | 'grain' | 'lot', id: string) {
  return `${type === 'culture' ? 'c' : type === 'grain' ? 'g' : 'b'}:${id}`
}

/** Build one strain's tree: strain -> masters -> transfers / LC -> G1 -> G2 -> block lots. */
export function buildTree(strain: Strain, cultures: Culture[], runs: GrainRun[], lots: BlockLot[], showSpent = true): TreeNode {
  const cs = cultures.filter((c) => c.strain_id === strain.id)
  const gs = runs.filter((g) => g.strain_id === strain.id)
  const cIds = new Set(cs.map((c) => c.id))
  const gIds = new Set(gs.map((g) => g.id))
  const ls = lots.filter((l) => (l.grain_run_id && gIds.has(l.grain_run_id)) || l.strain_id === strain.id)
  const spent = (s: string) => ['used_up', 'discarded', 'spent'].includes(s)

  const seen = new Set<string>()
  const make = (type: NodeType, id: string, depth: number): TreeNode => {
    const key = type === 'strain' ? `s:${id}` : nodeKey(type, id)
    seen.add(key)
    const kids: TreeNode[] = []
    if (type === 'strain') {
      for (const c of cs) if (!c.parent_culture_id || !cIds.has(c.parent_culture_id)) kids.push(make('culture', c.id, depth + 1))
      for (const g of gs)
        if (!(g.parent_culture_id && cIds.has(g.parent_culture_id)) && !(g.parent_grain_run_id && gIds.has(g.parent_grain_run_id))) kids.push(make('grain', g.id, depth + 1))
      for (const l of ls) if (!l.grain_run_id || !gIds.has(l.grain_run_id)) kids.push(make('lot', l.id, depth + 1))
    } else if (type === 'culture') {
      for (const c of cs) if (c.parent_culture_id === id && !seen.has(nodeKey('culture', c.id))) kids.push(make('culture', c.id, depth + 1))
      for (const g of gs) if (g.parent_culture_id === id && !g.parent_grain_run_id && !seen.has(nodeKey('grain', g.id))) kids.push(make('grain', g.id, depth + 1))
    } else if (type === 'grain') {
      for (const g of gs) if (g.parent_grain_run_id === id && !seen.has(nodeKey('grain', g.id))) kids.push(make('grain', g.id, depth + 1))
      for (const l of ls) if (l.grain_run_id === id) kids.push(make('lot', l.id, depth + 1))
    }
    return { key, type, id, children: kids, depth, x: 0, y: 0 }
  }
  const root = make('strain', strain.id, 0)

  if (!showSpent) {
    const status = new Map<string, string>([
      ...cs.map((c) => [nodeKey('culture', c.id), c.status] as [string, string]),
      ...gs.map((g) => [nodeKey('grain', g.id), g.status] as [string, string]),
      ...ls.map((l) => [nodeKey('lot', l.id), l.status] as [string, string]),
    ])
    // A spent node stays if anything below it is still live, so the line is never broken.
    const prune = (n: TreeNode): boolean => {
      n.children = n.children.filter(prune)
      return n.type === 'strain' || n.children.length > 0 || !spent(status.get(n.key) ?? '')
    }
    prune(root)
  }

  // Leaves get one row each; a parent sits level with the middle of its children.
  let row = 0
  const place = (n: TreeNode) => {
    n.x = n.depth
    if (!n.children.length) {
      n.y = row++
      return
    }
    n.children.forEach(place)
    n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2
  }
  place(root)
  return root
}

export function flatten(n: TreeNode, out: TreeNode[] = []): TreeNode[] {
  out.push(n)
  n.children.forEach((c) => flatten(c, out))
  return out
}

// ---------- expansion planner ----------

export const RATIO = {
  /** One 6 lb G2 bag spawns about 20 blocks, ~0.3 lb per block (F05-0014). */
  blocksPerG2: 20,
  /** One 4 lb G1 master makes 12 G2 bags (F05-0013, F05-0015). */
  g2PerG1: 12,
  /** Never fewer than 6 G2 from a master: too much inoculum, uneven ages (F05-0013). Cap n Stem. */
  minG2PerG1: 6,
  /** Never more than 24 (F05-0013). */
  maxG2PerG1: 24,
  /** Plate to G1 at 2 cuts per bag: up to 12 masters per plate (F05-0011). */
  g1PerPlate: 12,
  /** At 4 cuts per bag (slow strains, agar-direct 6 lb bags): about 6 per plate (F05-0012). */
  directPerPlate: 6,
  /** A master is fully grown about 2 weeks after inoculation (F05-0143). */
  g1Days: 14,
  /** G2 holds 2 weeks in the fridge (F04-0089), so one master can cover two knock days. */
  g2HoldDays: 14,
}

export const RATIO_SRC = {
  blocksPerG2: 'F05-0014',
  g2PerG1: 'F05-0013',
  g1PerPlate: 'F05-0011',
  directPerPlate: 'F05-0012',
  g1Days: 'F05-0143',
  g2Hold: 'F04-0089',
}

/** Days from G2 inoculation to ready spawn, at 18-21 °C (t09 G2 timelines). Upper figure used. */
export const G2_DAYS: Record<string, { d: number; src: string; assumed?: boolean }> = {
  'blue-oyster': { d: 12, src: 'F05-0156' },
  'golden-oyster': { d: 12, src: 'F05-0156' },
  'phoenix-oyster': { d: 12, src: 'F05-0156' },
  'pink-oyster': { d: 12, src: 'F05-0156' },
  'king-oyster': { d: 12, src: 'F05-0158', assumed: true },
  'black-pearl': { d: 14, src: 'F05-0157' },
  'lions-mane': { d: 14, src: 'F05-0159' },
  'comb-tooth': { d: 18, src: 'F05-0160' },
  chestnut: { d: 21, src: 'F05-0161' },
  shiitake: { d: 28, src: 'F05-0162' },
  pioppino: { d: 28, src: 'F05-0163' },
  maitake: { d: 35, src: 'F05-0164' },
}

/** Days a plate needs between transfer and cutting into grain (100-bag farm schedule: oysters 8, lion's mane and coral tooth 15). */
export function plateLeadDays(speciesKey: string): { d: number; assumed: boolean } {
  if (['lions-mane', 'comb-tooth'].includes(speciesKey)) return { d: 15, assumed: false }
  if (/oyster|black-pearl/.test(speciesKey)) return { d: 8, assumed: speciesKey !== 'blue-oyster' && speciesKey !== 'golden-oyster' && speciesKey !== 'phoenix-oyster' }
  return { d: 15, assumed: true }
}

export type Route = 'none' | 'weekly' | 'fortnight' | 'direct'

export interface ChainPlan {
  blocks: number
  g2: number // G2 bags needed for this knock
  route: Route
  g1: number // masters to inoculate for this knock (fortnight: 1 every other week)
  g2PerMaster: number
  g2Made: number // G2 bags made from those masters (fortnight route makes two weeks' worth)
  plates: number
  g2Days: number
  g2Assumed: boolean
  plateDays: number
  plateAssumed: boolean
  knock: string
  g2By: string
  g1By: string | null
  plateBy: string
}

/** Work back from blocks on a knock day to G2 bags, G1 masters and plates, with dates. */
export function planChain(speciesKey: string, blocks: number, knock: string): ChainPlan {
  const b = Math.max(0, Math.floor(blocks))
  const g2 = Math.ceil(b / RATIO.blocksPerG2)
  const gd = G2_DAYS[speciesKey] ?? { d: 21, src: '', assumed: true }
  const pl = plateLeadDays(speciesKey)
  let route: Route = 'none'
  let g1 = 0
  let g2Made = g2
  let plates = 0
  if (g2 >= RATIO.minG2PerG1) {
    route = 'weekly'
    g1 = Math.ceil(g2 / RATIO.g2PerG1)
    plates = Math.ceil(g1 / RATIO.g1PerPlate)
  } else if (g2 > 0 && g2 * 2 >= RATIO.minG2PerG1) {
    // One master every second week makes two knocks' worth; the second half waits cold for one week (F04-0089).
    route = 'fortnight'
    g1 = 1
    g2Made = g2 * 2
    plates = 1
  } else if (g2 > 0) {
    // Too few bags for a master: straight from agar into 6 lb bags, 4 cuts per bag (F05-0012; farm schedule).
    route = 'direct'
    plates = Math.ceil(g2 / RATIO.directPerPlate)
  }
  const g2By = addDays(knock, -gd.d)
  const g1By = route === 'weekly' || route === 'fortnight' ? addDays(g2By, -RATIO.g1Days) : null
  const plateBy = addDays(g1By ?? g2By, -pl.d)
  return {
    blocks: b,
    g2,
    route,
    g1,
    g2PerMaster: g1 ? g2Made / g1 : 0,
    g2Made,
    plates,
    g2Days: gd.d,
    g2Assumed: !!gd.assumed || !G2_DAYS[speciesKey],
    plateDays: pl.d,
    plateAssumed: pl.assumed,
    knock,
    g2By,
    g1By,
    plateBy,
  }
}

export interface StrainStock {
  plates: number // usable plates P1-P4, not past the age limit
  g1: number // G1 masters on the shelf
  g2: number // G2 bags on the shelf
}

export function strainStock(strainId: string, speciesKey: string, cultures: Culture[], runs: GrainRun[], lots: BlockLot[], now = todayIso()): StrainStock {
  const plates = cultures.filter(
    (c) => c.strain_id === strainId && c.kind === 'plate' && isActiveCulture(c) && (c.p_level ?? 0) >= 1 && (c.p_level ?? 0) <= 4 && cultureAge(c, now).state !== 'over',
  ).length
  let g1 = 0
  let g2 = 0
  for (const r of runs) {
    if (r.strain_id !== strainId) continue
    if (grainAge(r, speciesKey, now).state === 'over') continue
    const left = grainRemaining(r, runs, lots)
    if (r.generation === 'G1') g1 += left
    else g2 += left
  }
  return { plates, g1, g2 }
}

export interface Shortfall {
  level: 'ok' | 'short'
  next: string
}

/** Walk down the chain from what is already on the shelf. */
export function shortfall(p: ChainPlan, s: StrainStock): Shortfall {
  if (p.route === 'none') return { level: 'ok', next: 'NO BLOCKS PLANNED' }
  if (s.g2 >= p.g2) return { level: 'ok', next: `G2 ON THE SHELF COVERS THIS KNOCK (${s.g2} OF ${p.g2})` }
  const needG2 = p.g2 - s.g2
  if (p.route === 'direct') {
    if (s.plates >= Math.ceil(needG2 / RATIO.directPerPlate)) return { level: 'ok', next: `KNOCK ${needG2} AGAR-DIRECT G2 FROM PLATES ON HAND` }
    return { level: 'short', next: `SHORT ${Math.ceil(needG2 / RATIO.directPerPlate) - s.plates} PLATE(S) FOR ${needG2} AGAR-DIRECT G2` }
  }
  const needG1 = Math.max(1, Math.ceil(needG2 / RATIO.g2PerG1))
  if (s.g1 >= needG1) return { level: 'ok', next: `KNOCK G2 FROM ${needG1} MASTER(S) ON HAND` }
  const needPlates = Math.ceil((needG1 - s.g1) / RATIO.g1PerPlate)
  if (s.plates >= needPlates) return { level: 'ok', next: `INOCULATE ${needG1 - s.g1} G1 FROM PLATES ON HAND` }
  return { level: 'short', next: `SHORT ${needPlates - s.plates} PLATE(S): TRANSFER FIRST` }
}

// ---------- QR deep links ----------

export const PUBLIC_URL = 'https://josephmclachlan.github.io/MY-CO-L/'

/** The address a label's QR code opens. */
export function recordUrl(key: string, here?: Location): string {
  let base = PUBLIC_URL
  if (here && /^https?:$/.test(here.protocol) && !/claude|usercontent|localhost:\d+\/?$/.test(here.host) && !/claude/.test(here.host)) base = here.origin + here.pathname
  return `${base}#xeno/${key.replace(':', '/')}`
}

/** Read a record key (c:<id>) from an address hash like #xeno/c/<id>. */
export function keyFromHash(hash: string): string | null {
  const m = /^#xeno\/([cgb])\/([0-9a-zA-Z-]+)$/.exec(hash)
  return m ? `${m[1]}:${m[2]}` : null
}
