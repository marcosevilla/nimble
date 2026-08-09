/**
 * @nimble/types — Shared TypeScript types for the Nimble app.
 *
 * Used by both the desktop (Tauri) and mobile (Expo) apps.
 * These types mirror the Rust structs and SQLite schema.
 */

// ── Settings ──

export interface Setting {
  key: string
  value: string
}

// ── Obsidian ──

export interface CheckboxItem {
  line_number: number
  checked: boolean
  text: string
}

export interface ParsedTodayMd {
  tasks: CheckboxItem[]
  habits_core: CheckboxItem[]
  habits_bonus: CheckboxItem[]
}

// ── Calendar ──

export interface CalendarEvent {
  id: string
  summary: string
  description: string | null
  location: string | null
  start_time: string
  end_time: string
  all_day: boolean
  meeting_url: string | null
  date: string | null
  feed_label: string | null
  feed_color: string | null
}

export interface CalendarFeed {
  id: string
  label: string
  url: string
  color: string
  enabled: number
}

// ── Quick Captures (Legacy Obsidian) ──

export interface QuickCapture {
  timestamp: string | null
  content: string
}

// ── Priorities / Daily State ──

export interface Priority {
  title: string
  source: string
  reasoning: string
}

export interface DailyState {
  date: string
  energy_level: string | null
  priorities: Priority[] | null
  review_complete: boolean
}

// ── Projects ──

export interface Project {
  id: string
  name: string
  color: string
  position: number
  parent_id: string | null
  external_id: string | null
  external_source: string | null
  remote_updated_at: string | null
  synced_snapshot: string | null
}

// ── Local Tasks ──

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'complete'

export interface LocalTask {
  id: string
  parent_id: string | null
  content: string
  description: string | null
  project_id: string
  priority: number
  due_date: string | null
  due_time: string | null
  duration_minutes: number | null
  recurrence_rule: string | null
  section_id: string | null
  labels: string[]
  completed: boolean
  completed_at: string | null
  status: TaskStatus
  linked_doc_id: string | null
  position: number
  created_at: string
  updated_at: string
  external_id: string | null
  external_source: string | null
  remote_updated_at: string | null
  synced_snapshot: string | null
}

// ── Labels ──

export interface Label {
  id: string
  name: string
  color: string
  position: number
  created_at: string
}

// ── Sections ──

export interface Section {
  id: string
  project_id: string
  name: string
  position: number
  external_id: string | null
  external_source: string | null
  created_at: string
}

// ── Updater ──

export interface UpdateStatus {
  current_version: string
  latest_version: string | null
  update_available: boolean
  release_url: string | null
  error: string | null
}

// ── Progress ──

export interface SaveResult {
  snapshot_id: number
  session_log_path: string
}

// ── Activity Log ──

