import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { useRole } from '../settings/RoleContext'
import { useStore } from '../store/StoreContext'
import { useSearchIndex } from '../store/useSearchIndex'
import { useCargo } from '../store/useCargo'
import { useTable } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { Confirm } from './CookParts'
import { Box, Buttons, Chips, useRun, num, type Say } from './FacilityParts'
import { KINDS, KIND_LABEL, countByKind, norm, search, type Doc, type Hit, type Kind } from '../lib/search'
import { CULTURE_STATUSES, GRAIN_STATUSES, LOT_STATUSES, deleteMany, gradeMany, salesMany, setPlaceMany, setStatusMany, stockTake, type BulkTable } from '../lib/bulkEdit'
import { GRADES } from '../data/ledger'
import { todayIso } from '../lib/xeno'
import type { LotLoss } from '../lib/hazard'

// SEARCH (build G9): find any record or screen from one box, and act on many records at once.
// The > prompt searches too: anything typed that is not a command is looked up here.

export type SearchTab = 'FIND' | 'BULK'
export const SEARCH_TABS: SearchTab[] = ['FIND', 'BULK']
export type BulkKind = 'cultures' | 'grain_runs' | 'block_lots' | 'harvests' | 'sales' | 'stock'
export interface SearchState {
  tab: SearchTab
  q: string
  kinds: Kind[]
  bulk: BulkKind
  bq: string
}
export const SEARCH_START: SearchState = { tab: 'FIND', q: '', kinds: [], bulk: 'cultures', bq: '' }
type SetSearch = (p: Partial<SearchState>) => void

const TAB_LABEL: Record<SearchTab, string> = { FIND: 'FIND A RECORD', BULK: 'CHANGE MANY AT ONCE' }

export function SearchIndex({ x, set }: { x: SearchState; set: SetSearch }) {
  const { sound } = useApp()
  const { t } = useT()
  const { docs } = useSearchIndex()
  return (
    <>
      <div className="section-title">{t('SEARCH')}</div>
      <ul className="index-list">
        {SEARCH_TABS.map((k) => (
          <li tabIndex={0} key={k} className={x.tab === k ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: k }))}>
            <span>{t(TAB_LABEL[k])}</span>
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>{t('RECORDS INDEXED')}</div>
      <div className="lg-mini">
        <div>{docs.length.toLocaleString('en-US')}</div>
      </div>
    </>
  )
}

export function Search({ x, set, say, onOpen }: { x: SearchState; set: SetSearch; say: Say; onOpen: (h: Doc) => void }) {
  const { sound } = useApp()
  const { t } = useT()
  return (
    <div className="cook ledger od mn fc sr">
      <label className="ck-picker">
        <span>{t('SHOW')} ({SEARCH_TABS.length})</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as SearchTab }))}>
          {SEARCH_TABS.map((k) => <option key={k} value={k}>{t(TAB_LABEL[k])}</option>)}
        </Select>
      </label>
      {x.tab === 'FIND' && <Find x={x} set={set} onOpen={onOpen} />}
      {x.tab === 'BULK' && <Bulk x={x} set={set} say={say} />}
    </div>
  )
}

// ---------- FIND ----------

const PAGE = 60
const EXAMPLES = ['B1020', 'BO-01', 'BLUE OYSTER', 'POWER CUT', 'TRICHODERMA', 'COSECHA']

