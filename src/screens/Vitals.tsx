import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useApp } from '../settings/AppContext'
import { usePower } from '../power/PowerContext'
import {
  allCircuits,
  CEILING_A,
  GENERATOR,
  HEATER_OPTIONS,
  SCENARIOS,
  SERVICE,
  type Circuit,
  type HeaterOption,
  type RoomId,
} from '../data/power'
import { circuitWatts, fmtDur, fmtMin, itemWatts } from '../lib/power'
import { roomById } from '../data/rooms'
import { LoadBar } from '../components/LoadBar'
import { TypeText } from '../components/TypeText'
import { PowerCutBox } from './Facility'

export const fmtW = (n: number) => `${Math.round(n).toLocaleString('en-US')} W`
export const fmtA = (n: number) => `${n.toFixed(1)} A`
const ampsOf = (c: Circuit, w: number) => (c.leg === 'B' ? w / 240 : w / 120)

/** A short blip as a breaker flips on screen. */
function useFlipSound() {
  const { sound } = useApp()
  return (id: string) => sound.typeChar('|', id.length * 3 + id.charCodeAt(id.length - 1), 0)
}

/** One breaker in the grid. Tap to flip it. */
export function BreakerBox({ c, flashDelay, compact }: { c: Circuit; flashDelay?: number; compact?: boolean }) {
  const { on, toggle, config, selectedCircuit, setSelectedCircuit } = usePower()
  const flip = useFlipSound()
  const isOn = on.has(c.id)
  const w = circuitWatts(c, config.overrides)
  const est = c.items.some((i) => i.est)
  const edited = c.items.some((i) => config.overrides[i.id] !== undefined)
  return (
    <button
      type="button"
      className={`brk ${isOn ? 'on' : 'off'} ${selectedCircuit === c.id ? 'sel' : ''} ${flashDelay !== undefined ? 'flash' : ''} ${compact ? 'compact' : ''}`}
      style={flashDelay !== undefined ? { animationDelay: `${flashDelay}ms` } : undefined}
      onClick={() => {
        toggle(c.id)
        setSelectedCircuit(c.id)
        flip(c.id)
      }}
      aria-pressed={isOn}
      title={c.name}
    >
      <span className="b-head">
        <span className="b-tag">{c.tag}</span>
        <span className="b-leg">{c.leg === 'B' ? '240' : c.leg}</span>
      </span>
      <span className="b-name">{c.short}</span>
      <span className="b-foot">
        <span>{c.cls === 'out' ? 'OUTLETS' : fmtW(w)}</span>
        <span className="b-sw" aria-hidden>
          <i />
        </span>
      </span>
      <span className="b-flags">
        {c.em && <span title="On the generator emergency list">EM</span>}
        {est && <span title="Wattage is an estimate">{edited ? 'EDIT' : 'EST'}</span>}
        {c.cls !== 'out' && <span className="b-amp">{ampsOf(c, w).toFixed(1)}A</span>}
      </span>
    </button>
  )
}

/** The slots a breaker takes, from its tag: '7' -> [7], '21-23' -> [21, 23]. */
export function slotsOf(tag: string): number[] {
  return tag.split('-').map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
}

/** Leg of a slot in a split-phase box: row = slot / 2 rounded up, odd rows on L1. */
export function legOfSlot(slot: number): 'L1' | 'L2' {
  return Math.ceil(slot / 2) % 2 === 1 ? 'L1' : 'L2'
}

/** Where the power comes in: the grid through the main, or the generator through its own breaker. One interlock, never both. */
function FeedStrip() {
  const { sound } = useApp()
  const p = usePower()
  const gen = p.state.source === 'generator'
  return (
    <div className="feed-strip" role="group" aria-label="What feeds the box">
      <button type="button" className={`feed ${!gen ? 'live' : ''}`} onClick={() => (sound.chirp(), p.setSource('utility'))} aria-pressed={!gen}>
        <span className="feed-k">ICE GRID</span>
        <span className="feed-v">MAIN BREAKER {!gen ? 'ON' : 'OFF'}</span>
        <span className="feed-s">200 A METER // 3/0 AL 155 A</span>
      </button>
      <span className="feed-lock" aria-hidden>
        INTERLOCK
        <i />
      </span>
      <button type="button" className={`feed ${gen ? 'live' : ''}`} onClick={() => (sound.chirp(), p.setSource('generator'))} aria-pressed={gen}>
        <span className="feed-k">GENERATOR</span>
        <span className="feed-v">50 A 2-POLE {gen ? 'ON' : 'OFF'}</span>
        <span className="feed-s">XP17500HX // ONE 50 A CORD</span>
      </button>
    </div>
  )
}

