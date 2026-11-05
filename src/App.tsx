import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './settings/AppContext'
import { THEMES, type ThemeName } from './settings/settings'
import { Crt } from './components/Crt'
import { Shell, type FKey } from './components/Shell'
import { TypeText } from './components/TypeText'
import { Boot } from './screens/Boot'
import { Menu } from './screens/Menu'
import { Tuning } from './screens/Tuning'
import { Pending } from './screens/Pending'
import { Help } from './screens/Help'
import { Login } from './screens/Login'
import { MODULES, STATION } from './data/farm'
import { dbLinked, supabase } from './lib/supabase'

type Stage = 'power' | 'boot' | 'login' | 'shell'
type View = { name: 'menu' } | { name: 'tune' } | { name: 'help' } | { name: 'status' } | { name: 'login' } | { name: 'module'; idx: number }

const TITLES: Record<View['name'], string> = {
  menu: 'MAIN MENU',
  tune: 'TUNING',
  help: 'HELP',
  status: 'SYSTEM STATUS',
  login: 'IDENTIFY',
  module: '',
}

export default function App() {
  const { settings, update, sound, session } = useApp()
  const [stage, setStage] = useState<Stage>('power')
  const [view, setView] = useState<View>({ name: 'menu' })
  const [firstMenu, setFirstMenu] = useState(true)
  const [selected, setSelected] = useState(0)
  const [sweep, setSweep] = useState(0)
  const [alert, setAlert] = useState(false)
  const [reply, setReply] = useState<{ text: string; warn?: boolean; id: number } | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const alertTimer = useRef<number | null>(null)

  // ---------- navigation ----------

  const go = useCallback(
    (v: View) => {
      setView(v)
      setSweep((n) => n + 1)
      setFocusToken((n) => n + 1)
      sound.chirp()
      if (v.name !== 'menu') setFirstMenu(false)
    },
    [sound],
  )

  const say = (text: string, warn?: boolean) => setReply({ text, warn, id: Date.now() })

  const enterShell = useCallback(() => {
    setStage('shell')
    setView({ name: 'menu' })
    // Confirm beep the moment the main menu appears.
    sound.confirm()
  }, [sound])

  const bootDone = useCallback(() => {
    update((s) => ({ ...s, bootSeen: true }))
    if (supabase && !session && navigator.onLine) setStage('login')
    else enterShell()
  }, [update, session, enterShell])

  const replayBoot = useCallback(() => {
    setFirstMenu(true)
    setReply(null)
    setStage('boot')
  }, [])

  const toggleAlarm = useCallback(() => {
    if (alertTimer.current) window.clearTimeout(alertTimer.current)
    setAlert(true)
    sound.alarm(true)
    alertTimer.current = window.setTimeout(() => {
      setAlert(false)
      sound.alarm(false)
    }, 3000)
  }, [sound])
  useEffect(() => () => sound.alarm(false), [sound])

  const cycleTheme = () => {
    const i = THEMES.indexOf(settings.look.theme)
    const next = THEMES[(i + 1) % THEMES.length]
    update((s) => ({ ...s, look: { ...s.look, theme: next } }))
    sound.chirp()
    say(`THEME ${next}`)
  }
  const toggleSound = () => {
    const on = !settings.sound.enabled
    update((s) => ({ ...s, sound: { ...s.sound, enabled: on } }))
    say(on ? 'SOUND ON' : 'SOUND MUTED')
  }
  const toggleClean = () => {
    const on = !settings.look.clean
    update((s) => ({ ...s, look: { ...s.look, clean: on } }))
    say(on ? 'CLEAN MODE ON' : 'CLEAN MODE OFF')
  }
  const logout = async () => {
    if (!supabase) return say('DATABASE NOT LINKED. LOCAL MODE.', true)
    await supabase.auth.signOut()
    say('LOGGED OUT')
  }

  const onKey = (f: number) => {
    switch (f) {
      case 1:
        return go({ name: 'help' })
      case 2:
        return go({ name: 'menu' })
      case 3:
        return go({ name: 'tune' })
      case 4:
        return toggleSound()
      case 5:
        return cycleTheme()
      case 6:
        return toggleClean()
      case 7:
        return replayBoot()
      case 8:
        return session ? void logout() : go({ name: 'login' })
    }
  }

  // F1-F8 on a real keyboard. The browser's own F-key actions are blocked while the terminal is open.
  useEffect(() => {
    if (stage !== 'shell') return
    const h = (e: KeyboardEvent) => {
      const m = /^F([1-8])$/.exec(e.key)
      if (!m) return
      e.preventDefault()
      onKey(Number(m[1]))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  // ---------- commands ----------

  const onCommand = (raw: string) => {
    const [cmd, ...rest] = raw.trim().toUpperCase().split(/\s+/)
    const arg = rest.join(' ')
    const num = Number(cmd)
    if (Number.isInteger(num) && num >= 1 && num <= MODULES.length) {
      setSelected(num - 1)
      return go({ name: 'module', idx: num - 1 })
    }
    const mod = MODULES.findIndex((m) => m.key === cmd || m.name === raw.trim().toUpperCase() || m.name.startsWith(cmd + ' '))
    if (mod >= 0) {
      setSelected(mod)
      return go({ name: 'module', idx: mod })
    }
    switch (cmd) {
      case 'MENU':
      case 'CORE':
        if (cmd === 'CORE') sound.whoosh()
        return go({ name: 'menu' })
      case 'HELP':
      case '?':
        return go({ name: 'help' })
      case 'TUNE':
      case 'TUNING':
      case 'SETTINGS':
        return go({ name: 'tune' })
      case 'STATUS':
        return go({ name: 'status' })
      case 'THEME': {
        if (!arg) return cycleTheme()
        const t = THEMES.find((x) => x.startsWith(arg)) as ThemeName | undefined
        if (!t) return say(`UNKNOWN THEME ${arg}. USE ${THEMES.join(', ')}.`, true)
        update((s) => ({ ...s, look: { ...s.look, theme: t } }))
        sound.chirp()
        return say(`THEME ${t}`)
      }
      case 'PHOSPHOR':
      case 'CRYO':
      case 'SODIUM':
      case 'ALERT':
        update((s) => ({ ...s, look: { ...s.look, theme: cmd as ThemeName } }))
        sound.chirp()
        return say(`THEME ${cmd}`)
      case 'CLEAN':
        return toggleClean()
      case 'MUTE':
      case 'SOUND':
        return toggleSound()
      case 'CHATTER':
      case 'TICK':
        update((s) => ({ ...s, sound: { ...s.sound, mode: cmd } }))
        return say(`SOUND MODE ${cmd}`)
      case 'BOOT':
      case 'REBOOT':
        return replayBoot()
      case 'LOGIN':
        return go({ name: 'login' })
      case 'LOGOUT':
        return void logout()
      case 'ALARM':
        return toggleAlarm()
      default:
        return say(`UNKNOWN COMMAND ${cmd}. TYPE HELP.`, true)
    }
  }

  // ---------- render ----------

  if (stage === 'power') {
    return (
      <Crt powered={false}>
        <div
          className="power"
          role="button"
          tabIndex={0}
          onPointerDown={() => {
            sound.unlock()
            setStage('boot')
          }}
        >
          <div>
            <div className="dot" />
            <div className="heading">{STATION.system}</div>
            <div className="dim" style={{ marginTop: 10 }}>
              TAP OR PRESS ANY KEY TO ENERGISE
            </div>
          </div>
        </div>
        <PowerKeyCatcher onPress={() => (sound.unlock(), setStage('boot'))} />
      </Crt>
    )
  }

  if (stage === 'boot') {
    return (
      <Crt alert={alert}>
        <Boot onDone={bootDone} />
      </Crt>
    )
  }

  const keys: FKey[] = [
    { f: 1, label: 'HELP', active: view.name === 'help' },
    { f: 2, label: 'MENU', active: view.name === 'menu' },
    { f: 3, label: 'TUNE', active: view.name === 'tune' },
    { f: 4, label: settings.sound.enabled ? 'MUTE' : 'SOUND' },
    { f: 5, label: 'THEME' },
    { f: 6, label: settings.look.clean ? 'GLASS' : 'CLEAN' },
    { f: 7, label: 'BOOT' },
    { f: 8, label: session ? 'LOGOUT' : 'LOGIN', active: view.name === 'login' },
  ]

  const hints: Record<View['name'], string> = {
    menu: 'ARROWS + ENTER OR TAP TO OPEN // TYPE A NUMBER OR NAME // F1 HELP',
    tune: 'DRAG A METER OR USE ARROW KEYS ON IT // TEST BUTTONS PLAY EACH LAYER // SAVED ON THIS DEVICE',
    help: 'TYPE A COMMAND AT THE PROMPT',
    status: 'F2 MENU',
    login: 'ACCOUNTS ARE MADE IN THE SUPABASE DASHBOARD',
    module: 'F2 MENU // TYPE ANOTHER MODULE NAME TO JUMP',
  }

  const moduleIndex = (
    <>
      <div className="section-title">INDEX</div>
      <ul className="index-list">
        <li onClick={() => go({ name: 'menu' })}>
          <span>00 CORE</span>
          <span className="k">ONLINE</span>
        </li>
        {MODULES.map((m, i) => (
          <li key={m.key} onClick={() => (setSelected(i), go({ name: 'module', idx: i }))}>
            <span>
              {String(m.num).padStart(2, '0')} {m.key}
            </span>
            <span className="k">B{m.build}</span>
          </li>
        ))}
      </ul>
    </>
  )
  const tuneIndex = (
    <>
      <div className="section-title">SECTIONS</div>
      <ul className="index-list">
        {[
          ['LOOK', 'tune-look'],
          ['SOUND', 'tune-sound'],
        ].map(([label, id]) => (
          <li key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </>
  )

  let title = TITLES[view.name]
  let content: React.ReactNode
  switch (view.name) {
    case 'menu':
      content = <Menu selected={selected} setSelected={setSelected} onOpen={(i) => go({ name: 'module', idx: i })} firstShow={firstMenu} />
      break
    case 'tune':
      content = <Tuning onAlarm={toggleAlarm} onReplayBoot={replayBoot} />
      break
    case 'help':
      content = <Help />
      break
    case 'login':
      content = <Login onDone={() => go({ name: 'menu' })} />
      break
    case 'status':
      content = (
        <div>
          <div className="section-title">SYSTEM STATUS</div>
          <TypeText
            group={3}
            lines={[
              `${STATION.system} BUILD ${STATION.build}`,
              `DATABASE ........ ${!dbLinked ? 'NOT LINKED (LOCAL MODE)' : session ? `LINKED // ${session.user.email?.toUpperCase()}` : 'LINKED // LOCKED'}`,
              `NETWORK ......... ${navigator.onLine ? 'ONLINE' : 'OFFLINE // CACHED SCREENS'}`,
              `OFFLINE CACHE ... ${'serviceWorker' in navigator && navigator.serviceWorker.controller ? 'ACTIVE' : 'NOT YET ACTIVE'}`,
              `THEME ........... ${settings.look.clean ? 'CLEAN' : settings.look.theme}`,
              `SOUND ........... ${settings.sound.enabled ? settings.sound.mode : 'MUTED'}`,
            ]}
          />
        </div>
      )
      break
    case 'module':
      title = MODULES[view.idx].name
      content = <Pending mod={MODULES[view.idx]} />
      break
  }

  const hint = reply ? (
    <TypeText key={reply.id} className={reply.warn ? 'warn' : ''} lines={[reply.text]} />
  ) : (
    hints[view.name]
  )

  return (
    <Crt alert={alert}>
      {stage === 'login' ? (
        <div className="shell" style={{ gridTemplateRows: 'auto minmax(0,1fr)' }}>
          <header className="titlebar">
            <span className="tb-left">{STATION.system} // IDENTIFY</span>
            <span className="tb-right">{STATION.company}</span>
          </header>
          <main className="panel">
            <Login onDone={enterShell} />
          </main>
        </div>
      ) : (
        <>
          <Shell
            title={title}
            index={view.name === 'tune' ? tuneIndex : moduleIndex}
            keys={keys}
            onKey={onKey}
            hint={hint}
            onCommand={(c) => {
              setReply(null)
              onCommand(c)
            }}
            focusToken={focusToken}
            bodyClass={`view-${view.name}`}
          >
            <div key={`${view.name}-${'idx' in view ? view.idx : ''}`}>{content}</div>
          </Shell>
          {sweep > 0 && <div key={sweep} className="sweep" aria-hidden />}
        </>
      )}
    </Crt>
  )
}

/** On the power screen, any key energises the terminal even if nothing has focus. */
function PowerKeyCatcher({ onPress }: { onPress: () => void }) {
  const ref = useRef(onPress)
  ref.current = onPress
  useEffect(() => {
    const h = () => ref.current()
    window.addEventListener('keydown', h, { once: true })
    return () => window.removeEventListener('keydown', h)
  }, [])
  return null
}
