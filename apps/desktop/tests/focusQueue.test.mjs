// Focus queue: pure command intents (loaded directly) plus the rendered
// tray (Vite SSR build of tests/fixtures/focusRender.tsx). Rendered order is
// asserted on stable accessible labels, never on source text.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import {
  timerControl, controlBlockedReason, reorderAfterDrag, moveEntryAction, timeboxConfig,
  pomodoroConfig, parseCustomMinutes, planQuickAdd, runQuickAdd, taskMenuItems, failureControl,
  focusTaskOps, duplicateInput, dueLabel, localFailureMessage, visibleFailure, menuFocusAction, undoDeleteAction, stillOpenAction,
  addToQueueLabel, sourceLabel, queueRowKeyIntent, queueRowClickIntent, queueTabStop, reenqueueAction, restoreEntryAction,
  taskPlaceLabel, descriptionOverflows,
} from '../src/lib/focusQueueIntents.ts'

let output, rendered
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cache = path.join(root, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  output = await mkdtemp(path.join(cache, 'focus-queue-test-'))
  await build({ root, configFile: false, logLevel: 'error', plugins: [react()],
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { ssr: path.join(root, 'tests/fixtures/focusRender.tsx'), outDir: output, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'render.mjs' } } } })
  rendered = await import(pathToFileURL(path.join(output, 'render.mjs')).href)
})
after(async () => { if (output) await rm(output, { recursive: true, force: true }) })

// ── fixtures for pure intents ──
const config = { mode: 'count_up', budget_ms: null, work_ms: 1_500_000, break_ms: 300_000, rounds: 4 }
const entry = (n, over = {}) => ({ id: `e${n}`, task_id: `t${n}`, occurrence_id: `o${n}`,
  added_at: '2026-09-22T00:00:00Z', source: { kind: 'today' }, explicit_still_open: false, config, ...over })
const session = (over = {}) => ({ id: 's1', occurrence_id: 'o1', status: 'paused', phase: 'work', work_ms: 0,
  break_ms: 0, round_work_ms: 0, round: 1, config, ...over })
const snapshot = (over = {}) => ({ queue_revision: 3, engine_revision: 7, owner_epoch: 'ep', process_generation: 1,
  writer_device_id: 'mac', queue: [entry(1), entry(2), entry(3), entry(4)], selected_occurrence_id: 'o1',
  session: null, totals: {}, as_of: '2026-09-22T10:00:00Z', checkpoint_at: null, recovery_reason: null,
  replica: false, ...over })
const caps = (over = {}) => ({ queue_read: true, queue_write: true, history_read: true, live_timing: true,
  companion: false, import: false, reason: null, ...over })
const task = (over = {}) => ({ sync_policy: 'default', reminder_offset_minutes: null, google_calendar_enabled: false,
  id: 't1', parent_id: null, content: 'Task', description: null, project_id: 'inbox', priority: 1,
  due_date: null, due_time: null, duration_minutes: null, recurrence_rule: null, section_id: null, labels: [],
  completed: false, completed_at: null, status: 'todo', linked_doc_id: null, position: 0,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', external_id: null,
  external_source: null, remote_updated_at: null, synced_snapshot: null, ...over })

test('timer control maps session state to one explicit action and label', () => {
  const e = entry(1)
  assert.deepEqual(timerControl(snapshot(), e), { label: 'Start', action: { kind: 'start', occurrence_id: 'o1' }, live: true })
  assert.equal(timerControl(snapshot({ session: session({ status: 'running' }) }), e).action.kind, 'pause')
  assert.deepEqual(timerControl(snapshot({ session: session() }), e), { label: 'Resume', action: { kind: 'resume' }, live: true })
  assert.deepEqual(timerControl(snapshot({ session: session({ phase: 'round_ready' }) }), e).action, { kind: 'start_break' })
  assert.deepEqual(timerControl(snapshot({ session: session({ phase: 'break', status: 'running' }) }), e).action, { kind: 'end_break' })
  assert.deepEqual(timerControl(snapshot({ session: session({ phase: 'work_ready' }) }), e),
    { label: 'Start next round', action: { kind: 'start', occurrence_id: 'o1' }, live: true })
  // A session for another occurrence (or an ended one) never drives this card.
  assert.equal(timerControl(snapshot({ session: session({ occurrence_id: 'o9', status: 'running' }) }), e).label, 'Start')
  assert.equal(timerControl(snapshot({ session: session({ status: 'ended' }) }), e).label, 'Start')
})

