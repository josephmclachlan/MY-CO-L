import { createContext, useContext, type ReactNode } from 'react'
import { FACT_RE, MANUAL_ON } from './load'

interface Links {
  locked: boolean
  /** Open just the cited section in a pop-up. */
  openSource: (ref: string) => void
}
export const ManualLinksContext = createContext<Links>({ locked: !MANUAL_ON, openSource: () => {} })
export const useManualLinks = () => useContext(ManualLinksContext)

/** A clickable textbook reference (fact id or chapter). Plain text where the manual is locked. */
export function SourceLink({ id, children }: { id: string; children?: ReactNode }) {
  const { locked, openSource } = useManualLinks()
  if (locked) return <span className="k">{children ?? id}</span>
  return (
    <button type="button" className="ref" onClick={() => openSource(id)} title="Read this section of the manual">
      {children ?? id}
    </button>
  )
}

const SPLIT = /(F\d\d-\d{4}|\bt\d\d\b)/g

/** Plain text in which fact ids (F07-0096) and chapter marks (t10) become links to the manual. */
export function RefText({ text }: { text: string }) {
  const { locked } = useManualLinks()
  if (locked) return <>{text}</>
  return (
    <>
      {text.split(SPLIT).map((part, i) =>
        FACT_RE.test(part) || /^t\d\d$/.test(part) ? (
          <SourceLink key={i} id={part}>
            {part}
          </SourceLink>
        ) : (
          part
        ),
      )}
    </>
  )
}
