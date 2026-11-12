import type { GSection } from './content'

// Money screens (owner only), the bridge tools and the mainframe screens. Each page names the stations that open its screen.
export const MONEY: GSection[] = [
  {
    key: 'LEDGER',
    title: 'LEDGER (6.5 TO 6.8)',
    group: '6 BURSAR',
    module: 'LEDGER',
    what: 'What a block costs, with electricity bills, hours and every price in one place.',
    blocks: [
      {
        h: 'ITS STATIONS',
        text: ['Four stations on BURSAR open this screen. Each one opens its own page of it.'],
        items: [
          ['6.5 COST OF GOODS', 'The OVERVIEW + PLAN WEEK page: what one block and one kilogram cost, split into parts, and the cost of the planned week.'],
          ['6.6 POWER BILLS', 'The ICE BILLS page. Type in each electricity bill. The app checks the bill against the ICE tariff.'],
          ['6.7 LABOUR', 'The LABOUR HOURS page. Log hours worked. They count toward cost when labour is switched on.'],
          ['6.8 PRICE BOOK', 'Every price and cost the app uses: sale price per kg, electricity tariff, labour rate, wear, the shelf life of fresh mushrooms and the exchange rate. Blank means the built-in number.'],
        ],
      },
      {
        h: 'THE EXCHANGE RATE',
        text: [
          'There is one exchange rate for the whole app, set in the PRICE BOOK. When online the app fetches the day\'s market rate. A rate you type for a day wins over the fetched one: use it for the rate your bank gave.',
          'Every money record keeps the rate of its own day, so old figures never change when the rate does.',
        ],
      },
      {
        h: 'TYPE AN ELECTRICITY BILL',
        steps: ['Open POWER BILLS (6.6).', 'Type the month, kWh used, billed kW (demand) and the total in colones.', 'Press SAVE BILL. Room energy in the cost uses real bills for the months you typed.'],
      },
      { h: 'GOOD TO KNOW', text: ['Money is stored in colones only. US dollars are worked out at the rate saved for each record\'s own day.', 'Owner only.'] },
    ],
  },
  {
    key: 'TRADE',
    title: 'TRADE (5.1 TO 5.3)',
    group: '5 TRADE DOCK',
    module: 'TRADE',
    what: 'Record sales and see totals and margin.',
    blocks: [
      {
        h: 'ITS STATIONS',
        items: [
          ['5.1 NEW SALE', 'The NEW SALE tab.'],
          ['5.2 SALES LOG', 'The SALES LOG, TOTALS + MARGIN and GUESSES tabs.'],
          ['5.3 BUYERS', 'The BUYERS tab.'],
        ],
      },
      {
        h: 'RECORD A SALE',
        steps: [
          'Open NEW SALE (5.1).',
          'Pick or type the BUYER, the channel (MARKET, RESTAURANT, SHOP, DIRECT, DELIVERY, OTHER), the species and FRESH or DRIED. Turkey tail is sold dried, so picking it switches to DRIED.',
          'Type the weight in KG and the grade. The price per kg box may be empty and show BUILT-IN with a price: leave it for that price, or type your own if this sale differs. Set the built-in prices in PRICE BOOK.',
          'Optionally type the lot codes (B1020 L1022). They are what lets TRACE find who got a lot.',
          'Choose PAID ON DELIVERY or NOT PAID YET.',
          'Press SAVE SALE. UNDO reverses it.',
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['NEW SALE', 'The form above.'],
          ['TOTALS + MARGIN', 'Sales by species and channel and the margin against cost.'],
          ['BUYERS', 'Every buyer with what they bought and owe.'],
          ['SALES LOG', 'Every sale, newest first.'],
          ['GUESSES', 'Things the app guessed.'],
        ],
      },
      { h: 'GOOD TO KNOW', text: ['Every buyer pays cash on delivery. A sale marked NOT PAID YET goes onto MONEY OWED (5.6) and puts that buyer on hold: the app warns you on the next sale and on the pick list, it does not block.'] },
    ],
  },
  {
    key: 'ORDERS',
    title: 'STANDING ORDERS (5.4, 5.5)',
    group: '5 TRADE DOCK',
    module: 'ORDERS',
    what: 'Regular weekly orders, the harvest forecast, the pick list and the WhatsApp price list.',
    blocks: [
      {
        h: 'ITS STATIONS',
        items: [
          ['5.4 STANDING ORDERS', 'The STANDING ORDERS, HARVEST FORECAST, PICK + PACK LIST and GUESSES tabs.'],
          ['5.5 PRICE LIST', 'The PRICE LIST (WHATSAPP) tab.'],
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['STANDING ORDERS', 'Each buyer\'s regular order: kg a week, price, delivery day. A buyer who would take more than the cap of the crop (30%) is flagged.'],
          ['HARVEST FORECAST', 'What each lot should give and when, week by week, against the orders.'],
          ['PICK + PACK LIST', 'For a delivery day: what to pick and pack for each buyer, and whether there is enough. COPY PICK SHEET copies it as text.'],
          ['PRICE LIST (WHATSAPP)', 'What is available this week and at what price, as a message. OPEN WHATSAPP sends it from your phone.'],
          ['GUESSES', 'The rules the app guessed: the buyer cap, pick days, default delivery day.'],
        ],
      },
      {
        h: 'ADD A STANDING ORDER',
        steps: ['Open STANDING ORDERS.', 'Type the buyer, the species, KG per week and the price in colones per kg.', 'Choose the delivery days and the date it starts (a Monday).', 'Tick the confirmed box once the buyer has agreed.', 'Press SAVE STANDING ORDER.'],
      },
      { h: 'GOOD TO KNOW', text: ['Changing kilograms, price or day starts a new version on a Monday and keeps the old one for the history. Delivering a line on the pick list makes a paid sale in the SALES LOG.'] },
    ],
  },
  {
    key: 'MONEY',
    title: 'MONEY (4.3, 5.6 TO 5.8, 6.1 TO 6.4)',
    group: '6 BURSAR',
    module: 'MONEY',
    what: 'Who owes you, receipts, spending, profit and loss, cash flow and what-ifs.',
    blocks: [
      {
        h: 'ITS STATIONS',
        text: ['This screen is split over three decks. Each station shows only its own tabs. Typing MONEY opens the BURSAR deck.'],
        items: [
          ['4.3 SURPLUS + WASTE', 'The WASTE LOG tab, on CARGO HOLD.'],
          ['5.6 MONEY OWED', 'The MONEY OWED and RECEIPTS tabs, on TRADE DOCK.'],
          ['5.7 SALES TRENDS', 'The SALES TRENDS tab.'],
          ['5.8 TRACE + RECALL', 'The TRACE + RECALL tab.'],
          ['6.1 PROFIT + LOSS', 'The PROFIT AND LOSS and GUESSES tabs, on BURSAR.'],
          ['6.2 CASH FLOW', 'The 12-MONTH CASH FLOW and SPENDING + CASH IN tabs.'],
          ['6.3 BUDGET', 'The BUDGET tab.'],
          ['6.4 WHAT-IF', 'The WHAT-IF PLANNER tab.'],
        ],
      },
      {
        h: 'THE TABS',
        items: [
          ['MONEY OWED', 'Every unpaid sale by buyer and age. Mark one paid or written off.'],
          ['RECEIPTS', 'A numbered receipt for a sale, to copy and send.'],
          ['SPENDING + CASH IN', 'Money out, and money in that is not a sale (loans, workshops).'],
          ['PROFIT AND LOSS', 'Income minus costs by month, in colones and US dollars, with a chart of profit for the last 12 months. Tap a month in the chart to open it.'],
          ['12-MONTH CASH FLOW', 'Planned and real cash in and out for twelve months. The chart shows money in (solid) and out (hatched) each month, cash at the month end as a line, and your cash floor as a shaded band.'],
          ['BUDGET', 'The monthly lines you plan. PUT THESE IN ALL 12 MONTHS copies one month across.'],
          ['SALES TRENDS', 'Which species and buyers are rising or falling.'],
          ['WASTE LOG', 'Mushrooms dried, donated, composted or thrown out.'],
          ['TRACE + RECALL', 'Type a lot to see every buyer who got it, or a buyer to see their lots.'],
          ['WHAT-IF PLANNER', 'Change bags, price or costs and see profit and the break-even point.'],
          ['GUESSES', 'The figures the app guessed (age bands, how much power grows with bags, and so on) for you to check.'],
        ],
      },
      {
        h: 'MARK A SALE PAID',
        steps: ['Open MONEY OWED (5.6).', 'Tap the buyer\'s unpaid sale.', 'Type the day the cash came in and press the save button. The buyer comes off hold when nothing else is owed.'],
      },
      { h: 'GOOD TO KNOW', text: ['Electricity in the books comes from POWER BILLS (6.6). Supply deliveries and labour hours count as spending unless you switch them off, so they are not counted twice. Owner only.'] },
    ],
  },
]

