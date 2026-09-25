/*
 * B3 — Morning brief phase 3: composed AI slots, Quick wins, Regenerate.
 * Plan: docs/superpowers/plans/2026-09-25-brief-phase-3.md → Task 10.
 *
 * Mock contract (tools/mock-tauri.js): brief_compose_if_due and
 * brief_regenerate resolve after 800 ms (driven by page.clock); ?brief=fallback
 * makes the AI unavailable. Composed rows: priorities task-01/04/05, I can help
 * task-06/12, Only you task-10/09. The page clock starts on mock TODAY.
 *
 * Run (frozen build only; Lane A uses port 5301):
 *   tools/qa-frozen.sh <sha> <scratch>/qa-b3 5301
 *   BASE_URL=http://localhost:5301 npx playwright test -c e2e e2e/b3-brief-compose.spec.ts
 */
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'
import type { Locator, Page } from '@playwright/test'

type Call = [string, Record<string, unknown> | undefined]
const MOCK_MORNING = new Date('2026-08-01T07:30:00')

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => unknown }
      __calls: unknown[]
      __copied: string[]
    }
    const core = w.__TAURI_INTERNALS__
    const base = core.invoke
    w.__calls = []
    core.invoke = (cmd: unknown, args: unknown, o: unknown) => {
      w.__calls.push([cmd, args ? JSON.parse(JSON.stringify(args)) : args])
      return base(cmd, args, o)
    }
    w.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t: string) => { w.__copied.push(t); return Promise.resolve() } },
    })
  })
}

async function calls(page: Page, cmd: string): Promise<Call[]> {
  const all = (await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)) as Call[]
  return all.filter(([c]) => c === cmd)
}

async function boot(page: Page, app: App, query = '') {
  await page.clock.install({ time: MOCK_MORNING })
  await instrument(page)
  await app.open('today', query)
}

async function advance(page: Page, ms: number) {
  for (let t = 0; t < ms; t += 250) await page.clock.runFor(Math.min(250, ms - t))
}

const box = (page: Page, title: string): Locator =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
const toast = (page: Page, text: string) => page.locator('[data-sonner-toast]').filter({ hasText: text })

test('AI slots show skeletons, then fill from one first-open compose', async ({ page, app }) => {
  await boot(page, app)
  await expect(box(page, 'Top priorities').locator('[data-slot="skeleton"]').first()).toBeVisible()
  await expect(box(page, 'Quick wins').locator('[data-slot="skeleton"]').first()).toBeVisible()
  await advance(page, 1000)
  const priorities = box(page, 'Top priorities')
  await expect(priorities.getByText('Refresh portfolio case study: Canary check-in redesign')).toBeVisible()
  await expect(priorities.getByText('Review is at 11:30; the draft is the input.')).toBeVisible()
  await expect(priorities.locator('[data-slot="skeleton"]')).toHaveCount(0)
  await expect(page.getByText('A lighter morning: one call, then open time after lunch.')).toBeVisible()
  expect(await calls(page, 'brief_compose_if_due')).toEqual([['brief_compose_if_due', { date: '2026-08-01' }]])
  expect(await calls(page, 'generate_priorities')).toHaveLength(0)
})

test('Quick wins: two columns, actions only where Claude can help', async ({ page, app }) => {
  await boot(page, app)
  await advance(page, 1000)
  const help = box(page, 'Quick wins').getByRole('group', { name: 'I can help' })
  const solo = box(page, 'Quick wins').getByRole('group', { name: 'Only you' })
  await expect(help.getByText('Design empty states for Goals page')).toBeVisible()
  await expect(help.getByText('Claude can draft the three empty-state lines.')).toBeVisible()
  await expect(help.getByRole('button', { name: 'Break it down' })).toHaveCount(2)
  await expect(help.getByRole('button', { name: 'Copy for Claude' })).toHaveCount(2)
  await expect(solo.getByText('Book dentist appointment')).toBeVisible()
  await expect(solo.getByRole('button', { name: /Break it down|Copy for Claude/ })).toHaveCount(0)
  await expectNoClipping(box(page, 'Quick wins'), { allowEllipsis: true })
})

