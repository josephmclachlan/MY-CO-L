import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { HazardGlyph } from '../components/HazardGlyph'
import { TypedRows, type Row } from '../components/TypedRows'
import { HAZARDS, hazardById } from '../data/hazards'
import type { Colour, Hazard as H, Kind, Place, Smell, Stage, Texture } from '../data/hazards/types'
import type { Fact } from '../data/species/types'
import { SPECIES, srcLabel } from '../data/species'
import {
  COLOURS,
  COLOUR_LABEL,
  KIND_LABEL,
  KIND_NOTE,
  KIND_ORDER,
  PATTERNS,
  PLACES,
  PLACE_LABEL,
  SMELLS,
  SMELL_LABEL,
  STAGES,
  STAGE_LABEL,
  TEXTURES,
  TEXTURE_LABEL,
  diagnose,
  hazardName,
  lossCounts,
  noClues,
  type Clues,
  type HazardLog,
  type LotLoss,
} from '../lib/hazard'
import { useTable } from '../store/StoreContext'
import { ContamLive } from './XenoBank'
import type { BlockLot } from '../lib/xeno'

export const HAZARD_TABS = ['SPOT', 'LOOK-ALIKES', 'CAUSE', 'TREAT', 'PREVENT', 'SPECIES', 'LOSSES', 'SOURCES'] as const
export type HazardTab = (typeof HAZARD_TABS)[number]

export interface HazardState {
  mode: 'file' | 'diagnose'
  id: string | null
  tab: HazardTab
  kind: Kind | 'all'
  stage: Stage | 'all'
  clues: Clues
}
export const HAZARD_START: HazardState = { mode: 'file', id: null, tab: 'SPOT', kind: 'all', stage: 'all', clues: {} }
type SetHazard = (p: Partial<HazardState>) => void

const NO_DATA = 'NO DATA IN SOURCES'
/** Shown if a fact has no sentence (none do today); fact IDs and tags still apply. */
const LOCKED = 'NO TEXTBOOK SENTENCE ON FILE FOR THIS YET. THE SOURCE IDS BELOW STILL APPLY.'
const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches
const join = <T extends string>(xs: T[], label: Record<T, string>) => (xs.length ? xs.map((x) => label[x]).join(', ') : NO_DATA)

function useLosses() {
  const logs = useTable<HazardLog>('hazard_logs')
  const lots = useTable<LotLoss>('lot_losses')
  const counts = useMemo(() => lossCounts(logs, lots), [logs, lots])
  return { logs, lots, counts }
}

// ---------- readouts ----------

function factRows(prefix: string, h: H, facts: Fact[], open: (id: string) => void, withVideo = false): Row[] {
  return facts.map((f, i) => {
    const target = f.hz ? hazardById(f.hz) : undefined
    return {
      id: `${prefix}${i}`,
      label: f.k?.toUpperCase(),
      value: f.v === '' ? LOCKED : f.v ?? NO_DATA,
      flag: f.f,
      link: target ? { label: `OPEN ${target.name}`, onClick: () => open(target.id) } : null,
      why: {
        s: f.s,
        w: withVideo && i === 0 ? h.w.slice(0, 5) : undefined,
        n: f.n ?? (withVideo && i === 0 && h.w.length ? 'Videos listed are the manual videos nearest this topic, not one exact quote.' : undefined),
      },
    }
  })
}

function sourceRows(h: H): Row[] {
  const ids = new Map<string, number>()
  for (const f of [...h.spot, ...h.look, ...h.cause, ...h.treat, ...h.prevent, ...h.risk]) f.s?.forEach((s) => ids.set(s, (ids.get(s) ?? 0) + 1))
  const rows: Row[] = [
    { id: 's-sum', label: 'FACTS', value: `${ids.size} textbook facts behind ${h.spot.length + h.look.length + h.cause.length + h.treat.length + h.prevent.length + h.risk.length} readouts.`, head: true },
    { id: 's-rule', label: 'RULE', value: "Growing facts come only from Joseph's own files. Cap n Stem's figure is shown first; other farms appear as CONTEXT. Gaps stay open." },
  ]
  ;[...ids.entries()].sort().forEach(([id, n]) => rows.push({ id: `s-${id}`, label: id, value: `${srcLabel(id)}. Used ${n}x.`, why: { s: [id] } }))
  h.w.forEach((w) => rows.push({ id: `v-${w}`, label: 'VIDEO', value: `${w}. Nearest video in the manual.` }))
  return rows
}

