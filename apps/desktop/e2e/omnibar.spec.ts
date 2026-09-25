/*
 * Omnibar — one ⌘K / ⌘F bar (docs/superpowers/specs/2026-09-25-omnibar-design.md).
 * Replaces c4-search.spec.ts. `seedSearch` adds three "zephyr" tasks through
 * the mock: an open title match, an open description match, a completed one.
 */
import { test, expect, expectNoNewAxeViolations } from './fixtures'
import type { Page } from '@playwright/test'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
type Win = Window & {
  __TAURI_INTERNALS__: { invoke: Invoke }
  __stores: {
    useDetailStore: { getState(): { target: { type: string; id: string } | null } }
    useAppStore: { getState(): { currentPage: string } }
  }
}
type Hit = { task: { id: string; status: string; labels: string[]; project_id: string } }

async function seedSearch(page: Page) {
  return page.evaluate(async () => {
    const inv = (window as unknown as Win).__TAURI_INTERNALS__.invoke
    const title = (await inv('create_local_task', { content: 'Zephyr deck review', projectId: 'proj-portfolio' })) as { id: string }
    const desc = (await inv('create_local_task', {
      content: 'Email Jo', description: 'Ask about the zephyr deck before Friday', projectId: 'proj-life',
    })) as { id: string }
    const done = (await inv('create_local_task', { content: 'Old zephyr draft', projectId: 'proj-portfolio' })) as { id: string }
    await inv('update_task_status', { id: done.id, status: 'complete' })
    window.dispatchEvent(new Event('tasks-changed'))
    return { title: title.id, desc: desc.id, done: done.id }
  })
}

/** The bar alone: axe scans only it (the page behind has its own baseline). */
const BAR = '[role="dialog"][aria-label="Command bar"]'
const bar = (page: Page) => page.getByRole('dialog', { name: 'Command bar' })
const field = (page: Page) => bar(page).getByRole('combobox', { name: 'Search or create' })
const group = (page: Page, name: string) => bar(page).getByRole('group', { name, exact: true })
const rowsIn = (page: Page, name: string) => group(page, name).locator('[data-omnibar-row]')
const pills = (page: Page) => bar(page).locator('[data-omnibar-pill]')
const currentPage = (page: Page) => page.evaluate(() => (window as unknown as Win).__stores.useAppStore.getState().currentPage)
const detailId = (page: Page) => page.evaluate(() => (window as unknown as Win).__stores.useDetailStore.getState().target?.id)
const searchTasks = (page: Page, query: string) =>
  page.evaluate(async (q) => (await (window as unknown as Win).__TAURI_INTERNALS__.invoke('search_tasks', { query: q })) as Hit[], query)

async function openBar(page: Page, key: 'Meta+k' | 'Meta+f' = 'Meta+k') {
  await page.keyboard.press(key)
  await expect(field(page)).toBeFocused() // focused a frame after opening
}

test('⌘K and ⌘F open the same bar and never stack', async ({ app, page }) => {
  await app.open('tasks')
  await openBar(page, 'Meta+f')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.type('zeph')
  await page.keyboard.press('Meta+f') // already open: re-selects, never a second overlay
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(field(page)).toHaveValue('zeph')
  await page.keyboard.press('Meta+k') // ⌘K toggles the same bar shut
  await expect(bar(page)).toHaveCount(0)
  await openBar(page, 'Meta+k')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(field(page)).toHaveValue('')
})

test('Tab turns "completed" into a status pill and narrows; Backspace in an empty field removes it', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openBar(page)
  await page.keyboard.type('zeph')
  await expect(rowsIn(page, 'Tasks')).toHaveCount(3)
  await page.keyboard.type(' completed')
  await expect(rowsIn(page, 'Filters').first()).toContainText('Filter by status: completed')
  await page.keyboard.press('Tab')
  await expect(pills(page)).toHaveText(['status: completed'])
  await expect(field(page)).toHaveValue('zeph ')
  await expect(field(page)).toBeFocused()
  await expect(rowsIn(page, 'Tasks')).toHaveCount(1)
  await expect(rowsIn(page, 'Tasks').first()).toContainText('Old zephyr draft')
  await field(page).fill('') // clearing text never touches pills
  await expect(field(page)).toBeFocused()
  await expect(pills(page)).toHaveCount(1)
  await page.keyboard.press('Backspace')
  await expect(pills(page)).toHaveCount(0)
})

