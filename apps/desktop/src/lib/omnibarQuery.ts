/* Omnibar field model (spec 2026-09-25 §1.2–1.3): removable pills plus free
   text, and the filters inferred from what is typed. Filters never apply
   until accepted. Pure — node-tested by tests/omnibarQuery.test.mjs, so no
   `@/` aliases and no runtime imports. */

export type PillKind = 'status' | 'type' | 'label' | 'project'
export type StatusValue = 'open' | 'completed'
export type TypeValue = 'task' | 'note' | 'doc' | 'goal' | 'action'

export interface Pill {
  kind: PillKind
  /** The status / type value, or the label / project id. */
  value: string
  /** What the pill shows after `kind:`. */
  name: string
}

export interface FieldState {
  pills: Pill[]
  text: string
}

export interface FilterCatalog {
  labels: readonly { id: string; name: string; archived_at: string | null }[]
  projects: readonly { id: string; name: string; archived_at: string | null }[]
}

export interface FilterSuggestion {
  pill: Pill
  /** Span of the typed text this suggestion consumes when accepted. */
  start: number
  end: number
  exact: boolean
}

export interface PillFilters {
  status: 'all' | StatusValue
  labelIds: string[]
  projectId: string | null
  type: TypeValue | null
}

export const MAX_SUGGESTIONS = 3
/** Shorter partial words never suggest ("a" is not "action"); exact matches always do. */
export const MIN_PREFIX = 2

const KIND_RANK: Record<PillKind, number> = { status: 0, type: 1, label: 2, project: 3 }

const STATUS_NAMES: { value: StatusValue; names: string[] }[] = [
  { value: 'open', names: ['open'] },
  { value: 'completed', names: ['completed', 'done', 'complete'] },
]

const TYPE_NAMES: { value: TypeValue; names: string[] }[] = [
  { value: 'task', names: ['task', 'tasks'] },
  { value: 'note', names: ['note', 'notes'] },
  { value: 'doc', names: ['doc', 'docs'] },
  { value: 'goal', names: ['goal', 'goals'] },
  { value: 'action', names: ['action', 'actions'] },
]

/** Pictographs, skin tones, ZWJ, regional indicators (flags) and tag
 *  characters (subdivision flags). Variation selectors are marks (\p{M}). */
const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{200D}\p{Regional_Indicator}\u{E0020}-\u{E007F}]/gu

/** Case-, diacritic- and emoji-insensitive form used for every comparison. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(EMOJI, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Longest run of consecutive words tried as one multi-word name. */
export const MAX_RUN_WORDS = 8

interface Candidate {
  folded: string
  start: number
  end: number
  /** Words in the run. */
  words: number
}

/** Every run of consecutive whitespace-separated words (multi-word names such
 *  as "Portola 2026" anywhere in the text), longest first, then each word. */
function candidates(text: string): Candidate[] {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  const out: Candidate[] = []
  for (let len = Math.min(words.length, MAX_RUN_WORDS); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const start = words[i].start
      const end = words[i + len - 1].end
      out.push({ folded: fold(text.slice(start, end)), start, end, words: len })
    }
  }
  return out.filter((c) => c.folded.length > 0)
}

interface Entry {
  pill: Pill
  names: string[]
}

function entries(catalog: FilterCatalog): Entry[] {
  return [
    ...STATUS_NAMES.map((s): Entry => ({ pill: { kind: 'status', value: s.value, name: s.value }, names: s.names })),
    ...TYPE_NAMES.map((t): Entry => ({ pill: { kind: 'type', value: t.value, name: t.value }, names: t.names })),
    ...catalog.labels
      .filter((l) => !l.archived_at)
      .map((l): Entry => ({ pill: { kind: 'label', value: l.id, name: l.name }, names: [fold(l.name)] })),
    ...catalog.projects
      .filter((p) => !p.archived_at)
      .map((p): Entry => ({ pill: { kind: 'project', value: p.id, name: p.name }, names: [fold(p.name)] })),
  ]
}

