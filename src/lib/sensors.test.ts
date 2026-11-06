// G8 CLIMATE SENSORS: hand-worked numbers, mock trials through the Store, two years of history.
// Every expected value below was worked out by hand in the comment next to it. Times are the farm clock (UTC-6).
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store, BACKUP_TABLES } from './store'
import type { EditEntry } from './history'
import { fromFarm, isoOf } from './facility'
import {
  DEFAULT_SENSOR_SETTINGS,
  alarmMessage,
  alarms,
  bandFor,
  buckets,
  cToF,
  checkAc,
  checkReading,
  checkSensor,
  climateLine,
  dailyStats,
  excursions,
  fToC,
  indexReadings,
  lastBySensor,
  measureNow,
  mergeSensorSettings,
  mockSeries,
  parseSensorCsv,
  parseStamp,
  placeNow,
  planImport,
  readingsCsv,
  timeInBand,
  type AcCheck,
  type Reading,
  type Sensor,
  type SensorSettings,
} from './sensors'
import { FEEDS, decodeGoveeBle, goveeDevicesRequest, goveeStateRequest, parseGoveeDevices, parseGoveeState, pollGovee, telegramRequest, type HttpRequest } from './sensorFeeds'
import { ackAlarms, addMock, addReading, deleteBatch, deleteSensor, importReadings, removeMock, saveAc, saveSensor, saveSensorSettings, setSensorActive } from './sensorActions'

const MIN = 60000
const at = (day: string, time: string) => fromFarm(day, time) as number
let n = 0
const rd = (place: Reading['place'], ms: number, v: Partial<Reading> = {}): Reading => ({
  id: `r${String(++n).padStart(6, '0')}`,
  sensor_id: null,
  place,
  taken_at: isoOf(ms),
  temp_c: null,
  rh: null,
  co2_ppm: null,
  source: 'govee',
  batch: null,
  who: null,
  note: null,
  created_at: isoOf(ms),
  ...v,
})
const sensor = (id: string, v: Partial<Sensor> = {}): Sensor => ({
  id, name: id.toUpperCase(), place: 'fruiting', vendor: 'govee', model: 'H5179', device_id: `AA:${id}`, measures: ['temp', 'rh'], auto: true, active: true, mock: false, notes: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...v,
})
const S = DEFAULT_SENSOR_SETTINGS

describe('units and dates', () => {
  it('turns Fahrenheit into Celsius', () => {
    expect(fToC(79.52)).toBe(26.4) // (79.52 - 32) x 5/9 = 47.52 x 0.5556 = 26.40
    expect(fToC(60.8)).toBe(16) // 28.8 x 5/9 = 16.0
    expect(fToC(32)).toBe(0)
    expect(cToF(16)).toBe(60.8)
  })
  it('reads the date shapes the Govee app and spreadsheets write, on the farm clock', () => {
    // 08:30 farm = 14:30 UTC (farm is UTC-6)
    expect(isoOf(parseStamp('2026-11-06 08:30:00', null)!.ms)).toBe('2026-11-06T14:30:00.000Z')
    expect(isoOf(parseStamp('2026/11/06 08:30', null)!.ms)).toBe('2026-11-06T14:30:00.000Z')
    // 8:30 PM farm on 6 Nov = 20:30 farm = 02:30 UTC on 7 Nov
    expect(isoOf(parseStamp('11/06/2026 8:30 PM', null)!.ms)).toBe('2026-11-07T02:30:00.000Z')
    expect(parseStamp('11/06/2026 8:30 PM', null)!.how).toBe('MONTH FIRST')
    // 25 can only be a day: 25 Oct 07:05 farm = 13:05 UTC
    expect(isoOf(parseStamp('25/10/2026 07:05', null)!.ms)).toBe('2026-10-25T13:05:00.000Z')
    expect(isoOf(parseStamp('05/11/2026 07:05', true)!.ms)).toBe('2026-11-05T13:05:00.000Z')
    expect(parseStamp('31/02/2026 07:05', true)).toBeNull() // no 31 Feb
    expect(parseStamp('2026-11-06 25:00', null)).toBeNull()
    expect(parseStamp('1762439400', null)!.ms).toBe(1762439400000) // seconds since 1970
    expect(parseStamp('hello', null)).toBeNull()
  })
})

