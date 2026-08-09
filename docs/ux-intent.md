# Nimble — UX Intent

The canonical rubric that audit agents use to benchmark the app. When an agent finds something "wrong" or "could be improved," it cites this doc — not its own vibes.

Consolidated 2026-05-10 from:
- `CLAUDE.md` (project-level design philosophy)
- `nimble/CLAUDE.md` (style guide, anti-patterns, architecture rules)
- `docs/linear-ux-patterns.md` (Linear patterns applied to personal productivity)
- `nimble/docs/buildplan.md` (functional intent per phase)
- `project_app_vision.md` memory (command bar, focus mode, activity log, mutable inbox)

When those sources disagree, **this doc wins**. Update this doc, then update the sources to match.

---

## Section 1 — Core philosophy (the headline rubric)

These are the non-negotiables. An audit finding that violates any of these is high-priority by default.

### 1.1 No guilt UI
- No streaks. No "you've been away" messages. No "overdue" labels — use neutral "still open" framing.
- Empty states are positive ("inbox zero" energy), not punitive.
- The app nudges the evening review; it does not nag.

### 1.2 ADHD-friendly low-friction
- Reduce decision overhead. Smart defaults reduce decisions to zero for common actions.
- Batch information; don't make the user choose where to look. Today merges sources into one prioritized list.
- The app does the chunking (AI task breakdown), not the user.

### 1.3 Local-first
- All data lives on-device (SQLite).
- API calls only for sync (Turso) and AI (Anthropic).
- No HTTP calls from the frontend. No filesystem access from the frontend. All via Rust commands.

### 1.4 Linear-inspired, warm, restrained
- Warm gray palette (not cool blue, not pure black).
- Color is reserved for **semantic meaning only**: status, priority, source, health.
- "Earned attention" — chrome and metadata are dimmer, smaller, lower contrast than primary content.
- 8px base grid. Inter (or Geist as configured) typography. Density target: 15-25 items visible without scrolling.

### 1.5 Keyboard-first
- Every common action has a single-key shortcut.
- Command bar (Cmd+K) is the universal entry point for capture, navigation, search, and actions.
- G-prefix navigation: GT (Today), GK (Tasks), GI (Inbox), GS (Session), etc.
- Shortcuts are discoverable via `?` and context menus that show shortcuts alongside actions.

### 1.6 Optimistic updates + instant feedback
- Every interaction produces immediate visual response.
- Task completion: instant strikethrough + check animation.
- Captures: item appears in inbox immediately.
- **No loading spinners.** Use skeleton placeholders matching content shape.
- Ease-out animations (fast start, gentle landing).

### 1.7 Guided mornings, dashboard afterwards
- Today walks the user through a daily review on first open of the day.
- Then transitions to dashboard mode.
- State persisted in `daily_state`.

---

## Section 2 — Per-surface intent

What each surface is *for*, and what "done right" looks like. Audit agents use these as the rubric for their assigned surface.

### 2.1 Today

**Purpose:** The single morning surface. Walks through review on first open, then becomes a dashboard.

**Intended flow (review mode):**
1. Brief summary (read from `{vault}/journal/briefs/Brief YYYY-MM-DD.md`) — habits, calendar, top tasks, overdue. Fallback to calendar glance if no brief exists.
2. Energy selector (Low / Medium / High → writes to `goals/energy.json` as 2/3/4). Shows a 7-day sparkline.
3. AI priorities — Claude Haiku generates top 3 with reasoning. Cached per day.
4. Triage — process inbox items.

**Intended flow (dashboard mode):**
- Linear-style "Focus" grouping: Overdue → Today → Quick wins → Backlog.
- Merged Obsidian + Todoist + native tasks in one prioritized list with source indicators (subtle icon/badge).
- Row anatomy: status circle (left), priority dot, title, project badge, smart due date, source icon (right).
- Row height ~32-36px. 13-14px title.
- Habits + calendar live in collapsible sidebars, not in the primary content lane.

**Done right when:**
- First open of the day shows review; subsequent opens show dashboard.
- Energy + AI priorities cache correctly per day.
- No "overdue" labels — neutral "still open" framing.
- Sources visible but not visually loud.

### 2.2 Tasks

**Purpose:** The library view. All tasks across sources, filterable.

**Intended affordances:**
- Saved filters: "All", "This week", "By project", "Overdue" (neutral framing).
- Grouping options: source, priority, due date, project.
- Default layout: list. Optional: kanban board by status.
- Right-side filter panel: toggle filters for projects, labels, priorities.
- Inline editing — click status, priority, project, due date to change without opening detail.
- Drag-to-reorder.

**Status workflow:** `backlog` → `todo` → `in_progress` → `blocked` → `complete`. Blocked prompts for reason (logged).

### 2.3 Inbox (Quick Captures)

**Purpose:** Mutable triage zone. Items are processable components, not read-only entries.

**Intended affordances:**
- Three capture entry points: inbox input, Cmd+K (command bar), tray menu.
- Prefix routing: `/idea` → Ideas.md, `/quote` → Quotes.md, `/task` → native task, no prefix → Quick Captures.
- Per-item actions: convert to task (with project/date/priority picker), dismiss, defer, move to project, AI breakdown.
- Optional focused triage mode: one item at a time, "what do you want to do with this?"
- Natural language parsing: "Call dentist tomorrow at 3pm" → task with date.
- Positive empty state when cleared.

