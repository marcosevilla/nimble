# Morning brief: a productized Today page

Date: 2026-09-23

Status: **all 8 open questions decided 2026-09-23 (see §0); ready for a phase-1 implementation plan.** Design only. It authorizes no code, migration, install or change to an integration. Inputs: [`docs/research/2026-09-23-morning-brief/inputs.md`](../../research/2026-09-23-morning-brief/inputs.md). This redesign replaces decision 2(c) in `NEXT.md` ("should the review get a fourth triage step?").

## 1. Problem and goals

- **Problem:** the brief currently lives outside the product. `read_daily_brief` renders a markdown file that an external Claude Code job writes to `journal/briefs/Brief YYYY-MM-DD.md` (`apps/desktop/src-tauri/src/commands/obsidian.rs:133`). Its sections change from day to day. Nimble can't generate the brief, customize it, act on it, or show it to anyone who doesn't run that job.
- **Goal 1:** the same containers appear every morning, in the same order, filled with that day's content. The user learns where to look once.
- **Goal 2:** Nimble gathers and generates the brief itself, on a schedule. It works offline with whatever is cached, and the AI suggests and drafts but never acts.
- **Goal 3:** it works for someone who isn't Marco: a guided setup with every source optional, a history of past briefs, and goals that motivate without guilt.
- **Goal 4:** one morning flow. The brief is the review, and there is no separate stepper.

**Non-goals (v1):** reading Gmail or iMessage inside Nimble, any autonomous change (closing, rescheduling, sending, paying, deleting), job or news digests, a hosted AI proxy, a mobile-native brief, and multi-user or team features. Weather is the only new integration in v1.

## 2. Concept options

| | A. Rendered document | B. Module page with one AI pass (**recommended**) | C. In-app chief-of-staff agent |
|---|---|---|---|
| What it is | External Claude Code keeps writing markdown. Nimble enforces a section template and renders fixed containers from the frontmatter. | Each container is a Rust module that collects local and cached data without AI. One scheduled AI call with a fixed output schema fills the AI slots. External agents can add items through `dt`. | An agent loop inside Nimble with tools (mail, messages, vault, tasks) that sorts items into close / update / draft / decide, like reference 1. |
| Build cost | Smallest | Medium | Largest |
| Productizable | No: needs Claude Code, a vault and a cron job | Yes: every source is optional | Yes in principle, but it needs restricted Google scopes and Full Disk Access |
| Offline / local-first | Renders the last file | The non-AI containers always render, and AI slots fall back to rule-based ranking | Poor |
| Consistent structure | Only by convention: one bad run breaks the layout | Guaranteed by schema | Hard: the agent decides |
| Cost per day | Marco's existing subscription | ≈ $0.03–0.05 (see §4.6) | $0.50+ with web and tool use |
| Trust surface | None in-app | Small: suggestions plus additive drafts | Large: writes on its own |

**Recommendation: B, with a seam for C.** B gives the fixed structure and the setup flow that make this a product. It reuses what already exists: calendar cache, native tasks, habits, the Anthropic client (`nimble-core/src/api/anthropic.rs`), the scheduler pattern (`apps/desktop/src-tauri/src/backup_runner.rs:158` `due_slot`) and the C3 agent socket (`nimble-core/src/agent_protocol.rs`). The seam keeps Marco's Gmail and iMessage coverage now: his nightly Claude Code job posts evidence-backed items into a **Needs attention** container through `dt`. Nimble owns the structure and the external agent contributes content. C becomes a later spec, once the contributor items show which integrations are worth building natively.

## 3. The recommended concept

### 3.1 Fixed versus dynamic: the rules

1. **Settings decide the structure.** Which containers appear and in what order comes from setup, never from the AI. The AI can't add, remove or rename a container.
2. **Data decides the content.** Each container gets its content from a rule-based collector, from AI output constrained by a schema, or from contributed items. The table below says which.
3. **Every container declares its empty state.** An empty container shows one calm line. It never collapses or disappears, so the layout stays put.
4. **No filler.** The AI schema allows zero items in every slot, and the prompt forbids generic advice. An AI item must reference a real task ID, event ID or contributed item, or be marked `suggested_task` and offer "Add as task".

### 3.2 Containers

