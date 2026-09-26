use crate::{args::*, output::CliError};
use nimble_core::{
    agent_protocol::{AgentOperation, Domain},
    db::{self, focus::engine::NativeTaskAction},
    types::{CreateTaskInput, Label as LabelRow, LabelGroup, LabelGroupPatch, TaskSearchFilters, UpdateTaskInput},
};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;

pub struct CommandResult {
    pub data: Value,
    pub domains: Vec<Domain>,
    pub ids: Vec<String>,
}
fn result<T: Serialize>(data: T, domains: Vec<Domain>) -> Result<CommandResult, CliError> {
    let value = serde_json::to_value(data)
        .map_err(|_| CliError::new("internal", "Cannot encode result."))?;
    let ids = value
        .get("id")
        .and_then(Value::as_str)
        .map(|id| vec![id.to_owned()])
        .unwrap_or_default();
    Ok(CommandResult {
        data: value,
        domains,
        ids,
    })
}
fn changed(id: &str, domains: Vec<Domain>) -> Result<CommandResult, CliError> {
    result(json!({"id":id}), domains)
}
fn nonempty(s: &str) -> Result<(), CliError> {
    if s.trim().is_empty() {
        Err(CliError::validation("Text must not be empty."))
    } else {
        Ok(())
    }
}
fn date(s: &str) -> Result<(), CliError> {
    let parsed = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| CliError::validation("Dates must be valid YYYY-MM-DD values."))?;
    if parsed.format("%Y-%m-%d").to_string() != s {
        return Err(CliError::validation("Dates must use YYYY-MM-DD."));
    }
    Ok(())
}
fn range(d: &DateRange) -> Result<(), CliError> {
    date(&d.from)?;
    date(&d.to)?;
    if d.from > d.to {
        return Err(CliError::validation(
            "From date must be before or equal to to date.",
        ));
    }
    Ok(())
}
fn validate_fields(f: &Fields) -> Result<(), CliError> {
    if let Some(d) = &f.due {
        date(d)?;
    }
    if let Some(t) = &f.time {
        let parsed = chrono::NaiveTime::parse_from_str(t, "%H:%M")
            .map_err(|_| CliError::validation("Time must be valid HH:MM."))?;
        if parsed.format("%H:%M").to_string() != *t {
            return Err(CliError::validation("Time must use HH:MM."));
        }
    }
    for v in [&f.project, &f.section, &f.recurrence]
        .into_iter()
        .flatten()
    {
        nonempty(v)?;
    }
    if let Some(ids) = &f.labels {
        for id in ids {
            nonempty(id)?;
        }
    }
    Ok(())
}
async fn task(pool: &SqlitePool, id: &str) -> Result<nimble_core::types::LocalTask, CliError> {
    db::tasks::get_local_tasks(pool, None, None, true)
        .await?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(CliError::not_found)
}
async fn project_exists(pool: &SqlitePool, id: &str) -> Result<(), CliError> {
    if db::projects::get_projects(pool)
        .await?
        .iter()
        .any(|p| p.id == id)
    {
        Ok(())
    } else {
        Err(CliError::not_found())
    }
}
async fn label_exists(pool: &SqlitePool, id: &str) -> Result<(), CliError> {
    if db::labels::list_labels(pool)
        .await?
        .iter()
        .any(|p| p.id == id)
    {
        Ok(())
    } else {
        Err(CliError::not_found())
    }
}
async fn section_exists(pool: &SqlitePool, id: &str) -> Result<(), CliError> {
    for p in db::projects::get_projects(pool).await? {
        if db::sections::list_sections(pool, &p.id)
            .await?
            .iter()
            .any(|s| s.id == id)
        {
            return Ok(());
        }
    }
    Err(CliError::not_found())
}
fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Exact id first, then exact (case-sensitive) name, then case-insensitive
/// name; ambiguity is only among case-insensitive matches.
fn pick<'a, T>(items: &'a [T], key: &str, id: impl Fn(&T) -> &str, name: impl Fn(&T) -> &str, what: &str) -> Result<&'a T, CliError> {
    if let Some(found) = items.iter().find(|i| id(i) == key) {
        return Ok(found);
    }
    if let Some(found) = items.iter().find(|i| name(i).trim() == key.trim()) {
        return Ok(found);
    }
    let matches: Vec<&T> = items.iter().filter(|i| same_name(name(i), key)).collect();
    match matches.len() {
        0 => Err(CliError::new("not_found", format!("No {what} named \"{key}\"."))),
        1 => Ok(matches[0]),
        n => Err(CliError::validation(format!("{n} {what}s are named \"{key}\" (ignoring case). Use its id."))),
    }
}

