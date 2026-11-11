import type { DeckId } from '../nav/decks'

// Deck emblems: original line drawings in the station-terminal style (nothing traced from any film or game).
// Every stroke has pathLength 1, so CSS can trace it in (.em-draw) and the alert pulse can breathe (.em-alert).
// Drawn in currentColor: they take the screen's one phosphor colour.

const P = { pathLength: 1 } as const

function Bridge() {
  // A helm reticle: outer ring, inner ring, eight spokes, range ticks.
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    return <line key={i} {...P} x1={24 + Math.cos(a) * 7} y1={24 + Math.sin(a) * 7} x2={24 + Math.cos(a) * 21} y2={24 + Math.sin(a) * 21} />
  })
  return (
    <>
      <circle {...P} cx="24" cy="24" r="17" />
      <circle {...P} cx="24" cy="24" r="7" />
      {spokes}
      <circle {...P} cx="24" cy="24" r="1.6" className="em-fill" />
      <path {...P} d="M24 3v3M24 42v3M3 24h3M42 24h3" />
    </>
  )
}

function Grow() {
  // A fruiting body inside a hex frame: cap, gills, stem, and the substrate line.
  return (
    <>
      <path {...P} d="M24 3 42 13.5v21L24 45 6 34.5v-21Z" />
      <path {...P} d="M12.5 24c0-7.5 5.2-12.5 11.5-12.5S35.5 16.5 35.5 24Z" />
      <path {...P} d="M16 24l2.2 2.4M20 24l1.2 2.6M24 24v2.8M28 24l-1.2 2.6M32 24l-2.2 2.4" />
      <path {...P} d="M21.6 26.8c.6 4.2.2 7.6-1.2 10.6h7.2c-1.4-3-1.8-6.4-1.2-10.6" />
      <path {...P} d="M13 37.4h22" />
    </>
  )
}

function Xenolab() {
  // A petri dish seen from above: rim, agar edge, a colony with branching hyphae.
  return (
    <>
      <circle {...P} cx="24" cy="24" r="19" />
      <circle {...P} cx="24" cy="24" r="16" />
      <circle {...P} cx="21" cy="25" r="2.4" />
      <path {...P} d="M23.2 23.6c2.6-2.4 5-3.2 8-3.6M29 20.2l2.6-3.6M27.6 21l3.4.6" />
      <path {...P} d="M19.2 23.2c-2-2.8-2.6-5.6-2.2-8.6M17.4 18.4l-3.2-1.4M17.1 16.4l2.1-2.6" />
      <path {...P} d="M21.6 27.4c.4 3 1.8 5.4 4.2 7.4M24.2 32.4l3.4-.6M23.4 30.8l-2.6 2.8" />
      <path {...P} d="M18.6 26.4c-2.8 1-5 .8-7.2-.4" />
    </>
  )
}

function Cargo() {
  // Stacked crates with straps and a manifest tag.
  return (
    <>
      <rect {...P} x="5" y="25" width="17" height="16" />
      <rect {...P} x="26" y="25" width="17" height="16" />
      <rect {...P} x="14" y="8" width="17" height="16" />
      <path {...P} d="M5 33h17M26 33h17M14 16h17M13.5 25v16M34.5 25v16M22.5 8v16" />
      <path {...P} d="M33 9.5l5-3.5 3 4.4-5 3.4Z" />
      <circle {...P} cx="37.2" cy="9.2" r="0.9" className="em-fill" />
    </>
  )
}

function Trade() {
  // A docking clamp: two brackets meeting, an arrow in and an arrow out.
  return (
    <>
      <path {...P} d="M18 10H9v28h9M30 10h9v28h-9" />
      <path {...P} d="M14 17h7M14 31h7M27 17h7M27 31h7" />
      <path {...P} d="M3 20h17l-4-4M20 20l-4 4" />
      <path {...P} d="M45 28H28l4-4M28 28l4 4" />
    </>
  )
}

function Bursar() {
  // A vault dial with the colon sign drawn in the middle.
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6
    return <line key={i} {...P} x1={24 + Math.cos(a) * 16} y1={24 + Math.sin(a) * 16} x2={24 + Math.cos(a) * (i % 3 === 0 ? 20 : 18)} y2={24 + Math.sin(a) * (i % 3 === 0 ? 20 : 18)} />
  })
  return (
    <>
      <circle {...P} cx="24" cy="24" r="21" />
      <circle {...P} cx="24" cy="24" r="11" />
      {ticks}
      <path {...P} d="M28.2 20.2a5.4 5.4 0 1 0 0 7.6" />
      <path {...P} d="M22.6 17.6l-2 12.8M26 17.6l-2 12.8" />
    </>
  )
}

function Engineering() {
  // A turbine fan: housing, five swept blades, the hub.
  const blades = Array.from({ length: 5 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 5
    const r = (rad: number, ang: number) => `${(24 + Math.cos(ang) * rad).toFixed(2)} ${(24 + Math.sin(ang) * rad).toFixed(2)}`
    return <path key={i} {...P} d={`M${r(5, a)} Q${r(13, a + 0.15)} ${r(17, a + 0.75)} L${r(13, a + 1.05)} Q${r(9, a + 0.7)} ${r(5, a + 0.62)}`} />
  })
  return (
    <>
      <circle {...P} cx="24" cy="24" r="20.5" />
      <circle {...P} cx="24" cy="24" r="18" />
      {blades}
      <circle {...P} cx="24" cy="24" r="4" />
      <circle {...P} cx="24" cy="24" r="1.2" className="em-fill" />
    </>
  )
}

function Mainframe() {
  // Stacked core drives with lamps and vents.
  return (
    <>
      {[6, 18, 30].map((y) => (
        <g key={y}>
          <rect {...P} x="7" y={y} width="34" height="10" rx="1.5" />
          <path {...P} d={`M12 ${y + 3}h12M12 ${y + 7}h12`} />
          <circle {...P} cx="33" cy={y + 5} r="1.4" className="em-fill" />
          <circle {...P} cx="37.5" cy={y + 5} r="1.4" />
        </g>
      ))}
      <path {...P} d="M24 40v4M17 44h14" />
    </>
  )
}

const DRAW: Record<DeckId, () => React.ReactElement> = {
  bridge: Bridge,
  grow: Grow,
  xenolab: Xenolab,
  cargo: Cargo,
  trade: Trade,
  bursar: Bursar,
  engineering: Engineering,
  mainframe: Mainframe,
}

/** One deck's emblem. `draw` traces it in once; `alert` adds the slow amber pulse. */
export function Emblem({ id, size = 40, draw = false, alert = false, className = '' }: { id: DeckId; size?: number; draw?: boolean; alert?: boolean; className?: string }) {
  const D = DRAW[id]
  return (
    <svg className={`emblem em-${id} ${draw ? 'em-draw' : ''} ${alert ? 'em-alert' : ''} ${className}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <D />
    </svg>
  )
}
