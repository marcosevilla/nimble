/**
 * Sync service — push/pull local changes to/from Turso cloud database.
 *
 * Mirrors the Rust implementation in nimble-core/src/db/sync.rs.
 * Uses last-write-wins (LWW) conflict resolution for single-user multi-device sync.
 */

import { getDatabase, type Database } from './database';
import { getOrCreateDeviceId } from './sync-utils';
import {
  tursoPipeline,
  tursoExecute,
  tursoText,
  tursoNull,
  tursoTextOrNull,
  type TursoStatement,
  type TursoArg,
} from './turso';
import type { SyncStatus } from '@nimble/types';

// ── Table allowlist (prevents SQL injection) ──

const ALLOWED_TABLES = [
  'local_tasks',
  'projects',
  'captures',
  'goals',
  'milestones',
  'habits',
  'habit_logs',
  'daily_state',
  'activity_log',
  'documents',
  'doc_folders',
  'doc_notes',
  'capture_routes',
  'life_areas',
  'calendar_feeds',
] as const;

function isAllowedTable(name: string): boolean {
  return (ALLOWED_TABLES as readonly string[]).includes(name);
}

// ── Helpers ──

interface SyncLogRow {
  id: string;
  table_name: string;
  row_id: string;
  operation: string;
  changed_columns: string | null;
  snapshot: string | null;
  device_id: string;
  timestamp: string;
}

async function getSetting(db: Database, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    [key, value]
  );
}

async function getTursoCredentials(db: Database): Promise<{ url: string; token: string } | null> {
  const url = await getSetting(db, 'turso_url');
  const token = await getSetting(db, 'turso_token');
  if (!url || !token) return null;
  return { url, token };
}

/**
 * Convert a JSON snapshot value to a Turso argument.
 */
function snapshotValueToArg(val: unknown): TursoArg {
  if (val === null || val === undefined) return tursoNull();
  if (typeof val === 'boolean') return { type: 'integer', value: val ? '1' : '0' };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { type: 'integer', value: String(val) };
    return { type: 'float', value: String(val) };
  }
  if (typeof val === 'string') return tursoText(val);
  return tursoText(String(val));
}

/**
 * Convert a JSON snapshot value to a local SQLite bind parameter.
 */
function snapshotValueToLocal(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return val;
  return String(val);
}

// ── Build data mutation statements for Turso ──

function buildTursoMutationStatements(
  tableName: string,
  rowId: string,
  operation: string,
  snapshot: string | null
): TursoStatement[] {
  if (!isAllowedTable(tableName)) return [];

  if (operation === 'DELETE') {
    const sql = `DELETE FROM ${tableName} WHERE id = ?`;
    return [tursoExecute(sql, [tursoText(rowId)])];
  }

  if (operation === 'INSERT' || operation === 'UPDATE') {
    if (!snapshot) return [];

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      return [];
    }

    if (typeof parsed !== 'object' || parsed === null) return [];

    const columns = Object.keys(parsed);
    if (columns.length === 0) return [];

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    const args = columns.map((col) => snapshotValueToArg(parsed[col]));

    return [tursoExecute(sql, args)];
  }

  return [];
}

// ── Push ──

/**
 * Push unsynced local entries to Turso.
 * For each sync_log entry, sends the data mutation + the sync_log record itself.
 * Returns the count of entries pushed.
 */
export async function push(): Promise<number> {
  const db = getDatabase();
  const creds = await getTursoCredentials(db);
  if (!creds) throw new Error('Turso not configured');

  // Fetch unsynced entries
  const entries = await db.getAllAsync<SyncLogRow>(
    'SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp FROM sync_log WHERE synced = 0 ORDER BY timestamp'
  );

  if (entries.length === 0) return 0;

  // Build batch of Turso statements
  const statements: TursoStatement[] = [];
  const pushedIds: string[] = [];

  for (const entry of entries) {
    // 1. Apply the actual data mutation on Turso
    const mutations = buildTursoMutationStatements(
      entry.table_name,
      entry.row_id,
      entry.operation,
      entry.snapshot
    );
    statements.push(...mutations);

    // 2. Insert the sync_log entry on Turso (so other devices can pull it)
    statements.push(
      tursoExecute(
        'INSERT OR IGNORE INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
        [
          tursoText(entry.id),
          tursoText(entry.table_name),
          tursoText(entry.row_id),
          tursoText(entry.operation),
          tursoTextOrNull(entry.changed_columns),
          tursoTextOrNull(entry.snapshot),
          tursoText(entry.device_id),
          tursoText(entry.timestamp),
        ]
      )
    );

    pushedIds.push(entry.id);
  }

  // Send the pipeline
  const body = await tursoPipeline(creds.url, creds.token, statements);

  // Log any pipeline errors (but don't fail the whole push)
  if (body.results) {
    for (let i = 0; i < body.results.length; i++) {
      const result = body.results[i];
      if (result.type === 'error') {
        console.warn(
          `[sync] Turso pipeline statement ${i} failed:`,
          result.error?.message ?? 'Unknown error'
        );
      }
    }
  }

  // Mark local entries as synced
  for (const id of pushedIds) {
    await db.runAsync('UPDATE sync_log SET synced = 1 WHERE id = ?', [id]);
  }

  // Update last_push_timestamp
  const now = new Date().toISOString();
  await setSetting(db, 'last_push_timestamp', now);

  return pushedIds.length;
}