async fn resolve_label(pool: &SqlitePool, key: &str) -> Result<LabelRow, CliError> {
    let labels = db::labels::list_labels(pool).await?;
    pick(&labels, key, |l| l.id.as_str(), |l| l.name.as_str(), "label").cloned()
}

async fn resolve_labels(pool: &SqlitePool, keys: &[String]) -> Result<Vec<String>, CliError> {
    let mut ids = Vec::with_capacity(keys.len());
    for key in keys {
        ids.push(resolve_label(pool, key).await?.id);
    }
    Ok(ids)
}

async fn resolve_group(pool: &SqlitePool, key: &str) -> Result<LabelGroup, CliError> {
    let groups = db::labels::list_label_groups(pool).await?;
    pick(&groups, key, |g| g.id.as_str(), |g| g.name.as_str(), "label group").cloned()
}

async fn resolve_project(pool: &SqlitePool, key: &str) -> Result<String, CliError> {
    let projects = db::projects::get_projects(pool).await?;
    Ok(pick(&projects, key, |p| p.id.as_str(), |p| p.name.as_str(), "project")?.id.clone())
}
fn task_domains() -> Vec<Domain> {
    vec![Domain::Tasks, Domain::Activity]
}
/// A task write the running app should execute through its FocusService.
pub struct NativeWrite {
    pub action: NativeTaskAction,
    /// Flags a retry must repeat so the request body is byte-identical.
    pub retry_flags: String,
    /// Task to re-read for output after a status change (the app committed it).
    pub read_back: Option<String>,
}

fn expected_due(
    flag: &Option<String>,
    current: &nimble_core::types::LocalTask,
) -> Result<Option<String>, CliError> {
    match flag.as_deref() {
        None => Ok(current.due_date.clone()),
        Some("none") => Ok(None),
        Some(d) => {
            date(d)?;
            Ok(Some(d.to_owned()))
        }
    }
}
/// Direct (app closed) status write with the same recurring occurrence
/// identity check the app's focus service applies.
async fn checked_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    note: Option<&str>,
    expected_due_date: Option<&str>,
) -> Result<(), CliError> {
    db::tasks::update_task_status_expected(pool, id, status, note, expected_due_date)
        .await
        .map_err(|e| match &e {
            nimble_core::Error::Other(m) if m.starts_with("stale_occurrence") => CliError::new(
                "stale_occurrence",
                "The task's due date changed since it was read. Inspect it before completing again.",
            ),
            _ => e.into(),
        })
}
/// While Todoist sync is on, the rule of a task Todoist recurs is read-only
/// (nimble_core::integrations::todoist::recurrence). Revisit at C5 cutover.
async fn recurrence_editable(
    pool: &SqlitePool,
    current: &nimble_core::types::LocalTask,
    input: &UpdateTaskInput,
) -> Result<(), CliError> {
    if nimble_core::integrations::todoist::recurrence::recurrence_change_locked(pool, current, input).await? {
        return Err(CliError::validation(
            "This task repeats in Todoist. Edit its repeat rule in Todoist; other fields can be updated here.",
        ));
    }
    Ok(())
}
fn due_flag(value: &Option<String>) -> String {
    format!(" --expected-due {}", value.as_deref().unwrap_or("none"))
}

fn create_input(content: String, parent: Option<String>, f: Fields) -> CreateTaskInput {
    CreateTaskInput {
        sync_policy: None,
        content,
        parent_id: parent,
        project_id: f.project,
        description: f.description,
        priority: f.priority,
        due_date: f.due,
        due_time: f.time,
        duration_minutes: f.duration,
        recurrence_rule: f.recurrence,
        section_id: f.section,
        label_ids: f.labels,
        reminder_offset_minutes: f.reminder_offset,
        google_calendar_enabled: f.google_calendar_enabled,
    }
}
fn update_input(content: Option<String>, linked_doc: Option<String>, f: Fields) -> UpdateTaskInput {
    UpdateTaskInput {
        content,
        description: f.description,
        project_id: f.project,
        priority: f.priority,
        due_date: f.due,
        clear_due_date: f.clear_due_date,
        linked_doc_id: linked_doc,
        due_time: f.time,
        duration_minutes: f.duration,
        recurrence_rule: f.recurrence,
        section_id: f.section,
        label_ids: if f.clear_labels { Some(vec![]) } else { f.labels },
        clear_due_time: f.clear_due_time,
        clear_recurrence: f.clear_recurrence,
        clear_section: f.clear_section,
        clear_duration: f.clear_duration,
        reminder_offset_minutes: f.reminder_offset,
        google_calendar_enabled: f.google_calendar_enabled,
        clear_reminder: f.clear_reminder,
        ..Default::default()
    }
}
fn reject_clear_flags(f: &Fields) -> Result<(), CliError> {
    if f.clear_due_date
        || f.clear_due_time
        || f.clear_duration
        || f.clear_recurrence
        || f.clear_section
        || f.clear_labels
        || f.clear_reminder
    {
        return Err(CliError::validation("Clear flags apply only to task update."));
    }
    Ok(())
}

