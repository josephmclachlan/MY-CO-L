// G8 CLIMATE SENSORS stress tests: 100,000+ readings, rapid random actions, bad input, undo.
// STRESS_SEEDS / STRESS_STEPS raise the counts (npm run test:stress).
import { describe, expect, it } from 'vitest'
import { EDIT_LOG, MemoryBackend, Store } from './store'
import type { EditEntry } from './history'
import { isoOf } from './facility'
import { rng } from './testkit'
import {
  DEFAULT_SENSOR_SETTINGS as S,
  MEASURES,
  PLACE_IDS,
  alarms,
  bandFor,
  buckets,
  dailyStats,
  excursions,
  indexReadings,
  lastBySensor,
  parseSensorCsv,
  placeNow,
  planImport,
  sideOf,
  timeInBand,
  valueOf,
  type PlaceId,
  type Reading,
  type Sensor,
} from './sensors'
import { addMock, addReading, deleteBatch, importReadings, removeMock } from './sensorActions'

const SEEDS = Number(process.env.STRESS_SEEDS ?? 3)
const STEPS = Number(process.env.STRESS_STEPS ?? 150)
const NOW = Date.UTC(2026, 10, 6, 18, 0)

function bigSet(n: number): Reading[] {
  const out: Reading[] = []
  const step = 5 * 60000
  for (let i = 0; i < n; i++) {
    const place = PLACE_IDS[i % 6] as PlaceId
    const t = NOW - Math.floor(i / 6) * step
    out.push({ id: `b${i}`, sensor_id: `s${i % 6}`, place, taken_at: isoOf(t), temp_c: 15 + ((i * 7) % 60) / 10, rh: 70 + (i % 25), co2_ppm: place === 'fruiting' ? 600 + (i % 700) : null, source: 'csv', batch: 'big', who: null, note: null, created_at: isoOf(t) })
  }
  return out
}

describe('stress: 120,000 readings', () => {
  it('index, board, alarms, graph slices and reports stay fast and exact', { timeout: 60000 }, () => {
    const rows = bigSet(120000)
    let t = performance.now()
    const idx = indexReadings(rows)
    const tIndex = performance.now() - t
    expect([...idx.values()].reduce((n, s) => n + s.rows.length, 0)).toBe(120000)
    for (const s of idx.values()) for (let i = 1; i < s.t.length; i++) expect(s.t[i] >= s.t[i - 1]).toBe(true)
    t = performance.now()
    const board = PLACE_IDS.map((p) => placeNow(idx, p, S, NOW))
    const list = alarms({ idx, sensors: [], ac: [], settings: S, now: NOW, openCut: null, lastSeen: lastBySensor(idx) })
    const tBoard = performance.now() - t
    t = performance.now()
    const s = idx.get('fruiting')
    const b = buckets(s, 'temp', NOW - 70 * 86400000, NOW, 600)
    const tib = timeInBand(s, 'temp', bandFor(S, 'fruiting', 'temp'), NOW - 70 * 86400000, NOW)
    const ex = excursions(s, 'temp', bandFor(S, 'fruiting', 'temp'), 15)
    const days = dailyStats(s, 'temp', NOW, 90)
    const tReports = performance.now() - t
    // Slices add up to every fruiting reading in the window.
    expect(b.reduce((n, x) => n + x.n, 0)).toBe(s!.rows.length)
    expect(days.reduce((n, d) => n + d.n, 0)).toBe(s!.rows.length)
    expect(tib.pct).not.toBeNull()
    expect(ex.length).toBeGreaterThan(0)
    expect(board).toHaveLength(PLACE_IDS.length)
    expect(list.every((a) => a.text.length > 0)).toBe(true)
    // Generous limits for a slow CI box; the app does each once per minute at most.
    expect(tIndex).toBeLessThan(3000)
    expect(tBoard).toBeLessThan(1500)
    expect(tReports).toBeLessThan(1500)
  })

  it('the Store saves, logs, undoes and deletes 100,000 readings in one action', { timeout: 60000 }, async () => {
    const store = new Store(new MemoryBackend())
    for (const tb of ['sensors', 'sensor_readings', 'app_settings', EDIT_LOG]) await store.ensure(tb)
    const rows = bigSet(100000)
    const t = performance.now()
    await store.action('BIG IMPORT', () => store.put('sensor_readings', rows))
    expect(store.rows('sensor_readings')).toHaveLength(100000)
    expect(store.rows<EditEntry>(EDIT_LOG).filter((e) => e.label === 'BIG IMPORT')).toHaveLength(1) // one summary line
    expect(await store.undo()).toBe('BIG IMPORT')
    expect(store.rows('sensor_readings')).toHaveLength(0)
    await store.action('BIG IMPORT 2', () => store.put('sensor_readings', rows))
    expect(await store.action('GONE', () => deleteBatch(store, 'big'))).toBe(100000)
    expect(store.rows('sensor_readings')).toHaveLength(0)
    expect(performance.now() - t).toBeLessThan(20000)
  })

  it('a 50,000-line Govee CSV parses and de-duplicates', () => {
    const lines = ['Timestamp for sample frequency every 1 min min,Temperature_Fahrenheit,Relative_Humidity']
    for (let i = 0; i < 50000; i++) {
      const d = new Date(Date.UTC(2026, 8, 1, 6) + i * 60000 - 6 * 3600000)
      lines.push(`${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)},${(60 + (i % 10) / 10).toFixed(1)},${80 + (i % 10)}`)
    }
    lines.push(lines[1]) // a repeat
    const t = performance.now()
    const p = parseSensorCsv(lines.join('\n'))
    expect(p.rows).toHaveLength(50001)
    expect(p.errors).toEqual([])
    const plan = planImport(p.rows, { sensor_id: 'x', place: 'lab' }, new Map())
    expect(plan.add).toHaveLength(50000)
    expect(plan.dup).toBe(1)
    expect(performance.now() - t).toBeLessThan(5000)
  })
})

