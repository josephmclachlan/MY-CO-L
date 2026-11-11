import { useMemo } from 'react'
import { useTable } from '../store/StoreContext'
import { useRates } from '../store/useRates'
import { speciesName } from '../store/useLedger'
import { todayIso, type BlockLot } from '../lib/xeno'
import type { Harvest } from '../lib/ledger'
import type { Sale } from '../lib/trade'
import type { WasteEntry } from '../lib/money'
import { coldStore, STALE_DAYS } from '../lib/overview'
import { BarList, Tile } from '../components/Charts'
import { Guess } from './CookParts'

// COLD STORE (deck 4, CARGO HOLD): fresh mushrooms on hand, worked out from what is already logged.
// Picked (LOG HARVEST) minus sold fresh (NEW SALE) minus written off (SURPLUS + WASTE), oldest picks first.
// Nothing new to type: the screen only adds up records. The shelf life is a GUESS set in the PRICE BOOK.

const kg = (n: number) => `${n.toFixed(1)} KG`

export function ColdStore({ onOpenHarvest, onOpenSale, onOpenWaste, onOpenPrices }: { onOpenHarvest: () => void; onOpenSale: () => void; onOpenWaste: () => void; onOpenPrices: () => void }) {
  const harvests = useTable<Harvest>('harvests')
  const lots = useTable<BlockLot>('block_lots')
  const sales = useTable<Sale>('sales')
  const waste = useTable<WasteEntry>('waste_log')
  const rt = useRates()
  const today = todayIso()
  const c = useMemo(() => coldStore(harvests, lots, sales, waste, today, rt.shelfDays), [harvests, lots, sales, waste, today, rt.shelfDays])
  const batches = c.species.flatMap((s) => s.batches.map((b) => ({ ...b, species: s.species }))).sort((a, b) => b.age - a.age || a.species.localeCompare(b.species))
  const old = c.oldest !== null && c.oldest >= Math.max(1, c.shelfDays - 2)
  return (
    <div className="cook ledger cs">
      <div className="ck-box">
        <div className="section-title">COLD STORE // FRESH MUSHROOMS ON HAND</div>
        <div className="cx-tiles">
          <Tile label="ON HAND NOW" value={kg(c.onHand)} sub={`PICKED IN THE LAST ${c.shelfDays} DAYS, NOT YET SOLD OR WRITTEN OFF`} />
          <Tile label="OLDEST PICK" value={c.oldest === null ? '--' : `${c.oldest} ${c.oldest === 1 ? 'DAY' : 'DAYS'}`} warn={old} sub={old ? 'SELL, DRY OR DONATE IT FIRST' : `SHELF LIFE ${c.shelfDays} DAYS (GUESS)`} onClick={onOpenPrices} tip="Change the shelf life in the PRICE BOOK." />
          <Tile label="PICKED, 7 DAYS" value={kg(c.species.reduce((t, s) => t + s.picked7, 0))} onClick={onOpenHarvest} />
          <Tile label="SOLD FRESH, 7 DAYS" value={kg(c.species.reduce((t, s) => t + s.sold7, 0))} onClick={onOpenSale} />
          {c.stale > 0.05 && <Tile label="STALE, NOT LOGGED" value={kg(c.stale)} warn sub={`WENT PAST THE SHELF LIFE IN THE LAST ${STALE_DAYS} DAYS, NEVER LOGGED AS SOLD OR WASTE. LOG WHERE IT WENT.`} onClick={onOpenWaste} />}
        </div>
        {c.species.some((s) => s.onHand > 0.05) ? (
          <BarList
            label="Fresh kg on hand by species"
            fmt={kg}
            rows={c.species.filter((s) => s.onHand > 0.05).map((s) => ({ key: s.species, label: speciesName(s.species), value: s.onHand, note: s.oldest === null ? '' : `OLDEST ${s.oldest} D`, warn: s.oldest !== null && s.oldest >= Math.max(1, c.shelfDays - 2), onClick: onOpenSale }))}
          />
        ) : (
          <div className="dim">NOTHING FRESH ON HAND. PICKS LOGGED IN LOG HARVEST SHOW HERE UNTIL THEY ARE SOLD OR WRITTEN OFF.</div>
        )}
      </div>

      <div className="ck-box">
        <div className="section-title">BY SPECIES // LAST 7 DAYS</div>
        {c.species.length === 0 ? (
          <div className="dim">NO PICKS, FRESH SALES OR WASTE IN THE RECORDS YET.</div>
        ) : (
          <div className="rc-wrap">
            <table className="lg-table rc-table cs-table">
              <thead>
                <tr><th>SPECIES</th><th>PICKED</th><th>SOLD FRESH</th><th>WRITTEN OFF</th><th>ON HAND</th><th>OLDEST</th><th>STALE</th></tr>
              </thead>
              <tbody>
                {c.species.map((s) => (
                  <tr key={s.species}>
                    <td>{speciesName(s.species)}</td>
                    <td>{kg(s.picked7)}</td>
                    <td>{kg(s.sold7)}</td>
                    <td>{kg(s.wasted7)}</td>
                    <td><b>{kg(s.onHand)}</b></td>
                    <td className={s.oldest !== null && s.oldest >= Math.max(1, c.shelfDays - 2) ? 'lg-warn-text' : ''}>{s.oldest === null ? '--' : `${s.oldest} D`}</td>
                    <td className={s.stale > 0.05 ? 'lg-warn-text' : ''}>{s.stale > 0.05 ? kg(s.stale) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {batches.length > 0 && (
        <div className="ck-box">
          <div className="section-title">PICKS STILL ON HAND // OLDEST FIRST</div>
          <ul className="cs-batches">
            {batches.map((b) => (
              <li key={`${b.species}-${b.day}`} className={b.age >= Math.max(1, c.shelfDays - 2) ? 'warn' : ''}>
                <span>{b.day}</span>
                <span>{speciesName(b.species)}</span>
                <b>{kg(b.kg)}</b>
                <span className="dim">{b.age === 0 ? 'TODAY' : `${b.age} D OLD`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="lg-btns">
        <button type="button" className="btn" onClick={onOpenHarvest}>LOG HARVEST</button>
        <button type="button" className="btn" onClick={onOpenSale}>NEW SALE</button>
        <button type="button" className="btn" onClick={onOpenWaste}>LOG SURPLUS OR WASTE</button>
      </div>
      <div className="dim tiny">
        HOW IT COUNTS: A FRESH SALE TAKES KILOS OFF THE OLDEST PICKS OF ITS SPECIES THAT WERE STILL FRESH THAT DAY. SURPLUS OR WASTE TAKES THE OLDEST PICKS TOO, AND CAN CLEAR PICKS THAT WENT OFF. DRIED SALES DO NOT COUNT HERE: DRYING IS LOGGED AS SURPLUS. <Guess /> THE SHELF LIFE IS A GUESS SET IN THE PRICE BOOK.
      </div>
    </div>
  )
}
