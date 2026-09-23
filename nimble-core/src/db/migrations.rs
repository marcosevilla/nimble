use sqlx::SqlitePool;

pub struct Migration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        description: "Initial schema",
        sql: r#"
-- Settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached calendar events
CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    meeting_url TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached Todoist tasks
CREATE TABLE IF NOT EXISTS todoist_tasks (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    description TEXT,
    project_id TEXT,
    project_name TEXT,
    priority INTEGER NOT NULL DEFAULT 1,
    due_date TEXT,
    due_is_recurring INTEGER NOT NULL DEFAULT 0,
    is_completed INTEGER NOT NULL DEFAULT 0,
    todoist_url TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Action log (optimistic actions + retry queue)
CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    payload TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Progress snapshots (save function)
CREATE TABLE IF NOT EXISTS progress_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    energy_level TEXT,
    tasks_completed TEXT,
    tasks_open TEXT,
    tasks_deferred TEXT,
    priorities TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily state (one row per day)
CREATE TABLE IF NOT EXISTS daily_state (
    date TEXT PRIMARY KEY,
    energy_level TEXT DEFAULT 'medium',
    top_priorities TEXT,
    first_opened_at TEXT,
    last_saved_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_todoist_tasks_due ON todoist_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_action_log_synced ON action_log(synced)
"#,
    },
    Migration {
        version: 2,
        description: "Multi-calendar feeds",
        sql: r#"
            CREATE TABLE IF NOT EXISTS calendar_feeds (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                url TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6366f1',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT OR IGNORE INTO calendar_feeds (id, label, url)
                SELECT 'default', 'Calendar', value FROM settings WHERE key = 'ical_feed_url'
        "#,
    },
    Migration {
        version: 3,
        description: "Native tasks and projects",
        sql: r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6366f1',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            INSERT OR IGNORE INTO projects (id, name, color, position)
                VALUES ('inbox', 'Inbox', '#6366f1', 0);

            CREATE TABLE IF NOT EXISTS local_tasks (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                content TEXT NOT NULL,
                description TEXT,
                project_id TEXT NOT NULL DEFAULT 'inbox',
                priority INTEGER NOT NULL DEFAULT 1,
                due_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (parent_id) REFERENCES local_tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_local_tasks_project ON local_tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_local_tasks_parent ON local_tasks(parent_id);
            CREATE INDEX IF NOT EXISTS idx_local_tasks_due ON local_tasks(due_date);
            CREATE INDEX IF NOT EXISTS idx_local_tasks_completed ON local_tasks(completed)
        "#,
    },
    Migration {
        version: 4,
        description: "Activity log",
        sql: r#"
            CREATE TABLE IF NOT EXISTS activity_log (
                id TEXT PRIMARY KEY,
                action_type TEXT NOT NULL,
                target_id TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
            CREATE INDEX IF NOT EXISTS idx_activity_log_action_type ON activity_log(action_type);
            CREATE INDEX IF NOT EXISTS idx_activity_log_target ON activity_log(target_id)
        "#,
    },
    Migration {
        version: 5,
        description: "Focus mode state",
        sql: r#"
            ALTER TABLE daily_state ADD COLUMN focus_task_id TEXT;
            ALTER TABLE daily_state ADD COLUMN focus_started_at TEXT;
            ALTER TABLE daily_state ADD COLUMN focus_paused_at TEXT
        "#,
    },
    Migration {
        version: 7,
        description: "Task status workflow",
        sql: r#"
            ALTER TABLE local_tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'todo';
            UPDATE local_tasks SET status = 'complete' WHERE completed = 1;
            CREATE INDEX IF NOT EXISTS idx_local_tasks_status ON local_tasks(status)
        "#,
    },
    Migration {
        version: 8,
        description: "Captures table",
        sql: r#"
            CREATE TABLE IF NOT EXISTS captures (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                converted_to_task_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at);
            CREATE INDEX IF NOT EXISTS idx_captures_converted ON captures(converted_to_task_id)
        "#,
    },
    Migration {
        version: 9,
        description: "Docs: folders, documents, doc_notes",
        sql: r#"
            CREATE TABLE IF NOT EXISTS doc_folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                folder_id TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (folder_id) REFERENCES doc_folders(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
            CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);

            CREATE TABLE IF NOT EXISTS doc_notes (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL,
                content TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_doc_notes_doc ON doc_notes(doc_id);

            INSERT OR IGNORE INTO doc_folders (id, name, position) VALUES ('ideas', 'Ideas', 0);
            INSERT OR IGNORE INTO doc_folders (id, name, position) VALUES ('work', 'Work', 1);
            INSERT OR IGNORE INTO doc_folders (id, name, position) VALUES ('personal', 'Personal', 2);

            ALTER TABLE local_tasks ADD COLUMN linked_doc_id TEXT
        "#,
    },
    Migration {
        version: 10,
        description: "Capture routes + routed_to on captures",
        sql: r#"
            CREATE TABLE IF NOT EXISTS capture_routes (
                id TEXT PRIMARY KEY,
                prefix TEXT NOT NULL UNIQUE,
                target_type TEXT NOT NULL DEFAULT 'doc',
                doc_id TEXT,
                label TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#f59e0b',
                icon TEXT NOT NULL DEFAULT 'FileText',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            INSERT OR IGNORE INTO capture_routes (id, prefix, target_type, doc_id, label, color, icon, position) VALUES
                ('route-ideas', '/i', 'doc', NULL, 'Ideas', '#f59e0b', 'Lightbulb', 0);
            INSERT OR IGNORE INTO capture_routes (id, prefix, target_type, doc_id, label, color, icon, position) VALUES
                ('route-quotes', '/q', 'doc', NULL, 'Quotes', '#3b82f6', 'Quote', 1);
            INSERT OR IGNORE INTO capture_routes (id, prefix, target_type, doc_id, label, color, icon, position) VALUES
                ('route-task', '/t', 'task', NULL, 'Task', '#22c55e', 'CheckSquare', 2);

            ALTER TABLE captures ADD COLUMN routed_to TEXT
        "#,
    },
    Migration {
        version: 11,
        description: "Goals, milestones, life areas",
        sql: r#"
            CREATE TABLE IF NOT EXISTS life_areas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT 'Target',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            INSERT OR IGNORE INTO life_areas (id, name, color, icon, position) VALUES
                ('area-career', 'Career', '#3b82f6', 'Briefcase', 0);
            INSERT OR IGNORE INTO life_areas (id, name, color, icon, position) VALUES
                ('area-health', 'Health', '#22c55e', 'Heart', 1);
            INSERT OR IGNORE INTO life_areas (id, name, color, icon, position) VALUES
                ('area-creative', 'Creative', '#f59e0b', 'Palette', 2);
            INSERT OR IGNORE INTO life_areas (id, name, color, icon, position) VALUES
                ('area-financial', 'Financial', '#8b5cf6', 'DollarSign', 3);
            INSERT OR IGNORE INTO life_areas (id, name, color, icon, position) VALUES
                ('area-personal', 'Personal', '#ec4899', 'User', 4);
            INSERT OR IGNORE INTO life_areas (id, name, color, icon, position) VALUES
                ('area-learning', 'Learning', '#06b6d4', 'GraduationCap', 5);

            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                life_area_id TEXT,
                start_date TEXT,
                target_date TEXT,
                color TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (life_area_id) REFERENCES life_areas(id)
            );

            CREATE TABLE IF NOT EXISTS milestones (
                id TEXT PRIMARY KEY,
                goal_id TEXT NOT NULL,
                name TEXT NOT NULL,
                target_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
            )
        "#,
    },
    Migration {
        version: 12,
        description: "Link projects to goals + habits tables",
        sql: r#"
            ALTER TABLE projects ADD COLUMN goal_id TEXT REFERENCES goals(id);
            ALTER TABLE projects ADD COLUMN milestone_id TEXT REFERENCES milestones(id);

            CREATE TABLE IF NOT EXISTS habits (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                icon TEXT NOT NULL DEFAULT 'Circle',
                color TEXT NOT NULL DEFAULT '#f59e0b',
                active INTEGER NOT NULL DEFAULT 1,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            CREATE TABLE IF NOT EXISTS habit_logs (
                id TEXT PRIMARY KEY,
                habit_id TEXT NOT NULL,
                date TEXT NOT NULL,
                intensity INTEGER NOT NULL DEFAULT 5,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
                UNIQUE(habit_id, date)
            )
        "#,
    },
    Migration {
        version: 13,
        description: "Calendar events: add date column and feed metadata",
        sql: r#"
            ALTER TABLE calendar_events ADD COLUMN date TEXT;
            ALTER TABLE calendar_events ADD COLUMN feed_label TEXT;
            ALTER TABLE calendar_events ADD COLUMN feed_color TEXT;
            CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date)
        "#,
    },
    Migration {
        version: 14,
        description: "Sync log table and device_id",
        sql: r#"
            CREATE TABLE IF NOT EXISTS sync_log (
                id TEXT PRIMARY KEY,
                table_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                changed_columns TEXT,
                snapshot TEXT,
                device_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                synced INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced);
            CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp);
            CREATE INDEX IF NOT EXISTS idx_sync_log_table_row ON sync_log(table_name, row_id)
        "#,
    },
    Migration {
        version: 15,
        description: "External source tracking for imported data (Todoist, etc.)",
        sql: r#"
            ALTER TABLE local_tasks ADD COLUMN external_id TEXT;
            ALTER TABLE local_tasks ADD COLUMN external_source TEXT;
            ALTER TABLE projects ADD COLUMN external_id TEXT;
            ALTER TABLE projects ADD COLUMN external_source TEXT;

            CREATE INDEX IF NOT EXISTS idx_local_tasks_external
                ON local_tasks(external_source, external_id);
            CREATE INDEX IF NOT EXISTS idx_projects_external
                ON projects(external_source, external_id)
        "#,
    },
    Migration {
        version: 16,
        description: "Capture context: source app for selection captures",
        sql: r#"
            ALTER TABLE captures ADD COLUMN context TEXT
        "#,
    },
    Migration {
        version: 17,
        description: "todoist two-way sync: outbox, integration state, per-row sync metadata",
        sql: "
            CREATE TABLE IF NOT EXISTS todoist_outbox (
                id TEXT PRIMARY KEY,
                local_id TEXT NOT NULL,
                object_type TEXT NOT NULL,
                op TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                command_uuid TEXT NOT NULL,
                temp_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_todoist_outbox_status ON todoist_outbox(status);
            CREATE INDEX IF NOT EXISTS idx_todoist_outbox_local ON todoist_outbox(local_id, status);
            CREATE TABLE IF NOT EXISTS integration_sync_state (
                provider TEXT PRIMARY KEY,
                sync_token TEXT,
                last_sync_at TEXT,
                last_full_sync_at TEXT,
                last_error TEXT,
                enabled INTEGER NOT NULL DEFAULT 1
            );
            ALTER TABLE local_tasks ADD COLUMN remote_updated_at TEXT;
            ALTER TABLE local_tasks ADD COLUMN synced_snapshot TEXT;
            ALTER TABLE projects ADD COLUMN remote_updated_at TEXT;
            ALTER TABLE projects ADD COLUMN synced_snapshot TEXT
        ",
    },
    Migration {
        version: 18,
        description: "Obsidian vault index: notes, links, tags, device-local FTS",
        sql: "
            CREATE TABLE IF NOT EXISTS vault_notes (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                frontmatter_json TEXT,
                mtime TEXT,
                size INTEGER NOT NULL DEFAULT 0,
                hash TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_vault_notes_deleted ON vault_notes(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_vault_notes_updated ON vault_notes(updated_at);
            CREATE TABLE IF NOT EXISTS vault_links (
                id TEXT PRIMARY KEY,
                from_note_id TEXT NOT NULL,
                to_path TEXT NOT NULL,
                link_type TEXT NOT NULL DEFAULT 'wikilink',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_vault_links_from ON vault_links(from_note_id);
            CREATE INDEX IF NOT EXISTS idx_vault_links_to ON vault_links(to_path);
            CREATE TABLE IF NOT EXISTS vault_tags (
                id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_vault_tags_note ON vault_tags(note_id);
            CREATE INDEX IF NOT EXISTS idx_vault_tags_tag ON vault_tags(tag);
            CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(note_id UNINDEXED, title, content)
        ",
    },
    Migration {
        version: 19,
        description: "Task data-model parity: labels, sections, due_time, duration, recurrence, project nesting",
        sql: "
            CREATE TABLE IF NOT EXISTS labels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT 'gray',
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS task_labels (
                task_id TEXT NOT NULL,
                label_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                PRIMARY KEY (task_id, label_id)
            );
            CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);
            CREATE TABLE IF NOT EXISTS sections (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                external_id TEXT,
                external_source TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);
            ALTER TABLE local_tasks ADD COLUMN due_time TEXT;
            ALTER TABLE local_tasks ADD COLUMN duration_minutes INTEGER;
            ALTER TABLE local_tasks ADD COLUMN recurrence_rule TEXT;
            ALTER TABLE local_tasks ADD COLUMN section_id TEXT;
            ALTER TABLE projects ADD COLUMN parent_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_local_tasks_section ON local_tasks(section_id)
        ",
    },
    Migration {
        version: 20,
        description: "Reminders, calendar intent, and device-local delivery state",
        sql: "
            ALTER TABLE local_tasks ADD COLUMN reminder_offset_minutes INTEGER;
            ALTER TABLE local_tasks ADD COLUMN google_calendar_enabled INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE labels ADD COLUMN \"group\" TEXT;
            CREATE TABLE reminder_deliveries (
                occurrence_key TEXT PRIMARY KEY, task_id TEXT NOT NULL,
                scheduled_at TEXT NOT NULL, state TEXT NOT NULL,
                last_fired_at TEXT, acknowledged_at TEXT, error_code TEXT
            );
            CREATE INDEX reminder_deliveries_task ON reminder_deliveries(task_id);
            CREATE TABLE google_calendar_state (
                id INTEGER PRIMARY KEY CHECK(id = 1), calendar_id TEXT,
                timezone TEXT NOT NULL, sync_token TEXT, last_synced_at TEXT,
                retry_after TEXT, error_code TEXT
            );
            CREATE TABLE google_calendar_links (
                task_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
                etag TEXT, base_json TEXT, operation_id TEXT NOT NULL,
                desired_json TEXT, state TEXT NOT NULL, retry_after TEXT
            );
            CREATE TABLE google_calendar_conflicts (
                task_id TEXT PRIMARY KEY, reason TEXT NOT NULL,
                local_json TEXT NOT NULL, remote_json TEXT, created_at TEXT NOT NULL
            )
        ",
    },
    Migration {
        version: 21,
        description: "Focus queue, timing ledger, import provenance and local task sync policy",
        sql: r#"
            ALTER TABLE local_tasks ADD COLUMN sync_policy TEXT NOT NULL DEFAULT 'default' CHECK(sync_policy IN ('default', 'local_only'));
            CREATE TABLE focus_queue_state (
                id INTEGER PRIMARY KEY CHECK(id = 1), queue_id TEXT NOT NULL,
                writer_device_id TEXT NOT NULL, owner_epoch TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991),
                entries_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(entries_json) AND json_type(entries_json) = 'array'),
                selected_occurrence_id TEXT, updated_at TEXT NOT NULL
            );
            CREATE TABLE focus_occurrences (
                id TEXT PRIMARY KEY, task_id TEXT REFERENCES local_tasks(id) ON DELETE SET NULL,
                original_task_id TEXT NOT NULL, title_snapshot TEXT NOT NULL,
                project_snapshot TEXT, scheduling_identity TEXT,
                generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
                state TEXT NOT NULL CHECK(state IN ('open','completed','removed')),
                created_at TEXT NOT NULL, completed_at TEXT, completion_reason TEXT,
                archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
            );
            CREATE UNIQUE INDEX focus_one_occurrence_generation ON focus_occurrences(original_task_id, generation);
            CREATE INDEX focus_occurrences_task ON focus_occurrences(task_id);
            CREATE TABLE focus_sessions (
                id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES focus_occurrences(id),
                owner_device_id TEXT NOT NULL, owner_epoch TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('paused','running','ended')),
                phase TEXT NOT NULL DEFAULT 'work' CHECK(phase IN ('idle','work','break','round_ready','work_ready')),
                mode TEXT NOT NULL CHECK(mode IN ('count_up','timebox','pomodoro')),
                config_json TEXT NOT NULL CHECK(json_valid(config_json)),
                timezone_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK(timezone_offset_minutes BETWEEN -840 AND 840),
                work_ms INTEGER NOT NULL DEFAULT 0 CHECK(work_ms BETWEEN 0 AND 9007199254740991),
                break_ms INTEGER NOT NULL DEFAULT 0 CHECK(break_ms BETWEEN 0 AND 9007199254740991),
                round_break_ms INTEGER NOT NULL DEFAULT 0 CHECK(round_break_ms BETWEEN 0 AND 9007199254740991),
                round_work_ms INTEGER NOT NULL DEFAULT 0 CHECK(round_work_ms BETWEEN 0 AND 9007199254740991),
                round INTEGER NOT NULL DEFAULT 1 CHECK(round BETWEEN 1 AND 100),
                started_at TEXT, checkpoint_at TEXT, ended_at TEXT,
                session_revision INTEGER NOT NULL DEFAULT 0 CHECK(session_revision BETWEEN 0 AND 9007199254740991),
                end_reason TEXT
            );
            CREATE INDEX focus_sessions_occurrence ON focus_sessions(occurrence_id);
            CREATE TABLE focus_segments (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES focus_sessions(id),
                kind TEXT NOT NULL CHECK(kind IN ('work','break')),
                started_at TEXT NOT NULL, checkpoint_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms BETWEEN 0 AND 9007199254740991),
                closed_at TEXT, close_reason TEXT
            );
            CREATE UNIQUE INDEX focus_one_open_segment ON focus_segments((1)) WHERE closed_at IS NULL;
            CREATE TABLE focus_runtime (
                id INTEGER PRIMARY KEY CHECK(id = 1), live_session_id TEXT REFERENCES focus_sessions(id),
                owner_epoch TEXT NOT NULL, process_generation INTEGER NOT NULL DEFAULT 0 CHECK(process_generation BETWEEN 0 AND 9007199254740991),
                engine_revision INTEGER NOT NULL DEFAULT 0 CHECK(engine_revision BETWEEN 0 AND 9007199254740991),
                heartbeat_sequence INTEGER NOT NULL DEFAULT 0 CHECK(heartbeat_sequence BETWEEN 0 AND 9007199254740991),
                checkpoint_at TEXT, sound_token TEXT, boundary_token TEXT,
                recovery_reason TEXT
            );
            CREATE TABLE focus_import_batches (
                id TEXT PRIMARY KEY, source_namespace TEXT NOT NULL, schema_version TEXT,
                file_hashes_json TEXT NOT NULL CHECK(json_valid(file_hashes_json)),
                preview_hash TEXT NOT NULL, mappings_json TEXT NOT NULL CHECK(json_valid(mappings_json)),
                created_at TEXT NOT NULL, committed_at TEXT,
                UNIQUE(source_namespace, preview_hash)
            );
            CREATE TABLE focus_import_records (
                id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES focus_import_batches(id),
                source_namespace TEXT NOT NULL, record_key TEXT NOT NULL,
                fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('included','excluded','unresolved','quarantined')),
                mapping_json TEXT, decision_json TEXT, raw_evidence_json TEXT
            );
            CREATE UNIQUE INDEX focus_import_record_key ON focus_import_records(source_namespace, record_key);
            CREATE TABLE focus_import_totals (
                id TEXT PRIMARY KEY, source_namespace TEXT NOT NULL, record_key TEXT NOT NULL,
                occurrence_id TEXT REFERENCES focus_occurrences(id), unresolved_task_id TEXT,
                duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 0 AND 9007199254740991), completed_at TEXT,
                source_kind TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES focus_import_batches(id),
                inclusion TEXT NOT NULL CHECK(inclusion IN ('included','excluded','unresolved')),
                UNIQUE(source_namespace, record_key)
            );
            CREATE TABLE focus_command_receipts (
                command_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
                result_json TEXT NOT NULL CHECK(json_valid(result_json)),
                committed_revision INTEGER NOT NULL CHECK(committed_revision BETWEEN 0 AND 9007199254740991),
                affected_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(affected_ids_json)),
                committed_at TEXT NOT NULL
            );
            CREATE TABLE focus_delivery (
                id TEXT PRIMARY KEY, occurrence_id TEXT REFERENCES focus_occurrences(id),
                purpose TEXT NOT NULL, native_task_id TEXT, external_id TEXT,
                payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), idempotency_key TEXT, temp_id TEXT,
                state TEXT NOT NULL CHECK(state IN ('pending','sending','acknowledged','uncertain','retryable-error','needs-review','archived')),
                attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 9007199254740991), next_attempt_at TEXT,
                last_error TEXT, remote_receipt TEXT, created_at TEXT NOT NULL,
                import_record_id TEXT UNIQUE REFERENCES focus_import_records(id),
                resolution_json TEXT CHECK(resolution_json IS NULL OR json_valid(resolution_json)), updated_at TEXT,
                UNIQUE(occurrence_id, purpose)
            );
            CREATE TABLE focus_undo (
                token TEXT PRIMARY KEY, original_task_id TEXT NOT NULL,
                task_snapshot_json TEXT NOT NULL CHECK(json_valid(task_snapshot_json)),
                queue_entry_json TEXT, previous_entry_id TEXT, next_entry_id TEXT,
                occurrence_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(occurrence_ids_json)),
                issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
            );
            CREATE TABLE focus_replica (
                id TEXT PRIMARY KEY CHECK(id = 'current'),
                writer_device_id TEXT NOT NULL, owner_epoch TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
                queue_revision INTEGER NOT NULL CHECK(queue_revision BETWEEN 0 AND 9007199254740991),
                payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
                as_of TEXT NOT NULL
            );
            INSERT OR IGNORE INTO activity_log(id,action_type,target_id,metadata,created_at)
                SELECT 'legacy-focus-recovery-' || date,'focus_legacy_recovery',focus_task_id,
                    json_object('elapsed','unknown','started_at',focus_started_at,'paused_at',focus_paused_at),
                    datetime('now')
                FROM daily_state WHERE focus_task_id IS NOT NULL;
            UPDATE daily_state SET focus_task_id=NULL,focus_started_at=NULL,focus_paused_at=NULL
        "#,
    },
    Migration {
        version: 22,
        description: "Project archiving",
        sql: "ALTER TABLE projects ADD COLUMN archived_at TEXT",
    },
    Migration {
        version: 23,
        description: "Morning brief snapshots",
        sql: "CREATE TABLE IF NOT EXISTS briefs (
            date TEXT PRIMARY KEY,
            version INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL CHECK(status IN ('ready','partial','fallback','failed')),
            source TEXT NOT NULL DEFAULT 'nimble',
            layout_json TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            snapshot_schema INTEGER NOT NULL,
            energy_level TEXT,
            model TEXT,
            input_tokens INTEGER,
            output_tokens INTEGER,
            error_code TEXT,
            notes TEXT,
            generated_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    },
];

