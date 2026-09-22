# Todoist Replacement — Locked Decisions

**Date:** 2026-08-25
**Supersedes the phase plan in:** `docs/todoist-replacement-analysis.md` §5 (the analysis itself still stands)
**Status:** decisions remain locked. The August assessment below is historical. As of 2026-09-21, C1 is complete; C2/C3 are implemented and installed with live activation gates remaining. Google connection/first sync and Mac banner passed; phone/two-way and agent-routing/web acceptance remain open. C4 and C5 are next. Current priorities: [NEXT.md](../NEXT.md); evidence: [combined verification](c2-c3-verification.md).

The 2026-08-09 analysis is still correct about the *gaps*. Its R1–R5 phase plan is stale
because R1 shipped, R2 half-shipped, and the mobile premise changed. This document records
what was decided on 2026-08-25 and renames the remaining work C1–C5 to avoid confusion with
the old numbering still visible in Todoist.

---

## 1. Where things actually stand

| Old phase | Todoist says | Reality as of 2026-08-25 |
|---|---|---|
| R1 — schema v19 parity | open | **Code merged** (`ea69406`, prod migrated, 844 tasks). Labels, sections, `due_time`, `duration_minutes`, `recurrence_rule` + engine, `projects.parent_id` all live. **Exit test never run** — recurrence has unit tests and a TS differential port but has never fired on a real task. 11 soak follow-ups open. |
| R2 — reliability | open | **Half done.** Sync hardening shipped (`e467853`), including the `INSERT OR REPLACE` + `ON DELETE CASCADE` bug that could wipe a project's tasks on other devices. Backup, export, and `sync_log` pruning **not started** — this is the real gate on cutover. |
| R3 — agent access | open | **Not started.** No `tools/dt`, no bin target; `nimble-core` is lib-only. |
| R4 — mobile parity | open | **Premise changed.** `apps/mobile` is dormant and unplugged from workspaces; its DataProvider is missing whole domains and every v19 field. The web client passed a live phone test on 2026-08-19 (login, capture, status change round-tripped). |
| R5 — import/soak/cutover | open | Correctly blocked. R1 clears; R2 does not. |
| R6 — focus queue | open | Real work, but not on this critical path. Out of scope here. |

Testing baseline: `nimble-core` has ~225 Rust tests. The frontend has zero and no runner.

## 2. Gaps the old plan did not cover

1. **No notification code exists anywhere** (`grep -ril notification apps/desktop/src` → empty), yet the EDD certification task carries a 30-min-before reminder and real financial consequences.
2. **Labels shipped flat.** `labels` is `(id, name, color, position)` — no group column, no grouping in `LabelPicker.tsx`. The real system is 27 labels across ENERGY / TIME / TYPE / CREATIVE.
3. **Search is weaker than it appears.** `CommandBar.tsx:272` substring-matches already-loaded, non-completed task *titles* only. No descriptions, no completed tasks, no index — despite v18 shipping FTS5 infra for the vault.
4. **Exit tests unrun** for both R1 (recurrence twice in a row) and R2 (delete → restore → diff clean).
5. **No un-cutover plan.** R5 said "cancel subscription."
6. **CLI/app coherence and R6's cross-window problem are the same problem** (`emitTasksChanged()` is an in-process JS bus). One mechanism should serve both.

## 3. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Web client is the mobile story.** `apps/mobile` stays archived, not deleted. Revisit native only if the soak surfaces a real phone gap. | Expo drifted badly; the web client already round-tripped on the phone. One codebase, one DataProvider. |
| D2 | **Agent access is a local `dt` CLI** — a Rust bin in the workspace over `nimble-core`. | Writes fire the sync observer, Todoist outbox and `sync_log` by construction. A Turso-backed remote surface can come after cutover, when the outbox no longer matters. |
| D3 | **Reminders are a real phase before cutover**, not a deferrable R4 line item. | Cutting over without an alert path on the EDD task is not honest. |
| D4 | **Marco designs in Figma; Claude specs and builds.** | The taste decisions stay with Marco; agents do that part worst. |
| D5 | **Scope = minimum honest path off Todoist, plus two deliberate adds:** label groups and task FTS search. Everything else (R6 focus queue, polish passes) is explicitly out. | ~33–35h against an active job hunt. The two adds were opted into with eyes open (+~7h). |
| D6 | **Two parallel tracks.** Code track (Claude) and design track (Marco) run concurrently and converge at the soak. | Design no longer blocks on code finishing. |
| D7 | **Restore the label taxonomy** — add `labels.group` in schema v20, backfill from existing emoji prefixes, render a grouped picker with group-scoped filtering. | The grouping *is* the ADHD workflow; flattening it lost the point. |
| D8 | **Build real task search** — device-local FTS5 over content + description including completed tasks, exposed in CommandBar and `dt task search`. | The analysis predicted this would be "missed silently" after cutover. `vault/index.rs` already proves the pattern. |
| D9 | **Backups = SQLite snapshots + nightly JSON export committed to a private git repo.** | Snapshots give fast restore; git gives free offsite, readable diffs, and a grep-able archive. Todoist was the implicit offsite backup. |
| D10 | **Reminders reach the phone via proper Google Calendar OAuth**, not an ICS subscription feed. Desktop notifications with catch-up-on-wake handle same-day. | *Decided against the cheaper option.* Subscribed-calendar refresh latency is unacceptable for a trust-critical alert. Costs ~4h instead of ~2h. |
| D11 | **Import scope = active tasks + last 12 months completed.** Full 2023-onward history stays in the final Todoist JSON export, committed to the backup repo as a cold archive. | Keeps the working set and search results relevant without losing the history. |
| D12 | **`dt` writes refresh a running app instantly** via a local socket → Rust `app.emit` → `emitTasksChanged()`. | Same mechanism R6's companion window needs. One solution, not two. |
| D13 | **Downgrade Todoist to free at cutover — never cancel. And not yet.** | Cancelling is a one-way door on 15 years of history. Free tier keeps a read-only fossil and a six-month escape hatch at zero cost. |

