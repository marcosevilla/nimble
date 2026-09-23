import { useEffect, useMemo, useState } from 'react'
import { ActivityHeatmap } from '@/components/activity/ActivityHeatmap'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionTitle } from '@/components/shared/typography'
import { localIsoDate } from '@/lib/briefDate'
import { useDataProvider } from '@/services/provider-context'
import type { ActivityEntry, HabitHeatmapEntry } from '@nimble/types'

type ActivityMode = 'both' | 'habits' | 'tasks'

const MODES: { value: ActivityMode; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'habits', label: 'Habits' },
  { value: 'tasks', label: 'Tasks' },
]
const MODE_KEY = 'nimble.activityMode'
const DAYS_BACK = 365
/** Completing a recurring task logs `task_recurred`, not `task_completed`. */
const TASK_DONE_TYPES = ['task_completed', 'task_recurred'] as const

function loadMode(): ActivityMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'both' || saved === 'habits' || saved === 'tasks') return saved
  } catch {
    // Storage unavailable
  }
  return 'both'
}

function entryDate(entry: ActivityEntry): string {
  const d = new Date(entry.created_at)
  return Number.isNaN(d.getTime()) ? entry.created_at.slice(0, 10) : localIsoDate(d)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Right-column Activity tab: one heatmap over habit check-ins, finished tasks, or both. */
export function ActivityPanel() {
  const dp = useDataProvider()
  const [mode, setMode] = useState<ActivityMode>(loadMode)
  const [habitDays, setHabitDays] = useState<Record<string, number> | null>(null)
  const [taskDays, setTaskDays] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    let live = true
    dp.habits
      .getHeatmap(undefined, DAYS_BACK)
      .then((entries: HabitHeatmapEntry[]) => {
        const days: Record<string, number> = {}
        for (const e of entries) days[e.date] = (days[e.date] ?? 0) + e.intensity
        if (live) setHabitDays(days)
      })
      .catch(() => live && setHabitDays({}))

    const to = new Date()
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - DAYS_BACK)
    Promise.all(
      TASK_DONE_TYPES.map((actionType) =>
        dp.activity.getLog({ fromDate: localIsoDate(from), toDate: localIsoDate(to), actionType, limit: 5000 }),
      ),
    )
      .then((logs) => {
        const days: Record<string, number> = {}
        for (const entry of logs.flat()) {
          const date = entryDate(entry)
          days[date] = (days[date] ?? 0) + 1
        }
        if (live) setTaskDays(days)
      })
      .catch(() => live && setTaskDays({}))

    return () => {
      live = false
    }
  }, [dp])

  const values = useMemo(() => {
    if (!habitDays || !taskDays) return {}
    if (mode === 'habits') return habitDays
    if (mode === 'tasks') return taskDays
    const both: Record<string, number> = { ...habitDays }
    for (const [date, n] of Object.entries(taskDays)) both[date] = (both[date] ?? 0) + n
    return both
  }, [mode, habitDays, taskDays])

  const describe = (date: string) => {
    const habits = habitDays?.[date] ?? 0
    const tasks = taskDays?.[date] ?? 0
    if (mode === 'habits') return habits === 0 ? 'no check-ins' : plural(habits, 'check-in', 'check-ins')
    if (mode === 'tasks') return tasks === 0 ? 'no tasks finished' : plural(tasks, 'task finished', 'tasks finished')
    if (habits === 0 && tasks === 0) return 'nothing logged'
    return `${plural(habits, 'check-in', 'check-ins')} · ${plural(tasks, 'task', 'tasks')}`
  }

  const selectMode = (next: ActivityMode) => {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // Remembered for this session only
    }
  }

  const label =
    mode === 'habits' ? 'Habit check-ins' : mode === 'tasks' ? 'Finished tasks' : 'Habit check-ins and finished tasks'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle as="h2">Activity</SectionTitle>
        <ToggleGroup
          value={[mode]}
          onValueChange={(val) => {
            const next = val[0] as ActivityMode | undefined
            if (next) selectMode(next)
          }}
          size="sm"
          aria-label="Show activity for"
        >
          {MODES.map((m) => (
            <ToggleGroupItem key={m.value} value={m.value} className="px-2 text-label">
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {habitDays && taskDays ? (
        <ActivityHeatmap values={values} describe={describe} label={label} />
      ) : (
        <Skeleton className="h-28 w-full" />
      )}
    </div>
  )
}
