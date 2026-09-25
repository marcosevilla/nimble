/*
 * T6 — Create-task modal (loop 3, lane MODAL): focus states, spacing,
 * keyboard behaviour. Surface: QuickCreateDialog → TaskComposerCard, opened
 * with `q` on Tasks (mock data from tools/mock-tauri.js).
 *
 * Contract
 * --------
 * 1. Every Tab stop in the modal shows a focus indicator. The two ghost text
 *    fields (title, description) show a filled well (non-transparent
 *    background) and no box outline; every other stop shows the app ring.
 *    Tab order is title → description → Priority → Due → Labels → project
 *    chip → its ✕ → + → Cancel → Save (Due, Labels and ✕ used to be skipped
 *    by WebKit). A chip's ring is the chip's own rounded box.
 * 2b. Ghost fields widen into their well instead of shifting: their text box
 *    lines up with the column (chip row) on both sides, and the task-detail
 *    description wraps at the same width in display and edit.
 * 2c. A long description scrolls inside a capped field; Save stays on screen.
 * 2. No indicator is clipped by an overflow ancestor, and focusing any field
 *    — by keyboard or by mouse — moves nothing (rects of title, description,
 *    chip row, footer and the card itself are identical).
 * 3. A mouse click into a ghost field never draws an outset box ring.
 * 4. Spacious: the card is 520–600px wide at 1440×900 with ≥24px padding;
 *    a long title wraps inside the card instead of scrolling sideways.
 *    Dark mode: ghost fields are transparent at rest (no grey slab).
 * 5. Enter in the title moves to the description without saving; ⌘↵ with an
 *    empty title saves nothing; Esc closes the modal (and a picker's Esc
 *    closes only the picker); ⌘↵ with a title creates the task and closes.
 * 6. Standing checks: nothing clips, no new axe violations with the modal
 *    open (baseline keys `create-modal`, `create-modal:dark`, recorded on
 *    603fe7b).
 */
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'
import type { Locator, Page } from '@playwright/test'

type Call = [string, Record<string, unknown> | undefined]

async function recordInvokes(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (...a: unknown[]) => unknown }; __calls: unknown[] }
    const core = w.__TAURI_INTERNALS__
    const base = core.invoke
    w.__calls = []
    core.invoke = (cmd: unknown, args: unknown, o: unknown) => {
      w.__calls.push([cmd, args ? JSON.parse(JSON.stringify(args)) : args])
      return base(cmd, args, o)
    }
  })
}

async function calls(page: Page, cmd: string): Promise<Call[]> {
  const all = (await page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls)) as Call[]
  return all.filter(([c]) => c === cmd)
}

async function openModal(app: App, page: Page) {
  await app.open('tasks')
  await page.locator('body').click({ position: { x: 700, y: 20 } })
  await page.keyboard.press('q')
  const dialog = page.getByRole('dialog', { name: 'New task' })
  await expect(dialog).toBeVisible()
  // Let the zoom-in finish so rects are final.
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  return dialog
}

const title = (d: Locator) => d.getByRole('textbox', { name: 'Task title' })
const description = (d: Locator) => d.getByRole('textbox', { name: 'Description' })

/** Rects of the parts that must never move when focus changes. */
async function layout(dialog: Locator) {
  return dialog.evaluate((root) => {
    const r = (el: Element | null) => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10)
    }
    return {
      card: r(root),
      title: r(root.querySelector('[aria-label="Task title"]')),
      description: r(root.querySelector('[aria-label="Description"]')),
      chips: r(root.querySelector('[data-composer-chips]')),
      footer: r(root.querySelector('[data-composer-footer]')),
    }
  })
}

