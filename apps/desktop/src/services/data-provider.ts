/**
 * DataProvider — re-export shim.
 *
 * The interface itself now lives in `@nimble/types`
 * (`packages/types/src/data-provider.ts`) so desktop, web, and any future
 * client share ONE definition and drift becomes a compile error rather than a
 * silent fork. This module stays as a compatibility alias for the existing
 * `@/services/data-provider` import path — prefer importing from
 * `@nimble/types` in new code.
 *
 * ⚠️ This module is TYPE-ONLY at runtime. Importing a value from it (e.g.
 * `getDataProvider`) passes tsc but throws "Importing binding name not found"
 * at module eval and blanks the whole app. Runtime provider access comes from
 * `@/services/provider-context`.
 */

export type { DataProvider } from '@nimble/types'

// Domain types re-exported so consumers can import them from data-provider
// instead of reaching into tauri.ts.
export type {
  Setting,
  ParsedTodayMd,
  TodoistMigrationPreview,
  TodoistMigrationResult,
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
  SyncReport,
  TodoistSyncStatus,
} from '@nimble/types'
