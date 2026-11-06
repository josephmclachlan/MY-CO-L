// XENOGENETICS > BANK: the culture bank (build G3). Slants and water tubes only, no cryo freezer.
// Rules: textbook t08 "Our farm" (intake, refresh, T/E test, viability log), t09 "Our farm" (monthly
// strain check from production lots), t16 "Our farm" (contamination below 5% at every stage).

import { useState, type ReactNode } from 'react'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HistoryButton } from './History'
import { RefText } from '../manual/ManualLinks'
import { useStore, useTable } from '../store/StoreContext'
import { usePractice, usePracticeEditor } from '../store/usePractice'
import type { LotLoss } from '../lib/hazard'
import { AGE_TONE, Confirm, MiniGlyph, Num, ageOf, spName, useRun, type Say, type SetXeno, type XData, type XenoState } from './Xeno'
import { KIND_LABEL, isActiveCulture, pLabel, todayIso, type BlockLot, type Culture, type GrainRun, type Strain } from '../lib/xeno'
import { setCultureStatus } from '../lib/xenoActions'
import {
  APPEARANCES,
  DEFAULT_PRACTICE,
  PRACTICE_GUESS,
  REASON_LABEL,
  STAGE_TEXT,
  bankStatus,
  baselineDays,
  chainSurvival,
  isBankTube,
  isHeld,
  lastCheck,
  stageContam,
  strainCheck,
  suggestResult,
  type BankTest,
  type CheckResult,
  type Practice,
  type TestReason,
} from '../lib/bank'
import { bankBatch, decideTest, logCheck, plateMaster, setOffsite, startTest, watchStrain } from '../lib/bankActions'

// ---------- practice settings ----------

const FIELD_TEXT: Record<keyof Practice, { label: string; unit?: string; months?: boolean }> = {
  contamTargetPct: { label: 'CONTAMINATION TARGET, EVERY STAGE', unit: '%' },
  spareBlockPct: { label: 'SPARE-BLOCK BUFFER', unit: '% OF BLOCKS' },
  spareMasters: { label: 'SPARE MASTERS A WEEK', unit: 'BAGS' },
  smallLineRoute: { label: 'UNDER 6 G2 A WEEK' },
  bagsPer75xRun: { label: '75X BAGS A RUN', unit: 'BAGS' },
  runsPerGrainDay: { label: '75X RUNS ON GRAIN DAY', unit: 'RUNS' },
  bankSlants: { label: 'SLANTS PER BANK BATCH', unit: 'TUBES' },
  bankWater: { label: 'WATER TUBES PER BANK BATCH', unit: 'TUBES' },
  slantReplaceDays: { label: 'REPLACE SLANTS AFTER', unit: 'MONTHS', months: true },
  waterCheckDays: { label: 'CHECK WATER TUBES AFTER', unit: 'MONTHS', months: true },
  waterOverDays: { label: 'WATER CHECK OVERDUE AFTER', unit: 'MONTHS', months: true },
  suspectDays: { label: 'TUBE SUSPECT AFTER', unit: 'MONTHS', months: true },
  slowerPct: { label: 'WATCH IF SLOWER THAN BASELINE BY', unit: '%' },
  yieldDropPct: { label: 'SLIPPING IF YIELD DROPS BY', unit: '%' },
  buyerCapPct: { label: 'ONE BUYER CAP, SHARE OF WEEKLY ORDERS', unit: '%' },
  flushPlan: { label: 'FLUSHES PER SPECIES (SET IN PRODUCTION RECORDS > FLUSH TEST)' },
}

const ROUTES = [
  ['weekly', 'STILL ONE MASTER A WEEK (FARM RULE)'],
  ['fortnight', 'ONE MASTER EVERY 2 WEEKS'],
  ['direct', 'AGAR-DIRECT, NO MASTER'],
] as const

const toMonths = (days: number) => Math.round((days / 30.44) * 10) / 10
const fromMonths = (m: number) => Math.round(m * 30.44)

