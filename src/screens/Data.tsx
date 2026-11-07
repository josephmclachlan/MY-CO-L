import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { useStore } from '../store/StoreContext'
import { Select } from '../components/Select'
import { Confirm, Guess } from './CookParts'
import { Box, Buttons, useRun, type Say } from './FacilityParts'
import { EXPORT_TABLES, backupNag, buildExportZip, markBackup, readBackupFile, stamp, tableCsv, BACKUP_STALE_DAYS, type ExportSummary } from '../lib/dataExport'
import { canShareFile, downloadFile, shareFile } from '../lib/download'
import { tableName } from '../lib/history'
import type { BackupPreview } from '../lib/store'
import { SheetTab } from './DataSheet'

// DATA (build G9): export everything, back up, restore.
// Local mode keeps every record in this one browser, so a backup file is the only copy that survives a lost phone.

export type DataTab = 'BACKUP' | 'EXPORT' | 'RESTORE' | 'SHEET' | 'GUESSES'
export const DATA_TABS: DataTab[] = ['BACKUP', 'EXPORT', 'RESTORE', 'SHEET', 'GUESSES']
export interface DataState {
  tab: DataTab
}
export const DATA_START: DataState = { tab: 'BACKUP' }
type SetData = (p: Partial<DataState>) => void

export const DATA_GUESSES = [
  'A backup older than 7 days is called stale on the main menu and on this screen. Seven days is a working number, not Joseph\'s.',
  'RESTORE ADDS AND CHANGES records by their id. The exact copy mode also removes records that are not in the file. The edit history is never removed.',
  'The ZIP holds backup.json (restorable), one CSV per table and a README. sensor_readings is in the CSV folder but not in backup.json: it grows without limit.',
  'CSV dates are yyyy-mm-dd and times are UTC (the farm clock is UTC-6). Money is in colones as stored.',
  'GOOGLE SHEET: syncs every 5 minutes while the app is open, plus SYNC NOW. A full check of every row runs at least once an hour.',
  'GOOGLE SHEET: when the same field was changed in the app and in the sheet, the later change wins and is listed. A record deleted in the app stays deleted even if the sheet edited it (HISTORY > RESTORE brings it back).',
  'GOOGLE SHEET: deleting a whole row in the sheet does not delete the record; the app puts the row back. Type DELETE in the _action cell instead.',
  'GOOGLE SHEET: exchange rates, the edit history and sensor readings are read-only tabs. Sensor readings are off by default (last 14 days when on); the edit history shows the newest 5,000 lines.',
  'The save-to-phone button uses the phone\'s share sheet where the browser has one (iPhone Safari and Android Chrome do): send the ZIP to Drive, WhatsApp or e-mail. Desktop browsers just download the file.',
]

const TAB_LABEL: Record<DataTab, string> = { BACKUP: 'BACK UP', EXPORT: 'EXPORT SPREADSHEETS', RESTORE: 'RESTORE', SHEET: 'GOOGLE SHEET', GUESSES: 'GUESSES' }

export function DataIndex({ x, set }: { x: DataState; set: SetData }) {
  const { sound } = useApp()
  const { t, tf } = useT()
  const nag = useNag()
  return (
    <>
      <div className="section-title">{t('DATA')}</div>
      <ul className="index-list">
        {DATA_TABS.map((k) => (
          <li tabIndex={0} key={k} className={x.tab === k ? 'sel' : ''} onClick={() => (sound.chirp(), set({ tab: k }))}>
            <span>{t(TAB_LABEL[k])}</span>
          </li>
        ))}
      </ul>
      <div className="section-title" style={{ marginTop: 10 }}>{t('LAST BACKUP')}</div>
      <div className="lg-mini"><div className={nag.warn ? 'warn' : ''}>{tf(nag.key, nag.vars)}</div></div>
    </>
  )
}

/** The backup reminder text, refreshed when a backup is made. */
let nagVer = 0
const nagSubs = new Set<() => void>()
const bumpNag = () => {
  nagVer++
  for (const f of nagSubs) f()
}
export function useNag() {
  useSyncExternalStore((f) => (nagSubs.add(f), () => void nagSubs.delete(f)), () => nagVer)
  return backupNag()
}

