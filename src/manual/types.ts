export interface TocEntry { id: string; title: string; level: number }
export interface Chapter { id: string; title: string; num: number; toc: TocEntry[]; html: string }
export interface ManualData {
  chapters: Chapter[]
  /** textbook fact id -> section anchors that carry it */
  factMap: Record<string, string[]>
  /** every anchor id -> chapter index */
  anchors: Record<string, number>
}
/** Where the reader is in the manual. `n` changes on every jump so repeats still scroll. */
export interface ManualLoc { chapter: string; anchor?: string; fact?: string; n: number }
