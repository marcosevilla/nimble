// Bundled by tests/focusTaskEntry.test.mjs (Vite SSR). Renders the real task
// row (with its focus actions), the task detail Focus control and the bulk
// action bar against a seeded focus cache.
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskItem } from '../../src/components/tasks/TaskItem'
import { TaskRowActions, TaskFocusControlsView } from '../../src/components/focus/FocusTaskEntry'
import { BulkActionBar } from '../../src/components/shared/BulkActionBar'
import { DataProviderRoot } from '../../src/services/provider-context'
import { focusTaskControls, queuedEntryFor } from '../../src/lib/focusTaskEntry'
import { useFocusCache } from '../../src/stores/focusStore'
import { useSelectionStore } from '../../src/stores/selectionStore'
import type { DataProvider } from '../../src/services/data-provider'
import type { FocusCapabilities, FocusConfig, FocusSnapshot } from '@nimble/types'

const MIN = 60_000
const config: FocusConfig = { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }

type Queued = false | 'upcoming' | 'selected'

/** 'selected' puts the row task first (selected); 'upcoming' queues it behind another task. */
function snapshot(queued: Queued): FocusSnapshot {
  const entry = (task_id: string, occurrence_id: string) => ({ id: `e-${occurrence_id}`, task_id, occurrence_id,
    added_at: '2026-09-22T08:00:00Z', source: { kind: 'today' as const }, explicit_still_open: false, config })
  const queue = queued === 'selected' ? [entry('row', 'o1')]
    : queued === 'upcoming' ? [entry('other', 'o0'), entry('row', 'o1')] : []
  return {
    queue_revision: 1, engine_revision: 1, owner_epoch: 'epoch', process_generation: 1, writer_device_id: 'mac',
    queue, selected_occurrence_id: queue[0]?.occurrence_id ?? null, session: null, totals: {},
    as_of: '2026-09-22T17:00:00Z', checkpoint_at: null, recovery_reason: null, replica: false,
  }
}

const caps = (readOnly = false): FocusCapabilities => ({
  queue_read: true, queue_write: !readOnly, history_read: true, live_timing: !readOnly, companion: !readOnly,
  import: false, reason: readOnly ? 'Focus runs on the desktop app.' : null,
})

const rowTask = (completed = false) => ({ id: 'row', content: 'Row task', sync_policy: 'default' as const, due_date: null,
  project_id: 'inbox', completed, status: completed ? 'complete' as const : 'todo' as const })
const noop = () => {}

/* Zustand's server snapshot is the store's INITIAL state (SSR never sees
   setState), so seed both for a rendered read of the store. Test-only. */
function seed<T extends object>(store: { setState: (p: Partial<T>) => void; getInitialState: () => T }, state: Partial<T>) {
  store.setState(state)
  Object.assign(store.getInitialState(), state)
}

const withProvider = (node: React.ReactNode) => (
  <DataProviderRoot provider={{} as DataProvider}>{node}</DataProviderRoot>
)

export function renderRow(opts: { queued: Queued; readOnly?: boolean; pending?: boolean; completed?: boolean }): string {
  seed(useFocusCache, { snapshot: snapshot(opts.queued), capabilities: caps(opts.readOnly),
    pending: opts.pending ? { kind: 'pause' } : null, error: null })
  return renderToStaticMarkup(withProvider(
    <TaskItem
      task={{ id: 'row', content: 'Row task', priority: 1, completed: false, status: 'todo', source: 'local' }}
      onOpen={noop}
      actions={<TaskRowActions task={rowTask(opts.completed)} focusShortcut />}
    />,
  ))
}

export function renderDetail(opts: { queued: Queued; focusNowBlocked?: string; completed?: boolean }): string {
  const controls = focusTaskControls({
    entry: queuedEntryFor(snapshot(opts.queued), 'row'), capabilities: caps(), pending: false,
    focusNowBlocked: opts.focusNowBlocked ?? null, completed: opts.completed ?? false,
  })
  return renderToStaticMarkup(<TaskFocusControlsView controls={controls} onToggle={noop} onFocusNow={noop} />)
}

export function renderBulkBar(): string {
  seed(useSelectionStore, { selectedIds: new Set(['row']), selectionType: 'task', hasSelection: true, count: 1 })
  seed(useFocusCache, { snapshot: snapshot(false), capabilities: caps(), pending: null, error: null })
  return renderToStaticMarkup(withProvider(<BulkActionBar />))
}
