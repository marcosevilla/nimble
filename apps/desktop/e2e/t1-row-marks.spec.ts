// T1 — Clickable row marks open the detail-page pickers.
// Acceptance: docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "T1".
//
// Contract for the builder (everything below that main 646d595 lacks):
//   • Each row mark is its own control inside the row element `[data-nav-row]`,
//     exposed as role=button (a native <button type="button"> is simplest;
//     role=combobox is also accepted), and never the row element itself.
//   • Accessible names carry the kind word then the current value
//     (case-insensitive, punctuation between is free):
//       priority → "Priority: urgent" | "Priority: high" | "Priority: medium"
//                  | "Priority: normal" (Marco 2026-09-24: Normal gets an
//                  empty icon, so every row has a priority mark)
//       due      → "Due Aug 3" | "Due Today" | "Due Jul 31"  (same text as the badge)
//       label    → "Label quick-win"   (one control per visible chip)
//       project  → "Project Nimble"
//     Suggested home: `src/lib/rowMarks.ts` `rowMarkName()` (see
//     tests/rowMarks.test.mjs for that module's contract).
//   • Clicking a mark opens a popup with role=menu, role=dialog or
//     role=listbox (the detail pickers already do: priority = menu of
//     menuitems "Normal/Medium/High/Urgent"; due = dialog with react-day-picker
//     day buttons "Monday, August 10th, 2026"; labels = dialog whose options
//     contain the label name, directly or behind the "Add label" button;
//     project = menu/listbox whose items are project names).
//   • The click leaves `useDetailStore.pageDetails[currentPage].target` null
//     and `useSelectionStore.selectedIds` empty.
//   • Picking priority / due / project closes the popup; Escape closes any
//     popup. Afterwards `document.activeElement` IS the row element (the one
//     carrying `data-nav-row`), and it shows a focus ring after Escape.
//   • Hover: the element under the pointer at the mark's centre has
//     `cursor: pointer`, and some colour/background on the mark (itself, a
//     descendant or its ::before/::after) changes on hover.
//   • Hit area: every point of the 24×24 square centred on the mark hits the
//     mark (a pseudo-element hit extender counts).
//   • Geometry unchanged vs main: row 36px tall, title's left edge 68px from
//     the row's left edge, right-cluster texts at the same distance from the
//     row's right edge (numbers below were measured on main 646d595).
//   • Axe: baseline keys `today-rows` (Today with the clock on Aug 1, so the
//     "Due today" list has rows) and `inbox-marks` (Inbox with task-14
//     seeded to have marks) were recorded on main 646d595 for this spec.
//
// Every test pins the clock to the mock world's "today" (Sat Aug 1 2026) so
// Today's "Due today" list is populated and due labels are stable.
import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

const MOCK_NOW = new Date('2026-08-01T10:00:00')

type Kind = 'priority' | 'due' | 'label' | 'project'
const KINDS: Kind[] = ['priority', 'due', 'label', 'project']

interface Surface {
  key: 'tasks' | 'project' | 'today' | 'inbox'
  pageId: string
  row: string
  title: string
  /** Regex source for each mark's current value. */
  marks: Partial<Record<Kind, string>>
  /** Right-cluster texts and their distance from the row's right edge on main. */
  rightTexts: Record<string, number>
  /** A different priority to pick for AC3 (menu item label). */
  newPriority: string
}

const AUG3 = 'aug(ust)?\\s*3\\b'

