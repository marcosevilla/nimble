//! Completed-history import (`dt todoist import-history`) and the full
//! Todoist archive (`--archive <dir>`).
//!
//! Todoist's own backups hold only open tasks, and the pull never creates
//! rows for completed items (`sync_loop` skips checked items it doesn't know,
//! "don't resurrect completed history"). This module reads Todoist's
//! completed-task log, `GET /api/v1/tasks/completed/by_completion_date`
//! (`since` inclusive, `until` exclusive, at most 3 months apart, `limit` at
//! most 200, `items` + `next_cursor` pages; confirmed against the v1 OpenAPI
//! spec and a live probe 2026-09-25: a 93-day window is accepted, 98 days is
//! a 400 "completion date range must not exceed 3 months"), and:
//!
//! - plans the import read-only (`build_plan`): what is already local, where
//!   each task would land, unmatched labels, orphan parents;
//! - applies it in ONE transaction (`apply`): raw SQL, never the CRUD helpers,
//!   so the Todoist observer/outbox never sees these rows (they came FROM
//!   Todoist), with `sync_log` rows written in the same transaction so Turso
//!   and the web receive them;
//! - optionally writes every completed task ever, plus projects (archived
//!   too), sections and labels, as raw Todoist JSON (`fetch_archive` +
//!   `write_archive`). The archive is a read of Todoist and a local file; it
//!   never writes to the database.
//!
//! Imported rows are linked (`external_source = 'todoist'`, `external_id`),
//! complete, and carry a `synced_snapshot` with `checked = true`, so a later
//! pull sees an echo (no change) or merges a real remote change (e.g. a
//! reopen in Todoist) exactly as for any other linked row. Tasks whose project
//! Nimble doesn't know land in one archived, unlinked "Todoist history"
//! project (`HISTORY_PROJECT_ID`), which is never pushed to Todoist (raw SQL
//! insert, and `observer::seed_outbox_for_unlinked` skips archived projects).
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{SqliteConnection, SqlitePool};

use super::client::TodoistItem;
use super::mappers;

pub const API_BASE: &str = "https://api.todoist.com";
pub const COMPLETED_PATH: &str = "/api/v1/tasks/completed/by_completion_date";
/// Days per request window. The API refuses ranges over "3 months"; 93 days
/// was accepted live, so 90 leaves margin.
pub const WINDOW_DAYS: i64 = 90;
/// Page size (the API maximum).
pub const PAGE_LIMIT: u32 = 200;
/// Pages followed per window before giving up (a non-advancing cursor guard).
pub const MAX_PAGES: usize = 500;
/// Archive stop rule when the account's `joined_at` is unknown: this many
/// consecutive empty windows (about a year) past the newest data.
pub const ARCHIVE_EMPTY_STOP: usize = 4;
/// Hard cap on archive windows (~20 years), whatever else happens.
pub const ARCHIVE_MAX_WINDOWS: usize = 80;
/// The archived, never-synced-to-Todoist home for tasks whose project is gone.
pub const HISTORY_PROJECT_ID: &str = "todoist-history";
pub const HISTORY_PROJECT_NAME: &str = "Todoist history";

const STAMP: &str = "%Y-%m-%d %H:%M:%S";

fn api_time(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ── HTTP seam ──

/// One GET's result, classified for the retry loop.
#[derive(Debug, Clone)]
pub enum GetOutcome {
    Ok(Value),
    /// 429 (or 503): wait `Some(secs)` (Retry-After) or the default backoff.
    RateLimited(Option<u64>),
    Failed(String),
}

/// Read-only Todoist GETs. Production is `HttpTodoistGet`; tests script it.
#[allow(async_fn_in_trait)]
pub trait TodoistGet {
    async fn get(&self, path: &str, query: &[(&str, String)]) -> GetOutcome;
}

pub struct HttpTodoistGet {
    client: reqwest::Client,
    base: reqwest::Url,
    token: String,
}

impl HttpTodoistGet {
    pub fn todoist(token: String) -> crate::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| crate::Error::Api(format!("Todoist client: {e}")))?;
        let base = reqwest::Url::parse(API_BASE).map_err(|e| crate::Error::Api(format!("todoist url: {e}")))?;
        Ok(Self { client, base, token })
    }
}

/// `path` + query, encoded with `query_pairs_mut` (cursors carry `+ / = .`).
pub fn build_url(base: &reqwest::Url, path: &str, query: &[(&str, String)]) -> reqwest::Url {
    let mut url = base.clone();
    url.set_path(path);
    if !query.is_empty() {
        let mut q = url.query_pairs_mut();
        for (k, v) in query {
            q.append_pair(k, v);
        }
    }
    url
}

impl TodoistGet for HttpTodoistGet {
    async fn get(&self, path: &str, query: &[(&str, String)]) -> GetOutcome {
        let url = build_url(&self.base, path, query);
        let resp = match self.client.get(url).bearer_auth(&self.token).send().await {
            Ok(r) => r,
            Err(e) => return GetOutcome::Failed(format!("GET {path}: {e}")),
        };
        let status = resp.status();
        let header_wait = resp
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());
        let body: Value = match resp.bytes().await {
            Ok(b) => serde_json::from_slice(&b).unwrap_or(Value::Null),
            Err(e) => return GetOutcome::Failed(format!("GET {path}: {e}")),
        };
        if status.as_u16() == 429 || status.as_u16() == 503 {
            let body_wait = body["error_extra"]["retry_after"].as_u64();
            return GetOutcome::RateLimited(header_wait.or(body_wait));
        }
        if !status.is_success() {
            let detail = body["error"].as_str().unwrap_or("").to_string();
            return GetOutcome::Failed(format!("GET {path} HTTP {}: {detail}", status.as_u16()));
        }
        GetOutcome::Ok(body)
    }
}

/// Bounded 429 handling.
#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_retries: u32,
    /// Wait when a rate-limit response carries no Retry-After.
    pub default_wait: Duration,
    /// Longest honoured Retry-After.
    pub max_wait: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self { max_retries: 5, default_wait: Duration::from_secs(5), max_wait: Duration::from_secs(120) }
    }
}

/// A source plus its retry policy and a request counter (for the report).
pub struct Fetcher<'a, S: TodoistGet> {
    pub source: &'a S,
    pub policy: RetryPolicy,
    pub requests: usize,
    pub rate_limited: usize,
}

impl<'a, S: TodoistGet> Fetcher<'a, S> {
    pub fn new(source: &'a S) -> Self {
        Self { source, policy: RetryPolicy::default(), requests: 0, rate_limited: 0 }
    }

