import { useMemo, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { HistoryButton } from './History'
import { Confirm, Guess } from './CookParts'
import { Box, Buttons, Chips, DateTimeField, Fold, getInitials, momentOf, numOrNaN, setInitials, splitMs, useRun, type Say } from './FacilityParts'
import { useSensorEditor, type SensorData } from '../store/useSensors'
import { stamp } from '../lib/facility'
import {
  AC_LABEL,
  AC_MODES,
  AC_STATES,
  AC_UNITS,
  DEFAULT_BANDS,
  DEFAULT_SENSOR_SETTINGS,
  MEASURE,
  MEASURES,
  MOCK_FAULTS,
  PLACES,
  PLACE_LABEL,
  SOURCE_LABEL,
  TARGETS,
  VENDORS,
  VENDOR_LABEL,
  bandFor,
  bandText,
  fmtVal,
  latestAc,
  parseSensorCsv,
  planImport,
  type AcCheck,
  type AcMode,
  type AcState,
  type Band,
  type Measure,
  type MockFault,
  type PlaceBands,
  type PlaceId,
  type Reading,
  type Sensor,
  type Vendor,
} from '../lib/sensors'
import { FEEDS } from '../lib/sensorFeeds'
import { addMock, addReading, deleteAc, deleteBatch, deleteReading, deleteSensor, importReadings, removeMock, saveAc, saveSensor, setSensorActive } from '../lib/sensorActions'

const placeOpts = PLACES.map((p) => ({ id: p.id, label: p.label }))

/** In-app picker of the sensors at one place (or none: a hand meter). */
function SensorPick({ d, place, value, onChange, none = 'NONE / HAND METER' }: { d: SensorData; place: PlaceId; value: string; onChange: (v: string) => void; none?: string }) {
  const list = d.sensors.filter((s) => s.active && s.place === place)
  return (
    <label className="ck-field"><span>WHICH SENSOR (OPTIONAL)</span>
      <Select aria-label="Sensor" value={list.some((s) => s.id === value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">{none}</option>
        {list.map((s) => <option key={s.id} value={s.id}>{s.name}{s.model ? ` (${s.model})` : ''}</option>)}
      </Select>
    </label>
  )
}

// ==========================================================================================
// LOG READING
// ==========================================================================================

export function LogTab({ d, say, place: start }: { d: SensorData; say: Say; place: PlaceId }) {
  const run = useRun(say)
  const store = useStore()
  const [place, setPlace] = useState<PlaceId>(start)
  const [sensor, setSensor] = useState('')
  const [when, setWhen] = useState(() => splitMs(Date.now()))
  const [temp, setTemp] = useState('')
  const [rh, setRh] = useState('')
  const [co2, setCo2] = useState('')
  const [note, setNote] = useState('')
  const [who, setWho] = useState(getInitials)
  const [all, setAll] = useState(false)
  const recent = useMemo(() => [...d.readings].sort((a, b) => b.taken_at.localeCompare(a.taken_at) || b.id.localeCompare(a.id)).slice(0, all ? 300 : 25), [d.readings, all])
  const names = useMemo(() => new Map(d.sensors.map((s) => [s.id, s.name])), [d.sensors])
  const save = async () => {
    setInitials(who)
    const ok = await run(`READING SAVED // ${PLACE_LABEL[place]}`, () => addReading(store, { place, sensor_id: sensor || null, at: momentOf(when.day, when.time), temp: numOrNaN(temp), rh: numOrNaN(rh), co2: numOrNaN(co2), note, who }, Date.now()))
    if (ok) {
      setTemp('')
      setRh('')
      setCo2('')
      setNote('')
      setWhen(splitMs(Date.now()))
    }
  }
  const band = (m: Measure) => bandText(bandFor(d.settings, place, m), m)
  return (
    <div className="lg-stack">
      <Box title="TYPE A READING">
        <div className="ck-field"><span>WHERE</span><Buttons label="Place" value={place} options={placeOpts} onPick={(v) => (setPlace(v), setSensor(''))} /></div>
        <div className="ck-fields">
          <SensorPick d={d} place={place} value={sensor} onChange={setSensor} />
          <DateTimeField label="WHEN (FARM CLOCK)" day={when.day} time={when.time} onChange={(day, time) => setWhen({ day, time })} />
        </div>
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>TEMPERATURE C</span><input inputMode="decimal" value={temp} placeholder="E.G. 16.2" onChange={(e) => setTemp(e.target.value)} /><em>{PLACE_LABEL[place]} BAND {band('temp')}</em></label>
          <label className="ck-field"><span>HUMIDITY %</span><input inputMode="decimal" value={rh} placeholder="E.G. 86" onChange={(e) => setRh(e.target.value)} /><em>{PLACE_LABEL[place]} BAND {band('rh')}</em></label>
          <label className="ck-field"><span>CO2 PPM</span><input inputMode="numeric" value={co2} placeholder="E.G. 800" onChange={(e) => setCo2(e.target.value)} /><em>{PLACE_LABEL[place]} BAND {band('co2')}</em></label>
        </div>
        <div className="ck-fields">
          <label className="ck-field"><span>NOTE (OPTIONAL)</span><input value={note} placeholder="E.G. DOOR WAS OPEN" onChange={(e) => setNote(e.target.value)} /></label>
          <label className="ck-field"><span>YOUR INITIALS</span><input value={who} placeholder="E.G. JM" onChange={(e) => setWho(e.target.value)} /></label>
        </div>
        <button type="button" className="btn on lg-save" onClick={() => void save()}>SAVE READING</button>
        <div className="dim tiny">FILL ONE, TWO OR ALL THREE VALUES. A HAND READING OUTSIDE THE BAND RAISES AN ALARM AT ONCE.</div>
      </Box>
      <Box title={`NEWEST READINGS // ${d.readings.length.toLocaleString('en-US')} SAVED`}>
        {recent.length === 0 ? <div className="dim">NOTHING SAVED YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>WHEN</th><th>PLACE</th><th>TEMP</th><th>RH</th><th>CO2</th><th className="hide-sm">FROM</th><th /></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>{stamp(Date.parse(r.taken_at))}</td>
                    <td>{PLACE_LABEL[r.place]}{r.sensor_id ? ` // ${names.get(r.sensor_id) ?? '?'}` : ''}</td>
                    <td>{fmtVal(r.temp_c, 'temp')}</td>
                    <td>{fmtVal(r.rh, 'rh')}</td>
                    <td>{fmtVal(r.co2_ppm, 'co2')}</td>
                    <td className="hide-sm">{SOURCE_LABEL[r.source] ?? r.source}{r.note ? ` // ${r.note}` : ''}</td>
                    <td className="mn-act">
                      <HistoryButton table="sensor_readings" id={r.id} />
                      <Confirm label="DELETE" onYes={() => void run('READING DELETED', () => deleteReading(store, r.id))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.readings.length > 25 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW THE NEWEST 25' : 'SHOW MORE (300)'}</button>}
      </Box>
    </div>
  )
}

// ==========================================================================================
// IMPORT CSV
// ==========================================================================================

export function ImportTab({ d, say, place: start }: { d: SensorData; say: Say; place: PlaceId }) {
  const run = useRun(say)
  const store = useStore()
  const [place, setPlace] = useState<PlaceId>(start)
  const [sensor, setSensor] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState('')
  const [order, setOrder] = useState<'auto' | 'month' | 'day'>('auto')
  const [unit, setUnit] = useState<'auto' | 'C' | 'F'>('auto')
  const fileRef = useRef<HTMLInputElement>(null)
  const checkRef = useRef<HTMLDivElement>(null)
  const parsed = useMemo(() => (text.trim() ? parseSensorCsv(text, { dayFirst: order === 'auto' ? null : order === 'day', unit: unit === 'auto' ? null : unit }) : null), [text, order, unit])
  const target = { sensor_id: sensor || null, place }
  const plan = useMemo(() => (parsed ? planImport(parsed.rows, target, d.idx) : null), [parsed, d.idx, sensor, place]) // eslint-disable-line react-hooks/exhaustive-deps
  const batches = useMemo(() => {
    const by = new Map<string, { batch: string; place: PlaceId; sensor: string | null; n: number; from: string; to: string; at: string }>()
    for (const r of d.readings) {
      if (r.source !== 'csv' || !r.batch) continue
      const b = by.get(r.batch) ?? { batch: r.batch, place: r.place, sensor: r.sensor_id, n: 0, from: r.taken_at, to: r.taken_at, at: r.created_at }
      b.n++
      if (r.taken_at < b.from) b.from = r.taken_at
      if (r.taken_at > b.to) b.to = r.taken_at
      by.set(r.batch, b)
    }
    return [...by.values()].sort((a, b) => b.at.localeCompare(a.at))
  }, [d.readings])
  const names = new Map(d.sensors.map((s) => [s.id, s.name]))
  const onFile = (f: File | undefined) => {
    if (!f) return
    if (f.size > 30 * 1024 * 1024) return say('THAT FILE IS OVER 30 MB. SPLIT IT INTO SMALLER FILES.', true)
    const r = new FileReader()
    r.onload = () => {
      setText(String(r.result ?? ''))
      setFile(f.name)
      window.setTimeout(() => checkRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60)
    }
    r.onerror = () => say('COULD NOT READ THAT FILE.', true)
    r.readAsText(f)
  }
  const doImport = async () => {
    if (!plan) return
    const ok = await run(`IMPORTED ${plan.add.length.toLocaleString('en-US')} READINGS // ${PLACE_LABEL[place]}`, () => importReadings(store, plan, target, getInitials() || null))
    if (ok) {
      setText('')
      setFile('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <div className="lg-stack">
      <Box title="IMPORT A GOVEE FILE">
        <div className="dim">IN THE GOVEE HOME APP: OPEN THE SENSOR, TAP THE GRAPH, THEN EXPORT DATA. SAVE OR SEND THE CSV FILE TO THIS PHONE OR PC, THEN PICK IT HERE. OTHER LOGGERS WORK TOO IF THE FIRST LINE NAMES THE COLUMNS.</div>
        <div className="ck-field"><span>WHERE THE SENSOR IS</span><Buttons label="Place" value={place} options={placeOpts} onPick={(v) => (setPlace(v), setSensor(''))} /></div>
        <div className="ck-fields">
          <SensorPick d={d} place={place} value={sensor} onChange={setSensor} none="NOT LINKED TO A SENSOR" />
          <label className="ck-field"><span>THE FILE</span>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
            <em>{file ? `LOADED: ${file}. CHECK IT AND PRESS SAVE BELOW.` : 'AFTER PICKING, A CHECK AND A SAVE BUTTON APPEAR BELOW.'}</em>
          </label>
        </div>
        <label className="ck-field"><span>OR PASTE THE FILE'S TEXT HERE</span>
          <textarea className="at-paste" rows={4} value={text} placeholder={'Timestamp,Temperature_Fahrenheit,Relative_Humidity\n2026-11-05 10:00:00,60.8,85.0'} onChange={(e) => (setText(e.target.value), setFile(''))} />
        </label>
        <div className="at-pickrow">
          <div className="ck-field"><span>DATES LIKE 03/04/2026 ARE</span><Buttons label="Date order" value={order} options={[{ id: 'auto', label: 'WORK IT OUT' }, { id: 'month', label: 'MONTH FIRST' }, { id: 'day', label: 'DAY FIRST' }]} onPick={setOrder} /></div>
          <div className="ck-field"><span>TEMPERATURE IN</span><Buttons label="Unit" value={unit} options={[{ id: 'auto', label: 'WORK IT OUT' }, { id: 'C', label: 'CELSIUS' }, { id: 'F', label: 'FAHRENHEIT' }]} onPick={setUnit} /></div>
        </div>
      </Box>
      <div ref={checkRef} />
      {parsed && plan && (
        <Box title="CHECK, THEN SAVE">
          <div className="lg-big">
            <div><span>LINES READ</span><b>{parsed.rows.length.toLocaleString('en-US')}</b></div>
            <div><span>NEW</span><b>{plan.add.length.toLocaleString('en-US')}</b></div>
            <div><span>ALREADY SAVED</span><b>{plan.dup.toLocaleString('en-US')}</b></div>
            <div><span>NOT READABLE</span><b className={parsed.errors.length ? 'lg-warn-text' : ''}>{parsed.errors.length}{parsed.errors.length >= 50 ? '+' : ''}</b></div>
          </div>
          <div className="fc-lines2">
            <div>COLUMNS: {parsed.found.join(', ') || 'NONE'}{parsed.unit ? ` // TEMPERATURE READ AS ${parsed.unit === 'F' ? 'FAHRENHEIT (TURNED INTO CELSIUS)' : 'CELSIUS'}` : ''}{parsed.dates ? ` // DATES READ ${parsed.dates}` : ''}</div>
            {plan.from !== null && plan.to !== null && <div>NEW READINGS FROM {stamp(plan.from)} TO {stamp(plan.to)} (FARM CLOCK)</div>}
            {plan.add.slice(0, 3).map((r) => <div key={r.ms}>{stamp(r.ms)} // {fmtVal(r.temp_c, 'temp')} // {fmtVal(r.rh, 'rh')}{r.co2_ppm !== null ? ` // ${fmtVal(r.co2_ppm, 'co2')}` : ''}</div>)}
          </div>
          {parsed.errors.length > 0 && <div className="lg-warn">{parsed.errors.slice(0, 4).map((e) => `LINE ${e.line}: ${e.text}`).join(' // ')}</div>}
          <button type="button" className="btn on lg-save" disabled={!plan.add.length} onClick={() => void doImport()}>{plan.add.length ? `SAVE ${plan.add.length.toLocaleString('en-US')} READINGS TO ${PLACE_LABEL[place]}` : 'NOTHING NEW TO SAVE'}</button>
          <div className="dim tiny">CHECK THE FIRST LINES LOOK RIGHT. IF THE TEMPERATURES ARE ODD, SET CELSIUS OR FAHRENHEIT ABOVE. IF THE DAYS ARE WRONG, SET THE DATE ORDER.</div>
        </Box>
      )}
      <Box title={`FILES IMPORTED // ${batches.length}`}>
        {batches.length === 0 ? <div className="dim">NO FILES IMPORTED YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>IMPORTED</th><th>PLACE</th><th>READINGS</th><th className="hide-sm">COVERS</th><th /></tr></thead>
              <tbody>
                {batches.slice(0, 50).map((b) => (
                  <tr key={b.batch}>
                    <td>{stamp(Date.parse(b.at))}</td>
                    <td>{PLACE_LABEL[b.place]}{b.sensor ? ` // ${names.get(b.sensor) ?? '?'}` : ''}</td>
                    <td>{b.n.toLocaleString('en-US')}</td>
                    <td className="hide-sm">{stamp(Date.parse(b.from))} TO {stamp(Date.parse(b.to))}</td>
                    <td className="mn-act"><Confirm label="REMOVE" onYes={() => void run(`IMPORT REMOVED // ${b.n} READINGS`, () => deleteBatch(store, b.batch))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dim tiny">REMOVE TAKES OUT EVERY READING OF THAT FILE. UNDO PUTS THEM BACK.</div>
      </Box>
    </div>
  )
}

// ==========================================================================================
// AC UNITS (hand checks until a Lennox feed exists)
// ==========================================================================================

export function AcTab({ d, say }: { d: SensorData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const latest = latestAc(d.ac)
  const [unit, setUnit] = useState(AC_UNITS[0].id)
  const [edit, setEdit] = useState<AcCheck | null>(null)
  const [when, setWhen] = useState(() => splitMs(Date.now()))
  const [mode, setMode] = useState<AcMode>('cool')
  const [state, setState] = useState<AcState>('running')
  const [set, setSet] = useState('')
  const [shown, setShown] = useState('')
  const [fault, setFault] = useState('')
  const [notes, setNotes] = useState('')
  const formRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => [...d.ac].sort((a, b) => b.logged_at.localeCompare(a.logged_at)).slice(0, 40), [d.ac])
  const start = (u: string, c: AcCheck | null) => {
    setUnit(u)
    setEdit(c)
    setWhen(splitMs(c ? Date.parse(c.logged_at) : Date.now()))
    setMode(c?.mode ?? 'cool')
    setState(c?.state ?? 'running')
    setSet(c?.set_c !== null && c?.set_c !== undefined ? String(c.set_c) : '')
    setShown(c?.shown_c !== null && c?.shown_c !== undefined ? String(c.shown_c) : '')
    setFault(c?.fault_code ?? '')
    setNotes(c?.notes ?? '')
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  const save = async () => {
    const who = getInitials()
    const ok = await run(`AC CHECK SAVED // ${AC_LABEL[unit]}`, () => saveAc(store, edit?.id ?? null, { unit, at: momentOf(when.day, when.time), mode, set: numOrNaN(set), shown: numOrNaN(shown), state, fault, notes, who }, Date.now()))
    if (ok) start(unit, null)
  }
  return (
    <div className="lg-stack">
      <Box title="AIR CONDITIONERS">
        <ul className="fc-cards">
          {AC_UNITS.map((u) => {
            const c = latest.find((x) => x.unit === u.id)
            return (
              <li key={u.id} className={`fc-card ${c?.state === 'fault' ? 'warn' : ''}`}>
                <div className="fc-card-head">
                  <span className="fc-card-name">{u.label} // {PLACE_LABEL[u.place]}</span>
                  <span className={`fc-state ${c?.state === 'fault' ? 'warn' : ''}`}>{c ? AC_STATES.find((s) => s.id === c.state)!.label : 'NOT CHECKED YET'}</span>
                </div>
                {c && <div className="fc-card-sub">{stamp(Date.parse(c.logged_at))} // {AC_MODES.find((m) => m.id === c.mode)!.label}{c.set_c !== null ? ` // SET ${c.set_c} C` : ''}{c.shown_c !== null ? ` // SHOWS ${c.shown_c} C` : ''}{c.fault_code ? ` // ${c.fault_code}` : ''}</div>}
                <div className="lg-btns"><button type="button" className="btn" onClick={() => start(u.id, null)}>LOG A CHECK</button></div>
              </li>
            )
          })}
        </ul>
        <div className="dim tiny">NO LENNOX FEED YET (SEE FEEDS), SO CHECK THE UNITS BY HAND: MODE, SET TEMPERATURE, AND ANY ERROR CODE ON THE DISPLAY. A FAULT RAISES AN ALARM UNTIL A LATER CHECK SAYS RUNNING.</div>
      </Box>
      <div ref={formRef}>
        <Box title={edit ? `EDIT CHECK // ${AC_LABEL[unit]}` : 'LOG AN AC CHECK'}>
          <div className="ck-field"><span>WHICH UNIT</span><Buttons label="Unit" value={unit} options={AC_UNITS.map((u) => ({ id: u.id, label: u.label }))} onPick={setUnit} /></div>
          <DateTimeField label="WHEN (FARM CLOCK)" day={when.day} time={when.time} onChange={(day, time) => setWhen({ day, time })} />
          <div className="ck-field"><span>IT IS</span><Buttons label="State" value={state} options={AC_STATES} onPick={setState} /></div>
          <div className="ck-field"><span>MODE</span><Buttons label="Mode" value={mode} options={AC_MODES} onPick={setMode} /></div>
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>SET TO C</span><input inputMode="decimal" value={set} placeholder="E.G. 13" onChange={(e) => setSet(e.target.value)} /></label>
            <label className="ck-field"><span>DISPLAY SHOWS C (OPTIONAL)</span><input inputMode="decimal" value={shown} placeholder="E.G. 14" onChange={(e) => setShown(e.target.value)} /></label>
            {state === 'fault' && <label className="ck-field"><span>ERROR CODE</span><input value={fault} placeholder="E.G. E1" onChange={(e) => setFault(e.target.value)} /></label>}
          </div>
          <label className="ck-field"><span>NOTES (OPTIONAL)</span><input value={notes} placeholder="E.G. DRIP LINE CLEARED" onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="lg-btns">
            <button type="button" className="btn on lg-save" onClick={() => void save()}>SAVE CHECK</button>
            {edit && <button type="button" className="btn" onClick={() => start(unit, null)}>CANCEL EDIT</button>}
          </div>
        </Box>
      </div>
      <Box title={`ALL CHECKS // ${d.ac.length}`}>
        {list.length === 0 ? <div className="dim">NO CHECKS YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>WHEN</th><th>UNIT</th><th>STATE</th><th>MODE</th><th>SET</th><th className="hide-sm">NOTES</th><th /></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className={c.state === 'fault' ? 'od-row over' : ''}>
                    <td>{stamp(Date.parse(c.logged_at))}</td>
                    <td>{AC_LABEL[c.unit] ?? c.unit}</td>
                    <td className={c.state === 'fault' ? 'lg-warn-text' : ''}>{AC_STATES.find((s) => s.id === c.state)?.label}{c.fault_code ? ` ${c.fault_code}` : ''}</td>
                    <td>{AC_MODES.find((m) => m.id === c.mode)?.label}</td>
                    <td>{c.set_c !== null ? `${c.set_c} C` : '--'}</td>
                    <td className="hide-sm">{c.notes ?? ''}</td>
                    <td className="mn-act">
                      <button type="button" className="btn" onClick={() => start(c.unit, c)}>EDIT</button>
                      <HistoryButton table="ac_log" id={c.id} />
                      <Confirm label="DELETE" onYes={() => void run('AC CHECK DELETED', () => deleteAc(store, c.id))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </div>
  )
}

// ==========================================================================================
// SET POINTS
// ==========================================================================================

const showNum = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

function PlaceBandsForm({ p, say }: { p: (typeof PLACES)[number]; say: Say }) {
  const run = useRun(say)
  const [settings, save] = useSensorEditor()
  const init = () => Object.fromEntries(MEASURES.map((m) => {
    const b = bandFor(settings, p.id, m.id)
    return [m.id, { lo: showNum(b?.lo), hi: showNum(b?.hi) }]
  })) as Record<Measure, { lo: string; hi: string }>
  const [v, setV] = useState(init)
  const [delay, setDelay] = useState(String(settings.delayMin[p.id]))
  const changed = !!settings.bands[p.id] || settings.delayMin[p.id] !== DEFAULT_SENSOR_SETTINGS.delayMin[p.id]
  const apply = async () => {
    const bands: PlaceBands = {}
    for (const m of MEASURES) {
      const lo = numOrNaN(v[m.id].lo)
      const hi = numOrNaN(v[m.id].hi)
      if ([lo, hi].some((x) => x !== null && !Number.isFinite(x))) return say(`${m.label}: A NUMBER IS NOT READABLE.`, true)
      if (lo !== null && hi !== null && lo >= hi) return say(`${m.label}: THE LOW LIMIT MUST BE BELOW THE HIGH LIMIT.`, true)
      for (const x of [lo, hi]) if (x !== null && (x < m.lo || x > m.hi)) return say(`${m.label}: ${x} IS OUTSIDE WHAT A SENSOR CAN READ.`, true)
      bands[m.id] = { lo, hi } as Band
    }
    const dl = numOrNaN(delay)
    if (dl === null || !Number.isFinite(dl) || dl < 0 || dl > 1440) return say('DELAY SHOULD BE 0 TO 1,440 MINUTES.', true)
    await run(`SET POINTS SAVED // ${p.label}`, () => save({ bands: { ...settings.bands, [p.id]: bands }, delayMin: { ...settings.delayMin, [p.id]: Math.round(dl) } }, `SET POINTS ${p.label}`))
  }
  const reset = async () => {
    const rest = { ...settings.bands }
    delete rest[p.id]
    const ok = await run(`SET POINTS BACK TO START // ${p.label}`, () => save({ bands: rest, delayMin: { ...settings.delayMin, [p.id]: DEFAULT_SENSOR_SETTINGS.delayMin[p.id] } }, `SET POINTS RESET ${p.label}`))
    if (ok) {
      setV(Object.fromEntries(MEASURES.map((m) => [m.id, { lo: showNum(DEFAULT_BANDS[p.id][m.id]?.lo), hi: showNum(DEFAULT_BANDS[p.id][m.id]?.hi) }])) as Record<Measure, { lo: string; hi: string }>)
      setDelay(String(DEFAULT_SENSOR_SETTINGS.delayMin[p.id]))
    }
  }
  return (
    <Fold title={`EDIT ${p.label} // ${MEASURES.map((m) => `${m.label} ${bandText(bandFor(settings, p.id, m.id), m.id)}`).join(' // ')}${changed ? ' // CHANGED' : ''}`}>
      <div className="dim tiny">TARGET: {TARGETS[p.id]}</div>
      <div className="at-bands">
        {MEASURES.map((m) => (
          <div key={m.id} className="ck-fields ck-quick">
            <label className="ck-field"><span>{m.label} ALARM BELOW ({m.unit})</span><input inputMode="decimal" value={v[m.id].lo} placeholder="NONE" onChange={(e) => setV({ ...v, [m.id]: { ...v[m.id], lo: e.target.value } })} /></label>
            <label className="ck-field"><span>{m.label} ALARM ABOVE ({m.unit})</span><input inputMode="decimal" value={v[m.id].hi} placeholder="NONE" onChange={(e) => setV({ ...v, [m.id]: { ...v[m.id], hi: e.target.value } })} /></label>
          </div>
        ))}
        <label className="ck-field"><span>ALARM ONLY AFTER THIS MANY MINUTES OUT</span><input inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} /></label>
      </div>
      <div className="lg-btns">
        <button type="button" className="btn on" onClick={() => void apply()}>SAVE {p.label}</button>
        {changed && <button type="button" className="btn" onClick={() => void reset()}>BACK TO THE STARTING NUMBERS</button>}
      </div>
      <div className="dim tiny">LEAVE A BOX EMPTY FOR NO ALARM ON THAT SIDE.</div>
    </Fold>
  )
}

export function SetPointsTab({ say }: { say: Say }) {
  const run = useRun(say)
  const [settings, save] = useSensorEditor()
  const [silent, setSilent] = useState(String(settings.silentMin))
  const [stale, setStale] = useState(String(settings.staleHours))
  return (
    <div className="lg-stack">
      <Box title="ALARM BANDS PER PLACE" extra={<Guess />}>
        <div className="dim">THE FARM'S WRITTEN LIMITS ARE USED WHERE THEY EXIST; THE REST ARE WORKING NUMBERS TO REVIEW (SEE GUESSES). TAP EDIT ON A PLACE TO CHANGE ITS LIMITS.</div>
      </Box>
      {PLACES.map((p) => <PlaceBandsForm key={p.id} p={p} say={say} />)}
      <Box title="SENSOR TIMING">
        <div className="ck-fields ck-quick">
          <label className="ck-field"><span>AUTOMATIC SENSOR IS SILENT AFTER (MIN)</span><input inputMode="numeric" value={silent} onChange={(e) => setSilent(e.target.value)} /></label>
          <label className="ck-field"><span>READINGS OLDER THAN THIS DO NOT ALARM (HOURS)</span><input inputMode="decimal" value={stale} onChange={(e) => setStale(e.target.value)} /></label>
        </div>
        <button type="button" className="btn on" onClick={() => {
          const a = numOrNaN(silent)
          const b = numOrNaN(stale)
          if (a === null || !Number.isFinite(a) || a < 5 || a > 1440) return say('SILENT AFTER SHOULD BE 5 TO 1,440 MINUTES.', true)
          if (b === null || !Number.isFinite(b) || b < 1 || b > 336) return say('OLD AFTER SHOULD BE 1 TO 336 HOURS.', true)
          void run('SENSOR TIMING SAVED', () => save({ silentMin: Math.round(a), staleHours: b }, 'SENSOR TIMING'))
        }}>SAVE TIMING</button>
      </Box>
    </div>
  )
}

// ==========================================================================================
// SENSORS
// ==========================================================================================

function SensorForm({ edit, d, say, onDone }: { edit: Sensor | null; d: SensorData; say: Say; onDone: () => void }) {
  const run = useRun(say)
  const store = useStore()
  const [name, setName] = useState(edit?.name ?? '')
  const [place, setPlace] = useState<PlaceId>(edit?.place ?? 'fruiting')
  const [vendor, setVendor] = useState<Vendor>(edit?.vendor ?? 'govee')
  const [model, setModel] = useState(edit?.model ?? '')
  const [dev, setDev] = useState(edit?.device_id ?? '')
  const [measures, setMeasures] = useState<Measure[]>(edit?.measures ?? ['temp', 'rh'])
  const [auto, setAuto] = useState(edit?.auto ?? false)
  const [notes, setNotes] = useState(edit?.notes ?? '')
  return (
    <Box title={edit ? `EDIT SENSOR // ${edit.name}` : 'ADD A SENSOR'}>
      <div className="ck-fields">
        <label className="ck-field"><span>NAME</span><input value={name} placeholder="E.G. FRUITING NORTH" onChange={(e) => setName(e.target.value)} /></label>
        <label className="ck-field"><span>MODEL (OPTIONAL)</span><input value={model} placeholder="E.G. H5179" onChange={(e) => setModel(e.target.value)} /></label>
      </div>
      <div className="ck-field"><span>WHERE</span><Buttons label="Place" value={place} options={placeOpts} onPick={setPlace} /></div>
      <div className="ck-field"><span>MAKER</span><Buttons label="Maker" value={vendor} options={VENDORS} onPick={setVendor} /></div>
      <div className="ck-field"><span>MEASURES</span><Chips label="Measures" value={measures} options={MEASURES.map((m) => ({ id: m.id, label: m.label }))} onChange={setMeasures} /></div>
      <div className="ck-fields">
        <label className="ck-field"><span>DEVICE ID (OPTIONAL, FOR THE FEED LATER)</span><input value={dev} placeholder="FROM THE GOVEE APP OR THE FEED" onChange={(e) => setDev(e.target.value)} /></label>
        <label className="ck-field"><span>NOTES (OPTIONAL)</span><input value={notes} placeholder="E.G. TOP SHELF, NORTH WALL" onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      <label className="fc-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> IT SENDS READINGS BY ITSELF (A LIVE FEED). WARN IF IT GOES QUIET.</label>
      <div className="lg-btns">
        <button type="button" className="btn on lg-save" onClick={() => void run(edit ? `SENSOR SAVED // ${name.toUpperCase()}` : `SENSOR ADDED // ${name.toUpperCase()}`, () => saveSensor(store, edit?.id ?? null, { name, place, vendor, model, device_id: dev, measures, auto, notes })).then((ok) => ok && onDone())}>SAVE SENSOR</button>
        <button type="button" className="btn" onClick={onDone}>CANCEL</button>
      </div>
      {!edit && d.sensors.length === 0 && <div className="dim tiny">TIP: AN AUTOMATIC SENSOR WITH NO FEED YET WILL SHOW AS SILENT. LEAVE THE BOX UNTICKED UNTIL ITS FEED IS RUNNING.</div>}
    </Box>
  )
}

export function SensorsTab({ d, say }: { d: SensorData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const [form, setForm] = useState<{ edit: Sensor | null } | null>(null)
  const [retired, setRetired] = useState(false)
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of d.readings) if (r.sensor_id) m.set(r.sensor_id, (m.get(r.sensor_id) ?? 0) + 1)
    return m
  }, [d.readings])
  const list = d.sensors.filter((s) => s.active !== retired).sort((a, b) => PLACES.findIndex((p) => p.id === a.place) - PLACES.findIndex((p) => p.id === b.place) || a.name.localeCompare(b.name))
  return (
    <div className="lg-stack">
      {form ? <SensorForm key={form.edit?.id ?? 'new'} edit={form.edit} d={d} say={say} onDone={() => setForm(null)} /> : (
        <Box title="SENSORS">
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => setForm({ edit: null })}>ADD A SENSOR</button>
            <button type="button" className={`btn ${retired ? 'on' : ''}`} aria-pressed={retired} onClick={() => setRetired(!retired)}>{retired ? 'SHOWING RETIRED' : 'SHOW RETIRED'}</button>
          </div>
          <div className="dim tiny">ONE ENTRY PER SENSOR. A PLACE CAN HAVE SEVERAL. A HAND THERMOMETER NEEDS NO ENTRY: TYPE ITS READINGS WITH NONE / HAND METER.</div>
        </Box>
      )}
      <Box title={`${retired ? 'RETIRED' : 'IN USE'} // ${list.length}`}>
        {list.length === 0 ? <div className="dim">{retired ? 'NONE RETIRED.' : 'NO SENSORS YET. ADD ONE, OR MAKE MOCK SENSORS ON MOCK TEST.'}</div> : (
          <ul className="fc-cards">
            {list.map((s) => {
              const last = d.lastSeen.get(s.id)
              const n = counts.get(s.id) ?? 0
              return (
                <li key={s.id} className="fc-card">
                  <div className="fc-card-head">
                    <span className="fc-card-name">{s.name}{s.mock ? ' // MOCK' : ''}</span>
                    <span className="fc-state">{PLACE_LABEL[s.place]}</span>
                  </div>
                  <div className="fc-card-sub">{VENDOR_LABEL[s.vendor]}{s.model ? ` ${s.model}` : ''} // {s.measures.map((m) => MEASURE[m].label).join(' + ')} // {s.mock ? 'MOCK FEED (MADE-UP)' : s.auto ? 'REPORTS BY ITSELF' : 'BY HAND OR FILE'}{s.device_id ? ` // ID ${s.device_id}` : ''}</div>
                  <div className="fc-card-sub">{n.toLocaleString('en-US')} READINGS{last ? ` // LAST ${stamp(last)}` : ''}{s.notes ? ` // ${s.notes}` : ''}</div>
                  <div className="lg-btns">
                    <button type="button" className="btn" onClick={() => setForm({ edit: s })}>EDIT</button>
                    <button type="button" className="btn" onClick={() => void run(s.active ? `SENSOR RETIRED // ${s.name}` : `SENSOR BACK IN USE // ${s.name}`, () => setSensorActive(store, s.id, !s.active))}>{s.active ? 'RETIRE' : 'BRING BACK'}</button>
                    <HistoryButton table="sensors" id={s.id} />
                    {n === 0 && <Confirm label="DELETE" onYes={() => void run(`SENSOR DELETED // ${s.name}`, () => deleteSensor(store, s.id))} />}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Box>
    </div>
  )
}

// ==========================================================================================
// FEEDS
// ==========================================================================================

export function FeedsTab({ say }: { say: Say }) {
  const run = useRun(say)
  const [settings, save] = useSensorEditor()
  return (
    <div className="lg-stack">
      <Box title="LIVE FEEDS // AFTER CONSTRUCTION">
        <div><b>AUTOMATIC READINGS: NOT YET.</b> THE APP IS READY FOR THEM, BUT THEY NEED THE SENSORS INSTALLED AND A SMALL ALWAYS-ON COMPUTER AT THE FARM (PLANNED FOR LATER). UNTIL THEN, TYPE READINGS OR IMPORT GOVEE FILES. THE PLAN:</div>
        <ol className="at-plan">
          <li>PUT GOVEE SENSORS IN EACH ROOM AND THE CULTURE FRIDGE. ADD EACH ONE ON SENSORS.</li>
          <li>UNTIL A FEED RUNS: EXPORT EACH SENSOR'S DATA FROM THE GOVEE APP NOW AND THEN, AND USE IMPORT CSV.</li>
          <li>WITH THE FARM COMPUTER (PLANNED): IT LISTENS TO THE SENSORS OVER BLUETOOTH, OR ASKS THE GOVEE CLOUD, AND SAVES READINGS EVERY FEW MINUTES. ALARMS THEN GO TO TELEGRAM EVEN WHEN THIS APP IS CLOSED.</li>
          <li>READ THE MODEL NUMBER ON EACH LENNOX INDOOR UNIT. THAT DECIDES IF THE AIR CONDITIONERS CAN REPORT TOO.</li>
        </ol>
      </Box>
      {FEEDS.map((f) => (
        <div key={f.id} className="ck-box at-feed">
          <div className="section-title">{f.label} <span className={f.built ? 'dim' : 'lg-warn-text'}>// {f.route} // {f.built ? 'BUILT' : 'NOT POSSIBLE YET'}</span></div>
          <div>{f.verdict}</div>
          <div className="fc-lines2">
            <div>RUNS ON: {f.runs === 'BRIDGE' ? 'THE ALWAYS-ON FARM COMPUTER (PLANNED), NOT THIS WEB PAGE' : 'THIS APP, NOW'}</div>
            {f.needs.length > 0 && <div>NEEDS: {f.needs.join(' // ')}</div>}
          </div>
          {f.notes.length > 0 && (
            <details className="at-more">
              <summary tabIndex={0}>WHAT THE RESEARCH FOUND ({f.notes.length})</summary>
              <ul className="ck-guesses">{f.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
          )}
          {f.id === 'govee-cloud' && (
            <div className="ck-field"><span>GOVEE CLOUD TEMPERATURE UNIT <Guess /></span>
              <Buttons label="Govee unit" value={settings.goveeUnit} options={[{ id: 'F', label: 'FAHRENHEIT' }, { id: 'C', label: 'CELSIUS' }]} onPick={(v) => void run(`GOVEE UNIT ${v}`, () => save({ goveeUnit: v }, `GOVEE UNIT ${v}`))} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ==========================================================================================
// MOCK TEST
// ==========================================================================================

export function MockTab({ d, say, goNow }: { d: SensorData; say: Say; goNow: () => void }) {
  const run = useRun(say)
  const store = useStore()
  const { sound } = useApp()
  const [places, setPlaces] = useState<PlaceId[]>(['fruiting', 'incubation', 'lab', 'fridge'])
  const [hours, setHours] = useState('24')
  const [step, setStep] = useState('10')
  const [fault, setFault] = useState<MockFault>('ac-fail')
  const [faultPlace, setFaultPlace] = useState<PlaceId>('fruiting')
  const [ago, setAgo] = useState('120')
  const mockN = useMemo(() => d.readings.filter((r) => r.source === 'mock').length, [d.readings])
  const mockS = d.sensors.filter((s) => s.mock).length
  const n = places.length * (Math.floor((Number(hours) * 60) / Number(step)) + 1)
  return (
    <div className="lg-stack">
      <Box title="TRY THE SCREENS WITH MADE-UP READINGS">
        <div className="dim">MAKES ONE MOCK SENSOR PER PLACE AND A RUN OF REALISTIC READINGS UP TO NOW, WITH A FAULT IF YOU PICK ONE, SO YOU CAN SEE THE BOARD, GRAPHS AND ALARMS WORK. EVERYTHING IS MARKED MOCK AND REMOVED WITH ONE BUTTON.</div>
        <div className="ck-field"><span>PLACES</span><Chips label="Places" value={places} options={placeOpts} onChange={setPlaces} /></div>
        <div className="at-pickrow">
          <div className="ck-field"><span>HOW FAR BACK</span><Buttons label="Hours" value={hours} options={[{ id: '6', label: '6 H' }, { id: '24', label: '24 H' }, { id: '168', label: '7 D' }, { id: '720', label: '30 D' }]} onPick={setHours} /></div>
          <div className="ck-field"><span>A READING EVERY</span><Buttons label="Step" value={step} options={[{ id: '5', label: '5 MIN' }, { id: '10', label: '10 MIN' }, { id: '30', label: '30 MIN' }]} onPick={setStep} /></div>
        </div>
        <div className="ck-field"><span>WHAT GOES WRONG</span><Buttons label="Fault" value={fault} options={MOCK_FAULTS} onPick={setFault} /></div>
        <div className="dim tiny">{MOCK_FAULTS.find((f) => f.id === fault)!.what}</div>
        {fault !== 'none' && (
          <div className="at-pickrow">
            {fault !== 'power' && <div className="ck-field"><span>IN</span><Buttons label="Fault place" value={faultPlace} options={placeOpts.filter((p) => places.includes(p.id))} onPick={setFaultPlace} /></div>}
            <div className="ck-field"><span>STARTED</span><Buttons label="Fault start" value={ago} options={[{ id: '30', label: '30 MIN AGO' }, { id: '120', label: '2 H AGO' }, { id: '360', label: '6 H AGO' }]} onPick={setAgo} /></div>
          </div>
        )}
        <div className="lg-btns">
          <button type="button" className="btn on lg-save" disabled={!places.length} onClick={() => {
            sound.chirp()
            void run('MOCK DATA ADDED', () => addMock(store, { places, hours: Number(hours), stepMin: Number(step), fault, faultPlace: fault === 'power' ? null : faultPlace, faultAgoMin: Number(ago), seed: Math.floor(Math.random() * 100000) }, Date.now())).then((ok) => ok && goNow())
          }}>ADD MOCK DATA (ABOUT {n.toLocaleString('en-US')} READINGS)</button>
        </div>
      </Box>
      <Box title={`MOCK DATA NOW // ${mockN.toLocaleString('en-US')} READINGS, ${mockS} SENSORS`}>
        <Confirm label="REMOVE ALL MOCK DATA" disabled={!mockN && !mockS} onYes={() => void run('MOCK DATA REMOVED', () => removeMock(store))} />
        <div className="dim tiny">REAL READINGS (TYPED OR IMPORTED) ARE NEVER TOUCHED. UNDO PUTS THE MOCK DATA BACK.</div>
      </Box>
    </div>
  )
}

export type { Reading }
