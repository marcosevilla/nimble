# Web Client — Architecture Decision

**Date:** 2026-08-14
**Question:** How do we add a browser-based Nimble client without ending up maintaining two copies of the same UI?
**Sources:** Full read of `nimble-core/src/db/sync.rs`, `apps/mobile/services/{sync,sync-utils,turso,sqlite-provider}.ts`, `apps/desktop/src/{main.tsx,services/*}`, plus a file-by-file sweep of all 138 files in `apps/desktop/src` and all 26 Tauri command modules. Verified against code at schema v19, not against project memory.

---

## Plain-language summary

You can have a web version of Nimble without rebuilding it. The React app you already have is a normal website — it runs in a browser today, which is how the design-audit screenshots get taken. Tauri just wraps it in a Mac window.

Only 18 of your 138 frontend files touch anything Mac-specific, and most are one-line fixes. There's already a clean seam: a single "where does data come from" switch, set in one file, in three lines. Desktop points it at Rust. Mobile points it at the phone's database. Web would point it at your cloud database.

**So: one codebase, built twice.** Same files, two build commands. When you redesign a task row, both versions change, because there is only one task row. No copying, no drift.

The parts that stay Mac-only are the ones touching your actual hard drive — reading your Obsidian folder, and the ⌥⌘Space capture bar. Everything else can travel.

Be strict about scope. Web v1 is tasks and capture on your phone. Not Today, not Goals, not Focus. That restraint is the plan.

---

## 1. Things I found that contradict the working assumptions

Read this section first — three of these change decisions.

### 1.1 The "Mac-only forever" list is wrong on 3 of its 4 items

The assumption was that AI priorities, Todoist two-way sync, calendar ICS parsing, and vault indexing are all permanently Mac-bound because they're written in Rust. Only the last one is actually true.

| Capability | Where | Actually requires | Verdict |
|---|---|---|---|
| AI priorities / task breakdown | `nimble-core/src/api/anthropic.rs` — **162 lines, zero tests** | A network call and a secret API key. No filesystem, no timer. The frontend already passes the calendar/task/note summaries in **as plain strings** — Rust gathers nothing. | **Not Mac-bound.** It is one `POST` to `api.anthropic.com` with a prompt template. It can't run in a *browser* only because the key would leak — which is exactly what a serverless function is for. |
| Todoist two-way sync | `nimble-core/src/integrations/todoist/*` — ~1,850 production lines | Network, a token, a scheduler. **No filesystem.** The 5-minute timer isn't even in `nimble-core` — it's a `tokio::interval` in `apps/desktop/src-tauri/src/lib.rs`. | **Not Mac-bound**, but genuinely expensive to move (the outbox coalescing and three-way merge are the subtlest logic in the codebase). Stays on the Mac because of *effort*, not capability. |
| Calendar ICS parsing | `nimble-core/src/parsers/ical.rs` (149 lines) + `api/calendar.rs` (237 lines) | **Nothing on disk.** Feeds are URLs in the `calendar_feeds` table; the code does `client.get(url)` then hands the response *string* to the parser. The parser is shallow — no RRULE expansion, no timezone handling. | **Not Mac-bound.** The premise that ICS files live on your hard drive is false. The only browser obstacle is CORS, which a proxy solves. |
| Obsidian vault indexing | `nimble-core/src/vault/*` — ~1,270 production lines | `walkdir` over an absolute path, blake3 hashing, a permanent `notify` watcher thread, atomic file writes with `.conflict` sidecars, and **genuinely macOS-specific code** (`SF_DATALESS` via `st_flags()` to skip iCloud placeholder files). | **Confirmed Mac-bound** — but only the *scan / watch / write* half (~640 lines). The *index* half (`vault/index.rs`) is just SQLite rows that already replicate to Turso, so a web client can read and search the vault fine. |

**Why this matters:** it means Path B (the Rust HTTP server) is a smaller and more attractive future step than assumed. The real moat is ~640 lines of vault filesystem code, not 16,000 lines of Rust.

### 1.2 There is a latent data-loss bug in the mobile sync client — do not copy it

`nimble-core` always writes a **full-row** snapshot into `sync_log`: it re-`SELECT`s all 22 columns and serializes them (`sync::task_sync_snapshot`, `db/tasks.rs:82-84`).

