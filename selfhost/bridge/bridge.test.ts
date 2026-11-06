import { describe, expect, it } from 'vitest'
import { readEnv, runOnce, toRows } from './bridge'

const SENSOR = { id: 's1', name: 'FRUITING GOVEE', place: 'fruiting', vendor: 'govee', model: 'H5179', device_id: 'AA:BB', measures: ['temp', 'rh'], auto: true, active: true, mock: false, notes: null, created_at: '', updated_at: '' }

describe('sensor bridge', () => {
  it('reads its settings safely', () => {
    expect(readEnv({ GOVEE_EVERY_MIN: '1' }).everyMin).toBe(10)
    expect(readEnv({ REST_URL: 'http://rest:3000/', GOVEE_UNIT: 'C' })).toMatchObject({ rest: 'http://rest:3000', unit: 'C' })
  })
  it('turns readings into rows for sensor_readings', () => {
    const rows = toRows([{ sensor_id: 's1', place: 'fruiting', ms: Date.UTC(2026, 10, 6, 12, 0), temp_c: 16, rh: 88, co2_ppm: null }], () => 'id1')
    expect(rows[0]).toMatchObject({ id: 'id1', taken_at: '2026-11-06T12:00:00.000Z', source: 'govee', temp_c: 16, rh: 88 })
  })
  it('asks Govee and saves one reading per sensor', async () => {
    const calls: { url: string; body?: string }[] = []
    const http = async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body })
      const json = url.includes('/sensors?')
        ? [SENSOR]
        : url.includes('govee')
          ? { code: 200, payload: { capabilities: [{ instance: 'online', state: { value: true } }, { instance: 'sensorTemperature', state: { value: 60.8 } }, { instance: 'sensorHumidity', state: { value: 88 } }] } }
          : null
      return { ok: true, status: url.includes('sensor_readings') ? 201 : 200, json: async () => json, text: async () => '' }
    }
    const out = await runOnce(readEnv({ GOVEE_API_KEY: 'k', SERVICE_KEY: 's' }), http, Date.UTC(2026, 10, 6, 12, 0, 30), () => 'x')
    expect(out).toContain('SAVED 1 READING')
    const saved = JSON.parse(calls.find((c) => c.url.endsWith('/sensor_readings'))!.body!)
    expect(saved[0]).toMatchObject({ sensor_id: 's1', place: 'fruiting', temp_c: 16, rh: 88, source: 'govee' })
  })
})
