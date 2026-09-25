/* The Omnibar's one keyboard list (spec 2026-09-25 §1.4–1.7): sections in
   display order (Filters, Recent, Tasks, Notes, Docs, Goals, Actions,
   Create), flattened so ↑/↓ walk across groups, plus where the highlight
   lands when the query changes. Pure — tests/omnibarRows.test.mjs. */
import type { Capture, Goal, TaskSearchHit } from '@nimble/types'
import type { OmnibarAction } from './omnibarActions.ts'
import type { CreateKind } from './omnibarCreate.ts'
import type { FilterSuggestion } from './omnibarQuery.ts'
import type { DocHit, FetchedResults, GroupKey } from './omnibarSearch.ts'
import { capGroup, GROUP_TITLE } from './omnibarSearch.ts'

export type OmnibarRow =
  | { kind: 'filter'; key: string; suggestion: FilterSuggestion }
  | { kind: 'recent'; key: string; query: string }
  | { kind: 'task'; key: string; hit: TaskSearchHit }
  | { kind: 'note'; key: string; capture: Capture }
  | { kind: 'doc'; key: string; doc: DocHit }
  | { kind: 'goal'; key: string; goal: Goal }
  | { kind: 'action'; key: string; action: OmnibarAction }
  /** "Show all N": `next` is the first hidden row, highlighted after expanding. */
  | { kind: 'more'; key: string; group: GroupKey; total: number; next: string }
  | { kind: 'create'; key: string; create: CreateKind }

export type SectionKey = 'filters' | 'recent' | GroupKey | 'create'

export interface RowSection {
  key: SectionKey
  title: string
  rows: OmnibarRow[]
}

export interface SectionInput {
  suggestions: readonly FilterSuggestion[]
  /** Recent searches: the caller passes them only for an empty query with no pills. */
  recent: readonly string[]
  results: FetchedResults
  actions: readonly OmnibarAction[]
  groups: readonly GroupKey[]
  expanded: ReadonlySet<GroupKey>
  creates: readonly CreateKind[]
}

function groupRows(group: GroupKey, r: FetchedResults, actions: readonly OmnibarAction[]): OmnibarRow[] {
  switch (group) {
    case 'tasks':
      return r.tasks.map((hit): OmnibarRow => ({ kind: 'task', key: `task:${hit.task.id}`, hit }))
    case 'notes':
      return r.notes.map((capture): OmnibarRow => ({ kind: 'note', key: `note:${capture.id}`, capture }))
    case 'docs':
      return r.docs.map((doc): OmnibarRow => ({
        kind: 'doc',
        key: doc.backend === 'native' ? `doc:${doc.doc.id}` : `vault:${doc.note.path}`,
        doc,
      }))
    case 'goals':
      return r.goals.map((goal): OmnibarRow => ({ kind: 'goal', key: `goal:${goal.id}`, goal }))
    case 'actions':
      return actions.map((action): OmnibarRow => ({ kind: 'action', key: `action:${action.id}`, action }))
  }
}

export function buildSections(input: SectionInput): RowSection[] {
  const out: RowSection[] = []
  if (input.suggestions.length > 0) {
    out.push({
      key: 'filters',
      title: 'Filters',
      rows: input.suggestions.map((s): OmnibarRow => ({ kind: 'filter', key: `filter:${s.pill.kind}:${s.pill.value}`, suggestion: s })),
    })
  }
  if (input.recent.length > 0) {
    out.push({ key: 'recent', title: 'Recent', rows: input.recent.map((q): OmnibarRow => ({ kind: 'recent', key: `recent:${q}`, query: q })) })
  }
  for (const group of input.groups) {
    const all = groupRows(group, input.results, input.actions)
    const { shown, more } = capGroup(all, input.expanded.has(group))
    if (shown.length === 0) continue
    const rows: OmnibarRow[] = [...shown]
    if (more > 0) rows.push({ kind: 'more', key: `more:${group}`, group, total: more, next: all[shown.length].key })
    out.push({ key: group, title: GROUP_TITLE[group], rows })
  }
  if (input.creates.length > 0) {
    out.push({ key: 'create', title: 'Create', rows: input.creates.map((c): OmnibarRow => ({ kind: 'create', key: `create:${c}`, create: c })) })
  }
  return out
}

export function flattenRows(sections: readonly RowSection[]): OmnibarRow[] {
  return sections.flatMap((s) => s.rows)
}

const RESULT_KINDS: ReadonlySet<OmnibarRow['kind']> = new Set(['task', 'note', 'doc', 'goal', 'action', 'recent'])

/** Where the highlight lands after the query changes: the first result, else
 *  the first create row, else the first row; -1 for an empty list. */
export function defaultIndex(rows: readonly OmnibarRow[]): number {
  const result = rows.findIndex((r) => RESULT_KINDS.has(r.kind))
  if (result >= 0) return result
  const create = rows.findIndex((r) => r.kind === 'create')
  if (create >= 0) return create
  return rows.length > 0 ? 0 : -1
}

/** The highlighted index: the row the user moved to while it still exists, else the default. */
export function selectedIndex(rows: readonly OmnibarRow[], picked: string | null): number {
  if (picked) {
    const i = rows.findIndex((r) => r.key === picked)
    if (i >= 0) return i
  }
  return defaultIndex(rows)
}

/** The key ↑/↓ moves to (wrapping), or null when there are no rows. */
export function moveSelection(rows: readonly OmnibarRow[], current: number, delta: 1 | -1): string | null {
  if (rows.length === 0) return null
  const from = current < 0 ? (delta === 1 ? -1 : 0) : current
  return rows[(from + delta + rows.length) % rows.length].key
}

/** The results scroller's id (`role="listbox"`, the combobox's aria-controls). */
export const OMNIBAR_LISTBOX_ID = 'omnibar-listbox'

/** DOM id of the option at flat index `index` — index-based because row keys
 *  hold vault paths ("/" and spaces). Target of aria-activedescendant. */
export function optionId(index: number): string {
  return `omnibar-option-${index}`
}

/** Rows that came from a fetched source (Tasks, Notes, Docs, Goals and their
 *  "Show all"). They go stale while a newer query is in flight; filters,
 *  recents, actions and create rows are derived synchronously from the text. */
export function isFetchedRow(row: OmnibarRow): boolean {
  if (row.kind === 'more') return row.group !== 'actions'
  return row.kind === 'task' || row.kind === 'note' || row.kind === 'doc' || row.kind === 'goal'
}

/** After a fresh search: the row the user chose if it is still there, the
 *  default row when nothing was chosen, otherwise nothing (never a stand-in). */
export function freshRow(rows: readonly OmnibarRow[], key: string | null): OmnibarRow | null {
  if (key !== null) return rows.find((r) => r.key === key) ?? null
  const i = defaultIndex(rows)
  return i >= 0 ? rows[i] : null
}
