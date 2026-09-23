import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged, useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { useDataVersion } from '@/hooks/useDataVersion'
import { useDetailStore } from '@/stores/detailStore'
import { useFocusSurface } from '@/stores/focusSurfaceStore'
import { sendFocusAction, useFocusCache } from '@/stores/focusStore'
import { completedTrayRows, completionAcknowledgement } from '@/lib/focusFlows'
import { playCompletionSound } from '@/lib/sound'
import { focusTaskOps, type FocusTaskOps } from '@/lib/focusQueueIntents'
import type { FocusAction, FocusHistoryRow, FocusReply, LocalTask, Project, Section } from '@nimble/types'

/** Actions whose commit also changes native task rows (status, completion, restore). */
const TOUCHES_TASKS: ReadonlySet<FocusAction['kind']> = new Set(['start', 'complete', 'undo_delete'])
/** Actions whose commit changes the completed tray. */
const TOUCHES_HISTORY: ReadonlySet<FocusAction['kind']> = new Set(['complete', 'archive_history', 'undo_delete'])

const MUTE_KEY = 'focus_sound_muted'

export interface FocusTrayData {
  tasks: LocalTask[]
  projects: Project[]
  sections: Section[]
  completed: FocusHistoryRow[]
  today: string
  taskOps: FocusTaskOps
  onAction: (action: FocusAction) => Promise<FocusReply>
  soundMuted: boolean
  setSoundMuted: (muted: boolean) => void
}

/**
 * Wires the focus tray to native data: tasks/projects/sections for the card
 * and candidates, today's completed tray from `focus.history` (snapshot
 * totals, never activity logs), native task writes, and one `onAction` that
 * routes every focus write through the engine envelope.
 */
export function useFocusTrayData(): FocusTrayData {
  const dp = useDataProvider()
  const { tasks } = useLocalTasks()
  const { projects } = useProjects()
  const sectionVersion = useDataVersion('sections')
  const [sections, setSections] = useState<Section[]>([])
  const [history, setHistory] = useState<FocusHistoryRow[]>([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const [soundMuted, setMuted] = useState(false)
  const queueRevision = useFocusCache((s) => s.snapshot?.queue_revision ?? -1)
  const today = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    let live = true
    Promise.all(projects.map((p) => dp.sections.list(p.id).catch(() => [] as Section[])))
      .then((lists) => { if (live) setSections(lists.flat()) })
    return () => { live = false }
  }, [dp, projects, sectionVersion])

  useEffect(() => {
    let live = true
    dp.focus.history().then((page) => { if (live) setHistory(page.rows) }, () => {})
    return () => { live = false }
  }, [dp, queueRevision, historyVersion])

  useEffect(() => {
    dp.settings.get(MUTE_KEY).then((v) => setMuted(v === 'true'), () => {})
  }, [dp])
  const setSoundMuted = useCallback((muted: boolean) => {
    setMuted(muted)
    dp.settings.set(MUTE_KEY, String(muted)).catch(() => {})
  }, [dp])

  // Latest values for the stable onAction below.
  const latest = useRef({ tasks, soundMuted })
  useEffect(() => {
    latest.current = { tasks, soundMuted }
  }, [tasks, soundMuted])

  const onAction = useCallback(async (action: FocusAction) => {
    const before = useFocusCache.getState().snapshot
    const reply = await sendFocusAction(action)
    if (action.kind === 'complete' && before) {
      // Only after the commit: sound, then the acknowledgement (never a start).
      if (!latest.current.soundMuted) playCompletionSound()
      const titleOf = (id: string) => latest.current.tasks.find((t) => t.id === id)?.content
      useFocusSurface.getState().celebrate(completionAcknowledgement(before, reply.snapshot, action.occurrence_id, titleOf))
    }
    if (TOUCHES_TASKS.has(action.kind)) emitTasksChanged()
    if (TOUCHES_HISTORY.has(action.kind)) setHistoryVersion((v) => v + 1)
    return reply
  }, [])

  const taskOps = useMemo(() => focusTaskOps(dp, {
    onChanged: emitTasksChanged,
    openDetail: (task) => {
      useFocusSurface.getState().setExpanded(false)
      useDetailStore.getState().openTask(task.id)
    },
    writeClipboard: typeof navigator !== 'undefined' && navigator.clipboard
      ? (text) => navigator.clipboard.writeText(text)
      : undefined,
  }), [dp])

  const completed = useMemo(() => completedTrayRows(history, today), [history, today])

  return { tasks, projects, sections, completed, today, taskOps, onAction, soundMuted, setSoundMuted }
}