function entryRows(h: H, tab: HazardTab, ctx: { counts: Map<string, { events: number; bags: number }>; logs: HazardLog[]; lotLosses: LotLoss[]; lots: BlockLot[]; open: (id: string) => void }): Row[] {
  const { open } = ctx
  switch (tab) {
    case 'SPOT':
      return [
        { id: 'p-name', label: 'ENTRY', value: h.name, head: true },
        { id: 'p-kind', label: 'KIND', value: h.kind === 'notcontam' ? 'NOT CONTAMINATION. LOOKS WRONG BUT IS NOT.' : KIND_LABEL[h.kind] },
        { id: 'p-stage', label: 'HITS', value: join(h.stages, STAGE_LABEL) },
        { id: 'p-clues', label: 'CLUES', value: `Colour: ${join(h.colours, COLOUR_LABEL)}. Smell: ${join(h.smells, SMELL_LABEL)}. Feel: ${join(h.textures, TEXTURE_LABEL)}. Where: ${join(h.places, PLACE_LABEL)}.`, why: { n: 'Tags drawn from the descriptions in the cited facts. They feed the DIAGNOSE helper.' } },
        ...factRows('p', h, h.spot, open, true),
      ]
    case 'LOOK-ALIKES':
      return factRows('l', h, h.look, open)
    case 'CAUSE':
      return factRows('c', h, h.cause, open, true)
    case 'TREAT':
      return factRows('t', h, h.treat, open)
    case 'PREVENT':
      return factRows('v', h, h.prevent, open)
    case 'SPECIES':
      return [
        { id: 'r-lead', label: 'AT RISK', value: h.species.length ? h.species.map((k) => SPECIES.find((s) => s.id === k)?.name ?? k).join(', ') : 'NO SPECIES NAMED IN THE SOURCES', head: true },
        ...factRows('r', h, h.risk, open),
      ]
    case 'LOSSES': {
      const c = ctx.counts.get(h.id)
      const rows: Row[] = [
        { id: 'x-sum', label: 'LOGGED', value: c ? `${c.events} loss${c.events === 1 ? '' : 'es'} logged, ${c.bags} bag${c.bags === 1 ? '' : 's'} or block${c.bags === 1 ? '' : 's'} in all.` : 'Nothing logged against this entry yet.', head: true },
      ]
      const lotCode = (id: string) => ctx.lots.find((l) => l.id === id)?.lot_code ?? 'LOT'
      const all = [
        ...ctx.logs.filter((l) => l.hazard_key === h.id).map((l) => ({ id: l.id, d: l.noted_on, t: `${l.source_kind === 'culture' ? 'CULTURE' : 'GRAIN RUN'} // ${l.bag_count} lost`, n: l.notes })),
        ...ctx.lotLosses.filter((l) => l.hazard_key === h.id).map((l) => ({ id: l.id, d: l.noted_on, t: `LOT ${lotCode(l.block_lot_id)} // ${l.bag_count} blocks lost`, n: l.cause })),
      ].sort((a, b) => b.d.localeCompare(a.d))
      all.slice(0, 12).forEach((l) => rows.push({ id: `x-${l.id}`, label: l.d, value: `${l.t}${l.n ? ` // ${l.n}` : ''}` }))
      rows.push({ id: 'x-how', value: 'Log a loss in XENOGENETICS: CONTAMINATED on a culture, LOG LOSS on a grain run or block lot. Each asks what it was.' })
      return rows
    }
    case 'SOURCES':
      return sourceRows(h)
  }
}

// ---------- main screen ----------

export function Hazard({ x, set, onOpenSpecies, onGoLog }: { x: HazardState; set: SetHazard; onOpenSpecies: (id: string) => void; onGoLog: () => void }) {
  const { sound } = useApp()
  const { logs, lots: lotLosses, counts } = useLosses()
  const lots = useTable<BlockLot>('block_lots')
  const h = hazardById(x.id)
  const [skip, setSkip] = useState(false)
  const [done, setDone] = useState(false)
  const open = (id: string) => set({ mode: 'file', id, tab: 'SPOT' })
  const rows = useMemo(
    () => (h ? entryRows(h, x.tab, { counts, logs, lotLosses, lots, open }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h?.id, x.tab, counts, logs, lotLosses, lots],
  )

  useEffect(() => {
    setSkip(false)
    setDone(false)
  }, [h?.id, x.tab])

  useEffect(() => {
    if (!h) return
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.value) return
      const i = HAZARD_TABS.indexOf(x.tab)
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        set({ tab: HAZARD_TABS[(i + 1) % HAZARD_TABS.length] })
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        set({ tab: HAZARD_TABS[(i + HAZARD_TABS.length - 1) % HAZARD_TABS.length] })
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [h, x.tab, set])

  if (x.mode === 'diagnose') return <Diagnose x={x} set={set} counts={counts} />
  if (!h) return <Overview set={set} counts={counts} />

  return (
    <div className="spec hz">
      <div className="spec-head hz-head">
        <div className="section-title">HAZARD FILE // {KIND_LABEL[h.kind]}</div>
        <HazardGlyph kind={h.kind} size={34} className="hz-big" />
        <div>
          <div className="spec-name">{h.name}</div>
          {h.aka && <div className="dim spec-latin">{h.aka}</div>}
        </div>
      </div>
      <nav className="spec-tabs" role="tablist">
        {HAZARD_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === x.tab} className={t === x.tab ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: t }))}>
            {t}
          </button>
        ))}
      </nav>
      <div className="spec-data" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setSkip(true) }}>
        <TypedRows rows={rows} instant={skip} onDone={() => setDone(true)} />
        {(done || skip) && x.tab === 'SPECIES' && h.species.length > 0 && (
          <div className="hz-chips">
            {h.species.map((k) => (
              <button key={k} type="button" className="btn" onClick={() => onOpenSpecies(k)} title="Open in SPECIMEN FILES">
                {SPECIES.find((s) => s.id === k)?.name ?? k}
              </button>
            ))}
          </div>
        )}
        {(done || skip) && x.tab === 'LOSSES' && (
          <div className="hz-chips">
            <button type="button" className="btn" onClick={onGoLog}>OPEN XENOGENETICS TO LOG A LOSS</button>
          </div>
        )}
        {!done && !skip && <div className="dim tiny spec-skip">TAP TO SKIP TYPING</div>}
      </div>
    </div>
  )
}

