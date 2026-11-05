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
