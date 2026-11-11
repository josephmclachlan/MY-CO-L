import { useEffect, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { THEMES, type LookSettings, type SoundSettings } from '../settings/settings'
import { Meter } from '../components/Meter'
import { TypeText } from '../components/TypeText'
import { DataColumns } from '../components/DataColumns'
import { useT } from '../settings/useT'
import { LANGS, LANG_NAME } from '../lib/i18n'

type Test =
  | { kind: 'typing' }
  | { kind: 'readout' }
  | { kind: 'chatter' }
  | { kind: 'drone' }
  | { kind: 'warble' }
  | { kind: 'signal'; text: string }
  | { kind: 'glitch' }

const pct = (v: number) => `${Math.round(v * 100)}`

/** Holds the drone on for as long as the WORKING bar is on screen. */
function DroneTest() {
  const { sound } = useApp()
  useEffect(() => {
    sound.droneOn()
    return () => sound.droneOff()
  }, [sound])
  return (
    <div>
      <span className="processing">WORKING</span>
    </div>
  )
}

function WarbleTest() {
  const { sound } = useApp()
  const [on, setOn] = useState(true)
  useEffect(() => {
    sound.warble(0.7)
    const t = window.setTimeout(() => setOn(false), 700)
    return () => window.clearTimeout(t)
  }, [sound])
  return on ? <span className="processing">PROCESSING</span> : <span className="dim">DONE</span>
}

/**
 * TUNE: every look and sound setting, each sound layer with a TEST button.
 * Each test puts something on screen at the same moment the sound plays.
 */
export function Tuning({ onAlarm, onReplayBoot }: { onAlarm: () => void; onReplayBoot: () => void }) {
  const { settings, update, reset, sound } = useApp()
  const { look, sound: snd } = settings
  const { t: tt } = useT()
  const [test, setTest] = useState<{ t: Test; id: number } | null>(null)
  const run = (t: Test) => setTest({ t, id: Date.now() })
  // Each test shows its output right under the row that started it, so it never sits on top of another control.
  const where = (k: Test['kind']): string => (k === 'readout' ? 'typing' : k)
  const out = (...kinds: Test['kind'][]) => (test && kinds.map(where).includes(where(test.t.kind)) ? <TestOut test={test} /> : null)

  const setLook = <K extends keyof LookSettings>(k: K, v: LookSettings[K]) =>
    update((s) => ({ ...s, look: { ...s.look, [k]: v } }))
  /** A glass slider: moving it while CLEAN MODE is on brings the glass back, so the change shows. */
  const setGlass = (k: 'strength' | 'glow' | 'scanlines' | 'curve' | 'flicker' | 'noise', v: number) =>
    update((s) => ({ ...s, look: { ...s.look, [k]: v, clean: false } }))
  const setSound = <K extends keyof SoundSettings>(k: K, v: SoundSettings[K]) =>
    update((s) => ({ ...s, sound: { ...s.sound, [k]: v } }))
  /** Turn sound back on, in the sound engine too, so a TEST plays in this same tap. */
  const wake = (extra: Partial<SoundSettings> = {}) => {
    if (snd.enabled && Object.entries(extra).every(([k, v]) => snd[k as keyof SoundSettings] === v)) return
    sound.apply({ ...snd, ...extra, enabled: true })
    update((s) => ({ ...s, sound: { ...s.sound, ...extra, enabled: true } }))
  }
  /** A level slider: moving it while muted (or with its layer off) turns the sound back on. */
  const setLevel = (k: 'master' | 'typing' | 'chatter' | 'drone' | 'hum' | 'signals' | 'warble' | 'glitch' | 'ambience', v: number) =>
    update((s) => ({
      ...s,
      sound: { ...s.sound, [k]: v, enabled: true, ...(k === 'glitch' ? { glitchOn: true } : k === 'ambience' ? { ambienceOn: true } : {}) },
    }))
  const runTest = (t: Test) => {
    wake()
    run(t)
  }

  // Drone and test visuals stop after a few seconds.
  useEffect(() => {
    if (!test) return
    const ms = test.t.kind === 'drone' ? 3500 : 6000
    const timer = window.setTimeout(() => setTest(null), ms)
    return () => window.clearTimeout(timer)
  }, [test])

  const signal = (text: string, fn: () => void) => {
    wake()
    fn()
    run({ kind: 'signal', text })
  }

  const muted = !snd.enabled
  const pctOf = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="tune">
      <div className="section-title">{tt('TUNING')}</div>

      <section className="tune-group" id="tune-device">
        <div className="section-title">{tt('LANGUAGE AND GLOVES')}</div>
        <div className="tune-row">
          <span className="lbl">{tt('LANGUAGE')}</span>
          {LANGS.map((l) => (
            <button key={l} type="button" className={`btn ${settings.lang === l ? 'on' : ''}`} aria-pressed={settings.lang === l} onClick={() => (sound.chirp(), update((x) => ({ ...x, lang: l })))}>
              {LANG_NAME[l]}
            </button>
          ))}
        </div>
        <div className="tune-row">
          <span className="lbl">{tt('GLOVE MODE')}</span>
          <button type="button" className={`btn ${settings.glove ? 'on' : ''}`} aria-pressed={settings.glove} onClick={() => (sound.chirp(), update((x) => ({ ...x, glove: !x.glove })))}>
            {tt(settings.glove ? 'ON // BIG BUTTONS + NUMBER PAD' : 'OFF')}
          </button>
        </div>
        <div className="dim tiny">{tt('GLOVE MODE MAKES EVERY BUTTON AND BOX BIGGER AND OPENS A NUMBER PAD WHEN YOU TAP A NUMBER BOX. THESE TWO SETTINGS ARE SAVED ON THIS DEVICE ONLY.')}</div>
      </section>

      <section className="tune-group" id="tune-look">
        <div className="section-title">LOOK</div>
        <div className="tune-row">
          <span className="lbl">THEME</span>
          {THEMES.map((t) => (
            <button key={t} type="button" className={`btn ${look.theme === t ? 'on' : ''}`} onClick={() => (sound.chirp(), setLook('theme', t))}>
              {t}
            </button>
          ))}
        </div>
        <div className="tune-row">
          <span className="lbl">DATA FONT</span>
          {(['SHARE TECH MONO', 'VT323'] as const).map((f) => (
            <button key={f} type="button" className={`btn ${look.dataFont === f ? 'on' : ''}`} onClick={() => setLook('dataFont', f)}>
              {f}
            </button>
          ))}
        </div>
        <Meter label="BRIGHTNESS" value={look.brightness} min={0.6} max={1.5} step={0.05} onChange={(v) => setLook('brightness', v)} format={pctOf} />
        <Meter label="WIREFRAMES" value={look.models} min={0.5} max={2} step={0.05} onChange={(v) => setLook('models', v)} format={pctOf} />
        <div className="dim tiny">BRIGHTNESS LIGHTS OR DIMS THE WHOLE SCREEN. WIREFRAMES BRIGHTENS ONLY THE SPECIES MODELS AND LEAVES THE REST OF THE SCREEN AS IT IS.</div>
        <div className="tune-row">
          <span className="lbl">CLEAN MODE</span>
          <button type="button" className={`btn ${look.clean ? 'on' : ''}`} onClick={() => setLook('clean', !look.clean)}>
            {look.clean ? 'ON // SUNLIGHT' : 'OFF'}
          </button>
        </div>
        {look.clean && <div className="dim tiny tune-why">CLEAN MODE IS ON, SO THE GLASS EFFECTS BELOW ARE OFF. MOVING ANY OF THEM TURNS THE GLASS BACK ON.</div>}
        <Meter label="STRENGTH" value={look.strength} onChange={(v) => setGlass('strength', v)} format={pct} />
        <Meter label="GLOW" value={look.glow} onChange={(v) => setGlass('glow', v)} format={pct} />
        <Meter label="SCANLINES" value={look.scanlines} onChange={(v) => setGlass('scanlines', v)} format={pct} />
        <Meter label="CURVE" value={look.curve} onChange={(v) => setGlass('curve', v)} format={pct} />
        <Meter label="FLICKER" value={look.flicker} onChange={(v) => setGlass('flicker', v)} format={pct} />
        <Meter label="GRAIN" value={look.noise} onChange={(v) => setGlass('noise', v)} format={pct} />
        <Meter
          label="TEXT SIZE"
          value={look.textSize}
          min={0.85}
          max={1.3}
          step={0.05}
          onChange={(v) => setLook('textSize', v)}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Meter
          label="TYPE SPEED"
          value={look.typeSpeed}
          min={6}
          max={24}
          step={1}
          onChange={(v) => setLook('typeSpeed', v)}
          format={(v) => `${v}/S`}
        />
      </section>

      <section className="tune-group" id="tune-sound">
        <div className="section-title">SOUND</div>
        <div className="tune-row">
          <span className="lbl">SOUND</span>
          <button type="button" className={`btn ${snd.enabled ? 'on' : ''}`} onClick={() => setSound('enabled', !snd.enabled)}>
            {snd.enabled ? 'ON' : 'MUTED'}
          </button>
        </div>
        {muted && <div className="dim tiny tune-why">SOUND IS MUTED. MOVING A SLIDER OR PRESSING A TEST BUTTON TURNS IT BACK ON.</div>}
        <div className="tune-row">
          <span className="lbl">MODE</span>
          {(['CHATTER', 'TICK'] as const).map((m) => (
            <button key={m} type="button" className={`btn ${snd.mode === m ? 'on' : ''}`} onClick={() => setSound('mode', m)}>
              {m}
            </button>
          ))}
        </div>
        <Meter label="MASTER" value={snd.master} onChange={(v) => setLevel('master', v)} format={pct} />

        <Meter label="TYPING" value={snd.typing} onChange={(v) => setLevel('typing', v)} format={pct} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" onClick={() => runTest({ kind: 'typing' })}>
            TEST TYPING
          </button>
          <button type="button" className="btn" onClick={() => runTest({ kind: 'readout' })}>
            TEST READOUT
          </button>
        </div>
        {out('typing', 'readout')}
        <div className="tune-row">
          <span className="lbl">TYPING VOICE</span>
          {(['CLACK', 'BLIP'] as const).map((v) => (
            <button key={v} type="button" className={`btn ${snd.typingVoice === v ? 'on' : ''}`} onClick={() => setSound('typingVoice', v)}>
              {v}
            </button>
          ))}
        </div>

        <Meter label="DATA CHATTER" value={snd.chatter} onChange={(v) => setLevel('chatter', v)} format={pct} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" onClick={() => runTest({ kind: 'chatter' })}>
            TEST CHATTER
          </button>
        </div>
        {out('chatter')}

        <Meter label="DRONE" value={snd.drone} onChange={(v) => setLevel('drone', v)} format={pct} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" onClick={() => runTest({ kind: 'drone' })}>
            TEST DRONE
          </button>
        </div>
        {out('drone')}

        <Meter label="ROOM HUM" value={snd.hum} onChange={(v) => setLevel('hum', v)} format={pct} />

        <Meter label="SIGNALS" value={snd.signals} onChange={(v) => setLevel('signals', v)} format={pct} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" onClick={() => signal('CONFIRMED', () => sound.confirm())}>
            CONFIRM
          </button>
          <button type="button" className="btn" onClick={() => signal('ACCESS GRANTED', () => sound.granted())}>
            GRANTED
          </button>
          <button type="button" className="btn" onClick={() => signal('SCREEN CHANGE', () => sound.chirp())}>
            CHIRP
          </button>
          <button type="button" className="btn" onClick={() => signal('POWER ON', () => sound.swoop())}>
            SWOOP
          </button>
          <button type="button" className="btn" onClick={() => signal('ENTERING CORE', () => sound.whoosh())}>
            WHOOSH
          </button>
          <button
            type="button"
            className="btn hazard"
            onClick={() => {
              wake()
              onAlarm()
            }}
          >
            ALARM
          </button>
        </div>
        {test?.t.kind === 'signal' && test.t.text !== 'DEFAULTS RESTORED' && <TestOut test={test} />}

        <Meter label="WARBLE" value={snd.warble} onChange={(v) => setLevel('warble', v)} format={pct} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" onClick={() => runTest({ kind: 'warble' })}>
            TEST WARBLE
          </button>
        </div>
        {out('warble')}

        <div className="tune-row">
          <span className="lbl">GLITCHES</span>
          <button type="button" className={`btn ${snd.glitchOn ? 'on' : ''}`} onClick={() => (snd.glitchOn ? setSound('glitchOn', false) : wake({ glitchOn: true }))}>
            {snd.glitchOn ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              wake({ glitchOn: true })
              sound.glitch()
              run({ kind: 'glitch' })
            }}
          >
            TEST GLITCH
          </button>
        </div>
        {out('glitch')}
        <Meter label="GLITCH" value={snd.glitch} onChange={(v) => setLevel('glitch', v)} format={pct} />

        <div className="tune-row">
          <span className="lbl">AMBIENCE</span>
          <button type="button" className={`btn ${snd.ambienceOn ? 'on' : ''}`} onClick={() => (snd.ambienceOn ? setSound('ambienceOn', false) : wake({ ambienceOn: true }))}>
            {snd.ambienceOn ? 'ON' : 'OFF'}
          </button>
          <span className="dim">ROOM RUMBLE AND AIR HISS. BEST ON HEADPHONES OR SPEAKERS.</span>
        </div>
        <Meter label="AMBIENCE" value={snd.ambience} onChange={(v) => setLevel('ambience', v)} format={pct} />

      </section>

      <section className="tune-group">
        <div className="section-title">SYSTEM</div>
        <div className="tune-row">
          <span className="lbl">BOOT</span>
          <button type="button" className={`btn ${settings.fullBoot ? 'on' : ''}`} onClick={() => update((s) => ({ ...s, fullBoot: !s.fullBoot }))}>
            {settings.fullBoot ? 'ALWAYS FULL' : 'SKIPPABLE'}
          </button>
          <button type="button" className="btn" onClick={onReplayBoot}>
            REPLAY BOOT
          </button>
        </div>
        <div className="tune-row">
          <span className="lbl">DEFAULTS</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              reset()
              sound.granted()
              run({ kind: 'signal', text: 'DEFAULTS RESTORED' })
            }}
          >
            RESET ALL
          </button>
        </div>
        {test?.t.kind === 'signal' && test.t.text === 'DEFAULTS RESTORED' && <TestOut test={test} />}
      </section>
    </div>
  )
}

