import type { Kind } from '../data/hazards/types'

/** Simple line-art glyph per hazard category. Own drawings, same family as the genetics glyphs. */
export function HazardGlyph({ kind, size = 20, className = '' }: { kind: Kind; size?: number; className?: string }) {
  return (
    <svg className={`xg-mini xg-glyph hz-glyph ${className}`} width={size} height={size} viewBox="-14 -14 28 28" aria-hidden>
      {body(kind)}
    </svg>
  )
}

function body(kind: Kind) {
  switch (kind) {
    case 'mould': // a spore puff: round body with hyphae reaching out
      return (
        <>
          <circle r="4" />
          <path d="M0 -4V-11 M0 4V11 M-4 0H-11 M4 0H11 M-3 -3L-8 -8 M3 -3L8 -8 M-3 3L-8 8 M3 3L8 8" />
          <circle cx="0" cy="-12" r="1.2" />
          <circle cx="12" cy="0" r="1.2" />
          <circle cx="-12" cy="0" r="1.2" />
        </>
      )
    case 'bacteria': // two rods with flagella
      return (
        <>
          <rect x="-11" y="-7" width="13" height="6" rx="3" />
          <path d="M2 -4Q6 -8 9 -4T13 -4" className="xg-faint" />
          <rect x="-6" y="3" width="13" height="6" rx="3" />
          <path d="M-6 6Q-9 3 -12 6T-14 6" className="xg-faint" />
        </>
      )
    case 'yeast': // a budding cell
      return (
        <>
          <circle cx="-2" cy="2" r="8" />
          <circle cx="8" cy="-7" r="4" />
          <circle cx="-2" cy="2" r="2" className="xg-faint" />
        </>
      )
    case 'pest': // an insect seen from above
      return (
        <>
          <ellipse cy="3" rx="4.5" ry="7" />
          <circle cy="-6" r="3" />
          <path d="M-2 -8L-6 -13 M2 -8L6 -13 M-4 0L-11 -3 M4 0L11 -3 M-4 4L-11 6 M4 4L11 6 M-3 8L-8 12 M3 8L8 12" />
        </>
      )
    case 'disease': // a mushroom cap with lesions
      return (
        <>
          <path d="M-11 1A11 10 0 0 1 11 1Z" />
          <path d="M-3 1V11H3V1" />
          <circle cx="-4" cy="-3" r="1.6" />
          <circle cx="3" cy="-5" r="1.2" />
          <circle cx="5" cy="-1" r="1.6" />
        </>
      )
    case 'water': // a drop with ripples
      return (
        <>
          <path d="M0 -12C5 -5 8 -1 8 3A8 8 0 0 1 -8 3C-8 -1 -5 -5 0 -12Z" />
          <path d="M-4 4A4 4 0 0 0 0 8" className="xg-faint" />
          <path d="M-12 12H12" className="xg-faint" />
        </>
      )
    case 'other': // a gauge: the process went out of range
      return (
        <>
          <path d="M-11 6A11 11 0 0 1 11 6" />
          <path d="M0 6L6 -4" />
          <circle cy="6" r="1.8" />
          <path d="M-8 6H-11 M8 6H11 M-6 -2L-8 -4 M6 -2L8 -4 M0 -5V-8" className="xg-faint" />
        </>
      )
    case 'notcontam': // an eye: looks wrong, check again
      return (
        <>
          <path d="M-12 0Q0 -10 12 0Q0 10 -12 0Z" />
          <circle r="3.6" />
          <circle r="1" />
        </>
      )
  }
}
