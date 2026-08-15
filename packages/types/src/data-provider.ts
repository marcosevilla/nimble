/**
 * DataProvider — platform-agnostic interface for all data operations.
 *
 * THE single definition. Every client implements this same interface:
 *   Desktop: TauriProvider   (apps/desktop/src/services/tauri-provider.ts — delegates to invoke() wrappers)
 *   Web:     HTTP provider   (talks to the API routes)
 *   Mobile:  SqliteProvider  (apps/mobile — DORMANT, still carries its own stale copy)
 *
 * It lives in @nimble/types so a new client cannot silently fork it: any drift
 * between a provider implementation and this contract is a compile error.
 *
 * Note: this module is TYPES ONLY. Runtime provider access lives in the app
 * (desktop: `@/services/provider-context`) — importing a value from a
 * type-only module passes tsc but throws at module eval.
 */

import type {
  Setting,
  ParsedTodayMd,
  CalendarEvent,
  CalendarFeed,
  QuickCapture,
  Priority,
  DailyState,
  Project,
  Label,
  Section,
  LocalTask,
  TasksMdPreview,
  TasksMdResult,
  TaskStatus,
  UpdateStatus,
  SaveResult,
  ActivityEntry,
  ActivitySummary,
  Capture,
  CaptureRoute,
  RouteCaptureResult,
  DocFolder,
  Document,
  DocNote,
  DocsMdPreview,
  DocsMdResult,
  VaultNoteSummary,
  VaultNoteDetail,
  VaultSearchHit,
  VaultScanReport,
  VaultStatus,
  VaultSaveResult,
  FocusState,
  Goal,
  GoalWithProgress,
  GoalStatus,
  Milestone,
  LifeArea,
  Habit,
  HabitWithStats,
  HabitLog,
  HabitHeatmapEntry,
  ImportSummary,
  SyncStatus,
  TodoistMigrationPreview,
  TodoistMigrationResult,
  SyncReport,
  TodoistSyncStatus,
} from './index'

export interface DataProvider {
  settings: {
    checkSetupComplete(): Promise<boolean>
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    getAll(): Promise<Setting[]>
    clearAll(): Promise<void>
  }

  obsidian: {
    readTodayMd(): Promise<ParsedTodayMd>
    toggleCheckbox(fileName: string, lineNumber: number): Promise<ParsedTodayMd>
    importCaptures(): Promise<number>
  }

  todoist: {
    previewMigration(): Promise<TodoistMigrationPreview>
    migrate(): Promise<TodoistMigrationResult>
    migratedIds(): Promise<string[]>
  }

  calendar: {
    fetchEvents(date?: string): Promise<CalendarEvent[]>
    getCachedEvents(date: string): Promise<CalendarEvent[]>
    getFeeds(): Promise<CalendarFeed[]>
    addFeed(label: string, url: string, color: string): Promise<CalendarFeed>
    removeFeed(feedId: string): Promise<void>
  }

  captures: {
    list(limit?: number, includeConverted?: boolean): Promise<Capture[]>
    create(content: string, source?: string, context?: string): Promise<Capture>
    convertToTask(captureId: string, projectId?: string): Promise<LocalTask>
    delete(id: string): Promise<void>
    // Legacy quick captures (Obsidian)
    readQuickCaptures(): Promise<QuickCapture[]>
    writeQuickCapture(content: string): Promise<QuickCapture>
  }

  captureRoutes: {
    list(): Promise<CaptureRoute[]>
    create(opts: {
      prefix: string
      targetType: string
      docId?: string
      label: string
      color: string
      icon: string
    }): Promise<CaptureRoute>
    update(opts: {
      id: string
      prefix?: string
      targetType?: string
      docId?: string
      label?: string
      color?: string
      icon?: string
    }): Promise<void>
    delete(id: string): Promise<void>
    route(prefix: string, content: string): Promise<RouteCaptureResult>
  }