const SURFACES: Record<Surface['key'], Surface> = {
  tasks: {
    key: 'tasks',
    pageId: 'tasks',
    row: 'task-05',
    title: 'Ship v1.5: quick-capture polish',
    marks: { priority: 'urgent', due: AUG3, label: 'quick-win', project: 'nimble' },
    rightTexts: { 'quick-win': 100.97, Nimble: 43.89, 'Aug 3': 4 }, // cluster inset by the focus ring's footprint, T2 it2
    newPriority: 'High',
  },
  project: {
    key: 'project',
    pageId: 'tasks',
    row: 'task-05',
    title: 'Ship v1.5: quick-capture polish',
    marks: { priority: 'urgent', due: AUG3, label: 'quick-win', project: 'nimble' },
    rightTexts: { 'quick-win': 100.97, Nimble: 43.89, 'Aug 3': 4 }, // cluster inset by the focus ring's footprint, T2 it2
    newPriority: 'High',
  },
  today: {
    key: 'today',
    pageId: 'today',
    row: 'task-04',
    title: 'Fix capture strip focus bug on second monitor',
    marks: { priority: 'high', due: 'today', label: 'bug', project: 'nimble' },
    rightTexts: { 'deep-work': 157.2, bug: 101.3, Nimble: 44.22, Today: 4 }, // cluster inset by the focus ring's footprint, T2 it2; C4: chips in taxonomy order (label position), so deep-work now leads bug
    newPriority: 'Medium',
  },
  // Inbox rows don't show a project; task-14 is seeded with marks (see seedInbox).
  inbox: {
    key: 'inbox',
    pageId: 'inbox',
    row: 'task:task-14',
    title: 'Research pedalboard flight case options',
    marks: { priority: 'high', due: AUG3, label: 'quick-win' },
    rightTexts: { 'quick-win': 43.89, 'Aug 3': 4 }, // cluster inset by the focus ring's footprint, T2 it2
    newPriority: 'Urgent',
  },
}

// ── helpers ──────────────────────────────────────────────────────────────

test.beforeEach(async ({ app: _app, page }) => {
  await page.clock.setFixedTime(MOCK_NOW)
})

/** Give the Inbox's only task row (task-14: priority 1, no due, no labels) marks. */
async function seedInbox(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): unknown } }).__TAURI_INTERNALS__.invoke(
      'update_local_task',
      { id: 'task-14', priority: 3, dueDate: '2026-08-03', labelIds: ['label-quick-win'] },
    )
  })
}

async function openSurface(app: App, page: Page, s: Surface) {
  if (s.key === 'inbox') await seedInbox(page)
  await app.open(s.pageId)
  if (s.key === 'project') {
    await page.getByRole('treeitem', { name: 'Nimble', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Nimble', exact: true })).toBeVisible()
  }
  await expect(rowOf(page, s.row)).toBeVisible()
}

const rowOf = (page: Page, id: string) => page.locator(`[data-nav-row="${id}"]`)

function markName(kind: Kind, value = '') {
  return new RegExp(`\\b${kind}\\b\\W*${value}`, 'i')
}

/** The row's mark control for `kind` (optionally with a value), never the row itself. */
function mark(row: Locator, kind: Kind, value = '') {
  const name = markName(kind, value)
  return row
    .getByRole('button', { name })
    .or(row.getByRole('combobox', { name }))
    .and(row.page().locator(':not([data-nav-row])'))
    .first()
}

const popups = (page: Page) => page.locator('[role=dialog], [role=menu], [role=listbox]').filter({ visible: true })

async function detailTarget(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__stores
    const cp = s.useAppStore.getState().currentPage
    return s.useDetailStore.getState().pageDetails?.[cp]?.target?.id ?? null
  })
}

async function selectedCount(page: Page) {
  return page.evaluate(() => (window as any).__stores.useSelectionStore.getState().selectedIds.size as number)
}

async function activeRowId(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('data-nav-row') ?? null)
}

async function mockTask(page: Page, id: string) {
  return page.evaluate(async (taskId) => {
    const all = (await (window as any).__TAURI_INTERNALS__.invoke('get_local_tasks', { includeCompleted: true })) as any[]
    return all.find((t) => t.id === taskId)
  }, id)
}

async function openMark(page: Page, row: Locator, kind: Kind, value = '') {
  const m = mark(row, kind, value)
  await expect(m, `${kind} mark control`).toBeVisible()
  await m.click()
  await expect(popups(page).first(), `${kind} picker`).toBeVisible()
  return m
}

/** Click the visible popup option whose text is exactly `text`. */
async function pickOption(page: Page, text: string) {
  const re = new RegExp(`^\\s*${text}\\s*$`, 'i')
  const opt = page
    .locator('[role=menu] [role^=menuitem], [role=listbox] [role=option], [role=dialog] [role=option], [role=dialog] [role^=menuitem], [role=dialog] button')
    .filter({ visible: true })
    .filter({ hasText: re })
    .first()
  await opt.click()
}