describe('CSV import (Govee app export)', () => {
  it('reads a Fahrenheit Govee file and turns it into Celsius', () => {
    const csv = '﻿Timestamp for sample frequency every 1 min min,Temperature_Fahrenheit,Relative_Humidity\r\n2026-11-05 10:00:00,60.8,85.0\r\n2026-11-05 10:01:00,61.7,86.5\r\n\r\n'
    const p = parseSensorCsv(csv)
    expect(p.errors).toEqual([])
    expect(p.unit).toBe('F')
    expect(p.found).toEqual(['TEMPERATURE', 'HUMIDITY'])
    expect(p.rows).toHaveLength(2)
    expect(p.rows[0]).toEqual({ ms: at('2026-11-05', '10:00'), temp_c: 16, rh: 85, co2_ppm: null })
    expect(p.rows[1].temp_c).toBe(16.5) // (61.7 - 32) x 5/9 = 16.5
  })
  it('reads a Spanish phone export: semicolons, comma decimals, day first', () => {
    const csv = 'Fecha y hora;Temperatura(°C);Humedad(%)\n05/11/2026 10:00;16,2;85,5\n05/11/2026 10:10;16,4;86\n'
    const p = parseSensorCsv(csv)
    expect(p.unit).toBe('C')
    expect(p.dates).toBe('DAY FIRST') // Spanish headings: day first
    expect(p.rows[0]).toEqual({ ms: at('2026-11-05', '10:00'), temp_c: 16.2, rh: 85.5, co2_ppm: null })
    expect(p.rows[1].ms - p.rows[0].ms).toBe(10 * MIN)
  })
  it('settles day order from any date over 12, and reads a CO2 column', () => {
    const csv = 'Time,Temperature(C),Humidity(%),CO2(ppm)\n03/04/2026 09:00,18,70,2400\n13/04/2026 09:00,18.2,71,2500\n'
    const p = parseSensorCsv(csv)
    expect(p.dates).toBe('DAY FIRST')
    expect(isoOf(p.rows[0].ms)).toBe(isoOf(at('2026-04-03', '09:00'))) // 3 April, not 4 March
    expect(p.rows[1].co2_ppm).toBe(2500)
  })
  it('guesses Fahrenheit from the values when the heading does not say', () => {
    const p = parseSensorCsv('time,temperature,humidity\n2026-11-05 10:00,61,85\n2026-11-05 10:05,62,85\n')
    expect(p.unit).toBe('F')
    expect(p.rows[0].temp_c).toBe(16.11) // (61 - 32) x 5/9 = 16.11
  })
  it('lists bad lines and keeps the good ones', () => {
    const p = parseSensorCsv('time,temperature,humidity\nnot a date,16,85\n2026-11-05 10:00,abc,85\n2026-11-05 10:05,16,140\n2026-11-05 10:10,16,85\n')
    expect(p.rows).toHaveLength(1)
    expect(p.errors.map((e) => e.line)).toEqual([2, 3, 4])
  })
  it('refuses files with no time or no values', () => {
    expect(parseSensorCsv('').errors[0].text).toMatch(/EMPTY/)
    expect(parseSensorCsv('a,b\n1,2').errors[0].text).toMatch(/NO TIME COLUMN/)
    expect(parseSensorCsv('time,battery\n2026-11-05 10:00,90').errors[0].text).toMatch(/NO TEMPERATURE/)
  })
  it('skips readings already saved for the same sensor and minute, and repeats inside the file', () => {
    const idx = indexReadings([rd('fridge', at('2026-11-05', '10:00') + 20000, { sensor_id: 'g1', temp_c: 2 }), rd('fridge', at('2026-11-05', '10:01'), { sensor_id: 'other', temp_c: 2 })])
    const rows = [0, 1, 1, 2].map((m) => ({ ms: at('2026-11-05', '10:00') + m * MIN, temp_c: 2, rh: null, co2_ppm: null }))
    const p = planImport(rows, { sensor_id: 'g1', place: 'fridge' }, idx)
    // 10:00 is saved (same minute, 20 s in); 10:01 is new (the saved 10:01 is another sensor); the second 10:01 repeats; 10:02 new
    expect(p.add.map((r) => r.ms)).toEqual([at('2026-11-05', '10:01'), at('2026-11-05', '10:02')])
    expect(p.dup).toBe(2)
  })
})

