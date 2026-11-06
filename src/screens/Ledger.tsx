import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useCargoPrefs, useStore } from '../store/StoreContext'
import { speciesName, useLedger, type LedgerData } from '../store/useLedger'
import { useRatesEditor } from '../store/useRates'
import { estimateMid, iceBill, rates } from '../lib/rates'
import { Prices } from './Prices'
import { useFx } from '../store/useFx'
import { monthEnd } from '../lib/fx'
import { ICE } from '../data/ledger'
import { PART_KEYS, PART_LABEL, addDays, type Basis, type Cost, type EnergyBill, type LabourEntry, type WeekCost } from '../lib/ledger'
import { fmtCrc, fmtUsd, today } from '../lib/cargo'
import { uuid } from '../lib/store'
import { Confirm, Field, Guess } from './CookParts'
import { weekSplit } from '../data/cropplan'
import { nextKnockDay, todayIso } from '../lib/xeno'
import { useTable } from '../store/StoreContext'
import type { Sale } from '../lib/trade'
import { OUTPUT_UNIT, TASKS, TASK_LABEL, taskOf, taskReport, timerHours, type TaskId, type TaskTimer } from '../lib/tasks'

// LEDGER: cost of goods. ₡ first, US$ second. Every figure says if it is ACTUAL or an ESTIMATE.

export type LedgerSel = 'overview' | 'bills' | 'labour' | 'settings' | `week:${string}`
export interface LedgerState {
  sel: LedgerSel
}
export const LEDGER_START: LedgerState = { sel: 'overview' }
type SetLedger = (p: Partial<LedgerState>) => void
type Say = (t: string, warn?: boolean) => void

