import { useEffect } from 'react'
import { Check } from 'lucide-react'
import type { BriefHabitRef } from '@nimble/types'
import { Meta } from '@/components/shared/typography'
import { Skeleton } from '@/components/ui/skeleton'
import { useGoalsStore } from '@/stores/goalsStore'
import { cn } from '@/lib/utils'
import { BriefBox } from '../BriefBox'
import type { BriefBoxProps } from '../briefModules'

function HabitMark({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', done ? 'border-success bg-success text-background' : 'border-border')}>
      {done && <Check className="size-3" />}
    </span>
  )
}

const ROW = 'flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left'

/** "Before you start": habits as checkable rows. No counts and no mention
 *  of yesterday (base spec §3.2 #8). */
export function HabitsBox({ mode, payload }: BriefBoxProps) {
  const habits = useGoalsStore((s) => s.habits)
  const loading = useGoalsStore((s) => s.habitsLoading)
  const toggleHabit = useGoalsStore((s) => s.toggleHabit)
  useEffect(() => {
    if (mode !== 'snapshot') void useGoalsStore.getState().loadHabits()
  }, [mode])
  const rows =
    mode === 'snapshot'
      ? (Array.isArray(payload) ? (payload as BriefHabitRef[]) : []).map((h) => ({ id: h.id, name: h.name, done: h.done }))
      : habits.filter((h) => h.active).map((h) => ({ id: h.id, name: h.name, done: h.today_completed }))
  return (
    <BriefBox title="Before you start">
      {mode !== 'snapshot' && loading ? (
        <div className="space-y-1.5">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : rows.length === 0 ? (
        <Meta as="p">No habits set up. Add them in Goals.</Meta>
      ) : (
        <ul className="-mx-2" aria-label="Before you start">
          {rows.map((h) => (
            <li key={h.id}>
              {mode === 'live' ? (
                <button type="button" role="checkbox" aria-checked={h.done} onClick={() => void toggleHabit(h.id)} className={cn(ROW, 'focus-ring transition-colors duration-(--transition-fast) hover:bg-hover')}>
                  <HabitMark done={h.done} />
                  <span className="min-w-0 flex-1 truncate text-body">{h.name}</span>
                </button>
              ) : (
                <div className={ROW}>
                  <HabitMark done={h.done} />
                  <span className="min-w-0 flex-1 truncate text-body">{h.name}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </BriefBox>
  )
}