/// Validate a task write exactly as the direct path does, then describe it
/// as a NativeTaskAction for the running app. `None` = not a task write.
pub async fn native_write(pool: &SqlitePool, command: Command) -> Result<Option<NativeWrite>, CliError> {
    let Command::Task(command) = command else { return Ok(None) };
    Ok(Some(match command {
        Task::Create { content, parent, fields: f } => {
            nonempty(&content)?;
            validate_fields(&f)?;
            reject_clear_flags(&f)?;
            if let Some(id) = &parent {
                task(pool, id).await?;
            }
            NativeWrite {
                action: NativeTaskAction::Create { input: create_input(content, parent, f) },
                retry_flags: String::new(),
                read_back: None,
            }
        }
        Task::Update { id, content, linked_doc, fields: f } => {
            validate_fields(&f)?;
            if let Some(c) = &content {
                nonempty(c)?;
            }
            let current = task(pool, &id).await?;
            let input = update_input(content, linked_doc, f);
            recurrence_editable(pool, &current, &input).await?;
            NativeWrite {
                action: NativeTaskAction::Update { id, input },
                retry_flags: String::new(),
                read_back: None,
            }
        }
        Task::Complete { id, expected_due: flag } => {
            let current = task(pool, &id).await?;
            let due = expected_due(&flag, &current)?;
            NativeWrite {
                retry_flags: due_flag(&due),
                read_back: Some(id.clone()),
                action: NativeTaskAction::SetStatus {
                    id, status: "complete".into(), note: None, expected_due_date: due,
                },
            }
        }
        Task::Reopen { id } => {
            task(pool, &id).await?;
            NativeWrite {
                read_back: Some(id.clone()),
                retry_flags: String::new(),
                action: NativeTaskAction::SetStatus {
                    id, status: "todo".into(), note: None, expected_due_date: None,
                },
            }
        }
        Task::Status { id, status, reason, expected_due: flag } => {
            let current = task(pool, &id).await?;
            let due = if status == "complete" { expected_due(&flag, &current)? } else { None };
            NativeWrite {
                retry_flags: if status == "complete" { due_flag(&due) } else { String::new() },
                read_back: Some(id.clone()),
                action: NativeTaskAction::SetStatus { id, status, note: reason, expected_due_date: due },
            }
        }
        Task::Delete { id } => {
            task(pool, &id).await?;
            NativeWrite {
                read_back: None,
                retry_flags: String::new(),
                action: NativeTaskAction::Delete { id },
            }
        }
        _ => return Ok(None),
    }))
}

/// Shape the app's reply like the direct path's output.
pub async fn native_output(
    pool: &SqlitePool,
    write: &NativeWrite,
    data: Value,
) -> Result<Value, CliError> {
    if let Some(id) = &write.read_back {
        return Ok(serde_json::to_value(task(pool, id).await?)
            .map_err(|_| CliError::new("internal", "Cannot encode result."))?);
    }
    if let NativeTaskAction::Delete { id } = &write.action {
        return Ok(json!({"id": id}));
    }
    Ok(data.get("task").cloned().unwrap_or(Value::Null))
}

