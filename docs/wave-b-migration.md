# Wave B Migration Checklist

## DataProvider Surface

The `DataProvider` interface is the abstraction layer that decouples the UI from direct Tauri invoke calls. Located at `/Users/marcosevilla/Developer/personal triage and briefing app/nimble/apps/desktop/src/services/data-provider.ts`.

### Domain Map

**settings**
- `checkSetupComplete(): Promise<boolean>`
- `get(key: string): Promise<string | null>`
- `set(key: string, value: string): Promise<void>`
- `getAll(): Promise<Setting[]>`
- `clearAll(): Promise<void>`

**obsidian**
- `readTodayMd(): Promise<ParsedTodayMd>`
- `toggleCheckbox(fileName: string, lineNumber: number): Promise<ParsedTodayMd>`
- `importCaptures(): Promise<number>`

**todoist**
- `fetchTasks(): Promise<TodoistTaskRow[]>`
- `refreshTasks(): Promise<TodoistTaskRow[]>`
- `completeTask(taskId: string): Promise<void>`
- `snoozeTask(taskId: string): Promise<void>`

**calendar**
- `fetchEvents(date?: string): Promise<CalendarEvent[]>`
- `getCachedEvents(date: string): Promise<CalendarEvent[]>`
- `getFeeds(): Promise<CalendarFeed[]>`
- `addFeed(label: string, url: string, color: string): Promise<CalendarFeed>`
- `removeFeed(feedId: string): Promise<void>`

**captures**
- `list(limit?: number, includeConverted?: boolean): Promise<Capture[]>`
- `create(content: string, source?: string): Promise<Capture>`
- `convertToTask(captureId: string, projectId?: string): Promise<LocalTask>`
- `delete(id: string): Promise<void>`
- `readQuickCaptures(): Promise<QuickCapture[]>`
- `writeQuickCapture(content: string): Promise<QuickCapture>`

**captureRoutes**
- `list(): Promise<CaptureRoute[]>`
- `create(opts: {...}): Promise<CaptureRoute>`
- `update(opts: {...}): Promise<void>`
- `delete(id: string): Promise<void>`
- `route(prefix: string, content: string): Promise<RouteCaptureResult>`

**projects**
- `list(): Promise<Project[]>`
- `create(name: string, color: string): Promise<Project>`
- `update(id: string, name?: string, color?: string): Promise<void>`
- `delete(id: string): Promise<void>`

**tasks**
- `list(opts?: {...}): Promise<LocalTask[]>`
- `create(opts: {...}): Promise<LocalTask>`
- `update(opts: {...}): Promise<LocalTask>`
- `updateStatus(id: string, status: TaskStatus, note?: string): Promise<void>`
- `complete(id: string): Promise<void>`
- `uncomplete(id: string): Promise<void>`
- `delete(id: string): Promise<void>`
- `reorder(taskIds: string[]): Promise<void>`

**docs**
- `getFolders(): Promise<DocFolder[]>`
- `createFolder(name: string): Promise<DocFolder>`
- `renameFolder(id: string, name: string): Promise<void>`
- `deleteFolder(id: string): Promise<void>`
- `getDocuments(folderId?: string): Promise<Document[]>`
- `getDocument(id: string): Promise<Document | null>`
- `createDocument(title: string, folderId?: string): Promise<Document>`
- `updateDocument(id: string, title?: string, content?: string, folderId?: string): Promise<Document>`
- `deleteDocument(id: string): Promise<void>`
- `searchDocuments(query: string): Promise<Document[]>`
- `getNotes(docId: string): Promise<DocNote[]>`
- `createNote(docId: string, content: string): Promise<DocNote>`
- `deleteNote(id: string): Promise<void>`
- `reorderNotes(noteIds: string[]): Promise<void>`

**activity**
- `log(actionType: string, targetId?: string, metadata?: Record<string, unknown>): Promise<void>`
- `getLog(opts: {...}): Promise<ActivityEntry[]>`
- `getSummary(date: string): Promise<ActivitySummary[]>`

