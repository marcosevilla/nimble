# Focus Queue → Nimble: integration plan

*Written 2026-08-20. Source project: `~/Developer/todoist-focus` (GitHub: `marcosevilla/todoist-focus`). Read `todoist-focus/docs/BUILD-STORY.md` for the history and `todoist-focus/CLAUDE.md` for the 19 gotchas.*

## Goal

Make the Focus Queue a native Nimble feature — a drag-sequenced queue of Nimble tasks, a big timer on the top one, time-spent recorded against the task, and an always-on-top companion window — so queueing works on tasks that live in Nimble, and Todoist stops being required. Long-term: migrate off Todoist entirely.

## The one-paragraph verdict

**Don't port the app. Merge two focus systems.** Nimble already has ~60% of this: `focusStore.ts` with wall-clock count-up/count-down/pomodoro, `FocusView.tsx` with a 48 px `--text-timer`, `FocusBanner` compact mode, `useFocusQueue`, `@dnd-kit` sortable lists, `duration_minutes` on every task, `focus.startSession/endSession` in the DataProvider, and an always-on-top `capture` window in `tauri.conf.json`. What Focus Queue adds that Nimble lacks is exactly four things: **(1) a user-sequenced, persisted queue** (Nimble's `useFocusQueue` auto-picks one "next task"), **(2) the timebox + amber→red ramp + chime**, **(3) time-spent surfaced on the task**, and **(4) a detachable always-on-top companion window with focus-view scaling.** Everything Todoist-specific in the old app (reconcile, retry, poll, API client, token gate, manual mode, ✦ copy-prompt in its current form) is either unnecessary in Nimble or already handled by Nimble's own sync layer.

---

## What carries over, what doesn't

