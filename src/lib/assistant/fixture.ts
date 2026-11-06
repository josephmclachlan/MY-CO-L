// A small farm for the assistant's tests and the ENGINE tab's TEST QUESTIONS. Values are made up but
// shaped like the real records, and every expected answer below was worked out by hand from them.
// Only tests and the test-question runner import this file.

import { MemoryBackend, Store, type Row } from '../store'

export const TODAY = '2026-11-06'
/** 09:00 on the farm clock (UTC-6). */
export const NOW = Date.parse('2026-11-06T15:00:00Z')

const lot = (id: string, code: string, sp: string, strain: string, knock: string, status: string, bags: number, room: string | null): Row => ({
  id, lot_code: code, species_key: sp, strain_id: strain, grain_run_id: null, g2_bags_used: null, bag_count: bags, knock_date: knock, status, notes: null, room, cart: null,
})
const pick = (id: string, lotId: string, day: string, flush: number, kg: number): Row => ({ id, block_lot_id: lotId, harvested_on: day, flush, kg, grade: 'A', initials: 'JM', notes: null })
const sale = (id: string, day: string, buyer: string, crc: number, kg: number, pay: 'paid' | 'owed'): Row => ({
  id, sold_on: day, buyer, channel: 'restaurant', species_key: 'blue-oyster', form: 'fresh', grade: 'A', kg, amount_crc: crc, lot_codes: null, notes: null, pay_status: pay, paid_on: pay === 'paid' ? day : null, receipt_no: null,
})

export const FARM: Record<string, Row[]> = {
  strains: [
    { id: 's-bo', species_key: 'blue-oyster', code: 'BO-01', name: 'Steel blue', source: null, active: true, notes: null },
    { id: 's-lm', species_key: 'lions-mane', code: 'LM-01', name: null, source: null, active: true, notes: null },
  ],
  cultures: [
    { id: 'c1', strain_id: 's-lm', parent_culture_id: null, kind: 'slant', p_level: 0, made_on: '2026-09-01', status: 'cold_storage', cold_since: '2026-09-02', location: 'FRIDGE', label: null, notes: null },
    { id: 'c2', strain_id: 's-lm', parent_culture_id: 'c1', kind: 'water', p_level: 0, made_on: '2026-09-01', status: 'cold_storage', cold_since: '2026-09-02', location: 'FRIDGE', label: null, notes: null },
    { id: 'c3', strain_id: 's-lm', parent_culture_id: 'c1', kind: 'plate', p_level: 1, made_on: '2026-11-01', status: 'clean', cold_since: null, location: null, label: null, notes: null },
  ],
  block_lots: [
    lot('l1', 'B1020', 'blue-oyster', 's-bo', '2026-10-20', 'fruiting', 20, 'fruiting'),
    lot('l2', 'B1027', 'blue-oyster', 's-bo', '2026-10-27', 'incubating', 20, 'incubation'),
    lot('l3', 'L1013', 'lions-mane', 's-lm', '2026-10-13', 'fruiting', 16, 'fruiting'),
    lot('l4', 'L1020', 'lions-mane', 's-lm', '2026-10-20', 'fruiting', 16, 'fruiting'),
    lot('l5', 'L0901', 'lions-mane', 's-lm', '2026-09-01', 'spent', 16, null),
  ],
  lot_losses: [{ id: 'x1', block_lot_id: 'l3', hazard_key: null, bag_count: 2, cause: 'trich', noted_on: '2026-10-25', notes: null }],
  harvests: [
    pick('h1', 'l1', '2026-11-03', 1, 4.0),
    pick('h2', 'l1', '2026-11-05', 1, 3.5),
    pick('h3', 'l3', '2026-11-04', 1, 2.2),
    pick('h4', 'l3', '2026-10-28', 1, 1.0),
    pick('h5', 'l5', '2026-09-30', 1, 3.0),
  ],
  sales: [
    sale('v1', '2026-10-20', 'Soda Tamara', 12000, 2, 'owed'),
    sale('v2', '2026-11-01', 'Soda Tamara', 8000, 1.5, 'owed'),
    sale('v3', '2026-11-02', 'Hotel Banana Azul', 15000, 2.5, 'paid'),
    sale('v4', '2026-11-05', 'Chef Luis', 5000, 1, 'owed'),
  ],
  power_cuts: [
    { id: 'p1', kind: 'cut', down_at: '2026-11-02T16:00:00.000Z', up_at: '2026-11-02T19:30:00.000Z', gen_runs: [], gen_hours: null, fuel: null, fuel_amount: null, affected: [], losses: null, notes: null, who: 'JM' },
    { id: 'p2', kind: 'cut', down_at: '2026-10-10T12:00:00.000Z', up_at: '2026-10-10T14:00:00.000Z', gen_runs: [], gen_hours: null, fuel: null, fuel_amount: null, affected: [], losses: null, notes: null, who: 'JM' },
  ],
  items: [
    { id: 'i1', code: 'SOY', name: 'Soy hulls', category: 'SUBSTRATE', unit: 'sack', reorder_point: 4, lead_time_days: 7, supplier: null, room: null, use_per_week: 3, notes: null },
    { id: 'i2', code: 'BAG', name: 'Filter patch bags', category: 'BAGS', unit: 'bag', reorder_point: 100, lead_time_days: 14, supplier: null, room: null, use_per_week: 40, notes: null },
  ],
  stock_moves: [
    { id: 'm1', item_id: 'i1', moved_at: '2026-10-01T12:00:00.000Z', qty: 10, reason: 'delivery', run_ref: null, notes: null },
    { id: 'm2', item_id: 'i1', moved_at: '2026-11-01T12:00:00.000Z', qty: -7, reason: 'use', run_ref: null, notes: null },
    { id: 'm3', item_id: 'i2', moved_at: '2026-10-01T12:00:00.000Z', qty: 500, reason: 'delivery', run_ref: null, notes: null },
    { id: 'm4', item_id: 'i2', moved_at: '2026-11-01T12:00:00.000Z', qty: -100, reason: 'use', run_ref: null, notes: null },
  ],
  sensor_readings: [
    { id: 'r1', sensor_id: null, place: 'fruiting', taken_at: '2026-11-06T14:30:00.000Z', temp_c: 18.2, rh: 91, co2_ppm: 850, source: 'hand', batch: null, who: 'JM', note: null },
  ],
}

