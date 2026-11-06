// Feed adapters for CLIMATE SENSORS (build G8). The seam where live sensor data will plug in after construction.
//
// Each adapter says how its maker's data can be reached, where it has to run, and what it needs.
// Nothing here holds a key. A live feed should run on a small always-on "bridge" (the self-host PC in build G13),
// never in this web page: the page is public, a key in it would be readable by anyone, and a phone that is
// asleep polls nothing. The bridge writes readings straight into the database; the app just shows them.
//
// The parts that can be tested without hardware are pure functions: build the request, read the answer.

import { MEASURES, fToC, type Measure, type PlaceId, type Sensor } from './sensors'

/** What a feed hands back: a reading for one sensor at one moment. */
export interface FeedReading {
  sensor_id: string
  place: PlaceId
  ms: number
  temp_c: number | null
  rh: number | null
  co2_ppm: number | null
}

export interface HttpRequest {
  url: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}
export interface HttpAnswer {
  status: number
  json: unknown
  headers?: Record<string, string>
}
/** The bridge passes its own fetch; tests pass a fake one. */
export type Fetcher = (r: HttpRequest) => Promise<HttpAnswer>

export interface FeedResult {
  readings: FeedReading[]
  /** Plain-English problems, one per sensor or call that failed. */
  problems: string[]
}

export type Route = 'CLOUD' | 'LOCAL RADIO' | 'LOCAL NETWORK' | 'FILE' | 'TEST' | 'NONE YET'
export interface FeedAdapter {
  id: string
  vendor: string
  label: string
  route: Route
  /** Where it has to run. */
  runs: 'BRIDGE' | 'THIS APP'
  /** What Joseph has to supply. Left blank until after construction. */
  needs: string[]
  /** Built and tested here (true), or written up only. */
  built: boolean
  /** Short verdict from the research (6 Nov 2026). */
  verdict: string
  /** Details, one line each. */
  notes: string[]
}

// ==========================================================================================
// GOVEE CLOUD (official developer API, version 2)
// ==========================================================================================

export const GOVEE_BASE = 'https://openapi.api.govee.com/router/api/v1'

/** Device list. One key per Govee account (asked for in the Govee Home app: Profile > Settings > Apply for API Key). */
export function goveeDevicesRequest(key: string): HttpRequest {
  return { url: `${GOVEE_BASE}/user/devices`, method: 'GET', headers: { 'Govee-API-Key': key, 'Content-Type': 'application/json' } }
}

