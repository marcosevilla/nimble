import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { ActivityEntry } from '@daily-triage/types'
import { cn } from '@/lib/utils'
import {
  Check, Plus, Trash2, Pencil, Play, Square, SkipForward,
  FolderInput, Sparkles, Zap, ArrowRightLeft,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Meta } from '@/components/shared/typography'

const ACTION_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  task_created: { label: 'Created', icon: Plus, color: 'text-green-500' },
  task_completed: { label: 'Completed', icon: Check, color: 'text-green-500' },
  task_uncompleted: { label: 'Reopened', icon: ArrowRightLeft, color: 'text-orange-500' },
  task_deleted: { label: 'Deleted', icon: Trash2, color: 'text-red-500/60' },
  task_updated: { label: 'Updated', icon: Pencil, color: 'text-accent-blue' },
  status_changed: { label: 'Status changed', icon: ArrowRightLeft, color: 'text-accent-blue' },
  task_moved: { label: 'Moved', icon: FolderInput, color: 'text-accent-blue' },
  focus_started: { label: 'Focus started', icon: Play, color: 'text-accent-blue' },
  focus_completed: { label: 'Focus completed', icon: Check, color: 'text-green-500' },
  focus_paused: { label: 'Focus paused', icon: Square, color: 'text-muted-foreground' },
  focus_resumed: { label: 'Focus resumed', icon: Play, color: 'text-accent-blue' },
  focus_abandoned: { label: 'Focus stopped', icon: Square, color: 'text-muted-foreground' },
  focus_skipped: { label: 'Skipped', icon: SkipForward, color: 'text-muted-foreground' },
  task_breakdown_requested: { label: 'AI breakdown', icon: Sparkles, color: 'text-purple-500' },
  task_breakdown_applied: { label: 'Subtasks created', icon: Sparkles, color: 'text-purple-500' },
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getDescription(entry: ActivityEntry): string | null {
  const meta = entry.metadata as Record<string, unknown> | null
  if (!meta) return null
  if (meta.old_status && meta.new_status) return `${meta.old_status} → ${meta.new_status}${meta.note ? ` (${meta.note})` : ''}`
  if (meta.duration_secs) return `${Math.floor(Number(meta.duration_secs) / 60)}m focused`
  if (meta.fields_changed) return (meta.fields_changed as string[]).join(', ')
  if (meta.subtask_count) return `${meta.subtask_count} subtasks`
  return null
}

export function TaskActivityLog({ taskId }: { taskId: string }) {
  const dp = useDataProvider()
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const log = await dp.activity.getLog({
        fromDate: '2020-01-01',
        toDate: new Date().toISOString().slice(0, 10),
        targetId: taskId,
        limit: 50,
      })
      setEntries(log)
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [taskId, dp])

  useEffect(() => { refresh() }, [refresh])

  if (loading || entries.length === 0) return null

  // Group by date
  const grouped: Record<string, ActivityEntry[]> = {}
  for (const entry of entries) {
    const date = formatDate(entry.created_at)
    if (!grouped[date]) grouped[date] = []
    grouped[date].push(entry)
  }

  return (
    <div className="space-y-3">
      <h3 className="text-label text-muted-foreground">
        Activity
      </h3>
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date}>
          <p className="text-label text-muted-foreground mb-1">{date}</p>
          {items.map((entry) => {
            const meta = ACTION_META[entry.action_type] ?? { label: entry.action_type, icon: Zap, color: 'text-muted-foreground' }
            const Icon = meta.icon
            const desc = getDescription(entry)
            return (
              <div key={entry.id} className="flex items-center gap-2 py-1">
                <span className="w-14 shrink-0 text-right text-label tabular-nums text-muted-foreground">
                  {formatTime(entry.created_at)}
                </span>
                <Icon className={cn('size-3 shrink-0', meta.color)} />
                <Meta>
                  {meta.label}
                  {desc && <span className="ml-1 text-muted-foreground">— {desc}</span>}
                </Meta>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
