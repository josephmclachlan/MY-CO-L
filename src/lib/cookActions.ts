// Writes for PROPULSION. The run row keeps the headline numbers (so LEDGER and exports can read them);
// the readings are the source, and the numbers are worked out again after every change.

import { DEFAULT_PURPOSE, type CookKind, type Purpose } from '../data/cook'
import type { HeaterOption } from '../data/power'
import { analyseRun, changed, energyFor, headline, type CookReading, type CookRun } from './cook'
import { uuid, type Row, type Store } from './store'

export function newRun(kind: CookKind, o: Partial<CookRun> & { heater: HeaterOption; startedAt?: number }): CookRun {
  const now = new Date().toISOString()
  const purpose: Purpose = DEFAULT_PURPOSE[kind]
  return {
    id: uuid(),
    kind,
    purpose: o.purpose ?? purpose,
    unit_label: o.unit_label ?? null,
    load_desc: o.load_desc ?? null,
    bag_count: o.bag_count ?? null,
    started_at: new Date(o.startedAt ?? Date.now()).toISOString(),
    ended_at: null,
    come_up_minutes: null,
    hold_min_190f: null,
    hold_min_198f: null,
    hold_min_200f: null,
    hold_min_205f: null,
    max_temp_f: null,
    f_value: null,
    hold_min_psi: null,
    heater_option: kind === 'steam_box' ? o.heater : null,
    pots: kind === 'megachef' ? (o.pots ?? 4) : null,
    cook_minutes: null,
    kwh_metered: null,
    heater_on_min: null,
    kwh: null,
    kwh_basis: null,
    cost_crc: null,
    result: 'pending',
    seq_run_ref: o.seq_run_ref ?? null,
    notes: o.notes ?? null,
    created_at: now,
    updated_at: now,
  }
}

export function newReading(runId: string, takenAt: number, zone: string, tempF: number | null, psi: number | null): CookReading {
  return { id: uuid(), cook_run_id: runId, taken_at: new Date(takenAt).toISOString(), zone: zone.trim().toUpperCase(), temp_f: tempF, psi, created_at: new Date().toISOString() }
}

/** Work the headline numbers out again from the readings and save them on the run row if they moved. */
export async function recompute(store: Store, runId: string, now: number = Date.now()): Promise<CookRun | null> {
  await Promise.all([store.ensure('cook_runs'), store.ensure('cook_readings')])
  const run = store.rows<CookRun>('cook_runs').find((r) => r.id === runId)
  if (!run) return null
  const readings = store.rows<CookReading>('cook_readings').filter((r) => r.cook_run_id === runId)
  const an = analyseRun(run, readings, now)
  const patch = headline(run, an, energyFor(run, an))
  if (!changed(run, patch)) return run
  const next = { ...run, ...patch, updated_at: new Date().toISOString() } as CookRun
  await store.put('cook_runs', next)
  return next
}

export async function saveRun(store: Store, run: CookRun, patch: Partial<CookRun>): Promise<void> {
  await store.put('cook_runs', { ...run, ...patch, updated_at: new Date().toISOString() } as CookRun)
  await recompute(store, run.id)
}

export async function addReadings(store: Store, runId: string, rows: CookReading[]): Promise<void> {
  if (!rows.length) return
  await store.put('cook_readings', rows)
  await recompute(store, runId)
}

export async function removeReadings(store: Store, runId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  await store.del('cook_readings', ids)
  await recompute(store, runId)
}

/** Point a grain run or block lot at this cook (or at nothing). */
export async function linkLoad(store: Store, table: 'grain_runs' | 'block_lots', row: Row, runId: string | null): Promise<void> {
  await store.put(table, { ...row, cook_run_id: runId })
}

/** Removing a run removes its readings and lets go of any lots or grain runs it was linked to. */
export async function removeRun(store: Store, runId: string): Promise<void> {
  await Promise.all([store.ensure('cook_readings'), store.ensure('grain_runs'), store.ensure('block_lots')])
  for (const t of ['grain_runs', 'block_lots'] as const) {
    const linked = store.rows(t).filter((r) => r.cook_run_id === runId)
    if (linked.length) await store.put(t, linked.map((r) => ({ ...r, cook_run_id: null })))
  }
  const rs = store.rows<CookReading>('cook_readings').filter((r) => r.cook_run_id === runId).map((r) => r.id)
  if (rs.length) await store.del('cook_readings', rs)
  await store.del('cook_runs', runId)
}
