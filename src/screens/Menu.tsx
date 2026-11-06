import { useEffect, useState } from 'react'
import { MODULES, STATION } from '../data/farm'
import { Wireframe } from '../components/Wireframe'
import { TypeText } from '../components/TypeText'

/** Own little sign per module, in the spirit of the door-sign set. Original shapes only. */
const GLYPHS: Record<string, string> = {
  SPECIMEN: '\u25C8', VITALS: '\u25B2', DECK: '\u25A3', CARGO: '\u25A4', XENO: '\u2B21',
  HAZARD: '\u26A0', PROPULSION: '\u224B', LEDGER: '\u25EB', TRADE: '\u21C4', SEQUENCE: '\u25A6', MANUAL: '\u25A5', HISTORY: '\u21BA', YIELD: '\u2261', ORDERS: '\u21BB', MONEY: '\u20A1',
}

/** Rotating prompt line for return visits to the menu. Original wording. */
const GREETINGS = [
  'SELECT A MODULE. TYPE ITS NUMBER OR NAME AT THE PROMPT.',
  'LATTICE IS QUIET. SELECT A MODULE.',
  'ALL STATIONS REPORTING. AWAITING YOUR INPUT.',
  'THE CROP DOES NOT WAIT. SELECT A MODULE.',
  'SPORE COUNT NOMINAL. SELECT A MODULE.',
]

interface Props {
  selected: number
  setSelected: (n: number) => void
  onOpen: (n: number) => void
  firstShow: boolean
}

/** Main menu: numbered module list with the MY/CO/L logo in beside it. */
export function Menu({ selected, setSelected, onOpen, firstShow }: Props) {
  const [listReady, setListReady] = useState(!firstShow)
  const [greeting] = useState(() => (firstShow ? GREETINGS[0] : GREETINGS[Math.floor(Math.random() * GREETINGS.length)]))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.value) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((selected + 1) % MODULES.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((selected - 1 + MODULES.length) % MODULES.length)
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.value)) {
        e.preventDefault()
        onOpen(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, setSelected, onOpen])

  return (
    <div className="menu-grid">
      <div>
        <div className="section-title">MAIN MENU</div>
        <TypeText
          group={3}
          instant={!firstShow}
          className="dim"
          lines={[`${STATION.station} // ${STATION.place}`, greeting]}
          onDone={() => setListReady(true)}
        />
        {listReady && (
          <ul className="menu-list" role="listbox" aria-label="Modules">
            {MODULES.map((m, i) => (
              <li
                key={m.key}
                role="option"
                aria-selected={i === selected}
                className={`menu-item ${i === selected ? 'sel' : ''}`}
                tabIndex={0}
                onFocus={() => setSelected(i)}
                onMouseEnter={() => setSelected(i)}
                onClick={() => onOpen(i)}
              >
                <span>{String(m.num).padStart(2, '0')}</span>
                <span className="mi-name"><span className="mi-glyph" aria-hidden="true">{GLYPHS[m.key] ?? '\u25C7'}</span>{m.name}</span>
                <span className="mi-what">{m.what}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="menu-wire">
        <div className="spin" style={{ ['--spin-delay' as string]: firstShow ? '1.6s' : '0s' }}>
          <Wireframe size={190} instant={!firstShow} />
        </div>
        <span className="sign dim">LATTICE NODE 01</span>
      </div>
    </div>
  )
}
