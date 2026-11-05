import { useEffect, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'

export interface TypeLine {
  text: string
  cls?: string
  /** Pause before this line starts, in ms. */
  pause?: number
}

interface Props {
  lines: (string | TypeLine)[]
  /** Characters revealed per step. 1 for short replies, 3-6 for long readouts. */
  group?: number
  /** Steps per second. Defaults to the TYPE SPEED setting. */
  speed?: number
  /** Show everything at once (used when the user skips). */
  instant?: boolean
  onDone?: () => void
  className?: string
}

/**
 * Types text onto the screen a step at a time. Each step that shows new
 * characters plays one typing blip, so the sound always matches the text.
 */
export function TypeText({ lines, group = 1, speed, instant, onDone, className }: Props) {
  const { settings, sound } = useApp()
  const norm: TypeLine[] = lines.map((l) => (typeof l === 'string' ? { text: l } : l))
  const total = norm.reduce((n, l) => n + l.text.length, 0)
  const [shown, setShown] = useState(instant ? total : 0)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const key = norm.map((l) => l.text).join('\n')
  const steps = speed ?? settings.look.typeSpeed

  useEffect(() => {
    doneRef.current = false
    if (instant) {
      setShown(total)
      return
    }
    setShown(0)
    sound.printBegin()
    let count = 0
    let lineIdx = 0
    let lineStart = 0
    let timer: number
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      sound.printEnd()
    }
    const step = () => {
      // Move to the line we're in, honouring any pause before it.
      while (lineIdx < norm.length && count >= lineStart + norm[lineIdx].text.length) {
        lineStart += norm[lineIdx].text.length
        lineIdx++
        const p = norm[lineIdx]?.pause
        if (p && count < total) {
          timer = window.setTimeout(step, p)
          return
        }
      }
      if (count >= total) {
        finish()
        if (!doneRef.current) {
          doneRef.current = true
          onDoneRef.current?.()
        }
        return
      }
      const line = norm[lineIdx]
      const inLine = count - lineStart
      const next = Math.min(lineStart + line.text.length, count + group)
      const ch = line.text.slice(inLine, inLine + (next - count)).trimStart()[0] ?? ' '
      sound.typeChar(ch, lineIdx, inLine, next - count)
      count = next
      setShown(count)
      timer = window.setTimeout(step, 1000 / steps)
    }
    const first = norm[0]?.pause ?? 0
    timer = window.setTimeout(step, first)
    return () => {
      window.clearTimeout(timer)
      finish()
    }
    // Re-run only when the text itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, instant])

  useEffect(() => {
    if (instant && !doneRef.current) {
      doneRef.current = true
      onDoneRef.current?.()
    }
  }, [instant])

  let left = shown
  let cursorPlaced = false
  return (
    <div className={className}>
      {norm.map((l, i) => {
        const vis = Math.max(0, Math.min(l.text.length, left))
        left -= l.text.length
        const typing = !cursorPlaced && vis < l.text.length && shown < total
        if (typing) cursorPlaced = true
        if (vis === 0 && !typing) return <div key={i} className={`tline ${l.cls ?? ''}`}>&nbsp;</div>
        return (
          <div key={i} className={`tline ${l.cls ?? ''}`}>
            {l.text.slice(0, vis)}
            {typing && <span className="cursor" aria-hidden />}
          </div>
        )
      })}
    </div>
  )
}
