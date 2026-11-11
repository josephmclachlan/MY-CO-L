import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { useRole } from '../settings/RoleContext'
import { useStore } from '../store/StoreContext'
import { useSearchIndex } from '../store/useSearchIndex'
import { Box, Buttons, getInitials, type Say } from './FacilityParts'
import { farmDay } from '../lib/facility'
import { ask, confirmPlan, isNo, isYes, type Turn } from '../lib/assistant/ask'
import type { AskCtx, Go } from '../lib/assistant/core'
import { MODEL_GUIDE, addressProblem, engineOn, loadEngine, normEngine, ping, saveEngine, type EngineCfg, type EngineKind, type EngineMode, type Fetcher } from '../lib/assistant/llm'
import { TEST_QUESTIONS, farmStore, NOW as TEST_NOW, TODAY as TEST_TODAY } from '../lib/assistant/fixture'

// ASK (build G10): the farm assistant. Type a question or a command in plain words.
// It answers ONLY from this app's records (each answer names the screen it came from) and saves only
// after CONFIRM, as one UNDO step. A LOCAL model (Ollama / llama.cpp on the farm PC) can be switched on
// under ENGINE; without one, the rule brain answers the common sentences.

export type AskTab = 'ASK' | 'ENGINE' | 'EXAMPLES'
export const ASK_TABS: AskTab[] = ['ASK', 'ENGINE', 'EXAMPLES']
export interface AskState {
  tab: AskTab
  turns: Turn[]
  /** A sentence typed at the > prompt, waiting to be asked. */
  queued: string | null
}
export const ASK_START: AskState = { tab: 'ASK', turns: [], queued: null }
type SetAsk = (p: Partial<AskState> | ((s: AskState) => Partial<AskState>)) => void

const TAB_LABEL: Record<AskTab, string> = { ASK: 'ASK MY/CO/L', ENGINE: 'ENGINE (LOCAL MODEL)', EXAMPLES: 'EXAMPLES' }
const KEEP = 40

/** The browser's fetch, wrapped to the shape llm.ts wants. */
const browserFetch: Fetcher = (url, init) => fetch(url, init).then((r) => ({ ok: r.ok, status: r.status, json: () => r.json() }))

function useEngine(): [EngineCfg, (c: EngineCfg) => void] {
  const [c, setC] = useState<EngineCfg>(loadEngine)
  return [c, (n) => {
    const v = normEngine(n)
    saveEngine(v)
    setC(v)
  }]
}

export function AskIndex({ x, set }: { x: AskState; set: SetAsk }) {
  const { sound } = useApp()
  const { t } = useT()
  const [eng] = useEngine()
  return (
    <>
      <div className="section-title">{t('ASK')}</div>
      <ul className="index-list">
        {ASK_TABS.map((k) => (
          <li tabIndex={0} key={k} className={x.tab === k ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: k }))}>
            <span>{t(TAB_LABEL[k])}</span>
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>{t('BRAIN')}</div>
      <div className="lg-mini">
        <div>{engineOn(eng) ? eng.model.toUpperCase() : t('RULES ONLY')}</div>
      </div>
    </>
  )
}

export function Ask({ x, set, say, onGo }: { x: AskState; set: SetAsk; say: Say; onGo: (g: Go) => void }) {
  const { t } = useT()
  const { sound } = useApp()
  return (
    <div className="cook ledger od mn fc sr ask">
      <Buttons value={x.tab} label={t('Section')} options={ASK_TABS.map((k) => ({ id: k, label: t(TAB_LABEL[k]) }))} onPick={(v) => (sound.chirp(), set({ tab: v }))} />
      {x.tab === 'ASK' && <AskTalk x={x} set={set} say={say} onGo={onGo} />}
      {x.tab === 'ENGINE' && <EngineTab />}
      {x.tab === 'EXAMPLES' && <Examples onPick={(q) => set({ tab: 'ASK', queued: q })} />}
    </div>
  )
}

function useAskCtx(): () => AskCtx {
  const store = useStore()
  const { role } = useRole()
  const { docs } = useSearchIndex()
  const ref = useRef({ store, role, docs })
  ref.current = { store, role, docs }
  return useCallback(() => {
    const now = Date.now()
    return { store: ref.current.store, role: ref.current.role, now, today: farmDay(now), initials: getInitials(), docs: ref.current.docs }
  }, [])
}

