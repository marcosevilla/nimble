import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { ActivityEntry, ActivitySummary } from '@nimble/types'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Check, Plus, Trash2, Pencil, Play, Square, SkipForward,
  FolderInput, Sparkles, Zap, Eye, Lightbulb, ArrowRightLeft,
  Target, Flag, Repeat, FileText, Folder,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ── Action metadata ──

interface ActionMeta {
  label: string
  icon: LucideIcon
  color: string
}

const ACTION_META: Record<string, ActionMeta> = {
  task_created: { label: 'Created task', icon: Plus, color: 'text-green-500' },
  task_completed: { label: 'Completed task', icon: Check, color: 'text-green-500' },
  task_uncompleted: { label: 'Reopened task', icon: ArrowRightLeft, color: 'text-orange-500' },
  task_deleted: { label: 'Deleted task', icon: Trash2, color: 'text-red-500' },
  task_updated: { label: 'Updated task', icon: Pencil, color: 'text-accent-blue' },
  status_changed: { label: 'Status changed', icon: ArrowRightLeft, color: 'text-accent-blue' },
  task_moved: { label: 'Moved task', icon: FolderInput, color: 'text-accent-blue' },
  task_reordered: { label: 'Reordered tasks', icon: ArrowRightLeft, color: 'text-muted-foreground' },
  project_created: { label: 'Created project', icon: Plus, color: 'text-indigo-500' },
  project_deleted: { label: 'Deleted project', icon: Trash2, color: 'text-red-500' },
  priorities_generated: { label: 'Generated priorities', icon: Sparkles, color: 'text-purple-500' },
  item_captured: { label: 'Saved note', icon: Lightbulb, color: 'text-amber-500' },
  capture_created: { label: 'Captured a note', icon: Lightbulb, color: 'text-amber-500' },
  capture_converted: { label: 'Converted note to task', icon: FolderInput, color: 'text-accent-blue' },
  capture_routed: { label: 'Routed a note', icon: FolderInput, color: 'text-amber-500' },
  capture_route_created: { label: 'Added capture route', icon: Plus, color: 'text-amber-500' },
  capture_route_deleted: { label: 'Removed capture route', icon: Trash2, color: 'text-red-500' },
  focus_started: { label: 'Started focus', icon: Play, color: 'text-accent-blue' },
  focus_completed: { label: 'Completed focus', icon: Check, color: 'text-green-500' },
  focus_paused: { label: 'Paused focus', icon: Square, color: 'text-muted-foreground' },
  focus_resumed: { label: 'Resumed focus', icon: Play, color: 'text-accent-blue' },
  focus_abandoned: { label: 'Stopped focus', icon: Square, color: 'text-muted-foreground' },
  focus_skipped: { label: 'Skipped task', icon: SkipForward, color: 'text-muted-foreground' },
  task_breakdown_requested: { label: 'AI breakdown', icon: Sparkles, color: 'text-purple-500' },
  task_breakdown_applied: { label: 'Applied breakdown', icon: Sparkles, color: 'text-purple-500' },
  goal_created: { label: 'Created goal', icon: Target, color: 'text-indigo-500' },
  goal_updated: { label: 'Updated goal', icon: Pencil, color: 'text-indigo-500' },
  goal_deleted: { label: 'Deleted goal', icon: Trash2, color: 'text-red-500' },
  milestone_created: { label: 'Added milestone', icon: Flag, color: 'text-indigo-500' },
  milestone_completed: { label: 'Completed milestone', icon: Check, color: 'text-green-500' },
  milestone_deleted: { label: 'Deleted milestone', icon: Trash2, color: 'text-red-500' },
  habit_created: { label: 'Created habit', icon: Plus, color: 'text-teal-500' },
  habit_logged: { label: 'Logged a habit', icon: Repeat, color: 'text-teal-500' },
  habit_deleted: { label: 'Deleted habit', icon: Trash2, color: 'text-red-500' },
  doc_created: { label: 'Created doc', icon: FileText, color: 'text-accent-blue' },
  doc_updated: { label: 'Updated doc', icon: Pencil, color: 'text-accent-blue' },
  doc_deleted: { label: 'Deleted doc', icon: Trash2, color: 'text-red-500' },
  folder_created: { label: 'Created folder', icon: Folder, color: 'text-accent-blue' },
  todoist_migrated: { label: 'Imported from Todoist', icon: FolderInput, color: 'text-accent-blue' },
  vault_import: { label: 'Imported from vault', icon: FolderInput, color: 'text-accent-blue' },
  app_opened: { label: 'Opened app', icon: Eye, color: 'text-muted-foreground' },
  page_viewed: { label: 'Viewed page', icon: Eye, color: 'text-muted-foreground' },
}

