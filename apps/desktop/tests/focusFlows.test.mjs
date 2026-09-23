// Focus entry points routed through the durable engine (Task 8).
// Pure intents load directly; the store orchestration and the rendered
// surfaces come from Vite SSR bundles so the store and the provider accessor
// share one module instance, like the running app.
import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { completionNextAction } from '../src/lib/focusModel.ts'
import {
  completionSummary,
  completedTrayRows,
  isStaleRefusal,
  enqueueSelectionAction,
  focusNowPlan,
  recoveryNotice,
  sourceForTask,
  spaceKeyAction,
  taskFocusSummary,
} from '../src/lib/focusFlows.ts'

// ── Celebration / completion intent ──

test('celebration dismissal never starts another task', () => {
  assert.equal(completionNextAction('Enter'), null)
  assert.equal(completionNextAction('Escape'), null)
})

test('no dismissal key maps to a start, including Space and a click', () => {
  for (const key of [' ', 'Space', 'click', 's', 'n']) assert.equal(completionNextAction(key), null)
})

// ── Fixtures ──

const MIN = 60_000
const config = { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }
const entry = (n) => ({ id: `e${n}`, task_id: `t${n}`, occurrence_id: `o${n}`, added_at: '2026-09-22T08:00:00Z',
  source: { kind: 'today' }, explicit_still_open: false, config })
const session = (over = {}) => ({ id: 'sess', occurrence_id: 'o1', status: 'paused', phase: 'work', work_ms: 0,
  break_ms: 0, round_work_ms: 0, round: 1, config, ...over })
const snap = (over = {}) => ({
  queue_revision: 4, engine_revision: 9, owner_epoch: 'epoch', process_generation: 1, writer_device_id: 'mac',
  queue: [entry(1), entry(2), entry(3)], selected_occurrence_id: 'o1', session: null,
  totals: { o1: 12 * MIN }, as_of: '2026-09-22T17:00:00Z', checkpoint_at: null, recovery_reason: null,
  replica: false, ...over,
})
const caps = (over = {}) => ({ queue_read: true, queue_write: true, history_read: true, live_timing: false,
  companion: false, import: false, reason: 'Live timing, the companion window and import are not connected yet.', ...over })
const task = (over) => ({ id: 't', content: 'Task', project_id: 'inbox', parent_id: null, due_date: null,
  sync_policy: 'default', completed: false, status: 'todo', ...over })

// ── Entry intents ──

test('multi-select defaults to an explicit append in selection order', () => {
  assert.deepEqual(enqueueSelectionAction(['t9', 't4', 't9', 't7'], { kind: 'today' }), {
    kind: 'enqueue', task_ids: ['t9', 't4', 't7'], source: { kind: 'today' }, explicit_still_open: false,
  })
  assert.equal(enqueueSelectionAction([], { kind: 'today' }), null)
})

test('Focus now starts an already-queued occurrence in one explicit start (engine promotes atomically)', () => {
  assert.deepEqual(focusNowPlan(snap(), 't3', { kind: 'today' }), {
    enqueue: null, start: { kind: 'start', occurrence_id: 'o3' },
  })
})

test('Focus now on an unqueued task appends it, then starts the new occurrence', () => {
  const plan = focusNowPlan(snap(), 't8', { kind: 'project', project_id: 'p1' })
  assert.deepEqual(plan.enqueue, { kind: 'enqueue', task_ids: ['t8'], source: { kind: 'project', project_id: 'p1' }, explicit_still_open: false })
  assert.equal(plan.start, null) // resolved from the committed enqueue reply, never guessed
})

test('Space only pauses or resumes an existing session; it never starts one', () => {
  assert.equal(spaceKeyAction(snap()), null)
  assert.deepEqual(spaceKeyAction(snap({ session: session({ status: 'running' }) })), { kind: 'pause' })
  assert.deepEqual(spaceKeyAction(snap({ session: session() })), { kind: 'resume' })
  assert.equal(spaceKeyAction(snap({ session: session({ phase: 'round_ready' }) })), null)
  assert.equal(spaceKeyAction(snap({ session: session({ phase: 'work_ready' }) })), null)
  assert.equal(spaceKeyAction(snap({ session: session({ status: 'ended' }) })), null)
  assert.equal(spaceKeyAction(null), null)
})

