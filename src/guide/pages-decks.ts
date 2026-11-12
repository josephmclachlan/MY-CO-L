import type { GSection } from './content'

// The deck map (11 Nov 2026): how the app is laid out, and one page per deck for its overview and stations.
// Station codes and names match src/nav/decks.ts.

export const DECKS_PAGE: GSection = {
  key: 'DECKS',
  title: 'DECKS AND STATIONS',
  group: 'BASICS',
  what: 'How the app is laid out: 8 decks, each with its stations.',
  blocks: [
    {
      h: 'THE MAP',
      text: [
        'The app is split into 8 decks, like the decks of a station. Each deck is one part of running the farm. Open a deck and you see its overview: the figures that matter, a few charts, and its stations.',
        'A station is one job, like LOG HARVEST or MONEY OWED. It opens the screen for that job. Every station has a code: 5.6 is deck 5, station 6.',
      ],
    },
    {
      h: 'THE 8 DECKS',
      items: [
        ['1 BRIDGE', "Today's work and the whole farm at a glance. Also ASK MY/CO/L and SEARCH."],
        ['2 GROW DECK', 'Block lots from the steam cook to the harvest: the lot board, new lots, harvests, cooks, the run planner and yields.'],
        ['3 XENOLAB', 'Strains, the culture bank, culture stock, the spawn planner, the species files and the hazard index.'],
        ['4 CARGO HOLD', 'Everything in stock: supplies, fresh mushrooms in the COLD STORE, and surplus or waste.'],
        ['5 TRADE DOCK', 'Selling: new sales, the sales log, buyers, standing orders, the price list, money owed, sales trends, trace and recall. Owner only.'],
        ['6 BURSAR', 'The money side: profit and loss, cash flow, the budget, what-if, cost of goods, power bills, labour and the PRICE BOOK. Owner only.'],
        ['7 ENGINEERING', 'Power, rooms, climate and upkeep: the power grid, power cuts, the deck plan, life support, water, upkeep, checklists and reminders.'],
        ['8 MAINFRAME', 'The app itself: this guide, the textbook, edit history, the data vault, crew access and tuning.'],
      ],
    },
    {
      h: 'MOVING AROUND',
      items: [
        ['NUMBERS', 'Type 1 to 8 at the > prompt to open a deck. Type 5.3 (or 5 3) to open deck 5, station 3. Type 0 for the main menu.'],
        ['NAMES', 'Type a deck name (BURSAR) or a station name (COLD STORE). The old screen names still work too: CARGO, VITALS, MISSION and the rest.'],
        ['THE TITLE BAR', 'It shows where you are: MY/CO/L // TRADE DOCK // MONEY OWED. Tap MY/CO/L for the main menu, or the deck name for its overview. On a phone it shows the screen name only.'],
        ['THE LEFT PANEL', 'On a desktop the deck and its stations head the left panel. The open station is the bright bar. Under the list, RELATED shows stations that go with this one, even on other decks.'],
        ['ON A PHONE', 'Above every station sit the deck button (back to its overview) and a drop-down of its stations. The RELATED stations are at the foot of the screen.'],
        ['BACK', 'BACK always returns to where you were, deck pages included.'],
        ['STAFF', 'Staff do not see TRADE DOCK or BURSAR, or any money figure.'],
      ],
    },
    {
      h: 'READING THE CHARTS',
      items: [
        ['TILES', 'A big figure with a label. A small line under it is the trend, and the dot is the latest value. Tap a tile to open the station it comes from.'],
        ['COLUMNS', 'One column for each day, week or month. Point at one, or touch it, and the line above the chart reads it out. A second series is hatched. A line over the columns is a third figure in the same unit.'],
        ['BARS', 'One bar for each item, all on the same scale. A short tick across a bar is a target or a limit; the words under the chart say which.'],
        ['SPLIT BAR', 'A whole split into its parts. The parts differ in brightness and hatching, and the legend under the bar gives each part with its figure.'],
        ['DIALS', 'A half circle. The shaded arc is the good band and the bright arc runs to the value.'],
        ['AMBER', 'The warning colour. Something needs you, and words beside it always say what.'],
        ['TAP TO OPEN', 'Every figure, bar and chart on a deck page opens the station behind it.'],
      ],
    },
  ],
}

