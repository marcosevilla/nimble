/**
 * Focus queue command intents. Pure mapping from what the user did on the
 * card/queue to exactly one FocusAction (or native task write), so the
 * components stay thin and every intent is testable without rendering.
 *
 * Invariants: order changes only from explicit user actions (drag handle,
 * keyboard move, promote); nothing here reads a clock or starts timing on
 * its own. Type-only imports keep this loadable directly by node:test.
 */
import type {
  DataProvider,
  FocusAction,
  FocusCapabilities,
  FocusConfig,
  FocusEntry,
  FocusSession,
  FocusSnapshot,
  FocusSource,
  LocalTask,
  Project,
  Section,
} from '@nimble/types'
import { format, parse, parseISO } from 'date-fns'
import { timerPresentation, type TimerPresentation } from './focusModel.ts'

const MINUTE_MS = 60_000

export const TIMEBOX_PRESETS = [15, 25, 45, 60] as const
/** Optional Pomodoro defaults (secondary control; count-up/timebox are primary). */
export const POMODORO_DEFAULT = { work_ms: 25 * MINUTE_MS, break_ms: 5 * MINUTE_MS, rounds: 4 }

// ── Labels ──

/** Neutral due cue: time when due today, else short date (+ time). Never "overdue". */
export function dueLabel(task: LocalTask, today: string): string | null {
  const time = task.due_time ? format(parse(task.due_time, 'HH:mm', new Date(2000, 0, 1)), 'h:mm a') : null
  if (!task.due_date) return time
  const date = task.due_date.slice(0, 10)
  if (date === today) return time ?? 'Today'
  const day = format(parseISO(date), 'MMM d')
  return time ? `${day} ${time}` : day
}

/** Tasks that live only in Nimble (never pushed to Todoist). */
export const NIMBLE_ONLY = 'Nimble only'

/**
 * Where the focused task lives, shown above its title: the project name, or
 * "Project / Section". A task whose project isn't known shows nothing.
 */
export function taskPlaceLabel(
  task: Pick<LocalTask, 'project_id' | 'section_id'>,
  projects: Pick<Project, 'id' | 'name'>[],
  sections: Pick<Section, 'id' | 'project_id' | 'name'>[],
): string | null {
  const project = task.project_id ? projects.find((p) => p.id === task.project_id) : undefined
  if (!project) return null
  const section = task.section_id
    ? sections.find((s) => s.id === task.section_id && s.project_id === project.id)
    : undefined
  return section ? `${project.name} / ${section.name}` : project.name
}

/**
 * A one-line-clamped description overflows when its content box is larger
 * than the clamped box (taller: more lines; wider: an unbreakable run).
 * Sub-pixel differences are layout noise, not overflow.
 */
export function descriptionOverflows(box: { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number }): boolean {
  return box.scrollHeight - box.clientHeight >= 1 || box.scrollWidth - box.clientWidth >= 1
}

export function sourceLabel(source: FocusSource, projects: Project[]): string {
  if (source.kind === 'today') return 'Today'
  if (source.kind === 'local') return NIMBLE_ONLY
  return projects.find((p) => p.id === source.project_id)?.name ?? 'Project'
}

/**
 * Footer add button copy. `newCount` = source tasks not yet queued;
 * `sourceCount` = all tasks the source offers. Plain, no guilt.
 */
export function addToQueueLabel(newCount: number, sourceCount: number): string {
  if (newCount > 0) return `Add ${newCount} to queue`
  return sourceCount > 0 ? 'All added' : 'Nothing to add'
}

// ── Timer control ──

export type TimerControlLabel = 'Start' | 'Pause' | 'Resume' | 'Start break' | 'End break' | 'Start next round'

export interface TimerControl {
  label: TimerControlLabel
  action: FocusAction
  /** Opens a live work/break segment, so it needs `capabilities.live_timing`. */
  live: boolean
}

/** The session belonging to this entry, if any (an ended session is history). */
export function sessionFor(snapshot: FocusSnapshot, entry: FocusEntry): FocusSession | null {
  const session = snapshot.session
  return session && session.occurrence_id === entry.occurrence_id && session.status !== 'ended' ? session : null
}

