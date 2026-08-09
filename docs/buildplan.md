# Nimble — Build Plan

## Current State (as of 2026-03-29)

### What's been built
- **Guided Today page:** First-open review flow (calendar → energy → AI priorities → triage) that transitions to dashboard mode. State persisted in daily_state.
- **Native task system:** Projects (create/rename/delete/color), tasks with subtasks, priority, due dates, descriptions, inline editing, drag-to-reorder.
- **Quick Capture:** 3 entry points (Inbox input, Cmd+K, tray menu). Writes to Obsidian Quick Captures.md.
- **AI Priorities:** Energy selector → Claude Haiku generates top 3 with reasoning. Cached per day.
- **Unified TaskItem:** Linear-style rows for both native and Todoist tasks (colored priority dots, project badge, smart due date).
- **Q shortcut → quick-create dialog** with title, description, project, priority, due date.
- **shadcn/ui components:** command (cmdk), collapsible, sonner, tooltip, skeleton, dialog, etc.
- **System integration:** Tray, global hotkey, auto-launch, dark/light/system theme, page transitions.
- **Todoist + Calendar + Obsidian** read integrations all working.

### Architecture
Three-layer personal system: **Brain** (Obsidian vault), **Engine** (Claude Code), **Surface** (this app + Telegram + devices). The app is the primary Surface for the morning/evening loops.

---

## Completed Chunks (this session)

- ~~Chunk 1: Quick Capture~~ ✓
- ~~Chunk 2: AI Priorities~~ ✓
- ~~Chunk 3: Native Task System~~ ✓ (replaced Todoist creation plan)
- ~~Chunk 4: Daily Review Mode~~ ✓ (integrated into Today page)
- ~~Chunk 5: Polish Pass~~ ✓
- ~~Project rename/delete/color UI~~ ✓
- ~~Drag-to-reorder~~ ✓
- ~~Design critique fixes~~ ✓

---

## Phase A: Close the Morning Loop

### A1. Daily Brief as Review Entry Point
**Why:** The brief is generated at 4am with 12 sections of context. The app currently shows only a calendar glance in Step 1 of the review. Replacing it with the actual brief makes the app the single morning surface.

