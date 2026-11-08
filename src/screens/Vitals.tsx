import { useEffect, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { usePower } from '../power/PowerContext'
import {
  allCircuits,
  CEILING_A,
  GEN_MAX_W,
  GEN_MIN_W,
  GEN_PRESETS,
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
import { Meter } from '../components/Meter'
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
  const main = circuits.filter((c) => c.panel === 'main')
  const sub = circuits.filter((c) => c.panel === 'sub')
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
  const scaleA = ['0', '31', '63', '94', `${CEILING_A} A`]
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
            <span className="ro-s dim">{gen ? `${fmtW(r.watts)} OF ${fmtW(state.genW)}` : `${shareTxt} OF ${CEILING_A} A METER`}</span>
          </div>
          <div className="ro">
            <span className="ro-k">HEADROOM</span>
            <span className="ro-v">{gen ? fmtW(state.genW - r.watts) : fmtA(CEILING_A - r.worst)}</span>
            <span className="ro-s dim">{gen ? `${state.fuel.toUpperCase()} RUNNING WATTS` : 'TO THE CEILING'}</span>
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
            <LoadBar label="GEN" share={r.share} level={r.level} value={shareTxt} scale={['0', '', '', '', `${(state.genW / 1000).toFixed(1)} KW`]} />
            <LoadBar label="L1" share={r.l1 / (state.genW / 2 / 120)} level={r.level} value={fmtA(r.l1)} />
            <LoadBar label="L2" share={r.l2 / (state.genW / 2 / 120)} level={r.level} value={fmtA(r.l2)} />
          </>
        ) : (
          <>
            <LoadBar label="L1" share={r.l1 / CEILING_A} level={r.l1 > CEILING_A ? 'over' : r.l1 > 0.85 * CEILING_A ? 'near' : 'ok'} value={fmtA(r.l1)} scale={scaleA} />
            <LoadBar label="L2" share={r.l2 / CEILING_A} level={r.l2 > CEILING_A ? 'over' : r.l2 > 0.85 * CEILING_A ? 'near' : 'ok'} value={fmtA(r.l2)} scale={scaleA} />
          </>
        )}
        <div className="dim tiny">
          {gen
            ? `${GENERATOR.model} // ${GENERATOR.outlet} // ${GENERATOR.connection} // NEUTRAL MUST BE UN-BONDED`
            : `125 A METER > 3/0 AL 115 M (155 A) > 200 A MAIN // LABEL: ${SERVICE.label}`}
          {` // SUB-PANEL FEED L1 ${fmtA(r.subL1)} L2 ${fmtA(r.subL2)} OF ${SERVICE.subFeedA} A`}
        </div>
      </section>

      {gen && (
        <section className="box" id="v-gen">
          <div className="section-title">GENERATOR</div>
          <div className="tune-row">
            <span className="lbl">FUEL</span>
            {(['propane', 'gasoline'] as const).map((f) => (
              <button key={f} type="button" className={`btn ${state.fuel === f ? 'on' : ''}`} onClick={() => p.setFuel(f)}>
                {f === 'propane' ? 'PROPANE' : 'GASOLINE'}
              </button>
            ))}
          </div>
          <Meter
            label="CAPACITY"
            value={state.genW}
            min={GEN_MIN_W}
            max={GEN_MAX_W}
            step={100}
            onChange={(v) => p.setGenW(v)}
            format={(v) => `${(v / 1000).toFixed(1)}K`}
          />
          <div className="presets">
            {GEN_PRESETS.map((g) => (
              <button key={g.id} type="button" className={`btn ${state.preset === g.id ? 'on' : ''}`} onClick={() => p.setGenW(g[state.fuel], g.id)}>
                {g.name} <span className="dim-on">{(g[state.fuel] / 1000).toFixed(1)}K</span>
              </button>
            ))}
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
        <div className="section-title">MAIN PANEL // 200 A</div>
        <div className="brk-grid">
          {main.map((c) => (
            <BreakerBox key={c.id} c={c} flashDelay={flash[c.id]} />
          ))}
        </div>
      </section>

      <section className="box" id="v-sub">
        <div className="section-title">SUB-PANEL // S1-S21 // 60 A FEED</div>
        <div className="brk-grid">
          {sub.map((c) => (
            <BreakerBox key={c.id} c={c} flashDelay={flash[c.id]} />
          ))}
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
          ['MAIN PANEL', 'v-main'],
          ['SUB-PANEL', 'v-sub'],
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
