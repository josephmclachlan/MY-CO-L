import { Select } from '../components/Select'
import { useRef, useState, type ReactNode } from 'react'
import { useFx, useFxSync } from '../store/useFx'
import { useApp } from '../settings/AppContext'
import { useStoreStatus } from '../store/StoreContext'
import { useCargo, type CargoRow } from '../store/useCargo'
import { RefText } from '../manual/ManualLinks'
import { TypeText } from '../components/TypeText'
import { CATEGORIES } from '../data/cargo'
import { ROOMS } from '../data/rooms'
import { WEEKLY_BAGS } from '../data/species'
import {
  fmtCrc,
  fmtQty,
  fmtUsd,
  fmtWeeks,
  meterShape,
  num,
  priceHistory,
  type Item,
  type Move,
} from '../lib/cargo'
import { addPrice, newItem, receive, removeItem, seedStarter, setCount, undoRun, newMove } from '../lib/cargoActions'
import type { RoomId } from '../data/power'

type Tone = '' | 'warn' | 'dim'

const STATE_TONE: Record<string, Tone> = { 'NO COUNT': 'dim', OK: '', LOW: 'warn', OUT: 'warn' }

/** A hatched stock meter. The tick marks the reorder point. */
export function StockMeter({ r }: { r: CargoRow }) {
  const { frac, mark } = meterShape(r.item, r.onHand, r.use)
  return (
    <span className={`cg-meter ${r.state === 'LOW' || r.state === 'OUT' ? 'low' : ''} ${!r.counted ? 'nocount' : ''}`} style={{ ['--pct' as string]: `${frac * 100}%` }} aria-hidden>
      <i className="cg-fill" />
      {mark !== null && <i className="cg-mark" style={{ left: `${mark * 100}%` }} />}
    </span>
  )
}

