//! One-time migration of Todoist tasks/projects into local storage.
//!
//! Writes to the `projects`, `sections`, `local_tasks`, `labels`, and
//! `task_labels` tables, using the `external_id` / `external_source` columns
//! (added in schema v15, extended to `sections` in v19) for idempotency.
//! Running the migration twice upserts in place — no duplicates. Labels,
//! recurrence, due times/durations, sections, and project nesting all land as
//! first-class fields (see `apply_migration`) rather than being flattened
//! into the task description — the description carries only the user's own
//! prose, copied through verbatim (it's already markdown, same as Nimble's
//! canonical description format).

use std::collections::HashMap;

use chrono::Local;
use serde::Deserialize;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::sync;
use crate::types::{TodoistMigrationPreview, TodoistMigrationResult};

// ── Todoist API response shapes ──

#[derive(Debug, Deserialize, Clone)]
struct TdProject {
    id: String,
    name: String,
    color: Option<String>,
    parent_id: Option<String>,
    is_inbox_project: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct TdProjectsResponse {
    results: Vec<TdProject>,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TdSection {
    id: String,
    project_id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct TdSectionsResponse {
    results: Vec<TdSection>,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct TdTask {
    id: String,
    content: String,
    description: Option<String>,
    project_id: Option<String>,
    section_id: Option<String>,
    parent_id: Option<String>,
    priority: i32,
    due: Option<TdDue>,
    labels: Option<Vec<String>>,
    #[serde(default)]
    order: i64,
    checked: Option<bool>,
    duration: Option<TdDuration>,
}

#[derive(Debug, Deserialize, Clone)]
struct TdDue {
    date: Option<String>,
    datetime: Option<String>,
    string: Option<String>,
    is_recurring: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
struct TdDuration {
    amount: Option<i64>,
    unit: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TdTasksResponse {
    results: Vec<TdTask>,
    next_cursor: Option<String>,
}

// ── Todoist color name → hex map ──
//
// Todoist returns named colors like "berry_red", "violet" on projects.
// We map to their approximate hex so local projects retain visual identity.
fn todoist_color_to_hex(name: &str) -> &'static str {
    match name {
        "berry_red" => "#b8255f",
        "red" => "#db4035",
        "orange" => "#ff9933",
        "yellow" => "#fad000",
        "olive_green" => "#afb83b",
        "lime_green" => "#7ecc49",
        "green" => "#299438",
        "mint_green" => "#6accbc",
        "teal" => "#158fad",
        "sky_blue" => "#14aaf5",
        "light_blue" => "#96c3eb",
        "blue" => "#4073ff",
        "grape" => "#884dff",
        "violet" => "#af38eb",
        "lavender" => "#eb96eb",
        "magenta" => "#e05194",
        "salmon" => "#ff8d85",
        "charcoal" => "#808080",
        "grey" => "#b8b8b8",
        "taupe" => "#ccac93",
        _ => "#6366f1",
    }
}

// ── HTTP helpers ──

/// Maximum pagination rounds we'll tolerate before bailing out. Safety rail
/// against infinite loops if Todoist ever returns a non-advancing cursor.
/// 200 pages × 200 tasks/page = 40k tasks ceiling — way beyond any real user.
const MAX_PAGES: usize = 200;

/// Per-page size. Todoist v1 API caps at 200; using the cap minimises
/// roundtrips (and the number of places pagination can break).
const PAGE_LIMIT: &str = "200";

/// Build a fully-encoded URL for a Todoist v1 endpoint with the usual
/// `limit` + optional `cursor` query params. Using `url::Url` ensures the
/// cursor is percent-encoded properly (base64 cursors can contain `+` and
/// `/`, which get mangled if naively concatenated).
fn build_url(path: &str, cursor: Option<&str>) -> reqwest::Url {
    let mut url = reqwest::Url::parse(&format!("https://api.todoist.com{}", path))
        .expect("todoist URL parses");
    {
        let mut qs = url.query_pairs_mut();
        qs.append_pair("limit", PAGE_LIMIT);
        if let Some(c) = cursor {
            qs.append_pair("cursor", c);
        }
    }
    url
}

async fn fetch_paginated_projects(
    client: &reqwest::Client,
    token: &str,
) -> crate::Result<Vec<TdProject>> {
    let mut all = Vec::new();
    let mut cursor: Option<String> = None;
    for page in 0..MAX_PAGES {
        let url = build_url("/api/v1/projects", cursor.as_deref());
        let resp: TdProjectsResponse = client
            .get(url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| crate::Error::Api(format!("Todoist projects error: {}", e)))?
            .json()
            .await
            .map_err(|e| crate::Error::Api(format!("Todoist projects parse error: {}", e)))?;
        let fetched = resp.results.len();
        all.extend(resp.results);
        log::info!(
            "[todoist-migration] projects page {} fetched={} total={} next_cursor={:?}",
            page + 1, fetched, all.len(), resp.next_cursor,
        );
        match resp.next_cursor {
            Some(c) if !c.is_empty() => cursor = Some(c),
            _ => return Ok(all),
        }
    }
    log::warn!("[todoist-migration] projects hit MAX_PAGES, returning {} projects", all.len());
    Ok(all)
}

async fn fetch_paginated_sections(
    client: &reqwest::Client,
    token: &str,
) -> crate::Result<Vec<TdSection>> {
    let mut all = Vec::new();
    let mut cursor: Option<String> = None;
    for page in 0..MAX_PAGES {
        let url = build_url("/api/v1/sections", cursor.as_deref());
        let resp: TdSectionsResponse = client
            .get(url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| crate::Error::Api(format!("Todoist sections error: {}", e)))?
            .json()
            .await
            .map_err(|e| crate::Error::Api(format!("Todoist sections parse error: {}", e)))?;
        let fetched = resp.results.len();
        all.extend(resp.results);
        log::info!(
            "[todoist-migration] sections page {} fetched={} total={} next_cursor={:?}",
            page + 1, fetched, all.len(), resp.next_cursor,
        );
        match resp.next_cursor {
            Some(c) if !c.is_empty() => cursor = Some(c),
            _ => return Ok(all),
        }
    }
    log::warn!("[todoist-migration] sections hit MAX_PAGES, returning {} sections", all.len());
    Ok(all)
}

async fn fetch_all_active_tasks(
    client: &reqwest::Client,
    token: &str,
) -> crate::Result<Vec<TdTask>> {
    let mut all = Vec::new();
    let mut cursor: Option<String> = None;
    for page in 0..MAX_PAGES {
        let url = build_url("/api/v1/tasks", cursor.as_deref());
        let resp: TdTasksResponse = client
            .get(url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| crate::Error::Api(format!("Todoist tasks error: {}", e)))?
            .json()
            .await
            .map_err(|e| crate::Error::Api(format!("Todoist tasks parse error: {}", e)))?;
        let fetched = resp.results.len();
        all.extend(resp.results);
        log::info!(
            "[todoist-migration] tasks page {} fetched={} total={} next_cursor={:?}",
            page + 1, fetched, all.len(), resp.next_cursor,
        );
        match resp.next_cursor {
            Some(c) if !c.is_empty() => cursor = Some(c),
            _ => {
                log::info!(
                    "[todoist-migration] tasks pagination complete at page {} (total={}); filtering active only",
                    page + 1, all.len(),
                );
                return Ok(all.into_iter().filter(|t| !t.checked.unwrap_or(false)).collect());
            }
        }
    }
    log::warn!("[todoist-migration] tasks hit MAX_PAGES, returning {} tasks", all.len());
    Ok(all.into_iter().filter(|t| !t.checked.unwrap_or(false)).collect())
}

// ── Helpers: field mapping ──

/// Map Todoist priority (4=highest → 1=lowest) to local priority (4=highest → 1=lowest).
/// Both use the same 1-4 scale with 4 as highest, so it's a direct pass-through.
fn map_priority(td_priority: i32) -> i64 {
    td_priority.clamp(1, 4) as i64
}

/// Normalize a Todoist due.date to local YYYY-MM-DD.
fn normalize_due_date(td_due: &Option<TdDue>) -> Option<String> {
    td_due
        .as_ref()
        .and_then(|d| d.date.as_ref())
        .map(|s| s[..s.len().min(10)].to_string())
}

/// Extracts "HH:MM" out of a Todoist `due.datetime` value. Mirrors
/// `integrations::todoist::mappers::parse_due_time`'s "no offset, local wall
/// clock" contract — this deliberately does NOT do timezone math, it just
/// lifts the time component out of whatever `YYYY-MM-DDTHH:MM:SS[...]` string
/// Todoist sent.
fn parse_due_time(datetime: &str) -> Option<String> {
    let time_part = datetime.split('T').nth(1)?;
    if time_part.len() < 5 {
        return None;
    }
    Some(time_part[..5].to_string())
}

/// Todoist's duration unit is "minute" or "day" — normalize both to minutes
/// so `local_tasks.duration_minutes` is a single comparable scalar. Mirrors
/// `integrations::todoist::mappers::duration_to_minutes`.
fn duration_to_minutes(duration: &TdDuration) -> Option<i64> {
    match (duration.amount, duration.unit.as_deref()) {
        (Some(amount), Some("minute")) => Some(amount),
        (Some(amount), Some("day")) => Some(amount * 24 * 60),
        _ => None,
    }
}

/// Return all Todoist IDs that have already been migrated into local_tasks.
/// Used to filter out migrated tasks from the live Todoist read-only panel so
/// the user doesn't see duplicates.
pub async fn migrated_todoist_ids(pool: &SqlitePool) -> crate::Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT external_id FROM local_tasks
         WHERE external_source = 'todoist' AND external_id IS NOT NULL",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

// ── Preview (dry run) ──

pub async fn preview_migration(pool: &SqlitePool, token: &str) -> crate::Result<TodoistMigrationPreview> {
    let client = reqwest::Client::new();
    let (projects, sections, tasks) = tokio::try_join!(
        fetch_paginated_projects(&client, token),
        fetch_paginated_sections(&client, token),
        fetch_all_active_tasks(&client, token),
    )?;

    // Count how many are already in the local DB (keyed by external_id).
    let mut projects_already = 0i32;
    for p in &projects {
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&p.id)
        .fetch_optional(pool)
        .await?;
        if existing.is_some() {
            projects_already += 1;
        }
    }

    let mut tasks_already = 0i32;
    for t in &tasks {
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&t.id)
        .fetch_optional(pool)
        .await?;
        if existing.is_some() {
            tasks_already += 1;
        }
    }

    let tasks_with_labels = tasks
        .iter()
        .filter(|t| t.labels.as_ref().map(|l| !l.is_empty()).unwrap_or(false))
        .count() as i32;
    let tasks_recurring = tasks
        .iter()
        .filter(|t| t.due.as_ref().and_then(|d| d.is_recurring).unwrap_or(false))
        .count() as i32;
    let tasks_with_subtasks = {
        let mut parents: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for t in &tasks {
            if let Some(pid) = &t.parent_id {
                parents.insert(pid.as_str());
            }
        }
        parents.len() as i32
    };

    let mut project_names_preview: Vec<String> = projects.iter().map(|p| p.name.clone()).collect();
    project_names_preview.sort();

    Ok(TodoistMigrationPreview {
        projects_to_create: (projects.len() as i32) - projects_already,
        projects_already_migrated: projects_already,
        tasks_to_create: (tasks.len() as i32) - tasks_already,
        tasks_already_migrated: tasks_already,
        sections_count: sections.len() as i32,
        tasks_with_labels,
        tasks_recurring,
        tasks_with_subtasks,
        project_names_preview,
    })
}

// ── Execute ──

pub async fn migrate(pool: &SqlitePool, token: &str) -> crate::Result<TodoistMigrationResult> {
    let client = reqwest::Client::new();
    let (projects, sections, tasks) = tokio::try_join!(
        fetch_paginated_projects(&client, token),
        fetch_paginated_sections(&client, token),
        fetch_all_active_tasks(&client, token),
    )?;

    apply_migration(pool, &projects, &sections, &tasks).await
}

/// Applies a pre-fetched set of Todoist projects/sections/tasks to local
/// storage. Split out from `migrate` so it's testable with hand-built
/// fixtures, without a live Todoist API round-trip.
///
/// Every write here is raw SQL against `projects`/`sections`/`local_tasks`/
/// `task_labels` — never the `db::projects`/`db::tasks`/`db::labels` CRUD
/// helpers (`get_or_create_label_by_name` is the one exception: it only
/// touches the standalone `labels` table, so there's no Todoist-echo risk).
/// This importer runs standalone, and several of those CRUD helpers fire the
/// Todoist mutation observer unconditionally on update —
/// `db::labels::set_task_labels`'s `Updated` path has no `external_id` guard
/// (unlike its `Created` path), and `db::projects::update_project` enqueues
/// an outbox op whenever the `name` field changes. A freshly-imported row
/// already carries exactly the data Todoist has, so calling through the
/// observer would enqueue an outbox op that echoes it straight back to
/// Todoist. This mirrors the direct-SQL-plus-matching-sync_log approach
/// `integrations::todoist::sync_loop::apply_pull` uses for the same reason.
async fn apply_migration(
    pool: &SqlitePool,
    projects: &[TdProject],
    sections: &[TdSection],
    tasks: &[TdTask],
) -> crate::Result<TodoistMigrationResult> {
    let mut result = TodoistMigrationResult {
        projects_created: 0,
        projects_updated: 0,
        tasks_created: 0,
        tasks_updated: 0,
        recurring_preserved: 0,
        labels_preserved: 0,
        errors: Vec::new(),
    };

    // Resolve every distinct label name to a local label id up front.
    // `get_or_create_label_by_name` opens its own transaction internally —
    // fine here since nothing else in this function holds one open.
    let mut label_id_by_name: HashMap<String, String> = HashMap::new();
    for t in tasks {
        if let Some(labels) = &t.labels {
            for name in labels {
                if !label_id_by_name.contains_key(name) {
                    let label = crate::db::labels::get_or_create_label_by_name(pool, name).await?;
                    label_id_by_name.insert(name.clone(), label.id);
                }
            }
        }
    }

    // Look up the current max position so new projects append to the end.
    let max_project_position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) FROM projects",
    )
    .fetch_one(pool)
    .await?;

    // ── Projects pass 1: upsert every project by its own name, parent_id ──
    // left untouched (resolved in pass 2 below, once every project has a
    // local id).
    let mut todoist_to_local_project: HashMap<String, String> = HashMap::new();
    let mut next_position = max_project_position + 1;

    for p in projects {
        let color = p.color.as_deref().map(todoist_color_to_hex).unwrap_or("#6366f1").to_string();

        // If it's Todoist's inbox, reuse the local 'inbox' project directly.
        let is_td_inbox = p.is_inbox_project.unwrap_or(false);
        if is_td_inbox {
            todoist_to_local_project.insert(p.id.clone(), "inbox".to_string());
            // Still mark local inbox as externally tracked so re-runs know.
            sqlx::query(
                "UPDATE projects SET external_id = ?, external_source = 'todoist'
                 WHERE id = 'inbox' AND (external_source IS NULL OR external_source = 'todoist')",
            )
            .bind(&p.id)
            .execute(pool)
            .await
            .ok();
            continue;
        }

        // Upsert by external_id
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&p.id)
        .fetch_optional(pool)
        .await?;

        let local_id = if let Some((id,)) = existing {
            sqlx::query("UPDATE projects SET name = ?, color = ? WHERE id = ?")
                .bind(&p.name)
                .bind(&color)
                .bind(&id)
                .execute(pool)
                .await?;
            result.projects_updated += 1;
            id
        } else {
            let new_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO projects (id, name, color, position, external_id, external_source)
                 VALUES (?, ?, ?, ?, ?, 'todoist')",
            )
            .bind(&new_id)
            .bind(&p.name)
            .bind(&color)
            .bind(next_position)
            .bind(&p.id)
            .execute(pool)
            .await?;
            next_position += 1;
            result.projects_created += 1;
            new_id
        };

