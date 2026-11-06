# MY/CO/L design rules

Read this before building any screen. The full plan is the "Farm terminal app plan" doc in the Muthr project.

## Original only

No MU/TH/UR, Weyland-Yutani, Nostromo, or any film or game names, logos, sounds, typefaces or exact layouts.
We use the genre's habits (one phosphor colour, thin boxes, inverse title bar, F-key bar, typed replies),
never the screens themselves.

## Look

- One phosphor colour per screen: PHOSPHOR green (default), CRYO cyan, SODIUM amber, ALERT red.
- Red-orange (`--warn`) only for warnings and overdue items. Yellow-black dashed hazard trim (`.hazard-box`)
  for generator mode or a room in alarm.
- Michroma for headings, Share Tech Mono (or VT323) for data, Barlow Condensed (`.sign`) for small sign text.
- Every screen lives inside `Shell` (title bar, status line, right-hand index, prompt, hint line, F-key bar),
  which lives inside `Crt` (the glass). New screens must stay inside both so the glass effects apply.
- Interface voice: terse, all caps, our own status lines. Boot and idle "noise" uses real farm codes
  (lot codes, breaker tags, strain IDs), never nonsense.
- **Wireframes, and every mushroom 3D model, turn slowly whenever they are on screen** (Joseph, 5 Nov 2026).
  Wrap them in `.spin` or rotate the Three.js model at a similar pace (about one turn every 25 s).
  Respect `prefers-reduced-motion`.

## Sound follows the screen (Joseph, 5 Nov 2026)

No sound plays on its own. Each sound is called at the moment something appears on screen:

| On screen | Call (`useApp().sound`) |
| --- | --- |
| Text typing out | handled by `<TypeText>` (one blip per step) |
| Columns of data filling, wireframes drawing, tables loading | `beginData()` ... `endData()` (or `<DataColumns>`) |
| A screen "working" | `droneOn()` ... `droneOff()` |
| Screen powers on | `swoop()` |
| Screen changes | `chirp()` (App does this) |
| Menu appears / command accepted | `confirm()` |
| Access granted / record saved | `granted()` |
| Login / entering CORE | `whoosh()` |
| PROCESSING indicator | `warble()` |
| ALERT flash | `alarm(true)` ... `alarm(false)` |

Typing has two voices. **CLACK** (default) is chonky and clacky (Joseph, 5 Nov 2026): a heavy mechanical
keyboard, a typewriter, a scantron reader and an 80s tractor-feed printer. Each step is a switch click,
a metal strike and a heavy bottom-out thock; long readouts (3+ characters per step) sound like a dot-matrix
head; each new line gets a paper-feed ratchet. **BLIP** is the electronic voice from the first sound study.

Idle is the quiet room hum only. The optional ambience layer (rumble + air hiss) is off by default.
CHATTER mode (default) chatters while text prints; TICK mode gives one tick per line or action.
Glitches (dropouts and crackle) only happen while text is printing, and always with a visual glitch.

## Data

Growing facts come only from Joseph's own files (Cap n Stem final). Money in colones (₡) first, US$ second,
electricity at the real ICE tariff. One lot code (species letter + knock date MMDD, e.g. B1020) ties
everything together.

## Data store (every module reuses it)

`src/lib/store.ts` is one small store over the tables in `supabase/migrations`. Screens call
`useTable('items')` (from `src/store/StoreContext.tsx`) and `store.put / store.del`; they never talk to a backend.

- **Local mode** (Supabase not linked): rows live in the browser's IndexedDB (`localdb.ts`). If the browser
  blocks storage the store falls back to memory and CARGO says nothing is being saved.
- **Linked mode**: the same calls go to Supabase (`remotedb.ts`) and every read is cached, so the screens still
  open offline (read only). Row level security (migration 0002) allows only users in `allowed_users`.
- **Backup**: `exportJson` / `importJson` (CARGO buttons). Import merges by id after checking the whole file.
- A new module needs no database changes in local mode: its table names are already in `BACKUP_TABLES`.
  A new Supabase table must end its migration with `select public.owner_only('public.the_table');`.

CARGO keeps no stored count. An item's on-hand is the sum of its `stock_moves` (+ delivery, - use, +/- count),
so history and count cannot disagree. `src/lib/stockplan.ts` works out a run's use from textbook facts
(each line names its fact ID) and feeds both "weeks left" and the COMMIT RUN button.

## Adding a module

Each module replaces its `Pending` placeholder in `src/App.tsx` (see `MODULES` in `src/data/farm.ts`).

## HAZARD INDEX (build 8)

The contaminant library is data, not database rows: `src/data/hazards/*.json` (one file per group, loaded by
`index.ts`). Each entry has spot / look-alikes / cause / treat / prevent / risk facts, every fact with textbook
fact IDs (WHY? opens them; the textbook text itself stays out of the public build), plus colour, smell, texture,
place and stage tags that feed the DIAGNOSE helper (`src/lib/hazard.ts`). Entries have text ids (`neurospora`).
Losses are logged against those ids: `hazard_logs` (cultures and grain runs, new in migration 0004) and
`lot_losses.hazard_key` (block lots). The library shows the counts. Species HAZARDS facts carry `hz` to open an entry.
The sources name no yeast contaminant, so the YEAST kind is deliberately empty.

