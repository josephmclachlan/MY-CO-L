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
      { id: 'machines', text: 'Mixer and Thor bagger (packing) emptied and cleaned of old wet mix after bagging.', why: 'Old wet mix in machines is the danger, more than the floor {F09-0001}.' },
      { id: 'mix', text: 'Substrate mixed to target moisture. Write the batch recipe in the COOK LOG.' },
      { id: 'bag', text: 'All bags filled, weighed, filter patch showing, bag tops folded or closed.' },
      { id: 'load', text: 'Cart loaded with space for steam to move between bags. Bag count entered.' },
      { id: 'probes', text: 'Temperature probes placed in the coldest bags (centre, lowest, furthest from the steam inlet).' },
      { id: 'door', text: 'Steam box door sealed. Drain open for the purge, then closed.' },
      { id: 'hold', text: 'Hold timer started only when the coldest core reached 93 C. Hold is 4 hours.', why: 'The timer starts at the coldest core, not at the air temperature.' },
      { id: 'read', text: 'Readings logged in PROPULSION for every probe, every 15-30 minutes.' },
      { id: 'cool', text: 'Cart unloaded within 3 hours of the end of the hold and rolled into the lab to cool on wire racks in front of the HEPA. Not cooled in the box.', why: 'Catawba and Cap n Stem both pull blocks out hot into HEPA air {F24-0043, F07-0147}.' },
      { id: 'core', text: 'Core temperature recorded when the bags leave the box.' },
      { id: 'blow', text: 'Steam generator blown down at the low-point valve.', why: 'Regular blowdowns matter as much as water treatment {F08-0301}.' },
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
      { id: 'cool', text: 'Block cores below 32 C, never above 38 C. Checked with the infrared thermometer and written down.', why: 'Even 27 C can be too warm for some spawn (Catawba) {F07-0144, F08-0206, F24-0043}.' },
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
    key: 'fruit',
    title: 'FRUITING ROOM FULL CLEAN',
    every: 7,
    when: 'Once a week, and between loads. The room also gets a daily spot clean and floor (CLEANING log, every day).',
    steps: [
      { id: 'pull', text: 'Pull any block showing condensation, blotch or mould and bag it out first.', why: 'Catawba advice: pull them at once, before they spread.' },
      { id: 'humid', text: 'Humidifier off. Tank drained and scrubbed if it is due.' },
      { id: 'scrub', text: 'Scrub top to bottom: ceiling, walls, racks, then the floor last, working toward the exhaust.', why: 'In a hot climate, scrub top to bottom every week {F12-8006}.' },
      { id: 'spray', text: 'Spray with 250 ppm bleach. Use the other cleaning agent this week if you used bleach last week.', why: 'Rotate cleaning agents {F02-0229, F12-0108}.' },
      { id: 'fans', text: 'Exhaust fans and intake filters looked at and running.' },
      { id: 'traps', text: 'Sticky traps checked; gaps still taped and screens in place.' },
      { id: 'log', text: 'Log the full clean in the CLEANING log for fruiting.' },
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
      { id: 'list', text: 'Only the emergency circuits are on: cold rooms (S1, S2), fruiting fans (S3), lab HEPA (S4), fogger + culture fridge (S6), controls (S8). No heater and AC together.' },
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
