import { describe, expect, it } from 'vitest'
import {
  analyseRun,
  cToF,
  crParts,
  crToMs,
  energyFor,
  firstReach,
  fToC,
  fValue,
  headline,
  hm,
  minutesAbove,
  MIN,
  parseLoggerCsv,
  peakOverlap,
  plannedPeaks,
  readingsFromCsv,
  sheetRow,
  type CookReading,
  type CookRun,
} from './cook'

const T0 = crToMs('2026-11-02', '06:30')

const run = (over: Partial<CookRun> = {}): CookRun => ({
  id: 'r1',
  kind: 'steam_box',
  purpose: 'substrate',
  unit_label: null,
  load_desc: null,
  bag_count: 130,
  started_at: new Date(T0).toISOString(),
  ended_at: null,
  come_up_minutes: null,
  hold_min_190f: null,
  hold_min_198f: null,
  hold_min_200f: null,
  hold_min_205f: null,
  max_temp_f: null,
  f_value: null,
  hold_min_psi: null,
  heater_option: '2x4500',
  pots: null,
  cook_minutes: null,
  kwh_metered: null,
  heater_on_min: null,
  kwh: null,
  kwh_basis: null,
  cost_crc: null,
  result: 'pending',
  seq_run_ref: null,
  notes: null,
  ...over,
})

let n = 0
const rd = (zone: string, minute: number, f: number | null, psi: number | null = null): CookReading => ({
  id: `x${n++}`,
  cook_run_id: 'r1',
  taken_at: new Date(T0 + minute * MIN).toISOString(),
  zone,
  temp_f: f,
  psi,
})

/** A core that rises to `peak` over `rise` minutes, then holds there for `hold` minutes, read every 10 minutes. */
function curve(zone: string, rise: number, peak: number, hold: number, start = 70): CookReading[] {
  const out: CookReading[] = []
  for (let m = 0; m <= rise; m += 10) out.push(rd(zone, m, start + ((peak - start) * m) / rise))
  for (let m = rise + 10; m <= rise + hold; m += 10) out.push(rd(zone, m, peak))
  return out
}

describe('curves', () => {
  it('works out minutes above a threshold at the crossing, not at the readings', () => {
    const pts = [
      { t: 0, f: 100 },
      { t: 60 * MIN, f: 200 },
    ]
    expect(minutesAbove(pts, 150)).toBeCloseTo(30, 6)
    expect(minutesAbove(pts, 50)).toBeCloseTo(60, 6)
    expect(minutesAbove(pts, 250)).toBe(0)
    expect(firstReach(pts, 150)).toBe(30 * MIN)
    expect(firstReach(pts, 250)).toBeNull()
  })

  it('counts a falling curve too', () => {
    const pts = [
      { t: 0, f: 210 },
      { t: 60 * MIN, f: 190 },
    ]
    expect(minutesAbove(pts, 200)).toBeCloseTo(30, 6)
  })

  it('F value: one hour at 97 C is one hour; at 87 C is a tenth', () => {
    const at = (c: number) => [
      { t: 0, f: cToF(c) },
      { t: 3600000, f: cToF(c) },
    ]
    expect(fValue(at(97))).toBeCloseTo(1, 6)
    expect(fValue(at(87))).toBeCloseTo(0.1, 6)
    expect(fValue(at(107))).toBeCloseTo(10, 6)
  })

  it('F value of a straight ramp matches a fine sum', () => {
    const ramp = [
      { t: 0, f: cToF(80) },
      { t: 2 * 3600000, f: cToF(100) },
    ]
    let sum = 0
    const N = 2000
    for (let i = 0; i < N; i++) sum += (2 / N) * 10 ** ((80 + ((i + 0.5) / N) * 20 - 97) / 10)
    expect(fValue(ramp)).toBeCloseTo(sum, 3)
  })

  it('converts temperatures', () => {
    expect(cToF(93)).toBeCloseTo(199.4, 6)
    expect(fToC(206)).toBeCloseTo(96.67, 2)
  })
})

describe('time and format', () => {
  it('reads and writes Costa Rica time (UTC-6)', () => {
    const ms = crToMs('2026-11-05', '17:30')
    expect(new Date(ms).toISOString()).toBe('2026-11-05T23:30:00.000Z')
    expect(crParts(ms)).toEqual({ date: '2026-11-05', time: '17:30', minuteOfDay: 1050 })
    expect(Number.isNaN(crToMs('2026-13-45', '25:00'))).toBe(true)
  })
  it('formats minutes as H:MM', () => {
    expect(hm(245)).toBe('4:05')
    expect(hm(null)).toBe('--')
  })
})

