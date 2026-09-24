/*
 * T5 — Habits: drop the hold ring (loop2/c3-t5-habit-ring)
 * Plan: docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "T5"
 *
 * ── Contract for the builder ────────────────────────────────────────────────
 * Render sites: `HabitsSection` renders only in the right rail's Habits tab
 * (`components/layout/RightSidebar.tsx`), which every page except Settings
 * shows. These specs open it by seeding localStorage `nimble.rightTab=habits`.
 *
 * Circles are found as buttons inside `role="group"` named "Today's habits",
 * excluding the "Add habit" trigger. Keep that group and its label.
 *
 * 1. No hold. `HabitCircle` has no hold timer/state and no SVG progress ring:
 *    while the pointer is held (700 ms) no `svg` other than the lucide icon
 *    (`svg.lucide`) and no `[stroke-dasharray]` appears inside the circle, and
 *    nothing is logged until the pointer is released (the click logs it).
 *    Tooltip / name / description must not mention "hold".
 * 2. Toggle. Click, Enter and Space each call `log_habit` (not done → done) or
 *    `unlog_habit` (done → not done) exactly once. `log_habit` args carry
 *    `habitId` and either `intensity: 5` or no intensity (backend default is 5,
 *    `nimble-core/src/db/habits.rs:230`); anything else fails. The done visual
 *    keeps its ✓ badge inside the button.
 * 3. Keyboard + name. Tab from "Manage habits" reaches every circle. WebKit
 *    (and the real WKWebView) skips a plain <button> without an explicit
 *    `tabIndex={0}` — that's why this fails on main today. Each focused circle
 *    shows a ring (`expectFocusRing`). Accessible name starts with the habit
 *    name and states today's state:
 *      done     → matches /^<Name>\b.*\bdone\b/i and does NOT contain "not"
 *      not done → matches /^<Name>\b.*\bnot (yet )?done\b/i
 *    Suggested: "Journal, done today" / "Journal, not done today".
 *    `aria-pressed` is optional (nothing here reads it).
 * 4. Layout. Circle stays 40×40, its column 56 px wide and ~70.3 px tall with
 *    the circle at (8, 0) inside it (measured on main 646d595 at 1440×900);
 *    no clipped text in the Habits panel.
 * 5. Mock (`tools/mock-tauri.js`). `log_habit` / `unlog_habit` persist in
 *    memory, so `get_habits` reflects them after the store's reload, and
 *    `log_habit` defaults intensity to 5 like the backend. Don't change other
 *    mock data: the four active habits stay Gym, Read, Walk = done and
 *    Journal = not done on the mock's TODAY (these specs rely on Journal).
 * 6. No new axe violations on `today` and `goals` with the Habits tab open.
 *
 * Run (frozen build only):
 *   BASE_URL=http://localhost:4600 npx playwright test -c e2e e2e/t5-habit-ring.spec.ts
 * Screenshots: add SHOT_DIR=<dir> and -g screenshots.
 */
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

type Call = { cmd: string; args: Record<string, unknown> | undefined; at: number }

const HABITS = [
  { name: 'Gym', done: true },
  { name: 'Read', done: true },
  { name: 'Journal', done: false },
  { name: 'Walk', done: true },
]

// Measured on main 646d595 (frozen :4600), WebKit 1440×900.
const MAIN_CIRCLE = { width: 40, height: 40 }
const MAIN_COLUMN = { width: 56, height: 70.3, circleDx: 8, circleDy: 0 }

const RING = 'svg:not(.lucide), [stroke-dasharray]'

/** Opens `pageId` with the Habits tab selected and every Tauri invoke recorded. */
async function openHabits(app: App, page: Page, pageId = 'today') {
  await page.addInitScript(() => {
    try { localStorage.setItem('nimble.rightTab', 'habits') } catch { /* storage blocked */ }
  })
  // Registered after the fixture's mock, so it wraps the mock's invoke.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown> }
      __calls: Call[]
    }
    w.__calls = []
    const orig = w.__TAURI_INTERNALS__.invoke
    // Harness gap: the mock's SETTINGS.theme='light' overrides the fixture's
    // `theme` option once settings load; answer with the seeded theme instead.
    const seededTheme = localStorage.getItem('theme')
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
      w.__calls.push({ cmd, args: args as Call['args'], at: performance.now() })
      if (cmd === 'get_setting' && (args as { key?: string } | undefined)?.key === 'theme' && seededTheme) {
        return Promise.resolve(seededTheme)
      }
      return orig(cmd, args, opts)
    }
  })
  await app.open(pageId)
  await expect(page.getByRole('tab', { name: /Habits/ })).toHaveAttribute('aria-selected', 'true')
  await expect(circles(page)).toHaveCount(HABITS.length)
}

