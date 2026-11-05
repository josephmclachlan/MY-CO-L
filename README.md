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
- Supabase database schema for the whole data model (`supabase/migrations/0001_initial_schema.sql`) and email login.
- Installable, offline-capable web app (PWA).
- Deploys to GitHub Pages now and Cloudflare Pages at launch.

Modules 1-9 show "NOT YET INSTALLED" until their build threads land.

## Setting it up

Step-by-step, no git commands needed: **[docs/SETUP.md](docs/SETUP.md)**.

## For developers

```bash
npm install
npm run dev            # local dev server
npm run build          # production build into dist/
npm run build:preview  # single-file test copy for a private claude.ai link
```

Copy `.env.example` to `.env.local` to point a local copy at Supabase. Without it the app runs in LOCAL MODE.

Stack: React + TypeScript + Vite, vite-plugin-pwa, Supabase. No sound or font files are fetched from the
internet; fonts are bundled, sounds are synthesised.