/** A fresh Store holding the small farm. */
export async function farmStore(extra: Record<string, Row[]> = {}): Promise<Store> {
  const st = new Store(new MemoryBackend())
  for (const [t, rows] of Object.entries({ ...FARM, ...extra })) await st.put(t, rows.map((r) => ({ ...r })), { label: 'TEST SEED' })
  return st
}

/** Questions with the answer that must come back, worked out by hand from FARM. Used by the tests and TEST QUESTIONS. */
export const TEST_QUESTIONS: { q: string; tool: string; expect: string[]; owner?: boolean }[] = [
  { q: 'how many LM blocks are fruiting', tool: 'count_lots', expect: ['2 LOTS', '30 BLOCKS'] },
  { q: 'how much blue oyster did we pick this week?', tool: 'harvest_total', expect: ['7.50 KG', '2 PICKS'] },
  { q: 'who owes money', tool: 'who_owes', expect: ['₡25,000', 'SODA TAMARA', '₡20,000'], owner: true },
  { q: 'tell me about lot B1020', tool: 'lot_details', expect: ['B1020', '20 BLOCKS ALIVE', '7.50 KG'] },
  { q: 'is the power out?', tool: 'power_cuts', expect: ['POWER IS ON', '3.5 H'] },
  { q: 'what is low in stock', tool: 'stock_status', expect: ['SOY HULLS', 'LOW'] },
  { q: "what's the temperature in the fruiting room", tool: 'climate_now', expect: ['FRUITING', '18.2'] },
  { q: 'how did sales go this month', tool: 'sales_total', expect: ['₡28,000', '5.00 KG'], owner: true },
]
