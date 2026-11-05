import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore, useTable } from '../store/StoreContext'
import { useCargo } from '../store/useCargo'
import { speciesName } from '../store/useLedger'
import { SPECIES, planBags } from '../data/species'
import { GRADES } from '../data/ledger'
import { HazardPick } from '../components/HazardPick'
import { hazardName, type LotLoss } from '../lib/hazard'
import { addDays, RATIO, todayIso, type BlockLot, type Culture, type GrainRun, type Strain } from '../lib/xeno'
import { lossLot, setLotStatus } from '../lib/xenoActions'
import { uuid } from '../lib/store'
import type { Harvest } from '../lib/ledger'
import type { CookRun } from '../lib/cook'
import { board, expectFor, nextFlush, suggestCode, todayList, type BoardRow } from '../lib/mission'
import { Confirm, Guess } from './CookParts'

// MISSION CONTROL: every active block lot on one board, the harvest log and the TODAY list.

export type MissionTab = 'BOARD' | 'TODAY' | 'HARVEST' | 'NEWLOT' | 'GUESSES'
export const MISSION_TABS: MissionTab[] = ['BOARD', 'TODAY', 'HARVEST', 'NEWLOT', 'GUESSES']
const TAB_LABEL: Record<MissionTab, string> = { BOARD: 'BOARD', TODAY: 'TODAY', HARVEST: 'LOG HARVEST', NEWLOT: 'NEW BLOCK LOT', GUESSES: 'GUESSES' }
export interface MissionState {
  tab: MissionTab
}
export const MISSION_START: MissionState = { tab: 'BOARD' }
type SetMission = (p: Partial<MissionState>) => void
type Say = (t: string, warn?: boolean) => void

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

/** Everything the board and TODAY need, from the store. */
function useMission() {
  const lots = useTable<BlockLot>('block_lots')
  const losses = useTable<LotLoss>('lot_losses')
  const harvests = useTable<Harvest>('harvests')
  const cultures = useTable<Culture>('cultures')
  const grain = useTable<GrainRun>('grain_runs')
  const strains = useTable<Strain>('strains')
  const cook = useTable<CookRun>('cook_runs')
  const cargo = useCargo()
  const rows = useMemo(() => board(lots, losses, harvests), [lots, losses, harvests])
  const reorders = useMemo(() => cargo.rows.filter((r) => r.state === 'LOW' || r.state === 'OUT').map((r) => ({ id: r.item.id, name: r.item.name, state: r.state as string, weeks: r.weeks })), [cargo.rows])
  const today = useMemo(() => todayList({ rows, cultures, grain, strains, reorders }), [rows, cultures, grain, strains, reorders])
  return { lots, losses, harvests, cultures, grain, strains, cook, rows, today }
}

function useRun(say: Say) {
  const { sound } = useApp()
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      sound.confirm()
      say(ok)
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
      return false
    }
  }
}

export function MissionIndex({ x, set }: { x: MissionState; set: SetMission }) {
  const { sound } = useApp()
  const m = useMission()
  const due = m.today.filter((t) => t.kind === 'MOVE' || t.kind === 'HARVEST').length
  return (
    <>
      <div className="section-title">MISSION CONTROL</div>
      <ul className="index-list">
        {MISSION_TABS.map((t) => (
          <li key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{TAB_LABEL[t]}</span>
            {t === 'BOARD' && <span className="k">{m.rows.length}</span>}
            {t === 'TODAY' && <span className="k">{m.today.length}</span>}
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>NOW</div>
      <div className="lg-mini">
        <div>{m.rows.length} ACTIVE LOTS</div>
        <div>{m.rows.reduce((n, r) => n + r.blocks, 0)} BLOCKS</div>
        <div className={due ? 'lg-warn-text' : ''}>{due} LOTS NEED ACTION</div>
      </div>
    </>
  )
}

export function Mission({ x, set, say }: { x: MissionState; set: SetMission; say: Say }) {
  const { sound } = useApp()
  const m = useMission()
  return (
    <div className="cook ledger">
      <label className="ck-picker">
        <span>SHOW</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as MissionTab }))}>
          {MISSION_TABS.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
        </Select>
      </label>
      {x.tab === 'BOARD' && <Board m={m} say={say} />}
      {x.tab === 'TODAY' && <Today m={m} />}
      {x.tab === 'HARVEST' && <HarvestForm m={m} say={say} />}
      {x.tab === 'NEWLOT' && <NewLot m={m} say={say} done={() => set({ tab: 'BOARD' })} />}
      {x.tab === 'GUESSES' && <Guesses />}
    </div>
  )
}

