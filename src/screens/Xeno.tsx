import { Select } from '../components/Select'
import { PickInput } from '../components/PickInput'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import { useApp } from '../settings/AppContext'
import { useStore, useStoreStatus, useTable } from '../store/StoreContext'
import { RefText } from '../manual/ManualLinks'
import { HazardPick } from '../components/HazardPick'
import { hazardName, type LotLoss } from '../lib/hazard'
import { SPECIES } from '../data/species'
import { weekSplit } from '../data/cropplan'
import { WEEKLY_BAGS } from '../data/species'
import {
  KIND_LABEL,
  LOT_LETTER,
  RATIO,
  RATIO_SRC,
  STORAGE_KINDS,
  buildTree,
  childP,
  cultureAge,
  flatten,
  grainAge,
  grainRemaining,
  isActiveCulture,
  mmdd,
  nextKnockDay,
  nextStrainCode,
  pCounts,
  pLabel,
  planChain,
  recordUrl,
  shortfall,
  speciesOf,
  strainStock,
  todayIso,
  type AgeCheck,
  type BlockLot,
  type Culture,
  type CultureKind,
  type GrainRun,
  type Strain,
  type TreeNode,
} from '../lib/xeno'
import {
  DEFAULT_SOURCE,
  DEMO_CODE,
  addCultures,
  addGrainRun,
  addLot,
  loadDemo,
  newStrain,
  removeDemo,
  contaminateCulture,
  lossGrainRun,
  lossLot,
  lotBagsLost,
  lotLosses as lossesOfLot,
  setCultureStatus,
  setGrainStatus,
  setLotStatus,
} from '../lib/xenoActions'

export const XENO_TABS = ['STRAINS', 'STOCK', 'LINEAGE', 'PLANNER', 'LABELS'] as const
export type XenoTab = (typeof XENO_TABS)[number]
export interface XenoState {
  tab: XenoTab
  strain: string | null
  node: string | null
}
type SetXeno = (p: Partial<XenoState>) => void
type Say = (text: string, warn?: boolean) => void

// ---------- data ----------

function useXenoData() {
  const strains = useTable<Strain>('strains')
  const cultures = useTable<Culture>('cultures')
  const runs = useTable<GrainRun>('grain_runs')
  const lots = useTable<BlockLot>('block_lots')
  const lotLoss = useTable<LotLoss>('lot_losses')
  const sorted = useMemo(() => [...strains].sort((a, b) => a.code.localeCompare(b.code)), [strains])
  return { strains: sorted, cultures, runs, lots, lotLoss }
}
type XData = ReturnType<typeof useXenoData>

const spName = (key: string) => speciesOf(key)?.name ?? key.toUpperCase()

function useRun(say: Say) {
  const { sound } = useApp()
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      sound.confirm()
      say(ok)
      return true
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
      return false
    }
  }
}

/** A button that asks twice before doing something that cannot be undone. */
function Confirm({ label, onYes, disabled }: { label: string; onYes: () => void; disabled?: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <button type="button" className={`btn danger ${sure ? 'on' : ''}`} disabled={disabled} onClick={() => (sure ? (setSure(false), onYes()) : setSure(true))} onBlur={() => setSure(false)}>
      {sure ? 'SURE? TAP AGAIN' : label}
    </button>
  )
}

