import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarCheck, ChevronDown } from 'lucide-react'
import type { CalendarEvent, LocalTask, Priority } from '@nimble/types'
import { ReminderCatchUp } from '@/components/today/ReminderCatchUp'
import { ScheduleBox } from '@/components/today/ScheduleBox'
import { PrioritiesBox, PrioritiesSkeleton } from '@/components/today/PrioritiesBox'
import { StillOpenBox } from '@/components/today/StillOpenBox'
import { VaultBox } from '@/components/today/VaultBox'
import { BriefStrip } from '@/components/today/BriefStrip'
import { BriefBox } from '@/components/today/BriefBox'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { PageFrame } from '@/components/shared/PageFrame'
import { EmptyState } from '@/components/shared/EmptyState'
import { IconButton } from '@/components/shared/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useObsidian } from '@/hooks/useObsidian'
import { useCalendar } from '@/hooks/useCalendar'
import { useLocalToday } from '@/hooks/useLocalToday'
import { useGreeting } from '@/hooks/useGreeting'
import { useDataProvider } from '@/services/provider-context'
import { shiftIsoDate } from '@/lib/briefDate'
import { todayKey } from '@/lib/keyGuard'
import { loadTodayCompact, saveTodayCompact, splitDueTasks } from '@/lib/todayBrief'
import { cn } from '@/lib/utils'

/** The greeting lives in the header's meta slot — one title per page
 *  (cross-cutting move 1: the second text-title h2 is gone). */
function greetingMeta(greeting: string, remaining: number | null): string {
  if (remaining === null) return greeting
  return `${greeting} · ${remaining === 0 ? 'all done for today' : `${remaining} remaining`}`
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="flex items-center gap-2 animate-progress-enter" title={`${completed} of ${total} done today`}>
      <div className="w-20 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-(--transition-slow)',
            pct === 100 ? 'bg-success' : 'bg-foreground/40',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-label text-muted-foreground tabular-nums">
        {completed}/{total}
      </span>
    </div>
  )
}

/** Today is the brief: fixed containers, always expanded unless compacted
 *  by hand (`b` or the chevron; spec §0 Q3). Everything re-reads when the
 *  local date rolls over (Review Focus 1). */
