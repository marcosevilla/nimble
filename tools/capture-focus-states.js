// Focus review-state capture (spec §4 visual review set) — mock-tauri backend,
// vite dev server, Playwright WebKit (closest engine to the native WKWebView).
//
// Usage (from the repo root, with `npx vite --port 5217 --strictPort` running
// in apps/desktop):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   OUT=/path/to/output-folder node tools/capture-focus-states.js
//
// Synthetic data only: tools/mock-tauri.js plus the in-page focus engine stub
// below. Nothing here talks to a real profile, Todoist or the network.
const fs = require('fs')
const path = require('path')
const { webkit } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core')

const BASE = process.env.BASE || 'http://localhost:5217'
const OUT = process.env.OUT
if (!OUT) throw new Error('Set OUT to the capture folder')
fs.mkdirSync(OUT, { recursive: true })
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-tauri.js'), 'utf8')

// Runs after mock-tauri.js: a small stateful focus engine for the harness.
function focusStub(scenario) {
  var S = scenario
  var core = window.__TAURI_INTERNALS__
  var base = core.invoke
  var pad = function (n) { return String(n).padStart(2, '0') }
  var d = new Date()
  var TODAY = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  var MIN = 60000
  var rev = 1
  var cfg = function (mode, budget) {
    return { mode: mode || 'count_up', budget_ms: budget || null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 }
  }
  var queue = (S.queue || []).map(function (q, i) {
    return { id: 'entry-' + i, task_id: q.task, occurrence_id: 'occ-' + q.task, added_at: new Date().toISOString(),
      source: { kind: 'today' }, explicit_still_open: false, config: cfg(q.mode, q.budget) }
  })
  var totals = {}
  ;(S.queue || []).forEach(function (q) { totals['occ-' + q.task] = q.ms || 0 })
  var session = null
  if (S.running != null && queue.length) {
    var e = queue[0]
    session = { id: 'session-1', occurrence_id: e.occurrence_id, status: S.running ? 'running' : 'paused', phase: 'work',
      work_ms: totals[e.occurrence_id], break_ms: 0, round_work_ms: totals[e.occurrence_id], round: 1, config: e.config }
  }
  var history = (S.history || []).map(function (h, i) {
    return { occurrence_id: 'hist-' + i, task_id: null, title: h.title, total_ms: h.ms, recorded_ms: h.ms, imported_ms: 0,
      completed_at: new Date(Date.now() - (i + 1) * 40 * MIN).toISOString(), archived: false }
  })
  var caps = S.caps === 'readonly'
    ? { queue_read: true, queue_write: false, history_read: true, live_timing: false, companion: false, import: false,
        reason: 'Another Nimble process holds this profile, so this window is read-only.' }
    : { queue_read: true, queue_write: true, history_read: true, live_timing: true, companion: true, import: true, reason: null }
  var snap = function () {
    return { queue_revision: rev, engine_revision: rev, owner_epoch: 'mock', process_generation: 1, writer_device_id: 'mock',
      queue: queue.slice(), selected_occurrence_id: queue[0] ? queue[0].occurrence_id : null, session: session,
      totals: Object.assign({}, totals), as_of: new Date().toISOString(), checkpoint_at: new Date().toISOString(),
      recovery_reason: null, replica: false }
  }
  var LOCAL_ONLY = { 'task-04': 1, 'task-06': 1, 'task-12': 1 }
  var patchTask = function (t) {
    if (!t || typeof t !== 'object') return t
    t.sync_policy = LOCAL_ONLY[t.id] ? 'local_only' : 'default'
    if (t.due_date === '2026-08-01') t.due_date = TODAY
    if (t.id === 'task-01' && S.longTitle) {
      t.content = 'Rewrite the onboarding case study so the research, the flows and the final visual pass read as one story'
    }
    return t
  }
  var monitor = { name: 'Synthetic', position: { x: 0, y: 0 }, size: { width: 1512, height: 982 },
    workArea: { position: { x: 0, y: 25 }, size: { width: 1512, height: 957 } }, scaleFactor: 1 }
  window.__focusGeometry = null
  core.invoke = function (cmd, args) {
    if (cmd === 'focus_capabilities') return Promise.resolve(caps)
    if (cmd === 'focus_snapshot') {
      if (S.loading) return new Promise(function () {})
      if (S.failSnapshot) return Promise.reject({ code: 'storage', message: 'database is locked' })
      return Promise.resolve(snap())
    }
    if (cmd === 'focus_history') return Promise.resolve({ rows: history, next_cursor: null })
    if (cmd === 'focus_companion_apply_geometry') { window.__focusGeometry = args && args.geometry; return Promise.resolve(null) }
    if (cmd === 'plugin:window|current_monitor' || cmd === 'plugin:window|primary_monitor') return Promise.resolve(monitor)
    if (cmd === 'plugin:window|scale_factor') return Promise.resolve(1)
    if (cmd === 'plugin:window|outer_position') return Promise.resolve({ x: 1100, y: 60 })
    if (cmd === 'plugin:window|inner_size') return Promise.resolve({ width: innerWidth, height: innerHeight })
    if (cmd === 'plugin:window|outer_size') return Promise.resolve({ width: innerWidth, height: innerHeight + 32 })
    if (cmd === 'get_setting') {
      var key = args && args.key
      if (key === 'focus_companion_compact') return Promise.resolve(S.compact ? 'true' : 'false')
      if (key === 'focus_companion_compact_width') return Promise.resolve(String(S.compactWidth || 340))
      if (key === 'focus_companion_expanded_height') return Promise.resolve(String(S.expandedHeight || 560))
      if (key === 'focus_sound_muted') return Promise.resolve('false')
    }
    if (cmd === 'delete_local_task') {
      queue = queue.filter(function (e) { return e.task_id !== (args && args.id) })
      rev++
      return base(cmd, args).then(function () { return { undo_token: 'undo-synthetic' } })
    }
    if (cmd === 'focus_execute') {
      var a = args.command.action
      if (a.kind === 'pause' && session) session.status = 'paused'
      if ((a.kind === 'resume' || a.kind === 'start') && session) session.status = 'running'
      if (a.kind === 'remove') queue = queue.filter(function (e) { return e.occurrence_id !== a.occurrence_id })
      rev++
      return Promise.resolve({ snapshot: snap(), replayed: false, committed_revision: rev })
    }
    var result = base(cmd, args)
    if (cmd === 'get_local_tasks' || cmd === 'get_local_task') {
      return result.then(function (r) { return Array.isArray(r) ? r.map(patchTask) : patchTask(r) })
    }
    return result
  }
}

