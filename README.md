# MY/CO/L

**MYcological COntrol Lattice** ("MYCOL"). The farm terminal for Negra Bay Biologics, Talamanca Station
(Playa Negra, Puerto Viejo de Talamanca, Limón, Costa Rica).

An original late-1970s industrial sci-fi terminal that will run the whole farm: species readouts, the
power panel, rooms, stock, cultures, cooks, costs and sales. It works offline on phone and laptop.

## How it is laid out: decks and stations (11 Nov 2026)

The screens are grouped into 8 decks, each with its stations (one job each): 1 BRIDGE, 2 GROW DECK, 3 XENOLAB,
4 CARGO HOLD, 5 TRADE DOCK, 6 BURSAR, 7 ENGINEERING, 8 MAINFRAME. Type 1 to 8 at the prompt for a deck, 5.3 for
deck 5 station 3, or a deck or station name. Each deck opens to an overview page of figures and charts.

- The map: `src/nav/decks.ts` (every screen and tab has exactly one home station; `decks.test.ts` checks it).
- Deck overview pages: `src/screens/Decks.tsx`, figures in `src/lib/overview.ts`, chart parts in `src/components/Charts.tsx`.
- The user guide follows the same map: `docs/USER-MANUAL.md` (made by `npm run docs:guide`).

The module numbers in the build notes below are the old menu numbers. Typing 9 to 23 no longer opens a screen;
the screen names still work.

## What's in build 1 (foundation)

- Boot sequence, main menu with an F1-F8 key bar and a `>` command prompt, help, status and tuning screens.
- Four screen themes (PHOSPHOR, CRYO, SODIUM, ALERT), fonts Michroma, Share Tech Mono / VT323 and Barlow Condensed.
- CRT glass: phosphor glow, scanlines, a real convex bulge, edge colour fringing, glare, grain and flicker,
  all on one strength slider, plus CLEAN mode for sunlight.
- Sound made in code (Web Audio). Every sound is tied to something appearing on screen. See `docs/DESIGN.md`.
- Supabase database schema for the whole data model (`supabase/migrations/0001_initial_schema.sql`, then `0002_cargo_and_owner_lock.sql` for CARGO and owner-only security, then `0003_genetics.sql` for XENOGENETICS, `0004_hazard_links.sql` for the HAZARD INDEX, `0005_cook_log.sql` for PROPULSION, `0006_ledger_trade.sql` for LEDGER and TRADE, `0007_app_settings.sql` for PRICES + COSTS, `0008_fx_rates.sql` for the daily exchange rate) and email login.
- Installable, offline-capable web app (PWA).
- Deploys to GitHub Pages now and Cloudflare Pages at launch.

## What's in build 2 (power and rooms)

- **VITALS (module 2):** every breaker from the electrical package (main panel, S1-S18) as a box you tap on or off.
  Live L1/L2 amps against the 155 A feeder, a hatched load meter and feeder voltage drop. One breaker box (slots 1-32 as wired), fed by the grid or the DuroMax XP17500HX through an interlock.
  Utility or generator (fuel, capacity slider, presets), steam heater option A (2 x 4,500 W) or B (1 x 6,500 W),
  one-tap presets, and rule warnings (one heat load at a time, generator overloads, heater + AC on the generator,
  ICE peak windows 10:00-12:30 and 17:30-20:00 in Costa Rica time). Estimated wattages can be edited on screen.
- **DECK PLAN (module 3):** a line drawing of the lab, packing, boiling room, incubation and fruiting, traced from the
  farm floor plan. Tap a room for its equipment, circuits, live load and set points. Empty sensor and inventory
  panels wait for later builds. Hazard trim in generator mode and on any room in alarm.
- The breaker board is shared: a breaker flipped on one screen shows on the other. Typed commands: `GEN`, `UTILITY`,
  `HEATER A`/`HEATER B`, `BASELINE`, `EMERGENCY`, a breaker tag such as `S4`, or a room name.
