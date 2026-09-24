/*
 * T4 — Deferred-commit Undo for label / capture-route / doc delete.
 * Plan: docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "T4".
 *
 * Contract for the builder
 * ------------------------
 * Surfaces (mock data from tools/mock-tauri.js):
 *   - Labels: Settings → Tasks & capture (`?page=settings&settings=tasks`),
 *     section#labels. Rows are found by their rename input
 *     (textbox "Rename <name>"); delete via the row's button named
 *     /^Delete label <name>/. If a confirm dialog is kept, its confirm button
 *     must be named /^Delete/ (the test confirms it when present).
 *   - Capture routes: same page, section#capture-routes. Each route row is an
 *     element containing the route label text and a button named /^Delete/
 *     (e.g. "Delete route" or "Delete route Task"); optional confirm as above.
 *   - Docs: Docs tree, row = [role=treeitem][data-key="doc:<id>"]; hover
 *     button "Delete <title>" opens the existing inline confirm (STAYS),
 *     "Confirm delete <title>" confirms. Folder delete keeps its current
 *     immediate flow (delete_doc_folder right after confirm, no Undo toast).
 * Behaviour:
 *   1. Delete hides the row at once and shows ONE sonner toast whose text
 *      matches /label\b.*deleted/i, /route\b.*deleted/i or
 *      /(doc|document)\b.*deleted/i with an action button named exactly
 *      "Undo", open ~5 s (it must still be there at 3.5 s, gone by 7 s).
 *   2. No delete_label / delete_capture_route / delete_document invoke while
 *      the toast is open. Undo → row back at the same index, zero delete
 *      invokes ever. Expiry or dismiss (swipe) → exactly one invoke, with
 *      `{ id }` of that row, and the row stays gone.
 *   3. Two deletes pending → two toasts, two invokes total (one per id),
 *      none before its toast closes.
 *   4. Navigating away (to Today) while pending → exactly one invoke, and the
 *      row is gone when you come back.
 *   5. Undo reachable by keyboard (sonner hotkey Alt+T, then Tab) with a
 *      visible focus ring; toast text never clips. NOTE: WebKit (and the
 *      WKWebView app) skips a <button> on Tab unless it has an explicit
 *      tabindex. Sonner's built-in action button has none, so today's
 *      ReminderCatchUp Undo is NOT Tab-reachable (Tab goes toast li → out).
 *      The Undo action must render with tabIndex=0 (e.g. pass a ReactNode /
 *      the app's Button as `action`, or toast.custom).
 *   6. No new axe violations on Settings → Tasks & capture (key `settings`;
 *      on main that sub-page scans identical to the recorded General page)
 *      and Docs (`docs`) with the Undo toast visible. Each surface opens in
 *      a fresh context: opening Docs then Settings in one context showed an
 *      extra aria-required-children hit (.pt-1, the docs tree) on Settings.
 *   tools/mock-tauri.js delete_label / delete_capture_route / delete_document
 *   must really remove the row from the mock arrays (so a refresh after the
 *   commit does not bring it back).
 * Unit contract: tests/deferredDelete.test.mjs (src/lib/deferredDelete.ts).
 *
 * Timing: page.clock is installed before load and advanced with runFor, so
 * the 5 s window costs no wall time.
 */
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const DELETE_CMDS = ['delete_label', 'delete_capture_route', 'delete_document'] as const
type Call = [string, Record<string, unknown> | undefined]

// ── plumbing ────────────────────────────────────────────────────────────────

/** Record every invoke. Runs after the fixture's mock init script. */
async function recordInvokes(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => unknown }; __calls: unknown[] }
    const core = w.__TAURI_INTERNALS__
    const base = core.invoke
    w.__calls = []
    core.invoke = (cmd: unknown, args: unknown, o: unknown) => {
      w.__calls.push([cmd, args ? JSON.parse(JSON.stringify(args)) : args])
      return base(cmd, args, o)
    }
  })
}

