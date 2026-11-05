/**
 * Pure helpers for keyboard navigation: pick the nearest item in a direction.
 * Kept free of the DOM so it can be unit tested.
 */
export type Dir = 'up' | 'down' | 'left' | 'right'
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const cx = (b: Box) => (b.left + b.right) / 2
const cy = (b: Box) => (b.top + b.bottom) / 2
const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1)

/**
 * Index of the best candidate to move to from `cur` in `dir`, or -1.
 * `rowLimit` stops left/right jumping to an item on a far-away row.
 */
export function pickNext(cur: Box, cands: Box[], dir: Dir, rowLimit = Infinity): number {
  if (dir === 'down' || dir === 'up') {
    // Reading order: the nearest row first, then what lines up best inside that row.
    const ahead: { i: number; p: number; side: number; lean: number }[] = []
    cands.forEach((c, i) => {
      const ok = dir === 'down' ? cy(c) > cy(cur) + 2 && c.top > cur.top + 2 : cy(c) < cy(cur) - 2 && c.bottom < cur.bottom - 2
      if (!ok) return
      const p = dir === 'down' ? Math.max(0, c.top - cur.bottom) : Math.max(0, cur.top - c.bottom)
      ahead.push({ i, p, side: gap(cur.left, cur.right, c.left, c.right), lean: Math.abs(c.left - cur.left) })
    })
    if (!ahead.length) return -1
    const near = Math.min(...ahead.map((a) => a.p))
    const tol = Math.max(6, (cur.bottom - cur.top) * 0.5)
    const row = ahead.filter((a) => a.p <= near + tol)
    row.sort((a, b) => a.side - b.side || a.lean - b.lean || a.p - b.p)
    return row[0].i
  }
  let best = -1
  let bestScore = Infinity
  cands.forEach((c, i) => {
    const ok = dir === 'right' ? cx(c) > cx(cur) + 2 && c.left > cur.left + 2 : cx(c) < cx(cur) - 2 && c.right < cur.right - 2
    if (!ok) return
    const side = gap(cur.top, cur.bottom, c.top, c.bottom)
    if (side > rowLimit) return
    const primary = dir === 'right' ? Math.max(0, c.left - cur.right) : Math.max(0, cur.left - c.right)
    const score = primary + side * 4 + Math.abs(cy(c) - cy(cur)) * 0.5
    if (score < bestScore) (bestScore = score), (best = i)
  })
  return best
}

/** True for keys that type a character (letters, numbers, signs). */
export function isTypingKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey
}
