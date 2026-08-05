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
];

pub async fn run_migrations(pool: &SqlitePool) -> crate::Result<()> {
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

    // 3. Run pending migrations
    for migration in MIGRATIONS {
        if migration.version > current {
            log::info!(
                "Running migration {}: {}",
                migration.version,
                migration.description
            );

            // Execute migration SQL (may contain multiple statements)
            for statement in migration.sql.split(';').filter(|s| !s.trim().is_empty()) {
                sqlx::query(statement.trim())
                    .execute(pool)
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
            .execute(pool)
            .await?;

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
