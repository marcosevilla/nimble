import { invoke } from '@tauri-apps/api/core'

// Re-export all types from the shared package so existing imports continue to work
export type {
  Setting,
  CheckboxItem,
  ParsedTodayMd,
  CalendarEvent,
  CalendarFeed,
  QuickCapture,
  Priority,
  DailyState,
  Project,
  TaskStatus,
  LocalTask,
  UpdateStatus,
  SaveResult,
  ActivityEntry,
  ActivitySummary,
  Capture,
  CaptureRoute,
  RouteCaptureResult,
  DocFolder,
  Document,
  DocNote,
  DocsMdPreview,
  DocsMdResult,
  VaultNoteSummary,
  VaultNoteDetail,
  VaultSearchHit,
  VaultScanReport,
  VaultStatus,
  VaultSaveResult,
  FocusState,
  GoalStatus,
  Goal,
  GoalWithProgress,
  Milestone,
  LifeArea,
  Habit,
  HabitWithStats,
  HabitLog,
  HabitHeatmapEntry,
  ImportSummary,
  SyncStatus,
  TodoistMigrationOptions,
  TodoistMigrationPreview,
  TodoistMigrationResult,
  SyncReport,
  TodoistSyncStatus,
} from '@nimble/types'

import type {
  Setting,
  ParsedTodayMd,
  TodoistMigrationOptions,
  TodoistMigrationPreview,
  TodoistMigrationResult,
  CalendarEvent,
  CalendarFeed,
  QuickCapture,
  Priority,
  DailyState,
  Project,
  TaskStatus,
  LocalTask,
  UpdateStatus,
  SaveResult,
  ActivityEntry,
  ActivitySummary,
  Capture,
  CaptureRoute,
  RouteCaptureResult,
  DocFolder,
  Document,
  DocNote,
  DocsMdPreview,
  DocsMdResult,
  VaultNoteSummary,
  VaultNoteDetail,
  VaultSearchHit,
  VaultScanReport,
  VaultStatus,
  VaultSaveResult,
  FocusState,
  GoalStatus,
  Goal,
  GoalWithProgress,
  Milestone,
  LifeArea,
  Habit,
  HabitWithStats,
  HabitLog,
  HabitHeatmapEntry,
  ImportSummary,
  SyncStatus,
  SyncReport,
  TodoistSyncStatus,
} from '@nimble/types'

// ── Settings ──

export async function checkSetupComplete(): Promise<boolean> {
  return invoke<boolean>('check_setup_complete')
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key })
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('set_setting', { key, value })
}

export async function getAllSettings(): Promise<Setting[]> {
  return invoke<Setting[]>('get_all_settings')
}

export async function clearAllSettings(): Promise<void> {
  return invoke<void>('clear_all_settings')
}

// ── Obsidian ──

export async function readTodayMd(): Promise<ParsedTodayMd> {
  return invoke<ParsedTodayMd>('read_today_md')
}

export async function toggleObsidianCheckbox(
  fileName: string,
  lineNumber: number,
): Promise<ParsedTodayMd> {
  return invoke<ParsedTodayMd>('toggle_obsidian_checkbox', {
    fileName,
    lineNumber,
  })
}

// ── Todoist ──

export async function previewTodoistMigration(): Promise<TodoistMigrationPreview> {
  return invoke<TodoistMigrationPreview>('preview_todoist_migration')
}

export async function migrateTodoist(options: TodoistMigrationOptions): Promise<TodoistMigrationResult> {
  return invoke<TodoistMigrationResult>('migrate_todoist', { options })
}

export async function migratedTodoistIds(): Promise<string[]> {
  return invoke<string[]>('migrated_todoist_ids')
}

// ── Calendar ──

export async function fetchCalendarEvents(date?: string): Promise<CalendarEvent[]> {
  return invoke<CalendarEvent[]>('fetch_calendar_events', { date })
}

export async function getCachedCalendarEvents(date: string): Promise<CalendarEvent[]> {
  return invoke<CalendarEvent[]>('get_cached_calendar_events', { date })
}

export async function getCalendarFeeds(): Promise<CalendarFeed[]> {
  return invoke<CalendarFeed[]>('get_calendar_feeds')
}

export async function addCalendarFeed(
  label: string,
  url: string,
  color: string,
): Promise<CalendarFeed> {
  return invoke<CalendarFeed>('add_calendar_feed', { label, url, color })
}

export async function removeCalendarFeed(feedId: string): Promise<void> {
  return invoke<void>('remove_calendar_feed', { feedId })
}