describe('bands and checks', () => {
  it('uses the farm\'s written limits, then Joseph\'s changes', () => {
    expect(bandFor(S, 'fridge', 'temp')).toEqual({ lo: 1, hi: 4 })
    // Joseph 6 Nov 2026: every growing room 13-20 C, fruiting CO2 ceiling 1,000, 10 minute delay everywhere.
    for (const p of ['lab', 'packing', 'incubation', 'fruiting'] as const) expect(bandFor(S, p, 'temp')).toEqual({ lo: 13, hi: 20 })
    expect(bandFor(S, 'fruiting', 'co2')).toEqual({ lo: null, hi: 1000 })
    expect(bandFor(S, 'incubation', 'co2')).toEqual({ lo: null, hi: 4000 })
    expect(bandFor(S, 'packing', 'co2')).toEqual({ lo: null, hi: 600 })
    for (const d of Object.values(S.delayMin)) expect(d).toBe(10)
    expect(bandFor(S, 'fruiting', 'rh')).toEqual({ lo: 80, hi: 96 })
    expect(bandFor(S, 'outside', 'temp')).toBeNull()
    const s2 = mergeSensorSettings({ bands: { fruiting: { temp: { lo: 12, hi: 18 }, rh: null } } })
    expect(bandFor(s2, 'fruiting', 'temp')).toEqual({ lo: 12, hi: 18 })
    expect(bandFor(s2, 'fruiting', 'rh')).toBeNull() // switched off
    expect(bandFor(mergeSensorSettings({ bands: { lab: { temp: { lo: 25, hi: 20 } } } }), 'lab', 'temp')).toEqual({ lo: null, hi: 20 }) // low above high is dropped
    expect(mergeSensorSettings({ silentMin: -4, delayMin: { fridge: 'x' } })).toEqual({ ...S })
  })
  it('checks hand readings', () => {
    const now = at('2026-11-06', '12:00')
    const ok = { place: 'fruiting' as const, sensor_id: null, at: now - MIN, temp: 16, rh: null, co2: null, note: '', who: '' }
    expect(checkReading(ok, now)).toBeNull()
    expect(checkReading({ ...ok, place: null }, now)).toMatch(/PICK WHERE/)
    expect(checkReading({ ...ok, at: Number.NaN }, now)).toMatch(/NOT REAL/)
    expect(checkReading({ ...ok, at: now + 10 * MIN }, now)).toMatch(/FUTURE/)
    expect(checkReading({ ...ok, temp: null }, now)).toMatch(/AT LEAST ONE/)
    expect(checkReading({ ...ok, rh: 120 }, now)).toMatch(/OUTSIDE WHAT A SENSOR/)
    expect(checkReading({ ...ok, co2: Number.NaN }, now)).toMatch(/NOT READABLE/)
  })
  it('checks sensors and air conditioner logs', () => {
    const base = { name: 'FRUIT N', place: 'fruiting' as const, vendor: 'govee' as const, model: 'H5179', device_id: 'AA:01', measures: ['temp' as const], auto: true, notes: '' }
    expect(checkSensor(base, [], null)).toBeNull()
    expect(checkSensor({ ...base, name: ' ' }, [], null)).toMatch(/NAME/)
    expect(checkSensor({ ...base, measures: [] }, [], null)).toMatch(/MEASURES/)
    expect(checkSensor(base, [sensor('x', { name: 'fruit n' })], null)).toMatch(/HAS THAT NAME/)
    expect(checkSensor(base, [sensor('x', { device_id: 'aa:01' })], null)).toMatch(/DEVICE ID/)
    expect(checkSensor(base, [sensor('x', { name: 'FRUIT N', active: false })], null)).toBeNull() // retired names can be reused
    const now = at('2026-11-06', '12:00')
    const ac = { unit: 'lennox36a', at: now, mode: 'cool' as const, set: 13, shown: 14, state: 'running' as const, fault: '', notes: '', who: '' }
    expect(checkAc(ac, now)).toBeNull()
    expect(checkAc({ ...ac, unit: 'x' }, now)).toMatch(/PICK/)
    expect(checkAc({ ...ac, state: 'fault' }, now)).toMatch(/ERROR CODE/)
    expect(checkAc({ ...ac, set: 55 }, now)).toMatch(/0-40/)
  })
})

describe('status, excursions and time in band (hand-worked)', () => {
  // Fruiting air every 10 min from 10:00: 16, 17, 19.5, 20, 19.2, 18, 16 (band 13-19, delay 15 min).
  // Hand-worked on a band Joseph could set on SET POINTS (the defaults are now 13-20, 10 min).
  const S = mergeSensorSettings({ bands: { fruiting: { temp: { lo: 13, hi: 19 } } }, delayMin: { fruiting: 15 } })
  const t0 = at('2026-11-05', '10:00')
  const temps = [16, 17, 19.5, 20, 19.2, 18, 16]
  const rows = temps.map((v, i) => rd('fruiting', t0 + i * 10 * MIN, { temp_c: v }))
  const idx = indexReadings(rows)
  it('finds the excursion 10:20-10:50, peak 20 C', () => {
    const ex = excursions(idx.get('fruiting'), 'temp', bandFor(S, 'fruiting', 'temp'), 15)
    expect(ex).toEqual([{ side: 'high', start: t0 + 20 * MIN, end: t0 + 50 * MIN, peak: 20, minutes: 30, readings: 3, alarmed: true }])
  })
  it('alarms only after the delay', () => {
    // Up to 10:40 (19.2): out since 10:20 = 20 min >= 15 -> alarm.
    const s40 = indexReadings(rows.slice(0, 5)).get('fruiting')
    const m40 = measureNow(s40, 'fruiting', 'temp', S, t0 + 41 * MIN)
    expect(m40).toMatchObject({ value: 19.2, side: 'high', outSince: t0 + 20 * MIN, outMin: 20, alarm: true })
    // Up to 10:30: out for 10 min < 15 -> out, not yet an alarm.
    const m30 = measureNow(indexReadings(rows.slice(0, 4)).get('fruiting'), 'fruiting', 'temp', S, t0 + 31 * MIN)
    expect(m30).toMatchObject({ outMin: 10, alarm: false, side: 'high' })
    // A single hand reading out of band alarms at once.
    const hand = indexReadings([rd('fruiting', t0, { temp_c: 21, source: 'hand' })]).get('fruiting')
    expect(measureNow(hand, 'fruiting', 'temp', S, t0 + MIN).alarm).toBe(true)
    // A reading older than 12 hours is shown but does not alarm.
    expect(measureNow(hand, 'fruiting', 'temp', S, t0 + 13 * 3600000)).toMatchObject({ stale: true, alarm: false })
    // Back in band at 10:50 -> ok.
    expect(placeNow(idx, 'fruiting', S, t0 + 61 * MIN)).toMatchObject({ alarm: false, out: false })
  })
  it('works out time in band', () => {
    // 10:00-11:00: readings each stand 10 min; 10:20, 10:30, 10:40 out = 30 of 60 known minutes -> 50%.
    expect(timeInBand(idx.get('fruiting'), 'temp', bandFor(S, 'fruiting', 'temp'), t0, t0 + 60 * MIN)).toEqual({ pct: 50, knownMin: 60, outMin: 30 })
    // A gap is unknown, not good or bad: ok at 0, out at 120 min; window 0-180, hold 60.
    const gap = indexReadings([rd('lab', t0, { temp_c: 18 }), rd('lab', t0 + 120 * MIN, { temp_c: 23 })]).get('lab')
    expect(timeInBand(gap, 'temp', bandFor(S, 'lab', 'temp'), t0, t0 + 180 * MIN)).toEqual({ pct: 50, knownMin: 120, outMin: 60 })
    expect(timeInBand(gap, 'temp', null, t0, t0 + 60 * MIN).pct).toBeNull()
  })
  it('gives daily min, max and average on the farm\'s days', () => {
    // 23:50 on 4 Nov farm time belongs to 4 Nov, not 5 Nov (it is 05:50 UTC on the 5th).
    const late = rd('fruiting', at('2026-11-04', '23:50'), { temp_c: 15 })
    const d = dailyStats(indexReadings([...rows, late]).get('fruiting'), 'temp', t0 + 2 * 3600000, 3)
    expect(d.map((x) => x.day)).toEqual(['2026-11-05', '2026-11-04'])
    // (16+17+19.5+20+19.2+18+16)/7 = 125.7/7 = 17.957 -> 17.96
    expect(d[0]).toEqual({ day: '2026-11-05', n: 7, min: 16, max: 20, avg: 17.96 })
    expect(d[1]).toEqual({ day: '2026-11-04', n: 1, min: 15, max: 15, avg: 15 })
  })
  it('cuts readings into slices for the graph', () => {
    // 70 min in 2 slices of 35 min: 10:00-10:35 -> 16, 17, 19.5, 20 (avg 18.125); 10:35-11:10 -> 19.2, 18, 16 (avg 17.733)
    const b = buckets(idx.get('fruiting'), 'temp', t0, t0 + 70 * MIN, 2)
    expect(b.map((x) => [x.n, x.min, x.max, Math.round(x.avg * 1000) / 1000])).toEqual([[4, 16, 20, 18.125], [3, 16, 19.2, 17.733]])
    expect(buckets(idx.get('fruiting'), 'co2', t0, t0 + 70 * MIN, 2)).toEqual([])
  })
})

