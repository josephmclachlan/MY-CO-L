import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../settings/AppContext'
import { useStore, useTable } from '../store/StoreContext'
import { useRecords } from '../store/useRecords'
import { Scanner } from '../components/Scanner'
import { QrSvg } from '../components/Qr'
import { PhotoStrip } from '../components/PhotoStrip'
import { Select } from '../components/Select'
import { HistoryButton } from './History'
import { Confirm } from './CookParts'
import { HarvestSession, ChangeMany, SplitForm } from './MissionBulk'
import { cartUrl, resolveScan, type Resolved } from '../lib/scan'
import { addCultures, setCultureStatus } from '../lib/xenoActions'
import { logCheck } from '../lib/bankActions'
import { logPins, bulkLots, harvestSession } from '../lib/recordsActions'
import { boardRow, nextFlush } from '../lib/mission'
import { childP, todayIso, KIND_LABEL, MAKE_KINDS, pLabel, type BlockLot, type Culture, type CultureKind, type GrainRun, type Strain } from '../lib/xeno'
import { nextPinFlush, ROOM_CHOICES, roomName, survivors } from '../lib/records'
import type { CheckResult } from '../lib/bank'
import { speciesName } from '../store/useLedger'

// MISSION CONTROL > SCAN: point the camera at a label (culture, grain, block lot, cart) and act on it.

type Say = (t: string, warn?: boolean) => void
export interface ScanProps {
  say: Say
  /** Open a record in XENOGENETICS LINEAGE: key like b:<id>. */
  openRecord: (key: string, strainId: string | null) => void
  initial: string | null
  clearInitial: () => void
}

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

export function ScanTab({ say, openRecord, initial, clearInitial }: ScanProps) {
  const { sound } = useApp()
  const r = useRecords()
  const cultures = useTable<Culture>('cultures')
  const grain = useTable<GrainRun>('grain_runs')
  const [text, setText] = useState(initial ?? '')
  const [res, setRes] = useState<Resolved | null>(null)
  const [last, setLast] = useState('')
  const result = useRef<HTMLDivElement>(null)
  const data = useMemo(() => ({ lots: r.lots, cultures, grain }), [r.lots, cultures, grain])

  const read = (t: string) => {
    const hit = resolveScan(t, data)
    setLast(t)
    if (hit) {
      sound.confirm()
      setRes(hit)
      say(hit.kind === 'cart' ? `CART ${hit.code} // ${hit.lots.length} LOTS` : hit.kind === 'lot' ? `LOT ${hit.lot.lot_code}` : hit.kind === 'culture' ? `CULTURE ${hit.culture.label ?? ''}` : `GRAIN ${hit.run.label ?? ''}`)
    } else {
      setRes(null)
      say(t.trim() ? 'NOT FOUND ON THIS DEVICE. THE LABEL MAY BE FROM ANOTHER DEVICE, OR THE RECORD WAS DELETED.' : 'TYPE OR SCAN A CODE.', true)
    }
  }
  // A found record scrolls into view: on a phone it sits below the scanner.
  useEffect(() => {
    if (res) result.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [res])
  // A cart or record label opened the app: read it once the tables are in.
  useEffect(() => {
    if (!initial || (!r.lots.length && !cultures.length && !grain.length)) return
    read(initial)
    clearInitial()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, r.lots.length, cultures.length, grain.length])

  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">SCAN A LABEL</div>
        <div className="dim tiny">POINT THE CAMERA AT A QR LABEL FROM XENOGENETICS (CULTURE, GRAIN, BLOCK LOT) OR A CART LABEL BELOW. NO CAMERA? READ FROM A PHOTO, OR TYPE THE CODE.</div>
        <Scanner onText={read} onError={(m) => say(m, true)} />
        <form className="rc-code" onSubmit={(e) => (e.preventDefault(), read(text))}>
          <label className="ck-field">
            <span>OR TYPE A CODE (LOT B1020, CART C-07, CULTURE LABEL)</span>
            <input value={text} data-testid="scan-text" onChange={(e) => setText(e.target.value)} placeholder="B1020" />
          </label>
          <button type="submit" className="btn on">FIND</button>
        </form>
        {last && !res && <div className="lg-warn-text tiny">NOTHING ON FILE FOR "{last.slice(0, 60).toUpperCase()}".</div>}
      </div>
      <div ref={result} className="rc-result">
      {res?.kind === 'lot' && <LotResult lot={res.lot} r={r} say={say} openRecord={openRecord} />}
      {res?.kind === 'cart' && <CartResult res={res} r={r} say={say} />}
      {res?.kind === 'culture' && <CultureResult c={res.culture} strains={r.strains} cultures={cultures} say={say} openRecord={openRecord} />}
      {res?.kind === 'grain' && <GrainResult g={res.run} strains={r.strains} say={say} openRecord={openRecord} />}
      </div>
      <CartLabels r={r} />
    </div>
  )
}