pub const CURRENT_SCHEMA_VERSION: i64 = 23;

pub async fn current_schema_version(pool: &SqlitePool) -> crate::Result<i64> {
    let version = sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM schema_version")
        .fetch_one(pool).await?;
    Ok(version)
}

pub async fn run_migrations(pool: &SqlitePool) -> crate::Result<()> {
    run_migrations_to_version(pool, CURRENT_SCHEMA_VERSION).await
}

/// Build only through a reviewed version, for isolated historical recovery.
pub async fn run_migrations_to_version(pool: &SqlitePool, target: i64) -> crate::Result<()> {
    if !(19..=CURRENT_SCHEMA_VERSION).contains(&target) {
        return Err(crate::Error::Other("unsupported_schema_target".into()));
    }
    // 1. Create schema_version table if not exists
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            description TEXT,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;

    // 2. Get current version
    let current: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) FROM schema_version")
            .fetch_one(pool)
            .await?;
    if current > target {
        return Err(crate::Error::Other("unsupported_schema_version".into()));
    }

    // 3. Run pending migrations
    for migration in MIGRATIONS {
        if migration.version > current && migration.version <= target {
            log::info!(
                "Running migration {}: {}",
                migration.version,
                migration.description
            );

            // One transaction per migration: its statements and its
            // schema_version row commit together or not at all (SQLite DDL is
            // transactional), so a crash or failure part-way leaves the
            // previous version intact and a rerun starts cleanly. No migration
            // uses a statement SQLite forbids inside a transaction (PRAGMA
            // foreign_keys / journal_mode, VACUUM); one that needs it must run
            // it outside this block explicitly.
            let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
            for statement in migration.sql.split(';').filter(|s| !s.trim().is_empty()) {
                sqlx::query(statement.trim())
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| {
                        crate::Error::Other(format!("Migration {} failed: {}", migration.version, e))
                    })?;
            }

            // Record migration
            sqlx::query(
                "INSERT INTO schema_version (version, description) VALUES (?, ?)",
            )
            .bind(migration.version)
            .bind(migration.description)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;

            log::info!("Migration {} complete", migration.version);
        }
    }

    Ok(())
}

