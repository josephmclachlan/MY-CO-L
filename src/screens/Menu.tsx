import { useEffect, useState } from 'react'
import { MODULES, STATION } from '../data/farm'
import { Wireframe } from '../components/Wireframe'
import { TypeText } from '../components/TypeText'

interface Props {
  selected: number
  setSelected: (n: number) => void
  onOpen: (n: number) => void
  firstShow: boolean
}

/** Main menu: numbered module list with the MY/CO/L logo in beside it. */
export function Menu({ selected, setSelected, onOpen, firstShow }: Props) {
  const [listReady, setListReady] = useState(!firstShow)

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
          lines={[`${STATION.station} // ${STATION.place}`, 'SELECT A MODULE. TYPE ITS NUMBER OR NAME AT THE PROMPT.']}
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
                onMouseEnter={() => setSelected(i)}
                onClick={() => onOpen(i)}
              >
                <span>{String(m.num).padStart(2, '0')}</span>
                <span className="mi-name">{m.name}</span>
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