pub fn app_operation(command: &Command) -> Option<AgentOperation> {
    match command {
        Command::Backup(Backup::Status) => Some(AgentOperation::BackupStatus),
        Command::Backup(Backup::Now) => Some(AgentOperation::BackupNow),
        Command::Backup(Backup::Verify) => Some(AgentOperation::BackupVerify),
        Command::Backup(Backup::Activate) => Some(AgentOperation::RestoreActivate),
        Command::Sync(Sync::Now) => Some(AgentOperation::SyncNow),
        _ => None,
    }
}
pub async fn execute(pool: &SqlitePool, command: Command) -> Result<CommandResult, CliError> {
    match command {
        Command::Task(command) => match command {
            Task::List {
                project,
                due,
                include_completed,
            } => {
                if let Some(d) = &due {
                    date(d)?;
                }
                result(
                    db::tasks::get_local_tasks(
                        pool,
                        project.as_deref(),
                        due.as_deref(),
                        include_completed,
                    )
                    .await?,
                    vec![],
                )
            }
            Task::Get { id } => result(task(pool, &id).await?, vec![]),
            Task::Create {
                content,
                parent,
                fields: f,
            } => {
                nonempty(&content)?;
                validate_fields(&f)?;
                reject_clear_flags(&f)?;
                if let Some(id) = &parent {
                    task(pool, id).await?;
                }
                result(
                    db::tasks::create_local_task(pool, create_input(content, parent, f)).await?,
                    task_domains(),
                )
            }
            Task::Update {
                id,
                content,
                linked_doc,
                fields: f,
            } => {
                validate_fields(&f)?;
                if let Some(c) = &content {
                    nonempty(c)?;
                }
                let current = task(pool, &id).await?;
                let input = update_input(content, linked_doc, f);
                recurrence_editable(pool, &current, &input).await?;
                result(db::tasks::update_local_task(pool, &id, input).await?, task_domains())
            }
            Task::Complete { id, expected_due: flag } => {
                let current = task(pool, &id).await?;
                let due = expected_due(&flag, &current)?;
                checked_status(pool, &id, "complete", None, due.as_deref()).await?;
                result(task(pool, &id).await?, task_domains())
            }
            Task::Reopen { id } => {
                task(pool, &id).await?;
                db::tasks::update_task_status(pool, &id, "todo", None).await?;
                result(task(pool, &id).await?, task_domains())
            }
            Task::Status { id, status, reason, expected_due: flag } => {
                let current = task(pool, &id).await?;
                let due = if status == "complete" { expected_due(&flag, &current)? } else { None };
                checked_status(pool, &id, &status, reason.as_deref(), due.as_deref()).await?;
                result(task(pool, &id).await?, task_domains())
            }
            Task::Delete { id } => {
                task(pool, &id).await?;
                db::tasks::delete_local_task(pool, &id).await?;
                changed(&id, task_domains())
            }
            Task::Labels { id, ids, .. } => result(
                db::labels::set_task_labels(pool, &id, &ids).await?,
                vec![Domain::Tasks, Domain::Labels],
            ),
            Task::Search { query, status, label, project, limit, reindex } => {
                let query = query.unwrap_or_default();
                if query.trim().is_empty() && !reindex {
                    return Err(CliError::validation("Give a search query, or --reindex."));
                }
                let reindexed = if reindex { Some(db::task_search::rebuild_task_index(pool).await?) } else { None };
                if query.trim().is_empty() {
                    return result(json!({ "reindexed": reindexed }), vec![]);
                }
                let filters = TaskSearchFilters {
                    status: Some(status),
                    label_ids: resolve_labels(pool, &label).await?,
                    project_id: match &project { Some(key) => Some(resolve_project(pool, key).await?), None => None },
                };
                result(db::task_search::search_tasks(pool, &query, &filters, limit).await?, vec![])
            }
        },
        Command::Project(command) => match command {
            Project::List => result(db::projects::get_projects(pool).await?, vec![]),
            Project::Create {
                name,
                color,
                parent,
            } => {
                nonempty(&name)?;
                result(
                    db::projects::create_project(pool, &name, &color, parent.as_deref()).await?,
                    vec![Domain::Projects],
                )
            }
            Project::Update {
                id,
                name,
                color,
                parent,
                clear_parent,
            } => {
                project_exists(pool, &id).await?;
                if let Some(n) = &name {
                    nonempty(n)?;
                }
                db::projects::update_project(
                    pool,
                    &id,
                    name.as_deref(),
                    color.as_deref(),
                    parent.as_deref(),
                    clear_parent,
                )
                .await?;
                changed(&id, vec![Domain::Projects, Domain::Tasks])
            }
            Project::Delete { id } => {
                project_exists(pool, &id).await?;
                db::projects::delete_project(pool, &id).await?;
                changed(&id, vec![Domain::Projects, Domain::Sections, Domain::Tasks])
            }
        },
        Command::Section(command) => match command {
            Section::List { project } => {
                result(db::sections::list_sections(pool, &project).await?, vec![])
            }
            Section::Create { name, project } => {
                nonempty(&name)?;
                result(
                    db::sections::create_section(pool, &project, &name).await?,
                    vec![Domain::Sections],
                )
            }
            Section::Rename { id, name } => {
                nonempty(&name)?;
                section_exists(pool, &id).await?;
                result(
                    db::sections::rename_section(pool, &id, &name).await?,
                    vec![Domain::Sections],
                )
            }
            Section::Delete { id } => {
                section_exists(pool, &id).await?;
                db::sections::delete_section(pool, &id).await?;
                changed(&id, vec![Domain::Sections, Domain::Tasks])
            }
            Section::Reorder { ids } => {
                for id in &ids {
                    section_exists(pool, id).await?;
                }
                db::sections::reorder_sections(pool, &ids).await?;
                result(json!({"ids":ids}), vec![Domain::Sections])
            }
        },
        Command::Label(command) => match command {
            Label::List => result(db::labels::list_labels(pool).await?, vec![]),
            Label::Create { name, color } => {
                nonempty(&name)?;
                result(
                    db::labels::create_label(pool, &name, &color).await?,
                    vec![Domain::Labels],
                )
            }
            Label::Update { id, name, color } => {
                label_exists(pool, &id).await?;
                if let Some(n) = &name {
                    nonempty(n)?;
                }
                result(
                    db::labels::update_label(pool, &id, name.as_deref(), color.as_deref()).await?,
                    vec![Domain::Labels, Domain::Tasks],
                )
            }
            Label::Delete { id } => {
                label_exists(pool, &id).await?;
                db::labels::delete_label(pool, &id).await?;
                changed(&id, vec![Domain::Labels, Domain::Tasks])
            }
            Label::Unused => {
                let ids = db::labels::unused_label_ids(pool).await?;
                let labels: Vec<LabelRow> = db::labels::list_labels(pool).await?.into_iter().filter(|l| ids.contains(&l.id)).collect();
                result(labels, vec![])
            }
            Label::Group(command) => match command {
                LabelGroupCommand::List => result(db::labels::list_label_groups(pool).await?, vec![]),
                LabelGroupCommand::Create { name, pick_one, system } => {
                    nonempty(&name)?;
                    let existing = db::labels::list_label_groups(pool).await?.into_iter().find(|g| same_name(&g.name, &name));
                    let group = match existing {
                        Some(g) => g,
                        None => db::labels::create_label_group(pool, &name, pick_one).await?,
                    };
                    // Flags only ever switch on, so re-running the seed never undoes a manual change.
                    let patch = LabelGroupPatch {
                        exclusive: (pick_one && !group.exclusive).then_some(true),
                        system: (system && !group.system).then_some(true),
                        ..Default::default()
                    };
                    result(db::labels::update_label_group(pool, &group.id, patch).await?, vec![Domain::Labels])
                }
                LabelGroupCommand::Assign { label, group } => {
                    let label = resolve_label(pool, &label).await?;
                    let group = resolve_group(pool, &group).await?;
                    result(db::labels::set_label_group(pool, &label.id, Some(&group.id)).await?, vec![Domain::Labels])
                }
            },
            Label::Archive { labels, unused } => {
                // Every name resolves before anything is written.
                let ids = if unused { db::labels::unused_label_ids(pool).await? } else { resolve_labels(pool, &labels).await? };
                result(db::labels::archive_labels(pool, &ids).await?, vec![Domain::Labels])
            }
            Label::Restore { labels } => {
                let ids = resolve_labels(pool, &labels).await?;
                result(db::labels::restore_labels(pool, &ids).await?, vec![Domain::Labels])
            }
        },
        Command::Capture(command) => match command {
            Capture::List {
                limit,
                include_converted,
            } => result(
                db::captures::get_captures(pool, limit, include_converted).await?,
                vec![],
            ),
            Capture::Create { content, context } => {
                nonempty(&content)?;
                result(
                    db::captures::create_capture(pool, &content, "dt", context.as_deref()).await?,
                    vec![Domain::Captures],
                )
            }
            Capture::Delete { id } => {
                if db::captures::get_capture_content(pool, &id)
                    .await?
                    .is_none()
                {
                    return Err(CliError::not_found());
                }
                db::captures::delete_capture(pool, &id).await?;
                changed(&id, vec![Domain::Captures])
            }
        },
        Command::Activity(command) => match command {
            Activity::List {
                dates,
                action,
                target,
                limit,
            } => {
                range(&dates)?;
                result(
                    db::activity::get_activity_log(
                        pool,
                        &dates.from,
                        &dates.to,
                        action.as_deref(),
                        target.as_deref(),
                        limit,
                    )
                    .await?,
                    vec![],
                )
            }
            Activity::Summary { date: d } => {
                date(&d)?;
                result(db::activity::get_activity_summary(pool, &d).await?, vec![])
            }
        },
        Command::Gap(g) => match (g.reason, g.command) {
            (Some(reason), None) => {
                nonempty(&reason)?;
                result(
                    db::activity::record_activity(
                        pool,
                        "nimble_gap",
                        None,
                        Some(json!({"reason":reason,"source":"dt"})),
                    )
                    .await?,
                    vec![Domain::Activity],
                )
            }
            (None, Some(GapCommand::List { dates })) => {
                range(&dates)?;
                result(
                    db::activity::get_activity_log(
                        pool,
                        &dates.from,
                        &dates.to,
                        Some("nimble_gap"),
                        None,
                        10000,
                    )
                    .await?,
                    vec![],
                )
            }
            _ => Err(CliError::validation(
                "Use dt gap REASON or dt gap list --from DATE --to DATE.",
            )),
        },
        Command::Momentum(Momentum::Backfill) => result(db::karma::backfill(pool).await?, vec![Domain::Activity]),
        // Read-only: goal bonuses are persisted by the app's own summary reads.
        Command::Momentum(Momentum::Summary { range }) => result(
            db::karma::read_summary_at(pool, &range, chrono::Local::now().date_naive()).await?,
            vec![],
        ),
        Command::Sync(Sync::Status) => result(db::sync::get_sync_status(pool).await?, vec![]),
        Command::Sync(Sync::Reconcile { .. }) | Command::Todoist(_) => Err(CliError::new(
            "internal",
            "Handled before direct commands.",
        )),
        Command::Backup(_) | Command::Sync(Sync::Now) => Err(CliError::new(
            "app_required",
            "This operation requires the running Nimble app.",
        )),
    }
}

