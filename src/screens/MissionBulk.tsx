import { useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HazardPick } from '../components/HazardPick'
import { SPECIES } from '../data/species'
import { GRADES } from '../data/ledger'
import { speciesName } from '../store/useLedger'
import { hazardName } from '../lib/hazard'
import { nextFlush } from '../lib/mission'
import { addDays, todayIso, type BlockLot, type LotStatus } from '../lib/xeno'
import { planSplit, ROOM_CHOICES, roomName, speciesLabel, survivors } from '../lib/records'
import { bulkLots, harvestSession, inoculateCart, splitLot, cleanCart, type CartLine } from '../lib/recordsActions'
import { expectFor } from '../lib/mission'
import { useRecords } from '../store/useRecords'
import { Confirm, Guess } from './CookParts'
import type { BoardRow } from '../lib/mission'

// MISSION CONTROL > BULK: many lots in one go. Every button here is ONE undo step.

type Say = (t: string, warn?: boolean) => void
export type BulkMode = 'HARVEST' | 'CART' | 'STATUS' | 'SPLIT'
export const BULK_MODES: BulkMode[] = ['HARVEST', 'CART', 'STATUS', 'SPLIT']
const MODE_LABEL: Record<BulkMode, string> = { HARVEST: 'HARVEST SESSION', CART: 'INOCULATE A CART', STATUS: 'CHANGE MANY LOTS', SPLIT: 'SPLIT A LOT' }

