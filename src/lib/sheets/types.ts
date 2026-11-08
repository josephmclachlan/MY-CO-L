// Shared shapes for the Google Sheet mirror (see docs/GOOGLE-SHEET.md).

/** What kind of value a column holds. Comes from the database rules (columns.gen.ts) or, for app-only fields, the values. */
export type ColumnKind = 'text' | 'number' | 'bool' | 'date' | 'datetime' | 'json'

export interface ColumnSpec {
  kind: ColumnKind
  /** The database refuses an empty value (only checked on records first typed in the sheet). */
  required?: boolean
  /** The only values the database takes (a dropdown in the sheet). */
  choices?: string[]
}

/** One cell as the sheet holds it. '' = empty. */
export type Cell = string | number | boolean

/** A column of one tab, as sent to the sheet script. */
export interface SheetColumn {
  name: string
  kind: ColumnKind
  /** Grey and put back if changed. */
  ro: boolean
  choices?: string[]
  /** The note on the header cell. */
  note: string
  /** A look-up column: the code of the record another column points at. */
  link?: { fk: string; ref: string; pick: string }
}

export interface PulledRow {
  id: string
  /** The time a person last edited this row in the sheet (stamped by the sheet script). */
  edited_at: string
  cells: Record<string, Cell>
}

export interface PullResult {
  /** The sheet's clock at the time of reading: the next pull asks for rows edited after this. */
  now: string
  tabs: Record<string, { rows: PulledRow[]; ids?: string[] }>
}

export interface PushTab {
  columns: SheetColumn[]
  /** Each record's changed cells (all cells for a record new to the sheet). fill = every cell, used only if the
   *  row is not in the sheet any more, so a partial change never leaves a half-empty row. */
  upserts: { id: string; cells: Record<string, Cell>; fill?: Record<string, Cell> }[]
  deletes: string[]
  color?: string
  order: number
}

export interface PushRequest {
  tabs: Record<string, PushTab>
  readme: Cell[][]
}

export interface SheetClient {
  hello(): Promise<{ version: number; sheet: string; url?: string }>
  pull(req: { since: string | null; full: boolean; tabs: string[] }): Promise<PullResult>
  push(req: PushRequest): Promise<{ now: string; written: number }>
}
