import { ReminderCatchUp } from '@/components/today/ReminderCatchUp'
import { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { PrioritiesSection } from '@/components/priorities/PrioritiesSection'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useObsidian } from '@/hooks/useObsidian'
import { useCalendar } from '@/hooks/useCalendar'
import { cn } from '@/lib/utils'
import { useDataProvider } from '@/services/provider-context'
import type { Priority } from '@nimble/types'
import { BriefDisplay } from '@/components/shared/BriefDisplay'
import { DateStrip } from '@/components/shared/DateStrip'
import { CalendarCheck, Check, ChevronRight, Coffee } from 'lucide-react'
import { PageFrame } from '@/components/shared/PageFrame'
import { EmptyState } from '@/components/shared/EmptyState'
import { Meta, SectionTitle } from '@/components/shared/typography'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { scrollPageToTop } from '@/lib/pageScroll'
import { useLocalToday } from '@/hooks/useLocalToday'

// ── Shared Utilities ──

function getGreeting(): { headline: string; subtitle: string } {
  const hour = new Date().getHours()
  if (hour < 12) return { headline: 'Good morning', subtitle: "Let's plan your day." }
  if (hour < 17) return { headline: 'Good afternoon', subtitle: "Pick up where you left off." }
  return { headline: 'Good evening', subtitle: "Here's where things stand." }
}

/** The greeting lives in the header's meta slot — one title per page
 *  (cross-cutting move 1: the second text-title h2 is gone). */
function greetingMeta(remaining: number | null): string {
  const g = getGreeting()
  if (remaining === null) return g.headline
  return `${g.headline} · ${remaining === 0 ? 'all done for today' : `${remaining} remaining`}`
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="flex items-center gap-3 mb-4 animate-progress-enter">
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
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
  // One surface recipe for every state (today P2-4); pending and done vary
  // only opacity, so the step never changes its edge or fill.
  return (
    <div className={cn('surface-panel p-4', !active && !done && 'opacity-40', done && 'opacity-60')}>
      <div className={cn('flex items-center gap-2', active && 'mb-3')}>
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-meta-strong',
            done ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
          )}
        >
          {done ? <Check className="size-3.5" /> : step}
        </span>
        {/* Done steps dim by opacity alone (C1 review): muting the title too
            would dim it twice. */}
        <SectionTitle className={cn(!active && !done && 'text-muted-foreground')}>{title}</SectionTitle>
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
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Coffee className="size-4 shrink-0" />
        <span>No meetings today — wide open for deep work.</span>
      </div>
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

// ── Review Mode ──

function ReviewMode({ brief, onComplete }: { brief: string | null | undefined; onComplete: (priorities: Priority[]) => void }) {
  const [step, setStep] = useState(1)
  const [priorities, setPriorities] = useState<Priority[] | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      if (step === 1) setStep(2)
      else if (step === 2 && priorities) onComplete(priorities)
      // Step 2 also advances via PrioritiesSection's own button — leave it alone
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, priorities, onComplete])

  const handlePrioritiesGenerated = useCallback((p: Priority[]) => {
    setPriorities(p)
  }, [])

  const handleFinish = useCallback(() => {
    if (priorities) onComplete(priorities)
  }, [priorities, onComplete])

  return (
    <PageFrame title="Today" meta={greetingMeta(null)} bodyClassName="space-y-4">
      <ReminderCatchUp />

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
          <div className="max-h-[32rem] overflow-y-auto [scrollbar-gutter:stable]">
            <BriefDisplay markdown={brief} />
          </div>
        ) : (
          <CalendarGlance />
        )}
        <div className="flex justify-end mt-3">
          <Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
            Next <span className="ml-1 inline-flex items-center justify-center rounded bg-foreground/10 px-1 text-meta tabular-nums">↵</span>
          </Button>
        </div>
      </ReviewStep>

      {/* Step 2: Energy + Priorities */}
      <ReviewStep step={2} title="Set your energy & get priorities" active={step === 2} completed={false}>
        <PrioritiesSection onGenerated={handlePrioritiesGenerated} compact />
        {priorities && (
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={handleFinish} className="gap-1.5">
              <Check className="size-3.5" /> Ready to go
              <span className="ml-1 inline-flex items-center justify-center rounded bg-foreground/10 px-1 text-meta tabular-nums">↵</span>
            </Button>
          </div>
        )}
      </ReviewStep>
    </PageFrame>
  )
}

// ── Brief card (dashboard) ──

/** The daily brief, collapsed by default at the bottom of the lane
 *  (today P2-1); the date control sits in its header (P2-5). Picking a
 *  date opens the card. */