fn reconcile_error(e: nimble_core::Error) -> CliError {
    CliError::new("reconcile_failed", e.to_string())
}

fn first_titles(out: &mut String, heading: &str, rows: &[(String, String)]) {
    use std::fmt::Write;
    if rows.is_empty() {
        return;
    }
    let shown = rows.len().min(10);
    let _ = writeln!(out, "\n{heading} ({shown} of {}):", rows.len());
    for (_, title) in rows.iter().take(10) {
        let _ = writeln!(out, "  - {title}");
    }
}

fn reconcile_text(
    plan: &nimble_core::integrations::todoist::reconcile::ReconcilePlan,
    applied: Option<&nimble_core::integrations::todoist::reconcile::ApplyOutcome>,
    refreshed: bool,
    report: &std::path::Path,
) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Todoist reconcile: {}\n",
        if applied.is_some() { "applied." } else { "dry run, nothing written." }
    );
    let converted_tasks: usize = plan.fake_sections_converted.iter().map(|c| c.2).sum();
    let rows: [(&str, String); 9] = [
        (
            "Fake section projects -> real sections",
            format!("{}  ({converted_tasks} tasks move)", plan.fake_sections_converted.len()),
        ),
        ("Fake section projects archived", plan.fake_sections_archived.len().to_string()),
        (
            "Duplicate Inbox merged",
            match &plan.inbox_merge {
                Some((_, n)) => format!("1  ({n} tasks move)"),
                None => "0".into(),
            },
        ),
        ("Projects archived", plan.projects_archived.len().to_string()),
        ("Tasks to complete", plan.to_complete.len().to_string()),
        ("Tasks to delete", plan.to_delete.len().to_string()),
        ("Kept (in archived projects)", plan.kept_in_archived_project.len().to_string()),
        ("Missing tasks to create", plan.missing_to_create.to_string()),
        ("Status lookups that failed", plan.lookup_errors.len().to_string()),
    ];
    for (label, value) in rows {
        let _ = writeln!(out, "  {label:<40} {value}");
    }
    first_titles(&mut out, "Tasks to complete", &plan.to_complete);
    first_titles(&mut out, "Tasks to delete", &plan.to_delete);
    first_titles(&mut out, "Kept in archived projects", &plan.kept_in_archived_project);
    first_titles(&mut out, "Status lookups that failed", &plan.lookup_errors);
    if let Some(done) = applied {
        let _ = writeln!(
            out,
            "\nFull pull: {} created, {} updated, {} deleted, {} projects added. `nimble` label added to {} tasks.",
            done.pull.created, done.pull.updated, done.pull.deleted, done.pull.projects_upserted, done.origin_labeled
        );
    }
    let _ = writeln!(out, "\nReport: {}", report.display());
    if applied.is_some() {
        let _ = writeln!(out, "\nNext:");
        if refreshed {
            let _ = writeln!(out, "  1. Nimble was asked to refresh. If lists still look out of date, quit and reopen Nimble.");
        } else {
            let _ = writeln!(out, "  1. Nimble didn't confirm a refresh. Quit and reopen Nimble to see the changes.");
        }
        let _ = writeln!(out, "  2. When everything looks right, turn Todoist sync back on in Settings.");
    } else {
        let _ = writeln!(
            out,
            "To write these changes: dt sync reconcile --apply (backs up through the running Nimble app first)."
        );
    }
    out
}

