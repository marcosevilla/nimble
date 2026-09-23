// Visible focus entry points on task rows and task detail (native fix 2).
// The menu/control model is pure; the row and detail controls render from
// a Vite SSR bundle with the real components.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { focusEntryErrorMessage, focusTaskControls, isFocusableTask, queuedEntryFor } from '../src/lib/focusTaskEntry.ts'
import { shallow } from 'zustand/vanilla/shallow'

const MIN = 60_000
const config = { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }
const entry = (n) => ({ id: `e${n}`, task_id: `t${n}`, occurrence_id: `o${n}`, added_at: '2026-09-22T08:00:00Z',
  source: { kind: 'today' }, explicit_still_open: false, config })
const snap = (over = {}) => ({
  queue_revision: 4, engine_revision: 9, owner_epoch: 'epoch', process_generation: 1, writer_device_id: 'mac',
  queue: [entry(1), entry(2)], selected_occurrence_id: 'o1', session: null,
  totals: {}, as_of: '2026-09-22T17:00:00Z', checkpoint_at: null, recovery_reason: null, replica: false, ...over,
})
const caps = (over = {}) => ({ queue_read: true, queue_write: true, history_read: true, live_timing: true,
  companion: true, import: false, reason: null, ...over })
const WEB = 'Focus runs on the desktop app.'

// ── queuedEntryFor ──

test('queuedEntryFor gives primitives for a queued task (selected or not), else null', () => {
  assert.deepEqual(queuedEntryFor(snap(), 't2'), { occurrence_id: 'o2', selected: false })
  assert.deepEqual(queuedEntryFor(snap(), 't1'), { occurrence_id: 'o1', selected: true })
  assert.equal(queuedEntryFor(snap(), 't9'), null)
  assert.equal(queuedEntryFor(null, 't1'), null)
})

test('queuedEntryFor is shallow-stable across heartbeat snapshots (rows do not re-render)', () => {
  const before = snap()
  const beat = snap({ totals: { o1: 5 * MIN }, as_of: '2026-09-22T17:00:20Z', checkpoint_at: '2026-09-22T17:00:20Z',
    engine_revision: 10, session: { id: 's', occurrence_id: 'o1', status: 'running', phase: 'work', work_ms: 0,
      break_ms: 0, round_work_ms: 0, round: 1, config } })
  for (const id of ['t1', 't2', 't9']) assert.ok(shallow(queuedEntryFor(before, id), queuedEntryFor(beat, id)), id)
})

// ── Control model ──

const controls = (over = {}) => focusTaskControls({ entry: null, capabilities: caps(), pending: false,
  focusNowBlocked: null, completed: false, ...over })

test('unqueued task: Add to focus queue + Focus now, both enabled, quiet add icon', () => {
  const c = controls()
  assert.equal(c.visible, true)
  assert.equal(c.queued, false)
  assert.equal(c.rowIcon, 'add')
  assert.deepEqual(c.toggle, { kind: 'enqueue', label: 'Add to focus queue', disabled: false, reason: null })
  assert.deepEqual(c.focusNow, { label: 'Focus now', disabled: false, reason: null })
})

test('queued (not selected): In focus queue, Remove replaces Add, row icon removes', () => {
  const c = controls({ entry: queuedEntryFor(snap(), 't2') })
  assert.equal(c.queued, true)
  assert.equal(c.status, 'In focus queue')
  assert.equal(c.rowIcon, 'remove')
  assert.deepEqual(c.toggle, { kind: 'remove', label: 'Remove from focus queue', disabled: false, reason: null, occurrence_id: 'o2' })
  assert.equal(c.focusNow.disabled, false)
})

test('queued and selected: the row icon is a non-removing indicator; the menu still offers Remove', () => {
  const c = controls({ entry: queuedEntryFor(snap(), 't1') })
  assert.equal(c.rowIcon, 'open')
  assert.equal(c.toggle.kind, 'remove')
})

test('completed task: no focus controls at all', () => {
  assert.equal(controls({ completed: true }).visible, false)
  assert.equal(controls({ completed: true, entry: queuedEntryFor(snap(), 't2') }).visible, false)
})

test('pending action disables every focus write with a visible reason', () => {
  const c = controls({ pending: true })
  assert.equal(c.toggle.disabled, true)
  assert.equal(c.focusNow.disabled, true)
  assert.match(c.toggle.reason, /saving/i)
})

