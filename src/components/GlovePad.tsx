import { useCallback, useEffect, useRef, useState } from 'react'
import { padKey } from '../lib/padKey'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'

/**
 * Glove mode number pad. While glove mode is on, tapping any number box (inputmode decimal or numeric) opens this
 * big pad at the bottom of the screen instead of the phone's keyboard. The pad types into the box the same way a
 * keyboard would (React sees a normal input event), so no screen needs to know about it. A physical keyboard still works.
 */

type Field = HTMLInputElement

const isNumeric = (el: EventTarget | null): el is Field => el instanceof HTMLInputElement && (el.inputMode === 'decimal' || el.inputMode === 'numeric' || el.dataset.glovePad === 'decimal' || el.dataset.glovePad === 'numeric') && !el.disabled && !el.readOnly && el.type !== 'file'

/** Set a value so React's onChange fires, as if it had been typed. */
function setValue(el: Field, v: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const label = (el: Field) => (el.getAttribute('aria-label') ?? el.closest('label')?.querySelector('span')?.textContent ?? el.placeholder ?? '').toUpperCase().slice(0, 40)

export function GlovePad() {
  const { settings, sound } = useApp()
  const { t } = useT()
  const [target, setTarget] = useState<Field | null>(null)
  const [val, setVal] = useState('')
  const pad = useRef<HTMLDivElement>(null)
  const on = settings.glove

  // Keep the phone's own keyboard away from number boxes while glove mode is on.
  useEffect(() => {
    if (!on) return
    const mute = (e: Event) => {
      const el = e.target
      if (el instanceof HTMLInputElement && (el.inputMode === 'decimal' || el.inputMode === 'numeric')) {
        el.dataset.glovePad = el.inputMode
        el.inputMode = 'none'
      }
    }
    document.addEventListener('pointerdown', mute, true)
    document.addEventListener('focusin', mute, true)
    return () => {
      document.removeEventListener('pointerdown', mute, true)
      document.removeEventListener('focusin', mute, true)
      for (const el of document.querySelectorAll<HTMLInputElement>('input[data-glove-pad]')) {
        el.inputMode = el.dataset.glovePad ?? 'decimal'
        delete el.dataset.glovePad
      }
    }
  }, [on])

  // Open on focus of a number box, close when focus goes somewhere else.
  useEffect(() => {
    if (!on) {
      setTarget(null)
      return
    }
    const open = (e: FocusEvent) => {
      if (isNumeric(e.target)) {
        setTarget(e.target)
        setVal(e.target.value)
      } else if (!(e.target instanceof Node && pad.current?.contains(e.target))) setTarget(null)
    }
    document.addEventListener('focusin', open)
    return () => document.removeEventListener('focusin', open)
  }, [on])

  // The box went away (another screen opened): close.
  useEffect(() => {
    if (!target) return
    const id = window.setInterval(() => {
      if (!target.isConnected) setTarget(null)
    }, 250)
    return () => window.clearInterval(id)
  }, [target])

  // Make room under the screen, and keep the box in view above the pad.
  useEffect(() => {
    document.body.classList.toggle('gl-open', !!target)
    if (!target) return
    const h = pad.current?.getBoundingClientRect().height
    if (h) document.documentElement.style.setProperty('--gl-pad', `${Math.ceil(h) + 12}px`)
    window.setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    return () => document.body.classList.remove('gl-open')
  }, [target])

  const decimal = (target?.dataset.glovePad ?? target?.inputMode) === 'decimal'
  const press = useCallback(
    (key: string) => {
      if (!target) return
      const next = padKey(target.value, key, decimal, target.maxLength > 0 ? target.maxLength : 24)
      if (next !== target.value) setValue(target, next)
      setVal(next)
      sound.chirp()
    },
    [target, decimal, sound],
  )
  const done = () => {
    target?.blur()
    setTarget(null)
  }
  const next = () => {
    if (!target) return
    const all = [...document.querySelectorAll<HTMLInputElement>('.main-panel input')].filter((i) => !i.disabled && i.type !== 'file' && i.offsetParent !== null)
    const at = all.indexOf(target)
    const n = at >= 0 ? all[at + 1] : undefined
    if (n) n.focus()
    else done()
  }

  if (!on || !target) return null
  const shown = val === '' ? '' : val
  const keep = (e: React.SyntheticEvent) => e.preventDefault() // keep the focus in the box
  return (
    <div className="gl-pad" ref={pad} role="group" aria-label={t('Number pad')} onMouseDown={keep} onPointerDown={keep}>
      <div className="gl-pad-head">
        <span className="gl-pad-label">{label(target)}</span>
        <span className={`gl-pad-val ${shown ? '' : 'empty'}`} aria-live="polite">{shown || '0'}</span>
      </div>
      <div className="gl-pad-grid">
        {['7', '8', '9'].map((k) => <button key={k} type="button" className="gl-key" onClick={() => press(k)}>{k}</button>)}
        <button type="button" className="gl-key fn" aria-label={t('Delete one')} onClick={() => press('BACK')}>{'⌫'}</button>
        {['4', '5', '6'].map((k) => <button key={k} type="button" className="gl-key" onClick={() => press(k)}>{k}</button>)}
        <button type="button" className="gl-key fn" onClick={() => press('CLEAR')}>{t('CLEAR')}</button>
        {['1', '2', '3'].map((k) => <button key={k} type="button" className="gl-key" onClick={() => press(k)}>{k}</button>)}
        <button type="button" className="gl-key fn" onClick={next}>{t('NEXT')}</button>
        <button type="button" className="gl-key" disabled={!decimal} aria-label={t('Plus or minus')} onClick={() => press('SIGN')}>{'±'}</button>
        <button type="button" className="gl-key" onClick={() => press('0')}>0</button>
        <button type="button" className="gl-key" disabled={!decimal} aria-label={t('Decimal point')} onClick={() => press('.')}>.</button>
        <button type="button" className="gl-key fn go" onClick={done}>{t('DONE')}</button>
      </div>
    </div>
  )
}
