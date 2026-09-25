import type { Priority } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { legacyPriorities, stripTitles } from '@/lib/briefItems'
import { cn } from '@/lib/utils'
import { PrioritiesBox } from '../PrioritiesBox'
import { useBriefItems } from '../briefContext'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps, BriefStripProps } from '../briefModules'

/** Top priorities (phase 3): composed `brief_items` rows from
 *  `BriefItemsContext`; days composed before phase 3 show their frozen
 *  free-text `priorities` payload. */
export function PrioritiesModule({ mode, config, payload }: BriefBoxProps) {
  const count = configValue(config, 'count', 3)
  const legacy = mode === 'snapshot' && Array.isArray(payload) ? (payload as Priority[]) : null
  return <PrioritiesBox priorities={legacy} count={count} />
}

/** Compact strip: the top `count` priority titles as numbered chips. */
export function PrioritiesStrip({ config }: BriefStripProps) {
  const c = useBriefItems()
  const top = (stripTitles(c?.items, legacyPriorities(c?.brief)) ?? []).slice(0, configValue(config, 'count', 3))
  if (top.length === 0) return null
  return (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', STRIP_DOT)}>
      {top.map((p, i) => (
        <span key={i} className="flex min-w-0 max-w-56 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-meta" title={p.title}>
          <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="truncate">{p.title}</span>
        </span>
      ))}
    </div>
  )
}
