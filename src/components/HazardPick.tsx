import { HAZARDS } from '../data/hazards'
import { KIND_LABEL, KIND_ORDER, lossPickList } from '../lib/hazard'

/**
 * "What was it?" — picks a HAZARD INDEX entry to log a loss against.
 * Empty value = not sure. Look-alikes are left out: those are not losses.
 */
export function HazardPick({ value, onChange, label = 'What was it' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const list = lossPickList(HAZARDS)
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="hz-pick">
      <option value="">NOT SURE WHAT IT WAS</option>
      {KIND_ORDER.map((k) => {
        const items = list.filter((h) => h.kind === k)
        return items.length ? (
          <optgroup key={k} label={KIND_LABEL[k]}>
            {items.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </optgroup>
        ) : null
      })}
    </select>
  )
}