Default order. The Present column shows the setup default (on/off). Fixed = collected by rules; AI = chosen or written by the model.

| # | Container | Shows | Data source | Kind | Empty state |
|---|---|---|---|---|---|
| 0 | **Header line** | Date, weather chip, one summary sentence for the day (register GENTLE / DIRECT / MIRROR as in inputs ref. 2, never scolding or cheering) | AI, plus weather | AI (optional) | The sentence is omitted. The date and chip stay. |
| 1 | **Weather** (on) | Now, high/low, chance of rain; a note when rain overlaps a timed event that has a location | Open-Meteo, cached 60 min | Fixed | No location: "Add a location for weather" (opens setup). Offline: last forecast, labelled "as of 6:31". |
| 2 | **Schedule** (on) | Today's events in a time gutter, a TOMORROW peek (first 2), overlaps flagged in text, the largest free block ("2h 30m open, 1:00–3:30") | `calendar_events` (iCal plus Google), `useCalendar` cache | Fixed | "No events. Wide open." (current `CalendarGlance` copy, `TodayPage.tsx:116`) |
| 3 | **Top priorities** (on) | 0–3 items, each with a checkbox, title, source dot and a one-line reason. Energy selector in the container header. | Candidate tasks (§4.6) + schedule + energy → AI | AI | "Nothing pressing today. Pick something you want to do." |
| 4 | **Quick wins** (on) | Two columns. **I can help:** up to 3 items, each with one action button (§3.6). **Only you:** up to 3 calls, errands and payments, with no button. | Candidates with a duration ≤ 15 min, a TIME label (after C4) or a small AI estimate → AI sorts them | AI | "No quick wins spotted today." |
| 5 | **Needs attention** (on only when a contributor or integration is connected) | Rows grouped as Reply / Decide / FYI, each with evidence (quote plus source) and actions only where the AI can move the item | `brief_items` from contributors (`dt brief add`); later native integrations | Contributed | "Nothing waiting on you." |
| 6 | **Due today** (on) | Live task list for today (the current dashboard list, `TodayPage.tsx:369`) | `local_tasks` | Fixed, live | Current `EmptyState` with `Q` (`TodayPage.tsx:401`) |
| 7 | **Still open** (on) | The 5 oldest open tasks with a due date before today, grey age tags only, a total count, and one group-level line suggesting Someday for anything over 60 days | `local_tasks` | Fixed | "Everything's current." |
| 8 | **Before you start** (off) | Habits as checkbox rows, no counts, no reference to yesterday | `habits` / `habit_logs` | Fixed, live | "No habits set up." (links to Goals) |
| 9 | **Momentum** (on) | Wins first, then meters (§3.5) | `karma_events` + goals | Fixed (the AI only picks which 2–3 wins to name) | "Your week starts here." |
| 10 | **From your vault** (on only if a legacy brief exists) | The existing markdown brief, collapsed | `read_daily_brief` + `BriefDisplay` | Fixed | Hidden when no file exists (the only container allowed to hide: it exists for the transition) |
| 11 | **Notes** (off) | A per-day scratchpad | `briefs.notes` | Fixed | Placeholder text |

**Pluggable module contract.** A module is a manifest (`id`, `name`, `kind`, `requires: [integration]`, `default_enabled`, `config_schema`) plus a Rust `gather()` that returns a typed JSON payload, plus optional `ai_context()` text. The frontend keeps a registry mapping each `id` to a component. An unknown `id` (a newer version, or the web client) renders "Open in Nimble for Mac". Later integrations, such as Gmail, RSS digest or iMessage, become new modules or new contributors. The page layout doesn't change.

### 3.3 Morning flow

The stepper (`ReviewMode`, `TodayPage.tsx:146`) is removed. The flow becomes:

