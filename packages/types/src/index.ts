/**
 * @nimble/types — Shared TypeScript types for the Nimble app.
 *
 * Used by both the desktop (Tauri) and mobile (Expo) apps.
 * These types mirror the Rust structs and SQLite schema.
 */

// ── DataProvider ──
// The one cross-client data-access contract. Lives in its own module so the
// domain types below stay importable without pulling in the interface.
export type { DataProvider } from './data-provider'
export type * from './focus'

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

// ── Briefs ──

export interface BriefTaskRef {
  id: string
  content: string
  due_date: string | null
  priority: number
  project_id: string
}

export interface BriefHabitRef {
  id: string
  name: string
  icon: string
  color: string
  done: boolean
}

/** Frozen per-module payloads keyed by module id (snapshot_schema 1).
 *  Every key is optional: a module that was off that morning is absent. */
export interface BriefSnapshotV1 {
  schedule?: { events: CalendarEvent[]; tomorrow: CalendarEvent[] }
  priorities?: Priority[] | null
  due_today?: BriefTaskRef[]
  still_open?: { total: number; oldest: BriefTaskRef[] }
  habits?: BriefHabitRef[] | null
  weather?: WeatherSnapshot | null
  [module: string]: unknown
}

export interface Brief {
  date: string
  version: number
  status: 'ready' | 'partial' | 'fallback' | 'failed'
  source: 'nimble' | 'legacy_vault'
  /** Phase-1 rows hold module ids; phase-2+ rows the entries used that
   *  morning. Always read it through `normalizeLayout` (lib/briefLayout). */
  layout: string[] | BriefLayoutEntry[]
  snapshot: BriefSnapshotV1
  snapshot_schema: number
  /** Today's scratchpad (the `notes` module). */
  notes: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  /** Why the last attempt fell back (`no_key`, `offline`, `refusal`, …). */
  error_code: string | null
  /** Set once the AI slots were composed (AI or rule-based); null = shell only. */
  composed_at: string | null
  compose_attempts: number
  generated_at: string
  updated_at: string
}

/** `snapshot_json.compose`: the day's AI output that isn't a row. */
export interface BriefCompose {
  summary: string
  origin: 'ai' | 'rule'
  /** Task ids of this week's wins (read by phase 4). */
  wins: string[]
}

export type BriefItemKind = 'priority' | 'quick_help' | 'quick_self'
export type BriefItemActionState = 'none' | 'produced' | 'dismissed' | 'confirmed'

/** The task a brief item points at, as it is now. */
export interface BriefItemTask {
  status: TaskStatus
  completed: boolean
  due_date: string | null
  content: string
  description: string | null
  project_id: string
}

export interface BriefItem {
  id: string
  date: string
  module_id: string
  kind: BriefItemKind
  /** The task title when the brief was composed. */
  title: string
  /** The one-line reason. */
  body: string | null
  task_id: string | null
  origin: 'ai' | 'rule'
  dedupe_key: string | null
  action_kind: string | null
  action_state: BriefItemActionState
  /** JSON: what an action produced (Break it down → subtask ids). */
  produced_ref: string | null
  position: number
  created_at: string
  updated_at: string
  /** The brief's `composed_at` when this row was written: lists show the
   *  current composition plus acted-on rows only (two Macs never merge). */
  composed_at: string | null
  /** Null when the task no longer exists. */
  task: BriefItemTask | null
}

// ── Brief settings (phase 2, addendum §1–§2) ──

export type BriefModuleKind = 'fixed' | 'live' | 'ai'
export type BriefIntegration = 'calendar' | 'tasks' | 'vault' | 'ai' | 'location'
export type ConfigChoiceValue = string | number
export type ConfigField =
  | { type: 'bool'; key: string; label: string; default: boolean }
  | { type: 'choice'; key: string; label: string; options: { value: ConfigChoiceValue; label: string }[]; default: ConfigChoiceValue }
  | { type: 'label'; key: string; label: string; default_name: string }
