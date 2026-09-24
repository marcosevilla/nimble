import type { Priority } from '@nimble/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/shared/IconButton'
import { Meta } from '@/components/shared/typography'
import { cn } from '@/lib/utils'
import { RefreshCw } from 'lucide-react'
import { BriefBox } from './BriefBox'

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

/** Top priorities, as rendered. Generation lives in `useDailyPriorities`
 *  (TodayPage), so it runs whether the brief is expanded or compact; this
 *  box only shows the result. Snapshots pass `priorities` alone, which reads
 *  the stored set with no regenerate control. */
export function PrioritiesBox({
  priorities,
  loading = false,
  error = null,
  noKey = false,
  onRegenerate,
}: {
  priorities: Priority[] | null
  loading?: boolean
  error?: string | null
  noKey?: boolean
  /** Live only. Always offered when idle, so a key added in Settings can be
   *  used the same day. */
  onRegenerate?: () => void
}) {
  return (
    <BriefBox
      title="Top priorities"
      action={
        onRegenerate && !loading && !error ? (
          <IconButton size="sm" onClick={onRegenerate} aria-label="Regenerate priorities" title="Regenerate">
            <RefreshCw className="size-3" />
          </IconButton>
        ) : undefined
      }
    >
      {loading ? (
        <PrioritiesSkeleton />
      ) : error && onRegenerate ? (
        <div className="space-y-2">
          <Meta as="p">{error}</Meta>
          <Button variant="outline" size="sm" onClick={onRegenerate}>
            Try again
          </Button>
        </div>
      ) : priorities && priorities.length > 0 ? (
        <div className="divide-y divide-border/50">
          {priorities.map((p, i) => (
            <PriorityCard key={i} priority={p} index={i} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <Meta as="p">Nothing pressing today. Pick something you want to do.</Meta>
          {noKey && <Meta as="p">Add an Anthropic key in Settings for AI priorities.</Meta>}
        </div>
      )}
    </BriefBox>
  )
}
