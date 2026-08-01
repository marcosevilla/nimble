/**
 * @daily-triage/types — Shared TypeScript types for the Daily Triage app.
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

// ── Todoist ──

/** Store-ready type with boolean conversions (from TodoistTaskRow) */
export interface TodoistTask {
  id: string
  content: string
  description: string | null
  project_id: string | null
  project_name: string | null
  priority: number
  due_date: string | null
  due_is_recurring: boolean
  is_completed: boolean
  todoist_url: string | null
}

/** Raw row type from SQLite/Rust (integers for booleans) */
export interface TodoistTaskRow {
  id: string
  content: string
  description: string | null
  project_id: string | null
  project_name: string | null
  priority: number
  due_date: string | null
  due_is_recurring: number
  is_completed: number
  todoist_url: string | null
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
  completed: boolean
  completed_at: string | null
  status: TaskStatus
  linked_doc_id: string | null
  position: number
  created_at: string
  updated_at: string
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
