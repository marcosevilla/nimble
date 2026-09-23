/**
 * Visible focus entry points for one task (task rows, task detail): whether
 * the task is queued and what "Add to / Remove from focus queue" and "Focus
 * now" may do right now. Pure, so every state is testable without
 * rendering. Controls are never hidden for a capability or a pending write —
 * they are disabled with the reason. Nothing here starts timing; only the
 * explicit Focus now control does, through the store.
 *
 * Type-only imports keep this loadable directly by node:test.
 */
import type { FocusCapabilities, FocusEntry, FocusSnapshot } from '@nimble/types'
import { queueBlockedReason } from './focusQueueIntents.ts'

/** The queue entry holding this task, or null when it is not queued. */
export function queuedEntryFor(snapshot: FocusSnapshot | null, taskId: string): FocusEntry | null {
  return snapshot?.queue.find((e) => e.task_id === taskId) ?? null
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

export interface FocusTaskControls {
  queued: boolean
  entry: FocusEntry | null
  /** "In focus queue" when queued, else null. */
  status: string | null
  /** Queue writes are possible here at all (false on web / read-only). */
  writable: boolean
  toggle: FocusToggleControl
  focusNow: { label: string; disabled: boolean; reason: string | null }
}

export function focusTaskControls(input: {
  snapshot: FocusSnapshot | null
  capabilities: FocusCapabilities | null
  /** A focus action is in flight (the store drops repeats). */
  pending: boolean
  /** `focusNowBlockedReason(capabilities)` from the store. */
  focusNowBlocked: string | null
  taskId: string
}): FocusTaskControls {
  const { snapshot, capabilities, pending, focusNowBlocked, taskId } = input
  const entry = queuedEntryFor(snapshot, taskId)
  const capabilityReason = queueBlockedReason(capabilities)
  const toggleReason = capabilityReason ?? (pending ? PENDING_REASON : null)
  const focusNowReason = focusNowBlocked ?? capabilityReason ?? (pending ? PENDING_REASON : null)
  const toggle: FocusToggleControl = entry
    ? { kind: 'remove', label: FOCUS_ENTRY_LABELS.remove, disabled: toggleReason != null, reason: toggleReason, occurrence_id: entry.occurrence_id }
    : { kind: 'enqueue', label: FOCUS_ENTRY_LABELS.add, disabled: toggleReason != null, reason: toggleReason }
  return {
    queued: entry != null,
    entry,
    status: entry ? FOCUS_ENTRY_LABELS.queued : null,
    writable: capabilities?.queue_write ?? false,
    toggle,
    focusNow: { label: FOCUS_ENTRY_LABELS.focusNow, disabled: focusNowReason != null, reason: focusNowReason },
  }
}