- **First open of the day** (`daily_state.review_completed_at` is null): Today opens in **morning mode**. All containers are expanded in a centered single column, and the rule-based containers render from local data immediately. If the scheduled brief is already stored, AI slots render from it. If not, they show skeletons shaped like their content and fill in when generation finishes (no spinners, §1.6). Energy is optional: the brief was generated assuming the last energy used (default medium). Picking a different level re-ranks **only** Top priorities with one small call. A single **Start my day** button (`↵`) records `review_completed_at`.
- **Later opens** (dashboard mode): the brief collapses to a **brief strip**: weather chip, next event, the 3 priorities as checkable rows, and a count for Needs attention. Due today becomes the main content area. `B` or the chevron expands the full brief in place. The Calendar, Habits and Activity tabs stay in the right rail (`components/layout/RightSidebar.tsx`).
- **Live and frozen content:** AI content is frozen for the day, so it stays stable and never re-sorts under you. Checkbox state, schedule changes, habits and momentum stay live. **Regenerate** in the brief's ⋯ menu makes a new version for the same date, and the old version is overwritten.
- **Overnight:** a date rollover or window focus re-checks `briefs` for the new date. This settles post-C decision (a) in `NEXT.md:83` for Today.
- **Triage:** there is no triage step. Needs attention and Still open are the triage surface. Inbox processing stays on Inbox.

### 3.4 Today setup (onboarding)

The setup runs on the first visit to Today after this feature ships (or for a new user), and again from **Settings → Today & brief** or **Customize** in the brief's ⋯ menu. Every step can be skipped. A live preview of today's brief sits on the right and updates as choices change.

1. **Choose a starting layout:** Focused (priorities, schedule, quick wins, due today), Full (everything on by default), or Minimal (schedule plus due today, no AI). This sets the module list.
2. **Location:** a city search, geocoded through Rust. Skip → the Weather container shows its "Add a location" state.
3. **Brief time:** default 6:30. Copy: "Nimble prepares your brief at this time if it's open. Otherwise it's ready a few seconds after you open it."
4. **Sources:** calendar, tasks (Todoist sync), Obsidian vault and AI key, each showing Connected or Connect. **All optional.** This requires dropping the all-required gate in `nimble-core/src/db/settings.rs:6` `REQUIRED_SETTINGS` (small Rust batch item 3 already drops `ical_feed_url`). Without an AI key the brief still works, with rule-based priorities.
5. **Goals:** daily target (default 5), weekly target (default 25), days off (default Sat and Sun), Momentum on/off.
6. **Arrange:** an optional list for toggling and reordering modules with drag and `⌥↑/↓`.

Finish → generate now → land in morning mode.

### 3.5 Goals and momentum (the Todoist karma question)

Todoist karma combines points for completions, bonuses for hitting goals, daily and weekly **streaks**, and a **penalty for tasks overdue several days**. The last two break §3.1 of `ux-intent.md`. The proposed model keeps the motivation and drops the guilt:

- **Points only go up.** +1 per completed task or recurring occurrence, +1 more for priority ≥ 3, +3 when the daily goal is hit, +10 when the weekly goal is hit. Nothing decays and nothing is subtracted for lateness. Un-completing a task reverses its points once. That is bookkeeping, not a penalty, and it's never announced.
- **Levels**, monotonic in the way Todoist's are, shown as a quiet label next to the total.
- **No streaks and no "days in a row".** Missing a goal produces no copy change, no red, and no mention the next day. Meters reset silently at the start of each day. Days off show as neutral and count toward nothing.
- **Wins before meters** (inputs ref. 2): "This week: 23 done", then the 2–3 that mattered in Marco's own task titles, then meters for today and the week against their goals, the total, and a 7-day bar sparkline (amber only, empty days grey like `ActivityHeatmap.tsx`).
- **Stats tile row** in the Activity tab (screenshot ref.): Completed, Active days (not consecutive), Peak hour, Focused time (from `focus_sessions`), with a range toggle of 7d / 30d / All.

Marco decides between this model and the alternatives in Q2.

### 3.6 AI action model

