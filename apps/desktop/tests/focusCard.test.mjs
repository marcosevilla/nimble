// Focus card: rendered hierarchy from the Vite SSR fixture. Order is asserted
// on stable accessible labels in the rendered markup, never on source text.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { cardCaption, focusPanelMenuItems, taskMenuItems } from '../src/lib/focusQueueIntents.ts'

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

test('task identity precedes prominent timer and compact keeps the header + and ⋯', () => {
  const html = rendered.renderCompactFocus()
  assert.ok(html.indexOf('Example task') < html.indexOf('Focus timer'))
  assert.match(html, /Start/)
  // Card-only mode keeps the surface header: add and the menu with "Show queue".
  assert.match(html, /<button\b[^>]*aria-label="Add to queue"/)
  assert.match(html, /<button\b[^>]*aria-label="Focus options"/)
  assert.equal(focusPanelMenuItems({ compact: true, soundMuted: false, canMute: false, syncNote: null })
    .find((i) => i.kind === 'toggle_queue')?.label, 'Show queue')
  assert.doesNotMatch(html, /Up next/)
})

test('card order: place label, completion, title, description, actions, inline subtask, timer, caption, Start', () => {
  const html = rendered.renderFocusCard()
  const order = ['Deep work / Writing', 'Complete Example task', '>Example task</h2>', 'Draft the outline',
    'More actions for Example task', 'Complete Outline sections', 'Outline sections', 'Focus timer', '25m timebox', '2:00 PM',
    'aria-label="Start"']
    .map((label) => html.indexOf(label))
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x >= order[i - 1])), `order ${order}`)
})

test('nothing sits beside the title: no copy button and no queue toggle on the card', () => {
  const html = rendered.renderFocusCard()
  assert.doesNotMatch(html, /Copy assistant context for/)
  assert.doesNotMatch(html, /Hide queue|Show queue/)
  const h2 = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/)?.[0] ?? ''
  assert.doesNotMatch(h2, /<button/)
})

test('task ⋯ is revealed on card hover, keyboard focus or while open, and follows the title in Tab order', () => {
  const html = rendered.renderFocusCard()
  const section = html.match(/<section\b[^>]*aria-label="Focused task"[^>]*>/)?.[0] ?? ''
  assert.match(section, /group\/card/)
  const wrapper = html.match(/<div\b[^>]*class="([^"]*)"[^>]*><button\b[^>]*aria-label="More actions for Example task"/)?.[1] ?? ''
  for (const cls of ['absolute', 'opacity-0', 'group-hover/card:opacity-100', 'focus-within:opacity-100', 'has-[[data-popup-open]]:opacity-100']) {
    assert.ok(wrapper.split(/\s+/).includes(cls), `${cls} in ${wrapper}`)
  }
  assert.ok(html.indexOf('>Example task</h2>') < html.indexOf('More actions for Example task'))
})

test('copy assistant context moved into the task menu, first', () => {
  const card = taskMenuItems({ sync_policy: 'default' }, 'card')
  assert.equal(card[0].id, 'copy_context')
  assert.equal(card[0].label, 'Copy assistant context')
})

test('title is multiline heading text, timer is tabular (one step under display) and paused total is shown', () => {
  const html = rendered.renderFocusCard()
  assert.match(html, /<h2\b[^>]*class="[^"]*text-title[^"]*"[^>]*>Example task<\/h2>/)
  assert.doesNotMatch(html.match(/<h2\b[^>]*>Example task/)?.[0] ?? '', /truncate/)
  const timer = html.match(/<button\b[^>]*aria-label="Focus timer[^"]*"[^>]*>[^<]*/)?.[0] ?? ''
  assert.match(timer, /\btext-timer-sm\b/)
  assert.match(timer, /12:34/)
})

