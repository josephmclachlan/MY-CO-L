import { useEffect, useMemo, type ReactNode } from 'react'
import { useApp } from '../settings/AppContext'
import { useRole } from '../settings/RoleContext'
import { useT } from '../settings/useT'
import { useSync, useTable } from '../store/StoreContext'
import { useRecords } from '../store/useRecords'
import { useReminders } from '../store/useFacility'
import { useCargo } from '../store/useCargo'
import { useMoney } from '../store/useMoney'
import { useSensors } from '../store/useSensors'
import { useRates } from '../store/useRates'
import { speciesName, useLedger } from '../store/useLedger'
import { usePower } from '../power/PowerContext'
import { useNag, DATA_GUESSES } from './Data'
import { FACILITY_GUESSES } from './Facility'
import { STAFF_GUESSES } from './Staff'
import { Emblem } from '../components/Emblem'
import { TypeText } from '../components/TypeText'
import { BarList, Columns, Count, Gauge, StackBar, Tile, shortCrc, shortNum, stillMotion, type BarRow, type Col, type Part } from '../components/Charts'
import { visibleDecks, visibleStations, type Deck, type DeckId } from '../nav/decks'
import { usePulse, type DeckPulse } from '../nav/useDeckPulse'
import { averageSplit, usePlan, weekSplit } from '../data/cropplan'
import { CEILING_A } from '../data/power'
import { LEDGER_GUESSES, TRADE_GUESSES } from '../data/ledger'
import { addDays, nextKnockDay, planChain, shortfall, strainStock, type Culture, type GrainRun } from '../lib/xeno'
import { bankAge, isBankTube, type BankTest, type ViabilityCheck } from '../lib/bank'
import { board } from '../lib/mission'
import { AGE_BUCKETS, MONEY_GUESSES, cashFlow, monthLabel, monthOf, addMonths, pnlMonth, type WasteEntry } from '../lib/money'
import { fmtCrc as crcBase } from '../lib/cargo'
import { PART_KEYS, PART_LABEL } from '../lib/ledger'
import { lastMonths } from '../lib/facility'
import { SENSOR_GUESSES, PLACES } from '../lib/sensors'
import { cohort, coldStore, contamByStrain, costPerKgParts, dueGroups, ordersDue, planKgPerWeek, salesByDay, topBuyers, weeklyKg, weeklySales } from '../lib/overview'
import type { OrderWeek, StandingOrder } from '../lib/orders'
import type { EditEntry } from '../lib/history'
import type { Reminder } from '../lib/facility'

// DECK OVERVIEWS (11 Nov 2026). Each deck opens on a live dashboard: its headline figures, the pictures that
// answer "how is this part of the farm doing", and the deck's stations as a sub menu. Every figure and every
// chart opens the station behind it. Figures come from lib/overview.ts (checked by hand in overview.test.ts)
// and the same helpers the screens use, so a number here always matches the screen it opens.

