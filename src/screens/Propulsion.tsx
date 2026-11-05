import { Select } from '../components/Select'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore, useTable } from '../store/StoreContext'
import { usePower } from '../power/PowerContext'
import {
  DEFAULT_PURPOSE,
  DEFAULT_ZONES,
  ICE_RATE_CRC,
  ICE_RATE_SOURCE,
  KIND_LABEL,
  KIND_LONG,
  PURPOSE_LABEL,
  TARGETS,
  type CookKind,
  type Purpose,
} from '../data/cook'
import ctxData from '../data/cook/context.json'
import { HEATER_OPTIONS, ICE_PEAKS, type HeaterOption } from '../data/power'
import {
  analyseRun,
  cToF,
  crParts,
  crToMs,
  energyFor,
  fToC,
  heaterWatts,
  hm,
  MIN,
  plannedPeaks,
  sheetRow,
  zoneNames,
  type CookReading,
  type CookRun,
  type Energy,
  type PeakHit,
  type RunAnalysis,
  type Status,
} from '../lib/cook'
import { addReadings, linkLoad, newReading, newRun, recompute, removeReadings, removeRun, saveRun } from '../lib/cookActions'
import type { HazardLog, LotLoss } from '../lib/hazard'
import { outcomeFor } from '../lib/cookOutcome'
import type { BlockLot, GrainRun } from '../lib/xeno'
import type { Move } from '../lib/cargo'
import { Confirm, CsvImport, Curve, Field, Guess, Pick, PrintSheet, SheetTable } from './CookParts'

export type CookTab = 'RUN' | 'CURVE' | 'READINGS' | 'SHEET' | 'TARGETS'
export const COOK_TABS: CookTab[] = ['RUN', 'CURVE', 'READINGS', 'SHEET', 'TARGETS']
export interface CookState {
  sel: string | null
  tab: CookTab
}
export const COOK_START: CookState = { sel: null, tab: 'RUN' }
type SetCook = (p: Partial<CookState>) => void
type Say = (t: string, warn?: boolean) => void

interface Ctx {
  context: { id: string; label: string; v: string; source: string }[]
}
const CONTEXT = (ctxData as Ctx['context'])

// ---------- shared data ----------

function useNow(ms = 30000) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setN(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return n
}

export interface RunInfo {
  an: RunAnalysis
  en: Energy
}

function useCook() {
  const store = useStore()
  const raw = useTable<CookRun>('cook_runs')
  const readings = useTable<CookReading>('cook_readings')
  const now = useNow()
  const runs = useMemo(() => [...raw].sort((a, b) => (b.started_at ?? b.created_at ?? '').localeCompare(a.started_at ?? a.created_at ?? '')), [raw])
  const info = useMemo(() => {
    const m = new Map<string, RunInfo>()
    for (const r of runs) {
      const an = analyseRun(r, readings, now)
      m.set(r.id, { an, en: energyFor(r, an) })
    }
    return m
  }, [runs, readings, now])
  return { store, runs, readings, info, now }
}

const VERDICT_TEXT = { pending: 'OPEN', pass: 'PASS', fail: 'FAIL' } as const
const STATUS_TEXT: Record<Status, string> = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', short: 'SHORT', info: 'INFO', none: '--' }
const crc = (n: number | null | undefined) => (n === null || n === undefined ? '--' : `₡${Math.round(n).toLocaleString('en-US')}`)
const kwhText = (n: number | null | undefined) => (n === null || n === undefined ? '--' : `${n.toFixed(1)} KWH`)
const dayShort = (iso: string | null) => {
  if (!iso) return '--'
  const p = crParts(Date.parse(iso))
  return `${p.date.slice(5).replace('-', '.')} ${p.time}`
}

// ---------- outcome: what happened to the load afterwards ----------

function useOutcomes() {
  const lots = useTable<BlockLot>('block_lots')
  const grain = useTable<GrainRun>('grain_runs')
  const losses = useTable<LotLoss>('lot_losses')
  const logs = useTable<HazardLog>('hazard_logs')
  return { lots, grain, losses, logs, of: (id: string) => outcomeFor(id, lots, grain, losses, logs) }
}

// ---------- index (left) ----------

