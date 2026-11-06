// Spanish coverage: every string wrapped in t() / tt() / tf() / tr() / trf() has a Spanish entry with the same {placeholders}.
// Also the module names, greetings, help lines, hints and tab labels (they are looked up with t() from a variable).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ES } from './es'
import { ES_COMMANDS, SPANISH_ON, normLang, placeholders, tr, trf } from './i18n'

const ROOT = join(__dirname, '..')
const files: string[] = []
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) && f !== 'es.ts') files.push(p)
  }
}
walk(ROOT)
const code = (p: string) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
const unq = (s: string) => s.replace(/\\'/g, "'")
const Q = String.raw`'((?:[^'\\]|\\.)*)'`

/** Every English string the screens look up. */
function used(): Set<string> {
  const keys = new Set<string>()
  const add = (s: string | undefined) => {
    if (s !== undefined && /[A-Za-z]/.test(s)) keys.add(unq(s))
  }
  for (const f of files) {
    const s = code(f)
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:t|tt|tf)\(\s*` + Q, 'g'))) add(m[1])
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:tr|trf)\(\s*[\w.]+\s*,\s*` + Q, 'g'))) add(m[1])
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:tr|trf|t|tt|tf)\(\s*(?:[\w.]+\s*,\s*)?[^()'"]*?\?\s*` + Q + String.raw`\s*:\s*` + Q, 'g'))) {
      add(m[1])
      add(m[2])
    }
  }
  const app = code(join(ROOT, 'App.tsx'))
  for (const m of app.matchAll(new RegExp(String.raw`hints\.module =\s*` + Q, 'g'))) add(m[1])
  for (const blk of app.matchAll(/hints: Record<View\['name'\], string> = \{([\s\S]*?)\n {2}\}/g)) for (const m of blk[1].matchAll(new RegExp(String.raw`:\s*` + Q, 'g'))) add(m[1])
  for (const blk of app.matchAll(/TITLES: Record<View\['name'\], string> = \{([\s\S]*?)\n\}/g)) for (const m of blk[1].matchAll(new RegExp(String.raw`:\s*` + Q, 'g'))) add(m[1])
  const menu = code(join(ROOT, 'screens/Menu.tsx'))
  for (const blk of menu.matchAll(/GREETINGS = \[([\s\S]*?)\n\]/g)) for (const m of blk[1].matchAll(new RegExp(Q, 'g'))) add(m[1])
  const farm = readFileSync(join(ROOT, 'data/farm.ts'), 'utf8')
  for (const m of farm.matchAll(/name: '([^']*)', what: '([^']*)'/g)) {
    add(m[1])
    add(m[2])
  }
  const help = code(join(ROOT, 'screens/Help.tsx'))
  for (const blk of help.matchAll(/HELP_LINES = \[([\s\S]*?)\n\]/g)) for (const m of blk[1].matchAll(new RegExp(String.raw`^\s*` + Q + ',?$', 'gm'))) add(m[1])
  const labels: [string, RegExp][] = [
    ['screens/Mission.tsx', /TAB_LABEL: Record<MissionTab, string> = \{([\s\S]*?)\}/],
    ['screens/MissionBulk.tsx', /MODE_LABEL: Record<BulkMode, string> = \{([\s\S]*?)\}/],
    ['screens/Search.tsx', /TAB_LABEL: Record<SearchTab, string> = \{([\s\S]*?)\}/],
    ['screens/Data.tsx', /TAB_LABEL: Record<DataTab, string> = \{([\s\S]*?)\}/],
    ['screens/Ask.tsx', /TAB_LABEL: Record<AskTab, string> = \{([\s\S]*?)\}/],
  ]
  for (const [f, re] of labels) {
    const m = re.exec(code(join(ROOT, f)))
    if (!m) throw new Error('label map not found in ' + f)
    for (const mm of m[1].matchAll(new RegExp(String.raw`:\s*` + Q, 'g'))) add(mm[1])
  }
  for (const m of code(join(ROOT, 'lib/search.ts')).matchAll(/label: '([^']*)', cost/g)) add(m[1])
  for (const m of code(join(ROOT, 'screens/Search.tsx')).matchAll(/label: '([^']*)', table/g)) add(m[1])
  // the backup reminder returns its text as a key (dataExport.backupNag)
  for (const m of code(join(ROOT, 'lib/dataExport.ts')).matchAll(/'((?:NO BACKUP|BACKED UP|LAST BACKUP)[^']*)'/g)) add(m[1])
  // reasons that reach t() through a variable (bulkEdit skipped[].why)
  for (const m of code(join(ROOT, 'lib/bulkEdit.ts')).matchAll(/why: '([^']*)'/g)) add(m[1])
  // ASK: engine buttons and example group titles reach t() through a variable
  for (const m of code(join(ROOT, 'screens/Ask.tsx')).matchAll(/(?:label|title): '([^']*)'/g)) add(m[1])
  return keys
}

describe('Spanish dictionary', () => {
  const keys = used()
  it('finds the strings (guards the scanner itself)', () => {
    expect(keys.size).toBeGreaterThan(350)
    expect(keys.has('SAVE HARVEST')).toBe(true)
    expect(keys.has('OTHER RECORDS CAME FROM IT')).toBe(true)
    expect(keys.has('STAFF CANNOT OPEN {name}. ASK THE OWNER.')).toBe(true)
  })
  it('has Spanish for every string the screens look up', () => {
    const missing = [...keys].filter((k) => !(k in ES))
    expect(missing).toEqual([])
  })
  it('keeps every {placeholder} and has no stale entry nobody looks up', () => {
    for (const [k, v] of Object.entries(ES)) {
      expect(placeholders(v), k).toEqual(placeholders(k))
      expect(v.trim().length, k).toBeGreaterThan(0)
    }
    const stale = Object.keys(ES).filter((k) => !keys.has(k))
    expect(stale).toEqual([])
  })
  it('really translates (most entries differ from English)', () => {
    const same = Object.entries(ES).filter(([k, v]) => k === v).map(([k]) => k)
    // a few are the same word in both languages (KG, TOTAL, MANUAL) or lists of English commands
    expect(same.length).toBeLessThan(10)
  })
  it('tr and trf: English passes through, Spanish fills the placeholders, unknown text stays', () => {
    expect(tr('EN', 'SAVE HARVEST')).toBe('SAVE HARVEST')
    expect(tr('ES', 'SAVE HARVEST')).toBe('GUARDAR COSECHA')
    expect(tr('ES', 'NO SUCH TEXT')).toBe('NO SUCH TEXT')
    expect(trf('ES', '{n} FOUND', { n: 3 })).toBe('3 ENCONTRADOS')
    expect(trf('EN', '{n} FOUND', { n: 3 })).toBe('3 FOUND')
    expect(trf('ES', 'STOCK TAKE // {c} COUNTS SAVED', { c: 4 })).toBe('CONTEO DE INVENTARIO // 4 CONTEOS GUARDADOS')
    // Spanish is switched off for now (Joseph 6 Nov 2026): a saved ES falls back to English.
    expect(normLang('ES')).toBe(SPANISH_ON ? 'ES' : 'EN')
    expect(normLang('fr')).toBe('EN')
    expect(normLang(undefined)).toBe('EN')
  })
  it('Spanish command words map to real English commands', () => {
    for (const [es, en] of Object.entries(ES_COMMANDS)) {
      expect(es).toBe(es.toUpperCase())
      expect(en).toBe(en.toUpperCase())
    }
    expect(ES_COMMANDS.AYUDA).toBe('HELP')
    expect(ES_COMMANDS.COSECHA).toBe('HARVEST')
  })
})