/** Fallback for unknown action types: snake_case → sentence case ("thing_happened" → "Thing happened"). */
function prettifyActionType(actionType: string): string {
  const words = actionType.split('_').filter(Boolean).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const NOISE_ACTIONS = new Set(['app_opened', 'page_viewed'])

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function getDescription(entry: ActivityEntry): string | null {
  const meta = entry.metadata as Record<string, unknown> | null
  if (!meta) return null

  if (meta.old_status && meta.new_status) return `${meta.old_status} → ${meta.new_status}${meta.note ? ` (${meta.note})` : ''}`
  if (meta.content) return String(meta.content)
  if (meta.task_content) return String(meta.task_content)
  if (meta.name) return String(meta.name)
  if (meta.duration_secs) return `Focused for ${formatDuration(Number(meta.duration_secs))}`
  if (meta.fields_changed) return `Changed: ${(meta.fields_changed as string[]).join(', ')}`
  if (meta.page) return String(meta.page)
  if (meta.energy_level) return `Energy: ${meta.energy_level}`
  if (meta.subtask_count) return `${meta.subtask_count} subtasks`
  return null
}

// ── Summary row ──

function SummaryBar({ summaries }: { summaries: ActivitySummary[] }) {
  const meaningful = summaries.filter((s) => !NOISE_ACTIONS.has(s.action_type))
  if (meaningful.length === 0) return null

  const total = meaningful.reduce((sum, s) => sum + s.count, 0)
  const completed = summaries.find((s) => s.action_type === 'task_completed')?.count ?? 0
  const focused = summaries.find((s) => s.action_type === 'focus_completed')?.count ?? 0
  const created = summaries.find((s) => s.action_type === 'task_created')?.count ?? 0

  const parts = [`${total} ${total === 1 ? 'action' : 'actions'}`]
  if (completed > 0) parts.push(`${completed} completed`)
  if (focused > 0) parts.push(`${focused} focus ${focused === 1 ? 'session' : 'sessions'}`)
  if (created > 0) parts.push(`${created} created`)

  return (
    <p className="text-meta text-muted-foreground tabular-nums">
      {parts.join(' · ')}
    </p>
  )
}

// ── Timeline entry ──

function TimelineEntry({ entry }: { entry: ActivityEntry }) {
  const meta = ACTION_META[entry.action_type] ?? {
    label: prettifyActionType(entry.action_type),
    icon: Zap,
    color: 'text-muted-foreground',
  }
  const Icon = meta.icon
  const description = getDescription(entry)
  const isNoise = NOISE_ACTIONS.has(entry.action_type)

  return (
    <div className={cn('flex items-start gap-3 py-1.5', isNoise && 'opacity-40')}>
      {/* Time */}
      <span className="w-16 shrink-0 text-right text-label tabular-nums text-muted-foreground pt-0.5">
        {formatTime(entry.created_at)}
      </span>

      {/* Icon */}
      <div className={cn('mt-0.5 shrink-0', meta.color)}>
        <Icon className="size-3.5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <span className="text-body">{meta.label}</span>
        {description && (
          <span className="ml-1.5 text-body text-muted-foreground break-words">
            — {description}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Main component ──

export function ActivityTimeline() {
  const dp = useDataProvider()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [summaries, setSummaries] = useState<ActivitySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showNoise, setShowNoise] = useState(false)

  const today = new Date().toISOString().slice(0, 10)

  const refresh = useCallback(async () => {
    try {
      const [log, summary] = await Promise.all([
        dp.activity.getLog({ fromDate: today, toDate: today, limit: 200 }),
        dp.activity.getSummary(today),
      ])
      setEntries(log)
      setSummaries(summary)
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [today, dp])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-6" />
        ))}
      </div>
    )
  }

  const filtered = showNoise ? entries : entries.filter((e) => !NOISE_ACTIONS.has(e.action_type))

  if (entries.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No activity yet today. It'll appear here as you use the app.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <SummaryBar summaries={summaries} />

      {/* Filter toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-label text-muted-foreground">
          Timeline
        </h3>
        <button
          onClick={() => setShowNoise(!showNoise)}
          className="text-label text-muted-foreground hover:text-foreground transition-colors"
        >
          {showNoise ? 'Hide noise' : 'Show all'}
        </button>
      </div>

      {/* Timeline */}
      <div className="space-y-0">
        {filtered.map((entry) => (
          <TimelineEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}