describe('alarms', () => {
  const now = at('2026-11-06', '12:00')
  it('raises silent sensors, all-silent, power, AC faults; acknowledged ones sink', () => {
    const rows = [rd('fruiting', now - 40 * MIN, { sensor_id: 'a', temp_c: 16 }), rd('lab', now - 5 * MIN, { sensor_id: 'b', temp_c: 18.5 })]
    const idx = indexReadings(rows)
    const sensors = [sensor('a'), sensor('b', { place: 'lab' }), sensor('h', { auto: false, place: 'lab' })]
    const one = alarms({ idx, sensors, ac: [], settings: S, now, openCut: null })
    expect(one.map((a) => a.kind)).toEqual(['SILENT']) // a: 40 min > 30; b fresh; h is a hand meter
    expect(one[0].text).toMatch(/^A \(FRUITING\) HAS SENT NOTHING SINCE 6 NOV 11:20/)
    // Both automatic sensors silent: one ALL SILENT alarm instead of two.
    const both = alarms({ idx, sensors, ac: [], settings: S, now: now + 60 * MIN, openCut: null })
    expect(both.map((a) => a.kind)).toEqual(['ALL SILENT'])
    expect(both[0].text).toMatch(/ALL 2 AUTOMATIC SENSORS ARE SILENT SINCE 6 NOV 11:55/)
    // Power cut and an AC fault.
    const ac: AcCheck[] = [{ id: 'k1', unit: 'lennox12a', logged_at: isoOf(now - 3600000), mode: 'cool', set_c: 18, shown_c: null, state: 'fault', fault_code: 'E6', notes: null, who: null, created_at: '', updated_at: '' }]
    const all = alarms({ idx, sensors, ac, settings: S, now, openCut: { id: 'c1', down_at: isoOf(now - 30 * MIN) } })
    expect(all.map((a) => a.kind)).toEqual(['POWER', 'AC FAULT', 'SILENT'])
    expect(all[1].text).toBe('LENNOX 12K #1 FAULT E6 SINCE 6 NOV 11:00.')
    // A later RUNNING check clears the fault.
    const fixed = [...ac, { ...ac[0], id: 'k2', logged_at: isoOf(now - 10 * MIN), state: 'running' as const, fault_code: null }]
    expect(alarms({ idx, sensors, ac: fixed, settings: S, now, openCut: null }).map((a) => a.kind)).toEqual(['SILENT'])
    // Acknowledged: still listed, last, marked.
    const st: SensorSettings = { ...S, acks: { [all[0].key]: isoOf(now) } }
    const acked = alarms({ idx, sensors, ac, settings: st, now, openCut: { id: 'c1', down_at: isoOf(now - 30 * MIN) } })
    expect(acked.map((a) => [a.kind, a.acked])).toEqual([['AC FAULT', false], ['SILENT', false], ['POWER', true]])
    expect(alarmMessage(acked, now).split('\n')).toHaveLength(3)
    expect(alarmMessage([], now)).toBe('MY/CO/L CLIMATE 6 NOV 12:00: ALL CLEAR.')
    expect(climateLine(acked, 2)).toEqual({ label: 'CLIMATE', value: '2 ALARMS // AC FAULT INCUBATION', warn: true })
    expect(climateLine([], 0).value).toBe('NO READINGS YET')
  })
  it('a high reading alarm names the place, value and limit', () => {
    const t0 = now - 30 * MIN
    const idx = indexReadings([0, 10, 20, 30].map((m) => rd('fridge', t0 + m * MIN, { temp_c: 6 + m / 10 })))
    const list = alarms({ idx, sensors: [], ac: [], settings: S, now, openCut: null })
    expect(list.map((a) => a.text)).toEqual(['CULTURE FRIDGE TEMP HIGH: 9.0 C, 5.0 C OVER THE 4 C LIMIT // OUT FOR 30 MIN SINCE 6 NOV 11:30'])
  })
})