function Overview({ set, counts }: { set: SetHazard; counts: Map<string, { events: number; bags: number }> }) {
  const { sound } = useApp()
  const total = [...counts.values()].reduce((a, c) => ({ events: a.events + c.events, bags: a.bags + c.bags }), { events: 0, bags: 0 })
  const top = [...counts.entries()].sort((a, b) => b[1].bags - a[1].bags).slice(0, 5)
  return (
    <div className="hz">
      <div className="section-title">HAZARD INDEX</div>
      <p>
        {HAZARDS.filter((h) => h.kind !== 'notcontam').length} contaminants, pests, diseases and faults, and {HAZARDS.filter((h) => h.kind === 'notcontam').length} things that only look like trouble. Every readout has a WHY? that shows its source. Pick an entry from the list, or describe what you see.
      </p>
      <div className="hz-chips">
        <button type="button" className="btn on" onClick={() => (sound.chirp(), set({ mode: 'diagnose' }))}>DIAGNOSE: DESCRIBE WHAT YOU SEE</button>
      </div>
      <div className="hz-kinds">
        {KIND_ORDER.map((k) => {
          const n = HAZARDS.filter((h) => h.kind === k).length
          return (
            <button key={k} type="button" className="hz-kind" onClick={() => (sound.chirp(), set({ kind: k, id: HAZARDS.find((h) => h.kind === k)?.id ?? null, tab: 'SPOT' }))}>
              <HazardGlyph kind={k} size={26} />
              <span>{KIND_LABEL[k]}</span>
              <span className="k">{n}</span>
            </button>
          )
        })}
      </div>
      <div className="section-title" style={{ marginTop: 12 }}>LOGGED LOSSES</div>
      {top.length === 0 ? (
        <div className="dim">NOTHING LOGGED YET. LOSSES LOGGED IN XENOGENETICS SHOW HERE AND ON EACH ENTRY.</div>
      ) : (
        <>
          <div className="dim tiny">{total.events} LOSSES // {total.bags} BAGS AND BLOCKS IN ALL</div>
          <ul className="index-list hz-top">
            {top.map(([key, c]) => (
              <li tabIndex={0} key={key} onClick={() => (sound.chirp(), set({ id: key, tab: 'LOSSES' }))}>
                <span>{hazardName(key)}</span>
                <span className="k">{c.bags}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ContamLive />
    </div>
  )
}

// ---------- diagnose ----------

function Chips<T extends string>({ title, list, label, value, on }: { title: string; list: T[]; label: Record<T, string>; value?: T; on: (v: T | undefined) => void }) {
  const { sound } = useApp()
  return (
    <div className="hz-group">
      <div className="hz-gt">{title}</div>
      <div className="hz-chipset">
        <button type="button" className={`hz-chip ${!value ? 'sel' : ''}`} onClick={() => (sound.chirp(), on(undefined))}>ANY</button>
        {list.map((v) => (
          <button key={v} type="button" className={`hz-chip ${value === v ? 'sel' : ''}`} onClick={() => (sound.chirp(), on(value === v ? undefined : v))}>
            {label[v]}
          </button>
        ))}
      </div>
    </div>
  )
}

function Diagnose({ x, set, counts }: { x: HazardState; set: SetHazard; counts: Map<string, { events: number; bags: number }> }) {
  const { sound } = useApp()
  const c = x.clues
  const put = (p: Partial<Clues>) => set({ clues: { ...c, ...p } })
  const hits = useMemo(() => (noClues(c) ? [] : diagnose(c).slice(0, 10)), [c])
  const patterns: Row[] = PATTERNS.map((p, i) => {
    const t = p.hz ? hazardById(p.hz) : undefined
    return { id: `pt${i}`, label: 'IF', value: p.see ? `${p.see}  =>  ${p.source}.` : LOCKED, why: { s: p.s }, link: t ? { label: `OPEN ${t.name}`, onClick: () => set({ mode: 'file', id: t.id, tab: 'SPOT' }) } : null }
  })
  return (
    <div className="hz">
      <div className="section-title">DIAGNOSE</div>
      <div className="dim tiny">PICK WHAT YOU CAN SEE. LEAVE THE REST ON ANY. STAGE NARROWS THE LIST; THE OTHER CLUES RANK IT.</div>
      <div className="hz-diag">
      <div>
      <Chips title="STAGE" list={STAGES} label={STAGE_LABEL} value={c.stage} on={(v) => put({ stage: v as Stage | undefined })} />
      <Chips title="COLOUR" list={COLOURS} label={COLOUR_LABEL} value={c.colour} on={(v) => put({ colour: v as Colour | undefined })} />
      <Chips title="SMELL" list={SMELLS} label={SMELL_LABEL} value={c.smell} on={(v) => put({ smell: v as Smell | undefined })} />
      <Chips title="TEXTURE" list={TEXTURES} label={TEXTURE_LABEL} value={c.texture} on={(v) => put({ texture: v as Texture | undefined })} />
      <Chips title="WHERE" list={PLACES} label={PLACE_LABEL} value={c.place} on={(v) => put({ place: v as Place | undefined })} />
      <div className="hz-chips">
        {!noClues(c) && <button type="button" className="btn" onClick={() => (sound.chirp(), set({ clues: {} }))}>CLEAR CLUES</button>}
        <button type="button" className="btn" onClick={() => (sound.chirp(), set({ mode: 'file' }))}>BACK TO THE INDEX</button>
      </div>
      </div>
      <div>
      <div className="section-title">LIKELY MATCHES</div>
      {noClues(c) ? (
        <div className="dim">PICK AT LEAST ONE CLUE.</div>
      ) : hits.length === 0 ? (
        <div className="warn">NOTHING IN THE SOURCES MATCHES THAT. TRY FEWER CLUES, OR CHECK THE PATTERN TABLE BELOW.</div>
      ) : (
        <ul className="hz-hits">
          {hits.map((m) => {
            const lc = counts.get(m.h.id)
            return (
              <li key={m.h.id}>
                <button type="button" className={`hz-hit ${m.h.kind === 'notcontam' ? 'norm' : ''}`} onClick={() => (sound.chirp(), set({ mode: 'file', id: m.h.id, tab: 'SPOT' }))}>
                  <HazardGlyph kind={m.h.kind} size={24} />
                  <span className="hz-hit-n">
                    {m.h.name}
                    {m.h.kind === 'notcontam' && <span className="tag"> MAY BE NORMAL</span>}
                  </span>
                  <span className="hz-hit-m">{m.hits.length ? `MATCHES: ${m.hits.join(', ')}` : `STAGE: ${c.stage ? STAGE_LABEL[c.stage] : ''}`}{m.misses.length ? ` // NOT: ${m.misses.join(', ')}` : ''}{lc ? ` // ${lc.bags} LOGGED` : ''}</span>
                  {m.h.spot[0]?.v && <span className="hz-hit-s dim">{m.h.spot[0].v}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      </div>
      </div>
      <div className="section-title" style={{ marginTop: 14 }}>READ THE PATTERN FIRST</div>
      <div className="dim tiny">WHERE THE FAILURES SIT ACROSS BAGS, LOTS AND DAYS NAMES THE SOURCE. CHANGE ONE THING AT A TIME; PULL THE COOK LOGGER RECORD BEFORE ANYTHING ELSE.</div>
      <TypedRows rows={patterns} instant />
    </div>
  )
}

// ---------- left index ----------

export function HazardIndex({ x, set }: { x: HazardState; set: SetHazard }) {
  const { sound } = useApp()
  const { counts } = useLosses()
  const list = HAZARDS.filter((h) => (x.kind === 'all' || h.kind === x.kind) && (x.stage === 'all' || h.stages.includes(x.stage)))
  const kinds = KIND_ORDER.filter((k) => list.some((h) => h.kind === k))
  const note = x.kind !== 'all' && list.length === 0 ? KIND_NOTE[x.kind] ?? 'NO ENTRY MATCHES THESE FILTERS.' : x.kind !== 'all' ? KIND_NOTE[x.kind] : undefined
  return (
    <>
      <button type="button" className={`btn ${x.mode === 'diagnose' ? 'on' : ''}`} style={{ width: '100%' }} onClick={() => (sound.chirp(), set({ mode: 'diagnose' }))}>
        DIAGNOSE
      </button>
      <details className="hz-filters" open={!narrow()}>
      <summary>FILTERS{x.kind !== 'all' || x.stage !== 'all' ? ' (ON)' : ''}</summary>
      <div className="section-title" style={{ marginTop: 8 }}>KIND</div>
      <div className="hz-chipset">
        <button type="button" className={`hz-chip ${x.kind === 'all' ? 'sel' : ''}`} onClick={() => (sound.chirp(), set({ kind: 'all' }))}>ALL</button>
        {KIND_ORDER.map((k) => (
          <button key={k} type="button" className={`hz-chip ${x.kind === k ? 'sel' : ''}`} onClick={() => (sound.chirp(), set({ kind: x.kind === k ? 'all' : k }))} title={KIND_LABEL[k]}>
            <HazardGlyph kind={k} size={14} /> {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="section-title" style={{ marginTop: 8 }}>STAGE</div>
      <div className="hz-chipset">
        <button type="button" className={`hz-chip ${x.stage === 'all' ? 'sel' : ''}`} onClick={() => (sound.chirp(), set({ stage: 'all' }))}>ALL</button>
        {STAGES.map((s) => (
          <button key={s} type="button" className={`hz-chip ${x.stage === s ? 'sel' : ''}`} onClick={() => (sound.chirp(), set({ stage: x.stage === s ? 'all' : s }))}>
            {STAGE_LABEL[s]}
          </button>
        ))}
      </div>
      </details>
      {note && <div className="dim tiny" style={{ marginTop: 6 }}>{note}</div>}
      {list.length === 0 && !note && <div className="warn tiny" style={{ marginTop: 6 }}>NO ENTRY MATCHES BOTH FILTERS.</div>}
      {kinds.map((k) => (
        <div key={k}>
          <div className="section-title" style={{ marginTop: 8 }}>{KIND_LABEL[k]}</div>
          <ul className="index-list">
            {list.filter((h) => h.kind === k).map((h) => {
              const c = counts.get(h.id)
              return (
                <li tabIndex={0} key={h.id} data-tip="Open this entry: how to spot it, cause, treatment and prevention." className={x.mode === 'file' && h.id === x.id ? 'sel' : ''} onClick={() => (sound.chirp(), set({ mode: 'file', id: h.id, tab: x.id === h.id ? x.tab : 'SPOT' }))}>
                  <span className="hz-li">
                    <HazardGlyph kind={h.kind} size={14} /> {h.name}
                  </span>
                  <span className="k">{c ? c.bags : ''}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )
}
