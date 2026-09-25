// T7 — Shell key guards + the focus ⋯ menu's direction (loop 3, lane KEYS).
//
// NEXT.md "1b follow-ups" + "Minors deferred":
//   1. Dashboard's single-key shortcuts (⇧H, ⇧F, q, ?, digits, the g-chord)
//      must leave keys alone when they are typed into a field — a native
//      SELECT included — or while a menu, popover or dialog is open.
//   2. Space pauses a running focus session from the page, but never when
//      it is aimed at a button (the project delete-confirm) or typed inside a
//      dialog: there it activates the control, as everywhere else.
//   3. The task ⋯ menu in the focus queue must not open down over Up next.
//
// Runs on synthetic data (tools/mock-tauri.js). Tests that need a running
// session swap in a small stateful focus engine (same shape as
// l3b-task-detail.spec.ts / tools/capture-focus-states.js) that records
// every `focus_execute` action in `window.__focusCalls`.
import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoNewAxeViolations } from './fixtures'

const MOCK_NOW = new Date('2026-08-01T10:00:00')

// Depending on `app` installs the mock before the clock is pinned.
test.beforeEach(async ({ app, page }) => {
  void app
  await page.clock.setFixedTime(MOCK_NOW)
})

/** What these tests read from the page's window. */
interface TestWindow {
  __focusCalls: { kind: string }[]
  __TAURI_INTERNALS__: { invoke(cmd: string, args: unknown, io: unknown): Promise<unknown> }
  __stores: { useAppStore: { getState(): { currentPage: string } } }
}

// ── mocks ────────────────────────────────────────────────────────────────

interface FocusOpts {
  queued: string[]
  /** true: the first entry is running; false: paused; omitted: no session. */
  running?: boolean
}

async function installFocus(page: Page, o: FocusOpts) {
  await page.addInitScript((opts: FocusOpts) => {
    const w = window as unknown as TestWindow
    w.__focusCalls = []
    const config = { mode: 'count_up', budget_ms: null, work_ms: 1500000, break_ms: 300000, rounds: 1 }
    const queue = opts.queued.map((id) => ({
      id: 'e-' + id, task_id: id, occurrence_id: 'occ-' + id, added_at: new Date().toISOString(),
      source: { kind: 'local' }, explicit_still_open: false, config,
    }))
    let rev = 1
    const session = opts.running == null || !queue.length ? null : {
      id: 'session-1', occurrence_id: queue[0].occurrence_id, status: opts.running ? 'running' : 'paused', phase: 'work',
      work_ms: 60000, break_ms: 0, round_work_ms: 60000, round: 1, config,
    }
    const snap = () => ({
      queue_revision: rev, engine_revision: rev, owner_epoch: 'mock', process_generation: 1, writer_device_id: 'mock',
      queue: queue.slice(), selected_occurrence_id: queue[0]?.occurrence_id ?? null, session: session ? { ...session } : null,
      totals: {}, as_of: new Date().toISOString(), checkpoint_at: null, recovery_reason: null, replica: false,
    })
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown, io: unknown) => {
      if (cmd === 'focus_capabilities')
        return Promise.resolve({ queue_read: true, queue_write: true, history_read: true, live_timing: true, companion: false, import: false, reason: null })
      if (cmd === 'focus_snapshot') return Promise.resolve(snap())
      if (cmd === 'focus_execute') {
        const a = (args as { command: { action: { kind: string } } }).command.action
        w.__focusCalls.push(a)
        if (a.kind === 'pause' && session) session.status = 'paused'
        if (a.kind === 'resume' && session) session.status = 'running'
        rev++
        return Promise.resolve({ snapshot: snap(), replayed: false, committed_revision: rev })
      }
      return orig(cmd, args, io)
    }
  }, o)
}

async function focusCalls(page: Page): Promise<{ kind: string }[]> {
  return page.evaluate(() => (window as unknown as TestWindow).__focusCalls ?? [])
}

