export type FocusMode = 'count_up' | 'timebox' | 'pomodoro'
export type FocusPhase = 'idle' | 'work' | 'break' | 'round_ready' | 'work_ready'
export type FocusStatus = 'paused' | 'running' | 'ended'
export type FocusSource = { kind: 'today' } | { kind: 'project'; project_id: string } | { kind: 'local' }
export interface FocusConfig { mode: FocusMode; budget_ms: number | null; work_ms: number; break_ms: number; rounds: number }
export interface FocusEntry { id: string; task_id: string; occurrence_id: string; added_at: string; source: FocusSource; explicit_still_open: boolean; config: FocusConfig }
export interface FocusSession { id: string; occurrence_id: string; status: FocusStatus; phase: FocusPhase; work_ms: number; break_ms: number; round_work_ms: number; round: number; config: FocusConfig }
export interface FocusSnapshot { queue_revision: number; engine_revision: number; owner_epoch: string; process_generation: number; writer_device_id: string; queue: FocusEntry[]; selected_occurrence_id: string | null; session: FocusSession | null; totals: Record<string, number>; as_of: string; checkpoint_at: string | null; recovery_reason: string | null; replica: boolean }
export interface FocusCapabilities { queue_read: boolean; queue_write: boolean; history_read: boolean; live_timing: boolean; companion: boolean; import: boolean; reason: string | null }
export type FocusAction =
  | { kind: 'enqueue'; task_ids: string[]; source: FocusSource; explicit_still_open: boolean }
  | { kind: 'reorder'; entry_ids: string[] }
  | { kind: 'promote' | 'remove' | 'start' | 'complete'; occurrence_id: string }
  | { kind: 'pause' | 'resume' | 'stop' | 'skip' | 'start_break' | 'end_break' }
  | { kind: 'configure'; occurrence_id: string; config: FocusConfig }
  | { kind: 'archive_history'; occurrence_ids: string[] }
  | { kind: 'undo_delete'; token: string }
export interface FocusCommand { command_id: string; expected_engine_revision: number; expected_queue_revision: number; owner_epoch: string; process_generation: number; session_id: string | null; action: FocusAction }
export interface FocusReply { snapshot: FocusSnapshot; replayed: boolean; committed_revision: number }
export interface FocusHistoryRow { occurrence_id: string; task_id: string | null; title: string; total_ms: number; recorded_ms: number; imported_ms: number; completed_at: string | null; archived: boolean }
export interface FocusHistoryPage { rows: FocusHistoryRow[]; next_cursor: string | null }
export type FocusErrorCode = 'conflict' | 'wrong_owner' | 'stale_occurrence' | 'not_found' | 'invalid' | 'unsupported' | 'storage' | 'needs_review'
export interface FocusError { code: FocusErrorCode; message: string }

// ── Frozen Focus Queue import (desktop only; mirrors focus_types.rs) ──
/** The three legacy files the user picked. `config.json` is never accepted. */
export interface LegacyFocusFiles { source_namespace: string; state_json: string | null; manual_json: string | null; pending_json: string | null }
export type ImportInclusion = 'included' | 'excluded' | 'unresolved'
export type ImportRecordStatus = 'included' | 'excluded' | 'unresolved' | 'quarantined'
export type ImportChange = 'new' | 'unchanged' | 'changed'
export type ImportSeverity = 'blocking' | 'review'
export type ImportTaskAction = 'create' | 'reuse' | 'unchanged' | 'unresolved'
export interface FocusImportIssue { severity: ImportSeverity; record_key: string | null; message: string }
export interface FocusImportDestination { queue_revision: number; engine_revision: number; tasks_fingerprint: string }
export interface FocusImportTaskProposal { legacy_task_id: string; native_task_id: string | null; action: ImportTaskAction; title: string | null; completed_at: string | null; differences: string[] }
export interface FocusImportOrderItem { legacy_task_id: string | null; task_id: string; title: string; origin: 'existing' | 'source' | 'manual' }
export interface FocusImportContribution { record_key: string; legacy_task_id: string; task_id: string | null; occurrence_id: string | null; duration_ms: number; completed_at: string | null; source_kind: 'completion' | 'timer'; inclusion: ImportInclusion; reason: string; replaces_ms: number | null }
export interface FocusImportRecordPreview { record_key: string; kind: string; status: ImportRecordStatus; change: ImportChange; fingerprint: string; reason: string; raw_evidence: unknown }
export interface FocusImportPreview {
  preview_token: string
  source_namespace: string
  file_hashes: Record<string, string>
  destination: FocusImportDestination
  source_kind: string | null
  source_order: string[]
  manual_order: string[]
  merged_order: FocusImportOrderItem[]
  tasks: FocusImportTaskProposal[]
  contributions: FocusImportContribution[]
  records: FocusImportRecordPreview[]
  issues: FocusImportIssue[]
  legacy_completed_today: number | null
  blocked: boolean
  noop: boolean
}
/** Optional Todoist time-comment / legacy pending-send lifecycle (Rust `DeliveryState`). */
export type FocusDeliveryState = 'pending' | 'sending' | 'acknowledged' | 'uncertain' | 'retryable-error' | 'needs-review' | 'archived'
export type FocusDeliveryResolution = 'acknowledged' | 'adopt_verified_undelivered' | 'archive_with_reason'
export interface FocusDeliveryReviewItem {
  id: string
  origin: 'focus' | 'legacy_import'
  purpose: 'time_comment' | 'legacy_close' | 'legacy_comment' | string
  state: FocusDeliveryState
  native_task_id: string | null
  task_title: string | null
  external_id: string | null
  occurrence_id: string | null
  occurrence_title: string | null
  content: string | null
  recorded_ms: number | null
  budget_ms: number | null
  attempts: number
  last_error: string | null
  next_attempt_at: string | null
  remote_receipt: string | null
  evidence: unknown
  created_at: string
  resolution: Record<string, unknown> | null
  recurring_task: boolean
  task_completed: boolean
  adoptable: boolean
  adopt_blocked_reason: string | null
}
export interface FocusImportResult { batch_id: string | null; replayed: boolean; noop: boolean; created_task_ids: string[]; queued_task_ids: string[]; included_ms: number; quarantined_records: number }
