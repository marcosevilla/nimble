// T3 — Inbox row actions overlay the row end on a fade (loop 2, chunk 3).
// Acceptance: docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "T3".
//
// Written red, before the build: on main the actions are `hidden` →
// `group-hover:flex`, so revealing them shrinks the note title (745 → 401px
// at 1440). Everything below runs against a frozen build:
//
//   BASE_URL=http://localhost:4600 npx playwright test -c e2e e2e/t3-inbox-overlay.spec.ts
//
// Contract for the builder (the only things these tests need that main
// does not have yet; everything else is found by role / name / text):
//   1. The note row's actions live in ONE element marked `data-row-actions`,
//      inside the row (`[data-nav-row="note:<id>"]`). It holds the three
//      action buttons and sits over the row's right end (its right edge
//      within 4px of the row's right edge, fully inside the row box).
//   2. The fade is painted by that element itself or by its ::before /
//      ::after: its computed `background-image` is a gradient whose first
//      stop is transparent. From the first action button's left edge
//      rightwards the fade is opaque, i.e. the pixel there equals the row's
//      own background (hover, keyboard focus, selected+hover; light + dark).
//   3. Every action button is Tab-reachable in WebKit. Safari/WKWebView's
//      default Tab skips a plain <button>; give each action `tabIndex={0}`
//      (the popover trigger already has it, Convert and Dismiss don't).
// Reveal/conceal is measured as effective opacity (element × ancestors,
// 0 when display:none / visibility:hidden), so `opacity-0` at rest is fine.
import type { Locator, Page } from '@playwright/test'
import {
  test,
  expect,
  expectNoClipping,
  expectFocusRing,
  expectNoNewAxeViolations,
  type Theme,
} from './fixtures'

// ── Fixture data ────────────────────────────────────────────────────────────

// A note long enough to run under the overlay at 1440 and 1024, so the fade
// has real title text to cover. Injected in front of the mock's captures.
const LONG = {
  id: 'cap-t3-long',
  content:
    'A deliberately long inbox note that keeps going past the row actions so the overlay has title text to cover: ' +
    'compare the X-T5 and X-H2 autofocus in low light, then write it up for the concert gear page',
  source: 'inbox',
  converted_to_task_id: null,
  routed_to: null,
  context: null,
  created_at: '2026-08-01T09:30:00',
}
const SHORT = { id: 'cap-01', content: 'Idea: intensity heatmap view for habits, like GitHub contributions' }
const TASK = { id: 'task-14', content: 'Research pedalboard flight case options' }

const ACTIONS = [
  { name: /move to doc/i, key: 'M' },
  { name: /convert to task/i, key: 'T' },
  { name: /dismiss/i, key: 'D' },
] as const

async function injectLongNote(page: Page) {
  // Registered after the fixture's mock, so it wraps the mock's invoke.
  await page.addInitScript((note) => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown> } }
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) =>
      cmd === 'get_captures'
        ? orig(cmd, args, opts).then((list) => [note, ...(list as unknown[])])
        : orig(cmd, args, opts)
  }, LONG)
}

async function openInbox(page: Page, app: { open(id: string): Promise<void> }) {
  await injectLongNote(page)
  await app.open('inbox')
  await expect(noteRow(page, LONG.id)).toBeVisible()
  const want = await page.evaluate(() => localStorage.getItem('theme'))
  await expect(page.locator('html')).toHaveClass(want === 'dark' ? /(^|\s)dark(\s|$)/ : /^(?!.*(^|\s)dark(\s|$))/)
}

// ── Locators & measurements ─────────────────────────────────────────────────

const noteRow = (page: Page, id: string) => page.locator(`[data-nav-row="note:${id}"]`)
const taskRow = (page: Page, id: string) => page.locator(`[data-nav-row="task:${id}"]`)
const titleOf = (row: Locator, text: string) => row.getByText(text, { exact: true })
const action = (row: Locator, i: number) => row.getByRole('button', { name: ACTIONS[i].name })
const actionsBox = (row: Locator) => row.locator('[data-row-actions]')

