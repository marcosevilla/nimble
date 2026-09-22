import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import type { ActivityEntry } from '@nimble/types'
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'
import { Meta } from '@/components/shared/typography'
import { ACTION_META, ACTIVITY_COLORS } from '@/lib/activityMeta'

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
            const meta = ACTION_META[entry.action_type] ?? { label: entry.action_type, icon: Zap, color: ACTIVITY_COLORS.neutral }
            const Icon = meta.icon
            const desc = getDescription(entry)
            return (
              <div key={entry.id} className="flex items-center gap-2 py-1">
                <span className="w-14 shrink-0 text-right text-label tabular-nums text-muted-foreground">
                  {formatTime(entry.created_at)}
                </span>
                <Icon className={cn('size-3 shrink-0', meta.color)} />
                <Meta>
                  {meta.shortLabel ?? meta.label}
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
