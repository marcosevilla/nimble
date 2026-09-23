//! Frozen Focus Queue file import: a deterministic, read-only preview and an
//! atomic local commit against that exact preview.
//!
//! Inputs are the user-chosen `state.json`, `manual.json` and `pending.json`
//! contents only (never `config.json`, never a path scan). Record keys are
//! independent of file hashes, so re-importing the same cumulative snapshot
//! is a no-op and a later snapshot replaces (never adds to) its lineage.
//! Commit writes native tasks through the Import mutation policy (Turso
//! replication only, no Todoist observer), local-only and unbound; arms no
//! delivery; quarantines every pending operation; starts nothing.
use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::{DateTime, Local, TimeZone, Utc};
use serde_json::{json, Map, Value};
use sqlx::{Row, SqliteConnection, SqlitePool};

use super::replica;
use crate::db::task_tx::{self, MutationPolicy};
use crate::focus_types::*;
use crate::types::CreateTaskInput;

const SCHEMA: &str = "focus-queue-v1";
const MANUAL_PREFIX: &str = "manual:";
/// Plausible legacy wall-clock range: 2015-01-01 .. 2100-01-01 (epoch ms).
const EPOCH_RANGE: std::ops::RangeInclusive<u64> = 1_420_070_400_000..=4_102_444_800_000;
const TASK_FIELDS: &[&str] = &["id", "content", "description", "projectId", "parentId", "priority", "due", "duration", "dayOrder", "childOrder"];
const TIMER_FIELDS: &[&str] = &["taskId", "elapsedMs", "startedAt", "lastTickAt", "timeboxMs"];
const STATE_FIELDS: &[&str] = &["dateStamp", "source", "queueIds", "pulledInOverdueIds", "hasManuallyDragged", "timers", "completedToday", "focusView", "focusWidth", "expandedHeight"];
const MANUAL_FIELDS: &[&str] = &["tasks", "order", "completed", "showCompleted"];

fn err(code: &str, detail: &str) -> crate::Error {
    crate::Error::Other(format!("{code}: {detail}"))
}

fn hash(parts: &[&str]) -> String {
    let mut h = blake3::Hasher::new();
    for p in parts {
        h.update(p.as_bytes());
        h.update(&[0]);
    }
    h.finalize().to_hex().to_string()
}

/// Deterministic opaque ID for a namespace+record: a UUID built from the
/// blake3 hex prefix, stable across batches and file revisions.
fn stable_id(ns: &str, kind: &str, key: &str) -> String {
    let digest = blake3::hash(format!("{ns}\0{kind}\0{key}").as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest.as_bytes()[..16]);
    uuid::Builder::from_custom_bytes(bytes).into_uuid().to_string()
}

fn safe_u64(v: Option<&Value>) -> Option<u64> {
    v.and_then(Value::as_u64).filter(|n| *n <= MAX_SAFE_INTEGER)
}
fn epoch(v: Option<&Value>) -> Option<u64> {
    safe_u64(v).filter(|n| EPOCH_RANGE.contains(n))
}
/// `Some(None)` for an explicit null, `None` when present but invalid.
fn nullable(v: Option<&Value>, parse: fn(Option<&Value>) -> Option<u64>) -> Option<Option<u64>> {
    match v {
        None | Some(Value::Null) => Some(None),
        other => parse(other).map(Some),
    }
}
fn utc(ms: u64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(ms as i64).single().unwrap_or_default()
}