async function pickDueDay(page: Page, day: string) {
  await popups(page).getByRole('button', { name: new RegExp(`August ${day}(st|nd|rd|th)?,? 2026`, 'i') }).first().click()
}

/** Tick a label in the label picker, opening the nested "Add label" list if needed. */
async function pickLabel(page: Page, name: string) {
  const re = new RegExp(`^\\s*${name}\\s*$`, 'i')
  const option = () =>
    page
      .locator('[role=dialog] label, [role=dialog] [role=option], [role=dialog] [role^=menuitem], [role=listbox] [role=option], [role=menu] [role^=menuitem]')
      .filter({ visible: true })
      .filter({ hasText: re })
      .first()
  if (!(await option().isVisible())) {
    await popups(page).getByRole('button', { name: /add label/i }).first().click()
  }
  await option().click()
}

/** Escape one layer at a time (a stray Escape on a list clears row focus). */
async function closeAllPopups(page: Page) {
  for (let i = 0; i < 3; i++) {
    const open = await popups(page).count()
    if (open === 0) break
    await page.keyboard.press('Escape')
    await expect.poll(() => popups(page).count(), { message: 'Escape closes a picker layer', timeout: 2000 }).toBeLessThan(open)
  }
  await expect(popups(page)).toHaveCount(0)
}

async function box(l: Locator) {
  const b = await l.boundingBox()
  expect(b, 'element has a box').not.toBeNull()
  return b!
}

/** Title left offset + right-cluster text offsets, relative to the row. */
async function rowGeometry(row: Locator, s: Surface) {
  const rb = await box(row)
  const tb = await box(row.getByText(s.title, { exact: true }))
  const right: Record<string, number> = {}
  for (const t of Object.keys(s.rightTexts)) {
    const b = await box(row.getByText(t, { exact: true }).first())
    right[t] = +(rb.x + rb.width - (b.x + b.width)).toFixed(1)
  }
  return { height: rb.height, titleLeft: +(tb.x - rb.x).toFixed(1), titleWidth: +tb.width.toFixed(1), right }
}

/** Styles that can carry a hover affordance on the mark, its pseudos and descendants. */
async function hoverStyles(m: Locator) {
  return m.evaluate((el) => {
    const pick = (cs: CSSStyleDeclaration) => [cs.backgroundColor, cs.color, cs.boxShadow, cs.opacity].join('|')
    const parts = [pick(getComputedStyle(el)), pick(getComputedStyle(el, '::before')), pick(getComputedStyle(el, '::after'))]
    for (const d of Array.from(el.querySelectorAll('*'))) parts.push(pick(getComputedStyle(d)))
    return parts.join('#')
  })
}

// ── AC1 — pickers controlled, detail page unchanged ─────────────────────

test('AC1 detail page pickers still open, pick and close (uncontrolled use unchanged)', async ({ app, page }) => {
  await app.open('tasks')
  await rowOf(page, 'task-05').getByText('Ship v1.5: quick-capture polish', { exact: true }).click()
  await expect.poll(() => detailTarget(page)).toBe('task-05')
  const main = page.locator('main').first()
  await expect(main.getByRole('heading', { name: /Ship v1\.5/ })).toBeVisible()

  // Priority chip → menu → High.
  // The chip's name also carries the bars' "Priority 4" (role=img).
  await main.getByRole('button', { name: /\burgent$/i }).first().click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: /\bhigh$/i }).click()
  await expect(popups(page)).toHaveCount(0)
  await expect(main.getByRole('button', { name: /\bhigh$/i }).first()).toBeVisible()

  // Due chip → dialog; Escape closes.
  await main.getByRole('button', { name: 'Due Aug 3' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popups(page)).toHaveCount(0)

  // Label chip → dialog with Add label; Escape closes.
  await main.getByRole('button', { name: 'quick-win', exact: true }).first().click()
  await expect(page.getByRole('dialog').getByRole('button', { name: /add label/i })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popups(page)).toHaveCount(0)
})

// ── AC2 — clicking a mark opens its picker, not the task ────────────────

