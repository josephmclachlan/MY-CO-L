import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HistoryButton } from './History'
import { Confirm, Guess } from './CookParts'
import { Box, Buttons, Chips, Fold, getInitials, setInitials, useRun, type Say } from './FacilityParts'
import { useFacilityEditor, type FacilityData } from '../store/useFacility'
import { CHECKLISTS, type CheckTemplate } from '../data/checklists'
import {
  CLEAN_LABEL,
  CLEAN_TASKS,
  MAINT_CATEGORIES,
  MAINT_CAT_LABEL,
  ROOM_LABEL,
  ROOM_LIST,
  STANDARD_MAINT,
  genHoursSince,
  type CheckItemState,
  type CleanEntry,
  type CleanTask,
  type MaintCategory,
  type MaintItem,
  type MaintStatus,
} from '../lib/facility'
import { deleteClean, deleteMaint, deleteMaintLog, deleteRun, markMaintDone, saveClean, saveMaint, seedMaint, setMaintActive, signOff } from '../lib/facilityActions'

// ==========================================================================================
// MAINTENANCE + EQUIPMENT REGISTER
// ==========================================================================================

const STATE_TEXT: Record<string, string> = { late: 'OVERDUE', due: 'DUE TODAY', soon: 'COMING UP', ok: 'ON TIME', none: 'NO SCHEDULE', never: 'NEVER', off: 'OFF' }