test('Start is disabled with the capability reason, never hidden; Pause stays available', () => {
  const start = timerControl(snapshot(), entry(1))
  assert.equal(controlBlockedReason(start, caps()), null)
  assert.equal(controlBlockedReason(start, caps({ live_timing: false, reason: 'Timing starts with the companion' })),
    'Timing starts with the companion')
  assert.match(controlBlockedReason(start, caps({ live_timing: false })), /timing/i)
  assert.match(controlBlockedReason(start, caps({ queue_write: false, reason: 'Read-only replica' })), /Read-only replica/)
  assert.match(controlBlockedReason(start, null), /loading/i)
  const pause = timerControl(snapshot({ session: session({ status: 'running' }) }), entry(1))
  assert.equal(controlBlockedReason(pause, caps({ live_timing: false })), null)
})

test('drag reorder moves only Up next rows and never displaces the first entry', () => {
  const q = snapshot().queue
  assert.deepEqual(reorderAfterDrag(q, 'e4', 'e2'), { kind: 'reorder', entry_ids: ['e1', 'e4', 'e2', 'e3'] })
  assert.equal(reorderAfterDrag(q, 'e2', 'e1'), null)
  assert.equal(reorderAfterDrag(q, 'e1', 'e3'), null)
  assert.equal(reorderAfterDrag(q, 'e2', 'e2'), null)
  assert.equal(reorderAfterDrag(q, 'missing', 'e2'), null)
})

test('keyboard move stays below the card; top is an explicit promote', () => {
  const q = snapshot().queue
  assert.deepEqual(moveEntryAction(q, 'e3', 'up'), { kind: 'reorder', entry_ids: ['e1', 'e3', 'e2', 'e4'] })
  assert.deepEqual(moveEntryAction(q, 'e3', 'down'), { kind: 'reorder', entry_ids: ['e1', 'e2', 'e4', 'e3'] })
  assert.deepEqual(moveEntryAction(q, 'e2', 'bottom'), { kind: 'reorder', entry_ids: ['e1', 'e3', 'e4', 'e2'] })
  assert.equal(moveEntryAction(q, 'e2', 'up'), null)
  assert.equal(moveEntryAction(q, 'e4', 'down'), null)
  assert.deepEqual(moveEntryAction(q, 'e3', 'top'), { kind: 'promote', occurrence_id: 'o3' })
})

test('timebox picker configs: presets, custom whole minutes 1-1440, count-up, optional Pomodoro', () => {
  assert.deepEqual(timeboxConfig(config, 25), { ...config, mode: 'timebox', budget_ms: 1_500_000 })
  assert.deepEqual(timeboxConfig({ ...config, mode: 'timebox', budget_ms: 60_000 }, null), { ...config, mode: 'count_up', budget_ms: null })
  assert.deepEqual(pomodoroConfig(config), { mode: 'pomodoro', budget_ms: null, work_ms: 1_500_000, break_ms: 300_000, rounds: 4 })
  assert.equal(parseCustomMinutes('90'), 90)
  assert.equal(parseCustomMinutes(' 1 '), 1)
  assert.equal(parseCustomMinutes('1440'), 1440)
  for (const bad of ['', '0', '1441', '2.5', '-3', 'abc', '10m']) assert.equal(parseCustomMinutes(bad), null, bad)
})

