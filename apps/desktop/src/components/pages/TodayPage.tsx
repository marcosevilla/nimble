import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Brief, CalendarEvent, LocalTask } from '@nimble/types'
import { BriefStrip } from '@/components/today/BriefStrip'
import { BriefMenu } from '@/components/today/BriefMenu'
import { ModuleBox } from '@/components/today/ModuleBox'
import { BriefSkeleton, PastBrief } from '@/components/today/PastBrief'
import { BriefLiveContext, type BriefLive } from '@/components/today/briefLive'
import { briefModuleInfo } from '@/components/today/briefModules'
import { arrangeBrief, FALLBACK_LAYOUT, normalizeLayout } from '@/lib/briefLayout'
import { ReminderCatchUp } from '@/components/today/ReminderCatchUp'
import { PageFrame } from '@/components/shared/PageFrame'
import { IconButton } from '@/components/shared/IconButton'
import { DateStrip } from '@/components/shared/DateStrip'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useCalendar } from '@/hooks/useCalendar'
import { useLocalToday } from '@/hooks/useLocalToday'
import { useGreeting } from '@/hooks/useGreeting'
import { useBriefComposition } from '@/hooks/useBriefComposition'
import { BriefItemsContext } from '@/components/today/briefContext'
import { BriefSummary } from '@/components/today/BriefSummary'
import { useDataProvider } from '@/services/provider-context'
import { pickBriefDate, resolveBriefDate, shiftIsoDate } from '@/lib/briefDate'
import { todayKey } from '@/lib/keyGuard'
import { briefReady, loadTodayCompact, saveTodayCompact, splitDueTasks } from '@/lib/todayBrief'
import { cn } from '@/lib/utils'
import { useWeather } from '@/hooks/useWeather'
import { useBriefSettingsStore } from '@/stores/briefSettingsStore'
import { TodaySetup } from '@/components/today/setup/TodaySetup'
import { useTodaySetupStore } from '@/stores/todaySetupStore'

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

  // Brief settings (desktop) decide the boxes. The web has none: it uses the
  // layout the Mac recorded in today's synced row, else the phase-1 boxes.
  const settings = useBriefSettingsStore((s) => s.settings)
  const settingsStatus = useBriefSettingsStore((s) => s.status)
  useEffect(() => { void useBriefSettingsStore.getState().load() }, [])
  const [todayRow, setTodayRow] = useState<{ date: string; brief: Brief | null } | null>(null)
  const rowToday = todayRow?.date === today ? todayRow.brief : null
  const layout = settings?.modules
    ?? (settingsStatus === 'unsupported' || settingsStatus === 'error'
      ? (rowToday ? normalizeLayout(rowToday.layout) : FALLBACK_LAYOUT)
      : null)
  const isOn = (id: string) => !!layout?.some((e) => e.id === id && e.enabled)

  // First Today visit while the setup never completed (addendum §3). Desktop
  // only: the web has no settings. Closing always follows a successful save,
  // so this can't reopen in a loop.
  const setupOpen = useTodaySetupStore((s) => s.open)
  useEffect(() => {
    if (settings && settings.setup_completed_at === null && !useTodaySetupStore.getState().open) {
      useTodaySetupStore.getState().start(settings)
    }
  }, [settings])
  const focusBrief = useCallback(() => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-brief-body]')?.focus())
  }, [])
  // The setup decides today's layout, so nothing that depends on it runs
  // before it's done: no AI call (a "No AI" preset must mean none) and no
  // snapshot (written once, it would freeze the default layout). Pending
  // while the settings load, while setup is open, and while it's due.
  const setupPending =
    setupOpen || settingsStatus === 'idle' || settingsStatus === 'loading' || settings?.setup_completed_at === null

  // Rust composes the AI slots (phase 3): once the day's data landed and the
  // setup (which decides the layout) is done, ask once for today if it's due.
  const composition = useBriefComposition({ date: today, today, ready: ready && !setupPending })
  const location = settings?.location
  const weather = useWeather(isOn('weather'), `${today}|${location ? `${location.lat},${location.lon}` : ''}`)

  // Snapshot once the day's live data has landed (Review Focus 1–2 of phase 1);
  // the web resolves null there and reads the Mac's row instead.
  const snappedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || setupPending || snappedFor.current === today) return
    snappedFor.current = today
    dp.brief.ensureSnapshot(today)
      .then((brief) => brief ?? dp.brief.get(today))
      .then((brief) => {
        setTodayRow({ date: today, brief })
        if (brief) setBriefDates((prev) => new Set(prev).add(today))
      })
      .catch(() => {})
  }, [dp, today, ready, setupPending])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The setup owns ↵/Esc; b, [ and ] stand down while it's open.
      if (useTodaySetupStore.getState().open) return
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
  // open ones still carried from before. Completed tasks from past days are
  // not part of today.
  const dueTodayOpen = dueToday.filter((t) => !t.completed).length
  const completed = dueToday.length - dueTodayOpen
  const total = dueToday.length + stillOpen.length
  const remaining = total - completed

  const live: BriefLive = {
    today, events, tomorrow, calReady, calError, calendarOffline,
    dueToday, stillOpen, tasksReady, ready,
    weather, projectMap, subtaskMap, removeTask: remove, addSubtask: handleAddSubtask, brief: rowToday,
  }
  const arranged = layout ? arrangeBrief(layout, briefModuleInfo, compact) : null

  return (
    <BriefLiveContext.Provider value={live}>
      <BriefItemsContext.Provider value={composition}>
      <PageFrame
        title="Today"
        meta={greetingMeta(greeting, total > 0 ? remaining : null)}
        actions={
          <div className="flex min-w-0 items-center gap-3">
            {completed > 0 && <ProgressBar completed={completed} total={total} />}
            {!setupOpen && (
              <>
                {selected === today && arranged?.header.map((e) => (
                  <ModuleBox key={e.id} id={e.id} mode="live" date={today} config={e.config} />
                ))}
                <DateStrip briefDates={briefDates} selected={selected} today={today} onSelect={select} />
                {selected === today && (
                  <IconButton aria-label={compact ? 'Expand the brief' : 'Compact the brief'} aria-expanded={!compact} onClick={toggleCompact}>
                    <ChevronDown className={cn('size-3.5 transition-transform duration-(--transition-fast)', !compact && 'rotate-180')} />
                  </IconButton>
                )}
                {selected === today && dp.briefSettings.supported && (
                  <BriefMenu
                    onRegenerate={composition.readOnly ? undefined : composition.regenerate}
                    regenerating={composition.regenerating}
                    justRegenerated={composition.justRegenerated}
                  />
                )}
              </>
            )}
          </div>
        }
        bodyClassName="space-y-4"
      >
        <ReminderCatchUp />
        {setupOpen ? (
          <TodaySetup onDone={focusBrief} />
        ) : selected !== today ? (
          <PastBrief date={selected} today={today} />
        ) : !arranged ? (
          <BriefSkeleton />
        ) : (
          <div data-brief-body role="region" aria-label="Today's brief" tabIndex={-1} className="space-y-4 outline-none">
            {compact ? <BriefStrip entries={arranged.strip} onExpand={toggleCompact} /> : <BriefSummary />}
            {arranged.body.map((e) => (
              <ModuleBox key={e.id} id={e.id} mode="live" date={today} config={e.config} />
            ))}
          </div>
        )}
      </PageFrame>
      </BriefItemsContext.Provider>
    </BriefLiveContext.Provider>
  )
}
