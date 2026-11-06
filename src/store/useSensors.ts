import { useMemo } from 'react'
import { useStore, useTable } from './StoreContext'
import { useNow } from './useFacility'
import type { SettingsRow } from './useRates'
import type { PowerCut } from '../lib/facility'
import {
  PLACE_IDS,
  SENSORS_ID,
  alarms,
  indexReadings,
  lastBySensor,
  mergeSensorSettings,
  placeNow,
  type AcCheck,
  type Reading,
  type Sensor,
  type SensorSettings,
} from '../lib/sensors'
import { saveSensorSettings } from '../lib/sensorActions'

export function useSensorSettings(): SensorSettings {
  const rows = useTable<SettingsRow>('app_settings')
  const row = rows.find((r) => r.id === SENSORS_ID)
  return useMemo(() => mergeSensorSettings(row?.value), [row])
}

export function useSensorEditor(): [SensorSettings, (patch: Partial<SensorSettings>, label: string) => Promise<void>] {
  const store = useStore()
  const s = useSensorSettings()
  return [s, async (patch, label) => void (await store.action(label, () => saveSensorSettings(store, s, patch)))]
}

/** Every table CLIMATE reads, and what is worked out from them. */
export function useSensors() {
  const readings = useTable<Reading>('sensor_readings')
  const sensors = useTable<Sensor>('sensors')
  const ac = useTable<AcCheck>('ac_log')
  const cuts = useTable<PowerCut>('power_cuts')
  const settings = useSensorSettings()
  const now = useNow(60000)
  const idx = useMemo(() => indexReadings(readings), [readings])
  const lastSeen = useMemo(() => lastBySensor(idx), [idx])
  const openCut = useMemo(() => cuts.find((c) => c.kind === 'cut' && c.up_at === null) ?? null, [cuts])
  const board = useMemo(() => PLACE_IDS.map((p) => placeNow(idx, p, settings, now)), [idx, settings, now])
  const list = useMemo(() => alarms({ idx, sensors, ac, settings, now, openCut, lastSeen }), [idx, sensors, ac, settings, now, openCut, lastSeen])
  return { readings, sensors, ac, settings, now, idx, lastSeen, board, alarms: list, openCut }
}
export type SensorData = ReturnType<typeof useSensors>