// ── Session Log ──
export async function readSessionLog(): Promise<string | null> {
  return invoke<string | null>('read_session_log')
}

// ── Daily Brief ──

export async function readDailyBrief(date?: string): Promise<string | null> {
  return invoke<string | null>('read_daily_brief', { date })
}

export async function listBriefDates(): Promise<string[]> {
  return invoke<string[]>('list_brief_dates')
}

// ── Quick Captures ──

export async function readQuickCaptures(): Promise<QuickCapture[]> {
  return invoke<QuickCapture[]>('read_quick_captures')
}

export async function writeQuickCapture(content: string): Promise<QuickCapture> {
  return invoke<QuickCapture>('write_quick_capture', { content })
}

// ── Priorities ──

export async function getDailyState(): Promise<DailyState> {
  return invoke<DailyState>('get_daily_state')
}

export async function generatePriorities(
  energyLevel: string,
  calendarSummary: string,
  tasksSummary: string,
  obsidianSummary: string,
): Promise<Priority[]> {
  return invoke<Priority[]>('generate_priorities', {
    energyLevel,
    calendarSummary,
    tasksSummary,
    obsidianSummary,
  })
}

// ── Projects ──

export async function getProjects(): Promise<Project[]> {
  return invoke<Project[]>('get_projects')
}

export async function createProject(name: string, color: string): Promise<Project> {
  return invoke<Project>('create_project', { name, color })
}

export async function updateProject(id: string, name?: string, color?: string): Promise<void> {
  return invoke<void>('update_project', { id, name, color })
}

export async function deleteProject(id: string): Promise<void> {
  return invoke<void>('delete_project', { id })
}

// ── Local Tasks ──

export async function getLocalTasks(opts?: {
  projectId?: string
  dueDate?: string
  includeCompleted?: boolean
}): Promise<LocalTask[]> {
  return invoke<LocalTask[]>('get_local_tasks', {
    projectId: opts?.projectId,
    dueDate: opts?.dueDate,
    includeCompleted: opts?.includeCompleted,
  })
}

export async function createLocalTask(opts: {
  content: string
  projectId?: string
  parentId?: string
  description?: string
  priority?: number
  dueDate?: string
}): Promise<LocalTask> {
  return invoke<LocalTask>('create_local_task', {
    content: opts.content,
    projectId: opts.projectId,
    parentId: opts.parentId,
    description: opts.description,
    priority: opts.priority,
    dueDate: opts.dueDate,
  })
}

export async function updateLocalTask(opts: {
  id: string
  content?: string
  description?: string
  projectId?: string
  priority?: number
  dueDate?: string
  clearDueDate?: boolean
  linkedDocId?: string | null
}): Promise<LocalTask> {
  return invoke<LocalTask>('update_local_task', opts)
}

export async function updateTaskStatus(id: string, status: TaskStatus, note?: string): Promise<void> {
  return invoke<void>('update_task_status', { id, status, note })
}

export async function completeLocalTask(id: string): Promise<void> {
  return invoke<void>('complete_local_task', { id })
}

export async function uncompleteLocalTask(id: string): Promise<void> {
  return invoke<void>('uncomplete_local_task', { id })
}

export async function deleteLocalTask(id: string): Promise<void> {
  return invoke<void>('delete_local_task', { id })
}

export async function reorderLocalTasks(taskIds: string[]): Promise<void> {
  return invoke<void>('reorder_local_tasks', { taskIds })
}

// ── Open URL ──
export async function openUrl(url: string): Promise<void> {
  return invoke<void>('open_url', { url })
}

// ── Updater ──

export async function checkForUpdates(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>('check_for_updates')
}

// ── Progress ──

export async function saveProgress(
  tasksCompleted: string,
  tasksOpen: string,
  tasksDeferred: string,
): Promise<SaveResult> {
  return invoke<SaveResult>('save_progress', {
    tasksCompleted,
    tasksOpen,
    tasksDeferred,
  })
}

// ── Activity Log ──

export async function logActivity(
  actionType: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return invoke<void>('log_activity', { actionType, targetId, metadata })
}

export async function getActivityLog(opts: {
  fromDate: string
  toDate: string
  actionType?: string
  targetId?: string
  limit?: number
}): Promise<ActivityEntry[]> {
  return invoke<ActivityEntry[]>('get_activity_log', {
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    actionType: opts.actionType,
    targetId: opts.targetId,
    limit: opts.limit,
  })
}