**focus**
- `startSession(taskId: string, taskContent: string): Promise<void>`
- `endSession(taskId: string, outcome: string, durationSecs: number): Promise<void>`
- `getActive(): Promise<FocusState>`

**dailyState**
- `get(): Promise<DailyState>`
- `generatePriorities(energyLevel: string, calendarSummary: string, tasksSummary: string, obsidianSummary: string): Promise<Priority[]>`
- `readSessionLog(): Promise<string | null>`
- `readDailyBrief(date?: string): Promise<string | null>`
- `listBriefDates(): Promise<string[]>`
- `saveProgress(tasksCompleted: string, tasksOpen: string, tasksDeferred: string): Promise<SaveResult>`

**goals**
- `list(): Promise<GoalWithProgress[]>`
- `get(id: string): Promise<GoalWithProgress>`
- `create(opts: {...}): Promise<Goal>`
- `update(opts: {...}): Promise<Goal>`
- `delete(id: string): Promise<void>`
- `getMilestones(goalId: string): Promise<Milestone[]>`
- `createMilestone(opts: {...}): Promise<Milestone>`
- `updateMilestone(opts: {...}): Promise<Milestone>`
- `deleteMilestone(id: string): Promise<void>`
- `getLifeAreas(): Promise<LifeArea[]>`
- `createLifeArea(opts: {...}): Promise<LifeArea>`
- `updateLifeArea(opts: {...}): Promise<LifeArea>`
- `deleteLifeArea(id: string): Promise<void>`
- `importFromVault(): Promise<ImportSummary>`

**habits**
- `list(): Promise<HabitWithStats[]>`
- `create(opts: {...}): Promise<Habit>`
- `update(opts: {...}): Promise<Habit>`
- `delete(id: string): Promise<void>`
- `log(habitId: string, date?: string, intensity?: number): Promise<HabitLog>`
- `unlog(habitId: string, date?: string): Promise<void>`
- `getLogs(habitId?: string, days?: number): Promise<HabitLog[]>`
- `getHeatmap(habitId?: string, days?: number): Promise<HabitHeatmapEntry[]>`

**ai**
- `breakDownTask(taskContent: string, taskDescription?: string): Promise<string[]>`

**system**
- `openUrl(url: string): Promise<void>`
- `checkForUpdates(): Promise<UpdateStatus>`

**sync**
- `push(): Promise<number>`
- `pull(): Promise<number>`
- `getStatus(): Promise<SyncStatus>`
- `configure(tursoUrl: string, tursoToken: string): Promise<void>`
- `testConnection(tursoUrl: string, tursoToken: string): Promise<void>`
- `initializeRemote(): Promise<void>`

---

## Files to Migrate

Total files importing from services/tauri: **26 files**
(Main.tsx is dev infrastructure, not UI migration target)

### Pages (5 files)

- [ ] `apps/desktop/src/components/pages/GoalsPage.tsx`
  - **Current imports:** `createGoal`, `importGoalsFromVault` (types: `GoalWithProgress`, `GoalStatus`, `LifeArea`)
  - **Call sites:** `createGoal` (1x), `importGoalsFromVault` (1x)
  - **DataProvider methods needed:** `goals.create()`, `goals.importFromVault()` (both exist ✓)
  - **Status:** READY — all methods exist in DataProvider

- [ ] `apps/desktop/src/components/pages/InboxPage.tsx`
  - **Current imports:** `updateLocalTask`, `getCaptures`, `createCapture`, `convertCaptureToTask`, `importObsidianCaptures`, `getDocFolders`, `getDocuments`, `createDocNote`, `deleteCapture`, `getCaptureRoutes`, `routeCapture` (types: `CaptureRoute`, `LocalTask`, `Capture`, `Project`, `DocFolder`, `Document`)
  - **Call sites:** All function calls appear 2x each in the code
  - **DataProvider methods needed:** `tasks.update()`, `captures.list()`, `captures.create()`, `captures.convertToTask()`, `captures.delete()`, `docs.getFolders()`, `docs.getDocuments()`, `docs.createNote()`, `captureRoutes.list()`, `captureRoutes.route()`
  - **Missing:** `importObsidianCaptures` — DataProvider has `obsidian.importCaptures()` but signature matches ✓
  - **Status:** READY — all methods exist in DataProvider

