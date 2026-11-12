// The numbers behind the deck overviews and COLD STORE. Pure functions over plain rows, so the tests can
// check each figure against a farm worked out by hand (overview.test.ts).

import { addDays, daysBetween, type BlockLot, type Strain } from './xeno'
import { PART_KEYS, weekOf, type Harvest, type PartKey, type WeekCost } from './ledger'
import type { Sale } from './trade'
import type { WasteEntry } from './money'
import type { Reminder } from './facility'
import type { LotLoss } from './hazard'
import { orderLines, type OrderWeek, type StandingOrder } from './orders'
import { expectFor } from './mission'

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v)) || 0

/** The Mondays of the last `count` weeks, oldest first, ending with the week `today` is in. */
export function lastWeeks(today: string, count: number): string[] {
  const end = weekOf(today)
  return Array.from({ length: count }, (_, i) => addDays(end, -7 * (count - 1 - i)))
}

/** Kg picked in each of the last `count` weeks (Monday to Sunday), oldest first. */
export function weeklyKg(harvests: Harvest[], today: string, count = 12): { week: string; kg: number }[] {
  const weeks = lastWeeks(today, count)
  const at = new Map(weeks.map((w, i) => [w, i]))
  const kg = weeks.map(() => 0)
  for (const h of harvests) {
    const i = at.get(weekOf(h.harvested_on))
    if (i !== undefined) kg[i] += n(h.kg)
  }
  return weeks.map((week, i) => ({ week, kg: kg[i] }))
}

/** Colones of sales in each of the last `count` weeks, oldest first. Written-off sales do not count. */
export function weeklySales(sales: Sale[], today: string, count = 8): { week: string; crc: number }[] {
  const weeks = lastWeeks(today, count)
  const at = new Map(weeks.map((w, i) => [w, i]))
  const crc = weeks.map(() => 0)
  for (const s of sales) {
    if (s.pay_status === 'written_off') continue
    const i = at.get(weekOf(s.sold_on))
    if (i !== undefined) crc[i] += n(s.amount_crc)
  }
  return weeks.map((week, i) => ({ week, crc: crc[i] }))
}

export const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** Sales per day, this week (Monday to `today`) against the same days last week. */
export function salesByDay(sales: Sale[], today: string): { day: string; name: string; now: number; last: number; future: boolean }[] {
  const mon = weekOf(today)
  return DAY_NAMES.map((name, i) => {
    const day = addDays(mon, i)
    const prev = addDays(day, -7)
    let now = 0
    let last = 0
    for (const s of sales) {
      if (s.pay_status === 'written_off') continue
      if (s.sold_on === day) now += n(s.amount_crc)
      else if (s.sold_on === prev) last += n(s.amount_crc)
    }
    return { day, name, now, last, future: day > today }
  })
}

/** Biggest buyers by colones over the last `days` days. Sales with no buyer count as WALK-IN. */
export function topBuyers(sales: Sale[], today: string, days = 30, count = 5): { buyer: string; crc: number; kg: number }[] {
  const from = addDays(today, -(days - 1))
  const by = new Map<string, { crc: number; kg: number }>()
  for (const s of sales) {
    if (s.sold_on < from || s.sold_on > today || s.pay_status === 'written_off') continue
    const k = (s.buyer ?? '').trim().toUpperCase() || 'WALK-IN'
    const r = by.get(k) ?? { crc: 0, kg: 0 }
    r.crc += n(s.amount_crc)
    r.kg += n(s.kg)
    by.set(k, r)
  }
  return [...by].map(([buyer, v]) => ({ buyer, ...v })).sort((a, b) => b.crc - a.crc || a.buyer.localeCompare(b.buyer)).slice(0, count)
}

// ---------- COLD STORE ----------

