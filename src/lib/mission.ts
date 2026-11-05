// MISSION CONTROL logic: the production board, the harvest log's expected figures and the TODAY list.
// Pure functions. Screens hand in rows from the store.
//
// Where each number comes from (shown on screen as SRC):
//  - Days from knock to first harvest and lb per block: Catawba's real picks (species JSON, `cat`).
//  - Move to fruiting: the species' "Block incubation" days in the textbook; first day of the range
//    opens the window, last day is late. No range stated = 14 days, tagged GUESS.
//  - Flushes: oysters 1, lion's mane 2 (Joseph's farm facts). Others: 1, tagged GUESS.

import { SPECIES } from '../data/species'
import { addDays, daysBetween, mmdd, todayIso, LOT_LETTER, cultureAge, grainAge, isActiveCulture, type BlockLot, type Culture, type GrainRun, type Strain } from './xeno'
import type { Harvest } from './ledger'
import type { LotLoss } from './hazard'
import { LB_TO_KG } from './runplan'

export const MOVE_FALLBACK_DAYS = 14

export interface Expect {
  firstDays: number | null // knock to first harvest
  kgPerBlock: number | null // all flushes, per surviving block
  moveOpen: number // days after knock the window opens
  moveLate: number
  moveGuess: boolean
  flushes: number
  flushGuess: boolean
  src: string
}

export function expectFor(speciesKey: string): Expect {
  const sp = SPECIES.find((s) => s.id === speciesKey)
  const inc = sp?.timeline.find((f) => f.k === 'Block incubation' && f.d)
  const open = inc?.d ? inc.d[0] : MOVE_FALLBACK_DAYS
  const late = inc?.d ? inc.d[1] : MOVE_FALLBACK_DAYS
  const flushes = speciesKey === 'lions-mane' ? 2 : 1
  return {
    firstDays: sp?.cat ? Math.round(sp.cat.d) : null,
    kgPerBlock: sp?.cat ? sp.cat.lb * LB_TO_KG : null,
    moveOpen: open,
    moveLate: late,
    moveGuess: !inc?.d,
    flushes,
    flushGuess: !(speciesKey === 'lions-mane' || /oyster|black-pearl/.test(speciesKey)),
    src: sp?.cat ? 'CATAWBA REAL PICKS' : 'NO DATA',
  }
}

