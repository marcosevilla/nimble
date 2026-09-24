//! Reviewed SQLite v19 portable-export policy. Changing the schema requires a policy review.

#[derive(Clone, Copy)]
pub(crate) struct TablePolicy {
    pub name: &'static str,
    pub columns: &'static [&'static str],
    pub included: &'static [&'static str],
    pub primary_key: &'static [&'static str],
}

macro_rules! table {
    ($name:literal; [$($col:literal),* $(,)?]; [$($included:literal),* $(,)?]; [$($pk:literal),+ $(,)?]) => {
        TablePolicy { name: $name, columns: &[$($col),*], included: &[$($included),*], primary_key: &[$($pk),+] }
    };
    ($name:literal; [$($col:literal),* $(,)?]; [$($included:literal),* $(,)?]) => {
        table!($name; [$($col),*]; [$($included),*]; ["id"])
    };
}

pub(crate) const TABLES: &[TablePolicy] = &[
    table!("action_log"; ["id","action_type","target_id","payload","synced","created_at"]; []),
    table!("activity_log"; ["id","action_type","target_id","metadata","created_at"]; ["id","action_type","target_id","metadata","created_at"]),
    table!("calendar_events"; ["id","summary","description","location","start_time","end_time","all_day","meeting_url","fetched_at","date","feed_label","feed_color"]; []),
    table!("calendar_feeds"; ["id","label","url","color","enabled","created_at"]; []),
    table!("capture_routes"; ["id","prefix","target_type","doc_id","label","color","icon","position","created_at"]; ["id","prefix","target_type","doc_id","label","color","icon","position","created_at"]),
    table!("captures"; ["id","content","source","converted_to_task_id","created_at","routed_to","context"]; ["id","content","source","converted_to_task_id","created_at","routed_to","context"]),
    table!("daily_state"; ["date","energy_level","top_priorities","first_opened_at","last_saved_at","focus_task_id","focus_started_at","focus_paused_at"]; ["date","energy_level","top_priorities","first_opened_at","last_saved_at","focus_task_id","focus_started_at","focus_paused_at"]; ["date"]),
    table!("doc_folders"; ["id","name","position","created_at"]; ["id","name","position","created_at"]),
    table!("doc_notes"; ["id","doc_id","content","position","created_at"]; ["id","doc_id","content","position","created_at"]),
    table!("documents"; ["id","title","content","folder_id","position","created_at","updated_at"]; ["id","title","content","folder_id","position","created_at","updated_at"]),
    table!("goals"; ["id","name","description","status","life_area_id","start_date","target_date","color","position","created_at","updated_at"]; ["id","name","description","status","life_area_id","start_date","target_date","color","position","created_at","updated_at"]),
    table!("habit_logs"; ["id","habit_id","date","intensity","created_at"]; ["id","habit_id","date","intensity","created_at"]),
    table!("habits"; ["id","name","category","icon","color","active","position","created_at"]; ["id","name","category","icon","color","active","position","created_at"]),
    table!("integration_sync_state"; ["provider","sync_token","last_sync_at","last_full_sync_at","last_error","enabled"]; []; ["provider"]),
    table!("labels"; ["id","name","color","position","created_at"]; ["id","name","color","position","created_at"]),
    table!("life_areas"; ["id","name","color","icon","position","created_at"]; ["id","name","color","icon","position","created_at"]),
    table!("local_tasks"; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","remote_updated_at","synced_snapshot","due_time","duration_minutes","recurrence_rule","section_id"]; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","due_time","duration_minutes","recurrence_rule","section_id"]),
    table!("milestones"; ["id","goal_id","name","target_date","completed","completed_at","position","created_at"]; ["id","goal_id","name","target_date","completed","completed_at","position","created_at"]),
    table!("progress_snapshots"; ["id","energy_level","tasks_completed","tasks_open","tasks_deferred","priorities","notes","created_at"]; ["id","energy_level","tasks_completed","tasks_open","tasks_deferred","priorities","notes","created_at"]),
    table!("projects"; ["id","name","color","position","created_at","goal_id","milestone_id","external_id","external_source","remote_updated_at","synced_snapshot","parent_id"]; ["id","name","color","position","created_at","goal_id","milestone_id","external_id","external_source","parent_id"]),
    table!("schema_version"; ["version","description","applied_at"]; []; ["version"]),
    table!("sections"; ["id","project_id","name","position","external_id","external_source","created_at"]; ["id","project_id","name","position","external_id","external_source","created_at"]),
    table!("settings"; ["key","value","updated_at"]; []; ["key"]),
    table!("sync_log"; ["id","table_name","row_id","operation","changed_columns","snapshot","device_id","timestamp","synced"]; []),
    table!("task_labels"; ["task_id","label_id","created_at"]; ["task_id","label_id","created_at"]; ["task_id","label_id"]),
    table!("todoist_outbox"; ["id","local_id","object_type","op","payload_json","command_uuid","temp_id","status","error","created_at","updated_at"]; []),
    table!("todoist_tasks"; ["id","content","description","project_id","project_name","priority","due_date","due_is_recurring","is_completed","todoist_url","fetched_at"]; []),
    table!("vault_links"; ["id","from_note_id","to_path","link_type","created_at"]; ["id","from_note_id","to_path","link_type","created_at"]),
    table!("vault_notes"; ["id","path","title","content","frontmatter_json","mtime","size","hash","updated_at","deleted_at"]; ["id","path","title","content","frontmatter_json","mtime","size","hash","updated_at","deleted_at"]),
    table!("vault_tags"; ["id","note_id","tag","created_at"]; ["id","note_id","tag","created_at"]),
];

