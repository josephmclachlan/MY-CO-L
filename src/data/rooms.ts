// Rooms for the DECK PLAN. Layout traced from Joseph's own floor plan
// (knowledge/01-core-knowledge/farm-designs/joseph-floor-plan.png): container 1
// (lab + packing) runs north-south, incubation and fruiting butt onto its long
// side, and the boiling room sits beside the lab end.
// Names follow the farm notes. The electrical package calls the same three
// containers the lab container, the grow room (sealed reefer) and fruiting.
// Set points come from the HVAC plan and farm notes (5 Nov 2026).

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
    alt: 'LAB CONTAINER (CONTAINER 1, NORTH END)',
    nameGuess: false,
    rect: { x: 60, y: 30, w: 130, h: 300 },
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
    alt: 'LAB CONTAINER (CONTAINER 1, SOUTH END). PLENUM FOR FRUITING',
    nameGuess: true,
    rect: { x: 60, y: 330, w: 130, h: 290 },
    label: { x: 96, y: 500 },
    setPoints: [
      { label: 'PLENUM AIR', value: '12-14 C' },
      { label: 'RH', value: 'DO NOT HUMIDIFY' },
      { label: 'CO2', value: 'AT OR BELOW ~450 PPM' },
      { label: 'INTAKE', value: 'RUNS WITH FRUITING EXHAUSTS' },
      { label: 'COLD ROOMS', value: '1-4 C' },
    ],
    critical: [
      { ids: ['c34', 'c56'], text: 'PLENUM AC OFF. FRUITING SUPPLY WILL WARM.' },
      { ids: ['s1', 's2'], text: 'BOTH COLD ROOMS OFF.' },
    ],
  },
  {
    id: 'boiling',
    name: 'BOILING ROOM',
    short: 'BOIL',
    nameGuess: true,
    rect: { x: 190, y: 90, w: 230, h: 250 },
    setPoints: [
      { label: 'STEAM CORE', value: '93 C' },
      { label: 'HOLD', value: 'NOT SETTLED: 2 H VS 4-6 H' },
      { label: 'CYCLE', value: 'WEEKLY, 16-18 H' },
      { label: 'AIR', value: 'OWN EXTRACTOR, KEPT APART' },
    ],
    critical: [],
  },
  {
    id: 'incubation',
    name: 'INCUBATION',
    short: 'INCU',
    alt: 'GROW ROOM (SEALED REEFER)',
    nameGuess: true,
    rect: { x: 190, y: 380, w: 560, h: 120 },
    setPoints: [
      { label: 'AIR', value: '~18 C' },
      { label: 'BLOCK CORES', value: 'AT OR BELOW 21-22 C' },
      { label: 'CO2 EXHAUST', value: 'ON AT 3,000 PPM' },
      { label: 'FRESH AIR', value: 'NONE. SLIGHTLY NEGATIVE TO PACKING' },
      { label: 'ALARM', value: '21 C AIR' },
    ],
    critical: [{ ids: ['c78', 'c910'], text: 'INCUBATION AC OFF. BLOCKS WILL HEAT.' }],
  },
  {
    id: 'fruiting',
    name: 'FRUITING',
    short: 'FRUIT',
    alt: 'FRUITING CONTAINER',
    nameGuess: false,
    rect: { x: 190, y: 500, w: 560, h: 120 },
    setPoints: [
      { label: 'AIR', value: '16 C (14-17, MAX 18)' },
      { label: 'RH', value: '80-90%' },
      { label: 'CO2 EXHAUST', value: 'ON 900 / OFF 600 PPM' },
      { label: 'PRESSURE', value: 'SLIGHTLY NEGATIVE, SEALED FROM PACKING' },
      { label: 'ALARM', value: '19 C AIR, HIGH RH' },
    ],
    critical: [{ ids: ['s3'], text: 'EXTRACTION OFF. CO2 WILL BUILD.' }],
  },
]

export const roomById = (id: RoomId) => ROOMS.find((r) => r.id === id)

/** Critical groups that are fully off right now. */
export function roomAlarms(room: Room, on: Set<string>): string[] {
  return room.critical.filter((c) => c.ids.every((i) => !on.has(i))).map((c) => c.text)
}