const INITIALS_KEY = 'mycol.initials.v1'
const getInitials = () => {
  try {
    return localStorage.getItem(INITIALS_KEY) ?? ''
  } catch {
    return ''
  }
}
const num = (s: string): number | null => {
  const n = Number(s.replace(/[,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}
const kg1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

interface MLike {
  rows: BoardRow[]
  cultures: unknown[]
  grain: import('../lib/xeno').GrainRun[]
  strains: import('../lib/xeno').Strain[]
  cook: import('../lib/cook').CookRun[]
  lots: BlockLot[]
  losses: import('../lib/hazard').LotLoss[]
  harvests: import('../lib/ledger').Harvest[]
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

export function Bulk({ m, mode, setMode, say }: { m: MLike; mode: BulkMode; setMode: (b: BulkMode) => void; say: Say }) {
  const { t: tt } = useT()
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">{tt('BULK ACTIONS // EACH BUTTON IS ONE UNDO')}</div>
        <div className="lg-btns" role="tablist">
          {BULK_MODES.map((b) => <button key={b} type="button" role="tab" aria-selected={mode === b} className={`btn ${mode === b ? 'on' : ''}`} onClick={() => setMode(b)}>{tt(MODE_LABEL[b])}</button>)}
        </div>
      </div>
      {mode === 'HARVEST' && <HarvestSession m={m} say={say} />}
      {mode === 'CART' && <InoculateCart m={m} say={say} />}
      {mode === 'STATUS' && <ChangeMany m={m} say={say} />}
      {mode === 'SPLIT' && <SplitForm m={m} say={say} />}
    </div>
  )
}

// ---------- harvest session ----------

export function HarvestSession({ m, say, only }: { m: MLike; say: Say; only?: string[] }) {
  const store = useStore()
  const { t: tt, tf } = useT()
  const run = useRun(say)
  const [day, setDay] = useState(todayIso())
  const [by, setBy] = useState(getInitials)
  const [grade, setGrade] = useState<string>('A')
  const [kg, setKg] = useState<Record<string, string>>({})
  const [fl, setFl] = useState<Record<string, string>>({})
  const [room, setRoom] = useState('')
  const rows = useMemo(
    () => m.rows.filter((r) => (!only || only.includes(r.lot.id)) && (!room || (r.lot.room ?? '') === room)).sort((a, b) => Number(b.lot.status === 'fruiting') - Number(a.lot.status === 'fruiting') || a.lot.lot_code.localeCompare(b.lot.lot_code)),
    [m.rows, only, room],
  )
  const entries = rows.map((r) => ({ r, k: num(kg[r.lot.id] ?? '') ?? 0, f: num(fl[r.lot.id] ?? '') ?? nextFlush(m.harvests, r.lot.id) })).filter((e) => e.k > 0)
  const total = entries.reduce((n, e) => n + e.k, 0)

  const save = async () => {
    const ok = await run(
      () => harvestSession(store, { day, initials: by, rows: entries.map((e) => ({ lot: e.r.lot, kg: e.k, flush: Math.floor(e.f), grade })) }),
      tf('HARVEST SESSION // {n} LOTS // {kg} KG', { n: entries.length, kg: kg1(total) }),
    )
    if (ok) {
      try {
        localStorage.setItem(INITIALS_KEY, by.trim().toUpperCase())
      } catch {
        /* blocked */
      }
      setKg({})
      setFl({})
    }
  }
  return (
    <div className="ck-box">
      <div className="section-title">{tt('HARVEST SESSION // TYPE THE KG FOR EACH LOT PICKED, THEN SAVE ONCE')}</div>
      <div className="dim tiny">{tt('FL = WHICH PICKING OF THE LOT (1 = FIRST). GRADE A IS THE NORMAL SALE GRADE. LEAVE A LOT BLANK IF YOU DID NOT PICK IT. THE SAVE BUTTON IS AT THE BOTTOM OF THE LIST.')}</div>
      {!m.rows.length ? (
        <div className="dim">{tt('NO ACTIVE LOTS.')}</div>
      ) : (
        <>
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>{tt('DAY')}</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value || todayIso())} /></label>
            <label className="ck-field"><span>{tt('INITIALS')}</span><input value={by} maxLength={4} onChange={(e) => setBy(e.target.value.toUpperCase())} /></label>
            {!only && (
              <label className="ck-field">
                <span>{tt('ONLY ROOM')}</span>
                <Select value={room} onChange={(e) => setRoom(e.target.value)}>
                  <option value="">{tt('ALL ROOMS')}</option>
                  {ROOM_CHOICES.filter((r) => r.id === 'incubation' || r.id === 'fruiting').map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </label>
            )}
          </div>
          <div className="ck-field">
            <span>{tt('GRADE FOR THIS SESSION')} <Guess /></span>
            <div className="lg-btns">{GRADES.map((g) => <button key={g} type="button" className={`btn ${grade === g ? 'on' : ''}`} onClick={() => setGrade(g)}>{g}</button>)}</div>
          </div>
          <div className="rc-wrap">
            <table className="lg-table rc-table rc-input">
              <thead><tr><th>{tt('LOT')}</th><th>{tt('NOW')}</th><th>FL</th><th>{tt('KG PICKED')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lot.id}>
                    <td>{r.lot.lot_code}</td>
                    <td>{tt(r.lot.status === 'fruiting' ? 'FRUIT' : 'INCUB')}</td>
                    <td><input aria-label={`Flush for ${r.lot.lot_code}`} inputMode="numeric" value={fl[r.lot.id] ?? ''} placeholder={String(nextFlush(m.harvests, r.lot.id))} onChange={(e) => setFl({ ...fl, [r.lot.id]: e.target.value })} /></td>
                    <td><input aria-label={`Kg for ${r.lot.lot_code}`} inputMode="decimal" value={kg[r.lot.id] ?? ''} placeholder="0.0" onChange={(e) => setKg({ ...kg, [r.lot.id]: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dim">{tf('{n} LOTS // {kg} KG TO SAVE.', { n: entries.length, kg: kg1(total) })} {tt('A LOT STILL INCUBATING MOVES TO FRUITING ON THE DAY OF ITS FIRST PICK.')}</div>
          <button type="button" className="btn on" disabled={!entries.length} onClick={() => void save()}>{tt('SAVE SESSION')}</button>
        </>
      )}
    </div>
  )
}

// ---------- inoculate a cart ----------

interface LineDraft {
  key: number
  species: string
  strainId: string
  grainId: string
  blocks: string
}

export function InoculateCart({ m, say }: { m: MLike; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const r = useRecords()
  const species = useMemo(() => SPECIES.filter((s) => s.cat || s.plan), [])
  const nextCart = useMemo(() => {
    const used = m.lots.map((l) => /^C-(\d+)$/.exec((l.cart ?? '').toUpperCase())).filter(Boolean).map((x) => Number(x![1]))
    return `C-${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`
  }, [m.lots])
  const [cart, setCart] = useState('')
  const [knock, setKnock] = useState(todayIso())
  const [by, setBy] = useState(getInitials)
  const [cookId, setCookId] = useState('')
  const [room, setRoom] = useState('incubation')
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, species: 'blue-oyster', strainId: '', grainId: '', blocks: '' }])
  const cooks = useMemo(() => [...m.cook].sort((a, b) => (b.started_at ?? b.created_at ?? '').localeCompare(a.started_at ?? a.created_at ?? '')).slice(0, 15), [m.cook])
  const upd = (key: number, p: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)))
  const total = lines.reduce((n, l) => n + (num(l.blocks) ?? 0), 0)
  const name = cleanCart(cart || nextCart)
  const sameCart = m.lots.filter((l) => (l.cart ?? '').toUpperCase() === name && (l.status === 'incubating' || l.status === 'fruiting'))

  const save = async () => {
    const cl: CartLine[] = lines.map((l) => ({ species: l.species, strainId: l.strainId || null, grainId: l.grainId || null, blocks: num(l.blocks) ?? 0 }))
    let made: BlockLot[] = []
    const ok = await run(async () => {
      made = await inoculateCart(store, { cart: name ?? '', knock, by, cookId: cookId || null, room, lines: cl, lots: m.lots, strains: m.strains, grain: m.grain })
    }, `CART ${name} INOCULATED // ${total} BLOCKS`)
    if (ok) {
      try {
        localStorage.setItem(INITIALS_KEY, by.trim().toUpperCase())
      } catch {
        /* blocked */
      }
      say(`CART ${name} // ${made.map((l) => `${l.lot_code} x${l.bag_count}`).join(', ')}`)
      setLines([{ key: Date.now(), species: 'blue-oyster', strainId: '', grainId: '', blocks: '' }])
      setCart('')
    }
  }

  return (
    <div className="ck-box">
      <div className="section-title">INOCULATE A CART // ONE LOT PER LINE, ALL ON THE SAME CART</div>
      <div className="dim tiny">A CART IS ONE TROLLEY OF BLOCKS THAT MOVES TOGETHER. GIVE IT A NAME, PRINT ITS TAG, AND SCAN THE TAG LATER TO SEE EVERY LOT ON IT.</div>
      <div className="ck-fields">
        <label className="ck-field"><span>CART NAME</span><input value={cart} placeholder={nextCart} maxLength={20} onChange={(e) => setCart(e.target.value.toUpperCase())} /><em className={sameCart.length ? 'lg-warn-text' : ''}>{sameCart.length ? `CART HAS ${sameCart.length} LOTS ALREADY` : 'NAME ON THE CART TAG / QR'}</em></label>
        <label className="ck-field"><span>KNOCK DAY</span><PickInput type="date" value={knock} onChange={(e) => setKnock(e.target.value || todayIso())} /></label>
        <label className="ck-field"><span>INITIALS (KNOCKED BY)</span><input value={by} maxLength={4} onChange={(e) => setBy(e.target.value.toUpperCase())} /></label>
        <label className="ck-field">
          <span>COOK RUN (STEAM)</span>
          <Select value={cookId} onChange={(e) => setCookId(e.target.value)}>
            <option value="">NOT SET</option>
            {cooks.map((c) => <option key={c.id} value={c.id}>{(c.started_at ?? c.created_at ?? '').slice(0, 10)} {c.unit_label ?? c.kind.toUpperCase()}{c.bag_count ? ` // ${c.bag_count} BAGS` : ''}</option>)}
          </Select>
        </label>
        <label className="ck-field">
          <span>ROOM</span>
          <Select value={room} onChange={(e) => setRoom(e.target.value)}>
            {ROOM_CHOICES.filter((x) => x.id === 'incubation' || x.id === 'fruiting').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </label>
      </div>
      {lines.map((l, i) => {
        const strains = m.strains.filter((s) => s.species_key === l.species && s.active !== false)
        const grain = m.grain.filter((g) => g.generation === 'G2' && (l.strainId ? g.strain_id === l.strainId : strains.some((s) => s.id === g.strain_id)) && !['used_up', 'discarded', 'contaminated'].includes(g.status))
        return (
          <div key={l.key} className="rc-line">
            <div className="section-title">LINE {i + 1}</div>
            <div className="ck-fields">
              <label className="ck-field">
                <span>SPECIES</span>
                <Select value={l.species} onChange={(e) => upd(l.key, { species: e.target.value, strainId: '', grainId: '' })}>
                  {species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </label>
              <label className="ck-field">
                <span>STRAIN</span>
                <Select value={l.strainId} onChange={(e) => upd(l.key, { strainId: e.target.value, grainId: '' })}>
                  <option value="">NOT SET</option>
                  {strains.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` ${s.name}` : ''}</option>)}
                </Select>
              </label>
              <label className="ck-field">
                <span>GRAIN RUN (G2)</span>
                <Select value={l.grainId} onChange={(e) => upd(l.key, { grainId: e.target.value })}>
                  <option value="">NOT SET</option>
                  {grain.map((g) => <option key={g.id} value={g.id}>{g.label ?? `G2 ${g.inoculated_on}`} // {g.bag_count - (g.bags_lost || 0)} BAGS</option>)}
                </Select>
              </label>
              <label className="ck-field"><span>BLOCKS</span><input inputMode="numeric" value={l.blocks} placeholder="0" onChange={(e) => upd(l.key, { blocks: e.target.value })} /></label>
            </div>
            {lines.length > 1 && <button type="button" className="btn" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>REMOVE LINE {i + 1}</button>}
          </div>
        )
      })}
      <div className="lg-btns">
        <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { key: Date.now(), species: ls[ls.length - 1]?.species ?? 'blue-oyster', strainId: '', grainId: '', blocks: '' }])}>ADD A LINE</button>
      </div>
      <div className="dim">
        {total} BLOCKS ON {name}. MOVE FROM {addDays(knock, expectFor(lines[0]?.species ?? 'blue-oyster').moveOpen)} (FIRST LINE){r.trials.some((t) => t.status === 'running') ? '. ADD THE LOTS TO A STRAIN TRIAL IN PRODUCTION RECORDS.' : '.'}
      </div>
      <button type="button" className="btn on" disabled={total <= 0} onClick={() => void save()}>INOCULATE CART</button>
    </div>
  )
}

