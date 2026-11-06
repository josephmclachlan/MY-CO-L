// FARM ASSISTANT: one question in, one answer out.
//
//   rules brain (rules.ts) ---> one tool call --+
//                                               +--> tools.ts reads the Store --> answer + where it came from
//   local model (llm.ts) ---> tool calls -------+                            \-> PLAN (save) -> CONFIRM -> store.action
//
// The model is optional and LOCAL. When it is off, unreachable or slow, the rules answer. Anything that
// neither can place gets an original station-voice refusal plus a plain line on what can be asked.
// A model that answers without reading a tool is not trusted: its words are dropped for a refusal.

import { SPECIES } from '../../data/species'
import { canSeeMoney } from '../roles'
import type { BlockLot, Strain } from '../xeno'
import type { Sale } from '../trade'
import type { Item } from '../cargo'
import { uuid } from '../store'
import type { Args, AskCtx, Cite, Go, Plan, ToolOut } from './core'
import { parse, type Known } from './rules'
import { runTool, toolsFor } from './tools'
import { EngineError, chat, engineOn, type EngineCfg, type Fetcher, type Msg } from './llm'
import { CAN_ASK, kindFor, refusal, type RefusalKind } from './refusals'

export type Source = 'rules' | 'model' | 'refusal'
export type PlanState = 'pending' | 'saved' | 'cancelled' | 'failed'

export interface Turn {
  id: string
  q: string
  at: number
  source: Source
  /** The answer, line by line. */
  lines: string[]
  /** Under a model answer: the record lines the tools returned, so the words can be checked. */
  facts?: string[]
  cite: Cite[]
  /** A save waiting for CONFIRM (or done). */
  plan?: Plan
  planState?: PlanState
  result?: string
  /** A screen to open straight away. */
  open?: Go
  warn?: boolean
  /** A short note above the answer: the model was dark, so the rules answered. */
  note?: string
  /** The tool that answered, for tests and the history label. */
  tool?: string
  sec?: number
}

const newTurn = (q: string, ctx: AskCtx, p: Partial<Turn>): Turn => ({ id: uuid(), q, at: ctx.now, source: 'rules', lines: [], cite: [], ...p })

export function refuse(q: string, ctx: AskCtx, kind: RefusalKind, note?: string): Turn {
  return newTurn(q, ctx, { source: 'refusal', lines: [refusal(kind), CAN_ASK[kind]], warn: true, note })
}

/** The codes and names on file that the rules look for. STAFF gets no buyer names. */
export async function knownFor(ctx: AskCtx): Promise<Known> {
  const s = ctx.store
  await Promise.all(['block_lots', 'strains', 'items', ...(canSeeMoney(ctx.role) ? ['sales'] : [])].map((t) => s.ensure(t)))
  const buyers = canSeeMoney(ctx.role) ? [...new Set(s.rows<Sale>('sales').map((x) => (x.buyer ?? '').trim()).filter(Boolean))] : []
  return {
    lots: s.rows<BlockLot>('block_lots').map((l) => l.lot_code),
    strains: s.rows<Strain>('strains').map((x) => x.code),
    buyers,
    items: s.rows<Item>('items').map((i) => i.name),
  }
}

function fromOut(q: string, ctx: AskCtx, tool: string, out: ToolOut, source: Source): Turn {
  switch (out.kind) {
    case 'answer':
      return newTurn(q, ctx, { source, tool, lines: out.lines, cite: out.cite })
    case 'ask':
      return newTurn(q, ctx, { source, tool, lines: out.lines, cite: out.cite, warn: true })
    case 'open':
      return newTurn(q, ctx, { source, tool, lines: out.lines, cite: out.cite, open: out.go })
    case 'plan':
      return newTurn(q, ctx, { source, tool, lines: ['CHECK THIS, THEN PRESS CONFIRM TO SAVE IT. NOTHING IS SAVED YET.'], cite: out.plan.cite, plan: out.plan, planState: 'pending' })
    case 'denied':
      return { ...refuse(q, ctx, 'money'), tool }
  }
}

/** The rules brain alone. null = it could not place the sentence. */
export async function askRules(q: string, ctx: AskCtx, known?: Known): Promise<Turn | null> {
  const p = parse(q, known ?? (await knownFor(ctx)))
  if (!p) return null
  const out = await runTool(ctx, p.tool, p.args)
  return out ? fromOut(q, ctx, p.tool, out, 'rules') : null
}

