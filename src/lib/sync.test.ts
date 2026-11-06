import { describe, expect, it } from 'vitest'
import { Store } from './store'
import { mergeRow, SyncBackend } from './sync'
import { FakeDb, MemCache } from './testkit'

const setup = () => {
  const db = new FakeDb()
  const cache = new MemCache()
  const b = new SyncBackend(db, cache, () => db.up)
  const st = new Store(b)
  Store.GROUP_MS = 0
  return { db, cache, b, st }
}
const later = (min: number) => new Date(Date.now() + min * 60000).toISOString()
const earlier = (min: number) => new Date(Date.now() - min * 60000).toISOString()

describe('conflict rule (mergeRow)', () => {
  it('keeps both sides when they changed different fields', () => {
    const base = { id: 'a', kg: 1, notes: 'x' }
    const m = mergeRow(base, { id: 'a', kg: 2, notes: 'x' }, { id: 'a', kg: 1, notes: 'y' }, earlier(1))
    expect(m.row).toMatchObject({ kg: 2, notes: 'y' })
    expect(m.conflicts).toEqual([])
  })
  it('later write wins a field both changed, and lists it', () => {
    const base = { id: 'a', kg: 1 }
    const mineLater = mergeRow(base, { id: 'a', kg: 2 }, { id: 'a', kg: 3, updated_at: earlier(10) }, earlier(1))
    expect(mineLater.row.kg).toBe(2)
    expect(mineLater.conflicts[0]).toMatchObject({ field: 'kg', mine: 2, theirs: 3, kept: 'mine' })
    const theirsLater = mergeRow(base, { id: 'a', kg: 2 }, { id: 'a', kg: 3, updated_at: later(5) }, earlier(1))
    expect(theirsLater.row.kg).toBe(3)
    expect(theirsLater.conflicts[0].kept).toBe('theirs')
  })
  it('an edit to a record deleted elsewhere puts it back and lists it', () => {
    const m = mergeRow({ id: 'a', kg: 1 }, { id: 'a', kg: 2 }, null, earlier(1))
    expect(m.row.kg).toBe(2)
    expect(m.conflicts[0].kind).toBe('deleted-there')
  })
})

describe('offline queue', () => {
  it('saves with no signal and sends when signal returns', async () => {
    const { db, b, st } = setup()
    db.up = false
    await st.put('harvests', { id: 'h1', kg: 4 })
    await st.put('harvests', { id: 'h2', kg: 2 })
    expect(st.rows('harvests')).toHaveLength(2) // on screen straight away
    await b.flush()
    expect(b.info().waiting).toBeGreaterThanOrEqual(2)
    expect(b.info().online).toBe(false)
    db.up = true
    await b.flush()
    expect(b.info().waiting).toBe(0)
    expect(await db.load('harvests')).toHaveLength(2)
  })

  it('the queue survives a reload (kept in the browser copy)', async () => {
    const { db, cache } = setup()
    db.up = false
    const b1 = new SyncBackend(db, cache, () => db.up)
    const st1 = new Store(b1)
    await st1.put('sales', { id: 's1', kg: 1 })
    const b2 = new SyncBackend(db, cache, () => db.up)
    expect((await b2.load('sales'))[0].id).toBe('s1') // offline: browser copy
    db.up = true
    await b2.flush()
    expect(await db.load('sales')).toHaveLength(1)
  })

  it('opening a screen online shows unsent changes on top of the database', async () => {
    const { db, b } = setup()
    db.up = false
    await b.put('sales', [{ id: 's1', kg: 9 }])
    db.other('sales', { id: 's1', kg: 1 })
    db.other('sales', { id: 's2', kg: 2 })
    db.up = true
    // flush has not run yet: load must still show kg 9
    b['running'] = Promise.resolve() // pretend busy so load runs first
    const rows = await b.load('sales')
    expect(rows.find((r) => r.id === 's1')!.kg).toBe(9)
    expect(rows).toHaveLength(2)
  })

  it('merges with another device field by field and lists conflicts', async () => {
    const { db, b, st } = setup()
    db.other('items', { id: 'i1', name: 'RYE', notes: 'A', unit: 'kg', updated_at: earlier(60) })
    await st.ensure('items')
    db.up = false
    await st.put('items', { id: 'i1', name: 'RYE GRAIN' }) // offline here
    db.other('items', { id: 'i1', notes: 'B', name: 'WHEAT', updated_at: earlier(30) }) // other device, before ours
    db.up = true
    await b.flush()
    const r = (await db.get('items', ['i1']))[0]
    expect(r).toMatchObject({ name: 'RYE GRAIN', notes: 'B' })
    expect(b.info().conflicts).toBe(1)
    expect(b.conflictList()[0]).toMatchObject({ field: 'name', mine: 'RYE GRAIN', theirs: 'WHEAT', kept: 'mine' })
    expect(st.rows('items')[0].notes).toBe('B') // the screen picked up the other device's field
    await b.markSeen()
    expect(b.info().conflicts).toBe(0)
  })

  it('a refused write is listed and does not block the rest', async () => {
    const { db, b, st } = setup()
    db.refuse = 'bad'
    await st.put('sales', { id: 'bad', kg: -1 })
    await st.put('sales', { id: 'ok', kg: 1 })
    await b.flush()
    expect(b.info().waiting).toBe(0)
    expect(b.conflictList().some((c) => c.kind === 'refused' && c.row_id === 'bad')).toBe(true)
    expect((await db.load('sales')).map((r) => r.id)).toEqual(['ok'])
  })

  it('a delete loses to a later change on another device', async () => {
    const { db, b, st } = setup()
    db.other('sales', { id: 's1', kg: 1, updated_at: earlier(60) })
    await st.ensure('sales')
    db.up = false
    await st.del('sales', 's1')
    db.other('sales', { id: 's1', kg: 5, updated_at: later(1) })
    db.up = true
    await b.flush()
    expect(await db.load('sales')).toHaveLength(1)
    expect(st.rows('sales')[0].kg).toBe(5)
    expect(b.conflictList()[0].kind).toBe('deleted-here')
  })

  it('with storage blocked, writes go straight through and fail loudly offline', async () => {
    const db = new FakeDb()
    const b = new SyncBackend(db, null, () => db.up)
    const st = new Store(b)
    await st.put('sales', { id: 's1', kg: 1 })
    expect(await db.load('sales')).toHaveLength(1)
    db.up = false
    await expect(st.put('sales', { id: 's2', kg: 1 })).rejects.toThrow(/NOT SAVED/)
    expect(st.rows('sales')).toHaveLength(1)
  })
})