const group = (page: Page) => page.getByRole('group', { name: "Today's habits" })
const circles = (page: Page) => group(page).locator('button:not([aria-label="Add habit"])')
const circle = (page: Page, name: string) => group(page).getByRole('button', { name: new RegExp(`^${name}\\b`) })
const panel = (page: Page) => page.getByRole('tabpanel').filter({ has: group(page) })

async function calls(page: Page, cmds = ['log_habit', 'unlog_habit']): Promise<Call[]> {
  const all = await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
  return all.filter((c) => cmds.includes(c.cmd))
}

/** Waits for `n` habit mutations, then confirms no extra one follows. */
async function expectMutations(page: Page, n: number) {
  await expect.poll(async () => (await calls(page)).length).toBe(n)
  await page.waitForTimeout(250)
  expect((await calls(page)).length, 'habit mutations after settling').toBe(n)
}

/** Resolves once the store has reloaded habits after the last mutation. */
async function waitForReloadAfterMutation(page: Page) {
  await expect
    .poll(async () => {
      const all = await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)
      const lastMut = all.map((c) => c.cmd).lastIndexOf('unlog_habit') >= all.map((c) => c.cmd).lastIndexOf('log_habit')
        ? all.map((c) => c.cmd).lastIndexOf('unlog_habit')
        : all.map((c) => c.cmd).lastIndexOf('log_habit')
      return lastMut >= 0 && all.slice(lastMut + 1).some((c) => c.cmd === 'get_habits')
    })
    .toBe(true)
  await page.waitForTimeout(150) // one render after the reload resolves
}

async function nameOf(loc: Locator) {
  return (await loc.getAttribute('aria-label')) ?? (await loc.innerText())
}

function expectState(name: string, habit: string, done: boolean) {
  expect(name, `accessible name of ${habit}`).toMatch(new RegExp(`^${habit}\\b`, 'i'))
  if (done) {
    expect(name).toMatch(/\bdone\b/i)
    expect(name).not.toMatch(/\bnot\b/i)
  } else {
    expect(name).toMatch(/\bnot (yet )?done\b/i)
  }
}

