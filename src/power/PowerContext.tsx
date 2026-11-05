import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BASE,
  EMERG,
  GEN_MAX_W,
  GEN_MIN_W,
  GEN_PRESETS,
  GENERATOR,
  LINKED,
  SCENARIOS,
  scenarioIds,
  type Fuel,
  type HeaterOption,
  type RoomId,
  type Source,
} from '../data/power'
import { compute, peakState, warnings, type PeakState, type PowerConfig, type Reading, type Warning } from '../lib/power'

// The breaker board is shared by VITALS and DECK PLAN, so flipping a breaker on
// one screen shows on the other. It's saved on this device.

interface Saved {
  on: string[]
  heater: HeaterOption
  source: Source
  fuel: Fuel
  genW: number
  preset: string // preset id or 'custom'
  overrides: Record<string, number>
  scenario: string | null
}

const KEY = 'mycol.power.v1'

const DEFAULTS: Saved = {
  on: [...BASE],
  heater: '2x4500', // Joseph's planner opens on this; the choice is still open
  source: 'utility',
  fuel: 'propane',
  genW: GENERATOR.running.propane,
  preset: 'duromax',
  overrides: {},
  scenario: 'base',
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULTS)
    return { ...structuredClone(DEFAULTS), ...(JSON.parse(raw) as Partial<Saved>) }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

interface PowerCtx {
  state: Saved
  on: Set<string>
  config: PowerConfig
  reading: Reading
  warns: Warning[]
  peak: PeakState
  toggle: (id: string) => string[]
  setSource: (s: Source) => void
  setHeater: (h: HeaterOption) => void
  setFuel: (f: Fuel) => void
  setGenW: (w: number, preset?: string) => void
  applyScenario: (key: string) => void
  setOverride: (itemId: string, w: number | null) => void
  selectedRoom: RoomId
  setSelectedRoom: (r: RoomId) => void
  selectedCircuit: string | null
  setSelectedCircuit: (id: string | null) => void
}

const Ctx = createContext<PowerCtx | null>(null)

function usePeakClock(): PeakState {
  const [p, setP] = useState(() => peakState(new Date()))
  useEffect(() => {
    const t = window.setInterval(() => setP(peakState(new Date())), 20000)
    return () => window.clearInterval(t)
  }, [])
  return p
}

export function PowerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Saved>(load)
  const [selectedRoom, setSelectedRoom] = useState<RoomId>('fruiting')
  const [selectedCircuit, setSelectedCircuit] = useState<string | null>(null)
  const peak = usePeakClock()

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Private windows can block storage; the board still works, it just forgets.
    }
  }, [state])

  const on = useMemo(() => new Set(state.on), [state.on])
  const config: PowerConfig = useMemo(
    () => ({ heater: state.heater, source: state.source, fuel: state.fuel, genW: state.genW, overrides: state.overrides }),
    [state.heater, state.source, state.fuel, state.genW, state.overrides],
  )
  const reading = useMemo(() => compute(on, config), [on, config])
  const warns = useMemo(() => warnings(on, config, reading, peak), [on, config, reading, peak])

  /** Flip a breaker (and its linked partner). Returns the ids that changed. */
  const toggle = useCallback(
    (id: string) => {
      const ids = [id, ...(LINKED[id] ? [LINKED[id]] : [])]
      setState((s) => {
        const set = new Set(s.on)
        const next = !set.has(id)
        for (const i of ids) {
          if (next) set.add(i)
          else set.delete(i)
        }
        return { ...s, on: [...set], scenario: null }
      })
      return ids
    },
    [],
  )

  const applyScenario = useCallback((key: string) => {
    setState((s) => {
      const sc = SCENARIOS.find((x) => x.key === key)
      if (!sc) return s
      return { ...s, source: sc.source, on: scenarioIds(sc, s.heater), scenario: key }
    })
  }, [])

  const setSource = useCallback((src: Source) => {
    // Like the planner: switching source resets to baseline or the emergency list.
    setState((s) => (s.source === src ? s : { ...s, source: src, on: src === 'utility' ? [...BASE] : [...EMERG], scenario: src === 'utility' ? 'base' : 'emerg' }))
  }, [])

  const setHeater = useCallback((h: HeaterOption) => {
    setState((s) => {
      let next = s.on
      if (h === '6500') next = next.filter((i) => i !== 'c12b')
      // Re-run the active preset so it means the same thing with the new heater.
      const sc = s.scenario ? SCENARIOS.find((x) => x.key === s.scenario) : null
      if (sc && (!sc.only || sc.only === h)) next = scenarioIds(sc, h)
      return { ...s, heater: h, on: next, scenario: sc && (!sc.only || sc.only === h) ? s.scenario : null }
    })
  }, [])

  const setFuel = useCallback((f: Fuel) => {
    setState((s) => {
      const p = GEN_PRESETS.find((x) => x.id === s.preset)
      return { ...s, fuel: f, genW: p ? p[f] : s.genW }
    })
  }, [])

  const setGenW = useCallback((w: number, preset?: string) => {
    const clamped = Math.max(GEN_MIN_W, Math.min(GEN_MAX_W, Math.round(w)))
    setState((s) => {
      const match = preset ?? GEN_PRESETS.find((p) => p[s.fuel] === clamped)?.id ?? 'custom'
      return { ...s, genW: clamped, preset: match }
    })
  }, [])

  const setOverride = useCallback((itemId: string, w: number | null) => {
    setState((s) => {
      const o = { ...s.overrides }
      if (w === null || !Number.isFinite(w)) delete o[itemId]
      else o[itemId] = Math.max(0, w)
      return { ...s, overrides: o }
    })
  }, [])

  const value = useMemo(
    () => ({
      state,
      on,
      config,
      reading,
      warns,
      peak,
      toggle,
      setSource,
      setHeater,
      setFuel,
      setGenW,
      applyScenario,
      setOverride,
      selectedRoom,
      setSelectedRoom,
      selectedCircuit,
      setSelectedCircuit,
    }),
    [state, on, config, reading, warns, peak, toggle, setSource, setHeater, setFuel, setGenW, applyScenario, setOverride, selectedRoom, selectedCircuit],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePower(): PowerCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePower must be used inside PowerProvider')
  return c
}
