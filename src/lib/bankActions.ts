// Writes for the culture bank (G3). Screens wrap each call in store.action(label, fn) so it is one UNDO step.

import { uuid, type Store } from './store'
import { addCultures, setCultureStatus } from './xenoActions'
import { todayIso, type Culture, type Strain } from './xeno'
import {
  PRACTICE_ID,
  bankLabel,
  mergePractice,
  nextTubeNo,
  type BankTest,
  type CheckResult,
  type Practice,
  type TestReason,
  type TestResult,
  type ViabilityCheck,
} from './bank'

export const FRIDGE = 'CULTURE FRIDGE'
export const OFFSITE = 'OFF-SITE COPY'

export async function savePractice(store: Store, current: Practice, patch: Partial<Practice>): Promise<Practice> {
  const next = mergePractice({ ...current, ...patch })
  await store.put('app_settings', { id: PRACTICE_ID, value: next, updated_at: new Date().toISOString() })
  return next
}

export interface BankBatchIn {
  strain: Strain
  from: Culture // the plate the whole batch is cut from (P1 at intake)
  slants: number
  water: number
  offsiteSlants: number
  offsiteWater: number
  on?: string
  existing: Culture[]
}

/**
 * Bank a batch: slants and water tubes from ONE plate, labelled BO-01 W3 P1 2026-11-09, straight into the
 * culture fridge, with the chosen number marked as the off-site copy (t08-proc-our-intake).
 */
export async function bankBatch(store: Store, o: BankBatchIn): Promise<Culture[]> {
  const { strain, from } = o
  if (from.strain_id !== strain.id) throw new Error('THAT PLATE BELONGS TO ANOTHER STRAIN.')
  if (from.kind !== 'plate') throw new Error('BANK FROM A PLATE: CUT EVERY TUBE FROM ONE PLATE.')
  if (from.status !== 'clean' && from.status !== 'cold_storage') throw new Error('THAT PLATE IS NOT CLEAN.')
  if ((from.p_level ?? 0) < 1) throw new Error('THAT PLATE IS THE MASTER (P0). PLATE IT FIRST AND BANK FROM THE P1 PLATE.')
  const slants = Math.max(0, Math.min(12, Math.floor(o.slants || 0)))
  const water = Math.max(0, Math.min(12, Math.floor(o.water || 0)))
  if (slants + water === 0) throw new Error('HOW MANY SLANTS AND WATER TUBES?')
  const offS = Math.max(0, Math.min(slants, Math.floor(o.offsiteSlants || 0)))
  const offW = Math.max(0, Math.min(water, Math.floor(o.offsiteWater || 0)))
  const on = o.on || todayIso()
  const batch = uuid()
  const now = new Date().toISOString()
  const rows: Culture[] = []
  const make = (kind: 'slant' | 'water', n: number, off: number) => {
    let no = nextTubeNo(strain.code, kind, [...o.existing, ...rows], strain.id)
    for (let i = 0; i < n; i++) {
      const offsite = i >= n - off
      rows.push({
        id: uuid(),
        strain_id: strain.id,
        parent_culture_id: from.id,
        kind,
        p_level: from.p_level, // a tube keeps the level of what it was made from (childP)
        made_on: on,
        status: 'cold_storage',
        cold_since: on,
        location: offsite ? OFFSITE : FRIDGE,
        label: bankLabel(strain.code, kind, no++, from.p_level, on),
        notes: null,
        bank_batch: batch,
        offsite,
        created_at: now,
        updated_at: now,
      })
    }
  }
  make('slant', slants, offS)
  make('water', water, offW)
  await store.put('cultures', rows)
  return rows
}

/** Plate the master (P0) to make the first plate, P1 (intake step 2). */
export async function plateMaster(store: Store, strain: Strain, master: Culture, existing: Culture[], on?: string): Promise<Culture> {
  const [p1] = await addCultures(store, { strain, parent: master, kind: 'plate', count: 1, made_on: on || todayIso(), location: 'LAB', existing })
  return p1
}

/** Mark a tube as the off-site copy, or bring it back to the culture fridge. */
export async function setOffsite(store: Store, c: Culture, offsite: boolean): Promise<void> {
  await store.put('cultures', { ...c, offsite, location: offsite ? OFFSITE : c.location === OFFSITE ? FRIDGE : c.location })
}

