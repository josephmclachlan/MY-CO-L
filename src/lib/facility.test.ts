// G7 FACILITY LOGS: hand-worked numbers, mock trials through the Store, two years of history.
// Every expected value below was worked out by hand in the comment next to it. Times are the farm clock (UTC-6).
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, type Row } from './store'
import type { EditEntry } from './history'
import { CHECKLISTS } from '../data/checklists'
import {
  DEFAULT_FACILITY,
  STANDARD_MAINT,
  buildReminders,
  checkCustom,
  checkCut,
  checkDue,
  checkRun,
  checkWater,
  cleanDue,
  completeCustom,
  cutStats,
  evalWater,
  farmDay,
  farmMonth,
  farmTime,
  fmtHours,
  fmtMin,
  fromFarm,
  genHoursSince,
  icsFor,
  lastMonths,
  maintBoard,
  maintStatus,
  mergeFacility,
  monthlyOutage,
  outageReport,
  outageSummary,
  statusLines,
  toNotify,
  waterDue,
  waterPassRate,
  waterSeries,
  type ChecklistRun,
  type CleanEntry,
  type Custom,
  type CutInput,
  type MaintItem,
  type PowerCut,
  type WaterTest,
} from './facility'
import {
  addCustom,
  deleteMaint,
  deleteMaintLog,
  finishCustom,
  genStart,
  genStop,
  markMaintDone,
  powerBack,
  powerOut,
  saveClean,
  saveCut,
  saveFacility,
  saveMaint,
  saveWater,
  seedMaint,
  setMaintActive,
  signOff,
  snooze,
} from './facilityActions'

const T = (day: string, time: string) => fromFarm(day, time) as number
const iso = (ms: number) => new Date(ms).toISOString()
const cut = (id: string, down: [string, string], up: [string, string] | null, runs: [[string, string], [string, string] | null][] = [], extra: Partial<PowerCut> = {}): PowerCut => ({
  id,
  kind: 'cut',
  down_at: iso(T(...down)),
  up_at: up ? iso(T(...up)) : null,
  gen_runs: runs.length ? runs.map(([a, b]) => ({ on: iso(T(...a)), off: b ? iso(T(...b)) : null })) : null,
  gen_hours: null,
  fuel: null,
  fuel_amount: null,
  affected: null,
  losses: null,
  notes: null,
  who: null,
  ...extra,
})
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('farm time', () => {
  it('reads the farm clock from the exact moment', () => {
    // 2026-11-06 00:00 in Costa Rica is 06:00 UTC.
    expect(iso(T('2026-11-06', '00:00'))).toBe('2026-11-06T06:00:00.000Z')
    expect(farmDay(Date.parse('2026-11-06T05:59:00Z'))).toBe('2026-11-05') // still the evening before on the farm
    expect(farmTime(Date.parse('2026-11-06T05:59:00Z'))).toBe('23:59')
    expect(farmMonth(Date.parse('2026-12-01T05:00:00Z'))).toBe('2026-11')
    expect(farmMonth(Date.parse('2026-12-01T06:00:00Z'))).toBe('2026-12')
  })
  it('refuses days and times that are not real', () => {
    expect(fromFarm('2026-02-30', '10:00')).toBeNull()
    expect(fromFarm('2026-11-06', '24:00')).toBeNull()
    expect(fromFarm('2026-11-06', '10:60')).toBeNull()
    expect(fromFarm('', '10:00')).toBeNull()
    expect(fromFarm('2028-02-29', '10:00')).not.toBeNull() // leap day
  })
  it('writes durations in plain words', () => {
    expect(fmtMin(0)).toBe('0 MIN')
    expect(fmtMin(45)).toBe('45 MIN')
    expect(fmtMin(165)).toBe('2 H 45 MIN')
    expect(fmtMin(120)).toBe('2 H')
    expect(fmtMin(1500)).toBe('1 D 1 H')
    expect(fmtMin(2880)).toBe('2 D')
    expect(fmtHours(165)).toBe('2.8 H')
  })
})

