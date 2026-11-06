// Stress tests for G6: thousands of random money actions (sales, payments, write-offs, receipts, spending,
// budget, waste) checked after every step against a plain model kept by the test, plus undo back to the exact
// earlier state, unique receipt numbers, and a backup restore that gives identical books.
import { describe, expect, it } from 'vitest'
import { MemoryBackend, Store, type Row } from './store'
import { newSale, type Sale } from './trade'
import { addDays } from './xeno'
import { DEFAULT_MONEY, bookMonth, books, budgetBook, owed, type BudgetLine, type CashMove, type MoneyDb, type WasteEntry } from './money'
import { addMove, addWaste, deleteMoves, deleteWaste, issueReceipts, markOwed, markPaid, setBudget, writeOff } from './moneyActions'
import { rng } from './testkit'

Store.GROUP_MS = 0
const SEEDS = Number(process.env.STRESS_SEEDS ?? 3)
const STEPS = Number(process.env.STRESS_STEPS ?? 500)
const TABLES = ['sales', 'cash_moves', 'budget_lines', 'waste_log'] as const
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const state = (st: Store) => JSON.stringify(TABLES.map((t) => st.rows(t).map(clean).sort((a, b) => String(a.id).localeCompare(String(b.id)))))
const D0 = '2025-01-01'
const rate = (d: string) => 500 + (Number(d.slice(8, 10)) % 30)
const LINES = ['fuel', 'substrate', 'packaging', 'equipment', 'loan_in', 'loan_pay', 'other_income'] as const
const dbOf = (st: Store): MoneyDb => ({ sales: st.rows<Sale>('sales'), moves: st.rows<CashMove>('cash_moves'), bills: [], labour: [], stock: [], prices: [], budget: st.rows<BudgetLine>('budget_lines'), labourRate: null, labourOn: false, settings: DEFAULT_MONEY })
const sumBook = (b: Map<string, Map<string, number>>, kind?: 'in' | 'out') => [...b.keys()].reduce((t, m) => t + bookMonth(b, m, kind), 0)

function diffState(a: string, b: string): string {
  const A = JSON.parse(a) as Row[][]
  const B = JSON.parse(b) as Row[][]
  const out: string[] = []
  A.forEach((ta, i) => {
    const sa = new Set(ta.map((r) => JSON.stringify(r)))
    const sb = new Set(B[i].map((r) => JSON.stringify(r)))
    for (const r of sa) if (!sb.has(r)) out.push(`${TABLES[i]} WANT ${r}`)
    for (const r of sb) if (!sa.has(r)) out.push(`${TABLES[i]} GOT ${r}`)
  })
  return out.slice(0, 4).join(' | ')
}

interface MSale { amount: number; st: 'paid' | 'owed' | 'written_off'; sold: string; paid: string | null }

