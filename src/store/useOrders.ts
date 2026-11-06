import { useMemo } from 'react'
import { useTable } from './StoreContext'
import { useRecords } from './useRecords'
import { addDays, todayIso } from '../lib/xeno'
import type { Sale } from '../lib/trade'
import { dependence, forecastAll, mondayOf, orderLines, pickedByWeek, weekPlan, type OrderWeek, type StandingOrder } from '../lib/orders'

/** Everything the STANDING ORDERS screens need: orders, forecast, sales, practice settings, and one week's plan. */
export function useOrders(week: string | null) {
  const orders = useTable<StandingOrder>('standing_orders')
  const weeks = useTable<OrderWeek>('order_weeks')
  const sales = useTable<Sale>('sales')
  const r = useRecords()
  const now = todayIso()
  const wk = week ?? mondayOf(now)
  const forecasts = useMemo(() => forecastAll(r.recs, now), [r.recs, now])
  const lines = useMemo(() => orderLines(orders, weeks, wk), [orders, weeks, wk])
  const speciesOfLot = useMemo(() => new Map(r.lots.map((l) => [l.id, l.species_key])), [r.lots])
  const picked = useMemo(() => pickedByWeek(r.harvests, speciesOfLot, wk), [r.harvests, speciesOfLot, wk])
  const plan = useMemo(() => weekPlan({ week: wk, now, forecasts, lines, picked, spareBlockPct: r.practice.spareBlockPct }), [wk, now, forecasts, lines, picked, r.practice.spareBlockPct])
  const dep = useMemo(() => dependence(lines, r.practice.buyerCapPct), [lines, r.practice.buyerCapPct])
  return { orders, weeks, sales, recs: r.recs, lots: r.lots, practice: r.practice, now, week: wk, thisWeek: mondayOf(now), nextWeek: addDays(mondayOf(now), 7), forecasts, lines, plan, dep }
}
export type OrdersData = ReturnType<typeof useOrders>
