// One breaker box, one generator (Joseph, 12 Nov 2026): "it's all on one panel, and we are gonna do the
// generator on that panel as well". Mock trials, expected numbers worked by hand, old saved boards,
// and a stress run of random flips. The board is a planning view saved on this device only
// (mycol.power.v1), not a farm record, so nothing here goes to the edit history.
import { describe, expect, it } from 'vitest'
import { allCircuits, BOX, EMERG, GENERATOR, SCENARIOS, scenarioIds, type Circuit, type Fuel, type HeaterOption } from '../data/power'
import { compute, generatorLegA, warnings, peakState, type PowerConfig } from './power'
import { migrateSaved } from '../power/PowerContext'
import { legOfSlot, slotsOf } from '../screens/Vitals'
import * as powerData from '../data/power'
import { rng } from './testkit'

const offPeak = peakState(new Date('2026-11-12T20:00:00Z')) // 14:00 Costa Rica, between the peaks
const cfg = (source: 'utility' | 'generator', fuel: Fuel = 'propane', heater: HeaterOption = '2x4500'): PowerConfig => ({
  heater,
  source,
  fuel,
  genW: GENERATOR.running[fuel],
  overrides: {},
})
const ids = (key: string, heater: HeaterOption = '2x4500') => new Set(scenarioIds(SCENARIOS.find((s) => s.key === key)!, heater))

describe('one box, no sub-panel', () => {
  it('has no sub-panel left in the model', () => {
    expect('SUB' in powerData).toBe(false)
    expect('MAIN' in powerData).toBe(false)
    expect('subFeedA' in powerData.SERVICE).toBe(false)
    for (const c of allCircuits('2x4500')) expect('panel' in c).toBe(false)
  })

  it('fills slots 1-32 exactly, each slot once (two loads share 5 and two share 9)', () => {
    const count = new Map<number, number>()
    for (const c of allCircuits('2x4500')) for (const s of slotsOf(c.tag)) count.set(s, (count.get(s) ?? 0) + 1)
    expect([...count.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1))
    for (const [slot, n] of count) expect(n, `slot ${slot}`).toBe(slot === 5 || slot === 9 ? 2 : 1)
  })

  it('heater option B uses 29-31 only and leaves 30-32 spare', () => {
    const tags = allCircuits('6500').flatMap((c) => slotsOf(c.tag))
    expect(tags).toContain(29)
    expect(tags).not.toContain(30)
    expect(tags).not.toContain(32)
  })

  it('every 120 V breaker is on the leg its slot gives, every 240 V one spans L1 and L2', () => {
    for (const c of allCircuits('2x4500')) {
      const sl = slotsOf(c.tag)
      if (c.v === 120) expect(c.leg, c.tag).toBe(legOfSlot(sl[0]))
      else expect(sl.map(legOfSlot).sort(), c.tag).toEqual(['L1', 'L2'])
    }
  })

  it("matches Joseph's slot list on what each slot feeds", () => {
    const want: Record<string, string[]> = {
      '1': ['m1'], '2': ['s5'], '3': ['s4'], '4': ['s6'], '5': ['stir', 'zvs'], '6': ['seal'], '7': ['s1'], '8': ['lab4'],
      '9': ['bag', 'ffuw'], '10': ['m2'], '11': ['s9'], '12': ['s2'], '13': ['s7'], '14': ['x75'], '15': ['incs4'], '16': ['f1'],
      '17': ['m3'], '18': ['f2'], '19': ['m4'], '20': ['o1'], '21-23': ['c78'], '22-24': ['c910'], '25-27': ['c34'], '26-28': ['c56'],
      '29-31': ['c12'], '30-32': ['c12b'],
    }
    const got: Record<string, string[]> = {}
    for (const c of allCircuits('2x4500')) (got[c.tag] ??= []).push(c.id)
    for (const k of Object.keys(got)) got[k].sort()
    expect(got).toEqual(want)
    const item = (id: string) => BOX.flatMap((c) => c.items).find((i) => i.id === id)!
    expect(item('t5').qty).toBe(16) // 13: the ActiveGrow T5s
    expect(item('hurricane').qty).toBe(2) // 12: Hurricanes on the fruiting CO2 meter
    expect(BOX.find((c) => c.tag === '7')!.items.map((i) => i.id).sort()).toEqual(['co2-inc', 'co2-pack', 'inkbird', 's10', 's8', 'tac'])
  })
})