test('a type: pill shows only its group and promotes its create row', async ({ app, page }) => {
  await app.open('tasks')
  await openBar(page)
  await page.keyboard.type('portfolio goal')
  await expect(rowsIn(page, 'Filters').first()).toContainText('Filter by type: goal')
  await page.keyboard.press('Tab')
  await expect(pills(page)).toHaveText(['type: goal'])
  await expect(rowsIn(page, 'Goals').first()).toContainText('Ship portfolio v2')
  for (const other of ['Tasks', 'Notes', 'Docs', 'Actions']) await expect(group(page, other)).toHaveCount(0)
  await expect(rowsIn(page, 'Create').first()).toContainText('Create goal')
})

test('creating a task carries the label and project pills', async ({ app, page }) => {
  await app.open('tasks')
  await openBar(page)
  await page.keyboard.type('go on a 4K run design')
  await expect(rowsIn(page, 'Filters').first()).toContainText('Filter by label: design')
  await page.keyboard.press('Tab')
  await page.keyboard.type('photography')
  await expect(rowsIn(page, 'Filters').first()).toContainText('Filter by project: Photography')
  await page.keyboard.press('Tab')
  await expect(pills(page)).toHaveText(['label: design', 'project: Photography'])
  await expect(group(page, 'Create').locator('[data-omnibar-row][data-selected="true"]')).toContainText('Create task')
  await page.keyboard.press('Enter')
  await expect(bar(page)).toHaveCount(0)
  await expect(page.getByText('Task created: "go on a 4K run"')).toBeVisible()
  const hits = await searchTasks(page, '4K run')
  expect(hits.map((h) => ({ labels: h.task.labels, project: h.task.project_id }))).toEqual([{ labels: ['label-design'], project: 'proj-photo' }])
})

test('Enter typed faster than the debounce opens the matching task', async ({ app, page }) => {
  await app.open('tasks')
  const ids = await seedSearch(page)
  await openBar(page)
  await page.keyboard.type('zephyr deck review')
  await page.keyboard.press('Enter') // well inside the 120 ms debounce
  await expect(bar(page)).toHaveCount(0)
  await expect.poll(() => detailId(page)).toBe(ids.title)
  expect(await searchTasks(page, 'zephyr deck review')).toHaveLength(1) // nothing was created
})

test("a pill that takes the whole query lists that project's tasks", async ({ app, page }) => {
  await app.open('tasks')
  await openBar(page)
  await page.keyboard.type('photography')
  await page.keyboard.press('Tab')
  await expect(field(page)).toHaveValue('')
  await expect(pills(page)).toHaveText(['project: Photography'])
  await expect(group(page, 'Tasks')).toContainText('Cull + edit Deftones set from The Fillmore')
})

test('a vault note shows in Docs with its marker and opens in Docs', async ({ app, page }) => {
  await app.open('tasks')
  await openBar(page)
  await page.keyboard.type('doors 7pm')
  const row = rowsIn(page, 'Docs').first()
  await expect(row).toContainText('Turnstile at the Warfield')
  await expect(row).toContainText('Vault')
  await page.keyboard.press('Enter')
  await expect(bar(page)).toHaveCount(0)
  await expect.poll(() => currentPage(page)).toBe('docs')
  await expect(page.locator('main').first()).toContainText('photo pit first three songs')
})

test('an empty bar shows recent searches and actions; an action runs', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openBar(page)
  await page.keyboard.type('zeph')
  await expect(rowsIn(page, 'Tasks').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(bar(page)).toHaveCount(0)
  await openBar(page)
  await expect(rowsIn(page, 'Recent').first()).toContainText('zeph')
  await expect(group(page, 'Actions')).toContainText('Go to Today')
  await page.keyboard.type('go sett')
  await expect(rowsIn(page, 'Actions')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect.poll(() => currentPage(page)).toBe('settings')
})

test('⌥C completes the highlighted task', async ({ app, page }) => {
  await app.open('tasks')
  const ids = await seedSearch(page)
  await openBar(page)
  await page.keyboard.type('zephyr deck review')
  await expect(rowsIn(page, 'Tasks').first()).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Alt+c')
  await expect(bar(page)).toHaveCount(0)
  await expect.poll(async () => (await searchTasks(page, 'zephyr deck review')).find((h) => h.task.id === ids.title)?.task.status).toBe('complete')
})

test('Escape closes and returns focus to where the bar was opened', async ({ app, page }) => {
  await app.open('tasks')
  const row = page.locator('main [data-nav-row="task-01"]')
  await row.focus()
  await openBar(page, 'Meta+f')
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)
  await expect(row).toBeFocused()
})

