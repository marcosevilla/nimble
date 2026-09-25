# Morning Brief Phase 2 (Module Registry, Settings, Setup, Weather) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace phase 1's hard-coded brief with a module registry driven by the `brief.modules` setting. Add Settings → Today & brief (Brief, Location & weather, Boxes) and a skippable 6-step Today setup with a live preview, which replaces the all-required setup gate. Add Open-Meteo weather as a header chip, backed by a device-local cache.

**Architecture:** Rust owns module metadata and gathering. `nimble-core/src/brief/` holds the `BriefModule` trait and a static registry (`manifests()` + `gather_module()`). It resolves the layout from `brief.modules` and serves the brief-settings view/patch API. `db/briefs.rs` keeps storage and freezes one payload per enabled module into the day's snapshot. Weather sits behind `WeatherProvider` in `api/weather.rs`, is cached in the new device-local `module_cache` table (v25), and is patched into today's snapshot once. The frontend mirrors the registry in `components/today/briefModules.tsx` (`id → { Box, Strip?, Settings?, slot? }`) and reads settings through one zustand store. Today, past briefs, the compact strip, the setup preview and the Settings Boxes list all render from those same layout entries.

**Tech Stack:** Rust (nimble-core, sqlx SQLite, reqwest, chrono/chrono-tz, tokio tests), Tauri 2 commands, React 19 + TS + Tailwind v4 + Base UI (shadcn), zustand, `@dnd-kit/sortable` (already a dependency), `node:test`, Playwright WebKit + axe (`apps/desktop/e2e`), `tools/mock-tauri.js`.

**Spec:** `docs/superpowers/specs/2026-09-25-morning-brief-phases-2-4-addendum.md` (**binding; wins over the base spec**: §1 registry, §2 settings except Goals & momentum, §3 setup + gate removal, §4 weather) + `docs/superpowers/specs/2026-09-23-morning-brief-design.md` (§0 decisions, §3.2 containers, §3.4 setup, §4). Phase 1 for context: `docs/superpowers/plans/2026-09-23-brief-phase-1.md`.

**Lane / branch / worktree:** Lane A. Branch `brief/phase-2` in `/Users/marcosevilla/Developer/marco-task-app/.nimble-wt/brief`, created from `plan/2026-09-25` (= main `fd854b6` + the two specs). Phase 3 (a separate plan, same lane) builds on this registry.

## Scope decisions (for Marco's review)

| Topic | Decision | Why |
|---|---|---|
| Registry dispatch | `trait BriefModule { fn manifest() -> ModuleManifest; async fn gather(&self, ctx: &BriefCtx<'_>, config: &Value) -> Result<Value>; }` exactly as addendum §1. A static `manifests()` plus a `match` in `gather_module()` replaces `Vec<Box<dyn …>>`. | A static `manifest()` plus a native `async fn` is not dyn-compatible, and the crate takes no async-trait dependency. The same `#[allow(async_fn_in_trait)]` pattern is used for `SyncTransport` and `CalendarApi`. |
| Default order | `weather, schedule, priorities, due_today, still_open, habits (off), vault, notes (off)`. With no `brief.modules` key, the enabled boxes are exactly phase 1's plus the weather chip. | Marco's current Today does not change until he customizes it. |
| Snapshot shape | `snapshot_schema` stays 1. Keys are module ids. Every enabled module has a key (`null` = nothing frozen), and phase-1 keys and values are unchanged. `layout_json` now stores the enabled `[{id, enabled, config}]` used that morning; phase-1 rows keep their string ids and `normalizeLayout` reads both. | Additive, so old rows render as they do today. |
| Temperature units | Rust always requests `temperature_unit=celsius`, and the frontend converts. `auto` resolves in the frontend from `navigator.language` (`en-US` → °F). | A units change never refetches or invalidates the cache, and snapshots stay unit-free. Rust has no locale. |
| Weather freshness | Cached per location (`module_cache`, key `lat,lon` to 3 dp) and fresh for 60 min. The snapshot `gather` reads only the cache, never the network. The first successful fetch patches the snapshot's `weather` key once, if it was `null`. | An offline first open still snapshots instantly, and the morning's weather is frozen. |
| Weather chip | Expanded: chip in the page header. Compact: the chip moves into the strip as its first segment, and the header drops it. **UX checkpoint 1.** | Addendum §4 wants the chip in both the header and the compact strip without showing two chips. |
| Brief settings API | `dp.briefSettings: { supported, get(), save(patch) }` (a capability object like `backup`) plus `dp.brief.setNotes(date, notes)`. One `save` writes the whole patch in one transaction and validates first. | Setup must "write all keys in one save". `requires: 'briefSettings'` hides the Today & brief page on the web, where settings are not synced. |
| Settings sections | Three rows on the `brief` page: `today-brief` "Brief", `today-location` "Location & weather", `today-boxes` "Boxes". Lane C appends one "Goals & momentum" row after them (its plan uses id `momentum` with its own `momentum` capability), and its goals writer uses the same keys, JSON encoding and bounds as this plan's setup. | One component per section (addendum §2), and the scroll-spy rail lists each. |
| Model setting | Options `claude-opus-5-5` (default) and `claude-sonnet-5`. Effort `low` (default), `medium`, `high`. Verified against the claude-api skill 2026-09-25. | Haiku 4.5 rejects `effort`, so it isn't offered for the brief. Phase 3 re-verifies when it writes the client. |
| Setup Esc / Skip | Saves the draft as it stands (untouched steps = current values, which are the defaults on a fresh profile) plus `today.setup_completed_at`. | "Esc = Skip setup (writes defaults + `today.setup_completed_at`)" without discarding a city already picked. |
| Setup step 5 | Daily and weekly goal plus days off, writing `goals.daily`, `goals.weekly` and `goals.days_off` only. There is no Momentum toggle: that box arrives in phase 4 (Lane C). | Addendum §2 and the lane rules. |
| Notes and habits boxes | `notes` edits `briefs.notes` for today (debounced, synced), and past days are read-only. `habits` ("Before you start") toggles today's habit log through `goalsStore`. Both are off by default. | Addendum §1 registers them in phase 2. |
| Gate removal | `REQUIRED_SETTINGS` and `SETUP_REQUIRED_KEYS` become empty and `SetupDialog.tsx` is deleted. A missing vault path no longer toasts on Today. | Addendum §3. |

## Global Constraints

- **Schema v25** (current main is 23; C4 takes v24). Every v25 site carries a `// schema-v25` comment (`grep -rn "schema-v25" nimble-core`). **Before merge:** if main's `CURRENT_SCHEMA_VERSION` is 24 (C4 landed), rebase and keep 25. If it is still 23, renumber every marked site to 24 and tell Lane B, which then takes 25.
- `CURRENT_SCHEMA_VERSION` 23 → 25 breaks exact pins: `nimble-core/tests/{schema22_origin_label.rs:30, focus_schema.rs:72, schema20_compatibility.rs:371, backup_export.rs:35, focus_backup.rs:31}`, `src/db/migrations.rs` (v23 test), `src/db/backup.rs:298`, `src/db/export_policy.rs:59`. The installed `dt` must be rebuilt after the app update (`tools/dt/src/profile.rs:43` pins the version exactly). Note this at wrap.
- Migrations: one statement per `;` (the runner splits on `;`). Mobile mirror skipped (dormant).
- `module_cache` is **device-local**: it is not in `sync.rs`'s `sanitize_table_name` allow-list, it has no remote DDL, and export policy marks it reviewed but excluded (`[]`). Settings are not synced either.
- All HTTP happens in Rust. Build Open-Meteo URLs with `reqwest::Url::parse(...).query_pairs_mut().append_pair(...)` (CLAUDE.md gotcha). **No Rust unit test reaches the network**: parse fixtures and use `api::weather::testing::FakeWeather`.
- New Rust commands follow the 6-step "Adding a Rust Command" recipe in `CLAUDE.md`. Shared hot files are **append-only**: `migrations.rs`, `sync.rs`, the `lib.rs` `invoke_handler!` (append after `demo::demo_toggle,`), `services/tauri.ts`, `packages/types`, `tools/mock-tauri.js`, `lib/shortcuts.ts`, `lib/settingsSections.ts`. Every new command gets a mock.
- The contract names from addendum §1 are fixed. Use them exactly: `BriefModule`, `ModuleManifest { id, name, kind, requires, default_enabled, config_schema }`, `ModuleKind { Fixed, Live, Ai }`, `ConfigField { Bool, Choice, Label }`, `BriefCtx`, `components/today/briefModules.tsx` (`BRIEF_MODULES: Record<string, { Box, Strip?, Settings?, slot? }>`). The setting keys are also fixed: `brief.time` (default `06:30`), `brief.location` (`{name, lat, lon, tz}`), `brief.modules`, `brief.model` (`claude-opus-5-5`), `brief.effort` (`low`), `today.setup_completed_at`, `goals.daily` (5), `goals.weekly` (25), `goals.days_off` (`["sat","sun"]`). Lane A never writes `momentum.*` or `karma.*`.
- Web (`TursoProvider`): `briefSettings.supported = false`, `weather.supported = false`, and `brief.setNotes` rejects. Brief reads stay read-only. The Today & brief settings sections are gated `requires: 'briefSettings'`. No setup takeover on the web.
- Design system: tokens from `themes.css`, typography tokens and components (`components/shared/typography`), `components/ui/*`, `surface-panel` / `surface-popover`, and `cn()` for every conditional class. Skeletons shaped like the content, never spinners. Calm single-line empty states. No guilt copy (no "overdue", no streaks). Sentence case. Keyboard-first: setup `↵` continues and `Esc` skips, the Boxes list uses `⌥↑`/`⌥↓`, focus moves to each step's heading and back to the brief after setup.
- React lint (react-hooks v7 + react-refresh): no synchronous `setState` in an effect body (derive drafts: `draft ?? stored`). A `.tsx` file either exports only components (plus string constants), or exports only non-components and defines no local components. That's why `briefModules.tsx` imports its components, and `briefLive.ts` is a `.ts` file.
- Lane rules: don't edit `NEXT.md` (wrap only), Lane C files (`MomentumSettings.tsx`, `db/karma.rs`, the `momentum` module) or C4 files (`LabelPicker`, `components/search/*`). Only `main` is installed.
- No new npm or Cargo dependencies.
- Commands, all run from the lane worktree (`/Users/marcosevilla/Developer/marco-task-app/.nimble-wt/brief`):
  - Rust: `cargo test --workspace --offline`
  - Frontend unit tests: `cd apps/desktop && node --test tests/<file>.test.mjs` (all tests: `node --test tests/*.test.mjs`)
  - Type check and build: `cd apps/desktop && npm run build && npm run build:web`. `npx tsc --noEmit` checks nothing here.
  - Lint: `cd apps/desktop && npx eslint src 2>&1 | tail -1`. The problem count must not rise above the baseline recorded in Setup.
  - E2E (frozen build only): `tools/qa-frozen.sh <sha> /private/tmp/claude-501/qa-b2 4620`, then `cd apps/desktop && BASE_URL=http://localhost:4620 npx playwright test -c e2e`
- Commits: in the lane worktree only, message `feat(brief): …`, ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb
  ```

## Review Focus

1. **An install with no `brief.*` keys (every current profile, Marco's included).** Today must show exactly phase 1's boxes in phase 1's order plus the weather chip, and yesterday's phase-1 snapshot (layout stored as string ids) must still render. Pinned by `defaults_match_the_phase_one_layout` (Task 1), the `normalizeLayout` legacy test (Task 2) and e2e AC10 (Task 10).
2. **Corrupt or foreign stored values** (a hand-edited KV row, a newer build's module id, a config choice that no longer exists, `goals.days_off = "sat"`). Each field falls back to its default, and reading settings never errors. Pinned by `garbage_falls_back_to_defaults` / `config_is_sanitized_against_the_schema` (Task 1) and `corrupt_values_read_as_defaults` (Task 2).
3. **Open-Meteo offline or slow, including at first open.** The snapshot writes immediately without weather, and the chip shows the cached forecast "as of h:mm" or "Weather unavailable". The first successful fetch fills the snapshot once and never overwrites it. Pinned by the `load_forecast` cases and `the_snapshot_freezes_the_cached_forecast_for_that_day_only` (Task 3), plus e2e AC3 (Task 10).
4. **Keys aimed at a control during setup** (Enter in the city search, the time input or a number input, Enter on Back, Esc while a Select or popover is open). None of these may advance or skip setup by accident. Pinned by the `setupKey` tests (Task 8) and e2e AC8 (Enter picks a city and stays on step 2).
5. **Rapid Boxes changes** (toggle, ⌥↓, toggle again inside a second). The last save must equal the last visible order and flags, with no lost toggle. The store applies every patch optimistically and serializes saves, and only the answer to the last outstanding save may replace local state; an older answer would undo queued edits. Pinned by e2e AC6 (Task 10).

## Setup (before Task 1)

- [ ] Create the lane worktree and record baselines:

```bash
cd /Users/marcosevilla/Developer/marco-task-app/nimble
git worktree add /Users/marcosevilla/Developer/marco-task-app/.nimble-wt/brief -b brief/phase-2 plan/2026-09-25
cd /Users/marcosevilla/Developer/marco-task-app/.nimble-wt/brief
ln -s /Users/marcosevilla/Developer/marco-task-app/nimble/node_modules node_modules
ln -s /Users/marcosevilla/Developer/marco-task-app/nimble/apps/desktop/node_modules apps/desktop/node_modules
cargo test --workspace --offline 2>&1 | grep -E "^test result" | tail -3
cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npx eslint src 2>&1 | tail -1
```

Expected: all tests pass. Write the eslint problem count into the ledger as `LINT_BASELINE`.

## File map

| Area | Create | Modify |
|---|---|---|
| Rust registry | `nimble-core/src/brief/{mod.rs, settings.rs}`, `brief/modules/{mod,schedule,priorities,due_today,still_open,habits,notes,vault,weather}.rs` | `nimble-core/src/lib.rs`, `db/briefs.rs`, `types.rs` |
| Weather + cache | `nimble-core/src/api/weather.rs`, `db/module_cache.rs` | `api/mod.rs`, `db/mod.rs`, `db/migrations.rs`, `db/export_policy.rs`, `db/backup.rs`, `db/sync.rs` (test), 5 pinned tests |
| Gate | — | `db/settings.rs`, `lib/setupGate.ts`, `App.tsx`; delete `components/setup/SetupDialog.tsx` |
| Tauri | `src-tauri/src/commands/weather.rs` | `commands/brief.rs`, `commands/mod.rs`, `lib.rs` |
| Contract | — | `packages/types/src/{index.ts,data-provider.ts}`, `services/{tauri.ts,tauri-provider.ts,turso-provider.ts,turso/briefs.ts}`, `tools/mock-tauri.js` |
| Frontend libs/stores | `lib/briefLayout.ts`, `lib/weather.ts`, `stores/briefSettingsStore.ts`, `stores/todaySetupStore.ts`, `hooks/useWeather.ts` | `lib/keyGuard.ts`, `lib/shortcuts.ts`, `lib/settingsSections.ts`, `lib/errors.ts`, `lib/todayBrief.ts`, `hooks/useObsidian.ts` |
| Today | `components/today/{briefModules.tsx, briefLive.ts, ModuleBox.tsx, ModulePlaceholder.tsx, BriefMenu.tsx, WeatherChip.tsx, CitySearch.tsx, BoxesList.tsx, stripSegment.ts}`, `components/today/modules/*.tsx`, `components/today/setup/{TodaySetup,SetupSteps,SetupPreview}.tsx` | `pages/TodayPage.tsx`, `today/{PastBrief,BriefStrip,ScheduleBox,StillOpenBox}.tsx` |
| Settings | `components/settings/{SettingsFields,TodayBriefSettings,BriefLocationSettings,BriefBoxesSettings}.tsx` | `components/pages/SettingsPage.tsx` |
| Tests | `tests/{briefLayout,weather,briefCommands}.test.mjs`, `e2e/b2-brief-phase2.spec.ts` | `tests/{settingsSections,setupGate,keyGuard,shortcuts,errors}.test.mjs` |

---

### Task 1: Rust module registry, layout from `brief.modules`, gather moved into modules

**Files:**
- Create: `nimble-core/src/brief/mod.rs`, `nimble-core/src/brief/settings.rs`, `nimble-core/src/brief/modules/{mod.rs, schedule.rs, priorities.rs, due_today.rs, still_open.rs, habits.rs, notes.rs, vault.rs}`
- Modify: `nimble-core/src/lib.rs` (add `pub mod brief;`), `nimble-core/src/db/briefs.rs` (drop `LAYOUT_V1`, `gather`, `task_ref`, `priorities_for`, and the two row constants; `ensure_snapshot` uses the registry)

**Interfaces:**
- Consumes: `crate::api::calendar::read_cached_events(pool, date) -> Result<Vec<CalendarEventWithFeed>>`; `crate::db::tasks::get_local_tasks(pool, None, Some(date), false)`; `crate::db::settings::get_setting`.
- Produces (**contract for phase 3 and Lane C**):

```rust
// nimble_core::brief
pub enum ModuleKind { Fixed, Live, Ai }                       // serde: "fixed" | "live" | "ai"
pub enum Integration { Calendar, Tasks, Vault, Ai, Location } // serde snake_case
pub struct ChoiceOption { pub value: serde_json::Value, pub label: &'static str }
pub enum ConfigField {                                        // serde tag "type": "bool" | "choice" | "label"
    Bool { key: &'static str, label: &'static str, default: bool },
    Choice { key: &'static str, label: &'static str, options: Vec<ChoiceOption>, default: Value },
    Label { key: &'static str, label: &'static str, default_name: &'static str },
}
impl ConfigField { pub fn key(&self) -> &'static str }
pub struct ModuleManifest { pub id: &'static str, pub name: &'static str, pub kind: ModuleKind,
    pub requires: Vec<Integration>, pub default_enabled: bool, pub config_schema: Vec<ConfigField> }
pub struct BriefCtx<'a> { pub pool: &'a SqlitePool, pub date: &'a str }
#[allow(async_fn_in_trait)]
pub trait BriefModule {
    fn manifest() -> ModuleManifest;
    async fn gather(&self, ctx: &BriefCtx<'_>, config: &Value) -> crate::Result<Value>;
}
pub struct LayoutEntry { pub id: String, pub enabled: bool, pub config: Value }  // Serialize + Deserialize
pub fn manifests() -> Vec<ModuleManifest>                     // registry order = default order
pub async fn gather_module(id: &str, ctx: &BriefCtx<'_>, config: &Value) -> Option<crate::Result<Value>>
pub async fn gather_snapshot(ctx: &BriefCtx<'_>, layout: &[LayoutEntry]) -> (Value, bool) // (payloads, partial)
// nimble_core::brief::settings
pub const KEY_MODULES: &str = "brief.modules";
pub fn resolve_layout(stored: Option<&str>) -> Vec<LayoutEntry>
pub fn merge_config(schema: &[ConfigField], stored: &Value) -> Value
pub async fn load_layout(pool: &SqlitePool) -> crate::Result<Vec<LayoutEntry>>
```

Module ids and config (addendum §1): `schedule {tomorrow_peek: bool = true, free_block: bool = true}` · `priorities {count: 1|2|3 = 3}` · `due_today {show_completed: bool = true}` · `still_open {count: 3|5|10 = 5}` · `habits` ("Before you start", off) · `notes` (off) · `vault` ("From your vault"). `weather` is registered in Task 3. **Adding a module (phase 3 `quick_wins`, phase 4 `momentum`) means one file under `brief/modules/`, one line in `manifests()` and one arm in `gather_module()`.** Modules that aren't in a stored list are appended, so new modules appear after an update.

- [ ] **Step 1: Write the failing tests.** Create `nimble-core/src/brief/settings.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::brief::ConfigField;
    use serde_json::json;

    fn enabled(l: &[crate::brief::LayoutEntry]) -> Vec<&str> {
        l.iter().filter(|e| e.enabled).map(|e| e.id.as_str()).collect()
    }

    #[test]
    fn defaults_match_the_phase_one_layout() {
        let l = resolve_layout(None);
        assert_eq!(enabled(&l), ["schedule", "priorities", "due_today", "still_open", "vault"]);
        let off: Vec<&str> = l.iter().filter(|e| !e.enabled).map(|e| e.id.as_str()).collect();
        assert_eq!(off, ["habits", "notes"]);
        assert_eq!(l.iter().find(|e| e.id == "still_open").unwrap().config, json!({"count": 5}));
        assert_eq!(l.iter().find(|e| e.id == "schedule").unwrap().config, json!({"tomorrow_peek": true, "free_block": true}));
    }

    #[test]
    fn stored_order_wins_unknown_and_duplicate_ids_drop_missing_modules_append() {
        let l = resolve_layout(Some(
            r#"[{"id":"vault","enabled":false},{"id":"quick_wins","enabled":true},{"id":"schedule"},{"id":"vault","enabled":true}]"#,
        ));
        let ids: Vec<&str> = l.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["vault", "schedule", "priorities", "due_today", "still_open", "habits", "notes"]);
        assert!(!l[0].enabled, "the first vault entry wins");
        assert!(l[1].enabled, "a missing `enabled` reads as on");
    }

    #[test]
    fn config_is_sanitized_against_the_schema() {
        let l = resolve_layout(Some(
            r#"[{"id":"still_open","enabled":true,"config":{"count":7,"extra":1}},
                {"id":"schedule","enabled":true,"config":{"tomorrow_peek":"no","free_block":false}}]"#,
        ));
        assert_eq!(l[0].config, json!({"count": 5}), "7 is not an option; unknown keys drop");
        assert_eq!(l[1].config, json!({"tomorrow_peek": true, "free_block": false}));
    }

    #[test]
    fn label_fields_fall_back_to_their_default_name() {
        let schema = [ConfigField::Label { key: "help_label", label: "Help label", default_name: "needs-claude" }];
        assert_eq!(merge_config(&schema, &json!({"help_label": "  "})), json!({"help_label": "needs-claude"}));
        assert_eq!(merge_config(&schema, &json!({"help_label": " ai "})), json!({"help_label": "ai"}));
    }

    #[test]
    fn garbage_falls_back_to_defaults() {
        for s in ["not json", "{}", r#"[1, null, {"enabled":true}]"#, ""] {
            assert_eq!(resolve_layout(Some(s)), resolve_layout(None), "{s}");
        }
    }
}
```

Append to `nimble-core/src/db/briefs.rs`'s `mod tests` (keep the existing tests), and **replace** the line `assert_eq!(b.layout, serde_json::json!(super::LAYOUT_V1));` in `first_open_writes_one_snapshot_with_split_lists` with the two assertions below:

```rust
        // (replaces the LAYOUT_V1 assertion)
        let ids: Vec<&str> = b.layout.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["schedule", "priorities", "due_today", "still_open", "vault"]);
        let mut keys: Vec<&String> = b.snapshot.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["due_today", "priorities", "schedule", "still_open", "vault"]);
```

```rust
    #[tokio::test]
    async fn snapshot_follows_brief_modules() {
        let pool = test_pool().await;
        for (c, d) in [("A", "2026-06-01"), ("B", "2026-07-01"), ("C", "2026-08-01"), ("D", "2026-09-01"), ("Today", "2026-09-23")] {
            task(&pool, c, d).await;
        }
        crate::db::settings::set_setting(&pool, "brief.modules",
            r#"[{"id":"due_today","enabled":true,"config":{}},{"id":"schedule","enabled":false,"config":{}},
                {"id":"still_open","enabled":true,"config":{"count":3}}]"#).await.unwrap();
        let b = super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap().unwrap();
        let ids: Vec<&str> = b.layout.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["due_today", "still_open", "priorities", "vault"], "stored order, then enabled defaults");
        assert_eq!(b.layout[1]["config"]["count"], 3, "the layout records the config used");
        assert!(b.snapshot.get("schedule").is_none(), "a hidden module is not gathered");
        assert_eq!(b.snapshot["still_open"]["total"], 4);
        assert_eq!(b.snapshot["still_open"]["oldest"].as_array().unwrap().len(), 3);
        assert_eq!(b.snapshot["due_today"][0]["content"], "Today");
    }

    #[tokio::test]
    async fn habits_payload_marks_the_days_check_ins() {
        let pool = test_pool().await;
        for (id, name, active, pos) in [("h1", "Stretch", 1, 0), ("h2", "Read", 1, 1), ("h3", "Old", 0, 2)] {
            sqlx::query("INSERT INTO habits (id, name, active, position) VALUES (?, ?, ?, ?)")
                .bind(id).bind(name).bind(active).bind(pos).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO habit_logs (id, habit_id, date) VALUES ('l1', 'h1', '2026-09-23')").execute(&pool).await.unwrap();
        crate::db::settings::set_setting(&pool, "brief.modules", r#"[{"id":"habits","enabled":true,"config":{}}]"#).await.unwrap();
        let b = super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap().unwrap();
        let h = b.snapshot["habits"].as_array().unwrap();
        assert_eq!(h.len(), 2, "inactive habits are left out");
        assert_eq!((h[0]["name"].as_str(), h[0]["done"].as_bool()), (Some("Stretch"), Some(true)));
        assert_eq!((h[1]["name"].as_str(), h[1]["done"].as_bool()), (Some("Read"), Some(false)));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --offline -p nimble-core --lib brief:: briefs::`
Expected: FAIL to compile (`resolve_layout`, `crate::brief` not found).

- [ ] **Step 3: Write `nimble-core/src/brief/mod.rs`**

```rust
//! Morning-brief module registry (addendum 2026-09-25 §1).
//!
//! Every box on Today is a module: a manifest the UI renders its settings
//! from, plus a `gather` whose payload is frozen into that day's snapshot.
//! `BriefModule` has a static `manifest()` and a native `async fn`, so it is
//! not dyn-compatible (and the crate takes no async-trait dependency): the
//! registry is two static lists that must name the same ids — `manifests()`
//! (default order + metadata) and `gather_module()` (dispatch). Adding a
//! module = one file under `modules/`, one line in each list. The
//! `every_manifest_dispatches…` test catches a half-registered one.

pub mod modules;
pub mod settings;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModuleKind { Fixed, Live, Ai }

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Integration { Calendar, Tasks, Vault, Ai, Location }

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ChoiceOption {
    pub value: Value,
    pub label: &'static str,
}

/// The closed set of per-module options (addendum §1), serialized with a
/// `type` tag so the frontend renders a control per field.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConfigField {
    Bool { key: &'static str, label: &'static str, default: bool },
    Choice { key: &'static str, label: &'static str, options: Vec<ChoiceOption>, default: Value },
    /// A label picker (phase 3 Quick wins); stored as the label's name.
    Label { key: &'static str, label: &'static str, default_name: &'static str },
}

impl ConfigField {
    pub fn key(&self) -> &'static str {
        match self {
            Self::Bool { key, .. } | Self::Choice { key, .. } | Self::Label { key, .. } => *key,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ModuleManifest {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: ModuleKind,
    pub requires: Vec<Integration>,
    pub default_enabled: bool,
    pub config_schema: Vec<ConfigField>,
}

/// What a module may read while gathering. Later phases may add fields
/// (an LLM client, the clock); modules only ever borrow it.
pub struct BriefCtx<'a> {
    pub pool: &'a SqlitePool,
    pub date: &'a str,
}

#[allow(async_fn_in_trait)]
pub trait BriefModule {
    fn manifest() -> ModuleManifest;
    async fn gather(&self, ctx: &BriefCtx<'_>, config: &Value) -> crate::Result<Value>;
}

/// One row of `brief.modules`, and of a snapshot's `layout_json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LayoutEntry {
    pub id: String,
    pub enabled: bool,
    #[serde(default)]
    pub config: Value,
}

/// Every registered module, in default order.
pub fn manifests() -> Vec<ModuleManifest> {
    use modules::*;
    vec![
        schedule::Schedule::manifest(),
        priorities::Priorities::manifest(),
        due_today::DueToday::manifest(),
        still_open::StillOpen::manifest(),
        habits::Habits::manifest(),
        vault::Vault::manifest(),
        notes::Notes::manifest(),
    ]
}

/// Dispatch one module's gather. `None` = id not registered in this build.
pub async fn gather_module(id: &str, ctx: &BriefCtx<'_>, config: &Value) -> Option<crate::Result<Value>> {
    use modules::*;
    Some(match id {
        "schedule" => schedule::Schedule.gather(ctx, config).await,
        "priorities" => priorities::Priorities.gather(ctx, config).await,
        "due_today" => due_today::DueToday.gather(ctx, config).await,
        "still_open" => still_open::StillOpen.gather(ctx, config).await,
        "habits" => habits::Habits.gather(ctx, config).await,
        "vault" => vault::Vault.gather(ctx, config).await,
        "notes" => notes::Notes.gather(ctx, config).await,
        _ => return None,
    })
}

/// Every enabled module's payload keyed by id. A module that errors is
/// logged and frozen as null, so one bad source never blocks the day's
/// snapshot; the flag lets the caller mark the row `partial`.
pub async fn gather_snapshot(ctx: &BriefCtx<'_>, layout: &[LayoutEntry]) -> (Value, bool) {
    let mut out = serde_json::Map::new();
    let mut partial = false;
    for entry in layout.iter().filter(|e| e.enabled) {
        let Some(result) = gather_module(&entry.id, ctx, &entry.config).await else { continue };
        let payload = result.unwrap_or_else(|e| {
            log::warn!("brief module {} failed to gather: {e}", entry.id);
            partial = true;
            Value::Null
        });
        out.insert(entry.id.clone(), payload);
    }
    (Value::Object(out), partial)
}

pub(crate) fn config_u64(config: &Value, key: &str, default: u64) -> u64 {
    config.get(key).and_then(Value::as_u64).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn every_manifest_dispatches_and_unknown_ids_do_not() {
        let pool = test_pool().await;
        let ctx = BriefCtx { pool: &pool, date: "2026-09-25" };
        for m in manifests() {
            assert!(gather_module(m.id, &ctx, &Value::Null).await.is_some(), "{} has no gather arm", m.id);
        }
        assert!(gather_module("quick_wins", &ctx, &Value::Null).await.is_none());
    }

    #[test]
    fn manifest_ids_and_config_keys_are_unique() {
        let ms = manifests();
        let mut ids: Vec<&str> = ms.iter().map(|m| m.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), ms.len());
        for m in &ms {
            let mut keys: Vec<&str> = m.config_schema.iter().map(ConfigField::key).collect();
            let n = keys.len();
            keys.sort();
            keys.dedup();
            assert_eq!(keys.len(), n, "{} repeats a config key", m.id);
        }
    }

    #[test]
    fn manifests_serialize_for_the_frontend() {
        let v = serde_json::to_value(manifests()).unwrap();
        let still = v.as_array().unwrap().iter().find(|m| m["id"] == "still_open").unwrap();
        assert_eq!(still["kind"], "fixed");
        assert_eq!(still["name"], "Still open");
        assert_eq!(still["config_schema"][0], serde_json::json!({
            "type": "choice", "key": "count", "label": "How many",
            "options": [{"value": 3, "label": "3"}, {"value": 5, "label": "5"}, {"value": 10, "label": "10"}],
            "default": 5
        }));
    }

    #[tokio::test]
    async fn a_failing_module_freezes_as_null_and_flags_partial() {
        let pool = test_pool().await;
        let ctx = BriefCtx { pool: &pool, date: "not-a-date" };
        let (snap, partial) = gather_snapshot(&ctx, &settings::resolve_layout(None)).await;
        assert!(partial);
        assert!(snap["schedule"].is_null(), "schedule can't parse the date");
        assert!(snap.get("due_today").is_some(), "the other modules still gather");
    }
}
```

- [ ] **Step 4: Write the modules.** `nimble-core/src/brief/modules/mod.rs`:

```rust
//! One file per brief module (addendum §1). Each gathers from local data
//! only, never the network, so an offline first open still snapshots.

pub mod due_today;
pub mod habits;
pub mod notes;
pub mod priorities;
pub mod schedule;
pub mod still_open;
pub mod vault;

use serde_json::{json, Value};

use crate::brief::BriefCtx;
use crate::types::LocalTask;

/// A task as a snapshot freezes it: `{id, content, due_date, priority, project_id}`.
pub(crate) fn task_ref(t: &LocalTask) -> Value {
    json!({"id": t.id, "content": t.content, "due_date": t.due_date, "priority": t.priority, "project_id": t.project_id})
}

/// Open top-level tasks due on or before the brief's date.
pub(crate) async fn open_top_level(ctx: &BriefCtx<'_>) -> crate::Result<Vec<LocalTask>> {
    Ok(crate::db::tasks::get_local_tasks(ctx.pool, None, Some(ctx.date), false)
        .await?
        .into_iter()
        .filter(|t| t.parent_id.is_none())
        .collect())
}
```

`nimble-core/src/brief/modules/schedule.rs`:

```rust
use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ConfigField, Integration, ModuleKind, ModuleManifest};

const TOMORROW_SHOWN: usize = 2;

pub struct Schedule;

impl BriefModule for Schedule {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "schedule",
            name: "Schedule",
            kind: ModuleKind::Fixed,
            requires: vec![Integration::Calendar],
            default_enabled: true,
            config_schema: vec![
                ConfigField::Bool { key: "tomorrow_peek", label: "Tomorrow peek", default: true },
                ConfigField::Bool { key: "free_block", label: "Free block", default: true },
            ],
        }
    }

    /// Cached events only. `tomorrow_peek` / `free_block` are display
    /// options: the payload always carries both, so a past brief can render
    /// whatever its recorded config says.
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let events = crate::api::calendar::read_cached_events(ctx.pool, ctx.date).await.unwrap_or_default();
        let tomorrow_date = (chrono::NaiveDate::parse_from_str(ctx.date, "%Y-%m-%d")
            .map_err(|e| crate::Error::Other(e.to_string()))?
            + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
        let tomorrow: Vec<_> = crate::api::calendar::read_cached_events(ctx.pool, &tomorrow_date)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|e| !e.event.all_day)
            .take(TOMORROW_SHOWN)
            .collect();
        Ok(json!({"events": events, "tomorrow": tomorrow}))
    }
}
```

`nimble-core/src/brief/modules/priorities.rs`:

```rust
use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ChoiceOption, ConfigField, Integration, ModuleKind, ModuleManifest};
use crate::types::Priority;

pub struct Priorities;

impl BriefModule for Priorities {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "priorities",
            name: "Top priorities",
            kind: ModuleKind::Ai,
            requires: vec![Integration::Ai],
            default_enabled: true,
            config_schema: vec![ConfigField::Choice {
                key: "count",
                label: "How many",
                options: vec![
                    ChoiceOption { value: json!(1), label: "1" },
                    ChoiceOption { value: json!(2), label: "2" },
                    ChoiceOption { value: json!(3), label: "3" },
                ],
                default: json!(3),
            }],
        }
    }

    /// The day's cached priorities: null until generated
    /// (`db::briefs::set_priorities` patches them in later).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let stored: Option<Option<String>> = sqlx::query_scalar("SELECT top_priorities FROM daily_state WHERE date = ?")
            .bind(ctx.date)
            .fetch_optional(ctx.pool)
            .await?;
        let list: Option<Vec<Priority>> = stored.flatten().and_then(|j| serde_json::from_str(&j).ok());
        Ok(json!(list))
    }
}
```

`nimble-core/src/brief/modules/due_today.rs`:

```rust
use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ConfigField, ModuleKind, ModuleManifest};

pub struct DueToday;

impl BriefModule for DueToday {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "due_today",
            name: "Due today",
            kind: ModuleKind::Live,
            requires: vec![],
            default_enabled: true,
            config_schema: vec![ConfigField::Bool { key: "show_completed", label: "Show completed", default: true }],
        }
    }

    /// The morning's open top-level tasks due that day (the box itself is live).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let tasks = super::open_top_level(ctx).await?;
        Ok(json!(tasks
            .iter()
            .filter(|t| t.due_date.as_deref() == Some(ctx.date))
            .map(super::task_ref)
            .collect::<Vec<_>>()))
    }
}
```

`nimble-core/src/brief/modules/still_open.rs`:

```rust
use serde_json::{json, Value};

use crate::brief::{config_u64, BriefCtx, BriefModule, ChoiceOption, ConfigField, ModuleKind, ModuleManifest};

pub struct StillOpen;

impl BriefModule for StillOpen {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "still_open",
            name: "Still open",
            kind: ModuleKind::Fixed,
            requires: vec![],
            default_enabled: true,
            config_schema: vec![ConfigField::Choice {
                key: "count",
                label: "How many",
                options: vec![
                    ChoiceOption { value: json!(3), label: "3" },
                    ChoiceOption { value: json!(5), label: "5" },
                    ChoiceOption { value: json!(10), label: "10" },
                ],
                default: json!(5),
            }],
        }
    }

    /// The `count` oldest open top-level tasks due before the day, plus the total.
    async fn gather(&self, ctx: &BriefCtx<'_>, config: &Value) -> crate::Result<Value> {
        let count = config_u64(config, "count", 5) as usize;
        let mut still: Vec<_> = super::open_top_level(ctx)
            .await?
            .into_iter()
            .filter(|t| t.due_date.as_deref().is_some_and(|d| d < ctx.date))
            .collect();
        still.sort_by(|a, b| a.due_date.cmp(&b.due_date));
        Ok(json!({
            "total": still.len(),
            "oldest": still.iter().take(count).map(super::task_ref).collect::<Vec<_>>(),
        }))
    }
}
```

`nimble-core/src/brief/modules/habits.rs`:

```rust
use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ModuleKind, ModuleManifest};

pub struct Habits;

impl BriefModule for Habits {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "habits",
            name: "Before you start",
            kind: ModuleKind::Live,
            requires: vec![],
            default_enabled: false,
            config_schema: vec![],
        }
    }

    /// Active habits and whether each was checked off that day (no counts,
    /// no history: base spec §3.2 #8).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let rows: Vec<(String, String, String, String, bool)> = sqlx::query_as(
            "SELECT h.id, h.name, h.icon, h.color,
                    EXISTS(SELECT 1 FROM habit_logs l WHERE l.habit_id = h.id AND l.date = ?)
             FROM habits h WHERE h.active = 1 ORDER BY h.position, h.created_at",
        )
        .bind(ctx.date)
        .fetch_all(ctx.pool)
        .await?;
        Ok(json!(rows
            .into_iter()
            .map(|(id, name, icon, color, done)| json!({"id": id, "name": name, "icon": icon, "color": color, "done": done}))
            .collect::<Vec<_>>()))
    }
}
```

`nimble-core/src/brief/modules/notes.rs`:

```rust
use serde_json::Value;

use crate::brief::{BriefCtx, BriefModule, ModuleKind, ModuleManifest};

pub struct Notes;

impl BriefModule for Notes {
    fn manifest() -> ModuleManifest {
        ModuleManifest { id: "notes", name: "Notes", kind: ModuleKind::Live, requires: vec![], default_enabled: false, config_schema: vec![] }
    }

    /// Notes live in `briefs.notes`, not the snapshot.
    async fn gather(&self, _ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        Ok(Value::Null)
    }
}
```

`nimble-core/src/brief/modules/vault.rs`:

```rust
use serde_json::Value;

use crate::brief::{BriefCtx, BriefModule, Integration, ModuleKind, ModuleManifest};

pub struct Vault;

impl BriefModule for Vault {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "vault",
            name: "From your vault",
            kind: ModuleKind::Fixed,
            requires: vec![Integration::Vault],
            default_enabled: true,
            config_schema: vec![],
        }
    }

    /// The legacy markdown brief is read from the vault by date at render
    /// time (and the box hides when there's no file), so nothing is frozen.
    async fn gather(&self, _ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        Ok(Value::Null)
    }
}
```

- [ ] **Step 5: Write the layout half of `nimble-core/src/brief/settings.rs`** (above the test module from Step 1):

```rust
//! Brief settings in the KV store (addendum §2). This task adds the
//! layout: `brief.modules` = ordered `[{id, enabled, config}]`. Unknown ids
//! are skipped, duplicates keep the first, registered modules missing from
//! the list are appended with their defaults, and every config is sanitized
//! against the module's schema. Reading never fails: garbage reads as defaults.

use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::brief::{manifests, ConfigField, LayoutEntry};

pub const KEY_MODULES: &str = "brief.modules";

#[derive(Deserialize)]
struct StoredEntry {
    id: String,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    #[serde(default)]
    config: Value,
}

fn enabled_by_default() -> bool {
    true
}

pub fn resolve_layout(stored: Option<&str>) -> Vec<LayoutEntry> {
    let registry = manifests();
    let items: Vec<Value> = stored.and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
    let mut out: Vec<LayoutEntry> = Vec::new();
    for item in items {
        let Ok(entry) = serde_json::from_value::<StoredEntry>(item) else { continue };
        let Some(m) = registry.iter().find(|m| m.id == entry.id) else { continue };
        if out.iter().any(|e| e.id == entry.id) {
            continue;
        }
        out.push(LayoutEntry { config: merge_config(&m.config_schema, &entry.config), id: entry.id, enabled: entry.enabled });
    }
    for m in &registry {
        if !out.iter().any(|e| e.id == m.id) {
            out.push(LayoutEntry {
                id: m.id.to_string(),
                enabled: m.default_enabled,
                config: merge_config(&m.config_schema, &Value::Null),
            });
        }
    }
    out
}

/// Exactly the schema's keys: a stored value when it is valid for the field,
/// else the field's default.
pub fn merge_config(schema: &[ConfigField], stored: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for field in schema {
        let value = match field {
            ConfigField::Bool { key, default, .. } => Value::Bool(stored.get(*key).and_then(Value::as_bool).unwrap_or(*default)),
            ConfigField::Choice { key, options, default, .. } => stored
                .get(*key)
                .filter(|v| options.iter().any(|o| o.value == **v))
                .cloned()
                .unwrap_or_else(|| default.clone()),
            ConfigField::Label { key, default_name, .. } => Value::String(
                stored.get(*key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).unwrap_or(*default_name).to_string(),
            ),
        };
        out.insert(field.key().to_string(), value);
    }
    Value::Object(out)
}

pub async fn load_layout(pool: &SqlitePool) -> crate::Result<Vec<LayoutEntry>> {
    let stored = crate::db::settings::get_setting(pool, KEY_MODULES).await?;
    Ok(resolve_layout(stored.as_deref()))
}
```

Add `pub mod brief;` to `nimble-core/src/lib.rs` (after `pub mod api;`).

- [ ] **Step 6: Point `db/briefs.rs` at the registry.** Delete `LAYOUT_V1`, `STILL_OPEN_SHOWN`, `TOMORROW_SHOWN`, `task_ref`, `priorities_for` and `gather`, and drop `Priority` from the `use` only if nothing else uses it (`set_priorities` still does, so keep it). Replace `ensure_snapshot` with:

```rust
/// Today's snapshot, written on first call from the enabled modules in
/// `brief.modules` order. Past and future dates are only ever read: a
/// missing past brief stays missing (never fabricated from today's data).
pub async fn ensure_snapshot(pool: &SqlitePool, date: &str, today: &str) -> crate::Result<Option<Brief>> {
    if let Some(b) = get_brief(pool, date).await? { return Ok(Some(b)); }
    if date != today { return Ok(None); }
    let layout = crate::brief::settings::load_layout(pool).await?;
    let (snapshot, partial) = crate::brief::gather_snapshot(&crate::brief::BriefCtx { pool, date }, &layout).await;
    let used: Vec<_> = layout.into_iter().filter(|e| e.enabled).collect();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let brief = Brief {
        date: date.into(), version: 1, status: if partial { "partial" } else { "ready" }.into(), source: "nimble".into(),
        layout: serde_json::json!(used), snapshot,
        snapshot_schema: SNAPSHOT_SCHEMA, generated_at: now.clone(), updated_at: now,
    };
    let inserted = sqlx::query(&format!("INSERT OR IGNORE INTO briefs ({COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"))
        .bind(&brief.date).bind(brief.version).bind(&brief.status).bind(&brief.source)
        .bind(brief.layout.to_string()).bind(brief.snapshot.to_string()).bind(brief.snapshot_schema)
        .bind(&brief.generated_at).bind(&brief.updated_at)
        .execute(pool).await?.rows_affected();
    if inserted == 1 {
        sync::append_sync_log(pool, "briefs", date, "INSERT", None, Some(&sync_snapshot(&brief))).await.ok();
    }
    get_brief(pool, date).await
}
```

Update the module doc comment's first line to `//! Per-day morning-brief snapshots (phase 1 storage; phase 2 gathers through crate::brief).`

- [ ] **Step 7: Run the tests**

Run: `cargo test --offline -p nimble-core --lib brief:: briefs::`
Expected: PASS (new tests plus the four existing `briefs::tests`). Then `cargo test --workspace --offline 2>&1 | grep -E "FAILED|panicked" -A3` shows nothing.

- [ ] **Step 8: Commit**

```bash
git add nimble-core/src/brief nimble-core/src/lib.rs nimble-core/src/db/briefs.rs
git commit -m "feat(brief): module registry — manifests, gather per module, layout from brief.modules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 2: Brief settings API (keys, view/patch, notes) end to end: Rust, commands, DataProvider, store, mock

**Files:**
- Modify: `nimble-core/src/brief/settings.rs` (keys, view, patch, save), `nimble-core/src/types.rs` (`BriefLocation`, `Brief.notes`), `nimble-core/src/db/briefs.rs` (`notes` column, `set_notes`)
- Modify: `apps/desktop/src-tauri/src/commands/brief.rs`, `apps/desktop/src-tauri/src/lib.rs`
- Modify: `packages/types/src/index.ts`, `packages/types/src/data-provider.ts`, `apps/desktop/src/services/{tauri.ts, tauri-provider.ts, turso-provider.ts, turso/briefs.ts}`, `tools/mock-tauri.js`
- Create: `apps/desktop/src/lib/briefLayout.ts`, `apps/desktop/src/stores/briefSettingsStore.ts`, `apps/desktop/tests/briefLayout.test.mjs`

**Interfaces:**
- Consumes: Task 1's `resolve_layout`, `LayoutEntry`, `manifests()`, `ModuleManifest`.
- Produces (**contract**):

```rust
// nimble_core::types
pub struct BriefLocation { pub name: String, pub lat: f64, pub lon: f64, pub tz: String }
pub struct Brief { /* phase-1 fields */ pub notes: Option<String> }
// nimble_core::brief::settings
pub const KEY_TIME, KEY_LOCATION, KEY_MODEL, KEY_EFFORT, KEY_SETUP_COMPLETED_AT, KEY_GOALS_DAILY, KEY_GOALS_WEEKLY, KEY_GOALS_DAYS_OFF: &str;
pub const MODELS: [&str; 2] = ["claude-opus-5-5", "claude-sonnet-5"];
pub const EFFORTS: [&str; 3] = ["low", "medium", "high"];
pub struct GoalSettings { pub daily: i64, pub weekly: i64, pub days_off: Vec<String> }
pub struct BriefSources { pub calendar: bool, pub tasks: bool, pub vault: bool, pub ai: bool }
pub struct BriefSettingsView { pub time: String, pub location: Option<BriefLocation>, pub modules: Vec<LayoutEntry>,
    pub model: String, pub effort: String, pub setup_completed_at: Option<String>, pub goals: GoalSettings,
    pub sources: BriefSources, pub manifests: Vec<ModuleManifest> }
