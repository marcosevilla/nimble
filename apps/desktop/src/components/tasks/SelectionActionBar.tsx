import { useCallback } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { useSelectionStore } from '@/stores/selectionStore'
import { useDataProvider } from '@/services/provider-context'
import { useProjects, emitTasksChanged } from '@/hooks/useLocalTasks'
import { cn } from '@/lib/utils'
import { PriorityBars } from '@/components/shared/PriorityBars'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

// Normal 1 / Medium 2 / High 3 / Urgent 4 — mirrors MetadataChips.tsx's
// PRIORITY_OPTIONS (not exported from there, so duplicated here rather than
// reaching into an unrelated file's internals for a 4-item constant).
const PRIORITY_OPTIONS = [
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

const ACTION_BUTTON =
  'h-7 rounded-md px-2 text-body text-foreground hover:bg-accent transition-colors inline-flex items-center outline-none'

const s = (n: number) => (n !== 1 ? 's' : '')

/**
 * Every batch action below loops a best-effort per-id `dp` mutation (no
 * atomic bulk command exists), so a partial failure is possible — a stale
 * id, a dropped IPC call, etc. Reporting the *requested* count regardless of
 * outcome would silently claim "Deleted 3 tasks" when only 2 actually
 * deleted, which is actively misleading for an irreversible action.
 *
 * `describe(n)` renders the full sentence for `n` successes (each handler
 * supplies its own verb/object, e.g. `(n) => \`Moved ${n} task${s(n)} to
 * Life Admin\``) so pluralization and wording stay correct at any count.
 * All-success → one `toast.success`. Any failure (partial or total) →
 * `toast.error` with the real success count plus how many failed.
 */
function reportBatch(successCount: number, total: number, describe: (n: number) => string) {
  if (successCount === total) {
    toast.success(describe(successCount))
    return
  }
  toast.error(`${describe(successCount)} — ${total - successCount} failed`)
}

/**
 * Floating multi-select action bar for the Tasks page (ProjectDetailPage +
 * TasksPage's All Tasks view). Sits inside the list's own scroll container
 * (`sticky bottom-4`) rather than fixed to the viewport, per Figma frame
 * decision 5b. Renders only while ≥1 *task* is selected via the hover
 * checkboxes — capture selection (Inbox) is still served by the separate,
 * viewport-fixed `BulkActionBar`.
 *
 * No new bulk backend commands: every action loops the existing single-task
 * `dp.tasks.*` mutations (YAGNI at current data sizes), fires one
 * `emitTasksChanged()` + one summary toast per batch, then clears selection.
 */
export function SelectionActionBar() {
  const dp = useDataProvider()
  const selectionType = useSelectionStore((s) => s.selectionType)
  const count = useSelectionStore((s) => s.count)
  const selectedIds = useSelectionStore((s) => s.selectedIds)
  const clear = useSelectionStore((s) => s.clear)
  const { projects } = useProjects()

  const handleComplete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    let successCount = 0
    for (const id of ids) {
      try {
        await dp.tasks.complete(id)
        successCount++
      } catch {
        /* counted as failed below */
      }
    }
    emitTasksChanged()
    clear()
    reportBatch(successCount, ids.length, (n) => `Completed ${n} task${s(n)}`)
  }, [selectedIds, dp, clear])

  const handleMove = useCallback(
    async (projectId: string) => {
      const ids = Array.from(selectedIds)
      const label = projects.find((p) => p.id === projectId)?.name ?? 'project'
      let successCount = 0
      for (const id of ids) {
        try {
          await dp.tasks.update({ id, projectId })
          successCount++
        } catch {
          /* counted as failed below */
        }
      }
      emitTasksChanged()
      clear()
      reportBatch(successCount, ids.length, (n) => `Moved ${n} task${s(n)} to ${label}`)
    },
    [selectedIds, projects, dp, clear],
  )

  const handlePriority = useCallback(
    async (priority: number) => {
      const ids = Array.from(selectedIds)
      const label = PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? 'priority'
      let successCount = 0
      for (const id of ids) {
        try {
          await dp.tasks.update({ id, priority })
          successCount++
        } catch {
          /* counted as failed below */
        }
      }
      emitTasksChanged()
      clear()
      reportBatch(successCount, ids.length, (n) => `Set ${n} task${s(n)} to ${label} priority`)
    },
    [selectedIds, dp, clear],
  )

  const handleDelete = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (!window.confirm(`Delete ${ids.length} task${s(ids.length)}? This can't be undone.`)) {
      return
    }
    let successCount = 0
    for (const id of ids) {
      try {
        await dp.tasks.delete(id)
        successCount++
      } catch {
        /* counted as failed below */
      }
    }
    emitTasksChanged()
    clear()
    reportBatch(successCount, ids.length, (n) => `Deleted ${n} task${s(n)}`)
  }, [selectedIds, dp, clear])

  if (selectionType !== 'task' || count === 0) return null

  return (
    <div className="sticky bottom-4 z-20 mx-auto w-fit animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-1 rounded-[10px] border border-input bg-card px-2 py-1.5 shadow-[0px_6px_16px_-2px_rgba(0,0,0,0.12)]">
        <span className="px-2 text-meta text-muted-foreground tabular-nums">
          {count} selected
        </span>

        <div className="h-4 w-px bg-border" />

        <button type="button" onClick={handleComplete} className={ACTION_BUTTON}>
          Complete
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className={ACTION_BUTTON}>Move to…</DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-40">
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} className="gap-2" onClick={() => handleMove(p.id)}>
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger className={ACTION_BUTTON}>Priority</DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-36">
            {PRIORITY_OPTIONS.map((o) => (
              <DropdownMenuItem key={o.value} className="gap-2" onClick={() => handlePriority(o.value)}>
                <PriorityBars priority={o.value} />
                {o.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={handleDelete}
          className={cn(ACTION_BUTTON, 'text-destructive hover:text-destructive')}
        >
          Delete
        </button>

        <div className="h-4 w-px bg-border" />

        <button
          type="button"
          onClick={clear}
          aria-label="Clear selection"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  )
}
