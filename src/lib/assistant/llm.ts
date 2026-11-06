// FARM ASSISTANT local-model link. LOCAL ONLY: a model running on the farm's own computer or LAN
// (Ollama, llama.cpp's llama-server, LM Studio, llamafile). No cloud model, no API key, no paid service.
//
// Two ways to talk, both plain HTTP to an address the owner types on the ASK > ENGINE tab:
//   ollama  POST {url}/api/chat            (Ollama's own API)
//   openai  POST {url}/v1/chat/completions (the OpenAI-shaped API that llama-server, LM Studio,
//                                           llamafile and Ollama itself all speak)
// The model only ever sees the tool list (tools.ts) and what those tools return. It cannot save
// anything: a write tool it calls comes back as a PLAN for the person to confirm.

import type { Tool } from './tools'

export type EngineKind = 'off' | 'ollama' | 'openai'
/** rules = never use the model. rules_first = rules answer what they can, the model takes the rest. model_first = model first, rules if it fails. */
export type EngineMode = 'rules' | 'rules_first' | 'model_first'

export interface EngineCfg {
  kind: EngineKind
  url: string
  model: string
  mode: EngineMode
  /** Give up on one model reply after this long and fall back to the rules. */
  timeoutSec: number
}

/** On the farm box (selfhost/) the model sits behind the same address as the app, at /llm. */
const SELF_HOSTED = import.meta.env?.VITE_SUPABASE_URL === 'self'
export const DEFAULT_ENGINE: EngineCfg = { kind: 'off', url: SELF_HOSTED ? '/llm' : 'http://localhost:11434', model: 'qwen2.5:3b', mode: 'rules_first', timeoutSec: 60 }

const KEY = 'mycol.assistant.v1'
export function loadEngine(): EngineCfg {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return DEFAULT_ENGINE
    return normEngine(JSON.parse(raw))
  } catch {
    return DEFAULT_ENGINE
  }
}
export function saveEngine(c: EngineCfg) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(normEngine(c)))
  } catch {
    /* storage blocked: the setting lasts until the page closes */
  }
}
export function normEngine(v: unknown): EngineCfg {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<EngineCfg>
  const kind: EngineKind = o.kind === 'ollama' || o.kind === 'openai' ? o.kind : 'off'
  const mode: EngineMode = o.mode === 'rules' || o.mode === 'model_first' ? o.mode : 'rules_first'
  const t = Number(o.timeoutSec)
  return {
    kind,
    url: typeof o.url === 'string' && o.url.trim() ? o.url.trim().replace(/\/+$/, '') : DEFAULT_ENGINE.url,
    model: typeof o.model === 'string' && o.model.trim() ? o.model.trim() : DEFAULT_ENGINE.model,
    mode,
    timeoutSec: Number.isFinite(t) && t >= 5 && t <= 600 ? Math.round(t) : DEFAULT_ENGINE.timeoutSec,
  }
}
export const engineOn = (c: EngineCfg) => c.kind !== 'off' && c.mode !== 'rules'

/**
 * A plain sentence when the browser will refuse the address before it is even tried.
 * A page served over https may not call a plain http address unless it is this same computer.
 */
export function addressProblem(c: EngineCfg, pageProtocol: string): string | null {
  // A path such as /llm is on the same computer that served this page (the farm box's proxy): always allowed.
  if (/^\/[^/]/.test(c.url)) return null
  let u: URL
  try {
    u = new URL(c.url)
  } catch {
    return 'THE ADDRESS IS NOT A WEB ADDRESS. IT LOOKS LIKE http://localhost:11434 (OR /llm ON THE FARM BOX).'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'THE ADDRESS MUST START WITH http:// OR https://.'
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (pageProtocol === 'https:' && u.protocol === 'http:' && !local)
    return 'THIS PAGE IS HTTPS, SO THE BROWSER BLOCKS A PLAIN http:// ADDRESS ON ANOTHER COMPUTER. RUN THE MODEL ON THIS SAME COMPUTER (localhost), OR USE THE FARM BOX\'S https ADDRESS (ITS /llm PATH SERVES THE MODEL).'
  return null
}

// ---------- messages ----------

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}
export interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}
export interface Reply {
  text: string
  calls: ToolCall[]
  /** Seconds the model took. */
  sec: number
}

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }>

