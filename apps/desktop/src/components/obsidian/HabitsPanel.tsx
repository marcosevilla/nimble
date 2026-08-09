import { useObsidian } from '@/hooks/useObsidian'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Label, Meta } from '@/components/shared/typography'
import type { CheckboxItem } from '@nimble/types'

function HabitRow({
  item,
  onToggle,
}: {
  item: CheckboxItem
  onToggle: (lineNumber: number) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-0.5 group">
      <Checkbox
        checked={item.checked}
        onCheckedChange={() => onToggle(item.line_number)}
        className="mt-0.5"
      />
      <span
        className={cn(
          'text-meta transition-colors',
          item.checked
            ? 'text-muted-foreground line-through'
            : 'text-foreground group-hover:text-foreground',
        )}
      >
        {item.text}
      </span>
    </label>
  )
}

export function HabitsPanel() {
  const { todayData, error, loading, toggleCheckbox } = useObsidian()

  if (loading) {
    return (
      <div className="space-y-1">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <Skeleton className="size-3.5 rounded" />
            <Skeleton className="h-3 flex-1 max-w-[140px]" />
          </div>
        ))}
      </div>
    )
  }

  if (error || !todayData) {
    return <Meta as="p">{error ? `Error: ${error}` : 'No habits today'}</Meta>
  }

  const { habits_core, habits_bonus } = todayData
  const coreChecked = habits_core.filter((h) => h.checked).length
  const bonusChecked = habits_bonus.filter((h) => h.checked).length

  if (habits_core.length === 0 && habits_bonus.length === 0) {
    return <Meta as="p">No habits defined yet.</Meta>
  }

  return (
    <div className="space-y-3">
      {habits_core.length > 0 && (
        <div>
          <Label as="p" className="mb-1.5">
            Core
            <span className="ml-1 font-normal normal-case tracking-normal">
              {coreChecked}/{habits_core.length}
            </span>
          </Label>
          <div className="space-y-0">
            {habits_core.map((item) => (
              <HabitRow
                key={item.line_number}
                item={item}
                onToggle={toggleCheckbox}
              />
            ))}
          </div>
        </div>
      )}

      {habits_bonus.length > 0 && (
        <div>
          <Label as="p" className="mb-1.5">
            Bonus
            <span className="ml-1 font-normal normal-case tracking-normal">
              {bonusChecked}/{habits_bonus.length}
            </span>
          </Label>
          <div className="space-y-0">
            {habits_bonus.map((item) => (
              <HabitRow
                key={item.line_number}
                item={item}
                onToggle={toggleCheckbox}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