// ── helpers ──────────────────────────────────────────────────────────────

const currentPage = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).__stores.useAppStore.getState().currentPage)

/** The right rail's selected tab ("Calendar", "Habits…", "Focus queue"). */
async function railTab(page: Page) {
  return page.evaluate(() => {
    const t = document.querySelector('[role=tablist][aria-label="Sidebar views"] [role=tab][aria-selected="true"]')
    return t ? t.textContent!.replace(/\d.*$/, '').trim() : null
  })
}

const quickCreate = (page: Page) => page.getByRole('dialog', { name: 'New task' })
const helpPanel = (page: Page) => page.getByRole('heading', { name: /keyboard shortcuts/i })

/** A native <select> in the page (Settings forms use them; the mock world
 * has none on the pages under test, so one is added to <main>). */
async function focusSelect(page: Page) {
  await page.evaluate(() => {
    const s = document.createElement('select')
    s.id = 't7-select'
    s.setAttribute('aria-label', 'T7 select')
    for (const v of ['one', 'two', 'three']) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v
      s.appendChild(o)
    }
    document.querySelector('main')!.prepend(s)
  })
  const sel = page.locator('#t7-select')
  await sel.focus()
  await expect(sel).toBeFocused()
  return sel
}

/** Snapshot of everything the shell keys can change. */
async function shellState(page: Page) {
  return {
    page: await currentPage(page),
    rail: await railTab(page),
    quickCreate: await quickCreate(page).count(),
    help: await helpPanel(page).count(),
  }
}

const SHELL_KEYS = ['Shift+H', 'Shift+F', 'q', '?', '2', '3', 'g', 'i']

