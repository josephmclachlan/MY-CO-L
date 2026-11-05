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

export interface Rotation {
  id: string
  label: string
  cycle: string[] // species keys, one per week, repeating
  why: string
}

export const ROTATIONS: Rotation[] = [
  { id: 'gp', label: 'GOLDEN / PHOENIX', cycle: ['golden-oyster', 'phoenix-oyster'], why: 'The original plan: golden on A weeks, phoenix on B weeks.' },
  { id: 'pink', label: 'PINK EVERY WEEK', cycle: ['pink-oyster'], why: 'Most fresh weight per shelf-day after blue (Catawba 1.44 lb, first pick 18 d).' },
  { id: 'pgpp', label: 'PINK / GOLDEN / PINK / PHOENIX', cycle: ['pink-oyster', 'golden-oyster', 'pink-oyster', 'phoenix-oyster'], why: 'Keeps both planned oysters; pink half the time.' },
  { id: 'spec', label: 'PINK / PIOPPINO / PINK / CHESTNUT', cycle: ['pink-oyster', 'pioppino', 'pink-oyster', 'chestnut'], why: 'Specialty variety. Chestnut stands about 65 d to first pick; pioppino wants 18-24 C.' },
]
export const DEFAULT_ROTATION = 'gp'

// ---------- the saved choice ----------

const KEY = 'mycol.crop.v1'
const listeners = new Set<() => void>()
let current: string = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')?.rotation
    return ROTATIONS.some((r) => r.id === v) ? v : DEFAULT_ROTATION
  } catch {
    return DEFAULT_ROTATION
  }
})()

export const getRotationId = () => current
export const rotationById = (id: string = current) => ROTATIONS.find((r) => r.id === id) ?? ROTATIONS[0]
export function setRotation(id: string) {
  if (!ROTATIONS.some((r) => r.id === id) || id === current) return
  current = id
  try {
    localStorage.setItem(KEY, JSON.stringify({ rotation: id }))
  } catch {
    /* private mode: keep it for this session only */
  }
  listeners.forEach((l) => l())
}
export function useRotation(): Rotation {
  const id = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
    () => current,
  )
  return rotationById(id)
}

// ---------- weeks ----------

const ANCHOR = Date.UTC(2024, 0, 1) // a Monday; week 0 of every cycle

/** Whole weeks since the anchor Monday for an ISO date (YYYY-MM-DD). */
export function weekIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.floor((Date.UTC(y, m - 1, d) - ANCHOR) / (7 * 86400000))
}

/** The species in the secondary slot for the week holding this date. */
export function slotSpecies(iso: string, rot: Rotation = rotationById()): string {
  const n = rot.cycle.length
  return rot.cycle[((weekIndex(iso) % n) + n) % n]
}

/** Position in the cycle, 1-based, e.g. "WEEK 2 OF 4". */
export function cyclePos(iso: string, rot: Rotation = rotationById()): { at: number; of: number } {
  const n = rot.cycle.length
  return { at: (((weekIndex(iso) % n) + n) % n) + 1, of: n }
}

/** Whole bags per species for the week holding this date. */
export function weekSplit(iso: string, rot: Rotation = rotationById()): { key: string; bags: number }[] {
  return [...CORE, { key: slotSpecies(iso, rot), bags: SLOT_BAGS }]
}

/** Share of weeks a species takes the slot (0 when it is never in it). */
export function slotFraction(key: string, rot: Rotation = rotationById()): number {
  return rot.cycle.filter((k) => k === key).length / rot.cycle.length
}

/** Average bags per week over a full cycle (fractional for slot species). */
export function averageSplit(rot: Rotation = rotationById()): { key: string; bags: number }[] {
  const slot = [...new Set(rot.cycle)].map((key) => ({ key, bags: SLOT_BAGS * slotFraction(key, rot) }))
  return [...CORE, ...slot]
}

/** Bags in a week the species runs (core every week, slot species only on its weeks), or null if not in the plan. */
export function planBagsFor(key: string, rot: Rotation = rotationById()): number | null {
  const c = CORE.find((x) => x.key === key)
  if (c) return c.bags
  return slotFraction(key, rot) > 0 ? SLOT_BAGS : null
}

/** "EVERY WEEK", "1 IN 2 WEEKS", "2 IN 4 WEEKS", or null. */
export function frequencyText(key: string, rot: Rotation = rotationById()): string | null {
  if (CORE.some((x) => x.key === key)) return 'EVERY WEEK'
  const k = rot.cycle.filter((x) => x === key).length
  if (!k) return null
  return k === rot.cycle.length ? 'EVERY WEEK' : `${k} IN ${rot.cycle.length} WEEKS`
}
