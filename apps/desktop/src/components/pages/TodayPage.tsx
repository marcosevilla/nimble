import { useMemo, useState, useCallback, useEffect } from 'react'
import { TaskRow } from '@/components/todoist/TaskRow'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { useTodoist } from '@/hooks/useTodoist'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { PrioritiesSection } from '@/components/priorities/PrioritiesSection'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useObsidian } from '@/hooks/useObsidian'
import { useTaskNavigation } from '@/hooks/useTaskNavigation'
import { useCalendar } from '@/hooks/useCalendar'
import { cn } from '@/lib/utils'
import { useDataProvider } from '@/services/provider-context'
import type { Priority, TodoistTaskRow } from '@daily-triage/types'
import { BriefDisplay } from '@/components/shared/BriefDisplay'
import { DateStrip } from '@/components/shared/DateStrip'
import { HabitsSection } from '@/components/goals/HabitsSection'
import { ArrowRight, Check } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/shared/PageHeader'
import { Meta } from '@/components/shared/typography'

// ── Shared Utilities ──

function getGreeting(): { headline: string; subtitle: string } {
  const hour = new Date().getHours()
  if (hour < 12) return { headline: 'Good morning', subtitle: "Let's plan your day." }
  if (hour < 17) return { headline: 'Good afternoon', subtitle: "Pick up where you left off." }
  return { headline: 'Good evening', subtitle: 'Quick end-of-day pass?' }
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="flex items-center gap-3 mb-4 animate-progress-enter">
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
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

// ── Urgency Grouping ──

interface UrgencyGroup {
  key: string
  title: string
  tasks: TodoistTaskRow[]
  defaultOpen: boolean
}

function groupByUrgency(tasks: TodoistTaskRow[]): UrgencyGroup[] {
  const today = new Date().toISOString().slice(0, 10)
  const stillOpen: TodoistTaskRow[] = []
  const highPriority: TodoistTaskRow[] = []
  const dueToday: TodoistTaskRow[] = []
  const quickWins: TodoistTaskRow[] = []

  for (const task of tasks) {
    const isCarriedOver = task.due_date != null && task.due_date < today
    if (isCarriedOver) stillOpen.push(task)
    else if (task.priority >= 3) highPriority.push(task)
    else if (task.content.length < 50 && task.priority <= 2) quickWins.push(task)
    else dueToday.push(task)
  }

  const groups: UrgencyGroup[] = []
  if (stillOpen.length > 0) groups.push({ key: 'still-open', title: 'Still open', tasks: stillOpen, defaultOpen: true })
  if (highPriority.length > 0) groups.push({ key: 'high', title: 'High priority', tasks: highPriority, defaultOpen: true })
  if (dueToday.length > 0) groups.push({ key: 'today', title: 'Due today', tasks: dueToday, defaultOpen: true })
  if (quickWins.length > 0) groups.push({ key: 'quick', title: 'Quick wins', tasks: quickWins, defaultOpen: false })
  return groups
}


// ── Review Step Components ──

function ReviewStep({
  step,
  title,
  active,
  completed: done,
  children,
}: {
  step: number
  title: string
  active: boolean
  completed: boolean
  children: React.ReactNode
}) {
  if (!active && !done) {
    return (
      <div className="rounded-lg p-4 opacity-40">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-meta-strong text-muted-foreground">
            {step}
          </span>
          <h3 className="text-body-strong text-muted-foreground">{title}</h3>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      'rounded-lg border p-4 transition-all duration-300',
      active ? 'bg-card border-border' : 'bg-muted/30 border-border/30',
      active && 'animate-in fade-in slide-in-from-bottom-2 duration-200',
    )}>
      <div className="flex items-center gap-2 mb-3">
        <span className={cn(
          'flex size-6 items-center justify-center rounded-full text-meta-strong',
          done ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
        )}>
          {done ? <Check className="size-3.5" /> : step}
        </span>
        <h3 className={cn(
          'text-body-strong',
          done && 'text-muted-foreground',
        )}>
          {title}
        </h3>
      </div>
      {active && <div>{children}</div>}
    </div>
  )
}