describe('alarm ranking', () => {
  it('puts the reading furthest past its limit first', () => {
    const S = mergeSensorSettings({ bands: { fruiting: { temp: { lo: 13, hi: 19 } } } })
    const now = at('2026-11-06', '12:00')
    // Fruiting 20 C = 1 C over 19; fridge 9 C = 5 C over 4; fruiting RH 70% = 10% under 80 = 2 steps of 5%. Hand readings alarm at once.
    const idx = indexReadings([
      rd('fruiting', now - MIN, { temp_c: 20, rh: 70, source: 'hand' }),
      rd('fridge', now - MIN, { temp_c: 9, source: 'hand' }),
    ])
    const list = alarms({ idx, sensors: [], ac: [], settings: S, now, openCut: null })
    expect(list.map((a) => `${a.place} ${a.measure} ${a.over}`)).toEqual(['fridge temp 5', 'fruiting rh 2', 'fruiting temp 1'])
    expect(list[1].text).toMatch(/^FRUITING RH LOW: 70%, 10% UNDER THE 80% FLOOR/)
  })
})

describe('Govee feed (against Govee\'s own sample answer)', () => {
  const sample = { requestId: 'x', msg: 'success', code: 200, payload: { sku: 'H5140', device: 'FD:C8', capabilities: [
    { type: 'devices.capabilities.online', instance: 'online', state: { value: true } },
    { type: 'devices.capabilities.property', instance: 'carbonDioxideConcentration', state: { value: 1590 } },
    { type: 'devices.capabilities.property', instance: 'sensorTemperature', state: { value: 79.52 } },
    { type: 'devices.capabilities.property', instance: 'sensorHumidity', state: { value: 61.2 } },
  ] } }
  it('builds the calls without leaking a key anywhere but the header', () => {
    const r = goveeStateRequest('KEY', 'H5179', 'AA:BB', 'req1')
    expect(r).toEqual({ url: 'https://openapi.api.govee.com/router/api/v1/device/state', method: 'POST', headers: { 'Govee-API-Key': 'KEY', 'Content-Type': 'application/json' }, body: '{"requestId":"req1","payload":{"sku":"H5179","device":"AA:BB"}}' })
    expect(goveeDevicesRequest('KEY').url).toBe('https://openapi.api.govee.com/router/api/v1/user/devices')
  })
  it('reads the state and the device list', () => {
    expect(parseGoveeState(sample)).toEqual({ online: true, temp: 79.52, rh: 61.2, co2: 1590 })
    expect(parseGoveeState({ code: 400 })).toBeNull()
    expect(parseGoveeState({ code: 200, payload: { capabilities: [{ instance: 'sensorTemperature', state: { value: { currentTemperature: 70 } } }] } })!.temp).toBe(70)
    const list = parseGoveeDevices({ code: 200, data: [{ sku: 'H5179', device: 'AA', deviceName: 'Fruit', type: 'devices.types.thermometer', capabilities: [{ instance: 'sensorTemperature' }] }, { sku: 'H6008', device: 'BB', type: 'devices.types.light', capabilities: [{ instance: 'powerSwitch' }] }, { sku: '' }] })
    expect(list.map((d) => [d.sku, d.sensor])).toEqual([['H5179', true], ['H6008', false]])
  })
  it('polls: converts F to C, skips offline, stops on a refused key', async () => {
    const sensors = [sensor('a', { model: 'H5140', device_id: 'FD:C8', measures: ['temp', 'rh', 'co2'], place: 'incubation' }), sensor('b', { device_id: 'OFF' }), sensor('c', { device_id: 'BUSY' }), sensor('d', { vendor: 'hand', device_id: null })]
    const seen: HttpRequest[] = []
    const fetcher = async (r: HttpRequest) => {
      seen.push(r)
      const dev = JSON.parse(r.body as string).payload.device
      if (dev === 'OFF') return { status: 200, json: { ...sample, payload: { ...sample.payload, capabilities: [{ instance: 'online', state: { value: false } }] } } }
      if (dev === 'BUSY') return { status: 429, json: {} }
      return { status: 200, json: sample }
    }
    const now = at('2026-11-06', '12:00') + 25000
    const res = await pollGovee('KEY', sensors, 'F', fetcher, now, () => 'id')
    expect(seen).toHaveLength(3) // the hand meter is not asked
    expect(res.readings).toEqual([{ sensor_id: 'a', place: 'incubation', ms: at('2026-11-06', '12:00'), temp_c: 26.4, rh: 61.2, co2_ppm: 1590 }])
    expect(res.problems).toEqual(['B: OFFLINE IN GOVEE (BATTERY, WI-FI OR GATEWAY).', 'C: GOVEE SAYS TOO MANY CALLS. TRY AGAIN LATER.'])
    const refused = await pollGovee('BAD', sensors, 'F', async () => ({ status: 401, json: {} }), now, () => 'id')
    expect(refused.problems).toEqual(['GOVEE REFUSED THE API KEY.'])
    expect((await pollGovee('', sensors, 'F', fetcher, now, () => 'id')).problems).toEqual(['NO GOVEE API KEY SET.'])
  })
  it('decodes the Bluetooth broadcast of the H5075 family', () => {
    // 23.4 C, 56.7%: 234 x 1000 + 567 = 234567 = 0x039447
    expect(decodeGoveeBle([0x00, 0x03, 0x94, 0x47, 0x64, 0x00])).toEqual({ temp_c: 23.4, rh: 56.7, battery: 100 })
    // -5.2 C, 80.0%: 52 x 1000 + 800 = 52800 = 0xCE40, top bit = below zero
    expect(decodeGoveeBle([0x00, 0x80, 0xce, 0x40, 50])).toEqual({ temp_c: -5.2, rh: 80, battery: 50 })
    expect(decodeGoveeBle([0x00, 0x03])).toBeNull()
    expect(decodeGoveeBle([0, 256, 0, 0, 1])).toBeNull() // 256 is not a byte
  })
  it('lists every route with a verdict, and a Telegram message for the bridge', () => {
    expect(FEEDS.map((f) => f.id)).toEqual(['govee-cloud', 'govee-ble', 'lennox', 'csv', 'mock'])
    expect(FEEDS.find((f) => f.id === 'lennox')!.built).toBe(false)
    expect(telegramRequest('T', '42', 'hi').url).toBe('https://api.telegram.org/botT/sendMessage')
  })
})

