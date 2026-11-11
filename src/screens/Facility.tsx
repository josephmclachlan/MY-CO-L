import { useEffect, useState } from 'react'
import { useStationTabs } from '../nav/StationContext'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { Confirm, Guess } from './CookParts'
import { Box, Buttons, copyText, useRun, type Say } from './FacilityParts'
import { PowerTab, WaterTab } from './FacilityPower'
import { CheckTab, CleanTab, MaintTab } from './FacilityUpkeep'
import { useFacility, useFacilityEditor, useReminders, type FacilityData } from '../store/useFacility'
import {
  ROUTINE,
  cutStats,
  fmtHours,
  fmtMin,
  icsFor,
  stamp,
  toNotify,
  type BoardLine,
  type Reminder,
} from '../lib/facility'
import { monthLabel } from '../lib/money'
import { addCustom, deleteCustom, finishCustom, snooze } from '../lib/facilityActions'
import { completeCustom } from '../lib/facility'
import { addDays } from '../lib/xeno'

// FACILITY LOGS (build G7): power cuts, water, upkeep, cleaning, checklists and reminders.
// Times are the farm clock (Costa Rica, UTC-6).

export type FacTab = 'STATUS' | 'POWER CUTS' | 'WATER' | 'CHECKLISTS' | 'MAINTENANCE' | 'CLEANING' | 'REMINDERS' | 'GUESSES'
export const FAC_TABS: FacTab[] = ['STATUS', 'POWER CUTS', 'WATER', 'CHECKLISTS', 'MAINTENANCE', 'CLEANING', 'REMINDERS', 'GUESSES']
export interface FacState {
  tab: FacTab
  /** Checklist to open on CHECKLISTS (key). */
  check: string | null
}
export const FAC_START: FacState = { tab: 'STATUS', check: null }
type SetFac = (p: Partial<FacState>) => void

export type GoScreen = 'FACILITY' | 'MONEY' | 'MISSION' | 'XENO' | 'CARGO' | 'TRADE' | 'ATMOS'

export const FACILITY_GUESSES = [
  'Times are the farm clock (Costa Rica, UTC-6, no daylight saving). A day or month is always the farm\'s day or month, whatever the phone clock says.',
  'NO GRID = time ICE power was out. ON GENERATOR = part of that time the generator ran. FULLY DARK = no grid and no generator. If the generator only runs the emergency list, the farm is still partly dark: the log counts it as covered.',
  'Generator hours come from the run times you log, or from the meter hours if you type them (the meter wins). Hours after a service day count toward the next service; a run on the service day itself counts as before it.',
  'Fuel: propane in kg, gasoline in litres. Fuel and the cut count belong to the month the cut started; the hours are split by month.',
  'Water limits per sampling point are working numbers, not Joseph\'s or the textbook\'s: RO feed up to 30 ppm TDS and 5 ppm hardness; humidifier tank bleach 150-250 ppm; raw and mix water up to 500 ppm TDS. Change them on WATER > LIMITS.',
  'Test frequency: RO feed and humidifier tank weekly, filtered every 2 weeks, raw and mix water monthly. A point you have never tested only nags for the RO feed and the humidifier tank.',
  'The maintenance schedule (17 jobs) uses working intervals, not the makers\'. Generator oil: every 100 run hours or a year; a first change after 20 hours is a note, not a rule.',
  'Cleaning targets per room: lab 2 days, packing 3, boiling room 7, fruiting 7, incubation 14.',
  'Checklists are written from the farm\'s routine (Monday steam run, Tuesday knock, steam hold 4 h from the coldest core at 93 C) and are a draft for Joseph to edit.',
  'Reminders appear in the app and as a count on the main menu. A web page cannot ring a phone that is closed: for that, download the calendar file and open it on the phone (alerts at 08:00 on the day). Phone alerts while the app is open need permission.',
  'Weekly routine reminders follow the week as noted: Mon steam run, Tue knock, Wed grain, Thu cultures, Fri pick and sell, Sat sales, Sun rest.',
  'Reminders show 2 days before they are due. SNOOZE hides one for 1 or 7 days.',
]

// ---------- index (left menu) ----------

