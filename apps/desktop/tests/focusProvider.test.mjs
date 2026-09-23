import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import {
  shouldApplyFocusRevision,
  createFocusSnapshotGate,
  subscribeFocusChanges,
  notifyFocusChanged,
  parseFocusChangeSignal,
  trackFocusSnapshots,
  FocusRequestError,
} from '../src/services/focus-events.ts'

test('late initial load cannot overwrite a newer event result', () => {
  assert.equal(shouldApplyFocusRevision(12, 11), false)
  assert.equal(shouldApplyFocusRevision(12, 12), true)
})

const snap = (engine_revision, owner_epoch = 'epoch-a', extra = {}) => ({
  queue_revision: 1, engine_revision, owner_epoch, process_generation: 1,
  writer_device_id: 'device', queue: [], selected_occurrence_id: null, session: null,
  totals: {}, as_of: '2026-09-22T00:00:00Z', checkpoint_at: null, recovery_reason: null,
  replica: false, ...extra,
})

test('snapshot gate compares revisions within one epoch only', () => {
  const gate = createFocusSnapshotGate()
  assert.equal(gate.accept(snap(5), 'reply'), true)
  assert.equal(gate.accept(snap(4), 'snapshot'), false)
  assert.equal(gate.accept(snap(5), 'reply'), true)
  // A different owner epoch is never ordered by revision; only a full owner
  // snapshot read may replace it, even if its revision number is lower.
  assert.equal(gate.accept(snap(1, 'epoch-b'), 'reply'), false)
  assert.equal(gate.accept(snap(1, 'epoch-b'), 'snapshot'), true)
  assert.equal(gate.current().owner_epoch, 'epoch-b')
})

test('focus change listeners are isolated and removable', () => {
  let a = 0, b = 0
  const stopA = subscribeFocusChanges(() => { a++; throw new Error('one bad view') })
  const stopB = subscribeFocusChanges(() => { b++ })
  notifyFocusChanged()
  assert.deepEqual([a, b], [1, 1])
  stopA()
  notifyFocusChanged()
  assert.deepEqual([a, b], [1, 2])
  stopB()
})

test('change signal carries revisions only and rejects unsafe numbers', () => {
  const ok = parseFocusChangeSignal({ version: 1, engine_revision: 3, queue_revision: 2,
    owner_epoch: 'e', process_generation: 1, command_id: null })
  assert.deepEqual(Object.keys(ok).sort(),
    ['command_id', 'engine_revision', 'owner_epoch', 'process_generation', 'queue_revision', 'version'])
  assert.equal(parseFocusChangeSignal({ version: 1, engine_revision: -1, queue_revision: 0,
    owner_epoch: 'e', process_generation: 1 }), null)
  assert.equal(parseFocusChangeSignal({ version: 1, engine_revision: Number.MAX_SAFE_INTEGER + 1,
    queue_revision: 0, owner_epoch: 'e', process_generation: 1 }), null)
  assert.equal(parseFocusChangeSignal({ version: 2 }), null)
})

test('tracker subscribes before loading and ignores a stale initial reply', async () => {
  const order = []
  let emit = null
  const pending = []
  const read = () => new Promise((resolve) => { order.push('read'); pending.push(resolve) })
  const subscribe = (cb) => { order.push('subscribe'); emit = cb; return () => { emit = null } }
  const seen = []
  const stop = trackFocusSnapshots({ read, subscribe, onSnapshot: (s) => seen.push(s.engine_revision) })
  assert.deepEqual(order, ['subscribe', 'read'])
  emit() // event lands while the initial load is still in flight
  assert.equal(pending.length, 2)
  pending[1](snap(12)) // event-triggered read answers first
  await new Promise((r) => setImmediate(r))
  pending[0](snap(11)) // initial read answers late with an older revision
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(seen, [12])
  stop()
  assert.equal(emit, null)
})

test('focus request errors keep typed code and client intent', () => {
  const command = { command_id: 'c', action: { kind: 'pause' } }
  const error = FocusRequestError.from({ code: 'conflict', message: 'stale revision' }, command)
  assert.equal(error.code, 'conflict')
  assert.equal(error.message, 'stale revision')
  assert.equal(error.command, command)
  assert.equal(FocusRequestError.from('boom').code, 'storage')
  assert.equal(FocusRequestError.from({ code: 'nope', message: 'x' }).code, 'invalid')
})

// ── Provider contracts (bundled like the other Vite SSR fixture tests) ──

let output, harness
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cache = path.join(root, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  output = await mkdtemp(path.join(cache, 'focus-provider-test-'))
  await build({ root, configFile: false, logLevel: 'error',
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { ssr: path.join(root, 'tests/fixtures/focusProviderHarness.ts'), outDir: output,
      emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'harness.mjs' } } } })
  harness = await import(pathToFileURL(path.join(output, 'harness.mjs')).href)
})
after(async () => { if (output) await rm(output, { recursive: true, force: true }) })

