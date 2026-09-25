# Morning brief phases 2–4: addendum

**Status:** approved in conversation 2026-09-25 (Marco). This is a delta over `2026-09-23-morning-brief-design.md` (the base spec) and its §0 decisions (Q1–Q8). Where the two differ, this file wins. Phases 5–6 are out of scope here.

## 0. Decisions (2026-09-25)

| # | Topic | Decision |
|---|---|---|
| A1 | Where the brief is customized | **Settings → Today & brief only.** No in-place edit mode on Today. The brief's ⋯ → **Customize…** opens that settings page (`openSettings('today-brief')`). |
| A2 | Today setup | **The full 6 steps** of base §3.4 (Layout → Location → Brief time → Sources → Goals → Arrange), every step skippable, live preview beside it. |
| A3 | Weather | **Header chip + popover** (Fantastical pattern). No Weather box. |
| A4 | Quick wins in phase 3 | **Two columns.** *I can help* (tasks with the help label + AI picks) with two working buttons, **Break it down** and **Copy for Claude**. *Only you* (tasks with the quick label). The remaining phase-5 buttons stay in phase 5. |
| A5 | Momentum with karma off | **Wins + meters + 7-day trend + one-tap Pause**; days off neutral; Momentum box **on** by default. Karma parity (Q2) stays an opt-in setting, off by default. |
| A6 | AI model settings | Opus 5.5 (`claude-opus-5-5`) at **low effort** for the daily brief (latency ≈10 s, ≈$0.05/day). `brief.model` and `brief.effort` are settings. |
| A7 | Removed from the base spec | Energy (Q4), "Start my day" / `review_completed_at` (Q3), Needs attention + contributors + `dt brief add` (Q1). `brief_items` keeps no contributor fields. |

## 1. Module registry (phase 2 foundation)

Phase 1 hard-codes boxes in `db/briefs.rs` (`LAYOUT_V1`, inline `gather`) and in `TodayPage.tsx`. Phase 2 replaces that with the base spec's module contract:

- **Rust** `nimble-core/src/brief/`: `mod.rs` (registry + orchestrator), `modules/*.rs`, each implementing
  `trait BriefModule { fn manifest() -> ModuleManifest; async fn gather(&self, ctx: &BriefCtx, config: &Value) -> Result<Value>; }`
  `ModuleManifest { id, name, kind: Fixed|Live|Ai, requires: Vec<Integration>, default_enabled, config_schema: Vec<ConfigField> }`
  `ConfigField` is a small closed set: `Bool { key, label, default }`, `Choice { key, label, options, default }`, `Label { key, label, default_name }` (a label picker, for Quick wins).
  Existing `db/briefs.rs` storage functions stay; `gather` moves into modules.
- **Registered modules (phase 2):** `schedule`, `priorities`, `due_today`, `still_open`, `habits` ("Before you start", off), `notes` (off), `vault` (shown only when a legacy file exists), `weather` (renders as the header chip, not a box). Phase 3 adds `quick_wins`; phase 4 adds `momentum`.
- **Config per module (phase 2):** schedule `{tomorrow_peek: bool = true, free_block: bool = true}` · priorities `{count: 1|2|3 = 3}` · still_open `{count: 3|5|10 = 5}` · due_today `{show_completed: bool = true}` · weather `{units: auto|F|C = auto, rain_notes: bool = true}` · habits, notes, vault: none.
- **Layout** comes from setting `brief.modules` = ordered `[{id, enabled, config}]`. Unknown ids are skipped; registered modules missing from the list are appended with their defaults (so new modules appear after an update). `layout_json` in each snapshot records the layout used.
- **Frontend** registry `components/today/briefModules.tsx`: `id → { Box, Strip?, Settings? }`. `TodayPage` renders the enabled modules in order. An id with no component renders the neutral "Open in Nimble for Mac" placeholder (web / newer versions).

## 2. Settings (phase 2)

- **Keys** (KV store): `brief.time` (HH:MM, default `06:30`), `brief.location` (`{name, lat, lon, tz}` JSON), `brief.modules`, `brief.model` (default `claude-opus-5-5`), `brief.effort` (default `low`), `today.setup_completed_at`, `goals.daily` (5), `goals.weekly` (25), `goals.days_off` (`["sat","sun"]`), `momentum.paused` (`0|1`), `momentum.paused_at`, `karma.enabled` (`0`). Lane C owns the meaning of the `goals.*` / `momentum.*` / `karma.*` keys; Lane A's setup step 5 writes `goals.*` only.
- **Settings → Today & brief** page (the existing `today-brief` section slot; mount contract in `NEXT.md` item "Next: phase 2"). Sections, each its own component so lanes don't collide:
  - **Brief** (`TodayBriefSettings.tsx`, Lane A): brief time, AI model + effort (with the no-key note), "Run setup again".
  - **Location & weather** (Lane A): city search (geocoded in Rust), units, rain notes, Open-Meteo attribution line (CC BY 4.0).
  - **Boxes** (Lane A): one sortable list (`@dnd-kit/sortable`, `⌥↑/↓` for keyboard) of every registered module: drag handle, name, show/hide switch, chevron that expands its options rendered from `config_schema`. Weather appears as "Weather chip".
  - **Goals & momentum** (`MomentumSettings.tsx`, Lane C, phase 4): daily/weekly goal, days off, Pause, Karma (Todoist-style points, levels, streaks, overdue penalty) switch with an honest one-line description.
