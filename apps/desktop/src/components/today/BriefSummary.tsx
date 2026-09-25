import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { summaryLine } from '@/lib/briefItems'
import { useBriefItems } from './briefContext'

/** The brief's header sentence (gentle register), the fallback notice when
 *  the AI was unavailable, a line-shaped skeleton while today composes, or
 *  nothing at all (the sentence is optional; the date and chip stay). */
export function BriefSummary() {
  const c = useBriefItems()
  if (!c) return null
  if (c.view === 'pending') return <Skeleton aria-hidden className="h-5 w-2/3" />
  const line = summaryLine(c.brief)
  if (!line) return null
  return <p className={cn('text-body', c.view === 'fallback' ? 'text-muted-foreground' : 'text-foreground')}>{line}</p>
}