test('no live timing: queueing stays enabled, Focus now is disabled with its blocked reason', () => {
  const reason = 'Timing starts once the focus companion is ready.'
  const c = controls({ capabilities: caps({ live_timing: false, reason }), focusNowBlocked: reason })
  assert.equal(c.toggle.disabled, false)
  assert.deepEqual(c.focusNow, { label: 'Focus now', disabled: true, reason })
})

test('read-only (web): writable is false and every write is disabled with the capability reason', () => {
  const c = controls({ capabilities: caps({ queue_write: false, live_timing: false, reason: WEB }), focusNowBlocked: WEB,
    entry: queuedEntryFor(snap(), 't2') })
  assert.equal(c.writable, false)
  assert.deepEqual([c.toggle.disabled, c.toggle.reason], [true, WEB])
  assert.deepEqual([c.focusNow.disabled, c.focusNow.reason], [true, WEB])
})

test('capabilities still loading: writes are disabled, never guessed', () => {
  const c = controls({ capabilities: null, focusNowBlocked: 'Focus is still loading.' })
  assert.equal(c.toggle.disabled, true)
  assert.equal(c.focusNow.disabled, true)
})

test('engine errors map to friendly copy, never raw engine text', () => {
  const raw = 'completed task requires explicit still-open choice'
  for (const code of ['stale_occurrence', 'not_found', 'conflict', 'wrong_owner', 'storage', 'invalid', 'needs_review', undefined]) {
    const msg = focusEntryErrorMessage({ code, message: raw })
    assert.ok(msg && !msg.includes(raw), `${code}: ${msg}`)
  }
  assert.equal(focusEntryErrorMessage({ code: 'unsupported', message: WEB }), WEB)
})

// ── Rendered row + detail controls ──

let output, rendered, harness
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cache = path.join(root, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  output = await mkdtemp(path.join(cache, 'focus-entry-test-'))
  await build({ root, configFile: false, logLevel: 'error', plugins: [react()],
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { ssr: path.join(root, 'tests/fixtures/focusEntryRender.tsx'), outDir: output, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'render.mjs' } } } })
  rendered = await import(pathToFileURL(path.join(output, 'render.mjs')).href)
  await build({ root, configFile: false, logLevel: 'error', plugins: [react()],
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { ssr: path.join(root, 'tests/fixtures/focusEntryActionsHarness.ts'), outDir: path.join(output, 'h'), emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'harness.mjs' } } } })
  harness = await import(pathToFileURL(path.join(output, 'h/harness.mjs')).href)
})
after(async () => { if (output) await rm(output, { recursive: true, force: true }) })

