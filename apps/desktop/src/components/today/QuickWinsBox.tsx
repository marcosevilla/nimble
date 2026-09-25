import { useState } from 'react'
import { toast } from 'sonner'
import type { BriefItem } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { createUndoable } from '@/lib/undoable'
import { showUndoToast } from '@/components/shared/undoToast'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Label, Meta } from '@/components/shared/typography'
import { itemsOf, producedIds } from '@/lib/briefItems'
import {
  BREAKDOWN_UNDO_MS,
  COPIED_MESSAGE,
  breakDownItem,
  breakDownMessage,
  copyItemForClaude,
  subtasksAddedLabel,
  undoBreakDown,
} from '@/lib/quickWinActions'
import { BriefBox } from './BriefBox'
import { BriefTaskRow } from './BriefTaskRow'
import { useBriefItems } from './briefContext'

function ColumnSkeleton() {
  return (
    <div className="space-y-3 pt-1">
      {[...Array(2)].map((_, i) => (
        <div key={i} className="flex gap-2.5">
          <Skeleton className="size-3.5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Column({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <div role="group" aria-label={title} className="min-w-0">
      <Label as="h3">{title}</Label>
      {empty ? <Meta as="p" className="py-2">None today.</Meta> : <div className="divide-y divide-border/50">{children}</div>}
    </div>
  )
}

/** "I can help" row: the two working actions (A4). Both are additive. */
function HelpRow({ item, readOnly }: { item: BriefItem; readOnly: boolean }) {
  const dp = useDataProvider()
  const [busy, setBusy] = useState<'break' | 'copy' | null>(null)
  // What this row added, kept locally until Undo: if the row's state
  // couldn't be saved, the button must not come back and add them twice.
  const [added, setAdded] = useState<string[] | null>(null)
  const saved = producedIds(item)
  const created = saved.length > 0 ? saved : (added ?? [])
  const taskId = item.task_id

  const onBreakDown = async () => {
    setBusy('break')
    try {
      const { created: ids } = await breakDownItem(
        { breakDown: dp.ai.breakDownTask, createSubtask: (o) => dp.tasks.create(o), setItemState: dp.brief.setItemState },
        item,
      )
      if (ids.length === 0) {
        toast.error('Couldn’t add subtasks. Try again.')
        return
      }
      setAdded(ids)
      // Also re-reads the brief's items (useBriefComposition listens), so a
      // row a composition replaced mid-breakdown drops out.
      emitTasksChanged()
      if (taskId) dp.activity.log('task_breakdown_applied', taskId, { subtask_count: ids.length, source: 'brief' }).catch(() => {})
      const pending = createUndoable({
        onCommit: () => {},
        onUndo: () => {
          void undoBreakDown({ deleteTask: (id) => dp.tasks.delete(id), setItemState: dp.brief.setItemState }, item.id, ids).then((failed) => {
            setAdded(null)
            emitTasksChanged()
            if (failed > 0) toast.error('Some subtasks couldn’t be removed.')
          })
        },
      })
      showUndoToast(breakDownMessage(ids.length), pending, BREAKDOWN_UNDO_MS)
    } catch (e) {
      toast.error(`Couldn’t break it down. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const onCopy = async () => {
    if (!taskId) return
    setBusy('copy')
    try {
      const result = await copyItemForClaude(
        {
          listTasks: () => dp.tasks.list({ includeCompleted: true }),
          listProjects: () => dp.projects.list(),
          focusSnapshot: () => dp.focus.snapshot(),
          focusCapabilities: () => dp.focus.capabilities(),
          write: typeof navigator !== 'undefined' && navigator.clipboard ? (t) => navigator.clipboard.writeText(t) : undefined,
        },
        taskId,
      )
      if (result.ok) toast.success(COPIED_MESSAGE)
      else toast.error(`Couldn’t copy. ${result.message}`)
    } catch (e) {
      toast.error(`Couldn’t copy. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <BriefTaskRow item={item} readOnly={readOnly}>
      {/* Third line (Marco, 2026-09-25): both actions always visible, Tab reaches both. */}
      {!readOnly && item.task && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {created.length > 0 ? (
            <Meta>{subtasksAddedLabel(created.length)}</Meta>
          ) : (
            <Button size="xs" variant="secondary" disabled={busy !== null} onClick={onBreakDown}>
              {busy === 'break' ? 'Breaking it down…' : 'Break it down'}
            </Button>
          )}
          <Button size="xs" variant="secondary" disabled={busy !== null} onClick={onCopy}>
            Copy for Claude
          </Button>
        </div>
      )}
    </BriefTaskRow>
  )
}

/** Quick wins (A4): "I can help" (help-labelled tasks and AI picks, with
 *  Break it down and Copy for Claude) and "Only you" (quick-labelled, no
 *  buttons). ≤3 rows each. Past dates and the web are read-only. */
export function QuickWinsBox() {
  const c = useBriefItems()
  const help = itemsOf(c?.items, 'quick_help')
  const solo = itemsOf(c?.items, 'quick_self')
  const readOnly = c?.readOnly ?? true
  const empty = help.length + solo.length === 0
  const pending = !!c && empty && (c.view === 'pending' || c.items === undefined)
  return (
    <BriefBox title="Quick wins">
      {pending ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <ColumnSkeleton />
          <ColumnSkeleton />
        </div>
      ) : empty ? (
        <Meta as="p">No quick wins spotted today.</Meta>
      ) : (
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Column title="I can help" empty={help.length === 0}>
            {help.map((item) => (
              <HelpRow key={item.id} item={item} readOnly={readOnly} />
            ))}
          </Column>
          <Column title="Only you" empty={solo.length === 0}>
            {solo.map((item) => (
              <BriefTaskRow key={item.id} item={item} readOnly={readOnly} showReason={false} />
            ))}
          </Column>
        </div>
      )}
    </BriefBox>
  )
}
