import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../settings/AppContext'
import { STATION } from '../data/farm'
import { dbLinked } from '../lib/supabase'

export interface FKey {
  f: number
  label: string
  active?: boolean
}

interface Props {
  title: string
  index?: ReactNode
  children: ReactNode
  keys: FKey[]
  onKey: (f: number) => void
  hint: ReactNode
  onCommand: (cmd: string) => void
  /** Increment to pull focus back to the prompt. */
  focusToken?: number
  /** Extra class on the body, e.g. view-menu. */
  bodyClass?: string
  /** Present when there is somewhere to go back to. */
  onBack?: () => void
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(t)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}.${p(now.getMonth() + 1)}.${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}

/** The frame every screen shares: title bar, status line, index column, prompt, hint line and F-key bar. */
export function Shell({ title, index, children, keys, onKey, hint, onCommand, focusToken, bodyClass, onBack }: Props) {
  const { settings, sound, session } = useApp()
  const clock = useClock()
  const [cmd, setCmd] = useState('')
  // Phones show F1-F4 and a MORE key; MORE opens F5-F8 underneath.
  const [more, setMore] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    // Each new screen starts at the top.
    mainRef.current?.scrollTo({ top: 0 })
    // Don't pop the phone keyboard up on every screen change.
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true })
  }, [focusToken])

  const db = !dbLinked ? 'LOCAL MODE' : session ? 'DB LINKED' : 'DB LOCKED'

  return (
    <div className="shell">
      <header className="titlebar" data-kbd-zone="top">
        <span className="tb-left">
          {onBack && (
            <button type="button" className="back-btn" onClick={onBack} title="Back to where you were (Backspace, Esc or Alt+Left)">
              &lt; BACK
            </button>
          )}
          <span className="tb-sys">{STATION.system} <span className="tb-sep">//</span> </span>{title}
        </span>
        <span className="tb-right">
          {STATION.company} <span className="tb-sep">//</span> {STATION.station}
        </span>
      </header>
      <div className="statusline">
        <span>{clock}</span>
        <span>{db}</span>
        <span className={online ? '' : 'warn'}>{online ? 'NET OK' : 'NET DOWN // CACHED'}</span>
        <span>SND {settings.sound.enabled ? settings.sound.mode : 'MUTED'}</span>
        <span>{settings.look.clean ? 'CLEAN' : settings.look.theme}</span>
      </div>
      <div className={`body ${index ? 'has-index' : ''} ${bodyClass ?? ''}`}>
        <main className="panel main-panel" ref={mainRef} data-kbd-zone="main">{children}</main>
        {index && <aside className="panel index-panel" data-kbd-zone="index">{index}</aside>}
      </div>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault()
          const c = cmd.trim()
          setCmd('')
          if (c) onCommand(c)
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="prompt-sign">&gt;</span>
        <span className="prompt-text">
          {cmd}
          <span className="cursor blink" aria-hidden />
        </span>
        <input
          ref={inputRef}
          value={cmd}
          onChange={(e) => {
            const v = e.target.value.toUpperCase()
            // A keyclick for each character that appears at the prompt.
            if (v.length > cmd.length) sound.typeChar(v[v.length - 1], 99, v.length - 1)
            setCmd(v)
          }}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-label="Command prompt"
        />
      </form>
      <div className="hintline">{hint}</div>
      <nav className={`keybar ${more ? 'more-open' : ''}`} aria-label="Function keys" data-kbd-zone="keys">
        {keys.map((k) => (
          <button
            key={k.f}
            type="button"
            className={`fkey ${k.f > 4 ? 'fkey-extra' : ''} ${k.active ? 'active' : ''}`}
            onClick={() => {
              setMore(false)
              onKey(k.f)
            }}
          >
            <span className="fnum">F{k.f}</span>
            <span className="flabel">{k.label}</span>
          </button>
        ))}
        <button type="button" className={`fkey fkey-more ${more ? 'active' : ''}`} aria-expanded={more} onClick={() => setMore((m) => !m)}>
          <span className="fnum">F5-F8</span>
          <span className="flabel">{more ? 'LESS' : 'MORE'}</span>
        </button>
      </nav>
    </div>
  )
}
