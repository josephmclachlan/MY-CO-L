// A small ZIP writer and reader, no libraries. Used by EXPORT (one ZIP with every CSV and the backup file) and RESTORE.
//
// Writer: every file is stored (not compressed). That keeps it exact and fast, and the backup is plain text anyway.
// Reader: reads stored files and deflate-compressed files (so a ZIP re-packed by a computer still restores).
// Not supported: ZIP64 (files over 4 GB), encryption, split archives. Those are refused with a plain message.

const te = new TextEncoder()
const td = new TextDecoder('utf-8')

let TABLE: Uint32Array | null = null
export function crc32(data: Uint8Array): number {
  if (!TABLE) {
    TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipFile {
  name: string
  data: Uint8Array | string
  /** Modified time (default now). */
  at?: Date
}

function dos(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear())
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }
}

export function makeZip(files: ZipFile[], now = new Date()): Uint8Array {
  if (files.length > 65534) throw new Error('TOO MANY FILES FOR ONE ZIP.')
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const names = new Set<string>()
  for (const f of files) {
    if (names.has(f.name)) throw new Error(`TWO FILES NAMED ${f.name}.`)
    names.add(f.name)
    const name = te.encode(f.name)
    const data = typeof f.data === 'string' ? te.encode(f.data) : f.data
    if (data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('ZIP TOO BIG (OVER 4 GB).')
    const crc = crc32(data)
    const { time, date } = dos(f.at ?? now)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flags: UTF-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    chunks.push(local, data)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cen.set(name, 46)
    central.push(cen)
    offset += local.length + data.length
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cenSize, true)
  ev.setUint32(16, offset, true)
  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of all) {
    out.set(c, p)
    p += c.length
  }
  return out
}

export const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('THIS BROWSER CANNOT OPEN COMPRESSED ZIPS. USE THE .JSON BACKUP FILE.')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** Read every file in a ZIP. Names with .. or a leading slash are refused. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Find the end-of-central-directory record, scanning back over a possible comment.
  let e = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      e = i
      break
    }
  }
  if (e < 0) throw new Error('NOT A ZIP FILE (OR IT IS DAMAGED).')
  const count = v.getUint16(e + 10, true)
  const cenSize = v.getUint32(e + 12, true)
  let p = v.getUint32(e + 16, true)
  if (count === 0xffff || p === 0xffffffff || cenSize === 0xffffffff) throw new Error('ZIP64 FILES ARE NOT SUPPORTED. USE THE .JSON BACKUP FILE.')
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP FILE LIST IS DAMAGED.')
    const flags = v.getUint16(p + 8, true)
    const method = v.getUint16(p + 10, true)
    const crc = v.getUint32(p + 16, true)
    const csize = v.getUint32(p + 20, true)
    const nlen = v.getUint16(p + 28, true)
    const xlen = v.getUint16(p + 30, true)
    const clen = v.getUint16(p + 32, true)
    const lofs = v.getUint32(p + 42, true)
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (flags & 1) throw new Error('ENCRYPTED ZIP FILES ARE NOT SUPPORTED.')
    if (name.endsWith('/')) continue
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw new Error(`UNSAFE FILE NAME IN ZIP: ${name}`)
    if (lofs + 30 > bytes.length || v.getUint32(lofs, true) !== 0x04034b50) throw new Error('ZIP FILE IS DAMAGED.')
    const start = lofs + 30 + v.getUint16(lofs + 26, true) + v.getUint16(lofs + 28, true)
    if (start + csize > bytes.length) throw new Error('ZIP FILE IS CUT SHORT.')
    const raw = bytes.subarray(start, start + csize)
    let data: Uint8Array
    if (method === 0) data = raw.slice()
    else if (method === 8) data = await inflateRaw(raw)
    else throw new Error(`ZIP COMPRESSION METHOD ${method} IS NOT SUPPORTED.`)
    if (crc32(data) !== crc) throw new Error(`ZIP FILE ${name} FAILED ITS CHECK (DAMAGED).`)
    out.push({ name, data })
  }
  return out
}

export const textOf = (b: Uint8Array) => td.decode(b)
export const bytesOf = (s: string) => te.encode(s)
