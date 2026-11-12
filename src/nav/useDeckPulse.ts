import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { useTable } from '../store/StoreContext'
import { useRecords } from '../store/useRecords'
import { useReminders } from '../store/useFacility'
import { useCargo } from '../store/useCargo'
import { useMoney } from '../store/useMoney'
import { useSensors } from '../store/useSensors'
import { useRates } from '../store/useRates'
import { useRole } from '../settings/RoleContext'
import { useNag } from '../screens/Data'
import { board } from '../lib/mission'
import { bankStatus, type BankTest, type ViabilityCheck } from '../lib/bank'
import type { Culture } from '../lib/xeno'
import { cashFlow, monthLabel, monthOf, pnlMonth, type WasteEntry } from '../lib/money'
import { fmtCrc } from '../lib/cargo'
import { shortCrc } from '../components/Charts'
import { coldStore, dueGroups, weeklyKg, weeklySales } from '../lib/overview'
import type { DeckId } from './decks'

// One quick reading of every deck, for the main menu, the deck pages and the badges beside stations.
// Money figures only for a person who may see money (staff read the money tables as empty anyway).

export interface DeckPulse {
  /** The deck's headline, in a few words. */
  fig: Record<DeckId, string>
  /** How many things on the deck want attention now. */
  alerts: Record<DeckId, number>
  /** Those things in words. */
  alertText: Record<DeckId, string>
  /** Short counts beside stations, by station id. */
  badge: Record<string, string>
  /** The deck's tile on the BRIDGE: one big figure, a line of words, and a trend when there is one. */
  head: Record<DeckId, Head>
}
export interface Head {
  value: string
  sub: string
  spark?: number[]
  sparkLabel?: string
}