| todoist-focus module | Fate in Nimble | Why |
|---|---|---|
| `logic/timer.ts` (wall-clock math, crash-safe heartbeat) | **Merge into `focusStore.ts`** | Nimble already does `startedAt`/`pausedElapsed`. Bring over the `lastTickAt` heartbeat + "resume paused on relaunch" rule (gotcha #4) — Nimble's `FocusResumeDialog` is the UI for it already. |
| `logic/focusView.ts` (scale/fit math) + `window/*` | **Port as-is** (pure TS, 100% tested) | Window physics are identical — same Tauri v2 + WKWebView. Gotchas #16–19 all apply. |
| Queue sequencing + `reconcile.ts` | **Rewrite the data model; drop the reconciler** | Reconcile merges a remote filter result with local order. In Nimble the queue is local-first SQLite — no server-vs-local merge. Keep only the *rule*: "local order wins; new tasks append; completed tasks leave." |
| Timebox picker, count-up color ramp, chime | **Port UI + rule** | Bind timebox to `LocalTask.duration_minutes` — Nimble already has the field; this gives it a purpose. |
| ⏱ time-spent comments | **Replace with sessions** | `focus.endSession(taskId, outcome, durationSecs)` already logs time. Add a `time_spent_secs` aggregate to task reads. No comments. |
| `retry.ts`, `sync/poll.ts`, `api/todoist.ts`, `TokenGate` | **Drop** | Nimble's Turso `sync_log` is the sync layer. |
| Manual mode | **Drop** | Every Nimble task is "manual" already — this was the prototype of what Nimble *is*. |
| Overdue drawer + "never auto-queue overdue" | **Keep the rule, reuse Nimble's overdue UI** | Gotcha #7 is about ADHD shame, not Todoist. |
| Quick-add | **Reuse Nimble's `CaptureStrip`/create flow** | Don't build a second composer. |
| ✦ copy-as-prompt | **Port, then upgrade** | Prompt includes a Nimble task ID instead of a Todoist one; the `task-assist` skill writes subtasks/notes via Nimble instead of the Todoist MCP (needs a Nimble MCP or CLI — roadmap, not phase 1). |
| Real Todoist completion sound | **Don't ship it** | It's Doist's asset. Synthesize Nimble's own ding (the chime is already synthesized — same Web Audio path). |
| Todoist color tokens | **Drop entirely** | See design section. |
| 115 Vitest tests | **Port the ones whose modules survive** (`timer`, `focusView`, `format`, `prompt`) | Nimble has **no test runner**. Bootstrapping Vitest is step 0 — the focus logic is the best-tested code in either repo and is the right seed. |

---

## Data model

Two additions to `nimble-core/src/types.rs` + a migration. Keep the queue **separate from the task row** — it's a projection over tasks, source-agnostic, and survives re-dating a task.

```sql
CREATE TABLE focus_queue (
  task_id     TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,            -- user order; the whole point
  timebox_min INTEGER,                     -- NULL = count-up; seeds from tasks.duration_minutes
  added_at    TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- focus_sessions already exists via startSession/endSession; add an index on task_id
-- and expose SUM(duration_secs) as LocalTask.time_spent_secs (computed on read).
```

- Queue membership is explicit (user adds) **or** seeded: "Queue today" inserts today's tasks in Nimble's existing today order, once — never re-synced after, so user order is never clobbered (the reconcile rule, without the reconciler).
- Completing a task removes it from `focus_queue` (`ON DELETE` handles deletes; completion handled in the command).
- **Sync**: `focus_queue` writes go through `sync_log` like everything else (LWW is fine — one user, and position conflicts resolve visually). Sessions already sync.
- Timebox auto-arm rule from the old spec: if `duration_minutes` is set, arm the timebox with it on focus.

DataProvider additions (`packages/types/src/data-provider.ts`):

```ts
focusQueue: {
  list(): Promise<QueueEntry[]>
  add(taskId, opts?: { position?: number; timeboxMin?: number }): Promise<void>
  remove(taskId): Promise<void>
  reorder(taskIds: string[]): Promise<void>       // full order, one write
  setTimebox(taskId, min | null): Promise<void>
  seedFromToday(): Promise<number>                // returns count added
}
```

Rust commands in `apps/desktop/src-tauri/src/commands/focus_queue.rs`, db in `nimble-core/src/db/focus_queue.rs`. Same shape as the existing task commands — copy the pattern, don't invent.

---

## UI & window architecture

**Two surfaces, one store, one component.**

1. **In-app: extend the existing Focus page.** `FocusView.tsx` already is the "big timer on one task" screen. Add the queue below it (a `SortableTaskList` variant bound to `focus_queue` order) and the timebox control. `FocusBanner` stays as the in-window compact mode. No new `Page` variant needed if Focus already has one; otherwise add `'focus'` to `appStore.Page` + a `Dashboard.tsx` case + `NavSidebar` entry.

2. **Companion window: a second Tauri window, `focus`.** Follow the `capture` window precedent in `tauri.conf.json` (`alwaysOnTop`, `decorations: false`, `transparent`, `skipTaskbar`), 340 px wide, same React bundle, branched on `getCurrentWindow().label === 'focus'` at the root. It renders the *same* `FocusView` + queue components, so there's one implementation of the card. Detach/reattach is a button in the in-app view ("Pop out ↗") — this is the moment the feature feels native rather than bolted on.

   **Known risk — cross-window state.** `emitTasksChanged()` is an in-process JS event bus; a second webview won't hear it. Fix: have the Rust layer `app.emit("tasks-changed")` after every mutation and have each window's `useLocalTasks` subscribe via `listen()`. Zustand stores are per-webview too — the focus window must treat SQLite as truth and re-read on events, not share `focusStore` memory. Decide this in the spike (Phase 0), before building on sand. The `CaptureStrip` window already solves a subset of this; read it first.

3. **Focus-view scaling** (corner-drag → `transform: scale()`) ports straight into the companion window via `logic/focusView.ts` + `window/focusViewController.ts`. Keep `chromeHeight()` — it's the same 28 px title-bar problem.

---

## Design: merging aesthetics

The old app's whole visual identity was "a piece of Todoist that floated off." In Nimble it should be "a piece of Nimble that floated off." Concretely:

| Old (Todoist mimicry) | Nimble |
|---|---|
| `--color-surface-2: #fcfaf8` warm off-white, `#202020` ink | Nimble `--background` / `--card` / `--foreground` (oklch, 5 accent themes × light/dark — comes free) |
| `--color-p1…p4` Todoist priority reds/oranges/blues | Nimble's existing priority treatment — whatever `TaskItem.tsx` does, the queue rows do |
| `-apple-system` stack | Geist Variable (user-swappable in Settings — honor it) |
| Circular checkbox w/ priority tint | Nimble's checkbox component |
| 340 px fixed card, 13 px body | Nimble type scale: `--text-body` 13px, `--text-meta` 12px, `--text-timer` 48px — already matches |
| `--color-amber-warn #e07800 → amber-deep #b45309 → td-red` | **Keep the ramp, re-token it**: `--focus-warn`, `--focus-deep` as two new oklch tokens in `themes.css` that stay warm across all five accents; red = Nimble `--destructive`. **Keep the rule: red only for timebox overtime.** Write it into Nimble's CLAUDE.md. |
| 220 ms JS-stepped window animation | `--transition-base` is 220 ms with `--ease-entrance` — same number, use the token |
| Todoist ding | Synthesized Nimble ding; reuse the chime's Web Audio code |

Use the `motion` library for card transitions instead of the old hand-rolled ones; shadcn primitives (Popover for the timebox picker, DropdownMenu for ⋯) instead of the custom `RowMenu`/`TimeboxPicker`. The old components were built to avoid dependencies; Nimble already pays for them.

---

## Phases (each ships independently)

**Phase 0 — Spike (½ day).** Bootstrap Vitest in `apps/desktop`. Add the `focus` window to `tauri.conf.json`, render "hello" + one task read through `TauriProvider`. Prove cross-window invalidation (Rust `emit` → `listen`). *Exit: a floating window that shows a live task title and updates when you edit it in the main window.*

**Phase 1 — Queue model (1 day).** `focus_queue` table + migration + Rust commands + DataProvider methods + `seedFromToday`. Queue UI under `FocusView` using the `SortableTaskList` pattern, handle-only drag. Tests for order/seed/remove rules (ported from `store.test.ts` semantics).

**Phase 2 — Timer merge (1 day).** Fold timebox + heartbeat + crash-safe resume into `focusStore.ts`; bind timebox to `duration_minutes`; port `timer.ts` tests; amber ramp + chime + overtime red; `time_spent_secs` on task reads. *This is the phase that finally exercises the timer path in real use — the old app never did.*

**Phase 3 — Companion window (1–2 days).** Pop-out/reattach; port `focusView.ts` + window controller + scale-by-drag; shadow bleed; capabilities entries. All of gotchas #12–19 land here.

**Phase 4 — ✦ + polish (½ day).** Copy-as-prompt with Nimble IDs; synthesized ding; keyboard shortcuts (old roadmap #4 — cheap in-app). Then *stop and use it for two weeks.*

**Phase 5 — Todoist exit (later, separate plan).** `LocalTask` already has `external_id`/`external_source`. One-shot importer: Todoist API v1 → Nimble tasks/projects/sections/labels, preserving priority (remember `ui = 5 − api`) and due dates. Until then, the old Focus Queue app keeps running on Todoist in parallel — no big-bang cutover.

---

## Order of work inside each phase (non-negotiable, it's what made the old app solid)

spec → Rust types + migration → DataProvider contract → pure logic + tests → commands → UI → review → `CLAUDE.md` gotcha entries. Specs go in `nimble/docs/` next to this file.

## Open questions for Marco

1. Does Nimble's Focus already have a `Page` entry, or is it reached only from a task? (Determines whether Phase 1 adds nav.)
2. Should the companion window replace `FocusBanner`, or coexist? Recommendation: coexist — banner in-app, window when Nimble is hidden.
3. Pomodoro rounds (Nimble) vs. timeboxes (Focus Queue) — same control or two? Recommendation: one control, "timebox" with an optional repeat.