async function pressAll(page: Page, keys: string[]) {
  for (const k of keys) {
    await page.keyboard.press(k)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(200)
}

const popups = (page: Page) => page.locator('[role=dialog], [role=menu], [role=listbox], [role=alertdialog]').filter({ visible: true })

// ── 1. single-key shell shortcuts skip SELECT and open overlays ─────────

test.describe('1 shell keys', () => {
  test('sanity: on the page body ⇧H, q and a digit act', async ({ app, page }) => {
    await app.open('today')
    await page.keyboard.press('Shift+H')
    await expect.poll(() => railTab(page)).toBe('Habits')
    await page.keyboard.press('q')
    await expect(quickCreate(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(quickCreate(page)).toHaveCount(0)
    await page.keyboard.press('2')
    await expect.poll(() => currentPage(page)).not.toBe('today')
  })

  test('keys typed in a focused SELECT reach the select, not the shell', async ({ app, page }) => {
    await app.open('today')
    const before = await shellState(page)
    await focusSelect(page)
    await pressAll(page, SHELL_KEYS)
    expect(await shellState(page), 'no shell shortcut fired from the select').toEqual(before)
  })

  test('the g-chord (g i) stays out of a SELECT and an open menu', async ({ app, page }) => {
    await app.open('tasks')
    await focusSelect(page)
    await pressAll(page, ['g', 'i'])
    expect(await currentPage(page), 'g i from a select').toBe('tasks')
    await page.locator('[data-nav-row="task-05"]').getByRole('button', { name: /^Status:/ }).click()
    await expect(popups(page)).toHaveCount(1)
    await pressAll(page, ['g', 'i'])
    expect(await currentPage(page), 'g i inside a menu').toBe('tasks')
  })

  test('with a row menu open (focus inside it) shell keys do nothing', async ({ app, page }) => {
    await app.open('tasks')
    const row = page.locator('[data-nav-row="task-05"]')
    await row.getByRole('button', { name: /^Status:/ }).click()
    await expect(popups(page)).toHaveCount(1)
    const before = await shellState(page)
    await pressAll(page, SHELL_KEYS)
    expect(await shellState(page), 'no shell shortcut fired while the menu was open').toEqual(before)
    await expect(popups(page), 'the menu is still the only popup').toHaveCount(1)
  })

  test('with a picker open (focus on its trigger) shell keys do nothing', async ({ app, page }) => {
    await app.open('tasks')
    const row = page.locator('[data-nav-row="task-05"]')
    await row.getByRole('button', { name: /^\s*due\b/i }).click()
    await expect(popups(page)).toHaveCount(1)
    // Put focus back on the trigger: the popup is still open.
    await row.getByRole('button', { name: /^\s*due\b/i }).focus()
    await expect(popups(page)).toHaveCount(1)
    const before = await shellState(page)
    await pressAll(page, ['Shift+H', 'Shift+F', 'q', '?', '2'])
    expect(await shellState(page)).toEqual(before)
  })

  test('with a dialog open (focus on a button inside it) shell keys do nothing', async ({ app, page }) => {
    await app.open('tasks')
    await page.keyboard.press('q')
    const dialog = quickCreate(page)
    await expect(dialog).toBeVisible()
    // Focus a non-field control inside the dialog.
    const btn = dialog.getByRole('button').first()
    await btn.focus()
    await expect(btn).toBeFocused()
    const before = await shellState(page)
    await pressAll(page, ['Shift+H', 'Shift+F', '?', '2', '3'])
    expect(await shellState(page)).toEqual(before)
    await expect(dialog).toBeVisible()
  })

  test('with the project delete-confirm showing, digits and q do nothing', async ({ app, page }) => {
    await app.open('tasks')
    const item = page.getByRole('treeitem', { name: 'Nimble', exact: true })
    await item.focus()
    await page.keyboard.press('Backspace')
    const confirm = page.getByRole('alertdialog', { name: 'Delete Nimble?' })
    await expect(confirm).toBeVisible()
    const before = await shellState(page)
    await pressAll(page, ['q', '2', 'Shift+H'])
    expect(await shellState(page)).toEqual(before)
    await expect(confirm).toBeVisible()
  })
})

// ── 1c. review round: things that must NOT count as an open overlay ─────

test.describe('1c not overlays', () => {
  test('Docs search results left showing after blur do not block shell keys', async ({ app, page }) => {
    await app.open('docs')
    const search = page.getByRole('combobox', { name: 'Search docs and vault' })
    await search.fill('case')
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible()
    await search.blur()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(page.getByRole('listbox', { name: 'Search results' }), 'results stay rendered').toBeVisible()
    await page.keyboard.press('2')
    await expect.poll(() => currentPage(page)).not.toBe('docs')
    await page.keyboard.press('Shift+H')
    await expect.poll(() => railTab(page)).toBe('Habits')
  })

  test('a collapsed nav icon with its tooltip showing keeps digits and the g-chord', async ({ app, page }) => {
    await app.open('today')
    await page.getByRole('navigation').getByRole('button', { name: 'Collapse sidebar' }).click()
    const inbox = page.getByRole('navigation').getByRole('button', { name: 'Inbox', exact: true })
    const today = page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true })
    await today.focus()
    await page.keyboard.press('Tab')
    // Walk to the Inbox icon by keyboard so its tooltip opens on focus.
    for (let i = 0; i < 6 && !(await inbox.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    await expect(inbox).toBeFocused()
    await expect(inbox, 'tooltip open on the focused icon').toHaveAttribute('data-popup-open', '')
    await page.keyboard.press('3')
    await expect.poll(() => currentPage(page)).not.toBe('today')
    const after = await currentPage(page)
    await inbox.focus()
    await pressAll(page, ['g', 't'])
    await expect.poll(() => currentPage(page), `g t from ${after}`).toBe('today')
  })
})

// ── 1b. page single keys with the same guard (self-critique round) ────

test.describe('1b page keys', () => {
  const capture = (page: Page) => page.getByRole('textbox', { name: 'Capture a note' })

  test('sanity: Inbox c focuses the capture field from the page', async ({ app, page }) => {
    await app.open('inbox')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('c')
    await expect(capture(page)).toBeFocused()
  })

  test('Inbox c with a note\'s Move to doc picker open leaves the picker alone', async ({ app, page }) => {
    await app.open('inbox')
    await page.locator('[data-nav-row^="note:"]').filter({ hasText: 'Ask Jordan about the design offsite date' }).focus()
    await page.keyboard.press('m')
    const picker = popups(page).filter({ hasText: 'Move to doc' })
    await expect(picker).toHaveCount(1)
    await page.keyboard.press('c')
    await page.waitForTimeout(200)
    await expect(capture(page), 'c does not jump to the capture field').not.toBeFocused()
    await expect(picker, 'the picker stays open').toHaveCount(1)
  })

  test('Inbox c typed in a SELECT stays in the select', async ({ app, page }) => {
    await app.open('inbox')
    await focusSelect(page)
    await page.keyboard.press('c')
    await page.waitForTimeout(200)
    await expect(page.locator('#t7-select')).toBeFocused()
  })
})

// ── 2. Space pauses focus only from the page, never from a control ──────

test.describe('2 space', () => {
  test('sanity: Space on the page body pauses a running session', async ({ app, page }) => {
    await installFocus(page, { queued: ['task-01', 'task-04'], running: true })
    await app.open('today')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press(' ')
    await expect.poll(() => focusCalls(page)).toEqual([{ kind: 'pause' }])
  })

  test('Space on the project delete-confirm "Keep it" keeps the project and does not pause', async ({ app, page }) => {
    await installFocus(page, { queued: ['task-01', 'task-04'], running: true })
    await app.open('tasks')
    const item = page.getByRole('treeitem', { name: 'Nimble', exact: true })
    await item.focus()
    await page.keyboard.press('Backspace')
    const confirm = page.getByRole('alertdialog', { name: 'Delete Nimble?' })
    await expect(confirm).toBeVisible()
    const keep = confirm.getByRole('button', { name: 'Keep it' })
    await keep.focus()
    await page.keyboard.press(' ')
    await expect(confirm, 'Space activates Keep it').toHaveCount(0)
    await expect(page.getByRole('treeitem', { name: 'Nimble', exact: true })).toBeVisible()
    await page.waitForTimeout(200)
    expect(await focusCalls(page), 'Space on a button never pauses').toEqual([])
  })

  test('Space on the delete-confirm "Confirm delete" deletes and does not pause', async ({ app, page }) => {
    await installFocus(page, { queued: ['task-01', 'task-04'], running: true })
    await app.open('tasks')
    await page.getByRole('treeitem', { name: 'Life Admin', exact: true }).focus()
    await page.keyboard.press('Backspace')
    const confirm = page.getByRole('alertdialog', { name: 'Delete Life Admin?' })
    await expect(confirm.getByRole('button', { name: 'Confirm delete Life Admin' })).toBeFocused()
    await page.keyboard.press(' ')
    await expect(confirm).toHaveCount(0)
    await page.waitForTimeout(200)
    expect(await focusCalls(page)).toEqual([])
  })

  test('after choosing an item from the card ⋯ menu, Space pauses (focus is not left on ⋯)', async ({ app, page }) => {
    await installFocus(page, { queued: ['task-01', 'task-04'], running: true })
    await app.open('today')
    await page.getByRole('tab', { name: 'Focus queue' }).click()
    const trigger = page.locator('aside').getByRole('button', { name: /^More actions for / }).first()
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Copy assistant context' }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(trigger, 'focus moves off the ⋯ trigger').not.toBeFocused()
    await page.keyboard.press(' ')
    await expect.poll(() => focusCalls(page)).toEqual([{ kind: 'pause' }])
    await expect(page.getByRole('menu'), 'Space did not reopen the menu').toHaveCount(0)
  })

  test('Space on a nav button activates it and does not pause', async ({ app, page }) => {
    await installFocus(page, { queued: ['task-01', 'task-04'], running: true })
    await app.open('today')
    const nav = page.getByRole('navigation').getByRole('button', { name: 'Inbox', exact: true })
    await nav.focus()
    await page.keyboard.press(' ')
    await expect.poll(() => currentPage(page)).toBe('inbox')
    await page.waitForTimeout(200)
    expect(await focusCalls(page)).toEqual([])
  })

  test('Space on a focused task row still pauses (rows leave Space to the session)', async ({ app, page }) => {
    await installFocus(page, { queued: ['task-01', 'task-04'], running: true })
    await app.open('tasks')
    await page.keyboard.press('j')
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-nav-row'))).not.toBeNull()
    await page.keyboard.press(' ')
    await expect.poll(() => focusCalls(page)).toEqual([{ kind: 'pause' }])
  })
})

// ── 3. the focus task ⋯ menu doesn't cover Up next ──────────────────────

type Rect = { left: number; top: number; right: number; bottom: number }
const rectOf = (l: Locator): Promise<Rect> =>
  l.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  })
const overlaps = (a: Rect, b: Rect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

const QUEUE = ['task-01', 'task-04', 'task-06', 'task-07', 'task-12']

async function openRailQueue(app: { open(p: string): Promise<void> }, page: Page, pageId = 'today') {
  await installFocus(page, { queued: QUEUE, running: true })
  await app.open(pageId)
  await page.getByRole('tab', { name: 'Focus queue' }).click()
  const upNext = page.getByRole('list', { name: 'Up next' })
  await expect(upNext).toBeVisible()
  return upNext
}

async function menuRect(page: Page) {
  const menu = page.getByRole('menu').filter({ visible: true })
  await expect(menu).toHaveCount(1)
  await page.waitForTimeout(250) // entry animation
  return rectOf(menu)
}

async function expectInViewport(page: Page, r: Rect) {
  const vp = page.viewportSize()!
  expect(r.left).toBeGreaterThanOrEqual(0)
  expect(r.top).toBeGreaterThanOrEqual(0)
  expect(r.right).toBeLessThanOrEqual(vp.width)
  expect(r.bottom).toBeLessThanOrEqual(vp.height)
}

/** The focused card's ⋯ trigger in the right rail (the card sits above Up next). */
async function cardTrigger(page: Page) {
  const t = page.locator('aside').getByRole('button', { name: /^More actions for / }).first()
  expect(await t.evaluate((el) => !!el.closest('ul[aria-label="Up next"]')), 'card trigger, not a row').toBe(false)
  return t
}

test.describe('3 focus ⋯ menu', () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
    test.describe(`${vp.width}px`, () => {
      test.use({ viewport: vp })
      test(`the card's ⋯ menu does not cover Up next (${vp.width}px)`, async ({ app, page }) => {
        const upNext = await openRailQueue(app, page)
        const trigger = await cardTrigger(page)
        await trigger.click()
        const m = await menuRect(page)
        expect(overlaps(m, await rectOf(upNext)), `menu ${JSON.stringify(m)} covers Up next`).toBe(false)
        await expectInViewport(page, m)
        expect(overlaps(m, await rectOf(trigger)), 'menu does not cover its trigger').toBe(false)
      })

      // A row's menu necessarily sits over its neighbours in a 280px rail;
      // it must stay on screen and off the row it acts on.
      test(`an Up next row's ⋯ menu stays in the viewport and off its own title (${vp.width}px)`, async ({ app, page }) => {
        const upNext = await openRailQueue(app, page)
        const row = upNext.locator('[data-focus-entry]').last()
        await row.hover()
        const trigger = row.getByRole('button', { name: /^More actions for / })
        await trigger.click()
        const m = await menuRect(page)
        await expectInViewport(page, m)
        const title = await row.evaluate((el) => {
          const r = document.getElementById(el.getAttribute('aria-labelledby') ?? '')!.getBoundingClientRect()
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        })
        expect(overlaps(m, title), `menu ${JSON.stringify(m)} covers its row's title ${JSON.stringify(title)}`).toBe(false)
      })
    })
  }

  test('keyboard: the card ⋯ menu opens with Enter, Escape returns focus to the trigger', async ({ app, page }) => {
    await openRailQueue(app, page)
    const trigger = await cardTrigger(page)
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('axe: no new violations with the card ⋯ menu open', async ({ app, page }) => {
    await openRailQueue(app, page)
    await (await cardTrigger(page)).click()
    await menuRect(page)
    await expectNoNewAxeViolations(page, 'today')
  })
})

// ── 4. the calendar is its own key region ──────────────────────────────

test.describe('4 calendar key region', () => {
  const activeRow = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-nav-row') ?? null)
  const detailId = (page: Page) =>
    page.evaluate(() => {
      const s = (window as unknown as { __stores: { useAppStore: { getState(): { currentPage: string } }; useDetailStore: { getState(): { pageDetails?: Record<string, { target?: { id: string } } | undefined> } } } }).__stores
      return s.useDetailStore.getState().pageDetails?.[s.useAppStore.getState().currentPage]?.target?.id ?? null
    })
  // The focusable calendar panel (the div holding the day chevrons).
  const calendar = (page: Page) => page.getByRole('button', { name: 'Previous day' }).locator('xpath=ancestor::div[@tabindex="0"][1]')

  for (const pageId of ['tasks', 'inbox'] as const) {
    test(`${pageId}: j, k, x and Enter typed in the calendar leave the row list alone`, async ({ app, page }) => {
      await app.open(pageId)
      await page.keyboard.press('j')
      await expect.poll(() => activeRow(page)).not.toBeNull()
      const rowsBefore = await page.locator('[data-nav-row]').count()
      await calendar(page).focus()
      await expect(calendar(page)).toBeFocused()
      await pressAll(page, ['j', 'j', 'k', 'x', 'Enter'])
      await expect(calendar(page), 'focus stays in the calendar').toBeFocused()
      expect(await detailId(page), 'Enter opens no task').toBeNull()
      expect(await page.locator('[data-nav-row]').count(), 'x completes/dismisses nothing').toBe(rowsBefore)
    })
  }

  test('the calendar still takes → and t while focused', async ({ app, page }) => {
    await app.open('tasks')
    await calendar(page).focus()
    const label = () => calendar(page).getByTitle('Jump to today').textContent()
    const before = await label()
    await page.keyboard.press('ArrowRight')
    await expect.poll(label).not.toBe(before)
    await page.keyboard.press('t')
    await expect.poll(label).toBe(before)
  })
})

// ── Screenshots (before/after evidence; never fail) ──────────────────────

const SHOT_DIR = process.env.SHOT_DIR
test.describe('screenshots', () => {
  test.skip(!SHOT_DIR, 'set SHOT_DIR to capture screenshots')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme, viewport: { width: 1440, height: 900 } })
      for (const which of ['card', 'row'] as const) {
        test(`focus ${which} ⋯ menu ${theme}`, async ({ app, page }) => {
          const upNext = await openRailQueue(app, page)
          const trigger =
            which === 'card'
              ? await cardTrigger(page)
              : upNext.locator('[data-focus-entry]').nth(1).getByRole('button', { name: /^More actions for / })
          if (which === 'row') await upNext.locator('[data-focus-entry]').nth(1).hover()
          await trigger.click()
          await page.getByRole('menu').waitFor({ state: 'visible' })
          await page.waitForTimeout(300)
          fs.mkdirSync(SHOT_DIR!, { recursive: true })
          await page.screenshot({ path: path.join(SHOT_DIR!, `focus-${which}-menu-${theme}.png`) })
        })
      }
    })
  }
})