// ── Whole-branch review follow-ups ──

const tomorrow = (page: Page) =>
  page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })

/** Slow every `search_tasks` call by `ms` so stale rows stay on screen. */
const slowTaskSearch = (page: Page, ms: number) =>
  page.evaluate((delay) => {
    const internals = (window as unknown as Win).__TAURI_INTERNALS__
    const inner = internals.invoke
    internals.invoke = (cmd, args) =>
      cmd === 'search_tasks' ? new Promise((r) => setTimeout(r, delay)).then(() => inner(cmd, args)) : inner(cmd, args)
  }, ms)

test('fast Enter over stale rows still creates the task with its parsed date', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openBar(page)
  await page.keyboard.type('zeph')
  await expect(rowsIn(page, 'Tasks')).toHaveCount(3) // these rows go stale below
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('orthodontist tomorrow 3pm')
  await page.keyboard.press('Enter') // inside the debounce: the highlight is still on a zephyr row
  await expect(bar(page)).toHaveCount(0)
  const hits = (await searchTasks(page, 'orthodontist')) as unknown as { task: { content: string; due_date: string | null; due_time: string | null } }[]
  expect(hits.map((h) => [h.task.content, h.task.due_date, h.task.due_time])).toEqual([['orthodontist', await tomorrow(page), '15:00']])
})

test("a new session never shows the previous session's rows", async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openBar(page)
  await page.keyboard.type('zeph')
  await expect(rowsIn(page, 'Tasks')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)
  await slowTaskSearch(page, 3000)
  await openBar(page)
  await page.keyboard.type('zz')
  await page.waitForTimeout(400) // debounce passed, the slowed search still in flight
  expect(await rowsIn(page, 'Tasks').count()).toBe(0)
})

test('Escape then ⌘F at once reopens the bar (a fading bar is not an open overlay)', async ({ app, page }) => {
  await app.open('tasks')
  await openBar(page)
  await expect(group(page, 'Actions')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+f') // well inside the 200 ms fade-out
  await expect(field(page)).toBeFocused()
  await page.waitForTimeout(400) // past the old close timer
  await expect(bar(page)).toHaveCount(1)
  await expect(field(page)).toBeFocused()
})

test('a double Enter on a toggle action toggles once', async ({ app, page }) => {
  await app.open('tasks')
  const help = page.getByRole('button', { name: 'Keyboard shortcuts (?)' })
  await expect(help).toHaveAttribute('aria-expanded', 'false')
  await openBar(page)
  await page.keyboard.type('keyboard shortcuts')
  await expect(rowsIn(page, 'Actions')).toHaveCount(1)
  await expect(bar(page).getByRole('listbox')).not.toHaveAttribute('aria-busy', 'true')
  await expect(rowsIn(page, 'Actions').first()).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter') // lands during the fade-out
  await expect(bar(page)).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(help).toHaveAttribute('aria-expanded', 'true')
})

/** Axe over the bar alone, once its fade/slide-in animations have finished
 *  (a mid-fade scan measures contrast at partial opacity). */
async function axeBar(page: Page) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    return !!el && el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running')
  }, BAR)
  await expectNoNewAxeViolations(page, 'omnibar', { include: BAR })
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe (${theme})`, () => {
    test.use({ theme })

    test('the empty bar, then filters + results + create rows, then a pill, are violation-free', async ({ app, page }) => {
      await app.open('tasks')
      await seedSearch(page)
      await openBar(page)
      await expect(group(page, 'Actions')).toBeVisible()
      await axeBar(page)
      await page.keyboard.type('zeph comp')
      await expect(rowsIn(page, 'Filters').first()).toContainText('Filter by status: completed')
      await expect(group(page, 'Create')).toBeVisible()
      await axeBar(page)
      await page.keyboard.press('Tab')
      await expect(pills(page)).toHaveCount(1)
      await axeBar(page)
    })
  })
}
