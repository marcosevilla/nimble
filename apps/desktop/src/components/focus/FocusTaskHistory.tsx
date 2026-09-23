import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Caption, Meta } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { useFocusCache } from '@/stores/focusStore'
import { taskFocusSummary, type TaskFocusSummary } from '@/lib/focusFlows'
import type { FocusHistoryRow } from '@nimble/types'

/**
 * A task's focus time from the engine's history (snapshot totals, never
 * activity logs). Each occurrence shows recorded work and any imported total
 * separately, its completion date when known, and whether it was cleared
 * from the completed tray. Imported totals are aggregates, not session spans.
 */
export function FocusTaskHistoryView({ summary, onMore }: { summary: TaskFocusSummary; onMore?: () => void }) {
  return (
    <section aria-label="Focus time" className="flex flex-col">
      <div className="flex items-baseline justify-between pb-1">
        <p className="text-body-strong">Focus time</p>
        <Meta className="tabular-nums">{summary.total}</Meta>
      </div>
      <ul className="flex flex-col">
        {summary.rows.map((row) => (
          <li key={row.occurrence_id} className="flex min-w-0 items-baseline justify-between gap-3 py-1">
            <div className="min-w-0">
              <Meta as="p" className="truncate">
                {[row.when, ...row.parts].join(' · ')}
              </Meta>
              {row.archived && <Caption as="p">Cleared from tray</Caption>}
            </div>
            <Meta className="shrink-0 tabular-nums">{row.total}</Meta>
          </li>
        ))}
      </ul>
      {onMore && (
        <Button size="xs" variant="ghost" className="self-start" onClick={onMore}>
          Show more
        </Button>
      )}
    </section>
  )
}

/** Loads the task's focus history; renders nothing when the task has none. */
export function FocusTaskHistory({ taskId }: { taskId: string }) {
  const dp = useDataProvider()
  const queueRevision = useFocusCache((s) => s.snapshot?.queue_revision ?? -1)
  const [rows, setRows] = useState<FocusHistoryRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    dp.focus.history({ task_id: taskId }).then(
      (page) => {
        if (!live) return
        setRows(page.rows)
        setCursor(page.next_cursor)
      },
      () => {},
    )
    return () => { live = false }
  }, [dp, taskId, queueRevision])

  const more = useCallback(() => {
    if (!cursor) return
    dp.focus.history({ task_id: taskId, cursor }).then(
      (page) => {
        setRows((prev) => [...prev, ...page.rows])
        setCursor(page.next_cursor)
      },
      () => {},
    )
  }, [dp, taskId, cursor])

  if (rows.length === 0) return null
  return <FocusTaskHistoryView summary={taskFocusSummary(rows)} onMore={cursor ? more : undefined} />
}