/** The focused element's indicator: ring extent, fill, and whether any overflow ancestor clips it. */
async function indicator(page: Page) {
  // Read the settled state: the well fades in over --transition-fast.
  await page.evaluate(() => Promise.all((document.activeElement as HTMLElement).getAnimations().map((a) => a.finished)))
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    const reach = outline ? Math.max(0, parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth)) : 0
    const b = el.getBoundingClientRect()
    const ring = { l: b.left - reach, t: b.top - reach, r: b.right + reach, btm: b.bottom + reach }
    const clippedBy: string[] = []
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const c = a.getBoundingClientRect()
      if (ring.l < c.left - 0.5 || ring.t < c.top - 0.5 || ring.r > c.right + 0.5 || ring.btm > c.bottom + 0.5) {
        clippedBy.push(`${a.tagName.toLowerCase()}.${String(a.className).split(/\s+/).slice(0, 3).join('.')}`)
      }
    }
    const bg = cs.backgroundColor
    const filled = bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg) && !/\/\s*0\)$/.test(bg)
    return {
      name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName,
      outline,
      outlineOffset: parseFloat(cs.outlineOffset),
      filled,
      bg,
      clippedBy,
    }
  })
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ theme })

    test(`every Tab stop shows an unclipped indicator, in order (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      await expect(title(dialog)).toBeFocused()
      // A title enables Save (a disabled button is not a Tab stop).
      await page.keyboard.type('Plan the week')
      const order: string[] = []
      const start = await indicator(page)
      order.push(start.name)
      expect(start.filled, `title well: ${start.bg}`).toBe(true)
      expect(start.outline, 'title has no box ring').toBe(false)
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press('Tab')
        const ind = await indicator(page)
        order.push(ind.name)
        expect(ind.clippedBy, `${ind.name} ring clipped`).toEqual([])
        if (ind.name === 'Description') {
          expect(ind.filled, `description well: ${ind.bg}`).toBe(true)
          expect(ind.outline, 'description has no box ring').toBe(false)
        } else {
          await expectFocusRing(page)
        }
      }
      expect(order).toEqual(['Task title', 'Description', 'Priority', 'Due', 'Labels', 'Inbox', 'Clear project', 'Add field', 'Cancel', 'Save'])
    })

    test(`the project chip's focus ring is the chip's own rounded box, and the chip hugs its text (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      const chip = dialog.getByRole('button', { name: 'Inbox', exact: true })
      await chip.focus()
      // Reach it by keyboard so :focus-visible applies: back to Labels, then forward.
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(chip).toBeFocused()
      const m = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const row = document.querySelector('[data-composer-chips] > div') as HTMLElement
        let box: HTMLElement = el
        while (box.parentElement && box.parentElement !== row) box = box.parentElement
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const b = box.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(el)
        const text = range.getBoundingClientRect()
        const clear = box.querySelector('[aria-label="Clear project"]')?.getBoundingClientRect() ?? null
        return {
          outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
          radius: parseFloat(cs.borderTopLeftRadius),
          focused: [r.left, r.top, r.width, r.height].map(Math.round),
          chipBox: [b.left, b.top, b.width, b.height].map(Math.round),
          trailing: b.right - text.right,
          clear: clear && { left: clear.left - text.right, right: b.right - clear.right, visible: getComputedStyle(box.querySelector('[aria-label="Clear project"]')!).opacity },
        }
      })
      expect(m.outline, 'ring on the focused chip').toBe(true)
      expect(m.radius, 'ring follows a rounded box').toBeGreaterThan(0)
      expect(m.focused, 'focused element is the whole chip').toEqual(m.chipBox)
      // Right side = the ✕ slot only (a visible ✕, 4px clear of the text), no dead space.
      expect(m.clear).not.toBeNull()
      expect(m.clear!.visible).toBe('1')
      expect(m.clear!.left).toBeGreaterThanOrEqual(2)
      expect(m.trailing).toBeLessThanOrEqual(26)
    })

    test(`ghost fields line up with the column on both sides (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      const m = await dialog.evaluate((root) => {
        const text = (el: Element) => {
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) }
        }
        const col = root.querySelector('[data-composer-chips]')!.getBoundingClientRect()
        return {
          col: { left: col.left, right: col.right },
          title: text(root.querySelector('[aria-label="Task title"]')!),
          description: text(root.querySelector('[aria-label="Description"]')!),
        }
      })
      for (const f of [m.title, m.description]) {
        expect(Math.abs(f.left - m.col.left)).toBeLessThanOrEqual(1)
        expect(Math.abs(f.right - m.col.right)).toBeLessThanOrEqual(1)
      }
    })

    test(`task detail description wraps at the same width in display and edit (${theme})`, async ({ app, page }) => {
      await app.open('tasks')
      await page.evaluate(() =>
        (window as unknown as { __stores: { useDetailStore: { getState(): { openTask(id: string, mode: string): void } } } }).__stores.useDetailStore
          .getState()
          .openTask('task-01', 'body'),
      )
      const main = page.locator('main').first()
      const display = main.locator('.tiptap-editor').first()
      await expect(display).toBeVisible()
      const shown = await display.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return { left: r.left + parseFloat(cs.paddingLeft), width: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }
      })
      await display.click()
      const ta = main.locator('textarea').first()
      await expect(ta).toBeFocused()
      const edit = await ta.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return { left: r.left + parseFloat(cs.paddingLeft), width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }
      })
      expect(Math.abs(edit.left - shown.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(edit.width - shown.width)).toBeLessThanOrEqual(1)
    })

    test(`a 40-line description scrolls inside the field and Save stays visible (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      await page.keyboard.type('Long paste')
      const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long pasted note`).join('\n')
      await description(dialog).fill(lines)
      const save = dialog.getByRole('button', { name: 'Save' })
      await expect(save).toBeInViewport({ ratio: 1 })
      const box = (await save.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(900)
      const scrolls = await description(dialog).evaluate((el) => el.scrollHeight > el.clientHeight + 1)
      expect(scrolls).toBe(true)
    })

    test(`focus never moves the layout, by keyboard or mouse (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      const base = await layout(dialog)
      expect(base.chips).not.toBeNull()
      expect(base.footer).not.toBeNull()
      await page.keyboard.press('Tab') // → description
      expect(await layout(dialog)).toEqual(base)
      await page.keyboard.press('Tab') // → Priority chip
      expect(await layout(dialog)).toEqual(base)
      await title(dialog).click()
      expect(await layout(dialog)).toEqual(base)
      await description(dialog).click()
      expect(await layout(dialog)).toEqual(base)
    })

    test(`mouse focus on a ghost field is calm: no outset box ring (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      for (const field of [description(dialog), title(dialog)]) {
        await field.click()
        const ind = await indicator(page)
        expect(!ind.outline || ind.outlineOffset < 0, `${ind.name} outline offset ${ind.outlineOffset}`).toBe(true)
      }
    })

    test(`spacious card, wrapping title, no resting slab (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      const box = (await dialog.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(520)
      expect(box.width).toBeLessThanOrEqual(600)
      const pad = await dialog.evaluate((root) => {
        const card = root.querySelector('[data-composer-card]') as HTMLElement
        const t = root.querySelector('[aria-label="Task title"]')!.getBoundingClientRect()
        const c = card.getBoundingClientRect()
        return { left: t.left - c.left, top: t.top - c.top }
      })
      // The ghost field's padding box sits 8px outside its text, so the
      // text itself is ≥24px in from the card edge.
      expect(pad.left + 8).toBeGreaterThanOrEqual(24)

      // At rest (focus elsewhere) the ghost fields are transparent.
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab') // Priority chip
      for (const field of [title(dialog), description(dialog)]) {
        const bg = await field.evaluate(async (el) => {
          await Promise.all(el.getAnimations().map((a) => a.finished))
          return getComputedStyle(el).backgroundColor
        })
        expect(bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg) || /\/\s*0\)$/.test(bg), `resting bg ${bg}`).toBe(true)
      }

      const before = (await title(dialog).boundingBox())!
      await title(dialog).fill('An exceptionally long task title that keeps going well past the width of the modal so it has to wrap')
      const after = (await title(dialog).boundingBox())!
      expect(after.height).toBeGreaterThan(before.height * 1.5)
      expect(after.width).toBe(before.width)
      const overflow = await title(dialog).evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await expectNoClipping(dialog.locator('[data-composer-card]'))
    })

    test(`Enter, ⌘↵, Esc behave; ⌘↵ creates the task (${theme})`, async ({ app, page }) => {
      await recordInvokes(page)
      let dialog = await openModal(app, page)
      // Empty ⌘↵ saves nothing.
      await page.keyboard.press('Meta+Enter')
      await expect(dialog).toBeVisible()
      expect(await calls(page, 'create_local_task')).toHaveLength(0)
      // Enter in the title moves on, never saves or inserts a newline.
      await page.keyboard.type('Write the case study intro')
      await page.keyboard.press('Enter')
      await expect(description(dialog)).toBeFocused()
      await expect(title(dialog)).toHaveValue('Write the case study intro')
      expect(await calls(page, 'create_local_task')).toHaveLength(0)
      // A picker's Esc closes only the picker.
      await dialog.locator('button', { hasText: /^Due$/ }).click()
      const picker = page.locator('[data-slot=popover-content]').filter({ hasText: /Add time/ })
      await expect(picker).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(picker).toBeHidden()
      await expect(dialog).toBeVisible()
      // Esc closes the modal and keeps the draft.
      await title(dialog).focus()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await page.keyboard.press('q')
      dialog = page.getByRole('dialog', { name: 'New task' })
      await expect(dialog).toBeVisible()
      await expect(title(dialog)).toHaveValue('Write the case study intro')
      // ⌘↵ creates it and closes.
      await page.keyboard.press('Meta+Enter')
      await expect(dialog).toBeHidden()
      const created = await calls(page, 'create_local_task')
      expect(created).toHaveLength(1)
      expect(created[0][1]).toMatchObject({ content: 'Write the case study intro' })
      await expect(page.getByText('Write the case study intro').first()).toBeVisible()
    })

    test(`standing: no clipping and no new axe violations with the modal open (${theme})`, async ({ app, page }) => {
      const dialog = await openModal(app, page)
      await page.keyboard.type('Draft the portfolio case study')
      await expectNoClipping(dialog.locator('[data-composer-card]'))
      await expectNoNewAxeViolations(page, 'create-modal')
    })
  })
}
