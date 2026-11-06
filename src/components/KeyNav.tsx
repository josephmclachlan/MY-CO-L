import { useEffect, useRef } from 'react'
import { isTypingKey, pickNext, type Box, type Dir } from '../lib/keynav'
import { tipModeOn } from '../guide/tipStore'

/**
 * App-wide keyboard control. One listener, so every screen behaves the same:
 *
 *   ARROWS        move between items on the screen; past the edge of the
 *                 content they cross to the index, the BACK button or the F-keys
 *   ENTER / SPACE open the item (lists, rooms, rows, buttons)
 *   [  ]          jump to the index column / back to the content
 *   PGUP PGDN     scroll the page; focus stays on an item you can see
 *   HOME END      top / bottom of the page
 *   BACKSPACE     BACK (when you are not typing in a field)
 *   ESC           close a pop-up, leave a field, otherwise BACK
 *   any letter    goes to the command prompt
 *
 * Zones are marked with data-kbd-zone (main, index, keys, top) in Shell and Manual.
 */

const FOCUSABLE =
  'summary, button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const POPUP = '.ui-pick.open .ui-pick-panel, .src-box'
const OPEN_ANY = '.ui-select.open, .ui-pick.open, .src-pop'
const PROMPT = '.prompt input'

const box = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}
const shown = (el: Element) => {
  // Inside a closed <details> (e.g. the hazard filters on a phone) an item still has a box but can't take focus.
  const shut = el.closest('details:not([open])')
  if (shut && !el.closest('summary')) return false
  const cv = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (cv && !cv.call(el, { visibilityProperty: true })) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const st = getComputedStyle(el)
  return st.visibility !== 'hidden' && st.display !== 'none'
}
const isPrompt = (el: Element | null) => !!el && el.matches(PROMPT)
const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(el.type)
}
const zoneOf = (el: Element | null): HTMLElement | null =>
  (el?.closest(POPUP) as HTMLElement | null) ?? (el?.closest('[data-kbd-zone]') as HTMLElement | null)