        todoist_to_local_project.insert(p.id.clone(), local_id);
    }

    // ── Projects pass 2: nest children under their local parent now that ──
    // every project has a local id. Todoist's project tree is already
    // acyclic, so no cycle guard is needed here (unlike
    // `db::projects::update_project`'s user-facing path).
    for p in projects {
        let Some(td_parent_id) = &p.parent_id else { continue };
        let (Some(local_id), Some(local_parent_id)) = (
            todoist_to_local_project.get(&p.id),
            todoist_to_local_project.get(td_parent_id),
        ) else { continue };
        sqlx::query(
            "UPDATE projects SET parent_id = ? WHERE id = ? AND (parent_id IS NULL OR parent_id != ?)",
        )
        .bind(local_parent_id)
        .bind(local_id)
        .bind(local_parent_id)
        .execute(pool)
        .await?;
    }

    // ── Sections: native `sections` rows (with `external_id`), never the ──
    // old pseudo-project hack. Upsert by external_id so re-running the
    // import never creates duplicate sections.
    let mut todoist_to_local_section: HashMap<String, String> = HashMap::new();
    for s in sections {
        let local_project_id = todoist_to_local_project
            .get(&s.project_id)
            .cloned()
            .unwrap_or_else(|| "inbox".to_string());

        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM sections WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&s.id)
        .fetch_optional(pool)
        .await?;

        let local_id = if let Some((id,)) = existing {
            sqlx::query("UPDATE sections SET name = ?, project_id = ? WHERE id = ?")
                .bind(&s.name)
                .bind(&local_project_id)
                .bind(&id)
                .execute(pool)
                .await?;
            id
        } else {
            let new_id = Uuid::new_v4().to_string();
            let position: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM sections WHERE project_id = ?",
            )
            .bind(&local_project_id)
            .fetch_one(pool)
            .await?;
            sqlx::query(
                "INSERT INTO sections (id, project_id, name, position, external_id, external_source)
                 VALUES (?, ?, ?, ?, ?, 'todoist')",
            )
            .bind(&new_id)
            .bind(&local_project_id)
            .bind(&s.name)
            .bind(position)
            .bind(&s.id)
            .execute(pool)
            .await?;
            new_id
        };

        // Sync log entry for the section row (fire-and-forget, mirrors
        // `db::sections::create_section`'s own INSERT sync_log — sections
        // have no Todoist mutation observer, so there's no echo risk here).
        let section_row: Option<crate::types::Section> = sqlx::query_as(
            "SELECT id, project_id, name, position, external_id, external_source, created_at
             FROM sections WHERE id = ?",
        )
        .bind(&local_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if let Some(section) = section_row {
            let snapshot = serde_json::to_string(&section).unwrap_or_default();
            sync::append_sync_log(pool, "sections", &local_id, "INSERT", None, Some(&snapshot))
                .await
                .ok();
        }

        todoist_to_local_section.insert(s.id.clone(), local_id);
    }

    // Tasks pass 1: upsert with parent_id left null; record Todoist parent refs separately.
    let mut todoist_to_local_task: HashMap<String, String> = HashMap::new();
    // Todoist task_id → Todoist parent_id (for linkage in pass 2)
    let mut child_to_td_parent: HashMap<String, String> = HashMap::new();

    for t in tasks {
        let target_project = t
            .project_id
            .as_ref()
            .and_then(|pid| todoist_to_local_project.get(pid).cloned())
            .unwrap_or_else(|| "inbox".to_string());

        let local_section_id: Option<String> = t
            .section_id
            .as_ref()
            .and_then(|sid| todoist_to_local_section.get(sid).cloned());

        let label_names = t.labels.clone().unwrap_or_default();
        let had_labels = !label_names.is_empty();
        let target_label_ids: std::collections::HashSet<String> = label_names
            .iter()
            .filter_map(|name| label_id_by_name.get(name).cloned())
            .collect();

        let is_recurring = t.due.as_ref().and_then(|d| d.is_recurring).unwrap_or(false);
        // due.string carries Todoist's natural-language schedule description
        // ("every 2 weeks @ 09:00", but also patterns our own recurrence
        // engine can't advance, e.g. "every 3rd tuesday"). Stored verbatim
        // regardless of whether it parses: an unparseable rule just sits
        // inert (db::tasks::update_task_status_at's recurrence branch
        // completes the task normally instead of rescheduling when it can't
        // parse the rule) rather than blocking the import on it.
        let recurrence_rule = if is_recurring {
            t.due.as_ref().and_then(|d| d.string.clone())
        } else {
            None
        };

        let due_date = normalize_due_date(&t.due);
        let due_time = t
            .due
            .as_ref()
            .and_then(|d| d.datetime.as_deref())
            .and_then(parse_due_time);
        let duration_minutes = t.duration.as_ref().and_then(duration_to_minutes);
        let priority = map_priority(t.priority);
        // Descriptions are markdown-canonical, and Todoist's are already
        // markdown, so this copies through verbatim — no enrichment, no
        // conversion. The user's own prose is the only thing that lands here.
        let description = t.description.clone().filter(|d| !d.trim().is_empty());

        // Upsert by external_id
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&t.id)
        .fetch_optional(pool)
        .await?;
        let is_new = existing.is_none();

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let local_id = if let Some((id,)) = existing {
            sqlx::query(
                "UPDATE local_tasks
                 SET content = ?, description = ?, project_id = ?, priority = ?, due_date = ?,
                     due_time = ?, duration_minutes = ?, recurrence_rule = ?, section_id = ?,
                     position = ?, updated_at = datetime('now')
                 WHERE id = ?",
            )
            .bind(&t.content)
            .bind(&description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
            .bind(&due_time)
            .bind(duration_minutes)
            .bind(&recurrence_rule)
            .bind(&local_section_id)
            .bind(t.order)
            .bind(&id)
            .execute(pool)
            .await?;
            result.tasks_updated += 1;
            id
        } else {
            let new_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO local_tasks
                 (id, parent_id, content, description, project_id, priority, due_date, due_time,
                  duration_minutes, recurrence_rule, section_id,
                  completed, completed_at, status, linked_doc_id, position,
                  external_id, external_source, created_at, updated_at)
                 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'todo', NULL, ?, ?, 'todoist', ?, ?)",
            )
            .bind(&new_id)
            .bind(&t.content)
            .bind(&description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
            .bind(&due_time)
            .bind(duration_minutes)
            .bind(&recurrence_rule)
            .bind(&local_section_id)
            .bind(t.order)
            .bind(&t.id)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await?;
            result.tasks_created += 1;
            new_id
        };

        todoist_to_local_task.insert(t.id.clone(), local_id.clone());
        if let Some(td_parent) = &t.parent_id {
            child_to_td_parent.insert(t.id.clone(), td_parent.clone());
        }

        if is_recurring {
            result.recurring_preserved += 1;
        }
        if had_labels {
            result.labels_preserved += 1;
        }

        // ── Labels: direct SQL against `task_labels`, never ──
        // `db::labels::set_task_labels` — see this function's doc comment
        // for why. Mirrors `sync_loop::apply_pull`'s delete-then-insert +
        // diff-based sync_log approach for the same table.
        let current_label_ids: std::collections::HashSet<String> = sqlx::query_as::<_, (String,)>(
            "SELECT label_id FROM task_labels WHERE task_id = ?",
        )
        .bind(&local_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

        if current_label_ids != target_label_ids {
            sqlx::query("DELETE FROM task_labels WHERE task_id = ?")
                .bind(&local_id)
                .execute(pool)
                .await?;
            for label_id in &target_label_ids {
                sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
                    .bind(&local_id)
                    .bind(label_id)
                    .execute(pool)
                    .await?;
            }
            for removed in current_label_ids.difference(&target_label_ids) {
                sync::append_sync_log(
                    pool,
                    "task_labels",
                    &sync::task_labels_row_id(&local_id, removed),
                    "DELETE",
                    None,
                    None,
                )
                .await
                .ok();
            }
            for added in target_label_ids.difference(&current_label_ids) {
                let created_at: Option<(String,)> = sqlx::query_as(
                    "SELECT created_at FROM task_labels WHERE task_id = ? AND label_id = ?",
                )
                .bind(&local_id)
                .bind(added)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();
                if let Some((created_at,)) = created_at {
                    let snapshot = serde_json::json!({
                        "task_id": local_id,
                        "label_id": added,
                        "created_at": created_at,
                    })
                    .to_string();
                    sync::append_sync_log(
                        pool,
                        "task_labels",
                        &sync::task_labels_row_id(&local_id, added),
                        "INSERT",
                        None,
                        Some(&snapshot),
                    )
                    .await
                    .ok();
                }
            }
        }

        // Sync log entry for the local_tasks row itself, using
        // `task_sync_snapshot` (not a plain `serde_json::to_string`) —
        // `LocalTask::labels` isn't a `local_tasks` column, and a snapshot
        // carrying it fails every apply with "no such column: labels".
        let task_row: Option<crate::types::LocalTask> = sqlx::query_as::<_, crate::types::LocalTask>(
            &format!("SELECT {} FROM local_tasks WHERE id = ?", crate::db::tasks::SELECT_COLS),
        )
        .bind(&local_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if let Some(task) = task_row {
            let snapshot = sync::task_sync_snapshot(&task);
            let op = if is_new { "INSERT" } else { "UPDATE" };
            sync::append_sync_log(pool, "local_tasks", &local_id, op, None, Some(&snapshot))
                .await
                .ok();
        }
    }

    // Tasks pass 2: resolve parent_id now that all local ids exist.
    for (child_td_id, parent_td_id) in &child_to_td_parent {
        if let (Some(child_local), Some(parent_local)) = (
            todoist_to_local_task.get(child_td_id),
            todoist_to_local_task.get(parent_td_id),
        ) {
            sqlx::query("UPDATE local_tasks SET parent_id = ? WHERE id = ?")
                .bind(parent_local)
                .bind(child_local)
                .execute(pool)
                .await?;
        } else {
            result.errors.push(format!(
                "Orphan subtask — Todoist task {} has parent {} but parent was not migrated",
                child_td_id, parent_td_id
            ));
        }
    }

    // Log the migration in activity timeline
    crate::db::activity::log_activity(
        pool,
        "todoist_migrated",
        None,
        Some(serde_json::json!({
            "projects_created": result.projects_created,
            "projects_updated": result.projects_updated,
            "tasks_created": result.tasks_created,
            "tasks_updated": result.tasks_updated,
        })),
    )
    .await;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    /// Task 10 fixture: one task with 2 labels + a recurring due (with a
    /// datetime and a 10m duration) + a section, under a child project.
    /// Everything must land as a first-class field — no flattening into the
    /// description, and no "— imported from Todoist —" block.
    #[tokio::test]
    async fn import_maps_labels_recurrence_section_and_nesting_to_first_class_fields() {
        let pool = test_pool().await;

        let parent_project = TdProject {
            id: "td-parent".into(),
            name: "Work".into(),
            color: Some("blue".into()),
            parent_id: None,
            is_inbox_project: Some(false),
        };
        let child_project = TdProject {
            id: "td-child".into(),
            name: "Client A".into(),
            color: Some("red".into()),
            parent_id: Some("td-parent".into()),
            is_inbox_project: Some(false),
        };
        let section = TdSection {
            id: "td-section".into(),
            project_id: "td-child".into(),
            name: "Sprint 1".into(),
        };
        let task = TdTask {
            id: "td-task".into(),
            content: "Ship the thing".into(),
            description: Some("Some user prose.".into()),
            project_id: Some("td-child".into()),
            section_id: Some("td-section".into()),
            parent_id: None,
            priority: 3,
            due: Some(TdDue {
                date: Some("2026-08-10".into()),
                datetime: Some("2026-08-10T09:00:00".into()),
                string: Some("every 2 weeks @ 09:00".into()),
                is_recurring: Some(true),
            }),
            labels: Some(vec!["deep-work".into(), "waiting".into()]),
            order: 1,
            checked: Some(false),
            duration: Some(TdDuration { amount: Some(10), unit: Some("minute".into()) }),
        };

        // Non-recurring dated task: `due.string` is just Todoist's
        // human-readable label for the date itself ("Aug 16"), not a
        // recurrence rule — `is_recurring: false`. Guards against the
        // `due.string` verbatim-copy leaking that date phrase into
        // `recurrence_rule`, which would render a bogus recurrence chip on a
        // one-off task.
        let one_off_task = TdTask {
            id: "td-task-2".into(),
            content: "Renew passport".into(),
            description: None,
            project_id: Some("td-child".into()),
            section_id: None,
            parent_id: None,
            priority: 1,
            due: Some(TdDue {
                date: Some("2026-08-16".into()),
                datetime: Some("2026-08-16T14:00:00".into()),
                string: Some("Aug 16".into()),
                is_recurring: Some(false),
            }),
            labels: None,
            order: 2,
            checked: Some(false),
            duration: None,
        };

        let result = apply_migration(
            &pool,
            &[parent_project, child_project],
            &[section],
            &[task, one_off_task],
        )
        .await
        .unwrap();
        assert!(result.errors.is_empty(), "unexpected errors: {:?}", result.errors);

        let row: (String, Option<String>, String, Option<String>, Option<i64>, Option<String>, Option<String>) =
            sqlx::query_as(
                "SELECT content, description, project_id, due_time, duration_minutes, recurrence_rule, section_id
                 FROM local_tasks WHERE external_source = 'todoist' AND external_id = 'td-task'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        let (content, description, project_id, due_time, duration_minutes, recurrence_rule, section_id) = row;

        assert_eq!(content, "Ship the thing");
        let description = description.expect("description carries the user's own prose");
        assert!(
            !description.contains("— imported from Todoist —"),
            "description must not carry the enriched-description block: {description:?}"
        );
        assert_eq!(description, "Some user prose.");
        assert_eq!(due_time.as_deref(), Some("09:00"));
        assert_eq!(duration_minutes, Some(10));
        assert_eq!(recurrence_rule.as_deref(), Some("every 2 weeks @ 09:00"));

        // Section landed as a first-class `sections` row, not a fake project.
        let section_id = section_id.expect("task must carry a first-class section_id");
        let section_row: (String, String, Option<String>) = sqlx::query_as(
            "SELECT name, project_id, external_id FROM sections WHERE id = ?",
        )
        .bind(&section_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(section_row.0, "Sprint 1");
        assert_eq!(section_row.2.as_deref(), Some("td-section"));
        assert_eq!(section_row.1, project_id, "section's project_id must match the task's local project");

        // Project nesting: child project's parent_id must point at the parent's local id.
        let parent_local_id: (String,) = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = 'td-parent'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let child_parent_id: (Option<String>,) =
            sqlx::query_as("SELECT parent_id FROM projects WHERE id = ?")
                .bind(&project_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(child_parent_id.0.as_deref(), Some(parent_local_id.0.as_str()));

        // Labels landed as real label rows + task_labels assignments, not
        // flattened into description text.
        let label_names: Vec<String> = sqlx::query_as::<_, (String,)>(
            "SELECT l.name FROM labels l
             JOIN task_labels tl ON tl.label_id = l.id
             JOIN local_tasks t ON t.id = tl.task_id
             WHERE t.external_id = 'td-task'
             ORDER BY l.name",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|(n,)| n)
        .collect();
        assert_eq!(label_names, vec!["deep-work".to_string(), "waiting".to_string()]);

        // Non-recurring dated task: due_date/due_time still land as
        // first-class fields, but recurrence_rule must stay NULL — the due
        // string is a date label ("Aug 16"), not a recurrence rule, and must
        // not leak into a field that renders a recurrence chip.
        let one_off_row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT due_date, due_time, recurrence_rule
             FROM local_tasks WHERE external_source = 'todoist' AND external_id = 'td-task-2'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let (one_off_due_date, one_off_due_time, one_off_recurrence_rule) = one_off_row;
        assert_eq!(one_off_due_date.as_deref(), Some("2026-08-16"));
        assert_eq!(one_off_due_time.as_deref(), Some("14:00"));
        assert_eq!(
            one_off_recurrence_rule, None,
            "a non-recurring due.string (\"Aug 16\") must not land in recurrence_rule"
        );
    }
}
