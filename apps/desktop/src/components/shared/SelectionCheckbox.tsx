import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSelectionStore } from '@/stores/selectionStore'

interface SelectionCheckboxProps {
  id: string
  type: 'task' | 'capture'
  allIds?: string[]
  /**
   * When true, the checkbox is rendered but transparent at rest — only
   * showing on group-hover or when the row is selected. Consumers using
   * absolute positioning can pass `false` and manage visibility at the
   * wrapper level instead.
   */
  autoHide?: boolean
}

export function SelectionCheckbox({ id, type, allIds, autoHide = true }: SelectionCheckboxProps) {
  const isSelected = useSelectionStore((s) => s.selectedIds.has(id))
  const hasSelection = useSelectionStore((s) => s.hasSelection)

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useSelectionStore.getState()
    if (e.shiftKey && allIds) {
      store.rangeSelect(id, type, allIds)
    } else {
      store.toggle(id, type)
    }
  }

  // Hidden at rest (autoHide, nothing selected): revealed on row hover OR
  // when anything in the row has keyboard focus, and taken out of the tab
  // order so Tab never lands on an invisible control (tasks audit P1-2,
  // inbox P1-2). The 16px box gets a 24px hit area via ::after (P3-3):
  // 5px past the 1px border each side. 24, not 32, so it abuts the row
  // grip's and status icon's targets instead of overlapping them
  // (Agentation pass 3, option A).
  const hidden = autoHide && !hasSelection && !isSelected

  return (
    <button
      type="button"
      onClick={handleClick}
      tabIndex={hidden ? -1 : 0}
      aria-label={isSelected ? 'Deselect' : 'Select'}
      aria-pressed={isSelected}
      className={cn(
        'relative flex size-4 shrink-0 items-center justify-center rounded border transition-[opacity,color,background-color,border-color]',
        'after:absolute after:-inset-[5px] after:content-[""]',
        isSelected
          ? 'border-accent-blue bg-accent-blue text-white'
          : 'border-muted-foreground/30 hover:border-muted-foreground/50',
        autoHide &&
          (hidden
            ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            : 'opacity-100'),
      )}
    >
      {isSelected && <Check className="size-3" />}
    </button>
  )
}