export interface ColdBatch {
  day: string
  kg: number
  age: number
}
export interface ColdSpecies {
  species: string
  /** Fresh kg still counted as on hand: picked in the shelf life, not yet sold or written off. */
  onHand: number
  /** The picks those kilos come from, oldest first. */
  batches: ColdBatch[]
  /** Days since the oldest pick still on hand. */
  oldest: number | null
  /** Picked, sold fresh and written off in the last 7 days (for the table). */
  picked7: number
  sold7: number
  wasted7: number
  /** Kilos that went past the shelf life in the last STALE_DAYS days and were never logged as sold or written off. */
  stale: number
}
export interface ColdStore {
  species: ColdSpecies[]
  onHand: number
  stale: number
  oldest: number | null
  shelfDays: number
}

/** How far back STALE looks: picks that went past their shelf life longer ago than this are left out. */
export const STALE_DAYS = 30

/**
 * Fresh mushrooms on hand, first in first out. A fresh sale takes kilos off the oldest picks of its species
 * that were still inside the shelf life on the day of the sale (a sale can never be of mushrooms that had
 * already gone off, so a gap in old records cannot eat this week's picks). A surplus or waste entry takes the
 * oldest picks too, and may also clear picks past the shelf life (composting what went off).
 * Picks older than the shelf life drop out of ON HAND; what went off in the last STALE_DAYS days without being
 * sold or written off shows as STALE so it can be logged.
 */
export function coldStore(harvests: Harvest[], lots: BlockLot[], sales: Sale[], waste: WasteEntry[], today: string, shelfDays = 7): ColdStore {
  const speciesOf = new Map(lots.map((l) => [l.id, l.species_key]))
  const picks = new Map<string, { day: string; kg: number }[]>()
  for (const h of harvests) {
    if (h.harvested_on > today) continue
    const sp = speciesOf.get(h.block_lot_id) ?? 'unknown'
    const list = picks.get(sp) ?? []
    list.push({ day: h.harvested_on, kg: n(h.kg) })
    picks.set(sp, list)
  }
  const outs = new Map<string, { day: string; kg: number; fresh: boolean }[]>()
  const add = (sp: string, day: string, kg: number, fresh: boolean) => {
    if (day > today || kg <= 0) return
    const list = outs.get(sp) ?? []
    list.push({ day, kg, fresh })
    outs.set(sp, list)
  }
  const keep = shelfDays + STALE_DAYS
  for (const s of sales) if (s.form === 'fresh' && s.species_key) add(s.species_key, s.sold_on, n(s.kg), true)
  for (const w of waste) add(w.species_key, w.logged_on, n(w.kg), false)
  const from7 = addDays(today, -6)
  const keys = new Set([...picks.keys(), ...outs.keys()])
  const out: ColdSpecies[] = []
  for (const sp of keys) {
    const ps = (picks.get(sp) ?? []).sort((a, b) => a.day.localeCompare(b.day)).map((p) => ({ ...p }))
    const os = (outs.get(sp) ?? []).sort((a, b) => a.day.localeCompare(b.day))
    // Each out takes from the oldest picks made on or before its own day: a fresh sale only from picks still
    // inside the shelf life that day, a waste entry also from picks that went off (within the STALE window).
    for (const o of os) {
      let left = o.kg
      for (const p of ps) {
        if (left <= 1e-9) break
        if (p.day > o.day || p.kg <= 1e-9) continue
        const age = daysBetween(p.day, o.day)
        if (age >= (o.fresh ? shelfDays : keep)) continue
        const take = Math.min(p.kg, left)
        p.kg -= take
        left -= take
      }
    }
    let onHand = 0
    let stale = 0
    const batches: ColdBatch[] = []
    for (const p of ps) {
      if (p.kg <= 1e-9) continue
      const age = daysBetween(p.day, today)
      if (age >= keep) continue
      if (age >= shelfDays) stale += p.kg
      else {
        onHand += p.kg
        batches.push({ day: p.day, kg: p.kg, age })
      }
    }
    const sum = (list: { day: string; kg: number }[]) => list.filter((x) => x.day >= from7 && x.day <= today).reduce((t, x) => t + x.kg, 0)
    const sold7 = sales.filter((s) => s.form === 'fresh' && s.species_key === sp && s.sold_on >= from7 && s.sold_on <= today).reduce((t, s) => t + n(s.kg), 0)
    const wasted7 = waste.filter((w) => w.species_key === sp && w.logged_on >= from7 && w.logged_on <= today).reduce((t, w) => t + n(w.kg), 0)
    const picked7 = sum(picks.get(sp) ?? [])
    if (onHand <= 1e-9 && stale <= 1e-9 && picked7 <= 1e-9 && sold7 <= 1e-9 && wasted7 <= 1e-9) continue
    out.push({ species: sp, onHand, batches, oldest: batches.length ? batches[0].age : null, picked7, sold7, wasted7, stale })
  }
  out.sort((a, b) => b.onHand - a.onHand || a.species.localeCompare(b.species))
  const ages = out.map((s) => s.oldest).filter((x): x is number => x !== null)
  return { species: out, onHand: out.reduce((t, s) => t + s.onHand, 0), stale: out.reduce((t, s) => t + s.stale, 0), oldest: ages.length ? Math.max(...ages) : null, shelfDays }
}

