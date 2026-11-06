// Photos on cultures, grain and block lots (build G4).
// A photo is shrunk in the app (longest side 960 px, JPEG) and kept as text in the `photos` table, so it
// backs up, exports, syncs and shows in the edit history exactly like every other record.

import { uuid, type Store, type Row } from './store'

export interface Photo extends Row {
  id: string
  table_name: string
  row_id: string
  taken_at: string
  caption: string | null
  mime: string
  w: number | null
  h: number | null
  bytes: number | null
  data_url: string
  created_at?: string
}

export const MAX_SIDE = 960
export const JPEG_QUALITY = 0.72
export const MAX_PER_RECORD = 24
/** Tables a photo may be attached to. */
export const PHOTO_TABLES = ['cultures', 'grain_runs', 'block_lots'] as const

export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 }
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** Bytes a data URL holds (base64 part). */
export function dataUrlBytes(u: string): number {
  const i = u.indexOf(',')
  const b64 = i >= 0 ? u.slice(i + 1) : u
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}
export const isImageDataUrl = (u: unknown): u is string => typeof u === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(u)

export interface Shrunk {
  data_url: string
  w: number
  h: number
  mime: string
}

/** Browser only: read an image file and shrink it. Throws a plain-words error if it is not a picture. */
export async function shrinkImage(file: Blob): Promise<Shrunk> {
  if (!/^image\//.test(file.type)) throw new Error('THAT FILE IS NOT A PICTURE.')
  let bmp: ImageBitmap | HTMLImageElement
  try {
    bmp = await createImageBitmap(file)
  } catch {
    bmp = await new Promise<HTMLImageElement>((ok, no) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => (URL.revokeObjectURL(url), ok(img))
      img.onerror = () => (URL.revokeObjectURL(url), no(new Error('THIS PICTURE COULD NOT BE READ.')))
      img.src = url
    })
  }
  const sw = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width
  const sh = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height
  const { w, h } = fitSize(sw, sh)
  if (!w) throw new Error('THIS PICTURE IS EMPTY.')
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('THIS BROWSER CANNOT SHRINK PICTURES.')
  ctx.drawImage(bmp, 0, 0, w, h)
  if ('close' in bmp) bmp.close()
  const data_url = cv.toDataURL('image/jpeg', JPEG_QUALITY)
  return { data_url, w, h, mime: 'image/jpeg' }
}

export function photoRow(table: string, rowId: string, img: Shrunk, caption?: string | null): Photo {
  return {
    id: uuid(),
    table_name: table,
    row_id: rowId,
    taken_at: new Date().toISOString(),
    caption: caption?.trim().slice(0, 140) || null,
    mime: img.mime,
    w: img.w,
    h: img.h,
    bytes: dataUrlBytes(img.data_url),
    data_url: img.data_url,
    created_at: new Date().toISOString(),
  }
}

export const photosOf = (all: Photo[], table: string, id: string): Photo[] =>
  all.filter((p) => p.table_name === table && p.row_id === id).sort((a, b) => b.taken_at.localeCompare(a.taken_at))

export async function addPhoto(store: Store, table: string, rowId: string, img: Shrunk, existing: Photo[], caption?: string | null): Promise<Photo> {
  if (!(PHOTO_TABLES as readonly string[]).includes(table)) throw new Error('PHOTOS CANNOT BE ATTACHED HERE.')
  if (!isImageDataUrl(img.data_url)) throw new Error('THAT IS NOT A PICTURE.')
  if (photosOf(existing, table, rowId).length >= MAX_PER_RECORD) throw new Error(`THIS RECORD ALREADY HAS ${MAX_PER_RECORD} PHOTOS. DELETE AN OLD ONE FIRST.`)
  const row = photoRow(table, rowId, img, caption)
  await store.put('photos', row)
  return row
}

/** Text for the edit history in place of the picture's thousands of characters. */
export const PHOTO_PLACEHOLDER = '[PHOTO]'
