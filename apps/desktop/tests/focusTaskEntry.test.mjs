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
import { focusTaskControls, queuedEntryFor } from '../src/lib/focusTaskEntry.ts'

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

test('queuedEntryFor finds the queue entry for a task, else null', () => {
  assert.equal(queuedEntryFor(snap(), 't2')?.occurrence_id, 'o2')
  assert.equal(queuedEntryFor(snap(), 't9'), null)
  assert.equal(queuedEntryFor(null, 't1'), null)
})

// ── Control model ──

test('unqueued task: Add to focus queue + Focus now, both enabled', () => {
  const c = focusTaskControls({ snapshot: snap(), capabilities: caps(), pending: false, focusNowBlocked: null, taskId: 't9' })
  assert.equal(c.queued, false)
  assert.equal(c.entry, null)
  assert.deepEqual(c.toggle, { kind: 'enqueue', label: 'Add to focus queue', disabled: false, reason: null })
  assert.deepEqual(c.focusNow, { label: 'Focus now', disabled: false, reason: null })
})

test('queued task: In focus queue state, Remove replaces Add, Focus now stays', () => {
  const c = focusTaskControls({ snapshot: snap(), capabilities: caps(), pending: false, focusNowBlocked: null, taskId: 't2' })
  assert.equal(c.queued, true)
  assert.equal(c.status, 'In focus queue')
  assert.deepEqual(c.toggle, { kind: 'remove', label: 'Remove from focus queue', disabled: false, reason: null, occurrence_id: 'o2' })
  assert.equal(c.focusNow.label, 'Focus now')
  assert.equal(c.focusNow.disabled, false)
})

test('pending action disables every focus write with a visible reason', () => {
  const c = focusTaskControls({ snapshot: snap(), capabilities: caps(), pending: true, focusNowBlocked: null, taskId: 't9' })
  assert.equal(c.toggle.disabled, true)
  assert.equal(c.focusNow.disabled, true)
  assert.match(c.toggle.reason, /saving/i)
})

test('no live timing: queueing stays enabled, Focus now is disabled with its blocked reason', () => {
  const reason = 'Timing starts once the focus companion is ready.'
  const c = focusTaskControls({ snapshot: snap(), capabilities: caps({ live_timing: false, reason }), pending: false,
    focusNowBlocked: reason, taskId: 't9' })
  assert.equal(c.toggle.disabled, false)
  assert.deepEqual(c.focusNow, { label: 'Focus now', disabled: true, reason })
})

test('read-only (web): every write is disabled with the capability reason, and writable is false', () => {
  const c = focusTaskControls({ snapshot: snap(), capabilities: caps({ queue_write: false, live_timing: false, reason: WEB }),
    pending: false, focusNowBlocked: WEB, taskId: 't2' })
  assert.equal(c.writable, false)
  assert.equal(c.queued, true) // still shows the read-only state
  assert.deepEqual([c.toggle.disabled, c.toggle.reason], [true, WEB])
  assert.deepEqual([c.focusNow.disabled, c.focusNow.reason], [true, WEB])
})

test('capabilities still loading: writes are disabled, never guessed', () => {
  const c = focusTaskControls({ snapshot: null, capabilities: null, pending: false, focusNowBlocked: 'Focus is still loading.', taskId: 't1' })
  assert.equal(c.queued, false)
  assert.equal(c.toggle.disabled, true)
  assert.equal(c.focusNow.disabled, true)
})

// ── Rendered row + detail controls ──

let output, rendered
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

test('row: queued shows a persistent In focus queue icon whose action removes', () => {
  const html = rendered.renderRow({ queued: true })
  const queued = buttonWith(html, 'In focus queue, remove from focus queue')
  assert.ok(queued, 'queued button present')
  assert.match(queued, /aria-pressed="true"/)
  assert.doesNotMatch(queued, /opacity-0/)
  assert.equal(buttonWith(html, 'Add to focus queue'), null)
})

test('row: read-only capabilities hide the write icon but keep the menu trigger', () => {
  const html = rendered.renderRow({ queued: false, readOnly: true })
  assert.equal(buttonWith(html, 'Add to focus queue'), null)
  assert.ok(buttonWith(html, 'More actions for Row task'))
})

test('row markup never nests a button inside a button', () => {
  for (const html of [rendered.renderRow({ queued: false }), rendered.renderRow({ queued: true })]) {
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
  const html = rendered.renderDetail({ queued: true })
  assert.match(html, /In focus queue/)
  assert.match(html, /Remove from focus queue/)
  assert.match(html, /Focus now/)
  assert.doesNotMatch(html, />Add to focus queue</)
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
