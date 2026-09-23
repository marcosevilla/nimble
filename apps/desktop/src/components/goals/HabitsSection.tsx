import { useEffect, useState, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useGoalsStore } from '@/stores/goalsStore'
import { useDataProvider } from '@/services/provider-context'
import type { HabitWithStats } from '@nimble/types'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionTitle } from '@/components/shared/typography'
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
import {
  Plus, Settings2, Trash2,
  Dumbbell, PenLine, BookOpen, Footprints, Sun, Droplets, Brush, Camera, Hammer,
  ClipboardList, Heart, Brain, Smartphone, Users, Sparkles, Moon, Leaf, Coffee,
  Music, Bike, GlassWater, Bed, Languages, Code,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { GOAL_COLORS } from '@/lib/goalStatus'
import { habitProgress } from '@/lib/habitToggle'

/* Stored `habit.icon` is a lucide name (kebab or Pascal). This curated map
   covers the names the habit picker and the vault import produce; anything
   else falls back to the keyword emoji (goals P2-6). A full dynamic import
   would ship ~1,500 icon chunks — not worth it for a picker of ~24. */
const HABIT_ICONS: Record<string, LucideIcon> = {
  dumbbell: Dumbbell, 'pen-line': PenLine, 'book-open': BookOpen, footprints: Footprints,
  sun: Sun, droplets: Droplets, brush: Brush, camera: Camera, hammer: Hammer,
  'clipboard-list': ClipboardList, heart: Heart, brain: Brain, smartphone: Smartphone,
  users: Users, sparkles: Sparkles, moon: Moon, leaf: Leaf, coffee: Coffee, music: Music,
  bike: Bike, 'glass-water': GlassWater, bed: Bed, languages: Languages, code: Code,
}

function lucideFor(icon: string): LucideIcon | null {
  const kebab = icon.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return HABIT_ICONS[kebab] ?? null
}

/* Same user-data swatch list as goals — was a byte-identical copy. */
const HABIT_COLORS = GOAL_COLORS

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

const HOLD_DURATION = 500 // ms; the hold ring is optional flourish — a click completes too (decided 2026-09-22)

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
  const Icon = lucideFor(icon)
  const emoji = Icon ? null : renderHabitIcon(icon, name, category)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  // Set when the hold itself completed the habit, so the click that follows
  // pointerup does not toggle it straight back.
  const firedByHold = useRef(false)
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)

  const cancelHold = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    if (progressInterval.current) { clearInterval(progressInterval.current); progressInterval.current = null }
    setHolding(false)
    setProgress(0)
  }, [])

  const startHold = useCallback((e: React.PointerEvent) => {
    if (completed || e.button !== 0) return
    firedByHold.current = false
    setHolding(true)
    setProgress(0)
    const startTime = Date.now()
    progressInterval.current = setInterval(() => {
      setProgress(Math.min((Date.now() - startTime) / HOLD_DURATION, 1))
    }, 16)
    holdTimer.current = setTimeout(() => {
      cancelHold()
      firedByHold.current = true
      onToggle()
    }, HOLD_DURATION)
  }, [completed, onToggle, cancelHold])

  // Mouse click completes at default intensity; the hold is optional
  // (goals P1-1, P1-4). Keyboard goes through handleKeyDown below.
  const handleClick = useCallback(() => {
    if (firedByHold.current) { firedByHold.current = false; return }
    cancelHold()
    onToggle()
  }, [onToggle, cancelHold])

  useEffect(() => cancelHold, [cancelHold])

  // Enter/Space toggle on keydown and stay local: stopPropagation keeps the
  // Dashboard's window-level Space (pause a focus session) from eating the
  // key, and preventDefault stops the native click so it can't toggle twice.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat) return
    cancelHold()
    onToggle()
  }, [onToggle, cancelHold])

  return (
    <div className="flex w-14 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        aria-pressed={completed}
        aria-label={`${name}${completed ? ', done today' : ''}`}
        title={completed ? `${name} — done today. Click to unmark.` : `${name} — click or hold to complete.`}
        className={cn(
          'relative flex size-10 select-none items-center justify-center rounded-full border text-title transition-[background-color,border-color,scale] duration-(--transition-fast) active:scale-[0.96] motion-reduce:active:scale-100',
          completed
            ? 'border-success/40 bg-success/10 text-foreground'
            : 'border-border bg-card text-foreground hover:bg-hover',
          holding && 'scale-[0.96]',
        )}
      >
        {/* Hold progress ring */}
        {holding && !completed && (
          <svg className="absolute inset-0 size-10 -rotate-90 pointer-events-none" viewBox="0 0 40 40" aria-hidden="true">
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
        {Icon ? <Icon className="size-4" aria-hidden="true" /> : <span aria-hidden="true">{emoji}</span>}
        {completed && (
          // font-bold kept for legibility of checkmark on colored bg overlay
          <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full flex items-center justify-center text-label font-bold text-success-fg bg-success">
            ✓
          </span>
        )}
      </button>

      {/* Momentum bar */}
      <div className="w-8 h-1 rounded-full bg-muted overflow-hidden" aria-hidden="true">
        <div
          className="h-full rounded-full transition-[width,opacity] duration-(--transition-base) ease-(--ease-entrance)"
          style={{
            width: `${Math.min(momentum, 100)}%`,
            backgroundColor: color,
            opacity: momentum > 0 ? 0.7 : 0,
          }}
        />
      </div>

      {/* Name — the thing the emoji never said (P2-6) */}
      <span className="w-full truncate text-center text-label text-muted-foreground" aria-hidden="true">{name}</span>
    </div>
  )
}

// ── Habits Section ──

export function HabitsSection() {
  const habits = useGoalsStore((s) => s.habits)
  const habitsLoading = useGoalsStore((s) => s.habitsLoading)
  const loadHabits = useGoalsStore((s) => s.loadHabits)
  const toggleHabit = useGoalsStore((s) => s.toggleHabit)

  useEffect(() => {
    loadHabits()
  }, [loadHabits])

  // Optimistic: the store flips today_completed before the call and rolls
  // back on failure; we only surface the error.
  const handleToggle = useCallback(async (habitId: string) => {
    try {
      await toggleHabit(habitId)
    } catch (e) {
      toast.error(`Couldn't save that check-off — ${e}`)
    }
  }, [toggleHabit])

  const activeHabits = habits.filter((h) => h.active)
  const { done: completedCount } = habitProgress(habits)
  const avgMomentum = activeHabits.length > 0
    ? Math.round(activeHabits.reduce((sum, h) => sum + h.current_momentum, 0) / activeHabits.length)
    : 0

  if (habitsLoading && habits.length === 0) {
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
          <Sparkles className="size-3.5 text-muted-foreground" />
          <SectionTitle>Habits</SectionTitle>
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
          <Sparkles className="size-3.5 text-muted-foreground" />
          <SectionTitle count={`${completedCount}/${activeHabits.length}`}>Habits</SectionTitle>
          <ManageHabitsPopover habits={activeHabits} onChanged={loadHabits} />
        </div>
        {avgMomentum > 0 && (
          <span className="text-label text-muted-foreground">
            {avgMomentum}% momentum
          </span>
        )}
      </div>

      {/* Habit circles */}
      <div className="flex items-start gap-3 flex-wrap" role="group" aria-label="Today's habits">
        {activeHabits.map((habit) => (
          <HabitCircle
            key={habit.id}
            name={habit.name}
            icon={habit.icon}
            color={habit.color}
            category={habit.category}
            completed={habit.today_completed}
            momentum={habit.current_momentum}
            onToggle={() => handleToggle(habit.id)}
          />
        ))}
        <AddHabitPopover
          onCreated={loadHabits}
          triggerClassName="size-10 rounded-full flex items-center justify-center ring-1 ring-dashed ring-border/40 text-muted-foreground hover:text-foreground hover:ring-border/70 transition-[color,box-shadow] duration-(--transition-fast)"
        >
          <Plus className="size-4" />
        </AddHabitPopover>
      </div>
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
                'size-5 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
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
          className="relative flex size-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-hover transition-colors before:absolute before:-inset-2 before:content-['']"
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
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover transition-colors">
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
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-[opacity,color] duration-(--transition-fast)"
        aria-label={`Delete habit ${habit.name}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}
