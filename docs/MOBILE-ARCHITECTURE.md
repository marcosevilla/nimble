# Mobile Architecture Plan

> Cross-platform strategy for Nimble: desktop + mobile with synced data.
> Written 2026-04-04. Not a roadmap — a structural blueprint.

---

## Table of Contents

1. [Current Architecture Assessment](#1-current-architecture-assessment)
2. [Cross-Platform Data Sync Strategy](#2-cross-platform-data-sync-strategy)
3. [Desktop Structural Changes Required](#3-desktop-structural-changes-required)
4. [Mobile App Architecture](#4-mobile-app-architecture)
5. [Implementation Phases](#5-implementation-phases)

---

## 1. Current Architecture Assessment

### What exists today

| Layer | Technology | Coupling |
|-------|-----------|----------|
| **Frontend** | React 19 + TypeScript + Tailwind v4 + shadcn/ui | Tightly coupled to Tauri via `invoke()` |
| **Backend** | Rust (Tauri 2.0) — 65 commands across 20 modules | Tightly coupled to Tauri's `AppHandle` + state management |
| **Database** | SQLite via sqlx — 18 tables, 13 migrations | Portable (vanilla SQL, no Tauri-specific queries) |
| **State** | 7 Zustand stores + 10 custom hooks | Mixed — some stores call Tauri directly |
| **External APIs** | Todoist REST, Anthropic Claude, iCal feeds | All called from Rust, not frontend |
| **File I/O** | Obsidian vault reads/writes via tokio::fs | Desktop-only (assumes local filesystem) |

### Portability scorecard

**Highly portable (use as-is):**
- SQLite schema + migrations — vanilla SQL, works on any SQLite runtime
- TypeScript types (`LocalTask`, `Project`, `Capture`, `Goal`, etc.) — reusable
- Business logic concepts — status workflow, capture routing, focus timer, activity logging
- External API integrations — Todoist, Claude, iCal parsing (protocol-level, not platform-bound)

**Portable with extraction work:**
- Rust command logic — the actual SQL queries + business rules inside each command are clean, but they're wrapped in `#[tauri::command]` and receive `AppHandle` for state access. Extractable into a standalone library crate.
- Data fetching hooks (`useLocalTasks`, `useTodoist`, `useCalendar`) — the patterns are reusable, but they call `invoke()` directly. Need an abstraction layer.
- Zustand stores — the state shapes are portable, but `focusStore` and `layoutStore` call Tauri inline. Need decoupling.

**Not portable (desktop-only):**
- System tray, global shortcuts (`Cmd+Shift+T`), window-state persistence, autostart
- Obsidian vault filesystem access (iOS is sandboxed — no arbitrary FS reads)
- `@dnd-kit` drag-to-reorder (needs touch-specific DnD on mobile)
- 3-column layout (NavSidebar + content + RightSidebar) — needs mobile-specific navigation
- Keyboard-first shortcuts (1-6 page nav, j/k task nav, `q` quick create)
- Tiptap rich text editor (heavy for mobile, may need lighter alternative)

### Key architectural coupling points

```
┌─────────────────────────────────────────────────────────┐
│  React Frontend                                         │
│  ┌──────────────────────────────────────────────┐       │
│  │  services/tauri.ts  ← SINGLE CHOKEPOINT     │       │
│  │  (65 invoke wrappers + all TypeScript types) │       │
│  └──────────────────┬───────────────────────────┘       │
│                     │ invoke()                           │
├─────────────────────┼───────────────────────────────────┤
│  Tauri Bridge       │                                   │
├─────────────────────┼───────────────────────────────────┤
│  Rust Backend       │                                   │
│  ┌──────────────────┴───────────────────────────┐       │
│  │  commands/*.rs  ← THIN WRAPPERS              │       │
│  │  (get AppHandle → extract pool → run query)  │       │
│  └──────────────────┬───────────────────────────┘       │
│                     │ sqlx                               │
│  ┌──────────────────┴───────────────────────────┐       │
│  │  SQLite (nimble.db)                    │       │
│  └──────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

**The good news:** The coupling is concentrated in two thin layers:
1. `services/tauri.ts` on the frontend (all 65 invoke calls in one file)
2. `#[tauri::command]` wrappers in Rust (each is a ~5-line function that extracts state and calls logic)

This means the extraction work is well-scoped, not a rewrite.

---

## 2. Cross-Platform Data Sync Strategy

### The problem

Nimble is local-first: one SQLite database per device, no cloud. To work across laptop + phone + second laptop, we need a sync layer that:

1. Works offline (full local DB, sync when connected)
2. Handles the single-user, multi-device case (not multi-tenant)
3. Doesn't require running a server 24/7 (this is a personal app)
4. Preserves the local-first philosophy (cloud is a transport layer, not the source of truth)
5. Integrates with both Rust (desktop) and TypeScript (mobile) SQLite runtimes

### Options evaluated

| Approach | Pros | Cons | Maturity |
|----------|------|------|----------|
| **cr-sqlite (CRDTs)** | Automatic conflict resolution, offline-first by design | ~2.5x write overhead, not production-ready, Rust integration unclear | Experimental |
| **PowerSync** | Full bidirectional sync, production-ready, Postgres backend | Commercial dependency, requires hosted Postgres, overkill for single-user | Production |
| **Turso embedded replicas** | libSQL (SQLite-compatible), hosted + local replicas, Rust SDK | Primary-replica model (not true multi-writer), reads are local but writes go to cloud | Production |
| **ElectricSQL** | Postgres → client SQLite streaming, open source | Read-path only — writes go through your own API, not bidirectional sync | Active dev |
| **Obsidian Sync (JSON files)** | Already in buildplan, zero new infrastructure | Fragile for structured data, no conflict resolution, file-level not row-level | N/A |
| **Custom sync protocol** | Full control, no dependencies, matches existing schema | Must build + maintain, but scope is small for single-user | N/A |

### Recommended approach: Custom sync with Turso as the cloud layer

For a single-user personal app, the sync problem is dramatically simpler than the general case. We don't need CRDTs or commercial sync frameworks. We need:

**A change log + a cloud rendezvous point + last-write-wins.**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Desktop 1   │     │  Turso Cloud │     │   iPhone     │
│  (SQLite)    │◄───►│  (libSQL)    │◄───►│  (SQLite)    │
│              │     │              │     │              │
│  sync_log ───┼────►│  sync_log    │◄────┼── sync_log   │
│  local data  │◄────┤  merged data │────►│  local data  │
└──────────────┘     └──────────────┘     └──────────────┘
```

#### How it works

**1. Sync log table (added to each device's SQLite):**
```sql
CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,           -- UUID
  table_name TEXT NOT NULL,      -- 'local_tasks', 'projects', etc.
  row_id TEXT NOT NULL,          -- PK of the changed row
  operation TEXT NOT NULL,       -- 'INSERT', 'UPDATE', 'DELETE'
  changed_columns TEXT,          -- JSON array of changed column names (for UPDATE)
  snapshot TEXT,                 -- JSON snapshot of the full row at time of change
  device_id TEXT NOT NULL,       -- UUID assigned per device
  timestamp TEXT NOT NULL,       -- ISO 8601 with milliseconds
  synced INTEGER DEFAULT 0       -- 0 = pending, 1 = pushed to cloud
);
```

**2. On every local mutation** (create/update/delete task, project, capture, etc.):
- Write to the local table as normal
- Append a `sync_log` entry with the operation + full row snapshot + device timestamp

**3. Sync cycle** (triggered on app open, on network reconnect, or manually):
- **Push:** Send all `sync_log` entries where `synced = 0` to Turso cloud
- **Pull:** Fetch all `sync_log` entries from cloud where `timestamp > last_pull_timestamp` AND `device_id != this_device`
- **Apply:** For each pulled entry, apply the operation to the local database
  - **Conflict resolution:** Last-write-wins by timestamp. If local has a newer change for the same `(table_name, row_id)`, skip the incoming change.
- **Mark synced:** Set `synced = 1` for all pushed entries
- **Update cursor:** Store `last_pull_timestamp` in `settings` table

**4. Turso cloud database:**
- Hosted libSQL instance (free tier: 9GB storage, 500 databases)
- Mirrors the full schema (same 18 tables + `sync_log`)
- Acts as the merge point — all devices push/pull through it
- Not the source of truth — each device's local SQLite is authoritative for its own changes

#### Which tables sync

| Table | Syncs? | Notes |
|-------|--------|-------|
| `local_tasks` | Yes | Core data |
| `projects` | Yes | Core data |
| `captures` | Yes | Core data |
| `goals` | Yes | Core data |
| `milestones` | Yes | Core data |
| `habits` | Yes | Core data |
| `habit_logs` | Yes | Core data |
| `daily_state` | Yes | Energy, priorities, review state |
| `activity_log` | Yes | Valuable for cross-device timeline |
| `documents` | Yes | But Tiptap content may be large — consider size limits |
| `doc_folders` | Yes | Core data |
| `doc_notes` | Yes | Core data |
| `capture_routes` | Yes | User config |
| `life_areas` | Yes | Core data |
| `settings` | Selective | Sync API keys + user prefs. Skip device-specific settings (nav order, sidebar widths) |
| `todoist_tasks` | No | Cache — each device fetches fresh |
| `calendar_events` | No | Cache — each device fetches fresh |
| `calendar_feeds` | Yes | User config (which calendars to show) |
| `progress_snapshots` | No | Legacy, device-specific |

#### Why this works for us

- **Single user** — no multi-writer conflicts beyond "same person, different devices." LWW is perfectly adequate.
- **Low write volume** — a personal productivity app generates maybe 50-100 mutations per day. No performance concerns.
- **Turso free tier** — 9GB storage, 500M rows read/month. We'll use <1% of this.
- **Offline-first** — full local DB on each device. Sync is additive, not required for the app to work.
- **No new server to run** — Turso is managed. The sync logic lives in the app.
- **Same schema everywhere** — Turso speaks SQLite. No ORM translation, no schema mismatches.

#### Authentication

Since this is a single-user app, auth can be simple:
- Generate a `device_id` (UUID) on first launch, stored in `settings`
- Turso auth token stored in `settings` (one token, one user)
- If we ever need multi-user: add a `user_id` column to `sync_log` and use Turso's auth tokens per user

---

## 3. Desktop Structural Changes Required

These changes prepare the desktop codebase for cross-platform without breaking any existing functionality. Order matters — each change builds on the previous.

### Change 1: Extract Rust core into a library crate

**What:** Move all business logic out of the Tauri command layer into a standalone `nimble-core` Rust library crate.

**Why:** The library crate can be:
- Used by Tauri desktop (current)
- Compiled to a shared library for React Native via UniFFI (future)
- Used in a CLI tool for scripting/automation (bonus)
- Unit tested without Tauri runtime

**Current structure:**
```
src-tauri/
├── src/
│   ├── lib.rs           (Tauri setup + all command registration)
│   ├── commands/
│   │   ├── mod.rs
│   │   ├── local_tasks.rs   (#[tauri::command] + SQL queries mixed)
│   │   ├── projects.rs
│   │   └── ...
│   ├── db/
│   │   └── migrations.rs
│   └── parsers/
```

**Target structure:**
```
src-tauri/
├── src/
│   ├── lib.rs           (Tauri setup + thin command wrappers only)
│   └── commands/        (each fn: extract pool → call core → return)

nimble-core/       (NEW — standalone Rust crate)
├── Cargo.toml
├── src/
│   ├── lib.rs
│   ├── db/
│   │   ├── migrations.rs
│   │   ├── tasks.rs     (pure async fns: &SqlitePool → Result<T>)
│   │   ├── projects.rs
│   │   ├── captures.rs
│   │   ├── goals.rs
│   │   ├── habits.rs
│   │   ├── docs.rs
│   │   ├── activity.rs
│   │   ├── settings.rs
│   │   └── sync.rs      (NEW — sync protocol logic)
│   ├── api/
│   │   ├── todoist.rs
│   │   ├── anthropic.rs
│   │   └── calendar.rs
│   ├── parsers/
│   │   ├── ical.rs
│   │   └── markdown.rs
│   └── types.rs         (all domain types: Task, Project, Capture, etc.)
```

**How the Tauri commands change:**

Before:
```rust
#[tauri::command]
pub async fn get_local_tasks(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<Vec<LocalTask>, String> {
    let pool = app.state::<SqlitePool>();
    // 20 lines of SQL query + mapping
}
```

After:
```rust
#[tauri::command]
pub async fn get_local_tasks(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<Vec<LocalTask>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::get_tasks(&pool, project_id)
        .await
        .map_err(|e| e.to_string())
}
```

**Effort:** ~4-6 hours. Mechanical extraction — no logic changes.

### Change 2: Create a frontend data access abstraction

**What:** Replace direct `invoke()` calls with a `DataProvider` interface that can be implemented by Tauri (desktop) or HTTP/SQLite (mobile).

**Why:** The React frontend currently calls `invoke('get_local_tasks', { projectId })` directly. On mobile, there's no Tauri — we need the same components to work against a different data backend (expo-sqlite, or a REST API, or the shared Rust core via FFI).

**Current:**
```typescript
// services/tauri.ts
import { invoke } from '@tauri-apps/api/core'

export async function getLocalTasks(projectId?: string): Promise<LocalTask[]> {
  return invoke<LocalTask[]>('get_local_tasks', { projectId })
}
```

**Target:**
```typescript
// services/data-provider.ts (NEW — interface)
export interface DataProvider {
  tasks: {
    list(projectId?: string): Promise<LocalTask[]>
    create(task: CreateTaskInput): Promise<LocalTask>
    update(id: string, updates: Partial<LocalTask>): Promise<LocalTask>
    updateStatus(id: string, status: TaskStatus): Promise<void>
    delete(id: string): Promise<void>
    reorder(taskIds: string[]): Promise<void>
  }
  projects: {
    list(): Promise<Project[]>
    create(name: string, color: string): Promise<Project>
    // ...
  }
  captures: { /* ... */ }
  goals: { /* ... */ }
  habits: { /* ... */ }
  calendar: { /* ... */ }
  settings: { /* ... */ }
  sync: {
    push(): Promise<void>
    pull(): Promise<void>
    getStatus(): Promise<SyncStatus>
  }
}

// services/tauri-provider.ts (desktop implementation)
export const tauriProvider: DataProvider = {
  tasks: {
    list: (projectId) => invoke('get_local_tasks', { projectId }),
    create: (task) => invoke('create_local_task', task),
    // ...
  },
  // ...
}

// services/sqlite-provider.ts (mobile implementation — future)
export const sqliteProvider: DataProvider = {
  tasks: {
    list: (projectId) => db.getAllAsync('SELECT * FROM local_tasks WHERE ...', [projectId]),
    // ...
  },
  // ...
}
```

**How components change:**
```typescript
// Before
import { getLocalTasks } from '@/services/tauri'

// After
import { useDataProvider } from '@/services/provider-context'
const dp = useDataProvider()
const tasks = await dp.tasks.list(projectId)
```

**Effort:** ~3-4 hours. Mostly mechanical — extract the interface from existing tauri.ts, create the Tauri implementation, wrap in React context.

### Change 3: Decouple stores from Tauri

**What:** Remove direct `invoke()` calls from Zustand stores. Stores should call through the `DataProvider` or receive data from hooks.

**Affected stores:**
- `focusStore` — calls `startFocusSession()`, `endFocusSession()`, `updateTaskStatus()` directly
- `layoutStore` — calls `getSetting()`, `setSetting()` for nav order
- `goalsStore` — calls multiple Tauri commands in `loadGoals()`, `loadHabits()`
- `docsStore` — calls Tauri commands in `loadFolders()`, `selectDoc()`

**Effort:** ~2 hours. Move Tauri calls to hook layer, stores become pure state containers.

### Change 4: Add the sync_log table + mutation tracking

**What:** Add migration v14 that creates the `sync_log` table and a `device_id` setting. Modify the Rust core's mutation functions to append sync_log entries.

**Why:** This is the foundation for sync. Even before the mobile app exists, the desktop app starts logging changes, which means sync history is available from day one.

**Effort:** ~3-4 hours. New migration + modify ~15 mutation functions to append log entries.

### Change 5: Extract shared types into a TypeScript package

**What:** Move all TypeScript interfaces from `services/tauri.ts` into a `@nimble/types` package (or a `shared/types.ts` file in a monorepo).

**Why:** Both the desktop React app and the future mobile React Native app need the same type definitions.

**Current:** All types live in `services/tauri.ts` alongside invoke wrappers.

**Target monorepo structure:**
```
nimble/
├── apps/
│   ├── desktop/          (current Tauri app, moved here)
│   └── mobile/           (future React Native app)
├── packages/
│   ├── types/            (shared TypeScript types)
│   ├── core/             (shared business logic — optional, for TypeScript-only sync)
│   └── ui/               (shared component logic — future, if converging UI)
├── nimble-core/    (Rust crate — shared backend logic)
├── package.json          (workspace root)
└── turbo.json            (or pnpm workspace config)
```

**Effort:** ~2 hours. Mostly file moves + import updates.

### Summary of desktop changes

| Change | Effort | Priority | Blocks mobile? |
|--------|--------|----------|---------------|
| 1. Extract Rust core crate | 4-6h | High | Yes — mobile Rust FFI needs this |
| 2. Frontend DataProvider abstraction | 3-4h | High | Yes — mobile components need this |
| 3. Decouple stores from Tauri | 2h | Medium | Partially — mobile stores can't call invoke() |
| 4. Add sync_log + mutation tracking | 3-4h | High | Yes — sync requires this |
| 5. Extract shared types package | 2h | Medium | Yes — mobile needs shared types |

**Total structural prep: ~14-18 hours across 3-4 sessions.**

---

## 4. Mobile App Architecture

### Platform choice: React Native (Expo)

**Decision: Expo/React Native, not Tauri Mobile.**

| Factor | Tauri Mobile | React Native (Expo) |
|--------|-------------|-------------------|
| **Maturity** | Beta-quality, few production apps | Battle-tested, millions of production apps |
| **iOS DX** | Requires manual Xcode wrangling | `expo run:ios` or EAS Build |
| **SQLite** | sqlx via Rust (works) | expo-sqlite (JSI, fast, well-documented) |
| **UI components** | Reuse web shadcn (in webview) | Gluestack UI (shadcn for RN) + NativeWind |
| **Native feel** | WebView — feels like a web app | Native components — feels like an iOS app |
| **Hot reload** | Tauri mobile HMR is limited | Expo Fast Refresh (excellent) |
| **OTA updates** | None | EAS Update (push JS updates without App Store) |
| **Keyboard shortcuts** | N/A on mobile | N/A on mobile |
| **Background tasks** | Limited | expo-background-fetch, expo-task-manager |
| **Notifications** | Plugin exists but limited | expo-notifications (mature) |

Tauri mobile would let us reuse the existing React frontend in a webview, but it would still feel like a web app. For a personal productivity tool you use 20+ times a day, native feel matters.

### Mobile tech stack

```
React Native (Expo managed workflow)
├── UI: Gluestack UI v3 + NativeWind (Tailwind CSS for RN)
├── State: Zustand (same stores, decoupled from Tauri)
├── Database: expo-sqlite (local SQLite)
├── Navigation: expo-router (file-based routing)
├── Types: @nimble/types (shared package)
├── Sync: Custom sync module (TypeScript, talks to Turso)
└── Notifications: expo-notifications
```

### Mobile-specific UX adaptations

| Desktop Pattern | Mobile Adaptation |
|----------------|-------------------|
| 3-column layout (nav + content + sidebar) | Bottom tab bar + full-screen pages + sheet modals |
| Keyboard shortcuts (1-6, j/k, q, Escape) | Touch gestures + swipe actions |
| Right sidebar (calendar, detail) | Bottom sheet or separate tab |
| Drag-to-reorder (@dnd-kit) | react-native-reanimated + gesture handler |
| Command bar (Cmd+K) | Search bar at top of relevant pages |
| Focus timer (full-screen takeover) | Persistent notification + lock-screen widget (future) |
| Tiptap rich text editor | Simplified markdown editor or react-native-pell-rich-editor |
| System tray + global shortcut | Home screen widget (future) |

### Mobile feature scope (v1 — ship fast)

**In scope:**
- Today page (daily review: energy, priorities, calendar glance, task list)
- Task management (view, create, complete, status changes)
- Quick capture (+ capture routing)
- Habit logging (tap to log, view momentum)
- Sync (push/pull with Turso)
- Settings (API keys, sync config)

**Out of scope for v1:**
- Docs/editor (too heavy for mobile v1)
- Goals page (view-only is fine, full CRUD later)
- Focus timer (needs background task architecture)
- Session/activity log (low-value on mobile)
- Obsidian vault access (not available on iOS)

### Mobile data layer

On mobile, there's no Rust backend. The `DataProvider` interface is implemented directly against `expo-sqlite`:

```typescript
// apps/mobile/services/sqlite-provider.ts
import * as SQLite from 'expo-sqlite'

export function createSqliteProvider(db: SQLite.SQLiteDatabase): DataProvider {
  return {
    tasks: {
      list: async (projectId) => {
        const query = projectId
          ? 'SELECT * FROM local_tasks WHERE project_id = ? ORDER BY position'
          : 'SELECT * FROM local_tasks ORDER BY position'
        return db.getAllAsync<LocalTask>(query, projectId ? [projectId] : [])
      },
      create: async (input) => {
        const id = uuid()
        await db.runAsync(
          'INSERT INTO local_tasks (id, content, project_id, ...) VALUES (?, ?, ?, ...)',
          [id, input.content, input.projectId ?? 'inbox', ...]
        )
        // Append to sync_log
        await appendSyncLog(db, 'local_tasks', id, 'INSERT', row)
        return row
      },
      // ...
    },
  }
}
```

This mirrors the Rust backend's SQL queries but in TypeScript. The shared types package ensures both implementations produce the same shapes.

---

## 5. Implementation Phases

### Phase 0: Desktop structural prep (3-4 sessions)

> Goal: Make the desktop codebase mobile-ready without breaking anything.

**Session 0a:** Extract Rust core crate
- Create `nimble-core/` workspace member
- Move all db/, parsers/, types from `src-tauri/src/` to core crate
- Tauri commands become thin wrappers calling core functions
- Verify: `npm run tauri dev` still works identically

**Session 0b:** Frontend DataProvider + store decoupling
- Define `DataProvider` interface from existing tauri.ts signatures
- Create `TauriProvider` implementation
- Wrap in React context, update hooks to use provider
- Decouple focusStore, goalsStore, docsStore from direct invoke calls
- Verify: app works identically

**Session 0c:** Sync foundation
- Add migration v14: `sync_log` table + `device_id` setting
- Modify core crate mutation functions to append sync_log entries
- Add Turso client to core crate (libsql-client)
- Implement `sync::push()` and `sync::pull()` in core
- Add sync status indicator to desktop Settings page
- Verify: mutations create sync_log entries, push/pull works with Turso

**Session 0d:** Monorepo + shared types
- Restructure into workspace: `apps/desktop/`, `packages/types/`
- Extract TypeScript types into shared package
- Update all imports
- Verify: builds and runs correctly

### Phase 1: Mobile app scaffold (2-3 sessions)

> Goal: Working mobile app that reads from local SQLite (no sync yet).

**Session 1a:** Project setup
- `npx create-expo-app apps/mobile`
- Configure: NativeWind, Gluestack UI, expo-sqlite, expo-router
- Import `@nimble/types`
- Create SQLite database with same schema (run migrations)
- Implement `SqliteProvider` for core tables (tasks, projects, captures)

**Session 1b:** Core pages
- Bottom tab navigation (Today, Tasks, Inbox, Settings)
- Today page: greeting, energy selector, task list
- Tasks page: project list + task list with status indicators
- Inbox page: capture list + quick capture input
- All reading from local SQLite

**Session 1c:** Mutations + interactions
- Create/complete/update tasks
- Quick capture with routing
- Habit logging
- All mutations append to sync_log

### Phase 2: Sync integration (1-2 sessions)

> Goal: Desktop and mobile stay in sync via Turso.

**Session 2a:** Mobile sync
- Port sync protocol to TypeScript (or call Rust core via UniFFI)
- Implement push/pull cycle on app open + periodic background
- Add sync status to Settings page
- Test: create task on desktop → appears on mobile, and vice versa

**Session 2b:** Conflict handling + polish
- Handle edge cases: offline queue, retry logic, conflict resolution
- Add last-synced indicator
- Background sync via expo-background-fetch (if feasible)

### Phase 3: Mobile polish (ongoing)

> Ship v1, iterate based on actual usage.

- Notifications (reminders, evening review nudge)
- Focus timer with background persistence
- Goals page (read-only view of goals + milestones)
- Home screen widget (today's top 3 priorities)
- Haptic feedback on interactions
- Swipe actions (complete, snooze, delete)

---

## Appendix: Technology references

| Technology | Purpose | Link/Notes |
|-----------|---------|------------|
| **Expo** | React Native framework | Managed workflow, EAS Build, OTA updates |
| **expo-sqlite** | Local SQLite on mobile | JSI-based, synchronous reads, Drizzle-compatible |
| **Gluestack UI v3** | shadcn equivalent for React Native | Copy-paste components, NativeWind styling |
| **NativeWind** | Tailwind CSS for React Native | Same utility classes as web Tailwind |
| **Turso** | Hosted libSQL (SQLite-compatible) | Free tier: 9GB storage, 500 databases |
| **UniFFI** | Rust → React Native FFI bridge | Mozilla project, generates Turbo Module bindings |
| **expo-router** | File-based routing for RN | Similar to Next.js App Router |
| **expo-background-fetch** | Background task scheduling | For periodic sync |

## Appendix: Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sync conflicts corrupt data | High | LWW is safe for single-user; add `sync_log` as audit trail for manual recovery |
| Turso free tier limits hit | Low | 500M reads/month is massive for 1 user; upgrade path is $29/mo |
| expo-sqlite schema drift from desktop | Medium | Share migration SQL as a package; run same migrations on both platforms |
| UniFFI React Native bindings are immature | Medium | Phase 1-2 don't need UniFFI; mobile uses TypeScript-only data layer. UniFFI is Phase 3+ optimization |
| Gluestack UI doesn't match shadcn look | Low | Both are Tailwind-based; visual convergence is achievable. Design polish is out of scope for structural work |
