import type { Species } from '../data/species/types'
import { CORE, SLOT_BAGS, rotationById } from '../data/cropplan'

export interface Allot {
  sp: Species
  bags: number
  pct: number
  weight: number
  assumed: boolean // true when the species has no share in the crop plan
}

/** Plan weight of a species: its core bags, or its share of the secondary slot (src/data/cropplan.ts). */
function planWeight(id: string): { w: number; slot: boolean } | null {
  const c = CORE.find((x) => x.key === id)
  if (c) return { w: c.bags, slot: false }
  return rotationById().cycle.includes(id) ? { w: SLOT_BAGS, slot: true } : null
}

/** Weight of each species when splitting a run: core bags from the crop plan; slot species chosen together share one 16-bag slot. */
export function weights(chosen: Species[]): { sp: Species; w: number; assumed: boolean }[] {
  const pw = chosen.map((s) => planWeight(s.id))
  const slotCount = pw.filter((x) => x?.slot).length
  const known = pw.filter((x): x is { w: number; slot: boolean } => !!x).map((x) => (x.slot ? x.w / slotCount : x.w))
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1
  return chosen.map((sp, i) => {
    const x = pw[i]
    if (!x) return { sp, w: fallback, assumed: true }
    return { sp, w: x.slot ? x.w / slotCount : x.w, assumed: false }
  })
}

/** Split `bags` across the chosen species by weight, whole bags, largest remainder. */
export function allot(bags: number, chosen: Species[]): Allot[] {
  const n = Math.max(0, Math.floor(bags))
  if (!chosen.length || n === 0) return chosen.map((sp) => ({ sp, bags: 0, pct: 0, weight: 0, assumed: false }))
  const ws = weights(chosen)
  const sum = ws.reduce((a, b) => a + b.w, 0)
  const raw = ws.map((x) => (x.w / sum) * n)
  const out = raw.map((r) => Math.floor(r))
  let rest = n - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  for (const [, i] of order) {
    if (rest <= 0) break
    out[i]++
    rest--
  }
  return ws.map((x, i) => ({ sp: x.sp, bags: out[i], pct: (out[i] / n) * 100, weight: x.w, assumed: x.assumed }))
}

export const LB_TO_KG = 0.45359237
