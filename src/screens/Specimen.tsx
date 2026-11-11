import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { ModelView } from '../components/ModelView'
import { TypedRows, type Row } from '../components/TypedRows'
import { FRUIT_ROOM_C, SPECIES, WEEKLY_BAGS, fruitVerdict, planBags, srcLabel } from '../data/species'
import { CORE, frequencyText, getPlan, usePlan } from '../data/cropplan'
import type { Fact, Species } from '../data/species/types'
import { LB_TO_KG } from '../lib/runplan'
import { useTable } from '../store/StoreContext'
import type { Strain } from '../lib/xeno'
import { hazardById, hazardsForSpecies } from '../data/hazards'

export const TABS = ['OVERVIEW', 'CULTIVATION', 'TIMELINE', 'CLIMATE', 'YIELD', 'HAZARDS', 'NOTES', 'SOURCES'] as const
export type Tab = (typeof TABS)[number]

const NO_DATA = 'NO DATA IN SOURCES'
/** Shown if a fact has no sentence (none do today); fact IDs still apply. */
const LOCKED = 'NO TEXTBOOK SENTENCE ON FILE FOR THIS YET. THE SOURCE IDS STILL APPLY.'

function factRows(prefix: string, facts: Fact[], openHazard?: (id: string) => void): Row[] {
  return facts.map((f, i) => {
    const target = f.hz && openHazard ? hazardById(f.hz) : undefined
    const nodata = f.f === 'nodata'
    const hasSrc = !!(f.s?.length || f.w?.length || f.n)
    return {
      id: `${prefix}${i}`,
      label: f.k?.toUpperCase(),
      value: f.v === '' ? LOCKED : f.v ?? NO_DATA,
      flag: f.f,
      link: target ? { label: 'OPEN HAZARD FILE', onClick: () => openHazard!(target.id) } : null,
      why: hasSrc || nodata ? { s: f.s, w: f.w, n: f.n ?? (nodata ? 'No figure in textbook t20, t21, t24 or t25 or the manual chapters. Nothing is filled from outside.' : undefined) } : null,
    }
  })
}

function sourceStats(sp: Species) {
  const all = [sp.overview, sp.cultivation, sp.timeline, sp.climate, sp.yield_, sp.hazards, sp.notes].flat()
  const ids = new Map<string, number>()
  const vids = new Map<string, number>()
  for (const f of all) {
    f.s?.forEach((s) => ids.set(s, (ids.get(s) ?? 0) + 1))
    f.w?.forEach((w) => vids.set(w, (vids.get(w) ?? 0) + 1))
  }
  return { ids, vids, facts: all.length, gaps: all.filter((f) => f.f === 'nodata').length, conflicts: all.filter((f) => f.f === 'conflict').length }
}