const buttonWith = (html, label) => html.match(new RegExp(`<button\\b[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? null

test('row: unqueued shows a quiet, labelled Add to focus queue icon and a More actions trigger', () => {
  const html = rendered.renderRow({ queued: false })
  const add = buttonWith(html, 'Add to focus queue')
  assert.ok(add, 'add button present')
  assert.match(add, /opacity-0/) // quiet until hover/focus
  assert.match(add, /group-hover:opacity-100/)
  assert.match(add, /focus-visible:opacity-100/)
  assert.ok(buttonWith(html, 'More actions for Row task'))
})

test('row: while a focus write is pending the hidden add icon stays quiet (aria-disabled, never native disabled)', () => {
  const add = buttonWith(rendered.renderRow({ queued: false, pending: true }), 'Add to focus queue')
  assert.ok(add)
  assert.match(add, /aria-disabled="true"/)
  assert.doesNotMatch(add, /\sdisabled(=|\s|>)/)
  assert.doesNotMatch(add, /disabled:opacity/)
  assert.match(add, /opacity-0/)
})

test('row: queued (not selected) shows a persistent In focus queue icon whose action removes', () => {
  const html = rendered.renderRow({ queued: 'upcoming' })
  const queued = buttonWith(html, 'In focus queue, remove from focus queue')
  assert.ok(queued, 'queued button present')
  assert.match(queued, /aria-pressed="true"/)
  assert.doesNotMatch(queued, /opacity-0/)
  assert.equal(buttonWith(html, 'Add to focus queue'), null)
})

test('row: the selected entry is a non-removing indicator that opens the queue', () => {
  const html = rendered.renderRow({ queued: 'selected' })
  assert.ok(buttonWith(html, 'In focus queue \\(current\\), open focus queue'))
  assert.equal(buttonWith(html, 'In focus queue, remove from focus queue'), null)
})

test('row: read-only capabilities (web) hide the row focus actions entirely', () => {
  const html = rendered.renderRow({ queued: false, readOnly: true })
  assert.equal(buttonWith(html, 'Add to focus queue'), null)
  assert.equal(buttonWith(html, 'More actions for Row task'), null)
})

test('row: a completed task shows no focus actions', () => {
  const html = rendered.renderRow({ queued: 'upcoming', completed: true })
  assert.doesNotMatch(html, /focus queue/)
  assert.equal(buttonWith(html, 'More actions for Row task'), null)
})

test('row markup never nests a button inside a button', () => {
  for (const html of [rendered.renderRow({ queued: false }), rendered.renderRow({ queued: 'upcoming' }), rendered.renderRow({ queued: 'selected' })]) {
    assert.equal(nestedButton(html), false)
  }
})

test('detail: unqueued shows Add to focus queue primary and Focus now secondary', () => {
  const html = rendered.renderDetail({ queued: false })
  assert.ok(html.indexOf('Add to focus queue') >= 0)
  assert.ok(html.indexOf('Add to focus queue') < html.indexOf('Focus now'))
  assert.equal(nestedButton(html), false)
})

test('detail: queued shows In focus queue with Remove, Focus now stays', () => {
  const html = rendered.renderDetail({ queued: 'upcoming' })
  assert.match(html, /In focus queue/)
  assert.match(html, /Remove from focus queue/)
  assert.match(html, /Focus now/)
  assert.doesNotMatch(html, />Add to focus queue</)
})

test('detail: a completed task renders no Focus control', () => {
  assert.equal(rendered.renderDetail({ queued: 'upcoming', completed: true }), '')
})

test('detail: blocked Focus now is visible, disabled and explains why', () => {
  const html = rendered.renderDetail({ queued: false, focusNowBlocked: 'Timing starts once the focus companion is ready.' })
  const btn = html.match(/<button\b[^>]*>(?:(?!<\/button>).)*Focus now(?:(?!<\/button>).)*<\/button>/s)?.[0] ?? ''
  assert.match(btn, /disabled/)
  assert.match(html, /Timing starts once the focus companion is ready\./)
})

test('bulk action bar renders no button inside a button', () => {
  assert.equal(nestedButton(rendered.renderBulkBar()), false)
  assert.match(rendered.renderBulkBar(), /Focus/)
})

/** True when any <button> opens before the previous one closes. */
function nestedButton(html) {
  let depth = 0
  for (const m of html.matchAll(/<(\/?)button\b/g)) {
    if (m[1]) depth--
    else if (++depth > 1) return true
  }
  return false
}

// ── Row `f` shortcut / command bar Focus now ──

const shortcutTask = (over = {}) => ({ id: 't9', sync_policy: 'default', due_date: null, project_id: 'inbox',
  completed: false, status: 'todo', ...over })

/** Fake provider: records executes; `execute` rejects with a raw engine error. */
function engineProvider(execute) {
  const calls = []
  harness.resetFocusCache()
  harness.setDataProvider({ focus: {
    capabilities: async () => caps(),
    snapshot: async () => snap(),
    execute: async (command) => { calls.push(command.action); return execute(command) },
  } })
  return calls
}

test('isFocusableTask: completed or status complete is not focusable', () => {
  assert.equal(isFocusableTask({ completed: false, status: 'todo' }), true)
  assert.equal(isFocusableTask({ completed: true, status: 'todo' }), false)
  assert.equal(isFocusableTask({ completed: false, status: 'complete' }), false)
})

test('f on a completed row is a quiet no-op: no provider write, no toast', async () => {
  const calls = engineProvider(() => { throw new Error('should not run') })
  const toasts = []
  for (const over of [{ completed: true }, { status: 'complete' }]) {
    assert.equal(await harness.focusNowForTask(shortcutTask(over), (m) => toasts.push(m)), 'skipped')
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(toasts, [])
})

test('f failure toasts friendly copy, never the raw engine text', async () => {
  const raw = 'completed task requires explicit still-open choice'
  engineProvider(() => { throw { code: 'stale_occurrence', message: raw } })
  const toasts = []
  assert.equal(await harness.focusNowForTask(shortcutTask(), (m) => toasts.push(m)), 'failed')
  assert.equal(toasts.length, 1)
  assert.doesNotMatch(toasts[0], /still-open/)
  assert.equal(toasts[0], focusEntryErrorMessage({ code: 'stale_occurrence' }))
})