type Open = (stationId: string) => void
export type GoTo = { screen: string; tab?: string } | null

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const dayMon = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`
const crc = (v: number) => (Math.round(v) < 0 ? `-${crcBase(-v)}` : crcBase(v))
const crcShort = shortCrc
const kgF = (v: number) => `${v.toFixed(1)} KG`
const pct = (v: number) => `${v.toFixed(1)}%`
const plural = (n: number, one: string, many = `${one}S`) => `${n} ${n === 1 ? one : many}`

function Sec({ title, children, note, wide }: { title: string; children: ReactNode; note?: ReactNode; wide?: boolean }) {
  return (
    <section className={`ck-box dk-sec ${wide ? 'wide' : ''}`}>
      <div className="section-title">{title}</div>
      {children}
      {note && <div className="dim tiny">{note}</div>}
    </section>
  )
}

// ---------- the deck page ----------

export function DeckView({
  deck,
  canOpen,
  onStation,
  onDeck,
  onGo,
  arrive,
}: {
  deck: Deck
  canOpen: (screen: string) => boolean
  onStation: Open
  onDeck: (id: DeckId) => void
  onGo: (g: GoTo) => void
  /** Type the deck name in (true when the deck was just opened, not when coming back to it). */
  arrive: boolean
}) {
  const { sound } = useApp()
  const { t } = useT()
  const pulse = usePulse()
  const stations = visibleStations(deck, canOpen)
  const alerts = pulse.alerts[deck.id] ?? 0
  // The data chatter plays while the charts draw in.
  useEffect(() => {
    if (stillMotion()) return
    sound.beginData()
    const tm = window.setTimeout(() => sound.endData(), 900)
    return () => {
      window.clearTimeout(tm)
      sound.endData()
    }
  }, [deck.id, sound])
  const open = (id: string) => (sound.chirp(), onStation(id))
  const Overview = OVERVIEWS[deck.id]
  return (
    <div className={`dk-page dk-${deck.id}`}>
      <header className="dk-hero">
        <span className="dk-route" aria-hidden="true" />
        <Emblem id={deck.id} size={64} draw alert={alerts > 0} />
        <div className="dk-hero-text">
          <div className="dk-title" role="heading" aria-level={2}>
            <span className="dk-num">{deck.num}</span>
            <TypeText key={deck.id} lines={[t(deck.name)]} instant={!arrive} className="dk-name" />
          </div>
          <div className="dk-sub">{t(deck.sub)}</div>
          {alerts > 0 && pulse.alertText[deck.id] && (
            <div className="dk-alert" role="status">
              ! {pulse.alertText[deck.id]}
            </div>
          )}
        </div>
      </header>

      <nav className="dk-cards" aria-label={`${deck.name} stations`}>
        <div className="section-title">{t('STATIONS')}</div>
        <div className="dk-card-grid">
          {stations.map((s) => (
            <button type="button" key={s.id} className="dk-card" onClick={() => open(s.id)} data-tip={`${s.name}: ${s.sub}`}>
              <span className="dk-card-code">{s.code}</span>
              <b className="dk-card-name">{t(s.name)}</b>
              <span className="dk-card-sub">{t(s.sub)}</span>
              {pulse.badge[s.id] && <span className="dk-card-badge">{pulse.badge[s.id]}</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="dk-readout">
        <Overview pulse={pulse} open={open} canOpen={canOpen} onDeck={onDeck} onGo={onGo} />
      </div>
    </div>
  )
}

interface OvProps {
  pulse: DeckPulse
  open: Open
  canOpen: (screen: string) => boolean
  onDeck: (id: DeckId) => void
  onGo: (g: GoTo) => void
}

// ---------- 1 BRIDGE ----------

function WorkGroup({ title, list, warn, onGo, more }: { title: string; list: Reminder[]; warn?: boolean; onGo: (g: GoTo) => void; more: () => void }) {
  const show = list.slice(0, 6)
  return (
    <div className={`dk-work ${warn && list.length ? 'warn' : ''}`}>
      <div className="dk-work-head">
        {title} <b>{list.length}</b>
      </div>
      {list.length === 0 ? (
        <div className="dim tiny">NOTHING.</div>
      ) : (
        <ul className="dk-work-list">
          {show.map((r) => (
            <li key={r.key}>
              <button type="button" className={r.warn ? 'warn' : ''} onClick={() => onGo(r.go)}>
                <span className="dk-work-kind">{r.text.startsWith(r.kind) ? '' : r.kind}</span>
                <span>{r.text}</span>
                {r.due && <span className="dim">{dayMon(r.due)}</span>}
              </button>
            </li>
          ))}
          {list.length > show.length && (
            <li>
              <button type="button" className="dim" onClick={more}>
                + {list.length - show.length} MORE IN REMINDERS
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function BridgeOverview({ pulse, open, canOpen, onDeck, onGo }: OvProps) {
  const rem = useReminders()
  const g = useMemo(() => dueGroups(rem.reminders, rem.today), [rem.reminders, rem.today])
  const decks = visibleDecks(canOpen).filter((d) => d.id !== 'bridge')
  return (
    <>
      <Sec title="THE WHOLE FARM // TAP A DECK" wide>
        <div className="cx-tiles">
          {decks.map((d) => {
            const h = pulse.head[d.id]
            return <Tile key={d.id} label={`${d.num} ${d.name}`} value={h.value} sub={h.sub} spark={h.spark} sparkLabel={h.sparkLabel} warn={(pulse.alerts[d.id] ?? 0) > 0} onClick={() => onDeck(d.id)} tip={`Open ${d.name}.`} />
          })}
        </div>
      </Sec>
      <Sec title="WORK LIST // BY HOW URGENT" note="EACH LINE OPENS WHERE IT IS DONE. DUE DATES ARE THE FARM CLOCK." wide>
        <div className="dk-work-grid">
          <WorkGroup title="OVERDUE" list={g.overdue} warn onGo={onGo} more={() => open('reminders')} />
          <WorkGroup title="TODAY" list={g.today} onGo={onGo} more={() => open('reminders')} />
          <WorkGroup title="THIS WEEK" list={g.week} onGo={onGo} more={() => open('reminders')} />
        </div>
        <div className="lg-btns">
          <button type="button" className="btn" onClick={() => open('today')}>TODAY&apos;S WORK</button>
          <button type="button" className="btn" onClick={() => open('reminders')}>ALL REMINDERS</button>
        </div>
      </Sec>
    </>
  )
}

// ---------- 2 GROW DECK ----------

function GrowOverview({ open }: OvProps) {
  const rec = useRecords()
  const crop = usePlan()
  const today = useReminders().today
  const { lots, losses, harvests, recs } = rec
  const d = useMemo(() => {
    const lost = new Map<string, number>()
    for (const l of losses) lost.set(l.block_lot_id, (lost.get(l.block_lot_id) ?? 0) + Number(l.bag_count))
    const rows = board(lots, losses, harvests, today)
    const weeks = weeklyKg(harvests, today, 12)
    const done = recs.filter((r) => r.complete && r.be !== null).sort((a, b) => b.lot.knock_date.localeCompare(a.lot.knock_date)).slice(0, 5)
    const soonDay = addDays(today, 7)
    const soon = rows
      .map((r) => {
        if (r.move === 'LATE') return { r, what: 'MOVE TO FRUITING: LATE', warn: true }
        if (r.move === 'DUE') return { r, what: 'MOVE TO FRUITING NOW', warn: false }
        if (r.harvestFlag === 'LATE') return { r, what: 'FIRST PICK: LATE', warn: true }
        if (r.harvestFlag === 'DUE') return { r, what: 'FIRST PICK DUE', warn: false }
        if (r.harvestFlag === 'WAIT' && r.harvestOn && r.harvestOn <= soonDay) return { r, what: `FIRST PICK ABOUT ${dayMon(r.harvestOn)}`, warn: false }
        return null
      })
      .filter((x): x is { r: (typeof rows)[number]; what: string; warn: boolean } => !!x)
    return {
      rows,
      weeks,
      c: cohort(lots, lost, today, 90),
      plan: planKgPerWeek(averageSplit(crop)),
      be: done.length ? done.reduce((t, r) => t + (r.be as number), 0) / done.length : null,
      beN: done.length,
      soon,
    }
  }, [lots, losses, harvests, recs, today, crop])
  const inRooms = d.rows.reduce((t, r) => t + r.blocks, 0)
  const parts: Part[] = [
    { key: 'incubating', label: 'INCUBATING', value: d.c.incubating, tone: 'mid' },
    { key: 'fruiting', label: 'FRUITING', value: d.c.fruiting, tone: 'solid' },
    { key: 'spent', label: 'SPENT', value: d.c.spent, tone: 'faint' },
    { key: 'lost', label: 'LOST', value: d.c.lost, tone: 'warn' },
  ]
  const cols: Col[] = d.weeks.map((w) => ({ key: w.week, label: dayMon(w.week), value: w.kg, title: `WEEK OF ${dayMon(w.week)}` }))
  const lostPct = d.c.started ? (d.c.lost / d.c.started) * 100 : null
  return (
    <>
      <div className="cx-tiles">
        <Tile label="PICKED THIS WEEK" value={<Count value={d.weeks[d.weeks.length - 1].kg} fmt={kgF} />} spark={d.weeks.slice(-8).map((w) => w.kg)} sparkLabel="Kg picked a week" onClick={() => open('harvest')} />
        <Tile label="LOTS GROWING" value={<Count value={d.rows.length} fmt={(v) => String(Math.round(v))} />} sub={`${Math.round(inRooms)} BLOCKS IN THE ROOMS`} onClick={() => open('lots')} />
        <Tile label="LOST, 90 DAYS" value={lostPct === null ? '--' : pct(lostPct)} sub={`${d.c.lost} OF ${d.c.started} BLOCKS KNOCKED`} warn={lostPct !== null && lostPct >= 5} onClick={() => open('lots')} />
        <Tile label="BE%, LAST FINISHED LOTS" value={d.be === null ? '--' : `${d.be.toFixed(0)}%`} sub={d.beN ? `AVERAGE OF THE LAST ${plural(d.beN, 'LOT')}` : 'NO FINISHED LOT YET'} onClick={() => open('yield')} />
      </div>
      <Sec title="BLOCKS KNOCKED IN THE LAST 90 DAYS // WHERE THEY ARE NOW" note="A LOT MARKED LOST COUNTS ALL ITS BLOCKS. TAP A PART TO OPEN THE LOT BOARD.">
        <StackBar parts={parts} label="Blocks knocked in the last 90 days, by where they are now" fmt={(v) => String(Math.round(v))} onPick={() => open('lots')} />
      </Sec>
      <Sec
        title="KG PICKED A WEEK // LAST 12 WEEKS"
        note={d.plan ? `PLAN LINE = THE CROP PLAN'S BLOCKS A WEEK TIMES CATAWBA'S KG PER BLOCK, AT FULL PRODUCTION.` : 'NO PLAN FIGURE FOR THESE SPECIES YET.'}
      >
        <Columns data={cols} label="Kg picked each week" fmt={(v) => `${shortNum(v)}`} band={d.plan ? { at: d.plan, label: `PLAN ${d.plan.toFixed(0)} KG`, shade: 'none' } : undefined} onPick={() => open('harvest')} />
      </Sec>
      <Sec title="NEXT 7 DAYS // MOVES AND FIRST PICKS">
        {d.soon.length === 0 ? (
          <div className="dim">NOTHING TO MOVE OR START PICKING IN THE NEXT 7 DAYS.</div>
        ) : (
          <ul className="dk-rows">
            {d.soon.slice(0, 10).map(({ r, what, warn }) => (
              <li key={r.lot.id}>
                <button type="button" className={warn ? 'warn' : ''} onClick={() => open('lots')}>
                  <b>{r.lot.lot_code}</b>
                  <span>{speciesName(r.lot.species_key)}</span>
                  <span>{what}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sec>
    </>
  )
}

// ---------- 3 XENOLAB ----------

function XenolabOverview({ open }: OvProps) {
  const rec = useRecords()
  const crop = usePlan()
  const today = useReminders().today
  const cultures = useTable<Culture>('cultures')
  const checks = useTable<ViabilityCheck>('viability_checks')
  const tests = useTable<BankTest>('bank_tests')
  const runs = useTable<GrainRun>('grain_runs')
  const { strains, lots, losses, practice, fading } = rec
  const d = useMemo(() => {
    const active = strains.filter((s) => s.active)
    const on = new Set(active.map((s) => s.id))
    let fresh = 0
    let watch = 0
    let due = 0
    for (const c of cultures) {
      if (!isBankTube(c) || !c.strain_id || !on.has(c.strain_id)) continue
      const a = bankAge(c, cultures, checks, tests, practice, today)
      if (a.state === 'over' && a.text.startsWith('FAILED')) continue
      if (a.state === 'warn' || a.state === 'over') due++
      else if (a.watch) watch++
      else fresh++
    }
    const knock = nextKnockDay(today)
    const spawn = weekSplit(knock, crop)
      .filter((x) => x.bags > 0)
      .map((x) => {
        const strain = active.find((s) => s.species_key === x.key) ?? null
        const plan = planChain(x.key, x.bags, knock, practice.smallLineRoute)
        const stock = strain ? strainStock(strain.id, x.key, cultures, runs, lots, today) : { plates: 0, g1: 0, g2: 0 }
        const sf = strain ? shortfall(plan, stock) : { level: 'short' as const, next: 'NO STRAIN ON FILE' }
        return { key: x.key, need: plan.g2, have: stock.g2, short: sf.level === 'short', next: sf.next }
      })
    return { active, fresh, watch, due, knock, spawn, contam: contamByStrain(active, lots, losses, today, 90) }
  }, [strains, cultures, checks, tests, runs, lots, losses, practice, today, crop])
  const fadingList = fading.filter((f) => f.fading)
  const target = practice.contamTargetPct
  const contamRows: BarRow[] = d.contam.slice(0, 8).map((c) => ({ key: c.id, label: `${c.code} ${speciesName(c.species)}`, value: c.pct, mark: target, warn: c.pct >= target, note: `${c.lost}/${c.blocks}`, onClick: () => open('strains') }))
  const spawnRows: BarRow[] = d.spawn.map((s) => ({ key: s.key, label: speciesName(s.key), value: s.have, mark: s.need, warn: s.short, note: `NEED ${s.need}`, onClick: () => open('spawnplan') }))
  return (
    <>
      <div className="cx-tiles">
        <Tile label="STRAINS IN USE" value={<Count value={d.active.length} fmt={(v) => String(Math.round(v))} />} onClick={() => open('strains')} />
        <Tile label="BANK TUBES" value={<Count value={d.fresh + d.watch + d.due} fmt={(v) => String(Math.round(v))} />} sub="SLANTS AND WATER TUBES" onClick={() => open('bank')} />
        <Tile label="DUE FOR TRANSFER" value={String(d.due)} warn={d.due > 0} sub={d.due ? 'TRANSFER THEM THIS WEEK' : 'NONE DUE'} onClick={() => open('bank')} />
        <Tile label="FADING STRAINS" value={String(fadingList.length)} warn={fadingList.length > 0} sub={fadingList.length ? fadingList.map((f) => f.strain.code).join(', ') : 'BE HOLDING UP'} onClick={() => open('strains')} />
      </div>
      <Sec title="CULTURE BANK // BY AGE" note="ON WATCH = OLD ENOUGH TO TEST BEFORE USE. DUE = PAST THE TRANSFER AGE. TAP TO OPEN THE CULTURE BANK.">
        <StackBar
          label="Bank tubes by age"
          fmt={(v) => String(Math.round(v))}
          parts={[
            { key: 'fresh', label: 'FRESH', value: d.fresh, tone: 'solid' },
            { key: 'watch', label: 'ON WATCH', value: d.watch, tone: 'hatch' },
            { key: 'due', label: 'DUE FOR TRANSFER', value: d.due, tone: 'warn' },
          ]}
          onPick={() => open('bank')}
        />
      </Sec>
      <Sec title={`CONTAMINATION BY STRAIN // LAST 90 DAYS`} note={`BLOCKS LOST OF BLOCKS KNOCKED. TICK = THE ${target}% TARGET (PRACTICE SETTINGS).`}>
        {contamRows.length ? <BarList rows={contamRows} fmt={pct} label="Contamination per strain, last 90 days" markLabel={`TARGET ${target}%`} max={Math.max(target * 2, ...contamRows.map((r) => r.value))} /> : <div className="dim">NO LOTS WITH A STRAIN IN THE LAST 90 DAYS.</div>}
      </Sec>
      <Sec title={`SPAWN FOR THE ${dayMon(d.knock)} KNOCK // G2 BAGS ON THE SHELF`} note="TICK = G2 BAGS THE CROP PLAN NEEDS. THE SPAWN PLANNER SAYS WHAT TO MAKE NEXT.">
        {spawnRows.length ? <BarList rows={spawnRows} fmt={(v) => String(Math.round(v))} label="G2 spawn bags on hand against bags needed" markLabel="NEEDED" /> : <div className="dim">NO BLOCKS IN THE CROP PLAN FOR THAT DAY.</div>}
      </Sec>
    </>
  )
}

