import { useMemo } from 'react'
import { useCargoPrefs, useStore, useTable } from './StoreContext'
import { WEEKLY_BAGS } from '../data/species'
import { weeklyPlanUse, type UseLine } from '../lib/stockplan'
import { usePlan, weekSplit } from '../data/cropplan'
import { nextKnockDay, todayIso } from '../lib/xeno'
import { usePractice } from './usePractice'
import { CATEGORIES } from '../data/cargo'
import {
  onHandMap,
  priceHistory,
  stockState,
  weeklyUse,
  weeksLeft,
  type Item,
  type Move,
  type Price,
  type StockState,
  type WeeklyUse,
} from '../lib/cargo'

export interface CargoRow {
  item: Item
  onHand: number
  counted: boolean
  use: WeeklyUse | null
  weeks: number | null
  state: StockState
  last: Price | null
  plan: UseLine | null
}

/** Everything CARGO, DECK PLAN and SEQUENCE need to know about stock, worked out once. */
export function useCargo() {
  const store = useStore()
  const items = useTable<Item>('items')
  const prices = useTable<Price>('item_prices')
  const moves = useTable<Move>('stock_moves')
  const [prefs, setPrefs] = useCargoPrefs()

  const crop = usePlan()
  const practice = usePractice()
  // One master and G2 line per species, from next knock day's split (t09 Our farm).
  const plan = useMemo(
    () => weeklyPlanUse(WEEKLY_BAGS, { form: prefs.form, soyShare: prefs.soyShare, split: weekSplit(nextKnockDay(todayIso()), crop), spareMasters: practice.spareMasters }),
    [prefs.form, prefs.soyShare, crop, practice.spareMasters],
  )

  const rows = useMemo<CargoRow[]>(() => {
    const hand = onHandMap(moves)
    const counted = new Set(moves.map((m) => m.item_id))
    const order = (c: string | null) => {
      const i = CATEGORIES.indexOf(c as (typeof CATEGORIES)[number])
      return i < 0 ? CATEGORIES.length : i
    }
    return [...items]
      .sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name))
      .map((item) => {
        const onHand = hand.get(item.id) ?? 0
        const line = (item.code && plan.get(item.code)) || null
        const use = weeklyUse(item, line?.qty, moves)
        const weeks = weeksLeft(onHand, use)
        return {
          item,
          onHand,
          counted: counted.has(item.id),
          use,
          weeks,
          state: stockState(item, onHand, counted.has(item.id), weeks),
          last: priceHistory(item.id, prices)[0] ?? null,
          plan: line,
        }
      })
  }, [items, moves, prices, plan])

  return { store, items, prices, moves, rows, plan, prefs, setPrefs, ready: store.status !== 'loading' }
}