function Find({ x, set, onOpen }: { x: SearchState; set: SetSearch; onOpen: (h: Doc) => void }) {
  const { t, tf } = useT()
  const { sound } = useApp()
  const { role } = useRole()
  const { docs } = useSearchIndex()
  const [val, setVal] = useState(x.q)
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setVal(x.q), [x.q])
  useEffect(() => {
    if (val === x.q) return
    const id = window.setTimeout(() => set({ q: val }), 220)
    return () => window.clearTimeout(id)
  }, [val, x.q, set])
  useEffect(() => setShown(PAGE), [x.q, x.kinds])

  const all = useMemo(() => search(docs, x.q, { limit: 5000 }), [docs, x.q])
  const counts = useMemo(() => countByKind(all.hits), [all])
  const kindSet = useMemo(() => new Set(x.kinds), [x.kinds])
  const hits: Hit[] = useMemo(() => (kindSet.size ? all.hits.filter((h) => kindSet.has(h.kind)) : all.hits), [all, kindSet])
  const kinds = KINDS.filter((k) => role === 'owner' || !k.cost)

  return (
    <div className="lg-stack">
      <Box title={t('FIND ANY RECORD OR SCREEN')}>
        <label className="ck-field">
          <span>{t('TYPE A CODE, A NAME OR ANY WORDS')}</span>
          <input className="sr-input" aria-label={t('Search')} autoFocus value={val} placeholder={EXAMPLES.join(', ')} onChange={(e) => setVal(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') set({ q: val }) }} />
        </label>
        <div className="dim tiny">{t('EVERY WORD YOU TYPE MUST BE FOUND. CAPITALS AND ACCENTS DO NOT MATTER. A CODE TYPED EXACTLY COMES FIRST.')}</div>
        {x.q && (
          <>
            <div className="ck-field">
              <span>{t('ONLY SHOW')}</span>
              <Chips value={x.kinds} onChange={(k) => set({ kinds: k })} label={t('Kinds')} options={kinds.filter((k) => counts.get(k.id) || kindSet.has(k.id)).map((k) => ({ id: k.id, label: `${t(k.label)} ${counts.get(k.id) ?? 0}` }))} />
              {x.kinds.length > 0 && <button type="button" className="btn" onClick={() => set({ kinds: [] })}>{t('SHOW ALL KINDS')}</button>}
            </div>
          </>
        )}
      </Box>
      <Box title={x.q ? tf('{n} FOUND', { n: hits.length.toLocaleString('en-US') }) : t('RESULTS')}>
        {!x.q ? (
          <div className="dim">{tf('{n} RECORDS AND SCREENS INDEXED. TYPE ABOVE, OR TYPE ANYTHING AT THE > PROMPT THAT IS NOT A COMMAND.', { n: docs.length.toLocaleString('en-US') })}</div>
        ) : !hits.length ? (
          <div className="dim">{t('NOTHING MATCHES. TRY FEWER WORDS, OR A PART OF THE CODE.')}</div>
        ) : (
          <>
            <ul className="sr-list">
              {hits.slice(0, shown).map((h) => (
                <li key={h.key}>
                  <button type="button" className="sr-hit" onClick={() => (sound.chirp(), onOpen(h))}>
                    <span className="sr-kind">{t(KIND_LABEL[h.kind])}</span>
                    <span className="sr-title">{h.title}</span>
                    {h.sub && <span className="sr-sub">{h.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {hits.length > shown && <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>{tf('SHOW {n} MORE', { n: Math.min(PAGE, hits.length - shown) })}</button>}
          </>
        )}
      </Box>
    </div>
  )
}

// ---------- BULK ----------

interface BulkDef {
  id: BulkKind
  label: string
  table: string
  kind: Kind | null
  owner?: boolean
}
const BULKS: BulkDef[] = [
  { id: 'cultures', label: 'CULTURES', table: 'cultures', kind: 'culture' },
  { id: 'grain_runs', label: 'GRAIN RUNS', table: 'grain_runs', kind: 'grain' },
  { id: 'block_lots', label: 'BLOCK LOTS', table: 'block_lots', kind: 'lot' },
  { id: 'harvests', label: 'HARVESTS', table: 'harvests', kind: 'harvest' },
  { id: 'sales', label: 'SALES', table: 'sales', kind: 'sale', owner: true },
  { id: 'stock', label: 'STOCK TAKE', table: 'items', kind: null },
]
const statusText = (s: string) => s.replace(/_/g, ' ').toUpperCase()

function Bulk({ x, set, say }: { x: SearchState; set: SetSearch; say: Say }) {
  const { t } = useT()
  const { role } = useRole()
  const defs = BULKS.filter((b) => role === 'owner' || !b.owner)
  const cur = defs.find((b) => b.id === x.bulk) ?? defs[0]
  return (
    <div className="lg-stack">
      <Box title={t('CHANGE MANY RECORDS AT ONCE // EACH BUTTON IS ONE UNDO')}>
        <div className="dim tiny">{t('PICK THE KIND, FIND THE RECORDS, TICK THEM, THEN APPLY ONE CHANGE. LOTS ALSO HAVE HARVEST SESSION AND INOCULATE A CART ON MISSION CONTROL > BULK ACTIONS. SALES OWED HAVE MONEY > OWED.')}</div>
        <Buttons value={cur.id} label={t('Kind')} options={defs.map((b) => ({ id: b.id, label: t(b.label) }))} onPick={(v) => set({ bulk: v, bq: '' })} />
      </Box>
      {cur.id === 'stock' ? <StockTake say={say} q={x.bq} setQ={(bq) => set({ bq })} /> : <BulkList key={cur.id} def={cur} q={x.bq} setQ={(bq) => set({ bq })} say={say} />}
    </div>
  )
}

function BulkList({ def, q, setQ, say }: { def: BulkDef; q: string; setQ: (q: string) => void; say: Say }) {
  const { t, tf } = useT()
  const { sound } = useApp()
  const store = useStore()
  const run = useRun(say)
  const { docs } = useSearchIndex()
  const losses = useTable<LotLoss>('lot_losses')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [place, setPlace] = useState('')
  const [day, setDay] = useState(todayIso())
  const [shown, setShown] = useState(PAGE)
  const mine = useMemo(() => docs.filter((d) => d.table === def.table), [docs, def.table])
  const found = useMemo(() => (norm(q) ? search(mine, q, { limit: 100000 }).hits : [...mine].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))), [mine, q])
  // Ticks only count records that still exist and match: a changed filter never leaves an invisible tick behind.
  const ids = useMemo(() => found.map((h) => h.rowId as string), [found])
  const live = useMemo(() => ids.filter((i) => picked.has(i)), [ids, picked])
  useEffect(() => setShown(PAGE), [q])
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const n = live.length
  const done = (ok: boolean) => ok && setPicked(new Set())
  const table = def.table as BulkTable
  const statuses = table === 'cultures' ? CULTURE_STATUSES : table === 'grain_runs' ? GRAIN_STATUSES : LOT_STATUSES

  const apply = (label: string, fn: () => Promise<unknown>) => void run(label, fn).then(done)
  const del = async () => {
    try {
      let kept = 0
      let msg = ''
      await store.action(null, async () => {
        const r = await deleteMany(store, table, live)
        kept = r.skipped.length
        msg = kept ? tf('DELETED {n}. KEPT {k}: {why}', { n: r.deleted, k: kept, why: t(r.skipped[0].why) }) : tf('DELETED {n} RECORDS', { n: r.deleted })
        return tf('DELETED {n} RECORDS', { n: r.deleted })
      })
      sound.confirm()
      say(msg, kept > 0)
      setPicked(new Set())
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }

  return (
    <>
      <Box title={`${t(def.label)} // ${tf('{n} MATCH', { n: found.length.toLocaleString('en-US') })}`}>
        <label className="ck-field">
          <span>{t('NARROW THE LIST WITH WORDS (OPTIONAL)')}</span>
          <input className="sr-input" aria-label={t('Filter')} value={q} placeholder={t('CODE, STATUS, SHELF, DATE ...')} onChange={(e) => setQ(e.target.value.toUpperCase())} />
        </label>
        <div className="lg-btns">
          <button type="button" className="btn" disabled={!ids.length} onClick={() => setPicked(new Set([...picked, ...ids]))}>{tf('TICK ALL {n} MATCHES', { n: ids.length.toLocaleString('en-US') })}</button>
          <button type="button" className="btn" disabled={!picked.size} onClick={() => setPicked(new Set())}>{t('CLEAR TICKS')}</button>
        </div>
        {found.length === 0 ? (
          <div className="dim">{t('NOTHING TO SHOW.')}</div>
        ) : (
          <ul className="sr-list sr-ticks">
            {found.slice(0, shown).map((h) => {
              const on = picked.has(h.rowId as string)
              return (
                <li key={h.key}>
                  <button type="button" className={`sr-hit ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(h.rowId as string)}>
                    <span className="sr-box" aria-hidden>{on ? '[X]' : '[ ]'}</span>
                    <span className="sr-title">{h.title}</span>
                    {h.sub && <span className="sr-sub">{h.sub}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {found.length > shown && <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>{tf('SHOW {n} MORE', { n: Math.min(PAGE, found.length - shown) })}</button>}
      </Box>
      <Box title={`${tf('APPLY TO {n} TICKED', { n })}`}>
        {!n ? (
          <div className="dim">{t('TICK AT LEAST ONE RECORD ABOVE.')}</div>
        ) : (
          <>
            {table !== 'sales' && table !== 'harvests' && (
              <div className="ck-field">
                <span>{t('SET STATUS TO')}</span>
                <div className="lg-btns">
                  {statuses.map((s) => (
                    <button key={s} type="button" className="btn" onClick={() => apply(tf('{n} SET TO {s}', { n, s: statusText(s) }), () => setStatusMany(store, table as 'cultures' | 'grain_runs' | 'block_lots', live, s, losses))}>
                      {statusText(s)}
                    </button>
                  ))}
                </div>
                {table === 'block_lots' && <span className="dim tiny">{t('LOST WRITES A LOSS LINE FOR EVERY BLOCK STILL ALIVE. FRUITING MOVES THE LOT TO THE FRUITING ROOM.')}</span>}
              </div>
            )}
            {(table === 'cultures' || table === 'grain_runs') && (
              <div className="ck-field">
                <span>{t('SET PLACE (SHELF, FRIDGE, RACK)')}</span>
                <div className="lg-btns">
                  <input className="sr-input" aria-label={t('Place')} value={place} placeholder="FRIDGE 1 SHELF 2" onChange={(e) => setPlace(e.target.value.toUpperCase())} />
                  <button type="button" className="btn" onClick={() => apply(place.trim() ? tf('{n} MOVED TO {p}', { n, p: place.trim() }) : tf('{n} PLACE CLEARED', { n }), () => setPlaceMany(store, table, live, place))}>{place.trim() ? t('SET PLACE') : t('CLEAR PLACE')}</button>
                </div>
              </div>
            )}
            {table === 'harvests' && (
              <div className="ck-field">
                <span>{t('SET GRADE TO')}</span>
                <div className="lg-btns">{GRADES.map((g) => <button key={g} type="button" className="btn" onClick={() => apply(tf('{n} GRADED {g}', { n, g }), () => gradeMany(store, live, g))}>{g}</button>)}</div>
              </div>
            )}
            {table === 'sales' && (
              <div className="ck-field">
                <span>{t('MONEY STATUS')}</span>
                <label className="ck-field"><span>{t('DAY')}</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value || todayIso())} /></label>
                <div className="lg-btns">
                  <button type="button" className="btn" onClick={() => apply(tf('{n} MARKED PAID {d}', { n, d: day }), () => salesMany(store, live, 'paid', day))}>{t('MARK PAID')}</button>
                  <button type="button" className="btn" onClick={() => apply(tf('{n} MARKED OWED', { n }), () => salesMany(store, live, 'owed', day))}>{t('MARK OWED')}</button>
                  <button type="button" className="btn" onClick={() => apply(tf('{n} WRITTEN OFF', { n }), () => salesMany(store, live, 'written_off', day))}>{t('WRITE OFF (OWED ONLY)')}</button>
                </div>
              </div>
            )}
            <div className="ck-field">
              <span>{t('DELETE')}</span>
              <Confirm label={tf('DELETE {n}', { n })} onYes={() => void del()} />
              <span className="dim tiny">{t('A RECORD OTHER RECORDS CAME FROM, OR A LOT WITH HARVESTS, IS KEPT AND LISTED. UNDO BRINGS THE REST BACK.')}</span>
            </div>
          </>
        )}
      </Box>
    </>
  )
}

function StockTake({ say, q, setQ }: { say: Say; q: string; setQ: (q: string) => void }) {
  const { t, tf } = useT()
  const store = useStore()
  const run = useRun(say)
  const cargo = useCargo()
  const [counts, setCounts] = useState<Record<string, string>>({})
  const rows = useMemo(() => cargo.rows.filter((r) => !norm(q) || norm(`${r.item.name} ${r.item.category ?? ''} ${r.item.supplier ?? ''}`).includes(norm(q))), [cargo.rows, q])
  const lines = cargo.rows.flatMap((r) => {
    const v = num(counts[r.item.id] ?? '')
    return v === null ? [] : [{ itemId: r.item.id, current: r.onHand, target: v }]
  })
  const changed = lines.filter((l) => Math.round((l.target - l.current) * 1000) !== 0).length
  return (
    <Box title={t('STOCK TAKE // COUNT MANY ITEMS, SAVE ONCE')}>
      <div className="dim tiny">{t('TYPE WHAT YOU COUNTED. LEAVE AN ITEM BLANK IF YOU DID NOT COUNT IT. ONLY ITEMS THAT DIFFER GET A COUNT MOVE (THE DIFFERENCE), SO THE HISTORY STAYS HONEST.')}</div>
      <label className="ck-field">
        <span>{t('NARROW THE LIST WITH WORDS (OPTIONAL)')}</span>
        <input className="sr-input" aria-label={t('Filter')} value={q} placeholder={t('NAME, CATEGORY, SUPPLIER')} onChange={(e) => setQ(e.target.value.toUpperCase())} />
      </label>
      <div className="rc-wrap">
        <table className="lg-table rc-table rc-input">
          <thead><tr><th>{t('ITEM')}</th><th>{t('ON HAND')}</th><th>{t('COUNTED')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item.id}>
                <td>{r.item.name}</td>
                <td>{r.counted ? `${Math.round(r.onHand * 1000) / 1000} ${r.item.unit}` : '--'}</td>
                <td><input aria-label={`${t('Counted')} ${r.item.name}`} inputMode="decimal" value={counts[r.item.id] ?? ''} placeholder={r.item.unit} onChange={(e) => setCounts({ ...counts, [r.item.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dim">{tf('{n} COUNTED // {c} DIFFER FROM THE MANIFEST', { n: lines.length, c: changed })}</div>
      <button type="button" className="btn on" disabled={!lines.length} onClick={() => void run(tf('STOCK TAKE // {c} COUNTS SAVED', { c: changed }), () => stockTake(store, lines)).then((ok) => ok && setCounts({}))}>{t('SAVE COUNTS')}</button>
    </Box>
  )
}