async function deleteCalls(page: Page, cmd?: string): Promise<Call[]> {
  const calls = (await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)) as Call[]
  return calls.filter(([c]) => (cmd ? c === cmd : (DELETE_CMDS as readonly string[]).includes(c)))
}

async function boot(page: Page, app: App, pageId: string, query = '') {
  await page.clock.install()
  await recordInvokes(page)
  await app.open(pageId, query)
}

/** Advance app time (sonner timers) in small steps so React can re-render. */
async function advance(page: Page, ms: number) {
  const step = 500
  for (let t = 0; t < ms; t += step) await page.clock.runFor(Math.min(step, ms - t))
}

const toasts = (page: Page) => page.locator('[data-sonner-toast]')
const undoToast = (page: Page, text: RegExp) => toasts(page).filter({ hasText: text }).filter({ has: page.getByRole('button', { name: 'Undo', exact: true }) })

/** Confirm a kept confirm dialog (AlertDialog) if one opened. */
async function confirmIfAsked(page: Page, toast: Locator) {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.or(toast).first()).toBeVisible()
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: /^Delete/ }).click()
}

// ── surfaces ────────────────────────────────────────────────────────────────

interface Surface {
  name: string
  cmd: (typeof DELETE_CMDS)[number]
  toastText: RegExp
  axeKey: string
  open: (page: Page, app: App) => Promise<void>
  rows: (page: Page) => Promise<string[]>
  /** Row names that exist in the mock data, in display order: [first, second]. */
  targets: [{ name: string; id: string }, { name: string; id: string }]
  del: (page: Page, name: string) => Promise<void>
}

const LABELS: Surface = {
  name: 'label',
  cmd: 'delete_label',
  toastText: /label\b.*deleted/i,
  axeKey: 'settings',
  open: async (page, app) => {
    await boot(page, app, 'settings', 'settings=tasks')
    await page.locator('#labels').scrollIntoViewIfNeeded()
    await expect(page.getByRole('textbox', { name: /^Rename / }).first()).toBeVisible()
  },
  rows: async (page) =>
    page.locator('#labels').getByRole('textbox', { name: /^Rename / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/^Rename /, ''))),
  targets: [{ name: 'bug', id: 'label-bug' }, { name: 'quick-win', id: 'label-quick-win' }],
  del: async (page, name) => {
    const input = page.getByRole('textbox', { name: `Rename ${name}`, exact: true })
    await input.hover()
    await page.getByRole('button', { name: new RegExp(`^Delete label ${name}`) }).click()
    await confirmIfAsked(page, undoToast(page, LABELS.toastText).or(toasts(page)))
  },
}

const routeRow = (page: Page, label: string) =>
  page.locator('#capture-routes div').filter({ has: page.getByText(label, { exact: true }) }).filter({ has: page.getByRole('button', { name: /^Delete/ }) }).last()

const ROUTES: Surface = {
  name: 'capture route',
  cmd: 'delete_capture_route',
  toastText: /route\b.*deleted/i,
  axeKey: 'settings',
  open: async (page, app) => {
    await boot(page, app, 'settings', 'settings=tasks')
    await page.locator('#capture-routes').scrollIntoViewIfNeeded()
    await expect(page.locator('#capture-routes').getByRole('button', { name: /^Delete/ }).first()).toBeVisible()
  },
  rows: async (page) =>
    page.locator('#capture-routes span.text-body-strong').allTextContents(),
  targets: [{ name: 'Task', id: 'route-02' }, { name: 'Photo notes', id: 'route-03' }],
  del: async (page, name) => {
    await routeRow(page, name).getByRole('button', { name: /^Delete/ }).click()
    await confirmIfAsked(page, toasts(page))
  },
}

