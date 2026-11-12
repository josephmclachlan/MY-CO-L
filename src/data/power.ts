// The farm's electrical model: service, generator, heater options and every
// breaker. Ported from Joseph's electrical package (status 4 Nov 2026):
// calculations/project_data.py and app/facility-power-panel.html. Those two
// files agree exactly, and the test in src/lib/power.test.ts checks this file
// against data/operating_scenarios.csv from the same package (30 rows).
//
// To change a wattage when a nameplate arrives (for example the Lennox outdoor
// units), edit `w` on the item below. The VITALS screen can also override any
// estimated wattage on this device without touching the code.

export type Leg = 'L1' | 'L2' | 'B' // B = 240 V, draws equally from L1 and L2
export type LoadClass = 'base' | 'int' | 'out' // continuous, intermittent, receptacle only
export type RoomId = 'lab' | 'packing' | 'incubation' | 'fruiting' | 'boiling' | 'outside'
export type HeaterOption = '2x4500' | '6500'
export type Fuel = 'propane' | 'gasoline'
export type Source = 'utility' | 'generator'

/** One piece of equipment on a circuit. A circuit's watts are the sum of its items. */
export interface Item {
  id: string
  name: string
  qty: number
  /** Watts for this line (all `qty` units together). */
  w: number
  room: RoomId
  /** Wattage is an estimate (no nameplate yet). Estimates can be edited on screen. */
  est: boolean
  /** Which room it sits in is our guess, not confirmed by Joseph yet. (All confirmed 8 Nov 2026.) */
  roomGuess?: boolean
}

export interface Circuit {
  id: string
  tag: string
  leg: Leg
  v: 120 | 240
  breaker: string
  wire: string
  cls: LoadClass
  /** On the generator emergency list. */
  em: boolean
  name: string
  short: string
  note: string
  items: Item[]
}

// ---------------------------------------------------------------- service

export const SERVICE = {
  meterA: 200, // ICE street meter, now 200 A (Joseph, 8 Nov 2026). Was 125 A.
  feeder: '3/0 AWG AL',
  feederLengthM: 115, // owner measured 110-115 m; 115 used (conservative)
  feederCmil: 167_800,
  feederAmpacity75C: 155,
  mainBreakerA: 200,
  nominalV: 240,
  kAluminum: 21.2, // ohm-cmil/ft
  label: 'ACOMETIDA 3/0 AL - MAX. 150 A',
} as const

/** min(meter 200, cable 155, breaker 200) = 155 A per leg: the 3/0 Al feeder is now the limit. */
export const CEILING_A = Math.min(SERVICE.meterA, SERVICE.feederAmpacity75C, SERVICE.mainBreakerA)

/** Amber above this share of the limit, red above 100%. */
export const NEAR_LIMIT = 0.85

// ---------------------------------------------------------------- generator

/**
 * Joseph's generator: DuroMax XP17500HX dual fuel (planned 9 Nov 2026).
 * Maker's spec table: gasoline 13,750 W running / 17,500 W starting,
 * propane 13,000 W running / 16,500 W starting. Outlets: 2 x 14-50R,
 * 1 x L14-30R, 4 x GFCI 5-20R.
 *
 * It feeds the SAME breaker box as the ICE service (Joseph, 12 Nov 2026):
 * one 50 A cord from a 14-50R into an inlet, then a 50 A 2-pole generator
 * breaker in the box, interlocked with the box's main so the two can never
 * be on together. One cord caps each leg at 50 A, whatever the generator
 * itself could give.
 */
export const GENERATOR = {
  model: 'DUROMAX XP17500HX',
  running: { gasoline: 13_750, propane: 13_000 } as Record<Fuel, number>,
  starting: { gasoline: 17_500, propane: 16_500 } as Record<Fuel, number>,
  outlet: 'NEMA 14-50R',
  cordA: 50,
  connection: '50 A CORD > INLET > 50 A 2-POLE GENERATOR BREAKER IN THE SAME BOX, INTERLOCKED WITH THE MAIN',
}

// ---------------------------------------------------------------- heater