fn redact(v: &mut Value) {
    match v {
        Value::Object(map) => {
            for (k, val) in map.iter_mut() {
                let k = k.to_ascii_lowercase();
                if ["token", "secret", "password", "credential", "apikey", "api_key"].iter().any(|s| k.contains(s)) {
                    *val = Value::String("[redacted]".into());
                } else {
                    redact(val);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact),
        _ => {}
    }
}

fn unknown(obj: &Map<String, Value>, known: &[&str]) -> Vec<String> {
    obj.keys().filter(|k| !known.contains(&k.as_str())).cloned().collect()
}

fn parse_root(name: &str, text: &Option<String>, array: bool) -> crate::Result<Option<Value>> {
    let Some(text) = text else { return Ok(None) };
    let value: Value = serde_json::from_str(text).map_err(|e| err("invalid", &format!("{name} is not valid JSON ({e})")))?;
    if array != value.is_array() || (!array && !value.is_object()) {
        let shape = if array { "an array" } else { "an object" };
        return Err(err("invalid", &format!("{name} must be {shape}")));
    }
    Ok(Some(value))
}

#[derive(Clone)]
struct PriorRecord {
    fingerprint: String,
    status: String,
}
#[derive(Clone)]
struct PriorTotal {
    duration: u64,
    inclusion: String,
    occurrence: Option<String>,
    completed_at: Option<String>,
}

struct TaskPlan {
    id: String,
    input: CreateTaskInput,
    completed_at: Option<String>,
}
struct OccurrencePlan {
    id: String,
    task_id: String,
    title: String,
    completed_at: Option<String>,
}
struct TotalPlan {
    key: String,
    occurrence: Option<String>,
    unresolved: Option<String>,
    duration: u64,
    completed_at: Option<String>,
    kind: String,
    inclusion: ImportInclusion,
}

struct Plan {
    preview: FocusImportPreview,
    creates: Vec<TaskPlan>,
    occurrences: Vec<OccurrencePlan>,
    totals: Vec<TotalPlan>,
    record_mappings: HashMap<String, Value>,
    queue_adds: Vec<FocusEntry>,
    queue_entries: Vec<FocusEntry>,
    selected: Option<String>,
}

/// Resolution of a legacy task ID to a native task.
#[derive(Clone)]
enum Target {
    Native { id: String, title: String, completed: bool },
    Unresolved,
    Ambiguous,
}

struct Builder<'c> {
    conn: &'c mut SqliteConnection,
    ns: String,
    prior_records: HashMap<String, PriorRecord>,
    prior_totals: HashMap<String, PriorTotal>,
    queue: Vec<FocusEntry>,
    issues: Vec<FocusImportIssue>,
    records: Vec<FocusImportRecordPreview>,
    contributions: Vec<FocusImportContribution>,
    tasks: Vec<FocusImportTaskProposal>,
    creates: Vec<TaskPlan>,
    occurrences: Vec<OccurrencePlan>,
    totals: Vec<TotalPlan>,
    record_mappings: HashMap<String, Value>,
    targets: HashMap<String, Target>,
    legacy_completed: HashSet<String>,
    timeboxes: HashMap<String, u64>,
    fingerprint_rows: Vec<String>,
}

impl Builder<'_> {
    fn issue(&mut self, severity: ImportSeverity, key: Option<&str>, message: String) {
        self.issues.push(FocusImportIssue { severity, record_key: key.map(str::to_owned), message });
    }

    fn record(&mut self, key: &str, kind: &str, status: ImportRecordStatus, reason: &str, mut raw: Value, mapping: Value) -> ImportChange {
        redact(&mut raw);
        let fingerprint = hash(&[&raw.to_string()]);
        let status_str = status_str(status);
        let change = match self.prior_records.get(key) {
            None => ImportChange::New,
            Some(p) if p.fingerprint == fingerprint && p.status == status_str => ImportChange::Unchanged,
            Some(_) => ImportChange::Changed,
        };
        if change != ImportChange::Unchanged {
            self.record_mappings.insert(key.to_owned(), mapping);
        }
        self.records.push(FocusImportRecordPreview {
            record_key: key.into(), kind: kind.into(), status, change, fingerprint, reason: reason.into(), raw_evidence: raw,
        });
        change
    }

    async fn native_row(&mut self, id: &str) -> crate::Result<Option<(String, bool)>> {
        let row: Option<(String, String, i64, String)> = sqlx::query_as(
            "SELECT content,status,completed,COALESCE(updated_at,'') FROM local_tasks WHERE id=?")
            .bind(id).fetch_optional(&mut *self.conn).await?;
        Ok(row.map(|(content, status, completed, updated)| {
            self.fingerprint_rows.push(format!("{id}|{content}|{status}|{completed}|{updated}"));
            (content, completed != 0 || status == "complete")
        }))
    }

    /// A contribution record identical to its last import keeps that import's
    /// decision verbatim, even if its task was since edited or deleted.
    async fn keep_unchanged(&mut self, key: &str, kind: &str, legacy: &str, raw: &Value) -> crate::Result<bool> {
        let mut raw = raw.clone();
        redact(&mut raw);
        let fingerprint = hash(&[&raw.to_string()]);
        let (Some(rec), Some(total)) = (self.prior_records.get(key).cloned(), self.prior_totals.get(key).cloned()) else {
            return Ok(false);
        };
        if rec.fingerprint != fingerprint || rec.status == "unresolved" {
            return Ok(false);
        }
        let status = match rec.status.as_str() {
            "included" => ImportRecordStatus::Included,
            "excluded" => ImportRecordStatus::Excluded,
            _ => ImportRecordStatus::Quarantined,
        };
        let inclusion = match total.inclusion.as_str() {
            "included" => ImportInclusion::Included,
            "excluded" => ImportInclusion::Excluded,
            _ => ImportInclusion::Unresolved,
        };
        let task_id = match &total.occurrence {
            Some(o) => sqlx::query_scalar::<_, Option<String>>("SELECT task_id FROM focus_occurrences WHERE id=?")
                .bind(o).fetch_optional(&mut *self.conn).await?.flatten(),
            None => None,
        };
        self.records.push(FocusImportRecordPreview {
            record_key: key.into(), kind: kind.into(), status, change: ImportChange::Unchanged, fingerprint,
            reason: "unchanged since the last import".into(), raw_evidence: raw,
        });
        self.contributions.push(FocusImportContribution {
            record_key: key.into(), legacy_task_id: legacy.into(), task_id, occurrence_id: total.occurrence,
            duration_ms: total.duration, completed_at: total.completed_at, source_kind: kind.into(), inclusion,
            reason: "unchanged since the last import".into(), replaces_ms: None,
        });
        Ok(true)
    }

    /// Remote IDs map only by (todoist, external_id); never by title.
    async fn resolve(&mut self, legacy: &str) -> crate::Result<Target> {
        if let Some(t) = self.targets.get(legacy) {
            return Ok(t.clone());
        }
        let target = if legacy.starts_with(MANUAL_PREFIX) {
            Target::Unresolved
        } else {
            let ids: Vec<String> = sqlx::query_scalar(
                "SELECT id FROM local_tasks WHERE external_source='todoist' AND external_id=? ORDER BY id")
                .bind(legacy).fetch_all(&mut *self.conn).await?;
            match ids.as_slice() {
                [] => Target::Unresolved,
                [id] => {
                    let (title, completed) = self.native_row(id).await?.unwrap_or_default();
                    Target::Native { id: id.clone(), title, completed }
                }
                _ => {
                    self.issue(ImportSeverity::Blocking, None, format!(
                        "Legacy task {legacy} matches {} Nimble tasks. Merge the duplicates in Nimble, then preview again.", ids.len()));
                    Target::Ambiguous
                }
            }
        };
        self.targets.insert(legacy.to_owned(), target.clone());
        Ok(target)
    }

    /// Open imported work joins the entry already queued for that task, the
    /// occurrence of an earlier import of the same record, or a stable new one.
    fn open_occurrence(&mut self, legacy: &str, task_id: &str, title: &str, prior: Option<&PriorTotal>) -> String {
        if let Some(o) = prior.and_then(|p| p.occurrence.clone()) {
            return o;
        }
        if let Some(e) = self.queue.iter().find(|e| e.task_id == task_id) {
            return e.occurrence_id.clone();
        }
        let id = stable_id(&self.ns, "open", legacy);
        if !self.occurrences.iter().any(|o| o.id == id) {
            self.occurrences.push(OccurrencePlan { id: id.clone(), task_id: task_id.into(), title: title.into(), completed_at: None });
        }
        id
    }

    #[allow(clippy::too_many_arguments)]
    fn contribution(&mut self, key: &str, legacy: &str, kind: &str, duration: u64, completed_at: Option<String>,
        task_id: Option<String>, occurrence: Option<String>, inclusion: ImportInclusion, reason: &str) {
        let prior = self.prior_totals.get(key).cloned();
        let incl = match inclusion {
            ImportInclusion::Included => "included",
            ImportInclusion::Excluded => "excluded",
            ImportInclusion::Unresolved => "unresolved",
        };
        let mut replaces = None;
        let changed = match &prior {
            None => true,
            Some(p) => p.duration != duration || p.inclusion != incl || p.occurrence != occurrence,
        };
        if let Some(p) = prior.as_ref().filter(|_| changed) {
            if p.inclusion == "included" && inclusion == ImportInclusion::Included {
                replaces = Some(p.duration);
                if duration < p.duration {
                    self.issue(ImportSeverity::Blocking, Some(key), format!(
                        "{legacy}: the cumulative total went down ({} ms imported, {duration} ms now). Review the files before importing.", p.duration));
                }
            }
        }
        if changed {
            self.totals.push(TotalPlan {
                key: key.into(), occurrence: occurrence.clone(), duration, completed_at: completed_at.clone(), kind: kind.into(), inclusion,
                unresolved: (inclusion == ImportInclusion::Unresolved).then(|| legacy.to_owned()),
            });
        }
        self.contributions.push(FocusImportContribution {
            record_key: key.into(), legacy_task_id: legacy.into(), task_id, occurrence_id: occurrence, duration_ms: duration,
            completed_at, source_kind: kind.into(), inclusion, reason: reason.into(), replaces_ms: replaces,
        });
    }

    async fn manual(&mut self, manual: &Map<String, Value>) -> crate::Result<Vec<String>> {
        let empty = Map::new();
        let tasks = match manual.get("tasks") {
            Some(Value::Object(t)) => t,
            _ => {
                self.issue(ImportSeverity::Blocking, Some("file:manual.json"), "manual.json has no tasks map; it is not treated as empty.".into());
                &empty
            }
        };
        let mut completions: Vec<(String, Value)> = Vec::new();
        // Identical (id, completedAt) keys are one completion: the first is
        // counted, later ones are kept as indexed evidence (like pending ops)
        // so preview contributions and included_ms match the one stored row.
        let mut seen_keys: HashMap<String, (usize, Value)> = HashMap::new();
        match manual.get("completed") {
            Some(Value::Array(items)) => {
                for (i, item) in items.iter().enumerate() {
                    let id = item.get("id").and_then(Value::as_str);
                    let at = epoch(item.get("completedAt"));
                    let key = match (id, item.get("completedAt")) {
                        (Some(id), Some(at)) => format!("completion:{id}:{at}"),
                        _ => format!("completion:#{i}"),
                    };
                    if let Some((n, first)) = seen_keys.get_mut(&key) {
                        *n += 1;
                        let dup_key = format!("{key}:duplicate:{n}");
                        let same = first == item;
                        self.record(&dup_key, "completion", ImportRecordStatus::Quarantined,
                            "duplicate completion entry for the same task and time; counted once", item.clone(), Value::Null);
                        if !same {
                            self.issue(ImportSeverity::Review, Some(&dup_key), format!(
                                "{key} appears more than once with different values; only the first is counted."));
                        }
                        continue;
                    }
                    seen_keys.insert(key.clone(), (0, item.clone()));
                    if let (Some(id), Some(_)) = (id, at) {
                        if safe_u64(item.get("spentMs")).is_some() && tasks.contains_key(id) {
                            self.legacy_completed.insert(id.to_owned());
                        }
                    }
                    completions.push((key, item.clone()));
                }
            }
            _ => self.issue(ImportSeverity::Blocking, Some("file:manual.json"), "manual.json has no completed list; it is not treated as empty.".into()),
        }
        for (legacy, body) in tasks {
            let key = format!("task:{legacy}");
            let content = body.get("content").and_then(Value::as_str).map(str::trim).filter(|c| !c.is_empty());
            let valid_id = body.get("id").and_then(Value::as_str) == Some(legacy.as_str()) && legacy.starts_with(MANUAL_PREFIX);
            let (Some(content), true, Some(obj)) = (content, valid_id, body.as_object()) else {
                self.record(&key, "task", ImportRecordStatus::Quarantined, "task body is missing an id/content or its id does not match", body.clone(), Value::Null);
                self.issue(ImportSeverity::Review, Some(&key), format!("{legacy}: corrupt task body kept as evidence; no task is created."));
                self.tasks.push(FocusImportTaskProposal { legacy_task_id: legacy.clone(), native_task_id: None, action: ImportTaskAction::Unresolved, title: None, completed_at: None, differences: vec![] });
                continue;
            };
            let id = stable_id(&self.ns, "task", legacy);
            let mut differences = Vec::new();
            let extra = unknown(obj, TASK_FIELDS);
            if !extra.is_empty() {
                differences.push(format!("unknown fields kept as evidence: {}", extra.join(", ")));
            }
            let priority = match body.get("priority").and_then(Value::as_i64) {
                Some(p @ 1..=4) => p,
                _ => { differences.push("priority not 1–4; imported as normal".into()); 1 }
            };
            let due = body.get("due").filter(|d| !d.is_null());
            let due_date = due.and_then(|d| d.get("date")).and_then(Value::as_str)
                .filter(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok())
                .filter(|_| due.and_then(|d| d.get("isRecurring")) != Some(&Value::Bool(true)));
            if due.is_some() && due_date.is_none() {
                differences.push("due date not mapped (recurring or not a plain date)".into());
            }
            if body.get("parentId").is_some_and(|p| !p.is_null()) {
                differences.push("parent link not mapped".into());
            }
            let existing = self.native_row(&id).await?;
            let prior = self.prior_records.contains_key(&key);
            let (action, status_reason) = match (&existing, prior) {
                (Some(_), _) => (ImportTaskAction::Unchanged, "already imported; the Nimble copy is kept"),
                (None, true) => (ImportTaskAction::Unchanged, "deleted in Nimble after import; not recreated"),
                (None, false) => (ImportTaskAction::Create, "new local-only Nimble task"),
            };
            let change = self.record(&key, "task", ImportRecordStatus::Included, status_reason, body.clone(), json!({"task_id": id}));
            if change == ImportChange::Changed {
                self.issue(ImportSeverity::Review, Some(&key), format!("{legacy} changed in Focus Queue since the last import. Nimble keeps its copy; edit it there if needed."));
            }
            let completed = self.legacy_completed.contains(legacy);
            if action == ImportTaskAction::Create {
                self.creates.push(TaskPlan {
                    id: id.clone(), completed_at: None,
                    input: CreateTaskInput {
                        content: content.into(), sync_policy: Some("local_only".into()), priority: Some(priority),
                        description: body.get("description").and_then(Value::as_str).filter(|d| !d.is_empty()).map(str::to_owned),
                        due_date: due_date.map(str::to_owned), ..Default::default()
                    },
                });
            }
            let native_completed = existing.as_ref().map(|e| e.1).unwrap_or(completed);
            if existing.is_some() || action == ImportTaskAction::Create {
                self.targets.insert(legacy.clone(), Target::Native { id: id.clone(), title: content.into(), completed: native_completed });
            }
            self.tasks.push(FocusImportTaskProposal { legacy_task_id: legacy.clone(), native_task_id: Some(id), action, title: Some(content.into()), completed_at: None, differences });
        }
        for (key, item) in completions {
            self.completion(&key, &item).await?;
        }
        let order = self.id_list(manual.get("order"), "manual.json order");
        for legacy in &order {
            if !tasks.contains_key(legacy) {
                self.issue(ImportSeverity::Review, Some("file:manual.json"), format!("manual order references {legacy}, which has no task body; it is skipped."));
            } else if self.legacy_completed.contains(legacy) {
                self.issue(ImportSeverity::Review, Some("file:manual.json"), format!("{legacy} is both ordered and completed; the completion wins."));
            }
        }
        let mut evidence = Value::Object(manual.clone());
        if let Some(o) = evidence.as_object_mut() { o.remove("tasks"); o.remove("completed"); }
        self.file_record("manual.json", manual, MANUAL_FIELDS, evidence);
        Ok(order)
    }

    async fn completion(&mut self, key: &str, item: &Value) -> crate::Result<()> {
        let id = item.get("id").and_then(Value::as_str);
        let spent = safe_u64(item.get("spentMs"));
        let at = epoch(item.get("completedAt"));
        if let Some(legacy) = id {
            if self.keep_unchanged(key, "completion", legacy, item).await? {
                return Ok(());
            }
        }
        let (Some(legacy), Some(spent), Some(at)) = (id, spent, at) else {
            self.record(key, "completion", ImportRecordStatus::Quarantined, "invalid id, spentMs or completedAt", item.clone(), Value::Null);
            self.issue(ImportSeverity::Review, Some(key), "A corrupt completion is kept as evidence and adds no time.".into());
            return Ok(());
        };
        let completed_at = utc(at).to_rfc3339();
        let target = self.targets.get(legacy).cloned().unwrap_or(Target::Unresolved);
        let Target::Native { id: task_id, title, .. } = target else {
            self.record(key, "completion", ImportRecordStatus::Unresolved, "no task body for this completion", item.clone(), Value::Null);
            self.contribution(key, legacy, "completion", spent, Some(completed_at), None, None, ImportInclusion::Unresolved, "no task body; retained unresolved");
            return Ok(());
        };
        let creating = self.creates.iter().position(|c| c.id == task_id);
        if creating.is_none() && !self.prior_records.contains_key(key) {
            // Completed in Focus Queue after its task was already imported open.
            self.record(key, "completion", ImportRecordStatus::Quarantined, "completion arrived after the task was imported", item.clone(), json!({"task_id": task_id}));
            self.issue(ImportSeverity::Review, Some(key), format!("{legacy} was completed in Focus Queue after an earlier import. Its time is kept as evidence, not added."));
            self.contribution(key, legacy, "completion", spent, Some(completed_at), Some(task_id), None, ImportInclusion::Excluded, "overlaps earlier imported open work");
            return Ok(());
        }
        let occurrence = self.prior_totals.get(key).and_then(|p| p.occurrence.clone()).unwrap_or_else(|| stable_id(&self.ns, "occurrence", key));
        if let Some(i) = creating {
            // Latest completion wins the native completion timestamp.
            let local = DateTime::<Local>::from(utc(at)).format("%Y-%m-%d %H:%M:%S").to_string();
            if self.creates[i].completed_at.as_ref().is_none_or(|c| *c < local) {
                self.creates[i].completed_at = Some(local);
            }
            if let Some(t) = self.tasks.iter_mut().find(|t| t.native_task_id.as_deref() == Some(task_id.as_str())) {
                t.completed_at = Some(completed_at.clone());
            }
            self.occurrences.push(OccurrencePlan { id: occurrence.clone(), task_id: task_id.clone(), title, completed_at: Some(completed_at.clone()) });
        }
        self.record(key, "completion", ImportRecordStatus::Included, "recorded completion total (authoritative)", item.clone(), json!({"task_id": task_id, "occurrence_id": occurrence}));
        self.contribution(key, legacy, "completion", spent, Some(completed_at), Some(task_id), Some(occurrence), ImportInclusion::Included, "completion spentMs is authoritative");
        Ok(())
    }

    fn id_list(&mut self, v: Option<&Value>, what: &str) -> Vec<String> {
        let Some(Value::Array(items)) = v else {
            self.issue(ImportSeverity::Blocking, None, format!("{what} is missing; it is not treated as empty."));
            return Vec::new();
        };
        let mut out = Vec::new();
        for item in items {
            match item.as_str() {
                Some(s) => out.push(s.to_owned()),
                None => self.issue(ImportSeverity::Blocking, None, format!(
                    "{what} contains a non-string ID. IDs are opaque strings; a number could lose precision, so the file is refused.")),
            }
        }
        out
    }

    fn file_record(&mut self, name: &str, obj: &Map<String, Value>, known: &[&str], evidence: Value) {
        let key = format!("file:{name}");
        let extra = unknown(obj, known);
        if !extra.is_empty() {
            self.issue(ImportSeverity::Review, Some(&key), format!("{name} has unknown fields kept as evidence: {}", extra.join(", ")));
        }
        self.record(&key, "file", ImportRecordStatus::Excluded, "source snapshot retained as evidence (orders, source, summaries, preferences)", evidence, Value::Null);
    }

    async fn timer(&mut self, legacy: &str, rec: &Value) -> crate::Result<()> {
        let key = format!("timer:{legacy}");
        if self.keep_unchanged(&key, "timer", legacy, rec).await? {
            return Ok(());
        }
        let elapsed = safe_u64(rec.get("elapsedMs"));
        let started = nullable(rec.get("startedAt"), epoch);
        let tick = nullable(rec.get("lastTickAt"), epoch);
        let timebox = nullable(rec.get("timeboxMs"), safe_u64);
        let quarantine = |b: &mut Self, reason: &str| {
            b.record(&key, "timer", ImportRecordStatus::Quarantined, reason, rec.clone(), Value::Null);
            b.issue(ImportSeverity::Review, Some(&key), format!("{legacy}: {reason}; kept as evidence and adds no time."));
        };
        let (Some(elapsed), Some(started), Some(tick), Some(timebox), true) =
            (elapsed, started, tick, timebox, rec.get("taskId").and_then(Value::as_str) == Some(legacy))
        else {
            quarantine(self, "timer record has an invalid taskId, duration or timestamp");
            return Ok(());
        };
        let (duration, reason) = match (started, tick) {
            (Some(s), Some(t)) if t < s => { quarantine(self, "heartbeat precedes its start"); return Ok(()); }
            (Some(s), Some(t)) => match elapsed.checked_add(t - s).filter(|d| *d <= MAX_SAFE_INTEGER) {
                Some(d) => (d, "running timer recovered paused through its last heartbeat"),
                None => { quarantine(self, "recovered duration exceeds the safe range"); return Ok(()); }
            },
            (Some(_), None) => (elapsed, "running timer had no heartbeat; nothing added"),
            _ => (elapsed, "paused timer aggregate"),
        };
        if let Some(t) = timebox { self.timeboxes.insert(legacy.to_owned(), t); }
        let extra = unknown(rec.as_object().expect("validated object"), TIMER_FIELDS);
        if !extra.is_empty() {
            self.issue(ImportSeverity::Review, Some(&key), format!("{legacy}: unknown timer fields kept as evidence: {}", extra.join(", ")));
        }
        let target = self.resolve(legacy).await?;
        let prior = self.prior_totals.get(&key).cloned();
        match target {
            _ if self.legacy_completed.contains(legacy) => {
                self.record(&key, "timer", ImportRecordStatus::Quarantined, "residual timer for a completed task (potential overlap)", rec.clone(), Value::Null);
                match prior.filter(|p| p.inclusion == "included") {
                    // Time already imported as open work is never withdrawn by a later snapshot.
                    Some(p) => {
                        self.issue(ImportSeverity::Review, Some(&key), format!(
                            "{legacy} was completed in Focus Queue after an earlier import. The {} ms already imported is kept; newer time is not added.", p.duration));
                        self.contribution(&key, legacy, "timer", p.duration, None, None, p.occurrence, ImportInclusion::Included, "earlier import kept; later completion needs review");
                    }
                    None => self.contribution(&key, legacy, "timer", duration, None, None, None, ImportInclusion::Excluded, "overlaps the recorded completion; not added"),
                }
            }
            Target::Native { id, title, completed } => {
                let occurrence_open = match prior.as_ref().and_then(|p| p.occurrence.as_deref()) {
                    Some(o) => sqlx::query_scalar::<_, String>("SELECT state FROM focus_occurrences WHERE id=?").bind(o)
                        .fetch_optional(&mut *self.conn).await?.is_none_or(|s| s == "open"),
                    None => true,
                };
                if (completed && prior.is_none()) || !occurrence_open {
                    self.record(&key, "timer", ImportRecordStatus::Quarantined, "task is already complete in Nimble", rec.clone(), json!({"task_id": id}));
                    self.issue(ImportSeverity::Review, Some(&key), format!("{legacy}: the Nimble task is already complete; this timer is kept as evidence."));
                    let keep = prior.filter(|p| p.inclusion == "included");
                    let (d, o, inc) = match keep {
                        Some(p) => (p.duration, p.occurrence, ImportInclusion::Included),
                        None => (duration, None, ImportInclusion::Excluded),
                    };
                    self.contribution(&key, legacy, "timer", d, None, Some(id), o, inc, "earlier import kept; newer value not added");
                    return Ok(());
                }
                let occurrence = self.open_occurrence(legacy, &id, &title, prior.as_ref());
                self.record(&key, "timer", ImportRecordStatus::Included, reason, rec.clone(), json!({"task_id": id, "occurrence_id": occurrence}));
                self.contribution(&key, legacy, "timer", duration, None, Some(id), Some(occurrence), ImportInclusion::Included, reason);
            }
            Target::Unresolved | Target::Ambiguous => {
                self.record(&key, "timer", ImportRecordStatus::Unresolved, "no matching Nimble task; retained unresolved", rec.clone(), Value::Null);
                self.contribution(&key, legacy, "timer", duration, None, None, None, ImportInclusion::Unresolved, "no matching Nimble task; retained unresolved");
            }
        }
        Ok(())
    }

    async fn state(&mut self, state: &Map<String, Value>) -> crate::Result<(Option<String>, Vec<String>)> {
        if state.contains_key("token") {
            self.issue(ImportSeverity::Blocking, Some("file:state.json"), "This looks like config.json. Credentials are never imported; choose state.json.".into());
        }
        let kind = match state.get("source") {
            None => None,
            Some(s) => match s.get("kind").and_then(Value::as_str) {
                Some(k @ ("today" | "project" | "manual")) => Some(k.to_owned()),
                _ => { self.issue(ImportSeverity::Review, Some("file:state.json"), "state.json has an unknown source; its order is kept as evidence only.".into()); None }
            },
        };
        let queue_ids = self.id_list(state.get("queueIds"), "state.json queueIds");
        if let Some(v) = state.get("pulledInOverdueIds") { self.id_list(Some(v), "state.json pulledInOverdueIds"); }
        match state.get("timers") {
            Some(Value::Object(timers)) => {
                for (legacy, rec) in timers { self.timer(legacy, rec).await?; }
            }
            _ => self.issue(ImportSeverity::Blocking, Some("file:state.json"), "state.json has no timers map; it is not treated as empty.".into()),
        }
        let mut evidence = Value::Object(state.clone());
        if let Some(o) = evidence.as_object_mut() { o.remove("timers"); }
        self.file_record("state.json", state, STATE_FIELDS, evidence);
        Ok((kind, queue_ids))
    }

    fn pending(&mut self, items: &[Value]) {
        let mut seen: HashMap<String, usize> = HashMap::new();
        for item in items {
            let fp = hash(&[&item.to_string()]);
            let n = seen.entry(fp.clone()).or_default();
            let key = format!("pending:{fp}:{n}");
            *n += 1;
            self.record(&key, "pending", ImportRecordStatus::Quarantined,
                "legacy delivery intent preserved for reconciliation; never replayed or retried", item.clone(), Value::Null);
        }
    }
}

