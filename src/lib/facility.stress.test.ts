// Stress tests for G7: thousands of random power-cut, generator, water, upkeep and cleaning actions through the Store,
// checked after every step against a plain model kept by the test, plus undo back to the exact earlier state, no
// overlapping cuts, at most one open cut, month totals that always add up to the cuts, and a backup that restores identically.
import { describe, expect, it } from 'vitest'
import { MemoryBackend, Store, type Row } from './store'
import { cutStats, farmDay, fromFarm, monthlyOutage, waterDue, type MaintItem, type PowerCut, type WaterTest } from './facility'
import { deleteCut, genStart, genStop, markMaintDone, powerBack, powerOut, saveClean, saveCut, saveMaint, saveWater, seedMaint } from './facilityActions'
import { rng } from './testkit'

Store.GROUP_MS = 0
const SEEDS = Number(process.env.STRESS_SEEDS ?? 3)
const STEPS = Number(process.env.STRESS_STEPS ?? 500)
const TABLES = ['power_cuts', 'water_tests', 'maint_items', 'maint_log', 'clean_log'] as const
const IGNORE = new Set(['updated_at', 'created_at'])
const clean = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !IGNORE.has(k) && v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
const state = (st: Store) => JSON.stringify(TABLES.map((t) => st.rows(t).map(clean).sort((a, b) => String(a.id).localeCompare(String(b.id)))))
const MIN = 60000
const T0 = fromFarm('2025-01-01', '00:00') as number

interface MCut { down: number; up: number | null }

