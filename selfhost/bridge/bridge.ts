// MY/CO/L sensor bridge: runs on the farm box (docker compose profile "sensors").
// Every GOVEE_EVERY_MIN minutes it asks Govee's cloud for each active Govee sensor listed on the
// ATMOSPHERICS screen (model + device id filled in) and writes the readings into sensor_readings.
// The Govee key lives only in the box's .env, never in the app or on GitHub.
// Built into bridge.mjs by `npm run build:bridge` (the self-host download already includes it).
import { pollGovee, type FeedReading, type Fetcher } from '../../src/lib/sensorFeeds'
import type { Sensor } from '../../src/lib/sensors'

export interface BridgeEnv {
  rest: string
  serviceKey: string
  goveeKey: string
  everyMin: number
  unit: 'F' | 'C'
}

export function readEnv(e: Record<string, string | undefined>): BridgeEnv {
  const every = Number(e.GOVEE_EVERY_MIN ?? 10)
  return {
    rest: (e.REST_URL ?? 'http://rest:3000').replace(/\/+$/, ''),
    serviceKey: e.SERVICE_KEY ?? '',
    goveeKey: e.GOVEE_API_KEY ?? '',
    // Govee allows 10,000 calls a day per account. Never faster than every 2 minutes.
    everyMin: Number.isFinite(every) && every >= 2 ? every : 10,
    unit: e.GOVEE_UNIT === 'C' ? 'C' : 'F',
  }
}

/** One row for sensor_readings per reading. */
export function toRows(readings: FeedReading[], newId: () => string) {
  return readings.map((r) => ({
    id: newId(),
    sensor_id: r.sensor_id,
    place: r.place,
    taken_at: new Date(r.ms).toISOString(),
    temp_c: r.temp_c,
    rh: r.rh,
    co2_ppm: r.co2_ppm,
    source: 'govee',
    who: 'BRIDGE',
  }))
}

type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

/** One round: read the sensor list, ask Govee, save. Returns a one-line summary. */
export async function runOnce(env: BridgeEnv, http: Http, now: number, newId: () => string): Promise<string> {
  const h = { Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' }
  const list = await http(`${env.rest}/sensors?vendor=eq.govee&active=is.true&mock=is.false&select=*`, { headers: h })
  if (!list.ok) return `CANNOT READ THE SENSOR LIST (${list.status}).`
  const sensors = (await list.json()) as Sensor[]
  const fetcher: Fetcher = async (r) => {
    const a = await http(r.url, { method: r.method, headers: r.headers, body: r.body })
    let json: unknown = null
    try {
      json = await a.json()
    } catch {
      /* not json */
    }
    return { status: a.status, json }
  }
  const res = await pollGovee(env.goveeKey, sensors, env.unit, fetcher, now, newId)
  if (res.readings.length) {
    const put = await http(`${env.rest}/sensor_readings`, { method: 'POST', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(toRows(res.readings, newId)) })
    if (!put.ok) return `GOVEE GAVE ${res.readings.length} READING(S) BUT SAVING FAILED (${put.status}): ${(await put.text()).slice(0, 200)}`
  }
  return [`SAVED ${res.readings.length} READING(S) FROM ${sensors.length} GOVEE SENSOR(S).`, ...res.problems].join(' ')
}

async function main() {
  const env = readEnv(process.env)
  if (!env.goveeKey) {
    console.log('NO GOVEE_API_KEY IN .env: THE BRIDGE IS IDLE.')
    return
  }
  const http = globalThis.fetch as unknown as Http
  const id = () => globalThis.crypto.randomUUID()
  for (;;) {
    try {
      console.log(new Date().toISOString(), await runOnce(env, http, Date.now(), id))
    } catch (e) {
      console.log(new Date().toISOString(), 'ROUND FAILED:', e instanceof Error ? e.message : String(e))
    }
    await new Promise((r) => setTimeout(r, env.everyMin * 60_000))
  }
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('bridge.mjs')) void main()
