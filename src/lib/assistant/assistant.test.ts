// G10 farm assistant: mock trials of every tool against hand-worked answers, saves going through
// CONFIRM -> store.action (UNDO + edit history), staff money refusals, the local-model link with a
// pretend model, and the refusal voice. Stress tests are in assistant.stress.test.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, Store } from '../store'
import type { EditEntry } from '../history'
import { STAFF_DENIED_TABLES, staffHideRow } from '../roles'
import { ask, askRules, confirmPlan, isNo, isYes, knownFor, systemPrompt, type Turn } from './ask'
import { parse } from './rules'
import { TOOLS, runTool, toolsFor, findItem, findSection } from './tools'
import { DEFAULT_ENGINE, addressProblem, callsFromText, chat, normEngine, toolSchema, type EngineCfg, type Fetcher } from './llm'
import { NEVER, REFUSALS, refusal } from './refusals'
import { findSpecies, periodRange, resolvePlace, resolveSpecies } from './core'
import { FARM, NOW, TEST_QUESTIONS, TODAY, farmStore } from './fixture'
import type { AskCtx } from './core'

Store.GROUP_MS = 0
const settle = () => new Promise((r) => setTimeout(r, 0))
const ctxOf = (store: Store, role: 'owner' | 'staff' = 'owner', initials = 'JM'): AskCtx => ({ store, role, now: NOW, today: TODAY, initials })
const RULES: EngineCfg = { ...DEFAULT_ENGINE, kind: 'off' }
const text = (t: Turn) => [...t.lines, ...(t.plan?.lines ?? [])].join('\n')
async function staffStore() {
  const st = await farmStore()
  st.setAccess(STAFF_DENIED_TABLES, staffHideRow)
  return st
}