test('quick-add plans per source: Today = Inbox + due today, project keeps project, local-only is unbound', () => {
  assert.deepEqual(planQuickAdd('Write brief', { kind: 'today' }, '2026-09-22').requests,
    [{ content: 'Write brief', projectId: 'inbox', dueDate: '2026-09-22' }])
  assert.deepEqual(planQuickAdd('A', { kind: 'project', project_id: 'p1' }, '2026-09-22').requests,
    [{ content: 'A', projectId: 'p1' }])
  assert.deepEqual(planQuickAdd('A', { kind: 'local' }, '2026-09-22').requests,
    [{ content: 'A', syncPolicy: 'local_only' }])
  const batch = planQuickAdd('first\n\n  second  \nthird', { kind: 'local' }, '2026-09-22')
  assert.deepEqual(batch.requests.map((r) => r.content), ['first', 'second', 'third'])
  assert.equal(batch.error, null)
  assert.match(planQuickAdd('  \n ', { kind: 'today' }, '2026-09-22').error, /type a task/i)
})

test('batch quick-add creates in input order and enqueues once with the source captured at submit', async () => {
  const calls = []
  const source = { kind: 'project', project_id: 'p1' }
  const pending = runQuickAdd('one\ntwo', source, '2026-09-22', {
    create: async (req) => { calls.push(['create', req.content, req.projectId]); return task({ id: `new-${req.content}` }) },
    onAction: async (action) => { calls.push(['action', action]); return {} },
  })
  source.project_id = 'switched' // a source change mid-flight must not move the result
  const result = await pending
  assert.deepEqual(calls, [
    ['create', 'one', 'p1'], ['create', 'two', 'p1'],
    ['action', { kind: 'enqueue', task_ids: ['new-one', 'new-two'], source: { kind: 'project', project_id: 'p1' }, explicit_still_open: false }],
  ])
  assert.deepEqual(result, { remaining: '', error: null, created: 2 })
})

test('failed create preserves the unsent text and error, still queueing what was created', async () => {
  const actions = []
  const result = await runQuickAdd('ok\nboom\nlater', { kind: 'local' }, '2026-09-22', {
    create: async (req) => { if (req.content === 'boom') throw new Error('disk full'); return task({ id: req.content }) },
    onAction: async (action) => { actions.push(action); return {} },
  })
  assert.equal(result.remaining, 'boom\nlater')
  assert.match(result.error, /disk full/)
  assert.deepEqual(actions.map((a) => a.task_ids), [['ok']])
  const empty = await runQuickAdd('   ', { kind: 'today' }, '2026-09-22', {
    create: async () => { throw new Error('never called') }, onAction: async () => { throw new Error('never') } })
  assert.equal(empty.remaining, '   ')
  assert.match(empty.error, /type a task/i)
})

test('menus: local-only tasks get rename/duplicate/delete; linked tasks never get the local delete shortcut', () => {
  const local = taskMenuItems(task({ sync_policy: 'local_only' }), 'row')
  assert.deepEqual(local.map((i) => i.id), ['copy_context', 'open_details', 'rename', 'duplicate', 'move_top', 'move_bottom', 'remove', 'delete'])
  const linked = taskMenuItems(task({ external_id: 'td-1' }), 'row').map((i) => i.id)
  assert.ok(!linked.includes('delete') && !linked.includes('rename') && !linked.includes('duplicate'))
  const card = taskMenuItems(task(), 'card').map((i) => i.id)
  assert.deepEqual(card, ['copy_context', 'open_details', 'skip', 'stop', 'remove'])
})

test('due cue is neutral: time today, short date otherwise, never overdue wording', () => {
  assert.equal(dueLabel(task({ due_date: '2026-09-22', due_time: '14:00' }), '2026-09-22'), '2:00 PM')
  assert.equal(dueLabel(task({ due_date: '2026-09-22' }), '2026-09-22'), 'Today')
  assert.equal(dueLabel(task({ due_date: '2026-09-20' }), '2026-09-22'), 'Sep 20')
  assert.equal(dueLabel(task({ due_date: '2026-09-20', due_time: '09:30' }), '2026-09-22'), 'Sep 20 9:30 AM')
  assert.equal(dueLabel(task(), '2026-09-22'), null)
})