function rowsFor(sp: Species, tab: Tab, strains: Strain[] = [], openHazard?: (id: string) => void): Row[] {
  const lb = (x: number) => `${x.toFixed(2)} lb (${(x * LB_TO_KG).toFixed(2)} kg)`
  switch (tab) {
    case 'OVERVIEW': {
      const bags = planBags(sp)
      return [
        { id: 'o-name', label: 'SPECIMEN', value: sp.name, head: true },
        { id: 'o-latin', label: 'LATIN', value: sp.latin ?? NO_DATA, flag: sp.latin ? undefined : 'nodata', why: sp.latin ? null : { n: 'Not named in the textbook or manual.' } },
        {
          id: 'o-plan',
          label: 'CROP PLAN',
          value: bags ? `${bags} bags of the ${WEEKLY_BAGS}-bag run, ${frequencyText(sp.id)!.toLowerCase()}.` : 'Not in the current crop plan. Pick it for the secondary slot in PRODUCTION SEQUENCE to add it.',
          why: { s: ['FARM-PLAN'], n: `130-bag split from the farm notes: 52 blue, 46 lion's mane, 16 comb tooth, plus a 16-bag secondary slot you choose in PRODUCTION SEQUENCE.` },
        },
        ...factRows('o', sp.overview),
        { id: 'o-str', label: 'STRAINS', value: strains.length ? strains.map((s) => `${s.code}${s.name ? ` ${s.name}` : ''}${s.active ? '' : ' (retired)'}`).join(', ') : 'None registered yet. Add them in XENOGENETICS.' },
      ]
    }
    case 'CULTIVATION':
      return factRows('c', sp.cultivation)
    case 'TIMELINE':
      return factRows('t', sp.timeline)
    case 'CLIMATE': {
      const v = fruitVerdict(sp.fruitC)
      return [
        {
          id: 'cl-room',
          label: `FARM ${FRUIT_ROOM_C} °C ROOM`,
          value: v.text,
          flag: v.level === 'conflict' ? 'conflict' : v.level === 'none' ? 'nodata' : undefined,
          why: { s: ['FARM-HVAC'], n: 'Fruiting room set point from the HVAC plan: 16 °C, band 14-17, max 18, RH 80-90%, CO2 exhaust on at 900 and off at 600 ppm.' },
        },
        ...factRows('cl', sp.climate),
      ]
    }
    case 'YIELD': {
      const bags = planBags(sp)
      const extra: Row[] = []
      if (sp.cat) {
        extra.push({
          id: 'y-cat',
          label: 'KNOCK TO PICK',
          value: `${sp.cat.d} days to first harvest (${sp.cat.dr}). Catawba's own plan figure was ${sp.cat.plan.toFixed(2)} lb/block.`,
          flag: 'ctx',
          why: { s: ['CATAWBA'], n: 'Median of real picks, 2026 harvest log.' },
        })
        if (bags)
          extra.push({
            id: 'y-week',
            label: `${bags} BAGS / WEEK`,
            value: `About ${lb(bags * sp.cat.lb)} in a week it runs (${frequencyText(sp.id)!.toLowerCase()}), at Catawba's real ${sp.cat.lb.toFixed(2)} lb per block.`,
            flag: 'ctx',
            why: { s: ['CATAWBA', 'FARM-PLAN'], n: `Bags come from the 130-bag crop plan and your secondary-slot choice. Cap n Stem's own planning figure is 2 lb per block.` },
          })
      }
      return [...factRows('y', sp.yield_), ...extra]
    }
    case 'HAZARDS':
      return [...factRows('h', sp.hazards, openHazard), { id: 'h-lib', value: `FULL CONTAMINANT LIBRARY: HAZARD INDEX. ${hazardsForSpecies(sp.id).length} ENTRIES NAME ${sp.name}. THEY ARE LISTED BELOW.` }]
    case 'NOTES':
      return factRows('n', sp.notes)
    case 'SOURCES': {
      const st = sourceStats(sp)
      const rows: Row[] = [
        { id: 's-sum', label: 'FACTS', value: `${st.facts} readouts, ${st.gaps} with no data, ${st.conflicts} flagged as conflicts.`, head: true },
        { id: 's-rule', label: 'RULE', value: 'Growing facts come only from Joseph\'s own files. Cap n Stem\'s figure is shown first; other farms appear as CONTEXT. Gaps stay open.' },
      ]
      ;[...st.ids.entries()].sort().forEach(([id, n]) => rows.push({ id: `s-${id}`, label: id, value: `${srcLabel(id)}. Used ${n}x.` }))
      ;[...st.vids.entries()].sort().forEach(([v, n]) => rows.push({ id: `v-${v}`, label: 'VIDEO', value: `${v}. Used ${n}x.` }))
      return rows
    }
  }
}

function TempScale({ sp }: { sp: Species }) {
  const t = sp.fruitC
  const lo = 8
  const hi = 30
  const x = (c: number) => ((c - lo) / (hi - lo)) * 100
  return (
    <div className="tscale" aria-label="Fruiting temperature range">
      <div className="tscale-bar">
        {t?.range?.map(([a, b], i) => <i key={'r' + i} className="b-range" style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%` }} />)}
        {t?.ideal?.map(([a, b], i) => <i key={'i' + i} className="b-ideal" style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%` }} />)}
        {t?.best != null && <i className="b-best" style={{ left: `${x(t.best)}%` }} />}
        <i className="b-room" style={{ left: `${x(FRUIT_ROOM_C)}%` }} />
      </div>
      <div className="tscale-ax">
        {[10, 15, 20, 25, 30].map((c) => <span key={c} style={{ left: `${x(c)}%` }}>{c}°</span>)}
      </div>
      <div className="tscale-key tiny dim">{t ? 'DIM BAND = STATED RANGE // BRIGHT BAND = STATED IDEAL // NOTCH = FARM ROOM' : NO_DATA + ' // NOTCH = FARM ROOM'}</div>
    </div>
  )
}

function Bars({ sp }: { sp: Species }) {
  const bars = sp.timeline.filter((f) => f.d)
  if (!bars.length) return null
  const max = Math.max(...bars.map((f) => f.d![1]))
  return (
    <div className="tbars">
      {bars.map((f, i) => (
        <div key={i} className="tbar">
          <span className="tbar-k">{f.k}</span>
          <span className="tbar-track">
            <i style={{ left: 0, width: `${(f.d![0] / max) * 100}%` }} />
            {f.d![1] > f.d![0] && <i className="ext" style={{ left: `${(f.d![0] / max) * 100}%`, width: `${((f.d![1] - f.d![0]) / max) * 100}%` }} />}
          </span>
          <span className="tbar-n">{f.d![0] === f.d![1] ? `${f.d![0]}d` : `${f.d![0]}-${f.d![1]}d`}</span>
        </div>
      ))}
    </div>
  )
}

