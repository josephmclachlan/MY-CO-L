// Turkey tail on the sales lists, sold dried, and the 18th Cap n Stem strain (Joseph, 11 Nov 2026).
// A mock trial of one dried sale from price book to the books, the species tables kept in step, and a stress walk
// over the sale form's species and form picks.
import { describe, expect, it } from 'vitest'
import { FRESH_SPECIES, SALE_SPECIES, SOLD_DRIED, formAfterPick, type Form } from '../data/ledger'
import { SPECIES } from '../data/species'
import { DEFAULT_MONEY, bookGet, books } from './money'
import { NAME_ES } from './orders'
import { builtInPrice, mergeRates, salePrice } from './rates'
import { rng } from './testkit'
import { lotLooksRight, margin, newSale, parseLots } from './trade'
import { LOT_LETTER, STRAIN_PREFIX, STRAINS_ON_FILE, nextStrainCode, type Strain } from './xeno'

describe('turkey tail is sold dried', () => {
  it('is on the sales lists and marked as sold dried', () => {
    expect(SALE_SPECIES).toContain('turkey-tail')
    expect(SOLD_DRIED.has('turkey-tail')).toBe(true)
    // The surplus log counts fresh kilos that did not sell, so a species sold dried is not on it.
    expect(FRESH_SPECIES).not.toContain('turkey-tail')
    expect(FRESH_SPECIES).toEqual(SALE_SPECIES.filter((s) => s !== 'turkey-tail'))
  })

  it('every species file can be sold, and every species on sale has its codes and a Spanish name', () => {
    expect(new Set(SALE_SPECIES).size).toBe(SALE_SPECIES.length)
    expect([...SALE_SPECIES].sort()).toEqual(SPECIES.map((s) => s.id).sort())
    for (const k of SALE_SPECIES) {
      expect(LOT_LETTER[k], k).toMatch(/^[A-Z]$/)
      expect(STRAIN_PREFIX[k], k).toMatch(/^[A-Z]{2}$/)
      expect(NAME_ES[k], k).toBeTruthy()
    }
    // Lot letters and strain prefixes never clash between species.
    expect(new Set(SALE_SPECIES.map((k) => LOT_LETTER[k])).size).toBe(SALE_SPECIES.length)
    expect(new Set(SALE_SPECIES.map((k) => STRAIN_PREFIX[k])).size).toBe(SALE_SPECIES.length)
  })

  it('picking a species sold dried switches the form to DRIED, and leaving it goes back to FRESH', () => {
    expect(formAfterPick('blue-oyster', 'turkey-tail', 'fresh')).toBe('dried')
    expect(formAfterPick('blue-oyster', 'turkey-tail', 'other')).toBe('dried')
    expect(formAfterPick('turkey-tail', 'blue-oyster', 'dried')).toBe('fresh')
    // Leaving turkey tail on any form but DRIED keeps that form, and picks between species sold fresh never change it.
    expect(formAfterPick('turkey-tail', 'blue-oyster', 'other')).toBe('other')
    expect(formAfterPick('blue-oyster', 'lions-mane', 'dried')).toBe('dried')
    expect(formAfterPick('lions-mane', 'chestnut', 'fresh')).toBe('fresh')
    expect(formAfterPick('turkey-tail', 'turkey-tail', 'fresh')).toBe('dried')
  })

  it('has no built-in price: the price book takes a dried price and the sale form uses it', () => {
    expect(builtInPrice('turkey-tail', 'fresh')).toBeNull()
    expect(builtInPrice('turkey-tail', 'dried')).toBeNull()
    const none = mergeRates({})
    expect(salePrice('turkey-tail', 'dried', none)).toEqual({ price: null, mine: false })
    const typed = mergeRates({ sale: { 'turkey-tail': { dried: 90000 } } })
    expect(salePrice('turkey-tail', 'dried', typed)).toEqual({ price: 90000, mine: true })
    expect(salePrice('turkey-tail', 'fresh', typed)).toEqual({ price: null, mine: false })
    // The oysters keep their built-in fresh price.
    expect(salePrice('blue-oyster', 'fresh', typed)).toEqual({ price: 11500, mine: false })
  })

  it('mock trial: one dried sale from the form to the books', () => {
    // The form opens on blue oyster, FRESH. Picking turkey tail switches it to DRIED.
    const form = formAfterPick('blue-oyster', 'turkey-tail', 'fresh' as Form)
    expect(form).toBe('dried')
    // Price book: ₡90,000 per dried kg (a test figure). 0.5 kg x 90,000 = ₡45,000.
    const price = salePrice('turkey-tail', form, mergeRates({ sale: { 'turkey-tail': { dried: 90000 } } })).price as number
    const kg = 0.5
    const lots = parseLots('t1111')
    expect(lots).toEqual(['T1111'])
    expect(lots.every(lotLooksRight)).toBe(true)
    const paid = newSale({ sold_on: '2026-11-12', channel: 'direct', kg, amount_crc: Math.round(kg * price), species_key: 'turkey-tail', form, lot_codes: lots })
    const owed = newSale({ sold_on: '2026-11-20', channel: 'shop', kg: 1, amount_crc: 90000, species_key: 'turkey-tail', form: 'dried', pay_status: 'owed', paid_on: null })
    const fresh = newSale({ sold_on: '2026-11-12', channel: 'market', kg: 4, amount_crc: 46000, species_key: 'blue-oyster' })
    expect(paid.amount_crc).toBe(45000)
    expect(paid.form).toBe('dried')

    // Margin is for fresh kilos only: the dried sales are left out (uncosted), the oysters are costed.
    const { m, uncosted } = margin([paid, owed, fresh], (k) => (k === 'blue-oyster' ? 5000 : 7000))
    expect(m.revenue).toBe(46000)
    expect(m.cost).toBe(20000) // 4 kg x 5,000
    expect(uncosted).toBe(45000 + 90000)

    // The books: both dried sales are DRIED AND OTHER SALES when sold; cash only for the one paid.
    const bk = books({ sales: [paid, owed, fresh], moves: [], bills: [], labour: [], stock: [], prices: [], budget: [], labourRate: null, labourOn: false, settings: DEFAULT_MONEY })
    expect(bookGet(bk.pnl, '2026-11', 'sales_other')).toBe(135000) // 45,000 + 90,000
    expect(bookGet(bk.pnl, '2026-11', 'sales_fresh')).toBe(46000)
    expect(bookGet(bk.cash, '2026-11', 'sales_other')).toBe(45000)
  })
})

