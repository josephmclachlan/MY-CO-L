import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useCargoPrefs, useStore } from '../store/StoreContext'
import { speciesName, useLedger, useLedgerPrefs, type LedgerData } from '../store/useLedger'
import { BILL_ESTIMATE, BILL_ESTIMATE_MID, ICE, LEDGER_GUESSES, iceBill } from '../data/ledger'
import { PART_KEYS, PART_LABEL, addDays, type Basis, type Cost, type EnergyBill, type LabourEntry, type WeekCost } from '../lib/ledger'
import { fmtCrc, fmtUsd, today } from '../lib/cargo'
import { uuid } from '../lib/store'
import { Confirm, Field, Guess } from './CookParts'

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
  { id: 'labour', label: 'LABOUR HOURS' },
  { id: 'settings', label: 'SWITCHES + GUESSES' },
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
      {x.sel === 'settings' && <Settings />}
      {x.sel.startsWith('week:') && (week ? <Week w={week} fx={fx} /> : <div className="dim">THAT WEEK HAS NO LOTS ANY MORE.</div>)}
    </div>
  )
}

// ---------- cost cards ----------

function CostCard({ c, fx, title }: { c: Cost; fx: number; title?: string }) {
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
          <Money crc={c.perBlock} fx={fx} />
        </div>
        <div>
          <span>PER KG</span>
          <Money crc={c.perKg} fx={fx} />
        </div>
        <div>
          <span>TOTAL</span>
          <Money crc={c.total} fx={fx} />
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
  const { ledger, plan } = d
  const noPrices = plan.all.parts.consumables.basis === 'NONE'
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">COST OF GOODS // ₡ FIRST, US$ AT ₡{fx}</div>
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
      <div className="dim tiny">A STANDARD WEEK (52 BLUE, 46 LION'S MANE, 16 CORAL, 16 GOLDEN) BEFORE ANY DATA. CARGO PRICES, PLANNED COOKS, THE PACKAGE BILL ESTIMATE, CATAWBA YIELDS.</div>
      <CostCard c={plan.all} fx={fx} title="PLAN WEEK" />
      {plan.species.map((c) => <CostCard key={c.key} c={c} fx={fx} />)}
      <div className="ck-box">
        <div className="section-title">ROOM ENERGY BY MONTH</div>
        {ledger.months.length === 0 ? (
          <div className="dim">NO LOTS OR BILLS YET. UNTIL A BILL IS TYPED IN, A MONTH USES THE PACKAGE ESTIMATE {fmtCrc(BILL_ESTIMATE.low)}-{fmtCrc(BILL_ESTIMATE.high)} ({fmtUsd(BILL_ESTIMATE.low, fx)}-{fmtUsd(BILL_ESTIMATE.high, fx)}).</div>
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
            THE TARIFF SAYS {fmtCrc(check)} ({fmtUsd(check, fx)}) FOR {k?.toLocaleString('en-US')} KWH AT {Math.max(w ?? ICE.demandMinKw, ICE.demandMinKw)} KW.
            {c !== null && ` THE BILL IS ${c >= check ? '+' : ''}${(((c - check) / check) * 100).toFixed(0)}%.`}
            {c !== null && Math.abs(c - check) / check > 0.1 && ' MORE THAN 10% OFF: CHECK THE FIGURES OR ASK ICE WHICH TARIFF YOU ARE ON.'}
          </div>
        )}
        <div className="dim tiny">{ICE.source}</div>
        <div className="ck-btns"><button type="button" className="btn on" onClick={() => void save()}>SAVE BILL</button></div>
      </div>
      <div className="ck-box">
        <div className="section-title">BILLS</div>
        {list.length === 0 ? (
          <div className="dim">
            NO BILLS YET. UNTIL THEN EVERY MONTH USES THE ESTIMATE {fmtCrc(BILL_ESTIMATE_MID)} ({fmtUsd(BILL_ESTIMATE_MID, fx)}) <span className="lg-tag estimate">ESTIMATE</span>, THE MIDDLE OF {BILL_ESTIMATE.source}.
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
                      <td>{fmtUsd(Number(b.total_crc), fx)}</td>
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

function Labour({ d, fx, say }: { d: LedgerData; fx: number; say: Say }) {
  const store = useStore()
  const [p, setP] = useLedgerPrefs()
  const [day, setDay] = useState(today())
  const [person, setPerson] = useState('')
  const [hours, setHours] = useState('')
  const [task, setTask] = useState('')
  const [lot, setLot] = useState('')
  const people = [...new Set(d.labour.map((e) => e.person))]
  const lots = [...d.lots].sort((a, b) => b.knock_date.localeCompare(a.knock_date)).slice(0, 30)
  const list = [...d.labour].sort((a, b) => b.worked_on.localeCompare(a.worked_on)).slice(0, 60)
  const save = async () => {
    const h = num(hours)
    if (!person.trim()) return say('WHO WORKED?', true)
    if (h === null || h <= 0) return say('TYPE THE HOURS.', true)
    const row: LabourEntry = { id: uuid(), worked_on: day, person: person.trim(), hours: h, task: task.trim() || null, block_lot_id: lot || null, notes: null, created_at: new Date().toISOString() }
    try {
      await store.put('labour_entries', row)
      setHours('')
      setTask('')
      say(`${h} H LOGGED FOR ${row.person.toUpperCase()}`)
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'SAVE FAILED', true)
    }
  }
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">LOG HOURS</div>
        <div className="ck-fields">
          <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="ck-field"><span>WHO</span><input list="lg-people" value={person} onChange={(e) => setPerson(e.target.value)} /></label>
          <label className="ck-field"><span>HOURS</span><input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></label>
          <label className="ck-field"><span>TASK</span><input value={task} placeholder="KNOCK, HARVEST, PACK..." onChange={(e) => setTask(e.target.value)} /></label>
          <label className="ck-field">
            <span>LOT (OPTIONAL)</span>
            <Select value={lot} onChange={(e) => setLot(e.target.value)}>
              <option value="">SHARE OVER LOTS IN THE ROOMS</option>
              {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_code} // {speciesName(l.species_key)} // {l.bag_count}</option>)}
            </Select>
          </label>
        </div>
        <datalist id="lg-people">{people.map((x) => <option key={x} value={x} />)}</datalist>
        <div className="dim tiny">HOURS WITH NO LOT ARE SHARED OVER EVERY LOT IN THE ROOMS THAT DAY, BY BLOCKS. <Guess /></div>
        <div className="ck-btns"><button type="button" className="btn on" onClick={() => void save()}>SAVE HOURS</button></div>
      </div>
      <div className="ck-box">
        <div className="section-title">RATE</div>
        <div className="ck-fields">
          <Field label="₡ PER HOUR (BLANK = HOURS ONLY)" value={p.rate === null ? '' : String(p.rate)} inputMode="decimal" onSave={(v) => setP({ rate: num(v) })} />
        </div>
        {!p.labourOn && <div className="lg-warn">LABOUR IS SWITCHED OFF IN SWITCHES + GUESSES, SO IT IS NOT IN THE COST.</div>}
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
                    <td>{p.rate ? <>{fmtCrc(e.hours * p.rate)} <small>{fmtUsd(e.hours * p.rate, fx)}</small></> : '--'}</td>
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

// ---------- switches ----------

function Settings() {
  const [p, setP] = useLedgerPrefs()
  const [cp, setCp] = useCargoPrefs()
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">WHAT GOES INTO THE COST</div>
        <label className="ck-check"><input type="checkbox" checked={p.labourOn} onChange={(e) => setP({ labourOn: e.target.checked })} /> LABOUR IN THE COST <Guess /></label>
        <div className="ck-fields">
          <Field label="LABOUR ₡ PER HOUR (BLANK = HOURS ONLY)" value={p.rate === null ? '' : String(p.rate)} inputMode="decimal" onSave={(v) => setP({ rate: num(v) })} />
        </div>
        <label className="ck-check"><input type="checkbox" checked={p.wearOn} onChange={(e) => setP({ wearOn: e.target.checked })} /> EQUIPMENT WEAR <Guess /></label>
        <div className="ck-fields">
          <Field label="WEAR ₡ PER BLOCK" value={p.wearPerBlock === null ? '' : String(p.wearPerBlock)} inputMode="decimal" disabled={!p.wearOn} onSave={(v) => setP({ wearPerBlock: num(v) })} />
          <Field label="₡ PER US$ (SHARED WITH CARGO)" value={String(cp.fx)} inputMode="decimal" onSave={(v) => { const n = num(v); if (n && n > 0) setCp({ fx: n }) }} />
        </div>
        <div className="dim tiny">THESE SWITCHES ARE SAVED ON THIS DEVICE ONLY.</div>
      </div>
      <div className="ck-box">
        <div className="section-title">BEST GUESSES WAITING FOR JOSEPH <Guess /></div>
        <ul className="ck-guesses">{LEDGER_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
      </div>
    </div>
  )
}
