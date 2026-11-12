import { Select } from '../components/Select'
import { useStationTabs } from '../nav/StationContext'
import { PickInput } from '../components/PickInput'
import { useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore, useTable } from '../store/StoreContext'
import { speciesName, useLedger } from '../store/useLedger'
import { CHANNELS, FORMS, GRADES, SALE_SPECIES, TRADE_GUESSES, formAfterPick, type Channel, type Form } from '../data/ledger'
import { addDays, costPerKg, weekOf, type Basis } from '../lib/ledger'
import { between, buyers, byChannel, byProduct, lastSaleTo, lotLooksRight, margin, newSale, parseLots, usdOf, weekly, type Rate, type Sale, type Total } from '../lib/trade'

/** The ₡ per US$ that turns `crc` into `usd`, for showing an already-converted total. */
const eff = (crc: number, usd: number, fallback: number) => (crc > 0 && usd > 0 ? crc / usd : fallback)
import { fmtCrc, fmtUsd, today } from '../lib/cargo'
import { Confirm, Guess } from './CookParts'
import { Money, Tag } from './Ledger'
import { salePrice } from '../lib/rates'
import { useFx, useFxSync } from '../store/useFx'
import { useRates } from '../store/useRates'
import { holdFor, nextReceiptNo, owed, PAYMENT_RULE, payStatus, paidDay } from '../lib/money'
import { todayIso } from '../lib/xeno'

// TRADE: sales. Quick entry on a phone, totals and charts by channel and product, margin against LEDGER.

export type TradeTab = 'SALE' | 'TOTALS' | 'BUYERS' | 'LOG' | 'GUESSES'
export const TRADE_TABS: TradeTab[] = ['SALE', 'TOTALS', 'BUYERS', 'LOG', 'GUESSES']
const TAB_LABEL: Record<TradeTab, string> = { SALE: 'NEW SALE', TOTALS: 'TOTALS + MARGIN', BUYERS: 'BUYERS', LOG: 'SALES LOG', GUESSES: 'GUESSES' }
export interface TradeState {
  tab: TradeTab
}
export const TRADE_START: TradeState = { tab: 'SALE' }
type SetTrade = (p: Partial<TradeState>) => void
type Say = (t: string, warn?: boolean) => void

