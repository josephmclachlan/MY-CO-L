// The USER GUIDE text. One source: the in-app USER GUIDE screen and docs/USER-MANUAL.md (npm run docs:guide) both read it.
// Plain English, short sentences. About the app only: no textbook text (the textbook stays out of the public build).

import { DECKS, STATIONS, parseNav, type DeckId } from '../nav/decks'
import { BASICS } from './pages-basics'
import { DECKS_PAGE, DECK_PAGES } from './pages-decks'
import { FARM } from './pages-farm'
import { MONEY, TOOLS, MORE } from './pages-money'

export interface GBlock {
  h: string
  text?: string[]
  steps?: string[]
  items?: [string, string][]
}
export interface GSection {
  key: string
  title: string
  group: string
  /** The screen's module key: the guide offers an OPEN THIS SCREEN button, and staff only see pages for screens they may open. */
  module?: string
  /** A deck's overview page: the guide offers an OPEN THIS DECK button, and staff only see decks they may open. */
  deck?: DeckId
  what: string
  blocks: GBlock[]
}

/** The guide follows the deck map: the basics, the frame, then one group per deck (1 BRIDGE ... 8 MAINFRAME). */
export const deckGroup = (num: number): string => {
  const d = DECKS.find((x) => x.num === num)
  return d ? `${d.num} ${d.name}` : 'MORE'
}
export const GUIDE_GROUPS: readonly string[] = ['BASICS', 'FRAME', ...DECKS.map((d) => deckGroup(d.num)), 'MORE']

/** Where a page sits inside its deck group: the deck's own page first, then screens in the order of their stations. */
function rankInGroup(p: GSection): number {
  if (p.deck) return 0
  const deck = DECKS.find((d) => deckGroup(d.num) === p.group)
  if (!deck) return 0
  const screen = p.module ?? p.key
  const at = STATIONS.filter((s) => s.deck.id === deck.id && s.screen === screen).map((s) => s.pos)
  return at.length ? Math.min(...at) : 99
}

const [START, ...BASICS_REST] = BASICS
const ALL: GSection[] = [START, DECKS_PAGE, ...BASICS_REST, ...DECK_PAGES, ...FARM, ...MONEY, ...TOOLS, ...MORE]

export const GUIDE: GSection[] = ALL.map((p, i) => ({ p, i }))
  .sort((a, b) => GUIDE_GROUPS.indexOf(a.p.group) - GUIDE_GROUPS.indexOf(b.p.group) || rankInGroup(a.p) - rankInGroup(b.p) || a.i - b.i)
  .map((x) => x.p)

export const findSection = (key: string): GSection | undefined => GUIDE.find((s) => s.key === key)

/** The guide page for a deck's overview. */
export const deckPageKey = (deck: string): string => GUIDE.find((s) => s.deck === deck)?.key ?? 'DECKS'

/** The guide page that explains a screen (a module key, or TUNE). */
export const screenPageKey = (screen: string): string | undefined => GUIDE.find((s) => (s.module ?? s.key) === screen)?.key

const bareTitle = (title: string) => title.replace(/\s*\([^)]*\)$/, '')

/**
 * A word typed after GUIDE to the page it means: a page name, a deck (5, TRADE DOCK), a station (5.3, COLD STORE)
 * or an old screen name (VITALS). START when unknown.
 */
export function guideSectionFor(arg: string): string {
  const a = arg.trim().toUpperCase()
  if (!a) return 'START'
  const exact = GUIDE.find((s) => s.key === a) ?? GUIDE.find((s) => s.title === a || bareTitle(s.title) === a)
  if (exact) return exact.key
  const nav = parseNav(a)
  if (nav?.kind === 'deck') return deckPageKey(nav.deck.id)
  if (nav?.kind === 'station') return screenPageKey(nav.station.screen) ?? 'DECKS'
  const hit = GUIDE.find((s) => s.title.startsWith(a))
  return hit ? hit.key : 'START'
}

export interface GuideHit {
  key: string
  title: string
  snippet: string
  at: number
}
/** Every page and block holding all the words typed, best page first. */
export function searchGuide(q: string): GuideHit[] {
  const words = q.toUpperCase().split(/\s+/).filter((w) => w.length > 1)
  if (!words.length) return []
  const out: GuideHit[] = []
  for (const s of GUIDE) {
    const parts: string[] = [s.title, s.what]
    for (const b of s.blocks) parts.push(b.h, ...(b.text ?? []), ...(b.steps ?? []), ...(b.items ?? []).flatMap(([k, v]) => [k, v]))
    const whole = parts.join(' \n ').toUpperCase()
    if (!words.every((w) => whole.includes(w))) continue
    const first = parts.find((p) => words.every((w) => p.toUpperCase().includes(w))) ?? parts.find((p) => p.toUpperCase().includes(words[0])) ?? s.what
    out.push({ key: s.key, title: s.title, snippet: first.length > 140 ? first.slice(0, 137) + '...' : first, at: out.length })
  }
  return out
}
