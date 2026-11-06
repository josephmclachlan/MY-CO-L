import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useStore } from './StoreContext'
import { useRole } from '../settings/RoleContext'
import { buildIndex, type Doc } from '../lib/search'

/** Every table SEARCH reads. */
export const INDEX_TABLES = [
  'strains', 'cultures', 'grain_runs', 'block_lots', 'harvests', 'items', 'cook_runs', 'hazard_logs', 'strain_trials',
  'power_cuts', 'water_tests', 'maint_items', 'clean_log', 'checklist_runs', 'reminders', 'sensors',
  'sales', 'standing_orders', 'cash_moves', 'waste_log', 'energy_bills', 'labour_entries',
] as const

/** The search index: one document per record, rebuilt when the data changes. */
export function useSearchIndex(): { docs: Doc[]; ready: boolean } {
  const store = useStore()
  const { role } = useRole()
  const v = useSyncExternalStore(store.subscribe, store.version)
  useEffect(() => {
    for (const t of INDEX_TABLES) void store.ensure(t)
  }, [store])
  const docs = useMemo(() => buildIndex({ rows: (t) => store.rows(t), role }), [store, role, v]) // eslint-disable-line react-hooks/exhaustive-deps
  return { docs, ready: true }
}
