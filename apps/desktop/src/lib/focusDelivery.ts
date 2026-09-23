/**
 * Pure helpers for the delivery review. The Rust service owns every rule
 * (eligibility, adoption refusal, keys); these only label items and gate the
 * form. Type imports only so node:test can load it directly.
 */
import type { FocusDeliveryResolution, FocusDeliveryReviewItem, FocusDeliveryState } from '@nimble/types'

export const DELIVERY_STATE_LABEL: Record<FocusDeliveryState, string> = {
  pending: 'Waiting for the next sync',
  sending: 'Sending',
  acknowledged: 'Delivered',
  uncertain: 'Unknown: may have arrived',
  'retryable-error': 'Will retry',
  'needs-review': 'Needs review',
  archived: 'Archived',
}

const PURPOSE: Record<string, string> = {
  time_comment: 'Time comment',
  legacy_close: 'Old Focus Queue close',
  legacy_comment: 'Old Focus Queue comment',
}

export function purposeLabel(item: FocusDeliveryReviewItem): string {
  return PURPOSE[item.purpose] ?? 'Old Focus Queue operation'
}

export const RESOLUTION_LABEL: Record<FocusDeliveryResolution, string> = {
  acknowledged: 'It arrived',
  adopt_verified_undelivered: 'Send it',
  archive_with_reason: 'Archive',
}

export function needsAttention(item: FocusDeliveryReviewItem): boolean {
  return item.state === 'uncertain' || item.state === 'needs-review'
}

/** Decisions the backend can accept for this item's state. */
export function availableResolutions(item: FocusDeliveryReviewItem): FocusDeliveryResolution[] {
  if (item.state === 'acknowledged' || item.state === 'archived' || item.state === 'sending') return []
  // An old close is never replayed; only comments can be re-armed.
  return item.adoptable && item.purpose !== 'legacy_close'
    ? ['acknowledged', 'adopt_verified_undelivered', 'archive_with_reason']
    : ['acknowledged', 'archive_with_reason']
}

/**
 * An unresolved old close on a one-off, still-open Nimble task can be settled
 * by completing the task natively: its normal task sync sends the close. Never
 * for a repeating task (that would close a later occurrence).
 */
export function canCompleteNatively(item: FocusDeliveryReviewItem): boolean {
  return item.purpose === 'legacy_close' && item.native_task_id != null && !item.recurring_task
    && !item.task_completed && item.state !== 'acknowledged' && item.state !== 'archived'
}

/** Every decision records what was checked; sending also needs an explicit verification. */
export function canResolve(resolution: FocusDeliveryResolution, evidence: string, verifiedUndelivered: boolean): boolean {
  if (evidence.trim().length === 0) return false
  return resolution !== 'adopt_verified_undelivered' || verifiedUndelivered
}

const ORDER: Record<FocusDeliveryState, number> = {
  'needs-review': 0, uncertain: 1, 'retryable-error': 2, pending: 3, sending: 4, acknowledged: 5, archived: 6,
}

/** Attention first; otherwise the backend's order is kept. */
export function sortForReview(items: FocusDeliveryReviewItem[]): FocusDeliveryReviewItem[] {
  return items.map((item, i) => ({ item, i }))
    .sort((a, b) => ORDER[a.item.state] - ORDER[b.item.state] || a.i - b.i)
    .map(({ item }) => item)
}
