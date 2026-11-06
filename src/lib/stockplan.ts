// What one bag run uses up, worked out from Joseph's own sources.
// Every number below names the textbook fact it came from. The result feeds
// CARGO's "weeks left" and the COMMIT RUN button in PRODUCTION SEQUENCE.

import { LB_TO_KG } from './runplan'

export const PLAN = {
  /** Dry matter in one 10 lb block: 4 lb (F07-0096). A figure of about 3.3 lb is also quoted. */
  dryLbPerBag: 4,
  /** Master's Mix is 50:50 sawdust : soy hulls (F06-0001); soy never above 50% (F06-0207).
   *  Default 40% (60:40): the textbook's start for a hot, humid site (t25, F23-0095). Joseph asked for 60:40 / 55:45 / 50:50 switches, 5 Nov 2026. */
  soyShare: 0.4,
  /** House spawn rate: one 6 lb G2 bag per 20 blocks, about 0.3 lb (136 g) of spawn per block (F05-0014, F07-0001). */
  spawnLbPerBag: 0.3,
  g2Lb: 6,
  g1Lb: 4,
  /** One G1 master makes 12 G2 bags, 6 to 24 allowed (F05-0013). */
  g2PerG1: 12,
  /** If the grain's own moisture is unknown, assume about 10% (F05-0050). */
  grainIncomingMoisture: 0.1,
  /** Rye is hydrated to the upper 40s % wet basis (F05-0064). 48% is the planning figure. */
  grainHydratedMoisture: 0.48,
}

export type SubstrateForm = 'separate' | 'combo'

export interface UseLine {
  /** CARGO item code. */
  code: string
  /** Exact quantity per run, in the item's unit. */
  qty: number
  /** Quantity to book: whole numbers for counted things (bags). */
  book: number
  unit: string
  /** One line in plain words, with the source fact. */
  basis: string
}

export const round1 = (n: number) => Math.round(n * 10) / 10

export interface RunOptions {
  /** Share of the dry mix that is soy hulls. Default 0.4, capped at 0.5. */
  soyShare?: number
  form?: SubstrateForm
  /** The week's blocks by species. With it, every species gets its own master and G2 line (t09 Our farm):
   *  G2 = blocks / 20 rounded up, masters = G2 / 12 rounded up, at least one. Without it, one pooled line. */
  split?: { key: string; bags: number }[]
  /** Extra masters a week (practice setting). */
  spareMasters?: number
}

/** Whole spawn bags for the week, one master and G2 line per species (t09-our-week: 3/3/1/1 G2 + 4 masters). */
export function speciesSpawnBags(split: { key: string; bags: number }[], spareMasters = 0): { g2: number; g1: number; lines: { key: string; g2: number; g1: number }[] } {
  const lines = split
    .filter((s) => s.bags > 0)
    .map((s) => {
      const g2 = Math.ceil((s.bags * PLAN.spawnLbPerBag) / PLAN.g2Lb - 1e-9)
      return { key: s.key, g2, g1: g2 > 0 ? Math.max(1, Math.ceil(g2 / PLAN.g2PerG1)) : 0 }
    })
  return { g2: lines.reduce((n, l) => n + l.g2, 0), g1: lines.reduce((n, l) => n + l.g1, 0) + Math.max(0, Math.floor(spareMasters)), lines }
}

/** What `bags` blocks of 10 lb use: substrate, grain, grow bags and spawn bags. */
export function runLines(bags: number, opts: RunOptions = {}): UseLine[] {
  const n = Math.max(0, Math.floor(bags))
  if (n === 0) return []
  const p = PLAN
  const soy = Math.min(0.5, Math.max(0, opts.soyShare ?? p.soyShare))
  const dryKg = n * p.dryLbPerBag * LB_TO_KG
  const lines: UseLine[] = []

  if (opts.form === 'combo') {
    lines.push({
      code: 'COMBO',
      qty: dryKg,
      book: round1(dryKg),
      unit: 'kg',
      basis: `${n} bags x ${p.dryLbPerBag} lb dry per 10 lb block, as combo pellets (F07-0096, F06-0056)`,
    })
  } else {
    const mix = `${Math.round((1 - soy) * 100)}:${Math.round(soy * 100)}`
    lines.push(
      {
        code: 'SAWDUST',
        qty: dryKg * (1 - soy),
        book: round1(dryKg * (1 - soy)),
        unit: 'kg',
        basis: `${n} bags x ${p.dryLbPerBag} lb dry (F07-0096), sawdust share of a ${mix} mix${soy === 0.5 ? " (Master's Mix, F06-0001)" : ''}`,
      },
      {
        code: 'SOY-HULL',
        qty: dryKg * soy,
        book: round1(dryKg * soy),
        unit: 'kg',
        basis: `${n} bags x ${p.dryLbPerBag} lb dry (F07-0096), soy share of a ${mix} mix (never above 50%, F06-0207)`,
      },
    )
  }

  // Spawn: G2 at 0.3 lb per block, G1 masters to make the G2.
  // With a species split, whole bags per species line (t09 Our farm); otherwise one pooled line.
  const per = opts.split?.length ? speciesSpawnBags(opts.split, opts.spareMasters) : null
  const g2Bags = per ? per.g2 : (n * p.spawnLbPerBag) / p.g2Lb
  const g1Bags = per ? per.g1 : g2Bags / p.g2PerG1
  const g2Lb = g2Bags * p.g2Lb
  const hydratedLb = g2Lb + g1Bags * p.g1Lb
  const dryGrainLb = (hydratedLb * (1 - p.grainHydratedMoisture)) / (1 - p.grainIncomingMoisture)
  const grainKg = dryGrainLb * LB_TO_KG
  lines.push({
    code: 'GRAIN',
    qty: grainKg,
    book: round1(grainKg),
    unit: 'kg',
    basis: `${per ? `${per.g2} G2 bags x ${p.g2Lb} lb + ${per.g1} masters x ${p.g1Lb} lb, one master and G2 line per species (t09 Our farm)` : `${p.spawnLbPerBag} lb G2 spawn per block (F05-0014) plus the G1 masters behind it (1 per ${p.g2PerG1} G2, F05-0013)`}, dry grain at ${Math.round(p.grainIncomingMoisture * 100)}% in and ${Math.round(p.grainHydratedMoisture * 100)}% out (F05-0050, F05-0064)`,
  })
  lines.push({
    code: 'SPAWN-BAG',
    qty: g2Bags + g1Bags,
    book: Math.ceil(g2Bags) + Math.ceil(g1Bags),
    unit: 'bags',
    basis: per
      ? `${per.lines.map((l) => `${l.g2}`).join('/')} G2 bags (${p.g2Lb} lb) plus ${per.g1} masters (${p.g1Lb} lb): one line per species`
      : `${round1(g2Bags)} G2 bags (${p.g2Lb} lb) plus ${round1(g1Bags)} G1 masters (${p.g1Lb} lb), rounded up to whole bags`,
  })
  lines.push({ code: 'BAG-10', qty: n, book: n, unit: 'bags', basis: 'one 10 lb filter bag per block' })
  return lines
}

/** The same lines per week, keyed by item code. */
export function weeklyPlanUse(weeklyBags: number, opts: RunOptions = {}): Map<string, UseLine> {
  return new Map(runLines(weeklyBags, opts).map((l) => [l.code, l]))
}
