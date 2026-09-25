/*
 * M2 — Goals & momentum settings + Activity stat tiles (plan 2026-09-25-momentum.md → Task 10).
 * The `settings-brief` and `today` axe rows come from brief phase 2 (merged main).
 * Run (frozen build only):
 *   BASE_URL=http://localhost:5303 npx playwright test -c e2e e2e/m2-momentum-settings-tiles.spec.ts
 */
import type { Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

type Call = { cmd: string; args: Record<string, unknown> | undefined }

async function record(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown> }
      __calls: Call[]
    }
    w.__calls = []
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
      w.__calls.push({ cmd, args: args as Call['args'] })
      return orig(cmd, args, opts)
    }
  })
}
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __calls: Call[] }).__calls.filter((x) => x.cmd === c), cmd)

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-08-01T09:00:00')) })

async function openBriefSettings(app: App, page: Page) {
  await app.open('settings')
  await page.evaluate(() => {
    const w = window as unknown as { __stores: { useSettingsNavStore: { setState(s: object): void } } }
    w.__stores.useSettingsNavStore.setState({ page: 'brief', pendingSection: 'momentum' })
  })
}

test('Goals & momentum: validate, save, pause from the keyboard, honest karma line', async ({ app, page }) => {
  await record(page)
  await openBriefSettings(app, page)
  const s = page.locator('section#momentum')
  await expect(s.getByRole('heading', { name: 'Goals & momentum' })).toBeVisible()
  await expect(s.getByLabel('Daily goal')).toHaveValue('5')
  await expect(s.getByLabel('Weekly goal')).toHaveValue('25')
  await expect(s.getByText(/points, levels, daily and weekly streaks, and −1 point/)).toBeVisible()

  await s.getByLabel('Daily goal').fill('0')
  await s.getByRole('button', { name: 'Save goals' }).click()
  await expect(s.getByRole('alert')).toHaveText('Daily goal must be a whole number from 1 to 100.')
  expect(await calls(page, 'goals_save')).toHaveLength(0)
  await expect(s.getByLabel('Daily goal')).toHaveValue('0')

  await s.getByLabel('Daily goal').fill('4')
  await s.getByRole('button', { name: 'Monday' }).click()
  await s.getByRole('button', { name: 'Save goals' }).click()
  await expect.poll(async () => (await calls(page, 'goals_save')).map((c) => c.args?.targets))
    .toEqual([{ daily: 4, weekly: 25, days_off: ['mon', 'sun'], karma_enabled: false }])

  const pause = s.getByRole('switch', { name: 'Pause momentum' })
  await pause.focus()
  await expectFocusRing(page)
  await page.keyboard.press('Space')
  await expect.poll(async () => (await calls(page, 'momentum_set_paused')).map((c) => c.args?.paused)).toEqual([true])
  await expect(pause).toHaveAttribute('aria-checked', 'true')
  await expectNoClipping(s)
})

test('axe settings-brief: no new violations', async ({ app, page }) => {
  await openBriefSettings(app, page)
  await expect(page.locator('section#today-brief, section#momentum').first()).toBeVisible()
  await expectNoNewAxeViolations(page, 'settings-brief')
})

test('Activity tab stat tiles follow the 7d / 30d / All toggle', async ({ app, page }) => {
  await record(page)
  await page.addInitScript(() => { try { localStorage.setItem('nimble.rightTab', 'activity') } catch { /* blocked */ } })
  await app.open('today')
  const tiles = page.getByRole('region', { name: 'Stats' })
  for (const label of ['Completed', 'Active days', 'Peak hour', 'Focused time']) {
    await expect(tiles.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(tiles.getByText('22', { exact: true })).toBeVisible()
  await expect(tiles.getByText('10 AM', { exact: true })).toBeVisible()
  await expect(tiles.getByText('3h 20m', { exact: true })).toBeVisible()
  const month = tiles.getByRole('button', { name: '30d' })
  await month.focus()
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect(tiles.getByText('87', { exact: true })).toBeVisible()
  await expect(tiles.getByText('14h', { exact: true })).toBeVisible()
  expect((await calls(page, 'momentum_summary')).some((c) => c.args?.range === '30d')).toBe(true)
  await expectNoClipping(tiles)
  await expectNoNewAxeViolations(page, 'today')
})
