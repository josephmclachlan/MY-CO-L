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
    when: 'When the grid goes out. One DuroMax XP17500HX on the 50 A cord (50 A a leg). MODE 1 = no cook, MODE 2 = cut during a steam cook. Tick as you go; skip the steps for the mode you are not in, with the reason.',
    steps: [
      { id: 'log', text: 'Press POWER WENT OUT in the POWER CUTS log so the start time is recorded.', why: 'The log works out the hours without power from this time.' },
      { id: 'swaps', text: 'Breakers 7 and 9 swapped, and 15 and 17 swapped (one-time job, done by the electrician). If not, run MODE 1 only: no cook on the generator.', why: 'Without the swaps leg 2 goes over 50 A in MODE 2 and trips the generator breaker.' },
      { id: 'stop', text: 'Switched OFF at the panel: element 2 (30-32), both 36k air conditioners (25-27, 26-28), MegaChefs (1, 10, 17, 19), 75X (14), sealer (6), lab outlets (5, 20), fruiting T5 lights (13). Bagger and pump switched off at the machine.', why: 'None of these may run on the generator. Element 2 on with START pressed puts 37.5 A on each leg by itself.' },
      { id: 'gen', text: 'Generator started outside, away from doors and intakes. Interlock moved over. Log GENERATOR STARTED.', why: 'Never run it inside or near an air intake.' },
      { id: 'list', text: 'Always-on breakers on: 2 lights, 3 lab table FFUs, 4 chest fridge, 7 fan line (S8s, S10, CO2 meters, Inkbird, TAC), 8 lab S4, 9 wall FFU, 11 incubation floor fans, 12 Hurricanes, 15 incubation S4, 16 and 18 both Fogels. About 4.3 kW, 17 / 19 A a leg.' },
      { id: 'mode1', text: 'MODE 1 (no cook): both incubation 12k units on (21-23, 22-24), one at a time. About 25-31 A a leg.', why: 'Incubation holds weeks of blocks and makes the most heat, so its cooling comes first.' },
      { id: 'ac36', text: 'MODE 1, optional: one 36k on ONLY if its remote is set to a power-limit (ECO) mode that keeps it near 15 A. Otherwise both 36k stay off and fruiting runs on fans: pick anything close to ready.', why: 'GUESS until tested with a clamp meter. A 36k at full pull-down takes leg 2 to about 55 A and trips the generator, dropping everything.' },
      { id: 'mode2', text: 'MODE 2 (cut during a cook): ONE 12k on, element 1 (29-31) on, element 2 still off. Water level checked, then START pressed. About 40-44 A a leg.', why: 'The boiler always stays off after a cut until START. One element holds the batch; it climbs about twice as slowly (GUESS).' },
      { id: 'hold2', text: 'MODE 2: once the coldest core is at 93 C and the 4 h hold has started, second 12k on. When the hold ends, element 1 off and back to MODE 1.', why: 'In the hold the element only cycles, so the second 12k fits (peak about 50 A while the element is on).' },
      { id: 'bags', text: 'MODE 2: bags already mixed but not steamed = start on element 1 now. Bags not mixed yet = do not mix until the grid is back. Grain and agar (MegaChefs, 75X) wait for the grid and are re-run in full.', why: 'Mixed substrate ferments while it sits; that is worse than a slow climb. A broken pressure run is not a sterile run.' },
      { id: 'doors', text: 'Fridge doors kept shut, the chest fridge and both Fogels. Fruiting and incubation doors kept shut to hold temperature. No open lab work.' },
      { id: 'temps', text: 'Room temperatures and CO2 written down at the start and every hour.' },
      { id: 'fuel', text: 'Fuel checked every 2 hours. Refuel only with the generator stopped and cool.' },
      { id: 'back', text: 'Power back: wait 5 minutes for the grid to be stable, then switch back, stop the generator and log POWER IS BACK.' },
      { id: 'start', text: 'Heavy loads restarted one at a time: the 36k units first, then element 2 if the cook is still climbing.' },
      { id: 'check', text: 'Rooms, fridges and lab pressure checked. Inkbird set point checked. Any cook, grain or agar run that was cut is written in the cut log and in the COOK LOG.' },
    ],
  },
]

export const CHECKLIST = (key: string): CheckTemplate | undefined => CHECKLISTS.find((c) => c.key === key)
