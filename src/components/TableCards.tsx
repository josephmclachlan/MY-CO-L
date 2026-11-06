import { useEffect } from 'react'

/**
 * Phones: a table too wide for the screen turns into cards (one card per row,
 * each value under its column name) instead of sliding sideways.
 *
 * Works on every table inside a `.rc-wrap` or `.ck-scroll`, so screens need no change: each body
 * cell gets a `data-label` from its column header, and the wrapper gets the class
 * `as-cards` when the table would not fit. Desktop tables are left alone.
 */
export const CARD_WIDTH = 700

function label(wrap: HTMLElement) {
  const table = wrap.querySelector('table')
  if (!table) return null
  const headRow = table.tHead?.rows[table.tHead.rows.length - 1]
  const heads: string[] = []
  if (headRow)
    for (const th of Array.from(headRow.cells)) {
      const text = (th.textContent ?? '').trim()
      for (let i = 0; i < (th.colSpan || 1); i++) heads.push(text)
    }
  for (const body of Array.from(table.tBodies))
    for (const tr of Array.from(body.rows)) {
      let col = 0
      for (const td of Array.from(tr.cells)) {
        const want = td.colSpan > 1 ? '' : heads[col] ?? ''
        if (td.getAttribute('data-label') !== want) td.setAttribute('data-label', want)
        col += td.colSpan || 1
      }
    }
  return table
}

function fit(wrap: HTMLElement, table: HTMLTableElement, phone: boolean) {
  if (!phone) {
    wrap.classList.remove('as-cards')
    return
  }
  const was = wrap.classList.contains('as-cards')
  if (was) wrap.classList.remove('as-cards')
  const wide = table.scrollWidth > wrap.clientWidth + 2
  if (wide) wrap.classList.add('as-cards')
}

export function useTableCards() {
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${CARD_WIDTH}px)`)
    // Each table is only looked at again when its size or text changed (typing text changes the page many times a second).
    const seen = new WeakMap<HTMLElement, string>()
    let wait = 0
    const pass = () => {
      wait = 0
      const phone = mq.matches
      for (const wrap of Array.from(document.querySelectorAll<HTMLElement>('.rc-wrap, .ck-scroll'))) {
        const table = wrap.querySelector('table')
        if (!table) continue
        const sig = `${phone ? 1 : 0}:${wrap.clientWidth}:${table.rows.length}:${(table.textContent ?? '').length}`
        if (seen.get(wrap) === sig) continue
        seen.set(wrap, sig)
        label(wrap)
        fit(wrap, table, phone)
      }
    }
    const soon = () => {
      if (!wait) wait = window.setTimeout(pass, 120)
    }
    // Only content changes are watched (not attributes), so adding the class can't loop.
    const obs = new MutationObserver(soon)
    obs.observe(document.body, { childList: true, subtree: true, characterData: true })
    window.addEventListener('resize', soon)
    mq.addEventListener?.('change', soon)
    soon()
    void document.fonts?.ready.then(soon)
    return () => {
      obs.disconnect()
      window.removeEventListener('resize', soon)
      mq.removeEventListener?.('change', soon)
      if (wait) window.clearTimeout(wait)
    }
  }, [])
}