interface Ranked {
  s: FilterSuggestion
  words: number
}

function better(a: Ranked, b: Ranked): boolean {
  if (a.s.exact !== b.s.exact) return a.s.exact
  return a.words > b.words
}

function compare(a: Ranked, b: Ranked): number {
  if (a.s.exact !== b.s.exact) return a.s.exact ? -1 : 1
  if (a.words !== b.words) return b.words - a.words
  return KIND_RANK[a.s.pill.kind] - KIND_RANK[b.s.pill.kind]
}

/** FILTERS group rows: best match per kind+value, exact before prefix, then
 *  the longer matched run of words, then status, type, label, project
 *  (catalog order within a kind), at most three. A kind+value already pilled
 *  is never offered. */
export function suggestFilters(text: string, pills: readonly Pill[], catalog: FilterCatalog): FilterSuggestion[] {
  const cands = candidates(text)
  if (cands.length === 0) return []
  const best = new Map<string, Ranked>()
  for (const entry of entries(catalog)) {
    if (pills.some((p) => p.kind === entry.pill.kind && p.value === entry.pill.value)) continue
    const key = `${entry.pill.kind}:${entry.pill.value}`
    for (const c of cands) {
      const exact = entry.names.includes(c.folded)
      const prefix = !exact && c.folded.length >= MIN_PREFIX && entry.names.some((n) => n.startsWith(c.folded))
      if (!exact && !prefix) continue
      const next: Ranked = { s: { pill: entry.pill, start: c.start, end: c.end, exact }, words: c.words }
      const prev = best.get(key)
      if (!prev || better(next, prev)) best.set(key, next)
    }
  }
  return [...best.values()].sort(compare).slice(0, MAX_SUGGESTIONS).map((r) => r.s)
}

/** One status, one type and one project (a new one replaces); labels stack. */
export function addPill(pills: readonly Pill[], pill: Pill): Pill[] {
  if (pills.some((p) => p.kind === pill.kind && p.value === pill.value)) return [...pills]
  if (pill.kind === 'label') return [...pills, pill]
  return [...pills.filter((p) => p.kind !== pill.kind), pill]
}

/** Adds the pill and removes the matched word(s); a trailing space is left
 *  so typing continues as a new word. */
export function acceptSuggestion(state: FieldState, s: FilterSuggestion): FieldState {
  const rest = `${state.text.slice(0, s.start)} ${state.text.slice(s.end)}`.replace(/\s+/g, ' ').trim()
  return { pills: addPill(state.pills, s.pill), text: rest ? `${rest} ` : '' }
}

export function removePill(state: FieldState, index: number): FieldState {
  return { ...state, pills: state.pills.filter((_, i) => i !== index) }
}

/** Backspace in an empty field. */
export function removeLastPill(state: FieldState): FieldState {
  return state.pills.length === 0 ? state : removePill(state, state.pills.length - 1)
}

export function pillFilters(pills: readonly Pill[]): PillFilters {
  const status = pills.find((p) => p.kind === 'status')?.value as StatusValue | undefined
  const type = pills.find((p) => p.kind === 'type')?.value as TypeValue | undefined
  return {
    status: status ?? 'all',
    labelIds: pills.filter((p) => p.kind === 'label').map((p) => p.value),
    projectId: pills.find((p) => p.kind === 'project')?.value ?? null,
    type: type ?? null,
  }
}

/** Status / label / project pills narrow tasks only. */
export function hasTaskFilters(f: PillFilters): boolean {
  return f.status !== 'all' || f.labelIds.length > 0 || f.projectId !== null
}

export function pillText(p: Pill): string {
  return `${p.kind}: ${p.name}`
}

export function suggestionText(s: FilterSuggestion): string {
  return `Filter by ${s.pill.kind}: ${s.pill.name}`
}