    pub async fn get(&mut self, path: &str, query: &[(&str, String)]) -> crate::Result<Value> {
        let mut retries = 0;
        loop {
            self.requests += 1;
            match self.source.get(path, query).await {
                GetOutcome::Ok(v) => return Ok(v),
                GetOutcome::Failed(e) => return Err(crate::Error::Api(e)),
                GetOutcome::RateLimited(wait) => {
                    self.rate_limited += 1;
                    if retries >= self.policy.max_retries {
                        return Err(crate::Error::Api(format!(
                            "Todoist kept rate-limiting {path} after {retries} retries. Nothing was written; try again later."
                        )));
                    }
                    retries += 1;
                    let wait = wait.map(Duration::from_secs).unwrap_or(self.policy.default_wait).min(self.policy.max_wait);
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    /// Every page of one cursor-paginated list. `key` is the array field
    /// (`items` for completed tasks, `results` for the REST lists).
    pub async fn get_all(&mut self, path: &str, base_query: &[(&str, String)], key: &str) -> crate::Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut query: Vec<(&str, String)> = base_query.to_vec();
            query.push(("limit", PAGE_LIMIT.to_string()));
            if let Some(c) = &cursor {
                query.push(("cursor", c.clone()));
            }
            let page = self.get(path, &query).await?;
            match page.get(key).and_then(Value::as_array) {
                Some(rows) => out.extend(rows.iter().cloned()),
                None => {
                    return Err(crate::Error::Api(format!("GET {path}: response has no `{key}` array")))
                }
            }
            match page.get("next_cursor").and_then(Value::as_str) {
                Some(c) if !c.is_empty() && cursor.as_deref() != Some(c) => cursor = Some(c.to_string()),
                _ => return Ok(out),
            }
        }
        Err(crate::Error::Api(format!("GET {path}: more than {MAX_PAGES} pages; stopped")))
    }

    /// Completed tasks in `[since, until)` (one window, all pages).
    pub async fn completed_window(&mut self, since: DateTime<Utc>, until: DateTime<Utc>) -> crate::Result<Vec<Value>> {
        let query = [("since", api_time(since)), ("until", api_time(until))];
        self.get_all(COMPLETED_PATH, &query, "items").await
    }
}

/// `[start, end)` cut into consecutive windows of at most `WINDOW_DAYS`,
/// oldest first.
pub fn windows(start: DateTime<Utc>, end: DateTime<Utc>) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
    let mut out = Vec::new();
    let mut from = start;
    while from < end {
        let to = (from + chrono::Duration::days(WINDOW_DAYS)).min(end);
        out.push((from, to));
        from = to;
    }
    out
}

/// The import range: the last `months` months up to `now`.
pub fn import_start(now: DateTime<Utc>, months: u32) -> DateTime<Utc> {
    now.checked_sub_months(chrono::Months::new(months)).unwrap_or(now)
}

/// Completed tasks in `[start, end)`, window by window.
pub async fn fetch_completed<S: TodoistGet>(
    fetcher: &mut Fetcher<'_, S>,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> crate::Result<(Vec<Value>, usize)> {
    let ws = windows(start, end);
    let mut out = Vec::new();
    for (since, until) in &ws {
        out.extend(fetcher.completed_window(*since, *until).await?);
    }
    Ok((out, ws.len()))
}

// ── Archive ──

/// Why the archive walk stopped.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    /// Reached the account's `joined_at` (nothing can be older).
    ReachedJoinedAt,
    /// `joined_at` unknown: `ARCHIVE_EMPTY_STOP` empty windows in a row.
    EmptyWindows,
    /// `ARCHIVE_MAX_WINDOWS` walked.
    WindowCap,
}

/// Walk windows back from `end` and fetch each. Stops at `floor` (the
/// account's `joined_at`, less a day) when known, however many windows are
/// empty on the way; otherwise after `ARCHIVE_EMPTY_STOP` consecutive empty
/// windows. Always stops at `ARCHIVE_MAX_WINDOWS`. Returns items newest
/// window first, the windows walked and why it stopped.
pub async fn walk_back<S: TodoistGet>(
    fetcher: &mut Fetcher<'_, S>,
    end: DateTime<Utc>,
    floor: Option<DateTime<Utc>>,
) -> crate::Result<(Vec<Value>, Vec<(DateTime<Utc>, DateTime<Utc>)>, StopReason)> {
    let mut items = Vec::new();
    let mut walked = Vec::new();
    let mut empty_run = 0usize;
    let mut until = end;
    loop {
        if let Some(f) = floor {
            if until <= f {
                return Ok((items, walked, StopReason::ReachedJoinedAt));
            }
        }
        if walked.len() >= ARCHIVE_MAX_WINDOWS {
            return Ok((items, walked, StopReason::WindowCap));
        }
        let mut since = until - chrono::Duration::days(WINDOW_DAYS);
        if let Some(f) = floor {
            since = since.max(f);
        }
        let page = fetcher.completed_window(since, until).await?;
        walked.push((since, until));
        if page.is_empty() {
            empty_run += 1;
        } else {
            empty_run = 0;
        }
        items.extend(page);
        if floor.is_none() && empty_run >= ARCHIVE_EMPTY_STOP {
            return Ok((items, walked, StopReason::EmptyWindows));
        }
        until = since;
    }
}

/// Everything the archive file holds. Raw Todoist JSON throughout.
#[derive(Debug, serde::Serialize)]
pub struct Archive {
    pub format: &'static str,
    pub generated_at: String,
    pub source: &'static str,
    /// The account's `joined_at` (the walk's floor), when Todoist reported it.
    pub joined_at: Option<String>,
    pub completed: ArchiveCompleted,
    pub projects: Vec<Value>,
    pub archived_projects: Vec<Value>,
    /// Sections of active projects plus those of each archived project.
    pub sections: Vec<Value>,
    pub labels: Vec<Value>,
}

#[derive(Debug, serde::Serialize)]
pub struct ArchiveCompleted {
    pub stop_reason: StopReason,
    pub windows: usize,
    pub range_since: Option<String>,
    pub range_until: String,
    pub count: usize,
    pub oldest_completed_at: Option<String>,
    pub newest_completed_at: Option<String>,
    /// Every completion event, recurring occurrences included (one entry per
    /// completion, so the same task id can repeat).
    pub items: Vec<Value>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ArchiveSummary {
    pub path: String,
    pub completed: usize,
    pub unique_tasks: usize,
    pub oldest_completed_at: Option<String>,
    pub newest_completed_at: Option<String>,
    pub windows: usize,
    pub stop_reason: StopReason,
    pub projects: usize,
    pub archived_projects: usize,
    pub sections: usize,
    pub labels: usize,
}

impl Archive {
    pub fn summary(&self, path: &Path) -> ArchiveSummary {
        let unique: HashSet<&str> = self.completed.items.iter().filter_map(|i| i["id"].as_str()).collect();
        ArchiveSummary {
            path: path.display().to_string(),
            completed: self.completed.count,
            unique_tasks: unique.len(),
            oldest_completed_at: self.completed.oldest_completed_at.clone(),
            newest_completed_at: self.completed.newest_completed_at.clone(),
            windows: self.completed.windows,
            stop_reason: self.completed.stop_reason.clone(),
            projects: self.projects.len(),
            archived_projects: self.archived_projects.len(),
            sections: self.sections.len(),
            labels: self.labels.len(),
        }
    }
}

/// Fetch the full archive. Read-only (Todoist GETs only).
pub async fn fetch_archive<S: TodoistGet>(fetcher: &mut Fetcher<'_, S>, now: DateTime<Utc>) -> crate::Result<Archive> {
    // Only `joined_at` is kept from the user object (it also carries
    // account details that don't belong in an archive file).
    let user = fetcher.get("/api/v1/user", &[]).await?;
    let joined_at = user["joined_at"].as_str().map(str::to_owned);
    let floor = joined_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc) - chrono::Duration::days(1));
    let (items, walked, stop_reason) = walk_back(fetcher, now, floor).await?;
    let projects = fetcher.get_all("/api/v1/projects", &[], "results").await?;
    let archived_projects = fetcher.get_all("/api/v1/projects/archived", &[], "results").await?;
    let mut sections = fetcher.get_all("/api/v1/sections", &[], "results").await?;
    let mut seen: HashSet<String> = sections.iter().filter_map(|s| s["id"].as_str().map(str::to_owned)).collect();
    for p in &archived_projects {
        let Some(pid) = p["id"].as_str() else { continue };
        for s in fetcher.get_all("/api/v1/sections", &[("project_id", pid.to_string())], "results").await? {
            if s["id"].as_str().is_some_and(|id| seen.insert(id.to_string())) {
                sections.push(s);
            }
        }
    }
    let labels = fetcher.get_all("/api/v1/labels", &[], "results").await?;
    let stamps: Vec<&str> = items.iter().filter_map(|i| i["completed_at"].as_str()).collect();
    let oldest = stamps.iter().min().map(|s| s.to_string());
    let newest = stamps.iter().max().map(|s| s.to_string());
    Ok(Archive {
        format: "nimble.todoist-archive.v1",
        generated_at: api_time(now),
        source: "Todoist API v1 (GET only)",
        joined_at,
        completed: ArchiveCompleted {
            stop_reason,
            windows: walked.len(),
            range_since: walked.last().map(|(s, _)| api_time(*s)),
            range_until: api_time(now),
            count: items.len(),
            oldest_completed_at: oldest,
            newest_completed_at: newest,
            items,
        },
        projects,
        archived_projects,
        sections,
        labels,
    })
}