/** One device's current state. sku = model (H5179), device = the id from the device list. */
export function goveeStateRequest(key: string, sku: string, device: string, requestId: string): HttpRequest {
  return {
    url: `${GOVEE_BASE}/device/state`,
    method: 'POST',
    headers: { 'Govee-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, payload: { sku, device } }),
  }
}

export interface GoveeDevice {
  sku: string
  device: string
  name: string
  type: string
  /** It lists temperature, humidity or CO2 among its properties. */
  sensor: boolean
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Read the device list. Unknown shapes give an empty list rather than an error. */
export function parseGoveeDevices(json: unknown): GoveeDevice[] {
  const data = arr(obj(json).data)
  return data.map((d) => {
    const o = obj(d)
    const caps = arr(o.capabilities).map((c) => String(obj(c).instance ?? ''))
    return {
      sku: String(o.sku ?? ''),
      device: String(o.device ?? ''),
      name: String(o.deviceName ?? o.sku ?? ''),
      type: String(o.type ?? ''),
      sensor: caps.some((c) => /^sensor(Temperature|Humidity)$|carbonDioxide/i.test(c)) || /thermometer|sensor/i.test(String(o.type ?? '')),
    }
  }).filter((d) => d.sku && d.device)
}

export interface GoveeState {
  online: boolean | null
  temp: number | null
  rh: number | null
  co2: number | null
}
/**
 * Read one device's state. Govee's own sample for a sensor:
 * capabilities [{instance:'online', state:{value:true}}, {instance:'sensorTemperature', state:{value:79.52}},
 * {instance:'sensorHumidity', state:{value:61.2}}, {instance:'carbonDioxideConcentration', state:{value:1590}}].
 */
export function parseGoveeState(json: unknown): GoveeState | null {
  const o = obj(json)
  if (Number(o.code) !== 200) return null
  const caps = arr(obj(o.payload).capabilities)
  const val = (inst: string): unknown => {
    const c = caps.find((x) => obj(x).instance === inst)
    if (!c) return undefined
    const v = obj(obj(c).state).value
    // Some firmware wraps the number: {currentTemperature: 25.1}
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).find((x) => typeof x === 'number')
    return v
  }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
  const on = val('online')
  return { online: typeof on === 'boolean' ? on : null, temp: n(val('sensorTemperature')), rh: n(val('sensorHumidity')), co2: n(val('carbonDioxideConcentration')) }
}

const okRange = (m: Measure, v: number | null) => {
  const d = MEASURES.find((x) => x.id === m)!
  return v !== null && v >= d.lo && v <= d.hi ? v : null
}

/**
 * Ask Govee for every active Govee sensor that has a model and device id. Runs on the bridge.
 * Govee limits: 10,000 calls a day per account; a sensor every 10 minutes is 144 calls a day each.
 * A device reported offline is skipped: Govee says its numbers are then old and "have no reference significance".
 */
export async function pollGovee(key: string, sensors: Sensor[], unit: 'F' | 'C', fetcher: Fetcher, now: number, newId: () => string): Promise<FeedResult> {
  const res: FeedResult = { readings: [], problems: [] }
  if (!key.trim()) return { readings: [], problems: ['NO GOVEE API KEY SET.'] }
  const list = sensors.filter((s) => s.active && s.vendor === 'govee' && s.model && s.device_id)
  for (const s of list) {
    let a: HttpAnswer
    try {
      a = await fetcher(goveeStateRequest(key, s.model as string, s.device_id as string, newId()))
    } catch (e) {
      res.problems.push(`${s.name}: NO ANSWER FROM GOVEE (${e instanceof Error ? e.message : String(e)}).`)
      continue
    }
    if (a.status === 429) {
      res.problems.push(`${s.name}: GOVEE SAYS TOO MANY CALLS. TRY AGAIN LATER.`)
      continue
    }
    if (a.status === 401 || a.status === 403) {
      res.problems.push('GOVEE REFUSED THE API KEY.')
      break
    }
    if (a.status !== 200) {
      res.problems.push(`${s.name}: GOVEE ANSWERED ${a.status}.`)
      continue
    }
    const st = parseGoveeState(a.json)
    if (!st) {
      res.problems.push(`${s.name}: GOVEE'S ANSWER WAS NOT READABLE.`)
      continue
    }
    if (st.online === false) {
      res.problems.push(`${s.name}: OFFLINE IN GOVEE (BATTERY, WI-FI OR GATEWAY).`)
      continue
    }
    const temp = st.temp === null ? null : okRange('temp', unit === 'F' ? fToC(st.temp) : st.temp)
    const rh = okRange('rh', st.rh)
    const co2 = st.co2 === null ? null : okRange('co2', Math.round(st.co2))
    if (temp === null && rh === null && co2 === null) {
      res.problems.push(`${s.name}: GOVEE SENT NO VALUES.`)
      continue
    }
    res.readings.push({ sensor_id: s.id, place: s.place, ms: Math.floor(now / 60000) * 60000, temp_c: s.measures.includes('temp') ? temp : null, rh: s.measures.includes('rh') ? rh : null, co2_ppm: s.measures.includes('co2') ? co2 : null })
  }
  return res
}

// ==========================================================================================
// GOVEE BLUETOOTH (no cloud, no internet): the sensors broadcast their readings every few seconds
// ==========================================================================================

/**
 * Decode the broadcast of the H5072 / H5075 / H5101 / H5102 family (manufacturer data, company id 0xEC88).
 * Bytes 1-3 hold one number: temperature x 10,000 + humidity x 10 (top bit set = below zero). Byte 4 = battery %.
 * This is the layout used by the open-source decoders; check it against the first real sensor.
 * Returns null when the bytes do not fit.
 */
export function decodeGoveeBle(bytes: number[]): { temp_c: number; rh: number; battery: number } | null {
  if (bytes.length < 5 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null
  let v = (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
  let neg = false
  if (v & 0x800000) {
    neg = true
    v &= 0x7fffff
  }
  const temp = Math.floor(v / 1000) / 10
  const rh = (v % 1000) / 10
  if (rh > 100) return null
  return { temp_c: neg ? -temp : temp, rh, battery: bytes[4] }
}

// ==========================================================================================
// The adapters, with what the research found (6 Nov 2026)
// ==========================================================================================

export const FEEDS: FeedAdapter[] = [
  {
    id: 'govee-cloud',
    vendor: 'GOVEE',
    label: 'GOVEE CLOUD (DEVELOPER API)',
    route: 'CLOUD',
    runs: 'BRIDGE',
    needs: ['GOVEE API KEY (FREE, FROM THE GOVEE HOME APP)', 'EACH SENSOR\'S MODEL AND DEVICE ID (FROM THE DEVICE LIST CALL)', 'WI-FI SENSORS, OR A GOVEE WI-FI GATEWAY FOR BLUETOOTH-ONLY ONES'],
    built: true,
    verdict: 'WORKS FOR WI-FI SENSORS. BUILT AND TESTED AGAINST GOVEE\'S OWN SAMPLE ANSWER. NEEDS THE INTERNET.',
    notes: [
      'GOVEE\'S OFFICIAL API (VERSION 2) GIVES A SENSOR\'S LATEST TEMPERATURE, HUMIDITY AND, ON CO2 MODELS (H5140), CO2.',
      'WI-FI MODELS (E.G. H5179) REPORT DIRECTLY. BLUETOOTH-ONLY MODELS (E.G. H5075, H5100) NEED A GOVEE WI-FI GATEWAY (H5151) TO REACH THE CLOUD; SOME OWNERS REPORT GATEWAY SENSORS ANSWERING WITH ERRORS, SO TEST ONE BEFORE BUYING MANY.',
      'LIMITS: 10,000 CALLS A DAY PER ACCOUNT AND 30 A MINUTE PER DEVICE. ONE SENSOR EVERY 10 MINUTES = 144 A DAY, SO 40+ SENSORS FIT.',
      'THE CLOUD VALUE ONLY UPDATES EVERY FEW MINUTES (OWNERS REPORT ABOUT 10). FINE FOR ROOMS, SLOW FOR A FAST ALARM.',
      'IF THE INTERNET IS DOWN AT THE FARM, NOTHING ARRIVES. THE APP THEN RAISES ALL SENSORS SILENT.',
      'THE KEY MUST NOT GO IN THIS WEB PAGE (IT IS PUBLIC). IT GOES ON THE BRIDGE.',
    ],
  },
  {
    id: 'govee-ble',
    vendor: 'GOVEE',
    label: 'GOVEE BLUETOOTH (LOCAL, NO INTERNET)',
    route: 'LOCAL RADIO',
    runs: 'BRIDGE',
    needs: ['THE BRIDGE PC WITH BLUETOOTH, WITHIN ~10-20 M OF THE SENSORS (OR A SMALL ESP32 RELAY PER CONTAINER)', 'EACH SENSOR\'S BLUETOOTH ADDRESS'],
    built: true,
    verdict: 'BEST ROUTE FOR THE FARM: WORKS WITH NO INTERNET AND UPDATES EVERY FEW SECONDS. DECODER BUILT; THE RADIO PART IS FOR G13.',
    notes: [
      'GOVEE THERMO-HYGROMETERS BROADCAST THEIR READING OVER BLUETOOTH ALL THE TIME. A NEARBY COMPUTER CAN LISTEN WITHOUT PAIRING, WITHOUT THE CLOUD AND WITHOUT A KEY.',
      'HOME ASSISTANT DOES THIS OUT OF THE BOX (GOVEE BLUETOOTH INTEGRATION), SO THE G13 SELF-HOST PC CAN RUN IT AND PASS READINGS ON.',
      'STEEL SHIPPING CONTAINERS BLOCK RADIO: PLAN ONE SMALL BLUETOOTH RELAY (ESP32, ABOUT US$10) INSIDE EACH CONTAINER, OR A PC IN THE MIDDLE OF THE SITE.',
      'KEEPS RUNNING THROUGH A POWER CUT IF THE BRIDGE AND RELAYS ARE ON THE UPS OR THE GENERATOR LIST.',
      'THE DECODER HERE COVERS THE H5072/H5075/H5101/H5102 FAMILY. OTHER MODELS (H5179, H5074) USE OTHER LAYOUTS; HOME ASSISTANT KNOWS THEM.',
    ],
  },
  {
    id: 'lennox',
    vendor: 'LENNOX',
    label: 'LENNOX MINI-SPLITS',
    route: 'NONE YET',
    runs: 'BRIDGE',
    needs: ['THE MODEL NUMBER ON EACH INDOOR UNIT\'S STICKER, AND WHICH PHONE APP IT USES'],
    built: false,
    verdict: 'NO USABLE FEED FOUND YET. LOG THE AIR CONDITIONERS BY HAND (AC UNITS). THE ROUTE DEPENDS ON THE MODEL.',
    notes: [
      'LENNOX HAS NO PUBLIC API FOR ITS MINI-SPLITS.',
      'NEWER LENNOX MINI-SPLITS "POWERED BY SAMSUNG" JOIN THE LENNOX HOME APP THROUGH SAMSUNG SMARTTHINGS. SMARTTHINGS HAS A REAL API (CLOUD, NEEDS A ONE-TIME SIGN-IN; ITS SIMPLE TOKENS NOW EXPIRE AFTER 24 HOURS, SO THE BRIDGE NEEDS THE PROPER SIGN-IN FLOW). THIS IS THE MOST LIKELY ROUTE IF THE UNITS ARE THIS KIND.',
      'OLDER "LENNOX GLOBAL" WI-FI MINI-SPLITS USE THE LENNOX GLOBAL APP. NO API OR LOCAL ROUTE WAS FOUND FOR IT.',
      'THE OPEN-SOURCE LENNOX HOME ASSISTANT ADD-ON (LENNOXS30) ONLY COVERS DUCTED SYSTEMS WITH S30/S40/E30/M30 THERMOSTATS, NOT MINI-SPLITS.',
      'FALLBACK THAT ALWAYS WORKS: A GOVEE SENSOR IN THE AIR LEAVING EACH UNIT. IF THAT AIR IS NOT COLD, THE UNIT IS NOT COOLING. AN INFRARED BLASTER (BROADLINK) CAN ALSO SEND REMOTE COMMANDS BUT CANNOT READ THE UNIT.',
    ],
  },
  {
    id: 'csv',
    vendor: 'ANY',
    label: 'CSV FILE (GOVEE APP EXPORT)',
    route: 'FILE',
    runs: 'THIS APP',
    needs: ['THE EXPORTED FILE FROM THE GOVEE HOME APP (DEVICE > DATA > EXPORT)'],
    built: true,
    verdict: 'WORKS NOW. GOVEE SENSORS KEEP WEEKS OF HISTORY THAT THE APP CAN EXPORT, EVEN WITHOUT WI-FI.',
    notes: ['USE IMPORT CSV. DUPLICATES (SAME SENSOR, SAME MINUTE) ARE SKIPPED, SO THE SAME FILE CAN BE IMPORTED TWICE SAFELY.'],
  },
  {
    id: 'mock',
    vendor: 'TEST',
    label: 'MOCK FEED',
    route: 'TEST',
    runs: 'THIS APP',
    needs: [],
    built: true,
    verdict: 'MADE-UP READINGS TO TRY THE SCREENS AND ALARMS BEFORE THE SENSORS ARRIVE.',
    notes: ['USE MOCK TEST. EVERYTHING IT MAKES IS MARKED MOCK AND IS REMOVED WITH ONE BUTTON.'],
  },
]

/** Telegram message to a chat (for the bridge). The bot token is the bridge's secret, never stored in the app. */
export function telegramRequest(token: string, chatId: string, text: string): HttpRequest {
  return { url: `https://api.telegram.org/bot${token}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }) }
}

export const ALARM_ROUTES = [
  { id: 'app', label: 'IN THE APP', ready: true, text: 'THE ALARM SHOWS ON THE MAIN MENU STATUS BOARD, IN REMINDERS, AND AS A PHONE ALERT WHILE THE APP IS OPEN (TURN ON IN FACILITY LOGS > REMINDERS).' },
  { id: 'whatsapp-copy', label: 'WHATSAPP (COPY)', ready: true, text: 'COPY ALARM TEXT ON ALARMS, THEN PASTE IT INTO WHATSAPP.' },
  { id: 'telegram', label: 'TELEGRAM (BRIDGE)', ready: false, text: 'FREE AND RELIABLE: A TELEGRAM BOT SENDS EACH NEW ALARM TO YOUR PHONE EVEN WHEN THE APP IS CLOSED. NEEDS THE BRIDGE (G13) AND A BOT TOKEN. MESSAGE FORMAT IS BUILT.' },
  { id: 'whatsapp-auto', label: 'WHATSAPP (AUTOMATIC)', ready: false, text: 'POSSIBLE BUT HARDER: META\'S WHATSAPP BUSINESS API NEEDS A BUSINESS ACCOUNT AND APPROVED MESSAGE TEMPLATES. TELEGRAM IS SIMPLER FOR ALARMS.' },
]
