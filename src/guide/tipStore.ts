import { useSyncExternalStore } from 'react'

// TIP MODE: the touch way to read a tooltip. While it is on, tapping any control shows what it does
// instead of pressing it. Hover (mouse) and focus (keyboard) show the same tips without this mode.

let on = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export const tipModeOn = () => on
export function setTipMode(v: boolean) {
  if (on === v) return
  on = v
  emit()
}
export const toggleTipMode = () => setTipMode(!on)
export const useTipMode = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => on,
    () => false,
  )
