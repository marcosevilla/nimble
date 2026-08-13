import { useCallback, useEffect, useState } from 'react'
import { useSelectionStore } from '@/stores/selectionStore'
import { useDetailStore } from '@/stores/detailStore'
import { useProjects } from '@/hooks/useLocalTasks'
import { useFocusStore, type FocusConfig } from '@/stores/focusStore'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  X,
  Trash2,
  ArrowRight,
  FolderInput,
  Pencil,
  Plus,
  Play,
  Timer,
  TrendingUp,
} from 'lucide-react'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import { IconButton } from '@/components/shared/IconButton'
import { playCompletionSound } from '@/lib/sound'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { LocalTask, TaskStatus } from '@nimble/types'

const COUNTDOWN_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 25, label: '25 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '60 min' },
]

const ROUND_OPTIONS = [1, 2, 3, 4]

export function BulkActionBar() {
  const dp = useDataProvider()
  const hasSelection = useSelectionStore((s) => s.hasSelection)
  const count = useSelectionStore((s) => s.count)
  const selectedIds = useSelectionStore((s) => s.selectedIds)
  const selectionType = useSelectionStore((s) => s.selectionType)
  const clear = useSelectionStore((s) => s.clear)
  const setAddingSubtaskTo = useSelectionStore((s) => s.setAddingSubtaskTo)
  const markTaskCompleting = useSelectionStore((s) => s.markTaskCompleting)
  const clearTaskCompleting = useSelectionStore((s) => s.clearTaskCompleting)
  const startFocus = useFocusStore((s) => s.startFocus)

  const { projects } = useProjects()

  // Load break length default from settings when the focus menu is needed
  const [breakMinutes, setBreakMinutes] = useState(5)
  useEffect(() => {
    if (!hasSelection) return
    dp.settings.get('focus_break_minutes').then((val) => {
      if (val) setBreakMinutes(parseInt(val, 10) || 5)
    }).catch(() => {})
  }, [hasSelection, dp])

  // Load the metadata of the single selected task (needed to decide whether
  // "Add subtask" is available and to resolve full tasks for focus queuing).
  const [singleSelected, setSingleSelected] = useState<LocalTask | null>(null)
  useEffect(() => {
    if (selectionType !== 'task' || count !== 1) {
      setSingleSelected(null)
      return
    }
    const id = Array.from(selectedIds)[0]
    dp.tasks.list().then((all) => {
      setSingleSelected(all.find((t) => t.id === id) ?? null)
    }).catch(() => setSingleSelected(null))
  }, [selectionType, count, selectedIds, dp])

  const handleDelete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    let deleted = 0
    for (const id of ids) {
      try {
        if (selectionType === 'task') await dp.tasks.delete(id)
        else await dp.captures.delete(id)
        deleted++
      } catch { /* skip */ }
    }
    toast.success(`Deleted ${deleted} item${deleted !== 1 ? 's' : ''}`)
    emitTasksChanged()
    clear()
  }, [selectedIds, selectionType, clear, dp])

  const handleSetStatus = useCallback(async (status: TaskStatus) => {
    if (selectionType !== 'task') return
    const ids = Array.from(selectedIds)

    if (status === 'complete') {
      // Play the row-exit animation on each selected task before writing
      // the status update. Small 40ms stagger makes the batch read as
      // intentional instead of as a simultaneous vanish.
      playCompletionSound()
      ids.forEach((id, i) => {
        setTimeout(() => markTaskCompleting(id), i * 40)
      })
      const lastStartDelay = (ids.length - 1) * 40
      setTimeout(async () => {
        for (const id of ids) {
          try { await dp.tasks.updateStatus(id, status) } catch { /* skip */ }
          clearTaskCompleting(id)
        }
        toast.success(`Completed ${ids.length} task${ids.length !== 1 ? 's' : ''}`)
        emitTasksChanged()
      }, lastStartDelay + 580)
      clear()
      return
    }

    for (const id of ids) {
      try { await dp.tasks.updateStatus(id, status) } catch { /* skip */ }
    }
    toast.success(`Set ${ids.length} task${ids.length !== 1 ? 's' : ''} to ${status.replace('_', ' ')}`)
    emitTasksChanged()
    clear()
  }, [selectedIds, selectionType, clear, dp, markTaskCompleting, clearTaskCompleting])

  const handleMove = useCallback(async (projectId: string) => {
    if (selectionType !== 'task') return
    const ids = Array.from(selectedIds)
    const project = projects.find((p) => p.id === projectId)
    for (const id of ids) {
      try { await dp.tasks.update({ id, projectId }) } catch { /* skip */ }
    }
    toast.success(`Moved ${ids.length} task${ids.length !== 1 ? 's' : ''} to ${project?.name ?? 'project'}`)
    emitTasksChanged()
    clear()
  }, [selectedIds, selectionType, projects, clear, dp])

  const handleConvertToTasks = useCallback(async () => {
    if (selectionType !== 'capture') return
    const ids = Array.from(selectedIds)
    let converted = 0
    for (const id of ids) {
      try { await dp.captures.convertToTask(id); converted++ } catch { /* skip */ }
    }
    toast.success(`Converted ${converted} note${converted !== 1 ? 's' : ''} to tasks`)
    emitTasksChanged()
    clear()
  }, [selectedIds, selectionType, clear, dp])

  // Editing an existing task is create-only-composer's exclusion (Decision
  // 14 + 18) — routes to opening Task Details instead of an inline editor.
  const handleEdit = useCallback(() => {
    if (selectionType !== 'task' || count !== 1) return
    const id = Array.from(selectedIds)[0]
    useDetailStore.getState().openTask(id)
    clear()
  }, [selectionType, count, selectedIds, clear])

  const handleAddSubtask = useCallback(() => {
    if (selectionType !== 'task' || count !== 1 || !singleSelected) return
    setAddingSubtaskTo(singleSelected.id)
    clear()
  }, [selectionType, count, singleSelected, setAddingSubtaskTo, clear])

  const handleFocus = useCallback(async (config: FocusConfig) => {
    if (selectionType !== 'task') return
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const all = await dp.tasks.list().catch(() => [] as LocalTask[])
    // Preserve the selection order
    const selected = ids
      .map((id) => all.find((t) => t.id === id))
      .filter((t): t is LocalTask => t != null)
    if (selected.length === 0) return
    const [first, ...queue] = selected
    startFocus(first, config, queue)
    clear()
  }, [selectionType, selectedIds, dp, startFocus, clear])

  const handleCountdown = useCallback((minutes: number, rounds: number) => {
    handleFocus({
      timerMode: 'down',
      targetMinutes: minutes,
      breakMinutes,
      totalPomodoros: rounds,
    })
  }, [handleFocus, breakMinutes])

  const handleStopwatch = useCallback(() => {
    handleFocus({ timerMode: 'up', targetMinutes: 0, breakMinutes: 0, totalPomodoros: 1 })
  }, [handleFocus])

  if (!hasSelection) return null

  const isTask = selectionType === 'task'
  const showSingleTaskActions = isTask && count === 1
  const canAddSubtask = showSingleTaskActions && singleSelected && !singleSelected.parent_id

  return (
    <div className="fixed bottom-6 inset-x-0 z-30 flex justify-center bulk-action-bar-enter">
      <div className="flex items-center gap-1 rounded-xl border border-border/20 bg-popover px-2 py-1.5 shadow-lg shadow-black/5">
        <span className="px-2 text-body-strong tabular-nums">
          {count} selected
        </span>

        <div className="mx-1 h-4 w-px bg-border/30" />

        {isTask && (
          <>
            {/* Focus — shared across single + bulk. Bulk queues remaining. */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <ActionButton
                  icon={Play}
                  label={count > 1 ? 'Focus queue' : 'Focus'}
                  onClick={() => {}}
                  className="text-accent-blue/80 hover:text-accent-blue"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" sideOffset={8} className="w-44">
                {COUNTDOWN_OPTIONS.map((opt) => (
                  <DropdownMenuSub key={opt.minutes}>
                    <DropdownMenuSubTrigger
                      className="gap-2"
                      onClick={() => handleCountdown(opt.minutes, 1)}
                    >
                      <Timer className="size-3.5 text-muted-foreground" />
                      <span className="flex-1 text-left">{opt.label}</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-32">
                      <DropdownMenuItem onClick={() => handleCountdown(opt.minutes, 1)}>
                        No breaks
                      </DropdownMenuItem>
                      {ROUND_OPTIONS.filter((r) => r > 1).map((rounds) => (
                        <DropdownMenuItem
                          key={rounds}
                          onClick={() => handleCountdown(opt.minutes, rounds)}
                        >
                          {rounds} rounds
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2" onClick={handleStopwatch}>
                  <TrendingUp className="size-3.5 text-muted-foreground" />
                  <span>Stopwatch</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Single-task-only: Edit */}
            {showSingleTaskActions && (
              <ActionButton icon={Pencil} label="Edit" onClick={handleEdit} />
            )}

            {/* Single-task-only: Add subtask (only if selected task isn't already a subtask) */}
            {canAddSubtask && (
              <ActionButton icon={Plus} label="Add subtask" onClick={handleAddSubtask} />
            )}

            {/* Status — works for any number */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <ActionButton
                  icon={STATUSES[1].icon}
                  label="Status"
                  onClick={() => {}}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" sideOffset={8} className="w-40">
                {STATUSES.map((s) => {
                  const SIcon = s.icon
                  return (
                    <DropdownMenuItem
                      key={s.value}
                      className="gap-2"
                      onClick={() => handleSetStatus(s.value)}
                    >
                      <SIcon className={cn('size-4', s.iconColor)} />
                      {s.label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Move to project */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <ActionButton
                  icon={FolderInput}
                  label="Move"
                  onClick={() => {}}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" sideOffset={8} className="w-36">
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    className="gap-2"
                    onClick={() => handleMove(p.id)}
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {selectionType === 'capture' && (
          <ActionButton
            icon={ArrowRight}
            label="Convert to tasks"
            onClick={handleConvertToTasks}
          />
        )}

        <ActionButton
          icon={Trash2}
          label="Delete"
          onClick={handleDelete}
          className="text-destructive/60 hover:text-destructive"
        />

        <div className="mx-1 h-4 w-px bg-border/30" />

        <IconButton
          onClick={clear}
          size="lg"
          title="Clear selection"
        >
          <X className="size-4" />
        </IconButton>
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: typeof X
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors',
        className,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
