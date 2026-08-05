/**
 * DataProvider — platform-agnostic interface for all data operations.
 * This is the same interface used by the desktop app.
 * On mobile, it's implemented by SqliteProvider.
 */

import type {
  Setting,
  ParsedTodayMd,
  TodoistTaskRow,
  CalendarEvent,
  CalendarFeed,
  QuickCapture,
  Priority,
  DailyState,
  Project,
  LocalTask,
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
} from '@daily-triage/types';

export interface DataProvider {
  settings: {
    checkSetupComplete(): Promise<boolean>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    getAll(): Promise<Setting[]>;
    clearAll(): Promise<void>;
  };

  obsidian: {
    readTodayMd(): Promise<ParsedTodayMd>;
    toggleCheckbox(fileName: string, lineNumber: number): Promise<ParsedTodayMd>;
    importCaptures(): Promise<number>;
  };

  todoist: {
    fetchTasks(): Promise<TodoistTaskRow[]>;
    refreshTasks(): Promise<TodoistTaskRow[]>;
    completeTask(taskId: string): Promise<void>;
    snoozeTask(taskId: string): Promise<void>;
  };

  calendar: {
    fetchEvents(date?: string): Promise<CalendarEvent[]>;
    getCachedEvents(date: string): Promise<CalendarEvent[]>;
    getFeeds(): Promise<CalendarFeed[]>;
    addFeed(label: string, url: string, color: string): Promise<CalendarFeed>;
    removeFeed(feedId: string): Promise<void>;
  };

  captures: {
    list(limit?: number, includeConverted?: boolean): Promise<Capture[]>;
    create(content: string, source?: string): Promise<Capture>;
    convertToTask(captureId: string, projectId?: string): Promise<LocalTask>;
    delete(id: string): Promise<void>;
    readQuickCaptures(): Promise<QuickCapture[]>;
    writeQuickCapture(content: string): Promise<QuickCapture>;
  };

  captureRoutes: {
    list(): Promise<CaptureRoute[]>;
    create(opts: {
      prefix: string;
      targetType: string;
      docId?: string;
      label: string;
      color: string;
      icon: string;
    }): Promise<CaptureRoute>;
    update(opts: {
      id: string;
      prefix?: string;
      targetType?: string;
      docId?: string;
      label?: string;
      color?: string;
      icon?: string;
    }): Promise<void>;
    delete(id: string): Promise<void>;
    route(prefix: string, content: string): Promise<RouteCaptureResult>;
  };

  projects: {
    list(): Promise<Project[]>;
    create(name: string, color: string): Promise<Project>;
    update(id: string, name?: string, color?: string): Promise<void>;
    delete(id: string): Promise<void>;
  };

  tasks: {
    list(opts?: {
      projectId?: string;
      dueDate?: string;
      includeCompleted?: boolean;
    }): Promise<LocalTask[]>;
    create(opts: {
      content: string;
      projectId?: string;
      parentId?: string;
      description?: string;
      priority?: number;
      dueDate?: string;
    }): Promise<LocalTask>;
    update(opts: {
      id: string;
      content?: string;
      description?: string;
      projectId?: string;
      priority?: number;
      dueDate?: string;
      clearDueDate?: boolean;
    }): Promise<LocalTask>;
    updateStatus(id: string, status: TaskStatus, note?: string): Promise<void>;
    complete(id: string): Promise<void>;
    uncomplete(id: string): Promise<void>;
    delete(id: string): Promise<void>;
    reorder(taskIds: string[]): Promise<void>;
  };

  docs: {
    getFolders(): Promise<DocFolder[]>;
    createFolder(name: string): Promise<DocFolder>;
    renameFolder(id: string, name: string): Promise<void>;
    deleteFolder(id: string): Promise<void>;
    getDocuments(folderId?: string): Promise<Document[]>;
    getDocument(id: string): Promise<Document | null>;
    createDocument(title: string, folderId?: string): Promise<Document>;
    updateDocument(
      id: string,
      title?: string,
      content?: string,
      folderId?: string
    ): Promise<Document>;
    deleteDocument(id: string): Promise<void>;
    searchDocuments(query: string): Promise<Document[]>;
    getNotes(docId: string): Promise<DocNote[]>;
    createNote(docId: string, content: string): Promise<DocNote>;
    deleteNote(id: string): Promise<void>;
    reorderNotes(noteIds: string[]): Promise<void>;
    previewMarkdownMigration(): Promise<DocsMdPreview>;
    migrateToMarkdown(): Promise<DocsMdResult>;
  };

