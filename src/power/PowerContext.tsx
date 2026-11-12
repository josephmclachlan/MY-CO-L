import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  allCircuits,
  BASE,
  EMERG,
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

export interface Saved {
  on: string[]
  heater: HeaterOption
  source: Source
  fuel: Fuel
  /** Running watts of Joseph's XP17500HX on the chosen fuel. Always set from GENERATOR, never typed. */
  genW: number
  overrides: Record<string, number>
  scenario: string | null
}

const KEY = 'mycol.power.v1'

/** What goes on when the source switches to the generator: the one-cord plan. */
const GEN_PLAN = [...EMERG, 'c78', 'c910']

const DEFAULTS: Saved = {
  on: [...BASE],
  heater: '2x4500', // Joseph chose option A (2 x 4,500 W), 6 Nov 2026; option B kept for comparison
  source: 'utility',
  fuel: 'propane',
  genW: GENERATOR.running.propane,
  overrides: {},
  scenario: 'base',
}

function load(): Saved {
  try {
    return migrateSaved(localStorage.getItem(KEY))
  } catch {
    return structuredClone(DEFAULTS)
  }
}

/** Read a saved board, bringing an old one up to the one-box map and the XP17500HX. Bad data gives the defaults. */
export function migrateSaved(raw: string | null): Saved {
  try {
    if (!raw) return structuredClone(DEFAULTS)
    const saved = { ...structuredClone(DEFAULTS), ...(JSON.parse(raw) as Partial<Saved> & { preset?: string }) }
    delete (saved as { preset?: string }).preset
    if (saved.fuel !== 'propane' && saved.fuel !== 'gasoline') saved.fuel = 'propane'
    if (saved.heater !== '2x4500' && saved.heater !== '6500') saved.heater = DEFAULTS.heater
    // The generator is the owned XP17500HX: its watts come from the fuel, not from an old slider value.
    saved.genW = GENERATOR.running[saved.fuel]
    if (saved.source !== 'utility' && saved.source !== 'generator') saved.source = 'utility'
    // A board saved before it matched the real box (the S1-S18 sub-panel map) used some of the same ids
    // for different breakers, so it can't be trusted: start again from its preset, or baseline / the generator plan.
    const valid = new Set(allCircuits(saved.heater).map((c) => c.id))
    const list = Array.isArray(saved.on) ? saved.on : []
    if (list.some((i) => !valid.has(i))) {
      const sc = SCENARIOS.find((x) => x.key === saved.scenario && x.source === saved.source && (!x.only || x.only === saved.heater))
      saved.on = sc ? scenarioIds(sc, saved.heater) : saved.source === 'utility' ? [...BASE] : [...GEN_PLAN]
      saved.scenario = sc ? sc.key : saved.source === 'utility' ? 'base' : 'g12s'
    } else saved.on = list
    if (saved.scenario && !SCENARIOS.some((x) => x.key === saved.scenario)) saved.scenario = null
    if (!saved.overrides || typeof saved.overrides !== 'object') saved.overrides = {}
    return saved
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
    // Switching source resets to baseline, or on generator to the plan: emergency list + both incubation 12ks.
    setState((s) => (s.source === src ? s : { ...s, source: src, on: src === 'utility' ? [...BASE] : [...GEN_PLAN], scenario: src === 'utility' ? 'base' : 'g12s' }))
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
    setState((s) => ({ ...s, fuel: f, genW: GENERATOR.running[f] }))
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
      applyScenario,
      setOverride,
      selectedRoom,
      setSelectedRoom,
      selectedCircuit,
      setSelectedCircuit,
    }),
    [state, on, config, reading, warns, peak, toggle, setSource, setHeater, setFuel, applyScenario, setOverride, selectedRoom, selectedCircuit],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePower(): PowerCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePower must be used inside PowerProvider')
  return c
}
