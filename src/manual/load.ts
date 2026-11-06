import { useEffect, useState } from 'react'
import type { Chapter, ManualData } from './types'
import { supabase } from '../lib/supabase'

/**
 * False in the public build. The textbook is bundled only in the private test copy (__MANUAL__). On the farm box
 * (__MANUAL_FETCH__) it is fetched from the box itself, for a logged-in user only, once ./mycol.sh manual has put it there.
 */
export const MANUAL_ON: boolean = __MANUAL__ || __MANUAL_FETCH__
export const MANUAL_URL = 'manual/manual.json'

/** Why the farm box could not hand over the textbook, in words for the screen. */
export function manualMissingText(status: number | null): string {
  if (status === 401 || status === 403) return 'LOG IN ON THIS FARM BOX TO OPEN THE TEXTBOOK.'
  if (status === 404) return 'THE TEXTBOOK IS NOT ON THIS FARM BOX YET. ON THE BOX, RUN: ./mycol.sh manual manual.json'
  return 'THE FARM BOX DID NOT ANSWER. THE TEXTBOOK NEEDS THE BOX (IT IS NOT KEPT FOR OFFLINE USE).'
}

async function fetchManual(): Promise<ManualData> {
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined
  let res: Response
  try {
    res = await fetch(new URL(MANUAL_URL, new URL(import.meta.env.BASE_URL || '/', location.origin)).href, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-cache',
    })
  } catch {
    throw new Error(manualMissingText(null))
  }
  if (!res.ok) throw new Error(manualMissingText(res.status))
  const data = (await res.json()) as ManualData
  if (!Array.isArray(data?.chapters) || !data.chapters.length) throw new Error('THE TEXTBOOK FILE ON THE FARM BOX IS EMPTY OR DAMAGED. COPY IT AGAIN.')
  return data
}

let pending: Promise<ManualData> | null = null
export function loadManual(): Promise<ManualData> {
  if (__MANUAL__) return (pending ??= import('@manual-data').then((m) => m.default))
  if (!__MANUAL_FETCH__) return Promise.reject(new Error('locked'))
  // A failed fetch is not kept, so logging in or copying the file and trying again works.
  return (pending ??= fetchManual().catch((e) => {
    pending = null
    throw e
  }))
}

export type ManualState = { status: 'locked' } | { status: 'loading' } | { status: 'missing'; why: string } | { status: 'ready'; data: ManualData }

export function useManual(active = true): ManualState {
  const [data, setData] = useState<ManualData | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  useEffect(() => {
    if (!MANUAL_ON || !active || data) return
    let live = true
    loadManual().then(
      (d) => live && setData(d),
      (e: unknown) => live && setWhy(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [active, data])
  if (!MANUAL_ON) return { status: 'locked' }
  if (data) return { status: 'ready', data }
  return why ? { status: 'missing', why } : { status: 'loading' }
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