pub struct GoalsPatch { pub daily: Option<i64>, pub weekly: Option<i64>, pub days_off: Option<Vec<String>> }
pub struct BriefSettingsPatch { pub time: Option<String>, pub location: Option<Option<BriefLocation>>, /* null clears */
    pub modules: Option<Vec<LayoutEntry>>, pub model: Option<String>, pub effort: Option<String>,
    pub goals: Option<GoalsPatch>, pub complete_setup: bool }
pub async fn load_view(pool: &SqlitePool) -> crate::Result<BriefSettingsView>;
pub async fn save_patch(pool: &SqlitePool, patch: BriefSettingsPatch, now: &str) -> crate::Result<BriefSettingsView>;
pub async fn read_location(pool: &SqlitePool) -> crate::Result<Option<BriefLocation>>;
// nimble_core::db::briefs
pub async fn set_notes(pool: &SqlitePool, date: &str, today: &str, notes: &str) -> crate::Result<()>;
// Tauri: brief_settings_get() -> BriefSettingsView · brief_settings_save(patch) -> BriefSettingsView · brief_set_notes(date, notes)
```

```ts
// @nimble/types
export interface BriefSettingsCapability { supported: boolean; get(): Promise<BriefSettings>; save(patch: BriefSettingsPatch): Promise<BriefSettings> }
// DataProvider: briefSettings: BriefSettingsCapability; brief.setNotes(date: string, notes: string): Promise<void>
// stores/briefSettingsStore.ts
export const useBriefSettingsStore: UseBoundStore<{ settings: BriefSettings | null; status: 'idle'|'loading'|'ready'|'unsupported'|'error'; load(force?: boolean): Promise<void>; save(patch: BriefSettingsPatch): Promise<boolean> }>
// lib/briefLayout.ts
export const FALLBACK_LAYOUT: BriefLayoutEntry[]
export function normalizeLayout(layout: unknown): BriefLayoutEntry[]
export function configValue<T extends boolean | number | string>(config: Record<string, unknown> | undefined, key: string, fallback: T): T
export function setModuleConfig(entries, id, patch): BriefLayoutEntry[]
export function setModuleEnabled(entries, id, enabled): BriefLayoutEntry[]
export function applySettingsPatch(settings: BriefSettings, patch: BriefSettingsPatch): BriefSettings
```

- [ ] **Step 1: Write the failing Rust tests.** Append to `nimble-core/src/brief/settings.rs`'s `mod tests`:

```rust
    use crate::brief::LayoutEntry;
    use crate::test_util::test_pool;
    use crate::types::BriefLocation;

    const NOW: &str = "2026-09-25 07:00:00";

    fn sf() -> BriefLocation {
        BriefLocation { name: "San Francisco, California".into(), lat: 37.7749, lon: -122.4194, tz: "America/Los_Angeles".into() }
    }

    #[tokio::test]
    async fn an_empty_profile_reads_every_default() {
        let pool = test_pool().await;
        let v = load_view(&pool).await.unwrap();
        assert_eq!((v.time.as_str(), v.model.as_str(), v.effort.as_str()), ("06:30", "claude-opus-5-5", "low"));
        assert!(v.location.is_none());
        assert!(v.setup_completed_at.is_none());
        assert_eq!(v.goals, GoalSettings { daily: 5, weekly: 25, days_off: vec!["sat".into(), "sun".into()] });
        assert_eq!(v.sources, BriefSources::default());
        assert_eq!(v.modules, resolve_layout(None));
        assert_eq!(v.manifests.len(), crate::brief::manifests().len());
    }

    #[tokio::test]
    async fn corrupt_values_read_as_defaults() {
        let pool = test_pool().await;
        for (k, val) in [
            ("brief.time", "25:99"), ("brief.location", r#"{"name":"X"}"#), ("brief.model", "gpt-5"),
            ("brief.effort", "max"), ("goals.daily", "0"), ("goals.weekly", "lots"),
            ("goals.days_off", r#""sat""#), ("brief.modules", "{"),
        ] {
            crate::db::settings::set_setting(&pool, k, val).await.unwrap();
        }
        let v = load_view(&pool).await.unwrap();
        assert_eq!((v.time.as_str(), v.model.as_str(), v.effort.as_str()), ("06:30", "claude-opus-5-5", "low"));
        assert!(v.location.is_none());
        assert_eq!((v.goals.daily, v.goals.weekly), (5, 25));
        assert_eq!(v.goals.days_off, ["sat", "sun"]);
        assert_eq!(v.modules, resolve_layout(None));
    }

    #[tokio::test]
    async fn one_save_writes_every_key_and_marks_setup_complete() {
        let pool = test_pool().await;
        let mut modules = resolve_layout(None);
        modules.swap(0, 1);
        let patch = BriefSettingsPatch {
            time: Some("07:15".into()),
            location: Some(Some(sf())),
            modules: Some(modules.clone()),
            model: Some("claude-sonnet-5".into()),
            effort: Some("medium".into()),
            goals: Some(GoalsPatch { daily: Some(3), weekly: Some(15), days_off: Some(vec!["sun".into(), "sat".into(), "sun".into()]) }),
            complete_setup: true,
        };
        let v = save_patch(&pool, patch, NOW).await.unwrap();
        assert_eq!(v.time, "07:15");
        assert_eq!(v.location, Some(sf()));
        assert_eq!(v.modules, modules);
        assert_eq!((v.model.as_str(), v.effort.as_str()), ("claude-sonnet-5", "medium"));
        assert_eq!(v.goals, GoalSettings { daily: 3, weekly: 15, days_off: vec!["sat".into(), "sun".into()] });
        assert_eq!(v.setup_completed_at.as_deref(), Some(NOW));
        for key in ["brief.time", "brief.location", "brief.modules", "brief.model", "brief.effort",
                    "goals.daily", "goals.weekly", "goals.days_off", "today.setup_completed_at"] {
            assert!(crate::db::settings::get_setting(&pool, key).await.unwrap().is_some(), "{key} stored under the addendum's name");
        }
    }

    #[tokio::test]
    async fn an_invalid_field_rejects_the_whole_patch() {
        let pool = test_pool().await;
        let mixed = BriefSettingsPatch { time: Some("7am".into()), effort: Some("high".into()), ..Default::default() };
        assert!(save_patch(&pool, mixed, NOW).await.is_err());
        assert_eq!(load_view(&pool).await.unwrap().effort, "low", "nothing was written");
        let dup = LayoutEntry { id: "schedule".into(), enabled: true, config: serde_json::json!({}) };
        for bad in [
            BriefSettingsPatch { model: Some("claude-3".into()), ..Default::default() },
            BriefSettingsPatch { location: Some(Some(BriefLocation { tz: "Mars/Olympus".into(), ..sf() })), ..Default::default() },
            BriefSettingsPatch { location: Some(Some(BriefLocation { lat: 91.0, ..sf() })), ..Default::default() },
            BriefSettingsPatch { location: Some(Some(BriefLocation { name: "  ".into(), ..sf() })), ..Default::default() },
            BriefSettingsPatch { goals: Some(GoalsPatch { days_off: Some(vec!["someday".into()]), ..Default::default() }), ..Default::default() },
            BriefSettingsPatch { goals: Some(GoalsPatch { daily: Some(0), ..Default::default() }), ..Default::default() },
            BriefSettingsPatch { modules: Some(vec![dup.clone(), dup.clone()]), ..Default::default() },
        ] {
            assert!(save_patch(&pool, bad, NOW).await.is_err());
        }
    }

    #[tokio::test]
    async fn a_null_location_clears_it_and_a_missing_one_keeps_it() {
        let pool = test_pool().await;
        save_patch(&pool, BriefSettingsPatch { location: Some(Some(sf())), ..Default::default() }, NOW).await.unwrap();
        let kept = save_patch(&pool, BriefSettingsPatch { time: Some("08:00".into()), ..Default::default() }, NOW).await.unwrap();
        assert_eq!(kept.location, Some(sf()));
        assert_eq!(read_location(&pool).await.unwrap(), Some(sf()));
        let clear: BriefSettingsPatch = serde_json::from_str(r#"{"location":null}"#).unwrap();
        assert!(save_patch(&pool, clear, NOW).await.unwrap().location.is_none());
        assert!(read_location(&pool).await.unwrap().is_none());
        let empty: BriefSettingsPatch = serde_json::from_str("{}").unwrap();
        assert!(empty.location.is_none() && !empty.complete_setup);
    }

    #[tokio::test]
    async fn sources_reflect_what_is_connected() {
        let pool = test_pool().await;
        crate::db::settings::set_setting(&pool, "anthropic_api_key", "k").await.unwrap();
        crate::db::settings::set_setting(&pool, "obsidian_vault_path", "  ").await.unwrap();
        sqlx::query("INSERT INTO calendar_feeds (id, label, url) VALUES ('f1', 'Home', 'https://example.com/a.ics')")
            .execute(&pool).await.unwrap();
        let s = load_view(&pool).await.unwrap().sources;
        assert_eq!(s, BriefSources { calendar: true, tasks: false, vault: false, ai: true });
    }
```

Append to `nimble-core/src/db/briefs.rs`'s `mod tests`:

```rust
    #[tokio::test]
    async fn notes_save_for_today_and_sync() {
        let pool = test_pool().await;
        super::set_notes(&pool, "2026-09-23", "2026-09-23", "Call the venue").await.unwrap();
        let b = super::get_brief(&pool, "2026-09-23").await.unwrap().unwrap();
        assert_eq!(b.notes.as_deref(), Some("Call the venue"), "the first write also creates the day's snapshot");
        let snap: String = sqlx::query_scalar("SELECT snapshot FROM sync_log WHERE table_name='briefs' AND operation='UPDATE'")
            .fetch_one(&pool).await.unwrap();
        assert!(snap.contains("Call the venue"), "the sync snapshot carries notes (receivers would null an omitted column)");
        super::set_notes(&pool, "2026-09-23", "2026-09-23", "   ").await.unwrap();
        assert!(super::get_brief(&pool, "2026-09-23").await.unwrap().unwrap().notes.is_none(), "blank clears");
    }

    #[tokio::test]
    async fn notes_are_read_only_on_other_days() {
        let pool = test_pool().await;
        super::ensure_snapshot(&pool, "2026-09-22", "2026-09-22").await.unwrap();
        assert!(super::set_notes(&pool, "2026-09-22", "2026-09-23", "late").await.is_err());
        assert!(super::set_notes(&pool, "2026-09-23", "2026-09-23", &"x".repeat(20_001)).await.is_err());
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --offline -p nimble-core --lib brief::settings briefs::`
Expected: FAIL to compile (`load_view`, `BriefLocation`, `set_notes` not found).

- [ ] **Step 3: Add the types.** In `nimble-core/src/types.rs`, add `pub notes: Option<String>,` to `Brief` after `snapshot_schema`, and below it:

```rust
/// Where the brief's weather comes from (`brief.location`, addendum §2).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct BriefLocation {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    /// IANA zone from the geocoder, e.g. "America/Los_Angeles".
    pub tz: String,
}
```

- [ ] **Step 4: Add notes to `db/briefs.rs`.** Replace the row plumbing and add `set_notes`:

```rust
type Row = (String, i64, String, String, String, String, i64, Option<String>, String, String);
const COLS: &str = "date, version, status, source, layout_json, snapshot_json, snapshot_schema, notes, generated_at, updated_at";
const NOTES_MAX: usize = 20_000;

fn to_brief(r: Row) -> Brief {
    Brief {
        date: r.0, version: r.1, status: r.2, source: r.3,
        layout: serde_json::from_str(&r.4).unwrap_or(serde_json::Value::Null),
        snapshot: serde_json::from_str(&r.5).unwrap_or(serde_json::Value::Null),
        snapshot_schema: r.6, notes: r.7, generated_at: r.8, updated_at: r.9,
    }
}

/// The row as sync sees it: DB column names, JSON columns as text. Every
/// synced column is present — receivers upsert what they are sent.
fn sync_snapshot(b: &Brief) -> String {
    serde_json::json!({
        "date": b.date, "version": b.version, "status": b.status, "source": b.source,
        "layout_json": b.layout.to_string(), "snapshot_json": b.snapshot.to_string(),
        "snapshot_schema": b.snapshot_schema, "notes": b.notes,
        "generated_at": b.generated_at, "updated_at": b.updated_at,
    }).to_string()
}

/// Today's scratchpad (the `notes` module). Past days are read-only; the
/// first write of the day also writes the day's snapshot. Blank clears.
pub async fn set_notes(pool: &SqlitePool, date: &str, today: &str, notes: &str) -> crate::Result<()> {
    if date != today { return Err(crate::Error::Other("notes_read_only".into())); }
    if notes.chars().count() > NOTES_MAX { return Err(crate::Error::Other("notes_too_long".into())); }
    let Some(mut b) = ensure_snapshot(pool, date, today).await? else { return Err(crate::Error::Other("no_brief".into())) };
    b.notes = if notes.trim().is_empty() { None } else { Some(notes.to_string()) };
    b.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE briefs SET notes = ?, updated_at = ? WHERE date = ?")
        .bind(&b.notes).bind(&b.updated_at).bind(date).execute(pool).await?;
    sync::append_sync_log(pool, "briefs", date, "UPDATE",
        Some(&serde_json::json!(["notes", "updated_at"]).to_string()), Some(&sync_snapshot(&b))).await.ok();
    Ok(())
}
```

In `ensure_snapshot`, add `notes: None,` to the `Brief { … }` literal and widen the insert to ten placeholders, binding `&brief.notes` after `brief.snapshot_schema`:

```rust
    let inserted = sqlx::query(&format!("INSERT OR IGNORE INTO briefs ({COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"))
        .bind(&brief.date).bind(brief.version).bind(&brief.status).bind(&brief.source)
        .bind(brief.layout.to_string()).bind(brief.snapshot.to_string()).bind(brief.snapshot_schema)
        .bind(&brief.notes).bind(&brief.generated_at).bind(&brief.updated_at)
        .execute(pool).await?.rows_affected();
```

- [ ] **Step 5: Write the settings API** in `nimble-core/src/brief/settings.rs` (below `load_layout`; extend the `use` lines to `use std::collections::{HashMap, HashSet}; use serde::{Deserialize, Serialize};` and `use crate::brief::{manifests, ConfigField, LayoutEntry, ModuleManifest}; use crate::types::BriefLocation;`):

```rust
pub const KEY_TIME: &str = "brief.time";
pub const KEY_LOCATION: &str = "brief.location";
pub const KEY_MODEL: &str = "brief.model";
pub const KEY_EFFORT: &str = "brief.effort";
pub const KEY_SETUP_COMPLETED_AT: &str = "today.setup_completed_at";
/// `goals.*` meaning belongs to Lane C (momentum); the Today setup writes them.
pub const KEY_GOALS_DAILY: &str = "goals.daily";
pub const KEY_GOALS_WEEKLY: &str = "goals.weekly";
pub const KEY_GOALS_DAYS_OFF: &str = "goals.days_off";

pub const DEFAULT_TIME: &str = "06:30";
/// Verified against the claude-api skill 2026-09-25. Haiku 4.5 is left out:
/// it rejects `output_config.effort`.
pub const MODELS: [&str; 2] = ["claude-opus-5-5", "claude-sonnet-5"];
pub const EFFORTS: [&str; 3] = ["low", "medium", "high"];
pub const WEEKDAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DEFAULT_DAYS_OFF: [&str; 2] = ["sat", "sun"];
/// Same bounds as Lane C's `karma::save_goals` (it owns what goals mean).
const DAILY_RANGE: std::ops::RangeInclusive<i64> = 1..=100;
const WEEKLY_RANGE: std::ops::RangeInclusive<i64> = 1..=700;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GoalSettings {
    pub daily: i64,
    pub weekly: i64,
    pub days_off: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BriefSources {
    pub calendar: bool,
    pub tasks: bool,
    pub vault: bool,
    pub ai: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct BriefSettingsView {
    pub time: String,
    pub location: Option<BriefLocation>,
    pub modules: Vec<LayoutEntry>,
    pub model: String,
    pub effort: String,
    pub setup_completed_at: Option<String>,
    pub goals: GoalSettings,
    pub sources: BriefSources,
    pub manifests: Vec<ModuleManifest>,
}

#[derive(Deserialize, Default, Debug)]
pub struct GoalsPatch {
    pub daily: Option<i64>,
    pub weekly: Option<i64>,
    pub days_off: Option<Vec<String>>,
}

/// Every field optional; `location: null` clears, an absent key keeps.
#[derive(Deserialize, Default, Debug)]
pub struct BriefSettingsPatch {
    pub time: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub location: Option<Option<BriefLocation>>,
    pub modules: Option<Vec<LayoutEntry>>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub goals: Option<GoalsPatch>,
    #[serde(default)]
    pub complete_setup: bool,
}

/// A present key (even `null`) deserializes to `Some(_)`.
fn present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

fn invalid(key: &str) -> crate::Error {
    crate::Error::Other(format!("invalid_setting: {key}"))
}

fn valid_time(t: &str) -> bool {
    t.len() == 5 && chrono::NaiveTime::parse_from_str(t, "%H:%M").is_ok()
}

fn validate_location(l: &BriefLocation) -> crate::Result<()> {
    let name = l.name.trim();
    if name.is_empty() || name.chars().count() > 200 { return Err(invalid(KEY_LOCATION)); }
    if !l.lat.is_finite() || !(-90.0..=90.0).contains(&l.lat) { return Err(invalid(KEY_LOCATION)); }
    if !l.lon.is_finite() || !(-180.0..=180.0).contains(&l.lon) { return Err(invalid(KEY_LOCATION)); }
    if l.tz.parse::<chrono_tz::Tz>().is_err() { return Err(invalid(KEY_LOCATION)); }
    Ok(())
}

/// Known weekdays only, deduplicated, in week order.
fn normalize_days(days: &[String]) -> crate::Result<Vec<String>> {
    if days.iter().any(|d| !WEEKDAYS.contains(&d.as_str())) { return Err(invalid(KEY_GOALS_DAYS_OFF)); }
    Ok(WEEKDAYS.iter().filter(|w| days.iter().any(|d| d.as_str() == **w)).map(|w| w.to_string()).collect())
}

pub async fn read_location(pool: &SqlitePool) -> crate::Result<Option<BriefLocation>> {
    let stored = crate::db::settings::get_setting(pool, KEY_LOCATION).await?;
    Ok(stored
        .and_then(|s| serde_json::from_str::<BriefLocation>(&s).ok())
        .filter(|l| validate_location(l).is_ok()))
}

/// Every brief setting with defaults filled in. Never fails on bad stored
/// values: each field falls back on its own.
pub async fn load_view(pool: &SqlitePool) -> crate::Result<BriefSettingsView> {
    let all: HashMap<String, String> = crate::db::settings::get_all_settings(pool)
        .await?
        .into_iter()
        .map(|r| (r.key, r.value))
        .collect();
    let get = |k: &str| all.get(k).map(String::as_str).filter(|v| !v.trim().is_empty());
    let feeds: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM calendar_feeds WHERE enabled = 1").fetch_one(pool).await?;
    Ok(BriefSettingsView {
        time: get(KEY_TIME).filter(|t| valid_time(t)).unwrap_or(DEFAULT_TIME).to_string(),
        location: get(KEY_LOCATION)
            .and_then(|s| serde_json::from_str::<BriefLocation>(s).ok())
            .filter(|l| validate_location(l).is_ok()),
        modules: resolve_layout(get(KEY_MODULES)),
        model: get(KEY_MODEL).filter(|m| MODELS.contains(m)).unwrap_or(MODELS[0]).to_string(),
        effort: get(KEY_EFFORT).filter(|e| EFFORTS.contains(e)).unwrap_or(EFFORTS[0]).to_string(),
        setup_completed_at: get(KEY_SETUP_COMPLETED_AT).map(str::to_string),
        goals: GoalSettings {
            daily: get(KEY_GOALS_DAILY).and_then(|v| v.parse().ok()).filter(|n| DAILY_RANGE.contains(n)).unwrap_or(5),
            weekly: get(KEY_GOALS_WEEKLY).and_then(|v| v.parse().ok()).filter(|n| WEEKLY_RANGE.contains(n)).unwrap_or(25),
            days_off: get(KEY_GOALS_DAYS_OFF)
                .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                .and_then(|d| normalize_days(&d).ok())
                .unwrap_or_else(|| DEFAULT_DAYS_OFF.iter().map(|d| d.to_string()).collect()),
        },
        sources: BriefSources {
            calendar: feeds > 0 || get("ical_feed_url").is_some(),
            tasks: get("todoist_api_token").is_some(),
            vault: get("obsidian_vault_path").is_some(),
            ai: get("anthropic_api_key").is_some(),
        },
        manifests: manifests(),
    })
}

/// Validate every field first, then write all of them in one transaction:
/// a patch lands whole or not at all (setup's Finish is one save).
pub async fn save_patch(pool: &SqlitePool, patch: BriefSettingsPatch, now: &str) -> crate::Result<BriefSettingsView> {
    let mut writes: Vec<(&'static str, String)> = Vec::new();
    if let Some(t) = patch.time {
        let t = t.trim();
        if !valid_time(t) { return Err(invalid(KEY_TIME)); }
        writes.push((KEY_TIME, t.to_string()));
    }
    if let Some(location) = patch.location {
        match location {
            Some(mut l) => {
                validate_location(&l)?;
                l.name = l.name.trim().to_string();
                writes.push((KEY_LOCATION, serde_json::to_string(&l).map_err(|e| crate::Error::Parse(e.to_string()))?));
            }
            None => writes.push((KEY_LOCATION, String::new())),
        }
    }
    if let Some(modules) = patch.modules {
        let mut seen = HashSet::new();
        if !modules.iter().all(|m| seen.insert(m.id.clone())) { return Err(invalid(KEY_MODULES)); }
        let raw = serde_json::to_string(&modules).map_err(|e| crate::Error::Parse(e.to_string()))?;
        let resolved = resolve_layout(Some(&raw));
        writes.push((KEY_MODULES, serde_json::to_string(&resolved).map_err(|e| crate::Error::Parse(e.to_string()))?));
    }
    if let Some(m) = patch.model {
        if !MODELS.contains(&m.as_str()) { return Err(invalid(KEY_MODEL)); }
        writes.push((KEY_MODEL, m));
    }
    if let Some(e) = patch.effort {
        if !EFFORTS.contains(&e.as_str()) { return Err(invalid(KEY_EFFORT)); }
        writes.push((KEY_EFFORT, e));
    }
    if let Some(g) = patch.goals {
        if let Some(d) = g.daily {
            if !DAILY_RANGE.contains(&d) { return Err(invalid(KEY_GOALS_DAILY)); }
            writes.push((KEY_GOALS_DAILY, d.to_string()));
        }
        if let Some(w) = g.weekly {
            if !WEEKLY_RANGE.contains(&w) { return Err(invalid(KEY_GOALS_WEEKLY)); }
            writes.push((KEY_GOALS_WEEKLY, w.to_string()));
        }
        if let Some(days) = g.days_off {
            let days = normalize_days(&days)?;
            writes.push((KEY_GOALS_DAYS_OFF, serde_json::to_string(&days).map_err(|e| crate::Error::Parse(e.to_string()))?));
        }
    }
    if patch.complete_setup {
        writes.push((KEY_SETUP_COMPLETED_AT, now.to_string()));
    }
    let mut tx = pool.begin().await?;
    for (key, value) in &writes {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    load_view(pool).await
}
```

- [ ] **Step 6: Run the Rust tests**

Run: `cargo test --offline -p nimble-core --lib brief:: briefs::`
Expected: PASS.

- [ ] **Step 7: Tauri commands.** Append to `apps/desktop/src-tauri/src/commands/brief.rs`:

```rust
pub use nimble_core::brief::settings::{BriefSettingsPatch, BriefSettingsView};

#[tauri::command]
pub async fn brief_settings_get(app: AppHandle) -> Result<BriefSettingsView, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::brief::settings::load_view(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_settings_save(app: AppHandle, patch: BriefSettingsPatch) -> Result<BriefSettingsView, String> {
    let pool = app.state::<SqlitePool>();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    nimble_core::brief::settings::save_patch(pool.inner(), patch, &now).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_set_notes(app: AppHandle, date: String, notes: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    nimble_core::db::briefs::set_notes(pool.inner(), &date, &today, &notes).await.map_err(|e| e.to_string())
}
```

In `apps/desktop/src-tauri/src/lib.rs`, append to `invoke_handler!` after `demo::demo_toggle,`:

```rust
            brief::brief_settings_get,
            brief::brief_settings_save,
            brief::brief_set_notes,
```

- [ ] **Step 8: Shared types.** In `packages/types/src/index.ts`, replace the `// ── Briefs ──` block's `BriefSnapshotV1` and `Brief` with:

```ts
export interface BriefHabitRef {
  id: string
  name: string
  icon: string
  color: string
  done: boolean
}

/** Frozen per-module payloads keyed by module id (snapshot_schema 1).
 *  Every key is optional: a module that was off that morning is absent. */
export interface BriefSnapshotV1 {
  schedule?: { events: CalendarEvent[]; tomorrow: CalendarEvent[] }
  priorities?: Priority[] | null
  due_today?: BriefTaskRef[]
  still_open?: { total: number; oldest: BriefTaskRef[] }
  habits?: BriefHabitRef[] | null
  [module: string]: unknown
}

export interface Brief {
  date: string
  version: number
  status: 'ready' | 'partial' | 'fallback' | 'failed'
  source: 'nimble' | 'legacy_vault'
  /** Phase-1 rows hold module ids; phase-2+ rows the entries used that
   *  morning. Always read it through `normalizeLayout` (lib/briefLayout). */
  layout: string[] | BriefLayoutEntry[]
  snapshot: BriefSnapshotV1
  snapshot_schema: number
  /** Today's scratchpad (the `notes` module). */
  notes: string | null
  generated_at: string
  updated_at: string
}

// ── Brief settings (phase 2, addendum §1–§2) ──

export type BriefModuleKind = 'fixed' | 'live' | 'ai'
export type BriefIntegration = 'calendar' | 'tasks' | 'vault' | 'ai' | 'location'
export type ConfigChoiceValue = string | number
export type ConfigField =
  | { type: 'bool'; key: string; label: string; default: boolean }
  | { type: 'choice'; key: string; label: string; options: { value: ConfigChoiceValue; label: string }[]; default: ConfigChoiceValue }
  | { type: 'label'; key: string; label: string; default_name: string }
export interface ModuleManifest {
  id: string
  name: string
  kind: BriefModuleKind
  requires: BriefIntegration[]
  default_enabled: boolean
  config_schema: ConfigField[]
}
export interface BriefLayoutEntry {
  id: string
  enabled: boolean
  config: Record<string, unknown>
}
export interface BriefLocation {
  name: string
  lat: number
  lon: number
  tz: string
}
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface BriefGoals {
  daily: number
  weekly: number
  days_off: Weekday[]
}
export interface BriefSources {
  calendar: boolean
  tasks: boolean
  vault: boolean
  ai: boolean
}
export type BriefModel = 'claude-opus-5-5' | 'claude-sonnet-5'
export type BriefEffort = 'low' | 'medium' | 'high'
export interface BriefSettings {
  time: string
  location: BriefLocation | null
  /** Resolved: every registered module, stored order first, config filled. */
  modules: BriefLayoutEntry[]
  model: BriefModel
  effort: BriefEffort
  setup_completed_at: string | null
  goals: BriefGoals
  sources: BriefSources
  manifests: ModuleManifest[]
}
/** Omit a key to keep it; `location: null` clears. One save = one transaction. */
export interface BriefSettingsPatch {
  time?: string
  location?: BriefLocation | null
  modules?: BriefLayoutEntry[]
  model?: BriefModel
  effort?: BriefEffort
  goals?: Partial<BriefGoals>
  complete_setup?: boolean
}
export interface BriefSettingsCapability {
  supported: boolean
  get(): Promise<BriefSettings>
  save(patch: BriefSettingsPatch): Promise<BriefSettings>
}
```

In `packages/types/src/data-provider.ts`, add `briefSettings: import('./index').BriefSettingsCapability` after the `backup:` line, and add to the `brief:` domain:

```ts
    /** Today's scratchpad. Desktop only; past days are read-only. */
    setNotes(date: string, notes: string): Promise<void>
```

- [ ] **Step 9: Providers.** In `apps/desktop/src/services/tauri.ts`, add `import type { BriefSettings, BriefSettingsPatch } from '@nimble/types'` below the existing type import, and after `ensureBriefSnapshot`:

```ts
// ── Morning Brief settings (phase 2) ──

export async function briefSettingsGet(): Promise<BriefSettings> {
  return invoke<BriefSettings>('brief_settings_get')
}

export async function briefSettingsSave(patch: BriefSettingsPatch): Promise<BriefSettings> {
  return invoke<BriefSettings>('brief_settings_save', { patch })
}

export async function briefSetNotes(date: string, notes: string): Promise<void> {
  return invoke<void>('brief_set_notes', { date, notes })
}
```

`apps/desktop/src/services/tauri-provider.ts`: add `briefSettings: { supported: true, get: tauri.briefSettingsGet, save: tauri.briefSettingsSave },` after `backup`, and `setNotes: tauri.briefSetNotes,` in `brief`.

`apps/desktop/src/services/turso-provider.ts`: after `backup`:

```ts
    // Settings live in the Mac's local KV store and are not synced, so the
    // web has nothing to read; Today falls back to the synced row's layout.
    briefSettings: { supported: false, get: ni('briefSettings.get'), save: ni('briefSettings.save') },
```

and in `brief`: `setNotes: ni('brief.setNotes'),`.

`apps/desktop/src/services/turso/briefs.ts`: add `notes` to `COLS` (after `snapshot_schema`), import `strOrNull`, and add `notes: strOrNull(row, 'notes'),` to `toBrief`.

- [ ] **Step 10: Write the failing frontend test** `apps/desktop/tests/briefLayout.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_LAYOUT, normalizeLayout, configValue, setModuleConfig, setModuleEnabled, applySettingsPatch,
} from '../src/lib/briefLayout.ts'

const e = (id, enabled = true, config = {}) => ({ id, enabled, config })

test('phase-1 layouts (module ids) and phase-2 layouts (entries) both normalize', () => {
  assert.deepEqual(normalizeLayout(['schedule', 'priorities']), [e('schedule'), e('priorities')])
  assert.deepEqual(
    normalizeLayout([{ id: 'schedule', enabled: false, config: { free_block: false } }, { id: 'schedule' }, { id: 'vault' }]),
    [e('schedule', false, { free_block: false }), e('vault')],
  )
})

test('garbage layouts read as the phase-1 fallback', () => {
  for (const bad of [null, undefined, 'x', {}, 3]) assert.deepEqual(normalizeLayout(bad), FALLBACK_LAYOUT)
  assert.deepEqual(normalizeLayout([1, null, { enabled: true }]), [])
  assert.deepEqual(FALLBACK_LAYOUT.map((x) => x.id), ['schedule', 'priorities', 'due_today', 'still_open', 'vault'])
})

test('configValue keeps the stored value only when it has the fallback type', () => {
  assert.equal(configValue({ count: 5 }, 'count', 3), 5)
  assert.equal(configValue({ count: '5' }, 'count', 3), 3)
  assert.equal(configValue(undefined, 'rain_notes', true), true)
})

test('module edits return new arrays and leave other entries alone', () => {
  const list = [e('schedule'), e('weather', true, { units: 'auto', rain_notes: true })]
  const units = setModuleConfig(list, 'weather', { units: 'C' })
  assert.deepEqual(units[1].config, { units: 'C', rain_notes: true })
  assert.notEqual(units, list)
  assert.equal(units[0], list[0])
  assert.equal(setModuleEnabled(list, 'schedule', false)[0].enabled, false)
})

test('applySettingsPatch merges optimistically: goals shallow-merge, null location clears', () => {
  const base = {
    time: '06:30', location: { name: 'SF', lat: 1, lon: 2, tz: 'UTC' }, modules: [], model: 'claude-opus-5-5', effort: 'low',
    setup_completed_at: null, goals: { daily: 5, weekly: 25, days_off: ['sat', 'sun'] },
    sources: { calendar: false, tasks: false, vault: false, ai: false }, manifests: [],
  }
  const next = applySettingsPatch(base, { time: '07:00', location: null, goals: { daily: 3 } })
  assert.equal(next.time, '07:00')
  assert.equal(next.location, null)
  assert.deepEqual(next.goals, { daily: 3, weekly: 25, days_off: ['sat', 'sun'] })
  assert.equal(base.time, '06:30', 'input untouched')
  assert.equal(applySettingsPatch(base, {}).location, base.location)
})
```

Run: `cd apps/desktop && node --test tests/briefLayout.test.mjs` → FAIL (module not found).

- [ ] **Step 11: Write `apps/desktop/src/lib/briefLayout.ts`**

```ts
// Pure helpers for the brief's module layout and settings (addendum §1–§2).
// Plain TS (type-only imports) so node tests import it directly.
import type { BriefLayoutEntry, BriefSettings, BriefSettingsPatch } from '@nimble/types'

/** The phase-1 boxes: a brief with no readable layout (the web without a
 *  synced row, or a malformed one) renders these. */
export const FALLBACK_LAYOUT: BriefLayoutEntry[] = ['schedule', 'priorities', 'due_today', 'still_open', 'vault'].map(
  (id) => ({ id, enabled: true, config: {} }),
)

/** A stored `layout_json`: phase-1 rows hold module ids, phase-2 rows the
 *  entries used that morning. Duplicates keep the first; junk items drop. */
export function normalizeLayout(layout: unknown): BriefLayoutEntry[] {
  if (!Array.isArray(layout)) return FALLBACK_LAYOUT
  const out: BriefLayoutEntry[] = []
  for (const item of layout) {
    if (typeof item === 'string') {
      if (!out.some((x) => x.id === item)) out.push({ id: item, enabled: true, config: {} })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const raw = item as { id?: unknown; enabled?: unknown; config?: unknown }
    if (typeof raw.id !== 'string' || out.some((x) => x.id === raw.id)) continue
    const config = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? (raw.config as Record<string, unknown>) : {}
    out.push({ id: raw.id, enabled: raw.enabled !== false, config })
  }
  return out
}

/** A module's option, or `fallback` when missing or of the wrong type. */
export function configValue<T extends boolean | number | string>(
  config: Record<string, unknown> | undefined,
  key: string,
  fallback: T,
): T {
  const v = config?.[key]
  return typeof v === typeof fallback ? (v as T) : fallback
}

export function setModuleConfig(entries: BriefLayoutEntry[], id: string, patch: Record<string, unknown>): BriefLayoutEntry[] {
  return entries.map((x) => (x.id === id ? { ...x, config: { ...x.config, ...patch } } : x))
}

export function setModuleEnabled(entries: BriefLayoutEntry[], id: string, enabled: boolean): BriefLayoutEntry[] {
  return entries.map((x) => (x.id === id ? { ...x, enabled } : x))
}

/** The store's optimistic merge; Rust's answer replaces it when the save lands. */
export function applySettingsPatch(settings: BriefSettings, patch: BriefSettingsPatch): BriefSettings {
  const next: BriefSettings = { ...settings }
  if (patch.time !== undefined) next.time = patch.time
  if (patch.location !== undefined) next.location = patch.location
  if (patch.modules !== undefined) next.modules = patch.modules
  if (patch.model !== undefined) next.model = patch.model
  if (patch.effort !== undefined) next.effort = patch.effort
  if (patch.goals !== undefined) next.goals = { ...settings.goals, ...patch.goals }
  return next
}
```

Run: `cd apps/desktop && node --test tests/briefLayout.test.mjs` → PASS.

- [ ] **Step 12: Write `apps/desktop/src/stores/briefSettingsStore.ts`**

```ts
import { create } from 'zustand'
import { toast } from 'sonner'
import type { BriefSettings, BriefSettingsPatch } from '@nimble/types'
import { getDataProvider } from '@/services/provider-context'
import { applySettingsPatch } from '@/lib/briefLayout'
import { settingsFailure } from '@/lib/settingsMessage'

/* One copy of the brief settings for Today, the setup and the three
   Settings sections, so a change in one shows everywhere at once.
   Every save applies optimistically, then saves run one at a time in click
   order. Only the answer to the last outstanding save replaces local state:
   an earlier answer would undo patches that are still queued (Review Focus
   5 — toggle, move, toggle within a second). A failed save re-reads Rust's
   truth once nothing else is pending, instead of guessing a rollback. */

type Status = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error'

interface BriefSettingsState {
  settings: BriefSettings | null
  status: Status
  load: (force?: boolean) => Promise<void>
  save: (patch: BriefSettingsPatch) => Promise<boolean>
}

let queue: Promise<unknown> = Promise.resolve()
let outstanding = 0

export const useBriefSettingsStore = create<BriefSettingsState>((set, get) => ({
  settings: null,
  status: 'idle',
  load: async (force = false) => {
    const dp = getDataProvider()
    if (!dp.briefSettings.supported) {
      set({ status: 'unsupported' })
      return
    }
    const { status } = get()
    if (!force && (status === 'ready' || status === 'loading')) return
    set({ status: 'loading' })
    try {
      set({ settings: await dp.briefSettings.get(), status: 'ready' })
    } catch {
      set({ status: get().settings ? 'ready' : 'error' })
    }
  },
  save: (patch) => {
    const current = get().settings
    if (current) set({ settings: applySettingsPatch(current, patch) })
    outstanding += 1
    const run = queue.then(async () => {
      try {
        const next = await getDataProvider().briefSettings.save(patch)
        if (outstanding === 1) set({ settings: next, status: 'ready' })
        return true
      } catch (e) {
        const failure = settingsFailure(e)
        toast.error(failure.message, failure.detail ? { description: failure.detail } : undefined)
        if (outstanding === 1) await get().load(true)
        return false
      } finally {
        outstanding -= 1
      }
    })
    queue = run.catch(() => undefined)
    return run
  },
}))
```

- [ ] **Step 13: Mock.** In `tools/mock-tauri.js`, add `notes: null,` to every entry in `BRIEFS` and to the brief built in `brief_ensure_snapshot`. Change that brief's `layout` to `['schedule', 'priorities', 'due_today', 'still_open', 'vault'].map(function (id) { return { id: id, enabled: true, config: {} } })`. Then add this block after the `// ── Briefs` section:

```js
  // ── Brief settings (phase 2) ────────────────────────────────────────────
  // Mirrors nimble-core brief::settings. ?setup=fresh = a profile that never
  // ran the Today setup (no setup_completed_at, no location). Specs may seed
  // window.__MOCK_BRIEF_SETTINGS__ ({ modules, time, location, … }); it is
  // read on the first brief_settings_* call, after page init scripts ran.

  function boolField(key, label) { return { type: 'bool', key: key, label: label, default: true } }
  function choiceField(key, label, pairs, def) {
    return { type: 'choice', key: key, label: label, options: pairs.map(function (p) { return { value: p[0], label: p[1] } }), default: def }
  }
  var BRIEF_MANIFESTS = [
    { id: 'schedule', name: 'Schedule', kind: 'fixed', requires: ['calendar'], default_enabled: true,
      config_schema: [boolField('tomorrow_peek', 'Tomorrow peek'), boolField('free_block', 'Free block')] },
    { id: 'priorities', name: 'Top priorities', kind: 'ai', requires: ['ai'], default_enabled: true,
      config_schema: [choiceField('count', 'How many', [[1, '1'], [2, '2'], [3, '3']], 3)] },
    { id: 'due_today', name: 'Due today', kind: 'live', requires: [], default_enabled: true,
      config_schema: [boolField('show_completed', 'Show completed')] },
    { id: 'still_open', name: 'Still open', kind: 'fixed', requires: [], default_enabled: true,
      config_schema: [choiceField('count', 'How many', [[3, '3'], [5, '5'], [10, '10']], 5)] },
    { id: 'habits', name: 'Before you start', kind: 'live', requires: [], default_enabled: false, config_schema: [] },
    { id: 'vault', name: 'From your vault', kind: 'fixed', requires: ['vault'], default_enabled: true, config_schema: [] },
    { id: 'notes', name: 'Notes', kind: 'live', requires: [], default_enabled: false, config_schema: [] },
  ]
  function mergeModuleConfig(m, stored) {
    var c = {}
    m.config_schema.forEach(function (f) {
      var v = stored ? stored[f.key] : undefined
      if (f.type === 'bool') c[f.key] = typeof v === 'boolean' ? v : f.default
      else if (f.type === 'choice') c[f.key] = f.options.some(function (o) { return o.value === v }) ? v : f.default
      else c[f.key] = typeof v === 'string' && v.trim() ? v.trim() : f.default_name
    })
    return c
  }
  function resolveModules(stored) {
    var out = []
    ;(Array.isArray(stored) ? stored : []).forEach(function (e) {
      var m = e && BRIEF_MANIFESTS.find(function (x) { return x.id === e.id })
      if (!m || out.some(function (o) { return o.id === e.id })) return
      out.push({ id: e.id, enabled: e.enabled !== false, config: mergeModuleConfig(m, e.config) })
    })
    BRIEF_MANIFESTS.forEach(function (m) {
      if (!out.some(function (o) { return o.id === m.id })) out.push({ id: m.id, enabled: m.default_enabled, config: mergeModuleConfig(m, null) })
    })
    return out
  }
  var freshSetup = new URLSearchParams(window.location.search).get('setup') === 'fresh'
  var briefState = {
    time: '06:30',
    location: freshSetup ? null : { name: 'San Francisco, California', lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' },
    stored_modules: null,
    model: 'claude-opus-5-5',
    effort: 'low',
    setup_completed_at: freshSetup ? null : '2026-07-01 07:00:00',
    goals: { daily: 5, weekly: 25, days_off: ['sat', 'sun'] },
  }
  var briefSeeded = false
  function seedBriefSettings() {
    if (briefSeeded) return
    briefSeeded = true
    var seed = window.__MOCK_BRIEF_SETTINGS__
    if (!seed) return
    if (seed.modules) briefState.stored_modules = seed.modules
    ;['time', 'location', 'model', 'effort', 'setup_completed_at', 'goals'].forEach(function (k) { if (k in seed) briefState[k] = seed[k] })
  }
  function briefSettingsView() {
    seedBriefSettings()
    return {
      time: briefState.time,
      location: briefState.location,
      modules: resolveModules(briefState.stored_modules),
      model: briefState.model,
      effort: briefState.effort,
      setup_completed_at: briefState.setup_completed_at,
      goals: { daily: briefState.goals.daily, weekly: briefState.goals.weekly, days_off: briefState.goals.days_off.slice() },
      sources: { calendar: !!SETTINGS.ical_feed_url, tasks: !!SETTINGS.todoist_api_token, vault: !!SETTINGS.obsidian_vault_path, ai: !!SETTINGS.anthropic_api_key },
      manifests: BRIEF_MANIFESTS,
    }
  }
```

and in `commands`, after `brief_ensure_snapshot`:

```js
    brief_settings_get: function () { return briefSettingsView() },
    brief_settings_save: function (args) {
      seedBriefSettings()
      var p = (args && args.patch) || {}
      if (p.time !== undefined) briefState.time = p.time
      if (p.location !== undefined) briefState.location = p.location
      if (p.modules !== undefined) briefState.stored_modules = p.modules
      if (p.model !== undefined) briefState.model = p.model
      if (p.effort !== undefined) briefState.effort = p.effort
      if (p.goals) briefState.goals = Object.assign({}, briefState.goals, p.goals)
      if (p.complete_setup) briefState.setup_completed_at = nowStamp()
      return briefSettingsView()
    },
    brief_set_notes: function (args) {
      var b = BRIEFS[args && args.date]
      if (b) b.notes = args.notes && args.notes.trim() ? args.notes : null
      return null
    },
```

- [ ] **Step 14: Verify**

Run: `cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED"`, then `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: all pass, and lint ≤ `LINT_BASELINE`.

- [ ] **Step 15: Commit**

```bash
git add nimble-core packages/types apps/desktop/src-tauri apps/desktop/src/services apps/desktop/src/lib/briefLayout.ts apps/desktop/src/stores/briefSettingsStore.ts apps/desktop/tests/briefLayout.test.mjs tools/mock-tauri.js
git commit -m "feat(brief): brief settings API — keys, one-transaction save, notes, DataProvider + store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 3: Weather backend: v25 `module_cache`, Open-Meteo provider + geocoding, offline cache, the `weather` module, commands

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (v25, bump constant, tests), `db/export_policy.rs`, `db/backup.rs:298`, `db/mod.rs`, `db/sync.rs` (append one test), `db/briefs.rs` (`patch_snapshot_if_null`, `write_snapshot`), `api/mod.rs`, `brief/mod.rs` (register `weather` first), `brief/modules/mod.rs`, `brief/settings.rs` (default-order test), and the pinned tests `nimble-core/tests/{schema22_origin_label,focus_schema,schema20_compatibility,backup_export,focus_backup}.rs`
- Create: `nimble-core/src/db/module_cache.rs`, `nimble-core/src/api/weather.rs`, `nimble-core/src/brief/modules/weather.rs`, `apps/desktop/src-tauri/src/commands/weather.rs`, `apps/desktop/tests/briefCommands.test.mjs`
- Modify (contract): `apps/desktop/src-tauri/src/{commands/mod.rs, lib.rs}`, `packages/types/src/{index.ts, data-provider.ts}`, `apps/desktop/src/services/{tauri.ts, tauri-provider.ts, turso-provider.ts}`, `tools/mock-tauri.js`

**Interfaces:**
- Consumes: Task 2's `read_location`, `BriefLocation`, `save_patch`; Task 1's registry.
- Produces:

```rust
// nimble_core::api::weather
pub struct WeatherDay { pub date: String, pub high_c: f64, pub low_c: f64, pub precip_max: Option<i64> }
pub struct WeatherHour { pub time: String /* "YYYY-MM-DDTHH:MM" location-local */, pub temp_c: f64, pub precip: Option<i64> }
pub struct Forecast { pub timezone: String, pub current_time: Option<String>, pub current_c: Option<f64>, pub days: Vec<WeatherDay>, pub hourly: Vec<WeatherHour> }
pub struct GeoPlace { pub name: String, pub admin1: Option<String>, pub country: Option<String>, pub lat: f64, pub lon: f64, pub tz: String }
pub enum WeatherStatus { NoLocation, Fresh, Stale, Unavailable }            // serde snake_case
pub struct WeatherView { pub status: WeatherStatus, pub location: Option<BriefLocation>, pub forecast: Option<Forecast>, pub fetched_at: Option<String> /* RFC 3339 UTC */ }
#[allow(async_fn_in_trait)] pub trait WeatherProvider {
    async fn forecast(&self, lat: f64, lon: f64) -> crate::Result<Forecast>;
    async fn geocode(&self, query: &str) -> crate::Result<Vec<GeoPlace>>;
}
pub struct OpenMeteo; impl OpenMeteo { pub fn new() -> crate::Result<Self> }
pub fn forecast_url(lat: f64, lon: f64) -> reqwest::Url;  pub fn geocode_url(query: &str) -> reqwest::Url;
pub fn parse_forecast(body: &str) -> crate::Result<Forecast>;  pub fn parse_geocode(body: &str) -> crate::Result<Vec<GeoPlace>>;
pub fn normalize_query(q: &str) -> Option<&str>;
pub async fn cached(pool, loc: &BriefLocation) -> crate::Result<Option<(Forecast, String)>>;
pub async fn load_forecast<P: WeatherProvider>(pool, provider: &P, location: Option<&BriefLocation>, now: DateTime<Utc>) -> crate::Result<WeatherView>;
// nimble_core::brief::modules::weather
pub struct Weather;  // manifest id "weather", name "Weather chip", config {units: "auto"|"F"|"C" = "auto", rain_notes: bool = true}
pub async fn refresh<P: WeatherProvider>(pool, provider: &P, today: &str, now: DateTime<Utc>) -> crate::Result<WeatherView>;
// nimble_core::db::briefs
pub async fn patch_snapshot_if_null(pool, date: &str, key: &str, value: Value) -> crate::Result<bool>;  // atomic json_set
// nimble_core::db::module_cache
pub async fn get(pool, module_id, cache_key) -> crate::Result<Option<(String, String)>>;  // (payload_json, fetched_at)
pub async fn put(pool, module_id, cache_key, payload_json, fetched_at) -> crate::Result<()>;
// Tauri: weather_get() -> WeatherView · weather_geocode(query) -> Vec<GeoPlace>
```

```ts
// @nimble/types
export interface WeatherCapability { supported: boolean; get(): Promise<WeatherView>; geocode(query: string): Promise<GeoPlace[]> }
export interface WeatherSnapshot { location: BriefLocation; forecast: Forecast; fetched_at: string }  // snapshot.weather
// DataProvider: weather: WeatherCapability
```

- [ ] **Step 1: Write the failing tests.** Append to `nimble-core/src/db/migrations.rs`:

```rust
#[cfg(test)]
mod v25_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v25_creates_the_device_local_module_cache() { // schema-v25
        let pool = test_pool().await;
        let cols: Vec<(String, i64)> = sqlx::query_as("SELECT name, pk FROM pragma_table_info('module_cache') ORDER BY cid")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(cols, vec![
            ("module_id".to_string(), 1), ("cache_key".to_string(), 2),
            ("payload_json".to_string(), 0), ("fetched_at".to_string(), 0),
        ]);
        assert_eq!(super::CURRENT_SCHEMA_VERSION, 25); // schema-v25
    }
}
```

Delete the line `assert_eq!(super::CURRENT_SCHEMA_VERSION, 23);` from `v23_tests` (the v25 test owns the constant now).

Append to the first `mod tests` in `nimble-core/src/db/sync.rs` (next to `briefs_sync_by_date`):

```rust
    #[test]
    fn the_module_cache_never_syncs() {
        assert!(super::sanitize_table_name("module_cache").is_err(), "device-local, like vault_fts");
    }
```

Create `nimble-core/src/api/weather.rs` with only its tests and test helpers for now:

```rust
#[cfg(test)]
pub(crate) mod testing {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use chrono::{DateTime, Utc};

    use super::{parse_forecast, Forecast, GeoPlace, WeatherProvider};
    use crate::types::BriefLocation;

    /// A trimmed real Open-Meteo response. The 26th has a null low, so only
    /// the 25th parses as a day; one hourly slot is null and is skipped.
    pub const FORECAST_FIXTURE: &str = r#"{"latitude":37.76,"longitude":-122.42,"timezone":"America/Los_Angeles",
      "current":{"time":"2026-09-25T06:30","interval":900,"temperature_2m":14.2},
      "hourly":{"time":["2026-09-25T06:00","2026-09-25T07:00","2026-09-25T19:00","2026-09-26T07:00"],
                "temperature_2m":[13.8,14.1,17.9,null],"precipitation_probability":[0,5,60,null]},
      "daily":{"time":["2026-09-25","2026-09-26"],"temperature_2m_max":[21.1,20.0],"temperature_2m_min":[13.9,null],
               "precipitation_probability_max":[60,10]}}"#;

    pub struct FakeWeather {
        pub forecast: Option<Forecast>,
        pub calls: AtomicUsize,
    }

    impl FakeWeather {
        pub fn ok() -> Self { Self { forecast: Some(parse_forecast(FORECAST_FIXTURE).unwrap()), calls: AtomicUsize::new(0) } }
        pub fn offline() -> Self { Self { forecast: None, calls: AtomicUsize::new(0) } }
        pub fn calls(&self) -> usize { self.calls.load(Ordering::SeqCst) }
    }

    impl WeatherProvider for FakeWeather {
        async fn forecast(&self, _lat: f64, _lon: f64) -> crate::Result<Forecast> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.forecast.clone().ok_or_else(|| crate::Error::Api("offline".into()))
        }
        async fn geocode(&self, _query: &str) -> crate::Result<Vec<GeoPlace>> {
            Ok(vec![])
        }
    }

    pub fn sf() -> BriefLocation {
        BriefLocation { name: "San Francisco, California".into(), lat: 37.7749, lon: -122.4194, tz: "America/Los_Angeles".into() }
    }

    pub fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::testing::{at, sf, FakeWeather, FORECAST_FIXTURE};
    use super::*;
    use crate::test_util::test_pool;

    fn query(url: &reqwest::Url) -> HashMap<String, String> {
        url.query_pairs().into_owned().collect()
    }

    #[test]
    fn forecast_url_carries_every_parameter_in_celsius() {
        let url = forecast_url(37.7749, -122.4194);
        let q = query(&url);
        assert_eq!(url.host_str(), Some("api.open-meteo.com"));
        assert_eq!((q["latitude"].as_str(), q["longitude"].as_str()), ("37.7749", "-122.4194"));
        assert_eq!(q["current"], "temperature_2m");
        assert_eq!(q["hourly"], "temperature_2m,precipitation_probability");
        assert_eq!(q["daily"], "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
        assert_eq!(q["temperature_unit"], "celsius");
        assert_eq!((q["timezone"].as_str(), q["forecast_days"].as_str()), ("auto", "2"));
    }

    #[test]
    fn geocode_url_encodes_the_query() {
        let url = geocode_url("Winston-Salem & Co+op");
        let q = query(&url);
        assert_eq!(url.host_str(), Some("geocoding-api.open-meteo.com"));
        assert_eq!(q["name"], "Winston-Salem & Co+op");
        assert_eq!((q["count"].as_str(), q["language"].as_str(), q["format"].as_str()), ("5", "en", "json"));
        assert!(url.as_str().contains("name=Winston-Salem+%26+Co%2Bop"), "{url}");
    }

    #[test]
    fn a_forecast_parses_and_skips_missing_values() {
        let f = parse_forecast(FORECAST_FIXTURE).unwrap();
        assert_eq!(f.timezone, "America/Los_Angeles");
        assert_eq!((f.current_c, f.current_time.as_deref()), (Some(14.2), Some("2026-09-25T06:30")));
        assert_eq!(f.days, vec![WeatherDay { date: "2026-09-25".into(), high_c: 21.1, low_c: 13.9, precip_max: Some(60) }]);
        assert_eq!(f.hourly.len(), 3);
        assert_eq!(f.hourly[2], WeatherHour { time: "2026-09-25T19:00".into(), temp_c: 17.9, precip: Some(60) });
    }

    #[test]
    fn a_forecast_without_days_or_json_is_an_error() {
        let empty = r#"{"timezone":"UTC","hourly":{"time":[],"temperature_2m":[]},"daily":{"time":[],"temperature_2m_max":[],"temperature_2m_min":[]}}"#;
        assert!(parse_forecast(empty).is_err());
        assert!(parse_forecast("<html>rate limited</html>").is_err());
    }

    #[test]
    fn geocode_results_parse_and_an_empty_search_is_empty() {
        let body = r#"{"results":[
            {"id":5391959,"name":"San Francisco","latitude":37.77493,"longitude":-122.41942,"timezone":"America/Los_Angeles","country":"United States","admin1":"California"},
            {"id":1,"name":"Nowhere","latitude":0.0,"longitude":0.0}],"generationtime_ms":0.5}"#;
        assert_eq!(parse_geocode(body).unwrap(), vec![GeoPlace {
            name: "San Francisco".into(), admin1: Some("California".into()), country: Some("United States".into()),
            lat: 37.77493, lon: -122.41942, tz: "America/Los_Angeles".into(),
        }]);
        assert!(parse_geocode(r#"{"generationtime_ms":0.3}"#).unwrap().is_empty(), "no `results` key = nothing found");
    }

    #[test]
    fn geocode_queries_are_trimmed_and_bounded() {
        assert_eq!(normalize_query("  San "), Some("San"));
        assert_eq!(normalize_query(" S "), None);
        assert_eq!(normalize_query(&"x".repeat(101)), None);
    }

    #[tokio::test]
    async fn no_location_never_calls_the_provider() {
        let pool = test_pool().await;
        let p = FakeWeather::ok();
        let v = load_forecast(&pool, &p, None, at("2026-09-25T13:30:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::NoLocation);
        assert_eq!(p.calls(), 0);
    }

    #[tokio::test]
    async fn a_fresh_cache_is_served_without_a_call() {
        let pool = test_pool().await;
        let p = FakeWeather::ok();
        let first = load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        assert_eq!((first.status, first.fetched_at.as_deref()), (WeatherStatus::Fresh, Some("2026-09-25T13:30:00Z")));
        let again = load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T14:29:00Z")).await.unwrap();
        assert_eq!(again.status, WeatherStatus::Fresh);
        assert_eq!(p.calls(), 1);
    }

    #[tokio::test]
    async fn an_hour_old_cache_refetches() {
        let pool = test_pool().await;
        let p = FakeWeather::ok();
        load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        let v = load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T14:31:00Z")).await.unwrap();
        assert_eq!((v.status, v.fetched_at.as_deref()), (WeatherStatus::Fresh, Some("2026-09-25T14:31:00Z")));
        assert_eq!(p.calls(), 2);
    }

    #[tokio::test]
    async fn offline_serves_the_last_forecast_as_stale() {
        let pool = test_pool().await;
        load_forecast(&pool, &FakeWeather::ok(), Some(&sf()), at("2026-09-25T13:31:00Z")).await.unwrap();
        let v = load_forecast(&pool, &FakeWeather::offline(), Some(&sf()), at("2026-09-25T16:00:00Z")).await.unwrap();
        assert_eq!((v.status, v.fetched_at.as_deref()), (WeatherStatus::Stale, Some("2026-09-25T13:31:00Z")));
        assert!(v.forecast.is_some());
    }

    #[tokio::test]
    async fn offline_with_nothing_cached_is_unavailable() {
        let pool = test_pool().await;
        let v = load_forecast(&pool, &FakeWeather::offline(), Some(&sf()), at("2026-09-25T16:00:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::Unavailable);
        assert!(v.forecast.is_none() && v.location == Some(sf()));
    }
}
```

Create `nimble-core/src/brief/modules/weather.rs` with only its tests for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::weather::testing::{at, sf, FakeWeather};
    use crate::api::weather::WeatherStatus;
    use crate::brief::settings::{save_patch, BriefSettingsPatch};
    use crate::test_util::test_pool;

    async fn with_location(pool: &sqlx::SqlitePool) {
        save_patch(pool, BriefSettingsPatch { location: Some(Some(sf())), ..Default::default() }, "2026-09-25 07:00:00").await.unwrap();
    }

    #[tokio::test]
    async fn the_snapshot_freezes_the_cached_forecast_for_that_day_only() {
        let pool = test_pool().await;
        with_location(&pool).await;
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-25", "2026-09-25").await.unwrap().unwrap();
        assert!(b.snapshot.get("weather").is_some_and(|w| w.is_null()), "nothing cached yet: frozen as null");
        let v = refresh(&pool, &FakeWeather::ok(), "2026-09-25", at("2026-09-25T13:30:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::Fresh);
        let b = crate::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["forecast"]["days"][0]["high_c"], 21.1);
        assert_eq!(b.snapshot["weather"]["fetched_at"], "2026-09-25T13:30:00Z");
        refresh(&pool, &FakeWeather::ok(), "2026-09-25", at("2026-09-25T15:00:00Z")).await.unwrap();
        let b = crate::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["fetched_at"], "2026-09-25T13:30:00Z", "never rewritten once frozen");
    }

    #[tokio::test]
    async fn a_cached_forecast_without_the_brief_date_is_not_frozen() {
        let pool = test_pool().await;
        with_location(&pool).await;
        crate::api::weather::load_forecast(&pool, &FakeWeather::ok(), Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-27", "2026-09-27").await.unwrap().unwrap();
        assert!(b.snapshot["weather"].is_null(), "the cache holds the 25th only");
    }

    #[tokio::test]
    async fn weather_off_that_morning_is_never_patched_in() {
        let pool = test_pool().await;
        with_location(&pool).await;
        crate::db::settings::set_setting(&pool, "brief.modules", r#"[{"id":"weather","enabled":false,"config":{}}]"#).await.unwrap();
        crate::db::briefs::ensure_snapshot(&pool, "2026-09-25", "2026-09-25").await.unwrap();
        refresh(&pool, &FakeWeather::ok(), "2026-09-25", at("2026-09-25T13:30:00Z")).await.unwrap();
        let b = crate::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().unwrap();
        assert!(b.snapshot.get("weather").is_none());
    }

    #[tokio::test]
    async fn the_snapshot_reads_the_cache_and_never_the_network() {
        let pool = test_pool().await;
        with_location(&pool).await;
        crate::api::weather::load_forecast(&pool, &FakeWeather::ok(), Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-25", "2026-09-25").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["location"]["name"], "San Francisco, California");
    }
}
```

Update the Task 1 layout assertions for the new first module. In `brief/settings.rs` `defaults_match_the_phase_one_layout`, the enabled list becomes `["weather", "schedule", "priorities", "due_today", "still_open", "vault"]`. In `stored_order_wins_…` the ids become `["vault", "schedule", "weather", "priorities", "due_today", "still_open", "habits", "notes"]` (appended modules follow registry order). In `db/briefs.rs` `first_open_writes_one_snapshot_with_split_lists`, the ids become `["weather", "schedule", "priorities", "due_today", "still_open", "vault"]` and the sorted keys become `["due_today", "priorities", "schedule", "still_open", "vault", "weather"]`. In `snapshot_follows_brief_modules`, the ids become `["due_today", "still_open", "weather", "priorities", "vault"]`.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test --offline -p nimble-core --lib weather v25 module_cache`
Expected: FAIL to compile (`forecast_url`, `refresh` … not found).

- [ ] **Step 3: Migration, pins, export policy.** Append to `MIGRATIONS` in `nimble-core/src/db/migrations.rs` after v23, and set `pub const CURRENT_SCHEMA_VERSION: i64 = 25; // schema-v25`:

```rust
    Migration {
        version: 25, // schema-v25 — C4 owns 24; renumber per plan Global Constraints if C4 hasn't merged
        description: "Device-local brief module cache (weather)",
        sql: "CREATE TABLE IF NOT EXISTS module_cache (
            module_id TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (module_id, cache_key)
        )",
    },
```

`nimble-core/src/db/export_policy.rs`: add `/// V25 adds the device-local `module_cache` (reviewed, excluded: a cache, never portable data). (schema-v25)` to the doc comment, extend the version gate to `if version != 20 && version != 21 && version != 22 && version != 23 && version != 25 { return None; } // schema-v25`, and before `tables.sort_by_key` add:

```rust
    if version >= 25 { // schema-v25
        tables.push(table!("module_cache"; ["module_id","cache_key","payload_json","fetched_at"]; []; ["module_id","cache_key"]));
    }
```

`nimble-core/src/db/backup.rs:298`: `19 | 20 | 21 | 22 | 23 | 25` (add `// schema-v25` on that line). Change `23` → `25` (with `// schema-v25`) at `tests/schema22_origin_label.rs:30`, `tests/focus_schema.rs:72`, `tests/schema20_compatibility.rs:371`, `tests/backup_export.rs:35` and `tests/focus_backup.rs:31`. Any **other** pin the full suite reveals gets the same edit: list each one in the ledger.

- [ ] **Step 4: `nimble-core/src/db/module_cache.rs`** (and `pub mod module_cache;` in `db/mod.rs`):

```rust
//! Device-local cache for brief modules (v25 `module_cache`). Never synced
//! (not in sync's allow-list) and never exported (export policy excludes it).

use sqlx::SqlitePool;

/// `(payload_json, fetched_at)` for one cached entry.
pub async fn get(pool: &SqlitePool, module_id: &str, cache_key: &str) -> crate::Result<Option<(String, String)>> {
    Ok(sqlx::query_as("SELECT payload_json, fetched_at FROM module_cache WHERE module_id = ? AND cache_key = ?")
        .bind(module_id)
        .bind(cache_key)
        .fetch_optional(pool)
        .await?)
}

pub async fn put(pool: &SqlitePool, module_id: &str, cache_key: &str, payload_json: &str, fetched_at: &str) -> crate::Result<()> {
    sqlx::query(
        "INSERT INTO module_cache (module_id, cache_key, payload_json, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(module_id, cache_key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
    )
    .bind(module_id)
    .bind(cache_key)
    .bind(payload_json)
    .bind(fetched_at)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn put_overwrites_and_keys_are_per_module() {
        let pool = test_pool().await;
        super::put(&pool, "weather", "37.775,-122.419", "{\"a\":1}", "2026-09-25T13:30:00Z").await.unwrap();
        super::put(&pool, "weather", "37.775,-122.419", "{\"a\":2}", "2026-09-25T14:30:00Z").await.unwrap();
        assert_eq!(super::get(&pool, "weather", "37.775,-122.419").await.unwrap(),
            Some(("{\"a\":2}".to_string(), "2026-09-25T14:30:00Z".to_string())));
        assert!(super::get(&pool, "other", "37.775,-122.419").await.unwrap().is_none());
    }
}
```

- [ ] **Step 5: `nimble-core/src/api/weather.rs`** (above the test modules; add `pub mod weather;` to `api/mod.rs`):

```rust
//! Open-Meteo weather + geocoding behind `WeatherProvider` (addendum §4).
//! Temperatures are always fetched in °C; the frontend converts for display,
//! so a units change never invalidates the cache and snapshots stay
//! unit-free. Unit tests parse fixtures and use `testing::FakeWeather`; no
//! test reaches the network.

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::types::BriefLocation;

pub const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
pub const GEOCODE_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
pub const CACHE_MODULE: &str = "weather";
pub const FRESH_MINUTES: i64 = 60;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WeatherDay {
    pub date: String,
    pub high_c: f64,
    pub low_c: f64,
    pub precip_max: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WeatherHour {
    /// Location-local "YYYY-MM-DDTHH:MM" (`timezone=auto`).
    pub time: String,
    pub temp_c: f64,
    pub precip: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Forecast {
    pub timezone: String,
    pub current_time: Option<String>,
    pub current_c: Option<f64>,
    pub days: Vec<WeatherDay>,
    pub hourly: Vec<WeatherHour>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GeoPlace {
    pub name: String,
    pub admin1: Option<String>,
    pub country: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub tz: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeatherStatus { NoLocation, Fresh, Stale, Unavailable }

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct WeatherView {
    pub status: WeatherStatus,
    pub location: Option<BriefLocation>,
    pub forecast: Option<Forecast>,
    /// RFC 3339 UTC of the forecast shown (the frontend renders "as of h:mm").
    pub fetched_at: Option<String>,
}

#[allow(async_fn_in_trait)]
pub trait WeatherProvider {
    async fn forecast(&self, lat: f64, lon: f64) -> crate::Result<Forecast>;
    async fn geocode(&self, query: &str) -> crate::Result<Vec<GeoPlace>>;
}

pub struct OpenMeteo {
    client: reqwest::Client,
}

impl OpenMeteo {
    pub fn new() -> crate::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| crate::Error::Api(format!("weather client: {e}")))?;
        Ok(Self { client })
    }

    async fn get_text(&self, url: reqwest::Url) -> crate::Result<String> {
        let resp = self.client.get(url).send().await.map_err(|e| crate::Error::Api(format!("weather request failed: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(crate::Error::Api(format!("weather returned {status}")));
        }
        resp.text().await.map_err(|e| crate::Error::Api(format!("weather body: {e}")))
    }
}

impl WeatherProvider for OpenMeteo {
    async fn forecast(&self, lat: f64, lon: f64) -> crate::Result<Forecast> {
        parse_forecast(&self.get_text(forecast_url(lat, lon)).await?)
    }
    async fn geocode(&self, query: &str) -> crate::Result<Vec<GeoPlace>> {
        parse_geocode(&self.get_text(geocode_url(query)).await?)
    }
}

pub fn forecast_url(lat: f64, lon: f64) -> reqwest::Url {
    let mut url = reqwest::Url::parse(FORECAST_URL).expect("static forecast url");
    url.query_pairs_mut()
        .append_pair("latitude", &format!("{lat:.4}"))
        .append_pair("longitude", &format!("{lon:.4}"))
        .append_pair("current", "temperature_2m")
        .append_pair("hourly", "temperature_2m,precipitation_probability")
        .append_pair("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max")
        .append_pair("temperature_unit", "celsius")
        .append_pair("timezone", "auto")
        .append_pair("forecast_days", "2");
    url
}

pub fn geocode_url(query: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse(GEOCODE_URL).expect("static geocode url");
    url.query_pairs_mut()
        .append_pair("name", query)
        .append_pair("count", "5")
        .append_pair("language", "en")
        .append_pair("format", "json");
    url
}

/// A search worth sending: trimmed, 2–100 characters.
pub fn normalize_query(q: &str) -> Option<&str> {
    let q = q.trim();
    let n = q.chars().count();
    (2..=100).contains(&n).then_some(q)
}

#[derive(Deserialize)]
struct RawForecast { timezone: String, current: Option<RawCurrent>, hourly: RawHourly, daily: RawDaily }
#[derive(Deserialize)]
struct RawCurrent { time: String, temperature_2m: Option<f64> }
#[derive(Deserialize)]
struct RawHourly {
    time: Vec<String>,
    temperature_2m: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_probability: Vec<Option<f64>>,
}
#[derive(Deserialize)]
struct RawDaily {
    time: Vec<String>,
    temperature_2m_max: Vec<Option<f64>>,
    temperature_2m_min: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_probability_max: Vec<Option<f64>>,
}

fn pct(v: Option<&Option<f64>>) -> Option<i64> {
    v.copied().flatten().map(|p| p.round() as i64)
}

pub fn parse_forecast(body: &str) -> crate::Result<Forecast> {
    let raw: RawForecast = serde_json::from_str(body).map_err(|e| crate::Error::Parse(format!("weather forecast: {e}")))?;
    let days: Vec<WeatherDay> = raw.daily.time.iter().enumerate()
        .filter_map(|(i, date)| Some(WeatherDay {
            date: date.clone(),
            high_c: raw.daily.temperature_2m_max.get(i).copied().flatten()?,
            low_c: raw.daily.temperature_2m_min.get(i).copied().flatten()?,
            precip_max: pct(raw.daily.precipitation_probability_max.get(i)),
        }))
        .collect();
    if days.is_empty() {
        return Err(crate::Error::Parse("weather forecast: no daily data".into()));
    }
    let hourly: Vec<WeatherHour> = raw.hourly.time.iter().enumerate()
        .filter_map(|(i, time)| Some(WeatherHour {
            time: time.clone(),
            temp_c: raw.hourly.temperature_2m.get(i).copied().flatten()?,
            precip: pct(raw.hourly.precipitation_probability.get(i)),
        }))
        .collect();
    let (current_time, current_c) = match raw.current {
        Some(c) => (Some(c.time), c.temperature_2m),
        None => (None, None),
    };
    Ok(Forecast { timezone: raw.timezone, current_time, current_c, days, hourly })
}

#[derive(Deserialize)]
struct RawGeo {
    #[serde(default)]
    results: Vec<RawPlace>,
}
#[derive(Deserialize)]
struct RawPlace { name: String, latitude: f64, longitude: f64, timezone: Option<String>, admin1: Option<String>, country: Option<String> }

pub fn parse_geocode(body: &str) -> crate::Result<Vec<GeoPlace>> {
    let raw: RawGeo = serde_json::from_str(body).map_err(|e| crate::Error::Parse(format!("weather geocode: {e}")))?;
    Ok(raw.results.into_iter()
        .filter_map(|p| Some(GeoPlace { tz: p.timezone?, name: p.name, admin1: p.admin1, country: p.country, lat: p.latitude, lon: p.longitude }))
        .collect())
}

fn cache_key(loc: &BriefLocation) -> String {
    format!("{:.3},{:.3}", loc.lat, loc.lon)
}

/// The last forecast stored for `loc` and when it was fetched.
pub async fn cached(pool: &SqlitePool, loc: &BriefLocation) -> crate::Result<Option<(Forecast, String)>> {
    let Some((json, at)) = crate::db::module_cache::get(pool, CACHE_MODULE, &cache_key(loc)).await? else { return Ok(None) };
    Ok(serde_json::from_str::<Forecast>(&json).ok().map(|f| (f, at)))
}

fn is_fresh(fetched_at: &str, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(fetched_at)
        .map(|t| now.signed_duration_since(t.with_timezone(&Utc)) < chrono::Duration::minutes(FRESH_MINUTES))
        .unwrap_or(false)
}

fn view(status: WeatherStatus, loc: &BriefLocation, forecast: Option<Forecast>, fetched_at: Option<String>) -> WeatherView {
    WeatherView { status, location: Some(loc.clone()), forecast, fetched_at }
}

/// Serve the cache while fresh (60 min); otherwise fetch and store. A
/// failed fetch falls back to the last forecast (`Stale`, keeping its
/// `fetched_at`) or `Unavailable`. Never errors on the network.
pub async fn load_forecast<P: WeatherProvider>(
    pool: &SqlitePool,
    provider: &P,
    location: Option<&BriefLocation>,
    now: DateTime<Utc>,
) -> crate::Result<WeatherView> {
    let Some(loc) = location else {
        return Ok(WeatherView { status: WeatherStatus::NoLocation, location: None, forecast: None, fetched_at: None });
    };
    let cache = cached(pool, loc).await?;
    if let Some((forecast, at)) = &cache {
        if is_fresh(at, now) {
            return Ok(view(WeatherStatus::Fresh, loc, Some(forecast.clone()), Some(at.clone())));
        }
    }
    match provider.forecast(loc.lat, loc.lon).await {
        Ok(forecast) => {
            let at = now.to_rfc3339_opts(SecondsFormat::Secs, true);
            let json = serde_json::to_string(&forecast).map_err(|e| crate::Error::Parse(e.to_string()))?;
            crate::db::module_cache::put(pool, CACHE_MODULE, &cache_key(loc), &json, &at).await?;
            Ok(view(WeatherStatus::Fresh, loc, Some(forecast), Some(at)))
        }
        Err(e) => {
            log::info!("weather fetch failed, serving the cache: {e}");
            Ok(match cache {
                Some((forecast, at)) => view(WeatherStatus::Stale, loc, Some(forecast), Some(at)),
                None => view(WeatherStatus::Unavailable, loc, None, None),
            })
        }
    }
}
```

- [ ] **Step 6: The `weather` module and the snapshot patch.** Above the tests in `nimble-core/src/brief/modules/weather.rs`:

```rust
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::api::weather::{Forecast, WeatherProvider, WeatherView};
use crate::brief::{BriefCtx, BriefModule, ChoiceOption, ConfigField, Integration, ModuleKind, ModuleManifest};
use crate::types::BriefLocation;

/// Renders as the brief's header chip, never as a box (addendum §4).
pub struct Weather;

impl BriefModule for Weather {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "weather",
            name: "Weather chip",
            kind: ModuleKind::Fixed,
            requires: vec![Integration::Location],
            default_enabled: true,
            config_schema: vec![
                ConfigField::Choice {
                    key: "units",
                    label: "Units",
                    options: vec![
                        ChoiceOption { value: json!("auto"), label: "Auto" },
                        ChoiceOption { value: json!("F"), label: "°F" },
                        ChoiceOption { value: json!("C"), label: "°C" },
                    ],
                    default: json!("auto"),
                },
                ConfigField::Bool { key: "rain_notes", label: "Rain notes", default: true },
            ],
        }
    }

    /// The cached forecast for the brief location, only if it covers the
    /// brief's date. Never the network: an offline first open still snapshots.
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let Some(loc) = crate::brief::settings::read_location(ctx.pool).await? else { return Ok(Value::Null) };
        Ok(match crate::api::weather::cached(ctx.pool, &loc).await? {
            Some((forecast, at)) if forecast.days.iter().any(|d| d.date == ctx.date) => snapshot_payload(&loc, &forecast, &at),
            _ => Value::Null,
        })
    }
}

/// `snapshot.weather` (TS `WeatherSnapshot`).
pub fn snapshot_payload(loc: &BriefLocation, forecast: &Forecast, fetched_at: &str) -> Value {
    json!({"location": loc, "forecast": forecast, "fetched_at": fetched_at})
}

/// Today's weather for the chip, then freeze it into today's snapshot if
/// that morning's `weather` was recorded empty (first success only).
pub async fn refresh<P: WeatherProvider>(pool: &SqlitePool, provider: &P, today: &str, now: DateTime<Utc>) -> crate::Result<WeatherView> {
    let location = crate::brief::settings::read_location(pool).await?;
    let view = crate::api::weather::load_forecast(pool, provider, location.as_ref(), now).await?;
    if let (Some(loc), Some(forecast), Some(at)) = (&view.location, &view.forecast, &view.fetched_at) {
        if forecast.days.iter().any(|d| d.date == today) {
            crate::db::briefs::patch_snapshot_if_null(pool, today, "weather", snapshot_payload(loc, forecast, at)).await?;
        }
    }
    Ok(view)
}
```

Register it: `pub mod weather;` in `brief/modules/mod.rs`. In `brief/mod.rs`, add `weather::Weather::manifest(),` as the **first** line of `manifests()` and `"weather" => weather::Weather.gather(ctx, config).await,` to `gather_module()`.

In `nimble-core/src/db/briefs.rs`, add the patch (leave `set_priorities` as it is). It is one conditional `UPDATE … json_set`, not read-modify-write, so a concurrent writer to another key of the same `snapshot_json` (phase 3's composition) can't be overwritten by a stale read:

```rust
/// Fill one module's payload if that morning recorded it empty (key
/// present, value JSON null). An absent key means the module was off; a
/// filled one stays frozen. Atomic in SQL. Returns whether it wrote.
pub async fn patch_snapshot_if_null(pool: &SqlitePool, date: &str, key: &str, value: serde_json::Value) -> crate::Result<bool> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(crate::Error::Other(format!("invalid snapshot key: {key}")));
    }
    let path = format!("$.{key}");
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let changed = sqlx::query(
        "UPDATE briefs SET snapshot_json = json_set(snapshot_json, ?, json(?)), updated_at = ?
         WHERE date = ? AND json_type(snapshot_json, ?) = 'null'",
    )
    .bind(&path).bind(value.to_string()).bind(&now).bind(date).bind(&path)
    .execute(pool).await?
    .rows_affected();
    if changed == 0 { return Ok(false); }
    if let Some(b) = get_brief(pool, date).await? {
        sync::append_sync_log(pool, "briefs", date, "UPDATE",
            Some(&serde_json::json!(["snapshot_json", "updated_at"]).to_string()), Some(&sync_snapshot(&b))).await.ok();
    }
    Ok(true)
}
```

- [ ] **Step 7: Run the Rust tests**

Run: `cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked" -A2`
Expected: all PASS (the v25 pins and the layout-order edits included).

- [ ] **Step 8: Tauri commands.** Create `apps/desktop/src-tauri/src/commands/weather.rs`:

```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use nimble_core::api::weather::{normalize_query, GeoPlace, OpenMeteo, WeatherProvider, WeatherView};

/// Today's forecast for the brief chip (cache first, 60 min fresh), freezing
/// it into today's snapshot on the first success.
#[tauri::command]
pub async fn weather_get(app: AppHandle) -> Result<WeatherView, String> {
    let pool = app.state::<SqlitePool>();
    let provider = OpenMeteo::new().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    nimble_core::brief::modules::weather::refresh(pool.inner(), &provider, &today, chrono::Utc::now())
        .await
        .map_err(|e| e.to_string())
}

/// City search for Settings → Location & weather and the setup.
#[tauri::command]
pub async fn weather_geocode(query: String) -> Result<Vec<GeoPlace>, String> {
    let Some(q) = normalize_query(&query) else { return Ok(Vec::new()) };
    OpenMeteo::new().map_err(|e| e.to_string())?.geocode(q).await.map_err(|e| e.to_string())
}
```

Add `pub mod weather;` to `commands/mod.rs`, add `weather` to the `use commands::{…}` list in `lib.rs`, and append after the Task 2 entries in `invoke_handler!`:

```rust
            weather::weather_get,
            weather::weather_geocode,
```

- [ ] **Step 9: Contract.** Append to `packages/types/src/index.ts`:

```ts
// ── Weather (phase 2, addendum §4) — temperatures in °C, converted for display ──

export interface WeatherDay {
  date: string
  high_c: number
  low_c: number
  precip_max: number | null
}
export interface WeatherHour {
  /** Location-local "YYYY-MM-DDTHH:MM". */
  time: string
  temp_c: number
  precip: number | null
}
export interface Forecast {
  timezone: string
  current_time: string | null
  current_c: number | null
  days: WeatherDay[]
  hourly: WeatherHour[]
}
export type WeatherStatus = 'no_location' | 'fresh' | 'stale' | 'unavailable'
export interface WeatherView {
  status: WeatherStatus
  location: BriefLocation | null
  forecast: Forecast | null
  /** RFC 3339 UTC. */
  fetched_at: string | null
}
export interface GeoPlace {
  name: string
  admin1: string | null
  country: string | null
  lat: number
  lon: number
  tz: string
}
/** `snapshot.weather`: the forecast the brief showed that morning. */
export interface WeatherSnapshot {
  location: BriefLocation
  forecast: Forecast
  fetched_at: string
}
export interface WeatherCapability {
  supported: boolean
  get(): Promise<WeatherView>
  geocode(query: string): Promise<GeoPlace[]>
}
```

Add `weather?: WeatherSnapshot | null` to `BriefSnapshotV1`. In `data-provider.ts`, add `weather: import('./index').WeatherCapability` after `briefSettings`. In `services/tauri.ts`, extend the Task 2 type import with `GeoPlace, WeatherView` and append:

```ts
// ── Weather (phase 2) ──

export async function weatherGet(): Promise<WeatherView> {
  return invoke<WeatherView>('weather_get')
}

export async function weatherGeocode(query: string): Promise<GeoPlace[]> {
  return invoke<GeoPlace[]>('weather_geocode', { query })
}
```

`tauri-provider.ts`: `weather: { supported: true, get: tauri.weatherGet, geocode: tauri.weatherGeocode },`. `turso-provider.ts`: `weather: { supported: false, get: ni('weather.get'), geocode: ni('weather.geocode') }, // HTTP stays in Rust (§6)`.

- [ ] **Step 10: Mock.** In `tools/mock-tauri.js`, add the weather manifest as the first `BRIEF_MANIFESTS` entry:

```js
    { id: 'weather', name: 'Weather chip', kind: 'fixed', requires: ['location'], default_enabled: true,
      config_schema: [choiceField('units', 'Units', [['auto', 'Auto'], ['F', '°F'], ['C', '°C']], 'auto'), boolField('rain_notes', 'Rain notes')] },
```

Add after the brief-settings block:

```js
  // ── Weather (phase 2) ─ ?weather=fresh (default) | stale | none | unavailable
  // TODAY in San Francisco: 21.1/13.9 °C (70/57 °F), 60% rain 19:00–21:00,
  // which puts a rain note on the 19:00 Warfield event.
  var weatherScenario = new URLSearchParams(window.location.search).get('weather') || 'fresh'
  function mockForecast() {
    var hourly = []
    ;[TODAY, '2026-08-02'].forEach(function (d) {
      for (var h = 0; h < 24; h++) {
        hourly.push({
          time: d + 'T' + String(h).padStart(2, '0') + ':00',
          temp_c: Math.round((13.9 + 7.2 * Math.max(0, Math.sin(((h - 6) / 12) * Math.PI))) * 10) / 10,
          precip: d === TODAY && h >= 19 && h <= 21 ? 60 : 10,
        })
      }
    })
    return {
      timezone: 'America/Los_Angeles', current_time: TODAY + 'T07:00', current_c: 15.0, hourly: hourly,
      days: [{ date: TODAY, high_c: 21.1, low_c: 13.9, precip_max: 60 }, { date: '2026-08-02', high_c: 20.0, low_c: 13.0, precip_max: 10 }],
    }
  }
  var MOCK_PLACES = [
    { name: 'San Francisco', admin1: 'California', country: 'United States', lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' },
    { name: 'San Diego', admin1: 'California', country: 'United States', lat: 32.7157, lon: -117.1611, tz: 'America/Los_Angeles' },
    { name: 'Santiago', admin1: 'Santiago Metropolitan', country: 'Chile', lat: -33.4489, lon: -70.6693, tz: 'America/Santiago' },
    { name: 'Lisbon', admin1: 'Lisbon', country: 'Portugal', lat: 38.7223, lon: -9.1393, tz: 'Europe/Lisbon' },
  ]
```

and in `commands`:

```js
    weather_get: function () {
      var loc = briefSettingsView().location
      if (weatherScenario === 'none' || !loc) return { status: 'no_location', location: null, forecast: null, fetched_at: null }
      if (weatherScenario === 'unavailable') return { status: 'unavailable', location: loc, forecast: null, fetched_at: null }
      var stale = weatherScenario === 'stale'
      return { status: stale ? 'stale' : 'fresh', location: loc, forecast: mockForecast(), fetched_at: stale ? '2026-08-01T13:31:00Z' : '2026-08-01T14:00:00Z' }
    },
    weather_geocode: function (args) {
      var q = String((args && args.query) || '').trim().toLowerCase()
      if (q.length < 2) return []
      return MOCK_PLACES.filter(function (p) { return p.name.toLowerCase().indexOf(q) === 0 }).slice(0, 5)
    },
```

- [ ] **Step 11: Guard test** `apps/desktop/tests/briefCommands.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const COMMANDS = ['brief_settings_get', 'brief_settings_save', 'brief_set_notes', 'weather_get', 'weather_geocode']

// A command missing from any of these fails only in the real app (lib.rs),
// only on desktop (tauri.ts) or only in the browser harness (mock).
test('every phase-2 brief command is registered, wrapped and mocked', () => {
  const lib = read('../src-tauri/src/lib.rs')
  const wrappers = read('../src/services/tauri.ts')
  const mock = read('../../../tools/mock-tauri.js')
  for (const cmd of COMMANDS) {
    assert.match(lib, new RegExp(`::${cmd},`), `lib.rs invoke_handler lists ${cmd}`)
    assert.ok(wrappers.includes(`'${cmd}'`), `services/tauri.ts wraps ${cmd}`)
    assert.match(mock, new RegExp(`\\b${cmd}: function`), `mock-tauri.js mocks ${cmd}`)
  }
})
```

Run: `cd apps/desktop && node --test tests/briefCommands.test.mjs` → PASS.

- [ ] **Step 12: Verify all, then commit**

Run: `cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED"`, then `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: all pass, and lint ≤ `LINT_BASELINE`.

```bash
git add nimble-core packages/types apps/desktop/src-tauri apps/desktop/src/services apps/desktop/tests/briefCommands.test.mjs tools/mock-tauri.js
git commit -m "feat(brief): weather — v25 module_cache, Open-Meteo provider + geocode, offline cache, snapshot freeze

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 4: Weather chip + popover + rain notes (frontend), mounted in the Today header

**Files:**
- Create: `apps/desktop/src/lib/weather.ts`, `apps/desktop/tests/weather.test.mjs`, `apps/desktop/src/hooks/useWeather.ts`, `apps/desktop/src/components/today/WeatherChip.tsx`
- Modify: `apps/desktop/src/components/pages/TodayPage.tsx` (load brief settings, call `useWeather`, render the chip in the header)

**Interfaces:**
- Consumes: `dp.weather.get()` / `WeatherView` (Task 3); `useBriefSettingsStore`, `configValue` (Task 2); `hhmm`, `nowHHMM` (`lib/todayBrief.ts`); `openSettings` (`stores/settingsNavStore`).
- Produces:

```ts
// lib/weather.ts
export type TempUnit = 'F' | 'C'
export const RAIN_SHOWN = 20, RAIN_LIKELY = 50
export function resolveUnits(setting: unknown, locale: string | undefined): TempUnit
export function toUnit(celsius: number, unit: TempUnit): number
export function dayFor(forecast: Forecast | null | undefined, date: string): WeatherDay | null
export function chipLabel(day: WeatherDay, unit: TempUnit): string          // "70°/57° · 60%"
export function chipIcon(day: WeatherDay): 'sun' | 'cloud-sun' | 'rain'
export function hourOf(time: string): number
export function hoursOn(forecast: Forecast | null | undefined, date: string): WeatherHour[]
export function hourlyPoints(hours: WeatherHour[], fromHour: number): WeatherHour[]   // ≤4, now → 21:00
export function rainWindow(hours: WeatherHour[], fromHour: number): { start: number; end: number } | null
export function formatRainWindow(w: { start: number; end: number }): string
export function rainNotes(events, hours): { summary: string; time: string }[]
export function clock12(time: string): string                                  // "19:00" → "7:00"
export function hourLabel(hour: number): string                                // 16 → "4 pm"
export function asOfLabel(iso: string): string                                 // local "6:31"
export function placeLabel(p: Pick<GeoPlace, 'name' | 'admin1' | 'country'>): string
// hooks/useWeather.ts
export function useWeather(enabled: boolean, key: string): { view: WeatherView | null; loading: boolean }
// components/today/WeatherChip.tsx
export function WeatherChip(props: { view: WeatherView | null; loading?: boolean; date: string; events: CalendarEvent[]; unit: TempUnit; showRainNotes: boolean; live: boolean })
```

- [ ] **Step 1: Write the failing test** `apps/desktop/tests/weather.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveUnits, toUnit, dayFor, chipLabel, chipIcon, hoursOn, hourlyPoints, rainWindow, formatRainWindow,
  rainNotes, clock12, hourLabel, asOfLabel, placeLabel,
} from '../src/lib/weather.ts'

const day = (precip_max) => ({ date: '2026-08-01', high_c: 21.1, low_c: 13.9, precip_max })
const hours = (date, wet = []) =>
  Array.from({ length: 24 }, (_, h) => ({ time: `${date}T${String(h).padStart(2, '0')}:00`, temp_c: 15, precip: wet.includes(h) ? 60 : 10 }))

test('auto units: °F for en-US only; an explicit choice wins', () => {
  assert.equal(resolveUnits('auto', 'en-US'), 'F')
  assert.equal(resolveUnits('auto', 'en-GB'), 'C')
  assert.equal(resolveUnits(undefined, undefined), 'C')
  assert.equal(resolveUnits('C', 'en-US'), 'C')
  assert.equal(resolveUnits('F', 'pt-PT'), 'F')
})

test('conversion rounds; the chip shows rain only from 20%', () => {
  assert.equal(toUnit(21.1, 'F'), 70)
  assert.equal(toUnit(13.9, 'F'), 57)
  assert.equal(toUnit(13.9, 'C'), 14)
  assert.equal(chipLabel(day(60), 'F'), '70°/57° · 60%')
  assert.equal(chipLabel(day(19), 'F'), '70°/57°')
  assert.equal(chipLabel(day(null), 'C'), '21°/14°')
  assert.deepEqual([chipIcon(day(10)), chipIcon(day(20)), chipIcon(day(50))], ['sun', 'cloud-sun', 'rain'])
})

test('dayFor and hoursOn pick the brief date only', () => {
  const forecast = { timezone: 'UTC', current_time: null, current_c: null, days: [day(1), { ...day(2), date: '2026-08-02' }], hourly: [...hours('2026-08-01'), ...hours('2026-08-02')] }
  assert.equal(dayFor(forecast, '2026-08-02').precip_max, 2)
  assert.equal(dayFor(forecast, '2026-08-03'), null)
  assert.equal(dayFor(null, '2026-08-01'), null)
  assert.equal(hoursOn(forecast, '2026-08-01').length, 24)
})

test('four hourly points from now to the evening', () => {
  const h = hours('2026-08-01')
  assert.deepEqual(hourlyPoints(h, 7).map((x) => x.time.slice(11, 13)), ['07', '12', '16', '21'])
  assert.deepEqual(hourlyPoints(h, 18).map((x) => x.time.slice(11, 13)), ['18', '19', '20', '21'])
  assert.deepEqual(hourlyPoints(h, 22).map((x) => x.time.slice(11, 13)), ['22', '23'])
  assert.deepEqual(hourlyPoints([], 7), [])
})

test('rain window: the first run of likely-rain hours from now', () => {
  const h = hours('2026-08-01', [9, 19, 20, 21])
  assert.deepEqual(rainWindow(h, 7), { start: 9, end: 10 })
  assert.deepEqual(rainWindow(h, 12), { start: 19, end: 22 })
  assert.equal(rainWindow(h, 22), null)
  assert.equal(formatRainWindow({ start: 19, end: 22 }), 'Rain likely 7 pm to 10 pm')
})

test('rain notes: timed events whose hour is likely wet, real and mock time shapes', () => {
  const h = hours('2026-08-01', [19])
  const events = [
    { summary: 'Turnstile', start_time: '2026-08-01T19:00:00', all_day: false },
    { summary: 'Dinner', start_time: '19:30', all_day: false },
    { summary: 'Coffee', start_time: '14:00', all_day: false },
    { summary: 'Holiday', start_time: '', all_day: true },
  ]
  assert.deepEqual(rainNotes(events, h), [{ summary: 'Turnstile', time: '7:00' }, { summary: 'Dinner', time: '7:30' }])
})

test('clock and hour labels are 12-hour', () => {
  assert.equal(clock12('19:00'), '7:00')
  assert.equal(clock12('00:05'), '12:05')
  assert.equal(clock12('2026-08-01T12:30:00'), '12:30')
  assert.deepEqual([hourLabel(0), hourLabel(9), hourLabel(12), hourLabel(16)], ['12 am', '9 am', '12 pm', '4 pm'])
  assert.equal(asOfLabel('2026-09-25T06:31:00'), '6:31')
  assert.equal(asOfLabel('nope'), '')
})

test('place labels add the region, or the country without one', () => {
  assert.equal(placeLabel({ name: 'San Francisco', admin1: 'California', country: 'United States' }), 'San Francisco, California')
  assert.equal(placeLabel({ name: 'Lisbon', admin1: 'Lisbon', country: 'Portugal' }), 'Lisbon, Portugal')
  assert.equal(placeLabel({ name: 'Monaco', admin1: null, country: null }), 'Monaco')
})
```

Run: `cd apps/desktop && node --test tests/weather.test.mjs` → FAIL (module not found).

- [ ] **Step 2: Write `apps/desktop/src/lib/weather.ts`**

```ts
// Pure weather helpers for the brief chip and popover (addendum §4).
// Forecasts arrive in °C (nimble-core api/weather.rs); units convert here,
// so a units change never refetches. Plain TS for node tests.
import type { CalendarEvent, Forecast, GeoPlace, WeatherDay, WeatherHour } from '@nimble/types'
import { hhmm } from './todayBrief'

export type TempUnit = 'F' | 'C'
/** The chip shows the day's rain chance from this %. */
export const RAIN_SHOWN = 20
/** An hour counts as "rain likely" (window, rain notes) from this %. */
export const RAIN_LIKELY = 50
const EVENING = 21

export function resolveUnits(setting: unknown, locale: string | undefined): TempUnit {
  if (setting === 'F' || setting === 'C') return setting
  return locale === 'en-US' ? 'F' : 'C'
}

export function toUnit(celsius: number, unit: TempUnit): number {
  return Math.round(unit === 'F' ? (celsius * 9) / 5 + 32 : celsius)
}

export function dayFor(forecast: Forecast | null | undefined, date: string): WeatherDay | null {
  return forecast?.days.find((d) => d.date === date) ?? null
}

export function chipLabel(day: WeatherDay, unit: TempUnit): string {
  const temps = `${toUnit(day.high_c, unit)}°/${toUnit(day.low_c, unit)}°`
  return day.precip_max != null && day.precip_max >= RAIN_SHOWN ? `${temps} · ${day.precip_max}%` : temps
}

export function chipIcon(day: WeatherDay): 'sun' | 'cloud-sun' | 'rain' {
  const p = day.precip_max ?? 0
  return p >= RAIN_LIKELY ? 'rain' : p >= RAIN_SHOWN ? 'cloud-sun' : 'sun'
}

export function hourOf(time: string): number {
  return Number(time.slice(11, 13))
}

export function hoursOn(forecast: Forecast | null | undefined, date: string): WeatherHour[] {
  return (forecast?.hourly ?? []).filter((h) => h.time.startsWith(date))
}

/** Up to four points from `fromHour` to the evening (21:00); late in the
 *  day, the next hours instead. */
export function hourlyPoints(hours: WeatherHour[], fromHour: number): WeatherHour[] {
  const wanted =
    fromHour >= EVENING - 3
      ? [0, 1, 2, 3].map((i) => fromHour + i).filter((h) => h <= 23)
      : [0, 1, 2, 3].map((i) => fromHour + Math.round(((EVENING - fromHour) * i) / 3))
  return wanted
    .map((h) => hours.find((x) => hourOf(x.time) === h))
    .filter((x): x is WeatherHour => x !== undefined)
}

/** The first run of consecutive "rain likely" hours at or after `fromHour`
 *  (`end` is exclusive). */
export function rainWindow(hours: WeatherHour[], fromHour: number): { start: number; end: number } | null {
  let start: number | null = null
  let end = 0
  for (const h of hours) {
    const hour = hourOf(h.time)
    if (hour < fromHour) continue
    const wet = (h.precip ?? 0) >= RAIN_LIKELY
    if (wet && start === null) {
      start = hour
      end = hour + 1
    } else if (wet && hour === end) {
      end = hour + 1
    } else if (start !== null) {
      break
    }
  }
  return start === null ? null : { start, end }
}

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`
}

export function formatRainWindow(w: { start: number; end: number }): string {
  return `Rain likely ${hourLabel(w.start)} to ${hourLabel(w.end)}`
}

/** "19:00" (or the mock's ISO datetime) → "7:00". */
export function clock12(time: string): string {
  const [h, m] = hhmm(time).split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`
}

/** Timed events whose start hour is "rain likely" at the brief location. */
export function rainNotes(
  events: Pick<CalendarEvent, 'summary' | 'start_time' | 'all_day'>[],
  hours: WeatherHour[],
): { summary: string; time: string }[] {
  return events
    .filter((e) => !e.all_day && e.start_time)
    .flatMap((e) => {
      const hour = Number(hhmm(e.start_time).slice(0, 2))
      const slot = hours.find((x) => hourOf(x.time) === hour)
      return slot && (slot.precip ?? 0) >= RAIN_LIKELY ? [{ summary: e.summary, time: clock12(e.start_time) }] : []
    })
}

/** A fetch time as the local clock, "6:31". */
export function asOfLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return clock12(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
}

/** "San Francisco, California"; the country when there's no distinct region. */
export function placeLabel(p: Pick<GeoPlace, 'name' | 'admin1' | 'country'>): string {
  const region = p.admin1 && p.admin1 !== p.name ? p.admin1 : p.country
  return region ? `${p.name}, ${region}` : p.name
}
```

Run: `cd apps/desktop && node --test tests/weather.test.mjs` → PASS.

- [ ] **Step 3: Write `apps/desktop/src/hooks/useWeather.ts`**

```ts
import { useEffect, useState } from 'react'
import type { WeatherView } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'

const UNAVAILABLE: WeatherView = { status: 'unavailable', location: null, forecast: null, fetched_at: null }

/** Today's weather for the brief chip. Rust owns freshness (60-minute cache),
 *  so asking again on window focus is cheap and keeps a long-open app
 *  current without a timer. A new `key` (new day, new location) shows the
 *  skeleton until it lands; a focus refresh keeps the last view on screen.
 *  `view` is null when off or unsupported (web). */
export function useWeather(enabled: boolean, key: string): { view: WeatherView | null; loading: boolean } {
  const dp = useDataProvider()
  const on = enabled && dp.weather.supported
  const [state, setState] = useState<{ key: string; view: WeatherView } | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  useEffect(() => {
    if (!on) return
    const onFocus = () => setFocusTick((t) => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [on])

  useEffect(() => {
    if (!on) return
    let live = true
    dp.weather
      .get()
      .then((view) => { if (live) setState({ key, view }) })
      .catch(() => { if (live) setState({ key, view: UNAVAILABLE }) })
    return () => { live = false }
  }, [dp, on, key, focusTick])

  const view = on && state?.key === key ? state.view : null
  return { view, loading: on && view === null }
}
```

- [ ] **Step 4: Write `apps/desktop/src/components/today/WeatherChip.tsx`**

```tsx
import { CloudRain, CloudSun, MapPin, Sun } from 'lucide-react'
import type { CalendarEvent, WeatherView } from '@nimble/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Label, Meta } from '@/components/shared/typography'
import { openSettings } from '@/stores/settingsNavStore'
import { nowHHMM } from '@/lib/todayBrief'
import {
  RAIN_SHOWN, asOfLabel, chipIcon, chipLabel, dayFor, formatRainWindow, hourLabel, hourOf, hourlyPoints, hoursOn,
  rainNotes, rainWindow, toUnit, type TempUnit,
} from '@/lib/weather'
import { cn } from '@/lib/utils'

const ICONS = { sun: Sun, 'cloud-sun': CloudSun, rain: CloudRain } as const
const CHIP =
  'focus-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-meta tabular-nums text-foreground transition-colors duration-(--transition-fast) hover:bg-hover data-popup-open:bg-hover'

/** The brief's weather (addendum §4, Fantastical pattern): icon + high/low
 *  (+ rain chance ≥20%) in the header; click or Enter opens place + now,
 *  four hourly points, the rain window, rain notes for timed events and
 *  "as of · Open-Meteo". `live` = today (hours count from now, "Add
 *  location" offered); false = a past snapshot. */
export function WeatherChip({
  view,
  loading = false,
  date,
  events,
  unit,
  showRainNotes,
  live,
}: {
  view: WeatherView | null
  loading?: boolean
  date: string
  events: CalendarEvent[]
  unit: TempUnit
  showRainNotes: boolean
  live: boolean
}) {
  if (loading) return <Skeleton className="h-7 w-24 rounded-full" />
  if (!view) return null
  if (view.status === 'no_location') {
    if (!live) return null
    return (
      <button type="button" className={cn(CHIP, 'text-muted-foreground')} onClick={() => openSettings('today-location')}>
        <MapPin className="size-3.5" aria-hidden />
        Add location
      </button>
    )
  }
  const day = dayFor(view.forecast, date)
  if (!view.forecast || !day) return <Meta className="shrink-0">Weather unavailable</Meta>

  const Icon = ICONS[chipIcon(day)]
  const label = chipLabel(day, unit)
  const asOf = view.fetched_at ? asOfLabel(view.fetched_at) : ''
  const stale = view.status === 'stale' && asOf !== ''
  const hours = hoursOn(view.forecast, date)
  const fromHour = live ? Number(nowHHMM().slice(0, 2)) : 7
  const points = hourlyPoints(hours, fromHour)
  const rainSpan = rainWindow(hours, fromHour)
  const notes = showRainNotes ? rainNotes(events, hours) : []
  const now = live && view.forecast.current_c != null ? toUnit(view.forecast.current_c, unit) : null

  return (
    <Popover>
      <PopoverTrigger className={CHIP} aria-label={`Weather: ${label}${stale ? `, as of ${asOf}` : ''}. Details`}>
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        <span>{label}</span>
        {stale && <span className="text-muted-foreground">· as of {asOf}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="surface-popover w-72 gap-3 rounded-xl p-3 shadow-popover ring-0">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-body-strong">{view.location?.name}</span>
          {now != null && <Meta className="shrink-0 tabular-nums">Now {now}°</Meta>}
        </div>
        {points.length > 0 && (
          <ol aria-label="Next hours" className="grid grid-cols-4 gap-1">
            {points.map((h, i) => (
              <li key={h.time} className="flex flex-col items-center gap-0.5 rounded-md bg-muted/40 py-1.5">
                <Label>{i === 0 && live ? 'Now' : hourLabel(hourOf(h.time))}</Label>
                <span className="text-body tabular-nums">{toUnit(h.temp_c, unit)}°</span>
                {h.precip != null && h.precip >= RAIN_SHOWN && <Meta className="tabular-nums">{h.precip}%</Meta>}
              </li>
            ))}
          </ol>
        )}
        {rainSpan && <p className="text-body">{formatRainWindow(rainSpan)}</p>}
        {notes.length > 0 && (
          <ul className="space-y-0.5">
            {notes.map((n) => (
              <li key={`${n.summary}-${n.time}`} className="text-body">
                Rain likely during {n.summary} ({n.time})
              </li>
            ))}
          </ul>
        )}
        <Meta as="p">{asOf ? `as of ${asOf} · ` : ''}Open-Meteo</Meta>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 5: Mount it in the Today header** (the registry takes over in Task 5). In `apps/desktop/src/components/pages/TodayPage.tsx`, add the imports:

```tsx
import { WeatherChip } from '@/components/today/WeatherChip'
import { useWeather } from '@/hooks/useWeather'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { configValue } from '@/lib/briefLayout'
import { resolveUnits } from '@/lib/weather'
```

After `useCalendar()`, add:

```tsx
  const briefSettings = useBriefSettingsStore((s) => s.settings)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const weatherEntry = briefSettings?.modules.find((m) => m.id === 'weather')
  const location = briefSettings?.location
  const weather = useWeather(!!weatherEntry?.enabled, `${today}|${location ? `${location.lat},${location.lon}` : ''}`)
```

and in the header `actions`, before `<DateStrip …/>`:

```tsx
          {selected === today && weatherEntry?.enabled && (
            <WeatherChip
              view={weather.view}
              loading={weather.loading}
              date={today}
              events={events}
              unit={resolveUnits(weatherEntry.config.units, navigator.language)}
              showRainNotes={configValue(weatherEntry.config, 'rain_notes', true)}
              live
            />
          )}
```

- [ ] **Step 6: Verify**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: pass, and lint ≤ `LINT_BASELINE`. Then commit (Step 7) and run the harness smoke against a frozen build, which boots Today with the chip and axe-checks it:

```bash
tools/qa-frozen.sh $(git rev-parse HEAD) /private/tmp/claude-501/qa-b2 4620
cd apps/desktop && BASE_URL=http://localhost:4620 npx playwright test -c e2e e2e/harness.spec.ts
```

Expected: 12 passed. A new axe violation on `today` means the chip needs fixing, not a new baseline. Task 10's spec covers the chip's text, popover and keyboard behavior.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib/weather.ts apps/desktop/tests/weather.test.mjs apps/desktop/src/hooks/useWeather.ts apps/desktop/src/components/today/WeatherChip.tsx apps/desktop/src/components/pages/TodayPage.tsx
git commit -m "feat(brief): weather chip + popover — high/low, hourly, rain window and rain notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 5: Frontend registry: Today, past briefs and the compact strip render from the layout, plus the ⋯ Customize menu

**Files:**
- Create: `apps/desktop/src/components/today/{briefModules.tsx, briefLive.ts, ModuleBox.tsx, ModulePlaceholder.tsx, BriefMenu.tsx, stripSegment.ts}`, `apps/desktop/src/components/today/modules/{WeatherModule, ScheduleModule, PrioritiesModule, DueTodayBox, StillOpenModule, HabitsBox, NotesBox, VaultModule}.tsx`
- Modify: `apps/desktop/src/components/pages/TodayPage.tsx` (rewrite the body), `components/today/{PastBrief, BriefStrip, ScheduleBox, StillOpenBox}.tsx`, `apps/desktop/src/lib/briefLayout.ts` (+`arrangeBrief`), `apps/desktop/src/lib/todayBrief.ts` (drop the unused `TODAY_LAYOUT`), `apps/desktop/tests/briefLayout.test.mjs`

**Interfaces:**
- Consumes: `useBriefSettingsStore`, `normalizeLayout`, `FALLBACK_LAYOUT`, `configValue` (Task 2); `WeatherChip`, `useWeather`, `resolveUnits` (Task 4); `dp.brief.setNotes` (Task 2); `useGoalsStore` (`habits`, `habitsLoading`, `loadHabits`, `toggleHabit`).
- Produces (**contract for phase 3 and Lane C**):

```ts
// components/today/briefModules.tsx — the frontend half of the registry (same ids as Rust)
export type BriefMode = 'live' | 'snapshot' | 'preview'
export interface BriefBoxProps { mode: BriefMode; date: string; config: Record<string, unknown>; payload?: unknown; brief?: Brief | null }
export interface BriefStripProps { config: Record<string, unknown> }
export interface BriefModuleSettingsProps { entry: BriefLayoutEntry; onChange: (config: Record<string, unknown>) => void }
export interface BriefModuleView { Box: ComponentType<BriefBoxProps>; Strip?: ComponentType<BriefStripProps>; Settings?: ComponentType<BriefModuleSettingsProps>; slot?: 'header' }
export const BRIEF_MODULES: Record<string, BriefModuleView>
export function briefModuleInfo(id: string): { slot?: 'header'; strip: boolean }
// components/today/briefLive.ts — today's live data for module Boxes (TodayPage provides it)
export interface BriefLive { today; events; tomorrow; calReady; calError; calendarOffline; dueToday; stillOpen; tasksReady; ready;
  priorities: { list; generating; noKey; error; regenerate }; weather: { view; loading }; projectMap; subtaskMap; removeTask; addSubtask; brief }
export const BriefLiveContext: React.Context<BriefLive | null>
export function useBriefLive(): BriefLive | null
// components/today/ModuleBox.tsx
export function ModuleBox(props: BriefBoxProps & { id: string })   // unknown id → ModulePlaceholder ("Open in Nimble for Mac")
export function ModuleStrip(props: BriefStripProps & { id: string })
// lib/briefLayout.ts
export function arrangeBrief(entries, info: (id: string) => { slot?: 'header'; strip: boolean }, compact: boolean): { header; strip; body }
```

Mode semantics: `live` = today, interactive. `snapshot` = a past morning, frozen: it reads `payload` (= `snapshot[id]`) and `brief`. `preview` = today's live data rendered read-only under draft settings (setup). **A new module (phase 3 `quick_wins`, phase 4 `momentum`) adds one entry to `BRIEF_MODULES`.** A Box renders its own calm empty state and never returns null for want of data. The only exceptions are the vault box, which hides without a file, and header-slot modules.

> **UX checkpoint 1 — the weather chip in compact mode.** Where does the chip go when the brief is compacted (`b`)? (A) **Recommended:** page header when expanded, first segment of the strip when compact, and the header drops it, so there is only ever one chip. (B) Always in the page header, and the strip never shows it. (C) Both places while compact. `arrangeBrief` encodes (A). (B) is a one-line change: return header modules in `header` for compact too and none in `strip`.

- [ ] **Step 1: Write the failing test.** Append to `apps/desktop/tests/briefLayout.test.mjs` (and add `arrangeBrief` to its import):

```js
test('arrangeBrief: header modules in the header, strip modules collapse when compact', () => {
  const info = (id) => ({ slot: id === 'weather' ? 'header' : undefined, strip: ['weather', 'schedule', 'priorities'].includes(id) })
  const list = [e('weather'), e('schedule'), e('priorities'), e('due_today'), e('habits', false), e('vault')]
  const open = arrangeBrief(list, info, false)
  assert.deepEqual(open.header.map((x) => x.id), ['weather'])
  assert.deepEqual(open.strip, [])
  assert.deepEqual(open.body.map((x) => x.id), ['schedule', 'priorities', 'due_today', 'vault'])
  const compact = arrangeBrief(list, info, true)
  assert.deepEqual(compact.header, [], 'the chip moves into the strip (UX checkpoint 1)')
  assert.deepEqual(compact.strip.map((x) => x.id), ['weather', 'schedule', 'priorities'])
  assert.deepEqual(compact.body.map((x) => x.id), ['due_today', 'vault'])
})
```

Run: `cd apps/desktop && node --test tests/briefLayout.test.mjs` → FAIL (`arrangeBrief` is not exported).

- [ ] **Step 2: Add `arrangeBrief` to `apps/desktop/src/lib/briefLayout.ts`**

```ts
/** Where each enabled module renders. Expanded: `slot: 'header'` modules
 *  (the weather chip) go in the page header, the rest are boxes. Compact:
 *  every module with a Strip collapses into the one-row strip, header ones
 *  included (UX checkpoint 1); the rest stay boxes. */
export function arrangeBrief(
  entries: BriefLayoutEntry[],
  info: (id: string) => { slot?: 'header'; strip: boolean },
  compact: boolean,
): { header: BriefLayoutEntry[]; strip: BriefLayoutEntry[]; body: BriefLayoutEntry[] } {
  const on = entries.filter((x) => x.enabled)
  const isHeader = (x: BriefLayoutEntry) => info(x.id).slot === 'header'
  if (!compact) return { header: on.filter(isHeader), strip: [], body: on.filter((x) => !isHeader(x)) }
  return {
    header: on.filter((x) => isHeader(x) && !info(x.id).strip),
    strip: on.filter((x) => info(x.id).strip),
    body: on.filter((x) => !isHeader(x) && !info(x.id).strip),
  }
}
```

Delete `TODAY_LAYOUT` (and its comment) from `lib/todayBrief.ts`. Run: `node --test tests/briefLayout.test.mjs tests/todayBrief.test.mjs` → PASS.

- [ ] **Step 3: Shared plumbing.** `apps/desktop/src/components/today/briefLive.ts`:

```ts
import { createContext, useContext } from 'react'
import type { Brief, CalendarEvent, LocalTask, Priority, WeatherView } from '@nimble/types'

/** Today's live data, loaded once by TodayPage and read by every module
 *  Box in `live` and `preview` mode (a .ts file: react-refresh wants
 *  contexts out of component files). */
export interface BriefLive {
  today: string
  events: CalendarEvent[]
  tomorrow: CalendarEvent[]
  calReady: boolean
  calError: string | null
  calendarOffline: boolean
  dueToday: LocalTask[]
  stillOpen: LocalTask[]
  tasksReady: boolean
  ready: boolean
  priorities: { list: Priority[] | null | undefined; generating: boolean; noKey: boolean; error: string | null; regenerate: () => void }
  weather: { view: WeatherView | null; loading: boolean }
  projectMap: Record<string, { name: string; color: string }>
  subtaskMap: Record<string, LocalTask[]>
  removeTask: (id: string) => void
  addSubtask: (parentId: string, content: string) => Promise<void>
  /** Today's stored row once the snapshot is written (notes live on it). */
  brief: Brief | null
}

export const BriefLiveContext = createContext<BriefLive | null>(null)

export function useBriefLive(): BriefLive | null {
  return useContext(BriefLiveContext)
}
```

`apps/desktop/src/components/today/stripSegment.ts`:

```ts
/** The "·" before every compact-strip segment but the first. A segment
 *  that renders nothing leaves no stray dot. */
export const STRIP_DOT = "not-first:before:mr-3 not-first:before:text-muted-foreground not-first:before:content-['·']"
```

`apps/desktop/src/components/today/ModulePlaceholder.tsx`:

```tsx
import { Meta } from '@/components/shared/typography'
import { BriefBox } from './BriefBox'

/** A box this build doesn't know: a newer Mac version wrote the layout, or
 *  the web client can't render it (addendum §1). */
export function ModulePlaceholder() {
  return (
    <BriefBox title="More in Nimble">
      <Meta as="p">Open in Nimble for Mac to see this box.</Meta>
    </BriefBox>
  )
}
```

`apps/desktop/src/components/today/ModuleBox.tsx`:

```tsx
import { BRIEF_MODULES, type BriefBoxProps, type BriefStripProps } from './briefModules'
import { ModulePlaceholder } from './ModulePlaceholder'

/** One module's box by id; an unknown id renders the neutral placeholder. */
export function ModuleBox({ id, ...props }: BriefBoxProps & { id: string }) {
  const Box = BRIEF_MODULES[id]?.Box ?? ModulePlaceholder
  return <Box {...props} />
}

/** One module's compact-strip segment, or nothing. */
export function ModuleStrip({ id, config }: BriefStripProps & { id: string }) {
  const Strip = BRIEF_MODULES[id]?.Strip
  return Strip ? <Strip config={config} /> : null
}
```

(If `npx eslint src` flags `react-hooks/static-components` on these two, render with `createElement(Box, props)` from `react` instead of JSX.)

`apps/desktop/src/components/today/BriefMenu.tsx`:

```tsx
import { MoreHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/shared/IconButton'
import { openSettings } from '@/stores/settingsNavStore'

/** The brief's ⋯ (addendum A1): Customize… opens Settings → Today & brief.
 *  Phase 3 appends Regenerate. */
export function BriefMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton aria-label="Brief options" title="Brief options" className="focus-ring data-popup-open:bg-hover data-popup-open:text-foreground" />}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => openSettings('today-brief')}>Customize…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 4: Box props on the existing containers.** In `ScheduleBox.tsx` add `showFreeBlock = true,` to the props (type `showFreeBlock?: boolean`) and change the free-block line to `const block = loading || offline || !showFreeBlock ? null : largestFreeBlock(events, { from })`. In `StillOpenBox.tsx`, replace `const MAX_ROWS = 5` with a `max = 5` prop (type `max?: number`) used in both places `MAX_ROWS` appeared.

- [ ] **Step 5: Module components.** `components/today/modules/ScheduleModule.tsx`:

```tsx
import type { CalendarEvent } from '@nimble/types'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { configValue } from '@/lib/briefLayout'
import { hhmm, nextEvent, nowHHMM } from '@/lib/todayBrief'
import { cn } from '@/lib/utils'
import { ScheduleBox } from '../ScheduleBox'
import { useBriefLive } from '../briefLive'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps } from '../briefModules'

export function ScheduleModule({ mode, date, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const showTomorrow = configValue(config, 'tomorrow_peek', true)
  const showFreeBlock = configValue(config, 'free_block', true)
  if (mode === 'snapshot') {
    const p = (payload ?? {}) as { events?: CalendarEvent[]; tomorrow?: CalendarEvent[] }
    return (
      <ScheduleBox events={p.events ?? []} tomorrow={showTomorrow ? p.tomorrow ?? [] : []} loading={false} today={date} live={false} showFreeBlock={showFreeBlock} />
    )
  }
  if (!live) return null
  return (
    <ScheduleBox
      events={live.events}
      loading={!live.calReady}
      error={live.calError}
      tomorrow={showTomorrow ? live.tomorrow : []}
      today={live.today}
      live
      showFreeBlock={showFreeBlock}
    />
  )
}

/** Compact strip: the next event (phase-1 BriefStrip's first segment). */
export function ScheduleStrip() {
  const live = useBriefLive()
  if (!live) return null
  const next = nextEvent(live.events, nowHHMM())
  return (
    <span className={cn('min-w-0 shrink truncate text-body', STRIP_DOT)}>
      {!live.calReady ? (
        <Skeleton className="inline-block h-4 w-40 align-middle" />
      ) : live.calendarOffline ? (
        <Meta>Calendar offline.</Meta>
      ) : next ? (
        <>
          <Meta className="tabular-nums">Next: {hhmm(next.start_time)}</Meta> {next.summary}
        </>
      ) : (
        <Meta>No more events today</Meta>
      )}
    </span>
  )
}
```

`components/today/modules/PrioritiesModule.tsx`:

```tsx
import type { Priority } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { PrioritiesBox } from '../PrioritiesBox'
import { useBriefLive } from '../briefLive'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps, BriefStripProps } from '../briefModules'

export function PrioritiesModule({ mode, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const count = configValue(config, 'count', 3)
  if (mode === 'snapshot') {
    return <PrioritiesBox priorities={Array.isArray(payload) ? (payload as Priority[]).slice(0, count) : null} />
  }
  if (!live) return null
  const p = live.priorities
  const list = p.list ? p.list.slice(0, count) : null
  if (mode === 'preview') return <PrioritiesBox priorities={list} loading={p.list === undefined || p.generating} />
  return (
    <PrioritiesBox
      priorities={list}
      loading={p.list === undefined || (p.list === null && !live.ready) || p.generating}
      error={p.error}
      noKey={p.noKey}
      onRegenerate={p.regenerate}
    />
  )
}

/** Compact strip: the top `count` priority titles as numbered chips. */
export function PrioritiesStrip({ config }: BriefStripProps) {
  const live = useBriefLive()
  const top = (live?.priorities.list ?? []).slice(0, configValue(config, 'count', 3))
  if (top.length === 0) return null
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', STRIP_DOT)}>
      {top.map((p, i) => (
        <span key={i} className="flex min-w-0 max-w-56 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-meta" title={p.title}>
          <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="truncate">{p.title}</span>
        </span>
      ))}
    </div>
  )
}
```

`components/today/modules/DueTodayBox.tsx` (the phase-1 inline list, moved):

```tsx
import { CalendarCheck } from 'lucide-react'
import type { BriefTaskRef } from '@nimble/types'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { EmptyState } from '@/components/shared/EmptyState'
import { Meta } from '@/components/shared/typography'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { Skeleton } from '@/components/ui/skeleton'
import { configValue } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { BriefBox } from '../BriefBox'
import { useBriefLive } from '../briefLive'
import type { BriefBoxProps } from '../briefModules'

function DueTodayReadOnly({ tasks, empty, loading = false }: { tasks: { id: string; content: string; completed?: boolean }[]; empty: string; loading?: boolean }) {
  return (
    <BriefBox title="Due today" count={loading ? undefined : tasks.length}>
      {loading ? (
        <div className="space-y-1.5">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : tasks.length === 0 ? (
        <Meta as="p">{empty}</Meta>
      ) : (
        <div className="-mx-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left">
              <span className={cn('min-w-0 flex-1 truncate text-body', task.completed && 'text-muted-foreground line-through')}>{task.content}</span>
            </div>
          ))}
        </div>
      )}
    </BriefBox>
  )
}

/** Live: the day's task rows (checked-off ones stay, struck through, unless
 *  `show_completed` is off). Snapshot/preview: read-only rows. */
export function DueTodayBox({ mode, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const showCompleted = configValue(config, 'show_completed', true)
  if (mode === 'snapshot') {
    return <DueTodayReadOnly tasks={Array.isArray(payload) ? (payload as BriefTaskRef[]) : []} empty="Nothing due that day." />
  }
  if (!live) return null
  const rows = showCompleted ? live.dueToday : live.dueToday.filter((t) => !t.completed)
  if (mode === 'preview') return <DueTodayReadOnly tasks={rows} empty="Nothing due today." loading={!live.tasksReady} />
  const open = live.dueToday.filter((t) => !t.completed).length
  return (
    <CollapsibleSection title="Due today" count={live.tasksReady ? open : undefined} defaultOpen={true} className="-mt-3!">
      {!live.tasksReady ? (
        <div className="space-y-1.5 pt-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarCheck} kbd="Q" size="compact">Nothing due today. Add a task with</EmptyState>
      ) : (
        <div>
          {rows.map((task) => {
            const subs = live.subtaskMap[task.id] ?? []
            const done = subs.filter((s) => s.completed || s.status === 'complete').length
            return (
              <div key={task.id}>
                <LocalTaskRow
                  task={task}
                  projectName={live.projectMap[task.project_id]?.name}
                  projectColor={live.projectMap[task.project_id]?.color}
                  subtaskStats={subs.length > 0 ? { done, total: subs.length } : undefined}
                  onDelete={live.removeTask}
                  onAddSubtask={live.addSubtask}
                />
              </div>
            )
          })}
        </div>
      )}
    </CollapsibleSection>
  )
}
```

`components/today/modules/StillOpenModule.tsx`:

```tsx
import type { BriefTaskRef } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { StillOpenBox } from '../StillOpenBox'
import { useBriefLive } from '../briefLive'
import type { BriefBoxProps } from '../briefModules'

export function StillOpenModule({ mode, date, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const count = configValue(config, 'count', 5)
  if (mode === 'snapshot') {
    const p = (payload ?? {}) as { total?: number; oldest?: BriefTaskRef[] }
    return <StillOpenBox tasks={(p.oldest ?? []).slice(0, count)} total={p.total ?? 0} today={date} readOnly max={count} />
  }
  if (!live) return null
  return (
    <StillOpenBox
      tasks={live.stillOpen.slice(0, count)}
      total={live.stillOpen.length}
      today={live.today}
      loading={!live.tasksReady}
      readOnly={mode === 'preview'}
      max={count}
    />
  )
}
```

`components/today/modules/HabitsBox.tsx`:

```tsx
import { useEffect } from 'react'
import { Check } from 'lucide-react'
import type { BriefHabitRef } from '@nimble/types'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { useGoalsStore } from '@/stores/goalsStore'
import { cn } from '@/lib/utils'
import { BriefBox } from '../BriefBox'
import type { BriefBoxProps } from '../briefModules'

function HabitMark({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', done ? 'border-success bg-success text-background' : 'border-border')}>
      {done && <Check className="size-3" />}
    </span>
  )
}

const ROW = 'flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left'

/** "Before you start": habits as checkable rows. No counts and no mention
 *  of yesterday (base spec §3.2 #8). */
export function HabitsBox({ mode, payload }: BriefBoxProps) {
  const habits = useGoalsStore((s) => s.habits)
  const loading = useGoalsStore((s) => s.habitsLoading)
  const toggleHabit = useGoalsStore((s) => s.toggleHabit)
  useEffect(() => {
    if (mode !== 'snapshot') void useGoalsStore.getState().loadHabits()
  }, [mode])
  const rows =
    mode === 'snapshot'
      ? (Array.isArray(payload) ? (payload as BriefHabitRef[]) : []).map((h) => ({ id: h.id, name: h.name, done: h.done }))
      : habits.filter((h) => h.active).map((h) => ({ id: h.id, name: h.name, done: h.today_completed }))
  return (
    <BriefBox title="Before you start">
      {mode !== 'snapshot' && loading ? (
        <div className="space-y-1.5">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : rows.length === 0 ? (
        <Meta as="p">No habits set up. Add them in Goals.</Meta>
      ) : (
        <ul className="-mx-2" aria-label="Before you start">
          {rows.map((h) => (
            <li key={h.id}>
              {mode === 'live' ? (
                <button type="button" role="checkbox" aria-checked={h.done} onClick={() => void toggleHabit(h.id)} className={cn(ROW, 'focus-ring transition-colors duration-(--transition-fast) hover:bg-hover')}>
                  <HabitMark done={h.done} />
                  <span className="min-w-0 flex-1 truncate text-body">{h.name}</span>
                </button>
              ) : (
                <div className={ROW}>
                  <HabitMark done={h.done} />
                  <span className="min-w-0 flex-1 truncate text-body">{h.name}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </BriefBox>
  )
}
```

`components/today/modules/NotesBox.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Meta } from '@/components/shared/typography'
import { Textarea } from '@/components/ui/textarea'
import { useDataProvider } from '@/services/provider-context'
import { BriefBox } from '../BriefBox'
import { useBriefLive } from '../briefLive'
import type { BriefBoxProps } from '../briefModules'

type Draft = { date: string; text: string }

/** Today's scratchpad (`briefs.notes`), saved 600 ms after typing stops and
 *  flushed if the page unmounts first. Past days read-only. */
export function NotesBox({ mode, brief }: BriefBoxProps) {
  const dp = useDataProvider()
  const live = useBriefLive()
  const today = live?.today ?? null
  const stored = mode === 'snapshot' ? brief?.notes ?? null : live?.brief?.notes ?? null
  const [draft, setDraft] = useState<Draft | null>(null)
  const pending = useRef<Draft | null>(null)
  const writable = mode === 'live' && dp.briefSettings.supported
  const value = draft && draft.date === today ? draft.text : stored ?? ''

  useEffect(() => {
    if (!draft) return
    pending.current = draft
    const timer = setTimeout(() => {
      pending.current = null
      dp.brief.setNotes(draft.date, draft.text).catch(() => toast.error("Notes didn't save. Try again."))
    }, 600)
    return () => clearTimeout(timer)
  }, [dp, draft])

  useEffect(() => {
    const box = pending
    return () => {
      const last = box.current
      if (last) void dp.brief.setNotes(last.date, last.text).catch(() => {})
    }
  }, [dp])

  return (
    <BriefBox title="Notes">
      {mode === 'snapshot' ? (
        stored ? <p className="whitespace-pre-wrap text-body">{stored}</p> : <Meta as="p">No notes that day.</Meta>
      ) : mode === 'preview' ? (
        <Meta as="p">A scratchpad for the day.</Meta>
      ) : (
        <Textarea
          aria-label="Notes for today"
          placeholder="A scratchpad for the day"
          value={value}
          readOnly={!writable}
          onChange={(e) => today && setDraft({ date: today, text: e.target.value })}
          className="min-h-20 resize-y"
        />
      )}
    </BriefBox>
  )
}
```

`components/today/modules/VaultModule.tsx`:

```tsx
import { VaultBox } from '../VaultBox'
import type { BriefBoxProps } from '../briefModules'

export function VaultModule({ date }: BriefBoxProps) {
  return <VaultBox date={date} />
}
```

`components/today/modules/WeatherModule.tsx`:

```tsx
import type { WeatherSnapshot } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { resolveUnits } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { WeatherChip } from '../WeatherChip'
import { useBriefLive } from '../briefLive'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps, BriefStripProps } from '../briefModules'

/** Header slot: the chip. A past day shows the forecast frozen that morning
 *  (with its rain notes against that morning's schedule), or nothing. */
export function WeatherModule({ mode, date, config, payload, brief }: BriefBoxProps) {
  const live = useBriefLive()
  const unit = resolveUnits(config.units, navigator.language)
  const showRainNotes = configValue(config, 'rain_notes', true)
  if (mode === 'snapshot') {
    const snap = payload as WeatherSnapshot | null | undefined
    if (!snap?.forecast) return null
    return (
      <WeatherChip
        view={{ status: 'fresh', location: snap.location, forecast: snap.forecast, fetched_at: snap.fetched_at }}
        date={date}
        events={brief?.snapshot?.schedule?.events ?? []}
        unit={unit}
        showRainNotes={showRainNotes}
        live={false}
      />
    )
  }
  if (!live) return null
  return (
    <WeatherChip view={live.weather.view} loading={live.weather.loading} date={live.today} events={live.events} unit={unit} showRainNotes={showRainNotes} live />
  )
}

/** Compact strip: the same chip, first segment (UX checkpoint 1). */
export function WeatherStrip({ config }: BriefStripProps) {
  const live = useBriefLive()
  if (!live) return null
  return (
    <span className={cn('flex shrink-0 items-center', STRIP_DOT)}>
      <WeatherModule mode="live" date={live.today} config={config} />
    </span>
  )
}
```

- [ ] **Step 6: The registry** `apps/desktop/src/components/today/briefModules.tsx` (imports only, with no local components):

```tsx
import type { ComponentType } from 'react'
import type { Brief, BriefLayoutEntry } from '@nimble/types'
import { WeatherModule, WeatherStrip } from './modules/WeatherModule'
import { ScheduleModule, ScheduleStrip } from './modules/ScheduleModule'
import { PrioritiesModule, PrioritiesStrip } from './modules/PrioritiesModule'
import { DueTodayBox } from './modules/DueTodayBox'
import { StillOpenModule } from './modules/StillOpenModule'
import { HabitsBox } from './modules/HabitsBox'
import { NotesBox } from './modules/NotesBox'
import { VaultModule } from './modules/VaultModule'

/** live = today, interactive · snapshot = a past morning, frozen (reads
 *  `payload` = `snapshot[id]`, and `brief`) · preview = today's live data,
 *  read-only, under draft settings (the setup). */
export type BriefMode = 'live' | 'snapshot' | 'preview'

export interface BriefBoxProps {
  mode: BriefMode
  /** The brief's own date (today for live and preview). */
  date: string
  /** Resolved options from the module's `config_schema`. */
  config: Record<string, unknown>
  payload?: unknown
  brief?: Brief | null
}

export interface BriefStripProps {
  config: Record<string, unknown>
}

/** Custom options UI; without it the Boxes list renders `config_schema`. */
export interface BriefModuleSettingsProps {
  entry: BriefLayoutEntry
  onChange: (config: Record<string, unknown>) => void
}

export interface BriefModuleView {
  Box: ComponentType<BriefBoxProps>
  /** Its compact-strip segment; modules without one stay boxes when compact. */
  Strip?: ComponentType<BriefStripProps>
  Settings?: ComponentType<BriefModuleSettingsProps>
  /** 'header': renders in the brief header row (the weather chip), never as a box. */
  slot?: 'header'
}

/** The frontend half of the module registry (Rust: nimble-core/src/brief/mod.rs).
 *  Same ids. An id missing here renders ModulePlaceholder. */
export const BRIEF_MODULES: Record<string, BriefModuleView> = {
  weather: { Box: WeatherModule, Strip: WeatherStrip, slot: 'header' },
  schedule: { Box: ScheduleModule, Strip: ScheduleStrip },
  priorities: { Box: PrioritiesModule, Strip: PrioritiesStrip },
  due_today: { Box: DueTodayBox },
  still_open: { Box: StillOpenModule },
  habits: { Box: HabitsBox },
  notes: { Box: NotesBox },
  vault: { Box: VaultModule },
}

export function briefModuleInfo(id: string): { slot?: 'header'; strip: boolean } {
  const view = BRIEF_MODULES[id]
  return { slot: view?.slot, strip: !!view?.Strip }
}
```

`BriefStrip.tsx` becomes:

```tsx
import type { BriefLayoutEntry } from '@nimble/types'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/shared/IconButton'
import { ModuleStrip } from './ModuleBox'

/** The compact brief: one row of module segments (weather chip, next
 *  event, priority chips), so the tasks below stay in view. */
export function BriefStrip({ entries, onExpand }: { entries: BriefLayoutEntry[]; onExpand: () => void }) {
  return (
    <div data-brief-strip className="surface-panel flex min-w-0 items-center gap-3 px-4 py-2">
      {entries.map((e) => (
        <ModuleStrip key={e.id} id={e.id} config={e.config} />
      ))}
      <IconButton aria-label="Expand the brief" onClick={onExpand} className="ml-auto">
        <ChevronDown className="size-3.5" />
      </IconButton>
    </div>
  )
}
```

- [ ] **Step 7: `PastBrief.tsx` renders the snapshot through the registry.** Rename `PastBriefSkeleton` to an exported `BriefSkeleton`, delete `DueTodaySnapshot` (it moved to `DueTodayBox`), and replace the `view === 'snapshot'` return with:

```tsx
  // `view === 'snapshot'`: each module renders its own frozen payload, in
  // the order and with the config recorded that morning. Phase-1 rows
  // (layout = module ids) normalize to the same boxes as before.
  const stored = current!.brief!
  const snapshot = stored.snapshot as Record<string, unknown>
  const { header, body } = arrangeBrief(normalizeLayout(stored.layout), briefModuleInfo, false)
  return (
    <>
      {header.length > 0 && (
        <div className="flex items-center gap-2">
          {header.map((e) => (
            <ModuleBox key={e.id} id={e.id} mode="snapshot" date={date} config={e.config} payload={snapshot[e.id]} brief={stored} />
          ))}
        </div>
      )}
      {body.map((e) => (
        <ModuleBox key={e.id} id={e.id} mode="snapshot" date={date} config={e.config} payload={snapshot[e.id]} brief={stored} />
      ))}
    </>
  )
```

with imports `import { arrangeBrief, normalizeLayout } from '@/lib/briefLayout'`, `import { ModuleBox } from './ModuleBox'` and `import { briefModuleInfo } from './briefModules'`. Drop the now-unused imports (`ScheduleBox`, `PrioritiesBox`, `StillOpenBox`, `Meta` if unused).

- [ ] **Step 8: Rewrite `TodayPage.tsx`'s body.** Keep `greetingMeta`, `ProgressBar`, the past-date state, the calendar and tomorrow effects, `useLocalTasks`, `splitDueTasks`, readiness, the key handler and the progress counts exactly as they are. Replace the imports of `ScheduleBox`, `PrioritiesBox`, `StillOpenBox`, `VaultBox`, `BriefStrip`, `PastBrief`, `CollapsibleSection`, `LocalTaskRow`, `EmptyState`, `Skeleton`, `CalendarCheck`, and Task 4's `WeatherChip`, `configValue` and `resolveUnits`, with the lines below. Keep `useWeather` and `useBriefSettingsStore`.

```tsx
import type { Brief, CalendarEvent, LocalTask } from '@nimble/types'
import { BriefStrip } from '@/components/today/BriefStrip'
import { BriefMenu } from '@/components/today/BriefMenu'
import { ModuleBox } from '@/components/today/ModuleBox'
import { BriefSkeleton, PastBrief } from '@/components/today/PastBrief'
import { BriefLiveContext, type BriefLive } from '@/components/today/briefLive'
import { briefModuleInfo } from '@/components/today/briefModules'
import { arrangeBrief, FALLBACK_LAYOUT, normalizeLayout } from '@/lib/briefLayout'
```

Then replace everything from `const { allProjects } = useProjects()` through the snapshot effect, and the whole `return (…)`, with:

```tsx
  const { allProjects } = useProjects()

  // Brief settings (desktop) decide the boxes. The web has none: it uses the
  // layout the Mac recorded in today's synced row, else the phase-1 boxes.
  const settings = useBriefSettingsStore((s) => s.settings)
  const settingsStatus = useBriefSettingsStore((s) => s.status)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const [todayRow, setTodayRow] = useState<{ date: string; brief: Brief | null } | null>(null)
  const rowToday = todayRow?.date === today ? todayRow.brief : null
  const layout = settings?.modules
    ?? (settingsStatus === 'unsupported' || settingsStatus === 'error'
      ? (rowToday ? normalizeLayout(rowToday.layout) : FALLBACK_LAYOUT)
      : null)
  const isOn = (id: string) => !!layout?.some((e) => e.id === id && e.enabled)

  // Priorities generate only while their box is on (no AI call for a hidden box).
  const daily = useDailyPriorities({ today, ready: ready && isOn('priorities'), events, calendarUnavailable: calendarOffline, tasks, projects: allProjects })
  const location = settings?.location
  const weather = useWeather(isOn('weather'), `${today}|${location ? `${location.lat},${location.lon}` : ''}`)

  // Snapshot once the day's live data has landed (Review Focus 1–2 of phase 1);
  // the web resolves null there and reads the Mac's row instead.
  const snappedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || snappedFor.current === today) return
    snappedFor.current = today
    dp.brief.ensureSnapshot(today)
      .then((brief) => brief ?? dp.brief.get(today))
      .then((brief) => {
        setTodayRow({ date: today, brief })
        if (brief) setBriefDates((prev) => new Set(prev).add(today))
      })
      .catch(() => {})
  }, [dp, today, ready])
```

Keep the existing keyboard `useEffect`, `projectMap`, `subtaskMap`, `handleAddSubtask`, `useObsidian` and the progress numbers. Then:

```tsx
  const live: BriefLive = {
    today, events, tomorrow, calReady, calError, calendarOffline,
    dueToday, stillOpen, tasksReady, ready,
    priorities: { list: daily.priorities, generating: daily.generating, noKey: daily.noKey, error: daily.error, regenerate: daily.regenerate },
    weather, projectMap, subtaskMap, removeTask: remove, addSubtask: handleAddSubtask, brief: rowToday,
  }
  const arranged = layout ? arrangeBrief(layout, briefModuleInfo, compact) : null

  return (
    <BriefLiveContext.Provider value={live}>
      <PageFrame
        title="Today"
        meta={greetingMeta(greeting, total > 0 ? remaining : null)}
        actions={
          <div className="flex min-w-0 items-center gap-3">
            {completed > 0 && <ProgressBar completed={completed} total={total} />}
            {selected === today && arranged?.header.map((e) => (
              <ModuleBox key={e.id} id={e.id} mode="live" date={today} config={e.config} />
            ))}
            <DateStrip briefDates={briefDates} selected={selected} today={today} onSelect={select} />
            {selected === today && (
              <IconButton aria-label={compact ? 'Expand the brief' : 'Compact the brief'} aria-expanded={!compact} onClick={toggleCompact}>
                <ChevronDown className={cn('size-3.5 transition-transform duration-(--transition-fast)', !compact && 'rotate-180')} />
              </IconButton>
            )}
            {selected === today && dp.briefSettings.supported && <BriefMenu />}
          </div>
        }
        bodyClassName="space-y-4"
      >
        <ReminderCatchUp />
        {selected !== today ? (
          <PastBrief date={selected} today={today} />
        ) : !arranged ? (
          <BriefSkeleton />
        ) : (
          <div data-brief-body role="region" aria-label="Today's brief" tabIndex={-1} className="space-y-4 outline-none">
            {compact && <BriefStrip entries={arranged.strip} onExpand={toggleCompact} />}
            {arranged.body.map((e) => (
              <ModuleBox key={e.id} id={e.id} mode="live" date={today} config={e.config} />
            ))}
          </div>
        )}
      </PageFrame>
    </BriefLiveContext.Provider>
  )
```

The Task 4 `weatherEntry`/`briefSettings` lines and the direct `<WeatherChip …/>` in `actions` are removed: the header slot renders the chip now.

- [ ] **Step 9: Verify**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: pass, and lint ≤ `LINT_BASELINE` (fix any new `react-hooks` findings in these files rather than disabling them). Commit, then run the frozen harness (`tools/qa-frozen.sh $(git rev-parse HEAD) /private/tmp/claude-501/qa-b2 4620` + `BASE_URL=http://localhost:4620 npx playwright test -c e2e`). Expected: the full existing suite passes, including the Today rail specs.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/components/today apps/desktop/src/components/pages/TodayPage.tsx apps/desktop/src/lib/briefLayout.ts apps/desktop/src/lib/todayBrief.ts apps/desktop/tests/briefLayout.test.mjs
git commit -m "feat(brief): frontend module registry — Today, past briefs and the strip render from the layout; ⋯ Customize

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 6: Settings → Today & brief: the Brief and Location & weather sections (+ shared fields, city search, `requires` gating)

**Files:**
- Create: `apps/desktop/src/components/settings/SettingsFields.tsx` (moved out of `SettingsPage.tsx`), `apps/desktop/src/components/settings/TodayBriefSettings.tsx`, `apps/desktop/src/components/settings/BriefLocationSettings.tsx`, `apps/desktop/src/components/today/CitySearch.tsx`
- Modify: `apps/desktop/src/components/pages/SettingsPage.tsx` (import the moved fields, mount two bodies, add the `briefSettings` capability), `apps/desktop/src/lib/settingsSections.ts`, `apps/desktop/tests/settingsSections.test.mjs`

**Interfaces:**
- Consumes: `useBriefSettingsStore` (Task 2), `setModuleConfig` (Task 2), `placeLabel` (Task 4), `dp.weather.geocode` (Task 3), `openSettings`.
- Produces (**contract for Lane C**):

```ts
// components/settings/SettingsFields.tsx — shared by every settings section (was private to SettingsPage)
export interface SettingField { key: string; label: string; placeholder: string; help: string; type: 'text' | 'password' | 'time' }
export interface FieldState { value: string; saving: boolean; saved: boolean; error: SettingsFailure | null }
export const SECTION_CLASS = 'space-y-4 scroll-mt-[calc(var(--page-header-h)+1.5rem)]'
export function FailureNote(props: { failure: SettingsFailure | null })
export function SettingFieldRow(props: { field: SettingField; state: FieldState; onChange(v: string): void; onSave(): void })
export function SectionHeader(props: { title: string; description?: string; as?: 'h2' | 'h3' })
export function SectionSkeleton(props: { failed?: boolean; onRetry?: () => void; rows?: number })
// lib/settingsSections.ts
export type SettingsCapability = 'backup' | 'reminders' | 'googleCalendar' | 'briefSettings'
// rows on page 'brief' (all requires: 'briefSettings'): today-brief "Brief" · today-location "Location & weather" · (Task 7) today-boxes "Boxes"
// Lane C appends ONE row after today-boxes (its plan: { id: 'momentum', label: 'Goals & momentum', page: 'brief', requires: 'momentum' }
//   with its own capability), SettingsPage bodies[<its id>] = <MomentumSettings />, root <section id=<its id> className={SECTION_CLASS}>
// components/today/CitySearch.tsx
export function CitySearch(props: { onPick(loc: BriefLocation): void; onCancel?(): void; autoFocus?: boolean; label?: string })
```

- [ ] **Step 1: Update the failing IA test.** In `apps/desktop/tests/settingsSections.test.mjs`, set `const ALL = { backup: true, reminders: true, googleCalendar: true, briefSettings: true }` and `const NONE = { backup: false, reminders: false, googleCalendar: false, briefSettings: false }`, and change the `brief:` line of the by-page expectation to `brief: ['today-brief', 'today-location'],`. Three existing tests assumed a single, ungated brief slot, so update them too:
  - In `visibleSections drops capability-gated sections…`, replace the `for (const gated of …)` line and the `none.length` assertion with:
    ```js
    const gated = SETTINGS_SECTIONS.filter((s) => s.requires).map((s) => s.id)
    for (const id of gated) assert.ok(!none.includes(id), id)
    assert.equal(none.length, all.length - gated.length)
    ```
  - In `visiblePages hides a page…`, use `const web = visibleSections(NONE)`, since the brief rows are gated now.
  - In `resolveSettingsPage keeps a visible page…`, use `visibleSections(ALL).filter((s) => s.page !== 'brief')`.

Then append:

```js
test('Today & brief sections are desktop-only and named for the addendum', () => {
  const brief = SETTINGS_SECTIONS.filter((s) => s.page === 'brief')
  assert.deepEqual(brief.map((s) => [s.id, s.label]), [['today-brief', 'Brief'], ['today-location', 'Location & weather']])
  for (const s of brief) assert.equal(s.requires, 'briefSettings', s.id)
  assert.ok(!visiblePages(visibleSections(NONE)).some((p) => p.id === 'brief'), 'the web never shows the page')
  assert.deepEqual(settingsTarget('today-location'), { page: 'brief', section: 'today-location' })
})
```

Run: `cd apps/desktop && node --test tests/settingsSections.test.mjs` → FAIL.

- [ ] **Step 2: IA rows.** In `lib/settingsSections.ts`: `export type SettingsCapability = 'backup' | 'reminders' | 'googleCalendar' | 'briefSettings'`. Replace the `today-brief` row with:

```ts
  { id: 'today-brief', label: 'Brief', page: 'brief', requires: 'briefSettings' },
  { id: 'today-location', label: 'Location & weather', page: 'brief', requires: 'briefSettings' },
```

In the header comment, replace the "that is how "Today & brief" stays out until Lane B mounts it" sentence with: `The Today & brief page needs the briefSettings capability (desktop): settings are not synced, so the web has nothing to show there.` Run the test → PASS.

- [ ] **Step 3: Move the shared fields.** Cut `SettingField`, `FieldState`, `FailureNote`, `SettingFieldRow`, `SectionHeader` and `SECTION_CLASS` out of `SettingsPage.tsx` into `components/settings/SettingsFields.tsx`, verbatim and exported, together with the imports they use (`useState`, `Button`, `Input`, `Label` from `components/ui/label`, `Skeleton`, `Meta` and `SectionTitle` from `components/shared/typography`, `type SettingsFailure` from `lib/settingsMessage`). Make two changes. First, `SettingField['type']` gains `'time'`, and the input picks `type={isPassword && !visible ? 'password' : field.type === 'time' ? 'time' : 'text'}`. Second, add the skeleton:

```tsx
/** A section's body while brief settings load; `failed` offers a retry
 *  instead of an endless skeleton. */
export function SectionSkeleton({ failed = false, onRetry, rows = 3 }: { failed?: boolean; onRetry?: () => void; rows?: number }) {
  if (failed) {
    return (
      <div className="flex items-center gap-2">
        <Meta as="p">Couldn't load these settings.</Meta>
        {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {[...Array(rows)].map((_, i) => (
        <Skeleton key={i} className="h-8 w-full max-w-md" />
      ))}
    </div>
  )
}
```

`SettingsPage.tsx` then imports `{ FailureNote, SECTION_CLASS, SectionHeader, SettingFieldRow, type FieldState, type SettingField } from '@/components/settings/SettingsFields'`. Nothing else in it changes.

- [ ] **Step 4: `components/today/CitySearch.tsx`** (shared with setup step 2):

```tsx
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { BriefLocation, GeoPlace } from '@nimble/types'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { placeLabel } from '@/lib/weather'
import { cn } from '@/lib/utils'

/** City search, geocoded in Rust (Open-Meteo). A combobox: ↑/↓ move, ↵
 *  picks, Esc clears the field (or cancels when empty, if `onCancel`).
 *  Keys it handles are preventDefault-ed, so the setup's ↵/Esc stand down. */
export function CitySearch({
  onPick,
  onCancel,
  autoFocus = false,
  label = 'Search for a city',
}: {
  onPick: (loc: BriefLocation) => void
  onCancel?: () => void
  autoFocus?: boolean
  label?: string
}) {
  const dp = useDataProvider()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ q: string; places: GeoPlace[]; failed: boolean } | null>(null)
  const [active, setActive] = useState(0)
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) return
    let live = true
    const timer = setTimeout(() => {
      dp.weather
        .geocode(q)
        .then((places) => { if (live) { setFound({ q, places, failed: false }); setActive(0) } })
        .catch(() => { if (live) setFound({ q, places: [], failed: true }) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [dp, q])

  const results = q.length >= 2 && found?.q === q ? found : null
  const places = results?.places ?? []
  const pick = (p: GeoPlace) => {
    onPick({ name: placeLabel(p), lat: p.lat, lon: p.lon, tz: p.tz })
    setQuery('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && places.length > 0) { e.preventDefault(); setActive((i) => Math.min(places.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp' && places.length > 0) { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && places[active]) { e.preventDefault(); pick(places[active]) }
    else if (e.key === 'Escape' && (query || onCancel)) { e.preventDefault(); if (query) setQuery(''); else onCancel?.() }
  }

  return (
    <div className="space-y-1">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={places.length > 0}
        aria-controls={places.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={places[active] ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        placeholder="City, e.g. San Francisco"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        className="max-w-md"
      />
      {q.length >= 2 && !results && (
        <div className="max-w-md space-y-1 px-2 py-1">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-36" />
        </div>
      )}
      {results?.failed && <Meta as="p" className="px-2">Couldn't search right now. Try again in a moment.</Meta>}
      {results && !results.failed && places.length === 0 && <Meta as="p" className="px-2">No places found.</Meta>}
      {places.length > 0 && (
        <ul id={listId} role="listbox" data-inline-listbox aria-label="Matching places" className="max-w-md rounded-lg border p-1">
          {places.map((p, i) => (
            <li
              key={`${p.lat},${p.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
              className={cn('flex min-w-0 cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-body', i === active && 'bg-hover')}
            >
              <span className="truncate">{p.name}</span>
              <Meta className="truncate">{[p.admin1, p.country].filter(Boolean).join(', ')}</Meta>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: `components/settings/TodayBriefSettings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { BriefEffort, BriefModel } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Label as SectionLabel, Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { openSettings } from '@/stores/settingsNavStore'
import { SECTION_CLASS, SectionHeader, SectionSkeleton, SettingFieldRow, type SettingField } from './SettingsFields'

const TIME_FIELD: SettingField = {
  key: 'brief.time',
  label: 'Brief time',
  placeholder: '06:30',
  help: "Nimble prepares your brief at this time if it's open. Otherwise it's ready a few seconds after you open it.",
  type: 'time',
}
const MODELS: { value: BriefModel; label: string }[] = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
]
const EFFORTS: { value: BriefEffort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/** Settings → Today & brief → Brief (addendum §2): brief time, the model
 *  and effort that write it (with the no-key note), and Run setup again
 *  (Task 8). */
export function TodayBriefSettings() {
  const settings = useBriefSettingsStore((s) => s.settings)
  const status = useBriefSettingsStore((s) => s.status)
  const save = useBriefSettingsStore((s) => s.save)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const [timeDraft, setTimeDraft] = useState<string | null>(null)
  const [timeSaving, setTimeSaving] = useState(false)
  const [timeSaved, setTimeSaved] = useState(false)

  const saveTime = async () => {
    if (timeDraft === null) return
    setTimeSaving(true)
    const ok = await save({ time: timeDraft })
    setTimeSaving(false)
    if (ok) {
      setTimeDraft(null)
      setTimeSaved(true)
      setTimeout(() => setTimeSaved(false), 2000)
    }
  }

  return (
    <section id="today-brief" className={SECTION_CLASS}>
      <SectionHeader title="Brief" description="When your brief is ready and which model writes it." />
      {!settings ? (
        <SectionSkeleton failed={status === 'error'} onRetry={() => void useBriefSettingsStore.getState().load(true)} />
      ) : (
        <div className="space-y-4">
          <SettingFieldRow
            field={TIME_FIELD}
            state={{ value: timeDraft ?? settings.time, saving: timeSaving, saved: timeSaved, error: null }}
            onChange={(v) => { setTimeDraft(v); setTimeSaved(false) }}
            onSave={() => void saveTime()}
          />
          <div className="space-y-1.5">
            <Label htmlFor="brief-model" className="text-body-strong">AI model</Label>
            <Select value={settings.model} onValueChange={(v) => { if (v) void save({ model: v as BriefModel }) }}>
              <SelectTrigger id="brief-model" className="w-64">
                <SelectValue>{MODELS.find((m) => m.value === settings.model)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <SectionLabel as="div" id="brief-effort-label">Effort</SectionLabel>
            <ToggleGroup
              aria-labelledby="brief-effort-label"
              value={[settings.effort]}
              onValueChange={(v) => { const next = v[0] as BriefEffort | undefined; if (next) void save({ effort: next }) }}
            >
              {EFFORTS.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <Meta as="p">Low is fastest, about 10 seconds and 5¢ a day with Opus 5.5.</Meta>
          </div>
          {!settings.sources.ai && (
            <div className="flex flex-wrap items-center gap-2">
              <Meta as="p">No Anthropic key yet, so the brief sorts by priority without AI.</Meta>
              <Button variant="ghost" size="sm" onClick={() => openSettings('integrations')}>Add a key</Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 6: `components/settings/BriefLocationSettings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Label as SectionLabel, Meta } from '@/components/shared/typography'
import { CitySearch } from '@/components/today/CitySearch'
import { useDataProvider } from '@/services/provider-context'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { configValue, setModuleConfig } from '@/lib/briefLayout'
import { SECTION_CLASS, SectionHeader, SectionSkeleton } from './SettingsFields'

const UNITS = [
  { value: 'auto', label: 'Auto' },
  { value: 'F', label: '°F' },
  { value: 'C', label: '°C' },
] as const

/** Settings → Today & brief → Location & weather (addendum §2): the city
 *  (geocoded in Rust), units and rain notes (the weather module's config,
 *  the same values the Boxes list edits), and the CC BY 4.0 attribution. */
export function BriefLocationSettings() {
  const dp = useDataProvider()
  const settings = useBriefSettingsStore((s) => s.settings)
  const status = useBriefSettingsStore((s) => s.status)
  const save = useBriefSettingsStore((s) => s.save)
  const [changing, setChanging] = useState(false)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const weather = settings?.modules.find((m) => m.id === 'weather')
  const setWeather = (patch: Record<string, unknown>) => {
    if (settings) void save({ modules: setModuleConfig(settings.modules, 'weather', patch) })
  }

  return (
    <section id="today-location" className={SECTION_CLASS}>
      <SectionHeader title="Location & weather" description="Used for the weather chip at the top of your brief." />
      {!settings ? (
        <SectionSkeleton failed={status === 'error'} onRetry={() => void useBriefSettingsStore.getState().load(true)} />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <SectionLabel as="div">Location</SectionLabel>
            {settings.location && !changing ? (
              <div className="flex min-w-0 items-center gap-2">
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body">{settings.location.name}</span>
                <Button variant="outline" size="sm" onClick={() => setChanging(true)}>Change</Button>
                <Button variant="ghost" size="sm" onClick={() => void save({ location: null })}>Remove</Button>
              </div>
            ) : (
              <CitySearch
                autoFocus={changing}
                onPick={(location) => { setChanging(false); void save({ location }) }}
                onCancel={settings.location ? () => setChanging(false) : undefined}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <SectionLabel as="div" id="weather-units-label">Units</SectionLabel>
            <ToggleGroup
              aria-labelledby="weather-units-label"
              value={[String(weather?.config.units ?? 'auto')]}
              onValueChange={(v) => { if (v[0]) setWeather({ units: v[0] }) }}
            >
              {UNITS.map((u) => <ToggleGroupItem key={u.value} value={u.value}>{u.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span id="rain-notes-label" className="text-body-strong">Rain notes</span>
              <Meta as="p">Flags a timed event when rain is likely at that hour.</Meta>
            </div>
            <Switch
              aria-labelledby="rain-notes-label"
              checked={configValue(weather?.config, 'rain_notes', true)}
              onCheckedChange={(on) => setWeather({ rain_notes: on })}
            />
          </div>
          <Meta as="p">
            Weather data by{' '}
            <button
              type="button"
              className="focus-ring rounded-sm underline underline-offset-2 hover:text-foreground"
              onClick={() => void dp.system.openUrl('https://open-meteo.com/')}
            >
              Open-Meteo.com
            </button>
            , licensed CC BY 4.0.
          </Meta>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Mount.** In `SettingsPage.tsx`: import both components. Replace the `today-brief` body placeholder (and its comment) with `'today-brief': <TodayBriefSettings />,` and `'today-location': <BriefLocationSettings />,`, and extend the sections memo:

```tsx
  const briefSupported = dp.briefSettings.supported
  const sections = useMemo(
    () => visibleSections({ backup: backupSupported, reminders: remindersSupported, googleCalendar: googleSupported, briefSettings: briefSupported }),
    [backupSupported, remindersSupported, googleSupported, briefSupported],
  )
```

Update the comment above `const renderable` to: `// A section renders only when it has a body.`

- [ ] **Step 8: Verify**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: pass, and lint ≤ `LINT_BASELINE`. Commit (Step 9), then frozen-build harness: `BASE_URL=http://localhost:4620 npx playwright test -c e2e e2e/harness.spec.ts e2e/l3a-shell.spec.ts`. Expected: pass. The settings harness opens General, so it's unaffected; Task 10 axe-checks the brief page.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/components/settings apps/desktop/src/components/today/CitySearch.tsx apps/desktop/src/components/pages/SettingsPage.tsx apps/desktop/src/lib/settingsSections.ts apps/desktop/tests/settingsSections.test.mjs
git commit -m "feat(brief): Settings → Today & brief — Brief and Location & weather sections, city search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 7: The Boxes list (sortable, show/hide, `config_schema` options) and the Boxes settings section

**Files:**
- Create: `apps/desktop/src/components/today/BoxesList.tsx` (shared with setup step 6), `apps/desktop/src/components/settings/BriefBoxesSettings.tsx`
- Modify: `apps/desktop/src/lib/briefLayout.ts` (+`moveEntry`, `reorderEntries`, `boxRowKey`), `apps/desktop/tests/briefLayout.test.mjs`, `apps/desktop/src/lib/settingsSections.ts` (+`today-boxes` row), `apps/desktop/tests/settingsSections.test.mjs`, `apps/desktop/src/components/pages/SettingsPage.tsx` (mount), `apps/desktop/src/lib/shortcuts.ts` (append), `apps/desktop/tests/shortcuts.test.mjs`

**Interfaces:**
- Consumes: `BriefLayoutEntry`, `ModuleManifest`, `ConfigField` (Task 2), `setModuleConfig` / `setModuleEnabled` (Task 2), `BRIEF_MODULES[id].Settings` (Task 5), `useBriefSettingsStore`, `SECTION_CLASS` / `SectionHeader` / `SectionSkeleton` (Task 6).
- Produces:

```ts
// components/today/BoxesList.tsx — controlled; the parent owns the list and decides when to save
export function BoxesList(props: { entries: BriefLayoutEntry[]; manifests: ModuleManifest[]; onChange(next: BriefLayoutEntry[]): void; label?: string })
// lib/briefLayout.ts
export function moveEntry(entries: BriefLayoutEntry[], index: number, direction: 'up' | 'down'): BriefLayoutEntry[]
export function reorderEntries(entries: BriefLayoutEntry[], activeId: string, overId: string): BriefLayoutEntry[]
export type BoxRowIntent = { kind: 'focus'; index: number } | { kind: 'move'; direction: 'up' | 'down' }
export function boxRowKey(key: string, mods: { alt?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean }, index: number, length: number): BoxRowIntent | null
```

Row anatomy (addendum §2): drag handle · name (manifest `name`; weather reads "Weather chip") · show/hide switch · chevron that expands its options. Options come from `BRIEF_MODULES[id].Settings` when a module provides one, otherwise from `config_schema` (Bool → switch, Choice → segmented toggle, Label → text field). Keyboard: rows use a roving tab stop, ↑/↓/Home/End move focus and ⌥↑/⌥↓ move the box. Focus stays on the moved row, and a polite live region announces "Schedule moved to position 3 of 8".

- [ ] **Step 1: Write the failing tests.** Append to `apps/desktop/tests/briefLayout.test.mjs` (extend the import with `moveEntry, reorderEntries, boxRowKey`):

```js
test('moveEntry swaps with a neighbor and ignores moves off either end', () => {
  const list = [e('a'), e('b'), e('c')]
  assert.deepEqual(moveEntry(list, 1, 'up').map((x) => x.id), ['b', 'a', 'c'])
  assert.deepEqual(moveEntry(list, 1, 'down').map((x) => x.id), ['a', 'c', 'b'])
  assert.equal(moveEntry(list, 0, 'up'), list)
  assert.equal(moveEntry(list, 2, 'down'), list)
})

test('reorderEntries moves a dragged box onto the drop target', () => {
  const list = [e('a'), e('b'), e('c'), e('d')]
  assert.deepEqual(reorderEntries(list, 'a', 'c').map((x) => x.id), ['b', 'c', 'a', 'd'])
  assert.deepEqual(reorderEntries(list, 'd', 'b').map((x) => x.id), ['a', 'd', 'b', 'c'])
  assert.equal(reorderEntries(list, 'a', 'a'), list)
  assert.equal(reorderEntries(list, 'a', 'zz'), list)
})

test('boxRowKey: arrows move focus, ⌥ arrows move the box, chords are left alone', () => {
  assert.deepEqual(boxRowKey('ArrowDown', {}, 0, 3), { kind: 'focus', index: 1 })
  assert.deepEqual(boxRowKey('ArrowUp', {}, 0, 3), { kind: 'focus', index: 0 })
  assert.deepEqual(boxRowKey('End', {}, 0, 3), { kind: 'focus', index: 2 })
  assert.deepEqual(boxRowKey('ArrowDown', { alt: true }, 0, 3), { kind: 'move', direction: 'down' })
  assert.equal(boxRowKey('ArrowUp', { alt: true }, 0, 3), null, 'already first')
  assert.equal(boxRowKey('ArrowDown', { meta: true }, 0, 3), null)
  assert.equal(boxRowKey('ArrowDown', { alt: true, shift: true }, 0, 3), null)
  assert.equal(boxRowKey('Enter', {}, 0, 3), null)
})
```

In `tests/settingsSections.test.mjs`, the by-page `brief:` expectation becomes `['today-brief', 'today-location', 'today-boxes']` and the new test's list gains `['today-boxes', 'Boxes']`. In `tests/shortcuts.test.mjs` append:

```js
test('Today lists the brief setup and Boxes keys', () => {
  const keys = keysIn('Today')
  for (const k of ['⌥↑ / ⌥↓']) assert.ok(keys.includes(k), `Today missing ${k}`)
})
```

Run: `cd apps/desktop && node --test tests/briefLayout.test.mjs tests/settingsSections.test.mjs tests/shortcuts.test.mjs` → FAIL.

- [ ] **Step 2: Pure helpers** (append to `lib/briefLayout.ts`):

```ts
export function moveEntry(entries: BriefLayoutEntry[], index: number, direction: 'up' | 'down'): BriefLayoutEntry[] {
  const to = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= entries.length || to < 0 || to >= entries.length) return entries
  const next = entries.slice()
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

export function reorderEntries(entries: BriefLayoutEntry[], activeId: string, overId: string): BriefLayoutEntry[] {
  const from = entries.findIndex((x) => x.id === activeId)
  const to = entries.findIndex((x) => x.id === overId)
  if (from < 0 || to < 0 || from === to) return entries
  const next = entries.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export type BoxRowIntent = { kind: 'focus'; index: number } | { kind: 'move'; direction: 'up' | 'down' }

/** Keys on a focused Boxes row. Only plain arrows/Home/End and ⌥↑/⌥↓. */
export function boxRowKey(
  key: string,
  mods: { alt?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean },
  index: number,
  length: number,
): BoxRowIntent | null {
  if (length <= 0 || index < 0 || index >= length || mods.meta || mods.ctrl || mods.shift) return null
  if (mods.alt) {
    if (key === 'ArrowUp') return index > 0 ? { kind: 'move', direction: 'up' } : null
    if (key === 'ArrowDown') return index < length - 1 ? { kind: 'move', direction: 'down' } : null
    return null
  }
  if (key === 'ArrowUp') return { kind: 'focus', index: Math.max(0, index - 1) }
  if (key === 'ArrowDown') return { kind: 'focus', index: Math.min(length - 1, index + 1) }
  if (key === 'Home') return { kind: 'focus', index: 0 }
  if (key === 'End') return { kind: 'focus', index: length - 1 }
  return null
}
```

Append `{ id: 'today-boxes', label: 'Boxes', page: 'brief', requires: 'briefSettings' },` after `today-location` in `lib/settingsSections.ts`, and append to `SHORTCUTS` in `lib/shortcuts.ts` (after the last row):

```ts
  // ── Today: brief phase 2 (components/today/BoxesList.tsx → lib/briefLayout.ts boxRowKey) ──
  { section: 'Today', keys: '⌥↑ / ⌥↓', label: 'Move a box up / down (Settings → Boxes, setup)' },
```

Run the three test files → PASS.

- [ ] **Step 3: `components/today/BoxesList.tsx`**

```tsx
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, GripVertical } from 'lucide-react'
import type { BriefLayoutEntry, ConfigField, ModuleManifest } from '@nimble/types'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { IconButton } from '@/components/shared/IconButton'
import { boxRowKey, moveEntry, reorderEntries, setModuleConfig, setModuleEnabled } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { BRIEF_MODULES } from './briefModules'

/** One sortable list of every registered module (addendum §2), shared by
 *  Settings → Boxes and the setup's Arrange step. Controlled: every change
 *  hands the parent the whole next list. */
export function BoxesList({
  entries,
  manifests,
  onChange,
  label = 'Boxes',
}: {
  entries: BriefLayoutEntry[]
  manifests: ModuleManifest[]
  onChange: (next: BriefLayoutEntry[]) => void
  label?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const listRef = useRef<HTMLUListElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const ids = entries.map((x) => x.id)
  const stop = current && ids.includes(current) ? current : ids[0]
  const nameOf = (id: string) => manifests.find((m) => m.id === id)?.name ?? id
  const rowEl = (id: string | undefined) =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-box-row]') ?? []).find((el) => el.dataset.boxRow === id)

  // A keyboard move re-renders the list and WebKit drops focus from the
  // moved node: put it back on the same row once the new order is painted.
  // (The row ring keys off :focus, not :focus-visible, for the same reason
  // as FocusQueueList: WebKit carries a click's "no ring" state along.)
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    rowEl(id)?.focus()
  })

  const move = (index: number, direction: 'up' | 'down') => {
    const id = entries[index].id
    const next = moveEntry(entries, index, direction)
    if (next === entries) return
    pendingFocus.current = id
    onChange(next)
    setAnnouncement(`${nameOf(id)} moved to position ${next.findIndex((x) => x.id === id) + 1} of ${next.length}`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const id = (e.target as HTMLElement).dataset?.boxRow
    if (e.defaultPrevented || !id) return
    const index = ids.indexOf(id)
    const intent = boxRowKey(e.key, { alt: e.altKey, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey }, index, ids.length)
    if (!intent) return
    e.preventDefault()
    e.stopPropagation()
    if (intent.kind === 'focus') rowEl(ids[intent.index])?.focus()
    else move(index, intent.direction)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const next = reorderEntries(entries, String(active.id), String(over.id))
    if (next !== entries) onChange(next)
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul ref={listRef} aria-label={label} className="divide-y divide-border/50 rounded-lg border" onKeyDown={onKeyDown}>
            {entries.map((entry) => (
              <BoxRow
                key={entry.id}
                entry={entry}
                manifest={manifests.find((m) => m.id === entry.id)}
                current={entry.id === stop}
                onFocusRow={() => setCurrent(entry.id)}
                onToggle={(on) => onChange(setModuleEnabled(entries, entry.id, on))}
                onConfig={(patch) => onChange(setModuleConfig(entries, entry.id, patch))}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  )
}

function BoxRow({
  entry,
  manifest,
  current,
  onFocusRow,
  onToggle,
  onConfig,
}: {
  entry: BriefLayoutEntry
  manifest: ModuleManifest | undefined
  current: boolean
  onFocusRow: () => void
  onToggle: (on: boolean) => void
  onConfig: (patch: Record<string, unknown>) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id })
  const [open, setOpen] = useState(false)
  const optionsId = useId()
  const name = manifest?.name ?? entry.id
  const schema = manifest?.config_schema ?? []
  const Custom = BRIEF_MODULES[entry.id]?.Settings
  const hasOptions = !!Custom || schema.length > 0

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-box-row={entry.id}
      tabIndex={current ? 0 : -1}
      aria-label={`${name}, ${entry.enabled ? 'shown' : 'hidden'}`}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onFocus={(e) => { if (e.target === e.currentTarget) onFocusRow() }}
      className={cn('bg-card outline-none first:rounded-t-lg last:rounded-b-lg focus:ring-2 focus:ring-ring focus:ring-inset', isDragging && 'relative z-10 shadow-popover')}
    >
      <div className="flex min-h-10 min-w-0 items-center gap-2 px-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label={`Drag ${name}`}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
        <span className={cn('min-w-0 flex-1 truncate text-body', !entry.enabled && 'text-muted-foreground')}>{name}</span>
        <Switch checked={entry.enabled} onCheckedChange={(on) => onToggle(on)} aria-label={`Show ${name}`} />
        {hasOptions ? (
          <IconButton aria-label={`${name} options`} aria-expanded={open} aria-controls={optionsId} onClick={() => setOpen((o) => !o)}>
            <ChevronDown className={cn('size-3.5 transition-transform duration-(--transition-fast)', open && 'rotate-180')} />
          </IconButton>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
      </div>
      {open && hasOptions && (
        <div id={optionsId} className="space-y-3 pb-3 pl-10 pr-3">
          {Custom ? (
            <Custom entry={entry} onChange={onConfig} />
          ) : (
            schema.map((field) => (
              <ConfigFieldControl key={field.key} field={field} value={entry.config[field.key]} onChange={(v) => onConfig({ [field.key]: v })} />
            ))
          )}
        </div>
      )}
    </li>
  )
}

/** One `config_schema` field (addendum §1's closed set). */
function ConfigFieldControl({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void }) {
  const labelId = useId()
  if (field.type === 'bool') {
    return (
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-body">{field.label}</span>
        <Switch aria-labelledby={labelId} checked={typeof value === 'boolean' ? value : field.default} onCheckedChange={(on) => onChange(on)} />
      </div>
    )
  }
  if (field.type === 'choice') {
    const selected = String(value ?? field.default)
    return (
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-body">{field.label}</span>
        <ToggleGroup
          aria-labelledby={labelId}
          size="sm"
          value={[selected]}
          onValueChange={(v) => {
            const pick = field.options.find((o) => String(o.value) === v[0])
            if (pick) onChange(pick.value)
          }}
        >
          {field.options.map((o) => (
            <ToggleGroupItem key={String(o.value)} value={String(o.value)} className="px-2 text-label">{o.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    )
  }
  return <LabelFieldControl label={field.label} defaultName={field.default_name} value={value} onChange={onChange} />
}

/** A label name. Commits on blur or ↵ (and swallows that ↵ so a setup
 *  step doesn't advance). Phase 3 can swap in C4's LabelPicker through
 *  `BRIEF_MODULES[id].Settings`. */
function LabelFieldControl({ label, defaultName, value, onChange }: { label: string; defaultName: string; value: unknown; onChange: (v: unknown) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (typeof value === 'string' ? value : defaultName)
  const commit = () => {
    if (draft === null) return
    const next = draft.trim() || defaultName
    setDraft(null)
    if (next !== value) onChange(next)
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-body">{label}</label>
      <Input
        id={id}
        className="w-40"
        value={shown}
        placeholder={defaultName}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
    </div>
  )
}
```

- [ ] **Step 4: `components/settings/BriefBoxesSettings.tsx`** and mount it (`'today-boxes': <BriefBoxesSettings />,` in the `bodies` map):

```tsx
import { useEffect } from 'react'
import { BoxesList } from '@/components/today/BoxesList'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { SECTION_CLASS, SectionHeader, SectionSkeleton } from './SettingsFields'

/** Settings → Today & brief → Boxes (addendum §2). Each change saves the
 *  whole list; the store serializes saves, so rapid edits land in order. */
export function BriefBoxesSettings() {
  const settings = useBriefSettingsStore((s) => s.settings)
  const status = useBriefSettingsStore((s) => s.status)
  const save = useBriefSettingsStore((s) => s.save)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  return (
    <section id="today-boxes" className={SECTION_CLASS}>
      <SectionHeader title="Boxes" description="Which boxes your brief shows, in what order, and what each one shows. Drag a row, or press ⌥↑ and ⌥↓." />
      {!settings ? (
        <SectionSkeleton rows={6} failed={status === 'error'} onRetry={() => void useBriefSettingsStore.getState().load(true)} />
      ) : (
        <BoxesList entries={settings.modules} manifests={settings.manifests} onChange={(modules) => void save({ modules })} />
      )}
    </section>
  )
}
```

- [ ] **Step 5: Verify**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: pass, and lint ≤ `LINT_BASELINE`. Task 10 (AC5/AC6) covers the Boxes behavior in the browser.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/today/BoxesList.tsx apps/desktop/src/components/settings/BriefBoxesSettings.tsx apps/desktop/src/components/pages/SettingsPage.tsx apps/desktop/src/lib/briefLayout.ts apps/desktop/src/lib/settingsSections.ts apps/desktop/src/lib/shortcuts.ts apps/desktop/tests
git commit -m "feat(brief): Boxes list — sortable, show/hide, config_schema options; Settings → Boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 8: The 6-step Today setup with live preview, first-visit trigger and "Run setup again"

**Files:**
- Create: `apps/desktop/src/stores/todaySetupStore.ts`, `apps/desktop/src/components/today/setup/{TodaySetup.tsx, SetupSteps.tsx, SetupPreview.tsx}`
- Modify: `apps/desktop/src/lib/briefLayout.ts` (+presets, draft), `apps/desktop/src/lib/keyGuard.ts` (+`setupKey`), `apps/desktop/src/lib/shortcuts.ts` (append), `apps/desktop/src/components/pages/TodayPage.tsx` (trigger + takeover), `apps/desktop/src/components/settings/TodayBriefSettings.tsx` (Run setup again), `apps/desktop/tests/{briefLayout,keyGuard,shortcuts}.test.mjs`

**Interfaces:**
- Consumes: `useBriefSettingsStore.save` (one save = one transaction, Task 2), `BoxesList` (Task 7), `CitySearch` (Task 6), `ModuleBox` / `BRIEF_MODULES` / `useBriefLive` (Task 5), `hasOpenOverlay` (`lib/rowNav`), `openSettings`.
- Produces:

```ts
// lib/briefLayout.ts
export type PresetId = 'focused' | 'full' | 'minimal'
export const PRESETS: { id: PresetId; name: string; description: string; enabled: string[] | 'all' }[]
export interface SetupDraft { preset: PresetId | null; time: string; location: BriefLocation | null; modules: BriefLayoutEntry[]; goals: BriefGoals }
export function draftFrom(s: BriefSettings): SetupDraft
export function applyPreset(entries: BriefLayoutEntry[], id: PresetId): BriefLayoutEntry[]
export function setupPatch(d: SetupDraft): BriefSettingsPatch      // time, location, modules, goals.{daily,weekly,days_off}, complete_setup
// lib/keyGuard.ts
export function setupKey(e: CalendarKeyEvent & { repeat?: boolean }, overlayOpen: boolean): 'continue' | 'skip' | null
// stores/todaySetupStore.ts
export const SETUP_STEPS = 6
export const useTodaySetupStore: { open: boolean; step: number; draft: SetupDraft | null; start(from: BriefSettings): void; go(step: number): void; patch(p: Partial<SetupDraft>): void; close(): void }
```

Behavior (addendum §3):
- Setup opens on the first Today visit while `today.setup_completed_at` is null (desktop only), and again from Settings → Brief → Run setup again. It takes over the Today column: the step on the left and the live preview on the right, which renders the real module Boxes in `preview` mode against the draft, read-only (`inert`).
- The header shows "Step n of 6" · Back · Skip setup. `↵` continues and Finish runs on step 6. `Esc` skips setup, which saves the draft as it stands (defaults on a fresh profile) plus `complete_setup`.
- Finish saves everything in **one** `save`, then Today renders the brief and focus moves to it. Phase 3 will trigger composition here.
- The draft lives in a zustand store. Clicking "Connect" on step 4 goes to Settings → Connections, and returning to Today resumes at step 4 with the choices kept.
- Step 5 writes `goals.daily`, `goals.weekly` and `goals.days_off` only.

> **UX checkpoint 2 — live preview fidelity/scale.** (A) **Recommended:** the real components at 100% in a right column that scrolls on its own, `inert`, with a "Preview" label. Exact, and there's no second renderer to maintain. (B) The same components scaled to 80% with a CSS transform: more fits, but text gets small and hit areas mislead. (C) A schematic list of box names only: cheapest, but it doesn't show what each option does.
>
> **UX checkpoint 3 — setup at narrow widths.** The preview column needs about 30rem next to a 21rem step. (A) **Recommended:** below a 46rem container width, hide the preview and keep the step full-width. The preview is an aid, and every step works without it. (B) Stack the preview under the step: long, and it pushes Continue off-screen. (C) Add a "Show preview" toggle below the step. Uses a Tailwind v4 container query (`@container` / `@min-[46rem]:`).
>
> **UX checkpoint 4 — what each starting layout turns on (phase 2 has no Quick wins yet).** (A) **Recommended:** Focused = weather chip, Schedule, Top priorities, Due today and From your vault. Full = every box. Minimal = weather chip, Schedule, Due today and From your vault (no AI). The chip and the vault box are in every preset because both show nothing when unconfigured. Phase 3 adds `quick_wins` to Focused. (B) Focused also keeps Still open (phase 1's default). (C) Presets exclude the chip until a location is set.

- [ ] **Step 1: Write the failing tests.** Append to `tests/briefLayout.test.mjs` (extend the import with `PRESETS, applyPreset, draftFrom, setupPatch`):

```js
test('presets toggle boxes without reordering them (UX checkpoint 4)', () => {
  const list = ['weather', 'schedule', 'priorities', 'due_today', 'still_open', 'habits', 'vault', 'notes'].map((id) => e(id))
  const on = (preset) => applyPreset(list, preset).filter((x) => x.enabled).map((x) => x.id)
  assert.deepEqual(on('focused'), ['weather', 'schedule', 'priorities', 'due_today', 'vault'])
  assert.deepEqual(on('full'), list.map((x) => x.id))
  assert.deepEqual(on('minimal'), ['weather', 'schedule', 'due_today', 'vault'])
  assert.deepEqual(applyPreset(list, 'minimal').map((x) => x.id), list.map((x) => x.id), 'order kept')
  assert.deepEqual(PRESETS.map((p) => p.name), ['Focused', 'Full', 'Minimal'])
})

test('the draft starts from saved settings and Finish writes exactly the setup keys', () => {
  const settings = {
    time: '06:30', location: null, modules: [e('schedule')], model: 'claude-opus-5-5', effort: 'low', setup_completed_at: null,
    goals: { daily: 5, weekly: 25, days_off: ['sat', 'sun'] }, sources: { calendar: false, tasks: false, vault: false, ai: false }, manifests: [],
  }
  const d = draftFrom(settings)
  assert.equal(d.preset, null)
  d.goals.days_off.push('fri')
  assert.deepEqual(settings.goals.days_off, ['sat', 'sun'], 'the draft is a copy')
  assert.deepEqual(Object.keys(setupPatch(d)).sort(), ['complete_setup', 'goals', 'location', 'modules', 'time'])
  assert.deepEqual(setupPatch(d).goals, { daily: 5, weekly: 25, days_off: ['sat', 'sun', 'fri'] })
  assert.equal(setupPatch(d).complete_setup, true)
})
```

Append to `tests/keyGuard.test.mjs` (extend the import with `setupKey`):

```js
test('setupKey: ↵ continues and Esc skips, never from fields, controls, overlays or chords', () => {
  const ev = (key, target = el(), extra = {}) => ({ key, target, ...extra })
  assert.equal(setupKey(ev('Enter'), false), 'continue', 'the focused step heading')
  assert.equal(setupKey(ev('Escape'), false), 'skip')
  assert.equal(setupKey(ev('Enter', el({ tag: 'INPUT' })), false), null, 'city search / time / number fields own ↵')
  assert.equal(setupKey(ev('Enter', el({ tag: 'BUTTON', is: [INTERACTIVE_SELECTOR] })), false), null, 'Back, a preset, Connect')
  assert.equal(setupKey(ev('Escape', el({ tag: 'INPUT' })), false), 'skip', 'Esc from a field still skips (fields that use Esc preventDefault)')
  assert.equal(setupKey(ev('Escape', el({ inside: [OVERLAY_SELECTOR] })), false), null, 'a menu or Select closes first')
  assert.equal(setupKey(ev('Enter'), true), null, 'an open popup anywhere')
  assert.equal(setupKey(ev('Escape'), true), null)
  assert.equal(setupKey(ev('Enter', el(), { metaKey: true }), false), null)
  assert.equal(setupKey(ev('Enter', el(), { defaultPrevented: true }), false), null)
  assert.equal(setupKey(ev('Enter', el(), { repeat: true }), false), null, 'a held ↵ does not race through the steps')
})
```

Update `tests/shortcuts.test.mjs`'s new test list to `['⌥↑ / ⌥↓', 'Enter (setup)', 'Escape (setup)']`.

Run: `cd apps/desktop && node --test tests/briefLayout.test.mjs tests/keyGuard.test.mjs tests/shortcuts.test.mjs` → FAIL.

- [ ] **Step 2: Pure pieces.** Append to `lib/briefLayout.ts` (extend its type import with `BriefGoals, BriefLocation`):

```ts
export type PresetId = 'focused' | 'full' | 'minimal'

/** Setup step 1 (base §3.4; UX checkpoint 4). Presets only toggle; the
 *  order stays the user's. Phase 3 appends 'quick_wins' to Focused. */
export const PRESETS: { id: PresetId; name: string; description: string; enabled: string[] | 'all' }[] = [
  { id: 'focused', name: 'Focused', description: 'Your schedule, top priorities and what’s due today.', enabled: ['weather', 'schedule', 'priorities', 'due_today', 'vault'] },
  { id: 'full', name: 'Full', description: 'Every box, including habits and notes.', enabled: 'all' },
  { id: 'minimal', name: 'Minimal', description: 'Your schedule and what’s due today. No AI.', enabled: ['weather', 'schedule', 'due_today', 'vault'] },
]

export function applyPreset(entries: BriefLayoutEntry[], id: PresetId): BriefLayoutEntry[] {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return entries
  return entries.map((x) => ({ ...x, enabled: preset.enabled === 'all' || preset.enabled.includes(x.id) }))
}

export interface SetupDraft {
  preset: PresetId | null
  time: string
  location: BriefLocation | null
  modules: BriefLayoutEntry[]
  goals: BriefGoals
}

export function draftFrom(s: BriefSettings): SetupDraft {
  return {
    preset: null,
    time: s.time,
    location: s.location,
    modules: s.modules.map((x) => ({ ...x, config: { ...x.config } })),
    goals: { daily: s.goals.daily, weekly: s.goals.weekly, days_off: [...s.goals.days_off] },
  }
}

/** Finish (and Skip): every setup key in one save (addendum §3). */
export function setupPatch(d: SetupDraft): BriefSettingsPatch {
  return {
    time: d.time,
    location: d.location,
    modules: d.modules,
    goals: { daily: d.goals.daily, weekly: d.goals.weekly, days_off: d.goals.days_off },
    complete_setup: true,
  }
}
```

Append to `lib/keyGuard.ts`:

```ts
/**
 * The Today setup's keys (addendum §3): ↵ continues, Esc skips the whole
 * setup. ↵ stands down on text entry (the city search, time and number
 * fields own it) and on any focused control (a button activates itself);
 * both stand down while any popup is open (`overlayOpen` = rowNav's
 * hasOpenOverlay) or the key is inside one. Fields that use Esc (the city
 * search) preventDefault it. Held keys never repeat through the steps.
 */
export function setupKey(e: CalendarKeyEvent & { repeat?: boolean }, overlayOpen: boolean): 'continue' | 'skip' | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || overlayOpen) return null
  if (e.key === 'Escape') return e.target?.closest?.(OVERLAY_SELECTOR) ? null : 'skip'
  if (e.key === 'Enter') return shouldIgnoreKey(e.target) ? null : 'continue'
  return null
}
```

Append to `SHORTCUTS` in `lib/shortcuts.ts`:

```ts
  { section: 'Today', keys: 'Enter (setup)', label: 'Continue to the next setup step' },
  { section: 'Today', keys: 'Escape (setup)', label: 'Skip setup (keeps what you chose so far)' },
```

Run the three test files → PASS.

- [ ] **Step 3: `stores/todaySetupStore.ts`**

```ts
import { create } from 'zustand'
import type { BriefSettings } from '@nimble/types'
import { draftFrom, type SetupDraft } from '@/lib/briefLayout'

export const SETUP_STEPS = 6

/* The Today setup's session state (not persisted): open, step and draft
   survive a detour to Settings → Connections from step 4. Closing only
   happens after a successful save, which sets today.setup_completed_at,
   so the first-visit trigger can't loop. */
interface TodaySetupState {
  open: boolean
  step: number
  draft: SetupDraft | null
  start: (from: BriefSettings) => void
  go: (step: number) => void
  patch: (patch: Partial<SetupDraft>) => void
  close: () => void
}

export const useTodaySetupStore = create<TodaySetupState>((set) => ({
  open: false,
  step: 0,
  draft: null,
  start: (from) => set({ open: true, step: 0, draft: draftFrom(from) }),
  go: (step) => set({ step: Math.max(0, Math.min(SETUP_STEPS - 1, step)) }),
  patch: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),
  close: () => set({ open: false, step: 0, draft: null }),
}))
```

- [ ] **Step 4: `components/today/setup/SetupSteps.tsx`**

```tsx
import { useEffect, type KeyboardEvent } from 'react'
import { Check, MapPin } from 'lucide-react'
import type { BriefGoals, Weekday } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Label as SectionLabel, Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { openSettings } from '@/stores/settingsNavStore'
import { applyPreset, PRESETS, type PresetId, type SetupDraft } from '@/lib/briefLayout'
import { BoxesList } from '../BoxesList'
import { CitySearch } from '../CitySearch'

export interface StepProps {
  draft: SetupDraft
  onChange: (patch: Partial<SetupDraft>) => void
  onContinue: () => void
}

/** ↵ in a field that has no other use for it continues. */
function enterContinues(onContinue: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
      e.preventDefault()
      onContinue()
    }
  }
}

export function LayoutStep({ draft, onChange }: StepProps) {
  return (
    <div className="space-y-2">
      <Meta as="p">Pick a starting point. You can change every box later.</Meta>
      <ToggleGroup
        orientation="vertical"
        aria-label="Starting layout"
        value={draft.preset ? [draft.preset] : []}
        onValueChange={(v) => {
          const id = v[0] as PresetId | undefined
          if (id) onChange({ preset: id, modules: applyPreset(draft.modules, id) })
        }}
        className="w-full gap-2 bg-transparent p-0"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem
            key={p.id}
            value={p.id}
            className="h-auto w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left data-pressed:border-primary"
          >
            <span className="text-body-strong">{p.name}</span>
            <span className="whitespace-normal text-meta text-muted-foreground">{p.description}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

export function LocationStep({ draft, onChange }: StepProps) {
  return (
    <div className="space-y-3">
      {draft.location && (
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body">{draft.location.name}</span>
          <Button variant="ghost" size="sm" onClick={() => onChange({ location: null })}>Remove</Button>
        </div>
      )}
      <CitySearch label={draft.location ? 'Change city' : 'Search for a city'} onPick={(location) => onChange({ location })} />
      <Meta as="p">Used only for the weather chip. Skip it and the chip reads “Add location”.</Meta>
    </div>
  )
}

export function TimeStep({ draft, onChange, onContinue }: StepProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="setup-brief-time" className="text-body-strong">Brief time</Label>
      <Input
        id="setup-brief-time"
        type="time"
        value={draft.time}
        onChange={(e) => { if (e.target.value) onChange({ time: e.target.value }) }}
        onKeyDown={enterContinues(onContinue)}
        className="w-32"
      />
      <Meta as="p">Nimble prepares your brief at this time if it’s open. Otherwise it’s ready a few seconds after you open it.</Meta>
    </div>
  )
}

const SOURCES = [
  { key: 'calendar', name: 'Calendar', detail: 'Events for your schedule.', section: 'calendars' },
  { key: 'tasks', name: 'Todoist sync', detail: 'Keeps your tasks mirrored in Todoist.', section: 'todoist-sync' },
  { key: 'vault', name: 'Obsidian vault', detail: 'Your past markdown briefs.', section: 'obsidian' },
  { key: 'ai', name: 'Anthropic key', detail: 'AI priorities. Without it, the brief sorts by priority.', section: 'integrations' },
] as const

export function SourcesStep() {
  const sources = useBriefSettingsStore((s) => s.settings?.sources)
  // Back from Settings → Connections: re-read what's connected now.
  useEffect(() => { void useBriefSettingsStore.getState().load(true) }, [])
  return (
    <div className="space-y-2">
      <Meta as="p">Everything here is optional. The brief works with whatever is connected.</Meta>
      <ul className="divide-y divide-border/50 rounded-lg border">
        {SOURCES.map((s) => {
          const connected = !!sources?.[s.key]
          return (
            <li key={s.key} className="flex min-w-0 items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-body-strong">{s.name}</p>
                <Meta as="p" className="truncate">{s.detail}</Meta>
              </div>
              {connected ? (
                <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                  <Check className="size-3.5" aria-hidden /> Connected
                </span>
              ) : (
                <Button variant="outline" size="sm" onClick={() => openSettings(s.section)}>Connect</Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const DAYS: { id: Weekday; label: string }[] = [
  { id: 'mon', label: 'Mon' }, { id: 'tue', label: 'Tue' }, { id: 'wed', label: 'Wed' }, { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' }, { id: 'sat', label: 'Sat' }, { id: 'sun', label: 'Sun' },
]

export function GoalsStep({ draft, onChange, onContinue }: StepProps) {
  const setGoals = (patch: Partial<BriefGoals>) => onChange({ goals: { ...draft.goals, ...patch } })
  const numberField = (id: string, label: string, value: number, max: number, apply: (n: number) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-body-strong">{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= 1 && n <= max) apply(n)
        }}
        onKeyDown={enterContinues(onContinue)}
        className="w-24"
      />
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        {numberField('setup-goal-daily', 'Tasks a day', draft.goals.daily, 100, (daily) => setGoals({ daily }))}
        {numberField('setup-goal-weekly', 'Tasks a week', draft.goals.weekly, 700, (weekly) => setGoals({ weekly }))}
      </div>
      <div className="space-y-1.5">
        <SectionLabel as="div" id="setup-days-off">Days off</SectionLabel>
        <ToggleGroup multiple aria-labelledby="setup-days-off" value={draft.goals.days_off} onValueChange={(v) => setGoals({ days_off: v as Weekday[] })}>
          {DAYS.map((d) => <ToggleGroupItem key={d.id} value={d.id} className="px-2 text-label">{d.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <Meta as="p">Days off count toward nothing. Missing a goal never changes anything the next day.</Meta>
      </div>
    </div>
  )
}

export function ArrangeStep({ draft, onChange }: StepProps) {
  const manifests = useBriefSettingsStore((s) => s.settings?.manifests ?? [])
  return (
    <div className="space-y-2">
      <Meta as="p">Turn boxes on or off and put them in the order you read them. Drag, or press ⌥↑ and ⌥↓.</Meta>
      <BoxesList entries={draft.modules} manifests={manifests} onChange={(modules) => onChange({ modules, preset: null })} label="Boxes" />
    </div>
  )
}
```

- [ ] **Step 5: `components/today/setup/SetupPreview.tsx`**

```tsx
import { MapPin } from 'lucide-react'
import { Label, Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { arrangeBrief, type SetupDraft } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { ModuleBox } from '../ModuleBox'
import { briefModuleInfo } from '../briefModules'
import { useBriefLive } from '../briefLive'

/** The real brief under the draft settings (UX checkpoint 2): today's live
 *  data, modules in `preview` mode, `inert` so nothing inside is focusable
 *  or clickable. A city picked in step 2 isn't fetched until Finish, so the
 *  chip says so instead of showing the old city's weather. */
export function SetupPreview({ draft, className }: { draft: SetupDraft; className?: string }) {
  const live = useBriefLive()
  const saved = useBriefSettingsStore((s) => s.settings?.location ?? null)
  const locationChanged = (draft.location?.name ?? null) !== (saved?.name ?? null)
  const { header, body } = arrangeBrief(draft.modules, briefModuleInfo, false)
  const today = live?.today ?? ''
  return (
    <div data-setup-preview className={cn('min-w-0 space-y-2', className)}>
      <Label as="p">Preview</Label>
      <div inert className="max-h-[calc(100vh-var(--page-header-h)-6rem)] space-y-4 overflow-y-auto rounded-xl">
        {header.length > 0 && (
          <div className="flex items-center gap-2">
            {header.map((e) =>
              e.id === 'weather' && locationChanged && draft.location ? (
                <span key={e.id} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-meta text-muted-foreground">
                  <MapPin className="size-3.5" aria-hidden /> {draft.location.name} · weather after setup
                </span>
              ) : (
                <ModuleBox key={e.id} id={e.id} mode="preview" date={today} config={e.config} />
              ),
            )}
          </div>
        )}
        {body.map((e) => (
          <ModuleBox key={e.id} id={e.id} mode="preview" date={today} config={e.config} />
        ))}
        {header.length + body.length === 0 && <Meta as="p">No boxes are on. Turn some on in the last step.</Meta>}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: `components/today/setup/TodaySetup.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta } from '@/components/shared/typography'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { SETUP_STEPS, useTodaySetupStore } from '@/stores/todaySetupStore'
import { setupPatch } from '@/lib/briefLayout'
import { setupKey } from '@/lib/keyGuard'
import { hasOpenOverlay } from '@/lib/rowNav'
import { ArrangeStep, GoalsStep, LayoutStep, LocationStep, SourcesStep, TimeStep } from './SetupSteps'
import { SetupPreview } from './SetupPreview'

const TITLES = [
  'Choose a starting layout',
  'Where are you?',
  'When should your brief be ready?',
  'Connect your sources',
  'Set your goals',
  'Arrange your boxes',
] as const

/** The Today setup (addendum §3): six skippable steps, one save at the end. */
export function TodaySetup({ onDone }: { onDone: () => void }) {
  const step = useTodaySetupStore((s) => s.step)
  const draft = useTodaySetupStore((s) => s.draft)
  const go = useTodaySetupStore((s) => s.go)
  const patch = useTodaySetupStore((s) => s.patch)
  const close = useTodaySetupStore((s) => s.close)
  const save = useBriefSettingsStore((s) => s.save)
  const [saving, setSaving] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Each step starts on its heading, so ↵ continues and Tab reaches its controls.
  useEffect(() => { headingRef.current?.focus() }, [step])

  const finish = useCallback(async () => {
    if (!draft || saving) return
    setSaving(true)
    const ok = await save(setupPatch(draft))
    setSaving(false)
    if (ok) {
      close()
      onDone()
    }
  }, [draft, saving, save, close, onDone])

  const next = useCallback(() => {
    if (step < SETUP_STEPS - 1) go(step + 1)
    else void finish()
  }, [step, go, finish])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = setupKey(
        { key: e.key, target: e.target as HTMLElement | null, defaultPrevented: e.defaultPrevented, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat },
        hasOpenOverlay(),
      )
      if (action === 'continue') { e.preventDefault(); next() }
      else if (action === 'skip') { e.preventDefault(); void finish() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, finish])

  if (!draft) return <Skeleton className="h-72 w-full rounded-xl" />
  const props = { draft, onChange: patch, onContinue: next }

  return (
    <section aria-labelledby="today-setup-title" className="@container">
      <div className="grid gap-6 @min-[46rem]:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <div className="surface-panel flex min-w-0 flex-col gap-4 p-5">
          <div className="flex items-center gap-2">
            <Meta as="p" aria-live="polite" className="tabular-nums">Step {step + 1} of {SETUP_STEPS}</Meta>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => go(step - 1)} disabled={step === 0 || saving}>Back</Button>
              <Button variant="ghost" size="sm" onClick={() => void finish()} disabled={saving}>Skip setup</Button>
            </div>
          </div>
          <h2 id="today-setup-title" ref={headingRef} tabIndex={-1} className="text-title outline-none">{TITLES[step]}</h2>
          {step === 0 && <LayoutStep {...props} />}
          {step === 1 && <LocationStep {...props} />}
          {step === 2 && <TimeStep {...props} />}
          {step === 3 && <SourcesStep />}
          {step === 4 && <GoalsStep {...props} />}
          {step === 5 && <ArrangeStep {...props} />}
          <div className="mt-auto flex items-center justify-end gap-3 pt-2">
            <Meta as="p">↵ to continue · Esc to skip setup</Meta>
            <Button onClick={next} disabled={saving}>{step === SETUP_STEPS - 1 ? 'Finish' : 'Continue'}</Button>
          </div>
        </div>
        <SetupPreview draft={draft} className="hidden @min-[46rem]:block" />
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Wire it into Today.** In `TodayPage.tsx`, add imports:

```tsx
import { TodaySetup } from '@/components/today/setup/TodaySetup'
import { useTodaySetupStore } from '@/stores/todaySetupStore'
```

After the brief-settings lines:

```tsx
  // First Today visit while the setup never completed (addendum §3). Desktop
  // only: the web has no settings. Closing always follows a successful save,
  // so this can't reopen in a loop.
  const setupOpen = useTodaySetupStore((s) => s.open)
  useEffect(() => {
    if (settings && settings.setup_completed_at === null && !useTodaySetupStore.getState().open) {
      useTodaySetupStore.getState().start(settings)
    }
  }, [settings])
  const focusBrief = useCallback(() => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-brief-body]')?.focus())
  }, [])
```

At the top of the keydown handler's `onKey`, add `if (useTodaySetupStore.getState().open) return`, so `b`, `[` and `]` stand down during setup. In the header `actions`, render the header modules, `DateStrip`, the chevron and `BriefMenu` only when `!setupOpen`. In the body, wrap the brief branch:

```tsx
        <ReminderCatchUp />
        {setupOpen ? (
          <TodaySetup onDone={focusBrief} />
        ) : selected !== today ? (
          <PastBrief date={selected} today={today} />
        ) : !arranged ? (
          <BriefSkeleton />
        ) : (
          /* …the data-brief-body region from Task 5, unchanged… */
        )}
```

In `TodayBriefSettings.tsx`, add imports `useAppStore` (`@/stores/appStore`) and `useTodaySetupStore`, and append inside the loaded branch (after the no-key note):

```tsx
          <div className="space-y-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                useTodaySetupStore.getState().start(settings)
                useAppStore.getState().setCurrentPage('today')
              }}
            >
              Run setup again
            </Button>
            <Meta as="p">Walks through layout, location, brief time, sources, goals and boxes. Everything is kept until you finish.</Meta>
          </div>
```

- [ ] **Step 8: Verify**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1`
Expected: pass, and lint ≤ `LINT_BASELINE`. The existing e2e suite is unaffected: the mock's default profile has `setup_completed_at` set, and Task 10 covers `?setup=fresh`.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/stores/todaySetupStore.ts apps/desktop/src/components/today/setup apps/desktop/src/components/pages/TodayPage.tsx apps/desktop/src/components/settings/TodayBriefSettings.tsx apps/desktop/src/lib apps/desktop/tests
git commit -m "feat(brief): 6-step Today setup with live preview, first-visit trigger, Run setup again

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 9: Remove the all-required setup gate; every feature degrades on its own

**Files:**
- Modify: `nimble-core/src/db/settings.rs` (`REQUIRED_SETTINGS = &[]`, tests), `apps/desktop/src/lib/setupGate.ts`, `apps/desktop/tests/setupGate.test.mjs`, `apps/desktop/src/App.tsx`, `apps/desktop/src/components/pages/SettingsPage.tsx` (`handleReset`), `apps/desktop/src/lib/errors.ts`, `apps/desktop/tests/errors.test.mjs`, `apps/desktop/src/hooks/useObsidian.ts`
- Delete: `apps/desktop/src/components/setup/SetupDialog.tsx`

**Interfaces:**
- Consumes: the Today setup (Task 8) as the only onboarding; `useBriefSettingsStore.load(true)`.
- Produces: `check_setup_complete` always true (the command and `settings.checkSetupComplete` stay for compatibility); `isVaultNotConfigured(raw: unknown): boolean` in `lib/errors.ts`.

Degradation per missing key (addendum §3). Most of these already hold; the list is here for the verify step:

| Missing | Behavior |
|---|---|
| `todoist_api_token` | No sync. The observer already requires the token (`integrations/todoist/observer.rs:125`), and `sources.tasks` shows "Connect". |
| `obsidian_vault_path` | No vault box (`read_daily_brief` fails, and VaultBox renders nothing). **Fix:** `useObsidian` toasted "Missing configuration" on every Today open, so it now reads "not configured" as "no daily note". |
| `anthropic_api_key` | The calm "no key" line in Top priorities (unchanged), and the Brief settings note offers "Add a key". |
| calendar feeds | "No events. Wide open." / cached empty schedule (unchanged). |
| `brief.location` | The chip reads "Add location". |

- [ ] **Step 1: Write the failing tests.** In `nimble-core/src/db/settings.rs`, replace both tests with:

```rust
    #[tokio::test]
    async fn setup_is_complete_with_nothing_configured() {
        let pool = test_pool().await;
        assert!(super::check_setup_complete(&pool).await.unwrap(), "every integration is optional (addendum §3)");
    }
```

Replace `apps/desktop/tests/setupGate.test.mjs` with:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SETUP_REQUIRED_KEYS } from '../src/lib/setupGate.ts'

// Brief phase 2 (addendum §3): nothing is required before the app runs.
// The two lists stay pinned together so neither can grow back alone.
test('nothing is required before the app runs, in Rust or here', () => {
  const rs = readFileSync(new URL('../../../nimble-core/src/db/settings.rs', import.meta.url), 'utf8')
  const block = rs.match(/REQUIRED_SETTINGS[^=]*=\s*&\[([\s\S]*?)\]/)
  assert.ok(block, 'REQUIRED_SETTINGS not found in settings.rs')
  const rustKeys = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(rustKeys, [])
  assert.deepEqual([...SETUP_REQUIRED_KEYS], [])
})
```

Append to `apps/desktop/tests/errors.test.mjs` (extend the import with `isVaultNotConfigured`):

```js
test('a missing vault path is a normal state, not an error to toast', () => {
  assert.equal(isVaultNotConfigured('Obsidian vault path not configured'), true)
  assert.equal(isVaultNotConfigured(new Error('Obsidian vault path not configured')), true)
  assert.equal(isVaultNotConfigured('Vault path not found'), false)
  assert.equal(isVaultNotConfigured('Todoist API token not configured'), false)
})
```

Run: `cargo test --offline -p nimble-core --lib db::settings` and `cd apps/desktop && node --test tests/setupGate.test.mjs tests/errors.test.mjs`
Expected: FAIL.

- [ ] **Step 2: Empty the gate.** `nimble-core/src/db/settings.rs`:

```rust
/// Settings the app needs before it runs: none since brief phase 2
/// (addendum §3). Every integration is optional and degrades on its own —
/// no Todoist token, no sync; no vault, no vault box; no AI key, a
/// rule-based brief. The Today setup (`today.setup_completed_at`) is the
/// onboarding now. Pinned to `lib/setupGate.ts` by tests/setupGate.test.mjs.
const REQUIRED_SETTINGS: &[&str] = &[];
```

`apps/desktop/src/lib/setupGate.ts` becomes:

```ts
/* The first-run gate, emptied in brief phase 2 (addendum §3): nothing is
   required before the app runs; the Today setup is the onboarding.
   tests/setupGate.test.mjs pins this to REQUIRED_SETTINGS in
   nimble-core/src/db/settings.rs so neither list grows back alone. */
export const SETUP_REQUIRED_KEYS: readonly string[] = []
```

`apps/desktop/src/lib/errors.ts` (after `isMissingTodayNote`):

```ts
/** Rust's vault commands reject with "Obsidian vault path not configured"
 * when no vault is set: a normal state since the setup gate went away
 * (brief phase 2). Callers show "no daily note", never an error toast. */
export function isVaultNotConfigured(raw: unknown): boolean {
  return /vault path not configured/i.test(String(raw))
}
```

`apps/desktop/src/hooks/useObsidian.ts`: import it and change the first catch branch to `if (isMissingTodayNote(e) || isVaultNotConfigured(e)) {`.

- [ ] **Step 3: Drop the dialog.** Delete `apps/desktop/src/components/setup/SetupDialog.tsx`. In `App.tsx`, remove its import and the `// Needs setup` branch (`if (!setupComplete) { … }`), and keep the `setupComplete === null` loading state. In `SettingsPage.tsx` `handleReset`, replace `setSetupComplete(false)` with:

```tsx
      // Reset clears today.setup_completed_at too: reload the brief settings
      // and land on Today, where the setup opens (addendum §3).
      await useBriefSettingsStore.getState().load(true)
      useAppStore.getState().setCurrentPage('today')
```

(Import `useBriefSettingsStore`. If `setSetupComplete` is no longer used, drop the selector and `handleReset`'s dependency on it.)

- [ ] **Step 4: Verify**

Run: `cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED"`, then `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build && npm run build:web && npx eslint src 2>&1 | tail -1 && grep -rn "SetupDialog\|isSetupReady" src ../../tools || echo "no references left"`
Expected: pass, lint ≤ `LINT_BASELINE`, and "no references left".

- [ ] **Step 5: Commit**

```bash
git add -A nimble-core/src/db/settings.rs apps/desktop/src apps/desktop/tests
git commit -m "feat(brief): drop the all-required setup gate; a missing vault path no longer toasts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 10: E2E + axe on a frozen build, full verification, and the phase-2 exit tests

**Files:**
- Create: `apps/desktop/e2e/b2-brief-phase2.spec.ts`
- Modify: `tools/mock-tauri.js` (add an unknown box to one past brief, for AC10)

**Interfaces:**
- Consumes: everything above; mock switches `?setup=fresh`, `?weather=fresh|stale|none|unavailable`, `window.__MOCK_BRIEF_SETTINGS__` (Tasks 2–3); the markup contracts `[data-brief-body]` (region "Today's brief"), `[data-brief-strip]`, `[data-setup-preview]`, `[data-box-row="<id>"]`, list "Boxes", chip button name `/^Weather:/`.
- Produces: the acceptance evidence for phase 2 (automated), plus the real-app checklist Marco runs after install.

- [ ] **Step 1: Mock fixture for AC10.** In `tools/mock-tauri.js`, change the `'2026-07-31'` brief's `layout` to `['schedule', 'priorities', 'due_today', 'still_open', 'vault', 'quick_wins']`. It stays a phase-1-shaped row (string ids) and gains one id this build doesn't know.

- [ ] **Step 2: Write the spec** `apps/desktop/e2e/b2-brief-phase2.spec.ts`:

```ts
/*
 * B2 — Morning brief phase 2: registry, settings, setup, weather.
 * Plan: docs/superpowers/plans/2026-09-25-brief-phase-2.md (Task 10).
 *
 * Mock switches (tools/mock-tauri.js): ?setup=fresh (never set up, no
 * location), ?weather=fresh|stale|none|unavailable, and
 * window.__MOCK_BRIEF_SETTINGS__ (read on the first brief_settings_* call).
 * The clock is pinned to the mock's TODAY (2026-08-01 07:00) so the weather
 * forecast and events line up.
 *
 * Run (frozen build only):
 *   tools/qa-frozen.sh <sha> /private/tmp/claude-501/qa-b2 4620
 *   BASE_URL=http://localhost:4620 npx playwright test -c e2e e2e/b2-brief-phase2.spec.ts
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

type Call = { cmd: string; args: Record<string, unknown> | undefined }
type Entry = { id: string; enabled: boolean; config?: Record<string, unknown> }
const MOCK_NOW = new Date('2026-08-01T07:00:00')

/** Open a page with every invoke recorded, the clock pinned and optional brief settings seeded. */
async function openWithSpy(app: App, page: Page, pageId: string, opts: { query?: string; seed?: Record<string, unknown> } = {}) {
  await page.clock.setFixedTime(MOCK_NOW)
  await page.addInitScript((seed) => {
    const w = window as unknown as {
      __MOCK_BRIEF_SETTINGS__?: unknown
      __calls: { cmd: string; args: unknown }[]
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown> }
    }
    if (seed) w.__MOCK_BRIEF_SETTINGS__ = seed
    w.__calls = []
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, o) => {
      w.__calls.push({ cmd, args })
      return orig(cmd, args, o)
    }
  }, opts.seed ?? null)
  await app.open(pageId, opts.query ?? '')
}

async function calls(page: Page, cmd: string): Promise<Call[]> {
  const all = await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
  return all.filter((c) => c.cmd === cmd)
}

async function lastSavedModules(page: Page): Promise<Entry[] | undefined> {
  const saves = await calls(page, 'brief_settings_save')
  return (saves.at(-1)?.args?.patch as { modules?: Entry[] } | undefined)?.modules
}

const briefBody = (page: Page) => page.getByRole('region', { name: "Today's brief" })
const chip = (page: Page) => page.getByRole('button', { name: /^Weather:/ })
const titles = async (scope: Locator) => (await scope.locator('h2, h3').allInnerTexts()).map((t) => t.replace(/\s*\d+\s*$/, '').trim())

test.describe('B2 brief phase 2', () => {
  test('AC1 Today renders the saved box order and leaves hidden boxes out', async ({ app, page }) => {
    const modules: Entry[] = [
      { id: 'due_today', enabled: true }, { id: 'schedule', enabled: true },
      { id: 'still_open', enabled: false }, { id: 'priorities', enabled: true },
    ]
    await openWithSpy(app, page, 'today', { seed: { modules } })
    const names = await titles(briefBody(page))
    expect(names.slice(0, 3)).toEqual(['Due today', 'Schedule', 'Top priorities'])
    expect(names).not.toContain('Still open')
  })

  test('AC2 the weather chip: high/low + rain chance; Enter opens place, hours, rain note, attribution', async ({ app, page }) => {
    await openWithSpy(app, page, 'today')
    await expect(chip(page)).toContainText('70°/57° · 60%')
    await chip(page).focus()
    await expectFocusRing(page)
    await page.keyboard.press('Enter')
    const pop = page.getByRole('dialog')
    await expect(pop).toContainText('San Francisco, California')
    await expect(pop.getByRole('list', { name: 'Next hours' }).getByRole('listitem')).toHaveCount(4)
    await expect(pop).toContainText('Rain likely 7 pm to 10 pm')
    await expect(pop).toContainText('Rain likely during Turnstile @ The Warfield — photo pass (7:00)')
    await expect(pop).toContainText(/as of \d{1,2}:\d{2} · Open-Meteo/)
    await expectNoClipping(pop, { allowEllipsis: true })
    await expectNoNewAxeViolations(page, 'today:weather')
  })

  test('AC3a offline shows the last forecast "as of"', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'weather=stale' })
    await expect(chip(page)).toContainText(/as of \d{1,2}:\d{2}/)
  })

  test('AC3b no location offers Add location, which opens Settings → Location & weather', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'weather=none' })
    await page.getByRole('button', { name: 'Add location' }).click()
    await expect(page.locator('#today-location')).toBeInViewport()
  })

  test('AC4 compact (b) moves the chip into the strip; one chip at a time', async ({ app, page }) => {
    await openWithSpy(app, page, 'today')
    await expect(chip(page)).toBeVisible()
    await page.keyboard.press('b')
    const strip = page.locator('[data-brief-strip]')
    await expect(strip.getByRole('button', { name: /^Weather:/ })).toBeVisible()
    await expect(chip(page)).toHaveCount(1)
    await expect(strip).toContainText('Next:')
    await expectNoClipping(strip, { allowEllipsis: true })
  })

  test('AC5 Settings → Today & brief: three sections; Boxes toggles and ⌥↓ save and keep focus', async ({ app, page }) => {
    await openWithSpy(app, page, 'settings', { query: 'settings=brief' })
    for (const name of ['Brief', 'Location & weather', 'Boxes']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    const list = page.getByRole('list', { name: 'Boxes' })
    await expect(list.locator('[data-box-row="weather"]')).toContainText('Weather chip')
    await list.getByRole('switch', { name: 'Show Still open' }).click()
    await expect.poll(async () => (await lastSavedModules(page))?.find((m) => m.id === 'still_open')?.enabled).toBe(false)
    await list.locator('[data-box-row="schedule"]').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(async () => (await lastSavedModules(page))?.map((m) => m.id).slice(0, 3)).toEqual(['weather', 'priorities', 'schedule'])
    await expect(list.locator('[data-box-row="schedule"]')).toBeFocused()
    await expectFocusRing(page)
    await list.getByRole('button', { name: 'Still open options' }).click()
    await list.getByRole('radio', { name: '10' }).or(list.getByRole('button', { name: '10', exact: true })).click()
    await expect.poll(async () => (await lastSavedModules(page))?.find((m) => m.id === 'still_open')?.config).toEqual({ count: 10 })
    await expectNoNewAxeViolations(page, 'settings:brief')
  })

  test('AC6 rapid Boxes changes: the last save equals the last visible state', async ({ app, page }) => {
    await openWithSpy(app, page, 'settings', { query: 'settings=brief' })
    const list = page.getByRole('list', { name: 'Boxes' })
    await list.getByRole('switch', { name: 'Show Still open' }).click()
    await list.locator('[data-box-row="schedule"]').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await list.getByRole('switch', { name: 'Show Notes' }).click()
    await expect.poll(async () => {
      const m = await lastSavedModules(page)
      return m && { order: m.map((x) => x.id).slice(0, 3), still: m.find((x) => x.id === 'still_open')?.enabled, notes: m.find((x) => x.id === 'notes')?.enabled }
    }).toEqual({ order: ['weather', 'priorities', 'schedule'], still: false, notes: true })
    const visible = await list.locator('[data-box-row]').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.boxRow))
    expect(visible.slice(0, 3)).toEqual(['weather', 'priorities', 'schedule'])
  })

  test('AC7 exit test: a fresh profile sees setup once, ↵ ×6 finishes in under 60 s and lands on a working brief', async ({ app, page }) => {
    const started = Date.now()
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    for (let n = 1; n <= 6; n++) {
      await expect(page.getByText(`Step ${n} of 6`)).toBeVisible()
      await page.keyboard.press('Enter')
    }
    await expect(briefBody(page)).toBeVisible()
    await expect(briefBody(page)).toBeFocused()
    expect(Date.now() - started).toBeLessThan(60_000)
    const saves = await calls(page, 'brief_settings_save')
    expect(saves).toHaveLength(1)
    expect(saves[0].args?.patch).toMatchObject({ complete_setup: true, time: '06:30', location: null, goals: { daily: 5, weekly: 25, days_off: ['sat', 'sun'] } })
    await expect(page.getByRole('button', { name: 'Add location' })).toBeVisible()
    await page.reload()
    await expect(page.getByText(/Step \d of 6/)).toHaveCount(0)
  })

  test('AC8 Enter in the city search picks a city and stays; Esc then skips and keeps it', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    await page.keyboard.press('Enter')
    await expect(page.getByText('Step 2 of 6')).toBeVisible()
    const search = page.getByRole('combobox', { name: 'Search for a city' })
    await search.fill('San')
    await expect(page.getByRole('option', { name: /San Francisco/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Step 2 of 6')).toBeVisible()
    await expect(page.getByText('San Francisco, California', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(briefBody(page)).toBeVisible()
    const saves = await calls(page, 'brief_settings_save')
    expect(saves).toHaveLength(1)
    expect(saves[0].args?.patch).toMatchObject({ complete_setup: true, location: { name: 'San Francisco, California', tz: 'America/Los_Angeles' } })
  })

  test('AC9 the preview follows the draft: Minimal drops Top priorities', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    const preview = page.locator('[data-setup-preview]')
    await expect.poll(async () => titles(preview)).toContain('Top priorities')
    await page.getByRole('button', { name: /^Minimal/ }).click()
    await expect.poll(async () => titles(preview)).not.toContain('Top priorities')
    expect(await titles(preview)).toContain('Schedule')
    await expect(page.getByText('Step 1 of 6')).toBeVisible()
  })

  test('AC10 a phase-1 past brief still renders; an unknown box shows the Mac placeholder', async ({ app, page }) => {
    await openWithSpy(app, page, 'today')
    await page.keyboard.press('[')
    await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible()
    await expect(page.getByText('Open in Nimble for Mac to see this box.')).toBeVisible()
  })

  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme })
      test(`AC11 setup: axe, no clipping, focus ring on controls (${theme})`, async ({ app, page }) => {
        await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
        const panel = page.getByRole('region', { name: 'Choose a starting layout' })
        await expect(panel).toBeVisible()
        await expectNoClipping(panel, { allowEllipsis: true })
        await page.keyboard.press('Tab')
        await expectFocusRing(page)
        await expectNoNewAxeViolations(page, 'today:setup')
      })
      test(`AC12 Settings → Today & brief passes axe (${theme})`, async ({ app, page }) => {
        await openWithSpy(app, page, 'settings', { query: 'settings=brief' })
        await expect(page.getByRole('list', { name: 'Boxes' })).toBeVisible()
        await expectNoNewAxeViolations(page, 'settings:brief')
      })
    })
  }

  test('AC13 a narrow Today column hides the preview and keeps the step usable (UX checkpoint 3)', async ({ app, page }) => {
    await page.setViewportSize({ width: 1024, height: 700 })
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    await expect(page.getByText('Step 1 of 6')).toBeVisible()
    // The rule is the container width (46rem = 736px), not the viewport:
    // the nav and right rail decide how wide the Today column is.
    const width = await page.locator('section[aria-labelledby="today-setup-title"]').evaluate((el) => el.getBoundingClientRect().width)
    if (width < 736) await expect(page.locator('[data-setup-preview]')).toBeHidden()
    else await expect(page.locator('[data-setup-preview]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeInViewport()
    await expectNoClipping(page.locator('section[aria-labelledby="today-setup-title"]'), { allowEllipsis: true })
  })
})
```

Notes for the implementer:
- `section[aria-labelledby]` exposes the setup as a region named by the step heading (`today-setup-title`), which is why AC11's `panel` locator works. If WebKit doesn't expose it, use `page.locator('section[aria-labelledby="today-setup-title"]')`.
- Base UI `ToggleGroupItem` renders a `button` with `aria-pressed`, so AC5's `.or(...)` covers both roles.
- The new axe keys (`today:weather`, `today:setup`, `settings:brief`) have no baseline, so any violation fails. Fix the markup. Never record a baseline for them.

- [ ] **Step 3: Full verification** (from the lane worktree):

```bash
cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked"
cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3
npm run build && npm run build:web
npx eslint src 2>&1 | tail -1          # ≤ LINT_BASELINE
cd ../.. && git add -A tools/mock-tauri.js apps/desktop/e2e && git commit -m "test(brief): phase-2 e2e — registry order, weather chip, Boxes, setup exit test, axe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
tools/qa-frozen.sh $(git rev-parse HEAD) /private/tmp/claude-501/qa-b2 4620
cd apps/desktop && BASE_URL=http://localhost:4620 npx playwright test -c e2e
```

Expected: Rust all pass (≈600+ tests); node tests all pass; both builds green; lint ≤ baseline; Playwright passes the whole suite (the existing specs plus B2's). Record the counts in the ledger. Then `kill $(cat /private/tmp/claude-501/qa-b2/preview.pid)`.

- [ ] **Step 4: Grep audits (paste the output into the ledger)**

```bash
grep -rn "schema-v25" nimble-core | wc -l                              # every v25 site is marked (≥ 10)
grep -rn "module_cache" nimble-core/src/db/sync.rs                     # only the never-syncs test
grep -rnE "reqwest::(get|Client).*open-meteo|format!\(.*open-meteo" nimble-core/src   # nothing: URLs only via Url::parse
grep -rnE "overdue|streak|you've been away" apps/desktop/src/components/today apps/desktop/src/components/settings/{TodayBrief,BriefLocation,BriefBoxes}Settings.tsx   # nothing
grep -rn "from '@/services/tauri'" apps/desktop/src/components | grep -v CaptureStrip   # nothing
```

- [ ] **Step 5: Real-app exit tests (Marco, after `npm run update-app`; the plan's final gate).** Add these to the ledger as unchecked items for Marco:
  1. **Base §5 phase 2 exit test.** Settings → General → Demo mode on (the app restarts on a blank profile). Today opens on "Step 1 of 6". Press Esc, or ↵ six times, and time it: under 60 s, landing on a working brief (Schedule, Top priorities with the calm no-key line, Due today, Still open, and "Add location").
  2. Demo off. Today opens on the setup **once** (Marco's real profile has no `today.setup_completed_at`). Pick San Francisco on step 2, then Finish. The chip shows today's high/low, and clicking it shows the hours, any rain notes and "as of · Open-Meteo".
  3. Offline "as of": with the location set and the chip loaded, run `sqlite3 ~/Library/Application\ Support/com.marcosevilla.daily-triage/nimble.db "UPDATE module_cache SET fetched_at='2026-01-01T00:00:00Z'"`, turn Wi-Fi off, and focus the window. The chip keeps the forecast and adds "· as of 4:00" (local time of the stored stamp).
  4. Settings → Today & brief: drag Schedule below Due today and turn on Notes. Today follows at once, and tomorrow's snapshot records that order (`[` the day after).
  5. `b` compacts: the chip moves into the strip. `b` again: it's back in the header.
  6. With no vault path set (demo), Today, Inbox and Docs show no error toast.
  7. **Rebuild `dt`** (schema 25 is pinned exactly in `tools/dt/src/profile.rs`; the old `dt` refuses a v25 database): `cargo build --release --offline -p nimble-cli && cp ~/.local/bin/dt ~/.local/bin/dt.bak-$(git rev-parse --short HEAD) && cp target/release/dt ~/.local/bin/dt`, then `dt --json --help` succeeds.
  8. Turso: nothing new syncs from phase 2 except `briefs.notes` (the existing v23 gate covers the table). `module_cache` never reaches Turso: after a sync, `SELECT name FROM sqlite_master WHERE name='module_cache'` on Turso returns no rows.

- [ ] **Step 6: Commit the ledger / evidence** (the spec was committed in Step 3; the wrap edits `NEXT.md`, not this plan).

---

## Self-review (run 2026-09-25)

**Spec coverage (addendum §1–§4 and base §3.4/§5 phase 2):**

| Requirement | Task |
|---|---|
| §1 Rust `nimble-core/src/brief/` registry: trait, manifest, ConfigField {Bool, Choice, Label}, modules, gather moved out of `db/briefs.rs` | 1 (weather in 3) |
| §1 Registered modules + per-module config defaults | 1, 3 |
| §1 Layout from `brief.modules`: unknown skipped, missing appended, `layout_json` records the layout used | 1 |
| §1 Frontend registry `briefModules.tsx`, TodayPage renders enabled modules in order, unknown id → "Open in Nimble for Mac" | 5 |
| §2 Keys `brief.time/location/modules/model/effort`, `today.setup_completed_at`, `goals.daily/weekly/days_off` (not `momentum.*`/`karma.*`) | 2 |
| §2 Brief section (time, model + effort, no-key note, Run setup again) | 6, 8 |
| §2 Location & weather (city search via Rust, units, rain notes, Open-Meteo CC BY 4.0) | 6 |
| §2 Boxes (sortable, ⌥↑/↓, show/hide, chevron options from config_schema, "Weather chip") | 7 |
| §2 SettingFieldRow reuse, ui/*, 720 measure; Goals & momentum left to Lane C with a mount contract | 6 |
| §3 Setup: first visit when null, Run setup again, full takeover, live preview, 6 steps, Step n of 6 / Skip / Back, ↵/Esc, one save | 8 |
| §3 Gate removal + per-feature degradation | 9 |
| §3 / base §5 exit test (fresh demo, skip every step < 60 s) | 10 (AC7 + real-app 1) |
| §4 WeatherProvider + OpenMeteo forecast & geocoding, units | 3, 4 |
| §4 v25 device-local `module_cache`, 60-min freshness, offline "as of", no location → "Add location" | 3, 4 |
| §4 Chip (full + compact strip), popover with 4 hourly points, rain window, rain notes (≥50%), attribution | 4, 5 |
| §4 Snapshot stores that morning's forecast | 3 |
| A1 ⋯ → Customize… opens `openSettings('today-brief')` | 5 |
| Base §5 phase 2: "Setting San Francisco shows weather"; "network off → as of" | 10 (AC2, AC3, real-app 2–3) |

No gaps found. Phase 3 items (composition, `brief_items`, Regenerate, quick wins) and phase 4 items (momentum box, Goals & momentum section) are deliberately absent.