/** The one circular Start/Pause control for a card, from committed state only. */
export function timerControl(snapshot: FocusSnapshot, entry: FocusEntry): TimerControl {
  const session = sessionFor(snapshot, entry)
  const start: TimerControl = { label: 'Start', action: { kind: 'start', occurrence_id: entry.occurrence_id }, live: true }
  if (!session) return start
  if (session.phase === 'round_ready') return { label: 'Start break', action: { kind: 'start_break' }, live: true }
  if (session.phase === 'work_ready') return { ...start, label: 'Start next round' }
  if (session.phase === 'break') {
    return session.status === 'running'
      ? { label: 'End break', action: { kind: 'end_break' }, live: false }
      : { label: 'Resume', action: { kind: 'resume' }, live: true }
  }
  if (session.status === 'running') return { label: 'Pause', action: { kind: 'pause' }, live: false }
  return { label: 'Resume', action: { kind: 'resume' }, live: true }
}

const LIVE_UNAVAILABLE = 'Timing starts once the focus companion is ready.'
const READ_ONLY = 'Focus controls are read-only here.'

/** Why a control is disabled (rendered, never hidden); null = enabled. */
export function controlBlockedReason(control: { live: boolean } | null, caps: FocusCapabilities | null): string | null {
  if (!caps) return 'Focus is still loading.'
  if (!caps.queue_write) return caps.reason ?? READ_ONLY
  if (control?.live && !caps.live_timing) return caps.reason ?? LIVE_UNAVAILABLE
  return null
}

/** Queue writes (reorder, complete, enqueue, configure) need only queue_write. */
export function queueBlockedReason(caps: FocusCapabilities | null): string | null {
  return controlBlockedReason(null, caps)
}

// ── Timer display ──

export interface CardTiming {
  presentation: TimerPresentation
  /** Budget caption kept next to the timer ("25m timebox", "Round 2 of 4"). */
  caption: string | null
  config: FocusConfig
}

/**
 * `displayExtraMs` is display-only unsettled running time (see
 * `lib/focusDisplay.ts`), added to the quantity that ticks. Phase colors and
 * overtime derive from the interpolated value; a Pomodoro round never shows
 * more than its target (the engine caps it too).
 */
export function cardTiming(snapshot: FocusSnapshot, entry: FocusEntry, displayExtraMs = 0): CardTiming {
  const session = sessionFor(snapshot, entry)
  const config = session?.config ?? entry.config
  const extra = session?.status === 'running' ? Math.max(0, displayExtraMs) : 0
  const total = (snapshot.totals[entry.occurrence_id] ?? 0) + extra
  if (config.mode === 'pomodoro') {
    const round = session?.round ?? 1
    const onBreak = session?.phase === 'break'
    return {
      presentation: onBreak
        ? timerPresentation((session?.break_ms ?? 0) + extra, config.break_ms)
        : timerPresentation(Math.min((session?.round_work_ms ?? 0) + extra, config.work_ms), config.work_ms),
      caption: onBreak ? `Break · round ${round} of ${config.rounds}` : `Round ${round} of ${config.rounds}`,
      config,
    }
  }
  if (config.mode === 'timebox' && config.budget_ms != null) {
    return {
      presentation: timerPresentation(total, config.budget_ms),
      caption: `${Math.round(config.budget_ms / MINUTE_MS)}m timebox`,
      config,
    }
  }
  return { presentation: timerPresentation(total, null), caption: null, config }
}

// ── Timebox picker ──

export function timeboxConfig(config: FocusConfig, minutes: number | null): FocusConfig {
  return minutes == null
    ? { ...config, mode: 'count_up', budget_ms: null }
    : { ...config, mode: 'timebox', budget_ms: minutes * MINUTE_MS }
}

export function pomodoroConfig(config: FocusConfig): FocusConfig {
  const valid = config.work_ms >= MINUTE_MS && config.break_ms >= MINUTE_MS && config.rounds >= 1
  const base = valid ? config : { ...config, ...POMODORO_DEFAULT }
  return { mode: 'pomodoro', budget_ms: null, work_ms: base.work_ms, break_ms: base.break_ms, rounds: base.rounds }
}

/** Custom timebox: whole minutes 1–1,440, else null. */
export function parseCustomMinutes(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const minutes = Number(trimmed)
  return minutes >= 1 && minutes <= 1440 ? minutes : null
}

// ── Ordering (explicit user actions only) ──

/** Drag within Up next. The first entry is the card and never moves by drag. */
export function reorderAfterDrag(queue: FocusEntry[], activeId: string, overId: string): FocusAction | null {
  if (activeId === overId) return null
  const from = queue.findIndex((e) => e.id === activeId)
  const to = queue.findIndex((e) => e.id === overId)
  if (from < 1 || to < 1) return null
  const ids = queue.map((e) => e.id)
  ids.splice(from, 1)
  ids.splice(to, 0, activeId)
  return { kind: 'reorder', entry_ids: ids }
}