- Settings forms reuse `SettingFieldRow` (`SettingsPage.tsx`), shared `Input`/`Switch`/`Select`/`ToggleGroup` from `components/ui`, and the 720px reading measure.

## 3. Today setup (phase 2)

- Shown on the first Today visit when `today.setup_completed_at` is null (so Marco sees it once after install), and from **Run setup again**. Full-page takeover of the Today column, left = step, right = **live preview** (the real brief components rendered against the draft settings, read-only).
- Steps exactly as base §3.4 (Layout presets Focused / Full / Minimal; Location; Brief time; Sources as Connected / Connect rows that deep-link to Settings → Connections; Goals; Arrange = the same Boxes list component). Header shows "Step n of 6", **Skip** and **Back**; `↵` continues, `Esc` = Skip setup (writes defaults + `today.setup_completed_at`).
- Finish writes all keys in one save, then Today renders the brief (phase 3: triggers composition).
- **Gate removal:** `REQUIRED_SETTINGS` (`nimble-core/src/db/settings.rs`) and `SETUP_REQUIRED_KEYS` (`lib/setupGate.ts`) become empty; `SetupDialog` no longer blocks the app. Missing keys degrade per feature (no Todoist → no sync; no vault → no vault box; no AI key → rule-based brief).
- **Exit test (from base §5):** a fresh demo profile finishes setup in under 60 seconds skipping every step and gets a working brief.

## 4. Weather (phase 2)

- `nimble-core/src/api/weather.rs`: `WeatherProvider` trait; `OpenMeteo` impl — forecast (`/v1/forecast`: current temp, daily high/low, hourly temp + precipitation probability, `timezone=auto`) and geocoding (`geocoding-api.open-meteo.com/v1/search`). Units from config (`auto` = °F for `en-US` locale, else °C).
- **Cache** in a new device-local table (schema v25, not synced):
  `CREATE TABLE module_cache (module_id TEXT NOT NULL, cache_key TEXT NOT NULL, payload_json TEXT NOT NULL, fetched_at TEXT NOT NULL, PRIMARY KEY (module_id, cache_key))`.
  Forecast fresh for 60 min; on failure the last forecast renders with "as of 6:31"; no location → chip reads "Add location" and opens Settings → Location & weather.
- **Chip** in the brief header (full and compact strip): icon + high/low + max precipitation chance when ≥20%. Click / `Enter` opens a popover (`surface-popover`): place + now, 4 hourly points (now → evening), rain window, **rain notes** ("Rain likely during Channel Tres (7:00)" for timed events today whose hour has ≥50% precipitation, using the brief location), "as of · Open-Meteo".
- Snapshot stores the forecast used that morning, so past briefs show the day's weather.

## 5. Scheduled composition (phase 3)

- **Schema v26:** `brief_items` per base §4.1 minus contributor use (`origin` ∈ `ai|rule`, `kind` ∈ `priority|quick_help|quick_self`). Synced, gated `turso_schema_v26_upgraded`.
- **LLM client:** `trait LlmClient` in `nimble-core/src/api/llm.rs` with an Anthropic impl using **structured outputs** (`output_config.format` JSON schema; forced `tool_choice` returns 400 on Opus 5.5), explicit `output_config.effort` from `brief.effort`, no `thinking` field, and a `stop_reason == "refusal"` check before reading content. Implementers load the `claude-api` skill before writing this file and verify every parameter name against it. The existing Haiku pin for `breakDownTask` is untouched.
- **When it runs:** composition is due when today has no brief with `status='ready'` and fewer than 3 attempts today. Triggers: (1) `brief_runner` tick (existing 5-min loop, `due_slot` semantics from `backup_runner.rs`) once `now ≥ brief.time`; (2) first Today open of the day, at any time. Disabled in demo mode and isolated test profiles. The phase-1 first-open snapshot still renders immediately; AI slots show skeletons and fill when composition lands (patching the same row, `version` unchanged on first compose, `++` on Regenerate).
- **Input:** candidates per base §4.6 (≤80 rows) plus today/tomorrow events, habit names, and each task's labels. No energy.
- **Output schema:** `summary` (one sentence, GENTLE register, may be empty) · `priorities[0..3] {task_id, reason}` · `quick_help[0..3] {task_id, reason}` · `quick_self[0..3] {task_id}` · `wins[0..3] {task_id}` (read by phase 4). Every `task_id` is validated against the candidate set; unknown ids are dropped (unit-tested). The prompt asks for `quick_help` from help-labelled candidates first (any other candidate needs a non-empty `reason`); `quick_self` ids that don't carry the quick label are dropped.
- **Fallback:** no key, offline, refusal or 3 failures → `status='fallback'`, rule ranking (in-progress, then priority, then due date, then age) for priorities; Quick wins from labels only; header line "Sorted by priority. AI unavailable." Token counts logged on the row.
- **Regenerate** in the brief's ⋯ menu: new version for the date, keeps acted-on items (base §4.5).
- **Retire** the Haiku priorities path from Today (`useDailyPriorities` + `generate_priorities`); `generatePriorities` stays on the provider as deprecated until nothing calls it.
- **Quick wins box** (`quick_wins` module): config `{help_label: Label = "needs-claude", self_label: Label = "quick"}`. Two columns, each ≤3 rows with checkbox + title (+ reason line for *I can help*).
  - **Break it down** → existing `breakDownTask`, subtasks created under the task, toast with Undo (deletes the created subtasks).
  - **Copy for Claude** → `buildFocusPrompt` (`lib/focusPrompt.ts`) for that task to the clipboard, toast "Copied. Paste into Claude Code."
  - Guardrail (base §3.6): nothing in `brief/` can complete, reschedule, delete or send; a Rust test asserts it.

