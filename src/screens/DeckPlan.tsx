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
// Positions are drawn from Joseph's floor plan; ones marked UNCONFIRMED in the
// data are guesses until he says where they live.
type Glyph = { item: string; kind: 'box' | 'disc' | 'fan' | 'ac'; x: number; y: number; w?: number; h?: number; r?: number }

const GLYPHS: Glyph[] = [
  // lab
  { item: 'ffu', kind: 'box', x: 68, y: 200, w: 50, h: 24 },
  { item: 'ffu', kind: 'box', x: 68, y: 228, w: 50, h: 24 },
  { item: 'ffu', kind: 'box', x: 68, y: 256, w: 50, h: 24 },
  { item: 'chest', kind: 'box', x: 68, y: 92, w: 40, h: 34 },
  { item: 'aa75x', kind: 'disc', x: 160, y: 60, r: 13 },
  { item: 'stir', kind: 'disc', x: 150, y: 150, r: 6 },
  { item: 'stir', kind: 'disc', x: 166, y: 150, r: 6 },
  { item: 'stir', kind: 'disc', x: 150, y: 166, r: 6 },
  { item: 'stir', kind: 'disc', x: 166, y: 166, r: 6 },
  { item: 'sealer', kind: 'box', x: 135, y: 230, w: 44, h: 14 },
  // packing
  { item: 'lennox36a', kind: 'ac', x: 68, y: 350, w: 40, h: 40 },
  { item: 'lennox36b', kind: 'ac', x: 68, y: 400, w: 40, h: 40 },
  { item: 'fogel1', kind: 'box', x: 140, y: 350, w: 40, h: 60 },
  { item: 'fogel2', kind: 'box', x: 140, y: 414, w: 40, h: 60 },
  { item: 's10', kind: 'fan', x: 125, y: 607, r: 10 },
  { item: 's4-pack', kind: 'fan', x: 72, y: 607, r: 7 },
  // boiling room
  { item: 'heat-c12', kind: 'box', x: 210, y: 110, w: 70, h: 40 },
  { item: 'heat-c12b', kind: 'box', x: 210, y: 154, w: 70, h: 40 },
  { item: 'mega1', kind: 'disc', x: 320, y: 120, r: 14 },
  { item: 'mega2', kind: 'disc', x: 354, y: 120, r: 14 },
  { item: 'mega3', kind: 'disc', x: 320, y: 154, r: 14 },
  { item: 'mega4', kind: 'disc', x: 354, y: 154, r: 14 },
  { item: 'thor', kind: 'box', x: 300, y: 270, w: 60, h: 34 },
  { item: 'pump', kind: 'disc', x: 385, y: 287, r: 10 },
  // incubation
  { item: 'lennox12a', kind: 'ac', x: 330, y: 386, w: 50, h: 14 },
  { item: 'lennox12b', kind: 'ac', x: 560, y: 386, w: 50, h: 14 },
  { item: 'floorfan', kind: 'fan', x: 230, y: 440, r: 9 },
  { item: 'floorfan', kind: 'fan', x: 400, y: 440, r: 9 },
  { item: 'floorfan', kind: 'fan', x: 560, y: 440, r: 9 },
  { item: 'floorfan', kind: 'fan', x: 710, y: 440, r: 9 },
  { item: 's4-inc', kind: 'fan', x: 738, y: 400, r: 8 },
  // fruiting
  { item: 's8', kind: 'fan', x: 204, y: 520, r: 9 },
  { item: 's8', kind: 'fan', x: 204, y: 600, r: 9 },
  { item: 'hurricane', kind: 'fan', x: 735, y: 520, r: 10 },
  { item: 'hurricane', kind: 'fan', x: 735, y: 600, r: 10 },
  { item: 'tac', kind: 'box', x: 222, y: 550, w: 22, h: 20 },
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
    <g className={`deck-room ${selected ? 'sel' : ''} ${alarm ? 'alarm' : ''}`} onClick={onClick} role="button" tabIndex={0} aria-label={room.name} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
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
      <svg viewBox="40 14 740 630" className="deck-svg" role="img" aria-label="Plan of the farm with live load by room">
        <g className="deck-detail">
          {/* sallyports and the corridor between the boiling room and incubation */}
          <path d="M60 330H190" className="deck-inner" pathLength={1} />
          <path d="M190 340V380M420 340L420 380" className="deck-inner faint" pathLength={1} />
          {/* lab benches */}
          <rect x={130} y={140} width={52} height={40} className="deck-rack" />
          <rect x={130} y={280} width={52} height={40} className="deck-rack" />
          {/* packing work table */}
          <rect x={130} y={500} width={50} height={90} className="deck-rack" />
          {/* boiling room: steam box cart and its door */}
          <rect x={210} y={220} width={70} height={100} className="deck-rack" />
          {/* incubation shelving and fruiting racks (14 rolling racks) */}
          {rackRows(250, 380, 8, [30, 70], 50, 26)}
          {rackRows(260, 500, 7, [30, 70], 56, 24)}
          {/* the outside heat exchanger by packing */}
          <rect x={86} y={624} width={40} height={12} className="deck-rack faint" />
          <text x={140} y={634} className="deck-note">
            HX
          </text>
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
        <text x={770} y={40} className="deck-note end">
          N ^
        </text>
        <text x={770} y={360} className="deck-note end">
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
          ...(room.alt ? [{ text: `ELECTRICAL PACKAGE: ${room.alt}`, cls: 'dim' }] : [{ text: 'NOT IN THE ELECTRICAL PACKAGE', cls: 'dim' }]),
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
        LAYOUT FROM YOUR FLOOR PLAN. ROOM NAMES AND WHERE EACH MACHINE SITS ARE MARKED UNCONFIRMED UNTIL YOU CHECK THEM.
      </div>
    </div>
  )
}

/** Right-hand index for DECK PLAN: every room with its live load and alarm state. */
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
