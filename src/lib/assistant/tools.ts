// FARM ASSISTANT tools: the only way the assistant learns anything or saves anything.
//
// READ tools look records up in the Store and answer with plain lines plus the screen they came from.
// WRITE tools never write: they return a PLAN (what would be saved). The ASK screen shows it, the person
// presses CONFIRM, and only then plan.apply() runs inside store.action() (one UNDO step, edit history).
// MONEY tools are refused for STAFF here, on top of the Store refusing the money tables to staff.
//
// The same list is handed to the local model as its function list (llm.ts), so the model can only
// do what these tools allow.

import { SPECIES } from '../../data/species'
import { GRADES } from '../../data/ledger'
import { canOpenModule, canSeeMoney } from '../roles'
import { uuid, type Row } from '../store'
import { addDays, daysBetween, pCounts, strainStock, isActiveCulture, type BlockLot, type Culture, type GrainRun, type LotStatus, type Strain } from '../xeno'
import type { Harvest } from '../ledger'
import type { LotLoss } from '../hazard'
import { board, nextFlush, todayList } from '../mission'
import { lotRecord, roomName, type FlushLog } from '../records'
import { LB_TO_KG } from '../runplan'
import { owed, payStatus } from '../money'
import type { Sale } from '../trade'
import { cutStats, fmtHours, fmtMin, isOpenCut, lastMonths, outageSummary, stamp, type PowerCut } from '../facility'
import { genStart, genStop, powerBack, powerOut } from '../facilityActions'
import { onHandMap, stockState, weeklyUse, weeksLeft, fmtQty, type Item, type Move } from '../cargo'
import { newMove } from '../cargoActions'
import { MEASURES, PLACES, PLACE_LABEL, SENSORS_ID, alarms, checkReading, fmtVal, indexReadings, mergeSensorSettings, placeNow, type AcCheck, type PlaceId, type Reading, type Sensor } from '../sensors'
import { addReading } from '../sensorActions'
import { markPaid } from '../moneyActions'
import { bulkLots } from '../recordsActions'
import { search as runSearch, KIND_LABEL } from '../search'
import {
  PERIODS,
  clean,
  crcText,
  inRange,
  kgText,
  numArg,
  periodRange,
  plural,
  resolveDay,
  resolvePeriod,
  resolvePlace,
  resolveRoom,
  resolveSpecies,
  speciesName,
  str,
  type Args,
  type AskCtx,
  type Cite,
  type Plan,
  type ToolOut,
} from './core'

// ---------- tool shape ----------

export interface Param {
  type: 'string' | 'number'
  desc: string
  enum?: readonly string[]
}
export interface Tool {
  name: string
  /** One line the local model reads to pick the tool. */
  desc: string
  params: Record<string, Param>
  required?: string[]
  /** Reads or writes money: refused for STAFF. */
  money?: boolean
  /** Returns a plan to confirm instead of an answer. */
  write?: boolean
  run: (ctx: AskCtx, a: Args) => Promise<ToolOut>
}

const answer = (lines: string[], cite: Cite[]): ToolOut => ({ kind: 'answer', lines, cite })
const askFor = (lines: string[], cite: Cite[] = []): ToolOut => ({ kind: 'ask', lines, cite })
const plan = (p: Plan): ToolOut => ({ kind: 'plan', plan: p })

async function rows<T extends Row>(ctx: AskCtx, table: string): Promise<T[]> {
  await ctx.store.ensure(table)
  return ctx.store.rows<T>(table)
}

const C = {
  board: { label: 'MISSION CONTROL > BOARD', go: { screen: 'MISSION', tab: 'BOARD' } },
  today: { label: 'MISSION CONTROL > TODAY', go: { screen: 'MISSION', tab: 'TODAY' } },
  harvest: { label: 'MISSION CONTROL > HARVEST LOG', go: { screen: 'MISSION', tab: 'HARVEST' } },
  flushes: { label: 'PRODUCTION RECORDS > FLUSH LOG', go: { screen: 'YIELD', tab: 'FLUSHES' } },
  owed: { label: 'MONEY > OWED', go: { screen: 'MONEY', tab: 'OWED' } },
  sales: { label: 'TRADE > LOG', go: { screen: 'TRADE', tab: 'LOG' } },
  cuts: { label: 'FACILITY LOGS > POWER CUTS', go: { screen: 'FACILITY', tab: 'POWER CUTS' } },
  cargo: { label: 'CARGO', go: { screen: 'CARGO' } },
  climate: { label: 'ATMOSPHERICS > NOW', go: { screen: 'ATMOS', tab: 'NOW' } },
  alarms: { label: 'ATMOSPHERICS > ALARMS', go: { screen: 'ATMOS', tab: 'ALARMS' } },
} satisfies Record<string, Cite>

const lotCite = (l: BlockLot): Cite => ({ label: `XENOGENETICS > LINEAGE > ${l.lot_code}`, go: { screen: 'XENO', strain: l.strain_id, node: `b:${l.id}`, tab: 'LINEAGE' } })
const strainCite = (s: Strain): Cite => ({ label: `XENOGENETICS > ${s.code}`, go: { screen: 'XENO', strain: s.id, tab: 'LINEAGE' } })
const speciesCite = (key: string, tab: string): Cite => ({ label: `SPECIMEN FILES > ${speciesName(key)} > ${tab}`, go: { screen: 'SPECIMEN', id: key } })

/** A lot from its code: exact, then without the dash, then a unique start. */
export function findLot(lots: BlockLot[], v: unknown): BlockLot | null {
  const s = str(v).trim().toUpperCase().replace(/^LOT\s+/, '')
  if (!s) return null
  const exact = lots.find((l) => l.lot_code.toUpperCase() === s)
  if (exact) return exact
  const flat = (x: string) => x.replace(/[^A-Z0-9]/g, '')
  const f = lots.filter((l) => flat(l.lot_code.toUpperCase()) === flat(s))
  return f.length === 1 ? f[0] : null
}

const isActive = (l: BlockLot) => l.status === 'incubating' || l.status === 'fruiting'
const LOT_STATUS_WORDS = ['incubating', 'fruiting', 'active', 'spent', 'lost', 'all'] as const
const statusOf = (v: unknown): (typeof LOT_STATUS_WORDS)[number] | null => {
  const s = clean(str(v))
  if (!s) return null
  if ((LOT_STATUS_WORDS as readonly string[]).includes(s)) return s as (typeof LOT_STATUS_WORDS)[number]
  if (/^(fruit|pinning|picking|in fruiting)/.test(s)) return 'fruiting'
  if (/^(incub|colon|growing out)/.test(s)) return 'incubating'
  if (/^(done|finished|spent|retired)/.test(s)) return 'spent'
  if (/^(dead|contam|lost|binned|thrown)/.test(s)) return 'lost'
  if (/^(live|alive|current|running|in the rooms)/.test(s)) return 'active'
  return null
}

/** Item from words: code, whole name, then the item whose name shares the most words. */
export function findItem(items: Item[], v: unknown): Item | null {
  const s = clean(str(v))
  if (!s) return null
  const code = items.find((i) => clean(str(i.code)) === s)
  if (code) return code
  const whole = items.find((i) => clean(i.name) === s)
  if (whole) return whole
  const stem = (w: string) => w.replace(/(es|s)$/, '')
  const want = s.split(' ').filter((w) => w.length > 2 && !['the', 'and', 'bag', 'bags', 'sack', 'sacks', 'box', 'boxes', 'roll', 'rolls'].includes(w)).map(stem)
  if (!want.length) return null
  let best: { i: Item; n: number } | null = null
  let tie = false
  for (const i of items) {
    const have = new Set(clean(i.name).split(' ').map(stem))
    const n = want.filter((w) => have.has(w)).length
    if (!n) continue
    if (!best || n > best.n) {
      best = { i, n }
      tie = false
    } else if (n === best.n) tie = true
  }
  return best && !tie && best.n >= Math.min(2, want.length) ? best.i : null
}

