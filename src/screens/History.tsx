import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useOperator, useStore, useSync, useTable, useUndo, type LampState } from '../store/StoreContext'
import { EDIT_LOG, type Row, type Store } from '../lib/store'
import { fieldName, rowName, showValue, TABLE_SCREEN, tableName, type EditEntry } from '../lib/history'
import type { Conflict } from '../lib/sync'
import { Select } from '../components/Select'
import { Confirm, Guess } from './CookParts'

// HISTORY: every change to every record (who, when, old value, new value), the
// UNDO list for this session, and the offline SYNC state.

export type HistoryTab = 'EDITS' | 'RECORD' | 'UNDO' | 'SYNC' | 'GUESSES'
const TAB_LABEL: Record<HistoryTab, string> = { EDITS: 'ALL EDITS', RECORD: 'ONE RECORD', UNDO: 'UNDO LIST', SYNC: 'SAVING STATUS', GUESSES: 'GUESSES' }
export interface HistoryState {
  tab: HistoryTab
  /** Section filter on ALL EDITS: a table name, or '' for everything. */
  table: string
  rec: { table: string; id: string } | null
}
export const HISTORY_START: HistoryState = { tab: 'EDITS', table: '', rec: null }
type SetHistory = (p: Partial<HistoryState>) => void
type Say = (t: string, warn?: boolean) => void

/** Lets any screen open a record's history: useOpenHistory()(table, id). */
export const HistoryNavContext = createContext<(table: string, id: string) => void>(() => undefined)
export const useOpenHistory = () => useContext(HistoryNavContext)

/** Small HISTORY button for a record's detail panel. */
export function HistoryButton({ table, id }: { table: string; id: string }) {
  const open = useOpenHistory()
  return (
    <button type="button" className="btn" title="Every change to this record: who, when, old value and new value" onClick={() => open(table, id)}>
      HISTORY
    </button>
  )
}