/** Element opacity × every ancestor's; 0 when not rendered. */
function effectiveOpacity(loc: Locator) {
  return loc.evaluate((el) => {
    if (el.getClientRects().length === 0) return 0
    let o = 1
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0
      o *= parseFloat(cs.opacity)
    }
    return o
  })
}

async function expectRevealed(row: Locator) {
  for (let i = 0; i < ACTIONS.length; i++) {
    await expect.poll(() => effectiveOpacity(action(row, i)), { message: `${ACTIONS[i].name} revealed` }).toBeGreaterThan(0.95)
    // The key hint is part of the reveal.
    const kbd = action(row, i).locator('kbd')
    await expect(kbd).toHaveText(ACTIONS[i].key)
    expect(await effectiveOpacity(kbd)).toBeGreaterThan(0.95)
  }
}

async function expectConcealed(row: Locator) {
  for (let i = 0; i < ACTIONS.length; i++) {
    await expect.poll(() => action(row, i).count().then((n) => (n ? effectiveOpacity(action(row, i)) : 0)), {
      message: `${ACTIONS[i].name} concealed`,
    }).toBeLessThan(0.05)
  }
}

async function box(loc: Locator) {
  await expect(loc, 'element exists').toHaveCount(1)
  const b = await loc.boundingBox()
  expect(b, 'element has a box').not.toBeNull()
  return b!
}

function expectSameBox(actual: { x: number; y: number; width: number; height: number }, expected: typeof actual, what: string) {
  for (const k of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(actual[k] - expected[k]), `${what}: ${k} ${expected[k]} → ${actual[k]}`).toBeLessThanOrEqual(0.5)
  }
}

/** Mouse off every row (bottom-right corner of the viewport). */
async function mouseAway(page: Page) {
  const vp = page.viewportSize()!
  await page.mouse.move(vp.width - 4, vp.height - 4)
}

/** Hover a row on its left padding, away from the actions and the title. */
async function hoverRow(page: Page, row: Locator) {
  const b = await box(row)
  await page.mouse.move(b.x + 8, b.y + b.height / 2)
}

/** Keyboard focus a row the way a user does: j from an empty focus. */
async function keyboardFocus(page: Page, navId: string) {
  await mouseAway(page)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  for (let i = 0; i < 30; i++) {
    const at = await page.evaluate(() => document.activeElement?.getAttribute('data-nav-row') ?? null)
    if (at === navId) return
    await page.keyboard.press('j')
  }
  throw new Error(`j never reached ${navId}`)
}

/** Settled computed background of an element (waits out transition-colors). */
async function settledBg(loc: Locator) {
  let last = ''
  await expect
    .poll(async () => {
      const now = await loc.evaluate((el) => getComputedStyle(el).backgroundColor)
      const same = now === last
      last = now
      return same
    }, { intervals: [120, 120, 120, 120, 120, 200] })
    .toBe(true)
  return last
}

/** RGBA of one viewport pixel, read from a PNG screenshot in the page. */
async function pixel(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }, png.toString('base64'))
}

/** The gradient on [data-row-actions] or its ::before / ::after, if any. */
async function fadeGradient(row: Locator) {
  await expect(actionsBox(row), '[data-row-actions] exists').toHaveCount(1)
  return actionsBox(row).evaluate((el) => {
    for (const pseudo of [null, '::before', '::after']) {
      const bg = getComputedStyle(el, pseudo).backgroundImage
      if (bg && bg.includes('gradient(')) return bg
    }
    return ''
  })
}

// ── AC1: reveal without reflow ──────────────────────────────────────────────

