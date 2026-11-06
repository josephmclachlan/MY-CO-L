// Writes for CLIMATE SENSORS (build G8). Each function is ONE user action: screens call them inside
// store.action(label, ...) so one tap is one UNDO step and one history line.

import { uuid, type Store } from './store'
import { isoOf } from './facility'
import {
  SENSORS_ID,
  checkAc,
  checkReading,
  checkSensor,
  cleanNote,
  indexReadings,
  mergeSensorSettings,
  mockSeries,
  planImport,
  type AcCheck,
  type AcInput,
  type CsvRow,
  type ImportPlan,
  type MockFault,
  type PlaceId,
  type Reading,
  type ReadingInput,
  type Sensor,
  type SensorInput,
  type SensorSettings,
  MOCK_HAS_CO2,
} from './sensors'

const nowIso = () => new Date().toISOString()
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10)

// ---------- settings ----------

export async function saveSensorSettings(store: Store, current: SensorSettings, patch: Partial<SensorSettings>): Promise<SensorSettings> {
  const next = mergeSensorSettings({ ...current, ...patch })
  await store.put('app_settings', { id: SENSORS_ID, value: next, updated_at: nowIso() })
  return next
}

/** Mark alarms as seen. Old acknowledgements (over 60 days) are dropped while we are here. */
export async function ackAlarms(store: Store, current: SensorSettings, keys: string[], now: number): Promise<void> {
  const cutoff = now - 60 * 86400000
  const kept = Object.fromEntries(Object.entries(current.acks).filter(([, t]) => Date.parse(t) >= cutoff))
  for (const k of keys) kept[k] = isoOf(now)
  await saveSensorSettings(store, current, { acks: kept })
}

// ---------- sensors ----------

export async function saveSensor(store: Store, id: string | null, i: SensorInput, opts: { mock?: boolean } = {}): Promise<Sensor> {
  await store.ensure('sensors')
  const all = store.rows<Sensor>('sensors')
  const bad = checkSensor(i, all, id)
  if (bad) throw new Error(bad)
  const prev = id ? all.find((s) => s.id === id) ?? null : null
  if (id && !prev) throw new Error('THAT SENSOR IS GONE. IT MAY HAVE BEEN DELETED ON ANOTHER SCREEN.')
  const now = nowIso()
  const row: Sensor = {
    id: id ?? uuid(),
    name: (cleanNote(i.name, 60) as string).toUpperCase(),
    place: i.place as PlaceId,
    vendor: i.vendor,
    model: cleanNote(i.model, 30)?.toUpperCase() ?? null,
    device_id: cleanNote(i.device_id, 80)?.toUpperCase() ?? null,
    measures: [...new Set(i.measures)],
    auto: i.auto,
    active: prev?.active ?? true,
    mock: prev?.mock ?? opts.mock ?? false,
    notes: cleanNote(i.notes, 300),
    created_at: prev?.created_at ?? now,
    updated_at: now,
  }
  await store.put('sensors', row)
  return row
}

/** Retire keeps the sensor's readings and its name in the graphs. */
export async function setSensorActive(store: Store, id: string, active: boolean): Promise<void> {
  await store.ensure('sensors')
  if (!store.rows<Sensor>('sensors').some((s) => s.id === id)) throw new Error('THAT SENSOR IS GONE.')
  await store.put('sensors', { id, active, updated_at: nowIso() })
}

/** Delete only a sensor with no readings (otherwise retire it). */
export async function deleteSensor(store: Store, id: string): Promise<void> {
  await store.ensure('sensor_readings')
  if (store.rows<Reading>('sensor_readings').some((r) => r.sensor_id === id)) throw new Error('THIS SENSOR HAS READINGS. RETIRE IT INSTEAD, SO ITS HISTORY STAYS.')
  await store.del('sensors', id)
}

// ---------- readings ----------

export async function addReading(store: Store, i: ReadingInput, now: number): Promise<Reading> {
  const bad = checkReading(i, now)
  if (bad) throw new Error(bad)
  await store.ensure('sensors')
  if (i.sensor_id && !store.rows<Sensor>('sensors').some((s) => s.id === i.sensor_id)) throw new Error('THAT SENSOR IS GONE.')
  const row: Reading = {
    id: uuid(),
    sensor_id: i.sensor_id,
    place: i.place as PlaceId,
    taken_at: isoOf(Math.floor((i.at as number) / 60000) * 60000),
    temp_c: r2(i.temp),
    rh: r1(i.rh),
    co2_ppm: i.co2 === null ? null : Math.round(i.co2),
    source: 'hand',
    batch: null,
    who: cleanNote(i.who, 60),
    note: cleanNote(i.note, 200),
    created_at: nowIso(),
  }
  await store.put('sensor_readings', row)
  return row
}

export async function deleteReading(store: Store, id: string): Promise<void> {
  await store.del('sensor_readings', id)
}

/** Save the new rows of a CSV file as one batch. Returns the batch id. */
export async function importReadings(store: Store, plan: ImportPlan, target: { sensor_id: string | null; place: PlaceId }, who: string | null): Promise<string> {
  if (!plan.add.length) throw new Error('NOTHING NEW TO IMPORT: EVERY LINE IS ALREADY SAVED.')
  await store.ensure('sensor_readings')
  // Check again against what is saved now (another import may have run since the preview).
  const fresh = planImport(plan.add, target, indexReadings(store.rows<Reading>('sensor_readings')))
  if (!fresh.add.length) throw new Error('NOTHING NEW TO IMPORT: EVERY LINE IS ALREADY SAVED.')
  const batch = `csv:${uuid().slice(0, 8)}`
  const created = nowIso()
  const rows: Reading[] = fresh.add.map((r: CsvRow) => ({
    id: uuid(),
    sensor_id: target.sensor_id,
    place: target.place,
    taken_at: isoOf(r.ms),
    temp_c: r2(r.temp_c),
    rh: r1(r.rh),
    co2_ppm: r.co2_ppm,
    source: 'csv',
    batch,
    who: cleanNote(who, 60),
    note: null,
    created_at: created,
  }))
  await store.put('sensor_readings', rows)
  return batch
}

