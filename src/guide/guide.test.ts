// USER GUIDE and tooltip checks: every screen has a page, every tab is on its page, every tip key can really match,
// the Markdown file is in step, and the lookups survive thousands of odd inputs.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULES } from '../data/farm'
import { OWNER_ONLY_MODULES, STAFF_MODULES, canOpenModule } from '../lib/roles'
import { ES } from '../lib/es'
import { GUIDE, GUIDE_GROUPS, findSection, guideSectionFor, searchGuide } from './content'
import { guideMarkdown } from './markdown'
import { normLabel, tipFor, tipForClass } from './tipLookup'
import { TIPS, TIP_RULES, TIP_SELECTORS } from './tips'

const ROOT = join(__dirname, '..', '..')
const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const allText = (s: (typeof GUIDE)[number]) => [s.title, s.what, ...s.blocks.flatMap((b) => [b.h, ...(b.text ?? []), ...(b.steps ?? []), ...(b.items ?? []).flat()])]

/** Which page explains each screen's list of tabs, and what the screen calls the tabs whose ids differ. */
const TAB_LISTS: Record<string, string> = {
  TABS: 'SPECIMEN', XENO_TABS: 'XENO', HAZARD_TABS: 'HAZARD', COOK_TABS: 'PROPULSION', TRADE_TABS: 'TRADE', MISSION_TABS: 'MISSION', YIELD_TABS: 'YIELD',
  ORDERS_TABS: 'ORDERS', MONEY_TABS: 'MONEY', FAC_TABS: 'FACILITY', AT_TABS: 'ATMOS', SEARCH_TABS: 'SEARCH', DATA_TABS: 'DATA', ASK_TABS: 'ASK',
}
const TAB_NAMES: Record<string, string> = {
  NEWLOT: 'NEW BLOCK LOT', PNL: 'PROFIT AND LOSS', WHATIF: 'WHAT-IF', FORECAST: 'HARVEST FORECAST', LIST: 'PRICE LIST', PICK: 'PICK + PACK', FIND: 'FIND A RECORD', ORDERS: 'STANDING ORDERS',
  CASH: '12-MONTH CASH FLOW', SPEND: 'SPENDING', BULK: 'CHANGE MANY', LOG: 'SALES LOG', SALE: 'NEW SALE',
}

describe('guide pages', () => {
  it('has one page per module, unique keys, known groups', () => {
    const keys = GUIDE.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const m of MODULES) expect(GUIDE.some((p) => p.module === m.key), `no guide page for ${m.key}`).toBe(true)
    for (const p of GUIDE) {
      expect(GUIDE_GROUPS as readonly string[]).toContain(p.group)
      if (p.module) expect(MODULES.some((m) => m.key === p.module)).toBe(true)
      expect(p.blocks.length).toBeGreaterThan(0)
    }
  })

  it('has a page for every frame screen (menu, help, tune, status, login)', () => {
    for (const k of ['MENU', 'HELP', 'TUNE', 'STATUS', 'LOGIN', 'START', 'SCREEN', 'KEYS', 'SAVING', 'TIPS']) expect(findSection(k), k).toBeTruthy()
  })

  it('mentions every tab of every screen on that screen\'s page', () => {
    const dir = join(ROOT, 'src', 'screens')
    const missing: string[] = []
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/export const (\w*TABS)(?::[^=]+)? = (?:\[([^\]]*)\])/g)) {
        const tabs = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
        const page = findSection(TAB_LISTS[m[1]] ?? '')
        if (!page) {
          missing.push(`${f} ${m[1]}: add it to TAB_LISTS in this test`)
          continue
        }
        const text = allText(page).join(' ').toUpperCase()
        for (const t of tabs) if (!text.includes(t) && !text.includes(TAB_NAMES[t] ?? t)) missing.push(`${page.key}: tab ${t} (${m[1]})`)
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps plain English: no fact ids, no textbook quotes, short sentences', () => {
    const long: string[] = []
    for (const p of GUIDE) {
      for (const t of allText(p)) {
        expect(/\bF\d\d-\d{4}\b/.test(t), `fact id in ${p.key}`).toBe(false)
        expect(/\{\{F/.test(t)).toBe(false)
        for (const sentence of t.split(/(?<=[.!?])\s+/)) if (words(sentence) > 45) long.push(`${p.key}: ${sentence.slice(0, 60)}...`)
      }
    }
    expect(long).toEqual([])
  })

  it('never names the film or game the look is NOT copied from', () => {
    const banned = /MU\/?TH\/?UR|WEYLAND|YUTANI|NOSTROMO|ALIEN/i
    for (const p of GUIDE) for (const t of allText(p)) expect(banned.test(t), `${p.key}: ${t.slice(0, 40)}`).toBe(false)
  })

  it('shows staff only pages for screens staff may open', () => {
    for (const m of OWNER_ONLY_MODULES) expect(canOpenModule('staff', m)).toBe(false)
    for (const m of STAFF_MODULES) expect(MODULES.some((x) => x.key === m)).toBe(true)
    expect(canOpenModule('staff', 'GUIDE')).toBe(true)
  })

  it('docs/USER-MANUAL.md is the current output of the guide text', () => {
    const file = join(ROOT, 'docs', 'USER-MANUAL.md')
    expect(existsSync(file), 'run npm run docs:guide').toBe(true)
    expect(readFileSync(file, 'utf8'), 'run npm run docs:guide').toBe(guideMarkdown())
  })

  it('guide search finds pages and GUIDE <name> maps to a page', () => {
    expect(searchGuide('undo').map((h) => h.key)).toContain('SAVING')
    expect(searchGuide('power cut').map((h) => h.key)).toContain('FACILITY')
    expect(searchGuide('zzzzqqq')).toEqual([])
    expect(searchGuide('a')).toEqual([])
    expect(guideSectionFor('vitals')).toBe('VITALS')
    expect(guideSectionFor('MISSION')).toBe('MISSION')
    expect(guideSectionFor('nonsense words')).toBe('START')
  })
})