test('source for a row: local-only, due today, else its project', () => {
  assert.deepEqual(sourceForTask(task({ sync_policy: 'local_only' }), '2026-09-22'), { kind: 'local' })
  assert.deepEqual(sourceForTask(task({ due_date: '2026-09-22' }), '2026-09-22'), { kind: 'today' })
  assert.deepEqual(sourceForTask(task({ project_id: 'p1', due_date: '2026-09-30' }), '2026-09-22'), { kind: 'project', project_id: 'p1' })
})

// ── History, provenance and recovery ──

const row = (over) => ({ occurrence_id: 'x', task_id: 't1', title: 'Write', total_ms: 0, recorded_ms: 0,
  imported_ms: 0, completed_at: null, archived: false, ...over })

test('completed tray shows only today\'s completed, non-archived occurrences', () => {
  const today = new Date(2026, 8, 22, 15, 0).toISOString()
  const earlier = new Date(2026, 8, 21, 15, 0).toISOString()
  const rows = [row({ occurrence_id: 'a', completed_at: today }), row({ occurrence_id: 'b', completed_at: today, archived: true }),
    row({ occurrence_id: 'c', completed_at: earlier }), row({ occurrence_id: 'd', completed_at: null })]
  assert.deepEqual(completedTrayRows(rows, '2026-09-22').map((r) => r.occurrence_id), ['a'])
})

test('per-task totals sum snapshot rows and keep imported provenance separate', () => {
  const summary = taskFocusSummary([
    row({ occurrence_id: 'a', total_ms: 30 * MIN, recorded_ms: 10 * MIN, imported_ms: 20 * MIN, completed_at: '2026-09-20T10:00:00Z' }),
    row({ occurrence_id: 'b', total_ms: 5 * MIN, recorded_ms: 5 * MIN, archived: true }),
  ])
  assert.deepEqual({ total: summary.total_ms, recorded: summary.recorded_ms, imported: summary.imported_ms },
    { total: 35 * MIN, recorded: 15 * MIN, imported: 20 * MIN })
  const [a, b] = summary.rows
  assert.deepEqual(a.parts, ['Recorded 10:00', 'Imported total 20:00'])
  assert.equal(b.when, 'Not completed')
  assert.equal(b.archived, true)
  assert.deepEqual(b.parts, ['Recorded 5:00'])
})

test('imported totals never claim a session span', () => {
  const summary = taskFocusSummary([row({ total_ms: 20 * MIN, imported_ms: 20 * MIN })])
  const text = JSON.stringify(summary)
  assert.doesNotMatch(text, /started|session|from .* to|–/i)
})

test('recovery shows the paused total from any date and offers no start', () => {
  const notice = recoveryNotice(
    snap({ recovery_reason: 'heartbeat gap', session: session(), totals: { o1: 83 * MIN }, as_of: '2026-09-25T09:00:00Z' }),
    [task({ id: 't1', content: 'Write chapter' })],
  )
  assert.deepEqual(notice, { title: 'Write chapter', total: '1:23:00', reason: 'heartbeat gap' })
  assert.equal(recoveryNotice(snap({ recovery_reason: null, session: session() }), []), null)
})

test('bulk completion reports refusals truthfully', () => {
  assert.deepEqual(completionSummary(3, 0), { ok: true, message: 'Completed 3 tasks' })
  assert.deepEqual(completionSummary(1, 2), { ok: false, message: 'Completed 1 task. 2 changed elsewhere and were left open.' })
  assert.deepEqual(completionSummary(0, 1), { ok: false, message: '1 task changed elsewhere and was left open.' })
  assert.deepEqual(completionSummary(2, 1, 1), { ok: false,
    message: 'Completed 2 tasks. 1 changed elsewhere and was left open. 1 task couldn\'t be saved; try again.' })
  assert.equal(isStaleRefusal({ code: 'stale_occurrence', message: 'x' }), true)
  assert.equal(isStaleRefusal('stale_occurrence: recurring due identity changed'), true)
  assert.equal(isStaleRefusal(new Error('database is locked')), false)
})

// ── Store orchestration and rendered surfaces (Vite SSR) ──

