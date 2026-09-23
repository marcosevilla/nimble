// Bundled by tests/focusFlows.test.mjs (Vite SSR). Renders the Task 8 focus
// surfaces (tray states, banner, completion note, recovery, task history)
// with the real components and pure helpers.
import { renderToStaticMarkup } from 'react-dom/server'
import { FocusQueueTray } from '../../src/components/focus/FocusQueueTray'
import { FocusBannerView } from '../../src/components/focus/FocusBanner'
import { FocusCelebration } from '../../src/components/focus/FocusCelebration'
import { FocusRecoveryBody } from '../../src/components/focus/FocusResumeDialog'
import { FocusTaskHistoryView } from '../../src/components/focus/FocusTaskHistory'
import { recoveryNotice, taskFocusSummary } from '../../src/lib/focusFlows'
import type { FocusTaskOps } from '../../src/lib/focusQueueIntents'
import type { FocusRequestError } from '../../src/services/focus-events'
import type {
  FocusAction,
  FocusCapabilities,
  FocusConfig,
  FocusEntry,
  FocusHistoryRow,
  FocusSession,
  FocusSnapshot,
  LocalTask,
  Project,
} from '@nimble/types'

const TODAY = '2026-09-22'
const MIN = 60_000
const countUp: FocusConfig = { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }

const task = (over: Partial<LocalTask>): LocalTask => ({
  sync_policy: 'default', reminder_offset_minutes: null, google_calendar_enabled: false,
  id: 't', parent_id: null, content: 'Task', description: null, project_id: 'inbox', priority: 1,
  due_date: null, due_time: null, duration_minutes: null, recurrence_rule: null, section_id: null, labels: [],
  completed: false, completed_at: null, status: 'todo', linked_doc_id: null, position: 0,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', external_id: null,
  external_source: null, remote_updated_at: null, synced_snapshot: null, ...over,
})
const tasks = [
  task({ id: 't1', content: 'Example task', due_date: TODAY }),
  task({ id: 't2', content: 'Second task', due_date: TODAY }),
  task({ id: 't3', content: 'Third task', due_date: TODAY }),
]
const projects = [{ id: 'inbox', name: 'Inbox' }] as Project[]
const entry = (n: number): FocusEntry => ({
  id: `e${n}`, task_id: `t${n}`, occurrence_id: `o${n}`, added_at: '2026-09-22T08:00:00Z',
  source: { kind: 'today' }, explicit_still_open: false, config: countUp,
})
const snapshot = (over: Partial<FocusSnapshot> = {}): FocusSnapshot => ({
  queue_revision: 4, engine_revision: 9, owner_epoch: 'epoch', process_generation: 1, writer_device_id: 'mac',
  queue: [entry(1), entry(2), entry(3)], selected_occurrence_id: 'o1', session: null,
  totals: { o1: 12 * MIN }, as_of: '2026-09-22T17:00:00Z', checkpoint_at: null, recovery_reason: null,
  replica: false, ...over,
})
const caps = (over: Partial<FocusCapabilities> = {}): FocusCapabilities => ({
  queue_read: true, queue_write: true, history_read: true, live_timing: false, companion: false, import: false,
  reason: 'Live timing, the companion window and import are not connected yet.', ...over,
})
const never = () => Promise.reject(new Error('not in SSR'))
const taskOps: FocusTaskOps = {
  create: never, complete: never, rename: never, duplicate: never, remove: never,
  openDetail: () => {}, writeClipboard: undefined,
}
const noop = () => {}

function tray(opts: { live?: boolean; error?: FocusRequestError | null; pending?: FocusAction | null } = {}): string {
  return renderToStaticMarkup(
    <FocusQueueTray
      snapshot={snapshot()}
      capabilities={caps({ live_timing: opts.live ?? false })}
      tasks={tasks}
      projects={projects}
      sections={[]}
      completed={[]}
      today={TODAY}
      onAction={never}
      taskOps={taskOps}
      error={opts.error ?? null}
      pending={opts.pending ?? null}
    />,
  )
}

export const renderTrayWithError = (error: FocusRequestError) => tray({ error })
export const renderPendingTray = () => tray({ live: true, pending: { kind: 'complete', occurrence_id: 'o2' } })
export const renderQueueRows = (opts: { live: boolean }) => tray({ live: opts.live })

export function renderCelebration(): string {
  return renderToStaticMarkup(
    <FocusCelebration
      celebration={{ id: 1, title: 'Write chapter', totalMs: 12 * MIN, nextTitle: 'Second task', queueEmpty: false }}
      onDismiss={noop}
    />,
  )
}

export function renderBanner(): string {
  return renderToStaticMarkup(
    <FocusBannerView snapshot={snapshot()} capabilities={caps()} task={tasks[0]} busy={false} onAction={noop} onExpand={noop} />,
  )
}

export function renderRecovery(): string {
  const session: FocusSession = { id: 's', occurrence_id: 'o1', status: 'paused', phase: 'work', work_ms: 0, break_ms: 0,
    round_work_ms: 0, round: 1, config: countUp }
  const notice = recoveryNotice(
    snapshot({ recovery_reason: 'heartbeat gap', session, totals: { o1: 83 * MIN }, as_of: '2026-09-25T09:00:00Z' }),
    [task({ id: 't1', content: 'Write chapter' })],
  )
  if (!notice) throw new Error('expected a recovery notice')
  return renderToStaticMarkup(<FocusRecoveryBody notice={notice} onOpen={noop} onDismiss={noop} />)
}

export function renderTaskHistory(): string {
  const rows: FocusHistoryRow[] = [
    { occurrence_id: 'a', task_id: 't1', title: 'Write', total_ms: 30 * MIN, recorded_ms: 10 * MIN, imported_ms: 20 * MIN,
      completed_at: '2026-09-20T10:00:00Z', archived: false },
    { occurrence_id: 'b', task_id: 't1', title: 'Write', total_ms: 5 * MIN, recorded_ms: 5 * MIN, imported_ms: 0,
      completed_at: null, archived: true },
  ]
  return renderToStaticMarkup(<FocusTaskHistoryView summary={taskFocusSummary(rows)} />)
}
