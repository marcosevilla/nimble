use serde::{Deserialize, Serialize};

// ── Settings ──

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

// ── Projects ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub parent_id: Option<String>,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub remote_updated_at: Option<String>,
    pub synced_snapshot: Option<String>,
}

// ── Local Tasks ──

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct LocalTask {
    pub id: String,
    pub parent_id: Option<String>,
    pub content: String,
    pub description: Option<String>,
    pub project_id: String,
    pub priority: i64,
    pub due_date: Option<String>,
    pub due_time: Option<String>,        // "HH:MM" 24h, None = all-day
    pub duration_minutes: Option<i64>,
    pub recurrence_rule: Option<String>, // human string, e.g. "every 2 weeks @ 09:00"
    pub section_id: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,             // label ids; loaded separately, not a table column
    pub completed: bool,
    pub completed_at: Option<String>,
    pub status: String,
    pub linked_doc_id: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub remote_updated_at: Option<String>,
    pub synced_snapshot: Option<String>,
}

/// Input for `db::tasks::create_local_task`. Struct form lets later tasks add
/// fields without touching every caller.
#[derive(Debug, Default, Deserialize)]
pub struct CreateTaskInput {
    pub content: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub due_date: Option<String>,
}

/// Input for `db::tasks::update_local_task`. Struct form lets later tasks add
/// fields without touching every caller.
#[derive(Debug, Default, Deserialize)]
pub struct UpdateTaskInput {
    pub content: Option<String>,
    pub description: Option<String>,
    pub project_id: Option<String>,
    pub priority: Option<i64>,
    pub due_date: Option<String>,
    pub clear_due_date: bool,
    pub linked_doc_id: Option<String>,
}

// ── Labels ──

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub created_at: String,
}

// ── Sections ──

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Section {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub position: i64,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub created_at: String,
}

// ── Activity ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityEntry {
    pub id: String,
    pub action_type: String,
    pub target_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivitySummary {
    pub action_type: String,
    pub count: i64,
}

// ── Captures ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Capture {
    pub id: String,
    pub content: String,
    pub source: String,
    pub converted_to_task_id: Option<String>,
    pub routed_to: Option<String>,
    pub context: Option<String>,
    pub created_at: String,
}

// ── Capture Routes ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaptureRoute {
    pub id: String,
    pub prefix: String,
    pub target_type: String,
    pub doc_id: Option<String>,
    pub label: String,
    pub color: String,
    pub icon: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RouteCaptureResult {
    pub routed_to: String,
    pub target_type: String,
    pub created_id: String,
    pub label: String,
}

// ── Docs ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocFolder {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder_id: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DocNote {
    pub id: String,
    pub doc_id: String,
    pub content: String,
    pub position: i64,
    pub created_at: String,
}

// ── Focus ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FocusState {
    pub task_id: Option<String>,
    pub started_at: Option<String>,
    pub paused_at: Option<String>,
}

// ── Goals ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LifeArea {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Goal {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub life_area_id: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub color: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalWithProgress {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub life_area_id: Option<String>,
    pub start_date: Option<String>,
    pub target_date: Option<String>,
    pub color: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
    pub progress: f64,
    pub milestone_count: i64,
    pub milestone_completed: i64,
    pub task_count: i64,
    pub task_completed: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Milestone {
    pub id: String,
    pub goal_id: String,
    pub name: String,
    pub target_date: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub position: i64,
    pub created_at: String,
}

// ── Habits ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
    pub icon: String,
    pub color: String,
    pub active: bool,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HabitLog {
    pub id: String,
    pub habit_id: String,
    pub date: String,
    pub intensity: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HabitWithStats {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
    pub icon: String,
    pub color: String,
    pub active: bool,
    pub position: i64,
    pub created_at: String,
    pub current_momentum: f64,
    pub today_completed: bool,
    pub today_intensity: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HabitHeatmapEntry {
    pub date: String,
    pub intensity: i64,
}

// ── Priorities / Daily State ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Priority {
    pub title: String,
    pub source: String,
    pub reasoning: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyStateResponse {
    pub date: String,
    pub energy_level: Option<String>,
    pub priorities: Option<Vec<Priority>>,
    pub review_complete: bool,
}

// ── Calendar ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarFeed {
    pub id: String,
    pub label: String,
    pub url: String,
    pub color: String,
    pub enabled: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEventWithFeed {
    #[serde(flatten)]
    pub event: crate::parsers::ical::CalendarEvent,
    pub date: Option<String>,
    pub feed_label: Option<String>,
    pub feed_color: Option<String>,
}

// ── Todoist ──

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct TodoistTaskRow {
    pub id: String,
    pub content: String,
    pub description: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub priority: i32,
    pub due_date: Option<String>,
    pub due_is_recurring: i32,
    pub is_completed: i32,
    pub todoist_url: Option<String>,
}

// ── Progress ──

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    pub snapshot_id: i64,
    pub session_log_path: String,
}

// ── Import ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportSummary {
    pub goals_created: i32,
    pub habits_created: i32,
}

// ── Todoist Migration ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodoistMigrationOptions {
    pub flatten_nested_projects: bool,
    pub create_section_projects: bool,
    pub preserve_labels: bool,
    pub preserve_recurring: bool,
}

impl Default for TodoistMigrationOptions {
    fn default() -> Self {
        Self {
            flatten_nested_projects: true,
            create_section_projects: true,
            preserve_labels: true,
            preserve_recurring: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodoistMigrationPreview {
    pub projects_to_create: i32,
    pub projects_already_migrated: i32,
    pub tasks_to_create: i32,
    pub tasks_already_migrated: i32,
    pub sections_count: i32,
    pub tasks_with_labels: i32,
    pub tasks_recurring: i32,
    pub tasks_with_subtasks: i32,
    pub project_names_preview: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TodoistMigrationResult {
    pub projects_created: i32,
    pub projects_updated: i32,
    pub tasks_created: i32,
    pub tasks_updated: i32,
    pub recurring_preserved: i32,
    pub labels_preserved: i32,
    pub errors: Vec<String>,
}

// ── Updater ──

#[derive(Debug, Serialize)]
pub struct UpdateStatus {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_url: Option<String>,
    pub error: Option<String>,
}

// ── Sync ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncStatus {
    pub pending_changes: i64,
    pub last_sync: Option<String>,
    pub device_id: String,
    pub turso_configured: bool,
    pub remote_initialized: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SyncLogEntry {
    pub id: String,
    pub table_name: String,
    pub row_id: String,
    pub operation: String,
    pub changed_columns: Option<String>,
    pub snapshot: Option<String>,
    pub device_id: String,
    pub timestamp: String,
    pub synced: bool,
}

// ── Obsidian ──

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuickCapture {
    pub timestamp: Option<String>,
    pub content: String,
}
