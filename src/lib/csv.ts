// CSV writing and reading for EXPORT. Pure functions.
//
// Writing: one header line, one line per record, comma separated, CRLF line ends, a UTF-8 byte-order mark
// so Excel shows Ñ and ₡ correctly. A cell with a comma, quote or line break is quoted. Lists and objects
// are written as JSON text. A text cell that starts with = + @ (or - followed by a letter) gets a leading
// apostrophe so a spreadsheet never runs it as a formula.

export const BOM = '﻿'

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (typeof v === 'string') {
    s = v
    if (/^[=+@]/.test(s) || /^-[^0-9.\s]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`
  } else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : ''
  else if (typeof v === 'boolean') s = v ? 'true' : 'false'
  else s = JSON.stringify(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Columns = id first, then every other key in the order first met. */
export function columnsOf(rows: Record<string, unknown>[], first: string[] = ['id']): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of first) {
    if (rows.some((r) => k in r)) {
      seen.add(k)
      out.push(k)
    }
  }
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k)
        out.push(k)
      }
    }
  }
  return out
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[], opts: { bom?: boolean } = {}): string {
  const cols = columns ?? columnsOf(rows)
  const lines: string[] = [cols.map(csvCell).join(',')]
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','))
  return (opts.bom === false ? '' : BOM) + lines.join('\r\n') + '\r\n'
}

/** Read CSV text into rows of cells (handles quotes, doubled quotes, CRLF or LF, a leading BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  let i = 0
  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    rows.push(row)
    row = []
  }
  while (i < s.length) {
    const ch = s[i]
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        q = false
      } else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') endCell()
    else if (ch === '\r') {
      if (s[i + 1] === '\n') i++
      endRow()
    } else if (ch === '\n') endRow()
    else cell += ch
    i++
  }
  if (cell !== '' || row.length) endRow()
  return rows
}