describe('steam box verdicts', () => {
  it('passes a 4 h hold above 200 F on the slowest core', () => {
    // core reaches 205 F at 3 h, so it crosses 200 F a little earlier and holds more than 4 h by 7.5 h
    const rs = [...curve('CORE', 180, 205, 330), ...curve('AIR', 120, 210, 390)]
    const a = analyseRun(run(), rs, T0 + 10 * 3600000)
    expect(a.slow?.zone).toBe('CORE')
    expect(a.slow!.above[200]).toBeGreaterThan(240)
    expect(a.verdict).toBe('pass')
    expect(a.checks.find((c) => c.id === 'hold-farm')?.status).toBe('pass')
    expect(a.checks.find((c) => c.id === 'sheet-any')?.status).toBe('pass')
  })

  it('fails when the slowest core only holds 3 h, even if the box air is fine', () => {
    const rs = [...curve('CORE', 180, 205, 200), ...curve('AIR', 120, 212, 400)]
    const a = analyseRun(run({ ended_at: new Date(T0 + 380 * MIN).toISOString() }), rs)
    expect(a.slow?.zone).toBe('CORE') // AIR is not judged
    expect(a.verdict).toBe('fail')
    expect(a.verdictText).toMatch(/FAIL/)
    expect(a.checks.find((c) => c.id === 'hold-farm')?.status).toBe('fail')
  })

  it('judges the run on the slowest of several cores', () => {
    const rs = [...curve('CORE', 300, 204, 300), ...curve('TOP', 150, 206, 450)]
    const a = analyseRun(run({ ended_at: new Date(T0 + 600 * MIN).toISOString() }), rs)
    expect(a.slow?.zone).toBe('CORE')
    expect(a.zones).toHaveLength(2)
  })

  it('passes on the sheet alone when the core sits at 199 F long enough', () => {
    // never reaches 200 F, so the 4 h farm hold is not met, but it sits above 198 F for more than 4.5 h
    const rs = curve('CORE', 120, 199, 360)
    const a = analyseRun(run({ ended_at: new Date(T0 + 480 * MIN).toISOString() }), rs)
    expect(a.slow!.t200).toBeNull()
    expect(a.slow!.above[198]).toBeGreaterThan(270)
    expect(a.verdict).toBe('pass')
    expect(a.verdictText).toMatch(/SHEET ONLY/)
    expect(a.checks.find((c) => c.id === 'hold-farm')?.status).toBe('fail')
  })

  it('fails when the core never gets hot enough, once the run has ended', () => {
    const a = analyseRun(run({ ended_at: new Date(T0 + 480 * MIN).toISOString() }), curve('CORE', 120, 185, 360))
    expect(a.verdict).toBe('fail')
    expect(a.verdictText).toMatch(/BEFORE THE CORE REACHED 200/)
  })

  it('warns, but does not fail, on more than 3 h above 205 F', () => {
    const rs = curve('CORE', 120, 208, 420)
    const a = analyseRun(run({ ended_at: new Date(T0 + 540 * MIN).toISOString() }), rs)
    expect(a.slow!.above[205]).toBeGreaterThan(180)
    expect(a.checks.find((c) => c.id === 'over-205')?.status).toBe('warn')
    expect(a.verdict).toBe('pass')
  })

  it('stays pending while the run is going and the core has not reached 200 F', () => {
    const rs = curve('CORE', 200, 180, 0)
    const a = analyseRun(run(), rs, T0 + 200 * MIN)
    expect(a.verdict).toBe('pending')
    expect(a.verdictText).toMatch(/NOT AT 200/)
  })

  it('stays pending while holding, and says how far along', () => {
    const rs = curve('CORE', 150, 205, 60)
    const a = analyseRun(run(), rs, T0 + 220 * MIN)
    expect(a.verdict).toBe('pending')
    expect(a.verdictText).toMatch(/HOLDING/)
  })

  it('fills the sheet row: time to each temperature and bands on the way up', () => {
    const rs = curve('CORE', 160, 206, 300, 80)
    const a = analyseRun(run({ ended_at: new Date(T0 + 480 * MIN).toISOString() }), rs)
    const z = a.slow!
    // 80 -> 206 F over 160 min is 0.7875 F/min
    expect(z.t160).toBeCloseTo((160 - 80) / 0.7875, 0)
    expect(z.t200).toBeCloseTo((200 - 80) / 0.7875, 0)
    expect(z.b140 + z.b160 + z.b180 + z.f115 + z.f80).toBeLessThan(160)
    expect(z.f115).toBeCloseTo(25 / 0.7875, 0)
    expect(z.r140).toBeCloseTo(40 / 0.7875, 0)
    const row = sheetRow(run(), z)
    expect(row.t200).toBe(hm(z.t200))
    expect(row.date).toBe('2026-11-02')
  })

  it('does not count the cool-down in the heating-up bands', () => {
    const up = curve('CORE', 120, 206, 120, 80)
    const down = [rd('CORE', 300, 150), rd('CORE', 360, 100)]
    const z1 = analyseRun(run(), up).slow!
    const z2 = analyseRun(run(), [...up, ...down]).slow!
    expect(z2.b140).toBeCloseTo(z1.b140, 6)
    expect(z2.f115).toBeCloseTo(z1.f115, 6)
  })

  it('flags long gaps between hand readings', () => {
    const rs = [rd('CORE', 0, 80), rd('CORE', 120, 210), rd('CORE', 200, 210)]
    const a = analyseRun(run(), rs)
    expect(a.gaps.length).toBe(2)
    expect(a.checks.find((c) => c.id === 'gaps')?.status).toBe('warn')
  })

  it('writes the headline numbers back to the row', () => {
    const rs = curve('CORE', 180, 205, 330)
    const r = run({ ended_at: new Date(T0 + 510 * MIN).toISOString() })
    const a = analyseRun(r, rs)
    const h = headline(r, a, energyFor(r, a))
    expect(h.result).toBe('pass')
    expect(h.hold_min_200f).toBeGreaterThan(240)
    expect(h.max_temp_f).toBe(205)
    expect(h.come_up_minutes).toBeGreaterThan(100)
  })
})

