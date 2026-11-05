import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { resolveRef, sectionHtml, useManual } from './load'

interface Props {
  refId: string
  onClose: () => void
  /** Open the full manual at this spot. */
  onGoPage: (chapter: string, anchor: string, fact?: string) => void
}

/** A pop-up that shows only the cited section, with an option to go to the full page. */
export function SourcePopup({ refId: first, onClose, onGoPage }: Props) {
  const [refId, setRef] = useState(first)
  useEffect(() => setRef(first), [first])
  const { sound } = useApp()
  const state = useManual(true)
  const data = state.status === 'ready' ? state.data : null
  const found = useMemo(() => {
    if (!data) return null
    const r = resolveRef(data, refId)
    return r ? { r, ...sectionHtml(r.chapter, r.anchor, r.fact) } : null
  }, [data, refId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  useEffect(() => {
    document.querySelector('.src-body .hit')?.scrollIntoView({ block: 'center' })
  }, [found])

  return (
    <div className="src-pop" role="dialog" aria-label="Manual section" onClick={onClose}>
      <div className="src-box" onClick={(e) => e.stopPropagation()}>
        <div className="src-head">
          <span>
            MANUAL // {refId}
            {found && ` // CH ${found.r.chapter.num} ${found.r.chapter.title.toUpperCase()}`}
          </span>
        </div>
        <div
          className="src-body"
          onClick={(e) => {
            const href = (e.target as HTMLElement).closest('a')?.getAttribute('href')
            if (!href?.startsWith('#')) return
            e.preventDefault()
            sound.chirp()
            setRef(href.slice(1))
          }}
        >
          {state.status === 'locked' && <div className="warn">MANUAL LOCKED // LOGIN REQUIRED</div>}
          {state.status === 'loading' && <span className="processing">LOADING MANUAL</span>}
          {data && !found && <div className="warn">{refId} IS NOT IN THE MANUAL. NO SECTION TO SHOW.</div>}
          {found && (
            <>
              <article className="mbook" dangerouslySetInnerHTML={{ __html: found.html }} />
              {found.cut && <div className="dim">...SECTION CONTINUES ON THE PAGE.</div>}
              {found.r.also.length > 0 && (
                <div className="src-also dim">
                  ALSO CITED IN:{' '}
                  {found.r.also.slice(0, 5).map((a) => (
                    <button key={a.anchor} type="button" className="ref" onClick={() => (sound.chirp(), onGoPage(data!.chapters[data!.anchors[a.anchor]].id, a.anchor, found.r.fact))}>
                      {a.title}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="src-actions">
          {found && (
            <button type="button" className="why on" onClick={() => (sound.chirp(), onGoPage(found.r.chapter.id, found.r.anchor, found.r.fact))}>
              GO TO PAGE
            </button>
          )}
          <button type="button" className="why" onClick={() => (sound.chirp(), onClose())}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  )
}