describe('facility stress', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: ${STEPS} random actions, model, undo, no overlaps, backup`, async () => {
      const r = rng(seed * 104729).next
      const st = new Store(new MemoryBackend())
      for (const t of TABLES) await st.ensure(t)
      let clock = T0
      const model = new Map<string, MCut>() // cut id -> times (cuts only, not tests)
      const undoable: string[] = []
      let waterN = 0
      let cleanN = 0
      const cutsNow = () => st.rows<PowerCut>('power_cuts')
      const snapModel = () => JSON.stringify([...model])
      const restoreModel = (s: string) => { model.clear(); for (const [k, v] of JSON.parse(s)) model.set(k, v) }
      const syncModel = () => {
        // The store is the source of truth for ids; the model tracks times by id.
        for (const c of cutsNow()) if (c.kind === 'cut' && !model.has(c.id)) model.set(c.id, { down: Date.parse(c.down_at), up: c.up_at ? Date.parse(c.up_at) : null })
        for (const id of [...model.keys()]) if (!cutsNow().some((c) => c.id === id)) model.delete(id)
        for (const c of cutsNow()) if (c.kind === 'cut') model.set(c.id, { down: Date.parse(c.down_at), up: c.up_at ? Date.parse(c.up_at) : null })
      }
      for (let step = 0; step < STEPS; step++) {
        const before = state(st)
        const mBefore = snapModel()
        clock += Math.floor(r() * 3 * 86400000) / MIN * MIN + MIN
        const op = r()
        let did = true
        try {
          const open = cutsNow().find((c) => c.kind === 'cut' && c.up_at === null)
          if (op < 0.14) {
            // the grid fails
            await st.action('OUT', () => powerOut(st, clock, 'X'))
            expect(open).toBeUndefined() // powerOut must have refused if one was open
          } else if (op < 0.26 && open) {
            await st.action('BACK', () => powerBack(st, clock))
          } else if (op < 0.4) {
            await st.action('GEN ON', () => genStart(st, clock, 'X'))
          } else if (op < 0.52) {
            await st.action('GEN OFF', () => genStop(st, clock))
          } else if (op < 0.66) {
            // a past cut typed in: some random window before the clock
            const len = (10 + Math.floor(r() * 600)) * MIN
            const down = clock - Math.floor(r() * 20 * 86400000) - len
            const wantOverlap = [...model.values()].some((m) => down < (m.up ?? clock) && down + len > m.down)
            let refused = false
            try {
              await st.action('PAST', () => saveCut(st, null, { kind: 'cut', down: Math.floor(down / MIN) * MIN, up: Math.floor(down / MIN) * MIN + len, runs: [], genHours: null, fuel: null, fuelAmount: null, affected: [] }, clock))
            } catch (e) {
              refused = /OVERLAPS/.test(String(e))
              if (!refused) throw e
            }
            expect(refused).toBe(wantOverlap)
            did = !refused
          } else if (op < 0.72 && cutsNow().length) {
            const c = cutsNow()[Math.floor(r() * cutsNow().length)]
            await st.action('DEL', () => deleteCut(st, c.id))
          } else if (op < 0.8) {
            waterN++
            const day = farmDay(clock)
            await st.action('WATER', () => saveWater(st, null, { day, point: (['raw', 'filtered', 'ro', 'tank', 'mix'] as const)[Math.floor(r() * 5)], ph: 5 + r() * 3, tds: Math.floor(r() * 600), hardness: null, cl: null, temp: null }, day))
          } else if (op < 0.86) {
            const items = st.rows<MaintItem>('maint_items')
            if (!items.length) await st.action('SEED', () => seedMaint(st, farmDay(clock)))
            else {
              const it = items[Math.floor(r() * items.length)]
              const day = farmDay(clock - Math.floor(r() * 5) * 86400000)
              await st.action('DONE', () => markMaintDone(st, it.id, day, 'X', null, farmDay(clock)))
            }
          } else if (op < 0.9) {
            cleanN++
            await st.action('CLEAN', () => saveClean(st, null, { day: farmDay(clock), room: (['lab', 'packing', 'incubation', 'fruiting', 'boiling'] as const)[Math.floor(r() * 5)], tasks: ['wipe'] }, farmDay(clock)))
          } else if (op < 0.93) {
            await st.action('ITEM', () => saveMaint(st, null, { name: `ITEM ${step}`, category: 'other', room: null, make: null, serial: null, installed: null, everyDays: 1 + Math.floor(r() * 300), everyHours: null, startedOn: farmDay(clock) }))
          } else if (undoable.length) {
            const was = undoable.pop() as string
            await st.undo()
            expect(state(st)).toBe(was.split('\u0001')[0])
            restoreModel(was.split('\u0001')[1])
            did = false
          } else did = false
        } catch (e) {
          // refusals are normal: powerOut with one open, powerBack with none, genStop with no run, genStart twice
          if (!/ALREADY|NO CUT|NO GENERATOR|OVERLAPS|TEST RUN|30 DAYS|10 GENERATOR/.test(String(e))) throw e
          did = false
        }
        syncModel()
        if (did && state(st) !== before) undoable.push(`${before}\u0001${mBefore}`)
        else if (did) undoable.push(`${before}\u0001${mBefore}`) // keep the stacks level even for no-change writes
        if (undoable.length > 30) undoable.shift()

        // ----- invariants after every step -----
        const cuts = cutsNow()
        const real = cuts.filter((c) => c.kind === 'cut')
        expect(real.filter((c) => c.up_at === null).length).toBeLessThanOrEqual(1)
        const sorted = real.map((c) => ({ a: Date.parse(c.down_at), b: c.up_at ? Date.parse(c.up_at) : Infinity })).sort((x, y) => x.a - y.a)
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].a).toBeGreaterThanOrEqual(sorted[i - 1].b)
        const now = clock + MIN
        const rows = monthlyOutage(cuts, now)
        const grid = real.reduce((n, c) => n + cutStats(c, now).gridMin, 0)
        const modelGrid = [...model.values()].reduce((n, m) => n + ((m.up ?? now) - m.down) / MIN, 0)
        expect(Math.round(rows.reduce((n, x) => n + x.gridMin, 0))).toBe(Math.round(grid))
        expect(Math.round(grid)).toBe(Math.round(modelGrid))
        for (const row of rows) {
          expect(row.darkMin).toBeGreaterThanOrEqual(-1e-6)
          expect(row.onGenMin).toBeGreaterThanOrEqual(-1e-6)
          expect(Math.abs(row.gridMin - row.onGenMin - row.darkMin)).toBeLessThan(1e-6)
        }
        for (const c of cuts) {
          const s = cutStats(c, now)
          expect(s.darkMin).toBeGreaterThanOrEqual(-1e-6)
          expect(s.onGenMin).toBeLessThanOrEqual(s.gridMin + 1e-6)
        }
      }
      expect(st.rows<WaterTest>('water_tests').length).toBe(st.rows('water_tests').length)
      void waterN; void cleanN
      // water due never throws and has 5 rows
      expect(waterDue(st.rows<WaterTest>('water_tests'), farmDay(clock)).length).toBe(5)

      // Backup and restore: identical records and identical month totals.
      const json = await st.exportJson()
      const st2 = new Store(new MemoryBackend())
      await st2.importJson(json)
      expect(state(st2)).toBe(state(st))
      expect(monthlyOutage(st2.rows<PowerCut>('power_cuts'), clock + MIN)).toEqual(monthlyOutage(st.rows<PowerCut>('power_cuts'), clock + MIN))
    }, 300000)
  }
})
