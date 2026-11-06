// Writes for FACILITY (build G7). Each function is ONE user action: screens call them inside
// store.action(label, ...) so one tap is one UNDO step and one history line.

import { uuid, type Store } from './store'
import type { CheckTemplate } from '../data/checklists'
import {
  FACILITY_ID,
  STANDARD_MAINT,
  checkClean,
  checkCustom,
  checkCut,
  checkMaint,
  checkRun,
  checkWater,
  cleanText,
  farmDay,
  fromFarm,
  isoOf,
  mergeFacility,
  wholeMin,
  type CheckItemState,
  type ChecklistRun,
  type CleanEntry,
  type CleanInput,
  type Custom,
  type CutInput,
  type FacilitySettings,
  type GenRun,
  type MaintInput,
  type MaintItem,
  type MaintLog,
  type PowerCut,
  type WaterInput,
  type WaterTest,
} from './facility'

const nowIso = () => new Date().toISOString()
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000)

// ---------- settings ----------

export async function saveFacility(store: Store, current: FacilitySettings, patch: Partial<FacilitySettings>): Promise<FacilitySettings> {
  const next = mergeFacility({ ...current, ...patch })
  await store.put('app_settings', { id: FACILITY_ID, value: next, updated_at: nowIso() })
  return next
}

/** Hide a reminder until and including `until`. Old snoozes (before today) are dropped while we are here. */
export async function snooze(store: Store, current: FacilitySettings, key: string, until: string, today: string): Promise<void> {
  const kept = Object.fromEntries(Object.entries(current.snoozed).filter(([, d]) => d >= today))
  await saveFacility(store, current, { snoozed: { ...kept, [key]: until } })
}

// ---------- power cuts ----------

const rowOfCut = (i: CutInput, prev: PowerCut | null, id: string): PowerCut => {
  const runs: GenRun[] = i.runs.map((r) => ({ on: isoOf(r.on as number), off: r.off === null ? null : isoOf(r.off) }))
  const now = nowIso()
  return {
    id,
    kind: i.kind,
    down_at: isoOf(i.down as number),
    up_at: i.kind === 'cut' && i.up !== null ? isoOf(i.up) : null,
    gen_runs: runs.length ? runs : null,
    gen_hours: r2(i.genHours),
    fuel: i.fuel ?? null,
    fuel_amount: r2(i.fuelAmount),
    affected: i.affected.length ? i.affected : null,
    losses: cleanText(i.losses, 300),
    notes: cleanText(i.notes, 300),
    who: cleanText(i.who, 60),
    created_at: prev?.created_at ?? now,
    updated_at: now,
  }
}

/** Save a cut or a test run (new when id is null). The checks are the same as the form shows. */
export async function saveCut(store: Store, id: string | null, i: CutInput, now: number): Promise<PowerCut> {
  await store.ensure('power_cuts')
  const all = store.rows<PowerCut>('power_cuts')
  const bad = checkCut(i, now, all.filter((c) => c.id !== id))
  if (bad) throw new Error(bad)
  const prev = id ? all.find((c) => c.id === id) ?? null : null
  if (id && !prev) throw new Error('THAT ENTRY IS GONE.')
  const row = rowOfCut(i, prev, id ?? uuid())
  await store.put('power_cuts', row)
  return row
}

export async function deleteCut(store: Store, id: string): Promise<void> {
  await store.del('power_cuts', id)
}

const asInput = (c: PowerCut, patch: Partial<CutInput> = {}): CutInput => ({
  kind: c.kind,
  down: Date.parse(c.down_at),
  up: c.up_at ? Date.parse(c.up_at) : null,
  runs: (c.gen_runs ?? []).map((r) => ({ on: Date.parse(r.on), off: r.off ? Date.parse(r.off) : null })),
  genHours: c.gen_hours ?? null,
  fuel: c.fuel ?? null,
  fuelAmount: c.fuel_amount ?? null,
  affected: c.affected ?? [],
  losses: c.losses,
  notes: c.notes,
  who: c.who,
  ...patch,
})
export const cutInput = asInput