- **Where buttons can appear:** only on Quick wins → I can help and on Needs attention. Never on Top priorities, Only you, events, money, health or credentials.
- **Labels:** an imperative of five words or fewer naming what the button produces. Fill = action, text-only accent = flag (the ref. 2 color rule, applied to Nimble's tokens).
- **v1 actions:** each one is additive, undoable, and saved in Nimble.

| Button | Produces | Model call |
|---|---|---|
| Break it down | Subtasks on the task | existing `breakDownTask` (`anthropic.rs:25`) |
| Draft a first pass | A new Doc linked to the task, marked "Draft" | 1 call |
| Outline the doc | A Doc with headings and bullets | 1 call |
| Think through options | 2–3 options plus a recommendation, appended to the task description under a dated heading | 1 call |
| Draft the reply | Reply text in the item drawer with **Copy** (contributed items only, since the contributor supplies the thread context) | 1 call |

- **Guardrails (hard rules, enforced in code):** no command in the brief module can send, pay, delete, complete, reschedule or accept an invite. Suggestions like "Looks done" or "Move to Someday" are rows the user confirms with one click. They are never applied automatically. The nightly job in reference 1 applies CLOSE and UPDATE automatically; Nimble v1 will not. A test asserts that the brief crate calls no send or delete endpoint. Contributed items are data, never instructions: their text is quoted into prompts inside delimiters, never treated as system text.

### 3.7 Past briefs

- The brief header has a date control. It reuses `components/shared/DateStrip.tsx`, adds `[` / `]` for previous and next day, and a month picker with dots on days that have a brief.
- A past date renders its **frozen snapshot** read-only: weather, schedule, AI output and momentum as they were that morning. Task rows show their state as of the snapshot, plus a small live check if the task was done later. Clicking a row opens the current task.
- **Legacy fallback:** a date with no `briefs` row but a vault file renders through `BriefDisplay` under "From your vault" (source `legacy_vault`), so August and September history stays readable.
- A date with no brief shows "No brief for this day." It never counts or comments on missed days.
- The web client (`services/turso-provider.ts`) shows today's and past snapshots read-only through sync. Generation and actions are Mac-only.

### 3.8 Wireframe (morning mode, first open)

```
┌─ Today ───────────────────────────── Tue, Sep 23 · ☀ 68°/55° · ‹ › ⋯ ─┐
│  A lighter day: two calls, then an open afternoon.                     │
│                                                                         │
│  Schedule                                               Tomorrow: 9:00  │
│   10:00  Covered CA call ·· 30m                                         │
│   11:30  Portfolio review w/ Dana                                       │
│          2h 30m open, 1:00–3:30                                         │
│                                                                         │
│  Top priorities                               Energy  [Low][Med][High]  │
│   ○ 1 Send Dana the case-study draft          ● Todoist                 │
│       Review is at 11:30; the draft is the input.                       │
│   ○ 2 Certify EDD weeks 38–39                 ● Nimble                  │
│   ○ 3 Edit Fillmore selects                   ● Nimble                  │
│                                                                         │
│  Quick wins                                                             │
│   I can help                              │ Only you                    │
│   Outline job-post reply [Draft first pass]│ Call pharmacy              │
│   Split "portfolio v2"   [Break it down]  │ Pay Muni ticket             │
│                                                                         │
│  Needs attention · 2                                                    │
│   Reply   Label contract, Q about usage  "…can we…" gmail [Draft reply] │
│   Decide  Sat show, second shooter?      imessage                       │
│                                                                         │
│  Due today · 6        Still open · 12 (oldest 5)        Momentum        │
│   …live rows…          grey age tags                    23 this week    │
│                                                          ▁▃▅▂▆ ▫▫  3/5  │
│                                              [ Start my day  ↵ ]        │
└─────────────────────────────────────────────────────────────────────────┘
```

Dashboard mode swaps everything above "Due today" for a one-row brief strip: `☀ 68° · Next: 10:00 Covered CA · ○ Send Dana… ○ EDD… ○ Fillmore… · 2 need you  ▾`.

## 4. Data model and architecture

The current schema is **v22** (`nimble-core/src/db/migrations.rs:660`). This design adds **v23**, with one statement per `;` because the migration runner splits on it (CLAUDE.md gotcha). Mobile mirroring is skipped because mobile is dormant.

### 4.1 Tables and columns (v23)

```sql
CREATE TABLE briefs (
  date TEXT PRIMARY KEY,               -- local YYYY-MM-DD
  version INTEGER NOT NULL DEFAULT 1,  -- ++ on regenerate
  status TEXT NOT NULL CHECK(status IN ('ready','partial','fallback','failed')),
  source TEXT NOT NULL DEFAULT 'nimble',            -- 'nimble' | 'legacy_vault'
  layout_json TEXT NOT NULL,           -- ordered module ids + config at generation time
  snapshot_json TEXT NOT NULL,         -- frozen per-module payloads + AI output (schema-versioned)
  snapshot_schema INTEGER NOT NULL,
  energy_level TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
  error_code TEXT, notes TEXT,
  generated_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE brief_items (             -- anything with its own state
  id TEXT PRIMARY KEY, date TEXT NOT NULL, module_id TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- priority|quick_help|quick_self|attention|suggestion
  title TEXT NOT NULL, body TEXT, task_id TEXT, event_id TEXT,
  origin TEXT NOT NULL,                -- 'ai' | 'rule' | 'contributor:<name>'
  dedupe_key TEXT, evidence_json TEXT, action_kind TEXT,
  action_state TEXT NOT NULL DEFAULT 'none',  -- none|produced|dismissed|confirmed
  produced_ref TEXT, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX idx_brief_items_dedupe ON brief_items(date, dedupe_key);
CREATE TABLE karma_events (            -- append-only ledger, idempotent ids
  id TEXT PRIMARY KEY,                 -- e.g. 'task:<id>:<completed_at>' / 'goal:day:<date>'
  date TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL,
  task_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE module_cache (            -- device-local, NOT synced (weather, geocode)
  module_id TEXT NOT NULL, cache_key TEXT NOT NULL, payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL, PRIMARY KEY (module_id, cache_key));
ALTER TABLE daily_state ADD COLUMN review_completed_at TEXT
```

- **Why items live apart from the snapshot:** items change during the day (dismissed, drafted, confirmed). Row-level last-write-wins sync handles those updates cleanly, where a single JSON blob would not. The snapshot stays immutable until the next regenerate.
- **`review_completed_at`** replaces the rule inferred in `db/daily_state.rs:21` (`energy && priorities`). It is also the persistent review escape hatch from small Rust batch item 3.
- **Settings** use the existing key-value store: `brief.enabled`, `brief.time`, `brief.location` (`{name, lat, lon, tz}`), `brief.modules` (ordered `[{id, enabled, config}]`), `brief.model`, `goals.daily`, `goals.weekly`, `goals.days_off`, `momentum.enabled`, `today.setup_completed_at`.
- **Sync:** `briefs`, `brief_items` and `karma_events` go through `sync_log`, are added to `initialize_remote`, and are gated by `turso_schema_v23_upgraded`. `module_cache` stays device-local, like `vault_fts`. **Privacy:** contributed evidence (mail and message quotes) would reach Turso. v1 syncs `evidence_json` truncated to 280 characters (see Q7).

### 4.2 Rust layout

- `nimble-core/src/brief/`: `mod.rs` (orchestrator: collect every enabled module → build AI context → compose → persist), `modules/{weather,schedule,priorities,quick_wins,attention,due_today,still_open,habits,momentum,vault}.rs` implementing `BriefModule`, `compose.rs` (prompt plus JSON schema; validates that every returned ID exists and drops any that don't), `fallback.rs` (rule-based ranking: in-progress, then priority, then due date, then age).
- `nimble-core/src/api/weather.rs`: Open-Meteo forecast and geocoding behind a `WeatherProvider` trait. `nimble-core/src/db/{briefs,karma}.rs`.
- **Karma writes:** the completion and recurrence paths in `db/tasks.rs` (around `:200` and `:365`) append a `karma_events` row, fire-and-forget like `log_activity`. A one-time backfill reads `completed_at` and `task_recurred`. The backfill runs again after the C5 import. This deliberately avoids depending on activity-log completion events, which re-score item 1c found unreliable.
- **Tauri** `commands/brief.rs`: `brief_get(date)`, `brief_list_dates(from,to)`, `brief_generate(date?, force)`, `brief_set_energy(level)`, `brief_mark_reviewed()`, `brief_item_action(id, kind)`, `brief_item_set_state(id, state)`, `brief_settings_get/save`, `weather_geocode(query)`, `momentum_summary(range)`, `goals_save(targets)`.
- **Agent protocol:** add `Domain::Brief` and `AgentOperation::BriefContribute { date, items }` (validated, deduplicated on `dedupe_key`, capped at 20 items per call). `dt brief add --json` wraps it. This is the hybrid seam.

### 4.3 DataProvider additions (`packages/types/src/data-provider.ts`)

- New `brief` domain: `get`, `listDates`, `generate`, `setEnergy`, `markReviewed`, `runAction`, `setItemState`, `getSettings`, `saveSettings`, `geocode`.
- New `momentum` domain: `summary(range)`, `saveGoals`.
- `dailyState.readDailyBrief` and `listBriefDates` stay for the legacy module. `generatePriorities` is deprecated once phase 3 ships.
- `TursoProvider` implements the read methods and reports generation and actions as unsupported, the same pattern as backups.

### 4.4 Scheduling

- `apps/desktop/src-tauri/src/brief_runner.rs` runs on the existing 5-minute loop (`lib.rs:~425`) and reuses the `due_slot` semantics from `backup_runner.rs:158`, including catch-up and DST handling:
  - due when `now ≥ brief.time` and no `briefs` row exists for today;
  - on launch, the first tick generates if a brief is due;
  - disabled in demo mode and in isolated test profiles.
- The "Mac is asleep at 6:30" case is covered by catch-up on open. No wake scheduling.
- **Failure handling:**
  - AI failure → `status='fallback'`: rule-based priorities and quick wins with plain labels ("Sorted by priority. AI unavailable."). Retried on the next tick, at most 3 attempts per day.
  - Weather failure → `partial`, and the Weather container shows the cached forecast.

### 4.5 Caching per day and snapshots

- Collect, then compose, then write one `briefs` row plus its `brief_items` in a single transaction. The frontend reads the row and re-reads live data only for live containers.
- Regenerate replaces the snapshot, increments `version`, and keeps items the user has acted on (`produced` / `dismissed` / `confirmed`), matched by `task_id` or `dedupe_key`.
- `snapshot_schema` versions the payload shape, so old snapshots keep rendering after module changes. Each module owns a renderer per schema version, or falls back to the neutral placeholder.

### 4.6 AI call and cost

- **Input bound:** Marco has 1,125+ tasks, so the prompt never sees all of them. Candidates:
  - tasks due within 7 days or with a due date before today;
  - tasks in progress;
  - priority ≥ 3;
  - the 20 oldest still-open tasks;
  - capped at 80 rows of title plus metadata. Plus today and tomorrow's events, energy, habits (names only) and contributed items. About 8–15k input tokens.
- **Output:** one structured-output response (`output_config.format` JSON schema, or a strict tool; check model support when implementing) with `summary`, `priorities[0..3]`, `quick_help[0..3]`, `quick_self[0..3]`, `wins[0..3]`. About 1.5k output tokens.
- **Cost** at the 2026-06 list prices, per day:
  - Haiku 4.5 ($1/$5 per million tokens): ≈ $0.02–0.03
  - Sonnet 5 ($2/$10): ≈ $0.04–0.05
  - An energy re-rank costs less than a tenth of either.
- Token counts are logged to `briefs`. The current code pins `claude-haiku-4-5-20251001` (`anthropic.rs:128`); the model moves to the `brief.model` setting.

## 5. Phased implementation plan

Each phase ships and is verified on its own, and the app stays usable between phases.

| Phase | Scope | Exit test |
|---|---|---|
| **1. Brief shell (smallest useful slice)** | v23 `briefs` table plus `review_completed_at`. Morning mode replaces the stepper, and the page shows fixed containers from existing data: Schedule, Top priorities (the existing Haiku call moved into the container), Due today, Still open, From your vault. Snapshot written at first open. Brief strip in dashboard mode. Past dates through `DateStrip` with legacy fallback. | On 3 real mornings, containers appear in the same order. "Start my day" survives a relaunch. Yesterday renders from its snapshot after its tasks change. An offline launch renders every non-AI container with no spinner. |
| **2. Setup and weather** | Settings keys and module order/toggles. The 6-step setup with live preview. All-required gate removed. Open-Meteo plus geocoding, `module_cache`. | A fresh demo profile finishes setup in under 60 seconds skipping every step and gets a working brief. Setting San Francisco shows weather. With network off, "as of" shows the cached forecast. |
| **3. Scheduled composition** | `brief_runner`, orchestrator, one structured AI call (summary, priorities, quick wins split), energy re-rank, rule-based fallback, token logging, Regenerate. `brief_items` table. | On 5 mornings the brief is `ready` before first open when the Mac was awake at brief time, or within about 10 seconds of open otherwise. With the key removed or offline, `fallback` renders. Unknown IDs from the AI are dropped (unit test). |
| **4. Momentum** | `karma_events` ledger, completion hooks, backfill, goals settings, Momentum container, Activity stat tiles. | Complete then un-complete a task: +1 then −1, exactly once each. A recurring occurrence counts. Missing a goal changes no copy the next day (snapshot diff). Todoist-synced completions count once. |
| **5. AI actions** | The five v1 buttons, the item drawer, `produced_ref` links, undo. Code-level guardrail test. | Each action produces an additive artifact and undo removes it. The guardrail test finds no send, delete or complete call in `brief/`. Labels are ≤ 5 words. |
| **6. Contributors and Needs attention** | `BriefContribute` op, `dt brief add`, evidence rendering, dedupe. Marco's nightly job switches from writing markdown to posting items. | A test contributor posts 3 items twice and exactly 3 appear. The quoted evidence renders as data. Items sync to the web read-only. |
| 7. *(separate spec)* | Native Gmail read-only module, then digests, then C-style agent actions | none |

**Roadmap placement (recommended):**

1. Finish the queued loop-2 opener P1s (item 1b) and the small Rust batch. They are small, and phase 1 needs `set_review_complete`.
2. **Brief phases 1–2.** Keep Today out of facelift loop 2 so the redesign doesn't happen twice. Loop 2 continues on Settings, capture prefixes and Tasks.
3. **C4** (grouped labels). Quick wins need the TIME and ENERGY labels.
4. **Brief phases 3–4.** Momentum should exist before the Todoist trial so Todoist karma has a replacement when Marco cuts over.
5. **C5** import and trial, then re-run the karma backfill.
6. **Brief phases 5–6.**

The C2 and C3 live gates are tests Marco runs himself, and they can happen at any point.

## 0. Marco's decisions (2026-09-23, going one by one; these override the recommendations below)

- **Q1 → A, in-app only.** Nimble generates the brief itself; no external Claude Code contributor path in the plan (drop the `dt brief add` contributor seam from phase 6; Needs attention waits for native integrations). **Plus:** the user configures which boxes appear, their order/position, and what information each box shows (per-box options, not just on/off). Treat per-box settings as part of the module contract (`config_schema`) and the setup "Arrange" step, available again from Settings and the brief's ⋯ → Customize.
- **Q2 → C, full Todoist karma parity as an opt-in setting.** Points per completion (priority bonus), daily/weekly goal bonuses, levels, 7-day trend, **daily and weekly streaks, and the overdue penalty** — all behind one setting, **off by default**. With it off, the user gets goals + meters only with no streaks or penalties. `ux-intent.md` §3.1 amended to allow this opt-in. The ledger (`karma_events`) must record negative events for the penalty, so §3.5's "points only go up" no longer holds when the setting is on.
- **Q3 → no review mode, no "Start my day" button.** The brief is always fully expanded at the top of Today by default. A compact toggle (chevron / `B`) collapses it to the one-row strip so the tasks below are visible. Compact is a manual toggle only: it stays however Marco left it (no automatic reset on a new day), and expanding back to the full brief is always one click or `B` away. `review_completed_at` / `set_review_complete` are no longer needed for Today (drop from phase 1 and from the small Rust batch's review escape hatch).
- **Q4 → B, drop energy.** No energy selector anywhere; the AI infers load from the calendar (packed day → lighter priorities). Remove the energy re-rank call, the energy selector UI and the energy-history sparkline; `daily_state` energy stays in the schema but is no longer written by Today.
- **Q5 → Claude Opus 5.5 (`claude-opus-5-5`)** for brief composition, behind a `brief.model` setting. $4 / $20 per MTok → ≈ $0.07 per brief (~$2/month at one call a day, before thinking tokens). Implementation notes for Opus 5.5: thinking can't be disabled (omit `thinking`, control depth with `output_config.effort`, and **set effort explicitly** since its default is `medium`); forced `tool_choice` (`any`/`tool`) returns 400, so get JSON via structured outputs (`output_config.format`), not a forced tool; check `stop_reason` for `refusal` before reading content. The existing `claude-haiku-4-5-20251001` pin in `anthropic.rs:128` (task breakdown) is unaffected unless moved to the same setting.
- **Q6 → C, starting with A.** v1 ships bring-your-own Anthropic key (no key → rule-based brief, no summary line). A hosted proxy (Vercel `api/`, billing, accounts) is a planned later option, not v1. All AI calls go through an `LlmClient` trait so the proxy is a contained addition.
- **Q7 → A and B: Gmail read-only and iMessage** both feed Needs attention (replies owed, decisions waiting), each as its own spec after the brief core (phases 1–4). Default order Gmail → iMessage. Gmail: restricted `gmail.readonly` scope, fine in Google testing mode for Marco; public shipping needs Google's annual security assessment (product decision later). iMessage: reads the local Messages database, needs Full Disk Access, no official API, read-only, Mac-only. Both read-only: "Draft the reply" produces text to copy; Nimble never sends.
- **Q8 → A, Open-Meteo** behind a `WeatherProvider` trait (free, no key; paid plan or switch if Nimble is sold).

**Net effect on §5 phases:** phase 1 drops `review_completed_at` and the "Start my day" button (brief always expanded, manual compact toggle); phase 3 drops the energy re-rank and uses Opus 5.5 via structured outputs; phase 4 builds Todoist-parity karma behind an off-by-default setting (goals + meters when off); phase 6 (`dt` contributors) is replaced by two separate integration specs, Gmail read-only then iMessage, both feeding Needs attention. Everything else in §3–§5 stands unless it contradicts this list.

## 6. Open questions for Marco (ranked by how much each changes the design)

1. **Where is the brief generated?**
   - (a) In-app only: Nimble calls the API on a schedule.
   - (b) Keep the external Claude Code job writing markdown.
   - (c) Hybrid: Nimble owns the structure and the AI slots, and external agents add items through `dt`.
   - **Recommended: (c).**
2. **Karma model?**
   - (a) Momentum points: only go up, daily and weekly goals, levels, no streaks or penalties, days off.
   - (b) Goals and meters only, no points.
   - (c) Full Todoist parity (streaks, overdue penalty) as an opt-in setting. This means amending `ux-intent.md` §3.1.
   - **Recommended: (a).**
3. **Morning flow?**
   - (a) A single-page brief with "Start my day", which then collapses into a strip above the task list.
   - (b) Keep a stepper (brief → energy → priorities) with the new containers.
   - (c) No review mode at all: the brief is always the top of Today.
   - **Recommended: (a).**
4. **Energy input?**
   - (a) Optional selector in Top priorities that re-ranks only that container.
   - (b) Drop energy; the AI infers load from the calendar.
   - (c) Ask for energy before generating (the brief waits).
   - **Recommended: (a).**
5. **Model for daily composition?**
   - (a) Haiku 4.5 (≈ $0.03/day).
   - (b) Sonnet 5 (≈ $0.05/day, better judgment on priorities).
   - (c) A setting, defaulting to Haiku.
   - **Recommended: (b) for composition, with Haiku for energy re-ranks.**
6. **Who pays for AI in the product?**
   - (a) Bring your own Anthropic key (as today); without a key you get the rule-based brief.
   - (b) A hosted proxy (the Vercel `api/` already exists).
   - (c) Both.
   - **Recommended: (a) for now**, with the call behind an `LlmClient` trait so (b) can be added later.
7. **First integration after weather?**
   - (a) Native Gmail read-only (restricted scope; fine in testing mode for Marco, and needs Google verification to ship).
   - (b) Contributors only: your Claude Code job posts through `dt`, and Nimble ships no mail access yet.
   - (c) iMessage (needs Full Disk Access).
   - **Recommended: (b)**, with (a) as its own spec. This also settles the §4.1 privacy question: evidence stays truncated.
8. **Weather provider?**
   - (a) Open-Meteo: free, no key, but its free tier is non-commercial, so a paid plan if Nimble is sold.
   - (b) Apple WeatherKit: needs an Apple Developer membership and signed JWTs, and fits a native Mac app.
   - (c) Configurable.
   - **Recommended: (a)** behind the `WeatherProvider` trait.