// ── Pull ──

/**
 * Pull remote changes from Turso that originated on other devices.
 * Applies each change locally using last-write-wins.
 * Returns the count of applied entries.
 */
export async function pull(): Promise<number> {
  const db = getDatabase();
  const creds = await getTursoCredentials(db);
  if (!creds) throw new Error('Turso not configured');

  const deviceId = await getOrCreateDeviceId(db);
  const lastPull =
    (await getSetting(db, 'last_pull_timestamp')) ?? '1970-01-01T00:00:00.000Z';

  // Query Turso for entries from other devices since last pull
  const body = await tursoPipeline(creds.url, creds.token, [
    tursoExecute(
      'SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp FROM sync_log WHERE timestamp > ? AND device_id != ? ORDER BY timestamp ASC',
      [tursoText(lastPull), tursoText(deviceId)]
    ),
  ]);

  // Parse rows from response: results[0].response.result.rows
  const result = body.results?.[0];
  if (result?.type !== 'ok') {
    const errMsg = result?.error?.message ?? 'Unknown error';
    throw new Error(`Turso pull query failed: ${errMsg}`);
  }

  const rows = result.response?.result?.rows ?? [];
  let applied = 0;
  let maxTimestamp = lastPull;

  for (const row of rows) {
    // Each column is { type: "text", value: "..." } or { type: "null" }
    const getText = (idx: number): string | null => {
      const cell = row[idx];
      if (!cell || cell.type === 'null') return null;
      return cell.value ?? null;
    };

    const entryId = getText(0);
    const tableName = getText(1);
    const rowId = getText(2);
    const operation = getText(3);
    const changedColumns = getText(4);
    const snapshot = getText(5);
    const remoteDeviceId = getText(6);
    const timestamp = getText(7);

    if (!entryId || !tableName || !rowId || !operation || !remoteDeviceId || !timestamp) {
      continue;
    }

    // LWW check: skip applying if local has a newer entry for the same (table, row)
    const localNewer = await db.getFirstAsync<{ timestamp: string }>(
      'SELECT timestamp FROM sync_log WHERE table_name = ? AND row_id = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT 1',
      [tableName, rowId, timestamp]
    );

    if (localNewer) {
      console.log(
        `[sync] Skipping remote change ${entryId} — local has newer entry for ${tableName}/${rowId}`
      );
      // Still record the entry so we don't pull it again
      await db
        .runAsync(
          'INSERT OR IGNORE INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
          [entryId, tableName, rowId, operation, changedColumns, snapshot, remoteDeviceId, timestamp]
        )
        .catch(() => {});

      if (timestamp > maxTimestamp) maxTimestamp = timestamp;
      continue;
    }

    // Apply the change locally
    try {
      await applyRemoteChange(db, tableName, rowId, operation, snapshot);
    } catch (e) {
      console.warn(`[sync] Failed to apply remote change ${entryId}:`, e);
      continue;
    }

    // Record entry in local sync_log as already synced (so we don't push it back)
    await db
      .runAsync(
        'INSERT OR IGNORE INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
        [entryId, tableName, rowId, operation, changedColumns, snapshot, remoteDeviceId, timestamp]
      )
      .catch(() => {});

    if (timestamp > maxTimestamp) maxTimestamp = timestamp;
    applied++;
  }

  // Update last_pull_timestamp
  if (maxTimestamp > lastPull) {
    await setSetting(db, 'last_pull_timestamp', maxTimestamp);
  }

  return applied;
}

/**
 * Apply a single remote change to the local database.
 */
async function applyRemoteChange(
  db: Database,
  tableName: string,
  rowId: string,
  operation: string,
  snapshot: string | null
): Promise<void> {
  if (!isAllowedTable(tableName)) {
    throw new Error(`Table '${tableName}' is not allowed for sync`);
  }

  if (operation === 'DELETE') {
    await db.runAsync(`DELETE FROM ${tableName} WHERE id = ?`, [rowId]);
    return;
  }

  if (operation === 'INSERT' || operation === 'UPDATE') {
    if (!snapshot) throw new Error('Missing snapshot for INSERT/UPDATE');

    const parsed: Record<string, unknown> = JSON.parse(snapshot);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Snapshot is not a JSON object');
    }

    const columns = Object.keys(parsed);
    if (columns.length === 0) return;

    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
    const params = columns.map((col) => snapshotValueToLocal(parsed[col]));

    await db.runAsync(sql, params);
    return;
  }

  console.warn(`[sync] Unknown operation: ${operation}`);
}