## 4. The code track

| Phase | Scope | Est |
|---|---|---|
| **C1 — Safety net** | `db/backup.rs` (`VACUUM INTO` snapshots, 14 daily + 8 weekly retention); `db/export.rs` (full JSON, stable key ordering for readable diffs); nightly commit to `~/Nimble-backups/`; `sync_log` pruning; Settings surface (last backup, last export commit, unsynced count, conflict log). | ~6h |
| **C2 — Reminders** | Schema v20 (`local_tasks.reminder_offset_minutes` + `labels.group`, one migration); `nimble-core/src/reminders.rs` as a pure clock-free scheduler; 60s tick + `tauri-plugin-notification`; `last_fired_at` persistence (no double-fire, no drop); catch-up card for reminders missed while asleep; **Google Calendar OAuth two-way for timed tasks**. | ~11h |
| **C3 — `dt` CLI** | `tools/dt/` Rust bin over `nimble-core`; `--json` everywhere; task/project/section/label/capture/activity/backup/sync/gap commands; all writes through `nimble-core::db::*` CRUD, never raw SQL; live-refresh socket at `$TMPDIR/nimble.sock`; repoint `/td`, `/task-assist`, `/brief`, `/admin` with Todoist as soak-period fallback. | ~8h |
| **C4 — Labels + search** | Backfill `labels.group` from emoji prefixes; `tasks_fts` FTS5 (device-local, unsynced, same pattern as `vault_fts`); wire into CommandBar `/search` and `dt task search`. | ~7h |
| **C5 — Import, soak, cutover** | Upgrade `todoist_migration.rs` so labels/sections/recurrence/duration/due-time/nesting land in first-class fields instead of flattened description text; import per D11; `dt gap "reason"` soak instrumentation; cutover checklist per D13. | ~5h + 2–4wk soak |

Order: C1 → C2 → C3 → C4 → C5. C1 first because it is the gate and it is small.

### Exit tests

- **C1** — move `nimble.db` aside, restore from snapshot, re-export; byte-identical to the pre-delete export.
- **C2** — task due in 3 min with a 2-min reminder fires; quit before it fires and reopen after → catch-up card appears; EDD task lands in Google Calendar with a 30-min alarm.
- **C3** — `/td` files a parent + 3 subtasks with labels and a due date; visible in the running app within a second and on the web client within 5 min.
- **C5** — two consecutive weeks with Todoist unopened, backup diffs clean, completion count within the 20–45/wk band, `dt gap` log empty.
- **Carried from R1 (still unrun)** — the EDD task recurs correctly, every 2 weeks at 09:00, twice in a row.

## 5. The design track (Marco, Figma)

Seven surfaces, priority order:

1. **Task detail with inline field editors** — the headline fix. `TaskDetailPage.tsx` (626 lines) renders a task but has no field editors; editing a due date today means checkbox → bulk bar → Edit. Where do due date, time, duration, priority, labels, section and recurrence live and get edited?
2. **Grouped label picker** — 27 labels, 4 groups, keyboard-first, used in detail and quick-create.
3. **Row metadata chips** — a row carrying label + time + duration + recurrence without becoming noise (`MetadataChips.tsx` is already 532 lines).
4. **Recurrence control** — 6 patterns, not RFC 5545. What "every 2 weeks at 9am" looks like.
5. **Section lanes** in a project view — does `SectionedTaskList.tsx` match the ad-hoc Todoist lanes?
6. **Reminder affordance** — where "30 min before" lives.
7. **Search results** — tasks + docs + captures in one list, completed visually distinct.

A full brief with current-state screenshots follows once the spec is written.

## 6. Orchestration model

Opus holds architecture, the spec, and every diff touching sync or merge semantics. Sonnet
subagents implement one plan task each under TDD, with `nimble-core`'s ~225 Rust tests as the
objective gate. Haiku/researcher agents handle doc reads, grep sweeps and status checks.
Nothing merges without `cargo test --workspace` and `npm run build` passing.

## 7. Explicitly out of scope

Saved filters and query language · collaboration and assignees · comments and attachments ·
location reminders · karma and streaks (anti-goal) · calendar layout view · templates ·
webhooks · R6 focus queue merge · native mobile revival.

Per the analysis: the moment this grows a filter query language, it has become
tool-building-as-avoidance.
