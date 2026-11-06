import { useEffect, useMemo, useState } from 'react'
import { useStore, useTable } from './StoreContext'
import { useCargo } from './useCargo'
import { usePractice } from './usePractice'
import type { SettingsRow } from './useRates'
import {
  FACILITY_ID,
  buildReminders,
  checkDue,
  cleanDue,
  farmDay,
  maintBoard,
  mergeFacility,
  outageSummary,
  statusLines,
  waterDue,
  type ChecklistRun,
  type CleanEntry,
  type Custom,
  type FacilitySettings,
  type MaintItem,
  type MaintLog,
  type PowerCut,
  type WaterTest,
} from '../lib/facility'
import { saveFacility } from '../lib/facilityActions'
import { bankStatus } from '../lib/bank'
import { board, todayList } from '../lib/mission'
import { owed } from '../lib/money'
import type { Sale } from '../lib/trade'
import type { BlockLot, Culture, GrainRun, Strain } from '../lib/xeno'
import type { LotLoss } from '../lib/hazard'
import type { Harvest } from '../lib/ledger'
import type { BankTest, ViabilityCheck } from '../lib/bank'
import { useSensors } from './useSensors'
import { climateLine } from '../lib/sensors'

/** The time now, refreshed every `ms` while a screen is looking (a cut that is still going counts up). */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

export function useFacilitySettings(): FacilitySettings {
  const rows = useTable<SettingsRow>('app_settings')
  const row = rows.find((r) => r.id === FACILITY_ID)
  return useMemo(() => mergeFacility(row?.value), [row])
}

export function useFacilityEditor(): [FacilitySettings, (patch: Partial<FacilitySettings>, label: string) => Promise<void>] {
  const store = useStore()
  const s = useFacilitySettings()
  return [s, async (patch, label) => void (await store.action(label, () => saveFacility(store, s, patch)))]
}

/** Every table FACILITY reads, and the lists worked out from them. */
export function useFacility() {
  const cuts = useTable<PowerCut>('power_cuts')
  const water = useTable<WaterTest>('water_tests')
  const maint = useTable<MaintItem>('maint_items')
  const maintLog = useTable<MaintLog>('maint_log')
  const cleanLog = useTable<CleanEntry>('clean_log')
  const runs = useTable<ChecklistRun>('checklist_runs')
  const custom = useTable<Custom>('reminders')
  const settings = useFacilitySettings()
  const now = useNow(cuts.some((c) => c.up_at === null && c.kind === 'cut') ? 15000 : 60000)
  const today = farmDay(now)
  const b = useMemo(() => maintBoard(maint, cuts, today, now), [maint, cuts, today, now])
  const w = useMemo(() => waterDue(water, today, settings), [water, today, settings])
  const c = useMemo(() => cleanDue(cleanLog, today, settings), [cleanLog, today, settings])
  const k = useMemo(() => checkDue(runs, today, settings), [runs, today, settings])
  const summary = useMemo(() => outageSummary(cuts, now), [cuts, now])
  return { cuts, water, maint, maintLog, cleanLog, runs, custom, settings, now, today, board: b, waterDue: w, cleanDue: c, checkDue: k, summary }
}
export type FacilityData = ReturnType<typeof useFacility>

/** Everything that is due, from FACILITY and from the rest of the app (MISSION, culture bank, CARGO, MONEY). */
export function useReminders() {
  const f = useFacility()
  const lots = useTable<BlockLot>('block_lots')
  const losses = useTable<LotLoss>('lot_losses')
  const harvests = useTable<Harvest>('harvests')
  const cultures = useTable<Culture>('cultures')
  const grain = useTable<GrainRun>('grain_runs')
  const strains = useTable<Strain>('strains')
  const checks = useTable<ViabilityCheck>('viability_checks')
  const tests = useTable<BankTest>('bank_tests')
  const sales = useTable<Sale>('sales')
  const practice = usePractice()
  const cargo = useCargo()
  const reminders = useMemo(() => {
    const rows = board(lots, losses, harvests)
    const reorders = cargo.rows.filter((r) => r.state === 'LOW' || r.state === 'OUT').map((r) => ({ id: r.item.id, name: r.item.name, state: r.state as string, weeks: r.weeks }))
    const todayItems = todayList({ rows, cultures, grain, strains, reorders })
    const bankWarnings = strains
      .filter((s) => s.active)
      .flatMap((s) => bankStatus(s, cultures, checks, tests, practice).warnings.map((text) => ({ strain: s.code, text })))
    const ow = owed(sales, f.today)
    return buildReminders({
      today: f.today,
      settings: f.settings,
      todayItems,
      bankWarnings,
      maint: f.board,
      water: f.waterDue,
      clean: f.cleanDue,
      checks: f.checkDue,
      owed: ow.buyers.map((b2) => ({ buyer: b2.buyer, crc: b2.crc, days: b2.days })),
      custom: f.custom,
      openCut: f.summary.open,
      now: f.now,
    })
  }, [f.today, f.settings, f.board, f.waterDue, f.cleanDue, f.checkDue, f.custom, f.summary.open, f.now, lots, losses, harvests, cultures, grain, strains, checks, tests, sales, practice, cargo.rows])
  // Climate alarms from ATMOSPHERICS (the power cut is already the first reminder).
  const sens = useSensors()
  const all = useMemo(() => {
    const climate = sens.alarms
      .filter((a) => !a.acked && a.kind !== 'POWER')
      .map((a) => ({ key: `climate:${a.key}`, kind: 'CLIMATE' as const, warn: true, due: null, text: a.text, go: { screen: 'ATMOS' as const, tab: 'ALARMS' } }))
    if (!climate.length) return reminders
    const p = reminders.filter((r) => r.kind === 'POWER')
    return [...p, ...climate, ...reminders.filter((r) => r.kind !== 'POWER')]
  }, [reminders, sens.alarms])
  const owedTotal = useMemo(() => owed(sales, f.today).total, [sales, f.today])
  const withData = sens.board.filter((p) => p.last !== null).length
  const lines = useMemo(() => {
    const ls = statusLines({ now: f.now, today: f.today, cuts: f.cuts, reminders: all, water: f.waterDue, maint: f.board, owedCrc: owedTotal })
    if (!sens.readings.length && !sens.sensors.length && !sens.ac.length) return ls
    return [ls[0], climateLine(sens.alarms.filter((a) => a.kind !== 'POWER'), withData), ...ls.slice(1)]
  }, [f.now, f.today, f.cuts, all, f.waterDue, f.board, owedTotal, sens.alarms, sens.readings.length, sens.sensors.length, sens.ac.length, withData])
  return { ...f, reminders: all, lines }
}
