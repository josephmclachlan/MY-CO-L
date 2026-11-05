// Pure date helpers for the in-app pickers (no time zones: values are plain YYYY-MM-DD strings).

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

const p2 = (n: number) => String(n).padStart(2, '0')

export const isoDate = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`

export function parseDate(v: string): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!x) return null
  const y = +x[1], m = +x[2], d = +x[3]
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null
  return { y, m, d }
}

export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Rows of 7 cells for a month, weeks starting Monday. Empty cells are 0. */
export function monthGrid(y: number, m: number): number[][] {
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const cells: number[] = [...Array(lead).fill(0), ...Array.from({ length: daysIn(y, m) }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(0)
  const rows: number[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

export function shiftMonth(y: number, m: number, by: number): { y: number; m: number } {
  const t = y * 12 + (m - 1) + by
  return { y: Math.floor(t / 12), m: (t % 12) + 1 }
}

export function parseTime(v: string): { h: number; min: number } | null {
  const x = /^(\d{2}):(\d{2})/.exec(v)
  if (!x || +x[1] > 23 || +x[2] > 59) return null
  return { h: +x[1], min: +x[2] }
}

export const isoTime = (h: number, min: number) => `${p2(h)}:${p2(min)}`

export function parseMonth(v: string): { y: number; m: number } | null {
  const x = /^(\d{4})-(\d{2})$/.exec(v)
  if (!x || +x[2] < 1 || +x[2] > 12) return null
  return { y: +x[1], m: +x[2] }
}
