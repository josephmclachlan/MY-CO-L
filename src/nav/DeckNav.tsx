import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { Emblem } from '../components/Emblem'
import { Select } from '../components/Select'
import { STATIONS, stationById, type Deck, type StationAt } from './decks'
import { usePulse } from './useDeckPulse'

// How a person moves around a deck.
// Desktop: the deck's stations head the left panel, with RELATED under them (menus stay on the left).
// Phone: the left panel is hidden, so a station drop-down sits at the top of the screen and RELATED at the foot.
// Deck and station names go through t() from the map, so they follow the screen language when it has an entry for them.

interface NavProps {
  deck: Deck
  /** The open station, or null on the deck's overview. */
  station: StationAt | null
  canOpen: (screen: string) => boolean
  onDeck: () => void
  onStation: (s: StationAt) => void
}

const mine = (deck: Deck, canOpen: (screen: string) => boolean) => STATIONS.filter((s) => s.deck.id === deck.id && canOpen(s.screen))
const relatedOf = (station: StationAt | null, canOpen: (screen: string) => boolean) =>
  (station?.related ?? []).map((id) => stationById(id)).filter((s): s is StationAt => !!s && canOpen(s.screen))

/** The left panel's top: deck, its stations, and the stations related to the open one. */
export function DeckNav({ deck, station, canOpen, onDeck, onStation }: NavProps) {
  const { sound } = useApp()
  const { t } = useT()
  const { badge } = usePulse()
  const list = mine(deck, canOpen)
  const rel = relatedOf(station, canOpen)
  return (
    <nav className="dk-nav" aria-label={`${deck.name} stations`}>
      <button type="button" className="dk-head" onClick={() => (sound.chirp(), onDeck())} data-tip={`${deck.name}: ${deck.sub}`}>
        <Emblem id={deck.id} size={22} />
        <span>
          {deck.num} {t(deck.name)}
        </span>
      </button>
      <ul className="index-list dk-list">
        <li tabIndex={0} className={!station ? 'sel' : ''} onClick={() => (sound.chirp(), onDeck())}>
          <span>{deck.num}.0 {t('OVERVIEW')}</span>
        </li>
        {list.map((s) => (
          <li tabIndex={0} key={s.id} className={station?.id === s.id ? 'sel' : ''} data-tip={`${s.name}: ${s.sub}`} onClick={() => (sound.chirp(), onStation(s))}>
            <span>
              {s.code} {t(s.name)}
            </span>
            {badge[s.id] && <span className="k">{badge[s.id]}</span>}
          </li>
        ))}
      </ul>
      {rel.length > 0 && (
        <>
          <div className="section-title dk-rel-title">{t('RELATED')}</div>
          <ul className="index-list dk-rel">
            {rel.map((s) => (
              <li tabIndex={0} key={s.id} data-tip={`${s.deck.name} > ${s.name}: ${s.sub}`} onClick={() => (sound.chirp(), onStation(s))}>
                <span>
                  {s.code} {t(s.name)}
                </span>
                {s.deck.id !== deck.id && <span className="k">{t(s.deck.name)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  )
}

/**
 * Above every station's screen. On a phone: the deck (tap for its overview) and an in-app drop-down of its stations.
 * Everywhere: the screen's own theme name and what the station is for, in plain words.
 */
export function StationBar({ deck, station, canOpen, onDeck, onStation, screenName }: NavProps & { screenName?: string }) {
  const { t } = useT()
  const list = mine(deck, canOpen)
  return (
    <div className="dk-bar">
      <div className="dk-bar-nav">
        <button type="button" className="dk-bar-deck" onClick={onDeck} aria-label={`${deck.name} overview`} data-tip={`${deck.name} overview.`}>
          <Emblem id={deck.id} size={18} />
          <span>{t(deck.name)}</span>
        </button>
        <Select
          aria-label={`${deck.name} station`}
          value={station?.id ?? ''}
          onChange={(e) => {
            const s = e.target.value ? stationById(e.target.value) : undefined
            if (s) onStation(s)
            else onDeck()
          }}
        >
          <option value="">{deck.num}.0 {t('OVERVIEW')}</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} {t(s.name)}
            </option>
          ))}
        </Select>
      </div>
      {station && (
        <div className="dk-bar-what">
          <span className="dk-bar-code">{station.code}</span>
          {screenName && screenName !== station.name && <b className="dk-bar-theme">{t(screenName)}</b>}
          <span>{t(station.sub)}</span>
        </div>
      )}
    </div>
  )
}

/** Phones: the related stations as a row of links at the foot of the screen. */
export function RelatedFoot({ station, canOpen, onStation }: { station: StationAt | null; canOpen: (screen: string) => boolean; onStation: (s: StationAt) => void }) {
  const { t } = useT()
  const rel = relatedOf(station, canOpen)
  if (!rel.length) return null
  return (
    <div className="dk-foot" role="navigation" aria-label="Related stations">
      <span className="dk-foot-label">{t('RELATED')}</span>
      {rel.map((s) => (
        <button type="button" key={s.id} className="btn dk-chip" onClick={() => onStation(s)} data-tip={`${s.deck.name} > ${s.name}: ${s.sub}`}>
          {t(s.name)}
        </button>
      ))}
    </div>
  )
}

/** The main menu's left panel: every deck and its stations, to jump straight to any of them. */
export function StationDirectory({ canOpen, onDeck, onStation }: { canOpen: (screen: string) => boolean; onDeck: (d: Deck) => void; onStation: (s: StationAt) => void }) {
  const { sound } = useApp()
  const { t } = useT()
  const decks = [...new Set(STATIONS.filter((s) => canOpen(s.screen)).map((s) => s.deck))]
  return (
    <nav className="dk-dir" aria-label="Station directory">
      <div className="section-title">{t('STATION DIRECTORY')}</div>
      {decks.map((d) => (
        <div key={d.id} className="dk-dir-deck">
          <button type="button" className="dk-dir-head" onClick={() => (sound.chirp(), onDeck(d))}>
            <Emblem id={d.id} size={16} />
            {d.num} {t(d.name)}
          </button>
          <ul className="index-list">
            {mine(d, canOpen).map((s) => (
              <li tabIndex={0} key={s.id} data-tip={`${s.name}: ${s.sub}`} onClick={() => (sound.chirp(), onStation(s))}>
                <span>
                  {s.code} {t(s.name)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
