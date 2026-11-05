import { useState } from 'react'
import { useApp } from '../settings/AppContext'
import { supabase } from '../lib/supabase'
import { TypeText } from '../components/TypeText'

/**
 * Database login (email and passcode). Accounts are made by Joseph in the
 * Supabase dashboard; public sign-up stays switched off, so nobody else can
 * create one.
 */
export function Login({ onDone }: { onDone: () => void }) {
  const { sound } = useApp()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!supabase) {
    return (
      <div>
        <div className="section-title">LOGIN</div>
        <TypeText lines={['DATABASE NOT LINKED. RUNNING IN LOCAL MODE.', 'SEE docs/SETUP.md TO LINK SUPABASE.']} />
      </div>
    )
  }

  const submit = async () => {
    if (!email || !pass || busy) return
    setBusy(true)
    sound.warble(0.7)
    setMsg({ text: 'PROCESSING' })
    const { error } = await supabase!.auth.signInWithPassword({ email, password: pass })
    setBusy(false)
    if (error) {
      setMsg({ text: `ACCESS DENIED // ${error.message.toUpperCase()}`, warn: true })
      return
    }
    sound.granted()
    sound.whoosh()
    setMsg({ text: 'ACCESS GRANTED' })
    window.setTimeout(onDone, 900)
  }

  const typeClick = (prev: string, next: string) => {
    if (next.length > prev.length) sound.typeChar('x', 98, next.length - 1)
  }

  return (
    <div>
      <div className="section-title">IDENTIFY</div>
      <TypeText group={2} lines={['DATABASE ACCESS RESTRICTED.', 'ENTER CREW EMAIL AND PASSCODE.']} />
      <form
        className="login"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label className="login-row">
          <span className="dim">IDENT &gt;</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => (typeClick(email, e.target.value), setEmail(e.target.value))}
            autoFocus
          />
        </label>
        <label className="login-row">
          <span className="dim">PASSCODE &gt;</span>
          <input
            type="password"
            autoComplete="current-password"
            value={pass}
            onChange={(e) => (typeClick(pass, e.target.value), setPass(e.target.value))}
          />
        </label>
        <div className="tune-row">
          <button className="btn" type="submit" disabled={busy}>
            ENTER
          </button>
          <button className="btn" type="button" onClick={onDone}>
            CONTINUE OFFLINE
          </button>
        </div>
      </form>
      {msg && <div className={msg.text === 'PROCESSING' ? 'processing' : msg.warn ? 'warn' : ''}>{msg.text}</div>}
    </div>
  )
}