export interface ModuleManifest {
  id: string
  name: string
  kind: BriefModuleKind
  requires: BriefIntegration[]
  default_enabled: boolean
  config_schema: ConfigField[]
}
export interface BriefLayoutEntry {
  id: string
  enabled: boolean
  config: Record<string, unknown>
}
export interface BriefLocation {
  name: string
  lat: number
  lon: number
  tz: string
}
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface BriefGoals {
  daily: number
  weekly: number
  days_off: Weekday[]
}
export interface BriefSources {
  calendar: boolean
  tasks: boolean
  vault: boolean
  ai: boolean
}
export type BriefModel = 'claude-opus-5-5' | 'claude-sonnet-5'
export type BriefEffort = 'low' | 'medium' | 'high'
export interface BriefSettings {
  time: string
  location: BriefLocation | null
  /** Resolved: every registered module, stored order first, config filled. */
  modules: BriefLayoutEntry[]
  model: BriefModel
  effort: BriefEffort
  setup_completed_at: string | null
  goals: BriefGoals
  sources: BriefSources
  manifests: ModuleManifest[]
}
/** Omit a key to keep it; `location: null` clears. One save = one transaction. */
export interface BriefSettingsPatch {
  time?: string
  location?: BriefLocation | null
  modules?: BriefLayoutEntry[]
  model?: BriefModel
  effort?: BriefEffort
  goals?: Partial<BriefGoals>
  complete_setup?: boolean
}
export interface BriefSettingsCapability {
  supported: boolean
  get(): Promise<BriefSettings>
  save(patch: BriefSettingsPatch): Promise<BriefSettings>
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
  archived_at: string | null
}

// ── Local Tasks ──

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'complete'