/** The box drawn as it is: two columns of slots with the L1/L2 bus down the middle. */
function PanelBoard({ circuits, flash }: { circuits: Circuit[]; flash: Record<string, number> }) {
  const bySlot = new Map<number, Circuit[]>()
  let maxSlot = 0
  for (const c of circuits) {
    const sl = slotsOf(c.tag)
    if (!sl.length) continue
    const first = Math.min(...sl)
    bySlot.set(first, [...(bySlot.get(first) ?? []), c])
    maxSlot = Math.max(maxSlot, ...sl)
  }
  const rows = Math.ceil(Math.max(maxSlot, 32) / 2)
  const taken = new Set(circuits.flatMap((c) => slotsOf(c.tag)))
  const cells: ReactElement[] = []
  for (let slot = 1; slot <= rows * 2; slot++) {
    const col = slot % 2 === 1 ? 1 : 3
    const row = Math.ceil(slot / 2)
    const here = bySlot.get(slot)
    if (here) {
      const span = slotsOf(here[0].tag).length
      cells.push(
        <div key={`s${slot}`} className={`pb-cell ${here.length > 1 ? 'shared' : ''}`} style={{ gridColumn: col, gridRow: `${row} / span ${span}` }}>
          {here.map((c) => (
            <BreakerBox key={c.id} c={c} flashDelay={flash[c.id]} compact />
          ))}
        </div>,
      )
    } else if (!taken.has(slot)) {
      cells.push(
        <div key={`s${slot}`} className="pb-cell spare" style={{ gridColumn: col, gridRow: row }}>
          <span className="b-tag">{slot}</span> SPARE
        </div>,
      )
    }
  }
  for (let row = 1; row <= rows; row++) {
    cells.push(
      <div key={`bus${row}`} className={`pb-bus ${row % 2 ? 'l1' : 'l2'}`} style={{ gridColumn: 2, gridRow: row }}>
        {row % 2 ? 'L1' : 'L2'}
      </div>,
    )
  }
  return (
    <div className="panel-board" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
      {cells}
    </div>
  )
}

