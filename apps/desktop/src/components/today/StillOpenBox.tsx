import { useDetailStore } from '@/stores/detailStore'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ageLabel } from '@/lib/todayBrief'
import { BriefBox } from './BriefBox'


type StillOpenTask = { id: string; content: string; due_date: string | null }

/** The oldest open tasks from before `today`, with neutral grey age tags and
 *  the total. Live rows open the task in the detail sidebar; a snapshot
 *  (`readOnly`) renders the same rows without interaction. `loading` shows
 *  row-shaped skeletons instead of an empty state that isn't known yet. */
export function StillOpenBox({
  tasks,
  total,
  today,
  loading = false,
  readOnly = false,
  max = 5,
}: {
  tasks: StillOpenTask[]
  total: number
  today: string
  loading?: boolean
  readOnly?: boolean
  /** Rows shown before "+N more in Tasks" (the module's `count`). */
  max?: number
}) {
  return (
    <BriefBox title="Still open" count={loading ? undefined : total}>
      {loading ? (
        <div className="space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-1">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3 w-6 shrink-0" />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <Meta as="p">Everything's current.</Meta>
      ) : (
        <div className="-mx-2">
          {tasks.slice(0, max).map((task) => {
            const row = (
              <>
                <span className="min-w-0 flex-1 truncate text-body">{task.content}</span>
                {task.due_date && (
                  <Meta tone="muted" className="shrink-0 tabular-nums">{ageLabel(task.due_date, today)}</Meta>
                )}
              </>
            )
            const rowClass = 'flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left'
            return readOnly ? (
              <div key={task.id} className={rowClass}>{row}</div>
            ) : (
              <button
                key={task.id}
                type="button"
                className={cn(rowClass, 'transition-colors duration-(--transition-fast) hover:bg-hover')}
                onClick={() => useDetailStore.getState().openTask(task.id)}
              >
                {row}
              </button>
            )
          })}
          {total > max && <Meta as="p" className="px-2 pt-1">+{total - max} more in Tasks</Meta>}
        </div>
      )}
    </BriefBox>
  )
}