function PracticeNum({ k, p, save }: { k: keyof Practice; p: Practice; save: (patch: Partial<Practice>, label: string) => void }) {
  const t = FIELD_TEXT[k]
  const raw = p[k] as number
  const shown = t.months ? toMonths(raw) : raw
  const [draft, setDraft] = useState(String(shown))
  const [seen, setSeen] = useState(shown)
  if (shown !== seen) {
    setSeen(shown)
    setDraft(String(shown))
  }
  const commit = () => {
    const n = Number(draft.replace(',', '.'))
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(shown))
    const v = t.months ? fromMonths(n) : n
    if (v !== raw) save({ [k]: v } as Partial<Practice>, `${t.label} SET TO ${draft.trim()} ${t.unit ?? ''}`.trim())
  }
  const def = DEFAULT_PRACTICE[k] as number
  return (
    <label className="cg-field xb-pf">
      <span>{t.label}</span>
      <span className="xb-pf-in">
        <input inputMode="decimal" aria-label={t.label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <span className="dim tiny">{t.unit} {raw !== def ? `(DEFAULT ${t.months ? toMonths(def) : def})` : '(DEFAULT)'}</span>
      </span>
      {PRACTICE_GUESS[k] && <span className="dim tiny">{PRACTICE_GUESS[k]}</span>}
    </label>
  )
}

