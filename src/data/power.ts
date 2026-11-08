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
  panel: 'main' | 'sub'
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
  meterA: 125, // ICE meter, unchanged. The working ceiling.
  feeder: '3/0 AWG AL',
  feederLengthM: 115, // owner measured 110-115 m; 115 used (conservative)
  feederCmil: 167_800,
  feederAmpacity75C: 155,
  mainBreakerA: 200,
  nominalV: 240,
  kAluminum: 21.2, // ohm-cmil/ft
  subFeedA: 60, // sub-panel feed, 60 A 2-pole (ckt 19-20)
  label: 'ACOMETIDA 3/0 AL - MAX. 150 A',
} as const

/** min(meter 125, cable 155, breaker 200) = 125 A per leg. */
export const CEILING_A = Math.min(SERVICE.meterA, SERVICE.feederAmpacity75C, SERVICE.mainBreakerA)

/** Amber above this share of the limit, red above 100%. */
export const NEAR_LIMIT = 0.85

// ---------------------------------------------------------------- generator

export const GENERATOR = {
  model: 'DUROMAX XP15000HX',
  running: { gasoline: 12_000, propane: 11_400 } as Record<Fuel, number>,
  starting: { gasoline: 15_000, propane: 14_250 } as Record<Fuel, number>,
  outlet: 'NEMA 14-50R',
  connection: 'MAIN-PANEL INTERLOCK // 50 A 2-POLE // CS6364 INLET',
}

export interface GenPreset {
  id: string
  name: string
  gasoline: number
  propane: number
}

export const GEN_PRESETS: GenPreset[] = [
  { id: 'duromax', name: 'XP15000HX (OWNED)', gasoline: 12000, propane: 11400 },
  { id: 'g9500', name: 'MID DUAL-FUEL', gasoline: 9500, propane: 9025 },
  { id: 'g7500', name: 'SMALL DUAL-FUEL', gasoline: 7500, propane: 7125 },
  { id: 'g5500', name: 'PORTABLE 5500', gasoline: 5500, propane: 5225 },
  { id: 'g4000', name: 'COMPACT 4000', gasoline: 4000, propane: 3800 },
  { id: 'g3500', name: 'INVERTER 3500', gasoline: 3500, propane: 3325 },
]

export const GEN_MIN_W = 1000
export const GEN_MAX_W = 20000

// ---------------------------------------------------------------- heater

