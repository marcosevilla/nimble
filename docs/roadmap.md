# Nimble — Roadmap

## Current State (as of 2026-03-23)

The app is a functional macOS daily triage tool with read + triage capabilities across Todoist, Google Calendar, and Obsidian. Solid keyboard-first UI with Linear-inspired design. Missing: task/capture creation, AI priorities UI, notifications.

## Next Session (Highest Leverage)

### 1. Wire up Quick Capture for real
- Add text input to Inbox page + command palette (Cmd+K → "capture: Buy groceries")
- Write to Obsidian's Quick Captures.md
- Also add as tray capture popover (small input field from menu bar)
- **Impact:** Turns app from read-only into a capture tool you reach for all day
- **Estimate:** ~1-2 hours

### 2. Wire up Claude AI Priorities
- Backend exists (priorities.rs): takes energy level + today's data → Claude API → top 3 priorities
- Need: energy selector (3 buttons: high/medium/low) on Today page
- Need: "Generate Priorities" button or auto-trigger on first open
- Need: PrioritiesHero component to display the top 3 with reasoning
- **Impact:** Unlocks the hero feature — "what should I do right now?"
- **Estimate:** ~1-2 hours

### 3. Create Todoist Tasks from the App
- Add task creation to command palette (Cmd+K → type task → Enter → creates in Todoist Inbox)
- Basic: just title, dumps into Inbox project
- Later: project selection, due date, priority
- **Impact:** Eliminates context-switching to Todoist for quick task creation
- **Estimate:** ~1 hour

## After That

### 4. Notifications
- macOS native notifications via tauri-plugin-notification
- "Meeting in 5 min" alerts
- "3 tasks still open at 5pm" evening nudge
- Configurable in Settings

### 5. Daily Review Mode
- Guided end-of-day flow: what got done, what moves to tomorrow, energy reflection
- Writes structured entry to Obsidian session log
- Triggers from command palette or dedicated button

### 6. Build & Distribute as .dmg
- `npm run tauri build` → signed .dmg
- Requires Apple Developer cert ($99/yr) for Gatekeeper
- Auto-updater Phase B (download + install from GitHub Releases)

## Backlog

- Habit history/streaks/analytics
- Task search across all sources
- Subtask support for Todoist
- Meeting-free time detection (deep work windows)
- Daily intention setting
- Time blocking
- Multi-device sync
- Export data (CSV/JSON)
- Onboarding tutorial
- Accessibility improvements (ARIA labels, screen reader support)

## Research

- `docs/linear-technical-architecture.md` — How Linear is built (sync engine, tech stack)
- `docs/linear-ux-patterns.md` — Linear UX patterns applicable to personal productivity