describe('pressure runs', () => {
  const psiRun = (over: Partial<CookRun> = {}) => run({ kind: 'pressure_75x', purpose: 'grain', ...over })
  const gauge = (rise: number, psi: number, hold: number) => {
    const out: CookReading[] = []
    for (let m = 0; m <= rise; m += 10) out.push(rd('GAUGE', m, null, (psi * m) / rise))
    for (let m = rise + 10; m <= rise + hold; m += 10) out.push(rd('GAUGE', m, null, psi))
    return out
  }
  it('passes a 75X grain run with 1 h 45 min at pressure', () => {
    const a = analyseRun(psiRun({ ended_at: new Date(T0 + 200 * MIN).toISOString() }), gauge(60, 17, 120))
    expect(a.psi!.atPsi).toBeGreaterThan(105)
    expect(a.verdict).toBe('pass')
  })
  it('fails a short run once it has ended', () => {
    const a = analyseRun(psiRun({ ended_at: new Date(T0 + 150 * MIN).toISOString() }), gauge(60, 17, 60))
    expect(a.verdict).toBe('fail')
  })
  it('uses the shorter figure for agar, as a guess', () => {
    const a = analyseRun(psiRun({ purpose: 'agar', ended_at: new Date(T0 + 150 * MIN).toISOString() }), gauge(60, 15, 60))
    expect(a.checks.find((c) => c.id === 'x75-hold')?.guess).toBe(true)
    expect(a.verdict).toBe('pass')
  })
  it('takes a typed hold when there is no gauge log', () => {
    const a = analyseRun(psiRun({ cook_minutes: 110, ended_at: new Date(T0 + 200 * MIN).toISOString() }), [])
    expect(a.verdict).toBe('pass')
  })
})

describe('megachef', () => {
  it('passes 12-15 min, warns when under, fails when over', () => {
    const mk = (m: number) => analyseRun(run({ kind: 'megachef', purpose: 'grain', come_up_minutes: 11, cook_minutes: m }), [])
    expect(mk(14).verdict).toBe('pass')
    expect(mk(14).checks.find((c) => c.id === 'mega-up')?.status).toBe('pass')
    expect(mk(10).verdict).toBe('pass')
    expect(mk(10).checks.find((c) => c.id === 'mega-cook')?.status).toBe('warn')
    expect(mk(20).verdict).toBe('fail')
  })
})

