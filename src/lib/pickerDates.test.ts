import { describe, expect, it } from 'vitest'
import { daysIn, isoDate, monthGrid, parseDate, parseMonth, parseTime, shiftMonth } from './pickerDates'

describe('picker date helpers', () => {
  it('knows month lengths including leap years', () => {
    expect(daysIn(2026, 2)).toBe(28)
    expect(daysIn(2028, 2)).toBe(29)
    expect(daysIn(2026, 11)).toBe(30)
  })
  it('builds a Monday-first grid (1 Nov 2026 is a Sunday)', () => {
    const g = monthGrid(2026, 11)
    expect(g[0]).toEqual([0, 0, 0, 0, 0, 0, 1])
    expect(g.flat().filter(Boolean).length).toBe(30)
    expect(g.every((r) => r.length === 7)).toBe(true)
  })
  it('shifts months across year ends', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ y: 2027, m: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ y: 2025, m: 12 })
  })
  it('parses and rejects values', () => {
    expect(parseDate('2026-11-05')).toEqual({ y: 2026, m: 11, d: 5 })
    expect(parseDate('2026-02-30')).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseTime('08:05')).toEqual({ h: 8, min: 5 })
    expect(parseTime('24:00')).toBeNull()
    expect(parseMonth('2026-11')).toEqual({ y: 2026, m: 11 })
    expect(isoDate(2026, 3, 9)).toBe('2026-03-09')
  })
})
