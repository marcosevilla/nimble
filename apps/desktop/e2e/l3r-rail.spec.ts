/*
 * Loop 3, lane RAIL — right-rail + Stage C deferred minors (loop3/rail).
 *
 * R1 The Todoist sync notice never covers rail content. While it shows, the
 *    rail's visible area ends above it (`--sync-notice-clear`), so no visible
 *    part of any rail row, tray, button or text intersects the notice — in
 *    every rail tab, scrolled to the top and to the bottom, at the default
 *    rail width, at the 200px minimum and collapsed (36px strip), at
 *    1200×800 (the viewport of the original evidence shot) and 1440×900.
 *    Same for the detail sidebar.
 * R2 The `?` help button never sits on the end of a rail list: scrolled to
 *    the bottom, no visible rail content intersects it (every tab).
 * R3 Inbox mixed list: a note's title starts at the same x as a task's
 *    title (±1px).
 * R4 SelectionActionBar: once its entrance ends, no transform is left on it
 *    (computed `transform: none`), so it is no containing block for fixed
 *    descendants and matches its reduced-motion layout.
 * R5 Demo dot: pulses a few times then rests (finite iteration count, no
 *    running animation after it ends); none at all under reduced motion.
 * R6 Completion tint: the completing row's tint reads `--success-tint`, a
 *    theme token that differs between light and dark.
 *
 * Run (frozen build only):
 *   BASE_URL=http://localhost:4612 npx playwright test -c e2e e2e/l3r-rail.spec.ts
 * Screenshots: SHOT_DIR=<dir> ... -g screenshots
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoNewAxeViolations, type App } from './fixtures'

type Box = { x: number; y: number; width: number; height: number }

const STALE_MSG = "Todoist hasn't synced in over an hour."
const TABS = ['calendar', 'habits', 'activity', 'focus'] as const
type Tab = (typeof TABS)[number]

// ── stubs (registered after the fixture's mock, so they wrap its invoke) ────

/** `window.__syncMode` = 'stale' | 'ok' shapes `get_todoist_sync_status`. */
async function stubSync(page: Page, mode: 'stale' | 'ok' = 'stale') {
  await page.addInitScript((m) => {
    type Inv = (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Inv }; __syncMode: string }
    w.__syncMode = m
    const orig = w.__TAURI_INTERNALS__.invoke
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
      if (cmd !== 'get_todoist_sync_status') return orig(cmd, args, opts)
      return Promise.resolve(orig(cmd, args, opts)).then((s) => {
        const base = s as Record<string, unknown>
        if (w.__syncMode === 'ok') return { ...base, enabled: true, last_sync_at: local(new Date()), last_error: null }
        return { ...base, enabled: true, last_sync_at: '2026-01-01 08:00:00', last_error: null }
      })
    }
  }, mode)
}

/** A queued focus engine with today's completed tray (the evidence shot's data). */
async function stubFocus(page: Page, doneCount = 4) {
  await page.addInitScript((n) => {
    type Inv = (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Inv } }
    const orig = w.__TAURI_INTERNALS__.invoke
    const MIN = 60000
    const tasks = ['task-01', 'task-04', 'task-06', 'task-07', 'task-12', 'task-05']
    const queue = tasks.map((t, i) => ({
      id: 'entry-' + i, task_id: t, occurrence_id: 'occ-' + t, added_at: new Date().toISOString(),
      source: { kind: 'today' }, explicit_still_open: false,
      config: { mode: 'count_up', budget_ms: null, work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 },
    }))
    const titles = ['Reply to Fillmore photo pass email', 'Pay quarterly estimated taxes', 'Deliver selects to band management', 'Book rehearsal space for Friday', 'Send invoice to Goldenvoice', 'Back up the SD cards']
    const history = titles.slice(0, n).map((title, i) => ({
      occurrence_id: 'hist-' + i, task_id: null, title, total_ms: (9 + i * 7) * MIN, recorded_ms: (9 + i * 7) * MIN, imported_ms: 0,
      completed_at: new Date(Date.now() - (i + 1) * 20 * MIN).toISOString(), archived: false,
    }))
    const caps = { queue_read: true, queue_write: true, history_read: true, live_timing: true, companion: true, import: true, reason: null }
    const snap = () => ({
      queue_revision: 1, engine_revision: 1, owner_epoch: 'mock', process_generation: 1, writer_device_id: 'mock',
      queue, selected_occurrence_id: queue[0].occurrence_id, session: null, totals: {}, as_of: new Date().toISOString(),
      checkpoint_at: new Date().toISOString(), recovery_reason: null, replica: false,
    })
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
      if (cmd === 'focus_capabilities') return Promise.resolve(caps)
      if (cmd === 'focus_snapshot') return Promise.resolve(snap())
      if (cmd === 'focus_history') return Promise.resolve({ rows: history, next_cursor: null })
      return orig(cmd, args, opts)
    }
  }, doneCount)
}