/// V19 remains byte-for-byte compatible. V20 adds only reviewed user intent
/// to portable data; device-local calendar and delivery state is excluded.
/// V22 adds `projects.archived_at` (reviewed, included).
/// V23 adds the reviewed, included `briefs` table (per-day brief snapshots).
pub(crate) fn tables_for_version(version: i64) -> Option<Vec<TablePolicy>> {
    if version == 19 { return Some(TABLES.to_vec()); }
    if version != 20 && version != 21 && version != 22 && version != 23 { return None; }
    let mut tables = TABLES.to_vec();
    for policy in &mut tables {
        match policy.name {
            "labels" => *policy = table!("labels"; ["id","name","color","position","created_at","group"]; ["id","name","color","position","created_at","group"]),
            "local_tasks" => *policy = table!("local_tasks"; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","remote_updated_at","synced_snapshot","due_time","duration_minutes","recurrence_rule","section_id","reminder_offset_minutes","google_calendar_enabled"]; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","due_time","duration_minutes","recurrence_rule","section_id","reminder_offset_minutes","google_calendar_enabled"]),
            _ => {},
        }
    }
    tables.extend([
        table!("reminder_deliveries"; ["occurrence_key","task_id","scheduled_at","state","last_fired_at","acknowledged_at","error_code"]; []; ["occurrence_key"]),
        table!("google_calendar_state"; ["id","calendar_id","timezone","sync_token","last_synced_at","retry_after","error_code"]; []; ["id"]),
        table!("google_calendar_links"; ["task_id","event_id","etag","base_json","operation_id","desired_json","state","retry_after"]; []; ["task_id"]),
        table!("google_calendar_conflicts"; ["task_id","reason","local_json","remote_json","created_at"]; []; ["task_id"]),
    ]);
    if version >= 21 {
        for policy in &mut tables {
            match policy.name {
                "local_tasks" => *policy = table!("local_tasks"; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","remote_updated_at","synced_snapshot","due_time","duration_minutes","recurrence_rule","section_id","reminder_offset_minutes","google_calendar_enabled","sync_policy"]; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","due_time","duration_minutes","recurrence_rule","section_id","reminder_offset_minutes","google_calendar_enabled","sync_policy"]),
                "daily_state" => *policy = table!("daily_state"; ["date","energy_level","top_priorities","first_opened_at","last_saved_at","focus_task_id","focus_started_at","focus_paused_at"]; ["date","energy_level","top_priorities","first_opened_at","last_saved_at"]; ["date"]),
                _ => {},
            }
        }
        tables.extend([
            table!("focus_queue_state"; ["id","queue_id","writer_device_id","owner_epoch","revision","entries_json","selected_occurrence_id","updated_at"]; ["id","queue_id","writer_device_id","owner_epoch","revision","entries_json","selected_occurrence_id","updated_at"]),
            table!("focus_occurrences"; ["id","task_id","original_task_id","title_snapshot","project_snapshot","scheduling_identity","generation","state","created_at","completed_at","completion_reason","archived"]; ["id","task_id","original_task_id","title_snapshot","project_snapshot","scheduling_identity","generation","state","created_at","completed_at","completion_reason","archived"]),
            table!("focus_sessions"; ["id","occurrence_id","owner_device_id","owner_epoch","status","phase","mode","config_json","work_ms","break_ms","round_break_ms","round_work_ms","round","started_at","checkpoint_at","ended_at","session_revision","end_reason","timezone_offset_minutes"]; ["id","occurrence_id","owner_device_id","owner_epoch","status","phase","mode","config_json","work_ms","break_ms","round_break_ms","round_work_ms","round","started_at","checkpoint_at","ended_at","session_revision","end_reason","timezone_offset_minutes"]),
            table!("focus_segments"; ["id","session_id","kind","started_at","checkpoint_at","duration_ms","closed_at","close_reason"]; ["id","session_id","kind","started_at","checkpoint_at","duration_ms","closed_at","close_reason"]),
            table!("focus_runtime"; ["id","live_session_id","owner_epoch","process_generation","engine_revision","heartbeat_sequence","checkpoint_at","sound_token","boundary_token","recovery_reason"]; []),
            table!("focus_import_batches"; ["id","source_namespace","schema_version","file_hashes_json","preview_hash","mappings_json","created_at","committed_at"]; ["id","source_namespace","schema_version","file_hashes_json","preview_hash","mappings_json","created_at","committed_at"]),
            table!("focus_import_records"; ["id","batch_id","source_namespace","record_key","fingerprint","status","mapping_json","decision_json","raw_evidence_json"]; ["id","batch_id","source_namespace","record_key","fingerprint","status","mapping_json","decision_json","raw_evidence_json"]),
            table!("focus_import_totals"; ["id","source_namespace","record_key","occurrence_id","unresolved_task_id","duration_ms","completed_at","source_kind","batch_id","inclusion"]; ["id","source_namespace","record_key","occurrence_id","unresolved_task_id","duration_ms","completed_at","source_kind","batch_id","inclusion"]),
            table!("focus_command_receipts"; ["command_id","request_hash","result_json","committed_revision","affected_ids_json","committed_at"]; ["command_id","request_hash","result_json","committed_revision","affected_ids_json","committed_at"]; ["command_id"]),
            table!("focus_delivery"; ["id","occurrence_id","purpose","native_task_id","external_id","payload_json","idempotency_key","temp_id","state","attempts","next_attempt_at","last_error","remote_receipt","created_at","import_record_id","resolution_json","updated_at"]; ["id","occurrence_id","purpose","native_task_id","external_id","payload_json","idempotency_key","temp_id","state","attempts","next_attempt_at","last_error","remote_receipt","created_at","import_record_id","resolution_json","updated_at"]),
            table!("focus_undo"; ["token","original_task_id","task_snapshot_json","queue_entry_json","previous_entry_id","next_entry_id","occurrence_ids_json","issued_at","expires_at","consumed"]; []; ["token"]),
            table!("focus_replica"; ["id","writer_device_id","owner_epoch","revision","queue_revision","payload_json","as_of"]; []),
        ]);
    }
    if version >= 22 {
        for policy in &mut tables {
            if policy.name == "projects" {
                *policy = table!("projects"; ["id","name","color","position","created_at","goal_id","milestone_id","external_id","external_source","remote_updated_at","synced_snapshot","parent_id","archived_at"]; ["id","name","color","position","created_at","goal_id","milestone_id","external_id","external_source","parent_id","archived_at"]);
            }
        }
    }
    if version >= 23 {
        tables.push(table!("briefs"; ["date","version","status","source","layout_json","snapshot_json","snapshot_schema","energy_level","model","input_tokens","output_tokens","error_code","notes","generated_at","updated_at"]; ["date","version","status","source","layout_json","snapshot_json","snapshot_schema","energy_level","model","input_tokens","output_tokens","error_code","notes","generated_at","updated_at"]; ["date"]));
    }
    tables.sort_by_key(|policy| policy.name);
    Some(tables)
}

pub(crate) const FTS_TABLES: &[(&str, &[&str])] = &[
    ("vault_fts", &["note_id", "title", "content"]),
    ("vault_fts_config", &["k", "v"]),
    ("vault_fts_content", &["id", "c0", "c1", "c2"]),
    ("vault_fts_data", &["id", "block"]),
    ("vault_fts_docsize", &["id", "sz"]),
    ("vault_fts_idx", &["segid", "term", "pgno"]),
];
