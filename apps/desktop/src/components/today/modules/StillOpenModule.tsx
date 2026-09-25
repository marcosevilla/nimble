import type { BriefTaskRef } from '@nimble/types'
import { configValue } from '@/lib/briefLayout'
import { StillOpenBox } from '../StillOpenBox'
import { useBriefLive } from '../briefLive'
import type { BriefBoxProps } from '../briefModules'

export function StillOpenModule({ mode, date, config, payload }: BriefBoxProps) {
  const live = useBriefLive()
  const count = configValue(config, 'count', 5)
  if (mode === 'snapshot') {
    const p = (payload ?? {}) as { total?: number; oldest?: BriefTaskRef[] }
    return <StillOpenBox tasks={(p.oldest ?? []).slice(0, count)} total={p.total ?? 0} today={date} readOnly max={count} />
  }
  if (!live) return null
  return (
    <StillOpenBox
      tasks={live.stillOpen.slice(0, count)}
      total={live.stillOpen.length}
      today={live.today}
      loading={!live.tasksReady}
      readOnly={mode === 'preview'}
      max={count}
    />
  )
}