// ---------- the BRIDGE work list ----------

export interface DueGroups {
  overdue: Reminder[]
  today: Reminder[]
  week: Reminder[]
  later: Reminder[]
}

/** Reminders split by how urgent they are. No date means now; a warning with no date counts as overdue. */
export function dueGroups(list: Reminder[], today: string): DueGroups {
  const g: DueGroups = { overdue: [], today: [], week: [], later: [] }
  const wk = addDays(today, 7)
  for (const r of list) {
    if (r.due === null) (r.warn ? g.overdue : g.today).push(r)
    else if (r.due < today) g.overdue.push(r)
    else if (r.due === today) g.today.push(r)
    else if (r.due <= wk) g.week.push(r)
    else g.later.push(r)
  }
  return g
}

// ---------- GROW DECK pipeline ----------

export interface Pipeline {
  incubating: number
  fruiting: number
  /** Blocks lost and blocks finished (spent) from lots knocked in the last `days` days. */
  lost: number
  spent: number
  lostPct: number | null
}

/** Surviving blocks in each stage now, and recent losses. `lostByLot` = blocks lost per lot id. */
export function pipeline(lots: BlockLot[], lostByLot: Map<string, number>, today: string, days = 90): Pipeline {
  let incubating = 0
  let fruiting = 0
  let lost = 0
  let spent = 0
  let started = 0
  const from = addDays(today, -days)
  for (const l of lots) {
    const gone = lostByLot.get(l.id) ?? 0
    const alive = Math.max(0, n(l.bag_count) - gone)
    if (l.status === 'incubating') incubating += alive
    else if (l.status === 'fruiting') fruiting += alive
    if (l.knock_date >= from && l.knock_date <= today) {
      started += n(l.bag_count)
      lost += Math.min(n(l.bag_count), gone + (l.status === 'lost' ? alive : 0))
      if (l.status === 'spent') spent += alive
    }
  }
  return { incubating, fruiting, lost, spent, lostPct: started ? (lost / started) * 100 : null }
}

export interface Cohort {
  incubating: number
  fruiting: number
  spent: number
  lost: number
  /** Every block knocked in the window: the four parts above add up to this. */
  started: number
}

/** Blocks knocked in the last `days` days, by where they are now. A lot marked LOST counts all its blocks as lost. */
export function cohort(lots: BlockLot[], lostByLot: Map<string, number>, today: string, days = 90): Cohort {
  const c: Cohort = { incubating: 0, fruiting: 0, spent: 0, lost: 0, started: 0 }
  const from = addDays(today, -(days - 1))
  for (const l of lots) {
    if (l.knock_date < from || l.knock_date > today) continue
    const b = n(l.bag_count)
    c.started += b
    if (l.status === 'lost') {
      c.lost += b
      continue
    }
    const gone = Math.min(b, lostByLot.get(l.id) ?? 0)
    c.lost += gone
    c[l.status === 'spent' ? 'spent' : l.status === 'fruiting' ? 'fruiting' : 'incubating'] += b - gone
  }
  return c
}