describe('energy and peaks', () => {
  it('estimates the steam box at full power to come-up, then the hold power', () => {
    const rs = curve('CORE', 240, 205, 240)
    const r = run({ ended_at: new Date(T0 + 480 * MIN).toISOString() })
    const a = analyseRun(r, rs)
    const e = energyFor(r, a)
    // come-up to 200 F a little before 240 min at 9 kW, rest at 1.5 kW
    const up = a.comeUp! / 60
    expect(e.kwh).toBeCloseTo(9 * up + 1.5 * (8 - up), 1)
    expect(e.basis).toBe('ESTIMATE')
    expect(e.cost).toBeCloseTo(e.kwh! * 59.67, 4)
    expect(e.costTax).toBeCloseTo(e.cost! * 1.16, 4)
  })
  it('prefers a meter reading, then heater on-time', () => {
    const rs = curve('CORE', 240, 205, 240)
    const r = run({ ended_at: new Date(T0 + 480 * MIN).toISOString(), kwh_metered: 51.2 })
    const a = analyseRun(r, rs)
    expect(energyFor(r, a).kwh).toBe(51.2)
    expect(energyFor(r, a).basis).toBe('METERED')
    const r2 = { ...r, kwh_metered: null, heater_on_min: 300 }
    expect(energyFor(r2, a).kwh).toBeCloseTo(45, 6)
    expect(energyFor(r2, a).basis).toBe('ON-TIME')
  })
  it('uses the 6.5 kW option when that heater was chosen', () => {
    const r = run({ heater_option: '6500', ended_at: new Date(T0 + 480 * MIN).toISOString() })
    const e = energyFor(r, analyseRun(r, curve('CORE', 240, 205, 240)))
    expect(e.watts).toBe(6500)
  })
  it('finds minutes inside the 10:00-12:30 peak window', () => {
    const s = crToMs('2026-11-02', '09:00')
    const hits = peakOverlap([{ from: s, to: s + 4 * 3600000, kw: 9 }])
    expect(hits).toHaveLength(1)
    expect(hits[0].label).toBe('10:00-12:30')
    expect(hits[0].minutes).toBe(150)
    expect(hits[0].kwh).toBeCloseTo(22.5, 6)
  })
  it('finds both windows on a long run, and one that crosses midnight', () => {
    const s = crToMs('2026-11-02', '08:00')
    expect(peakOverlap([{ from: s, to: s + 13 * 3600000, kw: 9 }]).map((h) => h.label)).toEqual(['10:00-12:30', '17:30-20:00'])
    const late = crToMs('2026-11-02', '19:00')
    const h = peakOverlap([{ from: late, to: late + 8 * 3600000, kw: 1.5 }])
    expect(h).toHaveLength(1)
    expect(h[0].minutes).toBe(60)
  })
  it('finds nothing for a run entirely outside the windows', () => {
    const s = crToMs('2026-11-02', '12:30')
    expect(peakOverlap([{ from: s, to: s + 5 * 3600000, kw: 9 }])).toHaveLength(0)
  })
  it('plans a start time: a 06:30 steam run puts the come-up inside the morning peak', () => {
    const p = plannedPeaks('steam_box', '2x4500', T0)
    expect(p.minutes).toBe(660) // 7 h come-up (fab rev D) + 4 h hold
    expect(p.hits[0].label).toBe('10:00-12:30')
    expect(p.hits[0].kwh).toBeCloseTo(9 * 2.5, 6) // come-up runs to 13:30, so the whole 2.5 h window is at full 9 kW
  })
  it('a MegaChef batch of 4 draws 4.8 kW', () => {
    const r = run({ kind: 'megachef', pots: 4, come_up_minutes: 11, cook_minutes: 14, ended_at: null })
    const a = analyseRun(r, [])
    const e = energyFor(r, a)
    expect(e.watts).toBe(4800)
    expect(e.kwh).toBeCloseTo(4.8 * (25 / 60), 4)
  })
})

