import type { BriefLayoutEntry } from '@nimble/types'
import { ChevronDown } from 'lucide-react'
import { IconButton } from '@/components/shared/IconButton'
import { ModuleStrip } from './ModuleBox'

/** The compact brief: one row of module segments (weather chip, next
 *  event, priority chips), so the tasks below stay in view. */
export function BriefStrip({ entries, onExpand }: { entries: BriefLayoutEntry[]; onExpand: () => void }) {
  return (
    <div data-brief-strip className="surface-panel flex min-w-0 items-center gap-3 px-4 py-2">
      {entries.map((e) => (
        <ModuleStrip key={e.id} id={e.id} config={e.config} />
      ))}
      <IconButton aria-label="Expand the brief" onClick={onExpand} className="ml-auto">
        <ChevronDown className="size-3.5" />
      </IconButton>
    </div>
  )
}
