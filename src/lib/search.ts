// SEARCH: find any record (or screen) from one box. Pure functions: the screen and the > prompt both use them.
//
// buildIndex() turns the store's tables into a flat list of documents, one per record. search() ranks them.
// Words are matched without capitals or accents (so COSECHA finds cosecha, NINO finds Niño), every word you type
// has to be found (AND), and a code typed exactly (B1020, BO-01, S4) always comes first.
// A role can hide documents: STAFF never sees money records (sales, orders, bills, labour, cash, waste).

import type { Row } from './store'
import { SPECIES } from '../data/species'
import { HAZARDS } from '../data/hazards'
import { MODULES } from '../data/farm'
import { KIND_LABEL as CULTURE_KIND } from './xeno'
import { hazardName } from './hazard'
import { rowName, tableName } from './history'
import { canOpenModule, type Role } from './roles'

export type Kind =
  | 'screen' | 'species' | 'hazard' | 'strain' | 'culture' | 'grain' | 'lot' | 'harvest' | 'item' | 'cook' | 'contam' | 'trial'
  | 'facility' | 'sensor' | 'sale' | 'order' | 'money' | 'bill' | 'labour'

/** The kinds, in the order the chips show. cost = money record, hidden from STAFF. */
export const KINDS: { id: Kind; label: string; cost: boolean }[] = [
  { id: 'screen', label: 'SCREENS', cost: false },
  { id: 'lot', label: 'BLOCK LOTS', cost: false },
  { id: 'harvest', label: 'HARVESTS', cost: false },
  { id: 'strain', label: 'STRAINS', cost: false },
  { id: 'culture', label: 'CULTURES', cost: false },
  { id: 'grain', label: 'GRAIN RUNS', cost: false },
  { id: 'cook', label: 'COOK RUNS', cost: false },
  { id: 'item', label: 'STOCK ITEMS', cost: false },
  { id: 'contam', label: 'CONTAM LOGS', cost: false },
  { id: 'trial', label: 'TRIALS', cost: false },
  { id: 'facility', label: 'FACILITY LOGS', cost: false },
  { id: 'sensor', label: 'SENSORS', cost: false },
  { id: 'species', label: 'SPECIES', cost: false },
  { id: 'hazard', label: 'HAZARD INDEX', cost: false },
  { id: 'sale', label: 'SALES', cost: true },
  { id: 'order', label: 'STANDING ORDERS', cost: true },
  { id: 'money', label: 'MONEY ENTRIES', cost: true },
  { id: 'bill', label: 'POWER BILLS', cost: true },
  { id: 'labour', label: 'LABOUR', cost: true },
]
export const KIND_LABEL: Record<Kind, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<Kind, string>
const COST = new Set(KINDS.filter((k) => k.cost).map((k) => k.id))

/** Where a hit opens. screen = module key (SPECIMEN, XENO, FACILITY ...). */
export interface Go {
  screen: string
  tab?: string
  /** XENO: strain id and record key (c:<id>, g:<id>, b:<id>). */
  strain?: string | null
  node?: string
  /** SPECIMEN species id, HAZARD entry id, COOK run id. */
  id?: string
}

export interface Doc {
  key: string
  kind: Kind
  table: string | null
  rowId: string | null
  title: string
  sub: string
  /** yyyy-mm-dd, for ordering equal scores newest first. */
  date: string
  go: Go
  /** Lower case, accents removed: what the words are matched against. */
  text: string
  /** The title and code words, same form, for ranking. */
  head: string
  /** The title alone, same form: a query that equals it exactly ranks first (B1020 finds the lot before its harvests). */
  ttl: string
}

export interface Hit extends Doc {
  score: number
}

/** Lower case, accents off, anything but letters and digits becomes one space. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/** Every short text value of a row (notes, names, codes), without ids and long data. */
function rowText(r: Row): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(r)) {
    if (k === 'id' || k.endsWith('_id') || k === 'data_url' || k === 'created_at' || k === 'updated_at') continue
    if (typeof v === 'string') {
      if (UUID.test(v) || v.length > 300) continue
      out.push(v)
    } else if (typeof v === 'number') out.push(String(v))
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out.push(v.join(' '))
  }
  return out.join(' ').slice(0, 700)
}

const DATE_FIELDS = ['harvested_on', 'sold_on', 'knock_date', 'made_on', 'inoculated_on', 'noted_on', 'down_at', 'tested_on', 'done_on', 'cleaned_on', 'started_at', 'moved_at', 'logged_on', 'day', 'month', 'worked_on', 'created_at']
const dateOf = (r: Row) => {
  for (const f of DATE_FIELDS) {
    const v = r[f]
    if (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) return v.length >= 10 ? v.slice(0, 10) : `${v.slice(0, 7)}-01`
  }
  return ''
}

export interface IndexInput {
  /** Rows of a table. Missing tables are empty. */
  rows: (table: string) => Row[]
  role: Role
}

