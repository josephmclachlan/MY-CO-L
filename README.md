# MY/CO/L

**MYcological COntrol Lattice** ("MYCOL"). The farm terminal for Negra Bay Biologics, Talamanca Station
(Playa Negra, Puerto Viejo de Talamanca, Limón, Costa Rica).

An original late-1970s industrial sci-fi terminal that will run the whole farm: species readouts, the
power panel, rooms, stock, cultures, cooks, costs and sales. It works offline on phone and laptop.

## What's in build 1 (foundation)

- Boot sequence, main menu with an F1-F8 key bar and a `>` command prompt, help, status and tuning screens.
- Four screen themes (PHOSPHOR, CRYO, SODIUM, ALERT), fonts Michroma, Share Tech Mono / VT323 and Barlow Condensed.
- CRT glass: phosphor glow, scanlines, a real convex bulge, edge colour fringing, glare, grain and flicker,
  all on one strength slider, plus CLEAN mode for sunlight.
- Sound made in code (Web Audio). Every sound is tied to something appearing on screen. See `docs/DESIGN.md`.
- Supabase database schema for the whole data model (`supabase/migrations/0001_initial_schema.sql`, then `0002_cargo_and_owner_lock.sql` for CARGO and owner-only security, then `0003_genetics.sql` for XENOGENETICS, `0004_hazard_links.sql` for the HAZARD INDEX, `0005_cook_log.sql` for PROPULSION, `0006_ledger_trade.sql` for LEDGER and TRADE) and email login.
- Installable, offline-capable web app (PWA).
- Deploys to GitHub Pages now and Cloudflare Pages at launch.

## What's in build 2 (power and rooms)

- **VITALS (module 2):** every breaker from the electrical package (main panel, S1-S18) as a box you tap on or off.
  Live L1/L2 amps against the 125 A meter, a hatched load meter, feeder voltage drop and the sub-panel feed.
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
- Typed commands: `LEDGER`, `COST`, `BILLS`, `LABOUR`, `TRADE`, `SALE`, `TOTALS`, `BUYERS`.
- Best guesses show GUESS - REVIEW on screen and are listed under SWITCHES + GUESSES (LEDGER) and GUESSES (TRADE).

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