describe('tooltip text', () => {
  it('every dictionary key is spelled the way normLabel() writes it, or it could never match', () => {
    const bad = Object.keys(TIPS).filter((k) => normLabel(k) !== k)
    expect(bad).toEqual([])
  })
  it('has no duplicate dictionary keys', () => {
    const src = readFileSync(join(__dirname, 'tips.ts'), 'utf8')
    const body = src.slice(src.indexOf('export const TIPS'), src.indexOf('export const TIP_RULES'))
    const keys = [...body.matchAll(/^ {2}(?:'((?:[^'\\]|\\.)*)'|"([^"]*)"|([A-Z0-9]+)): /gm)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'"))
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dup).toEqual([])
    expect(keys.length).toBeGreaterThan(300)
  })
  it('every tip is one or two short sentences, with no film or textbook words', () => {
    const all = [...Object.entries(TIPS), ...TIP_RULES.map(([r, t]) => [String(r), t] as [string, string]), ...TIP_SELECTORS.map(([s, t]) => [s, t] as [string, string])]
    for (const [k, t] of all) {
      expect(t.length, k).toBeGreaterThan(5)
      expect(t.length, k).toBeLessThanOrEqual(230)
      expect(/\bF\d\d-\d{4}\b/.test(t), k).toBe(false)
      expect(/MU\/?TH\/?UR|WEYLAND|ALIEN/i.test(t), k).toBe(false)
      expect(t.trim().endsWith('.') || t.trim().endsWith('?'), `${k} should end with a full stop`).toBe(true)
    }
  })
  it('normLabel strips counts, colons, signs and zero-padded indexes only', () => {
    expect(normLabel('REMINDERS3')).toBe('REMINDERS')
    expect(normLabel('LAB0.8K')).toBe('LAB')
    expect(normLabel('01 BLUE OYSTER52')).toBe('BLUE OYSTER')
    expect(normLabel('+ 75X')).toBe('75X')
    expect(normLabel('CO2')).toBe('CO2')
    expect(normLabel('24 H')).toBe('24 H')
    expect(normLabel('ENGINE (LOCAL MODEL)')).toBe('ENGINE')
    expect(normLabel('Save: ')).toBe('SAVE')
    expect(normLabel('₡ PER KG')).toBe('₡ PER KG')
  })
  it('finds tips by label, by Spanish label, by rule and by class', () => {
    expect(tipFor('SAVE')).toMatch(/saved|Save/)
    expect(tipFor('Save')).toBe(tipFor('SAVE'))
    expect(tipFor('REMINDERS3')).toBe(TIPS.REMINDERS)
    expect(tipFor('NOV 26')).toMatch(/month/)
    expect(tipFor('Counted Agar powder')).toMatch(/counted/)
    expect(tipFor('x'.repeat(80))).toBeNull()
    expect(tipFor('')).toBeNull()
    expect(tipFor(ES.CLEAN ?? 'LIMPIO')).toBeTruthy()
    const li = { matches: (s: string) => s === '.cg-row' } as unknown as Element
    expect(tipForClass(li)).toMatch(/stock item/)
  })
  it('stress: 60,000 odd labels never throw and always finish fast', () => {
    const t0 = Date.now()
    let seed = 12345
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 +-:./()&%#₡ÑÉ▾✕[]X<>\n\t'
    let found = 0
    for (let i = 0; i < 60000; i++) {
      const n = Math.floor(rnd() * 70)
      let s = ''
      for (let j = 0; j < n; j++) s += pool[Math.floor(rnd() * pool.length)]
      const r = tipFor(s)
      if (r !== null) {
        found++
        expect(typeof r).toBe('string')
      }
      expect(typeof normLabel(s)).toBe('string')
    }
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(found).toBeGreaterThanOrEqual(0)
  })
  it('stress: guide search over 4,000 random queries never throws', () => {
    let seed = 99
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const vocab = ['undo', 'save', 'harvest', 'lot', 'power', 'cut', 'tab', 'zz', 'a', 'backup', 'staff', 'tip', '???', '(', '[', '\\', '*']
    for (let i = 0; i < 4000; i++) {
      const q = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => vocab[Math.floor(rnd() * vocab.length)]).join(' ')
      for (const h of searchGuide(q)) expect(findSection(h.key)).toBeTruthy()
    }
  })
})
