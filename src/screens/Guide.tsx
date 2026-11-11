import { useEffect, useMemo, useRef } from 'react'
import { useApp } from '../settings/AppContext'
import { useT } from '../settings/useT'
import { useRole } from '../settings/RoleContext'
import { Select } from '../components/Select'
import { GUIDE, GUIDE_GROUPS, findSection, searchGuide, type GSection } from '../guide/content'
import { deckById, visibleStations } from '../nav/decks'

// USER GUIDE (build G11): plain-English help for every screen. About the app, not the textbook, so it is in the public build.
// The text lives in src/guide/content.ts; docs/USER-MANUAL.md is made from the same file (npm run docs:guide).

export interface GuideState {
  sec: string
  q: string
}
export const GUIDE_START: GuideState = { sec: 'START', q: '' }
type SetGuide = (p: Partial<GuideState>) => void

/** Pages this person may read: staff do not get the pages for owner-only screens, or for decks with no station they may open. */
function usePages(): GSection[] {
  const role = useRole()
  return useMemo(
    () =>
      GUIDE.filter((s) => {
        if (s.module) return role.canOpen(s.module)
        const deck = s.deck ? deckById(s.deck) : undefined
        return !deck || visibleStations(deck, role.canOpen).length > 0
      }),
    [role],
  )
}

export function GuideIndex({ x, set }: { x: GuideState; set: SetGuide }) {
  const { sound } = useApp()
  const { t } = useT()
  const pages = usePages()
  return (
    <>
      <div className="section-title">{t('USER GUIDE')}</div>
      <ul className="index-list">
        {GUIDE_GROUPS.flatMap((g) => {
          const rows = pages.filter((p) => p.group === g)
          if (!rows.length) return []
          return [
            <li key={`g-${g}`} className="gd-group" aria-hidden="true">
              <span>{g}</span>
            </li>,
            ...rows.map((p) => (
              <li tabIndex={0} key={p.key} data-tip={p.what} className={x.sec === p.key ? 'sel' : ''} onClick={() => (sound.chirp(), set({ sec: p.key, q: '' }))}>
                <span>{p.title}</span>
              </li>
            )),
          ]
        })}
      </ul>
    </>
  )
}

/** onGo gets a module key, or DECK:<deck id> for a deck's overview page. */
export function Guide({ x, set, onGo }: { x: GuideState; set: SetGuide; onGo: (moduleKey: string) => void }) {
  const { t } = useT()
  const { sound } = useApp()
  const pages = usePages()
  const sec = pages.find((p) => p.key === x.sec) ?? findSection(x.sec) ?? pages[0]
  const top = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => (x.q.trim().length >= 2 ? searchGuide(x.q).filter((h) => pages.some((p) => p.key === h.key)) : []), [x.q, pages])
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' })
  }, [x.sec])

  return (
    <div className="guide" ref={top}>
      <div className="gd-bar">
        <label className="gd-find">
          <span>{t('SEARCH THE GUIDE')}</span>
          <input value={x.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('TYPE A WORD, E.G. UNDO OR HARVEST')} autoComplete="off" spellCheck={false} />
        </label>
        {/* Phones hide the index column, so the page picker sits here. */}
        <div className="gd-pick">
          <Select value={sec.key} aria-label={t('Guide page')} onChange={(e) => set({ sec: e.target.value, q: '' })}>
            {GUIDE_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {pages.filter((p) => p.group === g).map((p) => (
                  <option key={p.key} value={p.key}>{p.title}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </div>

      {x.q.trim().length >= 2 ? (
        <div className="gd-results">
          <div className="section-title">{t('FOUND IN THE GUIDE')}</div>
          {hits.length === 0 && <p>{t('NOTHING FOUND. TRY ANOTHER WORD.')}</p>}
          {hits.map((h) => (
            <button key={h.key + h.at} type="button" className="gd-hit" data-tip="Open this guide page." onClick={() => (sound.chirp(), set({ sec: h.key, q: '' }))}>
              <b>{h.title}</b>
              <span>{h.snippet}</span>
            </button>
          ))}
        </div>
      ) : (
        <article className="gd-page">
          <h2 className="gd-title">{sec.title}</h2>
          <p className="gd-what">{sec.what}</p>
          {sec.module && (
            <button type="button" className="btn gd-open" onClick={() => (sound.chirp(), onGo(sec.module as string))}>
              {t('OPEN THIS SCREEN')}
            </button>
          )}
          {sec.deck && (
            <button type="button" className="btn gd-open" data-tip="Open this deck's overview." onClick={() => (sound.chirp(), onGo(`DECK:${sec.deck}`))}>
              {t('OPEN THIS DECK')}
            </button>
          )}
          {sec.blocks.map((b, i) => (
            <section key={i} className="gd-block">
              <h3>{b.h}</h3>
              {b.text?.map((p, j) => <p key={j}>{p}</p>)}
              {b.steps && (
                <ol>
                  {b.steps.map((s, j) => <li key={j}>{s}</li>)}
                </ol>
              )}
              {b.items && (
                <dl>
                  {b.items.map(([k, v]) => (
                    <div key={k} className="gd-row">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}
          <nav className="gd-next" aria-label={t('Next and previous page')}>
            {(() => {
              const i = pages.findIndex((p) => p.key === sec.key)
              const prev = pages[i - 1]
              const next = pages[i + 1]
              return (
                <>
                  {prev ? <button type="button" className="btn" data-tip="Read the page before this one." onClick={() => (sound.chirp(), set({ sec: prev.key }))}>&lt; {prev.title}</button> : <span />}
                  {next ? <button type="button" className="btn" data-tip="Read the next page." onClick={() => (sound.chirp(), set({ sec: next.key }))}>{next.title} &gt;</button> : <span />}
                </>
              )
            })()}
          </nav>
        </article>
      )}
    </div>
  )
}