  projects: {
    list(): Promise<Project[]>
    create(name: string, color: string): Promise<Project>
    update(id: string, name?: string, color?: string): Promise<void>
    delete(id: string): Promise<void>
  }

  labels: {
    list(): Promise<Label[]>
    create(name: string, color: string): Promise<Label>
    update(id: string, opts: { name?: string; color?: string }): Promise<Label>
    delete(id: string): Promise<void>
    /** Replaces the full label set on a task; returns the updated task. */
    setForTask(taskId: string, labelIds: string[]): Promise<LocalTask>
  }

  sections: {
    list(projectId: string): Promise<Section[]>
    create(projectId: string, name: string): Promise<Section>
    rename(id: string, name: string): Promise<Section>
    delete(id: string): Promise<void>
    reorder(sectionIds: string[]): Promise<void>
  }

  tasks: {
    list(opts?: {
      projectId?: string
      dueDate?: string
      includeCompleted?: boolean
    }): Promise<LocalTask[]>
    create(opts: {
      content: string
      projectId?: string
      parentId?: string
      description?: string
      priority?: number
      dueDate?: string
      dueTime?: string
      durationMinutes?: number
      recurrenceRule?: string
      sectionId?: string
      labelIds?: string[]
    }): Promise<LocalTask>
    update(opts: {
      id: string
      content?: string
      description?: string
      projectId?: string
      priority?: number
      dueDate?: string
      clearDueDate?: boolean
      linkedDocId?: string | null
      dueTime?: string
      durationMinutes?: number
      recurrenceRule?: string
      sectionId?: string
      labelIds?: string[]
      clearDueTime?: boolean
      clearRecurrence?: boolean
      clearSection?: boolean
      clearDuration?: boolean
    }): Promise<LocalTask>
    updateStatus(id: string, status: TaskStatus, note?: string): Promise<void>
    complete(id: string): Promise<void>
    uncomplete(id: string): Promise<void>
    delete(id: string): Promise<void>
    reorder(taskIds: string[]): Promise<void>
    previewMarkdownMigration(): Promise<TasksMdPreview>
    migrateToMarkdown(): Promise<TasksMdResult>
  }

  docs: {
    getFolders(): Promise<DocFolder[]>
    createFolder(name: string): Promise<DocFolder>
    renameFolder(id: string, name: string): Promise<void>
    deleteFolder(id: string): Promise<void>
    getDocuments(folderId?: string): Promise<Document[]>
    getDocument(id: string): Promise<Document | null>
    createDocument(title: string, folderId?: string): Promise<Document>
    updateDocument(id: string, title?: string, content?: string, folderId?: string): Promise<Document>
    deleteDocument(id: string): Promise<void>
    searchDocuments(query: string): Promise<Document[]>
    getNotes(docId: string): Promise<DocNote[]>
    createNote(docId: string, content: string): Promise<DocNote>
    deleteNote(id: string): Promise<void>
    reorderNotes(noteIds: string[]): Promise<void>
    previewMarkdownMigration(): Promise<DocsMdPreview>
    migrateToMarkdown(): Promise<DocsMdResult>
  }

  vault: {
    status(): Promise<VaultStatus>
    rescan(): Promise<VaultScanReport | null>
    listNotes(): Promise<VaultNoteSummary[]>
    getNote(path: string): Promise<VaultNoteDetail | null>
    search(query: string, limit?: number): Promise<VaultSearchHit[]>
    backlinks(path: string): Promise<VaultNoteSummary[]>
    resolveLink(toPath: string): Promise<VaultNoteSummary | null>
    saveNote(path: string, content: string, expectedHash?: string | null): Promise<VaultSaveResult>
    createNote(path: string, content?: string): Promise<VaultNoteDetail>
    openInObsidian(path: string): Promise<void>
  }