describe('words', () => {
  it('reads species however they are written', () => {
    expect(resolveSpecies('LM')).toBe('lions-mane')
    expect(resolveSpecies("Lion's Mane")).toBe('lions-mane')
    expect(resolveSpecies('lions mane')).toBe('lions-mane')
    expect(resolveSpecies('blue')).toBe('blue-oyster')
    expect(resolveSpecies('golden oyster')).toBe('golden-oyster')
    expect(resolveSpecies('oyster')).toBeNull()
    expect(resolveSpecies('go')).toBeNull()
    expect(findSpecies('log 4.2 kg blue oyster from B1020')?.key).toBe('blue-oyster')
    expect(findSpecies('how many LM blocks are fruiting')?.key).toBe('lions-mane')
    expect(findSpecies('go to the board')).toBeNull()
  })
  it('reads places and periods', () => {
    expect(resolvePlace('culture fridge')).toBe('fridge')
    expect(resolvePlace('the fruiting room')).toBe('fruiting')
    expect(periodRange('this_week', TODAY)).toMatchObject({ from: '2026-11-02', to: '2026-11-06' })
    expect(periodRange('last_week', TODAY)).toMatchObject({ from: '2026-10-26', to: '2026-11-01' })
    expect(periodRange('last_month', TODAY)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(periodRange('last_month', '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
  })
  it('finds stock items and sections', () => {
    const items = FARM.items as never
    expect(findItem(items, 'soy hulls')?.id).toBe('i1')
    expect(findItem(items, 'filter bags')?.id).toBe('i2')
    expect(findItem(items, 'bananas')).toBeNull()
    expect(findSection('the power-cut log')?.id).toBe('power_cuts')
    expect(findSection('harvest log')?.id).toBe('harvest_log')
  })
})

describe('rule parser: sentences to tools', () => {
  const known = { lots: ['B1020', 'B1027', 'L1013'], strains: ['LM-01', 'BO-01'], buyers: ['Soda Tamara', 'Chef Luis'], items: ['Soy hulls', 'Filter patch bags'] }
  const cases: [string, string, Record<string, unknown>?][] = [
    ['how many LM blocks are fruiting', 'count_lots', { species: 'lions-mane', status: 'fruiting' }],
    ['How many blocks are incubating?', 'count_lots', { status: 'incubating' }],
    ['count lots', 'count_lots', { status: 'active' }],
    ['who owes money', 'who_owes'],
    ["who hasn't paid", 'who_owes'],
    ['show the power-cut log', 'open_screen', { section: 'power_cuts' }],
    ['open the harvest log', 'open_screen', { section: 'harvest_log' }],
    ['log 4.2 kg blue oyster from B1020', 'log_harvest', { kg: 4.2, lot: 'B1020' }],
    ['picked 3 kg from b1020 flush 2 grade b by jm', 'log_harvest', { kg: 3, lot: 'B1020', flush: 2, grade: 'b', initials: 'jm' }],
    ['log 2.5kg lions mane', 'log_harvest', { kg: 2.5, species: 'lions-mane' }],
    ['B1020 6 lb', 'log_harvest', { lb: 6, lot: 'B1020' }],
    ['power is out', 'log_power', { event: 'out' }],
    ['the power went out', 'log_power', { event: 'out' }],
    ['power is back', 'log_power', { event: 'back' }],
    ['generator on', 'log_power', { event: 'generator_on' }],
    ['is the power out?', 'power_cuts'],
    ['how many hours without power this month', 'power_cuts', { period: 'this_month' }],
    ['fruiting 18.5c 92%', 'log_reading', { room: 'fruiting', temp_c: 18.5, rh: 92 }],
    ['log reading culture fridge temp 2', 'log_reading', { room: 'fridge', temp_c: 2 }],
    ['incubation co2 1200 ppm', 'log_reading', { room: 'incubation', co2_ppm: 1200 }],
    ["what's the temperature in the fruiting room", 'climate_now', { room: 'fruiting' }],
    ['any alarms?', 'climate_now'],
    ['mark B1020 spent', 'set_lot_status', { lot: 'B1020', status: 'spent' }],
    ['move B1027 to fruiting', 'set_lot_status', { lot: 'B1027', status: 'fruiting' }],
    ['Soda Tamara paid', 'mark_paid', { buyer: 'Soda Tamara' }],
    ['mark chef luis paid yesterday', 'mark_paid', { buyer: 'Chef Luis', day: 'yesterday' }],
    ['received 10 sacks of soy hulls', 'stock_move', { item: 'Soy hulls', qty: 10, direction: 'in' }],
    ['used 40 filter patch bags', 'stock_move', { item: 'Filter patch bags', qty: 40, direction: 'out' }],
    ['how much soy hulls do we have left', 'stock_status', { item: 'Soy hulls' }],
    ['what is low in stock', 'stock_status'],
    ['how much blue oyster did we pick this week', 'harvest_total', { species: 'blue-oyster', period: 'this_week' }],
    ['kg picked last month', 'harvest_total', { period: 'last_month' }],
    ['what is due today', 'due_today'],
    ['B1020', 'lot_details', { lot: 'B1020' }],
    ['LM-01', 'strain_status', { strain: 'LM-01' }],
    ['what temperature does lions mane fruit at', 'species_facts', { species: 'lions-mane', topic: 'climate' }],
    ['how long does shiitake take', 'species_facts', { species: 'shiitake', topic: 'timeline' }],
    ['sales this month', 'sales_total', { period: 'this_month' }],
  ]
  for (const [q, tool, args] of cases)
    it(q, () => {
      const p = parse(q, known)
      expect(p?.tool).toBe(tool)
      if (args) expect(p?.args).toMatchObject(args)
    })
  it('does not place things that are not about the farm', () => {
    for (const q of ['what is the weather tomorrow', 'tell me a joke', 'who is the president of france', 'write me a poem', 'asdf qwer']) expect(parse(q, known)).toBeNull()
  })
})

describe('mock trial: every read tool against hand-worked answers', () => {
  for (const t of TEST_QUESTIONS)
    it(t.q, async () => {
      const st = await farmStore()
      const turn = await ask(t.q, ctxOf(st), { engine: RULES })
      expect(turn.tool).toBe(t.tool)
      for (const e of t.expect) expect(text(turn)).toContain(e)
      expect(turn.cite.length).toBeGreaterThan(0)
    })
  it('lot details: lost blocks, BE and days', async () => {
    const t = await ask('L1013', ctxOf(await farmStore()), { engine: RULES })
    // 16 knocked, 2 lost -> 14 alive. 3.2 kg picked. Dry 4 lb = 1.814 kg per block: 3.2 / (14 x 1.814) = 12.6%.
    expect(text(t)).toContain('14 BLOCKS ALIVE OF 16, 2 LOST')
    expect(text(t)).toContain('3.20 KG')
    expect(text(t)).toContain('BE 12.6%')
    expect(text(t)).toContain('DAY 24')
  })
  it('harvest totals by period and lot', async () => {
    const st = await farmStore()
    const c = ctxOf(st)
    expect(text(await ask('kg picked last week', c, { engine: RULES }))).toContain('1.00 KG IN 1 PICK')
    expect(text(await ask('how much has B1020 picked', c, { engine: RULES }))).toContain('7.50 KG IN 2 PICKS')
    expect(text(await ask('how much lions mane was harvested this year', c, { engine: RULES }))).toContain('6.20 KG IN 3 PICKS')
  })
  it('counts every lion\'s mane lot ever', async () => {
    const t = await ask('how many lions mane lots in total', ctxOf(await farmStore()), { engine: RULES })
    // all lots: L1013 16 knocked, L1020 16, L0901 16 = 3 lots; alive count for active, bag_count for spent.
    expect(text(t)).toContain('3 LOTS')
  })
  it('strain, stock item, species file', async () => {
    const c = ctxOf(await farmStore())
    const s = await ask('LM-01', c, { engine: RULES })
    expect(text(s)).toContain('1 SLANT, 1 WATER TUBE')
    const i = await ask('how much soy hulls do we have left', c, { engine: RULES })
    expect(text(i)).toContain('SOY HULLS: 3 SACK ON HAND // LOW // ABOUT 1.0 WEEKS LEFT')
    const f = await ask('what temperature does lions mane fruit at', c, { engine: RULES })
    expect(f.tool).toBe('species_facts')
    expect(text(f)).toContain("LION'S MANE // CLIMATE")
    expect(f.cite[0].go).toMatchObject({ screen: 'SPECIMEN', id: 'lions-mane' })
  })
  it('opens a section', async () => {
    const t = await ask('show the power-cut log', ctxOf(await farmStore()), { engine: RULES })
    expect(t.open).toEqual({ screen: 'FACILITY', tab: 'POWER CUTS' })
  })
  it('due today lists the move window and low stock', async () => {
    const t = await ask('what is due today', ctxOf(await farmStore()), { engine: RULES })
    expect(text(t)).toContain('DUE TODAY')
    expect(text(t)).toContain('SOY HULLS')
  })
})

describe('saves: plan, confirm, undo, history', () => {
  it('logs a harvest only after CONFIRM, as one UNDO step marked ASSISTANT', async () => {
    const st = await farmStore()
    const c = ctxOf(st)
    const before = st.rows('harvests').length
    const t = await ask('log 4.2 kg blue oyster from B1020', c, { engine: RULES })
    expect(t.planState).toBe('pending')
    expect(t.plan?.lines.join(' ')).toContain('4.20 KG // FLUSH 2 // GRADE A // BY JM // TODAY 2026-11-06')
    expect(st.rows('harvests').length).toBe(before) // nothing written yet
    const out = await confirmPlan(c, t.plan!)
    expect(out).toContain('HARVEST SAVED // B1020 FLUSH 2')
    const h = st.rows<{ id: string; block_lot_id: string; kg: number; flush: number }>('harvests').filter((x) => x.block_lot_id === 'l1')
    expect(h.map((x) => x.kg).sort()).toEqual([3.5, 4, 4.2])
    expect(st.undoPeek()?.label).toBe('ASSISTANT: HARVEST B1020 4.20 KG')
    await settle()
    await st.ensure(EDIT_LOG)
    const log = st.rows<EditEntry>(EDIT_LOG).filter((e) => e.label.startsWith('ASSISTANT'))
    expect(log.length).toBe(1)
    expect(log[0].via).toBe('assistant')
    expect(log[0].op).toBe('create')
    await st.undo()
    expect(st.rows('harvests').length).toBe(before)
  })
  it('a pick on an incubating lot also moves it to fruiting, and UNDO puts both back', async () => {
    const st = await farmStore()
    const c = ctxOf(st)
    const t = await ask('log 1 kg from B1027', c, { engine: RULES })
    expect(t.plan?.lines.join(' ')).toContain('MARKED FRUITING TOO')
    await confirmPlan(c, t.plan!)
    expect(st.rows<{ id: string; status: string }>('block_lots').find((l) => l.id === 'l2')?.status).toBe('fruiting')
    await st.undo()
    expect(st.rows<{ id: string; status: string }>('block_lots').find((l) => l.id === 'l2')?.status).toBe('incubating')
  })
  it('asks which lot when a species has several fruiting lots', async () => {
    const t = await ask('log 2 kg lions mane', ctxOf(await farmStore()), { engine: RULES })
    expect(t.plan).toBeUndefined()
    expect(text(t)).toContain('WHICH LOT? L1013, L1020')
  })
  it('asks for initials when the device has none', async () => {
    const t = await ask('log 2 kg from B1020', ctxOf(await farmStore(), 'owner', ''), { engine: RULES })
    expect(text(t)).toContain('WHO PICKED IT?')
    const t2 = await ask('log 2 kg from B1020 by ab', ctxOf(await farmStore(), 'owner', ''), { engine: RULES })
    expect(t2.plan?.lines.join(' ')).toContain('BY AB')
  })
  it('refuses bad numbers and unknown lots', async () => {
    const c = ctxOf(await farmStore())
    expect(text(await ask('log 0 kg from B1020', c, { engine: RULES }))).toContain('HOW MANY KG')
    expect(text(await ask('log 900 kg from B1020', c, { engine: RULES }))).toContain('NOT LIKELY')
    expect(text(await ask('log 2 kg from Z9999', c, { engine: RULES }))).toContain('NO LOT Z9999')
    expect(text(await ask('log 2 kg from L0901', c, { engine: RULES }))).toContain('MARKED SPENT')
  })
  it('turns pounds into kg', async () => {
    const t = await ask('log 6 lb from B1020', ctxOf(await farmStore()), { engine: RULES })
    expect(t.plan?.lines.join(' ')).toContain('2.72 KG')
  })
  it('power out then back: a cut with the right length', async () => {
    const st = await farmStore()
    const t = await ask('power is out', ctxOf(st), { engine: RULES })
    await confirmPlan({ store: st }, t.plan!)
    const open = st.rows<{ id: string; up_at: string | null; kind: string }>('power_cuts').filter((c) => c.kind === 'cut' && c.up_at === null)
    expect(open.length).toBe(1)
    const again = await ask('power is out', ctxOf(st), { engine: RULES })
    expect(text(again)).toContain('ALREADY OPEN')
    const later = { ...ctxOf(st), now: NOW + 95 * 60000 }
    const back = await ask('power is back', later, { engine: RULES })
    expect(text(back)).toContain('1 H 35 MIN')
    await confirmPlan({ store: st }, back.plan!)
    expect(st.rows<{ id: string; up_at: string | null; kind: string }>('power_cuts').filter((c) => c.kind === 'cut' && c.up_at === null).length).toBe(0)
  })
  it('hand reading, lot status, stock in, buyer paid', async () => {
    const st = await farmStore()
    const c = ctxOf(st)
    const r = await ask('fruiting 18.5c 92%', c, { engine: RULES })
    await confirmPlan(c, r.plan!)
    expect(st.rows<{ id: string; place: string; temp_c: number; rh: number }>('sensor_readings').some((x) => x.place === 'fruiting' && x.temp_c === 18.5 && x.rh === 92)).toBe(true)
    const bad = await ask('fruiting 99c', c, { engine: RULES })
    expect(text(bad)).toContain('OUTSIDE WHAT A SENSOR CAN READ')
    const s = await ask('mark B1020 spent', c, { engine: RULES })
    await confirmPlan(c, s.plan!)
    expect(st.rows<{ id: string; status: string }>('block_lots').find((l) => l.id === 'l1')?.status).toBe('spent')
    const k = await ask('received 10 sacks of soy hulls', c, { engine: RULES })
    expect(k.plan?.lines.join(' ')).toContain('ON HAND 3 -> 13 SACK')
    await confirmPlan(c, k.plan!)
    const p = await ask('Soda Tamara paid', c, { engine: RULES })
    expect(p.plan?.lines.join(' ')).toContain('2 SALES // ₡20,000')
    await confirmPlan(c, p.plan!)
    const owe = await ask('who owes money', c, { engine: RULES })
    expect(text(owe)).toContain('₡5,000')
    expect(text(owe)).not.toContain('TAMARA')
    // Four saves, four undo steps, each its own history label.
    expect(st.undoList().slice(0, 4).map((u) => u.label)).toEqual(['ASSISTANT: SODA TAMARA PAID ₡20,000', 'ASSISTANT: STOCK IN SOY HULLS', 'ASSISTANT: B1020 SPENT', 'ASSISTANT: READING FRUITING'])
    for (let i = 0; i < 4; i++) await st.undo()
    expect(st.rows<{ id: string; status: string }>('block_lots').find((l) => l.id === 'l1')?.status).toBe('fruiting')
    expect(text(await ask('who owes money', c, { engine: RULES }))).toContain('₡25,000')
  })
  it('yes and no words', () => {
    for (const y of ['yes', 'Y', 'ok', 'confirm', 'sí', 'si']) expect(isYes(y)).toBe(true)
    for (const n of ['no', 'N', 'cancel', 'nope']) expect(isNo(n)).toBe(true)
    expect(isYes('yesterday')).toBe(false)
  })
})

describe('staff never see money through the assistant', () => {
  it('money questions get a money refusal, not an empty answer', async () => {
    const st = await staffStore()
    const c = ctxOf(st, 'staff')
    for (const q of ['who owes money', 'sales this month', 'Soda Tamara paid', 'show money owed', 'open profit and loss']) {
      const t = await ask(q, c, { engine: RULES })
      expect(t.source, q).toBe('refusal')
      expect(REFUSALS.money).toContain(t.lines[0])
      expect(text(t)).not.toMatch(/₡|TAMARA|LUIS/)
    }
  })
  it('the tool list for staff has no money tool, and runTool refuses one', async () => {
    const names = toolsFor('staff').map((t) => t.name)
    expect(names).not.toContain('who_owes')
    expect(names).not.toContain('sales_total')
    expect(names).not.toContain('mark_paid')
    const out = await runTool(ctxOf(await staffStore(), 'staff'), 'who_owes', {})
    expect(out?.kind).toBe('denied')
  })
  it('staff still get the farm work', async () => {
    const c = ctxOf(await staffStore(), 'staff')
    expect(text(await ask('how many LM blocks are fruiting', c, { engine: RULES }))).toContain('30 BLOCKS')
    const t = await ask('log 1.5 kg from L1020', c, { engine: RULES })
    await confirmPlan(c, t.plan!)
    expect(c.store.rows('harvests').some((h) => h.block_lot_id === 'l4')).toBe(true)
  })
  it('buyer names never reach the staff word list', async () => {
    const k = await knownFor(ctxOf(await staffStore(), 'staff'))
    expect(k.buyers).toEqual([])
  })
  it('the model prompt tells staff money is closed', async () => {
    expect(systemPrompt(ctxOf(await staffStore(), 'staff'))).toContain('STAFF')
  })
})

// ---------- a pretend local model ----------

type Script = (body: { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] }) => unknown
function fakeOllama(script: Script, calls: unknown[] = []): Fetcher {
  return async (url, init) => {
    const body = JSON.parse(init.body ?? '{}')
    calls.push({ url, body })
    return { ok: true, status: 200, json: async () => script(body) }
  }
}
const ollama = (tool: string, args: Record<string, unknown>) => ({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: tool, arguments: args } }] } })
const say = (content: string) => ({ message: { role: 'assistant', content } })
const MODEL: EngineCfg = { ...DEFAULT_ENGINE, kind: 'ollama', mode: 'model_first' }