const chLabel = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c.toUpperCase()
const productLabel = (k: string) => {
  const [sp, form] = k.split('|')
  return `${speciesName(sp)} ${form.toUpperCase()}`
}
const num = (s: string): number | null => {
  const n = Number(s.replace(/[₡,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}

function useSales() {
  const raw = useTable<Sale>('sales')
  return useMemo(() => [...raw].sort((a, b) => (b.sold_on === a.sold_on ? (b.created_at ?? '').localeCompare(a.created_at ?? '') : b.sold_on.localeCompare(a.sold_on))), [raw])
}

export function TradeIndex({ x, set }: { x: TradeState; set: SetTrade }) {
  const { sound } = useApp()
  const sales = useSales()
  const wk = between(sales, weekOf(today()), null)
  const tabs = useStationTabs(TRADE_TABS)
  return (
    <>
      {tabs.length > 1 && <div className="section-title">TRADE</div>}
      {tabs.length > 1 && <ul className="index-list">
        {tabs.map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{TAB_LABEL[t]}</span>
            {t === 'LOG' && <span className="k">{sales.length}</span>}
          </li>
        ))}
      </ul>}
      <div className="section-title" style={{ marginTop: 10 }}>THIS WEEK</div>
      <div className="lg-mini">
        <div>{wk.length} SALES</div>
        <div>{wk.reduce((n, s) => n + Number(s.kg), 0).toFixed(1)} KG</div>
        <div>{fmtCrc(wk.reduce((n, s) => n + Number(s.amount_crc), 0))}</div>
      </div>
    </>
  )
}

export function Trade({ x, set, say, onOpenLedger, onOpenPrices, onOpenOrders }: { x: TradeState; set: SetTrade; say: Say; onOpenLedger: () => void; onOpenPrices: () => void; onOpenOrders?: () => void }) {
  const { sound } = useApp()
  const sales = useSales()
  const d = useLedger()
  const cost = (k: string) => costPerKg(d.ledger, k, d.plan)
  const fxd = useFx()
  useFxSync(sales.map((s) => s.sold_on))
  const tabs = useStationTabs(TRADE_TABS)
  return (
    <div className="cook ledger">
      {tabs.length > 1 && <label className="ck-picker">
        <span>SHOW</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as TradeTab }))}>
          {tabs.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
        </Select>
      </label>}
      {x.tab === 'SALE' && <SaleForm sales={sales} fx={fxd.today.rate} rate={fxd.rate} say={say} cost={cost} lotCodes={d.lots.map((l) => l.lot_code)} onOpenPrices={onOpenPrices} />}
      {x.tab === 'TOTALS' && <Totals sales={sales} fx={fxd.today.rate} rate={fxd.rate} cost={cost} noPrices={d.plan.all.parts.consumables.basis === 'NONE'} onOpenLedger={onOpenLedger} />}
      {x.tab === 'BUYERS' && <Buyers sales={sales} fx={fxd.today.rate} rate={fxd.rate} onOpenOrders={onOpenOrders} />}
      {x.tab === 'LOG' && <Log sales={sales} rate={fxd.rate} say={say} />}
      {x.tab === 'GUESSES' && (
        <div className="ck-box">
          <div className="section-title">BEST GUESSES WAITING FOR JOSEPH <Guess /></div>
          <ul className="ck-guesses">{TRADE_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

// ---------- the phone sale form ----------

function Buttons<T extends string>({ value, options, onPick }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  const { sound } = useApp()
  return (
    <div className="lg-btns">
      {options.map((o) => (
        <button key={o.id} type="button" className={`btn ${o.id === value ? 'on' : ''}`} onClick={() => (sound.chirp(), onPick(o.id))}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SaleForm({ sales, rate, say, cost, lotCodes, onOpenPrices }: { sales: Sale[]; fx: number; rate: Rate; say: Say; onOpenPrices: () => void; cost: (k: string) => { perKg: number | null; basis: Basis }; lotCodes: string[] }) {
  const store = useStore()
  const [day, setDay] = useState(today())
  const [buyer, setBuyer] = useState('')
  const [channel, setChannel] = useState<Channel>('market')
  const [sp, setSp] = useState('blue-oyster')
  const [form, setForm] = useState<Form>('fresh')
  const [grade, setGrade] = useState<string>('A')
  const [kg, setKg] = useState('')
  const [price, setPrice] = useState('') // ₡ per kg, blank = default
  const [amount, setAmount] = useState('') // blank = kg x price
  const [lots, setLots] = useState('')
  const [notes, setNotes] = useState('')
  const [unpaid, setUnpaid] = useState(false)
  const rt = useRates()
  const def = salePrice(sp, form, rt)
  const k = num(kg)
  const pr = num(price) ?? def.price
  const auto = k !== null && pr !== null ? Math.round(k * pr) : null
  const amt = num(amount) ?? auto
  const codes = parseLots(lots)
  const known = new Set(lotCodes.map((c) => c.toUpperCase()))
  const odd = codes.filter((c) => !lotLooksRight(c) || (known.size > 0 && !known.has(c)))
  const c = cost(sp)
  const mg = form === 'fresh' && c.perKg !== null && k && amt ? amt - c.perKg * k : null
  const names = useMemo(() => buyers(sales).map((b) => b.name), [sales])
  const ow = useMemo(() => owed(sales, todayIso()), [sales])
  const hold = holdFor(ow, buyer)

  const fillFromBuyer = (name: string) => {
    const last = lastSaleTo(sales, name)
    if (!last) return
    setChannel(last.channel)
    if (last.species_key) setSp(last.species_key)
    setForm(last.form)
    if (last.grade) setGrade(last.grade)
    if (Number(last.kg) > 0 && last.form === 'fresh') setPrice(String(Math.round(Number(last.amount_crc) / Number(last.kg))))
  }

  const save = async () => {
    if (k === null || k <= 0) return say('TYPE THE KG SOLD.', true)
    if (amt === null || amt < 0) return say('TYPE THE ₡ AMOUNT (NO DEFAULT PRICE FOR THIS PRODUCT).', true)
    if (unpaid && !buyer.trim()) return say('TYPE THE BUYER: AN UNPAID SALE NEEDS A NAME TO CHASE.', true)
    const row = newSale({
      sold_on: day,
      buyer: buyer.trim() || null,
      channel,
      species_key: sp,
      form,
      grade,
      kg: k,
      amount_crc: amt,
      lot_codes: codes.length ? codes : null,
      notes: notes.trim() || null,
      pay_status: unpaid ? 'owed' : 'paid',
      paid_on: unpaid ? null : day,
      receipt_no: nextReceiptNo(sales, day),
    })
    try {
      const msg = `SALE SAVED ${row.receipt_no} // ${k} KG ${speciesName(sp)} // ${fmtCrc(amt)}${row.buyer ? ` // ${row.buyer.toUpperCase()}` : ''}${unpaid ? ' // OWED' : ''}`
      await store.action(msg, () => store.put('sales', row))
      say(msg, unpaid)
      setUnpaid(false)
      setKg('')
      setAmount('')
      setLots('')
      setNotes('')
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'SAVE FAILED', true)
    }
  }

  return (
    <div className="lg-stack lg-sale">
      <div className="ck-box">
        <div className="section-title">NEW SALE</div>
        <div className="ck-fields">
          <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="ck-field">
            <span>BUYER</span>
            <input list="tr-buyers" value={buyer} placeholder="NAME (OPTIONAL)" onChange={(e) => setBuyer(e.target.value)} onBlur={(e) => fillFromBuyer(e.target.value)} />
          </label>
        </div>
        {hold && (
          <div className="lg-warn" data-testid="buyer-hold">
            {hold.buyer.toUpperCase()} IS ON HOLD: OWES {fmtCrc(hold.crc)} SINCE {hold.oldest} ({hold.n} SALE{hold.n === 1 ? '' : 'S'}). {PAYMENT_RULE} TAKE THE OLD MONEY BEFORE THIS DELIVERY.
          </div>
        )}
        <datalist id="tr-buyers">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="ck-field"><span>CHANNEL <Guess /></span><Buttons value={channel} options={CHANNELS} onPick={setChannel} /></div>
        <label className="ck-field">
          <span>SPECIES</span>
          <Select value={sp} onChange={(e) => (setForm(formAfterPick(sp, e.target.value, form)), setSp(e.target.value), setPrice(''))}>
            {SALE_SPECIES.map((s) => <option key={s} value={s}>{speciesName(s)}</option>)}
          </Select>
        </label>
        <div className="ck-fields">
          <div className="ck-field"><span>FORM</span><Buttons value={form} options={FORMS} onPick={(f) => (setForm(f), setPrice(''))} /></div>
          <div className="ck-field"><span>GRADE <Guess /></span><Buttons value={grade} options={GRADES.map((g) => ({ id: g as string, label: g }))} onPick={setGrade} /></div>
        </div>
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>KG</span><input inputMode="decimal" value={kg} placeholder="0.0" onChange={(e) => setKg(e.target.value)} /></label>
          <label className="ck-field">
            <span>₡ PER KG</span>
            <input inputMode="decimal" value={price} placeholder={def.price ? String(def.price) : 'TYPE IT'} onChange={(e) => setPrice(e.target.value)} />
            <em>{def.price ? `${def.mine ? 'YOUR PRICE' : 'BUILT-IN'} ${fmtCrc(def.price)}. ` : 'NO PRICE SET. '}<button type="button" className="ck-link" onClick={onOpenPrices}>SET PRICES</button></em>
          </label>
          <label className="ck-field">
            <span>₡ AMOUNT</span>
            <input inputMode="decimal" value={amount} placeholder={auto !== null ? String(auto) : ''} onChange={(e) => setAmount(e.target.value)} />
            {amt !== null && <em>{fmtUsd(amt, rate(day))} AT ₡{rate(day)}{!amount && auto !== null ? ' // KG X PRICE' : ''}</em>}
          </label>
        </div>
        <label className="ck-field">
          <span>LOT CODES (E.G. B1020 L1022) // NEEDED FOR TRACE AND RECALL</span>
          <input list="tr-lots" value={lots} onChange={(e) => setLots(e.target.value)} />
          {odd.length > 0 && <em className="lg-warn-text">NOT A LOGGED LOT: {odd.join(', ')}. SAVED ANYWAY.</em>}
        </label>
        <datalist id="tr-lots">{[...new Set(lotCodes)].slice(-40).map((c) => <option key={c} value={c} />)}</datalist>
        <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {mg !== null && amt && (
          <div className={`lg-check ${mg < 0 ? 'warn' : ''}`}>
            MARGIN {fmtCrc(mg)} ({((mg / amt) * 100).toFixed(0)}%) AT LEDGER COST {fmtCrc(c.perKg as number)}/KG <Tag b={c.basis} />
          </div>
        )}
        <div className="ck-field">
          <span>PAYMENT</span>
          <div className="lg-btns">
            <button type="button" className={`btn ${!unpaid ? 'on' : ''}`} aria-pressed={!unpaid} onClick={() => setUnpaid(false)}>PAID ON DELIVERY</button>
            <button type="button" className={`btn ${unpaid ? 'on' : ''}`} aria-pressed={unpaid} onClick={() => setUnpaid(true)}>NOT PAID YET</button>
          </div>
          {unpaid && <em className="lg-warn-text">BREAKS THE CASH ON DELIVERY RULE. THE SALE SHOWS IN MONEY OWED AND THE BUYER GOES ON HOLD UNTIL PAID.</em>}
        </div>
        <button type="button" className="btn on lg-save" onClick={() => void save()}>SAVE SALE</button>
      </div>
    </div>
  )
}

// ---------- totals and charts ----------

type Period = 'WEEK' | '4WK' | 'MONTH' | 'ALL'
const PERIODS: { id: Period; label: string }[] = [
  { id: 'WEEK', label: 'THIS WEEK' },
  { id: '4WK', label: '4 WEEKS' },
  { id: 'MONTH', label: 'THIS MONTH' },
  { id: 'ALL', label: 'ALL' },
]
function periodFrom(p: Period): string | null {
  const t = today()
  if (p === 'WEEK') return weekOf(t)
  if (p === '4WK') return addDays(weekOf(t), -21)
  if (p === 'MONTH') return `${t.slice(0, 7)}-01`
  return null
}

function Bars({ rows, label, fx }: { rows: Total[]; label: (k: string) => string; fx: number }) {
  // US$ per row is the sum of each sale at its own day's rate.
  const max = Math.max(1, ...rows.map((r) => r.crc))
  if (!rows.length) return <div className="dim">NO SALES IN THIS PERIOD.</div>
  return (
    <div className="lg-hbars">
      {rows.map((r) => (
        <div key={r.key} className="lg-hbar">
          <span className="lg-pl">{label(r.key)}</span>
          <span className="lg-bar"><i style={{ width: `${(r.crc / max) * 100}%` }} /></span>
          <span className="lg-pv">
            {fmtCrc(r.crc)} <small>{fmtUsd(r.crc, eff(r.crc, r.usd, fx))} // {r.kg.toFixed(1)} KG{r.perKg !== null ? ` // ${fmtCrc(r.perKg)}/KG` : ''}</small>
          </span>
        </div>
      ))}
    </div>
  )
}

function WeekChart({ sales }: { sales: Sale[] }) {
  const end = weekOf(today())
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(end, (i - 11) * 7))
  const got = new Map(weekly(sales, weekOf).map((w) => [w.week, w]))
  const data = weeks.map((w) => got.get(w) ?? { week: w, kg: 0, crc: 0 })
  const max = Math.max(1, ...data.map((d) => d.crc))
  const W = 360
  const H = 120
  const bw = W / data.length
  return (
    <svg className="lg-chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Sales in colones per week, last 12 weeks">
      <line x1="0" y1={H} x2={W} y2={H} className="ax" />
      {data.map((d, i) => {
        const h = (d.crc / max) * (H - 14)
        return (
          <g key={d.week}>
            <rect x={i * bw + 3} y={H - h} width={bw - 6} height={h} className="bar">
              <title>{`${d.week}: ₡${Math.round(d.crc).toLocaleString('en-US')} // ${d.kg.toFixed(1)} kg`}</title>
            </rect>
            {i % 2 === 1 && <text x={i * bw + bw / 2} y={H + 13} textAnchor="middle" className="lb">{d.week.slice(5).replace('-', '.')}</text>}
          </g>
        )
      })}
      <text x="2" y="10" className="lb">{fmtCrc(max)}</text>
    </svg>
  )
}

function Totals({ sales, fx, rate, cost, noPrices, onOpenLedger }: { sales: Sale[]; fx: number; rate: Rate; cost: (k: string) => { perKg: number | null; basis: Basis }; noPrices: boolean; onOpenLedger: () => void }) {
  const [p, setP] = useState<Period>('4WK')
  const list = between(sales, periodFrom(p), null)
  const kg = list.reduce((n, s) => n + Number(s.kg), 0)
  const crc = list.reduce((n, s) => n + Number(s.amount_crc), 0)
  const { m, uncosted } = margin(list, (k) => cost(k).perKg, rate)
  const usd = usdOf(list, rate)
  const bases = [...new Set(list.filter((s) => s.form === 'fresh' && s.species_key).map((s) => cost(s.species_key as string).basis))]
  const anyEstimate = bases.some((b) => b !== 'ACTUAL')
  return (
    <div className="lg-stack">
      <Buttons value={p} options={PERIODS} onPick={setP} />
      <div className="ck-box">
        <div className="section-title">SOLD</div>
        <div className="lg-big">
          <div><span>SALES</span><b>{list.length}</b></div>
          <div><span>KG</span><b>{kg.toFixed(1)}</b></div>
          <div><span>REVENUE</span><Money crc={crc} fx={eff(crc, usd, fx)} /></div>
          <div><span>AVERAGE</span><Money crc={kg > 0 ? crc / kg : null} fx={eff(crc, usd, fx)} /></div>
        </div>
      </div>
      <div className="ck-box">
        <div className="section-title">MARGIN AGAINST LEDGER COST PER KG</div>
        {anyEstimate && <div className="dim tiny"><span className="lg-tag estimate">ESTIMATE</span> SOME OF THE COST PER KG IS FROM THE PLAN, NOT LOGGED DATA.</div>}
        {noPrices && <div className="lg-warn">CARGO HAS NO PRICES YET, SO THE COST LEAVES OUT SUBSTRATE, GRAIN AND BAGS. THE MARGIN IS TOO HIGH UNTIL YOU ADD THEM.</div>}
        <div className="lg-big">
          <div><span>COSTED REVENUE</span><Money crc={m.revenue} fx={eff(m.revenue, m.usd.revenue, fx)} /></div>
          <div><span>COST OF THOSE KG</span><Money crc={m.cost} fx={eff(m.cost, m.usd.cost, fx)} /></div>
          <div><span>MARGIN</span><Money crc={m.margin} fx={eff(Math.abs(m.margin), Math.abs(m.usd.margin), fx)} /></div>
          <div><span>MARGIN %</span><b>{m.pct === null ? '--' : `${m.pct.toFixed(0)}%`}</b></div>
        </div>
        <div className="dim tiny">
          FRESH SALES ONLY. {uncosted > 0 ? `${fmtCrc(uncosted)} OF SALES HAVE NO COST (DRIED, OR A SPECIES LEDGER HAS NO FIGURE FOR). ` : ''}
          <button type="button" className="ck-link" onClick={onOpenLedger}>OPEN LEDGER</button>
        </div>
      </div>
      <div className="ck-box">
        <div className="section-title">BY CHANNEL</div>
        <Bars rows={byChannel(list, rate)} label={chLabel} fx={fx} />
      </div>
      <div className="ck-box">
        <div className="section-title">BY PRODUCT</div>
        <Bars rows={byProduct(list, rate)} label={productLabel} fx={fx} />
      </div>
      <div className="ck-box">
        <div className="section-title">₡ PER WEEK // LAST 12 WEEKS</div>
        <WeekChart sales={sales} />
      </div>
    </div>
  )
}

// ---------- buyers and the log ----------

function Buyers({ sales, fx, rate, onOpenOrders }: { sales: Sale[]; fx: number; rate: Rate; onOpenOrders?: () => void }) {
  const list = buyers(sales, rate)
  return (
    <div className="ck-box">
      <div className="section-title">BUYERS</div>
      {onOpenOrders && <div className="dim tiny">BUYERS WHO TAKE THE SAME EVERY WEEK? <button type="button" className="ck-link" onClick={onOpenOrders}>OPEN STANDING ORDERS</button> (CASH ON DELIVERY).</div>}
      {list.length === 0 ? <div className="dim">NO NAMED BUYERS YET. TYPE A BUYER ON A SALE AND THEY APPEAR HERE.</div> : (
        <div className="ck-scroll">
          <table className="lg-table">
            <thead><tr><th>BUYER</th><th>CHANNEL</th><th>SALES</th><th>KG</th><th>₡</th><th>US$</th><th>FIRST</th><th>LAST</th></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.name}>
                  <td>{b.name.toUpperCase()}</td>
                  <td>{chLabel(b.channel)}</td>
                  <td>{b.n}</td>
                  <td>{b.kg.toFixed(1)}</td>
                  <td>{fmtCrc(b.crc)}</td>
                  <td>{fmtUsd(b.crc, eff(b.crc, b.usd, fx))}</td>
                  <td>{b.first}</td>
                  <td>{b.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Log({ sales, rate, say }: { sales: Sale[]; rate: Rate; say: Say }) {
  const store = useStore()
  return (
    <div className="ck-box">
      <div className="section-title">SALES LOG</div>
      {sales.length === 0 ? <div className="dim">NO SALES YET.</div> : (
        <div className="ck-scroll">
          <table className="lg-table">
            <thead><tr><th>DAY</th><th>BUYER</th><th>CHANNEL</th><th>PRODUCT</th><th>GRADE</th><th>KG</th><th>₡</th><th>₡/KG</th><th>PAID</th><th>LOTS</th><th /></tr></thead>
            <tbody>
              {sales.slice(0, 200).map((s) => (
                <tr key={s.id}>
                  <td>{s.sold_on}</td>
                  <td>{(s.buyer ?? '--').toUpperCase()}</td>
                  <td>{chLabel(s.channel)}</td>
                  <td>{speciesName(s.species_key ?? 'unknown')} {s.form.toUpperCase()}</td>
                  <td>{s.grade ?? '--'}</td>
                  <td>{Number(s.kg).toFixed(2)}</td>
                  <td>{fmtCrc(Number(s.amount_crc))} <small className="dim">{fmtUsd(Number(s.amount_crc), rate(s.sold_on))}</small></td>
                  <td>{Number(s.kg) > 0 ? fmtCrc(Number(s.amount_crc) / Number(s.kg)) : '--'}</td>
                  <td>{payStatus(s) === 'paid' ? paidDay(s) : payStatus(s) === 'owed' ? <span className="lg-warn-text">OWED</span> : 'WRITTEN OFF'}</td>
                  <td>{(s.lot_codes ?? []).join(' ') || '--'}</td>
                  <td><Confirm label="DELETE" onYes={() => void store.del('sales', s.id).then(() => say('SALE DELETED'), (e: Error) => say(e.message.toUpperCase(), true))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