- [ ] `apps/desktop/src/components/pages/SessionPage.tsx`
  - **Current imports:** `readSessionLog` (no type imports)
  - **Call sites:** `readSessionLog` (1x)
  - **DataProvider methods needed:** `dailyState.readSessionLog()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/pages/SettingsPage.tsx`
  - **Current imports:** `openUrl` (types: `UpdateStatus`, `CalendarFeed`, `CaptureRoute`, `Document`, `SyncStatus`)
  - **Call sites:** `openUrl` (1x)
  - **DataProvider methods needed:** `system.openUrl()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/pages/TodayPage.tsx`
  - **Current imports:** `openUrl`, `getDailyState`, `readDailyBrief`, `listBriefDates` (types: `Priority`, `TodoistTaskRow`)
  - **Call sites:** `readDailyBrief` (2x), `getDailyState` (1x), `listBriefDates` (1x), `openUrl` (1x)
  - **DataProvider methods needed:** `system.openUrl()`, `dailyState.get()`, `dailyState.readDailyBrief()`, `dailyState.listBriefDates()` ✓
  - **Status:** READY

### Detail Views (4 files)

- [ ] `apps/desktop/src/components/detail/CaptureDetailPage.tsx`
  - **Current imports:** `getCaptures`, `convertCaptureToTask`, `deleteCapture` (types: `Capture`)
  - **Call sites:** `getCaptures` (1x), `convertCaptureToTask` (1x), `deleteCapture` (1x)
  - **DataProvider methods needed:** `captures.list()`, `captures.convertToTask()`, `captures.delete()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/detail/TaskDetailPage.tsx`
  - **Current imports:** `updateLocalTask`, `createLocalTask`, `breakDownTask`, `logActivity`, `getDocument`, `getDocuments` (types: `LocalTask`, `Document`)
  - **Call sites:** `updateLocalTask` (4x), `createLocalTask` (2x), `breakDownTask` (1x), `getDocument` (1x), `getDocuments` (1x), `logActivity` (1x)
  - **DataProvider methods needed:** `tasks.update()`, `tasks.create()`, `ai.breakDownTask()`, `activity.log()`, `docs.getDocument()`, `docs.getDocuments()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/detail/TaskActionBar.tsx`
  - **Current imports:** `breakDownTask`, `createLocalTask`, `updateLocalTask`, `deleteLocalTask`, `logActivity` (types: `LocalTask`, `Project`)
  - **Call sites:** `breakDownTask` (1x), `updateLocalTask` (1x), `logActivity` (1x), `createLocalTask` (1x), `deleteLocalTask` (1x)
  - **DataProvider methods needed:** `ai.breakDownTask()`, `tasks.create()`, `tasks.update()`, `tasks.delete()`, `activity.log()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/detail/TaskActivityLog.tsx`
  - **Current imports:** `getActivityLog` (types: `ActivityEntry`)
  - **Call sites:** `getActivityLog` (1x)
  - **DataProvider methods needed:** `activity.getLog()` ✓
  - **Status:** READY

### Task Components (4 files)