export const HEATER_OPTIONS: Record<HeaterOption, { label: string; short: string; steamLph: number; elements: { id: string; tag: string; w: number; breaker: string; wire: string; name: string }[] }> = {
  '2x4500': {
    label: '2 x 4,500 W ELEMENTS (STAGEABLE)',
    short: '2 x 4.5 KW',
    steamLph: 14,
    elements: [
      { id: 'c12', tag: '29-31', w: 4500, breaker: '30 A 2-POLE', wire: '#10 CU', name: 'HEATER ELEMENT 1 (PID STAGE 1)' },
      { id: 'c12b', tag: '30-32', w: 4500, breaker: '30 A 2-POLE', wire: '#10 CU', name: 'HEATER ELEMENT 2 (STAGE 2, SHED ON GENERATOR)' },
    ],
  },
  '6500': {
    label: '1 x 6,500 W ELEMENT (SINGLE STAGE)',
    short: '1 x 6.5 KW',
    steamLph: 10,
    elements: [{ id: 'c12', tag: '29-31', w: 6500, breaker: '40 A 2-POLE', wire: '#8 CU', name: 'HEATER ELEMENT 6,500 W' }],
  },
}

// ---------------------------------------------------------------- circuits
// Equipment and rooms from Joseph's room-by-room list, 8 Nov 2026. Watts were
// re-checked against maker spec sheets that day (see the 8 Nov revision box in
// knowledge/electrical-project/01_PROJECT_BRIEF.md). `est` marks the figures
// that are still a class estimate, not a nameplate or spec sheet.
// Follow-up the same day: the 2 Fogel "cold rooms" are commercial 3-door
// reach-in fridges outdoors under a roof, against the fruiting container's
// long wall left of its back door; the CrestWave pump sits in packing by the
// Thor; the impulse sealer is in the lab. The BactiZapper is replaced by the
// ZVS induction sterilizer. The 36k units are on 40 A breakers.

const it = (id: string, name: string, qty: number, w: number, room: RoomId, est = true, roomGuess = false): Item => ({
  id,
  name,
  qty,
  w,
  room,
  est,
  roomGuess,
})

// The breaker box as the electrician wired it (Joseph's slot list, 8 Nov 2026).
// One square box on the outside back wall behind incubation; no sub-panel.
// The generator feeds this same box (Joseph, 12 Nov 2026).
// Tags are the slot numbers. Leg follows the standard split-phase layout:
// slots 1-2 on L1, 3-4 on L2, and so on by row (row = slot / 2 rounded up,
// odd rows L1). Two loads can share one breaker (slots 5 and 9); they are
// listed apart so the board can show what runs all the time and what is used
// only now and then, but flipping the real breaker cuts both.
const b = (id: string, tag: string, leg: Leg, cls: LoadClass, em: boolean, name: string, short: string, note: string, items: Item[], breaker = '20 A 1-POLE', wire = '#12 CU'): Circuit => ({
  id, tag, leg, v: 120, breaker, wire, cls, em, name, short, note, items,
})
const SIZE_NOTE = ' Breaker size not given yet; 20 A assumed.'