const zoneByName = (name: string): HTMLElement | null => {
  // The innermost visible zone of that name wins (the manual's contents sit inside main).
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-kbd-zone="${name}"]`)).filter(shown)
  return all[all.length - 1] ?? null
}
const scrollable = (el: HTMLElement) => {
  const oy = getComputedStyle(el).overflowY
  return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1
}
/** The box that scrolls for this zone: an ancestor of `from`, the zone itself, or its biggest scroller. */
function scrollerOf(zone: HTMLElement, from?: Element | null): HTMLElement | null {
  for (let el = from as HTMLElement | null; el && el !== zone && zone.contains(el); el = el.parentElement) {
    if (scrollable(el) && !el.matches('.ui-pick-col')) return el
  }
  if (scrollable(zone)) return zone
  let best: HTMLElement | null = null
  zone.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (scrollable(el) && (!best || el.clientHeight > best.clientHeight)) best = el
  })
  return best
}
const items = (zone: Element) =>
  Array.from(zone.querySelectorAll(FOCUSABLE)).filter((el) => !isPrompt(el) && shown(el) && !el.closest('[aria-hidden="true"]'))
/** Items that are on screen inside their scroller. */
const inView = (el: Element, sc: HTMLElement | null) => {
  const r = el.getBoundingClientRect()
  const v = (sc ?? document.documentElement).getBoundingClientRect()
  const top = Math.max(r.top, v.top, 0)
  const bot = Math.min(r.bottom, v.bottom, window.innerHeight)
  return bot - top >= Math.min(r.height, 12) - 1
}
const allZones = () => Array.from(document.querySelectorAll<HTMLElement>('[data-kbd-zone]')).filter(shown)

function focusEl(el: Element) {
  ;(el as HTMLElement).focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** Click anything, including SVG groups, the way a tap would. */
function activate(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
}

export function useKeyNav(opts: { enabled: boolean; onBack: () => boolean }) {
  const ref = useRef(opts)
  ref.current = opts

  useEffect(() => {
    if (!opts.enabled) return
    // Where focus last was, so a key press after the item vanished carries on from there.
    let lastBox: Box | null = null
    let lastZone: string | null = null
    const lastIn = new Map<string, Element>()
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Element
      const z = zoneOf(t)?.getAttribute('data-kbd-zone')
      if (z && !isPrompt(t)) lastIn.set(z, t)
    }
    const onFocusOut = (e: FocusEvent) => {
      const t = e.target as Element
      if (isPrompt(t) || !t.isConnected) return
      lastBox = box(t)
      lastZone = zoneOf(t)?.getAttribute('data-kbd-zone') ?? null
    }

    /** Pressing an item can re-draw the screen and drop focus on nothing. Put it back on the nearest item. */
    const rescue = () => {
      if (document.activeElement && document.activeElement !== document.body) return
      if (!lastBox || document.querySelector('.src-pop')) return
      const zone = zoneByName(lastZone ?? 'main') ?? zoneByName('main')
      if (!zone) return
      const sc = scrollerOf(zone)
      const cx0 = (lastBox.left + lastBox.right) / 2
      const cy0 = (lastBox.top + lastBox.bottom) / 2
      let best: Element | null = null
      let bestD = Infinity
      for (const el of items(zone)) {
        if (!inView(el, sc)) continue
        const b = box(el)
        const d = Math.hypot((b.left + b.right) / 2 - cx0, (b.top + b.bottom) / 2 - cy0)
        if (d < bestD) (bestD = d), (best = el)
      }
      if (best) (best as HTMLElement).focus({ preventScroll: true })
      else landIn(zone, false, false)
    }
    const timers: number[] = []
    const rescueSoon = () => {
      for (const ms of [50, 250, 700]) timers.push(window.setTimeout(rescue, ms))
    }
    // Keyboard mode: a strong focus ring shows while you use keys, and hides again when you tap or click.
    const onPointer = () => document.documentElement.classList.remove('kbd')

    /** Best item in a zone to land on: the selected one if visible, else the first (or last) on screen. */
    const landIn = (zone: HTMLElement, fromEnd = false, remember = true) => {
      const sc = scrollerOf(zone)
      const list = items(zone)
      if (!list.length) {
        // Nothing to press here: hold focus on the panel itself so arrows and page keys scroll it.
        zone.tabIndex = -1
        zone.focus({ preventScroll: true })
        return true
      }
      const prev = remember ? lastIn.get(zone.getAttribute('data-kbd-zone') ?? '') : undefined
      if (prev && prev.isConnected && zone.contains(prev) && shown(prev) && inView(prev, sc)) return focusEl(prev), true
      const visible = list.filter((el) => inView(el, sc))
      const sel = visible.find((el) => el.matches('.sel, .cur, [aria-selected="true"]')) ?? list.find((el) => el.matches('.sel, [aria-selected="true"]'))
      const pick = sel ?? (fromEnd ? visible[visible.length - 1] : visible[0]) ?? list[0]
      focusEl(pick)
      return true
    }

    const scrollBy = (sc: HTMLElement | null, dy: number) => {
      if (!sc) return false
      const before = sc.scrollTop
      sc.scrollTop = before + dy
      return sc.scrollTop !== before
    }

    /** After the page scrolled, keep focus on something you can still see. */
    const keepInView = (zone: HTMLElement, sc: HTMLElement | null, active: Element | null, toEnd: boolean) => {
      if (active && zone.contains(active) && !isPrompt(active) && inView(active, sc)) return
      if (!active || isPrompt(active) || active === document.body) return
      const visible = items(zone).filter((el) => inView(el, sc))
      const pick = toEnd ? visible[visible.length - 1] : visible[0]
      if (pick) (pick as HTMLElement).focus({ preventScroll: true })
    }

    const move = (dir: Dir, from: Element | null) => {
      const zone = (from && zoneOf(from)) || zoneByName(lastZone ?? 'main') || zoneByName('main')
      if (!zone) return
      if (from === zone && !zone.matches(POPUP)) {
        // Focus is on the panel itself (no items): arrows scroll it, or step into an item if one appeared.
        if (items(zone).length) return void landIn(zone, dir === 'up', false)
        const sc = scrollerOf(zone)
        if ((dir === 'up' || dir === 'down') && scrollBy(sc, (dir === 'down' ? 1 : -1) * (sc?.clientHeight ?? 0) * 0.3)) return
        // At the end of the page: cross to the F-keys, BACK or the index like any item would.
        return cross(zone, box(zone), dir)
      }
      const cur = from && from !== document.body ? box(from) : lastBox
      if (!cur) return void landIn(zone, dir === 'up')
      const popup = zone.matches(POPUP)
      const sc = zone.matches('.ui-pick-panel') ? null : scrollerOf(zone, from)
      const list = items(zone).filter((el) => el !== from)
      const rowLimit = Math.max(48, (cur.bottom - cur.top) * 2)
      const i = pickNext(cur, list.map(box), dir, rowLimit)
      if (i >= 0) {
        const el = list[i]
        if (sc && (dir === 'up' || dir === 'down')) {
          // A long run of text before the next item: scroll through it instead of jumping past it.
          const v = sc.getBoundingClientRect()
          const r = el.getBoundingClientRect()
          const need = dir === 'down' ? r.bottom - v.bottom : v.top - r.top
          if (need > v.height * 0.9) {
            scrollBy(sc, (dir === 'down' ? 1 : -1) * v.height * 0.6)
            return
          }
        }
        return focusEl(el)
      }
      // Nothing more this way inside the zone: scroll if there is more page, else cross to the next zone.
      if (sc && (dir === 'up' || dir === 'down')) {
        const h = sc.getBoundingClientRect().height
        if (scrollBy(sc, (dir === 'down' ? 1 : -1) * h * 0.6)) return
      }
      if (popup) return
      cross(zone, cur, dir)
    }

    const cross = (zone: HTMLElement, cur: Box, dir: Dir) => {
      const seen = new Set<Element>()
      const others: Element[] = []
      for (const z of allZones()) {
        if (z === zone) continue
        const zsc = scrollerOf(z)
        const list = items(z)
        // A page with nothing to press (HELP, STATUS) is itself the place to go back to.
        if (!list.length && !z.contains(zone) && !zone.contains(z) && !seen.has(z)) seen.add(z), others.push(z)
        for (const el of list) if (!zone.contains(el) && !seen.has(el) && inView(el, zsc)) seen.add(el), others.push(el)
      }
      // Up and down only cross to what sits above or below (F-keys, BACK), never sideways into the index.
      const reach = dir === 'up' || dir === 'down' ? others.filter((el) => { const b = box(el); return b.right > cur.left && b.left < cur.right }) : others
      const j = pickNext(cur, reach.map(box), dir)
      if (j < 0) return
      const to = reach[j]
      if (to.hasAttribute('data-kbd-zone')) {
        ;(to as HTMLElement).tabIndex = -1
        ;(to as HTMLElement).focus({ preventScroll: true })
      } else focusEl(to)
    }

    const onKey = (e: KeyboardEvent) => {
      const o = ref.current
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return
      const active = document.activeElement
      document.documentElement.classList.add('kbd')
      if (active && active !== document.body && !isPrompt(active)) {
        lastBox = box(active)
        lastZone = zoneOf(active)?.getAttribute('data-kbd-zone') ?? lastZone
      }
      if (e.key === 'Enter' || e.key === ' ') rescueSoon()
      const handled = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      // An open drop-down keeps its own keys; an open date panel or source pop-up uses ours for arrows only.
      if (active?.closest('.ui-select.open')) return
      const openPopup = document.querySelector(OPEN_ANY)
      const prompt = isPrompt(active)
      const promptEmpty = prompt && !(active as HTMLInputElement).value
      const field = !prompt && isTextField(active)
      const textarea = active instanceof HTMLTextAreaElement
      const range = active instanceof HTMLInputElement && active.type === 'range'
      if (e.altKey) return

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown': {
          const dir: Dir = e.key === 'ArrowUp' ? 'up' : 'down'
          if (textarea) return
          if (prompt) {
            if (!promptEmpty) return
            // The main menu moves its own highlight from the prompt.
            if (document.querySelector('.menu-list')) return
            const main = zoneByName('main')
            if (main && landIn(main, dir === 'up', false)) handled()
            return
          }
          // A date panel opened from its button: arrows step into the panel.
          const pick = active?.closest('.ui-pick.open')
          if (pick && !active?.closest('.ui-pick-panel')) {
            const first = pick.querySelector('.ui-pick-panel .sel, .ui-pick-panel button')
            if (first) (first as HTMLElement).focus()
            return handled()
          }
          handled()
          return move(dir, active)
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (prompt || field || range) return
          handled()
          return move(e.key === 'ArrowLeft' ? 'left' : 'right', active)
        }
        case 'Enter':
        case ' ': {
          if (!active || active === document.body || prompt || field) return
          if (active.matches('button, a[href], input, textarea')) return
          if (active.matches('[tabindex]')) {
            handled()
            activate(active)
          }
          return
        }
        case 'PageDown':
        case 'PageUp':
        case 'Home':
        case 'End': {
          if (field || (prompt && !promptEmpty && (e.key === 'Home' || e.key === 'End'))) return
          if (active?.closest('.ui-pick-panel')) return
          const zone = (!prompt && active && zoneOf(active)) || zoneByName('main')
          if (!zone) return
          const sc = scrollerOf(zone, prompt ? null : active)
          if (!sc) return
          handled()
          const h = sc.clientHeight * 0.85
          if (e.key === 'PageDown') sc.scrollTop += h
          else if (e.key === 'PageUp') sc.scrollTop -= h
          else if (e.key === 'Home') sc.scrollTop = 0
          else sc.scrollTop = sc.scrollHeight
          return keepInView(zone, sc, active, e.key === 'PageUp' || e.key === 'Home' ? false : e.key === 'End')
        }
        case '[':
        case ']': {
          if (field || (prompt && !promptEmpty) || openPopup) return
          const zone = zoneByName(e.key === '[' ? 'index' : 'main')
          if (zone && landIn(zone)) handled()
          else if (e.key === '[') handled()
          return
        }
        case 'Backspace': {
          if (field || (prompt && !promptEmpty) || openPopup || e.repeat) return
          if (o.onBack()) handled()
          return
        }
        case 'Escape': {
          if (openPopup) return // the pop-up closes itself
          if (tipModeOn() || document.getElementById('tip-bubble')) return // an open tip or tip mode takes the Esc (components/Tips.tsx)
          if (field) {
            handled()
            ;(document.querySelector(PROMPT) as HTMLElement | null)?.focus()
            return
          }
          if (prompt && !promptEmpty) return
          if (o.onBack()) handled()
          return
        }
        default: {
          // Typing anywhere goes to the command prompt.
          if (prompt || field || textarea || !isTypingKey(e) || openPopup) return
          const input = document.querySelector(PROMPT) as HTMLInputElement | null
          if (input) input.focus({ preventScroll: true })
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      document.removeEventListener('pointerdown', onPointer)
      document.documentElement.classList.remove('kbd')
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [opts.enabled])
}
