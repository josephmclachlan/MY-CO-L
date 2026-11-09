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
import { Facility, FacilityIndex, FAC_START, FAC_TABS, ReminderWatcher, type FacState, type GoScreen } from './screens/Facility'
import { Climate, ClimateIndex, AT_START, AT_TABS, type AtState } from './screens/Climate'
import { Search, SearchIndex, SEARCH_START, type SearchState } from './screens/Search'
import { Ask, AskIndex, ASK_START, type AskState } from './screens/Ask'
import type { Go } from './lib/search'
import { Data, DataIndex, DATA_START, type DataState } from './screens/Data'
import { Staff, StaffIndex } from './screens/Staff'
import { Guide, GuideIndex, GUIDE_START, type GuideState } from './screens/Guide'
import { TipLayer, TipsButton } from './components/Tips'
import { useTableCards } from './components/TableCards'
import { tipModeOn, toggleTipMode, useTipMode } from './guide/tipStore'
import { guideSectionFor } from './guide/content'
import { GlovePad } from './components/GlovePad'
import { useT } from './settings/useT'
import { useRole } from './settings/RoleContext'
import { ES_COMMANDS, LANG_NAME, tr, trf, SPANISH_ON } from './lib/i18n'
import { backupNag } from './lib/dataExport'
import { search as runSearch, type Doc as SearchDoc } from './lib/search'
import { useSearchIndex } from './store/useSearchIndex'
import { History, HistoryIndex, HISTORY_START, HistoryNavContext, SyncLamp, UndoButton, undoneText, type HistoryState } from './screens/History'
import { findHazard } from './lib/hazard'
import { keyFromHash, type Strain } from './lib/xeno'
import { cartFromHash } from './lib/scan'
import { useStore, useStoreStatus, useTable } from './store/StoreContext'
import { usePractice } from './store/usePractice'
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
const FACILITY_IDX = MODULES.findIndex((m) => m.key === 'FACILITY')
const ATMOS_IDX = MODULES.findIndex((m) => m.key === 'ATMOS')
const SEARCH_IDX = MODULES.findIndex((m) => m.key === 'SEARCH')
const DATA_IDX = MODULES.findIndex((m) => m.key === 'DATA')
const STAFF_IDX = MODULES.findIndex((m) => m.key === 'STAFF')
const ASK_IDX = MODULES.findIndex((m) => m.key === 'ASK')
const GUIDE_IDX = MODULES.findIndex((m) => m.key === 'GUIDE')

