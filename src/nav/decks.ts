// THE DECK MAP (11 Nov 2026). The app's screens grouped the way a farm manager thinks about the business:
// 8 decks (main categories), each opening to its stations (sub menus). A station opens one screen on one or
// more of its tabs. Every screen and every tab has exactly one home station (decks.test.ts checks it).
// Original names only, in the station-terminal spirit. Plain words ride beside every themed name.

export type DeckId = 'bridge' | 'grow' | 'xenolab' | 'cargo' | 'trade' | 'bursar' | 'engineering' | 'mainframe'

export interface Station {
  id: string
  name: string
  /** Plain words: what the station is for. */
  sub: string
  /** The screen it opens: a module key from MODULES, or TUNE for the look and sound settings. */
  screen: string
  /** The screen's tabs this station owns, in order (the first is where it opens). Absent = the whole screen. */
  tabs?: readonly string[]
  /** 2 to 4 stations a person usually goes to next. */
  related: readonly string[]
  /** Extra whole inputs at the prompt that open it. */
  words?: readonly string[]
}

export interface Deck {
  id: DeckId
  num: number
  name: string
  /** Plain words: what the deck is for. */
  sub: string
  /** Whole inputs at the prompt that open the deck, besides its name and number. */
  words: readonly string[]
  stations: readonly Station[]
}

