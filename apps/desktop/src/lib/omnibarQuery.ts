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

const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{200D}]/gu

/** Case-, diacritic- and emoji-insensitive form used for every comparison. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(EMOJI, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

interface Candidate {
  folded: string
  start: number
  end: number
}

/** Each whitespace-separated word, plus the whole text when it has several
 *  words (multi-word names such as "Portola 2026"). */
function candidates(text: string): Candidate[] {
  const out: Candidate[] = []
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index ?? 0
    out.push({ folded: fold(m[0]), start, end: start + m[0].length })
  }
  if (out.length > 1) out.push({ folded: fold(text), start: out[0].start, end: out[out.length - 1].end })
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

function better(a: FilterSuggestion, b: FilterSuggestion): boolean {
  if (a.exact !== b.exact) return a.exact
  return a.end - a.start > b.end - b.start
}

function compare(a: FilterSuggestion, b: FilterSuggestion): number {
  if (a.exact !== b.exact) return a.exact ? -1 : 1
  return KIND_RANK[a.pill.kind] - KIND_RANK[b.pill.kind]
}

/** FILTERS group rows: best match per kind+value, exact before prefix, then
 *  status, type, label, project (catalog order within a kind), at most three.
 *  A kind+value already pilled is never offered. */
export function suggestFilters(text: string, pills: readonly Pill[], catalog: FilterCatalog): FilterSuggestion[] {
  const cands = candidates(text)
  if (cands.length === 0) return []
  const best = new Map<string, FilterSuggestion>()
  for (const entry of entries(catalog)) {
    if (pills.some((p) => p.kind === entry.pill.kind && p.value === entry.pill.value)) continue
    const key = `${entry.pill.kind}:${entry.pill.value}`
    for (const c of cands) {
      const exact = entry.names.includes(c.folded)
      const prefix = !exact && c.folded.length >= MIN_PREFIX && entry.names.some((n) => n.startsWith(c.folded))
      if (!exact && !prefix) continue
      const next: FilterSuggestion = { pill: entry.pill, start: c.start, end: c.end, exact }
      const prev = best.get(key)
      if (!prev || better(next, prev)) best.set(key, next)
    }
  }
  return [...best.values()].sort(compare).slice(0, MAX_SUGGESTIONS)
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
