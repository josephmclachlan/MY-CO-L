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
- Supabase database schema for the whole data model (`supabase/migrations/0001_initial_schema.sql`, then `0002_cargo_and_owner_lock.sql` for CARGO and owner-only security) and email login.
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
