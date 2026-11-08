import { useEffect } from 'react'
import { useApp } from '../settings/AppContext'
import { usePower } from '../power/PowerContext'
import { allCircuits, OUTLET_ROOM, type Circuit } from '../data/power'
import { ROOMS, roomAlarms, roomById, type Room } from '../data/rooms'
import { RoomClimate } from './Climate'
import { itemWatts, type Warning } from '../lib/power'
import { TypeText } from '../components/TypeText'
import { useCargo } from '../store/useCargo'
import { fmtQty } from '../lib/cargo'
import { BreakerBox, fmtW } from './Vitals'

// Equipment glyphs on the plan. Each lights up when its breaker is on.
// Positions follow Joseph's room-by-room list of 8 Nov 2026 (see data/rooms.ts
// for the container layout and scale).
type Glyph = { item: string; kind: 'box' | 'disc' | 'fan' | 'ac' | 'light' | 'meter'; x: number; y: number; w?: number; h?: number; r?: number }

const T5_ROW = (y: number): Glyph[] => Array.from({ length: 8 }, (_, i) => ({ item: 't5', kind: 'light' as const, x: 290 + i * 46, y, w: 36, h: 3 }))

const GLYPHS: Glyph[] = [
  // lab: two FFUs on the back-left table, one in the wall to packing
  { item: 'ffu', kind: 'box', x: 68, y: 52, w: 26, h: 56 },
  { item: 'ffu', kind: 'box', x: 98, y: 52, w: 26, h: 56 },
  { item: 'ffu', kind: 'box', x: 104, y: 313, w: 56, h: 14 },
  { item: 'aa75x', kind: 'disc', x: 150, y: 70, r: 13 },
  { item: 'stir', kind: 'disc', x: 141, y: 151, r: 6 },
  { item: 'stir', kind: 'disc', x: 157, y: 151, r: 6 },
  { item: 'stir', kind: 'disc', x: 141, y: 167, r: 6 },
  { item: 'stir', kind: 'disc', x: 157, y: 167, r: 6 },
  { item: 'zvs', kind: 'box', x: 136, y: 190, w: 18, h: 10 },
  { item: 'sealer', kind: 'box', x: 68, y: 200, w: 40, h: 10 },
  { item: 'chest', kind: 'box', x: 128, y: 250, w: 36, h: 30 },
  { item: 's4-lab', kind: 'fan', x: 76, y: 296, r: 7 },
  { item: 'led-lab', kind: 'light', x: 70, y: 150, w: 40, h: 5 },
  { item: 'led-lab', kind: 'light', x: 70, y: 245, w: 40, h: 5 },
  // packing: two 36k units, storage, bagger, intake
  { item: 'lennox36a', kind: 'ac', x: 68, y: 330, w: 40, h: 40 },
  { item: 'lennox36b', kind: 'ac', x: 68, y: 380, w: 40, h: 40 },
  { item: 'led-pack', kind: 'light', x: 68, y: 440, w: 40, h: 5 },
  { item: 'led-pack', kind: 'light', x: 68, y: 455, w: 40, h: 5 },
  { item: 'thor', kind: 'box', x: 70, y: 522, w: 44, h: 30 },
  { item: 'pump', kind: 'disc', x: 128, y: 537, r: 8 },
  { item: 'co2-pack', kind: 'meter', x: 150, y: 560, w: 8, h: 8 },
  { item: 's10', kind: 'fan', x: 150, y: 586, r: 10 },
  // cook room: boiler with two elements, steam box cart, four MegaChefs
  { item: 'heat-c12', kind: 'box', x: 180, y: 58, w: 44, h: 30 },
  { item: 'heat-c12b', kind: 'box', x: 180, y: 92, w: 44, h: 30 },
  { item: 'mega1', kind: 'disc', x: 199, y: 200, r: 13 },
  { item: 'mega2', kind: 'disc', x: 233, y: 200, r: 13 },
  { item: 'mega3', kind: 'disc', x: 199, y: 234, r: 13 },
  { item: 'mega4', kind: 'disc', x: 233, y: 234, r: 13 },
  // incubation (lower container)
  { item: 'lennox12a', kind: 'ac', x: 330, y: 492, w: 50, h: 14 },
  { item: 'lennox12b', kind: 'ac', x: 560, y: 492, w: 50, h: 14 },
  { item: 'co2-inc', kind: 'meter', x: 186, y: 498, w: 8, h: 8 },
  { item: 's4-inc', kind: 'fan', x: 720, y: 506, r: 8 },
  { item: 'led-inc', kind: 'light', x: 300, y: 540, w: 40, h: 5 },
  { item: 'led-inc', kind: 'light', x: 450, y: 540, w: 40, h: 5 },
  { item: 'led-inc', kind: 'light', x: 600, y: 540, w: 40, h: 5 },
  { item: 'floorfan', kind: 'fan', x: 236, y: 588, r: 9 },
  { item: 'floorfan', kind: 'fan', x: 400, y: 588, r: 9 },
  { item: 'floorfan', kind: 'fan', x: 560, y: 588, r: 9 },
  { item: 'floorfan', kind: 'fan', x: 716, y: 588, r: 9 },
  // fruiting (upper container)
  { item: 'co2-fruit', kind: 'meter', x: 250, y: 356, w: 8, h: 8 },
  { item: 's8', kind: 'fan', x: 228, y: 376, r: 9 },
  { item: 's8', kind: 'fan', x: 228, y: 438, r: 9 },
  { item: 'tac', kind: 'box', x: 246, y: 396, w: 22, h: 20 },
  { item: 'inkbird', kind: 'meter', x: 744, y: 354, w: 8, h: 8 },
  { item: 'hurricane', kind: 'fan', x: 757, y: 376, r: 10 },
  { item: 'hurricane', kind: 'fan', x: 757, y: 438, r: 10 },
  ...T5_ROW(398),
  ...T5_ROW(406),
  // outside under the roof: two Fogel 3-door reach-ins against the fruiting
  // long wall, left of the back door (door about 1 m from the back end)
  { item: 'fogel1', kind: 'box', x: 496, y: 312, w: 90, h: 34 },
  { item: 'fogel2', kind: 'box', x: 590, y: 312, w: 90, h: 34 },
]