fn status_str(s: ImportRecordStatus) -> &'static str {
    match s {
        ImportRecordStatus::Included => "included",
        ImportRecordStatus::Excluded => "excluded",
        ImportRecordStatus::Unresolved => "unresolved",
        ImportRecordStatus::Quarantined => "quarantined",
    }
}

async fn build(conn: &mut SqliteConnection, files: &LegacyFocusFiles) -> crate::Result<Plan> {
    let ns = files.source_namespace.trim().to_owned();
    if ns.is_empty() || ns.len() > 120 {
        return Err(err("invalid", "source namespace must be 1–120 characters"));
    }
    let state = parse_root("state.json", &files.state_json, false)?;
    let manual = parse_root("manual.json", &files.manual_json, false)?;
    let pending = parse_root("pending.json", &files.pending_json, true)?;
    if state.is_none() && manual.is_none() && pending.is_none() {
        return Err(err("invalid", "choose at least one Focus Queue file"));
    }
    let mut file_hashes = BTreeMap::new();
    for (name, text) in [("state.json", &files.state_json), ("manual.json", &files.manual_json), ("pending.json", &files.pending_json)] {
        if let Some(t) = text { file_hashes.insert(name.to_owned(), blake3::hash(t.as_bytes()).to_hex().to_string()); }
    }
    let prior_records = sqlx::query("SELECT record_key,fingerprint,status FROM focus_import_records WHERE source_namespace=?")
        .bind(&ns).fetch_all(&mut *conn).await?.into_iter()
        .map(|r| (r.get::<String, _>(0), PriorRecord { fingerprint: r.get(1), status: r.get(2) })).collect::<HashMap<_, _>>();
    let prior_totals = sqlx::query("SELECT record_key,duration_ms,inclusion,occurrence_id,completed_at FROM focus_import_totals WHERE source_namespace=?")
        .bind(&ns).fetch_all(&mut *conn).await?.into_iter()
        .map(|r| (r.get::<String, _>(0), PriorTotal { duration: r.get::<i64, _>(1).max(0) as u64, inclusion: r.get(2), occurrence: r.get(3), completed_at: r.get(4) }))
        .collect::<HashMap<_, _>>();
    let queue_row = sqlx::query("SELECT q.revision,q.entries_json,q.selected_occurrence_id,r.engine_revision,r.live_session_id FROM focus_queue_state q JOIN focus_runtime r ON r.id=1 WHERE q.id=1")
        .fetch_optional(&mut *conn).await?;
    let (queue_revision, queue, selected, engine_revision, live) = match &queue_row {
        Some(r) => (
            r.get::<i64, _>(0).max(0) as u64,
            serde_json::from_str::<Vec<FocusEntry>>(r.get(1)).map_err(|e| err("storage", &e.to_string()))?,
            r.get::<Option<String>, _>(2), r.get::<i64, _>(3).max(0) as u64, r.get::<Option<String>, _>(4),
        ),
        None => (0, Vec::new(), None, 0, None),
    };
    let mut b = Builder {
        conn, ns: ns.clone(), prior_records, prior_totals, queue: queue.clone(), issues: vec![], records: vec![], contributions: vec![],
        tasks: vec![], creates: vec![], occurrences: vec![], totals: vec![], record_mappings: HashMap::new(),
        targets: HashMap::new(), legacy_completed: HashSet::new(), timeboxes: HashMap::new(), fingerprint_rows: vec![],
    };
    if queue_row.is_none() {
        b.issue(ImportSeverity::Blocking, None, "Focus isn't set up on this Mac yet. Open the focus view once, then import.".into());
    }
    if live.is_some() {
        b.issue(ImportSeverity::Blocking, None, "A focus session is running. Pause it before importing.".into());
    }
    let manual_order = match &manual { Some(Value::Object(m)) => b.manual(m).await?, _ => Vec::new() };
    let (source_kind, source_order) = match &state { Some(Value::Object(s)) => b.state(s).await?, _ => (None, Vec::new()) };
    if let Some(Value::Array(items)) = &pending { b.pending(items); }

    // Existing Nimble queue → old active source order → remaining manual order.
    let mut merged = Vec::new();
    let mut queue_adds = Vec::new();
    for entry in &queue {
        let title = b.native_row(&entry.task_id).await?.map(|r| r.0).unwrap_or_else(|| "Task unavailable".into());
        merged.push(FocusImportOrderItem { legacy_task_id: None, task_id: entry.task_id.clone(), title, origin: "existing".into() });
    }
    // Only a known Today/project source makes queueIds an active order; an
    // absent or unknown source keeps it as evidence only.
    let active: Vec<(String, &str)> = match source_kind.as_deref() {
        Some("today" | "project") => source_order.iter().map(|id| (id.clone(), "source"))
            .chain(manual_order.iter().map(|id| (id.clone(), "manual"))).collect(),
        _ => manual_order.iter().map(|id| (id.clone(), "manual")).collect(),
    };
    let stamp = Utc::now().to_rfc3339();
    for (legacy, origin) in active {
        if b.legacy_completed.contains(&legacy) { continue; }
        let Target::Native { id, title, completed } = b.resolve(&legacy).await? else { continue };
        if completed || merged.iter().any(|m| m.task_id == id) { continue; }
        let key = format!("queue:{legacy}");
        let prior_timer = b.prior_totals.get(&format!("timer:{legacy}")).cloned();
        let occurrence = b.open_occurrence(&legacy, &id, &title, prior_timer.as_ref());
        // Queued once: a later removal in Nimble is never undone by re-import.
        let change = b.record(&key, "queue", ImportRecordStatus::Included, "queued once at first import", json!({"task_id": legacy, "origin": origin}), json!({"task_id": id, "occurrence_id": occurrence}));
        if change != ImportChange::New { continue; }
        let config = match b.timeboxes.get(&legacy) {
            Some(ms) if *ms % 60_000 == 0 && (60_000..=86_400_000).contains(ms) =>
                FocusConfig { mode: FocusMode::Timebox, budget_ms: Some(*ms), work_ms: 1_500_000, break_ms: 300_000, rounds: 4 },
            _ => FocusConfig { mode: FocusMode::CountUp, budget_ms: None, work_ms: 1_500_000, break_ms: 300_000, rounds: 4 },
        };
        let source = if origin == "source" && source_kind.as_deref() == Some("today") { FocusSource::Today } else { FocusSource::Local };
        queue_adds.push(FocusEntry { id: stable_id(&ns, "entry", &legacy), task_id: id.clone(), occurrence_id: occurrence, added_at: stamp.clone(), source, explicit_still_open: false, config });
        merged.push(FocusImportOrderItem { legacy_task_id: Some(legacy), task_id: id, title, origin: origin.into() });
    }
    let legacy_completed_today = match &state { Some(s) => safe_u64(s.get("completedToday")), None => None };
    b.fingerprint_rows.sort();
    let tasks_fingerprint = hash(&[&serde_json::to_string(&queue).unwrap_or_default(), selected.as_deref().unwrap_or(""), &b.fingerprint_rows.join("\n")]);
    other_namespace_guard(&mut b, &file_hashes).await?;
    let blocked = b.issues.iter().any(|i| i.severity == ImportSeverity::Blocking);
    let noop = b.creates.is_empty() && b.totals.is_empty() && queue_adds.is_empty() && b.records.iter().all(|r| r.change == ImportChange::Unchanged);
    let mut preview = FocusImportPreview {
        preview_token: String::new(), source_namespace: ns, file_hashes,
        destination: FocusImportDestination { queue_revision, engine_revision, tasks_fingerprint },
        source_kind, source_order, manual_order, merged_order: merged, tasks: b.tasks, contributions: b.contributions,
        records: b.records, issues: b.issues, legacy_completed_today, blocked, noop,
    };
    preview.preview_token = hash(&["focus-import-preview-v1", &serde_json::to_string(&preview).map_err(|e| err("invalid", &e.to_string()))?]);
    Ok(Plan {
        preview, creates: b.creates, occurrences: b.occurrences, totals: b.totals, record_mappings: b.record_mappings,
        queue_adds, queue_entries: queue, selected,
    })
}