/** Words that start a question or a command for the farm assistant (ASK), when more words follow. */
const ASK_WORDS = new Set(['ASK', 'HOW', 'WHAT', 'WHATS', "WHAT'S", 'WHO', 'WHOS', "WHO'S", 'WHICH', 'WHEN', 'IS', 'ARE', 'WAS', 'DID', 'DO', 'DOES', 'HAS', 'HAVE', 'ANY', 'TELL', 'SHOW', 'OPEN', 'LIST', 'GIVE', 'LOG', 'ADD', 'RECORD', 'PICKED', 'HARVESTED', 'RECEIVED', 'USED', 'MARK', 'MOVE', 'SET', 'POWER', 'GENERATOR', 'GRID', 'CUANTOS', 'CUANTAS', 'CUANTO', 'QUIEN', 'QUE', 'CUAL'])

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
  fac: FacState
  atm: AtState
  srch: SearchState
  dat: DataState
  askS: AskState
  guide: GuideState
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
  const [fac, setFacState] = useState<FacState>(FAC_START)
  const setFac = useCallback((p: Partial<FacState>) => setFacState((c) => ({ ...c, ...p })), [])
  const [atm, setAtmState] = useState<AtState>(AT_START)
  const setAtm = useCallback((p: Partial<AtState>) => setAtmState((c) => ({ ...c, ...p })), [])
  const [srch, setSrchState] = useState<SearchState>(SEARCH_START)
  const setSrch = useCallback((p: Partial<SearchState>) => setSrchState((c) => ({ ...c, ...p })), [])
  const [dat, setDatState] = useState<DataState>(DATA_START)
  const setDat = useCallback((p: Partial<DataState>) => setDatState((c) => ({ ...c, ...p })), [])
  const [askS, setAskState] = useState<AskState>(ASK_START)
  const setAsk = useCallback((p: Partial<AskState> | ((c: AskState) => Partial<AskState>)) => setAskState((c) => ({ ...c, ...(typeof p === 'function' ? p(c) : p) })), [])
  const [guide, setGuideState] = useState<GuideState>(GUIDE_START)
  const setGuide = useCallback((p: Partial<GuideState>) => setGuideState((c) => ({ ...c, ...p })), [])
  const tipMode = useTipMode()
  const { t, tf, lang } = useT()
  const roleInfo = useRole()
  const roleRef = useRef(roleInfo)
  roleRef.current = roleInfo
  const langRef = useRef(lang)
  langRef.current = lang
  const searchIndex = useSearchIndex()
  const store = useStore()
  const strains = useTable<Strain>('strains')
  useFxSync() // today's colones per dollar, once a day when online
  usePractice() // keeps the committed flush counts (FLUSH TEST) live for every screen's maths
  useRates() // keeps the prices and costs from PRICES + COSTS live for every screen's maths
  // Back button: the screens you came from, newest last.
  const history = useRef<Snap[]>([])
  const [histLen, setHistLen] = useState(0)
  const snapNow: Snap = { view, selected, specimen, specTab, room: power.selectedRoom, manualLoc, xeno, hazard, cook, ledger, trade, mission, hist, yld, ord, money, fac, atm, srch, dat, askS, guide }
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
      // A role that may not open this screen stays where it is, with a plain sentence.
      if (v.name === 'module' && !roleRef.current.canOpen(MODULES[v.idx].key)) {
        setReply({ text: trf(langRef.current, 'STAFF CANNOT OPEN {name}. ASK THE OWNER.', { name: tr(langRef.current, MODULES[v.idx].name) }), warn: true, id: Date.now() })
        return
      }
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
    setFacState(s.fac)
    setAtmState(s.atm)
    setSrchState(s.srch)
    setDatState(s.dat)
    setAskState({ ...s.askS, queued: null })
    setGuideState(s.guide)
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
  // A plain result fades after 12 s; a warning stays until closed or the next command.
  useEffect(() => {
    if (!reply || reply.warn) return
    const tm = window.setTimeout(() => setReply((r) => (r && r.id === reply.id ? null : r)), 12000)
    return () => window.clearTimeout(tm)
  }, [reply])

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
  const openFacility = (p: Partial<FacState>) => {
    const here = view.name === 'module' && view.idx === FACILITY_IDX
    if (!here) pushHist()
    setFac(p)
    setSelected(FACILITY_IDX)
    if (!here) go({ name: 'module', idx: FACILITY_IDX }, false)
    else sound.chirp()
  }
  const openAtmos = (p: Partial<AtState>) => {
    const here = view.name === 'module' && view.idx === ATMOS_IDX
    if (!here) pushHist()
    setAtm(p)
    setSelected(ATMOS_IDX)
    if (!here) go({ name: 'module', idx: ATMOS_IDX }, false)
    else sound.chirp()
  }
  const openSearch = (p: Partial<SearchState>) => {
    const here = view.name === 'module' && view.idx === SEARCH_IDX
    if (!here) pushHist()
    setSrch(p)
    setSelected(SEARCH_IDX)
    if (!here) go({ name: 'module', idx: SEARCH_IDX }, false)
    else sound.chirp()
  }
  const openData = (p: Partial<DataState>) => {
    const here = view.name === 'module' && view.idx === DATA_IDX
    if (!here) pushHist()
    setDat(p)
    setSelected(DATA_IDX)
    if (!here) go({ name: 'module', idx: DATA_IDX }, false)
    else sound.chirp()
  }
  const openAsk = (p: Partial<AskState>) => {
    const here = view.name === 'module' && view.idx === ASK_IDX
    if (!here) pushHist()
    setAsk(p)
    setSelected(ASK_IDX)
    if (!here) go({ name: 'module', idx: ASK_IDX }, false)
  }
  const openGuide = (p: Partial<GuideState>) => {
    const here = view.name === 'module' && view.idx === GUIDE_IDX
    if (!here) pushHist()
    setGuide({ q: '', ...p })
    setSelected(GUIDE_IDX)
    if (!here) go({ name: 'module', idx: GUIDE_IDX }, false)
    else sound.chirp()
  }
  const openModuleKey = (key: string) => {
    const idx = MODULES.findIndex((m) => m.key === key)
    if (idx < 0) return
    setSelected(idx)
    go({ name: 'module', idx })
  }
  const goScreen = (screen: GoScreen, tab?: string) => {
    if (screen === 'FACILITY') return openFacility({ tab: (FAC_TABS.find((t) => t === tab) ?? 'STATUS') })
    if (screen === 'ATMOS') return openAtmos({ tab: (AT_TABS.find((t) => t === tab) ?? 'NOW') })
    if (screen === 'MONEY') return openMoney({ tab: (MONEY_TABS.find((t) => t === tab) ?? 'OWED') })
    return openModuleKey(screen === 'XENO' ? 'XENO' : screen)
  }
  /** Open the record a search hit points at. */
  const openHit = (h: SearchDoc) => openGo(h.go)
  /** Open a screen a search hit or an assistant answer points at. */
  const openGo = (g: Go) => {
    if (g.screen === 'XENO') return openXeno({ strain: g.strain ?? null, node: g.node ?? null, tab: (g.node || g.strain ? 'LINEAGE' : xeno.tab) as XenoState['tab'] })
    if (g.screen === 'SPECIMEN' && g.id) return openSpecies(g.id)
    if (g.screen === 'HAZARD') return openHazard({ id: g.id ?? null, tab: 'SPOT' })
    if (g.screen === 'PROPULSION') return openCook({ sel: g.id ?? null, tab: 'RUN' })
    if (g.screen === 'MISSION') return openMission({ tab: (g.tab as MissionState['tab']) ?? 'BOARD' })
    if (g.screen === 'YIELD') return openYield({ tab: (YIELD_TABS.find((x) => x === g.tab) ?? 'FLUSHES') })
    if (g.screen === 'TRADE') return openTrade({ tab: (TRADE_TABS.find((x) => x === g.tab) ?? 'SALE') })
    if (g.screen === 'ORDERS') return openOrders({ tab: (ORDERS_TABS.find((x) => x === g.tab) ?? 'ORDERS') })
    if (g.screen === 'LEDGER') return openLedger({ sel: 'overview' })
    return goScreen(g.screen as GoScreen, g.tab)
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
    say(`${t('THEME')} ${next}`)
  }
  const toggleSound = () => {
    const on = !settings.sound.enabled
    update((s) => ({ ...s, sound: { ...s.sound, enabled: on } }))
    say(t(on ? 'SOUND ON' : 'SOUND MUTED'))
  }
  const toggleClean = () => {
    const on = !settings.look.clean
    update((s) => ({ ...s, look: { ...s.look, clean: on } }))
    say(t(on ? 'CLEAN MODE ON' : 'CLEAN MODE OFF'))
  }
  const logout = async () => {
    if (!supabase) return say(t('DATABASE NOT LINKED. LOCAL MODE.'), true)
    await supabase.auth.signOut()
    say(t('LOGGED OUT'))
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
  useTableCards()
  useKeyNav({
    enabled: stage === 'shell',
    onBack: () => {
      if (!history.current.length) return false
      goBack()
      return true
    },
  })

  /** Which guide page explains the screen being shown. */
  const guideScreen = view.name === 'module' ? MODULES[view.idx].key : view.name.toUpperCase()

  // ---------- commands ----------

  const onCommand = (raw: string) => {
    const [cmd0, ...rest] = raw.trim().toUpperCase().split(/\s+/)
    // Spanish words mean their English command (AYUDA = HELP, BUSCAR = FIND). Accents never matter.
    const cmd = ES_COMMANDS[cmd0.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] ?? cmd0
    const arg = rest.join(' ')
    const num = Number(cmd)
    const byNum = Number.isInteger(num) ? MODULES.findIndex((m) => m.num === num) : -1
    if (byNum >= 0) {
      setSelected(byNum)
      return go({ name: 'module', idx: byNum })
    }
    // Search: FIND blue oyster, /B1020, or just type a code or a name.
    if (raw.trim().startsWith('/') && raw.trim().length > 1) return openSearch({ tab: 'FIND', q: raw.trim().slice(1).trim().toUpperCase(), kinds: [] })
    if (['FIND', 'LOOKUP', 'WHERE'].includes(cmd)) return openSearch({ tab: 'FIND', q: arg, kinds: [] })
    // Farm assistant: ASK <anything>, a question, or a plain-words command (LOG 4.2 KG FROM B1020).
    // On the ASK screen, YES / NO answer the save waiting for CONFIRM.
    const onAsk = view.name === 'module' && view.idx === ASK_IDX
    const word0 = cmd0.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[?¿]/g, '')
    if (roleInfo.canOpen('ASK') && ((cmd === 'ASK' && arg) || (rest.length > 0 && ASK_WORDS.has(word0)) || (raw.trim().endsWith('?') && raw.trim().length > 2) || (onAsk && /^(Y|YES|N|NO|OK|SI|CONFIRM|CANCEL)$/.test(cmd0))))
      return openAsk({ tab: 'ASK', queued: cmd === 'ASK' ? raw.trim().replace(/^ask\s+/i, '') : raw.trim() })
    // User guide and tooltips.
    if (['GUIDE', 'HOWTO', 'USERGUIDE', 'GUIDEBOOK'].includes(cmd)) return openGuide({ sec: arg ? guideSectionFor(arg) : guideScreen })
    if (['TIPS', 'TIP', 'TOOLTIPS'].includes(cmd)) {
      toggleTipMode()
      const on = tipModeOn()
      return say(t(on ? 'TIP MODE ON' : 'TIP MODE OFF'))
    }
    if (['BULKEDIT', 'CHANGEMANY', 'MANY', 'STOCKTAKE'].includes(cmd)) return openSearch({ tab: 'BULK', ...(cmd === 'STOCKTAKE' ? { bulk: 'stock' as const, bq: '' } : {}) })
    // Data: BACKUP, EXPORT, RESTORE.
    if (['BACKUP', 'ZIP', 'SAVEDATA'].includes(cmd)) return openData({ tab: 'BACKUP' })
    if (cmd === 'EXPORT') return openData({ tab: 'EXPORT' })
    if (cmd === 'RESTORE') return openData({ tab: 'RESTORE' })
    if (['SHEET', 'SHEETS', 'GOOGLE'].includes(cmd)) return openData({ tab: 'SHEET' })
    // Glove mode and language.
    if (['GLOVE', 'GLOVES'].includes(cmd)) {
      const on = arg === 'ON' ? true : arg === 'OFF' ? false : !settings.glove
      update((x) => ({ ...x, glove: on }))
      return say(tr(lang, on ? 'GLOVE MODE ON: BIG BUTTONS AND THE NUMBER PAD' : 'GLOVE MODE OFF'))
    }
    if (['SPANISH', 'ES', 'ENGLISH', 'EN', 'LANG', 'LANGUAGE'].includes(cmd)) {
      if (!SPANISH_ON) return say('THE APP IS ENGLISH ONLY FOR NOW. SPANISH IS SWITCHED OFF.')
      const next = cmd === 'SPANISH' || cmd === 'ES' || arg.startsWith('ES') || arg.startsWith('SPAN') ? 'ES' : cmd === 'ENGLISH' || cmd === 'EN' || arg.startsWith('EN') ? 'EN' : lang === 'ES' ? 'EN' : 'ES'
      update((x) => ({ ...x, lang: next }))
      return say(`${next === 'ES' ? 'IDIOMA' : 'LANGUAGE'} ${LANG_NAME[next]}`)
    }
    if (['ROLE', 'WHOAMI'].includes(cmd)) return say(tf('YOU ARE {r} ({s})', { r: roleInfo.role === 'owner' ? t('OWNER') : t('STAFF'), s: roleInfo.source === 'login' ? t('FROM THE LOGIN') : t('FROM THE LOCK ON THIS DEVICE') }))
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
    // Facility logs: power cuts, water, upkeep, cleaning, checklists, reminders.
    if (['FACILITY', 'FACILITIES', 'STATIONBOARD', 'BOARDSTATUS'].includes(cmd)) return openFacility({ tab: 'STATUS' })
    if (['POWERCUT', 'POWERCUTS', 'CUT', 'CUTS', 'OUTAGE', 'OUTAGES', 'BLACKOUT'].includes(cmd)) return openFacility({ tab: 'POWER CUTS' })
    if (['WATER', 'WATERTEST', 'WATERLOG'].includes(cmd)) return openFacility({ tab: 'WATER' })
    if (['CHECKLIST', 'CHECKLISTS', 'SIGNOFF'].includes(cmd)) return openFacility({ tab: 'CHECKLISTS' })
    if (['MAINT', 'MAINTENANCE', 'UPKEEP', 'EQUIPMENT'].includes(cmd)) return openFacility({ tab: 'MAINTENANCE' })
    if (['CLEANING', 'SANITATION', 'CLEANLOG'].includes(cmd)) return openFacility({ tab: 'CLEANING' })
    if (['REMINDERS', 'REMINDER', 'REMIND'].includes(cmd)) return openFacility({ tab: 'REMINDERS' })
    const fTab = FAC_TABS.find((t) => t.replace(' ', '') === cmd)
    if (fTab && view.name === 'module' && view.idx === FACILITY_IDX) {
      setFac({ tab: fTab })
      return sound.chirp()
    }
    // Climate sensors and alarms.
    if (['ATMOS', 'ATMOSPHERICS', 'CLIMATE', 'SENSOR', 'SENSORS', 'TEMPS', 'TEMPERATURE', 'HUMIDITY'].includes(cmd)) return openAtmos({ tab: 'NOW' })
    if (['ALARMS', 'CLIMATEALARMS'].includes(cmd)) return openAtmos({ tab: 'ALARMS' })
    if (['GRAPH', 'GRAPHS', 'CHART'].includes(cmd)) return openAtmos({ tab: 'GRAPHS' })
    if (['READING', 'LOGREADING', 'TEMP'].includes(cmd)) return openAtmos({ tab: 'LOG READING' })
    if (['CSV', 'IMPORT', 'IMPORTCSV', 'GOVEE'].includes(cmd)) return openAtmos({ tab: 'IMPORT CSV' })
    if (['AC', 'ACS', 'ACUNITS', 'LENNOX', 'AIRCON'].includes(cmd)) return openAtmos({ tab: 'AC UNITS' })
    if (['SETPOINT', 'SETPOINTS', 'BANDS'].includes(cmd)) return openAtmos({ tab: 'SET POINTS' })
    if (['FEED', 'FEEDS'].includes(cmd)) return openAtmos({ tab: 'FEEDS' })
    if (['MOCK', 'MOCKTEST'].includes(cmd)) return openAtmos({ tab: 'MOCK TEST' })
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
        if (!history.current.length) return say(t('NOTHING TO GO BACK TO.'), true)
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
      default: {
        // Not a command: look it up. One exact code opens straight away; anything else lists what was found.
        const q = raw.trim()
        const r = runSearch(searchIndex.docs, q, { limit: 3 })
        if (r.total === 0) return say(tf('UNKNOWN COMMAND {c}. NOTHING FOUND WITH THAT NAME EITHER. TYPE HELP.', { c: cmd0 }), true)
        if (r.hits[0].score >= 1000 && (r.total === 1 || r.hits[1].score < 1000)) return openHit(r.hits[0])
        return openSearch({ tab: 'FIND', q: q.toUpperCase(), kinds: [] })
      }
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
    { f: 1, label: t('HELP'), active: view.name === 'help' },
    { f: 2, label: t('MENU'), active: view.name === 'menu' },
    { f: 3, label: t('TUNE'), active: view.name === 'tune' },
    { f: 4, label: t(settings.sound.enabled ? 'MUTE' : 'SOUND') },
    { f: 5, label: t('THEME') },
    { f: 6, label: t(settings.look.clean ? 'GLASS' : 'CLEAN') },
    { f: 7, label: t('BOOT') },
    { f: 8, label: t(session ? 'LOGOUT' : 'LOGIN'), active: view.name === 'login' },
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
      <div className="section-title">{t('INDEX')}</div>
      <ul className="index-list">
        <li tabIndex={0} data-tip={t('The main menu.')} onClick={() => go({ name: 'menu' })}>
          <span>00 {t('CORE')}</span>
          <span className="k">{t('ONLINE')}</span>
        </li>
        {MODULES.map((m, i) => roleInfo.canOpen(m.key) && (
          <li tabIndex={0} key={m.key} data-tip={`${t(m.name)}: ${t(m.what)}`} className={view.name === 'module' && view.idx === i ? 'sel' : ''} onClick={() => (setSelected(i), go({ name: 'module', idx: i }))}>
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
      <div className="section-title">{t('SECTIONS')}</div>
      <ul className="index-list">
        {[
          ['LOOK', 'tune-look'],
          ['SOUND', 'tune-sound'],
          ['LANGUAGE AND GLOVES', 'tune-device'],
        ].map(([label, id]) => (
          <li tabIndex={0} key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}>
            <span>{t(label)}</span>
          </li>
        ))}
      </ul>
    </>
  )

  let title = t(TITLES[view.name])
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
              `LANGUAGE ........ ${LANG_NAME[lang]}`,
              `GLOVE MODE ...... ${settings.glove ? 'ON' : 'OFF'}`,
              `ROLE ............ ${roleInfo.role.toUpperCase()} (${roleInfo.source === 'login' ? 'LOGIN' : 'THIS DEVICE'})`,
              `LAST BACKUP ..... ${backupNag().text.replace(/^LAST BACKUP /, '')}`,
            ]}
          />
        </div>
      )
      break
    case 'module':
      title = t(MODULES[view.idx].name)
      if (view.idx === VITALS_IDX)
        content = (
          <Vitals
            onOpenCuts={() => openFacility({ tab: 'POWER CUTS' })}
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
      else if (view.idx === MISSION_IDX) content = <Mission x={mission} set={setMission} say={say} openRecord={(key, strainId) => openXeno({ tab: 'LINEAGE', strain: strainId, node: key })} onOpenOrders={roleInfo.canOpen('ORDERS') ? (tab) => openOrders({ tab }) : undefined} />
      else if (view.idx === YIELD_IDX) content = <Yield x={yld} set={setYld} say={say} />
      else if (view.idx === ORDERS_IDX) content = <Orders x={ord} set={setOrd} say={say} />
      else if (view.idx === FACILITY_IDX) content = <Facility x={fac} set={setFac} say={say} onGo={goScreen} />
      else if (view.idx === ATMOS_IDX) content = <Climate x={atm} set={setAtm} say={say} />
      else if (view.idx === MONEY_IDX) content = <Money x={money} set={setMoney} say={say} onOpenTrade={() => openTrade({ tab: 'SALE' })} onOpenLedger={() => openLedger({ sel: 'bills' })} />
      else if (view.idx === SEARCH_IDX) content = <Search x={srch} set={setSrch} say={say} onOpen={openHit} />
      else if (view.idx === DATA_IDX) content = <Data x={dat} set={setDat} say={say} />
      else if (view.idx === STAFF_IDX) content = <Staff say={say} />
      else if (view.idx === GUIDE_IDX) content = <Guide x={guide} set={setGuide} onGo={openModuleKey} />
      else if (view.idx === ASK_IDX) content = <Ask x={askS} set={setAsk} say={say} onGo={openGo} />
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
  if (view.name === 'module' && view.idx === FACILITY_IDX)
    hints.module = 'PRESS POWER WENT OUT THE MOMENT THE GRID FAILS // TYPE POWERCUT, WATER, CHECKLIST, MAINT, CLEANING OR REMINDERS // TIMES ARE THE FARM CLOCK // F2 MENU'
  if (view.name === 'module' && view.idx === ATMOS_IDX)
    hints.module = 'TAP A ROOM FOR ITS GRAPH // TYPE ALARMS, GRAPH, READING, CSV, AC, SETPOINTS, FEEDS OR MOCK // TIMES ARE THE FARM CLOCK // F2 MENU'
  if (view.name === 'module' && view.idx === SEARCH_IDX)
    hints.module = 'TYPE A CODE OR NAME AND TAP A RESULT TO OPEN IT // CHANGE MANY: TICK RECORDS, THEN APPLY ONE CHANGE // AT THE > PROMPT TYPE FIND OR JUST A CODE // F2 MENU'
  if (view.name === 'module' && view.idx === DATA_IDX)
    hints.module = 'SAVE EVERYTHING (ZIP) OFTEN // RESTORE SHOWS WHAT WOULD CHANGE BEFORE IT DOES // TYPE BACKUP, EXPORT OR RESTORE // F2 MENU'
  if (view.name === 'module' && view.idx === STAFF_IDX)
    hints.module = 'OWNER SEES EVERYTHING // STAFF LOGS THE WORK AND SEES NO MONEY // THE OWNER PIN UNLOCKS A LOCKED DEVICE // F2 MENU'
  if (view.name === 'module' && view.idx === ASK_IDX)
    hints.module = 'TYPE A QUESTION OR A COMMAND IN PLAIN WORDS // SAVES WAIT FOR CONFIRM, UNDO REVERSES THEM // ON ANY SCREEN TYPE ASK OR END WITH ? // F2 MENU'
  if (view.name === 'module' && view.idx === GUIDE_IDX)
    hints.module = 'PICK A PAGE FROM THE LIST (ON A PHONE: THE PICKER AT THE TOP) // TYPE IN THE BOX TO SEARCH THE GUIDE // ? TIPS EXPLAINS ANY CONTROL // F2 MENU'
  if (view.name === 'module' && view.idx === HISTORY_IDX)
    hints.module = 'TAP A CHANGE TO SEE THAT RECORD // UNDO OR CTRL+Z REVERSES THE LAST CHANGE // TYPE SYNC FOR SAVING STATUS // F2 MENU'
  if (view.name === 'module' && view.idx === MANUAL_IDX)
    hints.module = 'PICK A CHAPTER OR SECTION FROM THE CONTENTS // TAP A LINK TO JUMP // BACK RETURNS TO WHERE YOU WERE // F2 MENU'

  const result = reply ? { id: reply.id, warn: reply.warn, text: <TypeText key={reply.id} lines={[reply.text]} /> } : null
  const hint = tipMode ? (
    t('TIP MODE: TAP ANY CONTROL TO READ WHAT IT DOES. TAP ? TIPS AGAIN OR PRESS ESC TO LEAVE.')
  ) : (
    t(hints[view.name])
  )

  return (
    <ManualLinksContext.Provider value={links}>
    <HistoryNavContext.Provider value={openRecordHistory}>
    <Crt alert={alert}>
      <ReminderWatcher />
      <GlovePad />
      {stage === 'shell' && <TipLayer screen={guideScreen} onGuide={(k) => openGuide({ sec: k })} />}
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
                          : view.name === 'module' && view.idx === FACILITY_IDX
                            ? <FacilityIndex x={fac} set={setFac} />
                          : view.name === 'module' && view.idx === ATMOS_IDX
                            ? <ClimateIndex x={atm} set={setAtm} />
                          : view.name === 'module' && view.idx === SEARCH_IDX
                            ? <SearchIndex x={srch} set={setSrch} />
                          : view.name === 'module' && view.idx === DATA_IDX
                            ? <DataIndex x={dat} set={setDat} />
                          : view.name === 'module' && view.idx === STAFF_IDX
                            ? <StaffIndex />
                          : view.name === 'module' && view.idx === ASK_IDX
                            ? <AskIndex x={askS} set={setAsk} />
                          : view.name === 'module' && view.idx === GUIDE_IDX
                            ? <GuideIndex x={guide} set={setGuide} />
                          : moduleIndex
            }
            keys={keys}
            onKey={onKey}
            hint={hint}
            result={result}
            onCloseResult={() => setReply(null)}
            onCommand={(c) => {
              setReply(null)
              onCommand(c)
            }}
            focusToken={focusToken}
            onBack={histLen > 0 ? goBack : undefined}
            lamp={<SyncLamp onOpen={() => openHistory({ tab: 'SYNC' })} />}
            glove={settings.glove ? <button type="button" className="gl-badge" title={t('Glove mode is on. Tap to switch it off.')} onClick={() => update((x) => ({ ...x, glove: false }))}>{t('GLOVE')} {'\u2715'}</button> : undefined}
            undo={<UndoButton say={say} />}
            tips={<TipsButton />}
            bodyClass={`view-${view.name}${view.name === 'module' && view.idx === MANUAL_IDX ? ' view-manual' : ''}${view.name === 'module' && (view.idx === VITALS_IDX || view.idx === DECK_IDX) ? ' view-power' : ''}${view.name === 'module' && view.idx === XENO_IDX ? ' view-strip' : ''}${view.name === 'module' && view.idx === SPEC_IDX ? ' view-fullindex' : ''}${view.name === 'module' && view.idx === HAZARD_IDX ? ' view-hazard' : ''}${view.name === 'module' && view.idx === COOK_IDX ? ' view-cook' : ''}${view.name === 'module' && (view.idx === LEDGER_IDX || view.idx === TRADE_IDX || view.idx === MISSION_IDX || view.idx === HISTORY_IDX || view.idx === YIELD_IDX || view.idx === ORDERS_IDX || view.idx === MONEY_IDX || view.idx === FACILITY_IDX || view.idx === ATMOS_IDX || view.idx === SEARCH_IDX || view.idx === DATA_IDX || view.idx === STAFF_IDX || view.idx === ASK_IDX || view.idx === GUIDE_IDX) ? ' view-ledger' : ''}`}
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