// ---------- READ: lots ----------

const countLots: Tool = {
  name: 'count_lots',
  desc: 'Count block lots and blocks, by species, status (incubating, fruiting, active, spent, lost, all) and room.',
  params: {
    species: { type: 'string', desc: 'species name, e.g. lions mane, blue oyster. Leave out for all.' },
    status: { type: 'string', desc: 'incubating, fruiting, active (both), spent, lost or all', enum: LOT_STATUS_WORDS },
    room: { type: 'string', desc: 'room: lab, incubation, fruiting, packing, boiling' },
  },
  async run(ctx, a) {
    const lots = await rows<BlockLot>(ctx, 'block_lots')
    const losses = await rows<LotLoss>(ctx, 'lot_losses')
    const sp = resolveSpecies(a.species)
    if (str(a.species) && !sp) return askFor([`NO SPECIES CALLED ${str(a.species).toUpperCase()}. TRY BLUE OYSTER, LION'S MANE, SHIITAKE.`])
    const st = statusOf(a.status) ?? 'active'
    const room = resolveRoom(a.room)
    const pick = lots.filter((l) => (!sp || l.species_key === sp) && (st === 'all' ? true : st === 'active' ? isActive(l) : l.status === st) && (!room || (l.room ?? (l.status === 'fruiting' ? 'fruiting' : l.status === 'incubating' ? 'incubation' : null)) === room))
    const alive = (l: BlockLot) => Math.max(0, l.bag_count - losses.filter((x) => x.block_lot_id === l.id).reduce((n, x) => n + x.bag_count, 0))
    const blocks = pick.reduce((n, l) => n + (st === 'lost' || st === 'spent' ? l.bag_count : alive(l)), 0)
    const what = `${sp ? speciesName(sp) : 'ALL SPECIES'} // ${st === 'active' ? 'INCUBATING + FRUITING' : st.toUpperCase()}${room ? ` // ${roomName(room)}` : ''}`
    if (!pick.length) return answer([`${what}: NO LOTS.`], [C.board])
    const list = [...pick].sort((x, y) => y.knock_date.localeCompare(x.knock_date))
    const lines = [`${what}: ${plural(pick.length, 'LOT')}, ${plural(blocks, 'BLOCK')}${st === 'active' || st === 'incubating' || st === 'fruiting' ? ' ALIVE' : ''}.`]
    for (const l of list.slice(0, 8)) lines.push(`  ${l.lot_code}  ${speciesName(l.species_key)}  ${l.status.toUpperCase()}  ${plural(st === 'lost' || st === 'spent' ? l.bag_count : alive(l), 'BLOCK')}  KNOCKED ${l.knock_date}`)
    if (list.length > 8) lines.push(`  ... AND ${list.length - 8} MORE ON THE BOARD`)
    return answer(lines, [C.board])
  },
}

const lotDetails: Tool = {
  name: 'lot_details',
  desc: 'Everything about one block lot by its code (e.g. B1020): species, strain, status, room, blocks, kg picked, BE%.',
  params: { lot: { type: 'string', desc: 'lot code, e.g. B1020' } },
  required: ['lot'],
  async run(ctx, a) {
    const lots = await rows<BlockLot>(ctx, 'block_lots')
    const lot = findLot(lots, a.lot)
    if (!lot) return askFor([str(a.lot) ? `NO LOT ${str(a.lot).toUpperCase()} ON FILE.` : 'WHICH LOT? TYPE ITS CODE, E.G. B1020.'], [C.board])
    const [losses, harvests, pins, strains] = await Promise.all([rows<LotLoss>(ctx, 'lot_losses'), rows<Harvest>(ctx, 'harvests'), rows<FlushLog>(ctx, 'flush_log'), rows<Strain>(ctx, 'strains')])
    const rec = lotRecord(lot, losses, harvests, pins)
    const strain = strains.find((s) => s.id === lot.strain_id)
    const lines = [
      `LOT ${lot.lot_code} // ${speciesName(lot.species_key)}${strain ? ` // STRAIN ${strain.code}` : ''} // ${lot.status.toUpperCase()}`,
      `KNOCKED ${lot.knock_date} (DAY ${Math.max(0, daysBetween(lot.knock_date, ctx.today))}) // ${plural(rec.blocks, 'BLOCK')} ALIVE OF ${lot.bag_count}${rec.lost ? `, ${rec.lost} LOST` : ''}`,
      `ROOM ${roomName(lot.room ?? null)}${lot.cart ? ` // CART ${lot.cart}` : ''}${lot.to_fruiting_on ? ` // TO FRUITING ${lot.to_fruiting_on}` : ''}`,
      `PICKED ${kgText(rec.kg)} IN ${plural(rec.flushes.length, 'FLUSH', 'FLUSHES')}${rec.be !== null ? ` // BE ${rec.be.toFixed(1)}%` : ''}${rec.kgPerBlock !== null ? ` // ${rec.kgPerBlock.toFixed(2)} KG PER BLOCK` : ''}`,
    ]
    return answer(lines, [lotCite(lot), C.flushes])
  },
}

const harvestTotal: Tool = {
  name: 'harvest_total',
  desc: 'Kilograms picked (harvested), for a species or one lot, over a period.',
  params: {
    species: { type: 'string', desc: 'species name. Leave out for all.' },
    lot: { type: 'string', desc: 'lot code, e.g. B1020' },
    period: { type: 'string', desc: 'time span', enum: PERIODS },
  },
  async run(ctx, a) {
    const [lots, harvests] = await Promise.all([rows<BlockLot>(ctx, 'block_lots'), rows<Harvest>(ctx, 'harvests')])
    const lot = str(a.lot) ? findLot(lots, a.lot) : null
    if (str(a.lot) && !lot) return askFor([`NO LOT ${str(a.lot).toUpperCase()} ON FILE.`], [C.harvest])
    const sp = lot ? null : resolveSpecies(a.species)
    const per = resolvePeriod(a.period, lot ? 'all' : 'this_week')
    const r = periodRange(per, ctx.today)
    const byId = new Map(lots.map((l) => [l.id, l]))
    const pick = harvests.filter((h) => inRange(h.harvested_on, r) && (lot ? h.block_lot_id === lot.id : !sp || byId.get(h.block_lot_id)?.species_key === sp))
    const kg = pick.reduce((n, h) => n + Number(h.kg || 0), 0)
    const span = per === 'all' ? 'ALL TIME' : r.from === r.to ? `${r.label} (${r.from})` : `${r.label} (${r.from} TO ${r.to})`
    const who = lot ? `LOT ${lot.lot_code}` : sp ? speciesName(sp) : 'ALL SPECIES'
    const lines = [`${who} PICKED ${span}: ${kgText(kg)} IN ${plural(pick.length, 'PICK')}.`]
    if (!lot && pick.length) {
      const per2 = new Map<string, number>()
      for (const h of pick) {
        const k = sp ? (byId.get(h.block_lot_id)?.lot_code ?? '?') : speciesName(byId.get(h.block_lot_id)?.species_key)
        per2.set(k, (per2.get(k) ?? 0) + Number(h.kg || 0))
      }
      for (const [k, v] of [...per2].sort((x, y) => y[1] - x[1]).slice(0, 6)) lines.push(`  ${k}  ${kgText(v)}`)
    }
    return answer(lines, [lot ? lotCite(lot) : C.harvest])
  },
}

