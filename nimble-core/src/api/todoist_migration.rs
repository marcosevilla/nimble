//! One-time migration of Todoist tasks/projects into local storage.
//!
//! Writes to the `projects` and `local_tasks` tables, using the `external_id` /
//! `external_source` columns (added in schema v15) for idempotency. Running the
//! migration twice upserts in place — no duplicates.

use std::collections::HashMap;

use chrono::Local;
use serde::Deserialize;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::sync;
use crate::types::{
    TodoistMigrationOptions, TodoistMigrationPreview, TodoistMigrationResult,
};

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
}

#[derive(Debug, Deserialize, Clone)]
struct TdDue {
    date: Option<String>,
    string: Option<String>,
    is_recurring: Option<bool>,
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

// ── Helpers: project naming + description enrichment ──

/// Flatten Todoist's project tree into names like "Parent / Child / Grandchild".
fn build_project_names(
    projects: &[TdProject],
    flatten_nested: bool,
) -> HashMap<String, String> {
    let by_id: HashMap<&str, &TdProject> =
        projects.iter().map(|p| (p.id.as_str(), p)).collect();

    let mut names = HashMap::new();
    for p in projects {
        let name = if flatten_nested {
            let mut chain = vec![p.name.clone()];
            let mut current = p.parent_id.as_deref();
            while let Some(pid) = current {
                if let Some(parent) = by_id.get(pid) {
                    chain.push(parent.name.clone());
                    current = parent.parent_id.as_deref();
                } else {
                    break;
                }
            }
            chain.reverse();
            chain.join(" / ")
        } else {
            p.name.clone()
        };
        names.insert(p.id.clone(), name);
    }
    names
}

/// Concatenate labels and recurring notes into the task's description. Uses a
/// clear separator so migration artifacts are visually distinct from the
/// user's own prose.
fn build_enriched_description(
    original: &Option<String>,
    labels: &[String],
    recurring_note: Option<&str>,
    preserve_labels: bool,
    preserve_recurring: bool,
) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    if let Some(desc) = original {
        if !desc.trim().is_empty() {
            parts.push(desc.clone());
        }
    }

    let mut metadata_lines: Vec<String> = Vec::new();
    if preserve_labels && !labels.is_empty() {
        let tags = labels.iter().map(|l| format!("#{}", l)).collect::<Vec<_>>().join(" ");
        metadata_lines.push(format!("Labels: {}", tags));
    }
    if preserve_recurring {
        if let Some(rec) = recurring_note {
            metadata_lines.push(format!("Recurring: {}", rec));
        }
    }

    if !metadata_lines.is_empty() {
        parts.push("— imported from Todoist —".to_string());
        parts.push(metadata_lines.join("\n"));
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

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

    let names = build_project_names(&projects, true);
    let mut project_names_preview: Vec<String> = names.values().cloned().collect();
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

pub async fn migrate(
    pool: &SqlitePool,
    token: &str,
    opts: TodoistMigrationOptions,
) -> crate::Result<TodoistMigrationResult> {
    let client = reqwest::Client::new();
    let (projects, sections, tasks) = tokio::try_join!(
        fetch_paginated_projects(&client, token),
        fetch_paginated_sections(&client, token),
        fetch_all_active_tasks(&client, token),
    )?;

    let mut result = TodoistMigrationResult {
        projects_created: 0,
        projects_updated: 0,
        tasks_created: 0,
        tasks_updated: 0,
        recurring_preserved: 0,
        labels_preserved: 0,
        errors: Vec::new(),
    };

    // Look up the current max position so new projects append to the end.
    let max_project_position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) FROM projects",
    )
    .fetch_one(pool)
    .await?;

    let project_names = build_project_names(&projects, opts.flatten_nested_projects);

    // Todoist project_id → local project_id after upsert
    let mut todoist_to_local_project: HashMap<String, String> = HashMap::new();
    let mut next_position = max_project_position + 1;

    // Sections grouped by project_id, used for section-project creation.
    let mut sections_by_project: HashMap<String, Vec<TdSection>> = HashMap::new();
    for s in &sections {
        sections_by_project
            .entry(s.project_id.clone())
            .or_default()
            .push(s.clone());
    }
    // (project_id, section_id) → local project_id for section-backed projects
    let mut section_to_local_project: HashMap<(String, String), String> = HashMap::new();