/// `<dir>/todoist-completed-archive-YYYY-MM-DD.json` (local date).
pub fn archive_path(dir: &Path, date: chrono::NaiveDate) -> PathBuf {
    dir.join(format!("todoist-completed-archive-{}.json", date.format("%Y-%m-%d")))
}

/// Fail early: the directory must exist and the file must not.
pub fn check_archive_target(path: &Path) -> crate::Result<()> {
    let dir = path.parent().ok_or_else(|| crate::Error::Other("archive path has no directory".into()))?;
    if !dir.is_dir() {
        return Err(crate::Error::Other(format!("Archive directory {} does not exist. Nothing was fetched or written.", dir.display())));
    }
    if std::fs::symlink_metadata(path).is_ok() {
        return Err(crate::Error::Other(format!(
            "{} already exists; it is never overwritten. Move it aside or pick another directory. Nothing was fetched or written.",
            path.display()
        )));
    }
    Ok(())
}

/// Write atomically (temp file in the same directory, fsync, then a hard
/// link to the final name, which fails if it exists) as owner-only 0600.
pub fn write_archive(path: &Path, archive: &Archive) -> crate::Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| crate::Error::Other("archive path has no directory".into()))?;
    let tmp = dir.join(format!(".{}.tmp-{}", path.file_name().and_then(|n| n.to_str()).unwrap_or("archive"), uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(archive).map_err(|e| crate::Error::Other(format!("archive encode: {e}")))?;
    let written = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::hard_link(&tmp, path)
    })();
    let _ = std::fs::remove_file(&tmp);
    match written {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(crate::Error::Other(format!(
            "{} already exists; it is never overwritten.",
            path.display()
        ))),
        Err(e) => Err(e.into()),
    }
}

// ── Plan ──

/// Where one project's completed tasks land.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct ProjectBucket {
    pub todoist_project_id: String,
    /// `None` = the "Todoist history" project.
    pub local_project_id: Option<String>,
    pub local_project_name: String,
    pub local_project_archived: bool,
    pub tasks: usize,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ImportPlan {
    pub since: String,
    pub until: String,
    pub windows: usize,
    pub requests: usize,
    pub rate_limited_retries: usize,
    /// Completion entries Todoist returned (recurring occurrences repeat ids).
    pub fetched: usize,
    pub unique_tasks: usize,
    /// Unique ids Todoist still has open (recurring tasks): the pull owns them.
    pub still_open_remote: usize,
    /// Unique ids already present locally (open or completed): skipped.
    pub already_local: usize,
    pub would_import: usize,
    pub by_project: Vec<ProjectBucket>,
    pub to_history_project: usize,
    pub history_project_exists: bool,
    pub sections_matched: usize,
    /// Tasks whose Todoist section isn't known locally (imported sectionless).
    pub sections_unmatched: usize,
    /// Subtasks whose parent is local or in this batch.
    pub parents_linked: usize,
    /// Subtasks whose parent is neither: imported top-level.
    pub orphan_parents: usize,
    pub tasks_with_labels: usize,
    /// Label name -> tasks carrying it, for names with no local label.
    /// Labels are never created.
    pub labels_unmatched: BTreeMap<String, usize>,
}

/// One task to insert, fully resolved.
#[derive(Debug, Clone)]
struct Planned {
    item: TodoistItem,
    /// `None` = the history project.
    project_id: Option<String>,
    section_id: Option<String>,
    label_ids: Vec<String>,
    /// Local `YYYY-MM-DD HH:MM:SS`, the shape every completed row uses.
    completed_at: String,
    /// Todoist's `added_at` as UTC `YYYY-MM-DD HH:MM:SS`; `None` = column default.
    created_at: Option<String>,
}

/// Parse and dedupe raw completion entries: one per task id, the latest
/// completion wins. Unparseable entries are an error (nothing is written).
pub fn unique_items(raw: &[Value]) -> crate::Result<Vec<TodoistItem>> {
    let mut by_id: HashMap<String, TodoistItem> = HashMap::new();
    for v in raw {
        let item: TodoistItem = serde_json::from_value(v.clone())
            .map_err(|e| crate::Error::Parse(format!("completed task entry: {e}")))?;
        match by_id.get(&item.id) {
            Some(prev) if prev.completed_at >= item.completed_at => {}
            _ => {
                by_id.insert(item.id.clone(), item);
            }
        }
    }
    let mut items: Vec<TodoistItem> = by_id.into_values().collect();
    items.sort_by(|a, b| a.completed_at.cmp(&b.completed_at).then_with(|| a.id.cmp(&b.id)));
    Ok(items)
}

async fn local_external_exists(conn: &mut SqliteConnection, ext: &str) -> crate::Result<bool> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM local_tasks WHERE external_source = 'todoist' AND external_id = ? LIMIT 1",
    )
    .bind(ext)
    .fetch_optional(&mut *conn)
    .await?
    .is_some())
}

/// The shared read half of `build_plan` and `apply`: what to insert, on the
/// given connection (the apply's transaction, so the answer can't go stale).
async fn classify(
    conn: &mut SqliteConnection,
    items: &[TodoistItem],
    plan: &mut ImportPlan,
) -> crate::Result<Vec<Planned>> {
    plan.unique_tasks = items.len();
    let mut out = Vec::new();
    let mut buckets: BTreeMap<(String, Option<String>), ProjectBucket> = BTreeMap::new();
    let mut label_cache: HashMap<String, Option<String>> = HashMap::new();
    for item in items {
        if !item.checked.unwrap_or(false) || item.is_deleted.unwrap_or(false) {
            plan.still_open_remote += 1;
            continue;
        }
        if local_external_exists(&mut *conn, &item.id).await? {
            plan.already_local += 1;
            continue;
        }
        let Some(completed_at) = item.completed_at.as_deref().and_then(crate::db::karma::local_stamp).map(|(_, s)| s)
        else {
            // A completed entry without a readable completed_at can't be dated.
            plan.still_open_remote += 1;
            continue;
        };
        let ext = mappers::project_ref_for_task(item.project_id.clone(), item.section_id.clone());
        let location = match &ext {
            Some(e) => super::sync_loop::resolve_item_location_tx(&mut *conn, e, item.project_id.as_deref()).await?,
            None => None,
        };
        let (project_id, section_id) = match location {
            Some((p, s)) => (Some(p), s),
            None => (None, None),
        };
        if item.section_id.is_some() {
            if section_id.is_some() {
                plan.sections_matched += 1;
            } else {
                plan.sections_unmatched += 1;
            }
        }
        let mut label_ids = Vec::new();
        for name in &item.labels {
            if !label_cache.contains_key(name) {
                let id: Option<String> = sqlx::query_scalar("SELECT id FROM labels WHERE name = ? COLLATE NOCASE LIMIT 1")
                    .bind(name)
                    .fetch_optional(&mut *conn)
                    .await?;
                label_cache.insert(name.clone(), id);
            }
            match label_cache.get(name).cloned().flatten() {
                Some(id) if !label_ids.contains(&id) => label_ids.push(id),
                Some(_) => {}
                None => *plan.labels_unmatched.entry(name.clone()).or_default() += 1,
            }
        }
        if !item.labels.is_empty() {
            plan.tasks_with_labels += 1;
        }
        let key = (item.project_id.clone().unwrap_or_default(), project_id.clone());
        let bucket = buckets.entry(key).or_insert_with(|| ProjectBucket {
            todoist_project_id: item.project_id.clone().unwrap_or_default(),
            local_project_id: project_id.clone(),
            ..Default::default()
        });
        bucket.tasks += 1;
        if project_id.is_none() {
            plan.to_history_project += 1;
        }
        // UTC, like the column's `datetime('now')` default (the shape every
        // other created_at has); `completed_at` above is local time.
        let created_at = item
            .added_at
            .as_deref()
            .and_then(|a| DateTime::parse_from_rfc3339(a).ok())
            .map(|d| d.with_timezone(&Utc).format(STAMP).to_string());
        out.push(Planned {
            item: item.clone(),
            project_id,
            section_id,
            label_ids,
            completed_at,
            created_at,
        });
    }
    // Names for the report.
    for bucket in buckets.values_mut() {
        match &bucket.local_project_id {
            Some(id) => {
                let row: Option<(String, Option<String>)> = sqlx::query_as("SELECT name, archived_at FROM projects WHERE id = ?")
                    .bind(id)
                    .fetch_optional(&mut *conn)
                    .await?;
                if let Some((name, archived)) = row {
                    bucket.local_project_name = name;
                    bucket.local_project_archived = archived.is_some();
                }
            }
            None => {
                bucket.local_project_name = HISTORY_PROJECT_NAME.to_string();
                bucket.local_project_archived = true;
            }
        }
    }
    let mut by_project: Vec<ProjectBucket> = buckets.into_values().collect();
    by_project.sort_by(|a, b| b.tasks.cmp(&a.tasks).then_with(|| a.local_project_name.cmp(&b.local_project_name)));
    plan.by_project = by_project;
    plan.would_import = out.len();

    // Parents: local already, or arriving in this batch.
    let batch: HashSet<&str> = out.iter().map(|p| p.item.id.as_str()).collect();
    for p in &out {
        let Some(parent) = &p.item.parent_id else { continue };
        if batch.contains(parent.as_str()) || local_external_exists(&mut *conn, parent).await? {
            plan.parents_linked += 1;
        } else {
            plan.orphan_parents += 1;
        }
    }
    plan.history_project_exists = sqlx::query_scalar::<_, i64>("SELECT 1 FROM projects WHERE id = ?")
        .bind(HISTORY_PROJECT_ID)
        .fetch_optional(&mut *conn)
        .await?
        .is_some();
    Ok(out)
}