describe('power cuts: hand-worked hours', () => {
  // A: 10 Oct 14:00 -> 16:45 = 165 min. Generator 14:20 -> 16:30 = 130 min, all inside the cut. Dark = 35 min.
  const A = cut('A', ['2026-10-10', '14:00'], ['2026-10-10', '16:45'], [[['2026-10-10', '14:20'], ['2026-10-10', '16:30']]], { fuel: 'propane', fuel_amount: 4.5 })
  // B: 31 Oct 22:00 -> 1 Nov 03:00 = 300 min (120 in Oct, 180 in Nov). Generator 23:00 -> 02:00 = 180 min (60 Oct, 120 Nov).
  const B = cut('B', ['2026-10-31', '22:00'], ['2026-11-01', '03:00'], [[['2026-10-31', '23:00'], ['2026-11-01', '02:00']]], { fuel: 'gasoline', fuel_amount: 12 })
  // C: a 30-minute generator test on 3 Nov. No outage.
  const C: PowerCut = { ...cut('C', ['2026-11-03', '09:00'], null, [[['2026-11-03', '09:00'], ['2026-11-03', '09:30']]]), kind: 'test' }
  // D: still out on 6 Nov: down 08:30, now 10:00 = 90 min. Generator started 08:45 and still running: 75 min. Dark 15 min.
  const D = cut('D', ['2026-11-06', '08:30'], null, [[['2026-11-06', '08:45'], null]])
  const now = T('2026-11-06', '10:00')

  it('splits a cut into grid down, on generator and fully dark', () => {
    const a = cutStats(A, now)
    expect([a.gridMin, a.onGenMin, a.darkMin]).toEqual([165, 130, 35])
    near(a.genHours, 130 / 60)
    const b = cutStats(B, now)
    expect([b.gridMin, b.onGenMin, b.darkMin]).toEqual([300, 180, 120])
    const d = cutStats(D, now)
    expect([d.open, d.gridMin, d.onGenMin, d.darkMin]).toEqual([true, 90, 75, 15])
  })
  it('a test run adds generator hours but no downtime', () => {
    const c = cutStats(C, now)
    expect([c.gridMin, c.darkMin]).toEqual([0, 0])
    near(c.genHours, 0.5)
  })
  it('a generator run left open ends when the power came back', () => {
    const e = cut('E', ['2026-11-02', '10:00'], ['2026-11-02', '11:00'], [[['2026-11-02', '10:10'], null]])
    const far = T('2026-12-25', '10:00') // weeks later: still 50 minutes, not weeks
    expect(cutStats(e, far).onGenMin).toBe(50)
    near(cutStats(e, far).genHours, 50 / 60)
  })
  it('overlapping generator runs are not counted twice', () => {
    const f = cut('F', ['2026-11-02', '10:00'], ['2026-11-02', '12:00'], [[['2026-11-02', '10:00'], ['2026-11-02', '11:00']], [['2026-11-02', '10:30'], ['2026-11-02', '11:30']]])
    expect(cutStats(f, now).onGenMin).toBe(90) // 10:00-11:30
  })
  it('meter hours replace the times for generator hours', () => {
    const g = cut('G', ['2026-11-02', '10:00'], ['2026-11-02', '12:00'], [[['2026-11-02', '10:00'], ['2026-11-02', '11:00']]], { gen_hours: 1.4 })
    expect(cutStats(g, now).genHours).toBe(1.4)
    expect(cutStats(g, now).onGenMin).toBe(60) // coverage still comes from the times
  })

  it('monthly totals: a cut over midnight at the month end is split, the cut counts where it started', () => {
    const rows = monthlyOutage([A, B, C, D], now)
    expect(rows.map((r) => r.month)).toEqual(['2026-10', '2026-11'])
    const [oct, nov] = rows
    // October: A 165 + B 120 = 285 grid; on gen 130 + 60 = 190; dark 35 + 60 = 95; cuts 2; hours 130/60 + 1.0.
    expect([oct.cuts, oct.gridMin, oct.onGenMin, oct.darkMin]).toEqual([2, 285, 190, 95])
    near(oct.genHours, 130 / 60 + 1)
    expect([oct.propaneKg, oct.gasolineL]).toEqual([4.5, 12])
    expect(oct.longestMin).toBe(300)
    // November: B 180 + D 90 = 270 grid; on gen 120 + 75 = 195; dark 60 + 15 = 75; 1 cut (D) + 1 test (C).
    expect([nov.cuts, nov.tests, nov.gridMin, nov.onGenMin, nov.darkMin]).toEqual([1, 1, 270, 195, 75])
    near(nov.genHours, 2 + 0.5 + 75 / 60) // B's Nov hours 2.0 + test 0.5 + D 1.25
    // Totals across months equal the sum of the cuts: nothing lost or doubled by the split.
    expect(sum(rows.map((r) => r.gridMin))).toBe(sum([A, B, D].map((c) => cutStats(c, now).gridMin)))
    expect(sum(rows.map((r) => r.darkMin))).toBe(sum([A, B, D].map((c) => cutStats(c, now).darkMin)))
  })
  it('grid-up share of the month', () => {
    // October has 31 days = 44,640 minutes; 285 down -> 99.361...%.
    const oct = monthlyOutage([A, B], T('2026-11-20', '12:00'))[0]
    near(oct.gridUpPct, 100 * (1 - 285 / 44640), 1e-9)
    // November so far (to 6 Nov 10:00) is 5 d 10 h = 7,800 min; with 270 down -> 96.538...%.
    const nov = monthlyOutage([B, D], now)[1]
    near(nov.gridUpPct, 100 * (1 - 270 / 7800), 1e-9)
  })
  it('lastMonths always gives 12 rows, zero where nothing happened', () => {
    const rows = lastMonths([A], now, 12)
    expect(rows.length).toBe(12)
    expect(rows[0].month).toBe('2025-12')
    expect(rows[11].month).toBe('2026-11')
    expect(rows.filter((r) => r.cuts).length).toBe(1)
    expect(rows.find((r) => r.month === '2026-03')!.gridMin).toBe(0)
  })
  it('summary: open cut, last ended cut, this month and the year', () => {
    const s = outageSummary([A, B, C, D], now)
    expect(s.open?.id).toBe('D')
    expect(s.last?.id).toBe('B') // B ended 1 Nov, after A
    expect(s.thisMonth.gridMin).toBe(270)
    expect(s.year.cuts).toBe(3)
    expect(s.year.gridMin).toBe(555) // 285 + 270
    expect(s.year.longestMin).toBe(300)
    const text = outageReport([A, B, C, D], now, 3)
    expect(text).toContain('OCT 26: 2 CUTS, 4.8 H NO GRID, 1.6 H FULLY DARK') // 285 min = 4.75 -> 4.8; 95 min = 1.58 -> 1.6
    expect(text).toContain('TOTAL NO GRID: 9.3 H') // 555 min = 9.25 -> 9.3
  })
  it('generator hours since a service day', () => {
    const cuts = [A, B, C, D]
    // Everything: 130/60 + 180/60 + 30/60 + 75/60 = 2.1667 + 3 + 0.5 + 1.25 = 6.9167
    near(genHoursSince(cuts, null, now), 130 / 60 + 3 + 0.5 + 75 / 60)
    // Service on 10 Oct: the run that day counts as before it. After: B, C, D = 3 + 0.5 + 1.25.
    near(genHoursSince(cuts, '2026-10-10', now), 3 + 0.5 + 75 / 60)
    // Service on 1 Nov: B's run ended 02:00 on 1 Nov (before the service) and is not counted; the part after is zero.
    near(genHoursSince(cuts, '2026-11-01', now), 0.5 + 75 / 60)
  })
})

describe('power cut checks', () => {
  const now = T('2026-11-06', '10:00')
  const ok: CutInput = { kind: 'cut', down: T('2026-11-05', '10:00'), up: T('2026-11-05', '11:00'), runs: [], genHours: null, fuel: null, fuelAmount: null, affected: ['lab'] }
  it('accepts a good entry and says what is wrong with bad ones', () => {
    expect(checkCut(ok, now)).toBeNull()
    expect(checkCut({ ...ok, down: null }, now)).toMatch(/WENT OUT/)
    expect(checkCut({ ...ok, up: ok.down }, now)).toMatch(/BEFORE IT WENT OUT/)
    expect(checkCut({ ...ok, up: (ok.down as number) - 1 }, now)).toMatch(/BEFORE IT WENT OUT/)
    expect(checkCut({ ...ok, down: T('2026-11-07', '10:00'), up: null }, now)).toMatch(/FUTURE/)
    expect(checkCut({ ...ok, up: T('2026-12-30', '10:00') }, now)).toMatch(/FUTURE|30 DAYS/)
    expect(checkCut({ ...ok, down: T('2026-09-01', '10:00'), up: T('2026-11-05', '10:00') }, now)).toMatch(/30 DAYS/)
    expect(checkCut({ ...ok, fuelAmount: 5 }, now)).toMatch(/PICK THE FUEL/)
    expect(checkCut({ ...ok, fuel: 'propane', fuelAmount: -1 }, now)).toMatch(/FUEL/)
    expect(checkCut({ ...ok, genHours: 800 }, now)).toMatch(/720/)
    expect(checkCut({ ...ok, affected: ['moon'] }, now)).toMatch(/UNKNOWN ROOM/)
    expect(checkCut({ ...ok, runs: [{ on: T('2026-11-05', '10:30'), off: T('2026-11-05', '10:10') }] }, now)).toMatch(/CANNOT STOP BEFORE/)
    expect(checkCut({ ...ok, runs: [{ on: Number.NaN, off: null }] }, now)).toMatch(/EACH GENERATOR RUN/)
    expect(checkCut({ ...ok, runs: [{ on: T('2026-11-04', '10:00'), off: null }] }, now)).toMatch(/12 HOURS BEFORE/)
    expect(checkCut({ kind: 'test', down: T('2026-11-05', '10:00'), up: null, runs: [], genHours: null, fuel: null, fuelAmount: null, affected: [] }, now)).toMatch(/TEST RUN NEEDS/)
  })
  it('refuses a cut that overlaps one already logged, and a second open cut', () => {
    const other = cut('X', ['2026-11-05', '10:30'], ['2026-11-05', '12:00'])
    expect(checkCut(ok, now, [other])).toMatch(/OVERLAPS/)
    const openOne = cut('Y', ['2026-11-06', '08:00'], null)
    expect(checkCut({ ...ok, down: T('2026-11-06', '09:00'), up: null }, now, [openOne])).toMatch(/OVERLAPS/)
    expect(checkCut(ok, now, [cut('Z', ['2026-11-05', '11:00'], ['2026-11-05', '12:00'])])).toBeNull() // touching is fine
  })
})

