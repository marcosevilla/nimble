/*
 * C4 — ⌘F task search. Spec §4.3. Seeds three "zephyr" tasks through the mock:
 * an open title match, an open description match, a completed title match.
 */
import { test, expect, expectNoNewAxeViolations, expectFocusRing } from './fixtures'
import type { Page } from '@playwright/test'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
type Win = Window & {
  __TAURI_INTERNALS__: { invoke: Invoke }
  __stores: {
    useDetailStore: { getState(): { target: { type: string; id: string } | null } }
    useAppStore: { getState(): { currentPage: string } }
  }
}

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

const search = (page: Page) => page.getByRole('dialog', { name: 'Search tasks' })
const input = (page: Page) => search(page).getByRole('combobox', { name: 'Search tasks' })

async function openAndType(page: Page, q: string) {
  await page.keyboard.press('Meta+f')
  await expect(search(page)).toBeVisible()
  await input(page).fill(q)
}

test('open results first, completed after, highlights and a description snippet', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openAndType(page, 'zeph')
  const open = search(page).getByRole('group', { name: 'Open' })
  const completed = search(page).getByRole('group', { name: 'Completed' })
  await expect(open.getByRole('option')).toHaveCount(2)
  await expect(open.getByRole('option').first()).toContainText('Zephyr deck review')
  await expect(open.getByRole('option').nth(1)).toContainText('about the zephyr deck')
  await expect(open.getByRole('option').nth(1).locator('mark')).toHaveText('zephyr')
  await expect(completed.getByRole('option')).toHaveCount(1)
  await expect(completed.getByRole('option').first()).toContainText(/Old zephyr draft\s*[A-Z][a-z]{2} \d{1,2}/)
  await expectNoNewAxeViolations(page, 'task-search')
})

test('↓ then Enter opens the task in detail and closes search', async ({ app, page }) => {
  await app.open('tasks')
  const ids = await seedSearch(page)
  await openAndType(page, 'zeph')
  await expect(search(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(search(page)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__stores.useDetailStore.getState().target?.id)).toBe(ids.desc)
})

test('⌘Enter opens the project with the row selected', async ({ app, page }) => {
  await app.open('today')
  const ids = await seedSearch(page)
  await openAndType(page, 'zephyr deck review')
  await expect(search(page).getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Meta+Enter')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__stores.useAppStore.getState().currentPage)).toBe('tasks')
  await expect(page.locator(`main [data-nav-row="${ids.title}"]`)).toBeFocused()
})

test('Escape closes and returns focus to where ⌘F was pressed', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  const row = page.locator('main [data-nav-row="task-01"]')
  await row.focus()
  await page.keyboard.press('Meta+f')
  await expect(input(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search(page)).toHaveCount(0)
  await expect(row).toBeFocused()
})

test('filters: Tab reaches the chips; Completed narrows; no results lists filters and clears them', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openAndType(page, 'zeph')
  await page.keyboard.press('Tab')
  const status = search(page).getByRole('button', { name: /^Status:/ })
  await expect(status).toBeFocused()
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await page.getByRole('menuitemradio', { name: 'Completed' }).click()
  await expect(search(page).getByRole('group', { name: 'Open' })).toHaveCount(0)
  await expect(search(page).getByRole('group', { name: 'Completed' }).getByRole('option')).toHaveCount(1)

  await input(page).fill('qqqzzz')
  await expect(search(page)).toContainText('No tasks match "qqqzzz". Filters: Completed.')
  await search(page).getByRole('button', { name: 'Clear filters' }).click()
  await expect(status).toHaveAccessibleName('Status: Any status')
})

test('⌘K "/search " hands over to ⌘F; ⌘F stays shut while another overlay is open', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await page.keyboard.press('Meta+k')
  const bar = page.getByRole('dialog', { name: 'Command bar' })
  await expect(bar).toBeVisible()
  await page.keyboard.press('Meta+f')
  await expect(search(page)).toHaveCount(0)
  await expect(bar.getByRole('textbox')).toBeFocused() // ⌘K focuses its field a frame after opening
  await page.keyboard.type('/search ')
  await expect(bar).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  await page.keyboard.type('zeph')
  await expect(search(page).getByRole('option').first()).toContainText('Zephyr deck review')
})

test('recent searches show on an empty query', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openAndType(page, 'zeph')
  await expect(search(page).getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(search(page)).toHaveCount(0)
  await page.keyboard.press('Meta+f')
  const recent = search(page).getByRole('group', { name: 'Recent' })
  await expect(recent.getByRole('option', { name: 'zeph' })).toBeVisible()
})

test.describe('dark theme', () => {
  test.use({ theme: 'dark' })

  test('axe: search results are violation-free (dark)', async ({ app, page }) => {
    await app.open('tasks')
    await seedSearch(page)
    await openAndType(page, 'zeph')
    await expect(search(page).getByRole('option').first()).toBeVisible()
    await expectNoNewAxeViolations(page, 'task-search')
  })
})