/** The crop plan's fresh kg a week at full production: blocks a week times Catawba's kg per block. Null without any figure. */
export function planKgPerWeek(split: { key: string; bags: number }[]): number | null {
  let kg = 0
  let any = false
  for (const s of split) {
    const per = expectFor(s.key).kgPerBlock
    if (per === null || !(s.bags > 0)) continue
    kg += s.bags * per
    any = true
  }
  return any ? kg : null
}

// ---------- XENOLAB ----------

export interface StrainContam {
  id: string
  code: string
  species: string
  lots: number
  blocks: number
  lost: number
  pct: number
}

/**
 * Blocks lost as a share of blocks knocked, per strain, over the lots knocked in the last `days` days.
 * A lot marked LOST counts all its blocks. Strains with no lots in the window are left out. Worst first.
 */
export function contamByStrain(strains: Strain[], lots: BlockLot[], losses: LotLoss[], today: string, days = 90): StrainContam[] {
  const from = addDays(today, -(days - 1))
  const lostBy = new Map<string, number>()
  for (const l of losses) lostBy.set(l.block_lot_id, (lostBy.get(l.block_lot_id) ?? 0) + n(l.bag_count))
  const out: StrainContam[] = []
  for (const s of strains) {
    const mine = lots.filter((l) => l.strain_id === s.id && l.knock_date >= from && l.knock_date <= today)
    if (!mine.length) continue
    let blocks = 0
    let lost = 0
    for (const l of mine) {
      const b = n(l.bag_count)
      const gone = Math.min(b, lostBy.get(l.id) ?? 0)
      blocks += b
      lost += l.status === 'lost' ? b : gone
    }
    if (!blocks) continue
    out.push({ id: s.id, code: s.code, species: s.species_key, lots: mine.length, blocks, lost, pct: (lost / blocks) * 100 })
  }
  return out.sort((a, b) => b.pct - a.pct || a.code.localeCompare(b.code))
}

// ---------- TRADE DOCK ----------

/** Fresh kilos still to deliver on standing orders this week (delivery today or later), per species. */
export function ordersDue(orders: StandingOrder[], weeks: OrderWeek[], today: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of orderLines(orders, weeks, weekOf(today))) {
    if (l.order.form !== 'fresh' || l.deliveryOn < today || l.kg <= 0) continue
    out.set(l.order.species_key, (out.get(l.order.species_key) ?? 0) + l.kg)
  }
  return out
}

// ---------- BURSAR ----------

export interface KgCost {
  /** Colones per kg for each part. */
  parts: Record<PartKey, number>
  perKg: number
  kg: number
  weeks: number
  /** True when no knock week is finished picking yet, so the figure leans on part yields. */
  partial: boolean
}

/**
 * What a kilo cost to grow, split into its parts, over the newest `count` knock weeks that are done picking
 * (or, when none is done yet, the newest weeks with any picks). `weeks` is newest first, as the ledger gives it.
 */
export function costPerKgParts(weeks: WeekCost[], count = 8): KgCost | null {
  const picked = weeks.filter((w) => w.all.kg > 0)
  const done = picked.filter((w) => !w.lots.some((l) => l.partial))
  const use = (done.length ? done : picked).slice(0, count)
  const kg = use.reduce((t, w) => t + w.all.kg, 0)
  if (!use.length || kg <= 0) return null
  const parts = Object.fromEntries(PART_KEYS.map((k) => [k, use.reduce((t, w) => t + n(w.all.parts[k]?.crc), 0) / kg])) as Record<PartKey, number>
  return { parts, perKg: PART_KEYS.reduce((t, k) => t + parts[k], 0), kg, weeks: use.length, partial: !done.length }
}