const dueToday: Tool = {
  name: 'due_today',
  desc: 'What needs doing today: lots to move, lots to pick, plates and grain getting old, stock to reorder.',
  params: {},
  async run(ctx) {
    const [lots, losses, harvests, cultures, grain, strains, items, moves] = await Promise.all([
      rows<BlockLot>(ctx, 'block_lots'), rows<LotLoss>(ctx, 'lot_losses'), rows<Harvest>(ctx, 'harvests'), rows<Culture>(ctx, 'cultures'),
      rows<GrainRun>(ctx, 'grain_runs'), rows<Strain>(ctx, 'strains'), rows<Item>(ctx, 'items'), rows<Move>(ctx, 'stock_moves'),
    ])
    const reorders = stockRows(items, moves, ctx.now).filter((r) => r.state === 'LOW' || r.state === 'OUT').map((r) => ({ id: r.item.id, name: r.item.name, state: r.state, weeks: r.weeks }))
    const list = todayList({ rows: board(lots, losses, harvests, ctx.today), cultures, grain, strains, reorders, now: ctx.today })
    if (!list.length) return answer([`NOTHING IS DUE TODAY (${ctx.today}).`], [C.today])
    const lines = [`${plural(list.length, 'THING')} DUE TODAY (${ctx.today}):`, ...list.slice(0, 10).map((x) => `  ${x.warn ? '! ' : ''}${x.text}`)]
    if (list.length > 10) lines.push(`  ... AND ${list.length - 10} MORE`)
    return answer(lines, [C.today])
  },
}

// ---------- READ: strains and species files ----------

const strainStatus: Tool = {
  name: 'strain_status',
  desc: 'One strain by its code (e.g. LM-01): plates, slants, water tubes, grain on hand, lots.',
  params: { strain: { type: 'string', desc: 'strain code, e.g. LM-01 or BO-02' } },
  required: ['strain'],
  async run(ctx, a) {
    const strains = await rows<Strain>(ctx, 'strains')
    const q = str(a.strain).trim().toUpperCase()
    const s = strains.find((x) => x.code.toUpperCase() === q) ?? strains.find((x) => x.code.replace('-', '').toUpperCase() === q.replace('-', ''))
    if (!s) return askFor([q ? `NO STRAIN ${q} ON FILE.` : 'WHICH STRAIN? TYPE ITS CODE, E.G. LM-01.'], [{ label: 'XENOGENETICS > STRAINS', go: { screen: 'XENO', tab: 'STRAINS' } }])
    const [cultures, runs, lots] = await Promise.all([rows<Culture>(ctx, 'cultures'), rows<GrainRun>(ctx, 'grain_runs'), rows<BlockLot>(ctx, 'block_lots')])
    const pc = pCounts(s.id, cultures)
    const stock = strainStock(s.id, s.species_key, cultures, runs, lots, ctx.today)
    const mine = cultures.filter((c) => c.strain_id === s.id && isActiveCulture(c))
    const slants = mine.filter((c) => c.kind === 'slant').length
    const water = mine.filter((c) => c.kind === 'water').length
    const myLots = lots.filter((l) => l.strain_id === s.id && isActive(l))
    return answer(
      [
        `STRAIN ${s.code} // ${speciesName(s.species_key)}${s.name ? ` // ${s.name.toUpperCase()}` : ''}${s.active === false ? ' // RETIRED' : ''}`,
        `BANK: ${plural(slants, 'SLANT')}, ${plural(water, 'WATER TUBE')} // PLATES BY P-LEVEL: ${Object.entries(pc).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(', ')}`,
        `USABLE NOW: ${plural(stock.plates, 'PLATE')}, ${stock.g1} G1 MASTERS, ${stock.g2} G2 BAGS // ${plural(myLots.length, 'LOT')} IN THE ROOMS`,
      ],
      [strainCite(s)],
    )
  },
}

const TOPICS = ['climate', 'timeline', 'yield', 'cultivation', 'hazards'] as const
const TOPIC_KEY: Record<(typeof TOPICS)[number], string> = { climate: 'climate', timeline: 'timeline', yield: 'yield_', cultivation: 'cultivation', hazards: 'hazards' }
const speciesFacts: Tool = {
  name: 'species_facts',
  desc: "The farm's own SPECIMEN FILES readout for a species: climate (temperatures, RH, CO2), timeline, yield, cultivation or hazards.",
  params: {
    species: { type: 'string', desc: 'species name' },
    topic: { type: 'string', desc: 'which part', enum: TOPICS },
  },
  required: ['species'],
  async run(_ctx, a) {
    const key = resolveSpecies(a.species)
    if (!key) return askFor(['WHICH SPECIES? E.G. BLUE OYSTER OR LION\'S MANE.'])
    const sp = SPECIES.find((s) => s.id === key)!
    const t = (TOPICS as readonly string[]).includes(clean(str(a.topic))) ? (clean(str(a.topic)) as (typeof TOPICS)[number]) : 'climate'
    const list = ((sp as unknown as Record<string, unknown>)[TOPIC_KEY[t]] ?? []) as { k?: string; v?: string }[]
    const lines = [`${sp.name} // ${t.toUpperCase()} (FROM THE SPECIMEN FILE):`]
    for (const x of list.slice(0, 8)) if (x.k && x.v) lines.push(`  ${x.k.toUpperCase()}: ${x.v}`)
    if (lines.length === 1) lines.push('  NOTHING ON FILE FOR THAT PART.')
    return answer(lines, [speciesCite(key, t.toUpperCase())])
  },
}

// ---------- READ: stock ----------

function stockRows(items: Item[], moves: Move[], now: number) {
  const hand = onHandMap(moves)
  const counted = new Set(moves.map((m) => m.item_id))
  return items.map((item) => {
    const onHand = hand.get(item.id) ?? 0
    const use = weeklyUse(item, undefined, moves, now)
    const weeks = weeksLeft(onHand, use)
    return { item, onHand, weeks, state: stockState(item, onHand, counted.has(item.id), weeks) }
  })
}

