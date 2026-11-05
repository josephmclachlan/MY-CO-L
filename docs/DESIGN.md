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

Idle is the quiet room hum only. The optional ambience layer (rumble + air hiss) is off by default.
CHATTER mode (default) chatters while text prints; TICK mode gives one tick per line or action.
Glitches (dropouts and crackle) only happen while text is printing, and always with a visual glitch.

## Data

Growing facts come only from Joseph's own files (Cap n Stem final). Money in colones (₡) first, US$ second,
electricity at the real ICE tariff. One lot code (species letter + knock date MMDD, e.g. B1020) ties
everything together.

## Adding a module

Each module replaces its `Pending` placeholder in `src/App.tsx` (see `MODULES` in `src/data/farm.ts`).