// ---------- 4 CARGO HOLD ----------

function CargoOverview({ open }: OvProps) {
  const role = useRole()
  const cargo = useCargo()
  const rec = useRecords()
  const sales = useMoney().sales
  const waste = useTable<WasteEntry>('waste_log')
  const rt = useRates()
  const today = useReminders().today
  const cold = useMemo(() => (role.money ? coldStore(rec.harvests, rec.lots, sales, waste, today, rt.shelfDays) : null), [role.money, rec.harvests, rec.lots, sales, waste, today, rt.shelfDays])
  const low = cargo.rows.filter((r) => r.state === 'LOW' || r.state === 'OUT')
  const out = cargo.rows.filter((r) => r.state === 'OUT').length
  const noCount = cargo.rows.filter((r) => r.state === 'NO COUNT').length
  const cover: BarRow[] = cargo.rows
    .filter((r) => r.weeks !== null && r.state !== 'NO COUNT')
    .sort((a, b) => (a.weeks as number) - (b.weeks as number))
    .slice(0, 10)
    .map((r) => ({
      key: r.item.id,
      label: r.item.name,
      value: Math.min(26, r.weeks as number),
      mark: r.item.lead_time_days ? Number(r.item.lead_time_days) / 7 : undefined,
      warn: r.state === 'LOW' || r.state === 'OUT',
      note: r.state === 'OK' ? '' : r.state,
      onClick: () => open('manifest'),
    }))
  const byCat = new Map<string, number>()
  if (role.money) for (const r of cargo.rows) if (r.last && r.onHand > 0) byCat.set(r.item.category ?? 'OTHER', (byCat.get(r.item.category ?? 'OTHER') ?? 0) + r.onHand * Number(r.last.price_crc))
  const value = [...byCat.values()].reduce((t, v) => t + v, 0)
  return (
    <>
      <div className="cx-tiles">
        <Tile label="TO REORDER" value={String(low.length)} warn={low.length > 0} sub={low.length ? low.slice(0, 3).map((r) => r.item.name).join(', ') : 'NOTHING LOW'} onClick={() => open('manifest')} />
        <Tile label="OUT OF STOCK" value={String(out)} warn={out > 0} onClick={() => open('manifest')} />
        <Tile label="NEVER COUNTED" value={String(noCount)} sub="COUNT THEM ONCE SO THE REORDER LIST WORKS" onClick={() => open('manifest')} />
        {cold && <Tile label="FRESH ON HAND" value={<Count value={cold.onHand} fmt={kgF} />} sub={cold.oldest === null ? 'NOTHING FRESH' : `OLDEST PICK ${cold.oldest} D`} warn={cold.stale > 0.05} onClick={() => open('cold')} />}
        {role.money && value > 0 && <Tile label="STOCK VALUE" value={crcShort(value)} sub="ON HAND AT THE LAST PRICE PAID" onClick={() => open('manifest')} />}
      </div>
      <Sec title="WEEKS OF STOCK LEFT // LOWEST FIRST" note="AT THE PLAN'S WEEKLY USE. TICK = THE SUPPLIER'S LEAD TIME: BELOW IT, ORDER NOW. CAPPED AT 26 WEEKS.">
        {cover.length ? <BarList rows={cover} fmt={(v) => `${v.toFixed(1)} WK`} label="Weeks of stock left per item" markLabel="LEAD TIME" /> : <div className="dim">NO COUNTED ITEM WITH A WEEKLY USE YET. COUNT STOCK IN THE SUPPLY MANIFEST.</div>}
      </Sec>
      {role.money && value > 0 && (
        <Sec title="STOCK VALUE BY CATEGORY">
          <BarList rows={[...byCat].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k.toUpperCase(), value: v, onClick: () => open('manifest') }))} fmt={crcShort} label="Value of stock on hand by category" />
        </Sec>
      )}
      {cold && (
        <Sec title="FRESH MUSHROOMS ON HAND // BY SPECIES" note={`PICKED IN THE LAST ${cold.shelfDays} DAYS (SHELF LIFE, A GUESS), NOT YET SOLD OR WRITTEN OFF.`}>
          {cold.species.some((s) => s.onHand > 0.05) ? (
            <BarList rows={cold.species.filter((s) => s.onHand > 0.05).map((s) => ({ key: s.species, label: speciesName(s.species), value: s.onHand, note: s.oldest === null ? '' : `OLDEST ${s.oldest} D`, warn: s.oldest !== null && s.oldest >= Math.max(1, cold.shelfDays - 2), onClick: () => open('cold') }))} fmt={kgF} label="Fresh kg on hand by species" />
          ) : (
            <div className="dim">NOTHING FRESH ON HAND.</div>
          )}
        </Sec>
      )}
    </>
  )
}

