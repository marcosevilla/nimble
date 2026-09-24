import { MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/shared/IconButton'
import { Meta } from '@/components/shared/typography'
import type { PanelMenuItem } from '@/lib/focusQueueIntents'

/**
 * The focus surface's own ⋯ (not a task's): Pop out and other surface
 * extras, Show/Hide queue, Mute sounds, and the replica's sync note.
 * Items come from `focusPanelMenuItems` so the list is testable.
 */
export function FocusPanelMenu({
  items,
  onToggleQueue,
  onMutedChange,
}: {
  items: PanelMenuItem[]
  onToggleQueue: () => void
  onMutedChange?: (muted: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton size="lg" aria-label="Focus options" title="Focus options" className="focus-ring data-popup-open:bg-hover data-popup-open:text-foreground" />}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {items.map((item, index) => {
          const previous = items[index - 1]
          // Surface extras, then the view toggles, then the read-only note.
          const separate = previous != null && (previous.kind === 'extra') !== (item.kind === 'extra')
          const noteSeparator = item.kind === 'sync_note'
          return (
            <div key={item.key}>
              {(separate || noteSeparator) && <DropdownMenuSeparator />}
              {item.kind === 'mute' ? (
                <DropdownMenuCheckboxItem checked={item.checked === true} onCheckedChange={(checked) => onMutedChange?.(checked)}>
                  {item.label}
                </DropdownMenuCheckboxItem>
              ) : item.kind === 'sync_note' ? (
                <Meta as="p" role="note" className="px-1.5 py-1">
                  {item.label}
                </Meta>
              ) : (
                <DropdownMenuItem
                  disabled={item.disabled}
                  onClick={item.kind === 'toggle_queue' ? onToggleQueue : item.onSelect}
                >
                  {item.detail ? (
                    <span className="flex min-w-0 flex-col">
                      <span>{item.label}</span>
                      <Meta className="whitespace-normal">{item.detail}</Meta>
                    </span>
                  ) : (
                    item.label
                  )}
                </DropdownMenuItem>
              )}
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