describe('local model link (pretend model)', () => {
  it('calls a tool, reads the result, answers; the record lines stay underneath', async () => {
    const sent: unknown[] = []
    const f = fakeOllama((b) => (b.messages.some((m) => m.role === 'tool') ? say('You have 30 lion\'s mane blocks fruiting in 2 lots.') : ollama('count_lots', { species: "lion's mane", status: 'fruiting' })), sent)
    const t = await ask('lion mane fruiting count pls', ctxOf(await farmStore()), { engine: MODEL, fetcher: f })
    expect(t.source).toBe('model')
    expect(t.lines[0]).toBe("YOU HAVE 30 LION'S MANE BLOCKS FRUITING IN 2 LOTS.")
    expect(t.facts?.join(' ')).toContain('2 LOTS, 30 BLOCKS')
    expect(t.cite[0].label).toBe('MISSION CONTROL > BOARD')
    expect((sent[0] as { url: string }).url).toBe('http://localhost:11434/api/chat')
  })
  it('an answer with no tool call is not trusted', async () => {
    const t = await ask('gimme the count thingy', ctxOf(await farmStore()), { engine: MODEL, fetcher: fakeOllama(() => say('You have 1,000 blocks.')) })
    expect(t.source).toBe('refusal')
    expect(text(t)).not.toContain('1,000')
    expect(t.note).toContain('WITHOUT READING THE RECORDS')
    // the same with a sentence the rules know: the rules answer instead
    const r = await ask('how many blocks', ctxOf(await farmStore()), { engine: MODEL, fetcher: fakeOllama(() => say('You have 1,000 blocks.')) })
    expect(r.source).toBe('rules')
    expect(text(r)).not.toContain('1,000')
  })
  it('OUT_OF_SCOPE becomes a station refusal', async () => {
    const t = await ask('what is the capital of peru', ctxOf(await farmStore()), { engine: MODEL, fetcher: fakeOllama(() => say('OUT_OF_SCOPE')) })
    expect(t.source).toBe('refusal')
    expect(REFUSALS.scope).toContain(t.lines[0])
  })
  it('a save from the model is a plan, never written', async () => {
    const st = await farmStore()
    const n = st.rows('harvests').length
    const t = await ask('put down four point two kilos for b1020', ctxOf(st), { engine: MODEL, fetcher: fakeOllama(() => ollama('log_harvest', { lot: 'b1020', kg: 4.2 })) })
    expect(t.planState).toBe('pending')
    expect(st.rows('harvests').length).toBe(n)
  })
  it('staff: the model is not given money tools, and a forced money call is refused', async () => {
    const sent: { body: { tools: { function: { name: string } }[] } }[] = []
    const t = await ask('who owes us', ctxOf(await staffStore(), 'staff'), { engine: MODEL, fetcher: fakeOllama(() => ollama('who_owes', {}), sent as unknown[]) })
    expect(sent[0].body.tools.map((x) => x.function.name)).not.toContain('who_owes')
    expect(t.source).toBe('refusal')
    expect(REFUSALS.money.concat(REFUSALS.unclear, REFUSALS.scope)).toContain(t.lines[0])
  })
  it('model down: rules answer with a note', async () => {
    const down: Fetcher = async () => {
      throw new TypeError('Failed to fetch')
    }
    const t = await ask('who owes money', ctxOf(await farmStore()), { engine: MODEL, fetcher: down })
    expect(t.source).toBe('rules')
    expect(t.note).toContain('CANNOT BE REACHED')
    expect(REFUSALS.engine.some((l) => t.note!.startsWith(l))).toBe(true)
    expect(text(t)).toContain('₡25,000')
  })
  it('rules first: a sentence the rules know never reaches the model', async () => {
    const sent: unknown[] = []
    const t = await ask('who owes money', ctxOf(await farmStore()), { engine: { ...MODEL, mode: 'rules_first' }, fetcher: fakeOllama(() => say('x'), sent) })
    expect(t.source).toBe('rules')
    expect(sent.length).toBe(0)
  })
  it('reads a tool call written as text by a small model', () => {
    const names = new Set(TOOLS.map((t) => t.name))
    expect(callsFromText('<tool_call>{"name": "who_owes", "arguments": {}}</tool_call>', names)).toEqual([{ id: 't0', name: 'who_owes', args: {} }])
    expect(callsFromText('{"name": "rm_rf", "arguments": {}}', names)).toEqual([])
  })
  it('speaks the OpenAI shape for llama-server and LM Studio', async () => {
    const sent: { url: string; body: { messages: unknown[] } }[] = []
    let n = 0
    const f: Fetcher = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body ?? '{}') })
      n++
      const msg = n === 1 ? { content: null, tool_calls: [{ id: 'a1', type: 'function', function: { name: 'power_cuts', arguments: '{"period":"this_month"}' } }] } : { content: 'Power is on. 3.5 hours without grid this month.' }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: msg }] }) }
    }
    const t = await ask('power?', ctxOf(await farmStore()), { engine: { ...MODEL, kind: 'openai', url: 'http://localhost:8080' }, fetcher: f })
    expect(sent[0].url).toBe('http://localhost:8080/v1/chat/completions')
    expect(JSON.stringify(sent[1].body.messages)).toContain('"tool_call_id":"a1"')
    expect(t.lines[0]).toContain('3.5 HOURS')
    expect(t.facts?.join(' ')).toContain('3.5 H WITHOUT GRID POWER')
  })
  it('errors are plain sentences', async () => {
    const f: Fetcher = async () => ({ ok: false, status: 404, json: async () => ({}) })
    await expect(chat(MODEL, [], TOOLS, f)).rejects.toThrow('IS THE MODEL NAME RIGHT?')
  })
  it('the tool list is valid JSON schema', () => {
    const s = toolSchema(TOOLS)
    expect(s.length).toBe(TOOLS.length)
    for (const t of s) {
      expect(t.function.parameters.type).toBe('object')
      for (const r of t.function.parameters.required) expect(Object.keys(t.function.parameters.properties)).toContain(r)
    }
  })
  it('blocks addresses the browser would refuse', () => {
    expect(addressProblem({ ...MODEL, url: 'http://192.168.1.20:11434' }, 'https:')).toContain('HTTPS')
    expect(addressProblem({ ...MODEL, url: 'http://localhost:11434' }, 'https:')).toBeNull()
    expect(addressProblem({ ...MODEL, url: 'http://192.168.1.20:11434' }, 'http:')).toBeNull()
    expect(addressProblem({ ...MODEL, url: 'not a url' }, 'http:')).toContain('NOT A WEB ADDRESS')
  })
  it('settings are cleaned', () => {
    expect(normEngine({ kind: 'cloud', url: ' http://x:1/ ', timeoutSec: 2 })).toMatchObject({ kind: 'off', url: 'http://x:1', timeoutSec: 60 })
  })
})

describe('refusals', () => {
  it('rotate and never repeat back to back', () => {
    const a = refusal('scope')
    const b = refusal('scope')
    expect(a).not.toBe(b)
  })
  it('are original: no film or game names or lines anywhere in the assistant', () => {
    const dir = join(__dirname)
    const src = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'refusals.ts').map((f) => readFileSync(join(dir, f), 'utf8')).join('\n').toLowerCase()
    const lines = Object.values(REFUSALS).flat().join('\n').toLowerCase()
    for (const w of NEVER) {
      const r = new RegExp(`(^|[^a-z])${w.trim().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z]|$)`)
      expect(lines, w).not.toMatch(r)
      expect(src, w).not.toMatch(r)
    }
  })
  it('every refusal is followed by what can be asked', async () => {
    const t = await ask('tell me a joke', ctxOf(await farmStore()), { engine: RULES })
    expect(t.source).toBe('refusal')
    expect(t.lines[1]).toMatch(/ASK|TRY/)
  })
})

describe('rules alone', () => {
  it('askRules returns null for a sentence it cannot place', async () => {
    expect(await askRules('flibber the jibber', ctxOf(await farmStore()))).toBeNull()
  })
})