/// Read-only: what `apply` would do with these (deduped) items.
pub async fn build_plan(pool: &SqlitePool, items: &[TodoistItem]) -> crate::Result<ImportPlan> {
    let mut plan = ImportPlan::default();
    let mut conn = pool.acquire().await?;
    classify(&mut conn, items, &mut plan).await?;
    Ok(plan)
}

// ── Apply ──

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ApplyOutcome {
    pub imported: usize,
    pub parents_linked: usize,
    pub orphan_parents: usize,
    pub labels_attached: usize,
    pub history_project_created: bool,
    pub sync_log_rows: usize,
    pub momentum: crate::db::karma::BackfillReport,
}

async fn ensure_history_project(conn: &mut SqliteConnection) -> crate::Result<bool> {
    let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM projects WHERE id = ?")
        .bind(HISTORY_PROJECT_ID)
        .fetch_optional(&mut *conn)
        .await?;
    if exists.is_some() {
        return Ok(false);
    }
    let position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), 0) + 1 FROM projects")
        .fetch_one(&mut *conn)
        .await?;
    // external_source NULL: never linked, never pushed (the observer only
    // fires through db::projects CRUD, and the first-enable seed skips
    // archived projects).
    sqlx::query(
        "INSERT INTO projects (id, name, color, position, archived_at)
         VALUES (?, ?, '#8b8b8b', ?, datetime('now','localtime'))",
    )
    .bind(HISTORY_PROJECT_ID)
    .bind(HISTORY_PROJECT_NAME)
    .bind(position)
    .execute(&mut *conn)
    .await?;
    Ok(true)
}

async fn apply_tx(conn: &mut SqliteConnection, items: &[TodoistItem]) -> crate::Result<(ImportPlan, ApplyOutcome)> {
    let mut plan = ImportPlan::default();
    let planned = classify(&mut *conn, items, &mut plan).await?;
    let mut outcome = ApplyOutcome::default();
    if planned.is_empty() {
        return Ok((plan, outcome));
    }
    if planned.iter().any(|p| p.project_id.is_none()) {
        outcome.history_project_created = ensure_history_project(&mut *conn).await?;
        if outcome.history_project_created {
            let project: crate::types::Project = sqlx::query_as(&format!(
                "SELECT {} FROM projects WHERE id = ?",
                crate::db::projects::SELECT_COLS
            ))
            .bind(HISTORY_PROJECT_ID)
            .fetch_one(&mut *conn)
            .await?;
            let snapshot = serde_json::to_string(&project).map_err(|e| crate::Error::Other(e.to_string()))?;
            crate::db::sync::append_sync_log_tx(&mut *conn, "projects", HISTORY_PROJECT_ID, "INSERT", None, Some(&snapshot)).await?;
            outcome.sync_log_rows += 1;
        }
    }
    let now = chrono::Local::now().format(STAMP).to_string();
    let mut inserted: Vec<(String, &Planned)> = Vec::new();
    for p in &planned {
        let mut snapshot = mappers::item_to_snapshot(&p.item);
        snapshot.checked = true;
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO local_tasks
             (id, parent_id, content, description, project_id, section_id, priority, due_date, due_time,
              duration_minutes, completed, completed_at, status, position, external_id, external_source,
              remote_updated_at, synced_snapshot, created_at, updated_at, sync_policy)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'complete', ?, ?, 'todoist', ?, ?, COALESCE(?, datetime('now')), ?, ?)",
        )
        .bind(&id)
        .bind(&p.item.content)
        .bind(if snapshot.description.trim().is_empty() { None } else { Some(snapshot.description.clone()) })
        .bind(p.project_id.as_deref().unwrap_or(HISTORY_PROJECT_ID))
        .bind(&p.section_id)
        .bind(snapshot.priority.clamp(1, 4))
        .bind(&snapshot.due_date)
        .bind(&snapshot.due_time)
        .bind(snapshot.duration_minutes)
        .bind(&p.completed_at)
        .bind(p.item.child_order.unwrap_or(0))
        .bind(&p.item.id)
        .bind(&p.item.updated_at)
        .bind(serde_json::to_string(&snapshot).unwrap_or_default())
        .bind(&p.created_at)
        .bind(&now)
        // The history project has no Todoist home: its rows are Nimble-only
        // (the observer and push skip them). The rest stay linked.
        .bind(if p.project_id.is_none() { "local_only" } else { "default" })
        .execute(&mut *conn)
        .await?;
        for label_id in &p.label_ids {
            sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
                .bind(&id)
                .bind(label_id)
                .execute(&mut *conn)
                .await?;
            outcome.labels_attached += 1;
        }
        inserted.push((id, p));
    }
    // Parents, now that the whole batch exists.
    for (id, p) in &inserted {
        let Some(parent_ext) = &p.item.parent_id else { continue };
        let parent: Option<String> = sqlx::query_scalar(
            "SELECT id FROM local_tasks WHERE external_source = 'todoist' AND external_id = ? AND id != ? LIMIT 1",
        )
        .bind(parent_ext)
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?;
        match parent {
            Some(parent_id) => {
                sqlx::query("UPDATE local_tasks SET parent_id = ? WHERE id = ?")
                    .bind(&parent_id)
                    .bind(id)
                    .execute(&mut *conn)
                    .await?;
                outcome.parents_linked += 1;
            }
            None => outcome.orphan_parents += 1,
        }
    }
    // sync_log in the same transaction: one INSERT per task (snapshot read
    // after the parent pass) and one per task_labels row.
    for (id, p) in &inserted {
        let task: crate::types::LocalTask = sqlx::query_as(&format!(
            "SELECT {} FROM local_tasks WHERE id = ?",
            crate::db::tasks::SELECT_COLS
        ))
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
        let snapshot = crate::db::sync::task_sync_snapshot(&task);
        crate::db::sync::append_sync_log_tx(&mut *conn, "local_tasks", id, "INSERT", None, Some(&snapshot)).await?;
        outcome.sync_log_rows += 1;
        for label_id in &p.label_ids {
            let created_at: String = sqlx::query_scalar("SELECT created_at FROM task_labels WHERE task_id = ? AND label_id = ?")
                .bind(id)
                .bind(label_id)
                .fetch_one(&mut *conn)
                .await?;
            let snap = serde_json::json!({"task_id": id, "label_id": label_id, "created_at": created_at}).to_string();
            crate::db::sync::append_sync_log_tx(
                &mut *conn,
                "task_labels",
                &crate::db::sync::task_labels_row_id(id, label_id),
                "INSERT",
                None,
                Some(&snap),
            )
            .await?;
            outcome.sync_log_rows += 1;
        }
    }
    outcome.imported = inserted.len();
    Ok((plan, outcome))
}