/** Everything about the last breaker touched, with editable wattage for estimates. */
function BreakerDetail({ onOpenRoom }: { onOpenRoom: (r: RoomId) => void }) {
  const { selectedCircuit, config, setOverride, on } = usePower()
  const c = allCircuits(config.heater).find((x) => x.id === selectedCircuit)
  if (!c) return <div className="dim">TAP A BREAKER TO FLIP IT AND SEE ITS DETAIL HERE.</div>
  const w = circuitWatts(c, config.overrides)
  return (
    <div className="brk-detail">
      <div className="bd-title">
        <span>
          {c.tag} // {c.name}
        </span>
        <span className={on.has(c.id) ? '' : 'dim'}>{on.has(c.id) ? 'ON' : 'OFF'}</span>
      </div>
      <dl className="facts">
        <dt>BREAKER</dt>
        <dd>
          {c.breaker} // {c.wire}
        </dd>
        <dt>LEG</dt>
        <dd>{c.leg === 'B' ? '240 V, BOTH LEGS' : `120 V, ${c.leg}`}</dd>
        <dt>LOAD</dt>
        <dd>{c.cls === 'out' ? 'RECEPTACLES, NO FIXED LOAD' : `${fmtW(w)} // ${fmtA(ampsOf(c, w))}${c.leg === 'B' ? ' PER LEG' : ''}`}</dd>
        <dt>CLASS</dt>
        <dd>{c.cls === 'base' ? 'CONTINUOUS' : c.cls === 'int' ? 'INTERMITTENT' : 'OUTLETS'}{c.em ? ' // GENERATOR EMERGENCY LIST' : ''}</dd>
      </dl>
      {c.items.length > 0 && (
        <table className="bd-items">
          <tbody>
            {c.items.map((i) => {
              const cur = itemWatts(i.id, i.w, config.overrides)
              const edited = config.overrides[i.id] !== undefined
              const room = roomById(i.room)
              return (
                <tr key={i.id}>
                  <td>
                    {i.qty > 1 ? `${i.qty} x ` : ''}
                    {i.name.toUpperCase()}
                  </td>
                  <td>
                    {room ? (
                      <button type="button" className="linkish" onClick={() => onOpenRoom(i.room)}>
                        {room.name}
                      </button>
                    ) : (
                      'OUTSIDE'
                    )}
                    {i.roomGuess && <span className="unconf"> UNCONFIRMED</span>}
                  </td>
                  <td className="num">
                    {i.est ? (
                      <label className="wedit">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={10}
                          value={cur}
                          onChange={(e) => setOverride(i.id, e.target.value === '' ? null : Number(e.target.value))}
                          aria-label={`Watts for ${i.name}`}
                        />
                        W
                      </label>
                    ) : (
                      fmtW(cur)
                    )}
                    {i.est && <div className="dim tiny">{edited ? <button type="button" className="linkish" onClick={() => setOverride(i.id, null)}>RESET TO {fmtW(i.w)}</button> : 'ESTIMATE'}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="dim">{c.note.toUpperCase()}</div>
    </div>
  )
}

/** VITALS: the breaker board against the power budget. */
export function Vitals({ onOpenRoom, onOpenCuts }: { onOpenRoom: (r: RoomId) => void; onOpenCuts?: () => void }) {
  const { sound } = useApp()
  const p = usePower()
  const { state, reading: r, warns, peak, on } = p
  const gen = state.source === 'generator'
  const circuits = allCircuits(state.heater)
  const [flash, setFlash] = useState<Record<string, number>>({})
  const flashTimer = useRef<number | null>(null)
  const pendingRipple = useRef<Set<string> | null>(null)

  // Presets ripple across the board, with data chatter for exactly as long as the ripple runs.
  const runScenario = (key: string) => {
    pendingRipple.current = on
    p.applyScenario(key)
  }
  useEffect(() => {
    const before = pendingRipple.current
    if (!before) return
    pendingRipple.current = null
    const changed = circuits.filter((c) => before.has(c.id) !== on.has(c.id))
    if (!changed.length) return
    const step = 35
    const map: Record<string, number> = {}
    changed.forEach((c, i) => (map[c.id] = i * step))
    setFlash(map)
    const dur = changed.length * step + 260
    sound.beginData()
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      sound.endData()
      setFlash({})
      flashTimer.current = null
    }, dur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on])
  useEffect(
    () => () => {
      if (flashTimer.current) {
        window.clearTimeout(flashTimer.current)
        sound.endData()
      }
    },
    [sound],
  )

  const shareTxt = Number.isFinite(r.share) ? `${(r.share * 100).toFixed(0)}%` : '---'
  const scaleA = ['0', String(Math.round(CEILING_A / 4)), String(Math.round(CEILING_A / 2)), String(Math.round((CEILING_A * 3) / 4)), `${CEILING_A} A`]
  const scenarios = SCENARIOS.filter((s) => s.source === state.source && (!s.only || s.only === state.heater))
  const heater = HEATER_OPTIONS[state.heater]
  const fullHeatA = heater.elements.reduce((n, e) => n + e.w, 0) / 240

  const warnLines = warns.length
    ? warns.map((w) => ({ text: `${w.level === 'warn' ? '!! ' : '-- '}${w.text}`, cls: w.level === 'warn' ? 'warn' : 'dim' }))
    : [{ text: '-- ALL OPERATING RULES CLEAR.', cls: 'dim' }]

  return (
    <div className={`vitals ${gen ? 'gen-mode' : ''}`}>
      <div className="v-controls" id="v-source">
        <div className="seg" role="group" aria-label="Power source">
          <span className="seg-lbl">SOURCE</span>
          <button type="button" className={`btn ${!gen ? 'on' : ''}`} onClick={() => (sound.chirp(), p.setSource('utility'))}>
            ICE UTILITY
          </button>
          <button type="button" className={`btn ${gen ? 'on' : ''}`} onClick={() => (sound.chirp(), p.setSource('generator'))}>
            GENERATOR
          </button>
        </div>
        <div className="seg" role="group" aria-label="Steam heater option">
          <span className="seg-lbl">STEAM HEATER</span>
          {(['2x4500', '6500'] as HeaterOption[]).map((h) => (
            <button key={h} type="button" className={`btn ${state.heater === h ? 'on' : ''}`} onClick={() => (sound.chirp(), p.setHeater(h))}>
              {h === '2x4500' ? 'A: 2 x 4.5 KW' : 'B: 1 x 6.5 KW'}
            </button>
          ))}
          <span className="unconf">CHOICE OPEN</span>
        </div>
        <div className={`status-chip lv-${r.level}`}>{r.status.toUpperCase()}</div>
      </div>
      <div className="dim tiny v-heatnote">
        {heater.label} // FULL HEAT {fmtA(fullHeatA)} PER LEG
        {state.heater === '2x4500' ? ` // STAGED HOLD ${fmtA(4500 / 240)} PER LEG` : ' // NO STAGING'} // ABOUT {heater.steamLph} L/H STEAM
      </div>

      <section className={`v-budget ${gen ? 'hazard-box' : 'box'}`} id="v-budget">
        <div className="section-title">{gen ? 'GENERATOR BUDGET' : 'SERVICE BUDGET'}</div>
        <div className="readouts">
          <div className="ro">
            <span className="ro-k">{gen ? 'GENERATOR LOAD' : 'WORST LEG'}</span>
            <span className={`ro-v big lv-${r.level}`}>{gen ? shareTxt : fmtA(r.worst)}</span>
            <span className="ro-s dim">{gen ? (r.worst / r.legA >= r.wattShare ? `SET BY ${r.l1 > r.l2 ? 'L1' : 'L2'}: ${fmtA(r.worst)} OF ${r.legA.toFixed(0)} A ON THE CORD` : `SET BY WATTS: ${fmtW(r.watts)} OF ${fmtW(state.genW)}`) : `${shareTxt} OF THE ${CEILING_A} A FEEDER`}</span>
          </div>
          <div className="ro">
            <span className="ro-k">HEADROOM</span>
            <span className="ro-v">{gen ? fmtA(r.legA - r.worst) : fmtA(CEILING_A - r.worst)}</span>
            <span className="ro-s dim">{gen ? `ON THE WORST LEG // ${fmtW(state.genW - r.watts)} ${state.fuel.toUpperCase()} WATTS LEFT` : 'TO THE CEILING'}</span>
          </div>
          <div className="ro">
            <span className="ro-k">TOTAL</span>
            <span className="ro-v">{fmtW(r.watts)}</span>
            <span className="ro-s dim">{on.size} BREAKERS ON</span>
          </div>
          {!gen && (
            <div className="ro">
              <span className="ro-k">FEEDER DROP</span>
              <span className={`ro-v ${r.dropPct > 3 ? 'lv-near' : ''}`}>{r.dropPct.toFixed(1)}%</span>
              <span className="ro-s dim">≈{r.voltsAtPanel.toFixed(0)} V AT PANEL // 3/0 AL 115 M</span>
            </div>
          )}
        </div>
        {gen ? (
          <>
            <LoadBar label="GEN" share={r.wattShare} level={r.wattShare > 1 ? 'over' : r.wattShare > 0.85 ? 'near' : 'ok'} value={`${(r.wattShare * 100).toFixed(0)}%`} scale={['0', '', '', '', `${(state.genW / 1000).toFixed(1)} KW`]} />
            <LoadBar label="L1" share={r.l1 / r.legA} level={r.l1 > r.legA ? 'over' : r.l1 > 0.85 * r.legA ? 'near' : 'ok'} value={fmtA(r.l1)} scale={['0', '', '', '', `${r.legA.toFixed(0)} A`]} />
            <LoadBar label="L2" share={r.l2 / r.legA} level={r.l2 > r.legA ? 'over' : r.l2 > 0.85 * r.legA ? 'near' : 'ok'} value={fmtA(r.l2)} scale={['0', '', '', '', `${r.legA.toFixed(0)} A`]} />
          </>
        ) : (
          <>
            <LoadBar label="L1" share={r.l1 / CEILING_A} level={r.l1 > CEILING_A ? 'over' : r.l1 > 0.85 * CEILING_A ? 'near' : 'ok'} value={fmtA(r.l1)} scale={scaleA} />
            <LoadBar label="L2" share={r.l2 / CEILING_A} level={r.l2 > CEILING_A ? 'over' : r.l2 > 0.85 * CEILING_A ? 'near' : 'ok'} value={fmtA(r.l2)} scale={scaleA} />
          </>
        )}
        <div className="dim tiny">
          {gen
            ? `${GENERATOR.model} // ${GENERATOR.outlet} > ${GENERATOR.connection} // NEUTRAL MUST BE UN-BONDED`
            : `200 A METER > 3/0 AL 115 M (155 A, THE LIMIT) > MAIN BREAKER > THE ONE EATON CH BOX // LABEL: ${SERVICE.label}`}
        </div>
      </section>

      {gen && (
        <section className="box" id="v-gen">
          <div className="section-title">GENERATOR // {GENERATOR.model}</div>
          <div className="seg gen-fuel" role="group" aria-label="Generator fuel">
            <span className="seg-lbl">FUEL</span>
            {(['propane', 'gasoline'] as const).map((f) => (
              <button key={f} type="button" className={`btn ${state.fuel === f ? 'on' : ''}`} onClick={() => (sound.chirp(), p.setFuel(f))} aria-pressed={state.fuel === f}>
                {f === 'propane' ? 'PROPANE' : 'GASOLINE'}
              </button>
            ))}
          </div>
          <table className="gen-ratings">
            <thead>
              <tr>
                <th>FUEL</th>
                <th className="num">RUNNING</th>
                <th className="num">STARTING</th>
                <th className="num">PER LEG</th>
              </tr>
            </thead>
            <tbody>
              {(['propane', 'gasoline'] as const).map((f) => (
                <tr key={f} className={state.fuel === f ? '' : 'dim'}>
                  <td>{f === 'propane' ? 'PROPANE' : 'GASOLINE'}{state.fuel === f ? ' <' : ''}</td>
                  <td className="num">{fmtW(GENERATOR.running[f])}</td>
                  <td className="num">{fmtW(GENERATOR.starting[f])}</td>
                  <td className="num">{fmtA(Math.min(GENERATOR.running[f] / 240, GENERATOR.cordA))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dim tiny">
            ONE {GENERATOR.cordA} A CORD FROM A 14-50R INTO THE SAME BREAKER BOX AS THE GRID, SO EACH LEG GETS AT MOST {GENERATOR.cordA} A ON EITHER FUEL. THE PLAN ON ONE CORD: THE EMERGENCY LIST AND BOTH INCUBATION 12KS. STEAM WAITS FOR THE GRID.
          </div>
        </section>
      )}

      {onOpenCuts && (
        <section className="box" id="v-cuts-box">
          <PowerCutBox onOpen={onOpenCuts} />
        </section>
      )}

      <section className="box" id="v-rules">
        <div className="section-title">RULES</div>
        <TypeText key={warns.map((w) => w.id).join(',') || 'clear'} group={4} lines={warnLines} />
        <div className={`peak ${peak.inPeak ? 'warn' : 'dim'}`}>
          CR TIME {fmtMin(peak.now)} //{' '}
          {peak.inPeak
            ? `ICE PEAK ${peak.window!.from}-${peak.window!.to} NOW, ENDS IN ${fmtDur(peak.minutes)}`
            : `OFF-PEAK // NEXT PEAK ${peak.window!.from}-${peak.window!.to} IN ${fmtDur(peak.minutes)}`}
        </div>
      </section>

      <section className="box" id="v-presets">
        <div className="section-title">PRESETS</div>
        <div className="presets">
          {scenarios.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`btn ${state.scenario === s.key ? 'on' : ''} ${s.danger ? 'danger' : ''}`}
              onClick={() => runScenario(s.key)}
            >
              {state.heater === '6500' && s.label6 ? s.label6 : s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="box" id="v-main">
        <div className="section-title">BREAKER BOX // EATON CH 225 A // OUTSIDE BACK WALL BEHIND INCUBATION</div>
        <FeedStrip />
        <PanelBoard circuits={circuits} flash={flash} />
        <div className="dim tiny">
          ONE BOX. ODD SLOTS ON THE LEFT, EVEN ON THE RIGHT, AS THE ELECTRICIAN WIRED IT. 240 V BREAKERS TAKE TWO SLOTS. SLOTS 5 AND 9 EACH FEED TWO LOADS: FLIPPING THE REAL BREAKER CUTS BOTH. SLOTS 33-42 SPARE.
        </div>
      </section>

      <section className="box" id="v-detail">
        <div className="section-title">BREAKER DETAIL</div>
        <BreakerDetail onOpenRoom={onOpenRoom} />
      </section>
    </div>
  )
}

/** Right-hand index for VITALS: jump links and the live legs. */
export function VitalsIndex() {
  const { reading: r, state } = usePower()
  const gen = state.source === 'generator'
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <>
      <div className="section-title">VITALS</div>
      <ul className="index-list">
        {[
          ['BUDGET', 'v-budget'],
          ...(gen ? [['GENERATOR', 'v-gen']] : []),
          ['POWER CUTS', 'v-cuts-box'],
          ['RULES', 'v-rules'],
          ['PRESETS', 'v-presets'],
          ['BREAKER BOX', 'v-main'],
          ['DETAIL', 'v-detail'],
        ].map(([label, id]) => (
          <li tabIndex={0} key={id} onClick={() => jump(id)}>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 12 }}>
        LIVE
      </div>
      <dl className="facts tight">
        <dt>SRC</dt>
        <dd>{gen ? 'GEN' : 'ICE'}</dd>
        <dt>L1</dt>
        <dd>{fmtA(r.l1)}</dd>
        <dt>L2</dt>
        <dd>{fmtA(r.l2)}</dd>
        <dt>LOAD</dt>
        <dd className={`lv-${r.level}`}>{Number.isFinite(r.share) ? `${(r.share * 100).toFixed(0)}%` : '---'}</dd>
      </dl>
    </>
  )
}