const cell = (v) => (v === null ? { type: 'null' } : { type: 'text', value: String(v) })
function pipelineReply(rowsPerStatement) {
  const body = { results: [
      ...rowsPerStatement.map((rows) => ({ type: 'ok', response: { type: 'execute', result: {
        cols: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [],
        rows: rows.map((r) => Object.values(r).map(cell)) } } })),
      { type: 'ok', response: { type: 'close' } },
    ] }
  return { ok: true, status: 200, text: async () => JSON.stringify(body) }
}
const config = { mode: 'count_up', budget_ms: null, work_ms: 0, break_ms: 0, rounds: 1 }
const replica = {
  version: 1, writer_device_id: 'mac', owner_epoch: 'epoch-a', revision: 9, queue_revision: 4,
  queue: [{ id: 'entry-1', task_id: 'task-1', occurrence_id: 'occ-1', added_at: '2026-09-22T00:00:00Z',
    source: { kind: 'today' }, explicit_still_open: false, config }],
  selected_occurrence_id: 'occ-1',
  occurrences: [
    { id: 'occ-1', task_id: 'task-1', original_task_id: 'task-1', title_snapshot: 'Write', generation: 1,
      state: 'open', created_at: '2026-09-22T00:00:00Z', completed_at: null, archived: 0 },
    { id: 'occ-0', task_id: null, original_task_id: 'task-0', title_snapshot: 'Done before', generation: 1,
      state: 'completed', created_at: '2026-09-21T00:00:00Z', completed_at: '2026-09-21T01:00:00Z', archived: 0 },
  ],
  sessions: [{ id: 'sess-1', occurrence_id: 'occ-1', status: 'paused', phase: 'work', work_ms: 60000,
    break_ms: 0, round_work_ms: 60000, round_break_ms: 0, round: 1, session_revision: 3,
    timezone_offset_minutes: 0, config_json: JSON.stringify(config), checkpoint_at: '2026-09-22T00:01:00Z' },
  { id: 'sess-0', occurrence_id: 'occ-0', status: 'ended', phase: 'work', work_ms: 30000,
    break_ms: 0, round_work_ms: 30000, round_break_ms: 0, round: 1, session_revision: 2,
    timezone_offset_minutes: 0, config_json: JSON.stringify(config), checkpoint_at: null }],
  import_totals: [{ id: 'imp-1', occurrence_id: 'occ-0', duration_ms: 5000, source_kind: 'fq' }],
  totals: { 'occ-1': 60000, 'occ-0': 35000 },
  as_of: '2026-09-22T00:02:00Z',
}
function mockReplicaFetch() {
  const calls = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    const sql = body.requests[0].stmt.sql
    calls.push(sql)
    if (sql.includes('focus_replica')) return pipelineReply([[{ payload_json: JSON.stringify(replica) }]])
    if (sql.includes('local_tasks')) return pipelineReply([[{ id: 'task-1', content: 'Write draft' }]])
    return pipelineReply([[]])
  }
  return calls
}

test('web focus is read-only with a reason and never fakes a write', async () => {
  const calls = mockReplicaFetch()
  const web = harness.createTursoProvider()
  const caps = await web.focus.capabilities()
  assert.deepEqual({ ...caps, reason: typeof caps.reason },
    { queue_read: true, queue_write: false, history_read: true, live_timing: false,
      companion: false, import: false, reason: 'string' })
  const command = { command_id: 'c1', expected_engine_revision: 9, expected_queue_revision: 4,
    owner_epoch: 'epoch-a', process_generation: 0, session_id: null, action: { kind: 'pause' } }
  await assert.rejects(web.focus.execute(command), (e) => {
    assert.equal(e.code, 'unsupported'); assert.equal(e.command, command); return true
  })
  await assert.rejects(web.focus.openCompanion(), (e) => e.code === 'unsupported')
  const files = { source_namespace: 'fixture', state_json: '{}', manual_json: null, pending_json: null }
  await assert.rejects(web.focus.previewImport(files), (e) => e.code === 'unsupported')
  await assert.rejects(web.focus.commitImport(files, 'token', 'c2'), (e) => e.code === 'unsupported')
  for (const legacy of ['startSession', 'endSession', 'getActive']) {
    assert.equal(legacy in web.focus, false, `legacy ${legacy} path is gone`)
  }
  assert.equal(calls.length, 0, 'writes and capabilities never touch the network')
})

test('web snapshot and history are real settled replica reads', async () => {
  mockReplicaFetch()
  const web = harness.createTursoProvider()
  const s = await web.focus.snapshot()
  assert.equal(s.replica, true)
  assert.equal(s.engine_revision, 9)
  assert.equal(s.queue_revision, 4)
  assert.equal(s.owner_epoch, 'epoch-a')
  assert.deepEqual(s.queue.map((e) => e.occurrence_id), ['occ-1'])
  assert.deepEqual(s.totals, { 'occ-1': 60000 })
  assert.equal(s.session.id, 'sess-1')
  assert.equal(s.session.status, 'paused')
  assert.equal(s.session.config.mode, 'count_up')
  const page = await web.focus.history()
  assert.deepEqual(page.rows.map((r) => [r.occurrence_id, r.total_ms, r.recorded_ms, r.imported_ms]),
    [['occ-1', 60000, 60000, 0], ['occ-0', 35000, 30000, 5000]])
  assert.equal(page.next_cursor, null)
  const filtered = await web.focus.history({ task_id: 'task-0' })
  assert.deepEqual(filtered.rows.map((r) => r.title), ['Done before'])
})