const tabsFor = (x: HistoryState): HistoryTab[] => (x.rec ? ['EDITS', 'RECORD', 'UNDO', 'SYNC', 'GUESSES'] : ['EDITS', 'UNDO', 'SYNC', 'GUESSES'])

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())} ${MON[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Which table a link field points at, so the history can show a code instead of an id. */
const LINKS: Record<string, string> = {
  strain_id: 'strains', culture_id: 'cultures', parent_culture_id: 'cultures', grain_run_id: 'grain_runs', parent_run_id: 'grain_runs',
  block_lot_id: 'block_lots', cook_run_id: 'cook_runs', item_id: 'items', contaminant_id: 'contaminants', sale_id: 'sales',
}
/** A value as text; ids of linked records become their code or name when the record is on file. */
function useShow() {
  const store = useStore()
  return (table: string, f: string, v: unknown, max?: number) => {
    const t = LINKS[f] ?? (f === 'parent_id' ? table : null)
    if (t && typeof v === 'string' && v) {
      const r = store.rows(t).find((x) => x.id === v)
      if (r) return rowName(t, r)
    }
    return showValue(v, max)
  }
}

/** Edit log, newest first. */
function useLog(): EditEntry[] {
  const rows = useTable<EditEntry>(EDIT_LOG)
  return useMemo(() => [...rows].sort((a, b) => b.at.localeCompare(a.at)), [rows])
}

// ---------- the lamp (title bar) ----------

export const LAMP_TEXT: Record<LampState, string> = {
  LOCAL: 'SAVED HERE',
  SYNCED: 'SYNCED',
  WAITING: 'WAITING',
  CONFLICT: 'CONFLICT',
  OFFLINE: 'NO SIGNAL',
  LOCKED: 'LOCKED',
  'NOT SAVED': 'NOT SAVED',
}
export const LAMP_HELP: Record<LampState, string> = {
  LOCAL: 'LOCAL MODE: EVERY CHANGE IS SAVED IN THIS BROWSER STRAIGHT AWAY, WITH OR WITHOUT SIGNAL. NO DATABASE IS LINKED, SO THERE IS NOTHING TO SYNC.',
  SYNCED: 'EVERY CHANGE ON THIS DEVICE HAS REACHED THE DATABASE.',
  WAITING: 'CHANGES SAVED ON THIS DEVICE ARE WAITING TO BE SENT TO THE DATABASE. THEY SEND BY THEMSELVES WHEN SIGNAL RETURNS.',
  CONFLICT: 'ANOTHER DEVICE CHANGED THE SAME RECORD. THE LATER CHANGE WAS KEPT. OPEN HISTORY > SAVING STATUS TO SEE WHAT CHANGED.',
  OFFLINE: 'NO SIGNAL. CHANGES STILL SAVE ON THIS DEVICE AND SEND WHEN SIGNAL RETURNS.',
  LOCKED: 'THE DATABASE IS LOCKED. LOG IN (F8) TO READ OR SAVE.',
  'NOT SAVED': 'THIS BROWSER BLOCKS STORAGE (PRIVATE WINDOW?). NOTHING IS KEPT AFTER YOU CLOSE IT. USE EXPORT BACKUP IN CARGO.',
}

export function SyncLamp({ onOpen }: { onOpen: () => void }) {
  const { lamp, info } = useSync()
  const n = lamp === 'WAITING' ? info?.waiting : lamp === 'CONFLICT' ? info?.conflicts : undefined
  const tone = lamp === 'CONFLICT' || lamp === 'NOT SAVED' || lamp === 'LOCKED' ? 'warn' : lamp === 'WAITING' || lamp === 'OFFLINE' ? 'wait' : 'ok'
  return (
    <button type="button" className={`sync-lamp ${tone}`} onClick={onOpen} title={`${LAMP_HELP[lamp]} TAP FOR HISTORY > SAVING STATUS.`} aria-label={`Save status: ${LAMP_TEXT[lamp]}${n ? ` ${n}` : ''}. Open saving status.`}>
      <i aria-hidden className={info?.syncing ? 'blink' : ''} />
      {LAMP_TEXT[lamp]}
      {n ? ` ${n}` : ''}
    </button>
  )
}

/** What the message line says after an UNDO: what was reversed, and what the next UNDO would reverse. */
export function undoneText(store: Store, label: string | null): string {
  if (!label) return 'NOTHING TO UNDO.'
  const next = store.undoPeek()
  return `UNDONE: ${label}. ${next ? `NEXT UNDO WOULD REVERSE: ${next.label}` : 'NOTHING LEFT TO UNDO.'}`
}

/** UNDO button for the status line. Hidden until there is something to undo. */
export function UndoButton({ say }: { say: Say }) {
  const { last } = useUndo()
  const { sound } = useApp()
  const store = useStore()
  if (!last) return null
  const go = () =>
    void store.undo().then(
      (l) => {
        sound.chirp()
        say(undoneText(store, l), !l)
      },
      (e: Error) => say(e.message.toUpperCase(), true),
    )
  return (
    <button type="button" className="undo-btn" onClick={go} title={`Undo the last change: ${last.label}${last.screen ? ` (${last.screen})` : ''}. Keys: Ctrl+Z, or type UNDO.`}>
      <span aria-hidden>{'↶'} </span>UNDO<span className="undo-what">: {last.label.length > 34 ? `${last.label.slice(0, 32)}..` : last.label}</span>
    </button>
  )
}

// ---------- index (left column on desktop) ----------

export function HistoryIndex({ x, set }: { x: HistoryState; set: SetHistory }) {
  const { sound } = useApp()
  const log = useLog()
  const { lamp, info } = useSync()
  const { list } = useUndo()
  const today = new Date().toISOString().slice(0, 10)
  const nToday = new Set(log.filter((e) => new Date(e.at).toISOString().slice(0, 10) === today).map((e) => e.action_id)).size
  return (
    <>
      <div className="section-title">HISTORY</div>
      <ul className="index-list">
        {tabsFor(x).map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{TAB_LABEL[t]}</span>
            {t === 'EDITS' && <span className="k">{log.length}</span>}
            {t === 'UNDO' && <span className="k">{list.length}</span>}
            {t === 'SYNC' && <span className={`k ${lamp === 'CONFLICT' ? 'lg-warn-text' : ''}`}>{LAMP_TEXT[lamp]}</span>}
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>NOW</div>
      <div className="lg-mini">
        <div>{nToday} CHANGES TODAY</div>
        <div>{list.length} CAN BE UNDONE</div>
        {info && <div className={info.waiting ? 'lg-warn-text' : ''}>{info.waiting} WAITING TO SYNC</div>}
      </div>
    </>
  )
}

// ---------- screen ----------

export function History({ x, set, say }: { x: HistoryState; set: SetHistory; say: Say }) {
  const { sound } = useApp()
  const tabs = tabsFor(x)
  const tab = tabs.includes(x.tab) ? x.tab : 'EDITS'
  return (
    <div className="cook ledger hist">
      <label className="ck-picker">
        <span>SHOW</span>
        <Select value={tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as HistoryTab }))}>
          {tabs.map((t) => <option key={t} value={t}>{TAB_LABEL[t]}</option>)}
        </Select>
      </label>
      {tab === 'EDITS' && <Edits x={x} set={set} say={say} />}
      {tab === 'RECORD' && x.rec && <RecordView rec={x.rec} say={say} />}
      {tab === 'UNDO' && <UndoList say={say} />}
      {tab === 'SYNC' && <SyncView say={say} />}
      {tab === 'GUESSES' && <Guesses />}
    </div>
  )
}

