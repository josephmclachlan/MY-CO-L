// FARM ASSISTANT rule brain: turns a typed sentence into ONE tool call, with no model at all.
//
// It is the fallback when no local model is running, and the fast path for the common sentences
// even when one is. It only knows the words below and the codes on file (lots, strains, buyers,
// stock items). Anything it cannot place returns null: the caller then asks the model, or refuses.

import { clean, findPeriod, findPlace, findRoom, findSpecies, numArg, type Args } from './core'
import { findSection } from './tools'

export interface Known {
  lots: string[]
  strains: string[]
  buyers: string[]
  items: string[]
}
export interface Parsed {
  tool: string
  args: Args
}

const NUM = String.raw`(-?\d+(?:[.,]\d+)?)`
const re = (s: string) => new RegExp(s)

const isQuestion = (t: string, raw: string) =>
  raw.trim().endsWith('?') || /^(how|what|whats|what's|who|whos|who's|which|when|where|is|are|was|were|did|do|does|has|have|had|can|could|any|tell|list|give|cuantos|cuanto|quien|que|cual|cuando|donde|hay)\b/.test(t)

function numberBefore(t: string, unit: string): number | null {
  const m = re(NUM + String.raw`\s*(?:${unit})(?![a-z0-9])`).exec(t)
  return m ? numArg(m[1]) : null
}

/** A code on file written anywhere in the sentence (B1020, b-1020, LM-01). */
function codeIn(raw: string, list: string[]): string | null {
  const flat = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const toks = raw.toUpperCase().split(/[\s,;:!?()]+/).map((x) => x.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, ''))
  const set = new Map(list.map((c) => [flat(c), c]))
  for (const tk of toks) {
    if (!tk) continue
    const hit = list.find((c) => c.toUpperCase() === tk) ?? set.get(flat(tk))
    if (hit) return hit
  }
  return null
}
/** Something shaped like a lot code even if it is not on file: one letter + 4 digits (+ -n). */
const lotShaped = (raw: string) => /\b([A-Za-z]\d{4}(?:-\d)?)\b/.exec(raw)?.[1]?.toUpperCase() ?? null
const strainShaped = (raw: string) => /\b([A-Za-z]{2}-\d{2})\b/.exec(raw)?.[1]?.toUpperCase() ?? null

function longestName(t: string, names: string[]): string | null {
  let best: string | null = null
  for (const n of names) {
    const c = clean(n)
    if (c.length >= 3 && ` ${t} `.includes(` ${c} `) && (!best || c.length > clean(best).length)) best = n
  }
  return best
}

