# Todoist Replacement Analysis

**Date:** 2026-08-09
**Question:** What would it take for nimble to completely replace Todoist as the source of truth for all tasks?
**Sources:** Live Todoist API audit (2026-08-09), codebase inventory (schema v18, main @ 3d3e23f), buildplan.md / roadmap.md / SDD ledger.

---

## TL;DR

**The gap is smaller than "rebuild Todoist" — because you use a small slice of Todoist.** You have 2 recurring tasks, zero saved filters, zero collaboration, and no comments/attachments in use. What you *do* lean on: projects + sections, a curated 27-label system, priorities, durations, markdown-rich descriptions, subtasks, and Claude writing to Todoist via MCP.

What's already built is the *hard* part: a two-way Todoist sync engine with per-field three-way merge, a Turso multi-device sync layer, a one-time migration tool, and a capture flow that's already better than Todoist's.

The blocking gaps, in order of how much they block "source of truth":

1. **Task data model parity** — no labels, no recurrence, no due times, no durations in `local_tasks`
2. **Agent access (MCP/CLI)** — your Claude ecosystem (/brief, /td, /task-assist, /admin) writes to Todoist; nothing can safely write to the app
3. **Reliability plumbing** — no backups, no export, known sync-hardening debt
4. **Notifications/reminders** — roadmapped (E2), not built
5. **Mobile parity** — capture works; editing doesn't (no due/priority/label editing, no subtasks)

Estimated total: **~35–50 focused hours** across 5 phases, with a low-risk gradual cutover because the two-way sync means you never have to jump.

---

## 1. The bar: how you actually use Todoist (measured, not assumed)

| Feature | Your usage | Verdict |
|---|---|---|
| Projects | 18 active, 2-level nesting (Personal → 7 children) | Must have (nesting: nice-to-have) |
| Sections | 23, used as workflow lanes ("🔥 This week", "💬 waiting on you") | Must have *an equivalent* |
| Priorities | All 4 levels in active use | Must have ✓ already built |
| Labels | 27-label curated system: ENERGY / TIME / TYPE / CREATIVE groups | **Must have — core ADHD workflow** |
| Durations | Common (10m/15m/30m/1h) | Must have |
| Descriptions | Heavy, long-form markdown with links — tasks-as-documents | Must have |
| Subtasks | Common, 1 level; parent-task-as-folder pattern | Must have ✓ already built |
| Recurrence | **Only 2 active recurring tasks** ("every month" loans, "every 2 weeks @ 09:00" EDD) | Must have, but *minimal* patterns |
| Due dates | Minority of tasks; mostly day-granularity | Must have ✓ already built |
| Due times + reminders | Rare but critical (EDD cert has 30-min-before relative reminder) | Must have |
| Saved filters | **Zero** | Not needed |
| Collaboration | **None** | Not needed |
| Comments/attachments | None observed | Not needed |
| Karma/streaks | On, but antithetical to no-guilt design | Deliberately dropped |
| Agent/MCP writes | Heavy — Claude skills read/write Todoist constantly | **Must have** |
| Completion cadence | ~20–45 tasks/week; 2,490 lifetime; backlog tail to 2023 | Informs migration scale |

## 2. What's already built (the head start)

- **Two-way Todoist sync** — poll-based (300s), incremental sync token, outbox pattern, per-field three-way merge against `synced_snapshot`, LWW on true conflicts (`nimble-core/src/integrations/todoist/`). This is the single hardest piece of a gradual migration and it exists.
- **Multi-device sync** — Turso/libSQL with device-tagged `sync_log`, desktop + mobile.
- **One-time migration tool** — `todoist_migration.rs` imports Todoist tasks (flattens labels/recurrence into description text — needs upgrading, see gaps).
- **Task CRUD + status workflow** — `backlog→todo→in_progress→blocked→complete` (richer than Todoist), priorities, subtasks, drag reorder, Cmd+K, quick-create.
- **Capture** — ⌥⌘Space global capture strip with source context + prefix routing → Inbox → convert-to-task. Better than Todoist quick-add for your workflow.
- **Local-first SQLite** — the right foundation for "reliable source of data."

