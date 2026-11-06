// History lines go to the database with a plain insert (so a STAFF login, which cannot read or change history, can add its own lines).
import { describe, expect, it } from 'vitest'
import { addHistory } from './remotedb'
import { NetError } from './sync'
import type { Row } from './store'

type Res = { error: { message: string; code?: string } | null; status?: number }
const fake = (answer: (rows: Row[]) => Res) => {
  const calls: Row[][] = []
  const sb = {
    from: (t: string) => {
      if (t !== 'edit_log') throw new Error('wrong table ' + t)
      return {
        insert: async (r: Row | Row[]) => {
          const rows = Array.isArray(r) ? r : [r]
          calls.push(rows)
          return answer(rows)
        },
      }
    },
  }
  return { sb: sb as never, calls }
}
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }))

describe('addHistory', () => {
  it('inserts in chunks of 400', async () => {
    const f = fake(() => ({ error: null }))
    await addHistory(f.sb, rows(1000))
    expect(f.calls.map((c) => c.length)).toEqual([400, 400, 200])
  })
  it('a line that is already there (first answer was lost) is not an error and the rest still go in', async () => {
    const have = new Set(['e1'])
    const saved: string[] = []
    const f = fake((rs) => {
      if (rs.some((r) => have.has(r.id))) return { error: { message: 'duplicate key value', code: '23505' } }
      rs.forEach((r) => saved.push(r.id))
      return { error: null }
    })
    await addHistory(f.sb, rows(4))
    expect(saved.sort()).toEqual(['e0', 'e2', 'e3'])
  })
  it('a network failure is a NetError (the queue keeps the lines and tries again later)', async () => {
    const f = fake(() => ({ error: { message: 'Failed to fetch' }, status: 0 }))
    await expect(addHistory(f.sb, rows(2))).rejects.toBeInstanceOf(NetError)
  })
  it('a refusal by the database is a plain error', async () => {
    const f = fake(() => ({ error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 }))
    await expect(addHistory(f.sb, rows(2))).rejects.toThrow(/row-level security/)
  })
  it('nothing to add makes no call', async () => {
    const f = fake(() => ({ error: null }))
    await addHistory(f.sb, [])
    expect(f.calls).toEqual([])
  })
})