/** A text field that saves when you leave it or press Enter. */
function Field({ label, value, onSave, wide, placeholder }: { label: string; value: string; onSave: (v: string) => void; wide?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  const commit = () => draft.trim() !== value && onSave(draft.trim())
  return (
    <label className={`cg-field ${wide ? 'wide' : ''}`}>
      <span>{label}</span>
      <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
    </label>
  )
}

const AGE_TONE: Record<AgeCheck['state'], string> = { ok: '', warn: 'warn', over: 'warn', none: 'dim' }

// ---------- glyphs (own line art) ----------

function Glyph({ kind }: { kind: string }) {
  switch (kind) {
    case 'strain':
      return <path d="M0 -11L11 0L0 11L-11 0Z M0 -5L5 0L0 5L-5 0Z" />
    case 'plate':
      return (
        <>
          <circle r="9" />
          <circle r="6.5" className="xg-faint" />
          <circle r="2.2" />
        </>
      )
    case 'slant':
      return <path d="M-4 -10H4V7A4 4 0 0 1 -4 7Z M-4 6L4 -2" />
    case 'liquid':
      return <path d="M-3 -10H3M-2 -10V-3L-9 9H9L2 -3V-10 M-6 4H6" />
    case 'water':
      return <path d="M-4 -10H4V7A4 4 0 0 1 -4 7Z M-4 -1q2 -2 4 0t4 0" />
    case 'cryo':
      return <path d="M-3.5 -10H3.5V-7H-3.5Z M-3 -7V6L0 10L3 6V-7 M0 -3V5M-2.5 -1L2.5 3M2.5 -1L-2.5 3" />
    case 'G1':
      return <path d="M-6 -9H6L7 9H-7Z M-3 -9V-4H3V-9 M-5 3H5" />
    case 'G2':
      return <path d="M-8 -10H8L9 10H-9Z M-3 -10V-4H3V-10 M-7 2H7M-7 6H7" />
    case 'lot':
      return <path d="M-9 -2H-1V9H-9Z M1 -2H9V9H1Z M-4 -11H4V-2H-4Z" />
    default:
      return <circle r="7" />
  }
}

function MiniGlyph({ kind }: { kind: string }) {
  return (
    <svg className="xg-mini" viewBox="-12 -12 24 24" aria-hidden>
      <g className="xg-glyph">
        <Glyph kind={kind} />
      </g>
    </svg>
  )
}

// ---------- P-level meters ----------

function PMeter({ label, n, max }: { label: string; n: number; max: number }) {
  const cells = Math.max(max, 6)
  return (
    <span className="xp-meter" title={`${label}: ${n}`}>
      <span className="xp-l">{label}</span>
      <span className="xp-track" aria-hidden>
        {Array.from({ length: cells }).map((_, i) => (
          <i key={i} className={i < n ? 'on' : ''} />
        ))}
      </span>
      <span className="xp-n">{n}</span>
    </span>
  )
}

function StrainMeters({ s, d }: { s: Strain; d: XData }) {
  const pc = pCounts(s.id, d.cultures)
  const max = Math.max(6, ...pc.p, pc.master)
  return (
    <div className="xp-meters">
      <PMeter label="MSTR" n={pc.master} max={max} />
      {pc.p.map((n, i) => (
        <PMeter key={i} label={`P${i + 1}`} n={n} max={max} />
      ))}
      {pc.past > 0 && <div className="warn tiny">{pc.past} PAST P4: EXPAND FROM STORAGE, NOT OLD PLATES (<RefText text="F03-0264" />)</div>}
    </div>
  )
}

// ---------- STRAINS ----------

function StrainsTab({ d, x, set, say, onOpenSpecies }: { d: XData; x: XenoState; set: SetXeno; say: Say; onOpenSpecies: (key: string) => void }) {
  const store = useStore()
  const run = useRun(say)
  const [sp, setSp] = useState('blue-oyster')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const suggested = nextStrainCode(sp, d.strains)
  const sel = d.strains.find((s) => s.id === x.strain) ?? null
  const demo = d.strains.some((s) => s.code === DEMO_CODE)

  const add = () => {
    const c = (code.trim() || suggested).toUpperCase()
    if (d.strains.some((s) => s.code.toUpperCase() === c)) return say(`${c} IS ALREADY ON FILE.`, true)
    const row = newStrain({ species_key: sp, code: c, name, source })
    void run(() => store.put('strains', row), `STRAIN ${c} REGISTERED`).then((ok) => {
      if (!ok) return
      setCode('')
      setName('')
      set({ strain: row.id })
    })
  }

  return (
    <div className="xn-sec">
      <div className="dim tiny">
        {d.strains.length} OF 17 STRAINS ON FILE // {d.strains.filter((s) => s.active).length} ACTIVE // CODES ARE SPECIES LETTERS + NUMBER (LM-01)
      </div>
      <div className="xn-list">
        {d.strains.map((s) => {
          const pc = pCounts(s.id, d.cultures)
          return (
            <button key={s.id} type="button" className={`xn-row ${s.id === x.strain ? 'sel' : ''} ${s.active ? '' : 'off'}`} onClick={() => set({ strain: s.id })}>
              <span className="xn-code">{s.code}</span>
              <span>{spName(s.species_key)}</span>
              <span className="dim">{s.name ?? 'UNNAMED'}</span>
              <span className="xn-src dim">{s.source ?? ''}</span>
              <span className="xn-pc">
                M{pc.master} {pc.p.map((n, i) => `P${i + 1}:${n}`).join(' ')}
              </span>
            </button>
          )
        })}
        {!d.strains.length && <div className="dim">NO STRAINS ON FILE. REGISTER YOURS BELOW, OR LOAD THE EXAMPLE TO SEE HOW THE SCREENS WORK.</div>}
      </div>

      {sel && (
        <div className="cg-panel">
          <div className="cg-panel-head">
            <span className="rr-name">
              {sel.code} // {spName(sel.species_key)}
            </span>
            <span className="cg-btns">
              <button type="button" className="btn" onClick={() => set({ tab: 'LINEAGE' })}>LINEAGE</button>
              <button type="button" className="btn" onClick={() => set({ tab: 'STOCK' })}>STOCK</button>
              <button type="button" className="btn" onClick={() => onOpenSpecies(sel.species_key)}>SPECIMEN FILE</button>
            </span>
          </div>
          <StrainMeters s={sel} d={d} />
          <div className="cg-fields">
            <Field label="CODE" value={sel.code} onSave={(v) => v && void run(() => store.put('strains', { ...sel, code: v.toUpperCase() }), 'CODE SAVED')} />
            <Field label="NAME" value={sel.name ?? ''} placeholder="NOT SET" onSave={(v) => void run(() => store.put('strains', { ...sel, name: v || null }), 'NAME SAVED')} />
            <Field label="SOURCE" value={sel.source ?? ''} onSave={(v) => void run(() => store.put('strains', { ...sel, source: v || null }), 'SOURCE SAVED')} />
            <label className="cg-field">
              <span>SPECIES</span>
              <Select value={sel.species_key} onChange={(e) => void run(() => store.put('strains', { ...sel, species_key: e.target.value }), 'SPECIES SAVED')}>
                {SPECIES.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </label>
            <Field label="NOTES" wide value={sel.notes ?? ''} placeholder="NONE" onSave={(v) => void run(() => store.put('strains', { ...sel, notes: v || null }), 'NOTES SAVED')} />
          </div>
          <div className="cg-btns">
            <button type="button" className={`btn ${sel.active ? 'on' : ''}`} onClick={() => void run(() => store.put('strains', { ...sel, active: !sel.active }), sel.active ? `${sel.code} RETIRED` : `${sel.code} ACTIVE`)}>
              {sel.active ? 'ACTIVE' : 'RETIRED'}
            </button>
            <Confirm
              label="DELETE STRAIN"
              disabled={d.cultures.some((c) => c.strain_id === sel.id) || d.runs.some((g) => g.strain_id === sel.id)}
              onYes={() => void run(() => store.del('strains', sel.id), `${sel.code} DELETED`).then(() => set({ strain: null }))}
            />
            {(d.cultures.some((c) => c.strain_id === sel.id) || d.runs.some((g) => g.strain_id === sel.id)) && <span className="dim tiny">HAS CULTURES: RETIRE IT INSTEAD</span>}
          </div>
        </div>
      )}

      <div className="section-title rr-sec">REGISTER A STRAIN</div>
      <div className="cg-add xn-add">
        <Select aria-label="Species" value={sp} onChange={(e) => setSp(e.target.value)}>
          {SPECIES.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <input aria-label="Strain code" placeholder={suggested} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: '7em' }} />
        <input aria-label="Strain name" placeholder="NAME" value={name} onChange={(e) => setName(e.target.value)} />
        <input aria-label="Source" placeholder="SOURCE" value={source} onChange={(e) => setSource(e.target.value)} />
        <button type="button" className="btn" onClick={add}>REGISTER</button>
      </div>
      <div className="cg-btns" style={{ marginTop: 8 }}>
        {!demo && <button type="button" className="btn" onClick={() => void run(() => loadDemo(store, d.strains), 'EXAMPLE STRAIN DEMO-01 LOADED')}>LOAD EXAMPLE</button>}
        {demo && <Confirm label="REMOVE EXAMPLE" onYes={() => void run(() => removeDemo(store, d.strains, d.cultures, d.runs, d.lots), 'EXAMPLE REMOVED').then(() => set({ strain: null, node: null }))} />}
      </div>
    </div>
  )
}

// ---------- STOCK ----------

interface Warning {
  key: string
  strain: Strain
  what: string
  age: AgeCheck
}

function warnings(d: XData): Warning[] {
  const out: Warning[] = []
  const byId = new Map(d.strains.map((s) => [s.id, s]))
  for (const c of d.cultures) {
    if (!isActiveCulture(c)) continue
    const s = byId.get(c.strain_id)
    if (!s) continue
    const a = cultureAge(c)
    if (a.state === 'warn' || a.state === 'over') out.push({ key: `c:${c.id}`, strain: s, what: c.label ?? `${pLabel(c.p_level)} ${KIND_LABEL[c.kind]}`, age: a })
  }
  for (const g of d.runs) {
    const s = byId.get(g.strain_id)
    if (!s || grainRemaining(g, d.runs, d.lots) <= 0) continue
    const a = grainAge(g, s.species_key)
    if (a.state === 'warn' || a.state === 'over') out.push({ key: `g:${g.id}`, strain: s, what: g.label ?? g.generation, age: a })
  }
  return out.sort((a, b) => (a.age.state === b.age.state ? b.age.days - a.age.days : a.age.state === 'over' ? -1 : 1))
}

function AddMaster({ strain, d, say }: { strain: Strain; d: XData; say: Say }) {
  const store = useStore()
  const run = useRun(say)
  const [kind, setKind] = useState<CultureKind>('slant')
  const [p, setP] = useState('0')
  const [n, setN] = useState('1')
  const [loc, setLoc] = useState('')
  const [made, setMade] = useState(todayIso())
  return (
    <div className="cg-add xn-add">
      <span className="dim tiny">ADD A MASTER OR A BOUGHT CULTURE:</span>
      <Select aria-label="Kind" value={kind} onChange={(e) => (setKind(e.target.value as CultureKind), setP(e.target.value === 'plate' ? '1' : '0'))}>
        {(['cryo', 'slant', 'water', 'plate', 'liquid', 'spore_print'] as CultureKind[]).map((k) => (
          <option key={k} value={k}>{KIND_LABEL[k]}</option>
        ))}
      </Select>
      <Select aria-label="P-level" value={p} onChange={(e) => setP(e.target.value)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <option key={i} value={i}>{pLabel(i)}</option>
        ))}
      </Select>
      <input aria-label="How many" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} style={{ width: '3.5em' }} />
      <PickInput aria-label="Made on" type="date" value={made} onChange={(e) => setMade(e.target.value)} />
      <input aria-label="Location" placeholder="LOCATION" value={loc} onChange={(e) => setLoc(e.target.value)} style={{ width: '9em' }} />
      <button
        type="button"
        className="btn"
        onClick={() =>
          void run(() => addCultures(store, { strain, parent: null, kind, count: Number(n) || 1, p_level: Number(p), made_on: made || todayIso(), location: loc.trim() || null, existing: d.cultures }), `${n} ${KIND_LABEL[kind]} ADDED TO ${strain.code}`)
        }
      >
        ADD
      </button>
    </div>
  )
}