/** Editable practice defaults, saved for the whole farm (app_settings row 'practice'). */
export function PracticeFields({ keys, title, say }: { keys: (keyof Practice)[]; title: string; say?: Say }) {
  const [p, save] = usePracticeEditor()
  const [open, setOpen] = useState(false)
  const run = (patch: Partial<Practice>, label: string) =>
    void save(patch, label).then(
      () => say?.(label),
      (e) => say?.(e instanceof Error ? e.message : String(e), true),
    )
  return (
    <div className="xb-practice">
      <button type="button" className={`btn ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? `DONE: CLOSE ${title}` : `CHANGE ${title}`}
      </button>
      {open && <div className="dim tiny">TYPE A NUMBER, THEN PRESS ENTER OR LEAVE THE BOX TO SAVE. SAVED FOR THE WHOLE FARM, WITH UNDO AND HISTORY.</div>}
      {open && (
        <div className="cg-fields">
          {keys.map((k) =>
            k === 'smallLineRoute' ? (
              <label key={k} className="cg-field">
                <span>{FIELD_TEXT[k].label}</span>
                <Select aria-label={FIELD_TEXT[k].label} value={p.smallLineRoute} onChange={(e) => run({ smallLineRoute: e.target.value as Practice['smallLineRoute'] }, `SMALL SPECIES: ${ROUTES.find((r) => r[0] === e.target.value)?.[1] ?? e.target.value}`)}>
                  {ROUTES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
                <span className="dim tiny">JOSEPH 6 NOV 2026: FEWER THAN 6 G2 PER MASTER IS FINE, NEVER MORE THAN 24.</span>
              </label>
            ) : (
              <PracticeNum key={k} k={k} p={p} save={run} />
            ),
          )}
        </div>
      )}
    </div>
  )
}

// ---------- contamination by stage ----------

export function ContamPanel({ d }: { d: Pick<XData, 'cultures' | 'runs' | 'lots' | 'lotLoss' | 'practice'> }) {
  const target = d.practice.contamTargetPct
  const rates = stageContam(d, target)
  const left = chainSurvival(rates.map((r) => r.pct))
  return (
    <div className="xb-contam">
      <div className="section-title rr-sec">CONTAMINATION, LAST 4 WEEKS // TARGET BELOW {target}% AT EVERY STAGE</div>
      <div className="xb-stages">
        {rates.map((r) => (
          <div key={r.stage} className={`xb-stage ${r.over ? 'warn' : ''}`}>
            <span>{STAGE_TEXT[r.stage]}</span>
            <span className="xb-big">{r.pct === null ? 'NONE MADE' : `${r.pct.toFixed(1)}%`}</span>
            <span className="dim tiny">{r.made ? `${r.lost} LOST OF ${r.made}` : 'NOTHING LOGGED IN 4 WEEKS'}</span>
          </div>
        ))}
      </div>
      <div className="dim tiny">
        LOSSES MULTIPLY: AT THESE RATES {Math.round(left * 100)}% OF WHAT YOU START REACHES HARVEST. FOUR STAGES AT 5% LEAVE ABOUT 81% (TEXTBOOK <RefText text="t16" />, OUR FARM). COUNTED BY WHAT WAS MADE IN THE LAST 28 DAYS. 5% IS A CEILING; REPLACE IT WITH YOUR OWN NUMBER AFTER ABOUT 3 MONTHS OF DATA.
      </div>
      <PracticeFields keys={['contamTargetPct']} title="TARGET" />
    </div>
  )
}

/** The same panel with its own data, for screens outside XENOGENETICS (HAZARD INDEX). */
export function ContamLive() {
  const cultures = useTable<Culture>('cultures')
  const runs = useTable<GrainRun>('grain_runs')
  const lots = useTable<BlockLot>('block_lots')
  const lotLoss = useTable<LotLoss>('lot_losses')
  const practice = usePractice()
  return <ContamPanel d={{ cultures, runs, lots, lotLoss, practice }} />
}

// ---------- bank tab ----------

function TubeRow({ c, d, strain, say }: { c: Culture; d: XData; strain: Strain; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'none' | 'check' | 'test'>('none')
  const [days, setDays] = useState('')
  const [look, setLook] = useState<string>('EVEN AND WHITE')
  const [contam, setContam] = useState('')
  const [pick, setPick] = useState<CheckResult | ''>('')
  const [notes, setNotes] = useState('')
  const [on, setOn] = useState(todayIso())
  const [reason, setReason] = useState<TestReason>('intake')
  const a = ageOf(c, d)
  const last = lastCheck(c.id, d.checks)
  const base = baselineDays(strain.id, d.checks)
  const dn = days.trim() === '' ? null : Number(days)
  const sug = suggestResult(dn !== null && Number.isFinite(dn) ? dn : null, base, look, contam, d.practice)
  const result = pick || sug.result
  return (
    <div className={`xb-tube ${a.state}`}>
      <button type="button" className="xb-tube-row" aria-expanded={open} onClick={() => (setOpen(!open), setMode('none'))}>
        <MiniGlyph kind={c.kind} />
        <span className="xb-label">{c.label ?? KIND_LABEL[c.kind]}</span>
        <span className={c.offsite ? 'xb-off' : 'dim'}>{c.offsite ? 'OFF SITE' : (c.location ?? 'FRIDGE')}</span>
        <span className={AGE_TONE[a.state]}>{a.text}</span>
        <span className="dim tiny">{last ? `LAST CHECK ${last.checked_on}: ${last.result.toUpperCase()}` : 'NOT CHECKED YET'}</span>
        <span className="xb-more">{open ? 'CLOSE' : 'OPEN'}</span>
      </button>
      {open && <div className="cg-btns">
        <button type="button" className={`btn ${mode === 'check' ? 'on' : ''}`} aria-expanded={mode === 'check'} onClick={() => setMode(mode === 'check' ? 'none' : 'check')}>LOG A CHECK</button>
        <button type="button" className={`btn ${mode === 'test' ? 'on' : ''}`} aria-expanded={mode === 'test'} onClick={() => setMode(mode === 'test' ? 'none' : 'test')}>T/E TEST</button>
        <button type="button" className="btn" onClick={() => void run(() => setOffsite(store, c, !c.offsite), c.offsite ? `${c.label} BACK IN THE CULTURE FRIDGE` : `${c.label} IS NOW THE OFF-SITE COPY`)}>
          {c.offsite ? 'BACK TO FRIDGE' : 'MOVE OFF SITE'}
        </button>
        <button type="button" className="btn" onClick={() => void run(() => setCultureStatus(store, c, 'used_up'), `${c.label} USED UP`)}>USED UP</button>
        <Confirm label="DISCARD" onYes={() => void run(() => setCultureStatus(store, c, 'discarded'), `${c.label} DISCARDED`)} />
        <HistoryButton table="cultures" id={c.id} />
      </div>}
      {a.state !== 'ok' && a.limit && <div className="dim tiny">{a.limit.rule}</div>}
      {open && mode === 'check' && (
        <div className="cg-act xb-form">
          <div className="cg-act-t">VIABILITY CHECK: PLATE ONE PLUG, WRITE THE DAYS TO COVER THE DISH</div>
          <span className="xn-inline">
            <label className="xn-num">
              <span>CHECKED ON</span>
              <PickInput type="date" value={on} onChange={(e) => setOn(e.target.value || todayIso())} />
            </label>
            <Num label="DAYS TO COVER" value={days} set={setDays} w="4.5em" />
            <label className="xn-num">
              <span>APPEARANCE</span>
              <Select aria-label="Appearance" value={look} onChange={(e) => setLook(e.target.value)}>
                {APPEARANCES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </Select>
            </label>
            <label className="xn-num">
              <span>CONTAMINATION</span>
              <input aria-label="Contamination" placeholder="NONE" value={contam} onChange={(e) => setContam(e.target.value.toUpperCase())} style={{ width: '9em' }} />
            </label>
            <label className="xn-num">
              <span>RESULT</span>
              <Select aria-label="Result" value={result} onChange={(e) => setPick(e.target.value as CheckResult)}>
                <option value="pass">PASS</option>
                <option value="watch">WATCH</option>
                <option value="fail">FAIL</option>
              </Select>
            </label>
            <label className="xn-num">
              <span>NOTES</span>
              <input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '12em' }} />
            </label>
          </span>
          <span className={`tiny ${sug.result === 'pass' ? 'dim' : 'warn'}`}>
            SUGGESTED: {sug.result.toUpperCase()} ({sug.why}){base !== null ? ` // STRAIN BASELINE ${base} D` : ''}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void run(() => logCheck(store, { tube: c, on, days_to_cover: dn !== null && Number.isFinite(dn) ? dn : null, appearance: look, contamination: contam || null, result, notes }), `CHECK LOGGED: ${c.label} ${result.toUpperCase()}`).then((ok) => {
                if (!ok) return
                setMode('none')
                setDays('')
                setContam('')
                setNotes('')
                setPick('')
              })
            }
          >
            LOG CHECK
          </button>
        </div>
      )}
      {open && mode === 'test' && (
        <div className="cg-act xb-form">
          <div className="cg-act-t">TEST-AND-EXPAND LINE FROM THIS TUBE</div>
          <span className="dim tiny">
            MAKES TWO PLATES FROM THIS TUBE: DISH T (TEST) AND DISH E (EXPANSION, HELD BACK). USE T FOR ONE GRAIN BAG, THEN ABOUT 4 TEST BLOCKS. RECORD PASS OR FAIL BELOW WHEN THEY FRUIT (TEXTBOOK <RefText text="t08" />, OUR FARM).
          </span>
          <span className="xn-inline">
            <label className="xn-num">
              <span>WHY</span>
              <Select aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value as TestReason)}>
                {(Object.keys(REASON_LABEL) as TestReason[]).map((r) => (
                  <option key={r} value={r}>{REASON_LABEL[r]}</option>
                ))}
              </Select>
            </label>
            <label className="xn-num">
              <span>PLATED ON</span>
              <PickInput type="date" value={on} onChange={(e) => setOn(e.target.value || todayIso())} />
            </label>
          </span>
          <button type="button" className="btn" onClick={() => void run(() => startTest(store, { strain, tube: c, reason, on, existing: d.cultures }), `T/E TEST STARTED FROM ${c.label}: DISH E HELD`).then((ok) => ok && setMode('none'))}>
            MAKE DISH T AND DISH E
          </button>
        </div>
      )}
    </div>
  )
}

