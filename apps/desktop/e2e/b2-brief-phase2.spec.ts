/*
 * B2 — Morning brief phase 2: registry, settings, setup, weather.
 * Plan: docs/superpowers/plans/2026-09-25-brief-phase-2.md (Task 10).
 *
 * Mock switches (tools/mock-tauri.js): ?setup=fresh (never set up, no
 * location), ?weather=fresh|stale|none|unavailable, and
 * window.__MOCK_BRIEF_SETTINGS__ (read on the first brief_settings_* call).
 * The clock is pinned to the mock's TODAY (2026-08-01 07:00) so the weather
 * forecast and events line up.
 *
 * Axe: each check is held to its page's recorded baseline (`today`,
 * `settings`, plus `:dark`). Those rows already carry the dev-only
 * Agentation toolbar and the page scroller, so anything the brief adds
 * (a new rule, or more nodes) still fails.
 *
 * Run (frozen build only):
 *   tools/qa-frozen.sh <sha> <scratch>/qa-b2 <port>
 *   BASE_URL=http://localhost:<port> npx playwright test -c e2e e2e/b2-brief-phase2.spec.ts
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

type Call = { cmd: string; args: Record<string, unknown> | undefined }
type Entry = { id: string; enabled: boolean; config?: Record<string, unknown> }
const MOCK_NOW = new Date('2026-08-01T07:00:00')

/** Open a page with every invoke recorded, the clock pinned and optional brief settings seeded. */
async function openWithSpy(app: App, page: Page, pageId: string, opts: { query?: string; seed?: Record<string, unknown> } = {}) {
  await page.clock.setFixedTime(MOCK_NOW)
  await page.addInitScript((seed) => {
    const w = window as unknown as {
      __MOCK_BRIEF_SETTINGS__?: unknown
      __calls: { cmd: string; args: unknown }[]
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown> }
    }
    if (seed) w.__MOCK_BRIEF_SETTINGS__ = seed
    w.__calls = []
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, o) => {
      w.__calls.push({ cmd, args })
      return orig(cmd, args, o)
    }
  }, opts.seed ?? null)
  await app.open(pageId, opts.query ?? '')
}

async function calls(page: Page, cmd: string): Promise<Call[]> {
  const all = await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
  return all.filter((c) => c.cmd === cmd)
}

async function lastSavedModules(page: Page): Promise<Entry[] | undefined> {
  const saves = await calls(page, 'brief_settings_save')
  return (saves.at(-1)?.args?.patch as { modules?: Entry[] } | undefined)?.modules
}

const briefBody = (page: Page) => page.getByRole('region', { name: "Today's brief" })
const chip = (page: Page) => page.getByRole('button', { name: /^Weather:/ })
const titles = async (scope: Locator) => (await scope.locator('h2, h3').allInnerTexts()).map((t) => t.replace(/\s*\d+\s*$/, '').trim())