function StockTab({ d, x, set, say }: { d: XData; x: XenoState; set: SetXeno; say: Say }) {
  const sel = d.strains.find((s) => s.id === x.strain) ?? null
  const warns = warnings(d)
  const shown = sel ? [sel] : d.strains.filter((s) => s.active)
  const open = (key: string, strainId: string) => set({ tab: 'LINEAGE', strain: strainId, node: key })

  return (
    <div className="xn-sec">
      <div className="section-title">COLD STORAGE AND AGE // {warns.length ? `${warns.length} WARNING${warns.length > 1 ? 'S' : ''}` : 'ALL CLEAR'}</div>
      {warns.length > 0 && (
        <div className="xn-warns">
          {warns.map((w) => (
            <button key={w.key} type="button" className={`xn-warn ${w.age.state}`} onClick={() => open(w.key, w.strain.id)}>
              <span>{w.what}</span>
              <span>{w.age.text}</span>
              <span className="xn-why">
                {w.age.limit?.rule} <RefText text={w.age.limit?.src ?? ''} />
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="dim tiny">
        LIMITS: PLATES 3 MONTHS (<RefText text="F03-0268" />), SLANTS 6-8 MONTHS (<RefText text="F04-0070" />), WATER TUBES CHECK 6-12 MONTHS (<RefText text="F04-0236" />), CRYOVIALS TEST AT 18-24 MONTHS (<RefText text="F04-0061" />), COLD G1 ABOUT A MONTH (<RefText text="F04-0088" />), COLD G2 2 WEEKS, 3 AT MOST, LION'S MANE AND COMB TOOTH 2 (<RefText text="F04-0089 F04-0090 F04-0091" />). LC IN THE FRIDGE: NO LIMIT IN SOURCES (<RefText text="F04-0096" />).
      </div>

      <div className="section-title rr-sec">{sel ? `${sel.code} // CULTURE STOCK` : 'CULTURE STOCK // ACTIVE STRAINS'}</div>
      {!shown.length && <div className="dim">NO ACTIVE STRAINS. REGISTER ONE UNDER STRAINS.</div>}
      <div className="xn-stock">
        {shown.map((s) => {
          const st = strainStock(s.id, s.species_key, d.cultures, d.runs, d.lots)
          const pc = pCounts(s.id, d.cultures)
          return (
            <div key={s.id} className={`xn-card ${s.id === x.strain ? 'sel' : ''}`}>
              <button type="button" className="xn-card-h" onClick={() => set({ strain: s.id })}>
                <span className="xn-code">{s.code}</span> <span className="dim">{spName(s.species_key)}</span>
              </button>
              <StrainMeters s={s} d={d} />
              <div className="tiny">
                LC {pc.lc} // G1 MASTERS {st.g1} // G2 BAGS {st.g2}
              </div>
            </div>
          )
        })}
      </div>

      {sel && (
        <>
          <div className="section-title rr-sec">ON THE SHELF // TAP TO OPEN IN THE LINEAGE</div>
          <div className="xn-items">
            {d.cultures
              .filter((c) => c.strain_id === sel.id && isActiveCulture(c))
              .sort((a, b) => (a.p_level ?? 0) - (b.p_level ?? 0) || a.made_on.localeCompare(b.made_on))
              .map((c) => {
                const a = cultureAge(c)
                return (
                  <button key={c.id} type="button" className="xn-item" onClick={() => open(`c:${c.id}`, sel.id)}>
                    <MiniGlyph kind={c.kind} />
                    <span>{c.label}</span>
                    <span className="dim">{c.status === 'cold_storage' ? 'COLD' : 'CLEAN'}{c.location ? ` // ${c.location}` : ''}</span>
                    <span className={AGE_TONE[a.state]}>{a.text}</span>
                  </button>
                )
              })}
            {d.runs
              .filter((g) => g.strain_id === sel.id && grainRemaining(g, d.runs, d.lots) > 0)
              .map((g) => {
                const a = grainAge(g, sel.species_key)
                return (
                  <button key={g.id} type="button" className="xn-item" onClick={() => open(`g:${g.id}`, sel.id)}>
                    <MiniGlyph kind={g.generation} />
                    <span>{g.label}</span>
                    <span className="dim">
                      {grainRemaining(g, d.runs, d.lots)} OF {g.bag_count} BAGS // {g.status.replace('_', ' ').toUpperCase()}
                    </span>
                    <span className={AGE_TONE[a.state]}>{a.text}</span>
                  </button>
                )
              })}
          </div>
          <AddMaster strain={sel} d={d} say={say} />
        </>
      )}
    </div>
  )
}

// ---------- LINEAGE ----------

const COL = 168
const ROWH = 40

function nodeInfo(n: TreeNode, d: XData, strain: Strain): { glyph: string; l1: string; l2: string; cls: string } {
  if (n.type === 'strain') return { glyph: 'strain', l1: strain.code, l2: spName(strain.species_key), cls: 'root' }
  if (n.type === 'culture') {
    const c = d.cultures.find((x) => x.id === n.id)!
    const a = cultureAge(c)
    const cls = c.status === 'contaminated' ? 'contam' : c.status === 'used_up' || c.status === 'discarded' ? 'spent' : a.state === 'over' || a.state === 'warn' ? 'old' : ''
    return { glyph: c.kind, l1: `${pLabel(c.p_level)} ${KIND_LABEL[c.kind]}`, l2: `${mmdd(c.made_on)} ${c.status === 'clean' ? '' : c.status.replace('_', ' ').toUpperCase()}`, cls }
  }
  if (n.type === 'grain') {
    const g = d.runs.find((x) => x.id === n.id)!
    const left = grainRemaining(g, d.runs, d.lots)
    const cls = g.status === 'contaminated' ? 'contam' : left <= 0 ? 'spent' : grainAge(g, strain.species_key).state !== 'ok' ? 'old' : ''
    return { glyph: g.generation, l1: `${g.generation} x${g.bag_count}${g.bags_lost ? ` -${g.bags_lost}` : ''}`, l2: `${mmdd(g.inoculated_on)} ${left > 0 ? `${left} LEFT` : g.status === 'contaminated' ? 'CONTAM' : 'USED'}`, cls }
  }
  const l = d.lots.find((x) => x.id === n.id)!
  return { glyph: 'lot', l1: `${l.lot_code} x${l.bag_count}`, l2: l.status.toUpperCase(), cls: l.status === 'lost' ? 'contam' : l.status === 'spent' ? 'spent' : '' }
}

function Tree({ root, d, strain, sel, onPick }: { root: TreeNode; d: XData; strain: Strain; sel: string | null; onPick: (k: string) => void }) {
  const nodes = flatten(root)
  const depth = Math.max(...nodes.map((n) => n.x))
  const rows = Math.max(1, ...nodes.map((n) => n.y + 1))
  const W = (depth + 1) * COL + 40
  const H = rows * ROWH + 16
  const pos = (n: TreeNode) => [20 + n.x * COL, 22 + n.y * ROWH] as const
  return (
    <div className="xt-wrap">
      <svg className="xt" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Lineage of ${strain.code}`}>
        {nodes.map((n) =>
          n.children.map((c) => {
            const [px, py] = pos(n)
            const [cx, cy] = pos(c)
            const mx = px + COL * 0.42
            return <path key={`${n.key}-${c.key}`} className="xt-link" d={`M${px + 12} ${py}H${mx}V${cy}H${cx - 13}`} />
          }),
        )}
        {nodes.map((n) => {
          const [x, y] = pos(n)
          const info = nodeInfo(n, d, strain)
          return (
            <g
              key={n.key}
              className={`xt-node ${info.cls} ${sel === n.key ? 'sel' : ''}`}
              transform={`translate(${x} ${y})`}
              onClick={() => onPick(n.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(n.key))}
            >
              <rect className="xt-hit" x="-16" y="-17" width={COL - 10} height={ROWH - 6} />
              {sel === n.key && <rect className="xt-sel" x="-15" y="-15" width="30" height="30" />}
              <g className="xg-glyph">
                <Glyph kind={info.glyph} />
              </g>
              {info.cls === 'contam' && <path className="xt-x" d="M-11 -11L11 11M11 -11L-11 11" />}
              <text x="17" y="-2" className="xt-t1">{info.l1}</text>
              <text x="17" y="11" className="xt-t2">{info.l2}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Num({ label, value, set, w = '3.6em' }: { label: string; value: string; set: (v: string) => void; w?: string }) {
  return (
    <label className="xn-num">
      <span>{label}</span>
      <input inputMode="numeric" value={value} onChange={(e) => set(e.target.value)} style={{ width: w }} />
    </label>
  )
}

function NodePanel({ k, d, strain, say, set, onLabel }: { k: string; d: XData; strain: Strain; say: Say; set: SetXeno; onLabel: (k: string) => void }) {
  const store = useStore()
  const run = useRun(say)
  const [n, setN] = useState('1')
  const [kind, setKind] = useState<CultureKind>('plate')
  const [bags, setBags] = useState('12')
  const [masters, setMasters] = useState('1')
  const [lost, setLost] = useState('')
  const [haz, setHaz] = useState('')
  const [lotLostN, setLotLostN] = useState('')
  const [blocks, setBlocks] = useState('20')
  const [g2used, setG2used] = useState('1')
  const [knock, setKnock] = useState(todayIso())
  const [lotCode, setLotCode] = useState('')
  const [, type, id] = /^(.):(.+)$/.exec(k) ?? []
  const letter = LOT_LETTER[strain.species_key] ?? 'X'

  useEffect(() => {
    setLotCode(`${letter}${mmdd(knock)}`)
  }, [knock, letter])

  // A pick made on one record must not carry over to the next.
  useEffect(() => {
    setHaz('')
    setLotLostN('')
    setLost('')
  }, [k])

  if (type === 's') return <div className="dim tiny">THE STRAIN. ADD A MASTER UNDER STOCK, THEN TAP IT HERE TO MAKE TRANSFERS.</div>

  const head = (title: string, sub: string, label: boolean) => (
    <div className="cg-panel-head">
      <span className="rr-name">{title}</span>
      <span className="cg-btns">
        {label && <button type="button" className="btn" onClick={() => onLabel(k)}>LABEL</button>}
        <button type="button" className="btn" onClick={() => set({ node: null })}>CLOSE</button>
      </span>
      <span className="dim tiny" style={{ flexBasis: '100%' }}>{sub}</span>
    </div>
  )

  if (type === 'c') {
    const c = d.cultures.find((x) => x.id === id)
    if (!c) return <div className="dim">RECORD NOT FOUND ON THIS DEVICE.</div>
    const a = cultureAge(c)
    const live = isActiveCulture(c)
    const nextP = childP(c, kind)
    const kids = d.cultures.some((x) => x.parent_culture_id === c.id) || d.runs.some((g) => g.parent_culture_id === c.id)
    return (
      <div className="cg-panel">
        {head(c.label ?? KIND_LABEL[c.kind], `${pLabel(c.p_level)} ${KIND_LABEL[c.kind]} // MADE ${c.made_on} // ${c.status.replace('_', ' ').toUpperCase()}${c.cold_since ? ` SINCE ${c.cold_since}` : ''} // ${a.text}`, true)}
        {a.limit && a.state !== 'ok' && (
          <div className="warn tiny">
            {a.limit.rule} <RefText text={a.limit.src} />
          </div>
        )}
        {(c.p_level ?? 0) >= 4 && kind === 'plate' && <div className="warn tiny">A TRANSFER FROM HERE IS P{(c.p_level ?? 0) + 1}. THE SAFER HABIT IS A FRESH PLATE FROM STORAGE (<RefText text="F03-0025 F03-0264" />).</div>}
        {live && (
          <div className="cg-actions">
            <div className="cg-act">
              <div className="cg-act-t">TRANSFER // MAKE A COPY</div>
              <span className="xn-inline">
                <Select aria-label="Make" value={kind} onChange={(e) => setKind(e.target.value as CultureKind)}>
                  {(['plate', 'slant', 'liquid', 'water', 'cryo'] as CultureKind[]).map((x) => (
                    <option key={x} value={x}>{KIND_LABEL[x]}</option>
                  ))}
                </Select>
                <Num label="HOW MANY" value={n} set={setN} />
              </span>
              <button type="button" className="btn" onClick={() => void run(() => addCultures(store, { strain, parent: c, kind, count: Number(n) || 1, existing: d.cultures }), `${n} ${KIND_LABEL[kind]} ${pLabel(nextP)} LOGGED`)}>
                LOG {KIND_LABEL[kind]} ({pLabel(nextP)})
              </button>
              {STORAGE_KINDS.includes(kind) && <span className="dim tiny">KEEP SLANTS AND WATER TUBES OF EACH STRAIN (<RefText text="F04-0073" />). 3-5 SLANTS PER CULTURE.</span>}
            </div>
            <div className="cg-act">
              <div className="cg-act-t">GRAIN</div>
              <span className="xn-inline">
                <Num label="BAGS" value={bags} set={setBags} />
              </span>
              <span className="cg-btns">
                <button type="button" className="btn" onClick={() => void run(() => addGrainRun(store, { strain, generation: 'G1', parentCulture: c, parentRun: null, bags: Number(bags) || 1, existing: d.runs }), `G1 x${bags} LOGGED`)}>
                  G1 MASTERS
                </button>
                <button type="button" className="btn" onClick={() => void run(() => addGrainRun(store, { strain, generation: 'G2', parentCulture: c, parentRun: null, bags: Number(bags) || 1, existing: d.runs }), `AGAR-DIRECT G2 x${bags} LOGGED`)}>
                  AGAR-DIRECT G2
                </button>
              </span>
              <span className="dim tiny">UP TO 12 MASTERS PER PLATE AT 2 CUTS, ABOUT 6 AT 4 CUTS (<RefText text="F05-0011 F05-0012" />).</span>
            </div>
          </div>
        )}
        <div className="cg-btns">
          {c.status !== 'cold_storage' && live && <button type="button" className="btn" onClick={() => void run(() => setCultureStatus(store, c, 'cold_storage'), 'INTO COLD STORAGE')}>TO FRIDGE</button>}
          {c.status !== 'clean' && <button type="button" className="btn" onClick={() => void run(() => setCultureStatus(store, c, 'clean'), 'MARKED CLEAN')}>CLEAN / OUT OF FRIDGE</button>}
          {live && <button type="button" className="btn" onClick={() => void run(() => setCultureStatus(store, c, 'used_up'), 'MARKED USED UP')}>USED UP</button>}
          {c.status !== 'contaminated' && (
            <>
              <HazardPick value={haz} onChange={setHaz} />
              <button type="button" className="btn hazard" onClick={() => void run(() => contaminateCulture(store, c, haz || null), `CONTAMINATION LOGGED: ${hazardName(haz || null)}`)}>CONTAMINATED</button>
            </>
          )}
          {c.status !== 'discarded' && <button type="button" className="btn" onClick={() => void run(() => setCultureStatus(store, c, 'discarded'), 'DISCARDED')}>DISCARD</button>}
          <Confirm label="DELETE RECORD" disabled={kids} onYes={() => void run(() => store.del('cultures', c.id), 'RECORD DELETED').then(() => set({ node: null }))} />
        </div>
        <div className="cg-fields">
          <Field label="LOCATION" value={c.location ?? ''} placeholder="NOT SET" onSave={(v) => void run(() => store.put('cultures', { ...c, location: v || null }), 'LOCATION SAVED')} />
          <Field label="NOTES" value={c.notes ?? ''} placeholder="NONE" onSave={(v) => void run(() => store.put('cultures', { ...c, notes: v || null }), 'NOTES SAVED')} />
        </div>
      </div>
    )
  }

  if (type === 'g') {
    const g = d.runs.find((x) => x.id === id)
    if (!g) return <div className="dim">RECORD NOT FOUND ON THIS DEVICE.</div>
    const left = grainRemaining(g, d.runs, d.lots)
    const a = grainAge(g, strain.species_key)
    const kids = d.runs.some((r) => r.parent_grain_run_id === g.id) || d.lots.some((l) => l.grain_run_id === g.id)
    const live = left > 0
    return (
      <div className="cg-panel">
        {head(g.label ?? g.generation, `${g.generation} // ${g.bag_count} BAGS${g.bags_lost ? `, ${g.bags_lost} LOST` : ''} // ${left} LEFT // INOCULATED ${g.inoculated_on} // ${g.status.replace('_', ' ').toUpperCase()} // ${a.text}`, true)}
        {a.limit && a.state !== 'ok' && (
          <div className="warn tiny">
            {a.limit.rule} <RefText text={a.limit.src} />
          </div>
        )}
        {live && g.generation === 'G1' && (
          <div className="cg-act">
            <div className="cg-act-t">EXPAND TO G2</div>
            <span className="xn-inline">
              <Num label="G2 BAGS" value={bags} set={setBags} />
              <Num label="MASTERS USED" value={masters} set={setMasters} />
            </span>
            {(Number(bags) || 0) / (Number(masters) || 1) < RATIO.minG2PerG1 && <span className="warn tiny">FEWER THAN 6 G2 PER MASTER: TOO MUCH INOCULUM, UNEVEN AGES (<RefText text="F05-0013" />).</span>}
            {(Number(bags) || 0) / (Number(masters) || 1) > RATIO.maxG2PerG1 && <span className="warn tiny">MORE THAN 24 G2 PER MASTER: OVERSTRETCHED, SLOW (<RefText text="F05-0013" />).</span>}
            <button type="button" className="btn" onClick={() => void run(() => addGrainRun(store, { strain, generation: 'G2', parentCulture: null, parentRun: g, bags: Number(bags) || 1, mastersUsed: Number(masters) || 1, existing: d.runs }), `G2 x${bags} LOGGED`)}>
              LOG G2 RUN
            </button>
            <span className="dim tiny">STANDARD IS 12 G2 PER MASTER, NEVER FEWER THAN 6 OR MORE THAN 24 (<RefText text="F05-0013" />).</span>
          </div>
        )}
        {live && g.generation === 'G2' && (
          <div className="cg-act">
            <div className="cg-act-t">KNOCK BLOCKS // NO G3 (<RefText text="F03-0006" />)</div>
            <span className="xn-inline">
              <Num label="BLOCKS" value={blocks} set={(v) => (setBlocks(v), setG2used(String(Math.max(1, Math.ceil((Number(v) || 0) / RATIO.blocksPerG2)))))} />
              <Num label="G2 BAGS USED" value={g2used} set={setG2used} />
              <label className="xn-num">
                <span>KNOCK DAY</span>
                <PickInput type="date" value={knock} onChange={(e) => setKnock(e.target.value || todayIso())} />
              </label>
              <label className="xn-num">
                <span>LOT CODE</span>
                <input value={lotCode} onChange={(e) => setLotCode(e.target.value.toUpperCase())} style={{ width: '6em' }} />
              </label>
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if ((Number(g2used) || 0) > left) return say(`ONLY ${left} G2 BAGS LEFT IN THIS RUN.`, true)
                void run(() => addLot(store, { strain, run: g, lot_code: lotCode || `${letter}${mmdd(knock)}`, blocks: Number(blocks) || 1, g2Used: Number(g2used) || 0, knock_date: knock }), `LOT ${lotCode} LOGGED`)
              }}
            >
              LOG BLOCK LOT
            </button>
            <span className="dim tiny">ABOUT 20 BLOCKS PER 6 LB G2 BAG (<RefText text="F05-0014" />). LOT CODE = SPECIES LETTER + KNOCK MMDD; LETTERS OTHER THAN B ARE A GUESS.</span>
          </div>
        )}
        <div className="cg-btns">
          {live && g.status !== 'ready' && g.status !== 'cold_storage' && <button type="button" className="btn" onClick={() => void run(() => setGrainStatus(store, g, 'ready'), 'MARKED READY')}>READY</button>}
          {live && g.status !== 'cold_storage' && <button type="button" className="btn" onClick={() => void run(() => setGrainStatus(store, g, 'cold_storage'), 'INTO COLD STORAGE')}>TO FRIDGE</button>}
          {live && <button type="button" className="btn" onClick={() => void run(() => setGrainStatus(store, g, 'used_up'), 'MARKED USED UP')}>USED UP</button>}
          {live && <button type="button" className="btn" onClick={() => void run(() => setGrainStatus(store, g, 'discarded'), 'DISCARDED')}>DISCARD</button>}
          <Confirm label="DELETE RECORD" disabled={kids} onYes={() => void run(() => store.del('grain_runs', g.id), 'RECORD DELETED').then(() => set({ node: null }))} />
        </div>
        <div className="cg-add xn-add">
          <span className="dim tiny">CONTAMINATION: BAGS LOST IN TOTAL</span>
          <input aria-label="Bags lost" inputMode="numeric" placeholder={String(g.bags_lost || 0)} value={lost} onChange={(e) => setLost(e.target.value)} style={{ width: '4em' }} />
          <HazardPick value={haz} onChange={setHaz} />
          <button type="button" className="btn hazard" onClick={() => void run(() => lossGrainRun(store, g, Number(lost) || 0, haz || null), `${Number(lost) || 0} BAGS MARKED LOST: ${hazardName(haz || null)}`).then(() => setLost(''))}>
            LOG LOSS
          </button>
          {g.generation === 'G1' && <span className="dim tiny">STROMA MULTIPLIES ABOUT 10X PER EXPANSION; SCREEN MASTERS HARDEST (<RefText text="F05-0010" />).</span>}
        </div>
        <div className="cg-fields">
          <Field label="LOCATION" value={g.location ?? ''} placeholder="NOT SET" onSave={(v) => void run(() => store.put('grain_runs', { ...g, location: v || null }), 'LOCATION SAVED')} />
          <Field label="RESULT / NOTES" value={g.result ?? ''} placeholder="NONE" onSave={(v) => void run(() => store.put('grain_runs', { ...g, result: v || null }), 'SAVED')} />
        </div>
      </div>
    )
  }

  const l = d.lots.find((x) => x.id === id)
  if (!l) return <div className="dim">RECORD NOT FOUND ON THIS DEVICE.</div>
  return (
    <div className="cg-panel">
      {head(`LOT ${l.lot_code}`, `${l.bag_count} BLOCKS // KNOCKED ${l.knock_date} // ${l.g2_bags_used ?? '?'} G2 BAGS // ${l.status.toUpperCase()}`, false)}
      <div className="cg-btns">
        {(['incubating', 'fruiting', 'spent'] as const).map((s) => (
          <button key={s} type="button" className={`btn ${l.status === s ? 'on' : ''}`} onClick={() => void run(() => setLotStatus(store, l, s), `LOT ${s.toUpperCase()}`)}>
            {s.toUpperCase()}
          </button>
        ))}
        <button type="button" className={`btn hazard ${l.status === 'lost' ? 'on' : ''}`} onClick={() => void run(() => setLotStatus(store, l, 'lost'), 'LOT MARKED LOST')}>LOST</button>
        <Confirm label="DELETE LOT" onYes={() => void run(() => store.del('block_lots', l.id), 'LOT DELETED').then(() => set({ node: null }))} />
      </div>
      <div className="cg-add xn-add">
        <span className="dim tiny">CONTAMINATION: BLOCKS LOST ({lotBagsLost(d.lotLoss, l.id)} OF {l.bag_count} LOGGED)</span>
        <input aria-label="Blocks lost" inputMode="numeric" placeholder="HOW MANY" value={lotLostN} onChange={(e) => setLotLostN(e.target.value)} style={{ width: '5em' }} />
        <HazardPick value={haz} onChange={setHaz} />
        <button type="button" className="btn hazard" onClick={() => void run(() => lossLot(store, l, d.lotLoss, Number(lotLostN) || 0, haz || null), `${Number(lotLostN) || 0} BLOCKS MARKED LOST: ${hazardName(haz || null)}`).then((ok) => ok && setLotLostN(''))}>
          LOG LOSS
        </button>
      </div>
      {lossesOfLot(d.lotLoss, l.id).length > 0 && (
        <div className="dim tiny">
          {lossesOfLot(d.lotLoss, l.id).map((x) => `${x.noted_on} ${x.bag_count} ${hazardName(x.hazard_key)}`).join(' // ')}
        </div>
      )}
      <div className="cg-fields">
        <Field label="NOTES" wide value={l.notes ?? ''} placeholder="NONE" onSave={(v) => void run(() => store.put('block_lots', { ...l, notes: v || null }), 'SAVED')} />
      </div>
    </div>
  )
}

function LineageTab({ d, x, set, say, onLabel }: { d: XData; x: XenoState; set: SetXeno; say: Say; onLabel: (k: string) => void }) {
  const [spent, setSpent] = useState(true)
  const strain = d.strains.find((s) => s.id === x.strain) ?? null
  const root = useMemo(() => (strain ? buildTree(strain, d.cultures, d.runs, d.lots, spent) : null), [strain, d.cultures, d.runs, d.lots, spent])
  if (!strain || !root)
    return (
      <div className="xn-sec">
        <div className="dim">PICK A STRAIN IN THE LIST TO SEE ITS LINE.</div>
        <div className="xn-picker">
          {d.strains.map((s) => (
            <button key={s.id} type="button" className="btn" onClick={() => set({ strain: s.id })}>{s.code}</button>
          ))}
        </div>
      </div>
    )
  return (
    <div className="xn-sec">
      <div className="xn-legend tiny dim">
        {[
          ['strain', 'STRAIN'],
          ['cryo', 'CRYO'],
          ['slant', 'SLANT'],
          ['water', 'WATER'],
          ['plate', 'PLATE'],
          ['liquid', 'LC'],
          ['G1', 'G1'],
          ['G2', 'G2'],
          ['lot', 'BLOCKS'],
        ].map(([k, t]) => (
          <span key={k}>
            <MiniGlyph kind={k} /> {t}
          </span>
        ))}
        <button type="button" className={`btn ${spent ? '' : 'on'}`} onClick={() => setSpent(!spent)}>{spent ? 'HIDE SPENT' : 'SHOW SPENT'}</button>
      </div>
      <Tree root={root} d={d} strain={strain} sel={x.node} onPick={(k) => set({ node: x.node === k ? null : k })} />
      {root.children.length === 0 && <div className="dim">NO CULTURES YET. ADD A MASTER UNDER STOCK.</div>}
      {x.node && <NodePanel key={x.node} k={x.node} d={d} strain={strain} say={say} set={set} onLabel={onLabel} />}
      {!x.node && <div className="dim tiny">TAP A NODE TO LOG THE NEXT STEP: TRANSFER, LC, G1 OR G2 RUN, BLOCKS, CONTAMINATION.</div>}
    </div>
  )
}

// ---------- PLANNER ----------

interface PlanPrefs {
  blocks: Record<string, number>
  strain: Record<string, string>
  knock: string | null
}
const PLAN_KEY = 'mycol.xeno.plan.v1'
function loadPlan(): PlanPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PLAN_KEY) ?? '') as PlanPrefs
    if (p && typeof p.blocks === 'object') return { blocks: p.blocks ?? {}, strain: p.strain ?? {}, knock: p.knock ?? null }
  } catch {
    /* none saved */
  }
  return { blocks: {}, strain: {}, knock: null }
}