describe('water quality', () => {
  const wt = (p: Partial<WaterTest>): WaterTest => ({ id: p.id ?? 'w', tested_on: '2026-11-01', tested_time: null, point: 'ro', ph: null, tds_ppm: null, hardness_ppm: null, cl_ppm: null, temp_c: null, action: null, notes: null, who: null, ...p })
  it('flags readings outside the limits for their point', () => {
    // RO feed: TDS up to 30, hardness up to 5, pH 5.0-8.0.
    expect(evalWater(wt({ ph: 6.8, tds_ppm: 12, hardness_ppm: 2 }))).toEqual([])
    const bad = evalWater(wt({ ph: 4.2, tds_ppm: 45, hardness_ppm: 2 }))
    expect(bad.map((i) => [i.field, i.side])).toEqual([['ph', 'low'], ['tds', 'high']])
    expect(bad[1].text).toBe('TDS 45 PPM IS HIGH (WANT UP TO 30)')
    // Humidifier tank bleach dose wants 150-250.
    expect(evalWater(wt({ point: 'tank', cl_ppm: 120 }))[0].text).toBe('BLEACH DOSE 120 PPM IS LOW (WANT 150-250)')
    expect(evalWater(wt({ point: 'tank', cl_ppm: 200 }))).toEqual([])
    expect(evalWater(wt({ point: 'tank', cl_ppm: 300 }))[0].side).toBe('high')
    // The same TDS 45 is fine for raw water (limit 500).
    expect(evalWater(wt({ point: 'raw', tds_ppm: 45 }))).toEqual([])
  })
  it('Joseph\'s own limits win over the working numbers', () => {
    const s = mergeFacility({ limits: { ro: { tds: { max: 60 } } } })
    expect(evalWater(wt({ tds_ppm: 45 }), s)).toEqual([])
    expect(evalWater(wt({ tds_ppm: 65 }), s).length).toBe(1)
    // The other fields still use the defaults.
    expect(evalWater(wt({ hardness_ppm: 8 }), s).length).toBe(1)
  })
  it('checks input', () => {
    const base = { day: '2026-11-01', point: 'ro' as const, ph: 7, tds: 10, hardness: null, cl: null, temp: null }
    expect(checkWater(base, '2026-11-06')).toBeNull()
    expect(checkWater({ ...base, ph: 15 }, '2026-11-06')).toMatch(/PH/)
    expect(checkWater({ ...base, tds: -1 }, '2026-11-06')).toMatch(/TDS/)
    expect(checkWater({ ...base, ph: Number.NaN }, '2026-11-06')).toMatch(/PH/)
    expect(checkWater({ ...base, ph: null, tds: null }, '2026-11-06')).toMatch(/AT LEAST ONE/)
    expect(checkWater({ ...base, day: '2026-11-07' }, '2026-11-06')).toMatch(/FUTURE/)
    expect(checkWater({ ...base, day: 'x' }, '2026-11-06')).toMatch(/DAY/)
    expect(checkWater({ ...base, time: '25' }, '2026-11-06')).toMatch(/TIME/)
  })
  it('due dates: RO every 7 days', () => {
    const tests = [wt({ id: '1', tested_on: '2026-11-01', point: 'ro', tds_ppm: 10 })]
    const at = (today: string) => waterDue(tests, today).find((w) => w.point === 'ro')!
    expect(at('2026-11-05')).toMatchObject({ dueOn: '2026-11-08', left: 3, state: 'ok' })
    expect(at('2026-11-07').state).toBe('soon') // 1 day left; soon = ceil(7 * 0.2) = 2 days
    expect(at('2026-11-08').state).toBe('due')
    expect(at('2026-11-10')).toMatchObject({ left: -2, state: 'late' })
    expect(waterDue(tests, '2026-11-05').find((w) => w.point === 'tank')!.state).toBe('never')
    const off = mergeFacility({ waterEvery: { ro: 0 } })
    expect(waterDue(tests, '2026-11-20', off).find((w) => w.point === 'ro')!.state).toBe('off')
  })
  it('series and pass rate', () => {
    const tests = [10, 40, 12, 14].map((v, i) => wt({ id: String(i), tested_on: `2026-10-0${i + 1}`, tds_ppm: v }))
    expect(waterSeries(tests, 'ro', 'tds').map((p) => p.v)).toEqual([10, 40, 12, 14])
    expect(waterSeries(tests, 'ro', 'tds', 2).map((p) => p.v)).toEqual([12, 14])
    expect(waterSeries(tests, 'ro', 'ph')).toEqual([])
    expect(waterPassRate(tests, DEFAULT_FACILITY)).toBe(75) // 40 > 30 fails; 3 of 4 pass
    expect(waterPassRate([], DEFAULT_FACILITY)).toBeNull()
  })
})