## PROPULSION: the cook and sterilization log (build 9)

Screen `src/screens/Propulsion.tsx` (parts in `CookParts.tsx`), logic `src/lib/cook.ts` (pure, tested in
`cook.test.ts`), writes `src/lib/cookActions.ts`, targets and the sheet layout `src/data/cook.ts`.

- A run is a `cook_runs` row (steam box, 75X, MegaChef or other) with `cook_readings` (zone + temp_f, or psi for a
  gauge). The numbers on the run row (come-up, minutes above 190 / 198 / 200 / 205 F, max, F value, kWh, cost,
  result) are worked out again from the readings after every change; the readings are the source.
- Curves are straight lines between readings, so "minutes above 200 F" is exact at the crossing, not rounded to the
  reading interval. Bands below 200 F count only the way up (the cool-down is not mixed in). The slowest bag core
  decides the run; zones named AIR, GAUGE or ROOM are not judged.
- Targets: Joseph's sheet (6-8 h above 190 F, 4.5-5 h above 198 F, 4-6 h above 200 F, under 3 h above 205 F,
  under 1 h in 115-140 F, F at 97 C / 206 F 6-8 ideal), the confirmed 4 h hold, Avery's 75X (1 h 45 min at 17 psi)
  and MegaChef (10-12 min to pressure, 12-15 min cook). Every row on the screen shows its source. Anything that is a
  guess shows GUESS - REVIEW (and `guess: true` in `src/data/cook.ts`). Textbook sentences live in
  `src/data/cook/context.json`, which the public build empties (vite `hazard-text-gate`, now also covering `cook`).
- Energy: meter reading, else heater on-time x element watts, else an estimate from a power profile (full power to
  come-up, then 1.5 kW for the steam box; 1.2 kW per MegaChef pot; 1.65 kW for the 75X). Cost at ICE binomic
  ₡59.67/kWh, shown with 16% taxes too. The same profile is intersected with the ICE peak windows (CR time, UTC-6).
- Logger import: any CSV with a time column and one column per probe (header search, delimiter and date order
  detection, unit per column, probe names mapped by you). Clock times are read as Costa Rica time.
- Print: `PrintSheet` mounts a `.cook-print` block under `<body>`; the print CSS hides everything else and sets
  letter landscape. The columns, colours and heading text follow `templates/substrate-temperature-log.pdf`.
- Loads: `block_lots.cook_run_id` and `grain_runs.cook_run_id` (both columns exist since migration 0001) link the
  food that came out of a run. Losses logged in XENOGENETICS and the HAZARD INDEX show on the run.
- Migration `0005_cook_log.sql` adds the columns the screen keeps (run it after 0004). Local mode needs nothing.

## LEDGER and TRADE (costs and sales)

- Maths in `src/lib/ledger.ts` (cost parts, bag-day sharing, plan week) and `src/lib/trade.ts` (totals, buyers,
  margin); constants with their sources in `src/data/ledger.ts`; tests in `ledger.test.ts` and `trade.test.ts`.
- `src/store/useLedger.ts` reads every table LEDGER needs and is shared with TRADE (margin = sale ₡ less LEDGER
  cost per kg x kg, fresh only). LEDGER switches (labour, rate, wear) are saved on the device.
- The ICE bill check is the package's own formula (`calculations/build_data.py`): (₡7,924.29 fixed + ₡59.67/kWh +
  ₡9,861.68 per kW above 8 kW, 10 kW minimum) x 1.16.
- Every part carries a basis (ACTUAL, ESTIMATE, MIXED, NONE) and notes; the screen shows a tag for anything that is
  not ACTUAL. Nothing here comes from the textbook, so there is no text gate to add.
- Migration `0006_ledger_trade.sql` adds `sales.species_key`, `sales.lot_codes` and the `delivery` channel.
- PRICES + COSTS: `src/lib/rates.ts` holds the one `Rates` record (defaults with sources, `mergeRates`, a live copy the
  pure maths reads through `rates()`). `src/store/useRates.ts` loads row `rates` of `app_settings` (migration 0007) and
  updates the live copy; App calls it once so every screen's maths sees changes. Cook runs are re-priced from their kWh
  at the current rate. The CARGO exchange rate reads and writes the same record.
- Exchange rate by day: `src/lib/fx.ts` + `src/store/useFx.ts`, table `fx_rates` (one row per day, migration 0008).
  Amounts are stored in colones only; US$ is shown at the record's own day (sale day, price day, lot knock day, bill
  month end, labour day). Today's rate is fetched once a day when online (fawazahmed0 currency-api on jsDelivr, mirror
  on pages.dev, then open.er-api.com); past days that records need are back-filled from the same dated feed. A typed
  rate (MANUAL) is never overwritten. With no rate on or before a day: the first later rate, then the fallback in
  PRICES + COSTS. Aggregates carry `usd` (sum of each part at its own rate), shown via an effective rate.