export type MoveDirection = 'up' | 'down' | 'bottom' | 'top'

/** Keyboard/menu move for an Up next row; `top` is the explicit promote. */
export function moveEntryAction(queue: FocusEntry[], entryId: string, direction: MoveDirection): FocusAction | null {
  const index = queue.findIndex((e) => e.id === entryId)
  if (index < 1) return null
  if (direction === 'top') return { kind: 'promote', occurrence_id: queue[index].occurrence_id }
  const target = direction === 'up' ? index - 1 : direction === 'down' ? index + 1 : queue.length - 1
  if (target < 1 || target >= queue.length || target === index) return null
  const ids = queue.map((e) => e.id)
  ids.splice(index, 1)
  ids.splice(target, 0, entryId)
  return { kind: 'reorder', entry_ids: ids }
}

// ── Up next roving focus ──
//
// Up next is one tab stop. Exactly one row is "current" (the roving stop);
// plain arrows move it, Alt+arrows reorder it (focus follows the row), Enter
// promotes it, Delete/Backspace removes it. A click only makes a row current:
// promotion by mouse is the explicit "Move to top" control.

export type QueueRowIntent =
  | { kind: 'focus'; index: number }
  | { kind: 'move'; direction: 'up' | 'down' }
  | { kind: 'promote' }
  | { kind: 'remove' }

export interface QueueKeyMods {
  alt?: boolean
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  /** Auto-repeat: never promotes or removes (one press, one action). */
  repeat?: boolean
}

/**
 * What a key on the current Up next row means, or null to leave the event
 * alone (no preventDefault). `index` is the row's position among `length`
 * Up next rows (the card's entry is not one of them, so a move can never
 * displace it: Alt+↑ on the first row is null). ⌘/Ctrl/⇧ combos stay with
 * the app's global shortcuts.
 */
export function queueRowKeyIntent(key: string, mods: QueueKeyMods, index: number, length: number): QueueRowIntent | null {
  if (length <= 0 || index < 0 || index >= length) return null
  if (mods.meta || mods.ctrl || mods.shift) return null
  if (mods.alt) {
    if (key === 'ArrowUp') return index > 0 ? { kind: 'move', direction: 'up' } : null
    if (key === 'ArrowDown') return index < length - 1 ? { kind: 'move', direction: 'down' } : null
    return null
  }
  switch (key) {
    case 'ArrowUp':
      return { kind: 'focus', index: Math.max(0, index - 1) }
    case 'ArrowDown':
      return { kind: 'focus', index: Math.min(length - 1, index + 1) }
    case 'Home':
      return { kind: 'focus', index: 0 }
    case 'End':
      return { kind: 'focus', index: length - 1 }
    case 'Enter':
      return mods.repeat ? null : { kind: 'promote' }
    case 'Delete':
    case 'Backspace':
      return mods.repeat ? null : { kind: 'remove' }
    default:
      return null
  }
}

/**
 * Undo of an Up next removal, step 1: put the task back in the queue with
 * its original source and still-open flag. This restores queue membership
 * only — the removed occurrence and its session have ended; the task comes
 * back as a new entry (its recorded time is kept in history).
 */
export function reenqueueAction(entry: FocusEntry): FocusAction {
  return { kind: 'enqueue', task_ids: [entry.task_id], source: entry.source, explicit_still_open: entry.explicit_still_open }
}

/**
 * Undo step 2: move the re-queued task's entry back to its prior queue
 * index. It never lands on index 0 (the card) — an Up next row was removed.
 */
export function restoreEntryAction(queue: FocusEntry[], taskId: string, index: number): FocusAction | null {
  let from = -1
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].task_id === taskId) { from = i; break }
  if (from < 1 || queue.length < 2) return null
  const to = Math.min(Math.max(index, 1), queue.length - 1)
  if (to === from) return null
  const ids = queue.map((e) => e.id)
  const [id] = ids.splice(from, 1)
  ids.splice(to, 0, id)
  return { kind: 'reorder', entry_ids: ids }
}

/** A click on a row (not on one of its controls) only makes it current. */
export function queueRowClickIntent(index: number): QueueRowIntent {
  return { kind: 'focus', index }
}

/**
 * The roving tab stop: the remembered current row if it is still queued,
 * else the row now at its old position, else the first row.
 */
export function queueTabStop(ids: readonly string[], current: { id: string | null; index: number }): string | null {
  if (ids.length === 0) return null
  if (current.id && ids.includes(current.id)) return current.id
  if (current.index >= 0) return ids[Math.min(current.index, ids.length - 1)]
  return ids[0]
}

