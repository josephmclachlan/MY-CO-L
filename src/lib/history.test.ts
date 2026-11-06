import { describe, expect, it } from 'vitest'
import { MemoryBackend, Store, EDIT_LOG, type Row } from './store'
import { autoLabel, diffRow, type EditEntry } from './history'

const fresh = () => {
  const st = new Store(new MemoryBackend())
  Store.GROUP_MS = 0 // every bare write is its own action in tests
  return st
}
const log = async (st: Store) => {
  await st.ensure(EDIT_LOG)
  return st.rows<EditEntry>(EDIT_LOG)
}

describe('edit history', () => {
  it('diffs fields and ignores updated_at', () => {
    expect(diffRow({ id: 'a', kg: 1, updated_at: 'x' }, { id: 'a', kg: 2, updated_at: 'y' })).toEqual([{ f: 'kg', old: 1, new: 2 }])
    expect(diffRow(null, { id: 'a', kg: 2 })).toEqual([{ f: 'kg', old: null, new: 2 }])
    expect(diffRow({ id: 'a', notes: null }, { id: 'a', notes: undefined } as Row)).toEqual([])
  })

  it('labels writes nobody named', () => {
    expect(autoLabel([{ table: 'sales', op: 'create' }])).toBe('ADDED SALE')
    expect(autoLabel([{ table: 'harvests', op: 'delete' }, { table: 'harvests', op: 'delete' }])).toBe('DELETED 2 HARVESTS')
  })

  it('records who, when, old and new for each record', async () => {
    const st = fresh()
    st.who = 'ANA'
    st.screen = 'TRADE'
    await st.put('sales', { id: 's1', kg: 2, buyer: 'CAFE' })
    await st.put('sales', { id: 's1', kg: 3 })
    await st.del('sales', 's1')
    const l = await log(st)
    expect(l.map((e) => e.op)).toEqual(['create', 'update', 'delete'])
    expect(l[1].changes).toEqual([{ f: 'kg', old: 2, new: 3 }])
    expect(l[1].who).toBe('ANA')
    expect(l[1].screen).toBe('TRADE')
    expect(l[2].snapshot).toMatchObject({ id: 's1', kg: 3, buyer: 'CAFE' })
  })

  it('groups an action under one label', async () => {
    const st = fresh()
    await st.action('HARVEST SAVED', async () => {
      await st.put('block_lots', { id: 'l1', status: 'fruiting' })
      await st.put('harvests', { id: 'h1', kg: 4 })
    })
    const l = await log(st)
    expect(l).toHaveLength(2)
    expect(new Set(l.map((e) => e.action_id)).size).toBe(1)
    expect(l.every((e) => e.label === 'HARVEST SAVED')).toBe(true)
    expect(st.undoPeek()?.label).toBe('HARVEST SAVED')
  })

  it('takes the label from the returned message', async () => {
    const st = fresh()
    await st.action(null, async () => {
      await st.put('items', { id: 'i1', name: 'Rye' })
      return 'RYE ADDED'
    })
    expect(st.undoPeek()?.label).toBe('RYE ADDED')
  })

  it('keeps one summary line for huge actions', async () => {
    const st = fresh()
    await st.action('BIG', () => st.put('stock_moves', Array.from({ length: 250 }, (_, i) => ({ id: `m${i}`, qty: 1 }))))
    const l = await log(st)
    expect(l).toHaveLength(1)
    expect(l[0].row_id).toBe('*')
  })
})