export function FacilityIndex({ x, set }: { x: FacState; set: SetFac }) {
  const { sound } = useApp()
  const d = useReminders()
  const o = d.summary
  const tabs = useStationTabs(FAC_TABS)
  return (
    <>
      {tabs.length > 1 && <div className="section-title">FACILITY LOGS</div>}
      {tabs.length > 1 && <ul className="index-list">
        {tabs.map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{t}</span>
            {t === 'POWER CUTS' && o.open && <span className="k">OUT NOW</span>}
            {t === 'REMINDERS' && d.reminders.length > 0 && <span className="k">{d.reminders.length}</span>}
            {t === 'MAINTENANCE' && d.board.filter((m) => m.state === 'late' || m.state === 'due').length > 0 && <span className="k">{d.board.filter((m) => m.state === 'late' || m.state === 'due').length} DUE</span>}
          </li>
        ))}
      </ul>}
      <div className="section-title" style={{ marginTop: 10 }}>{monthLabel(o.thisMonth.month)} SO FAR</div>
      <div className="lg-mini">
        <div>CUTS {o.thisMonth.cuts}</div>
        <div>NO GRID {fmtHours(o.thisMonth.gridMin)}</div>
        <div>FULLY DARK {fmtHours(o.thisMonth.darkMin)}</div>
        <div>GEN HOURS {o.thisMonth.genHours.toFixed(1)}</div>
      </div>
    </>
  )
}

// ---------- shell ----------

