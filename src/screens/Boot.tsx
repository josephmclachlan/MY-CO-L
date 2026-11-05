import { useEffect, useRef, useState } from 'react'
import { useApp } from '../settings/AppContext'
import { TypeText } from '../components/TypeText'
import { DataColumns } from '../components/DataColumns'
import { SELF_TEST, STATION } from '../data/farm'
import { dbLinked } from '../lib/supabase'

type Phase = 'swoop' | 'header' | 'test' | 'online'

/**
 * Boot: swoop as the screen powers on, then the drone fades in, then chatter
 * while the self-test and code columns scroll, then LATTICE ONLINE. The
 * confirm beep plays when the main menu appears (in App).
 */
export function Boot({ onDone }: { onDone: () => void }) {
  const { settings, sound } = useApp()
  const [phase, setPhase] = useState<Phase>('swoop')
  const [testDone, setTestDone] = useState(false)
  const [colsDone, setColsDone] = useState(false)
  const doneRef = useRef(false)
  const canSkip = settings.bootSeen && !settings.fullBoot

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  // Swoop with the power-on animation.
  useEffect(() => {
    sound.swoop()
    const t = window.setTimeout(() => setPhase('header'), 1500)
    return () => window.clearTimeout(t)
  }, [sound])

  // Drone runs from the header until LATTICE ONLINE.
  useEffect(() => {
    if (phase === 'header') sound.droneOn()
    if (phase === 'online') {
      const t = window.setTimeout(finish, 1300)
      return () => window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  useEffect(() => () => sound.droneOff(), [sound])
  useEffect(() => {
    if (testDone && colsDone && phase === 'test') {
      sound.droneOff()
      setPhase('online')
    }
  }, [testDone, colsDone, phase, sound])

  // Any key or tap skips, once the full boot has been seen.
  useEffect(() => {
    if (!canSkip) return
    const skip = () => finish()
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSkip])

  const testLines = [
    ...SELF_TEST,
    ['DATABASE', dbLinked ? 'LINKED' : 'LOCAL'] as [string, string],
    ['OFFLINE CACHE', 'serviceWorker' in navigator ? 'READY' : 'N/A'] as [string, string],
  ].map(([a, b]) => `${(a + ' ').padEnd(30, '.')} ${b}`)

  return (
    <div className="boot">
      {phase !== 'swoop' && (
        <div className="boot-grid">
          <div className="boot-main">
            <TypeText
              group={2}
              speed={24}
              lines={[
                { text: STATION.company + ' // ' + STATION.station, cls: 'dim' },
                { text: STATION.system, cls: 'boot-title', pause: 200 },
                { text: STATION.longName, cls: 'heading' },
                { text: `INTERFACE 2037 // BUILD ${STATION.build}`, cls: 'dim', pause: 150 },
                { text: '' },
              ]}
              onDone={() => setPhase((p) => (p === 'header' ? 'test' : p))}
            />
            {phase !== 'header' && (
              <TypeText group={6} speed={24} lines={testLines.map((t, i) => ({ text: t, pause: i === 0 ? 100 : 60 }))} onDone={() => setTestDone(true)} />
            )}
            {phase === 'online' && (
              <TypeText className="boot-online" group={1} speed={20} lines={[{ text: 'LATTICE ONLINE', cls: 'heading big' }]} />
            )}
          </div>
          {phase !== 'header' && (
            <div className="boot-side">
              <DataColumns rows={16} cols={2} duration={3600} onDone={() => setColsDone(true)} />
            </div>
          )}
        </div>
      )}
      {canSkip && <div className="boot-skip dim">ANY KEY TO SKIP</div>}
    </div>
  )
}