function AskTalk({ x, set, say, onGo }: { x: AskState; set: SetAsk; say: Say; onGo: (g: Go) => void }) {
  const { t } = useT()
  const { sound } = useApp()
  const ctxNow = useAskCtx()
  const [eng] = useEngine()
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const pending = x.turns.find((u) => u.planState === 'pending') ?? null

  const update = useCallback((id: string, p: Partial<Turn>) => set((s) => ({ turns: s.turns.map((u) => (u.id === id ? { ...u, ...p } : u)) })), [set])

  const confirm = useCallback(async (turn: Turn) => {
    if (!turn.plan) return
    try {
      const out = await confirmPlan(ctxNow(), turn.plan)
      sound.confirm()
      update(turn.id, { planState: 'saved', result: out })
      say(`${out} // ${t('UNDO REVERSES IT')}`)
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      update(turn.id, { planState: 'failed', result: m })
      say(m, true)
    }
  }, [ctxNow, sound, update, say, t])
  const cancel = useCallback((turn: Turn) => {
    update(turn.id, { planState: 'cancelled' })
    sound.chirp()
    say(t('CANCELLED. NOTHING WAS SAVED.'))
  }, [update, sound, say, t])

  const run = useCallback(async (q: string) => {
    const text = q.trim()
    if (!text || busy) return
    if (pending && isYes(text)) return void confirm(pending)
    if (pending && isNo(text)) return cancel(pending)
    // A new question drops a save still waiting: it was never confirmed.
    if (pending) update(pending.id, { planState: 'cancelled' })
    setBusy(true)
    sound.chirp()
    const ac = new AbortController()
    abort.current = ac
    const timer = window.setTimeout(() => ac.abort(), eng.timeoutSec * 1000)
    try {
      const turn = await ask(text, ctxNow(), { engine: eng, fetcher: engineOn(eng) ? browserFetch : undefined, signal: ac.signal })
      set((s) => ({ turns: [turn, ...s.turns].slice(0, KEEP) }))
      if (turn.open) onGo(turn.open)
    } finally {
      window.clearTimeout(timer)
      abort.current = null
      setBusy(false)
    }
  }, [busy, pending, confirm, cancel, update, sound, eng, ctxNow, set, onGo])

  // A sentence typed at the > prompt.
  useEffect(() => {
    if (!x.queued) return
    const q = x.queued
    set({ queued: null })
    void run(q)
  }, [x.queued, set, run])

  const cardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (pending) cardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [pending])

  const card = pending?.plan && (
    <div ref={cardRef}>
      <Box title={t('CONFIRM BEFORE SAVING')}>
        <ul className="ask-lines ask-plan">
          {pending.plan.lines.map((l, i) => <li key={i} className={l.startsWith('!') ? 'lg-warn-text' : ''}>{l}</li>)}
        </ul>
        <div className="lg-btns">
          <button type="button" className="btn on" onClick={() => void confirm(pending)}>{t('CONFIRM AND SAVE')}</button>
          <button type="button" className="btn" onClick={() => cancel(pending)}>{t('CANCEL')}</button>
        </div>
        <div className="dim tiny">{t('NOTHING IS SAVED UNTIL YOU PRESS CONFIRM. OR TYPE YES OR NO.')}</div>
      </Box>
    </div>
  )

  return (
    <div className="lg-stack">
      {card}
      <Box title={t('ASK A QUESTION OR GIVE A COMMAND')}>
        <form className="ask-row" onSubmit={(e) => { e.preventDefault(); const q = val; setVal(''); void run(q) }}>
          <span className="ask-gt" aria-hidden>&gt;</span>
          <input className="sr-input" aria-label={t('Question or command')} autoFocus value={val} placeholder={t('HOW MANY LM BLOCKS ARE FRUITING?')} onChange={(e) => setVal(e.target.value)} disabled={busy} />
          <button type="submit" className="btn" disabled={busy || !val.trim()}>{busy ? t('THINKING') : t('ASK')}</button>
          {busy && <button type="button" className="btn" onClick={() => abort.current?.abort()}>{t('STOP')}</button>}
        </form>
        <div className="dim tiny">{t('TYPE HERE, OR AT THE > PROMPT AT THE BOTTOM OF ANY SCREEN.')} {t('ANSWERS COME ONLY FROM THIS FARM\'S RECORDS. SAVES WAIT FOR CONFIRM AND CAN BE UNDONE.')} {engineOn(eng) ? t('LOCAL MODEL ON.') : t('RULES ONLY: USE SIMPLE SENTENCES (SEE EXAMPLES).')}</div>
      </Box>
      <Box title={x.turns.length ? t('ANSWERS, NEWEST FIRST') : t('ANSWERS')}>
        {!x.turns.length ? (
          <div className="dim">{t('NOTHING ASKED YET. TRY ONE OF THE EXAMPLES, OR TYPE AT THE > PROMPT ON ANY SCREEN: ASK WHO OWES MONEY.')}</div>
        ) : (
          <div className="ask-list">
            {x.turns.map((u) => <TurnView key={u.id} u={u} onGo={onGo} />)}
          </div>
        )}
        {x.turns.length > 0 && <button type="button" className="btn" onClick={() => set({ turns: [] })}>{t('CLEAR ANSWERS')}</button>}
      </Box>
    </div>
  )
}

