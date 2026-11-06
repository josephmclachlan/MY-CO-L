import { useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { useRecords, type Recs } from '../store/useRecords'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HistoryButton } from './History'
import { Confirm, Guess } from './CookParts'
import { SPECIES } from '../data/species'
import { speciesName } from '../store/useLedger'
import { todayIso } from '../lib/xeno'
import { BLOCK_DRY_LB, DIMENSIONS, daysFmt, flushTest, kgFmt, pctFmt, pickerTotals, scorecard, speciesLabel, trialArms, trialVerdict, type Dimension, type LotRecord, type StrainTrial } from '../lib/records'
import { closeTrial, createTrial, bulkLots, logPins } from '../lib/recordsActions'
import { usePracticeEditor } from '../store/usePractice'
import { TEST_FLUSH_MAX } from '../lib/bank'

// PRODUCTION RECORDS: the flush log with BE% per lot and per flush, the strain scorecard (with the fading-strain
// warning), and side-by-side strain trials.

export type YieldTab = 'FLUSHES' | 'FLUSHTEST' | 'SCORECARD' | 'TRIALS' | 'GUESSES'
export const YIELD_TABS: YieldTab[] = ['FLUSHES', 'FLUSHTEST', 'SCORECARD', 'TRIALS', 'GUESSES']
const TAB_LABEL: Record<YieldTab, string> = { FLUSHES: 'FLUSH LOG', FLUSHTEST: 'FLUSH TEST', SCORECARD: 'SCORECARD', TRIALS: 'STRAIN TRIALS', GUESSES: 'GUESSES' }
export interface YieldState {
  tab: YieldTab
  lot: string | null
  dim: Dimension
  species: string | null
  trial: string | null
}
export const YIELD_START: YieldState = { tab: 'FLUSHES', lot: null, dim: 'STRAIN', species: null, trial: null }
type SetYield = (p: Partial<YieldState>) => void
type Say = (t: string, warn?: boolean) => void

const num = (s: string): number | null => {
  const n = Number(s.replace(/[,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}

function useRun(say: Say) {
  const { sound } = useApp()
  const store = useStore()
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await store.action(ok, fn)
      sound.confirm()
      say(ok)
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
      return false
    }
  }
}

export function YieldIndex({ x, set }: { x: YieldState; set: SetYield }) {
  const { sound } = useApp()
  const r = useRecords()
  const fading = r.fading.filter((f) => f.fading).length
  return (
    <>
      <div className="section-title">PRODUCTION RECORDS</div>
      <ul className="index-list">
        {YIELD_TABS.map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{TAB_LABEL[t]}</span>
            {t === 'SCORECARD' && fading > 0 && <span className="k">{fading} FADING</span>}
            {t === 'TRIALS' && <span className="k">{r.trials.filter((t) => t.status === 'running').length}</span>}
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>NOW</div>
      <div className="lg-mini">
        <div>{r.recs.length} LOTS ON FILE</div>
        <div>{r.recs.filter((x) => x.complete).length} FINISHED</div>
        <div className={fading ? 'lg-warn-text' : ''}>{fading} FADING STRAINS</div>
      </div>
    </>
  )
}

export function Yield({ x, set, say }: { x: YieldState; set: SetYield; say: Say }) {
  const { sound } = useApp()
  const r = useRecords()
  return (
    <div className="cook ledger">
      <label className="ck-picker">
        <span>SHOW</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as YieldTab }))}>
          {YIELD_TABS.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
        </Select>
      </label>
      {x.tab === 'FLUSHES' && <Flushes r={r} x={x} set={set} say={say} />}
      {x.tab === 'FLUSHTEST' && <FlushTestTab r={r} x={x} set={set} say={say} />}
      {x.tab === 'SCORECARD' && <Score r={r} x={x} set={set} />}
      {x.tab === 'TRIALS' && <Trials r={r} x={x} set={set} say={say} />}
      {x.tab === 'GUESSES' && <Guesses />}
    </div>
  )
}