The mobile client does not. Three methods in `apps/mobile/services/sqlite-provider.ts` write **partial** snapshots:

- `updateStatus` (line 386), `complete` (line 404), `uncomplete` (line ~422) — each sends a 5-key snapshot: `{id, status, completed, completed_at, updated_at}`.

The receiving side applies snapshots with `INSERT OR REPLACE` (`sync.rs:1228`, mirrored in mobile `sync.ts:172`). In SQLite, `INSERT OR REPLACE` **deletes the existing row and inserts a new one** — every column absent from the snapshot reverts to its default or `NULL`.

So completing a task on the phone should blank that task's `content`, `project_id`, `priority`, `due_date`, `description`, `labels` and everything else on the Mac and on Turso. It has likely gone unnoticed because mobile sync has barely been exercised (memory notes the first simulator run on 2026-08-06 had nothing pending).

**This is the single most important rule for the web client** and it's written up formally in §3. It's also worth a separate bug ticket for mobile — it is not caused by the web work and shouldn't be bundled into it.

### 1.3 Row timestamps are already inconsistent between Rust and TypeScript

Two different string formats are being written into the same columns:

- **Rust** relies on SQLite's `datetime('now')` → `2026-08-14 12:34:56` (space separator, no `Z`, no milliseconds)
- **Mobile TS** uses `new Date().toISOString()` → `2026-08-14T12:34:56.789Z`

Since these are `TEXT` columns compared lexicographically, a space (`0x20`) sorts before `T` (`0x54`) — so *every* Rust-written `updated_at` sorts before *every* mobile-written one, regardless of actual time. Anything that orders by `updated_at` across both clients is wrong.

Good news: `sync_log.timestamp` is **not** affected. Rust formats it explicitly as `%Y-%m-%dT%H:%M:%S%.3fZ` (`sync.rs:54`) and mobile uses `toISOString()` — both ISO-with-`T`, so the sync protocol's own ordering is sound. The bug is confined to row-level `created_at` / `updated_at`.

The web client must pick a side. Recommendation in §3.

### 1.4 The `DataProvider` interface has already drifted into two copies

`apps/desktop/src/services/data-provider.ts` is 392 lines. `apps/mobile/services/data-provider.ts` is 313 lines. They are meant to be the same interface. They are not:

- Desktop has `todoist` and `vault` domains; mobile doesn't.
- **Mobile has a `labels` domain; desktop doesn't** — and that's why 6 of the 9 desktop files still importing `@/services/tauri` are importing `listLabels`/`listSections`. Desktop's label UI bypasses the abstraction *because the abstraction was never extended*, while mobile went ahead and extended its own copy.

This is the copy-drift failure mode, already happening, in this repo, after about four months. It is the strongest available argument against any option that creates a third copy.

### 1.5 Smaller corrections

- **`nimble/CLAUDE.md` is stale.** It says "26 desktop UI components still call invoke wrappers directly." The real number is **9** (verified by grep; a naive grep returns 10 but the 10th is `main.tsx` importing `tauri-provider`, a different module). The context brief's figure of 9 is correct; the checked-in CLAUDE.md is not. Its "Current State" block is also dated 2026-04-16.
- **The `settings` table does not sync**, despite `initialize_remote` creating it on Turso. `settings` is absent from the `ALLOWED` list in `sanitize_table_name` (`sync.rs:1264-1286`), so settings mutations produce no data mutation on push and are rejected on pull. Mobile nonetheless writes `sync_log` rows for settings (`sqlite-provider.ts:69`) that can never apply — harmless, but dead weight. Consequence for us: **the web client cannot obtain Turso credentials from a synced settings table.** See §4.
- Command count is **~127** `#[tauri::command]` functions across 26 modules, all registered — not an approximation, they were counted.

---

## 2. The main question: keeping desktop and web UI in sync

> *"If I make UI updates to the desktop app, how do I make sure those updates are reflected in the web version?"*

### 2.1 What the code already looks like

Three facts decide this.

**Fact one — the frontend is already a plain website.** `apps/desktop` builds with an ordinary `vite.config.ts` and `npm run build` (`tsc -b && vite build`). Nothing in it is Tauri-specific. It already runs at `localhost:5173` in a normal browser; that's how the design-audit Playwright loop takes screenshots (`docs/audit-loop-playbook.md`).