// ---------- 5 TRADE DOCK ----------

function TradeOverview({ open }: OvProps) {
  const money = useMoney()
  const rec = useRecords()
  const waste = useTable<WasteEntry>('waste_log')
  const orders = useTable<StandingOrder>('standing_orders')
  const weeksO = useTable<OrderWeek>('order_weeks')
  const rt = useRates()
  const today = money.today
  const d = useMemo(() => {
    const cold = coldStore(rec.harvests, rec.lots, money.sales, waste, today, rt.shelfDays)
    const due = ordersDue(orders, weeksO, today)
    const keys = [...new Set([...due.keys(), ...cold.species.filter((s) => s.onHand > 0.05).map((s) => s.species)])]
    const vsOrders = keys.map((k) => ({ key: k, have: cold.species.find((s) => s.species === k)?.onHand ?? 0, due: due.get(k) ?? 0 }))
    return { cold, due, vsOrders, days: salesByDay(money.sales, today), weeks: weeklySales(money.sales, today, 8), top: topBuyers(money.sales, today, 30, 5) }
  }, [rec.harvests, rec.lots, money.sales, waste, today, rt.shelfDays, orders, weeksO])
  const ow = money.owed
  const late = ow.buyers.filter((b) => b.days > 30).length
  const dueKg = [...d.due.values()].reduce((t, v) => t + v, 0)
  const tones: Part['tone'][] = ['solid', 'mid', 'hatch', 'warn']
  const cols: Col[] = d.days.map((x) => ({ key: x.day, label: x.name, value: x.future ? 0 : x.now, alt: x.last, title: `${x.name} ${dayMon(x.day)}${x.future ? ' (STILL TO COME)' : ''}` }))
  return (
    <>
      <div className="cx-tiles">
        <Tile label="SOLD THIS WEEK" value={<Count value={d.weeks[d.weeks.length - 1].crc} fmt={crcShort} />} spark={d.weeks.map((w) => w.crc)} sparkLabel="Colones sold a week" onClick={() => open('saleslog')} />
        <Tile label="MONEY OWED" value={crcShort(ow.total)} warn={late > 0} sub={late ? `${plural(late, 'BUYER')} OVER 30 DAYS` : `${plural(ow.buyers.length, 'BUYER')}`} onClick={() => open('owed')} />
        <Tile label="ORDERS STILL TO DELIVER" value={kgF(dueKg)} sub="THIS WEEK, FRESH" onClick={() => open('orders')} />
        <Tile label="FRESH ON HAND" value={kgF(d.cold.onHand)} warn={d.cold.onHand + 0.05 < dueKg} sub={d.cold.onHand + 0.05 < dueKg ? 'LESS THAN THE ORDERS' : 'COLD STORE'} onClick={() => open('cold')} />
      </div>
      <Sec title="SALES BY DAY // THIS WEEK AGAINST LAST WEEK" note="WRITTEN-OFF SALES ARE LEFT OUT. TAP A DAY TO OPEN THE SALES LOG.">
        <Columns data={cols} label="Sales by day, this week and last week" fmt={crcShort} legend={['THIS WEEK', 'LAST WEEK']} onPick={() => open('saleslog')} />
      </Sec>
      <Sec title="MONEY OWED // BY AGE" note="EVERY BUYER PAYS CASH ON DELIVERY, SO ANYTHING HERE IS LATE. TAP TO OPEN MONEY OWED.">
        <StackBar label="Money owed by age" fmt={crcShort} parts={AGE_BUCKETS.map((b, i) => ({ key: b.id, label: b.label, value: ow.buckets[b.id], tone: tones[i] }))} onPick={() => open('owed')} />
      </Sec>
      <Sec title="FRESH ON HAND AGAINST ORDERS // THIS WEEK" note="TICK = FRESH KG STILL TO DELIVER ON STANDING ORDERS THIS WEEK.">
        {d.vsOrders.length ? (
          <BarList rows={d.vsOrders.map((x) => ({ key: x.key, label: speciesName(x.key), value: x.have, mark: x.due || undefined, warn: x.have + 0.05 < x.due, note: x.due ? `ORDERED ${x.due.toFixed(1)}` : '', onClick: () => open('orders') }))} fmt={kgF} label="Fresh kg on hand against orders still to deliver" markLabel="STILL TO DELIVER" />
        ) : (
          <div className="dim">NO FRESH STOCK AND NO ORDERS LEFT THIS WEEK.</div>
        )}
      </Sec>
      <Sec title="TOP BUYERS // LAST 30 DAYS">
        {d.top.length ? <BarList rows={d.top.map((b) => ({ key: b.buyer, label: b.buyer, value: b.crc, note: kgF(b.kg), onClick: () => open('buyers') }))} fmt={crcShort} label="Biggest buyers over the last 30 days" /> : <div className="dim">NO SALES IN THE LAST 30 DAYS.</div>}
      </Sec>
    </>
  )
}