const stockStatus: Tool = {
  name: 'stock_status',
  desc: 'Stock on hand. With an item name: how much is left. Without: every item that is low or out.',
  params: { item: { type: 'string', desc: 'item name, e.g. soy hulls, filter patch bags. Leave out for the low list.' } },
  async run(ctx, a) {
    const [items, moves] = await Promise.all([rows<Item>(ctx, 'items'), rows<Move>(ctx, 'stock_moves')])
    const all = stockRows(items, moves, ctx.now)
    if (str(a.item)) {
      const it = findItem(items, a.item)
      if (!it) return askFor([`NO STOCK ITEM MATCHES ${str(a.item).toUpperCase()}.${items.length ? '' : ' CARGO HAS NO ITEMS YET.'}`], [C.cargo])
      const r = all.find((x) => x.item.id === it.id)!
      return answer([`${it.name.toUpperCase()}: ${fmtQty(r.onHand)} ${it.unit.toUpperCase()} ON HAND // ${r.state}${r.weeks !== null ? ` // ABOUT ${r.weeks.toFixed(1)} WEEKS LEFT` : ''}`], [C.cargo])
    }
    const low = all.filter((r) => r.state === 'LOW' || r.state === 'OUT').sort((x, y) => (x.state === 'OUT' ? 0 : 1) - (y.state === 'OUT' ? 0 : 1))
    if (!items.length) return answer(['CARGO HAS NO ITEMS YET.'], [C.cargo])
    if (!low.length) return answer([`NOTHING IS LOW. ${plural(items.length, 'ITEM')} CHECKED.`], [C.cargo])
    return answer([`${plural(low.length, 'ITEM')} LOW OR OUT:`, ...low.slice(0, 10).map((r) => `  ${r.state === 'OUT' ? '! ' : ''}${r.item.name.toUpperCase()}  ${fmtQty(r.onHand)} ${r.item.unit.toUpperCase()}  ${r.state}`)], [C.cargo])
  },
}

// ---------- READ: power cuts and climate ----------

const powerCuts: Tool = {
  name: 'power_cuts',
  desc: 'Power cuts: whether the power is out now, how many cuts and hours without power this month, last month or the last 12 months.',
  params: { period: { type: 'string', desc: 'this_month (default), last_month, this_year (= last 12 months), today, this_week, last_week', enum: PERIODS } },
  async run(ctx, a) {
    const cuts = await rows<PowerCut>(ctx, 'power_cuts')
    const sum = outageSummary(cuts, ctx.now)
    const per = resolvePeriod(a.period, 'this_month')
    const lines: string[] = []
    if (sum.open) lines.push(`! POWER IS OUT NOW: SINCE ${stamp(Date.parse(sum.open.down_at))}, ${fmtMin(cutStats(sum.open, ctx.now).gridMin)} SO FAR.`)
    else lines.push(sum.last?.up_at ? `POWER IS ON. LAST CUT ENDED ${stamp(Date.parse(sum.last.up_at))}.` : 'POWER IS ON. NO CUTS LOGGED YET.')
    if (per === 'this_month' || per === 'last_month') {
      const ms = lastMonths(cuts, ctx.now, 2)
      const m = per === 'this_month' ? ms[1] : ms[0]
      lines.push(`${per === 'this_month' ? 'THIS MONTH' : 'LAST MONTH'} (${m.month}): ${plural(m.cuts, 'CUT')}, ${fmtHours(m.gridMin)} WITHOUT GRID POWER, ${fmtHours(m.darkMin)} FULLY DARK (NO GENERATOR), GENERATOR ${m.genHours.toFixed(1)} H.`)
    } else if (per === 'this_year' || per === 'all') {
      const y = sum.year
      lines.push(`LAST 12 MONTHS: ${plural(y.cuts, 'CUT')}, ${fmtHours(y.gridMin)} WITHOUT GRID POWER, ${fmtHours(y.darkMin)} FULLY DARK, LONGEST ${fmtMin(y.longestMin)}.`)
    } else {
      const r = periodRange(per, ctx.today)
      const list = cuts.filter((c) => c.kind === 'cut' && inRange(c.down_at.slice(0, 10), r))
      const min = list.reduce((n, c) => n + cutStats(c, ctx.now).gridMin, 0)
      lines.push(`${r.label}: ${plural(list.length, 'CUT')} STARTED, ${fmtHours(min)} WITHOUT GRID POWER.`)
    }
    return answer(lines, [C.cuts])
  },
}

const climateNow: Tool = {
  name: 'climate_now',
  desc: 'Latest temperature, humidity and CO2 for a room (or every room), and any climate alarms.',
  params: { room: { type: 'string', desc: 'lab, culture fridge, packing, cold room, incubation, fruiting, boiling, outside. Leave out for all.' } },
  async run(ctx, a) {
    const [readings, sensors, ac, cuts, settingsRows] = await Promise.all([rows<Reading>(ctx, 'sensor_readings'), rows<Sensor>(ctx, 'sensors'), rows<AcCheck>(ctx, 'ac_log'), rows<PowerCut>(ctx, 'power_cuts'), rows<Row>(ctx, 'app_settings')])
    const st = mergeSensorSettings((settingsRows.find((r) => r.id === SENSORS_ID) as { value?: unknown } | undefined)?.value)
    const idx = indexReadings(readings)
    const one = resolvePlace(a.room)
    if (str(a.room) && !one) return askFor([`NO SENSOR PLACE CALLED ${str(a.room).toUpperCase()}. TRY FRUITING, INCUBATION, LAB OR CULTURE FRIDGE.`], [C.climate])
    const places = one ? [one] : PLACES.map((p) => p.id)
    const lines: string[] = []
    for (const p of places) {
      const pn = placeNow(idx, p, st, ctx.now)
      if (pn.last === null) {
        if (one) lines.push(`${PLACE_LABEL[p]}: NO READINGS YET.`)
        continue
      }
      const vals = pn.measures.filter((m) => m.value !== null).map((m) => `${MEASURES.find((x) => x.id === m.measure)!.label} ${fmtVal(m.value, m.measure)}${m.side !== 'ok' ? ` (${m.side.toUpperCase()})` : ''}`)
      lines.push(`${pn.alarm ? '! ' : ''}${PLACE_LABEL[p]}: ${vals.join(', ')} // AT ${stamp(pn.last)}${pn.measures.some((m) => m.stale) ? ' (OLD READING)' : ''}`)
    }
    if (!lines.length) lines.push('NO CLIMATE READINGS YET. LOG ONE ON ATMOSPHERICS OR IMPORT A GOVEE CSV.')
    const openCut = cuts.find(isOpenCut) ?? null
    const al = alarms({ idx, sensors, ac, settings: st, now: ctx.now, openCut }).filter((x) => !one || x.place === one || x.place === null)
    if (al.length) lines.push(`${plural(al.length, 'ALARM')}: ${al.slice(0, 3).map((x) => x.text).join(' / ')}`)
    return answer(lines, [al.length ? C.alarms : C.climate])
  },
}

// ---------- READ: money (owner only) ----------

const whoOwes: Tool = {
  name: 'who_owes',
  desc: 'Who owes the farm money: unpaid sales by buyer, oldest first.',
  params: {},
  money: true,
  async run(ctx) {
    const sales = await rows<Sale>(ctx, 'sales')
    const o = owed(sales, ctx.today)
    if (!o.buyers.length) return answer(['NOBODY OWES ANYTHING. EVERY SALE IS PAID.'], [C.owed])
    return answer(
      [`${plural(o.buyers.length, 'BUYER')} OWE ${crcText(o.total)} IN TOTAL:`, ...o.buyers.slice(0, 10).map((b) => `  ${b.buyer.toUpperCase()}  ${crcText(b.crc)}  ${plural(b.n, 'SALE')}, OLDEST ${b.days} DAYS (${b.oldest})`)],
      [C.owed],
    )
  },
}

const salesTotal: Tool = {
  name: 'sales_total',
  desc: 'Sales in colones and kg over a period, for a species or a buyer.',
  params: {
    period: { type: 'string', desc: 'time span (default this_month)', enum: PERIODS },
    species: { type: 'string', desc: 'species name' },
    buyer: { type: 'string', desc: 'buyer name' },
  },
  money: true,
  async run(ctx, a) {
    const sales = await rows<Sale>(ctx, 'sales')
    const per = resolvePeriod(a.period, 'this_month')
    const r = periodRange(per, ctx.today)
    const sp = resolveSpecies(a.species)
    const buyer = clean(str(a.buyer))
    const pick = sales.filter((s) => inRange(s.sold_on, r) && (!sp || s.species_key === sp) && (!buyer || clean(str(s.buyer)).includes(buyer)) && payStatus(s) !== 'written_off')
    const crc = pick.reduce((n, s) => n + Number(s.amount_crc || 0), 0)
    const kg = pick.reduce((n, s) => n + Number(s.kg || 0), 0)
    const due = pick.filter((s) => payStatus(s) === 'owed').reduce((n, s) => n + Number(s.amount_crc || 0), 0)
    const who = [sp ? speciesName(sp) : '', buyer ? `TO ${buyer.toUpperCase()}` : ''].filter(Boolean).join(' ') || 'ALL SALES'
    const span = per === 'all' ? 'ALL TIME' : `${r.label} (${r.from} TO ${r.to})`
    return answer([`${who} ${span}: ${crcText(crc)} FOR ${kgText(kg)} IN ${plural(pick.length, 'SALE')}${due ? `, ${crcText(due)} OF IT STILL OWED` : ''}.`], [C.sales])
  },
}

// ---------- READ: find and open ----------

const findRecords: Tool = {
  name: 'find_records',
  desc: 'Search every record and screen by words or a code. Use when nothing else fits.',
  params: { query: { type: 'string', desc: 'words or a code' } },
  required: ['query'],
  async run(ctx, a) {
    const q = str(a.query).trim()
    if (!q || !ctx.docs) return askFor(['TYPE WHAT TO LOOK FOR.'])
    const r = runSearch(ctx.docs, q, { limit: 6 })
    if (!r.total) return answer([`NOTHING ON FILE MATCHES ${q.toUpperCase()}.`], [{ label: 'SEARCH', go: { screen: 'SEARCH' } }])
    return answer(
      [`${plural(r.total, 'RECORD')} MATCH ${q.toUpperCase()}:`, ...r.hits.map((h) => `  ${KIND_LABEL[h.kind]}: ${h.title}${h.sub ? ` // ${h.sub}` : ''}`)],
      r.hits.slice(0, 3).map((h) => ({ label: `${KIND_LABEL[h.kind]} ${h.title}`, go: h.go })),
    )
  },
}

/** Sections the assistant can open: words people use -> screen and tab. */
export const SECTIONS: { id: string; label: string; words: string[]; go: { screen: string; tab?: string } }[] = [
  { id: 'power_cuts', label: 'FACILITY LOGS > POWER CUTS', words: ['power cut', 'power cuts', 'power cut log', 'outage', 'outages', 'blackout', 'cortes'], go: { screen: 'FACILITY', tab: 'POWER CUTS' } },
  { id: 'water', label: 'FACILITY LOGS > WATER', words: ['water', 'water log', 'water tests', 'water quality'], go: { screen: 'FACILITY', tab: 'WATER' } },
  { id: 'maintenance', label: 'FACILITY LOGS > MAINTENANCE', words: ['maintenance', 'upkeep', 'equipment register', 'filters'], go: { screen: 'FACILITY', tab: 'MAINTENANCE' } },
  { id: 'cleaning', label: 'FACILITY LOGS > CLEANING', words: ['cleaning', 'cleaning log', 'sanitation'], go: { screen: 'FACILITY', tab: 'CLEANING' } },
  { id: 'checklists', label: 'FACILITY LOGS > CHECKLISTS', words: ['checklist', 'checklists', 'sign off'], go: { screen: 'FACILITY', tab: 'CHECKLISTS' } },
  { id: 'reminders', label: 'FACILITY LOGS > REMINDERS', words: ['reminders', 'reminder'], go: { screen: 'FACILITY', tab: 'REMINDERS' } },
  { id: 'harvest_log', label: 'MISSION CONTROL > HARVEST LOG', words: ['harvest log', 'harvest form', 'harvests', 'picks', 'pick log'], go: { screen: 'MISSION', tab: 'HARVEST' } },
  { id: 'board', label: 'MISSION CONTROL > BOARD', words: ['board', 'lots', 'lot board', 'mission control'], go: { screen: 'MISSION', tab: 'BOARD' } },
  { id: 'today', label: 'MISSION CONTROL > TODAY', words: ['today', 'todo', 'to do list', 'jobs'], go: { screen: 'MISSION', tab: 'TODAY' } },
  { id: 'new_lot', label: 'MISSION CONTROL > NEW LOT', words: ['new lot', 'knock', 'knock day'], go: { screen: 'MISSION', tab: 'NEWLOT' } },
  { id: 'flush_log', label: 'PRODUCTION RECORDS > FLUSH LOG', words: ['flush log', 'flushes', 'be', 'biological efficiency'], go: { screen: 'YIELD', tab: 'FLUSHES' } },
  { id: 'scorecard', label: 'PRODUCTION RECORDS > SCORECARD', words: ['scorecard', 'strain scorecard'], go: { screen: 'YIELD', tab: 'SCORECARD' } },
  { id: 'climate', label: 'ATMOSPHERICS', words: ['climate', 'sensors', 'temperatures', 'humidity', 'atmospherics'], go: { screen: 'ATMOS', tab: 'NOW' } },
  { id: 'climate_alarms', label: 'ATMOSPHERICS > ALARMS', words: ['alarms', 'climate alarms'], go: { screen: 'ATMOS', tab: 'ALARMS' } },
  { id: 'graphs', label: 'ATMOSPHERICS > GRAPHS', words: ['graphs', 'graph', 'climate graph'], go: { screen: 'ATMOS', tab: 'GRAPHS' } },
  { id: 'stock', label: 'CARGO', words: ['stock', 'cargo', 'inventory', 'supplies'], go: { screen: 'CARGO' } },
  { id: 'strains', label: 'XENOGENETICS > STRAINS', words: ['strains', 'genetics', 'cultures', 'xenogenetics'], go: { screen: 'XENO', tab: 'STRAINS' } },
  { id: 'bank', label: 'XENOGENETICS > BANK', words: ['bank', 'culture bank', 'slants', 'water tubes'], go: { screen: 'XENO', tab: 'BANK' } },
  { id: 'cook_log', label: 'PROPULSION > COOK LOG', words: ['cook log', 'cook', 'cooks', 'steam', 'propulsion'], go: { screen: 'PROPULSION', tab: 'RUN' } },
  { id: 'power', label: 'VITALS', words: ['vitals', 'breakers', 'power board'], go: { screen: 'VITALS' } },
  { id: 'deck', label: 'DECK PLAN', words: ['deck plan', 'floor plan', 'rooms', 'map'], go: { screen: 'DECK' } },
  { id: 'hazards', label: 'HAZARD INDEX', words: ['hazards', 'contaminants', 'contamination', 'pests'], go: { screen: 'HAZARD' } },
  { id: 'history', label: 'HISTORY', words: ['history', 'edit history', 'edits', 'undo list'], go: { screen: 'HISTORY' } },
  { id: 'owed', label: 'MONEY > OWED', words: ['owed', 'money owed', 'unpaid', 'debts'], go: { screen: 'MONEY', tab: 'OWED' } },
  { id: 'pnl', label: 'MONEY > PROFIT AND LOSS', words: ['profit', 'profit and loss', 'p and l', 'pnl'], go: { screen: 'MONEY', tab: 'PNL' } },
  { id: 'cash_flow', label: 'MONEY > CASH FLOW', words: ['cash flow', 'cash'], go: { screen: 'MONEY', tab: 'CASH' } },
  { id: 'sales', label: 'TRADE > SALES', words: ['sales', 'sale', 'trade'], go: { screen: 'TRADE', tab: 'SALE' } },
  { id: 'orders', label: 'STANDING ORDERS', words: ['orders', 'standing orders', 'buyers'], go: { screen: 'ORDERS', tab: 'ORDERS' } },
  { id: 'pick_list', label: 'STANDING ORDERS > PICK LIST', words: ['pick list', 'pack list', 'packing list'], go: { screen: 'ORDERS', tab: 'PICK' } },
  { id: 'costs', label: 'LEDGER', words: ['costs', 'ledger', 'cost of goods', 'bills'], go: { screen: 'LEDGER' } },
  { id: 'backup', label: 'DATA > BACKUP', words: ['backup', 'export', 'data'], go: { screen: 'DATA', tab: 'BACKUP' } },
  { id: 'search', label: 'SEARCH', words: ['search', 'find'], go: { screen: 'SEARCH' } },
  { id: 'staff', label: 'STAFF', words: ['staff', 'roles'], go: { screen: 'STAFF' } },
]
const MONEY_SCREENS = new Set(['MONEY', 'TRADE', 'ORDERS', 'LEDGER'])

/** A section from words: exact phrase first, then the longest phrase found inside the words. */
export function findSection(text: string): (typeof SECTIONS)[number] | null {
  const t = clean(text).replace(/([a-z])-([a-z])/g, '$1 $2').replace(/\b(the|my|our|log|screen|page|tab|section|please)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const byId = SECTIONS.find((s) => s.id === t.replace(/ /g, '_'))
  if (byId) return byId
  for (const s of SECTIONS) if (s.words.includes(t)) return s
  const raw = ` ${clean(text).replace(/([a-z])-([a-z])/g, '$1 $2')} `
  let best: { s: (typeof SECTIONS)[number]; n: number } | null = null
  for (const s of SECTIONS) for (const w of s.words) if (raw.includes(` ${w} `) && (!best || w.length > best.n)) best = { s, n: w.length }
  return best?.s ?? null
}

const openScreen: Tool = {
  name: 'open_screen',
  desc: 'Open a screen of the app, e.g. the power cut log, harvest log, climate, stock, money owed.',
  params: { section: { type: 'string', desc: 'what to open', enum: SECTIONS.map((s) => s.id) } },
  required: ['section'],
  async run(ctx, a) {
    const s = findSection(str(a.section))
    if (!s) return askFor([`NO SCREEN CALLED ${str(a.section).toUpperCase()}. TRY POWER CUTS, HARVEST LOG, CLIMATE OR STOCK.`])
    if (!canOpenModule(ctx.role, s.go.screen) || (MONEY_SCREENS.has(s.go.screen) && !canSeeMoney(ctx.role))) return { kind: 'denied', lines: [`${s.label} IS OWNER ONLY.`] }
    return { kind: 'open', lines: [`OPENING ${s.label}.`], cite: [{ label: s.label, go: s.go }], go: s.go }
  },
}

// ---------- WRITE ----------

const logHarvest: Tool = {
  name: 'log_harvest',
  desc: 'Save a harvest (pick): kg picked from one lot. The person confirms before it is saved.',
  params: {
    lot: { type: 'string', desc: 'lot code, e.g. B1020' },
    species: { type: 'string', desc: 'species, only when no lot code was given' },
    kg: { type: 'number', desc: 'kilograms picked' },
    flush: { type: 'number', desc: 'flush number 1-9 (leave out: the next flush)' },
    grade: { type: 'string', desc: 'A or SECONDS (default A)' },
    initials: { type: 'string', desc: "picker's initials" },
    day: { type: 'string', desc: 'today, yesterday or yyyy-mm-dd (default today)' },
  },
  required: ['kg'],
  write: true,
  async run(ctx, a) {
    const [lots, harvests] = await Promise.all([rows<BlockLot>(ctx, 'block_lots'), rows<Harvest>(ctx, 'harvests')])
    let kg = numArg(a.kg)
    const lbs = numArg(a.lb)
    if (kg === null && lbs !== null) kg = Math.round(lbs * LB_TO_KG * 100) / 100
    let lot = str(a.lot) ? findLot(lots, a.lot) : null
    if (str(a.lot) && !lot) return askFor([`NO LOT ${str(a.lot).toUpperCase()} ON FILE. CHECK THE CODE ON THE CART TAG.`], [C.board])
    if (!lot) {
      const sp = resolveSpecies(a.species)
      const cands = lots.filter((l) => isActive(l) && (!sp || l.species_key === sp)).sort((x, y) => Number(y.status === 'fruiting') - Number(x.status === 'fruiting') || x.knock_date.localeCompare(y.knock_date))
      const fruiting = cands.filter((l) => l.status === 'fruiting')
      if (sp && fruiting.length === 1) lot = fruiting[0]
      else if (sp && !fruiting.length && cands.length === 1) lot = cands[0]
      else if (!cands.length) return askFor([sp ? `NO ACTIVE ${speciesName(sp)} LOT. CREATE ONE ON MISSION CONTROL > NEW LOT.` : 'NO ACTIVE LOT. CREATE ONE FIRST.'], [C.board])
      else return askFor([`WHICH LOT? ${(fruiting.length ? fruiting : cands).slice(0, 6).map((l) => l.lot_code).join(', ')}. E.G. LOG ${kg !== null ? kg : 4.2} KG FROM ${(fruiting[0] ?? cands[0]).lot_code}.`], [C.board])
    }
    if (kg === null || kg <= 0) return askFor([`HOW MANY KG FROM ${lot.lot_code}? E.G. LOG 4.2 KG FROM ${lot.lot_code}.`])
    if (kg > 500) return askFor([`${kg} KG FROM ONE LOT IS NOT LIKELY. CHECK THE NUMBER.`])
    const flushArg = numArg(a.flush)
    const flush = flushArg !== null ? Math.floor(flushArg) : nextFlush(harvests, lot.id)
    if (flush < 1 || flush > 9) return askFor(['FLUSH MUST BE 1 TO 9.'])
    const gradeRaw = str(a.grade).trim().toUpperCase()
    const grade = (GRADES as readonly string[]).find((g) => g === gradeRaw || (gradeRaw.startsWith('SEC') && g === 'SECONDS')) ?? (gradeRaw ? null : 'A')
    if (!grade) return askFor([`GRADE ${gradeRaw} IS NOT ONE OF ${GRADES.join(', ')}.`])
    const initials = (str(a.initials) || ctx.initials).trim().toUpperCase().slice(0, 24)
    if (!initials) return askFor([`WHO PICKED IT? ADD YOUR INITIALS, E.G. LOG ${kg} KG FROM ${lot.lot_code} BY JM.`])
    const day = resolveDay(a.day, ctx.today)
    if (!day) return askFor(['THE DAY MUST BE TODAY, YESTERDAY OR YYYY-MM-DD.'])
    if (day > ctx.today) return askFor(['THAT DAY IS IN THE FUTURE.'])
    if (day < lot.knock_date) return askFor([`${day} IS BEFORE ${lot.lot_code} WAS KNOCKED (${lot.knock_date}).`])
    if (lot.status === 'spent' || lot.status === 'lost') return askFor([`${lot.lot_code} IS MARKED ${lot.status.toUpperCase()}. CHANGE IT ON MISSION CONTROL FIRST IF IT IS STILL PICKING.`], [lotCite(lot)])
    const L = lot
    const k = Math.round(kg * 1000) / 1000
    const lines = [
      `HARVEST // LOT ${L.lot_code} (${speciesName(L.species_key)})`,
      `${kgText(k)} // FLUSH ${flush} // GRADE ${grade} // BY ${initials} // ${day === ctx.today ? `TODAY ${day}` : day}`,
    ]
    if (lbs !== null && numArg(a.kg) === null) lines.push(`(${lbs} LB TURNED INTO KG)`)
    if (L.status === 'incubating') lines.push(`${L.lot_code} IS STILL MARKED INCUBATING: IT WILL BE MARKED FRUITING TOO.`)
    if (harvests.some((h) => h.block_lot_id === L.id && h.harvested_on === day && Math.abs(Number(h.kg) - k) < 0.001)) lines.push(`! THE SAME KG WAS ALREADY LOGGED FOR ${L.lot_code} ON ${day}. CONFIRM ONLY IF THIS IS A SECOND PICK.`)
    return plan({
      tool: 'log_harvest',
      label: `ASSISTANT: HARVEST ${L.lot_code} ${kgText(k)}`,
      lines,
      cite: [C.harvest, lotCite(L)],
      async apply(store) {
        await store.ensure('block_lots')
        const cur = store.rows<BlockLot>('block_lots').find((x) => x.id === L.id)
        if (!cur) throw new Error(`LOT ${L.lot_code} IS GONE.`)
        if (cur.status === 'incubating') await store.put('block_lots', { ...cur, status: 'fruiting', to_fruiting_on: cur.to_fruiting_on ?? day, room: 'fruiting' })
        await store.put('harvests', { id: uuid(), block_lot_id: L.id, harvested_on: day, flush, kg: k, grade, initials, notes: null, created_at: new Date().toISOString() })
        return `HARVEST SAVED // ${L.lot_code} FLUSH ${flush} // ${kgText(k)} // GRADE ${grade}`
      },
    })
  },
}

const POWER_EVENTS = ['out', 'back', 'generator_on', 'generator_off'] as const
const logPower: Tool = {
  name: 'log_power',
  desc: 'Log a power event now: the grid went out, the power is back, the generator started or stopped.',
  params: { event: { type: 'string', desc: 'out, back, generator_on or generator_off', enum: POWER_EVENTS } },
  required: ['event'],
  write: true,
  async run(ctx, a) {
    const cuts = await rows<PowerCut>(ctx, 'power_cuts')
    const ev = clean(str(a.event)).replace(/ /g, '_')
    const open = cuts.find(isOpenCut)
    const at = stamp(ctx.now)
    const who = ctx.initials || null
    if (ev === 'out') {
      if (open) return askFor([`A CUT IS ALREADY OPEN SINCE ${stamp(Date.parse(open.down_at))}. SAY POWER IS BACK WHEN THE GRID RETURNS.`], [C.cuts])
      return plan({ tool: 'log_power', label: 'ASSISTANT: POWER WENT OUT', lines: [`POWER CUT STARTS NOW // ${at} (FARM CLOCK)`, 'THE CLOCK RUNS UNTIL YOU SAY POWER IS BACK.'], cite: [C.cuts], apply: async (s) => (await powerOut(s, ctx.now, who), `POWER CUT LOGGED FROM ${at}`) })
    }
    if (ev === 'back') {
      if (!open) return askFor(['NO POWER CUT IS OPEN. IF IT ALREADY ENDED, ADD IT ON FACILITY LOGS > POWER CUTS WITH ITS TIMES.'], [C.cuts])
      const min = Math.max(1, Math.round((ctx.now - Date.parse(open.down_at)) / 60000))
      return plan({ tool: 'log_power', label: 'ASSISTANT: POWER IS BACK', lines: [`POWER BACK NOW // ${at}`, `THE CUT FROM ${stamp(Date.parse(open.down_at))} CLOSES AT ${fmtMin(min)}.`], cite: [C.cuts], apply: async (s) => (await powerBack(s, ctx.now), `POWER CUT CLOSED // ${fmtMin(min)} WITHOUT GRID POWER`) })
    }
    if (ev === 'generator_on') return plan({ tool: 'log_power', label: 'ASSISTANT: GENERATOR ON', lines: [`GENERATOR ON NOW // ${at}`, open ? 'ADDED TO THE OPEN POWER CUT.' : 'NO CUT IS OPEN: LOGGED AS A TEST RUN.'], cite: [C.cuts], apply: async (s) => (await genStart(s, ctx.now, who), `GENERATOR ON FROM ${at}`) })
    if (ev === 'generator_off') return plan({ tool: 'log_power', label: 'ASSISTANT: GENERATOR OFF', lines: [`GENERATOR OFF NOW // ${at}`], cite: [C.cuts], apply: async (s) => (await genStop(s, ctx.now), `GENERATOR OFF AT ${at}`) })
    return askFor(['SAY POWER IS OUT, POWER IS BACK, GENERATOR ON OR GENERATOR OFF.'], [C.cuts])
  },
}

const logReading: Tool = {
  name: 'log_reading',
  desc: 'Save a hand climate reading now for a room: temperature C, humidity %, CO2 ppm.',
  params: {
    room: { type: 'string', desc: 'lab, culture fridge, packing, cold room, incubation, fruiting, boiling, outside' },
    temp_c: { type: 'number', desc: 'temperature in C' },
    rh: { type: 'number', desc: 'relative humidity %' },
    co2_ppm: { type: 'number', desc: 'CO2 in ppm' },
  },
  required: ['room'],
  write: true,
  async run(ctx, a) {
    const place = resolvePlace(a.room)
    if (!place) return askFor([str(a.room) ? `NO SENSOR PLACE CALLED ${str(a.room).toUpperCase()}.` : 'WHICH ROOM? E.G. FRUITING 18.5 C 92%.'], [C.climate])
    let temp = numArg(a.temp_c)
    const tf = numArg(a.temp_f)
    if (temp === null && tf !== null) temp = Math.round(((tf - 32) * 5) / 9 * 100) / 100
    const rh = numArg(a.rh)
    const co2 = numArg(a.co2_ppm)
    const input = { place: place as PlaceId, sensor_id: null, at: ctx.now, temp, rh, co2, note: 'FROM THE ASSISTANT', who: ctx.initials }
    const bad = checkReading(input, ctx.now)
    if (bad) return askFor([bad], [C.climate])
    const vals = [temp !== null ? `TEMP ${temp} C` : '', rh !== null ? `RH ${rh}%` : '', co2 !== null ? `CO2 ${co2} PPM` : ''].filter(Boolean).join(', ')
    return plan({
      tool: 'log_reading',
      label: `ASSISTANT: READING ${PLACE_LABEL[place]}`,
      lines: [`HAND READING // ${PLACE_LABEL[place]} // ${stamp(ctx.now)}`, vals + (tf !== null && numArg(a.temp_c) === null ? ` (${tf} F TURNED INTO C)` : '')],
      cite: [C.climate],
      apply: async (s) => (await addReading(s, input, ctx.now), `READING SAVED // ${PLACE_LABEL[place]} ${vals}`),
    })
  },
}

const setLotStatus: Tool = {
  name: 'set_lot_status',
  desc: 'Change a lot status: incubating, fruiting, spent (finished) or lost (all dead or binned).',
  params: { lot: { type: 'string', desc: 'lot code' }, status: { type: 'string', desc: 'incubating, fruiting, spent or lost', enum: ['incubating', 'fruiting', 'spent', 'lost'] } },
  required: ['lot', 'status'],
  write: true,
  async run(ctx, a) {
    const lots = await rows<BlockLot>(ctx, 'block_lots')
    const lot = findLot(lots, a.lot)
    if (!lot) return askFor([str(a.lot) ? `NO LOT ${str(a.lot).toUpperCase()} ON FILE.` : 'WHICH LOT?'], [C.board])
    const st = statusOf(a.status)
    if (!st || st === 'all' || st === 'active') return askFor(['PICK INCUBATING, FRUITING, SPENT OR LOST.'])
    if (lot.status === st) return askFor([`${lot.lot_code} IS ALREADY ${st.toUpperCase()}.`], [lotCite(lot)])
    const losses = await rows<LotLoss>(ctx, 'lot_losses')
    const L = lot
    const lines = [`LOT ${L.lot_code} // ${L.status.toUpperCase()} -> ${st.toUpperCase()}`]
    if (st === 'lost') lines.push('THE BLOCKS STILL ALIVE ARE LOGGED AS LOST.')
    return plan({ tool: 'set_lot_status', label: `ASSISTANT: ${L.lot_code} ${st.toUpperCase()}`, lines, cite: [lotCite(L)], apply: async (s) => (await bulkLots(s, [L], { status: st as LotStatus }, losses), `${L.lot_code} MARKED ${st.toUpperCase()}`) })
  },
}

const stockMove: Tool = {
  name: 'stock_move',
  desc: 'Stock in or out: a delivery received (in) or stock used (out), for one item.',
  params: {
    item: { type: 'string', desc: 'item name' },
    qty: { type: 'number', desc: 'how many, in the item unit' },
    direction: { type: 'string', desc: 'in (received) or out (used)', enum: ['in', 'out'] },
  },
  required: ['item', 'qty', 'direction'],
  write: true,
  async run(ctx, a) {
    const [items, moves] = await Promise.all([rows<Item>(ctx, 'items'), rows<Move>(ctx, 'stock_moves')])
    const it = findItem(items, a.item)
    if (!it) return askFor([`NO STOCK ITEM MATCHES ${str(a.item).toUpperCase() || 'THAT'}. USE THE NAME ON CARGO.`], [C.cargo])
    const q = numArg(a.qty)
    if (q === null || q <= 0) return askFor([`HOW MANY ${it.unit.toUpperCase()} OF ${it.name.toUpperCase()}?`])
    const dir = /^(in|received|delivery|got|bought)/.test(clean(str(a.direction))) ? 'in' : /^(out|used|use|took)/.test(clean(str(a.direction))) ? 'out' : null
    if (!dir) return askFor(['RECEIVED OR USED?'])
    const have = onHandMap(moves).get(it.id) ?? 0
    const after = Math.round((have + (dir === 'in' ? q : -q)) * 1000) / 1000
    const lines = [`STOCK ${dir === 'in' ? 'RECEIVED' : 'USED'} // ${it.name.toUpperCase()} // ${fmtQty(q)} ${it.unit.toUpperCase()}`, `ON HAND ${fmtQty(have)} -> ${fmtQty(after)} ${it.unit.toUpperCase()}`]
    if (after < 0) lines.push('! THAT TAKES THE COUNT BELOW ZERO. DO A STOCK TAKE ON CARGO IF THE COUNT IS WRONG.')
    if (dir === 'in') lines.push('NO PRICE IS SAVED. ADD THE PRICE ON CARGO IF IT CHANGED.')
    return plan({
      tool: 'stock_move',
      label: `ASSISTANT: STOCK ${dir === 'in' ? 'IN' : 'OUT'} ${it.name.toUpperCase()}`,
      lines,
      cite: [C.cargo],
      apply: async (s) => (await s.put('stock_moves', newMove(it.id, dir === 'in' ? q : -q, dir === 'in' ? 'delivery' : 'use', { notes: 'FROM THE ASSISTANT' })), `STOCK SAVED // ${it.name.toUpperCase()} NOW ${fmtQty(after)} ${it.unit.toUpperCase()}`),
    })
  },
}

const markBuyerPaid: Tool = {
  name: 'mark_paid',
  desc: "Mark every unpaid sale of one buyer as paid (cash came in).",
  params: { buyer: { type: 'string', desc: 'buyer name' }, day: { type: 'string', desc: 'today, yesterday or yyyy-mm-dd' } },
  required: ['buyer'],
  money: true,
  write: true,
  async run(ctx, a) {
    const sales = await rows<Sale>(ctx, 'sales')
    const o = owed(sales, ctx.today)
    const q = clean(str(a.buyer))
    if (!q) return askFor(['WHICH BUYER PAID?'], [C.owed])
    const hits = o.buyers.filter((b) => clean(b.buyer) === q || clean(b.buyer).includes(q))
    if (!hits.length) return askFor([`${q.toUpperCase()} OWES NOTHING.${o.buyers.length ? ` OWING: ${o.buyers.map((b) => b.buyer.toUpperCase()).slice(0, 6).join(', ')}.` : ''}`], [C.owed])
    if (hits.length > 1 && !hits.some((b) => clean(b.buyer) === q)) return askFor([`WHICH ONE? ${hits.map((b) => b.buyer.toUpperCase()).join(', ')}.`], [C.owed])
    const b = hits.find((x) => clean(x.buyer) === q) ?? hits[0]
    const day = resolveDay(a.day, ctx.today)
    if (!day) return askFor(['THE DAY MUST BE TODAY, YESTERDAY OR YYYY-MM-DD.'])
    const early = b.sales.find((s) => s.sale.sold_on > day)
    if (early) return askFor([`PAID DAY ${day} IS BEFORE THE SALE ON ${early.sale.sold_on}.`], [C.owed])
    const ids = b.sales.map((s) => s.sale.id)
    return plan({
      tool: 'mark_paid',
      label: `ASSISTANT: ${b.buyer.toUpperCase()} PAID ${crcText(b.crc)}`,
      lines: [`MARK PAID // ${b.buyer.toUpperCase()} // ${plural(b.n, 'SALE')} // ${crcText(b.crc)}`, `PAID ON ${day}`, ...b.sales.slice(0, 5).map((s) => `  ${s.sale.sold_on}  ${s.sale.receipt_no ?? ''}  ${crcText(Number(s.sale.amount_crc))}`)],
      cite: [C.owed],
      apply: async (s) => (await markPaid(s, ids, day), `${b.buyer.toUpperCase()} MARKED PAID // ${crcText(b.crc)}`),
    })
  },
}

// ---------- the list ----------

export const TOOLS: Tool[] = [
  countLots, lotDetails, harvestTotal, dueToday, strainStatus, speciesFacts, stockStatus, powerCuts, climateNow,
  whoOwes, salesTotal, findRecords, openScreen,
  logHarvest, logPower, logReading, setLotStatus, stockMove, markBuyerPaid,
]
export const toolByName = (n: string) => TOOLS.find((t) => t.name === n) ?? null

/** Tools this person may use (STAFF: no money tools). */
export const toolsFor = (role: AskCtx['role']) => TOOLS.filter((t) => !t.money || canSeeMoney(role))

/** Run one tool with the role check. Unknown tool = null. */
export async function runTool(ctx: AskCtx, name: string, args: Args): Promise<ToolOut | null> {
  const t = toolByName(name)
  if (!t) return null
  if (t.money && !canSeeMoney(ctx.role)) return { kind: 'denied', lines: ['MONEY IS OWNER ONLY.'] }
  return t.run(ctx, args ?? {})
}

/** Days from yyyy-mm-dd for tests and the LLM prompt. */
export const dayPlus = addDays