function TestCard({ t, d, say }: { t: BankTest; d: XData; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const [dc, setDc] = useState('')
  const [dp, setDp] = useState('')
  const [kg, setKg] = useState('')
  const [form, setForm] = useState('')
  const [on, setOn] = useState(todayIso())
  const name = (id: string | null) => d.cultures.find((c) => c.id === id)?.label ?? 'GONE'
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
  const decide = (result: 'pass' | 'fail') =>
    void run(
      () => decideTest(store, t, { result, on, days_to_colonize: n(dc), days_to_pin: n(dp), kg_per_block: n(kg), form }, d.cultures),
      result === 'pass' ? `T/E TEST PASSED: DISH ${name(t.e_plate_id)} RELEASED FOR PRODUCTION` : `T/E TEST FAILED: DISH E DISCARDED, REVIVE ANOTHER TUBE`,
    )
  return (
    <div className={`xb-test ${t.result}`}>
      <div className="xb-test-h">
        <span className="xn-code">{t.result === 'pending' ? 'RUNNING' : t.result.toUpperCase()}</span>
        <span>FROM {name(t.source_culture_id)}</span>
        <span className="dim tiny">
          {REASON_LABEL[t.reason]} // STARTED {t.started_on}
          {t.decided_on ? ` // DECIDED ${t.decided_on}` : ''}
        </span>
        <HistoryButton table="bank_tests" id={t.id} />
      </div>
      <div className="tiny">
        DISH T: {name(t.t_plate_id)} // DISH E: {name(t.e_plate_id)} {t.result === 'pending' ? '(HELD)' : t.result === 'pass' ? '(RELEASED)' : '(DISCARDED)'}
      </div>
      {t.result !== 'pending' && (
        <div className="dim tiny">
          {[t.days_to_colonize !== null && `${t.days_to_colonize} D TO COLONIZE`, t.days_to_pin !== null && `${t.days_to_pin} D TO PIN`, t.kg_per_block !== null && `${t.kg_per_block} KG/BLOCK`, t.form].filter(Boolean).join(' // ') || 'NO NUMBERS RECORDED'}
        </div>
      )}
      {t.result === 'pending' && (
        <div className="cg-act xb-form">
          <span className="xn-inline">
            <label className="xn-num">
              <span>DECIDED ON</span>
              <PickInput type="date" value={on} onChange={(e) => setOn(e.target.value || todayIso())} />
            </label>
            <Num label="DAYS TO COLONIZE" value={dc} set={setDc} w="4.5em" />
            <Num label="DAYS TO PIN" value={dp} set={setDp} w="4.5em" />
            <Num label="KG PER BLOCK" value={kg} set={setKg} w="4.5em" />
            <label className="xn-num">
              <span>FORM</span>
              <input aria-label="Form" placeholder="TRUE TO TYPE?" value={form} onChange={(e) => setForm(e.target.value.toUpperCase())} style={{ width: '10em' }} />
            </label>
          </span>
          <span className="dim tiny">COMPARE AGAINST THE STRAIN'S OWN HISTORY. PASS RELEASES DISH E FOR PRODUCTION; FAIL DISCARDS IT.</span>
          <span className="cg-btns">
            <button type="button" className="btn" onClick={() => decide('pass')}>PASS: RELEASE DISH E</button>
            <Confirm label="FAIL: DISCARD DISH E" onYes={() => decide('fail')} />
          </span>
        </div>
      )}
    </div>
  )
}

function Step({ done, n, text, children }: { done: boolean; n: number; text: string; children?: ReactNode }) {
  return (
    <div className={`xb-step ${done ? 'done' : ''}`}>
      <span className="xb-tick" aria-hidden>{done ? '[X]' : '[ ]'}</span>
      <span>
        {n}. {text}
        <span className="sr-only">{done ? ' DONE' : ' NOT DONE'}</span>
      </span>
      {children && <span className="xb-step-do">{children}</span>}
    </div>
  )
}

function StrainBank({ strain, d, say, set }: { strain: Strain; d: XData; say: Say; set: SetXeno }) {
  const store = useStore()
  const run = useRun(say)
  const p = d.practice
  const mine = d.cultures.filter((c) => c.strain_id === strain.id)
  const masters = mine.filter((c) => isActiveCulture(c) && c.p_level === 0 && !(c.bank_batch))
  const plates = mine
    // Bank from a plate made off the master (P1 at intake), never from the master itself (t08-proc-our-intake).
    .filter((c) => c.kind === 'plate' && (c.p_level ?? 0) >= 1 && isActiveCulture(c) && !isHeld(c, d.cultures, d.tests))
    .sort((a, b) => (a.p_level ?? 9) - (b.p_level ?? 9) || b.made_on.localeCompare(a.made_on))
  const tubes = mine.filter(isBankTube).sort((a, b) => b.made_on.localeCompare(a.made_on) || a.kind.localeCompare(b.kind) || (a.label ?? '').localeCompare(b.label ?? ''))
  const batches = [...new Set(tubes.map((t) => t.bank_batch ?? 'solo'))]
  const tests = d.tests.filter((t) => t.strain_id === strain.id).sort((a, b) => (a.result === 'pending' ? -1 : 0) - (b.result === 'pending' ? -1 : 0) || b.started_on.localeCompare(a.started_on))
  const checks = d.checks.filter((c) => c.strain_id === strain.id).sort((a, b) => b.checked_on.localeCompare(a.checked_on))
  const st = bankStatus(strain, d.cultures, d.checks, d.tests, p)
  const sc = strainCheck(strain, d.lots, d.lotLoss, d.harvests, p)
  const base = baselineDays(strain.id, d.checks)

  const [from, setFrom] = useState('')
  const [ns, setNs] = useState(String(p.bankSlants))
  const [nw, setNw] = useState(String(p.bankWater))
  const [os, setOs] = useState('1')
  const [ow, setOw] = useState('1')
  const [on, setOn] = useState(todayIso())
  const fromPlate = plates.find((c) => c.id === from) ?? plates[0] ?? null
  const plated = mine.some((c) => c.kind === 'plate' && (c.p_level ?? 0) >= 1)
  const banked = st.slants + st.offsiteSlants + st.water + st.offsiteWater > 0
  const offsite = st.offsiteSlants > 0 && st.offsiteWater > 0
  const hasMaster = masters.length > 0 || mine.some((c) => c.p_level === 0)
  const allDone = hasMaster && plated && banked && offsite && st.passed > 0

  return (
    <div className="cg-panel">
      <div className="cg-panel-head">
        <span className="rr-name">
          {strain.code} // {spName(strain.species_key)} // CULTURE BANK
        </span>
        <span className="cg-btns">
          <button type="button" className="btn" onClick={() => set({ tab: 'LINEAGE' })}>LINEAGE</button>
          <button type="button" className="btn" onClick={() => set({ tab: 'STOCK' })}>STOCK</button>
        </span>
      </div>
      {st.warnings.length > 0 && (
        <div className="xb-warns">
          {st.warnings.map((w) => (
            <div key={w} className="warn tiny">! {w}</div>
          ))}
        </div>
      )}

      <div className="section-title rr-sec">INTAKE // DO THESE IN ORDER THE WEEK A STRAIN ARRIVES</div>
      {allDone ? (
        <div className="xb-step done"><span className="xb-tick">[X]</span><span>INTAKE COMPLETE: MASTER, P1 PLATE, BANK BATCH, OFF-SITE COPY AND A PASSED T/E TEST ARE ALL ON FILE.</span></div>
      ) : (
      <div className="xb-steps">
        <Step done={masters.length > 0 || mine.some((c) => c.p_level === 0)} n={1} text="MASTER (P0) ON FILE: THE CULTURE AS RECEIVED">
          {!masters.length && !mine.some((c) => c.p_level === 0) && <span className="dim tiny">ADD IT UNDER STOCK, OR WITH "ARRIVED AS" WHEN YOU REGISTER.</span>}
        </Step>
        <Step done={plated} n={2} text="FIRST PLATE (P1), GROWN ONLY PARTWAY">
          {!plated && masters[0] && (
            <button type="button" className="btn" onClick={() => void run(() => plateMaster(store, strain, masters[0], d.cultures), `P1 PLATE MADE FROM ${masters[0].label}`)}>
              PLATE THE MASTER
            </button>
          )}
        </Step>
        <Step done={banked} n={3} text={`BANK BATCH FROM THAT ONE PLATE: ${p.bankSlants} SLANTS + ${p.bankWater} WATER TUBES`} />
        <Step done={offsite} n={4} text="ONE SLANT AND ONE WATER TUBE OFF SITE" />
        <Step done={st.passed > 0} n={5} text="T/E TEST PASSED BEFORE THE STRAIN FEEDS PRODUCTION">
          {st.pendingTests > 0 && <span className="dim tiny">{st.pendingTests} RUNNING</span>}
        </Step>
      </div>
      )}

      <div className="section-title rr-sec">NEW BANK BATCH // ALL TUBES FROM ONE PLATE</div>
      {!plates.length ? (
        <div className="dim tiny">NO CLEAN PLATE FOR THIS STRAIN. {masters[0] ? 'PLATE THE MASTER FIRST (STEP 2).' : 'ADD THE MASTER FIRST (STEP 1).'}</div>
      ) : (
        <div className="cg-act xb-form">
          <span className="xn-inline">
            <label className="xn-num">
              <span>FROM PLATE</span>
              <Select aria-label="From plate" value={fromPlate?.id ?? ''} onChange={(e) => setFrom(e.target.value)}>
                {plates.map((c) => (
                  <option key={c.id} value={c.id}>{`${c.label ?? 'PLATE'} (${pLabel(c.p_level)})`}</option>
                ))}
              </Select>
            </label>
            <Num label="SLANTS" value={ns} set={setNs} />
            <Num label="WATER TUBES" value={nw} set={setNw} />
            <Num label="OFF-SITE SLANTS" value={os} set={setOs} />
            <Num label="OFF-SITE WATER" value={ow} set={setOw} />
            <label className="xn-num">
              <span>BANKED ON</span>
              <PickInput type="date" value={on} onChange={(e) => setOn(e.target.value || todayIso())} />
            </label>
          </span>
          {fromPlate && (fromPlate.p_level ?? 0) > 1 && <span className="warn tiny">THAT PLATE IS {pLabel(fromPlate.p_level)}. AT INTAKE, BANK FROM P1. FOR A REFRESH, PLATE THE LOWEST-P HEALTHY TUBE.</span>}
          <span className="dim tiny">LABELS LIKE {strain.code} W3 {pLabel(fromPlate?.p_level ?? 1)} {on}. TUBES GO STRAIGHT INTO THE CULTURE FRIDGE AT 1-2 °C (TEXTBOOK <RefText text="t08" />, OUR FARM).</span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              fromPlate &&
              void run(
                () => bankBatch(store, { strain, from: fromPlate, slants: Number(ns) || 0, water: Number(nw) || 0, offsiteSlants: Number(os) || 0, offsiteWater: Number(ow) || 0, on, existing: d.cultures }),
                `BANK BATCH: ${Number(ns) || 0} SLANTS + ${Number(nw) || 0} WATER TUBES FROM ${fromPlate.label}`,
              )
            }
          >
            BANK THIS BATCH
          </button>
        </div>
      )}

      <div className="section-title rr-sec">
        IN THE BANK // {st.slants + st.offsiteSlants} SLANTS, {st.water + st.offsiteWater} WATER TUBES{st.lowestP !== null ? ` // LOWEST HEALTHY LEVEL ${pLabel(st.lowestP)}` : ''}
      </div>
      {!tubes.length && <div className="dim tiny">NO TUBES YET.</div>}
      {batches.map((b) => {
        const ts = tubes.filter((t) => (t.bank_batch ?? 'solo') === b)
        const src = d.cultures.find((c) => c.id === ts[0]?.parent_culture_id)
        return (
          <div key={b} className="xb-batch">
            <div className="dim tiny">
              {b === 'solo' ? 'OTHER TUBES (NOT MADE AS A BANK BATCH)' : `BATCH BANKED ${ts[0].made_on}`}
              {b !== 'solo' && src ? ` FROM ${src.label ?? 'PLATE'}` : ''} // {ts.length} TUBE{ts.length === 1 ? '' : 'S'}. TAP A TUBE TO CHECK, TEST OR MOVE IT. A PASSED WATER-TUBE CHECK KEEPS THE WHOLE BATCH.
            </div>
            {ts.map((t) => (
              <TubeRow key={t.id} c={t} d={d} strain={strain} say={say} />
            ))}
          </div>
        )
      })}

      <div className="section-title rr-sec">T/E TESTS // DISH E IS HELD UNTIL DISH T PASSES</div>
      {!tests.length && <div className="dim tiny">NONE YET. START ONE FROM A TUBE ABOVE (T/E TEST). RUN IT AT INTAKE, AFTER EVERY REFRESH, AND FOR ANY TUBE OVER 18-24 MONTHS.</div>}
      {tests.map((t) => (
        <TestCard key={t.id} t={t} d={d} say={say} />
      ))}

      <div className="section-title rr-sec">VIABILITY LOG{base !== null ? ` // BASELINE ${base} D TO COVER` : ''}</div>
      {!checks.length ? (
        <div className="dim tiny">NO CHECKS YET. THE FIRST DAYS-TO-COVER YOU LOG BECOMES THE STRAIN'S BASELINE.</div>
      ) : (
        <div className="xb-log" role="table" aria-label="Viability log">
          <div className="xb-log-row xb-log-h" role="row">
            <span role="columnheader">DATE</span>
            <span role="columnheader">TUBE</span>
            <span role="columnheader">DAYS</span>
            <span role="columnheader">LOOK</span>
            <span role="columnheader">RESULT</span>
          </div>
          {checks.map((k) => {
            const tube = d.cultures.find((c) => c.id === k.culture_id)
            return (
              <div key={k.id} className={`xb-log-row ${k.result}`} role="row">
                <span role="cell">{k.checked_on}</span>
                <span role="cell">{tube?.label ?? 'GONE'}</span>
                <span role="cell">{k.days_to_cover ?? '-'}</span>
                <span role="cell">{[k.appearance, k.contamination].filter(Boolean).join(' // ') || '-'}</span>
                <span role="cell" className={k.result === 'pass' ? '' : 'warn'}>
                  {k.result.toUpperCase()}
                  {k.notes ? <span className="dim tiny"> {k.notes}</span> : null}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="section-title rr-sec">MONTHLY STRAIN CHECK // FROM REAL PRODUCTION LOTS</div>
      <div className="dim tiny">
        NO SEPARATE TEST BAGS (JOSEPH, 6 NOV 2026). READS THE LOTS KNOCKED OR HARVESTED IN THE LAST 4 WEEKS AGAINST THIS STRAIN'S OLDER LOTS (TEXTBOOK <RefText text="t09" />, OUR FARM).
      </div>
      <div className="xb-check">
        {[
          ['LAST 4 WEEKS', sc.recent],
          ['HISTORY', sc.history],
        ].map(([t, s]) => {
          const x = s as typeof sc.recent
          return (
            <div key={t as string} className="xb-stage">
              <span>{t as string}</span>
              <span className="tiny">
                {x.lots} LOT{x.lots === 1 ? '' : 'S'} // {x.blocks} BLOCKS
              </span>
              <span className="tiny">CONTAMINATION {x.contamPct === null ? '-' : `${x.contamPct.toFixed(1)}%`}</span>
              <span className="tiny">KNOCK TO FRUITING {x.daysToFruit === null ? '-' : `${x.daysToFruit.toFixed(1)} D`}</span>
              <span className="tiny">YIELD {x.kgPerBlock === null ? 'NOT HARVESTED' : `${x.kgPerBlock.toFixed(2)} KG/BLOCK`}</span>
            </div>
          )
        })}
      </div>
      <div className={sc.verdict === 'slipping' ? 'warn' : 'tiny'}>
        {sc.verdict === 'no_lots' && 'NO PRODUCTION LOTS FROM THIS STRAIN IN THE LAST 4 WEEKS.'}
        {sc.verdict === 'no_history' && 'NOT ENOUGH HISTORY YET: NEEDS 2 OLDER LOTS TO COMPARE.'}
        {sc.verdict === 'ok' && 'HOLDING STEADY AGAINST ITS OWN HISTORY.'}
        {sc.verdict === 'slipping' && `SLIPPING: ${sc.slipping.join(' // ')}`}
      </div>
      {sc.verdict === 'slipping' && tubes.length > 0 && (
        <button type="button" className="btn" onClick={() => void run(() => watchStrain(store, tubes, sc.slipping.join('; ')), `${tubes.length} ${strain.code} TUBES MARKED WATCH`)}>
          MARK ALL {tubes.length} TUBES WATCH
        </button>
      )}
    </div>
  )
}

export function BankTab({ d, x, set, say }: { d: XData; x: XenoState; set: SetXeno; say: Say }) {
  const sel = d.strains.find((s) => s.id === x.strain) ?? null
  return (
    <div className="xn-sec">
      <div className="xb-gloss tiny">
        <b>WORDS:</b> SLANT = AN AGAR TUBE SET AT AN ANGLE. WATER TUBE = AGAR PLUGS KEPT IN STERILE WATER. MASTER (P0) = THE CULTURE AS IT ARRIVED; P1 = THE FIRST PLATE MADE FROM IT. T/E TEST = TWO PLATES FROM ONE TUBE: DISH T IS GROWN ON A FEW TEST BLOCKS, DISH E IS KEPT SHUT UNTIL T FRUITS TRUE.
      </div>
      <div className="dim tiny">
        SLANTS AND WATER TUBES ONLY: THIS FARM HAS NO FREEZER. KEEP BOTH KINDS OF EVERY STRAIN, ONE OF EACH OFF SITE. SLANTS ARE REPLACED AT 6 MONTHS, WATER TUBES CHECKED EVERY 6-12 MONTHS, ANY TUBE OVER 2 YEARS TESTED BEFORE USE (TEXTBOOK <RefText text="t08" />, OUR FARM).
      </div>
      <div className="xn-list xb-list">
        {d.strains.map((s) => {
          const b = bankStatus(s, d.cultures, d.checks, d.tests, d.practice)
          return (
            <button key={s.id} type="button" className={`xn-row xb-row ${s.id === x.strain ? 'sel' : ''} ${s.active ? '' : 'off'}`} onClick={() => set({ strain: s.id })}>
              <span className="xn-code">{s.code}</span>
              <span>
                S {b.slants + b.offsiteSlants} // W {b.water + b.offsiteWater} // OFF {b.offsiteSlants + b.offsiteWater}
              </span>
              <span className={b.nextDue && b.nextDue < todayIso() ? 'warn' : 'dim'}>{!b.nextDue ? 'NOTHING DUE' : b.nextDue < todayIso() ? `OVERDUE SINCE ${b.nextDue}` : `NEXT DUE ${b.nextDue}`}</span>
              <span className={b.warnings.length ? 'warn' : 'dim'}>{!s.active ? 'RETIRED' : b.warnings.length ? `${b.warnings.length} TO DO` : 'BANK OK'}</span>
            </button>
          )
        })}
        {!d.strains.length && <div className="dim">NO STRAINS ON FILE. REGISTER ONE UNDER STRAINS FIRST.</div>}
      </div>
      {sel ? <StrainBank key={sel.id} strain={sel} d={d} say={say} set={set} /> : d.strains.length > 0 && <div className="dim tiny">PICK A STRAIN TO BANK, CHECK OR TEST ITS TUBES.</div>}
      <PracticeFields keys={['bankSlants', 'bankWater', 'slantReplaceDays', 'waterCheckDays', 'waterOverDays', 'suspectDays', 'slowerPct', 'yieldDropPct']} title="BANK RULES" say={say} />
    </div>
  )
}