for (const s of Object.values(SURFACES)) {
  for (const kind of KINDS) {
    const value = s.marks[kind]
    if (value === undefined) continue
    test(`AC2 ${s.key}: clicking the ${kind} mark opens its picker, not the task or selection`, async ({ app, page }) => {
      await openSurface(app, page, s)
      const row = rowOf(page, s.row)
      await openMark(page, row, kind, value)
      expect(await detailTarget(page), 'task detail must not open').toBeNull()
      expect(await selectedCount(page), 'selection must not toggle').toBe(0)
      await expect(row).toBeVisible()
    })
  }
}

// Review (iteration 2): the project picker reads one page-wide project list —
// opening it on several rows loads projects at most once after page load,
// and it never shows "None available" while projects exist.
test('AC2 tasks: project pickers on two rows share one projects load and never show "None available"', async ({ app, page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown, o?: unknown) => unknown }
      __projectLoads: number
      __sawNoneAvailable: boolean
    }
    w.__projectLoads = 0
    w.__sawNoneAvailable = false
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
      if (cmd === 'get_projects') w.__projectLoads++
      return orig(cmd, args, opts)
    }
    new MutationObserver(() => {
      if (document.body?.textContent?.includes('None available')) w.__sawNoneAvailable = true
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  })
  await openSurface(app, page, SURFACES.tasks)
  const loads = () => page.evaluate(() => (window as unknown as { __projectLoads: number }).__projectLoads)
  const before = await loads()
  for (const id of ['task-05', 'task-04', 'task-05']) {
    await openMark(page, rowOf(page, id), 'project')
    await expect(popups(page).getByRole('menuitem', { name: 'Portfolio', exact: true })).toBeVisible()
    await closeAllPopups(page)
  }
  expect((await loads()) - before, 'projects list calls after page load').toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => (window as unknown as { __sawNoneAvailable: boolean }).__sawNoneAvailable), '"None available" shown').toBe(false)
})

// ── AC3 — choosing updates the row and closes; Escape closes; focus back ─

const CHOICES: { kind: Kind; pick: (page: Page) => Promise<void>; expectValue: string; stored: (t: any) => boolean; closes: boolean }[] = [
  {
    kind: 'priority',
    pick: (page) => pickOption(page, 'High'),
    expectValue: 'high',
    stored: (t) => t.priority === 3,
    closes: true,
  },
  {
    kind: 'due',
    pick: (page) => pickDueDay(page, '10'),
    expectValue: 'aug(ust)?\\s*10\\b',
    stored: (t) => t.due_date === '2026-08-10',
    closes: true,
  },
  {
    // Multi-select: ticking a label need not close the picker (see report).
    kind: 'label',
    pick: (page) => pickLabel(page, 'design'),
    expectValue: 'design',
    stored: (t) => t.labels.includes('label-design') && t.labels.includes('label-quick-win'),
    closes: false,
  },
  {
    kind: 'project',
    pick: (page) => pickOption(page, 'Portfolio'),
    expectValue: 'portfolio',
    stored: (t) => t.project_id === 'proj-portfolio',
    closes: true,
  },
]

for (const c of CHOICES) {
  test(`AC3 tasks: choosing a ${c.kind} updates the row, closes the picker and returns focus to the row`, async ({ app, page }) => {
    const s = SURFACES.tasks
    await openSurface(app, page, s)
    const row = rowOf(page, s.row)
    await openMark(page, row, c.kind, s.marks[c.kind])
    await c.pick(page)
    await expect(mark(row, c.kind, c.expectValue), 'row shows the new value').toBeVisible()
    await expect.poll(async () => c.stored(await mockTask(page, 'task-05')), 'task persisted').toBe(true)
    if (c.closes) await expect(popups(page), 'picker closes on choice').toHaveCount(0)
    else await closeAllPopups(page)
    await expect.poll(() => activeRowId(page), 'focus returns to the row').toBe(s.row)
    expect(await detailTarget(page)).toBeNull()
  })
}

for (const key of ['project', 'today', 'inbox'] as const) {
  test(`AC3 ${key}: choosing a priority updates the row, closes the picker and returns focus to the row`, async ({ app, page }) => {
    const s = SURFACES[key]
    await openSurface(app, page, s)
    const row = rowOf(page, s.row)
    await openMark(page, row, 'priority', s.marks.priority)
    await pickOption(page, s.newPriority)
    await expect(mark(row, 'priority', s.newPriority.toLowerCase())).toBeVisible()
    await expect(popups(page)).toHaveCount(0)
    await expect.poll(() => activeRowId(page)).toBe(s.row)
  })
}