// ── Menus ──

export type TaskMenuId =
  | 'copy_context' | 'open_details' | 'rename' | 'duplicate' | 'move_top' | 'move_bottom'
  | 'skip' | 'stop' | 'remove' | 'delete'

export interface TaskMenuItem { id: TaskMenuId; label: string; destructive?: boolean }

const MENU_LABEL: Record<TaskMenuId, string> = {
  copy_context: 'Copy assistant context',
  open_details: 'Open details',
  rename: 'Rename',
  duplicate: 'Duplicate',
  move_top: 'Move to top',
  move_bottom: 'Move to bottom',
  skip: 'Skip to bottom',
  stop: 'Stop',
  remove: 'Remove from queue',
  delete: 'Delete task',
}

export const isLocalOnly = (task: LocalTask): boolean => task.sync_policy === 'local_only'

/**
 * Menu for the card or an Up next row. Rename/duplicate/delete-with-Undo are
 * the local-only shortcuts; linked tasks use native detail and its
 * confirmation/outbox semantics instead.
 */
export function taskMenuItems(task: LocalTask, place: 'card' | 'row'): TaskMenuItem[] {
  const ids: TaskMenuId[] = ['copy_context', 'open_details']
  if (isLocalOnly(task)) ids.push('rename', 'duplicate')
  if (place === 'row') ids.push('move_top', 'move_bottom')
  else ids.push('skip', 'stop')
  ids.push('remove')
  if (isLocalOnly(task)) ids.push('delete')
  return ids.map((id) => ({ id, label: MENU_LABEL[id], destructive: id === 'delete' || undefined }))
}

/**
 * The queue action behind a menu item, or null for items that are native
 * task writes or UI (copy, details, rename, duplicate, delete).
 */
export function menuFocusAction(id: TaskMenuId, entry: FocusEntry, queue: FocusEntry[]): FocusAction | null {
  switch (id) {
    case 'move_top':
      return { kind: 'promote', occurrence_id: entry.occurrence_id }
    case 'move_bottom':
      return moveEntryAction(queue, entry.id, 'bottom')
    case 'skip':
      return { kind: 'skip' }
    case 'stop':
      return { kind: 'stop' }
    case 'remove':
      return { kind: 'remove', occurrence_id: entry.occurrence_id }
    default:
      return null
  }
}

/** Redeem a local delete's durable token (valid 10 s, restores paused). */
export const undoDeleteAction = (token: string): FocusAction => ({ kind: 'undo_delete', token })

/** Explicit still-open additions are flagged so the queue shows why they are there. */
export const stillOpenAction = (task_ids: string[]): FocusAction => ({
  kind: 'enqueue', task_ids, source: { kind: 'today' }, explicit_still_open: true,
})

// ── Failures ──

export interface FailureControl {
  message: string
  /** The failed envelope, only when the failure is uncertain (may have committed). */
  retry: unknown
}

/**
 * Uncertain (storage/transport) failures offer "Try again", which must
 * resubmit this same envelope via `retryFocusCommand` — never a new action.
 */
export function failureControl(error: { code: string; message: string; command?: unknown } | null): FailureControl | null {
  if (!error) return null
  const retry = error.code === 'storage' && error.command != null ? error.command : null
  return { message: error.code === 'stale_occurrence' ? STALE_OCCURRENCE_COPY : error.message, retry }
}

/**
 * A refused stale occurrence — e.g. a recurring task already completed on
 * another device, whose due date moved on. The engine detail is not copy.
 */
export const STALE_OCCURRENCE_COPY =
  'This task changed elsewhere (it may already be done on another device). Nothing was saved. Remove it from the queue and add it again to keep going.'


/**
 * Message a surface should keep for a failed write, or null when the error
 * is a typed focus failure: `sendFocusAction` already put it in the focus
 * cache, which clears it after a successful retry. Duplicating it locally
 * would leave a stale alert behind a command that did commit.
 */
export function localFailureMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) return null
  return error instanceof Error ? error.message : String(error)
}

/** What the tray shows: the cache's focus failure first, else a local one. */
export function visibleFailure(
  cacheError: { code: string; message: string; command?: unknown } | null,
  localError: string | null,
): FailureControl | null {
  return failureControl(cacheError) ?? (localError ? { message: localError, retry: null } : null)
}

// ── Quick add ──

export interface QuickAddRequest {
  content: string
  projectId?: string
  dueDate?: string
  syncPolicy?: 'local_only'
}