/** A text or number field that saves when you leave it or press Enter. */
function Field({ label, value, onSave, wide, placeholder, inputMode, disabled }: { label: string; value: string; onSave: (v: string) => void; wide?: boolean; placeholder?: string; inputMode?: 'decimal' | 'numeric' | 'text'; disabled?: boolean }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  const commit = () => draft !== value && onSave(draft.trim())
  return (
    <label className={`cg-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <input
        value={draft}
        placeholder={placeholder}
        inputMode={inputMode}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), commit())}
      />
    </label>
  )
}

/** A button that asks twice before doing something that cannot be undone. */
function Confirm({ label, onYes, disabled }: { label: string; onYes: () => void; disabled?: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <button type="button" className={`btn danger ${sure ? 'on' : ''}`} disabled={disabled} onClick={() => (sure ? (setSure(false), onYes()) : setSure(true))} onBlur={() => setSure(false)}>
      {sure ? 'SURE? TAP AGAIN' : label}
    </button>
  )
}

/** ₡ with US$ beside it. With a day, the US$ uses that day's rate (a price keeps the rate of the day it was paid). */
function Money({ crc, fx, day }: { crc: number; fx: number; day?: string }) {
  const f = useFx()
  useFxSync(day ? [day] : [])
  const rate = day ? f.rate(day) : fx
  return (
    <span>
      {fmtCrc(crc)} <span className="dim">/ {fmtUsd(crc, rate)}</span>
    </span>
  )
}

function ItemPanel({ r, moves, onClose, say }: { r: CargoRow; moves: Move[]; onClose: () => void; say: (t: string, warn?: boolean) => void }) {
  const { store, prices, prefs } = useCargo()
  const { sound } = useApp()
  const { item } = r
  const [qty, setQty] = useState('')
  const [useQty, setUseQty] = useState('')
  const [count, setCountText] = useState('')
  const [price, setPrice] = useState('')
  const [cur, setCur] = useState<'CRC' | 'USD'>('CRC')
  const [supplier, setSupplier] = useState('')
  const planned = !!r.plan
  const hist = priceHistory(item.id, prices)
  const mine = moves.filter((m) => m.item_id === item.id).sort((a, b) => b.moved_at.localeCompare(a.moved_at))

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      sound.confirm()
      say(ok)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const patch = (p: Partial<Item>) => run(() => store.put('items', { ...item, ...p }), `${item.name.toUpperCase()} SAVED`)
  const crcFromInput = (): number | null => {
    const p = num(price.replace(',', '.'))
    if (p === null) return null
    return cur === 'USD' ? p * prefs.fx : p
  }

  const doReceive = () => {
    const q = num(qty.replace(',', '.'))
    if (q === null || q <= 0) return say('ENTER HOW MANY CAME IN.', true)
    const p = crcFromInput()
    if (price.trim() && (p === null || p < 0)) return say('PRICE IS NOT A NUMBER.', true)
    void run(async () => {
      await receive(store, item.id, q, p, supplier.trim() || item.supplier)
      setQty('')
      setPrice('')
    }, `RECEIVED ${fmtQty(q)} ${item.unit.toUpperCase()}`)
  }
  const doUse = () => {
    const q = num(useQty.replace(',', '.'))
    if (q === null || q <= 0) return say('ENTER HOW MANY WERE USED.', true)
    void run(async () => {
      await store.put('stock_moves', newMove(item.id, -q, 'use'))
      setUseQty('')
    }, `USED ${fmtQty(q)} ${item.unit.toUpperCase()}`)
  }
  const doCount = () => {
    const q = num(count.replace(',', '.'))
    if (q === null || q < 0) return say('ENTER THE COUNT YOU SEE ON THE SHELF.', true)
    void run(async () => {
      await setCount(store, item.id, r.onHand, q)
      setCountText('')
    }, `COUNT SET TO ${fmtQty(q)} ${item.unit.toUpperCase()}`)
  }
  const doPrice = () => {
    const p = crcFromInput()
    if (p === null || p < 0) return say('ENTER A PRICE PER ' + item.unit.toUpperCase() + '.', true)
    void run(async () => {
      await addPrice(store, item.id, p, supplier.trim() || item.supplier)
      setPrice('')
    }, 'PRICE LOGGED')
  }

  return (
    <div className="cg-panel">
      <div className="cg-panel-head">
        <span className="rr-name">{item.name.toUpperCase()}</span>
        <button type="button" className="btn" onClick={onClose}>CLOSE</button>
      </div>
      <div className="dim tiny">
        {r.counted ? `ON HAND ${fmtQty(r.onHand)} ${item.unit}` : 'NOT COUNTED YET'}
        {r.use ? ` // USE ${fmtQty(r.use.perWeek)} ${item.unit} A WEEK (${r.use.source})` : ' // NO WEEKLY USE YET'}
        {r.weeks !== null ? ` // ${fmtWeeks(r.weeks)} WEEKS LEFT` : ''}
      </div>
      {r.plan && <div className="dim tiny">PLAN BASIS: <RefText text={r.plan.basis} />.</div>}
      {item.notes && <div className="dim tiny">NOTE: <RefText text={item.notes} /></div>}

      <div className="cg-actions">
        <div className="cg-act">
          <div className="cg-act-t">RECEIVE DELIVERY</div>
          <input aria-label="Quantity received" inputMode="decimal" placeholder={`QTY (${item.unit})`} value={qty} onChange={(e) => setQty(e.target.value)} />
          <span className="cg-price">
            <input aria-label="Price per unit" inputMode="decimal" placeholder={`PRICE PER ${item.unit.toUpperCase()}`} value={price} onChange={(e) => setPrice(e.target.value)} />
            <Select aria-label="Currency" value={cur} onChange={(e) => setCur(e.target.value as 'CRC' | 'USD')}>
              <option value="CRC">₡</option>
              <option value="USD">US$</option>
            </Select>
          </span>
          <input aria-label="Supplier for this delivery" placeholder={item.supplier ? `SUPPLIER (${item.supplier})` : 'SUPPLIER'} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          <span className="cg-btns">
            <button type="button" className="btn" onClick={doReceive}>BOOK DELIVERY</button>
            <button type="button" className="btn" onClick={doPrice} title="Log a price without a delivery">PRICE ONLY</button>
          </span>
        </div>
        <div className="cg-act">
          <div className="cg-act-t">RECORD USE</div>
          <input aria-label="Quantity used" inputMode="decimal" placeholder={`QTY (${item.unit})`} value={useQty} onChange={(e) => setUseQty(e.target.value)} />
          <button type="button" className="btn" onClick={doUse}>BOOK USE</button>
          <div className="cg-act-t" style={{ marginTop: 8 }}>SET COUNT</div>
          <input aria-label="Counted quantity" inputMode="decimal" placeholder={`WHAT IS ON THE SHELF (${item.unit})`} value={count} onChange={(e) => setCountText(e.target.value)} />
          <button type="button" className="btn" onClick={doCount}>SAVE COUNT</button>
        </div>
      </div>

      <div className="section-title rr-sec">ABOUT THIS ITEM</div>
      <div className="cg-fields">
        <Field label="NAME" value={item.name} wide onSave={(v) => v && void patch({ name: v })} />
        <Field label={planned ? 'UNIT (FIXED: THE RUN PLAN USES IT)' : 'UNIT'} value={item.unit} disabled={planned} onSave={(v) => v && void patch({ unit: v })} />
        <Field label={`REORDER AT (${item.unit})`} value={item.reorder_point === null ? '' : String(item.reorder_point)} inputMode="decimal" placeholder="NOT SET" onSave={(v) => void patch({ reorder_point: num(v.replace(',', '.')) })} />
        <Field label="LEAD TIME (DAYS)" value={item.lead_time_days === null ? '' : String(item.lead_time_days)} inputMode="numeric" placeholder="NOT SET" onSave={(v) => void patch({ lead_time_days: num(v) === null ? null : Math.round(num(v)!) })} />
        <Field label={`WEEKLY USE (${item.unit}), OVERRIDES PLAN`} value={item.use_per_week === null ? '' : String(item.use_per_week)} inputMode="decimal" placeholder={r.plan ? 'FROM RUN PLAN' : 'FROM HISTORY'} onSave={(v) => void patch({ use_per_week: num(v.replace(',', '.')) })} />
        <Field label="SUPPLIER" value={item.supplier ?? ''} wide placeholder="NOT SET" onSave={(v) => void patch({ supplier: v || null })} />
        <label className="cg-field">
          <span>ROOM</span>
          <Select value={item.room ?? ''} onChange={(e) => void patch({ room: (e.target.value || null) as RoomId | null })}>
            <option value="">NONE</option>
            {ROOMS.map((room) => (
              <option key={room.id} value={room.id}>{room.name}{room.nameGuess ? ' (UNCONFIRMED NAME)' : ''}</option>
            ))}
          </Select>
        </label>
        <label className="cg-field">
          <span>CATEGORY</span>
          <Select value={item.category ?? ''} onChange={(e) => void patch({ category: e.target.value || null })}>
            <option value="">OTHER</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </label>
        <Field label="NOTES" value={item.notes ?? ''} wide placeholder="NONE" onSave={(v) => void patch({ notes: v || null })} />
      </div>

      <div className="section-title rr-sec">PRICE HISTORY // PER {item.unit.toUpperCase()}</div>
      {hist.length === 0 ? (
        <div className="dim tiny">NO PRICES YET. ENTER A PRICE WITH A DELIVERY, OR USE PRICE ONLY.</div>
      ) : (
        <table className="pl-table">
          <thead><tr><th>DATE</th><th>PRICE</th><th>CHANGE</th><th>SUPPLIER</th></tr></thead>
          <tbody>
            {hist.slice(0, 8).map((p, i) => {
              const prev = hist[i + 1]
              const d = prev ? ((p.price_crc - prev.price_crc) / prev.price_crc) * 100 : null
              return (
                <tr key={p.id}>
                  <td>{p.priced_on}</td>
                  <td><Money crc={p.price_crc} fx={prefs.fx} day={p.priced_on} /></td>
                  <td className={d !== null && d > 0 ? 'warn' : ''}>{d === null ? '--' : `${d > 0 ? '+' : ''}${d.toFixed(0)}%`}</td>
                  <td>{p.supplier ?? '--'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="section-title rr-sec">MOVES</div>
      {mine.length === 0 ? (
        <div className="dim tiny">NO MOVES YET.</div>
      ) : (
        <table className="pl-table">
          <thead><tr><th>WHEN</th><th>QTY</th><th>WHY</th><th /></tr></thead>
          <tbody>
            {mine.slice(0, 8).map((m) => (
              <tr key={m.id}>
                <td>{m.moved_at.slice(0, 16).replace('T', ' ')}</td>
                <td className={Number(m.qty) < 0 ? 'warn' : ''}>{Number(m.qty) > 0 ? '+' : ''}{fmtQty(Number(m.qty))}</td>
                <td>{(m.reason ?? '').toUpperCase()}{m.run_ref ? ` ${m.run_ref}` : ''}</td>
                <td><Confirm label="DELETE" onYes={() => void run(() => store.del('stock_moves', m.id), 'MOVE DELETED')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mine.length > 8 && <div className="dim tiny">SHOWING THE LATEST 8 OF {mine.length}.</div>}

      <div style={{ marginTop: 12 }}>
        <Confirm label="DELETE ITEM AND ITS HISTORY" onYes={() => void run(async () => { await removeItem(store, item.id); onClose() }, 'ITEM DELETED')} />
      </div>
    </div>
  )
}

export function Cargo({ onOpenSequence }: { onOpenSequence: () => void }) {
  const { sound } = useApp()
  const { store, rows, moves, plan, prefs, setPrefs } = useCargo()
  const { status, kind, note, error } = useStoreStatus()
  const [openId, setOpenId] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ t: string; warn?: boolean; id: number } | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [nu, setNu] = useState({ name: '', unit: '', category: '' })
  const file = useRef<HTMLInputElement>(null)
  const say = (t: string, warn?: boolean) => setMsg({ t, warn, id: Date.now() })

  const low = rows.filter((r) => r.state === 'LOW' || r.state === 'OUT')
  const uncounted = rows.filter((r) => !r.counted).length
  const noRp = rows.filter((r) => r.item.reorder_point === null).length
  const runs = [...new Set(moves.map((m) => m.run_ref).filter((x): x is string => !!x))].sort().reverse()
  const modeText = kind === 'local' ? 'LOCAL (THIS BROWSER ONLY)' : kind === 'remote' ? 'DATABASE LINKED' : kind === 'locked' ? 'DATABASE LOCKED' : 'NOT SAVED'

  const guard = async (fn: () => Promise<string>) => {
    try {
      const t = await fn()
      sound.confirm()
      say(t)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }

  const exportFile = () =>
    void guard(async () => {
      const text = await store.exportJson()
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mycol-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      return 'BACKUP FILE SAVED TO YOUR DOWNLOADS'
    })
  const importFile = (f: File | undefined) =>
    f &&
    void guard(async () => {
      const counts = await store.importJson(await f.text())
      const n = Object.values(counts).reduce((a, b) => a + b, 0)
      return `IMPORTED ${n} ROWS (${Object.entries(counts).map(([t, c]) => `${t.toUpperCase()} ${c}`).join(', ') || 'NOTHING'})`
    })
  const addItem = () => {
    if (!nu.name.trim() || !nu.unit.trim()) return say('AN ITEM NEEDS A NAME AND A UNIT (KG, BAGS, BOXES).', true)
    void guard(async () => {
      const it = newItem({ name: nu.name.trim(), unit: nu.unit.trim(), category: nu.category || null })
      await store.put('items', it)
      setNu({ name: '', unit: '', category: '' })
      setShowAdd(false)
      setOpenId(it.id)
      return `${it.name.toUpperCase()} ADDED`
    })
  }

  const groups = [...CATEGORIES, 'OTHER'].map((c) => ({ c, list: rows.filter((r) => (r.item.category ?? 'OTHER') === c || (c === 'OTHER' && !CATEGORIES.includes((r.item.category ?? '') as never))) })).filter((g) => g.list.length)
  const opened = rows.find((r) => r.item.id === openId)

  const Line = ({ r, compact }: { r: CargoRow; compact?: boolean }) => (
    <button type="button" id={`cg-${r.item.id}`} className={`cg-row ${r.state === 'LOW' || r.state === 'OUT' ? 'low' : ''} ${openId === r.item.id ? 'sel' : ''}`} onClick={() => (sound.chirp(), setOpenId(openId === r.item.id ? null : r.item.id))}>
      <span className="cg-name">{r.item.name}</span>
      {!compact && <StockMeter r={r} />}
      <span className="cg-qty">{r.counted ? `${fmtQty(r.onHand)} ${r.item.unit}` : '--'}</span>
      <span className="cg-wk">{r.weeks === null ? '--' : `${fmtWeeks(r.weeks)} WK`}</span>
      <span className={`cg-state ${STATE_TONE[r.state]}`}>{r.state}</span>
    </button>
  )

  const Panel = (): ReactNode => (opened ? <ItemPanel key={opened.item.id} r={opened} moves={moves} onClose={() => setOpenId(null)} say={say} /> : null)

  return (
    <div className="cargo">
      <div className="section-title">CARGO // STOCK MANIFEST</div>
      <TypeText group={3} className="dim" lines={['EVERY COUNT IS THE SUM OF ITS MOVES: DELIVERIES IN, USES OUT. TAP AN ITEM TO RECORD ONE.']} />
      <div className="cg-status tiny">
        <span>STORAGE <b className={kind === 'locked' || kind === 'memory' ? 'warn' : ''}>{modeText}</b></span>
        <span>{rows.length} ITEMS</span>
        <span className={low.length ? 'warn' : ''}>{low.length} TO REORDER</span>
        <span>{uncounted} NOT COUNTED</span>
        <span>
          TODAY ₡
          <input className="cg-fx" aria-label="Colones per US dollar" inputMode="decimal" defaultValue={prefs.fx} key={prefs.fx} onBlur={(e) => { const v = num(e.target.value); if (v && v > 0) setPrefs({ fx: v }) }} />
          = US$1
        </span>
      </div>
      {(note || error || status === 'stale') && <div className="warn tiny">{error ?? note}</div>}
      {kind === 'local' && <div className="dim tiny">LOCAL MODE: THESE COUNTS LIVE IN THIS BROWSER ONLY. EXPORT A BACKUP OFTEN. THE PHONE AND THE LAPTOP DO NOT SHARE THEM UNTIL SUPABASE IS LINKED.</div>}

      <div className="cg-tools">
        <button type="button" className="btn" onClick={() => (sound.chirp(), setShowAdd((s) => !s))}>ADD ITEM</button>
        <button type="button" className="btn" onClick={exportFile}>EXPORT BACKUP</button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>IMPORT BACKUP</button>
        <button type="button" className="btn" onClick={() => void guard(async () => { const n = await seedStarter(store, true); return n ? `ADDED ${n} STARTER ITEMS` : 'ALL STARTER ITEMS ARE ALREADY HERE' })}>RESTORE STARTER LIST</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {msg && <TypeText key={msg.id} className={msg.warn ? 'warn' : ''} lines={[msg.t]} />}

      {showAdd && (
        <div className="cg-add">
          <input aria-label="Item name" placeholder="ITEM NAME" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <input aria-label="Unit" placeholder="UNIT (KG, BAGS)" value={nu.unit} onChange={(e) => setNu({ ...nu, unit: e.target.value })} />
          <Select aria-label="Category" value={nu.category} onChange={(e) => setNu({ ...nu, category: e.target.value })}>
            <option value="">OTHER</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <button type="button" className="btn on" onClick={addItem}>ADD</button>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 14 }}>REORDER</div>
      {low.length === 0 ? (
        <div className="dim tiny">
          NOTHING TO REORDER.{noRp === rows.length && rows.length > 0 ? ' NO REORDER POINTS ARE SET YET: OPEN AN ITEM AND TYPE ONE, THEN THIS LIST WORKS.' : ''}
        </div>
      ) : (
        <table className="pl-table cg-reorder">
          <thead><tr><th>ITEM</th><th>ON HAND</th><th>REORDER AT</th><th>WEEKS</th><th>LEAD</th><th>SUPPLIER</th><th>LAST PRICE</th></tr></thead>
          <tbody>
            {low.map((r) => (
              <tr tabIndex={0} key={r.item.id} className="warn" onClick={() => (setOpenId(r.item.id), document.getElementById(`cg-${r.item.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}>
                <td>{r.item.name}</td>
                <td>{fmtQty(r.onHand)} {r.item.unit}</td>
                <td>{r.item.reorder_point === null ? '--' : fmtQty(r.item.reorder_point)}</td>
                <td>{fmtWeeks(r.weeks)}</td>
                <td>{r.item.lead_time_days === null ? '--' : `${r.item.lead_time_days} D`}</td>
                <td>{r.item.supplier ?? '--'}</td>
                <td>{r.last ? <Money crc={r.last.price_crc} fx={prefs.fx} day={r.last.priced_on} /> : '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title" style={{ marginTop: 14 }}>WEEKLY USE FROM THE RUN PLAN // {WEEKLY_BAGS} BAGS</div>
      <div className="cg-plan">
        <label className="cg-field inline">
          <span>SUBSTRATE COMES AS</span>
          <Select value={prefs.form} onChange={(e) => setPrefs({ form: e.target.value as 'separate' | 'combo' })}>
            <option value="separate">SAWDUST + SOY HULLS</option>
            <option value="combo">COMBO PELLETS 50:50</option>
          </Select>
        </label>
        {prefs.form === 'separate' && (
          <label className="cg-field inline">
            <span>SOY HULL SHARE %</span>
            <input inputMode="numeric" defaultValue={Math.round(prefs.soyShare * 100)} key={prefs.soyShare} onBlur={(e) => { const v = num(e.target.value); if (v !== null) setPrefs({ soyShare: Math.min(50, Math.max(0, v)) / 100 }) }} />
          </label>
        )}
        {prefs.form === 'separate' && (
          <div className="cg-field inline cg-mix">
            <span>MIX SAWDUST : SOY</span>
            {[[0.4, '60:40', 'HOT, HUMID SITE START (TEXTBOOK T25)'], [0.45, '55:45', 'CATAWBA\'S MIDDLE OPTION'], [0.5, '50:50', "CAP N STEM'S MASTER'S MIX"]].map(([v, l, t]) => (
              <button key={l as string} type="button" title={t as string} className={`btn${Math.abs(prefs.soyShare - (v as number)) < 0.001 ? ' on' : ''}`} aria-pressed={Math.abs(prefs.soyShare - (v as number)) < 0.001} onClick={() => setPrefs({ soyShare: v as number })}>{l as string}</button>
            ))}
            <span className="dim tiny">OR TYPE ANY SOY % (0-50) IN THE BOX. 60:40 IS THE DEFAULT FOR A HOT, HUMID SITE; RAISE SOY ONLY IF INCUBATION HEAT AND BLOTCH STAY UNDER CONTROL.</span>
          </div>
        )}
      </div>
      <table className="pl-table">
        <thead><tr><th>ITEM</th><th>PER WEEK</th><th>HOW IT IS WORKED OUT</th></tr></thead>
        <tbody>
          {[...plan.values()].map((l) => {
            const it = rows.find((r) => r.item.code === l.code)
            return (
              <tr key={l.code}>
                <td>{it?.item.name ?? l.code}</td>
                <td>{fmtQty(l.qty)} {l.unit}</td>
                <td className="cg-basis"><RefText text={l.basis} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="dim tiny">
        F-NUMBERS ARE FACT IDS IN THE ZERO TO PRO TEXTBOOK. A 10 LB BLOCK IS 4 LB DRY AND 6 LB WATER; 3.3 LB DRY IS ALSO QUOTED. STEAM NEEDS NO STOCK. TO BOOK A WEEK'S RUN AGAINST THESE COUNTS, USE COMMIT RUN IN{' '}
        <button type="button" className="why" onClick={onOpenSequence}>PRODUCTION SEQUENCE</button>
      </div>

      <div className="section-title" style={{ marginTop: 14 }}>STOCK</div>
      <div className="cg-head tiny dim" aria-hidden>
        <span>ITEM</span><span>LEVEL // TICK = REORDER</span><span>ON HAND</span><span>LEFT</span><span>STATE</span>
      </div>
      {groups.map((g) => (
        <section key={g.c} id={`cgcat-${g.c.replace(/\W+/g, '-')}`}>
          <div className="cg-cat">{g.c}</div>
          {g.list.map((r) => (
            <div key={r.item.id}>
              <Line r={r} />
              {openId === r.item.id && <Panel />}
            </div>
          ))}
        </section>
      ))}
      {rows.length === 0 && <div className="dim">{status === 'loading' ? 'LOADING...' : 'NO ITEMS. ADD ONE, OR RESTORE THE STARTER LIST.'}</div>}

      {runs.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 14 }}>RUNS BOOKED</div>
          <table className="pl-table">
            <thead><tr><th>RUN</th><th>MOVES</th><th>BOOKED</th><th /></tr></thead>
            <tbody>
              {runs.slice(0, 6).map((ref) => {
                const ms = moves.filter((m) => m.run_ref === ref)
                return (
                  <tr key={ref}>
                    <td>{ref}</td>
                    <td>{ms.length}</td>
                    <td>{ms[0]?.moved_at.slice(0, 16).replace('T', ' ')}</td>
                    <td><Confirm label="UNDO RUN" onYes={() => void guard(async () => { await undoRun(store, ref); return `${ref} UNDONE` })} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      <div className="dim tiny" style={{ marginTop: 10 }}>
        STARTER ITEMS COME FROM YOUR OWN FILES. COUNTS, REORDER POINTS, LEAD TIMES AND PRICES START EMPTY BECAUSE NO SOURCE STATES THEM FOR THIS SITE. ROOMS ARE A STARTING GUESS: CHANGE THEM ON EACH ITEM. SUPPLIERS ARE ONLY FILLED WHERE TEXTBOOK CHAPTER T23 NAMES ONE, AND MOST OF THOSE ARE IN THE US. CHECK SHIPPING AND DUTY.
      </div>
    </div>
  )
}

/** Right-hand index for CARGO: reorder count, then each category with its item count. */
export function CargoIndex() {
  const { rows } = useCargo()
  const { sound } = useApp()
  const low = rows.filter((r) => r.state === 'LOW' || r.state === 'OUT').length
  const cats = [...CATEGORIES, 'OTHER']
  return (
    <>
      <div className="section-title">CARGO</div>
      <ul className="index-list">
        <li tabIndex={0} onClick={() => (sound.chirp(), document.querySelector('.cargo')?.scrollIntoView({ behavior: 'smooth' }))}>
          <span>REORDER</span>
          <span className={low ? 'k warn' : 'k'}>{low}</span>
        </li>
        {cats.map((c) => {
          const n = rows.filter((r) => (r.item.category ?? 'OTHER') === c || (c === 'OTHER' && !CATEGORIES.includes((r.item.category ?? '') as never))).length
          if (!n) return null
          return (
            <li tabIndex={0} key={c} onClick={() => (sound.chirp(), document.getElementById(`cgcat-${c.replace(/\W+/g, '-')}`)?.scrollIntoView({ behavior: 'smooth' }))}>
              <span>{c}</span>
              <span className="k">{n}</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
