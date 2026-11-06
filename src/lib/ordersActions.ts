// Writes for STANDING ORDERS (build G5). Each function is ONE user action: screens call them inside
// store.action(label, ...) so a change (or "deliver everything for Friday") is a single UNDO step and history line.

import { uuid, type Store } from './store'
import { addDays, parseDay } from './xeno'
import type { Channel } from '../data/ledger'
import { newSale, type Sale } from './trade'
import {
  EPS,
  activeIn,
  checkOrder,
  deliveredFor,
  isMonday,
  weekRowId,
  type OrderInput,
  type OrderLine,
  type OrderWeek,
  type StandingOrder,
} from './orders'

const nowIso = () => new Date().toISOString()
const cleanNote = (s: string | null | undefined) => (s ?? '').trim().slice(0, 140) || null

export interface NewOrderIn extends OrderInput {
  channel: Channel
  confirmed: boolean
  notes?: string | null
  prev_id?: string | null
}

export async function createOrder(store: Store, i: NewOrderIn): Promise<StandingOrder> {
  const bad = checkOrder(i)
  if (bad) throw new Error(bad)
  const now = nowIso()
  const row: StandingOrder = {
    id: uuid(),
    buyer: i.buyer.trim().replace(/\s+/g, ' '),
    channel: i.channel,
    species_key: i.species_key,
    form: i.form,
    kg: i.kg as number,
    price_crc_per_kg: i.price as number,
    day_of_week: i.day_of_week,
    start_on: i.start_on,
    end_on: null,
    confirmed: i.confirmed,
    prev_id: i.prev_id ?? null,
    notes: cleanNote(i.notes),
    created_at: now,
    updated_at: now,
  }
  await store.put('standing_orders', row)
  return row
}

export interface Terms {
  kg: number | null
  price: number | null
  day_of_week: number
  confirmed: boolean
}

/**
 * Change an order's kg, price, delivery day or confirmation from a Monday on. The old row keeps its old terms
 * and ends the day before; a new row carries the new ones. Past weeks therefore never change.
 * If the order has not started by then, it is simply edited in place.
 * One-week changes (skips) for weeks from `from` on move across to the new row, so a skipped week is not lost.
 */
export async function changeTerms(store: Store, o: StandingOrder, t: Terms, from: string, weeks: OrderWeek[] = []): Promise<StandingOrder> {
  if (!isMonday(from)) throw new Error('A CHANGE STARTS ON A MONDAY (THE WEEK IT FIRST APPLIES TO).')
  const bad = checkOrder({ buyer: o.buyer, species_key: o.species_key, form: o.form, kg: t.kg, price: t.price, day_of_week: t.day_of_week, start_on: from })
  if (bad) throw new Error(bad)
  if (o.end_on && o.end_on < from) throw new Error('THAT ORDER ALREADY ENDED. RESTART IT INSTEAD.')
  const same = Number(o.kg) === t.kg && Number(o.price_crc_per_kg) === t.price && o.day_of_week === t.day_of_week && o.confirmed === t.confirmed
  if (same) throw new Error('NOTHING CHANGED.')
  const lastOld = addDays(from, -1)
  if (from <= o.start_on || o.start_on > lastOld) {
    const next: StandingOrder = { ...o, kg: t.kg as number, price_crc_per_kg: t.price as number, day_of_week: t.day_of_week, confirmed: t.confirmed, updated_at: nowIso() }
    await store.put('standing_orders', next)
    return next
  }
  await store.put('standing_orders', { ...o, end_on: lastOld, updated_at: nowIso() })
  const made = await createOrder(store, {
    buyer: o.buyer,
    species_key: o.species_key,
    form: o.form,
    kg: t.kg,
    price: t.price,
    day_of_week: t.day_of_week,
    start_on: from,
    channel: o.channel,
    confirmed: t.confirmed,
    notes: o.notes,
    prev_id: o.id,
  })
  for (const w of weeks.filter((x) => x.order_id === o.id && x.week_start >= from)) {
    await store.del('order_weeks', w.id)
    await store.put('order_weeks', { ...w, id: weekRowId(made.id, w.week_start), order_id: made.id, updated_at: nowIso() })
  }
  return made
}

/** Stop an order after `lastDay` (the last delivery that still happens). */
export async function endOrder(store: Store, o: StandingOrder, lastDay: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) throw new Error('PICK THE LAST DAY.')
  if (lastDay < o.start_on) throw new Error('THAT IS BEFORE THE ORDER STARTED. DELETE THE ORDER INSTEAD.')
  if (o.end_on && lastDay > o.end_on) throw new Error('THE ORDER ALREADY ENDS EARLIER THAN THAT.')
  await store.put('standing_orders', { ...o, end_on: lastDay, updated_at: nowIso() })
}