/** The big button: the power just went out. Refuses a second open cut. */
export async function powerOut(store: Store, now: number, who: string | null): Promise<PowerCut> {
  await store.ensure('power_cuts')
  if (store.rows<PowerCut>('power_cuts').some((c) => c.kind === 'cut' && c.up_at === null)) throw new Error('A CUT IS ALREADY OPEN. PRESS POWER IS BACK WHEN THE GRID RETURNS.')
  return saveCut(store, null, { kind: 'cut', down: wholeMin(now), up: null, runs: [], genHours: null, fuel: null, fuelAmount: null, affected: [], who }, now)
}

/** The grid is back. Closes the open cut; a generator run still open is stopped at the same moment. */
export async function powerBack(store: Store, now: number): Promise<PowerCut> {
  await store.ensure('power_cuts')
  const open = store.rows<PowerCut>('power_cuts').find((c) => c.kind === 'cut' && c.up_at === null)
  if (!open) throw new Error('NO CUT IS OPEN.')
  const up = wholeMin(now)
  const input = asInput(open)
  const down = input.down as number
  const t = up <= down ? down + 60000 : up
  return saveCut(store, open.id, { ...input, up: t, runs: input.runs.map((r) => (r.off === null ? { ...r, off: Math.max(t, (r.on as number) + 60000) } : r)) }, Math.max(now, t))
}

/** Generator started: added to the open cut, or a TEST RUN entry when no cut is open. */
export async function genStart(store: Store, now: number, who: string | null): Promise<PowerCut> {
  await store.ensure('power_cuts')
  const all = store.rows<PowerCut>('power_cuts')
  const on = wholeMin(now)
  const open = all.find((c) => c.kind === 'cut' && c.up_at === null)
  if (open) {
    const input = asInput(open)
    if (input.runs.some((r) => r.off === null)) throw new Error('THE GENERATOR IS ALREADY LOGGED AS RUNNING.')
    return saveCut(store, open.id, { ...input, runs: [...input.runs, { on, off: null }] }, now)
  }
  const test = all.find((c) => c.kind === 'test' && (c.gen_runs ?? []).some((r) => r.off === null))
  if (test) throw new Error('A TEST RUN IS ALREADY OPEN. PRESS GENERATOR STOPPED FIRST.')
  return saveCut(store, null, { kind: 'test', down: on, up: null, runs: [{ on, off: null }], genHours: null, fuel: null, fuelAmount: null, affected: [], who }, now)
}

/** Generator stopped: closes the open run on the open cut or open test. */
export async function genStop(store: Store, now: number): Promise<PowerCut> {
  await store.ensure('power_cuts')
  const all = store.rows<PowerCut>('power_cuts')
  const hit = all.find((c) => (c.gen_runs ?? []).some((r) => r.off === null) && (c.kind === 'test' || c.up_at === null)) ?? null
  if (!hit) throw new Error('NO GENERATOR RUN IS OPEN.')
  const input = asInput(hit)
  const off = wholeMin(now)
  return saveCut(store, hit.id, { ...input, runs: input.runs.map((r) => (r.off === null ? { ...r, off: Math.max(off, (r.on as number) + 60000) } : r)) }, Math.max(now, off + 60000))
}

// ---------- water ----------

const rowOfWater = (i: WaterInput, prev: WaterTest | null, id: string): WaterTest => {
  const now = nowIso()
  return {
    id,
    tested_on: i.day,
    tested_time: i.time || null,
    point: i.point,
    ph: i.ph,
    tds_ppm: i.tds,
    hardness_ppm: i.hardness,
    cl_ppm: i.cl,
    temp_c: i.temp,
    action: cleanText(i.action, 300),
    notes: cleanText(i.notes, 300),
    who: cleanText(i.who, 60),
    created_at: prev?.created_at ?? now,
    updated_at: now,
  }
}
export async function saveWater(store: Store, id: string | null, i: WaterInput, today: string): Promise<WaterTest> {
  const bad = checkWater(i, today)
  if (bad) throw new Error(bad)
  await store.ensure('water_tests')
  const prev = id ? store.rows<WaterTest>('water_tests').find((t) => t.id === id) ?? null : null
  if (id && !prev) throw new Error('THAT TEST IS GONE.')
  const row = rowOfWater(i, prev, id ?? uuid())
  await store.put('water_tests', row)
  return row
}
export async function deleteWater(store: Store, id: string): Promise<void> {
  await store.del('water_tests', id)
}