function LastAction({ say }: { say: Say }) {
  const { last } = useUndo()
  const store = useStore()
  const { sound } = useApp()
  return (
    <div className="ck-box">
      <div className="section-title">LAST CHANGE</div>
      {last ? (
        <>
          <div>
            <b className="hist-label">{last.label}</b>
            <span className="dim"> // {last.screen ?? 'APP'} // {when(last.at)}</span>
          </div>
          <div className="lg-btns">
            <button
              type="button"
              className="btn on"
              onClick={() => void store.undo().then((l) => (sound.chirp(), say(undoneText(store, l), !l)), (e: Error) => say(e.message.toUpperCase(), true))}
            >
              UNDO THIS
            </button>
          </div>
          <div className="dim tiny">SAME AS THE UNDO BUTTON UNDER THE TITLE BAR ON EVERY SCREEN, CTRL+Z, OR TYPING UNDO. EACH PRESS REVERSES ONE CHANGE, NEWEST FIRST.</div>
        </>
      ) : (
        <div className="dim">NOTHING TO UNDO YET THIS SESSION. OLDER CHANGES CAN STILL BE PUT BACK FROM THE LIST BELOW.</div>
      )}
    </div>
  )
}

function Operator() {
  const [who, setWho, linked] = useOperator()
  const [draft, setDraft] = useState('')
  if (linked) return <div className="dim">CHANGES ARE SIGNED AS {who} (YOUR LOGIN).</div>
  const save = () => {
    if (!draft.trim()) return
    setWho(draft)
    setDraft('')
  }
  return (
    <div className="ck-field hist-who">
      <span>
        CHANGES ON THIS DEVICE ARE SIGNED AS: <b>{who}</b>
      </span>
      <div className="hist-who-row">
        <input value={draft} placeholder="TYPE YOUR NAME" aria-label="Your name for the history" maxLength={24} onChange={(e) => setDraft(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button type="button" className="btn" disabled={!draft.trim()} onClick={save}>
          SAVE NAME
        </button>
      </div>
      <em>NEW CHANGES USE THE NEW NAME. OLD LINES KEEP THE NAME THEY WERE SAVED WITH.</em>
    </div>
  )
}

const PAGE = 60

/** All edits, newest first, grouped by action. */
function Edits({ x, set, say }: { x: HistoryState; set: SetHistory; say: Say }) {
  const log = useLog()
  const openRec = useOpenHistory()
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const tables = useMemo(() => [...new Set(log.map((e) => e.table_name))].sort((a, b) => tableName(a).localeCompare(tableName(b))), [log])
  const list = x.table ? log.filter((e) => e.table_name === x.table) : log
  const groups = useMemo(() => {
    const out: { id: string; head: EditEntry; rows: EditEntry[] }[] = []
    for (const e of list.slice(0, shown)) {
      const g = out.at(-1)
      if (g && g.id === e.action_id) g.rows.push(e)
      else out.push({ id: e.action_id, head: e, rows: [e] })
    }
    return out
  }, [list, shown])
  return (
    <div className="lg-stack">
      <LastAction say={say} />
      <div className="ck-box">
        <div className="section-title">ALL EDITS</div>
        <Operator />
        <div className="ck-fields">
          <label className="ck-field">
            <span>SECTION</span>
            <Select value={x.table} onChange={(e) => (setShown(PAGE), set({ table: e.target.value }))}>
              <option value="">EVERYTHING</option>
              {tables.map((t) => <option key={t} value={t}>{tableName(t, 2)}{TABLE_SCREEN[t] ? ` (${TABLE_SCREEN[t]})` : ''}</option>)}
            </Select>
          </label>
        </div>
        {groups.length === 0 && <div className="dim">NO CHANGES RECORDED YET. EVERY SAVE, EDIT AND DELETE FROM NOW ON IS LISTED HERE.</div>}
        <div className="hist-list">
          {groups.map((g) => (
            <div key={g.id} className={`hist-act via-${g.head.via}`}>
              <div className="hist-head">
                <b className="hist-label">{g.head.label}</b>
                <span className="dim">{when(g.head.at)} // {g.head.who}{g.head.screen ? ` // ${g.head.screen}` : ''}</span>
              </div>
              <ul className="hist-rows">
                {g.rows.slice(0, open.has(g.id) ? undefined : 8).map((e) => (
                  <EntryLine key={e.id} e={e} onOpen={e.row_id === '*' ? undefined : () => openRec(e.table_name, e.row_id)} />
                ))}
                {g.rows.length > 8 && (
                  <li>
                    <button type="button" className="btn" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n })}>
                      {open.has(g.id) ? 'SHOW FEWER' : `SHOW ALL ${g.rows.length} RECORDS IN THIS CHANGE`}
                    </button>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
        {list.length > shown && (
          <div className="lg-btns">
            <button type="button" className="btn" onClick={() => setShown((n) => n + PAGE)}>SHOW OLDER ({list.length - shown} MORE)</button>
          </div>
        )}
      </div>
    </div>
  )
}

const OP_WORD = { create: 'ADDED', update: 'CHANGED', delete: 'DELETED' } as const

/** One record's line inside an action: tap to see that record's whole history. */
function EntryLine({ e, onOpen }: { e: EditEntry; onOpen?: () => void }) {
  const store = useStore()
  const show = useShow()
  const cur = store.rows(e.table_name).find((r) => r.id === e.row_id)
  const name = rowName(e.table_name, cur ?? e.snapshot ?? (Object.fromEntries(e.changes.map((c) => [c.f, c.new])) as Row))
  const summary =
    e.row_id === '*'
      ? `${showValue(e.changes[0]?.new)} RECORDS`
      : e.op === 'update'
        ? e.changes.slice(0, 2).map((c) => `${fieldName(c.f)} ${show(e.table_name, c.f, c.old, 24)} TO ${show(e.table_name, c.f, c.new, 24)}`).join('; ') + (e.changes.length > 2 ? ` (+${e.changes.length - 2} MORE FIELDS)` : '')
        : ''
  return (
    <li tabIndex={onOpen ? 0 : undefined} className={onOpen ? 'hist-row link' : 'hist-row'} onClick={onOpen} title={onOpen ? 'Open this record\'s full history' : undefined}>
      <span className="hist-op">{OP_WORD[e.op]}</span> <span className="hist-tb">{tableName(e.table_name)}</span> {name}
      {summary && <span className="hist-sum"> // {summary}</span>}
    </li>
  )
}

/** One record's full history, with RESTORE buttons. */
function RecordView({ rec, say }: { rec: { table: string; id: string }; say: Say }) {
  const log = useLog()
  const store = useStore()
  const { sound } = useApp()
  const rows = useTable(rec.table)
  const show = useShow()
  // A new record opens at its top, not where the list was scrolled to.
  useEffect(() => {
    document.querySelector('.main-panel')?.scrollTo({ top: 0 })
  }, [rec.table, rec.id])
  const cur = rows.find((r) => r.id === rec.id) ?? null
  const mine = log.filter((e) => e.table_name === rec.table && e.row_id === rec.id)
  const name = rowName(rec.table, cur ?? mine.find((e) => e.snapshot)?.snapshot ?? null)
  const restore = (e: EditEntry) =>
    void store.restore(e).then(
      (t) => (sound.confirm(), say(t)),
      (er: Error) => say(er.message.toUpperCase(), true),
    )
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">
          {tableName(rec.table)} {name}
        </div>
        <div className={cur ? 'dim' : 'lg-warn-text'}>{cur ? `ON FILE NOW${TABLE_SCREEN[rec.table] ? ` // EDIT IT IN ${TABLE_SCREEN[rec.table]}` : ''}` : 'DELETED. RESTORE IT FROM ITS DELETE LINE BELOW.'}</div>
        {mine.length === 0 && <div className="dim">NO CHANGES RECORDED FOR THIS RECORD SINCE HISTORY WAS SWITCHED ON.</div>}
      </div>
      {mine.map((e) => (
        <div key={e.id} className={`ck-box hist-entry via-${e.via}`}>
          <div className="hist-head">
            <b className="hist-label">{OP_WORD[e.op]}</b>
            <span className="dim">
              {when(e.at)} // {e.who}
              {e.screen ? ` // ${e.screen}` : ''}
            </span>
          </div>
          <div className="dim tiny">{e.label}</div>
          {e.changes.length > 0 && (
            <div className="ck-scroll">
              <table className="lg-table hist-table">
                <thead>
                  <tr>
                    <th>FIELD</th>
                    <th>OLD</th>
                    <th>NEW</th>
                  </tr>
                </thead>
                <tbody>
                  {e.changes.map((c) => (
                    <tr key={c.f}>
                      <td>{fieldName(c.f)}</td>
                      <td>{show(rec.table, c.f, c.old)}</td>
                      <td>{show(rec.table, c.f, c.new)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="lg-btns">
            {e.op === 'update' && cur && (
              <button type="button" className="btn" onClick={() => restore(e)} title="Set these fields back to their OLD values. You can UNDO this too.">
                PUT OLD VALUES BACK
              </button>
            )}
            {e.op === 'delete' && !cur && e.snapshot && (
              <button type="button" className="btn on" onClick={() => restore(e)} title="Bring the deleted record back exactly as it was.">
                RESTORE RECORD
              </button>
            )}
            {e.op === 'create' && cur && <Confirm label="REMOVE RECORD" onYes={() => restore(e)} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function UndoList({ say }: { say: Say }) {
  const { list, undo, store } = useUndo()
  const { sound } = useApp()
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">UNDO LIST // THIS SESSION</div>
        <div className="dim">UNDO REVERSES ONE CHANGE AT A TIME, NEWEST FIRST. A FIELD CHANGED AGAIN SINCE IS LEFT ALONE. THE LIST EMPTIES WHEN YOU CLOSE THE APP; OLDER CHANGES CAN STILL BE PUT BACK FROM ALL EDITS.</div>
        {list.length === 0 ? (
          <div className="dim">NOTHING TO UNDO YET.</div>
        ) : (
          <ol className="hist-undo">
            {list.map((a, i) => (
              <li key={a.id}>
                <b className="hist-label">{a.label}</b>
                <span className="dim">
                  {' '}
                  // {when(a.at)}
                  {a.screen ? ` // ${a.screen}` : ''} // {a.count} {a.count === 1 ? 'RECORD' : 'RECORDS'}
                </span>
                {i === 0 && (
                  <button type="button" className="btn on" onClick={() => void undo().then((l) => (sound.chirp(), say(undoneText(store, l), !l)), (e: Error) => say(e.message.toUpperCase(), true))}>
                    UNDO
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

/** Is this browser's storage marked as kept (not cleared when the phone runs low on space)? */
function usePersisted(): boolean | null {
  const [p, setP] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void navigator.storage?.persisted?.().then((v) => live && setP(v), () => undefined)
    return () => {
      live = false
    }
  }, [])
  return p
}

function SyncView({ say }: { say: Say }) {
  const { lamp, info, backend, store } = useSync()
  const persisted = usePersisted()
  const { sound } = useApp()
  const queue = backend?.pending() ?? []
  const conflicts: Conflict[] = backend?.conflictList() ?? []
  const local = store.backend.kind === 'local'
  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">SAVING STATUS</div>
        <div className="hist-lamp-row">
          <SyncLamp onOpen={() => undefined} />
          <span>{LAMP_HELP[lamp]}</span>
        </div>
        <div className="lg-big">
          <div>
            <span>WHERE DATA IS SAVED</span>
            <b>{local ? 'THIS BROWSER' : store.backend.kind === 'remote' ? 'DATABASE + THIS BROWSER' : store.backend.kind === 'locked' ? 'LOCKED' : 'NOWHERE (BLOCKED)'}</b>
          </div>
          <div>
            <span>WORKS WITH NO SIGNAL</span>
            <b>{store.backend.kind === 'memory' ? 'NO' : 'YES'}</b>
          </div>
          <div>
            <span>KEPT IF DEVICE IS FULL</span>
            <b className={persisted === false ? 'lg-warn-text' : ''}>{persisted === null ? 'UNKNOWN' : persisted ? 'YES' : 'NOT PROMISED'}</b>
          </div>
          {info && (
            <div>
              <span>LAST SYNC</span>
              <b>{info.lastSync ? when(info.lastSync) : 'NOT THIS SESSION'}</b>
            </div>
          )}
        </div>
        {persisted === false && (
          <div className="lg-check warn">
            YOUR DATA IS SAVED, BUT THIS BROWSER HAS NOT PROMISED TO KEEP IT IF THE DEVICE RUNS OUT OF SPACE. TO BE SAFE: ADD MY/CO/L TO THE HOME SCREEN, AND EXPORT A BACKUP FROM CARGO EACH WEEK.
          </div>
        )}
        {local && <div className="dim">NO DATABASE IS LINKED, SO NOTHING IS SENT ANYWHERE. EVERYTHING ABOVE STILL WORKS: UNDO, EDIT HISTORY AND SAVING WITH NO SIGNAL. WHEN A DATABASE IS LINKED LATER, THIS SCREEN SHOWS THE QUEUE.</div>}
        {backend && (
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => void backend.flush().then(() => (sound.chirp(), say(backend.info().waiting ? `STILL WAITING: ${backend.info().waiting}. NO SIGNAL?` : 'SYNCED')))}>
              SYNC NOW
            </button>
          </div>
        )}
      </div>
      {backend && (
        <div className="ck-box">
          <div className="section-title">WAITING TO SEND ({queue.length})</div>
          {queue.length === 0 ? (
            <div className="dim">NOTHING WAITING.</div>
          ) : (
            <ul className="hist-rows">
              {queue.slice(0, 50).map((o) => (
                <li key={o.id} className="hist-row">
                  {when(o.at)} // {o.kind === 'put' ? 'SAVE' : 'DELETE'} {o.ids.length} {tableName(o.table, o.ids.length)}
                </li>
              ))}
              {queue.length > 50 && <li className="dim">+{queue.length - 50} MORE</li>}
            </ul>
          )}
        </div>
      )}
      {backend && (
        <div className="ck-box">
          <div className="section-title">CONFLICTS ({conflicts.length})</div>
          <div className="dim">RULE: IF TWO DEVICES CHANGE DIFFERENT FIELDS, BOTH CHANGES ARE KEPT. IF BOTH CHANGE THE SAME FIELD, THE LATER CHANGE WINS AND IS LISTED HERE.</div>
          {conflicts.length === 0 ? (
            <div className="dim">NO CONFLICTS.</div>
          ) : (
            <>
              <div className="ck-scroll">
                <table className="lg-table hist-table">
                  <thead>
                    <tr>
                      <th>WHEN</th>
                      <th>RECORD</th>
                      <th>FIELD</th>
                      <th>YOURS</th>
                      <th>OTHER</th>
                      <th>KEPT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.slice(0, 100).map((c) => (
                      <tr key={c.id} className={c.seen ? 'dim' : ''} title={c.note}>
                        <td>{when(c.at)}</td>
                        <td>
                          {tableName(c.table)} #{c.row_id.slice(0, 8)}
                        </td>
                        <td>{c.field ? fieldName(c.field) : '-'}</td>
                        <td>{showValue(c.mine, 30)}</td>
                        <td>{showValue(c.theirs, 30)}</td>
                        <td>{c.kept === 'mine' ? 'YOURS' : 'OTHER'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="lg-btns">
                <button type="button" className="btn" onClick={() => void backend.markSeen().then(() => say('CONFLICTS MARKED AS READ'))}>
                  MARK AS READ
                </button>
                <Confirm label="CLEAR THE LIST" onYes={() => void backend.clearConflicts().then(() => say('CONFLICT LIST CLEARED'))} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const GUESS_LIST = [
  'Name in the history with no login: OWNER, until you type your name on ALL EDITS and press SAVE NAME. Staff logins (build G9) replace this.',
  'Conflict rule: per field, the later change wins (database time against the time this device saved). Edits to a record deleted elsewhere bring it back.',
  'UNDO keeps the last 40 changes and empties when the app closes. Older changes are put back from ALL EDITS.',
  'Changes touching more than 200 records at once (an import) keep one summary line per section in the history.',
  'Changes made within 0.7 seconds of each other with no name count as one change for UNDO.',
  'Device settings (look, sound, breaker simulator, crop plan picks) are not in the history or UNDO; they are not farm records.',
]
function Guesses() {
  return (
    <div className="ck-box">
      <div className="section-title">GUESSES WAITING FOR REVIEW</div>
      <ul className="ck-guesses">{GUESS_LIST.map((g) => <li key={g}><Guess /> {g}</li>)}</ul>
    </div>
  )
}
