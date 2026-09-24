// L3-C builder checks for the LIST side of lane C (the QA contract in
// l3c-subtasks.spec.ts covers the detail page):
//   • the hover grip + checkbox on project / All tasks rows are pointer-
//     reachable at 1440 — the same clipping root cause as the subtask rows
//     (the cluster hung past the list scroller's overflow-x-hidden edge);
//   • the parent-reopen toast fires from a list row's status menu too (the
//     shared reopenTask path), and its "Reopen" is a Tab stop in WebKit.
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'

const MOCK_NOW = new Date('2026-08-01T10:00:00')

type Invoke = (cmd: string, args?: Record<string, unknown>, io?: unknown) => Promise<unknown>
type Recorded = { cmd: string; args: Record<string, unknown> | null }
type HarnessWindow = Window & { __TAURI_INTERNALS__: { invoke: Invoke }; __invokes: Recorded[] }

// `app` first: its init script installs the mock this wraps.
test.beforeEach(async ({ app, page }) => {
  void app
  await page.clock.setFixedTime(MOCK_NOW)
  await page.addInitScript(() => {
    const w = window as unknown as HarnessWindow
    w.__invokes = []
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, io) => {
      w.__invokes.push({ cmd, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) })
      return orig(cmd, args, io)
    }
  })
})

const row = (page: Page, id: string) => page.locator(`main [data-nav-row="${id}"]`)
const grip = (r: Locator) => r.getByRole('button', { name: 'Drag to reorder', exact: true })
const checkbox = (r: Locator) => r.getByRole('button', { name: /^(select|deselect)$/i })
const rowStatus = (r: Locator) => r.getByRole('button', { name: /^Status:/ }).first()

async function hittable(l: Locator) {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })
}

async function openPortfolio(page: Page) {
  await page.getByRole('navigation').getByText('Portfolio', { exact: true }).first().click()
  await expect(page.locator('main').first().getByRole('heading', { name: 'Portfolio' })).toBeVisible()
}

async function setStatus(page: Page, button: Locator, label: 'Complete' | 'Todo') {
  await button.click()
  const pop = page.locator('[role=dialog], [role=menu], [role=listbox]').filter({ visible: true }).first()
  await expect(pop).toBeVisible()
  await pop.getByRole('button', { name: label, exact: true }).click()
}

async function statusCalls(page: Page) {
  return page.evaluate(() =>
    (window as unknown as HarnessWindow).__invokes
      .filter((i) => i.cmd === 'update_task_status' && i.args)
      .map((i) => ({ id: String(i.args!.id), status: String(i.args!.status) })),
  )
}

test('project list rows: hovered grip and checkbox are pointer-reachable at 1440 (not clipped)', async ({ app, page }) => {
  await app.open('tasks')
  await openPortfolio(page)
  const r = row(page, 'task-01')
  await r.hover()
  await expect(grip(r)).toHaveCount(1)
  await expect(checkbox(r)).toHaveCount(1)
  expect(await hittable(grip(r)), 'grip not clipped').toBe(true)
  expect(await hittable(checkbox(r)), 'checkbox not clipped').toBe(true)
})

test('All tasks rows: hovered checkbox is pointer-reachable at 1440 (not clipped)', async ({ app, page }) => {
  await app.open('tasks')
  const r = page.locator('main [data-nav-row]').first()
  await r.hover()
  await expect(checkbox(r)).toHaveCount(1)
  expect(await hittable(checkbox(r)), 'checkbox not clipped').toBe(true)
})

test('reopening a cascaded parent from its list row offers "Reopen N subtasks too?"; Reopen is a Tab stop', async ({ app, page }) => {
  await app.open('tasks')
  await openPortfolio(page)
  const parent = row(page, 'task-01')
  await setStatus(page, rowStatus(parent), 'Complete')
  await expect(rowStatus(parent)).toHaveAccessibleName('Status: Complete')

  await page.clock.setFixedTime(new Date(MOCK_NOW.getTime() + 60_000))
  await setStatus(page, rowStatus(parent), 'Todo')
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: /reopen \d+ subtasks? too\?/i })
  await expect(toast).toHaveCount(1)
  await expect(toast).toContainText(/reopen 2 subtasks too\?/i)
  const reopen = toast.getByRole('button', { name: 'Reopen', exact: true })
  await expect(reopen, 'Tab-reachable in WebKit').toHaveAttribute('tabindex', '0')

  const before = (await statusCalls(page)).length
  await reopen.click()
  await expect
    .poll(async () => (await statusCalls(page)).slice(before).map((c) => `${c.id}:${c.status}`).sort())
    .toEqual(['task-02:todo', 'task-03:todo'])
  await expect(toast).toHaveCount(0)
})

