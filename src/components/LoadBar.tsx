import type { Level } from '../lib/power'

interface Props {
  label: string
  /** 0..1+ share of the limit. Above 1 the bar stays full and turns to warning. */
  share: number
  value: string
  level: Level
  /** Where the amber line sits, as a share (0.85). */
  near?: number
  /** Scale captions under the ticks, e.g. ['0', '31', '63', '94', '125 A']. */
  scale?: string[]
}

/** A read-only hatched meter with ticks, an amber line and a ceiling mark. */
export function LoadBar({ label, share, value, level, near = 0.85, scale }: Props) {
  const pct = Math.max(0, Math.min(1, share)) * 100
  return (
    <div className={`loadbar lv-${level}`} role="meter" aria-label={label} aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span className="lb-label">{label}</span>
      <span className="lb-track" style={{ ['--pct' as string]: `${pct}%` }}>
        <span className="lb-fill" />
        <span className="lb-near" style={{ left: `${near * 100}%` }} aria-hidden />
        <span className="meter-ticks" aria-hidden>
          {[0, 25, 50, 75, 100].map((t) => (
            <i key={t} style={{ left: `${t}%` }} />
          ))}
        </span>
        {scale && (
          <span className="lb-scale" aria-hidden>
            {scale.map((s, i) => (
              <b key={i} style={{ left: `${(i / (scale.length - 1)) * 100}%` }}>
                {s}
              </b>
            ))}
          </span>
        )}
      </span>
      <span className="lb-value">{value}</span>
    </div>
  )
}