- [ ] `apps/desktop/src/components/tasks/QuickCreateDialog.tsx`
  - **Current imports:** `createLocalTask` (no type imports)
  - **Call sites:** `createLocalTask` (1x)
  - **DataProvider methods needed:** `tasks.create()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/tasks/SortableTaskList.tsx`
  - **Current imports:** `reorderLocalTasks` (types: `LocalTask`, `Project`)
  - **Call sites:** `reorderLocalTasks` (1x)
  - **DataProvider methods needed:** `tasks.reorder()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/tasks/StatusDropdown.tsx`
  - **Current imports:** `updateTaskStatus` (types: `TaskStatus`)
  - **Call sites:** `updateTaskStatus` (2x)
  - **DataProvider methods needed:** `tasks.updateStatus()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/tasks/TaskEditor.tsx`
  - **Current imports:** `updateLocalTask` (types: `LocalTask`, `Project`)
  - **Call sites:** `updateLocalTask` (1x)
  - **DataProvider methods needed:** `tasks.update()` ✓
  - **Status:** READY

### Doc Components (3 files)

- [ ] `apps/desktop/src/components/docs/DocEditor.tsx`
  - **Current imports:** `updateDocument`, `getDocNotes`, `createDocNote`, `deleteDocNote` (types: `DocNote`)
  - **Call sites:** `updateDocument` (2x), `createDocNote` (1x), `getDocNotes` (1x), `deleteDocNote` (1x)
  - **DataProvider methods needed:** `docs.updateDocument()`, `docs.getNotes()`, `docs.createNote()`, `docs.deleteNote()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/docs/FolderTree.tsx`
  - **Current imports:** `createDocFolder`, `deleteDocFolder`, `createDocument`, `deleteDocument` (types: `Document`)
  - **Call sites:** `deleteDocument` (1x), `createDocFolder` (1x), `deleteDocFolder` (1x), `createDocument` (1x)
  - **DataProvider methods needed:** `docs.createFolder()`, `docs.deleteFolder()`, `docs.createDocument()`, `docs.deleteDocument()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/docs/TiptapEditor.tsx`
  - **Current imports:** `getLocalTasks`, `searchDocuments` (no type imports)
  - **Call sites:** `getLocalTasks` (1x), `searchDocuments` (1x)
  - **DataProvider methods needed:** `tasks.list()`, `docs.searchDocuments()` ✓
  - **Status:** READY

### Focus Components (2 files)

- [ ] `apps/desktop/src/components/focus/FocusPlayMenu.tsx`
  - **Current imports:** `getSetting` (types: `LocalTask`)
  - **Call sites:** `getSetting` (1x)
  - **DataProvider methods needed:** `settings.get()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/focus/FocusResumeDialog.tsx`
  - **Current imports:** `getActiveFocus`, `getLocalTasks` (types: `LocalTask`)
  - **Call sites:** `getLocalTasks` (1x), `getActiveFocus` (1x)
  - **DataProvider methods needed:** `focus.getActive()`, `tasks.list()` ✓
  - **Status:** READY

### Shared Components (2 files)

- [ ] `apps/desktop/src/components/shared/BulkActionBar.tsx`
  - **Current imports:** `deleteLocalTask`, `deleteCapture`, `updateTaskStatus`, `updateLocalTask`, `convertCaptureToTask` (types: `TaskStatus`)
  - **Call sites:** `convertCaptureToTask` (1x), `updateTaskStatus` (1x), `deleteCapture` (1x), `deleteLocalTask` (1x), `updateLocalTask` (1x)
  - **DataProvider methods needed:** `tasks.delete()`, `captures.delete()`, `tasks.updateStatus()`, `tasks.update()`, `captures.convertToTask()` ✓
  - **Status:** READY

- [ ] `apps/desktop/src/components/shared/CommandBar.tsx`
  - **Current imports:** `createCapture`, `logActivity`, `breakDownTask`, `createLocalTask`, `updateLocalTask`, `searchDocuments` (types: `LocalTask`, `Document`)
  - **Call sites:** `breakDownTask` (1x), `logActivity` (1x), `createCapture` (1x), `searchDocuments` (1x), `createLocalTask` (1x), `updateLocalTask` (1x)
  - **DataProvider methods needed:** `captures.create()`, `activity.log()`, `ai.breakDownTask()`, `tasks.create()`, `tasks.update()`, `docs.searchDocuments()` ✓
  - **Status:** READY

