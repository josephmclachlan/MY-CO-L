import { useMemo, useState } from 'react'
import { useStationTabs } from '../nav/StationContext'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HistoryButton } from './History'
import { Confirm, Guess } from './CookParts'
import { PracticeFields } from './XenoBank'
import { speciesName } from '../store/useLedger'
import { useOrders, type OrdersData } from '../store/useOrders'
import { useFx } from '../store/useFx'
import { CHANNELS, SALE_SPECIES, formAfterPick, type Channel } from '../data/ledger'
import { STATION } from '../data/farm'
import { fmtCrc, fmtUsd } from '../lib/cargo'
import { salePrice } from '../lib/rates'
import { addDays, todayIso } from '../lib/xeno'
import { planBagsFor } from '../data/cropplan'
import {
  DAY_NAMES,
  DAY_SHORT,
  DEFAULT_DELIVERY_DAY,
  EPS,
  NAME_ES,
  PAYMENT_RULE,
  blocksNeeded,
  capReachable,
  checkOrder,
  dependence,
  deliveredFor,
  figuresFor,
  fillRate,
  forecastWeeks,
  mondayOf,
  offers,
  orderLines,
  orderState,
  pickSheetText,
  round2,
  weekValue,
  whatsappText,
  type Dep,
  type Lang,
  type OrderForm,
  type OrderLine,
  type SpeciesWeek,
  type StandingOrder,
} from '../lib/orders'
import { holdFor, owed } from '../lib/money'
import type { Sale } from '../lib/trade'
import { changeTerms, createOrder, deleteOrder, deliverAll, deliverLine, endOrder, restartOrder, setNote, setWeekKg } from '../lib/ordersActions'

// STANDING ORDERS: what each buyer takes every week, the 1-3 week harvest forecast from the lots in the rooms,
// the weekly pick and pack list (orders against forecast, SHORT and SPARE warnings) and the WhatsApp price list.
// Cash on delivery only. Money is in colones first; US$ is at the delivery day's rate.

export type OrdersTab = 'ORDERS' | 'FORECAST' | 'PICK' | 'LIST' | 'GUESSES'
export const ORDERS_TABS: OrdersTab[] = ['ORDERS', 'FORECAST', 'PICK', 'LIST', 'GUESSES']
const TAB_LABEL: Record<OrdersTab, string> = { ORDERS: 'STANDING ORDERS', FORECAST: 'HARVEST FORECAST', PICK: 'PICK + PACK LIST', LIST: 'PRICE LIST (WHATSAPP)', GUESSES: 'GUESSES' }
export interface OrdersState {
  tab: OrdersTab
  /** Monday of the week on show; null = this week. */
  week: string | null
  /** Weeks the forecast shows (1 to 3). */
  horizon: number
  order: string | null
  lang: Lang
}
export const ORDERS_START: OrdersState = { tab: 'ORDERS', week: null, horizon: 3, order: null, lang: 'EN' }
type SetOrders = (p: Partial<OrdersState>) => void
type Say = (t: string, warn?: boolean) => void

const num = (s: string): number | null => {
  const n = Number(s.replace(/[₡,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}
const kgF = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const sp = speciesName
/** Sentence case for the WhatsApp text: BLUE OYSTER -> Blue oyster. */
const nice = (t: string) => {
  const l = t.toLowerCase()
  return l.charAt(0).toUpperCase() + l.slice(1)
}
const chLabel = (c: string) => CHANNELS.find((x) => x.id === c)?.label ?? c.toUpperCase()

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

// ---------- index (left menu) ----------

export function OrdersIndex({ x, set }: { x: OrdersState; set: SetOrders }) {
  const { sound } = useApp()
  const d = useOrders(x.week)
  const short = d.plan.filter((p) => p.status === 'SHORT').length
  const over = d.dep.rows.filter((r) => r.level === 'over').length
  const tabs = useStationTabs(ORDERS_TABS)
  return (
    <>
      {tabs.length > 1 && <div className="section-title">STANDING ORDERS</div>}
      {tabs.length > 1 && <ul className="index-list">
        {tabs.map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{TAB_LABEL[t]}</span>
            {t === 'ORDERS' && <span className="k">{d.lines.filter((l) => l.kg > 0).length}</span>}
            {t === 'PICK' && short > 0 && <span className="k">{short} SHORT</span>}
          </li>
        ))}
      </ul>}
      <div className="section-title" style={{ marginTop: 10 }}>WEEK OF {d.week}</div>
      <div className="lg-mini">
        <div>{d.dep.buyers} BUYERS // {kgF(d.dep.totalKg)} KG</div>
        <div>{fmtCrc(d.dep.totalCrc)}</div>
        <div className={short ? 'lg-warn-text' : ''}>{short} SPECIES SHORT</div>
        <div className={over ? 'lg-warn-text' : ''}>{over} BUYERS OVER CAP</div>
      </div>
    </>
  )
}

// ---------- shell ----------

export function Orders({ x, set, say }: { x: OrdersState; set: SetOrders; say: Say }) {
  const { sound } = useApp()
  const d = useOrders(x.week)
  const fx = useFx()
  const tabs = useStationTabs(ORDERS_TABS)
  return (
    <div className="cook ledger od">
      {tabs.length > 1 && <label className="ck-picker">
        <span>SHOW</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as OrdersTab }))}>
          {tabs.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
        </Select>
      </label>}
      <div className="od-pay" role="note">{PAYMENT_RULE}</div>
      {(x.tab === 'ORDERS' || x.tab === 'PICK' || x.tab === 'LIST') && <WeekBar d={d} set={set} />}
      {x.tab === 'ORDERS' && <OrdersTabView d={d} x={x} set={set} say={say} rate={fx.rate} />}
      {x.tab === 'FORECAST' && <ForecastTab d={d} x={x} set={set} />}
      {x.tab === 'PICK' && <PickTab d={d} say={say} rate={fx.rate} />}
      {x.tab === 'LIST' && <ListTab d={d} x={x} set={set} say={say} />}
      {x.tab === 'GUESSES' && <Guesses />}
    </div>
  )
}