export function MaintTab({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const [edit, setEdit] = useState<MaintItem | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [showOff, setShowOff] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const off = d.maint.filter((m) => m.active === false)
  const logs = useMemo(() => [...d.maintLog].sort((a, b) => b.done_on.localeCompare(a.done_on) || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [d.maintLog])
  const nameOf = (id: string) => d.maint.find((m) => m.id === id)?.name ?? 'REMOVED ITEM'
  const genTotal = genHoursSince(d.cuts, null, d.now)
  const startEdit = (m: MaintItem | null) => {
    setEdit(m)
    setShowForm(true)
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  return (
    <div className="lg-stack">
      <Box title={`EQUIPMENT AND UPKEEP SCHEDULE // ${d.board.length} ITEMS`} extra={<Guess />}>
        {d.board.length === 0 ? (
          <>
            <div className="dim">NOTHING ON THE LIST YET. START WITH THE STANDARD SCHEDULE ({STANDARD_MAINT.length} JOBS FOR THIS FARM'S EQUIPMENT) AND CHANGE ANYTHING YOU LIKE.</div>
            <div className="lg-btns">
              <button type="button" className="btn on" onClick={() => void run('STANDARD SCHEDULE ADDED', async () => { const n = await seedMaint(store, d.today); return `STANDARD SCHEDULE ADDED // ${n} JOBS` })}>ADD THE STANDARD SCHEDULE</button>
            </div>
          </>
        ) : (
          <ul className="fc-cards">
            {d.board.map((m) => (
              <MaintRow key={m.item.id} m={m} open={done === m.item.id} onOpen={() => setDone(done === m.item.id ? null : m.item.id)} onEdit={() => startEdit(m.item)} say={say} today={d.today} />
            ))}
          </ul>
        )}
        <div className="dim tiny">GENERATOR HOURS COME FROM THE POWER CUTS LOG: {genTotal.toFixed(1)} H IN TOTAL. "MARK DONE" STARTS THE CLOCK AGAIN FROM THE DAY YOU PICK. INTERVALS ARE WORKING NUMBERS: FOLLOW THE MAKER'S MANUAL WHERE IT IS STRICTER.</div>
        {d.board.length > 0 && d.board.length < STANDARD_MAINT.length && (
          <div className="lg-btns"><button type="button" className="btn" onClick={() => void run('STANDARD SCHEDULE TOPPED UP', async () => { const n = await seedMaint(store, d.today); return `${n} MISSING STANDARD JOBS ADDED` })}>ADD MISSING STANDARD JOBS</button></div>
        )}
      </Box>

      <div ref={formRef}>
        {showForm ? (
          <MaintForm key={edit?.id ?? 'new'} d={d} edit={edit} say={say} onDone={() => (setShowForm(false), setEdit(null))} />
        ) : (
          <Box title="ADD EQUIPMENT OR A JOB">
            <button type="button" className="btn on" onClick={() => startEdit(null)}>ADD ONE</button>
            <div className="dim tiny">THE REGISTER: NAME, MAKE AND MODEL, SERIAL NUMBER, ROOM, INSTALL DAY, AND HOW OFTEN IT NEEDS UPKEEP.</div>
          </Box>
        )}
      </div>

      <Box title={`DONE LOG // ${logs.length}`}>
        {logs.length === 0 ? <div className="dim">NOTHING MARKED DONE YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>JOB</th><th className="hide-sm">BY</th><th className="hide-sm">NOTES</th><th /></tr></thead>
              <tbody>
                {logs.slice(0, 40).map((l) => (
                  <tr key={l.id}>
                    <td>{l.done_on}</td><td>{nameOf(l.item_id)}</td><td className="hide-sm">{l.who ?? '--'}</td><td className="hide-sm">{l.notes ?? '--'}</td>
                    <td className="mn-act"><HistoryButton table="maint_log" id={l.id} /><Confirm label="DELETE" onYes={() => void run('DONE LINE DELETED', () => deleteMaintLog(store, l.id))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      {off.length > 0 && (
        <Box title={`REMOVED FROM THE LIST // ${off.length}`}>
          <button type="button" className="btn" onClick={() => setShowOff(!showOff)}>{showOff ? 'HIDE' : 'SHOW'}</button>
          {showOff && off.map((m) => (
            <div key={m.id} className="fc-off">
              <span>{m.name}</span>
              <button type="button" className="btn" onClick={() => void run('PUT BACK ON THE LIST', () => setMaintActive(store, m.id, true))}>PUT BACK</button>
              <Confirm label="DELETE FOR GOOD" onYes={() => void run('ITEM DELETED', () => deleteMaint(store, m.id))} />
            </div>
          ))}
        </Box>
      )}
    </div>
  )
}

function MaintRow({ m, open, onOpen, onEdit, say, today }: { m: MaintStatus; open: boolean; onOpen: () => void; onEdit: () => void; say: Say; today: string }) {
  const run = useRun(say)
  const store = useStore()
  const [day, setDay] = useState(today)
  const [who, setWho] = useState(getInitials)
  const [notes, setNotes] = useState('')
  const it = m.item
  const warn = m.state === 'late' || m.state === 'due'
  return (
    <li className={`fc-card ${warn ? 'warn' : ''}`}>
      <div className="fc-card-head">
        <span className="fc-card-name">{it.name}</span>
        <span className={`fc-state ${warn ? 'warn' : ''}`}>{STATE_TEXT[m.state]}</span>
      </div>
      <div className="fc-card-sub">{it.room_id ? `${ROOM_LABEL[it.room_id] ?? it.room_id} // ` : ''}{m.text}{it.make_model ? ` // ${it.make_model}` : ''}</div>
      <div className="lg-btns">
        <button type="button" className={`btn ${open ? 'on' : ''}`} aria-expanded={open} onClick={onOpen}>{open ? 'CLOSE' : 'MARK DONE'}</button>
        <button type="button" className="btn" onClick={onEdit}>EDIT</button>
      </div>
      {open && (
        <div className="fc-card-body">
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>DAY DONE</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
            <label className="ck-field"><span>DONE BY</span><input value={who} placeholder="INITIALS" onChange={(e) => setWho(e.target.value)} /></label>
            <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => void run(`DONE: ${it.name}`, async () => { setInitials(who); await markMaintDone(store, it.id, day, who, notes, today) }).then((ok) => ok && (onOpen(), setNotes('')))}>SAVE AS DONE</button>
            <HistoryButton table="maint_items" id={it.id} />
            <Confirm label="REMOVE FROM LIST" onYes={() => void run(`REMOVED: ${it.name}`, () => setMaintActive(store, it.id, false))} />
          </div>
          {it.notes && <div className="dim tiny">{it.notes}</div>}
          {it.serial && <div className="dim tiny">SERIAL {it.serial}{it.installed_on ? ` // INSTALLED ${it.installed_on}` : ''}</div>}
        </div>
      )}
    </li>
  )
}

function MaintForm({ d, edit, say, onDone }: { d: FacilityData; edit: MaintItem | null; say: Say; onDone: () => void }) {
  const run = useRun(say)
  const store = useStore()
  const [name, setName] = useState(edit?.name ?? '')
  const [cat, setCat] = useState<MaintCategory>(edit?.category ?? 'other')
  const [room, setRoom] = useState(edit?.room_id ?? '')
  const [make, setMake] = useState(edit?.make_model ?? '')
  const [serial, setSerial] = useState(edit?.serial ?? '')
  const [installed, setInstalled] = useState(edit?.installed_on ?? '')
  const [days, setDays] = useState(edit?.every_days ? String(edit.every_days) : '')
  const [hours, setHours] = useState(edit?.every_hours ? String(edit.every_hours) : '')
  const [started, setStarted] = useState(edit?.started_on ?? d.today)
  const [notes, setNotes] = useState(edit?.notes ?? '')
  const save = () =>
    void run(edit ? `CHANGED: ${name.toUpperCase()}` : `ADDED: ${name.toUpperCase()}`, async () => {
      await saveMaint(store, edit?.id ?? null, { name, category: cat, room: room || null, make: make || null, serial: serial || null, installed: installed || null, everyDays: days.trim() ? Number(days) : null, everyHours: hours.trim() ? Number(hours) : null, startedOn: started, notes })
    }).then((ok) => ok && onDone())
  return (
    <Box title={edit ? 'CHANGE THIS ITEM' : 'ADD EQUIPMENT OR A JOB'}>
      <label className="ck-field"><span>NAME</span><input value={name} placeholder="E.G. WALK-IN FRIDGE COIL CLEAN" onChange={(e) => setName(e.target.value)} /></label>
      <div className="ck-fields">
        <label className="ck-field"><span>KIND</span><Select aria-label="Kind" value={cat} onChange={(e) => setCat(e.target.value as MaintCategory)}>{MAINT_CATEGORIES.map((c) => <option key={c} value={c}>{MAINT_CAT_LABEL[c]}</option>)}</Select></label>
        <label className="ck-field"><span>ROOM</span><Select aria-label="Room" value={room} onChange={(e) => setRoom(e.target.value)}><option value="">ANY / NONE</option>{[...ROOM_LIST, { id: 'outside', label: 'OUTSIDE' }].map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></label>
      </div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>EVERY (DAYS)</span><input inputMode="numeric" value={days} placeholder="E.G. 90" onChange={(e) => setDays(e.target.value)} /></label>
        <label className="ck-field"><span>OR EVERY (GENERATOR HOURS)</span><input inputMode="decimal" value={hours} placeholder="E.G. 100" onChange={(e) => setHours(e.target.value)} /><em>COUNTED FROM THE POWER CUTS LOG.</em></label>
        <label className="ck-field"><span>CLOCK STARTS</span><PickInput type="date" value={started} onChange={(e) => setStarted(e.target.value)} /></label>
      </div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>MAKE AND MODEL</span><input value={make} onChange={(e) => setMake(e.target.value)} /></label>
        <label className="ck-field"><span>SERIAL NUMBER</span><input value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
        <label className="ck-field"><span>INSTALLED</span><PickInput type="date" value={installed} clearable onChange={(e) => setInstalled(e.target.value)} /></label>
      </div>
      <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="lg-btns">
        <button type="button" className="btn on lg-save" onClick={save}>SAVE</button>
        <button type="button" className="btn" onClick={onDone}>CANCEL</button>
      </div>
    </Box>
  )
}

// ==========================================================================================
// CLEANING
// ==========================================================================================

export function CleanTab({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const [edit, setEdit] = useState<CleanEntry | null>(null)
  const [room, setRoom] = useState<string>('lab')
  const [day, setDay] = useState(d.today)
  const [tasks, setTasks] = useState<CleanTask[]>(['wipe', 'sanitise'])
  const [product, setProduct] = useState('')
  const [who, setWho] = useState(getInitials)
  const [notes, setNotes] = useState('')
  const [all, setAll] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => [...d.cleanLog].sort((a, b) => b.cleaned_on.localeCompare(a.cleaned_on) || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [d.cleanLog])
  const reset = () => { setEdit(null); setNotes(''); setDay(d.today) }
  const save = () =>
    void run(edit ? 'CLEANING ENTRY CHANGED' : `CLEANED // ${ROOM_LABEL[room]}`, async () => {
      setInitials(who)
      await saveClean(store, edit?.id ?? null, { day, room, tasks, product, who, notes }, d.today)
    }).then((ok) => ok && reset())
  const startEdit = (c: CleanEntry) => {
    setEdit(c); setRoom(c.room_id); setDay(c.cleaned_on); setTasks(c.tasks); setProduct(c.product ?? ''); setWho(c.who ?? getInitials()); setNotes(c.notes ?? '')
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  return (
    <div className="lg-stack">
      <Box title="WHEN EACH ROOM WAS LAST CLEANED" extra={<Guess />}>
        <div className="rc-wrap">
          <table className="lg-table rc-table">
            <thead><tr><th>ROOM</th><th>LAST CLEANED</th><th>TARGET</th><th>STATE</th></tr></thead>
            <tbody>
              {d.cleanDue.map((c) => (
                <tr key={c.room} className={c.state === 'late' ? 'od-row over' : ''}>
                  <td>{ROOM_LABEL[c.room]}</td>
                  <td>{c.last ? `${c.last.cleaned_on}${c.last.who ? ` BY ${c.last.who}` : ''}` : 'NEVER LOGGED'}</td>
                  <td>{c.every ? `EVERY ${c.every} D` : 'NONE'}</td>
                  <td className={c.state === 'late' ? 'lg-warn-text' : ''}>{c.state === 'late' ? `OVERDUE ${-(c.left as number)} D` : c.state === 'due' ? 'DUE TODAY' : c.state === 'ok' || c.state === 'soon' ? `NEXT ${c.dueOn?.slice(5)}` : c.state === 'never' ? 'NO CLEAN LOGGED' : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CleanEvery d={d} say={say} />
      </Box>

      <div ref={formRef}>
        <Box title={edit ? 'CHANGE THIS ENTRY' : 'LOG A CLEAN'}>
          <div className="ck-field"><span>ROOM</span><Buttons label="Room" value={room as 'lab'} options={ROOM_LIST} onPick={setRoom} /></div>
          <div className="ck-field"><span>WHAT WAS DONE</span><Chips label="Jobs done" value={tasks} options={CLEAN_TASKS.map((t) => ({ id: t.id, label: t.label }))} onChange={setTasks} /></div>
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
            <label className="ck-field"><span>PRODUCT USED</span><input value={product} placeholder="E.G. 70% ALCOHOL" onChange={(e) => setProduct(e.target.value)} /></label>
            <label className="ck-field"><span>DONE BY</span><input value={who} placeholder="INITIALS" onChange={(e) => setWho(e.target.value)} /></label>
          </div>
          <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="lg-btns">
            <button type="button" className="btn on lg-save" onClick={save}>SAVE</button>
            {edit && <button type="button" className="btn" onClick={reset}>CANCEL</button>}
          </div>
        </Box>
      </div>

      <Box title={`CLEANING LOG // ${list.length}`}>
        {list.length === 0 ? <div className="dim">NOTHING LOGGED YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>ROOM</th><th>DONE</th><th className="hide-sm">PRODUCT</th><th className="hide-sm">BY</th><th /></tr></thead>
              <tbody>
                {(all ? list.slice(0, 500) : list.slice(0, 20)).map((c) => (
                  <tr key={c.id}>
                    <td>{c.cleaned_on}</td><td>{ROOM_LABEL[c.room_id] ?? c.room_id}</td>
                    <td>{c.tasks.map((t) => CLEAN_LABEL[t]?.split(' (')[0] ?? t).join(', ')}</td>
                    <td className="hide-sm">{c.product ?? '--'}</td><td className="hide-sm">{c.who ?? '--'}</td>
                    <td className="mn-act">
                      <button type="button" className="btn" onClick={() => startEdit(c)}>EDIT</button>
                      <HistoryButton table="clean_log" id={c.id} />
                      <Confirm label="DELETE" onYes={() => void run('CLEANING ENTRY DELETED', () => deleteClean(store, c.id))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 20 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW THE NEWEST 20' : `SHOW MORE (${Math.min(500, list.length)})`}</button>}
      </Box>
    </div>
  )
}

function CleanEvery({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const [, save] = useFacilityEditor()
  const [draft, setDraft] = useState<Record<string, string>>({})
  return (
    <Fold title="CLEAN EVERY (DAYS)">
      <div className="mn-budget">
        {ROOM_LIST.map((r) => (
          <div key={r.id} className="mn-brow">
            <label className="ck-field"><span>{r.label}</span><input inputMode="numeric" value={draft[r.id] ?? String(d.settings.cleanEvery[r.id])} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} /></label>
            <button type="button" className="btn" onClick={() => void run(`CLEAN ${r.label} EVERY ${draft[r.id] ?? d.settings.cleanEvery[r.id]} D`, async () => {
              const n = Number(draft[r.id] ?? d.settings.cleanEvery[r.id])
              if (!Number.isInteger(n) || n < 0 || n > 365) throw new Error('DAYS MUST BE A WHOLE NUMBER, 0 TO 365.')
              await save({ cleanEvery: { ...d.settings.cleanEvery, [r.id]: n } }, `CLEAN INTERVAL // ${r.label}`)
              setDraft({ ...draft, [r.id]: String(n) })
            })}>SET</button>
          </div>
        ))}
      </div>
      <div className="dim tiny">0 = NO REMINDER FOR THAT ROOM.</div>
    </Fold>
  )
}

// ==========================================================================================
// CHECKLISTS
// ==========================================================================================

const DRAFT_KEY = (k: string) => `mycol.fac.check.${k}.v1`
function loadDraft(k: string): Record<string, CheckItemState> {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(k))
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}
function saveDraft(k: string, v: Record<string, CheckItemState>) {
  try {
    if (Object.keys(v).length) localStorage.setItem(DRAFT_KEY(k), JSON.stringify(v))
    else localStorage.removeItem(DRAFT_KEY(k))
  } catch {
    /* storage blocked: the ticks only last until the page is closed */
  }
}

export function CheckTab({ d, say, key0 }: { d: FacilityData; say: Say; key0: string | null }) {
  const [key, setKey] = useState(key0 ?? CHECKLISTS[0].key)
  const { sound } = useApp()
  useEffect(() => { if (key0) setKey(key0) }, [key0])
  const t = CHECKLISTS.find((c) => c.key === key) as CheckTemplate
  const due = d.checkDue.find((c) => c.template.key === key)
  return (
    <div className="lg-stack">
      <Box title="PICK A CHECKLIST">
        <div className="lg-btns" role="group" aria-label="Checklist">
          {CHECKLISTS.map((c) => {
            const cd = d.checkDue.find((x) => x.template.key === c.key)
            return (
              <button key={c.key} type="button" className={`btn ${c.key === key ? 'on' : ''}`} aria-pressed={c.key === key} onClick={() => (sound.chirp(), setKey(c.key))}>
                {c.title}{cd && (cd.state === 'late' || cd.state === 'due') ? ' !' : ''}
              </button>
            )
          })}
        </div>
        <div className="dim">{t.when.toUpperCase()}</div>
        <div className="dim tiny">
          LAST SIGNED OFF: {due?.last ? `${due.last.done_on} BY ${due.last.who ?? '--'}` : 'NEVER'}{due?.dueOn ? ` // NEXT BY ${due.dueOn}` : ''}.
        </div>
      </Box>
      <Run key={key} t={t} d={d} say={say} />
      <Past key={`p${key}`} t={t} d={d} say={say} />
    </div>
  )
}

function Run({ t, d, say }: { t: CheckTemplate; d: FacilityData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const { sound } = useApp()
  const [items, setItems] = useState<Record<string, CheckItemState>>(() => loadDraft(t.key))
  const [who, setWho] = useState(getInitials)
  const [note, setNote] = useState('')
  const set = (id: string, v: CheckItemState | null) => {
    const next = { ...items }
    if (v) next[id] = v
    else delete next[id]
    setItems(next)
    saveDraft(t.key, next)
  }
  const answered = t.steps.filter((s) => items[s.id]).length
  const sign = () =>
    void run(`SIGNED OFF // ${t.title}`, async () => {
      setInitials(who)
      await signOff(store, t, Object.values(items), who, note, Date.now())
    }).then((ok) => ok && (setItems({}), saveDraft(t.key, {}), setNote('')))
  return (
    <Box title={`${t.title} // ${answered} OF ${t.steps.length} ANSWERED`}>
      <ol className="fc-steps">
        {t.steps.map((s, i) => {
          const it = items[s.id]
          return (
            <li key={s.id} className={it ? `done ${it.state}` : ''}>
              <div className="fc-step">
                <button type="button" className={`btn fc-tick ${it?.state === 'ok' ? 'on' : ''}`} aria-pressed={it?.state === 'ok'} aria-label={`Step ${i + 1} done`} onClick={() => (sound.chirp(), set(s.id, it?.state === 'ok' ? null : { id: s.id, state: 'ok' }))}>
                  {it?.state === 'ok' ? '[X]' : '[ ]'}
                </button>
                <span className="fc-text"><b>{i + 1}.</b> {s.text}{s.why ? <small className="dim"> {s.why}</small> : null}</span>
                <button type="button" className={`btn ${it?.state === 'skip' ? 'on' : ''}`} aria-pressed={it?.state === 'skip'} onClick={() => (sound.chirp(), set(s.id, it?.state === 'skip' ? null : { id: s.id, state: 'skip', note: '' }))}>SKIP</button>
              </div>
              {it?.state === 'skip' && (
                <input className="fc-why" aria-label={`Why step ${i + 1} was skipped`} value={it.note ?? ''} placeholder="WHY WAS THIS STEP SKIPPED?" onChange={(e) => set(s.id, { id: s.id, state: 'skip', note: e.target.value })} />
              )}
            </li>
          )
        })}
      </ol>
      <div className="lg-btns">
        <button type="button" className="btn" onClick={() => (sound.chirp(), setItems(Object.fromEntries(t.steps.map((s) => [s.id, items[s.id]?.state === 'skip' ? items[s.id] : { id: s.id, state: 'ok' as const }]))), saveDraft(t.key, Object.fromEntries(t.steps.map((s) => [s.id, items[s.id]?.state === 'skip' ? items[s.id] : { id: s.id, state: 'ok' as const }]))))}>TICK ALL STEPS</button>
        <button type="button" className="btn" onClick={() => (setItems({}), saveDraft(t.key, {}))}>CLEAR TICKS</button>
      </div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>SIGNED BY (NAME OR INITIALS)</span><input value={who} onChange={(e) => setWho(e.target.value)} /></label>
        <label className="ck-field"><span>NOTES</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <button type="button" className="btn on lg-save" onClick={sign}>SIGN OFF ({d.today})</button>
      <div className="dim tiny">YOUR TICKS ARE KEPT ON THIS PHONE UNTIL YOU SIGN OFF, EVEN IF YOU CLOSE THE PAGE. A SKIPPED STEP NEEDS A REASON.</div>
    </Box>
  )
}

function Past({ t, d, say }: { t: CheckTemplate; d: FacilityData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const list = useMemo(() => d.runs.filter((r) => r.template === t.key).sort((a, b) => b.finished_at.localeCompare(a.finished_at)), [d.runs, t.key])
  return (
    <Box title={`SIGN-OFFS // ${list.length}`}>
      {list.length === 0 ? <div className="dim">NONE YET.</div> : (
        <div className="rc-wrap">
          <table className="lg-table rc-table">
            <thead><tr><th>DAY</th><th>BY</th><th>SKIPPED</th><th className="hide-sm">NOTES</th><th /></tr></thead>
            <tbody>
              {list.slice(0, 30).map((r) => {
                const sk = r.items.filter((i) => i.state === 'skip')
                return (
                  <tr key={r.id}>
                    <td>{r.done_on}</td><td>{r.who ?? '--'}</td>
                    <td>{sk.length ? sk.map((i) => `${t.steps.findIndex((s) => s.id === i.id) + 1}: ${i.note ?? ''}`).join('; ') : 'NONE'}</td>
                    <td className="hide-sm">{r.note ?? '--'}</td>
                    <td className="mn-act"><HistoryButton table="checklist_runs" id={r.id} /><Confirm label="DELETE" onYes={() => void run('SIGN-OFF DELETED', () => deleteRun(store, r.id))} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <CheckEvery d={d} say={say} />
    </Box>
  )
}

function CheckEvery({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const [, save] = useFacilityEditor()
  const [draft, setDraft] = useState<Record<string, string>>({})
  return (
    <Fold title="SIGN OFF EVERY (DAYS)">
      <div className="mn-budget">
        {CHECKLISTS.map((c) => (
          <div key={c.key} className="mn-brow">
            <label className="ck-field"><span>{c.title}</span><input inputMode="numeric" value={draft[c.key] ?? String(d.settings.checkEvery[c.key])} onChange={(e) => setDraft({ ...draft, [c.key]: e.target.value })} /></label>
            <button type="button" className="btn" onClick={() => void run(`${c.title} EVERY ${draft[c.key] ?? d.settings.checkEvery[c.key]} D`, async () => {
              const n = Number(draft[c.key] ?? d.settings.checkEvery[c.key])
              if (!Number.isInteger(n) || n < 0 || n > 365) throw new Error('DAYS MUST BE A WHOLE NUMBER, 0 TO 365.')
              await save({ checkEvery: { ...d.settings.checkEvery, [c.key]: n } }, `CHECKLIST INTERVAL // ${c.title}`)
              setDraft({ ...draft, [c.key]: String(n) })
            })}>SET</button>
          </div>
        ))}
      </div>
      <div className="dim tiny">0 = NO REMINDER. THE POWER CUT CHECKLIST HAS NO SCHEDULE: IT IS FOR WHEN THE GRID FAILS.</div>
    </Fold>
  )
}

