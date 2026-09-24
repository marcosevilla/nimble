import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalendarEvent, LocalTask, Priority, Project } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { useAppStore } from '@/stores/appStore'
import { buildCalendarSummary, outcomeFor, shouldAutoGenerate, type PrioritiesOutcome } from '@/lib/todayBrief'

function buildTasksSummary(
  tasks: { content: string; project_id: string; priority: number; completed: boolean }[],
  projectNames: Record<string, string>,
): string {
  const open = tasks.filter((t) => !t.completed)
  if (open.length === 0) return 'No tasks due today.'
  return open
    .map((t) => {
      const pri = t.priority >= 3 ? ' [HIGH]' : ''
      const proj = projectNames[t.project_id] ? ` (${projectNames[t.project_id]})` : ''
      return `- ${t.content}${proj}${pri}`
    })
    .join('\n')
}

function buildObsidianSummary(obsidianToday: string | null): string {
  return obsidianToday || 'No Obsidian tasks today.'
}

const AI_UNREACHABLE = 'Couldn’t reach the AI just now.'

// The day's auto-generation outcome, kept across mounts: navigating away
// and back must not re-call for a keyless or failed day, and must show the
// same calm line or "Try again" it showed before. A new date starts fresh
// (Review Focus 3). Written synchronously in `generate`, so an effect that
// runs twice before re-rendering (StrictMode) still calls once.
let memo: PrioritiesOutcome | null = null

export interface DailyPriorities {
  /** `undefined` while the day's cached set is being read. */
  priorities: Priority[] | null | undefined
  generating: boolean
  noKey: boolean
  error: string | null
  regenerate: () => void
}

/**
 * Today's priorities: the cached set, plus at most one automatic generation
 * per date once `ready` (the day's calendar and tasks have loaded). It runs
 * in TodayPage, not in a box, so the compact strip gets priorities too.
 * Generation uses exactly the `events` and `tasks` the page shows; a
 * calendar that is offline with nothing cached is described as unavailable,
 * never as a free day.
 */
export function useDailyPriorities({
  today,
  ready,
  events,
  calendarUnavailable,
  tasks,
  projects,
}: {
  today: string
  ready: boolean
  events: CalendarEvent[]
  calendarUnavailable: boolean
  tasks: LocalTask[]
  projects: Project[]
}): DailyPriorities {
  const dp = useDataProvider()
  const obsidianToday = useAppStore((s) => s.obsidianToday)
  const projectNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of projects) map[p.id] = p.name
    return map
  }, [projects])

  const [cached, setCached] = useState<{ date: string; priorities: Priority[] | null } | null>(null)
  useEffect(() => {
    let live = true
    dp.dailyState.get().then((s) => { if (live) setCached({ date: today, priorities: s.priorities }) })
      .catch(() => { if (live) setCached({ date: today, priorities: null }) })
    return () => { live = false }
  }, [dp, today]) // decision 6: re-read on a new day
  const priorities = cached?.date === today ? cached.priorities : undefined

  // This mount's view of the outcome; before any call it is the kept one.
  const [status, setStatus] = useState<{ date: string; generating: boolean; noKey: boolean; error: string | null } | null>(null)
  const shown = status?.date === today ? status : { date: today, generating: false, ...outcomeFor(memo, today) }

  const generate = useCallback(async () => {
    const date = today
    memo = { date, noKey: false, error: null }
    setStatus({ date, generating: true, noKey: false, error: null })
    try {
      const result = await dp.dailyState.generatePriorities(
        buildCalendarSummary(events, { unavailable: calendarUnavailable }),
        buildTasksSummary(tasks, projectNames),
        buildObsidianSummary(obsidianToday),
      )
      // Never let a late result for yesterday overwrite the new day's read.
      setCached((prev) => (prev === null || prev.date === date ? { date, priorities: result } : prev))
      setStatus({ date, generating: false, noKey: false, error: null })
    } catch (e) {
      const noKey = String(e).includes('not configured')
      memo = { date, noKey, error: noKey ? null : AI_UNREACHABLE }
      setStatus({ date, noKey, error: memo.error, generating: false })
    }
  }, [dp, today, events, calendarUnavailable, tasks, projectNames, obsidianToday])

  // The day's one automatic attempt. The claim on `memo` is synchronous, so
  // a second run of this effect before any re-render (StrictMode) sees it;
  // the call itself starts outside the effect body, which only kicks it off.
  useEffect(() => {
    if (!ready || priorities === undefined) return
    if (!shouldAutoGenerate({ cached: priorities !== null, tried: outcomeFor(memo, today).tried, noKey: false })) return
    memo = { date: today, noKey: false, error: null }
    void Promise.resolve().then(generate)
  }, [ready, priorities, today, generate])

  const regenerate = useCallback(() => { void generate() }, [generate])

  return { priorities, generating: shown.generating, noKey: shown.noKey, error: shown.error, regenerate }
}
