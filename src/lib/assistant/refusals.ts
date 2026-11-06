// FARM ASSISTANT refusals: what it says when a question is outside the farm's records, when STAFF
// asks about money, or when the local model is dark. All lines are written for this app, in its own
// station voice (the LATTICE, the hull, the hyphae). None are quotes from any film or game.
// Each refusal ends with a plain sentence saying what CAN be asked, so nobody is left stuck.

export type RefusalKind = 'scope' | 'money' | 'engine' | 'unclear'

export const REFUSALS: Record<RefusalKind, string[]> = {
  scope: [
    'THAT FILE IS SEALED BEYOND THIS LATTICE.',
    'QUERY DRIFTED PAST THE OUTER HULL. I ONLY READ THIS STATION\'S RECORDS.',
    'NO STRAND OF THE LATTICE REACHES THAT FAR.',
    'MY HYPHAE COVER EVERY ROOM ON THIS DECK, AND NOT ONE CENTIMETRE MORE.',
    'THAT ANSWER LIVES OUTSIDE THE AIRLOCK. I STAY IN HERE WITH THE BLOCKS.',
    'SIGNAL LOST SOMEWHERE PAST THE SPORE CLOUD. NOTHING ON FILE.',
    'THE CORE KNOWS ONLY WHAT THIS FARM WRITES DOWN. THAT WAS NEVER WRITTEN DOWN.',
    'DECODING... DECODING... THE LATTICE RETURNS SILENCE.',
    'THAT QUESTION BELONGS TO ANOTHER STATION. THIS ONE GROWS MUSHROOMS.',
    'CARGO HOLD SEARCHED, BLOCKS COUNTED, LOGS READ: NOTHING ABOUT THAT.',
    'THE MYCELIUM HAS NO OPINION ON THAT, AND NEITHER DO I.',
    'OUT OF RANGE. MY SENSORS END AT THE FARM GATE.',
    'THAT TRANSMISSION IS NOT ADDRESSED TO THIS TERMINAL.',
    'RECORDS VAULT CHECKED TWICE. THAT DRAWER DOES NOT EXIST.',
  ],
  money: [
    'CREW CLEARANCE TOO LOW FOR THE MONEY VAULT. ASK THE OWNER.',
    'THE LEDGER BULKHEAD STAYS SHUT FOR CREW. OWNER CODES ONLY.',
    'THAT COMPARTMENT IS OWNER-SEALED. MY LIPS ARE SPORE-TIGHT.',
    'COIN DECK LOCKED FROM THIS SEAT. THE OWNER HOLDS THE KEY.',
    'MONEY RECORDS ARE BEHIND THE OWNER HATCH. I CANNOT OPEN IT FOR YOU.',
  ],
  engine: [
    'THE THINKING CORE IS DARK. RULE CIRCUITS ANSWERED INSTEAD.',
    'DEEP CORE NOT RESPONDING. RUNNING ON BACKUP LOGIC.',
    'NO PULSE FROM THE MODEL BAY. THE RULE BOOK TOOK THE WATCH.',
    'MODEL BAY COLD. SWITCHED TO HAND CONTROLS.',
  ],
  unclear: [
    'THE LATTICE HEARD YOU, BUT COULD NOT PLACE IT.',
    'TRANSMISSION GARBLED IN THE HUMIDITY. TRY FEWER WORDS.',
    'I TASTED THAT QUESTION FROM EVERY ANGLE. NO MATCH IN THE LOGS.',
    'SPORES SCATTERED, MEANING LOST. SAY IT ANOTHER WAY.',
  ],
}

/** What CAN be asked, after a refusal. */
export const CAN_ASK: Record<RefusalKind, string> = {
  scope: 'ASK ABOUT LOTS, HARVESTS, STRAINS, STOCK, POWER CUTS, CLIMATE OR WHAT IS DUE. TYPE EXAMPLES FOR A LIST.',
  money: 'STAFF CAN ASK ABOUT LOTS, HARVESTS, STOCK, POWER CUTS, CLIMATE AND WHAT IS DUE.',
  engine: 'SET THE MODEL UP ON ASK > ENGINE, OR KEEP USING THE SIMPLE SENTENCES.',
  unclear: 'TRY: HOW MANY LM BLOCKS ARE FRUITING / LOG 4.2 KG FROM B1020 / IS THE POWER OUT. TYPE EXAMPLES FOR MORE.',
}

/** Words that say plainly the question is not about the farm. Used only to pick the right voice. */
const OFF_WORLD = /\b(weather|forecast tomorrow|joke|news|president|capital of|movie|film|song|football|soccer|bitcoin|stock market|recipe|cook (?:a|the) |poem|story|translate|who are you|meaning of life|your name|love|god|aliens?)\b/

let turn = 0
/** The next line of this kind. Rotates so the same line does not repeat back to back. seed fixes it (tests). */
export function refusal(kind: RefusalKind, seed?: number): string {
  const list = REFUSALS[kind]
  const i = seed === undefined ? turn++ % list.length : Math.abs(seed) % list.length
  return list[i]
}

/** Scope voice when the words are plainly off the farm, otherwise "could not place it". */
export const kindFor = (text: string): RefusalKind => (OFF_WORLD.test(text.toLowerCase()) ? 'scope' : 'unclear')

/** Lines and film names this app must never use, checked by the tests. */
export const NEVER = ['mother', 'mu/th/ur', 'muthur', 'weyland', 'yutani', 'nostromo', 'ripley', 'xenomorph', 'facehugger', 'special order', 'crew expendable', 'no one can hear you scream', 'game over man', 'perfect organism', 'get away from her', 'sulaco', 'sevastopol', 'bishop', 'ash ', 'dallas', 'lambert', 'parker', 'kane', 'hadley', 'lv-426', 'apollo', 'seegson']
