import { useState, useEffect, useCallback } from 'react'
import { useDetailStore } from '@/stores/detailStore'
import { useGoalsStore } from '@/stores/goalsStore'
import { useDataProvider } from '@/services/provider-context'
import type { GoalWithProgress, GoalStatus, Milestone, LifeArea } from '@daily-triage/types'
import { cn } from '@/lib/utils'
import { GOAL_STATUSES, statusColor, statusLabel } from '@/lib/goalStatus'
import { InlineTitle } from './InlineTitle'
import { InlineDescription } from './InlineDescription'
import { DetailBreadcrumbs } from './DetailBreadcrumbs'
import { IconButton } from '@/components/shared/IconButton'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { PanelRight, MoreHorizontal, Trash2, Calendar, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

function formatDate(date: string | null): string | null {
  if (!date) return null
  try {
    return format(parseISO(date), 'MMM d, yyyy')
  } catch {
    return date
  }
}

export function GoalDetailPage() {
  const dp = useDataProvider()
  const target = useDetailStore((s) => s.target)
  const switchMode = useDetailStore((s) => s.switchMode)
  const close = useDetailStore((s) => s.close)
  const lifeAreas = useGoalsStore((s) => s.lifeAreas)
  const refreshGoals = useGoalsStore((s) => s.refresh)

  const goalId = target?.type === 'goal' ? target.id : null
  const [goal, setGoal] = useState<GoalWithProgress | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = useCallback(async () => {
    if (!goalId) return
    try {
      const [g, ms] = await Promise.all([
        dp.goals.get(goalId),
        dp.goals.getMilestones(goalId),
      ])
      setGoal(g)
      setMilestones(ms)
    } catch {
      setGoal(null)
    }
    setLoading(false)
  }, [goalId, dp])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Reload goal + goals list after any mutation so progress stays fresh
  const mutate = useCallback(async (fn: () => Promise<unknown>, errLabel: string) => {
    try {
      await fn()
      await load()
      refreshGoals()
    } catch (e) {
      toast.error(`${errLabel}: ${e}`)
    }
  }, [load, refreshGoals])

  const handleDelete = useCallback(async () => {
    if (!goal) return
    try {
      await dp.goals.delete(goal.id)
      toast.success(`Goal deleted: "${goal.name}"`)
      refreshGoals()
      close()
    } catch (e) {
      toast.error(`Failed to delete goal: ${e}`)
    }
  }, [goal, dp, refreshGoals, close])

  if (loading) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    )
  }

  if (!goal) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <p className="text-body text-muted-foreground">Goal not found.</p>
      </div>
    )
  }

  const area = goal.life_area_id ? lifeAreas.find((a) => a.id === goal.life_area_id) ?? null : null
  const barColor = goal.color || area?.color || '#f59e0b'

  return (
    <div className="space-y-6">
      {/* Header: breadcrumbs + actions */}
      <div className="flex items-start justify-between">
        <DetailBreadcrumbs />
        <div className="flex items-center gap-0.5 shrink-0">
          <IconButton
            onClick={() => switchMode('sidebar')}
            size="lg"
            tone="subtle"
            title="Pin to sidebar"
          >
            <PanelRight className="size-4" />
          </IconButton>
          <Popover>
            <PopoverTrigger className="flex size-7 items-center justify-center rounded-md text-muted-foreground/30 hover:text-muted-foreground hover:bg-accent/20 transition-colors">
              <MoreHorizontal className="size-4" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" sideOffset={4} className="w-44 gap-0 p-1">
              <button
                onClick={() => setDeleteOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body text-destructive/60 hover:text-destructive hover:bg-accent/20 transition-colors"
              >
                <Trash2 className="size-3.5 shrink-0" />
                <span className="flex-1 text-left">Delete goal</span>
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Metadata row: life area + status + dates */}
      <div className="flex items-center gap-3 flex-wrap text-body">
        <LifeAreaPicker
          area={area}
          lifeAreas={lifeAreas}
          onChange={(id) => mutate(
            // Empty string clears the life area (backend treats '' as NULL)
            () => dp.goals.update({ id: goal.id, lifeAreaId: id ?? '' }),
            'Failed to update life area',
          )}
        />
        <StatusPicker
          status={goal.status}
          onChange={(status) => mutate(
            () => dp.goals.update({ id: goal.id, status }),
            'Failed to update status',
          )}
        />
        <DatePicker
          startDate={goal.start_date}
          targetDate={goal.target_date}
          onChange={(startDate, targetDate) => mutate(
            () => dp.goals.update({ id: goal.id, startDate, targetDate }),
            'Failed to update dates',
          )}
        />
      </div>

      {/* Title */}
      <InlineTitle
        value={goal.name}
        onSave={(name) => mutate(
          () => dp.goals.update({ id: goal.id, name }),
          'Failed to rename goal',
        )}
      />

      {/* Description */}
      <InlineDescription
        value={goal.description}
        onSave={(description) => mutate(
          () => dp.goals.update({ id: goal.id, description }),
          'Failed to update description',
        )}
      />

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Meta>Progress</Meta>
          <span className="text-label text-muted-foreground tabular-nums">
            {goal.progress > 0 ? `${goal.progress}% complete` : 'Not started'}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(goal.progress, 100)}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
      </div>

      {/* Milestones */}
      <MilestonesSection
        goalId={goal.id}
        milestones={milestones}
        onMutate={mutate}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{goal.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the goal and its {milestones.length > 0 ? `${milestones.length} milestone${milestones.length !== 1 ? 's' : ''}` : 'milestones'}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Life Area Picker ──

function LifeAreaPicker({
  area,
  lifeAreas,
  onChange,
}: {
  area: LifeArea | null
  lifeAreas: LifeArea[]
  onChange: (id: string | null) => void
}) {
  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-meta text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors">
        {area ? (
          <>
            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: area.color }} />
            {area.name}
          </>
        ) : (
          <>
            <Circle className="size-3 text-muted-foreground/40" />
            No life area
          </>
        )}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-40 gap-0 p-1">
        <button
          onClick={() => onChange(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body transition-colors',
            !area ? 'bg-accent/40' : 'hover:bg-accent/20',
          )}
        >
          <Circle className="size-3 text-muted-foreground/40" />
          None
        </button>
        {lifeAreas.map((a) => (
          <button
            key={a.id}
            onClick={() => onChange(a.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body transition-colors',
              area?.id === a.id ? 'bg-accent/40' : 'hover:bg-accent/20',
            )}
          >
            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
            <span className="truncate">{a.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ── Status Picker ──

function StatusPicker({
  status,
  onChange,
}: {
  status: GoalStatus
  onChange: (status: GoalStatus) => void
}) {
  return (
    <Popover>
      <PopoverTrigger className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-meta hover:bg-accent/20 transition-colors',
        statusColor(status),
      )}>
        {statusLabel(status)}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-36 gap-0 p-1">
        {GOAL_STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => onChange(s.value)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body transition-colors',
              status === s.value ? 'bg-accent/40' : 'hover:bg-accent/20',
            )}
          >
            <span className={cn('size-1.5 rounded-full bg-current', s.color)} />
            {s.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// ── Date Picker ──

function DatePicker({
  startDate,
  targetDate,
  onChange,
}: {
  startDate: string | null
  targetDate: string | null
  onChange: (startDate: string, targetDate: string) => void
}) {
  const [start, setStart] = useState(startDate ?? '')
  const [end, setEnd] = useState(targetDate ?? '')

  useEffect(() => { setStart(startDate ?? '') }, [startDate])
  useEffect(() => { setEnd(targetDate ?? '') }, [targetDate])

  const label = targetDate
    ? `Target ${formatDate(targetDate)}`
    : 'Set target date'

  return (
    <Popover onOpenChange={(open) => {
      if (!open && (start !== (startDate ?? '') || end !== (targetDate ?? ''))) {
        onChange(start, end)
      }
    }}>
      <PopoverTrigger className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-meta text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors">
        <Calendar className="size-3" />
        {label}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-56 p-3 space-y-3">
        <div className="space-y-1.5">
          <Meta>Start date</Meta>
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Meta>Target date</Meta>
          <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Milestones ──

function MilestonesSection({
  goalId,
  milestones,
  onMutate,
}: {
  goalId: string
  milestones: Milestone[]
  onMutate: (fn: () => Promise<unknown>, errLabel: string) => Promise<void>
}) {
  const dp = useDataProvider()
  const [input, setInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)

  const handleAdd = async () => {
    const name = input.trim()
    if (!name) return
    setInput('')
    await onMutate(
      () => dp.goals.createMilestone({ goalId, name }),
      'Failed to add milestone',
    )
  }

  return (
    <div className="space-y-2">
      {milestones.length > 0 && (
        <div className="space-y-0.5">
          {milestones.map((m) => (
            <div
              key={m.id}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/10 transition-colors"
            >
              <Checkbox
                checked={m.completed}
                onCheckedChange={(checked) => onMutate(
                  () => dp.goals.updateMilestone({ id: m.id, completed: checked === true }),
                  'Failed to update milestone',
                )}
              />
              <span
                className={cn(
                  'flex-1 min-w-0 truncate text-body',
                  m.completed && 'text-muted-foreground line-through',
                )}
              >
                {m.name}
              </span>
              {m.target_date && (
                <Meta>{formatDate(m.target_date)}</Meta>
              )}
              <button
                onClick={() => onMutate(
                  () => dp.goals.deleteMilestone(m.id),
                  'Failed to delete milestone',
                )}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all"
                aria-label={`Delete milestone ${m.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add milestone */}
      {inputFocused || input ? (
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
            if (e.key === 'Escape') { setInput(''); setInputFocused(false) }
          }}
          onBlur={() => { if (!input) setInputFocused(false) }}
          placeholder="Add a milestone..."
          className="w-full bg-transparent text-body outline-none placeholder:text-muted-foreground/40 py-1 px-2"
          autoFocus
        />
      ) : (
        <p
          onClick={() => setInputFocused(true)}
          className="text-body text-muted-foreground/40 cursor-text hover:text-muted-foreground/60 transition-colors py-1 px-2"
        >
          Add a milestone...
        </p>
      )}
    </div>
  )
}
