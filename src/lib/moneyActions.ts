// Writes for MONEY (build G6). Each function is ONE user action: screens call them inside
// store.action(label, ...) so marking three sales paid is one UNDO step and one history line.

import { uuid, type Store } from './store'
import type { Sale } from './trade'
import {
  LINE,
  MONEY_ID,
  addMonths,
  budgetId,
  checkMove,
  checkWaste,
  mergeMoney,
  nextReceiptNo,
  type BudgetLine,
  type CashMove,
  type MoneySettings,
  type WasteEntry,
  type WasteRoute,
} from './money'

const nowIso = () => new Date().toISOString()
const clean = (s: string | null | undefined, max = 140) => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Give receipt numbers to sales that have none (oldest first). Returns the sales as saved. */
export async function issueReceipts(store: Store, ids: string[]): Promise<Sale[]> {
  await store.ensure('sales')
  const all = store.rows<Sale>('sales')
  const want = new Set(ids)
  const todo = all.filter((s) => want.has(s.id) && !s.receipt_no).sort((a, b) => a.sold_on.localeCompare(b.sold_on) || (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  const seen = [...all]
  const out: Sale[] = []
  for (const s of todo) {
    const r = nextReceiptNo(seen, s.sold_on)
    const next = { ...s, receipt_no: r }
    seen.push(next)
    out.push(next)
  }
  if (out.length) await store.put('sales', out)
  return all.filter((s) => want.has(s.id)).map((s) => out.find((o) => o.id === s.id) ?? s)
}

/** Mark sales paid on a day (cash came in). A day before the sale is refused. */
export async function markPaid(store: Store, ids: string[], day: string): Promise<number> {
  if (!isDay(day)) throw new Error('PICK THE DAY THE CASH CAME IN.')
  await store.ensure('sales')
  const want = new Set(ids)
  const rows = store.rows<Sale>('sales').filter((s) => want.has(s.id))
  if (!rows.length) throw new Error('NO SALE PICKED.')
  const early = rows.find((s) => day < s.sold_on)
  if (early) throw new Error(`PAID DAY ${day} IS BEFORE THE SALE ON ${early.sold_on}.`)
  await store.put('sales', rows.map((s) => ({ ...s, pay_status: 'paid' as const, paid_on: day })))
  return rows.length
}

/** The exception to cash on delivery: this sale was not paid when delivered. */
export async function markOwed(store: Store, ids: string[]): Promise<number> {
  await store.ensure('sales')
  const want = new Set(ids)
  const rows = store.rows<Sale>('sales').filter((s) => want.has(s.id))
  if (!rows.length) throw new Error('NO SALE PICKED.')
  const todo = rows.filter((s) => s.pay_status !== 'owed')
  if (todo.length) await store.put('sales', todo.map((s) => ({ ...s, pay_status: 'owed' as const, paid_on: null })))
  return todo.length
}

/** Give up on money owed. It becomes a cost in the month of `day`. Only owed sales can be written off. */
export async function writeOff(store: Store, ids: string[], day: string): Promise<number> {
  if (!isDay(day)) throw new Error('PICK THE DAY.')
  await store.ensure('sales')
  const want = new Set(ids)
  const rows = store.rows<Sale>('sales').filter((s) => want.has(s.id))
  if (!rows.length) throw new Error('NO SALE PICKED.')
  if (rows.some((s) => s.pay_status !== 'owed')) throw new Error('ONLY MONEY OWED CAN BE WRITTEN OFF.')
  await store.put('sales', rows.map((s) => ({ ...s, pay_status: 'written_off' as const, paid_on: day < s.sold_on ? s.sold_on : day })))
  return rows.length
}

export interface MoveIn {
  day: string
  line: string
  amount: number | null
  who?: string | null
  notes?: string | null
}

export async function addMove(store: Store, i: MoveIn): Promise<CashMove> {
  const bad = checkMove(i)
  if (bad) throw new Error(bad)
  const now = nowIso()
  const row: CashMove = { id: uuid(), day: i.day, line: i.line, amount_crc: Math.round((i.amount as number) * 100) / 100, who: clean(i.who, 60), notes: clean(i.notes), created_at: now, updated_at: now }
  await store.put('cash_moves', row)
  return row
}

export async function editMove(store: Store, m: CashMove, i: MoveIn): Promise<void> {
  const bad = checkMove(i)
  if (bad) throw new Error(bad)
  await store.put('cash_moves', { ...m, day: i.day, line: i.line, amount_crc: Math.round((i.amount as number) * 100) / 100, who: clean(i.who, 60), notes: clean(i.notes) })
}

export async function deleteMoves(store: Store, ids: string[]): Promise<void> {
  await store.del('cash_moves', ids)
}

/** Set one budget figure. 0 or blank removes it. */
export async function setBudget(store: Store, month: string, line: string, amount: number | null): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('BAD MONTH.')
  if (!LINE.has(line)) throw new Error('UNKNOWN LINE.')
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e10)) throw new Error('TYPE A ₡ AMOUNT, 0 OR MORE.')
  const id = budgetId(month, line)
  await store.ensure('budget_lines')
  const had = store.rows<BudgetLine>('budget_lines').some((r) => r.id === id)
  if (!amount) {
    if (had) await store.del('budget_lines', id)
    return
  }
  await store.put('budget_lines', { id, month, line, amount_crc: Math.round(amount), updated_at: nowIso() })
}

/** The same figure for a line in `count` months from `start` (FILL 12 MONTHS). */
export async function fillBudget(store: Store, start: string, count: number, line: string, amount: number | null): Promise<void> {
  for (let i = 0; i < count; i++) await setBudget(store, addMonths(start, i), line, amount)
}

/** Several lines at once, all months (seed from the plan). */
export async function seedBudget(store: Store, start: string, count: number, figures: Record<string, number>): Promise<void> {
  for (const [line, v] of Object.entries(figures)) await fillBudget(store, start, count, line, Math.round(v))
}

export interface WasteIn {
  day: string
  species: string
  kg: number | null
  route: WasteRoute
  lots?: string[]
  notes?: string | null
}
export async function addWaste(store: Store, i: WasteIn): Promise<WasteEntry> {
  const bad = checkWaste(i)
  if (bad) throw new Error(bad)
  const now = nowIso()
  const row: WasteEntry = { id: uuid(), logged_on: i.day, species_key: i.species, kg: Math.round((i.kg as number) * 1000) / 1000, route: i.route, lot_codes: i.lots?.length ? i.lots : null, notes: clean(i.notes), created_at: now, updated_at: now }
  await store.put('waste_log', row)
  return row
}
export async function deleteWaste(store: Store, ids: string[]): Promise<void> {
  await store.del('waste_log', ids)
}

export async function saveMoney(store: Store, current: MoneySettings, patch: Partial<MoneySettings>): Promise<MoneySettings> {
  const next = mergeMoney({ ...current, ...patch })
  await store.put('app_settings', { id: MONEY_ID, value: next, updated_at: nowIso() })
  return next
}