const ROUTE_TEXT = {
  none: 'NOTHING TO MAKE',
  weekly: 'MASTER(S) EVERY WEEK',
  fortnight: 'ONE MASTER EVERY 2 WEEKS, HALF THE G2 HELD COLD ONE WEEK',
  direct: 'AGAR-DIRECT 6 LB BAGS, 4 CUTS EACH (TOO FEW FOR A MASTER)',
}

function PlannerTab({ d, set }: { d: XData; set: SetXeno }) {
  const [prefs, setPrefs] = useState(loadPlan)
  const save = (p: PlanPrefs) => {
    setPrefs(p)
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(p))
    } catch {
      /* storage blocked */
    }
  }
  const knock = prefs.knock && prefs.knock >= todayIso() ? prefs.knock : nextKnockDay(todayIso())
  const week = weekSplit(knock)
  const split = new Map(week.map((x) => [x.key, x.bags]))
  const keys = [...new Set([...week.map((x) => x.key), ...d.strains.filter((s) => s.active).map((s) => s.species_key)])]
  const today = todayIso()

  const rows = keys.map((key) => {
    const blocks = prefs.blocks[key] ?? split.get(key) ?? 0
    const options = d.strains.filter((s) => s.species_key === key && s.active)
    const strain = options.find((s) => s.id === prefs.strain[key]) ?? options[0] ?? null
    const plan = planChain(key, blocks, knock)
    const stock = strain ? strainStock(strain.id, key, d.cultures, d.runs, d.lots) : { plates: 0, g1: 0, g2: 0 }
    const sf = strain ? shortfall(plan, stock) : { level: plan.route === 'none' ? ('ok' as const) : ('short' as const), next: plan.route === 'none' ? 'NO BLOCKS PLANNED' : 'NO STRAIN ON FILE FOR THIS SPECIES' }
    return { key, blocks, options, strain, plan, stock, sf }
  })
  const tot = rows.reduce((a, r) => ({ blocks: a.blocks + r.plan.blocks, g2: a.g2 + r.plan.g2, g1: a.g1 + r.plan.g1, plates: a.plates + r.plan.plates }), { blocks: 0, g2: 0, g1: 0, plates: 0 })
  const late = (day: string | null) => (day && day < today ? 'warn' : '')

  return (
    <div className="xn-sec">
      <div className="xn-plan-top">
        <label className="xn-num">
          <span>KNOCK DAY</span>
          <PickInput type="date" value={knock} onChange={(e) => save({ ...prefs, knock: e.target.value || null })} />
        </label>
        <span className="tiny">
          {tot.blocks} BLOCKS // {tot.g2} G2 // {tot.g1} G1 // {tot.plates} PLATES
        </span>
        <button type="button" className="btn" onClick={() => save({ blocks: {}, strain: {}, knock: null })}>RESET TO SEQUENCE PLAN</button>
      </div>
      <div className="dim tiny">
        STARTS FROM THE SEQUENCE WEEKLY PLAN: {WEEKLY_BAGS} BAGS ON THIS KNOCK'S CROP-PLAN SPLIT (THE SECONDARY SLOT IS THE SPECIES YOU PICK IN PRODUCTION SEQUENCE). CHANGE ANY BLOCK COUNT BELOW. WORKS BACK AT 20 BLOCKS PER G2 (<RefText text={RATIO_SRC.blocksPerG2} />), 12 G2 PER MASTER, NEVER FEWER THAN 6 (<RefText text={RATIO_SRC.g2PerG1} />), 12 MASTERS PER PLATE (<RefText text={RATIO_SRC.g1PerPlate} />), MASTER GROWS ABOUT 2 WEEKS (<RefText text={RATIO_SRC.g1Days} />), G2 HOLDS 2 WEEKS COLD (<RefText text={RATIO_SRC.g2Hold} />). PLATE LEAD TIMES (OYSTERS 8 D, LION'S MANE AND CORAL TOOTH 15 D) ARE FROM THE 100-BAG FARM SCHEDULE. A DATE IN WARNING COLOUR HAS ALREADY PASSED: THAT STEP NEEDED TO BE DONE ALREADY, SO THE KNOCK RELIES ON STOCK ON THE SHELF.
      </div>
      {rows.map((r) => {
        const p = r.plan
        return (
          <div key={r.key} className={`xn-plan ${r.sf.level === 'short' ? 'short' : ''}`}>
            <div className="xn-plan-h">
              <span className="xn-code">{spName(r.key)}</span>
              <label className="xn-num">
                <span>BLOCKS</span>
                <input inputMode="numeric" value={String(r.blocks)} onChange={(e) => save({ ...prefs, blocks: { ...prefs.blocks, [r.key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })} style={{ width: '4em' }} />
              </label>
              <label className="xn-num">
                <span>STRAIN</span>
                <Select value={r.strain?.id ?? ''} onChange={(e) => save({ ...prefs, strain: { ...prefs.strain, [r.key]: e.target.value } })} disabled={!r.options.length}>
                  {!r.options.length && <option value="">NONE ON FILE</option>}
                  {r.options.map((s) => (
                    <option key={s.id} value={s.id}>{s.code}{s.name ? ` ${s.name}` : ''}</option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="xn-chain">
              <span>
                <MiniGlyph kind="plate" /> {p.plates} PLATE{p.plates === 1 ? '' : 'S'}
              </span>
              <span className="xn-arrow">&gt;</span>
              <span>
                <MiniGlyph kind="G1" /> {p.route === 'direct' ? 'NO MASTER' : `${p.g1} G1`}
              </span>
              <span className="xn-arrow">&gt;</span>
              <span>
                <MiniGlyph kind="G2" /> {p.g2} G2{p.g2Made > p.g2 ? ` (MAKE ${p.g2Made})` : ''}
              </span>
              <span className="xn-arrow">&gt;</span>
              <span>
                <MiniGlyph kind="lot" /> {p.blocks} BLOCKS
              </span>
            </div>
            <div className="tiny">{ROUTE_TEXT[p.route]}</div>
            {p.route !== 'none' && (
              <div className="xn-dates tiny">
                <span className={late(p.plateBy)}>TRANSFER PLATES BY {p.plateBy}{p.plateAssumed ? ' (LEAD ASSUMED)' : ''}</span>
                {p.g1By && <span className={late(p.g1By)}>INOCULATE G1 BY {p.g1By}</span>}
                <span className={late(p.g2By)}>
                  KNOCK G2 BY {p.g2By} ({p.g2Days} D{p.g2Assumed ? ', NO FIGURE: ASSUMED' : ''}
                  {G2_SRC(r.key)})
                </span>
                <span>KNOCK BLOCKS {p.knock}</span>
              </div>
            )}
            {r.strain && p.route !== 'none' && (
              <div className="xn-have tiny">
                <span className={r.stock.plates < p.plates ? 'warn' : ''}>PLATES {r.stock.plates}/{p.plates}</span>
                {p.route !== 'direct' && <span className={r.stock.g1 < p.g1 ? 'warn' : ''}>G1 {r.stock.g1}/{p.g1}</span>}
                <span className={r.stock.g2 < p.g2 ? 'warn' : ''}>G2 {r.stock.g2}/{p.g2}</span>
              </div>
            )}
            <div className={`xn-next ${r.sf.level === 'short' ? 'warn' : ''}`}>
              {r.sf.level === 'short' ? 'SHORTFALL: ' : 'NEXT: '}
              {r.sf.next}
              {r.strain && (
                <button type="button" className="btn" onClick={() => set({ tab: 'LINEAGE', strain: r.strain!.id, node: null })}>
                  OPEN {r.strain.code}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function G2_SRC(key: string): ReactNode {
  const src = { 'blue-oyster': 'F05-0156', 'golden-oyster': 'F05-0156', 'phoenix-oyster': 'F05-0156', 'pink-oyster': 'F05-0156', 'black-pearl': 'F05-0157', 'lions-mane': 'F05-0159', 'comb-tooth': 'F05-0160', chestnut: 'F05-0161', shiitake: 'F05-0162', pioppino: 'F05-0163', maitake: 'F05-0164' }[key]
  return src ? (
    <>
      , <RefText text={src} />
    </>
  ) : null
}

// ---------- LABELS ----------

function QrSvg({ text }: { text: string }) {
  const path = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let dd = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) dd += `M${c + 2} ${r + 2}h1v1h-1z`
    return { dd, n: n + 4 }
  }, [text])
  return (
    <svg className="qr" viewBox={`0 0 ${path.n} ${path.n}`} shapeRendering="crispEdges" aria-label="QR code">
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.dd} fill="#000" />
    </svg>
  )
}

interface LabelData {
  key: string
  code: string
  line1: string
  line2: string
  url: string
}

function labelsFor(d: XData, strainId: string | null): LabelData[] {
  const byId = new Map(d.strains.map((s) => [s.id, s]))
  const out: LabelData[] = []
  for (const c of d.cultures) {
    const s = byId.get(c.strain_id)
    if (!s || (strainId && s.id !== strainId) || !isActiveCulture(c)) continue
    out.push({ key: `c:${c.id}`, code: c.label ?? s.code, line1: `${spName(s.species_key)} // ${pLabel(c.p_level)} ${KIND_LABEL[c.kind]}`, line2: `MADE ${c.made_on}${c.location ? ` // ${c.location}` : ''}`, url: recordUrl(`c:${c.id}`, location) })
  }
  for (const g of d.runs) {
    const s = byId.get(g.strain_id)
    if (!s || (strainId && s.id !== strainId) || grainRemaining(g, d.runs, d.lots) <= 0) continue
    out.push({ key: `g:${g.id}`, code: g.label ?? s.code, line1: `${spName(s.species_key)} // ${g.generation} x${g.bag_count}`, line2: `INOC ${g.inoculated_on}${g.location ? ` // ${g.location}` : ''}`, url: recordUrl(`g:${g.id}`, location) })
  }
  return out
}

function Label({ l }: { l: LabelData }) {
  return (
    <div className="xl-label">
      <QrSvg text={l.url} />
      <div className="xl-text">
        <div className="xl-code">{l.code}</div>
        <div>{l.line1}</div>
        <div>{l.line2}</div>
        <div className="xl-brand">MY/CO/L // NEGRA BAY</div>
      </div>
    </div>
  )
}

function LabelsTab({ d, x, picked, setPicked }: { d: XData; x: XenoState; picked: Set<string>; setPicked: (s: Set<string>) => void }) {
  const all = labelsFor(d, x.strain)
  const chosen = all.filter((l) => picked.has(l.key))
  const [printing, setPrinting] = useState(false)
  const toggle = (k: string) => {
    const n = new Set(picked)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    setPicked(n)
  }
  useEffect(() => {
    if (!printing) return
    const t = window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 80)
    return () => window.clearTimeout(t)
  }, [printing])
  return (
    <div className="xn-sec">
      <div className="xn-plan-top">
        <span className="tiny">{x.strain ? `${d.strains.find((s) => s.id === x.strain)?.code} ONLY` : 'ALL STRAINS'} // {all.length} ON THE SHELF // {chosen.length} PICKED</span>
        <button type="button" className="btn" onClick={() => setPicked(new Set(all.map((l) => l.key)))}>PICK ALL</button>
        <button type="button" className="btn" onClick={() => setPicked(new Set())}>CLEAR</button>
        <button type="button" className="btn" disabled={!chosen.length} onClick={() => setPrinting(true)}>PRINT {chosen.length || ''}</button>
      </div>
      <div className="dim tiny">
        EACH LABEL IS ABOUT 64 X 32 MM, 3 ACROSS ON A4 OR LETTER. THE CODE OPENS THAT RECORD IN MY/CO/L. UNTIL THE DATABASE IS LINKED, ONLY THE DEVICE THAT MADE THE RECORD CAN OPEN IT.
      </div>
      <div className="xl-pick">
        {all.map((l) => (
          <button key={l.key} type="button" className={`xl-pick-row ${picked.has(l.key) ? 'sel' : ''}`} onClick={() => toggle(l.key)}>
            <span className="xl-box">{picked.has(l.key) ? 'X' : ' '}</span>
            <span>{l.code}</span>
            <span className="dim">{l.line1}</span>
          </button>
        ))}
        {!all.length && <div className="dim">NOTHING ON THE SHELF TO LABEL.</div>}
      </div>
      {chosen.length > 0 && (
        <div className="xl-preview">
          {chosen.slice(0, 6).map((l) => (
            <Label key={l.key} l={l} />
          ))}
          {chosen.length > 6 && <div className="dim tiny">+ {chosen.length - 6} MORE ON THE SHEET</div>}
        </div>
      )}
      {printing &&
        createPortal(
          <div className="xeno-print">
            {chosen.map((l) => (
              <Label key={l.key} l={l} />
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ---------- screen ----------

export function Xeno({ x, set, say, onOpenSpecies }: { x: XenoState; set: SetXeno; say: Say; onOpenSpecies: (key: string) => void }) {
  const { sound } = useApp()
  const d = useXenoData()
  const status = useStoreStatus()
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // A scanned label arrives as a record key with no strain: find its strain once the tables load.
  useEffect(() => {
    if (!x.node || x.strain) return
    const [t, id] = [x.node[0], x.node.slice(2)]
    const sid = t === 'c' ? d.cultures.find((c) => c.id === id)?.strain_id : t === 'g' ? d.runs.find((g) => g.id === id)?.strain_id : d.lots.find((l) => l.id === id)?.strain_id
    if (sid) set({ strain: sid })
  }, [x.node, x.strain, d.cultures, d.runs, d.lots, set])

  const onLabel = (k: string) => {
    setPicked(new Set([...picked, k]))
    set({ tab: 'LABELS' })
  }

  const sel = d.strains.find((s) => s.id === x.strain)
  return (
    <div className="xeno">
      <div className="xn-head">
        <div className="section-title">GENETICS LAB // CULTURE CONTAINMENT</div>
        <div className="spec-name">{sel ? `${sel.code} ${sel.name ? `// ${sel.name.toUpperCase()}` : ''}` : 'ALL STRAINS'}</div>
        <div className="dim tiny">
          {sel ? `${spName(sel.species_key)} // ${sel.source ?? 'SOURCE NOT SET'}` : `${d.strains.length} STRAIN${d.strains.length === 1 ? "" : "S"} // ${d.cultures.filter(isActiveCulture).length} LIVE CULTURES // ${d.runs.filter((g) => grainRemaining(g, d.runs, d.lots) > 0).length} GRAIN RUNS`}
          {status.kind !== 'remote' ? ' // LOCAL MODE: SAVED IN THIS BROWSER' : ''}
        </div>
        {x.node && !x.strain && d.strains.length > 0 && <div className="warn tiny">THAT LABEL'S RECORD IS NOT ON THIS DEVICE.</div>}
      </div>
      <nav className="spec-tabs" role="tablist">
        {XENO_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === x.tab} className={t === x.tab ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            {t}
          </button>
        ))}
      </nav>
      {x.tab === 'STRAINS' && <StrainsTab d={d} x={x} set={set} say={say} onOpenSpecies={onOpenSpecies} />}
      {x.tab === 'STOCK' && <StockTab d={d} x={x} set={set} say={say} />}
      {x.tab === 'LINEAGE' && <LineageTab d={d} x={x} set={set} say={say} onLabel={onLabel} />}
      {x.tab === 'PLANNER' && <PlannerTab d={d} set={set} />}
      {x.tab === 'LABELS' && <LabelsTab d={d} x={x} picked={picked} setPicked={setPicked} />}
    </div>
  )
}

export function XenoIndex({ x, set }: { x: XenoState; set: SetXeno }) {
  const { sound } = useApp()
  const d = useXenoData()
  const warns = warnings(d)
  const warnBy = new Set(warns.map((w) => w.strain.id))
  return (
    <>
      <div className="section-title">STRAINS</div>
      <ul className="index-list">
        <li tabIndex={0} className={!x.strain ? 'sel' : ''} onClick={() => (sound.chirp(), set({ strain: null, node: null }))}>
          <span>ALL</span>
          <span className="k">{d.strains.length}</span>
        </li>
        {d.strains.map((s) => {
          const pc = pCounts(s.id, d.cultures)
          return (
            <li tabIndex={0} key={s.id} className={`${s.id === x.strain ? 'sel' : ''} ${s.active ? '' : 'dim'}`} onClick={() => (sound.chirp(), set({ strain: s.id, node: null }))}>
              <span>
                {s.code} {warnBy.has(s.id) ? <span className="warn">!</span> : ''}
              </span>
              <span className="k">{pc.p.reduce((a, b) => a + b, 0) + pc.master}</span>
            </li>
          )
        })}
      </ul>
      {warns.length > 0 && (
        <div className="warn tiny" style={{ marginTop: 8 }}>
          {warns.length} AGE WARNING{warns.length > 1 ? 'S' : ''}: SEE STOCK
        </div>
      )}
    </>
  )
}
