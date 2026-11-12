import { useEffect, useState } from 'react'
import { STATION } from '../data/farm'
import { Wireframe } from '../components/Wireframe'
import { TypeText } from '../components/TypeText'
import { Emblem } from '../components/Emblem'
import { StatusBoard } from './Facility'
import { useT } from '../settings/useT'
import { useRole } from '../settings/RoleContext'
import { useNag } from './Data'
import { visibleDecks, type DeckId } from '../nav/decks'
import { usePulse } from '../nav/useDeckPulse'

/** Rotating prompt line for return visits to the menu. Original wording. */
const GREETINGS = [
  'SELECT A DECK. TYPE ITS NUMBER OR NAME AT THE PROMPT.',
  'LATTICE IS QUIET. SELECT A DECK.',
  'ALL STATIONS REPORTING. AWAITING YOUR INPUT.',
  'THE CROP DOES NOT WAIT. SELECT A DECK.',
  'SPORE COUNT NOMINAL. SELECT A DECK.',
]

interface Props {
  selected: DeckId
  setSelected: (d: DeckId) => void
  onOpen: (d: DeckId) => void
  /** Opens the backup screen (DATA VAULT). */
  onBackup: () => void
  /** Opens the reminders and status board (ENGINEERING > REMINDERS). */
  onStatus: () => void
  firstShow: boolean
}

/** Main menu: the 8 decks, each with its emblem, plain words, a live figure and any alerts. The logo beside them. */
export function Menu({ selected, setSelected, onOpen, onBackup, onStatus, firstShow }: Props) {
  const { t, tf } = useT()
  const pulse = usePulse()
  const role = useRole()
  const nag = useNag()
  const [listReady, setListReady] = useState(!firstShow)
  const [greeting] = useState(() => (firstShow ? GREETINGS[0] : GREETINGS[Math.floor(Math.random() * GREETINGS.length)]))
  // Only the decks this person may open (staff do not see TRADE DOCK or BURSAR).
  const shown = visibleDecks(role.canOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.value) return
      if (!shown.length) return
      const at = Math.max(0, shown.findIndex((d) => d.id === selected))
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected(shown[(at + 1) % shown.length].id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected(shown[(at - 1 + shown.length) % shown.length].id)
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.value)) {
        e.preventDefault()
        onOpen(shown[at].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, setSelected, onOpen, shown.length, role.role]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // menu-cq: a size container, so the menu fits the space it is given, not the window (narrow desktop windows).
    <div className="menu-cq">
    <div className="menu-grid">
      <div>
        <div className="section-title">{t('MAIN MENU')}</div>
        <TypeText group={3} instant={!firstShow} className="dim" lines={[`${STATION.station} // ${STATION.place}`, t(greeting)]} onDone={() => setListReady(true)} />
        {listReady && (
          <ul className="menu-list dk-menu" role="listbox" aria-label="Decks">
            {shown.map((d, i) => {
              const alerts = pulse.alerts[d.id] ?? 0
              return (
                <li
                  key={d.id}
                  role="option"
                  aria-selected={d.id === selected}
                  className={`menu-item dk-mi ${d.id === selected ? 'sel' : ''} ${alerts ? 'has-alert' : ''}`}
                  style={{ ['--i' as string]: i }}
                  tabIndex={0}
                  data-tip={`${d.name}: ${d.sub}.`}
                  onFocus={() => setSelected(d.id)}
                  onMouseEnter={() => setSelected(d.id)}
                  onClick={() => onOpen(d.id)}
                >
                  <span className="dk-mi-num">{d.num}</span>
                  <Emblem id={d.id} size={34} draw={firstShow} alert={alerts > 0} className="dk-mi-em" />
                  <span className="dk-mi-text">
                    <span className="dk-mi-name">{t(d.name)}</span>
                    <span className="dk-mi-sub">{t(d.sub)}</span>
                  </span>
                  <span className="dk-mi-fig">
                    {pulse.fig[d.id]}
                    {alerts > 0 && (
                      <b className="dk-mi-alert" title={pulse.alertText[d.id]}>
                        ! {pulse.alertText[d.id] || alerts}
                      </b>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {listReady && role.role === 'owner' && nag.warn && (
          <button type="button" className="menu-nag warn" onClick={onBackup}>
            {tf(nag.key, nag.vars)} // {t('OPEN DATA TO BACK UP')}
          </button>
        )}
      </div>
      <div className="menu-wire">
        <div className="spin" style={{ ['--spin-delay' as string]: firstShow ? '1.6s' : '0s' }}>
          <Wireframe size={190} instant={!firstShow} />
        </div>
        <span className="sign dim">LATTICE NODE 01</span>
      </div>
      {listReady && <StatusBoard onOpen={onStatus} />}
    </div>
    </div>
  )
}