test('menu queue actions: move top promotes, bottom reorders, skip/stop/remove, others are not queue writes', () => {
  const q = snapshot().queue
  assert.deepEqual(menuFocusAction('move_top', q[2], q), { kind: 'promote', occurrence_id: 'o3' })
  assert.deepEqual(menuFocusAction('move_bottom', q[1], q), { kind: 'reorder', entry_ids: ['e1', 'e3', 'e4', 'e2'] })
  assert.deepEqual(menuFocusAction('skip', q[0], q), { kind: 'skip' })
  assert.deepEqual(menuFocusAction('stop', q[0], q), { kind: 'stop' })
  assert.deepEqual(menuFocusAction('remove', q[3], q), { kind: 'remove', occurrence_id: 'o4' })
  for (const id of ['copy_context', 'open_details', 'rename', 'duplicate', 'delete']) assert.equal(menuFocusAction(id, q[1], q), null)
  assert.deepEqual(undoDeleteAction('tok-1'), { kind: 'undo_delete', token: 'tok-1' })
  assert.deepEqual(stillOpenAction(['t5']), { kind: 'enqueue', task_ids: ['t5'], source: { kind: 'today' }, explicit_still_open: true })
})

test('uncertain failures offer Try again with the SAME command; certain ones only explain', () => {
  const command = { command_id: 'c-1', action: { kind: 'skip' } }
  assert.deepEqual(failureControl({ code: 'storage', message: 'disk busy', command }), { message: 'disk busy', retry: command })
  assert.deepEqual(failureControl({ code: 'conflict', message: 'Queue changed', command }), { message: 'Queue changed', retry: null })
  assert.deepEqual(failureControl({ code: 'storage', message: 'x' }), { message: 'x', retry: null })
  assert.equal(failureControl(null), null)
})

test('a stale occurrence shows readable copy, never raw engine text', () => {
  const command = { command_id: 'c-2', action: { kind: 'complete', occurrence_id: 'o1' } }
  const failure = failureControl({ code: 'stale_occurrence', message: 'recurring due identity changed', command })
  assert.equal(failure.retry, null)
  assert.doesNotMatch(failure.message, /identity|stale_occurrence|recurring due/)
  assert.match(failure.message, /changed elsewhere/)
  assert.match(failure.message, /Nothing was saved/)
})

test('typed focus failures live only in the cache, so a successful retry leaves no stale alert', () => {
  const command = { command_id: 'c-1', action: { kind: 'skip' } }
  const storage = Object.assign(new Error('Disk was busy'), { code: 'storage', command })
  // The rejected action is not copied into local state...
  assert.equal(localFailureMessage(storage), null)
  // ...while it is uncertain the cache shows it with Try again...
  assert.deepEqual(visibleFailure(storage, localFailureMessage(storage)), { message: 'Disk was busy', retry: command })
  // ...and once retryFocusCommand succeeds (cache cleared) nothing remains.
  assert.equal(visibleFailure(null, localFailureMessage(storage)), null)
  // Untyped failures (native task writes) are kept locally.
  assert.equal(localFailureMessage(new Error('disk full')), 'disk full')
  assert.deepEqual(visibleFailure(null, 'disk full'), { message: 'disk full', retry: null })
})

test('task ops pass the displayed due date on completion and duplicate as fresh unbound work', async () => {
  const calls = []
  const dp = { tasks: {
    complete: async (...a) => { calls.push(['complete', ...a]) },
    update: async (o) => { calls.push(['update', o]); return task() },
    create: async (o) => { calls.push(['create', o]); return task({ id: 'dup' }) },
    delete: async (id) => { calls.push(['delete', id]); return { undo_token: 'tok-1' } },
  } }
  let changed = 0
  const ops = focusTaskOps(dp, { onChanged: () => { changed++ }, openDetail: () => {}, writeClipboard: undefined })
  await ops.complete(task({ id: 'r', due_date: '2026-09-22' }))
  await ops.complete(task({ id: 'u' }))
  await ops.rename(task({ id: 'r' }), 'New name')
  const source = task({ id: 'src', sync_policy: 'local_only', content: 'Copy me', description: 'd', priority: 3,
    labels: ['l1'], status: 'in_progress', completed: false, external_id: null })
  await ops.duplicate(source)
  assert.deepEqual(await ops.remove(task({ id: 'gone' })), { undo_token: 'tok-1' })
  assert.deepEqual(calls[0], ['complete', 'r', '2026-09-22'])
  assert.deepEqual(calls[1], ['complete', 'u', null])
  assert.deepEqual(calls[2], ['update', { id: 'r', content: 'New name' }])
  assert.equal(calls[3][1].syncPolicy, 'local_only')
  assert.deepEqual(calls[3][1], duplicateInput(source))
  assert.equal(calls[3][1].content, 'Copy me')
  assert.deepEqual(calls[4], ['delete', 'gone'])
  assert.equal(changed, 5)
  await assert.rejects(ops.rename(task(), '   '), /empty/i)
})

