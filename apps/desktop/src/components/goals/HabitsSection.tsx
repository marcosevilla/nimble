import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useGoalsStore } from '@/stores/goalsStore'
import { useDataProvider } from '@/services/provider-context'
import type { HabitHeatmapEntry, HabitWithStats } from '@nimble/types'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { Skeleton } from '@/components/ui/skeleton'
import { Button, buttonVariants } from '@/components/ui/button'
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
import { Flame, Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

const HABIT_COLORS = [
  '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316',
]

// Map icon string to Lucide component, fallback to emoji based on category/name
function getHabitEmoji(name: string, category: string | null): string {
  const n = name.toLowerCase()
  if (n.includes('stretch')) return '🧘'
  if (n.includes('read')) return '📖'
  if (n.includes('walk') || n.includes('step')) return '🚶'
  if (n.includes('clean')) return '🧹'
  if (n.includes('photo') || n.includes('video')) return '📸'
  if (n.includes('build')) return '🔨'
  if (n.includes('admin')) return '📋'
  if (n.includes('morning page')) return '✍️'
  if (n.includes('gratitude')) return '🙏'
  if (n.includes('learn') || n.includes('ml') || n.includes('ai') || n.includes('coding')) return '🧠'
  if (n.includes('tiktok') || n.includes('post')) return '📱'
  if (n.includes('network') || n.includes('reach out')) return '🤝'
  if (n.includes('scary')) return '🔥'
  if (n.includes('experience') || n.includes('new')) return '✨'
  if (n.includes('skincare')) return '🧴'
  if (n.includes('brush') || n.includes('floss') || n.includes('teeth')) return '🪥'
  if (n.includes('sunlight') || n.includes('outside')) return '☀️'
  if (n.includes('family')) return '👨‍👩‍👧'
  if (n.includes('friend')) return '👋'
  if (category?.toLowerCase() === 'social') return '💬'
  if (category?.toLowerCase() === 'physical') return '💪'
  if (category?.toLowerCase() === 'digital') return '💻'
  return '⭐'
}

function renderHabitIcon(icon: string, name: string, category: string | null): string {
  // If icon is a default placeholder, use emoji instead
  if (icon === 'Circle' || icon === 'circle' || !icon) {
    return getHabitEmoji(name, category)
  }
  // If it's already an emoji (starts with non-ASCII), use it directly
  if (icon.codePointAt(0)! > 127) return icon
  // Otherwise try to use it as emoji fallback
  return getHabitEmoji(name, category)
}

// ── Habit Circle ──

function HabitCircle({
  name,
  icon,
  color,
  category,
  completed,
  momentum,
  onToggle,
}: {
  name: string
  icon: string
  color: string
  category: string | null
  completed: boolean
  momentum: number
  onToggle: () => void
}) {
  const displayIcon = renderHabitIcon(icon, name, category)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null)

  const HOLD_DURATION = 500 // ms to hold for completion

  const startHold = useCallback(() => {
    if (completed) {
      // If already completed, single click to uncomplete
      onToggle()
      return
    }
    setHolding(true)
    setProgress(0)

    // Animate the progress ring
    const startTime = Date.now()
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - startTime
      setProgress(Math.min(elapsed / HOLD_DURATION, 1))
    }, 16)

    holdTimer.current = setTimeout(() => {
      setHolding(false)
      setProgress(0)
      if (progressInterval.current) clearInterval(progressInterval.current)
      onToggle()
    }, HOLD_DURATION)
  }, [completed, onToggle])

  const cancelHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    if (progressInterval.current) {
      clearInterval(progressInterval.current)
      progressInterval.current = null
    }
    setHolding(false)
    setProgress(0)
  }, [])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger
          className={cn(
            'relative size-10 rounded-full flex items-center justify-center text-title transition-all duration-200 cursor-pointer select-none border border-border bg-card',
            completed
              ? 'scale-105'
              : 'opacity-50 hover:opacity-80 hover:bg-accent/50',
            holding && 'scale-95',
          )}
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          aria-label={`${completed ? 'Click to unmark' : 'Hold to complete'} ${name}`}
        >
          {/* Hold progress ring */}
          {holding && !completed && (
            <svg className="absolute inset-0 size-10 -rotate-90 pointer-events-none" viewBox="0 0 40 40">
              <circle
                cx="20" cy="20" r="18"
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeDasharray={`${progress * 113} 113`}
                strokeLinecap="round"
                className="transition-none"
              />
            </svg>
          )}
          <span className="select-none">{displayIcon}</span>
          {completed && (
            // font-bold kept for legibility of checkmark on colored bg overlay
            <span className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full flex items-center justify-center text-label font-bold text-success-fg bg-success">
              ✓
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <div className="text-meta">
            <div className="font-medium">{name}</div>
            <div className="opacity-70">{completed ? 'Done today' : 'Not done yet'}</div>
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Momentum bar */}
      <div className="w-8 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(momentum, 100)}%`,
            backgroundColor: color,
            opacity: momentum > 0 ? 0.7 : 0,
          }}
        />
      </div>
    </div>
  )
}

