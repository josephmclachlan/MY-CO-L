// Spanish toggle. Pure, no React: the hook is in src/settings/useT.ts.
//
// How it works: screens write their text in English, in capitals, as always, and wrap it: t('SAVE HARVEST').
// With the language on ES, t() looks the English text up in the Spanish table (src/lib/es.ts); text with no
// entry stays English, so a missed string is never blank. Numbers and templates: tf('HARVEST SAVED // {lot}', { lot }).
// The test in i18n.test.ts reads every t('...') and tf('...') in the code and fails if one has no Spanish entry,
// so a new string cannot silently stay English on a screen that claims to be translated.
//
// What is translated (G9): the frame (title bar, status line, F-keys, hints, prompt replies), main menu, module names,
// help, the new SEARCH, DATA and STAFF screens, glove mode, the new TUNE rows, and on MISSION CONTROL the LOG HARVEST
// and HARVEST SESSION screens (the tab names and BULK header too). NOT translated yet: the SCAN tab, the SYSTEM STATUS
// lines, the station status board and every other module screen. They stay English (see the PR and G12).
// Dates and numbers keep the same format in both languages (2026-11-06, 12.5): the entry boxes read that format.

import { ES } from './es'

export type Lang = 'EN' | 'ES'
export const LANGS: Lang[] = ['EN', 'ES']
export const LANG_NAME: Record<Lang, string> = { EN: 'ENGLISH', ES: 'ESPAÑOL' }

export function tr(lang: Lang, s: string): string {
  if (lang === 'EN') return s
  return ES[s] ?? s
}

export function trf(lang: Lang, s: string, vars: Record<string, string | number>): string {
  const base = tr(lang, s)
  return base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** The placeholder names in a template, sorted. */
export const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

export function normLang(v: unknown): Lang {
  return v === 'ES' ? 'ES' : 'EN'
}

/** Spanish words typed at the > prompt that mean an English command. The screens' own command list stays English. */
export const ES_COMMANDS: Record<string, string> = {
  AYUDA: 'HELP',
  INICIO: 'MENU',
  MENU: 'MENU',
  MENÚ: 'MENU',
  ATRAS: 'BACK',
  ATRÁS: 'BACK',
  DESHACER: 'UNDO',
  HISTORIAL: 'HISTORY',
  BUSCAR: 'FIND',
  BUSCA: 'FIND',
  COSECHA: 'HARVEST',
  COSECHAR: 'HARVEST',
  RESPALDO: 'BACKUP',
  COPIA: 'BACKUP',
  EXPORTAR: 'EXPORT',
  RESTAURAR: 'RESTORE',
  GUANTES: 'GLOVE',
  PERSONAL: 'STAFF',
  EMPLEADOS: 'STAFF',
  ESPAÑOL: 'SPANISH',
  ESPANOL: 'SPANISH',
  INGLES: 'ENGLISH',
  INGLÉS: 'ENGLISH',
  VENTAS: 'SALES',
  COSTOS: 'COSTS',
  DINERO: 'MONEY',
  CORTES: 'POWERCUTS',
  AGUA: 'WATER',
  CLIMA: 'CLIMATE',
  SILENCIO: 'MUTE',
  LIMPIO: 'CLEAN',
  AJUSTES: 'TUNE',
  ESTADO: 'STATUS',
  LOTES: 'LOTS',
  CEPAS: 'STRAINS',
  ESCANEAR: 'SCAN',
  ESCANER: 'SCAN',
  MASIVO: 'BULK',
}