test.describe('T5 habit ring', () => {
  test('AC1 no progress ring appears while the pointer is held (700ms)', async ({ app, page }) => {
    await openHabits(app, page)
    const box = (await circle(page, 'Journal').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // Sample every frame for the whole hold; resolves with what showed up.
    const sampled = page.evaluate(
      ({ ring, label }) =>
        new Promise<string[]>((resolve) => {
          const seen = new Set<string>()
          const t0 = performance.now()
          const tick = () => {
            const btn = Array.from(document.querySelectorAll(`[role="group"][aria-label="${label}"] button`)).find((b) =>
              (b.getAttribute('aria-label') ?? '').startsWith('Journal'),
            )
            btn?.querySelectorAll(ring).forEach((el) => seen.add(`${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`))
            if (performance.now() - t0 < 700) requestAnimationFrame(tick)
            else resolve([...seen])
          }
          tick()
        }),
      { ring: RING, label: "Today's habits" },
    )
    await page.mouse.down()
    const ringEls = await sampled
    await page.mouse.up()
    expect(ringEls, 'hold progress ring elements seen during the press').toEqual([])
  })

  test('AC1 holding the pointer does not toggle before release', async ({ app, page }) => {
    await openHabits(app, page)
    const box = (await circle(page, 'Journal').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700) // deliberate hold, past the old 500ms HOLD_DURATION
    expect(await calls(page), 'habit mutations while the pointer is still down').toEqual([])
    await page.mouse.up()
    await expectMutations(page, 1)
  })

  test('AC1 no circle offers a hold in its tooltip or name', async ({ app, page }) => {
    await openHabits(app, page)
    for (const c of await circles(page).all()) {
      const text = [await c.getAttribute('title'), await c.getAttribute('aria-label'), await c.getAttribute('aria-description')].join(' | ')
      expect(text).not.toMatch(/\bhold/i)
    }
  })

  test('AC2 a click toggles exactly once and logs intensity 5', async ({ app, page }) => {
    await openHabits(app, page)
    await circle(page, 'Journal').click()
    await expectMutations(page, 1)
    const [c] = await calls(page)
    expect(c.cmd).toBe('log_habit')
    expect(c.args?.habitId).toBe('habit-journal')
    expect(c.args?.intensity ?? 5, 'effective intensity (backend defaults to 5)').toBe(5)
  })

  test('AC2 a long press then release toggles exactly once', async ({ app, page }) => {
    await openHabits(app, page)
    const box = (await circle(page, 'Journal').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(700) // deliberate hold
    await page.mouse.up()
    await expectMutations(page, 1)
    expect((await calls(page))[0].cmd).toBe('log_habit')
  })

  for (const key of ['Enter', 'Space']) {
    test(`AC2 ${key} toggles the focused circle exactly once`, async ({ app, page }) => {
      await openHabits(app, page)
      await circle(page, 'Journal').focus()
      await page.keyboard.press(key)
      await expectMutations(page, 1)
      const [c] = await calls(page)
      expect(c.cmd).toBe('log_habit')
      expect(c.args?.habitId).toBe('habit-journal')
    })
  }

  test('AC2+AC5 click checks a habit off, it stays done, a second click undoes it', async ({ app, page }) => {
    await openHabits(app, page)
    const journal = circle(page, 'Journal')
    await expect(journal.getByText('✓')).toHaveCount(0)

    await journal.click()
    await waitForReloadAfterMutation(page)
    expectState(await nameOf(journal), 'Journal', true)
    await expect(journal.getByText('✓'), 'done badge').toBeVisible()

    await journal.click()
    await waitForReloadAfterMutation(page)
    expect((await calls(page)).map((c) => c.cmd)).toEqual(['log_habit', 'unlog_habit'])
    expectState(await nameOf(journal), 'Journal', false)
    await expect(journal.getByText('✓')).toHaveCount(0)
  })

  test('AC3 Tab reaches every habit circle with a visible focus ring', async ({ app, page }) => {
    await openHabits(app, page)
    await page.getByRole('button', { name: 'Manage habits' }).focus()
    const reached: string[] = []
    for (let i = 0; i < HABITS.length + 3; i++) {
      await page.keyboard.press('Tab')
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      const hit = HABITS.find((h) => new RegExp(`^${h.name}\\b`).test(label))
      if (!hit) continue
      reached.push(hit.name)
      await expectFocusRing(page)
    }
    expect(reached, 'circles reached by Tab').toEqual(HABITS.map((h) => h.name))
  })

  test("AC3 accessible names carry the habit name and today's state", async ({ app, page }) => {
    await openHabits(app, page)
    for (const h of HABITS) expectState(await nameOf(circle(page, h.name)), h.name, h.done)
  })

  test('AC4 circle size and column layout match main', async ({ app, page }) => {
    await openHabits(app, page)
    for (const c of await circles(page).all()) {
      const b = (await c.boundingBox())!
      expect(b.width).toBeCloseTo(MAIN_CIRCLE.width, 0)
      expect(b.height).toBeCloseTo(MAIN_CIRCLE.height, 0)
      const col = (await c.locator('xpath=..').boundingBox())!
      expect(col.width).toBeCloseTo(MAIN_COLUMN.width, 0)
      expect(Math.abs(col.height - MAIN_COLUMN.height)).toBeLessThanOrEqual(1)
      expect(b.x - col.x).toBeCloseTo(MAIN_COLUMN.circleDx, 0)
      expect(b.y - col.y).toBeCloseTo(MAIN_COLUMN.circleDy, 0)
    }
  })

  test('AC4 no clipping in the habits panel', async ({ app, page }) => {
    await openHabits(app, page)
    await expectNoClipping(panel(page))
  })

  for (const id of ['today', 'goals']) {
    test(`AC6 no new axe violations on ${id} with the Habits tab open`, async ({ app, page }) => {
      await openHabits(app, page, id)
      await expectNoNewAxeViolations(page, id)
    })
  }
})

// ── Screenshots (before/after evidence; never fails on main) ────────────────
test.describe('screenshots', () => {
  test.skip(!process.env.SHOT_DIR, 'set SHOT_DIR to capture')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme, viewport: { width: 1440, height: 900 } })
      const shot = (page: Page, nn: string, state: string) =>
        page.screenshot({ path: `${process.env.SHOT_DIR}/${nn}-${state}-${theme}.png` })

      test(`habits tab states (${theme})`, async ({ app, page }) => {
        await openHabits(app, page)
        await page.mouse.move(10, 890)
        await shot(page, '01', 'rest')

        const box = (await circle(page, 'Journal').boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.waitForTimeout(300) // deliberately mid-hold
        await shot(page, '02', 'mid-press')
        await page.mouse.up()
        await page.mouse.move(10, 890)
        await page.waitForTimeout(250)
        await shot(page, '03', 'after-click')

        // Keyboard focus: Tab from "Manage habits". On main WebKit skips the
        // circles (no tabIndex), so fall back to focusing Read directly.
        await page.getByRole('button', { name: 'Manage habits' }).focus()
        await page.keyboard.press('Tab')
        const onCircle = await page.evaluate(() => /^(Gym|Read|Journal|Walk)\b/.test(document.activeElement?.getAttribute('aria-label') ?? ''))
        if (!onCircle) await circle(page, 'Read').focus()
        await page.waitForTimeout(150)
        await shot(page, '04', 'keyboard-focus')
      })
    })
  }
})
