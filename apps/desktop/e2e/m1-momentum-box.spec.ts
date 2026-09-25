/*
 * M1 — Momentum box on Today (Lane C Part 2, plan 2026-09-25-momentum.md → Task 9).
 * Mock: tools/mock-tauri.js "Momentum" block; ?momentum=paused|karma|dayoff|empty.
 * Mock TODAY is Sat 2026-08-01 with days off ['sun'] (default scenario):
 * week 21 done, today 3 of 5.
 * Run (frozen build only):
 *   BASE_URL=http://localhost:5303 npx playwright test -c e2e e2e/m1-momentum-box.spec.ts
 */
import type { Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations } from './fixtures'

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
// The Today page reads the local date; pin it to the mock's TODAY.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-08-01T09:00:00')) })

const box = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Momentum', exact: true }) })

test('wins first, then meters and a 7-day trend', async ({ app, page }) => {
  await app.open('today')
  const b = box(page)
  await expect(b.getByText('This week: 21 done')).toBeVisible()
  await expect(b.getByText('Send Dana the case-study draft')).toBeVisible()
  await expect(b.getByRole('progressbar', { name: 'Today' })).toBeVisible()
  await expect(b.getByRole('progressbar', { name: 'This week' })).toBeVisible()
  await expect(b.getByText('3 of 5')).toBeVisible()
  await expect(b.getByRole('img', { name: /^Last 7 days/ })).toBeVisible()
  await expect(b.getByText(/points|streak|level/i)).toHaveCount(0)
  await expectNoClipping(b, { allowEllipsis: true })
})

test('Pause and resume from the keyboard, with neutral copy', async ({ app, page }) => {
  await record(page)
  await app.open('today')
  const b = box(page)
  const trigger = b.getByRole('button', { name: 'Momentum options' })
  await trigger.focus()
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  const pause = page.getByRole('menuitem', { name: 'Pause momentum' })
  await expect(pause).toBeVisible()
  await pause.focus()
  await page.keyboard.press('Enter')
  await expect(b.getByText('Paused', { exact: true })).toBeVisible()
  await expect(b.getByRole('progressbar')).toHaveCount(0)
  expect((await calls(page, 'momentum_set_paused')).map((c) => c.args?.paused)).toEqual([true])

  await trigger.focus()
  await page.keyboard.press('Enter')
  const resume = page.getByRole('menuitem', { name: 'Resume momentum' })
  await resume.focus()
  await page.keyboard.press('Enter')
  await expect(b.getByRole('progressbar', { name: 'Today' })).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(b).not.toContainText(/since|while you were|welcome back|missed|away|gap/i)
})

test('a day off shows a neutral note instead of the today meter', async ({ app, page }) => {
  await app.open('today', 'momentum=dayoff')
  await expect(box(page).getByText(/^Day off/)).toBeVisible()
  await expect(box(page).getByRole('progressbar', { name: 'Today' })).toHaveCount(0)
})

test('karma parity adds one quiet line', async ({ app, page }) => {
  await app.open('today', 'momentum=karma')
  await expect(box(page).getByText('1,240 points · Novice · 4-day streak · 2-week streak')).toBeVisible()
})

test('an empty week reads "Your week starts here."', async ({ app, page }) => {
  await app.open('today', 'momentum=empty')
  await expect(box(page).getByText('Your week starts here.')).toBeVisible()
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ theme })
    test(`no new axe violations on Today with the Momentum box (${theme})`, async ({ app, page }) => {
      await app.open('today')
      await expect(box(page)).toBeVisible()
      await expectNoNewAxeViolations(page, 'today')
    })
  })
}