const spName = (k: unknown) => SPECIES.find((s) => s.id === k)?.name ?? (typeof k === 'string' ? k.toUpperCase() : '')
const dash = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(' // ')

export function buildIndex(inp: IndexInput): Doc[] {
  const { rows, role } = inp
  const docs: Doc[] = []
  const strains = new Map(rows('strains').map((s) => [s.id, s]))
  const lots = new Map(rows('block_lots').map((l) => [l.id, l]))
  const scode = (id: unknown) => (typeof id === 'string' ? str(strains.get(id)?.code) : '')
  const add = (kind: Kind, table: string | null, r: Row | null, title: string, sub: string, go: Go, extra = '') => {
    if (role === 'staff' && COST.has(kind)) return
    const text = norm(`${title} ${sub} ${r ? rowText(r) : ''} ${extra}`)
    docs.push({ key: `${kind}:${r?.id ?? title}`, kind, table, rowId: r?.id ?? null, title, sub, date: r ? dateOf(r) : '', go, text, head: norm(`${title} ${extra}`), ttl: norm(title) })
  }

  // Screens: the places you can go, only those this role may open.
  for (const m of MODULES) {
    if (!canOpenModule(role, m.key)) continue
    add('screen', null, null, `${m.name}`, `${String(m.num).padStart(2, '0')} ${m.what}`, { screen: m.key }, `${m.key} ${m.num}`)
  }
  for (const s of SPECIES) add('species', null, null, s.name, s.latin ?? '', { screen: 'SPECIMEN', id: s.id }, `${s.id} ${s.latin ?? ''}`)
  for (const h of HAZARDS) add('hazard', null, null, h.name, h.aka ? `ALSO ${h.aka}` : h.kind.toUpperCase(), { screen: 'HAZARD', id: h.id }, `${h.aka ?? ''} ${h.id}`)

  for (const r of rows('strains')) add('strain', 'strains', r, str(r.code), dash(spName(r.species_key), str(r.name), str(r.source), r.active === false && 'RETIRED'), { screen: 'XENO', strain: r.id, tab: 'LINEAGE' })
  for (const r of rows('cultures')) {
    const sc = scode(r.strain_id)
    const kind = CULTURE_KIND[r.kind as keyof typeof CULTURE_KIND] ?? str(r.kind).toUpperCase()
    add('culture', 'cultures', r, str(r.label) || `${sc} ${kind} P${r.p_level ?? '?'}`, dash(sc, kind, str(r.status).toUpperCase(), str(r.made_on), str(r.location)), { screen: 'XENO', strain: str(r.strain_id), node: `c:${r.id}`, tab: 'LINEAGE' }, `${sc} ${kind}`)
  }
  for (const r of rows('grain_runs')) {
    const sc = scode(r.strain_id)
    add('grain', 'grain_runs', r, str(r.label) || `${sc} ${str(r.generation)} ${str(r.inoculated_on)}`, dash(sc, str(r.generation), str(r.status).toUpperCase(), `${r.bag_count ?? '?'} BAGS`, str(r.location)), { screen: 'XENO', strain: str(r.strain_id), node: `g:${r.id}`, tab: 'LINEAGE' }, sc)
  }
  for (const r of rows('block_lots')) {
    const sc = scode(r.strain_id)
    add('lot', 'block_lots', r, str(r.lot_code), dash(spName(r.species_key), str(r.status).toUpperCase(), `${r.bag_count ?? '?'} BLOCKS`, `KNOCK ${str(r.knock_date)}`, r.cart ? `CART ${str(r.cart)}` : '', str(r.room), sc), { screen: 'XENO', strain: str(r.strain_id), node: `b:${r.id}`, tab: 'LINEAGE' }, `${sc} ${spName(r.species_key)}`)
  }
  for (const r of rows('harvests')) {
    const lot = lots.get(str(r.block_lot_id))
    const code = str(lot?.lot_code) || '?'
    add('harvest', 'harvests', r, `${code} FLUSH ${str(r.flush)} ${str(r.kg)} KG`, dash(str(r.harvested_on), r.grade ? `GRADE ${str(r.grade)}` : '', r.initials ? `BY ${str(r.initials)}` : '', spName(lot?.species_key)), { screen: 'MISSION', tab: 'HARVEST' }, code)
  }
  for (const r of rows('items')) add('item', 'items', r, str(r.name), dash(str(r.category), str(r.supplier), str(r.code), str(r.unit)), { screen: 'CARGO' })
  for (const r of rows('cook_runs')) add('cook', 'cook_runs', r, dash(str(r.unit_label) || str(r.kind).toUpperCase(), str(r.started_at).slice(0, 10)).replace(' // ', ' '), dash(str(r.purpose), str(r.load_desc), r.bag_count ? `${r.bag_count} BAGS` : ''), { screen: 'PROPULSION', id: r.id, tab: 'RUN' })
  for (const r of rows('hazard_logs')) add('contam', 'hazard_logs', r, `${hazardName(str(r.hazard_key) || null)} ${str(r.noted_on)}`, dash(`${r.bag_count ?? '?'} BAGS`, str(r.source_kind), scode(r.strain_id), str(r.notes)), { screen: 'HAZARD', id: str(r.hazard_key) || undefined, tab: 'SPOT' }, scode(r.strain_id))
  for (const r of rows('strain_trials')) add('trial', 'strain_trials', r, str(r.name), dash(spName(r.species_key), str(r.status).toUpperCase(), str(r.question)), { screen: 'YIELD', tab: 'TRIALS' })
  const fac: [string, string][] = [['power_cuts', 'POWER CUTS'], ['water_tests', 'WATER'], ['maint_items', 'MAINTENANCE'], ['clean_log', 'CLEANING'], ['checklist_runs', 'CHECKLISTS'], ['reminders', 'REMINDERS']]
  for (const [t, tab] of fac) for (const r of rows(t)) add('facility', t, r, rowName(t, r), dash(tableName(t), str(r.notes), str(r.losses), str(r.action)), { screen: 'FACILITY', tab })
  for (const r of rows('sensors')) add('sensor', 'sensors', r, str(r.name), dash(str(r.place), str(r.vendor), str(r.model)), { screen: 'ATMOS', tab: 'SENSORS' })

  // Money records (STAFF never gets these).
  for (const r of rows('sales')) {
    add('sale', 'sales', r, dash(str(r.receipt_no), str(r.buyer) || 'SALE'), dash(str(r.sold_on), `${str(r.kg)} KG`, spName(r.species_key), `₡${Math.round(Number(r.amount_crc) || 0).toLocaleString('en-US')}`, str(r.pay_status).toUpperCase(), str(r.channel)), { screen: 'TRADE', tab: 'LOG' })
  }
  for (const r of rows('standing_orders')) add('order', 'standing_orders', r, `${str(r.buyer)} ${spName(r.species_key)}`, dash(`${str(r.kg)} KG/WEEK`, str(r.channel), r.end_on ? `ENDED ${str(r.end_on)}` : 'RUNNING'), { screen: 'ORDERS', tab: 'ORDERS' })
  for (const r of rows('cash_moves')) add('money', 'cash_moves', r, rowName('cash_moves', r), dash(`₡${Math.round(Number(r.amount_crc) || 0).toLocaleString('en-US')}`, str(r.who), str(r.notes)), { screen: 'MONEY', tab: 'SPEND' })
  for (const r of rows('waste_log')) add('money', 'waste_log', r, rowName('waste_log', r), dash(`${str(r.kg)} KG`, spName(r.species_key), str(r.route), str(r.notes)), { screen: 'MONEY', tab: 'WASTE' })
  for (const r of rows('energy_bills')) add('bill', 'energy_bills', r, `POWER BILL ${str(r.month).slice(0, 7)}`, dash(`${str(r.kwh)} KWH`, `₡${Math.round(Number(r.total_crc) || 0).toLocaleString('en-US')}`, str(r.notes)), { screen: 'LEDGER' })
  for (const r of rows('labour_entries')) add('labour', 'labour_entries', r, dash(str(r.person), str(r.worked_on)).replace(' // ', ' '), dash(`${str(r.hours)} H`, str(r.task), str(r.notes)), { screen: 'LEDGER' })
  return docs
}

