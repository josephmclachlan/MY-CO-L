// Rooms for the DECK PLAN. Layout from Joseph's room list of 8 Nov 2026:
// the lab + packing container runs north-south (lab north, packing south); the
// cook room is a 20 ft standard container right against the lab end of it; the
// two insulated 40 ft containers are stacked off the packing end, incubation
// the LOWER one and fruiting the UPPER one. The plan draws the upper container
// lifted up and to the right (dashed corner lines) so both levels show.
// Scale: 46 plan units per metre (40 ft = 12.19 m = 560, 20 ft = 6.06 m = 279,
// container width 2.44 m = 112). Set points come from the HVAC plan and farm notes.

import type { RoomId } from './power'

export interface SetPoint {
  label: string
  value: string
}

/** A room "goes dark" when every circuit in one of these groups is off. */
export interface Critical {
  ids: string[]
  text: string
}

export interface Room {
  id: RoomId
  name: string
  short: string
  /** What the electrical package calls it. */
  alt?: string
  /** Room naming waits on Joseph. */
  nameGuess: boolean
  /** Outline in plan units (viewBox 0 0 1000 640). */
  rect: { x: number; y: number; w: number; h: number }
  /** Where the name sits, if not the centre. */
  label?: { x: number; y: number }
  setPoints: SetPoint[]
  critical: Critical[]
}

export const ROOMS: Room[] = [
  {
    id: 'lab',
    name: 'LAB',
    short: 'LAB',
    alt: '40 FT LAB / PACKING CONTAINER, NORTH END',
    nameGuess: false,
    rect: { x: 60, y: 40, w: 112, h: 280 },
    label: { x: 116, y: 215 },
    setPoints: [
      { label: 'AIR', value: '18-19 C' },
      { label: 'PRESSURE', value: 'POSITIVE TO PACKING, HEPA' },
      { label: 'RETURN', value: 'ABOUT 20% BELOW SUPPLY' },
      { label: 'CHEST FRIDGE', value: '1-4 C' },
    ],
    critical: [{ ids: ['s4'], text: 'HEPA UNITS OFF. LAB NOT POSITIVE.' }],
  },
  {
    id: 'packing',
    name: 'PACKING',
    short: 'PACK',
    alt: '40 FT LAB / PACKING CONTAINER, SOUTH END. MATERIAL STORE',
    nameGuess: false,
    rect: { x: 60, y: 320, w: 112, h: 280 },
    label: { x: 116, y: 500 },
    setPoints: [
      { label: 'PLENUM AIR', value: '12-14 C' },
      { label: 'RH', value: 'DO NOT HUMIDIFY' },
      { label: 'CO2', value: 'AT OR BELOW ~450 PPM' },
      { label: 'INTAKE', value: 'CLOUDLINE S10 ON THE CO2 METER' },
      { label: 'STORE', value: 'SOY, SAWDUST, GRAIN, FRUIT BAGS. KEEP DRY' },
    ],
    critical: [
      { ids: ['c34', 'c56'], text: 'PACKING AC OFF. FRUITING SUPPLY WILL WARM.' },
      { ids: ['s8'], text: 'FRESH-AIR INTAKE OFF. CO2 WILL BUILD.' },
    ],
  },
  {
    id: 'boiling',
    name: 'COOK ROOM',
    short: 'COOK',
    alt: '20 FT STANDARD CONTAINER, AGAINST THE LAB END',
    nameGuess: false,
    rect: { x: 172, y: 40, w: 112, h: 279 },
    label: { x: 228, y: 282 },
    setPoints: [
      { label: 'STEAM CORE', value: '93 C' },
      { label: 'HOLD', value: '4 H ONCE THE COLDEST CORE PASSES 93 C' },
      { label: 'CYCLE', value: 'WEEKLY, 16-18 H' },
      { label: 'BOILER', value: '2 X 4,500 W ELEMENTS, STAGED' },
      { label: 'AIR', value: 'OWN EXTRACTOR, KEPT APART' },
    ],
    critical: [],
  },
  {
    id: 'incubation',
    name: 'INCUBATION',
    short: 'INCU',
    alt: 'LOWER 40 FT INSULATED CONTAINER',
    nameGuess: false,
    rect: { x: 172, y: 488, w: 560, h: 112 },
    label: { x: 210, y: 548 },
    setPoints: [
      { label: 'AIR', value: '~18 C' },
      { label: 'BLOCK CORES', value: 'AT OR BELOW 21-22 C' },
      { label: 'CO2 EXHAUST', value: 'CLOUDLINE S4, ON AT 3,000 PPM' },
      { label: 'FRESH AIR', value: 'NONE. SLIGHTLY NEGATIVE TO PACKING' },
      { label: 'ALARM', value: '21 C AIR' },
    ],
    critical: [
      { ids: ['c78', 'c910'], text: 'INCUBATION AC OFF. BLOCKS WILL HEAT.' },
      { ids: ['s9'], text: 'INCUBATION AIR OFF. CO2 WILL BUILD.' },
    ],
  },
  {
    id: 'fruiting',
    name: 'FRUITING',
    short: 'FRUIT',
    alt: 'UPPER 40 FT INSULATED CONTAINER, ON TOP OF INCUBATION',
    nameGuess: false,
    rect: { x: 212, y: 350, w: 560, h: 112 },
    label: { x: 708, y: 404 },
    setPoints: [
      { label: 'AIR', value: '16 C (14-17, MAX 18)' },
      { label: 'RH', value: '80-90%' },
      { label: 'CO2 EXHAUST', value: '2 S8 ON THE CO2 METER, ON 900 / OFF 600 PPM' },
      { label: 'TEMP AIR', value: '2 HURRICANE 8" ON THE INKBIRD' },
      { label: 'PRESSURE', value: 'SLIGHTLY NEGATIVE, SEALED FROM PACKING' },
      { label: 'ALARM', value: '19 C AIR, HIGH RH' },
    ],
    critical: [
      { ids: ['s1'], text: 'CO2 EXHAUST OFF. CO2 WILL BUILD.' },
      { ids: ['s2'], text: 'TEMPERATURE FANS OFF. ROOM WILL WARM.' },
      { ids: ['s3'], text: 'FOGGER OFF. RH WILL DROP.' },
    ],
  },
]

export const roomById = (id: RoomId) => ROOMS.find((r) => r.id === id)

/** Critical groups that are fully off right now. */
export function roomAlarms(room: Room, on: Set<string>): string[] {
  return room.critical.filter((c) => c.ids.every((i) => !on.has(i))).map((c) => c.text)
}