describe('maintenance and equipment register', () => {
  const item = (p: Partial<MaintItem>): MaintItem => ({ id: 'm', name: 'JOB', category: 'air', room_id: null, make_model: null, serial: null, installed_on: null, every_days: 30, every_hours: null, last_done_on: null, started_on: '2026-10-01', notes: null, active: true, ...p })
  const now = T('2026-11-06', '10:00')
  it('calendar jobs: due day, days left, states', () => {
    const m = item({ every_days: 30, last_done_on: '2026-10-10' }) // due 9 Nov
    expect(maintStatus(m, [], '2026-11-06', now)).toMatchObject({ dueOn: '2026-11-09', daysLeft: 3, state: 'soon' }) // soon = ceil(30*0.2)=6 -> min(7,6)
    expect(maintStatus(m, [], '2026-11-01', now).state).toBe('ok')
    expect(maintStatus(m, [], '2026-11-09', now).state).toBe('due')
    expect(maintStatus(m, [], '2026-11-12', now)).toMatchObject({ state: 'late', daysLeft: -3 })
    expect(maintStatus(item({ last_done_on: null, started_on: '2026-10-01' }), [], '2026-11-06', now).dueOn).toBe('2026-10-31') // clock from the start day
    expect(maintStatus(item({ every_days: null }), [], '2026-11-06', now).state).toBe('none')
  })
  it('generator job runs on hours from the power cut log, and the worse of days and hours wins', () => {
    // Oil: every 100 hours or 365 days, last done 1 Oct. Logged generator hours after that: 2.5 + 3 + 0.5 = 6.
    const cuts = [
      cut('a', ['2026-10-10', '10:00'], ['2026-10-10', '12:30'], [[['2026-10-10', '10:00'], ['2026-10-10', '12:30']]]),
      cut('b', ['2026-10-20', '10:00'], ['2026-10-20', '13:00'], [[['2026-10-20', '10:00'], ['2026-10-20', '13:00']]]),
      { ...cut('c', ['2026-10-25', '09:00'], null, [[['2026-10-25', '09:00'], ['2026-10-25', '09:30']]]), kind: 'test' as const },
    ]
    const oil = item({ every_days: 365, every_hours: 100, last_done_on: '2026-10-01' })
    const s = maintStatus(oil, cuts, '2026-11-06', now)
    near(s.hoursSince as number, 6)
    near(s.hoursLeft as number, 94)
    expect(s.state).toBe('ok')
    const worn = item({ every_days: 365, every_hours: 5, last_done_on: '2026-10-01' }) // 6 h run against a 5 h limit
    expect(maintStatus(worn, cuts, '2026-11-06', now)).toMatchObject({ state: 'late' })
    // Done again on 21 Oct: only runs after that day count (test run on 25 Oct = 0.5 h).
    near(maintStatus({ ...oil, last_done_on: '2026-10-20' }, cuts, '2026-11-06', now).hoursSince as number, 0.5)
  })
  it('board sorts the worst first and hides removed items', () => {
    const items = [item({ id: '1', name: 'B OK', last_done_on: '2026-11-05' }), item({ id: '2', name: 'A LATE', last_done_on: '2026-09-01' }), item({ id: '3', name: 'GONE', active: false })]
    const b = maintBoard(items, [], '2026-11-06', now)
    expect(b.map((x) => x.item.name)).toEqual(['A LATE', 'B OK'])
  })
  it('the standard schedule has 17 jobs, all with a name, an interval and unique names', () => {
    expect(STANDARD_MAINT.length).toBe(17)
    expect(new Set(STANDARD_MAINT.map((s) => s.name)).size).toBe(17)
    for (const s of STANDARD_MAINT) expect(s.days || s.hours).toBeTruthy()
  })
})

describe('cleaning and checklists', () => {
  it('cleaning targets per room', () => {
    const e = (id: string, room: string, day: string): CleanEntry => ({ id, cleaned_on: day, room_id: room, tasks: ['wipe'], product: null, who: null, notes: null })
    const rows = cleanDue([e('1', 'lab', '2026-11-03'), e('2', 'lab', '2026-11-04'), e('3', 'fruiting', '2026-10-25')], '2026-11-06')
    const by = (r: string) => rows.find((x) => x.room === r)!
    expect(by('lab')).toMatchObject({ dueOn: '2026-11-06', state: 'due' }) // 4 Nov + 2 days
    expect(by('fruiting')).toMatchObject({ dueOn: '2026-11-01', left: -5, state: 'late' }) // 25 Oct + 7
    expect(by('packing').state).toBe('never')
    expect(by('lab').last?.id).toBe('2')
  })
  it('a sign-off needs every step answered, a name, and a reason for each skip', () => {
    const t = CHECKLISTS.find((c) => c.key === 'knock')!
    const all = t.steps.map((s) => ({ id: s.id, state: 'ok' as const }))
    expect(checkRun(t, all, 'JM')).toBeNull()
    expect(checkRun(t, all, '  ')).toMatch(/NAME/)
    expect(checkRun(t, all.slice(1), 'JM')).toMatch(/NOT ANSWERED/)
    expect(checkRun(t, [{ id: t.steps[0].id, state: 'skip', note: '' }, ...all.slice(1)], 'JM')).toMatch(/WHY/)
    expect(checkRun(t, [{ id: t.steps[0].id, state: 'skip', note: 'no spawn left' }, ...all.slice(1)], 'JM')).toBeNull()
  })
  it('checklists have unique step ids and the farm numbers', () => {
    for (const t of CHECKLISTS) expect(new Set(t.steps.map((s) => s.id)).size).toBe(t.steps.length)
    const cook = CHECKLISTS.find((c) => c.key === 'cook')!
    expect(cook.steps.map((s) => s.text).join(' ')).toContain('93 C')
    expect(cook.steps.map((s) => s.text).join(' ')).toContain('4 hours')
  })
  it('sign-off due dates', () => {
    const run = (day: string): ChecklistRun => ({ id: day, template: 'lab', done_on: day, finished_at: `${day}T20:00:00Z`, who: 'JM', items: [], note: null })
    const rows = checkDue([run('2026-10-20'), run('2026-10-30')], '2026-11-06')
    expect(rows.find((r) => r.template.key === 'lab')).toMatchObject({ dueOn: '2026-11-06', state: 'due' }) // 30 Oct + 7
    expect(rows.find((r) => r.template.key === 'cook')!.state).toBe('never')
    expect(rows.find((r) => r.template.key === 'power')!.state).toBe('off') // no schedule
  })
})

describe('settings', () => {
  it('survive bad or missing saved values', () => {
    expect(mergeFacility(undefined)).toEqual(DEFAULT_FACILITY)
    expect(mergeFacility('junk')).toEqual(DEFAULT_FACILITY)
    const s = mergeFacility({ waterEvery: { ro: -5, tank: 'x', raw: 14 }, cleanEvery: { lab: 500 }, leadDays: 99, routineOn: 'yes', snoozed: { a: '2026-11-09', b: 'tomorrow' }, limits: { ro: { tds: { max: 'many', min: 1 } } } })
    expect(s.waterEvery).toMatchObject({ ro: 7, tank: 7, raw: 14 })
    expect(s.cleanEvery.lab).toBe(2)
    expect(s.leadDays).toBe(2)
    expect(s.routineOn).toBe(true)
    expect(s.snoozed).toEqual({ a: '2026-11-09' })
    expect(s.limits.ro?.tds).toEqual({ min: 1 })
  })
})