function WeekBar({ d, set }: { d: OrdersData; set: SetOrders }) {
  const { sound } = useApp()
  const go = (w: string | null) => (sound.chirp(), set({ week: w === d.thisWeek ? null : w, order: null }))
  const tag = d.week === d.thisWeek ? 'THIS WEEK' : d.week < d.thisWeek ? 'PAST WEEK' : d.week === d.nextWeek ? 'NEXT WEEK' : 'LATER'
  return (
    <div className="ck-box od-week">
      <div className="section-title">WEEK OF {d.week} // {tag}</div>
      <div className="lg-btns">
        <button type="button" className="btn" onClick={() => go(addDays(d.week, -7))}>&lt; EARLIER</button>
        <button type="button" className={`btn ${d.week === d.thisWeek ? 'on' : ''}`} onClick={() => go(d.thisWeek)}>THIS WEEK</button>
        <button type="button" className="btn" onClick={() => go(addDays(d.week, 7))}>LATER &gt;</button>
      </div>
    </div>
  )
}

// ---------- standing orders tab ----------

function Share({ r }: { r: Dep }) {
  return (
    <span className="od-share">
      <span className="od-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, r.sharePct)}%` }} /></span>
      <b>{r.sharePct.toFixed(0)}%</b>
      {r.level === 'over' && <span className="od-tag over">OVER CAP</span>}
      {r.level === 'near' && <span className="od-tag near">NEAR CAP</span>}
    </span>
  )
}