export function CookIndex({ x, set }: { x: CookState; set: SetCook }) {
  const { sound } = useApp()
  const { runs, info } = useCook()
  return (
    <>
      <div className="section-title">COOK LOG</div>
      <ul className="index-list">
        <li className={x.sel === null && x.tab !== 'TARGETS' ? 'sel' : ''} onClick={() => (sound.chirp(), set({ sel: null, tab: 'RUN' }))}>
          <span>OVERVIEW + NEW RUN</span>
          <span className="k">{runs.length}</span>
        </li>
        <li className={x.sel === null && x.tab === 'TARGETS' ? 'sel' : ''} onClick={() => (sound.chirp(), set({ sel: null, tab: 'TARGETS' }))}>
          <span>TARGETS + SOURCES</span>
        </li>
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>RUNS</div>
      <ul className="index-list ck-index">
        {runs.length === 0 && <li className="dim"><span>NONE LOGGED YET</span></li>}
        {runs.map((r) => {
          const v = info.get(r.id)?.an.verdict ?? 'pending'
          return (
            <li key={r.id} className={r.id === x.sel ? 'sel' : ''} onClick={() => (sound.chirp(), set({ sel: r.id, tab: x.tab === 'TARGETS' ? 'RUN' : x.tab }))}>
              <span>
                {dayShort(r.started_at)} {KIND_LABEL[r.kind]}
                {r.bag_count ? ` ${r.bag_count}` : ''}
              </span>
              <span className={`k ck-v ${v}`}>{VERDICT_TEXT[v]}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ---------- the screen ----------

export function Propulsion({
  x,
  set,
  say,
  onOpenHazard,
  onOpenXeno,
  onOpenVitals,
  onOpenSequence,
}: {
  x: CookState
  set: SetCook
  say: Say
  onOpenHazard: () => void
  onOpenXeno: () => void
  onOpenVitals: () => void
  onOpenSequence: () => void
}) {
  const { sound } = useApp()
  const d = useCook()
  const run = x.sel ? d.runs.find((r) => r.id === x.sel) ?? null : null
  const [printing, setPrinting] = useState<null | 'blank' | 'run'>(null)
  useRefreshOnOpen(x.sel)

  useEffect(() => {
    // A run that was deleted on another device: fall back to the overview.
    if (x.sel && d.runs.length && !run) set({ sel: null })
  }, [x.sel, run, d.runs.length, set])

  useEffect(() => {
    if (!run) return
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      const i = COOK_TABS.indexOf(x.tab)
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        set({ tab: COOK_TABS[(i + 1) % COOK_TABS.length] })
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        set({ tab: COOK_TABS[(i + COOK_TABS.length - 1) % COOK_TABS.length] })
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [run, x.tab, set])

  const info = run ? d.info.get(run.id) : undefined
  const rows = useMemo(() => {
    if (!run || !info) return []
    return [...info.an.zones].sort((a, b) => Number(b.judged) - Number(a.judged)).map((z) => sheetRow(run, z))
  }, [run, info])

  return (
    <div className="cook">
      <label className="ck-picker">
        <span>RUN</span>
        <Select
          value={x.sel ?? (x.tab === 'TARGETS' ? '__targets' : '')}
          onChange={(e) => {
            sound.chirp()
            const v = e.target.value
            set(v === '' ? { sel: null, tab: 'RUN' } : v === '__targets' ? { sel: null, tab: 'TARGETS' } : { sel: v, tab: x.tab === 'TARGETS' ? 'RUN' : x.tab })
          }}
        >
          <option value="">OVERVIEW + NEW RUN</option>
          <option value="__targets">TARGETS + SOURCES</option>
          {d.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {dayShort(r.started_at)} {KIND_LABEL[r.kind]}
              {r.bag_count ? ` ${r.bag_count}` : ''} // {VERDICT_TEXT[d.info.get(r.id)?.an.verdict ?? 'pending']}
            </option>
          ))}
        </Select>
      </label>
      {!run && x.tab !== 'TARGETS' && <Overview d={d} set={set} say={say} onOpenVitals={onOpenVitals} onPrint={() => setPrinting('blank')} />}
      {!run && x.tab === 'TARGETS' && <Targets />}
      {run && info && (
        <>
          <div className="ck-head">
            <div className="section-title">
              {KIND_LABEL[run.kind]} // {PURPOSE_LABEL[run.purpose ?? DEFAULT_PURPOSE[run.kind]]} // {dayShort(run.started_at)}
              {run.unit_label ? ` // ${run.unit_label}` : ''}
            </div>
            <div className={`ck-verdict ${info.an.verdict}`}>
              <b>{VERDICT_TEXT[info.an.verdict]}</b> <span>{info.an.verdictText}</span>
            </div>
          </div>
          <nav className="spec-tabs" role="tablist">
            {COOK_TABS.map((t) => (
              <button key={t} role="tab" aria-selected={t === x.tab} className={t === x.tab ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
                {t}
              </button>
            ))}
          </nav>
          <div className="ck-body">
            {x.tab === 'RUN' && <RunTab run={run} info={info} say={say} set={set} onOpenHazard={onOpenHazard} onOpenXeno={onOpenXeno} onOpenVitals={onOpenVitals} onOpenSequence={onOpenSequence} />}
            {x.tab === 'CURVE' && <Curve run={run} an={info.an} readings={d.readings} />}
            {x.tab === 'READINGS' && <ReadingsTab run={run} an={info.an} readings={d.readings} say={say} />}
            {x.tab === 'SHEET' && (
              <div className="ck-box">
                <div className="section-title">LOG SHEET ROWS, ONE PER PROBE</div>
                <div className="dim tiny">THE COLUMNS ARE JOSEPH'S SUBSTRATE TEMPERATURE SHEET. TIMES ARE H:MM. BANDS BELOW 200 F COUNT ONLY THE WAY UP. HOVER OR LONG-PRESS A HEADING FOR ITS FULL NAME.</div>
                {rows.length ? <div className="ck-scroll"><SheetTable rows={rows} /></div> : <div className="dim">NO TEMPERATURE READINGS YET.</div>}
                <div className="ck-btns">
                  <button type="button" className="btn" disabled={!rows.length} onClick={() => setPrinting('run')}>PRINT THIS RUN</button>
                  <button type="button" className="btn" onClick={() => setPrinting('blank')}>PRINT BLANK SHEET</button>
                </div>
              </div>
            )}
            {x.tab === 'TARGETS' && <Targets />}
          </div>
        </>
      )}
      {printing === 'blank' && <PrintSheet title="DATE ________  VESSEL ________  LOAD ________" rows={[]} blank={24} onDone={() => setPrinting(null)} />}
      {printing === 'run' && run && <PrintSheet title={`${KIND_LABEL[run.kind]} // ${dayShort(run.started_at)}${run.load_desc ? ` // ${run.load_desc.toUpperCase()}` : ''}${run.bag_count ? ` // ${run.bag_count} BAGS` : ''}`} rows={rows} blank={6} onDone={() => setPrinting(null)} />}
    </div>
  )
}

// ---------- overview and starting a run ----------

function Overview({ d, set, say, onOpenVitals, onPrint }: { d: ReturnType<typeof useCook>; set: SetCook; say: Say; onOpenVitals: () => void; onPrint: () => void }) {
  const { sound } = useApp()
  const { state } = usePower()
  const heater: HeaterOption = state.heater
  const nowP = crParts(Date.now())
  const [date, setDate] = useState(nowP.date)
  const [time, setTime] = useState(nowP.time)
  const startMs = crToMs(date, time)
  const startOk = Number.isFinite(startMs)
  const out = useOutcomes()

  const create = async (kind: CookKind) => {
    try {
      const r = newRun(kind, { heater, startedAt: startOk ? startMs : Date.now() })
      await d.store.put('cook_runs', r)
      sound.granted()
      say(`${KIND_LABEL[kind]} RUN STARTED. ADD READINGS ON THE READINGS TAB.`)
      set({ sel: r.id, tab: 'RUN' })
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }

  const done = d.runs.filter((r) => d.info.get(r.id)?.an.verdict !== 'pending')
  const passed = done.filter((r) => d.info.get(r.id)?.an.verdict === 'pass').length
  const month = crParts(d.now).date.slice(0, 7)
  const mRuns = d.runs.filter((r) => r.started_at && crParts(Date.parse(r.started_at)).date.startsWith(month))
  const mKwh = mRuns.reduce((n, r) => n + (d.info.get(r.id)?.en.kwh ?? 0), 0)
  // loss by verdict: only runs that have linked loads
  const byV = (v: 'pass' | 'fail') => {
    const rs = d.runs.filter((r) => d.info.get(r.id)?.an.verdict === v).map((r) => out.of(r.id)).filter((o) => o.loaded > 0)
    const loaded = rs.reduce((n, o) => n + o.loaded, 0)
    const lost = rs.reduce((n, o) => n + o.lost, 0)
    return { runs: rs.length, loaded, lost }
  }
  const pv = byV('pass')
  const fv = byV('fail')
  const kinds: CookKind[] = ['steam_box', 'pressure_75x', 'megachef', 'other']
  const guesses = TARGETS.filter((t) => t.guess)

  return (
    <div className="ck-over">
      <div className="section-title">PROPULSION // COOK AND STERILIZATION LOG</div>
      <div className="ck-sum">
        <span>RUNS <b>{d.runs.length}</b></span>
        <span>CLOSED <b>{done.length}</b></span>
        <span>PASSED <b>{passed}</b></span>
        <span>THIS MONTH <b>{mRuns.length}</b> RUNS, <b>{kwhText(mKwh)}</b>, <b>{crc(mKwh * ICE_RATE_CRC)}</b></span>
      </div>

      <div className="ck-box">
        <div className="section-title">START A RUN</div>
        <div className="ck-row">
          <label className="ck-field"><span>START DATE (COSTA RICA)</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="ck-field"><span>START TIME</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <button type="button" className="btn" onClick={() => (setDate(crParts(Date.now()).date), setTime(crParts(Date.now()).time))}>NOW</button>
        </div>
        {!startOk && <div className="warn">PICK A DATE AND TIME.</div>}
        <div className="ck-peakcheck">
          {kinds.slice(0, 3).map((k) => {
            if (!startOk) return null
            const p = plannedPeaks(k, heater, startMs)
            const end = startMs + p.minutes * MIN
            return (
              <div key={k} className={p.hits.length ? 'ck-pc warn' : 'ck-pc'}>
                <b>{KIND_LABEL[k]}</b> {crParts(startMs).time} TO ABOUT {crParts(end).time}
                {p.hits.length ? (
                  <> // {p.hits.map((h) => `${Math.round(h.minutes)} MIN INSIDE PEAK ${h.label} (${h.kwh.toFixed(1)} KWH)`).join(', ')}. MOVE THE START OR STAGE THE HEATER.</>
                ) : (
                  <> // CLEAR OF THE ICE PEAK WINDOWS</>
                )}
              </div>
            )
          })}
          <div className="dim tiny">
            PEAK WINDOWS {ICE_PEAKS.map((w) => `${w.from}-${w.to}`).join(' AND ')}. LENGTHS: STEAM BOX ABOUT {hm(plannedPeaks('steam_box', heater, 0).minutes)} (COME-UP + 4 H HOLD), 75X ABOUT {hm(plannedPeaks('pressure_75x', heater, 0).minutes)}, MEGACHEF ABOUT {hm(plannedPeaks('megachef', heater, 0).minutes)}. <Guess /> THE 6.5 KW COME-UP IS SCALED FROM THE 9 KW FIGURE.
          </div>
        </div>
        <div className="ck-btns">
          {kinds.map((k) => (
            <button key={k} type="button" className="btn" onClick={() => void create(k)} disabled={!startOk} title={KIND_LONG[k]}>
              + {KIND_LABEL[k]} RUN
            </button>
          ))}
        </div>
        <div className="tiny dim">
          STEAM HEATER FROM VITALS: <button type="button" className="ck-link" onClick={onOpenVitals}>{HEATER_OPTIONS[heater].label} ({heaterWatts(heater).toLocaleString('en-US')} W)</button>. THE CHOICE IS SAVED ON EACH RUN WHEN IT STARTS.
        </div>
      </div>

      {(pv.loaded > 0 || fv.loaded > 0) && (
        <div className="ck-box">
          <div className="section-title">WHAT HAPPENED TO THE LOADS</div>
          <table className="pl-table">
            <thead><tr><th>VERDICT</th><th>RUNS</th><th>LOADED</th><th>LOST</th><th>LOSS</th></tr></thead>
            <tbody>
              {([['PASS', pv], ['FAIL', fv]] as const).map(([n, v]) => (
                <tr key={n}><td>{n}</td><td>{v.runs}</td><td>{v.loaded}</td><td>{v.lost}</td><td>{v.loaded ? `${((v.lost / v.loaded) * 100).toFixed(1)}%` : '--'}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="tiny dim">ONLY RUNS WITH LINKED BLOCK LOTS OR GRAIN RUNS. LOSSES COME FROM XENOGENETICS (LOG LOSS) AND THE HAZARD INDEX.</div>
        </div>
      )}

      <div className="ck-btns">
        <button type="button" className="btn" onClick={onPrint}>PRINT BLANK LOG SHEET</button>
        <button type="button" className="btn" onClick={() => set({ sel: null, tab: 'TARGETS' })}>TARGETS AND SOURCES</button>
      </div>

      <div className="ck-box">
        <div className="section-title">GUESSES WAITING FOR REVIEW ({guesses.length})</div>
        <ul className="ck-guesses">
          {guesses.map((g) => (
            <li key={g.id}><Guess /> <b>{g.what}</b>: {g.want}</li>
          ))}
        </ul>
        <div className="tiny dim">SOURCES AND REASONS ARE ON THE TARGETS TAB. CHANGE ANY OF THEM IN src/data/cook.ts.</div>
      </div>
    </div>
  )
}

// ---------- targets and sources ----------

function Targets() {
  return (
    <div className="ck-targets">
      <div className="section-title">TARGETS AND SOURCES</div>
      <div className="dim tiny">EVERY NUMBER THE LOG JUDGES BY. SOURCES ARE JOSEPH'S OWN FILES. WHERE THEY DISAGREE, CAP N STEM IS FINAL, AND THE OTHER FIGURES SHOW AS CONTEXT. THE FARM HOLD IS THE 4 H JOSEPH CONFIRMED.</div>
      <div className="ck-scroll">
        <table className="pl-table ck-tt">
          <thead><tr><th>WHAT</th><th>TARGET</th><th>SOURCE</th></tr></thead>
          <tbody>
            {TARGETS.map((t) => (
              <tr key={t.id}>
                <td>{t.what}</td>
                <td>{t.want}</td>
                <td>{t.source} {t.guess && <Guess />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-title" style={{ marginTop: 12 }}>CONTEXT: WHERE THE SOURCES DIFFER</div>
      {CONTEXT.map((c) => (
        <div key={c.id} className="ck-ctx">
          <b>{c.label}</b>
          <div>{c.v === '' ? <span className="dim">LOCKED. THE TEXTBOOK NOTES ARE IN THE PRIVATE TEST COPY UNTIL THE LOGIN IS LINKED.</span> : c.v}</div>
          {c.v !== '' && <div className="tiny dim">{c.source}</div>}
        </div>
      ))}
      <div className="tiny dim ck-rate">{ICE_RATE_SOURCE}</div>
    </div>
  )
}

// ---------- RUN tab ----------

function RunTab({ run, info, say, set, onOpenHazard, onOpenXeno, onOpenVitals, onOpenSequence }: { run: CookRun; info: RunInfo; say: Say; set: SetCook; onOpenHazard: () => void; onOpenXeno: () => void; onOpenVitals: () => void; onOpenSequence: () => void }) {
  const { sound } = useApp()
  const store = useStore()
  const { an, en } = info
  const guard = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      sound.confirm()
      say(ok)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const save = (patch: Partial<CookRun>, ok = 'SAVED') => guard(() => saveRun(store, run, patch), ok)
  const num = (v: string): number | null | 'bad' => {
    if (v.trim() === '') return null
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : 'bad'
  }
  const saveNum = (key: keyof CookRun, int = false) => (v: string) => {
    const n = num(v)
    if (n === 'bad') return say('THAT IS NOT A NUMBER.', true)
    void save({ [key]: n === null ? null : int ? Math.round(n) : n } as Partial<CookRun>)
  }
  const sp = (iso: string | null) => (iso ? crParts(Date.parse(iso)) : { date: '', time: '', minuteOfDay: 0 })
  const saveTime = (which: 'started_at' | 'ended_at', part: 'date' | 'time') => (v: string) => {
    const cur = sp(run[which])
    const fallback = crParts(Date.now())
    const date = part === 'date' ? v : cur.date || fallback.date
    const time = part === 'time' ? v : cur.time || (which === 'ended_at' ? fallback.time : '00:00')
    if (which === 'ended_at' && part === 'date' && v === '') return void save({ ended_at: null }, 'RUN REOPENED')
    const ms = crToMs(date, time)
    if (!Number.isFinite(ms)) return say('DATE AS YYYY-MM-DD AND TIME AS HH:MM.', true)
    void save({ [which]: new Date(ms).toISOString() } as Partial<CookRun>)
  }
  const moves = useTable<Move>('stock_moves')
  const seqRuns = useMemo(() => {
    const m = new Map<string, { ref: string; note: string; at: string }>()
    for (const mv of moves) if (mv.run_ref && !m.has(mv.run_ref)) m.set(mv.run_ref, { ref: mv.run_ref, note: mv.notes ?? '', at: mv.moved_at })
    return [...m.values()].sort((a, b) => b.at.localeCompare(a.at))
  }, [moves])
  const seq = seqRuns.find((s) => s.ref === run.seq_run_ref)
  const pickSeq = (ref: string) => {
    const s = seqRuns.find((q) => q.ref === ref)
    const bags = s ? /^(\d+) BAGS/.exec(s.note)?.[1] : undefined
    void save({ seq_run_ref: ref || null, ...(bags && run.bag_count === null ? { bag_count: Number(bags) } : {}) }, ref ? 'LINKED TO THE SEQUENCE RUN' : 'LINK REMOVED')
  }
  const finish = () => {
    const end = an.end && an.end > (an.origin ?? 0) ? an.end : Date.now()
    void save({ ended_at: new Date(end).toISOString() }, 'RUN CLOSED')
  }
  const purpose = run.purpose ?? DEFAULT_PURPOSE[run.kind]
  const isSteam = run.kind === 'steam_box'
  const cook = run.kind === 'megachef' || run.kind === 'pressure_75x'
  const unitHeat = run.kind === 'steam_box' ? 'HEATER ON-TIME (MIN)' : 'ON-TIME (MIN)'

  return (
    <div className="ck-run">
      <section className="ck-box">
        <div className="section-title">CHECKS AGAINST THE TARGETS</div>
        {an.checks.length === 0 ? (
          <div className="dim">
            {run.kind === 'megachef' ? 'TYPE THE TIME TO PRESSURE AND THE COOK TIME BELOW.' : run.kind === 'pressure_75x' ? 'LOG GAUGE READINGS (PSI) ON THE READINGS TAB, OR TYPE THE HOLD MINUTES BELOW.' : 'NO READINGS YET. ADD CORE READINGS ON THE READINGS TAB OR IMPORT A LOGGER FILE.'}
          </div>
        ) : (
          <div className="ck-scroll">
            <table className="pl-table ck-checks">
              <thead><tr><th>CHECK</th><th>TARGET</th><th>THIS RUN</th><th /></tr></thead>
              <tbody>
                {an.checks.map((c) => (
                  <tr key={c.id} className={`ck-st ${c.status}`}>
                    <td>
                      {c.label}
                      <div className="ck-src tiny dim">{c.source} {c.guess && <Guess />}</div>
                    </td>
                    <td>{c.want}</td>
                    <td>{c.got}</td>
                    <td className={`ck-status ${c.status}`}>{STATUS_TEXT[c.status]}{c.verdict ? '*' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="tiny dim">* COUNTS TOWARD THE VERDICT. THE OTHERS ARE WARNINGS OR INFORMATION. THE VERDICT IS ALSO SAVED ON THE RUN AS PASS OR FAIL.</div>
        {an.zones.some((z) => z.judged) && an.zones.filter((z) => z.judged).length > 1 && an.slow && <div className="tiny">JUDGED ON THE SLOWEST CORE: <b>{an.slow.zone}</b></div>}
      </section>

      <section className="ck-box">
        <div className="section-title">ENERGY</div>
        <div className="ck-kv">
          <span>ENERGY</span><b>{kwhText(en.kwh)} {en.basis ? `(${en.basis})` : ''}</b>
          <span>COST AT ₡{ICE_RATE_CRC}/KWH</span><b>{crc(en.cost)} <span className="dim">{en.costTax !== null && `(${crc(en.costTax)} WITH 16% TAXES)`}</span></b>
          {run.bag_count && en.kwh !== null ? (<><span>PER BAG</span><b>{(en.kwh / run.bag_count).toFixed(2)} KWH // {crc((en.cost ?? 0) / run.bag_count)}</b></>) : null}
          {en.watts > 0 && (<><span>FULL POWER</span><b>{en.watts.toLocaleString('en-US')} W {isSteam && <button type="button" className="ck-link" onClick={onOpenVitals}>({HEATER_OPTIONS[run.heater_option ?? '2x4500'].short} FROM VITALS)</button>}</b></>)}
        </div>
        {en.basis === 'ESTIMATE' && (
          <div className="tiny"><Guess /> ESTIMATE: FULL POWER UNTIL THE CORE REACHES 200 F, THEN {run.kind === 'steam_box' ? 'ABOUT 1.5 KW' : run.kind === 'pressure_75x' ? 'HALF POWER' : 'FULL POWER'}. TYPE A METER READING OR THE ON-TIME BELOW AND THIS BECOMES REAL.</div>
        )}
        {en.peaks.length > 0 ? (
          <div className="ck-peaks">
            {en.peaks.map((p: PeakHit) => (
              <div key={p.label + p.minutes} className="warn">
                PEAK WINDOW {p.label}: THIS RUN WAS ON FOR {Math.round(p.minutes)} MIN OF IT, ABOUT {p.kwh.toFixed(1)} KWH AT THE ESTIMATED POWER. HEAVY LOADS BELONG OUTSIDE THE ICE PEAK.
              </div>
            ))}
          </div>
        ) : (
          en.profile.length > 0 && <div className="tiny">CLEAR OF THE ICE PEAK WINDOWS ({ICE_PEAKS.map((w) => `${w.from}-${w.to}`).join(', ')}).</div>
        )}
        <div className="tiny dim">{ICE_RATE_SOURCE} THE RUN'S HEATER LOAD ALSO RAISES THE MONTH'S DEMAND ABOVE 8 KW, WHICH IS BILLED ON TOP.</div>
      </section>

      <Outcome run={run} onOpenHazard={onOpenHazard} onOpenXeno={onOpenXeno} say={say} guard={guard} purpose={purpose} />

      <section className="ck-box">
        <div className="section-title">RUN DETAILS</div>
        <div className="ck-fields">
          <Pick label="EQUIPMENT" value={run.kind} options={(['steam_box', 'pressure_75x', 'megachef', 'other'] as CookKind[]).map((k) => ({ id: k, label: KIND_LONG[k] }))} onPick={(k) => void save({ kind: k, purpose: DEFAULT_PURPOSE[k], heater_option: k === 'steam_box' ? (run.heater_option ?? '2x4500') : null, pots: k === 'megachef' ? run.pots ?? 4 : null })} wide />
          <Pick label="PURPOSE" value={purpose} options={(['substrate', 'grain', 'agar', 'other'] as Purpose[]).map((p) => ({ id: p, label: PURPOSE_LABEL[p] }))} onPick={(p) => void save({ purpose: p })} />
          <Field label="VESSEL OR ROUND" value={run.unit_label ?? ''} placeholder="E.G. ROUND A, CART 1" onSave={(v) => void save({ unit_label: v || null })} />
          <Field label="LOAD" value={run.load_desc ?? ''} placeholder="E.G. 52 BLUE OYSTER + 46 LION'S MANE" onSave={(v) => void save({ load_desc: v || null })} wide />
          <Field label="BAGS" value={run.bag_count === null ? '' : String(run.bag_count)} inputMode="numeric" onSave={saveNum('bag_count', true)} />
          {run.kind === 'megachef' && <Field label="POTS (1-4)" value={run.pots === null ? '' : String(run.pots)} inputMode="numeric" onSave={saveNum('pots', true)} />}
          {isSteam && (
            <Pick label="STEAM HEATER" value={run.heater_option ?? '2x4500'} options={(Object.keys(HEATER_OPTIONS) as HeaterOption[]).map((h) => ({ id: h, label: HEATER_OPTIONS[h].label }))} onPick={(h) => void save({ heater_option: h })} wide />
          )}
          <Field label="START DATE" type="date" value={sp(run.started_at).date} onSave={saveTime('started_at', 'date')} />
          <Field label="START TIME" type="time" value={sp(run.started_at).time} onSave={saveTime('started_at', 'time')} />
          <Field label="END DATE (EMPTY = RUNNING)" type="date" value={sp(run.ended_at).date} onSave={saveTime('ended_at', 'date')} />
          <Field label="END TIME" type="time" value={sp(run.ended_at).time} onSave={saveTime('ended_at', 'time')} />
          {cook && <Field label={run.kind === 'megachef' ? 'TIME TO PRESSURE (MIN)' : 'HEAT-UP TO PRESSURE (MIN)'} value={run.come_up_minutes === null ? '' : String(run.come_up_minutes)} inputMode="numeric" onSave={saveNum('come_up_minutes', true)} hint={an.comeUp !== null && run.kind === 'pressure_75x' ? `FROM THE GAUGE: ${hm(an.comeUp)}` : undefined} />}
          {cook && <Field label={run.kind === 'megachef' ? 'COOK TIME (MIN)' : 'HOLD AT PRESSURE (MIN, IF NO GAUGE LOG)'} value={run.cook_minutes === null ? '' : String(run.cook_minutes)} inputMode="decimal" onSave={saveNum('cook_minutes')} />}
          <Field label="METER READING FOR THIS RUN (KWH)" value={run.kwh_metered === null ? '' : String(run.kwh_metered)} inputMode="decimal" onSave={saveNum('kwh_metered')} hint="BEST: READ THE ICE METER BEFORE AND AFTER" />
          <Field label={unitHeat} value={run.heater_on_min === null ? '' : String(run.heater_on_min)} inputMode="decimal" onSave={saveNum('heater_on_min')} hint="FROM THE CONTROLLER, IF IT SHOWS IT" />
          <label className="ck-field wide">
            <span>LINKED SEQUENCE RUN</span>
            <Select value={run.seq_run_ref ?? ''} onChange={(e) => pickSeq(e.target.value)}>
              <option value="">NONE</option>
              {seqRuns.map((s) => <option key={s.ref} value={s.ref}>{s.ref} // {s.note || 'BOOKED RUN'}</option>)}
              {run.seq_run_ref && !seq && <option value={run.seq_run_ref}>{run.seq_run_ref}</option>}
            </Select>
            <em>{seqRuns.length ? 'RUNS BOOKED WITH COMMIT RUN TO CARGO IN SEQUENCE.' : 'NO BOOKED RUNS YET. USE COMMIT RUN TO CARGO IN SEQUENCE.'} <button type="button" className="ck-link" onClick={onOpenSequence}>OPEN SEQUENCE</button></em>
          </label>
          <Field label="NOTES" value={run.notes ?? ''} placeholder="DOOR OPENINGS, WATER, WHAT WENT WRONG" onSave={(v) => void save({ notes: v || null })} wide />
        </div>
        <div className="ck-btns">
          {!run.ended_at ? <button type="button" className="btn" onClick={finish}>CLOSE THE RUN</button> : <button type="button" className="btn" onClick={() => void save({ ended_at: null }, 'RUN REOPENED')}>REOPEN</button>}
          <button type="button" className="btn" onClick={() => set({ tab: 'READINGS' })}>ADD READINGS</button>
          <Confirm label="DELETE THIS RUN" onYes={() => void guard(async () => { await removeRun(store, run.id); set({ sel: null }) }, 'RUN DELETED')} />
        </div>
      </section>
    </div>
  )
}

// ---------- loads and later outcome ----------

function Outcome({ run, onOpenHazard, onOpenXeno, guard, purpose }: { run: CookRun; onOpenHazard: () => void; onOpenXeno: () => void; say: Say; guard: (fn: () => Promise<void>, ok: string) => Promise<void>; purpose: Purpose }) {
  const store = useStore()
  const o = useOutcomes()
  const out = o.of(run.id)
  const grainRun = purpose === 'grain' || purpose === 'agar'
  const cand = grainRun
    ? o.grain.filter((g) => !g.cook_run_id || g.cook_run_id === run.id).sort((a, b) => b.inoculated_on.localeCompare(a.inoculated_on)).slice(0, 14)
    : o.lots.filter((l) => !l.cook_run_id || l.cook_run_id === run.id).sort((a, b) => b.knock_date.localeCompare(a.knock_date)).slice(0, 14)
  const linked = (id: string | null | undefined) => id === run.id
  return (
    <section className="ck-box">
      <div className="section-title">LOADS AND WHAT HAPPENED TO THEM</div>
      {out.loaded > 0 ? (
        <div className="ck-kv">
          <span>LOADED</span><b>{out.loaded}</b>
          <span>LOST SINCE</span><b className={out.lost ? 'warn' : ''}>{out.lost} ({((out.lost / out.loaded) * 100).toFixed(1)}%)</b>
        </div>
      ) : (
        <div className="dim tiny">NOTHING LINKED YET. TICK THE {grainRun ? 'GRAIN RUNS' : 'BLOCK LOTS'} THAT CAME OUT OF THIS RUN. LATER LOSSES LOGGED IN XENOGENETICS SHOW HERE.</div>
      )}
      {out.lots.map(({ lot, lost, causes }) => (
        <div key={lot.id} className="ck-load">LOT <b>{lot.lot_code}</b> // {lot.bag_count} BLOCKS // {lot.status.toUpperCase()} // LOST {lost}{causes.length ? ` // ${causes.join(', ')}` : ''}</div>
      ))}
      {out.grain.map(({ g, lost, causes }) => (
        <div key={g.id} className="ck-load">{g.generation} <b>{g.label || g.inoculated_on}</b> // {g.bag_count} BAGS // {g.status.toUpperCase()} // LOST {lost}{causes.length ? ` // ${causes.join(', ')}` : ''}</div>
      ))}
      {cand.length > 0 && (
        <details className="ck-link-pick">
          <summary>LINK {grainRun ? 'GRAIN RUNS' : 'BLOCK LOTS'} ({cand.length} RECENT)</summary>
          {(cand as (BlockLot | GrainRun)[]).map((c) => {
            const isLot = 'lot_code' in c
            const label = isLot ? `${(c as BlockLot).lot_code} // ${(c as BlockLot).bag_count} BLOCKS // ${(c as BlockLot).knock_date}` : `${(c as GrainRun).generation} ${(c as GrainRun).label || ''} // ${(c as GrainRun).bag_count} BAGS // ${(c as GrainRun).inoculated_on}`
            return (
              <label key={c.id} className="ck-check">
                <input type="checkbox" checked={linked(c.cook_run_id)} onChange={(e) => void guard(() => linkLoad(store, isLot ? 'block_lots' : 'grain_runs', c, e.target.checked ? run.id : null), e.target.checked ? 'LOAD LINKED' : 'LOAD UNLINKED')} />
                <span>{label}</span>
              </label>
            )
          })}
        </details>
      )}
      <div className="ck-btns">
        <button type="button" className="btn" onClick={onOpenXeno}>XENOGENETICS: LOG A LOSS</button>
        <button type="button" className="btn" onClick={onOpenHazard}>HAZARD INDEX</button>
      </div>
    </section>
  )
}

// ---------- READINGS tab ----------

function ReadingsTab({ run, an, readings, say }: { run: CookRun; an: RunAnalysis; readings: CookReading[]; say: Say }) {
  const { sound } = useApp()
  const store = useStore()
  const mine = useMemo(() => readings.filter((r) => r.cook_run_id === run.id).sort((a, b) => b.taken_at.localeCompare(a.taken_at)), [readings, run.id])
  const zones = useMemo(() => {
    const z = [...DEFAULT_ZONES[run.kind]]
    for (const n of zoneNames(mine)) if (!z.includes(n)) z.push(n)
    return z
  }, [run.kind, mine])
  const [vals, setVals] = useState<Record<string, string>>({})
  const [unit, setUnit] = useState<'F' | 'C'>(() => {
    try {
      return localStorage.getItem('mycol.cook.unit') === 'C' ? 'C' : 'F'
    } catch {
      return 'F'
    }
  })
  const [time, setTime] = useState('')
  const [extra, setExtra] = useState('')
  const [every, setEvery] = useState(15)
  const [remind, setRemind] = useState(false)
  const [nextDue, setNextDue] = useState(0)
  const [due, setDue] = useState(false)
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    if (!remind) return
    const t = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [remind])
  useEffect(() => {
    if (remind && !due && tick >= nextDue) {
      setDue(true)
      sound.chirp()
    }
  }, [tick, remind, due, nextDue, sound])

  const parse = (v: string): number | 'bad' | null => {
    if (v.trim() === '') return null
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 'bad'
  }
  const add = async () => {
    let at = Date.now()
    if (time) {
      const p = crParts(at)
      at = crToMs(p.date, time)
      if (!Number.isFinite(at)) return say('TIME AS HH:MM.', true)
      if (at > Date.now() + 5 * MIN) at -= 24 * 3600000 // a time later than now means yesterday evening
    }
    const rows: CookReading[] = []
    for (const z of [...zones, ...(extra.trim() ? [extra.trim().toUpperCase()] : [])]) {
      const raw = z === extra.trim().toUpperCase() ? vals.__extra ?? '' : vals[z] ?? ''
      const v = parse(raw)
      if (v === null) continue
      if (v === 'bad') return say(`${z}: THAT IS NOT A NUMBER.`, true)
      if (z === 'GAUGE') rows.push(newReading(run.id, at, 'GAUGE', null, v))
      else {
        const f = unit === 'C' ? cToF(v) : v
        if (f < -40 || f > 400) return say(`${z}: ${v} LOOKS WRONG FOR ${unit === 'C' ? 'DEG C' : 'DEG F'}.`, true)
        rows.push(newReading(run.id, at, z, Math.round(f * 10) / 10, null))
      }
    }
    if (!rows.length) return say('TYPE AT LEAST ONE READING.', true)
    try {
      await addReadings(store, run.id, rows)
      sound.confirm()
      say(`${rows.length} READING${rows.length > 1 ? 'S' : ''} SAVED AT ${crParts(at).time}`)
      setVals({})
      setTime('')
      setExtra('')
      if (remind) {
        setDue(false)
        setNextDue(Date.now() + every * MIN)
      }
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const setU = (u: 'F' | 'C') => {
    setUnit(u)
    try {
      localStorage.setItem('mycol.cook.unit', u)
    } catch {
      // blocked storage: the unit just resets next time
    }
  }
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? mine : mine.slice(0, 30)
  const left = Math.max(0, Math.ceil((nextDue - tick) / 1000))

  return (
    <div className="ck-read">
      <section className={`ck-box ${due ? 'due' : ''}`}>
        <div className="section-title">QUICK ADD A READING</div>
        {run.kind === 'steam_box' && <div className="dim tiny">PUT THE NEEDLE IN THE COLDEST BAG: BOTTOM SHELF, DOOR SIDE (CORE). THE CORE DECIDES THE RUN. BOX AIR IS FOR COMPARISON ONLY.</div>}
        <div className="ck-unit">
          <button type="button" className={`btn ${unit === 'F' ? 'on' : ''}`} onClick={() => setU('F')}>DEG F</button>
          <button type="button" className={`btn ${unit === 'C' ? 'on' : ''}`} onClick={() => setU('C')}>DEG C</button>
          <label className="ck-field inline"><span>TIME (EMPTY = NOW)</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        <div className="ck-fields ck-quick">
          {zones.map((z) => (
            <label key={z} className="ck-field">
              <span>{z === 'GAUGE' ? 'GAUGE (PSI)' : z}</span>
              <input inputMode="decimal" value={vals[z] ?? ''} placeholder={z === 'GAUGE' ? 'PSI' : unit === 'C' ? 'DEG C' : 'DEG F'} onChange={(e) => setVals((v) => ({ ...v, [z]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && void add()} />
            </label>
          ))}
          <label className="ck-field">
            <span>ANOTHER PROBE</span>
            <div className="ck-two">
              <input value={extra} onChange={(e) => setExtra(e.target.value.toUpperCase())} placeholder="NAME" maxLength={14} />
              <input inputMode="decimal" value={vals.__extra ?? ''} onChange={(e) => setVals((v) => ({ ...v, __extra: e.target.value }))} placeholder="VALUE" onKeyDown={(e) => e.key === 'Enter' && void add()} />
            </div>
          </label>
        </div>
        <div className="ck-btns">
          <button type="button" className="btn on" onClick={() => void add()}>ADD READING</button>
          <label className="ck-check inline">
            <input type="checkbox" checked={remind} onChange={(e) => { setRemind(e.target.checked); setDue(false); setNextDue(Date.now() + every * MIN) }} />
            <span>REMIND ME EVERY</span>
          </label>
          <Select value={every} onChange={(e) => { setEvery(Number(e.target.value)); setNextDue(Date.now() + Number(e.target.value) * MIN); setDue(false) }} aria-label="Reminder interval in minutes">
            {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} MIN</option>)}
          </Select>
          {remind && <span className={due ? 'warn ck-due' : 'dim'}>{due ? 'READING DUE NOW' : `NEXT IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>}
        </div>
        <div className="tiny dim">THE REMINDER ONLY WORKS WHILE THIS SCREEN IS OPEN AND THE PHONE IS AWAKE. FOR A LONG RUN USE A LOGGER AND IMPORT THE FILE.</div>
      </section>

      <CsvImport run={run} zones={zones} say={say} onImport={(rows) => addReadings(store, run.id, rows)} />

      <section className="ck-box">
        <div className="section-title">READINGS ({mine.length})</div>
        {an.gaps.length > 0 && <div className="warn tiny">{an.gaps.length} GAP{an.gaps.length > 1 ? 'S' : ''} OVER 45 MIN. THE CURVE RUNS STRAIGHT ACROSS THEM.</div>}
        {mine.length === 0 && <div className="dim">NONE YET.</div>}
        {mine.length > 0 && (
          <div className="ck-scroll">
            <table className="pl-table">
              <thead><tr><th>TIME (CR)</th><th>PROBE</th><th>DEG F</th><th>DEG C</th><th>PSI</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>{crParts(Date.parse(r.taken_at)).date.slice(5)} {crParts(Date.parse(r.taken_at)).time}</td>
                    <td>{r.zone}</td>
                    <td>{r.temp_f === null ? '' : r.temp_f.toFixed(1)}</td>
                    <td>{r.temp_f === null ? '' : fToC(r.temp_f).toFixed(1)}</td>
                    <td>{r.psi === null ? '' : r.psi}</td>
                    <td><button type="button" className="ck-x" aria-label="Delete this reading" onClick={() => void removeReadings(store, run.id, [r.id]).catch((e) => say(String(e), true))}>X</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mine.length > 30 && <button type="button" className="btn" onClick={() => setShowAll(!showAll)}>{showAll ? 'SHOW LATEST 30' : `SHOW ALL ${mine.length}`}</button>}
        {mine.length > 0 && <Confirm label="DELETE ALL READINGS" onYes={() => void removeReadings(store, run.id, mine.map((r) => r.id)).then(() => say('READINGS DELETED')).catch((e) => say(String(e), true))} />}
      </section>
    </div>
  )
}

// Re-run the numbers once when a run opens, so rows saved before an update get the new columns.
export function useRefreshOnOpen(id: string | null) {
  const store = useStore()
  useEffect(() => {
    if (id) void recompute(store, id).catch(() => undefined)
  }, [id, store])
}
