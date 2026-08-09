/**
 * SqliteProvider — Mobile implementation of DataProvider using expo-sqlite.
 *
 * Phase 1b: Read methods implemented.
 * Phase 1c: Mutations with sync_log support.
 */

import type { DataProvider } from './data-provider';
import type {
  Setting,
  LocalTask,
  Project,
  Capture,
  Habit,
  HabitWithStats,
  HabitLog,
  GoalWithProgress,
  TaskStatus,
} from '@nimble/types';
import { getDatabase } from './database';
import { generateUUID, appendSyncLog } from './sync-utils';
import * as sync from './sync';

const stub = (name: string) => {
  console.warn(`[SqliteProvider] ${name} is not yet implemented (stub)`);
  return Promise.resolve(undefined as never);
};

export function createSqliteProvider(): DataProvider {
  return {
    settings: {
      async checkSetupComplete() {
        const db = getDatabase();
        const row = await db.getFirstAsync<{ value: string }>(
          "SELECT value FROM settings WHERE key = 'setup_complete'"
        );
        return row?.value === 'true';
      },
      async get(key: string) {
        const db = getDatabase();
        const row = await db.getFirstAsync<{ value: string }>(
          'SELECT value FROM settings WHERE key = ?',
          [key]
        );
        return row?.value ?? null;
      },
      async set(key: string, value: string) {
        const db = getDatabase();
        const now = new Date().toISOString();
        await db.runAsync(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
          [key, value, now]
        );
        appendSyncLog('settings', key, 'UPDATE', ['value'], { key, value });
      },
      async getAll() {
        const db = getDatabase();
        return db.getAllAsync<Setting>('SELECT key, value FROM settings');
      },
      clearAll: () => stub('settings.clearAll'),
    },

    obsidian: {
      readTodayMd: () => stub('obsidian.readTodayMd'),
      toggleCheckbox: () => stub('obsidian.toggleCheckbox'),
      importCaptures: () => stub('obsidian.importCaptures'),
    },

    calendar: {
      fetchEvents: () => stub('calendar.fetchEvents'),
      getCachedEvents: () => stub('calendar.getCachedEvents'),
      getFeeds: () => stub('calendar.getFeeds'),
      addFeed: () => stub('calendar.addFeed'),
      removeFeed: () => stub('calendar.removeFeed'),
    },

    captures: {
      async list(limit?: number, _includeConverted?: boolean) {
        const db = getDatabase();
        if (limit) {
          return db.getAllAsync<Capture>(
            'SELECT * FROM captures ORDER BY created_at DESC LIMIT ?',
            [limit]
          );
        }
        return db.getAllAsync<Capture>(
          'SELECT * FROM captures ORDER BY created_at DESC'
        );
      },
      async create(content: string, source?: string) {
        const db = getDatabase();
        const id = generateUUID();
        const src = source ?? 'manual';
        const now = new Date().toISOString();

        await db.runAsync(
          `INSERT INTO captures (id, content, source, created_at)
           VALUES (?, ?, ?, ?)`,
          [id, content, src, now]
        );

        const capture: Capture = {
          id,
          content,
          source: src,
          converted_to_task_id: null,
          routed_to: null,
          context: null,
          created_at: now,
        };

        appendSyncLog('captures', id, 'INSERT', null, capture as unknown as Record<string, unknown>);
        return capture;
      },
      convertToTask: () => stub('captures.convertToTask'),
      async delete(id: string) {
        const db = getDatabase();
        await db.runAsync('DELETE FROM captures WHERE id = ?', [id]);
        appendSyncLog('captures', id, 'DELETE', null, null);
      },
      readQuickCaptures: () => stub('captures.readQuickCaptures'),
      writeQuickCapture: () => stub('captures.writeQuickCapture'),
    },

    captureRoutes: {
      list: () => stub('captureRoutes.list'),
      create: () => stub('captureRoutes.create'),
      update: () => stub('captureRoutes.update'),
      delete: () => stub('captureRoutes.delete'),
      route: () => stub('captureRoutes.route'),
    },

    projects: {
      async list() {
        const db = getDatabase();
        return db.getAllAsync<Project>(
          'SELECT * FROM projects ORDER BY position'
        );
      },
      async create(name: string, color: string) {
        const db = getDatabase();
        const id = generateUUID();
        const now = new Date().toISOString();

        // Get next position
        const row = await db.getFirstAsync<{ maxPos: number }>(
          'SELECT COALESCE(MAX(position), -1) as maxPos FROM projects'
        );
        const position = (row?.maxPos ?? -1) + 1;

        await db.runAsync(
          `INSERT INTO projects (id, name, color, position, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [id, name, color, position, now]
        );

        const project: Project = {
          id,
          name,
          color,
          position,
          parent_id: null,
          external_id: null,
          external_source: null,
          remote_updated_at: null,
          synced_snapshot: null,
        };
        appendSyncLog('projects', id, 'INSERT', null, project as unknown as Record<string, unknown>);
        return project;
      },
      update: () => stub('projects.update'),
      delete: () => stub('projects.delete'),
    },

    tasks: {
      async list(opts) {
        const db = getDatabase();
        let sql = 'SELECT * FROM local_tasks WHERE 1=1';
        const params: (string | number)[] = [];

        if (opts?.projectId) {
          sql += ' AND project_id = ?';
          params.push(opts.projectId);
        }
        if (opts?.dueDate) {
          sql += ' AND due_date = ?';
          params.push(opts.dueDate);
        }
        if (!opts?.includeCompleted) {
          sql += " AND status != 'complete'";
        }

        sql += ' ORDER BY position';

        const rows = await db.getAllAsync<Omit<LocalTask, 'completed'> & { completed: number }>(
          sql,
          params
        );
        return rows.map((r) => ({
          ...r,
          completed: Boolean(r.completed),
        }));
      },

      async create(opts) {
        const db = getDatabase();
        const id = generateUUID();
        const now = new Date().toISOString();
        const projectId = opts.projectId ?? 'inbox';
        const priority = opts.priority ?? 1;
        const status: TaskStatus = 'todo';

        // Get next position
        const row = await db.getFirstAsync<{ maxPos: number }>(
          'SELECT COALESCE(MAX(position), -1) as maxPos FROM local_tasks WHERE project_id = ?',
          [projectId]
        );
        const position = (row?.maxPos ?? -1) + 1;

        await db.runAsync(
          `INSERT INTO local_tasks (id, parent_id, content, description, project_id, priority, due_date, completed, status, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
          [
            id,
            opts.parentId ?? null,
            opts.content,
            opts.description ?? null,
            projectId,
            priority,
            opts.dueDate ?? null,
            status,
            position,
            now,
            now,
          ]
        );

        const task: LocalTask = {
          id,
          parent_id: opts.parentId ?? null,
          content: opts.content,
          description: opts.description ?? null,
          project_id: projectId,
          priority,
          due_date: opts.dueDate ?? null,
          completed: false,
          completed_at: null,
          status,
          linked_doc_id: null,
          position,
          created_at: now,
          updated_at: now,
          external_id: null,
          external_source: null,
          remote_updated_at: null,
          synced_snapshot: null,
        };

        appendSyncLog('local_tasks', id, 'INSERT', null, task as unknown as Record<string, unknown>);
        return task;
      },

      async update(opts) {
        const db = getDatabase();
        const now = new Date().toISOString();
        const changedColumns: string[] = ['updated_at'];
        const sets: string[] = ['updated_at = ?'];
        const params: (string | number | null)[] = [now];

        if (opts.content !== undefined) {
          sets.push('content = ?');
          params.push(opts.content);
          changedColumns.push('content');
        }
        if (opts.description !== undefined) {
          sets.push('description = ?');
          params.push(opts.description);
          changedColumns.push('description');
        }
        if (opts.projectId !== undefined) {
          sets.push('project_id = ?');
          params.push(opts.projectId);
          changedColumns.push('project_id');
        }
        if (opts.priority !== undefined) {
          sets.push('priority = ?');
          params.push(opts.priority);
          changedColumns.push('priority');
        }
        if (opts.dueDate !== undefined) {
          sets.push('due_date = ?');
          params.push(opts.dueDate);
          changedColumns.push('due_date');
        }
        if (opts.clearDueDate) {
          sets.push('due_date = NULL');
          changedColumns.push('due_date');
        }

        params.push(opts.id);

        await db.runAsync(
          `UPDATE local_tasks SET ${sets.join(', ')} WHERE id = ?`,
          params
        );

        // Fetch updated task
        const row = await db.getFirstAsync<Omit<LocalTask, 'completed'> & { completed: number }>(
          'SELECT * FROM local_tasks WHERE id = ?',
          [opts.id]
        );

        if (!row) throw new Error(`Task ${opts.id} not found`);

        const task: LocalTask = { ...row, completed: Boolean(row.completed) };
        appendSyncLog('local_tasks', opts.id, 'UPDATE', changedColumns, task as unknown as Record<string, unknown>);
        return task;
      },

      async updateStatus(id: string, status: TaskStatus, _note?: string) {
        const db = getDatabase();
        const now = new Date().toISOString();
        const completed = status === 'complete' ? 1 : 0;
        const completedAt = status === 'complete' ? now : null;

        await db.runAsync(
          `UPDATE local_tasks SET status = ?, completed = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
          [status, completed, completedAt, now, id]
        );

        appendSyncLog('local_tasks', id, 'UPDATE', ['status', 'completed', 'completed_at', 'updated_at'], {
          id,
          status,
          completed,
          completed_at: completedAt,
          updated_at: now,
        });
      },

      async complete(id: string) {
        const db = getDatabase();
        const now = new Date().toISOString();

        await db.runAsync(
          `UPDATE local_tasks SET status = 'complete', completed = 1, completed_at = ?, updated_at = ? WHERE id = ?`,
          [now, now, id]
        );

        appendSyncLog('local_tasks', id, 'UPDATE', ['status', 'completed', 'completed_at', 'updated_at'], {
          id,
          status: 'complete',
          completed: 1,
          completed_at: now,
          updated_at: now,
        });
      },

      async uncomplete(id: string) {
        const db = getDatabase();
        const now = new Date().toISOString();

        await db.runAsync(
          `UPDATE local_tasks SET status = 'todo', completed = 0, completed_at = NULL, updated_at = ? WHERE id = ?`,
          [now, id]
        );

        appendSyncLog('local_tasks', id, 'UPDATE', ['status', 'completed', 'completed_at', 'updated_at'], {
          id,
          status: 'todo',
          completed: 0,
          completed_at: null,
          updated_at: now,
        });
      },

      async delete(id: string) {
        const db = getDatabase();
        await db.runAsync('DELETE FROM local_tasks WHERE id = ?', [id]);
        appendSyncLog('local_tasks', id, 'DELETE', null, null);
      },

      reorder: () => stub('tasks.reorder'),
    },

    docs: {
      getFolders: () => stub('docs.getFolders'),
      createFolder: () => stub('docs.createFolder'),
      renameFolder: () => stub('docs.renameFolder'),
      deleteFolder: () => stub('docs.deleteFolder'),
      getDocuments: () => stub('docs.getDocuments'),
      getDocument: () => stub('docs.getDocument'),
      createDocument: () => stub('docs.createDocument'),
      updateDocument: () => stub('docs.updateDocument'),
      deleteDocument: () => stub('docs.deleteDocument'),
      searchDocuments: () => stub('docs.searchDocuments'),
      getNotes: () => stub('docs.getNotes'),
      createNote: () => stub('docs.createNote'),
      deleteNote: () => stub('docs.deleteNote'),
      reorderNotes: () => stub('docs.reorderNotes'),
      previewMarkdownMigration: () => {
        throw new Error('desktop only')
      },
      migrateToMarkdown: () => {
        throw new Error('desktop only')
      },
    },

    activity: {
      log: () => stub('activity.log'),
      getLog: () => stub('activity.getLog'),
      getSummary: () => stub('activity.getSummary'),
    },

    focus: {
      startSession: () => stub('focus.startSession'),
      endSession: () => stub('focus.endSession'),
      getActive: async () => ({
        task_id: null,
        started_at: null,
        paused_at: null,
      }),
    },

    dailyState: {
      async get() {
        const db = getDatabase();
        const today = new Date().toISOString().split('T')[0];
        const row = await db.getFirstAsync<{
          date: string;
          energy_level: string | null;
          top_priorities: string | null;
        }>('SELECT * FROM daily_state WHERE date = ?', [today]);

        return {
          date: today,
          energy_level: row?.energy_level ?? null,
          priorities: row?.top_priorities
            ? JSON.parse(row.top_priorities)
            : null,
          review_complete: false,
        };
      },
      generatePriorities: () => stub('dailyState.generatePriorities'),
      readSessionLog: async () => null,
      readDailyBrief: async () => null,
      listBriefDates: async () => [],
      saveProgress: () => stub('dailyState.saveProgress'),
    },

    goals: {
      async list() {
        const db = getDatabase();
        const goals = await db.getAllAsync<GoalWithProgress>(
          `SELECT g.*,
            COALESCE(
              (SELECT COUNT(*) FROM milestones WHERE goal_id = g.id), 0
            ) as milestone_count,
            COALESCE(
              (SELECT COUNT(*) FROM milestones WHERE goal_id = g.id AND completed = 1), 0
            ) as milestone_completed,
            0 as task_count,
            0 as task_completed,
            0 as progress
          FROM goals g ORDER BY g.position`
        );
        return goals;
      },
      get: () => stub('goals.get'),
      create: () => stub('goals.create'),
      update: () => stub('goals.update'),
      delete: () => stub('goals.delete'),
      getMilestones: () => stub('goals.getMilestones'),
      createMilestone: () => stub('goals.createMilestone'),
      updateMilestone: () => stub('goals.updateMilestone'),
      deleteMilestone: () => stub('goals.deleteMilestone'),
      getLifeAreas: () => stub('goals.getLifeAreas'),
      createLifeArea: () => stub('goals.createLifeArea'),
      updateLifeArea: () => stub('goals.updateLifeArea'),
      deleteLifeArea: () => stub('goals.deleteLifeArea'),
      importFromVault: () => stub('goals.importFromVault'),
    },

    habits: {
      async list() {
        const db = getDatabase();
        const today = new Date().toISOString().split('T')[0];
        const habits = await db.getAllAsync<Omit<Habit, 'active'> & { active: number }>(
          'SELECT * FROM habits WHERE active = 1 ORDER BY position'
        );
        const result: HabitWithStats[] = [];
        for (const h of habits) {
          const log = await db.getFirstAsync<{ intensity: number }>(
            'SELECT intensity FROM habit_logs WHERE habit_id = ? AND date = ?',
            [h.id, today]
          );
          // Count logs from last 7 days for momentum
          const momentumRow = await db.getFirstAsync<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM habit_logs
             WHERE habit_id = ? AND date >= date('now', '-7 days')`,
            [h.id]
          );
          result.push({
            ...h,
            active: Boolean(h.active),
            current_momentum: momentumRow?.cnt ?? 0,
            today_completed: !!log,
            today_intensity: log?.intensity ?? 0,
          });
        }
        return result;
      },
      create: () => stub('habits.create'),
      update: () => stub('habits.update'),
      delete: () => stub('habits.delete'),

      async log(habitId: string, date?: string, intensity?: number) {
        const db = getDatabase();
        const id = generateUUID();
        const logDate = date ?? new Date().toISOString().split('T')[0];
        const logIntensity = intensity ?? 5;
        const now = new Date().toISOString();

        await db.runAsync(
          `INSERT OR REPLACE INTO habit_logs (id, habit_id, date, intensity, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [id, habitId, logDate, logIntensity, now]
        );

        const habitLog: HabitLog = {
          id,
          habit_id: habitId,
          date: logDate,
          intensity: logIntensity,
          created_at: now,
        };

        appendSyncLog('habit_logs', id, 'INSERT', null, habitLog as unknown as Record<string, unknown>);
        return habitLog;
      },

      async unlog(habitId: string, date?: string) {
        const db = getDatabase();
        const logDate = date ?? new Date().toISOString().split('T')[0];

        // Find the log entry first for sync
        const existing = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?',
          [habitId, logDate]
        );

        await db.runAsync(
          'DELETE FROM habit_logs WHERE habit_id = ? AND date = ?',
          [habitId, logDate]
        );

        if (existing) {
          appendSyncLog('habit_logs', existing.id, 'DELETE', null, null);
        }
      },

      getLogs: () => stub('habits.getLogs'),
      getHeatmap: () => stub('habits.getHeatmap'),
    },

    ai: {
      breakDownTask: () => stub('ai.breakDownTask'),
    },

    system: {
      openUrl: () => stub('system.openUrl'),
      checkForUpdates: async () => ({
        current_version: '0.1.0',
        latest_version: null,
        update_available: false,
        release_url: null,
        error: null,
      }),
    },

    sync: {
      push: () => sync.push(),
      pull: () => sync.pull(),
      getStatus: () => sync.getSyncStatus(),
      async configure(tursoUrl: string, tursoToken: string) {
        const db = getDatabase();
        const now = new Date().toISOString();
        await db.runAsync(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turso_url', ?, ?)",
          [tursoUrl, now]
        );
        await db.runAsync(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turso_token', ?, ?)",
          [tursoToken, now]
        );
      },
    },

    todoistSync: {
      syncNow: async () => ({ skipped: 'mobile', pushed: 0, created: 0, updated: 0, deleted: 0, projects_upserted: 0 }),
      status: async () => ({ enabled: false, connected: false, last_sync_at: null, last_error: null, pending_ops: 0, error_ops: 0, errors: [] }),
      setEnabled: async () => {},
    },
  };
}
