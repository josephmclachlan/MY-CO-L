import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { tipFor, tipForClass } from '../guide/tipLookup'
import { setTipMode, tipModeOn, toggleTipMode, useTipMode } from '../guide/tipStore'
import { useT } from '../settings/useT'

/**
 * Tooltips for every control, three ways in:
 *   MOUSE     rest the pointer on a control: the tip appears after half a second.
 *   KEYBOARD  move focus to a control (arrows or Tab): the tip appears after a short pause.
 *   TOUCH     tap ? TIPS in the status line. Now tapping a control shows its tip instead of pressing it.
 *             Tap ? TIPS again (or press Esc) to go back to normal.
 * The tip text comes from, in order: the control's data-tip, its title, then the TIPS list by label (src/guide/tips.ts).
 */

const TARGET = 'button, [role="button"], [role="tab"], [role="option"], a[href], input, textarea, label, summary, [tabindex="0"], [data-tip]'
const HOVER_MS = 450
const FOCUS_MS = 650
const SWALLOW = ['pointerdown', 'mousedown', 'touchstart', 'mouseup', 'pointerup', 'touchend', 'click']

interface Shown {
  el: HTMLElement
  text: string | null
  sticky: boolean
  /** Where the mouse rested when a hover tip opened. */
  at?: { x: number; y: number }
}

/** A record row in a list or table: its tip goes above it, so the rows below stay readable. */
const isRow = (el: HTMLElement) => el.matches('tr, li, [role=row]')