describe('logger CSV import', () => {
  const madgetech = [
    'MadgeTech Data Logger Report',
    'Device: RFTC2000A',
    'Serial: 12345',
    '',
    'Date and Time,Channel 1 (°F),Channel 2 (°F)',
    '02/11/2026 06:30:00,78.1,80.2',
    '02/11/2026 06:31:00,78.4,80.9',
    '02/11/2026 06:32:00,79.0,82.0',
    '',
  ].join('\n')

  it('finds the header after metadata lines and reads day-first dates', () => {
    const p = parseLoggerCsv(madgetech)
    expect(p.ok).toBe(true)
    expect(p.channels.map((c) => c.name)).toEqual(['Channel 1 (°F)', 'Channel 2 (°F)'])
    expect(p.channels.every((c) => c.unit === 'F')).toBe(true)
    expect(p.dateOrder).toBe('DMY')
    const out = readingsFromCsv(p, 'r1', 0, () => 'id' + Math.random())
    expect(out.readings).toHaveLength(6)
    expect(out.readings[0].taken_at).toBe(new Date(crToMs('2026-11-02', '06:30')).toISOString())
  })

  it('switches to month-first when a middle part is over 12', () => {
    const p = parseLoggerCsv('Time,Temp (F)\n11/25/2026 06:30:00,100\n11/25/2026 06:31:00,101')
    expect(p.dateOrder).toBe('MDY')
    expect(readingsFromCsv(p, 'r', 0, () => 'x').readings[0].taken_at).toBe(new Date(crToMs('2026-11-25', '06:30')).toISOString())
  })

  it('reads ISO dates, semicolons, decimal commas and Celsius', () => {
    const p = parseLoggerCsv('Time;Probe (°C)\n2026-11-02 06:30:00;25,5\n2026-11-02 06:31:00;26,0')
    expect(p.ok).toBe(true)
    expect(p.delimiter).toBe(';')
    expect(p.dateOrder).toBe('YMD')
    const r = readingsFromCsv(p, 'r', 0, () => 'x' + Math.random()).readings
    expect(r[0].temp_f).toBeCloseTo(cToF(25.5), 1)
  })

  it('guesses Celsius when the header has no unit and values are low', () => {
    const p = parseLoggerCsv('Time,T1\n2026-11-02 06:30,25\n2026-11-02 06:31,26')
    expect(p.channels[0].unit).toBe('C')
    const q = parseLoggerCsv('Time,T1\n2026-11-02 06:30,180\n2026-11-02 06:31,181')
    expect(q.channels[0].unit).toBe('F')
  })

  it('reads elapsed minutes from the run start', () => {
    const p = parseLoggerCsv('Elapsed (min),Core (F)\n0,80\n10,95\n20,110')
    expect(p.ok).toBe(true)
    expect(p.timeKind).toBe('elapsed-min')
    const r = readingsFromCsv(p, 'r', T0, () => 'x' + Math.random()).readings
    expect(Date.parse(r[2].taken_at)).toBe(T0 + 20 * MIN)
  })

  it('keeps one reading per probe per minute and skips junk rows', () => {
    const p = parseLoggerCsv('Time,A (F)\n2026-11-02 06:30:10,100\n2026-11-02 06:30:40,101\nnot a date,5\n2026-11-02 06:31:00,102')
    const out = readingsFromCsv(p, 'r', 0, () => 'x' + Math.random())
    expect(out.readings).toHaveLength(2)
  })

  it('handles am/pm clocks', () => {
    const p = parseLoggerCsv('Date Time,A (F)\n2026-11-02 06:30:00 PM,100\n2026-11-02 12:05:00 AM,101')
    const r = readingsFromCsv(p, 'r', 0, () => 'x' + Math.random()).readings
    expect(r[0].taken_at).toBe(new Date(crToMs('2026-11-02', '18:30')).toISOString())
    expect(r[1].taken_at).toBe(new Date(crToMs('2026-11-02', '00:05')).toISOString())
  })

  it('refuses a file with no data', () => {
    expect(parseLoggerCsv('just some text').ok).toBe(false)
    expect(parseLoggerCsv('a,b\nx,y\nz,w').ok).toBe(false)
  })

  it('maps a pressure column to psi', () => {
    const p = parseLoggerCsv('Time,Pressure (psi)\n2026-11-02 09:00,15\n2026-11-02 09:01,16')
    expect(p.channels[0].unit).toBe('PSI')
    const r = readingsFromCsv(p, 'r', 0, () => 'x' + Math.random()).readings
    expect(r[0].psi).toBe(15)
    expect(r[0].temp_f).toBeNull()
  })
})