  activity: {
    log(
      actionType: string,
      targetId?: string,
      metadata?: Record<string, unknown>
    ): Promise<void>;
    getLog(opts: {
      fromDate: string;
      toDate: string;
      actionType?: string;
      targetId?: string;
      limit?: number;
    }): Promise<ActivityEntry[]>;
    getSummary(date: string): Promise<ActivitySummary[]>;
  };

  focus: {
    startSession(taskId: string, taskContent: string): Promise<void>;
    endSession(
      taskId: string,
      outcome: string,
      durationSecs: number
    ): Promise<void>;
    getActive(): Promise<FocusState>;
  };

  dailyState: {
    get(): Promise<DailyState>;
    generatePriorities(
      energyLevel: string,
      calendarSummary: string,
      tasksSummary: string,
      obsidianSummary: string
    ): Promise<Priority[]>;
    readSessionLog(): Promise<string | null>;
    readDailyBrief(date?: string): Promise<string | null>;
    listBriefDates(): Promise<string[]>;
    saveProgress(
      tasksCompleted: string,
      tasksOpen: string,
      tasksDeferred: string
    ): Promise<SaveResult>;
  };

  goals: {
    list(): Promise<GoalWithProgress[]>;
    get(id: string): Promise<GoalWithProgress>;
    create(opts: {
      name: string;
      description?: string;
      status?: GoalStatus;
      lifeAreaId?: string;
      startDate?: string;
      targetDate?: string;
      color?: string;
    }): Promise<Goal>;
    update(opts: {
      id: string;
      name?: string;
      description?: string;
      status?: GoalStatus;
      lifeAreaId?: string;
      startDate?: string;
      targetDate?: string;
      color?: string;
    }): Promise<Goal>;
    delete(id: string): Promise<void>;
    getMilestones(goalId: string): Promise<Milestone[]>;
    createMilestone(opts: {
      goalId: string;
      name: string;
      targetDate?: string;
    }): Promise<Milestone>;
    updateMilestone(opts: {
      id: string;
      name?: string;
      targetDate?: string;
      completed?: boolean;
    }): Promise<Milestone>;
    deleteMilestone(id: string): Promise<void>;
    getLifeAreas(): Promise<LifeArea[]>;
    createLifeArea(opts: {
      name: string;
      color: string;
      icon: string;
    }): Promise<LifeArea>;
    updateLifeArea(opts: {
      id: string;
      name?: string;
      color?: string;
      icon?: string;
    }): Promise<LifeArea>;
    deleteLifeArea(id: string): Promise<void>;
    importFromVault(): Promise<ImportSummary>;
  };

  habits: {
    list(): Promise<HabitWithStats[]>;
    create(opts: {
      name: string;
      category?: string;
      icon: string;
      color: string;
    }): Promise<Habit>;
    update(opts: {
      id: string;
      name?: string;
      category?: string;
      icon?: string;
      color?: string;
      active?: boolean;
    }): Promise<Habit>;
    delete(id: string): Promise<void>;
    log(habitId: string, date?: string, intensity?: number): Promise<HabitLog>;
    unlog(habitId: string, date?: string): Promise<void>;
    getLogs(habitId?: string, days?: number): Promise<HabitLog[]>;
    getHeatmap(habitId?: string, days?: number): Promise<HabitHeatmapEntry[]>;
  };

  ai: {
    breakDownTask(
      taskContent: string,
      taskDescription?: string
    ): Promise<string[]>;
  };

  system: {
    openUrl(url: string): Promise<void>;
    checkForUpdates(): Promise<UpdateStatus>;
  };

  sync: {
    push(): Promise<number>;
    pull(): Promise<number>;
    getStatus(): Promise<SyncStatus>;
    configure(tursoUrl: string, tursoToken: string): Promise<void>;
  };
}
