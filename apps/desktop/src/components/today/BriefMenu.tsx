import { MoreHorizontal, RefreshCw } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/shared/IconButton'
import { openSettings } from '@/stores/settingsNavStore'

/** The brief's ⋯ (addendum A1): Regenerate brief (today, desktop) and
 *  Customize…, which opens Settings → Today & brief. After a Regenerate the
 *  item rests for a minute and says so ("Just regenerated"). */
export function BriefMenu({
  onRegenerate,
  regenerating = false,
  justRegenerated = false,
}: {
  /** Today on the desktop only; omitted elsewhere (past dates, the web). */
  onRegenerate?: () => void
  regenerating?: boolean
  justRegenerated?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton aria-label="Brief options" title="Brief options" className="focus-ring data-popup-open:bg-hover data-popup-open:text-foreground" />}
      >
        <MoreHorizontal className="size-3.5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {onRegenerate && (
          <DropdownMenuItem
            disabled={regenerating || justRegenerated}
            onClick={onRegenerate}
            title={justRegenerated ? 'Just regenerated' : undefined}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {regenerating ? 'Regenerating…' : 'Regenerate brief'}
            {justRegenerated && <span className="ml-auto text-label text-muted-foreground">Just regenerated</span>}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => openSettings('today-brief')}>Customize…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