test('web history pages exactly like FocusService::history', async () => {
  // 52 occurrences: pairs share a timestamp so the id tie-break matters.
  const occurrences = []
  for (let n = 0; n < 52; n++) {
    const stamp = `2026-09-${String(10 + Math.floor(n / 2)).padStart(2, '0')}T00:00:00Z`
    occurrences.push({ id: `occ-${String(n).padStart(2, '0')}`, task_id: null,
      original_task_id: n % 2 ? 'odd' : 'even', title_snapshot: `T${n}`, generation: 1,
      state: 'completed', created_at: stamp, completed_at: n === 51 ? null : stamp, archived: 0 })
  }
  const big = { ...replica, queue: [], selected_occurrence_id: null, occurrences, sessions: [],
    import_totals: [], totals: {} }
  globalThis.fetch = async (_url, init) => {
    const sql = JSON.parse(init.body).requests[0].stmt.sql
    return pipelineReply(sql.includes('focus_replica') ? [[{ payload_json: JSON.stringify(big) }]] : [[]])
  }
  const web = harness.createTursoProvider()
  // SQL: ORDER BY COALESCE(completed_at,created_at) DESC, id DESC LIMIT 51.
  const expected = [...occurrences].sort((a, b) => {
    const ka = a.completed_at ?? a.created_at, kb = b.completed_at ?? b.created_at
    return ka === kb ? (a.id < b.id ? 1 : -1) : (ka < kb ? 1 : -1)
  }).map((o) => o.id)
  const first = await web.focus.history()
  assert.deepEqual(first.rows.map((r) => r.occurrence_id), expected.slice(0, 50))
  assert.equal(first.next_cursor, expected[49])
  const second = await web.focus.history({ cursor: first.next_cursor })
  assert.deepEqual(second.rows.map((r) => r.occurrence_id), expected.slice(50))
  assert.equal(second.next_cursor, null)
  // Cursor is positional, looked up without the task filter (as in SQL).
  const odd = await web.focus.history({ task_id: 'odd', cursor: 'occ-40' })
  assert.deepEqual(odd.rows.map((r) => r.occurrence_id),
    expected.slice(expected.indexOf('occ-40') + 1).filter((id) => Number(id.slice(4)) % 2 === 1))
  await assert.rejects(web.focus.history({ cursor: 'missing' }), (e) => e.code === 'invalid')
})

test('web snapshot without a synced replica is a typed not_found, not an empty queue', async () => {
  globalThis.fetch = async () => pipelineReply([[]])
  const web = harness.createTursoProvider()
  await assert.rejects(web.focus.snapshot(), (e) => e.code === 'not_found')
})

test('desktop provider sends exact commands and keeps intent on typed errors', async () => {
  const invoked = []
  let reply = null
  globalThis.window = globalThis.window ?? {}
  globalThis.window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => { invoked.push([cmd, args]); if (reply instanceof Error || reply?.code) throw reply; return reply },
    transformCallback: () => 0, unregisterCallback: () => {},
  }
  const desk = harness.createTauriProvider()
  const command = { command_id: 'c2', expected_engine_revision: 1, expected_queue_revision: 1,
    owner_epoch: 'e', process_generation: 2, session_id: null, action: { kind: 'resume' } }
  reply = { code: 'conflict', message: 'revision moved' }
  await assert.rejects(desk.focus.execute(command), (e) => {
    assert.ok(e instanceof harness.FocusRequestError)
    assert.equal(e.code, 'conflict'); assert.equal(e.command, command); return true
  })
  assert.deepEqual(invoked.at(-1), ['focus_execute', { command }])
  reply = { rows: [], next_cursor: null }
  await desk.focus.history({ cursor: 'occ-9', task_id: 'task-1' })
  assert.deepEqual(invoked.at(-1), ['focus_history', { cursor: 'occ-9', taskId: 'task-1' }])
  reply = undefined
  await desk.tasks.complete('task-1', '2026-09-22')
  assert.deepEqual(invoked.at(-1), ['complete_local_task', { id: 'task-1', expectedDueDate: '2026-09-22' }])
  await desk.tasks.complete('task-2', null)
  assert.deepEqual(invoked.at(-1), ['complete_local_task', { id: 'task-2', expectedDueDate: null }])
  await desk.tasks.updateStatus('task-3', 'complete', undefined, '2026-09-23')
  assert.deepEqual(invoked.at(-1),
    ['update_task_status', { id: 'task-3', status: 'complete', note: undefined, expectedDueDate: '2026-09-23' }])
})