**Fact two — the data source is chosen in one place, in three lines.** All of `main.tsx`:

```tsx
const tauriProvider = createTauriProvider()
setDataProvider(tauriProvider)          // for Zustand stores
// ...
<DataProviderRoot provider={tauriProvider}>   // for React hooks
```

That's the entire platform binding. 48 files consume data purely through `useDataProvider()` / `getDataProvider()` and would not notice a swap. *(Reminder of the documented gotcha: `data-provider.ts` is type-only at runtime — runtime access must come from `@/services/provider-context`. `main.tsx` already does this correctly.)*

**Fact three — contamination is 13%.** Of 138 `.ts`/`.tsx` files in `apps/desktop/src`, **18 touch something a browser lacks**. Two of those (`tauri.ts`, `tauri-provider.ts`) *are* the intended swap point, so real application-code leakage is **16 files (11.6%)**.

| What | Files | Sites | How hard |
|---|---|---|---|
| `@tauri-apps/api/event` (`listen`/`emit`) | 5 | 7 | **Trivial.** Every call site is the same `const unlisten = listen(...)` shape. A stub returning `Promise<() => {}>` satisfies all of them. |
| `@tauri-apps/api/core` (`invoke`) | 1 (`services/tauri.ts`) | 1 | **Trivial** — this file is excluded from the web build. |
| `@tauri-apps/api/window` | 1 (`CaptureStrip.tsx`) | 1 | **Absent on web** — the only window call in the whole frontend, and it's inside the capture strip. |
| `@/services/tauri` direct imports | 9 | 9 | **Trivial.** 8 of 9 are just `listLabels` / `listSections` / `getSetting` — reads that belong on `DataProvider` anyway. The 9th is `dismissCaptureStrip`. |
| `data-tauri-drag-region` | 2 | 2 | **Free.** It's an inert HTML attribute in a browser. Zero changes. (A third grep hit in `TaskListHeader.tsx:204` is inside a comment.) |
| Capture window | 1 branch + 1 component | — | **Absent on web.** `main.tsx` branches on `?window=capture`; drop the branch. |
| Filesystem / dialogs / shell | **0** | 0 | Already behind `DataProvider`. `openUrl` is `dp.system.openUrl()` at both call sites; web impl is `window.open()`. No file pickers exist. |
| Native menus / tray / global shortcuts | **0** | 0 | All Rust-side in `src-tauri/`. The frontend only *receives* one event (`open-quick-capture`). |
| `window.__TAURI__`, Node builtins, `process.env` | **0** | 0 | No platform sniffing anywhere. Only `import.meta.env.DEV`, which works identically on Vercel. |

Everything else — `localStorage`, `navigator.clipboard`, `AudioContext`, `matchMedia`, and an existing **plain DOM `CustomEvent` bus** (`emitTasksChanged`) — is standard browser API and ports untouched.

### 2.2 The three options

**Option A — one codebase, two build targets.** Same `src/`, two Vite configs, two entry files. The only difference is which `DataProvider` gets constructed.

- ✅ A UI change is reflected in web *by definition* — there is one component tree. This is the only option where the answer to Marco's question is "you don't have to do anything."
- ✅ Exploits the 87%-portable reality instead of fighting it.
- ✅ Reversible. If it stops being worth it, delete one Vite config.
- ⚠️ Requires discipline that desktop-only features stay behind the provider seam or a flag. The seam already exists and is already honoured by 48 files.
- ⚠️ Web ships some dead code (`CaptureStrip`, `tauri.ts`) unless excluded. Bundle cost, not correctness — and aliasing handles it.

**Option B — extract a shared `packages/ui`.** Both a desktop app and a separate web app import shared components.

- ✅ Cleanest on paper. Real forcing function for portability.
- ❌ You'd be moving ~20,000 lines across 102 component files to solve a problem that a Vite alias solves. The shared package would end up containing *almost everything* — at which point it's Option A with extra folders and a build-ordering problem.
- ❌ Component extraction is the kind of week-long refactor that produces no visible change. High avoidance risk, low payoff.
- 🕓 Worth revisiting only if a *third* client appears with genuinely different composition (e.g. folding mobile in). Not now.

