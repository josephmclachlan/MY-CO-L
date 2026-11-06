import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './settings/AppContext'
import { THEMES, type ThemeName } from './settings/settings'
import { Crt } from './components/Crt'
import { Shell, type FKey } from './components/Shell'
import { TypeText } from './components/TypeText'
import { useKeyNav } from './components/KeyNav'
import { Boot } from './screens/Boot'
import { Menu } from './screens/Menu'
import { Tuning } from './screens/Tuning'
import { Pending } from './screens/Pending'
import { Help } from './screens/Help'
import { Login } from './screens/Login'
import { MODULES, STATION } from './data/farm'
import { Vitals, VitalsIndex } from './screens/Vitals'
import { DeckPlan, DeckIndex } from './screens/DeckPlan'
import { Specimen, SpecimenIndex, type Tab, TABS } from './screens/Specimen'
import { Sequence } from './screens/Sequence'
import { Cargo, CargoIndex } from './screens/Cargo'
import { Xeno, XenoIndex, XENO_TABS, type XenoState } from './screens/Xeno'
import { Hazard, HazardIndex, HAZARD_START, HAZARD_TABS, type HazardState } from './screens/Hazard'
import { Propulsion, CookIndex, COOK_START, COOK_TABS, type CookState } from './screens/Propulsion'
import { Ledger, LedgerIndex, LEDGER_START, type LedgerState } from './screens/Ledger'
import { Trade, TradeIndex, TRADE_START, TRADE_TABS, type TradeState } from './screens/Trade'
import { Mission, MissionIndex, MISSION_START, type MissionState } from './screens/Mission'
import { Yield, YieldIndex, YIELD_START, YIELD_TABS, type YieldState } from './screens/Yield'
import { Orders, OrdersIndex, ORDERS_START, ORDERS_TABS, type OrdersState } from './screens/Orders'
import { Money, MoneyIndex, MONEY_START, MONEY_TABS, type MoneyState } from './screens/Money'
import { History, HistoryIndex, HISTORY_START, HistoryNavContext, SyncLamp, UndoButton, undoneText, type HistoryState } from './screens/History'
import { findHazard } from './lib/hazard'
import { keyFromHash, type Strain } from './lib/xeno'
import { cartFromHash } from './lib/scan'
import { useStore, useStoreStatus, useTable } from './store/StoreContext'
import { useRates } from './store/useRates'
import { useFxSync } from './store/useFx'
import { SPECIES } from './data/species'
import { usePower } from './power/PowerContext'
import { allCircuits, type RoomId } from './data/power'
import { ROOMS } from './data/rooms'
import { dbLinked, supabase } from './lib/supabase'
import { Manual } from './manual/Manual'
import { SourcePopup } from './manual/SourcePopup'
import { ManualLinksContext } from './manual/ManualLinks'
import { MANUAL_ON } from './manual/load'
import type { ManualLoc } from './manual/types'

type Stage = 'power' | 'boot' | 'login' | 'shell'
type View = { name: 'menu' } | { name: 'tune' } | { name: 'help' } | { name: 'status' } | { name: 'login' } | { name: 'module'; idx: number }

const VITALS_IDX = MODULES.findIndex((m) => m.key === 'VITALS')
const DECK_IDX = MODULES.findIndex((m) => m.key === 'DECK')
const SPEC_IDX = MODULES.findIndex((m) => m.key === 'SPECIMEN')
const SEQ_IDX = MODULES.findIndex((m) => m.key === 'SEQUENCE')
const CARGO_IDX = MODULES.findIndex((m) => m.key === 'CARGO')
const MANUAL_IDX = MODULES.findIndex((m) => m.key === 'MANUAL')
const XENO_IDX = MODULES.findIndex((m) => m.key === 'XENO')
const HAZARD_IDX = MODULES.findIndex((m) => m.key === 'HAZARD')
const COOK_IDX = MODULES.findIndex((m) => m.key === 'PROPULSION')
const LEDGER_IDX = MODULES.findIndex((m) => m.key === 'LEDGER')
const TRADE_IDX = MODULES.findIndex((m) => m.key === 'TRADE')
const MISSION_IDX = MODULES.findIndex((m) => m.key === 'MISSION')
const HISTORY_IDX = MODULES.findIndex((m) => m.key === 'HISTORY')
const YIELD_IDX = MODULES.findIndex((m) => m.key === 'YIELD')
const ORDERS_IDX = MODULES.findIndex((m) => m.key === 'ORDERS')
const MONEY_IDX = MODULES.findIndex((m) => m.key === 'MONEY')

/** Everything needed to put the terminal back on a screen: Back restores one of these. */
interface Snap {
  view: View
  selected: number
  specimen: number
  specTab: Tab
  room: RoomId
  manualLoc: ManualLoc | null
  xeno: XenoState
  hazard: HazardState
  cook: CookState
  ledger: LedgerState
  trade: TradeState
  mission: MissionState
  hist: HistoryState
  yld: YieldState
  ord: OrdersState
  money: MoneyState
}
const sameSpot = (a: Snap, b: View) => a.view.name === b.name && ('idx' in a.view ? a.view.idx : -1) === ('idx' in b ? b.idx : -1)

const TITLES: Record<View['name'], string> = {
  menu: 'MAIN MENU',
  tune: 'TUNING',
  help: 'HELP',
  status: 'SYSTEM STATUS',
  login: 'IDENTIFY',
  module: '',
}

