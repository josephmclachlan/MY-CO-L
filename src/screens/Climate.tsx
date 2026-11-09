import { useMemo } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { Guess } from './CookParts'
import { Box, Buttons, copyText, useRun, type Say } from './FacilityParts'
import { ClimateGraph, RANGES, type RangeId } from './ClimateGraph'
import { AcTab, FeedsTab, ImportTab, LogTab, MockTab, SensorsTab, SetPointsTab } from './ClimateForms'
import { useSensors, type SensorData } from '../store/useSensors'
import { dayLong, farmDay, farmTime, fmtMin, stamp } from '../lib/facility'
import {
  MEASURE,
  MEASURES,
  PLACES,
  PLACE_LABEL,
  SENSOR_GUESSES,
  TARGETS,
  alarmMessage,
  bandFor,
  bandText,
  dailyStats,
  excursions,
  fmtVal,
  readingsCsv,
  timeInBand,
  type Alarm,
  type Measure,
  type MeasureNow,
  type PlaceId,
  type PlaceNow,
} from '../lib/sensors'
import { ALARM_ROUTES } from '../lib/sensorFeeds'
import { ackAlarms } from '../lib/sensorActions'

// ATMOSPHERICS (build G8, basic): climate sensors, set-point bands, alarms, hand logs, CSV import, mock data.
// Live feeds wait until construction is done (see FEEDS).

export type AtTab = 'NOW' | 'GRAPHS' | 'ALARMS' | 'LOG READING' | 'IMPORT CSV' | 'AC UNITS' | 'SET POINTS' | 'SENSORS' | 'FEEDS' | 'MOCK TEST' | 'GUESSES'
export const AT_TABS: AtTab[] = ['NOW', 'GRAPHS', 'ALARMS', 'LOG READING', 'IMPORT CSV', 'AC UNITS', 'SET POINTS', 'SENSORS', 'FEEDS', 'MOCK TEST', 'GUESSES']
export interface AtState {
  tab: AtTab
  place: PlaceId
  measure: Measure
  range: RangeId
}
export const AT_START: AtState = { tab: 'NOW', place: 'fruiting', measure: 'temp', range: '24h' }
export type SetAt = (p: Partial<AtState>) => void

const ago = (ms: number, now: number) => {
  const m = Math.max(0, Math.round((now - ms) / 60000))
  return m < 1 ? 'JUST NOW' : `${fmtMin(m)} AGO`
}

// ---------- index (left menu) ----------