export interface ActivityEntry {
  id: string
  action_type: string
  target_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface ActivitySummary {
  action_type: string
  count: number
}

// ── Captures ──

export interface Capture {
  id: string
  content: string
  source: string
  converted_to_task_id: string | null
  routed_to: string | null
  context: string | null
  created_at: string
}

// ── Capture Routes ──

export interface CaptureRoute {
  id: string
  prefix: string
  target_type: 'doc' | 'task'
  doc_id: string | null
  label: string
  color: string
  icon: string
  position: number
  created_at: string
}

export interface RouteCaptureResult {
  routed_to: string
  target_type: string
  created_id: string
  label: string
}

// ── Docs ──

export interface DocFolder {
  id: string
  name: string
  position: number
  created_at: string
}

export interface Document {
  id: string
  title: string
  content: string
  folder_id: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface DocNote {
  id: string
  doc_id: string
  content: string
  position: number
  created_at: string
}

export interface FlaggedDoc {
  id: string
  title: string
  unknown_tags: string[]
}

export interface DocsMdPreview {
  total: number
  convertible: number
  already_plain: number
  flagged: FlaggedDoc[]
}

export interface DocsMdResult {
  converted: number
  skipped_plain: number
  backup_path: string
}

// ── Obsidian vault ──

export interface VaultNoteSummary {
  id: string
  path: string
  title: string
  updated_at: string
}

export interface VaultNoteDetail {
  id: string
  path: string
  title: string
  content: string
  frontmatter_json: string | null
  mtime: string | null
  size: number
  hash: string | null
  updated_at: string
  deleted_at: string | null
}

export interface VaultSearchHit {
  id: string
  path: string
  title: string
  snippet: string
}

export interface VaultScanReport {
  scanned: number
  indexed: number
  unchanged: number
  removed: number
  skipped: number
  /**
   * Directory-level walk failures. Any of these means the scan couldn't see the
   * whole vault, so it tombstoned nothing that pass.
   */
  walk_errors: number
}

export interface VaultStatus {
  configured: boolean
  root: string | null
  note_count: number
  last_scan_at: string | null
  last_error: string | null
  excludes: string[]
}

/** Discriminated on `kind` by the Rust `WriteOutcome` enum. */
export type VaultSaveResult =
  | { kind: 'written'; hash: string }
  | { kind: 'conflict'; conflict_path: string; disk_hash: string }

// ── Focus Mode ──

export interface FocusState {
  task_id: string | null
  started_at: string | null
  paused_at: string | null
}

// ── Goals ──

export type GoalStatus = 'not_started' | 'active' | 'paused' | 'achieved' | 'abandoned'

export interface Goal {
  id: string
  name: string
  description: string | null
  status: GoalStatus
  life_area_id: string | null
  start_date: string | null
  target_date: string | null
  color: string | null
  position: number
  created_at: string
  updated_at: string
}

export interface GoalWithProgress extends Goal {
  progress: number
  milestone_count: number
  milestone_completed: number
  task_count: number
  task_completed: number
}

export interface Milestone {
  id: string
  goal_id: string
  name: string
  target_date: string | null
  completed: boolean
  completed_at: string | null
  position: number
  created_at: string
}

export interface LifeArea {
  id: string
  name: string
  color: string
  icon: string
  position: number
  created_at: string
}

// ── Habits ──

export interface Habit {
  id: string
  name: string
  category: string | null
  icon: string
  color: string
  active: boolean
  position: number
  created_at: string
}

export interface HabitWithStats extends Habit {
  current_momentum: number
  today_completed: boolean
  today_intensity: number
}

export interface HabitLog {
  id: string
  habit_id: string
  date: string
  intensity: number
  created_at: string
}

export interface HabitHeatmapEntry {
  date: string
  intensity: number
}

// ── Import ──

export interface ImportSummary {
  goals_created: number
  habits_created: number
}

// ── Todoist Migration ──

export interface TodoistMigrationOptions {
  flatten_nested_projects: boolean
  create_section_projects: boolean
  preserve_labels: boolean
  preserve_recurring: boolean
}

export interface TodoistMigrationPreview {
  projects_to_create: number
  projects_already_migrated: number
  tasks_to_create: number
  tasks_already_migrated: number
  sections_count: number
  tasks_with_labels: number
  tasks_recurring: number
  tasks_with_subtasks: number
  project_names_preview: string[]
}

export interface TodoistMigrationResult {
  projects_created: number
  projects_updated: number
  tasks_created: number
  tasks_updated: number
  recurring_preserved: number
  labels_preserved: number
  errors: string[]
}

// ── Sync ──

export interface SyncStatus {
  pending_changes: number
  last_sync: string | null
  device_id: string
  turso_configured: boolean
  remote_initialized: boolean
}

export interface SyncResult {
  pushed: number
  pulled: number
}

// ── Todoist Sync ──

export interface SyncReport {
  skipped: string | null
  pushed: number
  created: number
  updated: number
  deleted: number
  projects_upserted: number
}

export interface TodoistSyncStatus {
  enabled: boolean
  connected: boolean
  last_sync_at: string | null
  last_error: string | null
  pending_ops: number
  error_ops: number
  errors: [string, string, string][]
}
