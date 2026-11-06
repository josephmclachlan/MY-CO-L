// Mock trials for G9 CSV and ZIP: the file formats EXPORT writes and RESTORE reads.
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { BOM, columnsOf, csvCell, parseCsv, toCsv } from './csv'
import { bytesOf, crc32, isZip, makeZip, readZip, textOf } from './zip'
import { rng } from './testkit'

describe('csv', () => {
  it('quotes commas, quotes and line breaks; blanks null and undefined', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(12.5)).toBe('12.5')
    expect(csvCell(NaN)).toBe('')
    expect(csvCell(true)).toBe('true')
    expect(csvCell({ a: [1, 2] })).toBe('"{""a"":[1,2]}"')
  })
  it('never lets a spreadsheet run a text cell as a formula', () => {
    for (const bad of ['=SUM(A1)', '+1+1', '@cmd', '-abc', '\tTAB', '\rCR']) expect(csvCell(bad).replace(/^"/, '')[0]).toBe("'")
    expect(csvCell('-5')).toBe('-5') // a real negative number stays a number
    expect(csvCell('-0.5')).toBe('-0.5')
    expect(csvCell(-5)).toBe('-5')
  })
  it('writes a BOM, CRLF line ends and the header first', () => {
    const out = toCsv([{ id: 'a', n: 1 }, { id: 'b', n: 2 }])
    expect(out.startsWith(BOM)).toBe(true)
    expect(out.slice(1)).toBe('id,n\r\na,1\r\nb,2\r\n')
    expect(toCsv([{ id: 'a' }], undefined, { bom: false })).toBe('id\r\na\r\n')
  })
  it('puts id first, then every key in the order first met', () => {
    expect(columnsOf([{ z: 1, id: 'x' }, { y: 2, id: 'y', z: 3 }])).toEqual(['id', 'z', 'y'])
    expect(columnsOf([])).toEqual([])
  })
  it('reads back what it wrote, including Ñ, ₡, quotes, commas and line breaks', () => {
    const rows = [
      { id: '1', name: 'COMPRADOR, Ñandú', note: 'dijo "ok"\nluego pagó', amt: 12500.5 },
      { id: '2', name: '', note: '₡ 1,000', amt: 0 },
    ]
    const back = parseCsv(toCsv(rows))
    expect(back[0]).toEqual(['id', 'name', 'note', 'amt'])
    expect(back[1]).toEqual(['1', 'COMPRADOR, Ñandú', 'dijo "ok"\nluego pagó', '12500.5'])
    expect(back[2]).toEqual(['2', '', '₡ 1,000', '0'])
    expect(back.length).toBe(3)
  })
  it('reads LF files, a missing final newline and empty text', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('')).toEqual([])
  })
  it('random cells survive a write and read (seeded)', () => {
    const alphabet = ['a', 'Z', ' ', ',', '"', '\n', '\r\n', 'ñ', '₡', '=', '1', '-', "'"]
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed)
      const rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, v: Array.from({ length: r.int(12) }, () => alphabet[r.int(alphabet.length)]).join('') }))
      const back = parseCsv(toCsv(rows))
      expect(back.length).toBe(rows.length + 1)
      for (let i = 0; i < rows.length; i++) {
        const want = csvCell(rows[i].v)
        // the cell is quoted when needed and prefixed with ' when it looks like a formula; reading strips quoting only
        const prefixed = want.startsWith('"') ? want.slice(1, -1).replace(/""/g, '"') : want
        expect(back[i + 1][1].replace(/\r\n/g, '\n')).toBe(prefixed.replace(/\r\n/g, '\n'))
      }
    }
  })
})

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(bytesOf('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })
  it('round trips several files, UTF-8 names and empty files', async () => {
    const files = [
      { name: 'backup.json', data: '{"a":1}' },
      { name: 'csv/niño.csv', data: 'Ñ,₡\r\n1,2\r\n' },
      { name: 'empty.txt', data: '' },
      { name: 'bin.dat', data: new Uint8Array([0, 255, 1, 254, 2]) },
    ]
    const zip = makeZip(files, new Date(2026, 10, 6, 12, 0, 0))
    expect(isZip(zip)).toBe(true)
    const back = await readZip(zip)
    expect(back.map((e) => e.name)).toEqual(files.map((f) => f.name))
    expect(textOf(back[0].data)).toBe('{"a":1}')
    expect(textOf(back[1].data)).toBe('Ñ,₡\r\n1,2\r\n')
    expect(back[2].data.length).toBe(0)
    expect([...back[3].data]).toEqual([0, 255, 1, 254, 2])
  })
  it('refuses two files with one name and a non-zip', async () => {
    expect(() => makeZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }])).toThrow(/TWO FILES/)
    expect(isZip(bytesOf('{"json":true}'))).toBe(false)
    await expect(readZip(bytesOf('not a zip at all, just text of some length'))).rejects.toThrow(/NOT A ZIP/)
  })
  it('detects damage: a flipped byte fails its check, a cut file is refused', async () => {
    const zip = makeZip([{ name: 'a.txt', data: 'hello world, hello world' }])
    const bad = zip.slice()
    bad[40] ^= 0xff // inside the stored data
    await expect(readZip(bad)).rejects.toThrow(/FAILED ITS CHECK|DAMAGED/)
    await expect(readZip(zip.slice(0, zip.length - 30))).rejects.toThrow()
  })
  it('refuses names that climb out of the folder', async () => {
    for (const name of ['../evil.txt', '/abs.txt', 'a/../../b.txt']) {
      const zip = makeZip([{ name, data: 'x' }])
      await expect(readZip(zip)).rejects.toThrow(/UNSAFE/)
    }
  })
  it('reads a deflate-compressed ZIP (a file re-packed by a computer)', async () => {
    const text = 'MY/CO/L '.repeat(500)
    const raw = bytesOf(text)
    const comp = deflateRawSync(raw)
    const name = bytesOf('backup.json')
    const local = new Uint8Array(30 + name.length + comp.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(8, 8, true)
    lv.setUint32(14, crc32(raw), true)
    lv.setUint32(18, comp.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(comp, 30 + name.length)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(10, 8, true)
    cv.setUint32(16, crc32(raw), true)
    cv.setUint32(20, comp.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, 0, true)
    cen.set(name, 46)
    const end = new Uint8Array(22)
    const ev = new DataView(end.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, 1, true)
    ev.setUint16(10, 1, true)
    ev.setUint32(12, cen.length, true)
    ev.setUint32(16, local.length, true)
    const zip = new Uint8Array(local.length + cen.length + end.length)
    zip.set(local, 0)
    zip.set(cen, local.length)
    zip.set(end, local.length + cen.length)
    const back = await readZip(zip)
    expect(back.length).toBe(1)
    expect(textOf(back[0].data)).toBe(text)
  })
  it('random files survive a round trip (seeded)', async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed)
      const files = Array.from({ length: 1 + r.int(8) }, (_, i) => ({ name: `d${r.int(3)}/f${i}.bin`, data: Uint8Array.from({ length: r.int(3000) }, () => r.int(256)) }))
      const back = await readZip(makeZip(files))
      expect(back.length).toBe(files.length)
      back.forEach((e, i) => {
        expect(e.name).toBe(files[i].name)
        expect(Buffer.from(e.data).equals(Buffer.from(files[i].data))).toBe(true)
      })
    }
  })
})