describe('stress: random actions with fixed rules', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: ${STEPS} random actions`, { timeout: 300000 }, async () => {
      const r = rng(seed)
      const store = new Store(new MemoryBackend())
      for (const tb of ['sensors', 'sensor_readings', 'ac_log', 'app_settings', EDIT_LOG]) await store.ensure(tb)
      const batches: string[] = []
      let logs = 0
      for (let step = 0; step < STEPS; step++) {
        if (step % 20 === 0) await new Promise((ok) => setTimeout(ok, 0)) // let the test runner breathe
        const roll = r.int(10)
        const place = r.pick(PLACE_IDS)
        const before = store.rows<Reading>('sensor_readings').length
        try {
          if (roll < 4) {
            // Hand reading, sometimes nonsense.
            const bad = r.int(4) === 0
            const v = bad ? r.pick([Number.NaN, 999, -50, null]) : 10 + r.next() * 15
            await store.action('R', () => addReading(store, { place, sensor_id: null, at: NOW - r.int(10000) * 60000, temp: v as number | null, rh: r.int(2) ? 50 + r.int(50) : null, co2: null, note: '', who: '' }, NOW))
            expect(store.rows('sensor_readings')).toHaveLength(before + 1)
          } else if (roll < 6) {
            // CSV import of 1-40 lines, some repeated, some bad.
            const lines = ['time,temperature_c,humidity']
            const base = NOW - r.int(5000) * 60000
            for (let i = 0; i < 1 + r.int(40); i++) {
              const t = new Date(base + r.int(60) * 60000 - 6 * 3600000).toISOString()
              lines.push(r.int(15) === 0 ? 'junk,,' : `${t.slice(0, 10)} ${t.slice(11, 16)},${(12 + r.next() * 10).toFixed(2)},${70 + r.int(30)}`)
            }
            const p = parseSensorCsv(lines.join('\n'))
            const target = { sensor_id: null, place }
            const plan = planImport(p.rows, target, indexReadings(store.rows<Reading>('sensor_readings')))
            const b = await store.action('CSV', () => importReadings(store, plan, target, null))
            batches.push(b)
            expect(store.rows('sensor_readings')).toHaveLength(before + plan.add.length)
          } else if (roll === 6 && batches.length) {
            const b = batches.splice(r.int(batches.length), 1)[0]
            await store.action('DEL', () => deleteBatch(store, b))
          } else if (roll === 7) {
            await store.action('MOCK', () => addMock(store, { places: [place], hours: 1 + r.int(12), stepMin: 5 + r.int(20), fault: r.pick(['none', 'ac-fail', 'door', 'silent', 'power'] as const), faultPlace: place, faultAgoMin: r.int(300), seed: r.int(1000) }, NOW))
          } else if (roll === 8) {
            await store.action('MOCK OFF', () => removeMock(store))
          } else {
            await store.undo()
          }
        } catch (e) {
          // Refusals must be plain-English messages, and must not change anything.
          expect(String(e instanceof Error ? e.message : e)).toMatch(/^[A-Z0-9 ,.:'()\-/%"]+$/)
          expect(store.rows('sensor_readings')).toHaveLength(before)
        }
        // Rules that always hold.
        const rows = store.rows<Reading>('sensor_readings')
        const sensors = store.rows<Sensor>('sensors')
        expect(new Set(rows.map((x) => x.id)).size).toBe(rows.length)
        for (const x of rows) {
          expect(PLACE_IDS).toContain(x.place)
          expect(Number.isFinite(Date.parse(x.taken_at))).toBe(true)
          for (const m of MEASURES) {
            const v = valueOf(x, m.id)
            if (v !== null) expect(v >= m.lo && v <= m.hi).toBe(true)
          }
        }
        // CSV rows: never two in the same minute for the same place with no sensor.
        const keys = rows.filter((x) => x.source === 'csv').map((x) => `${x.place}:${Math.floor(Date.parse(x.taken_at) / 60000)}`)
        expect(new Set(keys).size).toBe(keys.length)
        // Every mock reading has its mock sensor, unless undo split them (then the sensor came back too).
        const mockIds = new Set(sensors.filter((s) => s.mock).map((s) => s.id))
        for (const x of rows.filter((y) => y.source === 'mock')) expect(mockIds.has(x.sensor_id as string)).toBe(true)
        // The board never alarms on a value inside its band.
        if (step % 10 === 0) {
          const idx = indexReadings(rows)
          for (const p of PLACE_IDS) for (const m of placeNow(idx, p, S, NOW).measures) if (m.alarm && m.value !== null) expect(sideOf(m.value, m.band)).not.toBe('ok')
        }
        const nowLogs = store.rows(EDIT_LOG).length
        expect(nowLogs).toBeGreaterThanOrEqual(logs)
        logs = nowLogs
      }
    })
  }
})
