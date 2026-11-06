// Sign-off checklists for FACILITY (build G7). Written for this farm in plain words; the steps follow the
// farm's own weekly routine and set points (steam hold 4 h once the coldest core is at 93 C, Monday cook,
// Tuesday knock). They are a working draft: Joseph edits the wording in this file or tells the next build.

export interface CheckStep {
  id: string
  text: string
  /** One short line of why, shown under the step. */
  why?: string
}

export interface CheckTemplate {
  key: string
  title: string
  /** How often it should be signed off, in days. null = only when the event happens. */
  every: number | null
  /** One line on when to use it. */
  when: string
  steps: CheckStep[]
}

export const CHECKLISTS: CheckTemplate[] = [
  {
    key: 'lab',
    title: 'LAB CLEAN-DOWN',
    every: 7,
    when: 'Once a week, and after any contaminated plate or bag is opened in the lab.',
    steps: [
      { id: 'out', text: 'Bag and carry out all waste, plates and spent grain before you wipe anything.', why: 'Wiping around old waste only moves spores.' },
      { id: 'hepa', text: 'HEPA units running at least 30 minutes before you start. Pressure reading is positive.' },
      { id: 'top', text: 'Wipe the hood or flow-hood work surface and its sides with alcohol, top to bottom, back to front.' },
      { id: 'bench', text: 'Wipe benches, shelves and the fridge handle with sanitiser. Let it dry, do not towel it off.' },
      { id: 'floor', text: 'Mop the lab floor with sanitiser, working away from the door. Do not sweep dry.' },
      { id: 'door', text: 'Wipe door handles, light switches, the pass-through and the sink taps.' },
      { id: 'sink', text: 'Clean the sink and the drain. Empty and refill any foot bath.' },
      { id: 'filters', text: 'Look at the HEPA pre-filters. Wash or change them if they are grey.' },
      { id: 'plates', text: 'Walk the plate shelves: remove anything with green, black or pink on it, still sealed.' },
      { id: 'fridge', text: 'Check the culture fridge reads 1-4 C and nothing leaks or smells.' },
      { id: 'tools', text: 'Restock gloves, alcohol, foil, parafilm and scalpels.' },
      { id: 'log', text: 'Log the clean-down in the CLEANING log for the lab.' },
    ],
  },
  {
    key: 'cook',
    title: 'STEAM RUN (SUBSTRATE COOK)',
    every: 7,
    when: 'Every Monday cook, from loading the cart to the cooled blocks leaving the steam box.',
    steps: [
      { id: 'power', text: 'Power plan checked: heater, MegaChefs and 75X are NOT running at the same time. Not in an ICE peak window.', why: 'Heavy loads together can trip the 200 A main.' },
      { id: 'water', text: 'Steam generator water level and filter checked. Descale date not overdue.' },
      { id: 'mix', text: 'Substrate mixed to target moisture. Write the batch recipe in the COOK LOG.' },
      { id: 'bag', text: 'All bags filled, weighed, filter patch showing, bag tops folded or closed.' },
      { id: 'load', text: 'Cart loaded with space for steam to move between bags. Bag count entered.' },
      { id: 'probes', text: 'Temperature probes placed in the coldest bags (centre, lowest, furthest from the steam inlet).' },
      { id: 'door', text: 'Steam box door sealed. Drain open for the purge, then closed.' },
      { id: 'hold', text: 'Hold timer started only when the coldest core reached 93 C. Hold is 4 hours.', why: 'The timer starts at the coldest core, not at the air temperature.' },
      { id: 'read', text: 'Readings logged in PROPULSION for every probe, every 15-30 minutes.' },
      { id: 'cool', text: 'Cool-down started with filtered air only. Door opened only after the cool-down air is running.' },
      { id: 'core', text: 'Core temperature recorded before bags leave the box.' },
      { id: 'clean', text: 'Floor and cart wiped. Steam box left to dry with the door ajar.' },
      { id: 'sign', text: 'Run closed in the COOK LOG with the outcome.' },
    ],
  },
  {
    key: 'knock',
    title: 'KNOCK DAY (INOCULATION)',
    every: 7,
    when: 'Every Tuesday, when spawn goes into the cooled blocks.',
    steps: [
      { id: 'cool', text: 'Blocks cooled to your inoculation limit. Core temperature checked and written down.' },
      { id: 'clean', text: 'Room wiped down and surfaces sanitised. Only people who need to be in the room are in it.' },
      { id: 'spawn', text: 'Spawn checked: right strain, no off smell, no green or black, G2 jar dates inside their limit.' },
      { id: 'rate', text: 'Spawn rate weighed for the first bag, then used by the same scoop for the rest.' },
      { id: 'label', text: 'Every bag labelled with the species letter and the knock date (lot code).' },
      { id: 'seal', text: 'Bags sealed. A few pressed to check for leaks.' },
      { id: 'lots', text: 'Lots entered in MISSION CONTROL with bag count, room and spawn source.' },
      { id: 'move', text: 'Bags carried to incubation on clean carts. Spare blocks counted.' },
      { id: 'waste', text: 'Spent spawn jars and scraps bagged and taken out.' },
      { id: 'log', text: 'Anything odd (damp bags, torn filters, warm cores) written in the lot notes.' },
    ],
  },
  {
    key: 'power',
    title: 'POWER CUT RESPONSE',
    every: null,
    when: 'When the grid goes out. Tick as you go; sign off after power is back.',
    steps: [
      { id: 'log', text: 'Press POWER WENT OUT in the POWER CUTS log so the start time is recorded.', why: 'The log works out the hours without power from this time.' },
      { id: 'stop', text: 'Switch the heavy loads off at the panel: steam heater, MegaChefs, 75X, packing air conditioners.' },
      { id: 'gen', text: 'Generator started outside, away from doors and intakes. Interlock moved over. Log GENERATOR STARTED.', why: 'Never run it inside or near an air intake.' },
      { id: 'list', text: 'Only the emergency circuits are on: lab HEPA, culture fridge, cold rooms, fruiting fans. No heater and AC together.' },
      { id: 'doors', text: 'Cold-room and fridge doors kept shut. Fruiting and incubation doors kept shut to hold temperature.' },
      { id: 'temps', text: 'Room temperatures written down at the start and every hour.' },
      { id: 'fuel', text: 'Fuel checked every 2 hours. Refuel only with the generator stopped and cool.' },
      { id: 'back', text: 'Power back: wait 5 minutes for the grid to be stable, then switch back, stop the generator and log POWER IS BACK.' },
      { id: 'start', text: 'Heavy loads restarted one at a time, not all at once.' },
      { id: 'check', text: 'Rooms, fridge and lab pressure checked. Anything lost or at risk is written in the cut log.' },
    ],
  },
]

export const CHECKLIST = (key: string): CheckTemplate | undefined => CHECKLISTS.find((c) => c.key === key)
