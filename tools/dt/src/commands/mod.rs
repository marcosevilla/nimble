use crate::{args::*, output::CliError};
use nimble_core::{
    agent_protocol::{AgentOperation, Domain},
    db::{self, focus::engine::NativeTaskAction},
    types::{CreateTaskInput, UpdateTaskInput},
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
            task(pool, &id).await?;
            NativeWrite {
                action: NativeTaskAction::Update { id, input: update_input(content, linked_doc, f) },
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
                task(pool, &id).await?;
                result(
                    db::tasks::update_local_task(pool, &id, update_input(content, linked_doc, f))
                        .await?,
                    task_domains(),
                )
            }
            Task::Complete { id, .. } => {
                task(pool, &id).await?;
                db::tasks::update_task_status(pool, &id, "complete", None).await?;
                result(task(pool, &id).await?, task_domains())
            }
            Task::Reopen { id } => {
                task(pool, &id).await?;
                db::tasks::update_task_status(pool, &id, "todo", None).await?;
                result(task(pool, &id).await?, task_domains())
            }
            Task::Status { id, status, reason, .. } => {
                task(pool, &id).await?;
                db::tasks::update_task_status(pool, &id, &status, reason.as_deref()).await?;
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
        Command::Sync(Sync::Status) => result(db::sync::get_sync_status(pool).await?, vec![]),
        Command::Backup(_) | Command::Sync(Sync::Now) => Err(CliError::new(
            "app_required",
            "This operation requires the running Nimble app.",
        )),
    }
}
