// Bundled by tests/focusCard.test.mjs and tests/focusQueue.test.mjs (Vite
// SSR, same pattern as googleSetupRender). Renders the real focus components
// with a paused task, an inline subtask and a small queue.
import { renderToStaticMarkup } from 'react-dom/server'
import { FocusTaskCard } from '../../src/components/focus/FocusTaskCard'
import { FocusQueueTray } from '../../src/components/focus/FocusQueueTray'
import { FocusLoadState } from '../../src/components/focus/FocusLoadState'
import { FocusAddPanel } from '../../src/components/focus/FocusAddPopover'
import { FocusRequestError } from '../../src/services/focus-events'
import { queueBlockedReason, type FocusTaskOps } from '../../src/lib/focusQueueIntents'
import { focusAddState } from '../../src/lib/focusSources'
import type {
  FocusSource,
  FocusCapabilities,
  FocusConfig,
  FocusEntry,
  FocusHistoryRow,
  FocusSession,
  FocusSnapshot,
  LocalTask,
  Project,
  Section,
} from '@nimble/types'

const TODAY = '2026-09-22'
const MIN = 60_000

const countUp: FocusConfig = { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }
const timebox25: FocusConfig = { ...countUp, mode: 'timebox', budget_ms: 25 * MIN }

const task = (over: Partial<LocalTask>): LocalTask => ({
  sync_policy: 'default', reminder_offset_minutes: null, google_calendar_enabled: false,
  id: 't', parent_id: null, content: 'Task', description: null, project_id: 'inbox', priority: 1,
  due_date: null, due_time: null, duration_minutes: null, recurrence_rule: null, section_id: null, labels: [],
  completed: false, completed_at: null, status: 'todo', linked_doc_id: null, position: 0,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', external_id: null,
  external_source: null, remote_updated_at: null, synced_snapshot: null, ...over,
})

const tasks: LocalTask[] = [
  task({ id: 't1', content: 'Example task', project_id: 'p1', section_id: 'sec1', priority: 3, due_date: TODAY, due_time: '14:00', position: 2,
    description: 'Draft the outline <b>first</b>, then\nlink [notes](https://example.com).' }),
  task({ id: 's1', parent_id: 't1', content: 'Outline sections', project_id: 'p1' }),
  task({ id: 't2', content: 'Second task', project_id: 'p1', due_date: TODAY, position: 1 }),
  task({ id: 't3', content: 'Third task', project_id: 'p1', due_date: TODAY, position: 0 }),
  task({ id: 't4', content: 'Fresh candidate', due_date: TODAY }),
  task({ id: 't5', content: 'Earlier thing', due_date: '2026-09-20' }),
]
const projects = [{ id: 'inbox', name: 'Inbox' }, { id: 'p1', name: 'Deep work' }] as Project[]
const sections = [{ id: 'sec1', project_id: 'p1', name: 'Writing', position: 0, external_id: null, external_source: null }] as Section[]

const entry = (n: number, config: FocusConfig = countUp): FocusEntry => ({
  id: `e${n}`, task_id: `t${n}`, occurrence_id: `o${n}`, added_at: '2026-09-22T08:00:00Z',
  source: { kind: 'today' }, explicit_still_open: false, config,
})

function snapshot(opts: { config?: FocusConfig; totalMs?: number; session?: Partial<FocusSession> | null; empty?: boolean } = {}): FocusSnapshot {
  const config = opts.config ?? timebox25
  // Default: selected and paused, never started (as after promote) → "Start".
  const session: FocusSession | null = opts.session == null ? null : {
    id: 'sess', occurrence_id: 'o1', status: 'paused', phase: 'work', work_ms: 0, break_ms: 0,
    round_work_ms: 0, round: 1, config, ...opts.session,
  }
  return {
    queue_revision: 4, engine_revision: 9, owner_epoch: 'epoch', process_generation: 1, writer_device_id: 'mac',
    queue: opts.empty ? [] : [entry(1, config), entry(2), entry(3)],
    selected_occurrence_id: opts.empty ? null : 'o1', session: opts.empty ? null : session,
    // 12:26 worked against a 25m timebox → 12:34 remaining on the card.
    totals: { o1: opts.totalMs ?? 746_000 },
    as_of: '2026-09-22T17:00:00Z', checkpoint_at: null, recovery_reason: null, replica: false,
  }
}

const caps = (over: Partial<FocusCapabilities> = {}): FocusCapabilities => ({
  queue_read: true, queue_write: true, history_read: true, live_timing: true, companion: false, import: false,
  reason: null, ...over,
})

const completed: FocusHistoryRow[] = [{
  occurrence_id: 'o9', task_id: 't9', title: 'Shipped notes', total_ms: 12 * MIN, recorded_ms: 12 * MIN,
  imported_ms: 0, completed_at: '2026-09-22T16:00:00Z', archived: false,
}]

