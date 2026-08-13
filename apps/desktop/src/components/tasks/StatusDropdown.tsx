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
import type { TaskStatus } from '@nimble/types'
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
  { value: 'todo', label: 'Todo', icon: CircleDot, color: 'text-blue-500', iconColor: 'text-blue-500' },
  { value: 'in_progress', label: 'In Progress', icon: Loader, color: 'text-amber-500', iconColor: 'text-amber-500' },
  { value: 'blocked', label: 'Blocked', icon: Ban, color: 'text-red-500', iconColor: 'text-red-500' },
  { value: 'complete', label: 'Complete', icon: CheckCircle2, color: 'text-green-500', iconColor: 'text-green-500' },
]

export function getStatusConfig(status: TaskStatus): StatusConfig {
  return STATUSES.find((s) => s.value === status) ?? STATUSES[1]
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
}

export function StatusDropdown({ taskId, status, size = 'sm', onComplete }: StatusDropdownProps) {
  const dp = useDataProvider()
  const markTaskCompleting = useSelectionStore((s) => s.markTaskCompleting)
  const clearTaskCompleting = useSelectionStore((s) => s.clearTaskCompleting)
  const [open, setOpen] = useState(false)
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
          await dp.tasks.updateStatus(taskId, newStatus)
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
      await dp.tasks.updateStatus(taskId, newStatus)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to update status: ${e}`)
    }
  }, [taskId, status, dp, markTaskCompleting, clearTaskCompleting, onComplete])

  const handleBlockedSubmit = useCallback(async () => {
    try {
      await dp.tasks.updateStatus(taskId, 'blocked', blockedReason.trim() || undefined)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to update status: ${e}`)
    }
    setShowBlockedInput(false)
    setBlockedReason('')
    setOpen(false)
  }, [taskId, blockedReason, dp])

  const iconSize = size === 'md' ? 'size-5' : 'size-4'

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setShowBlockedInput(false); setBlockedReason('') } }}>
      <PopoverTrigger
        className={cn(
          'shrink-0 rounded-md transition-colors hover:bg-accent/20',
          size === 'md' ? 'p-0.5' : 'p-0',
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
                className="rounded-md px-2 py-1 text-meta text-muted-foreground hover:bg-accent/20"
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
                  s.value === status ? 'bg-accent/40' : 'hover:bg-accent/20',
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
