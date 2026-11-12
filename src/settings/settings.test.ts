import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS, loadSettings } from './settings'

describe('settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts the screen and the wireframes at 100% brightness', () => {
    expect(DEFAULTS.look.brightness).toBe(1)
    expect(DEFAULTS.look.models).toBe(1)
  })

  it('fills in the brightness sliders for settings saved before they existed, and keeps the rest', () => {
    const store = new Map([['mycol.settings.v1', JSON.stringify({ look: { theme: 'CRYO', clean: true }, sound: { enabled: false } })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    const s = loadSettings()
    expect(s.look.theme).toBe('CRYO')
    expect(s.look.clean).toBe(true)
    expect(s.look.brightness).toBe(1)
    expect(s.look.models).toBe(1)
    expect(s.sound.enabled).toBe(false)
    expect(s.sound.master).toBe(DEFAULTS.sound.master)
  })
})