const never = () => Promise.reject(new Error('not in SSR'))
const taskOps: FocusTaskOps = {
  create: never, complete: never, rename: never, duplicate: never, remove: never,
  openDetail: () => {}, writeClipboard: undefined,
}
const noop = () => {}

export function renderFocusCard(opts: { missingTask?: boolean; live?: boolean; running?: boolean; resumable?: boolean; overtimeMs?: number; countUpMs?: number; plain?: boolean; timerSize?: 'sm' | 'display' } = {}): string {
  const snap = opts.countUpMs != null
    ? snapshot({ config: countUp, totalMs: opts.countUpMs })
    : snapshot({ totalMs: opts.overtimeMs != null ? 25 * MIN + opts.overtimeMs : undefined,
      session: opts.running ? { status: 'running' } : opts.resumable ? {} : null })
  return renderToStaticMarkup(
    <FocusTaskCard
      snapshot={snap}
      capabilities={caps({ live_timing: opts.live ?? true })}
      entry={snap.queue[0]}
      task={opts.missingTask ? null : opts.plain ? { ...tasks[0], description: null } : tasks[0]}
      subtasks={opts.missingTask ? [] : [tasks[1]]}
      placeLabel={opts.plain ? undefined : 'Deep work / Writing'}
      today={TODAY}
      onAction={never}
      onCompleteSubtask={noop}
      onMenu={noop}
      timerSize={opts.timerSize}
    />,
  )
}

function tray(opts: { compact?: boolean; empty?: boolean; source?: 'project'; readOnly?: boolean; live?: boolean; error?: FocusRequestError; untitled?: boolean } = {}): string {
  return renderToStaticMarkup(
    <FocusQueueTray
      title={opts.untitled ? undefined : <h2>Focus</h2>}
      headerActions={opts.untitled ? undefined : <button type="button" aria-label="Expand" />}
      snapshot={snapshot({ empty: opts.empty })}
      capabilities={opts.readOnly ? caps({ queue_write: false, live_timing: false, reason: 'Replica is read-only' }) : caps({ live_timing: opts.live ?? true })}
      tasks={tasks}
      projects={projects}
      sections={sections}
      completed={completed}
      today={TODAY}
      onAction={never}
      taskOps={taskOps}
      initialSource={opts.source === 'project' ? { kind: 'project', project_id: 'p1' } : { kind: 'today' }}
      initialCompact={opts.compact}
      error={opts.error}
    />,
  )
}

/** The companion's card-only mode: no title (the native titlebar names it). */
export function renderCompactFocus(): string {
  return tray({ compact: true, live: false, untitled: true })
}

/** The `+` popover body, fed by the same `focusAddState` the tray uses. */
export function renderAddPanel(opts: { source?: 'project' | 'local'; readOnly?: boolean; stillOpenExpanded?: boolean } = {}): string {
  const source: FocusSource = opts.source === 'project' ? { kind: 'project', project_id: 'p1' } : opts.source === 'local' ? { kind: 'local' } : { kind: 'today' }
  const state = focusAddState(tasks, source, TODAY, snapshot(), sections)
  const blocked = queueBlockedReason(opts.readOnly ? caps({ queue_write: false, reason: 'Replica is read-only' }) : caps())
  return renderToStaticMarkup(
    <FocusAddPanel
      source={source}
      projects={projects}
      onSourceChange={noop}
      newCount={state.newCount}
      sourceCount={state.sourceCount}
      onQueueThese={noop}
      stillOpen={state.stillOpen}
      today={TODAY}
      onAddStillOpen={noop}
      blockedReason={blocked}
      onQuickAdd={never}
      draft=""
      onDraftChange={noop}
      initialStillOpenExpanded={opts.stillOpenExpanded}
    />,
  )
}

export function renderQueueTray(opts: { compact?: boolean; empty?: boolean; source?: 'project'; readOnly?: boolean; error?: 'storage' | 'conflict' } = {}): string {
  const error = opts.error === 'storage'
    ? new FocusRequestError('storage', 'Disk was busy', { command_id: 'c-1' })
    : opts.error === 'conflict'
      ? new FocusRequestError('conflict', 'Queue changed elsewhere', { command_id: 'c-2' })
      : undefined
  return tray({ ...opts, error })
}

export function renderFocusLoading(): string {
  return renderToStaticMarkup(<FocusLoadState error={null} onRetry={() => {}} />)
}

export function renderFocusLoadError(): string {
  return renderToStaticMarkup(<FocusLoadState error={new FocusRequestError('storage', 'focus storage unavailable')} onRetry={() => {}} />)
}