// ---------- FLUSH LOG ----------

const LIMIT = 40

function Flushes({ r, x, set, say }: { r: Recs; x: YieldState; set: SetYield; say: Say }) {
  const [all, setAll] = useState(false)
  const lots = useMemo(
    () => [...r.recs].sort((a, b) => b.lot.knock_date.localeCompare(a.lot.knock_date) || a.lot.lot_code.localeCompare(b.lot.lot_code)),
    [r.recs],
  )
  const cur = lots.find((l) => l.lot.id === x.lot) ?? lots.find((l) => l.kg > 0) ?? lots[0] ?? null
  if (!cur)
    return (
      <div className="ck-box">
        <div className="section-title">FLUSH LOG</div>
        <div className="dim">NO BLOCK LOTS YET. LOG ONE IN MISSION CONTROL, THEN PICKS SHOW HERE WITH BE%.</div>
      </div>
    )
  const shown = all ? lots : lots.slice(0, LIMIT)
  return (
    <div className="lg-stack">
      <LotDetail rec={cur} r={r} say={say} />
      <div className="ck-box">
        <div className="section-title">ALL LOTS // TAP ONE TO OPEN IT</div>
        <div className="rc-wrap">
          <table className="lg-table rc-table">
            <thead><tr><th>LOT</th><th>BLK</th><th>KG</th><th>BE%</th><th>D-PIN</th><th>STATE</th></tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.lot.id} tabIndex={0} className={l.lot.id === cur.lot.id ? 'sel' : ''} onClick={() => set({ lot: l.lot.id })}>
                  <td>{l.lot.lot_code}</td>
                  <td>{l.blocks}</td>
                  <td>{kgFmt(l.kg, 1)}</td>
                  <td>{pctFmt(l.be)}</td>
                  <td>{l.daysToPin ?? '-'}</td>
                  <td>{l.lot.status === 'lost' ? 'LOST' : l.complete ? 'DONE' : l.lot.status === 'spent' ? 'SPENT' : l.lot.status.toUpperCase().slice(0, 5)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lots.length > LIMIT && (
          <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW NEWEST ONLY' : `SHOW ALL ${lots.length}`}</button>
        )}
      </div>
    </div>
  )
}