// ---------- 6 BURSAR ----------

function BursarOverview({ open }: OvProps) {
  const money = useMoney()
  const led = useLedger()
  const today = money.today
  const m = monthOf(today)
  const d = useMemo(() => {
    const year = Array.from({ length: 12 }, (_, i) => addMonths(m, i - 11)).map((x) => pnlMonth(x, money.pnl, money.bud, money.sales))
    const cf = cashFlow(money.cash, money.bud, money.settings.startMonth ?? m, today, money.settings.openingCash, money.settings.floorMonths)
    let kg = costPerKgParts(led.ledger.weeks)
    let basis = kg ? `LAST ${plural(kg.weeks, 'KNOCK WEEK')}${kg.partial ? ', SOME STILL PICKING' : ''}` : ''
    if (!kg && led.plan.all.kg > 0) {
      const parts = Object.fromEntries(PART_KEYS.map((k) => [k, led.plan.all.parts[k].crc / led.plan.all.kg])) as Record<(typeof PART_KEYS)[number], number>
      kg = { parts, perKg: PART_KEYS.reduce((t, k) => t + parts[k], 0), kg: led.plan.all.kg, weeks: 0, partial: true }
      basis = 'PLAN ESTIMATE FOR NEXT KNOCK WEEK'
    }
    return { year, cf, p: year[year.length - 1], kg, basis }
  }, [m, money.pnl, money.bud, money.sales, money.cash, money.settings, today, led.ledger.weeks, led.plan])
  const { cf, p } = d
  const nowM = cf.months.find((x) => x.basis === 'NOW')
  const cashNow = nowM?.end ?? cf.opening
  const ahead = cf.months.filter((x) => x.basis !== 'ACTUAL')
  const low = ahead.length ? ahead.reduce((a, b) => (b.end < a.end ? b : a)) : null
  const profitCols: Col[] = d.year.map((y) => ({ key: y.month, label: monthLabel(y.month).slice(0, 3), value: y.profit, warn: y.profit < 0, title: monthLabel(y.month) }))
  const cashCols: Col[] = cf.months.map((x) => ({ key: x.month, label: monthLabel(x.month).slice(0, 3), value: x.cashIn, alt: x.cashOut, title: `${monthLabel(x.month)} (${x.basis})` }))
  const kgTones: Part['tone'][] = ['solid', 'mid', 'hatch', 'cross', 'faint']
  const used = p.budgetCost > 0 ? (p.cost / p.budgetCost) * 100 : null
  return (
    <>
      <div className="cx-tiles">
        <Tile label="CASH NOW" value={<Count value={cashNow} fmt={crcShort} />} sub="END OF THIS MONTH SO FAR" warn={cashNow < cf.floor} spark={cf.months.filter((x) => x.basis !== 'PLAN').map((x) => x.end)} sparkLabel="Cash at the end of each month" onClick={() => open('cash')} />
        <Tile label={`${monthLabel(m)} PROFIT`} value={<Count value={p.profit} fmt={crcShort} />} warn={p.profit < 0} sub={p.marginPct === null ? 'NO SALES YET' : `MARGIN ${p.marginPct.toFixed(0)}%`} spark={d.year.map((y) => y.profit)} sparkLabel="Profit per month" onClick={() => open('pnl')} />
        <Tile label="LOWEST CASH AHEAD" value={low ? crcShort(low.end) : '--'} warn={!!low && low.end < cf.floor} sub={low ? `${monthLabel(low.month)} // FLOOR ${crcShort(cf.floor)}` : 'NO MONTHS AHEAD'} onClick={() => open('cash')} />
        <Tile label="COST PER KG" value={d.kg ? crcShort(d.kg.perKg) : '--'} sub={d.kg ? d.basis : 'NO COSTS OR PICKS YET'} onClick={() => open('cogs')} />
      </div>
      <Sec title="PROFIT PER MONTH // LAST 12 MONTHS" note="SALES MINUS COSTS IN THE MONTH THEY HAPPENED. AMBER = A LOSS. TAP TO OPEN PROFIT + LOSS.">
        <Columns data={profitCols} label="Profit per month" fmt={crcShort} onPick={() => open('pnl')} />
      </Sec>
      <Sec title={`CASH FLOW // ${monthLabel(cf.months[0]?.month ?? m)} TO ${monthLabel(cf.months[cf.months.length - 1]?.month ?? m)}`} note="MONTHS TO COME USE THE BUDGET. THE SHADED BAND IS THE CASH FLOOR: KEEP THE LINE ABOVE IT.">
        <Columns data={cashCols} label="Money in and out each month, with cash at the end of the month" fmt={crcShort} legend={['MONEY IN', 'MONEY OUT', 'CASH AT MONTH END']} line={cf.months.map((x) => x.end)} band={cf.floor > 0 ? { at: cf.floor, label: `FLOOR ${crcShort(cf.floor)}`, shade: 'below' } : undefined} onPick={() => open('cash')} />
      </Sec>
      <Sec title={`WHAT A KILO COSTS${d.kg ? ` // ${crc(d.kg.perKg)} A KG` : ''}`} note={d.kg ? `${d.basis}. FROM COST OF GOODS, WHICH SAYS WHERE EACH PART COMES FROM.` : 'LOG PICKS AND PRICES TO SEE THIS.'}>
        {d.kg ? <StackBar label="Cost of a kilo by part" fmt={crcShort} parts={PART_KEYS.map((k, i) => ({ key: k, label: PART_LABEL[k], value: d.kg!.parts[k], tone: kgTones[i] }))} onPick={() => open('cogs')} /> : <div className="dim">NOTHING TO SPLIT YET.</div>}
      </Sec>
      <Sec title={`BUDGET USED // ${monthLabel(m)}`}>
        {used === null ? (
          <div className="dim">
            NO BUDGET FOR {monthLabel(m)}.{' '}
            <button type="button" className="ck-link" onClick={() => open('budget')}>
              FILL THE BUDGET
            </button>
          </div>
        ) : (
          <button type="button" className="dk-gauge-btn" onClick={() => open('budget')}>
            <Gauge value={p.cost} min={0} max={Math.max(p.budgetCost * 1.25, p.cost)} lo={0} hi={p.budgetCost} warn={p.cost > p.budgetCost} text={`${used.toFixed(0)}% USED`} label={`COSTS ${crc(p.cost)} OF ${crc(p.budgetCost)}`} size={150} />
          </button>
        )}
      </Sec>
    </>
  )
}

// ---------- 7 ENGINEERING ----------

function EngineeringOverview({ open }: OvProps) {
  const rem = useReminders()
  const sens = useSensors()
  const power = usePower()
  const months = useMemo(() => lastMonths(rem.cuts, rem.now, 12), [rem.cuts, rem.now])
  const cut = rem.summary.open
  const alarms = sens.alarms.filter((a) => !a.acked && a.kind !== 'POWER').length
  const late = rem.board.filter((x) => x.state === 'late').length
  const water = rem.waterDue.filter((w) => w.state === 'late' || w.state === 'due').length
  const temps = sens.board
    .map((p) => ({ p, m: p.measures.find((x) => x.measure === 'temp') }))
    .filter((x): x is { p: (typeof sens.board)[number]; m: NonNullable<(typeof x)['m']> } => !!x.m && x.m.value !== null)
  const r = power.reading
  const upkeep = rem.board.filter((x) => x.state === 'late' || x.state === 'due' || x.state === 'soon').slice(0, 6)
  return (
    <>
      <div className="cx-tiles">
        <Tile label="GRID" value={cut ? 'DOWN NOW' : 'UP'} warn={!!cut} sub={`${months[months.length - 1].cuts} CUTS THIS MONTH`} onClick={() => open('cuts')} />
        <Tile label="CLIMATE ALARMS" value={String(alarms)} warn={alarms > 0} sub={!sens.board.some((p) => p.last !== null) ? 'NO READINGS YET' : alarms ? 'WAITING TO BE SEEN IN LIFE SUPPORT' : 'NONE WAITING'} onClick={() => open('life')} />
        <Tile label="UPKEEP LATE" value={String(late)} warn={late > 0} sub="MAINTENANCE AND CLEANING" onClick={() => open('upkeep')} />
        <Tile label="WATER TESTS DUE" value={String(water)} warn={water > 0} onClick={() => open('water')} />
      </div>
      <Sec title="TEMPERATURE NOW // EACH ROOM AGAINST ITS ALARM BAND" note="SHADED ARC = THE ALARM BAND. AMBER = OUTSIDE IT. TAP A DIAL TO OPEN LIFE SUPPORT.">
        {temps.length ? (
          <div className="dk-gauges">
            {temps.map(({ p, m }) => {
              const lo = m.band?.lo ?? null
              const hi = m.band?.hi ?? null
              const v = m.value as number
              const min = Math.floor(Math.min(v, lo ?? v) - 4)
              const max = Math.ceil(Math.max(v, hi ?? v) + 4)
              return (
                <button type="button" key={p.place} className="dk-gauge-btn" onClick={() => open('life')}>
                  <Gauge value={v} min={min} max={max} lo={lo} hi={hi} warn={m.side !== 'ok'} text={`${v.toFixed(1)} °C${m.stale ? ' OLD' : ''}`} label={PLACES.find((x) => x.id === p.place)?.label ?? p.place.toUpperCase()} />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="dim">NO CLIMATE READINGS YET. LOG ONE OR IMPORT A CSV IN LIFE SUPPORT.</div>
        )}
      </Sec>
      <Sec title="PLANNED LOAD // AGAINST THE METER" note={`THE WORST LEG WITH THE BREAKERS SET ON THE POWER GRID SCREEN. THE METER ALLOWS ${CEILING_A} A; SHADED = UNDER 80%.`}>
        <button type="button" className="dk-gauge-btn" onClick={() => open('grid')}>
          <Gauge value={r.worst} min={0} max={CEILING_A} lo={0} hi={CEILING_A * 0.8} warn={r.level !== 'ok'} text={`${r.worst.toFixed(0)} A`} label={`OF ${CEILING_A} A // ${r.status}`} size={150} />
        </button>
      </Sec>
      <Sec title="HOURS WITHOUT GRID POWER // EACH MONTH" note="FROM THE POWER CUT LOG. TAP A MONTH TO OPEN IT.">
        <Columns data={months.map((x) => ({ key: x.month, label: monthLabel(x.month).slice(0, 3), value: x.gridMin / 60, title: `${monthLabel(x.month)}: ${plural(x.cuts, 'CUT')}` }))} label="Hours without grid power each month" fmt={(v) => `${shortNum(v)} H`} onPick={() => open('cuts')} />
      </Sec>
      <Sec title="UPKEEP COMING DUE">
        {upkeep.length ? (
          <ul className="dk-rows">
            {upkeep.map((x) => (
              <li key={x.item.id}>
                <button type="button" className={x.state === 'late' ? 'warn' : ''} onClick={() => open('upkeep')}>
                  <b>{x.item.name}</b>
                  <span>{x.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dim">NOTHING DUE SOON.</div>
        )}
      </Sec>
    </>
  )
}

// ---------- 8 MAINFRAME ----------

const GUESS_LISTS: { station: string; label: string; n: number }[] = [
  { station: 'pnl', label: 'MONEY', n: MONEY_GUESSES.length },
  { station: 'saleslog', label: 'SALES', n: TRADE_GUESSES.length },
  { station: 'cogs', label: 'COST OF GOODS', n: LEDGER_GUESSES.length },
  { station: 'reminders', label: 'FACILITY LOGS', n: FACILITY_GUESSES.length },
  { station: 'life', label: 'CLIMATE', n: SENSOR_GUESSES.length },
  { station: 'crew', label: 'CREW ACCESS', n: STAFF_GUESSES.length },
  { station: 'vault', label: 'DATA VAULT', n: DATA_GUESSES.length },
]

function MainframeOverview({ open, canOpen }: OvProps) {
  const role = useRole()
  const nag = useNag()
  const sync = useSync()
  const edits = useTable<EditEntry>('edit_log')
  const today = useReminders().today
  const days = useMemo(() => {
    const list = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13))
    const by = new Map<string, Set<string>>()
    for (const e of edits) {
      const day = e.at.slice(0, 10)
      if (day < list[0]) continue
      const s = by.get(day) ?? new Set<string>()
      s.add(e.action_id)
      by.set(day, s)
    }
    return list.map((d) => ({ day: d, n: by.get(d)?.size ?? 0 }))
  }, [edits, today])
  const week = days.slice(-7).reduce((t, d) => t + d.n, 0)
  const waiting = sync.info?.waiting ?? 0
  const guesses = GUESS_LISTS.filter((g) => g.n > 0 && canOpen(stationScreen(g.station)))
  return (
    <>
      <div className="cx-tiles">
        <Tile label="LAST BACKUP" value={nag.warn ? 'DUE' : 'OK'} warn={nag.warn} sub={nag.text} onClick={() => open('vault')} />
        {role.money && <Tile label="CHANGES THIS WEEK" value={<Count value={week} fmt={(v) => String(Math.round(v))} />} spark={days.map((d) => d.n)} sparkLabel="Saved changes a day, last 14 days" onClick={() => open('history')} />}
        <Tile label="WAITING TO SAVE" value={String(waiting)} warn={sync.lamp === 'CONFLICT'} sub={sync.lamp} onClick={() => open('history')} />
        <Tile label="YOU ARE" value={role.role === 'owner' ? 'OWNER' : 'STAFF'} sub={role.source === 'login' ? 'FROM THE LOGIN' : 'FROM THE LOCK ON THIS DEVICE'} onClick={() => open('crew')} />
      </div>
      {role.money && (
        <Sec title="SAVED CHANGES A DAY // LAST 14 DAYS" note="ONE SAVE CAN CHANGE MANY RECORDS; IT COUNTS ONCE. TAP A DAY TO OPEN THE EDIT HISTORY.">
          <Columns data={days.map((d) => ({ key: d.day, label: dayMon(d.day).split(' ')[0], value: d.n, title: dayMon(d.day) }))} label="Saved changes a day" fmt={(v) => shortNum(v)} onPick={() => open('history')} />
        </Sec>
      )}
      {guesses.length > 0 && (
        <Sec title="GUESSES WAITING FOR JOSEPH // PER SCREEN" note="EACH ONE IS A NUMBER OR RULE THE APP USES UNTIL IT IS CHECKED. TAP TO SEE THE LIST.">
          <BarList rows={guesses.map((g) => ({ key: g.station, label: g.label, value: g.n, onClick: () => open(g.station) }))} fmt={(v) => String(Math.round(v))} label="Guesses waiting for review, per screen" />
        </Sec>
      )}
    </>
  )
}

const stationScreen = (id: string) => STATION_SCREEN[id] ?? ''
const STATION_SCREEN: Record<string, string> = { pnl: 'MONEY', saleslog: 'TRADE', cogs: 'LEDGER', reminders: 'FACILITY', life: 'ATMOS', crew: 'STAFF', vault: 'DATA' }

const OVERVIEWS: Record<DeckId, (p: OvProps) => ReactNode> = {
  bridge: BridgeOverview,
  grow: GrowOverview,
  xenolab: XenolabOverview,
  cargo: CargoOverview,
  trade: TradeOverview,
  bursar: BursarOverview,
  engineering: EngineeringOverview,
  mainframe: MainframeOverview,
}