**Option C — separate web app that copies components.**

- ❌ **Rejected, and the repo proves why.** `DataProvider` was copied to mobile four months ago; the two copies have since diverged in both directions (§1.4), and that drift is directly responsible for 6 of the 9 remaining `@/services/tauri` imports on desktop. A copy of 102 components would rot faster and more invisibly. For a solo designer/builder this guarantees the web version dies of neglect — the exact failure mode this document exists to prevent.

### 2.3 Recommendation

**Option A — one codebase, two build targets.**

The decisive evidence is that the work is already 87% done and was done deliberately. `data-provider.ts`'s own header comment anticipates a second implementation. `TauriProvider` is pure delegation with no logic. A `TursoProvider` is the same seam used a third time — and mobile already proved the seam works.

**Concretely, what changes:**

1. **New file `apps/desktop/vite.web.config.ts`** — extends the base config and adds aliases:
   ```
   '@tauri-apps/api/event'  →  src/platform/tauri-event-stub.ts
   '@tauri-apps/api/window' →  src/platform/tauri-window-stub.ts
   ```
   This neutralises all 7 `listen`/`emit` sites and the 1 window call **without editing a single one of those 6 files.** That's the trick that makes this cheap. (~1 hour, including writing the two ~10-line stubs.)

2. **New entry `apps/desktop/src/main.web.tsx` + `index.web.html`** — a ~25-line copy of `main.tsx` that builds a `TursoProvider` instead of a `TauriProvider` and drops the `?window=capture` branch. (~1 hour.)

3. **New file `apps/desktop/src/services/turso-provider.ts`** — implements `DataProvider` against Turso over HTTP. This is the actual work; see §5. Modelled on `apps/mobile/services/sqlite-provider.ts` (659 lines) but issuing SQL over the pipeline API rather than to expo-sqlite.

4. **Migrate the 9 stragglers off `@/services/tauri`.** Add `labels` and `sections` domains to the `DataProvider` interface (mobile already has `labels` — copy its shape), then point the 9 files at `useDataProvider()`. Mechanical. (~2 hours.) This is worth doing regardless of the web work — it closes the drift from §1.4.

5. **Guard genuinely desktop-only UI.** A single `isDesktop` constant from `import.meta.env`, used to hide the Obsidian "Open in Obsidian" button (`VaultNoteEditor.tsx:103`) and any settings panes that configure Mac-only integrations. A handful of conditionals, not a system.

6. **Move the `DataProvider` interface into `packages/types`** so desktop, mobile and web import one definition and drift becomes a type error instead of a silent divergence. (~1 hour, plus fixing whatever mobile breaks — which is the point.)

**Total for the shell: roughly one session.** After that every UI change is automatically in both, and the remaining effort is entirely `TursoProvider` breadth — which is bounded by v1 scope, not by the size of the app.

**The one rule that keeps this true:** never `import` from `@tauri-apps/*` or `@/services/tauri` in a component. If a component needs a platform capability, it goes on `DataProvider` and gets an implementation per target. That rule is already 94% followed. An ESLint `no-restricted-imports` rule on `src/components/**` would make it self-enforcing and costs ten minutes.

---

## 3. The sync contract every client must obey

Precise enough to implement against. Sources: `nimble-core/src/db/sync.rs` and `apps/mobile/services/sync.ts`.

### 3.1 The model

There is no server. Turso holds a **full replica of every synced table**, plus the `sync_log` table which acts as the change feed. Each client writes both. Clients discover each other's changes by reading `sync_log` rows whose `device_id` isn't theirs.

### 3.2 The `sync_log` row

| Column | Value |
|---|---|
| `id` | UUID v4 |
| `table_name` | Must be in the allow-list (below) |
| `row_id` | The row's `id`. **Exception:** `task_labels` has no `id` column — its `row_id` is `"<task_id>::<label_id>"` |
| `operation` | `INSERT` \| `UPDATE` \| `DELETE` |
| `changed_columns` | JSON array of column names as a string, e.g. `'["status","updated_at"]'`. Or `NULL`. Advisory only — **nothing reads it** |
| `snapshot` | JSON object of the **complete row**. `NULL` for `DELETE` |
| `device_id` | This client's stable ID. Must differ from every other client's |
| `timestamp` | `YYYY-MM-DDTHH:MM:SS.mmmZ` — exactly `new Date().toISOString()` |
| `synced` | `1` on rows written to Turso |

