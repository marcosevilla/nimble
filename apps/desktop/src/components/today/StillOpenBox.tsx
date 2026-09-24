import { useDetailStore } from '@/stores/detailStore'
import { Meta } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import { ageLabel } from '@/lib/todayBrief'
import { BriefBox } from './BriefBox'

const MAX_ROWS = 5

type StillOpenTask = { id: string; content: string; due_date: string | null }

/** The oldest open tasks from before `today`, with neutral grey age tags and
 *  the total. Live rows open the task in the detail sidebar; a snapshot
 *  (`readOnly`) renders the same rows without interaction. */
export function StillOpenBox({
  tasks,
  total,
  today,
  readOnly = false,
}: {
  tasks: StillOpenTask[]
  total: number
  today: string
  readOnly?: boolean
}) {
  return (
    <BriefBox title="Still open" count={total}>
      {total === 0 ? (
        <Meta as="p">Everything's current.</Meta>
      ) : (
        <div className="-mx-2">
          {tasks.slice(0, MAX_ROWS).map((task) => {
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
          {total > MAX_ROWS && <Meta as="p" className="px-2 pt-1">+{total - MAX_ROWS} more in Tasks</Meta>}
        </div>
      )}
    </BriefBox>
  )
}
