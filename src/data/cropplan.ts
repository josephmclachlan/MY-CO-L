// The weekly crop plan: a fixed core plus one secondary slot that rotates week to week.
// Joseph (5 Nov 2026): 130 bags a week; one rule for the secondary slot used by every screen.
// Core and slot sizes are the farm notes' 130-bag split (52 blue, 46 lion's mane, 16 comb tooth,
// 16 golden on A weeks / phoenix on B weeks). Rotation presets come from the Catawba review
// (thread "Review the app against all farm knowledge", 5 Nov 2026).
//
// The chosen rotation is saved per device (localStorage), like the other screen preferences.

import { useSyncExternalStore } from 'react'

export const WEEKLY_BAGS = 130
export const CORE: { key: string; bags: number }[] = [
  { key: 'blue-oyster', bags: 52 },
  { key: 'lions-mane', bags: 46 },
  { key: 'comb-tooth', bags: 16 },
]
export const SLOT_BAGS = WEEKLY_BAGS - CORE.reduce((n, c) => n + c.bags, 0) // 16

/** Joseph picks the secondary species himself (5 Nov 2026: "I should be able to choose, not have it prescribed").
 *  `slot` fills every week; `weeks` overrides single weeks, keyed by week index (see weekIndex). */
export interface CropPlan {
  slot: string
  weeks: Record<string, string>
}
export const DEFAULT_SLOT = 'golden-oyster'

// ---------- the saved choice ----------

const KEY = 'mycol.crop.v2'
const listeners = new Set<() => void>()
let current: CropPlan = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CropPlan> | null
    return { slot: typeof v?.slot === 'string' ? v.slot : DEFAULT_SLOT, weeks: v?.weeks && typeof v.weeks === 'object' ? { ...v.weeks } : {} }
  } catch {
    return { slot: DEFAULT_SLOT, weeks: {} }
  }
})()

const save = (p: CropPlan) => {
  current = p
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* private mode: keep it for this session only */
  }
  listeners.forEach((l) => l())
}
export const getPlan = () => current
/** The species that fills the secondary slot every week. Clears single-week choices that now match it. */
export function setSlot(key: string) {
  const weeks = Object.fromEntries(Object.entries(current.weeks).filter(([, v]) => v !== key))
  save({ slot: key, weeks })
}
/** A different species for one week only; null (or the usual species) clears it. */
export function setWeek(iso: string, key: string | null) {
  const weeks = { ...current.weeks }
  const w = String(weekIndex(iso))
  if (!key || key === current.slot) delete weeks[w]
  else weeks[w] = key
  save({ ...current, weeks })
}
export function usePlan(): CropPlan {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => current,
  )
}

// ---------- weeks ----------

const ANCHOR = Date.UTC(2024, 0, 1) // a Monday

/** Whole weeks since the anchor Monday for an ISO date (YYYY-MM-DD). */
export function weekIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.floor((Date.UTC(y, m - 1, d) - ANCHOR) / (7 * 86400000))
}

/** The species in the secondary slot for the week holding this date. */
export function slotSpecies(iso: string, plan: CropPlan = current): string {
  return plan.weeks[String(weekIndex(iso))] ?? plan.slot
}

/** Whole bags per species for the week holding this date. */
export function weekSplit(iso: string, plan: CropPlan = current): { key: string; bags: number }[] {
  return [...CORE, { key: slotSpecies(iso, plan), bags: SLOT_BAGS }]
}

/** A typical week, for monthly averages: the core plus the usual slot species. */
export function averageSplit(plan: CropPlan = current): { key: string; bags: number }[] {
  return [...CORE, { key: plan.slot, bags: SLOT_BAGS }]
}

const thisWeek = () => weekIndex(new Date().toISOString().slice(0, 10))
/** Single weeks from this week on that use this species. */
export function upcomingWeeks(key: string, plan: CropPlan = current): number {
  const now = thisWeek()
  return Object.entries(plan.weeks).filter(([w, v]) => v === key && Number(w) >= now).length
}

/** True when the species is the slot species or set for an upcoming week. */
export const inSlot = (key: string, plan: CropPlan = current) => plan.slot === key || upcomingWeeks(key, plan) > 0

/** Bags in a week the species runs, or null if it is not in the plan. */
export function planBagsFor(key: string, plan: CropPlan = current): number | null {
  const c = CORE.find((x) => x.key === key)
  if (c) return c.bags
  return inSlot(key, plan) ? SLOT_BAGS : null
}

/** How often it runs, in words, or null. */
export function frequencyText(key: string, plan: CropPlan = current): string | null {
  if (CORE.some((x) => x.key === key)) return 'EVERY WEEK'
  if (plan.slot === key) return 'EVERY WEEK IN THE SECONDARY SLOT, UNLESS A WEEK IS SET TO ANOTHER SPECIES'
  const n = upcomingWeeks(key, plan)
  return n ? `${n} UPCOMING WEEK${n > 1 ? 'S' : ''} IN THE SECONDARY SLOT` : null
}