export function Specimen({ index, tab, setTab, onOpenStrain, onOpenHazard }: { index: number; tab: Tab; setTab: (t: Tab) => void; onOpenStrain?: (id: string) => void; onOpenHazard?: (id: string) => void }) {
  const { sound } = useApp()
  const sp = SPECIES[index]
  const [skip, setSkip] = useState(false)
  const [done, setDone] = useState(false)
  const allStrains = useTable<Strain>('strains')
  const strains = useMemo(() => allStrains.filter((s) => s.species_key === sp.id).sort((a, b) => a.code.localeCompare(b.code)), [allStrains, sp.id])
  const strainKey = strains.map((s) => s.id + s.code + s.name + s.active).join('|')
  const rows = useMemo(() => rowsFor(sp, tab, strains, onOpenHazard), [sp, tab, strainKey])

  useEffect(() => {
    setSkip(false)
    setDone(false)
  }, [sp.id, tab])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.value) return
      const i = TABS.indexOf(tab)
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setTab(TABS[(i + 1) % TABS.length])
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setTab(TABS[(i + TABS.length - 1) % TABS.length])
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tab, setTab])

  return (
    <div className="spec">
      <div className="spec-head">
        <div className="section-title">SPECIMEN FILE {String(sp.order).padStart(2, '0')}</div>
        <div className="spec-name">{sp.name}</div>
        <div className="dim spec-latin">{sp.latin ?? NO_DATA}</div>
      </div>
      <nav className="spec-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'sel' : ''} onClick={() => (sound.chirp(), setTab(t))}>
            {t}
          </button>
        ))}
      </nav>
      <div className="spec-body">
        <div className="spec-data" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setSkip(true) }}>
          <TypedRows rows={rows} instant={skip} onDone={() => setDone(true)} />
          {(done || skip) && tab === 'TIMELINE' && <Bars sp={sp} />}
          {tab === 'CLIMATE' && <TempScale sp={sp} />}
          {(done || skip) && tab === 'HAZARDS' && onOpenHazard && (
            <div className="spec-strains">
              <div className="section-title">ON THE HAZARD INDEX FOR {sp.name}</div>
              {hazardsForSpecies(sp.id).length === 0 && <div className="dim tiny">NO ENTRY NAMES THIS SPECIES.</div>}
              {hazardsForSpecies(sp.id).map((h) => (
                <button key={h.id} type="button" className="btn" onClick={() => onOpenHazard(h.id)} title="Open the hazard file">
                  {h.name}
                </button>
              ))}
            </div>
          )}
          {!done && !skip && <div className="dim tiny spec-skip">TAP TO SKIP TYPING</div>}
        </div>
        <div className="spec-model">
          <ModelView sp={sp} />
          <div className="spec-cap tiny dim">{sp.blurb}</div>
          {strains.length > 0 && onOpenStrain && (
            <div className="spec-strains">
              <div className="section-title">STRAINS ON FILE</div>
              {strains.map((s) => (
                <button key={s.id} type="button" className="btn" onClick={() => onOpenStrain(s.id)} title="Open in XENOGENETICS">
                  {s.code}{s.name ? ` ${s.name.toUpperCase()}` : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function SpecimenIndex({ index, onPick }: { index: number; onPick: (i: number) => void }) {
  const { sound } = useApp()
  usePlan()
  const row = (sp: Species, i: number) => {
    const b = planBags(sp)
    const part = !!b && !CORE.some((c) => c.key === sp.id) && sp.id !== getPlan().slot
    return (
      <li tabIndex={0} key={sp.id} data-tip={`Open the ${sp.name.toLowerCase()} file: how to grow it, with its climate, timeline and yield.`} className={i === index ? 'sel' : ''} onClick={() => (sound.chirp(), onPick(i))}>
        <span>{String(sp.order).padStart(2, '0')} {sp.name}</span>
        <span className="k">{b ? `${b}${part ? '*' : ''}` : ''}</span>
      </li>
    )
  }
  return (
    <>
      <div className="section-title">CROP PLAN</div>
      <ul className="index-list">{SPECIES.map((s, i) => (planBags(s) ? row(s, i) : null))}</ul>
      <div className="section-title" style={{ marginTop: 10 }}>OTHER FARM SPECIES</div>
      <ul className="index-list">{SPECIES.map((s, i) => (!planBags(s) ? row(s, i) : null))}</ul>
    </>
  )
}