/** Every breaker in the one box, slots 1-28 (the heater is 29-32, below). */
export const BOX: Circuit[] = [
  b('m1', '1', 'L1', 'int', false, 'MEGACHEF 12 QT PRESSURE COOKER 1', 'MEGACHEF 1', '1,600 W / 120 V = 13.3 A. The four MegaChefs run together as one batch.', [it('mega1', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)]),
  b('s5', '2', 'L1', 'base', false, '7 SYLVANIA 2X18 W LED FIXTURES (ALL LIGHTS BUT THE ACTIVEGROWS)', 'WORK LIGHTS', 'Sylvania 705 ECO-48, two 18 W tubes = 36 W each: 3 incubation, 2 packing, 2 lab.' + SIZE_NOTE, [
    it('led-inc', 'Sylvania 705 ECO-48 2x18 W LED fixture', 3, 108, 'incubation', false),
    it('led-pack', 'Sylvania 705 ECO-48 2x18 W LED fixture', 2, 72, 'packing', false),
    it('led-lab', 'Sylvania 705 ECO-48 2x18 W LED fixture', 2, 72, 'lab', false),
  ]),
  b('s4', '3', 'L2', 'base', true, '2 CRI HEPA FAN FILTER UNITS (BACK-LEFT TABLE)', 'LAB FFU x2', '208 W each, a 2x4 FFU class figure. Read the CRI label.' + SIZE_NOTE, [it('ffu', 'CRI 2x4 HEPA fan filter unit', 2, 416, 'lab')]),
  b('s6', '4', 'L2', 'base', true, 'LAB CHEST FRIDGE', 'CHEST FRIDGE', 'Small chest fridge, 150 W (est). Compressor: voltage protector with a delay.' + SIZE_NOTE, [it('chest', 'Small chest fridge (cultures)', 1, 150, 'lab')]),
  b('stir', '5', 'L1', 'base', false, 'LAB OUTLET: 4 STIR PLATES', 'STIR PLATES', 'Shares breaker 5 with the ZVS sterilizer. Stir plates (no heat) about 25 W each (est).' + SIZE_NOTE, [it('stir', 'Magnetic stir plate (no heat)', 4, 100, 'lab')]),
  b('zvs', '5', 'L1', 'int', false, 'LAB OUTLET: 12 V ZVS INDUCTION STERILIZER', 'ZVS STERILIZER', 'Shares breaker 5 with the stir plates. About 280 W from the wall (est). Bench use, seconds at a time.', [it('zvs', '12 V ZVS induction loop sterilizer + power supply', 1, 280, 'lab')]),
  b('seal', '6', 'L1', 'int', false, 'AIE-405HIM 16" IMPULSE SEALER', 'IMPULSE SEALER', 'In the lab. About 800 W (est); draws only for seconds per seal.' + SIZE_NOTE, [it('sealer', 'AIE-405HIM 16" hand impulse sealer', 1, 800, 'lab')]),
  b('s1', '7', 'L2', 'base', true, 'FRONT FANS + S10: 2 CLOUDLINE S8, S10, PACKING + INCUBATION CO2 METERS, INKBIRD, TAC FOGGER', 'CLIMATE LINE', 'Joseph, 8 Nov 2026: the 2 S8s, the S10, the packing and incubation CO2 meters, the Inkbird and the TAC fogger are all on breaker 7. About 1,000 W = 8.4 A. One trip stops the fruiting exhaust, the packing intake and the fogger together.' + SIZE_NOTE, [
    it('s8', 'AC Infinity Cloudline S8 (fruiting front fans, on the Inkbird)', 2, 360, 'fruiting', false),
    it('s10', 'AC Infinity Cloudline S10 (packing fresh-air intake)', 1, 255, 'packing', false),
    it('co2-pack', 'CO2 meter (packing intake)', 1, 3.3, 'packing'),
    it('co2-inc', 'CO2 meter (incubation)', 1, 3.3, 'incubation'),
    it('inkbird', 'Inkbird temperature controller', 1, 2, 'fruiting'),
    it('tac', 'TAC Misting XL ultrasonic fogger', 1, 380, 'fruiting', false),
  ]),
  b('lab4', '8', 'L2', 'base', false, 'LAB CLOUDLINE S4', 'LAB S4 FAN', 'S4 28 W max.' + SIZE_NOTE, [it('s4-lab', 'AC Infinity Cloudline S4 (lab air)', 1, 28, 'lab', false)]),
  b('bag', '9', 'L1', 'int', false, 'THOR BAGGER + CRESTWAVE PUMP', 'BAGGER + PUMP', 'Shares breaker 9 with the wall FFU. Bagger 600 W and pump 600 W (both est) run together on bag day: 10 A, plus the FFU 1.7 A.' + SIZE_NOTE, [
    it('thor', 'Thor bagger', 1, 600, 'packing'),
    it('pump', 'CrestWave fresh-water pump 7 GPM / 70 PSI', 1, 600, 'packing'),
  ]),
  b('ffuw', '9', 'L1', 'base', true, 'CRI HEPA FAN FILTER UNIT IN THE LAB / PACKING WALL', 'WALL FFU', 'Shares breaker 9 with the bagger and pump. If the bagger trips breaker 9, this HEPA unit stops too.', [it('ffu-wall', 'CRI 2x4 HEPA fan filter unit (in the wall)', 1, 208, 'lab')]),
  b('m2', '10', 'L1', 'int', false, 'MEGACHEF 12 QT PRESSURE COOKER 2', 'MEGACHEF 2', 'Runs with the other three. Slot 10 is on L1, the same leg as MegaChefs 1 and 3.', [it('mega2', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)]),
  b('s9', '11', 'L2', 'base', true, 'INCUBATION FLOOR FANS (4)', 'INCU FLOOR FANS', 'Rotating floor fans, 60 W each (est).' + SIZE_NOTE, [it('floorfan', 'Rotating floor fan', 4, 240, 'incubation')]),
  b('s2', '12', 'L2', 'base', true, 'FRUITING BACK FANS: 2 HURRICANE 8" + CO2 METER', 'HURRICANES + METER', 'Hurricane 198 W each, plugged into the fruiting CO2 meter (Joseph, 8 Nov 2026).' + SIZE_NOTE, [
    it('hurricane', 'Hurricane 8" inline fan (temperature air)', 2, 396, 'fruiting', false),
    it('co2-fruit', 'CO2 meter (fruiting)', 1, 3.4, 'fruiting'),
  ]),
  b('s7', '13', 'L1', 'base', false, '16 ACTIVE GROW T5 4 FT LED LAMPS', 'FRUITING LIGHTS', '25 W each, about 12 h a day.' + SIZE_NOTE, [it('t5', 'Active Grow T5 4 ft mushroom LED', 16, 400, 'fruiting', false)]),
  b('x75', '14', 'L1', 'int', false, 'ALL AMERICAN 75X ELECTRIC STERILIZER', '75X STERILIZER', '1,650 W / 13.75 A nameplate, 60 min timer. Needs its own 20 A breaker (13.75 A is over the 12 A a 15 A breaker should carry for an hour). Never runs with the MegaChefs or the steam heater.', [it('aa75x', 'All American 75X electric sterilizer (110 V, timer)', 1, 1650, 'lab', false)]),
  b('incs4', '15', 'L2', 'base', true, 'INCUBATION BACK FAN: CLOUDLINE S4', 'INCU S4', 'S4 28 W max. The incubation CO2 meter is on breaker 7.' + SIZE_NOTE, [
    it('s4-inc', 'AC Infinity Cloudline S4 (CO2 exhaust)', 1, 28, 'incubation', false),
  ]),
  b('f1', '16', 'L2', 'base', true, 'LEFT FOGEL 3-DOOR REACH-IN FRIDGE', 'FOGEL LEFT', 'Outdoors under the roof, against the fruiting wall left of the back door. Compressor, 800 W (est). Outdoor-rated voltage protector with a delay.' + SIZE_NOTE, [it('fogel1', 'Fogel commercial 3-door reach-in fridge (left)', 1, 800, 'outside')]),
  b('m3', '17', 'L1', 'int', false, 'MEGACHEF 12 QT PRESSURE COOKER 3', 'MEGACHEF 3', 'Runs with the other three. Slot 17 is on L1 too.', [it('mega3', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)]),
  b('f2', '18', 'L1', 'base', true, 'RIGHT FOGEL 3-DOOR REACH-IN FRIDGE', 'FOGEL RIGHT', 'Beside the left one. Start 5-10 s after it.' + SIZE_NOTE, [it('fogel2', 'Fogel commercial 3-door reach-in fridge (right)', 1, 800, 'outside')]),
  b('m4', '19', 'L2', 'int', false, 'MEGACHEF 12 QT PRESSURE COOKER 4', 'MEGACHEF 4', 'Runs with the other three. The only MegaChef on L2.', [it('mega4', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)]),
  b('o1', '20', 'L2', 'out', false, 'LAB OUTLET', 'LAB OUTLET', 'Receptacle, no fixed load.', []),
  {
    id: 'c78', tag: '21-23', leg: 'B', v: 240, breaker: '15 A 2-POLE', wire: '#12 CU', cls: 'base', em: false,
    name: 'LENNOX 12K BTU MINI-SPLIT #1 (INCUBATION)', short: 'LENNOX 12K #1',
    note: 'Indoor 37A88, outdoor 379A1. Lennox 12k submittals list 3.7 A typical (about 850 W), 6.3 A max and a 15 A max breaker. 1,000 W kept as the running figure.',
    items: [it('lennox12a', 'Lennox 12k BTU mini-split #1 (37A88 / 379A1)', 1, 1000, 'incubation')],
  },
  {
    id: 'c910', tag: '22-24', leg: 'B', v: 240, breaker: '15 A 2-POLE', wire: '#12 CU', cls: 'base', em: false,
    name: 'LENNOX 12K BTU MINI-SPLIT #2 (INCUBATION)', short: 'LENNOX 12K #2',
    note: 'Same as #1.',
    items: [it('lennox12b', 'Lennox 12k BTU mini-split #2 (37A88 / 379A1)', 1, 1000, 'incubation')],
  },
  {
    id: 'c34', tag: '25-27', leg: 'B', v: 240, breaker: '40 A 2-POLE', wire: '#8 CU', cls: 'base', em: false,
    name: 'LENNOX 36K BTU MINI-SPLIT #1 (PACKING)', short: 'LENNOX 36K #1',
    note: 'Inverter. 3,600 W = 15 A typical cooling on the Lennox 36k submittal; it can peak near 24 A. 40 A breaker (Joseph, 8 Nov 2026), so #8 wire and a 40 A voltage protector.',
    items: [it('lennox36a', 'Lennox 36k BTU mini-split #1', 1, 3600, 'packing')],
  },
  {
    id: 'c56', tag: '26-28', leg: 'B', v: 240, breaker: '40 A 2-POLE', wire: '#8 CU', cls: 'base', em: false,
    name: 'LENNOX 36K BTU MINI-SPLIT #2 (PACKING)', short: 'LENNOX 36K #2',
    note: 'Same as #1. Stagger compressor starts.',
    items: [it('lennox36b', 'Lennox 36k BTU mini-split #2', 1, 3600, 'packing')],
  },
]

