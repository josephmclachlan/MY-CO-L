import { useMemo, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { HistoryButton } from './History'
import { Confirm, Guess } from './CookParts'
import { Box, Buttons, Chips, DateTimeField, Fold, Spark, copyText, getInitials, momentOf, num, numOrNaN, setInitials, splitMs, useRun, type Say } from './FacilityParts'
import { monthLabel } from '../lib/money'
import { useFacilityEditor, type FacilityData } from '../store/useFacility'
import {
  DEFAULT_LIMITS,
  FUELS,
  ROOM_LABEL,
  ROOM_LIST,
  WATER_FIELDS,
  WATER_LABEL,
  WATER_POINTS,
  cutLine,
  cutStats,
  evalWater,
  farmDay,
  farmTime,
  fmtHours,
  fmtMin,
  isOpenCut,
  lastMonths,
  limitFor,
  outageReport,
  stamp,
  waterSeries,
  type CutInput,
  type Fuel,
  type PowerCut,
  type WaterField,
  type WaterPoint,
  type WaterTest,
} from '../lib/facility'
import { cutInput, deleteCut, deleteWater, genStart, genStop, powerBack, powerOut, saveCut, saveWater } from '../lib/facilityActions'
// ==========================================================================================
// POWER CUTS
// ==========================================================================================

const fuelText = (c: { propaneKg: number; gasolineL: number }) => [c.propaneKg ? `${Math.round(c.propaneKg * 10) / 10} KG PROPANE` : '', c.gasolineL ? `${Math.round(c.gasolineL * 10) / 10} L GASOLINE` : ''].filter(Boolean).join(' + ') || '--'

export function PowerTab({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const [who] = useState(getInitials)
  const open = d.summary.open
  const st = open ? cutStats(open, d.now) : null
  const genOpen = d.cuts.find((c) => (c.gen_runs ?? []).some((r) => r.off === null) && (c.kind === 'test' || c.up_at === null)) ?? null
  const months = useMemo(() => lastMonths(d.cuts, d.now, 12), [d.cuts, d.now])
  const [edit, setEdit] = useState<PowerCut | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [all, setAll] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => [...d.cuts].sort((a, b) => b.down_at.localeCompare(a.down_at)), [d.cuts])
  const y = d.summary.year
  const tm = d.summary.thisMonth
  const startEdit = (c: PowerCut | null) => {
    setEdit(c)
    setShowForm(true)
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  return (
    <div className="lg-stack">
      <Box title={open ? 'POWER IS OUT' : 'GRID IS UP'}>
        {open && st ? (
          <>
            <div className="lg-big fc-live">
              <div><span>OUT SINCE</span><b className="lg-warn-text">{stamp(Date.parse(open.down_at))}</b></div>
              <div><span>NO GRID FOR</span><b className="lg-warn-text">{fmtMin(st.gridMin)}</b></div>
              <div><span>ON GENERATOR</span><b>{fmtMin(st.onGenMin)}</b></div>
              <div><span>FULLY DARK</span><b className={st.darkMin > 0 ? 'lg-warn-text' : ''}>{fmtMin(st.darkMin)}</b></div>
            </div>
            <div className="lg-btns">
              {genOpen ? (
                <button type="button" className="btn on" onClick={() => void run('GENERATOR STOPPED', () => genStop(store, Date.now()))}>GENERATOR STOPPED NOW</button>
              ) : (
                <button type="button" className="btn on" onClick={() => void run('GENERATOR STARTED', () => genStart(store, Date.now(), who || null))}>GENERATOR STARTED NOW</button>
              )}
              <button type="button" className="btn on" onClick={() => void run('POWER BACK', () => powerBack(store, Date.now()))}>POWER IS BACK NOW</button>
            </div>
            {st.gridMin > 3 * 1440 && <div className="lg-warn">THIS CUT HAS BEEN OPEN FOR {fmtMin(st.gridMin)}. DID YOU FORGET TO PRESS POWER IS BACK? USE EDIT ON THE LIST BELOW TO FIX THE TIMES.</div>}
            <div className="dim tiny">TIMES ARE THE FARM CLOCK (COSTA RICA). NO GRID = TIME THE POWER WAS OUT. FULLY DARK = NO GRID AND NO GENERATOR. OPEN THE POWER CUT RESPONSE CHECKLIST ON CHECKLISTS.</div>
          </>
        ) : (
          <>
            <div className="lg-big fc-live">
              <div><span>{monthLabel(tm.month)} NO GRID</span><b>{fmtHours(tm.gridMin)}</b></div>
              <div><span>{monthLabel(tm.month)} CUTS</span><b>{tm.cuts}</b></div>
              <div><span>LAST 12 MONTHS NO GRID</span><b>{fmtHours(y.gridMin)}</b></div>
              <div><span>LAST 12 MONTHS FULLY DARK</span><b>{fmtHours(y.darkMin)}</b></div>
            </div>
            <div className="lg-btns">
              <button type="button" className="btn on" onClick={() => void run('POWER CUT STARTED', () => powerOut(store, Date.now(), who || null))}>POWER WENT OUT NOW</button>
              {genOpen ? (
                <button type="button" className="btn" onClick={() => void run('TEST RUN STOPPED', () => genStop(store, Date.now()))}>GENERATOR TEST STOPPED NOW</button>
              ) : (
                <button type="button" className="btn" onClick={() => void run('GENERATOR TEST STARTED', () => genStart(store, Date.now(), who || null))}>GENERATOR TEST STARTED NOW</button>
              )}
            </div>
            <div className="dim tiny">PRESS THE FIRST BUTTON THE MOMENT THE POWER FAILS: THE LOG COUNTS THE TIME FOR YOU. FORGOT? USE LOG A PAST CUT BELOW AND TYPE THE TIMES.</div>
          </>
        )}
      </Box>

      <Box title="HOURS WITHOUT POWER // LAST 12 MONTHS">
        <div className="rc-wrap">
          <table className="lg-table rc-table fc-months">
            <thead><tr><th>MONTH</th><th>CUTS</th><th>NO GRID</th><th>ON GEN</th><th>FULLY DARK</th><th>GEN HOURS</th><th>FUEL</th><th>GRID UP</th></tr></thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month} className={m.cuts ? '' : 'dim'}>
                  <td>{monthLabel(m.month)}</td>
                  <td>{m.cuts}{m.tests ? ` +${m.tests} TEST` : ''}</td>
                  <td>{fmtHours(m.gridMin)}</td>
                  <td>{fmtHours(m.onGenMin)}</td>
                  <td className={m.darkMin > 0 ? 'lg-warn-text' : ''}>{fmtHours(m.darkMin)}</td>
                  <td>{(Math.round(m.genHours * 10) / 10).toFixed(1)}</td>
                  <td>{fuelText(m)}</td>
                  <td>{m.gridUpPct.toFixed(2)}%</td>
                </tr>
              ))}
              <tr className="fc-total">
                <td>12 MONTHS</td><td>{y.cuts}</td><td>{fmtHours(y.gridMin)}</td><td>{fmtHours(y.onGenMin)}</td><td>{fmtHours(y.darkMin)}</td><td>{(Math.round(y.genHours * 10) / 10).toFixed(1)}</td><td>{fuelText({ propaneKg: months.reduce((n, m) => n + m.propaneKg, 0), gasolineL: months.reduce((n, m) => n + m.gasolineL, 0) })}</td><td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="dim tiny">
          NO GRID = HOURS ICE POWER WAS OUT. ON GEN = THOSE HOURS THE GENERATOR WAS RUNNING. FULLY DARK = NO GRID AND NO GENERATOR. A CUT THAT CROSSES MIDNIGHT AT THE MONTH END IS SPLIT BETWEEN THE TWO MONTHS. LONGEST CUT IN 12 MONTHS: {fmtMin(y.longestMin)}.
        </div>
        <div className="lg-btns">
          <button type="button" className="btn" onClick={() => void copyText(outageReport(d.cuts, d.now, 12)).then((ok) => say(ok ? 'REPORT COPIED. PASTE IT INTO WHATSAPP OR AN EMAIL TO ICE.' : 'COULD NOT COPY. SELECT THE TABLE AND COPY IT BY HAND.', !ok))}>COPY 12-MONTH REPORT</button>
        </div>
      </Box>

      <div ref={formRef}>
        {showForm ? (
          <CutForm key={edit?.id ?? 'new'} edit={edit} say={say} onDone={() => (setShowForm(false), setEdit(null))} />
        ) : (
          <Box title="LOG A PAST CUT OR A GENERATOR TEST">
            <button type="button" className="btn on" onClick={() => startEdit(null)}>LOG A PAST CUT</button>
            <div className="dim tiny">FOR A CUT YOU DID NOT TIME LIVE: TYPE WHEN IT STARTED, WHEN POWER CAME BACK, AND WHEN THE GENERATOR RAN.</div>
          </Box>
        )}
      </div>

      <Box title={`ALL CUTS AND TEST RUNS // ${list.length}`}>
        {list.length === 0 ? <div className="dim">NOTHING LOGGED YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>WHEN</th><th>NO GRID</th><th>FULLY DARK</th><th className="hide-sm">GEN H</th><th className="hide-sm">FUEL</th><th className="hide-sm">AFFECTED</th><th /></tr></thead>
              <tbody>
                {(all ? list.slice(0, 500) : list.slice(0, 20)).map((c) => {
                  const s = cutStats(c, d.now)
                  return (
                    <tr key={c.id} className={isOpenCut(c) ? 'od-row over' : ''}>
                      <td>{c.kind === 'test' ? 'TEST ' : ''}{cutLine(c, d.now).split('  ')[0]}</td>
                      <td>{c.kind === 'test' ? '--' : fmtMin(s.gridMin)}</td>
                      <td>{c.kind === 'test' ? '--' : fmtMin(s.darkMin)}</td>
                      <td className="hide-sm">{s.genHours.toFixed(1)}</td>
                      <td className="hide-sm">{c.fuel_amount ? `${c.fuel_amount} ${c.fuel === 'propane' ? 'KG' : 'L'}` : '--'}</td>
                      <td className="hide-sm">{(c.affected ?? []).map((a) => ROOM_LABEL[a] ?? a).join(', ') || '--'}</td>
                      <td className="mn-act">
                        <button type="button" className="btn" onClick={() => startEdit(c)}>EDIT</button>
                        <HistoryButton table="power_cuts" id={c.id} />
                        <Confirm label="DELETE" onYes={() => void run('POWER CUT DELETED', () => deleteCut(store, c.id))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 20 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW THE NEWEST 20' : `SHOW MORE (${Math.min(500, list.length)})`}</button>}
      </Box>
    </div>
  )
}

interface RunRow {
  onDay: string
  onTime: string
  offDay: string
  offTime: string
}

function CutForm({ edit, say, onDone }: { edit: PowerCut | null; say: Say; onDone: () => void }) {
  const run = useRun(say)
  const store = useStore()
  const input = edit ? cutInput(edit) : null
  const split = (ms: number | null) => (ms === null ? { day: '', time: '' } : splitMs(ms))
  const [kind, setKind] = useState<'cut' | 'test'>(input?.kind ?? 'cut')
  const [down, setDown] = useState(split(input?.down ?? null))
  const [up, setUp] = useState(split(input?.up ?? null))
  const [runs, setRuns] = useState<RunRow[]>(() =>
    (input?.runs ?? []).map((r) => ({ onDay: split(r.on).day, onTime: split(r.on).time, offDay: split(r.off).day, offTime: split(r.off).time })),
  )
  const [hours, setHours] = useState(input?.genHours != null ? String(input.genHours) : '')
  const [fuel, setFuel] = useState<Fuel | null>(input?.fuel ?? null)
  const [fuelAmt, setFuelAmt] = useState(input?.fuelAmount != null ? String(input.fuelAmount) : '')
  const [affected, setAffected] = useState<string[]>(input?.affected ?? [])
  const [losses, setLosses] = useState(input?.losses ?? '')
  const [notes, setNotes] = useState(input?.notes ?? '')
  const [who, setWho] = useState(input?.who ?? getInitials())
  const nowMs = Date.now()
  const today = farmDay(nowMs)
  const build = (): CutInput => ({
    kind,
    down: kind === 'test' && runs[0] ? momentOf(runs[0].onDay, runs[0].onTime) : momentOf(down.day, down.time),
    up: kind === 'cut' ? momentOf(up.day, up.time) : null,
    runs: runs.filter((r) => r.onDay || r.onTime || r.offDay || r.offTime).map((r) => ({ on: momentOf(r.onDay, r.onTime), off: momentOf(r.offDay, r.offTime) })),
    genHours: numOrNaN(hours),
    fuel,
    fuelAmount: numOrNaN(fuelAmt),
    affected,
    losses,
    notes,
    who,
  })
  const save = () =>
    void run(edit ? 'POWER CUT CHANGED' : kind === 'test' ? 'GENERATOR TEST LOGGED' : 'POWER CUT LOGGED', async () => {
      setInitials(who)
      await saveCut(store, edit?.id ?? null, build(), Date.now())
    }).then((ok) => ok && onDone())
  const preview = (() => {
    const i = build()
    if (kind !== 'cut' || i.down === null || Number.isNaN(i.down) || i.up === null || Number.isNaN(i.up) || i.up <= i.down) return null
    const fake = { id: 'x', kind: 'cut', down_at: new Date(i.down).toISOString(), up_at: new Date(i.up).toISOString(), gen_runs: i.runs.every((r) => r.on !== null && !Number.isNaN(r.on) && (r.off === null || !Number.isNaN(r.off))) ? i.runs.map((r) => ({ on: new Date(r.on as number).toISOString(), off: r.off === null ? null : new Date(r.off).toISOString() })) : null, gen_hours: null } as unknown as PowerCut
    return cutStats(fake, nowMs)
  })()
  const addRun = () => setRuns([...runs, { onDay: today, onTime: farmTime(nowMs), offDay: '', offTime: '' }])
  const setRun = (i: number, p: Partial<RunRow>) => setRuns(runs.map((r, k) => (k === i ? { ...r, ...p } : r)))
  return (
    <Box title={edit ? 'CHANGE THIS ENTRY' : 'LOG A PAST CUT OR A GENERATOR TEST'}>
      <Buttons label="Kind of entry" value={kind} options={[{ id: 'cut', label: 'POWER CUT' }, { id: 'test', label: 'GENERATOR TEST (NO CUT)' }]} onPick={(k) => (setKind(k), k === 'test' && runs.length === 0 && addRun())} />
      {kind === 'cut' && (
        <div className="ck-fields">
          <DateTimeField label="POWER WENT OUT" day={down.day} time={down.time} onChange={(day, time) => setDown({ day, time })} />
          <DateTimeField label="POWER CAME BACK (BLANK = STILL OUT)" optional day={up.day} time={up.time} onChange={(day, time) => setUp({ day, time })} />
        </div>
      )}
      <div className="ck-field">
        <span>{kind === 'test' ? 'GENERATOR RUN' : 'GENERATOR RUNS (IF IT RAN)'}</span>
        {runs.map((r, i) => (
          <div key={i} className="fc-run">
            <DateTimeField label={`RUN ${i + 1} STARTED`} day={r.onDay} time={r.onTime} onChange={(onDay, onTime) => setRun(i, { onDay, onTime })} />
            <DateTimeField label={`RUN ${i + 1} STOPPED (BLANK = RUNNING)`} optional day={r.offDay} time={r.offTime} onChange={(offDay, offTime) => setRun(i, { offDay, offTime })} />
            <button type="button" className="btn" onClick={() => setRuns(runs.filter((_, k) => k !== i))}>REMOVE RUN {i + 1}</button>
          </div>
        ))}
        {runs.length < 10 && <button type="button" className="btn" onClick={addRun}>{runs.length ? 'ADD ANOTHER RUN' : 'ADD A GENERATOR RUN'}</button>}
      </div>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>GENERATOR METER HOURS (OPTIONAL)</span><input inputMode="decimal" value={hours} placeholder="HOURS RUN" onChange={(e) => setHours(e.target.value)} /><em>USED INSTEAD OF THE RUN TIMES FOR GENERATOR HOURS.</em></label>
        <label className="ck-field"><span>FUEL USED{fuel ? ` (${fuel === 'propane' ? 'KG' : 'LITRES'})` : ''}</span><input inputMode="decimal" value={fuelAmt} placeholder="0" onChange={(e) => setFuelAmt(e.target.value)} /></label>
      </div>
      <div className="ck-field"><span>FUEL</span><Buttons label="Fuel" value={fuel ?? ('' as Fuel)} options={FUELS.map((f) => ({ id: f.id, label: `${f.label} (${f.unit})` }))} onPick={setFuel} /></div>
      <div className="ck-field"><span>WHAT WAS AFFECTED</span><Chips label="Rooms affected" value={affected} options={[...ROOM_LIST, { id: 'outside', label: 'OUTSIDE' }]} onChange={setAffected} /></div>
      <label className="ck-field"><span>WHAT WAS LOST OR AT RISK</span><input value={losses} placeholder="E.G. 6 BAGS WARM, FRIDGE REACHED 7 C" onChange={(e) => setLosses(e.target.value)} /></label>
      <div className="ck-fields ck-quick">
        <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="ck-field"><span>LOGGED BY</span><input value={who} placeholder="INITIALS" onChange={(e) => setWho(e.target.value)} /></label>
      </div>
      {preview && (
        <div className="dim">THIS ENTRY: NO GRID {fmtMin(preview.gridMin)} // ON GENERATOR {fmtMin(preview.onGenMin)} // FULLY DARK {fmtMin(preview.darkMin)}</div>
      )}
      <div className="lg-btns">
        <button type="button" className="btn on lg-save" onClick={save}>SAVE</button>
        <button type="button" className="btn" onClick={onDone}>CANCEL</button>
      </div>
    </Box>
  )
}

// ==========================================================================================
// WATER
// ==========================================================================================

const fmtV = (v: unknown, dp = 1) => (v === null || v === undefined ? '--' : String(Math.round(Number(v) * 10 ** dp) / 10 ** dp))

export function WaterTab({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const store = useStore()
  const { sound } = useApp()
  const [edit, setEdit] = useState<WaterTest | null>(null)
  const [all, setAll] = useState(false)
  const [point, setPoint] = useState<WaterPoint>('ro')
  const [day, setDay] = useState(d.today)
  const [time, setTime] = useState('')
  const [ph, setPh] = useState('')
  const [tds, setTds] = useState('')
  const [hard, setHard] = useState('')
  const [cl, setCl] = useState('')
  const [temp, setTemp] = useState('')
  const [action, setAction] = useState('')
  const [notes, setNotes] = useState('')
  const [who, setWho] = useState(getInitials)
  const formRef = useRef<HTMLDivElement>(null)
  const list = useMemo(() => [...d.water].sort((a, b) => b.tested_on.localeCompare(a.tested_on) || (b.tested_time ?? '').localeCompare(a.tested_time ?? '') || (b.created_at ?? '').localeCompare(a.created_at ?? '')), [d.water])
  const reset = () => {
    setEdit(null)
    setPh(''); setTds(''); setHard(''); setCl(''); setTemp(''); setAction(''); setNotes(''); setTime('')
    setDay(d.today)
  }
  const draft = (): WaterTest => ({ id: edit?.id ?? 'draft', tested_on: day, tested_time: time || null, point, ph: num(ph), tds_ppm: num(tds), hardness_ppm: num(hard), cl_ppm: num(cl), temp_c: num(temp), action: null, notes: null, who: null })
  const live = evalWater(draft(), d.settings)
  const save = () =>
    void run(edit ? 'WATER TEST CHANGED' : `WATER TEST LOGGED // ${WATER_LABEL[point]}`, async () => {
      setInitials(who)
      await saveWater(store, edit?.id ?? null, { day, time: time || null, point, ph: numOrNaN(ph), tds: numOrNaN(tds), hardness: numOrNaN(hard), cl: numOrNaN(cl), temp: numOrNaN(temp), action, notes, who }, d.today)
    }).then((ok) => ok && reset())
  const startEdit = (t: WaterTest) => {
    setEdit(t)
    setPoint(t.point); setDay(t.tested_on); setTime(t.tested_time ?? '')
    setPh(t.ph == null ? '' : String(t.ph)); setTds(t.tds_ppm == null ? '' : String(t.tds_ppm)); setHard(t.hardness_ppm == null ? '' : String(t.hardness_ppm)); setCl(t.cl_ppm == null ? '' : String(t.cl_ppm)); setTemp(t.temp_c == null ? '' : String(t.temp_c))
    setAction(t.action ?? ''); setNotes(t.notes ?? ''); setWho(t.who ?? getInitials())
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }
  return (
    <div className="lg-stack">
      <Box title="WATER AT EACH POINT // LAST TEST AND WHEN THE NEXT IS DUE" extra={<Guess />}>
        <div className="rc-wrap">
          <table className="lg-table rc-table fc-water">
            <thead><tr><th>POINT</th><th>LAST TEST</th><th>PH</th><th>TDS PPM</th><th>HARD PPM</th><th>CL PPM</th><th className="hide-sm">TDS TREND</th><th>STATE</th></tr></thead>
            <tbody>
              {d.waterDue.map((w) => {
                const l = w.last
                const bad = (f: WaterField) => w.issues.some((i) => i.field === f)
                const lim = limitFor(d.settings, w.point, 'tds')
                return (
                  <tr key={w.point} className={w.issues.length ? 'od-row over' : ''}>
                    <td>{WATER_LABEL[w.point]}</td>
                    <td>{l ? l.tested_on.slice(5) : 'NEVER'}</td>
                    <td className={bad('ph') ? 'lg-warn-text' : ''}>{fmtV(l?.ph)}</td>
                    <td className={bad('tds') ? 'lg-warn-text' : ''}>{fmtV(l?.tds_ppm, 0)}</td>
                    <td className={bad('hardness') ? 'lg-warn-text' : ''}>{fmtV(l?.hardness_ppm, 0)}</td>
                    <td className={bad('cl') ? 'lg-warn-text' : ''}>{fmtV(l?.cl_ppm)}</td>
                    <td className="hide-sm"><Spark label={`${WATER_LABEL[w.point]} TDS`} values={waterSeries(d.water, w.point, 'tds').map((p) => p.v)} hi={lim.max} lo={lim.min} unit=" ppm" /></td>
                    <td>{w.issues.length ? 'OUT OF LIMIT' : w.state === 'never' ? 'NO TEST YET' : w.state === 'off' ? 'NO REMINDER' : w.state === 'late' ? `OVERDUE ${-(w.left as number)} D` : w.state === 'due' ? 'DUE TODAY' : `NEXT ${w.dueOn?.slice(5)}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {d.waterDue.filter((w) => w.issues.length).map((w) => (
          <div key={w.point} className="lg-warn">{WATER_LABEL[w.point]}: {w.issues.map((i) => i.text).join('; ')}{w.last?.action ? ` // ACTION: ${w.last.action.toUpperCase()}` : ''}</div>
        ))}
        <div className="dim tiny">PH 7 IS NEUTRAL. TDS = DISSOLVED SOLIDS (A CHEAP PEN METER READS IT). HARD = CALCIUM AND MAGNESIUM. CL = CHLORINE, OR THE BLEACH DOSE IN THE HUMIDIFIER TANK. LIMITS ARE WORKING NUMBERS: CHANGE THEM UNDER LIMITS + HOW OFTEN.</div>
      </Box>

      <div ref={formRef}>
        <Box title={edit ? 'CHANGE THIS TEST' : 'LOG A WATER TEST'}>
          <div className="ck-fields">
            <label className="ck-field">
              <span>WHERE THE SAMPLE CAME FROM</span>
              <Select aria-label="Sampling point" value={point} onChange={(e) => setPoint(e.target.value as WaterPoint)}>
                {WATER_POINTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
              <em>{WATER_POINTS.find((p) => p.id === point)?.where.toUpperCase()}</em>
            </label>
            <label className="ck-field"><span>DAY</span><PickInput type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          </div>
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>PH</span><input inputMode="decimal" value={ph} placeholder="7.0" onChange={(e) => setPh(e.target.value)} /></label>
            <label className="ck-field"><span>TDS (PPM)</span><input inputMode="decimal" value={tds} placeholder="0" onChange={(e) => setTds(e.target.value)} /></label>
            <label className="ck-field"><span>HARDNESS (PPM)</span><input inputMode="decimal" value={hard} placeholder="0" onChange={(e) => setHard(e.target.value)} /></label>
            <label className="ck-field"><span>{point === 'tank' ? 'BLEACH DOSE (PPM)' : 'CHLORINE (PPM)'}</span><input inputMode="decimal" value={cl} placeholder="0" onChange={(e) => setCl(e.target.value)} /></label>
            <label className="ck-field"><span>WATER TEMP (C)</span><input inputMode="decimal" value={temp} placeholder="OPTIONAL" onChange={(e) => setTemp(e.target.value)} /></label>
            <label className="ck-field"><span>TIME (OPTIONAL)</span><PickInput type="time" value={time} clearable onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          {live.length > 0 ? <div className="lg-warn">{live.map((i) => i.text).join('; ')}</div> : (ph || tds || hard || cl) ? <div className="dim">ALL READINGS ARE INSIDE THE LIMITS FOR THIS POINT.</div> : null}
          <label className="ck-field"><span>ACTION TAKEN (IF ANYTHING WAS OUT OF LIMIT)</span><input value={action} placeholder="E.G. CHANGED CARTRIDGE, RE-DOSED BLEACH" onChange={(e) => setAction(e.target.value)} /></label>
          <div className="ck-fields ck-quick">
            <label className="ck-field"><span>NOTES</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <label className="ck-field"><span>TESTED BY</span><input value={who} placeholder="INITIALS" onChange={(e) => setWho(e.target.value)} /></label>
          </div>
          <div className="lg-btns">
            <button type="button" className="btn on lg-save" onClick={save}>SAVE</button>
            {edit && <button type="button" className="btn" onClick={reset}>CANCEL</button>}
          </div>
        </Box>
      </div>

      <LimitsBox d={d} say={say} onPick={() => sound.chirp()} />

      <Box title={`ALL WATER TESTS // ${list.length}`}>
        {list.length === 0 ? <div className="dim">NO TESTS YET.</div> : (
          <div className="rc-wrap">
            <table className="lg-table rc-table">
              <thead><tr><th>DAY</th><th>POINT</th><th>PH</th><th>TDS</th><th>HARD</th><th>CL</th><th className="hide-sm">ACTION</th><th /></tr></thead>
              <tbody>
                {(all ? list.slice(0, 500) : list.slice(0, 20)).map((t) => {
                  const bad = evalWater(t, d.settings)
                  return (
                    <tr key={t.id} className={bad.length ? 'od-row over' : ''}>
                      <td>{t.tested_on}</td>
                      <td>{WATER_LABEL[t.point]}</td>
                      <td>{fmtV(t.ph)}</td><td>{fmtV(t.tds_ppm, 0)}</td><td>{fmtV(t.hardness_ppm, 0)}</td><td>{fmtV(t.cl_ppm)}</td>
                      <td className="hide-sm">{t.action ?? (bad.length ? 'OUT OF LIMIT' : '--')}</td>
                      <td className="mn-act">
                        <button type="button" className="btn" onClick={() => startEdit(t)}>EDIT</button>
                        <HistoryButton table="water_tests" id={t.id} />
                        <Confirm label="DELETE" onYes={() => void run('WATER TEST DELETED', () => deleteWater(store, t.id))} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 20 && <button type="button" className="btn" onClick={() => setAll(!all)}>{all ? 'SHOW THE NEWEST 20' : `SHOW MORE (${Math.min(500, list.length)})`}</button>}
      </Box>
    </div>
  )
}

function LimitsBox({ d, say, onPick }: { d: FacilityData; say: Say; onPick: () => void }) {
  const run = useRun(say)
  const [, save] = useFacilityEditor()
  const [point, setPoint] = useState<WaterPoint>('ro')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const key = (f: WaterField, side: 'min' | 'max') => `${point}:${f}:${side}`
  const val = (f: WaterField, side: 'min' | 'max') => draft[key(f, side)] ?? (limitFor(d.settings, point, f)[side] ?? '').toString()
  const apply = () =>
    void run(`WATER LIMITS SAVED // ${WATER_LABEL[point]}`, async () => {
      const out: Partial<Record<WaterField, { min?: number; max?: number }>> = {}
      for (const f of WATER_FIELDS) {
        const lim: { min?: number; max?: number } = {}
        for (const side of ['min', 'max'] as const) {
          const t = val(f.id, side).trim()
          if (!t) continue
          const n = Number(t)
          if (!Number.isFinite(n)) throw new Error(`${f.label} ${side.toUpperCase()}: TYPE A NUMBER.`)
          lim[side] = n
        }
        if (lim.min !== undefined && lim.max !== undefined && lim.min > lim.max) throw new Error(`${f.label}: MIN IS ABOVE MAX.`)
        out[f.id] = lim
      }
      await save({ limits: { ...d.settings.limits, [point]: out } }, `WATER LIMITS // ${WATER_LABEL[point]}`)
      setDraft({})
    })
  const reset = () =>
    void run(`WATER LIMITS BACK TO WORKING NUMBERS // ${WATER_LABEL[point]}`, async () => {
      const rest = { ...d.settings.limits }
      delete rest[point]
      await save({ limits: rest }, `WATER LIMITS RESET // ${WATER_LABEL[point]}`)
      setDraft({})
    })
  return (
    <Fold title="LIMITS + HOW OFTEN TO TEST">
      <div className="ck-field"><span>POINT</span><Buttons label="Point" value={point} options={WATER_POINTS.map((p) => ({ id: p.id, label: p.label }))} onPick={(p) => (onPick(), setPoint(p), setDraft({}))} /></div>
      <div className="rc-wrap">
        <table className="lg-table rc-table">
          <thead><tr><th>READING</th><th>MIN</th><th>MAX</th><th className="hide-sm">WORKING DEFAULT</th></tr></thead>
          <tbody>
            {WATER_FIELDS.map((f) => {
              const def = DEFAULT_LIMITS[point][f.id]
              return (
                <tr key={f.id}>
                  <td>{point === 'tank' && f.id === 'cl' ? 'BLEACH DOSE' : f.label}</td>
                  <td><input className="mn-cell" aria-label={`${f.label} minimum`} inputMode="decimal" value={val(f.id, 'min')} placeholder="--" onChange={(e) => setDraft({ ...draft, [key(f.id, 'min')]: e.target.value })} /></td>
                  <td><input className="mn-cell" aria-label={`${f.label} maximum`} inputMode="decimal" value={val(f.id, 'max')} placeholder="--" onChange={(e) => setDraft({ ...draft, [key(f.id, 'max')]: e.target.value })} /></td>
                  <td className="hide-sm">{def ? `${def.min ?? '--'} TO ${def.max ?? '--'}` : 'NO LIMIT'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="lg-btns">
        <button type="button" className="btn on" onClick={apply}>SAVE LIMITS FOR THIS POINT</button>
        <button type="button" className="btn" onClick={reset}>BACK TO WORKING NUMBERS</button>
      </div>
      <TestEvery d={d} say={say} />
    </Fold>
  )
}

function TestEvery({ d, say }: { d: FacilityData; say: Say }) {
  const run = useRun(say)
  const [, save] = useFacilityEditor()
  const [draft, setDraft] = useState<Record<string, string>>({})
  return (
    <>
      <div className="section-title">TEST EVERY (DAYS) // 0 = NO REMINDER</div>
      <div className="mn-budget">
        {WATER_POINTS.map((p) => (
          <div key={p.id} className="mn-brow">
            <label className="ck-field"><span>{p.label}</span>
              <input inputMode="numeric" value={draft[p.id] ?? String(d.settings.waterEvery[p.id])} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} />
            </label>
            <button type="button" className="btn" onClick={() => void run(`TEST EVERY ${draft[p.id] ?? d.settings.waterEvery[p.id]} D // ${p.label}`, async () => {
              const n = Number(draft[p.id] ?? d.settings.waterEvery[p.id])
              if (!Number.isInteger(n) || n < 0 || n > 365) throw new Error('DAYS MUST BE A WHOLE NUMBER, 0 TO 365.')
              await save({ waterEvery: { ...d.settings.waterEvery, [p.id]: n } }, `WATER TEST INTERVAL // ${p.label}`)
              setDraft({ ...draft, [p.id]: String(n) })
            })}>SET</button>
          </div>
        ))}
      </div>
    </>
  )
}