/// `dt sync reconcile [--apply]`. Returns the JSON data and the human text.
pub async fn reconcile(
    pool: &SqlitePool,
    profile: &nimble_core::agent_protocol::AgentProfile,
    apply: bool,
    show_progress: bool,
) -> Result<(Value, String), CliError> {
    use nimble_core::integrations::todoist::reconcile as rc;
    if apply {
        // Fail before any network work if the apply could never run.
        rc::preflight_apply(pool).await.map_err(reconcile_error)?;
    }
    let rc::Prepared { full, plan } = rc::prepare(pool, |done, total| {
        if show_progress && (done == total || done % 25 == 0) {
            eprintln!("Checked {done} of {total} tasks in Todoist");
        }
    })
    .await
    .map_err(reconcile_error)?;
    let dir = profile
        .database
        .parent()
        .ok_or_else(|| CliError::new("unavailable", "Cannot resolve the profile directory."))?;
    let report = rc::report_path(dir, chrono::Local::now().naive_local());
    rc::write_report(&report, if apply { "apply_planned" } else { "dry_run" }, &plan, None, None)
        .map_err(reconcile_error)?;

    let mut applied = None;
    let mut refreshed = false;
    if apply {
        rc::require_complete(&plan).map_err(reconcile_error)?;
        // Same code path as `dt backup now`; no backup, no apply.
        crate::ipc::request(profile, nimble_core::agent_protocol::AgentOperation::BackupNow)
            .await
            .map_err(|e| {
                CliError::new(e.code, format!("Backup failed, so nothing was applied. {}", e.message))
            })?;
        rc::preflight_apply(pool).await.map_err(reconcile_error)?;
        // On error here nothing was written (one transaction).
        rc::apply_structure(pool, &full, &plan).await.map_err(reconcile_error)?;
        // From here the structure is committed; tell the app either way.
        let finished = rc::finish_apply(pool, &full).await;
        refreshed = refresh_app(profile).await;
        match finished {
            Ok(outcome) => {
                rc::write_report(&report, "applied", &plan, Some(&outcome), None).map_err(reconcile_error)?;
                applied = Some(outcome);
            }
            Err(e) => {
                let message = rc::finish_failed_message(&e);
                rc::write_report(&report, "structure_applied_pull_failed", &plan, None, Some(&message)).ok();
                return Err(CliError::new(
                    "reconcile_incomplete",
                    format!("{message} Report: {}", report.display()),
                ));
            }
        }
    }
    let text = reconcile_text(&plan, applied.as_ref(), refreshed, &report);
    let data = json!({
        "mode": if apply { "applied" } else { "dry_run" },
        "report": report.display().to_string(),
        "plan": plan,
        "applied": applied,
        "app_refreshed": refreshed,
    });
    Ok((data, text))
}