#[cfg(test)]
mod v18_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn vault_tables_and_fts_exist_after_migrations() {
        let pool = test_pool().await;

        for table in ["vault_notes", "vault_links", "vault_tags"] {
            let found: Option<(String,)> = sqlx::query_as(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_optional(&pool)
            .await
            .unwrap();
            assert!(found.is_some(), "missing table {table}");
        }

        // FTS5 virtual table is device-local but must exist on desktop.
        sqlx::query("INSERT INTO vault_fts (note_id, title, content) VALUES ('n1', 'Alpha', 'body text')")
            .execute(&pool)
            .await
            .expect("insert into vault_fts");
        let hits: Vec<(String,)> =
            sqlx::query_as("SELECT note_id FROM vault_fts WHERE vault_fts MATCH 'body'")
                .fetch_all(&pool)
                .await
                .expect("fts query");
        assert_eq!(hits.len(), 1);

        // path is unique — two notes may not claim the same file
        sqlx::query("INSERT INTO vault_notes (id, path, title, content) VALUES ('a', 'x.md', 'X', '')")
            .execute(&pool)
            .await
            .unwrap();
        let dup = sqlx::query("INSERT INTO vault_notes (id, path, title, content) VALUES ('b', 'x.md', 'X', '')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "path must be UNIQUE");
    }
}

#[cfg(test)]
mod v19_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v19_tables_and_columns_exist() {
        let pool = test_pool().await;
        for table in ["labels", "task_labels", "sections"] {
            let found: Option<(String,)> = sqlx::query_as(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_optional(&pool)
            .await
            .unwrap();
            assert!(found.is_some(), "missing table {table}");
        }
        // new columns accept writes
        sqlx::query(
            "INSERT INTO local_tasks (id, content, project_id, due_date, due_time, duration_minutes, recurrence_rule)
             VALUES ('t1', 'x', 'inbox', '2026-08-16', '09:00', 10, 'every 2 weeks')",
        )
        .execute(&pool)
        .await
        .expect("v19 columns on local_tasks");
        sqlx::query("INSERT INTO projects (id, name, color, position, parent_id) VALUES ('p2', 'Child', 'blue', 1, 'inbox')")
            .execute(&pool)
            .await
            .expect("parent_id on projects");
        // task_labels composite PK rejects duplicates
        sqlx::query("INSERT INTO labels (id, name, color, position) VALUES ('l1', 'deep work', 'orange', 0)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO task_labels (task_id, label_id) VALUES ('t1', 'l1')")
            .execute(&pool).await.unwrap();
        let dup = sqlx::query("INSERT INTO task_labels (task_id, label_id) VALUES ('t1', 'l1')")
            .execute(&pool).await;
        assert!(dup.is_err(), "task_labels (task_id, label_id) must be unique");
    }
}

#[cfg(test)]
mod v23_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v23_creates_the_briefs_table() {
        let pool = test_pool().await;
        let cols: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('briefs') ORDER BY cid")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(cols, ["date","version","status","source","layout_json","snapshot_json","snapshot_schema",
            "energy_level","model","input_tokens","output_tokens","error_code","notes","generated_at","updated_at"]);
        assert_eq!(super::CURRENT_SCHEMA_VERSION, 23);
    }
}
