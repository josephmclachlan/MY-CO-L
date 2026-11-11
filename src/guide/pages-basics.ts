import type { GSection } from './content'

// BASICS and THE FRAME: what every screen shares.
export const BASICS: GSection[] = [
  {
    key: 'START',
    title: 'START HERE',
    group: 'BASICS',
    what: 'What MY/CO/L is, and your first five minutes with it.',
    blocks: [
      {
        h: 'WHAT THIS IS',
        text: [
          'MY/CO/L is the farm terminal for Talamanca Station. It keeps the farm records in one place: the crops, the cultures, the stock, the sales, the power, the room climate and the cash.',
          'It looks like an old green-screen computer on purpose. Everything on it works by tapping or clicking, by keyboard, or by typing short words at the > prompt at the bottom of the screen.',
        ],
      },
      {
        h: 'YOUR FIRST FIVE MINUTES',
        steps: [
          'Tap or press any key on the dark start screen. The boot text runs, then the MAIN MENU appears. Any key or tap skips the boot text (unless TUNE > BOOT is set to ALWAYS FULL).',
          'On the MAIN MENU, tap a deck to open it. A deck is one part of the farm, like GROW DECK or TRADE DOCK. Its page shows the figures that matter and its stations, one job each.',
          'You can also type a deck number or name at the > prompt and press Enter. Try 2 for GROW DECK, or 2.3 to go straight to LOG HARVEST.',
          'Look at the top left of any screen for the BACK button. It returns you to the screen you came from, with everything as you left it.',
          'Tap ? TIPS in the grey line under the title bar. Now tap a button: instead of pressing it, you get a note saying what it does. Tap ? TIPS again to leave. While tip mode is on, buttons do not press, so nothing saves.',
          'Open this guide from MAINFRAME (station 8.1) or type GUIDE. On any screen, GUIDE opens the page for that screen. The DECKS AND STATIONS page explains the whole map.',
        ],
      },
      {
        h: 'WHERE YOUR RECORDS LIVE',
        text: [
          'Today the app runs in LOCAL MODE. Your records are saved inside this browser on this device. Nothing is sent anywhere. A phone and a laptop each have their own copy until a database is linked later.',
          'Because of that, make a backup often. See the DATA VAULT page. A backup is one file you can keep on a USB stick or send to yourself.',
          'The app works with no internet and no signal. When there is no network the status line says NET DOWN // CACHED, and you can keep working.',
        ],
      },
      {
        h: 'OWNER AND STAFF',
        text: [
          'The OWNER sees everything. A STAFF login logs the work (harvests, lots, power cuts, readings) and never sees money. Staff do not see pages in this guide for screens they cannot open.',
        ],
      },
    ],
  },
  {
    key: 'SCREEN',
    title: 'THE PARTS OF A SCREEN',
    group: 'BASICS',
    what: 'The same frame is on every screen. Learn it once.',
    blocks: [
      {
        h: 'FROM TOP TO BOTTOM',
        items: [
          ['TITLE BAR', 'The dark bar at the top. It shows where you are: MY/CO/L, the deck, then the station. Tap MY/CO/L for the main menu, or the deck name for its overview. The < BACK button at the left goes back one step. On a phone the deck name is left out, and the little saving lamp sits in the status line instead.'],
          ['STATUS LINE', 'The small grey line under it: the farm clock (Costa Rica time, the same clock every log uses), DB LINKED or LOCAL MODE, NET OK or NET DOWN, the sound and look in use, the saving lamp, the ? TIPS button, the UNDO button (it shows up after your first saved change), and GLOVE when glove mode is on.'],
          ['INDEX (LEFT)', 'The menu column on the left of a desktop screen. On a station it starts with the deck and its stations, then RELATED stations, then the tabs or records of the screen you are on. On the main menu it lists every deck and station.'],
          ['ON A PHONE', 'The index is hidden. The deck button and a drop-down of its stations sit at the top of the screen, RELATED stations at the foot. Pick a tab from the SHOW list (or the strip of tabs) at the top of the page.'],
          ['STATION LINE', 'The line at the top of every station: its code, the screen name, and what the station is for.'],
          ['MAIN PANEL', 'The big box with the work in it. It scrolls by itself.'],
          ['ANSWER BAR', 'A boxed line just above the prompt that appears after you save something, undo, or type a command. It says what happened. It is red when something went wrong and stays until you close it with X; other answers fade after about 12 seconds.'],
          ['> PROMPT', 'The line with a blinking block. Type a word and press Enter: 1 to 8 opens a deck, 5.3 opens a station, a name opens a deck or a screen, FIND looks for a record. HELP lists every command.'],
          ['HINT LINE', 'One line of advice for the screen you are on, under the prompt.'],
          ['F-KEY BAR', 'The eight buttons at the bottom: F1 HELP, F2 MENU, F3 TUNE, F4 MUTE or SOUND, F5 THEME, F6 CLEAN or GLASS, F7 BOOT, F8 LOGIN or LOGOUT. On a phone you see four and a MORE key that opens the other four.'],
        ],
      },
      {
        h: 'THE SAVING LAMP AND UNDO',
        text: [
          'The lamp tells you where your last change is: SAVED HERE (on this device), SYNCED, WAITING (no signal yet) or CONFLICT. Tap it to open the saving status.',
          'The UNDO button reverses the last saved change. It appears after you save something, and its label says what it will undo (for example UNDO ADDED HARVEST). See the SAVING page.',
        ],
      },
      {
        h: 'COLOURS',
        text: [
          'The screen uses one colour at a time: PHOSPHOR green, CRYO blue, SODIUM amber, SPORE or ALERT red. Change it with F5 or on TUNE. Red text in any theme is a warning. CLEAN mode (F6) turns off the glass effects for bright sunlight.',
        ],
      },
    ],
  },
  {
    key: 'KEYS',
    title: 'KEYS, TOUCH AND GLOVES',
    group: 'BASICS',
    what: 'Every way to move around: keyboard, mouse, finger and gloved hands.',
    blocks: [
      {
        h: 'KEYBOARD',
        items: [
          ['ARROWS', 'Move to the next item on the screen. Past the edge they cross to the index at the left, the BACK button at the top, or the F-keys at the bottom.'],
          ['ENTER OR SPACE', 'Press the item that has the highlight.'],
          ['[ AND ]', 'Jump to the index column, and back to the page.'],
          ['PGUP, PGDN, HOME, END', 'Scroll the page.'],
          ['BACKSPACE', 'BACK, when you are not typing in a box.'],
          ['ESC', 'Closes a pop-up or a drop-down, then leaves a box you are typing in, then goes BACK. If a tip is showing, Esc closes the tip first.'],
          ['ALT + LEFT', 'BACK from anywhere.'],
          ['F1 TO F8', 'The function bar.'],
          ['CTRL + Z', 'UNDO the last saved change (inside a typing box it stays the box\'s own undo).'],
          ['ANY LETTER', 'Goes to the > prompt.'],
          ['IN A DATE BOX', 'Arrows move days, PgUp and PgDn move months.'],
          ['IN A DROP-DOWN', 'Arrows, or a letter to jump, then Enter to pick.'],
        ],
      },
      {
        h: 'TOUCH (PHONE OR TABLET)',
        steps: [
          'Tap a line, tab or button to use it. The prompt does not pop the phone keyboard up until you tap it.',
          'To read what a control does, tap ? TIPS first, then tap the control. The tip has a button that opens this guide at the right page.',
          'Drop-down lists open inside the terminal, never as the phone\'s own wheel.',
        ],
      },
      {
        h: 'GLOVE MODE',
        text: [
          'With wet or gloved hands type GLOVE (or turn it on under TUNE). Buttons get bigger and a number pad appears for number boxes. Tap the GLOVE badge in the status line, or type GLOVE again, to turn it off.',
        ],
      },
      {
        h: 'LANGUAGE',
        text: [
          'Type SPANISH or ESPANOL for Spanish screens, ENGLISH to come back. This guide and the tips are in English. The Spanish screen text was written by Claude and should be read by a native speaker.',
        ],
      },
    ],
  },
  {
    key: 'COMMANDS',
    title: 'WORDS YOU CAN TYPE',
    group: 'BASICS',
    what: 'The > prompt at the bottom of every screen.',
    blocks: [
      {
        h: 'HOW IT WORKS',
        text: [
          'Type, press Enter. Capitals do not matter. If the app does not know the word it searches your records for it, so you can also just type a lot code like B1020 or a strain code like BO-01.',
          'On a screen with tabs, typing a tab name (like CURVE on the cook log) switches to that tab.',
        ],
      },
      {
        h: 'THE ONES YOU WILL USE MOST',
        items: [
          ['MENU OR 0', 'The main menu.'],
          ['1 TO 8', 'Open that deck.'],
          ['5.3', 'Open deck 5, station 3. A space or a comma works too: 5 3.'],
          ['A DECK OR STATION NAME', 'BURSAR, COLD STORE, LOG HARVEST. The old screen names still work too: CARGO, VITALS, MISSION. MONEY opens BURSAR.'],
          ['BACK', 'Go back.'],
          ['HELP', 'The full list of commands.'],
          ['GUIDE', 'This user guide, at the page for the screen you are on. GUIDE 7.1, GUIDE POWER GRID or GUIDE VITALS opens the page for that station.'],
          ['TIPS', 'Turn tip mode on or off.'],
          ['FIND words', 'Search every record and screen. Or type / and the words.'],
          ['HARVEST, LOT, TODAY, BOARD', 'Open that part of MISSION CONTROL.'],
          ['SALE, OWED, FORECAST, PICKLIST', 'Sales, money owed, harvest forecast, pick and pack list.'],
          ['POWERCUT, WATER, CHECKLIST', 'Facility logs.'],
          ['UNDO, HISTORY, SYNC', 'Undo, the change history, the saving status.'],
          ['BACKUP, EXPORT, RESTORE', 'Data safety.'],
          ['ASK words', 'Ask the farm assistant. Anything ending in ? also goes to it.'],
          ['GLOVE, SPANISH, ENGLISH', 'Glove mode and screen language.'],
          ['THEME name, CLEAN, MUTE', 'Look and sound.'],
        ],
      },
    ],
  },
  {
    key: 'SAVING',
    title: 'SAVING, UNDO AND HISTORY',
    group: 'BASICS',
    what: 'How the app keeps your work safe, and how to take a change back.',
    blocks: [
      {
        h: 'SAVING',
        text: [
          'There is no SAVE-the-whole-app button. Each form has its own save button (SAVE SALE, SAVE HARVEST and so on). The moment you press it the record is written to this device and the lamp shows SAVED HERE.',
          'With no signal the app keeps working and queues the change. The lamp shows WAITING until it can be sent. Today, in local mode, nothing needs sending.',
        ],
      },
      {
        h: 'UNDO',
        steps: [
          'Press UNDO in the status line, or press Ctrl+Z, or type UNDO.',
          'The last saved change is reversed. The answer bar above the prompt says what was undone.',
          'You can undo many steps in a row, up to 40, until you close the app. After that use HISTORY to put old values back.',
        ],
      },
      {
        h: 'HISTORY',
        text: [
          'Every change is written down: who made it, when, the old value and the new value. Open EDIT HISTORY (8.3). You can look at one record\'s whole life, or put an old value back.',
        ],
      },
      {
        h: 'BACKUPS',
        text: [
          'Your records are only in this browser. If the browser data is wiped, or the phone is lost, they are gone. Open DATA VAULT (8.4) and use SAVE EVERYTHING (ZIP) often. (BACKUP FILE ONLY (.JSON) saves just the backup file.) The main menu warns you when the last backup is old.',
        ],
      },
    ],
  },
  {
    key: 'TIPS',
    title: 'TOOLTIPS',
    group: 'BASICS',
    what: 'A short note on what any button does, on every kind of device.',
    blocks: [
      {
        h: 'WITH A MOUSE',
        text: ['Rest the pointer on a button or box for half a second. A small note appears under it. Move away and it goes.'],
      },
      {
        h: 'WITH THE KEYBOARD',
        text: ['Move to a control with the arrows or Tab. After a short pause the note appears. Press Esc to close it. Moving on closes it too.'],
      },
      {
        h: 'ON A PHONE OR TABLET',
        steps: [
          'Tap ? TIPS in the status line. It lights up.',
          'Tap any control. Nothing is pressed. A note says what the control does.',
          'Tap OPEN THE GUIDE FOR THIS SCREEN in the note to read the full page, or CLOSE.',
          'While tip mode is on, buttons do not press and nothing saves. If a button seems dead, check whether ? TIPS is lit.',
          'Tap ? TIPS again, or press Esc, to go back to normal.',
        ],
      },
      {
        h: 'GOOD TO KNOW',
        text: [
          'A few buttons have no note yet. The note then says so and offers the guide page for the screen. Rows of records such as a stock item have a short note on what tapping them does; the guide page explains the rest.',
          'Typing TIPS at the prompt turns tip mode on and off too.',
        ],
      },
    ],
  },
  {
    key: 'MENU',
    title: 'THE MAIN MENU',
    group: 'FRAME',
    what: 'The home screen: the 8 decks. F2 or 0 always brings you here.',
    blocks: [
      {
        h: 'WHAT YOU SEE',
        items: [
          ['DECK LIST', 'The decks you may open, each with its emblem, a few words on what it holds, and one live figure: kilos picked this week, cash, money owed and so on.'],
          ['ALERTS', 'A deck with something that needs you shows its emblem in amber and a short amber line saying what.'],
          ['STATION DIRECTORY', 'On a desktop the left panel lists every deck and its stations. Tap one to go straight there.'],
          ['STATION BOARD', 'Under the list: a short status of power, water, climate alarms and what is due. Tap it to open REMINDERS (7.8).'],
          ['BACKUP WARNING', 'A line in warning colour appears when your last backup is old. Tap it to open DATA VAULT.'],
          ['THE LOGO', 'The turning globe. It is only decoration.'],
        ],
      },
      { h: 'HOW TO USE IT', steps: ['Tap a deck, or use the up and down arrows and Enter.', 'Or type the deck number (1 to 8) or its name at the > prompt. A station code like 2.3 goes straight to that station.'] },
      { h: 'GOOD TO KNOW', text: ['Staff see only the decks they may open: no TRADE DOCK and no BURSAR.'] },
    ],
  },
  {
    key: 'HELP',
    title: 'HELP (F1)',
    group: 'FRAME',
    what: 'The short list of commands, keys and what they do.',
    blocks: [
      { h: 'WHAT IT IS', text: ['F1 or the word HELP shows every command you can type, grouped by screen, and the keyboard keys. It is a quick reminder. The USER GUIDE is the full explanation.'] },
    ],
  },
  {
    key: 'TUNE',
    title: 'TUNING (8.6, F3)',
    group: '8 MAINFRAME',
    what: 'The look, the sound, language and gloves, saved on this device.',
    blocks: [
      {
        h: 'SECTIONS',
        items: [
          ['LOOK', 'Theme colour, BRIGHTNESS for the whole screen, WIREFRAMES for how bright the species models draw, glass strength (curve, grain, scanlines, glow), CLEAN mode for sunlight.'],
          ['SOUND', 'Sound on or off, the typing sound, chatter or tick mode, volume. TEST buttons play each sound so you can hear it. Sound only plays when something appears on screen.'],
          ['LANGUAGE AND GLOVES', 'English or Spanish, and glove mode.'],
          ['SYSTEM', 'Replay the boot, test the alarm.'],
        ],
      },
      {
        h: 'GOOD TO KNOW',
        text: [
          'These settings belong to this device only. A phone and a laptop each keep their own. They are not part of UNDO.',
          'To drag a meter with the keyboard, focus it and use the arrow keys.',
          'Nothing here is ever greyed out. Moving a glass slider while CLEAN mode is on brings the glass back. Moving a sound slider or pressing a TEST button while sound is muted turns sound back on.',
        ],
      },
    ],
  },
  {
    key: 'STATUS',
    title: 'SYSTEM STATUS',
    group: 'FRAME',
    what: 'The state of the app itself. Type STATUS.',
    blocks: [
      { h: 'WHAT IT SHOWS', text: ['Whether a database is linked or the app is in LOCAL MODE, whether there is network, where stock is stored, whether the offline cache is active, your theme, sound, language, glove mode, role, and when you last backed up. Useful when you are asking someone for help.'] },
    ],
  },
  {
    key: 'LOGIN',
    title: 'LOGIN (F8)',
    group: 'FRAME',
    what: 'Database access. Only needed when a database is linked.',
    blocks: [
      { h: 'TODAY', text: ['The app runs in LOCAL MODE, so there is no login and the page tells you so. When a database is linked later, accounts are made by the owner in the database dashboard. F8 then shows LOGIN or LOGOUT.'] },
    ],
  },
]