**Allow-list** (`sync.rs:1264`) — 21 tables. Anything else is silently dropped:

```
local_tasks, projects, captures, goals, milestones, habits, habit_logs,
daily_state, activity_log, documents, doc_folders, doc_notes,
capture_routes, life_areas, calendar_feeds, vault_notes, vault_links,
vault_tags, labels, task_labels, sections
```

Never synced (device-local by design): `settings`, `vault_fts`, `todoist_outbox`, `integration_sync_state`.

### 3.3 The five rules

**Rule 1 — the snapshot must be the complete row.** Receivers apply it as `INSERT OR REPLACE INTO <table> (<snapshot keys>) VALUES (...)`, which deletes and re-inserts the row. Any column you omit is destroyed on every other device. Strip only derived/joined fields that aren't real columns — Rust removes exactly one, `labels` (`sync.rs:18-24`). For `local_tasks` the required 22 keys are `SELECT_COLS` (`db/tasks.rs:62`):

```
id, parent_id, content, description, project_id, priority, due_date,
due_time, duration_minutes, recurrence_rule, section_id, completed,
completed_at, status, linked_doc_id, position, created_at, updated_at,
external_id, external_source, remote_updated_at, synced_snapshot
```

The practical implementation: after any mutation, re-`SELECT` the whole row and serialize *that*. Never hand-build a snapshot from the fields you happened to change. This is the rule mobile breaks (§1.2).

**Rule 2 — a write is two statements, in one pipeline.** For every mutation, send both:
1. the data mutation — `INSERT OR REPLACE INTO <table> (...) VALUES (...)`, or `DELETE FROM <table> WHERE id = ?`
2. the `sync_log` insert — verbatim from `sync.rs:888`:
   ```sql
   INSERT OR IGNORE INTO sync_log
     (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
   ```

Writing only the data row is the failure mode to guard against: Turso would hold the new value, but the desktop's pull filters on `sync_log`, so **the Mac would never learn about it** and would happily overwrite it later.

**Rule 3 — `device_id` must be unique and stable.** Desktop uses a bare UUID v4 (`sync.rs:87`). Mobile uses `mobile-<8 hex>` (`sync-utils.ts:37`). Web should use `web-<8 hex>`, persisted in `localStorage`. If web ever reused the desktop's ID, the desktop's pull filter (`device_id != ?`) would discard every web change silently.

**Rule 4 — `sync_log.timestamp` is ISO-8601-with-`T`, always.** Comparison is lexicographic string comparison in SQL (`WHERE timestamp > ?`). Deviating from the format breaks ordering rather than erroring.