const QUEUE = [
  { task: 'task-01', ms: 12 * 60000 + 41000 },
  { task: 'task-04', ms: 0 },
  { task: 'task-06', ms: 4 * 60000, mode: 'timebox', budget: 25 * 60000 },
  { task: 'task-07', ms: 0 },
  { task: 'task-12', ms: 0 },
  { task: 'task-05', ms: 0 },
]
const HISTORY = [
  { title: 'Reply to Fillmore photo pass email', ms: 9 * 60000 + 12000 },
  { title: 'Pay quarterly estimated taxes', ms: 31 * 60000 + 5000 },
]
const LOCAL_FIRST = [{ task: 'task-04', ms: 3 * 60000 + 20000 }, ...QUEUE.filter((q) => q.task !== 'task-04' && q.task !== 'task-01')]

const COMPANION = { width: 340, height: 560 }

async function open(browser, scenario, { mode, accent, url = '/?window=focus', viewport = COMPANION }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: mode })
  await context.addInitScript(({ mode, accent }) => {
    try {
      localStorage.setItem('theme', mode)
      localStorage.setItem('accent_theme', accent)
    } catch {}
  }, { mode, accent })
  await context.addInitScript(MOCK)
  await context.addInitScript(focusStub, scenario)
  const page = await context.newPage()
  await page.goto(BASE + url, { waitUntil: 'load' })
  await page.evaluate(({ mode, accent }) => {
    const root = document.documentElement
    root.classList.toggle('dark', mode === 'dark')
    for (const c of [...root.classList]) if (c.startsWith('theme-')) root.classList.remove(c)
    root.classList.add('theme-' + accent)
  }, { mode, accent })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
  return { context, page }
}