**What to build:**
- Rust command: `read_daily_brief()` — reads `{vault}/journal/briefs/Brief YYYY-MM-DD.md`
- Parse the markdown into sections (Before You Start, Core Habits, Today's Shape, Work Focus, Personal Focus, Overdue, Needs Response, etc.)
- Replace the CalendarGlance in review Step 1 with a rendered brief summary
- Fallback: if no brief exists for today, show calendar glance as before

**Done looks like:** Open app → Step 1 shows today's brief (habits, calendar, top tasks, overdue) in a clean scannable format.

### A2. Energy Write-Back
**Why:** The energy selector exists but doesn't write to `goals/energy.json`. The weekly synthesis agent and evening review need this data.

**What to build:**
- Rust command: `write_energy_rating(rating, date)` — appends to `{vault}/goals/energy.json`
- Call it when user selects energy in the review flow (map Low=2, Medium=3, High=4)
- Also read historical data to show "this week" trend in the energy selector

**Done looks like:** Select energy in review → written to energy.json → weekly synthesis picks it up. Energy selector shows a subtle sparkline of the past 7 days.

### A3. Smart Capture Routing
**Why:** All captures currently go to Quick Captures.md. The personal system routes `c:` Telegram captures to different files by type.

**What to build:**
- Detect prefixes in capture input:
  - `/idea ...` → append to `{vault}/life/creative/Ideas.md`
  - `/quote ...` → append to `{vault}/life/Quotes.md`
  - `/task ...` → create native task (already works)
  - No prefix → Quick Captures.md (already works)
- Show prefix hints in the capture input placeholder
- Rust commands for writing to Ideas.md and Quotes.md

**Done looks like:** Type `/idea Build a film scanner app` → writes to Ideas.md → toast "Idea captured". Same for quotes.

---

## Phase B: Close the Evening Loop

### B1. Evening Review Flow
**Why:** The evening review currently runs via `/evening-review` Claude Code skill in the terminal. The app should be the surface for this ritual.

**What to build:**
- New flow triggered from command palette or a button (after 5pm):
  - Step 1: "What you accomplished" — auto-gather from completed tasks, session logs, git activity
  - Step 2: Two reflection questions (pulled from templates or generated)
  - Step 3: Energy rating for the day (1-5 scale, writes to energy.json)
  - Step 4: Goal pulse (show bingo card progress)
  - Step 5: Affirmation (warm, specific to what was accomplished)
- Write reflection to `{vault}/journal/reflections/Reflection YYYY-MM-DD.md`

**Done looks like:** After 5pm, the app nudges (not nags) toward evening review. 2-minute guided flow. Reflection saved to Obsidian.

### B2. Energy Trends Display
**Why:** Energy data is collected but never surfaced to the user. Seeing patterns helps with self-awareness and informs AI priorities.

**What to build:**
- Read `goals/energy.json` (last 30-90 days)
- Render a sparkline or simple bar chart in the sidebar or Settings page
- Show average, trend direction, and "your best days are usually [weekday]"
- Feed historical energy context into the AI priorities prompt

**Done looks like:** A small "Energy" section in the right sidebar showing a 7-day sparkline and weekly average.

---

## Phase C: Goal Awareness

### C1. Bingo Card View
**Why:** The 2026 bingo card has 25 life goals. Seeing progress makes them real instead of a forgotten markdown file.

**What to build:**
- New page or sidebar section that reads `{vault}/goals/2026-bingo-card.md`
- Parse the 5x5 grid and render it visually (completed goals highlighted)
- Clicking a goal shows related tasks (if any match by keyword)
- Progress indicator: "4/25 complete"

**Done looks like:** A visual 5x5 grid with warm colors. Completed goals glow. Feels motivating, not overwhelming.

### C2. Resolutions Compass
**Why:** The 6 keywords and 8 rules are the system's north star. They should be visible without opening Obsidian.

**What to build:**
- Read `{vault}/goals/🪩 2026 Resolutions & Goals.md`
- Display keywords in the review flow or Settings page
- Optionally show a random rule as a subtle footer message

**Done looks like:** Keywords visible during morning review. One rule surfaces each day as a gentle reminder.

### C3. Habit Unification
**Why:** The app shows habits from today.md. The brief has "Core Habits" (skincare, outside, friends, family, teeth). These are separate sources of truth.

**What to build:**
- Define a canonical habit list (either in settings or a vault file)
- Show habits from one unified source on the Today page and in briefs
- Check-off from the app writes to the source file

**Done looks like:** One habits section, one source of truth, checkable from the app.

---

## Phase D: Work Integration

### D1. Linear Tickets
**Why:** The brief already pulls assigned Linear tickets. The app could show them directly.

**What to build:**
- Rust command: fetch assigned tickets from Linear API (API key already in env)
- Display as a collapsible section (like Todoist) — read-only, links to Linear
- Filter to DSN project or all assigned

**Done looks like:** A "Linear" section on Today or Tasks page showing assigned tickets with status badges.

### D2. Needs Response Queue
**Why:** The brief scores Slack threads and emails by urgency. The app could surface the top items.

**What to build:**
- Parse the "Needs Response" section from the daily brief
- Display as a ranked list with urgency scores
- Link out to Slack/Gmail

**Done looks like:** A "Needs Response" section showing top 5 items ranked by urgency with one-click links.

### D3. Telegram Capture Sync
**Why:** Captures come in via Telegram (`c:` prefix) throughout the day. The app should show them.

**What to build:**
- Read processed captures from wherever the Telegram bot routes them (Quick Captures.md, Ideas.md, etc.)
- Or: poll the Telegram bot's output and display in the Inbox

**Done looks like:** Captures made via Telegram show up in the app's Inbox without a separate check.

---

## Phase E: Infrastructure

### E1. Multi-Device Sync
**Problem:** Native tasks, projects, daily state, and settings only live in local SQLite.

**Recommended approach: Obsidian vault as sync layer**
- Write native tasks/projects to a structured file in the vault (e.g. `data/tasks.json`)
- Obsidian Sync or iCloud handles cross-device transport
- Conflict resolution: last-write-wins for simple cases, merge for task lists

**Alternative approaches:**
- Turso (cloud SQLite with embedded replicas)
- Supabase (Postgres with real-time)
- iCloud CloudKit (native macOS)

### E2. Native Notifications
- Meeting in 5 min (from calendar)
- Evening review nudge at 5:30pm (configurable)
- "3 tasks still open" gentle evening reminder
- Uses `tauri-plugin-notification`

### E3. .dmg Distribution
- Signed build via `npm run tauri build`
- Requires Apple Developer cert ($99/yr) for Gatekeeper
- Auto-updater via GitHub Releases

---

## Priority Order

| Phase | Theme | Features | Est. Effort |
|-------|-------|----------|-------------|
| **A** | Morning loop | Brief display, energy write-back, smart capture routing | ~4-5h |
| **B** | Evening loop | Evening review flow, energy trends | ~4-5h |
| **C** | Goal awareness | Bingo card, resolutions compass, habit unification | ~3-4h |
| **D** | Work integration | Linear tickets, needs response, Telegram sync | ~3-4h |
| **E** | Infrastructure | Multi-device sync, notifications, .dmg | ~5-8h |