test('Break it down adds subtasks under the task; Undo removes exactly those', async ({ page, app }) => {
  await boot(page, app)
  await advance(page, 1000)
  const help = box(page, 'Quick wins').getByRole('group', { name: 'I can help' })
  await help.getByRole('button', { name: 'Break it down' }).first().click()
  await expect(toast(page, 'Added 4 subtasks')).toBeVisible()
  expect(await calls(page, 'break_down_task')).toHaveLength(1)
  expect((await calls(page, 'create_local_task')).map(([, a]) => a?.parentId)).toEqual(['task-06', 'task-06', 'task-06', 'task-06'])
  const produced = (await calls(page, 'brief_item_set_state')).at(-1)?.[1]
  expect(produced).toMatchObject({ id: '2026-08-01:quick_help:task-06', state: 'produced', actionKind: 'break_down' })
  await expect(help.getByText('4 subtasks added')).toBeVisible()
  await toast(page, 'Added 4 subtasks').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await calls(page, 'delete_local_task')).length).toBe(4)
  expect((await calls(page, 'delete_local_task')).map(([, a]) => a?.id)).toEqual(JSON.parse(String(produced?.producedRef)))
  await expect.poll(async () => (await calls(page, 'brief_item_set_state')).at(-1)?.[1]?.state).toBe('none')
  await expect(help.getByRole('button', { name: 'Break it down' })).toHaveCount(2)
})

test('Copy for Claude puts that task’s focus prompt on the clipboard', async ({ page, app }) => {
  await boot(page, app)
  await advance(page, 1000)
  await box(page, 'Quick wins').getByRole('button', { name: 'Copy for Claude' }).first().click()
  await expect(toast(page, 'Copied. Paste into Claude Code.')).toBeVisible()
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)
  expect(copied).toHaveLength(1)
  expect(copied[0]).toMatch(/^Help me with this task from Nimble Focus\./)
  expect(copied[0]).toContain('**Task:** Design empty states for Goals page')
})

test('AI unavailable: rule-based rows and the fallback line', async ({ page, app }) => {
  await boot(page, app, 'brief=fallback')
  await advance(page, 1000)
  await expect(page.getByText('Sorted by priority. AI unavailable.')).toBeVisible()
  const priorities = box(page, 'Top priorities')
  await expect(priorities.getByText('Refresh portfolio case study: Canary check-in redesign')).toBeVisible()
  await expect(priorities.getByText('Review is at 11:30; the draft is the input.')).toHaveCount(0)
})

test('⋯ → Regenerate brief recomposes today', async ({ page, app }) => {
  await boot(page, app)
  await advance(page, 1000)
  await page.getByRole('button', { name: 'Brief options' }).click()
  await page.getByRole('menuitem', { name: 'Regenerate brief' }).click()
  await advance(page, 1000)
  expect(await calls(page, 'brief_regenerate')).toEqual([['brief_regenerate', { date: '2026-08-01' }]])
})

test('a past brief is read-only and keeps its free-text priorities', async ({ page, app }) => {
  await boot(page, app)
  await advance(page, 1000)
  await page.keyboard.press('[')
  await expect(box(page, 'Top priorities').getByText('Send the Canary case study draft to Jordan for feedback')).toBeVisible()
  await expect(page.getByRole('button', { name: /Break it down|Copy for Claude/ })).toHaveCount(0)
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ theme })
    test('keyboard reaches both actions with a visible ring; no new axe violations', async ({ page, app }) => {
      await boot(page, app)
      await advance(page, 1000)
      const help = box(page, 'Quick wins').getByRole('group', { name: 'I can help' })
      await help.getByRole('button', { name: 'Break it down' }).first().focus()
      await expectFocusRing(page)
      await page.keyboard.press('Tab')
      await expect(help.getByRole('button', { name: 'Copy for Claude' }).first()).toBeFocused()
      await expectFocusRing(page)
      await expectNoNewAxeViolations(page, 'today')
    })
  })
}
