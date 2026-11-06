import { describe, expect, it } from 'vitest'
import { buyers, byChannel, lastSaleTo, lotLooksRight, margin, newSale, parseLots, weekly } from './trade'
import { weekOf } from './ledger'

const s = (p: Parameters<typeof newSale>[0]) => newSale(p)

describe('trade', () => {
  const list = [
    s({ sold_on: '2026-11-06', channel: 'market', kg: 10, amount_crc: 115000, species_key: 'blue-oyster', buyer: 'Feria Puerto Viejo' }),
    s({ sold_on: '2026-11-07', channel: 'restaurant', kg: 4, amount_crc: 55200, species_key: 'lions-mane', buyer: 'Cafe Uno' }),
    s({ sold_on: '2026-11-13', channel: 'restaurant', kg: 2, amount_crc: 27600, species_key: 'lions-mane', buyer: ' cafe  uno ' }),
    s({ sold_on: '2026-11-13', channel: 'direct', kg: 0.5, amount_crc: 20000, species_key: 'lions-mane', form: 'dried' }),
  ]
  it('parses lot codes', () => {
    expect(parseLots('b1020, L1022 b1020')).toEqual(['B1020', 'L1022'])
  })
  it('totals by channel', () => {
    const t = byChannel(list)
    expect(t[0].key).toBe('market')
    expect(t.find((x) => x.key === 'restaurant')!.kg).toBe(6)
  })
  it('groups buyers ignoring case and spaces', () => {
    const b = buyers(list)
    expect(b).toHaveLength(2)
    expect(b.find((x) => x.n === 2)!.crc).toBe(82800)
    expect(lastSaleTo(list, 'CAFE UNO')!.sold_on).toBe('2026-11-13')
  })
  it('margin leaves dried and uncosted sales out', () => {
    const { m, uncosted } = margin(list, (k) => (k === 'blue-oyster' ? 5000 : null))
    expect(m.revenue).toBe(115000)
    expect(m.cost).toBe(50000)
    expect(uncosted).toBe(55200 + 27600 + 20000)
  })
  it('weekly buckets', () => {
    expect(weekly(list, weekOf).map((w) => w.week)).toEqual(['2026-11-02', '2026-11-09'])
  })
})

describe('Catawba lot codes (Joseph 6 Nov 2026)', () => {
  it('accepts one or two letters, MMDD, and the -2 / -S1 suffixes', () => {
    for (const ok of ['B1020', 'CT1103', 'PK0915', 'GF0101-2', 'B1020-S1']) expect(lotLooksRight(ok)).toBe(true)
    for (const bad of ['B102', 'ABC1020', '1020', 'b1020', 'CT11030']) expect(lotLooksRight(bad)).toBe(false)
  })
})