function rackRows(x0: number, y0: number, count: number, rows: number[], w: number, h: number) {
  const out: { x: number; y: number }[] = []
  for (const y of rows) for (let i = 0; i < count; i++) out.push({ x: x0 + i * (w + 8), y: y0 + y })
  return out.map((p, i) => <rect key={i} x={p.x} y={p.y} width={w} height={h} className="deck-rack" />)
}

/** Which circuit feeds an item, and whether it is on. */
function useItemIndex() {
  const { config, on } = usePower()
  const map = new Map<string, Circuit>()
  for (const c of allCircuits(config.heater)) for (const i of c.items) map.set(i.id, c)
  return { map, lit: (item: string) => !!map.get(item) && on.has(map.get(item)!.id) }
}

/** A room is in alarm when a climate group is fully off or a broken rule involves its equipment. */
function inAlarm(room: Room, on: Set<string>, warns: Warning[]): boolean {
  return roomAlarms(room, on).length > 0 || warns.some((w) => w.level === 'warn' && w.rooms.includes(room.id))
}

function RoomOutline({ room, selected, alarm, onClick, watts }: { room: Room; selected: boolean; alarm: boolean; onClick: () => void; watts: number }) {
  const { x, y, w, h } = room.rect
  const lx = room.label?.x ?? x + w / 2
  const ly = room.label?.y ?? y + h / 2
  return (
    <g className={`deck-room ${room.id === 'outside' ? 'open' : ''} ${selected ? 'sel' : ''} ${alarm ? 'alarm' : ''}`} onClick={onClick} role="button" tabIndex={0} aria-label={room.name} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <rect x={x} y={y} width={w} height={h} className="deck-hit" />
      <path d={`M${x} ${y}H${x + w}V${y + h}H${x}Z`} pathLength={1} className="deck-wall" />
      {alarm && <rect x={x + 4} y={y + 4} width={w - 8} height={h - 8} className="deck-alarm" />}
      <text x={lx} y={ly - 4} className="deck-label">
        {room.short}
      </text>
      <text x={lx} y={ly + 14} className="deck-kw">
        {(watts / 1000).toFixed(2)} KW
      </text>
    </g>
  )
}

