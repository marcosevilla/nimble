import { displayedDueDate } from '@/lib/displayedTasks'
import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Circle, CircleDot, Loader, Ban, CheckCircle2 } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { useDataProvider } from '@/services/provider-context'
import { useSelectionStore } from '@/stores/selectionStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { playCompletionSound } from '@/lib/sound'
import { toast } from 'sonner'
import { reopenTask } from './reopenTask'
import type { DataProvider, TaskStatus } from '@nimble/types'
import type { LucideIcon } from 'lucide-react'

/** Matches the `task-complete-exit` keyframe duration in index.css. */
const TASK_COMPLETE_ANIM_MS = 580

export interface StatusConfig {
  value: TaskStatus
  label: string
  icon: LucideIcon
  color: string
  iconColor: string
}

export const STATUSES: StatusConfig[] = [
  { value: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted-foreground', iconColor: 'text-muted-foreground' },
  { value: 'todo', label: 'Todo', icon: CircleDot, color: 'text-status-todo', iconColor: 'text-status-todo' },
  { value: 'in_progress', label: 'In progress', icon: Loader, color: 'text-status-in-progress', iconColor: 'text-status-in-progress' },
  { value: 'blocked', label: 'Blocked', icon: Ban, color: 'text-status-blocked', iconColor: 'text-status-blocked' },
  { value: 'complete', label: 'Complete', icon: CheckCircle2, color: 'text-status-complete', iconColor: 'text-status-complete' },
]

export function getStatusConfig(status: TaskStatus): StatusConfig {
  return STATUSES.find((s) => s.value === status) ?? STATUSES[1]
}

/** Complete a task the way the status menu does: play the row's exit
 * animation first, then fire the mutation as the row finishes sliding out.
 * Shared with the `x` row shortcut (tasks audit P1-1) so keyboard and mouse
 * completion look identical. */
export function completeTaskWithExit(dp: DataProvider, taskId: string, dueDate?: string | null) {
  const store = useSelectionStore.getState()
  playCompletionSound()
  store.markTaskCompleting(taskId)
  setTimeout(async () => {
    try {
      await dp.tasks.updateStatus(taskId, 'complete', undefined, dueDate !== undefined ? dueDate : displayedDueDate(taskId))
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to update status: ${e}`)
    } finally {
      useSelectionStore.getState().clearTaskCompleting(taskId)
    }
  }, TASK_COMPLETE_ANIM_MS)
}

interface StatusDropdownProps {
  taskId: string
  status: TaskStatus
  size?: 'sm' | 'md'
  /** Fired the moment the user picks "Complete" — before the exit animation
   * and the mutation. Lets a caller that already knows this task is
   * recurring (Task 13's ↻ affordance) show a "Rescheduled to <date>" toast
   * without needing this component to know anything about recurrence. */
  onComplete?: () => void
  /** The due date shown with this task (null = none) — the recurring
   * occurrence identity sent with completion. */
  dueDate?: string | null
}

export function StatusDropdown({ taskId, status, size = 'sm', onComplete, dueDate }: StatusDropdownProps) {
  const dp = useDataProvider()
  const markTaskCompleting = useSelectionStore((s) => s.markTaskCompleting)
  const clearTaskCompleting = useSelectionStore((s) => s.clearTaskCompleting)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [showBlockedInput, setShowBlockedInput] = useState(false)
  const [blockedReason, setBlockedReason] = useState('')

  // Trigger a micro-pulse on the status icon whenever the status prop
  // changes (confirms the action visually after the value updates).
  const [pulseKey, setPulseKey] = useState(0)
  const prevStatus = useRef(status)
  useEffect(() => {
    if (prevStatus.current !== status) {
      setPulseKey((k) => k + 1)
      prevStatus.current = status
    }
  }, [status])

  const current = getStatusConfig(status)
  const Icon = current.icon

  // Any non-complete status. Leaving `complete` is a reopen, which goes
  // through reopenTask so a cascaded parent offers its subtasks back (C3).
  const setOpenStatus = useCallback(async (next: TaskStatus, reason?: string) => {
    if (status === 'complete') {
      await reopenTask(dp, taskId, next, reason)
      return
    }
    await dp.tasks.updateStatus(taskId, next, reason)
    emitTasksChanged()
  }, [dp, taskId, status])

  const handleSelect = useCallback(async (newStatus: TaskStatus) => {
    if (newStatus === status) { setOpen(false); return }

    if (newStatus === 'blocked') {
      setShowBlockedInput(true)
      return
    }

    setOpen(false)

    // Complete is special — play the exit animation on the row first,
    // then fire the mutation so the list re-renders right as the row
    // finishes its 600ms slide-out.
    if (newStatus === 'complete') {
      onComplete?.()
      playCompletionSound()
      markTaskCompleting(taskId)
      setTimeout(async () => {
        try {
          await dp.tasks.updateStatus(taskId, newStatus, undefined, dueDate !== undefined ? dueDate : displayedDueDate(taskId))
          emitTasksChanged()
        } catch (e) {
          toast.error(`Failed to update status: ${e}`)
        } finally {
          clearTaskCompleting(taskId)
        }
      }, TASK_COMPLETE_ANIM_MS)
      return
    }

    try {
      await setOpenStatus(newStatus)
    } catch (e) {
      toast.error(`Failed to update status: ${e}`)
    }
  }, [taskId, status, dp, markTaskCompleting, clearTaskCompleting, onComplete, dueDate, setOpenStatus])

  const handleBlockedSubmit = useCallback(async () => {
    try {
      await setOpenStatus('blocked', blockedReason.trim() || undefined)
    } catch (e) {
      toast.error(`Failed to update status: ${e}`)
    }
    setShowBlockedInput(false)
    setBlockedReason('')
    setOpen(false)
  }, [blockedReason, setOpenStatus])

  const iconSize = size === 'md' ? 'size-5' : 'size-4'

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setShowBlockedInput(false); setBlockedReason('') } }}>
      {/* The 16px glyph stays; the target grows to 28px via negative margin
          so the row height is unaffected (tasks audit P3-3). */}
      <PopoverTrigger
        ref={triggerRef}
        aria-label={`Status: ${current.label}`}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover',
          size === 'md' ? 'size-8 -m-1.5' : 'size-7 -m-1.5',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon
          key={pulseKey}
          className={cn(
            iconSize,
            current.iconColor,
            pulseKey > 0 && 'animate-count-pulse',
          )}
        />
      </PopoverTrigger>

      {/* Portal detaches the DOM tree but not the React tree — clicks here
          still bubble through React's synthetic event system up to the
          row's onClick={onOpen}. Stop propagation at the wrapper so picking
          any option (or Cancel/Set blocked) never opens task details. */}
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-44 gap-0 p-1"
        // In a list, closing hands focus to the row (not this trigger) so
        // j/k keep going (fix round 2, N1); elsewhere the default applies.
        finalFocus={() => triggerRef.current?.closest<HTMLElement>('[data-nav-row]') ?? true}
        onClick={(e) => e.stopPropagation()}
      >
        {showBlockedInput ? (
          <div className="p-2 space-y-2">
            <p className="text-meta text-muted-foreground">Why is this blocked?</p>
            <Input
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleBlockedSubmit() }
                if (e.key === 'Escape') { e.preventDefault(); setShowBlockedInput(false) }
              }}
              placeholder="Waiting on..."
              className="h-7 text-body"
              autoFocus
            />
            <div className="flex justify-end gap-1">
              <button
                onClick={() => setShowBlockedInput(false)}
                className="rounded-md px-2 py-1 text-meta text-muted-foreground hover:bg-hover"
              >
                Cancel
              </button>
              {/* font-medium kept for contrast on foreground bg */}
              <button
                onClick={handleBlockedSubmit}
                className="rounded-md bg-foreground px-2 py-1 text-meta text-background font-medium"
              >
                Set blocked
              </button>
            </div>
          </div>
        ) : (
          STATUSES.map((s) => {
            const SIcon = s.icon
            return (
              <button
                key={s.value}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-body transition-colors',
                  s.value === status ? 'bg-accent/40' : 'hover:bg-hover',
                )}
                onClick={() => handleSelect(s.value)}
              >
                <SIcon className={cn('size-4', s.iconColor)} />
                <span>{s.label}</span>
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