## 3. Gap analysis

### Gap 1 — Task data model parity 🔴 (blocks everything downstream)

`local_tasks` has no columns for labels, recurrence, due time, or duration. The migration tool literally flattens labels and recurrence into description *text* — lossy, non-queryable.

Needed (schema v19):
- `task_labels` join table (or `labels` TEXT JSON) + label management UI + label filtering
- `due_time` (or widen `due_date` to full timestamp + `all_day` flag)
- `duration_minutes`
- `recurrence_rule` (store the human string + parsed rule) + **on-complete reschedule engine**. Scope honestly: you need "every month", "every N weeks @ time", "every day" — not RFC 5545. ~6 patterns covers you with room.
- Sections equivalent: cheapest honest answer is per-project **sections table** (id, project_id, name, position) + `section_id` on tasks; alternative is leaning on status lanes + labels, but your Todoist behavior (ad-hoc lanes like "🔴 before friday") says you'll want real sections.
- Project `parent_id` for 2-level nesting (small; could defer with naming conventions)
- Sync: extend the Todoist merge to carry labels/duration/due-time both ways during the transition period (recurrence can stay one-way/manual — only 2 tasks)

### Gap 2 — Agent access 🔴 (the ecosystem linchpin)

Your Claude workflows are first-class Todoist citizens today: `/brief` reads overdue+today, `/td` files structured tasks, `/task-assist` writes results back, `/admin` sweeps deadlines. **"Source of truth" means these must point at the app** — and there is no safe write path: direct SQLite writes would bypass the observer/outbox/sync_log, silently breaking both Todoist and Turso sync.

Needed: a thin **CLI or MCP server over `nimble-core`** exposing: find/add/update/complete tasks, projects, labels, completed-activity queries (for /brief accountability). A CLI (`dt task add ...`) is the fastest path and Claude Code consumes CLIs natively; an MCP server is nicer for claude.ai/mobile. Either must route through the core lib so sync observers fire.

### Gap 3 — Reliability plumbing 🔴 ("reliable source of data" is the stated objective)

- **No backups** of task data. Todoist was implicitly your offsite backup; replacing it removes that safety net. Need: daily automated SQLite snapshot (local + offsite via Turso already helps) with retention.
- **No export** — roadmap backlog mentions CSV/JSON export; needed as a trust escape-hatch (data hostage-proofing).
- **Sync hardening debt** (from SDD ledger, deferred to "plan 3"): `sync_log` never pruned; mobile push is unchunked all-or-nothing (same bug shape as a fixed desktop issue); "first sync push slow."
- Conflict *visibility*: LWW is fine single-user, but silent merges need at least a log you can inspect when something looks off.

### Gap 4 — Notifications & reminders 🟡 (roadmapped E2, not built)

Buildplan E2 covers meeting alerts + evening nudge via `tauri-plugin-notification`, but **task reminders** (the "30 min before a timed task" Todoist behavior) aren't specified anywhere. Rare in your usage but the two cases that exist are the highest-stakes tasks you have (EDD certification, loans). Needs: relative reminders on timed tasks + a scheduler that survives app restarts. Mobile push notifications can come later (Expo), desktop-first is acceptable given usage.

### Gap 5 — Mobile parity 🟡

Mobile today: view projects/tasks, cycle status, inline create to inbox, quick capture, pull-to-refresh. Missing: edit due date/priority/labels, subtask UI, and the push-reliability fix. For a phone-in-hand triage moment ("add this with a date while walking"), creation-with-date matters more than full editing.

### Gap 6 — Smaller gaps 🟢

