// The USER GUIDE text. One source: the in-app USER GUIDE screen and docs/USER-MANUAL.md (npm run docs:guide) both read it.
// Plain English, short sentences. About the app only: no textbook text (the textbook stays out of the public build).

import { BASICS } from './pages-basics'
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
  what: string
  blocks: GBlock[]
}

export const GUIDE_GROUPS = ['BASICS', 'FRAME', 'DAILY WORK', 'GROW', 'ROOMS AND POWER', 'MONEY', 'TOOLS', 'MORE'] as const

export const GUIDE: GSection[] = [...BASICS, ...FARM, ...MONEY, ...TOOLS, ...MORE]

export const findSection = (key: string): GSection | undefined => GUIDE.find((s) => s.key === key)

/** A word typed after GUIDE (a module name or number) to the page it means; START when unknown. */
export function guideSectionFor(arg: string): string {
  const a = arg.trim().toUpperCase()
  const hit = GUIDE.find((s) => s.key === a || s.title === a || s.title.startsWith(a))
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