function TurnView({ u, onGo }: { u: Turn; onGo: (g: Go) => void }) {
  const { t, tf } = useT()
  const { sound } = useApp()
  const src = u.source === 'model' ? tf('LOCAL MODEL {s} S', { s: (u.sec ?? 0).toFixed(1) }) : u.source === 'rules' ? t('RULES') : t('REFUSED')
  return (
    <div className={`ask-turn src-${u.source}`}>
      <div className="ask-q"><span className="ask-gt" aria-hidden>&gt;</span> {u.q.toUpperCase()} <span className="ask-src">[{src}]</span></div>
      {u.note && <div className="dim tiny">{u.note}</div>}
      <ul className="ask-lines">
        {(u.plan ? u.plan.lines : u.lines).map((l, i) => <li key={i} className={l.startsWith('!') ? 'lg-warn-text' : ''}>{l}</li>)}
      </ul>
      {u.plan && (
        <div className={u.planState === 'failed' ? 'lg-warn-text' : u.planState === 'saved' ? 'ask-saved' : 'dim'}>
          {u.planState === 'saved' ? `${t('SAVED')}: ${u.result}. ${t('UNDO REVERSES IT')}.` : u.planState === 'cancelled' ? t('CANCELLED. NOTHING WAS SAVED.') : u.planState === 'pending' ? t('WAITING FOR CONFIRM (ABOVE). NOTHING IS SAVED YET.') : `${t('NOT SAVED')}: ${u.result}`}
        </div>
      )}
      {u.facts && u.facts.length > 0 && (
        <div className="ask-facts">
          <div className="dim tiny">{t('FROM THE RECORDS:')}</div>
          <ul className="ask-lines">{u.facts.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      {u.cite.length > 0 && (
        <div className="ask-cites">
          {u.cite.map((c) => (
            <button type="button" key={c.label} className="btn" onClick={() => (sound.chirp(), onGo(c.go))}>
              {t('OPEN')} {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- EXAMPLES ----------

const EXAMPLES: { title: string; list: string[] }[] = [
  { title: 'LOOK THINGS UP', list: ['HOW MANY LM BLOCKS ARE FRUITING?', 'HOW MUCH BLUE OYSTER DID WE PICK THIS WEEK?', 'TELL ME ABOUT LOT B1020', 'WHAT IS DUE TODAY?', 'WHAT IS LOW IN STOCK?', 'IS THE POWER OUT?', 'HOURS WITHOUT POWER LAST MONTH', 'TEMPERATURE IN THE FRUITING ROOM', 'LM-01', 'WHAT TEMPERATURE DOES LION\'S MANE FRUIT AT?'] },
  { title: 'MONEY (OWNER ONLY)', list: ['WHO OWES MONEY?', 'SALES THIS MONTH', 'SODA TAMARA PAID'] },
  { title: 'SAVE SOMETHING (YOU CONFIRM FIRST)', list: ['LOG 4.2 KG FROM B1020', 'LOG 3 KG FROM B1020 FLUSH 2 GRADE B BY JM', 'POWER IS OUT', 'POWER IS BACK', 'GENERATOR ON', 'FRUITING 18.5C 92%', 'MARK B1020 SPENT', 'RECEIVED 10 SACKS OF SOY HULLS', 'USED 40 FILTER PATCH BAGS'] },
  { title: 'OPEN A SCREEN', list: ['SHOW THE POWER CUT LOG', 'OPEN THE HARVEST LOG', 'SHOW CLIMATE ALARMS', 'OPEN STOCK'] },
]

function Examples({ onPick }: { onPick: (q: string) => void }) {
  const { t } = useT()
  const { role } = useRole()
  return (
    <div className="lg-stack">
      <Box title={t('TAP ONE TO ASK IT')}>
        <div className="dim tiny">{t('THE RULE BRAIN KNOWS THESE SHAPES OF SENTENCE. LOT CODES, STRAIN CODES, BUYERS AND STOCK NAMES COME FROM YOUR RECORDS. WITH A LOCAL MODEL ON, ANY WORDING WORKS.')}</div>
      </Box>
      {EXAMPLES.filter((g) => role === 'owner' || !g.title.startsWith('MONEY')).map((g) => (
        <Box key={g.title} title={t(g.title)}>
          <ul className="sr-list">
            {g.list.map((q) => (
              <li key={q}>
                <button type="button" className="sr-hit ask-ex" onClick={() => onPick(q)}>
                  <span className="sr-title">{q}</span>
                </button>
              </li>
            ))}
          </ul>
        </Box>
      ))}
    </div>
  )
}

// ---------- ENGINE ----------

const KINDS: { id: EngineKind; label: string }[] = [
  { id: 'off', label: 'OFF (RULES ONLY)' },
  { id: 'ollama', label: 'OLLAMA' },
  { id: 'openai', label: 'LLAMA.CPP / LM STUDIO' },
]
const MODES: { id: EngineMode; label: string }[] = [
  { id: 'rules_first', label: 'RULES FIRST, MODEL FOR THE REST' },
  { id: 'model_first', label: 'MODEL FIRST' },
]

interface TestRow { q: string; want: string; got: string; ok: boolean; sec: number }

function EngineTab() {
  const { t, tf } = useT()
  const { sound } = useApp()
  const [eng, setEng] = useEngine()
  const [draft, setDraft] = useState<EngineCfg>(eng)
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null)
  const [tests, setTests] = useState<TestRow[] | null>(null)
  const [testing, setTesting] = useState(false)
  const problem = useMemo(() => (draft.kind === 'off' ? null : addressProblem(draft, window.location.protocol)), [draft])
  const dirty = JSON.stringify(normEngine(draft)) !== JSON.stringify(eng)

  const save = () => {
    setEng(draft)
    sound.confirm()
    setMsg({ text: t('SAVED ON THIS DEVICE.'), warn: false })
  }
  const test = async () => {
    setMsg({ text: t('CALLING THE MODEL SERVER...'), warn: false })
    const ac = new AbortController()
    const id = window.setTimeout(() => ac.abort(), 8000)
    const r = await ping(draft, browserFetch, ac.signal)
    window.clearTimeout(id)
    setMsg({ text: r.text, warn: !r.ok })
  }
  // Known questions against a small made-up farm, so the score means the same on any machine.
  const runTests = async () => {
    if (testing) return
    setTesting(true)
    setTests([])
    const cfg = { ...normEngine(draft), mode: 'model_first' as const }
    for (const tq of TEST_QUESTIONS) {
      const store = await farmStore()
      const ctx: AskCtx = { store, role: 'owner', now: TEST_NOW, today: TEST_TODAY, initials: 'JM' }
      const ac = new AbortController()
      const id = window.setTimeout(() => ac.abort(), cfg.timeoutSec * 1000)
      const t0 = performance.now()
      const turn = await ask(tq.q, ctx, { engine: cfg, fetcher: browserFetch, signal: ac.signal })
      window.clearTimeout(id)
      const all = [...turn.lines, ...(turn.facts ?? [])].join(' ')
      const ok = turn.source === 'model' && turn.tool === tq.tool && tq.expect.every((e) => all.includes(e))
      const row = { q: tq.q.toUpperCase(), want: tq.tool, got: turn.source === 'model' ? turn.tool ?? '-' : turn.note ? t('MODEL FAILED') : t('REFUSED'), ok, sec: (performance.now() - t0) / 1000 }
      setTests((r) => [...(r ?? []), row])
    }
    setTesting(false)
  }
  const score = tests && tests.length ? tests.filter((r) => r.ok).length : 0
  const avg = tests && tests.length ? tests.reduce((n, r) => n + r.sec, 0) / tests.length : 0

  return (
    <div className="lg-stack">
      <Box title={t('LOCAL MODEL (OPTIONAL)')}>
        <div className="dim tiny">{t('ONLY A MODEL ON YOUR OWN COMPUTER OR FARM NETWORK. NO CLOUD SERVICE, NO API KEY, NO COST. WITHOUT ONE, THE RULE BRAIN ANSWERS.')}</div>
        <div className="ck-field"><span>{t('ENGINE')}</span><Buttons value={draft.kind} label={t('Engine')} options={KINDS.map((k) => ({ id: k.id, label: t(k.label) }))} onPick={(v) => setDraft({ ...draft, kind: v, url: v === 'openai' && draft.url.endsWith(':11434') ? 'http://localhost:8080' : v === 'ollama' && draft.url.endsWith(':8080') ? 'http://localhost:11434' : draft.url })} /></div>
        {draft.kind !== 'off' && (
          <>
            <label className="ck-field"><span>{t('ADDRESS')}</span><input className="sr-input ask-plain" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} spellCheck={false} /></label>
            <label className="ck-field"><span>{t('MODEL NAME')}</span><input className="sr-input ask-plain" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} spellCheck={false} /></label>
            <div className="ck-field"><span>{t('WHO ANSWERS FIRST')}</span><Buttons value={draft.mode === 'rules' ? 'rules_first' : draft.mode} label={t('Mode')} options={MODES.map((k) => ({ id: k.id, label: t(k.label) }))} onPick={(v) => setDraft({ ...draft, mode: v })} /></div>
            <label className="ck-field"><span>{t('GIVE UP AFTER (SECONDS)')}</span><input className="sr-input ask-num" inputMode="numeric" value={String(draft.timeoutSec)} onChange={(e) => setDraft({ ...draft, timeoutSec: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
            {problem && <div className="lg-warn-text">{problem}</div>}
          </>
        )}
        <div className="lg-btns">
          <button type="button" className={`btn ${dirty ? 'on' : ''}`} onClick={save} disabled={!dirty}>{t('SAVE')}</button>
          {draft.kind !== 'off' && <button type="button" className="btn" onClick={() => void test()}>{t('TEST CONNECTION')}</button>}
          {draft.kind !== 'off' && <button type="button" className="btn" onClick={() => void runTests()} disabled={testing}>{testing ? t('TESTING...') : tf('RUN {n} TEST QUESTIONS', { n: TEST_QUESTIONS.length })}</button>}
        </div>
        {msg && <div className={msg.warn ? 'lg-warn-text' : ''}>{msg.text}</div>}
      </Box>
      {tests && (
        <Box title={tf('TEST QUESTIONS: {ok} OF {n} RIGHT // {s} S EACH ON AVERAGE', { ok: score, n: tests.length, s: avg.toFixed(1) })}>
          <div className="dim tiny">{t('ASKED AGAINST A SMALL MADE-UP FARM WITH KNOWN ANSWERS, NOT YOUR RECORDS. A GOOD MODEL GETS THEM ALL.')}</div>
          <ul className="ask-lines">
            {tests.map((r) => <li key={r.q} className={r.ok ? '' : 'lg-warn-text'}>{r.ok ? t('PASS') : t('FAIL')} // {r.sec.toFixed(1)} S // {r.q} // {r.got}</li>)}
          </ul>
        </Box>
      )}
      <Box title={t('SET UP OLLAMA ON THE FARM PC')}>
        <ol className="ask-steps">
          <li>{t('INSTALL OLLAMA FROM OLLAMA.COM ON THE COMPUTER THAT STAYS ON.')}</li>
          <li>{t('IN A TERMINAL: ollama pull qwen2.5:3b')}</li>
          <li>{t('LET THIS PAGE TALK TO IT: SET THE SETTING OLLAMA_ORIGINS TO THE ADDRESS YOU OPEN THE APP FROM (E.G. https://josephmclachlan.github.io), THEN RESTART OLLAMA.')}</li>
          <li>{t('HERE: ENGINE OLLAMA, ADDRESS http://localhost:11434, MODEL qwen2.5:3b, SAVE, TEST CONNECTION, RUN THE TEST QUESTIONS.')}</li>
          <li>{t('PHONES: A PHONE CANNOT REACH localhost. OPEN THE APP FROM THE FARM BOX\'S https ADDRESS AND SET THE ADDRESS HERE TO /llm: THE BOX SERVES THE MODEL UNDER THE APP\'S OWN ADDRESS (SEE docs/SELF-HOST.md).')}</li>
        </ol>
      </Box>
      <Box title={t('WHICH MODEL')}>
        <div className="ask-guide">
          {MODEL_GUIDE.map((m) => (
            <div key={m.name} className="ask-guide-row">
              <b>{m.name}</b>
              <span>{tf('{size} DOWNLOAD // {ram} MEMORY', { size: m.size, ram: m.ram })}</span>
              <span>{m.where}</span>
              <span className="dim">{m.note}</span>
            </div>
          ))}
        </div>
        <div className="dim tiny">{t('SPEEDS ARE ESTIMATES, NOT MEASURED ON THE FARM PC. RUN THE TEST QUESTIONS ON THE REAL MACHINE TO KNOW.')}</div>
      </Box>
    </div>
  )
}
