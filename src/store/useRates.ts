import { useMemo } from 'react'
import { useStore, useTable } from './StoreContext'
import { DEFAULT_RATES, RATES_ID, mergeRates, rates, setLiveRates, type Rates } from '../lib/rates'
import type { Row, Store } from '../lib/store'

export interface SettingsRow extends Row {
  value: unknown
  updated_at?: string
}

/** Settings that lived on the device before PRICES + COSTS: carried over until the first save. */
function deviceDefaults(): Rates {
  try {
    const l = JSON.parse(localStorage.getItem('mycol.ledger.v1') ?? '{}') as Record<string, unknown>
    const c = JSON.parse(localStorage.getItem('mycol.cargo.v1') ?? '{}') as Record<string, unknown>
    return mergeRates({ fx: c.fx, labourOn: l.labourOn, labourRate: l.rate, wearOn: l.wearOn, wearPerBlock: l.wearPerBlock })
  } catch {
    return DEFAULT_RATES
  }
}

/** The saved prices and costs, merged over the defaults. Also updates the copy the maths reads. */
export function useRates(): Rates {
  const rows = useTable<SettingsRow>('app_settings')
  const row = rows.find((r) => r.id === RATES_ID)
  const r = useMemo(() => (row ? mergeRates(row.value) : deviceDefaults()), [row])
  if (rates() !== r) setLiveRates(r)
  return r
}

/** Save a change. Everything not in the patch keeps its current value. */
export async function saveRates(store: Store, current: Rates, patch: Partial<Rates>): Promise<void> {
  const next = { ...current, ...patch }
  await store.put('app_settings', { id: RATES_ID, value: next, updated_at: new Date().toISOString() })
}

/** [rates, save]: save takes a patch and reports back in plain words. */
export function useRatesEditor(): [Rates, (patch: Partial<Rates>) => Promise<void>] {
  const store = useStore()
  const r = useRates()
  return [r, (patch) => saveRates(store, r, patch)]
}