/** What the control is called: its explicit key, aria-label, field caption, or its own text. */
function labelOf(el: HTMLElement): string {
  const k = el.getAttribute('data-tip-key')
  if (k) return k
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const field = el.matches('input, textarea') ? el.closest('label') : el.matches('label') ? el : null
  if (field) {
    const cap = field.querySelector('span, b, strong')
    if (cap?.textContent?.trim()) return cap.textContent
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.closest('label')?.textContent ?? ''
  if (el.matches('input, textarea')) return (el as HTMLInputElement).placeholder || ''
  return el.textContent ?? ''
}

/** Finds the control under a node and the tip text for it (null text = a control with no tip). */
export function tipTarget(node: EventTarget | null): { el: HTMLElement; text: string | null } | null {
  if (!(node instanceof Element)) return null
  if (node.closest('[data-tip-ui]')) return null
  const el = node.closest<HTMLElement>(TARGET)
  if (!el) return null
  if (el.matches('label') && !el.querySelector('input, textarea, button')) return null
  const own = el.getAttribute('data-tip') ?? el.dataset.tipTitle
  if (own) return { el, text: own }
  const title = el.getAttribute('title')
  if (title) {
    // Keep the browser's own pop-up from doubling ours; keep the accessible name.
    el.dataset.tipTitle = title
    if (!el.textContent?.trim() && !el.getAttribute('aria-label')) el.setAttribute('aria-label', title)
    el.removeAttribute('title')
    return { el, text: title }
  }
  if (el.matches('.ui-select-btn')) {
    const now = (el.textContent ?? '').replace(/[\u25BE\s]+$/, '').trim()
    return { el, text: `Open the list and pick one${now ? `. Now: ${now}` : ''}. Arrows move, a letter jumps, Enter picks.` }
  }
  const lab = labelOf(el)
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const words = (el.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (words) return { el, text: `Tick or untick: ${words.charAt(0)}${words.slice(1).toLowerCase()}` }
  }
  const byLabel = lab ? tipFor(lab) : null
  return { el, text: byLabel ?? tipForClass(el) }
}

// The audit scripts read this in dev builds to list controls that have no tip.
if (import.meta.env.DEV) (window as unknown as { __tipTarget: typeof tipTarget }).__tipTarget = tipTarget

export const NO_TIP = 'NO TIP FOR THIS ONE. IT DOES WHAT ITS NAME SAYS. THE GUIDE EXPLAINS THIS SCREEN.'

interface Props {
  /** Guide section for the screen being shown. */
  screen: string
  onGuide: (screen: string) => void
}

export function TipLayer({ screen, onGuide }: Props) {
  const { t } = useT()
  const mode = useTipMode()
  const [shown, setShown] = useState<Shown | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  const shownRef = useRef<Shown | null>(null)
  shownRef.current = shown

  const hide = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    shownRef.current?.el.removeAttribute('aria-describedby')
    setShown(null)
    setPos(null)
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(fn, ms)
  }, [])

  useEffect(() => {
    const mouse = { x: 0, y: 0 }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || tipModeOn()) return
      const hit = tipTarget(e.target)
      if (!hit || !hit.text) return hide()
      if (shownRef.current?.el === hit.el) return
      hide()
      later(() => setShown({ el: hit.el, text: hit.text, sticky: false, at: { ...mouse } }), HOVER_MS)
    }
    // A hover tip is for a resting mouse: moving on along a row or down a list hides it, and it comes back when the mouse rests again.
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      if (e.pointerType !== 'mouse' || tipModeOn()) return
      const cur = shownRef.current
      if (!cur || cur.sticky || !cur.at) {
        if (!cur && timer.current) {
          // Still waiting to show: restart the wait while the mouse keeps moving.
          const hit = tipTarget(e.target)
          if (hit?.text) later(() => setShown({ el: hit.el, text: hit.text, sticky: false, at: { ...mouse } }), HOVER_MS)
        }
        return
      }
      if (Math.hypot(e.clientX - cur.at.x, e.clientY - cur.at.y) > 12) {
        const hit = tipTarget(e.target)
        hide()
        if (hit?.text) later(() => setShown({ el: hit.el, text: hit.text, sticky: false, at: { ...mouse } }), HOVER_MS)
      }
    }
    const onOut = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && !shownRef.current?.sticky) hide()
    }
    // Touch-only phones get tips from ? TIPS only: typing a command on the phone keyboard moves focus too, and a tip would pop up over the page.
    const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const onFocus = (e: FocusEvent) => {
      if (shownRef.current?.sticky || touchOnly) return
      const hit = tipTarget(e.target)
      if (!hit || !hit.text) return hide()
      if (!hit.el.matches(':focus-visible')) return hide() // not the focus a mouse click gives
      hide()
      later(() => setShown({ el: hit.el, text: hit.text, sticky: false }), FOCUS_MS)
    }
    const onBlur = () => {
      if (!shownRef.current?.sticky) hide()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (shownRef.current || tipModeOn()) {
          e.preventDefault()
          e.stopImmediatePropagation()
          if (shownRef.current) hide()
          else setTipMode(false)
        }
        return
      }
      if (shownRef.current && !shownRef.current.sticky && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) hide()
    }
    // TIP MODE: a tap shows the tip instead of pressing the control.
    const swallow = (e: Event) => {
      if (!tipModeOn()) return
      if (e.target instanceof Element && e.target.closest('.tips-btn')) return // the switch itself always works
      const hit = tipTarget(e.target)
      if (!hit) return
      // Only the click is cancelled: cancelling a touch start would stop the browser sending the click at all.
      e.stopPropagation()
      if (e.type === 'click') {
        e.preventDefault()
        hide()
        setShown({ el: hit.el, text: hit.text, sticky: true })
      }
    }
    const away = (e: Event) => {
      // Scrolling inside the tip itself is not a reason to close it.
      if (shownRef.current && !(e.target instanceof Element && e.target.closest('[data-tip-ui]'))) hide()
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    window.addEventListener('keydown', onKey, true)
    for (const ev of SWALLOW) document.addEventListener(ev, swallow, true)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      window.removeEventListener('keydown', onKey, true)
      for (const ev of SWALLOW) document.removeEventListener(ev, swallow, true)
      window.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', away)
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [hide, later])

  useEffect(() => {
    if (!mode) hide()
  }, [mode, hide])
  useEffect(() => hide(), [screen, hide])

  // Place the bubble under the control (above if there is no room), inside the screen.
  useLayoutEffect(() => {
    if (!shown || !bubble.current) return
    const r = shown.el.getBoundingClientRect()
    const b = bubble.current.getBoundingClientRect()
    const m = 8
    const above = r.top - b.height - 8
    const below = r.bottom + 8
    // Rows: above the row (the next rows stay readable), else below. Other controls: below, else above.
    let top = isRow(shown.el) && above >= m ? above : below
    if (top + b.height > window.innerHeight - m) top = Math.max(m, above)
    // A hover tip on a wide row sits by the mouse, not the middle of the row.
    const cx = shown.at && r.width > 240 ? shown.at.x : r.left + r.width / 2
    const left = Math.min(Math.max(m, cx - b.width / 2), Math.max(m, window.innerWidth - b.width - m))
    setPos({ left, top })
    shown.el.setAttribute('aria-describedby', 'tip-bubble')
  }, [shown])

  if (!shown) return null
  return (
    <div
      id="tip-bubble"
      ref={bubble}
      role="tooltip"
      data-tip-ui
      className={`tip-bubble ${shown.sticky ? 'sticky' : ''} ${shown.text ? '' : 'none'}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="tip-text">{t(shown.text ?? NO_TIP)}</div>
      {shown.sticky && (
        <div className="tip-actions">
          <button type="button" onClick={() => { hide(); setTipMode(false); onGuide(screen) }}>{t('OPEN THE GUIDE FOR THIS SCREEN')}</button>
          <button type="button" onClick={hide}>{t('CLOSE')}</button>
        </div>
      )}
    </div>
  )
}

/** The ? TIPS button for the status line. */
export function TipsButton() {
  const { t } = useT()
  const mode = useTipMode()
  return (
    <button
      type="button"
      className={`tips-btn ${mode ? 'on' : ''}`}
      aria-pressed={mode}
      data-tip="Tip mode: tap any control to read what it does instead of pressing it. Tap this again, or press Esc, to leave. With a mouse, rest on a control. With the keyboard, move to it."
      onClick={toggleTipMode}
    >
      ? {t('TIPS')}
      {mode ? ` ${t('ON')}` : ''}
    </button>
  )
}
