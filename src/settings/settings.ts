// Every adjustable look and sound value lives here, with its default.
// Settings are saved on this device (localStorage), so phone and laptop can be
// tuned differently: a phone speaker wants different levels than a laptop.

export type ThemeName = 'PHOSPHOR' | 'CRYO' | 'SODIUM' | 'ALERT' | 'SPORE'
export const THEMES: ThemeName[] = ['PHOSPHOR', 'CRYO', 'SODIUM', 'ALERT', 'SPORE']

export type DataFont = 'SHARE TECH MONO' | 'VT323'
export type SoundMode = 'CHATTER' | 'TICK'
export type TypingVoice = 'CLACK' | 'BLIP'

export interface LookSettings {
  theme: ThemeName
  dataFont: DataFont
  clean: boolean // sunlight mode: no glow, no scanlines, no curve, no flicker
  strength: number // 0..1 master for every screen effect
  glow: number // 0..1
  scanlines: number // 0..1
  curve: number // 0..1
  flicker: number // 0..1
  noise: number // 0..1 grain and faint streaks
  textSize: number // 0.85..1.3 multiplier
  typeSpeed: number // characters per second for normal output
}

export interface SoundSettings {
  enabled: boolean
  mode: SoundMode
  typingVoice: TypingVoice // CLACK = keyboard, typewriter and printer; BLIP = electronic
  master: number // 0..1
  typing: number // blip per character
  chatter: number // data bursts locked to data animations
  drone: number // two-tone drone while a screen is working
  hum: number // quiet always-on room hum
  signals: number // confirm beep, chirps, swoop, whoosh, alarm
  warble: number // processing warble
  glitch: number // rare dropouts and crackle, only while text prints
  ambience: number // optional room rumble and air hiss
  ambienceOn: boolean // off by default (phone speakers)
  glitchOn: boolean
}

export interface Settings {
  look: LookSettings
  sound: SoundSettings
  /** Screen language for this device. */
  lang: 'EN' | 'ES'
  /** Glove mode: big buttons and the number pad. */
  glove: boolean
  bootSeen: boolean // after the first full boot, the boot can be skipped
  fullBoot: boolean // always play the whole boot sequence
}

export const DEFAULTS: Settings = {
  look: {
    theme: 'PHOSPHOR',
    dataFont: 'SHARE TECH MONO',
    clean: false,
    strength: 0.7,
    glow: 0.6,
    scanlines: 0.5,
    curve: 0.5,
    flicker: 0.25,
    noise: 0.3,
    textSize: 1,
    typeSpeed: 14,
  },
  sound: {
    enabled: true,
    mode: 'CHATTER',
    typingVoice: 'CLACK',
    master: 0.5,
    typing: 0.55,
    chatter: 0.45,
    drone: 0.35,
    hum: 0.3,
    signals: 0.55,
    warble: 0.4,
    glitch: 0.35,
    ambience: 0.4,
    ambienceOn: false,
    glitchOn: true,
  },
  lang: 'EN',
  glove: false,
  bootSeen: false,
  fullBoot: false,
}

const KEY = 'mycol.settings.v1'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULTS)
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      ...DEFAULTS,
      ...saved,
      lang: saved.lang === 'ES' ? 'ES' : 'EN',
      glove: saved.glove === true,
      look: { ...DEFAULTS.look, ...(saved.look ?? {}) },
      sound: { ...DEFAULTS.sound, ...(saved.sound ?? {}) },
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private windows can block storage. The app still works; it just forgets.
  }
}