describe('generator: DuroMax XP17500HX on the same box', () => {
  it("carries the maker's ratings for each fuel", () => {
    expect(GENERATOR.model).toBe('DUROMAX XP17500HX')
    expect(GENERATOR.running).toEqual({ gasoline: 13750, propane: 13000 })
    expect(GENERATOR.starting).toEqual({ gasoline: 17500, propane: 16500 })
  })

  it('one 50 A cord caps each leg at 50 A on either fuel', () => {
    // 13,000 / 240 = 54.2 A and 13,750 / 240 = 57.3 A, both above the cord.
    expect(generatorLegA(GENERATOR.running.propane)).toBe(50)
    expect(generatorLegA(GENERATOR.running.gasoline)).toBe(50)
    expect(generatorLegA(9000)).toBeCloseTo(37.5, 6)
  })

  it('the plan (emergency list + both 12ks) fits: worked by hand', () => {
    // Emergency list 4,045 W, L1 8.4 A, L2 25.3 A; each 12k adds 1,000 / 240 = 4.17 A to both legs.
    const r = compute(ids('g12s'), cfg('generator'))
    expect(Math.round(r.watts)).toBe(6045)
    expect(r.l2).toBeCloseTo(25.3 + 8.33, 0)
    expect(r.legA).toBe(50)
    expect(r.share).toBeCloseTo(r.l2 / 50, 6) // the leg, not the watts (46%), is the tighter limit
    expect(r.level).toBe('ok')
    expect(warnings(ids('g12s'), cfg('generator'), r, offPeak).filter((w) => w.level === 'warn')).toEqual([])
  })

  it('the 6.5 kW heater on the generator fits the watts but not the cord', () => {
    const on = ids('gboil', '6500')
    const r = compute(on, cfg('generator', 'propane', '6500'))
    expect(r.wattShare).toBeLessThan(1) // 10,545 W of 13,000
    expect(r.worst).toBeGreaterThan(50) // L2 52.4 A
    expect(r.level).toBe('over')
    const w = warnings(on, cfg('generator', 'propane', '6500'), r, offPeak).map((x) => x.id)
    expect(w).toContain('genleg')
    expect(w).not.toContain('genover')
    expect(w).toContain('gensteam')
  })

  it('gasoline gives more watts but the same 50 A per leg', () => {
    const on = ids('gmax')
    const lp = compute(on, cfg('generator', 'propane'))
    const gas = compute(on, cfg('generator', 'gasoline'))
    expect(gas.wattShare).toBeLessThan(lp.wattShare)
    expect(gas.legA).toBe(lp.legA)
  })

  it('switching to the generator does not change what each breaker draws', () => {
    const on = new Set(EMERG)
    const u = compute(on, cfg('utility'))
    const g = compute(on, cfg('generator'))
    expect(g.l1).toBe(u.l1)
    expect(g.l2).toBe(u.l2)
    expect(u.legA).toBe(0)
  })
})

