// Every species' growth model, by species id.
import type { SpecimenModel } from './registry'
import { chestnut } from './forms/chestnut'
import { blueOyster, phoenixOyster, pinkOyster } from './forms/oyster'
import { goldenOyster } from './forms/golden'
import { blackPearl } from './forms/blackpearl'
import { kingOyster } from './forms/king'
import { shiitake } from './forms/shiitake'
import { pioppino } from './forms/pioppino'
import { combTooth, lionsMane } from './forms/hericium'
import { maitake } from './forms/maitake'
import { reishi } from './forms/reishi'
import { cordyceps } from './forms/cordyceps'

export const MODELS: Record<string, SpecimenModel> = {
  chestnut,
  'blue-oyster': blueOyster,
  'pink-oyster': pinkOyster,
  'phoenix-oyster': phoenixOyster,
  'golden-oyster': goldenOyster,
  'black-pearl': blackPearl,
  'king-oyster': kingOyster,
  shiitake,
  pioppino,
  'lions-mane': lionsMane,
  'comb-tooth': combTooth,
  maitake,
  reishi,
  cordyceps,
}