### 2.4 Focus

**Purpose:** Pomodoro-style focus session that doesn't lock navigation.

**Intended behaviors:**
- Select task → press play → timer starts.
- Status auto-sets to `in_progress`. On completion: `complete`.
- Timer is prominent (48px mono, tabular-nums, `text-timer` token) but the user can still navigate.
- Completion = celebration animation, then auto-surfaces next task.
- Queue order: subtasks in sequence inside a broken-down task, then AI picks next parent task.

### 2.5 Activity Log

**Purpose:** Visible timeline of what the user did + data layer for AI reflection.

**Intended behaviors:**
- Every action logged: task completed, captured, moved, focused, status_changed, etc.
- Fire-and-forget — never blocks user-facing commands.
- Chronological entries with timestamps. Minimal chrome.
- Powers daily review, weekly synthesis, trend analysis, dropoff detection.

### 2.6 Goals

**Purpose:** Goal awareness without overwhelm.

**Intended surfaces:**
- Bingo card view: 5x5 grid of life goals, warm colors, completed goals highlighted, "X/25 complete."
- Resolutions compass: 6 keywords visible during morning review; one rule surfaces each day.
- Habits unified from a single source of truth; checkable from the app.

**Tone:** motivating, not overwhelming. Momentum, not streaks. Amber heatmap (per existing UI research), not red.

### 2.7 Command Bar

**Purpose:** Persistent universal entry point at the bottom of the screen.

**Intended behaviors:**
- Default mode: infers intent (capture vs task vs search).
- Explicit modes: keystroke to force a mode.
- Search results: inline actions on found items (complete, move, AI breakdown).
- **Cmd+K focuses the command bar.** It is not a separate palette.
- Additive layer — does not replace pages.

### 2.8 Mobile (apps/mobile)

**Purpose:** Same mental model on phone. Read-mostly, capture-quick.

**Intended scope:**
- Currently Phase 3 (unchanged since 2026-04-18 typography work).
- Mirror desktop type scale when mobile polish resumes.
- React Native + StyleSheet, expo-router file-based pages.

---

## Section 3 — Anti-patterns (flag these immediately)

If an audit agent sees any of these, it's a high-priority finding.

### 3.1 Guilt-inducing UI
- "Overdue" labels (use "still open" instead).
- Streaks. "You've been away N days." Negative framing of empty states.
- Anything that performs urgency at the user.

### 3.2 Friction
- Loading spinners (use skeleton placeholders matching shape).
- Required choices for common actions (smart-default them instead).
- Modal interruptions for trivial confirmations.
- Multi-step flows where one-step would work.

### 3.3 Architecture violations (from nimble/CLAUDE.md)
- HTTP calls from the React frontend (all via Rust).
- Filesystem access from the frontend (all via `tauri-plugin-fs` through Rust).
- Direct SQLite access from frontend (use Rust commands).
- URL opening via shell plugin (use custom `open_url` command).
- `<button>` inside `<TooltipTrigger>` (causes nested button crash in Tauri webview).
- Template literals for class names — use `cn()`.

### 3.4 Visual / type violations
- Uppercase treatments anywhere. Nimble uses sentence case throughout.
- Positive letter-spacing on labels/captions.
- `text-<size>` + custom `text-<color>` in the same `cn()` without registering the color in `extendTailwindMerge` (see lesson 2026-04-18).
- `font-medium` stacks instead of `text-body-strong` for emphasis.
- Raw `text-sm`/`text-xs` (use the 10-token scale: caption, label, meta, body, body-strong, heading-sm, heading, display, display-xl, timer).
- Hardcoded colors instead of frame theme vars.
- Loading spinners.

### 3.5 Density / spacing violations
- Row heights outside ~32-36px in list views (without justification).
- Spacing not on the 8px grid (4 / 8 / 16 / 32 / 64).
- Padding that breaks Linear's "earned attention" — chrome shouldn't compete with primary content.

### 3.6 Keyboard / interaction gaps
- A common action without a single-key shortcut.
- Inline editing missing where Linear would have it (status, priority, assignee, labels).
- Optimistic updates missing — UI waits for server before reflecting change.
- Escape doesn't return to previous state.

---

## Section 4 — How audit agents use this doc

**You are an agent auditing surface X.** Before you find anything, do these things:

1. Read **Section 1** (core philosophy) in full. These are the rubric headlines.
2. Read **Section 2** entry for your assigned surface. That is your "intended UX."
3. Skim **Section 3** (anti-patterns) — flag any of these on sight.
4. For each finding, **cite the section number** you're benchmarking against. ("Violates 1.6 — loading spinner in TaskList.tsx:42.")
5. Severity:
   - **High** = anti-pattern from Section 3, or violates a core philosophy from Section 1.
   - **Medium** = surface-specific intent from Section 2 is missing or broken.
   - **Low** = polish / "feels off" without a clear rubric violation. These need a citation from `make-interfaces-feel-better` principles, not just taste.

If you can't cite a section, the finding is **not** a finding — it's a preference. Drop it or escalate to a human.

---

## Section 5 — Living doc rules

- This doc is the canonical rubric. When intent changes, update this first.
- Audit findings that surface a missing rubric → add to this doc.
- Source docs (Linear patterns, buildplan, app vision memory) are supplements, not authorities.
- Keep this doc short. If a section grows past ~30 lines, split it out and link.
