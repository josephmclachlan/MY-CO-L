import { useMemo, useState, type ReactNode } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore, useTable } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HistoryButton } from './History'
import { Confirm, Guess } from './CookParts'
import { PracticeFields } from './XenoBank'
import { speciesName, useLedger } from '../store/useLedger'
import { useMoney, useMoneyEditor, type MoneyData } from '../store/useMoney'
import { useFxSync } from '../store/useFx'
import { useRates } from '../store/useRates'
import { useRecords } from '../store/useRecords'
import { CHANNELS, LB_KG, SALE_SPECIES, YIELD_LB } from '../data/ledger'
import { STATION } from '../data/farm'
import { averageSplit, usePlan } from '../data/cropplan'
import { fmtCrc as crcBase, fmtUsd } from '../lib/cargo'
import { estimateMid, salePrice } from '../lib/rates'
import { addDays, type BlockLot, type Culture, type GrainRun, type Strain } from '../lib/xeno'
import { weekOf } from '../lib/ledger'
import { parseLots, type Sale } from '../lib/trade'
import { figuresFor } from '../lib/orders'
import type { CookRun } from '../lib/cook'
import type { LotLoss } from '../lib/hazard'
import {
  AGE_BUCKETS,
  LINES,
  MONEY_GUESSES,
  PAYMENT_RULE,
  TYPED_LINES,
  WASTE_ROUTES,
  WEEKS_PER_MONTH,
  addMonths,
  bookGet,
  bookMonth,
  breakEven,
  buyerGaps,
  buyerShare,
  cashFlow,
  holdFor,
  lineLabel,
  monthLabel,
  monthOf,
  payStatus,
  paidDay,
  planWeekSales,
  pnlMonth,
  receiptText,
  recallList,
  recallLots,
  recallText,
  totalTrend,
  traceLot,
  trends,
  wasteWeeks,
  whatIf,
  type Book,
  type CashMove,
  type RecallBy,
  type Trend,
  type TrendBy,
  type TraceDb,
  type WasteEntry,
  type WasteRoute,
} from '../lib/money'
import { addMove, addWaste, deleteMoves, deleteWaste, fillBudget, issueReceipts, markOwed, markPaid, seedBudget, setBudget, writeOff } from '../lib/moneyActions'

// MONEY (build G6): money owed and receipts, spending, monthly profit and loss, the 12-month cash flow,
// the budget, sales trends, the waste log, trace and recall, and the what-if planner.
// Every amount is in colones first; US$ is at each record's own day's rate, never today's.

export type MoneyTab = 'OWED' | 'RECEIPTS' | 'SPEND' | 'PNL' | 'CASH' | 'BUDGET' | 'TRENDS' | 'WASTE' | 'TRACE' | 'WHATIF' | 'GUESSES'
export const MONEY_TABS: MoneyTab[] = ['OWED', 'RECEIPTS', 'SPEND', 'PNL', 'CASH', 'BUDGET', 'TRENDS', 'WASTE', 'TRACE', 'WHATIF', 'GUESSES']
const TAB_LABEL: Record<MoneyTab, string> = {
  OWED: 'MONEY OWED',
  RECEIPTS: 'RECEIPTS',
  SPEND: 'SPENDING + CASH IN',
  PNL: 'PROFIT AND LOSS',
  CASH: '12-MONTH CASH FLOW',
  BUDGET: 'BUDGET',
  TRENDS: 'SALES TRENDS',
  WASTE: 'WASTE LOG',
  TRACE: 'TRACE + RECALL',
  WHATIF: 'WHAT-IF PLANNER',
  GUESSES: 'GUESSES',
}
export interface MoneyState {
  tab: MoneyTab
  /** Month on show in PROFIT AND LOSS and BUDGET (yyyy-mm); null = this month. */
  month: string | null
  trendBy: TrendBy
  sale: string | null
  /** Lot code typed on TRACE. */
  code: string
  recall: { by: RecallBy; id: string; title: string } | null
}
export const MONEY_START: MoneyState = { tab: 'OWED', month: null, trendBy: 'species', sale: null, code: '', recall: null }
type SetMoney = (p: Partial<MoneyState>) => void
type Say = (t: string, warn?: boolean) => void