type M = ReturnType<typeof useMission>

const FLAG_CLASS: Record<string, string> = { DUE: 'lg-warn-text', LATE: 'lg-warn-text' }

function Board({ m, say }: { m: M; say: Say }) {
  if (!m.rows.length)
    return (
      <div className="ck-box">
        <div className="section-title">BOARD</div>
        <div className="dim">NO ACTIVE BLOCK LOTS. AFTER A KNOCK, OPEN NEW BLOCK LOT.</div>
      </div>
    )
  return (
    <div className="lg-stack">
      {m.rows.map((r) => <LotCard key={r.lot.id} r={r} m={m} say={say} />)}
      <div className="dim tiny">SRC: KNOCK TO FIRST HARVEST AND KG PER BLOCK = CATAWBA REAL PICKS (SPECIES FILES). MOVE WINDOW = TEXTBOOK BLOCK INCUBATION DAYS. NO FIGURE = NO DATA.</div>
    </div>
  )
}

function LotCard({ r, m, say }: { r: BoardRow; m: M; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const [lostOpen, setLostOpen] = useState(false)
  const [haz, setHaz] = useState('')
  const [n, setN] = useState('')
  const l = r.lot
  const ex = r.ex
  const move = () => run(() => store.put('block_lots', { ...l, status: 'fruiting', to_fruiting_on: todayIso() }), `${l.lot_code} MOVED TO FRUITING`)
  const spent = () => run(() => setLotStatus(store, l, 'spent'), `${l.lot_code} MARKED SPENT`)
  const lost = async () => {
    const blocks = num(n) ?? r.blocks
    const ok = await run(() => lossLot(store, l, m.losses, blocks, haz || null), `${blocks} BLOCKS OF ${l.lot_code} LOST: ${hazardName(haz || null)}`)
    if (ok) setLostOpen(false)
  }
  const moveTxt = r.move === 'DONE' ? `IN FRUITING${l.to_fruiting_on ? ` SINCE ${l.to_fruiting_on}` : ''}` : r.move === 'WAIT' ? `MOVE FROM ${r.moveOn} (DAY ${ex.moveOpen})` : r.move === 'DUE' ? `MOVE NOW (WINDOW DAY ${ex.moveOpen}-${ex.moveLate})` : `MOVE IS LATE (WINDOW ENDED DAY ${ex.moveLate})`
  return (
    <div className={`ck-box ${r.move === 'LATE' || r.harvestFlag === 'LATE' ? 'due' : ''}`}>
      <div className="section-title">{l.lot_code} // {speciesName(l.species_key)} // {r.blocks}{r.lost ? `/${l.bag_count}` : ''} BLOCKS</div>
      <div className="ck-fields">
        <div className="ck-field"><span>DAYS SINCE KNOCK</span><b>{r.days}</b><em>KNOCKED {l.knock_date}</em></div>
        <div className="ck-field">
          <span>FRUITING MOVE</span>
          <b className={FLAG_CLASS[r.move]}>{r.move === 'DONE' ? 'DONE' : r.move}</b>
          <em>{moveTxt}{ex.moveGuess && r.move !== 'DONE' ? ' GUESS - REVIEW' : ''}</em>
        </div>
        <div className="ck-field">
          <span>FIRST HARVEST</span>
          <b className={FLAG_CLASS[r.harvestFlag]}>{r.harvestOn ?? 'NO DATA'}</b>
          <em>{r.harvestFlag === 'NO DATA' ? 'NO FIGURE IN SOURCES' : `${r.harvestFlag}${r.harvestFlag === 'PICKING' ? ` // FLUSH ${r.flushesDone} OF ${ex.flushes}` : ''} // ${ex.src}`}</em>
        </div>
        <div className="ck-field">
          <span>KG EXPECTED / LOGGED</span>
          <b>{r.expKg === null ? 'NO DATA' : kg1(r.expKg)} / {kg1(r.gotKg)}</b>
          <em>{r.expKg === null ? '' : `${Math.round((r.gotKg / r.expKg) * 100)}% OF EXPECTED`}{ex.flushGuess ? ' // FLUSH COUNT GUESS' : ''}</em>
        </div>
      </div>
      <div className="lg-btns">
        {l.status === 'incubating' && <button type="button" className={`btn ${r.move === 'DUE' || r.move === 'LATE' ? 'on' : ''}`} onClick={() => void move()}>MOVE TO FRUITING</button>}
        <Confirm label="SPENT" onYes={() => void spent()} />
        <button type="button" className="btn hazard" onClick={() => setLostOpen(!lostOpen)}>LOST...</button>
      </div>
      {lostOpen && (
        <div className="ck-fields">
          <label className="ck-field"><span>BLOCKS LOST (BLANK = ALL {r.blocks})</span><input inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} placeholder={String(r.blocks)} /></label>
          <label className="ck-field"><span>WHAT WAS IT (HAZARD INDEX)</span><HazardPick value={haz} onChange={setHaz} /></label>
          <div className="ck-field"><span>&nbsp;</span><Confirm label="LOG LOSS" onYes={() => void lost()} /></div>
        </div>
      )}
    </div>
  )
}

function Today({ m }: { m: M }) {
  const groups: { kind: 'MOVE' | 'HARVEST' | 'CULTURE' | 'REORDER'; title: string; empty: string }[] = [
    { kind: 'MOVE', title: 'LOTS TO MOVE TO FRUITING', empty: 'NONE DUE' },
    { kind: 'HARVEST', title: 'LOTS DUE TO HARVEST', empty: 'NONE DUE' },
    { kind: 'CULTURE', title: 'CULTURES AND GRAIN DUE (XENOGENETICS)', empty: 'ALL WITHIN LIMITS' },
    { kind: 'REORDER', title: 'REORDER (CARGO)', empty: 'NOTHING LOW' },
  ]
  return (
    <div className="lg-stack">
      {groups.map((g) => {
        const items = m.today.filter((t) => t.kind === g.kind)
        return (
          <div key={g.kind} className="ck-box">
            <div className="section-title">{g.title} // {items.length}</div>
            {items.length ? (
              <ul className="ck-guesses">
                {items.map((t, i) => <li key={i} className={t.warn ? 'lg-warn-text' : ''}>{t.text}</li>)}
              </ul>
            ) : (
              <div className="dim">{g.empty}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HarvestForm({ m, say }: { m: M; say: Say }) {
  const store = useStore()
  const [lotId, setLotId] = useState('')
  const [flush, setFlush] = useState('')
  const [kg, setKg] = useState('')
  const [grade, setGrade] = useState<string>('A')
  const [initials, setInitials] = useState(getInitials)
  const [day, setDay] = useState(todayIso())
  const active = useMemo(() => [...m.rows].sort((a, b) => Number(b.lot.status === 'fruiting') - Number(a.lot.status === 'fruiting')), [m.rows])
  const row = active.find((r) => r.lot.id === (lotId || active[0]?.lot.id))
  const fl = num(flush) ?? (row ? nextFlush(m.harvests, row.lot.id) : 1)
  const recent = useMemo(() => [...m.harvests].sort((a, b) => b.harvested_on.localeCompare(a.harvested_on) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, 12), [m.harvests])
  const codeOf = (id: string) => m.lots.find((l) => l.id === id)?.lot_code ?? '?'

  const save = async () => {
    const k = num(kg)
    if (!row) return say('NO ACTIVE LOT. CREATE ONE FIRST.', true)
    if (k === null || k <= 0) return say('TYPE THE KG PICKED.', true)
    if (!initials.trim()) return say('TYPE YOUR INITIALS.', true)
    if (fl < 1 || fl > 9) return say('FLUSH MUST BE 1 TO 9.', true)
    try {
      if (row.lot.status === 'incubating') await store.put('block_lots', { ...row.lot, status: 'fruiting', to_fruiting_on: row.lot.to_fruiting_on ?? day })
      await store.put('harvests', { id: uuid(), block_lot_id: row.lot.id, harvested_on: day, flush: Math.floor(fl), kg: k, grade, initials: initials.trim().toUpperCase(), notes: null, created_at: new Date().toISOString() })
      try {
        localStorage.setItem(INITIALS_KEY, initials.trim().toUpperCase())
      } catch {
        // blocked storage: asked again next time
      }
      say(`HARVEST SAVED // ${row.lot.lot_code} FLUSH ${Math.floor(fl)} // ${kg1(k)} KG // GRADE ${grade}${row.lot.status === 'incubating' ? ' // LOT MARKED FRUITING' : ''}`)
      setKg('')
      setFlush('')
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'SAVE FAILED', true)
    }
  }

  const after = row && num(kg) ? row.gotKg + (num(kg) ?? 0) : null
  return (
    <div className="lg-stack lg-sale">
      <div className="ck-box">
        <div className="section-title">LOG HARVEST</div>
        {!active.length ? (
          <div className="dim">NO ACTIVE LOTS. CREATE A BLOCK LOT FIRST.</div>
        ) : (
          <>
            <label className="ck-field">
              <span>LOT</span>
              <Select value={row?.lot.id ?? ''} onChange={(e) => (setLotId(e.target.value), setFlush(''))}>
                {active.map((r) => <option key={r.lot.id} value={r.lot.id}>{r.lot.lot_code} {speciesName(r.lot.species_key)} // {r.lot.status.toUpperCase()}</option>)}
              </Select>
            </label>
            <div className="ck-fields ck-quick">
              <label className="ck-field"><span>KG</span><input inputMode="decimal" autoFocus value={kg} placeholder="0.0" onChange={(e) => setKg(e.target.value)} /></label>
              <label className="ck-field"><span>FLUSH</span><input inputMode="numeric" value={flush} placeholder={String(fl)} onChange={(e) => setFlush(e.target.value)} /></label>
              <label className="ck-field"><span>INITIALS</span><input value={initials} maxLength={4} onChange={(e) => setInitials(e.target.value.toUpperCase())} /></label>
            </div>
            <div className="ck-field">
              <span>GRADE <Guess /></span>
              <div className="lg-btns">
                {GRADES.map((g) => <button key={g} type="button" className={`btn ${grade === g ? 'on' : ''}`} onClick={() => setGrade(g)}>{g}</button>)}
              </div>
            </div>
            <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value || todayIso())} /></label>
            {row && (
              <div className="dim">
                {row.expKg === null ? 'EXPECTED KG: NO DATA' : `EXPECTED ${kg1(row.expKg)} KG ALL FLUSHES // LOGGED ${kg1(row.gotKg)}${after !== null ? ` -> ${kg1(after)} (${Math.round((after / row.expKg) * 100)}%)` : ''}`}
              </div>
            )}
            <button type="button" className="btn on" onClick={() => void save()}>SAVE HARVEST</button>
          </>
        )}
      </div>
      <div className="ck-box">
        <div className="section-title">RECENT PICKS // LEDGER AND TRADE USE THESE KG</div>
        {recent.length ? (
          <table className="lg-table">
            <thead><tr><th>DAY</th><th>LOT</th><th>FL</th><th>KG</th><th>GR</th><th>BY</th><th /></tr></thead>
            <tbody>
              {recent.map((h) => (
                <tr key={h.id}>
                  <td>{h.harvested_on}</td><td>{codeOf(h.block_lot_id)}</td><td>{h.flush}</td><td>{kg1(Number(h.kg))}</td><td>{h.grade ?? ''}</td><td>{h.initials ?? ''}</td>
                  <td><Confirm label="DEL" onYes={() => void store.del('harvests', h.id).then(() => say('PICK DELETED'))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dim">NOTHING LOGGED YET.</div>
        )}
      </div>
    </div>
  )
}

function NewLot({ m, say, done }: { m: M; say: Say; done: () => void }) {
  const store = useStore()
  const species = useMemo(() => SPECIES.filter((s) => s.cat || s.plan), [])
  const [sp, setSp] = useState('blue-oyster')
  const [knock, setKnock] = useState(todayIso())
  const [strainId, setStrainId] = useState('')
  const [grainId, setGrainId] = useState('')
  const [cookId, setCookId] = useState('')
  const planned = (() => {
    const s = SPECIES.find((x) => x.id === sp)
    const b = s ? planBags(s) : null
    return b ? Math.round(b) : null
  })()
  const [blocks, setBlocks] = useState('')
  const [code, setCode] = useState('')
  const [notes, setNotes] = useState('')
  const autoCode = suggestCode(sp, knock, m.lots)
  const n = num(blocks) ?? planned ?? 0
  const strains = m.strains.filter((s) => s.species_key === sp && s.active !== false)
  const grain = m.grain.filter((g) => g.generation === 'G2' && (strainId ? g.strain_id === strainId : strains.some((s) => s.id === g.strain_id)) && !['used_up', 'discarded', 'contaminated'].includes(g.status))
  const cooks = [...m.cook].sort((a, b) => (b.started_at ?? b.created_at ?? '').localeCompare(a.started_at ?? a.created_at ?? '')).slice(0, 15)
  const finalCode = (code || autoCode).toUpperCase().trim()
  const dup = m.lots.some((l) => l.lot_code.toUpperCase() === finalCode && l.knock_date === knock)
  const ex = expectFor(sp)

  const save = async () => {
    if (!finalCode) return say('TYPE A LOT CODE.', true)
    if (dup) return say(`LOT ${finalCode} ALREADY EXISTS FOR ${knock}.`, true)
    if (!(n > 0)) return say('TYPE HOW MANY BLOCKS.', true)
    const now = new Date().toISOString()
    const strain = m.strains.find((s) => s.id === (strainId || grain.find((g) => g.id === grainId)?.strain_id)) ?? null
    const row: BlockLot = {
      id: uuid(),
      lot_code: finalCode,
      species_key: sp,
      strain_id: strain?.id ?? null,
      grain_run_id: grainId || null,
      g2_bags_used: grainId ? Math.ceil(n / RATIO.blocksPerG2) : null,
      cook_run_id: cookId || null,
      bag_count: Math.floor(n),
      knock_date: knock,
      status: 'incubating',
      notes: notes.trim() || null,
      created_at: now,
      updated_at: now,
    }
    try {
      await store.put('block_lots', row)
      say(`LOT ${finalCode} LOGGED // ${row.bag_count} BLOCKS // MOVE FROM ${addDays(knock, ex.moveOpen)}`)
      setBlocks('')
      setCode('')
      setNotes('')
      done()
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'SAVE FAILED', true)
    }
  }

  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">NEW BLOCK LOT (AFTER THE KNOCK)</div>
        <div className="ck-fields">
          <label className="ck-field">
            <span>SPECIES</span>
            <Select value={sp} onChange={(e) => (setSp(e.target.value), setStrainId(''), setGrainId(''), setCode(''))}>
              {species.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          <label className="ck-field"><span>KNOCK DAY</span><PickInput type="date" value={knock} onChange={(e) => (setKnock(e.target.value || todayIso()), setCode(''))} /></label>
          <label className="ck-field">
            <span>BLOCKS</span>
            <input inputMode="numeric" value={blocks} placeholder={planned ? String(planned) : '0'} onChange={(e) => setBlocks(e.target.value)} />
            <em>{planned ? `WEEKLY PLAN SHARE OF 130 (SEQUENCE) ${planned}` : 'NOT IN THE CROP PLAN, TYPE IT'}</em>
          </label>
          <label className="ck-field">
            <span>LOT CODE</span>
            <input value={code} placeholder={autoCode} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <em className={dup ? 'lg-warn-text' : ''}>{dup ? 'ALREADY USED THAT DAY' : 'SPECIES LETTER + KNOCK MMDD'}</em>
          </label>
        </div>
        <div className="ck-fields">
          <label className="ck-field">
            <span>STRAIN</span>
            <Select value={strainId} onChange={(e) => (setStrainId(e.target.value), setGrainId(''))}>
              <option value="">NOT SET</option>
              {strains.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` ${s.name}` : ''}</option>)}
            </Select>
          </label>
          <label className="ck-field">
            <span>GRAIN RUN (G2)</span>
            <Select value={grainId} onChange={(e) => setGrainId(e.target.value)}>
              <option value="">NOT SET</option>
              {grain.map((g) => <option key={g.id} value={g.id}>{g.label ?? `G2 ${g.inoculated_on}`} // {g.bag_count - (g.bags_lost || 0)} BAGS</option>)}
            </Select>
          </label>
          <label className="ck-field">
            <span>COOK RUN (STEAM)</span>
            <Select value={cookId} onChange={(e) => setCookId(e.target.value)}>
              <option value="">NOT SET</option>
              {cooks.map((c) => <option key={c.id} value={c.id}>{(c.started_at ?? c.created_at ?? '').slice(0, 10)} {c.unit_label ?? c.kind.toUpperCase()}{c.bag_count ? ` // ${c.bag_count} BAGS` : ''}</option>)}
            </Select>
          </label>
        </div>
        <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <div className="dim">
          EXPECT MOVE FROM {addDays(knock, ex.moveOpen)}{ex.moveGuess ? ' (GUESS)' : ''}, FIRST HARVEST {ex.firstDays === null ? 'NO DATA' : addDays(knock, ex.firstDays)}.
        </div>
        <button type="button" className="btn on" onClick={() => void save()}>LOG BLOCK LOT</button>
      </div>
    </div>
  )
}

const GUESS_LIST = [
  'Move-to-fruiting window: species without a stated block incubation range use 14 days (golden, pink, phoenix, comb tooth, king and others).',
  'Flushes: oysters 1 and lion\'s mane 2 come from your farm notes. Every other species is assumed 1.',
  'Expected kg uses Catawba lb per block for ALL flushes, times surviving blocks. Your own yields replace it as picks are logged.',
  'Harvest grades A, B and SECONDS (same as TRADE).',
  'Lot-code letters other than B are first guesses (LOT_LETTER). A second lot of the same species on one day gets -2.',
  'A harvest logged on a lot still marked incubating moves it to fruiting automatically.',
  'Block count prefilled from the species share of the 130-bag week; the split itself is still unconfirmed.',
]
function Guesses() {
  return (
    <div className="ck-box">
      <div className="section-title">GUESSES WAITING FOR REVIEW</div>
      <ul className="ck-guesses">{GUESS_LIST.map((g) => <li key={g}><Guess /> {g}</li>)}</ul>
    </div>
  )
}

