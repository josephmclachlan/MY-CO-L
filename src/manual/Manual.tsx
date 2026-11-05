import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { useManual, markFact, MANUAL_ON } from './load'
import type { ManualData, ManualLoc } from './types'

interface Props {
  loc: ManualLoc | null
  /** Move in the manual. `push` false means "same page, just scroll" (no Back step). */
  onOpen: (loc: Omit<ManualLoc, 'n'>, push?: boolean) => void
}

/** Where a link inside the manual points: a chapter, section or glossary entry. */
export function linkTarget(data: ManualData, href: string): Omit<ManualLoc, 'n'> | null {
  const id = href.replace(/^#/, '')
  const ci = data.anchors[id]
  if (ci === undefined) return null
  return { chapter: data.chapters[ci].id, anchor: id }
}

/** The textbook reader: contents on the left, one chapter at a time on the right. */
export function Manual({ loc, onOpen }: Props) {
  const state = useManual(true)
  if (!MANUAL_ON || state.status === 'locked')
    return (
      <div>
        <div className="section-title">MANUAL</div>
        <div className="warn">MANUAL LOCKED // LOGIN REQUIRED</div>
        <div className="dim" style={{ marginTop: 8 }}>
          THE TEXTBOOK OPENS ONLY IN THE PRIVATE COPY UNTIL THE DATABASE LOGIN IS LINKED.
        </div>
      </div>
    )
  if (state.status === 'loading') return <span className="processing">LOADING MANUAL</span>
  return <Reader data={state.data} loc={loc} onOpen={onOpen} />
}

function Reader({ data, loc, onOpen }: { data: ManualData; loc: ManualLoc | null; onOpen: Props['onOpen'] }) {
  const { sound } = useApp()
  const chapter = data.chapters.find((c) => c.id === loc?.chapter) ?? data.chapters[0]
  const ci = data.chapters.indexOf(chapter)
  const [tocOpen, setTocOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => ({ __html: chapter.html }), [chapter])

  // Arrive at the cited place: scroll to the section, light up the fact.
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.querySelectorAll('.hit,.flash').forEach((e) => e.classList.remove('hit', 'flash'))
    if (loc?.fact) markFact(body, loc.fact)
    const target = loc?.anchor ? body.querySelector<HTMLElement>(`[id="${loc.anchor}"]`) : null
    const fact = body.querySelector<HTMLElement>('.hit')
    if (target) {
      target.scrollIntoView({ block: 'start' })
      target.classList.add('flash')
    } else if (fact) fact.scrollIntoView({ block: 'center' })
    else body.scrollTo({ top: 0 })
    if (fact && target) window.setTimeout(() => fact.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    setTocOpen(false)
  }, [chapter, loc?.anchor, loc?.fact, loc?.n])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href?.startsWith('#')) return
    e.preventDefault()
    const t = linkTarget(data, href)
    if (t) {
      sound.chirp()
      onOpen(t)
    }
  }

  const go = (idx: number) => {
    const c = data.chapters[idx]
    if (!c) return
    sound.chirp()
    onOpen({ chapter: c.id })
  }

  return (
    <div className={`manual ${tocOpen ? 'toc-open' : ''}`}>
      <button type="button" className="manual-tocbtn" onClick={() => setTocOpen((v) => !v)}>
        {tocOpen ? 'CLOSE' : 'CONTENTS'} // CH {chapter.num}
      </button>
      <nav className="manual-toc" aria-label="Manual contents" data-kbd-zone="index">
        <div className="section-title">CONTENTS</div>
        <ul>
          {data.chapters.map((c) => (
            <li key={c.id} className={c.id === chapter.id ? 'cur' : ''}>
              <button type="button" onClick={() => onOpen({ chapter: c.id })}>
                <span className="mt-n">{String(c.num).padStart(2, '0')}</span> {c.title}
              </button>
              {c.id === chapter.id && (
                <ul>
                  {c.toc
                    .filter((t) => t.level >= 2)
                    .map((t) => (
                      <li key={t.id} className={`lv${t.level}`}>
                        <button type="button" onClick={() => onOpen({ chapter: c.id, anchor: t.id }, false)}>
                          {t.title}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <div className="manual-body" ref={bodyRef} onClick={onClick} data-kbd-zone="main">
        <article className="mbook" dangerouslySetInnerHTML={html} />
        <div className="manual-pager">
          <button type="button" disabled={ci === 0} onClick={() => go(ci - 1)}>
            &lt; PREV CHAPTER
          </button>
          <button type="button" disabled={ci === data.chapters.length - 1} onClick={() => go(ci + 1)}>
            NEXT CHAPTER &gt;
          </button>
        </div>
      </div>
    </div>
  )
}