// ---------- maintenance ----------

const rowOfMaint = (i: MaintInput, prev: MaintItem | null, id: string): MaintItem => {
  const now = nowIso()
  return {
    id,
    name: (cleanText(i.name, 80) as string).toUpperCase(),
    category: i.category,
    room_id: i.room || null,
    make_model: cleanText(i.make, 80),
    serial: cleanText(i.serial, 60),
    installed_on: i.installed || null,
    every_days: i.everyDays,
    every_hours: i.everyHours,
    last_done_on: prev?.last_done_on ?? null,
    started_on: i.startedOn,
    notes: cleanText(i.notes, 300),
    active: prev?.active ?? true,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  }
}
export async function saveMaint(store: Store, id: string | null, i: MaintInput): Promise<MaintItem> {
  const bad = checkMaint(i)
  if (bad) throw new Error(bad)
  await store.ensure('maint_items')
  const all = store.rows<MaintItem>('maint_items')
  const prev = id ? all.find((m) => m.id === id) ?? null : null
  if (id && !prev) throw new Error('THAT ITEM IS GONE.')
  const name = (cleanText(i.name, 80) as string).toUpperCase()
  if (all.some((m) => m.id !== id && m.name === name && m.active !== false)) throw new Error('AN ITEM WITH THAT NAME IS ALREADY ON THE LIST.')
  const row = rowOfMaint(i, prev, id ?? uuid())
  await store.put('maint_items', row)
  return row
}

/** Add the starting schedule. Items already on the list (same name) are left alone. Returns how many were added. */
export async function seedMaint(store: Store, today: string): Promise<number> {
  await store.ensure('maint_items')
  const have = new Set(store.rows<MaintItem>('maint_items').map((m) => m.name))
  const now = nowIso()
  const rows: MaintItem[] = STANDARD_MAINT.filter((s) => !have.has(s.name)).map((s) => ({
    id: uuid(),
    name: s.name,
    category: s.category,
    room_id: s.room,
    make_model: null,
    serial: null,
    installed_on: null,
    every_days: s.days,
    every_hours: s.hours,
    last_done_on: null,
    started_on: today,
    notes: s.note,
    active: true,
    created_at: now,
    updated_at: now,
  }))
  if (rows.length) await store.put('maint_items', rows)
  return rows.length
}

/** Mark a job done on a day. The job's last-done day only moves forward; the log keeps every entry. */
export async function markMaintDone(store: Store, itemId: string, day: string, who: string | null, notes: string | null, today: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || fromFarm(day, '00:00') === null) throw new Error('PICK THE DAY IT WAS DONE.')
  if (day > today) throw new Error('THE DAY IS IN THE FUTURE.')
  await store.ensure('maint_items')
  const item = store.rows<MaintItem>('maint_items').find((m) => m.id === itemId)
  if (!item) throw new Error('THAT ITEM IS GONE.')
  const log: MaintLog = { id: uuid(), item_id: itemId, done_on: day, who: cleanText(who, 60), notes: cleanText(notes, 300), created_at: nowIso() }
  await store.put('maint_log', log)
  if (!item.last_done_on || day > item.last_done_on) await store.put('maint_items', { ...item, last_done_on: day })
}

