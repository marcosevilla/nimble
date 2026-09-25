import { MoreHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/shared/IconButton'
import { openSettings } from '@/stores/settingsNavStore'

/** The brief's ⋯ (addendum A1): Customize… opens Settings → Today & brief.
 *  Phase 3 appends Regenerate. */
export function BriefMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton aria-label="Brief options" title="Brief options" className="focus-ring data-popup-open:bg-hover data-popup-open:text-foreground" />}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => openSettings('today-brief')}>Customize…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
