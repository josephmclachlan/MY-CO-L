import type { ChangeEvent } from 'react'

interface Props {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  disabled?: boolean
}

/** A hatched meter with tick marks that doubles as a slider. */
export function Meter({ label, value, min = 0, max = 1, step = 0.01, onChange, format, disabled }: Props) {
  const pct = ((value - min) / (max - min)) * 100
  const shown = format ? format(value) : `${Math.round(pct)}`
  return (
    <label className={`meter ${disabled ? 'disabled' : ''}`}>
      <span className="meter-label">{label}</span>
      <span className="meter-track" style={{ ['--pct' as string]: `${pct}%` }}>
        <span className="meter-fill" />
        <span className="meter-ticks" aria-hidden>
          {[0, 25, 50, 75, 100].map((t) => (
            <i key={t} style={{ left: `${t}%` }} />
          ))}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
          aria-label={label}
        />
      </span>
      <span className="meter-value">{shown}</span>
    </label>
  )
}