export function TodayPage() {
  const dp = useDataProvider()
  const today = useLocalToday()
  const greeting = useGreeting()
  const [compact, setCompact] = useState(loadTodayCompact)
  const toggleCompact = useCallback(() => setCompact((c) => { saveTodayCompact(!c); return !c }), [])

  const { events, loading: calLoading, selectedDate: calDate, goToToday } = useCalendar()
  // Calendar follows the new day (`goToToday` is a stable useCallback).
  useEffect(() => { goToToday() }, [today, goToToday])
  const [tomorrow, setTomorrow] = useState<CalendarEvent[]>([])
  useEffect(() => {
    let live = true
    dp.calendar.getCachedEvents(shiftIsoDate(today, 1))
      .then((ev) => { if (live) setTomorrow(ev.filter((e) => !e.all_day).slice(0, 2)) })
      .catch(() => { if (live) setTomorrow([]) })
    return () => { live = false }
  }, [dp, today])

  const { tasks, loading: tasksLoading, remove, addTask, refresh } = useLocalTasks({ dueDate: today, includeCompleted: false })
  const { dueToday, stillOpen } = useMemo(() => splitDueTasks(tasks, today), [tasks, today])

  const [cached, setCached] = useState<{ date: string; priorities: Priority[] | null } | null>(null)
  useEffect(() => {
    let live = true
    dp.dailyState.get().then((s) => { if (live) setCached({ date: today, priorities: s.priorities }) })
      .catch(() => { if (live) setCached({ date: today, priorities: null }) })
    return () => { live = false }
  }, [dp, today]) // decision 6: re-read on a new day
  const priorities = cached?.date === today ? cached.priorities : undefined // undefined = loading
  // A fresh set replaces the cached one, so the compact strip shows it too.
  const handleGenerated = useCallback((p: Priority[]) => setCached({ date: today, priorities: p }), [today])

  // The day's live data has landed: the calendar is on `today` and done
  // loading, and the task list has loaded. Latched per date, so a later
  // calendar refresh never unmounts Top priorities (which would reset its
  // once-a-day generation guard).
  const [readyFor, setReadyFor] = useState<string | null>(null)
  if (readyFor !== today && !calLoading && !tasksLoading && calDate === today) setReadyFor(today)

  // Snapshot once the live data has landed (Review Focus 2).
  const snappedFor = useRef<string | null>(null)
  useEffect(() => {
    if (readyFor !== today || snappedFor.current === today) return
    snappedFor.current = today
    dp.brief.ensureSnapshot(today).catch(() => {})
  }, [dp, today, readyFor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = todayKey({
        key: e.key,
        target: e.target as HTMLElement | null,
        defaultPrevented: e.defaultPrevented,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      })
      if (action === 'toggle') { e.preventDefault(); toggleCompact() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCompact])

  // Due today rows: display-only project lookup (`allProjects`, so a task in
  // an archived project keeps its badge) and the subtask map for row stats.
  const { allProjects } = useProjects()
  const projectMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {}
    for (const p of allProjects) map[p.id] = { name: p.name, color: p.color }
    return map
  }, [allProjects])
  const subtaskMap = useMemo(() => {
    const map: Record<string, LocalTask[]> = {}
    for (const t of tasks) {
      if (t.parent_id) {
        if (!map[t.parent_id]) map[t.parent_id] = []
        map[t.parent_id].push(t)
      }
    }
    return map
  }, [tasks])
  const handleAddSubtask = useCallback(
    async (parentId: string, content: string) => {
      const parent = tasks.find((t) => t.id === parentId)
      await addTask(content, { parentId, projectId: parent?.project_id, dueDate: today })
      refresh()
    },
    [tasks, addTask, refresh, today],
  )

  // Header count, as before: top-level local tasks plus the Obsidian daily
  // note's checkboxes.
  const { todayData } = useObsidian()
  const topLevel = tasks.filter((t) => !t.parent_id)
  const obsidianChecked = todayData?.tasks.filter((t) => t.checked).length ?? 0
  const obsidianTotal = todayData?.tasks.length ?? 0
  const completed = obsidianChecked + topLevel.filter((t) => t.completed).length
  const total = obsidianTotal + topLevel.length
  const remaining = total - completed

  return (
    <PageFrame
      title="Today"
      meta={greetingMeta(greeting, total > 0 ? remaining : null)}
      actions={
        <div className="flex items-center gap-3">
          {completed > 0 && <ProgressBar completed={completed} total={total} />}
          <IconButton
            aria-label={compact ? 'Expand the brief' : 'Compact the brief'}
            aria-expanded={!compact}
            onClick={toggleCompact}
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-(--transition-fast)', !compact && 'rotate-180')}
            />
          </IconButton>
        </div>
      }
      bodyClassName="space-y-4"
    >
      <ReminderCatchUp />

      {compact ? (
        <BriefStrip events={events} priorities={priorities} onExpand={toggleCompact} />
      ) : (
        <>
          <ScheduleBox events={events} loading={calLoading} tomorrow={tomorrow} today={today} live />
          {/* Never mounted before the cache read, so it can't auto-generate
              over a set that is already stored; with nothing stored, it also
              waits for the day's calendar so generation sees the schedule. */}
          {priorities === undefined || (priorities === null && readyFor !== today) ? (
            <BriefBox title="Top priorities">
              <PrioritiesSkeleton />
            </BriefBox>
          ) : (
            <PrioritiesBox key={today} priorities={priorities} onGenerated={handleGenerated} />
          )}
        </>
      )}

      <CollapsibleSection title="Due today" count={dueToday.length} defaultOpen={true} className="-mt-3!">
        {tasksLoading ? (
          <div className="space-y-1.5 pt-1">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : dueToday.length === 0 ? (
          <EmptyState icon={CalendarCheck} kbd="Q" size="compact">Nothing due today. Add a task with</EmptyState>
        ) : (
          <div>
            {dueToday.map((task) => {
              const subs = subtaskMap[task.id] ?? []
              const done = subs.filter((s) => s.completed || s.status === 'complete').length
              const stats = subs.length > 0 ? { done, total: subs.length } : undefined
              return (
                <div key={task.id}>
                  <LocalTaskRow
                    task={task}
                    projectName={projectMap[task.project_id]?.name}
                    projectColor={projectMap[task.project_id]?.color}
                    subtaskStats={stats}
                    onDelete={remove}
                    onAddSubtask={handleAddSubtask}
                  />
                </div>
              )
            })}
          </div>
        )}
      </CollapsibleSection>

      <StillOpenBox tasks={stillOpen.slice(0, 5)} total={stillOpen.length} today={today} />

      <VaultBox date={today} />
    </PageFrame>
  )
}
