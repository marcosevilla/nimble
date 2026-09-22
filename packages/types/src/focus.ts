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