/** Delete a log line and put the job's last-done day back to the newest remaining line. */
export async function deleteMaintLog(store: Store, logId: string): Promise<void> {
  await store.ensure('maint_log')
  await store.ensure('maint_items')
  const l = store.rows<MaintLog>('maint_log').find((x) => x.id === logId)
  if (!l) return
  await store.del('maint_log', logId)
  const left = store.rows<MaintLog>('maint_log').filter((x) => x.item_id === l.item_id && x.id !== logId)
  const newest = left.map((x) => x.done_on).sort().at(-1) ?? null
  const item = store.rows<MaintItem>('maint_items').find((m) => m.id === l.item_id)
  if (item && item.last_done_on !== newest) await store.put('maint_items', { ...item, last_done_on: newest })
}

/** Remove an item from the list but keep its history (active = false), or put it back. */
export async function setMaintActive(store: Store, id: string, active: boolean): Promise<void> {
  await store.ensure('maint_items')
  const item = store.rows<MaintItem>('maint_items').find((m) => m.id === id)
  if (!item) throw new Error('THAT ITEM IS GONE.')
  await store.put('maint_items', { ...item, active })
}

export async function deleteMaint(store: Store, id: string): Promise<void> {
  await store.ensure('maint_log')
  const logs = store.rows<MaintLog>('maint_log').filter((l) => l.item_id === id).map((l) => l.id)
  if (logs.length) await store.del('maint_log', logs)
  await store.del('maint_items', id)
}

// ---------- cleaning ----------

export async function saveClean(store: Store, id: string | null, i: CleanInput, today: string): Promise<CleanEntry> {
  const bad = checkClean(i, today)
  if (bad) throw new Error(bad)
  await store.ensure('clean_log')
  const prev = id ? store.rows<CleanEntry>('clean_log').find((c) => c.id === id) ?? null : null
  if (id && !prev) throw new Error('THAT ENTRY IS GONE.')
  const now = nowIso()
  const row: CleanEntry = {
    id: id ?? uuid(),
    cleaned_on: i.day,
    room_id: i.room,
    tasks: [...new Set(i.tasks)],
    product: cleanText(i.product, 80),
    who: cleanText(i.who, 60),
    notes: cleanText(i.notes, 300),
    created_at: prev?.created_at ?? now,
    updated_at: now,
  }
  await store.put('clean_log', row)
  return row
}
export async function deleteClean(store: Store, id: string): Promise<void> {
  await store.del('clean_log', id)
}

// ---------- checklists ----------

export async function signOff(store: Store, t: CheckTemplate, items: CheckItemState[], who: string | null, note: string | null, now: number): Promise<ChecklistRun> {
  const bad = checkRun(t, items, who)
  if (bad) throw new Error(bad)
  const row: ChecklistRun = {
    id: uuid(),
    template: t.key,
    done_on: farmDay(now),
    finished_at: isoOf(now),
    who: cleanText(who, 60),
    items: t.steps.map((s) => {
      const it = items.find((x) => x.id === s.id) as CheckItemState
      return it.state === 'skip' ? { id: s.id, state: 'skip', note: cleanText(it.note, 200) } : { id: s.id, state: 'ok' }
    }),
    note: cleanText(note, 300),
    created_at: nowIso(),
  }
  await store.put('checklist_runs', row)
  return row
}
export async function deleteRun(store: Store, id: string): Promise<void> {
  await store.del('checklist_runs', id)
}

// ---------- reminders you type yourself ----------

export async function addCustom(store: Store, due: string, text: string, repeat: number | null): Promise<Custom> {
  const bad = checkCustom(due, text, repeat)
  if (bad) throw new Error(bad)
  const now = nowIso()
  const row: Custom = { id: uuid(), due_on: due, text: cleanText(text, 140) as string, repeat_days: repeat, done_on: null, created_at: now, updated_at: now }
  await store.put('reminders', row)
  return row
}
export async function finishCustom(store: Store, id: string, patch: Partial<Custom>): Promise<void> {
  await store.ensure('reminders')
  const r = store.rows<Custom>('reminders').find((x) => x.id === id)
  if (!r) throw new Error('THAT REMINDER IS GONE.')
  await store.put('reminders', { ...r, ...patch })
}
export async function deleteCustom(store: Store, id: string): Promise<void> {
  await store.del('reminders', id)
}

