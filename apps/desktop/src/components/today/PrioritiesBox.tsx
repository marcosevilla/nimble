import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalToday } from '@/hooks/useLocalToday'
import { useAppStore } from '@/stores/appStore'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import type { Priority } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/shared/IconButton'
import { Meta } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import { shouldAutoGenerate } from '@/lib/todayBrief'
import { RefreshCw } from 'lucide-react'
import { BriefBox } from './BriefBox'

/* Source is a licensed semantic hue (§1.4) but only on the 6px dot — the
   pill itself is the neutral LabelChipPill recipe (today P1-6). */
const SOURCE_DOT: Record<string, string | null> = {
  Calendar: 'bg-accent-blue',
  Todoist: 'bg-destructive',
  Obsidian: 'bg-ai',
  General: null,
}

function buildCalendarSummary(events: { summary: string; start_time: string; end_time: string; all_day: boolean }[]): string {
  if (events.length === 0) return 'No meetings or events today.'
  return events
    .map((e) => e.all_day ? `All day: ${e.summary}` : `${e.start_time}–${e.end_time}: ${e.summary}`)
    .join('\n')
}

function buildTasksSummary(
  tasks: { content: string; project_id: string; priority: number; completed: boolean }[],
  projectNames: Record<string, string>,
): string {
  const open = tasks.filter((t) => !t.completed)
  if (open.length === 0) return 'No tasks due today.'
  return open
    .map((t) => {
      const pri = t.priority >= 3 ? ' [HIGH]' : ''
      const proj = projectNames[t.project_id] ? ` (${projectNames[t.project_id]})` : ''
      return `- ${t.content}${proj}${pri}`
    })
    .join('\n')
}

function buildObsidianSummary(obsidianToday: string | null): string {
  return obsidianToday || 'No Obsidian tasks today.'
}

function PriorityCard({ priority, index }: { priority: Priority; index: number }) {
  const sourceDot = SOURCE_DOT[priority.source] ?? SOURCE_DOT.General

  return (
    <div className="flex gap-3 py-2.5">
      {/* font-semibold kept for legibility on muted bg circle badge */}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-meta font-semibold text-muted-foreground">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-body-strong">{priority.title}</p>
          {/* Badge base cva bakes in text-meta; !text-label wins via the
              important flag so the source pill renders at 11/500 as spec'd. */}
          <Badge variant="secondary" className="!text-label gap-1 px-1.5 py-0 text-muted-foreground">
            {sourceDot && <span className={cn('size-1.5 rounded-full', sourceDot)} />}
            {priority.source}
          </Badge>
        </div>
        {/* leading-relaxed: deliberate prose override — AI reasoning reads as prose.
            Plain <p> so we control size directly (the <Meta> primitive pins text-meta). */}
        <p className="text-body text-muted-foreground leading-relaxed">{priority.reasoning}</p>
      </div>
    </div>
  )
}

// The day's auto-generation outcome, kept across mounts: navigating away
// and back must not re-call for a keyless or failed day, and a new date
// starts fresh (Review Focus 3).
let autoTried: { date: string; noKey: boolean } | null = null

/** Priority rows while loading or generating — the same shape as the cards. */
export function PrioritiesSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex gap-3 py-2">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Top priorities. Live, it auto-generates at most once per mount when the
 *  day has no cached set (TodayPage keys it by date, so a new day starts
 *  fresh); without a key it shows a calm line and never retries on its own.
 *  `readOnly` (snapshots) renders the given set and never generates. */
export function PrioritiesBox({
  priorities: initial,
  onGenerated,
  readOnly = false,
}: {
  priorities: Priority[] | null
  onGenerated?: (priorities: Priority[]) => void
  readOnly?: boolean
}) {
  const dp = useDataProvider()
  const calendarEvents = useAppStore((s) => s.calendarEvents)
  const obsidianToday = useAppStore((s) => s.obsidianToday)
  const today = useLocalToday() // local date, like the Due today list (C2)
  const { tasks, loading: tasksLoading } = useLocalTasks({ dueDate: today, includeCompleted: false })
  // Display-only lookup (resolving a task's own project name), not a
  // picker — `allProjects` so a task still in an archived project doesn't
  // lose its name here.
  const { allProjects } = useProjects()
  const projectNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of allProjects) map[p.id] = p.name
    return map
  }, [allProjects])

  const [generated, setPriorities] = useState<Priority[] | null>(initial)
  const priorities = readOnly ? initial : generated
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(() => autoTried?.date === today)
  const [noKey, setNoKey] = useState(() => autoTried?.date === today && autoTried.noKey)

  const generate = useCallback(async () => {
    setTried(true); setLoading(true); setError(null); setNoKey(false)
    autoTried = { date: today, noKey: false }
    try {
      const result = await dp.dailyState.generatePriorities(
        buildCalendarSummary(calendarEvents), buildTasksSummary(tasks, projectNames), buildObsidianSummary(obsidianToday))
      setPriorities(result); onGenerated?.(result)
    } catch (e) {
      if (String(e).includes('not configured')) { setNoKey(true); autoTried = { date: today, noKey: true } }
      else setError('Couldn’t reach the AI just now.')
    } finally { setLoading(false) }
  }, [dp, today, calendarEvents, tasks, projectNames, obsidianToday, onGenerated])

  // Wait for the task list: generating over an empty first render would
  // tell the AI nothing is due.
  useEffect(() => {
    if (!readOnly && !tasksLoading && shouldAutoGenerate({ cached: priorities !== null, tried, noKey })) void generate()
  }, [readOnly, tasksLoading, priorities, tried, noKey, generate])

  // Always reachable while live, so a key added in Settings can be used
  // today without waiting for tomorrow's auto-generation.
  const canRegenerate = !readOnly && !loading && !error

  return (
    <BriefBox
      title="Top priorities"
      action={
        canRegenerate ? (
          <IconButton size="sm" onClick={() => void generate()} aria-label="Regenerate priorities" title="Regenerate">
            <RefreshCw className="size-3" />
          </IconButton>
        ) : undefined
      }
    >
      {loading ? (
        <PrioritiesSkeleton />
      ) : error && !readOnly ? (
        <div className="space-y-2">
          <Meta as="p">{error}</Meta>
          <Button variant="outline" size="sm" onClick={() => void generate()}>
            Try again
          </Button>
        </div>
      ) : priorities && priorities.length > 0 ? (
        <div className="divide-y divide-border/50">
          {priorities.map((p, i) => (
            <PriorityCard key={i} priority={p} index={i} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <Meta as="p">Nothing pressing today. Pick something you want to do.</Meta>
          {noKey && <Meta as="p">Add an Anthropic key in Settings for AI priorities.</Meta>}
        </div>
      )}
    </BriefBox>
  )
}
