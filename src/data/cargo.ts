// CARGO starter list. Every item comes from Joseph's own files (the textbook and
// farm notes). Counts, reorder points, lead times and prices start EMPTY: they
// are for Joseph to type, because no source states them for this site.
// Suppliers are only filled where textbook chapter t23 names one. Most t23
// suppliers are in the US, so check shipping and duty before relying on them.

import type { RoomId } from './power'

export const CATEGORIES = ['SUBSTRATE', 'GRAIN AND SPAWN', 'CULTURE LAB', 'CLEANING AND PPE', 'AIR AND WATER'] as const
export type Category = (typeof CATEGORIES)[number]

export interface SeedItem {
  code: string
  name: string
  category: Category
  unit: string
  room: RoomId
  supplier?: string
  /** Where the item comes from in the sources. */
  notes: string
}

export const SEED_ITEMS: SeedItem[] = [
  // SUBSTRATE: Master's Mix is 50:50 hardwood sawdust : soy hulls (t10). Room guesses follow DECK PLAN.
  { code: 'SAWDUST', name: 'Hardwood sawdust or fuel pellets', category: 'SUBSTRATE', unit: 'kg', room: 'packing', notes: 'Half of Master\'s Mix (t10). Red oak is the standard. Counted dry, in kg.' },
  { code: 'SOY-HULL', name: 'Soy hulls', category: 'SUBSTRATE', unit: 'kg', room: 'packing', notes: 'Other half of Master\'s Mix; never more than 50% (t10). Soy hulls are a US input, so find a local supplier. Counted in kg.' },
  { code: 'COMBO', name: 'Combo pellets 50:50 (red oak + soy hull)', category: 'SUBSTRATE', unit: 'kg', room: 'packing', supplier: 'Cap n Stem (t23); also Mushroom Media Online (t23)', notes: 'Use these INSTEAD of separate sawdust and soy hulls. Switch CARGO to COMBO PELLETS so weekly use books against this item.' },

  // GRAIN AND SPAWN
  { code: 'GRAIN', name: 'Grain, dry (rye, millet or oats)', category: 'GRAIN AND SPAWN', unit: 'kg', room: 'packing', notes: 'Rye is the forgiving standard, millet gives the most inoculation points, oats are easiest to hydrate (t09). Counted dry, in kg.' },
  { code: 'SPAWN-BAG', name: 'Spawn bags with filter patch (G1 4 lb, G2 6 lb)', category: 'GRAIN AND SPAWN', unit: 'bags', room: 'lab', supplier: 'Unicorn Bags (t23)', notes: 'One bag per G1 master and per G2 (t09).' },
  { code: 'BAG-10', name: 'Grow bags, 10 lb, filter patch (XLS-A)', category: 'GRAIN AND SPAWN', unit: 'bags', room: 'packing', supplier: 'Unicorn Bags (t23)', notes: 'XLS-A is most farms\' standard for a 10 lb block (t23).' },

  // CULTURE LAB
  { code: 'AGAR', name: 'Agar powder', category: 'CULTURE LAB', unit: 'g', room: 'lab', notes: 'Agar is the jelly; nutrients come from malt or potato plus a little yeast (t07).' },
  { code: 'MALT', name: 'Malt extract (for MYA / MEA)', category: 'CULTURE LAB', unit: 'g', room: 'lab', notes: 'Malt agar suits slow strains and comb tooth (t07). Recipe amounts are not in the sources.' },
  { code: 'YEAST', name: 'Yeast (for MYA)', category: 'CULTURE LAB', unit: 'g', room: 'lab', notes: '"A little yeast" in malt yeast agar (t07).' },
  { code: 'PETRI', name: 'Petri dishes', category: 'CULTURE LAB', unit: 'plates', room: 'lab', supplier: 'Tip of the Cap, poured plates (t23)', notes: 't23 gives about US$1 per plate from Tip of the Cap.' },
  { code: 'PARAFILM', name: 'Parafilm (plate sealing film)', category: 'CULTURE LAB', unit: 'rolls', room: 'lab', notes: 'Named in t23.' },

  // CLEANING AND PPE
  { code: 'GLOVES', name: 'Gloves (lab)', category: 'CLEANING AND PPE', unit: 'boxes', room: 'lab', notes: 'Required in a production lab (t04). Glove type is not stated in the sources.' },
  { code: 'ALCOHOL', name: 'Isopropyl alcohol 70%', category: 'CLEANING AND PPE', unit: 'L', room: 'lab', notes: '70% isopropyl for surfaces, gloves, bag ends, tools (t04). Never spray it into a HEPA.' },
  { code: 'BLEACH', name: 'Bleach (cleaning, 400 ppm at most)', category: 'CLEANING AND PPE', unit: 'L', room: 'fruiting', notes: 'Cleaning up to about 400 ppm; 150-250 ppm in humidifier water. Never mix with ammonia (t18).' },
  { code: 'MASKS', name: 'Face masks (lab)', category: 'CLEANING AND PPE', unit: 'boxes', room: 'lab', supplier: 'Uline (t23)', notes: 'Lab masks protect the product, not the worker (t18).' },
  { code: 'TYVEK', name: 'Tyvek suits or lab gowns', category: 'CLEANING AND PPE', unit: 'suits', room: 'lab', notes: 'Mandatory in the spawn lab (t04). Tyvek is named in t23.' },
  { code: 'RESPIRATOR', name: 'Respirators or cartridges (spores)', category: 'CLEANING AND PPE', unit: 'pcs', room: 'packing', notes: 'Worn when harvesting. No type or rating is given in the sources, so choose with a safety supplier (t18).' },

  // AIR AND WATER
  { code: 'HEPA', name: 'HEPA filters (for the 3 lab FFUs)', category: 'AIR AND WATER', unit: 'pcs', room: 'lab', supplier: 'Filter Sales USA (t23)', notes: 't23 gives about US$850 per FFU bought direct. Never spray liquid into a HEPA (t04).' },
  { code: 'PREFILTER', name: 'Pre-filters (coarse, ahead of HEPA)', category: 'AIR AND WATER', unit: 'pcs', room: 'lab', notes: 'Coarse pre-filters sit behind the HEPA fans (t04).' },
  { code: 'WATER-SED', name: 'Water filter, physical (sediment)', category: 'AIR AND WATER', unit: 'pcs', room: 'fruiting', notes: 'First stage of water treatment: physical filter, softener if hard, carbon (t05).' },
  { code: 'WATER-CARBON', name: 'Water filter, carbon', category: 'AIR AND WATER', unit: 'pcs', room: 'fruiting', notes: 'Carbon scrub stage (t05).' },
  { code: 'RO-MEMBRANE', name: 'RO membrane or RO filter set', category: 'AIR AND WATER', unit: 'pcs', room: 'fruiting', notes: 'RO feeds the TAC humidifier (t05).' },
  { code: 'UV-LAMP', name: 'UV lamp, inline water', category: 'AIR AND WATER', unit: 'pcs', room: 'fruiting', notes: 'Check UV bulbs on a schedule; a dead lamp let bacteria into humidifier water (t05).' },
]