export const DECK_PAGES: GSection[] = [
  {
    key: 'BRIDGE',
    title: 'BRIDGE OVERVIEW (1)',
    group: '1 BRIDGE',
    deck: 'bridge',
    what: "Today's work and the whole farm at a glance.",
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['THE WHOLE FARM', 'One tile for each deck with its headline figure, and a trend line where there is one. A tile turns amber when that deck has something that needs you. Tap a tile to open the deck.'],
          ['WORK LIST', 'Everything due, in three columns: OVERDUE, TODAY and THIS WEEK. Each line opens the screen where the job is done.'],
          ["TODAY'S WORK, ALL REMINDERS", 'The full lists behind the work list.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ["1.1 TODAY'S WORK", 'The day\'s jobs: lots to move, picks due, cultures to check and stock to reorder. It is a tab of MISSION CONTROL, whose page is under GROW DECK.'],
          ['1.2 ASK MY/CO/L', 'The farm assistant. Ask in plain words, or tell it something to save.'],
          ['1.3 SEARCH', 'Find any record or screen, and change many records at once.'],
        ],
      },
    ],
  },
  {
    key: 'GROWDECK',
    title: 'GROW DECK OVERVIEW (2)',
    group: '2 GROW DECK',
    deck: 'grow',
    what: 'Block lots from the steam cook to the harvest.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['PICKED THIS WEEK', 'Kilos picked since Monday, with the last 8 weeks as a trend line.'],
          ['LOTS GROWING', 'Lots in the rooms now, and how many blocks they hold.'],
          ['LOST, 90 DAYS', 'Blocks lost out of the blocks knocked in the last 90 days. Amber at 5% or more.'],
          ['BE%, LAST FINISHED LOTS', 'The average biological efficiency of the last 5 lots that finished.'],
          ['BLOCKS KNOCKED IN THE LAST 90 DAYS', 'Where those blocks are now: incubating, fruiting, spent or lost. A lot marked lost counts all its blocks.'],
          ['KG PICKED A WEEK', 'The last 12 weeks. The PLAN line is the crop plan\'s blocks a week times Catawba\'s kilos per block, at full production.'],
          ['NEXT 7 DAYS', 'Lots to move to fruiting and lots due for their first pick.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ['2.1 LOT BOARD', 'Every active lot: where it is and what is due. Bulk changes, scanning and the guesses are here too.'],
          ['2.2 NEW BLOCK LOT', 'Log the blocks you just inoculated.'],
          ['2.3 LOG HARVEST', 'Kilos picked, by lot and flush.'],
          ['2.4 STEAM COOKS', 'The steam and cook log, with temperature curves and a verdict for each run.'],
          ['2.5 RUN PLANNER', 'This week\'s bag run and what it needs.'],
          ['2.6 YIELD RECORDS', 'BE% by lot and flush, the scorecard and strain trials.'],
        ],
      },
    ],
  },
  {
    key: 'XENOLAB',
    title: 'XENOLAB OVERVIEW (3)',
    group: '3 XENOLAB',
    deck: 'xenolab',
    what: 'Strains, cultures, species and contamination.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['STRAINS IN USE, BANK TUBES', 'How many strains are active, and how many slants and water tubes the bank holds for them.'],
          ['DUE FOR TRANSFER, FADING STRAINS', 'Bank tubes past their transfer age, and strains whose BE is dropping. Amber when there are any.'],
          ['CULTURE BANK BY AGE', 'Fresh tubes, tubes on watch (old enough to test before use) and tubes due for transfer.'],
          ['CONTAMINATION BY STRAIN', 'Blocks lost out of blocks knocked in the last 90 days, for each strain. The tick is the target in the practice settings. Amber at or over it.'],
          ['SPAWN FOR THE NEXT KNOCK', 'G2 spawn bags on the shelf for each species, against the bags the crop plan needs (the tick). Amber when short.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ['3.1 STRAIN REGISTRY', 'Every strain and its family tree.'],
          ['3.2 CULTURE BANK', 'Slants and water tubes, their tests and ages.'],
          ['3.3 CULTURE STOCK', 'Plates, masters, grain spawn and labels.'],
          ['3.4 SPAWN PLANNER', 'The spawn needed for the coming runs, and what to make next.'],
          ['3.5 SPECIES FILES', 'How to grow each species, with its wireframe model.'],
          ['3.6 HAZARD INDEX', 'Contaminants, pests and faults: how to spot, cause, treat and prevent them.'],
        ],
      },
    ],
  },
  {
    key: 'CARGOHOLD',
    title: 'CARGO HOLD OVERVIEW (4)',
    group: '4 CARGO HOLD',
    deck: 'cargo',
    what: 'Everything in stock: supplies and fresh mushrooms.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['TO REORDER, OUT OF STOCK', 'Supplies at or under their reorder point, and supplies with none left.'],
          ['NEVER COUNTED', 'Items with no count yet. Count them once so the reorder list works.'],
          ['FRESH ON HAND, STOCK VALUE', 'Kilos in the COLD STORE, and what the supplies on the shelf cost at the last price paid. Owner only.'],
          ['WEEKS OF STOCK LEFT', 'Lowest first, at the plan\'s weekly use. The tick is the supplier\'s lead time: below it, order now. Capped at 26 weeks.'],
          ['STOCK VALUE BY CATEGORY', 'Where the money on the shelf sits. Owner only.'],
          ['FRESH MUSHROOMS ON HAND', 'Kilos for each species, with the age of the oldest pick. Owner only.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ['4.1 SUPPLY MANIFEST', 'Supplies on hand, use, deliveries and reorders.'],
          ['4.2 COLD STORE', 'Fresh mushrooms on hand: picked, minus sold fresh, minus surplus and waste. Owner only.'],
          ['4.3 SURPLUS + WASTE', 'What did not sell: dried, donated, composted or thrown out. Owner only. It is a tab of MONEY, whose page is under BURSAR.'],
        ],
      },
    ],
  },
  {
    key: 'TRADEDOCK',
    title: 'TRADE DOCK OVERVIEW (5)',
    group: '5 TRADE DOCK',
    deck: 'trade',
    what: 'Selling: sales, buyers, orders and money owed. Owner only.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['SOLD THIS WEEK', 'Colones sold since Monday, with the last 8 weeks as a trend line.'],
          ['MONEY OWED', 'Unpaid sales. Amber when a buyer is more than 30 days late.'],
          ['ORDERS STILL TO DELIVER', 'Fresh kilos on standing orders still to go out this week.'],
          ['FRESH ON HAND', 'Kilos in the COLD STORE. Amber when it is less than the orders.'],
          ['SALES BY DAY', 'This week in solid columns, last week hatched beside them. Written-off sales are left out.'],
          ['MONEY OWED BY AGE', 'Unpaid money split by how old it is: 0 to 7, 8 to 14, 15 to 30 and over 30 days. Every buyer pays cash on delivery, so anything here is late.'],
          ['FRESH ON HAND AGAINST ORDERS', 'Kilos on hand for each species. The tick is what standing orders still need this week.'],
          ['TOP BUYERS', 'The biggest buyers of the last 30 days, in colones, with their kilos.'],
        ],
      },
      {
        h: 'STATIONS',
        text: ['MONEY OWED, SALES TRENDS and TRACE + RECALL are tabs of the MONEY screen. Its page is under BURSAR.'],
        items: [
          ['5.1 NEW SALE', 'Log a sale: kilos, buyer and price.'],
          ['5.2 SALES LOG', 'Every sale, and totals by week, species and buyer.'],
          ['5.3 BUYERS', 'Who buys, how much and how often.'],
          ['5.4 STANDING ORDERS', 'Weekly orders, the harvest forecast and the pick list.'],
          ['5.5 PRICE LIST', 'The WhatsApp list of what is for sale.'],
          ['5.6 MONEY OWED', 'Who owes what, and receipts.'],
          ['5.7 SALES TRENDS', 'Sales by week, species, channel and buyer.'],
          ['5.8 TRACE + RECALL', 'From a sale back to its lot, cook and strain, and from a lot to every buyer.'],
        ],
      },
    ],
  },
  {
    key: 'BURSAR',
    title: 'BURSAR OVERVIEW (6)',
    group: '6 BURSAR',
    deck: 'bursar',
    what: 'Profit, cash and what everything costs. Owner only.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['CASH NOW', 'Cash at the end of this month so far, with the month ends as a trend line. Amber under the floor.'],
          ['MONTH PROFIT', 'This month\'s sales minus costs, with the margin and a 12-month trend line.'],
          ['LOWEST CASH AHEAD', 'The lowest month end still to come, against the floor.'],
          ['COST PER KG', 'What a kilo cost over the last 8 knock weeks, from COST OF GOODS. With no picks yet it shows the plan estimate.'],
          ['PROFIT PER MONTH', 'The last 12 months. Amber columns are losses.'],
          ['CASH FLOW', 'Money in (solid) and out (hatched) each month, cash at the month end as a line, and the floor as a shaded band. Months to come use the budget.'],
          ['WHAT A KILO COSTS', 'The cost of a kilo split into its parts: consumables, cook energy, room energy, labour and wear.'],
          ['BUDGET USED', 'This month\'s costs against the budget, on a dial.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ['6.1 PROFIT + LOSS', 'Each month: sales, costs, profit and break-even.'],
          ['6.2 CASH FLOW', 'Twelve months of cash, spending and money in.'],
          ['6.3 BUDGET', 'The plan for each month.'],
          ['6.4 WHAT-IF', 'Try prices and bag counts before changing anything.'],
          ['6.5 COST OF GOODS', 'What a kilo costs to grow, week by week.'],
          ['6.6 POWER BILLS', 'The ICE electricity bills.'],
          ['6.7 LABOUR', 'Hours worked, by task.'],
          ['6.8 PRICE BOOK', 'Every price and cost the app uses, the shelf life of fresh mushrooms, and the exchange rate for each day.'],
        ],
      },
    ],
  },
  {
    key: 'ENGINEERING',
    title: 'ENGINEERING OVERVIEW (7)',
    group: '7 ENGINEERING',
    deck: 'engineering',
    what: 'Power, rooms, climate and upkeep.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['GRID', 'UP, or DOWN NOW while a power cut is open, with the cuts this month.'],
          ['CLIMATE ALARMS', 'Alarms not yet seen in LIFE SUPPORT.'],
          ['UPKEEP LATE, WATER TESTS DUE', 'Maintenance and cleaning past due, and water tests due.'],
          ['TEMPERATURE NOW', 'A dial for each room. The shaded arc is its alarm band; amber means outside it.'],
          ['PLANNED LOAD', 'The worst leg with the breakers set on POWER GRID, against the 155 A the 3/0 aluminium feeder carries. The shaded arc is under 80%.'],
          ['HOURS WITHOUT GRID POWER', 'Each month, from the power cut log.'],
          ['UPKEEP COMING DUE', 'The next maintenance and cleaning jobs.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ['7.1 POWER GRID', 'Breakers, loads and the generator.'],
          ['7.2 POWER CUTS', 'Every cut and how long it lasted.'],
          ['7.3 DECK PLAN', 'The rooms and their equipment, drawn to scale.'],
          ['7.4 LIFE SUPPORT', 'Climate sensors, graphs and alarms.'],
          ['7.5 WATER', 'Water tests and when the next one is due.'],
          ['7.6 UPKEEP', 'Maintenance and cleaning logs.'],
          ['7.7 CHECKLISTS', 'Daily and weekly sign-offs.'],
          ['7.8 REMINDERS', 'The status board and everything due.'],
        ],
      },
    ],
  },
  {
    key: 'MAINFRAME',
    title: 'MAINFRAME OVERVIEW (8)',
    group: '8 MAINFRAME',
    deck: 'mainframe',
    what: 'The app itself: guide, records, backups and crew.',
    blocks: [
      {
        h: 'THE OVERVIEW',
        items: [
          ['LAST BACKUP', 'OK, or DUE when the last backup is old.'],
          ['CHANGES THIS WEEK', 'Saves in the last 7 days, with 14 days as a trend line. One save can change many records; it counts once. Owner only.'],
          ['WAITING TO SAVE', 'Changes waiting for signal, and the saving lamp.'],
          ['YOU ARE', 'Owner or staff, and where that comes from.'],
          ['SAVED CHANGES A DAY', 'The last 14 days. Owner only.'],
          ['GUESSES WAITING FOR JOSEPH', 'How many figures each screen still uses as a guess. Tap one to see its list.'],
        ],
      },
      {
        h: 'STATIONS',
        items: [
          ['8.1 USER GUIDE', 'This guide.'],
          ['8.2 TEXTBOOK', 'The growing textbook. Private copy only.'],
          ['8.3 EDIT HISTORY', 'Every change, UNDO and the saving status.'],
          ['8.4 DATA VAULT', 'Backups, spreadsheets, restoring and the Google Sheet.'],
          ['8.5 CREW ACCESS', 'Owner and staff roles, and the device lock.'],
          ['8.6 TUNING', 'Look, sound, language and gloves.'],
        ],
      },
    ],
  },
]
