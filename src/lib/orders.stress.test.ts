// Stress tests for G5: thousands of random order changes checked against an independent model of what each week
// should hold, with undo going back to the exact earlier state and the edit history replaying to the live tables.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import type { EditEntry } from './history'
import type { Sale } from './trade'
import { addDays } from './xeno'
import { dependence, fillRate, orderLines, type OrderWeek, type StandingOrder } from './orders'
import { changeTerms, createOrder, deleteOrder, deliverLine, endOrder, restartOrder, setWeekKg } from './ordersActions'
import { rng } from './testkit'

Store.GROUP_MS = 0
const SEEDS = Number(process.env.STRESS_SEEDS ?? 3)
const STEPS = Number(process.env.STRESS_STEPS ?? 600)
const TABLES = ['standing_orders', 'order_weeks', 'sales'] as const
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const state = (st: Store) => JSON.stringify(TABLES.map((t) => st.rows(t).map(clean).sort((a, b) => String(a.id).localeCompare(String(b.id)))))
const settle = () => new Promise((r) => setTimeout(r, 0))
const W0 = '2025-01-06'
const WEEKS = 70
const monday = (i: number) => addDays(W0, i * 7)

/** The model: what each order should be, kept by the test with plain rules, not by the code under test. */
interface M {
  id: string
  start: string
  end: string | null
  kg: number
  price: number
  dow: number
  ov: Record<string, number>
}
const dayIn = (m: M, week: string) => {
  const d = addDays(week, m.dow - 1)
  return d >= m.start && (!m.end || d <= m.end)
}
const modelKg = (m: M, week: string) => (m.ov[week] !== undefined ? m.ov[week] : m.kg)
const modelCrc = (ms: M[], week: string) => ms.filter((m) => dayIn(m, week)).reduce((n, m) => n + Math.round(modelKg(m, week) * m.price), 0)
const modelKgSum = (ms: M[], week: string) => ms.filter((m) => dayIn(m, week)).reduce((n, m) => n + modelKg(m, week), 0)

async function replay(st: Store) {
  await settle()
  await st.ensure(EDIT_LOG)
  const out: Record<string, Record<string, Row>> = {}
  for (const e of st.rows<EditEntry>(EDIT_LOG)) {
    if (e.row_id === '*') throw new Error('summary line: replay not possible')
    const t = (out[e.table_name] ??= {})
    if (e.op === 'delete') delete t[e.row_id]
    else {
      const r: Row = e.op === 'create' ? { id: e.row_id } : { ...(t[e.row_id] ?? { id: e.row_id }) }
      for (const c of e.changes) r[c.f] = c.new
      t[e.row_id] = r
    }
  }
  for (const t of TABLES) {
    const live = Object.fromEntries(st.rows(t).map((r) => [r.id, clean(r)]))
    const rebuilt = Object.fromEntries(Object.entries(out[t] ?? {}).map(([id, r]) => [id, clean(r)]))
    expect(rebuilt, `history replay of ${t}`).toEqual(live)
  }
}