// ── Heatmap ──

const CELL_SIZE = 12
const CELL_GAP = 2
const WEEKS = 52
const DAYS = 7
const AMBER_LEVELS = [
  'transparent',
  'oklch(0.85 0.12 85 / 0.25)',   // intensity 1
  'oklch(0.78 0.14 80 / 0.45)',   // intensity 2
  'oklch(0.72 0.16 75 / 0.65)',   // intensity 3
  'oklch(0.65 0.17 70 / 0.85)',   // intensity 4+
]

function getHeatmapColor(intensity: number): string {
  if (intensity <= 0) return AMBER_LEVELS[0]
  if (intensity >= 4) return AMBER_LEVELS[4]
  return AMBER_LEVELS[intensity]
}

function HabitHeatmap({ data }: { data: HabitHeatmapEntry[] }) {
  const grid = useMemo(() => {
    // Build a map from date string to intensity
    const intensityMap: Record<string, number> = {}
    for (const entry of data) {
      intensityMap[entry.date] = (intensityMap[entry.date] || 0) + entry.intensity
    }

    // Build grid: 52 weeks x 7 days, ending today
    const today = new Date()
    const cells: { date: string; intensity: number; col: number; row: number }[] = []

    for (let w = WEEKS - 1; w >= 0; w--) {
      for (let d = 0; d < DAYS; d++) {
        const daysAgo = w * 7 + (6 - d) // Sunday = 0
        const cellDate = new Date(today)
        cellDate.setDate(today.getDate() - daysAgo + (today.getDay() - 6))
        const dateStr = cellDate.toISOString().slice(0, 10)
        cells.push({
          date: dateStr,
          intensity: intensityMap[dateStr] || 0,
          col: WEEKS - 1 - w,
          row: d,
        })
      }
    }

    return cells
  }, [data])

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: { label: string; col: number }[] = []
    let lastMonth = -1
    for (const cell of grid) {
      if (cell.row !== 0) continue
      const month = new Date(cell.date).getMonth()
      if (month !== lastMonth) {
        lastMonth = month
        labels.push({
          label: new Date(cell.date).toLocaleString('default', { month: 'short' }),
          col: cell.col,
        })
      }
    }
    return labels
  }, [grid])

  const gridWidth = WEEKS * (CELL_SIZE + CELL_GAP)
  const gridHeight = DAYS * (CELL_SIZE + CELL_GAP)

  return (
    <div className="overflow-x-auto">
      <div style={{ width: gridWidth, minWidth: gridWidth }}>
        {/* Month labels */}
        <div className="flex mb-1" style={{ height: 14 }}>
          {monthLabels.map((m, i) => (
            <span
              key={i}
              className="text-label text-muted-foreground absolute"
              style={{ left: m.col * (CELL_SIZE + CELL_GAP) }}
            >
              {m.label}
            </span>
          ))}
        </div>

        {/* Grid */}
        <div className="relative" style={{ width: gridWidth, height: gridHeight }}>
          {grid.map((cell, i) => (
            <Tooltip key={i}>
              <TooltipTrigger
                className="absolute rounded-sm transition-colors"
                style={{
                  width: CELL_SIZE,
                  height: CELL_SIZE,
                  left: cell.col * (CELL_SIZE + CELL_GAP),
                  top: cell.row * (CELL_SIZE + CELL_GAP),
                  backgroundColor: getHeatmapColor(cell.intensity),
                  border: cell.intensity === 0 ? '1px solid oklch(from var(--border) l c h / 0.15)' : 'none',
                }}
              />
              <TooltipContent side="top">
                <div className="text-label">
                  <div>{cell.date}</div>
                  {cell.intensity > 0 && <div className="opacity-70">{cell.intensity} activities</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Habits Section ──

export function HabitsSection() {
  const dp = useDataProvider()
  const habits = useGoalsStore((s) => s.habits)
  const habitsLoading = useGoalsStore((s) => s.habitsLoading)
  const loadHabits = useGoalsStore((s) => s.loadHabits)

  const [heatmapData, setHeatmapData] = useState<HabitHeatmapEntry[]>([])
  const [heatmapLoading, setHeatmapLoading] = useState(true)

  useEffect(() => {
    loadHabits()
    dp.habits.getHeatmap(undefined, 365)
      .then(setHeatmapData)
      .catch(() => {})
      .finally(() => setHeatmapLoading(false))
  }, [loadHabits, dp])

  const handleToggle = useCallback(async (habitId: string, currentlyCompleted: boolean) => {
    try {
      if (currentlyCompleted) {
        await dp.habits.unlog(habitId)
      } else {
        await dp.habits.log(habitId)
      }
      await loadHabits()
      // Refresh heatmap
      dp.habits.getHeatmap(undefined, 365).then(setHeatmapData).catch(() => {})
    } catch (e) {
      console.error('Habit toggle failed:', e)
    }
  }, [loadHabits, dp])

  const activeHabits = habits.filter((h) => h.active)
  const completedCount = activeHabits.filter((h) => h.today_completed).length
  const avgMomentum = activeHabits.length > 0
    ? Math.round(activeHabits.reduce((sum, h) => sum + h.current_momentum, 0) / activeHabits.length)
    : 0

  if (habitsLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="size-10 rounded-full" />
          ))}
        </div>
      </div>
    )
  }

  if (activeHabits.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Flame className="size-3.5 text-amber-500" />
          <h3 className="text-body-strong">Habits</h3>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-meta text-muted-foreground">
            Track a small daily action — any effort counts.
          </p>
          <AddHabitPopover
            onCreated={loadHabits}
            triggerClassName={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5 shrink-0')}
          >
            <Plus className="size-3.5" />
            Add habit
          </AddHabitPopover>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <Flame className="size-3.5 text-amber-500" />
          <h3 className="text-body-strong">Habits</h3>
          <span className="text-label text-muted-foreground tabular-nums">
            {completedCount}/{activeHabits.length}
          </span>
          <ManageHabitsPopover habits={activeHabits} onChanged={loadHabits} />
        </div>
        {avgMomentum > 0 && (
          <span className="text-label text-muted-foreground">
            {avgMomentum}% momentum
          </span>
        )}
      </div>

      {/* Habit circles */}
      <div className="flex items-center gap-4 flex-wrap">
        {activeHabits.map((habit) => (
          <HabitCircle
            key={habit.id}
            name={habit.name}
            icon={habit.icon}
            color={habit.color}
            category={habit.category}
            completed={habit.today_completed}
            momentum={habit.current_momentum}
            onToggle={() => handleToggle(habit.id, habit.today_completed)}
          />
        ))}
        <AddHabitPopover
          onCreated={loadHabits}
          triggerClassName="size-10 rounded-full flex items-center justify-center ring-1 ring-dashed ring-border/40 text-muted-foreground hover:text-foreground hover:ring-border/70 transition-all"
        >
          <Plus className="size-4" />
        </AddHabitPopover>
      </div>

      {/* Heatmap (collapsible) */}
      <CollapsibleSection title="Activity" defaultOpen={false}>
        {heatmapLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <HabitHeatmap data={heatmapData} />
        )}
      </CollapsibleSection>
    </div>
  )
}

// ── Add Habit ──

function AddHabitPopover({
  children,
  triggerClassName,
  onCreated,
}: {
  children: React.ReactNode
  triggerClassName?: string
  onCreated: () => void
}) {
  const dp = useDataProvider()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(HABIT_COLORS[0])
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await dp.habits.create({ name: trimmed, icon: 'Circle', color })
      toast.success(`Habit added: "${trimmed}"`)
      setName('')
      setColor(HABIT_COLORS[0])
      setOpen(false)
      onCreated()
    } catch (e) {
      toast.error(`Failed to add habit: ${e}`)
    }
    setSaving(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={triggerClassName} aria-label="Add habit">
        {children}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 p-3 space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
          placeholder="Stretch for 5 minutes"
          autoFocus
        />
        <div className="flex items-center gap-1.5">
          {HABIT_COLORS.map((c) => (
            <button
              key={c}
              className={cn(
                'size-5 rounded-full border-2 transition-all',
                color === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
              )}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              aria-label={`Select color ${c}`}
            />
          ))}
        </div>
        <Button size="sm" className="w-full" onClick={handleCreate} disabled={!name.trim() || saving}>
          {saving ? 'Adding...' : 'Add habit'}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

// ── Manage Habits ──

function ManageHabitsPopover({ habits, onChanged }: { habits: HabitWithStats[]; onChanged: () => void }) {
  const dp = useDataProvider()
  const [deleting, setDeleting] = useState<HabitWithStats | null>(null)

  const handleRename = useCallback(async (id: string, name: string) => {
    try {
      await dp.habits.update({ id, name })
      onChanged()
    } catch (e) {
      toast.error(`Failed to rename habit: ${e}`)
    }
  }, [dp, onChanged])

  const handleDelete = useCallback(async () => {
    if (!deleting) return
    try {
      await dp.habits.delete(deleting.id)
      toast.success(`Habit deleted: "${deleting.name}"`)
      onChanged()
    } catch (e) {
      toast.error(`Failed to delete habit: ${e}`)
    }
    setDeleting(null)
  }, [deleting, dp, onChanged])

  return (
    <>
      <Popover>
        <PopoverTrigger
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
          aria-label="Manage habits"
        >
          <Settings2 className="size-3" />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-64 p-1.5 space-y-0.5">
          {habits.map((h) => (
            <ManageHabitRow key={h.id} habit={h} onRename={handleRename} onDelete={() => setDeleting(h)} />
          ))}
        </PopoverContent>
      </Popover>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the habit and its check-off history. This can't be undone.
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
    </>
  )
}

function ManageHabitRow({
  habit,
  onRename,
  onDelete,
}: {
  habit: HabitWithStats
  onRename: (id: string, name: string) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(habit.name)

  useEffect(() => { setDraft(habit.name) }, [habit.name])

  const save = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== habit.name) onRename(habit.id, trimmed)
    else setDraft(habit.name)
  }

  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors">
      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: habit.color }} />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { setDraft(habit.name); (e.target as HTMLInputElement).blur() }
        }}
        className="flex-1 min-w-0 bg-transparent text-body outline-none"
      />
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
        aria-label={`Delete habit ${habit.name}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}
