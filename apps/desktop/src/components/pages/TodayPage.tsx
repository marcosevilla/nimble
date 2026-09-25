import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarCheck, ChevronDown } from 'lucide-react'
import type { CalendarEvent, LocalTask } from '@nimble/types'
import { ReminderCatchUp } from '@/components/today/ReminderCatchUp'
import { ScheduleBox } from '@/components/today/ScheduleBox'
import { PrioritiesBox } from '@/components/today/PrioritiesBox'
import { StillOpenBox } from '@/components/today/StillOpenBox'
import { VaultBox } from '@/components/today/VaultBox'
import { BriefStrip } from '@/components/today/BriefStrip'
import { PastBrief } from '@/components/today/PastBrief'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { PageFrame } from '@/components/shared/PageFrame'
import { EmptyState } from '@/components/shared/EmptyState'
import { IconButton } from '@/components/shared/IconButton'
import { DateStrip } from '@/components/shared/DateStrip'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useObsidian } from '@/hooks/useObsidian'
import { useCalendar } from '@/hooks/useCalendar'
import { useLocalToday } from '@/hooks/useLocalToday'
import { useGreeting } from '@/hooks/useGreeting'
import { useDailyPriorities } from '@/hooks/useDailyPriorities'
import { useDataProvider } from '@/services/provider-context'
import { pickBriefDate, resolveBriefDate, shiftIsoDate } from '@/lib/briefDate'
import { todayKey } from '@/lib/keyGuard'
import { briefReady, loadTodayCompact, saveTodayCompact, splitDueTasks } from '@/lib/todayBrief'
import { cn } from '@/lib/utils'
import { WeatherChip } from '@/components/today/WeatherChip'
import { useWeather } from '@/hooks/useWeather'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { configValue } from '@/lib/briefLayout'
import { resolveUnits } from '@/lib/weather'

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

  // Past dates (Task 8): `picked` is `null` while following today, so the
  // rollover at midnight moves the card in the same render — no stale date.
  const [picked, setPicked] = useState<string | null>(null)
  const selected = resolveBriefDate(picked, today)
  const select = useCallback((d: string) => setPicked(pickBriefDate(d, today)), [today])
  const [briefDates, setBriefDates] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    Promise.all([dp.brief.listDates().catch(() => []), dp.dailyState.listBriefDates().catch(() => [])])
      .then(([a, b]) => { if (live) setBriefDates(new Set([...a, ...b])) })
    return () => { live = false }
  }, [dp, today])

  const { events, loadedDate: calLoadedFor, error: calError, goToToday } = useCalendar()
  // Calendar follows the new day (`goToToday` is a stable useCallback).
  useEffect(() => { goToToday() }, [today, goToToday])
  const briefSettings = useBriefSettingsStore((s) => s.settings)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const weatherEntry = briefSettings?.modules.find((m) => m.id === 'weather')
  const location = briefSettings?.location
  const weather = useWeather(!!weatherEntry?.enabled, `${today}|${location ? `${location.lat},${location.lon}` : ''}`)
  const [tomorrow, setTomorrow] = useState<CalendarEvent[]>([])
  useEffect(() => {
    let live = true
    dp.calendar.getCachedEvents(shiftIsoDate(today, 1))
      .then((ev) => { if (live) setTomorrow(ev.filter((e) => !e.all_day).slice(0, 2)) })
      .catch(() => { if (live) setTomorrow([]) })
    return () => { live = false }
  }, [dp, today])

  // Completed tasks are fetched so a checked-off task stays in Due today
  // (struck through) and counts toward the progress bar; splitDueTasks keeps
  // them out of Still open.
  const { tasks, loadedFor: tasksLoadedFor, remove, addTask, refresh } = useLocalTasks({ dueDate: today, includeCompleted: true })
  const { dueToday, stillOpen } = useMemo(() => splitDueTasks(tasks, today), [tasks, today])

  // Date-aware readiness: each hook reports the date its data belongs to, so
  // just past midnight yesterday's lists read as loading, never as today's.
  const calReady = calLoadedFor === today
  const tasksReady = tasksLoadedFor === today
  const ready = briefReady({ today, calendarLoadedFor: calLoadedFor, tasksLoadedFor })
  // Offline with nothing cached for today: the schedule is unknown, not empty.
  const calendarOffline = calReady && !!calError && events.length === 0

  // Display-only project lookup (`allProjects`, so a task in an archived
  // project keeps its badge and its name in the priorities prompt).
  const { allProjects } = useProjects()

  // Cached set + at most one auto generation per date, whether the brief is
  // expanded or compact (the strip shows the same priorities).
  const daily = useDailyPriorities({ today, ready, events, calendarUnavailable: calendarOffline, tasks, projects: allProjects })
  const priorities = daily.priorities // undefined = loading

  // Snapshot once the day's live data has landed (Review Focus 1 and 2).
  // `ready` stays true for the rest of the day: a calendar revalidation
  // keeps `loadedDate` on today.
  const snappedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || snappedFor.current === today) return
    snappedFor.current = today
    dp.brief.ensureSnapshot(today).then((brief) => {
      if (brief) setBriefDates((prev) => new Set(prev).add(today))
    }).catch(() => {})
  }, [dp, today, ready])

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
      else if (action === 'prev') { e.preventDefault(); select(shiftIsoDate(selected, -1)) }
      // `]` only pages forward while browsing the past — it never crosses today,
      // matching DateStrip's own next chevron (`disabled={selected >= today}`).
      else if (action === 'next' && selected < today) { e.preventDefault(); select(shiftIsoDate(selected, 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCompact, selected, today, select])

  // Due today rows: project badges and the subtask map for row stats.
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

  // Header count: today's top-level tasks (checked-off ones included) and the
  // open ones still carried from before, plus the Obsidian daily note's
  // checkboxes. Completed tasks from past days are not part of today.
  const { todayData } = useObsidian()
  const dueTodayOpen = dueToday.filter((t) => !t.completed).length
  const obsidianChecked = todayData?.tasks.filter((t) => t.checked).length ?? 0
  const obsidianTotal = todayData?.tasks.length ?? 0
  const completed = obsidianChecked + (dueToday.length - dueTodayOpen)
  const total = obsidianTotal + dueToday.length + stillOpen.length
  const remaining = total - completed

  return (
    <PageFrame
      title="Today"
      meta={greetingMeta(greeting, total > 0 ? remaining : null)}
      actions={
        <div className="flex items-center gap-3">
          {completed > 0 && <ProgressBar completed={completed} total={total} />}
          {selected === today && weatherEntry?.enabled && (
            <WeatherChip
              view={weather.view}
              loading={weather.loading}
              date={today}
              events={events}
              unit={resolveUnits(weatherEntry.config.units, navigator.language)}
              showRainNotes={configValue(weatherEntry.config, 'rain_notes', true)}
              live
            />
          )}
          <DateStrip briefDates={briefDates} selected={selected} today={today} onSelect={select} />
          {selected === today && (
            <IconButton
              aria-label={compact ? 'Expand the brief' : 'Compact the brief'}
              aria-expanded={!compact}
              onClick={toggleCompact}
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform duration-(--transition-fast)', !compact && 'rotate-180')}
              />
            </IconButton>
          )}
        </div>
      }
      bodyClassName="space-y-4"
    >
      <ReminderCatchUp />

      {selected !== today ? (
        <PastBrief date={selected} today={today} />
      ) : (
        <>
          {compact ? (
            <BriefStrip events={events} priorities={priorities} onExpand={toggleCompact} loading={!calReady} offline={calendarOffline} />
          ) : (
            <>
              <ScheduleBox events={events} loading={!calReady} error={calError} tomorrow={tomorrow} today={today} live />
              {/* Skeleton until the cache read lands and, with nothing stored,
                  until the day's data is ready and the one auto attempt runs. */}
              <PrioritiesBox
                priorities={priorities ?? null}
                loading={priorities === undefined || (priorities === null && !ready) || daily.generating}
                error={daily.error}
                noKey={daily.noKey}
                onRegenerate={daily.regenerate}
              />
            </>
          )}

          <CollapsibleSection title="Due today" count={tasksReady ? dueTodayOpen : undefined} defaultOpen={true} className="-mt-3!">
            {!tasksReady ? (
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

          <StillOpenBox tasks={stillOpen.slice(0, 5)} total={stillOpen.length} today={today} loading={!tasksReady} />

          <VaultBox date={today} />
        </>
      )}
    </PageFrame>
  )
}