// ── Test Connection ──

/**
 * Test connection to Turso by running SELECT 1.
 */
export async function testConnection(tursoUrl: string, tursoToken: string): Promise<void> {
  const body = await tursoPipeline(tursoUrl, tursoToken, [
    tursoExecute('SELECT 1', []),
  ]);

  const result = body.results?.[0];
  if (result?.type !== 'ok') {
    const errMsg = result?.error?.message ?? 'Unknown error';
    throw new Error(`Turso test failed: ${errMsg}`);
  }
}

// ── Initialize Remote ──

/**
 * Create all synced tables on the remote Turso database.
 * Only runs once — checks for `turso_initialized` setting.
 */
export async function initializeRemote(tursoUrl: string, tursoToken: string): Promise<void> {
  const db = getDatabase();

  // Check if already initialized
  const initialized = await getSetting(db, 'turso_initialized');
  if (initialized) return;

  // All CREATE TABLE statements for synced tables (matches Rust implementation)
  const createStatements = [
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS local_tasks (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      content TEXT NOT NULL,
      description TEXT,
      project_id TEXT NOT NULL DEFAULT 'inbox',
      priority INTEGER NOT NULL DEFAULT 1,
      due_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      linked_doc_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      position INTEGER NOT NULL DEFAULT 0,
      goal_id TEXT,
      milestone_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      converted_to_task_id TEXT,
      routed_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      life_area_id TEXT,
      start_date TEXT,
      target_date TEXT,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      name TEXT NOT NULL,
      target_date TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      icon TEXT NOT NULL DEFAULT 'Circle',
      color TEXT NOT NULL DEFAULT '#f59e0b',
      active INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS habit_logs (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      intensity INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS daily_state (
      date TEXT PRIMARY KEY,
      energy_level TEXT DEFAULT 'medium',
      top_priorities TEXT,
      first_opened_at TEXT,
      last_saved_at TEXT,
      focus_task_id TEXT,
      focus_started_at TEXT,
      focus_paused_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      target_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      folder_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS doc_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS doc_notes (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      content TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS capture_routes (
      id TEXT PRIMARY KEY,
      prefix TEXT NOT NULL UNIQUE,
      target_type TEXT NOT NULL DEFAULT 'doc',
      doc_id TEXT,
      label TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#f59e0b',
      icon TEXT NOT NULL DEFAULT 'FileText',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS life_areas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'Target',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS calendar_feeds (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      changed_columns TEXT,
      snapshot TEXT,
      device_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    )`,
    'CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced)',
    'CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_sync_log_table_row ON sync_log(table_name, row_id)',
  ];

  // Build pipeline — one execute per statement
  const statements = createStatements.map((sql) => tursoExecute(sql));

  await tursoPipeline(tursoUrl, tursoToken, statements);

  // Mark as initialized locally
  await setSetting(db, 'turso_initialized', '1');
}

// ── Sync Status ──

/**
 * Get current sync status for display in settings.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const db = getDatabase();

  const pendingRow = await db.getFirstAsync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM sync_log WHERE synced = 0'
  );

  const lastSync = await getSetting(db, 'last_pull_timestamp');
  const deviceId = await getOrCreateDeviceId(db);
  const tursoUrl = await getSetting(db, 'turso_url');
  const tursoToken = await getSetting(db, 'turso_token');
  const tursoInitialized = await getSetting(db, 'turso_initialized');

  return {
    pending_changes: pendingRow?.cnt ?? 0,
    last_sync: lastSync,
    device_id: deviceId,
    turso_configured: !!(tursoUrl && tursoToken),
    remote_initialized: !!tursoInitialized,
  };
}

// ── Full sync (push then pull) ──

/**
 * Run a full sync cycle: push local changes, then pull remote changes.
 * Returns { pushed, pulled } counts.
 * Silently returns zeroes if Turso is not configured.
 */
export async function fullSync(): Promise<{ pushed: number; pulled: number }> {
  const db = getDatabase();
  const creds = await getTursoCredentials(db);
  if (!creds) return { pushed: 0, pulled: 0 };

  const pushed = await push();
  const pulled = await pull();
  return { pushed, pulled };
}

/**
 * Non-blocking sync — runs push+pull in background, logs errors.
 * Safe to call from useEffect / app startup.
 */
export function backgroundSync(): void {
  fullSync()
    .then(({ pushed, pulled }) => {
      if (pushed > 0 || pulled > 0) {
        console.log(`[sync] Background sync complete: pushed ${pushed}, pulled ${pulled}`);
      }
    })
    .catch((e) => {
      console.warn('[sync] Background sync failed:', e);
    });
}