for (const s of Object.values(SURFACES)) {
  for (const kind of KINDS) {
    const value = s.marks[kind]
    if (value === undefined) continue
    test(`AC3 ${s.key}: Escape closes the ${kind} picker without change and returns focus to the row`, async ({ app, page }) => {
      await openSurface(app, page, s)
      const row = rowOf(page, s.row)
      const id = s.key === 'inbox' ? 'task-14' : s.row
      const before = await mockTask(page, id)
      await openMark(page, row, kind, value)
      await closeAllPopups(page)
      await expect(mark(row, kind, value), 'value unchanged').toBeVisible()
      expect(await mockTask(page, id)).toEqual(before)
      await expect.poll(() => activeRowId(page), 'focus returns to the row').toBe(s.row)
      await expectFocusRing(page)
    })
  }
}

// ── AC4 — hover affordance, 24×24 hit area, no layout shift ─────────────

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test.use({ theme })
    for (const kind of KINDS) {
      test(`AC4 tasks: the ${kind} mark shows a hover affordance and pointer cursor (${theme})`, async ({ app, page }) => {
        const s = SURFACES.tasks
        await openSurface(app, page, s)
        const row = rowOf(page, s.row)
        const m = mark(row, kind, s.marks[kind])
        await expect(m).toBeVisible()
        // Row hovered, mark not: isolates the mark's own affordance.
        await row.getByText(s.title, { exact: true }).hover()
        const rest = await hoverStyles(m)
        await m.hover()
        await expect.poll(() => hoverStyles(m), 'mark style changes on hover').not.toBe(rest)
        const b = await box(m)
        const cursor = await page.evaluate(
          ([x, y]) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
          [b.x + b.width / 2, b.y + b.height / 2],
        )
        expect(cursor).toBe('pointer')
      })
    }
  })
}

for (const key of ['tasks', 'today'] as const) {
  for (const kind of KINDS) {
    test(`AC4 ${key}: the ${kind} mark has at least a 24×24 hit area`, async ({ app, page }) => {
      const s = SURFACES[key]
      await openSurface(app, page, s)
      const m = mark(rowOf(page, s.row), kind, s.marks[kind])
      await expect(m).toBeVisible()
      const b = await box(m)
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      const misses = await m.evaluate(
        (el, [x, y]) => {
          const pts = [[x, y], [x - 11.5, y - 11.5], [x + 11.5, y - 11.5], [x - 11.5, y + 11.5], [x + 11.5, y + 11.5], [x, y - 11.5], [x, y + 11.5], [x - 11.5, y], [x + 11.5, y]]
          return pts.filter(([px, py]) => {
            const hit = document.elementFromPoint(px, py)
            return !hit || !el.contains(hit)
          }).map(([px, py]) => `${Math.round(px - x)},${Math.round(py - y)}`)
        },
        [cx, cy],
      )
      expect(misses, `points of the 24×24 square around the ${kind} mark that miss it`).toEqual([])
    })
  }
}

for (const s of Object.values(SURFACES)) {
  test(`AC4 ${s.key}: row stays 36px, title edge and right cluster unchanged vs main, no clipping`, async ({ app, page }) => {
    await openSurface(app, page, s)
    const row = rowOf(page, s.row)
    const g = await rowGeometry(row, s)
    expect(g.height).toBe(36)
    // Marco 2026-09-24 option A: row content +16px for 24px grip (was 68).
    expect(g.titleLeft).toBeCloseTo(84, 0)
    for (const [t, want] of Object.entries(s.rightTexts)) expect(g.right[t], `${t} offset from row end`).toBeCloseTo(want, 0)
    await expectNoClipping(row, { allowEllipsis: true })
  })
}

for (const key of ['tasks', 'today'] as const) {
  test(`AC4 ${key}: hovering each mark shifts nothing in the row`, async ({ app, page }) => {
    const s = SURFACES[key]
    await openSurface(app, page, s)
    const row = rowOf(page, s.row)
    await row.getByText(s.title, { exact: true }).hover()
    const rest = await rowGeometry(row, s)
    for (const kind of KINDS) {
      const m = mark(row, kind, s.marks[kind])
      await expect(m, `${kind} mark control`).toBeVisible()
      const markRest = await box(m)
      await m.hover()
      expect(await rowGeometry(row, s), `geometry while hovering ${kind}`).toEqual(rest)
      const markHover = await box(m)
      expect([markHover.x, markHover.width], `${kind} mark box`).toEqual([markRest.x, markRest.width])
    }
  })
}

