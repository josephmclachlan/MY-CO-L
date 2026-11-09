import { useMemo } from 'react'
import { useStore, useTable } from './StoreContext'
import { PRACTICE_ID, mergePractice, type Practice } from '../lib/bank'
import { savePractice } from '../lib/bankActions'
import { liveFlushPlan, setLiveFlushPlan } from '../lib/mission'
import type { SettingsRow } from './useRates'

/** The farm's practice defaults (contamination target, spare blocks, bank rules), merged over the defaults. */
export function usePractice(): Practice {
  const rows = useTable<SettingsRow>('app_settings')
  const row = rows.find((r) => r.id === PRACTICE_ID)
  const p = useMemo(() => mergePractice(row?.value), [row])
  // The committed flush counts feed every expected-figure function (like rates()).
  if (liveFlushPlan() !== p.flushPlan) setLiveFlushPlan(p.flushPlan)
  return p
}

/** [practice, save]: save takes a patch; one UNDO step per save. */
export function usePracticeEditor(): [Practice, (patch: Partial<Practice>, label: string) => Promise<void>] {
  const store = useStore()
  const p = usePractice()
  return [p, async (patch, label) => void (await store.action(label, () => savePractice(store, p, patch)))]
}