export function Data({ x, set, say }: { x: DataState; set: SetData; say: Say }) {
  const { sound } = useApp()
  const { t } = useT()
  return (
    <div className="cook ledger od mn fc dt">
      <label className="ck-picker">
        <span>{t('SHOW')} ({DATA_TABS.length})</span>
        <Select value={x.tab} onChange={(e) => (sound.chirp(), set({ tab: e.target.value as DataTab }))}>
          {DATA_TABS.map((k) => <option key={k} value={k}>{t(TAB_LABEL[k])}</option>)}
        </Select>
      </label>
      {x.tab === 'BACKUP' && <BackupTab say={say} />}
      {x.tab === 'EXPORT' && <ExportTab say={say} />}
      {x.tab === 'RESTORE' && <RestoreTab say={say} />}
      {x.tab === 'SHEET' && <SheetTab say={say} />}
      {x.tab === 'GUESSES' && (
        <div className="ck-box">
          <div className="section-title">{t('BEST GUESSES WAITING FOR JOSEPH')} <Guess /></div>
          <ul className="ck-guesses">{DATA_GUESSES.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function useCounts() {
  const store = useStore()
  const v = useSyncExternalStore(store.subscribe, store.version)
  useEffect(() => {
    for (const t of EXPORT_TABLES) void store.ensure(t)
  }, [store])
  return useMemo(() => EXPORT_TABLES.map((t) => ({ table: t, rows: store.rows(t).length })).filter((c) => c.rows > 0), [store, v]) // eslint-disable-line react-hooks/exhaustive-deps
}

const CountTable = ({ counts }: { counts: { table: string; rows: number }[] }) => {
  const { t } = useT()
  return (
    <div className="rc-wrap">
      <table className="lg-table">
        <thead><tr><th>{t('TABLE')}</th><th>{t('RECORDS')}</th></tr></thead>
        <tbody>{counts.map((c) => <tr key={c.table}><td>{tableName(c.table, 2)}</td><td>{c.rows.toLocaleString('en-US')}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function BackupTab({ say }: { say: Say }) {
  const { t, tf } = useT()
  const store = useStore()
  const nag = useNag()
  const counts = useCounts()
  const total = counts.reduce((n, c) => n + c.rows, 0)
  const run = useRun(say)
  const [sum, setSum] = useState<ExportSummary | null>(null)
  const zipName = `mycol-export-${stamp()}.zip`
  const jsonName = `mycol-backup-${stamp()}.json`
  const canShare = useMemo(() => canShareFile(zipName, 'application/zip'), [zipName])

  const saveZip = () =>
    void run(t('EXPORT SAVED'), async () => {
      const { zip, summary } = await buildExportZip(store)
      downloadFile(zipName, zip, 'application/zip')
      markBackup()
      bumpNag()
      setSum(summary)
    })
  const saveJson = () =>
    void run(t('BACKUP FILE SAVED'), async () => {
      downloadFile(jsonName, await store.exportJson(), 'application/json')
      markBackup()
      bumpNag()
    })
  const shareZip = () =>
    void run(t('SHARED'), async () => {
      const { zip, summary } = await buildExportZip(store)
      if (await shareFile(zipName, zip, 'application/zip')) {
        markBackup()
        bumpNag()
        setSum(summary)
      }
    })

  return (
    <div className="lg-stack">
      <Box title={t('BACK UP EVERYTHING')}>
        <div className={nag.warn ? 'lg-warn' : 'dim'}>{tf(nag.key, nag.vars)}{nag.warn ? ` // ${tf('BACK UP AT LEAST EVERY {d} DAYS', { d: BACKUP_STALE_DAYS })}` : ''}</div>
        <div className="dim tiny">{store.backend.kind === 'local' ? t('EVERY RECORD LIVES IN THIS ONE BROWSER. IF THIS PHONE IS LOST OR ITS BROWSER DATA IS CLEARED, A BACKUP FILE IS THE ONLY COPY.') : t('THE DATABASE KEEPS THE RECORDS. A BACKUP FILE IS A SECOND COPY YOU HOLD.')}</div>
        <div className="lg-btns">
          <button type="button" className="btn on lg-save" onClick={saveZip}>{t('SAVE EVERYTHING (ZIP)')}</button>
          {canShare && <button type="button" className="btn" onClick={shareZip}>{t('SEND TO... (SHARE)')}</button>}
          <button type="button" className="btn" onClick={saveJson}>{t('BACKUP FILE ONLY (.JSON)')}</button>
        </div>
        <div className="dim tiny">{t('THE ZIP HOLDS THE BACKUP FILE, ONE SPREADSHEET PER TABLE AND A README. RESTORE TAKES THE ZIP OR THE .JSON.')}</div>
        {sum && <div>{tf('ZIP SAVED // {f} FILES INSIDE // {r} RECORDS // {k} KB', { f: sum.files, r: sum.rows.toLocaleString('en-US'), k: Math.max(1, Math.round(sum.bytes / 1024)) })}</div>}
      </Box>
      <Box title={`${t('WHAT IS IN THE BACKUP')} // ${total.toLocaleString('en-US')} ${t('RECORDS')}`}>
        {counts.length ? <CountTable counts={counts} /> : <div className="dim">{t('NOTHING SAVED YET.')}</div>}
      </Box>
    </div>
  )
}

function ExportTab({ say }: { say: Say }) {
  const { t, tf } = useT()
  const store = useStore()
  const counts = useCounts()
  const run = useRun(say)
  const [table, setTable] = useState('harvests')
  const pick = counts.find((c) => c.table === table) ?? counts[0]
  const saveCsv = () =>
    pick &&
    void run(tf('{t} CSV SAVED', { t: tableName(pick.table, 2) }), async () => {
      const { csv } = await tableCsv(store, pick.table)
      downloadFile(`mycol-${pick.table}-${stamp()}.csv`, csv, 'text/csv')
    })
  return (
    <div className="lg-stack">
      <Box title={t('ONE TABLE AS A SPREADSHEET (CSV)')}>
        {!counts.length ? (
          <div className="dim">{t('NOTHING SAVED YET.')}</div>
        ) : (
          <>
            <label className="ck-field">
              <span>{t('TABLE')}</span>
              <Select value={pick?.table ?? ''} onChange={(e) => setTable(e.target.value)}>
                {counts.map((c) => <option key={c.table} value={c.table}>{tableName(c.table, 2)} ({c.rows.toLocaleString('en-US')})</option>)}
              </Select>
            </label>
            <button type="button" className="btn on" onClick={saveCsv}>{t('DOWNLOAD CSV')}</button>
            <div className="dim tiny">{t('OPENS IN EXCEL, GOOGLE SHEETS OR NUMBERS. A CODE OR NAME COLUMN IS ADDED AT THE END WHERE A TABLE ONLY HOLDS LONG IDS.')}</div>
          </>
        )}
      </Box>
      <Box title={t('EVERY TABLE')}>
        <div className="dim tiny">{t('THE ZIP ON THE BACK UP SCREEN HAS ALL OF THESE AT ONCE.')}</div>
        {counts.length ? <CountTable counts={counts} /> : null}
      </Box>
    </div>
  )
}

function RestoreTab({ say }: { say: Say }) {
  const { t, tf } = useT()
  const store = useStore()
  const run = useRun(say)
  const file = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [mode, setMode] = useState<'merge' | 'exact'>('merge')
  const [pre, setPre] = useState<BackupPreview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [safe, setSafe] = useState(true)

  const load = async (f: File | undefined) => {
    setErr(null)
    setPre(null)
    setText(null)
    if (!f) return
    setName(f.name)
    try {
      const { text: tx } = await readBackupFile(new Uint8Array(await f.arrayBuffer()))
      setText(tx)
      setPre(await store.previewBackup(tx, mode === 'exact'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const pickMode = async (m: 'merge' | 'exact') => {
    setMode(m)
    if (text) {
      try {
        setPre(await store.previewBackup(text, m === 'exact'))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    }
  }
  const go = () =>
    text &&
    void run(mode === 'exact' ? t('RESTORED AS AN EXACT COPY') : t('BACKUP RESTORED'), async () => {
      if (mode === 'exact' && safe) {
        downloadFile(`mycol-before-restore-${stamp()}.json`, await store.exportJson(), 'application/json')
        markBackup()
        bumpNag()
      }
      await store.importJson(text, { exact: mode === 'exact' })
    }).then((ok) => {
      if (ok) {
        setText(null)
        setPre(null)
        setName('')
        if (file.current) file.current.value = ''
      }
    })
  const nothing = pre && pre.add === 0 && pre.change === 0 && pre.remove === 0

  return (
    <div className="lg-stack">
      <Box title={t('RESTORE FROM A FILE')}>
        <div className="dim tiny">{t('PICK A ZIP MADE BY THIS APP, OR ITS .JSON BACKUP FILE. NOTHING CHANGES UNTIL YOU PRESS RESTORE: YOU SEE WHAT WOULD CHANGE FIRST.')}</div>
        <input ref={file} type="file" className="dt-file" aria-label={t('Backup file')} accept=".zip,.json,application/zip,application/json" onChange={(e) => void load(e.target.files?.[0])} />
        {name && <div className="dim">{name}</div>}
        {err && <div className="lg-warn">{err}</div>}
      </Box>
      {pre && (
        <Box title={t('WHAT RESTORE WOULD DO')}>
          <Buttons<'merge' | 'exact'> value={mode} label={t('Mode')} onPick={(m) => void pickMode(m)} options={[{ id: 'merge', label: t('ADD AND UPDATE (KEEP THE REST)') }, { id: 'exact', label: t('EXACT COPY OF THE FILE') }]} />
          <div className="dim tiny">{mode === 'merge' ? t('RECORDS IN THE FILE ARE ADDED OR OVERWRITTEN BY THEIR ID. RECORDS THAT ARE ONLY HERE STAY.') : t('THIS DEVICE ENDS UP WITH EXACTLY THE FILE. RECORDS THAT ARE ONLY HERE ARE REMOVED.')}</div>
          <div className="rc-wrap">
            <table className="lg-table">
              <thead><tr><th>{t('TABLE')}</th><th>{t('NEW')}</th><th>{t('CHANGED')}</th><th>{t('SAME')}</th>{mode === 'exact' && <th>{t('REMOVED')}</th>}</tr></thead>
              <tbody>
                {pre.tables.map((r) => (
                  <tr key={r.table}><td>{tableName(r.table, 2)}</td><td>{r.add}</td><td>{r.change}</td><td>{r.same}</td>{mode === 'exact' && <td className={r.remove ? 'warn' : ''}>{r.remove}</td>}</tr>
                ))}
                <tr><td>{t('TOTAL')}</td><td>{pre.add}</td><td>{pre.change}</td><td>{pre.same}</td>{mode === 'exact' && <td className={pre.remove ? 'warn' : ''}>{pre.remove}</td>}</tr>
              </tbody>
            </table>
          </div>
          {mode === 'exact' && (
            <div className="lg-btns">
              <button type="button" className={`btn ${safe ? 'on' : ''}`} aria-pressed={safe} onClick={() => setSafe(!safe)}>{safe ? '[X]' : '[ ]'} {t('SAVE A BACKUP OF WHAT IS HERE FIRST')}</button>
            </div>
          )}
          {nothing ? <div className="dim">{t('THE FILE HAS NOTHING NEW. THIS DEVICE ALREADY HAS EVERYTHING IN IT.')}</div> : <Confirm label={tf('RESTORE ({n} CHANGES)', { n: pre.add + pre.change + pre.remove })} onYes={go} />}
          <div className="dim tiny">{t('RESTORE IS ONE UNDO STEP: UNDO PUTS THIS DEVICE BACK AS IT WAS (UNTIL YOU RELOAD THE APP).')}</div>
        </Box>
      )}
    </div>
  )
}