// ---------- change many lots ----------

type Act = 'FRUIT' | 'SPENT' | 'LOST' | 'ROOM' | 'CART' | 'TRIAL'
const ACTS: { id: Act; label: string }[] = [
  { id: 'FRUIT', label: 'MOVE TO FRUITING' },
  { id: 'SPENT', label: 'MARK SPENT' },
  { id: 'LOST', label: 'MARK LOST' },
  { id: 'ROOM', label: 'SET ROOM' },
  { id: 'CART', label: 'SET CART' },
  { id: 'TRIAL', label: 'ADD TO TRIAL' },
]
const PAGE = 40

export function ChangeMany({ m, say, only }: { m: MLike; say: Say; only?: string[] }) {
  const store = useStore()
  const run = useRun(say)
  const r = useRecords()
  const [sp, setSp] = useState('')
  const [st, setSt] = useState<'' | LotStatus>('')
  const [cartF, setCartF] = useState('')
  const [pick, setPick] = useState<string[]>(only ?? [])
  const [act, setAct] = useState<Act>('FRUIT')
  const [room, setRoom] = useState('fruiting')
  const [cart, setCart] = useState('')
  const [trial, setTrial] = useState('')
  const [haz, setHaz] = useState('')
  const [day, setDay] = useState(todayIso())
  const [limit, setLimit] = useState(PAGE)
  const active = useMemo(() => m.lots.filter((l) => l.status === 'incubating' || l.status === 'fruiting'), [m.lots])
  const carts = useMemo(() => [...new Set(active.map((l) => (l.cart ?? '').toUpperCase()).filter(Boolean))].sort(), [active])
  const speciesKeys = useMemo(() => [...new Set(active.map((l) => l.species_key))].sort(), [active])
  const list = useMemo(
    () =>
      active
        .filter((l) => (!only || only.includes(l.id)) && (!sp || l.species_key === sp) && (!st || l.status === st) && (!cartF || (l.cart ?? '').toUpperCase() === cartF))
        .sort((a, b) => a.knock_date.localeCompare(b.knock_date) || a.lot_code.localeCompare(b.lot_code)),
    [active, only, sp, st, cartF],
  )
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const chosen = m.lots.filter((l) => pick.includes(l.id))
  const trials = r.trials.filter((t) => t.status === 'running')

  const go = async () => {
    const lots = chosen
    const label = ACTS.find((a) => a.id === act)!.label
    let ok = false
    if (act === 'FRUIT') ok = await run(() => bulkLots(store, lots, { status: 'fruiting', day }, m.losses), `${lots.length} LOTS MOVED TO FRUITING`)
    else if (act === 'SPENT') ok = await run(() => bulkLots(store, lots, { status: 'spent' }, m.losses), `${lots.length} LOTS MARKED SPENT`)
    else if (act === 'LOST') ok = await run(() => bulkLots(store, lots, { status: 'lost', hazard: haz || null }, m.losses), `${lots.length} LOTS LOST: ${hazardName(haz || null)}`)
    else if (act === 'ROOM') ok = await run(() => bulkLots(store, lots, { room }, m.losses), `${lots.length} LOTS: ROOM ${roomName(room)}`)
    else if (act === 'CART') ok = await run(() => bulkLots(store, lots, { cart: cart || null }, m.losses), `${lots.length} LOTS: CART ${cleanCart(cart) ?? 'CLEARED'}`)
    else ok = await run(() => bulkLots(store, lots, { trialId: trial || null }, m.losses), `${lots.length} LOTS ${trial ? 'ADDED TO' : 'TAKEN OUT OF'} TRIAL`)
    if (ok) setPick([])
    return label
  }
  const needsSure = act === 'SPENT' || act === 'LOST'
  const btn = `${ACTS.find((a) => a.id === act)!.label}${pick.length ? ` // ${pick.length} LOTS` : ''}`
  return (
    <div className="ck-box">
      <div className="section-title">CHANGE MANY LOTS // TICK THE LOTS, PICK THE ACTION, PRESS ONCE</div>
      {!active.length ? (
        <div className="dim">NO ACTIVE LOTS.</div>
      ) : (
        <>
          {!only && (
            <div className="ck-fields">
              <label className="ck-field">
                <span>SPECIES</span>
                <Select value={sp} onChange={(e) => (setSp(e.target.value), setLimit(PAGE))}>
                  <option value="">ALL</option>
                  {speciesKeys.map((k) => <option key={k} value={k}>{speciesLabel(k)}</option>)}
                </Select>
              </label>
              <label className="ck-field">
                <span>NOW</span>
                <Select value={st} onChange={(e) => (setSt(e.target.value as '' | LotStatus), setLimit(PAGE))}>
                  <option value="">ANY</option>
                  <option value="incubating">INCUBATING</option>
                  <option value="fruiting">FRUITING</option>
                </Select>
              </label>
              <label className="ck-field">
                <span>CART</span>
                <Select value={cartF} onChange={(e) => (setCartF(e.target.value), setLimit(PAGE))}>
                  <option value="">ALL</option>
                  {carts.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </label>
            </div>
          )}
          <div className="rc-checks">
            {list.slice(0, limit).map((l) => (
              <button key={l.id} type="button" role="checkbox" aria-checked={pick.includes(l.id)} className={`btn ${pick.includes(l.id) ? 'on' : ''}`} onClick={() => toggle(l.id)}>
                {pick.includes(l.id) ? '[X]' : '[ ]'} {l.lot_code} {l.status === 'fruiting' ? 'F' : 'I'} {survivors(l, m.losses)}B{l.cart ? ` ${l.cart}` : ''}
              </button>
            ))}
          </div>
          <div className="lg-btns">
            {list.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>SHOW MORE ({list.length - limit})</button>}
            <button type="button" className="btn" onClick={() => setPick([...new Set([...pick, ...list.map((l) => l.id)])])}>TICK ALL {list.length} SHOWN</button>
            <button type="button" className="btn" disabled={!pick.length} onClick={() => setPick([])}>CLEAR TICKS</button>
          </div>
          <div className="lg-btns" role="tablist">
            {ACTS.map((a) => <button key={a.id} type="button" role="tab" aria-selected={act === a.id} className={`btn ${act === a.id ? 'on' : ''}`} onClick={() => setAct(a.id)}>{a.label}</button>)}
          </div>
          <div className="ck-fields">
            {act === 'FRUIT' && <label className="ck-field"><span>MOVED ON</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value || todayIso())} /></label>}
            {act === 'ROOM' && (
              <label className="ck-field">
                <span>ROOM</span>
                <Select value={room} onChange={(e) => setRoom(e.target.value)}>{ROOM_CHOICES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
              </label>
            )}
            {act === 'CART' && <label className="ck-field"><span>CART NAME (BLANK = CLEAR)</span><input value={cart} maxLength={20} onChange={(e) => setCart(e.target.value.toUpperCase())} /></label>}
            {act === 'TRIAL' && (
              <label className="ck-field">
                <span>TRIAL</span>
                <Select value={trial} onChange={(e) => setTrial(e.target.value)}>
                  <option value="">NONE (TAKE OUT)</option>
                  {trials.map((t) => <option key={t.id} value={t.id}>{t.name.toUpperCase()}</option>)}
                </Select>
              </label>
            )}
            {act === 'LOST' && <label className="ck-field"><span>WHAT WAS IT (HAZARD INDEX)</span><HazardPick value={haz} onChange={setHaz} /></label>}
          </div>
          {act === 'LOST' && <div className="lg-warn-text tiny">MARK LOST LOGS EVERY LIVE BLOCK OF EACH TICKED LOT AS LOST.</div>}
          {needsSure ? <Confirm label={btn} disabled={!pick.length} onYes={() => void go()} /> : <button type="button" className="btn on" disabled={!pick.length} onClick={() => void go()}>{btn}</button>}
        </>
      )}
    </div>
  )
}