export interface LocalTask {
  sync_policy: 'default' | 'local_only'
  reminder_offset_minutes: number | null
  google_calendar_enabled: boolean
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

export interface FlaggedTask {
  id: string
  content: string
  unknown_tags: string[]
}

export interface TasksMdPreview {
  total: number
  convertible: number
  already_plain: number
  flagged: FlaggedTask[]
}

export interface TasksMdResult {
  converted: number
  skipped_plain: number
  backup_path: string
}

// ── Labels ──

export interface Label {
  /** `label_groups.id`; a dangling id reads as ungrouped. */
  group: string | null
  /** Set = archived: hidden from pickers and the filter, still shown on tasks. */
  archived_at: string | null
  id: string
  name: string
  color: string
  position: number
  created_at: string
}

export interface LabelGroup {
  id: string
  name: string
  position: number
  /** "Pick one": the UI keeps at most one of this group's labels per task. */
  exclusive: boolean
  /** Integration labels: hidden from pickers and row chips. */
  system: boolean
  created_at: string
  updated_at: string
}

export interface LabelGroupPatch {
  name?: string
  exclusive?: boolean
  system?: boolean
  position?: number
}

export type TaskSearchStatus = 'all' | 'open' | 'completed'

export interface TaskSearchFilters {
  status?: TaskSearchStatus
  /** Any-of. */
  label_ids?: string[]
  project_id?: string | null
}

export interface TaskSearchHit {
  task: LocalTask
  /** Description excerpt with U+0002 … U+0003 around matches; null for title matches. */
  snippet: string | null
  matched_in: 'title' | 'description'
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

/**
 * @deprecated The legacy single-task focus marker. The desktop and web no
 * longer read it (the durable focus engine owns timing); kept only for the
 * dormant mobile provider copy.
 */
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

// Desktop backup status. Null counts mean unavailable, never zero.
export interface BackupStatus {
  running: boolean
  disabled_reason: string | null
  last_local_success_at: string | null
  last_push_at: string | null
  export_commit: string | null
  backup_directory: string
  retained_count: number | null
  remote_configured: boolean
  remote_name: string | null
  turso_pending: number | null
  todoist_pending: number | null
  todoist_failed: number | null
  /** A restored profile: sync, backups, reminders and focus writes stay off until activated. */
  restore_activation_required: boolean
  error: { stage: string; code: string; at: string } | null
}
export interface BackupCapability {
  supported: boolean
  status(): Promise<BackupStatus>
  runNow(): Promise<BackupStatus>
  verifyLatest(): Promise<{ verified: boolean }>
  openFolder(): Promise<void>
  configureRemote(ownerRepo: string): Promise<BackupStatus>
  /** Explicitly activate a restored profile on this Mac. Idempotent; starts nothing. */
  activateRestoredProfile(): Promise<BackupStatus>
}

export interface ReminderStatus { permission: 'granted' | 'denied' | 'unknown'; timezone: string; errorCode: string | null }
export interface ReminderCatchUpItem { errorCode?: string | null; occurrenceKey: string; taskId: string; title: string; scheduledAt: string }
export interface ReminderCapability {
  supported: boolean
  getStatus(): Promise<ReminderStatus>
  requestPermission(): Promise<ReminderStatus>
  listCatchUp(): Promise<ReminderCatchUpItem[]>
  acknowledge(occurrenceKey: string): Promise<void>
}

export interface GoogleConnectionStatus { connected: boolean; clientSecretConfigured: boolean; calendarLabel: string | null; timezone: string; errorCode: string | null }
export interface GoogleCalendarConflict { taskId: string; reason: string; local: unknown; remote: unknown; createdAt: string }
export interface GoogleCalendarCapability {
  supported: boolean
  getStatus(): Promise<GoogleConnectionStatus>
  configure(clientId: string, clientSecret: string): Promise<GoogleConnectionStatus>
  connect(): Promise<GoogleConnectionStatus>
  disconnect(): Promise<GoogleConnectionStatus>
  syncNow(): Promise<{ changedTaskIds: string[]; errorCode: string | null }>
  listConflicts(): Promise<GoogleCalendarConflict[]>
  resolveConflict(taskId: string, resolution: 'keep_nimble' | 'use_calendar'): Promise<void>
}

// ── Weather (phase 2, addendum §4) — temperatures in °C, converted for display ──

export interface WeatherDay {
  date: string
  high_c: number
  low_c: number
  precip_max: number | null
}
export interface WeatherHour {
  /** Location-local "YYYY-MM-DDTHH:MM". */
  time: string
  temp_c: number
  precip: number | null
}
export interface Forecast {
  timezone: string
  current_time: string | null
  current_c: number | null
  days: WeatherDay[]
  hourly: WeatherHour[]
}
export type WeatherStatus = 'no_location' | 'fresh' | 'stale' | 'unavailable'
export interface WeatherView {
  status: WeatherStatus
  location: BriefLocation | null
  forecast: Forecast | null
  /** RFC 3339 UTC. */
  fetched_at: string | null
}
export interface GeoPlace {
  name: string
  admin1: string | null
  country: string | null
  lat: number
  lon: number
  tz: string
}
/** `snapshot.weather`: the forecast the brief showed that morning. */
export interface WeatherSnapshot {
  location: BriefLocation
  forecast: Forecast
  fetched_at: string
}
export interface WeatherCapability {
  supported: boolean
  get(): Promise<WeatherView>
  geocode(query: string): Promise<GeoPlace[]>
}

// ── Momentum (spec 2026-09-23 §3.5, addendum 2026-09-25 §6; nimble-core/src/db/karma.rs) ──

export type MomentumRange = '7d' | '30d' | 'all'
export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface MomentumSettings {
  daily_goal: number
  weekly_goal: number
  days_off: WeekdayKey[]
  paused: boolean
  paused_at: string | null
  karma_enabled: boolean
  karma_enabled_at: string | null
}

export interface GoalTargets {
  daily: number
  weekly: number
  days_off: WeekdayKey[]
  karma_enabled: boolean
}

export interface MomentumTrendDay { date: string; done: number; day_off: boolean; paused: boolean }
export interface MomentumWin { task_id: string; content: string; priority: number; date: string }
export interface MomentumRangeStats { from: string | null; completed: number; active_days: number; peak_hour: number | null; focused_ms: number }
export interface KarmaParity { total: number; level: string; next_level_at: number | null; daily_streak: number; weekly_streak: number }

export interface MomentumSummary {
  today: string
  range: MomentumRange
  settings: MomentumSettings
  is_day_off: boolean
  today_done: number
  week_done: number
  week_start: string
  trend: MomentumTrendDay[]
  wins: MomentumWin[]
  stats: MomentumRangeStats
  /** Present only when karma parity mode is on. */
  karma: KarmaParity | null
}

export interface MomentumBackfillReport { tasks: number; recurrences: number; goal_days: number; goal_weeks: number }

/** Desktop computes momentum from its ledger; the web reports `supported: false`. */
export interface MomentumCapability {
  supported: boolean
  summary(range: MomentumRange): Promise<MomentumSummary>
  getSettings(): Promise<MomentumSettings>
  saveGoals(targets: GoalTargets): Promise<MomentumSettings>
  setPaused(paused: boolean): Promise<MomentumSettings>
  backfill(): Promise<MomentumBackfillReport>
}
