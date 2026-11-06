// Reading what a QR label (or a typed code) points at (build G4).
// Labels made by XENOGENETICS carry  <app address>#xeno/c/<id>  (culture), /g/ (grain), /b/ (block lot).
// Cart labels made by MISSION > SCAN carry  <app address>#cart/<CODE>.

import { recordUrl, type BlockLot, type Culture, type GrainRun } from './xeno'

export type ScanKind = 'culture' | 'grain' | 'lot' | 'cart'
export interface ScanTarget {
  kind: ScanKind
  /** culture / grain / lot id, or the cart code. */
  id: string
}

const KIND: Record<string, ScanKind> = { c: 'culture', g: 'grain', b: 'lot' }

/** What a scanned or typed text points at, from its shape alone (no lookup). Null = not one of ours. */
export function parseScan(text: string): ScanTarget | null {
  const t = text.trim()
  if (!t) return null
  const hash = t.includes('#') ? t.slice(t.indexOf('#')) : t
  let m = /^#?xeno\/([cgb])\/([0-9a-zA-Z-]+)$/.exec(hash)
  if (m) return { kind: KIND[m[1]], id: m[2] }
  m = /^#?cart\/([0-9A-Za-z_-]{1,20})$/i.exec(hash)
  if (m) return { kind: 'cart', id: m[1].toUpperCase() }
  m = /^([cgb]):([0-9a-zA-Z-]+)$/.exec(t) // the key form used inside the app
  if (m) return { kind: KIND[m[1]], id: m[2] }
  return null
}

export function cartUrl(code: string, here?: Location): string {
  return recordUrl('c:x', here).replace(/#xeno\/c\/x$/, `#cart/${encodeURIComponent(code.toUpperCase())}`)
}

export function cartFromHash(hash: string): string | null {
  const p = parseScan(hash)
  return p?.kind === 'cart' ? p.id : null
}

export interface ScanData {
  lots: BlockLot[]
  cultures: Culture[]
  grain: GrainRun[]
}

export type Resolved =
  | { kind: 'culture'; culture: Culture }
  | { kind: 'grain'; run: GrainRun }
  | { kind: 'lot'; lot: BlockLot }
  | { kind: 'cart'; code: string; lots: BlockLot[] }

/** Find the record. Accepts a label's address, or a plain code typed by hand (B1020, C-07, BO-01 W3 P1 ...). */
export function resolveScan(text: string, d: ScanData): Resolved | null {
  const p = parseScan(text)
  if (p) {
    if (p.kind === 'culture') {
      const c = d.cultures.find((x) => x.id === p.id)
      return c ? { kind: 'culture', culture: c } : null
    }
    if (p.kind === 'grain') {
      const g = d.grain.find((x) => x.id === p.id)
      return g ? { kind: 'grain', run: g } : null
    }
    if (p.kind === 'lot') {
      const l = d.lots.find((x) => x.id === p.id)
      return l ? { kind: 'lot', lot: l } : null
    }
    return cartResult(p.id, d)
  }
  const code = text.trim().toUpperCase()
  if (!code) return null
  const lots = d.lots.filter((l) => l.lot_code.toUpperCase() === code)
  if (lots.length) return { kind: 'lot', lot: [...lots].sort((a, b) => b.knock_date.localeCompare(a.knock_date))[0] }
  const cart = cartResult(code, d)
  if (cart) return cart
  const c = d.cultures.find((x) => (x.label ?? '').toUpperCase() === code)
  if (c) return { kind: 'culture', culture: c }
  const g = d.grain.find((x) => (x.label ?? '').toUpperCase() === code)
  if (g) return { kind: 'grain', run: g }
  return null
}

const ACTIVE = new Set(['incubating', 'fruiting'])

/** A cart is the blocks that carry that cart name and are still incubating or fruiting. */
function cartResult(code: string, d: ScanData): Resolved | null {
  const up = code.toUpperCase()
  const lots = d.lots.filter((l) => (l.cart ?? '').toUpperCase() === up && ACTIVE.has(l.status))
  if (lots.length) return { kind: 'cart', code: up, lots }
  const any = d.lots.some((l) => (l.cart ?? '').toUpperCase() === up)
  return any ? { kind: 'cart', code: up, lots: [] } : null
}