/// Insert every planned task in ONE transaction (all or nothing), then the
/// post-commit steps: one activity entry, the task search index, and the
/// momentum backfill (imported rows carry their real Todoist stamps). Takes
/// NO backup: the caller does that first. Re-running imports 0.
pub async fn apply(pool: &SqlitePool, items: &[TodoistItem]) -> crate::Result<(ImportPlan, ApplyOutcome)> {
    crate::db::recovery::require_activation_clear(pool).await?;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let (plan, mut outcome) = apply_tx(&mut tx, items).await?;
    tx.commit().await?;
    if outcome.imported == 0 {
        return Ok((plan, outcome));
    }
    crate::db::activity::log_activity(
        pool,
        "todoist_history_imported",
        None,
        Some(serde_json::json!({
            "imported": outcome.imported,
            "already_local": plan.already_local,
            "to_history_project": plan.to_history_project,
            "orphan_parents": outcome.orphan_parents,
            "labels_unmatched": plan.labels_unmatched.len(),
        })),
    )
    .await;
    crate::db::task_search::rebuild_after_bulk_write(pool).await;
    match crate::db::karma::backfill(pool).await {
        Ok(r) => outcome.momentum = r,
        Err(e) => log::warn!("todoist history import: momentum backfill failed (run `dt momentum backfill`): {e}"),
    }
    Ok((plan, outcome))
}

// ── Orchestration (`dt todoist import-history`) ──

/// The saved Todoist token (settings), as the reconcile reads it.
pub async fn read_token(pool: &SqlitePool) -> crate::Result<String> {
    super::reconcile::read_token(pool).await
}

#[derive(Debug, Clone)]
pub struct RunOptions {
    pub since_months: u32,
    pub apply: bool,
    /// Directory for the full archive file; `None` = no archive.
    pub archive_dir: Option<PathBuf>,
    pub now: DateTime<Utc>,
    /// Local date for the archive file name.
    pub today: chrono::NaiveDate,
}

#[derive(Debug, serde::Serialize)]
pub struct RunOutcome {
    pub mode: &'static str,
    pub plan: ImportPlan,
    pub applied: Option<ApplyOutcome>,
    pub archive: Option<ArchiveSummary>,
}

