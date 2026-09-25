/* Label taxonomy (C4): grouped ordering, "Pick one", system and archived
   visibility, the picker's create/restore action. Pure; node tests import
   it (tests/labelTaxonomy.test.mjs), so type-only imports and no `@/`. */
import type { Label, LabelGroup } from '@nimble/types'

export interface LabelSection {
  /** null = Ungrouped. */
  group: LabelGroup | null
  labels: Label[]
}

export interface ManagerModel {
  /** Regular groups by position, empty ones included (drop targets). */
  groups: LabelSection[]
  ungrouped: Label[]
  /** System groups by position, empty ones included. */
  system: LabelSection[]
  archived: Label[]
}

type Ordered = { position: number; created_at: string }
const byPosition = (a: Ordered, b: Ordered) => a.position - b.position || a.created_at.localeCompare(b.created_at)

function indexGroups(groups: LabelGroup[], hidden: ReadonlySet<string> = new Set()): Map<string, LabelGroup> {
  return new Map(groups.filter((g) => !hidden.has(g.id)).map((g) => [g.id, g]))
}

/** The label's group; null when ungrouped or when its group id dangles. */
export function groupOf(label: Label, groupsById: ReadonlyMap<string, LabelGroup>): LabelGroup | null {
  return label.group ? groupsById.get(label.group) ?? null : null
}

function sections(labels: Label[], groups: LabelGroup[], includeSystem: boolean, keep: ReadonlySet<string> = new Set()): LabelSection[] {
  const byId = indexGroups(groups)
  const visible = labels.filter((l) => !l.archived_at || keep.has(l.id)).sort(byPosition)
  const ordered = [...byId.values()].sort(byPosition)
  const of = (group: LabelGroup): LabelSection => ({ group, labels: visible.filter((l) => l.group === group.id) })
  return [
    ...ordered.filter((g) => !g.system).map(of),
    { group: null, labels: visible.filter((l) => groupOf(l, byId) === null) },
    ...(includeSystem ? ordered.filter((g) => g.system).map(of) : []),
  ].filter((s) => s.labels.length > 0)
}

/** Picker: regular groups, then Ungrouped. No system, archived or empty sections. */
export function pickerSections(labels: Label[], groups: LabelGroup[]): LabelSection[] {
  return sections(labels, groups, false)
}

/** Label filter: like the picker, plus system groups last. Archived labels
 *  are hidden unless in `selected` (an active filter must stay removable). */
export function filterSections(labels: Label[], groups: LabelGroup[], selected: ReadonlySet<string> = new Set()): LabelSection[] {
  return sections(labels, groups, true, selected)
}

/** Only the Ungrouped bucket (e.g. a profile with no groups): render without headers. */
export function isFlat(list: LabelSection[]): boolean {
  return list.length <= 1 && (list[0]?.group ?? null) === null
}

export function managerSections(labels: Label[], groups: LabelGroup[], hiddenGroupIds: ReadonlySet<string> = new Set()): ManagerModel {
  const byId = indexGroups(groups, hiddenGroupIds)
  const sorted = [...labels].sort(byPosition)
  const live = sorted.filter((l) => !l.archived_at)
  const ordered = [...byId.values()].sort(byPosition)
  const of = (group: LabelGroup): LabelSection => ({ group, labels: live.filter((l) => l.group === group.id) })
  return {
    groups: ordered.filter((g) => !g.system).map(of),
    ungrouped: live.filter((l) => groupOf(l, byId) === null),
    system: ordered.filter((g) => g.system).map(of),
    archived: sorted.filter((l) => l.archived_at),
  }
}

/** Row chips: the task's labels in taxonomy order (group position, then
 *  label position, ungrouped last), system hidden, archived kept. */
export function orderTaskLabels(labelIds: readonly string[], labels: Label[], groups: LabelGroup[]): Label[] {
  const byId = indexGroups(groups)
  const rank = new Map<string, number>()
  ;[...byId.values()].filter((g) => !g.system).sort(byPosition).forEach((g, i) => rank.set(g.id, i))
  const rankOf = (l: Label) => {
    const group = groupOf(l, byId)
    return group ? rank.get(group.id) ?? rank.size : rank.size
  }
  return labels
    .filter((l) => labelIds.includes(l.id) && !groupOf(l, byId)?.system)
    .sort((a, b) => rankOf(a) - rankOf(b) || byPosition(a, b))
}

/** The task's system-group labels (task detail shows them muted, read-only). */
export function systemTaskLabels(labelIds: readonly string[], labels: Label[], groups: LabelGroup[]): Label[] {
  const byId = indexGroups(groups)
  return labels.filter((l) => labelIds.includes(l.id) && !!groupOf(l, byId)?.system).sort(byPosition)
}

/** Toggle one label, honouring "Pick one": applying a label of an exclusive
 *  group removes that group's other labels. Ids the picker doesn't show
 *  (system, archived) are always kept. */
export function toggleLabel(selected: readonly string[], labelId: string, labels: Label[], groups: LabelGroup[]): string[] {
  if (selected.includes(labelId)) return selected.filter((id) => id !== labelId)
  const label = labels.find((l) => l.id === labelId)
  const group = label ? groupOf(label, indexGroups(groups)) : null
  if (!group?.exclusive) return [...selected, labelId]
  const siblings = new Set(labels.filter((l) => l.group === group.id).map((l) => l.id))
  return [...selected.filter((id) => !siblings.has(id)), labelId]
}

export type CreateAction =
  | { kind: 'none' }
  | { kind: 'apply'; label: Label }
  | { kind: 'restore'; label: Label }
  | { kind: 'create'; name: string }
  /** The name belongs to a system label: the picker shows a neutral hint. */
  | { kind: 'system'; label: Label }

/** What Enter (and the list's last row) does with the typed text: apply an
 *  exact, case-insensitive visible match; restore an archived match (creating
 *  it would hit labels.name UNIQUE); create a new ungrouped label. A system
 *  label's name only earns a hint — system labels stay out of the picker. */
export function pickerCreateAction(query: string, labels: Label[], groups: LabelGroup[]): CreateAction {
  const name = query.trim()
  if (!name) return { kind: 'none' }
  const match = labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
  if (!match) return { kind: 'create', name }
  if (groupOf(match, indexGroups(groups))?.system) return { kind: 'system', label: match }
  return match.archived_at ? { kind: 'restore', label: match } : { kind: 'apply', label: match }
}

/** The row Enter acts on while typing (Linear / Raycast): an exact visible
 *  match, else an exact archived match's Restore row, else the first match,
 *  else the Create row. `'action'` = the Restore/Create row; null = nothing. */
export function defaultHighlight(matches: readonly Label[], action: CreateAction): string | 'action' | null {
  if (action.kind === 'apply' && matches.some((l) => l.id === action.label.id)) return action.label.id
  if (action.kind === 'restore') return 'action'
  if (matches.length > 0) return matches[0].id
  return action.kind === 'create' ? 'action' : null
}

/** After restoring an archived label from the picker: apply it, but never
 *  toggle it off when the task already carries it (its chip was showing). */
export function applyRestored(selected: readonly string[], labelId: string, labels: Label[], groups: LabelGroup[]): string[] {
  return selected.includes(labelId) ? [...selected] : toggleLabel(selected, labelId, labels, groups)
}
