import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import type { Priority } from '@daily-triage/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Meta } from '@/components/shared/typography'
import { toast } from 'sonner'
import { Sparkles, RefreshCw, Battery, BatteryMedium, BatteryLow } from 'lucide-react'

type EnergyLevel = 'high' | 'medium' | 'low'

const ENERGY_OPTIONS: { value: EnergyLevel; label: string; icon: typeof Battery }[] = [
  { value: 'low', label: 'Low', icon: BatteryLow },
  { value: 'medium', label: 'Medium', icon: BatteryMedium },
  { value: 'high', label: 'High', icon: Battery },
]

const SOURCE_STYLES: Record<string, string> = {
  Calendar: 'bg-accent-blue/10 text-accent-blue',
  Todoist: 'bg-red-500/10 text-red-500',
  Obsidian: 'bg-purple-500/10 text-purple-500',
  General: 'bg-muted text-muted-foreground',
}

function buildCalendarSummary(events: { summary: string; start_time: string; end_time: string; all_day: boolean }[]): string {
  if (events.length === 0) return 'No meetings or events today.'
  return events
    .map((e) => e.all_day ? `All day: ${e.summary}` : `${e.start_time}–${e.end_time}: ${e.summary}`)
    .join('\n')
}

function buildTasksSummary(
  tasks: { content: string; project_id: string; priority: number }[],
  projectNames: Record<string, string>,
): string {
  if (tasks.length === 0) return 'No tasks due today.'
  return tasks
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
  const sourceStyle = SOURCE_STYLES[priority.source] ?? SOURCE_STYLES.General

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
          <Badge variant="secondary" className={`!text-label px-1.5 py-0 ${sourceStyle}`}>
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

interface PrioritiesSectionProps {
  onGenerated?: (priorities: Priority[]) => void
  initialPriorities?: Priority[] | null
  compact?: boolean // skip card wrapper (used inside ReviewStep)
}

export function PrioritiesSection({ onGenerated, initialPriorities, compact }: PrioritiesSectionProps) {
  const dp = useDataProvider()
  const calendarEvents = useAppStore((s) => s.calendarEvents)
  const obsidianToday = useAppStore((s) => s.obsidianToday)
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const { tasks: tasksDueToday } = useLocalTasks({ dueDate: today })
  const { projects } = useProjects()
  const projectNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of projects) map[p.id] = p.name
    return map
  }, [projects])

  const [energy, setEnergy] = useState<EnergyLevel | null>(null)
  const [priorities, setPriorities] = useState<Priority[] | null>(initialPriorities ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync initialPriorities if provided
  useEffect(() => {
    if (initialPriorities) setPriorities(initialPriorities)
  }, [initialPriorities])

  const generate = useCallback(async (level: EnergyLevel) => {
    setEnergy(level)
    setLoading(true)
    setError(null)

    try {
      const result = await dp.dailyState.generatePriorities(
        level,
        buildCalendarSummary(calendarEvents),
        buildTasksSummary(tasksDueToday, projectNames),
        buildObsidianSummary(obsidianToday),
      )
      setPriorities(result)
      onGenerated?.(result)
    } catch (e) {
      const msg = String(e)
      setError(msg)
      if (msg.includes('not configured')) {
        toast.error('Add your Anthropic API key in Settings first')
      } else {
        toast.error('Failed to generate priorities')
      }
    } finally {
      setLoading(false)
    }
  }, [calendarEvents, tasksDueToday, projectNames, obsidianToday, onGenerated, dp])

  const regenerate = useCallback(() => {
    if (energy) generate(energy)
  }, [energy, generate])

  // No energy selected yet — show the selector
  if (!energy && !priorities) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent-blue" />
          <h3 className="text-body-strong">How's your energy?</h3>
        </div>
        <Meta as="p">Pick your energy level and I'll suggest your top 3 priorities.</Meta>
        <div className="flex gap-2">
          {ENERGY_OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
              <Button
                key={opt.value}
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5"
                onClick={() => generate(opt.value)}
              >
                <Icon className="size-3.5" />
                {opt.label}
              </Button>
            )
          })}
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent-blue animate-pulse" />
          <h3 className="text-body-strong">Thinking...</h3>
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3 py-2">
              <Skeleton className="size-6 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-destructive" />
          <h3 className="text-body-strong">Couldn't generate priorities</h3>
        </div>
        <Meta as="p">{error}</Meta>
        <Button variant="outline" size="sm" onClick={() => setEnergy(null)}>
          Try again
        </Button>
      </div>
    )
  }

  // Priorities display
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent-blue" />
          <h3 className="text-body-strong">Today's priorities</h3>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={regenerate}
          title="Regenerate"
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>

      <div className="divide-y divide-border/50">
        {priorities?.map((p, i) => (
          <PriorityCard key={i} priority={p} index={i} />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <span className="text-label text-muted-foreground">
          Energy: {energy ?? 'set'}
        </span>
        <button
          onClick={() => { setPriorities(null); setEnergy(null) }}
          className="text-label text-muted-foreground hover:text-foreground transition-colors"
        >
          Change
        </button>
      </div>
    </>
  )

  if (compact) {
    return <div className="space-y-2">{content}</div>
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      {content}
    </div>
  )
}