test.describe('B2 brief phase 2', () => {
  test('AC1 Today renders the saved box order and leaves hidden boxes out', async ({ app, page }) => {
    const modules: Entry[] = [
      { id: 'due_today', enabled: true }, { id: 'schedule', enabled: true },
      { id: 'still_open', enabled: false }, { id: 'priorities', enabled: true },
    ]
    await openWithSpy(app, page, 'today', { seed: { modules } })
    const names = await titles(briefBody(page))
    expect(names.slice(0, 3)).toEqual(['Due today', 'Schedule', 'Top priorities'])
    expect(names).not.toContain('Still open')
  })

  test('AC2 the weather chip: high/low + rain chance; Enter opens place, hours, rain note, attribution', async ({ app, page }) => {
    await openWithSpy(app, page, 'today')
    await expect(chip(page)).toContainText('70°/57° · 60%')
    await chip(page).focus()
    await expectFocusRing(page)
    await page.keyboard.press('Enter')
    const pop = page.getByRole('dialog')
    await expect(pop).toContainText('San Francisco, California')
    await expect(pop.getByRole('list', { name: 'Next hours' }).getByRole('listitem')).toHaveCount(4)
    await expect(pop).toContainText('Rain likely 7 pm to 10 pm')
    await expect(pop).toContainText('Rain likely during Turnstile @ The Warfield — photo pass (7:00)')
    await expect(pop).toContainText(/as of \d{1,2}:\d{2} · Open-Meteo/)
    await expectNoClipping(pop, { allowEllipsis: true })
    await expectNoNewAxeViolations(page, 'today')
  })

  test('AC3a offline shows the last forecast "as of"', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'weather=stale' })
    await expect(chip(page)).toContainText(/as of \d{1,2}:\d{2}/)
  })

  test('AC3b no location offers Add location, which opens Settings → Location & weather', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'weather=none' })
    await page.getByRole('button', { name: 'Add location' }).click()
    await expect(page.locator('#today-location')).toBeInViewport()
  })

  test('AC4 compact (b) moves the chip into the strip; one chip at a time', async ({ app, page }) => {
    await openWithSpy(app, page, 'today')
    await expect(chip(page)).toBeVisible()
    await page.keyboard.press('b')
    const strip = page.locator('[data-brief-strip]')
    await expect(strip.getByRole('button', { name: /^Weather:/ })).toBeVisible()
    await expect(chip(page)).toHaveCount(1)
    await expect(strip).toContainText('Next:')
    await expectNoClipping(strip, { allowEllipsis: true })
  })

  test('AC5 Settings → Today & brief: three sections; Boxes toggles and ⌥↓ save and keep focus', async ({ app, page }) => {
    await openWithSpy(app, page, 'settings', { query: 'settings=brief' })
    for (const name of ['Brief', 'Location & weather', 'Boxes']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    const list = page.getByRole('list', { name: 'Boxes' })
    await expect(list.locator('[data-box-row="weather"]')).toContainText('Weather chip')
    await list.getByRole('switch', { name: 'Show Still open' }).click()
    await expect.poll(async () => (await lastSavedModules(page))?.find((m) => m.id === 'still_open')?.enabled).toBe(false)
    await list.locator('[data-box-row="schedule"]').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(async () => (await lastSavedModules(page))?.map((m) => m.id).slice(0, 3)).toEqual(['weather', 'priorities', 'schedule'])
    await expect(list.locator('[data-box-row="schedule"]')).toBeFocused()
    await expectFocusRing(page)
    await list.getByRole('button', { name: 'Still open options' }).click()
    await list.getByRole('radio', { name: '10' }).or(list.getByRole('button', { name: '10', exact: true })).click()
    await expect.poll(async () => (await lastSavedModules(page))?.find((m) => m.id === 'still_open')?.config).toEqual({ count: 10 })
    await expectNoNewAxeViolations(page, 'settings')
  })

  test('AC6 rapid Boxes changes: the last save equals the last visible state', async ({ app, page }) => {
    await openWithSpy(app, page, 'settings', { query: 'settings=brief' })
    const list = page.getByRole('list', { name: 'Boxes' })
    await list.getByRole('switch', { name: 'Show Still open' }).click()
    await list.locator('[data-box-row="schedule"]').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await list.getByRole('switch', { name: 'Show Notes' }).click()
    await expect.poll(async () => {
      const m = await lastSavedModules(page)
      return m && { order: m.map((x) => x.id).slice(0, 3), still: m.find((x) => x.id === 'still_open')?.enabled, notes: m.find((x) => x.id === 'notes')?.enabled }
    }).toEqual({ order: ['weather', 'priorities', 'schedule'], still: false, notes: true })
    const visible = await list.locator('[data-box-row]').evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.boxRow))
    expect(visible.slice(0, 3)).toEqual(['weather', 'priorities', 'schedule'])
  })

  test('AC7 exit test: a fresh profile sees setup once, ↵ ×6 finishes in under 60 s and lands on a working brief', async ({ app, page }) => {
    const started = Date.now()
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    for (let n = 1; n <= 6; n++) {
      await expect(page.getByText(`Step ${n} of 6`)).toBeVisible()
      await page.keyboard.press('Enter')
    }
    await expect(briefBody(page)).toBeVisible()
    await expect(briefBody(page)).toBeFocused()
    expect(Date.now() - started).toBeLessThan(60_000)
    const saves = await calls(page, 'brief_settings_save')
    expect(saves).toHaveLength(1)
    expect(saves[0].args?.patch).toMatchObject({ complete_setup: true, time: '06:30', location: null, goals: { daily: 5, weekly: 25, days_off: ['sat', 'sun'] } })
    await expect(page.getByRole('button', { name: 'Add location' })).toBeVisible()
    await page.reload()
    await expect(page.getByText(/Step \d of 6/)).toHaveCount(0)
  })

  test('AC8 Enter in the city search picks a city and stays; Esc then skips and keeps it', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    await page.keyboard.press('Enter')
    await expect(page.getByText('Step 2 of 6')).toBeVisible()
    const search = page.getByRole('combobox', { name: 'Search for a city' })
    await search.fill('San')
    await expect(page.getByRole('option', { name: /San Francisco/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Step 2 of 6')).toBeVisible()
    await expect(page.getByText('San Francisco, California', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(briefBody(page)).toBeVisible()
    const saves = await calls(page, 'brief_settings_save')
    expect(saves).toHaveLength(1)
    expect(saves[0].args?.patch).toMatchObject({ complete_setup: true, location: { name: 'San Francisco, California', tz: 'America/Los_Angeles' } })
  })

  test('AC9 the preview follows the draft: Minimal drops Top priorities', async ({ app, page }) => {
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    const preview = page.locator('[data-setup-preview]')
    await expect.poll(async () => titles(preview)).toContain('Top priorities')
    await page.getByRole('button', { name: /^Minimal/ }).click()
    await expect.poll(async () => titles(preview)).not.toContain('Top priorities')
    expect(await titles(preview)).toContain('Schedule')
    await expect(page.getByText('Step 1 of 6')).toBeVisible()
  })

  test('AC10 a phase-1 past brief still renders; an unknown box shows the Mac placeholder', async ({ app, page }) => {
    await openWithSpy(app, page, 'today')
    await page.keyboard.press('[')
    await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible()
    await expect(page.getByText('Open in Nimble for Mac to see this box.')).toBeVisible()
  })

  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme })
      test(`AC11 setup: axe, no clipping, focus ring on controls (${theme})`, async ({ app, page }) => {
        await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
        const panel = page.getByRole('region', { name: 'Choose a starting layout' })
        await expect(panel).toBeVisible()
        await expectNoClipping(panel, { allowEllipsis: true })
        await page.keyboard.press('Tab')
        await expectFocusRing(page)
        await expectNoNewAxeViolations(page, 'today')
      })
      test(`AC12 Settings → Today & brief passes axe (${theme})`, async ({ app, page }) => {
        await openWithSpy(app, page, 'settings', { query: 'settings=brief' })
        await expect(page.getByRole('list', { name: 'Boxes' })).toBeVisible()
        await expectNoNewAxeViolations(page, 'settings')
      })
    })
  }

  test('AC13 a narrow Today column hides the preview and keeps the step usable (UX checkpoint 3)', async ({ app, page }) => {
    await page.setViewportSize({ width: 1024, height: 700 })
    await openWithSpy(app, page, 'today', { query: 'setup=fresh' })
    await expect(page.getByText('Step 1 of 6')).toBeVisible()
    // The rule is the container width (46rem = 736px), not the viewport:
    // the nav and right rail decide how wide the Today column is.
    const width = await page.locator('section[aria-labelledby="today-setup-title"]').evaluate((el) => el.getBoundingClientRect().width)
    if (width < 736) await expect(page.locator('[data-setup-preview]')).toBeHidden()
    else await expect(page.locator('[data-setup-preview]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeInViewport()
    await expectNoClipping(page.locator('section[aria-labelledby="today-setup-title"]'), { allowEllipsis: true })
  })
})