const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`

const EMPTY: DeckPulse = { fig: {} as Record<DeckId, string>, alerts: {} as Record<DeckId, number>, alertText: {} as Record<DeckId, string>, badge: {}, head: {} as Record<DeckId, Head> }
const PulseContext = createContext<DeckPulse>(EMPTY)

/**
 * Works the pulse out once for the whole shell. It sits in its own component so that the clocks and tables it
 * listens to re-draw only the menu, the deck page and the station list, never the whole app.
 */
export function DeckPulseProvider({ children }: { children: ReactNode }) {
  return createElement(PulseContext.Provider, { value: useDeckPulse() }, children)
}
/** The pulse from the nearest provider (empty figures outside one). */
export const usePulse = (): DeckPulse => useContext(PulseContext)

export function useDeckPulse(): DeckPulse {
  const role = useRole()
  const rec = useRecords()
  const rem = useReminders()
  const cargo = useCargo()
  const money = useMoney()
  const sens = useSensors()
  const rt = useRates()
  const nag = useNag()
  const cultures = useTable<Culture>('cultures')
  const checks = useTable<ViabilityCheck>('viability_checks')
  const tests = useTable<BankTest>('bank_tests')
  const waste = useTable<WasteEntry>('waste_log')
  const today = rem.today
  // Each hook hands back a fresh object every render, so the work below keys on the rows themselves.
  const { lots, losses, harvests, strains, practice, fading } = rec
  const { sales, owed, pnl, bud, cash, settings } = money
  const nagText = nag.text
  const nagWarn = nag.warn

  return useMemo(() => {
    const fig = {} as Record<DeckId, string>
    const alerts = {} as Record<DeckId, number>
    const alertText = {} as Record<DeckId, string>
    const badge: Record<string, string> = {}
    const head = {} as Record<DeckId, Head>

    // BRIDGE: the work list.
    const g = dueGroups(rem.reminders, today)
    const now = g.overdue.length + g.today.length
    fig.bridge = now ? `${plural(now, 'JOB')} DUE TODAY` : 'NOTHING DUE TODAY'
    alerts.bridge = g.overdue.length
    alertText.bridge = g.overdue.length ? `${g.overdue.length} OVERDUE` : ''
    head.bridge = { value: plural(now, 'JOB'), sub: `DUE TODAY // ${g.overdue.length} OVERDUE // ${g.week.length} THIS WEEK` }
    if (now) badge.today = String(now)
    if (rem.reminders.length) badge.reminders = String(rem.reminders.length)

    // GROW DECK: lots and kilos.
    const rows = board(lots, losses, harvests, today)
    const kgWeek = weeklyKg(harvests, today, 1)[0].kg
    const late = rows.filter((r) => r.move === 'LATE' || r.harvestFlag === 'LATE').length
    fig.grow = `${kgWeek.toFixed(1)} KG PICKED THIS WEEK // ${plural(rows.length, 'LOT')}`
    alerts.grow = late
    alertText.grow = late ? `${plural(late, 'LOT')} LATE TO MOVE OR PICK` : ''
    const kg8 = weeklyKg(harvests, today, 8).map((w) => w.kg)
    head.grow = { value: `${kgWeek.toFixed(1)} KG`, sub: `PICKED THIS WEEK // ${plural(rows.length, 'LOT')} GROWING`, spark: kg8, sparkLabel: 'Kg picked a week, last 8 weeks' }
    if (rows.length) badge.lots = String(rows.length)
    const pickNow = rows.filter((r) => r.harvestFlag === 'DUE' || r.harvestFlag === 'LATE').length
    if (pickNow) badge.harvest = `${pickNow} DUE`

    // XENOLAB: the culture bank.
    const active = strains.filter((s) => s.active)
    let tubes = 0
    let due = 0
    for (const s of active) {
      const b = bankStatus(s, cultures, checks, tests, practice, today)
      tubes += b.slants + b.water
      due += b.due
    }
    fig.xenolab = `${plural(active.length, 'STRAIN')} // ${tubes} BANK TUBES`
    alerts.xenolab = due
    alertText.xenolab = due ? `${plural(due, 'TUBE')} DUE FOR TRANSFER` : ''
    head.xenolab = { value: `${tubes} TUBES`, sub: `IN THE BANK // ${due} DUE FOR TRANSFER // ${plural(active.length, 'STRAIN')}` }
    if (due) badge.bank = `${due} DUE`
    const fadingN = fading.filter((f) => f.fading).length
    if (fadingN) badge.strains = `${fadingN} FADING`

    // CARGO HOLD: reorders and fresh kilos.
    const low = cargo.rows.filter((r) => r.state === 'LOW' || r.state === 'OUT').length
    const out = cargo.rows.filter((r) => r.state === 'OUT').length
    const cold = role.money ? coldStore(harvests, lots, sales, waste, today, rt.shelfDays) : null
    fig.cargo = cold ? `${cold.onHand.toFixed(1)} KG FRESH // ${low} TO REORDER` : `${plural(low, 'ITEM')} TO REORDER`
    alerts.cargo = low
    alertText.cargo = low ? `${low} TO REORDER${out ? `, ${out} OUT` : ''}` : ''
    head.cargo = { value: `${low} LOW`, sub: `SUPPLIES TO REORDER${out ? ` // ${out} OUT` : ''}${cold ? ` // ${cold.onHand.toFixed(1)} KG FRESH` : ''}` }
    if (low) badge.manifest = `${low} LOW`
    if (cold && cold.onHand > 0.05) badge.cold = `${cold.onHand.toFixed(1)} KG`

    // TRADE DOCK and BURSAR.
    if (role.money) {
      const wk = weeklySales(sales, today, 1)[0].crc
      const longOwed = owed.buyers.filter((b) => b.days > 30).length
      fig.trade = `${fmtCrc(wk)} SOLD THIS WEEK`
      alerts.trade = longOwed
      alertText.trade = longOwed ? `${plural(longOwed, 'BUYER')} OWING OVER 30 DAYS` : ''
      if (owed.buyers.length) badge.owed = String(owed.buyers.length)
      const sales8 = weeklySales(sales, today, 8).map((w) => w.crc)
      head.trade = { value: shortCrc(wk), sub: `SOLD THIS WEEK // ${shortCrc(owed.total)} OWED`, spark: sales8, sparkLabel: 'Colones sold a week, last 8 weeks' }
      const m = monthOf(today)
      const p = pnlMonth(m, pnl, bud, sales)
      const cf = cashFlow(cash, bud, settings.startMonth ?? m, today, settings.openingCash, settings.floorMonths)
      fig.bursar = `${monthLabel(m)} PROFIT ${fmtCrc(p.profit)}`
      alerts.bursar = cf.below.length ? 1 : 0
      alertText.bursar = cf.below.length ? `CASH UNDER THE FLOOR IN ${plural(cf.below.length, 'MONTH')}` : ''
      const nowM = cf.months.find((x) => x.basis === 'NOW')
      const ends = cf.months.filter((x) => x.basis !== 'PLAN').map((x) => x.end)
      head.bursar = { value: shortCrc(nowM?.end ?? cf.opening), sub: `CASH NOW // ${monthLabel(m)} PROFIT ${shortCrc(p.profit)}`, spark: ends.length > 1 ? ends : undefined, sparkLabel: 'Cash at the end of each month so far' }
    } else {
      fig.trade = fig.bursar = 'OWNER ONLY'
      alerts.trade = alerts.bursar = 0
      alertText.trade = alertText.bursar = ''
      head.trade = head.bursar = { value: 'OWNER', sub: 'OWNER ONLY' }
    }

    // ENGINEERING: climate, power, upkeep.
    const climate = sens.alarms.filter((a) => !a.acked && a.kind !== 'POWER').length
    const withData = sens.board.filter((p) => p.last !== null)
    const inBand = withData.filter((p) => !p.out).length
    const maintLate = rem.board.filter((m) => m.state === 'late').length
    const cut = rem.summary.open
    fig.engineering = cut ? 'GRID DOWN NOW' : withData.length ? `${inBand}/${withData.length} ROOMS IN BAND // GRID UP` : 'GRID UP // NO CLIMATE READINGS'
    alerts.engineering = climate + maintLate + (cut ? 1 : 0)
    alertText.engineering = [cut ? 'POWER CUT NOW' : '', climate ? plural(climate, 'CLIMATE ALARM') : '', maintLate ? `${maintLate} UPKEEP OVERDUE` : ''].filter(Boolean).join(', ')
    head.engineering = {
      value: cut ? 'GRID DOWN' : climate ? plural(climate, 'ALARM') : maintLate ? `${maintLate} LATE` : 'ALL CLEAR',
      sub: `${withData.length ? `${inBand}/${withData.length} ROOMS IN BAND` : 'NO CLIMATE READINGS'} // ${maintLate} UPKEEP LATE`,
    }
    if (climate) badge.life = `${climate} ALARM${climate === 1 ? '' : 'S'}`
    if (cut) badge.cuts = 'OUT NOW'
    const upDue = rem.board.filter((m) => m.state === 'late' || m.state === 'due').length
    if (upDue) badge.upkeep = `${upDue} DUE`

    // MAINFRAME: backups.
    fig.mainframe = nagText
    alerts.mainframe = nagWarn && role.role === 'owner' ? 1 : 0
    alertText.mainframe = alerts.mainframe ? 'BACKUP DUE' : ''
    if (alerts.mainframe) badge.vault = 'DUE'
    head.mainframe = { value: nagWarn ? 'BACKUP DUE' : 'BACKED UP', sub: nagText }

    return { fig, alerts, alertText, badge, head }
  }, [role.money, role.role, lots, losses, harvests, strains, practice, fading, rem.reminders, rem.board, rem.summary.open, today, cargo.rows, sales, owed, pnl, bud, cash, settings, sens.alarms, sens.board, rt.shelfDays, nagText, nagWarn, cultures, checks, tests, waste])
}