export class EngineError extends Error {
  /** The model could not be reached at all (the rules take over without a fuss). */
  readonly offline: boolean
  constructor(msg: string, offline: boolean) {
    super(msg)
    this.offline = offline
  }
}

/** The function list in the shape both APIs take. */
export function toolSchema(tools: Tool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.desc,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.params).map(([k, p]) => [k, { type: p.type, description: p.desc, ...(p.enum ? { enum: [...p.enum] } : {}) }])),
        required: t.required ?? [],
      },
    },
  }))
}

const parseArgs = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v)
      return o && typeof o === 'object' ? o : {}
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Small models sometimes write the call as text instead of using the function slot:
 * {"name": "count_lots", "arguments": {...}} or <tool_call>{...}</tool_call>. Read those too.
 */
export function callsFromText(text: string, names: Set<string>): ToolCall[] {
  const out: ToolCall[] = []
  const chunks = text.match(/\{[\s\S]*\}/g) ?? []
  for (const c of chunks) {
    let o: unknown
    try {
      o = JSON.parse(c)
    } catch {
      continue
    }
    const list = Array.isArray(o) ? o : [o]
    for (const x of list) {
      const r = x as { name?: unknown; tool?: unknown; function?: unknown; arguments?: unknown; args?: unknown; parameters?: unknown }
      const name = typeof r.name === 'string' ? r.name : typeof r.tool === 'string' ? r.tool : typeof r.function === 'string' ? r.function : null
      if (name && names.has(name)) out.push({ id: `t${out.length}`, name, args: parseArgs(r.arguments ?? r.args ?? r.parameters) })
    }
  }
  return out
}

/** One round trip to the model. */
export async function chat(cfg: EngineCfg, msgs: Msg[], tools: Tool[], fetcher: Fetcher, signal?: AbortSignal, clock: () => number = () => performance.now()): Promise<Reply> {
  const t0 = clock()
  const schema = toolSchema(tools)
  const names = new Set(tools.map((t) => t.name))
  let url: string
  let body: unknown
  if (cfg.kind === 'ollama') {
    url = `${cfg.url}/api/chat`
    body = {
      model: cfg.model,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0, num_ctx: 8192 },
      tools: schema,
      messages: msgs.map((m) => (m.role === 'tool' ? { role: 'tool', content: m.content, tool_name: m.name } : m.tool_calls ? { role: m.role, content: m.content, tool_calls: m.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : { role: m.role, content: m.content })),
    }
  } else if (cfg.kind === 'openai') {
    url = `${cfg.url}/v1/chat/completions`
    body = {
      model: cfg.model,
      temperature: 0,
      stream: false,
      tools: schema,
      messages: msgs.map((m) =>
        m.role === 'tool'
          ? { role: 'tool', content: m.content, tool_call_id: m.tool_call_id }
          : m.tool_calls
            ? { role: m.role, content: m.content || null, tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
            : { role: m.role, content: m.content },
      ),
    }
  } else throw new EngineError('NO MODEL IS SET UP.', true)

  let res: Awaited<ReturnType<Fetcher>>
  try {
    res = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError' || signal?.aborted
    throw new EngineError(aborted ? 'THE MODEL TOOK TOO LONG.' : 'THE MODEL CANNOT BE REACHED AT THAT ADDRESS.', true)
  }
  if (!res.ok) {
    const hint = res.status === 404 ? ` IS THE MODEL NAME RIGHT? (${cfg.model})` : res.status === 403 ? ' THE MODEL SERVER REFUSED THIS PAGE (SET OLLAMA_ORIGINS).' : ''
    throw new EngineError(`THE MODEL ANSWERED WITH ERROR ${res.status}.${hint}`, false)
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!data) throw new EngineError('THE MODEL SENT SOMETHING THAT IS NOT JSON.', false)
  let msg: { content?: unknown; tool_calls?: unknown } | undefined
  if (cfg.kind === 'ollama') msg = data.message as typeof msg
  else msg = ((data.choices as { message?: typeof msg }[] | undefined)?.[0])?.message
  const text = typeof msg?.content === 'string' ? msg.content : ''
  const raw = Array.isArray(msg?.tool_calls) ? (msg!.tool_calls as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]) : []
  let calls: ToolCall[] = raw
    .map((c, i) => ({ id: typeof c.id === 'string' ? c.id : `c${i}`, name: String(c.function?.name ?? ''), args: parseArgs(c.function?.arguments) }))
    .filter((c) => names.has(c.name))
  if (!calls.length && text) calls = callsFromText(text, names)
  return { text: calls.length ? '' : stripThink(text), calls, sec: (clock() - t0) / 1000 }
}

