/* Omnibar search fan-out (spec 2026-09-25 §1.4, §2): which groups a query
   shows, one parallel request per source, a failed source becomes an empty
   group (reported to the caller's logger, never a toast), label pills AND
   together, a pill-only query browses tasks, and per-group caps. Pure over
   injected sources — tests/omnibarSearch.test.mjs. The debounce and the
   stale-response guard live in hooks/useOmnibarResults.ts. */
import type { Capture, Document, Goal, LocalTask, OmnibarCapability, TaskSearchFilters, TaskSearchHit, VaultSearchHit } from '@nimble/types'
import type { BarMode } from './commandBarMode.ts'
import type { Pill, PillFilters, TypeValue } from './omnibarQuery.ts'
import { hasTaskFilters, pillFilters } from './omnibarQuery.ts'

export type GroupKey = 'tasks' | 'notes' | 'docs' | 'goals' | 'actions'

export const GROUP_ORDER: readonly GroupKey[] = ['tasks', 'notes', 'docs', 'goals', 'actions']

export const GROUP_TITLE: Record<GroupKey, string> = {
  tasks: 'Tasks',
  notes: 'Notes',
  docs: 'Docs',
  goals: 'Goals',
  actions: 'Actions',
}

export const GROUP_LIMIT = 5
export const OMNIBAR_DEBOUNCE_MS = 120
/** Per-source fetch size: enough for "Show all N" without paging. */
export const SOURCE_LIMIT = 50

export type DocHit =
  | { backend: 'native'; doc: Document }
  | { backend: 'vault'; note: VaultSearchHit }

export interface FetchedResults {
  tasks: TaskSearchHit[]
  notes: Capture[]
  docs: DocHit[]
  goals: Goal[]
}

export const EMPTY_RESULTS: FetchedResults = { tasks: [], notes: [], docs: [], goals: [] }

export interface SearchSources {
  searchTasks(query: string, filters: TaskSearchFilters): Promise<TaskSearchHit[]>
  listTasks(opts: { includeCompleted: boolean; projectId?: string }): Promise<LocalTask[]>
  searchNotes(query: string): Promise<Capture[]>
  searchDocs(query: string): Promise<Document[]>
  searchVault(query: string): Promise<VaultSearchHit[]>
  searchGoals(query: string): Promise<Goal[]>
}

export interface SearchPlan {
  text: string
  filters: PillFilters
  /** Groups this query shows, in display order (Actions included). */
  groups: GroupKey[]
}

export type SourceLogger = (source: string, error: unknown) => void

const TYPE_GROUP: Record<TypeValue, GroupKey> = { task: 'tasks', note: 'notes', doc: 'docs', goal: 'goals', action: 'actions' }

export function planSearch(opts: { text: string; pills: readonly Pill[]; mode: BarMode; capability: OmnibarCapability }): SearchPlan {
  const filters = pillFilters(opts.pills)
  const available = GROUP_ORDER.filter((g) => (g !== 'docs' || opts.capability.docs) && (g !== 'goals' || opts.capability.goals))
  const type = filters.type
  let groups: GroupKey[]
  if (opts.mode === 'task' || opts.mode === 'capture' || opts.mode === 'route' || opts.mode === 'breakdown') groups = []
  else if (opts.mode === 'doc') groups = available.filter((g) => g === 'docs')
  else if (type) groups = available.filter((g) => g === TYPE_GROUP[type])
  else groups = [...available]
  // Status / label / project narrow tasks only; other groups can't match them.
  if (hasTaskFilters(filters)) groups = groups.filter((g) => g === 'tasks')
  return { text: opts.text.trim(), filters, groups }
}

/** False when nothing needs fetching: an empty query (recents + actions) or Actions alone. */
export function needsFetch(plan: SearchPlan): boolean {
  const fetched = plan.groups.some((g) => g !== 'actions')
  return fetched && (plan.text !== '' || hasTaskFilters(plan.filters))
}

/** Every label pill must be on the task (the backend filter is any-of). */
export function matchesAllLabels(task: LocalTask, labelIds: readonly string[]): boolean {
  return labelIds.every((id) => task.labels.includes(id))
}

/** Pill-only query (no text for FTS): apply the pills here, open first. */
export function browseTasks(tasks: readonly LocalTask[], f: PillFilters): TaskSearchHit[] {
  const kept = tasks.filter((t) => {
    const done = t.status === 'complete'
    if (f.status === 'open' && done) return false
    if (f.status === 'completed' && !done) return false
    if (f.projectId && t.project_id !== f.projectId) return false
    return matchesAllLabels(t, f.labelIds)
  })
  const ordered = [...kept.filter((t) => t.status !== 'complete'), ...kept.filter((t) => t.status === 'complete')]
  return ordered.map((task): TaskSearchHit => ({ task, snippet: null, matched_in: 'title' }))
}

async function settle<T>(source: string, run: () => Promise<T[]>, log: SourceLogger): Promise<T[]> {
  try {
    return await run()
  } catch (e) {
    log(source, e)
    return []
  }
}

const none = <T>(): Promise<T[]> => Promise.resolve([])

export async function runSearch(plan: SearchPlan, src: SearchSources, log: SourceLogger): Promise<FetchedResults> {
  if (!needsFetch(plan)) return EMPTY_RESULTS
  const want = new Set(plan.groups)
  const q = plan.text
  const f = plan.filters
  const byText = q !== ''
  // Only the first label pill goes to the backend: its filter is any-of and
  // capped at SOURCE_LIMIT, so sending every label could fill the cap with
  // tasks that hold just one of them. The rest AND client-side below.
  const taskFilter: TaskSearchFilters = { status: f.status, label_ids: f.labelIds.slice(0, 1), project_id: f.projectId }
  const listOpts = f.projectId ? { includeCompleted: f.status !== 'open', projectId: f.projectId } : { includeCompleted: f.status !== 'open' }
  const tasks: Promise<TaskSearchHit[]> = !want.has('tasks')
    ? none<TaskSearchHit>()
    : byText
      ? settle('tasks', () => src.searchTasks(q, taskFilter), log).then((hits) => hits.filter((h) => matchesAllLabels(h.task, f.labelIds)))
      : settle('tasks', () => src.listTasks(listOpts), log).then((all) => browseTasks(all, f))
  const [taskHits, notes, native, vault, goals] = await Promise.all([
    tasks,
    want.has('notes') && byText ? settle('notes', () => src.searchNotes(q), log) : none<Capture>(),
    want.has('docs') && byText ? settle('docs', () => src.searchDocs(q), log) : none<Document>(),
    want.has('docs') && byText ? settle('vault', () => src.searchVault(q), log) : none<VaultSearchHit>(),
    want.has('goals') && byText ? settle('goals', () => src.searchGoals(q), log) : none<Goal>(),
  ])
  return {
    tasks: taskHits,
    notes,
    docs: [
      ...native.map((doc): DocHit => ({ backend: 'native', doc })),
      ...vault.map((note): DocHit => ({ backend: 'vault', note })),
    ],
    goals,
  }
}

/** Up to `limit` rows; `more` is the full count for "Show all N" (0 when nothing is hidden). */
export function capGroup<T>(items: readonly T[], expanded: boolean, limit = GROUP_LIMIT): { shown: T[]; more: number } {
  if (expanded || items.length <= limit) return { shown: [...items], more: 0 }
  return { shown: items.slice(0, limit), more: items.length }
}