describe('reminders', () => {
  const now = T('2026-11-06', '10:00') // a Friday
  const base = { today: '2026-11-06', settings: DEFAULT_FACILITY, todayItems: [], bankWarnings: [], maint: [], water: [], clean: [], checks: [], owed: [], custom: [], openCut: null, now }
  it('collects due items from every part, worst first, and the Friday routine', () => {
    const m = (id: string, name: string, last: string, days: number): MaintItem => ({ id, name, category: 'air', room_id: null, make_model: null, serial: null, installed_on: null, every_days: days, every_hours: null, last_done_on: last, started_on: '2026-01-01', notes: null, active: true })
    const board = maintBoard([m('1', 'MINI-SPLIT FILTERS WASH', '2026-09-20', 30), m('2', 'FIRE EXTINGUISHERS CHECK', '2026-10-25', 30), m('3', 'ROOF CHECK', '2026-11-05', 90)], [], '2026-11-06', now)
    const rs = buildReminders({
      ...base,
      todayItems: [{ kind: 'REORDER', text: 'REORDER FILTER PATCH BAGS // LOW', warn: false, ref: 'i1' }, { kind: 'HARVEST', text: 'HARVEST B1020 // EXPECTED 2026-11-04, 2 D PAST', warn: true, ref: 'l1' }],
      bankWarnings: [{ strain: 'BO-01', text: 'NO OFF-SITE COPY: MOVE ONE SLANT AND ONE WATER TUBE OFF SITE' }],
      maint: board,
      owed: [{ buyer: 'HOTEL SOL', crc: 27600, days: 20 }],
      custom: [{ id: 'c1', due_on: '2026-11-07', text: 'RENEW PERMIT', repeat_days: null, done_on: null }],
      openCut: cutOf('o'),
    })
    const kinds = rs.map((r) => r.kind)
    expect(kinds[0]).toBe('POWER') // the open cut is the top warning
    expect(rs.find((r) => r.kind === 'FILTER')!.text).toContain('MINI-SPLIT FILTERS WASH') // filters get their own kind
    expect(rs.find((r) => r.kind === 'FILTER')!.warn).toBe(true) // 20 Sep + 30 = 20 Oct: overdue
    expect(rs.find((r) => r.text.startsWith('FIRE EXTINGUISHERS'))).toBeUndefined() // due 24 Nov: not near
    expect(rs.find((r) => r.text.startsWith('ROOF'))).toBeUndefined()
    expect(rs.find((r) => r.kind === 'MONEY')!.text).toBe('HOTEL SOL OWES ₡27,600 // 20 D')
    expect(rs.find((r) => r.kind === 'STOCK')).toBeTruthy()
    expect(rs.find((r) => r.kind === 'STORAGE')!.text).toContain('BO-01: NO OFF-SITE COPY')
    expect(rs.find((r) => r.kind === 'ROUTINE')!.text).toContain('FRIDAY')
    expect(rs.find((r) => r.kind === 'CUSTOM')!.text).toBe('RENEW PERMIT // 2026-11-07') // 1 day ahead is inside the 2-day lead
    // Warnings come before everything that is not a warning.
    const firstOk = rs.findIndex((r) => !r.warn)
    expect(rs.slice(firstOk).every((r) => !r.warn)).toBe(true)
  })
  function cutOf(id: string): PowerCut {
    return cut(id, ['2026-11-06', '08:30'], null)
  }
  it('snoozing hides a reminder until the end of the snooze day only', () => {
    const w = [{ point: 'ro' as const, last: null, every: 7, dueOn: null, left: null, state: 'never' as const, issues: [] }]
    const s = { ...DEFAULT_FACILITY, snoozed: { 'water:ro': '2026-11-06' } }
    expect(buildReminders({ ...base, water: w, settings: s }).some((r) => r.key === 'water:ro')).toBe(false)
    expect(buildReminders({ ...base, today: '2026-11-07', water: w, settings: s }).some((r) => r.key === 'water:ro')).toBe(true)
  })
  it('lead days: a job 3 days out shows only when the lead is 3 or more', () => {
    const items = maintBoard([{ id: '1', name: 'COIL CLEAN', category: 'cold', room_id: null, make_model: null, serial: null, installed_on: null, every_days: 30, every_hours: null, last_done_on: '2026-10-10', started_on: '2026-01-01', notes: null, active: true, serial2: 0 } as unknown as MaintItem], [], '2026-11-06', now) // due 9 Nov
    expect(buildReminders({ ...base, maint: items, settings: { ...DEFAULT_FACILITY, leadDays: 2 } }).some((r) => r.kind === 'MAINT')).toBe(false)
    expect(buildReminders({ ...base, maint: items, settings: { ...DEFAULT_FACILITY, leadDays: 3 } }).some((r) => r.kind === 'MAINT')).toBe(true)
  })
  it('water: out-of-limit readings and overdue tests; untested RO and tank nag, untested raw does not', () => {
    const tests: WaterTest[] = [{ id: 'w1', tested_on: '2026-10-20', tested_time: null, point: 'ro', ph: 7, tds_ppm: 80, hardness_ppm: null, cl_ppm: null, temp_c: null, action: null, notes: null, who: null }]
    const rs = buildReminders({ ...base, water: waterDue(tests, '2026-11-06') })
    expect(rs.some((r) => r.kind === 'WATER' && r.warn && r.text.includes('TDS 80 PPM IS HIGH'))).toBe(true)
    expect(rs.some((r) => r.text.startsWith('WATER TEST OVERDUE 10 D: AFTER RO'))).toBe(true) // 20 Oct + 7 = 27 Oct; 10 days late
    expect(rs.some((r) => r.text.includes('NO WATER TEST LOGGED FOR HUMIDIFIER TANK'))).toBe(true)
    expect(rs.some((r) => r.text.includes('RAW SOURCE'))).toBe(false)
  })
  it('custom reminders: repeat moves on, one-off closes', () => {
    const one: Custom = { id: 'a', due_on: '2026-11-06', text: 'X', repeat_days: null, done_on: null }
    expect(completeCustom(one, '2026-11-06')).toEqual({ done_on: '2026-11-06' })
    const rep: Custom = { id: 'b', due_on: '2026-10-01', text: 'Y', repeat_days: 30, done_on: null }
    expect(completeCustom(rep, '2026-11-06')).toEqual({ due_on: '2026-11-30', done_on: null }) // 1 Oct, 31 Oct, 30 Nov: first one after today
    expect(checkCustom('2026-11-06', '  ', null)).toMatch(/TYPE WHAT/)
    expect(checkCustom('2026-11-06', 'ok', 0)).toMatch(/REPEAT/)
    expect(checkCustom('bad', 'ok', null)).toMatch(/DAY/)
  })
  it('phone alerts: warnings and what is due today, once a day, never the routine', () => {
    const rs = buildReminders({ ...base, owed: [{ buyer: 'A', crc: 1000, days: 3 }, { buyer: 'B', crc: 2000, days: 30 }] })
    const first = toNotify(rs, { day: '', keys: [] }, '2026-11-06')
    expect(first.map((r) => r.key).sort()).toEqual(['owed:A', 'owed:B']) // due === null counts as now; routine excluded
    expect(toNotify(rs, { day: '2026-11-06', keys: ['owed:A'] }, '2026-11-06').map((r) => r.key)).toEqual(['owed:B'])
    expect(toNotify(rs, { day: '2026-11-05', keys: ['owed:A', 'owed:B'] }, '2026-11-06').length).toBe(2) // a new day starts over
  })
  it('calendar file: valid events with an alert, text escaped', () => {
    const rs = buildReminders({ ...base, custom: [{ id: 'c1', due_on: '2026-11-07', text: 'CALL ICE; ASK, PLEASE', repeat_days: null, done_on: null }] })
    const ics = icsFor(rs, '2026-11-06', Date.UTC(2026, 10, 6, 16, 0))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261107')
    expect(ics).toContain('DTEND;VALUE=DATE:20261108')
    expect(ics).toContain('SUMMARY:CALL ICE\\; ASK\\, PLEASE // 2026-11-07')
    expect(ics).toContain('TRIGGER:PT8H')
    expect(ics).toContain('DTSTAMP:20261106T160000Z')
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(rs.length)
    expect((ics.match(/END:VEVENT/g) ?? []).length).toBe(rs.length)
  })
  it('status board lines', () => {
    const cuts = [cut('D', ['2026-11-06', '08:30'], null)]
    const lines = statusLines({ now, today: '2026-11-06', cuts, reminders: [], water: [], maint: [], owedCrc: 0 })
    expect(lines[0]).toMatchObject({ label: 'POWER', value: 'OUT FOR 1 H 30 MIN', warn: true })
    expect(lines.find((l) => l.label === 'WATER')!.value).toBe('NO TEST LOGGED')
    expect(lines.find((l) => l.label === 'OWED')).toBeUndefined()
    expect(statusLines({ now, today: '2026-11-06', cuts: [], reminders: [], water: [], maint: [], owedCrc: 5000 }).find((l) => l.label === 'OWED')!.value).toBe('₡5,000')
  })
})

