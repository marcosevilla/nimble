import { useState, useCallback } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { ListPlus, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { sourceForTask } from '@/lib/focusFlows'
import { enqueueTasks, focusNow, focusNowBlockedReason, useFocusCache } from '@/stores/focusStore'
import { isFocusableTask } from '@/lib/focusTaskEntry'
import { reportFocusError } from './focusEntryActions'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { LocalTask } from '@nimble/types'

interface FocusPlayMenuProps {
  task: LocalTask
  onOpenChange?: (open: boolean) => void
}

/**
 * Command-bar focus entry: "Add to focus queue" appends (the default, starts
 * nothing); "Focus now" is the explicit Start, shown disabled with its reason
 * while live timing is unavailable. Hidden for completed tasks; failures show
 * friendly copy. Timebox choice lives on the focus card.
 */
export function FocusPlayMenu({ task, onOpenChange }: FocusPlayMenuProps) {
  const [open, setOpenState] = useState(false)
  const capabilities = useFocusCache((s) => s.capabilities)
  const busy = useFocusCache((s) => s.pending != null)
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    onOpenChange?.(v)
  }, [onOpenChange])
  const blocked = focusNowBlockedReason(capabilities)
  const source = sourceForTask(task, format(new Date(), 'yyyy-MM-dd'))

  const run = (label: string, write: () => Promise<unknown>) => {
    setOpen(false)
    write().then(
      () => toast(label),
      (error) => reportFocusError(error),
    )
  }

  // Completed tasks get no focus entry (the engine refuses them without an
  // explicit still-open choice) — same rule as task rows and detail.
  if (!isFocusableTask(task)) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={`Focus options for ${task.content}`}
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-md transition-colors',
          'text-accent-blue/60 hover:text-accent-blue hover:bg-hover',
        )}
      >
        <Play className="size-3" />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-52">
        <DropdownMenuItem className="gap-2" disabled={busy} onClick={() => {
          if (useFocusCache.getState().snapshot?.queue.some((e) => e.task_id === task.id)) {
            setOpen(false)
            toast('Already in the focus queue')
          } else run('Added to focus queue', () => enqueueTasks([task.id], source))
        }}>
          <ListPlus className="size-3.5 text-muted-foreground" />
          <span>Add to focus queue</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          disabled={blocked != null || busy}
          title={blocked ?? undefined}
          onClick={() => run('Focusing now', async () => { await focusNow(task.id, source); emitTasksChanged() })}
        >
          <Play className="size-3.5 text-muted-foreground" />
          <span className="flex flex-col">
            Focus now
            {blocked && <span className="text-label text-muted-foreground">{blocked}</span>}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