function OrdersTabView({ d, x, set, say, rate }: { d: OrdersData; x: OrdersState; set: SetOrders; say: Say; rate: (day: string) => number }) {
  const lines = d.lines.filter((l) => l.kg > 0 || l.skipped)
  const cap = d.practice.buyerCapPct
  const sel = d.orders.find((o) => o.id === x.order) ?? null
  const [all, setAll] = useState(false)
  const sortedAll = useMemo(() => [...d.orders].sort((a, b) => a.buyer.localeCompare(b.buyer) || b.start_on.localeCompare(a.start_on)), [d.orders])
  const shownAll = all ? sortedAll : sortedAll.slice(0, 30)
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">BUYER SHARE OF THIS WEEK // CAP {cap}% <Guess /></div>
        {d.dep.rows.length === 0 ? (
          <div className="dim">NO STANDING ORDERS FOR THIS WEEK YET. ADD ONE BELOW.</div>
        ) : (
          <div className="rc-wrap">
            <table className="lg-table rc-table od-dep">
              <thead><tr><th>BUYER</th><th>KG</th><th>₡</th><th>SHARE</th><th className="hide-sm">UNCONFIRMED</th></tr></thead>
              <tbody>
                {d.dep.rows.map((r) => (
                  <tr key={r.buyer} className={`od-row ${r.level}`}>
                    <td>{r.buyer.toUpperCase()}</td>
                    <td>{kgF(r.kg)}</td>
                    <td>{fmtCrc(r.crc)}</td>
                    <td><Share r={r} /></td>
                    <td className="hide-sm">{r.unconfirmedCrc > 0 ? fmtCrc(r.unconfirmedCrc) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.dep.rows.some((r) => r.level === 'over') && (
          <div className="lg-warn" data-testid="over-cap">
            {d.dep.rows.filter((r) => r.level === 'over').map((r) => r.buyer.toUpperCase()).join(', ')}: MORE THAN {cap}% OF THIS WEEK&apos;S ORDERS. IF THEY STOP, A BIG PART OF THE CROP HAS NO BUYER. FIND ANOTHER BUYER BEFORE TAKING MORE FROM THEM.
          </div>
        )}
        {d.dep.buyers > 0 && !capReachable(d.dep.buyers, cap) && (
          <div className="dim tiny">WITH ONLY {d.dep.buyers} BUYER{d.dep.buyers > 1 ? 'S' : ''}, EVERY SHARE IS ABOVE {cap}% BY SIMPLE ARITHMETIC. THE MARK WILL CLEAR AS YOU ADD BUYERS (NEED AT LEAST {Math.ceil(100 / cap)}).</div>
        )}
        {d.dep.totalCrc > 0 && <div className="dim tiny">{d.dep.unconfirmedPct.toFixed(0)}% OF THE WEEK&apos;S ORDER VALUE IS NOT YET CONFIRMED BY THE BUYER. SHARE IS BY ₡ VALUE.</div>}
        <PracticeFields keys={['buyerCapPct']} title="BUYER CAP" say={say} />
      </div>

      <div className="ck-box">
        <div className="section-title">ORDERS DUE THIS WEEK // {lines.filter((l) => l.kg > 0).length} OF THEM // {fmtCrc(weekValue(lines))}</div>
        {lines.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table od-lines">
              <thead><tr><th>BUYER</th><th>PRODUCT</th><th>KG</th><th className="hide-sm">₡/KG</th><th>₡</th><th>DAY</th><th className="hide-sm" /></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.order.id} tabIndex={0} className={l.order.id === x.order ? 'sel' : ''} onClick={() => set({ order: l.order.id })}>
                    <td>{l.order.buyer.toUpperCase()}</td>
                    <td>{sp(l.order.species_key)}{l.order.form === 'dried' ? ' DRIED' : ''}</td>
                    <td>{l.skipped ? 'SKIP' : kgF(l.kg)}{l.changed ? '*' : ''}</td>
                    <td className="hide-sm">{fmtCrc(Number(l.order.price_crc_per_kg))}</td>
                    <td>{fmtCrc(l.crc)}</td>
                    <td>{DAY_SHORT[l.order.day_of_week - 1]}{l.order.confirmed ? '' : ' ?'}</td>
                    <td className="od-open hide-sm">OPEN</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NOTHING IS DUE THIS WEEK.</div>
        )}
        <div className="dim tiny">TAP A LINE TO CHANGE IT: ONE WEEK ONLY, OR NEW KG, PRICE OR DAY FROM A MONDAY ON. * = THIS WEEK IS DIFFERENT FROM THE STANDING AMOUNT. ? = BUYER HAS NOT CONFIRMED. US$ IS AT THE DELIVERY DAY&apos;S RATE ON THE PICK LIST.</div>
      </div>

      {sel && <OrderDetail key={sel.id} o={sel} d={d} say={say} rate={rate} onClose={() => set({ order: null })} />}
      <NewOrder d={d} say={say} rate={rate} onMade={(id) => set({ order: id })} />
      <PlanCheck d={d} />

      <div className="ck-box">
        <div className="section-title">ALL ORDERS EVER MADE // {d.orders.length}</div>
        {sortedAll.length ? (
          <>
            <div className="rc-wrap">
              <table className="lg-table rc-table">
                <thead><tr><th>BUYER</th><th>PRODUCT</th><th>KG/WK</th><th className="hide-sm">₡/KG</th><th>STATE</th></tr></thead>
                <tbody>
                  {shownAll.map((o) => {
                    const st = orderState(o, todayIso())
                    return (
                      <tr key={o.id} tabIndex={0} className={o.id === x.order ? 'sel' : ''} onClick={() => set({ order: o.id })}>
                        <td>{o.buyer.toUpperCase()}</td>
                        <td>{sp(o.species_key)}{o.form === 'dried' ? ' DRIED' : ''}</td>
                        <td>{kgF(Number(o.kg))}</td>
                        <td className="hide-sm">{fmtCrc(Number(o.price_crc_per_kg))}</td>
                        <td className={st.running ? '' : 'dim'}>{st.text}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {sortedAll.length > 30 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW FIRST 30' : `SHOW ALL ${sortedAll.length}`}</button>}
          </>
        ) : (
          <div className="dim">NONE YET.</div>
        )}
      </div>
    </div>
  )
}

function DayButtons({ value, onPick }: { value: number; onPick: (n: number) => void }) {
  const { sound } = useApp()
  return (
    <div className="lg-btns" role="group" aria-label="Delivery day">
      {DAY_SHORT.map((n, i) => (
        <button key={n} type="button" className={`btn ${value === i + 1 ? 'on' : ''}`} aria-pressed={value === i + 1} onClick={() => (sound.chirp(), onPick(i + 1))}>{n}</button>
      ))}
    </div>
  )
}

function Toggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} className={`btn ${on ? 'on' : ''}`} onClick={onToggle}>
      {on ? '[X]' : '[ ]'} {label}
    </button>
  )
}

// ---------- order detail ----------

function OrderDetail({ o, d, say, rate, onClose }: { o: StandingOrder; d: OrdersData; say: Say; rate: (day: string) => number; onClose: () => void }) {
  const store = useStore()
  const run = useRun(say)
  const line = d.lines.find((l) => l.order.id === o.id) ?? null
  const [kg, setKg] = useState(String(o.kg))
  const [price, setPrice] = useState(String(o.price_crc_per_kg))
  const [dow, setDow] = useState(o.day_of_week)
  const [conf, setConf] = useState(o.confirmed)
  const [from, setFrom] = useState(addDays(d.thisWeek, 7))
  const [wkKg, setWkKg] = useState(line ? String(line.kg) : '')
  const [wkNote, setWkNote] = useState(line?.note ?? '')
  const [last, setLast] = useState(o.end_on ?? todayIso())
  const [notes, setNotes] = useState(o.notes ?? '')
  const fromMon = mondayOf(from)
  const st = orderState(o, todayIso())
  const prev = o.prev_id ? d.orders.find((x) => x.id === o.prev_id) : null
  const fx = rate(line ? line.deliveryOn : d.thisWeek)
  const save = () =>
    run(() => changeTerms(store, o, { kg: num(kg), price: num(price), day_of_week: dow, confirmed: conf }, fromMon, d.weeks), `${o.buyer.toUpperCase()}: NEW TERMS FROM ${fromMon}`)
  return (
    <div className="ck-box od-detail" data-testid="order-detail">
      <div className="section-title">{o.buyer.toUpperCase()} // {sp(o.species_key)}{o.form === 'dried' ? ' DRIED' : ''} // {st.text}</div>
      <div className="dim tiny">
        {chLabel(o.channel)} // {kgF(Number(o.kg))} KG EVERY {DAY_NAMES[o.day_of_week - 1]} // {fmtCrc(Number(o.price_crc_per_kg))}/KG ({fmtUsd(Number(o.price_crc_per_kg), fx)} AT ₡{fx}) // FROM {o.start_on} // {o.confirmed ? 'CONFIRMED' : 'NOT CONFIRMED'}
        {prev ? ` // CHANGED FROM AN EARLIER ORDER (${kgF(Number(prev.kg))} KG AT ${fmtCrc(Number(prev.price_crc_per_kg))})` : ''}
      </div>

      {line && (
        <div className="od-sub">
          <div className="section-title">THIS WEEK ONLY ({line.week})</div>
          <div className="ck-fields">
            <label className="ck-field"><span>KG THIS WEEK (0 = SKIP)</span><input inputMode="decimal" aria-label="KG this week" value={wkKg} onChange={(e) => setWkKg(e.target.value)} /></label>
            <label className="ck-field"><span>NOTE</span><input maxLength={140} aria-label="Note for this week" value={wkNote} placeholder="E.G. CLOSED FOR HOLIDAY" onChange={(e) => setWkNote(e.target.value)} /></label>
          </div>
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => void run(() => setWeekKg(store, o, line.week, num(wkKg), wkNote, d.weeks), `${o.buyer.toUpperCase()}: WEEK ${line.week} SET`)}>SAVE THIS WEEK</button>
            <button type="button" className="btn" onClick={() => void run(() => setWeekKg(store, o, line.week, 0, wkNote || 'SKIPPED', d.weeks), `${o.buyer.toUpperCase()}: SKIP WEEK ${line.week}`)}>SKIP THIS WEEK</button>
            {line.changed || line.skipped ? <button type="button" className="btn" onClick={() => void run(() => setWeekKg(store, o, line.week, null, null, d.weeks), `${o.buyer.toUpperCase()}: WEEK ${line.week} BACK TO ${kgF(Number(o.kg))} KG`)}>BACK TO STANDING</button> : null}
          </div>
          {line.note && <div className="dim tiny">NOTE: {line.note.toUpperCase()}</div>}
        </div>
      )}

      {st.text.startsWith('ENDED') ? (
        <div className="od-sub">
          <div className="section-title">RESTART</div>
          <label className="ck-field"><span>RESTART FROM THE WEEK OF</span><PickInput type="date" value={from} onChange={(e) => setFrom(e.target.value || from)} /></label>
          <div className="dim tiny">STARTS ON MONDAY {fromMon}.</div>
          <button type="button" className="btn on" onClick={() => void run(() => restartOrder(store, o, fromMon), `${o.buyer.toUpperCase()}: RESTARTED FROM ${fromMon}`)}>RESTART ORDER</button>
        </div>
      ) : (
        <div className="od-sub">
          <div className="section-title">CHANGE THE STANDING ORDER</div>
          <div className="dim tiny">THE NEW KG, PRICE AND DAY APPLY FROM THE WEEK YOU PICK. EARLIER WEEKS KEEP THEIR OLD PRICE.</div>
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>KG PER WEEK</span><input inputMode="decimal" aria-label="KG per week" value={kg} onChange={(e) => setKg(e.target.value)} /></label>
            <label className="ck-field"><span>₡ PER KG</span><input inputMode="decimal" aria-label="Colones per kg" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label className="ck-field"><span>FROM THE WEEK OF</span><PickInput type="date" value={from} onChange={(e) => setFrom(e.target.value || from)} /></label>
          </div>
          <div className="ck-field"><span>DELIVERY DAY</span><DayButtons value={dow} onPick={setDow} /></div>
          <Toggle on={conf} label="BUYER HAS CONFIRMED" onToggle={() => setConf(!conf)} />
          <div className="dim tiny">APPLIES FROM MONDAY {fromMon}.</div>
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => void save()}>SAVE NEW TERMS</button>
          </div>
          <div className="section-title">STOP THIS ORDER</div>
          <label className="ck-field"><span>LAST DELIVERY ON</span><PickInput type="date" value={last} onChange={(e) => setLast(e.target.value || last)} /></label>
          <button type="button" className="btn" onClick={() => void run(() => endOrder(store, o, last), `${o.buyer.toUpperCase()}: ENDS ${last}`)}>END ORDER AFTER THAT DAY</button>
        </div>
      )}

      <label className="ck-field"><span>NOTES</span><input maxLength={140} aria-label="Order notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes.trim() !== (o.notes ?? '') && void run(() => setNote(store, o, notes), 'NOTE SAVED')} /></label>
      <div className="lg-btns">
        <HistoryButton table="standing_orders" id={o.id} />
        <Confirm label="DELETE ORDER" onYes={() => void run(() => deleteOrder(store, o, d.weeks), `${o.buyer.toUpperCase()}: ORDER DELETED`).then(onClose)} />
        <button type="button" className="btn" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  )
}

// ---------- new order ----------

function NewOrder({ d, say, rate, onMade }: { d: OrdersData; say: Say; rate: (day: string) => number; onMade: (id: string) => void }) {
  const store = useStore()
  const run = useRun(say)
  const [buyer, setBuyer] = useState('')
  const [channel, setChannel] = useState<Channel>('restaurant')
  const [species, setSpecies] = useState('blue-oyster')
  const [form, setForm] = useState<OrderForm>('fresh')
  const [kg, setKg] = useState('')
  const [price, setPrice] = useState('')
  const [dow, setDow] = useState(DEFAULT_DELIVERY_DAY)
  const [from, setFrom] = useState(addDays(d.thisWeek, d.now > addDays(d.thisWeek, DEFAULT_DELIVERY_DAY - 1) ? 7 : 0))
  const [conf, setConf] = useState(false)
  const [notes, setNotes] = useState('')
  const names = useMemo(() => [...new Set(d.orders.map((o) => o.buyer))].sort(), [d.orders])
  const def = salePrice(species, form).price
  const start = mondayOf(from)
  const pr = num(price) ?? def
  const k = num(kg)
  const bad = checkOrder({ buyer, species_key: species, form, kg: k, price: pr, day_of_week: dow, start_on: start })
  // What this order does to the buyer's share in its first week.
  const preview = useMemo(() => {
    if (bad) return null
    const fake: StandingOrder = { id: 'new', buyer: buyer.trim(), channel, species_key: species, form, kg: k as number, price_crc_per_kg: pr as number, day_of_week: dow, start_on: start, end_on: null, confirmed: conf, prev_id: null, notes: null }
    const dep = dependence(orderLines([...d.orders, fake], d.weeks, start), d.practice.buyerCapPct)
    return dep.rows.find((r) => r.buyer.toUpperCase() === buyer.trim().toUpperCase().replace(/\s+/g, ' ')) ?? null
  }, [bad, buyer, channel, species, form, k, pr, dow, start, conf, d.orders, d.weeks, d.practice.buyerCapPct])
  const fx = rate(addDays(start, dow - 1))
  const save = async () => {
    const ok = await run(async () => {
      const o = await createOrder(store, { buyer, channel, species_key: species, form, kg: k, price: pr, day_of_week: dow, start_on: start, confirmed: conf, notes })
      onMade(o.id)
    }, `STANDING ORDER: ${buyer.trim().toUpperCase()} ${kg} KG ${sp(species).toUpperCase()}`)
    if (ok) {
      setKg('')
      setPrice('')
      setNotes('')
      setBuyer('')
    }
  }
  return (
    <div className="ck-box">
      <div className="section-title">NEW STANDING ORDER</div>
      <div className="dim tiny">A BUYER WHO TAKES THE SAME EVERY WEEK. {PAYMENT_RULE}</div>
      <label className="ck-field">
        <span>BUYER</span>
        <input list="od-buyers" aria-label="Buyer" value={buyer} maxLength={40} placeholder="NAME" onChange={(e) => setBuyer(e.target.value)} />
      </label>
      <datalist id="od-buyers">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <div className="ck-field">
        <span>CHANNEL</span>
        <div className="lg-btns">
          {CHANNELS.map((c) => <button key={c.id} type="button" className={`btn ${channel === c.id ? 'on' : ''}`} aria-pressed={channel === c.id} onClick={() => setChannel(c.id)}>{c.label}</button>)}
        </div>
      </div>
      <div className="ck-fields">
        <label className="ck-field">
          <span>SPECIES</span>
          <Select aria-label="Species" value={species} onChange={(e) => (setForm(formAfterPick(species, e.target.value, form)), setSpecies(e.target.value), setPrice(''))}>
            {SALE_SPECIES.map((s) => <option key={s} value={s}>{sp(s)}</option>)}
          </Select>
        </label>
        <div className="ck-field">
          <span>FORM</span>
          <div className="lg-btns">
            {(['fresh', 'dried'] as OrderForm[]).map((f) => <button key={f} type="button" className={`btn ${form === f ? 'on' : ''}`} aria-pressed={form === f} onClick={() => (setForm(f), setPrice(''))}>{f.toUpperCase()}</button>)}
          </div>
        </div>
      </div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>KG PER WEEK</span><input inputMode="decimal" aria-label="KG per week" value={kg} placeholder="0.0" onChange={(e) => setKg(e.target.value)} /></label>
        <label className="ck-field">
          <span>₡ PER KG</span>
          <input inputMode="decimal" aria-label="Colones per kg" value={price} placeholder={def ? String(def) : 'TYPE IT'} onChange={(e) => setPrice(e.target.value)} />
          <em>{pr ? `${fmtUsd(pr, fx)} AT ₡${fx}. ` : ''}{!num(price) && def ? 'LIST PRICE. ' : ''}{!def && !num(price) ? 'NO LIST PRICE FOR THIS PRODUCT. ' : ''}FIXED FOR THE ORDER.</em>
        </label>
        <label className="ck-field"><span>FIRST WEEK</span><PickInput type="date" value={from} onChange={(e) => setFrom(e.target.value || from)} /><em>WEEK OF {start}</em></label>
      </div>
      <div className="ck-field"><span>DELIVERY DAY</span><DayButtons value={dow} onPick={setDow} /></div>
      <Toggle on={conf} label="BUYER HAS CONFIRMED THIS ORDER" onToggle={() => setConf(!conf)} />
      <label className="ck-field"><span>NOTES</span><input maxLength={140} aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {k && pr ? <div className="dim tiny">{fmtCrc(k * pr)} A WEEK // ABOUT {fmtCrc(k * pr * 52)} A YEAR AT THIS PRICE</div> : null}
      {preview && preview.level !== 'ok' && (
        <div className="lg-warn" data-testid="cap-preview">
          THIS MAKES {preview.buyer.toUpperCase()} {preview.sharePct.toFixed(0)}% OF THE ORDERS IN THE WEEK OF {start} (CAP {d.practice.buyerCapPct}%). YOU CAN STILL SAVE IT.
        </div>
      )}
      <button type="button" className="btn on lg-save" onClick={() => void save()}>SAVE STANDING ORDER</button>
    </div>
  )
}

// ---------- orders against the crop plan ----------

function PlanCheck({ d }: { d: OrdersData }) {
  const rows = useMemo(() => {
    const by = new Map<string, number>()
    for (const l of d.lines) if (l.order.form === 'fresh' && l.kg > 0) by.set(l.order.species_key, (by.get(l.order.species_key) ?? 0) + l.kg)
    const fin = d.recs.filter((r) => r.complete)
    return [...by.entries()].map(([species, kg]) => {
      const fig = figuresFor(species, fin)
      const need = blocksNeeded(kg, fig.kgPerBlock, d.practice.contamTargetPct, d.practice.spareBlockPct)
      return { species, kg, fig, need, plan: planBagsFor(species) }
    })
  }, [d.lines, d.recs, d.practice.contamTargetPct, d.practice.spareBlockPct])
  if (!rows.length) return null
  return (
    <div className="ck-box">
      <div className="section-title">BLOCKS TO KNOCK EACH WEEK FOR THESE ORDERS</div>
      <div className="rc-wrap">
        <table className="lg-table rc-table">
          <thead><tr><th>SPECIES</th><th>KG</th><th>KG/BLK</th><th>NEED</th><th>PLAN</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const short = r.need && r.plan !== null && r.need.total > r.plan
              return (
                <tr key={r.species}>
                  <td>{sp(r.species).toUpperCase()}</td>
                  <td>{kgF(r.kg)}</td>
                  <td>{r.fig.kgPerBlock === null ? '-' : r.fig.kgPerBlock.toFixed(2)} <span className="dim">{r.fig.src}</span></td>
                  <td>{r.need ? r.need.total : '-'}</td>
                  <td className={short ? 'lg-warn-text' : ''}>{r.plan === null ? 'NOT IN PLAN' : r.plan}{short ? ' TOO FEW' : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="dim tiny">NEED = KG / KG PER BLOCK, RAISED FOR LOSSES AT YOUR {d.practice.contamTargetPct}% CONTAMINATION TARGET, PLUS THE {d.practice.spareBlockPct}% SPARE-BLOCK BUFFER. PLAN = BAGS A WEEK IN THE CROP PLAN.</div>
    </div>
  )
}

// ---------- forecast tab ----------

function ForecastTab({ d, x, set }: { d: OrdersData; x: OrdersState; set: SetOrders }) {
  const { sound } = useApp()
  const n = Math.min(3, Math.max(1, x.horizon))
  const weeks = useMemo(() => forecastWeeks(d.forecasts, d.now, n), [d.forecasts, d.now, n])
  const orderWeeks = useMemo(() => weeks.map((w) => orderLines(d.orders, d.weeks, w.week).filter((l) => l.order.form === 'fresh')), [weeks, d.orders, d.weeks])
  const species = useMemo(() => {
    const s = new Set<string>()
    for (const w of weeks) for (const k of w.byKg.keys()) s.add(k)
    for (const ls of orderWeeks) for (const l of ls) if (l.kg > 0) s.add(l.order.species_key)
    return [...s].sort((a, b) => sp(a).localeCompare(sp(b)))
  }, [weeks, orderWeeks])
  const pickedNow = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of d.plan) m.set(l.species, l.pickedKg)
    return m
  }, [d.plan])
  const [all, setAll] = useState(false)
  const lots = all ? d.forecasts : d.forecasts.filter((f) => f.remainingKg > 0 || f.flag === 'NO FIGURE').slice(0, 40)
  const noFig = d.forecasts.filter((f) => f.flag === 'NO FIGURE')
  const late = d.forecasts.filter((f) => f.flag === 'LATE')
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">HARVEST FORECAST // KG STILL TO COME</div>
        <div className="lg-btns" role="group" aria-label="Weeks shown">
          {[1, 2, 3].map((h) => <button key={h} type="button" className={`btn ${n === h ? 'on' : ''}`} aria-pressed={n === h} onClick={() => (sound.chirp(), set({ horizon: h }))}>{h} WEEK{h > 1 ? 'S' : ''}</button>)}
        </div>
        {species.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table od-fc">
              <thead>
                <tr><th>SPECIES</th>{weeks.map((w) => <th key={w.week}>{w.week.slice(5)}</th>)}</tr>
              </thead>
              <tbody>
                {species.map((s) => (
                  <tr key={s}>
                    <td>{sp(s).toUpperCase()}</td>
                    {weeks.map((w, i) => {
                      const fc = w.byKg.get(s) ?? 0
                      const picked = i === 0 ? pickedNow.get(s) ?? 0 : 0
                      const ord = orderWeeks[i].filter((l) => l.order.species_key === s).reduce((a, l) => a + l.kg, 0)
                      const supply = fc + picked
                      const shortTag = ord > supply + EPS
                      return (
                        <td key={w.week} className={shortTag ? 'od-short' : ''}>
                          <b>{kgF(supply)}</b>
                          <small className="dim"> / {kgF(ord)} ORDERED{shortTag ? ' - SHORT' : ''}</small>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="od-total">
                  <td>TOTAL</td>
                  {weeks.map((w, i) => <td key={w.week}><b>{kgF(w.totalKg + (i === 0 ? [...pickedNow.values()].reduce((a, b) => a + b, 0) : 0))}</b></td>)}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NO LOTS ARE FORECAST TO GIVE MUSHROOMS IN THE NEXT {n} WEEK{n > 1 ? 'S' : ''}. LOG BLOCK LOTS IN MISSION CONTROL.</div>
        )}
        <div className="dim tiny">
          EACH CELL: KG EXPECTED (PICKED SO FAR THIS WEEK + STILL TO COME) / KG ORDERED (FRESH STANDING ORDERS). WEEKS START MONDAY. THE FIRST WEEK COUNTS FROM TODAY.
        </div>
      </div>
      {(noFig.length > 0 || late.length > 0) && (
        <div className="lg-warn">
          {late.length > 0 && <div>{late.length} LOT{late.length > 1 ? 'S ARE' : ' IS'} PAST THE EXPECTED WINDOW WITH NOTHING PICKED ({late.slice(0, 6).map((f) => f.lot.lot_code).join(', ')}). THEY ARE COUNTED AS STARTING NOW. CHECK THEM.</div>}
          {noFig.length > 0 && <div>{noFig.length} LOT{noFig.length > 1 ? 'S' : ''} OF A SPECIES WITH NO YIELD FIGURE ARE LEFT OUT ({[...new Set(noFig.map((f) => sp(f.species)))].join(', ')}).</div>}
        </div>
      )}
      <div className="ck-box">
        <div className="section-title">LOTS BEHIND THE FORECAST</div>
        {lots.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>LOT</th><th>BLK</th><th className="hide-sm">PICKED</th><th>TO COME</th><th>FROM</th><th className="hide-sm">TO</th><th>STATE</th></tr></thead>
              <tbody>
                {lots.map((f) => (
                  <tr key={f.lot.id} className={f.flag === 'LATE' ? 'od-short' : ''}>
                    <td>{f.lot.lot_code}</td>
                    <td>{f.blocks}</td>
                    <td className="hide-sm">{kgF(f.pickedKg)}</td>
                    <td>{kgF(f.remainingKg)}</td>
                    <td>{f.from ? f.from.slice(5) : '-'}</td>
                    <td className="hide-sm">{f.to ? f.to.slice(5) : '-'}</td>
                    <td>{f.flag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NO ACTIVE LOTS.</div>
        )}
        {d.forecasts.length > lots.length && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW ONLY LOTS WITH KG TO COME' : `SHOW ALL ${d.forecasts.length}`}</button>}
        <div className="dim tiny">
          KG TO COME = EXPECTED KG OF THE LOT MINUS WHAT WAS PICKED, SPREAD EVENLY FROM THE FIRST EXPECTED PICK DAY FOR THE SPECIES&apos; PICKING DAYS. EXPECTED KG = LIVE BLOCKS X KG PER BLOCK (YOUR OWN FINISHED LOTS ONCE THERE ARE {3} OF A SPECIES, ELSE CATAWBA&apos;S). STATES: WAIT, DUE, PICKING, LATE (WINDOW OVER, NOTHING PICKED), PAST WINDOW (PICKED, NOW FINISHING, NOT COUNTED), DONE.
        </div>
      </div>
    </div>
  )
}

// ---------- pick and pack ----------

const STATUS_TEXT = (p: SpeciesWeek) =>
  p.status === 'SHORT'
    ? `SHORT ${kgF(p.shortKg)} KG${p.blocksShort ? ` (${p.blocksShort} BLOCKS)` : ''}`
    : p.status === 'SPARE'
      ? `USES SPARE ${kgF(p.spareUsedKg)} KG`
      : p.status === 'OK'
        ? `OK, ${kgF(p.surplusKg)} KG FREE`
        : p.supplyKg > 0
          ? `${kgF(p.surplusKg)} KG FREE`
          : 'NO ORDERS'

function PickTab({ d, say, rate }: { d: OrdersData; say: Say; rate: (day: string) => number }) {
  const store = useStore()
  const run = useRun(say)
  // A line set to 0 kg after it was delivered stays on the list, so the delivery is not hidden.
  const live = d.lines.filter((l) => l.kg > 0 || deliveredFor(l, d.sales).length > 0)
  const fresh = live.filter((l) => l.order.form === 'fresh')
  const dried = live.filter((l) => l.order.form === 'dried')
  const fill = fillRate(live, d.sales)
  const days = useMemo(() => {
    const m = new Map<string, OrderLine[]>()
    for (const l of live) (m.get(l.deliveryOn) ?? m.set(l.deliveryOn, []).get(l.deliveryOn)!).push(l)
    return [...m.entries()]
  }, [live])
  const [msg, setMsg] = useState('')
  const copy = async () => setMsg((await copyText(pickSheetText(d.week, d.plan, d.lines, sp))) ? 'PICK SHEET COPIED' : 'COULD NOT COPY. SELECT THE TEXT BY HAND.')
  const rows = d.plan.filter((p) => p.ordersKg > 0 || p.supplyKg > 0)
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">PICK // ORDERS AGAINST WHAT THE ROOMS WILL GIVE</div>
        {rows.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table od-plan">
              <thead><tr><th>SPECIES</th><th>ORDERED</th><th>SUPPLY</th><th className="hide-sm">SPARE</th><th>STATUS</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.species} className={`od-row ${p.status === 'SHORT' ? 'over' : p.status === 'SPARE' ? 'near' : ''}`} data-status={p.status}>
                    <td>{sp(p.species).toUpperCase()}</td>
                    <td>{kgF(p.ordersKg)}{p.unconfirmedKg > EPS ? <small className="dim"> ({kgF(p.unconfirmedKg)} ?)</small> : null}</td>
                    <td>{kgF(p.supplyKg)}</td>
                    <td className="hide-sm">{kgF(p.spareKg)}</td>
                    <td>{STATUS_TEXT(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NO ORDERS AND NOTHING FORECAST FOR THIS WEEK.</div>
        )}
        <div className="dim tiny">
          ORDERED = KG PROMISED TO BUYERS. SUPPLY = KG PICKED THIS WEEK + FORECAST TO COME. SPARE = THE {d.practice.spareBlockPct}% SPARE-BLOCK BUFFER, KEPT BACK, NOT PROMISED. SHORT = ORDERS ARE MORE THAN THE WHOLE SUPPLY. USES SPARE = ORDERS ARE MORE THAN SUPPLY MINUS THE SPARE. (?) = KG NOT YET CONFIRMED BY THE BUYER. FRESH ORDERS ONLY.
        </div>
        {rows.some((p) => p.status === 'SHORT') && (
          <div className="lg-warn" data-testid="short-warn">
            SHORT: {rows.filter((p) => p.status === 'SHORT').map((p) => `${sp(p.species).toUpperCase()} ${kgF(p.shortKg)} KG`).join(', ')}. CUT A BUYER A LITTLE, USE BLOCKS FROM THE COLD ROOM, OR TELL THE BUYER NOW.
          </div>
        )}
        {rows.filter((p) => p.lots.length).map((p) => (
          <div key={p.species} className="dim tiny">PICK {sp(p.species).toUpperCase()} FROM: {p.lots.slice(0, 8).map((l) => `${l.lot_code} (${kgF(l.kg)})`).join(', ')}</div>
        ))}
      </div>

      <div className="ck-box">
        <div className="section-title">PACK AND DELIVER // {fill.done} OF {fill.lines} DELIVERED // {kgF(fill.deliveredKg)} OF {kgF(fill.orderedKg)} KG</div>
        {days.length === 0 && <div className="dim">NOTHING TO PACK THIS WEEK.</div>}
        {days.map(([day, ls]) => (
          <div key={day} className="od-day">
            <div className="od-dayhead">
              <b>{DAY_NAMES[ls[0].order.day_of_week - 1]} {day}</b>
              <span className="dim">{fmtCrc(weekValue(ls))} // {fmtUsd(weekValue(ls), rate(day))} AT ₡{rate(day)}</span>
              <button type="button" className="btn" disabled={ls.every((l) => deliveredFor(l, d.sales).length > 0)} onClick={() => void run(async () => void (await deliverAll(store, ls, d.sales)), `${DAY_NAMES[ls[0].order.day_of_week - 1]} ${day}: ALL DELIVERED`)}>DELIVER ALL</button>
            </div>
            {ls.map((l) => <PackLine key={l.order.id} l={l} sales={d.sales} say={say} now={d.now} />)}
          </div>
        ))}
        {dried.length > 0 && <div className="dim tiny">DRIED ORDERS ({dried.length}, {kgF(dried.reduce((n, l) => n + l.kg, 0))} KG) COME FROM THE DRYER, NOT FROM THE FRESH FORECAST. CHECK THE DRIED STOCK BEFORE YOU PROMISE THEM.</div>}
        <div className="dim tiny">DELIVER = LOGS A SALE IN TRADE AT THE ORDER PRICE, PAID ON THE SPOT (CASH ON DELIVERY). TYPE THE REAL KG IF IT WAS DIFFERENT. UNDO REVERSES IT. {fresh.length} FRESH LINES.</div>
        <div className="lg-btns">
          <button type="button" className="btn" onClick={() => void copy()}>COPY PICK SHEET</button>
        </div>
        {msg && <div className="dim tiny" role="status">{msg}</div>}
      </div>
    </div>
  )
}

function PackLine({ l, sales, say, now }: { l: OrderLine; sales: OrdersData['sales']; say: Say; now: string }) {
  const store = useStore()
  const run = useRun(say)
  const done = deliveredFor(l, sales)
  const [kg, setKg] = useState(String(l.kg))
  const o = l.order
  if (done.length) {
    const k = done.reduce((n, s) => n + Number(s.kg), 0)
    const c = done.reduce((n, s) => n + Number(s.amount_crc), 0)
    return (
      <div className="od-pack done">
        <span className="od-who">{o.buyer.toUpperCase()}</span>
        <span>{sp(o.species_key)}{o.form === 'dried' ? ' DRIED' : ''}</span>
        <span>DELIVERED {kgF(k)} KG</span>
        <span>{fmtCrc(c)}</span>
        <span className="dim">{Math.abs(k - l.kg) > EPS ? `ORDERED ${kgF(l.kg)}` : 'AS ORDERED'}</span>
      </div>
    )
  }
  const hold = holdFor(owed(sales as Sale[], now), o.buyer)
  return (
    <div className="od-pack">
      <span className="od-who">{o.buyer.toUpperCase()}{o.confirmed ? '' : ' ?'}{l.deliveryOn < now && <em className="od-tag over"> OVERDUE</em>}{hold && <em className="od-tag over" title={`Owes ₡${Math.round(hold.crc).toLocaleString('en-US')} since ${hold.oldest}. Cash on delivery: no delivery until paid.`}> ON HOLD: OWES {fmtCrc(hold.crc)}</em>}</span>
      <span>{sp(o.species_key)}{o.form === 'dried' ? ' DRIED' : ''}</span>
      <span>{round2(l.kg)} KG @ {fmtCrc(Number(o.price_crc_per_kg))}</span>
      <span>{fmtCrc(l.crc)}</span>
      <span className="od-do">
        <input inputMode="decimal" aria-label={`KG delivered to ${o.buyer}`} value={kg} onChange={(e) => setKg(e.target.value)} />
        <button type="button" className="btn" onClick={() => void run(() => deliverLine(store, l, sales, num(kg) ?? NaN), `${o.buyer.toUpperCase()}: DELIVERED ${kg} KG`)}>DELIVERED</button>
      </span>
    </div>
  )
}

// ---------- price list for WhatsApp ----------

function ListTab({ d, x, set, say }: { d: OrdersData; x: OrdersState; set: SetOrders; say: Say }) {
  const { sound } = useApp()
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(null)
  const offs = useMemo(() => offers(d.plan, (s) => salePrice(s, 'fresh').price, (s) => nice(sp(s))), [d.plan])
  const text = useMemo(() => whatsappText({ lang: x.lang, week: d.week, offers: offs, farm: STATION.company, nameEs: (s) => NAME_ES[s] ?? nice(sp(s)) }), [x.lang, d.week, offs])
  const key = `${x.lang}|${d.week}|${text}`
  const shown = edited && edited.key === key ? edited.text : text
  const [msg, setMsg] = useState('')
  const copy = async () => {
    const ok = await copyText(shown)
    setMsg(ok ? 'COPIED. PASTE IT INTO WHATSAPP.' : 'COULD NOT COPY. SELECT THE TEXT BY HAND.')
    if (ok) say('MESSAGE COPIED')
  }
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">WHAT IS FREE TO SELL // WEEK OF {d.week}</div>
        {offs.length ? (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>SPECIES</th><th>FREE KG</th><th>₡/KG</th></tr></thead>
              <tbody>{offs.map((o) => <tr key={o.species}><td>{o.name.toUpperCase()}</td><td>{kgF(o.kg)}</td><td>{o.price ? fmtCrc(o.price) : 'NO PRICE'}</td></tr>)}</tbody>
            </table>
          </div>
        ) : (
          <div className="dim">NOTHING IS FREE THIS WEEK: EVERYTHING FORECAST IS ORDERED OR HELD AS SPARE (OR NOTHING IS FORECAST).</div>
        )}
        <div className="dim tiny">FREE = FORECAST MINUS THE {d.practice.spareBlockPct}% SPARE BUFFER MINUS STANDING ORDERS, ROUNDED DOWN TO HALF A KILO. UNDER 1 KG IS NOT OFFERED. PRICES ARE YOUR LIST PRICES (PRICE BOOK).</div>
      </div>
      <div className="ck-box">
        <div className="section-title">MESSAGE</div>
        <div className="lg-btns" role="group" aria-label="Language">
          {(['EN', 'ES'] as Lang[]).map((l) => <button key={l} type="button" className={`btn ${x.lang === l ? 'on' : ''}`} aria-pressed={x.lang === l} onClick={() => (sound.chirp(), set({ lang: l }))}>{l === 'EN' ? 'ENGLISH' : 'ESPAÑOL'}</button>)}
        </div>
        {x.lang === 'ES' && <div className="dim tiny">SPANISH NAMES AND WORDING ARE A GUESS: READ THEM BEFORE SENDING. <Guess /></div>}
        <label className="ck-field">
          <span>EDIT IT IF YOU LIKE, THEN COPY</span>
          <textarea className="od-text" aria-label="WhatsApp message" rows={Math.min(14, shown.split('\n').length + 1)} value={shown} onChange={(e) => setEdited({ key, text: e.target.value })} />
        </label>
        <div className="lg-btns">
          <button type="button" className="btn on" onClick={() => void copy()}>COPY MESSAGE</button>
          <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(shown)}`} target="_blank" rel="noopener noreferrer">OPEN WHATSAPP</a>
          {edited && edited.key === key && <button type="button" className="btn" onClick={() => setEdited(null)}>RESET TEXT</button>}
        </div>
        {msg && <div className="dim tiny" role="status">{msg}</div>}
      </div>
    </div>
  )
}

// ---------- guesses ----------

const GUESS_LIST = [
  'THE 30% ONE-BUYER CAP: JOSEPH SAID 30% BUT MARKED IT UNCONFIRMED. SHARE = A BUYER\'S ₡ VALUE OF THE WEEK\'S ORDERS / ALL ORDERS. NEAR = 80% OF THE CAP. YOU CAN CHANGE THE CAP ON THE ORDERS SCREEN. A WARNING NEVER BLOCKS A SAVE.',
  'UNCONFIRMED ORDERS STILL COUNT IN THE PICK LIST (SAFER TO GROW FOR THEM). THEY ARE SHOWN WITH A ? AND SPLIT OUT IN THE TOTALS.',
  'THERE IS NO PAYMENT-TERMS FIELD ANYWHERE: EVERY ORDER IS CASH ON DELIVERY (JOSEPH, 6 NOV 2026). DELIVERING A LINE LOGS A SALE PAID ON THE DAY.',
  'DELIVERY DAY DEFAULTS TO FRIDAY (SELLING DAYS ARE FRIDAY AND SATURDAY). EVERY ORDER CAN HAVE ITS OWN DAY.',
  'AN ORDER\'S PRICE IS FIXED WHEN YOU SAVE IT (THE LIST PRICE AT THAT TIME). A CHANGE OF KG, PRICE OR DAY STARTS FROM A MONDAY AND LEAVES EARLIER WEEKS ON THE OLD TERMS.',
  'PICKING DAYS AFTER THE FIRST PICK ARE LEDGER\'S GUESS: 7 DAYS FOR MOST SPECIES, 21 FOR LION\'S MANE. KG TO COME IS SPREAD EVENLY OVER THEM (NO SEPARATE FLUSH 1 / FLUSH 2 BUMP).',
  'KG PER BLOCK AND DAYS TO FIRST PICK USE CATAWBA\'S REAL PICKS UNTIL THE FARM HAS 3 FINISHED LOTS OF A SPECIES, THEN THE FARM\'S OWN AVERAGE.',
  'A LOT WHOSE WINDOW IS OVER WITH NOTHING PICKED IS COUNTED AS STARTING TODAY AND FLAGGED LATE. A LOT WITH PICKS AND A FINISHED WINDOW IS TREATED AS FINISHING: NOTHING MORE IS COUNTED.',
  'THE SPARE-BLOCK BUFFER (SETTING, 5%) IS KEPT BACK FROM WHAT IS PROMISED: PROMISABLE = SUPPLY - 5%. ORDERS IN THAT 5% SHOW "USES SPARE"; ORDERS ABOVE THE WHOLE SUPPLY SHOW "SHORT".',
  'DRIED ORDERS ARE NOT CHECKED AGAINST THE FRESH FORECAST (DRYING YIELD IS NOT IN THE SOURCES). THEY ARE LISTED ON THE PACK LIST. FRESH MUSHROOMS ARE NOT CARRIED OVER BETWEEN WEEKS.',
  'WHATSAPP TEXT OFFERS FORECAST MINUS SPARE MINUS ORDERS, DOWN TO THE NEAREST HALF KILO, NOTHING UNDER 1 KG. PRICES IN COLONES ONLY. THE SPANISH VERSION (NAMES, WORDING, ₡ WITH A DOT FOR THOUSANDS) IS A GUESS.',
  'BLOCKS NEEDED FOR AN ORDER = KG / KG PER BLOCK, RAISED FOR LOSSES AT THE CONTAMINATION TARGET, PLUS THE SPARE BUFFER.',
]
function Guesses() {
  return (
    <div className="ck-box">
      <div className="section-title">GUESSES WAITING FOR REVIEW</div>
      <ul className="ck-guesses">{GUESS_LIST.map((g) => <li key={g}><Guess /> {g}</li>)}</ul>
    </div>
  )
}
