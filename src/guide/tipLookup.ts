import { ES } from '../lib/es'
import { TIPS, TIP_RULES, TIP_SELECTORS } from './tips'

/** A count stuck on the end of a tab or list row ("REMINDERS3", "LAB0.8K"): not part of its name. */
function stripCount(s: string): string {
  const r = s.replace(/(?<=[A-Z)])\d+(\.\d+)?K?$/, '')
  return r.length >= 3 ? r : s
}

/** Same label, same spelling: caps, no accents, no leading signs or numbers, no trailing counts or colons. */
export function normLabel(s: string): string {
  const t = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Z0-9\u20A1$]+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^0\d\s+(?=[A-Z])/, '')
    .replace(/[\s:.\u2026\u25BE\u25B8\u25BC\u2715\u00D7+]+$/, '')
    .trim()
  return stripCount(t)
}

let backMap: Map<string, string> | null = null
/** Spanish screen text back to the English key (the tips are written against the English labels). */
function toEnglish(label: string): string {
  if (!backMap) {
    backMap = new Map()
    for (const [en, es] of Object.entries(ES)) {
      const k = normLabel(es)
      if (k && !backMap.has(k)) backMap.set(k, normLabel(en))
    }
  }
  return backMap.get(label) ?? label
}

export const MAX_LABEL = 48
/** Long captions may still match a rule ("LOT CODES (E.G. ...) // NEEDED FOR ..."). */
export const MAX_RULE_LABEL = 120

/** The tip for a label, or null when there is none. */
export function tipFor(raw: string): string | null {
  const label = normLabel(raw)
  if (!label || label.length > MAX_RULE_LABEL) return null
  if (label.length <= MAX_LABEL) {
    for (const k of [label, toEnglish(label)]) {
      const hit = TIPS[k]
      if (hit) return hit
    }
  }
  for (const k of [label, toEnglish(label)]) {
    for (const [re, tip] of TIP_RULES) if (re.test(k)) return tip
  }
  return null
}

/** The tip for a control that has no label rule, from the kind of row or card it is. */
export function tipForClass(el: Element): string | null {
  for (const [sel, tip] of TIP_SELECTORS) if (el.matches(sel)) return tip
  return null
}