/** Which room each receptacle circuit serves (they have no items to carry a room). */
export const OUTLET_ROOM: Record<string, RoomId> = { o1: 'lab' }

/** The heater circuits for an option, in the same shape as the others. */
export function heaterCircuits(opt: HeaterOption): Circuit[] {
  return HEATER_OPTIONS[opt].elements.map((e) => ({
    id: e.id,
    tag: e.tag,
    leg: 'B' as const,
    v: 240 as const,
    breaker: e.breaker,
    wire: e.wire,
    cls: 'int' as const,
    em: false,
    name: e.name,
    short: e.id === 'c12b' ? 'HEATER EL. 2' : opt === '6500' ? 'HEATER 6.5 KW' : 'HEATER EL. 1',
    note: 'Steam pasteurization and sterilization, one 16-18 h cycle a week.',
    items: [{ id: `heat-${e.id}`, name: `Steam heater element ${e.w.toLocaleString('en-US')} W`, qty: 1, w: e.w, room: 'boiling' as const, est: false, roomGuess: false }],
  }))
}

export function allCircuits(opt: HeaterOption): Circuit[] {
  return [...heaterCircuits(opt), ...BOX]
}

// ---------------------------------------------------------------- groups and links

/** Continuous loads: every fan, light, fridge and FFU, and the four mini-splits. */
export const BASE = ['s1', 's2', 's4', 's5', 's6', 's7', 's9', 'stir', 'lab4', 'ffuw', 'incs4', 'f1', 'f2', 'c34', 'c56', 'c78', 'c910']
/** Generator emergency list: breakers 3 and 9 (lab HEPA, Joseph 6 Nov 2026), 4, 7 (fans, meters, Inkbird, fogger), 11, 12, 15, 16, 18. */
export const EMERG = ['s1', 's2', 's4', 'ffuw', 's6', 's9', 'incs4', 'f1', 'f2']
export const MEGACHEFS = ['m1', 'm2', 'm3', 'm4']
export const HEATER_IDS = ['c12', 'c12b']
export const AC_IDS = ['c34', 'c56', 'c78', 'c910']
/** Compressor loads, for the stagger-starts reminder. */
export const COMPRESSORS = ['c34', 'c56', 'c78', 'c910', 's6', 'f1', 'f2']
/** Switching one of these switches the other. (The pump is now part of the bagger load on breaker 9.) */
export const LINKED: Record<string, string> = {}