function BriefCard({
  today,
  selectedDate,
  onSelectDate,
  briefDates,
  content,
}: {
  today: string
  selectedDate: string
  onSelectDate: (date: string) => void
  briefDates: Set<string>
  content: string | null | undefined // undefined = loading
}) {
  const [open, setOpen] = useState(false)
  const select = (date: string) => {
    onSelectDate(date)
    setOpen(true)
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="surface-panel px-4 py-2">
      <SectionTitle
        as="h2"
        action={<DateStrip briefDates={briefDates} selected={selectedDate} today={today} onSelect={select} />}
      >
        <CollapsibleTrigger className="flex items-center gap-1.5 py-1 text-left data-[panel-open]:[&>svg:first-child]:rotate-90">
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)" />
          Daily brief
        </CollapsibleTrigger>
      </SectionTitle>
      <CollapsibleContent className="overflow-hidden transition-opacity duration-(--transition-fast) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
        <div className="pb-2 pt-1">
          {content === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : content ? (
            <BriefDisplay markdown={content} />
          ) : (
            <EmptyState size="compact">No brief for this date.</EmptyState>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ── Dashboard Mode ──

function DashboardMode({
  today,
  todayBrief,
  cachedPriorities,
  cachedEnergy,
}: {
  today: string
  todayBrief: string | null | undefined
  cachedPriorities: Priority[] | null
  cachedEnergy: string | null
}) {
  const dp = useDataProvider()
  const { todayData, loading: obsidianLoading } = useObsidian()

  // Brief browsing. Today's brief comes from TodayPage state — the one the
  // review just showed — so the swap never re-fetches it (today P2-3).
  const [selectedDate, setSelectedDate] = useState(today)
  const [briefDates, setBriefDates] = useState<Set<string>>(new Set())
  const [otherBrief, setOtherBrief] = useState<{ date: string; content: string | null } | null>(null)

  // Past midnight, a card that was showing "Today" follows the new today
  // instead of turning into yesterday's date.
  const prevToday = useRef(today)
  useEffect(() => {
    if (prevToday.current === today) return
    const previous = prevToday.current
    prevToday.current = today
    setSelectedDate((d) => (d === previous ? today : d))
  }, [today])

  useEffect(() => {
    dp.dailyState.listBriefDates().then((dates) => setBriefDates(new Set(dates))).catch(() => {})
  }, [dp])

  useEffect(() => {
    if (selectedDate === today) return
    let live = true
    dp.dailyState.readDailyBrief(selectedDate)
      .then((content) => { if (live) setOtherBrief({ date: selectedDate, content }) })
      .catch(() => { if (live) setOtherBrief({ date: selectedDate, content: null }) })
    return () => { live = false }
  }, [selectedDate, today, dp])

  const briefContent = selectedDate === today
    ? todayBrief
    : otherBrief?.date === selectedDate ? otherBrief.content : undefined

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
  const total = obsidianTotal + topLevelLocal.length

  const remaining = total - completed

  // Primary lane: Priorities → Tasks → collapsed Brief (today P2-1). Habits
  // live in the right rail under the calendar (RightSidebar).
  return (
    <PageFrame title="Today" meta={greetingMeta(total > 0 ? remaining : null)} bodyClassName="space-y-4">
      <ReminderCatchUp />

      {cachedPriorities && cachedPriorities.length > 0 && (
        <PrioritiesSection initialPriorities={cachedPriorities} initialEnergy={cachedEnergy} />
      )}

      {completed > 0 && <ProgressBar completed={completed} total={total} />}

      {!localLoading && topLevelLocal.length > 0 && (
        <CollapsibleSection
          title="Tasks"
          count={topLevelLocal.filter((t) => !t.completed).length}
          defaultOpen={true}
          className="-mt-3!"
        >
          <div>
            {topLevelLocal.map((task) => {
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
                    onDelete={removeLocal}
                    onAddSubtask={handleAddSubtask}
                  />
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Only when the day is truly empty — Obsidian daily-note tasks count
          toward the header's "remaining" even though they aren't listed. */}
      {!localLoading && !obsidianLoading && total === 0 && (
        <EmptyState icon={CalendarCheck} kbd="Q">Nothing scheduled today. Add a task with</EmptyState>
      )}

      <BriefCard
        today={today}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        briefDates={briefDates}
        content={briefContent}
      />
    </PageFrame>
  )
}

// ── Today Page (Router) ──

export function TodayPage() {
  const dp = useDataProvider()
  // Local calendar date, re-read at midnight (C1 review: UTC rolled over at
  // 5pm Pacific, and useMemo froze it across midnight).
  const today = useLocalToday()
  const [reviewComplete, setReviewComplete] = useState<boolean | null>(null) // null = loading
  const [cachedPriorities, setCachedPriorities] = useState<Priority[] | null>(null)
  const [cachedEnergy, setCachedEnergy] = useState<string | null>(null)
  // Today's brief is read once here and handed to both modes, so the
  // review → dashboard swap keeps what the user just read (today P2-3).
  const [todayBrief, setTodayBrief] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    dp.dailyState.readDailyBrief().then(setTodayBrief).catch(() => setTodayBrief(null))
  }, [dp])

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
      setCachedEnergy(state.energy_level)
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

  // Review → dashboard lands at the top like a new page instead of
  // inheriting the review's scroll offset (today P2-3). Before paint.
  const prevReviewComplete = useRef(reviewComplete)
  useLayoutEffect(() => {
    if (prevReviewComplete.current === false && reviewComplete === true) scrollPageToTop()
    prevReviewComplete.current = reviewComplete
  }, [reviewComplete])

  // Loading state while checking daily state — same frame, so the header
  // never flickers in.
  if (reviewComplete === null) {
    return (
      <PageFrame title="Today" bodyClassName="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </PageFrame>
    )
  }

  // Review mode (first open of the day)
  if (!reviewComplete) {
    return <ReviewMode brief={todayBrief} onComplete={handleReviewComplete} />
  }

  // Dashboard mode (review done)
  return (
    <DashboardMode
      today={today}
      todayBrief={todayBrief}
      cachedPriorities={cachedPriorities}
      cachedEnergy={cachedEnergy}
    />
  )
}