/// Fetch, plan and (with `apply`) import; optionally write the archive.
/// Order: archive target check and apply preflight (before any network),
/// fetch, archive file, plan, then for `apply` the caller's `backup` (no
/// backup, no apply) and the one-transaction import. The dry run and the
/// archive never write to the database.
pub async fn run<S, F, Fut>(
    pool: &SqlitePool,
    source: &S,
    policy: RetryPolicy,
    opts: RunOptions,
    backup: F,
) -> crate::Result<RunOutcome>
where
    S: TodoistGet,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = crate::Result<()>>,
{
    let archive_path = opts.archive_dir.as_deref().map(|d| archive_path(d, opts.today));
    if let Some(path) = &archive_path {
        check_archive_target(path)?;
    }
    if opts.apply {
        crate::db::recovery::require_activation_clear(pool).await?;
    }
    let start = import_start(opts.now, opts.since_months);
    let mut fetcher = Fetcher { source, policy, requests: 0, rate_limited: 0 };
    let (raw, windows_used, archive) = match &archive_path {
        Some(path) => {
            let archive = fetch_archive(&mut fetcher, opts.now).await?;
            write_archive(path, &archive)?;
            // The import is the last `since_months` of the same fetch.
            let in_range: Vec<Value> = archive
                .completed
                .items
                .iter()
                .filter(|i| {
                    i["completed_at"]
                        .as_str()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .is_some_and(|d| d.with_timezone(&Utc) >= start)
                })
                .cloned()
                .collect();
            let n = windows(start, opts.now).len();
            (in_range, n, Some(archive.summary(path)))
        }
        None => {
            let (raw, n) = fetch_completed(&mut fetcher, start, opts.now).await?;
            (raw, n, None)
        }
    };
    let items = unique_items(&raw)?;
    let stamp = |plan: &mut ImportPlan, fetcher: &Fetcher<'_, S>| {
        plan.since = api_time(start);
        plan.until = api_time(opts.now);
        plan.windows = windows_used;
        plan.requests = fetcher.requests;
        plan.rate_limited_retries = fetcher.rate_limited;
        plan.fetched = raw.len();
    };
    let mut plan = build_plan(pool, &items).await?;
    stamp(&mut plan, &fetcher);
    if !opts.apply {
        return Ok(RunOutcome { mode: "dry_run", plan, applied: None, archive });
    }
    if plan.would_import > 0 {
        backup()
            .await
            .map_err(|e| crate::Error::Other(format!("Backup failed, so nothing was imported. {e}")))?;
    }
    let (mut plan, applied) = apply(pool, &items).await?;
    stamp(&mut plan, &fetcher);
    Ok(RunOutcome { mode: "applied", plan, applied: Some(applied), archive })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use serde_json::json;
    use std::sync::Mutex;

    type Handler = Box<dyn Fn(&str, &HashMap<String, String>, usize) -> GetOutcome + Send + Sync>;

    /// Scripted Todoist: `handler(path, query, call_index)`; records calls.
    struct Fake {
        handler: Handler,
        calls: Mutex<Vec<(String, HashMap<String, String>)>>,
    }

    impl Fake {
        fn new(handler: impl Fn(&str, &HashMap<String, String>, usize) -> GetOutcome + Send + Sync + 'static) -> Self {
            Self { handler: Box::new(handler), calls: Mutex::new(Vec::new()) }
        }
        fn calls(&self) -> Vec<(String, HashMap<String, String>)> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl TodoistGet for Fake {
        async fn get(&self, path: &str, query: &[(&str, String)]) -> GetOutcome {
            let q: HashMap<String, String> = query.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
            let n = {
                let mut calls = self.calls.lock().unwrap();
                calls.push((path.to_string(), q.clone()));
                calls.len() - 1
            };
            (self.handler)(path, &q, n)
        }
    }

    fn fast() -> RetryPolicy {
        RetryPolicy { max_retries: 3, default_wait: Duration::ZERO, max_wait: Duration::ZERO }
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn now() -> DateTime<Utc> {
        at("2026-09-25T12:00:00Z")
    }

    fn done(id: &str, project: &str, completed_at: &str) -> Value {
        json!({"id": id, "content": format!("task {id}"), "description": "", "project_id": project,
               "section_id": null, "parent_id": null, "priority": 1, "checked": true, "is_deleted": false,
               "child_order": 1, "labels": [], "due": null, "duration": null,
               "added_at": "2026-01-02T03:04:05Z", "completed_at": completed_at, "updated_at": completed_at})
    }

    /// Serves `items` from the completed endpoint (filtered by the window,
    /// one page) and empty structure lists.
    fn serving(items: Vec<Value>) -> Fake {
        Fake::new(move |path, q, _| {
            if path == COMPLETED_PATH {
                let (since, until) = (at(&q["since"]), at(&q["until"]));
                let page: Vec<Value> = items
                    .iter()
                    .filter(|i| {
                        let c = at(i["completed_at"].as_str().unwrap());
                        c >= since && c < until
                    })
                    .cloned()
                    .collect();
                GetOutcome::Ok(json!({"items": page}))
            } else if path == "/api/v1/user" {
                GetOutcome::Ok(json!({"joined_at": "2025-06-01T00:00:00Z", "email": "never@archive.d"}))
            } else {
                GetOutcome::Ok(json!({"results": [{"id": format!("{path}-1")}]}))
            }
        })
    }

    async fn count(pool: &SqlitePool, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    async fn db_fingerprint(pool: &SqlitePool) -> Vec<i64> {
        let mut out = Vec::new();
        for t in ["local_tasks", "projects", "labels", "task_labels", "sync_log", "activity_log", "karma_events", "todoist_outbox", "settings"] {
            out.push(count(pool, &format!("SELECT COUNT(*) FROM {t}")).await);
        }
        out
    }

    #[test]
    fn windows_cover_the_range_in_steps_of_at_most_90_days() {
        let start = import_start(now(), 12);
        assert_eq!(start, at("2025-09-25T12:00:00Z"));
        let ws = windows(start, now());
        assert_eq!(ws.len(), 5, "365 days = 4 full windows + a remainder");
        assert_eq!(ws[0].0, start);
        assert_eq!(ws.last().unwrap().1, now());
        for pair in ws.windows(2) {
            assert_eq!(pair[0].1, pair[1].0, "contiguous, no gap or overlap (until is exclusive)");
        }
        assert!(ws.iter().all(|(a, b)| *b - *a <= chrono::Duration::days(WINDOW_DAYS)));
    }

    #[test]
    fn url_encodes_cursor_and_uses_the_v1_path() {
        let base = reqwest::Url::parse(API_BASE).unwrap();
        let url = build_url(&base, COMPLETED_PATH, &[("since", "2026-01-01T00:00:00Z".into()), ("cursor", "a+b/c=.d".into())]);
        assert!(url.as_str().starts_with("https://api.todoist.com/api/v1/tasks/completed/by_completion_date?"), "{url}");
        assert!(url.as_str().contains("cursor=a%2Bb%2Fc%3D.d"), "{url}");
    }

    #[tokio::test]
    async fn a_window_follows_next_cursor_until_it_is_absent() {
        let fake = Fake::new(|_, q, _| match q.get("cursor").map(String::as_str) {
            None => GetOutcome::Ok(json!({"items": [done("1", "P", "2026-09-01T00:00:00Z")], "next_cursor": "c+1/x.y"})),
            Some("c+1/x.y") => GetOutcome::Ok(json!({"items": [done("2", "P", "2026-09-02T00:00:00Z")], "next_cursor": "c2"})),
            Some("c2") => GetOutcome::Ok(json!({"items": [done("3", "P", "2026-09-03T00:00:00Z")]})),
            Some(other) => GetOutcome::Failed(format!("unexpected cursor {other}")),
        });
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        let items = f.completed_window(at("2026-08-01T00:00:00Z"), now()).await.unwrap();
        assert_eq!(items.len(), 3);
        let calls = fake.calls();
        assert_eq!(calls.len(), 3);
        assert!(calls.iter().all(|(p, q)| p == COMPLETED_PATH && q["limit"] == "200"
            && q["since"] == "2026-08-01T00:00:00Z" && q["until"] == "2026-09-25T12:00:00Z"));
    }

    #[tokio::test]
    async fn fetch_walks_every_window_oldest_first() {
        let fake = serving(vec![done("old", "P", "2025-10-01T00:00:00Z"), done("new", "P", "2026-09-20T00:00:00Z")]);
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        let (items, n) = fetch_completed(&mut f, import_start(now(), 12), now()).await.unwrap();
        assert_eq!(n, 5);
        assert_eq!(items.len(), 2);
        let sinces: Vec<String> = fake.calls().iter().map(|(_, q)| q["since"].clone()).collect();
        let mut sorted = sinces.clone();
        sorted.sort();
        assert_eq!(sinces, sorted);
    }

    #[tokio::test]
    async fn rate_limits_are_retried_with_retry_after_then_bounded() {
        let fake = Fake::new(|_, _, n| if n < 2 { GetOutcome::RateLimited(Some(0)) } else { GetOutcome::Ok(json!({"items": []})) });
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        assert!(f.completed_window(at("2026-09-01T00:00:00Z"), now()).await.unwrap().is_empty());
        assert_eq!((f.requests, f.rate_limited), (3, 2));

        let always = Fake::new(|_, _, _| GetOutcome::RateLimited(None));
        let mut f = Fetcher { source: &always, policy: fast(), requests: 0, rate_limited: 0 };
        let err = f.completed_window(at("2026-09-01T00:00:00Z"), now()).await.unwrap_err();
        assert!(err.to_string().contains("rate-limiting"), "{err}");
        assert_eq!(always.calls().len(), 4, "1 try + max_retries (3)");
    }

    #[tokio::test]
    async fn a_failed_request_is_not_retried() {
        let fake = Fake::new(|_, _, _| GetOutcome::Failed("HTTP 400".into()));
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        assert!(f.completed_window(at("2026-09-01T00:00:00Z"), now()).await.is_err());
        assert_eq!(fake.calls().len(), 1);
    }

    // ── Import fixture ──

    async fn fixture() -> SqlitePool {
        let pool = test_pool().await;
        // Todoist sync ON, so any observer path would enqueue.
        crate::integrations::ensure_state(&pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok").await.unwrap();
        for sql in [
            "INSERT INTO projects (id, name, external_id, external_source) VALUES ('pa', 'Active', 'P_ACTIVE', 'todoist')",
            "INSERT INTO projects (id, name, external_id, external_source, archived_at) VALUES ('parch', 'Old', 'P_ARCH', 'todoist', '2026-01-01 00:00:00')",
            "INSERT INTO sections (id, project_id, name, position, external_id, external_source) VALUES ('s1', 'pa', 'Soon', 0, 'S1', 'todoist')",
            "INSERT INTO labels (id, name) VALUES ('ldeep', 'deep')",
            "INSERT INTO labels (id, name, archived_at) VALUES ('lold', 'old', '2026-01-01 00:00:00')",
            "INSERT INTO local_tasks (id, content, project_id, external_id, external_source) VALUES ('open1', 'open', 'pa', 'EXIST_OPEN', 'todoist')",
            "INSERT INTO local_tasks (id, content, project_id, completed, completed_at, status, external_id, external_source) VALUES ('done1', 'done', 'pa', 1, '2026-09-01 09:00:00', 'complete', 'EXIST_DONE', 'todoist')",
            "INSERT INTO local_tasks (id, content, project_id, external_id, external_source) VALUES ('lp', 'local parent', 'pa', 'LOCAL_PARENT', 'todoist')",
        ] {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }
        pool
    }

    fn remote() -> Vec<Value> {
        let mut a = done("A", "P_ACTIVE", "2026-09-01T10:00:00.123456Z");
        a["section_id"] = json!("S1");
        a["labels"] = json!(["deep", "Missing"]);
        a["priority"] = json!(4);
        a["due"] = json!({"date": "2026-09-01", "datetime": "2026-09-01T09:30:00", "string": "sep 1 9:30", "is_recurring": false});
        let mut a_earlier = a.clone();
        a_earlier["completed_at"] = json!("2026-08-01T10:00:00Z");
        let mut b = done("B", "P_ARCH", "2026-09-02T10:00:00Z");
        b["parent_id"] = json!("A");
        let mut c = done("C", "GONE", "2026-09-03T10:00:00Z");
        c["parent_id"] = json!("LOCAL_PARENT");
        let mut d = done("D", "GONE", "2026-09-04T10:00:00Z");
        d["parent_id"] = json!("GHOST");
        let mut g = done("G", "P_ACTIVE", "2026-09-05T10:00:00Z");
        g["checked"] = json!(false);
        g["due"] = json!({"date": "2026-09-12", "string": "every week", "is_recurring": true});
        let mut h = done("H", "P_ACTIVE", "2026-09-06T10:00:00Z");
        h["section_id"] = json!("S_UNKNOWN");
        h["labels"] = json!(["OLD", "Missing"]);
        vec![a, a_earlier, b, c, d, done("EXIST_OPEN", "P_ACTIVE", "2026-09-07T10:00:00Z"),
             done("EXIST_DONE", "P_ACTIVE", "2026-09-01T16:00:00Z"), g, h]
    }

    fn opts(apply: bool) -> RunOptions {
        RunOptions { since_months: 12, apply, archive_dir: None, now: now(), today: now().date_naive() }
    }

    #[tokio::test]
    async fn dry_run_reports_and_writes_nothing() {
        let pool = fixture().await;
        let before = db_fingerprint(&pool).await;
        let fake = serving(remote());
        let out = run(&pool, &fake, fast(), opts(false), || async { panic!("dry run never backs up") }).await.unwrap();
        assert_eq!(db_fingerprint(&pool).await, before);
        let p = &out.plan;
        assert_eq!(out.mode, "dry_run");
        assert_eq!((p.fetched, p.unique_tasks), (9, 8));
        assert_eq!((p.already_local, p.still_open_remote, p.would_import), (2, 1, 5));
        assert_eq!(p.to_history_project, 2);
        assert!(!p.history_project_exists);
        assert_eq!((p.sections_matched, p.sections_unmatched), (1, 1));
        assert_eq!((p.parents_linked, p.orphan_parents), (2, 1));
        assert_eq!(p.labels_unmatched.get("Missing"), Some(&2));
        assert_eq!(p.labels_unmatched.len(), 1, "archived `old` matches `OLD`");
        assert_eq!(p.windows, 5);
        let buckets: Vec<(Option<&str>, usize, bool)> =
            p.by_project.iter().map(|b| (b.local_project_id.as_deref(), b.tasks, b.local_project_archived)).collect();
        assert!(buckets.contains(&(Some("pa"), 2, false)));
        assert!(buckets.contains(&(Some("parch"), 1, true)));
        assert!(buckets.contains(&(None, 2, true)));
    }

    #[tokio::test]
    async fn apply_imports_once_with_mapping_and_no_outbox() {
        let pool = fixture().await;
        let fake = serving(remote());
        let backups = std::sync::Arc::new(Mutex::new(0));
        let b2 = backups.clone();
        let out = run(&pool, &fake, fast(), opts(true), move || async move {
            *b2.lock().unwrap() += 1;
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(*backups.lock().unwrap(), 1);
        let applied = out.applied.unwrap();
        assert_eq!(applied.imported, 5);
        assert!(applied.history_project_created);
        assert_eq!((applied.parents_linked, applied.orphan_parents), (2, 1));

        // Rows.
        let row = |ext: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (String, Option<String>, String, Option<String>, i64, Option<String>, String, i64, Option<String>, Option<String>, Option<String>)>(
                    "SELECT id, parent_id, project_id, section_id, completed, completed_at, status, priority, due_date, due_time, synced_snapshot
                     FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?")
                    .bind(ext).fetch_one(&pool).await.unwrap()
            }
        };
        let a = row("A").await;
        assert_eq!((a.2.as_str(), a.3.as_deref(), a.4, a.6.as_str(), a.7), ("pa", Some("s1"), 1, "complete", 4));
        let expected = crate::db::karma::local_stamp("2026-09-01T10:00:00.123456Z").unwrap().1;
        assert_eq!(a.5.as_deref(), Some(expected.as_str()), "latest completion, local YYYY-MM-DD HH:MM:SS");
        assert_eq!((a.8.as_deref(), a.9.as_deref()), (Some("2026-09-01"), Some("09:30")));
        let snap: mappers::TaskSnapshot = serde_json::from_str(a.10.as_deref().unwrap()).unwrap();
        assert!(snap.checked);
        let b = row("B").await;
        assert_eq!((b.1.as_deref(), b.2.as_str()), (Some(a.0.as_str()), "parch"));
        let c = row("C").await;
        assert_eq!((c.1.as_deref(), c.2.as_str()), (Some("lp"), HISTORY_PROJECT_ID));
        let d = row("D").await;
        assert_eq!((d.1, d.2.as_str()), (None, HISTORY_PROJECT_ID));
        let h = row("H").await;
        assert_eq!((h.2.as_str(), h.3), ("pa", None), "unknown section: project only");
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM local_tasks WHERE external_id = 'G'").await, 0);
        // History rows are Nimble-only; the rest stay linked to their project.
        let policies: Vec<(String, String)> = sqlx::query_as(
            "SELECT external_id, sync_policy FROM local_tasks WHERE external_id IN ('A','B','C','D','H') ORDER BY external_id")
            .fetch_all(&pool).await.unwrap();
        let policies: Vec<(&str, &str)> = policies.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        assert_eq!(policies, vec![("A", "default"), ("B", "default"), ("C", "local_only"), ("D", "local_only"), ("H", "default")]);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM local_tasks WHERE external_id IN ('EXIST_OPEN','EXIST_DONE')").await, 2);
        assert_eq!(count(&pool, "SELECT completed FROM local_tasks WHERE id = 'open1'").await, 0, "existing rows untouched");

        // History project: archived, unlinked.
        let hp: (String, Option<String>, Option<String>, Option<String>) =
            sqlx::query_as("SELECT name, archived_at, external_id, external_source FROM projects WHERE id = ?")
                .bind(HISTORY_PROJECT_ID).fetch_one(&pool).await.unwrap();
        assert_eq!(hp.0, HISTORY_PROJECT_NAME);
        assert!(hp.1.is_some());
        assert_eq!((hp.2, hp.3), (None, None));

        // Labels: matched only, never created.
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM labels").await, 2);
        let a_labels: Vec<String> = sqlx::query_scalar("SELECT label_id FROM task_labels WHERE task_id = ? ORDER BY label_id")
            .bind(&a.0).fetch_all(&pool).await.unwrap();
        assert_eq!(a_labels, vec!["ldeep"]);
        assert_eq!(count(&pool, &format!("SELECT COUNT(*) FROM task_labels WHERE task_id = '{}' AND label_id = 'lold'", h.0)).await, 1);

        // Outbox untouched, even with the history project and sync on.
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM todoist_outbox").await, 0);
        let seeded = crate::integrations::todoist::observer::seed_outbox_for_unlinked(&pool).await.unwrap();
        assert_eq!(seeded, (0, 0), "the archived history project is never seeded to Todoist");
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM todoist_outbox").await, 0);

        // sync_log: 5 tasks + 2 task_labels + 1 project.
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM sync_log WHERE table_name = 'local_tasks' AND operation = 'INSERT'").await, 5);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM sync_log WHERE table_name = 'task_labels'").await, 2);
        assert_eq!(count(&pool, &format!("SELECT COUNT(*) FROM sync_log WHERE table_name = 'projects' AND row_id = '{HISTORY_PROJECT_ID}'")).await, 1);
        assert_eq!(applied.sync_log_rows, 8);
        let snapshot: String = sqlx::query_scalar("SELECT snapshot FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ?")
            .bind(&b.0).fetch_one(&pool).await.unwrap();
        let snapshot: Value = serde_json::from_str(&snapshot).unwrap();
        assert_eq!(snapshot["parent_id"], json!(a.0), "snapshot read after the parent pass");
        assert!(snapshot.get("labels").is_none());

        // One activity entry, search index, momentum with real stamps.
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM activity_log WHERE action_type = 'todoist_history_imported'").await, 1);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM tasks_fts").await, count(&pool, "SELECT COUNT(*) FROM local_tasks").await);
        assert_eq!(count(&pool, &format!("SELECT COUNT(*) FROM karma_events WHERE kind = 'task' AND task_id = '{}'", a.0)).await, 1);
        assert!(applied.momentum.tasks >= 5);

        // Idempotent: a second apply imports 0, writes nothing, needs no backup.
        let before = db_fingerprint(&pool).await;
        let again = run(&pool, &fake, fast(), opts(true), || async { panic!("nothing to import, no backup") }).await.unwrap();
        assert_eq!(again.applied.unwrap().imported, 0);
        assert_eq!(again.plan.already_local, 7);
        assert_eq!(db_fingerprint(&pool).await, before);
    }

    #[tokio::test]
    async fn a_failed_backup_writes_nothing() {
        let pool = fixture().await;
        let before = db_fingerprint(&pool).await;
        let fake = serving(remote());
        let err = run(&pool, &fake, fast(), opts(true), || async { Err(crate::Error::Other("app not running".into())) })
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Backup failed"), "{err}");
        assert_eq!(db_fingerprint(&pool).await, before);
    }

    #[tokio::test]
    async fn the_next_pull_leaves_imported_rows_alone() {
        let pool = fixture().await;
        let fake = serving(remote());
        run(&pool, &fake, fast(), opts(true), || async { Ok(()) }).await.unwrap();
        let before: (i64, Option<String>, String) =
            sqlx::query_as("SELECT completed, completed_at, status FROM local_tasks WHERE external_id = 'B'").fetch_one(&pool).await.unwrap();
        // Todoist echoes the completed item (e.g. in a full or incremental sync).
        let item = remote().into_iter().find(|i| i["id"] == "B").unwrap();
        let resp: super::super::client::SyncResponse = serde_json::from_value(json!({"sync_token": "t2", "items": [item]})).unwrap();
        let report = super::super::sync_loop::apply_pull(&pool, &resp).await.unwrap();
        assert_eq!((report.created, report.updated, report.deleted), (0, 0, 0));
        let after: (i64, Option<String>, String) =
            sqlx::query_as("SELECT completed, completed_at, status FROM local_tasks WHERE external_id = 'B'").fetch_one(&pool).await.unwrap();
        assert_eq!(before, after);
        assert_eq!(count(&pool, "SELECT COUNT(*) FROM todoist_outbox").await, 0);
    }

    /// `created_at` follows the column's own convention (UTC, like the
    /// `datetime('now')` default); `completed_at` is local like every writer's.
    #[tokio::test]
    async fn created_at_is_added_at_in_utc_else_the_column_default() {
        let pool = fixture().await;
        let mut with = done("W", "P_ACTIVE", "2026-09-10T20:00:00Z");
        with["added_at"] = json!("2026-01-02T03:04:05.678Z");
        let mut without = done("N", "P_ACTIVE", "2026-09-11T20:00:00Z");
        without.as_object_mut().unwrap().remove("added_at");
        let fake = serving(vec![with, without]);
        run(&pool, &fake, fast(), opts(true), || async { Ok(()) }).await.unwrap();
        let get = |ext: &'static str| {
            let pool = pool.clone();
            async move {
                sqlx::query_as::<_, (String, Option<String>, i64)>(
                    "SELECT created_at, completed_at, ABS(strftime('%s', created_at) - strftime('%s', 'now'))
                     FROM local_tasks WHERE external_id = ?")
                    .bind(ext).fetch_one(&pool).await.unwrap()
            }
        };
        let w = get("W").await;
        assert_eq!(w.0, "2026-01-02 03:04:05");
        assert_eq!(w.1, crate::db::karma::local_stamp("2026-09-10T20:00:00Z").map(|(_, s)| s));
        let n = get("N").await;
        assert!(n.2 < 60, "no added_at: the UTC column default ({})", n.0);
        assert_eq!(n.0.len(), 19);
    }

    // ── Archive ──

    #[tokio::test]
    async fn archive_walk_stops_at_joined_at() {
        let fake = serving(vec![done("x", "P", "2026-01-01T00:00:00Z")]);
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        let floor = at("2025-06-01T00:00:00Z");
        let (items, walked, why) = walk_back(&mut f, now(), Some(floor)).await.unwrap();
        assert_eq!(why, StopReason::ReachedJoinedAt);
        assert_eq!(items.len(), 1);
        assert_eq!(walked.last().unwrap().0, floor, "the last window is clamped to the floor");
        assert_eq!(walked.len(), 6, "482 days in 90-day steps");
        for pair in walked.windows(2) {
            assert_eq!(pair[0].0, pair[1].1, "contiguous going back");
        }
    }

    #[tokio::test]
    async fn archive_walk_without_joined_at_stops_after_empty_windows() {
        let fake = serving(vec![done("x", "P", "2026-09-20T00:00:00Z"), done("y", "P", "2025-11-01T00:00:00Z")]);
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        let (items, walked, why) = walk_back(&mut f, now(), None).await.unwrap();
        assert_eq!(why, StopReason::EmptyWindows);
        assert_eq!(items.len(), 2);
        // Windows 1 (x) and 4 (y, 2025-11) have data; then 4 empty ones.
        assert_eq!(walked.len(), 4 + ARCHIVE_EMPTY_STOP);

        let empty = serving(vec![]);
        let mut f = Fetcher { source: &empty, policy: fast(), requests: 0, rate_limited: 0 };
        let (_, walked, why) = walk_back(&mut f, now(), None).await.unwrap();
        assert_eq!((why, walked.len()), (StopReason::EmptyWindows, ARCHIVE_EMPTY_STOP));
    }

    #[tokio::test]
    async fn archive_walk_is_capped() {
        let fake = Fake::new(|_, _, _| GetOutcome::Ok(json!({"items": [{"id": "z"}]})));
        let mut f = Fetcher { source: &fake, policy: fast(), requests: 0, rate_limited: 0 };
        let (_, walked, why) = walk_back(&mut f, now(), None).await.unwrap();
        assert_eq!((why, walked.len()), (StopReason::WindowCap, ARCHIVE_MAX_WINDOWS));
    }

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("nimble-archive-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[tokio::test]
    async fn archive_is_written_owner_only_and_never_overwritten_and_never_touches_the_db() {
        let pool = fixture().await;
        let before = db_fingerprint(&pool).await;
        let dir = temp_dir();
        let fake = serving(remote());
        let mut o = opts(false);
        o.archive_dir = Some(dir.clone());
        let out = run(&pool, &fake, fast(), o.clone(), || async { unreachable!() }).await.unwrap();
        assert_eq!(db_fingerprint(&pool).await, before, "archive + dry run write no rows");
        let path = archive_path(&dir, now().date_naive());
        assert!(path.ends_with("todoist-completed-archive-2026-09-25.json"));
        let summary = out.archive.unwrap();
        assert_eq!((summary.completed, summary.unique_tasks), (9, 8));
        assert_eq!(summary.stop_reason, StopReason::ReachedJoinedAt);
        assert_eq!(out.plan.would_import, 5, "the import still sees the last 12 months");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let body: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(body["completed"]["items"].as_array().unwrap().len(), 9);
        assert_eq!(body["joined_at"], "2025-06-01T00:00:00Z");
        assert!(!String::from_utf8(std::fs::read(&path).unwrap()).unwrap().contains("never@archive.d"), "user details are not archived");
        for key in ["projects", "archived_projects", "sections", "labels"] {
            assert!(body[key].is_array(), "{key}");
        }
        // Only the final file remains (no temp files).
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);

        // Second run: refused before any request.
        let original = std::fs::read(&path).unwrap();
        let calls_before = fake.calls().len();
        let err = run(&pool, &fake, fast(), o, || async { unreachable!() }).await.unwrap_err();
        assert!(err.to_string().contains("never overwritten"), "{err}");
        assert_eq!(fake.calls().len(), calls_before, "no fetch when the target exists");
        assert_eq!(std::fs::read(&path).unwrap(), original);
        // And the writer itself refuses to replace a file.
        let a = Archive {
            format: "x", generated_at: String::new(), source: "x", joined_at: None,
            completed: ArchiveCompleted { stop_reason: StopReason::WindowCap, windows: 0, range_since: None, range_until: String::new(),
                count: 0, oldest_completed_at: None, newest_completed_at: None, items: vec![] },
            projects: vec![], archived_projects: vec![], sections: vec![], labels: vec![],
        };
        assert!(write_archive(&path, &a).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_missing_archive_directory_fails_before_fetching() {
        let pool = fixture().await;
        let fake = serving(vec![]);
        let mut o = opts(false);
        o.archive_dir = Some(std::env::temp_dir().join(format!("absent-{}", uuid::Uuid::new_v4())));
        assert!(run(&pool, &fake, fast(), o, || async { unreachable!() }).await.is_err());
        assert!(fake.calls().is_empty());
    }
}