/// Ask the open app to reload everything the reconcile touched. Best-effort:
/// the data is already committed. `true` when the app acknowledged.
async fn refresh_app(profile: &nimble_core::agent_protocol::AgentProfile) -> bool {
    crate::ipc::request(
        profile,
        nimble_core::agent_protocol::AgentOperation::Invalidate {
            domains: vec![Domain::Tasks, Domain::Projects, Domain::Sections, Domain::Labels],
            ids: vec![],
        },
    )
    .await
    .is_ok()
}

fn import_text(out: &nimble_core::integrations::todoist::history::RunOutcome, refreshed: bool) -> String {
    use std::fmt::Write;
    let p = &out.plan;
    let mut t = String::new();
    let _ = writeln!(
        t,
        "Todoist history import: {}\n",
        if out.applied.is_some() { "applied." } else { "dry run, nothing written." }
    );
    let _ = writeln!(t, "  Still open in Todoist (skipped): {}", p.still_open_remote);
    if p.still_open_remote > 0 {
        let _ = writeln!(
            t,
            "  ! Expected 0 or a few recurring tasks. A large number means Todoist's response shape changed; check before --apply."
        );
    }
    let _ = writeln!(t);
    let rows: [(&str, String); 11] = [
        ("Range", format!("{} .. {} ({} windows, {} requests)", p.since, p.until, p.windows, p.requests)),
        ("Completions fetched", format!("{} ({} unique tasks)", p.fetched, p.unique_tasks)),
        ("Already in Nimble (skipped)", p.already_local.to_string()),
        ("Possibly deleted in Nimble (imported)", p.possibly_deleted_locally.len().to_string()),
        ("To import", p.would_import.to_string()),
        ("  into \"Todoist history\" (archived)", p.to_history_project.to_string()),
        ("Sections matched / not found", format!("{} / {}", p.sections_matched, p.sections_unmatched)),
        ("Subtasks linked / orphaned", format!("{} / {}", p.parents_linked, p.orphan_parents)),
        ("Tasks with labels", p.tasks_with_labels.to_string()),
        ("Label names with no local label", p.labels_unmatched.len().to_string()),
        ("Rate-limit retries", p.rate_limited_retries.to_string()),
    ];
    for (label, value) in rows {
        let _ = writeln!(t, "  {label:<40} {value}");
    }
    if !p.by_project.is_empty() {
        let _ = writeln!(t, "\nBy project:");
        for b in &p.by_project {
            let _ = writeln!(
                t,
                "  {:>5}  {}{}",
                b.tasks,
                b.local_project_name,
                if b.local_project_archived { " (archived)" } else { "" }
            );
        }
    }
    if !p.labels_unmatched.is_empty() {
        let names: Vec<String> = p.labels_unmatched.iter().map(|(n, c)| format!("{n} ({c})")).collect();
        let _ = writeln!(t, "\nUnmatched labels (not created): {}", names.join(", "));
    }
    if !p.possibly_deleted_locally.is_empty() {
        let _ = writeln!(
            t,
            "\nPossibly deleted in Nimble (still imported; check before --apply; {} deleted tasks had no recoverable title):",
            p.deleted_locally_untitled
        );
        for d in &p.possibly_deleted_locally {
            let _ = writeln!(
                t,
                "  - {} [{}, by {}]",
                d.content,
                d.completed_at.as_deref().unwrap_or("-"),
                d.matched_by
            );
        }
    }
    if let Some(a) = &out.archive {
        let _ = writeln!(
            t,
            "\nArchive: {} completions ({} tasks), {} .. {}, {} projects + {} archived, {} sections, {} labels\n  {}",
            a.completed,
            a.unique_tasks,
            a.oldest_completed_at.as_deref().unwrap_or("-"),
            a.newest_completed_at.as_deref().unwrap_or("-"),
            a.projects,
            a.archived_projects,
            a.sections,
            a.labels,
            a.path
        );
    }
    match &out.applied {
        Some(done) => {
            let _ = writeln!(
                t,
                "\nImported {} tasks ({} subtasks linked, {} labels attached). Momentum backfill: {} completions counted.",
                done.imported, done.parents_linked, done.labels_attached, done.momentum.tasks
            );
            if done.imported > 0 {
                let _ = writeln!(
                    t,
                    "{}",
                    if refreshed {
                        "Nimble was asked to refresh."
                    } else {
                        "Nimble didn't confirm a refresh. Quit and reopen Nimble to see the history."
                    }
                );
            }
        }
        None if p.would_import > 0 => {
            let _ = writeln!(
                t,
                "\nTo import: dt todoist import-history --apply (backs up through the running Nimble app first)."
            );
        }
        None => {}
    }
    t
}