**Rule 5 — decide a row-timestamp convention and write it down.** Per §1.3, `created_at`/`updated_at` are already inconsistent. **Recommendation: the web client follows the Rust convention** — `YYYY-MM-DD HH:MM:SS` in UTC (what SQLite's `datetime('now')` produces) — because the desktop is the dominant writer and the overwhelming majority of existing rows use it. Mobile should be corrected to match, as a separate small fix.

### 3.4 How the desktop picks up a web change

Unchanged from today, which is the point — no Rust changes are needed to support a web client. `pull()` (`sync.rs:1025`) runs:

```sql
SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp
FROM sync_log
WHERE timestamp > :last_pull_timestamp AND device_id != :my_device_id
ORDER BY timestamp ASC
```

For each row it does a last-write-wins check (skip if the local `sync_log` holds a newer entry for the same `table_name`+`row_id`), applies the snapshot, then records the entry locally with `synced = 1` so it never bounces back. It also notifies the Todoist observer and the vault FTS indexer — so **a task completed in the browser propagates to Todoist automatically**, via the Mac, with no web-side Todoist code at all. That's a meaningful free win.

### 3.5 What the web client does *not* need

Because the browser has no local database, the web client is **online-only and reads Turso directly**. That means:

- **No pull logic.** No `last_pull_timestamp`, no LWW resolution, no local `sync_log` bookkeeping. Reads are plain `SELECT`s against Turso's data tables. Polling is just re-running them.
- **No schema migrations.** No third copy of `migrations.rs` to keep in step — which matters, since the existing two copies have already drifted (§1.4).
- **No offline queue.** A browser tab with no network shows an error. Acceptable, and vastly simpler.

**This is a deliberate divergence from the mobile template.** Mobile is offline-first with a local SQLite mirror and a genuine push/pull cycle. Web should not be. Copying mobile's architecture wholesale would triple the work for no benefit. Copy its *Turso wire format* (`turso.ts`, and the `buildTursoMutationStatements` shape), not its *sync model*.

---

## 4. The Turso credential problem

**The problem.** Both existing clients read `turso_url` and `turso_token` from their local `settings` table, where you typed them in. A browser has no trustworthy equivalent: anything the JavaScript can read, anyone who opens devtools can read. And since a Turso token grants full read/write to the whole database, a leak means someone can read and destroy all your data. Note also that `settings` doesn't sync (§1.5), so there's no "just let it replicate" shortcut.

**The recommendation: a thin Vercel serverless proxy, and it fits perfectly.**

`apps/mobile/services/turso.ts` is 82 lines and makes exactly one network call:

```ts
fetch(`${baseUrl}/v2/pipeline`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tursoToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests }),
})
```

That's a single stateless `POST` with a JSON body. No WebSockets, no streaming, no session affinity — each request appends its own `close`, so nothing carries between calls. A proxy is a near-literal pass-through:

- Add `api/turso.ts` on Vercel. It reads `TURSO_URL` and `TURSO_TOKEN` from Vercel environment variables (server-side, never sent to the browser), forwards the request body to `<TURSO_URL>/v2/pipeline` with the `Authorization` header attached, and returns the response verbatim.
- The browser's `tursoPipeline()` becomes `fetch('/api/turso', { method: 'POST', body })` — no token, no URL. Same request and response shapes, so the rest of the client is unchanged.

**Then put a door on it.** The proxy is now an unauthenticated public endpoint that runs arbitrary SQL against your database — strictly worse than shipping the token. It needs auth. Simplest sufficient options, cheapest first:

1. **Vercel Password Protection** (a project setting, no code) — one shared password on the whole deployment. Zero implementation. Adequate for a single-user app on an obscure URL.
2. **A shared secret in an HTTP-only cookie**, set by a tiny `/api/login` route that checks a password against an env var. ~30 lines. Slightly better because it can't be shoulder-surfed from a browser prompt and can be revoked by rotating the env var.
3. **A real auth provider** (Clerk/Auth0) — unnecessary for one user.

**Recommended: start with (1)**, because it is a checkbox and takes zero session time, and move to (2) if the password prompt gets annoying on your phone.

**Worth doing at the same time (~30 min):** have the proxy reject any statement whose table isn't in the 21-table allow-list from §3.2, and reject `DROP`/`ALTER`/`ATTACH`. It doesn't stop a determined attacker who already got past auth, but it does stop a bug in your own web client from wiping a table.

**Not recommended:** Turso's per-database scoped tokens. They'd still be visible in the browser, only with slightly less blast radius. The proxy is barely more work and actually solves it.

---

## 5. v1 scope

The real risk isn't technical, it's an unbounded v1. Being strict here is this section's whole job. The rule: **v1 is what you'd want on your phone, in a hotel lobby, with one hand.**

### IN

| Feature | Why | `DataProvider` domains needed |
|---|---|---|
| **Capture** — text box, saves to `captures`, prefix routing optional | The single highest-value mobile action. Replaces "text myself a reminder." | `captures.create`, `captures.list` |
| **Task list** — Inbox and per-project, filter by due date, mobile-first layout | The core object. | `tasks.list`, `projects.list` |
| **Complete / uncomplete a task** | The second-highest-value mobile action. Propagates to Todoist via the Mac for free (§3.4). | `tasks.complete`, `tasks.uncomplete` |
| **Create a task** — content, project, due date, priority | Capture-with-structure. | `tasks.create` |
| **Edit a task** — content, description, due date, priority, project, labels | Rounds out "actually usable," and reuses the existing detail page. | `tasks.update`, `labels.list`, `sections.list` |
| **Docs + vault notes, read-only** | Nearly free — `documents`, `doc_notes`, `vault_notes` already replicate to Turso, so it's `SELECT` plus a markdown renderer. Deliberately **not** the Tiptap editor. | `docs.getDocuments`, `docs.getDocument`, `vault.listNotes`, `vault.getNote`, `vault.search` |

That's roughly **6 of ~13 `DataProvider` domains and ~25 of ~120 methods** — the bounded number that makes this a few sessions rather than a quarter.

### OUT of v1 (buildable later)

| Feature | Why not now |
|---|---|
| **Today page / guided morning** | Needs AI priorities *and* calendar *and* the daily-review state machine. The single biggest dependency cluster in the app. It's also the feature you most want *at your desk*, which is where the Mac app is. |
| **Goals, Milestones, Life Areas** | 13 commands, a whole page, no mobile urgency. |
| **Focus / Session page** | A timer you'd run on the Mac. |
| **Calendar panel** | Needs a CORS proxy plus feed fetching. Not hard, just not v1. |
| **Habits** | Plausibly nice on a phone, but it's a second data model for a marginal gain. Fast follow if you miss it. |
| **Settings** | Web needs almost none of it. Ship a stub with theme + sign-out only. |
| **Doc / vault editing** | Explicitly out — see below. |
| **Subtask trees, drag reorder, bulk actions** | Desktop-grade interactions. `tasks.reorder` needs `position` rewrites across many rows; skip it. |

### OUT permanently

- **Vault editing from web.** Settled decision, and the code agrees: whole-note writes go through `vault/writer.rs`, which hash-checks against what the app last read and diverts diverged writes to `(conflict <timestamp>).md` files on your actual disk. A web client can't participate in that protocol — the files aren't there. Read-only is the correct ceiling.
- **The ⌥⌘Space capture strip.** A global hotkey, a frameless always-on-top window, and Accessibility-API selection grabbing (`src-tauri/src/selection.rs`). None of it exists in a browser.
- **Native menus, tray icon, autostart, "Open in Obsidian."**

---

## 6. What stays Mac-only, and why

Corrected against the code (see §1.1). Ordered by how permanent the constraint actually is.

**Genuinely impossible anywhere but a Mac — the real moat (~640 production lines):**

- **Vault scanning** (`vault/scanner.rs`) — `walkdir` over your vault path, blake3 hashing, and macOS-specific `SF_DATALESS` checks via `st_flags()` to skip iCloud placeholder files.
- **Vault watching** (`vault/watcher.rs`) — a `notify` debouncer on a permanently-spawned OS thread.
- **Vault writing** (`vault/writer.rs`) — atomic writes with hash-based conflict detection and `.conflict` sidecars.
- **Obsidian file commands** (`src-tauri/src/commands/obsidian.rs`, 7 commands) — `today.md`, daily briefs, session logs, Quick Captures.
- **Capture-strip machinery** — global shortcuts, tray, `NSApplication::deactivate()`, Accessibility selection reading.

The consequence to internalise: **your Mac is the vault's only gateway.** It indexes notes into `vault_notes`, which replicates to Turso, which is why web can *read* your notes. If the Mac is off, the web version's notes go stale. That's fine — it's the correct trade.

**Mac-only by choice, not by constraint — could move to a server later:**

- **Todoist two-way sync** (~1,850 lines). Needs network, a token, and a scheduler — no filesystem. Stays put because porting the outbox coalescing and three-way merge is the biggest single effort item in the codebase, and because §3.4 means web changes already reach Todoist through the Mac for free.
- **AI priorities and task breakdown** (162 lines). Blocked only by the API key. If the Today page ever comes to web, this becomes a ~1-hour Vercel function, not a port. *Do not call the Anthropic API from browser JavaScript* — same key-leak problem as the Turso token, same fix.
- **Calendar fetching** (~390 lines). Blocked only by CORS. Another small serverless function whenever the calendar panel is wanted.
- **Update checking.** Irrelevant on web — the web version updates when you deploy.

**This is the case for keeping Path B on the table.** Once a Vercel proxy exists for Turso, adding an `/api/anthropic` and an `/api/calendar` function is incremental. The moment more than one of those is needed, deploying `nimble-core` as an axum service (Path B) starts to beat maintaining three TypeScript re-implementations — because the Rust already exists and is tested.

---

## 7. Build sequence

Six steps, each independently shippable. "Session" ≈ 2–3 focused hours.

| # | Step | Ships | Effort |
|---|---|---|---|
| **1** | **Clean the seam.** Add `labels` + `sections` to the `DataProvider` interface; migrate the 9 files off `@/services/tauri`; move the interface into `packages/types` so desktop/mobile/web share one definition; add the `no-restricted-imports` ESLint rule. | Nothing user-visible — but zero `@/services/tauri` imports in components, and interface drift becomes a compile error. Valuable on its own. | **1 session** |
| **2** | **Web shell that boots.** `vite.web.config.ts` with the two Tauri stubs; `main.web.tsx` + `index.web.html`; a `TursoProvider` that throws on every method. Deploy to Vercel behind password protection. | A URL that loads Nimble's chrome and fails loudly on data. Proves the build path end to end. | **1 session** |
| **3** | **The proxy + reads.** `api/turso.ts` on Vercel with the token server-side and the table allow-list; a `sql()` helper that decodes pipeline responses into rows; implement the read half of `TursoProvider` — `tasks.list`, `projects.list`, `captures.list`, `labels.list`, `sections.list`. | **First genuinely useful version:** your real tasks, on your phone, read-only. | **1–2 sessions** |
| **4** | **Writes.** A shared `mutate()` helper enforcing §3 — full-row snapshot via read-back, data mutation + `sync_log` insert in one pipeline, `web-` device ID. Then `captures.create`, `tasks.create`, `tasks.complete`/`uncomplete`. Verify round-trip: create on web → appears on Mac → and in Todoist. | **The version you'd actually use daily.** Capture and complete from anywhere. | **1–2 sessions** |
| **5** | **Editing + mobile-first polish.** `tasks.update` (content, description, due date, priority, project, labels), reuse the task detail page, hide desktop-only affordances behind `isDesktop`, touch targets and layout at phone width. | Full task management on the phone. | **1–2 sessions** |
| **6** | **Docs read-only.** `documents` / `doc_notes` / `vault_notes` reads, markdown rendering, vault search over the replicated index. Explicitly no editor. | Your notes, readable anywhere. | **1 session** |

**Total: 6–9 sessions to a web client you'd genuinely use.** Steps 1 and 2 are low-risk and pay off regardless. Step 4 is the one to be careful in — that's where §3's rules bite.

Suggested checkpoint: **stop after step 4 and use it for a week** before committing to 5 and 6. If capture-and-complete turns out to be all you want on a phone, that's a legitimate finished product and the remaining sessions are better spent elsewhere.

---

## 8. Open decisions

Four things the code can't settle.

**1. Should the web client be online-only, or keep a local mirror in the browser?**
I've recommended online-only throughout (§3.5) — no local database, no pull logic, no third schema copy. The alternative (browser SQLite via OPFS, mirroring mobile) buys offline capture at the cost of porting `migrations.rs` a third time and maintaining a real sync cycle. → **Recommended default: online-only.** Revisit only if you find yourself capturing in places with no signal.

**2. How much auth on the Vercel proxy at first?**
Vercel's built-in Password Protection is a checkbox and costs zero session time; an HTTP-only cookie route is ~30 lines and nicer on a phone. → **Recommended default: Password Protection for v1**, upgrade if the prompt annoys you. Either way the token stays server-side, which is the part that actually matters.

**3. Which row-timestamp convention wins, and do we fix mobile now?**
`created_at`/`updated_at` are already written in two incompatible formats (§1.3). Web must pick one. → **Recommended default: web follows Rust's SQLite format (`YYYY-MM-DD HH:MM:SS` UTC); file mobile's correction as a separate small ticket** rather than bundling it into the web work. It's a real bug but it isn't blocking, and mixing it in makes step 1 harder to verify.

**4. Does the mobile app survive, or does the web client replace it?**
This is a product question I can't answer from code, but it's worth deciding *before* step 3 because it changes how much effort step 1 deserves. The Expo app is ~4,300 lines with a diverged provider, a diverged schema mirror, and the snapshot bug from §1.2. A mobile-first web client covers much of the same ground with one less codebase — and it's the only option where a UI change reaches your phone without a rebuild. → **Recommended default: don't kill it yet, but stop investing in it.** Reassess after step 4; if the web version feels good on your phone, retiring Expo removes an entire copy from the drift problem.
