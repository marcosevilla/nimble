// task-view.ts — pure view-state helpers for the task list header (Task 5):
// grouping, filtering, and the localStorage persistence shape shared by
// ProjectDetailPage and TasksPage's All Tasks view.
import {
  differenceInCalendarDays,
  isPast,
  isToday,
  isTomorrow,
  parseISO,
} from 'date-fns'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import type { LocalTask, Section, TaskStatus } from '@nimble/types'

// ── Grouping ─────────────────────────────────────────────────────────────

export type GroupBy = 'status' | 'priority' | 'due' | 'section' | 'manual'

export interface TaskGroup {
  key: string
  title: string
  tasks: LocalTask[]
}

// Sentinel container id for tasks with no section — shared with
// SectionedTaskList, which special-cases this key to skip rendering a
// section header (an unlabeled top lane, matching pre-Task-5 behavior).
export const UNSECTIONED = '__unsectioned__'

const PRIORITY_GROUPS: { value: number; title: string }[] = [
  { value: 4, title: 'Urgent' },
  { value: 3, title: 'High' },
  { value: 2, title: 'Medium' },
  { value: 1, title: 'Normal' },
]

// No-guilt due-date buckets — "Overdue" is deliberately not a group title;
// see CLAUDE.md "Don't show 'overdue' labels — use neutral 'still open'
// framing."
const DUE_BUCKETS: { key: string; title: string }[] = [
  { key: 'still_open', title: 'Still open' },
  { key: 'today', title: 'Today' },
  { key: 'tomorrow', title: 'Tomorrow' },
  { key: 'this_week', title: 'This week' },
  { key: 'later', title: 'Later' },
  { key: 'no_date', title: 'No date' },
]

function dueBucketKey(task: LocalTask): string {
  if (!task.due_date) return 'no_date'
  const parsed = parseISO(task.due_date)
  if (isPast(parsed) && !isToday(parsed)) return 'still_open'
  if (isToday(parsed)) return 'today'
  if (isTomorrow(parsed)) return 'tomorrow'
  const days = differenceInCalendarDays(parsed, new Date())
  if (days > 1 && days <= 7) return 'this_week'
  return 'later'
}

function groupBySection(topLevel: LocalTask[], sections: Section[]): TaskGroup[] {
  const sorted = [...sections].sort((a, b) => a.position - b.position)
  const groups: TaskGroup[] = [{ key: UNSECTIONED, title: 'No section', tasks: [] }]
  for (const s of sorted) groups.push({ key: s.id, title: s.name, tasks: [] })

  const byKey = new Map(groups.map((g) => [g.key, g]))
  for (const t of topLevel) {
    const key = t.section_id && byKey.has(t.section_id) ? t.section_id : UNSECTIONED
    byKey.get(key)!.tasks.push(t)
  }
  return groups
}

/** Groups top-level tasks (subtasks nest under their parent row and are
 * never bucketed independently) into the sections the list header renders.
 * `status`/`priority`/`due` drop empty buckets to avoid clutter; `section`/
 * `manual` always render every section (including empty ones) plus the
 * unsectioned lane first, so a lane stays a valid drop target even at zero
 * tasks — `manual` is section grouping with drag enabled, so it produces
 * the identical bucket structure. */
export function groupTasks(tasks: LocalTask[], by: GroupBy, sections: Section[]): TaskGroup[] {
  const topLevel = tasks.filter((t) => !t.parent_id)

  switch (by) {
    case 'status':
      return STATUSES.map((s) => ({
        key: s.value,
        title: s.label,
        tasks: topLevel.filter((t) => t.status === s.value),
      })).filter((g) => g.tasks.length > 0)

    case 'priority':
      return PRIORITY_GROUPS.map((p) => ({
        key: String(p.value),
        title: p.title,
        tasks: topLevel.filter((t) => t.priority === p.value),
      })).filter((g) => g.tasks.length > 0)

    case 'due': {
      const buckets: Record<string, LocalTask[]> = {
        still_open: [],
        today: [],
        tomorrow: [],
        this_week: [],
        later: [],
        no_date: [],
      }
      for (const t of topLevel) buckets[dueBucketKey(t)].push(t)
      return DUE_BUCKETS.map((b) => ({ key: b.key, title: b.title, tasks: buckets[b.key] })).filter(
        (g) => g.tasks.length > 0,
      )
    }

    case 'section':
    case 'manual':
      return groupBySection(topLevel, sections)
  }
}

// ── Filtering ────────────────────────────────────────────────────────────

export interface TaskFilter {
  statuses: TaskStatus[]
  priorities: number[]
  labelIds: string[]
}

export const EMPTY_FILTER: TaskFilter = { statuses: [], priorities: [], labelIds: [] }

/** An empty facet array means that facet isn't filtering. Facets AND
 * together; values within a facet OR (e.g. status IN [todo, blocked]). */
export function filterTasks(tasks: LocalTask[], f: TaskFilter): LocalTask[] {
  return tasks.filter((t) => {
    if (f.statuses.length > 0 && !f.statuses.includes(t.status)) return false
    if (f.priorities.length > 0 && !f.priorities.includes(t.priority)) return false
    if (f.labelIds.length > 0 && !t.labels.some((id) => f.labelIds.includes(id))) return false
    return true
  })
}

// ── Persisted view state ────────────────────────────────────────────────

export interface TaskViewState {
  groupBy: GroupBy
  filter: TaskFilter
}

const STORAGE_PREFIX = 'nimble.taskview.'

/** `key` is a project id, or the literal `'all'` for the All Tasks view. */
export function loadTaskView(key: string, defaultGroupBy: GroupBy): TaskViewState {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return { groupBy: defaultGroupBy, filter: EMPTY_FILTER }
    const parsed = JSON.parse(raw) as Partial<TaskViewState>
    return {
      groupBy: parsed.groupBy ?? defaultGroupBy,
      filter: {
        statuses: parsed.filter?.statuses ?? [],
        priorities: parsed.filter?.priorities ?? [],
        labelIds: parsed.filter?.labelIds ?? [],
      },
    }
  } catch {
    return { groupBy: defaultGroupBy, filter: EMPTY_FILTER }
  }
}

export function saveTaskView(key: string, state: TaskViewState): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state))
  } catch {
    // Quiet by design — persistence is a nicety, not load-bearing.
  }
}