const num = (s: string): number | null => {
  const v = Number(s.replace(/[₡,\s]/g, ''))
  return s.trim() && Number.isFinite(v) ? v : null
}
/** ₡ with the minus in front: -₡674,550. */
const fmtCrc = (v: number) => (Math.round(v) < 0 ? `-${crcBase(-v)}` : crcBase(v))
const kgF = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const pctF = (v: number | null) => (v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`)
const sp = speciesName
const chLabel = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c.toUpperCase()
const usdF = (usd: number) => `US$${Math.abs(usd) < 10 ? usd.toFixed(2) : Math.round(usd).toLocaleString('en-US')}`
/** ₡ with its US$ underneath. usd = the sum of each record at its own day's rate. */
function Amt({ crc, usd, className }: { crc: number; usd?: number | null; className?: string }) {
  return (
    <span className={`lg-money ${className ?? ''}`}>
      {fmtCrc(crc)}
      {usd !== undefined && usd !== null && <small> {usdF(usd)}</small>}
    </span>
  )
}

function useRun(say: Say) {
  const { sound } = useApp()
  const store = useStore()
  return async (label: string, fn: () => Promise<unknown>) => {
    try {
      await store.action(label, fn)
      sound.confirm()
      say(label)
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
      return false
    }
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const t = document.createElement('textarea')
      t.value = text
      t.style.position = 'fixed'
      t.style.opacity = '0'
      document.body.appendChild(t)
      t.select()
      const ok = document.execCommand('copy')
      t.remove()
      return ok
    } catch {
      return false
    }
  }
}

function Buttons<T extends string>({ value, options, onPick, label }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void; label?: string }) {
  const { sound } = useApp()
  return (
    <div className="lg-btns" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={`btn ${o.id === value ? 'on' : ''}`} aria-pressed={o.id === value} onClick={() => (sound.chirp(), onPick(o.id))}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- index (left menu) ----------

export function MoneyIndex({ x, set }: { x: MoneyState; set: SetMoney }) {
  const { sound } = useApp()
  const d = useMoney()
  const m = monthOf(d.today)
  const p = pnlMonth(m, d.pnl, d.bud, d.sales)
  return (
    <>
      <div className="section-title">MONEY</div>
      <ul className="index-list">
        {MONEY_TABS.map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{TAB_LABEL[t]}</span>
            {t === 'OWED' && d.owed.buyers.length > 0 && <span className="k">{d.owed.buyers.length} ON HOLD</span>}
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>{monthLabel(m)} SO FAR</div>
      <div className="lg-mini">
        <div>SALES {fmtCrc(p.revenue)}</div>
        <div>COSTS {fmtCrc(p.cost)}</div>
        <div>PROFIT {fmtCrc(p.profit)}</div>
        <div className={d.owed.total > 0 ? 'lg-warn-text' : ''}>OWED {fmtCrc(d.owed.total)}</div>
      </div>
    </>
  )
}

// ---------- shell ----------

export function Money({ x, set, say, onOpenTrade, onOpenLedger }: { x: MoneyState; set: SetMoney; say: Say; onOpenTrade: () => void; onOpenLedger: () => void }) {
  const { sound } = useApp()
  const d = useMoney()
  useFxSync([...d.sales.map((s) => s.sold_on), ...d.moves.map((m) => m.day)])
  return (
    <div className="cook ledger od mn">
      <label className="ck-picker">
        <span>SHOW ({MONEY_TABS.length} SCREENS)</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as MoneyTab }))}>
          {MONEY_TABS.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
        </Select>
      </label>
      {(x.tab === 'OWED' || x.tab === 'RECEIPTS') && <div className="od-pay" role="note">{PAYMENT_RULE}</div>}
      {x.tab === 'OWED' && <OwedTab d={d} say={say} onOpenTrade={onOpenTrade} set={set} />}
      {x.tab === 'RECEIPTS' && <ReceiptsTab d={d} x={x} set={set} say={say} />}
      {x.tab === 'SPEND' && <SpendTab d={d} say={say} onOpenLedger={onOpenLedger} />}
      {x.tab === 'PNL' && <PnlTab d={d} x={x} set={set} onOpenLedger={onOpenLedger} />}
      {x.tab === 'CASH' && <CashTab d={d} set={set} say={say} />}
      {x.tab === 'BUDGET' && <BudgetTab d={d} x={x} set={set} say={say} />}
      {x.tab === 'TRENDS' && <TrendsTab d={d} x={x} set={set} />}
      {x.tab === 'WASTE' && <WasteTab d={d} say={say} />}
      {x.tab === 'TRACE' && <TraceTab d={d} x={x} set={set} say={say} />}
      {x.tab === 'WHATIF' && <WhatIfTab d={d} />}
      {x.tab === 'GUESSES' && (
        <div className="ck-box">
          <div className="section-title">BEST GUESSES WAITING FOR JOSEPH <Guess /></div>
          <ul className="ck-guesses">{MONEY_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

// ---------- money owed ----------

function OwedTab({ d, say, onOpenTrade, set }: { d: MoneyData; say: Say; onOpenTrade: () => void; set: SetMoney }) {
  const run = useRun(say)
  const store = useStore()
  const [pick, setPick] = useState<string[]>([])
  const [day, setDay] = useState(d.today)
  const o = d.owed
  const from = addDays(weekOf(d.today), -21)
  const share = buyerShare(d.sales, from, d.today, d.practice.buyerCapPct)
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const picked = o.rows.filter((r) => pick.includes(r.sale.id))
  const max = Math.max(1, ...AGE_BUCKETS.map((b) => o.buckets[b.id]))
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">MONEY OWED TO THE FARM</div>
        <div className="lg-big">
          <div><span>TOTAL OWED</span><b className={o.total > 0 ? 'lg-warn-text' : ''}>{fmtCrc(o.total)}</b></div>
          <div><span>UNPAID SALES</span><b>{o.rows.length}</b></div>
          <div><span>BUYERS ON HOLD</span><b>{o.buyers.length}</b></div>
          <div><span>OLDEST</span><b>{o.rows.length ? `${o.rows[0].days} DAYS` : '--'}</b></div>
        </div>
        {o.rows.length === 0 ? (
          <div className="dim">NOTHING OWED. EVERY SALE WAS PAID ON DELIVERY.</div>
        ) : (
          <>
            <div className="lg-hbars" aria-label="Money owed by age">
              {AGE_BUCKETS.map((b) => (
                <div key={b.id} className="lg-hbar">
                  <span className="lg-pl">{b.label}</span>
                  <span className="lg-bar"><i style={{ width: `${(o.buckets[b.id] / max) * 100}%` }} /></span>
                  <span className="lg-pv">{fmtCrc(o.buckets[b.id])}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {o.buyers.length > 0 && (
        <div className="ck-box">
          <div className="section-title">BUYERS ON HOLD // NO DELIVERY UNTIL PAID</div>
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>BUYER</th><th>OWES</th><th>SALES</th><th>SINCE</th><th>DAYS</th></tr></thead>
              <tbody>
                {o.buyers.map((b) => (
                  <tr key={b.buyer} className="od-row over">
                    <td>{b.buyer.toUpperCase()}</td>
                    <td>{fmtCrc(b.crc)}</td>
                    <td>{b.n}</td>
                    <td>{b.oldest}</td>
                    <td>{b.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {o.rows.length > 0 && (
        <div className="ck-box">
          <div className="section-title">UNPAID SALES // TAP TO PICK, THEN MARK PAID</div>
          <div className="rc-wrap">
            <table className="lg-table rc-table mn-owed">
              <thead><tr><th>PICK</th><th>BUYER</th><th>SOLD</th><th>DAYS</th><th>PRODUCT</th><th>₡</th><th className="hide-sm">RECEIPT</th></tr></thead>
              <tbody>
                {o.rows.map((r) => (
                  <tr key={r.sale.id} tabIndex={0} className={pick.includes(r.sale.id) ? 'sel' : ''} aria-selected={pick.includes(r.sale.id)} onClick={() => toggle(r.sale.id)}>
                    <td>{pick.includes(r.sale.id) ? '[X]' : '[ ]'}</td>
                    <td>{(r.sale.buyer ?? 'NO NAME').toUpperCase()}</td>
                    <td>{r.sale.sold_on}</td>
                    <td>{r.days}</td>
                    <td>{sp(r.sale.species_key ?? 'unknown')}</td>
                    <td>{fmtCrc(Number(r.sale.amount_crc))}</td>
                    <td className="hide-sm">{r.sale.receipt_no ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ck-fields">
            <label className="ck-field"><span>DAY THE CASH CAME IN</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          </div>
          <div className="lg-btns">
            <button type="button" className="btn" onClick={() => setPick(pick.length === o.rows.length ? [] : o.rows.map((r) => r.sale.id))}>{pick.length === o.rows.length ? 'PICK NONE' : 'PICK ALL'}</button>
            <button type="button" className="btn on" disabled={!picked.length} onClick={() => void run(`MARKED ${picked.length} SALE${picked.length === 1 ? '' : 'S'} PAID ${day}`, async () => { await markPaid(store, pick, day) }).then((ok) => ok && setPick([]))}>
              MARK {picked.length || ''} PAID
            </button>
          </div>
          <div className="lg-btns mn-danger">
            <span className="dim tiny">GIVE UP ON IT (NEVER GOING TO BE PAID):</span>
            <Confirm label={`WRITE OFF ${picked.length || ''}`} disabled={!picked.length} onYes={() => void run(`WROTE OFF ${picked.length} SALE${picked.length === 1 ? '' : 'S'}`, async () => { await writeOff(store, pick, day) }).then((ok) => ok && setPick([]))} />
          </div>
          <div className="dim tiny">PICKED: {fmtCrc(picked.reduce((t, r) => t + Number(r.sale.amount_crc), 0))}. A WRITE-OFF IS A COST IN THE MONTH OF THAT DAY. EVERY CHANGE HAS UNDO AND HISTORY.</div>
        </div>
      )}

      <div className="ck-box">
        <div className="section-title">BUYER SHARE OF SALES // LAST 4 WEEKS // CAP {d.practice.buyerCapPct}% <Guess /></div>
        {share.rows.length === 0 ? (
          <div className="dim">NO NAMED BUYERS IN THE LAST 4 WEEKS. <button type="button" className="ck-link" onClick={onOpenTrade}>LOG A SALE IN TRADE</button></div>
        ) : (
          <div className="rc-wrap">
            <table className="lg-table rc-table od-dep">
              <thead><tr><th>BUYER</th><th>₡</th><th>SHARE</th><th className="hide-sm">LAST</th><th>PAYMENT</th></tr></thead>
              <tbody>
                {share.rows.map((r) => {
                  const h = holdFor(o, r.buyer)
                  return (
                    <tr key={r.buyer} className={`od-row ${r.level}`}>
                      <td>{r.buyer.toUpperCase()}</td>
                      <td>{fmtCrc(r.crc)}</td>
                      <td>
                        <span className="od-share">
                          <span className="od-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, r.sharePct)}%` }} /></span>
                          <b>{r.sharePct.toFixed(0)}%</b>
                          {r.level === 'over' && <span className="od-tag over">OVER CAP</span>}
                          {r.level === 'near' && <span className="od-tag near">NEAR CAP</span>}
                        </span>
                      </td>
                      <td className="hide-sm">{r.last}</td>
                      <td>{h ? <span className="od-tag over">ON HOLD</span> : 'CLEAR'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {share.unnamed > 0 && <div className="dim tiny">{fmtCrc(share.unnamed)} OF SALES HAD NO BUYER NAME (MARKET OR CASH). THEY COUNT IN THE TOTAL.</div>}
        {share.rows.some((r) => r.level === 'over') && (
          <div className="lg-warn">{share.rows.filter((r) => r.level === 'over').map((r) => r.buyer.toUpperCase()).join(', ')}: MORE THAN {d.practice.buyerCapPct}% OF THE FARM&apos;S SALES. IF THEY STOP, A BIG PART OF THE INCOME GOES WITH THEM.</div>
        )}
        <PracticeFields keys={['buyerCapPct']} title="BUYER CAP" say={say} />
        <div className="dim tiny">CREDIT RULE FOR EVERY BUYER: {PAYMENT_RULE} <button type="button" className="ck-link" onClick={() => set({ tab: 'RECEIPTS' })}>OPEN RECEIPTS</button></div>
      </div>
    </div>
  )
}

// ---------- receipts ----------

