import type { Species } from '../data/species/types'

export interface Allot {
  sp: Species
  bags: number
  pct: number
  weight: number
  assumed: boolean // true when the species has no share in the crop plan
}

/** Weight of each species when splitting a run: its crop-plan share, golden and phoenix halved when both are chosen. */
export function weights(chosen: Species[]): { sp: Species; w: number; assumed: boolean }[] {
  const both = chosen.some((s) => s.id === 'golden-oyster') && chosen.some((s) => s.id === 'phoenix-oyster')
  const shares = chosen.filter((s) => (s.plan?.share ?? 0) > 0).map((s) => s.plan!.share)
  const fallback = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 1
  return chosen.map((sp) => {
    const sh = sp.plan?.share ?? 0
    const base = sh > 0 ? sh : fallback
    const w = both && (sp.id === 'golden-oyster' || sp.id === 'phoenix-oyster') && sh > 0 ? base / 2 : base
    return { sp, w, assumed: sh <= 0 }
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
