import { displayedDueDate } from '@/lib/displayedTasks'
import { useCallback, useEffect, useState } from 'react'
import { useSelectionStore } from '@/stores/selectionStore'
import { useDetailStore } from '@/stores/detailStore'
import { useProjects } from '@/hooks/useLocalTasks'
import { enqueueTasks, focusNow, focusNowBlockedReason, isDroppedRepeat, useFocusCache } from '@/stores/focusStore'
import { completionSummary, isStaleRefusal } from '@/lib/focusFlows'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { cn } from '@/lib/utils'
import { useLatched, usePresence } from '@/hooks/usePresence'
import { taskCompleteDelayMs } from '@/lib/motion'
import { toast } from 'sonner'
import {
  X,
  Trash2,
  ArrowRight,
  FolderInput,
  Pencil,
  Plus,
  Play,
  ListPlus,
} from 'lucide-react'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import { useDeleteTasks } from '@/components/tasks/useDeleteTasks'
import { setOpenStatuses } from '@/components/tasks/reopenTask'
import { IconButton } from '@/components/shared/IconButton'
import { playCompletionSound } from '@/lib/sound'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { FocusSource, LocalTask, TaskStatus } from '@nimble/types'

/** Multi-select has no single source view; Today is the provenance for a batch. */
const SELECTION_SOURCE: FocusSource = { kind: 'today' }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function BulkActionBar() {
  const dp = useDataProvider()
  const hasSelection = useSelectionStore((s) => s.hasSelection)
  const count = useSelectionStore((s) => s.count)
  const selectedIds = useSelectionStore((s) => s.selectedIds)
  const selectionType = useSelectionStore((s) => s.selectionType)
  // Leaves with `.panel-out` instead of vanishing (loop 4 P2-18); what it
  // renders keeps the last count and kind while it goes (handlers read the
  // live store, and the bar is inert while exiting).
  const { mounted, exiting } = usePresence(hasSelection)
  const shownCount = useLatched(count, exiting)
  const shownType = useLatched(selectionType, exiting)
  const clear = useSelectionStore((s) => s.clear)
  const setAddingSubtaskTo = useSelectionStore((s) => s.setAddingSubtaskTo)
  const markTaskCompleting = useSelectionStore((s) => s.markTaskCompleting)
  const clearTaskCompleting = useSelectionStore((s) => s.clearTaskCompleting)
  const focusCapabilities = useFocusCache((s) => s.capabilities)
  const focusBusy = useFocusCache((s) => s.pending != null)

  const { projects } = useProjects()

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

  // Task deletes go through useDeleteTasks (review I1): leaves get Undo, a
  // selection that takes subtasks with it confirms first.
  const { requestDelete, dialog: deleteDialog } = useDeleteTasks()
  const handleDelete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (selectionType === 'task') {
      const wanted = new Set(ids)
      const all = await dp.tasks.list({ includeCompleted: true }).catch(() => [] as LocalTask[])
      const snapshot = all.filter((t) => wanted.has(t.id))
      if (snapshot.length === 0) { clear(); return }
      await requestDelete(snapshot, clear)
      return
    }
    let deleted = 0
    for (const id of ids) {
      try {
        await dp.captures.delete(id)
        deleted++
      } catch { /* skip */ }
    }
    toast.success(`Deleted ${deleted} item${deleted !== 1 ? 's' : ''}`)
    emitTasksChanged()
    clear()
  }, [selectedIds, selectionType, clear, dp, requestDelete])

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
        // Each completion carries the displayed due date; a task that changed
        // elsewhere (stale occurrence) is refused and reported, not counted.
        let done = 0
        let refused = 0
        let failed = 0
        for (const id of ids) {
          try {
            await dp.tasks.updateStatus(id, status, undefined, displayedDueDate(id))
            done++
          } catch (error) {
            if (isStaleRefusal(error)) refused++
            else failed++
          }
          clearTaskCompleting(id)
        }
        const summary = completionSummary(done, refused, failed)
        if (summary.ok) toast.success(summary.message)
        else toast(summary.message)
        emitTasksChanged()
      }, lastStartDelay + taskCompleteDelayMs())
      clear()
      return
    }

    // Leaving `complete` is a reopen: the shared path offers the reopened
    // parents' cascaded subtasks back in one toast (C3).
    const { done } = await setOpenStatuses(dp, ids, status)
    toast.success(`Set ${done} task${done !== 1 ? 's' : ''} to ${status.replace('_', ' ')}`)
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

  // Bulk convert keeps text as-is; single converts parse dates, see
  // convertWithUndo — a toast per note here would be noise.
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

  // Multi-select default: append the selection to the focus queue in
  // selection order. Nothing starts.
  const handleEnqueue = useCallback(async () => {
    if (selectionType !== 'task') return
    const ids = Array.from(selectedIds)
    try {
      await enqueueTasks(ids, SELECTION_SOURCE)
      toast(`Added ${ids.length} task${ids.length !== 1 ? 's' : ''} to the focus queue`)
      clear()
    } catch (error) {
      if (!isDroppedRepeat(error)) toast(messageOf(error))
    }
  }, [selectionType, selectedIds, clear])

  // Focus now: append the selection, then explicitly start the first one.
  const handleFocusNow = useCallback(async () => {
    if (selectionType !== 'task') return
    const [first, ...rest] = Array.from(selectedIds)
    if (!first) return
    try {
      await focusNow(first, SELECTION_SOURCE)
      if (rest.length) await enqueueTasks(rest, SELECTION_SOURCE)
      emitTasksChanged()
      clear()
    } catch (error) {
      if (!isDroppedRepeat(error)) toast(messageOf(error))
    }
  }, [selectionType, selectedIds, clear])
  const focusNowBlocked = focusNowBlockedReason(focusCapabilities)

  if (!mounted) return null

  const isTask = shownType === 'task'
  const showSingleTaskActions = isTask && shownCount === 1
  const canAddSubtask = showSingleTaskActions && singleSelected && !singleSelected.parent_id

  return (
    <>
    {deleteDialog}
    <div
      className={cn('fixed bottom-6 inset-x-0 z-30 flex justify-center', exiting ? 'panel-out' : 'bulk-action-bar-enter')}
      inert={exiting || undefined}
    >
      <div className="flex items-center gap-1 rounded-xl border border-border/20 bg-popover px-2 py-1.5 shadow-lg shadow-black/5">
        <span className="px-2 text-body-strong tabular-nums">
          {shownCount} selected
        </span>

        <div className="mx-1 h-4 w-px bg-border/30" />

        {isTask && (
          <>
            {/* Focus — shared across single + bulk. The default appends the
                selection to the queue; Focus now is the explicit Start. */}
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(ACTION_CLASS, 'text-accent-blue/80 hover:text-accent-blue')}>
                <Play className="size-3.5" />
                Focus
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" sideOffset={8} className="w-52">
                <DropdownMenuItem className="gap-2" disabled={focusBusy} onClick={() => void handleEnqueue()}>
                  <ListPlus className="size-3.5 text-muted-foreground" />
                  <span>Add to focus queue</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  disabled={focusNowBlocked != null || focusBusy}
                  title={focusNowBlocked ?? undefined}
                  onClick={() => void handleFocusNow()}
                >
                  <Play className="size-3.5 text-muted-foreground" />
                  <span className="flex flex-col">
                    {shownCount > 1 ? 'Focus now (first selected)' : 'Focus now'}
                    {focusNowBlocked && <span className="text-label text-muted-foreground">{focusNowBlocked}</span>}
                  </span>
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
              <DropdownMenuTrigger className={ACTION_CLASS}>
                <StatusIcon className="size-3.5" />
                Status
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
              <DropdownMenuTrigger className={ACTION_CLASS}>
                <FolderInput className="size-3.5" />
                Move
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

        {shownType === 'capture' && (
          <ActionButton
            icon={ArrowRight}
            label="Convert to tasks"
            onClick={handleConvertToTasks}
          />
        )}

        {/* Red glyph, neutral label: --destructive text on the dark
            popover fails AA contrast (axe), the icon carries the warning. */}
        <ActionButton
          icon={Trash2}
          label="Delete"
          onClick={handleDelete}
          className="[&_svg]:text-destructive"
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
    </>
  )
}

/* Shared by ActionButton and the menu triggers: a DropdownMenuTrigger IS
   the button (never wrap an ActionButton in one — nested <button>s). */
const ACTION_CLASS =
  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body text-muted-foreground hover:text-foreground hover:bg-hover transition-colors'

const StatusIcon = STATUSES[1].icon

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
      className={cn(ACTION_CLASS, className)}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
