// Harness smoke: every main page boots on mock data and has no axe violations
// beyond the baseline recorded on main.
import { test, expect, expectNoNewAxeViolations } from './fixtures'

const PAGES = ['today', 'tasks', 'inbox', 'docs', 'goals', 'settings']

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ theme })
    for (const id of PAGES) {
      test(`${id} boots and passes the axe baseline`, async ({ app, page }) => {
        await app.open(id)
        await expect(page.locator('main').first()).toBeVisible()
        await expectNoNewAxeViolations(page, id)
      })
    }
  })
}