describe('money stress', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: ${STEPS} random actions, model, undo, receipts, backup`, async () => {
      const r = rng(seed * 7919).next
      const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]
      const st = new Store(new MemoryBackend())
      for (const t of TABLES) await st.ensure(t)
      const sales = new Map<string, MSale>()
      const moves = new Map<string, { line: string; amount: number }>()
      const budget = new Map<string, number>()
      let wasteKg = 0
      const waste = new Map<string, number>()
      const undoable: { before: string; model: string }[] = []
      const snapModel = () => JSON.stringify([[...sales], [...moves], [...budget], wasteKg, [...waste]])
      const restoreModel = (s: string) => {
        const [a, b, c, d, e] = JSON.parse(s)
        sales.clear(); for (const [k, v] of a) sales.set(k, v)
        moves.clear(); for (const [k, v] of b) moves.set(k, v)
        budget.clear(); for (const [k, v] of c) budget.set(k, v)
        wasteKg = d
        waste.clear(); for (const [k, v] of e) waste.set(k, v)
      }
      for (let step = 0; step < STEPS; step++) {
        const before = state(st)
        const model = snapModel()
        const op = r()
        const day = addDays(D0, Math.floor(r() * 700))
        let did = true
        try {
          if (op < 0.25) {
            const amount = Math.round(r() * 50000) + 1
            const owe = r() < 0.2
            const s = newSale({ sold_on: day, channel: 'restaurant', kg: 1 + Math.floor(r() * 5), amount_crc: amount, buyer: pick(['A', 'B', 'C', 'D']), pay_status: owe ? 'owed' : 'paid', paid_on: owe ? null : day })
            await st.action('SALE', () => st.put('sales', s))
            sales.set(s.id, { amount, st: owe ? 'owed' : 'paid', sold: day, paid: owe ? null : day })
          } else if (op < 0.37 && sales.size) {
            const ids = [...sales.keys()].filter(() => r() < 0.3)
            if (!ids.length) did = false
            else {
              const pd = addDays(D0, Math.floor(r() * 760))
              const ok = ids.every((id) => pd >= sales.get(id)!.sold)
              if (!ok) {
                await expect(markPaid(st, ids, pd)).rejects.toThrow()
                did = false
              } else {
                await st.action('PAID', () => markPaid(st, ids, pd))
                for (const id of ids) Object.assign(sales.get(id)!, { st: 'paid', paid: pd })
              }
            }
          } else if (op < 0.45 && sales.size) {
            const id = pick([...sales.keys()])
            await st.action('OWED', () => markOwed(st, [id]))
            Object.assign(sales.get(id)!, { st: 'owed', paid: null })
          } else if (op < 0.5 && sales.size) {
            const id = pick([...sales.keys()])
            const m = sales.get(id)!
            if (m.st !== 'owed') {
              await expect(writeOff(st, [id], day)).rejects.toThrow()
              did = false
            } else {
              await st.action('WRITE OFF', () => writeOff(st, [id], day))
              Object.assign(m, { st: 'written_off', paid: day < m.sold ? m.sold : day })
            }
          } else if (op < 0.56 && sales.size) {
            const ids = [...sales.keys()].filter(() => r() < 0.2)
            await st.action('RECEIPTS', () => issueReceipts(st, ids))
            did = st.rows<Sale>('sales').some((s) => ids.includes(s.id)) // may be a no-change action
          } else if (op < 0.72) {
            const amount = Math.round(r() * 90000) + 1
            const line = pick(LINES)
            const bad = r() < 0.05
            if (bad) {
              await expect(addMove(st, { day, line: 'electricity', amount })).rejects.toThrow()
              did = false
            } else {
              const m = await st.action('MOVE', () => addMove(st, { day, line, amount }))
              moves.set(m.id, { line, amount })
            }
          } else if (op < 0.78 && moves.size) {
            const id = pick([...moves.keys()])
            await st.action('DEL MOVE', () => deleteMoves(st, [id]))
            moves.delete(id)
          } else if (op < 0.88) {
            const month = day.slice(0, 7)
            const line = pick(['sales_fresh', 'electricity', 'fuel'])
            const v = r() < 0.2 ? 0 : Math.round(r() * 1e6)
            await st.action('BUDGET', () => setBudget(st, month, line, v))
            if (v) budget.set(`${month}:${line}`, v)
            else budget.delete(`${month}:${line}`)
          } else if (op < 0.95) {
            const kg = Math.round(r() * 10000) / 1000 + 0.001
            const w = await st.action('WASTE', () => addWaste(st, { day, species: 'blue-oyster', kg, route: pick(['unsold', 'dried', 'donated', 'compost'] as const) }))
            waste.set(w.id, w.kg)
            wasteKg += w.kg
          } else if (waste.size) {
            const id = pick([...waste.keys()])
            await st.action('DEL WASTE', () => deleteWaste(st, [id]))
            wasteKg -= waste.get(id)!
            waste.delete(id)
          } else did = false
        } catch (e) {
          throw new Error(`seed ${seed} step ${step}: ${(e as Error).message}`)
        }
        if (did && state(st) !== before) {
          undoable.push({ before, model })
          if (undoable.length > Store.UNDO_DEPTH) undoable.shift() // the store keeps the newest 40 steps
        }

        // Sometimes undo the newest action: the tables must go back exactly.
        if (r() < 0.08 && undoable.length) {
          const u = undoable.pop()!
          const label = st.undoPeek()?.label
          await st.undo()
          const now = state(st)
          if (now !== u.before) throw new Error(`seed ${seed} step ${step}: undo of ${label} left ${diffState(u.before, now)}`)
          restoreModel(u.model)
        }

        // Invariants after every step.
        const bk = books(dbOf(st), rate)
        const earned = [...sales.values()].reduce((t, s) => t + s.amount, 0)
        const paid = [...sales.values()].filter((s) => s.st === 'paid').reduce((t, s) => t + s.amount, 0)
        const written = [...sales.values()].filter((s) => s.st === 'written_off').reduce((t, s) => t + s.amount, 0)
        const owedM = [...sales.values()].filter((s) => s.st === 'owed').reduce((t, s) => t + s.amount, 0)
        const movesIn = [...moves.values()].filter((m) => m.line === 'loan_in' || m.line === 'other_income').reduce((t, m) => t + m.amount, 0)
        const movesOut = [...moves.values()].filter((m) => !(m.line === 'loan_in' || m.line === 'other_income')).reduce((t, m) => t + m.amount, 0)
        expect(sumBook(bk.pnl, 'in')).toBeCloseTo(earned + [...moves.values()].filter((m) => m.line === 'other_income').reduce((t, m) => t + m.amount, 0), 6)
        expect(sumBook(bk.cash, 'in')).toBeCloseTo(paid + movesIn, 6)
        expect(sumBook(bk.cash, 'out')).toBeCloseTo(movesOut, 6)
        expect(owed(st.rows<Sale>('sales'), '2027-12-31').total).toBeCloseTo(owedM, 6)
        const bb = budgetBook(st.rows<BudgetLine>('budget_lines'))
        expect(sumBook(bb)).toBe([...budget.values()].reduce((t, v) => t + v, 0))
        expect(sumBook(bk.pnl, 'out')).toBeCloseTo(written + [...moves.values()].filter((m) => ['fuel', 'substrate', 'packaging'].includes(m.line)).reduce((t, m) => t + m.amount, 0), 6)
        expect(st.rows<WasteEntry>('waste_log').reduce((t, w) => t + w.kg, 0)).toBeCloseTo(wasteKg, 6)
        const nos = st.rows<Sale>('sales').map((s) => s.receipt_no).filter(Boolean)
        expect(new Set(nos).size).toBe(nos.length)
        for (const s of st.rows<Sale>('sales')) if (s.receipt_no) expect(s.receipt_no.slice(1, 5)).toBe(`${s.sold_on.slice(2, 4)}${s.sold_on.slice(5, 7)}`)
      }
      // Backup into a new device: identical books.
      const st2 = new Store(new MemoryBackend())
      await st2.importJson(await st.exportJson())
      expect(state(st2)).toBe(state(st))
      const a = books(dbOf(st), rate)
      const b = books(dbOf(st2), rate)
      expect(sumBook(b.cash)).toBeCloseTo(sumBook(a.cash), 6)
      expect(sumBook(b.pnlUsd)).toBeCloseTo(sumBook(a.pnlUsd), 6)
    }, 120000)
  }
})
