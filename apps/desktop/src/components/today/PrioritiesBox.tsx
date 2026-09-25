import type { Priority } from '@nimble/types'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Meta } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import { itemsOf, MAX_PER_BOX } from '@/lib/briefItems'
import { BriefBox } from './BriefBox'
import { BriefTaskRow } from './BriefTaskRow'
import { useBriefItems } from './briefContext'

/* Source is a licensed semantic hue (§1.4) but only on the 6px dot — the
   pill itself is the neutral LabelChipPill recipe (today P1-6). */
const SOURCE_DOT: Record<string, string | null> = {
  Calendar: 'bg-accent-blue',
  Todoist: 'bg-destructive',
  Obsidian: 'bg-ai',
  General: null,
}

function PriorityCard({ priority, index }: { priority: Priority; index: number }) {
  const sourceDot = SOURCE_DOT[priority.source] ?? SOURCE_DOT.General

  return (
    <div className="flex gap-3 py-2.5">
      {/* font-semibold kept for legibility on muted bg circle badge */}
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-meta font-semibold text-muted-foreground">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-body-strong">{priority.title}</p>
          {/* Badge base cva bakes in text-meta; !text-label wins via the
              important flag so the source pill renders at 11/500 as spec'd. */}
          <Badge variant="secondary" className="!text-label gap-1 px-1.5 py-0 text-muted-foreground">
            {sourceDot && <span className={cn('size-1.5 rounded-full', sourceDot)} />}
            {priority.source}
          </Badge>
        </div>
        {/* leading-relaxed: deliberate prose override — AI reasoning reads as prose.
            Plain <p> so we control size directly (the <Meta> primitive pins text-meta). */}
        <p className="text-body text-muted-foreground leading-relaxed">{priority.reasoning}</p>
      </div>
    </div>
  )
}

/** Priority rows while loading or generating — the same shape as the cards. */
export function PrioritiesSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex gap-3 py-2">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Top priorities. Composed days (phase 3) show `brief_items` rows with a
 *  status control and a one-line reason; days composed before phase 3 show
 *  their frozen free-text `priorities`. Skeletons only while today composes. */
export function PrioritiesBox({ priorities = null, count = MAX_PER_BOX }: { priorities?: Priority[] | null; count?: number }) {
  const c = useBriefItems()
  const rows = itemsOf(c?.items, 'priority', count)
  const pending = !!c && rows.length === 0 && (c.view === 'pending' || c.items === undefined)
  return (
    <BriefBox title="Top priorities">
      {rows.length > 0 ? (
        <div className="divide-y divide-border/50">
          {rows.map((item) => (
            <BriefTaskRow key={item.id} item={item} readOnly={c?.readOnly ?? true} />
          ))}
        </div>
      ) : pending ? (
        <PrioritiesSkeleton />
      ) : priorities && priorities.length > 0 ? (
        <div className="divide-y divide-border/50">
          {priorities.slice(0, count).map((p, i) => (
            <PriorityCard key={i} priority={p} index={i} />
          ))}
        </div>
      ) : (
        <Meta as="p">Nothing pressing today. Pick something you want to do.</Meta>
      )}
    </BriefBox>
  )
}
