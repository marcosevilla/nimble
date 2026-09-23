// Focus card: rendered hierarchy from the Vite SSR fixture. Order is asserted
// on stable accessible labels in the rendered markup, never on source text.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

let output, rendered
before(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cache = path.join(root, 'node_modules/.cache')
  await mkdir(cache, { recursive: true })
  output = await mkdtemp(path.join(cache, 'focus-card-test-'))
  await build({ root, configFile: false, logLevel: 'error', plugins: [react()],
    resolve: { alias: { '@': path.join(root, 'src') } },
    build: { ssr: path.join(root, 'tests/fixtures/focusRender.tsx'), outDir: output, emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: 'render.mjs' } } } })
  rendered = await import(pathToFileURL(path.join(output, 'render.mjs')).href)
})
after(async () => { if (output) await rm(output, { recursive: true, force: true }) })

test('task identity precedes prominent timer and compact retains controls', () => {
  const html = rendered.renderCompactFocus()
  assert.ok(html.indexOf('Example task') < html.indexOf('Focus timer'))
  assert.match(html, /Start/); assert.match(html, /Show queue/)
  assert.doesNotMatch(html, /Up next/)
})

test('card order: completion, title, controls, metadata, inline subtask, timer left, Start right', () => {
  const html = rendered.renderFocusCard()
  const order = ['Complete Example task', 'Example task', 'Copy assistant context for Example task',
    'More actions for Example task', 'Hide queue',
    'Deep work', 'Complete Outline sections', 'Outline sections', 'Focus timer', 'aria-label="Start"']
    .map((label) => html.indexOf(label))
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x >= order[i - 1])), `order ${order}`)
})

test('title is multiline heading text, timer is tabular and paused total is shown', () => {
  const html = rendered.renderFocusCard()
  assert.match(html, /<h2\b[^>]*class="[^"]*text-title[^"]*"[^>]*>Example task<\/h2>/)
  assert.doesNotMatch(html.match(/<h2\b[^>]*>Example task/)?.[0] ?? '', /truncate/)
  const timer = html.match(/<button\b[^>]*aria-label="Focus timer[^"]*"[^>]*>[^<]*/)?.[0] ?? ''
  assert.match(timer, /text-timer/)
  assert.match(timer, /12:34/)
  assert.match(html, /25m timebox/)
})

test('live timing unavailable: Start is disabled with a visible reason, not hidden', () => {
  const html = rendered.renderFocusCard({ live: false })
  const start = html.match(/<button\b[^>]*aria-label="Start"[^>]*>/)?.[0]
  assert.ok(start)
  assert.match(start, /disabled=""/)
  assert.match(html, /Timing starts once the focus companion is ready/)
})

test('running session shows Pause; phases color by semantic tokens with overtime distinct', () => {
  const running = rendered.renderFocusCard({ running: true })
  assert.match(running, /aria-label="Pause"/)
  assert.match(rendered.renderFocusCard({ resumable: true }), /aria-label="Resume"/)
  const over = rendered.renderFocusCard({ overtimeMs: 30 * 60_000 })
  assert.match(over.match(/<button\b[^>]*aria-label="Focus timer[^"]*"[^>]*>/)?.[0] ?? '', /data-phase="overtime"[^>]*text-destructive|text-destructive[^>]*data-phase="overtime"/)
  const amber = rendered.renderFocusCard({ countUpMs: 30 * 60_000 })
  assert.match(amber.match(/<button\b[^>]*aria-label="Focus timer[^"]*"[^>]*>/)?.[0] ?? '', /text-warning/)
})

test('compact card-only mode unmounts queue, add, tray, drawer and footer tab stops', () => {
  const html = rendered.renderCompactFocus()
  for (const gone of ['Drag to reorder', 'Add task', '1 done', 'Still open', 'Add tasks from', 'to queue', 'All added', 'Nothing to add']) {
    assert.ok(!html.includes(gone), `${gone} is unmounted`)
  }
  assert.match(html, /Complete Outline sections/) // inline subtasks stay completable
})

test('assistant context is a visible secondary control on the card, not only in the menu', () => {
  const html = rendered.renderFocusCard()
  const button = html.match(/<button\b[^>]*aria-label="Copy assistant context for Example task"[^>]*>/)?.[0]
  assert.ok(button, 'copy control rendered')
  assert.doesNotMatch(button, /disabled=""/)
})

test('a queued task missing from storage keeps Remove, Skip and Show queue instead of an empty card', () => {
  const html = rendered.renderFocusCard({ missingTask: true })
  assert.match(html, /Task no longer available/)
  assert.doesNotMatch(html, /Queue is clear/)
  assert.match(html, /<button\b[^>]*>Remove from queue<\/button>/)
  assert.match(html, /<button\b[^>]*>Skip<\/button>/)
  assert.match(html, /aria-label="Hide queue"/)
  assert.doesNotMatch(html, /Focus timer/)
})
