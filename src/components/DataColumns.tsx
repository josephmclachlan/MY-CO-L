import { useEffect, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { codeRow } from '../data/farm'

interface Props {
  rows?: number
  cols?: number
  /** How long the columns take to fill, in ms. Chatter plays for exactly this long. */
  duration?: number
  instant?: boolean
  onDone?: () => void
}

/**
 * Columns of real farm codes filling in. The data chatter starts when the
 * first row appears and stops when the last one lands.
 */
export function DataColumns({ rows = 12, cols = 2, duration = 2400, instant, onDone }: Props) {
  const { sound } = useApp()
  const [data] = useState(() => Array.from({ length: rows * cols }, codeRow))
  const [shown, setShown] = useState(instant ? rows * cols : 0)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (instant) {
      setShown(rows * cols)
      return
    }
    const totalCells = rows * cols
    const stepMs = duration / totalCells
    let n = 0
    sound.beginData()
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      sound.endData()
    }
    const timer = window.setInterval(() => {
      n++
      setShown(n)
      if (n >= totalCells) {
        window.clearInterval(timer)
        end()
        onDoneRef.current?.()
      }
    }, stepMs)
    return () => {
      window.clearInterval(timer)
      end()
    }
  }, [instant, rows, cols, duration, sound])

  return (
    <div className="datacols" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }} aria-hidden>
      {data.map((d, i) => {
        // Fill column by column, top to bottom, like a readout scrolling in.
        const col = i % cols
        const row = Math.floor(i / cols)
        const order = col * rows + row
        return (
          <span key={i} className={order < shown ? (order === shown - 1 ? 'cell hot' : 'cell') : 'cell off'}>
            {d}
          </span>
        )
      })}
    </div>
  )
}