export const DECKS: readonly Deck[] = [
  {
    id: 'bridge',
    num: 1,
    name: 'BRIDGE',
    sub: "TODAY'S WORK AND THE WHOLE FARM AT A GLANCE",
    words: ['COMMAND', 'DASHBOARD'],
    stations: [
      { id: 'today', name: "TODAY'S WORK", sub: 'MOVES, PICKS, CULTURES AND REORDERS DUE', screen: 'MISSION', tabs: ['TODAY'], related: ['lots', 'harvest', 'checklists', 'reminders'], words: ['TODAYS WORK', 'WORK'] },
      { id: 'ask', name: 'ASK MY/CO/L', sub: 'THE FARM ASSISTANT: ASK OR TELL IT', screen: 'ASK', related: ['guide', 'search'], words: ['ASK MYCOL', 'ASSISTANT'] },
      { id: 'search', name: 'SEARCH', sub: 'FIND ANY RECORD, CHANGE MANY AT ONCE', screen: 'SEARCH', related: ['history', 'ask'] },
    ],
  },
  {
    id: 'grow',
    num: 2,
    name: 'GROW DECK',
    sub: 'BAGS FROM STEAM COOK TO HARVEST',
    words: ['GROW', 'GROWDECK', 'PRODUCTION', 'CROP'],
    stations: [
      { id: 'lots', name: 'LOT BOARD', sub: 'EVERY ACTIVE LOT, MOVES AND BULK CHANGES', screen: 'MISSION', tabs: ['BOARD', 'BULK', 'SCAN', 'GUESSES'], related: ['harvest', 'stock', 'cooks', 'trace'], words: ['LOTBOARD'] },
      { id: 'newlot', name: 'NEW BLOCK LOT', sub: 'LOG BLOCKS JUST INOCULATED', screen: 'MISSION', tabs: ['NEWLOT'], related: ['cooks', 'stock', 'runplan'], words: ['NEW LOT', 'NEWBLOCKLOT'] },
      { id: 'harvest', name: 'LOG HARVEST', sub: 'KG PICKED, BY LOT AND FLUSH', screen: 'MISSION', tabs: ['HARVEST'], related: ['cold', 'sale', 'yield', 'orders'], words: ['LOGHARVEST'] },
      { id: 'cooks', name: 'STEAM COOKS', sub: 'STEAM AND COOK LOG WITH TEMPERATURE CURVES', screen: 'PROPULSION', related: ['grid', 'bills', 'newlot'], words: ['STEAMCOOKS'] },
      { id: 'runplan', name: 'RUN PLANNER', sub: 'BAG RUN PLAN AND WHAT IT NEEDS', screen: 'SEQUENCE', related: ['spawnplan', 'orders', 'manifest'], words: ['RUNPLANNER', 'PLAN'] },
      { id: 'yield', name: 'YIELD RECORDS', sub: 'BE%, SCORECARD AND STRAIN TRIALS', screen: 'YIELD', related: ['species', 'strains', 'cogs'], words: ['YIELDRECORDS'] },
    ],
  },
  {
    id: 'xenolab',
    num: 3,
    name: 'XENOLAB',
    sub: 'STRAINS, CULTURES, SPECIES AND CONTAMINATION',
    words: ['LABDECK', 'BIOLAB'],
    stations: [
      { id: 'strains', name: 'STRAIN REGISTRY', sub: 'EVERY STRAIN AND ITS FAMILY TREE', screen: 'XENO', tabs: ['STRAINS', 'LINEAGE'], related: ['bank', 'species', 'yield'], words: ['STRAINREGISTRY', 'REGISTRY'] },
      { id: 'bank', name: 'CULTURE BANK', sub: 'SLANTS AND WATER TUBES, TESTS AND AGES', screen: 'XENO', tabs: ['BANK'], related: ['strains', 'stock'], words: ['CULTUREBANK'] },
      { id: 'stock', name: 'CULTURE STOCK', sub: 'PLATES, MASTERS, GRAIN SPAWN AND LABELS', screen: 'XENO', tabs: ['STOCK', 'LABELS'], related: ['spawnplan', 'newlot', 'hazard'], words: ['CULTURESTOCK', 'SPAWN'] },
      { id: 'spawnplan', name: 'SPAWN PLANNER', sub: 'SPAWN NEEDED FOR THE COMING RUNS', screen: 'XENO', tabs: ['PLANNER'], related: ['runplan', 'manifest'], words: ['SPAWNPLANNER'] },
      { id: 'species', name: 'SPECIES FILES', sub: 'GROWING READOUTS FOR EVERY SPECIES', screen: 'SPECIMEN', related: ['life', 'hazard', 'yield'], words: ['SPECIESFILES', 'SPECIES'] },
      { id: 'hazard', name: 'HAZARD INDEX', sub: 'CONTAMINANTS AND PESTS: SPOT, CAUSE, TREAT', screen: 'HAZARD', related: ['stock', 'lots', 'upkeep'] },
    ],
  },
  {
    id: 'cargo',
    num: 4,
    name: 'CARGO HOLD',
    sub: 'EVERYTHING IN STOCK: SUPPLIES AND FRESH MUSHROOMS',
    words: ['HOLD', 'CARGOHOLD', 'INVENTORY'],
    stations: [
      { id: 'manifest', name: 'SUPPLY MANIFEST', sub: 'SUPPLIES ON HAND, USE AND REORDERS', screen: 'CARGO', related: ['pricebook', 'cash', 'runplan'], words: ['SUPPLYMANIFEST', 'MANIFEST', 'SUPPLIES'] },
      { id: 'cold', name: 'COLD STORE', sub: 'FRESH KG ON HAND, PICKED MINUS SOLD AND WRITTEN OFF', screen: 'COLD', related: ['harvest', 'sale', 'orders', 'waste'], words: ['COLDSTORE', 'COLD', 'ONHAND', 'FRIDGE', 'COOLER'] },
      { id: 'waste', name: 'SURPLUS + WASTE', sub: 'WHAT DID NOT SELL: DRIED, DONATED, COMPOSTED', screen: 'MONEY', tabs: ['WASTE'], related: ['cold', 'pnl'], words: ['SURPLUS AND WASTE', 'SURPLUSWASTE'] },
    ],
  },
  {
    id: 'trade',
    num: 5,
    name: 'TRADE DOCK',
    sub: 'SELLING: SALES, BUYERS, ORDERS AND MONEY OWED',
    words: ['DOCK', 'TRADEDOCK', 'SELLING'],
    stations: [
      { id: 'sale', name: 'NEW SALE', sub: 'LOG A SALE: KG, BUYER, PRICE', screen: 'TRADE', tabs: ['SALE'], related: ['cold', 'pricebook', 'owed', 'buyers'], words: ['NEWSALE'] },
      { id: 'saleslog', name: 'SALES LOG', sub: 'EVERY SALE, AND TOTALS BY WEEK, SPECIES AND BUYER', screen: 'TRADE', tabs: ['LOG', 'TOTALS', 'GUESSES'], related: ['owed', 'trends', 'pnl'], words: ['SALESLOG'] },
      { id: 'buyers', name: 'BUYERS', sub: 'WHO BUYS, HOW MUCH AND HOW OFTEN', screen: 'TRADE', tabs: ['BUYERS'], related: ['orders', 'owed', 'trends'] },
      { id: 'orders', name: 'STANDING ORDERS', sub: 'WEEKLY ORDERS, FORECAST AND PICK LIST', screen: 'ORDERS', tabs: ['ORDERS', 'FORECAST', 'PICK', 'GUESSES'], related: ['cold', 'harvest', 'runplan', 'pricelist'], words: ['STANDINGORDERS'] },
      { id: 'pricelist', name: 'PRICE LIST', sub: 'THE WHATSAPP LIST OF WHAT IS FOR SALE', screen: 'ORDERS', tabs: ['LIST'], related: ['pricebook', 'buyers'] },
      { id: 'owed', name: 'MONEY OWED', sub: 'WHO OWES WHAT, AND RECEIPTS', screen: 'MONEY', tabs: ['OWED', 'RECEIPTS'], related: ['saleslog', 'buyers', 'cash'], words: ['MONEYOWED'] },
      { id: 'trends', name: 'SALES TRENDS', sub: 'SALES BY WEEK, SPECIES, CHANNEL AND BUYER', screen: 'MONEY', tabs: ['TRENDS'], related: ['saleslog', 'pnl'], words: ['SALESTRENDS'] },
      { id: 'trace', name: 'TRACE + RECALL', sub: 'FROM A SALE BACK TO ITS LOT, COOK AND STRAIN', screen: 'MONEY', tabs: ['TRACE'], related: ['lots', 'cooks', 'stock', 'buyers'], words: ['TRACE AND RECALL', 'TRACERECALL'] },
    ],
  },
  {
    id: 'bursar',
    num: 6,
    name: 'BURSAR',
    sub: 'PROFIT, CASH AND WHAT EVERYTHING COSTS',
    words: ['TREASURY', 'FINANCE', 'ACCOUNTS', 'BOOKS', 'MONEY'],
    stations: [
      { id: 'pnl', name: 'PROFIT + LOSS', sub: 'EACH MONTH: SALES, COSTS, PROFIT, BREAK-EVEN', screen: 'MONEY', tabs: ['PNL', 'GUESSES'], related: ['saleslog', 'cogs', 'cash'], words: ['PROFIT AND LOSS', 'PROFITLOSS'] },
      { id: 'cash', name: 'CASH FLOW', sub: '12 MONTHS OF CASH, SPENDING AND MONEY IN', screen: 'MONEY', tabs: ['CASH', 'SPEND'], related: ['owed', 'budget', 'bills'], words: ['CASH FLOW'] },
      { id: 'budget', name: 'BUDGET', sub: 'THE PLAN FOR EACH MONTH', screen: 'MONEY', tabs: ['BUDGET'], related: ['cash', 'whatif'] },
      { id: 'whatif', name: 'WHAT-IF', sub: 'TRY PRICES AND BAG COUNTS BEFORE CHANGING', screen: 'MONEY', tabs: ['WHATIF'], related: ['pricebook', 'runplan', 'budget'], words: ['WHAT IF'] },
      { id: 'cogs', name: 'COST OF GOODS', sub: 'WHAT A KILO COSTS TO GROW, WEEK BY WEEK', screen: 'LEDGER', tabs: ['overview'], related: ['pricebook', 'bills', 'labour', 'yield'], words: ['COSTOFGOODS'] },
      { id: 'bills', name: 'POWER BILLS', sub: 'ICE ELECTRICITY BILLS', screen: 'LEDGER', tabs: ['bills'], related: ['grid', 'cooks', 'cogs'], words: ['POWERBILLS', 'ICE BILLS'] },
      { id: 'labour', name: 'LABOUR', sub: 'HOURS WORKED, BY TASK', screen: 'LEDGER', tabs: ['labour'], related: ['cogs', 'crew'] },
      { id: 'pricebook', name: 'PRICE BOOK', sub: 'EVERY PRICE AND COST, AND THE EXCHANGE RATE', screen: 'LEDGER', tabs: ['settings'], related: ['manifest', 'pricelist', 'cogs'], words: ['PRICEBOOK', 'EXCHANGE RATE', 'FX'] },
    ],
  },
  {
    id: 'engineering',
    num: 7,
    name: 'ENGINEERING',
    sub: 'POWER, ROOMS, CLIMATE AND UPKEEP',
    words: ['ENG', 'SYSTEMS', 'PLANT'],
    stations: [
      { id: 'grid', name: 'POWER GRID', sub: 'BREAKERS, LOADS AND THE GENERATOR', screen: 'VITALS', related: ['cuts', 'bills', 'cooks'], words: ['POWERGRID', 'BREAKERS'] },
      { id: 'cuts', name: 'POWER CUTS', sub: 'EVERY CUT AND HOW LONG IT LASTED', screen: 'FACILITY', tabs: ['POWER CUTS'], related: ['grid', 'life'] },
      { id: 'deckplan', name: 'DECK PLAN', sub: 'ROOMS AND EQUIPMENT, DRAWN TO SCALE', screen: 'DECK', related: ['grid', 'life'], words: ['DECKPLAN', 'ROOMS', 'LAYOUT'] },
      { id: 'life', name: 'LIFE SUPPORT', sub: 'CLIMATE SENSORS, GRAPHS AND ALARMS', screen: 'ATMOS', related: ['deckplan', 'upkeep', 'species'], words: ['LIFESUPPORT'] },
      { id: 'water', name: 'WATER', sub: 'WATER TESTS AND WHEN THE NEXT IS DUE', screen: 'FACILITY', tabs: ['WATER'], related: ['upkeep', 'checklists'] },
      { id: 'upkeep', name: 'UPKEEP', sub: 'MAINTENANCE AND CLEANING LOGS', screen: 'FACILITY', tabs: ['MAINTENANCE', 'CLEANING'], related: ['checklists', 'reminders'] },
      { id: 'checklists', name: 'CHECKLISTS', sub: 'DAILY AND WEEKLY SIGN-OFFS', screen: 'FACILITY', tabs: ['CHECKLISTS'], related: ['today', 'reminders'] },
      { id: 'reminders', name: 'REMINDERS', sub: 'THE STATUS BOARD AND EVERYTHING DUE', screen: 'FACILITY', tabs: ['STATUS', 'REMINDERS', 'GUESSES'], related: ['today', 'upkeep'] },
    ],
  },
  {
    id: 'mainframe',
    num: 8,
    name: 'MAINFRAME',
    sub: 'GUIDE, TEXTBOOK, RECORDS, BACKUPS AND CREW',
    words: ['SYSTEM', 'COMPUTER'],
    stations: [
      { id: 'guide', name: 'USER GUIDE', sub: 'HOW TO USE EVERY SCREEN', screen: 'GUIDE', related: ['textbook', 'ask'] },
      { id: 'textbook', name: 'TEXTBOOK', sub: 'THE FULL GROWING TEXTBOOK', screen: 'MANUAL', related: ['species', 'hazard'], words: ['BOOK'] },
      { id: 'history', name: 'EDIT HISTORY', sub: 'EVERY CHANGE, UNDO AND SAVING STATUS', screen: 'HISTORY', related: ['vault', 'search'], words: ['EDITHISTORY'] },
      { id: 'vault', name: 'DATA VAULT', sub: 'BACKUP, EXPORT, RESTORE AND THE GOOGLE SHEET', screen: 'DATA', related: ['history'], words: ['DATAVAULT', 'VAULT'] },
      { id: 'crew', name: 'CREW ACCESS', sub: 'OWNER AND STAFF ROLES, AND THE DEVICE LOCK', screen: 'STAFF', related: ['labour', 'guide'], words: ['CREWACCESS', 'CREW', 'ROLES'] },
      { id: 'tuning', name: 'TUNING', sub: 'LOOK, SOUND, LANGUAGE AND GLOVES', screen: 'TUNE', related: ['guide'] },
    ],
  },
]