const num = (s: string): number | null => {
  const n = Number(s.replace(/[₡,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}
const kgText = (n: number) => `${n.toFixed(n < 10 ? 2 : 1)} KG`
const weekLabel = (w: string) => `WK ${w.slice(5).replace('-', '.')}-${addDays(w, 6).slice(5).replace('-', '.')}`

export function Money({ crc, fx, basis }: { crc: number | null; fx: number; basis?: Basis }) {
  if (crc === null) return <span className="dim">--</span>
  return (
    <span className="lg-money">
      {fmtCrc(crc)} <small>{fmtUsd(crc, fx)}</small>
      {basis && <Tag b={basis} />}
    </span>
  )
}
export function Tag({ b }: { b: Basis }) {
  if (b === 'ACTUAL') return null
  return <span className={`lg-tag ${b.toLowerCase()}`}>{b === 'NONE' ? 'NO DATA' : b}</span>
}

const PICKS: { id: LedgerSel; label: string }[] = [
  { id: 'overview', label: 'OVERVIEW + PLAN WEEK' },
  { id: 'bills', label: 'ICE BILLS' },
  { id: 'labour', label: 'LABOUR + TASK HOURS' },
  { id: 'settings', label: 'PRICES + COSTS' },
]

export function LedgerIndex({ x, set }: { x: LedgerState; set: SetLedger }) {
  const { sound } = useApp()
  const { ledger } = useLedger()
  return (
    <>
      <div className="section-title">LEDGER</div>
      <ul className="index-list">
        {PICKS.map((p) => (
          <li tabIndex={0} key={p.id} className={x.sel === p.id ? 'sel' : ''} onClick={() => (sound.chirp(), set({ sel: p.id }))}>
            <span>{p.label}</span>
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>KNOCK WEEKS</div>
      <ul className="index-list ck-index">
        {ledger.weeks.length === 0 && <li className="dim"><span>NO LOTS LOGGED YET</span></li>}
        {ledger.weeks.map((w) => (
          <li tabIndex={0} key={w.week} className={x.sel === `week:${w.week}` ? 'sel' : ''} onClick={() => (sound.chirp(), set({ sel: `week:${w.week}` }))}>
            <span>{weekLabel(w.week)}</span>
            <span className="k">{w.all.blocks}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

export function Ledger({ x, set, say, onOpenTrade, onOpenCargo }: { x: LedgerState; set: SetLedger; say: Say; onOpenTrade: () => void; onOpenCargo: () => void }) {
  const { sound } = useApp()
  const d = useLedger()
  const [cp] = useCargoPrefs()
  const fx = cp.fx
  const week = x.sel.startsWith('week:') ? d.ledger.weeks.find((w) => w.week === x.sel.slice(5)) ?? null : null
  return (
    <div className="cook ledger">
      <label className="ck-picker">
        <span>SHOW</span>
        <Select value={x.sel} onChange={(e) => (sound.chirp(), set({ sel: e.target.value as LedgerSel }))}>
          {PICKS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {d.ledger.weeks.map((w) => <option key={w.week} value={`week:${w.week}`}>{weekLabel(w.week)} // {w.all.blocks} BLOCKS</option>)}
        </Select>
      </label>
      {x.sel === 'overview' && <Overview d={d} fx={fx} set={set} onOpenTrade={onOpenTrade} onOpenCargo={onOpenCargo} />}
      {x.sel === 'bills' && <Bills d={d} fx={fx} say={say} />}
      {x.sel === 'labour' && <Labour d={d} fx={fx} say={say} />}
      {x.sel === 'settings' && <Prices say={say} onOpenCargo={onOpenCargo} />}
      {x.sel.startsWith('week:') && (week ? <Week w={week} fx={fx} /> : <div className="dim">THAT WEEK HAS NO LOTS ANY MORE.</div>)}
    </div>
  )
}

// ---------- cost cards ----------

function CostCard({ c, title }: { c: Cost; fx?: number; title?: string }) {
  const max = Math.max(1, ...PART_KEYS.map((k) => c.parts[k].crc))
  return (
    <div className="ck-box lg-card">
      <div className="lg-card-head">
        <b>{title ?? c.label}</b>
        <span className="dim">
          {c.blocks} BLOCKS{c.alive !== c.blocks ? ` (${c.alive} ALIVE)` : ''} // {kgText(c.kg)} <Tag b={c.kgBasis} />
          {c.hours > 0 ? ` // ${c.hours.toFixed(1)} H LABOUR` : ''}
        </span>
      </div>
      <div className="lg-big">
        <div>
          <span>PER BLOCK</span>
          <Money crc={c.perBlock} fx={c.fx} />
        </div>
        <div>
          <span>PER KG</span>
          <Money crc={c.perKg} fx={c.fx} />
        </div>
        <div>
          <span>TOTAL</span>
          <Money crc={c.total} fx={c.fx} />
        </div>
      </div>
      <div className="lg-parts">
        {PART_KEYS.map((k) => {
          const p = c.parts[k]
          return (
            <div key={k} className={`lg-part ${p.basis.toLowerCase()}`} title={p.notes.join(' // ')}>
              <span className="lg-pl">{PART_LABEL[k]}</span>
              <span className="lg-bar"><i style={{ width: `${(p.crc / max) * 100}%` }} /></span>
              <span className="lg-pv">
                {fmtCrc(p.crc)} <small>{c.blocks ? `${fmtCrc(p.crc / c.blocks)}/BLK` : ''}</small> <Tag b={p.basis} />
              </span>
              {p.notes.length > 0 && <em className="lg-pn">{p.notes.join(' // ')}</em>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Week({ w, fx }: { w: WeekCost; fx: number }) {
  return (
    <div className="lg-stack">
      <div className="section-title">KNOCK {weekLabel(w.week)} // COST BY SPECIES</div>
      <CostCard c={w.all} fx={fx} title="WHOLE WEEK" />
      {w.species.map((c) => <CostCard key={c.key} c={c} fx={fx} />)}
      <div className="ck-box">
        <div className="section-title">LOTS</div>
        <div className="ck-scroll">
          <table className="lg-table">
            <thead>
              <tr><th>LOT</th><th>SPECIES</th><th>BLOCKS</th><th>STATUS</th><th>KG</th><th>TOTAL</th><th>₡/BLOCK</th><th>₡/KG</th></tr>
            </thead>
            <tbody>
              {w.lots.map((l) => (
                <tr key={l.lot.id}>
                  <td>{l.lot.lot_code}</td>
                  <td>{speciesName(l.lot.species_key)}</td>
                  <td>{l.alive}/{l.blocks}</td>
                  <td>{l.lot.status.toUpperCase()}{l.partial ? ' (PICKING)' : ''}</td>
                  <td>{l.kg.toFixed(1)} {l.kgBasis !== 'ACTUAL' && <Tag b={l.kgBasis} />}</td>
                  <td>{fmtCrc(l.total)}</td>
                  <td>{l.perBlock === null ? '--' : fmtCrc(l.perBlock)}</td>
                  <td>{l.perKg === null ? '--' : fmtCrc(l.perKg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Overview({ d, fx, set, onOpenTrade, onOpenCargo }: { d: LedgerData; fx: number; set: SetLedger; onOpenTrade: () => void; onOpenCargo: () => void }) {
  const fxNow = useFx().today
  const { ledger, plan } = d
  const noPrices = plan.all.parts.consumables.basis === 'NONE'
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">COST OF GOODS // ₡ FIRST, US$ AT EACH DAY'S RATE</div>
        <div className="dim tiny">US$ USES THE RATE ON EACH LOT'S KNOCK DAY, SO OLD WEEKS KEEP THEIR OLD RATE. TODAY ₡{fxNow.rate} ({fxNow.source === 'FALLBACK' ? 'NO DAILY RATE YET: THE FIGURE ON PRICES + COSTS' : fxNow.source === 'MANUAL' ? 'TYPED' : `FETCHED ${fxNow.day}`}).</div>
        <div className="dim tiny">
          EACH PART SAYS WHERE IT CAME FROM. NO TAG = LOGGED DATA. <span className="lg-tag estimate">ESTIMATE</span> = FROM THE PLAN OR THE ELECTRICAL PACKAGE. <span className="lg-tag mixed">MIXED</span> = SOME OF EACH. <span className="lg-tag none">NO DATA</span> = NOTHING TO COUNT YET.
        </div>
        {noPrices && (
          <div className="lg-warn">
            CARGO HAS NO PRICES YET, SO CONSUMABLES SHOW ₡0. ADD A PRICE TO SAWDUST, SOY HULLS, GRAIN AND BAGS IN CARGO.{' '}
            <button type="button" className="ck-link" onClick={onOpenCargo}>OPEN CARGO</button>
          </div>
        )}
      </div>
      {ledger.species.length > 0 && (
        <>
          <div className="section-title">ALL LOGGED LOTS // BY SPECIES</div>
          {ledger.species.map((c) => <CostCard key={c.key} c={c} fx={fx} />)}
        </>
      )}
      <div className="section-title">PLAN WEEK // 130 BLOCKS // ALL ESTIMATES</div>
      <div className="dim tiny">A STANDARD WEEK ({weekSplit(nextKnockDay(todayIso())).map((x) => `${x.bags} ${speciesName(x.key)}`).join(', ')}) BEFORE ANY DATA. THE SECONDARY SLOT IS THE SPECIES YOU PICK IN PRODUCTION SEQUENCE. CARGO PRICES, PLANNED COOKS, THE PACKAGE BILL ESTIMATE, CATAWBA YIELDS.</div>
      <CostCard c={plan.all} fx={fx} title="PLAN WEEK" />
      {plan.species.map((c) => <CostCard key={c.key} c={c} fx={fx} />)}
      <div className="ck-box">
        <div className="section-title">ROOM ENERGY BY MONTH</div>
        {ledger.months.length === 0 ? (
          <div className="dim">NO LOTS OR BILLS YET. UNTIL A BILL IS TYPED IN, A MONTH USES THE ESTIMATE {fmtCrc(rates().ice.estimateLow)}-{fmtCrc(rates().ice.estimateHigh)} ({fmtUsd(rates().ice.estimateLow, fx)}-{fmtUsd(rates().ice.estimateHigh, fx)}), SET ON PRICES + COSTS.</div>
        ) : (
          <div className="ck-scroll">
            <table className="lg-table">
              <thead><tr><th>MONTH</th><th>BILL</th><th>COOK RUNS</th><th>ROOMS</th><th>BAG-DAYS</th><th>₡/BAG-DAY</th></tr></thead>
              <tbody>
                {ledger.months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td>{fmtCrc(m.bill)} <Tag b={m.billBasis} /></td>
                    <td>{fmtCrc(m.cook)}</td>
                    <td>{fmtCrc(m.room)}</td>
                    <td>{Math.round(m.bagDays).toLocaleString('en-US')}</td>
                    <td>{m.perBagDay.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(ledger.unallocated.consumables > 0 || ledger.unallocated.cook > 0 || ledger.unallocated.labourHours > 0) && (
          <div className="dim tiny">
            NOT ON ANY LOT (A WEEK WITH NO KNOCK): CONSUMABLES {fmtCrc(ledger.unallocated.consumables)}, COOK ENERGY {fmtCrc(ledger.unallocated.cook)}, LABOUR {ledger.unallocated.labourHours.toFixed(1)} H.
          </div>
        )}
        <div className="ck-btns">
          <button type="button" className="btn" onClick={() => set({ sel: 'bills' })}>TYPE AN ICE BILL</button>
          <button type="button" className="btn" onClick={() => set({ sel: 'labour' })}>LOG LABOUR</button>
          <button type="button" className="btn" onClick={onOpenTrade}>TRADE: SALES + MARGIN</button>
        </div>
      </div>
    </div>
  )
}

// ---------- ICE bills ----------

function Bills({ d, fx, say }: { d: LedgerData; fx: number; say: Say }) {
  const fxd = useFx()
  const store = useStore()
  const [month, setMonth] = useState(today().slice(0, 7))
  const [kwh, setKwh] = useState('')
  const [kw, setKw] = useState('')
  const [crc, setCrc] = useState('')
  const k = num(kwh)
  const w = num(kw)
  const c = num(crc)
  const check = k !== null ? iceBill(k, w) : null
  const list = [...d.bills].sort((a, b) => b.month.localeCompare(a.month))
  const save = async () => {
    if (!/^\d{4}-\d{2}$/.test(month)) return say('PICK THE BILLED MONTH.', true)
    if (k === null || k < 0) return say('TYPE THE KWH ON THE BILL.', true)
    if (c === null || c <= 0) return say('TYPE THE ₡ TOTAL ON THE BILL.', true)
    const have = d.bills.find((b) => b.month.slice(0, 7) === month)
    const row: EnergyBill = { id: have?.id ?? uuid(), month: `${month}-01`, kwh: k, billed_kw: w, total_crc: c, notes: have?.notes ?? null, created_at: (have?.created_at as string | undefined) ?? new Date().toISOString() }
    try {
      await store.put('energy_bills', row)
      setKwh('')
      setKw('')
      setCrc('')
      say(`ICE BILL ${month} SAVED // ${fmtCrc(c)}`)
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'SAVE FAILED', true)
    }
  }
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">TYPE AN ICE BILL</div>
        <div className="ck-fields">
          <label className="ck-field"><span>MONTH BILLED</span><PickInput type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <label className="ck-field"><span>KWH</span><input inputMode="decimal" value={kwh} placeholder="4762" onChange={(e) => setKwh(e.target.value)} /></label>
          <label className="ck-field"><span>BILLED KW (DEMAND)</span><input inputMode="decimal" value={kw} placeholder="10" onChange={(e) => setKw(e.target.value)} /></label>
          <label className="ck-field"><span>TOTAL ₡</span><input inputMode="decimal" value={crc} placeholder="392000" onChange={(e) => setCrc(e.target.value)} /></label>
        </div>
        {check !== null && (
          <div className={`lg-check ${c !== null && Math.abs(c - check) / check > 0.1 ? 'warn' : ''}`}>
            THE TARIFF SAYS {fmtCrc(check)} ({fmtUsd(check, fx)}) FOR {k?.toLocaleString('en-US')} KWH AT {Math.max(w ?? rates().ice.demandMinKw, rates().ice.demandMinKw)} KW.
            {c !== null && ` THE BILL IS ${c >= check ? '+' : ''}${(((c - check) / check) * 100).toFixed(0)}%.`}
            {c !== null && Math.abs(c - check) / check > 0.1 && ' MORE THAN 10% OFF: CHECK THE FIGURES OR ASK ICE WHICH TARIFF YOU ARE ON.'}
          </div>
        )}
        <div className="dim tiny">TARIFF FIGURES ARE ON PRICES + COSTS. {ICE.source}</div>
        <div className="ck-btns"><button type="button" className="btn on" onClick={() => void save()}>SAVE BILL</button></div>
      </div>
      <div className="ck-box">
        <div className="section-title">BILLS</div>
        {list.length === 0 ? (
          <div className="dim">
            NO BILLS YET. UNTIL THEN EVERY MONTH USES THE ESTIMATE {fmtCrc(estimateMid())} ({fmtUsd(estimateMid(), fx)}) <span className="lg-tag estimate">ESTIMATE</span>, THE MIDDLE OF THE RANGE ON PRICES + COSTS (BUILT-IN: THE ELECTRICAL PACKAGE).
          </div>
        ) : (
          <div className="ck-scroll">
            <table className="lg-table">
              <thead><tr><th>MONTH</th><th>KWH</th><th>KW</th><th>TOTAL</th><th>US$</th><th>TARIFF CHECK</th><th /></tr></thead>
              <tbody>
                {list.map((b) => {
                  const t = iceBill(Number(b.kwh), b.billed_kw === null ? null : Number(b.billed_kw))
                  return (
                    <tr key={b.id}>
                      <td>{b.month.slice(0, 7)}</td>
                      <td>{Number(b.kwh).toLocaleString('en-US')}</td>
                      <td>{b.billed_kw ?? '--'}</td>
                      <td>{fmtCrc(Number(b.total_crc))}</td>
                      <td title={`AT ₡${fxd.rate(monthEnd(b.month))} PER US$ (${monthEnd(b.month)})`}>{fmtUsd(Number(b.total_crc), fxd.rate(monthEnd(b.month)))}</td>
                      <td>{fmtCrc(t)} ({((Number(b.total_crc) / t - 1) * 100).toFixed(0)}%)</td>
                      <td><Confirm label="DELETE" onYes={() => void store.del('energy_bills', b.id).then(() => say('BILL DELETED'), (e: Error) => say(e.message.toUpperCase(), true))} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- labour ----------

const TIMER_KEY = 'mycol.tasktimer.v1'
function loadTimer(): TaskTimer | null {
  try {
    const v = JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null') as TaskTimer | null
    return v && typeof v.since === 'number' && TASKS.some((t) => t.id === v.task) ? v : null
  } catch {
    return null
  }
}
function saveTimer(t: TaskTimer | null) {
  try {
    if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t))
    else localStorage.removeItem(TIMER_KEY)
  } catch {
    // A blocked store only loses the running timer, never a saved line.
  }
}
const clock = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function Labour({ d, say }: { d: LedgerData; fx: number; say: Say }) {
  const fxd = useFx()
  const store = useStore()
  const sales = useTable<Sale>('sales')
  const [rt, saveRt] = useRatesEditor()
  const p = { rate: rt.labourRate, labourOn: rt.labourOn }
  const [day, setDay] = useState(today())
  const [person, setPerson] = useState('')
  const [hours, setHours] = useState('')
  const [task, setTask] = useState<TaskId | ''>('')
  const [detail, setDetail] = useState('')
  const [lot, setLot] = useState('')
  const [timer, setTimer] = useState<TaskTimer | null>(loadTimer)
  const [now, setNow] = useState(Date.now())
  const [weeks, setWeeks] = useState(8)
  useEffect(() => {
    if (!timer) return
    const h = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(h)
  }, [timer])
  const people = [...new Set(d.labour.map((e) => e.person))]
  const lots = [...d.lots].sort((a, b) => b.knock_date.localeCompare(a.knock_date)).slice(0, 30)
  const list = [...d.labour].sort((a, b) => b.worked_on.localeCompare(a.worked_on)).slice(0, 60)
  const report = useMemo(() => taskReport(d.labour, { lots: d.lots, harvests: d.harvests, sales }, todayIso(), weeks), [d.labour, d.lots, d.harvests, sales, weeks])
  const taskText = (t: TaskId | '', extra: string) => (t ? `${TASK_LABEL[t]}${extra.trim() ? ` // ${extra.trim().toUpperCase()}` : ''}` : extra.trim().toUpperCase() || null)
  const write = async (row: LabourEntry, ok: string) => {
    try {
      await store.put('labour_entries', row)
      say(ok)
      return true
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'SAVE FAILED', true)
      return false
    }
  }
  const save = async () => {
    const h = num(hours)
    if (!person.trim()) return say('WHO WORKED?', true)
    if (h === null || h <= 0) return say('TYPE THE HOURS.', true)
    if (!task && !detail.trim()) return say('PICK A TASK.', true)
    const row: LabourEntry = { id: uuid(), worked_on: day, person: person.trim(), hours: h, task: taskText(task, detail), block_lot_id: lot || null, notes: null, created_at: new Date().toISOString() }
    if (await write(row, `${h} H OF ${TASK_LABEL[taskOf(row.task)]} LOGGED FOR ${row.person.toUpperCase()}`)) {
      setHours('')
      setDetail('')
    }
  }
  const start = () => {
    if (!person.trim()) return say('WHO IS WORKING?', true)
    if (!task) return say('PICK A TASK TO TIME.', true)
    const t: TaskTimer = { task, person: person.trim(), lot: lot || null, since: Date.now() }
    saveTimer(t)
    setTimer(t)
    setNow(Date.now())
    say(`TIMER STARTED: ${TASK_LABEL[task]} // ${t.person.toUpperCase()}`)
  }
  const stop = async () => {
    if (!timer) return
    const h = timerHours(timer.since, Date.now())
    const row: LabourEntry = { id: uuid(), worked_on: todayIso(), person: timer.person, hours: h, task: TASK_LABEL[timer.task], block_lot_id: timer.lot, notes: 'TIMED', created_at: new Date().toISOString() }
    if (await write(row, `${h} H OF ${TASK_LABEL[timer.task]} LOGGED FOR ${timer.person.toUpperCase()}`)) {
      saveTimer(null)
      setTimer(null)
    }
  }
  const cancel = () => {
    saveTimer(null)
    setTimer(null)
    say('TIMER CANCELLED. NOTHING SAVED.')
  }
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">LOG HOURS // PICK THE TASK</div>
        {timer && (
          <div className="lg-warn">
            TIMING {TASK_LABEL[timer.task]} // {timer.person.toUpperCase()} // {clock(now - timer.since)}
            <div className="ck-btns">
              <button type="button" className="btn on" onClick={() => void stop()}>STOP + SAVE</button>
              <button type="button" className="btn" onClick={cancel}>CANCEL TIMER</button>
            </div>
          </div>
        )}
        <div className="lg-btns" role="group" aria-label="Task">
          {TASKS.map((t) => (
            <button key={t.id} type="button" className={`btn${task === t.id ? ' on' : ''}`} aria-pressed={task === t.id} onClick={() => setTask(task === t.id ? '' : t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="ck-fields">
          <label className="ck-field"><span>WHO</span><input list="lg-people" value={person} onChange={(e) => setPerson(e.target.value)} /></label>
          <label className="ck-field"><span>DETAIL (OPTIONAL)</span><input value={detail} placeholder="E.G. ROW 3, NEW BUYER" onChange={(e) => setDetail(e.target.value)} /></label>
          <label className="ck-field">
            <span>LOT (OPTIONAL)</span>
            <Select value={lot} onChange={(e) => setLot(e.target.value)}>
              <option value="">SHARE OVER LOTS IN THE ROOMS</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_code} // {speciesName(l.species_key)} // {l.bag_count}</option>)}
            </Select>
          </label>
        </div>
        <datalist id="lg-people">{people.map((x) => <option key={x} value={x} />)}</datalist>
        {!timer && <div className="ck-btns"><button type="button" className="btn" onClick={start}>START TIMER</button></div>}
        <div className="section-title" style={{ marginTop: 8 }}>OR TYPE THE HOURS</div>
        <div className="ck-fields">
          <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="ck-field"><span>HOURS</span><input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        </div>
        <div className="ck-btns"><button type="button" className="btn on" onClick={() => void save()}>SAVE HOURS</button></div>
        <div className="dim tiny">THE TIMER KEEPS RUNNING IF YOU LEAVE THE SCREEN OR CLOSE THE APP ON THIS DEVICE. IT ROUNDS TO 3 MINUTES.</div>
      </div>
      <div className="ck-box">
        <div className="section-title">HOURS PER TASK // {report.total.toFixed(1)} H IN {weeks} WEEKS</div>
        <div className="lg-btns">
          {[4, 8, 13, 26].map((k) => <button key={k} type="button" className={`btn${weeks === k ? ' on' : ''}`} onClick={() => setWeeks(k)}>{k} WEEKS</button>)}
        </div>
        {report.rows.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>TASK</th><th>HOURS</th><th>H/WEEK</th><th>SHARE</th><th>OUTPUT</th><th>RATE</th><th>WHO</th></tr></thead>
              <tbody>
                {report.rows.map((r) => {
                  const out = TASKS.find((t) => t.id === r.task)!.out
                  return (
                    <tr key={r.task}>
                      <td>{TASK_LABEL[r.task]}</td>
                      <td>{r.hours.toFixed(1)}</td>
                      <td>{r.avgPerWeek.toFixed(1)}</td>
                      <td>{r.sharePct.toFixed(0)}%</td>
                      <td>{r.output === null ? '-' : out === 'blocks' ? `${r.output} BLOCKS` : `${r.output.toFixed(1)} KG`}</td>
                      <td>{r.perHour === null || !out ? '-' : `${r.perHour.toFixed(1)} ${OUTPUT_UNIT[out]}`}</td>
                      <td>{r.people.join(', ')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NO HOURS IN THESE WEEKS YET. PICK A TASK ABOVE AND START THE TIMER, OR TYPE THE HOURS.</div>
        )}
        {report.byPerson.length > 1 && <div className="dim tiny">BY PERSON: {report.byPerson.map((x) => `${x.person} ${x.hours.toFixed(1)} H`).join(' // ')}</div>}
        <div className="dim tiny">RATE = OUTPUT ON THE DAYS THE TASK WAS LOGGED, PER HOUR: KNOCK = BLOCKS KNOCKED THAT DAY; MIX + BAG AND STEAM RUN = BLOCKS KNOCKED THAT WEEK; HARVEST = KG PICKED THAT DAY; PACK AND SELL + DELIVER = KG SOLD THAT DAY. OLD LINES WITH TYPED TASKS ARE MATCHED BY THEIR WORDS. <Guess /></div>
      </div>
      <div className="ck-box">
        <div className="section-title">RATE</div>
        <div className="ck-fields">
          <Field label="₡ PER HOUR (BLANK = HOURS ONLY)" value={p.rate === null ? '' : String(p.rate)} inputMode="decimal" onSave={(v) => void saveRt({ labourRate: num(v) }).then(() => say('LABOUR RATE SAVED'), (e: Error) => say(e.message.toUpperCase(), true))} />
        </div>
        {!p.labourOn && <div className="lg-warn">LABOUR IS SWITCHED OFF ON PRICES + COSTS, SO IT IS NOT IN THE COST.</div>}
      </div>
      <div className="ck-box">
        <div className="section-title">HOURS LOGGED</div>
        {list.length === 0 ? <div className="dim">NONE YET.</div> : (
          <div className="ck-scroll">
            <table className="lg-table">
              <thead><tr><th>DAY</th><th>WHO</th><th>H</th><th>TASK</th><th>LOT</th><th>₡</th><th /></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>{e.worked_on}</td>
                    <td>{e.person.toUpperCase()}</td>
                    <td>{e.hours}</td>
                    <td>{(e.task ?? '').toUpperCase()}</td>
                    <td>{d.lots.find((l) => l.id === e.block_lot_id)?.lot_code ?? '--'}</td>
                    <td>{p.rate ? <>{fmtCrc(e.hours * p.rate)} <small>{fmtUsd(e.hours * p.rate, fxd.rate(e.worked_on))}</small></> : '--'}</td>
                    <td><Confirm label="DELETE" onYes={() => void store.del('labour_entries', e.id).then(() => say('HOURS DELETED'), (er: Error) => say(er.message.toUpperCase(), true))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