describe('the 18th strain', () => {
  it('turkey tail is a Cap n Stem strain: 18 on file, coded TT', () => {
    expect(STRAINS_ON_FILE).toBe(18)
    expect(nextStrainCode('turkey-tail', [])).toBe('TT-01')
    const have = [{ code: 'TT-01' }, { code: 'tt-02' }, { code: 'BO-07' }] as Strain[]
    expect(nextStrainCode('turkey-tail', have)).toBe('TT-03')
  })
})

describe('stress: 5,000 random picks on the sale form', () => {
  it('the form is DRIED right after picking a species sold dried, FRESH after leaving one on DRIED, and otherwise unchanged', () => {
    const r = rng(59)
    const forms: Form[] = ['fresh', 'dried', 'other']
    let sp = 'blue-oyster'
    let form: Form = 'fresh'
    let dried = 0
    for (let i = 0; i < 5000; i++) {
      if (r.chance(0.3)) {
        form = r.pick(forms) // a FORM button pressed by hand
        continue
      }
      const next = r.pick(SALE_SPECIES)
      const before = form
      form = formAfterPick(sp, next, form)
      if (SOLD_DRIED.has(next)) {
        expect(form).toBe('dried')
        dried++
      } else if (SOLD_DRIED.has(sp) && before === 'dried') expect(form).toBe('fresh')
      else expect(form).toBe(before)
      sp = next
    }
    expect(dried).toBeGreaterThan(100) // about 1 pick in 15 lands on turkey tail
  })
})