- **Global task search** — none today; vault FTS infra (v18) already exists to extend to tasks. Todoist search is something you'd miss silently.
- **Description format** — Tiptap HTML vs Todoist markdown. Matters for migration fidelity (your tasks-as-documents descriptions are heavily markdown) and for agent writes. **Decided 2026-08-09: Markdown is canonical** — implemented as R1 Task 12 (editor round-trips via tiptap-markdown, existing HTML backfilled).
- **Completed-task history** — `activity_log` exists; needs a query surface for /brief-style "what did I complete this week."
- **NL date parsing** ("tomorrow 3pm") — mentioned in linear-ux-patterns, never scheduled. Quality-of-life, not blocking; a date picker in quick-create is the honest MVP.

## 4. Explicitly not needed (don't build)

Saved filters/query language · collaboration/assignees · comments/attachments · location reminders · karma/streaks (anti-goal) · calendar layout view · templates · webhooks. Your measured usage says these are dead weight.

## 5. The trajectory: phased, no big-bang

The two-way sync engine means **Todoist can remain a live mirror while the app becomes primary**. You never jump; you shift weight.

### Phase R1 — Data model parity (~12–16h)
Schema v19 (labels, due_time, duration, recurrence_rule, sections, project nesting), recurrence reschedule engine, editing UI for the new fields, extend Todoist merge for labels/duration/due-time. Upgrade `todoist_migration.rs` to import labels/recurrence/durations into the new first-class fields.
**Exit test:** the EDD task lives natively — recurs every 2 weeks at 9am, correctly, twice in a row.

### Phase R2 — Reliability (~8–10h)
Automated daily backup + retention, JSON export command, `sync_log` pruning, chunked mobile push, sync-conflict log view in Settings.
**Exit test:** delete the local DB, restore from backup, diff clean. Kill the app mid-sync, no data loss.

### Phase R3 — Agent access (~6–10h)
`dt` CLI (or MCP server) over nimble-core: task/project/label CRUD + activity queries. Repoint `/td`, `/task-assist`, `/brief`, `/admin` skills at it (keep Todoist reads as fallback during transition).
**Exit test:** /td files a parent+subtasks into the app and it appears on mobile via Turso.

### Phase R4 — Mobile capture parity (~6–8h)
Create-with-date/priority/label on mobile, subtask display, notification for timed tasks (can defer).
**Exit test:** phone-only day doesn't make you reach for Todoist.

### Phase R5 — Migration & cutover (~4h + 2–4 week soak)
1. Full import via upgraded migration tool (backlog to 2023 included — import everything, it's your archive too).
2. **Soak period:** app is primary, two-way sync keeps Todoist mirrored. Any "I had to open Todoist for X" moment = a logged gap.
3. Cutover: disable push-to-Todoist, keep one final Todoist export as archive, cancel sync. Todoist becomes a read-only fossil.
**Success criteria:** 2 consecutive weeks where Todoist was never opened *and* nothing was lost (backup diffs + completed-count sanity check vs. your ~20–45/week cadence).

### Sequencing note
R1 → R2 → R3 is the critical path. R4 can interleave. Do **not** start R5's full import until R1 (else labels/recurrence flatten lossily) and R2 (else no safety net) are done.

## 6. Risks & honest caveats

- **Recurrence correctness is trust-critical.** A missed EDD certification has real financial consequences. Ship the engine with tests for its exact patterns, and during soak, keep those 2 tasks dual-homed in Todoist.
- **You are the on-call engineer now.** Todoist's value was 15 years of edge-case hardening + someone else's pager. Backups/export (R2) is what makes self-hosting your tasks acceptable — don't skip it because it's invisible work.
- **Notification delivery on macOS** (Focus modes, permission regressions after rebuilds) needs the same code-signing care the capture strip needed.
- **Scope discipline:** the "not needed" list (§4) is the guardrail. The moment R1 grows a filter query language, it's tool-building-as-avoidance.