test.describe('AC1 reveal without reflow', () => {
  for (const note of [SHORT, LONG]) {
    const label = note === LONG ? 'long note' : 'note with source'

    test(`AC1 title box identical at rest, hovered and keyboard-focused (${label})`, async ({ app, page }) => {
      await openInbox(page, app)
      const row = noteRow(page, note.id)
      const title = titleOf(row, note.content)
      await mouseAway(page)
      await expectConcealed(row)
      const rest = await box(title)

      await hoverRow(page, row)
      await expectRevealed(row)
      expectSameBox(await box(title), rest, 'title on hover')

      await keyboardFocus(page, `note:${note.id}`)
      await expectRevealed(row)
      expectSameBox(await box(title), rest, 'title on keyboard focus')
    })
  }

  test('AC1 actions revealed on hover and on keyboard focus, with key hints', async ({ app, page }) => {
    await openInbox(page, app)
    const row = noteRow(page, SHORT.id)
    await mouseAway(page)
    await expectConcealed(row)
    await hoverRow(page, row)
    await expectRevealed(row)
    await mouseAway(page)
    await expectConcealed(row)
    await keyboardFocus(page, `note:${SHORT.id}`)
    await expectRevealed(row)
  })

  test('AC1 actions overlay the row right end (over the title, inside the row)', async ({ app, page }) => {
    await openInbox(page, app)
    const row = noteRow(page, LONG.id)
    await hoverRow(page, row)
    await expectRevealed(row)
    const r = await box(row)
    const a = await box(actionsBox(row))
    expect(Math.abs(r.x + r.width - (a.x + a.width)), 'actions right edge at row right edge').toBeLessThanOrEqual(4)
    expect(a.x, 'actions inside row (left)').toBeGreaterThanOrEqual(r.x - 0.5)
    expect(a.y, 'actions inside row (top)').toBeGreaterThanOrEqual(r.y - 0.5)
    expect(a.y + a.height, 'actions inside row (bottom)').toBeLessThanOrEqual(r.y + r.height + 0.5)
    // An overlay, not a column: the long title still runs under the actions.
    const t = await box(titleOf(row, LONG.content))
    expect(t.x + t.width, 'title extends under the actions').toBeGreaterThan(a.x + 8)
  })
})

// ── AC2: the fade ───────────────────────────────────────────────────────────

for (const theme of ['light', 'dark'] as Theme[]) {
  test.describe(`AC2 fade (${theme})`, () => {
    test.use({ theme })

    const states: Array<{ state: string; enter: (page: Page, row: Locator) => Promise<void> }> = [
      { state: 'hover', enter: (page, row) => hoverRow(page, row) },
      { state: 'keyboard focus', enter: (page) => keyboardFocus(page, `note:${LONG.id}`) },
      {
        // Selected wins over the focus tint (cn order), hover wins over both.
        state: 'selected + keyboard focus',
        enter: async (page, row) => {
          await page.evaluate((id) => {
            const s = (window as unknown as { __stores: { useSelectionStore: { getState(): { toggle(id: string, t: string): void } } } }).__stores
            s.useSelectionStore.getState().toggle(id, 'capture')
          }, LONG.id)
          await expect(row.getByRole('button', { name: 'Deselect' })).toHaveCount(1)
          await keyboardFocus(page, `note:${LONG.id}`)
        },
      },
    ]

    for (const { state, enter } of states) {
      test(`AC2 fade behind the actions matches the row background on ${state} (${theme})`, async ({ app, page }) => {
        await openInbox(page, app)
        const row = noteRow(page, LONG.id)
        await enter(page, row)
        await expectRevealed(row)

        const gradient = await fadeGradient(row)
        expect(gradient, '[data-row-actions] (or its ::before/::after) paints a gradient').toMatch(/gradient\(/)
        expect(gradient, 'the fade starts transparent').toMatch(/transparent|rgba\([^)]*,\s*0\)|\/\s*0\)/)

        await settledBg(row)
        const r = await box(row)
        const first = await box(action(row, 0))
        const midY = r.y + r.height / 2
        const rowBg = await pixel(page, r.x + 8, midY)
        const fadeEnd = await pixel(page, first.x + 2, midY)
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(fadeEnd[c] - rowBg[c]), `fade end ${fadeEnd} vs row bg ${rowBg} (channel ${c})`).toBeLessThanOrEqual(6)
        }
      })
    }
  })
}