// ── rendered tray ──

const labelsIn = (html, labels) => labels.map((l) => html.indexOf(l))
const ascending = (xs) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]))

test('expanded tray keeps Focus Queue hierarchy: card, Up next, Add, completed, still open, footer', () => {
  const html = rendered.renderQueueTray()
  const order = labelsIn(html, ['Example task', 'Focus timer', 'Up next', 'Second task', 'Third task',
    'Add task', 'Shipped notes', 'Still open', 'Add tasks from'])
  assert.ok(ascending(order), `order ${order}`)
})

test('Up next renders snapshot order regardless of the candidate source order', () => {
  const today = rendered.renderQueueTray()
  const project = rendered.renderQueueTray({ source: 'project' })
  for (const html of [today, project]) {
    assert.ok(html.indexOf('Second task') < html.indexOf('Third task'))
  }
})

test('queue rows expose separate handle, completion, promote and menu stops', () => {
  const html = rendered.renderQueueTray()
  const upNext = html.slice(html.indexOf('Up next'), html.indexOf('Add task'))
  assert.equal((upNext.match(/aria-label="Drag to reorder Second task"/g) ?? []).length, 1)
  assert.match(upNext, /aria-label="Complete Second task"/)
  assert.match(upNext, /aria-label="Move Second task to top"/) // explicit mouse promote (paused)
  assert.match(upNext, /aria-label="Focus Second task now"/) // separate explicit start
  assert.match(upNext, /aria-label="More actions for Second task"/)
  // The promote button is not the row: keyboard moves refocus the row by entry id.
  const promote = upNext.match(/<button\b[^>]*aria-label="Move Second task to top"[^>]*>/)?.[0] ?? ''
  assert.doesNotMatch(promote, /data-focus-entry/)
})

const rowTag = (html, id) => html.match(new RegExp(`<li\\b[^>]*data-focus-entry="${id}"[^>]*>`))?.[0] ?? ''
const rowHtml = (html, id) => {
  const start = html.indexOf(rowTag(html, id))
  return html.slice(start, html.indexOf('</li>', start))
}

test('Up next is one Tab stop: the first row is current, named by its title, with its keys', () => {
  const html = rendered.renderQueueTray()
  assert.match(html, /<ul\b[^>]*aria-label="Up next"[^>]*class="[^"]*group\/queue/)
  const first = rowTag(html, 'e2')
  assert.match(first, /tabindex="0"/)
  assert.match(first, /aria-current="true"/)
  // Named by its title (selecting, not "Move … to top"); the due label is its description.
  const labelledby = first.match(/aria-labelledby="([^"]+)"/)?.[1]
  assert.ok(labelledby)
  assert.match(html, new RegExp(`id="${labelledby}"[^>]*>\\s*Second task\\s*<`))
  const describedby = first.match(/aria-describedby="([^"]+)"/)?.[1]
  assert.ok(describedby, 'due label is announced')
  assert.match(html, new RegExp(`id="${describedby}"[^>]*>[^<]+<`))
  assert.doesNotMatch(first, /aria-label=/)
  assert.match(first, /aria-keyshortcuts="ArrowUp ArrowDown Alt\+ArrowUp Alt\+ArrowDown Home End Enter Delete Backspace"/)
  // Visible current-row state while the list has focus, from the task-row token.
  assert.match(first, /group-focus-within\/queue:bg-accent\/10/)
  const second = rowTag(html, 'e3')
  assert.match(second, /tabindex="-1"/)
  assert.doesNotMatch(second, /aria-current/)
  assert.doesNotMatch(second, /bg-accent\/10/)
})