// ---------------------------------------------------------------- ICE tariff

/** ICE peak windows (T-PRO measures demand only here). Costa Rica time. */
export const ICE_PEAKS: { from: string; to: string }[] = [
  { from: '10:00', to: '12:30' },
  { from: '17:30', to: '20:00' },
]
export const TIMEZONE = 'America/Costa_Rica'

// ---------------------------------------------------------------- scenarios

export interface Scenario {
  key: string
  label: string
  /** Label when the 6,500 W heater is chosen. */
  label6?: string
  source: Source
  /** Only shown for this heater option. */
  only?: HeaterOption
  /** A rule-breaking case, drawn in warning colour. */
  danger?: boolean
  /** Breakers that are on. `heatAll` / `heatOne` expand to the heater circuits. */
  on: (string | 'heatAll' | 'heatOne' | 'everything')[]
}

export const SCENARIOS: Scenario[] = [
  { key: 'off', label: 'ALL OFF', source: 'utility', on: [] },
  { key: 'base', label: 'BASELINE', source: 'utility', on: [...BASE] },
  { key: 'heatfull', label: '+ HEATER FULL', label6: '+ 6.5 KW HEATER', source: 'utility', on: [...BASE, 'heatAll'] },
  { key: 'heatstage', label: '+ HEATER STAGED HOLD', source: 'utility', only: '2x4500', on: [...BASE, 'heatOne'] },
  { key: 'mega', label: '+ 4 MEGACHEFS', source: 'utility', on: [...BASE, ...MEGACHEFS] },
  { key: 'x75', label: '+ 75X', source: 'utility', on: [...BASE, 'x75'] },
  { key: 'bag', label: '+ BAGGER & PUMP', source: 'utility', on: [...BASE, 'bag'] },
  { key: 'labbench', label: '+ 75X, ZVS & SEALER', source: 'utility', on: [...BASE, 'x75', 'zvs', 'seal'] },
  { key: 'bad', label: 'HEATER + MEGACHEFS', source: 'utility', danger: true, on: [...BASE, 'heatAll', ...MEGACHEFS] },
  { key: 'all', label: 'EVERYTHING ON', source: 'utility', danger: true, on: ['everything'] },
  { key: 'goff', label: 'ALL OFF', source: 'generator', on: [] },
  { key: 'emerg', label: 'EMERGENCY LIST', source: 'generator', on: [...EMERG] },
  // The plan on one 50 A cord (9 Nov 2026): emergency list plus both incubation 12ks, no steam.
  { key: 'g12s', label: '+ BOTH 12K (THE PLAN)', source: 'generator', on: [...EMERG, 'c78', 'c910'] },
  { key: 'gclim', label: '+ 36K', source: 'generator', on: [...EMERG, 'c34'] },
  { key: 'gboth', label: '+ 36K + 12K', source: 'generator', on: [...EMERG, 'c34', 'c78'] },
  { key: 'gboil', label: '+ HEATER (1 ELEMENT)', label6: '+ 6.5 KW HEATER', source: 'generator', on: [...EMERG, 'heatOne'] },
  { key: 'gboilall', label: '+ BOTH ELEMENTS', source: 'generator', only: '2x4500', danger: true, on: [...EMERG, 'heatAll'] },
  { key: 'gbag', label: '+ BAGGER & PUMP', source: 'generator', on: [...EMERG, 'bag'] },
  { key: 'gmax', label: '+ HEATER + 36K', source: 'generator', danger: true, on: [...EMERG, 'heatOne', 'c34'] },
]

/** The breaker ids a scenario switches on, for a heater option. */
export function scenarioIds(s: Scenario, opt: HeaterOption): string[] {
  const heat = HEATER_OPTIONS[opt].elements.map((e) => e.id)
  const out: string[] = []
  for (const k of s.on) {
    if (k === 'heatAll') out.push(...heat)
    else if (k === 'heatOne') out.push('c12')
    else if (k === 'everything') out.push(...allCircuits(opt).map((c) => c.id))
    else out.push(k)
  }
  return [...new Set(out)]
}