describe('stress: random standing-order changes match an independent model', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => 900 + i))('random steps (seed %i)', async (seed) => {
    const st = new Store(new MemoryBackend())
    for (const t of TABLES) await st.ensure(t)
    const r = rng(seed)
    let model: M[] = []
    let delivered = new Set<string>() // order id + week with a sale
    const modelSnaps: { m: string; d: string[]; s: string }[] = []
    const orders = () => st.rows<StandingOrder>('standing_orders')
    const weeks = () => st.rows<OrderWeek>('order_weeks')
    const sales = () => st.rows<Sale>('sales')
    const count = { create: 0, change: 0, end: 0, restart: 0, week: 0, del: 0, deliver: 0, undo: 0 }
    const buyers = ['CASA', 'BRISA', 'MAR', 'PEZ', 'TIENDA', 'LUNA', 'SOL', 'RIO', 'COCO', 'PALMA', 'NIDO', 'ALBA']
    const species = ['blue-oyster', 'lions-mane', 'comb-tooth', 'golden-oyster']

    const check = (all: boolean) => {
      expect(orders()).toHaveLength(model.length)
      const sample = all ? Array.from({ length: WEEKS }, (_, i) => i) : Array.from({ length: 8 }, () => r.int(WEEKS))
      for (const i of sample) {
        const wk = monday(i)
        const lines = orderLines(orders(), weeks(), wk)
        expect(lines.reduce((n, l) => n + l.crc, 0), `crc week ${wk}`).toBe(modelCrc(model, wk))
        expect(lines.reduce((n, l) => n + l.kg, 0)).toBeCloseTo(modelKgSum(model, wk), 8)
        expect(lines.filter((l) => l.kg > 0 || l.skipped)).toHaveLength(model.filter((m) => dayIn(m, wk)).length)
        const dep = dependence(lines, 30)
        if (dep.totalCrc > 0) expect(dep.rows.reduce((n, d) => n + d.sharePct, 0)).toBeCloseTo(100, 6)
        // never delivered twice, and the fill rate equals the sales of that week
        const fill = fillRate(lines, sales())
        const want = sales().filter((s) => s.sold_on >= wk && s.sold_on <= addDays(wk, 6) && lines.some((l) => l.order.id === s.order_id))
        expect(fill.deliveredKg).toBeCloseTo(want.reduce((n, s) => n + Number(s.kg), 0), 8)
      }
    }

    for (let step = 0; step < STEPS; step++) {
      const roll = r.next()
      const pre = { m: JSON.stringify(model), d: [...delivered], s: state(st) }
      if (roll < 0.22 || model.length < 3) {
        const start = monday(r.int(WEEKS - 5))
        const kg = r.int(40) + 1 + (r.chance(0.3) ? 0.5 : 0)
        const price = 9000 + 500 * r.int(13)
        const dow = r.int(7) + 1
        const o = await st.action('NEW', () => createOrder(st, { buyer: r.pick(buyers), channel: 'restaurant', species_key: r.pick(species), form: 'fresh', kg, price, day_of_week: dow, start_on: start, confirmed: r.chance(0.6) }))
        model.push({ id: o.id, start, end: null, kg, price, dow, ov: {} })
        count.create++
      } else if (roll < 0.42) {
        const m = r.pick(model)
        const from = monday(r.int(WEEKS))
        const valid = !m.end || m.end >= from
        const kg = r.int(40) + 1
        const price = 9000 + 500 * r.int(13)
        const dow = r.int(7) + 1
        const cur = orders().find((o) => o.id === m.id)!
        const same = Number(cur.kg) === kg && Number(cur.price_crc_per_kg) === price && cur.day_of_week === dow && cur.confirmed === true
        const ok = valid && !same
        const p = st.action('CHANGE', () => changeTerms(st, cur, { kg, price, day_of_week: dow, confirmed: true }, from, weeks()))
        if (!ok) {
          await expect(p).rejects.toThrow()
          continue
        }
        const made = await p
        count.change++
        if (from <= m.start) {
          Object.assign(m, { kg, price, dow })
        } else {
          const nm: M = { id: made.id, start: from, end: null, kg, price, dow, ov: {} }
          for (const [w, v] of Object.entries(m.ov)) if (w >= from) (nm.ov[w] = v), delete m.ov[w]
          m.end = addDays(from, -1)
          model.push(nm)
        }
      } else if (roll < 0.5) {
        const m = r.pick(model)
        const last = addDays(m.start, r.int(250) - 20)
        const ok = last >= m.start && (!m.end || last <= m.end)
        const p = st.action('END', () => endOrder(st, orders().find((o) => o.id === m.id)!, last))
        if (!ok) {
          await expect(p).rejects.toThrow()
          continue
        }
        await p
        m.end = last
        count.end++
      } else if (roll < 0.56) {
        const m = r.pick(model)
        const from = monday(r.int(WEEKS + 10))
        const ok = m.end !== null && from > m.end
        const p = st.action('RESTART', () => restartOrder(st, orders().find((o) => o.id === m.id)!, from))
        if (!ok) {
          await expect(p).rejects.toThrow()
          continue
        }
        const made = await p
        model.push({ id: made.id, start: from, end: null, kg: m.kg, price: m.price, dow: m.dow, ov: {} })
        count.restart++
      } else if (roll < 0.74) {
        const m = r.pick(model)
        const week = monday(r.int(WEEKS))
        const kg = r.chance(0.25) ? null : r.chance(0.2) ? 0 : r.int(30) + 0.5
        const ok = dayIn(m, week)
        const p = st.action('WEEK', () => setWeekKg(st, orders().find((o) => o.id === m.id)!, week, kg, null, weeks()))
        if (!ok) {
          await expect(p).rejects.toThrow()
          continue
        }
        await p
        if (kg === null || kg === m.kg) delete m.ov[week]
        else m.ov[week] = kg
        count.week++
      } else if (roll < 0.8) {
        const m = r.pick(model)
        await st.action('DELETE', () => deleteOrder(st, orders().find((o) => o.id === m.id)!, weeks()))
        model = model.filter((x) => x.id !== m.id)
        count.del++
      } else if (roll < 0.92) {
        const m = r.pick(model)
        const week = monday(r.int(WEEKS))
        const line = orderLines(orders(), weeks(), week).find((l) => l.order.id === m.id)
        if (!line || line.kg <= 0) continue
        const key = `${m.id}|${week}`
        const dup = sales().some((s) => s.order_id === m.id && s.sold_on >= week && s.sold_on <= addDays(week, 6))
        const p = st.action('DELIVER', () => deliverLine(st, line, sales()))
        if (dup) {
          await expect(p).rejects.toThrow('ALREADY')
          continue
        }
        const s = await p
        expect(s.amount_crc).toBe(Math.round(line.kg * Number(line.order.price_crc_per_kg)))
        delivered.add(key)
        count.deliver++
      } else if (st.undoPeek()) {
        // Undo goes back to exactly the state before the last undoable step.
        const snap = modelSnaps.pop()
        await st.undo()
        count.undo++
        if (snap) {
          model = JSON.parse(snap.m) as M[]
          delivered = new Set(snap.d)
          expect(state(st), 'undo restores the exact earlier state').toBe(snap.s)
        }
        check(false)
        continue
      } else continue
      // one undo step per user action: remember what the world looked like before it
      if (state(st) !== pre.s) modelSnaps.push(pre) // an action that changed nothing leaves no undo step
      if (step % 40 === 0) check(false)
    }
    check(true)
    if (process.env.STRESS_LOG) console.log('seed', seed, JSON.stringify(count), 'orders', model.length)
    expect(count.create + count.change + count.week + count.deliver).toBeGreaterThan(STEPS * 0.3)
    await replay(st)
    // Backup and restore into a new store gives the same weeks.
    const st2 = new Store(new MemoryBackend())
    await st2.importJson(await st.exportJson())
    await st2.ensure('standing_orders')
    await st2.ensure('order_weeks')
    for (let i = 0; i < WEEKS; i += 3) {
      const wk = monday(i)
      expect(orderLines(st2.rows<StandingOrder>('standing_orders'), st2.rows<OrderWeek>('order_weeks'), wk).reduce((n, l) => n + l.crc, 0)).toBe(modelCrc(model, wk))
    }
  }, 120_000)
})