- The electrical model lives in one file, `src/data/power.ts`. `npm test` checks it against all 30 rows of the
  package's `operating_scenarios.csv` (copied to `src/data/electrical/`).

Room names and where each machine sits are marked UNCONFIRMED on screen until checked.

Modules 1 and 4-9 show "NOT YET INSTALLED" until their build threads land.

## What's in the genetics build (XENOGENETICS, module 5)

- **Strains:** register each strain (code like LM-01, species, name, source; Cap n Stem by default), retire or edit it.
  SPECIMEN FILES lists the strains on file for each species and opens them here.
- **Stock:** live cultures per strain counted by level on hatched meters (master = P0, then P1-P4), LC, G1 masters
  and G2 bags on the shelf, and cold-storage and age warnings with the textbook fact behind each limit.
- **Lineage:** a line-art tree per strain, master to plates, LC, G1, G2 and block lots. Tap a node to log a transfer,
  a G1 or G2 run, a block lot, a move to the fridge, or contamination.
- **Planner:** starts from the 130-bag weekly plan and works back to G2 bags, G1 masters and plates per strain with
  dates, then checks the shelf and flags shortfalls. Ratios from t07 and t09, shown with their fact ids.
- **Labels:** printable QR labels for cultures and grain runs; scanning one opens that record.
- P-level rule (confirmed by Joseph): a plate is one level up from what it came from; slants, water tubes, cryovials
  and LC keep their parent's level. Code: `childP()` in `src/lib/xeno.ts`.

## What's in the costs and sales build (LEDGER and TRADE)

- **LEDGER (module 8):** cost per block and per kg, by species and by knock week, in ₡ first and US$ second.
  Five parts, each tagged ACTUAL, ESTIMATE, MIXED or NO DATA: consumables (CARGO stock moves at the last price,
  else the run plan), cook energy (PROPULSION runs, else the planned week), room energy (the ICE bill less cook runs,
  shared by bag-days in the rooms), labour (hours x your rate, switch on by default, rate blank) and equipment wear
  (off by default). Kilos come from harvests, else Catawba yields. A PLAN WEEK of 130 blocks shows the cost before
  any data exists.
- **ICE bills:** type kWh, billed kW and the ₡ total; the screen checks it against the binomic tariff. With no bill,
  a month uses the electrical package estimate (₡362,000-422,000, tagged ESTIMATE).
- **Labour hours:** a quick log (day, who, hours, task, optional lot).
- **TRADE (module 9):** a phone sale form (buyer, channel, species, fresh or dried, grade, kg, ₡, lot codes) that
  fills the price and the buyer's usual channel for you. Totals and bar charts by channel and product, ₡ per week,
  margin against LEDGER's cost per kg, a buyer list and the sales log.