const DOCS: Surface = {
  name: 'doc',
  cmd: 'delete_document',
  toastText: /(doc|document)\b.*deleted/i,
  axeKey: 'docs',
  open: async (page, app) => {
    await boot(page, app, 'docs')
    await expect(page.locator('[role=treeitem][data-key^="doc:"]').first()).toBeVisible()
  },
  rows: async (page) =>
    page.locator('[role=treeitem][data-key^="doc:"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.name!)),
  targets: [{ name: 'Fillmore shot list', id: 'doc-shotlist' }, { name: 'Japan trip notes', id: 'doc-japan' }],
  del: async (page, name) => {
    const row = page.locator(`[role=treeitem][data-name="${name}"]`)
    await row.hover()
    await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
    // AC5: the inline confirm stays; nothing is hidden or toasted before it.
    const confirm = page.getByRole('button', { name: `Confirm delete ${name}`, exact: true })
    await expect(confirm).toBeVisible()
    await confirm.click()
  },
}

const SURFACES = [LABELS, ROUTES, DOCS]

// ── acceptance ──────────────────────────────────────────────────────────────

test.describe('T4 acceptance', () => {
  for (const s of SURFACES) {
    const [a, b] = s.targets

    test(`AC1 ${s.name}: delete hides the row at once and shows "<Thing> deleted" with Undo for ~5 s`, async ({ app, page }) => {
      await s.open(page, app)
      const before = await s.rows(page)
      expect(before).toContain(a.name)
      await s.del(page, a.name)
      await expect.poll(() => s.rows(page), { timeout: 1_000 }).toEqual(before.filter((n) => n !== a.name))
      const t = undoToast(page, s.toastText)
      await expect(t).toHaveCount(1)
      await advance(page, 3_500)
      await expect(t, 'toast still open at 3.5 s').toBeVisible()
      await advance(page, 3_500)
      await expect(t, 'toast closed by 7 s').toHaveCount(0)
    })

    test(`AC2 ${s.name}: Undo restores the row in place and no delete reaches the DataProvider`, async ({ app, page }) => {
      await s.open(page, app)
      const before = await s.rows(page)
      await s.del(page, a.name)
      const t = undoToast(page, s.toastText)
      await expect(t).toBeVisible()
      await t.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect.poll(() => s.rows(page)).toEqual(before)
      await advance(page, 7_000)
      expect(await deleteCalls(page)).toEqual([])
      expect(await s.rows(page)).toEqual(before)
    })

    test(`AC2 ${s.name}: expiry commits exactly one delete, not before, and the row stays gone`, async ({ app, page }) => {
      await s.open(page, app)
      const before = await s.rows(page)
      await s.del(page, a.name)
      await expect(undoToast(page, s.toastText)).toBeVisible()
      expect(await deleteCalls(page), 'no delete while the Undo toast is open').toEqual([])
      await advance(page, 7_000)
      await expect.poll(() => deleteCalls(page)).toEqual([[s.cmd, { id: a.id }]])
      await advance(page, 3_000)
      expect(await deleteCalls(page)).toHaveLength(1)
      expect(await s.rows(page)).toEqual(before.filter((n) => n !== a.name))
    })

    test(`AC2 ${s.name}: dismissing the toast commits exactly one delete`, async ({ app, page }) => {
      await s.open(page, app)
      await s.del(page, a.name)
      const t = undoToast(page, s.toastText)
      await expect(t).toBeVisible()
      expect(await deleteCalls(page)).toEqual([])
      // Sonner dismiss = swipe past its 45px threshold (bottom-right → right).
      const box = (await t.boundingBox())!
      await page.mouse.move(box.x + 20, box.y + box.height / 2)
      await page.mouse.down()
      for (let dx = 10; dx <= 160; dx += 10) await page.mouse.move(box.x + 20 + dx, box.y + box.height / 2)
      await page.mouse.up()
      await advance(page, 1_000)
      await expect(t).toHaveCount(0)
      await expect.poll(() => deleteCalls(page)).toEqual([[s.cmd, { id: a.id }]])
      await advance(page, 7_000)
      expect(await deleteCalls(page)).toHaveLength(1)
    })

    test(`AC3 ${s.name}: two pending deletes get two toasts and each commits once`, async ({ app, page }) => {
      await s.open(page, app)
      const before = await s.rows(page)
      await s.del(page, a.name)
      await advance(page, 1_000)
      await s.del(page, b.name)
      await expect(undoToast(page, s.toastText)).toHaveCount(2)
      await expect.poll(() => s.rows(page)).toEqual(before.filter((n) => n !== a.name && n !== b.name))
      expect(await deleteCalls(page), 'neither commits early').toEqual([])
      await advance(page, 8_000)
      await expect.poll(async () => (await deleteCalls(page)).map(([c, x]) => `${c}:${x?.id}`).sort()).toEqual([`${s.cmd}:${a.id}`, `${s.cmd}:${b.id}`].sort())
      await advance(page, 3_000)
      expect(await deleteCalls(page)).toHaveLength(2)
    })

    test(`AC4 ${s.name}: navigating away while pending still commits exactly once`, async ({ app, page }) => {
      await s.open(page, app)
      await s.del(page, a.name)
      await expect(undoToast(page, s.toastText)).toBeVisible()
      expect(await deleteCalls(page)).toEqual([])
      await page.evaluate(() => (window as unknown as { __stores: { navigateTo(id: string): boolean } }).__stores.navigateTo('today'))
      await expect.poll(() => page.evaluate(() => (window as unknown as { __stores: { useAppStore: { getState(): { currentPage: string } } } }).__stores.useAppStore.getState().currentPage)).toBe('today')
      await advance(page, 8_000)
      await expect.poll(() => deleteCalls(page)).toEqual([[s.cmd, { id: a.id }]])
      await advance(page, 3_000)
      expect(await deleteCalls(page)).toHaveLength(1)
      // Coming back: the row is still gone (the commit really landed).
      const home = s === DOCS ? 'docs' : 'settings'
      await page.evaluate((id) => (window as unknown as { __stores: { navigateTo(id: string): boolean } }).__stores.navigateTo(id), home)
      if (home === 'settings') {
        await page.evaluate(() => (window as unknown as { __stores: { useSettingsNavStore: { getState(): { showPage(id: string): void } } } }).__stores.useSettingsNavStore.getState().showPage('tasks'))
      }
      await advance(page, 1_000)
      await expect.poll(() => s.rows(page)).not.toContain(a.name)
    })

    test(`AC6 ${s.name}: Undo is keyboard reachable with a focus ring and the toast text doesn't clip`, async ({ app, page }) => {
      await s.open(page, app)
      await s.del(page, a.name)
      const t = undoToast(page, s.toastText)
      await expect(t).toBeVisible()
      await expectNoClipping(t)
      const undo = t.getByRole('button', { name: 'Undo', exact: true })
      // Sonner's hotkey focuses the toast region; Tab walks into the toast.
      await page.keyboard.press('Alt+KeyT')
      let reached = false
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press('Tab')
        reached = await undo.evaluate((el) => el === document.activeElement)
      }
      expect(reached, 'Undo reached with Alt+T then Tab').toBe(true)
      await expectFocusRing(page)
      await page.keyboard.press('Enter')
      await expect.poll(() => s.rows(page)).toContain(a.name)
      await advance(page, 7_000)
      expect(await deleteCalls(page)).toEqual([])
    })

    test(`AC8 ${s.name}: no new axe violations with the Undo toast visible`, async ({ app, page }) => {
      await s.open(page, app)
      await s.del(page, a.name)
      const toast = undoToast(page, s.toastText)
      await expect(toast).toBeVisible()
      // Scan the settled toast: mid fade-in (0.4 s) axe reads its half-opaque
      // text as a contrast failure.
      await expect(toast).toHaveCSS('opacity', '1')
      await expectNoNewAxeViolations(page, s.axeKey)
    })
  }

  test('AC5 docs: the confirm stays: nothing is hidden, toasted or deleted before confirming', async ({ app, page }) => {
    await DOCS.open(page, app)
    const before = await DOCS.rows(page)
    const name = DOCS.targets[0].name
    await page.locator(`[role=treeitem][data-name="${name}"]`).hover()
    await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click()
    await expect(page.getByRole('alertdialog', { name: `Delete ${name}?` })).toBeVisible()
    await page.getByRole('button', { name: 'Keep it' }).click()
    await advance(page, 7_000)
    expect(await DOCS.rows(page)).toEqual(before)
    await expect(toasts(page)).toHaveCount(0)
    expect(await deleteCalls(page)).toEqual([])
  })

  test('AC5 docs: folder delete is unchanged (confirm, then an immediate delete_doc_folder, no Undo)', async ({ app, page }) => {
    await DOCS.open(page, app)
    const folder = page.locator('[role=treeitem][data-key="folder:folder-personal"]')
    await folder.hover()
    await page.getByRole('button', { name: 'Delete folder Personal', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm delete Personal', exact: true }).click()
    await expect.poll(async () => (await deleteCalls(page, 'delete_doc_folder')).length, { timeout: 1_000 }).toBe(1)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  })

  test('sanity: docs tree renders the targets and passes the docs axe baseline', async ({ app, page }) => {
    await DOCS.open(page, app)
    expect(await DOCS.rows(page)).toEqual(expect.arrayContaining(DOCS.targets.map((t) => t.name)))
    await expectNoNewAxeViolations(page, 'docs')
  })

  test('sanity: Settings → Tasks & capture renders labels + routes and passes its axe baseline', async ({ app, page }) => {
    await LABELS.open(page, app)
    expect(await LABELS.rows(page)).toEqual(expect.arrayContaining(LABELS.targets.map((t) => t.name)))
    expect(await ROUTES.rows(page)).toEqual(expect.arrayContaining(ROUTES.targets.map((t) => t.name)))
    await expectNoNewAxeViolations(page, 'settings')
  })
})

// ── screenshots (SHOT_DIR=… only) ───────────────────────────────────────────

for (const theme of ['light', 'dark'] as const) {
  test.describe(`screenshots ${theme}`, () => {
    test.skip(!process.env.SHOT_DIR, 'set SHOT_DIR to capture before/after screenshots')
    test.use({ theme, viewport: { width: 1440, height: 900 } })

    const shot = async (page: Page, n: number, state: string) => {
      fs.mkdirSync(process.env.SHOT_DIR!, { recursive: true })
      await page.screenshot({ path: path.join(process.env.SHOT_DIR!, `${String(n).padStart(2, '0')}-${state}-${theme}.png`) })
    }
    // Deletes on main may pop a confirm, no toast, or a plain toast: never fail.
    const tryDelete = async (page: Page, s: Surface) => {
      await s.del(page, s.targets[0].name).catch(() => {})
      await page.waitForTimeout(400)
    }

    test(`screenshots ${theme}: labels`, async ({ app, page }) => {
      await LABELS.open(page, app)
      await page.locator('#labels').scrollIntoViewIfNeeded()
      await shot(page, 1, 'labels')
      await tryDelete(page, LABELS)
      await shot(page, 2, 'labels-deleted')
    })

    test(`screenshots ${theme}: capture routes`, async ({ app, page }) => {
      await ROUTES.open(page, app)
      await page.locator('#capture-routes').scrollIntoViewIfNeeded()
      await shot(page, 3, 'routes')
      await tryDelete(page, ROUTES)
      await shot(page, 4, 'routes-deleted')
    })

    test(`screenshots ${theme}: docs tree`, async ({ app, page }) => {
      await DOCS.open(page, app)
      await shot(page, 5, 'docs')
      await tryDelete(page, DOCS)
      await shot(page, 6, 'docs-deleted')
    })
  })
}