// ---------- mock trial: a month of facility logging, end to end through the Store ----------

const log = (st: Store) => st.rows<EditEntry & Row>(EDIT_LOG)

describe('mock trial: November on the farm', () => {
  it('a power cut timed live, a generator test, water tests, upkeep, cleaning, a checklist, reminders, undo and history', async () => {
    const st = new Store(new MemoryBackend())
    await st.ensure(EDIT_LOG)
    const act = <T,>(label: string, fn: () => Promise<T>) => st.action(label, fn)

    // 1. The power fails at 14:03 on 6 Nov. The button is pressed at 14:03:40. Nothing else running yet.
    const t0 = T('2026-11-06', '14:03') + 40000
    await act('POWER CUT STARTED', () => powerOut(st, t0, 'JM'))
    let cuts = st.rows<PowerCut>('power_cuts')
    expect(cuts.length).toBe(1)
    expect(farmTime(Date.parse(cuts[0].down_at))).toBe('14:03') // whole minute
    await expect(powerOut(st, t0 + 1000, 'JM')).rejects.toThrow(/ALREADY OPEN/)
    // 2. Generator started 14:21, stopped 16:36. 3. Power back 16:48.
    await act('GENERATOR STARTED', () => genStart(st, T('2026-11-06', '14:21'), 'JM'))
    await expect(genStart(st, T('2026-11-06', '14:22'), 'JM')).rejects.toThrow(/ALREADY/)
    await act('GENERATOR STOPPED', () => genStop(st, T('2026-11-06', '16:36')))
    await expect(genStop(st, T('2026-11-06', '16:37'))).rejects.toThrow(/NO GENERATOR RUN IS OPEN/)
    await act('POWER BACK', () => powerBack(st, T('2026-11-06', '16:48')))
    await expect(powerBack(st, T('2026-11-06', '16:49'))).rejects.toThrow(/NO CUT IS OPEN/)
    cuts = st.rows<PowerCut>('power_cuts')
    const now = T('2026-11-06', '18:00')
    // 14:03 -> 16:48 = 165 min. Generator 14:21 -> 16:36 = 135 min. Dark = 30 min.
    expect(cutStats(cuts[0], now)).toMatchObject({ open: false, gridMin: 165, onGenMin: 135, darkMin: 30 })
    near(cutStats(cuts[0], now).genHours, 2.25)
    // 4. Add the details afterwards: fuel and what was affected, as an edit.
    await act('CUT DETAILS', () => saveCut(st, cuts[0].id, { kind: 'cut', down: T('2026-11-06', '14:03'), up: T('2026-11-06', '16:48'), runs: [{ on: T('2026-11-06', '14:21'), off: T('2026-11-06', '16:36') }], genHours: null, fuel: 'propane', fuelAmount: 3.2, affected: ['lab', 'fruiting'], losses: 'FRIDGE REACHED 6 C', notes: 'STORM' }, now))
    expect(st.rows<PowerCut>('power_cuts')[0]).toMatchObject({ fuel: 'propane', fuel_amount: 3.2, affected: ['lab', 'fruiting'] })
    // 5. A generator test with no cut on 20 Nov, timed with the buttons.
    await act('TEST START', () => genStart(st, T('2026-11-20', '09:00'), 'JM'))
    expect(st.rows<PowerCut>('power_cuts').find((c) => c.kind === 'test')!.gen_runs![0].off).toBeNull()
    await act('TEST STOP', () => genStop(st, T('2026-11-20', '09:25')))
    // 6. A forgotten cut typed in afterwards. An overlapping one is refused.
    await act('PAST CUT', () => saveCut(st, null, { kind: 'cut', down: T('2026-11-12', '03:10'), up: T('2026-11-12', '05:40'), runs: [], genHours: null, fuel: null, fuelAmount: null, affected: ['lab'] }, T('2026-11-21', '08:00')))
    await expect(saveCut(st, null, { kind: 'cut', down: T('2026-11-12', '05:00'), up: T('2026-11-12', '06:00'), runs: [], genHours: null, fuel: null, fuelAmount: null, affected: [] }, T('2026-11-21', '08:00'))).rejects.toThrow(/OVERLAPS/)
    const end = T('2026-11-30', '20:00')
    const nov = monthlyOutage(st.rows<PowerCut>('power_cuts'), end)[0]
    // Cuts: 165 + 150 (03:10 -> 05:40) = 315 min grid; on gen 135; dark 180. Gen hours 2.25 + 25/60.
    expect([nov.cuts, nov.tests, nov.gridMin, nov.onGenMin, nov.darkMin]).toEqual([2, 1, 315, 135, 180])
    near(nov.genHours, 2.25 + 25 / 60)
    expect(nov.propaneKg).toBe(3.2)

    // 7. Water: weekly RO tests, one bad.
    for (const [day, tds] of [['2026-11-02', 12], ['2026-11-09', 14], ['2026-11-16', 41], ['2026-11-23', 13]] as const)
      await act('WATER', () => saveWater(st, null, { day, point: 'ro', ph: 6.5, tds, hardness: 2, cl: null, temp: 26, who: 'JM' }, day))
    await act('TANK', () => saveWater(st, null, { day: '2026-11-23', point: 'tank', ph: null, tds: null, hardness: null, cl: 130, temp: null, action: 'RE-DOSED BLEACH' }, '2026-11-23'))
    const water = st.rows<WaterTest>('water_tests')
    expect(water.length).toBe(5)
    const wd = waterDue(water, '2026-11-26')
    expect(wd.find((w) => w.point === 'ro')).toMatchObject({ dueOn: '2026-11-30', left: 4, state: 'ok' })
    expect(wd.find((w) => w.point === 'tank')!.issues[0].text).toBe('BLEACH DOSE 130 PPM IS LOW (WANT 150-250)')
    expect(waterSeries(water, 'ro', 'tds').map((p) => p.v)).toEqual([12, 14, 41, 13])
    await expect(saveWater(st, null, { day: '2026-11-26', point: 'ro', ph: 99, tds: null, hardness: null, cl: null, temp: null }, '2026-11-26')).rejects.toThrow(/PH/)
    expect(st.rows('water_tests').length).toBe(5) // a refused entry saves nothing

    // 8. Upkeep: add the schedule, do the generator oil with 5.75 h of logged running before it.
    const added = await act('SEED', () => seedMaint(st, '2026-11-01'))
    expect(added).toBe(17)
    expect(await act('SEED AGAIN', () => seedMaint(st, '2026-11-01'))).toBe(0)
    const oil = st.rows<MaintItem>('maint_items').find((m) => m.name === 'GENERATOR OIL CHANGE')!
    near(maintStatus(oil, st.rows<PowerCut>('power_cuts'), '2026-11-30', end).hoursSince as number, 2.25 + 25 / 60)
    await act('OIL DONE', () => markMaintDone(st, oil.id, '2026-11-25', 'JM', 'FIRST CHANGE', '2026-11-30'))
    const after = st.rows<MaintItem>('maint_items').find((m) => m.id === oil.id)!
    expect(after.last_done_on).toBe('2026-11-25')
    expect(maintStatus(after, st.rows<PowerCut>('power_cuts'), '2026-11-30', end).hoursSince).toBe(0)
    await expect(markMaintDone(st, oil.id, '2026-12-05', 'JM', null, '2026-11-30')).rejects.toThrow(/FUTURE/)
    // An earlier day does not move the clock back; deleting the log line puts the day back.
    await act('OLD DONE', () => markMaintDone(st, oil.id, '2026-11-10', null, null, '2026-11-30'))
    expect(st.rows<MaintItem>('maint_items').find((m) => m.id === oil.id)!.last_done_on).toBe('2026-11-25')
    const newest = st.rows<{ id: string; done_on: string }>('maint_log').find((l) => l.done_on === '2026-11-25')!
    await act('DEL DONE', () => deleteMaintLog(st, newest.id))
    expect(st.rows<MaintItem>('maint_items').find((m) => m.id === oil.id)!.last_done_on).toBe('2026-11-10')
    await act('REMOVE', () => setMaintActive(st, oil.id, false))
    expect(maintBoard(st.rows<MaintItem>('maint_items'), [], '2026-11-30', end).length).toBe(16)
    await act('NEW ITEM', () => saveMaint(st, null, { name: 'walk-in door seal', category: 'cold', room: 'packing', make: 'FOGEL', serial: 'F-123', installed: '2026-10-01', everyDays: 90, everyHours: null, startedOn: '2026-11-01', notes: null }))
    await expect(saveMaint(st, null, { name: 'WALK-IN DOOR SEAL', category: 'cold', room: null, make: null, serial: null, installed: null, everyDays: 90, everyHours: null, startedOn: '2026-11-01' })).rejects.toThrow(/ALREADY ON THE LIST/)
    await expect(saveMaint(st, null, { name: 'X', category: 'cold', room: null, make: null, serial: null, installed: null, everyDays: 0, everyHours: null, startedOn: '2026-11-01' })).rejects.toThrow(/WHOLE NUMBER/)
    await act('DEL ITEM', () => deleteMaint(st, oil.id))
    expect(st.rows('maint_log').filter((l) => (l as { item_id?: string }).item_id === oil.id).length).toBe(0)

    // 9. Cleaning and a checklist sign-off.
    await act('CLEAN', () => saveClean(st, null, { day: '2026-11-24', room: 'lab', tasks: ['wipe', 'mop', 'sanitise'], product: 'ALCOHOL 70%', who: 'JM' }, '2026-11-26'))
    await expect(saveClean(st, null, { day: '2026-11-24', room: 'lab', tasks: [] }, '2026-11-26')).rejects.toThrow(/AT LEAST ONE/)
    const lab = CHECKLISTS.find((c) => c.key === 'lab')!
    const items = lab.steps.map((s, i) => (i === 7 ? { id: s.id, state: 'skip' as const, note: 'FILTERS NOT DUE' } : { id: s.id, state: 'ok' as const }))
    await expect(signOff(st, lab, items.slice(0, 5), 'JM', null, end)).rejects.toThrow(/NOT ANSWERED/)
    const run = await act('SIGN OFF', () => signOff(st, lab, items, 'JM', 'CLEAN', T('2026-11-24', '17:00')))
    expect(run).toMatchObject({ template: 'lab', done_on: '2026-11-24', who: 'JM' })
    expect(run.items.filter((i) => i.state === 'skip').length).toBe(1)

    // 10. Reminders you type, snoozes and settings.
    const rem = await act('REMIND', () => addCustom(st, '2026-12-01', 'RENEW PERMIT', 30))
    await act('DONE', () => finishCustom(st, rem.id, completeCustom(rem, '2026-12-01')))
    expect(st.rows<Custom>('reminders')[0].due_on).toBe('2026-12-31')
    await act('SNOOZE', () => snooze(st, DEFAULT_FACILITY, 'clean:lab', '2026-12-03', '2026-12-01'))
    await act('SET', () => saveFacility(st, DEFAULT_FACILITY, { leadDays: 5 }))
    expect(st.rows<{ id: string; value: { leadDays: number; snoozed: Record<string, string> } }>('app_settings').find((r) => r.id === 'facility')!.value).toMatchObject({ leadDays: 5 })

    // 11. Every action is in the edit history with a real label; UNDO puts the exact earlier state back.
    const labels = log(st).map((e) => e.label)
    for (const want of ['POWER CUT STARTED', 'GENERATOR STARTED', 'GENERATOR STOPPED', 'POWER BACK', 'CUT DETAILS', 'WATER', 'SEED', 'OIL DONE', 'CLEAN', 'SIGN OFF', 'REMIND']) expect(labels).toContain(want)
    const byId = (rows: Row[]) => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'updated_at'))))
    const cutsBefore = byId(st.rows('power_cuts'))
    await act('DEL CUT', async () => { await st.del('power_cuts', st.rows<PowerCut>('power_cuts').find((c) => c.kind === 'test')!.id) })
    expect(st.rows('power_cuts').length).toBe(2)
    expect(await st.undo()).toBe('DEL CUT')
    expect(byId(st.rows('power_cuts'))).toBe(cutsBefore)

    // 12. Backup and restore on a new device: every number comes out the same.
    const json = await st.exportJson()
    const st2 = new Store(new MemoryBackend())
    await st2.importJson(json)
    expect(monthlyOutage(st2.rows<PowerCut>('power_cuts'), end)).toEqual(monthlyOutage(st.rows<PowerCut>('power_cuts'), end))
    const wsum = (rows: WaterTest[]) => waterDue(rows, '2026-11-26').map((w) => [w.point, w.last?.tds_ppm ?? null, w.dueOn, w.left, w.state, w.issues.map((i) => i.text)])
    expect(wsum(st2.rows<WaterTest>('water_tests'))).toEqual(wsum(st.rows<WaterTest>('water_tests')))
    expect(maintBoard(st2.rows<MaintItem>('maint_items'), st2.rows<PowerCut>('power_cuts'), '2026-11-30', end).map((b) => [b.item.name, b.state])).toEqual(maintBoard(st.rows<MaintItem>('maint_items'), st.rows<PowerCut>('power_cuts'), '2026-11-30', end).map((b) => [b.item.name, b.state]))
    expect(st2.rows('checklist_runs').length).toBe(1)
    expect(st2.rows('clean_log').length).toBe(1)
  })
})

