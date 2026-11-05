import { useEffect, useState } from 'react'
import type { Chapter, ManualData } from './types'

/** False in the public build. The textbook only exists in the private test copy for now. */
export const MANUAL_ON: boolean = __MANUAL__

let pending: Promise<ManualData> | null = null
export function loadManual(): Promise<ManualData> {
  if (!__MANUAL__) return Promise.reject(new Error('locked'))
  return (pending ??= import('@manual-data').then((m) => m.default))
}

export type ManualState = { status: 'locked' } | { status: 'loading' } | { status: 'ready'; data: ManualData }

export function useManual(active = true): ManualState {
  const [data, setData] = useState<ManualData | null>(null)
  useEffect(() => {
    if (!__MANUAL__ || !active || data) return
    let live = true
    loadManual().then((d) => live && setData(d))
    return () => {
      live = false
    }
  }, [active, data])
  if (!__MANUAL__) return { status: 'locked' }
  return data ? { status: 'ready', data } : { status: 'loading' }
}

export const FACT_RE = /^F\d\d-\d{4}$/

export interface Resolved {
  anchor: string
  chapter: Chapter
  fact?: string
  /** other places the same fact is cited */
  also: { anchor: string; title: string }[]
}

/** A fact id (F17-0274), a section anchor (t12-hold) or a chapter (t12 / "10") to a place in the book. */
export function resolveRef(data: ManualData, ref: string): Resolved | null {
  let fact: string | undefined
  let list: string[]
  if (FACT_RE.test(ref)) {
    fact = ref
    list = data.factMap[ref] ?? []
    // A section anchor beats a bare chapter anchor.
    list = [...list].sort((a, b) => Number(!a.includes('-')) - Number(!b.includes('-')))
  } else list = [ref]
  const hit = list.find((a) => a in data.anchors)
  if (!hit) return null
  const chapter = data.chapters[data.anchors[hit]]
  const title = (a: string) => data.chapters[data.anchors[a]].toc.find((t) => t.id === a)?.title ?? data.chapters[data.anchors[a]].title
  return { anchor: hit, chapter, fact, also: list.filter((a) => a !== hit && a in data.anchors).map((a) => ({ anchor: a, title: title(a) })) }
}

const LEVEL = /^H([1-4])$/

/** Only the cited section: the heading and everything under it up to the next heading of the same or higher rank. */
export function sectionHtml(chapter: Chapter, anchor: string, fact?: string): { html: string; cut: boolean } {
  const tpl = document.createElement('template')
  tpl.innerHTML = chapter.html
  const kids = Array.from(tpl.content.children)
  let start = kids.findIndex((k) => k.id === anchor || !!k.querySelector(`[id="${anchor}"]`))
  if (start < 0) start = 0
  const first = kids[start]
  const lv = LEVEL.exec(first.tagName)
  const take: Element[] = [first]
  if (lv) {
    const rank = Number(lv[1])
    // A chapter heading shows only its opening part, before the first section.
    const stopRank = rank === 1 ? 2 : rank
    for (let i = start + 1; i < kids.length; i++) {
      const m = LEVEL.exec(kids[i].tagName)
      if (m && Number(m[1]) <= stopRank) break
      take.push(kids[i])
    }
  }
  const box = document.createElement('div')
  let size = 0
  let cut = false
  for (const el of take) {
    size += el.outerHTML.length
    if (size > 60000 && box.childElementCount > 0) {
      cut = true
      break
    }
    box.appendChild(el.cloneNode(true))
  }
  if (fact) markFact(box, fact)
  return { html: box.innerHTML, cut }
}

/** Lights up the sentence, bullet or table row that carries a fact. */
export function markFact(root: ParentNode, fact: string) {
  root.querySelectorAll(`.fm[data-f~="${fact}"]`).forEach((s) => s.closest('li,tr,p,blockquote')?.classList.add('hit'))
}
