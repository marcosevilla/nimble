import type { Priority } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { cn } from '@/lib/utils'
import { PrioritiesBox } from '../PrioritiesBox'
import { useBriefLive } from '../briefLive'
import { STRIP_DOT } from '../stripSegment'
import type { BriefBoxProps, BriefStripProps } from '../briefModules'

export function PrioritiesModule({ mode, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const count = configValue(config, 'count', 3)
  if (mode === 'snapshot') {
    return <PrioritiesBox priorities={Array.isArray(payload) ? (payload as Priority[]).slice(0, count) : null} />
  }
  if (!live) return null
  const p = live.priorities
  const list = p.list ? p.list.slice(0, count) : null
  if (mode === 'preview') return <PrioritiesBox priorities={list} loading={p.list === undefined || p.generating} />
  return (
    <PrioritiesBox
      priorities={list}
      loading={p.list === undefined || (p.list === null && !live.ready) || p.generating}
      error={p.error}
      noKey={p.noKey}
      onRegenerate={p.regenerate}
    />
  )
}

/** Compact strip: the top `count` priority titles as numbered chips. */
export function PrioritiesStrip({ config }: BriefStripProps) {
  const live = useBriefLive()
  const top = (live?.priorities.list ?? []).slice(0, configValue(config, 'count', 3))
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