// ── AC5 — pickers fully in the viewport, nothing clips ──────────────────
// Marco 2026-09-24: Normal gets an empty icon — every row has a priority
// mark, so lastRowWithMark(page, 'priority') is now the list's last row.

async function lastRowWithMark(page: Page, kind: Kind) {
  const rows = page.locator('[data-nav-row]')
  const n = await rows.count()
  for (let i = n - 1; i >= 0; i--) {
    if ((await mark(rows.nth(i), kind).count()) > 0) return rows.nth(i)
  }
  throw new Error(`no row has a ${kind} mark control`)
}

async function expectPopupsInViewport(page: Page) {
  const vp = page.viewportSize()!
  const boxes = await popups(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
  expect(boxes.length).toBeGreaterThan(0)
  for (const b of boxes) {
    expect(b.left, 'popup left').toBeGreaterThanOrEqual(0)
    expect(b.top, 'popup top').toBeGreaterThanOrEqual(0)
    expect(b.right, 'popup right').toBeLessThanOrEqual(vp.width)
    expect(b.bottom, 'popup bottom').toBeLessThanOrEqual(vp.height)
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
    test.describe(`${theme} ${vp.width}x${vp.height}`, () => {
      test.use({ theme, viewport: vp })
      for (const kind of KINDS) {
        test(`AC5 tasks: the ${kind} picker is fully in the viewport and nothing in it clips (${theme}, ${vp.width}x${vp.height})`, async ({ app, page }) => {
          const s = SURFACES.tasks
          await openSurface(app, page, s)
          for (const row of [rowOf(page, s.row), await lastRowWithMark(page, kind)]) {
            await openMark(page, row, kind)
            await page.waitForTimeout(250) // popup entry animation
            await expectPopupsInViewport(page)
            await expectNoClipping(popups(page))
            await expectNoClipping(row, { allowEllipsis: true })
            await closeAllPopups(page)
          }
        })
      }
    })
  }
}

// ── AC6 — names, axe, keyboard ───────────────────────────────────────────

for (const key of ['tasks', 'today', 'inbox'] as const) {
  test(`AC6 ${key}: every mark control's accessible name includes its value`, async ({ app, page }) => {
    const s = SURFACES[key]
    await openSurface(app, page, s)
    const row = rowOf(page, s.row)
    for (const [kind, value] of Object.entries(s.marks) as [Kind, string][]) {
      await expect(mark(row, kind, value), `${kind} control named with "${value}"`).toBeVisible()
    }
  })
}

test('AC6 tasks: no new axe violations (nested-interactive must not grow)', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  await expectNoNewAxeViolations(page, 'tasks')
})

test('AC6 today: no new axe violations with the Due today rows showing', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.today)
  await expectNoNewAxeViolations(page, 'today-rows')
})

test('AC6 inbox: no new axe violations with a task row carrying marks', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.inbox)
  await expectNoNewAxeViolations(page, 'inbox-marks')
})

test('AC6 tasks: no new axe violations with a row picker open', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  await openMark(page, rowOf(page, s.row), 'priority', s.marks.priority)
  await expectNoNewAxeViolations(page, 'tasks')
})

test('AC6 tasks: j/k move row focus with a visible focus ring', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  const ids = await page.locator('[data-nav-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-row')))
  await page.keyboard.press('j')
  await expect.poll(() => activeRowId(page)).toBe(ids[0])
  await expectFocusRing(page)
  await page.keyboard.press('j')
  await expect.poll(() => activeRowId(page)).toBe(ids[1])
  await page.keyboard.press('k')
  await expect.poll(() => activeRowId(page)).toBe(ids[0])
  await expectFocusRing(page)
})