function CalendarGlance() {
  const { events, loading } = useCalendar()

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-6" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No meetings today — wide open for deep work.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {events.slice(0, 5).map((event) => (
        <div key={event.id} className="flex items-center gap-3 text-body">
          <span className="w-14 shrink-0 text-right text-meta tabular-nums text-muted-foreground">
            {event.all_day ? 'All day' : event.start_time.slice(0, 5)}
          </span>
          {event.feed_color && (
            <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: event.feed_color }} />
          )}
          <span className="truncate">{event.summary}</span>
        </div>
      ))}
      {events.length > 5 && (
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0" />
          <Meta as="p">+{events.length - 5} more</Meta>
        </div>
      )}
    </div>
  )
}

function TriageSection({
  todoistTasks,
  onSnooze,
}: {
  todoistTasks: TodoistTaskRow[]
  onSnooze: (id: string) => void
}) {
  const carriedOver = todoistTasks.filter((t) => {
    const today = new Date().toISOString().slice(0, 10)
    return t.due_date != null && t.due_date < today
  })
  const highPriority = todoistTasks.filter((t) => t.priority >= 3)
  const stillOpen = [...carriedOver, ...highPriority.filter((t) => !carriedOver.includes(t))]

  if (stillOpen.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        Nothing left to triage.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      <Meta as="p" className="mb-2">
        {stillOpen.length} still open — clear or carry forward.
      </Meta>
      {stillOpen.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onSnooze={onSnooze}
        />
      ))}
    </div>
  )
}

// ── Review Mode ──

function ReviewMode({ onComplete }: { onComplete: (priorities: Priority[]) => void }) {
  const dp = useDataProvider()
  const [step, setStep] = useState(1)
  const [priorities, setPriorities] = useState<Priority[] | null>(null)
  const [brief, setBrief] = useState<string | null | undefined>(undefined) // undefined = loading
  const { tasks: todoistTasks, snoozeTask } = useTodoist()
  const now = new Date()
  const dateStr = format(now, 'EEEE, MMMM d')

  useEffect(() => {
    dp.dailyState.readDailyBrief().then(setBrief).catch(() => setBrief(null))
  }, [dp])

  const handlePrioritiesGenerated = useCallback((p: Priority[]) => {
    setPriorities(p)
    setStep(3)
  }, [])

  const handleFinish = useCallback(() => {
    if (priorities) onComplete(priorities)
  }, [priorities, onComplete])

  return (
    <>
      <PageHeader title="Today" meta={dateStr} />
      <div className="px-5 py-6 w-full flex justify-center">
        <div className="w-full max-w-[520px] space-y-4">
          {/* Greeting — demoted to first content block */}
          {(() => { const g = getGreeting(); return (
            <div className="py-4">
              <h2 className="text-heading">{g.headline}</h2>
            </div>
          )})()}

        {/* Step 1: Daily brief or calendar glance */}
        <ReviewStep
          step={1}
          title={brief ? 'Your daily brief' : 'Your schedule'}
          active={step === 1}
          completed={step > 1}
        >
          {brief === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : brief ? (
            <div className="max-h-[32rem] overflow-y-auto">
              <BriefDisplay markdown={brief} />
            </div>
          ) : (
            <CalendarGlance />
          )}
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
              Next <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </ReviewStep>

        {/* Step 2: Energy + Priorities */}
        <ReviewStep step={2} title="Set your energy & get priorities" active={step === 2} completed={step > 2}>
          <PrioritiesSection onGenerated={handlePrioritiesGenerated} compact />
        </ReviewStep>

        {/* Step 3: Triage */}
        <ReviewStep step={3} title="Quick triage" active={step === 3} completed={step > 3}>
          <TriageSection
            todoistTasks={todoistTasks}
            onSnooze={snoozeTask}
          />
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={handleFinish} className="gap-1.5">
              <Check className="size-3.5" /> Ready to go
            </Button>
          </div>
        </ReviewStep>
        </div>
      </div>
    </>
  )
}

