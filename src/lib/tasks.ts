// Hours per task (Joseph 6 Nov 2026): "No on labour [in costs], but I want to track hours per task for all tasks to
// track efficiency and man hours on tasks." Pure functions; the LEDGER > TASK HOURS screen hands in the rows.
//
// Every labour line already has a free-text task. These are the farm's standard tasks, in the order of the week
// (Monday steam, Tuesday knock, Wednesday grain, Thursday agar, Friday-Saturday sales). Old free text is matched to
// a standard task where the words fit; anything else counts as OTHER.

import type { LabourEntry, Harvest } from './ledger'
import type { BlockLot } from './xeno'
import type { Sale } from './trade'
import { isoWeek, lastWeeks } from './records'

export type TaskId =
  | 'mix' | 'steam' | 'knock' | 'grain' | 'culture' | 'incubation' | 'fruiting' | 'harvest' | 'pack' | 'deliver' | 'clean' | 'maint' | 'admin' | 'other'

/** Output a task can be measured against, so hours turn into a rate (blocks an hour, kg an hour). */
export type TaskOutput = 'blocks' | 'kg_picked' | 'kg_sold' | null

export const TASKS: { id: TaskId; label: string; words: string[]; out: TaskOutput }[] = [
  { id: 'mix', label: 'MIX + BAG', words: ['MIX', 'BAG', 'BAGGING', 'SUBSTRATE', 'HYDRAT'], out: 'blocks' },
  { id: 'steam', label: 'STEAM RUN', words: ['STEAM', 'COOK', 'PASTEUR', 'BOILER'], out: 'blocks' },
  { id: 'knock', label: 'KNOCK', words: ['KNOCK', 'INOCUL', 'SPAWN BLOCK'], out: 'blocks' },
  { id: 'grain', label: 'GRAIN + SPAWN', words: ['GRAIN', 'MILLET', 'MEGACHEF', '75X', 'G1', 'G2', 'SPAWN'], out: null },
  { id: 'culture', label: 'AGAR + CULTURES', words: ['AGAR', 'PLATE', 'CULTURE', 'SLANT', 'TRANSFER', 'LAB'], out: null },
  { id: 'incubation', label: 'INCUBATION CHECKS', words: ['INCUBAT', 'CHECK BAGS', 'MOVE'], out: null },
  { id: 'fruiting', label: 'FRUITING ROOM', words: ['FRUIT', 'MIST', 'HUMID', 'CUT', 'OPEN BAG'], out: null },
  { id: 'harvest', label: 'HARVEST', words: ['HARVEST', 'PICK'], out: 'kg_picked' },
  { id: 'pack', label: 'PACK', words: ['PACK', 'WEIGH', 'BOX', 'LABEL'], out: 'kg_sold' },
  { id: 'deliver', label: 'SELL + DELIVER', words: ['DELIVER', 'MARKET', 'SELL', 'SALE', 'DRIVE'], out: 'kg_sold' },
  { id: 'clean', label: 'CLEANING', words: ['CLEAN', 'MOP', 'SANIT', 'WASH', 'BLEACH'], out: null },
  { id: 'maint', label: 'MAINTENANCE', words: ['MAINT', 'REPAIR', 'FIX', 'FILTER', 'BUILD'], out: null },
  { id: 'admin', label: 'ADMIN', words: ['ADMIN', 'ORDER', 'BOOKS', 'EMAIL', 'PHONE', 'PAPER'], out: null },
  { id: 'other', label: 'OTHER', words: [], out: null },
]
export const TASK_LABEL = Object.fromEntries(TASKS.map((t) => [t.id, t.label])) as Record<TaskId, string>
export const OUTPUT_UNIT: Record<Exclude<TaskOutput, null>, string> = { blocks: 'BLOCKS/H', kg_picked: 'KG/H', kg_sold: 'KG/H' }

const WORDS: [string, TaskId][] = TASKS.flatMap((x) => x.words.map((w) => [w, x.id] as [string, TaskId])).sort((a, b) => b[0].length - a[0].length)

/** The standard task a labour line belongs to. Exact labels first, then the first word that fits, else OTHER. */
export function taskOf(text: string | null | undefined): TaskId {
  const t = (text ?? '').trim().toUpperCase()
  if (!t) return 'other'
  const exact = TASKS.find((x) => x.label === t || x.id.toUpperCase() === t)
  if (exact) return exact.id
  // Longest phrase first, so CHECK BAGS is incubation (not MIX + BAG) and LABEL is packing (not LAB).
  const hit = WORDS.find(([w]) => t.includes(w))
  return hit ? hit[1] : 'other'
}