export const TOOLS: GSection[] = [
  {
    key: 'SEARCH',
    title: 'SEARCH (1.3)',
    group: '1 BRIDGE',
    module: 'SEARCH',
    what: 'Find any record or screen, and change many records at once.',
    blocks: [
      {
        h: 'FIND A RECORD',
        steps: ['Type a code (B1020, BO-01) or a name in the box, or at the > prompt.', 'Results are grouped by kind. Tap one to open it.', 'A code that matches exactly opens straight away.'],
      },
      {
        h: 'CHANGE MANY AT ONCE',
        steps: [
          'Open CHANGE MANY AT ONCE (or type MANY).',
          'Choose what kind of records (lots, sales and so on) and filter to the ones you want.',
          'Tick them: TICK ALL ticks every match.',
          'Choose the one change (status, place, grade, paid or owed, delete).',
          'Check the preview, then apply. It is one UNDO step.',
        ],
      },
      { h: 'STOCK TAKE', text: ['Type STOCKTAKE to count many stock items and save once.'] },
    ],
  },
  {
    key: 'ASK',
    title: 'ASK MY/CO/L (1.2)',
    group: '1 BRIDGE',
    module: 'ASK',
    what: 'The farm assistant: ask in plain words, or tell it something to save.',
    blocks: [
      {
        h: 'ASK A QUESTION',
        steps: ['Type in the box, or at the > prompt: ASK words, or anything ending in ?', 'The answer comes only from your own records. It ends with a button for the screen it came from.', 'Try the EXAMPLES tab: tap one to ask it.'],
      },
      {
        h: 'SAVE BY SENTENCE',
        steps: ['Type for instance: log 4.2 kg from B1020, or power out.', 'A card shows what it understood. Nothing is saved yet.', 'Press CONFIRM (or type YES) to save, or CANCEL.', 'A saved change is one UNDO step and shows in HISTORY as made by the assistant.'],
      },
      {
        h: 'THE BRAIN',
        text: ['Without setup a rule-based brain answers the usual sentences quickly. On the ENGINE tab you can point the assistant at a language model running on a farm computer (Ollama, llama.cpp or LM Studio). It is never a cloud service. If the model is off or slow the rules answer.'],
      },
      { h: 'GOOD TO KNOW', text: ['Staff get no money answers and no buyer names. Questions it cannot answer from the records get a short refusal and a line on what you can ask.'] },
    ],
  },
  {
    key: 'HISTORY',
    title: 'EDIT HISTORY (8.3)',
    group: '8 MAINFRAME',
    module: 'HISTORY',
    what: 'Every change, who made it, UNDO, and the saving status. The screen is called HISTORY.',
    blocks: [
      {
        h: 'THE PAGES',
        items: [
          ['ALL EDITS', 'Every change, newest first: who, when, the old and new values. Tap a line to see that record.'],
          ['ONE RECORD', 'The whole life of one record. Open it from any record\'s history button.'],
          ['UNDO LIST', 'The changes you can still undo now.'],
          ['SAVING STATUS', 'Whether changes are saved here, synced, waiting for signal, or in conflict. This is the lamp, explained.'],
          ['GUESSES', 'Rules the app guessed, like how far back UNDO goes.'],
        ],
      },
      {
        h: 'PUT AN OLD VALUE BACK',
        steps: ['Open the change in ALL EDITS.', 'Open the record.', 'Use the restore button beside the old value.'],
      },
      { h: 'GOOD TO KNOW', text: ['Type a name under YOUR NAME FOR THE HISTORY so your changes are labelled with it. Until then they say OWNER. Owner only.'] },
    ],
  },
  {
    key: 'DATA',
    title: 'DATA VAULT (8.4)',
    group: '8 MAINFRAME',
    module: 'DATA',
    what: 'Backups, spreadsheets, restoring and the Google Sheet. The screen is called DATA.',
    blocks: [
      {
        h: 'MAKE A BACKUP',
        steps: ['Open BACK UP.', 'Press SAVE EVERYTHING (ZIP). A file downloads: the backup, a README and one spreadsheet for every table that has records. (BACKUP FILE ONLY (.JSON) downloads just the backup file.)', 'Move the file somewhere safe: a USB stick, your e-mail, another computer.', 'Do it every week at least. The main menu warns you when it is old.'],
      },
      {
        h: 'OTHER PAGES',
        items: [
          ['EXPORT SPREADSHEETS', 'One table as a CSV file you can open in a spreadsheet.'],
          ['RESTORE', 'Put a backup back.'],
          ['GOOGLE SHEET', 'Every record mirrored into one Google Sheet. Edits typed in the sheet come back into the app.'],
          ['GUESSES', 'The stale-backup rule and other guessed numbers.'],
        ],
      },
      {
        h: 'RESTORE A BACKUP',
        steps: ['Open RESTORE and pick the backup file.', 'The app shows what would change: how many records are added, changed or removed.', 'Choose ADD AND UPDATE (KEEP THE REST) or the exact restore. A RESTORE button appears with the number of changes.', 'Press it. It asks SURE? TAP AGAIN: press it a second time to really restore.', 'Everything restored is one UNDO step.'],
      },
      {
        h: 'LINK THE GOOGLE SHEET (ONCE)',
        steps: ['Open GOOGLE SHEET and press SHEETS.NEW to make an empty Google Sheet.', 'In the sheet open Extensions > Apps Script. Delete what is there. Press COPY SCRIPT in the app and paste it in. Press Save.', 'Press Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Press Deploy, then Allow.', 'Copy the Web app URL (it ends in /exec), paste it into SHEET ADDRESS and press SAVE.', 'Press SYNC NOW. The first sync makes a READ ME tab and one tab per record type.'],
      },
      {
        h: 'EDIT IN THE SHEET',
        steps: ['Change any white cell. The app picks it up within 5 minutes, or press SYNC NOW.', 'Add a record by typing in the first empty row. Type a strain code or lot code in the look-up column and the app finds the record.', 'Delete a record by typing DELETE in its _action cell. Deleting the whole row does not delete it: the app puts it back.', 'Each sync is one UNDO step, signed GOOGLE SHEET in HISTORY.'],
      },
      { h: 'GOOD TO KNOW', text: ['Restoring needs the file from the same app. A file from anywhere else is refused. Owner only.', 'In the sheet, grey cells and grey tabs (exchange rates, edit history, sensor readings) are read only. A value that does not fit is refused and listed under LISTED BY THE SYNC; the app value goes back into the sheet.'] },
    ],
  },
  {
    key: 'STAFF',
    title: 'CREW ACCESS (8.5)',
    group: '8 MAINFRAME',
    module: 'STAFF',
    what: 'Who is using this device and what they may open. The screen is called STAFF.',
    blocks: [
      {
        h: 'THE ROLES',
        items: [
          ['OWNER', 'Sees everything.'],
          ['STAFF', 'Logs the work and sees no money, history, data or textbook. TRADE DOCK, BURSAR and the COLD STORE are hidden.'],
        ],
      },
      {
        h: 'LOCK A DEVICE TO STAFF',
        steps: ['Type the OWNER PIN (4 to 12 digits) twice and press SAVE PIN.', 'Press LOCK THIS DEVICE TO STAFF. It asks SURE? TAP AGAIN: press it a second time.', 'To open the money screens again type the owner PIN on this screen.'],
      },
      { h: 'GOOD TO KNOW', text: ['In local mode this lock keeps a helper out of the money screens but is not real security, because the data sits in this browser. Real separation needs the database login. Five wrong PIN tries wait 30 seconds.'] },
    ],
  },
  {
    key: 'MANUAL',
    title: 'TEXTBOOK (8.2)',
    group: '8 MAINFRAME',
    module: 'MANUAL',
    what: 'The growing textbook. Private copy only.',
    blocks: [
      {
        h: 'WHAT IT IS',
        text: ['The textbook is the farm\'s own reference on growing. The WHY? buttons on other screens open the exact section a number came from.'],
      },
      { h: 'HOW TO USE IT', steps: ['Pick a chapter or section in the contents.', 'Tap a link to jump. BACK returns you to where you were.'] },
    ],
  },
  {
    key: 'GUIDE',
    title: 'USER GUIDE (8.1)',
    group: '8 MAINFRAME',
    module: 'GUIDE',
    what: 'This guide.',
    blocks: [
      {
        h: 'HOW TO USE IT',
        steps: ['Pick a page from the list at the left (on a phone, from the picker at the top). The pages are grouped by deck.', 'Or type a word in SEARCH THE GUIDE.', 'Type GUIDE on any screen to land on its page. GUIDE 5.6 opens the page for station 5.6.', 'Tap OPEN THIS SCREEN (or OPEN THIS DECK) to go to the screen the page is about.'],
      },
      { h: 'GOOD TO KNOW', text: ['There is a copy of this guide as a plain file, docs/USER-MANUAL.md in the app\'s repository, for printing. It is made from the same text.'] },
    ],
  },
]

