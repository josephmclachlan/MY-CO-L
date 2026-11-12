import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { STATION } from '../data/farm'
import { dbLinked } from '../lib/supabase'
import { farmDay, farmTime } from '../lib/facility'

export interface FKey {
  f: number
  label: string
  active?: boolean
}

interface Props {
  title: string
  /** Where the screen sits on the deck map, shown before the title (each part can be tapped). */
  trail?: ReactNode
  /** Tapping the system name opens the main menu. */
  onHome?: () => void
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
  /** Save/sync lamp for the title bar. */
  lamp?: ReactNode
  /** UNDO button for the status line. */
  undo?: ReactNode
  /** Glove mode badge (tap to switch it off). */
  glove?: ReactNode
  /** The ? TIPS button. */
  tips?: ReactNode
  /** The answer to the last action or command, shown in a bar above the prompt. */
  result?: { text: ReactNode; warn?: boolean; id: number } | null
  /** Closes the result bar. */
  onCloseResult?: () => void
}

const FKEY_TIP: Record<number, string> = {
  1: 'F1: the short list of commands and keys.',
  2: 'F2: the main menu.',
  3: 'F3: look and sound settings.',
  4: 'F4: switch all sound off, or back on.',
  5: 'F5: change the screen colour.',
  6: 'F6: sunlight mode (CLEAN) or the glass look (GLASS).',
  7: 'F7: replay the start-up text.',
  8: 'F8: log in to or out of the database.',
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(t)
  }, [])
  // The farm clock (Costa Rica), the same clock every log uses, whatever time zone the device is set to.
  const ms = now.getTime()
  return `${farmDay(ms).replace(/-/g, '.')} ${farmTime(ms)}`
}

/** The frame every screen shares: title bar, status line, index column, prompt, hint line and F-key bar. */
export function Shell({ title, trail, onHome, index, children, keys, onKey, hint, onCommand, focusToken, bodyClass, onBack, lamp, undo, glove, tips, result, onCloseResult }: Props) {
  const { settings, sound, session } = useApp()
  const { t } = useT()
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

  const db = !dbLinked ? t('LOCAL MODE') : session ? t('DB LINKED') : t('DB LOCKED')

  return (
    <div className="shell">
      <header className="titlebar" data-kbd-zone="top">
        <span className="tb-left">
          {onBack && (
            <button type="button" className="back-btn" onClick={onBack} title={t('Back to where you were (Backspace, Esc or Alt+Left)')}>
              &lt; {t('BACK')}
            </button>
          )}
          {onHome ? (
            <span className="tb-sys">
              <button type="button" className="tb-crumb" onClick={onHome} data-tip={t('The main menu.')}>
                {STATION.system}
              </button>{' '}
              <span className="tb-sep">//</span>{' '}
            </span>
          ) : (
            <span className="tb-sys">{STATION.system} <span className="tb-sep">//</span> </span>
          )}
          {trail}
          <span className="tb-title">{title}</span>
        </span>
        {lamp && <span className="tb-lamp">{lamp}</span>}
        <span className="tb-right">
          {STATION.company} <span className="tb-sep">//</span> {STATION.station}
        </span>
      </header>
      <div className="statusline" data-kbd-zone="status">
        <span>{clock}</span>
        <span>{db}</span>
        <span className={online ? '' : 'warn'}>{t(online ? 'NET OK' : 'NET DOWN // CACHED')}</span>
        <span>{t('SND')} {t(settings.sound.enabled ? settings.sound.mode : 'MUTED')}</span>
        <span>{settings.look.clean ? t('CLEAN') : settings.look.theme}</span>
        {lamp && <span className="sl-lamp">{lamp}</span>}
        {glove}
        {tips}
        {undo}
      </div>
      <div className={`body ${index ? 'has-index' : ''} ${bodyClass ?? ''}`}>
        <main className="panel main-panel" ref={mainRef} data-kbd-zone="main">{children}</main>
        {index && <aside className="panel index-panel" data-kbd-zone="index">{index}</aside>}
      </div>
      {result && (
        <div key={result.id} className={`result-bar ${result.warn ? 'warn' : ''}`} role="status" aria-live="polite">
          <span className="result-sign" aria-hidden>{result.warn ? '!' : '\u25B8'}</span>
          <span className="result-text">{result.text}</span>
          {onCloseResult && (
            <button type="button" className="result-x" data-tip={t('Hide this message.')} aria-label={t('Hide this message.')} onClick={onCloseResult}>
              {'\u2715'}
            </button>
          )}
        </div>
      )}
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
          aria-label={t('Command prompt')}
        />
      </form>
      <div className="hintline">{hint}</div>
      <nav className={`keybar ${more ? 'more-open' : ''}`} aria-label={t('Function keys')} data-kbd-zone="keys">
        {keys.map((k) => (
          <button
            key={k.f}
            type="button"
            data-tip={FKEY_TIP[k.f] ?? ''}
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
        <button type="button" data-tip={t('Show or hide the other four function keys, F5 to F8.')} className={`fkey fkey-more ${more ? 'active' : ''}`} aria-expanded={more} onClick={() => setMore((m) => !m)}>
          <span className="fnum">F5-F8</span>
          <span className="flabel">{t(more ? 'LESS' : 'MORE')}</span>
        </button>
      </nav>
    </div>
  )
}
