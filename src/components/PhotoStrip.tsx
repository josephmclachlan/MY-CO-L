import { useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useStore, useTable } from '../store/StoreContext'
import { addPhoto, MAX_PER_RECORD, photosOf, shrinkImage, type Photo } from '../lib/photos'
import { Confirm } from '../screens/CookParts'

/**
 * Photos of one record (a culture, a grain run or a block lot): a row of small pictures, ADD PHOTO (opens the
 * phone camera, or a file chooser on a computer), and a large view with a caption and DELETE.
 * Pictures are shrunk on the device before they are saved.
 */
export function PhotoStrip({ table, id, say }: { table: 'cultures' | 'grain_runs' | 'block_lots'; id: string; say: (t: string, warn?: boolean) => void }) {
  const store = useStore()
  const { sound } = useApp()
  const all = useTable<Photo>('photos')
  const mine = photosOf(all, table, id)
  const file = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cap, setCap] = useState('')
  const shown = mine.slice(0, 8)
  const big = mine.find((p) => p.id === open) ?? null

  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const img = await shrinkImage(f)
      await store.action('ADD PHOTO', () => addPhoto(store, table, id, img, all, cap))
      sound.confirm()
      say('PHOTO SAVED')
      setCap('')
    } catch (e) {
      say(e instanceof Error ? e.message.toUpperCase() : 'PHOTO FAILED', true)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="ph-strip" data-testid="photo-strip">
      <div className="ph-head">
        <span className="dim tiny">PHOTOS // {mine.length}{mine.length >= MAX_PER_RECORD ? ' (FULL)' : ''}</span>
        <label className="ph-cap">
          <span className="dim tiny">CAPTION</span>
          <input value={cap} maxLength={140} placeholder="OPTIONAL" onChange={(e) => setCap(e.target.value)} />
        </label>
        <button type="button" className="btn" disabled={busy || mine.length >= MAX_PER_RECORD} onClick={() => file.current?.click()}>
          {busy ? 'SAVING...' : 'ADD PHOTO'}
        </button>
        <input ref={file} type="file" accept="image/*" capture="environment" hidden data-testid="photo-file" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {shown.length > 0 && (
        <div className="ph-row">
          {shown.map((p) => (
            <button key={p.id} type="button" className={`ph-thumb ${open === p.id ? 'sel' : ''}`} aria-label={`Photo ${p.taken_at.slice(0, 10)}${p.caption ? ` ${p.caption}` : ''}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <img src={p.data_url} alt="" />
            </button>
          ))}
          {mine.length > shown.length && (
            <button type="button" className="btn" onClick={() => setOpen(mine[shown.length].id)}>
              +{mine.length - shown.length} MORE
            </button>
          )}
        </div>
      )}
      {big && (
        <div className="ph-big">
          <img src={big.data_url} alt={big.caption ?? 'Photo'} />
          <div className="dim tiny">{big.taken_at.slice(0, 16).replace('T', ' ')}{big.caption ? ` // ${big.caption.toUpperCase()}` : ''}{big.bytes ? ` // ${Math.round(big.bytes / 1024)} KB` : ''}</div>
          <div className="lg-btns">
            <button type="button" className="btn" onClick={() => setOpen(null)}>CLOSE</button>
            <Confirm label="DELETE PHOTO" onYes={() => void store.action('DELETE PHOTO', () => store.del('photos', big.id)).then(() => (setOpen(null), say('PHOTO DELETED')))} />
          </div>
        </div>
      )}
    </div>
  )
}