// ---------- split ----------

export function SplitForm({ m, say, lot: fixed, onDone }: { m: MLike; say: Say; lot?: BlockLot; onDone?: () => void }) {
  const store = useStore()
  const run = useRun(say)
  const [id, setId] = useState('')
  const [n, setN] = useState('')
  const [cart, setCart] = useState('')
  const [room, setRoom] = useState('')
  const pool = useMemo(() => m.lots.filter((l) => l.status === 'incubating' || l.status === 'fruiting').sort((a, b) => b.knock_date.localeCompare(a.knock_date) || a.lot_code.localeCompare(b.lot_code)), [m.lots])
  const lot = fixed ?? pool.find((l) => l.id === id) ?? pool[0]
  if (!lot) return <div className="ck-box"><div className="section-title">SPLIT A LOT</div><div className="dim">NO ACTIVE LOTS.</div></div>
  const k = num(n)
  const plan = k === null ? null : planSplit(lot, m.losses, m.harvests, m.lots, Math.floor(k))
  const save = async () => {
    if (k === null) return say('TYPE HOW MANY BLOCKS TO SPLIT OFF.', true)
    const ok = await run(
      async () => {
        const c = await splitLot(store, { lot, losses: m.losses, harvests: m.harvests, lots: m.lots, n: Math.floor(k), cart: cart.trim() ? cart : undefined, room: room || undefined })
        say(`SPLIT ${c.lot_code} (${c.bag_count} BLOCKS) OFF ${lot.lot_code}`)
      },
      `LOT ${lot.lot_code} SPLIT`,
    )
    if (ok) (setN(''), setCart(''), setRoom(''), onDone?.())
  }
  return (
    <div className="ck-box">
      <div className="section-title">SPLIT A LOT // SEND SOME BLOCKS TO ANOTHER CART OR ROOM</div>
      {!fixed && (
        <label className="ck-field">
          <span>LOT</span>
          <Select value={lot.id} onChange={(e) => setId(e.target.value)}>
            {pool.map((l) => <option key={l.id} value={l.id}>{l.lot_code} {speciesName(l.species_key)} // {survivors(l, m.losses)} BLOCKS{l.cart ? ` // ${l.cart}` : ''}</option>)}
          </Select>
        </label>
      )}
      <div className="ck-fields">
        <label className="ck-field"><span>BLOCKS TO SPLIT OFF</span><input inputMode="numeric" value={n} placeholder="0" onChange={(e) => setN(e.target.value)} /><em>{survivors(lot, m.losses)} ALIVE IN {lot.lot_code}</em></label>
        <label className="ck-field"><span>NEW CART (BLANK = SAME)</span><input value={cart} maxLength={20} onChange={(e) => setCart(e.target.value.toUpperCase())} /></label>
        <label className="ck-field">
          <span>NEW ROOM</span>
          <Select value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">SAME AS {lot.lot_code}</option>
            {ROOM_CHOICES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </label>
      </div>
      {plan && <div className={plan.ok ? 'dim' : 'lg-warn-text'}>{plan.ok ? `${plan.childCode} GETS ${plan.childBlocks} BLOCKS. ${lot.lot_code} KEEPS ${plan.parentLeft}.` : plan.error}</div>}
      <button type="button" className="btn on" disabled={!plan?.ok} onClick={() => void save()}>SPLIT LOT</button>
    </div>
  )
}
