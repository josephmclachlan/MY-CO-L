// The deck map: every screen and tab has exactly one home, links go somewhere real, the prompt reads it right,
// and staff never see a money deck.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DECKS, STATIONS, normTab, parseNav, stationById, stationFor, visibleDecks, visibleStations } from './decks'
import { MODULES } from '../data/farm'
import { canOpenModule } from '../lib/roles'

const SCREENS = join(__dirname, '..', 'screens')
/** Tab lists as each screen exports them, read from the source so the test follows the screens. */
function tabList(file: string, name: string): string[] {
  const src = readFileSync(join(SCREENS, file), 'utf8')
  const m = new RegExp(`export const ${name}(?::[^=]+)? = \\[([^\\]]*)\\]`).exec(src)
  if (!m) throw new Error(`${name} not found in ${file}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
/** The screens split across stations, and every tab each one has. */
const SPLIT: Record<string, string[]> = {
  MISSION: tabList('Mission.tsx', 'MISSION_TABS'),
  XENO: tabList('Xeno.tsx', 'XENO_TABS'),
  MONEY: tabList('Money.tsx', 'MONEY_TABS'),
  TRADE: tabList('Trade.tsx', 'TRADE_TABS'),
  ORDERS: tabList('Orders.tsx', 'ORDERS_TABS'),
  FACILITY: tabList('Facility.tsx', 'FAC_TABS'),
  LEDGER: ['overview', 'bills', 'labour', 'settings'],
}
const staff = (screen: string) => screen === 'TUNE' || canOpenModule('staff', screen)
const owner = (screen: string) => screen === 'TUNE' || canOpenModule('owner', screen)

describe('deck map', () => {
  it('has 8 decks numbered 1 to 8, unique ids and names', () => {
    expect(DECKS.map((d) => d.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(new Set(DECKS.map((d) => d.id)).size).toBe(8)
    expect(new Set(DECKS.map((d) => d.name)).size).toBe(8)
  })

  it('gives every screen a home, and only real screens', () => {
    const screens = new Set(STATIONS.map((s) => s.screen))
    for (const m of MODULES) expect(screens.has(m.key), `${m.key} has no station`).toBe(true)
    for (const s of STATIONS) expect(s.screen === 'TUNE' || MODULES.some((m) => m.key === s.screen), `${s.id} opens unknown ${s.screen}`).toBe(true)
  })

  it('gives every tab of a split screen exactly one station', () => {
    const problems: string[] = []
    for (const [screen, tabs] of Object.entries(SPLIT)) {
      const mine = STATIONS.filter((s) => s.screen === screen)
      expect(mine.length, screen).toBeGreaterThan(1)
      for (const t of tabs) {
        const homes = mine.filter((s) => s.tabs?.includes(t))
        if (homes.length !== 1) problems.push(`${screen} ${t}: ${homes.length} homes`)
      }
      for (const s of mine) for (const t of s.tabs ?? []) if (!tabs.includes(t)) problems.push(`${s.id}: ${t} is not a ${screen} tab`)
      for (const s of mine) if (!s.tabs?.length) problems.push(`${s.id}: a split screen needs its tabs listed`)
    }
    expect(problems).toEqual([])
  })

  it('opens a whole screen from one station only when the screen is not split', () => {
    for (const m of MODULES) {
      if (SPLIT[m.key]) continue
      const mine = STATIONS.filter((s) => s.screen === m.key)
      expect(mine.length, m.key).toBe(1)
      expect(mine[0].tabs, m.key).toBeUndefined()
    }
  })

  it('finds the station for any screen and tab', () => {
    expect(stationFor('MONEY', 'OWED')?.id).toBe('owed')
    expect(stationFor('MONEY', 'RECEIPTS')?.id).toBe('owed')
    expect(stationFor('MONEY', 'PNL')?.deck.id).toBe('bursar')
    expect(stationFor('MONEY', 'WASTE')?.deck.id).toBe('cargo')
    expect(stationFor('LEDGER', 'week:2026-11-09')?.id).toBe('cogs')
    expect(stationFor('LEDGER', 'settings')?.id).toBe('pricebook')
    expect(stationFor('MISSION', 'TODAY')?.deck.id).toBe('bridge')
    expect(stationFor('FACILITY', 'POWER CUTS')?.deck.id).toBe('engineering')
    expect(stationFor('MONEY', 'NOT A TAB')?.id).toBe(STATIONS.find((s) => s.screen === 'MONEY')!.id)
    expect(stationFor('SPECIMEN')?.id).toBe('species')
    expect(stationFor('NOPE')).toBeUndefined()
    expect(normTab('LEDGER', 'week:x')).toBe('overview')
  })

  it('links every station to 1 to 4 others that exist, never to itself', () => {
    for (const s of STATIONS) {
      expect(s.related.length, s.id).toBeGreaterThanOrEqual(1)
      expect(s.related.length, s.id).toBeLessThanOrEqual(4)
      expect(new Set(s.related).size, s.id).toBe(s.related.length)
      for (const r of s.related) {
        expect(stationById(r), `${s.id} -> ${r}`).toBeTruthy()
        expect(r).not.toBe(s.id)
      }
    }
  })

  it('has unique station ids, names and codes, with plain words for each', () => {
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length)
    expect(new Set(STATIONS.map((s) => s.name)).size).toBe(STATIONS.length)
    expect(new Set(STATIONS.map((s) => s.code)).size).toBe(STATIONS.length)
    for (const s of STATIONS) {
      expect(s.sub.length, s.id).toBeGreaterThan(8)
      expect(s.sub.length, s.id).toBeLessThanOrEqual(56)
      expect(s.name.length, s.id).toBeLessThanOrEqual(18)
    }
    expect(STATIONS.length).toBe(48)
  })

  it('never names the film or game the look is not copied from', () => {
    const banned = /MU\/?TH\/?UR|WEYLAND|YUTANI|NOSTROMO|ALIEN|ISHIMURA/i
    for (const d of DECKS) {
      expect(banned.test(`${d.name} ${d.sub} ${d.words.join(' ')}`)).toBe(false)
      for (const s of d.stations) expect(banned.test(`${s.name} ${s.sub} ${(s.words ?? []).join(' ')}`), s.id).toBe(false)
    }
  })
})

describe('roles', () => {
  it('hides TRADE DOCK and BURSAR from staff, and every money station', () => {
    const decks = visibleDecks(staff).map((d) => d.id)
    expect(decks).toEqual(['bridge', 'grow', 'xenolab', 'cargo', 'engineering', 'mainframe'])
    const cargo = visibleStations(DECKS.find((d) => d.id === 'cargo')!, staff).map((s) => s.id)
    expect(cargo).toEqual(['manifest'])
    for (const s of STATIONS) if (['MONEY', 'LEDGER', 'TRADE', 'ORDERS', 'COLD'].includes(s.screen)) expect(staff(s.screen), s.id).toBe(false)
  })
  it('shows the owner all 8 decks and every station', () => {
    expect(visibleDecks(owner).length).toBe(8)
    for (const d of DECKS) expect(visibleStations(d, owner).length).toBe(d.stations.length)
  })
})

describe('the prompt', () => {
  it('opens decks by number and name, stations by code and name', () => {
    expect(parseNav('0')).toEqual({ kind: 'menu' })
    expect(parseNav('00')).toEqual({ kind: 'menu' })
    expect(parseNav('5')).toMatchObject({ kind: 'deck', deck: { id: 'trade' } })
    expect(parseNav('5.6')).toMatchObject({ kind: 'station', station: { id: 'owed' } })
    expect(parseNav('5 6')).toMatchObject({ kind: 'station', station: { id: 'owed' } })
    expect(parseNav('4,2')).toMatchObject({ kind: 'station', station: { id: 'cold' } })
    expect(parseNav('grow deck')).toMatchObject({ kind: 'deck', deck: { id: 'grow' } })
    expect(parseNav('BURSAR')).toMatchObject({ kind: 'deck', deck: { id: 'bursar' } })
    expect(parseNav('TREASURY')).toMatchObject({ kind: 'deck', deck: { id: 'bursar' } })
    expect(parseNav('MONEY')).toMatchObject({ kind: 'deck', deck: { id: 'bursar' } })
    expect(parseNav('cargo hold')).toMatchObject({ kind: 'deck', deck: { id: 'cargo' } })
    expect(parseNav('COLD STORE')).toMatchObject({ kind: 'station', station: { id: 'cold' } })
    expect(parseNav('cold')).toMatchObject({ kind: 'station', station: { id: 'cold' } })
    expect(parseNav('PRICE BOOK')).toMatchObject({ kind: 'station', station: { id: 'pricebook' } })
    expect(parseNav('trace + recall')).toMatchObject({ kind: 'station', station: { id: 'trace' } })
    expect(parseNav('POWER GRID')).toMatchObject({ kind: 'station', station: { id: 'grid' } })
    expect(parseNav("today's work")).toMatchObject({ kind: 'station', station: { id: 'today' } })
  })
  it('says plainly when a number is not a deck or station', () => {
    expect(parseNav('9')).toMatchObject({ kind: 'bad' })
    expect(parseNav('23')).toMatchObject({ kind: 'bad' })
    expect(parseNav('1.9')).toMatchObject({ kind: 'bad' })
  })
  it('leaves other commands alone: one-word names, codes, questions and plain-words logs', () => {
    for (const w of ['1-2', '5-6', 'S4', 'TRADE', 'CARGO', 'OWED', 'BUDGET', 'TODAY', 'LM-01', 'B1020', 'LOG 4.2 KG FROM B1020', 'HOW MANY BLOCKS?', 'CURVE', 'PLANNER', 'OVERVIEW', 'GUIDE', 'SEARCH', 'POWER', 'ASK', 'BANK', '/B1020', ''])
      expect(parseNav(w), w).toBeNull()
  })
  it('stress: 20,000 random inputs never throw', () => {
    let seed = 3
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
    const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,+-/?\''
    for (let i = 0; i < 20000; i++) {
      const s = Array.from({ length: Math.floor(rnd() * 14) }, () => pool[Math.floor(rnd() * pool.length)]).join('')
      const r = parseNav(s)
      if (r) expect(['menu', 'deck', 'station', 'bad']).toContain(r.kind)
    }
  })
})

describe('screens follow the map', () => {
  it('every screen with a tab picker cuts it down to the open station', () => {
    const missing: string[] = []
    for (const f of readdirSync(SCREENS).filter((x) => x.endsWith('.tsx'))) {
      const src = readFileSync(join(SCREENS, f), 'utf8')
      for (const key of ['MISSION_TABS', 'MONEY_TABS', 'TRADE_TABS', 'ORDERS_TABS', 'FAC_TABS', 'XENO_TABS'])
        if (new RegExp(`${key}\\.map\\(`).test(src)) missing.push(`${f}: ${key}.map should be useStationTabs(${key}).map`)
    }
    expect(missing).toEqual([])
  })
})
