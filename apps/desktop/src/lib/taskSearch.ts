/* Pure task-search helpers (C4). Type-only imports and no `@/` aliases, so
   node tests load this file directly (tests/taskSearch.test.mjs). */
import type { TaskSearchHit } from '@nimble/types'

/** Snippet markers — Rust's `snippet(tasks_fts, 2, char(2), char(3), …)`. */
export const MARK_OPEN = '\u0002'
export const MARK_CLOSE = '\u0003'

const SYNTAX = /["*:^()\-+]/g
const WORDY = /[\p{L}\p{N}]/u

/** Word tokens for highlighting and the web LIKE fallback. FTS syntax
 *  characters become spaces; tokens without a letter or digit are dropped.
 *  (Rust keeps "follow-up" as one phrase; for highlighting, two words.) */
export function searchTokens(input: string): string[] {
  return input.replace(SYNTAX, ' ').split(/\s+/).filter((t) => WORDY.test(t))
}

export interface Segment {
  text: string
  mark: boolean
}

/** Split a marked string into plain/marked runs; unbalanced markers are tolerated. */
export function splitMarked(marked: string): Segment[] {
  const out: Segment[] = []
  let mark = false
  let buf = ''
  const flush = () => {
    if (buf) out.push({ text: buf, mark })
    buf = ''
  }
  for (const ch of marked) {
    if (ch === MARK_OPEN) { flush(); mark = true }
    else if (ch === MARK_CLOSE) { flush(); mark = false }
    else buf += ch
  }
  flush()
  return out
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Title runs with every word that starts with a token marked
 *  (case- and diacritic-insensitive, like the index's tokenizer). */
export function markTitle(title: string, tokens: readonly string[]): Segment[] {
  const needles = tokens.map(fold).filter(Boolean)
  if (needles.length === 0) return title ? [{ text: title, mark: false }] : []
  const out: Segment[] = []
  let last = 0
  for (const m of title.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = m[0]
    const start = m.index ?? 0
    if (!needles.some((n) => fold(word).startsWith(n))) continue
    if (start > last) out.push({ text: title.slice(last, start), mark: false })
    out.push({ text: word, mark: true })
    last = start + word.length
  }
  if (last < title.length) out.push({ text: title.slice(last), mark: false })
  return out
}

/** Web-fallback snippet: a window around the first token hit, every hit
 *  wrapped in markers, `…` where cut. `null` when nothing matches. */
export function likeSnippet(text: string | null, tokens: readonly string[], radius = 48): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  const needles = tokens.map((t) => t.toLowerCase()).filter(Boolean)
  const firsts = needles.map((n) => lower.indexOf(n)).filter((i) => i >= 0)
  if (firsts.length === 0) return null
  const first = Math.min(...firsts)
  const start = Math.max(0, first - radius)
  const end = Math.min(text.length, first + radius * 2)
  const slice = text.slice(start, end)
  const sliceLower = slice.toLowerCase()
  const ranges: [number, number][] = []
  for (const n of needles) {
    for (let i = sliceLower.indexOf(n); i !== -1; i = sliceLower.indexOf(n, i + n.length)) ranges.push([i, i + n.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  let out = ''
  let pos = 0
  for (const [s, e] of ranges) {
    if (s < pos) continue
    out += slice.slice(pos, s) + MARK_OPEN + slice.slice(s, e) + MARK_CLOSE
    pos = e
  }
  out += slice.slice(pos)
  return (start > 0 ? '…' : '') + out + (end < text.length ? '…' : '')
}

/** Open results, then completed; each keeps its ranked order. */
export function groupHits(hits: readonly TaskSearchHit[]): { open: TaskSearchHit[]; completed: TaskSearchHit[] } {
  return {
    open: hits.filter((h) => h.task.status !== 'complete'),
    completed: hits.filter((h) => h.task.status === 'complete'),
  }
}

/** As-you-type request ids: only the latest response may render. */
export function createLatestGuard(): { next(): number; isLatest(id: number): boolean } {
  let latest = 0
  return { next: () => ++latest, isLatest: (id) => id === latest }
}

/** "Sep 12", or "Dec 1, 2025" outside the current year. Rust stamps local
 *  "YYYY-MM-DD HH:MM:SS"; the mock stamps "YYYY-MM-DDTHH:MM:SS". */
export function formatDoneDate(completedAt: string | null, now: Date = new Date()): string {
  const match = completedAt?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return 'Done'
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', year === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}