/** What a TEST button shows, under its own row. */
function TestOut({ test }: { test: { t: Test; id: number } }) {
  return (
    <div className="test-out" aria-live="polite">
      <div className="dim">TEST OUTPUT</div>
      {test.t.kind === 'typing' && (
        <TypeText
          key={test.id}
          lines={['LOT B1104 // 40 BLOCKS // KNOCKED TUE', 'BREAKER S17 // 75X // 1650W // CIRCUIT CLEAR']}
        />
      )}
      {test.t.kind === 'readout' && (
        <TypeText
          key={test.id}
          group={5}
          speed={20}
          lines={['S13 MEGACHEF 1 ..... 1200W', 'S14 MEGACHEF 2 ..... 1200W', 'S15 MEGACHEF 3 ..... 1200W', 'S16 MEGACHEF 4 ..... 1200W', 'S17 75X ............ 1650W']}
        />
      )}
      {test.t.kind === 'chatter' && <DataColumns key={test.id} rows={3} cols={4} duration={2000} />}
      {test.t.kind === 'drone' && <DroneTest key={test.id} />}
      {test.t.kind === 'warble' && <WarbleTest key={test.id} />}
      {test.t.kind === 'signal' && <div key={test.id}>{test.t.text}</div>}
      {test.t.kind === 'glitch' && <div key={test.id}>SIGNAL FAULT // RECOVERED</div>}
    </div>
  )
}
