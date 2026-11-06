import { useMemo } from 'react'
import { useTable } from './StoreContext'
import { usePractice } from './usePractice'
import { allRecords, fadingStrains, type FlushLog, type StrainTrial } from '../lib/records'
import type { BlockLot, Strain } from '../lib/xeno'
import type { LotLoss } from '../lib/hazard'
import type { Harvest } from '../lib/ledger'
import type { CookRun } from '../lib/cook'

/** Everything the production-record screens need: rows from the store and the per-lot records built from them. */
export function useRecords() {
  const lots = useTable<BlockLot>('block_lots')
  const losses = useTable<LotLoss>('lot_losses')
  const harvests = useTable<Harvest>('harvests')
  const pins = useTable<FlushLog>('flush_log')
  const trials = useTable<StrainTrial>('strain_trials')
  const strains = useTable<Strain>('strains')
  const cooks = useTable<CookRun>('cook_runs')
  const practice = usePractice()
  const recs = useMemo(() => allRecords(lots, losses, harvests, pins), [lots, losses, harvests, pins])
  const fading = useMemo(() => fadingStrains(strains, recs, practice.yieldDropPct), [strains, recs, practice.yieldDropPct])
  return { lots, losses, harvests, pins, trials, strains, cooks, recs, fading, practice }
}
export type Recs = ReturnType<typeof useRecords>