  activity: {
    log(actionType: string, targetId?: string, metadata?: Record<string, unknown>): Promise<void>
    getLog(opts: {
      fromDate: string
      toDate: string
      actionType?: string
      targetId?: string
      limit?: number
    }): Promise<ActivityEntry[]>
    getSummary(date: string): Promise<ActivitySummary[]>
  }

  focus: {
    startSession(taskId: string, taskContent: string): Promise<void>
    endSession(taskId: string, outcome: string, durationSecs: number): Promise<void>
    getActive(): Promise<FocusState>
  }

  dailyState: {
    get(): Promise<DailyState>
    generatePriorities(
      energyLevel: string,
      calendarSummary: string,
      tasksSummary: string,
      obsidianSummary: string,
    ): Promise<Priority[]>
    readSessionLog(): Promise<string | null>
    readDailyBrief(date?: string): Promise<string | null>
    listBriefDates(): Promise<string[]>
    saveProgress(
      tasksCompleted: string,
      tasksOpen: string,
      tasksDeferred: string,
    ): Promise<SaveResult>
  }

  goals: {
    list(): Promise<GoalWithProgress[]>
    get(id: string): Promise<GoalWithProgress>
    create(opts: {
      name: string
      description?: string
      status?: GoalStatus
      lifeAreaId?: string
      startDate?: string
      targetDate?: string
      color?: string
    }): Promise<Goal>
    update(opts: {
      id: string
      name?: string
      description?: string
      status?: GoalStatus
      lifeAreaId?: string
      startDate?: string
      targetDate?: string
      color?: string
    }): Promise<Goal>
    delete(id: string): Promise<void>
    getMilestones(goalId: string): Promise<Milestone[]>
    createMilestone(opts: {
      goalId: string
      name: string
      targetDate?: string
    }): Promise<Milestone>
    updateMilestone(opts: {
      id: string
      name?: string
      targetDate?: string
      completed?: boolean
    }): Promise<Milestone>
    deleteMilestone(id: string): Promise<void>
    getLifeAreas(): Promise<LifeArea[]>
    createLifeArea(opts: { name: string; color: string; icon: string }): Promise<LifeArea>
    updateLifeArea(opts: {
      id: string
      name?: string
      color?: string
      icon?: string
    }): Promise<LifeArea>
    deleteLifeArea(id: string): Promise<void>
    importFromVault(): Promise<ImportSummary>
  }

  habits: {
    list(): Promise<HabitWithStats[]>
    create(opts: {
      name: string
      category?: string
      icon: string
      color: string
    }): Promise<Habit>
    update(opts: {
      id: string
      name?: string
      category?: string
      icon?: string
      color?: string
      active?: boolean
    }): Promise<Habit>
    delete(id: string): Promise<void>
    log(habitId: string, date?: string, intensity?: number): Promise<HabitLog>
    unlog(habitId: string, date?: string): Promise<void>
    getLogs(habitId?: string, days?: number): Promise<HabitLog[]>
    getHeatmap(habitId?: string, days?: number): Promise<HabitHeatmapEntry[]>
  }

  ai: {
    breakDownTask(taskContent: string, taskDescription?: string): Promise<string[]>
  }

  system: {
    openUrl(url: string): Promise<void>
    checkForUpdates(): Promise<UpdateStatus>
    getDemoStatus(): Promise<boolean>
    /** Switches to/from the throwaway demo database and restarts the app. */
    toggleDemoMode(on: boolean): Promise<void>
  }

  sync: {
    push(): Promise<number>
    pull(): Promise<number>
    getStatus(): Promise<SyncStatus>
    configure(tursoUrl: string, tursoToken: string): Promise<void>
    testConnection(tursoUrl: string, tursoToken: string): Promise<void>
    initializeRemote(): Promise<void>
    seedExisting(): Promise<number>
  }

  todoistSync: {
    syncNow(): Promise<SyncReport>
    status(): Promise<TodoistSyncStatus>
    setEnabled(enabled: boolean): Promise<void>
  }
}