## 6. Momentum (phase 4)

- **Schema v27:** `karma_events` per base §4.1 (append-only, idempotent ids), synced, gated `turso_schema_v27_upgraded`.
- **Ledger writes** fire-and-forget at the task status funnel in `db/tasks.rs` **and** the incoming-apply paths (Turso, Todoist), keyed so a completion counts exactly once whichever path saw it first: `task:<task_id>:<completed_at>` (+1, +1 more for priority ≥3), reversal `untask:<task_id>:<completed_at>` (−same, only if the original exists), recurrence `recur:<task_id>:<due_date>`. Daily/weekly goal bonuses (`goal:day:<date>` +3, `goal:week:<iso-week>` +10) are computed when read, then persisted once earned. Backfill from `completed_at` and `task_recurred` activity, idempotent, rerunnable after C5.
- **Karma parity mode** (`karma.enabled=1`, off by default): Todoist-style levels (Beginner 0 · Novice 500 · Intermediate 2,500 · Professional 5,000 · Expert 7,500 · Master 10,000 · Grand Master 20,000 · Enlightened 50,000), daily and weekly goal streaks (days off and paused days skip, never break), and the overdue penalty: −1 once per task when it passes 5 days past its due date (`penalty:<task_id>:<due_date>`). None of this renders when the mode is off.
- **Pause** (`momentum.paused=1`): meters show "Paused" in neutral text, no goals are evaluated, streaks (parity mode) are frozen. One tap in the Momentum box ⋯ and in Settings. Resuming needs no confirmation and never comments on the gap.
- **Momentum box** (`momentum` module, on by default): "This week: N done" → 2–3 wins (AI `wins`, else the three highest-priority completions) → today and week meters against goals (plain bars, `--success` fill, empty track neutral) → 7-day trend (bar sparkline, amber, days off grey, like `ActivityHeatmap`). Parity mode adds total + level label + streak counts.
- **Activity tab stat tiles**: Completed · Active days (not consecutive) · Peak hour · Focused time (from `focus_sessions`), range toggle 7d / 30d / All.
- **Exit test (base §5, adjusted):** complete then un-complete a task: +1 then −1, exactly once each; a recurring occurrence counts; missing a goal changes no copy the next day; a Todoist-synced completion counts once; Pause shows "Paused" and evaluates no goal.

## 7. Lanes and ownership

| Lane | Branch prefix | Owns | Schema |
|---|---|---|---|
| A — brief core | `brief/` | `nimble-core/src/brief/`, `api/weather.rs`, `api/llm.rs`, `brief_runner.rs`, `TodayPage` + `components/today/*`, `TodayBriefSettings` + Location + Boxes sections, setup flow, setup-gate removal | v25 (phase 2), v26 (phase 3) |
| B — C4 | `c4/` | labels + label groups, `LabelPicker`, `LabelManager`, label filter, `tasks_fts`, `components/search/*`, `dt label` / `dt task search` | v24 |
| C — momentum | `momentum/` | `db/karma.rs`, ledger hooks, backfill, `momentum_summary`, `MomentumSettings`, `momentum` module + box, Activity tiles | v27 |

- Shared hot files are append-only (`migrations.rs`, `sync.rs` gates + `initialize_remote`, `lib.rs` `invoke_handler!`, `services/tauri.ts`, `packages/types`, `tools/mock-tauri.js`, `lib/shortcuts.ts`, `lib/settingsSections.ts`). Schema numbers are pre-assigned; if merge order differs, the later lane renumbers on rebase.
- Lane C's Rust (ledger, hooks, backfill, summary command) starts immediately; its box and settings section start after Lane A's phase-2 registry merges.
- `NEXT.md` is edited only at wrap. Only `main` is installed.
