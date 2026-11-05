import { useEffect, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { srcLabel } from '../data/species'
import { SourceLink, useManualLinks } from '../manual/ManualLinks'
import { FACT_RE } from '../manual/load'
import type { Flag } from '../data/species/types'

export interface Why {
  s?: string[]
  w?: string[]
  n?: string
}
export interface Row {
  id: string
  label?: string
  value: string
  flag?: Flag
  why?: Why | null
  head?: boolean
  /** A button that opens something related, shown beside WHY?. */
  link?: { label: string; onClick: () => void } | null
}

interface Props {
  rows: Row[]
  /** Reveal everything at once. */
  instant?: boolean
  onDone?: () => void
}

const TAG: Record<Flag, string> = { nodata: 'NO DATA', ctx: 'CONTEXT', conflict: 'CONFLICT' }

/**
 * Readout rows that type themselves onto the screen. Every revealed step plays
 * one typing sound, so the clacks match the text. Each row with a source has a
 * WHY? key that shows the fact ID, the video timestamp and the note.
 */
export function TypedRows({ rows, instant, onDone }: Props) {
  const { settings, sound } = useApp()
  const links = useManualLinks()
  const sizes = rows.map((r) => (r.label?.length ?? 0) + r.value.length)
  const total = sizes.reduce((a, b) => a + b, 0)
  const [shown, setShown] = useState(instant ? total : 0)
  const [open, setOpen] = useState<string | null>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const key = rows.map((r) => r.id + r.value).join('|')

  useEffect(() => {
    setOpen(null)
    if (instant) {
      setShown(total)
      doneRef.current?.()
      return
    }
    setShown(0)
    const rate = Math.max(8, settings.look.typeSpeed * 2)
    const group = Math.max(3, Math.ceil(total / (rate * 3))) // whole tab types in about 3 seconds
    sound.printBegin()
    let count = 0
    let timer = 0
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      sound.printEnd()
    }
    const flat = rows.map((r) => (r.label ?? '') + r.value).join('')
    const rowAt = (c: number) => {
      let acc = 0
      for (let i = 0; i < sizes.length; i++) {
        if (c < acc + sizes[i]) return [i, c - acc] as const
        acc += sizes[i]
      }
      return [sizes.length - 1, 0] as const
    }
    const step = () => {
      if (count >= total) {
        end()
        doneRef.current?.()
        return
      }
      const next = Math.min(total, count + group)
      const [ri, ci] = rowAt(count)
      sound.typeChar(flat.slice(count, count + 1).trim() || ' ', ri, ci, next - count)
      count = next
      setShown(count)
      timer = window.setTimeout(step, 1000 / rate)
    }
    timer = window.setTimeout(step, 120)
    return () => {
      window.clearTimeout(timer)
      end()
    }
    // restart only when the content or the skip flag changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, instant])

  let left = shown
  let cursorPlaced = false
  return (
    <div className="trows">
      {rows.map((r, i) => {
        const lab = r.label ?? ''
        const take = Math.max(0, Math.min(sizes[i], left))
        left -= sizes[i]
        const labShown = lab.slice(0, take)
        const valShown = r.value.slice(0, Math.max(0, take - lab.length))
        const complete = take >= sizes[i]
        const typing = !complete && take > 0 && !cursorPlaced
        if (typing) cursorPlaced = true
        if (take === 0) return null
        return (
          <div key={r.id} className={`trow ${r.head ? 'trow-head' : ''} ${r.flag ? 'fl-' + r.flag : ''}`}>
            {lab && <div className="trow-k">{labShown}</div>}
            <div className="trow-v">
              {valShown}
              {typing && <span className="cursor" aria-hidden />}
              {complete && r.flag && r.flag !== 'nodata' && <span className={`tag tag-${r.flag}`}>{TAG[r.flag]}</span>}
              {complete && r.link && (
                <button className="why link" onClick={() => (sound.chirp(), r.link!.onClick())}>
                  {r.link.label}
                </button>
              )}
              {complete && r.why && (
                <button className="why" aria-expanded={open === r.id} onClick={() => (sound.chirp(), setOpen(open === r.id ? null : r.id))}>
                  WHY?
                </button>
              )}
            </div>
            {open === r.id && r.why && (
              <div className="why-box">
                {r.why.s?.map((s) => (
                  <div key={s}>
                    <span className="k">{s}</span> {srcLabel(s)}
                    {FACT_RE.test(s) && (links.locked ? <span className="dim"> // MANUAL LOCKED, LOGIN REQUIRED</span> : <> <SourceLink id={s}>READ SECTION</SourceLink></>)}
                  </div>
                ))}
                {r.why.w?.map((w) => (
                  <div key={w}>
                    <span className="k">VIDEO</span> {w}
                  </div>
                ))}
                {r.why.n && <div className="dim">{r.why.n}</div>}
                {!r.why.s?.length && !r.why.w?.length && !r.why.n && <div className="dim">NO SOURCE LISTED</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