describe('undo', () => {
  it('reverses a create, an edit and a delete', async () => {
    const st = fresh()
    await st.put('sales', { id: 's1', kg: 2 })
    await st.put('sales', { id: 's1', kg: 5 })
    expect(await st.undo()).toBe('CHANGED SALE')
    expect(st.rows('sales')[0].kg).toBe(2)
    await st.del('sales', 's1')
    expect(st.rows('sales')).toHaveLength(0)
    await st.undo()
    expect(st.rows('sales')[0]).toMatchObject({ id: 's1', kg: 2 })
    await st.undo() // the create
    expect(st.rows('sales')).toHaveLength(0)
    expect(await st.undo()).toBeNull()
  })

  it('undoes a whole action at once, parents back before children', async () => {
    const st = fresh()
    await st.put('strains', { id: 'st1', code: 'BO-01' })
    await st.put('cultures', [{ id: 'c1', strain_id: 'st1' }, { id: 'c2', strain_id: 'st1', parent_id: 'c1' }])
    await st.action('STRAIN DELETED', async () => {
      await st.del('cultures', ['c2', 'c1'])
      await st.del('strains', 'st1')
    })
    const order: string[] = []
    const b = st.backend as MemoryBackend
    const put = b.put.bind(b)
    b.put = async (t, rows) => {
      if (t !== EDIT_LOG) order.push(t)
      return put(t, rows)
    }
    await st.undo()
    expect(order).toEqual(['strains', 'cultures'])
    expect(st.rows('cultures')).toHaveLength(2)
  })

  it('leaves alone a field changed again since', async () => {
    const st = fresh()
    await st.put('items', { id: 'i1', name: 'RYE', notes: 'A' })
    await st.put('items', { id: 'i1', name: 'RYE GRAIN', notes: 'B' })
    // the same record is changed again by something not on the undo stack (a sync from another device)
    st.backend.onChange?.('items', [{ id: 'i1', notes: 'C' }], [])
    await st.undo()
    const r = st.rows('items')[0]
    expect(r.name).toBe('RYE')
    expect(r.notes).toBe('C')
  })

  it('logs the undo itself in the history', async () => {
    const st = fresh()
    await st.put('sales', { id: 's1', kg: 2 })
    await st.undo()
    const l = await log(st)
    expect(l.at(-1)).toMatchObject({ via: 'undo', op: 'delete', label: 'UNDO ADDED SALE' })
  })

  it('restores a deleted record and old values from the history', async () => {
    const st = fresh()
    await st.put('sales', { id: 's1', kg: 2, buyer: 'CAFE' })
    await st.put('sales', { id: 's1', kg: 9 })
    let l = await log(st)
    expect(await st.restore(l[1])).toBe('OLD VALUES PUT BACK')
    expect(st.rows('sales')[0].kg).toBe(2)
    await st.del('sales', 's1')
    l = await log(st)
    const gone = l.filter((e) => e.op === 'delete').at(-1)!
    await st.restore(gone)
    expect(st.rows('sales')[0]).toMatchObject({ kg: 2, buyer: 'CAFE' })
    await expect(st.restore(gone)).rejects.toThrow(/ALREADY BACK/)
  })

  it('import does not flood the undo list with the old history', async () => {
    const a = fresh()
    await a.put('sales', { id: 's1', kg: 2 })
    const text = await a.exportJson()
    const b = fresh()
    await b.importJson(text)
    expect(b.rows('sales')).toHaveLength(1)
    const l = await log(b)
    expect(l.filter((e) => e.label === 'ADDED SALE')).toHaveLength(1) // the original entry came across
    expect(l.filter((e) => e.via === 'import')).toHaveLength(1)
    expect(b.undoPeek()?.label).toBe('IMPORT BACKUP')
  })
})

describe('app-made writes', () => {
  it('a fetched exchange rate is logged as APP and never undone by UNDO', async () => {
    const st = fresh()
    st.who = 'JOSEPH'
    await st.put('sales', { id: 's1', kg: 2, amount_crc: 23000, sold_on: '2026-11-05' })
    await st.put('fx_rates', { id: '2026-11-05', day: '2026-11-05', crc_per_usd: 505.3, source: 'AUTO' }, { label: 'EXCHANGE RATE FETCHED' })
    expect(st.undoPeek()?.label).toBe('ADDED SALE')
    await st.undo()
    expect(st.rows('sales')).toHaveLength(0)
    expect(st.rows('fx_rates')[0].crc_per_usd).toBe(505.3) // the day's rate stays as it was
    const l = await log(st)
    expect(l.find((e) => e.table_name === 'fx_rates')).toMatchObject({ who: 'APP', via: 'system' })
  })
})
