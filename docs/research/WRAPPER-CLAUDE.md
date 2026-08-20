# Nimble

Nimble (formerly "Daily Triage") is a macOS desktop app for daily triage — one keyboard-first interface that pulls from Todoist, Google Calendar, and Obsidian, with a native task system and AI-powered priorities. Designed for an ADHD brain: low friction, no guilt, pull-based.

## Design Philosophy
- **Linear-inspired:** warm color palette, icons-only nav, keyboard-first, fast transitions
- **No guilt UI:** no streaks, no "you've been away" messages, no overdue shaming — use neutral "still open" framing
- **ADHD-friendly:** reduce decision overhead, batch information, positive empty states
- **Local-first:** all data lives on-device (SQLite), API calls only for sync
- **Guided mornings:** Today page walks you through a daily review on first open, then becomes a dashboard

## Project Layout
- `nimble/` — The actual Tauri app (see its own CLAUDE.md for code-level details)
- `docs/desktop-app-research.md` — Stack deep-dive: Tauri vs SwiftUI vs Electron vs Flutter
- `docs/linear-ux-patterns.md` — Linear UX patterns applied to personal productivity
- `docs/linear-technical-architecture.md` — Linear's sync engine, MobX, performance patterns
- `nimble/docs/buildplan.md` — Feature prioritization and build plan
- `nimble/docs/roadmap.md` — Original roadmap

## Current State

Transient state (what was last worked on, what's in progress, known issues) lives in memory: `~/.claude/projects/-Users-marcosevilla-Developer-marco-task-app/memory/project_current_state.md`. That file is updated by `nightly-recap` (v2 logging) and is loaded into context via `MEMORY.md`. Keep this CLAUDE.md stable guidance only.