export default function App() {
  const { settings, update, sound, session } = useApp()
  const power = usePower()
  const storeInfo = useStoreStatus()
  const [stage, setStage] = useState<Stage>('power')
  const [view, setView] = useState<View>({ name: 'menu' })
  const [firstMenu, setFirstMenu] = useState(true)
  const [selected, setSelected] = useState(0)
  const [specimen, setSpecimen] = useState(0)
  const [specTab, setSpecTab] = useState<Tab>('OVERVIEW')
  const [sweep, setSweep] = useState(0)
  const [alert, setAlert] = useState(false)
  const [reply, setReply] = useState<{ text: string; warn?: boolean; id: number } | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const [manualLoc, setManualLoc] = useState<ManualLoc | null>(null)
  const [popupRef, setPopupRef] = useState<string | null>(null)
  const [xeno, setXenoState] = useState<XenoState>({ tab: 'STRAINS', strain: null, node: null })
  const setXeno = useCallback((p: Partial<XenoState>) => setXenoState((x) => ({ ...x, ...p })), [])
  const [hazard, setHazardState] = useState<HazardState>(HAZARD_START)
  const setHazard = useCallback((p: Partial<HazardState>) => setHazardState((h) => ({ ...h, ...p })), [])
  const [cook, setCookState] = useState<CookState>(COOK_START)
  const setCook = useCallback((p: Partial<CookState>) => setCookState((c) => ({ ...c, ...p })), [])
  const [ledger, setLedgerState] = useState<LedgerState>(LEDGER_START)
  const setLedger = useCallback((p: Partial<LedgerState>) => setLedgerState((c) => ({ ...c, ...p })), [])
  const [trade, setTradeState] = useState<TradeState>(TRADE_START)
  const setTrade = useCallback((p: Partial<TradeState>) => setTradeState((c) => ({ ...c, ...p })), [])
  const [mission, setMissionState] = useState<MissionState>(MISSION_START)
  const setMission = useCallback((p: Partial<MissionState>) => setMissionState((c) => ({ ...c, ...p })), [])
  const [hist, setHistState] = useState<HistoryState>(HISTORY_START)
  const setHist = useCallback((p: Partial<HistoryState>) => setHistState((c) => ({ ...c, ...p })), [])
  const [yld, setYldState] = useState<YieldState>(YIELD_START)
  const setYld = useCallback((p: Partial<YieldState>) => setYldState((c) => ({ ...c, ...p })), [])
  const [ord, setOrdState] = useState<OrdersState>(ORDERS_START)
  const setOrd = useCallback((p: Partial<OrdersState>) => setOrdState((c) => ({ ...c, ...p })), [])
  const [money, setMoneyState] = useState<MoneyState>(MONEY_START)
  const setMoney = useCallback((p: Partial<MoneyState>) => setMoneyState((c) => ({ ...c, ...p })), [])
  const store = useStore()
  const strains = useTable<Strain>('strains')
  useFxSync() // today's colones per dollar, once a day when online
  useRates() // keeps the prices and costs from PRICES + COSTS live for every screen's maths
  // Back button: the screens you came from, newest last.
  const history = useRef<Snap[]>([])
  const [histLen, setHistLen] = useState(0)
  const snapNow: Snap = { view, selected, specimen, specTab, room: power.selectedRoom, manualLoc, xeno, hazard, cook, ledger, trade, mission, hist, yld, ord, money }
  const snapRef = useRef(snapNow)
  snapRef.current = snapNow
  const alertTimer = useRef<number | null>(null)
  const energising = useRef(false)

  // ---------- navigation ----------

  const pushHist = useCallback(() => {
    history.current.push(snapRef.current)
    if (history.current.length > 60) history.current.shift()
    setHistLen(history.current.length)
  }, [])

  const go = useCallback(
    (v: View, record = true) => {
      if (record && !sameSpot(snapRef.current, v)) pushHist()
      setView(v)
      setSweep((n) => n + 1)
      setFocusToken((n) => n + 1)
      sound.chirp()
      if (v.name !== 'menu') setFirstMenu(false)
    },
    [sound, pushHist],
  )

  const goBack = useCallback(() => {
    const s = history.current.pop()
    setHistLen(history.current.length)
    if (!s) return
    setView(s.view)
    setSelected(s.selected)
    setSpecimen(s.specimen)
    setSpecTab(s.specTab)
    setManualLoc(s.manualLoc ? { ...s.manualLoc, n: Date.now() } : null)
    setXenoState(s.xeno)
    setHazardState(s.hazard)
    setCookState(s.cook)
    setLedgerState(s.ledger)
    setTradeState(s.trade)
    setMissionState(s.mission)
    setHistState(s.hist)
    setYldState(s.yld)
    setOrdState(s.ord)
    setMoneyState(s.money)
    power.setSelectedRoom(s.room)
    setReply(null)
    setSweep((n) => n + 1)
    setFocusToken((n) => n + 1)
    sound.chirp()
    if (s.view.name !== 'menu') setFirstMenu(false)
  }, [power, sound])

  /** Open the manual at a place. A new chapter or link is a Back step; a jump within the page is not. */
  const openManual = useCallback(
    (loc: Omit<ManualLoc, 'n'>, push = true) => {
      const here = snapRef.current
      const inManual = here.view.name === 'module' && here.view.idx === MANUAL_IDX
      if (push || !inManual) pushHist()
      setManualLoc({ ...loc, n: Date.now() })
      setSelected(MANUAL_IDX)
      if (!inManual) {
        setView({ name: 'module', idx: MANUAL_IDX })
        setSweep((n) => n + 1)
        setFocusToken((n) => n + 1)
        setFirstMenu(false)
      }
    },
    [pushHist],
  )

  const links = useMemo(
    () => ({ locked: !MANUAL_ON, openSource: (ref: string) => setPopupRef(ref) }),
    [],
  )

  const say = useCallback((text: string, warn?: boolean) => setReply({ text, warn, id: Date.now() }), [])

  const openXeno = (p: Partial<XenoState>) => {
    const here = view.name === 'module' && view.idx === XENO_IDX
    if (!here) pushHist()
    setXeno(p)
    setSelected(XENO_IDX)
    if (!here) go({ name: 'module', idx: XENO_IDX }, false)
    else sound.chirp()
  }
  const openHazard = (p: Partial<HazardState>) => {
    const here = view.name === 'module' && view.idx === HAZARD_IDX
    if (!here) pushHist()
    setHazard({ mode: 'file', ...p })
    setSelected(HAZARD_IDX)
    if (!here) go({ name: 'module', idx: HAZARD_IDX }, false)
    else sound.chirp()
  }
  const openCook = (p: Partial<CookState>) => {
    const here = view.name === 'module' && view.idx === COOK_IDX
    if (!here) pushHist()
    setCook(p)
    setSelected(COOK_IDX)
    if (!here) go({ name: 'module', idx: COOK_IDX }, false)
    else sound.chirp()
  }
  const openLedger = (p: Partial<LedgerState>) => {
    const here = view.name === 'module' && view.idx === LEDGER_IDX
    if (!here) pushHist()
    setLedger(p)
    setSelected(LEDGER_IDX)
    if (!here) go({ name: 'module', idx: LEDGER_IDX }, false)
    else sound.chirp()
  }
  const openTrade = (p: Partial<TradeState>) => {
    const here = view.name === 'module' && view.idx === TRADE_IDX
    if (!here) pushHist()
    setTrade(p)
    setSelected(TRADE_IDX)
    if (!here) go({ name: 'module', idx: TRADE_IDX }, false)
    else sound.chirp()
  }
  const openMission = (p: Partial<MissionState>) => {
    const here = view.name === 'module' && view.idx === MISSION_IDX
    if (!here) pushHist()
    setMission(p)
    setSelected(MISSION_IDX)
    if (!here) go({ name: 'module', idx: MISSION_IDX }, false)
    else sound.chirp()
  }
  const openYield = (p: Partial<YieldState>) => {
    const here = view.name === 'module' && view.idx === YIELD_IDX
    if (!here) pushHist()
    setYld(p)
    setSelected(YIELD_IDX)
    if (!here) go({ name: 'module', idx: YIELD_IDX }, false)
    else sound.chirp()
  }
  const openOrders = (p: Partial<OrdersState>) => {
    const here = view.name === 'module' && view.idx === ORDERS_IDX
    if (!here) pushHist()
    setOrd(p)
    setSelected(ORDERS_IDX)
    if (!here) go({ name: 'module', idx: ORDERS_IDX }, false)
    else sound.chirp()
  }
  const openMoney = (p: Partial<MoneyState>) => {
    const here = view.name === 'module' && view.idx === MONEY_IDX
    if (!here) pushHist()
    setMoney(p)
    setSelected(MONEY_IDX)
    if (!here) go({ name: 'module', idx: MONEY_IDX }, false)
    else sound.chirp()
  }
  const openHistory = (p: Partial<HistoryState>) => {
    const here = view.name === 'module' && view.idx === HISTORY_IDX
    if (!here) pushHist()
    setHist(p)
    setSelected(HISTORY_IDX)
    if (!here) go({ name: 'module', idx: HISTORY_IDX }, false)
    else sound.chirp()
  }
  const openHistoryRef = useRef(openHistory)
  openHistoryRef.current = openHistory
  // Opening one record's history is always a Back step, so BACK returns to the list or screen it came from.
  const openRecordHistory = useCallback(
    (table: string, id: string) => {
      if (snapRef.current.view.name === 'module' && snapRef.current.view.idx === HISTORY_IDX) pushHist()
      openHistoryRef.current({ tab: 'RECORD', rec: { table, id } })
    },
    [pushHist],
  )
  const undoNow = useCallback(() => {
    void store.undo().then(
      (l) => {
        sound.chirp()
        say(undoneText(store, l), !l)
      },
      (e: Error) => say(e.message.toUpperCase(), true),
    )
  }, [store, sound, say])
  const openSpecies = (key: string) => {
    const i = SPECIES.findIndex((x) => x.id === key)
    if (i < 0) return
    setSpecimen(i)
    setSpecTab('OVERVIEW')
    setSelected(SPEC_IDX)
    go({ name: 'module', idx: SPEC_IDX })
  }

  const enterShell = useCallback(() => {
    setStage('shell')
    // A scanned label opens straight onto its record: #xeno/c/<id>.
    const key = keyFromHash(window.location.hash)
    const cart = cartFromHash(window.location.hash)
    if (cart) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setMissionState((m) => ({ ...m, tab: 'SCAN', scan: `#cart/${cart}` }))
      setSelected(MISSION_IDX)
      setView({ name: 'module', idx: MISSION_IDX })
      setFirstMenu(false)
    } else if (key) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setXenoState({ tab: 'LINEAGE', strain: null, node: key })
      setSelected(XENO_IDX)
      setView({ name: 'module', idx: XENO_IDX })
      setFirstMenu(false)
    } else setView({ name: 'menu' })
    // Confirm beep the moment the main menu appears.
    sound.confirm()
  }, [sound])

  const bootDone = useCallback(() => {
    update((s) => ({ ...s, bootSeen: true }))
    if (supabase && !session && navigator.onLine) setStage('login')
    else enterShell()
  }, [update, session, enterShell])

  const replayBoot = useCallback(() => {
    setFirstMenu(true)
    setReply(null)
    setStage('boot')
  }, [])

  const toggleAlarm = useCallback(() => {
    if (alertTimer.current) window.clearTimeout(alertTimer.current)
    setAlert(true)
    sound.alarm(true)
    alertTimer.current = window.setTimeout(() => {
      setAlert(false)
      sound.alarm(false)
    }, 3000)
  }, [sound])
  useEffect(() => () => sound.alarm(false), [sound])

  const cycleTheme = () => {
    const i = THEMES.indexOf(settings.look.theme)
    const next = THEMES[(i + 1) % THEMES.length]
    update((s) => ({ ...s, look: { ...s.look, theme: next } }))
    sound.chirp()
    say(`THEME ${next}`)
  }
  const toggleSound = () => {
    const on = !settings.sound.enabled
    update((s) => ({ ...s, sound: { ...s.sound, enabled: on } }))
    say(on ? 'SOUND ON' : 'SOUND MUTED')
  }
  const toggleClean = () => {
    const on = !settings.look.clean
    update((s) => ({ ...s, look: { ...s.look, clean: on } }))
    say(on ? 'CLEAN MODE ON' : 'CLEAN MODE OFF')
  }
  const logout = async () => {
    if (!supabase) return say('DATABASE NOT LINKED. LOCAL MODE.', true)
    await supabase.auth.signOut()
    say('LOGGED OUT')
  }

  const onKey = (f: number) => {
    switch (f) {
      case 1:
        return go({ name: 'help' })
      case 2:
        return go({ name: 'menu' })
      case 3:
        return go({ name: 'tune' })
      case 4:
        return toggleSound()
      case 5:
        return cycleTheme()
      case 6:
        return toggleClean()
      case 7:
        return replayBoot()
      case 8:
        return session ? void logout() : go({ name: 'login' })
    }
  }

  // F1-F8 on a real keyboard. The browser's own F-key actions are blocked while the terminal is open.
  useEffect(() => {
    if (stage !== 'shell') return
    const h = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        return goBack()
      }
      // Ctrl+Z / Cmd+Z = UNDO the last saved change. Inside a text box it stays the box's own undo.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        const t = e.target as HTMLElement | null
        const typing = !!t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !(t as HTMLInputElement).closest('.prompt')) || t.isContentEditable)
        const promptHasText = !!t && t.tagName === 'INPUT' && !!(t as HTMLInputElement).value
        if (typing || promptHasText) return
        e.preventDefault()
        return undoNow()
      }
      const m = /^F([1-8])$/.exec(e.key)
      if (!m) return
      e.preventDefault()
      onKey(Number(m[1]))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  // Arrows, Enter, [ ], page keys, Backspace / Esc = BACK on every screen.
  useKeyNav({
    enabled: stage === 'shell',
    onBack: () => {
      if (!history.current.length) return false
      goBack()
      return true
    },
  })

  // ---------- commands ----------

  const onCommand = (raw: string) => {
    const [cmd, ...rest] = raw.trim().toUpperCase().split(/\s+/)
    const arg = rest.join(' ')
    const num = Number(cmd)
    const byNum = Number.isInteger(num) ? MODULES.findIndex((m) => m.num === num) : -1
    if (byNum >= 0) {
      setSelected(byNum)
      return go({ name: 'module', idx: byNum })
    }
    // Undo, edit history and sync.
    if (cmd === 'UNDO') return undoNow()
    if (['HISTORY', 'EDITS', 'CHANGES', 'LOG'].includes(cmd)) return openHistory({ tab: 'EDITS' })
    if (['SYNC', 'OFFLINE', 'CONFLICTS'].includes(cmd)) return openHistory({ tab: 'SYNC' })
    const mod = MODULES.findIndex((m) => m.key === cmd || m.name === raw.trim().toUpperCase() || m.name.startsWith(cmd + ' '))
    if (mod >= 0) {
      setSelected(mod)
      return go({ name: 'module', idx: mod })
    }
    // Species: type a name (BLUE, LION, SHIITAKE) or a tab (CLIMATE, YIELD) while on SPECIMEN FILES.
    const spIdx = SPECIES.findIndex((x) => x.id === raw.trim().toLowerCase().replace(/[^a-z]+/g, '-') || x.name === raw.trim().toUpperCase() || x.name.split(' ')[0] === cmd.replace("'", '') || x.name.replace("'", '').split(' ')[0] === cmd)
    if (spIdx >= 0 && cmd.length > 2) {
      setSpecimen(spIdx)
      setSelected(SPEC_IDX)
      if (!(view.name === 'module' && view.idx === SPEC_IDX)) go({ name: 'module', idx: SPEC_IDX })
      else sound.chirp()
      return
    }
    const tabHit = TABS.find((t) => t === cmd)
    if (tabHit && view.name === 'module' && view.idx === SPEC_IDX) {
      setSpecTab(tabHit)
      return sound.chirp()
    }
    // Genetics: type a strain code (LM-01) or, on XENOGENETICS, a tab name (LINEAGE).
    const strainHit = strains.find((x) => x.code.toUpperCase() === raw.trim().toUpperCase())
    if (strainHit) return openXeno({ strain: strainHit.id, node: null, tab: xeno.tab === 'STRAINS' ? 'LINEAGE' : xeno.tab })
    const xTab = XENO_TABS.find((t) => t === cmd)
    if (xTab && view.name === 'module' && view.idx === XENO_IDX) {
      setXeno({ tab: xTab })
      return sound.chirp()
    }
    if (cmd === 'GENETICS' || cmd === 'LAB' || cmd === 'STRAINS' || cmd === 'LABELS') return openXeno(cmd === 'LABELS' ? { tab: 'LABELS' } : cmd === 'STRAINS' ? { tab: 'STRAINS' } : {})
    if (cmd === 'BANK' || cmd === 'CULTURE BANK' || cmd === 'SLANTS' || cmd === 'TUBES') return openXeno({ tab: 'BANK' })
    // Contaminants: type a name (TRICHODERMA, BLOTCH), DIAGNOSE, or on the HAZARD INDEX a tab name (CAUSE).
    const hzTab = HAZARD_TABS.find((t) => t === cmd)
    if (hzTab && view.name === 'module' && view.idx === HAZARD_IDX) {
      setHazard({ tab: hzTab })
      return sound.chirp()
    }
    if (['HAZARDS', 'CONTAM', 'CONTAMINANTS', 'CONTAMINATION', 'PESTS'].includes(cmd)) return openHazard({ id: null })
    if (cmd === 'DIAGNOSE' || cmd === 'DIAGNOSIS') return openHazard({ mode: 'diagnose' })
    const hzHit = findHazard(raw)
    if (hzHit) return openHazard({ id: hzHit.id, tab: 'SPOT' })
    // Cook log: type COOK, STEAM, STERILIZE or 75X to open it, or on the screen a tab name (CURVE, READINGS, SHEET).
    const ckTab = COOK_TABS.find((t) => t === cmd)
    if (ckTab && view.name === 'module' && view.idx === COOK_IDX) {
      setCook({ tab: ckTab })
      return sound.chirp()
    }
    if (['COOK', 'COOKLOG', 'STEAM', 'STERILIZE', 'STERILISE', 'PASTEURIZE', 'PASTEURISE', '75X', 'MEGACHEF', 'MEGACHEFS'].includes(cmd)) return openCook({ sel: null, tab: 'RUN' })
    // Costs and sales: LEDGER, BILLS, LABOUR; TRADE, SALE, TOTALS, BUYERS.
    if (['COST', 'COSTS', 'COGS'].includes(cmd)) return openLedger({ sel: 'overview' })
    if (cmd === 'BILL' || cmd === 'BILLS') return openLedger({ sel: 'bills' })
    if (cmd === 'PRICES' || cmd === 'PRICE' || cmd === 'RATES') return openLedger({ sel: 'settings' })
    if (cmd === 'LABOUR' || cmd === 'LABOR' || cmd === 'HOURS') return openLedger({ sel: 'labour' })
    if (['SALE', 'SALES', 'SELL', 'SOLD'].includes(cmd)) return openTrade({ tab: 'SALE' })
    const trTab = TRADE_TABS.find((t) => t === cmd)
    if (trTab && (trTab === 'TOTALS' || trTab === 'BUYERS' || (view.name === 'module' && view.idx === TRADE_IDX))) return openTrade({ tab: trTab })
    // Lots and harvests: MISSION, BOARD, TODAY, HARVEST, LOT.
    if (['MISSION', 'BOARD', 'LOTS'].includes(cmd)) return openMission({ tab: 'BOARD' })
    if (['TODAY', 'TODO'].includes(cmd)) return openMission({ tab: 'TODAY' })
    if (['HARVEST', 'PICK', 'PICKED'].includes(cmd)) return openMission({ tab: 'HARVEST' })
    if (['LOT', 'NEWLOT', 'KNOCK'].includes(cmd)) return openMission({ tab: 'NEWLOT' })
    if (['BULK', 'BULKS'].includes(cmd)) return openMission({ tab: 'BULK' })
    if (['SCAN', 'QR', 'CART', 'CARTS'].includes(cmd)) return openMission({ tab: 'SCAN' })
    if (['SPLIT'].includes(cmd)) return openMission({ tab: 'BULK', bulk: 'SPLIT' })
    // Production records: YIELD, FLUSH, SCORECARD, TRIAL, FADING.
    if (['YIELD', 'RECORDS', 'FLUSH', 'FLUSHES', 'BE'].includes(cmd)) return openYield({ tab: 'FLUSHES' })
    if (['SCORECARD', 'SCORE', 'FADING'].includes(cmd)) return openYield({ tab: 'SCORECARD' })
    if (['TRIAL', 'TRIALS'].includes(cmd)) return openYield({ tab: 'TRIALS' })
    const yTab = YIELD_TABS.find((t) => t === cmd)
    if (yTab && view.name === 'module' && view.idx === YIELD_IDX) {
      setYld({ tab: yTab })
      return sound.chirp()
    }
    // Standing orders: ORDERS, FORECAST, PICKLIST, PRICELIST.
    if (['ORDERS', 'ORDER', 'STANDING', 'BUYERS'].includes(cmd)) return openOrders({ tab: 'ORDERS' })
    if (['FORECAST', 'EXPECT'].includes(cmd)) return openOrders({ tab: 'FORECAST' })
    if (['PICKLIST', 'PACK', 'PACKLIST', 'DELIVER'].includes(cmd)) return openOrders({ tab: 'PICK' })
    if (['PRICELIST', 'WHATSAPP', 'AVAILABLE', 'OFFER'].includes(cmd)) return openOrders({ tab: 'LIST' })
    const oTab = ORDERS_TABS.find((t) => t === cmd)
    if (oTab && view.name === 'module' && view.idx === ORDERS_IDX) {
      setOrd({ tab: oTab })
      return sound.chirp()
    }
    // Money: OWED, RECEIPT, SPEND, PNL, CASHFLOW, BUDGET, TRENDS, WASTE, TRACE, RECALL, WHATIF.
    if (['MONEY', 'OWED', 'OWES', 'UNPAID', 'DEBT'].includes(cmd)) return openMoney({ tab: 'OWED' })
    if (['RECEIPT', 'RECEIPTS', 'INVOICE', 'INVOICES'].includes(cmd)) return openMoney({ tab: 'RECEIPTS' })
    if (['SPEND', 'SPENT', 'SPENDING', 'EXPENSE', 'EXPENSES'].includes(cmd)) return openMoney({ tab: 'SPEND' })
    if (['PNL', 'P&L', 'PL', 'PROFIT', 'LOSS'].includes(cmd)) return openMoney({ tab: 'PNL' })
    if (['CASH', 'CASHFLOW', 'FLOW'].includes(cmd)) return openMoney({ tab: 'CASH' })
    if (['BUDGET'].includes(cmd)) return openMoney({ tab: 'BUDGET' })
    if (['TRENDS', 'TREND'].includes(cmd)) return openMoney({ tab: 'TRENDS' })
    if (['WASTE', 'SURPLUS', 'DRIED', 'DONATED'].includes(cmd)) return openMoney({ tab: 'WASTE' })
    if (['TRACE', 'RECALL'].includes(cmd)) return openMoney({ tab: 'TRACE' })
    if (['WHATIF', 'WHAT-IF', 'BREAKEVEN', 'BREAK-EVEN'].includes(cmd)) return openMoney({ tab: 'WHATIF' })
    const mTab = MONEY_TABS.find((t) => t === cmd)
    if (mTab && view.name === 'module' && view.idx === MONEY_IDX) {
      setMoney({ tab: mTab })
      return sound.chirp()
    }
    // Power and rooms.
    const openVitals = () => {
      setSelected(VITALS_IDX)
      if (!(view.name === 'module' && view.idx === VITALS_IDX)) go({ name: 'module', idx: VITALS_IDX })
    }
    const openRoom = (r: RoomId) => {
      power.setSelectedRoom(r)
      setSelected(DECK_IDX)
      if (!(view.name === 'module' && view.idx === DECK_IDX)) go({ name: 'module', idx: DECK_IDX })
      else sound.chirp()
    }
    const room = ROOMS.find((r) => r.id === cmd.toLowerCase() || r.name === raw.trim().toUpperCase())
    if (room) return openRoom(room.id)
    const brk = allCircuits(power.state.heater).find((c) => c.tag === cmd || c.tag.replace('-', '') === cmd)
    if (brk && !/^[1-9]$/.test(cmd)) {
      const was = power.on.has(brk.id)
      power.toggle(brk.id)
      power.setSelectedCircuit(brk.id)
      openVitals()
      return say(`${brk.tag} ${brk.short} ${was ? 'OFF' : 'ON'}${brk.id === 'bag' || brk.id === 'pump' ? ' (BAGGER AND PUMP LINKED)' : ''}`)
    }
    switch (cmd) {
      case 'UTILITY':
      case 'ICE':
        power.setSource('utility')
        openVitals()
        return say('SOURCE ICE UTILITY // BASELINE LOADED')
      case 'GEN':
      case 'GENERATOR':
        power.setSource('generator')
        openVitals()
        return say('SOURCE GENERATOR // EMERGENCY LIST LOADED', true)
      case 'HEATER': {
        const h = arg.startsWith('B') || arg.includes('6') ? '6500' : arg.startsWith('A') || arg.includes('2') ? '2x4500' : null
        if (!h) return say('USE HEATER A (2 X 4,500 W) OR HEATER B (1 X 6,500 W).', true)
        power.setHeater(h)
        openVitals()
        return say(h === '6500' ? 'STEAM HEATER B // 1 X 6,500 W' : 'STEAM HEATER A // 2 X 4,500 W')
      }
      case 'BASELINE':
        power.applyScenario('base')
        openVitals()
        return say('BASELINE // CONTINUOUS LOADS ONLY')
      case 'EMERGENCY':
        power.applyScenario('emerg')
        openVitals()
        return say('GENERATOR // EMERGENCY LIST', true)
      case 'REORDER':
      case 'STOCK':
        setSelected(CARGO_IDX)
        if (!(view.name === 'module' && view.idx === CARGO_IDX)) go({ name: 'module', idx: CARGO_IDX })
        return
      case 'BACK':
        if (!history.current.length) return say('NOTHING TO GO BACK TO.', true)
        return goBack()
      case 'MENU':
      case 'CORE':
        if (cmd === 'CORE') sound.whoosh()
        return go({ name: 'menu' })
      case 'HELP':
      case '?':
        return go({ name: 'help' })
      case 'TUNE':
      case 'TUNING':
      case 'SETTINGS':
        return go({ name: 'tune' })
      case 'STATUS':
        return go({ name: 'status' })
      case 'THEME': {
        if (!arg) return cycleTheme()
        const t = THEMES.find((x) => x.startsWith(arg)) as ThemeName | undefined
        if (!t) return say(`UNKNOWN THEME ${arg}. USE ${THEMES.join(', ')}.`, true)
        update((s) => ({ ...s, look: { ...s.look, theme: t } }))
        sound.chirp()
        return say(`THEME ${t}`)
      }
      case 'PHOSPHOR':
      case 'CRYO':
      case 'SODIUM':
      case 'ALERT':
      case 'SPORE':
        update((s) => ({ ...s, look: { ...s.look, theme: cmd as ThemeName } }))
        sound.chirp()
        return say(`THEME ${cmd}`)
      case 'CLEAN':
        return toggleClean()
      case 'MUTE':
      case 'SOUND':
        return toggleSound()
      case 'CHATTER':
      case 'TICK':
        update((s) => ({ ...s, sound: { ...s.sound, mode: cmd } }))
        return say(`SOUND MODE ${cmd}`)
      case 'BOOT':
      case 'REBOOT':
        return replayBoot()
      case 'LOGIN':
        return go({ name: 'login' })
      case 'LOGOUT':
        return void logout()
      case 'ALARM':
        return toggleAlarm()
      default:
        return say(`UNKNOWN COMMAND ${cmd}. TYPE HELP.`, true)
    }
  }

  // ---------- render ----------

  if (stage === 'power') {
    // A full tap (click) or key press is what browsers accept to allow sound.
    // Wait until sound is running so the boot swoop isn't lost.
    const energise = () => {
      if (energising.current) return
      energising.current = true
      void sound.unlock().then(() => setStage('boot'))
    }
    return (
      <Crt powered={false}>
        <div
          className="power"
          role="button"
          tabIndex={0}
          onClick={energise}
        >
          <div>
            <div className="dot" />
            <div className="heading">{STATION.system}</div>
            <div className="dim" style={{ marginTop: 10 }}>
              TAP OR PRESS ANY KEY TO ENERGISE
            </div>
          </div>
        </div>
        <PowerKeyCatcher onPress={energise} />
      </Crt>
    )
  }

  if (stage === 'boot') {
    return (
      <Crt alert={alert}>
        <Boot onDone={bootDone} />
      </Crt>
    )
  }

  const keys: FKey[] = [
    { f: 1, label: 'HELP', active: view.name === 'help' },
    { f: 2, label: 'MENU', active: view.name === 'menu' },
    { f: 3, label: 'TUNE', active: view.name === 'tune' },
    { f: 4, label: settings.sound.enabled ? 'MUTE' : 'SOUND' },
    { f: 5, label: 'THEME' },
    { f: 6, label: settings.look.clean ? 'GLASS' : 'CLEAN' },
    { f: 7, label: 'BOOT' },
    { f: 8, label: session ? 'LOGOUT' : 'LOGIN', active: view.name === 'login' },
  ]

  const hints: Record<View['name'], string> = {
    menu: 'ARROWS + ENTER OR TAP TO OPEN // [ INDEX // TYPE A NUMBER OR NAME // F1 HELP',
    tune: 'DRAG A METER OR USE ARROW KEYS ON IT // TEST BUTTONS PLAY EACH LAYER // SAVED ON THIS DEVICE',
    help: 'TYPE A COMMAND AT THE PROMPT',
    status: 'F2 MENU',
    login: 'ACCOUNTS ARE MADE IN THE SUPABASE DASHBOARD',
    module: 'ARROWS MOVE // [ INDEX ] PAGE // BKSP BACK // F2 MENU // TYPE ANOTHER MODULE NAME TO JUMP',
  }

  const moduleIndex = (
    <>
      <div className="section-title">INDEX</div>
      <ul className="index-list">
        <li tabIndex={0} onClick={() => go({ name: 'menu' })}>
          <span>00 CORE</span>
          <span className="k">ONLINE</span>
        </li>
        {MODULES.map((m, i) => (
          <li tabIndex={0} key={m.key} className={view.name === 'module' && view.idx === i ? 'sel' : ''} onClick={() => (setSelected(i), go({ name: 'module', idx: i }))}>
            <span>
              {String(m.num).padStart(2, '0')} {m.key}
            </span>
            <span className="k">B{m.build}</span>
          </li>
        ))}
      </ul>
    </>
  )
  const tuneIndex = (
    <>
      <div className="section-title">SECTIONS</div>
      <ul className="index-list">
        {[
          ['LOOK', 'tune-look'],
          ['SOUND', 'tune-sound'],
        ].map(([label, id]) => (
          <li tabIndex={0} key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </>
  )

  let title = TITLES[view.name]
  let content: React.ReactNode
  switch (view.name) {
    case 'menu':
      content = <Menu selected={selected} setSelected={setSelected} onOpen={(i) => go({ name: 'module', idx: i })} firstShow={firstMenu} />
      break
    case 'tune':
      content = <Tuning onAlarm={toggleAlarm} onReplayBoot={replayBoot} />
      break
    case 'help':
      content = <Help />
      break
    case 'login':
      content = <Login onDone={() => go({ name: 'menu' })} />
      break
    case 'status':
      content = (
        <div>
          <div className="section-title">SYSTEM STATUS</div>
          <TypeText
            group={3}
            lines={[
              `${STATION.system} BUILD ${STATION.build}`,
              `DATABASE ........ ${!dbLinked ? 'NOT LINKED (LOCAL MODE)' : session ? `LINKED // ${session.user.email?.toUpperCase()}` : 'LINKED // LOCKED'}`,
              `NETWORK ......... ${navigator.onLine ? 'ONLINE' : 'OFFLINE // CACHED SCREENS'}`,
              `STOCK STORAGE .. ${storeInfo.kind === 'local' ? 'LOCAL (THIS BROWSER)' : storeInfo.kind === 'remote' ? 'DATABASE' : storeInfo.kind === 'locked' ? 'LOCKED' : 'NOT SAVED'}`,
              `OFFLINE CACHE ... ${'serviceWorker' in navigator && navigator.serviceWorker.controller ? 'ACTIVE' : 'NOT YET ACTIVE'}`,
              `THEME ........... ${settings.look.clean ? 'CLEAN' : settings.look.theme}`,
              `SOUND ........... ${settings.sound.enabled ? settings.sound.mode : 'MUTED'}`,
            ]}
          />
        </div>
      )
      break
    case 'module':
      title = MODULES[view.idx].name
      if (view.idx === VITALS_IDX)
        content = (
          <Vitals
            onOpenRoom={(r) => {
              power.setSelectedRoom(r)
              setSelected(DECK_IDX)
              go({ name: 'module', idx: DECK_IDX })
            }}
          />
        )
      else if (view.idx === DECK_IDX)
        content = (
          <DeckPlan
            onOpenCargo={() => {
              setSelected(CARGO_IDX)
              go({ name: 'module', idx: CARGO_IDX })
            }}
            onOpenVitals={() => {
              setSelected(VITALS_IDX)
              go({ name: 'module', idx: VITALS_IDX })
            }}
          />
        )
      else if (view.idx === SPEC_IDX) content = <Specimen index={specimen} tab={specTab} setTab={setSpecTab} onOpenStrain={(id) => openXeno({ strain: id, node: null, tab: 'LINEAGE' })} onOpenHazard={(id) => openHazard({ id, tab: 'SPOT' })} />
      else if (view.idx === HAZARD_IDX) content = <Hazard x={hazard} set={setHazard} onOpenSpecies={(id) => { setSpecTab('HAZARDS'); openSpecies(id) }} onGoLog={() => openXeno({})} />
      else if (view.idx === XENO_IDX) content = <Xeno x={xeno} set={setXeno} say={say} onOpenSpecies={openSpecies} />
      else if (view.idx === COOK_IDX)
        content = (
          <Propulsion
            x={cook}
            set={setCook}
            say={say}
            onOpenHazard={() => openHazard({ id: null })}
            onOpenXeno={() => openXeno({})}
            onOpenVitals={() => {
              setSelected(VITALS_IDX)
              go({ name: 'module', idx: VITALS_IDX })
            }}
            onOpenSequence={() => {
              setSelected(SEQ_IDX)
              go({ name: 'module', idx: SEQ_IDX })
            }}
          />
        )
      else if (view.idx === SEQ_IDX)
        content = (
          <Sequence
            onOpenCargo={() => {
              setSelected(CARGO_IDX)
              go({ name: 'module', idx: CARGO_IDX })
            }}
          />
        )
      else if (view.idx === CARGO_IDX)
        content = (
          <Cargo
            onOpenSequence={() => {
              setSelected(SEQ_IDX)
              go({ name: 'module', idx: SEQ_IDX })
            }}
          />
        )
      else if (view.idx === LEDGER_IDX)
        content = (
          <Ledger
            x={ledger}
            set={setLedger}
            say={say}
            onOpenTrade={() => openTrade({ tab: 'TOTALS' })}
            onOpenCargo={() => {
              setSelected(CARGO_IDX)
              go({ name: 'module', idx: CARGO_IDX })
            }}
          />
        )
      else if (view.idx === MISSION_IDX) content = <Mission x={mission} set={setMission} say={say} openRecord={(key, strainId) => openXeno({ tab: 'LINEAGE', strain: strainId, node: key })} onOpenOrders={(tab) => openOrders({ tab })} />
      else if (view.idx === YIELD_IDX) content = <Yield x={yld} set={setYld} say={say} />
      else if (view.idx === ORDERS_IDX) content = <Orders x={ord} set={setOrd} say={say} />
      else if (view.idx === MONEY_IDX) content = <Money x={money} set={setMoney} say={say} onOpenTrade={() => openTrade({ tab: 'SALE' })} onOpenLedger={() => openLedger({ sel: 'bills' })} />
      else if (view.idx === HISTORY_IDX) content = <History x={hist} set={setHist} say={say} />
      else if (view.idx === TRADE_IDX) content = <Trade x={trade} set={setTrade} say={say} onOpenLedger={() => openLedger({ sel: 'overview' })} onOpenPrices={() => openLedger({ sel: 'settings' })} onOpenOrders={() => openOrders({ tab: 'ORDERS' })} />
      else if (view.idx === MANUAL_IDX) content = <Manual loc={manualLoc} onOpen={openManual} />
      else content = <Pending mod={MODULES[view.idx]} />
      break
  }

  store.screen = title || null
  if (view.name === 'module' && view.idx === VITALS_IDX)
    hints.module = 'TAP A BREAKER TO FLIP IT // TYPE A TAG (S4) OR GEN, UTILITY, HEATER A/B // F2 MENU'
  if (view.name === 'module' && view.idx === DECK_IDX)
    hints.module = 'TAP A ROOM, ITS DETAIL IS BELOW THE PLAN // TYPE LAB, PACKING, INCUBATION, FRUITING OR BOILING'

  if (view.name === 'module' && view.idx === SPEC_IDX)
    hints.module = 'TAP A SPECIES IN THE LIST // LEFT/RIGHT ARROWS OR TYPE A TAB (CLIMATE) // WHY? SHOWS THE SOURCE // F2 MENU'
  if (view.name === 'module' && view.idx === SEQ_IDX)
    hints.module = 'SET BAGS, PICK SPECIES, THEN INITIATE OR COMMIT RUN TO CARGO // F2 MENU'
  if (view.name === 'module' && view.idx === CARGO_IDX)
    hints.module = 'TAP AN ITEM TO RECEIVE, USE OR COUNT IT // TYPE REORDER OR CARGO // F2 MENU'

  if (view.name === 'module' && view.idx === XENO_IDX)
    hints.module = 'TAP A STRAIN IN THE LIST // TYPE A CODE (LM-01) OR A TAB (LINEAGE, PLANNER) // TAP A NODE TO LOG THE NEXT STEP // F2 MENU'
  if (view.name === 'module' && view.idx === HAZARD_IDX)
    hints.module = 'PICK AN ENTRY FROM THE LIST // DIAGNOSE LISTS LIKELY MATCHES // TYPE A NAME (BLOTCH) OR A TAB (CAUSE) // WHY? SHOWS THE SOURCE // F2 MENU'
  if (view.name === 'module' && view.idx === COOK_IDX)
    hints.module = 'PICK A RUN FROM THE LIST OR START ONE // QUICK-ADD READINGS ON A PHONE // TYPE A TAB (CURVE, READINGS, SHEET) // F2 MENU'
  if (view.name === 'module' && view.idx === LEDGER_IDX)
    hints.module = 'PICK FROM THE LIST // NO TAG = LOGGED, ESTIMATE = FROM THE PLAN // TYPE BILLS, LABOUR OR TRADE // F2 MENU'
  if (view.name === 'module' && view.idx === TRADE_IDX)
    hints.module = 'NEW SALE: KG, TAP CHANNEL, SAVE // TYPE TOTALS, BUYERS OR LOG // MARGIN USES LEDGER COST // F2 MENU'
  if (view.name === 'module' && view.idx === MISSION_IDX)
    hints.module = 'BOARD SHOWS EVERY ACTIVE LOT // TYPE TODAY, HARVEST, LOT, BULK OR SCAN // KG LOGGED FEEDS LEDGER AND TRADE // F2 MENU'
  if (view.name === 'module' && view.idx === YIELD_IDX)
    hints.module = 'FLUSH LOG: BE% PER LOT AND FLUSH // SCORECARD: BY STRAIN, COOK, ROOM, WEEK, WORKER // TYPE TRIAL OR FADING // F2 MENU'
  if (view.name === 'module' && view.idx === ORDERS_IDX)
    hints.module = 'EVERY BUYER PAYS CASH ON DELIVERY // PICK LIST COMPARES ORDERS WITH THE FORECAST // TYPE FORECAST, PACK OR WHATSAPP // F2 MENU'
  if (view.name === 'module' && view.idx === MONEY_IDX)
    hints.module = 'CASH ON DELIVERY // US$ AT EACH RECORD\'S OWN DAY // TYPE OWED, PNL, CASH, TRENDS, WASTE, TRACE OR WHATIF // F2 MENU'
  if (view.name === 'module' && view.idx === HISTORY_IDX)
    hints.module = 'TAP A CHANGE TO SEE THAT RECORD // UNDO OR CTRL+Z REVERSES THE LAST CHANGE // TYPE SYNC FOR SAVING STATUS // F2 MENU'
  if (view.name === 'module' && view.idx === MANUAL_IDX)
    hints.module = 'PICK A CHAPTER OR SECTION FROM THE CONTENTS // TAP A LINK TO JUMP // BACK RETURNS TO WHERE YOU WERE // F2 MENU'

  const hint = reply ? (
    <TypeText key={reply.id} className={reply.warn ? 'warn' : ''} lines={[reply.text]} />
  ) : (
    hints[view.name]
  )

  return (
    <ManualLinksContext.Provider value={links}>
    <HistoryNavContext.Provider value={openRecordHistory}>
    <Crt alert={alert}>
      {stage === 'login' ? (
        <div className="shell" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}>
          <header className="titlebar">
            <span className="tb-left">{STATION.system} // IDENTIFY</span>
            <span className="tb-right">{STATION.company}</span>
          </header>
          <main className="panel">
            <Login onDone={enterShell} />
          </main>
        </div>
      ) : (
        <>
          <Shell
            title={title}
            index={
              view.name === 'tune'
                ? tuneIndex
                : view.name === 'module' && view.idx === VITALS_IDX
                  ? <VitalsIndex />
                  : view.name === 'module' && view.idx === DECK_IDX
                    ? <DeckIndex />
                    : view.name === 'module' && view.idx === SPEC_IDX
                      ? <SpecimenIndex index={specimen} onPick={setSpecimen} />
                      : view.name === 'module' && view.idx === CARGO_IDX
                        ? <CargoIndex />
                        : view.name === 'module' && view.idx === MANUAL_IDX
                          ? undefined
                          : view.name === 'module' && view.idx === HAZARD_IDX
                            ? <HazardIndex x={hazard} set={setHazard} />
                          : view.name === 'module' && view.idx === XENO_IDX
                            ? <XenoIndex x={xeno} set={setXeno} />
                          : view.name === 'module' && view.idx === COOK_IDX
                            ? <CookIndex x={cook} set={setCook} />
                          : view.name === 'module' && view.idx === LEDGER_IDX
                            ? <LedgerIndex x={ledger} set={setLedger} />
                          : view.name === 'module' && view.idx === TRADE_IDX
                            ? <TradeIndex x={trade} set={setTrade} />
                          : view.name === 'module' && view.idx === MISSION_IDX
                            ? <MissionIndex x={mission} set={setMission} />
                          : view.name === 'module' && view.idx === HISTORY_IDX
                            ? <HistoryIndex x={hist} set={setHist} />
                          : view.name === 'module' && view.idx === YIELD_IDX
                            ? <YieldIndex x={yld} set={setYld} />
                          : view.name === 'module' && view.idx === ORDERS_IDX
                            ? <OrdersIndex x={ord} set={setOrd} />
                          : view.name === 'module' && view.idx === MONEY_IDX
                            ? <MoneyIndex x={money} set={setMoney} />
                          : moduleIndex
            }
            keys={keys}
            onKey={onKey}
            hint={hint}
            onCommand={(c) => {
              setReply(null)
              onCommand(c)
            }}
            focusToken={focusToken}
            onBack={histLen > 0 ? goBack : undefined}
            lamp={<SyncLamp onOpen={() => openHistory({ tab: 'SYNC' })} />}
            undo={<UndoButton say={say} />}
            bodyClass={`view-${view.name}${view.name === 'module' && view.idx === MANUAL_IDX ? ' view-manual' : ''}${view.name === 'module' && (view.idx === VITALS_IDX || view.idx === DECK_IDX) ? ' view-power' : ''}${view.name === 'module' && view.idx === XENO_IDX ? ' view-strip' : ''}${view.name === 'module' && view.idx === SPEC_IDX ? ' view-fullindex' : ''}${view.name === 'module' && view.idx === HAZARD_IDX ? ' view-hazard' : ''}${view.name === 'module' && view.idx === COOK_IDX ? ' view-cook' : ''}${view.name === 'module' && (view.idx === LEDGER_IDX || view.idx === TRADE_IDX || view.idx === MISSION_IDX || view.idx === HISTORY_IDX || view.idx === YIELD_IDX || view.idx === ORDERS_IDX || view.idx === MONEY_IDX) ? ' view-ledger' : ''}`}
          >
            <div key={`${view.name}-${'idx' in view ? view.idx : ''}`}>{content}</div>
          </Shell>
          {sweep > 0 && <div key={sweep} className="sweep" aria-hidden />}
          {popupRef && (
            <SourcePopup
              refId={popupRef}
              onClose={() => setPopupRef(null)}
              onGoPage={(chapter, anchor, fact) => {
                setPopupRef(null)
                openManual({ chapter, anchor, fact })
              }}
            />
          )}
        </>
      )}
    </Crt>
    </HistoryNavContext.Provider>
    </ManualLinksContext.Provider>
  )
}

/** On the power screen, any key energises the terminal even if nothing has focus. */
function PowerKeyCatcher({ onPress }: { onPress: () => void }) {
  const ref = useRef(onPress)
  ref.current = onPress
  useEffect(() => {
    const h = () => ref.current()
    window.addEventListener('keydown', h, { once: true })
    return () => window.removeEventListener('keydown', h)
  }, [])
  return null
}
