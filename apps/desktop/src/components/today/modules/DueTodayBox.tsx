import { CalendarCheck } from 'lucide-react'
import type { BriefTaskRef } from '@nimble/types'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { EmptyState } from '@/components/shared/EmptyState'
import { Meta } from '@/components/shared/typography'
import { LocalTaskRow } from '@/components/tasks/LocalTaskRow'
import { Skeleton } from '@/components/ui/skeleton'
import { configValue } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { BriefBox } from '../BriefBox'
import { useBriefLive } from '../briefLive'
import type { BriefBoxProps } from '../briefModules'

function DueTodayReadOnly({ tasks, empty, loading = false }: { tasks: { id: string; content: string; completed?: boolean }[]; empty: string; loading?: boolean }) {
  return (
    <BriefBox title="Due today" count={loading ? undefined : tasks.length}>
      {loading ? (
        <div className="space-y-1.5">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : tasks.length === 0 ? (
        <Meta as="p">{empty}</Meta>
      ) : (
        <div className="-mx-2">
          {tasks.map((task) => (
            <div key={task.id} className="flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left">
              <span className={cn('min-w-0 flex-1 truncate text-body', task.completed && 'text-muted-foreground line-through')}>{task.content}</span>
            </div>
          ))}
        </div>
      )}
    </BriefBox>
  )
}

/** Live: the day's task rows (checked-off ones stay, struck through, unless
 *  `show_completed` is off). Snapshot/preview: read-only rows. */
export function DueTodayBox({ mode, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const showCompleted = configValue(config, 'show_completed', true)
  if (mode === 'snapshot') {
    return <DueTodayReadOnly tasks={Array.isArray(payload) ? (payload as BriefTaskRef[]) : []} empty="Nothing due that day." />
  }
  if (!live) return null
  const rows = showCompleted ? live.dueToday : live.dueToday.filter((t) => !t.completed)
  if (mode === 'preview') return <DueTodayReadOnly tasks={rows} empty="Nothing due today." loading={!live.tasksReady} />
  const open = live.dueToday.filter((t) => !t.completed).length
  return (
    <CollapsibleSection title="Due today" count={live.tasksReady ? open : undefined} defaultOpen={true} className="-mt-3!">
      {!live.tasksReady ? (
        <div className="space-y-1.5 pt-1">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarCheck} kbd="Q" size="compact">Nothing due today. Add a task with</EmptyState>
      ) : (
        <div>
          {rows.map((task) => {
            const subs = live.subtaskMap[task.id] ?? []
            const done = subs.filter((s) => s.completed || s.status === 'complete').length
            return (
              <div key={task.id}>
                <LocalTaskRow
                  task={task}
                  projectName={live.projectMap[task.project_id]?.name}
                  projectColor={live.projectMap[task.project_id]?.color}
                  subtaskStats={subs.length > 0 ? { done, total: subs.length } : undefined}
                  onDelete={live.removeTask}
                  onAddSubtask={live.addSubtask}
                />
              </div>
            )
          })}
        </div>
      )}
    </CollapsibleSection>
  )
}