// ── Dashboard Mode ──

function DashboardMode({ cachedPriorities }: { cachedPriorities: Priority[] | null }) {
  const dp = useDataProvider()
  const { tasks: todoistTasks, completeTask, snoozeTask } = useTodoist()
  const { todayData } = useObsidian()
  const today = new Date().toISOString().slice(0, 10)

  // Brief browsing
  const [selectedDate, setSelectedDate] = useState(today)
  const [briefDates, setBriefDates] = useState<Set<string>>(new Set())
  const [briefContent, setBriefContent] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(true)

  useEffect(() => {
    dp.dailyState.listBriefDates().then((dates) => setBriefDates(new Set(dates))).catch(() => {})
  }, [dp])

  useEffect(() => {
    setBriefLoading(true)
    dp.dailyState.readDailyBrief(selectedDate).then((content) => {
      setBriefContent(content)
      setBriefLoading(false)
    }).catch(() => setBriefLoading(false))
  }, [selectedDate, dp])
  const { tasks: localTasks, loading: localLoading, remove: removeLocal, addTask, refresh: refreshLocal } = useLocalTasks({ dueDate: today })
  const { projects } = useProjects()
  const projectMap = useMemo(() => {
    const map: Record<string, { name: string; color: string }> = {}
    for (const p of projects) map[p.id] = { name: p.name, color: p.color }
    return map
  }, [projects])

  const topLevelLocal = useMemo(() => localTasks.filter((t) => !t.parent_id), [localTasks])
  const subtaskMap = useMemo(() => {
    const map: Record<string, typeof localTasks> = {}
    for (const t of localTasks) {
      if (t.parent_id) {
        if (!map[t.parent_id]) map[t.parent_id] = []
        map[t.parent_id].push(t)
      }
    }
    return map
  }, [localTasks])

  const handleAddSubtask = useCallback(
    async (parentId: string, content: string) => {
      const parent = localTasks.find((t) => t.id === parentId)
      await addTask(content, { parentId, projectId: parent?.project_id, dueDate: today })
      refreshLocal()
    },
    [localTasks, addTask, refreshLocal, today],
  )

  const obsidianChecked = todayData?.tasks.filter((t) => t.checked).length ?? 0
  const obsidianTotal = todayData?.tasks.length ?? 0
  const localCompleted = localTasks.filter((t) => t.completed && !t.parent_id).length
  const completed = obsidianChecked + localCompleted
  const total = obsidianTotal + topLevelLocal.length + todoistTasks.length

  const urgencyGroups = useMemo(() => groupByUrgency(todoistTasks), [todoistTasks])
  const flatTaskIds = useMemo(() => urgencyGroups.flatMap((g) => g.tasks.map((t) => t.id)), [urgencyGroups])

  const handleOpen = useCallback(
    (taskId: string) => {
      const task = todoistTasks.find((t) => t.id === taskId)
      if (task?.todoist_url) dp.system.openUrl(task.todoist_url)
    },
    [todoistTasks, dp],
  )

  useTaskNavigation(flatTaskIds, {
    onComplete: completeTask,
    onSnooze: snoozeTask,
    onOpen: handleOpen,
  })

  const now = new Date()
  const dateStr = format(now, 'EEEE, MMMM d')
  const remaining = total - completed

  return (
    <>
      <PageHeader
        title="Today"
        meta={dateStr}
      />
      <div className="px-5 py-6 space-y-4 w-full">
        {/* Greeting — demoted to first content block */}
        {(() => { const g = getGreeting(); return (
          <div className="mb-2 space-y-1">
            <h2 className="text-heading">{g.headline}</h2>
            {total > 0 ? (
              <p className="text-body text-muted-foreground">
                {remaining === 0 ? 'All done for today.' : `${remaining} item${remaining === 1 ? '' : 's'} remaining`}
              </p>
            ) : (
              <p className="text-body text-muted-foreground">{g.subtitle}</p>
            )}
          </div>
        )})()}

      {/* Date strip + Brief */}
      <DateStrip briefDates={briefDates} selected={selectedDate} onSelect={setSelectedDate} />
      {briefLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : briefContent ? (
        <div className="rounded-lg border border-border/30 bg-muted/30 p-4">
          <BriefDisplay markdown={briefContent} />
        </div>
      ) : (
        <p className="text-meta text-muted-foreground text-center py-2">
          No brief for this date.
        </p>
      )}

      {/* Cached priorities */}
      {cachedPriorities && cachedPriorities.length > 0 && (
        <PrioritiesSection initialPriorities={cachedPriorities} />
      )}

      {/* Habits */}
      <HabitsSection />

      {completed > 0 && <ProgressBar completed={completed} total={total} />}

      {!localLoading && topLevelLocal.length > 0 && (
        <CollapsibleSection title="Tasks" count={topLevelLocal.filter((t) => !t.completed).length} defaultOpen={true}>
          <div className="divide-y divide-border/30">
            {topLevelLocal.map((task, i) => {
              const subs = subtaskMap[task.id] ?? []
              const done = subs.filter((s) => s.completed || s.status === 'complete').length
              const stats = subs.length > 0 ? { done, total: subs.length } : undefined
              const delay = `${Math.min(i, 14) * 25}ms`
              return (
                <div
                  key={task.id}
                  className="animate-row-enter"
                  style={{ animationDelay: delay }}
                >
                  <LocalTaskRow
                    task={task}
                    projects={projects}
                    projectName={projectMap[task.project_id]?.name}
                    projectColor={projectMap[task.project_id]?.color}
                    subtaskStats={stats}
                    onDelete={removeLocal}
                    onAddSubtask={handleAddSubtask}
                    onUpdated={refreshLocal}
                  />
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}

      {todoistTasks.length > 0 && (
        <CollapsibleSection title="Todoist" count={todoistTasks.length} defaultOpen={false}>
          <div className="divide-y divide-border/30">
            {todoistTasks.map((task, i) => {
              const delay = `${Math.min(i, 14) * 25}ms`
              return (
                <div
                  key={task.id}
                  className="animate-row-enter"
                  style={{ animationDelay: delay }}
                >
                  <TaskRow task={task} onSnooze={snoozeTask} />
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}
      </div>
    </>
  )
}

// ── Today Page (Router) ──

export function TodayPage() {
  const dp = useDataProvider()
  const [reviewComplete, setReviewComplete] = useState<boolean | null>(null) // null = loading
  const [cachedPriorities, setCachedPriorities] = useState<Priority[] | null>(null)

  // Check if today's review has been done
  useEffect(() => {
    // Fallback timeout — if getDailyState takes too long, show review mode
    const timeout = setTimeout(() => {
      setReviewComplete((prev) => prev === null ? false : prev)
    }, 2000)

    dp.dailyState.get().then((state) => {
      clearTimeout(timeout)
      setReviewComplete(state.review_complete)
      if (state.priorities) setCachedPriorities(state.priorities)
    }).catch(() => {
      clearTimeout(timeout)
      setReviewComplete(false) // Assume not done on error
    })

    return () => clearTimeout(timeout)
  }, [dp])

  const handleReviewComplete = useCallback((priorities: Priority[]) => {
    setCachedPriorities(priorities)
    setReviewComplete(true)
  }, [])

  // Loading state while checking daily state
  if (reviewComplete === null) {
    return (
      <>
        <PageHeader title="Today" />
        <div className="px-5 py-6 space-y-4 w-full">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      </>
    )
  }

  // Review mode (first open of the day)
  if (!reviewComplete) {
    return <ReviewMode onComplete={handleReviewComplete} />
  }

  // Dashboard mode (review done)
  return <DashboardMode cachedPriorities={cachedPriorities} />
}