describe('mock data', () => {
  it('is the same for the same seed, and an AC failure warms the room', () => {
    const now = at('2026-11-06', '12:00')
    const spec = { place: 'fruiting' as const, sensorId: 's', from: now - 6 * 3600000, to: now, stepMin: 10, seed: 7, fault: 'ac-fail' as const, faultAt: now - 120 * MIN, co2: true, rh: true }
    const a = mockSeries(spec)
    expect(a).toEqual(mockSeries(spec))
    expect(a).toHaveLength(37) // 6 h at 10 min, both ends = 37
    // Before the fault: 16 C +- 0.5. After 120 min: 16 + 11 x (1 - e^(-120/90)) = 24.1 C, give or take the swing.
    expect(Math.abs((a[0].temp_c as number) - 16)).toBeLessThan(0.6)
    expect(a[a.length - 1].temp_c as number).toBeGreaterThan(23)
    expect(a[a.length - 1].temp_c as number).toBeLessThan(25.2)
    expect(a.every((r) => r.co2_ppm !== null && r.co2_ppm >= 550 && r.co2_ppm <= 950)).toBe(true)
    const silent = mockSeries({ ...spec, fault: 'silent' })
    expect(silent).toHaveLength(24) // stops at the fault: 6 h ago to 2 h 10 min ago = 230 min / 10 + 1 = 24
  })
})

// ---------- mock trial through the Store ----------

async function freshStore() {
  const s = new Store(new MemoryBackend())
  for (const t of ['sensors', 'sensor_readings', 'ac_log', 'app_settings', EDIT_LOG]) await s.ensure(t)
  return s
}
const logOf = (s: Store) => s.rows<EditEntry>(EDIT_LOG)

