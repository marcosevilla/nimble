import { useId } from 'react'
import { toast } from 'sonner'
import { Maximize2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { emitTasksChanged, useLocalTasks } from '@/hooks/useLocalTasks'
import { cn } from '@/lib/utils'
import { cardTiming, controlBlockedReason, timerControl } from '@/lib/focusQueueIntents'
import { isDroppedRepeat, sendFocusAction, useFocusCache } from '@/stores/focusStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import type { FocusAction, FocusCapabilities, FocusSnapshot, LocalTask } from '@nimble/types'

const PHASE_CLASS = {
  normal: '',
  amber: 'text-warning',
  deepAmber: 'text-warning font-semibold',
  overtime: 'text-destructive',
} as const

export interface FocusBannerViewProps {
  snapshot: FocusSnapshot
  capabilities: FocusCapabilities | null
  /** The first entry's task; null when it left native storage. */
  task: LocalTask | null
  busy: boolean
  onAction: (action: FocusAction) => void
  onExpand: () => void
}

/**
 * Compact single-row focus banner that coexists with shell navigation: the
 * selected task, its snapshot total, the same Start/Pause control as the
 * card (disabled with its reason when unavailable) and Expand. It never
 * stops or clears the queue — Stop/Skip live on the card.
 */
export function FocusBannerView({ snapshot, capabilities, task, busy, onAction, onExpand }: FocusBannerViewProps) {
  const reasonId = useId()
  const entry = snapshot.queue[0]
  if (!entry) return null
  const control = timerControl(snapshot, entry)
  const blocked = controlBlockedReason(control, capabilities)
  const timing = cardTiming(snapshot, entry)
  const running = control.label === 'Pause' || control.label === 'End break'
  const title = task?.content ?? 'Task no longer available'

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border/50 bg-accent-blue/5 px-4 animate-in slide-in-from-top duration-(--transition-fast) motion-reduce:animate-none">
      <span className={cn('font-mono text-body tabular-nums', PHASE_CLASS[timing.presentation.phase])} data-phase={timing.presentation.phase}>
        {timing.presentation.text}
      </span>
      <button
        type="button"
        onClick={onExpand}
        className={cn('min-w-0 flex-1 truncate rounded-sm text-left text-body transition-colors hover:text-foreground focus-ring', !task && 'text-muted-foreground')}
      >
        {title}
      </button>
      {blocked && (
        <span id={reasonId} className="sr-only">
          {blocked}
        </span>
      )}
      <div className="flex items-center gap-2">
        {task && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={control.label}
            aria-describedby={blocked ? reasonId : undefined}
            title={blocked ?? control.label}
            disabled={blocked != null || busy}
            onClick={() => onAction(control.action)}
          >
            {running ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onExpand} aria-label="Expand focus view">
          <Maximize2 className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/** The banner wired to the focus cache; shown by the Dashboard while something is queued. */
export function FocusBanner() {
  const snapshot = useFocusCache((s) => s.snapshot)
  const capabilities = useFocusCache((s) => s.capabilities)
  const busy = useFocusCache((s) => s.pending != null)
  const setExpanded = useFocusSurface((s) => s.setExpanded)
  const { tasks } = useLocalTasks()
  if (!snapshot || snapshot.queue.length === 0) return null
  const task = tasks.find((t) => t.id === snapshot.queue[0].task_id) ?? null
  return (
    <FocusBannerView
      snapshot={snapshot}
      capabilities={capabilities}
      task={task}
      busy={busy}
      onAction={(action) => {
        sendFocusAction(action).then(
          () => { if (action.kind === 'start') emitTasksChanged() },
          // A dropped duplicate (still saving) is not a failure worth a toast.
          (error: unknown) => {
            if (!isDroppedRepeat(error)) toast(error instanceof Error ? error.message : 'Focus change was not saved.')
          },
        )
      }}
      onExpand={() => setExpanded(true)}
    />
  )
}