/** The plan drawing: rooms, racks, equipment glyphs, live load per room. */
function Plan() {
  const { sound } = useApp()
  const { reading, on, state, selectedRoom, setSelectedRoom, warns } = usePower()
  const { lit, map } = useItemIndex()
  const gen = state.source === 'generator'

  useEffect(() => {
    sound.beginData()
    const t = window.setTimeout(() => sound.endData(), 1400)
    return () => {
      window.clearTimeout(t)
      sound.endData()
    }
  }, [sound])

  return (
    <div className={`deck-frame ${gen ? 'hazard-box' : ''}`}>
      <svg viewBox="40 20 760 604" className="deck-svg" role="img" aria-label="Plan of the farm with live load by room">
        <g className="deck-detail">
          {/* lab: back-left table under two FFUs, stir-plate bench */}
          <rect x={64} y={48} width={64} height={64} className="deck-rack" />
          <rect x={132} y={140} width={36} height={38} className="deck-rack" />
          {/* packing: material store (soy, sawdust, grain, fruit bags) */}
          {['SOY', 'SAWDUST', 'GRAIN', 'BAGS'].map((t, i) => (
            <g key={t}>
              <rect x={122} y={330 + i * 36} width={44} height={30} className="deck-rack" />
              <text x={144} y={349 + i * 36} className="deck-tag">
                {t}
              </text>
            </g>
          ))}
          {/* cook room: steam box cart */}
          <rect x={232} y={58} width={44} height={92} className="deck-rack" />
          <text x={254} y={108} className="deck-tag">
            CART
          </text>
          {/* incubation shelving (lower) and fruiting racks (upper) */}
          {rackRows(250, 488, 8, [24, 64], 50, 22)}
          {rackRows(300, 350, 7, [14, 64], 48, 26)}
          {/* fruiting back door, opening out to the roofed area */}
          <path d="M686 350H726" className="deck-door" />
          <path d="M726 350V312A38 38 0 0 0 688 350" className="deck-inner" />
          <text x={749} y={330} className="deck-tag">
            BACK
          </text>
          <text x={749} y={342} className="deck-tag">
            DOOR
          </text>
          {/* the upper container sits on the lower one: corner lines */}
          <path d="M172 488L212 462M732 488L772 462M172 600L212 574M732 600L772 574" className="deck-inner faint dash" />
          <text x={452} y={479} className="deck-tag">
            FRUITING SITS ON TOP OF INCUBATION
          </text>
          {/* side view, looking north */}
          <g className="deck-side">
            <text x={320} y={70} className="deck-note">
              SIDE VIEW // STACK
            </text>
            <path d="M310 270H780" className="deck-inner" />
            <rect x={320} y={210} width={50} height={60} className="deck-inner" />
            <text x={345} y={244} className="deck-tag">
              LAB/PACK
            </text>
            <rect x={370} y={210} width={400} height={60} className="deck-inner" />
            <text x={570} y={244} className="deck-tag">
              INCUBATION // LOWER 40 FT
            </text>
            <rect x={370} y={150} width={400} height={60} className="deck-inner" />
            <text x={570} y={184} className="deck-tag">
              FRUITING // UPPER 40 FT
            </text>
            <text x={320} y={292} className="deck-tag start">
              COOK ROOM (20 FT) IS BESIDE THE LAB END
            </text>
          </g>
        </g>
        {ROOMS.map((room) => (
          <RoomOutline
            key={room.id}
            room={room}
            selected={selectedRoom === room.id}
            alarm={inAlarm(room, on, warns)}
            watts={reading.rooms[room.id]}
            onClick={() => {
              if (room.id !== selectedRoom) sound.chirp()
              setSelectedRoom(room.id)
            }}
          />
        ))}
        <g className="deck-glyphs" aria-hidden>
          {GLYPHS.filter((g) => map.has(g.item)).map((g, i) => {
            const cls = `glyph ${lit(g.item) ? 'lit' : ''}`
            if (g.kind === 'disc') return <circle key={i} cx={g.x} cy={g.y} r={g.r} className={cls} />
            if (g.kind === 'fan')
              return (
                <g key={i} className={cls}>
                  <circle cx={g.x} cy={g.y} r={g.r} />
                  <path d={`M${g.x - g.r!} ${g.y}H${g.x + g.r!}M${g.x} ${g.y - g.r!}V${g.y + g.r!}`} />
                </g>
              )
            if (g.kind === 'light')
              return <rect key={i} x={g.x} y={g.y} width={g.w} height={g.h} className={`${cls} light`} />
            if (g.kind === 'meter')
              return (
                <g key={i} className={cls}>
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} />
                  <circle cx={g.x + g.w! / 2} cy={g.y + g.h! / 2} r={1.5} />
                </g>
              )
            if (g.kind === 'ac')
              return (
                <g key={i} className={cls}>
                  <rect x={g.x} y={g.y} width={g.w} height={g.h} />
                  <path d={`M${g.x} ${g.y}L${g.x + g.w!} ${g.y + g.h!}M${g.x + g.w!} ${g.y}L${g.x} ${g.y + g.h!}`} />
                </g>
              )
            return <rect key={i} x={g.x} y={g.y} width={g.w} height={g.h} className={cls} />
          })}
        </g>
        <text x={790} y={330} className="deck-note end">
          N ^
        </text>
        <text x={790} y={616} className="deck-note end">
          {gen ? 'GENERATOR // EMERGENCY POWER' : 'ICE UTILITY'}
        </text>
      </svg>
    </div>
  )
}

