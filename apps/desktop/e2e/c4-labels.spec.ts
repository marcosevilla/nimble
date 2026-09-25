/*
 * C4 — grouped labels. Spec: docs/superpowers/specs/2026-09-25-c4-labels-search-design.md §3.
 * Each test seeds its taxonomy through the mock's own commands after boot:
 *   Effort (Pick one): deep-work, quick-win · Type: design, bug · Integrations (system): from-instinct
 *   errand archived · stale-idea unused · task-01 carries deep-work, design, from-instinct.
 */
import { test, expect, expectNoNewAxeViolations, expectFocusRing } from './fixtures'
import type { Page } from '@playwright/test'

type Invoke = (cmd: string, args?: Record<string, unknown>, io?: unknown) => Promise<unknown>
type Recorded = { cmd: string; args: Record<string, unknown> | null }
type HarnessWindow = Window & { __TAURI_INTERNALS__: { invoke: Invoke }; __invokes: Recorded[] }

test.beforeEach(async ({ app, page }) => {
  void app // its init script installs the mock this wraps
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

const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as HarnessWindow).__invokes.filter((i) => i.cmd === c).map((i) => i.args), cmd)

async function seedTaxonomy(page: Page) {
  return page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    const effort = (await inv('create_label_group', { name: 'Effort', exclusive: true })) as { id: string }
    const type = (await inv('create_label_group', { name: 'Type', exclusive: false })) as { id: string }
    const sys = (await inv('create_label_group', { name: 'Integrations', exclusive: false })) as { id: string }
    await inv('update_label_group', { id: sys.id, patch: { system: true } })
    await inv('set_label_group', { labelId: 'label-deep-work', groupId: effort.id })
    await inv('set_label_group', { labelId: 'label-quick-win', groupId: effort.id })
    await inv('set_label_group', { labelId: 'label-design', groupId: type.id })
    await inv('set_label_group', { labelId: 'label-bug', groupId: type.id })
    const bot = (await inv('create_label', { name: 'from-instinct', color: 'gray' })) as { id: string }
    await inv('set_label_group', { labelId: bot.id, groupId: sys.id })
    const stale = (await inv('create_label', { name: 'stale-idea', color: 'gray' })) as { id: string }
    await inv('set_task_labels', { taskId: 'task-01', labelIds: ['label-deep-work', 'label-design', bot.id] })
    await inv('archive_labels', { ids: ['label-errand'] })
    window.dispatchEvent(new Event('tasks-changed'))
    return { effort: effort.id, type: type.id, stale: stale.id, bot: bot.id }
  })
}