async function stubDemo(page: Page) {
  await page.addInitScript(() => {
    type Inv = (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Inv } }
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => (cmd === 'demo_status' ? Promise.resolve(true) : orig(cmd, args, opts))
  })
}

// ── helpers ─────────────────────────────────────────────────────────────────

const rail = (page: Page) => page.locator('aside[data-right-rail]').first()
const tablist = (page: Page) => page.locator('[role="tablist"][aria-label="Sidebar views"]')
const helpBtn = (page: Page) => page.getByRole('button', { name: 'Keyboard shortcuts (?)' })
const notice = (page: Page) => page.locator('[role="status"]').filter({ hasText: STALE_MSG }).last()

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox()
  expect(b, 'element has a box').not.toBeNull()
  return b!
}

async function openRail(app: App, page: Page, tab: Tab, pageId = 'today') {
  await page.addInitScript((t) => {
    try { localStorage.setItem('nimble.rightTab', t) } catch { /* storage blocked */ }
  }, tab)
  await app.open(pageId)
  await expect(tablist(page)).toBeVisible()
  await expect(tablist(page).getByRole('tab', { selected: true })).toBeVisible()
  // The panel fades in (tab-panel-in) and loaders settle.
  await page.waitForTimeout(400)
}

/** Drag the rail's resize handle to its 200px minimum. */
async function railToMin(page: Page) {
  const h = await box(rail(page).locator('.cursor-col-resize').first())
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + 400, h.y + h.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => Math.round((await box(rail(page))).width)).toBe(200)
}

/** Scroll every scroller inside the rail to `where`. */
async function scrollRail(page: Page, where: 'top' | 'bottom') {
  await rail(page).evaluate((aside, w) => {
    for (const el of [aside, ...Array.from(aside.querySelectorAll<HTMLElement>('*'))]) {
      const cs = getComputedStyle(el)
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) el.scrollTop = w === 'top' ? 0 : el.scrollHeight
    }
  }, where)
  await page.waitForTimeout(50)
}

/**
 * Visible content inside `scope` that intersects `target`: every element with
 * its own text, every control and every svg, with its box clipped by each
 * ancestor that clips overflow (what the user can actually see). Elements
 * inside a `role="status"` region (the notice itself) are skipped.
 */
async function visibleHits(scope: Locator, target: Box) {
  return scope.evaluate((root, t) => {
    const clipRect = (el: Element) => {
      let r = el.getBoundingClientRect()
      let left = r.left, top = r.top, right = r.right, bottom = r.bottom
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          r = p.getBoundingClientRect()
          left = Math.max(left, r.left); top = Math.max(top, r.top)
          right = Math.min(right, r.right); bottom = Math.min(bottom, r.bottom)
        }
      }
      return { left, top, right, bottom }
    }
    const out: string[] = []
    for (const el of Array.from(root.querySelectorAll<HTMLElement | SVGElement>('*'))) {
      if (el.closest('[role="status"]')) continue
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())
      const control = el.matches('button, [role="button"], [role="checkbox"], [role="tab"], input, a[href], [data-nav-row], svg')
      if (!own && !control) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || !el.getClientRects().length || parseFloat(cs.opacity) === 0) continue
      const c = clipRect(el)
      if (c.right - c.left < 1 || c.bottom - c.top < 1) continue
      if (c.left < t.x + t.width && t.x < c.right && c.top < t.y + t.height && t.y < c.bottom) {
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30) || el.getAttribute('aria-label') || ''}" y ${Math.round(c.top)}–${Math.round(c.bottom)}`)
      }
    }
    return out
  }, target)
}