test('only the current row\'s controls are Tab stops', () => {
  const html = rendered.renderQueueTray()
  const other = rowHtml(html, 'e3')
  const buttons = other.match(/<button\b[^>]*>/g) ?? []
  assert.ok(buttons.length >= 5, `row controls rendered: ${buttons.length}`)
  for (const b of buttons) assert.match(b, /tabindex="-1"/, b)
  for (const b of rowHtml(html, 'e2').match(/<button\b[^>]*>/g) ?? []) assert.doesNotMatch(b, /tabindex="-1"/, b)
})

test('row keys: arrows move the current row, clamped at the ends; Home/End jump', () => {
  assert.deepEqual(queueRowKeyIntent('ArrowDown', {}, 0, 3), { kind: 'focus', index: 1 })
  assert.deepEqual(queueRowKeyIntent('ArrowUp', {}, 2, 3), { kind: 'focus', index: 1 })
  assert.deepEqual(queueRowKeyIntent('ArrowUp', {}, 0, 3), { kind: 'focus', index: 0 })
  assert.deepEqual(queueRowKeyIntent('ArrowDown', {}, 2, 3), { kind: 'focus', index: 2 })
  assert.deepEqual(queueRowKeyIntent('Home', {}, 2, 3), { kind: 'focus', index: 0 })
  assert.deepEqual(queueRowKeyIntent('End', {}, 0, 3), { kind: 'focus', index: 2 })
})

test('row keys: Alt+arrows reorder, never past the ends (the card entry stays first)', () => {
  assert.deepEqual(queueRowKeyIntent('ArrowUp', { alt: true }, 1, 3), { kind: 'move', direction: 'up' })
  assert.deepEqual(queueRowKeyIntent('ArrowDown', { alt: true }, 1, 3), { kind: 'move', direction: 'down' })
  assert.equal(queueRowKeyIntent('ArrowUp', { alt: true }, 0, 3), null, 'first Up next row cannot displace the card')
  assert.equal(queueRowKeyIntent('ArrowDown', { alt: true }, 2, 3), null)
  assert.equal(queueRowKeyIntent('ArrowDown', { alt: true }, 0, 1), null)
  // …and the engine-side guard agrees: queue index 1 cannot move above index 0.
  const queue = [{ id: 'e1', occurrence_id: 'o1' }, { id: 'e2', occurrence_id: 'o2' }]
  assert.equal(moveEntryAction(queue, 'e2', 'up'), null)
})

test('row keys: Enter promotes, Delete/Backspace remove; other keys and chords are left alone', () => {
  assert.deepEqual(queueRowKeyIntent('Enter', {}, 1, 3), { kind: 'promote' })
  assert.deepEqual(queueRowKeyIntent('Delete', {}, 1, 3), { kind: 'remove' })
  assert.deepEqual(queueRowKeyIntent('Backspace', {}, 1, 3), { kind: 'remove' })
  for (const [key, mods] of [[' ', {}], ['f', {}], ['F', { shift: true }], ['Enter', { meta: true }],
    ['ArrowDown', { shift: true }], ['ArrowUp', { ctrl: true }], ['Backspace', { meta: true }], ['Enter', { alt: true }]]) {
    assert.equal(queueRowKeyIntent(key, mods, 1, 3), null, `${key} ${JSON.stringify(mods)}`)
  }
  assert.equal(queueRowKeyIntent('ArrowDown', {}, -1, 3), null, 'no row, no action')
  assert.equal(queueRowKeyIntent('Enter', {}, 0, 0), null)
})

test('a row click focuses the row and never promotes', () => {
  assert.deepEqual(queueRowClickIntent(2), { kind: 'focus', index: 2 })
  assert.notEqual(queueRowClickIntent(0).kind, 'promote')
})