export async function getActivitySummary(date: string): Promise<ActivitySummary[]> {
  return invoke<ActivitySummary[]>('get_activity_summary', { date })
}

// ── Captures ──

export async function getCaptures(limit?: number, includeConverted?: boolean): Promise<Capture[]> {
  return invoke<Capture[]>('get_captures', { limit, includeConverted })
}

export async function createCapture(content: string, source?: string, context?: string): Promise<Capture> {
  return invoke<Capture>('create_capture', { content, source, context })
}

export async function convertCaptureToTask(captureId: string, projectId?: string): Promise<LocalTask> {
  return invoke<LocalTask>('convert_capture_to_task', { captureId, projectId })
}

export async function deleteCapture(id: string): Promise<void> {
  return invoke<void>('delete_capture', { id })
}

export async function importObsidianCaptures(): Promise<number> {
  return invoke<number>('import_obsidian_captures')
}

/** Hide the quick-capture strip via the focus-preserving Rust path —
 *  a bare window.hide() makes AppKit drag the main window to the front.
 *  The reason is logged in Rust for diagnosing unexpected dismissals. */
export async function dismissCaptureStrip(reason?: string): Promise<void> {
  return invoke<void>('dismiss_capture_strip', { reason })
}

// ── Capture Routes ──

export async function getCaptureRoutes(): Promise<CaptureRoute[]> {
  return invoke<CaptureRoute[]>('get_capture_routes')
}

export async function createCaptureRoute(opts: {
  prefix: string
  targetType: string
  docId?: string
  label: string
  color: string
  icon: string
}): Promise<CaptureRoute> {
  return invoke<CaptureRoute>('create_capture_route', {
    prefix: opts.prefix,
    targetType: opts.targetType,
    docId: opts.docId,
    label: opts.label,
    color: opts.color,
    icon: opts.icon,
  })
}

export async function updateCaptureRoute(opts: {
  id: string
  prefix?: string
  targetType?: string
  docId?: string
  label?: string
  color?: string
  icon?: string
}): Promise<void> {
  return invoke<void>('update_capture_route', {
    id: opts.id,
    prefix: opts.prefix,
    targetType: opts.targetType,
    docId: opts.docId,
    label: opts.label,
    color: opts.color,
    icon: opts.icon,
  })
}

export async function deleteCaptureRoute(id: string): Promise<void> {
  return invoke<void>('delete_capture_route', { id })
}

export async function routeCapture(prefix: string, content: string): Promise<RouteCaptureResult> {
  return invoke<RouteCaptureResult>('route_capture', { prefix, content })
}

// ── Docs ──

export async function getDocFolders(): Promise<DocFolder[]> {
  return invoke<DocFolder[]>('get_doc_folders')
}

export async function createDocFolder(name: string): Promise<DocFolder> {
  return invoke<DocFolder>('create_doc_folder', { name })
}

export async function renameDocFolder(id: string, name: string): Promise<void> {
  return invoke<void>('rename_doc_folder', { id, name })
}

export async function deleteDocFolder(id: string): Promise<void> {
  return invoke<void>('delete_doc_folder', { id })
}

export async function getDocuments(folderId?: string): Promise<Document[]> {
  return invoke<Document[]>('get_documents', { folderId })
}

export async function getDocument(id: string): Promise<Document | null> {
  return invoke<Document | null>('get_document', { id })
}

export async function createDocument(title: string, folderId?: string): Promise<Document> {
  return invoke<Document>('create_document', { title, folderId })
}

export async function updateDocument(id: string, title?: string, content?: string, folderId?: string): Promise<Document> {
  return invoke<Document>('update_document', { id, title, content, folderId })
}

export async function deleteDocument(id: string): Promise<void> {
  return invoke<void>('delete_document', { id })
}

export async function searchDocuments(query: string): Promise<Document[]> {
  return invoke<Document[]>('search_documents', { query })
}

export async function getDocNotes(docId: string): Promise<DocNote[]> {
  return invoke<DocNote[]>('get_doc_notes', { docId })
}

export async function createDocNote(docId: string, content: string): Promise<DocNote> {
  return invoke<DocNote>('create_doc_note', { docId, content })
}

export async function deleteDocNote(id: string): Promise<void> {
  return invoke<void>('delete_doc_note', { id })
}

export async function reorderDocNotes(noteIds: string[]): Promise<void> {
  return invoke<void>('reorder_doc_notes', { noteIds })
}

