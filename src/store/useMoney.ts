import { useMemo } from 'react'
import { useStore, useTable } from './StoreContext'
import { useRates } from './useRates'
import { usePractice } from './usePractice'
import { useFx } from './useFx'
import type { SettingsRow } from './useRates'
import { todayIso } from '../lib/xeno'
import { MONEY_ID, books, budgetBook, mergeMoney, owed, type BudgetLine, type CashMove, type MoneySettings, type WasteEntry } from '../lib/money'
import { saveMoney } from '../lib/moneyActions'
import type { Sale } from '../lib/trade'
import type { EnergyBill, LabourEntry } from '../lib/ledger'
import type { Item, Move, Price } from '../lib/cargo'

export function useMoneySettings(): MoneySettings {
  const rows = useTable<SettingsRow>('app_settings')
  const row = rows.find((r) => r.id === MONEY_ID)
  return useMemo(() => mergeMoney(row?.value), [row])
}

export function useMoneyEditor(): [MoneySettings, (patch: Partial<MoneySettings>, label: string) => Promise<void>] {
  const store = useStore()
  const m = useMoneySettings()
  return [m, async (patch, label) => void (await store.action(label, () => saveMoney(store, m, patch)))]
}

/** Every table MONEY reads, and the two books (profit and loss, cash) built from them. */
export function useMoney() {
  const sales = useTable<Sale>('sales')
  const moves = useTable<CashMove>('cash_moves')
  const budget = useTable<BudgetLine>('budget_lines')
  const waste = useTable<WasteEntry>('waste_log')
  const bills = useTable<EnergyBill>('energy_bills')
  const labour = useTable<LabourEntry>('labour_entries')
  const stock = useTable<Move>('stock_moves')
  const prices = useTable<Price>('item_prices')
  const items = useTable<Item>('items')
  const rt = useRates()
  const settings = useMoneySettings()
  const practice = usePractice()
  const today = todayIso()
  const fx = useFx()
  const bk = useMemo(
    () => books({ sales, moves, bills, labour, stock, prices, items, budget, labourRate: rt.labourRate, labourOn: rt.labourOn, settings }, fx.rate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, moves, bills, labour, stock, prices, items, budget, rt.labourRate, rt.labourOn, settings, fx.rows, fx.fallback],
  )
  const bud = useMemo(() => budgetBook(budget), [budget])
  const ow = useMemo(() => owed(sales, today), [sales, today])
  return { sales, moves, budget, waste, bills, labour, settings, practice, today, pnl: bk.pnl, cash: bk.cash, pnlUsd: bk.pnlUsd, cashUsd: bk.cashUsd, fx, unpriced: bk.unpricedDeliveries, bud, owed: ow }
}
export type MoneyData = ReturnType<typeof useMoney>