test('roving stop: remembered row, else the row now in its place, else the first', () => {
  const ids = ['e2', 'e3', 'e4']
  assert.equal(queueTabStop(ids, { id: null, index: -1 }), 'e2')
  assert.equal(queueTabStop(ids, { id: 'e3', index: 1 }), 'e3')
  assert.equal(queueTabStop(['e2', 'e4'], { id: 'e3', index: 1 }), 'e4', 'removed row: its neighbour takes the stop')
  assert.equal(queueTabStop(['e2'], { id: 'e4', index: 2 }), 'e2', 'removed last row: clamps to the new last')
  assert.equal(queueTabStop(['e4', 'e2', 'e3'], { id: 'e3', index: 1 }), 'e3', 'a moved row keeps the stop')
  assert.equal(queueTabStop([], { id: 'e2', index: 0 }), null)
})

test('completed tray shows struck title with spent time and Show/Hide/Clear', () => {
  const html = rendered.renderQueueTray()
  const tray = html.slice(html.indexOf('1 done'))
  assert.match(tray, /line-through[^>]*>Shipped notes</)
  assert.match(tray, /12:00/)
  assert.match(tray, />Hide</)
  assert.match(tray, />Clear</)
})

test('footer names where tasks come from and says exactly what the add button adds', () => {
  const html = rendered.renderQueueTray()
  assert.match(html, /aria-label="Add tasks from: Today"/)
  assert.match(html, />From: Today</)
  assert.match(html, />Add 1 to queue</)
  assert.doesNotMatch(html, /candidate|Queue these|overdue/i)
})

test('add button copy: count, singular, all added, nothing to add', () => {
  assert.equal(addToQueueLabel(3, 5), 'Add 3 to queue')
  assert.equal(addToQueueLabel(1, 1), 'Add 1 to queue')
  assert.equal(addToQueueLabel(0, 4), 'All added')
  assert.equal(addToQueueLabel(0, 0), 'Nothing to add')
})

test('local-only source reads as Nimble only', () => {
  assert.equal(sourceLabel({ kind: 'local' }, []), 'Nimble only')
  assert.equal(sourceLabel({ kind: 'today' }, []), 'Today')
})

test('read-only capability renders disabled controls with the reason, not hidden ones', () => {
  const html = rendered.renderQueueTray({ readOnly: true })
  const start = html.match(/<button\b[^>]*aria-label="Start"[^>]*>/)?.[0]
  assert.ok(start, 'Start is rendered')
  assert.match(start, /disabled=""/)
  assert.match(html, /Replica is read-only/)
  assert.match(html.match(/<button\b[^>]*>Add 1 to queue<\/button>/)?.[0] ?? '', /disabled=""/)
})

test('uncertain failure stays visible with Try again, beside any completion acknowledgement', () => {
  const html = rendered.renderQueueTray({ error: 'storage' })
  assert.match(html, /role="alert"[^>]*>.*Disk was busy/s)
  assert.match(html, />Try again</)
  const certain = rendered.renderQueueTray({ error: 'conflict' })
  assert.match(certain, /Queue changed elsewhere/)
  assert.doesNotMatch(certain, />Try again</)
})

test('empty queue keeps a positive empty card and Show queue in card-only mode', () => {
  const html = rendered.renderQueueTray({ empty: true, compact: true })
  assert.match(html, /Queue is clear/)
  assert.match(html, /Show queue/)
  assert.doesNotMatch(html, /Add task/)
})