test('one caption line under the timer joins the budget, priority and due', () => {
  const html = rendered.renderFocusCard()
  const caption = html.match(/<div\b[^>]*data-slot="focus-timer-caption"[^>]*>[\s\S]*?<\/div><\/div>/)?.[0] ?? ''
  assert.ok(caption, 'caption rendered')
  assert.match(caption, /25m timebox/)
  assert.match(caption, /aria-label="Priority 3"/)
  assert.match(caption, /2:00 PM/)
  assert.ok(caption.indexOf('25m timebox') < caption.indexOf('Priority 3') && caption.indexOf('Priority 3') < caption.indexOf('2:00 PM'))
  assert.deepEqual(cardCaption(null, { sync_policy: 'local_only', due_date: null, due_time: null }, '2026-09-22'), { timing: null, meta: 'Nimble only' })
  assert.deepEqual(cardCaption('Round 1 of 4', { sync_policy: 'default', due_date: null, due_time: null }, '2026-09-22'), { timing: 'Round 1 of 4', meta: null })
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

test('compact card-only mode unmounts queue and tray tab stops; no footer rows exist in any mode', () => {
  const html = rendered.renderCompactFocus()
  for (const gone of ['Drag to reorder', '1 done', 'Up next']) {
    assert.ok(!html.includes(gone), `${gone} is unmounted`)
  }
  assert.match(html, /Complete Outline sections/) // inline subtasks stay completable
  for (const tray of [html, rendered.renderQueueTray()]) {
    for (const gone of ['Still open', 'Add tasks from', 'From: ', 'Add all', '>Add task<', 'Nothing to add', 'All added']) {
      assert.ok(!tray.includes(gone), `${gone} is not a tray row`)
    }
  }
})

test('a queued task missing from storage keeps Remove and Skip instead of an empty card', () => {
  const html = rendered.renderFocusCard({ missingTask: true })
  assert.match(html, /Task no longer available/)
  assert.doesNotMatch(html, /Queue is clear/)
  assert.match(html, /<button\b[^>]*>Remove from queue<\/button>/)
  assert.match(html, /<button\b[^>]*>Skip<\/button>/)
  assert.doesNotMatch(html, /Focus timer/)
})


// ── Checklist H1 design asks (2026-09-23): place label above the title, one-line description ──

test('project / section label sits above the title as a small muted label', () => {
  const html = rendered.renderFocusCard()
  const label = html.match(/<p\b[^>]*data-slot="focus-place"[^>]*>[^<]*<\/p>/)?.[0] ?? ''
  assert.match(label, />Deep work \/ Writing</)
  assert.match(label, /text-label/)
  assert.match(label, /text-muted-foreground/)
  assert.ok(html.indexOf('data-slot="focus-place"') < html.indexOf('>Example task</h2>'))
  // The label replaces the project in the metadata line (no duplicate).
  assert.equal(html.split('Deep work').length - 1, 1)
})

test('no place label and no description row when the task has neither', () => {
  const html = rendered.renderFocusCard({ plain: true })
  assert.doesNotMatch(html, /data-slot="focus-place"/)
  assert.doesNotMatch(html, /data-slot="focus-description"/)
  assert.doesNotMatch(html, /See more/)
})

test('description renders below the title as escaped plain text clamped to one line, no toggle until it overflows', () => {
  const html = rendered.renderFocusCard()
  const desc = html.match(/<p\b[^>]*data-slot="focus-description"[^>]*>[^<]*<\/p>/)?.[0] ?? ''
  assert.ok(desc, 'description rendered')
  assert.match(desc, /line-clamp-1/)
  assert.match(desc, /&lt;b&gt;first&lt;\/b&gt;/, 'markup is text, never HTML')
  assert.match(desc, /\[notes\]\(https:\/\/example\.com\)/, 'markdown stays plain text')
  assert.ok(html.indexOf('>Example task</h2>') < html.indexOf('data-slot="focus-description"'))
  assert.doesNotMatch(html, /See more/, 'no button until measured overflowing')
})

test('compact companion card keeps the place label and one-line description', () => {
  const html = rendered.renderCompactFocus()
  assert.match(html, /data-slot="focus-place"[^>]*>Deep work \/ Writing</)
  assert.match(html, /data-slot="focus-description"/)
})