/** Start the same order again from a Monday (after it ended). */
export async function restartOrder(store: Store, o: StandingOrder, from: string): Promise<StandingOrder> {
  if (!isMonday(from)) throw new Error('A RESTART STARTS ON A MONDAY.')
  if (!o.end_on) throw new Error('THAT ORDER IS STILL RUNNING.')
  if (from <= o.end_on) throw new Error(`IT RAN UNTIL ${o.end_on}. RESTART FROM A LATER MONDAY.`)
  return createOrder(store, {
    buyer: o.buyer,
    species_key: o.species_key,
    form: o.form,
    kg: Number(o.kg),
    price: Number(o.price_crc_per_kg),
    day_of_week: o.day_of_week,
    start_on: from,
    channel: o.channel,
    confirmed: o.confirmed,
    notes: o.notes,
    prev_id: o.id,
  })
}

export async function setNote(store: Store, o: StandingOrder, notes: string): Promise<void> {
  const n = cleanNote(notes)
  if ((o.notes ?? null) === n) return
  await store.put('standing_orders', { ...o, notes: n, updated_at: nowIso() })
}

/** Change one week of one order. kg null puts the week back to the standing amount. */
export async function setWeekKg(store: Store, o: StandingOrder, week: string, kg: number | null, note?: string | null, weeks: OrderWeek[] = []): Promise<void> {
  if (!isMonday(week)) throw new Error('A WEEK STARTS ON A MONDAY.')
  if (!activeIn(o, week)) throw new Error('THAT ORDER DOES NOT DELIVER IN THAT WEEK.')
  const id = weekRowId(o.id, week)
  if (kg === null || (Math.abs(kg - Number(o.kg)) < EPS && !cleanNote(note))) {
    if (weeks.some((w) => w.id === id)) await store.del('order_weeks', id)
    return
  }
  if (!Number.isFinite(kg) || kg < 0) throw new Error('TYPE KG OF 0 OR MORE (0 SKIPS THE WEEK).')
  if (kg > 1000) throw new Error('THAT IS OVER 1,000 KG. CHECK THE NUMBER.')
  const now = nowIso()
  const had = weeks.find((w) => w.id === id)
  await store.put('order_weeks', { id, order_id: o.id, week_start: week, kg, note: cleanNote(note), created_at: had?.created_at ?? now, updated_at: now })
}

/** Delete an order and its week changes. Sales already made from it stay in TRADE. */
export async function deleteOrder(store: Store, o: StandingOrder, weeks: OrderWeek[]): Promise<void> {
  for (const w of weeks.filter((x) => x.order_id === o.id)) await store.del('order_weeks', w.id)
  await store.del('standing_orders', o.id)
}

// ---------- deliveries ----------

/**
 * Tick one line off the pick list: it becomes a sale in TRADE (paid on the spot: cash on delivery). `kg` is what really went out.
 * One delivery per order per week; undo or delete the sale to do it again.
 */
export async function deliverLine(store: Store, l: OrderLine, sales: Sale[], kg: number = l.kg, on: string = l.deliveryOn, lots: string[] | null = null): Promise<Sale> {
  if (!Number.isFinite(kg) || kg <= 0) throw new Error('TYPE THE KG DELIVERED (MORE THAN 0).')
  if (deliveredFor(l, sales).length) throw new Error(`${l.order.buyer.toUpperCase()} ALREADY HAS A DELIVERY THIS WEEK.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || !Number.isFinite(parseDay(on).getTime())) throw new Error('PICK THE DELIVERY DAY.')
  const o = l.order
  const sale: Sale = {
    ...newSale({
      sold_on: on,
      buyer: o.buyer,
      channel: o.channel,
      species_key: o.species_key,
      form: o.form,
      kg,
      amount_crc: Math.round(kg * Number(o.price_crc_per_kg)),
      lot_codes: lots && lots.length ? lots : null,
      notes: 'STANDING ORDER',
    }),
    order_id: o.id,
  }
  await store.put('sales', sale)
  return sale
}

/** Deliver every open line of a list in one go (one UNDO step). Returns how many were made. */
export async function deliverAll(store: Store, lines: OrderLine[], sales: Sale[]): Promise<number> {
  let n = 0
  for (const l of lines) {
    if (l.kg <= 0 || deliveredFor(l, sales).length) continue
    await deliverLine(store, l, sales)
    n++
  }
  if (!n) throw new Error('NOTHING LEFT TO DELIVER.')
  return n
}