    // Projects pass
    for p in &projects {
        let local_name = project_names.get(&p.id).cloned().unwrap_or_else(|| p.name.clone());
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
                .bind(&local_name)
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
            .bind(&local_name)
            .bind(&color)
            .bind(next_position)
            .bind(&p.id)
            .execute(pool)
            .await?;
            next_position += 1;
            result.projects_created += 1;
            new_id
        };

        todoist_to_local_project.insert(p.id.clone(), local_id.clone());

        // Section-backed projects (opt-in)
        if opts.create_section_projects {
            if let Some(section_list) = sections_by_project.get(&p.id) {
                for s in section_list {
                    let section_project_name = format!("{} / {}", local_name, s.name);
                    let section_external_id = format!("section:{}", s.id);
                    let existing_s: Option<(String,)> = sqlx::query_as(
                        "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
                    )
                    .bind(&section_external_id)
                    .fetch_optional(pool)
                    .await?;

                    let s_local_id = if let Some((id,)) = existing_s {
                        sqlx::query("UPDATE projects SET name = ? WHERE id = ?")
                            .bind(&section_project_name)
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
                        .bind(&section_project_name)
                        .bind(&color)
                        .bind(next_position)
                        .bind(&section_external_id)
                        .execute(pool)
                        .await?;
                        next_position += 1;
                        result.projects_created += 1;
                        new_id
                    };
                    section_to_local_project
                        .insert((p.id.clone(), s.id.clone()), s_local_id);
                }
            }
        }
    }

    // Tasks pass 1: upsert with parent_id left null; record Todoist parent refs separately.
    let mut todoist_to_local_task: HashMap<String, String> = HashMap::new();
    // Todoist task_id → Todoist parent_id (for linkage in pass 2)
    let mut child_to_td_parent: HashMap<String, String> = HashMap::new();

    for t in &tasks {
        // Target local project
        let target_project = if let (Some(section_id), Some(project_id)) =
            (t.section_id.as_ref(), t.project_id.as_ref())
        {
            if opts.create_section_projects {
                section_to_local_project
                    .get(&(project_id.clone(), section_id.clone()))
                    .cloned()
                    .or_else(|| todoist_to_local_project.get(project_id).cloned())
                    .unwrap_or_else(|| "inbox".to_string())
            } else {
                todoist_to_local_project
                    .get(project_id)
                    .cloned()
                    .unwrap_or_else(|| "inbox".to_string())
            }
        } else if let Some(project_id) = t.project_id.as_ref() {
            todoist_to_local_project
                .get(project_id)
                .cloned()
                .unwrap_or_else(|| "inbox".to_string())
        } else {
            "inbox".to_string()
        };

        let labels = t.labels.clone().unwrap_or_default();
        let had_labels = !labels.is_empty();
        let recurring_note = t
            .due
            .as_ref()
            .filter(|d| d.is_recurring.unwrap_or(false))
            .and_then(|d| d.string.clone());
        let is_recurring = recurring_note.is_some();

        let enriched_description = build_enriched_description(
            &t.description,
            &labels,
            recurring_note.as_deref(),
            opts.preserve_labels,
            opts.preserve_recurring,
        );

        let due_date = normalize_due_date(&t.due);
        let priority = map_priority(t.priority);

        // Upsert by external_id
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&t.id)
        .fetch_optional(pool)
        .await?;

        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let local_id = if let Some((id,)) = existing {
            sqlx::query(
                "UPDATE local_tasks
                 SET content = ?, description = ?, project_id = ?, priority = ?, due_date = ?,
                     position = ?, updated_at = datetime('now')
                 WHERE id = ?",
            )
            .bind(&t.content)
            .bind(&enriched_description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
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
                 (id, parent_id, content, description, project_id, priority, due_date,
                  completed, completed_at, status, linked_doc_id, position,
                  external_id, external_source, created_at, updated_at)
                 VALUES (?, NULL, ?, ?, ?, ?, ?, 0, NULL, 'todo', NULL, ?, ?, 'todoist', ?, ?)",
            )
            .bind(&new_id)
            .bind(&t.content)
            .bind(&enriched_description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
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

        if is_recurring && opts.preserve_recurring {
            result.recurring_preserved += 1;
        }
        if had_labels && opts.preserve_labels {
            result.labels_preserved += 1;
        }

        // Sync log entry for cross-device replication.
        sync::append_sync_log(pool, "local_tasks", &local_id, "INSERT", None, None)
            .await
            .ok();
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