test('reopening a parent completed without a cascade (subtasks done earlier) shows no toast', async ({ app, page }) => {
  await app.open('tasks')
  // Both subtasks done a minute before the parent: nothing for the cascade.
  await page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    await inv('update_task_status', { id: 'task-02', status: 'complete' })
    await inv('update_task_status', { id: 'task-03', status: 'complete' })
  })
  await page.clock.setFixedTime(new Date(MOCK_NOW.getTime() + 60_000))
  await openPortfolio(page)
  const parent = row(page, 'task-01')
  await setStatus(page, rowStatus(parent), 'Complete')
  await expect(rowStatus(parent)).toHaveAccessibleName('Status: Complete')
  await setStatus(page, rowStatus(parent), 'Todo')
  await expect(rowStatus(parent)).toHaveAccessibleName('Status: Todo')
  await page.waitForTimeout(300)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /reopen \d+ subtasks? too\?/i })).toHaveCount(0)
})

// ── Bulk Status → Todo (review finding 1): one combined offer ────────────

/** On Today: give task-09 a subtask, complete task-01 (cascades task-02,
 * task-03) and task-09 (cascades the new one) at 10:00, then move the clock
 * a minute on. Returns the new subtask's id. (Not task-04: it recurs, and a
 * recurring parent doesn't cascade.) */
async function cascadeTwoParentsOnToday(app: { open(id: string): Promise<void> }, page: Page) {
  await app.open('today')
  const extra = await page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    const t = (await inv('create_local_task', { content: 'Book the smog check', projectId: 'proj-life', parentId: 'task-09' })) as { id: string }
    await inv('update_task_status', { id: 'task-01', status: 'complete' })
    await inv('update_task_status', { id: 'task-09', status: 'complete' })
    window.dispatchEvent(new Event('tasks-changed'))
    return t.id
  })
  await page.clock.setFixedTime(new Date(MOCK_NOW.getTime() + 60_000))
  await expect(rowStatus(row(page, 'task-01'))).toHaveAccessibleName('Status: Complete')
  await expect(rowStatus(row(page, 'task-09'))).toHaveAccessibleName('Status: Complete')
  return extra
}

async function select(page: Page, id: string) {
  const r = row(page, id)
  await r.hover()
  await checkbox(r).click()
}

async function bulkTodo(page: Page) {
  const count = page.getByText(/^\s*\d+ selected\s*$/).filter({ visible: true }).first()
  await count.locator('xpath=..').getByRole('button', { name: /^\s*status\s*$/i }).click()
  await page.getByRole('menuitem', { name: /^\s*todo\s*$/i }).first().click()
}

const reopenOffer = (page: Page) => page.locator('[data-sonner-toast]').filter({ hasText: /reopen \d+ subtasks? too\?/i })

test('bulk Status → Todo on two cascaded parents shows ONE combined "Reopen 3 subtasks too?"; Reopen reopens exactly those', async ({ app, page }) => {
  const extra = await cascadeTwoParentsOnToday(app, page)
  await select(page, 'task-01')
  await select(page, 'task-09')
  const before = (await statusCalls(page)).length
  await bulkTodo(page)
  await expect(reopenOffer(page)).toHaveCount(1)
  await expect(reopenOffer(page)).toContainText(/reopen 3 subtasks too\?/i)
  const bulkCalls = (await statusCalls(page)).slice(before).map((c) => `${c.id}:${c.status}`).sort()
  expect(bulkCalls, 'the bulk change touches only the selected parents').toEqual(['task-01:todo', 'task-09:todo'])

  const mid = (await statusCalls(page)).length
  await reopenOffer(page).getByRole('button', { name: 'Reopen', exact: true }).click()
  await expect
    .poll(async () => (await statusCalls(page)).slice(mid).map((c) => `${c.id}:${c.status}`).sort())
    .toEqual([`${extra}:todo`, 'task-02:todo', 'task-03:todo'].sort())
  await expect(reopenOffer(page)).toHaveCount(0)
})

test('bulk Status → Todo on one cascaded parent + an unrelated open task counts only the parent\'s subtasks', async ({ app, page }) => {
  await app.open('today')
  await page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    await inv('update_task_status', { id: 'task-01', status: 'complete' })
    window.dispatchEvent(new Event('tasks-changed'))
  })
  await page.clock.setFixedTime(new Date(MOCK_NOW.getTime() + 60_000))
  await expect(rowStatus(row(page, 'task-01'))).toHaveAccessibleName('Status: Complete')
  await select(page, 'task-01')
  await select(page, 'task-04')
  await bulkTodo(page)
  await expect(reopenOffer(page)).toHaveCount(1)
  await expect(reopenOffer(page)).toContainText(/reopen 2 subtasks too\?/i)
})

test('bulk Status → Todo with nothing cascaded shows no offer', async ({ app, page }) => {
  await app.open('today')
  await select(page, 'task-04')
  await bulkTodo(page)
  await expect(rowStatus(row(page, 'task-04'))).toHaveAccessibleName('Status: Todo')
  await page.waitForTimeout(300)
  await expect(reopenOffer(page)).toHaveCount(0)
})