/** Everything about the selected room. */
function RoomReadout({ onOpenVitals, onOpenCargo }: { onOpenVitals: () => void; onOpenCargo: () => void }) {
  const { config, on, reading, selectedRoom, warns, state } = usePower()
  const { rows } = useCargo()
  const room = roomById(selectedRoom)!
  const circuits = allCircuits(config.heater)
  const items = circuits.flatMap((c) => c.items.filter((i) => i.room === room.id).map((i) => ({ i, c })))
  const feeds = circuits.filter((c) => c.items.some((i) => i.room === room.id) || OUTLET_ROOM[c.id] === room.id)
  const alarms = [...roomAlarms(room, on), ...warns.filter((w) => w.level === 'warn' && w.rooms.includes(room.id)).map((w) => w.text)]
  const gen = state.source === 'generator'

  return (
    <div className={`room-readout ${alarms.length ? 'hazard-box' : 'box'}`}>
      <TypeText
        key={room.id + alarms.join('|')}
        group={3}
        lines={[
          { text: `${room.name}${room.nameGuess ? '  [NAME UNCONFIRMED]' : ''}`, cls: 'rr-name' },
          ...(room.alt ? [{ text: `CONTAINER: ${room.alt}`, cls: 'dim' }] : []),
          alarms.length
            ? { text: `STATUS: ALARM // ${alarms[0]}`, cls: 'warn' }
            : { text: `STATUS: NOMINAL${gen ? ' // ON GENERATOR' : ''}`, cls: '' },
          ...alarms.slice(1).map((a) => ({ text: `        ${a}`, cls: 'warn' })),
          { text: `LIVE LOAD ${fmtW(reading.rooms[room.id])}`, cls: '' },
        ]}
      />

      <div className="section-title rr-sec">SET POINTS</div>
      <dl className="facts tight">
        {room.setPoints.map((s) => (
          <span key={s.label} style={{ display: 'contents' }}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </span>
        ))}
      </dl>

      <div className="section-title rr-sec">EQUIPMENT</div>
      {items.length === 0 ? (
        <div className="dim">NO POWERED EQUIPMENT ASSIGNED.</div>
      ) : (
        <table className="bd-items">
          <tbody>
            {items.map(({ i, c }) => (
              <tr key={i.id} className={on.has(c.id) ? '' : 'dim'}>
                <td>
                  {i.qty > 1 ? `${i.qty} x ` : ''}
                  {i.name.toUpperCase()}
                  {i.roomGuess && <span className="unconf"> UNCONFIRMED</span>}
                </td>
                <td>{c.tag}</td>
                <td className="num">{on.has(c.id) ? fmtW(itemWatts(i.id, i.w, config.overrides)) : 'OFF'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title rr-sec">CIRCUITS</div>
      <div className="brk-grid small">
        {feeds.map((c) => (
          <BreakerBox key={c.id} c={c} compact />
        ))}
      </div>
      {feeds.some((c) => c.items.some((i) => i.room !== room.id)) && (
        <div className="dim tiny">SOME CIRCUITS ALSO FEED OTHER ROOMS. FLIPPING ONE HERE SWITCHES THE WHOLE CIRCUIT.</div>
      )}
      <button type="button" className="btn" style={{ marginTop: 8 }} onClick={onOpenVitals}>
        OPEN VITALS
      </button>

      <RoomClimate room={room.id} />

      <div className="section-title rr-sec">INVENTORY</div>
      {(() => {
        const mine = rows.filter((r) => r.item.room === room.id)
        const low = mine.filter((r) => r.state === 'LOW' || r.state === 'OUT').length
        return (
          <div className="placeholder">
            {mine.length === 0 ? (
              <div className="dim tiny">NO STOCK ITEMS ARE ASSIGNED TO THIS ROOM. PICK A ROOM ON EACH ITEM IN CARGO.</div>
            ) : (
              <>
                {mine.map((r) => (
                  <div key={r.item.id} className="cg-inv-row">
                    <span className={r.state === 'LOW' || r.state === 'OUT' ? 'warn' : ''}>{r.item.name}</span>
                    <span className={r.state === 'LOW' || r.state === 'OUT' ? 'warn' : 'dim'}>{r.counted ? `${fmtQty(r.onHand)} ${r.item.unit}` : 'NO COUNT'}{r.state === 'LOW' || r.state === 'OUT' ? ` // ${r.state}` : ''}</span>
                  </div>
                ))}
                <div className="dim tiny" style={{ marginTop: 4 }}>{mine.length} ITEMS{low ? `, ${low} TO REORDER` : ''}. ROOM ASSIGNMENTS ARE A STARTING GUESS, LIKE THE ROOM NAMES.</div>
              </>
            )}
            <button type="button" className="btn" style={{ marginTop: 6 }} onClick={onOpenCargo}>OPEN CARGO</button>
          </div>
        )
      })()}
    </div>
  )
}

/** DECK PLAN: the farm as a line drawing. Tap a room for its equipment, circuits, load and set points. */
export function DeckPlan({ onOpenVitals, onOpenCargo }: { onOpenVitals: () => void; onOpenCargo: () => void }) {
  const { state } = usePower()
  return (
    <div className={`deck ${state.source === 'generator' ? 'gen-mode' : ''}`}>
      <div className="deck-grid">
        <Plan />
        <RoomReadout onOpenVitals={onOpenVitals} onOpenCargo={onOpenCargo} />
      </div>
      <div className="dim tiny" style={{ marginTop: 8 }}>
        LAYOUT AND EQUIPMENT FROM YOUR ROOM LIST OF 8 NOV 2026. FRUITING IS DRAWN LIFTED UP AND RIGHT BECAUSE IT SITS ON TOP OF INCUBATION. WATTS MARKED EST ARE STILL ESTIMATES.
      </div>
    </div>
  )
}

/** Index for DECK PLAN (left column): every room with its live load and alarm state. */
export function DeckIndex() {
  const { reading, on, selectedRoom, setSelectedRoom, warns } = usePower()
  const { sound } = useApp()
  return (
    <>
      <div className="section-title">ROOMS</div>
      <ul className="index-list">
        {ROOMS.map((r) => {
          const alarm = inAlarm(r, on, warns)
          return (
            <li tabIndex={0}
              key={r.id}
              className={selectedRoom === r.id ? 'sel' : ''}
              onClick={() => {
                sound.chirp()
                setSelectedRoom(r.id)
              }}
            >
              <span>
                {alarm ? '!! ' : ''}
                {r.name}
              </span>
              <span className={alarm ? 'warn' : 'k'}>{(reading.rooms[r.id] / 1000).toFixed(1)}K</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