/** Reasoning models may wrap thoughts in <think>...</think>; only the answer is shown. */
export const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

/** Is the model server there, and does it have this model? */
export async function ping(cfg: EngineCfg, fetcher: Fetcher, signal?: AbortSignal): Promise<{ ok: boolean; text: string; models: string[] }> {
  const url = cfg.kind === 'ollama' ? `${cfg.url}/api/tags` : `${cfg.url}/v1/models`
  try {
    const res = await fetcher(url, { method: 'GET', headers: {}, signal })
    if (!res.ok) return { ok: false, text: `THE SERVER ANSWERED ERROR ${res.status}.`, models: [] }
    const d = (await res.json()) as { models?: { name?: string; model?: string }[]; data?: { id?: string }[] }
    const models = (cfg.kind === 'ollama' ? (d.models ?? []).map((m) => m.name ?? m.model ?? '') : (d.data ?? []).map((m) => m.id ?? '')).filter(Boolean)
    const has = !models.length || models.some((m) => m === cfg.model || m.split(':')[0] === cfg.model || m === `${cfg.model}:latest`)
    return has ? { ok: true, text: `CONNECTED. ${models.length} MODEL${models.length === 1 ? '' : 'S'} ON THE SERVER.`, models } : { ok: false, text: `CONNECTED, BUT ${cfg.model} IS NOT ON THE SERVER. IT HAS: ${models.slice(0, 6).join(', ')}.`, models }
  } catch {
    return { ok: false, text: 'NOTHING ANSWERED AT THAT ADDRESS. IS THE MODEL SERVER RUNNING, AND ALLOWED TO TALK TO THIS PAGE?', models: [] }
  }
}

/** Model sizes to try, for the ENGINE tab and the G13 hardware plan. Estimates, not measured on the farm PC. */
export const MODEL_GUIDE: { name: string; size: string; ram: string; where: string; note: string }[] = [
  { name: 'qwen2.5:3b', size: '1.9 GB', ram: '4 GB', where: 'N150 MINI PC (16 GB), ANY RECENT PC', note: 'DEFAULT. GOOD AT PICKING TOOLS FOR ITS SIZE. EXPECT ABOUT 10-30 S PER ANSWER ON AN N150.' },
  { name: 'llama3.2:3b', size: '2.0 GB', ram: '4 GB', where: 'N150 MINI PC, ANY RECENT PC', note: 'SECOND CHOICE AT 3B. A LITTLE WEAKER AT TOOL ARGUMENTS.' },
  { name: 'qwen3:4b', size: '2.6 GB', ram: '5 GB', where: 'N150 MINI PC, ANY RECENT PC', note: 'STRONGER THAN 3B, SLOWER. THINKING IS SWITCHED OFF BY THE APP.' },
  { name: 'qwen2.5:7b', size: '4.7 GB', ram: '8 GB', where: '8-CORE MINI PC (RYZEN 7 / CORE I5 12TH GEN+) WITH 32 GB, OR A PC WITH A GPU', note: 'MOST RELIABLE. TOO SLOW ON AN N150 (ABOUT 1 MIN PER ANSWER).' },
  { name: 'llama3.1:8b', size: '4.9 GB', ram: '8 GB', where: 'SAME AS 7B', note: 'GOOD PLAIN ENGLISH, FINE AT TOOLS.' },
]
