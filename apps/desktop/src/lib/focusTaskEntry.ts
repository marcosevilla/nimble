/**
 * Visible focus entry points for one task (task rows, task detail): whether
 * the task is queued and what "Add to / Remove from focus queue" and "Focus
 * now" may do right now. Pure, so every state is testable without rendering.
 *
 * Visibility: a completed task shows no focus controls (the engine refuses
 * it without an explicit still-open choice). Row actions are hidden where
 * the queue is read-only (`writable` false, e.g. web); the detail control
 * stays visible there, disabled with the reason. A pending write or a
 * missing live-timing capability disables a control with its reason and
 * never hides it. Nothing here starts timing; only the explicit Focus now
 * control does, through the store.
 *
 * Type-only imports keep this loadable directly by node:test.
 */
import type { FocusCapabilities, FocusErrorCode, FocusSnapshot } from '@nimble/types'
import { queueBlockedReason } from './focusQueueIntents.ts'

/** What a row needs to know about the task's queue entry — primitives only. */
export interface FocusEntryState {
  occurrence_id: string
  /** The engine's selected entry: removing it pauses a live session. */
  selected: boolean
}

/**
 * The task's queue entry as primitives, or null when it is not queued. Two
 * snapshots that differ only in totals/heartbeat give shallow-equal results,
 * so a row selecting this does not re-render on every heartbeat.
 */
export function queuedEntryFor(snapshot: FocusSnapshot | null, taskId: string): FocusEntryState | null {
  const entry = snapshot?.queue.find((e) => e.task_id === taskId)
  if (!entry || !snapshot) return null
  return { occurrence_id: entry.occurrence_id, selected: snapshot.selected_occurrence_id === entry.occurrence_id }
}

/** Completed tasks are not focusable from entry points (no controls, `f` is a no-op). */
export function isFocusableTask(task: { completed: boolean; status?: string | null }): boolean {
  return !task.completed && task.status !== 'complete'
}

export const FOCUS_ENTRY_LABELS = {
  add: 'Add to focus queue',
  remove: 'Remove from focus queue',
  queued: 'In focus queue',
  focusNow: 'Focus now',
} as const

const PENDING_REASON = 'Still saving the previous focus change.'

export type FocusToggleControl =
  | { kind: 'enqueue'; label: string; disabled: boolean; reason: string | null }
  | { kind: 'remove'; label: string; disabled: boolean; reason: string | null; occurrence_id: string }

/**
 * The row's single icon: `add` (quiet), `remove` (queued, click removes) or
 * `open` (queued and selected — an indicator whose click opens the queue;
 * removing the selected entry is a menu-only action because it pauses a
 * live session).
 */
export type FocusRowIcon = 'add' | 'remove' | 'open'

export interface FocusTaskControls {
  /** False for a completed task: render no focus controls at all. */
  visible: boolean
  queued: boolean
  entry: FocusEntryState | null
  /** "In focus queue" when queued, else null. */
  status: string | null
  /** Queue writes are possible here at all (false on web / read-only). */
  writable: boolean
  rowIcon: FocusRowIcon
  toggle: FocusToggleControl
  focusNow: { label: string; disabled: boolean; reason: string | null }
}

export function focusTaskControls(input: {
  entry: FocusEntryState | null
  capabilities: FocusCapabilities | null
  /** A focus action is in flight (the store drops repeats). */
  pending: boolean
  /** `focusNowBlockedReason(capabilities)` from the store. */
  focusNowBlocked: string | null
  /** Completed (or status complete) tasks get no focus controls. */
  completed: boolean
}): FocusTaskControls {
  const { entry, capabilities, pending, focusNowBlocked, completed } = input
  const capabilityReason = queueBlockedReason(capabilities)
  const toggleReason = capabilityReason ?? (pending ? PENDING_REASON : null)
  const focusNowReason = focusNowBlocked ?? capabilityReason ?? (pending ? PENDING_REASON : null)
  const toggle: FocusToggleControl = entry
    ? { kind: 'remove', label: FOCUS_ENTRY_LABELS.remove, disabled: toggleReason != null, reason: toggleReason, occurrence_id: entry.occurrence_id }
    : { kind: 'enqueue', label: FOCUS_ENTRY_LABELS.add, disabled: toggleReason != null, reason: toggleReason }
  return {
    visible: !completed,
    queued: entry != null,
    entry,
    status: entry ? FOCUS_ENTRY_LABELS.queued : null,
    writable: capabilities?.queue_write ?? false,
    rowIcon: !entry ? 'add' : entry.selected ? 'open' : 'remove',
    toggle,
    focusNow: { label: FOCUS_ENTRY_LABELS.focusNow, disabled: focusNowReason != null, reason: focusNowReason },
  }
}

/**
 * Friendly toast copy for a failed focus entry write — never raw engine
 * text. `unsupported` carries our own capability reason, which is already
 * user-facing copy.
 */
export function focusEntryErrorMessage(error: { code?: FocusErrorCode | string; message?: string } | null | undefined): string {
  switch (error?.code) {
    case 'unsupported':
      return error.message || 'Focus isn’t available here.'
    case 'stale_occurrence':
      return 'This task changed, so the focus queue wasn’t updated.'
    case 'not_found':
      return 'That task isn’t available for focus right now.'
    case 'conflict':
    case 'wrong_owner':
      return 'Focus changed somewhere else. Try again.'
    case 'storage':
      return 'Couldn’t save the focus change. Try again.'
    default:
      return 'Couldn’t update the focus queue.'
  }
}
