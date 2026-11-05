import { useEffect, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { TypeText } from '../components/TypeText'
import { PLAN_BASE_BAGS, SPECIES, WEEKLY_BAGS } from '../data/species'
import { allot, LB_TO_KG } from '../lib/runplan'
import { useCargo } from '../store/useCargo'
import { runLines } from '../lib/stockplan'
import { bookRun } from '../lib/cargoActions'
import { fmtQty, nextRunRef, onHandMap } from '../lib/cargo'

// Cart capacity from the steam-box design (rev D): 130 x 10 lb bags per cart.
const CART_BAGS = 130
const TIERS = 5 // schematic only: tiers x slots. Real rack spacing is not in the sources.
const SLOTS = CART_BAGS / TIERS
const STEAM_HOLD_H = 4 // confirmed by Joseph 5 Nov 2026

// One phosphor colour per screen, so species are told apart by fill pattern.
const PATTERNS = ['solid', 'hatch', 'dots', 'cross', 'rows', 'checker', 'diag', 'ring', 'frame', 'bars', 'zig', 'grid', 'sparse', 'half']

type Phase = 'idle' | 'allocate' | 'load' | 'seal' | 'steam' | 'done'
const PHASES: { id: Phase; label: string; ms: number }[] = [
  { id: 'allocate', label: 'ALLOCATE BAGS TO SPECIES', ms: 1400 },
  { id: 'load', label: 'LOAD CART', ms: 4200 },
  { id: 'seal', label: 'ROLL IN AND SEAL STEAM BOX', ms: 1500 },
  { id: 'steam', label: `STEAM HOLD ${STEAM_HOLD_H}:00 H (TIME COMPRESSED)`, ms: 3600 },
]

function Defs() {
  return (
    <defs>
      <pattern id="p-hatch" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 4L4 0" stroke="currentColor" strokeWidth="1" /></pattern>
      <pattern id="p-dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="currentColor" /></pattern>
      <pattern id="p-cross" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0L4 4M4 0L0 4" stroke="currentColor" strokeWidth="0.8" /></pattern>
      <pattern id="p-rows" width="4" height="3" patternUnits="userSpaceOnUse"><path d="M0 1.5H4" stroke="currentColor" strokeWidth="1" /></pattern>
      <pattern id="p-checker" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="currentColor" /><rect x="3" y="3" width="3" height="3" fill="currentColor" /></pattern>
      <pattern id="p-diag" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0L6 6" stroke="currentColor" strokeWidth="1.4" /></pattern>
      <pattern id="p-bars" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M1 0V4" stroke="currentColor" strokeWidth="1.2" /></pattern>
      <pattern id="p-zig" width="6" height="4" patternUnits="userSpaceOnUse"><path d="M0 3L3 1L6 3" stroke="currentColor" strokeWidth="0.9" fill="none" /></pattern>
      <pattern id="p-grid" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H4M0 0V4" stroke="currentColor" strokeWidth="0.7" /></pattern>
      <pattern id="p-sparse" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="0.9" fill="currentColor" /></pattern>
    </defs>
  )
}

function fillFor(pat: string): { fill: string; stroke?: boolean } {
  if (pat === 'solid') return { fill: 'currentColor' }
  if (['ring', 'frame'].includes(pat)) return { fill: 'none', stroke: true }
  if (pat === 'half') return { fill: 'url(#p-rows)' }
  return { fill: `url(#p-${pat})` }
}

function Cart({ slots, loaded, sealed, steam }: { slots: { pat: string }[]; loaded: number; sealed: number; steam: number }) {
  const W = 330
  const H = 200
  const gx = 2
  const x0 = 22
  const bw = (W - 20 - 2 * 12 - (SLOTS - 1) * gx) / SLOTS // bags always fit inside the box outline
  const bh = 24
  const y0 = 18
  return (
    <svg className="seq-cart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Steam box cart loading with bags">
      <Defs />
      {/* steam box outline: door end open until sealed */}
      <rect x="10" y="6" width={W - 20} height={H - 22} className="seq-box" fill="none" />
      <path d={`M10 ${H - 16}H${W - 10}`} className="seq-floor" />
      <circle cx="30" cy={H - 7} r="5" className="seq-wheel" fill="none" />
      <circle cx={W - 30} cy={H - 7} r="5" className="seq-wheel" fill="none" />
      {Array.from({ length: TIERS }).map((_, t) => (
        <g key={t}>
          <path d={`M${x0 - 6} ${y0 + (t + 1) * (bh + 8) - 4}H${W - 20}`} className="seq-shelf" />
          {Array.from({ length: SLOTS }).map((__, c) => {
            const idx = t * SLOTS + c
            const s = slots[idx]
            const on = idx < loaded && s
            const f = s ? fillFor(s.pat) : { fill: 'none' }
            return (
              <rect
                key={c}
                x={x0 + c * (bw + gx)}
                y={y0 + t * (bh + 8) + 4}
                width={bw}
                height={bh}
                rx="2"
                className={`seq-bag ${on ? 'on' : ''} ${idx === loaded - 1 && loaded < slots.length ? 'newest' : ''} ${s?.pat === 'ring' || s?.pat === 'frame' ? 'stroke' : ''}`}
                fill={on ? f.fill : 'none'}
              />
            )
          })}
        </g>
      ))}
      {/* sealing door sweeps in from the right */}
      <rect x={W - 20 - (sealed * 12)} y="6" width={sealed * 12} height={H - 22} className="seq-door" />
      {steam > 0 &&
        Array.from({ length: 6 }).map((_, i) => (
          <path key={i} d={`M${40 + i * 48} ${H - 20}q6 -10 0 -20t0 -20`} className="seq-steam" style={{ animationDelay: `${i * 0.35}s`, opacity: Math.min(1, steam * 1.5) }} />
        ))}
    </svg>
  )
}

function Bar({ label, p, state, keep }: { label: string; p: number; state: 'wait' | 'run' | 'ok'; keep?: boolean }) {
  const cells = 30
  const on = Math.round(p * cells)
  return (
    <div className={`seq-bar ${state} ${keep ? 'keep' : ''}`}>
      <span className="seq-bar-l">{label}</span>
      <span className="seq-bar-t" aria-hidden>
        {Array.from({ length: cells }).map((_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
      </span>
      <span className="seq-bar-n">{state === 'wait' ? 'STANDBY' : state === 'ok' ? 'COMPLETE' : `${Math.round(p * 100)}%`}</span>
    </div>
  )
}

export function Sequence({ onOpenCargo }: { onOpenCargo: () => void }) {
  const { sound } = useApp()
  const cargo = useCargo()
  const [booked, setBooked] = useState<{ ref: string; n: number; missing: string[]; warn?: boolean } | null>(null)
  const [bags, setBags] = useState(WEEKLY_BAGS)
  const [chosen, setChosen] = useState<string[]>(SPECIES.filter((s) => (s.plan?.share ?? 0) > 0).map((s) => s.id))
  const [phase, setPhase] = useState<Phase>('idle')
  const [p, setP] = useState(0)
  const raf = useRef(0)
  const soundOn = useRef(false)
  const stageRef = useRef<HTMLDivElement>(null)

  const picked = SPECIES.filter((s) => chosen.includes(s.id))
  const result = allot(bags, picked)
  const carts = Math.max(1, Math.ceil(bags / CART_BAGS))
  const lastCart = bags - (carts - 1) * CART_BAGS

  // bag-by-bag order for ONE cart, species in allotment order. Cart 1 shown; further carts repeat the proportions.
  const perCart = Math.min(bags, CART_BAGS)
  const cartAllot = allot(perCart, picked)
  const slots: { pat: string }[] = []
  cartAllot.forEach((a, i) => {
    for (let k = 0; k < a.bags; k++) slots.push({ pat: PATTERNS[i % PATTERNS.length] })
  })
  while (slots.length < CART_BAGS) slots.push({ pat: '' })

  const stopSound = () => {
    if (soundOn.current) {
      sound.endData()
      soundOn.current = false
    }
  }
  useEffect(() => () => { cancelAnimationFrame(raf.current); stopSound() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    if (!picked.length || bags < 1 || phase === 'allocate' || phase === 'load' || phase === 'seal' || phase === 'steam') return
    cancelAnimationFrame(raf.current)
    let i = 0
    let t0 = performance.now()
    sound.whoosh()
    sound.beginData()
    soundOn.current = true
    setPhase(PHASES[0].id)
    setP(0)
    window.setTimeout(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    const tick = (now: number) => {
      const ph = PHASES[i]
      const f = Math.min(1, (now - t0) / ph.ms)
      setP(f)
      if (f >= 1) {
        i++
        if (i >= PHASES.length) {
          stopSound()
          setPhase('done')
          sound.granted()
          return
        }
        sound.chirp()
        setPhase(PHASES[i].id)
        t0 = now
        setP(0)
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const reset = () => {
    cancelAnimationFrame(raf.current)
    stopSound()
    setPhase('idle')
    setP(0)
  }

  const idx = PHASES.findIndex((x) => x.id === phase)
  const prog = (k: number) => (phase === 'done' || idx > k ? 1 : idx === k ? p : 0)
  const state = (k: number): 'wait' | 'run' | 'ok' => (phase === 'done' || idx > k ? 'ok' : idx === k ? 'run' : 'wait')
  const running = phase !== 'idle' && phase !== 'done'
  const loaded = phase === 'idle' ? 0 : phase === 'allocate' ? 0 : phase === 'load' ? Math.floor(p * perCart) : perCart
  const sealed = phase === 'seal' ? p : idx > 2 || phase === 'done' ? 1 : 0
  const steam = phase === 'steam' ? p : phase === 'done' ? 1 : 0

  const toggle = (id: string) => {
    sound.chirp()
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  }
  const withCat = SPECIES.filter((s) => s.cat)
  const bestYield = [...withCat].sort((a, b) => b.cat!.lb - a.cat!.lb)[0]
  const fastest = [...withCat].sort((a, b) => a.cat!.d - b.cat!.d)[0]
  const planSpecies = SPECIES.filter((s) => (s.plan?.share ?? 0) > 0)
  const suggestions = [
    { label: `SINGLE: ${bestYield.name}`, why: `Highest real yield, ${bestYield.cat!.lb.toFixed(2)} lb a block (Catawba). Blue and comb tooth are level.`, ids: [bestYield.id] },
    { label: `SINGLE: ${fastest.name}`, why: `Fastest turnaround, first picks in ${fastest.cat!.d} days (Catawba).`, ids: [fastest.id] },
    { label: 'MULTI: CROP PLAN SPLIT', why: `The farm plan ratio: ${planSpecies.map((s) => s.plan!.share).join(' / ')} per ${PLAN_BASE_BAGS}.`, ids: planSpecies.map((s) => s.id) },
    { label: "MULTI: BLUE + LION'S MANE", why: 'The two biggest earners, in their plan ratio.', ids: ['blue-oyster', 'lions-mane'] },
  ]
  const sumLb = result.reduce((n, a) => n + (a.sp.cat ? a.bags * a.sp.cat.lb : 0), 0)
  const missing = result.filter((a) => a.bags > 0 && !a.sp.cat)
  const lock = running

  return (
    <div className="planner seq">
      <div className="section-title">PRODUCTION SEQUENCE</div>
      {phase !== 'idle' && (
        <div className={`seq-stage ${phase === 'done' ? 'finished' : ''}`} ref={stageRef}>
          <div className="seq-abort">{running && <button onClick={reset}>ABORT</button>}</div>
          <div className="section-title">STEAM BOX // CART 1 OF {carts} // {perCart} BAGS // ~{Math.round(perCart * 10 * 0.4536)} KG</div>
          <Cart slots={slots} loaded={loaded} sealed={sealed} steam={steam} />
          <div className="seq-bars">
            {PHASES.map((ph, k) => <Bar key={ph.id} label={ph.label} p={prog(k)} state={state(k)} />)}
            <Bar keep label="BAGS LOADED" p={perCart ? loaded / perCart : 0} state={phase === 'done' ? 'ok' : loaded ? 'run' : 'wait'} />
          </div>
          <div className="tiny dim">SCHEMATIC, NOT TO SCALE. TIER SPACING IS NOT IN THE SOURCES. CART {CART_BAGS} X 10 LB BAGS (STEAM BOX REV D).</div>
          {phase === 'done' && <TypeText group={3} lines={[`SEQUENCE COMPLETE. ${bags} BAGS IN ${carts} LOAD${carts > 1 ? 'S' : ''}. STEAM HOLD ${STEAM_HOLD_H} H.`, { text: 'ANIMATION ONLY. THIS DOES NOT CONTROL THE BOILER OR LOG A COOK.', cls: 'dim' }]} />}
        </div>
      )}
      <TypeText group={3} className="dim" lines={['SET THE BAG RUN. PICK A SUGGESTION OR TICK SPECIES. THE RATIO FOLLOWS THE CROP PLAN. THEN INITIATE.']} />
      <label className="pl-bags">
        <span>BAGS THIS RUN</span>
        <input type="number" inputMode="numeric" min={1} max={2000} value={bags} disabled={lock} onChange={(e) => setBags(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        <button disabled={lock} onClick={() => (sound.chirp(), setBags(WEEKLY_BAGS))}>{WEEKLY_BAGS} STANDARD</button>
        <span className="dim tiny">{carts} CART LOAD{carts > 1 ? 'S' : ''} OF {CART_BAGS}{carts > 1 ? ` (LAST ${lastCart})` : ''}</span>
      </label>

      <div className="section-title" style={{ marginTop: 10 }}>SUGGESTED RUNS</div>
      <ul className="pl-sug">
        {suggestions.map((s) => (
          <li key={s.label}>
            <button disabled={lock} onClick={() => (sound.chirp(), setChosen(s.ids))}>{s.label}</button>
            <span className="dim tiny">{s.why}</span>
          </li>
        ))}
      </ul>

      <div className="section-title" style={{ marginTop: 10 }}>SPECIES IN THIS RUN</div>
      <div className="pl-pick">
        {SPECIES.map((s) => (
          <button key={s.id} disabled={lock} className={chosen.includes(s.id) ? 'sel' : ''} aria-pressed={chosen.includes(s.id)} onClick={() => toggle(s.id)}>
            {chosen.includes(s.id) ? '[X]' : '[ ]'} {s.name}
          </button>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 10 }}>ALLOTMENT // {bags} BAGS</div>
      {picked.length === 0 ? (
        <div className="warn">PICK AT LEAST ONE SPECIES.</div>
      ) : (
        <table className="pl-table">
          <thead>
            <tr><th>SPECIES</th><th>BAGS</th><th>%</th><th>LB / WEEK</th><th>KG</th><th>1ST PICK</th></tr>
          </thead>
          <tbody>
            {result.map((a, i) => (
              <tr key={a.sp.id}>
                <td><svg className="swatch" viewBox="0 0 12 12"><Defs /><rect x="1" y="1" width="10" height="10" fill={fillFor(PATTERNS[i % PATTERNS.length]).fill} className={['ring', 'frame'].includes(PATTERNS[i % PATTERNS.length]) ? 'stroke' : ''} stroke="currentColor" strokeWidth="1" /></svg> {a.sp.name}{a.assumed && picked.length > 1 ? ' *' : ''}</td>
                <td>{a.bags}</td>
                <td>{a.pct.toFixed(0)}</td>
                <td>{a.sp.cat ? (a.bags * a.sp.cat.lb).toFixed(0) : 'NO DATA'}</td>
                <td>{a.sp.cat ? (a.bags * a.sp.cat.lb * LB_TO_KG).toFixed(0) : '-'}</td>
                <td>{a.sp.cat ? `${a.sp.cat.d} d` : '-'}</td>
              </tr>
            ))}
            <tr className="pl-total">
              <td>TOTAL</td><td>{result.reduce((n, a) => n + a.bags, 0)}</td><td>100</td><td>{sumLb.toFixed(0)}</td><td>{(sumLb * LB_TO_KG).toFixed(0)}</td><td />
            </tr>
          </tbody>
        </table>
      )}
      <div className="tiny dim pl-notes">
        <div>POUNDS USE CATAWBA'S REAL YIELD PER 10 LB BLOCK (CONTEXT, NOT CAP N STEM'S 2 LB PLANNING FIGURE).</div>
        {picked.some((a) => !(a.plan?.share)) && picked.length > 1 && <div>* NO PLAN SHARE: GIVEN THE AVERAGE SHARE OF THE OTHERS. YOUR CALL.</div>}
        {missing.length > 0 && <div className="warn">NO CATAWBA FIGURE FOR: {missing.map((a) => a.sp.name).join(', ')}.</div>}
        {picked.some((s) => s.id === 'golden-oyster') && picked.some((s) => s.id === 'phoenix-oyster') && <div>GOLDEN AND PHOENIX SHARE ONE PLAN SLOT (A WEEKS / B WEEKS), SO EACH GETS HALF.</div>}
      </div>

      <div className="section-title" style={{ marginTop: 10 }}>STOCK USED // {bags} BAGS</div>
      {(() => {
        const lines = runLines(bags, { form: cargo.prefs.form, soyShare: cargo.prefs.soyShare })
        const hand = onHandMap(cargo.moves)
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const already = cargo.moves.some((m) => m.run_ref?.startsWith(`RUN-${today}`) && m.notes?.startsWith(`${bags} BAGS`))
        const rowsFor = lines.map((l) => ({ l, it: cargo.items.find((i) => i.code === l.code) }))
        const short = rowsFor.filter(({ l, it }) => it && (hand.get(it.id) ?? 0) - l.book < 0)
        const note = `${bags} BAGS: ${result.filter((a) => a.bags > 0).map((a) => `${a.sp.name} ${a.bags}`).join(', ')}`.slice(0, 200)
        const commit = async () => {
          const ref = nextRunRef(cargo.moves)
          try {
            const r = await bookRun(cargo.store, ref, lines, cargo.items, note)
            sound.granted()
            setBooked({ ref, n: r.booked, missing: r.missing })
          } catch (e) {
            sound.chirp()
            setBooked({ ref, n: 0, missing: [], warn: true })
            window.alert(e instanceof Error ? e.message : String(e))
          }
        }
        return (
          <div className="cg-run">
            <table className="pl-table">
              <thead><tr><th>ITEM</th><th>USES</th><th>ON HAND</th><th>AFTER</th></tr></thead>
              <tbody>
                {rowsFor.map(({ l, it }) => {
                  const h = it ? hand.get(it.id) ?? 0 : 0
                  return (
                    <tr key={l.code}>
                      <td>{it?.name ?? `${l.code} (MISSING)`}</td>
                      <td>{fmtQty(l.book)} {l.unit}</td>
                      <td>{it ? fmtQty(h) : '--'}</td>
                      <td className={it && h - l.book < 0 ? 'warn' : ''}>{it ? fmtQty(h - l.book) : '--'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="tiny dim">WORKED OUT FROM 4 LB DRY PER 10 LB BAG, {cargo.prefs.form === 'combo' ? 'COMBO PELLETS' : `${Math.round((1 - cargo.prefs.soyShare) * 100)}:${Math.round(cargo.prefs.soyShare * 100)} SAWDUST : SOY HULLS`}, AND 0.3 LB OF G2 SPAWN PER BAG (1 X 6 LB PER 20). SEE CARGO FOR EACH SOURCE.</div>
            {short.length > 0 && <div className="warn tiny">{short.length} ITEM{short.length > 1 ? 'S' : ''} WOULD GO BELOW ZERO. COUNT YOUR STOCK IN CARGO FIRST FOR TRUE NUMBERS.</div>}
            {already && <div className="warn tiny">A RUN OF {bags} BAGS WAS ALREADY BOOKED TODAY. BOOKING AGAIN USES THE STOCK TWICE.</div>}
            <div className="seq-go">
              <button className="hz" disabled={!cargo.ready || bags < 1 || !lines.length} onClick={() => void commit()}>
                {already ? 'BOOK AGAIN' : 'COMMIT RUN TO CARGO'}
              </button>
              <button onClick={onOpenCargo}>OPEN CARGO</button>
            </div>
            {booked && !booked.warn && (
              <div className="tiny">
                BOOKED {booked.n} MOVES AS {booked.ref}.{booked.missing.length ? ` NOT BOOKED, ITEM DELETED: ${booked.missing.join(', ')}.` : ''} UNDO IT UNDER RUNS BOOKED IN CARGO.
              </div>
            )}
          </div>
        )
      })()}

      <div className="seq-go">
        <button className="seq-init" disabled={running || !picked.length || bags < 1} onClick={start}>
          {phase === 'done' ? 'RE-INITIATE SEQUENCE' : running ? 'SEQUENCE RUNNING' : 'INITIATE PRODUCTION SEQUENCE'}
        </button>
        {phase !== 'idle' && <button onClick={reset}>{running ? 'ABORT' : 'CLEAR'}</button>}
      </div>

    </div>
  )
}