export function parse(raw: string, k: Known): Parsed | null {
  const t = clean(raw).replace(/([a-z])-([a-z])/g, '$1 $2')
  if (!t) return null
  const q = isQuestion(t, raw)
  const lot = codeIn(raw, k.lots) ?? lotShaped(raw)
  const strain = codeIn(raw, k.strains) ?? strainShaped(raw)
  const sp = findSpecies(raw)?.key ?? null
  const period = findPeriod(raw)
  const place = findPlace(raw)
  const kg = numberBefore(t, 'kg|kgs|kilo|kilos|kilograms?')
  const lb = numberBefore(t, 'lb|lbs|pounds?')

  // ---- power events (saves) ----
  if (!q) {
    if (/\b(generator|genny|gen|planta)\b/.test(t) && /\b(on|started|start|running|switched on|arranco)\b/.test(t)) return { tool: 'log_power', args: { event: 'generator_on' } }
    if (/\b(generator|genny|gen|planta)\b/.test(t) && /\b(off|stopped|stop|switched off|apagada)\b/.test(t)) return { tool: 'log_power', args: { event: 'generator_off' } }
    if (/\b(power|grid|electricity|luz|ice)\b/.test(t) && /\b(back|restored|returned|on again|came back|volvio)\b/.test(t)) return { tool: 'log_power', args: { event: 'back' } }
    if (/\b(power|grid|electricity|luz)\b/.test(t) && /\b(out|off|down|cut|gone|failed|went|se fue)\b/.test(t) && !/\b(log|logs|hours|cuts)\b/.test(t)) return { tool: 'log_power', args: { event: 'out' } }
    if (/^(blackout|outage|apagon)( now)?$/.test(t)) return { tool: 'log_power', args: { event: 'out' } }
  }

  // ---- stock in / out (saves) ----
  const stockVerb = /\b(received|receive|delivered|delivery of|bought|got delivered|used|use|took|consumed)\b/.exec(t)
  if (stockVerb && !q && !lot) {
    const m = re(String.raw`\b(?:received|receive|delivered|delivery of|bought|got delivered|used|use|took|consumed)\s+` + NUM + String.raw`\s+(?:x\s+)?(.+)$`).exec(t)
    if (m) {
      const item = m[2].replace(/^(of|the)\s+/, '').replace(/\b(today|yesterday|this morning)\b/g, '').trim()
      const dir = /used|use|took|consumed/.test(stockVerb[1]) ? 'out' : 'in'
      return { tool: 'stock_move', args: { item: longestName(t, k.items) ?? item, qty: numArg(m[1]), direction: dir } }
    }
  }

  // ---- harvest (save) ----
  const harvestVerb = /\b(log|logged|add|record|enter|save|picked|harvested|pick|harvest|cosecha|cosechamos|got)\b/.test(t)
  if ((kg !== null || lb !== null) && !q && (harvestVerb || lot)) {
    const flush = /\bflush\s*(\d)\b/.exec(t)?.[1] ?? /\b(\d)(?:st|nd|rd|th)\s+flush\b/.exec(t)?.[1]
    const grade = /\bgrade\s*(a|b|seconds?)\b/.exec(t)?.[1] ?? (/\bseconds\b/.test(t) ? 'seconds' : undefined)
    const initials = /\bby\s+([a-z]{1,4})\b/.exec(t)?.[1]
    const day = /\byesterday\b/.test(t) ? 'yesterday' : /\b(\d{4}-\d{2}-\d{2})\b/.exec(t)?.[1]
    const args: Args = { kg: kg ?? undefined, lb: kg === null ? lb : undefined }
    if (lot) args.lot = lot
    else if (sp) args.species = sp
    if (flush) args.flush = Number(flush)
    if (grade) args.grade = grade
    if (initials) args.initials = initials
    if (day) args.day = day
    return { tool: 'log_harvest', args }
  }

  // ---- climate reading (save) ----
  const temp = numberBefore(t, '°\\s*c|c|celsius|degrees|deg') ?? numArg(/\btemp(?:erature)?\s*(?:is|of|at|=)?\s*(-?\d+(?:[.,]\d+)?)/.exec(t)?.[1])
  const tempF = numberBefore(t, '°\\s*f|f|fahrenheit')
  const rh = numberBefore(t, '%|percent') ?? numArg(/\b(?:rh|humidity)\s*(?:is|of|at|=)?\s*(\d+(?:[.,]\d+)?)/.exec(t)?.[1])
  const co2 = numberBefore(t, 'ppm') ?? numArg(/\bco2\s*(?:is|of|at|=)?\s*(\d+)/.exec(t)?.[1])
  if (place && !q && (temp !== null || tempF !== null || rh !== null || co2 !== null)) {
    const args: Args = { room: place }
    if (temp !== null) args.temp_c = temp
    else if (tempF !== null) args.temp_f = tempF
    if (rh !== null) args.rh = rh
    if (co2 !== null) args.co2_ppm = co2
    return { tool: 'log_reading', args }
  }

  // ---- lot status (save) ----
  if (lot && !q && /\b(mark|set|move|moved|make|is now|now)\b/.test(t)) {
    const st = /\b(spent|finished|done)\b/.test(t) ? 'spent' : /\b(lost|dead|binned|contaminated|thrown)\b/.test(t) ? 'lost' : /\bfruit/.test(t) ? 'fruiting' : /\bincubat/.test(t) ? 'incubating' : null
    if (st) return { tool: 'set_lot_status', args: { lot, status: st } }
  }

  // ---- buyer paid (save, owner only) ----
  if (!q && /\bpaid\b/.test(t)) {
    const named = longestName(t, k.buyers)
    const m = /^(?:mark\s+)?(.+?)\s+(?:as\s+)?(?:has\s+|just\s+)?paid\b/.exec(t)
    const buyer = named ?? m?.[1]?.replace(/^(the)\s+/, '')
    if (buyer) return { tool: 'mark_paid', args: { buyer, ...(/\byesterday\b/.test(t) ? { day: 'yesterday' } : {}) } }
  }

  // ---- open a screen ----
  const open = /^(show|open|go to|goto|take me to|display|view|bring up|abre|abrir|mostrar|ver|ir a)\s+(?:me\s+)?(.*)$/.exec(t)
  if (open) {
    const rest = open[2]
    if (lot && k.lots.includes(lot)) return { tool: 'lot_details', args: { lot } }
    if (strain && k.strains.includes(strain)) return { tool: 'strain_status', args: { strain } }
    const sec = findSection(rest)
    if (sec && !/\b(who|how|what|which)\b/.test(rest)) return { tool: 'open_screen', args: { section: sec.id } }
  }

  // ---- questions ----
  if (/\b(owe|owes|owed|owing|unpaid|debt|debts|hasn'?t paid|not paid|outstanding|deben|debe)\b/.test(t)) return { tool: 'who_owes', args: {} }
  if (/\b(sales|sold|sell|revenue|income|earned|takings|ventas|vendimos)\b/.test(t) && !lot) {
    const named = longestName(t, k.buyers)
    return { tool: 'sales_total', args: { period: period ?? 'this_month', ...(sp ? { species: sp } : {}), ...(named ? { buyer: named } : {}) } }
  }
  if (/\b(power|outage|outages|cut|cuts|blackout|blackouts|without power|grid|generator|apagon|cortes)\b/.test(t)) return { tool: 'power_cuts', args: { period: period ?? 'this_month' } }
  if (sp && !place && /\b(temp|temperature|temperatures|humidity|rh|co2|climate|fruit at|fruits at|fruiting temp|conditions|timeline|how long|days|weeks|yield|yields|substrate|spawn rate|supplement|hazards?|problems|diseases?)\b/.test(t) && !/\b(picked|harvested|lots?|blocks?)\b/.test(t)) {
    const topic = /\b(timeline|how long|days|weeks)\b/.test(t) ? 'timeline' : /\b(yield|yields)\b/.test(t) ? 'yield' : /\b(substrate|spawn rate|supplement)\b/.test(t) ? 'cultivation' : /\b(hazards?|problems|diseases?)\b/.test(t) ? 'hazards' : 'climate'
    return { tool: 'species_facts', args: { species: sp, topic } }
  }
  if (/\b(temp|temperature|temperatures|humid|humidity|rh|co2|climate|hot|cold|warm|alarm|alarms|sensor|sensors|reading|readings)\b/.test(t) && !/\b(stock|left)\b/.test(t)) return { tool: 'climate_now', args: place ? { room: place } : {} }
  if (/\b(due|to do|todo|jobs|needs doing|what needs|what should|pendiente|pendientes)\b/.test(t) || /^today\??$/.test(t)) return { tool: 'due_today', args: {} }
  if (/\b(stock|left|on hand|running out|run out|reorder|low|inventory|supplies|how much .* have)\b/.test(t) && !/\b(picked|harvested|lots?|blocks?)\b/.test(t)) {
    const named = longestName(t, k.items)
    const m = /\b(?:of|much|many)\s+(.+?)\s+(?:is |are |do |have |left|on hand|in stock|\?|$)/.exec(t)
    const item = named ?? m?.[1]?.replace(/^(the|we)\s+/, '')
    return { tool: 'stock_status', args: item && !/^(stock|left)$/.test(item) ? { item } : {} }
  }
  if (/\b(pick|picked|picking|harvest|harvested|harvests|kg|kilos|yield|produced|cosecha|cosechado)\b/.test(t)) return { tool: 'harvest_total', args: { ...(lot ? { lot } : sp ? { species: sp } : {}), ...(period ? { period } : {}) } }
  if (/\b(how many|count|number of|cuantos|cuantas)\b/.test(t) || /\b(lots?|blocks?|bags?|bloques|lotes)\b/.test(t)) {
    if (lot && !/\b(how many|count|number of)\b/.test(t)) return { tool: 'lot_details', args: { lot } }
    if (/\b(lots?|blocks?|bags?|bloques|lotes)\b/.test(t) || /\b(fruiting|incubating|spent|lost)\b/.test(t)) {
      const status = /\bfruiting\b/.test(t) ? 'fruiting' : /\bincubat/.test(t) ? 'incubating' : /\bspent\b/.test(t) ? 'spent' : /\b(lost|dead)\b/.test(t) ? 'lost' : /\b(all|ever|total)\b/.test(t) ? 'all' : 'active'
      const room = status === 'fruiting' || status === 'incubating' ? null : findRoom(raw)
      return { tool: 'count_lots', args: { ...(sp ? { species: sp } : {}), status, ...(room ? { room } : {}) } }
    }
  }
  if (lot) return { tool: 'lot_details', args: { lot } }
  if (strain) return { tool: 'strain_status', args: { strain } }
  if (sp && /^(about |tell me about |what about )?[a-z' ]+\??$/.test(t) && t.split(' ').length <= 4) return { tool: 'species_facts', args: { species: sp, topic: 'climate' } }
  const sec = findSection(t)
  if (sec && sec.words.includes(t)) return { tool: 'open_screen', args: { section: sec.id } }
  return null
}