export async function previewDocsMarkdownMigration(): Promise<DocsMdPreview> {
  return invoke<DocsMdPreview>('preview_docs_markdown_migration')
}

export async function migrateDocsToMarkdown(): Promise<DocsMdResult> {
  return invoke<DocsMdResult>('migrate_docs_to_markdown')
}

// ── Obsidian vault ──

export async function vaultStatus(): Promise<VaultStatus> {
  return invoke<VaultStatus>('vault_status')
}

export async function vaultRescan(): Promise<VaultScanReport | null> {
  return invoke<VaultScanReport | null>('vault_rescan')
}

export async function vaultListNotes(): Promise<VaultNoteSummary[]> {
  return invoke<VaultNoteSummary[]>('vault_list_notes')
}

export async function vaultGetNote(path: string): Promise<VaultNoteDetail | null> {
  return invoke<VaultNoteDetail | null>('vault_get_note', { path })
}

export async function vaultSearch(query: string, limit?: number): Promise<VaultSearchHit[]> {
  return invoke<VaultSearchHit[]>('vault_search', { query, limit })
}

export async function vaultBacklinks(path: string): Promise<VaultNoteSummary[]> {
  return invoke<VaultNoteSummary[]>('vault_backlinks', { path })
}

export async function vaultResolveLink(toPath: string): Promise<VaultNoteSummary | null> {
  return invoke<VaultNoteSummary | null>('vault_resolve_link', { toPath })
}

export async function vaultSaveNote(
  path: string,
  content: string,
  expectedHash?: string | null,
): Promise<VaultSaveResult> {
  return invoke<VaultSaveResult>('vault_save_note', { path, content, expectedHash })
}

export async function vaultCreateNote(path: string, content?: string): Promise<VaultNoteDetail> {
  return invoke<VaultNoteDetail>('vault_create_note', { path, content })
}

export async function vaultOpenInObsidian(path: string): Promise<void> {
  return invoke<void>('vault_open_in_obsidian', { path })
}

// ── AI ──

export async function breakDownTask(taskContent: string, taskDescription?: string): Promise<string[]> {
  return invoke<string[]>('break_down_task', { taskContent, taskDescription })
}

// ── Focus Mode ──

export async function startFocusSession(taskId: string, taskContent: string): Promise<void> {
  return invoke<void>('start_focus_session', { taskId, taskContent })
}

export async function endFocusSession(taskId: string, outcome: string, durationSecs: number): Promise<void> {
  return invoke<void>('end_focus_session', { taskId, outcome, durationSecs: Math.floor(durationSecs) })
}

export async function getActiveFocus(): Promise<FocusState> {
  return invoke<FocusState>('get_active_focus')
}

// ── Goals ──

// Goals CRUD
export async function getGoals(): Promise<GoalWithProgress[]> {
  return invoke<GoalWithProgress[]>('get_goals')
}

export async function getGoal(id: string): Promise<GoalWithProgress> {
  return invoke<GoalWithProgress>('get_goal', { id })
}

export async function createGoal(opts: {
  name: string
  description?: string
  status?: GoalStatus
  lifeAreaId?: string
  startDate?: string
  targetDate?: string
  color?: string
}): Promise<Goal> {
  return invoke<Goal>('create_goal', {
    name: opts.name,
    description: opts.description,
    status: opts.status,
    lifeAreaId: opts.lifeAreaId,
    startDate: opts.startDate,
    targetDate: opts.targetDate,
    color: opts.color,
  })
}

export async function updateGoal(opts: {
  id: string
  name?: string
  description?: string
  status?: GoalStatus
  lifeAreaId?: string
  startDate?: string
  targetDate?: string
  color?: string
}): Promise<Goal> {
  return invoke<Goal>('update_goal', {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    status: opts.status,
    lifeAreaId: opts.lifeAreaId,
    startDate: opts.startDate,
    targetDate: opts.targetDate,
    color: opts.color,
  })
}

export async function deleteGoal(id: string): Promise<void> {
  return invoke<void>('delete_goal', { id })
}

// Milestones
export async function getMilestones(goalId: string): Promise<Milestone[]> {
  return invoke<Milestone[]>('get_milestones', { goalId })
}

export async function createMilestone(opts: {
  goalId: string
  name: string
  targetDate?: string
}): Promise<Milestone> {
  return invoke<Milestone>('create_milestone', {
    goalId: opts.goalId,
    name: opts.name,
    targetDate: opts.targetDate,
  })
}