// ---------- two years of history ----------

describe('historical resilience: two years of back data', () => {
  // Nov 2024 to Oct 2026: a cut about every 3 weeks (some across month ends, some on a leap-free calendar edge),
  // generator test runs monthly, weekly RO tests that slowly drift, quarterly upkeep, weekly cleaning.
  const cuts: PowerCut[] = []
  let expectGrid = 0
  let expectDark = 0
  const monthExpect = new Map<string, number>()
  for (let i = 0; i < 34; i++) {
    const startMs = T('2024-11-01', '03:00') + i * 21 * 86400000 + (i % 5) * 3600000
    const dur = 20 + ((i * 37) % 400) // minutes
    const genMin = i % 2 ? Math.floor(dur * 0.6) : 0
    const day = farmDay(startMs)
    const down = iso(startMs)
    const up = iso(startMs + dur * 60000)
    const g = genMin ? [{ on: iso(startMs + 10 * 60000), off: iso(startMs + (10 + genMin) * 60000) }] : null
    const c: PowerCut = { id: `c${i}`, kind: 'cut', down_at: down, up_at: up, gen_runs: genMin && 10 + genMin <= dur ? g : null, gen_hours: null, fuel: null, fuel_amount: null, affected: null, losses: null, notes: null, who: null }
    cuts.push(c)
    expectGrid += dur
    // Count by hand: farm minutes in each month by stepping minute by minute is too slow; walk the cut by hour edges.
    for (let m = 0; m < dur; m++) {
      const k = farmMonth(startMs + m * 60000)
      monthExpect.set(k, (monthExpect.get(k) ?? 0) + 1)
    }
    void day
    if (c.gen_runs) expectDark += dur - genMin
    else expectDark += dur
  }
  const now = T('2026-11-01', '08:00')
  it('monthly totals equal a minute-by-minute count, and the sum of months equals the sum of cuts', () => {
    const rows = monthlyOutage(cuts, now)
    for (const r of rows) expect(r.gridMin).toBe(monthExpect.get(r.month) ?? 0)
    expect(sum(rows.map((r) => r.gridMin))).toBe(expectGrid)
    expect(sum(rows.map((r) => r.darkMin))).toBe(expectDark)
  })
  it('old months do not change when new cuts, tests and settings arrive later', () => {
    const before = JSON.stringify(monthlyOutage(cuts, now).filter((r) => r.month < '2026-10'))
    const later = [...cuts, cut('new', ['2026-10-30', '23:00'], ['2026-11-01', '01:00'], [[['2026-10-31', '10:00'], ['2026-10-31', '11:00']]])]
    const mid = monthlyOutage(later, T('2026-11-20', '12:00'))
    expect(JSON.stringify(mid.filter((r) => r.month < '2026-10'))).toBe(before)
    // The new cut splits over 31 Oct / 1 Nov exactly: 30 Oct 23:00 -> 31 Oct 00:00 = 60 (Oct), all of 31 Oct = 1440 (Oct), 1 Nov 00:00 -> 01:00 = 60 (Nov).
    const oct = mid.find((r) => r.month === '2026-10')!
    const base = monthlyOutage(cuts, T('2026-11-20', '12:00')).find((r) => r.month === '2026-10')
    expect(oct.gridMin - (base?.gridMin ?? 0)).toBe(60 + 1440)
  })
  it('12-month window slides and the last 12 months equal their own sum', () => {
    const s = outageSummary(cuts, now)
    const rows = lastMonths(cuts, now, 12)
    expect(s.year.gridMin).toBe(sum(rows.map((r) => r.gridMin)))
    expect(rows[0].month).toBe('2025-12')
    expect(rows[11].month).toBe('2026-11')
  })
  it('thousands of cuts: still exact and fast', () => {
    const big: PowerCut[] = []
    let total = 0
    for (let i = 0; i < 20000; i++) {
      const s = T('2020-01-01', '00:00') + i * 3 * 3600000
      const d = 5 + (i % 90)
      big.push(cut(`b${i}`, ['2020-01-01', '00:00'], null, [], { down_at: iso(s), up_at: iso(s + d * 60000) }))
      total += d
    }
    const t0 = Date.now()
    const rows = monthlyOutage(big, T('2026-12-31', '00:00'))
    expect(Date.now() - t0).toBeLessThan(4000)
    expect(sum(rows.map((r) => r.gridMin))).toBe(total)
  })
})