function ReceiptsTab({ d, x, set, say }: { d: MoneyData; x: MoneyState; set: SetMoney; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const [all, setAll] = useState(false)
  const list = useMemo(() => [...d.sales].sort((a, b) => b.sold_on.localeCompare(a.sold_on) || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [d.sales])
  const shown = all ? list.slice(0, 500) : list.slice(0, 30)
  const sel = d.sales.find((s) => s.id === x.sale) ?? null
  const text = sel ? receiptText({ sale: sel, farm: STATION.company, place: STATION.place, speciesName: sp, fx: d.fx.rate(sel.sold_on) }) : ''
  const noNumber = list.filter((s) => !s.receipt_no)
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">SALES // TAP ONE FOR ITS RECEIPT</div>
        {list.length === 0 ? <div className="dim">NO SALES YET. SALES ARE LOGGED IN TRADE OR FROM THE PICK LIST.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>BUYER</th><th>PRODUCT</th><th>₡</th><th>PAID</th><th className="hide-sm">RECEIPT</th></tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} tabIndex={0} className={s.id === x.sale ? 'sel' : ''} onClick={() => set({ sale: s.id })}>
                    <td>{s.sold_on}</td>
                    <td>{(s.buyer ?? '--').toUpperCase()}</td>
                    <td>{sp(s.species_key ?? 'unknown')}{s.form !== 'fresh' ? ` ${s.form.toUpperCase()}` : ''}</td>
                    <td>{fmtCrc(Number(s.amount_crc))}</td>
                    <td>{payStatus(s) === 'paid' ? paidDay(s) : payStatus(s) === 'owed' ? <span className="lg-warn-text">OWED</span> : 'WRITTEN OFF'}</td>
                    <td className="hide-sm">{s.receipt_no ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 30 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW THE NEWEST 30' : `SHOW MORE (${Math.min(500, list.length)})`}</button>}
        {noNumber.length > 0 && (
          <button type="button" className="btn" onClick={() => void run(`GAVE RECEIPT NUMBERS TO ${noNumber.length} SALES`, async () => { await issueReceipts(store, noNumber.map((s) => s.id)) })}>
            NUMBER ALL {noNumber.length} SALES WITH NO RECEIPT
          </button>
        )}
      </div>
      {sel && (
        <div className="ck-box">
          <div className="section-title">RECEIPT {sel.receipt_no ?? '(NO NUMBER YET)'}</div>
          <textarea className="od-text mn-receipt" readOnly value={text} aria-label="Receipt text" rows={14} />
          <div className="lg-btns">
            {!sel.receipt_no && <button type="button" className="btn on" onClick={() => void run(`RECEIPT NUMBER GIVEN`, async () => { await issueReceipts(store, [sel.id]) })}>GIVE IT A NUMBER</button>}
            <button type="button" className="btn" onClick={() => void copyText(text).then((ok) => say(ok ? 'RECEIPT COPIED. PASTE IT IN WHATSAPP.' : 'COPY FAILED. SELECT THE TEXT AND COPY IT.', !ok))}>COPY RECEIPT</button>
            {payStatus(sel) === 'paid' && <Confirm label="NOT PAID YET" onYes={() => void run('SALE MARKED OWED', async () => { await markOwed(store, [sel.id]) })} />}
            {payStatus(sel) !== 'paid' && <button type="button" className="btn" onClick={() => void run(`SALE MARKED PAID ${d.today}`, async () => { await markPaid(store, [sel.id], d.today) })}>MARK PAID TODAY</button>}
            <HistoryButton table="sales" id={sel.id} />
          </div>
          <div className="dim tiny">A RECEIPT NUMBER, ONCE GIVEN, NEVER CHANGES. THIS IS NOT AN ELECTRONIC INVOICE (FACTURA ELECTRONICA): ASK THE ACCOUNTANT WHICH SALES NEED ONE.</div>
        </div>
      )}
    </div>
  )
}

// ---------- spending and cash in ----------

function SpendTab({ d, say, onOpenLedger }: { d: MoneyData; say: Say; onOpenLedger: () => void }) {
  const run = useRun(say)
  const store = useStore()
  const [day, setDay] = useState(d.today)
  const [kind, setKind] = useState<'out' | 'in'>('out')
  const [line, setLine] = useState('substrate')
  const [amt, setAmt] = useState('')
  const [who, setWho] = useState('')
  const [notes, setNotes] = useState('')
  const [all, setAll] = useState(false)
  const lines = TYPED_LINES.filter((l) => l.kind === kind)
  const list = useMemo(() => [...d.moves].sort((a, b) => b.day.localeCompare(a.day) || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [d.moves])
  const m = monthOf(d.today)
  const thisMonth = LINES.filter((l) => bookGet(d.cash, m, l.id)).map((l) => ({ l, v: bookGet(d.cash, m, l.id) }))
  const save = () =>
    void run(`${kind === 'out' ? 'SPENT' : 'CASH IN'} ${fmtCrc(num(amt) ?? 0)} // ${lineLabel(line)}`, async () => {
      await addMove(store, { day, line, amount: num(amt), who, notes })
    }).then((ok) => {
      if (ok) {
        setAmt('')
        setNotes('')
      }
    })
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">LOG MONEY {kind === 'out' ? 'SPENT' : 'COMING IN'}</div>
        <Buttons label="Money out or in" value={kind} options={[{ id: 'out', label: 'MONEY OUT' }, { id: 'in', label: 'MONEY IN (NOT A SALE)' }]} onPick={(k) => (setKind(k), setLine(k === 'out' ? 'substrate' : 'loan_in'))} />
        <div className="ck-fields">
          <label className="ck-field"><span>DAY PAID</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="ck-field">
            <span>LINE</span>
            <Select aria-label="Line" value={line} onChange={(e) => setLine(e.target.value)}>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </Select>
          </label>
        </div>
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>₡ AMOUNT</span><input inputMode="decimal" value={amt} placeholder="0" onChange={(e) => setAmt(e.target.value)} />{num(amt) !== null && <em>{fmtUsd(num(amt) as number, d.fx.rate(day))} AT ₡{d.fx.rate(day)} ON {day}</em>}</label>
          <label className="ck-field"><span>{kind === 'out' ? 'PAID TO' : 'FROM'}</span><input value={who} placeholder="OPTIONAL" onChange={(e) => setWho(e.target.value)} /></label>
        </div>
        <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button type="button" className="btn on lg-save" onClick={save}>SAVE</button>
        <div className="dim tiny">
          SALES COME FROM TRADE. ICE BILLS COME FROM LEDGER ({d.bills.length} LOGGED). {d.settings.cargoAsSpend ? 'CARGO DELIVERIES COUNT AS SPENT, SO DO NOT TYPE SUPPLY BILLS HERE TOO. ' : ''}
          {d.settings.hoursAsSpend ? 'LEDGER HOURS COUNT AS WAGES, SO DO NOT TYPE WAGES HERE TOO. ' : ''}
          <button type="button" className="ck-link" onClick={onOpenLedger}>OPEN LEDGER</button> // SWITCHES ARE ON THE CASH FLOW TAB.
        </div>
      </div>

      <div className="ck-box">
        <div className="section-title">{monthLabel(m)} SO FAR // CASH BY LINE</div>
        {thisMonth.length === 0 ? <div className="dim">NOTHING YET THIS MONTH.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>LINE</th><th>IN / OUT</th><th>₡</th><th>US$</th></tr></thead>
              <tbody>
                {thisMonth.map(({ l, v }) => (
                  <tr key={l.id}><td>{l.label}</td><td>{l.kind.toUpperCase()}</td><td>{fmtCrc(v)}</td><td>{usdF(bookGet(d.cashUsd, m, l.id))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ck-box">
        <div className="section-title">TYPED ENTRIES // {list.length}</div>
        {list.length === 0 ? <div className="dim">NO ENTRIES YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>LINE</th><th>₡</th><th className="hide-sm">WHO</th><th className="hide-sm">NOTES</th><th /></tr></thead>
              <tbody>
                {(all ? list.slice(0, 1000) : list.slice(0, 40)).map((mv) => <MoveRow key={mv.id} m={mv} say={say} />)}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 40 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW THE NEWEST 40' : `SHOW MORE (${Math.min(1000, list.length)})`}</button>}
      </div>
    </div>
  )
}

function MoveRow({ m, say }: { m: CashMove; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const l = LINES.find((x) => x.id === m.line)
  return (
    <tr>
      <td>{m.day}</td>
      <td>{l?.kind === 'in' ? 'IN: ' : ''}{lineLabel(m.line)}</td>
      <td>{fmtCrc(Number(m.amount_crc))}</td>
      <td className="hide-sm">{m.who ?? '--'}</td>
      <td className="hide-sm">{m.notes ?? '--'}</td>
      <td className="mn-act">
        <HistoryButton table="cash_moves" id={m.id} />
        <Confirm label="DELETE" onYes={() => void run('ENTRY DELETED', async () => { await deleteMoves(store, [m.id]) })} />
      </td>
    </tr>
  )
}

// ---------- profit and loss ----------

function MonthBar({ month, today, set, label }: { month: string; today: string; set: SetMoney; label: string }) {
  const { sound } = useApp()
  const now = monthOf(today)
  const go = (m: string) => (sound.chirp(), set({ month: m === now ? null : m }))
  return (
    <div className="ck-box od-week">
      <div className="section-title">{label} // {monthLabel(month)}{month === now ? ' (SO FAR)' : month > now ? ' (TO COME)' : ''}</div>
      <div className="lg-btns">
        <button type="button" className="btn" onClick={() => go(addMonths(month, -1))}>&lt; EARLIER</button>
        <button type="button" className={`btn ${month === now ? 'on' : ''}`} onClick={() => go(now)}>THIS MONTH</button>
        <button type="button" className="btn" onClick={() => go(addMonths(month, 1))}>LATER &gt;</button>
      </div>
    </div>
  )
}

function PnlTab({ d, x, set, onOpenLedger }: { d: MoneyData; x: MoneyState; set: SetMoney; onOpenLedger: () => void }) {
  const r = useRecords()
  const month = x.month ?? monthOf(d.today)
  const p = pnlMonth(month, d.pnl, d.bud, d.sales)
  const usd = (line: string) => bookGet(d.pnlUsd, month, line)
  const now = monthOf(d.today)
  const year = Array.from({ length: 12 }, (_, i) => addMonths(now, i - 11))
  const yr = year.map((m) => pnlMonth(m, d.pnl, d.bud, d.sales))
  const max = Math.max(1, ...yr.map((y) => Math.max(y.revenue, y.cost)))
  const last3 = [1, 2, 3].map((i) => addMonths(now, -i)).reverse()
  const kgBlock = useMemo(() => avgKgPerBlock(r.recs), [r.recs])
  const be = breakEven(last3, d.pnl, d.sales, kgBlock)
  const Row = ({ row }: { row: (typeof p.income)[number] }) => (
    <tr>
      <td>{row.label}</td>
      <td><Amt crc={row.actual} usd={usd(row.line)} /></td>
      <td>{row.budget ? fmtCrc(row.budget) : '--'}</td>
      <td className={row.budget && row.better < 0 ? 'lg-warn-text' : ''}>{row.budget ? `${row.better >= 0 ? '+' : ''}${fmtCrc(row.better)}` : '--'}</td>
    </tr>
  )
  return (
    <div className="lg-stack">
      <MonthBar month={month} today={d.today} set={set} label="PROFIT AND LOSS" />
      <div className="ck-box">
        <div className="lg-big">
          <div><span>SALES</span><Amt crc={p.revenue} usd={bookMonth(d.pnlUsd, month, 'in', true)} /></div>
          <div><span>COSTS</span><Amt crc={p.cost} usd={bookMonth(d.pnlUsd, month, 'out', true)} /></div>
          <div><span>PROFIT</span><b className={p.profit < 0 ? 'lg-warn-text' : ''}>{fmtCrc(p.profit)}</b></div>
          <div><span>MARGIN</span><b>{p.marginPct === null ? '--' : `${p.marginPct.toFixed(0)}%`}</b></div>
          <div><span>FRESH KG SOLD</span><b>{kgF(p.kgSold)}</b></div>
        </div>
        <div className="rc-wrap">
          <table className="lg-table rc-table mn-pnl">
            <thead><tr><th>LINE</th><th>ACTUAL</th><th>BUDGET</th><th>VS BUDGET</th></tr></thead>
            <tbody>
              <tr className="mn-head"><td colSpan={4}>INCOME</td></tr>
              {p.income.map((row) => <Row key={row.line} row={row} />)}
              <tr className="od-total"><td>TOTAL INCOME</td><td>{fmtCrc(p.revenue)}</td><td>{p.budgetRevenue ? fmtCrc(p.budgetRevenue) : '--'}</td><td>{p.budgetRevenue ? `${p.revenue - p.budgetRevenue >= 0 ? '+' : ''}${fmtCrc(p.revenue - p.budgetRevenue)}` : '--'}</td></tr>
              <tr className="mn-head"><td colSpan={4}>COSTS</td></tr>
              {p.costs.map((row) => <Row key={row.line} row={row} />)}
              <tr className="od-total"><td>TOTAL COSTS</td><td>{fmtCrc(p.cost)}</td><td>{p.budgetCost ? fmtCrc(p.budgetCost) : '--'}</td><td>{p.budgetCost ? `${p.budgetCost - p.cost >= 0 ? '+' : ''}${fmtCrc(p.budgetCost - p.cost)}` : '--'}</td></tr>
              <tr className="od-total"><td><b>PROFIT</b></td><td><b>{fmtCrc(p.profit)}</b></td><td>{p.budgetRevenue || p.budgetCost ? fmtCrc(p.budgetProfit) : '--'}</td><td>{p.budgetRevenue || p.budgetCost ? `${p.profit - p.budgetProfit >= 0 ? '+' : ''}${fmtCrc(p.profit - p.budgetProfit)}` : '--'}</td></tr>
            </tbody>
          </table>
        </div>
        {!bookGet(d.pnl, month, 'electricity') && month <= now && <div className="dim tiny">NO ICE BILL LOGGED FOR {monthLabel(month)}. <button type="button" className="ck-link" onClick={onOpenLedger}>ADD IT IN LEDGER</button></div>}
        {d.unpriced > 0 && <div className="dim tiny">{d.unpriced} CARGO DELIVERIES HAVE NO PRICE, SO THEY ARE NOT COUNTED. ADD PRICES IN CARGO.</div>}
        <div className="dim tiny">SALES COUNT IN THE MONTH SOLD (PAID OR NOT). US$ IS EACH RECORD AT ITS OWN DAY&apos;S RATE. EQUIPMENT AND LOANS ARE ON THE CASH FLOW, NOT HERE.</div>
      </div>

      <div className="ck-box">
        <div className="section-title">LAST 12 MONTHS</div>
        <div className="rc-wrap">
          <table className="lg-table rc-table mn-year">
            <thead><tr><th>MONTH</th><th>SALES</th><th>COSTS</th><th>PROFIT</th><th className="hide-sm">MARGIN</th><th className="hide-sm" /></tr></thead>
            <tbody>
              {yr.map((y) => (
                <tr key={y.month} tabIndex={0} className={y.month === month ? 'sel' : ''} onClick={() => set({ month: y.month === now ? null : y.month })}>
                  <td>{monthLabel(y.month)}</td>
                  <td>{fmtCrc(y.revenue)}</td>
                  <td>{fmtCrc(y.cost)}</td>
                  <td className={y.profit < 0 ? 'lg-warn-text' : ''}>{fmtCrc(y.profit)}</td>
                  <td className="hide-sm">{y.marginPct === null ? '--' : `${y.marginPct.toFixed(0)}%`}</td>
                  <td className="hide-sm mn-spark-cell">
                    <span className="mn-pair" aria-hidden="true"><i className="in" style={{ width: `${(y.revenue / max) * 100}%` }} /><i className="out" style={{ width: `${(y.cost / max) * 100}%` }} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ck-box">
        <div className="section-title">BREAK-EVEN // {monthLabel(last3[0])} TO {monthLabel(last3[2])} <Guess /></div>
        {be.basis === 'NONE' ? <div className="dim">NO SALES IN THE LAST 3 FULL MONTHS YET. THE WHAT-IF PLANNER SHOWS BREAK-EVEN FROM THE PLAN.</div> : (
          <>
            <div className="lg-big">
              <div><span>FIXED COSTS / MONTH</span><b>{fmtCrc(be.fixed)}</b></div>
              <div><span>PRICE / KG</span><b>{be.pricePerKg === null ? '--' : fmtCrc(be.pricePerKg)}</b></div>
              <div><span>VARIABLE COST / KG</span><b>{be.varPerKg === null ? '--' : fmtCrc(be.varPerKg)}</b></div>
              <div><span>BREAK-EVEN KG / MONTH</span><b>{be.kgPerMonth === null ? 'NEVER' : kgF(be.kgPerMonth)}</b></div>
              <div><span>= BLOCKS / WEEK</span><b>{be.blocksPerWeek === null ? '--' : Math.ceil(be.blocksPerWeek)}</b></div>
              <div><span>SOLD / MONTH</span><b>{kgF(be.kg)} KG ({pctF(be.marginOfSafetyPct)})</b></div>
            </div>
            {be.kgPerMonth === null && <div className="lg-warn">EACH KILO COSTS MORE IN SUPPLIES THAN IT SELLS FOR. NO AMOUNT OF CROP BREAKS EVEN AT THESE PRICES.</div>}
            <div className="dim tiny">FIXED = ELECTRICITY, WAGES, REPAIRS, ADMIN. VARIABLE = SUPPLIES, FUEL, CULTURES, TRANSPORT. BLOCKS USE {kgBlock ? `${kgF(kgBlock)} KG A BLOCK` : 'NO YIELD FIGURE YET'}.</div>
          </>
        )}
      </div>
    </div>
  )
}

/** Average fresh kg per block over finished lots, else the plan's Catawba average. */
function avgKgPerBlock(recs: ReturnType<typeof useRecords>['recs']): number | null {
  const done = recs.filter((r) => r.complete && r.kgPerBlock !== null)
  if (done.length >= 3) return done.reduce((t, r) => t + (r.kgPerBlock as number), 0) / done.length
  const split = averageSplit()
  let kg = 0
  let bags = 0
  for (const s of split) {
    const y = YIELD_LB[s.key]
    if (!y) continue
    kg += s.bags * y.lb * LB_KG
    bags += s.bags
  }
  return bags ? kg / bags : null
}

// ---------- 12-month cash flow ----------

function CashChart({ months, floor }: { months: ReturnType<typeof cashFlow>['months']; floor: number }) {
  const W = 360
  const H = 120
  const vals = [...months.map((m) => m.end), floor, 0]
  const hi = Math.max(...vals)
  const lo = Math.min(...vals)
  const span = hi - lo || 1
  const y = (v: number) => 8 + (H - 16) * (1 - (v - lo) / span)
  const xs = (i: number) => 14 + (i * (W - 28)) / Math.max(1, months.length - 1)
  const pts = months.map((m, i) => `${xs(i)},${y(m.end)}`).join(' ')
  return (
    <svg className="lg-chart mn-chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Cash at the end of each month, with the three-month floor">
      <line x1="0" y1={y(0)} x2={W} y2={y(0)} className="ax" />
      {floor > 0 && <line x1="0" y1={y(floor)} x2={W} y2={y(floor)} className="floor" />}
      <polyline points={pts} className="spark" />
      {months.map((m, i) => (
        <g key={m.month}>
          <circle cx={xs(i)} cy={y(m.end)} r={m.end < floor ? 3.5 : 2.5} className={m.end < floor ? 'pt low' : m.basis === 'PLAN' ? 'pt plan' : 'pt'}>
            <title>{`${monthLabel(m.month)}: ₡${Math.round(m.end).toLocaleString('en-US')} (${m.basis})`}</title>
          </circle>
          {i % 2 === 0 && <text x={xs(i)} y={H + 13} textAnchor="middle" className="lb">{monthLabel(m.month).slice(0, 3)}</text>}
        </g>
      ))}
      {floor > 0 && <text x={W - 2} y={y(floor) - 3} textAnchor="end" className="lb">FLOOR</text>}
    </svg>
  )
}

function CashTab({ d, set, say }: { d: MoneyData; set: SetMoney; say: Say }) {
  const [ms, save] = useMoneyEditor()
  const run = (patch: Parameters<typeof save>[0], label: string) => void save(patch, label).then(() => say(label), (e: Error) => say(e.message, true))
  const start = ms.startMonth ?? monthOf(d.today)
  const cf = cashFlow(d.cash, d.bud, start, d.today, ms.openingCash, ms.floorMonths)
  const [open, setOpen] = useState<string | null>(null)
  const [opening, setOpening] = useState(String(ms.openingCash || ''))
  const noBudget = cf.months.filter((m) => m.basis === 'PLAN' && m.cashIn === 0 && m.cashOut === 0).length
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">12-MONTH CASH FLOW // {monthLabel(start)} TO {monthLabel(addMonths(start, 11))}</div>
        <div className="lg-big">
          <div><span>CASH AT START</span><b>{fmtCrc(cf.opening)}</b></div>
          <div><span>FLOOR ({ms.floorMonths} MONTHS)</span><b>{fmtCrc(cf.floor)}</b></div>
          <div><span>LOWEST</span><b className={cf.low && cf.low.end < cf.floor ? 'lg-warn-text' : ''}>{cf.low ? `${fmtCrc(cf.low.end)} ${monthLabel(cf.low.month)}` : '--'}</b></div>
          <div><span>END OF YEAR</span><b>{fmtCrc(cf.months[cf.months.length - 1]?.end ?? 0)}</b></div>
        </div>
        <CashChart months={cf.months} floor={cf.floor} />
        {cf.below.length > 0 && (
          <div className="lg-warn">
            CASH DIPS BELOW THE FLOOR IN {cf.below.map(monthLabel).join(', ')}. LOOK AT WHO OWES MONEY (MONEY OWED) AND THE WASTE LINE BEFORE ADDING BLOCKS.
          </div>
        )}
        <div className="dim tiny">FLOOR = {ms.floorMonths} MONTHS OF NORMAL SPENDING (NO EQUIPMENT OR LOANS). KEEP CASH ABOVE IT SO A BAD MONTH CANNOT STOP THE FARM.</div>
        {noBudget > 0 && <div className="dim tiny">{noBudget} MONTHS TO COME HAVE NO BUDGET, SO THEY SHOW ₡0. <button type="button" className="ck-link" onClick={() => set({ tab: 'BUDGET' })}>FILL THE BUDGET</button></div>}
        <div className="rc-wrap">
          <table className="lg-table rc-table mn-cash">
            <thead><tr><th>MONTH</th><th>FROM</th><th>IN</th><th>OUT</th><th>NET</th><th>END CASH</th></tr></thead>
            <tbody>
              {cf.months.map((m) => (
                <CashRow key={m.month} m={m} floor={cf.floor} open={open === m.month} onToggle={() => setOpen(open === m.month ? null : m.month)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="dim tiny">FROM: ACTUAL = MONTH OVER, NOW = THIS MONTH SO FAR, PLAN = BUDGET. CASH COUNTS WHEN IT MOVES: A SALE IN THE MONTH IT WAS PAID. TAP A MONTH FOR ITS LINES.</div>
      </div>

      <div className="ck-box">
        <div className="section-title">CASH FLOW SETTINGS</div>
        <div className="ck-fields">
          <label className="ck-field">
            <span>CASH AT THE START OF {monthLabel(start)} (₡)</span>
            <input inputMode="decimal" value={opening} placeholder="0" onChange={(e) => setOpening(e.target.value)} onBlur={() => num(opening) !== ms.openingCash && run({ openingCash: num(opening) ?? 0 }, `CASH AT START SET TO ${fmtCrc(num(opening) ?? 0)}`)} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
          </label>
          <label className="ck-field">
            <span>FIRST MONTH</span>
            <PickInput type="month" value={start} onChange={(e) => e.target.value && run({ startMonth: e.target.value }, `CASH FLOW STARTS ${monthLabel(e.target.value)}`)} />
          </label>
          <label className="ck-field">
            <span>FLOOR = MONTHS OF CASH OUT</span>
            <Select aria-label="Floor months" value={String(ms.floorMonths)} onChange={(e) => run({ floorMonths: Number(e.target.value) }, `FLOOR SET TO ${e.target.value} MONTHS`)}>
              {[0, 1, 2, 3, 4, 6].map((v) => <option key={v} value={String(v)}>{v} MONTHS</option>)}
            </Select>
          </label>
        </div>
        <div className="lg-btns">
          <button type="button" className={`btn ${ms.cargoAsSpend ? 'on' : ''}`} aria-pressed={ms.cargoAsSpend} onClick={() => run({ cargoAsSpend: !ms.cargoAsSpend }, ms.cargoAsSpend ? 'CARGO DELIVERIES NO LONGER COUNT AS SPENT' : 'CARGO DELIVERIES COUNT AS SPENT')}>
            CARGO DELIVERIES = SPENT: {ms.cargoAsSpend ? 'ON' : 'OFF'}
          </button>
          <button type="button" className={`btn ${ms.hoursAsSpend ? 'on' : ''}`} aria-pressed={ms.hoursAsSpend} onClick={() => run({ hoursAsSpend: !ms.hoursAsSpend }, ms.hoursAsSpend ? 'LEDGER HOURS NO LONGER COUNT AS WAGES' : 'LEDGER HOURS COUNT AS WAGES')}>
            LEDGER HOURS = WAGES: {ms.hoursAsSpend ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="dim tiny">TURN A SWITCH OFF WHEN YOU TYPE THOSE BILLS ON SPENDING INSTEAD, SO NOTHING COUNTS TWICE. SAVED FOR THE WHOLE FARM, WITH UNDO.</div>
      </div>
    </div>
  )
}

function CashRow({ m, floor, open, onToggle }: { m: ReturnType<typeof cashFlow>['months'][number]; floor: number; open: boolean; onToggle: () => void }) {
  const low = m.end < floor
  return (
    <>
      <tr tabIndex={0} className={`${open ? 'sel' : ''} ${low ? 'od-row over' : ''}`} aria-expanded={open} onClick={onToggle}>
        <td>{monthLabel(m.month)}</td>
        <td>{m.basis}</td>
        <td>{fmtCrc(m.cashIn)}</td>
        <td>{fmtCrc(m.cashOut)}</td>
        <td className={m.net < 0 ? 'lg-warn-text' : ''}>{fmtCrc(m.net)}</td>
        <td>{fmtCrc(m.end)}{low ? ' LOW' : ''}</td>
      </tr>
      {open && (
        <tr className="mn-lines">
          <td colSpan={6}>
            {m.inLines.size + m.outLines.size === 0 ? <span className="dim">NOTHING IN THIS MONTH.</span> : (
              <div className="mn-linegrid">
                {[...m.inLines].map(([l, v]) => <div key={`i${l}`}><span>IN: {lineLabel(l)}</span><b>{fmtCrc(v)}</b></div>)}
                {[...m.outLines].map(([l, v]) => <div key={`o${l}`}><span>OUT: {lineLabel(l)}</span><b>{fmtCrc(v)}</b></div>)}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ---------- budget ----------

function BudgetTab({ d, x, set, say }: { d: MoneyData; x: MoneyState; set: SetMoney; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const ms = d.settings
  const month = x.month ?? monthOf(d.today)
  const start = ms.startMonth ?? monthOf(d.today)
  const rt = useRates()
  const plan = usePlan()
  const r = useRecords()
  const finished = useMemo(() => r.recs.filter((x) => x.complete), [r.recs])
  const sell = 100 - ms.wasteLinePct
  const pw = planWeekSales(averageSplit(plan), (k) => figuresFor(k, finished).kgPerBlock, (k) => salePrice(k, 'fresh', rt).price, sell)
  const seed = { sales_fresh: pw.crc * WEEKS_PER_MONTH, electricity: estimateMid(rt) }
  return (
    <div className="lg-stack">
      <MonthBar month={month} today={d.today} set={set} label="BUDGET" />
      <div className="ck-box">
        <div className="section-title">START FROM THE PLAN <Guess /></div>
        <div className="dim tiny">
          THE 130-BAG PLAN AT {sell}% SOLD (THE {ms.wasteLinePct}% WASTE LINE) AND TODAY&apos;S PRICES IS ABOUT {kgF(pw.kg)} KG AND {fmtCrc(pw.crc)} A WEEK, {fmtCrc(seed.sales_fresh)} A MONTH. ELECTRICITY: THE MIDDLE OF THE PACKAGE ESTIMATE, {fmtCrc(seed.electricity)} A MONTH.
        </div>
        <Confirm label={`PUT THESE IN ALL 12 MONTHS FROM ${monthLabel(start)}`} onYes={() => void run('BUDGET FILLED FROM THE PLAN', async () => { await seedBudget(store, start, 12, seed) })} />
      </div>
      <div className="ck-box">
        <div className="section-title">{monthLabel(month)} BUDGET // TYPE, THEN ENTER OR LEAVE THE BOX</div>
        <div className="mn-budget">
          {LINES.map((l) => (
            <BudgetField key={`${month}:${l.id}`} month={month} line={l.id} label={`${l.kind === 'in' ? 'IN' : 'OUT'}: ${l.label}`} value={bookGet(d.bud, month, l.id)} actual={bookGet(l.pnl ? d.pnl : d.cash, month, l.id)} start={start} run={run} />
          ))}
        </div>
        <div className="lg-big">
          <div><span>BUDGET IN</span><b>{fmtCrc(bookMonth(d.bud, month, 'in'))}</b></div>
          <div><span>BUDGET OUT</span><b>{fmtCrc(bookMonth(d.bud, month, 'out'))}</b></div>
          <div><span>BUDGET NET</span><b>{fmtCrc(bookMonth(d.bud, month, 'in') - bookMonth(d.bud, month, 'out'))}</b></div>
        </div>
      </div>
    </div>
  )
}

function BudgetField({ month, line, label, value, actual, start, run }: { month: string; line: string; label: string; value: number; actual: number; start: string; run: ReturnType<typeof useRun> }) {
  const store = useStore()
  const [v, setV] = useState(value ? String(Math.round(value)) : '')
  const commit = () => {
    const nv = num(v)
    if ((nv ?? 0) === value) return
    void run(`BUDGET ${monthLabel(month)} ${lineLabel(line)} ${fmtCrc(nv ?? 0)}`, async () => { await setBudget(store, month, line, nv) })
  }
  return (
    <label className="ck-field mn-bfield">
      <span>{label}</span>
      <span className="mn-brow">
        <input inputMode="decimal" value={v} placeholder="0" aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
        <button type="button" className="btn" title="The same figure in all 12 cash-flow months" onClick={() => void run(`BUDGET ${lineLabel(line)} ${fmtCrc(num(v) ?? 0)} FOR 12 MONTHS`, async () => { await fillBudget(store, start, 12, line, num(v)) })}>ALL 12</button>
      </span>
      <em>ACTUAL {fmtCrc(actual)}</em>
    </label>
  )
}

// ---------- sales trends ----------

export function Sparkline({ t, label }: { t: Pick<Trend, 'crc' | 'line'>; label: string }) {
  const W = 120
  const H = 30
  const max = Math.max(1, ...t.crc, t.line[0], t.line[1])
  const k = t.crc.length
  const x = (i: number) => 2 + (i * (W - 4)) / Math.max(1, k - 1)
  const y = (v: number) => H - 3 - ((H - 6) * Math.max(0, v)) / max
  const pts = t.crc.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="mn-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line x1="0" y1={H - 3} x2={W} y2={H - 3} className="ax" />
      <line x1={x(0)} y1={y(t.line[0])} x2={x(k - 1)} y2={y(t.line[1])} className="trend" />
      <polyline points={pts} className="spark" />
      <circle cx={x(k - 1)} cy={y(t.crc[k - 1] ?? 0)} r="2.2" className="pt" />
    </svg>
  )
}

function TrendsTab({ d, x, set }: { d: MoneyData; x: MoneyState; set: SetMoney }) {
  const list = useMemo(() => trends(d.sales, x.trendBy, d.today, 12), [d.sales, x.trendBy, d.today])
  const total = useMemo(() => totalTrend(d.sales, d.today, 12), [d.sales, d.today])
  const gaps = useMemo(() => buyerGaps(d.sales, d.today), [d.sales, d.today])
  const lost = gaps.filter((g) => g.state !== 'ACTIVE')
  const name = (k: string) => (x.trendBy === 'species' ? sp(k) : x.trendBy === 'channel' ? chLabel(k) : k.toUpperCase())
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">ALL SALES // LAST 12 WEEKS</div>
        <div className="mn-trend-total">
          <Sparkline t={total} label="All sales, colones per week, last 12 weeks, with a straight trend line" />
          <div className="lg-big">
            <div><span>12 WEEKS</span><b>{fmtCrc(total.total)}</b></div>
            <div><span>THIS WEEK</span><b>{fmtCrc(total.crc[11] ?? 0)}</b></div>
            <div><span>VS LAST WEEK</span><b>{pctF(total.wow)}</b></div>
            <div><span>4 WEEKS VS 4 BEFORE</span><b>{pctF(total.fourOnFour)}</b></div>
            <div><span>TREND / WEEK</span><b>{pctF(total.slopePct)}</b></div>
          </div>
        </div>
      </div>
      <div className="ck-box">
        <div className="section-title">WEEK ON WEEK BY</div>
        <Buttons label="Group trends by" value={x.trendBy} options={[{ id: 'species', label: 'SPECIES' }, { id: 'channel', label: 'CHANNEL' }, { id: 'buyer', label: 'BUYER' }]} onPick={(v) => set({ trendBy: v })} />
        {list.length === 0 ? <div className="dim">NO SALES IN THE LAST 12 WEEKS.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table mn-trends">
              <thead><tr><th>{x.trendBy.toUpperCase()}</th><th>12 WEEKS</th><th>LINE</th><th>THIS WK</th><th>VS LAST</th><th className="hide-sm">4 VS 4</th><th className="hide-sm">TREND</th></tr></thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.key}>
                    <td>{name(t.key)}</td>
                    <td>{fmtCrc(t.total)}</td>
                    <td className="mn-spark-cell"><Sparkline t={t} label={`${name(t.key)}: colones per week`} /></td>
                    <td>{fmtCrc(t.crc[11])}</td>
                    <td className={t.wow !== null && t.wow < 0 ? 'mn-down' : ''}>{pctF(t.wow)}</td>
                    <td className="hide-sm">{pctF(t.fourOnFour)}</td>
                    <td className="hide-sm">{pctF(t.slopePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dim tiny">SOLID LINE = ₡ EACH WEEK. DASHED = THE STRAIGHT TREND THROUGH THEM. TREND = HOW MUCH A WEEK GROWS OR SHRINKS, AS % OF AN AVERAGE WEEK.</div>
      </div>
      <div className="ck-box">
        <div className="section-title">BUYERS WHO STOPPED ORDERING <Guess /></div>
        {lost.length === 0 ? <div className="dim">{gaps.length ? 'EVERY REGULAR BUYER HAS ORDERED ON TIME.' : 'NO BUYER HAS 2 SALES YET.'}</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>BUYER</th><th>STATE</th><th>LAST</th><th>DAYS SINCE</th><th className="hide-sm">USUAL GAP</th><th>₡ / WEEK</th></tr></thead>
              <tbody>
                {lost.map((g) => (
                  <tr key={g.buyer} className={g.state === 'STOPPED' ? 'od-row over' : 'od-row near'}>
                    <td>{g.buyer.toUpperCase()}</td>
                    <td>{g.state}</td>
                    <td>{g.last}</td>
                    <td>{g.sinceLast}</td>
                    <td className="hide-sm">{g.usualGap === null ? '--' : `${Math.round(g.usualGap)} D`}</td>
                    <td>{fmtCrc(g.perWeek)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dim tiny">A BUYER WHO HAS STOPPED IS INCOME YOU CAN STILL WIN BACK. ₡ / WEEK = WHAT THEY SPENT A WEEK WHILE BUYING.</div>
      </div>
    </div>
  )
}

// ---------- waste ----------

function WasteTab({ d, say }: { d: MoneyData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const rt = useRates()
  const [day, setDay] = useState(d.today)
  const [species, setSpecies] = useState('blue-oyster')
  const [kg, setKg] = useState('')
  const [route, setRoute] = useState<WasteRoute>('unsold')
  const [lots, setLots] = useState('')
  const [notes, setNotes] = useState('')
  const line = d.settings.wasteLinePct
  const weeks = useMemo(() => wasteWeeks(d.sales, d.waste, d.today, 8, line), [d.sales, d.waste, d.today, line])
  const list = useMemo(() => [...d.waste].sort((a, b) => b.logged_on.localeCompare(a.logged_on) || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [d.waste])
  const recent = weeks.slice(-4)
  const sold = recent.reduce((t, w) => t + w.soldKg, 0)
  const surplus = recent.reduce((t, w) => t + w.surplusKg, 0)
  const share = sold + surplus > 0 ? (surplus / (sold + surplus)) * 100 : null
  const lostValue = d.waste.filter((w) => w.logged_on >= recent[0].week && (w.route === 'unsold' || w.route === 'compost')).reduce((t, w) => t + Number(w.kg) * (salePrice(w.species_key, 'fresh', rt).price ?? 0), 0)
  const save = () =>
    void run(`WASTE LOGGED ${num(kg) ?? 0} KG ${sp(species)} // ${WASTE_ROUTES.find((r) => r.id === route)?.label}`, async () => {
      await addWaste(store, { day, species, kg: num(kg), route, lots: parseLots(lots), notes })
    }).then((ok) => ok && (setKg(''), setLots(''), setNotes('')))
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">LOG SURPLUS: WHAT DID NOT SELL FRESH</div>
        <div className="ck-fields">
          <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="ck-field">
            <span>SPECIES</span>
            <Select aria-label="Species" value={species} onChange={(e) => setSpecies(e.target.value)}>
              {SALE_SPECIES.map((s) => <option key={s} value={s}>{sp(s)}</option>)}
            </Select>
          </label>
        </div>
        <div className="ck-field"><span>WHERE IT WENT</span><Buttons label="Where it went" value={route} options={WASTE_ROUTES} onPick={setRoute} /></div>
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>FRESH KG</span><input inputMode="decimal" value={kg} placeholder="0.0" onChange={(e) => setKg(e.target.value)} /></label>
          <label className="ck-field"><span>LOT CODES (OPTIONAL)</span><input value={lots} placeholder="B1020" onChange={(e) => setLots(e.target.value)} /></label>
        </div>
        <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button type="button" className="btn on lg-save" onClick={save}>SAVE</button>
        <div className="dim tiny">ORDER TO TRY: SELL FRESH, THEN DRY, THEN DONATE (ASK FOR A RECEIPT), COMPOST LAST. NEVER SELL CHEAP TO DUMP SURPLUS.</div>
      </div>
      <div className="ck-box">
        <div className="section-title">SURPLUS AGAINST THE {line}% WASTE LINE <Guess /></div>
        <div className="lg-big">
          <div><span>LAST 4 WEEKS SURPLUS</span><b className={share !== null && share > line ? 'lg-warn-text' : ''}>{share === null ? '--' : `${share.toFixed(0)}%`}</b></div>
          <div><span>FRESH SOLD</span><b>{kgF(sold)} KG</b></div>
          <div><span>SURPLUS</span><b>{kgF(surplus)} KG</b></div>
          <div><span>THROWN OUT, AT LIST PRICE</span><b>{fmtCrc(lostValue)}</b></div>
        </div>
        {share !== null && share > line && <div className="lg-warn">MORE THAN {line}% OF THE CROP DID NOT SELL FRESH. FIND BUYERS OR GROW LESS UNTIL SALES CATCH UP.</div>}
        <div className="rc-wrap">
          <table className="lg-table rc-table mn-waste">
            <thead><tr><th>WEEK</th><th>SOLD KG</th><th>UNSOLD</th><th>DRIED</th><th>DONATED</th><th>COMPOST</th><th>SURPLUS</th></tr></thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} className={w.over ? 'od-row over' : ''}>
                  <td>{w.week.slice(5)}</td>
                  <td>{kgF(w.soldKg)}</td>
                  <td>{kgF(w.byRoute.unsold)}</td>
                  <td>{kgF(w.byRoute.dried)}</td>
                  <td>{kgF(w.byRoute.donated)}</td>
                  <td>{kgF(w.byRoute.compost)}</td>
                  <td>{w.surplusPct === null ? '--' : `${w.surplusPct.toFixed(0)}%${w.over ? ' OVER' : ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dim tiny">SURPLUS = KG LOGGED HERE / (FRESH KG SOLD + KG LOGGED HERE). WEEKS START MONDAY. REPLACE THE {line}% LINE WITH YOUR REAL NUMBER AFTER A FEW MONTHS.</div>
      </div>
      <div className="ck-box">
        <div className="section-title">WASTE ENTRIES // {list.length}</div>
        {list.length === 0 ? <div className="dim">NOTHING LOGGED YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>SPECIES</th><th>KG</th><th>WENT</th><th className="hide-sm">LOTS</th><th /></tr></thead>
              <tbody>{list.slice(0, 60).map((w) => <WasteRow key={w.id} w={w} say={say} />)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function WasteRow({ w, say }: { w: WasteEntry; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  return (
    <tr>
      <td>{w.logged_on}</td>
      <td>{sp(w.species_key)}</td>
      <td>{Number(w.kg).toFixed(2)}</td>
      <td>{WASTE_ROUTES.find((r) => r.id === w.route)?.label.split(' ')[0] ?? w.route}</td>
      <td className="hide-sm">{(w.lot_codes ?? []).join(' ') || '--'}</td>
      <td className="mn-act">
        <HistoryButton table="waste_log" id={w.id} />
        <Confirm label="DELETE" onYes={() => void run('WASTE ENTRY DELETED', async () => { await deleteWaste(store, [w.id]) })} />
      </td>
    </tr>
  )
}

// ---------- trace and recall ----------

function useTraceDb(): TraceDb {
  const r = useRecords()
  const grains = useTable<GrainRun>('grain_runs')
  const cultures = useTable<Culture>('cultures')
  const losses = useTable<LotLoss>('lot_losses')
  return useMemo(
    () => ({ lots: r.lots as BlockLot[], cooks: r.cooks as CookRun[], grains, cultures, strains: r.strains as Strain[], harvests: r.harvests, losses }),
    [r.lots, r.cooks, grains, cultures, r.strains, r.harvests, losses],
  )
}

function Step({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="mn-step">
      <span className="mn-k">{k}</span>
      <span className="mn-v">{children}</span>
    </div>
  )
}

function TraceTab({ d, x, set, say }: { d: MoneyData; x: MoneyState; set: SetMoney; say: Say }) {
  const db = useTraceDb()
  const [code, setCode] = useState(x.code)
  const sale = d.sales.find((s) => s.id === x.sale) ?? null
  const codes = x.code ? parseLots(x.code) : sale?.lot_codes ?? []
  const lots = codes.flatMap((c) => db.lots.filter((l) => l.lot_code.toUpperCase() === c.toUpperCase()))
  const missing = codes.filter((c) => !db.lots.some((l) => l.lot_code.toUpperCase() === c.toUpperCase()))
  const traced = lots.map((l) => traceLot(l, db))
  const withLots = useMemo(() => [...d.sales].filter((s) => s.lot_codes?.length).sort((a, b) => b.sold_on.localeCompare(a.sold_on)).slice(0, 20), [d.sales])
  const rec = x.recall ? recallList(d.sales, recallLots(x.recall.by, x.recall.id, db)) : null
  const recText = rec && x.recall ? recallText(x.recall.title, rec, sp) : ''
  const go = () => set({ code: code.trim().toUpperCase(), sale: null, recall: null })
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">TRACE A LOT // SALE TO LOT TO COOK TO STRAIN TO ROOM</div>
        <div className="ck-fields">
          <label className="ck-field">
            <span>LOT CODE (BATCH OF BLOCKS)</span>
            <input value={code} placeholder="CODE ON THE BAG, E.G. B1020" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          </label>
        </div>
        <div className="lg-btns"><button type="button" className="btn on" onClick={go}>TRACE</button></div>
        {withLots.length > 0 && (
          <>
            <div className="dim tiny">OR TAP A RECENT SALE:</div>
            <div className="rc-wrap">
              <table className="lg-table rc-table">
                <thead><tr><th>DAY</th><th>BUYER</th><th>PRODUCT</th><th>LOTS</th></tr></thead>
                <tbody>
                  {withLots.map((s) => (
                    <tr key={s.id} tabIndex={0} className={s.id === x.sale && !x.code ? 'sel' : ''} onClick={() => (setCode(''), set({ sale: s.id, code: '', recall: null }))}>
                      <td>{s.sold_on}</td><td>{(s.buyer ?? '--').toUpperCase()}</td><td>{sp(s.species_key ?? 'unknown')}</td><td>{(s.lot_codes ?? []).join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {(codes.length > 0) && (
        <div className="ck-box">
          <div className="section-title">CHAIN{sale && !x.code ? ` // SALE ${sale.sold_on} ${(sale.buyer ?? '').toUpperCase()}` : ''}</div>
          {missing.length > 0 && <div className="lg-warn">NO LOT LOGGED WITH CODE {missing.join(', ')}. CHECK THE CODE ON THE BAG.</div>}
          {traced.map((t) => (
            <div key={t.lot.id} className="mn-chain">
              <Step k="LOT">{t.lot.lot_code} // {sp(t.lot.species_key)} // {t.lot.bag_count} BLOCKS // KNOCKED {t.lot.knock_date} // {t.lot.status.toUpperCase()}</Step>
              <Step k="ROOM">{t.room ? t.room.toUpperCase() : 'NOT RECORDED'}{t.lot.cart ? ` // CART ${t.lot.cart}` : ''}{t.lot.knocked_by ? ` // KNOCKED BY ${t.lot.knocked_by}` : ''}</Step>
              <Step k="COOK">{t.cook ? `${(t.cook.unit_label ?? t.cook.kind).toUpperCase()} // ${(t.cook.started_at ?? '').slice(0, 10) || 'NO START'} // ${t.cook.result.toUpperCase()}${t.cook.max_temp_f ? ` // MAX ${t.cook.max_temp_f}°F` : ''}` : 'NOT LINKED'}</Step>
              <Step k="SPAWN">{t.grain ? `${t.grain.generation} ${t.grain.label ?? ''} // ${t.grain.inoculated_on} // ${t.grain.status.toUpperCase()}` : 'NOT LINKED'}</Step>
              {t.master && <Step k="MASTER">{`G1 ${t.master.label ?? ''} // ${t.master.inoculated_on}`}</Step>}
              <Step k="CULTURE">{t.culture ? `${t.culture.label ?? t.culture.kind.toUpperCase()} // P${t.culture.p_level ?? '?'} // ${t.culture.made_on}` : 'NOT LINKED'}</Step>
              <Step k="STRAIN">{t.strain ? `${t.strain.code}${t.strain.name ? ` ${t.strain.name.toUpperCase()}` : ''}` : 'NOT LINKED'}</Step>
              <Step k="PICKED">{t.harvests.length ? t.harvests.map((h) => `${h.day} F${h.flush} ${h.kg.toFixed(2)} KG`).join(' // ') : 'NO HARVEST LOGGED'}{t.losses ? ` // ${t.losses} BLOCKS LOST` : ''}</Step>
              <div className="lg-btns">
                <button type="button" className="btn" onClick={() => set({ recall: { by: 'lot', id: t.lot.lot_code, title: `LOT ${t.lot.lot_code}` } })}>RECALL THIS LOT</button>
                {t.cook && <button type="button" className="btn" onClick={() => set({ recall: { by: 'cook', id: t.cook!.id, title: `COOK RUN ${(t.cook!.unit_label ?? t.cook!.kind).toUpperCase()} ${(t.cook!.started_at ?? '').slice(0, 10)}` } })}>RECALL WHOLE COOK RUN</button>}
                {t.grain && <button type="button" className="btn" onClick={() => set({ recall: { by: 'grain', id: (t.master ?? t.grain)!.id, title: `SPAWN ${(t.master ?? t.grain)!.label ?? (t.master ?? t.grain)!.inoculated_on}` } })}>RECALL ALL FROM THIS {t.master ? 'MASTER' : 'SPAWN'}</button>}
                {t.strain && <button type="button" className="btn" onClick={() => set({ recall: { by: 'strain', id: t.strain!.id, title: `STRAIN ${t.strain!.code}` } })}>RECALL WHOLE STRAIN</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {rec && x.recall && (
        <div className="ck-box">
          <div className="section-title">RECALL LIST // {x.recall.title}</div>
          <div className="lg-big">
            <div><span>LOTS</span><b>{rec.codes.length}</b></div>
            <div><span>BUYERS</span><b>{rec.rows.length}</b></div>
            <div><span>SALES</span><b>{rec.sales.length}</b></div>
            <div><span>KG SOLD</span><b>{kgF(rec.rows.reduce((t, r) => t + r.kg, 0))}</b></div>
          </div>
          {rec.rows.length === 0 ? <div className="dim">NO SALE NAMES THESE LOTS. NOTHING WENT OUT (OR THE LOTS WERE NOT TYPED ON THE SALES).</div> : (
            <div className="rc-wrap">
              <table className="lg-table rc-table">
                <thead><tr><th>BUYER</th><th>SALES</th><th>KG</th><th>FIRST</th><th>LAST</th></tr></thead>
                <tbody>{rec.rows.map((r) => <tr key={r.buyer}><td>{r.buyer.toUpperCase()}</td><td>{r.sales.length}</td><td>{kgF(r.kg)}</td><td>{r.first}</td><td>{r.last}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <textarea className="od-text" readOnly value={recText} rows={14} aria-label="Recall list text" />
          <button type="button" className="btn" onClick={() => void copyText(recText).then((ok) => say(ok ? 'RECALL LIST COPIED.' : 'COPY FAILED. SELECT THE TEXT AND COPY IT.', !ok))}>COPY RECALL LIST</button>
        </div>
      )}
    </div>
  )
}

// ---------- what-if planner ----------

function WhatIfTab({ d }: { d: MoneyData }) {
  const rt = useRates()
  const plan = usePlan()
  const r = useRecords()
  const led = useLedger()
  const finished = useMemo(() => r.recs.filter((x) => x.complete), [r.recs])
  const base = averageSplit(plan)
  const planBags = base.reduce((t, s) => t + s.bags, 0)
  const parts = led.plan.all.parts
  const planPerBlock = led.plan.all.blocks > 0 ? (parts.consumables.crc + parts.labour.crc + parts.wear.crc) / led.plan.all.blocks : 0
  const [bags, setBags] = useState(String(planBags))
  const [sellPct, setSellPct] = useState(String(100 - d.settings.wasteLinePct))
  const [cpb, setCpb] = useState('')
  const [fixed, setFixed] = useState('')
  const [varPct, setVarPct] = useState('60')
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(base.map((s) => [s.key, String(Math.round((s.bags / planBags) * 1000) / 10)])))
  const [prices, setPrices] = useState<Record<string, string>>({})
  const keys = Object.keys(shares)
  const out = whatIf({
    bagsPerWeek: num(bags) ?? 0,
    sellPct: num(sellPct) ?? 0,
    costPerBlock: num(cpb) ?? planPerBlock,
    powerAtPlan: estimateMid(rt),
    planBags,
    powerVariablePct: num(varPct) ?? 60,
    fixedPerMonth: num(fixed) ?? 0,
    species: keys.map((k) => ({ key: k, sharePct: num(shares[k]) ?? 0, kgPerBlock: figuresFor(k, finished).kgPerBlock, pricePerKg: num(prices[k] ?? '') ?? salePrice(k, 'fresh', rt).price })),
  })
  const fx = d.fx.today.rate
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">WHAT IF // CHANGE A NUMBER, THE RESULT UPDATES</div>
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>BAGS A WEEK</span><input inputMode="numeric" value={bags} onChange={(e) => setBags(e.target.value)} /></label>
          <label className="ck-field"><span>% OF CROP SOLD <Guess /></span><input inputMode="decimal" value={sellPct} onChange={(e) => setSellPct(e.target.value)} /><em>{d.settings.wasteLinePct}% WASTE LINE = {100 - d.settings.wasteLinePct}%</em></label>
          <label className="ck-field"><span>SUPPLIES ₡ A BLOCK</span><input inputMode="decimal" value={cpb} placeholder={String(Math.round(planPerBlock))} onChange={(e) => setCpb(e.target.value)} /><em>{cpb ? 'YOUR FIGURE' : `LEDGER PLAN WEEK ${fmtCrc(planPerBlock)}`}{parts.consumables.basis === 'NONE' ? ' (CARGO HAS NO PRICES, SO TOO LOW)' : ''}</em></label>
          <label className="ck-field"><span>OTHER FIXED ₡ A MONTH</span><input inputMode="decimal" value={fixed} placeholder="0" onChange={(e) => setFixed(e.target.value)} /><em>ACCOUNTANT, PERMITS, WAGES NOT PER BLOCK</em></label>
          <label className="ck-field"><span>POWER THAT GROWS WITH BAGS % <Guess /></span><input inputMode="decimal" value={varPct} onChange={(e) => setVarPct(e.target.value)} /><em>BILL AT {planBags} BAGS {fmtCrc(estimateMid(rt))}</em></label>
        </div>
        <div className="rc-wrap">
          <table className="lg-table rc-table mn-whatif">
            <thead><tr><th>SPECIES</th><th>MIX %</th><th>BAGS</th><th>KG/BLOCK</th><th>₡/KG</th><th>KG</th><th>SALES</th></tr></thead>
            <tbody>
              {out.rows.map((row) => {
                const f = figuresFor(row.key, finished)
                const def = salePrice(row.key, 'fresh', rt).price
                return (
                  <tr key={row.key}>
                    <td>{sp(row.key)}</td>
                    <td><input className="mn-cell" inputMode="decimal" aria-label={`${sp(row.key)} mix percent`} value={shares[row.key]} onChange={(e) => setShares({ ...shares, [row.key]: e.target.value })} /></td>
                    <td>{row.bags}</td>
                    <td>{f.kgPerBlock === null ? 'NONE' : `${f.kgPerBlock.toFixed(2)} ${f.src === 'OWN' ? 'OWN' : 'CAT'}`}</td>
                    <td><input className="mn-cell" inputMode="decimal" aria-label={`${sp(row.key)} price per kg`} value={prices[row.key] ?? ''} placeholder={def ? String(def) : 'TYPE'} onChange={(e) => setPrices({ ...prices, [row.key]: e.target.value })} /></td>
                    <td>{kgF(row.kg)}</td>
                    <td>{fmtCrc(row.sales)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {Math.abs(out.sharesPct - 100) > 0.5 && <div className="dim tiny">THE MIX ADDS TO {out.sharesPct.toFixed(1)}%. IT IS SCALED TO 100%.</div>}
      </div>
      <div className="ck-box">
        <div className="section-title">RESULT // A WEEK AND A MONTH</div>
        <div className="lg-big">
          <div><span>CROP / WEEK</span><b>{kgF(out.kgWeek)} KG</b></div>
          <div><span>SOLD / WEEK</span><b>{kgF(out.soldKgWeek)} KG</b></div>
          <div><span>SALES / MONTH</span><Amt crc={out.salesMonth} usd={out.salesMonth / fx} /></div>
          <div><span>SUPPLIES / MONTH</span><b>{fmtCrc(out.suppliesWeek * WEEKS_PER_MONTH)}</b></div>
          <div><span>POWER / MONTH</span><b>{fmtCrc(out.powerMonth)}</b></div>
          <div><span>ALL COSTS / MONTH</span><b>{fmtCrc(out.costMonth)}</b></div>
          <div><span>PROFIT / MONTH</span><b className={out.profitMonth < 0 ? 'lg-warn-text' : ''}>{fmtCrc(out.profitMonth)}</b></div>
          <div><span>BREAK-EVEN</span><b>{out.breakEvenBags === null ? 'NEVER' : `${Math.ceil(out.breakEvenBags)} BAGS/WK`}</b></div>
        </div>
        {out.breakEvenBags === null && <div className="lg-warn">AT THIS MIX AND THESE PRICES EACH BAG COSTS MORE THAN IT SELLS FOR.</div>}
        <div className="dim tiny">US$ AT TODAY&apos;S RATE ₡{fx} (A PLAN, NOT A RECORD). NOTHING HERE IS SAVED.</div>
      </div>
    </div>
  )
}

export type { Book, Sale }