// ── AC3: picker keeps the actions up ────────────────────────────────────────

test('AC3 actions stay visible while the picker is open, hide after close + blur', async ({ app, page }) => {
  await openInbox(page, app)
  const row = noteRow(page, SHORT.id)
  const title = titleOf(row, SHORT.content)
  await mouseAway(page)
  const rest = await box(title)

  await keyboardFocus(page, `note:${SHORT.id}`)
  await page.keyboard.press('m')
  const picker = page.locator('[data-slot="popover-content"]')
  await expect(picker).toBeVisible()
  await expect(picker.getByText('Move to doc', { exact: true })).toBeVisible()
  await mouseAway(page)
  await expectRevealed(row)
  expectSameBox(await box(title), rest, 'title with picker open')

  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  // finalFocus hands focus back to the row: still revealed.
  await expect(row).toBeFocused()
  // Blur (Escape on a focused row clears list focus) → concealed.
  await page.keyboard.press('Escape')
  await expect(row).not.toBeFocused()
  await expectConcealed(row)
})

// ── AC4: keyboard ───────────────────────────────────────────────────────────

test('AC4 Tab from the focused row reaches every action, each with a focus ring and a name', async ({ app, page }) => {
  await openInbox(page, app)
  const row = noteRow(page, SHORT.id)
  await keyboardFocus(page, `note:${SHORT.id}`)
  for (let i = 0; i < ACTIONS.length; i++) {
    await page.keyboard.press('Tab')
    await expect(action(row, i), `Tab ${i + 1} lands on ${ACTIONS[i].name}`).toBeFocused()
    await expectFocusRing(page)
    await expectRevealed(row)
    await expect(action(row, i)).toHaveAccessibleName(ACTIONS[i].name)
  }
})

test('AC4 m opens the Move to doc picker; Escape returns focus to the row', async ({ app, page }) => {
  await openInbox(page, app)
  const row = noteRow(page, SHORT.id)
  await keyboardFocus(page, `note:${SHORT.id}`)
  await page.keyboard.press('m')
  const picker = page.locator('[data-slot="popover-content"]')
  await expect(picker.getByText('Move to doc', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(row).toBeFocused()
})

test('AC4 t converts the focused note to a task', async ({ app, page }) => {
  await openInbox(page, app)
  // cap-03 has no date words, so it takes the plain (undated) convert path.
  await keyboardFocus(page, 'note:cap-03')
  await page.keyboard.press('t')
  await expect(noteRow(page, 'cap-03')).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Converted to task: "Ask Jordan about the design offsite date"' })).toBeVisible()
})

test('AC4 d dismisses the focused note with an Undo toast', async ({ app, page }) => {
  await openInbox(page, app)
  await keyboardFocus(page, 'note:cap-06')
  await page.keyboard.press('d')
  await expect(noteRow(page, 'cap-06')).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Note dismissed' })).toBeVisible()
})

// ── AC5: no clipping ────────────────────────────────────────────────────────

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
  test.describe(`AC5 ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp })

    test(`AC5 action labels and key hints don't clip at ${vp.width} (hover and focus)`, async ({ app, page }) => {
      await openInbox(page, app)
      // The actions' `after:-inset-2` hit areas are empty pseudos, not text,
      // but WebKit counts them in the button's scrollWidth (+8px), which
      // findClipped reads as clipping. Drop them for the measurement only.
      await page.addStyleTag({ content: '[data-nav-row] button::after { content: none !important; }' })
      for (const id of [LONG.id, SHORT.id]) {
        const row = noteRow(page, id)
        await hoverRow(page, row)
        await expectRevealed(row)
        for (let i = 0; i < ACTIONS.length; i++) await expectNoClipping(action(row, i))
        // Title under the overlay may only truncate with the deliberate ellipsis.
        await expectNoClipping(row, { allowEllipsis: true })

        await keyboardFocus(page, `note:${id}`)
        await expectRevealed(row)
        for (let i = 0; i < ACTIONS.length; i++) await expectNoClipping(action(row, i))
        // Every action fully inside the viewport and the row.
        const r = await box(row)
        for (let i = 0; i < ACTIONS.length; i++) {
          const b = await box(action(row, i))
          expect(b.x + b.width, `${ACTIONS[i].name} inside row`).toBeLessThanOrEqual(r.x + r.width + 0.5)
          expect(b.x + b.width, `${ACTIONS[i].name} inside viewport`).toBeLessThanOrEqual(vp.width)
        }
      }
    })
  })
}

