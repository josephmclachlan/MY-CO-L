// Where the callout labels go: a column down each side of the view, each label
// as near the height of its anchor as the others allow, joined to its anchor by
// a square marker and a leader line (a 45° run, then level into the label).

export interface LabelIn {
  id: string
  /** Anchor on screen (px). */
  x: number
  y: number
  /** Label box size (px). */
  w: number
  h: number
  /** Side it was on last frame: -1 left, 1 right, 0 new. */
  side: -1 | 0 | 1
}

export interface LabelOut {
  id: string
  side: -1 | 1
  /** Label box top-left (px). */
  bx: number
  by: number
}

export interface LabelArea {
  w: number
  h: number
  /** Margin from the side edges (px). */
  pad: number
  /** Margin from the top and bottom (px); default pad. */
  padY?: number
  /** Space between stacked labels (px). */
  gap: number
  /** Where the two sides split (px from the left). */
  mid: number
}

/** Stack boxes (centres wanted at `want`, heights h) between lo and hi without overlap, in order. */
export function stack(want: number[], h: number[], lo: number, hi: number, gap: number): number[] {
  const n = want.length
  const c = want.slice()
  for (let i = 0; i < n; i++) {
    const min = i === 0 ? lo + h[0] / 2 : c[i - 1] + (h[i - 1] + h[i]) / 2 + gap
    c[i] = Math.max(c[i], min)
  }
  for (let i = n - 1; i >= 0; i--) {
    const max = i === n - 1 ? hi - h[i] / 2 : c[i + 1] - (h[i] + h[i + 1]) / 2 - gap
    c[i] = Math.min(c[i], max)
  }
  // if there was not room for all, the top one wins its place and the rest overlap downwards
  for (let i = 0; i < n; i++) {
    const min = i === 0 ? lo + h[0] / 2 : c[i - 1] + (h[i - 1] + h[i]) / 2 + gap
    if (c[i] < min) c[i] = min
  }
  return c
}

export function placeLabels(items: LabelIn[], a: LabelArea): LabelOut[] {
  const keep = a.w * 0.09
  const side = items.map((it) => {
    if (it.side !== 0 && Math.abs(it.x - a.mid) < keep) return it.side
    return it.x < a.mid ? -1 : 1
  })
  // keep the two columns roughly even when one side would overflow
  const py = a.padY ?? a.pad
  const room = a.h - 2 * py
  const need = (s: number) => items.reduce((n, it, i) => (side[i] === s ? n + it.h + a.gap : n), 0)
  for (let pass = 0; pass < items.length; pass++) {
    const l = need(-1)
    const r = need(1)
    const over = l > room ? -1 : r > room ? 1 : 0
    if (!over || need(-over as -1 | 1) + 30 > room) break
    // move the label nearest the middle across
    let best = -1
    for (let i = 0; i < items.length; i++) if (side[i] === over && (best < 0 || Math.abs(items[i].x - a.mid) < Math.abs(items[best].x - a.mid))) best = i
    if (best < 0) break
    side[best] = -over as -1 | 1
  }
  const out: LabelOut[] = []
  for (const s of [-1, 1] as const) {
    const idx = items.map((_, i) => i).filter((i) => side[i] === s)
    idx.sort((i, j) => items[i].y - items[j].y)
    const c = stack(
      idx.map((i) => items[i].y),
      idx.map((i) => items[i].h),
      py,
      a.h - py,
      a.gap,
    )
    idx.forEach((i, k) => {
      const it = items[i]
      out.push({ id: it.id, side: s, bx: s < 0 ? a.pad : a.w - a.pad - it.w, by: c[k] - it.h / 2 })
    })
  }
  return out
}

/** Half the side of the square marker (px). */
export const MARK = 3.5

/**
 * The leader from an anchor (x, y) to the label's near edge (ex, ey): a 45° run,
 * then level for at least `flat` px. Starts at the marker's edge, not its centre.
 */
export function leaderPath(x: number, y: number, ex: number, ey: number, flat = 7): string {
  const dx = ex - x
  const dy = ey - y
  const run = Math.abs(dx)
  const rise = Math.abs(dy)
  const sx = Math.sign(dx) || 1
  // too close for a bend: one straight leg
  const straight = run <= flat + MARK
  const kx = straight ? ex : rise <= run - flat ? x + sx * rise : ex - sx * flat
  // leave the marker from its edge, along the first leg
  const fx = kx - x
  const fy = ey - y
  const L = Math.max(Math.abs(fx), Math.abs(fy))
  const f = (v: number) => Math.round(v * 10) / 10
  // no room for a slant: level from the side of the marker
  if (L <= MARK) return `M${f(x + sx * MARK)},${f(y)}L${f(ex)},${f(ey)}`
  const x0 = x + (fx * MARK) / L
  const y0 = y + (fy * MARK) / L
  if (straight) return `M${f(x0)},${f(y0)}L${f(ex)},${f(ey)}`
  return `M${f(x0)},${f(y0)}L${f(kx)},${f(ey)}L${f(ex)},${f(ey)}`
}