export interface SearchOpts {
  kinds?: ReadonlySet<Kind> | null
  limit?: number
}

/** Rank documents for a query. Every word must appear; a title that starts with the words, or a whole-word code match, ranks higher. */
export function search(docs: Doc[], query: string, opts: SearchOpts = {}): { hits: Hit[]; total: number } {
  const q = norm(query)
  if (!q) return { hits: [], total: 0 }
  const qw = q.split(' ')
  const limit = opts.limit ?? 200
  const hits: Hit[] = []
  for (const d of docs) {
    if (opts.kinds && opts.kinds.size && !opts.kinds.has(d.kind)) continue
    let score = 0
    let ok = true
    for (const w of qw) {
      const at = d.text.indexOf(w)
      if (at < 0) {
        ok = false
        break
      }
      const wordStart = at === 0 || d.text[at - 1] === ' '
      const inHead = d.head.indexOf(w)
      const headWordStart = inHead === 0 || (inHead > 0 && d.head[inHead - 1] === ' ')
      const whole = new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(d.head)
      score += whole ? 40 : headWordStart ? 25 : inHead >= 0 ? 12 : wordStart ? 8 : 3
    }
    if (!ok) continue
    if (d.ttl === q || d.head === q) score += 1000
    else if (d.head.startsWith(q)) score += 120
    if (d.kind === 'screen') score += 6
    hits.push({ ...d, score })
  }
  hits.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
  return { hits: hits.slice(0, limit), total: hits.length }
}

/** Count of documents by kind, for the chip numbers. */
export function countByKind(hits: Doc[]): Map<Kind, number> {
  const m = new Map<Kind, number>()
  for (const h of hits) m.set(h.kind, (m.get(h.kind) ?? 0) + 1)
  return m
}