export interface StationAt extends Station {
  deck: Deck
  /** Position in its deck, from 1. */
  pos: number
  /** Deck number and position: 5.3. */
  code: string
}

export const STATIONS: readonly StationAt[] = DECKS.flatMap((d) => d.stations.map((s, i) => ({ ...s, deck: d, pos: i + 1, code: `${d.num}.${i + 1}` })))

export const deckById = (id: string): Deck | undefined => DECKS.find((d) => d.id === id)
export const stationById = (id: string): StationAt | undefined => STATIONS.find((s) => s.id === id)

/** A screen's tab as the deck map names it. LEDGER weeks belong to COST OF GOODS. */
export function normTab(screen: string, tab: string | null | undefined): string {
  if (screen === 'LEDGER' && tab && tab.startsWith('week:')) return 'overview'
  return tab ?? ''
}

/** The station a screen and tab belong to (the screen's first station when the tab is unknown). */
export function stationFor(screen: string, tab?: string | null): StationAt | undefined {
  const all = STATIONS.filter((s) => s.screen === screen)
  if (all.length <= 1) return all[0]
  const t = normTab(screen, tab)
  return all.find((s) => s.tabs?.includes(t)) ?? all[0]
}

/** Stations a person may open, in deck order. */
export const visibleStations = (deck: Deck, canOpen: (screen: string) => boolean): StationAt[] => STATIONS.filter((s) => s.deck.id === deck.id && canOpen(s.screen))
/** Decks with at least one station a person may open. */
export const visibleDecks = (canOpen: (screen: string) => boolean): Deck[] => DECKS.filter((d) => visibleStations(d, canOpen).length > 0)