/// Dedup keys live in a namespace, so the same files under a second name
/// would re-create every task and add every cumulative total again. Block
/// when another namespace already holds these files or task records.
async fn other_namespace_guard(b: &mut Builder<'_>, file_hashes: &BTreeMap<String, String>) -> crate::Result<()> {
    let mut clash: Vec<String> = Vec::new();
    let batches: Vec<(String, String)> = sqlx::query_as("SELECT source_namespace,file_hashes_json FROM focus_import_batches WHERE source_namespace!=?")
        .bind(&b.ns).fetch_all(&mut *b.conn).await?;
    for (ns, json) in batches {
        let hashes: BTreeMap<String, String> = serde_json::from_str(&json).unwrap_or_default();
        if hashes.values().any(|h| file_hashes.values().any(|f| f == h)) { clash.push(ns); }
    }
    let prior: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT source_namespace,record_key,fingerprint FROM focus_import_records WHERE source_namespace!=? AND (record_key LIKE 'task:%' OR record_key LIKE 'completion:%' OR record_key LIKE 'timer:%')")
        .bind(&b.ns).fetch_all(&mut *b.conn).await?;
    for (ns, key, fingerprint) in prior {
        if b.records.iter().any(|r| r.record_key == key && r.fingerprint == fingerprint) { clash.push(ns); }
    }
    clash.sort();
    clash.dedup();
    for ns in clash {
        b.issue(ImportSeverity::Blocking, None, format!(
            "These files were already imported under the source name \"{ns}\". Import them under that name so nothing is counted twice."));
    }
    Ok(())
}

