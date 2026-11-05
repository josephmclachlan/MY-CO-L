import { useMemo, useSyncExternalStore } from 'react'
import { useTable } from './StoreContext'
import { SPECIES } from '../data/species'
import { buildLedger, DEFAULT_LEDGER_PREFS, planWeek, type EnergyBill, type Harvest, type LabourEntry, type Ledger, type LedgerPrefs, type WeekCost } from '../lib/ledger'
import type { Item, Move, Price } from '../lib/cargo'
import type { CookRun } from '../lib/cook'
import type { BlockLot } from '../lib/xeno'
import type { LotLoss } from '../lib/hazard'

export const speciesName = (k: string) => SPECIES.find((s) => s.id === k)?.name ?? (k === 'unknown' ? 'NOT SET' : k.toUpperCase())

// ---------- LEDGER switches (this device) ----------

const KEY = 'mycol.ledger.v1'
function load(): LedgerPrefs {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LedgerPrefs>
    const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)
    return {
      labourOn: typeof s.labourOn === 'boolean' ? s.labourOn : DEFAULT_LEDGER_PREFS.labourOn,
      rate: n(s.rate),
      wearOn: typeof s.wearOn === 'boolean' ? s.wearOn : DEFAULT_LEDGER_PREFS.wearOn,
      wearPerBlock: n(s.wearPerBlock),
    }
  } catch {
    return DEFAULT_LEDGER_PREFS
  }
}
let prefs = load()
const listeners = new Set<() => void>()
export function useLedgerPrefs(): [LedgerPrefs, (p: Partial<LedgerPrefs>) => void] {
  const p = useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => prefs,
  )
  const set = (patch: Partial<LedgerPrefs>) => {
    prefs = { ...prefs, ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // blocked storage: lasts until reload
    }
    for (const l of listeners) l()
  }
  return [p, set]
}

/** The next Tuesday (knock day), for the plan week. */
function nextTuesday(): string {
  const d = new Date()
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface LedgerData {
  ledger: Ledger
  plan: WeekCost
  bills: EnergyBill[]
  labour: LabourEntry[]
  lots: BlockLot[]
  harvests: Harvest[]
  prefs: LedgerPrefs
}

/** Every table LEDGER reads, worked into costs. TRADE uses it for margins. */
export function useLedger(): LedgerData {
  const lots = useTable<BlockLot>('block_lots')
  const losses = useTable<LotLoss>('lot_losses')
  const harvests = useTable<Harvest>('harvests')
  const items = useTable<Item>('items')
  const prices = useTable<Price>('item_prices')
  const moves = useTable<Move>('stock_moves')
  const cooks = useTable<CookRun>('cook_runs')
  const bills = useTable<EnergyBill>('energy_bills')
  const labour = useTable<LabourEntry>('labour_entries')
  const [p] = useLedgerPrefs()
  const ledger = useMemo(
    () => buildLedger({ lots, losses, harvests, items, prices, moves, cooks, bills, labour, prefs: p }, speciesName),
    [lots, losses, harvests, items, prices, moves, cooks, bills, labour, p],
  )
  const plan = useMemo(() => planWeek({ items, prices, prefs: p }, nextTuesday(), speciesName), [items, prices, p])
  return { ledger, plan, bills, labour, lots, harvests, prefs: p }
}