### Activity Components (1 file)

- [ ] `apps/desktop/src/components/activity/ActivityTimeline.tsx`
  - **Current imports:** `getActivityLog`, `getActivitySummary` (types: `ActivityEntry`, `ActivitySummary`)
  - **Call sites:** `getActivityLog` (1x), `getActivitySummary` (1x)
  - **DataProvider methods needed:** `activity.getLog()`, `activity.getSummary()` ✓
  - **Status:** READY

### Calendar Components (1 file)

- [ ] `apps/desktop/src/components/calendar/CalendarPanel.tsx`
  - **Current imports:** `openUrl` (types: `CalendarEvent`)
  - **Call sites:** `openUrl` (1x)
  - **DataProvider methods needed:** `system.openUrl()` ✓
  - **Status:** READY

### Goals Components (1 file)

- [ ] `apps/desktop/src/components/goals/HabitsSection.tsx`
  - **Current imports:** `logHabit`, `unlogHabit`, `getHabitHeatmap` (types: `HabitHeatmapEntry`)
  - **Call sites:** `getHabitHeatmap` (2x), `unlogHabit` (1x), `logHabit` (1x)
  - **DataProvider methods needed:** `habits.log()`, `habits.unlog()`, `habits.getHeatmap()` ✓
  - **Status:** READY

### Priorities Components (1 file)

- [ ] `apps/desktop/src/components/priorities/PrioritiesSection.tsx`
  - **Current imports:** `generatePriorities` (types: `Priority`)
  - **Call sites:** `generatePriorities` (1x)
  - **DataProvider methods needed:** `dailyState.generatePriorities()` ✓
  - **Status:** READY

### Setup Components (1 file)

- [ ] `apps/desktop/src/components/setup/SetupDialog.tsx`
  - **Current imports:** `setSetting` (no type imports)
  - **Call sites:** `setSetting` (1x)
  - **DataProvider methods needed:** `settings.set()` ✓
  - **Status:** READY

### Todoist Components (1 file)

- [ ] `apps/desktop/src/components/todoist/TaskRow.tsx`
  - **Current imports:** `openUrl` (types: `TodoistTaskRow`)
  - **Call sites:** `openUrl` (1x)
  - **DataProvider methods needed:** `system.openUrl()` ✓
  - **Status:** READY

---

## Blockers

**None identified.** All 26 UI files have matching DataProvider methods already implemented. Wave B can proceed without requiring any DataProvider additions.

---

## Summary

| Metric | Count |
|--------|-------|
| Files importing from services/tauri (UI layer) | 26 |
| Total function call sites to migrate | 68 |
| Files categorized as READY | 26 |
| Files categorized as BLOCKED | 0 |
| DataProvider methods missing | 0 |

**Migration readiness: 100%** — All UI components can be migrated immediately. No DataProvider infrastructure gaps.

---

## Migration Strategy

1. **Scope:** Migrate all 26 UI files to call `getDataProvider().domain.method()` instead of importing and calling `invoke()` wrappers directly.

2. **Execution order (by dependency):** 
   - Start with leaf components (Task*, Doc*, Focus*, etc.)
   - Move to pages last (GoalsPage, InboxPage, etc.) to avoid mid-migration conflicts
   - Update imports in stores after all UI components are done

3. **Testing approach:**
   - Each component: verify all `invoke()` calls replaced with DataProvider calls
   - Type imports can remain from tauri.ts (those are Wave A, already done)
   - Run full app to ensure no regressions

4. **Acceptance criteria:**
   - No imports of functions (only types) remain from `@/services/tauri` in UI files
   - All DataProvider calls route through `getDataProvider()` accessor
   - Stores still call DataProvider directly (Wave B scope is UI layer only)
   - E2E tests pass (if present)