for (const key of ['Enter', ' '] as const) {
  test(`AC6 tasks: ${key === ' ' ? 'Space' : 'Enter'} on a focused row opens the task`, async ({ app, page }) => {
    await openSurface(app, page, SURFACES.tasks)
    await page.keyboard.press('j')
    const id = await activeRowId(page)
    expect(id).not.toBeNull()
    await page.keyboard.press(key)
    await expect.poll(() => detailTarget(page)).toBe(id)
  })
}

for (const key of ['today', 'inbox'] as const) {
  test(`AC6 ${key}: Enter on a focused task row opens the task`, async ({ app, page }) => {
    const s = SURFACES[key]
    await openSurface(app, page, s)
    await rowOf(page, s.row).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => detailTarget(page)).toBe(key === 'inbox' ? 'task-14' : s.row)
  })
}

test('AC6 tasks: x, s and f still act on the focused row', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)

  // s — snooze the first row (task-06, no due date) to tomorrow (Aug 2).
  await page.keyboard.press('j')
  const first = (await activeRowId(page))!
  await page.keyboard.press('s')
  await expect.poll(async () => (await mockTask(page, first)).due_date).toBe('2026-08-02')

  // f — Focus now reaches the focus engine; the browser harness answers
  // with a "Focus is read-only in the browser harness." toast.
  await rowOf(page, first).focus()
  await page.keyboard.press('f')
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /focus/i }).first()).toBeVisible()

  // x — complete it.
  await rowOf(page, first).focus()
  await page.keyboard.press('x')
  await expect.poll(async () => (await mockTask(page, first)).completed).toBe(true)
  expect(await detailTarget(page)).toBeNull()
})

// ── AC7 — completed tasks ────────────────────────────────────────────────

test('AC7 tasks: marks on a completed task open their pickers; strikethrough unchanged', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  const row = rowOf(page, 'task-13') // completed: priority 4, due Jul 31, Life Admin
  const title = row.getByText('Pay quarterly estimated taxes', { exact: true })
  const deco = () => title.evaluate((el) => getComputedStyle(el).textDecorationLine)
  expect(await deco()).toContain('line-through')
  for (const [kind, value] of [['priority', 'urgent'], ['due', 'jul\\s*31'], ['project', 'life admin']] as [Kind, string][]) {
    await openMark(page, row, kind, value)
    expect(await detailTarget(page)).toBeNull()
    expect(await deco()).toContain('line-through')
    await closeAllPopups(page)
  }
})

// ── Screenshots (before/after evidence; never fail on missing states) ───

const SHOT_DIR = process.env.SHOT_DIR
type ShotState = { n: number; name: string; surface: Surface; kind?: Kind; hover?: boolean }
const SHOTS: ShotState[] = []
{
  let n = 1
  for (const key of ['tasks', 'today'] as const) {
    const s = SURFACES[key]
    SHOTS.push({ n: n++, name: `${key}-rest`, surface: s })
    SHOTS.push({ n: n++, name: `${key}-row-hover`, surface: s, hover: true })
    for (const kind of KINDS) SHOTS.push({ n: n++, name: `${key}-${kind}-picker`, surface: s, kind })
  }
}

test.describe('screenshots', () => {
  test.skip(!SHOT_DIR, 'set SHOT_DIR to capture screenshots')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme, viewport: { width: 1440, height: 900 } })
      for (const shot of SHOTS) {
        test(`${String(shot.n).padStart(2, '0')} ${shot.name} ${theme}`, async ({ app, page }) => {
          await openSurface(app, page, shot.surface)
          const row = rowOf(page, shot.surface.row)
          let missing = false
          try {
            if (shot.hover) await row.getByText(shot.surface.title, { exact: true }).hover({ timeout: 2000 })
            if (shot.kind) {
              const m = mark(row, shot.kind, shot.surface.marks[shot.kind])
              await m.waitFor({ state: 'visible', timeout: 2000 })
              await m.click({ timeout: 2000 })
              await popups(page).first().waitFor({ state: 'visible', timeout: 2000 })
              await page.waitForTimeout(250)
            }
          } catch {
            missing = true
          }
          fs.mkdirSync(SHOT_DIR!, { recursive: true })
          const file = `${String(shot.n).padStart(2, '0')}-${shot.name}-${theme}${missing ? '-missing' : ''}.png`
          await page.screenshot({ path: path.join(SHOT_DIR!, file) })
        })
      }
    })
  }
})