type R = ReturnType<typeof useRecords>

// ---------- lot ----------

function LotResult({ lot, r, say, openRecord }: { lot: BlockLot; r: R; say: Say; openRecord: ScanProps['openRecord'] }) {
  const store = useStore()
  const { sound } = useApp()
  const [kg, setKg] = useState('')
  const [fl, setFl] = useState('')
  const [by, setBy] = useState(getInitials)
  const [room, setRoom] = useState('fruiting')
  const [splitOpen, setSplitOpen] = useState(false)
  const live = r.lots.find((l) => l.id === lot.id) ?? lot
  const row = boardRow(live, r.losses, r.harvests)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
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
  const pick = async () => {
    const k = num(kg)
    if (k === null || k <= 0) return say('TYPE THE KG PICKED.', true)
    const f = num(fl) ?? nextFlush(r.harvests, live.id)
    const ok = await run(() => harvestSession(store, { day: todayIso(), initials: by, rows: [{ lot: live, kg: k, flush: Math.floor(f), grade: 'A' }] }), `HARVEST ${live.lot_code} FL ${Math.floor(f)} // ${k} KG`)
    if (ok) (setKg(''), setFl(''))
  }
  return (
    <div className="ck-box" data-testid="scan-lot">
      <div className="section-title">BLOCK LOT {live.lot_code} // {speciesName(live.species_key)} // {row.blocks} BLOCKS</div>
      <div className="dim">
        {live.status.toUpperCase()} // DAY {row.days} // KNOCKED {live.knock_date} // CART {live.cart ?? 'NOT SET'} // ROOM {roomName(live.room)} // {row.gotKg.toFixed(1)} KG PICKED
      </div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>KG PICKED</span><input inputMode="decimal" value={kg} placeholder="0.0" onChange={(e) => setKg(e.target.value)} /></label>
        <label className="ck-field"><span>FLUSH</span><input inputMode="numeric" value={fl} placeholder={String(nextFlush(r.harvests, live.id))} onChange={(e) => setFl(e.target.value)} /></label>
        <label className="ck-field"><span>INITIALS</span><input value={by} maxLength={4} onChange={(e) => setBy(e.target.value.toUpperCase())} /></label>
        <div className="ck-field"><span>&nbsp;</span><button type="button" className="btn on" onClick={() => void pick()}>LOG HARVEST</button></div>
      </div>
      <div className="lg-btns">
        {live.status === 'incubating' && (
          <>
            <span className="rc-inline">
              <Select aria-label="Room" value={room} onChange={(e) => setRoom(e.target.value)}>{ROOM_CHOICES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
            </span>
            <button type="button" className="btn" onClick={() => void run(() => bulkLots(store, [live], { status: 'fruiting', room }, r.losses), `${live.lot_code} MOVED TO ${roomName(room)}`)}>MOVE TO FRUITING</button>
          </>
        )}
        <button type="button" className="btn" onClick={() => void run(() => logPins(store, live, nextPinFlush(live.id, r.harvests, r.pins), todayIso(), r.pins), `${live.lot_code} PINS TODAY`)}>PINS TODAY</button>
        <button type="button" className="btn" onClick={() => setSplitOpen(!splitOpen)}>SPLIT...</button>
        <button type="button" className="btn" onClick={() => openRecord(`b:${live.id}`, live.strain_id)}>OPEN RECORD</button>
        <HistoryButton table="block_lots" id={live.id} />
      </div>
      {splitOpen && <SplitForm m={{ rows: [], cultures: [], grain: [], strains: r.strains, cook: r.cooks, lots: r.lots, losses: r.losses, harvests: r.harvests }} lot={live} say={say} onDone={() => setSplitOpen(false)} />}
      <PhotoStrip table="block_lots" id={live.id} say={say} />
    </div>
  )
}

// ---------- cart ----------

function CartResult({ res, r, say }: { res: Extract<Resolved, { kind: 'cart' }>; r: R; say: Say }) {
  const [mode, setMode] = useState<'HARVEST' | 'CHANGE'>('CHANGE')
  const ids = res.lots.map((l) => l.id)
  const m = useMemo(() => ({ rows: [], cultures: [], grain: [], strains: r.strains, cook: r.cooks, lots: r.lots, losses: r.losses, harvests: r.harvests }), [r])
  const blocks = res.lots.reduce((n, l) => n + survivors(l, r.losses), 0)
  const rows = useMemo(() => res.lots.map((l) => boardRow(l, r.losses, r.harvests)), [res.lots, r.losses, r.harvests])
  return (
    <div className="ck-box" data-testid="scan-cart">
      <div className="section-title">CART {res.code} // {res.lots.length} LOTS // {blocks} BLOCKS ALIVE</div>
      {!res.lots.length ? (
        <div className="dim">NO ACTIVE LOTS ON THIS CART. IT MAY HAVE BEEN EMPTIED.</div>
      ) : (
        <>
          <ul className="ck-guesses">
            {rows.map((x) => <li key={x.lot.id}>{x.lot.lot_code} // {speciesName(x.lot.species_key)} // {x.blocks} ALIVE // {x.lot.status.toUpperCase()} // DAY {x.days} // MOVE {x.move}</li>)}
          </ul>
          <div className="lg-btns" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'CHANGE'} className={`btn ${mode === 'CHANGE' ? 'on' : ''}`} onClick={() => setMode('CHANGE')}>MOVE / CHANGE THE CART</button>
            <button type="button" role="tab" aria-selected={mode === 'HARVEST'} className={`btn ${mode === 'HARVEST' ? 'on' : ''}`} onClick={() => setMode('HARVEST')}>HARVEST THE CART</button>
          </div>
          {mode === 'CHANGE' ? (
            <ChangeMany key={res.code} m={{ ...m, rows: [] }} say={say} only={ids} />
          ) : (
            <HarvestSession key={res.code} m={{ ...m, rows: rows }} say={say} only={ids} />
          )}
        </>
      )}
    </div>
  )
}

// ---------- culture ----------

function CultureResult({ c, strains, cultures, say, openRecord }: { c: Culture; strains: Strain[]; cultures: Culture[]; say: Say; openRecord: ScanProps['openRecord'] }) {
  const store = useStore()
  const { sound } = useApp()
  const live = cultures.find((x) => x.id === c.id) ?? c
  const strain = strains.find((s) => s.id === live.strain_id)
  const [loc, setLoc] = useState(live.location ?? '')
  const [kind, setKind] = useState<CultureKind>('plate')
  const [n, setN] = useState('1')
  const [cover, setCover] = useState('')
  const tube = live.kind === 'slant' || live.kind === 'water'
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await store.action(ok, fn)
      sound.confirm()
      say(ok)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const check = (result: CheckResult) => run(() => logCheck(store, { tube: live, days_to_cover: num(cover), appearance: null, contamination: null, result, initials: getInitials() || null }), `${live.label ?? 'TUBE'} CHECK: ${result.toUpperCase()}`)
  return (
    <div className="ck-box" data-testid="scan-culture">
      <div className="section-title">{live.label ?? KIND_LABEL[live.kind]} // {strain?.code ?? '?'} // {pLabel(live.p_level)} {KIND_LABEL[live.kind]}</div>
      <div className="dim">MADE {live.made_on} // {live.status.replace('_', ' ').toUpperCase()} // AT {live.location ? live.location.toUpperCase() : 'NO PLACE SET'}</div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>MOVE TO (PLACE)</span><input value={loc} maxLength={40} onChange={(e) => setLoc(e.target.value)} /></label>
        <div className="ck-field"><span>&nbsp;</span><button type="button" className="btn on" onClick={() => void run(() => store.put('cultures', { ...live, location: loc.trim() || null }), `${live.label ?? 'CULTURE'} MOVED TO ${loc.trim().toUpperCase() || 'NO PLACE'}`)}>MOVE</button></div>
      </div>
      {tube && (
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>DAYS TO COVER A PLATE</span><input inputMode="decimal" value={cover} placeholder="OPTIONAL" onChange={(e) => setCover(e.target.value)} /></label>
          <div className="ck-field"><span>LOG A TUBE CHECK</span>
            <div className="lg-btns">
              <button type="button" className="btn" onClick={() => void check('pass')}>PASS</button>
              <button type="button" className="btn" onClick={() => void check('watch')}>WATCH</button>
              <button type="button" className="btn danger" onClick={() => void check('fail')}>FAIL</button>
            </div>
          </div>
        </div>
      )}
      {strain && (
        <div className="ck-fields ck-quick">
          <label className="ck-field">
            <span>MAKE A CHILD</span>
            <Select aria-label="Child kind" value={kind} onChange={(e) => setKind(e.target.value as CultureKind)}>{MAKE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
          </label>
          <label className="ck-field"><span>HOW MANY</span><input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></label>
          <div className="ck-field"><span>&nbsp;</span><button type="button" className="btn on" onClick={() => void run(() => addCultures(store, { strain, parent: live, kind, count: Number(n) || 1, existing: cultures }), `${n} ${KIND_LABEL[kind]} ${pLabel(childP(live, kind))} LOGGED FROM ${live.label ?? 'CULTURE'}`)}>MAKE {KIND_LABEL[kind]}</button></div>
        </div>
      )}
      <div className="lg-btns">
        {live.status !== 'contaminated' && <Confirm label="CONTAMINATED" onYes={() => void run(() => setCultureStatus(store, live, 'contaminated'), 'MARKED CONTAMINATED')} />}
        {live.status !== 'used_up' && <Confirm label="USED UP" onYes={() => void run(() => setCultureStatus(store, live, 'used_up'), 'MARKED USED UP')} />}
        <button type="button" className="btn" onClick={() => openRecord(`c:${live.id}`, live.strain_id)}>OPEN RECORD</button>
        <HistoryButton table="cultures" id={live.id} />
      </div>
      <PhotoStrip table="cultures" id={live.id} say={say} />
    </div>
  )
}

// ---------- grain ----------

function GrainResult({ g, strains, say, openRecord }: { g: GrainRun; strains: Strain[]; say: Say; openRecord: ScanProps['openRecord'] }) {
  const store = useStore()
  const { sound } = useApp()
  const runs = useTable<GrainRun>('grain_runs')
  const live = runs.find((x) => x.id === g.id) ?? g
  const strain = strains.find((s) => s.id === live.strain_id)
  const [loc, setLoc] = useState(live.location ?? '')
  const move = async () => {
    try {
      await store.action('MOVE GRAIN', () => store.put('grain_runs', { ...live, location: loc.trim() || null }))
      sound.confirm()
      say(`${live.label ?? 'GRAIN'} MOVED TO ${loc.trim().toUpperCase() || 'NO PLACE'}`)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  return (
    <div className="ck-box" data-testid="scan-grain">
      <div className="section-title">{live.label ?? live.generation} // {strain?.code ?? '?'} // {live.generation} x{live.bag_count}</div>
      <div className="dim">INOCULATED {live.inoculated_on} // {live.status.replace('_', ' ').toUpperCase()} // AT {live.location ? live.location.toUpperCase() : 'NO PLACE SET'}</div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>MOVE TO (PLACE)</span><input value={loc} maxLength={40} onChange={(e) => setLoc(e.target.value)} /></label>
        <div className="ck-field"><span>&nbsp;</span><button type="button" className="btn on" onClick={() => void move()}>MOVE</button></div>
      </div>
      <div className="lg-btns">
        <button type="button" className="btn" onClick={() => openRecord(`g:${live.id}`, live.strain_id)}>OPEN RECORD</button>
        <HistoryButton table="grain_runs" id={live.id} />
      </div>
      <PhotoStrip table="grain_runs" id={live.id} say={say} />
    </div>
  )
}

// ---------- cart labels ----------

function CartLabels({ r }: { r: R }) {
  const carts = useMemo(() => [...new Set(r.lots.filter((l) => l.status === 'incubating' || l.status === 'fruiting').map((l) => (l.cart ?? '').toUpperCase()).filter(Boolean))].sort(), [r.lots])
  const [code, setCode] = useState('')
  const [printing, setPrinting] = useState(false)
  const name = (code || carts[0] || 'C-01').trim().toUpperCase()
  useEffect(() => {
    if (!printing) return
    const t = window.setTimeout(() => (window.print(), setPrinting(false)), 80)
    return () => window.clearTimeout(t)
  }, [printing])
  const label = (
    <div className="xl-label">
      <QrSvg text={cartUrl(name, typeof window === 'undefined' ? undefined : window.location)} />
      <div className="xl-text">
        <div className="xl-code">CART {name}</div>
        <div>SCAN IN MY/CO/L</div>
        <div className="xl-brand">THE LATTICE HOLDS</div>
      </div>
    </div>
  )
  return (
    <div className="ck-box">
      <div className="section-title">CART LABEL</div>
      <div className="dim tiny">PRINT A QR TAG FOR A CART. SCANNING IT LISTS EVERY LOT ON THE CART. CART NAMES COME FROM INOCULATE A CART OR SET CART.</div>
      <label className="ck-field">
        <span>CART NAME {carts.length ? `(ON FILE: ${carts.slice(0, 8).join(', ')}${carts.length > 8 ? '...' : ''})` : ''}</span>
        <input value={code} maxLength={20} placeholder={carts[0] ?? 'C-01'} onChange={(e) => setCode(e.target.value.toUpperCase())} />
      </label>
      <div className="xl-preview">{label}</div>
      <button type="button" className="btn" onClick={() => setPrinting(true)}>PRINT LABEL</button>
      {printing && createPortal(<div className="xeno-print">{label}</div>, document.body)}
    </div>
  )
}
