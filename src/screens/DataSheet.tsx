import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useT } from '../settings/useT'
import { useRole } from '../settings/RoleContext'
import { useStore } from '../store/StoreContext'
import { useSheetSync } from '../store/useSheetSync'
import { Confirm } from './CookParts'
import { Box, Buttons, copyText, type Say } from './FacilityParts'
import { checkUrl } from '../lib/sheets/client'
import { SHEET_TABLES } from '../lib/sheets/schema'
import { newKey, scriptWithKey } from '../lib/sheets/state'
import type { SyncNote } from '../lib/sheets/engine'
import { downloadFile } from '../lib/download'

// DATA > GOOGLE SHEET: every record mirrored into one Google Sheet, and edits typed there brought back.
// The sheet holds a small script (sheets/Code.gs) that this screen hands over with this device's key filled in.

const NOTE_LABEL: Record<SyncNote['kind'], string> = {
  conflict: 'BOTH CHANGED',
  refused: 'REFUSED',
  put_back: 'PUT BACK',
  deleted_in_app: 'DELETED IN APP',
  needs: 'WAITING',
  restored_row: 'ROW PUT BACK',
}

const when = (iso: string | null | undefined) => (iso ? `${iso.replace('T', ' ').slice(0, 16)} UTC` : '-')

export function SheetTab({ say }: { say: Say }) {
  const { t, tf } = useT()
  const store = useStore()
  const { role } = useRole()
  const { c, status } = useSheetSync()
  const s = status.settings
  const [url, setUrl] = useState(s.url)
  useEffect(() => setUrl(s.url), [s.url])
  const v = useSyncExternalStore(store.subscribe, store.version)
  useEffect(() => {
    for (const x of SHEET_TABLES) void store.ensure(x.table)
  }, [store])
  const counts = useMemo(() => SHEET_TABLES.map((x) => ({ ...x, n: store.rows(x.table).length })), [store, v]) // eslint-disable-line react-hooks/exhaustive-deps

  if (role !== 'owner') return <Box title={t('GOOGLE SHEET')}><div className="dim">{t('ONLY THE OWNER CAN LINK OR SYNC THE GOOGLE SHEET.')}</div></Box>

  const urlBad = url.trim() ? checkUrl(url) : null
  const linked = !checkUrl(s.url)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      say(ok)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    }
  }
  const saveUrl = () => {
    const bad = checkUrl(url)
    if (bad) return say(t(bad), true)
    c.update({ url })
    void act(async () => say(tf('LINKED TO {s}', { s: await c.test() })), t('SHEET ADDRESS SAVED'))
  }
  const syncNow = () =>
    void act(async () => {
      const r = await c.run(true)
      if (r) say(tf('SYNCED // {a} ADDED, {c} CHANGED, {d} DELETED IN THE APP // {p} ROWS WRITTEN TO THE SHEET', { a: r.added, c: r.changed, d: r.deleted, p: r.pushed + r.removed }))
    }, t('SYNCED'))
  const copy = () => void copyText(scriptWithKey(s.key)).then((ok) => say(ok ? t('SCRIPT COPIED. PASTE IT INTO THE SHEET: EXTENSIONS > APPS SCRIPT.') : t('COPY DID NOT WORK HERE. USE DOWNLOAD SCRIPT.'), !ok))
  const download = () => downloadFile('mycol-sheet-script.gs', scriptWithKey(s.key), 'text/plain')
  const last = status.lastRun
  const notes = status.state?.notes ?? []

  return (
    <div className="lg-stack">
      <Box title={`${t('GOOGLE SHEET')} // ${linked ? (status.linkedTo ?? t('LINKED')) : t('NOT LINKED')}`}>
        <div className="dim tiny">{t('EVERY RECORD IN ONE GOOGLE SHEET, ONE TAB PER RECORD TYPE. EDITS TYPED IN THE SHEET COME BACK INTO THE APP: EACH SYNC IS ONE UNDO STEP, SIGNED GOOGLE SHEET IN HISTORY.')}</div>
        {status.error && <div className="lg-warn">{status.error}</div>}
        {last ? (
          <div>{tf('LAST SYNC {w} // {a} ADDED, {c} CHANGED, {d} DELETED IN THE APP // {p} ROWS WRITTEN, {r} REMOVED IN THE SHEET', { w: when(last.at), a: last.added, c: last.changed, d: last.deleted, p: last.pushed, r: last.removed })}</div>
        ) : (
          <div className="dim">{t('NOT SYNCED YET.')}</div>
        )}
        <div className="lg-btns">
          <button type="button" className="btn on" disabled={!linked || status.running} onClick={syncNow}>{status.running ? t('SYNCING...') : t('SYNC NOW')}</button>
          <button type="button" className="btn" disabled={!linked} onClick={() => void act(async () => say(tf('LINKED TO {s}', { s: await c.test() })), t('LINK WORKS'))}>{t('TEST LINK')}</button>
        </div>
        <div className="ck-field">
          <span>{t('SYNC BY ITSELF')}</span>
          <Buttons<'on' | 'off'> value={s.auto ? 'on' : 'off'} label={t('SYNC BY ITSELF')} onPick={(x) => c.update({ auto: x === 'on' })} options={[{ id: 'on', label: tf('EVERY {m} MINUTES WHILE OPEN', { m: s.everyMin }) }, { id: 'off', label: t('ONLY WHEN I PRESS SYNC NOW') }]} />
        </div>
        <div className="ck-field">
          <span>{t('SENSOR READINGS TAB')}</span>
          <Buttons<'on' | 'off'> value={s.readings ? 'on' : 'off'} label={t('SENSOR READINGS TAB')} onPick={(x) => c.update({ readings: x === 'on' })} options={[{ id: 'off', label: t('OFF') }, { id: 'on', label: t('LAST 14 DAYS') }]} />
        </div>
      </Box>

      <Box title={t('SET UP (ONCE)')}>
        <ol className="dt-steps">
          <li><b>1.</b><span>{t('MAKE A NEW GOOGLE SHEET:')} <a className="btn" href="https://sheets.new" target="_blank" rel="noreferrer">SHEETS.NEW</a></span></li>
          <li><b>2.</b><span>{t('IN THE SHEET: EXTENSIONS > APPS SCRIPT. DELETE WHAT IS THERE, PRESS COPY SCRIPT HERE, PASTE IT IN, PRESS SAVE.')}</span></li>
          <li><b>3.</b><span>{t('DEPLOY > NEW DEPLOYMENT > WEB APP. EXECUTE AS: ME. WHO HAS ACCESS: ANYONE (NOT ANYONE WITH GOOGLE ACCOUNT). PRESS DEPLOY, THEN ALLOW (ADVANCED > GO TO PROJECT IF GOOGLE WARNS YOU: IT IS YOUR OWN SCRIPT).')}</span></li>
          <li><b>4.</b><span>{t('COPY THE WEB APP URL (IT ENDS IN /exec), PASTE IT BELOW AND PRESS SAVE.')}</span></li>
          <li><b>5.</b><span>{t('PRESS SYNC NOW. THE FIRST SYNC MAKES EVERY TAB.')}</span></li>
        </ol>
        <div className="lg-btns">
          <button type="button" className="btn on" onClick={copy}>{t('COPY SCRIPT')}</button>
          <button type="button" className="btn" onClick={download}>{t('DOWNLOAD SCRIPT')}</button>
        </div>
        <label className="ck-field">
          <span>{t('SHEET ADDRESS (WEB APP URL)')}</span>
          <input className="sr-input dt-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://script.google.com/macros/s/.../exec" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUrl() }} />
          
        </label>
        {urlBad && <div className="lg-warn">{t(urlBad)}</div>}
        <div className="lg-btns">
          <button type="button" className="btn on" onClick={saveUrl}>{t('SAVE')}</button>
          <Confirm label={t('MAKE A NEW KEY')} onYes={() => (c.update({ key: newKey() }), say(t('NEW KEY MADE. COPY THE SCRIPT AGAIN AND PASTE IT INTO THE SHEET, THEN DEPLOY A NEW VERSION.')))} />
          <Confirm label={t('START OVER WITH A NEW SHEET')} onYes={() => void act(() => c.forget(), t('SYNC MEMORY CLEARED. THE NEXT SYNC WRITES EVERY RECORD AGAIN.'))} />
        </div>
        <div className="dim tiny">{t('THE ADDRESS AND THE KEY TOGETHER LET ANYONE CHANGE FARM RECORDS. KEEP THEM PRIVATE, AND SHARE THE SHEET ONLY WITH PEOPLE WHO COULD USE THE APP.')}</div>
        <div className="dim tiny">{t('IN LOCAL MODE SYNC FROM ONE DEVICE ONLY: THE ONE THAT HOLDS THE RECORDS.')}</div>
      </Box>

      <Box title={tf('LISTED BY THE SYNC ({n})', { n: notes.length })}>
        {notes.length ? (
          <div className="rc-wrap">
            <table className="lg-table">
              <thead><tr><th>{t('WHEN')}</th><th>{t('WHAT')}</th><th>{t('DETAIL')}</th></tr></thead>
              <tbody>
                {notes.slice(0, 60).map((n, i) => (
                  <tr key={`${n.at}-${i}`}><td>{when(n.at)}</td><td className={n.kind === 'refused' || n.kind === 'deleted_in_app' ? 'warn' : ''}>{t(NOTE_LABEL[n.kind])}</td><td>{n.text}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="dim">{t('NOTHING LISTED. EVERY SHEET EDIT FITTED.')}</div>
        )}
      </Box>

      <Box title={t('WHAT IS WHERE IN THE SHEET')}>
        <div className="rc-wrap">
          <table className="lg-table">
            <thead><tr><th>{t('TAB')}</th><th>{t('GROUP')}</th><th>{t('RECORDS')}</th><th>{t('EDIT?')}</th></tr></thead>
            <tbody>
              {counts.filter((x) => x.table !== 'sensor_readings' || s.readings).map((x) => (
                <tr key={x.table}><td>{x.tab}</td><td>{t(x.group)}</td><td>{x.n.toLocaleString('en-US')}</td><td>{x.readOnly ? t('READ ONLY') : t('YES')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
    </div>
  )
}
