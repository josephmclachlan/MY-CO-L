import { useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { useRole } from '../settings/RoleContext'
import { Confirm, Guess } from './CookParts'
import { Box, copyText, type Say } from './FacilityParts'
import { MODULES } from '../data/farm'
import { OWNER_ONLY_MODULES, PIN_MAX, PIN_MIN, STAFF_MODULES, validPin } from '../lib/roles'
import { dbLinked } from '../lib/supabase'

// STAFF (build G9): who is using this screen, and what they may do.
// OWNER sees everything. STAFF logs the work and never sees money.

export const STAFF_GUESSES = [
  'Two roles only: OWNER (everything) and STAFF (logs harvests and farm work, sees no money). More roles can be added when there is a real need.',
  'STAFF can open: specimen files, vitals, deck plan, stock (without prices), genetics, hazard index, cook log (without costs), production sequence, mission control (harvests, bulk, scan), production records, facility logs, climate, search. Owner only: ledger, trade, standing orders, money, history, data, manual.',
  'Staff read every money table as empty and cannot write it. In the database (migration 0016) the same rule is enforced by the server, so changing the app does not get around it.',
  'In local mode (no Supabase account) the lock is a convenience: it keeps a helper out of the money screens, but the data sits in this browser and anyone who knows how can get at it. The PIN is 4 to 12 digits, kept scrambled (not readable), five wrong tries wait 30 seconds.',
  'Staff screens and prompts can be set to Spanish on TUNE (or type ESPAÑOL). The Spanish was written by Claude: have a native speaker on the farm read it.',
  'History for staff: their own writes are logged with the login e-mail (linked) or the name set on HISTORY (local), but staff cannot open the history screen.',
]

const SQL_STAFF = `-- Run once in Supabase > SQL Editor, after migration 0016.
-- 1. Make the login in Authentication > Users (e-mail + passcode).
-- 2. Then run this with that e-mail:
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"staff"}'::jsonb
 where email = 'helper@example.com';
insert into public.staff_members (user_id)
select id from auth.users where email = 'helper@example.com'
on conflict do nothing;`

export function StaffIndex() {
  const { t } = useT()
  const r = useRole()
  return (
    <>
      <div className="section-title">{t('STAFF')}</div>
      <div className="lg-mini">
        <div>{t('YOU ARE')}: <b>{r.role === 'owner' ? t('OWNER') : t('STAFF')}</b></div>
        <div>{r.source === 'login' ? t('ROLE FROM THE LOGIN') : t('ROLE FROM THIS DEVICE')}</div>
      </div>
    </>
  )
}

export function Staff({ say }: { say: Say }) {
  const { t, tf } = useT()
  const { sound, session } = useApp()
  const r = useRole()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [tryPin, setTryPin] = useState('')
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null)
  const name = (k: string) => MODULES.find((m) => m.key === k)?.name ?? k
  const staffNames = STAFF_MODULES.filter((k) => k !== 'STAFF').map(name)
  const ownerNames = OWNER_ONLY_MODULES.map(name)

  const savePin = async () => {
    if (!validPin(pin)) return say(tf('THE PIN IS {a} TO {b} DIGITS.', { a: PIN_MIN, b: PIN_MAX }), true)
    if (pin !== pin2) return say(t('THE TWO PINS DO NOT MATCH.'), true)
    try {
      await r.setPin(pin)
      setPin('')
      setPin2('')
      sound.confirm()
      say(t('OWNER PIN SAVED ON THIS DEVICE'))
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const lock = () => {
    try {
      r.lockStaff()
      sound.confirm()
      say(t('THIS DEVICE IS NOW LOCKED TO STAFF'))
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const unlock = async () => {
    const res = await r.unlock(tryPin)
    setTryPin('')
    if (res.ok) {
      sound.granted()
      setMsg({ text: t('OWNER ACCESS RESTORED') })
      say(t('OWNER ACCESS RESTORED'))
    } else if (res.wait) setMsg({ text: tf('TOO MANY WRONG TRIES. WAIT {s} SECONDS.', { s: res.wait }), warn: true })
    else setMsg({ text: res.left ? tf('WRONG PIN. {n} TRIES LEFT.', { n: res.left }) : t('WRONG PIN.'), warn: true })
  }

  return (
    <div className="cook ledger od mn fc st">
      <Box title={t('WHO IS USING THIS SCREEN')}>
        <div className="at-vals-row">
          <span>{t('ROLE')}: <b>{r.role === 'owner' ? t('OWNER') : t('STAFF')}</b></span>
          <span className="dim"> // {r.source === 'login' ? `${t('FROM THE LOGIN')}${session?.user.email ? ` ${session.user.email.toUpperCase()}` : ''}` : t('FROM THE LOCK ON THIS DEVICE')}</span>
        </div>
        {r.role === 'staff' ? (
          <div className="lg-warn">{t('STAFF: YOU CAN LOG THE FARM WORK. MONEY SCREENS, EXPORT AND HISTORY ARE FOR THE OWNER.')}</div>
        ) : (
          <div className="dim">{t('OWNER: EVERY SCREEN, EVERY RECORD.')}</div>
        )}
      </Box>

      {r.source === 'device' && r.role === 'staff' && (
        <Box title={t('OWNER: UNLOCK THIS DEVICE')}>
          <label className="ck-field">
            <span>{t('OWNER PIN')}</span>
            <input className="sr-input" type="password" inputMode="numeric" autoComplete="off" aria-label={t('Owner PIN')} value={tryPin} maxLength={PIN_MAX} onChange={(e) => setTryPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void unlock() }} />
          </label>
          <button type="button" className="btn on" disabled={!tryPin} onClick={() => void unlock()}>{t('UNLOCK')}</button>
          {msg && <div className={msg.warn ? 'warn' : ''}>{msg.text}</div>}
        </Box>
      )}

      {r.source === 'device' && r.role === 'owner' && (
        <>
          <Box title={t('LOCK THIS DEVICE FOR STAFF')}>
            <div className="lg-warn">{t('THIS LOCK ONLY HIDES THE MONEY SCREENS ON THIS PHONE. IT IS NOT A SAFE: THE DATA STILL SITS IN THIS BROWSER. A REAL LOCK NEEDS THE DATABASE LOGIN.')}</div>
            <div className="dim tiny">{t('1. SET AN OWNER PIN. 2. LOCK. TO GET OWNER ACCESS BACK, OPEN THE STAFF SCREEN AND TYPE THE PIN.')}</div>
            <div className="ck-fields">
              <label className="ck-field">
                <span>{r.hasPin ? t('NEW OWNER PIN') : t('OWNER PIN')} ({PIN_MIN}-{PIN_MAX} {t('DIGITS')})</span>
                <input className="sr-input" type="password" inputMode="numeric" autoComplete="off" aria-label={t('Owner PIN')} value={pin} maxLength={PIN_MAX} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="ck-field">
                <span>{t('TYPE IT AGAIN')}</span>
                <input className="sr-input" type="password" inputMode="numeric" autoComplete="off" aria-label={t('Owner PIN again')} value={pin2} maxLength={PIN_MAX} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
              </label>
            </div>
            <div className="lg-btns">
              <button type="button" className="btn" disabled={!pin} onClick={() => void savePin()}>{r.hasPin ? t('CHANGE PIN') : t('SAVE PIN')}</button>
              <Confirm label={t('LOCK THIS DEVICE TO STAFF')} disabled={!r.hasPin} onYes={lock} />
            </div>
            {!r.hasPin && <div className="dim tiny">{t('SAVE A PIN FIRST: WITHOUT ONE NOBODY COULD UNLOCK THE DEVICE.')}</div>}
          </Box>
        </>
      )}

      {r.source === 'login' && r.role === 'owner' && dbLinked && (
        <Box title={t('ADD A STAFF LOGIN')}>
          <div className="dim tiny">{t('MAKE THE LOGIN ON THE SUPABASE DASHBOARD, THEN RUN THIS ONCE. THE ROLE IS KEPT BY THE DATABASE, NOT BY THIS APP.')}</div>
          <pre className="st-sql">{SQL_STAFF}</pre>
          <button type="button" className="btn" onClick={() => void copyText(SQL_STAFF).then((ok) => say(ok ? t('SQL COPIED') : t('COULD NOT COPY'), !ok))}>{t('COPY THE SQL')}</button>
        </Box>
      )}

      <Box title={t('WHAT EACH ROLE CAN OPEN')}>
        <div className="st-roles">
          <div><b>{t('STAFF')}</b><div className="dim">{staffNames.join(', ')}</div><div className="dim tiny">{t('NO PRICES, COSTS, SALES OR OWED MONEY ANYWHERE.')}</div></div>
          <div><b>{t('OWNER ONLY')}</b><div className="dim">{ownerNames.join(', ')}</div></div>
        </div>
      </Box>

      <div className="ck-box">
        <div className="section-title">{t('BEST GUESSES WAITING FOR JOSEPH')} <Guess /></div>
        <ul className="ck-guesses">{STAFF_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
      </div>
    </div>
  )
}
