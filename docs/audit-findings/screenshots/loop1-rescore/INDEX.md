# loop1-rescore — screenshots of main after loop 1 + Agentation passes (2026-09-23)

Captured from main at `988d048` (Vite dev server `http://localhost:5173/`, `tools/mock-tauri.js`
injected via `addInitScript`), same recipe and same file names as `../loop1-before/INDEX.md`.
Viewport 1280×800. Zero console errors during the run. Agentation toolbar hidden.

Differences from the baseline set, all from the Agentation passes (not harness drift):
- Left nav is labeled at 240px; Tasks' project tree and Docs' folder/vault tree nest under their nav items
  (the nav remembers which tree was open, so the Docs tree shows expanded on later shots).
- The right column is tabbed (Calendar / Habits / Activity / Focus queue) on every page.
- The mock reports Todoist as last synced over an hour ago, so the sync banner shows on every page.

| File | State |
| --- | --- |
| `today-review-{light,dark}.png` | Today, guided review (`&review=open`) |
| `today-dashboard-{light,dark}.png` | Today dashboard: reminders, priorities, brief accordion |
| `tasks-list-{light,dark}.png` | Tasks, All tasks |
| `tasks-detail-{light,dark}.png` | Task detail `task-01` |
| `inbox-{light,dark}.png` | Inbox |
| `goals-{light,dark}.png` | Goals |
| `session-{light,dark}.png` | Session / Activity |
| `docs-{light,dark}.png` | Docs, no document selected |
| `settings-{light,dark}.png` | Settings, top of page |
| `shell-commandbar-{light,dark}.png` | Cmd+K over Today |
| `shell-help-{light,dark}.png` | Help panel (Shortcuts tab), opened from the `?` button |
