# loop1-before — baseline screenshots (2026-09-22)

Captured from the Vite dev server (`http://localhost:5173/`) in a plain Chromium
page with the Tauri backend polyfilled by `tools/mock-tauri.js`. Mock-world
"today" is Saturday 2026-08-01; the calendar rail shows the real clock date.
Viewport 1280×800 unless noted. Zero console errors on every page (the only
excluded noise is the known non-fatal `Dashboard.tsx` `listen()`/`transformCallback`
warning).

## Files

| File | Surface / state |
| --- | --- |
| `today-review-light.png` / `-dark.png` | Today, first-open guided review (step 1 "Your daily brief" open, step 2 "Set your energy" pending) with the Reminder catch-up strip above it (2 items: one scheduled, one `schedule_needs_attention`) |
| `today-dashboard-light.png` / `-dark.png` | Today, dashboard mode (review complete): reminders strip, greeting, week strip, daily brief accordion, "Today's priorities" |
| `tasks-list-light.png` / `-dark.png` | Tasks, project sidebar + All Tasks list (15 tasks, status groups) |
| `tasks-list-light-full.png` | Same, full scroll extent (1280×1440; the scroller is the inner `.overflow-y-auto` div, so the viewport was grown to fit) |
| `tasks-detail-light.png` / `-dark.png` | Tasks, detail view for `task-01` "Refresh portfolio case study" (reminder row, chips, description, 2 subtasks) |
| `inbox-light.png` / `-dark.png` | Inbox, 7 captures with route/convert actions |
| `goals-light.png` / `-dark.png` | Goals, 4 goals across 4 life areas, progress cards |
| `session-light.png` / `-dark.png` | Session (Activity), Timeline tab, 5 actions / 2 completed |
| `docs-light.png` / `-dark.png` | Docs, folder tree + Vault section (12 indexed notes in 5 folders), no document selected |
| `settings-light.png` / `-dark.png` | Settings, top of page (Appearance, Integrations, Vault…) |
| `settings-light-full.png` | Settings, full scroll extent (~1280×5580) |
| `shell-commandbar-light.png` / `-dark.png` | Cmd+K command bar open over the Today dashboard |
| `shell-help-light.png` / `-dark.png` | Help panel open (Shortcuts tab), triggered from the floating bottom-right `?` button over the Today dashboard |

## Recipe

1. Vite dev server running at `http://localhost:5173/` (`cd apps/desktop && npm run dev`).
2. Playwright (`mcp__playwright__browser_run_code_unsafe`), before any navigation:
   ```js
   await page.context().addInitScript({ path: '/Users/marcosevilla/Developer/marco-task-app/nimble/tools/mock-tauri.js' })
   await page.setViewportSize({ width: 1280, height: 800 })
   ```
3. Navigate with the deep-link shim (it sets `setupComplete: true` + `currentPage`):
   `page.goto('http://localhost:5173/?page=<today|tasks|inbox|goals|session|docs|settings>', { waitUntil: 'networkidle' })`, then wait ~1.5 s.
   - Guided review flow: add `&review=open` (mock flips `daily_state.review_complete` to `false`).
4. Hide the Agentation dev toolbar (it sits bottom-right and intercepts clicks):
   `document.querySelectorAll('[data-agentation-root]').forEach(el => el.style.display = 'none')`
5. Dark mode: `document.documentElement.classList.add('dark')` (`theme-warm` stays); light: `.remove('dark')`. Wait ~400 ms.
6. State triggers:
   - Task detail: `window.__stores.useDetailStore.getState().openTask('task-01')` on the Tasks page (mock task ids are `task-01` … `task-15`).
   - Command bar: `page.keyboard.press('Meta+k')`.
   - Help panel: there is **no `?` hotkey** — click the floating button: `document.querySelector('button.fixed.bottom-4.right-4').click()`.
7. Screenshot: `page.screenshot({ path, fullPage })`. Because `body` is `overflow: hidden` and pages scroll inside an inner `.overflow-y-auto` div, `fullPage: true` alone yields 1280×800; for a true full-length shot set the viewport height to that scroller's `scrollHeight` (+ chrome) first.

## Notes for auditors

- The floating `?` button and the calendar right rail are real app UI; anything from `[data-agentation-root]` is dev tooling and was hidden.
- Google Calendar is mocked as *not configured* (fresh-install state); reminders permission is mocked as granted.
- Mock data changes for this loop (all in `tools/mock-tauri.js`): reminder catch-up items, Google Calendar status, vault library (12 notes, search, backlinks, save/create), markdown-migration previews, capture-strip dismiss, and unhandled commands now `console.warn` and resolve `null`.