export function ClimateIndex({ x, set }: { x: AtState; set: SetAt }) {
  const { sound } = useApp()
  const d = useSensors()
  const live = d.alarms.filter((a) => !a.acked).length
  return (
    <>
      <div className="section-title">ATMOSPHERICS</div>
      <ul className="index-list">
        {AT_TABS.map((t) => (
          <li tabIndex={0} key={t} className={x.tab === t ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            <span>{t}</span>
            {t === 'ALARMS' && live > 0 && <span className="k">{live}</span>}
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>READINGS SAVED</div>
      <div className="lg-mini">
        <div>{d.readings.length.toLocaleString('en-US')} READINGS</div>
        <div>{d.sensors.filter((s) => s.active).length} SENSORS</div>
        <div>{live ? `${live} ALARM${live === 1 ? '' : 'S'}` : 'NO ALARMS'}</div>
      </div>
    </>
  )
}

// ---------- shell ----------

export function Climate({ x, set, say }: { x: AtState; set: SetAt; say: Say }) {
  const { sound } = useApp()
  const d = useSensors()
  return (
    <div className="cook ledger od mn fc at">
      <label className="ck-picker">
        <span>SHOW ({AT_TABS.length} SCREENS)</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as AtTab }))}>
          {AT_TABS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </label>
      {x.tab === 'NOW' && <NowTab d={d} set={set} say={say} />}
      {x.tab === 'GRAPHS' && <GraphsTab d={d} x={x} set={set} say={say} />}
      {x.tab === 'ALARMS' && <AlarmsTab d={d} say={say} />}
      {x.tab === 'LOG READING' && <LogTab d={d} say={say} place={x.place} />}
      {x.tab === 'IMPORT CSV' && <ImportTab d={d} say={say} place={x.place} />}
      {x.tab === 'AC UNITS' && <AcTab d={d} say={say} />}
      {x.tab === 'SET POINTS' && <SetPointsTab say={say} />}
      {x.tab === 'SENSORS' && <SensorsTab d={d} say={say} />}
      {x.tab === 'FEEDS' && <FeedsTab say={say} />}
      {x.tab === 'MOCK TEST' && <MockTab d={d} say={say} goNow={() => set({ tab: 'NOW' })} />}
      {x.tab === 'GUESSES' && (
        <div className="ck-box">
          <div className="section-title">BEST GUESSES WAITING FOR JOSEPH <Guess /></div>
          <ul className="ck-guesses">{SENSOR_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

// ---------- NOW ----------

function stateText(m: MeasureNow, now: number, delay: number): { text: string; warn: boolean } {
  if (m.value === null) return { text: 'NO DATA', warn: false }
  if (m.stale) return { text: `OLD // ${ago(m.at as number, now)}`, warn: false }
  if (m.side === 'ok') return { text: m.band ? 'IN BAND' : 'NO ALARM SET', warn: false }
  const word = m.side === 'high' ? 'HIGH' : 'LOW'
  if (m.alarm) return { text: m.outMin ? `${word} FOR ${fmtMin(m.outMin)}` : `${word} (HAND READING)`, warn: true }
  return { text: `${word} ${fmtMin(m.outMin)} (ALARMS AT ${delay} MIN)`, warn: true }
}

export function AlarmList({ list, say, compact }: { list: Alarm[]; say: Say; compact?: boolean }) {
  const run = useRun(say)
  const store = useStore()
  const d = useSensors()
  return (
    <ul className="fc-rem at-alarms">
      {list.map((a) => (
        <li key={a.key} className={a.acked ? 'dim' : 'warn'}>
          <span className="fc-kind">{a.kind}</span>
          <span className="fc-rtext">{a.text}{a.acked ? ' // SEEN' : ''}</span>
          <span className="fc-ract">
            {!a.acked && !compact && <button type="button" className="btn" onClick={() => void run('ALARM MARKED AS SEEN', () => ackAlarms(store, d.settings, [a.key], Date.now()))}>SEEN</button>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function PlaceCard({ p, d, onOpen }: { p: PlaceNow; d: SensorData; onOpen: () => void }) {
  const place = PLACES.find((x) => x.id === p.place)!
  const shown = p.measures.filter((m) => m.value !== null || m.band)
  const n = d.sensors.filter((s) => s.active && s.place === p.place).length
  return (
    <li className={`at-card ${p.alarm ? 'alarm' : ''}`} tabIndex={0} role="button" aria-label={`${place.long}: open its graph`} onClick={onOpen}>
      <div className="fc-card-head">
        <span className="at-card-name">{place.label}</span>
        <span className={`fc-state ${p.alarm ? 'warn' : ''}`}>{p.alarm ? `ALARM: ${p.measures.filter((m) => m.alarm).map((m) => `${MEASURE[m.measure].label} ${m.side === 'high' ? 'HIGH' : 'LOW'}`).join(', ')}` : p.out ? 'OUT OF BAND' : p.last === null ? 'NO READINGS' : 'OK'}</span>
      </div>
      {shown.length === 0 ? <div className="dim tiny">NO READINGS AND NO ALARM SET.</div> : (
        <dl className="at-vals">
          {shown.map((m) => {
            const st = stateText(m, d.now, d.settings.delayMin[p.place])
            return (
              <div key={m.measure}>
                <dt>{MEASURE[m.measure].label}</dt>
                <dd>
                  <b className={st.warn ? 'lg-warn-text' : ''}>{fmtVal(m.value, m.measure)}</b>
                  <small className={st.warn ? 'lg-warn-text' : 'dim'}>{st.text}{m.band ? ` // BAND ${bandText(m.band, m.measure)}` : ''}</small>
                </dd>
              </div>
            )
          })}
        </dl>
      )}
      <div className="fc-card-sub tiny">{p.last === null ? `${n} SENSOR${n === 1 ? '' : 'S'}` : `LAST READING ${ago(p.last, d.now)} // ${n} SENSOR${n === 1 ? '' : 'S'}`}</div>
    </li>
  )
}

function NowTab({ d, set, say }: { d: SensorData; set: SetAt; say: Say }) {
  const { sound } = useApp()
  const live = d.alarms.filter((a) => !a.acked)
  const shown = d.board.filter((p) => p.last !== null || p.place !== 'outside' && p.place !== 'boiling')
  return (
    <div className="lg-stack">
      {live.length > 0 && (
        <Box title={`ALARMS // ${live.length}`}>
          <AlarmList list={live.slice(0, 5)} say={say} />
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => (sound.chirp(), set({ tab: 'ALARMS' }))}>OPEN ALARMS</button>
          </div>
        </Box>
      )}
      {d.readings.length === 0 && (
        <Box title="NO READINGS YET">
          <div>THE SENSORS GO IN AFTER CONSTRUCTION. UNTIL THEN, THREE WAYS TO PUT READINGS IN:</div>
          <div className="lg-btns">
            <button type="button" className="btn on" onClick={() => (sound.chirp(), set({ tab: 'LOG READING' }))}>TYPE A READING</button>
            <button type="button" className="btn" onClick={() => (sound.chirp(), set({ tab: 'IMPORT CSV' }))}>IMPORT A GOVEE FILE</button>
            <button type="button" className="btn" onClick={() => (sound.chirp(), set({ tab: 'MOCK TEST' }))}>TRY WITH MOCK DATA</button>
          </div>
        </Box>
      )}
      <Box title="ROOMS NOW">
        <ul className="at-cards">
          {shown.map((p) => <PlaceCard key={p.place} p={p} d={d} onOpen={() => (sound.chirp(), set({ tab: 'GRAPHS', place: p.place, measure: p.measures.find((m) => m.value !== null)?.measure ?? 'temp' }))} />)}
        </ul>
        <div className="dim tiny">TAP A ROOM FOR ITS GRAPH. TIMES ARE THE FARM CLOCK. A ROOM ALARMS WHEN IT STAYS OUT OF ITS BAND LONGER THAN ITS DELAY (SET POINTS). LIVE FEEDS COME AFTER CONSTRUCTION: SEE FEEDS.</div>
      </Box>
    </div>
  )
}

// ---------- GRAPHS ----------

function GraphsTab({ d, x, set, say }: { d: SensorData; x: AtState; set: SetAt; say: Say }) {
  const s = d.idx.get(x.place)
  const band = bandFor(d.settings, x.place, x.measure)
  const range = RANGES.find((r) => r.id === x.range) ?? RANGES[1]
  const to = d.now
  const from = to - range.ms
  const label = `${PLACE_LABEL[x.place]} ${MEASURE[x.measure].long}`
  const tib = useMemo(() => timeInBand(s, x.measure, band, from, to), [s, x.measure, band, from, to])
  const ex = useMemo(() => excursions(s, x.measure, band, d.settings.delayMin[x.place], from, to), [s, x.measure, band, d.settings.delayMin, x.place, from, to])
  const days = useMemo(() => dailyStats(s, x.measure, d.now, 14), [s, x.measure, d.now])
  const count = useMemo(() => {
    if (!s) return 0
    let c = 0
    for (let i = s.t.length - 1; i >= 0 && s.t[i] >= from; i--) if (s.t[i] <= to) c++
    return c
  }, [s, from, to])
  const exportCsv = () => {
    const blob = new Blob([readingsCsv(d.readings, d.sensors)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mycol-readings-${farmDay(Date.now())}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    say(`READINGS SAVED AS CSV: ${d.readings.length.toLocaleString('en-US')} LINES.`)
  }
  return (
    <div className="lg-stack">
      <Box title="WHICH GRAPH">
        <div className="at-pickrow">
          <label className="ck-field at-place"><span>PLACE</span>
            <Select aria-label="Place" value={x.place} onChange={(e) => set({ place: e.target.value as PlaceId })}>
              {PLACES.map((p) => <option key={p.id} value={p.id}>{p.long}</option>)}
            </Select>
          </label>
          <div className="ck-field"><span>MEASURE</span>
            <Buttons label="Measure" value={x.measure} options={MEASURES.map((m) => ({ id: m.id, label: m.label }))} onPick={(v) => set({ measure: v })} />
          </div>
          <div className="ck-field"><span>TIME</span>
            <Buttons label="Time range" value={x.range} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} onPick={(v) => set({ range: v })} />
          </div>
        </div>
      </Box>
      <Box title={`${label} // LAST ${range.label}`}>
        <ClimateGraph series={s} measure={x.measure} band={band} from={from} to={to} label={label} />
        <div className="lg-big at-sum">
          <div><span>READINGS</span><b>{count.toLocaleString('en-US')}</b></div>
          <div><span>ALARM BAND</span><b>{bandText(band, x.measure)}</b></div>
          <div><span>TIME IN BAND</span><b className={tib.pct !== null && tib.pct < 95 ? 'lg-warn-text' : ''}>{tib.pct === null ? '--' : `${tib.pct}%`}</b></div>
          <div><span>TIMES OUT OF BAND</span><b className={ex.some((e) => e.alarmed) ? 'lg-warn-text' : ''}>{ex.length}{ex.length ? ` (${ex.filter((e) => e.alarmed).length} ALARMED)` : ''}</b></div>
        </div>
        <div className="dim tiny">TARGET: {TARGETS[x.place]}. TIME IN BAND COUNTS ONLY THE TIME COVERED BY READINGS (EACH ONE STANDS UP TO 1 HOUR). TIMES OUT OF BAND ARE CHECKED AGAINST TODAY'S BAND.</div>
      </Box>
      {ex.length > 0 && (
        <Box title={`TIMES OUT OF BAND // ${ex.length}`}>
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>STARTED</th><th>HOW LONG</th><th>WAY</th><th>WORST</th><th>ALARM</th></tr></thead>
              <tbody>
                {[...ex].reverse().slice(0, 50).map((e) => (
                  <tr key={e.start}>
                    <td>{stamp(e.start)}</td>
                    <td>{e.end === null ? `${fmtMin(e.minutes)} SO FAR` : fmtMin(e.minutes)}</td>
                    <td>{e.side === 'high' ? 'HIGH' : 'LOW'}</td>
                    <td className="lg-warn-text">{fmtVal(e.peak, x.measure)}</td>
                    <td>{e.alarmed ? 'YES' : 'NO (SHORT)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
      )}
      <Box title={`DAY BY DAY // ${MEASURE[x.measure].label} // LAST 14 DAYS`}>
        {days.length === 0 ? <div className="dim">NO READINGS IN THE LAST 14 DAYS.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>LOWEST</th><th>AVERAGE</th><th>HIGHEST</th><th>READINGS</th></tr></thead>
              <tbody>
                {days.map((r) => {
                  const lo = band?.lo !== null && band?.lo !== undefined && r.min < band.lo
                  const hi = band?.hi !== null && band?.hi !== undefined && r.max > band.hi
                  return (
                    <tr key={r.day}>
                      <td>{dayLong(r.day)}</td>
                      <td className={lo ? 'lg-warn-text' : ''}>{fmtVal(r.min, x.measure)}</td>
                      <td>{fmtVal(r.avg, x.measure)}</td>
                      <td className={hi ? 'lg-warn-text' : ''}>{fmtVal(r.max, x.measure)}</td>
                      <td>{r.n}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="lg-btns">
          <button type="button" className="btn" disabled={!d.readings.length} onClick={exportCsv}>EXPORT ALL READINGS AS CSV</button>
        </div>
        <div className="dim tiny">READINGS ARE NOT IN THE APP'S BACKUP FILE (THEY GROW WITHOUT END). KEEP THIS CSV AS THEIR COPY.</div>
      </Box>
    </div>
  )
}

// ---------- ALARMS ----------

function AlarmsTab({ d, say }: { d: SensorData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const live = d.alarms.filter((a) => !a.acked)
  const from = d.now - 30 * 86400000
  const history = useMemo(() => {
    const out: { place: PlaceId; measure: Measure; e: ReturnType<typeof excursions>[number] }[] = []
    for (const p of PLACES) for (const m of MEASURES) {
      const band = bandFor(d.settings, p.id, m.id)
      for (const e of excursions(d.idx.get(p.id), m.id, band, d.settings.delayMin[p.id], from, d.now)) if (e.alarmed) out.push({ place: p.id, measure: m.id, e })
    }
    return out.sort((a, b) => b.e.start - a.e.start)
  }, [d.idx, d.settings, from, d.now])
  return (
    <div className="lg-stack">
      <Box title={`ALARMS NOW // ${live.length}`}>
        {d.alarms.length === 0 ? <div className="dim">NO ALARMS. THE LATTICE HOLDS.</div> : <AlarmList list={d.alarms} say={say} />}
        <div className="lg-btns">
          <button type="button" className="btn" disabled={!live.length} onClick={() => void run(`${live.length} ALARMS MARKED AS SEEN`, () => ackAlarms(store, d.settings, live.map((a) => a.key), Date.now()))}>MARK ALL AS SEEN</button>
          <button type="button" className="btn on" onClick={() => void copyText(alarmMessage(d.alarms, Date.now())).then((ok) => say(ok ? 'ALARM TEXT COPIED. PASTE IT INTO WHATSAPP.' : 'COULD NOT COPY.', !ok))}>COPY ALARM TEXT FOR WHATSAPP</button>
        </div>
        <div className="dim tiny">SEEN HIDES AN ALARM FROM THE MAIN MENU. IF THE ROOM GOES OUT AGAIN LATER, THAT IS A NEW ALARM.</div>
      </Box>
      <Box title={`ALARM HISTORY // LAST 30 DAYS // ${history.length}`}>
        {history.length === 0 ? <div className="dim">NO ROOM WENT OUT OF ITS BAND LONG ENOUGH TO ALARM.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>STARTED</th><th>PLACE</th><th>WHAT</th><th>HOW LONG</th><th>WORST</th></tr></thead>
              <tbody>
                {history.slice(0, 100).map((h) => (
                  <tr key={`${h.place}${h.measure}${h.e.start}`}>
                    <td>{dayLong(farmDay(h.e.start))} {farmTime(h.e.start)}</td>
                    <td>{PLACE_LABEL[h.place]}</td>
                    <td>{MEASURE[h.measure].label} {h.e.side === 'high' ? 'HIGH' : 'LOW'}</td>
                    <td>{h.e.end === null ? `${fmtMin(h.e.minutes)} SO FAR` : fmtMin(h.e.minutes)}</td>
                    <td className="lg-warn-text">{fmtVal(h.e.peak, h.measure)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dim tiny">WORKED OUT FROM THE SAVED READINGS AGAINST TODAY'S BANDS.</div>
      </Box>
      <Box title="WHERE ALARMS GO">
        <ul className="fc-steps">
          {ALARM_ROUTES.map((r) => (
            <li key={r.id}><b>{r.label}</b> <span className={r.ready ? '' : 'dim'}>{r.ready ? '// WORKS NOW' : '// AFTER CONSTRUCTION'}</span><div className="fc-text dim">{r.text}</div></li>
          ))}
        </ul>
      </Box>
    </div>
  )
}

// ---------- main menu and DECK PLAN pieces ----------

/** The room's newest readings, for the DECK PLAN room panel. */
export function RoomClimate({ room }: { room: string }) {
  const d = useSensors()
  const rows = d.board.filter((p) => PLACES.find((x) => x.id === p.place)!.room === room && p.last !== null)
  return (
    <>
      <div className="section-title rr-sec">CLIMATE SENSORS</div>
      {rows.length === 0 ? (
        <div className="dim tiny">NO READINGS FOR THIS ROOM YET. TYPE CLIMATE AT THE PROMPT TO LOG ONE OR IMPORT A GOVEE FILE.</div>
      ) : (
        <div className="at-room">
          {rows.map((p) => {
            const bad = p.measures.filter((m) => m.alarm)
            return (
              <div key={p.place} className={p.alarm ? 'lg-warn-text' : ''}>
                {PLACE_LABEL[p.place]}: {p.measures.filter((m) => m.value !== null).map((m) => `${MEASURE[m.measure].label} ${fmtVal(m.value, m.measure)}`).join(' // ')}
                {bad.length > 0 && ` // CLIMATE ALARM: ${bad.map((m) => `${MEASURE[m.measure].label} ${m.side === 'high' ? 'HIGH' : 'LOW'}`).join(', ')}`} <span className="dim">({ago(p.last as number, d.now)})</span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