export function systemPrompt(ctx: AskCtx): string {
  return [
    'You are the terminal assistant of ONE small mushroom farm (Playa Negra, Costa Rica). Money is in colones.',
    'RULES:',
    '1. You know NOTHING except what the tools return. Never use outside knowledge, never guess numbers.',
    '2. Always call a tool first. Pick the single best tool. Lot codes look like B1020, strain codes like LM-01.',
    '3. To save something (a harvest, a power cut, a reading, stock, a lot status, a payment), call that tool once. The app shows it to the person to confirm; never say it is saved.',
    '4. If no tool fits the question, or it is not about this farm, reply only: OUT_OF_SCOPE',
    '5. Answer in one to three short plain sentences, with units, using only the tool results.',
    `Today on the farm is ${ctx.today}. Species: ${SPECIES.map((s) => s.name.toLowerCase()).join(', ')}.`,
    canSeeMoney(ctx.role) ? '' : 'This person is STAFF: there are no money tools. For money questions reply only: OUT_OF_SCOPE',
  ].filter(Boolean).join('\n')
}

/** The local model with the tools. Throws EngineError when it cannot be used. */
export async function askModel(q: string, ctx: AskCtx, cfg: EngineCfg, fetcher: Fetcher, signal?: AbortSignal): Promise<Turn> {
  const tools = toolsFor(ctx.role)
  const msgs: Msg[] = [{ role: 'system', content: systemPrompt(ctx) }, { role: 'user', content: q }]
  const facts: string[] = []
  const cite: Cite[] = []
  let sec = 0
  let used: string | undefined
  for (let step = 0; step < 4; step++) {
    const r = await chat(cfg, msgs, tools, fetcher, signal)
    sec += r.sec
    if (!r.calls.length) {
      const text = r.text.replace(/\s+/g, ' ').trim()
      if (/OUT_OF_SCOPE/i.test(text)) return { ...refuse(q, ctx, used ? 'unclear' : 'scope'), sec }
      // No tool read, or nothing said: the words cannot be trusted. The rules get a go instead.
      if (!used) throw new EngineError(text ? 'THE MODEL ANSWERED WITHOUT READING THE RECORDS.' : 'THE MODEL SENT AN EMPTY ANSWER.', false)
      if (!text) return newTurn(q, ctx, { source: 'model', tool: used, lines: facts, cite: dedupe(cite), sec })
      return newTurn(q, ctx, { source: 'model', tool: used, lines: [text.toUpperCase().slice(0, 600)], facts, cite: dedupe(cite), sec })
    }
    msgs.push({ role: 'assistant', content: '', tool_calls: r.calls })
    for (const c of r.calls.slice(0, 3)) {
      const out = await runTool(ctx, c.name, c.args as Args)
      used = c.name
      if (!out) continue
      if (out.kind === 'plan' || out.kind === 'open' || out.kind === 'denied' || out.kind === 'ask') return { ...fromOut(q, ctx, c.name, out, 'model'), sec }
      facts.push(...out.lines)
      cite.push(...out.cite)
      msgs.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: out.lines.join('\n') })
    }
  }
  // The model kept calling tools: show what they found.
  if (facts.length) return newTurn(q, ctx, { source: 'model', tool: used, lines: facts, cite: dedupe(cite), sec })
  throw new EngineError('THE MODEL DID NOT FINISH.', false)
}

const dedupe = (c: Cite[]) => c.filter((x, i) => c.findIndex((y) => y.label === x.label) === i)

export interface AskOpts {
  engine: EngineCfg
  fetcher?: Fetcher
  signal?: AbortSignal
  known?: Known
}

/** Answer one typed sentence. Never throws: every failure becomes a plain answer. */
export async function ask(text: string, ctx: AskCtx, o: AskOpts): Promise<Turn> {
  const q = text.trim().slice(0, 500)
  if (!q) return refuse(q, ctx, 'unclear')
  const useModel = engineOn(o.engine) && !!o.fetcher
  try {
    if (!useModel) return (await askRules(q, ctx, o.known)) ?? refuse(q, ctx, kindFor(q))
    if (o.engine.mode === 'rules_first') {
      const r = await askRules(q, ctx, o.known)
      if (r) return r
    }
    try {
      return await askModel(q, ctx, o.engine, o.fetcher!, o.signal)
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      const r = o.engine.mode === 'model_first' ? await askRules(q, ctx, o.known) : null
      const note = `${refusal('engine')} (${why})`
      return r ? { ...r, note } : refuse(q, ctx, kindFor(q), note)
    }
  } catch (e) {
    return newTurn(q, ctx, { source: 'refusal', lines: [`THAT LOOKUP FAILED: ${e instanceof Error ? e.message.toUpperCase() : 'UNKNOWN ERROR'}.`], warn: true })
  }
}

/** Save a confirmed plan: one UNDO step, marked as the assistant's in the edit history. */
export async function confirmPlan(ctx: Pick<AskCtx, 'store'>, plan: Plan): Promise<string> {
  return ctx.store.action(plan.label, () => plan.apply(ctx.store), { via: 'assistant' })
}

/** YES / NO typed instead of pressing the buttons. */
export const isYes = (s: string) => /^(y|yes|yeah|yep|ok|okay|confirm|save|si|sí|dale|do it)\.?!?$/i.test(s.trim())
export const isNo = (s: string) => /^(n|no|nope|cancel|stop|abort|nah|cancelar)\.?!?$/i.test(s.trim())