/// `dt todoist import-history [--since-months N] [--apply] [--archive DIR]`.
pub async fn import_history(
    pool: &SqlitePool,
    profile: &nimble_core::agent_protocol::AgentProfile,
    since_months: u32,
    apply: bool,
    archive: Option<std::path::PathBuf>,
) -> Result<(Value, String), CliError> {
    use nimble_core::integrations::todoist::history as h;
    let fail = |e: nimble_core::Error| CliError::new("import_failed", e.to_string());
    let token = h::read_token(pool).await.map_err(fail)?;
    let source = h::HttpTodoistGet::todoist(token).map_err(fail)?;
    let opts = h::RunOptions {
        since_months,
        apply,
        archive_dir: archive,
        now: chrono::Utc::now(),
        today: chrono::Local::now().date_naive(),
    };
    let backup = || async {
        // Same code path as `dt backup now`; no backup, no import.
        crate::ipc::request(profile, AgentOperation::BackupNow)
            .await
            .map(|_| ())
            .map_err(|e| nimble_core::Error::Other(format!("{} ({})", e.message, e.code)))
    };
    let out = h::run(pool, &source, h::RetryPolicy::default(), opts, backup).await.map_err(fail)?;
    let refreshed = match &out.applied {
        Some(a) if a.imported > 0 => refresh_app(profile).await,
        _ => false,
    };
    let text = import_text(&out, refreshed);
    let mut data = serde_json::to_value(&out).map_err(|_| CliError::new("internal", "Cannot encode result."))?;
    data["app_refreshed"] = json!(refreshed);
    Ok((data, text))
}