describe('mock trial: a week of sensors, an AC failure, a CSV file and hand checks', () => {
  it('runs end to end, logs every change and undoes cleanly', async () => {
    const store = await freshStore()
    const now = at('2026-11-06', '12:00')
    // 1. Joseph adds a Govee sensor in the culture fridge.
    const g = await store.action('SENSOR ADDED', () => saveSensor(store, null, { name: 'fridge govee', place: 'fridge', vendor: 'govee', model: 'h5179', device_id: 'aa:bb:cc', measures: ['temp', 'rh'], auto: false, notes: '' }))
    expect(g).toMatchObject({ name: 'FRIDGE GOVEE', model: 'H5179', device_id: 'AA:BB:CC', active: true, mock: false })
    // 2. A hand reading of 6 C in the fridge alarms at once.
    await store.action('READING SAVED', () => addReading(store, { place: 'fridge', sensor_id: null, at: now - 5 * MIN, temp: 6, rh: null, co2: null, note: 'door left open', who: 'jm' }, now))
    let idx = indexReadings(store.rows<Reading>('sensor_readings'))
    let list = alarms({ idx, sensors: store.rows<Sensor>('sensors'), ac: [], settings: S, now, openCut: null })
    expect(list.map((a) => a.text)).toEqual(['CULTURE FRIDGE TEMP HIGH: 6.0 C, 2.0 C OVER THE 4 C LIMIT // HAND READING SINCE 6 NOV 11:55'])
    // 3. Acknowledge it.
    await store.action('ALARM SEEN', () => ackAlarms(store, S, [list[0].key], now))
    const st = mergeSensorSettings(store.rows('app_settings').find((r) => r.id === 'sensors')?.value)
    expect(alarms({ idx, sensors: [], ac: [], settings: st, now, openCut: null })[0].acked).toBe(true)
    // 4. Import the fridge's Govee file: 3 lines, in Fahrenheit.
    const csv = 'Timestamp,Temperature_Fahrenheit,Relative_Humidity\n2026-11-06 09:00:00,35.6,70\n2026-11-06 09:10:00,36.5,71\n2026-11-06 09:20:00,37.4,72\n'
    const p = parseSensorCsv(csv)
    const plan = planImport(p.rows, { sensor_id: g.id, place: 'fridge' }, idx)
    const batch = await store.action('CSV IMPORTED', () => importReadings(store, plan, { sensor_id: g.id, place: 'fridge' }, 'jm'))
    const fr = store.rows<Reading>('sensor_readings').filter((r) => r.batch === batch)
    expect(fr.map((r) => r.temp_c)).toEqual([2, 2.5, 3]) // 35.6 F = 2.0 C, 36.5 F = 2.5 C, 37.4 F = 3.0 C
    // Importing the same file again adds nothing.
    idx = indexReadings(store.rows<Reading>('sensor_readings'))
    await expect(store.action('AGAIN', () => importReadings(store, planImport(p.rows, { sensor_id: g.id, place: 'fridge' }, idx), { sensor_id: g.id, place: 'fridge' }, null))).rejects.toThrow(/NOTHING NEW/)
    // 5. Mock week for three rooms with the fruiting AC failing 2 h ago.
    const m = await store.action('MOCK DATA ADDED', () => addMock(store, { places: ['fruiting', 'incubation', 'lab'], hours: 24 * 7, stepMin: 10, fault: 'ac-fail', faultPlace: 'fruiting', faultAgoMin: 120, seed: 3 }, now))
    expect(m.sensors).toBe(3)
    expect(m.readings).toBe(3 * (7 * 144 + 1)) // a week at 10 min, both ends = 1009 each
    idx = indexReadings(store.rows<Reading>('sensor_readings'))
    list = alarms({ idx, sensors: store.rows<Sensor>('sensors'), ac: [], settings: st, now, openCut: null })
    // The fridge's 6 C hand reading is still the newest fridge reading: still listed, but acknowledged.
    expect(list.filter((a) => a.kind === 'HIGH').map((a) => `${a.place}:${a.measure}:${a.acked}`)).toEqual(['fruiting:temp:false', 'fridge:temp:true'])
    // Crosses 19 C about 29 min after the fault (11 x (1 - e^(-t/90)) = 3), so out for about 90 min.
    const fruit = measureNow(idx.get('fruiting'), 'fruiting', 'temp', st, now)
    expect(fruit.outMin).toBeGreaterThanOrEqual(70)
    expect(fruit.outMin).toBeLessThanOrEqual(100)
    // Incubation and lab stayed in band all week.
    expect(timeInBand(idx.get('incubation'), 'temp', bandFor(st, 'incubation', 'temp'), now - 7 * 86400000, now).pct).toBe(100)
    expect(placeNow(idx, 'lab', st, now).alarm).toBe(false)
    // 6. Hand check of the AC: fault E1.
    await store.action('AC CHECK SAVED', () => saveAc(store, null, { unit: 'lennox36a', at: now, mode: 'cool', set: 13, shown: null, state: 'fault', fault: 'e1', notes: '', who: 'jm' }, now))
    expect(store.rows<AcCheck>('ac_log')[0].fault_code).toBe('E1')
    // 7. History: every action logged; the mock run is one summary line.
    const labels = new Set(logOf(store).map((e) => e.label))
    for (const l of ['SENSOR ADDED', 'READING SAVED', 'ALARM SEEN', 'CSV IMPORTED', 'MOCK DATA ADDED', 'AC CHECK SAVED']) expect(labels.has(l)).toBe(true)
    expect(logOf(store).filter((e) => e.label === 'MOCK DATA ADDED' && e.table_name === 'sensor_readings')).toHaveLength(1)
    // 8. Remove the mock data: real readings stay.
    const before = store.rows<Reading>('sensor_readings').length
    const gone = await store.action('MOCK DATA REMOVED', () => removeMock(store))
    expect(gone).toEqual({ sensors: 3, readings: 3027 })
    expect(store.rows<Reading>('sensor_readings')).toHaveLength(before - 3027)
    expect(store.rows<Sensor>('sensors').map((s) => s.name)).toEqual(['FRIDGE GOVEE'])
    // 9. UNDO puts the mock data back exactly; UNDO again removes the AC check.
    expect(await store.undo()).toBe('MOCK DATA REMOVED')
    expect(store.rows<Reading>('sensor_readings')).toHaveLength(before)
    expect(store.rows<Sensor>('sensors')).toHaveLength(4)
    expect(await store.undo()).toBe('AC CHECK SAVED')
    expect(store.rows<AcCheck>('ac_log')).toHaveLength(0)
    // 10. Delete a CSV batch in one go; a sensor with readings cannot be deleted, only retired.
    expect(await store.action('IMPORT REMOVED', () => deleteBatch(store, batch))).toBe(3)
    await store.action('READING SAVED', () => addReading(store, { place: 'fridge', sensor_id: g.id, at: now, temp: 3, rh: null, co2: null, note: '', who: '' }, now))
    await expect(store.action('X', () => deleteSensor(store, g.id))).rejects.toThrow(/RETIRE IT/)
    await store.action('SENSOR RETIRED', () => setSensorActive(store, g.id, false))
    expect(store.rows<Sensor>('sensors').find((s) => s.id === g.id)!.active).toBe(false)
  })
})

