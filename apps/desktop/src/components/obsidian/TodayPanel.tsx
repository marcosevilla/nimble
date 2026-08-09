import { useObsidian } from '@/hooks/useObsidian'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import type { CheckboxItem } from '@nimble/types'

function CheckboxRow({
  item,
  onToggle,
}: {
  item: CheckboxItem
  onToggle: (lineNumber: number) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1 group">
      <Checkbox
        checked={item.checked}
        onCheckedChange={() => onToggle(item.line_number)}
        className="mt-0.5"
      />
      <span
        className={cn(
          'text-body transition-colors',
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

export function TodayPanel() {
  const { todayData, error, loading, toggleCheckbox } = useObsidian()

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 py-1">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 flex-1 max-w-[200px]" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-body text-destructive">
        Could not read today.md: {error}
      </p>
    )
  }

  if (!todayData) {
    return <p className="text-body text-muted-foreground">No today.md found</p>
  }

  const { tasks } = todayData

  if (tasks.length === 0) {
    return <p className="text-body text-muted-foreground">Nothing in today.md yet — all clear.</p>
  }

  return (
    <div className="space-y-0.5">
      {tasks.map((item) => (
        <CheckboxRow
          key={item.line_number}
          item={item}
          onToggle={toggleCheckbox}
        />
      ))}
    </div>
  )
}