// ── AC6: task rows ──────────────────────────────────────────────────────────

test('AC6 Inbox task rows do not reflow on hover or keyboard focus', async ({ app, page }) => {
  await openInbox(page, app)
  const row = taskRow(page, TASK.id)
  const title = titleOf(row, TASK.content)
  await mouseAway(page)
  const rest = await box(title)
  await hoverRow(page, row)
  await settledBg(row)
  expectSameBox(await box(title), rest, 'task title on hover')
  await keyboardFocus(page, `task:${TASK.id}`)
  await settledBg(row)
  expectSameBox(await box(title), rest, 'task title on keyboard focus')
})

// ── AC7: axe ────────────────────────────────────────────────────────────────

// The baseline was recorded on the mock's own data, so no injected long note
// here (it would add one more `nested-interactive` row of the kind main has).
test('AC7 no new axe violations on Inbox at rest', async ({ app, page }) => {
  await app.open('inbox')
  await mouseAway(page)
  await expectNoNewAxeViolations(page, 'inbox')
})

test('AC7 no new axe violations on Inbox with a note row\'s actions revealed', async ({ app, page }) => {
  await app.open('inbox')
  const row = noteRow(page, SHORT.id)
  await keyboardFocus(page, `note:${SHORT.id}`)
  await expectRevealed(row)
  await expectNoNewAxeViolations(page, 'inbox')
  const other = noteRow(page, 'cap-04')
  await hoverRow(page, other)
  await expectRevealed(other)
  await expectNoNewAxeViolations(page, 'inbox')
})

// ── Screenshots (SHOT_DIR only; never fail on main) ─────────────────────────

for (const theme of ['light', 'dark'] as Theme[]) {
  test.describe(`screenshots ${theme}`, () => {
    test.skip(!process.env.SHOT_DIR, 'set SHOT_DIR to capture before/after screenshots')
    test.use({ theme })

    const shot = (page: Page, n: string, state: string) =>
      page.screenshot({ path: `${process.env.SHOT_DIR}/${n}-${state}-${theme}.png` })
    // Best-effort reveal wait: a timeout here must not fail the capture.
    const settle = (row: Locator) =>
      expect.poll(() => effectiveOpacity(action(row, 1)).catch(() => 0), { timeout: 2000 }).toBeGreaterThan(0.95).catch(() => {})

    test(`screenshots inbox states (${theme})`, async ({ app, page }) => {
      await openInbox(page, app)
      const row = noteRow(page, LONG.id)

      await mouseAway(page)
      await page.waitForTimeout(250)
      await shot(page, '01', 'rest')

      await hoverRow(page, row)
      await settle(row)
      await shot(page, '02', 'hover')

      await keyboardFocus(page, `note:${LONG.id}`)
      await settle(row)
      await shot(page, '03', 'focus')

      await page.keyboard.press('m')
      await page.locator('[data-slot="popover-content"]').waitFor({ state: 'visible' }).catch(() => {})
      await mouseAway(page)
      await page.waitForTimeout(250)
      await shot(page, '04', 'picker')
    })

    test(`screenshots 1024 hover (${theme})`, async ({ app, page }) => {
      await page.setViewportSize({ width: 1024, height: 700 })
      await openInbox(page, app)
      const row = noteRow(page, LONG.id)
      await hoverRow(page, row)
      await settle(row)
      await shot(page, '05', 'hover-1024')
    })
  })
}
