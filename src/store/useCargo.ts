import { useMemo } from 'react'
import { useCargoPrefs, useStore, useTable } from './StoreContext'
import { WEEKLY_BAGS } from '../data/species'
import { weeklyPlanUse, type UseLine } from '../lib/stockplan'
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

  const plan = useMemo(() => weeklyPlanUse(WEEKLY_BAGS, { form: prefs.form, soyShare: prefs.soyShare }), [prefs.form, prefs.soyShare])

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