test('a focus surface without a snapshot shows a loading skeleton or the error, never a blank area or Start', () => {
  const loading = rendered.renderFocusLoading()
  assert.match(loading, /role="status"/)
  assert.match(loading, /aria-label="Loading focus"/)
  assert.doesNotMatch(loading, /Start/)
  const failed = rendered.renderFocusLoadError()
  assert.match(failed, /role="alert"/)
  assert.match(failed, /Focus couldn(&#x27;|’|')t load: focus storage unavailable/)
  assert.match(failed, /Try again/)
  assert.doesNotMatch(failed, /aria-label="Start"/)
})

test('row keys: auto-repeat never promotes or removes; arrows still repeat', () => {
  for (const key of ['Enter', 'Delete', 'Backspace']) {
    assert.equal(queueRowKeyIntent(key, { repeat: true }, 1, 3), null, key)
  }
  assert.deepEqual(queueRowKeyIntent('ArrowDown', { repeat: true }, 1, 3), { kind: 'focus', index: 2 })
  assert.deepEqual(queueRowKeyIntent('ArrowUp', { alt: true, repeat: true }, 1, 3), { kind: 'move', direction: 'up' })
})

test('undo remove: re-queues with the original source and still-open flag', () => {
  const entry = { id: 'e3', task_id: 't3', occurrence_id: 'o3', source: { kind: 'project', project_id: 'p1' }, explicit_still_open: true }
  assert.deepEqual(reenqueueAction(entry), {
    kind: 'enqueue', task_ids: ['t3'], source: { kind: 'project', project_id: 'p1' }, explicit_still_open: true,
  })
})

test('undo remove: the re-queued entry returns to its prior index, never onto the card', () => {
  const q = (...pairs) => pairs.map(([id, task_id]) => ({ id, task_id }))
  const after = q(['e1', 't1'], ['e2', 't2'], ['e4', 't4'], ['e9', 't3'])
  assert.deepEqual(restoreEntryAction(after, 't3', 2), { kind: 'reorder', entry_ids: ['e1', 'e2', 'e9', 'e4'] })
  assert.deepEqual(restoreEntryAction(after, 't3', 1), { kind: 'reorder', entry_ids: ['e1', 'e9', 'e2', 'e4'] })
  assert.deepEqual(restoreEntryAction(after, 't3', 0), { kind: 'reorder', entry_ids: ['e1', 'e9', 'e2', 'e4'] }, 'index 0 clamps below the card')
  assert.equal(restoreEntryAction(after, 't3', 3), null, 'already at its old index')
  assert.equal(restoreEntryAction(after, 't3', 9), null, 'past the end clamps to the end, where it already is')
  assert.equal(restoreEntryAction(after, 'tx', 1), null, 'not re-queued: nothing to move')
  assert.equal(restoreEntryAction(q(['e9', 't3']), 't3', 1), null, 'alone in the queue: it is the card')
})

test('place label: project, or project / section; nothing when the project is unknown', () => {
  const projects = [{ id: 'inbox', name: 'Inbox' }, { id: 'p1', name: 'Deep work' }]
  const sections = [{ id: 'sec1', project_id: 'p1', name: 'Writing' }, { id: 'sec2', project_id: 'p9', name: 'Elsewhere' }]
  const t = (over) => ({ id: 't', project_id: 'inbox', section_id: null, ...over })
  assert.equal(taskPlaceLabel(t({}), projects, sections), 'Inbox')
  assert.equal(taskPlaceLabel(t({ project_id: 'p1', section_id: 'sec1' }), projects, sections), 'Deep work / Writing')
  assert.equal(taskPlaceLabel(t({ project_id: 'p1', section_id: 'missing' }), projects, sections), 'Deep work')
  assert.equal(taskPlaceLabel(t({ project_id: 'p1', section_id: 'sec2' }), projects, sections), 'Deep work', 'section of another project is ignored')
  assert.equal(taskPlaceLabel(t({ project_id: 'gone' }), projects, sections), null)
  assert.equal(taskPlaceLabel(t({ project_id: '' }), projects, sections), null)
})

test('description overflows one line only when the clamped box is smaller than its content', () => {
  assert.equal(descriptionOverflows({ scrollHeight: 17, clientHeight: 17, scrollWidth: 300, clientWidth: 300 }), false)
  assert.equal(descriptionOverflows({ scrollHeight: 34, clientHeight: 17, scrollWidth: 300, clientWidth: 300 }), true)
  assert.equal(descriptionOverflows({ scrollHeight: 17, clientHeight: 17, scrollWidth: 420, clientWidth: 300 }), true)
  assert.equal(descriptionOverflows({ scrollHeight: 17.6, clientHeight: 17, scrollWidth: 300.4, clientWidth: 300 }), false, 'sub-pixel noise is not overflow')
})