export const HEATER_OPTIONS: Record<HeaterOption, { label: string; short: string; steamLph: number; elements: { id: string; tag: string; w: number; breaker: string; wire: string; name: string }[] }> = {
  '2x4500': {
    label: '2 x 4,500 W ELEMENTS (STAGEABLE)',
    short: '2 x 4.5 KW',
    steamLph: 14,
    elements: [
      { id: 'c12', tag: '1-2', w: 4500, breaker: '30 A 2-POLE', wire: '#10 CU', name: 'HEATER ELEMENT 1 (PID STAGE 1)' },
      { id: 'c12b', tag: '3-4', w: 4500, breaker: '30 A 2-POLE', wire: '#10 CU', name: 'HEATER ELEMENT 2 (STAGE 2, SHED ON GENERATOR)' },
    ],
  },
  '6500': {
    label: '1 x 6,500 W ELEMENT (SINGLE STAGE)',
    short: '1 x 6.5 KW',
    steamLph: 10,
    elements: [{ id: 'c12', tag: '1-2', w: 6500, breaker: '40 A 2-POLE', wire: '#8 CU', name: 'HEATER ELEMENT 6,500 W' }],
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

export const MAIN: Circuit[] = [
  {
    id: 'c34', tag: '5-6', panel: 'main', leg: 'B', v: 240, breaker: '40 A 2-POLE', wire: '#8 CU', cls: 'base', em: false,
    name: 'LENNOX 36K BTU MINI-SPLIT #1 (PACKING)', short: 'LENNOX 36K #1',
    note: 'Inverter. 3,600 W = 15 A typical cooling on the Lennox 36k submittal; it can peak near 24 A. 40 A breaker (Joseph, 8 Nov 2026), so #8 wire and a 40 A voltage protector.',
    items: [it('lennox36a', 'Lennox 36k BTU mini-split #1', 1, 3600, 'packing')],
  },
  {
    id: 'c56', tag: '7-8', panel: 'main', leg: 'B', v: 240, breaker: '40 A 2-POLE', wire: '#8 CU', cls: 'base', em: false,
    name: 'LENNOX 36K BTU MINI-SPLIT #2 (PACKING)', short: 'LENNOX 36K #2',
    note: 'Same as #1. Stagger compressor starts.',
    items: [it('lennox36b', 'Lennox 36k BTU mini-split #2', 1, 3600, 'packing')],
  },
  {
    id: 'c78', tag: '9-10', panel: 'main', leg: 'B', v: 240, breaker: '15 A 2-POLE', wire: '#12 CU', cls: 'base', em: false,
    name: 'LENNOX 12K BTU MINI-SPLIT #1 (INCUBATION)', short: 'LENNOX 12K #1',
    note: 'Indoor 37A88, outdoor 379A1. Lennox 12k submittals list 3.7 A typical (about 850 W), 6.3 A max and a 15 A max breaker. 1,000 W kept as the running figure.',
    items: [it('lennox12a', 'Lennox 12k BTU mini-split #1 (37A88 / 379A1)', 1, 1000, 'incubation')],
  },
  {
    id: 'c910', tag: '11-12', panel: 'main', leg: 'B', v: 240, breaker: '15 A 2-POLE', wire: '#12 CU', cls: 'base', em: false,
    name: 'LENNOX 12K BTU MINI-SPLIT #2 (INCUBATION)', short: 'LENNOX 12K #2',
    note: 'Same as #1.',
    items: [it('lennox12b', 'Lennox 12k BTU mini-split #2 (37A88 / 379A1)', 1, 1000, 'incubation')],
  },
  {
    id: 'm1', tag: '13', panel: 'main', leg: 'L1', v: 120, breaker: '20 A 1-POLE', wire: '#12 CU', cls: 'int', em: false,
    name: 'MEGACHEF 12 QT PRESSURE COOKER 1', short: 'MEGACHEF 1',
    note: '1,600 W / 120 V (was 1,200 W). The four MegaChefs run together as one batch.',
    items: [it('mega1', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)],
  },
  {
    id: 'm2', tag: '14', panel: 'main', leg: 'L2', v: 120, breaker: '20 A 1-POLE', wire: '#12 CU', cls: 'int', em: false,
    name: 'MEGACHEF 12 QT PRESSURE COOKER 2', short: 'MEGACHEF 2', note: 'Runs with the other three.',
    items: [it('mega2', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)],
  },
  {
    id: 'm3', tag: '15', panel: 'main', leg: 'L1', v: 120, breaker: '20 A 1-POLE', wire: '#12 CU', cls: 'int', em: false,
    name: 'MEGACHEF 12 QT PRESSURE COOKER 3', short: 'MEGACHEF 3', note: 'Runs with the other three.',
    items: [it('mega3', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)],
  },
  {
    id: 'm4', tag: '16', panel: 'main', leg: 'L2', v: 120, breaker: '20 A 1-POLE', wire: '#12 CU', cls: 'int', em: false,
    name: 'MEGACHEF 12 QT PRESSURE COOKER 4', short: 'MEGACHEF 4', note: 'Runs with the other three.',
    items: [it('mega4', 'MegaChef 12 qt pressure cooker', 1, 1600, 'boiling', false)],
  },
  {
    id: 'x75', tag: '17', panel: 'main', leg: 'L1', v: 120, breaker: '20 A 1-POLE', wire: '#12 CU', cls: 'int', em: false,
    name: 'ALL AMERICAN 75X ELECTRIC STERILIZER', short: '75X STERILIZER',
    note: '1,650 W / 13.75 A nameplate, 60 min timer. Never runs with the MegaChefs or the steam heater. The one load that unbalances the legs (+13.8 A on L1).',
    items: [it('aa75x', 'All American 75X electric sterilizer (110 V, timer)', 1, 1650, 'lab', false)],
  },
  {
    id: 'pump', tag: '18', panel: 'main', leg: 'L2', v: 120, breaker: '20 A 1-POLE', wire: '#12 CU', cls: 'int', em: false,
    name: 'CREST WAVE WATER PUMP 7 GPM / 70 PSI', short: 'WATER PUMP',
    note: 'In packing beside the Thor. Runs whenever the bagger runs; switching one switches both. 600 W is an estimate (5 A class).',
    items: [it('pump', 'CrestWave fresh-water pump 7 GPM / 70 PSI', 1, 600, 'packing')],
  },
]

export const SUB: Circuit[] = [
  {
    id: 's1', tag: 'S1', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'FRUITING CO2 EXHAUST: CO2 METER + 2 CLOUDLINE S8', short: 'FRUIT CO2 FANS', note: 'S8 180 W max each (AC Infinity spec, 2.3 A; about 78 W average). The fans plug into the meter.',
    items: [
      it('co2-fruit', 'CO2 meter (fruiting exhaust)', 1, 3.4, 'fruiting'),
      it('s8', 'AC Infinity Cloudline S8 (CO2 exhaust)', 2, 360, 'fruiting', false),
    ],
  },
  {
    id: 's2', tag: 'S2', panel: 'sub', leg: 'L2', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'FRUITING TEMPERATURE AIR: INKBIRD + 2 HURRICANE 8"', short: 'FRUIT TEMP FANS', note: 'Hurricane 198 W / 1.7 A each (Hydrofarm spec sheet). The fans plug into the Inkbird.',
    items: [
      it('inkbird', 'Inkbird temperature controller', 1, 2, 'fruiting'),
      it('hurricane', 'Hurricane 8" inline fan (temperature air)', 2, 396, 'fruiting', false),
    ],
  },
  {
    id: 's3', tag: 'S3', panel: 'sub', leg: 'L1', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'TAC MISTING XL FOGGER', short: 'FOGGER', note: '380 W. Own circuit, apart from the CO2 meters.',
    items: [it('tac', 'TAC Misting XL ultrasonic fogger', 1, 380, 'fruiting', false)],
  },
  {
    id: 's4', tag: 'S4', panel: 'sub', leg: 'L2', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'base', em: false,
    name: '3 CRI HEPA FAN FILTER UNITS 2X4', short: 'HEPA FFU x3', note: '208 W each, a 2x4 FFU class figure (was 150 W). Two over the back-left table, one in the wall. Read the CRI label.',
    items: [it('ffu', 'CRI 2x4 HEPA fan filter unit', 3, 624, 'lab')],
  },
  {
    id: 's5', tag: 'S5', panel: 'sub', leg: 'L1', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: false,
    name: '7 SYLVANIA 2X18 W LED FIXTURES', short: 'WORK LIGHTS', note: 'Sylvania 705 ECO-48, two 18 W LED tubes = 36 W each.',
    items: [
      it('led-inc', 'Sylvania 705 ECO-48 2x18 W LED fixture', 3, 108, 'incubation', false),
      it('led-pack', 'Sylvania 705 ECO-48 2x18 W LED fixture', 2, 72, 'packing', false),
      it('led-lab', 'Sylvania 705 ECO-48 2x18 W LED fixture', 2, 72, 'lab', false),
    ],
  },
  {
    id: 's6', tag: 'S6', panel: 'sub', leg: 'L2', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'LAB CHEST FRIDGE', short: 'CHEST FRIDGE', note: 'Small chest fridge, 150 W (est). Compressor: voltage protector with a delay.',
    items: [it('chest', 'Small chest fridge (cultures)', 1, 150, 'lab')],
  },
  {
    id: 's7', tag: 'S7', panel: 'sub', leg: 'L1', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: false,
    name: '16 ACTIVE GROW T5 4 FT LED LAMPS', short: 'FRUITING LIGHTS', note: '25 W each (Active Grow T5 HO spec sheet), about 12 h a day.',
    items: [it('t5', 'Active Grow T5 4 ft mushroom LED', 16, 400, 'fruiting', false)],
  },
  {
    id: 's8', tag: 'S8', panel: 'sub', leg: 'L2', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'PACKING CO2 INTAKE: CO2 METER + CLOUDLINE S10', short: 'PACK CO2 FAN', note: 'S10 255 W max (2.7 A). The fan plugs into the meter.',
    items: [
      it('co2-pack', 'CO2 meter (packing intake)', 1, 3.3, 'packing'),
      it('s10', 'AC Infinity Cloudline S10 (fresh-air intake)', 1, 255, 'packing', false),
    ],
  },
  {
    id: 's9', tag: 'S9', panel: 'sub', leg: 'L1', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'INCUBATION AIR: CO2 METER + CLOUDLINE S4 + 4 FLOOR FANS', short: 'INCU AIR', note: 'S4 28 W max; floor fans 60 W each (est).',
    items: [
      it('co2-inc', 'CO2 meter (incubation exhaust)', 1, 3.3, 'incubation'),
      it('s4-inc', 'AC Infinity Cloudline S4 (CO2 exhaust)', 1, 28, 'incubation', false),
      it('floorfan', 'Rotating floor fan', 4, 240, 'incubation'),
    ],
  },
  {
    id: 's10', tag: 'S10', panel: 'sub', leg: 'L2', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'base', em: false,
    name: 'LAB BENCH: 4 STIR PLATES + CLOUDLINE S4', short: 'LAB BENCH', note: 'Stir plates (no heat) about 25 W each (est); S4 28 W max.',
    items: [
      it('stir', 'Magnetic stir plate (no heat)', 4, 100, 'lab'),
      it('s4-lab', 'AC Infinity Cloudline S4 (lab air)', 1, 28, 'lab', false),
    ],
  },
  {
    id: 'bag', tag: 'S11', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'int', em: false,
    name: 'THOR BAGGER', short: 'BAGGER', note: 'Weekly bag run in packing. 110 V; the maker publishes no wattage, so 600 W is kept as a safe figure.',
    items: [it('thor', 'Thor bagger', 1, 600, 'packing')],
  },
  {
    id: 'zvs', tag: 'S12', panel: 'sub', leg: 'L2', v: 120, breaker: '15 A', wire: '#12 CU', cls: 'int', em: false,
    name: '12 V ZVS INDUCTION STERILIZER', short: 'ZVS STERILIZER', note: 'ZVS boards draw up to 20 A at 12 V (240 W), about 280 W from the wall with the power supply. Read the supply label. Bench use, seconds at a time.',
    items: [it('zvs', '12 V ZVS induction loop sterilizer + power supply', 1, 280, 'lab')],
  },
  {
    id: 'o1', tag: 'S13', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'out', em: false,
    name: 'LAB GENERAL OUTLETS (4)', short: 'LAB OUTLETS', note: 'Receptacles, no fixed load.', items: [],
  },
  {
    id: 'o2', tag: 'S14', panel: 'sub', leg: 'L2', v: 120, breaker: '20 A GFCI', wire: '#12 CU', cls: 'out', em: false,
    name: 'OUTDOOR OUTLETS (4)', short: 'OUTDOOR GFCI', note: 'Receptacles, no fixed load.', items: [],
  },
  {
    id: 'o3', tag: 'S15', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A GFCI', wire: '#12 CU', cls: 'out', em: false,
    name: 'INCUBATION CONTAINER GFCI (2)', short: 'INCUBATION GFCI', note: 'Receptacles, no fixed load.', items: [],
  },
  {
    id: 'o4', tag: 'S16', panel: 'sub', leg: 'L2', v: 120, breaker: '20 A GFCI', wire: '#12 CU', cls: 'out', em: false,
    name: 'LAB / PACKING CONTAINER GFCI (2)', short: 'LAB GFCI', note: 'Receptacles, no fixed load.', items: [],
  },
  {
    id: 'o5', tag: 'S17', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A GFCI', wire: '#12 CU', cls: 'out', em: false,
    name: 'FRUITING CONTAINER GFCI (2)', short: 'FRUITING GFCI', note: 'Receptacles, no fixed load.', items: [],
  },
  {
    id: 'o6', tag: 'S18', panel: 'sub', leg: 'L2', v: 120, breaker: '20 A GFCI', wire: '#12 CU', cls: 'out', em: false,
    name: 'COOK ROOM GFCI (2)', short: 'COOK GFCI', note: 'Receptacles in the 20 ft cook container, no fixed load.', items: [],
  },
  {
    id: 'f1', tag: 'S19', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'FOGEL 3-DOOR REACH-IN FRIDGE 1', short: 'FOGEL 1', note: 'Outdoors under the roof, against the fruiting wall left of the back door. Compressor, 800 W (est). Outdoor-rated voltage protector with a delay.',
    items: [it('fogel1', 'Fogel commercial 3-door reach-in fridge 1', 1, 800, 'outside')],
  },
  {
    id: 'f2', tag: 'S20', panel: 'sub', leg: 'L2', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'base', em: true,
    name: 'FOGEL 3-DOOR REACH-IN FRIDGE 2', short: 'FOGEL 2', note: 'Beside fridge 1. Start 5-10 s after fridge 1.',
    items: [it('fogel2', 'Fogel commercial 3-door reach-in fridge 2', 1, 800, 'outside')],
  },
  {
    id: 'seal', tag: 'S21', panel: 'sub', leg: 'L1', v: 120, breaker: '20 A', wire: '#12 CU', cls: 'int', em: false,
    name: 'AIE-405HIM 16" IMPULSE SEALER', short: 'IMPULSE SEALER', note: 'In the lab. About 800 W (est); draws only for seconds per seal.',
    items: [it('sealer', 'AIE-405HIM 16" hand impulse sealer', 1, 800, 'lab')],
  },
]

/** Which room each receptacle circuit serves (they have no items to carry a room). */
export const OUTLET_ROOM: Record<string, RoomId> = { o1: 'lab', o2: 'outside', o3: 'incubation', o4: 'lab', o5: 'fruiting', o6: 'boiling' }

/** The heater circuits for an option, in the same shape as the others. */
export function heaterCircuits(opt: HeaterOption): Circuit[] {
  return HEATER_OPTIONS[opt].elements.map((e) => ({
    id: e.id,
    tag: e.tag,
    panel: 'main' as const,
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
  return [...heaterCircuits(opt), ...MAIN, ...SUB]
}

// ---------------------------------------------------------------- groups and links

/** Continuous loads: S1-S10, the two Fogels and the four mini-splits. */
export const BASE = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 'f1', 'f2', 'c34', 'c56', 'c78', 'c910']
/** Generator emergency list: fruiting fans, fogger, chest fridge, packing CO2 intake, incubation air, Fogels. */
export const EMERG = ['s1', 's2', 's3', 's6', 's8', 's9', 'f1', 'f2']
export const MEGACHEFS = ['m1', 'm2', 'm3', 'm4']
export const HEATER_IDS = ['c12', 'c12b']
export const AC_IDS = ['c34', 'c56', 'c78', 'c910']
/** Compressor loads, for the stagger-starts reminder. */
export const COMPRESSORS = ['c34', 'c56', 'c78', 'c910', 's6', 'f1', 'f2']
/** Switching one of these switches the other. */
export const LINKED: Record<string, string> = { bag: 'pump', pump: 'bag' }

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
  { key: 'bag', label: '+ BAGGER & PUMP', source: 'utility', on: [...BASE, 'bag', 'pump'] },
  { key: 'labbench', label: '+ 75X, ZVS & SEALER', source: 'utility', on: [...BASE, 'x75', 'zvs', 'seal'] },
  { key: 'bad', label: 'HEATER + MEGACHEFS', source: 'utility', danger: true, on: [...BASE, 'heatAll', ...MEGACHEFS] },
  { key: 'all', label: 'EVERYTHING ON', source: 'utility', danger: true, on: ['everything'] },
  { key: 'goff', label: 'ALL OFF', source: 'generator', on: [] },
  { key: 'emerg', label: 'EMERGENCY LIST', source: 'generator', on: [...EMERG] },
  { key: 'gclim', label: '+ 36K', source: 'generator', on: [...EMERG, 'c34'] },
  { key: 'gboth', label: '+ 36K + 12K', source: 'generator', on: [...EMERG, 'c34', 'c78'] },
  { key: 'gboil', label: '+ HEATER (1 ELEMENT)', label6: '+ 6.5 KW HEATER', source: 'generator', on: [...EMERG, 'heatOne'] },
  { key: 'gboilall', label: '+ BOTH ELEMENTS', source: 'generator', only: '2x4500', danger: true, on: [...EMERG, 'heatAll'] },
  { key: 'gbag', label: '+ BAGGER & PUMP', source: 'generator', on: [...EMERG, 'bag', 'pump'] },
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