export interface TaskRow {
  task: TaskId
  /** Hours in each week shown, oldest first. */
  byWeek: number[]
  hours: number
  /** Share of all hours in the window, %. */
  sharePct: number
  avgPerWeek: number
  /** Output on the days this task was logged, and the rate per hour (null when the task has no output). */
  output: number | null
  perHour: number | null
  people: string[]
}

export interface TaskReport {
  weeks: { week: string; monday: string }[]
  rows: TaskRow[]
  total: number
  byPerson: { person: string; hours: number }[]
}

/**
 * Hours per task for the last `n` weeks. A rate uses only the days that task was logged: KNOCK hours against the
 * blocks knocked those days, HARVEST hours against kg picked those days, PACK and SELL + DELIVER against kg sold.
 * MIX + BAG and STEAM RUN count the blocks knocked in the same week (the steam run makes the next day's knock).
 */
export function taskReport(
  entries: LabourEntry[],
  ctx: { lots: BlockLot[]; harvests: Harvest[]; sales: Sale[] },
  today: string,
  n = 8,
): TaskReport {
  const weeks = lastWeeks(today, n)
  const idx = new Map(weeks.map((w, i) => [w.week, i]))
  const inWin = entries.filter((e) => idx.has(isoWeek(e.worked_on)) && Number(e.hours) > 0)
  const total = inWin.reduce((a, e) => a + Number(e.hours), 0)
  const blocksByDay = new Map<string, number>()
  const blocksByWeek = new Map<string, number>()
  for (const l of ctx.lots) {
    blocksByDay.set(l.knock_date, (blocksByDay.get(l.knock_date) ?? 0) + Number(l.bag_count))
    const w = isoWeek(l.knock_date)
    blocksByWeek.set(w, (blocksByWeek.get(w) ?? 0) + Number(l.bag_count))
  }
  const pickedByDay = new Map<string, number>()
  for (const h of ctx.harvests) pickedByDay.set(h.harvested_on, (pickedByDay.get(h.harvested_on) ?? 0) + Number(h.kg))
  const soldByDay = new Map<string, number>()
  for (const s of ctx.sales) soldByDay.set(s.sold_on, (soldByDay.get(s.sold_on) ?? 0) + Number(s.kg ?? 0))

  const rows: TaskRow[] = []
  for (const t of TASKS) {
    const mine = inWin.filter((e) => taskOf(e.task) === t.id)
    if (!mine.length) continue
    const byWeek = weeks.map(() => 0)
    for (const e of mine) byWeek[idx.get(isoWeek(e.worked_on))!] += Number(e.hours)
    const hours = byWeek.reduce((a, b) => a + b, 0)
    let output: number | null = null
    if (t.out) {
      const days = [...new Set(mine.map((e) => e.worked_on))]
      if (t.id === 'mix' || t.id === 'steam') {
        const ws = [...new Set(days.map(isoWeek))]
        output = ws.reduce((a, w) => a + (blocksByWeek.get(w) ?? 0), 0)
      } else {
        const m = t.out === 'blocks' ? blocksByDay : t.out === 'kg_picked' ? pickedByDay : soldByDay
        output = days.reduce((a, d) => a + (m.get(d) ?? 0), 0)
      }
    }
    rows.push({
      task: t.id,
      byWeek,
      hours,
      sharePct: total > 0 ? (hours / total) * 100 : 0,
      avgPerWeek: hours / n,
      output,
      perHour: output !== null && hours > 0 ? output / hours : null,
      people: [...new Set(mine.map((e) => e.person.toUpperCase()))].sort(),
    })
  }
  rows.sort((a, b) => b.hours - a.hours)
  const pp = new Map<string, number>()
  for (const e of inWin) pp.set(e.person.toUpperCase(), (pp.get(e.person.toUpperCase()) ?? 0) + Number(e.hours))
  return { weeks, rows, total, byPerson: [...pp.entries()].map(([person, hours]) => ({ person, hours })).sort((a, b) => b.hours - a.hours) }
}

// ---------- the running timer (one per device, kept in localStorage) ----------

export interface TaskTimer {
  task: TaskId
  person: string
  lot: string | null
  /** Start, ms since 1970. */
  since: number
}

/** Hours between two moments, rounded to the nearest 0.05 h (3 minutes). Never below 0.05. */
export function timerHours(since: number, now: number): number {
  const h = Math.max(0, now - since) / 3600000
  return Math.max(0.05, Math.round(h * 20) / 20)
}
