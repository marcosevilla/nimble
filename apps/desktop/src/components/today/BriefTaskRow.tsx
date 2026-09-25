import type { ReactNode } from 'react'
import type { BriefItem } from '@nimble/types'
import { useDetailStore } from '@/stores/detailStore'
import { StatusDropdown, getStatusConfig } from '@/components/tasks/StatusDropdown'
import { Meta } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import { isItemDone, itemTitle } from '@/lib/briefItems'

/** One brief row: the task's status control, its title (opens the task) and
 *  an optional one-line reason, with room for actions underneath. Past
 *  dates, the web and a deleted task get a static status icon and plain
 *  text — the brief itself never changes a task. */
export function BriefTaskRow({
  item,
  readOnly,
  showReason = true,
  children,
}: {
  item: BriefItem
  readOnly: boolean
  showReason?: boolean
  children?: ReactNode
}) {
  const task = item.task
  const taskId = item.task_id
  const done = isItemDone(item)
  const title = itemTitle(item, !readOnly)
  const status = getStatusConfig(task?.status ?? 'todo')
  const StaticIcon = status.icon
  const titleClass = cn('block max-w-full truncate text-left text-body', done && 'text-muted-foreground line-through')

  return (
    <div className="flex min-w-0 gap-2.5 py-2">
      <div className="flex h-5 shrink-0 items-center">
        {!readOnly && task && taskId ? (
          <StatusDropdown taskId={taskId} status={task.status} dueDate={task.due_date} />
        ) : (
          <StaticIcon aria-hidden className={cn('size-3.5', status.iconColor)} />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        {!readOnly && task && taskId ? (
          <button
            type="button"
            className={cn(titleClass, 'focus-ring rounded-sm transition-colors duration-(--transition-fast) hover:text-foreground')}
            onClick={() => useDetailStore.getState().openTask(taskId)}
          >
            {title}
          </button>
        ) : (
          <p className={titleClass}>{title}</p>
        )}
        {showReason && item.body && <Meta as="p">{item.body}</Meta>}
        {children}
      </div>
    </div>
  )
}
