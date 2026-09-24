/**
 * Focus source candidates. A source (Today / project / local-only) only
 * proposes candidates; it never replaces or reorders the shared queue.
 * "Queue these" is an explicit enqueue built once, in candidate order, with
 * the source captured at intent time.
 *
 * IDs are opaque strings throughout — never coerced to numbers or sorted.
 * Type-only imports keep this loadable directly by node:test.
 */
import type { FocusAction, FocusSnapshot, FocusSource, LocalTask, Section } from '@nimble/types'
import { UNSECTIONED, laneKeyOf, orderedSections } from './sectionLanes.ts'

export interface FocusCandidates {
  /** Queueable now, in candidate order, children folded under candidate ancestors. */
  ids: string[]
  /** Earlier open work (Today only), shown in the collapsed "Still open" drawer. */
  still_open_ids: string[]
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The local calendar date (YYYY-MM-DD) a due value falls on. Date-only and
 * floating datetimes keep their written date (never parsed as UTC midnight);
 * an instant with an offset is converted to the app's local timezone.
 */
export function localDueDate(due: string): string | null {
  if (DATE_ONLY.test(due)) return due
  if (HAS_OFFSET.test(due)) {
    const at = new Date(due)
    if (Number.isNaN(at.getTime())) return null
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  }
  const head = due.slice(0, 10)
  return DATE_ONLY.test(head) ? head : null
}

const isOpen = (task: LocalTask) => !task.completed && task.status !== 'complete'

/** Drop tasks with an ancestor in `anchors` (walks the full parent chain). */
function foldChildren(ids: string[], anchors: ReadonlySet<string>, byId: ReadonlyMap<string, LocalTask>): string[] {
  return ids.filter((id) => {
    const seen = new Set<string>([id])
    let parent = byId.get(id)?.parent_id ?? null
    while (parent != null && !seen.has(parent)) {
      if (anchors.has(parent)) return false
      seen.add(parent)
      parent = byId.get(parent)?.parent_id ?? null
    }
    return true
  })
}

/**
 * Project order exactly as the project view renders it: section lanes via
 * the shared `sectionLanes` order, then `position` within a lane (stable).
 */
function projectOrder(tasks: LocalTask[], sections: readonly Section[]): LocalTask[] {
  const lanes = [UNSECTIONED, ...orderedSections(sections).map((s) => s.id)]
  const rank = new Map(lanes.map((key, index) => [key, index]))
  const known = new Set(sections.map((s) => s.id))
  return tasks
    .map((t, index) => ({ t, index, lane: rank.get(laneKeyOf(t, known)) ?? 0 }))
    .sort((a, b) => a.lane - b.lane || a.t.position - b.t.position || a.index - b.index)
    .map(({ t }) => t)
}

/**
 * Candidate membership for a source. `today` is the user's local calendar
 * date (YYYY-MM-DD). Today and local-only keep the caller's display order;
 * project uses project order (section lanes, then `position`), which needs
 * that project's `sections`.
 */
export function candidateIds(
  tasks: LocalTask[],
  source: FocusSource,
  today: string,
  sections: readonly Section[] = [],
): FocusCandidates {
  const open = tasks.filter(isOpen)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  let ids: string[] = []
  let stillOpen: string[] = []

  if (source.kind === 'today') {
    for (const task of open) {
      const date = task.due_date ? localDueDate(task.due_date) : null
      if (date == null) continue // undated work is not a Today candidate
      if (date === today) ids.push(task.id)
      else if (date < today) stillOpen.push(task.id)
    }
  } else if (source.kind === 'project') {
    const inProject = open.filter((t) => t.project_id === source.project_id)
    ids = projectOrder(inProject, sections.filter((s) => s.project_id === source.project_id)).map((t) => t.id)
  } else {
    ids = open.filter((t) => t.sync_policy === 'local_only').map((t) => t.id)
  }

  // Fold within each group so a child never vanishes into a hidden drawer.
  ids = foldChildren(ids, new Set(ids), byId)
  stillOpen = foldChildren(stillOpen, new Set(stillOpen), byId)
  return { ids, still_open_ids: stillOpen }
}

const copySource = (source: FocusSource): FocusSource =>
  source.kind === 'project' ? { kind: 'project', project_id: source.project_id } : { kind: source.kind }

/**
 * Build the explicit "Queue these" intent: candidate order once, omitting
 * tasks already queued and children of a queued (or co-queued) ancestor.
 * The source is copied now, so a later source switch cannot move the
 * result. `stillOpen` queues the drawer instead and flags it explicit.
 * Returns null when nothing new would be added.
 */
export function queueTheseAction(
  tasks: LocalTask[],
  source: FocusSource,
  today: string,
  snapshot: FocusSnapshot,
  opts: { stillOpen?: boolean; sections?: readonly Section[] } = {},
): Extract<FocusAction, { kind: 'enqueue' }> | null {
  const candidates = candidateIds(tasks, source, today, opts.sections)
  const picked = opts.stillOpen ? candidates.still_open_ids : candidates.ids
  const queued = new Set(snapshot.queue.map((entry) => entry.task_id))
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const task_ids = foldChildren(picked.filter((id) => !queued.has(id)), queued, byId)
  if (task_ids.length === 0) return null
  return { kind: 'enqueue', task_ids, source: copySource(source), explicit_still_open: opts.stillOpen === true }
}

export interface FocusAddState {
  /** "Add all" intent for the current source, or null when nothing is new. */
  queueThese: Extract<FocusAction, { kind: 'enqueue' }> | null
  /** Source tasks not already queued (the "Add all N" count). */
  newCount: number
  /** Everything the source offers, queued or not. */
  sourceCount: number
  /** Earlier open work offered by the Today source, minus what's queued. */
  stillOpen: LocalTask[]
}

/**
 * What the `+` add panel offers for one source. Project sources order by
 * that project's sections; still-open work is offered only from Today.
 */
export function focusAddState(
  tasks: LocalTask[],
  source: FocusSource,
  today: string,
  snapshot: FocusSnapshot,
  sections: readonly Section[],
): FocusAddState {
  const sourceSections = source.kind === 'project' ? sections.filter((s) => s.project_id === source.project_id) : []
  const queueThese = queueTheseAction(tasks, source, today, snapshot, { sections: sourceSections })
  const sourceCount = candidateIds(tasks, source, today, sourceSections).ids.length
  const queued = new Set(snapshot.queue.map((e) => e.task_id))
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const stillOpen =
    source.kind === 'today'
      ? candidateIds(tasks, source, today)
          .still_open_ids.filter((id) => !queued.has(id))
          .flatMap((id) => byId.get(id) ?? [])
      : []
  return { queueThese, newCount: queueThese?.task_ids.length ?? 0, sourceCount, stillOpen }
}