describe('old saved boards (history resilience)', () => {
  it('a board saved on the old main + sub-panel map starts again from its preset', () => {
    const old = JSON.stringify({ on: ['s1', 's2', 's3', 's8', 's10', 'c34'], heater: '2x4500', source: 'utility', fuel: 'propane', genW: 11400, preset: 'duromax', overrides: { tac: 350 }, scenario: 'base' })
    const s = migrateSaved(old)
    expect(new Set(s.on)).toEqual(ids('base'))
    expect(s.genW).toBe(13000)
    expect('preset' in s).toBe(false)
    expect(s.overrides).toEqual({ tac: 350 }) // watts Joseph typed are kept
  })

  it('an old generator board with a slider value comes back on the XP17500HX', () => {
    const s = migrateSaved(JSON.stringify({ on: ['s1', 's3'], source: 'generator', fuel: 'gasoline', genW: 7500, preset: 'g7500', scenario: null }))
    expect(s.genW).toBe(13750)
    expect(new Set(s.on)).toEqual(ids('g12s'))
    expect(s.scenario).toBe('g12s')
  })

  it('a board saved on the new map is kept as it was', () => {
    const on = ['m1', 's1', 'c78']
    const s = migrateSaved(JSON.stringify({ on, heater: '6500', source: 'utility', fuel: 'propane', scenario: null }))
    expect(s.on).toEqual(on)
    expect(s.heater).toBe('6500')
  })

  it('junk or nothing gives the defaults', () => {
    for (const raw of [null, '', '{', 'null', '[]', '{"on":"x","fuel":"diesel","heater":"9000"}']) {
      const s = migrateSaved(raw)
      expect(s.genW).toBe(GENERATOR.running[s.fuel])
      expect(['2x4500', '6500']).toContain(s.heater)
      expect(Array.isArray(s.on)).toBe(true)
    }
  })
})

describe('stress: 5,000 random flips, sources, fuels and heaters', () => {
  it('holds every invariant', () => {
    const rand = rng(1112).next
    let heater: HeaterOption = '2x4500'
    let source: 'utility' | 'generator' = 'utility'
    let fuel: Fuel = 'propane'
    let on = new Set<string>()
    let checks = 0
    for (let step = 0; step < 5000; step++) {
      const x = rand()
      if (x < 0.05) source = source === 'utility' ? 'generator' : 'utility'
      else if (x < 0.08) fuel = fuel === 'propane' ? 'gasoline' : 'propane'
      else if (x < 0.1) {
        heater = heater === '2x4500' ? '6500' : '2x4500'
        if (heater === '6500') on.delete('c12b')
      } else if (x < 0.13) {
        const pool = SCENARIOS.filter((s) => !s.only || s.only === heater)
        const sc = pool[Math.floor(rand() * pool.length)]
        on = new Set(scenarioIds(sc, heater))
        source = sc.source
      } else {
        const cs: Circuit[] = allCircuits(heater)
        const c = cs[Math.floor(rand() * cs.length)]
        if (on.has(c.id)) on.delete(c.id)
        else on.add(c.id)
      }
      const c = cfg(source, fuel, heater)
      const r = compute(on, c)
      // Hand sum: 240 V loads split W/240 on both legs, 120 V loads W/120 on their own leg.
      let l1 = 0
      let l2 = 0
      for (const k of allCircuits(heater)) {
        if (!on.has(k.id)) continue
        const w = k.items.reduce((n, i) => n + i.w, 0)
        if (k.leg === 'B') (l1 += w / 240), (l2 += w / 240)
        else if (k.leg === 'L1') l1 += w / 120
        else l2 += w / 120
      }
      expect(r.l1).toBeCloseTo(l1, 6)
      expect(r.l2).toBeCloseTo(l2, 6)
      if (source === 'generator') {
        expect(r.legA).toBe(50)
        expect(r.share).toBeCloseTo(Math.max(r.watts / GENERATOR.running[fuel], r.worst / 50), 9)
        const w = warnings(on, c, r, offPeak).map((q) => q.id)
        expect(w.includes('genleg')).toBe(r.worst > 50)
        expect(w.includes('genover')).toBe(r.watts > GENERATOR.running[fuel])
        expect(r.level === 'over').toBe(r.share > 1)
      } else {
        expect(r.legA).toBe(0)
        expect(r.share).toBeCloseTo(r.worst / 155, 9)
      }
      expect(Number.isFinite(r.share)).toBe(true)
      checks++
    }
    expect(checks).toBe(5000)
  })
})