function LotDetail({ rec, r, say }: { rec: LotRecord; r: Recs; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const l = rec.lot
  const [fl, setFl] = useState('')
  const [day, setDay] = useState(todayIso())
  const nextFl = Math.min(9, (rec.flushes.length ? Math.max(...rec.flushes.map((f) => f.flush)) : 0) + 1)
  const strain = r.strains.find((s) => s.id === l.strain_id)
  const savePins = () => {
    const f = fl.trim() ? num(fl) : nextFl
    if (f === null) return say('TYPE THE FLUSH NUMBER (1 TO 9).', true)
    return void run(() => logPins(store, l, Math.floor(f), day, r.pins), `${l.lot_code} FLUSH ${Math.floor(f)} PINS ${day}`)
  }
  return (
    <div className="ck-box">
      <div className="section-title">{l.lot_code} // {speciesName(l.species_key)}{strain ? ` // ${strain.code}` : ''} // {rec.blocks}{rec.lost ? `/${l.bag_count}` : ''} BLOCKS</div>
      <div className="ck-fields">
        <div className="ck-field"><span>KG PICKED</span><b>{kgFmt(rec.kg)}</b><em>{kgFmt(rec.kgPerBlock)} KG PER BLOCK</em></div>
        <div className="ck-field">
          <span>BE% (ALL FLUSHES)</span><b>{pctFmt(rec.be)}</b>
          <em>{rec.expectedBe === null ? 'NO CATAWBA FIGURE' : `CATAWBA ${pctFmt(rec.expectedBe)}${rec.vsExpectedPct !== null ? ` // YOU ${Math.round(rec.vsExpectedPct)}%` : ''}`}</em>
        </div>
        <div className="ck-field"><span>DRY SUBSTRATE</span><b>{kgFmt(rec.dryKg, 1)} KG</b><em>{l.dry_kg_per_block ? `${kgFmt(Number(l.dry_kg_per_block))} KG/BLOCK, SET ON LOT` : `${BLOCK_DRY_LB} LB DRY PER BLOCK`}</em></div>
        <div className="ck-field"><span>DAYS KNOCK TO PINS / PICK</span><b>{rec.daysToPin ?? '-'} / {rec.daysToFirstPick ?? '-'}</b><em>KNOCKED {l.knock_date}</em></div>
      </div>
      {rec.flushes.length ? (
        <div className="rc-wrap">
          <table className="lg-table rc-table">
            <thead><tr><th>FL</th><th>PINS</th><th>PICKS</th><th>KG</th><th className="hide-sm">KG/BLK</th><th>BE%</th><th className="hide-sm">CUM%</th><th>P-PICK</th></tr></thead>
            <tbody>
              {rec.flushes.map((f) => (
                <tr key={f.flush}>
                  <td>{f.flush}</td><td>{f.pinnedOn ? f.pinnedOn.slice(5) : '-'}</td><td>{f.picks}</td><td>{kgFmt(f.kg)}</td><td className="hide-sm">{kgFmt(f.kgPerBlock)}</td><td>{pctFmt(f.be)}</td><td className="hide-sm">{pctFmt(f.cumBe)}</td><td>{f.daysPinToPick ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dim">NO PICKS OR PIN DAYS LOGGED FOR THIS LOT YET.</div>
      )}
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>FLUSH</span><input inputMode="numeric" value={fl} placeholder={String(nextFl)} onChange={(e) => setFl(e.target.value)} /></label>
        <label className="ck-field"><span>PINS SHOWED ON</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value || todayIso())} /></label>
        <div className="ck-field"><span>&nbsp;</span><button type="button" className="btn on" onClick={savePins}>LOG PINS</button></div>
      </div>
      <div className="lg-btns"><HistoryButton table="block_lots" id={l.id} /></div>
      <div className="dim tiny">BE% = FRESH KG / DRY SUBSTRATE KG. P-PICK = DAYS FROM PINS TO FIRST PICK OF THAT FLUSH. PICKS ARE LOGGED IN MISSION CONTROL.</div>
    </div>
  )
}

// ---------- SCORECARD ----------

function Score({ r, x, set }: { r: Recs; x: YieldState; set: SetYield }) {
  const ctx = useMemo(() => ({ strains: r.strains, cooks: r.cooks }), [r.strains, r.cooks])
  const speciesKeys = useMemo(() => [...new Set(r.recs.map((c) => c.lot.species_key))].sort(), [r.recs])
  const rows = useMemo(() => scorecard(x.dim, r.recs, ctx, x.species), [x.dim, x.species, r.recs, ctx])
  const pickers = useMemo(() => pickerTotals(r.harvests), [r.harvests])
  const flagged = r.fading.filter((f) => f.fading)
  return (
    <div className="lg-stack">
      {flagged.length > 0 && (
        <div className="lg-warn" data-testid="fading">
          <b>FADING STRAINS</b>
          <ul className="ck-guesses">
            {flagged.map((f) => (
              <li key={f.strain.id}>
                {f.strain.code}: LAST 3 LOTS ({f.recentCodes.join(', ')}) AVERAGE {pctFmt(f.recentBe)} BE%, EARLIER LOTS {pctFmt(f.earlierBe)}. DOWN {f.dropPct.toFixed(0)}%.
                {' '}START A FRESH PLATE FROM THE BANK (XENOGENETICS &gt; BANK).
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="ck-box">
        <div className="section-title">SCORECARD // BY {x.dim}</div>
        <div className="lg-btns">
          {DIMENSIONS.map((d) => <button key={d} type="button" className={`btn ${x.dim === d ? 'on' : ''}`} onClick={() => set({ dim: d })}>{d}</button>)}
        </div>
        <label className="ck-field">
          <span>SPECIES</span>
          <Select value={x.species ?? ''} onChange={(e) => set({ species: e.target.value || null })}>
            <option value="">ALL SPECIES</option>
            {speciesKeys.map((k) => <option key={k} value={k}>{speciesLabel(k)}</option>)}
          </Select>
        </label>
        {rows.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>{x.dim === 'COOK RUN' ? 'COOK' : x.dim}</th><th>LOTS</th><th>LOST%</th><th>KG/BLK</th><th>BE%</th><th>D-PIN</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.key || 'none'} className={s.best ? 'best' : s.worst ? 'worst' : ''}>
                    <td>{s.label}{s.best ? ' ▲' : s.worst ? ' ▼' : ''}</td>
                    <td>{s.stats.lots}</td>
                    <td>{pctFmt(s.stats.contamPct)}</td>
                    <td>{kgFmt(s.stats.kgPerBlock)}</td>
                    <td>{pctFmt(s.stats.be)}</td>
                    <td>{daysFmt(s.stats.daysToPin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NO LOTS YET FOR THIS VIEW.</div>
        )}
        <div className="dim tiny">
          BE% = FRESH KG PICKED / DRY BLOCK WEIGHT (4 LB DRY PER BLOCK): HOW MUCH MUSHROOM EACH KG OF SUBSTRATE GIVES. HIGHER IS BETTER. ONLY COMPARE WITHIN ONE SPECIES (USE THE SPECIES BOX). FADING STRAINS ARE CHECKED ON ALL LOTS OF A STRAIN, WHATEVER YOU PICK HERE. KG/BLK AND BE% COUNT FINISHED LOTS ONLY (ALL FLUSHES PICKED, OR MARKED SPENT). LOST% IS BLOCKS LOGGED LOST / BLOCKS KNOCKED, ALL LOTS. ▲ BEST BE%, ▼ WORST. D-PIN = DAYS KNOCK TO PINS.
          {x.dim === 'WORKER' && ' WORKER = WHO KNOCKED THE BLOCKS. PICKING IS BELOW.'}
        </div>
      </div>
      {x.dim === 'WORKER' && (
        <div className="ck-box">
          <div className="section-title">KG PICKED BY INITIALS</div>
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>WHO</th><th>PICKS</th><th>LOTS</th><th>KG</th></tr></thead>
              <tbody>{pickers.map((p) => <tr key={p.who}><td>{p.who}</td><td>{p.picks}</td><td>{p.lots}</td><td>{kgFmt(p.kg, 1)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- TRIALS ----------

function Trials({ r, x, set, say }: { r: Recs; x: YieldState; set: SetYield; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const species = useMemo(() => SPECIES.filter((s) => s.cat || s.plan), [])
  const [name, setName] = useState('')
  const [sp, setSp] = useState('blue-oyster')
  const [q, setQ] = useState('')
  const sorted = useMemo(() => [...r.trials].sort((a, b) => b.started_on.localeCompare(a.started_on)), [r.trials])
  const cur = sorted.find((t) => t.id === x.trial) ?? sorted[0] ?? null

  const make = async () => {
    const ok = await run(async () => {
      const t = await createTrial(store, { name, species_key: sp, question: q })
      set({ trial: t.id })
    }, `TRIAL ${name.trim().toUpperCase()} STARTED`)
    if (ok) (setName(''), setQ(''))
  }

  return (
    <div className="lg-stack">
      {sorted.length > 0 && (
        <div className="ck-box">
          <div className="section-title">TRIALS</div>
          <ul className="index-list rc-list">
            {sorted.map((t) => (
              <li tabIndex={0} key={t.id} className={cur?.id === t.id ? 'sel' : ''} onClick={() => set({ trial: t.id })}>
                <span>{t.name.toUpperCase()}</span>
                <span className="k">{t.status === 'done' ? 'DONE' : 'RUNNING'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cur && <TrialView t={cur} r={r} say={say} />}
      <div className="ck-box">
        <div className="section-title">NEW STRAIN TRIAL</div>
        <div className="dim tiny">RUN TWO OR MORE STRAINS OF ONE SPECIES SIDE BY SIDE: SAME SUBSTRATE, SAME KNOCK DAY, SAME ROOM. THEN ADD THEIR LOTS BELOW.</div>
        <div className="ck-fields">
          <label className="ck-field"><span>NAME</span><input value={name} maxLength={40} placeholder="E.G. BLUE OYSTER BO-01 VS BO-02" onChange={(e) => setName(e.target.value)} /></label>
          <label className="ck-field">
            <span>SPECIES</span>
            <Select value={sp} onChange={(e) => setSp(e.target.value)}>{species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </label>
          <label className="ck-field"><span>WHAT DO YOU WANT TO KNOW</span><input value={q} maxLength={140} placeholder="OPTIONAL" onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <button type="button" className="btn on" onClick={() => void make()}>START TRIAL</button>
      </div>
    </div>
  )
}

function TrialView({ t, r, say }: { t: StrainTrial; r: Recs; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const arms = useMemo(() => trialArms(t, r.recs, r.strains), [t, r.recs, r.strains])
  const verdict = trialVerdict(arms)
  const mine = r.recs.filter((c) => c.lot.trial_id === t.id)
  const free = r.recs
    .filter((c) => c.lot.species_key === t.species_key && !c.lot.trial_id && c.lot.status !== 'lost')
    .sort((a, b) => b.lot.knock_date.localeCompare(a.lot.knock_date))
    .slice(0, 30)
  const [pick, setPick] = useState<string[]>([])
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const add = async () => {
    const lots = r.lots.filter((l) => pick.includes(l.id))
    const ok = await run(() => bulkLots(store, lots, { trialId: t.id }, r.losses), `${lots.length} LOTS ADDED TO TRIAL`)
    if (ok) setPick([])
  }
  const cell = (best: boolean, v: string) => <td className={best ? 'best' : ''}>{v}{best ? ' ▲' : ''}</td>
  return (
    <div className="ck-box" data-testid="trial">
      <div className="section-title">{t.name.toUpperCase()} // {speciesLabel(t.species_key)} // {t.status === 'done' ? `DONE ${t.ended_on}` : `RUNNING SINCE ${t.started_on}`}</div>
      {t.question && <div className="dim">QUESTION: {t.question.toUpperCase()}</div>}
      {arms.length ? (
        <div className="rc-wrap">
          <table className="lg-table rc-table">
            <thead><tr><th>STRAIN</th><th>LOTS</th><th>BE%</th><th>KG/BLK</th><th>D-PIN</th><th>LOST%</th></tr></thead>
            <tbody>
              {arms.map((a) => (
                <tr key={a.strainId ?? 'none'}>
                  <td>{a.label}</td><td>{a.stats.lots}</td>
                  {cell(a.bestBe, pctFmt(a.stats.be))}{cell(a.bestKg, kgFmt(a.stats.kgPerBlock))}{cell(a.bestPin, daysFmt(a.stats.daysToPin))}{cell(a.bestContam, pctFmt(a.stats.contamPct))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dim">NO LOTS IN THIS TRIAL YET.</div>
      )}
      <div className={verdict.warn ? 'lg-warn-text' : ''}>{verdict.text}</div>
      {mine.length > 0 && (
        <div className="dim tiny">LOTS: {mine.map((c) => `${c.lot.lot_code}${c.lot.strain_id ? ` (${r.strains.find((s) => s.id === c.lot.strain_id)?.code ?? '?'})` : ' (NO STRAIN)'}`).join(', ')}</div>
      )}
      {t.status === 'running' && (
        <>
          <div className="section-title">ADD LOTS OF {speciesLabel(t.species_key)}</div>
          {free.length ? (
            <div className="rc-checks">
              {free.map((c) => (
                <button key={c.lot.id} type="button" role="checkbox" aria-checked={pick.includes(c.lot.id)} className={`btn ${pick.includes(c.lot.id) ? 'on' : ''}`} onClick={() => toggle(c.lot.id)}>
                  {pick.includes(c.lot.id) ? '[X]' : '[ ]'} {c.lot.lot_code} {r.strains.find((s) => s.id === c.lot.strain_id)?.code ?? 'NO STRAIN'}
                </button>
              ))}
            </div>
          ) : (
            <div className="dim">NO FREE LOTS OF THIS SPECIES.</div>
          )}
          <div className="lg-btns">
            <button type="button" className="btn on" disabled={!pick.length} onClick={() => void add()}>ADD {pick.length || ''} TO TRIAL</button>
            {mine.length > 0 && <Confirm label="TAKE ALL LOTS OUT" onYes={() => void run(() => bulkLots(store, mine.map((c) => c.lot), { trialId: null }, r.losses), 'LOTS TAKEN OUT OF TRIAL')} />}
          </div>
        </>
      )}
      <div className="lg-btns">
        <button type="button" className="btn" onClick={() => void run(() => closeTrial(store, t, t.status === 'running'), t.status === 'running' ? 'TRIAL CLOSED' : 'TRIAL REOPENED')}>{t.status === 'running' ? 'CLOSE TRIAL' : 'REOPEN TRIAL'}</button>
        <HistoryButton table="strain_trials" id={t.id} />
      </div>
    </div>
  )
}

// ---------- FLUSH TEST ----------

function FlushTestTab({ r, x, set, say }: { r: Recs; x: YieldState; set: SetYield; say: Say }) {
  const { sound } = useApp()
  const [p, save] = usePracticeEditor()
  const species = useMemo(() => {
    const have = new Set(r.recs.map((l) => l.lot.species_key))
    return SPECIES.filter((s) => have.has(s.id)).map((s) => s.id)
  }, [r.recs])
  if (!species.length)
    return (
      <div className="ck-box">
        <div className="section-title">FLUSH TEST</div>
        <div className="dim">NO BLOCK LOTS YET. EVERY CROP STARTS IN TEST: LOG EVERY FLUSH, MARK THE LOT SPENT WHEN THE BLOCKS STOP, AND THIS PAGE SHOWS WHAT EACH FLUSH ADDS.</div>
      </div>
    )
  const sp = x.species && species.includes(x.species) ? x.species : species[0]
  const t = flushTest(r.recs, sp)
  const committed = p.flushPlan[sp]
  const commit = async (n: number | null) => {
    const plan = { ...p.flushPlan }
    if (n === null) delete plan[sp]
    else plan[sp] = n
    const label = n === null ? `${speciesLabel(sp).toUpperCase()} BACK IN FLUSH TEST` : `${speciesLabel(sp).toUpperCase()}: ${n} FLUSH${n > 1 ? 'ES' : ''} COMMITTED`
    try {
      await save({ flushPlan: plan }, label)
      sound.confirm()
      say(label)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">FLUSH TEST // HOW MANY FLUSHES IS EACH CROP WORTH?</div>
        <div className="lg-btns">
          {species.map((k) => (
            <button key={k} type="button" className={`btn${k === sp ? ' on' : ''}`} onClick={() => (sound.chirp(), set({ species: k }))}>
              {speciesLabel(k).toUpperCase()} {p.flushPlan[k] ? `(${p.flushPlan[k]})` : '(TEST)'}
            </button>
          ))}
        </div>
        <div className="dim tiny">
          {committed
            ? `${speciesLabel(sp).toUpperCase()} IS COMMITTED TO ${committed} FLUSH${committed > 1 ? 'ES' : ''}. A LOT IS FINISHED AFTER THAT MANY.`
            : `${speciesLabel(sp).toUpperCase()} IS IN TEST. LOTS STAY OPEN FOR UP TO ${TEST_FLUSH_MAX} FLUSHES. MARK A LOT SPENT IN MISSION CONTROL WHEN ITS BLOCKS STOP.`}
        </div>
      </div>
      <div className="ck-box">
        <div className="section-title">WHAT EACH FLUSH GIVES // {t.finished} FINISHED LOT{t.finished === 1 ? '' : 'S'}{t.open ? `, ${t.open} STILL PICKING` : ''}</div>
        {t.rows.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>FLUSH</th><th>LOTS</th><th>KG/BLK</th><th>VS FLUSH 1</th><th>SHARE</th><th>DAYS AFTER</th></tr></thead>
              <tbody>
                {t.rows.map((row) => (
                  <tr key={row.flush}>
                    <td>{row.flush}</td>
                    <td>{row.lots}</td>
                    <td>{kgFmt(row.kgPerBlock, 2)}</td>
                    <td>{pctFmt(row.vsFirstPct)}</td>
                    <td>{pctFmt(row.sharePct)}</td>
                    <td>{row.gapDays === null ? '-' : Math.round(row.gapDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NO FINISHED LOT YET. KEEP LOGGING EVERY FLUSH, THEN MARK THE LOT SPENT.</div>
        )}
        <div className="dim tiny">
          {t.suggest === null ? 'A SUGGESTION SHOWS ONCE 3 LOTS ARE FINISHED.' : `SUGGESTED: ${t.suggest} FLUSH${t.suggest > 1 ? 'ES' : ''} (EACH ONE STILL GIVES AT LEAST 15% OF FLUSH 1).`} <Guess />
        </div>
        <div className="lg-btns">
          {Array.from({ length: TEST_FLUSH_MAX }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" className={`btn${committed === n ? ' on' : ''}`} onClick={() => void commit(n)}>COMMIT {n}</button>
          ))}
          {committed !== undefined && <button type="button" className="btn" onClick={() => void commit(null)}>BACK TO TEST</button>}
        </div>
      </div>
    </div>
  )
}

const GUESS_LIST = [
  `Dry substrate per block is ${BLOCK_DRY_LB} lb (your 10 lb block: 4 lb dry, 6 lb water). BE% = fresh kg / dry kg. A lot can carry its own dry weight.`,
  'BE% uses blocks still alive now. Blocks lost after a flush was picked lower the later figures slightly.',
  'A lot is FINISHED when you mark it SPENT, or when it has picked every flush: the count you committed in FLUSH TEST, or 4 while the species is still in test. Only finished lots feed KG/BLK and BE% in the scorecard.',
  'FLUSH TEST suggests the most flushes where each one still gives at least 15% of flush 1\'s kg per block, once 3 lots are finished. The 15% is a guess; you commit the number yourself.',
  'FADING = the newest 3 finished lots of a strain average at least 15% lower BE% than its earlier finished lots (needs 5 finished lots). The 15% is shared with the culture bank slipping rule.',
  'Lost% counts every logged loss on a lot, not only contamination, divided by blocks knocked.',
  'Days to pins counts from the knock day to the day you log pins for flush 1. Pin days are logged by hand on this screen.',
  'The week is the ISO week (Monday start) of the knock day. WORKER is whoever knocked the blocks (initials on the lot); picking totals use the initials on each pick.',
  'A trial verdict calls it a tie when the leader is under 10% ahead on BE%.',
]
function Guesses() {
  return (
    <div className="ck-box">
      <div className="section-title">GUESSES WAITING FOR REVIEW</div>
      <ul className="ck-guesses">{GUESS_LIST.map((g) => <li key={g}><Guess /> {g}</li>)}</ul>
    </div>
  )
}