// ── R1 sync notice vs rail content ──────────────────────────────────────────

test.describe('R1 sync notice never covers rail content', () => {
  for (const vp of [{ width: 1200, height: 800 }, { width: 1440, height: 900 }]) {
    for (const width of ['default', 'min'] as const) {
      test(`R1 every tab, top + bottom (${vp.width}×${vp.height}, rail ${width})`, async ({ app, page }) => {
        await page.setViewportSize(vp)
        await stubSync(page, 'stale')
        await stubFocus(page, 6)
        await openRail(app, page, 'focus')
        if (width === 'min') await railToMin(page)
        await expect(notice(page)).toBeVisible()
        await expect(notice(page).getByRole('button', { name: 'Sync now' })).toBeVisible()
        await page.waitForTimeout(300) // notice entrance
        const nb = await box(notice(page))
        for (const tab of TABS) {
          await tablist(page).getByRole('tab', { name: new RegExp(tab === 'focus' ? 'Focus' : tab, 'i') }).click()
          await page.waitForTimeout(300)
          if (tab === 'focus') await expect(rail(page).getByText(/^\d+ done$/).first()).toBeVisible()
          for (const where of ['top', 'bottom'] as const) {
            await scrollRail(page, where)
            expect(await visibleHits(rail(page), nb), `${tab} scrolled to ${where}: content under the notice ${JSON.stringify(nb)}`).toEqual([])
          }
        }
      })
    }
  }

  test('R1 the Focus tray bottom (N done) clears the notice, scrolled to the bottom (1200×800)', async ({ app, page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await stubSync(page, 'stale')
    await stubFocus(page, 6)
    await openRail(app, page, 'focus')
    await expect(notice(page)).toBeVisible()
    await page.waitForTimeout(300)
    await scrollRail(page, 'bottom')
    const last = rail(page).getByText('Back up the SD cards')
    await expect(last).toBeVisible()
    const lb = await box(last)
    const nb = await box(notice(page))
    expect(lb.y + lb.height, 'last done row ends above the notice').toBeLessThanOrEqual(nb.y)
  })

  test('R1 rail collapsed: the strip buttons clear the compact notice', async ({ app, page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await stubSync(page, 'stale')
    await openRail(app, page, 'focus')
    await rail(page).getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect.poll(async () => Math.round((await box(rail(page))).width)).toBe(36)
    await expect(notice(page)).toBeVisible()
    await page.waitForTimeout(300)
    expect(await visibleHits(rail(page), await box(notice(page)))).toEqual([])
  })

  test('R1 notice gone: the rail gets its full height back', async ({ app, page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await stubSync(page, 'stale')
    await openRail(app, page, 'habits')
    await expect(notice(page)).toBeVisible()
    const panel = rail(page).locator('[role="tabpanel"]:visible').first()
    const withNotice = (await box(panel)).height
    await notice(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(notice(page)).toHaveCount(0)
    await expect.poll(async () => (await box(panel)).height).toBeGreaterThan(withNotice + 100)
  })

  test('R1 detail sidebar: content clears the notice', async ({ app, page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await stubSync(page, 'stale')
    await app.open('today')
    await page.evaluate(() => {
      const s = (window as unknown as { __stores: { useDetailStore: { getState(): { openTask(id: string, mode: string): void } } } }).__stores
      s.useDetailStore.getState().openTask('task-01', 'sidebar')
    })
    const aside = page.locator('aside[data-right-rail]').last()
    await expect(notice(page)).toBeVisible()
    await page.waitForTimeout(400)
    await expect(aside.getByText(/^Task$/)).toBeVisible()
    await aside.evaluate((a) => { for (const el of Array.from(a.querySelectorAll<HTMLElement>('*'))) if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight })
    expect(await visibleHits(aside, await box(notice(page)))).toEqual([])
  })
})

// ── R2 help button vs rail list ends ────────────────────────────────────────

test.describe('R2 ? button clears the end of every rail list', () => {
  for (const vp of [{ width: 1200, height: 600 }, { width: 1440, height: 900 }]) {
    test(`R2 scrolled to the bottom, no rail content under ? (${vp.width}×${vp.height})`, async ({ app, page }) => {
      await page.setViewportSize(vp)
      await stubSync(page, 'ok')
      await stubFocus(page, 6)
      await openRail(app, page, 'habits')
      const hb = await box(helpBtn(page))
      for (const tab of TABS) {
        await tablist(page).getByRole('tab', { name: new RegExp(tab === 'focus' ? 'Focus' : tab, 'i') }).click()
        await page.waitForTimeout(300)
        await scrollRail(page, 'bottom')
        expect(await visibleHits(rail(page), hb), `${tab}: content under the ? button`).toEqual([])
      }
    })
  }
})

// ── R3 inbox title column ───────────────────────────────────────────────────

test('R3 inbox: note and task titles start at the same x', async ({ app, page }) => {
  await app.open('inbox')
  const rows = page.locator('main [data-nav-row]')
  await expect(rows.first()).toBeVisible()
  const xs = await rows.evaluateAll((els) =>
    els.map((row) => {
      const kind = row.getAttribute('data-nav-row')!.split(':')[0]
      const title = row.querySelector<HTMLElement>('span.truncate.text-body, span.truncate.flex-1')
      const sub = !!row.querySelector('[data-subtask-badge], [aria-label="Subtask"]')
      return { kind, sub, x: title ? Math.round(title.getBoundingClientRect().left) : null }
    }),
  )
  const notes = xs.filter((r) => r.kind === 'note' && r.x !== null)
  const tasks = xs.filter((r) => r.kind !== 'note' && !r.sub && r.x !== null)
  expect(notes.length, 'inbox has notes').toBeGreaterThan(0)
  expect(tasks.length, 'inbox has tasks').toBeGreaterThan(0)
  const noteX = new Set(notes.map((r) => r.x))
  const taskX = new Set(tasks.map((r) => r.x))
  expect(noteX.size, `note title xs ${[...noteX]}`).toBe(1)
  expect(Math.abs([...noteX][0]! - Math.min(...taskX)), `note x ${[...noteX]} vs task xs ${[...taskX]}`).toBeLessThanOrEqual(1)
})

// ── R4 SelectionActionBar leftover transform ────────────────────────────────

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`R4 SelectionActionBar ends with no transform (${motion})`, async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: motion })
    await app.open('tasks')
    const row = page.locator('main [data-nav-row]').first()
    await expect(row).toBeVisible()
    await row.hover()
    await row.getByRole('button', { name: 'Select', exact: true }).click()
    const bar = page.getByText(/^\d+ selected$/).locator('xpath=ancestor::div[contains(@class,"sticky")][1]')
    await expect(bar).toBeVisible()
    await page.waitForTimeout(500)
    expect(await bar.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    expect(await bar.evaluate((el) => el.getAnimations().filter((a) => a.playState !== 'finished').length)).toBe(0)
  })
}

// ── R5 demo dot ─────────────────────────────────────────────────────────────

test('R5 demo dot pulses a few times, then rests', async ({ app, page }) => {
  await stubDemo(page)
  await app.open('today')
  const dot = page.locator('nav [data-demo-dot]')
  await expect(dot).toBeVisible()
  const iter = await dot.evaluate((el) => getComputedStyle(el).animationIterationCount)
  expect(iter, 'finite iteration count').not.toBe('infinite')
  expect(Number(iter)).toBeLessThanOrEqual(4)
  // Fast-forward the pulse: it ends and leaves the dot fully opaque.
  await dot.evaluate((el) => el.getAnimations().forEach((a) => a.finish()))
  expect(await dot.evaluate((el) => el.getAnimations().length)).toBe(0)
  expect(await dot.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
})

test('R5 demo dot stops as soon as the pill is hovered', async ({ app, page }) => {
  await stubDemo(page)
  await app.open('today')
  const dot = page.locator('nav [data-demo-dot]')
  await expect(dot).toBeVisible()
  expect(await dot.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)
  await dot.hover()
  await expect.poll(() => dot.evaluate((el) => el.getAnimations().length)).toBe(0)
})

test('R5 demo dot has no animation under reduced motion', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stubDemo(page)
  await app.open('today')
  const dot = page.locator('nav [data-demo-dot]')
  await expect(dot).toBeVisible()
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
})

// ── R6 completion tint token ────────────────────────────────────────────────

test('R6 --success-tint is a theme token that differs light vs dark', async ({ app, page }) => {
  await app.open('today')
  const read = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--success-tint').trim())
  const light = await read()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const dark = await read()
  expect(light, 'light token').not.toBe('')
  expect(dark, 'dark token').not.toBe('')
  expect(light).not.toBe(dark)
  // The completion keyframes read the token, not a literal.
  const sheets = await page.evaluate(() => {
    const out: string[] = []
    for (const sh of Array.from(document.styleSheets)) {
      try {
        for (const r of Array.from(sh.cssRules)) if (r instanceof CSSKeyframesRule && /task-complete/.test(r.name)) out.push(r.cssText)
      } catch { /* cross-origin */ }
    }
    return out.join('\n')
  })
  expect(sheets).toContain('--success-tint')
})

// ── standing: axe with the notice + focus tray showing ──────────────────────

for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe (${theme})`, () => {
    test.use({ theme })
    test(`R axe: today with the rail Focus tab and the sync notice (${theme})`, async ({ app, page }) => {
      await stubSync(page, 'stale')
      await openRail(app, page, 'habits')
      await expect(notice(page)).toBeVisible()
      await expectNoNewAxeViolations(page, 'today')
    })
  })
}

// ── screenshots ─────────────────────────────────────────────────────────────

test.describe('screenshots', () => {
  test.skip(!process.env.SHOT_DIR, 'set SHOT_DIR to capture')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme })
      // The dev-only Agentation toolbar sits on the ? button; hide it.
      const shot = async (page: Page, name: string, clip?: Box) => {
        await page.addStyleTag({ content: '[data-agentation-root],[data-agentation-toolbar]{display:none!important}' })
        await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}-${theme}.png`, clip })
      }

      test(`rail + notice (${theme})`, async ({ app, page }) => {
        await page.setViewportSize({ width: 1200, height: 800 })
        await stubSync(page, 'stale')
        await stubFocus(page, 4)
        await openRail(app, page, 'focus')
        await page.mouse.move(600, 790)
        await page.waitForTimeout(500)
        await shot(page, '01-rail-focus-notice')
        await scrollRail(page, 'bottom')
        await shot(page, '02-rail-focus-notice-scrolled')
        await railToMin(page)
        await page.waitForTimeout(300)
        await scrollRail(page, 'bottom')
        await shot(page, '03-rail-focus-notice-200')
      })

      test(`rail habits + ? (${theme})`, async ({ app, page }) => {
        await page.setViewportSize({ width: 1200, height: 600 })
        await stubSync(page, 'ok')
        await openRail(app, page, 'habits')
        await page.mouse.move(600, 590)
        await scrollRail(page, 'bottom')
        await page.waitForTimeout(300)
        const rb = await box(rail(page))
        await shot(page, '04-rail-habits-help', { x: rb.x, y: 0, width: rb.width, height: 600 })
      })

      test(`inbox mixed list (${theme})`, async ({ app, page }) => {
        await app.open('inbox')
        await expect(page.locator('main [data-nav-row]').first()).toBeVisible()
        await page.mouse.move(1430, 890)
        await page.waitForTimeout(300)
        await shot(page, '05-inbox-mixed', { x: 240, y: 0, width: 900, height: 560 })
      })

      test(`selection bar (${theme})`, async ({ app, page }) => {
        await app.open('tasks')
        const row = page.locator('main [data-nav-row]').first()
        await row.hover()
        await row.getByRole('button', { name: 'Select', exact: true }).click()
        await page.mouse.move(1430, 890)
        await page.waitForTimeout(600)
        await shot(page, '06-selection-bar')
      })

      test(`demo pill (${theme})`, async ({ app, page }) => {
        await stubDemo(page)
        await app.open('today')
        await page.waitForTimeout(300)
        await shot(page, '07-demo-pill', { x: 0, y: 0, width: 260, height: 140 })
      })

      test(`completion tint (${theme})`, async ({ app, page }) => {
        await app.open('tasks')
        const row = page.locator('main [data-nav-row]').first()
        await expect(row).toBeVisible()
        // Freeze the completion flash at its tint peak (20% of 600ms).
        await row.evaluate((el) => {
          el.classList.add('animate-task-complete')
          for (const a of el.getAnimations()) { a.pause(); a.currentTime = 120 }
        })
        const b = await box(row)
        await shot(page, '08-completion-tint', { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 })
      })
    })
  }
})