// ---------- the prompt ----------

export type NavHit = { kind: 'menu' } | { kind: 'deck'; deck: Deck } | { kind: 'station'; station: StationAt } | { kind: 'bad'; text: string }

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')

/**
 * What a whole typed input means on the deck map: 0 = the main menu, 1 to 8 = a deck, 5.3 = deck 5 station 3,
 * a deck name, or a station name of two or more words (one-word names keep the older commands they always had).
 * Returns null when the input is not about the map, so the other commands still get it.
 */
export function parseNav(raw: string): NavHit | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  if (/^0{1,2}$/.test(s)) return { kind: 'menu' }
  // A dot, comma or space between the numbers. Not a dash: 1-2, 3-4 ... are breaker tags on POWER GRID.
  const num = /^(\d{1,2})(?:[.,\s](\d{1,2}))?$/.exec(s)
  if (num) {
    const d = DECKS.find((x) => x.num === Number(num[1]))
    if (!d) return { kind: 'bad', text: `NO DECK ${num[1]}. THE DECKS ARE 1 TO ${DECKS.length}: TYPE 0 FOR THE MAIN MENU.` }
    if (num[2] === undefined) return { kind: 'deck', deck: d }
    const st = STATIONS.find((x) => x.deck.id === d.id && x.pos === Number(num[2]))
    if (!st) return { kind: 'bad', text: `${d.name} HAS STATIONS ${d.num}.1 TO ${d.num}.${d.stations.length}.` }
    return { kind: 'station', station: st }
  }
  const q = squash(s)
  if (!q) return null
  const deck = DECKS.find((d) => squash(d.name) === q || d.words.some((w) => squash(w) === q))
  if (deck) return { kind: 'deck', deck }
  const multi = s.split(/\s+/).length > 1
  const st = STATIONS.find((x) => (multi && squash(x.name) === q) || (x.words ?? []).some((w) => squash(w) === q && (multi || !w.includes(' '))))
  if (st) return { kind: 'station', station: st }
  return null
}