// Resize the viewport to the geometry the companion asked the native window for.
async function followGeometry(page) {
  const g = await page.evaluate(() => window.__focusGeometry)
  if (g && g.width && g.height) {
    await page.setViewportSize({ width: Math.round(g.width), height: Math.round(g.height) })
    await page.waitForTimeout(500)
  }
  return g
}

const shots = []
async function shoot(page, name, meta) {
  await page.waitForTimeout(350)
  const file = `${name}.png`
  await page.screenshot({ path: path.join(OUT, file) })
  shots.push({ file, ...meta })
  console.log('shot', file)
}

async function run() {
  const browser = await webkit.launch(process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {})
  const modes = ['light', 'dark']
  const accents = ['warm', 'ocean', 'rose', 'mono', 'forest', 'runner']

  for (const mode of modes) {
    const accent = 'warm'
    const t = (s) => `${s}-${mode}`
    const meta = (state, note) => ({ state, mode, accent, note })

    // 1. Narrow expanded queue, running count-up.
    let { context, page } = await open(browser, { queue: QUEUE, running: true, history: HISTORY }, { mode, accent })
    await shoot(page, t('01-expanded-running'), meta('Narrow expanded queue (340×560), running', 'Header (+, ⋯), card, timer, Up next, completed tray'))
    // 5. Timebox picker.
    await page.getByRole('button', { name: /^Focus timer/ }).first().click()
    await shoot(page, t('05-timebox-picker'), meta('Timebox picker', 'Presets, custom minutes, count-up'))
    await page.keyboard.press('Escape')
    // 8. The header + panel (quick add, source + Add all, still open), then its source menu.
    await page.getByRole('button', { name: 'Add to queue' }).first().click()
    await page.waitForTimeout(300)
    await shoot(page, t('08a-add-panel'), meta('Header + panel', 'Quick add, source with Add all, still-open list'))
    await page.getByRole('button', { name: /^Add tasks from:/ }).first().click()
    await shoot(page, t('08b-add-source-menu'), meta('+ panel source menu', 'Today, Nimble only, projects'))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    // 8c. The surface ⋯ (queue toggle, mute; Pop out in the main window).
    await page.getByRole('button', { name: 'Focus options' }).first().click()
    await shoot(page, t('08c-surface-menu'), meta('Surface ⋯ menu', 'Show/Hide queue, Mute sounds'))
    await page.keyboard.press('Escape')
    await context.close()

    // Overtime / amber timer semantics.
    ;({ context, page } = await open(browser, {
      queue: [{ task: 'task-06', ms: 27 * 60000 + 9000, mode: 'timebox', budget: 25 * 60000 }, ...QUEUE.slice(3)],
      running: true, history: HISTORY,
    }, { mode, accent }))
    await shoot(page, t('02-timebox-overtime'), meta('Timebox overtime', 'Red is reserved for overtime'))
    await context.close()
    ;({ context, page } = await open(browser, {
      queue: [{ task: 'task-07', ms: 47 * 60000 + 3000 }, ...QUEUE.slice(3)], running: false, history: HISTORY,
    }, { mode, accent }))
    await shoot(page, t('03-countup-deep-amber-paused'), meta('Count-up 47 min, paused', 'Deep amber, never red'))
    await context.close()

    // 3/4. Compact long-title + subtasks, then scaled.
    for (const [name, width, label] of [['04a-compact-long-title', 340, '1×'], ['04b-compact-scaled', 680, '2×']]) {
      ;({ context, page } = await open(browser, { queue: QUEUE, running: true, history: HISTORY, compact: true, compactWidth: width, longTitle: true }, { mode, accent }))
      const g = await followGeometry(page)
      await shoot(page, t(name), meta(`Compact card, long title + subtasks (${label})`, g ? `window ${Math.round(g.width)}×${Math.round(g.height)} from fitFocusWindow` : 'no geometry applied'))
      await context.close()
    }

    // 6. Local edit / menu / Undo on a local-only card.
    ;({ context, page } = await open(browser, { queue: LOCAL_FIRST, running: false, history: HISTORY }, { mode, accent }))
    await page.getByRole('button', { name: /^More actions for Fix capture strip/ }).first().click()
    await shoot(page, t('06a-card-menu'), meta('Card menu (local-only task)', 'Rename, duplicate, details, delete'))
    const rename = page.getByRole('menuitem', { name: /Rename/ })
    if (await rename.count()) {
      await rename.first().click()
      await shoot(page, t('06b-inline-rename'), meta('Inline rename', 'Enter commits, Escape cancels'))
      await page.keyboard.press('Escape')
    }
    await context.close()
    ;({ context, page } = await open(browser, { queue: LOCAL_FIRST, running: false, history: HISTORY }, { mode, accent }))
    await page.getByRole('button', { name: /^More actions for Fix capture strip/ }).first().click()
    await page.waitForTimeout(300)
    const del = page.getByRole('menuitem', { name: /Delete task/ })
    if (await del.count()) {
      await del.first().click()
      await page.waitForTimeout(400)
      await shoot(page, t('06c-delete-undo'), meta('Delete with Undo', '10-second durable undo token'))
    }
    await context.close()

    // 7. Completed tray / history.
    ;({ context, page } = await open(browser, { queue: QUEUE.slice(0, 2), running: false, history: [...HISTORY, { title: 'Deliver selects to band management', ms: 52 * 60000 + 30000 }] }, { mode, accent }))
    await shoot(page, t('07-completed-tray'), meta('Completed tray (history)', 'Struck-through titles with exact spent time'))
    await context.close()

    // 9. Empty / loading / error / read-only.
    for (const [name, scenario, label] of [
      ['09a-empty', { queue: [], history: [] }, 'Empty queue'],
      ['09b-loading', { loading: true }, 'Loading'],
      ['09c-snapshot-error', { failSnapshot: true }, 'Snapshot error with Retry'],
      ['09d-read-only', { queue: QUEUE.slice(0, 3), running: false, history: HISTORY, caps: 'readonly' }, 'Read-only (another process owns the profile)'],
    ]) {
      ;({ context, page } = await open(browser, scenario, { mode, accent }))
      await shoot(page, t(name), meta(label, ''))
      await context.close()
    }

    // 10. Main window: banner, the rail Focus tab (⇧F), then the full view (Expand).
    ;({ context, page } = await open(browser, { queue: QUEUE, running: true, history: HISTORY }, { mode, accent, url: '/?page=today', viewport: { width: 1200, height: 800 } }))
    await shoot(page, t('10a-main-banner'), meta('Main window with focus banner', '1200×800'))
    await page.mouse.click(700, 400)
    await page.keyboard.press('Shift+F')
    await page.waitForTimeout(500)
    await shoot(page, t('10b-main-rail-tab'), meta('Main window, rail Focus tab (⇧F)', '1200×800'))
    const expand = page.getByRole('button', { name: 'Expand' })
    if (await expand.count()) {
      await expand.first().click()
      await page.waitForTimeout(500)
      await shoot(page, t('10c-main-expanded'), meta('Main window expanded FocusView (Expand)', '1200×800'))
    }
    await context.close()
  }

  // Accent sweep: the expanded companion in every accent, both modes.
  for (const mode of modes) {
    for (const accent of accents) {
      const { context, page } = await open(browser, { queue: QUEUE, running: true, history: HISTORY }, { mode, accent })
      await shoot(page, `11-accent-${accent}-${mode}`, { state: 'Accent sweep: expanded, running', mode, accent, note: '' })
      await context.close()
    }
  }

  await browser.close()
  fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(shots, null, 2))
}

run().catch((e) => { console.error(e); process.exit(1) })