export function Facility({ x, set, say, onGo }: { x: FacState; set: SetFac; say: Say; onGo: (screen: GoScreen, tab?: string) => void }) {
  const { sound } = useApp()
  const d = useReminders()
  const tabs = useStationTabs(FAC_TABS)
  return (
    <div className="cook ledger od mn fc">
      {tabs.length > 1 && <label className="ck-picker">
        <span>SHOW ({tabs.length} SCREENS)</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as FacTab }))}>
          {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </label>}
      {x.tab === 'STATUS' && <StatusTab d={d} lines={d.lines} reminders={d.reminders} set={set} onGo={onGo} say={say} />}
      {x.tab === 'POWER CUTS' && <PowerTab d={d} say={say} />}
      {x.tab === 'WATER' && <WaterTab d={d} say={say} />}
      {x.tab === 'CHECKLISTS' && <CheckTab d={d} say={say} key0={x.check} />}
      {x.tab === 'MAINTENANCE' && <MaintTab d={d} say={say} />}
      {x.tab === 'CLEANING' && <CleanTab d={d} say={say} />}
      {x.tab === 'REMINDERS' && <RemindersTab d={d} reminders={d.reminders} say={say} onGo={onGo} set={set} />}
      {x.tab === 'GUESSES' && (
        <div className="ck-box">
          <div className="section-title">BEST GUESSES WAITING FOR JOSEPH <Guess /></div>
          <ul className="ck-guesses">{FACILITY_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

// ---------- status ----------

function StatusTab({ d, lines, reminders, set, onGo, say }: { d: FacilityData; lines: BoardLine[]; reminders: Reminder[]; set: SetFac; onGo: (s: GoScreen, tab?: string) => void; say: Say }) {
  const { sound } = useApp()
  const o = d.summary
  const urgent = reminders.slice(0, 8)
  return (
    <div className="lg-stack">
      <Box title="FARM STATUS">
        <StatusLines lines={lines} />
        {o.open && <div className="lg-warn">POWER IS OUT: {fmtMin(cutStats(o.open, d.now).gridMin)} SO FAR, SINCE {stamp(Date.parse(o.open.down_at))}. OPEN POWER CUTS WHEN IT RETURNS.</div>}
        <div className="lg-btns">
          <button type="button" className="btn" onClick={() => (sound.chirp(), set({ tab: 'POWER CUTS' }))}>POWER CUTS</button>
          <button type="button" className="btn" onClick={() => (sound.chirp(), set({ tab: 'WATER' }))}>WATER</button>
          <button type="button" className="btn" onClick={() => (sound.chirp(), set({ tab: 'CHECKLISTS' }))}>CHECKLISTS</button>
        </div>
      </Box>
      <Box title={`NEEDS ATTENTION // ${reminders.length}`}>
        {urgent.length === 0 ? <div className="dim">NOTHING IS DUE. THE LATTICE HOLDS.</div> : <ReminderList items={urgent} onGo={onGo} say={say} compact />}
        {reminders.length > urgent.length && <button type="button" className="btn" onClick={() => (sound.chirp(), set({ tab: 'REMINDERS' }))}>SEE ALL {reminders.length}</button>}
      </Box>
    </div>
  )
}

export function StatusLines({ lines }: { lines: BoardLine[] }) {
  return (
    <dl className="fc-lines">
      {lines.map((l) => (
        <div key={l.label} className={l.warn ? 'warn' : ''}>
          <dt>{l.label}</dt>
          <dd>{l.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------- reminders ----------

function ReminderList({ items, onGo, say, compact }: { items: Reminder[]; onGo: (s: GoScreen, tab?: string) => void; say: Say; compact?: boolean }) {
  const run = useRun(say)
  const store = useStore()
  const [, ] = useFacilityEditor()
  const d = useFacility()
  return (
    <ul className="fc-rem">
      {items.map((r) => (
        <li key={r.key} className={r.warn ? 'warn' : ''}>
          <span className="fc-kind">{r.kind}</span>
          <span className="fc-rtext">{r.text}</span>
          <span className="fc-ract">
            {r.go && <button type="button" className="btn" onClick={() => onGo(r.go!.screen, r.go!.tab)}>OPEN</button>}
            {!compact && r.kind !== 'POWER' && (
              <>
                <button type="button" className="btn" onClick={() => void run('SNOOZED 1 DAY', () => snooze(store, d.settings, r.key, d.today, d.today))}>SNOOZE 1 D</button>
                <button type="button" className="btn" onClick={() => void run('SNOOZED 7 DAYS', () => snooze(store, d.settings, r.key, addDays(d.today, 6), d.today))}>SNOOZE 7 D</button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function RemindersTab({ d, reminders, say, onGo, set }: { d: FacilityData; reminders: Reminder[]; say: Say; onGo: (s: GoScreen, tab?: string) => void; set: SetFac }) {
  const run = useRun(say)
  const store = useStore()
  const [settings, save] = useFacilityEditor()
  const { sound } = useApp()
  const [due, setDue] = useState(d.today)
  const [text, setText] = useState('')
  const [rep, setRep] = useState('')
  const open = d.custom.filter((c) => !c.done_on).sort((a, b) => a.due_on.localeCompare(b.due_on))
  const snoozed = Object.entries(settings.snoozed).filter(([, v]) => v >= d.today).length
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  const download = () => {
    const blob = new Blob([icsFor(reminders, d.today, Date.now())], { type: 'text/calendar' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mycol-reminders-${d.today}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    say(`CALENDAR FILE SAVED: ${reminders.length} ITEMS. OPEN IT ON THE PHONE TO ADD THEM TO ITS CALENDAR.`)
  }
  const askPerm = async () => {
    if (typeof Notification === 'undefined') return say('THIS BROWSER CANNOT SHOW PHONE ALERTS. USE THE CALENDAR FILE.', true)
    const r = await Notification.requestPermission()
    if (r === 'granted') await run('PHONE ALERTS ON', () => save({ phoneAlerts: true }, 'PHONE ALERTS ON'))
    else say('PERMISSION NOT GIVEN. USE THE CALENDAR FILE INSTEAD.', true)
  }
  return (
    <div className="lg-stack">
      <Box title={`DUE NOW AND COMING UP // ${reminders.length}`}>
        {reminders.length === 0 ? <div className="dim">NOTHING IS DUE.</div> : <ReminderList items={reminders} onGo={onGo} say={say} />}
        {snoozed > 0 && (
          <div className="lg-btns">
            <span className="dim">{snoozed} SNOOZED</span>
            <button type="button" className="btn" onClick={() => void run('SNOOZES CLEARED', () => save({ snoozed: {} }, 'SNOOZES CLEARED'))}>SHOW THEM AGAIN</button>
          </div>
        )}
      </Box>

      <Box title="ON YOUR PHONE">
        <div className="dim">A WEB PAGE CANNOT RING A PHONE WHILE IT IS CLOSED. TWO WAYS TO GET ALERTS ANYWAY:</div>
        <div className="lg-btns">
          <button type="button" className="btn on" onClick={download}>DOWNLOAD PHONE CALENDAR FILE (.ICS)</button>
          {perm === 'granted' ? (
            settings.phoneAlerts ? <button type="button" className="btn on" onClick={() => void run('PHONE ALERTS OFF', () => save({ phoneAlerts: false }, 'PHONE ALERTS OFF'))}>PHONE ALERTS ARE ON (TAP TO TURN OFF)</button>
              : <button type="button" className="btn" onClick={() => void run('PHONE ALERTS ON', () => save({ phoneAlerts: true }, 'PHONE ALERTS ON'))}>TURN ON ALERTS WHILE THE APP IS OPEN</button>
          ) : (
            <button type="button" className="btn" disabled={perm === 'unsupported' || perm === 'denied'} onClick={() => void askPerm()}>{perm === 'denied' ? 'ALERTS BLOCKED IN THE BROWSER' : perm === 'unsupported' ? 'ALERTS NOT SUPPORTED HERE' : 'TURN ON ALERTS WHILE THE APP IS OPEN'}</button>
          )}
          <button type="button" className="btn" onClick={() => void copyText(reminders.map((r) => `- ${r.text}`).join('\n')).then((ok) => say(ok ? 'LIST COPIED. PASTE IT INTO WHATSAPP.' : 'COULD NOT COPY.', !ok))}>COPY THE LIST</button>
        </div>
        <div className="dim tiny">THE CALENDAR FILE ADDS EACH ITEM AS AN ALL-DAY EVENT WITH AN ALERT AT 08:00 ON THE DAY. DOWNLOAD IT AGAIN AFTER BIG CHANGES.</div>
      </Box>

      <Box title="REMIND ME ABOUT SOMETHING">
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>DAY</span><PickInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label className="ck-field"><span>REPEAT EVERY (DAYS, OPTIONAL)</span><input inputMode="numeric" value={rep} placeholder="E.G. 30" onChange={(e) => setRep(e.target.value)} /></label>
        </div>
        <label className="ck-field"><span>WHAT TO REMEMBER</span><input value={text} placeholder="E.G. RENEW HEALTH PERMIT" onChange={(e) => setText(e.target.value)} /></label>
        <button type="button" className="btn on lg-save" onClick={() => void run(`REMINDER ADDED // ${due}`, async () => { await addCustom(store, due, text, rep.trim() ? Number(rep) : null) }).then((ok) => ok && (setText(''), setRep('')))}>SAVE</button>
        {open.length > 0 && (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>REMINDER</th><th>REPEATS</th><th /></tr></thead>
              <tbody>
                {open.map((c) => (
                  <tr key={c.id}>
                    <td>{c.due_on}</td><td>{c.text}</td><td>{c.repeat_days ? `EVERY ${c.repeat_days} D` : 'ONCE'}</td>
                    <td className="mn-act">
                      <button type="button" className="btn" onClick={() => void run('REMINDER DONE', () => finishCustom(store, c.id, completeCustom(c, d.today)))}>DONE</button>
                      <Confirm label="DELETE" onYes={() => void run('REMINDER DELETED', () => deleteCustom(store, c.id))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box title="WHAT SHOWS UP HERE">
        <div className="fc-lines2">
          <div>FROM MISSION CONTROL: LOTS TO MOVE OR HARVEST, PLATE AND SPAWN AGES.</div>
          <div>FROM XENOGENETICS: BANK TUBES DUE, NO OFF-SITE COPY, NO T/E TEST.</div>
          <div>FROM CARGO: LOW STOCK. FROM MONEY: BUYERS WHO OWE.</div>
          <div>FROM HERE: UPKEEP JOBS, FILTERS, WATER TESTS, CLEANING, CHECKLISTS, POWER OUT, YOUR OWN REMINDERS.</div>
          <div>EACH WEEK: {Object.values(ROUTINE).map((r) => r.text.split(':')[0]).join(', ')}.</div>
        </div>
        <label className="fc-check"><input type="checkbox" checked={settings.routineOn} onChange={(e) => void run('ROUTINE REMINDERS', () => save({ routineOn: e.target.checked }, e.target.checked ? 'ROUTINE REMINDERS ON' : 'ROUTINE REMINDERS OFF'))} /> SHOW THE WEEKLY ROUTINE (MON STEAM, TUE KNOCK ...)</label>
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>SHOW THIS MANY DAYS AHEAD</span>
            <Buttons label="Days ahead" value={String(settings.leadDays)} options={['0', '1', '2', '3', '7'].map((v) => ({ id: v, label: v }))} onPick={(v) => { sound.chirp(); void run(`SHOW ${v} DAYS AHEAD`, () => save({ leadDays: Number(v) }, `REMINDER LEAD ${v} D`)) }} />
          </label>
        </div>
        <button type="button" className="btn" onClick={() => set({ tab: 'MAINTENANCE' })}>OPEN MAINTENANCE</button>
      </Box>
    </div>
  )
}

// ---------- main-menu status board ----------

export function StatusBoard({ onOpen }: { onOpen: () => void }) {
  const d = useReminders()
  return (
    <div className="fc-board" role="group" aria-label="Farm status board">
      <div className="section-title">STATUS BOARD</div>
      <StatusLines lines={d.lines} />
      <button type="button" className="btn fc-board-open" onClick={onOpen} data-tip="Open REMINDERS (7.8): the status board and everything due.">OPEN REMINDERS</button>
    </div>
  )
}

/** Small block for VITALS: power cuts at a glance. */
export function PowerCutBox({ onOpen }: { onOpen: () => void }) {
  const d = useFacility()
  const o = d.summary
  const st = o.open ? cutStats(o.open, d.now) : null
  return (
    <div className="v-cuts" id="v-cuts">
      <div className="section-title">POWER CUTS</div>
      {o.open && st ? (
        <div className="lg-warn">POWER IS OUT SINCE {stamp(Date.parse(o.open.down_at))} // {fmtMin(st.gridMin)} SO FAR</div>
      ) : (
        <div className="dim">GRID UP{o.last ? ` // LAST CUT ENDED ${stamp(Date.parse(o.last.up_at as string))}` : ' // NO CUT LOGGED'}</div>
      )}
      <div className="lg-mini">
        <div>{monthLabel(o.thisMonth.month)} NO GRID {fmtHours(o.thisMonth.gridMin)} // {o.thisMonth.cuts} CUTS</div>
        <div>LAST 12 MONTHS NO GRID {fmtHours(o.year.gridMin)} // FULLY DARK {fmtHours(o.year.darkMin)}</div>
        <div>GENERATOR RUN HOURS (12 MONTHS) {o.year.genHours.toFixed(1)}</div>
      </div>
      <button type="button" className="btn" onClick={onOpen}>OPEN POWER CUT LOG</button>
    </div>
  )
}

// ---------- phone alerts while the app is open ----------

const SENT_KEY = 'mycol.fac.sent.v1'
export function ReminderWatcher() {
  const d = useReminders()
  const rem = d.reminders
  const on = d.settings.phoneAlerts
  useEffect(() => {
    if (!on || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    let sent = { day: '', keys: [] as string[] }
    try {
      sent = JSON.parse(localStorage.getItem(SENT_KEY) ?? '') as typeof sent
    } catch {
      /* first run today */
    }
    const fresh = toNotify(rem, sent, d.today)
    if (!fresh.length) return
    try {
      const body = fresh.slice(0, 3).map((r) => r.text).join('\n') + (fresh.length > 3 ? `\n+${fresh.length - 3} MORE` : '')
      new Notification('MY/CO/L', { body })
      localStorage.setItem(SENT_KEY, JSON.stringify({ day: d.today, keys: [...(sent.day === d.today ? sent.keys : []), ...fresh.map((r) => r.key)] }))
    } catch {
      /* the browser refused: nothing to do */
    }
  }, [on, rem, d.today])
  return null
}