test('picker: group sections, Pick-one radios, archived and system hidden, arrows cross sections', async ({ app, page }) => {
  await app.open('tasks')
  const ids = await seedTaxonomy(page)
  const row = page.locator('main [data-nav-row="task-01"]')
  await expect(row).toBeVisible()
  await row.focus()
  await page.keyboard.press('l')
  // Keyboard, not pointer: in the harness a pointer click on the nested
  // "Add label" (and on rows inside it) is swallowed — base build too.
  const add = page.getByRole('dialog').getByRole('button', { name: 'Add label' })
  await add.focus()
  await page.keyboard.press('Enter')

  const effort = page.getByRole('radiogroup', { name: 'Effort', exact: true })
  const type = page.getByRole('group', { name: 'Type', exact: true })
  await expect(effort).toBeVisible()
  await expect(type).toBeVisible()
  await expect(effort.getByRole('radio', { name: 'deep-work' })).toHaveAttribute('aria-checked', 'true')
  await effort.getByRole('radio', { name: 'quick-win' }).focus()
  await page.keyboard.press('Space')
  await expect(effort.getByRole('radio', { name: 'quick-win' })).toHaveAttribute('aria-checked', 'true')
  await expect(effort.getByRole('radio', { name: 'deep-work' })).toHaveAttribute('aria-checked', 'false')
  // Row pickers save through dp.tasks.update → `update_local_task` with `labelIds`.
  const last = (await calls(page, 'update_local_task')).at(-1) as { labelIds: string[] }
  expect(last.labelIds).toContain('label-quick-win')
  expect(last.labelIds).not.toContain('label-deep-work')
  expect(last.labelIds).toContain(ids.bot) // the hidden system label is kept

  const list = page.locator('[role=dialog]').last()
  await expect(list.getByText('errand', { exact: true })).toHaveCount(0)
  await expect(list.getByText('from-instinct', { exact: true })).toHaveCount(0)

  const field = page.getByRole('textbox', { name: 'Search or create a label' })
  await field.focus()
  await page.keyboard.press('ArrowDown')
  await expect(effort.getByRole('radio', { name: 'deep-work' })).toBeFocused()
  await expectFocusRing(page)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(type.getByRole('checkbox', { name: 'design' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(type.getByRole('checkbox', { name: 'design' })).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(field).toBeFocused()

  await field.fill('ERRAND')
  await expect(page.getByRole('button', { name: 'Restore "errand"' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore "errand"' })).toHaveAttribute('data-highlighted', '')
  // Enter acts on the highlighted row: the first match while typing.
  await field.fill('bu')
  await expect(type.getByRole('checkbox', { name: 'bug' }).locator('xpath=..')).toHaveAttribute('data-highlighted', '')
  await field.fill('from-instinct')
  await expect(list.getByText('System label — applied automatically')).toBeVisible()
  await field.fill('')
  await expectNoNewAxeViolations(page, 'c4-picker')
})

test('row chips hide system labels; the detail shows them muted', async ({ app, page }) => {
  await app.open('tasks')
  await seedTaxonomy(page)
  const row = page.locator('main [data-nav-row="task-01"]')
  await expect(row.getByText('deep-work')).toBeVisible()
  await expect(row.getByText('from-instinct')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __stores: { useDetailStore: { getState(): { openTask(id: string): void } } } }).__stores.useDetailStore.getState().openTask('task-01'))
  await expect(page.locator('main').getByText('from-instinct')).toBeVisible()
})

test('label filter: grouped sections, system last, archived absent', async ({ app, page }) => {
  await app.open('tasks')
  await seedTaxonomy(page)
  await page.getByTestId('task-list-header').getByRole('button', { name: /^(All|\d+ filters?)$/ }).click()
  const menu = page.getByRole('menu')
  const headings = await menu.locator('[data-slot="dropdown-menu-label"]').allInnerTexts()
  const order = headings.map((h) => h.trim()).filter((h) => ['Effort', 'Type', 'Ungrouped', 'Integrations'].includes(h))
  expect(order.at(-1)).toBe('Integrations')
  expect(order.indexOf('Effort')).toBeLessThan(order.indexOf('Type'))
  await expect(menu.getByRole('menuitem', { name: 'errand' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'from-instinct' })).toBeVisible()
})

test('label filter keeps a selected archived label listed (muted) so it can be removed', async ({ app, page }) => {
  await app.open('tasks')
  await seedTaxonomy(page)
  const header = page.getByTestId('task-list-header')
  await header.getByRole('button', { name: /^(All|\d+ filters?)$/ }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'deep-work' }).click() // include
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    await inv('archive_labels', { ids: ['label-deep-work'] })
    window.dispatchEvent(new Event('tasks-changed'))
  })
  await header.getByRole('button', { name: /^\d+ filters?$/ }).click()
  const item = page.getByRole('menu').getByRole('menuitem', { name: /deep-work/ })
  await expect(item).toBeVisible()
  await expect(item).toContainText('archived')
})

test('Label Manager: ⌥↑ moves a label into the group above, Pick one, archive unused + Undo, restore, group delete Undo', async ({ app, page }) => {
  await app.open('settings', 'settings=tasks')
  const ids = await seedTaxonomy(page)
  const section = page.locator('#labels')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByRole('textbox', { name: 'Group name Effort' })).toBeVisible()

  // bug sits under design in Type: ⌥↑ reorders inside Type, a second ⌥↑ crosses into Effort.
  const grip = section.getByRole('button', { name: 'Drag label bug' })
  await grip.focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(grip).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(async () => (await calls(page, 'set_label_group')).at(-1)).toEqual({ labelId: 'label-bug', groupId: ids.effort })
  expect((await calls(page, 'reorder_labels')).length).toBeGreaterThan(0)

  await section.getByRole('switch', { name: 'Pick one in Type' }).click()
  await expect.poll(async () => (await calls(page, 'update_label_group')).at(-1)).toEqual({ id: ids.type, patch: { exclusive: true } })

  await section.getByRole('button', { name: 'Archive unused' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Archive 1 label with no open tasks?')
  await expect(confirm).toContainText('They stay on completed tasks and you can restore them.')
  await confirm.getByRole('button', { name: 'Archive 1' }).click()
  await expect.poll(async () => (await calls(page, 'archive_labels')).at(-1)).toEqual({ ids: [ids.stale] })
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Archived 1 label' }).getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await calls(page, 'restore_labels')).at(-1)).toEqual({ ids: [ids.stale] })

  await section.getByRole('button', { name: /^Archived/ }).click()
  await section.getByRole('button', { name: 'Restore errand' }).click()
  await expect.poll(async () => (await calls(page, 'restore_labels')).at(-1)).toEqual({ ids: ['label-errand'] })

  await section.getByRole('button', { name: 'More for group Type' }).click()
  await page.getByRole('menuitem', { name: 'Delete group' }).click()
  await expect(section.getByRole('textbox', { name: 'Group name Type' })).toHaveCount(0)
  await expect(section.getByRole('textbox', { name: 'Rename design' })).toBeVisible() // now under Ungrouped
  await page.locator('[data-sonner-toast]').filter({ hasText: /Group "Type" deleted/ }).getByRole('button', { name: 'Undo' }).click()
  await expect(section.getByRole('textbox', { name: 'Group name Type' })).toBeVisible()
  expect(await calls(page, 'delete_label_group')).toEqual([])

  await expectNoNewAxeViolations(page, 'settings')
})