- **PRICES + COSTS** (LEDGER, or type `PRICES`): every price and cost in one place. Sale price per species, fresh
  and dried; supply prices (added to CARGO's price history); the ICE tariff and the monthly estimate; labour rate and
  wear; ₡ per US$ by day. Blank = the built-in figure. Saved for the whole farm (`app_settings`), so devices agree.
- Typed commands: `LEDGER`, `COST`, `BILLS`, `LABOUR`, `PRICES`, `TRADE`, `SALE`, `TOTALS`, `BUYERS`.
- Best guesses show GUESS - REVIEW on screen and are listed under SWITCHES + GUESSES (LEDGER) and GUESSES (TRADE).

## What's in the search, export, staff and Spanish build (modules 19 to 21)

- **SEARCH (19):** type a code, a name or any words (accents and capitals do not matter) and open any record or screen:
  lots, harvests, strains, cultures, grain runs, cook runs, stock items, facility logs, sensors, species, hazards and (owner
  only) sales, orders, money entries, power bills and labour. At the `>` prompt anything that is not a command is searched too;
  an exact code (`B1020`, `BO-01`) opens straight away. **CHANGE MANY AT ONCE** ticks many records and applies one change
  (status, place, grade, paid/owed/written off, delete) or a **STOCK TAKE** (one count move per item that differs). Each is one UNDO step.
- **DATA (20, owner only):** **SAVE EVERYTHING (ZIP)** (a restorable `backup.json`, one CSV per table, a README), a single-table CSV,
  and **RESTORE** that shows what would change before it does (merge, or exact copy with a safety backup first). A reminder
  shows when the last backup is over 7 days old. Typed: `BACKUP`, `EXPORT`, `RESTORE`.
- **STAFF (21):** two roles. STAFF logs the work and sees no money (screens, search results, prices, history); the database
  refuses it too (migration `0016`). Linked mode takes the role from the login (`app_metadata`), local mode from an owner PIN that
  locks the device. See `docs/SETUP.md`.
- **Glove mode** (`GLOVE`, TUNE): bigger buttons and a number pad for gloved hands. **Spanish** (`SPANISH` / `ENGLISH`, TUNE):
  the frame, menu, help, the new screens, LOG HARVEST and HARVEST SESSION; the other screens stay English for now.
  The Spanish was written by Claude and needs a native reader (`src/lib/es.ts`; a test fails if a string has no entry).

## What's in the farm assistant build (ASK MY/CO/L, module 22)

- Type a question or a command in plain words, on the ASK screen or at the `>` prompt on any screen
  (start with ASK, end with ?, or begin with HOW / WHO / LOG / SHOW ...). Examples: "how many LM blocks are
  fruiting", "who owes money", "log 4.2 kg from B1020", "power is out", "show the power cut log".
- It knows ONLY this app's records and screens. Every answer names the screen it came from, with a button to open it.
- Saves (harvest, power cut, climate reading, lot status, stock in/out, buyer paid) are shown first and wait for
  CONFIRM (or typing YES). Each save is one UNDO step and goes in the edit history marked ASSISTANT.
- STAFF never get money answers: the money tools are not offered to them, and a refusal comes back instead.
- Brains: a rule parser that needs nothing (always on), plus an optional LOCAL model (Ollama or llama.cpp on the
  farm PC) set on ASK > ENGINE. No cloud model, no API key. Details and model sizes: [docs/ASSISTANT.md](docs/ASSISTANT.md).
- Migration `0017` lets the edit history record the ASSISTANT source.

## User guide and tooltips (module 23, build G11)

- **USER GUIDE** (module 23, or type `GUIDE`): plain-English pages for every screen, the keys, saving and UNDO, plus words and
  what to do when something goes wrong. Type `GUIDE VITALS` (or any screen) for that page. It has its own search box.
  The same text is the printable file [docs/USER-MANUAL.md](docs/USER-MANUAL.md). Edit the pages in `src/guide/pages-*.ts`,
  then run `npm run docs:guide` (a test fails if the file is out of step).
- **Tooltips** on every control: rest the mouse on it, move to it with the keyboard, or on a phone tap **? TIPS** in the status
  line and then tap the control (it shows its note instead of pressing). Esc or ? TIPS again leaves tip mode. Tip text is in
  `src/guide/tips.ts` by label; `data-tip` on an element overrides it. `guide.test.ts` checks every key can match.
- Public build: yes. It is about the app, not the textbook; the textbook still stays in the private copy only.

## Setting it up

Step-by-step, no git commands needed: **[docs/SETUP.md](docs/SETUP.md)**.

## For developers

```bash
npm install
npm run dev            # local dev server
npm run build          # production build into dist/
npm run build:preview  # single-file test copy for a private claude.ai link
npm test               # checks the power model against the electrical package
```

Copy `.env.example` to `.env.local` to point a local copy at Supabase. Without it the app runs in LOCAL MODE.

Stack: React + TypeScript + Vite, vite-plugin-pwa, Supabase. No sound or font files are fetched from the
internet; fonts are bundled, sounds are synthesised.