/** Remove every reading of one import (or one mock run). */
export async function deleteBatch(store: Store, batch: string): Promise<number> {
  await store.ensure('sensor_readings')
  const ids = store.rows<Reading>('sensor_readings').filter((r) => r.batch === batch).map((r) => r.id)
  if (!ids.length) throw new Error('NOTHING LEFT IN THAT IMPORT.')
  await store.del('sensor_readings', ids)
  return ids.length
}

// ---------- mock test ----------

export interface MockRun {
  places: PlaceId[]
  hours: number
  stepMin: number
  fault: MockFault
  /** The place the fault happens in ('power' hits every place). */
  faultPlace: PlaceId | null
  /** Minutes before now the fault starts. */
  faultAgoMin: number
  seed: number
}

/** Make one mock sensor per place (if missing) and a run of made-up readings up to now. */
export async function addMock(store: Store, run: MockRun, now: number): Promise<{ sensors: number; readings: number; batch: string }> {
  if (!run.places.length) throw new Error('PICK AT LEAST ONE PLACE.')
  if (!(run.hours > 0 && run.hours <= 24 * 400)) throw new Error('HOURS SHOULD BE 1 TO 9,600.')
  if (!(run.stepMin >= 1 && run.stepMin <= 240)) throw new Error('STEP SHOULD BE 1 TO 240 MINUTES.')
  await store.ensure('sensors')
  await store.ensure('sensor_readings')
  const batch = `mock:${uuid().slice(0, 8)}`
  let made = 0
  const rows: Reading[] = []
  const created = nowIso()
  for (const [k, p] of run.places.entries()) {
    let s = store.rows<Sensor>('sensors').find((x) => x.mock && x.place === p && x.active)
    if (!s) {
      const co2 = MOCK_HAS_CO2(p)
      s = await saveSensor(store, null, {
        name: `MOCK ${p.toUpperCase()}`,
        place: p,
        vendor: 'govee',
        model: co2 ? 'H5140' : 'H5179',
        device_id: '',
        measures: co2 ? ['temp', 'rh', 'co2'] : ['temp', 'rh'],
        auto: true,
        notes: 'MADE BY MOCK TEST. REMOVE MOCK DATA DELETES IT.',
      }, { mock: true })
      made++
    }
    const hit = run.fault === 'power' || run.faultPlace === p
    const pts = mockSeries({
      place: p,
      sensorId: s.id,
      from: now - run.hours * 3600000,
      to: now,
      stepMin: run.stepMin,
      seed: run.seed * 31 + k,
      fault: hit ? run.fault : 'none',
      faultAt: now - run.faultAgoMin * 60000,
      co2: s.measures.includes('co2'),
      rh: s.measures.includes('rh'),
    })
    for (const x of pts) rows.push({ ...x, id: uuid(), batch, who: null, created_at: created })
  }
  if (rows.length > 200000) throw new Error('THAT IS OVER 200,000 READINGS. USE FEWER HOURS OR A LONGER STEP.')
  await store.put('sensor_readings', rows)
  return { sensors: made, readings: rows.length, batch }
}

/** Delete every mock reading and mock sensor. */
export async function removeMock(store: Store): Promise<{ sensors: number; readings: number }> {
  await store.ensure('sensors')
  await store.ensure('sensor_readings')
  const sens = store.rows<Sensor>('sensors').filter((s) => s.mock)
  const ids = new Set(sens.map((s) => s.id))
  const rs = store.rows<Reading>('sensor_readings').filter((r) => r.source === 'mock' || (r.sensor_id && ids.has(r.sensor_id)))
  if (!sens.length && !rs.length) throw new Error('THERE IS NO MOCK DATA.')
  if (rs.length) await store.del('sensor_readings', rs.map((r) => r.id))
  if (sens.length) await store.del('sensors', [...ids])
  return { sensors: sens.length, readings: rs.length }
}

// ---------- air conditioner checks ----------

export async function saveAc(store: Store, id: string | null, i: AcInput, now: number): Promise<AcCheck> {
  const bad = checkAc(i, now)
  if (bad) throw new Error(bad)
  await store.ensure('ac_log')
  const prev = id ? store.rows<AcCheck>('ac_log').find((c) => c.id === id) ?? null : null
  if (id && !prev) throw new Error('THAT CHECK IS GONE.')
  const t = nowIso()
  const row: AcCheck = {
    id: id ?? uuid(),
    unit: i.unit,
    logged_at: isoOf(Math.floor((i.at as number) / 60000) * 60000),
    mode: i.mode,
    set_c: r1(i.set),
    shown_c: r1(i.shown),
    state: i.state,
    fault_code: i.state === 'fault' ? cleanNote(i.fault, 40)?.toUpperCase() ?? null : null,
    notes: cleanNote(i.notes, 300),
    who: cleanNote(i.who, 60),
    created_at: prev?.created_at ?? t,
    updated_at: t,
  }
  await store.put('ac_log', row)
  return row
}

export async function deleteAc(store: Store, id: string): Promise<void> {
  await store.del('ac_log', id)
}