describe('data logging and history resilience', () => {
  it('sensors and AC checks travel in the backup file; readings go out as CSV', async () => {
    const store = await freshStore()
    const now = at('2026-11-06', '12:00')
    expect(BACKUP_TABLES).toContain('sensors')
    expect(BACKUP_TABLES).toContain('ac_log')
    expect(BACKUP_TABLES as readonly string[]).not.toContain('sensor_readings')
    const s1 = await store.action('S', () => saveSensor(store, null, { name: 'lab 1', place: 'lab', vendor: 'govee', model: 'H5179', device_id: '', measures: ['temp', 'rh'], auto: true, notes: '' }))
    await store.action('A', () => saveAc(store, null, { unit: 'lennox12b', at: now, mode: 'cool', set: 18, shown: 18.5, state: 'running', fault: '', notes: 'quiet', who: '' }, now))
    await store.action('R', () => addReading(store, { place: 'lab', sensor_id: s1.id, at: now, temp: 18.44, rh: 55.55, co2: null, note: 'a, "b"', who: '' }, now))
    const json = await store.exportJson()
    const other = await freshStore()
    await other.importJson(json)
    const noStamp = <T extends { updated_at: string }>(rs: T[]) => rs.map(({ updated_at: _u, ...r }) => r)
    expect(noStamp(other.rows<Sensor>('sensors'))).toEqual(noStamp(store.rows<Sensor>('sensors')))
    expect(noStamp(other.rows<AcCheck>('ac_log'))).toEqual(noStamp(store.rows<AcCheck>('ac_log')))
    const csv = readingsCsv(store.rows<Reading>('sensor_readings'), store.rows<Sensor>('sensors'))
    expect(csv.split('\n')[1]).toBe(`2026-11-06,12:00,${isoOf(now)},lab,LAB 1,18.44,55.6,,hand,"a, ""b"""`)
  })
  it('two years of readings keep the same figures after new data, band changes and a reload', async () => {
    const backend = new MemoryBackend()
    const store = new Store(backend)
    for (const t of ['sensors', 'sensor_readings', 'app_settings', EDIT_LOG]) await store.ensure(t)
    const start = at('2024-11-01', '00:00')
    const now = at('2026-11-01', '00:00')
    // Every 6 hours for two years in the incubation room: 18 C, and 22 C every 4th reading (once a day, a 6 h run out of band).
    const rows: Reading[] = []
    for (let t = start, i = 0; t < now; t += 6 * 3600000, i++) rows.push(rd('incubation', t, { temp_c: i % 4 === 3 ? 22 : 18, source: 'csv', batch: 'old' }))
    await store.action('OLD DATA', () => store.put('sensor_readings', rows))
    expect(rows).toHaveLength(730 * 4) // 730 days x 4
    const old = indexReadings(store.rows<Reading>('sensor_readings'))
    const nov2025 = { from: at('2025-11-01', '00:00'), to: at('2025-12-01', '00:00') }
    const figures = (idx = old, st = S) => ({
      ex: excursions(idx.get('incubation'), 'temp', bandFor(st, 'incubation', 'temp'), st.delayMin.incubation, nov2025.from, nov2025.to).length,
      tib: timeInBand(idx.get('incubation'), 'temp', bandFor(st, 'incubation', 'temp'), nov2025.from, nov2025.to, 360).pct,
      days: dailyStats(idx.get('incubation'), 'temp', at('2025-11-30', '12:00'), 30).map((d) => d.avg).join(','),
    })
    const was = figures()
    // November 2025: 30 days, one 6-hour run out a day = 30 excursions; in band 18 of 24 h = 75%; each day avg (18x3+22)/4 = 19.
    expect(was.ex).toBe(30)
    expect(was.tib).toBe(75)
    expect(was.days).toBe(Array(30).fill(19).join(','))
    // New data today, a reload from the saved copy, and an edited sensor elsewhere: November 2025 is unchanged.
    await store.action('NEW', () => addReading(store, { place: 'incubation', sensor_id: null, at: now, temp: 30, rh: null, co2: null, note: '', who: '' }, now))
    const reload = new Store(backend)
    await reload.ensure('sensor_readings')
    const idx2 = indexReadings(reload.rows<Reading>('sensor_readings'))
    expect(figures(idx2)).toEqual(was)
    // Daily figures are raw readings: a band change does not touch them. Excursions follow today's band (said on screen).
    const wider = mergeSensorSettings({ bands: { incubation: { temp: { lo: 15, hi: 23 } } } })
    expect(figures(idx2, wider)).toEqual({ ex: 0, tib: 100, days: was.days })
    await store.action('BANDS', () => saveSensorSettings(store, S, { bands: wider.bands }))
    expect(dailyStats(idx2.get('incubation'), 'temp', at('2025-11-30', '12:00'), 30).map((d) => d.avg).join(',')).toBe(was.days)
  })
})

describe('last reading per sensor', () => {
  it('finds each sensor\'s newest reading', () => {
    const t = at('2026-11-06', '10:00')
    const idx = indexReadings([rd('lab', t, { sensor_id: 'a', temp_c: 1 }), rd('lab', t + MIN, { sensor_id: 'b', temp_c: 1 }), rd('fridge', t + 2 * MIN, { sensor_id: 'a', temp_c: 1 })])
    expect([...lastBySensor(idx).entries()].sort()).toEqual([['a', t + 2 * MIN], ['b', t + MIN]])
  })
})