let output, h, r
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cache = path.join(root, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  output = await mkdtemp(path.join(cache, 'focus-flows-test-'))
  const common = { root, configFile: false, logLevel: 'error', plugins: [react()], resolve: { alias: { '@': path.join(root, 'src') } } }
  await build({ ...common, build: { ssr: path.join(root, 'tests/fixtures/focusFlowsHarness.ts'), outDir: path.join(output, 'h'),
    emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'harness.mjs' } } } })
  await build({ ...common, build: { ssr: path.join(root, 'tests/fixtures/focusFlowsRender.tsx'), outDir: path.join(output, 'r'),
    emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'render.mjs' } } } })
  h = await import(pathToFileURL(path.join(output, 'h/harness.mjs')).href)
  r = await import(pathToFileURL(path.join(output, 'r/render.mjs')).href)
})
after(async () => { if (output) await rm(output, { recursive: true, force: true }) })
beforeEach(() => { h?.resetFocusCache() })

/** Records every provider call; `execute` is scripted per test. */
function provider({ snapshot = snap(), capabilities = caps(), execute } = {}) {
  const calls = []
  h.setDataProvider({ focus: {
    capabilities: async () => capabilities,
    snapshot: async () => { calls.push({ op: 'snapshot' }); return snapshot },
    execute: async (command) => { calls.push({ op: 'execute', action: command.action }); return execute(command) },
  } })
  return calls
}
const executed = (calls) => calls.filter((c) => c.op === 'execute').map((c) => c.action)
const reply = (snapshot) => ({ snapshot, replayed: false, committed_revision: snapshot.engine_revision })

test('completing the current task commits once and selects the next entry paused', async () => {
  const running = snap({ session: session({ status: 'running' }) })
  const after = snap({ engine_revision: 10, queue_revision: 5, queue: [entry(2), entry(3)], selected_occurrence_id: 'o2', session: null })
  const calls = provider({ snapshot: running, capabilities: caps({ live_timing: true }), execute: () => reply(after) })
  await h.refreshFocus()
  await h.sendFocusAction({ kind: 'complete', occurrence_id: 'o1' })
  assert.deepEqual(executed(calls), [{ kind: 'complete', occurrence_id: 'o1' }])
  const s = h.useFocusCache.getState().snapshot
  assert.equal(s.queue[0].occurrence_id, 'o2')
  assert.equal(s.session, null, 'next entry is selected, not started')
})

test('completing an upcoming task leaves the running task and its timer alone', async () => {
  const running = snap({ session: session({ status: 'running' }) })
  const after = snap({ engine_revision: 10, queue_revision: 5, queue: [entry(1), entry(3)], session: session({ status: 'running' }) })
  const calls = provider({ snapshot: running, capabilities: caps({ live_timing: true }), execute: () => reply(after) })
  await h.refreshFocus()
  await h.sendFocusAction({ kind: 'complete', occurrence_id: 'o2' })
  assert.deepEqual(executed(calls), [{ kind: 'complete', occurrence_id: 'o2' }])
  const s = h.useFocusCache.getState().snapshot
  assert.equal(s.queue[0].occurrence_id, 'o1')
  assert.equal(s.session.status, 'running')
})

test('a refused completion leaves queue and current card unchanged and shows the error', async () => {
  const before = snap()
  const calls = provider({ snapshot: before, execute: () => { throw { code: 'stale_occurrence', message: 'This task changed elsewhere.' } } })
  await h.refreshFocus()
  await assert.rejects(h.sendFocusAction({ kind: 'complete', occurrence_id: 'o1' }), (e) => e.code === 'stale_occurrence')
  await new Promise((res) => setImmediate(res))
  assert.deepEqual(executed(calls), [{ kind: 'complete', occurrence_id: 'o1' }], 'typed refusal is not retried or followed by a start')
  const state = h.useFocusCache.getState()
  assert.deepEqual(state.snapshot.queue.map((e) => e.occurrence_id), ['o1', 'o2', 'o3'])
  assert.equal(state.error.code, 'stale_occurrence')
  const html = r.renderTrayWithError(state.error)
  assert.match(html, /role="alert"[^>]*>.*This task changed elsewhere/s)
  assert.ok(html.indexOf('Example task') >= 0, 'current card still rendered')
})

test('Focus now is refused before any write while live timing is unavailable', async () => {
  const calls = provider({ execute: () => { throw new Error('must not execute') } })
  await h.refreshFocus()
  await assert.rejects(h.focusNow('t8', { kind: 'today' }), (e) => e.code === 'unsupported')
  assert.deepEqual(executed(calls), [])
})

