import {
  Check, Plus, Trash2, Pencil, Play, Square, SkipForward,
  FolderInput, Sparkles, Eye, Lightbulb, ArrowRightLeft,
  Target, Flag, Repeat, FileText, Folder,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/* One activity table for the Session timeline and the task-detail log
   (session P1-5). Color carries meaning, not category: four roles from
   themes.css, never a Tailwind palette hue. */
export const ACTIVITY_COLORS = {
  /** Something came into being or got finished. */
  done: 'text-success',
  /** Something was removed. */
  removed: 'text-destructive',
  /** Focus started, or an item moved between places. */
  moved: 'text-accent-blue',
  /** Edits, views and everything else. */
  neutral: 'text-muted-foreground',
} as const

export interface ActionMeta {
  /** Full label for the Session timeline ("Created task"). */
  label: string
  /** Optional shorter label for the task-detail log, where the task is implied ("Created"). */
  shortLabel?: string
  icon: LucideIcon
  color: (typeof ACTIVITY_COLORS)[keyof typeof ACTIVITY_COLORS]
}

const { done, removed, moved, neutral } = ACTIVITY_COLORS

export const ACTION_META: Record<string, ActionMeta> = {
  task_created: { label: 'Created task', shortLabel: 'Created', icon: Plus, color: done },
  task_completed: { label: 'Completed task', shortLabel: 'Completed', icon: Check, color: done },
  task_uncompleted: { label: 'Reopened task', shortLabel: 'Reopened', icon: ArrowRightLeft, color: neutral },
  task_deleted: { label: 'Deleted task', shortLabel: 'Deleted', icon: Trash2, color: removed },
  task_updated: { label: 'Updated task', shortLabel: 'Updated', icon: Pencil, color: neutral },
  status_changed: { label: 'Status changed', icon: ArrowRightLeft, color: neutral },
  task_moved: { label: 'Moved task', shortLabel: 'Moved', icon: FolderInput, color: moved },
  task_reordered: { label: 'Reordered tasks', icon: ArrowRightLeft, color: neutral },
  project_created: { label: 'Created project', icon: Plus, color: done },
  project_deleted: { label: 'Deleted project', icon: Trash2, color: removed },
  priorities_generated: { label: 'Generated priorities', icon: Sparkles, color: neutral },
  item_captured: { label: 'Saved note', icon: Lightbulb, color: neutral },
  capture_created: { label: 'Captured a note', icon: Lightbulb, color: done },
  capture_converted: { label: 'Converted note to task', icon: FolderInput, color: moved },
  capture_routed: { label: 'Routed a note', icon: FolderInput, color: moved },
  capture_route_created: { label: 'Added capture route', icon: Plus, color: done },
  capture_route_deleted: { label: 'Removed capture route', icon: Trash2, color: removed },
  focus_started: { label: 'Started focus', shortLabel: 'Focus started', icon: Play, color: moved },
  focus_completed: { label: 'Completed focus', shortLabel: 'Focus completed', icon: Check, color: done },
  focus_paused: { label: 'Paused focus', shortLabel: 'Focus paused', icon: Square, color: neutral },
  focus_resumed: { label: 'Resumed focus', shortLabel: 'Focus resumed', icon: Play, color: moved },
  focus_abandoned: { label: 'Stopped focus', shortLabel: 'Focus stopped', icon: Square, color: neutral },
  focus_skipped: { label: 'Skipped task', shortLabel: 'Skipped', icon: SkipForward, color: neutral },
  task_breakdown_requested: { label: 'AI breakdown', icon: Sparkles, color: neutral },
  task_breakdown_applied: { label: 'Applied breakdown', shortLabel: 'Subtasks created', icon: Sparkles, color: neutral },
  goal_created: { label: 'Created goal', icon: Target, color: done },
  goal_updated: { label: 'Updated goal', icon: Pencil, color: neutral },
  goal_deleted: { label: 'Deleted goal', icon: Trash2, color: removed },
  milestone_created: { label: 'Added milestone', icon: Flag, color: done },
  milestone_completed: { label: 'Completed milestone', icon: Check, color: done },
  milestone_deleted: { label: 'Deleted milestone', icon: Trash2, color: removed },
  habit_created: { label: 'Created habit', icon: Plus, color: done },
  habit_logged: { label: 'Logged a habit', icon: Repeat, color: done },
  habit_deleted: { label: 'Deleted habit', icon: Trash2, color: removed },
  doc_created: { label: 'Created doc', icon: FileText, color: done },
  doc_updated: { label: 'Updated doc', icon: Pencil, color: neutral },
  doc_deleted: { label: 'Deleted doc', icon: Trash2, color: removed },
  folder_created: { label: 'Created folder', icon: Folder, color: done },
  todoist_migrated: { label: 'Imported from Todoist', icon: FolderInput, color: moved },
  vault_import: { label: 'Imported from vault', icon: FolderInput, color: moved },
  app_opened: { label: 'Opened app', icon: Eye, color: neutral },
  page_viewed: { label: 'Viewed page', icon: Eye, color: neutral },
}