const EMPTY_ADD = 'Type a task first.'

const copySource = (source: FocusSource): FocusSource =>
  source.kind === 'project' ? { kind: 'project', project_id: source.project_id } : { kind: source.kind }

/**
 * One create per non-empty line, in input order. Today → Inbox + due today;
 * project → that project; local-only → unbound (sync_policy local_only).
 */
export function planQuickAdd(text: string, source: FocusSource, today: string): { requests: QuickAddRequest[]; error: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const requests = lines.map((content): QuickAddRequest => {
    if (source.kind === 'today') return { content, projectId: 'inbox', dueDate: today }
    if (source.kind === 'project') return { content, projectId: source.project_id }
    return { content, syncPolicy: 'local_only' }
  })
  return { requests, error: requests.length ? null : EMPTY_ADD }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Create each line, then append everything created to the queue in one
 * enqueue. The source is captured at submit, so a source switch while the
 * request is in flight cannot move the result. On failure the unsent lines
 * come back as `remaining` with the error; nothing typed is lost.
 */
export async function runQuickAdd(
  text: string,
  source: FocusSource,
  today: string,
  deps: { create: (req: QuickAddRequest) => Promise<LocalTask>; onAction: (action: FocusAction) => Promise<unknown> },
): Promise<{ remaining: string; error: string | null; created: number }> {
  const captured = copySource(source)
  const plan = planQuickAdd(text, captured, today)
  if (plan.error) return { remaining: text, error: plan.error, created: 0 }
  const created: string[] = []
  let error: string | null = null
  let remaining = ''
  for (let i = 0; i < plan.requests.length; i++) {
    try {
      created.push((await deps.create(plan.requests[i])).id)
    } catch (e) {
      error = `Couldn't add “${plan.requests[i].content}”: ${messageOf(e)}`
      remaining = plan.requests.slice(i).map((r) => r.content).join('\n')
      break
    }
  }
  if (created.length) {
    try {
      await deps.onAction({ kind: 'enqueue', task_ids: created, source: captured, explicit_still_open: false })
    } catch (e) {
      error = error ?? `Added to tasks but not queued: ${messageOf(e)}`
    }
  }
  return { remaining, error, created: created.length }
}

// ── Native task writes used by the focus surfaces ──

export interface FocusTaskOps {
  create(req: QuickAddRequest): Promise<LocalTask>
  /** Passes the displayed due date (stale-occurrence guard). */
  complete(task: LocalTask): Promise<void>
  rename(task: LocalTask, content: string): Promise<void>
  duplicate(task: LocalTask): Promise<LocalTask>
  /** Local-only delete; the token redeems `{kind:'undo_delete'}` for 10 s. */
  remove(task: LocalTask): Promise<{ undo_token: string | null }>
  openDetail(task: LocalTask): void
  writeClipboard: ((text: string) => Promise<void>) | undefined
}

type CreateInput = Parameters<DataProvider['tasks']['create']>[0]

/** Editable content only: fresh identity, no binding, no time or completion. */
export function duplicateInput(task: LocalTask): CreateInput {
  return {
    content: task.content,
    projectId: task.project_id,
    parentId: task.parent_id ?? undefined,
    description: task.description ?? undefined,
    priority: task.priority,
    dueDate: task.due_date ?? undefined,
    dueTime: task.due_time ?? undefined,
    durationMinutes: task.duration_minutes ?? undefined,
    recurrenceRule: task.recurrence_rule ?? undefined,
    sectionId: task.section_id ?? undefined,
    labelIds: task.labels.length ? task.labels : undefined,
    syncPolicy: 'local_only',
  }
}

export function focusTaskOps(
  dp: Pick<DataProvider, 'tasks'>,
  opts: { onChanged: () => void; openDetail: (task: LocalTask) => void; writeClipboard: FocusTaskOps['writeClipboard'] },
): FocusTaskOps {
  const changed = <T>(value: T): T => { opts.onChanged(); return value }
  return {
    create: async (req) => changed(await dp.tasks.create(req)),
    complete: async (task) => changed(await dp.tasks.complete(task.id, task.due_date ?? null)),
    rename: async (task, content) => {
      const next = content.trim()
      if (!next) throw new Error('A task name cannot be empty.')
      changed(await dp.tasks.update({ id: task.id, content: next }))
    },
    duplicate: async (task) => changed(await dp.tasks.create(duplicateInput(task))),
    remove: async (task) => changed(await dp.tasks.delete(task.id)),
    openDetail: opts.openDetail,
    writeClipboard: opts.writeClipboard,
  }
}