/// Read-only: validates the files as a set and proposes every decision.
pub async fn preview_import(pool: &SqlitePool, files: &LegacyFocusFiles) -> crate::Result<FocusImportPreview> {
    let mut conn = pool.acquire().await?;
    Ok(build(&mut conn, files).await?.preview)
}

/// Atomically applies exactly the previewed decisions, or nothing.
pub async fn commit_import(pool: &SqlitePool, files: &LegacyFocusFiles, preview_token: &str, command_id: &str) -> crate::Result<FocusImportResult> {
    if uuid::Uuid::parse_str(command_id).is_err() {
        return Err(err("invalid", "import command id must be a UUID"));
    }
    let hashes: Vec<String> = [&files.state_json, &files.manual_json, &files.pending_json].iter()
        .map(|t| t.as_ref().map(|t| blake3::hash(t.as_bytes()).to_hex().to_string()).unwrap_or_default()).collect();
    let request_hash = hash(&["focus-import-commit", files.source_namespace.trim(), preview_token, &hashes.join(",")]);
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    // The receipt precedes every staleness check, so an uncertain retry of a
    // committed import returns its result instead of importing twice.
    let receipt: Option<(String, String)> = sqlx::query_as("SELECT request_hash,result_json FROM focus_command_receipts WHERE command_id=?")
        .bind(command_id).fetch_optional(&mut *tx).await?;
    if let Some((stored, result)) = receipt {
        if stored != request_hash {
            return Err(err("invalid", "command id reused with a different import"));
        }
        let mut result: FocusImportResult = serde_json::from_str(&result).map_err(|e| err("storage", &e.to_string()))?;
        result.replayed = true;
        return Ok(result);
    }
    let plan = build(&mut tx, files).await?;
    if plan.preview.preview_token != preview_token {
        return Err(err("conflict", "preview is stale (files or Nimble changed); regenerate the preview"));
    }
    if plan.preview.blocked {
        let reasons: Vec<_> = plan.preview.issues.iter().filter(|i| i.severity == ImportSeverity::Blocking).map(|i| i.message.as_str()).collect();
        return Err(err("needs_review", &reasons.join(" ")));
    }
    let ns = &plan.preview.source_namespace;
    let stamp = Utc::now().to_rfc3339();
    let mut result = FocusImportResult {
        batch_id: None, replayed: false, noop: plan.preview.noop, created_task_ids: vec![],
        queued_task_ids: plan.queue_adds.iter().map(|e| e.task_id.clone()).collect(),
        included_ms: plan.preview.contributions.iter().filter(|c| c.inclusion == ImportInclusion::Included).map(|c| c.duration_ms).sum(),
        quarantined_records: plan.preview.records.iter().filter(|r| r.status == ImportRecordStatus::Quarantined).count() as u64,
    };
    if !plan.preview.noop {
        let batch = stable_id(ns, "batch", preview_token);
        let mappings: BTreeMap<_, _> = plan.preview.tasks.iter().filter_map(|t| t.native_task_id.clone().map(|n| (t.legacy_task_id.clone(), n))).collect();
        sqlx::query("INSERT INTO focus_import_batches(id,source_namespace,schema_version,file_hashes_json,preview_hash,mappings_json,created_at,committed_at) VALUES(?,?,?,?,?,?,?,?)")
            .bind(&batch).bind(ns).bind(SCHEMA).bind(json!(plan.preview.file_hashes).to_string()).bind(preview_token)
            .bind(json!(mappings).to_string()).bind(&stamp).bind(&stamp).execute(&mut *tx).await?;
        for create in &plan.creates {
            task_tx::create_task_with_id_tx(&mut tx, &create.id, create.input.clone(), MutationPolicy::Import).await?;
            if let Some(at) = &create.completed_at {
                task_tx::record_imported_completion_tx(&mut tx, &create.id, at).await?;
            }
            result.created_task_ids.push(create.id.clone());
        }
        for o in &plan.occurrences {
            let exists: Option<String> = sqlx::query_scalar("SELECT id FROM focus_occurrences WHERE id=?").bind(&o.id).fetch_optional(&mut *tx).await?;
            if exists.is_some() { continue; }
            let project: Option<String> = sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id=?").bind(&o.task_id).fetch_optional(&mut *tx).await?;
            sqlx::query("INSERT INTO focus_occurrences(id,task_id,original_task_id,title_snapshot,project_snapshot,scheduling_identity,generation,state,created_at,completed_at,completion_reason) VALUES(?,?,?,?,?,(SELECT due_date FROM local_tasks WHERE id=?),(SELECT COALESCE(MAX(generation),0)+1 FROM focus_occurrences WHERE original_task_id=?),?,?,?,?)")
                .bind(&o.id).bind(&o.task_id).bind(&o.task_id).bind(&o.title).bind(project).bind(&o.task_id).bind(&o.task_id)
                .bind(if o.completed_at.is_some() { "completed" } else { "open" })
                .bind(o.completed_at.as_deref().unwrap_or(&stamp)).bind(&o.completed_at)
                .bind(o.completed_at.as_ref().map(|_| "imported")).execute(&mut *tx).await?;
        }
        for r in plan.preview.records.iter().filter(|r| r.change != ImportChange::Unchanged) {
            sqlx::query("INSERT INTO focus_import_records(id,batch_id,source_namespace,record_key,fingerprint,status,mapping_json,decision_json,raw_evidence_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_namespace,record_key) DO UPDATE SET batch_id=excluded.batch_id,fingerprint=excluded.fingerprint,status=excluded.status,mapping_json=excluded.mapping_json,decision_json=excluded.decision_json,raw_evidence_json=excluded.raw_evidence_json")
                .bind(stable_id(ns, "record", &r.record_key)).bind(&batch).bind(ns).bind(&r.record_key).bind(&r.fingerprint)
                .bind(status_str(r.status)).bind(plan.record_mappings.get(&r.record_key).map(Value::to_string))
                .bind(json!({"reason": r.reason, "change": r.change, "kind": r.kind}).to_string()).bind(r.raw_evidence.to_string())
                .execute(&mut *tx).await?;
        }
        for t in &plan.totals {
            let inclusion = match t.inclusion { ImportInclusion::Included => "included", ImportInclusion::Excluded => "excluded", ImportInclusion::Unresolved => "unresolved" };
            sqlx::query("INSERT INTO focus_import_totals(id,source_namespace,record_key,occurrence_id,unresolved_task_id,duration_ms,completed_at,source_kind,batch_id,inclusion) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_namespace,record_key) DO UPDATE SET occurrence_id=excluded.occurrence_id,unresolved_task_id=excluded.unresolved_task_id,duration_ms=excluded.duration_ms,completed_at=excluded.completed_at,source_kind=excluded.source_kind,batch_id=excluded.batch_id,inclusion=excluded.inclusion")
                .bind(stable_id(ns, "total", &t.key)).bind(ns).bind(&t.key).bind(&t.occurrence).bind(&t.unresolved)
                .bind(t.duration as i64).bind(&t.completed_at).bind(&t.kind).bind(&batch).bind(inclusion).execute(&mut *tx).await?;
        }
        let mut entries = plan.queue_entries.clone();
        entries.extend(plan.queue_adds.iter().cloned());
        let selected = plan.selected.clone().or_else(|| entries.first().map(|e| e.occurrence_id.clone()));
        super::queue::validate(&entries, selected.as_deref())?;
        if !plan.queue_adds.is_empty() {
            sqlx::query("UPDATE focus_queue_state SET entries_json=?,selected_occurrence_id=?,revision=revision+1,updated_at=? WHERE id=1")
                .bind(serde_json::to_string(&entries).map_err(|e| err("invalid", &e.to_string()))?).bind(&selected).bind(&stamp)
                .execute(&mut *tx).await?;
        }
        sqlx::query("UPDATE focus_runtime SET engine_revision=engine_revision+1 WHERE id=1").execute(&mut *tx).await?;
        replica::publish_focus_replica_tx(&mut tx).await?;
        result.batch_id = Some(batch);
    }
    let revision: i64 = sqlx::query_scalar("SELECT COALESCE((SELECT engine_revision FROM focus_runtime WHERE id=1),0)").fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO focus_command_receipts(command_id,request_hash,result_json,committed_revision,affected_ids_json,committed_at) VALUES(?,?,?,?,?,?)")
        .bind(command_id).bind(&request_hash).bind(serde_json::to_string(&result).map_err(|e| err("invalid", &e.to_string()))?)
        .bind(revision).bind(json!(result.created_task_ids).to_string()).bind(&stamp).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(result)
}
