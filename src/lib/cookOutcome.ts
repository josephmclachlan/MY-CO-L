// What happened to the load of a cook, afterwards: losses logged against the block lots and grain runs that came out of it.
import { hazardName, type HazardLog, type LotLoss } from './hazard'
import type { BlockLot, GrainRun } from './xeno'

export interface Outcome {
  lots: { lot: BlockLot; lost: number; causes: string[] }[]
  grain: { g: GrainRun; lost: number; causes: string[] }[]
  loaded: number
  lost: number
}

export function outcomeFor(runId: string, lots: BlockLot[], grain: GrainRun[], losses: LotLoss[], logs: HazardLog[]): Outcome {
  const cause = (keys: (string | null)[]) => [...new Set(keys.filter((k): k is string => !!k).map((k) => hazardName(k)))]
  const l = lots
    .filter((x) => x.cook_run_id === runId)
    .map((lot) => {
      const mine = losses.filter((q) => q.block_lot_id === lot.id)
      return { lot, lost: mine.reduce((n, q) => n + q.bag_count, 0), causes: cause(mine.map((q) => q.hazard_key)) }
    })
  const g = grain
    .filter((x) => x.cook_run_id === runId)
    .map((run) => ({ g: run, lost: run.bags_lost || 0, causes: cause(logs.filter((q) => q.source_kind === 'grain' && q.source_id === run.id).map((q) => q.hazard_key)) }))
  return {
    lots: l,
    grain: g,
    loaded: l.reduce((n, x) => n + x.lot.bag_count, 0) + g.reduce((n, x) => n + x.g.bag_count, 0),
    lost: l.reduce((n, x) => n + x.lost, 0) + g.reduce((n, x) => n + x.lost, 0),
  }
}