test('Focus now on an unqueued task enqueues then starts the committed occurrence', async () => {
  const enqueued = snap({ engine_revision: 10, queue_revision: 5, queue: [entry(1), entry(2), entry(3), entry(8)] })
  const started = snap({ engine_revision: 11, queue_revision: 6, queue: [entry(8), entry(1), entry(2), entry(3)],
    selected_occurrence_id: 'o8', session: session({ occurrence_id: 'o8', status: 'running' }) })
  const calls = provider({ capabilities: caps({ live_timing: true }),
    execute: (c) => reply(c.action.kind === 'enqueue' ? enqueued : started) })
  await h.refreshFocus()
  await h.focusNow('t8', { kind: 'today' })
  assert.deepEqual(executed(calls), [
    { kind: 'enqueue', task_ids: ['t8'], source: { kind: 'today' }, explicit_still_open: false },
    { kind: 'start', occurrence_id: 'o8' },
  ])
})

test('enqueueing a selection appends without starting anything', async () => {
  const calls = provider({ execute: () => reply(snap({ engine_revision: 10 })) })
  await h.refreshFocus()
  await h.enqueueTasks(['t5', 't4'], { kind: 'today' })
  assert.deepEqual(executed(calls), [{ kind: 'enqueue', task_ids: ['t5', 't4'], source: { kind: 'today' }, explicit_still_open: false }])
})

test('a second action while one is pending is dropped, not sent twice', async () => {
  let release
  const gate = new Promise((res) => { release = res })
  const calls = provider({ capabilities: caps({ live_timing: true }), execute: async () => { await gate; return reply(snap({ engine_revision: 10 })) } })
  await h.refreshFocus()
  const first = h.sendFocusAction({ kind: 'complete', occurrence_id: 'o1' })
  await assert.rejects(h.sendFocusAction({ kind: 'complete', occurrence_id: 'o1' }), (e) => e.code === 'conflict')
  release()
  await first
  assert.equal(executed(calls).length, 1)
  assert.equal(h.useFocusCache.getState().error, null, 'a dropped duplicate does not raise a visible failure')
})

test('the controls of a pending action are disabled while it is in flight', () => {
  const html = r.renderPendingTray()
  const start = html.match(/<button\b[^>]*aria-label="Start"[^>]*>/)?.[0] ?? ''
  const complete = html.match(/<button\b[^>]*aria-label="Complete Example task"[^>]*>/)?.[0] ?? ''
  assert.match(start, /disabled=""/)
  assert.match(complete, /disabled=""/)
})

test('Up next rows label promote truthfully; Focus now is a separate explicit start', () => {
  const html = r.renderQueueRows({ live: false })
  assert.match(html, /aria-label="Move Second task to top"/)
  const focusNow = html.match(/<button\b[^>]*aria-label="Focus Second task now"[^>]*>/)?.[0] ?? ''
  assert.match(focusNow, /disabled=""/, 'Focus now stays disabled with a reason until live timing')
})

test('completion acknowledgement shows the next task ready without a start control', () => {
  const html = r.renderCelebration()
  assert.match(html, /Write chapter/)
  assert.match(html, /Next: <[^>]*>Second task/)
  assert.match(html, /ready when you are/i)
  assert.doesNotMatch(html, /aria-label="Start"|>Start</)
})

test('banner coexists with the page: task, paused total and the disabled-with-reason control', () => {
  const html = r.renderBanner()
  assert.match(html, /Example task/)
  assert.match(html, /12:00/)
  assert.match(html, /aria-label="Start"[^>]*disabled=""|disabled=""[^>]*aria-label="Start"/)
  assert.match(html, /aria-label="Expand focus view"/)
  assert.doesNotMatch(html, /Stop focus/, 'stopping never clears the queue from the banner')
})

test('recovery notice renders the paused total and offers no start', () => {
  const html = r.renderRecovery()
  assert.match(html, /Write chapter/)
  assert.match(html, /1:23:00/)
  assert.doesNotMatch(html, />Resume<|>Start</)
})

test('task history shows exact provenance labels and nullable timestamps', () => {
  const html = r.renderTaskHistory()
  assert.match(html, /Imported total 20:00/)
  assert.match(html, /Recorded 10:00/)
  assert.match(html, /Not completed/)
  assert.match(html, /Cleared from tray/)
  assert.match(html, /35:00/)
})