export const MORE: GSection[] = [
  {
    key: 'WORDS',
    title: 'WORDS AND SHORT FORMS',
    group: 'MORE',
    what: 'What the farm words and codes mean.',
    blocks: [
      {
        h: 'THE LIST',
        items: [
          ['BE%', 'Fresh kg picked divided by dry kg of substrate, times 100.'],
          ['BLOCK', 'One bag of substrate with spawn.'],
          ['CART', 'A rack of blocks that moves together. It has a name like C-07.'],
          ['COGS', 'Cost of goods sold: what the mushrooms cost to make.'],
          ['FLUSH', 'One wave of mushrooms from a block.'],
          ['G1, G2', 'First and second grain spawn generations.'],
          ['ICE', 'Costa Rica\'s electricity utility. Its bill has a charge for energy and one for the highest demand.'],
          ['KNOCK', 'The day blocks are inoculated.'],
          ['LOT', 'Blocks knocked on the same day. Code like B1020.'],
          ['P0, P1, P2', 'Steps away from the stored master culture.'],
          ['RH', 'Relative humidity, in percent.'],
          ['SLANT, WATER TUBE', 'Ways to store a culture for months.'],
          ['T/E TEST', 'Test and expand: grow a test batch before using a stored culture in production.'],
          ['75X', 'The small sterilizer used in the lab.'],
        ],
      },
    ],
  },
  {
    key: 'TROUBLE',
    title: 'IF SOMETHING GOES WRONG',
    group: 'MORE',
    what: 'Common problems and what to try.',
    blocks: [
      {
        h: 'MY CHANGE IS WRONG',
        text: ['Press UNDO right away. If it was a while ago, open HISTORY and put the old value back.'],
      },
      {
        h: 'THE DATA LOOKS EMPTY ON A DIFFERENT DEVICE',
        text: ['In local mode each device keeps its own records. Make a backup on the device that has them (DATA VAULT, 8.4) and restore it on the other one.'],
      },
      {
        h: 'A BUTTON DOES NOTHING WHEN I TAP IT',
        text: ['Tip mode may be on. The ? TIPS button in the status line is lit. Tap it to turn tip mode off.'],
      },
      {
        h: 'I CANNOT OPEN A SCREEN',
        text: ['The answer bar above the prompt says why. A staff login cannot open money screens, history, data or the textbook. Ask the owner.'],
      },
      {
        h: 'THE SCREEN IS HARD TO READ',
        text: ['Press F6 for CLEAN mode in sunlight, or F5 to change the colour, or open TUNING (F3) and raise BRIGHTNESS or lower the glass strength. WIREFRAMES on the same screen brightens just the species models.'],
      },
      {
        h: 'THERE IS NO SOUND',
        text: ['Sound plays only when text appears, and phones only allow it after a tap. Check F4 shows MUTE (sound is on) and that the phone is not on silent.'],
      },
      {
        h: 'THE LAMP SAYS WAITING OR CONFLICT',
        text: ['WAITING means changes are saved on this device and still to be sent. CONFLICT means two devices changed the same record: open HISTORY, then SAVING STATUS, to see what was kept.'],
      },
    ],
  },
]
