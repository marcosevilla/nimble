import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'

let output, h
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cache = path.join(root, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  output = await mkdtemp(path.join(cache, 'focus-store-test-'))
  await build({ root, configFile: false, logLevel: 'error',
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { ssr: path.join(root, 'tests/fixtures/focusStoreHarness.ts'), outDir: output,
      emptyOutDir: true, rollupOptions: { output: { entryFileNames: 'harness.mjs' } } } })
  h = await import(pathToFileURL(path.join(output, 'harness.mjs')).href)
})
after(async () => { if (output) await rm(output, { recursive: true, force: true }) })

const snap = (engine_revision, extra = {}) => ({
  queue_revision: engine_revision, engine_revision, owner_epoch: 'epoch-a', process_generation: 2,
  writer_device_id: 'mac', queue: [], selected_occurrence_id: null,
  session: { id: 'sess-1', occurrence_id: 'occ-1', status: 'paused', phase: 'work', work_ms: 0, break_ms: 0,
    round_work_ms: 0, round: 1, config: { mode: 'count_up', budget_ms: null, work_ms: 0, break_ms: 0, rounds: 1 } },
  totals: {}, as_of: '2026-09-22T00:00:00Z', checkpoint_at: null, recovery_reason: null, replica: false, ...extra,
})
const caps = (over = {}) => ({ queue_read: true, queue_write: true, history_read: true, live_timing: false,
  companion: false, import: false, reason: null, ...over })

/** A fake provider whose focus calls are scripted per test. */
function provider({ snapshots = [snap(5)], capabilities = caps(), execute } = {}) {
  const calls = { snapshot: 0, execute: [] }
  let i = 0
  const dp = { focus: {
    capabilities: async () => capabilities,
    snapshot: async () => { calls.snapshot++; const s = snapshots[Math.min(i++, snapshots.length - 1)]; return typeof s === 'function' ? s() : s },
    execute: async (command) => { calls.execute.push(command); return execute(command, calls.execute.length) },
  } }
  h.setDataProvider(dp)
  return calls
}

beforeEach(() => { h?.resetFocusCache() })

test('refresh loads capabilities and a full snapshot into the render cache', async () => {
  provider({ snapshots: [snap(5)] })
  const pending = h.refreshFocus()
  assert.equal(h.useFocusCache.getState().loading, true)
  await pending
  const s = h.useFocusCache.getState()
  assert.equal(s.loading, false)
  assert.equal(s.snapshot.engine_revision, 5)
  assert.equal(s.capabilities.queue_write, true)
  assert.equal(s.error, null)
})

test('the cache owns render state only — no independent elapsed accounting', () => {
  const s = h.useFocusCache.getState()
  const data = Object.keys(s).filter((k) => typeof s[k] !== 'function').sort()
  assert.deepEqual(data, ['capabilities', 'error', 'loading', 'pending', 'snapshot'])
})

test('connecting subscribes before the first read', async () => {
  const order = []
  const dp = { focus: {
    capabilities: async () => caps(),
    snapshot: async () => { order.push('read'); return snap(3) },
  } }
  h.setDataProvider(dp)
  const stop = h.connectFocusCache((cb) => { order.push('subscribe'); return () => {} })
  assert.deepEqual(order.slice(0, 2), ['subscribe', 'read'])
  await new Promise((r) => setImmediate(r))
  assert.equal(h.useFocusCache.getState().snapshot.engine_revision, 3)
  stop()
})

test('an invalidation re-reads and a late older read never overwrites a newer snapshot', async () => {
  let resolveFirst
  const first = new Promise((r) => { resolveFirst = r })
  provider({ snapshots: [() => first, snap(9)] })
  const stop = h.connectFocusCache()
  h.notifyFocusChanged() // event lands while the initial read is still in flight
  await new Promise((r) => setImmediate(r))
  assert.equal(h.useFocusCache.getState().snapshot.engine_revision, 9)
  resolveFirst(snap(4))
  await new Promise((r) => setImmediate(r))
  assert.equal(h.useFocusCache.getState().snapshot.engine_revision, 9)
  stop()
})

test('commands are built from the latest snapshot and the committed reply is applied', async () => {
  const calls = provider({ snapshots: [snap(5)], execute: (c) => ({ snapshot: snap(6), replayed: false, committed_revision: 6 }) })
  await h.refreshFocus()
  const reply = await h.sendFocusAction({ kind: 'pause' })
  assert.equal(reply.committed_revision, 6)
  const [command] = calls.execute
  assert.equal(typeof command.command_id, 'string')
  assert.ok(command.command_id.length > 0)
  assert.deepEqual({ ...command, command_id: 'x' }, { command_id: 'x', expected_engine_revision: 5,
    expected_queue_revision: 5, owner_epoch: 'epoch-a', process_generation: 2, session_id: 'sess-1',
    action: { kind: 'pause' } })
  const s = h.useFocusCache.getState()
  assert.equal(s.snapshot.engine_revision, 6)
  assert.equal(s.pending, null)
})