export const lotLetter = (speciesKey: string) => LOT_LETTER[speciesKey] ?? 'X'
export const suggestCode = (speciesKey: string, knock: string, taken: BlockLot[]): string => {
  const base = `${lotLetter(speciesKey)}${mmdd(knock)}`
  const used = new Set(taken.filter((l) => l.knock_date === knock).map((l) => l.lot_code.toUpperCase()))
  if (!used.has(base)) return base
  for (let i = 2; i < 10; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
  return base
}

export type MoveFlag = 'WAIT' | 'DUE' | 'LATE' | 'DONE'
export type HarvestFlag = 'WAIT' | 'DUE' | 'LATE' | 'PICKING' | 'NO DATA'

export interface BoardRow {
  lot: BlockLot
  days: number // since knock
  lost: number
  blocks: number // surviving
  move: MoveFlag
  moveOn: string // first day of the window
  harvestOn: string | null // expected first harvest
  harvestFlag: HarvestFlag
  expKg: number | null
  gotKg: number
  flushesDone: number
  ex: Expect
}

export const lotLost = (losses: LotLoss[], lotId: string) => losses.filter((l) => l.block_lot_id === lotId).reduce((n, l) => n + l.bag_count, 0)

export const isActiveLot = (l: BlockLot) => l.status === 'incubating' || l.status === 'fruiting'

export function boardRow(lot: BlockLot, losses: LotLoss[], harvests: Harvest[], now = todayIso()): BoardRow {
  const ex = expectFor(lot.species_key)
  const days = daysBetween(lot.knock_date, now)
  const lost = lotLost(losses, lot.id)
  const blocks = Math.max(0, lot.bag_count - lost)
  const mine = harvests.filter((h) => h.block_lot_id === lot.id)
  const gotKg = mine.reduce((n, h) => n + Number(h.kg), 0)
  const flushesDone = new Set(mine.map((h) => h.flush)).size
  const move: MoveFlag = lot.status !== 'incubating' ? 'DONE' : days > ex.moveLate ? 'LATE' : days >= ex.moveOpen ? 'DUE' : 'WAIT'
  const harvestOn = ex.firstDays === null ? null : addDays(lot.knock_date, ex.firstDays)
  let harvestFlag: HarvestFlag = 'WAIT'
  if (harvestOn === null) harvestFlag = 'NO DATA'
  else if (mine.length) harvestFlag = 'PICKING'
  else if (lot.status === 'fruiting' || days >= ex.firstDays! - 3) harvestFlag = now > harvestOn && lot.status === 'fruiting' ? 'LATE' : now >= harvestOn ? 'DUE' : 'WAIT'
  return {
    lot,
    days,
    lost,
    blocks,
    move,
    moveOn: addDays(lot.knock_date, ex.moveOpen),
    harvestOn,
    harvestFlag,
    expKg: ex.kgPerBlock === null ? null : ex.kgPerBlock * blocks,
    gotKg,
    flushesDone,
    ex,
  }
}

export function board(lots: BlockLot[], losses: LotLoss[], harvests: Harvest[], now = todayIso()): BoardRow[] {
  return lots
    .filter(isActiveLot)
    .map((l) => boardRow(l, losses, harvests, now))
    .sort((a, b) => a.lot.knock_date.localeCompare(b.lot.knock_date) || a.lot.lot_code.localeCompare(b.lot.lot_code))
}

/** Next flush number to offer: one more than the highest logged, capped at the species' flushes + 1 slack of none. */
export function nextFlush(harvests: Harvest[], lotId: string): number {
  const f = harvests.filter((h) => h.block_lot_id === lotId).map((h) => h.flush)
  return Math.min(9, (f.length ? Math.max(...f) : 0) + 1)
}

export interface TodayItem {
  kind: 'MOVE' | 'HARVEST' | 'CULTURE' | 'REORDER'
  text: string
  warn: boolean
  ref?: string // lot id, strain id, or item id
}

export interface TodayInput {
  rows: BoardRow[]
  cultures: Culture[]
  grain: GrainRun[]
  strains: Strain[]
  reorders: { id: string; name: string; state: string; weeks: number | null }[]
  now?: string
}

export function todayList(i: TodayInput): TodayItem[] {
  const now = i.now ?? todayIso()
  const out: TodayItem[] = []
  const name = (strainId: string) => i.strains.find((s) => s.id === strainId)?.code ?? '?'
  for (const r of i.rows) {
    if (r.move === 'DUE' || r.move === 'LATE')
      out.push({ kind: 'MOVE', warn: r.move === 'LATE', ref: r.lot.id, text: `MOVE ${r.lot.lot_code} TO FRUITING // DAY ${r.days}, ${r.move === 'LATE' ? 'LATE' : `WINDOW OPENED DAY ${r.ex.moveOpen}`}${r.ex.moveGuess ? ' (GUESS)' : ''}` })
  }
  for (const r of i.rows) {
    if (r.harvestFlag === 'DUE' || r.harvestFlag === 'LATE')
      out.push({ kind: 'HARVEST', warn: r.harvestFlag === 'LATE', ref: r.lot.id, text: `HARVEST ${r.lot.lot_code} // EXPECTED ${r.harvestOn}${r.harvestFlag === 'LATE' ? `, ${daysBetween(r.harvestOn!, now)} D PAST` : ' TODAY'}` })
  }
  for (const c of i.cultures) {
    if (!isActiveCulture(c)) continue
    const a = cultureAge(c, now)
    if (a.state === 'warn' || a.state === 'over') out.push({ kind: 'CULTURE', warn: a.state === 'over', ref: c.strain_id, text: `${name(c.strain_id)} ${c.label ?? c.kind.toUpperCase()}: ${a.text}` })
  }
  for (const g of i.grain) {
    if (g.status === 'used_up' || g.status === 'discarded' || g.status === 'contaminated') continue
    const sp = i.strains.find((s) => s.id === g.strain_id)?.species_key
    const a = grainAge(g, sp ?? '', now)
    if (a.state === 'warn' || a.state === 'over') out.push({ kind: 'CULTURE', warn: a.state === 'over', ref: g.strain_id, text: `${name(g.strain_id)} ${g.generation}: ${a.text}` })
  }
  for (const r of i.reorders)
    out.push({ kind: 'REORDER', warn: r.state === 'OUT', ref: r.id, text: `REORDER ${r.name.toUpperCase()} // ${r.state}${r.weeks !== null ? `, ${r.weeks.toFixed(1)} WK LEFT` : ''}` })
  return out
}
