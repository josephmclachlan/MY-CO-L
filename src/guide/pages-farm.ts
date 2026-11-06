import type { GSection } from './content'

// The growing and daily-work screens.
export const FARM: GSection[] = [
  {
    key: 'MISSION',
    title: 'MISSION CONTROL (12)',
    group: 'DAILY WORK',
    module: 'MISSION',
    what: 'Every block lot on the farm, today\'s jobs, and the harvest log.',
    blocks: [
      {
        h: 'WORDS TO KNOW',
        items: [
          ['BLOCK', 'One bag of substrate with spawn in it. It grows mushrooms.'],
          ['LOT', 'A batch of blocks knocked (inoculated) on the same day. A lot has a code like B1020: a letter for the species, then the month and day.'],
          ['FLUSH', 'One wave of mushrooms from a block. Most species give one or two.'],
          ['STATUS', 'Where the lot is: incubating, fruiting, or spent.'],
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['BOARD', 'Every active lot with its days, blocks, picks and what to do next.'],
          ['TODAY', 'Jobs for today: lots to move to fruiting, lots to pick, orders short of stock, strains slipping.'],
          ['LOG HARVEST', 'Record a pick.'],
          ['NEW BLOCK LOT', 'Record a new lot right after the knock.'],
          ['BULK ACTIONS', 'Harvest session, inoculate a cart, change many lots, split a lot.'],
          ['SCAN A LABEL', 'Read a QR label with the camera, or type the code.'],
          ['GUESSES', 'Numbers the app guessed (move window, number of flushes) for you to check.'],
        ],
      },
      {
        h: 'LOG A HARVEST',
        steps: [
          'Open LOG HARVEST.',
          'Pick the lot (or type its code).',
          'Type the weight in kilograms. The grade starts on A: change it to B or SECONDS if needed. Type the flush number (1 for the first pick of a block).',
          'Add your initials.',
          'Press SAVE HARVEST. The pick shows under RECENT PICKS and feeds PRODUCTION RECORDS, LEDGER and TRADE.',
          'Made a mistake? Press UNDO straight away.',
        ],
      },
      {
        h: 'START A NEW LOT',
        steps: [
          'Open NEW BLOCK LOT after you have inoculated the blocks.',
          'Pick the species and strain, the knock date and how many blocks.',
          'Press LOG BLOCK LOT. The app makes the code. It starts as incubating.',
        ],
      },
      {
        h: 'GOOD TO KNOW',
        text: ['A lot moves to fruiting by itself when you log its first harvest. If a code is already used on that day the app adds -2.', 'Staff can use all of this screen.'],
      },
    ],
  },
  {
    key: 'YIELD',
    title: 'PRODUCTION RECORDS (14)',
    group: 'DAILY WORK',
    module: 'YIELD',
    what: 'How well each lot, strain and room is doing, and strain trials.',
    blocks: [
      {
        h: 'WORDS TO KNOW',
        items: [
          ['BE%', 'Biological efficiency: fresh kilograms picked divided by the dry kilograms of substrate, times 100. A way to compare lots fairly. One 10 lb block holds 4 lb of dry substrate.'],
          ['FLUSH LOG', 'One line per lot and flush.'],
          ['FADING STRAIN', 'A strain whose newest lots yield clearly less than its earlier ones. It may be tired and need replacing from the bank.'],
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['FLUSH LOG', 'BE% for each lot and flush, with the day the first pins appeared.'],
          ['FLUSH TEST', 'Every crop starts in test: lots stay open for up to 4 flushes until you mark them spent. This tab shows what each flush gave (kg per block, share of flush 1, days between flushes) and a suggested count. COMMIT 1-4 sets the count for that species; BACK TO TEST undoes it.'],
          ['SCORECARD', 'Results grouped by strain, cook run, room, week or worker. Pick a grouping at the top.'],
          ['STRAIN TRIALS', 'Put two or more strains side by side and see which wins. START TRIAL begins one.'],
          ['GUESSES', 'The rules the app guessed, for you to check.'],
        ],
      },
      { h: 'GOOD TO KNOW', text: ['Only complete lots (spent, or all committed flushes picked; 4 while a crop is in test) count toward averages. Fading needs at least five finished lots of a strain.'] },
    ],
  },
  {
    key: 'CARGO',
    title: 'CARGO (4)',
    group: 'DAILY WORK',
    module: 'CARGO',
    what: 'The stock list: what you have, what is low, what to reorder.',
    blocks: [
      {
        h: 'HOW STOCK WORKS',
        text: ['There is no typed-in count. What you have is the sum of every move: deliveries add, use subtracts, a count adds or subtracts the difference. That way the history of every item is kept.'],
      },
      {
        h: 'THE LIST',
        items: [
          ['REORDER', 'Items at or under their reorder point, with how many weeks of stock are left.'],
          ['CATEGORY TABS', 'SUBSTRATE, GRAIN AND SPAWN, CULTURE LAB, CLEANING AND PPE, AIR AND WATER.'],
          ['ADD ITEM', 'Add a new item: name, unit and category (OTHER if none fits). Set its reorder point and lead time afterwards on its own page.'],
          ['STOCK TAKE', 'Count a shelf and save all the new numbers at once.'],
          ['EXPORT BACKUP, IMPORT BACKUP', 'Save or load the whole stock list as a file.'],
          ['RESTORE STARTER LIST', 'Put the starter items back.'],
        ],
      },
      {
        h: 'RECEIVE, USE OR COUNT AN ITEM',
        steps: [
          'Tap the item in the list. Its page opens.',
          'Use the block you need: RECEIVE DELIVERY (quantity, price per unit, supplier, then BOOK DELIVERY; PRICE ONLY records a price without changing the count), RECORD USE (BOOK USE) or SET COUNT (SAVE COUNT).',
          'The MOVES list shows what you saved, and UNDO reverses it.',
          'Reorder point and lead time are on the same page under ABOUT THIS ITEM.',
        ],
      },
      {
        h: 'GOOD TO KNOW',
        text: ['Weekly use comes from the production plan (130 bags a week). The substrate mix (60:40, 55:45 or 50:50) changes how much sawdust and soy hulls it needs. Prices are hidden from staff.'],
      },
    ],
  },
  {
    key: 'SEQUENCE',
    title: 'PRODUCTION SEQUENCE (10)',
    group: 'DAILY WORK',
    module: 'SEQUENCE',
    what: 'The planner for this week\'s bag run.',
    blocks: [
      {
        h: 'WHAT IT DOES',
        text: ['You say how many bags and which species. The planner shows how the steam box cart fills, how many bags each species gets, and what stock the run uses.'],
      },
      {
        h: 'MAKE A PLAN',
        steps: [
          'Type the number of bags under BAGS THIS RUN, or tap 130 STANDARD.',
          'Pick SINGLE (one species) or MULTI (a mix) under SUGGESTED RUNS.',
          'For a mix, tick the species under SPECIES IN THIS RUN. The ALLOTMENT list shows each share.',
          'The second slot is a small fixed run (16 bags a week) of one extra species of your pick.',
          'Press INITIATE PRODUCTION SEQUENCE to run the animation of the plan (optional).',
          'Press COMMIT RUN TO CARGO to book the stock out of CARGO. CARGO lists the run and can undo it. If CARGO has no counts yet the stock will show as negative: count it first with STOCK TAKE.',
        ],
      },
    ],
  },
  {
    key: 'FACILITY',
    title: 'FACILITY LOGS (17)',
    group: 'DAILY WORK',
    module: 'FACILITY',
    what: 'Power cuts, water tests, upkeep, cleaning, checklists and reminders.',
    blocks: [
      {
        h: 'THE TABS',
        items: [
          ['STATUS', 'A summary: is the power on, when was water last tested, what is due.'],
          ['POWER CUTS', 'The log of cuts. See below.'],
          ['WATER', 'Water test results against their limits.'],
          ['CHECKLISTS', 'Daily or weekly checklists to sign off.'],
          ['MAINTENANCE', 'The upkeep jobs with their intervals and what is overdue.'],
          ['CLEANING', 'The cleaning log with targets per room.'],
          ['REMINDERS', 'Everything due now or soon. You can snooze or download a phone calendar file.'],
        ],
      },
      {
        h: 'WHEN THE POWER GOES OUT',
        steps: [
          'The moment the grid fails press POWER WENT OUT NOW. Press it on the VITALS screen too: both do the same.',
          'If you start the generator press GENERATOR STARTED NOW. Press GENERATOR STOPPED NOW when it stops. (Before a cut the screen offers GENERATOR TEST STARTED NOW instead, to log a test run.)',
          'When the grid comes back press POWER IS BACK NOW.',
          'Add fuel used, what was affected, and any losses.',
          'If you forgot to press the button, use LOG A PAST CUT and type the start and end times.',
          'The log counts hours with no grid, hours on the generator and hours fully dark for each month.',
        ],
      },
      {
        h: 'GOOD TO KNOW',
        text: ['All times use the farm clock (Costa Rica, UTC-6), the same clock shown in the status line.', 'A cut over 30 days cannot be closed with the button: use EDIT.', 'Limits and intervals are GUESSES until you check them. See the GUESSES tab.'],
      },
    ],
  },
  {
    key: 'SPECIMEN',
    title: 'SPECIMEN FILES (1)',
    group: 'GROW',
    module: 'SPECIMEN',
    what: 'One file per species: how to grow it, with a turning wireframe model.',
    blocks: [
      {
        h: 'HOW TO USE IT',
        steps: [
          'Tap a species in the list (on a phone use the strip at the top).',
          'Read the tabs: OVERVIEW, CULTIVATION, TIMELINE, CLIMATE, YIELD, HAZARDS, NOTES, SOURCES.',
          'Tap WHY? beside a number to see where it came from.',
          'On OVERVIEW the file shows the strains you hold and the contaminants to watch, each tappable.',
        ],
      },
      { h: 'GOOD TO KNOW', text: ['The model turns slowly on purpose. Numbers marked as context come from other conditions than your farm. Where sources differ the standard figure is given first.'] },
    ],
  },
  {
    key: 'XENO',
    title: 'XENOGENETICS (5)',
    group: 'GROW',
    module: 'XENO',
    what: 'Strains, cultures, the culture bank, lineage, the planner and labels.',
    blocks: [
      {
        h: 'WORDS TO KNOW',
        items: [
          ['MASTER (P0)', 'The stored original. It arrived as a slant, a water tube or a plate.'],
          ['P-LEVEL', 'How many steps from the master. A plate made from the master is P1. A plate made from that plate is P2. Slants and tubes carry the level of what they were made from.'],
          ['G1, G2', 'Grain spawn generations: G1 (master grain) is made from a culture, G2 from G1. G2 goes into blocks.'],
          ['SLANT, WATER TUBE', 'The two ways cultures are stored long term here. There is no freezer.'],
          ['STRAIN CODE', 'Two letters for the species and a number: BO-01 blue oyster, LM-01 lion\'s mane.'],
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['STRAINS', 'Every strain you hold. REGISTER adds one.'],
          ['BANK', 'The culture bank: slants and water tubes, due dates, viability checks, T/E tests.'],
          ['STOCK', 'Cultures and grain runs in stock.'],
          ['LINEAGE', 'A strain\'s family tree. Tap a node to log the next step.'],
          ['PLANNER', 'Works back from the weekly bag run to how many G2, G1 and masters you need.'],
          ['LABELS', 'QR labels to print and stick on dishes, bags and tubes.'],
        ],
      },
      {
        h: 'ADD A STRAIN',
        steps: ['Open STRAINS.', 'Pick the species, type the strain code, name and source.', 'Say what it arrived as (the master is P0).', 'Press REGISTER.'],
      },
      {
        h: 'BANK RULES THE APP FOLLOWS',
        text: ['Only bank from a P1 or later plate, never from the P0 master. Slants are replaced after about six months and water tubes are checked on the same schedule. A tube over two years old is suspect until a test passes. Dates and warnings show on the BANK tab.'],
      },
    ],
  },
  {
    key: 'HAZARD',
    title: 'HAZARD INDEX (6)',
    group: 'GROW',
    module: 'HAZARD',
    what: 'Contaminants, pests and faults: how to spot, cause, treat and prevent.',
    blocks: [
      {
        h: 'FIND ONE',
        steps: [
          'Browse the list at the left, or filter by kind (MOULD, BACTERIA, and so on) or by where you saw it (PLATE, GRAIN SPAWN, COOK + COOL-DOWN).',
          'Or type a name at the > prompt (try BLOTCH).',
          'Or press DIAGNOSE and describe the colour, smell and place. It lists the likely matches.',
        ],
      },
      {
        h: 'ONE ENTRY',
        items: [
          ['SPOT', 'How to recognise it.'],
          ['LOOK-ALIKES', 'What it is often mistaken for.'],
          ['CAUSE', 'What causes it.'],
          ['TREAT', 'What to do.'],
          ['PREVENT', 'How to stop it.'],
          ['SPECIES', 'The species it affects.'],
          ['LOSSES', 'Losses you logged against it.'],
          ['SOURCES', 'Where the text came from.'],
        ],
      },
      { h: 'GOOD TO KNOW', text: ['Some library text is only in the owner\'s private copy of the app, not in the public one. The screen still works without it.'] },
    ],
  },
  {
    key: 'PROPULSION',
    title: 'PROPULSION: COOK LOG (7)',
    group: 'GROW',
    module: 'PROPULSION',
    what: 'The steam and sterilization log with temperature curves and a verdict.',
    blocks: [
      {
        h: 'LOG A RUN',
        steps: [
          'Press a start button: STEAM BOX RUN, 75X RUN, MEGACHEF RUN or OTHER RUN.',
          'Pick the date and what was cooked, and how many bags.',
          'Add temperature readings as you go (QUICK-ADD on a phone), or paste the file from a data logger.',
          'Open CURVE to see the temperature against the targets and the verdict (pass, warn or fail).',
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['RUN', 'Start a run, or pick one from the list.'],
          ['CURVE', 'The temperature curve, time at temperature and the verdict.'],
          ['READINGS', 'The readings table and a form to add more.'],
          ['SHEET', 'A log sheet to print and fill in on paper.'],
          ['TARGETS', 'The targets and where they came from.'],
        ],
      },
      { h: 'GOOD TO KNOW', text: ['Targets marked GUESS - REVIEW are the app\'s guesses. Check them against your own procedure.'] },
    ],
  },
  {
    key: 'VITALS',
    title: 'VITALS (2)',
    group: 'ROOMS AND POWER',
    module: 'VITALS',
    what: 'The power board: breakers against what the supply can carry.',
    blocks: [
      {
        h: 'HOW TO USE IT',
        steps: [
          'Choose the source: ICE UTILITY (the grid) or GENERATOR.',
          'Choose the steam heater: A (two 4,500 W elements) or B (one 6,500 W element).',
          'Tap a breaker to flip it on or off. Or type its tag at the prompt (S4, 13).',
          'Watch the budget bar. It turns to warning colour as you near the limit.',
          'Use a PRESET for a quick set: BASELINE, EVERYTHING ON, ALL OFF and others.',
        ],
      },
      {
        h: 'THE SECTIONS',
        items: [
          ['BUDGET', 'Amps and watts on, against the 200 A service or the generator.'],
          ['POWER CUTS', 'Buttons for a cut in progress. Same as FACILITY LOGS.'],
          ['RULES', 'Things the board checks, like linked breakers.'],
          ['PRESETS', 'One-tap sets of breakers.'],
          ['MAIN PANEL, SUB-PANEL', 'The two panels with every breaker.'],
          ['DETAIL', 'The breaker you picked: its load and room.'],
        ],
      },
      { h: 'GOOD TO KNOW', text: ['This board is a planning tool. Flipping a breaker here does not switch real power. Some room placements are guesses until confirmed.'] },
    ],
  },
  {
    key: 'DECK',
    title: 'DECK PLAN (3)',
    group: 'ROOMS AND POWER',
    module: 'DECK',
    what: 'The floor plan with the rooms, their equipment and set points.',
    blocks: [
      {
        h: 'HOW TO USE IT',
        steps: ['Tap a room on the plan, or in the list.', 'Under the plan you see that room\'s SET POINTS, EQUIPMENT, CIRCUITS and INVENTORY.', 'OPEN VITALS or OPEN CARGO jump to the power board or the stock list.'],
      },
      { h: 'GOOD TO KNOW', text: ['Each room also shows its live climate and any alarm (from ATMOSPHERICS). The plan is drawn from the real floor plan. Room names and some equipment placements are guesses until confirmed.'] },
    ],
  },
  {
    key: 'ATMOS',
    title: 'ATMOSPHERICS (18)',
    group: 'ROOMS AND POWER',
    module: 'ATMOS',
    what: 'Room temperature, humidity and CO2: readings, graphs and alarms.',
    blocks: [
      {
        h: 'THE TABS',
        items: [
          ['NOW', 'A card for each room with its latest reading. Tap a card for its graph.'],
          ['GRAPHS', 'Graphs over the last day, week or month with the allowed band shaded.'],
          ['ALARMS', 'Alarms raised, with a message you can copy for WhatsApp.'],
          ['LOG READING', 'Type in a reading from a hand meter.'],
          ['IMPORT CSV', 'Bring in a file exported from a Govee app.'],
          ['AC UNITS', 'Log what each air conditioner is doing, and any error code.'],
          ['SET POINTS', 'The limits for each room. Tap EDIT on a room to change them.'],
          ['SENSORS', 'The list of sensors.'],
          ['FEEDS', 'What was found out about reading Govee and Lennox automatically.'],
          ['MOCK TEST', 'Made-up readings to see how alarms and graphs behave.'],
        ],
      },
      {
        h: 'LOG A HAND READING',
        steps: ['Open LOG READING.', 'Pick the room: check which one is highlighted, because one is already chosen for you (FRUITING).', 'Type temperature, humidity or CO2 (you may leave some blank). The band for the room is shown beside the box.', 'Press SAVE READING.'],
      },
      {
        h: 'GOOD TO KNOW',
        text: ['Full automatic sensor hookup waits until the farm is built and a bridge computer is set up. For now readings come from you, a CSV file or the mock test.', 'The alarm limits and delays are GUESSES until you confirm them.'],
      },
    ],
  },
]