/**
 * Start the test-and-expand line from one tube: dish T (tested) and dish E (held back) (t08-our-te).
 * The E dish cannot be expanded until the test passes.
 */
export async function startTest(store: Store, o: { strain: Strain; tube: Culture; reason: TestReason; on?: string; existing: Culture[] }): Promise<BankTest> {
  const { strain, tube } = o
  if (tube.strain_id !== strain.id) throw new Error('THAT TUBE BELONGS TO ANOTHER STRAIN.')
  if (tube.status !== 'clean' && tube.status !== 'cold_storage') throw new Error('THAT TUBE IS NOT IN THE BANK.')
  const on = o.on || todayIso()
  const [t] = await addCultures(store, { strain, parent: tube, kind: 'plate', count: 1, made_on: on, location: 'LAB', existing: o.existing })
  await store.put('cultures', { ...t, notes: 'T/E TEST: DISH T (TEST)' })
  const [e] = await addCultures(store, { strain, parent: tube, kind: 'plate', count: 1, made_on: on, location: 'LAB', existing: [...o.existing, t] })
  await store.put('cultures', { ...e, notes: 'T/E TEST: DISH E (HELD UNTIL T PASSES)' })
  const now = new Date().toISOString()
  const row: BankTest = {
    id: uuid(),
    strain_id: strain.id,
    source_culture_id: tube.id,
    t_plate_id: t.id,
    e_plate_id: e.id,
    reason: o.reason,
    started_on: on,
    result: 'pending',
    decided_on: null,
    days_to_colonize: null,
    days_to_pin: null,
    kg_per_block: null,
    form: null,
    notes: null,
    created_at: now,
    updated_at: now,
  }
  await store.put('bank_tests', row)
  return row
}

export interface Decision {
  result: Exclude<TestResult, 'pending'>
  on?: string
  days_to_colonize?: number | null
  days_to_pin?: number | null
  kg_per_block?: number | null
  form?: string | null
  notes?: string | null
}

const posOrNull = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) || v < 0 ? null : v)

/** Pass releases dish E for production. Fail discards dish E (revive another tube). */
export async function decideTest(store: Store, test: BankTest, d: Decision, cultures: Culture[]): Promise<BankTest> {
  if (test.result !== 'pending') throw new Error('THIS TEST IS ALREADY DECIDED. UNDO OR EDIT THE HISTORY TO CHANGE IT.')
  const row: BankTest = {
    ...test,
    result: d.result,
    decided_on: d.on || todayIso(),
    days_to_colonize: posOrNull(d.days_to_colonize),
    days_to_pin: posOrNull(d.days_to_pin),
    kg_per_block: posOrNull(d.kg_per_block),
    form: d.form?.trim() || null,
    notes: d.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  }
  await store.put('bank_tests', row)
  if (d.result === 'fail') {
    const e = cultures.find((c) => c.id === test.e_plate_id)
    if (e && e.status !== 'discarded') await setCultureStatus(store, e, 'discarded')
  }
  return row
}

export interface CheckIn {
  tube: Culture
  on?: string
  days_to_cover: number | null
  appearance: string | null
  contamination: string | null
  result: CheckResult
  notes?: string | null
  initials?: string | null
}

/** One line in the viability log. */
export async function logCheck(store: Store, o: CheckIn): Promise<ViabilityCheck> {
  const d = o.days_to_cover
  const row: ViabilityCheck = {
    id: uuid(),
    culture_id: o.tube.id,
    strain_id: o.tube.strain_id,
    checked_on: o.on || todayIso(),
    days_to_cover: d === null || !Number.isFinite(d) || d <= 0 ? null : Math.round(d * 10) / 10,
    appearance: o.appearance?.trim() || null,
    contamination: o.contamination?.trim() || null,
    result: o.result,
    notes: o.notes?.trim() || null,
    initials: o.initials?.trim() || null,
    created_at: new Date().toISOString(),
  }
  await store.put('viability_checks', row)
  return row
}

/** Monthly strain check found the strain slipping: mark every bank tube WATCH (t09-our-testbags). */
export async function watchStrain(store: Store, tubes: Culture[], why: string, on?: string): Promise<number> {
  const day = on || todayIso()
  for (const t of tubes) await logCheck(store, { tube: t, on: day, days_to_cover: null, appearance: null, contamination: null, result: 'watch', notes: `MONTHLY STRAIN CHECK: ${why}`.slice(0, 300) })
  return tubes.length
}
