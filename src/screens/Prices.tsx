import { useStore, useTable } from '../store/StoreContext'
import { useRatesEditor } from '../store/useRates'
import { speciesName } from '../store/useLedger'
import { BILL_ESTIMATE, ICE, LEDGER_GUESSES, SALE_SPECIES, TRADE_GUESSES, type Form } from '../data/ledger'
import { DEFAULT_ICE, DEFAULT_RATES, builtInPrice, estimateMid, iceBill, type IceRates, type Rates } from '../lib/rates'
import { fmtCrc, fmtUsd, priceHistory, type Item, type Price } from '../lib/cargo'
import { addPrice } from '../lib/cargoActions'
import { Confirm, Field, Guess } from './CookParts'

// PRICES + COSTS: every price and cost the app uses, in one place. Blank = the built-in figure.
// Saved in the shared settings record, so phone and laptop agree once Supabase is linked.

type Say = (t: string, warn?: boolean) => void

const num = (s: string): number | null => {
  const n = Number(s.replace(/[₡$%,\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? n : null
}
const show = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))

export function Prices({ say, onOpenCargo }: { say: Say; onOpenCargo: () => void }) {
  const store = useStore()
  const [r, save] = useRatesEditor()
  const items = useTable<Item>('items')
  const prices = useTable<Price>('item_prices')
  const fx = r.fx

  const put = (patch: Partial<Rates>, what: string) =>
    save(patch).then(
      () => say(`${what} SAVED`),
      (e: Error) => say(e.message.toUpperCase(), true),
    )

  const setSale = (key: string, form: Form, v: string) => {
    const n = num(v)
    if (v.trim() && (n === null || n <= 0)) return say('TYPE A ₡ PER KG ABOVE ZERO, OR LEAVE IT BLANK FOR THE DEFAULT.', true)
    const sale = { ...r.sale, [key]: { ...(r.sale[key] ?? {}) } }
    if (n === null) delete sale[key][form]
    else sale[key][form] = n
    if (!Object.keys(sale[key]).length) delete sale[key]
    void put({ sale }, `${speciesName(key)} ${form.toUpperCase()} PRICE`)
  }

  const setIce = (k: keyof IceRates, v: string, scale = 1) => {
    const n = num(v)
    const ice = { ...r.ice, [k]: n === null ? DEFAULT_ICE[k] : n * scale }
    if (n !== null && n < 0) return say('NO NEGATIVE FIGURES.', true)
    void put({ ice }, 'ELECTRICITY')
  }

  const setItemPrice = (it: Item, v: string) => {
    const n = num(v)
    if (n === null || n < 0) return say('TYPE THE ₡ PRICE PER UNIT.', true)
    void addPrice(store, it.id, n, null).then(
      () => say(`${it.name.toUpperCase()} ₡${n} PER ${it.unit.toUpperCase()} SAVED`),
      (e: Error) => say(e.message.toUpperCase(), true),
    )
  }

  const ice = r.ice
  const items2 = [...items].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))

  return (
    <div className="lg-stack">
      <div className="ck-box">
        <div className="section-title">PRICES + COSTS</div>
        <div className="dim tiny">
          EVERY PRICE AND COST THE APP USES. TYPE A FIGURE AND LEAVE THE BOX (OR PRESS ENTER) TO SAVE IT. LEAVE A BOX BLANK TO USE THE BUILT-IN
          FIGURE SHOWN IN GREY. SAVED FOR THE WHOLE FARM, SO THE PHONE AND THE LAPTOP AGREE ONCE THE DATABASE IS LINKED.
        </div>
      </div>

      <div className="ck-box">
        <div className="section-title">SALE PRICES // ₡ PER KG</div>
        <div className="dim tiny">THE SALE FORM IN TRADE STARTS FROM THESE. BUILT-IN: OYSTERS ₡11,500 (MIDDLE OF YOUR ₡10,000-13,000), LION'S MANE AND CORAL +20% <Guess />. DRIED HAS NO BUILT-IN PRICE.</div>
        <div className="ck-scroll">
          <table className="lg-table lg-edit">
            <thead><tr><th>SPECIES</th><th>FRESH ₡/KG</th><th>DRIED ₡/KG</th></tr></thead>
            <tbody>
              {SALE_SPECIES.map((k) => (
                <tr key={k}>
                  <td>{speciesName(k)}</td>
                  {(['fresh', 'dried'] as Form[]).map((f) => {
                    const mine = r.sale[k]?.[f]
                    const def = builtInPrice(k, f)
                    return (
                      <td key={f}>
                        <Field label="" value={show(mine)} inputMode="decimal" placeholder={def ? String(def) : 'NOT SET'} onSave={(v) => setSale(k, f, v)} hint={mine ? fmtUsd(mine, fx) : def ? `BUILT-IN ${fmtUsd(def, fx)}` : undefined} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ck-box">
        <div className="section-title">SUPPLIES // ₡ PER UNIT (CARGO)</div>
        <div className="dim tiny">A NEW PRICE IS ADDED TO THE ITEM'S PRICE HISTORY IN CARGO. LEDGER COSTS SUPPLIES AT THE LATEST PRICE.</div>
        {items2.length === 0 ? (
          <div className="dim">CARGO HAS NO ITEMS YET. <button type="button" className="ck-link" onClick={onOpenCargo}>OPEN CARGO</button></div>
        ) : (
          <div className="ck-scroll">
            <table className="lg-table lg-edit">
              <thead><tr><th>ITEM</th><th>UNIT</th><th>LATEST</th><th>NEW PRICE ₡</th></tr></thead>
              <tbody>
                {items2.map((it) => {
                  const last = priceHistory(it.id, prices)[0]
                  return (
                    <tr key={it.id}>
                      <td className="lg-wrap">{it.name.toUpperCase()}</td>
                      <td>{it.unit.toUpperCase()}</td>
                      <td>{last ? <>{fmtCrc(Number(last.price_crc))} <small className="dim">{last.priced_on}</small></> : <span className="lg-warn-text">NONE</span>}</td>
                      <td><Field key={last?.id ?? 'none'} label="" value="" inputMode="decimal" placeholder={last ? String(last.price_crc) : '₡'} onSave={(v) => v.trim() && setItemPrice(it, v)} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ck-box">
        <div className="section-title">ELECTRICITY // ICE</div>
        <div className="ck-fields">
          <Field label="ENERGY ₡ PER KWH" value={show(ice.energyCrcPerKwh)} inputMode="decimal" placeholder={String(DEFAULT_ICE.energyCrcPerKwh)} onSave={(v) => setIce('energyCrcPerKwh', v)} />
          <Field label="DEMAND ₡ PER KW" value={show(ice.demandCrcPerKw)} inputMode="decimal" placeholder={String(DEFAULT_ICE.demandCrcPerKw)} onSave={(v) => setIce('demandCrcPerKw', v)} />
          <Field label="DEMAND FREE UP TO KW" value={show(ice.demandFreeKw)} inputMode="decimal" placeholder={String(DEFAULT_ICE.demandFreeKw)} onSave={(v) => setIce('demandFreeKw', v)} />
          <Field label="MINIMUM BILLED KW" value={show(ice.demandMinKw)} inputMode="decimal" placeholder={String(DEFAULT_ICE.demandMinKw)} onSave={(v) => setIce('demandMinKw', v)} />
          <Field label="FIXED CHARGE ₡ PER MONTH" value={show(ice.fixedCrc)} inputMode="decimal" placeholder={String(DEFAULT_ICE.fixedCrc)} onSave={(v) => setIce('fixedCrc', v)} />
          <Field label="TAXES %" value={show(Math.round((ice.tax - 1) * 1000) / 10)} inputMode="decimal" placeholder="16" onSave={(v) => { const n = num(v); setIce('tax', n === null ? '' : String(1 + n / 100)) }} />
          <Field label="MONTH ESTIMATE LOW ₡" value={show(ice.estimateLow)} inputMode="decimal" placeholder={String(DEFAULT_ICE.estimateLow)} onSave={(v) => setIce('estimateLow', v)} />
          <Field label="MONTH ESTIMATE HIGH ₡" value={show(ice.estimateHigh)} inputMode="decimal" placeholder={String(DEFAULT_ICE.estimateHigh)} onSave={(v) => setIce('estimateHigh', v)} />
        </div>
        <div className="lg-check">
          AT THESE RATES {BILL_ESTIMATE.kwh.toLocaleString('en-US')} KWH AT 10 KW COMES TO {fmtCrc(iceBill(BILL_ESTIMATE.kwh, 10, r))} ({fmtUsd(iceBill(BILL_ESTIMATE.kwh, 10, r), fx)}). A MONTH WITH NO BILL USES {fmtCrc(estimateMid(r))}, THE MIDDLE OF THE ESTIMATE.
          COOK RUNS ARE PRICED AT THE ENERGY RATE PLUS TAXES.
        </div>
        <div className="dim tiny">{ICE.source}</div>
      </div>

      <div className="ck-box">
        <div className="section-title">LABOUR + WEAR</div>
        <label className="ck-check"><input type="checkbox" checked={r.labourOn} onChange={(e) => void put({ labourOn: e.target.checked }, e.target.checked ? 'LABOUR ON' : 'LABOUR OFF')} /> LABOUR IN THE COST <Guess /></label>
        <label className="ck-check"><input type="checkbox" checked={r.wearOn} onChange={(e) => void put({ wearOn: e.target.checked }, e.target.checked ? 'WEAR ON' : 'WEAR OFF')} /> EQUIPMENT WEAR IN THE COST <Guess /></label>
        <div className="ck-fields">
          <Field label="LABOUR ₡ PER HOUR (BLANK = HOURS ONLY)" value={show(r.labourRate)} inputMode="decimal" hint={r.labourRate ? fmtUsd(r.labourRate, fx) : undefined} onSave={(v) => void put({ labourRate: num(v) }, 'LABOUR RATE')} />
          <Field label="WEAR ₡ PER BLOCK" value={show(r.wearPerBlock)} inputMode="decimal" hint={r.wearOn ? undefined : 'SWITCHED OFF'} onSave={(v) => void put({ wearPerBlock: num(v) }, 'WEAR')} />
        </div>
      </div>

      <div className="ck-box">
        <div className="section-title">EXCHANGE RATE</div>
        <div className="ck-fields">
          <Field label="₡ PER US$ (CARGO USES IT TOO)" value={show(r.fx)} inputMode="decimal" placeholder={String(DEFAULT_RATES.fx)} onSave={(v) => { const n = num(v); if (n !== null && n <= 0) return say('TYPE A RATE ABOVE ZERO.', true); void put({ fx: n ?? DEFAULT_RATES.fx }, 'EXCHANGE RATE') }} />
        </div>
      </div>

      <div className="ck-box">
        <div className="section-title">START AGAIN</div>
        <div className="dim tiny">PUTS SALE PRICES, ELECTRICITY, LABOUR, WEAR AND THE EXCHANGE RATE BACK TO THE BUILT-IN FIGURES. SUPPLY PRICES IN CARGO STAY.</div>
        <div className="ck-btns"><Confirm label="RESET TO BUILT-IN" onYes={() => void put(DEFAULT_RATES, 'BUILT-IN FIGURES')} /></div>
      </div>

      <div className="ck-box">
        <div className="section-title">BEST GUESSES WAITING FOR JOSEPH <Guess /></div>
        <ul className="ck-guesses">{[...LEDGER_GUESSES, ...TRADE_GUESSES].map((g) => <li key={g}>{g}</li>)}</ul>
      </div>
    </div>
  )
}
