// G10 farm assistant stress and history tests: big farms, random sentences, rapid confirmed saves,
// two years of back data, backup round trips. Totals are checked against sums worked out separately.
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from '../store'
import type { EditEntry } from '../history'
import { rng } from '../testkit'
import { ask, confirmPlan, type Turn } from './ask'
import { DEFAULT_ENGINE, type EngineCfg, type Fetcher } from './llm'
import { NEVER } from './refusals'
import { FARM, NOW, TODAY, farmStore } from './fixture'
import type { AskCtx } from './core'

Store.GROUP_MS = 0
const SEEDS = Number(process.env.STRESS_SEEDS ?? 2)
const RULES: EngineCfg = { ...DEFAULT_ENGINE, kind: 'off' }
const ctxOf = (store: Store, role: 'owner' | 'staff' = 'owner'): AskCtx => ({ store, role, now: NOW, today: TODAY, initials: 'JM' })
const text = (t: Turn) => [...t.lines, ...(t.plan?.lines ?? []), ...(t.facts ?? [])].join('\n')
const settle = () => new Promise((r) => setTimeout(r, 0))
const counts = (st: Store) => ['harvests', 'block_lots', 'power_cuts', 'sensor_readings', 'stock_moves', 'sales'].map((t) => st.rows(t).length).join(',')
const kg = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)} KG`
const SP = ['blue-oyster', 'lions-mane', 'golden-oyster', 'shiitake']
const LETTER: Record<string, string> = { 'blue-oyster': 'B', 'lions-mane': 'L', 'golden-oyster': 'G', shiitake: 'S' }

async function bigFarm(nLots: number, nPicks: number, nSales: number, nReadings: number, seed = 1) {
  const r = rng(seed)
  const st = new Store(new MemoryBackend())
  const lots: Row[] = []
  for (let i = 0; i < nLots; i++) {
    const sp = SP[i % SP.length]
    const d = new Date(Date.UTC(2024, 0, 1) + r.int(1040) * 86400000).toISOString().slice(0, 10)
    lots.push({ id: `L${i}`, lot_code: `${LETTER[sp]}${String(i).padStart(5, '0')}`, species_key: sp, strain_id: null, grain_run_id: null, g2_bags_used: null, bag_count: 10 + r.int(30), knock_date: d, status: r.pick(['incubating', 'fruiting', 'fruiting', 'spent', 'lost']), notes: null })
  }
  const picks: Row[] = []
  for (let i = 0; i < nPicks; i++) {
    const l = lots[r.int(lots.length)]
    const d = new Date(Date.UTC(2024, 0, 1) + r.int(1041) * 86400000).toISOString().slice(0, 10)
    picks.push({ id: `H${i}`, block_lot_id: l.id, harvested_on: d > TODAY ? TODAY : d, flush: 1 + r.int(3), kg: Math.round((0.2 + r.next() * 6) * 100) / 100, grade: 'A', initials: 'JM', notes: null })
  }
  const sales: Row[] = []
  for (let i = 0; i < nSales; i++) {
    const d = new Date(Date.UTC(2024, 0, 1) + r.int(1041) * 86400000).toISOString().slice(0, 10)
    sales.push({ id: `S${i}`, sold_on: d > TODAY ? TODAY : d, buyer: `BUYER ${r.int(40)}`, channel: 'restaurant', species_key: r.pick(SP), form: 'fresh', grade: 'A', kg: 1 + r.int(5), amount_crc: 1000 * (1 + r.int(30)), lot_codes: null, notes: null, pay_status: r.chance(0.1) ? 'owed' : 'paid', paid_on: null, receipt_no: null })
  }
  const readings: Row[] = []
  for (let i = 0; i < nReadings; i++) readings.push({ id: `R${i}`, sensor_id: null, place: r.pick(['fruiting', 'incubation', 'lab', 'fridge']), taken_at: new Date(NOW - (nReadings - i) * 5 * 60000).toISOString(), temp_c: 15 + r.int(80) / 10, rh: 80 + r.int(15), co2_ppm: 500 + r.int(1000), source: 'feed', batch: null, who: null, note: null })
  await st.put('block_lots', lots, { label: 'SEED' })
  await st.put('harvests', picks, { label: 'SEED' })
  await st.put('sales', sales, { label: 'SEED' })
  await st.put('sensor_readings', readings, { label: 'SEED' })
  return { st, lots, picks, sales }
}

describe('stress: big farm', () => {
  it('10,000 lots, 60,000 picks, 5,000 sales, 100,000 readings: exact totals, quick answers', async () => {
    const { st, lots, picks, sales } = await bigFarm(10000, 60000, 5000, 100000)
    const c = ctxOf(st)
    const timed = async (q: string) => {
      const t0 = performance.now()
      const t = await ask(q, c, { engine: RULES })
      return { t, ms: performance.now() - t0 }
    }
    // this year: 2026-01-01 .. TODAY, blue oyster.
    const byId = new Map(lots.map((l) => [l.id, l]))
    const want = picks.filter((h) => String(h.harvested_on) >= '2026-01-01' && byId.get(String(h.block_lot_id))!.species_key === 'blue-oyster').reduce((n, h) => n + Number(h.kg), 0)
    const a = await timed('how much blue oyster did we pick this year')
    expect(text(a.t)).toContain(kg(want))
    const fr = lots.filter((l) => l.species_key === 'lions-mane' && l.status === 'fruiting')
    const b = await timed('how many LM lots are fruiting')
    expect(text(b.t)).toContain(`${fr.length.toLocaleString('en-US')} LOTS`)
    const owedCrc = sales.filter((s) => s.pay_status === 'owed').reduce((n, s) => n + Number(s.amount_crc), 0)
    const o = await timed('who owes money')
    expect(text(o.t)).toContain(`₡${owedCrc.toLocaleString('en-US')}`)
    const k = await timed('temperature in the fruiting room')
    expect(text(k.t)).toContain('FRUITING')
    const d = await timed(lots[4321].lot_code as string)
    expect(text(d.t)).toContain(`LOT ${lots[4321].lot_code}`)
    for (const x of [a, b, o, k, d]) expect(x.ms).toBeLessThan(3000)
  }, 60000)
})

describe('stress: random sentences never write, never throw, never use banned words', () => {
  const WORDS = ['how', 'many', 'log', 'kg', '4.2', 'from', 'B1020', 'L1013', 'power', 'out', 'back', 'who', 'owes', 'blue', 'oyster', 'lions', 'mane', 'fruiting', 'temp', '18c', '90%', 'mark', 'spent', 'paid', 'Soda', 'Tamara', 'received', 'used', 'soy', 'hulls', 'show', 'the', 'log', '?', 'yes', 'no', 'generator', 'stock', 'low', 'today', 'yesterday', 'flush', '2', 'grade', 'b', 'by', 'jm', 'weather', 'joke', '', '🍄', 'DROP TABLE', "'; --", '-5', '1e9', 'NaN']
  for (let seed = 1; seed <= SEEDS; seed++)
    it(`seed ${seed}: 1,500 sentences`, async () => {
      const r = rng(seed)
      const st = await farmStore()
      const before = counts(st)
      for (let i = 0; i < 1500; i++) {
        const n = 1 + r.int(9)
        const q = Array.from({ length: n }, () => r.pick(WORDS)).join(' ')
        const t = await ask(q, ctxOf(st, r.chance(0.3) ? 'staff' : 'owner'), { engine: RULES })
        expect(t.lines.length, q).toBeGreaterThan(0)
        const all = text(t).toLowerCase()
        for (const w of NEVER) expect(all.includes(` ${w.trim()} `), `${q} -> ${w}`).toBe(false)
      }
      expect(counts(st)).toBe(before)
    }, 60000)
})

describe('stress: rapid confirmed saves', () => {
  it('300 harvests in a row: exact count and kg, each its own history line, UNDO 40 deep', async () => {
    const st = await farmStore()
    const c = ctxOf(st)
    const r = rng(7)
    const n0 = st.rows('harvests').length
    let sum = 0
    for (let i = 0; i < 300; i++) {
      const k = Math.round((0.5 + r.next() * 5) * 100) / 100
      const t = await ask(`log ${k} kg from ${r.pick(['B1020', 'L1013', 'L1020'])}`, c, { engine: RULES })
      expect(t.planState, t.lines.join(' ')).toBe('pending')
      await confirmPlan(c, t.plan!)
      sum += k
    }
    const mine = st.rows<{ id: string; kg: number }>('harvests').slice(n0)
    expect(mine.length).toBe(300)
    expect(Math.round(mine.reduce((n, h) => n + h.kg, 0) * 100)).toBe(Math.round(sum * 100))
    await settle()
    await st.ensure(EDIT_LOG)
    expect(st.rows<EditEntry>(EDIT_LOG).filter((e) => e.via === 'assistant' && e.table_name === 'harvests').length).toBe(300)
    expect(st.undoList().length).toBe(Store.UNDO_DEPTH)
    for (let i = 0; i < Store.UNDO_DEPTH; i++) await st.undo()
    expect(st.rows('harvests').length).toBe(n0 + 300 - Store.UNDO_DEPTH)
  }, 60000)
  it('a slow model and a dead model: answers still come from the rules', async () => {
    const st = await farmStore()
    const slow: Fetcher = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 30)
    const t = await ask('who owes money', ctxOf(st), { engine: { ...DEFAULT_ENGINE, kind: 'ollama', mode: 'model_first' }, fetcher: slow, signal: ac.signal })
    expect(t.source).toBe('rules')
    expect(t.note).toContain('TOOK TOO LONG')
    const junk: Fetcher = async () => ({ ok: true, status: 200, json: async () => ({ nonsense: true }) })
    const j = await ask('tell me about B1020', ctxOf(st), { engine: { ...DEFAULT_ENGINE, kind: 'openai', mode: 'model_first' }, fetcher: junk })
    expect(j.source).toBe('rules')
  })
})

describe('history: two years of back data stay right', () => {
  it('old periods, retired strains and edited records keep their answers after new saves and a backup round trip', async () => {
    const old: Record<string, Row[]> = {
      strains: [...FARM.strains, { id: 's-old', species_key: 'blue-oyster', code: 'BO-00', name: 'Old blue', source: null, active: false, notes: 'RETIRED 2025' }],
      block_lots: [...FARM.block_lots, { id: 'l-old', lot_code: 'B0110', species_key: 'blue-oyster', strain_id: 's-old', grain_run_id: null, g2_bags_used: null, bag_count: 30, knock_date: '2024-01-10', status: 'spent', notes: null }],
      harvests: [...FARM.harvests, { id: 'h-old1', block_lot_id: 'l-old', harvested_on: '2024-02-01', flush: 1, kg: 10.5, grade: 'A', initials: 'AB', notes: null }, { id: 'h-old2', block_lot_id: 'l-old', harvested_on: '2024-02-20', flush: 2, kg: 4.25, grade: 'B', initials: 'AB', notes: null }],
    }
    const st = await farmStore(old)
    const c = ctxOf(st)
    const q = async (s: string) => text(await ask(s, c, { engine: RULES }))
    const before = { lot: await q('B0110'), strain: await q('BO-00'), all: await q('how much blue oyster was picked in total'), year: await q('how much blue oyster did we pick this year') }
    expect(before.lot).toContain('14.75 KG IN 2 FLUSHES')
    expect(before.strain).toContain('RETIRED')
    expect(before.all).toContain(kg(4 + 3.5 + 14.75))
    expect(before.year).toContain(kg(7.5))
    // an old pick edited (typo fixed), then new saves today
    await st.action('FIX', () => st.put('harvests', { id: 'h-old2', kg: 4.5 }))
    for (const s of ['log 2 kg from B1020', 'power is out', 'fruiting 19c 90%']) {
      const t = await ask(s, c, { engine: RULES })
      await confirmPlan(c, t.plan!)
    }
    expect(await q('B0110')).toContain('15.00 KG IN 2 FLUSHES')
    expect(await q('how much blue oyster did we pick this year')).toContain(kg(9.5))
    expect(await q('how much blue oyster was picked in total')).toContain(kg(4 + 3.5 + 2 + 15))
    // backup round trip into an empty store gives the same answers
    const json = await st.exportJson()
    const st2 = new Store(new MemoryBackend())
    await st2.importJson(json)
    const c2 = ctxOf(st2)
    for (const s of ['B0110', 'BO-00', 'how much blue oyster was picked in total', 'who owes money', 'is the power out?']) expect(text(await ask(s, c2, { engine: RULES }))).toBe(text(await ask(s, c, { engine: RULES })))
  })
})
