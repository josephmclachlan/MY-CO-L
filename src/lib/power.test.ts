// Reproduces every row of Joseph's data/operating_scenarios.csv (electrical
// package, 4 Nov 2026) from src/data/power.ts. Every column is compared:
// total watts, L1, L2, worst leg, % of limit, feeder drop, volts at panel, status.
// Run with: npm test
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASE, EMERG, MEGACHEFS, allCircuits, HEATER_OPTIONS, type HeaterOption } from '../data/power'
import { CEILING_A } from '../data/power'
import { feederDropV, generatorStatus, legs, ownedGeneratorShare, utilityStatus, compute, peakState, warnings } from './power'
import { SCENARIOS, scenarioIds } from '../data/power'

const csvPath = join(__dirname, '..', 'data', 'electrical', 'operating_scenarios.csv')

function parseLine(l: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (const ch of l) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

const rows = readFileSync(csvPath, 'utf8')
  .replace(/^﻿/, '')
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map(parseLine)

/** Breakers on for a CSV row, built the same way as the package's build_data.py. */
function idsFor(opt: HeaterOption, source: string, name: string): string[] | null {
  const heatAll = HEATER_OPTIONS[opt].elements.map((e) => e.id)
  const heatOne = ['c12']
  if (source === 'Utility') {
    const map: Record<string, string[]> = {
      'Baseline (continuous loads)': BASE,
      'Baseline + heater, full': [...BASE, ...heatAll],
      'Baseline + heater, staged hold (element 2 off)': [...BASE, ...heatOne],
      'Baseline + 4 MegaChefs': [...BASE, ...MEGACHEFS],
      'Baseline + All American 75X': [...BASE, 'x75'],
      'Baseline + bagger & pump': [...BASE, 'bag', 'pump'],
      'Baseline + bagger, pump & sealer (sealer worst case)': [...BASE, 'bag', 'pump', 'seal'],
      'RULE BROKEN: heater full + 4 MegaChefs': [...BASE, ...heatAll, ...MEGACHEFS],
      'THEORETICAL: everything on at once': allCircuits(opt).map((c) => c.id),
    }
    return map[name] ?? null
  }
  const map: Record<string, string[]> = {
    'Emergency baseline': EMERG,
    'Emergency + 36k mini-split #1': [...EMERG, 'c34'],
    'Emergency + 36k + 12k': [...EMERG, 'c34', 'c78'],
    'Emergency + heater (1 element)': [...EMERG, ...heatOne],
    'Emergency + 6,500 W heater': [...EMERG, ...heatOne],
    'Emergency + BOTH heater elements': [...EMERG, ...heatAll],
    'Emergency + bagger & pump': [...EMERG, 'bag', 'pump'],
    'Emergency + heater + 36k': [...EMERG, ...heatOne, 'c34'],
  }
  return map[name] ?? null
}

// toFixed rounds the exact stored value, like Python's round(), so 71.85 (stored as 71.8499...) gives 71.8.
const r1 = (n: number) => String(Number(n.toFixed(1)))
const pct0 = (n: number) => `${n.toFixed(0)}%`

describe('operating_scenarios.csv', () => {
  it('has 30 rows', () => {
    expect(rows.length).toBe(30)
  })

  const diffs: string[] = []
  for (const r of rows) {
    const [opt, source, name, totalW, l1A, l2A, worstA, pctLimit, dropPct, volts, status] = r
    it(`${opt} | ${source} | ${name}`, () => {
      const ids = idsFor(opt as HeaterOption, source, name)
      expect(ids, 'scenario is mapped').not.toBeNull()
      const { l1, l2, watts } = legs(new Set(ids!), opt as HeaterOption)
      const worst = Math.max(l1, l2)
      const got: string[] = [String(Math.round(watts)), r1(l1), r1(l2), r1(worst)]
      const want: string[] = [totalW, l1A, l2A, worstA]
      if (source === 'Utility') {
        const vd = feederDropV(worst)
        got.push(pct0((worst / CEILING_A) * 100), `${((vd / 240) * 100).toFixed(2)}%`, (240 - vd).toFixed(1), utilityStatus(worst).status)
        want.push(pctLimit, dropPct, volts, status)
      } else {
        const g = ownedGeneratorShare(watts)
        got.push(`${pct0(g.propane)} LP / ${pct0(g.gasoline)} gas`, '', '', generatorStatus(g.propane).status)
        want.push(pctLimit, dropPct, volts, status)
      }
      // Python prints 234.9 as "234.9" and 233.0 as "233.0"; compare as numbers where numeric.
      const norm = (s: string) => (s !== '' && /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s)
      if (got.map(norm).join('|') !== want.map(norm).join('|')) diffs.push(`${opt} ${source} ${name}: got ${got.join(', ')} want ${want.join(', ')}`)
      expect(got.map(norm)).toEqual(want.map(norm))
    })
  }

  it('0 differences in total', () => {
    expect(diffs).toEqual([])
  })
})

describe('on-screen scenario presets', () => {
  it('match the CSV scenarios they stand for', () => {
    const check = (key: string, opt: HeaterOption, worst: number) => {
      const s = SCENARIOS.find((x) => x.key === key)!
      const r = compute(new Set(scenarioIds(s, opt)), { heater: opt, source: s.source, fuel: 'propane', genW: 11400, overrides: {} })
      expect(r1(r.worst)).toBe(String(worst))
    }
    check('base', '2x4500', 53.8)
    check('heatfull', '2x4500', 91.3)
    check('heatfull', '6500', 80.9)
    check('heatstage', '2x4500', 72.5)
    check('bad', '2x4500', 111.3)
    check('all', '2x4500', 131.3)
    check('all', '6500', 120.9)
    check('gmax', '6500', 52.2)
  })

  it('every circuit watt total matches the package', () => {
    const want: Record<string, number> = { s3: 620, s5: 360, s6: 450, s8: 112, s9: 210, s10: 240, s7: 384, s4: 450 }
    for (const c of allCircuits('2x4500')) {
      if (want[c.id] !== undefined) expect(Math.round(c.items.reduce((n, i) => n + i.w, 0) * 1000) / 1000).toBe(want[c.id])
    }
  })
})

describe('operating rules', () => {
  const cfg = (source: 'utility' | 'generator', heater: HeaterOption = '2x4500') => ({ heater, source, fuel: 'propane' as const, genW: 11400, overrides: {} })
  const offPeak = peakState(new Date('2026-11-05T21:00:00Z')) // 15:00 in Costa Rica
  const inPeak = peakState(new Date('2026-11-05T17:00:00Z')) // 11:00 in Costa Rica
  const ids = (key: string, opt: HeaterOption = '2x4500') => new Set(scenarioIds(SCENARIOS.find((s) => s.key === key)!, opt))
  const run = (on: Set<string>, c: ReturnType<typeof cfg>, p = offPeak) => warnings(on, c, compute(on, c), p).map((w) => w.id)

  it('reads Costa Rica time for the ICE peak windows', () => {
    expect(offPeak.inPeak).toBe(false)
    expect(inPeak.inPeak).toBe(true)
    expect(inPeak.window).toEqual({ from: '10:00', to: '12:30' })
  })
  it('baseline breaks no rule', () => {
    expect(run(ids('base'), cfg('utility'))).toEqual([])
  })
  it('heater + MegaChefs trips the heat lockout', () => {
    expect(run(ids('bad'), cfg('utility'))).toContain('heatlock')
  })
  it('heater during an ICE peak window is flagged', () => {
    expect(run(ids('heatfull'), cfg('utility'), inPeak)).toContain('peak')
    expect(run(ids('heatfull'), cfg('utility'), offPeak)).not.toContain('peak')
  })
  it('generator: heater + AC and overload are flagged', () => {
    const w = run(ids('gmax', '6500'), cfg('generator', '6500'))
    expect(w).toContain('genheatac')
    expect(w).toContain('genover')
    expect(run(ids('gboilall'), cfg('generator'))).toContain('genboth')
  })
  it('estimated wattage overrides change the load', () => {
    const on = ids('base')
    const r = compute(on, { ...cfg('utility'), overrides: { lennox36a: 3480, lennox36b: 3480 } })
    // Brief section 14: at 3,480 W each, every scenario rises about 2.3 A per leg.
    expect(r.l1 - 53.8).toBeGreaterThan(2.2)
    expect(r.l1 - 53.8).toBeLessThan(2.4)
  })
})
