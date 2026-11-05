import { useEffect, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { THEMES, type LookSettings, type SoundSettings } from '../settings/settings'
import { Meter } from '../components/Meter'
import { TypeText } from '../components/TypeText'
import { DataColumns } from '../components/DataColumns'

type Test =
  | { kind: 'typing' }
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
  const [test, setTest] = useState<{ t: Test; id: number } | null>(null)
  const run = (t: Test) => setTest({ t, id: Date.now() })

  const setLook = <K extends keyof LookSettings>(k: K, v: LookSettings[K]) =>
    update((s) => ({ ...s, look: { ...s.look, [k]: v } }))
  const setSound = <K extends keyof SoundSettings>(k: K, v: SoundSettings[K]) =>
    update((s) => ({ ...s, sound: { ...s.sound, [k]: v } }))

  // Drone and test visuals stop after a few seconds.
  useEffect(() => {
    if (!test) return
    const ms = test.t.kind === 'drone' ? 3500 : 6000
    const timer = window.setTimeout(() => setTest(null), ms)
    return () => window.clearTimeout(timer)
  }, [test])

  const signal = (text: string, fn: () => void) => {
    fn()
    run({ kind: 'signal', text })
  }

  const disabled = !snd.enabled

  return (
    <div className="tune">
      <div className="section-title">TUNING</div>

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
        <div className="tune-row">
          <span className="lbl">CLEAN MODE</span>
          <button type="button" className={`btn ${look.clean ? 'on' : ''}`} onClick={() => setLook('clean', !look.clean)}>
            {look.clean ? 'ON // SUNLIGHT' : 'OFF'}
          </button>
        </div>
        <Meter label="STRENGTH" value={look.strength} onChange={(v) => setLook('strength', v)} format={pct} disabled={look.clean} />
        <Meter label="GLOW" value={look.glow} onChange={(v) => setLook('glow', v)} format={pct} disabled={look.clean} />
        <Meter label="SCANLINES" value={look.scanlines} onChange={(v) => setLook('scanlines', v)} format={pct} disabled={look.clean} />
        <Meter label="CURVE" value={look.curve} onChange={(v) => setLook('curve', v)} format={pct} disabled={look.clean} />
        <Meter label="FLICKER" value={look.flicker} onChange={(v) => setLook('flicker', v)} format={pct} disabled={look.clean} />
        <Meter label="GRAIN" value={look.noise} onChange={(v) => setLook('noise', v)} format={pct} disabled={look.clean} />
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
        <div className="tune-row">
          <span className="lbl">MODE</span>
          {(['CHATTER', 'TICK'] as const).map((m) => (
            <button key={m} type="button" className={`btn ${snd.mode === m ? 'on' : ''}`} onClick={() => setSound('mode', m)}>
              {m}
            </button>
          ))}
        </div>
        <Meter label="MASTER" value={snd.master} onChange={(v) => setSound('master', v)} format={pct} disabled={disabled} />

        <Meter label="TYPING" value={snd.typing} onChange={(v) => setSound('typing', v)} format={pct} disabled={disabled} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" disabled={disabled} onClick={() => run({ kind: 'typing' })}>
            TEST TYPING
          </button>
        </div>

        <Meter label="DATA CHATTER" value={snd.chatter} onChange={(v) => setSound('chatter', v)} format={pct} disabled={disabled} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" disabled={disabled} onClick={() => run({ kind: 'chatter' })}>
            TEST CHATTER
          </button>
        </div>

        <Meter label="DRONE" value={snd.drone} onChange={(v) => setSound('drone', v)} format={pct} disabled={disabled} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" disabled={disabled} onClick={() => run({ kind: 'drone' })}>
            TEST DRONE
          </button>
        </div>

        <Meter label="ROOM HUM" value={snd.hum} onChange={(v) => setSound('hum', v)} format={pct} disabled={disabled} />

        <Meter label="SIGNALS" value={snd.signals} onChange={(v) => setSound('signals', v)} format={pct} disabled={disabled} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" disabled={disabled} onClick={() => signal('CONFIRMED', () => sound.confirm())}>
            CONFIRM
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => signal('ACCESS GRANTED', () => sound.granted())}>
            GRANTED
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => signal('SCREEN CHANGE', () => sound.chirp())}>
            CHIRP
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => signal('POWER ON', () => sound.swoop())}>
            SWOOP
          </button>
          <button type="button" className="btn" disabled={disabled} onClick={() => signal('ENTERING CORE', () => sound.whoosh())}>
            WHOOSH
          </button>
          <button type="button" className="btn hazard" disabled={disabled} onClick={onAlarm}>
            ALARM
          </button>
        </div>

        <Meter label="WARBLE" value={snd.warble} onChange={(v) => setSound('warble', v)} format={pct} disabled={disabled} />
        <div className="tune-row">
          <span className="lbl" />
          <button type="button" className="btn" disabled={disabled} onClick={() => run({ kind: 'warble' })}>
            TEST WARBLE
          </button>
        </div>

        <div className="tune-row">
          <span className="lbl">GLITCHES</span>
          <button type="button" className={`btn ${snd.glitchOn ? 'on' : ''}`} disabled={disabled} onClick={() => setSound('glitchOn', !snd.glitchOn)}>
            {snd.glitchOn ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={disabled || !snd.glitchOn}
            onClick={() => {
              sound.glitch()
              run({ kind: 'glitch' })
            }}
          >
            TEST GLITCH
          </button>
        </div>
        <Meter label="GLITCH" value={snd.glitch} onChange={(v) => setSound('glitch', v)} format={pct} disabled={disabled || !snd.glitchOn} />

        <div className="tune-row">
          <span className="lbl">AMBIENCE</span>
          <button type="button" className={`btn ${snd.ambienceOn ? 'on' : ''}`} disabled={disabled} onClick={() => setSound('ambienceOn', !snd.ambienceOn)}>
            {snd.ambienceOn ? 'ON' : 'OFF'}
          </button>
          <span className="dim">ROOM RUMBLE AND AIR HISS. BEST ON HEADPHONES OR SPEAKERS.</span>
        </div>
        <Meter label="AMBIENCE" value={snd.ambience} onChange={(v) => setSound('ambience', v)} format={pct} disabled={disabled || !snd.ambienceOn} />

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
      </section>
      <div className="test-out" aria-live="polite">
        <div className="dim">TEST OUTPUT</div>
        {test?.t.kind === 'typing' && (
          <TypeText
            key={test.id}
            lines={['LOT B1104 // 40 BLOCKS // KNOCKED TUE', 'BREAKER S17 // 75X // 1650W // CIRCUIT CLEAR']}
          />
        )}
        {test?.t.kind === 'chatter' && <DataColumns key={test.id} rows={3} cols={4} duration={2000} />}
        {test?.t.kind === 'drone' && <DroneTest key={test.id} />}
        {test?.t.kind === 'warble' && <WarbleTest key={test.id} />}
        {test?.t.kind === 'signal' && <div key={test.id}>{test.t.text}</div>}
        {test?.t.kind === 'glitch' && <div key={test.id}>SIGNAL FAULT // RECOVERED</div>}
      </div>
    </div>
  )
}
