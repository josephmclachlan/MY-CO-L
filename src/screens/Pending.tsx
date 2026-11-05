import { useEffect, useState } from 'react'
import { useApp } from '../settings/AppContext'
import type { ModuleDef } from '../data/farm'
import { TypeText } from '../components/TypeText'

/** A module that isn't built yet. Shows PROCESSING (with the warble), then says when it arrives. */
export function Pending({ mod }: { mod: ModuleDef }) {
  const { sound } = useApp()
  const [processing, setProcessing] = useState(true)

  useEffect(() => {
    setProcessing(true)
    sound.warble(0.7)
    const t = window.setTimeout(() => setProcessing(false), 700)
    return () => window.clearTimeout(t)
  }, [mod, sound])

  return (
    <div>
      <div className="section-title">{mod.name}</div>
      {processing ? (
        <div>
          <span className="processing">PROCESSING</span>
        </div>
      ) : (
        <TypeText
          group={2}
          lines={[
            `MODULE ${mod.name} // ${mod.what}`,
            { text: 'STATUS: DORMANT // NOT YET INSTALLED', cls: 'warn' },
            `SCHEDULED: BUILD ${mod.build}`,
            '',
            { text: 'TYPE MENU OR PRESS F2 TO RETURN.', cls: 'dim' },
          ]}
        />
      )}
      {!processing && (
        <div className="dormant" aria-hidden="true">
          <div className="dormant-trim" />
          <div className="dormant-body">
            <div className="dormant-glyph">&#9651;</div>
            <div>
              <div className="dormant-t">LATTICE LINK: NO CARRIER</div>
              <div className="dormant-bar"><i /></div>
              <div className="dim">SUBSYSTEM {mod.key} HELD IN COLD STORAGE. THE LATTICE HOLDS.</div>
            </div>
          </div>
          <div className="dormant-trim" />
        </div>
      )}
    </div>
  )
}