test('an uncertain transport failure retries the same command envelope and UUID', async () => {
  const calls = provider({ snapshots: [snap(5)], execute: (c, n) => {
    if (n === 1) throw new Error('IPC timed out') // transport: did it commit? unknown
    return { snapshot: snap(6), replayed: true, committed_revision: 6 }
  } })
  await h.refreshFocus()
  const reply = await h.sendFocusAction({ kind: 'pause' })
  assert.equal(reply.replayed, true)
  assert.equal(calls.execute.length, 2)
  assert.equal(calls.execute[1].command_id, calls.execute[0].command_id)
  assert.deepEqual(calls.execute[1], calls.execute[0])
})

test('a definite rejection is not retried; it surfaces and triggers a full re-read', async () => {
  const calls = provider({ snapshots: [snap(5), snap(8)], execute: () => { throw { code: 'conflict', message: 'revision moved' } } })
  await h.refreshFocus()
  await assert.rejects(h.sendFocusAction({ kind: 'pause' }), (e) => {
    assert.equal(e.code, 'conflict'); assert.equal(e.command.action.kind, 'pause'); return true
  })
  assert.equal(calls.execute.length, 1)
  await new Promise((r) => setImmediate(r))
  const s = h.useFocusCache.getState()
  assert.equal(s.error.code, 'conflict')
  assert.equal(s.snapshot.engine_revision, 8)
  assert.equal(s.pending, null)
})

test('a stale reply (older than a snapshot read meanwhile) is ignored', async () => {
  let release
  const calls = provider({ snapshots: [snap(5), snap(10)], execute: () => new Promise((r) => { release = r }) })
  await h.refreshFocus()
  const sent = h.sendFocusAction({ kind: 'enqueue', task_ids: ['a'], source: { kind: 'project', project_id: 'p' }, explicit_still_open: false })
  assert.equal(h.useFocusCache.getState().pending.kind, 'enqueue')
  await h.refreshFocus() // another window moved the engine to revision 10
  release({ snapshot: snap(6), replayed: false, committed_revision: 6 })
  await sent
  assert.equal(h.useFocusCache.getState().snapshot.engine_revision, 10)
  // The command carried the source captured at intent time.
  assert.deepEqual(calls.execute[0].action.source, { kind: 'project', project_id: 'p' })
})

test('a reply from a new owner epoch forces a full snapshot read', async () => {
  provider({ snapshots: [snap(5), snap(1, { owner_epoch: 'epoch-b' })],
    execute: () => ({ snapshot: snap(2, { owner_epoch: 'epoch-b' }), replayed: false, committed_revision: 2 }) })
  await h.refreshFocus()
  await h.sendFocusAction({ kind: 'pause' })
  await new Promise((r) => setImmediate(r))
  const s = h.useFocusCache.getState()
  assert.equal(s.snapshot.owner_epoch, 'epoch-b')
  assert.equal(s.snapshot.engine_revision, 1, 'full read wins, the cross-epoch reply is never applied')
})

test('writes are gated on capabilities and never reach execute when unsupported', async () => {
  const calls = provider({ snapshots: [snap(5)], capabilities: caps({ queue_write: false, reason: 'Read-only on the web.' }),
    execute: () => { throw new Error('must not run') } })
  await h.refreshFocus()
  await assert.rejects(h.sendFocusAction({ kind: 'pause' }), (e) => e.code === 'unsupported' && e.message === 'Read-only on the web.')
  assert.equal(calls.execute.length, 0)
})

test('actions that open a live segment wait for live timing; settling actions do not', async () => {
  const calls = provider({ snapshots: [snap(5)], capabilities: caps({ live_timing: false, reason: 'Live timing is not connected yet.' }),
    execute: () => ({ snapshot: snap(6), replayed: false, committed_revision: 6 }) })
  await h.refreshFocus()
  for (const action of [{ kind: 'start', occurrence_id: 'occ-1' }, { kind: 'resume' }, { kind: 'start_break' }]) {
    await assert.rejects(h.sendFocusAction(action), (e) => e.code === 'unsupported' && e.message === 'Live timing is not connected yet.')
  }
  assert.equal(calls.execute.length, 0)
  await h.sendFocusAction({ kind: 'stop' })
  assert.equal(calls.execute.length, 1)
})