export async function updateMilestone(opts: {
  id: string
  name?: string
  targetDate?: string
  completed?: boolean
}): Promise<Milestone> {
  return invoke<Milestone>('update_milestone', {
    id: opts.id,
    name: opts.name,
    targetDate: opts.targetDate,
    completed: opts.completed,
  })
}

export async function deleteMilestone(id: string): Promise<void> {
  return invoke<void>('delete_milestone', { id })
}

// Life Areas
export async function getLifeAreas(): Promise<LifeArea[]> {
  return invoke<LifeArea[]>('get_life_areas')
}

export async function createLifeArea(opts: {
  name: string
  color: string
  icon: string
}): Promise<LifeArea> {
  return invoke<LifeArea>('create_life_area', {
    name: opts.name,
    color: opts.color,
    icon: opts.icon,
  })
}

export async function updateLifeArea(opts: {
  id: string
  name?: string
  color?: string
  icon?: string
}): Promise<LifeArea> {
  return invoke<LifeArea>('update_life_area', {
    id: opts.id,
    name: opts.name,
    color: opts.color,
    icon: opts.icon,
  })
}

export async function deleteLifeArea(id: string): Promise<void> {
  return invoke<void>('delete_life_area', { id })
}

// Habits
export async function getHabits(): Promise<HabitWithStats[]> {
  return invoke<HabitWithStats[]>('get_habits')
}

export async function createHabit(opts: {
  name: string
  category?: string
  icon: string
  color: string
}): Promise<Habit> {
  return invoke<Habit>('create_habit', {
    name: opts.name,
    category: opts.category,
    icon: opts.icon,
    color: opts.color,
  })
}

export async function updateHabit(opts: {
  id: string
  name?: string
  category?: string
  icon?: string
  color?: string
  active?: boolean
}): Promise<Habit> {
  return invoke<Habit>('update_habit', {
    id: opts.id,
    name: opts.name,
    category: opts.category,
    icon: opts.icon,
    color: opts.color,
    active: opts.active,
  })
}

export async function deleteHabit(id: string): Promise<void> {
  return invoke<void>('delete_habit', { id })
}

export async function logHabit(habitId: string, date?: string, intensity?: number): Promise<HabitLog> {
  return invoke<HabitLog>('log_habit', { habitId, date, intensity })
}

export async function unlogHabit(habitId: string, date?: string): Promise<void> {
  return invoke<void>('unlog_habit', { habitId, date })
}

export async function getHabitLogs(habitId?: string, days?: number): Promise<HabitLog[]> {
  return invoke<HabitLog[]>('get_habit_logs', { habitId, days })
}

export async function getHabitHeatmap(habitId?: string, days?: number): Promise<HabitHeatmapEntry[]> {
  return invoke<HabitHeatmapEntry[]>('get_habit_heatmap', { habitId, days })
}

// Import
export async function importGoalsFromVault(): Promise<ImportSummary> {
  return invoke<ImportSummary>('import_goals_from_vault')
}

// ── Sync ──

export async function syncPush(): Promise<number> {
  return invoke<number>('sync_push')
}

export async function syncPull(): Promise<number> {
  return invoke<number>('sync_pull')
}

export async function syncGetStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_get_status')
}

export async function syncConfigure(tursoUrl: string, tursoToken: string): Promise<void> {
  return invoke<void>('sync_configure', { tursoUrl, tursoToken })
}

export async function syncTestConnection(tursoUrl: string, tursoToken: string): Promise<void> {
  return invoke<void>('sync_test_connection', { tursoUrl, tursoToken })
}

export async function syncInitializeRemote(): Promise<void> {
  return invoke<void>('sync_initialize_remote')
}

export async function syncSeedExisting(): Promise<number> {
  return invoke<number>('sync_seed_existing')
}

// ── Todoist Sync ──

export async function todoistSyncNow(): Promise<SyncReport> {
  return invoke<SyncReport>('todoist_sync_now')
}

export async function getTodoistSyncStatus(): Promise<TodoistSyncStatus> {
  return invoke<TodoistSyncStatus>('get_todoist_sync_status')
}

export async function setTodoistSyncEnabled(enabled: boolean): Promise<void> {
  return invoke<void>('set_todoist_sync_enabled', { enabled })
}

// ── Demo Mode ──

export async function getDemoStatus(): Promise<boolean> {
  return invoke<boolean>('demo_status')
}

/** Switches to (or from) the throwaway demo database and restarts the app. */
export async function toggleDemoMode(on: boolean): Promise<void> {
  return invoke<void>('demo_toggle', { on })
}
