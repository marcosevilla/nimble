// T2 — Focused-row keys `p` · `⇧D` · `l` · `m`.
// Acceptance: docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "T2".
//
// Contract for the builder (everything below that the T1 base 2dcb98e lacks):
//   • With a task row focused (the element carrying `data-nav-row` is
//     `document.activeElement`, reached by j/k, Tab, or by focus returning
//     to it after a mark's picker closes), a bare key opens that row's picker:
//       p  → priority picker  (role=menu with menuitems Normal/Medium/High/Urgent)
//       ⇧D → due-date picker  (role=dialog with react-day-picker day buttons,
//                              "Monday, August 10th, 2026")
//       l  → label picker     (role=dialog holding the "Add label" button or
//                              the "Search or create..." field)
//       m  → project picker   (role=menu whose menuitems are project names)
//     i.e. the SAME picker the row's mark opens on click (T1), e.g. via
//     `useRowPickerStore.getState().openPicker(rowId, kind)`. Exactly one
//     popup is open afterwards; the task detail does not open; selection is
//     untouched. `⇧D` arrives as e.key === 'D'; plain `d`, `P`, `L`, `M` and
//     any ⌘/⌃/⌥ combo do nothing. Pure mapping: `src/lib/rowPickerKeys.ts`
//     (see tests/rowKeys.test.mjs for that module's contract).
//   • Surfaces: Tasks, a project page (nav tree → Nimble), Today's "Due
//     today" rows (Today has no j/k list today; its rows are reached by Tab),
//     and Inbox TASK rows (`data-nav-row="task:<id>"`).
//   • Anchoring: when the row shows the mark, the key-opened popup sits
//     where the click-opened one does (same box within 4px), vertically
//     adjacent to the mark and overlapping it horizontally. When the mark is
//     missing (Normal priority, no due date, no labels, Inbox rows have no
//     project) the popup's right edge is within 16px of the row's right edge
//     and it sits just below (or, flipped, just above) the row. Either way
//     every popup is fully inside the viewport and does not intersect the
//     row's title box (the element named by the row's `aria-labelledby`),
//     and opening it never moves the title (no phantom mark in the layout).
//   • Closing: picking a value (keyboard: focus the option, Enter) or Escape
//     leaves `document.activeElement` on the same row with a visible focus
//     ring; on Tasks and project pages the next `j` focuses the next row.
//   • Guards: nothing opens while typing in a field (Inbox capture, ⌘K),
//     while a popover/dialog/menu is already open, or with focus in the nav
//     project tree. Inbox NOTE rows keep t (convert) / m (Move to doc) / d
//     (dismiss) exactly as on the base; p, ⇧D and l on a note do nothing.
//   • Registry: lib/shortcuts.ts gets four Tasks rows with keys 'p', '⇧D',
//     'l', 'm' (appended), so the `?` help panel's Tasks section lists them.
//   • Axe: no new violations with a key-opened picker open on tasks
//     (`tasks`), today (`today-rows`) and inbox (`inbox-marks`).
//
// Every test pins the clock to the mock world's "today" (Sat Aug 1 2026),
// like t1-row-marks.spec.ts, so Today's "Due today" list has rows.
import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

const MOCK_NOW = new Date('2026-08-01T10:00:00')

type Kind = 'priority' | 'due' | 'label' | 'project'
const KINDS: Kind[] = ['priority', 'due', 'label', 'project']
/** Playwright key for each picker. */
const KEY: Record<Kind, string> = { priority: 'p', due: 'Shift+D', label: 'l', project: 'm' }
const KEY_NAME: Record<Kind, string> = { priority: 'p', due: '⇧D', label: 'l', project: 'm' }

interface Surface {
  key: 'tasks' | 'project' | 'today' | 'inbox'
  pageId: string
  row: string
  title: string
  /** How a keyboard user reaches the row on this page. */
  nav: 'j' | 'tab'
}

const SURFACES: Record<Surface['key'], Surface> = {
  // task-05: urgent, due Aug 3, quick-win, Nimble — every mark present.
  tasks: { key: 'tasks', pageId: 'tasks', row: 'task-05', title: 'Ship v1.5: quick-capture polish', nav: 'j' },
  project: { key: 'project', pageId: 'tasks', row: 'task-05', title: 'Ship v1.5: quick-capture polish', nav: 'j' },
  // task-04: high, due today, bug + deep-work, Nimble.
  today: { key: 'today', pageId: 'today', row: 'task-04', title: 'Fix capture strip focus bug on second monitor', nav: 'tab' },
  // task-14 unseeded: Normal priority, no due, no labels, and Inbox rows never show a project.
  inbox: { key: 'inbox', pageId: 'inbox', row: 'task:task-14', title: 'Research pedalboard flight case options', nav: 'j' },
}

/** task-10 "Book dentist appointment": Normal priority, no due, no labels, project Life Admin. */
const BARE = { row: 'task-10', title: 'Book dentist appointment' }

// ── helpers ──────────────────────────────────────────────────────────────

test.beforeEach(async ({ app: _app, page }) => {
  await page.clock.setFixedTime(MOCK_NOW)
})

/** Give Inbox task-14 marks (same seed as t1-row-marks.spec.ts). */
async function seedInbox(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __TAURI_INTERNALS__: { invoke(c: string, a: unknown): unknown } }).__TAURI_INTERNALS__.invoke(
      'update_local_task',
      { id: 'task-14', priority: 3, dueDate: '2026-08-03', labelIds: ['label-quick-win'] },
    )
  })
}

async function openSurface(app: App, page: Page, s: Surface, opts: { seedInbox?: boolean } = {}) {
  if (s.key === 'inbox' && opts.seedInbox) await seedInbox(page)
  await app.open(s.pageId)
  if (s.key === 'project') {
    await page.getByRole('treeitem', { name: 'Nimble', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Nimble', exact: true })).toBeVisible()
    // The click leaves focus on the tree item, which owns every key (tree
    // guard); a user continues from the page body.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
  await expect(rowOf(page, s.row)).toBeVisible()
}

const rowOf = (page: Page, id: string) => page.locator(`[data-nav-row="${id}"]`)

async function activeRowId(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('data-nav-row') ?? null)
}

async function rowIds(page: Page) {
  return page.locator('[data-nav-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-row')!))
}

/** Reach `id` with j/k presses (the list's own keyboard path), starting
 * from whichever row holds focus now (none: j lands on the first row). */
async function focusByJ(page: Page, id: string) {
  const ids = await rowIds(page)
  const at = ids.indexOf(id)
  expect(at, `${id} is a row`).toBeGreaterThanOrEqual(0)
  let cur = ids.indexOf((await activeRowId(page)) ?? '')
  while (cur !== at) {
    const down = cur < at
    await page.keyboard.press(down ? 'j' : 'k')
    cur = cur < 0 ? 0 : cur + (down ? 1 : -1)
    await expect.poll(() => activeRowId(page), `${down ? 'j' : 'k'} → ${ids[cur]}`).toBe(ids[cur])
  }
}

/** Reach `id` with Tab, starting from the first row of the page's list. */
async function focusByTab(page: Page, id: string) {
  await page.locator('[data-nav-row]').first().focus()
  for (let i = 0; i < 60 && (await activeRowId(page)) !== id; i++) await page.keyboard.press('Tab')
  expect(await activeRowId(page), `Tab reaches ${id}`).toBe(id)
}

async function focusByKeyboard(page: Page, s: Pick<Surface, 'nav'>, id: string) {
  if (s.nav === 'j') await focusByJ(page, id)
  else await focusByTab(page, id)
  await expectFocusRing(page)
}

const popups = (page: Page) => page.locator('[role=dialog], [role=menu], [role=listbox]').filter({ visible: true })

function markName(kind: Kind) {
  return new RegExp(`^\\s*${kind}\\b`, 'i')
}

/** The row's mark control for `kind` (T1), never the row itself. */
function mark(row: Locator, kind: Kind) {
  const name = markName(kind)
  return row
    .getByRole('button', { name })
    .or(row.getByRole('combobox', { name }))
    .and(row.page().locator(':not([data-nav-row])'))
    .first()
}

/** Click-focus: click one of the row's marks, Escape — T1 hands focus to the row. */
async function focusByClick(page: Page, row: Locator, id: string) {
  const any = row
    .getByRole('button', { name: /^\s*(priority|due|label|project)\b/i })
    .and(page.locator(':not([data-nav-row])'))
    .first()
  await any.click()
  await expect(popups(page).first()).toBeVisible()
  await closeAllPopups(page)
  await expect.poll(() => activeRowId(page), 'click-focus lands on the row').toBe(id)
}

/** The visible picker of `kind` (scoped to open popups). */
function picker(page: Page, kind: Kind): Locator {
  const pop = popups(page)
  switch (kind) {
    case 'priority':
      return page.locator('[role=menu]').filter({ visible: true }).filter({ has: page.getByRole('menuitem', { name: /urgent/i }) }).filter({ has: page.getByRole('menuitem', { name: /medium/i }) })
    case 'due':
      return page.locator('[role=dialog]').filter({ visible: true }).filter({ has: page.getByRole('button', { name: /August \d{1,2}(st|nd|rd|th)?,? 2026/i }) })
    case 'label':
      return pop.filter({ has: page.getByRole('button', { name: /add label/i }).or(page.getByPlaceholder(/search or create/i)) })
    case 'project':
      return page.locator('[role=menu]').filter({ visible: true }).filter({ has: page.getByRole('menuitem', { name: /^\s*Life Admin\s*$/ }) }).filter({ has: page.getByRole('menuitem', { name: /^\s*Portfolio\s*$/ }) })
  }
}

async function expectPicker(page: Page, kind: Kind, why = '') {
  await expect(picker(page, kind), `${KEY_NAME[kind]} opens the ${kind} picker ${why}`.trim()).toHaveCount(1)
  await expect(popups(page), 'exactly one popup').toHaveCount(1)
}

async function visibleRowPickers(page: Page) {
  const out: Kind[] = []
  for (const k of KINDS) if ((await picker(page, k).count()) > 0) out.push(k)
  return out
}

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

async function mockTask(page: Page, id: string) {
  return page.evaluate(async (taskId) => {
    const all = (await (window as any).__TAURI_INTERNALS__.invoke('get_local_tasks', { includeCompleted: true })) as any[]
    return all.find((t) => t.id === taskId)
  }, id)
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

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

async function rectOf(l: Locator): Promise<Rect> {
  return l.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  })
}

async function popupRects(page: Page): Promise<Rect[]> {
  return popups(page).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }),
  )
}

/** The row's title element (named by aria-labelledby). */
async function titleRect(row: Locator): Promise<Rect> {
  return row.evaluate((el) => {
    const t = document.getElementById(el.getAttribute('aria-labelledby') ?? '') ?? el.querySelector('span.truncate')
    const r = t!.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  })
}

const intersects = (a: Rect, b: Rect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

async function expectPopupsInViewport(page: Page) {
  const vp = page.viewportSize()!
  const rects = await popupRects(page)
  expect(rects.length).toBeGreaterThan(0)
  for (const b of rects) {
    expect(b.left, 'popup left').toBeGreaterThanOrEqual(0)
    expect(b.top, 'popup top').toBeGreaterThanOrEqual(0)
    expect(b.right, 'popup right').toBeLessThanOrEqual(vp.width)
    expect(b.bottom, 'popup bottom').toBeLessThanOrEqual(vp.height)
  }
}

async function expectTitleUncovered(page: Page, row: Locator) {
  const t = await titleRect(row)
  for (const p of await popupRects(page)) expect(intersects(p, t), `popup ${JSON.stringify(p)} covers the row title ${JSON.stringify(t)}`).toBe(false)
}

/** Popup just below (or, flipped, just above) `anchor`. */
function expectVerticallyAdjacent(p: Rect, anchor: Rect, what: string) {
  const below = p.top >= anchor.bottom - 6 && p.top <= anchor.bottom + 14
  const above = p.bottom <= anchor.top + 6 && p.bottom >= anchor.top - 14
  expect(below || above, `popup ${JSON.stringify(p)} adjacent to ${what} ${JSON.stringify(anchor)}`).toBe(true)
}

async function pressRowKey(page: Page, kind: Kind) {
  await page.keyboard.press(KEY[kind])
}

/** Open `kind` from the focused row by key and wait out the entry animation. */
async function keyOpen(page: Page, kind: Kind) {
  await pressRowKey(page, kind)
  await expectPicker(page, kind)
  await page.waitForTimeout(250) // popup entry animation
}

// ── AC1 — keys open the matching picker on a focused row ────────────────

for (const key of ['tasks', 'project', 'today'] as const) {
  const s = SURFACES[key]
  for (const kind of KINDS) {
    test(`AC1 ${key}: ${KEY_NAME[kind]} on a keyboard-focused row (${s.nav === 'j' ? 'j' : 'Tab'}) opens the ${kind} picker`, async ({ app, page }) => {
      await openSurface(app, page, s)
      await focusByKeyboard(page, s, s.row)
      await pressRowKey(page, kind)
      await expectPicker(page, kind)
      expect(await detailTarget(page), 'task detail must not open').toBeNull()
      expect(await selectedCount(page), 'selection untouched').toBe(0)
    })
  }

  test(`AC1 ${key}: p, ⇧D, l and m on a click-focused row each open their picker`, async ({ app, page }) => {
    await openSurface(app, page, s)
    const row = rowOf(page, s.row)
    await focusByClick(page, row, s.row)
    for (const kind of KINDS) {
      await pressRowKey(page, kind)
      await expectPicker(page, kind, 'after click-focus')
      await closeAllPopups(page)
      await expect.poll(() => activeRowId(page), `focus back on the row after the ${kind} picker`).toBe(s.row)
    }
    expect(await detailTarget(page)).toBeNull()
  })
}

test('AC1 tasks: keys work on a Tab-focused row too', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  await focusByTab(page, s.row)
  await pressRowKey(page, 'label')
  await expectPicker(page, 'label')
})

test('AC1 tasks: d, P, L, M and ⌘/⌥ combos open nothing', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  await focusByJ(page, s.row)
  for (const k of ['d', 'Shift+P', 'Shift+L', 'Shift+M', 'Alt+p', 'Alt+l']) {
    await page.keyboard.press(k)
    await page.waitForTimeout(150)
    expect(await visibleRowPickers(page), `${k} opens no row picker`).toEqual([])
    if (await rowOf(page, s.row).isVisible()) await rowOf(page, s.row).focus()
  }
})

// ── AC2 — anchoring ──────────────────────────────────────────────────────

for (const key of ['tasks', 'today'] as const) {
  const s = SURFACES[key]
  for (const kind of KINDS) {
    test(`AC2 ${key}: the key-opened ${kind} picker anchors to the row's ${kind} mark`, async ({ app, page }) => {
      await openSurface(app, page, s)
      const row = rowOf(page, s.row)
      const m = mark(row, kind)
      await expect(m, `${kind} mark (T1)`).toBeVisible()

      // Reference: the click-opened picker's box.
      await m.click()
      await expectPicker(page, kind, '(click)')
      await page.waitForTimeout(250)
      const clickBox = (await popupRects(page))[0]
      await closeAllPopups(page)

      await focusByKeyboard(page, s, s.row)
      await keyOpen(page, kind)
      const [p] = await popupRects(page)
      const anchor = await rectOf(m)
      expect(Math.abs(p.left - clickBox.left), 'same x as the click-opened picker').toBeLessThanOrEqual(4)
      expect(Math.abs(p.top - clickBox.top), 'same y as the click-opened picker').toBeLessThanOrEqual(4)
      expect(Math.min(p.right, anchor.right) - Math.max(p.left, anchor.left), 'popup overlaps the mark horizontally').toBeGreaterThan(0)
      expectVerticallyAdjacent(p, anchor, `${kind} mark`)
      await expectPopupsInViewport(page)
      await expectTitleUncovered(page, row)
    })
  }
}

for (const kind of ['priority', 'due', 'label'] as const) {
  test(`AC2 tasks: with no ${kind} mark the ${KEY_NAME[kind]} picker anchors to the row's right end`, async ({ app, page }) => {
    const s = SURFACES.tasks
    await openSurface(app, page, s)
    const row = rowOf(page, BARE.row)
    await expect(mark(row, kind), `${BARE.row} has no ${kind} mark`).toHaveCount(0)
    const rowBox = await rectOf(row)
    const titleBefore = await titleRect(row)
    await focusByJ(page, BARE.row)
    await keyOpen(page, kind)
    const [p] = await popupRects(page)
    expect(Math.abs(p.right - rowBox.right), `popup right ${p.right} vs row right ${rowBox.right}`).toBeLessThanOrEqual(16)
    expectVerticallyAdjacent(p, rowBox, 'row')
    await expectPopupsInViewport(page)
    await expectTitleUncovered(page, row)
    const titleAfter = await titleRect(row)
    expect([titleAfter.left, titleAfter.top, (await rectOf(row)).height], 'no phantom mark moves the row').toEqual([titleBefore.left, titleBefore.top, 36])
  })
}

test('AC2 inbox: m on a task row (Inbox rows show no project) anchors to the row\'s right end', async ({ app, page }) => {
  const s = SURFACES.inbox
  await openSurface(app, page, s)
  const row = rowOf(page, s.row)
  await expect(mark(row, 'project')).toHaveCount(0)
  const rowBox = await rectOf(row)
  await row.focus()
  await keyOpen(page, 'project')
  const [p] = await popupRects(page)
  expect(Math.abs(p.right - rowBox.right), `popup right ${p.right} vs row right ${rowBox.right}`).toBeLessThanOrEqual(16)
  expectVerticallyAdjacent(p, rowBox, 'row')
  await expectPopupsInViewport(page)
  await expectTitleUncovered(page, row)
})

test('AC2 tasks: on the last row every key-opened picker stays in the viewport and off the title', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  const ids = await rowIds(page)
  const last = ids[ids.length - 1]
  await page.keyboard.press('k') // from no focus, k lands on the last row
  await expect.poll(() => activeRowId(page)).toBe(last)
  for (const kind of KINDS) {
    await keyOpen(page, kind)
    await expectPopupsInViewport(page)
    await expectTitleUncovered(page, rowOf(page, last))
    await closeAllPopups(page)
    await expect.poll(() => activeRowId(page)).toBe(last)
  }
})

// ── AC3 — pick or Escape → focus back on the row, ring, j continues ─────

async function expectBackOnRow(page: Page, id: string) {
  await expect(popups(page), 'picker closed').toHaveCount(0)
  await expect.poll(() => activeRowId(page), 'focus back on the same row').toBe(id)
  await expectFocusRing(page)
}

async function expectJContinues(page: Page, id: string) {
  const ids = await rowIds(page)
  const next = ids[ids.indexOf(id) + 1]
  await page.keyboard.press('j')
  await expect.poll(() => activeRowId(page), 'j moves on from the row').toBe(next)
}

/** Keyboard pick: focus the option, Enter. */
async function keyPick(page: Page, option: Locator) {
  await expect(option).toBeVisible()
  await option.focus()
  await page.keyboard.press('Enter')
}

const PICKS: { kind: Exclude<Kind, 'label'>; option: (page: Page) => Locator; stored: (t: any) => boolean }[] = [
  { kind: 'priority', option: (page) => page.getByRole('menuitem', { name: /\bhigh$/i }).first(), stored: (t) => t.priority === 3 },
  { kind: 'due', option: (page) => popups(page).getByRole('button', { name: /August 10(th)?,? 2026/i }).first(), stored: (t) => t.due_date === '2026-08-10' },
  { kind: 'project', option: (page) => page.getByRole('menuitem', { name: /^\s*Portfolio\s*$/ }).first(), stored: (t) => t.project_id === 'proj-portfolio' },
]

for (const c of PICKS) {
  test(`AC3 tasks: picking a ${c.kind} from the key-opened picker returns focus to the row; j continues`, async ({ app, page }) => {
    const s = SURFACES.tasks
    await openSurface(app, page, s)
    await focusByJ(page, s.row)
    await keyOpen(page, c.kind)
    await keyPick(page, c.option(page))
    await expect.poll(async () => c.stored(await mockTask(page, 'task-05')), 'task persisted').toBe(true)
    await expectBackOnRow(page, s.row)
    expect(await detailTarget(page)).toBeNull()
    await expectJContinues(page, s.row)
  })
}

for (const key of ['tasks', 'project'] as const) {
  for (const kind of KINDS) {
    test(`AC3 ${key}: Escape closes the key-opened ${kind} picker unchanged, focus stays on the row, j continues`, async ({ app, page }) => {
      const s = SURFACES[key]
      await openSurface(app, page, s)
      await focusByJ(page, s.row)
      const before = await mockTask(page, 'task-05')
      await keyOpen(page, kind)
      await page.keyboard.press('Escape')
      await expectBackOnRow(page, s.row)
      expect(await mockTask(page, 'task-05'), 'Escape changes nothing').toEqual(before)
      await expectJContinues(page, s.row)
    })
  }
}

test('AC3 tasks: Escape from a right-end-anchored picker (no mark) returns focus to the row', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  await focusByJ(page, BARE.row)
  for (const kind of ['priority', 'due', 'label'] as const) {
    await keyOpen(page, kind)
    await page.keyboard.press('Escape')
    await expectBackOnRow(page, BARE.row)
  }
  await expectJContinues(page, BARE.row)
})

test('AC3 today: Escape closes each key-opened picker and leaves focus (with ring) on the row', async ({ app, page }) => {
  const s = SURFACES.today
  await openSurface(app, page, s)
  await focusByTab(page, s.row)
  for (const kind of KINDS) {
    await keyOpen(page, kind)
    await page.keyboard.press('Escape')
    await expectBackOnRow(page, s.row)
  }
})

// ── AC4 — guards; Inbox task rows vs note rows ───────────────────────────

test('AC4 inbox: typing p l m D in the capture field types text and opens no picker', async ({ app, page }) => {
  const s = SURFACES.inbox
  await openSurface(app, page, s)
  await rowOf(page, s.row).focus() // a remembered row focus must not steal the keys
  const field = page.getByRole('textbox', { name: 'Capture a note' })
  await field.click()
  await page.keyboard.type('plm')
  await page.keyboard.press('Shift+D')
  await page.waitForTimeout(250)
  await expect(field).toHaveValue('plmD')
  expect(await visibleRowPickers(page)).toEqual([])
  await expect(popups(page)).toHaveCount(0)
})

test('AC4 tasks: with ⌘K open, p l m D type into the command bar and open no row picker', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  await focusByJ(page, s.row)
  await page.keyboard.press('Meta+k')
  const bar = page.getByRole('dialog', { name: 'Command bar' })
  await expect(bar).toBeVisible()
  const input = bar.locator('input').first()
  await expect(input).toBeFocused()
  await page.keyboard.type('plm')
  await page.keyboard.press('Shift+D')
  await page.waitForTimeout(250)
  await expect(input).toHaveValue('plmD')
  expect(await visibleRowPickers(page)).toEqual([])
})

test('AC4 tasks: with a picker already open, row keys open no second picker', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  const row = rowOf(page, s.row)
  await mark(row, 'due').click()
  await expectPicker(page, 'due', '(click)')
  for (const k of ['p', 'l', 'm']) await page.keyboard.press(k)
  await page.waitForTimeout(250)
  expect(await visibleRowPickers(page), 'only the due picker').toEqual(['due'])
  await expect(popups(page)).toHaveCount(1)
})

test('AC4 tasks: with the status popover open, row keys open no picker', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  const row = rowOf(page, s.row)
  const status = row.getByRole('button', { name: /^Status:/ })
  await status.click()
  await expect(popups(page)).toHaveCount(1)
  for (const k of ['p', 'l', 'm', 'Shift+D']) await page.keyboard.press(k)
  await page.waitForTimeout(250)
  expect(await visibleRowPickers(page)).toEqual([])
  await expect(popups(page), 'still only the status popover').toHaveCount(1)
})

test('AC4 tasks: row keys typed in the nav project tree open no picker', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  await focusByJ(page, s.row)
  const item = page.getByRole('treeitem', { name: 'Nimble', exact: true })
  await item.focus()
  for (const k of ['p', 'l', 'm', 'Shift+D']) await page.keyboard.press(k)
  await page.waitForTimeout(250)
  expect(await visibleRowPickers(page)).toEqual([])
  await expect(popups(page)).toHaveCount(0)
})

test('AC4 inbox: a task row gets p, ⇧D, l and m', async ({ app, page }) => {
  const s = SURFACES.inbox
  await openSurface(app, page, s)
  await focusByJ(page, s.row)
  for (const kind of KINDS) {
    await pressRowKey(page, kind)
    await expectPicker(page, kind, 'on an Inbox task row')
    expect(await detailTarget(page)).toBeNull()
    await page.keyboard.press('Escape')
    await expectBackOnRow(page, s.row)
  }
})

const NOTE = { content: 'Ask Jordan about the design offsite date' }
const noteRow = (page: Page) => page.locator('[data-nav-row^="note:"]').filter({ hasText: NOTE.content })

test('AC4 inbox: m on a note row still opens its Move to doc picker', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.inbox)
  await noteRow(page).focus()
  await page.keyboard.press('m')
  await expect(popups(page).filter({ hasText: 'Move to doc' })).toHaveCount(1)
  expect(await visibleRowPickers(page), 'no task picker on a note').toEqual([])
})

test('AC4 inbox: p, ⇧D and l on a note row do nothing', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.inbox)
  await noteRow(page).focus()
  for (const k of ['p', 'Shift+D', 'l']) {
    await page.keyboard.press(k)
    await page.waitForTimeout(150)
    await expect(popups(page), `${k} on a note`).toHaveCount(0)
    await expect(noteRow(page), `${k} keeps the note`).toHaveCount(1)
  }
})

test('AC4 inbox: d on a note row still dismisses it; t still converts a note to a task', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.inbox)
  await noteRow(page).focus()
  await page.keyboard.press('d')
  await expect(noteRow(page), 'd dismisses the note').toHaveCount(0)

  const other = page.locator('[data-nav-row^="note:"]').filter({ hasText: 'Try oklch() for the warm accent palette ramp' })
  await other.focus()
  await page.keyboard.press('t')
  await expect(other, 't converts the note').toHaveCount(0)
  await expect(page.locator('[data-nav-row^="task:"]').filter({ hasText: 'oklch()' }), 'converted task row').toHaveCount(1)
})

// ── AC5 — help panel lists the four keys ─────────────────────────────────

test('AC5 the ? help panel lists p, ⇧D, l and m under Tasks', async ({ app, page }) => {
  await app.open('tasks')
  await page.keyboard.press('?')
  const heading = page.getByRole('heading', { name: 'Tasks', exact: true, level: 3 })
  await expect(heading).toBeVisible()
  const rows = await heading.evaluate((h) =>
    // Label = the row's text minus the kbd element's own text node (a plain
    // string replace also ate the first "p" in "Set priority").
    Array.from(h.parentElement!.querySelectorAll('kbd')).map((k) => ({
      keys: k.textContent!.trim(),
      label: Array.from(k.parentElement!.childNodes).filter((n) => n !== k).map((n) => n.textContent).join('').trim(),
    })),
  )
  const want: [string, RegExp][] = [['p', /priority/i], ['⇧D', /due/i], ['l', /label/i], ['m', /project/i]]
  for (const [k, label] of want) {
    const row = rows.find((r) => r.keys === k)
    expect(row, `Tasks lists ${k}`).toBeTruthy()
    expect(row!.label).toMatch(label)
  }
})

// ── AC6 — axe and clipping with a key-opened picker ──────────────────────

test('AC6 tasks: no new axe violations with a key-opened picker open', async ({ app, page }) => {
  const s = SURFACES.tasks
  await openSurface(app, page, s)
  await focusByJ(page, s.row)
  await keyOpen(page, 'priority')
  await expectNoNewAxeViolations(page, 'tasks')
})

test('AC6 today: no new axe violations with a key-opened picker open', async ({ app, page }) => {
  const s = SURFACES.today
  await openSurface(app, page, s)
  await focusByTab(page, s.row)
  await keyOpen(page, 'due')
  await expectNoNewAxeViolations(page, 'today-rows')
})

test('AC6 inbox: no new axe violations with a key-opened picker open on a task row', async ({ app, page }) => {
  const s = SURFACES.inbox
  await openSurface(app, page, s, { seedInbox: true })
  await rowOf(page, s.row).focus()
  await keyOpen(page, 'label')
  await expectNoNewAxeViolations(page, 'inbox-marks')
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ theme })
    for (const kind of KINDS) {
      test(`AC6 tasks: nothing clips inside the key-opened ${kind} picker (${theme})`, async ({ app, page }) => {
        const s = SURFACES.tasks
        await openSurface(app, page, s)
        await focusByJ(page, s.row)
        await keyOpen(page, kind)
        await expectNoClipping(popups(page))
        await expectPopupsInViewport(page)
        await expectNoClipping(rowOf(page, s.row), { allowEllipsis: true })
      })
    }
    test(`AC6 tasks: nothing clips inside a right-end-anchored due picker (${theme})`, async ({ app, page }) => {
      await openSurface(app, page, SURFACES.tasks)
      await focusByJ(page, BARE.row)
      await keyOpen(page, 'due')
      await expectNoClipping(popups(page))
      await expectPopupsInViewport(page)
    })
  })
}

// ── Focus ring vs the flush-right mark (QA on T1) ────────────────────────

/** Right edge of the mark's own text glyphs (a Range over its text, so
 * padding inside the mark doesn't count). */
async function textRight(l: Locator) {
  return l.evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    return r.getBoundingClientRect().right
  })
}

for (const c of [
  { row: 'task-05', kind: 'due' as const, text: 'Aug 3' },
  { row: BARE.row, kind: 'project' as const, text: 'Life Admin' },
]) {
  test(`ring: a focused row's inset ring doesn't overlap the flush-right ${c.kind} text "${c.text}" (light)`, async ({ app, page }) => {
    await openSurface(app, page, SURFACES.tasks)
    await focusByJ(page, c.row)
    await expectFocusRing(page)
    const row = rowOf(page, c.row)
    const m = mark(row, c.kind)
    await expect(m).toHaveText(c.text)
    const ring = await row.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))
    expect(ring, 'the row draws a ring').toBeGreaterThan(0)
    const rowRight = (await rectOf(row)).right
    const right = await textRight(m)
    expect(right, `"${c.text}" ends at ${right}, row ${rowRight}, ring ${ring}px`).toBeLessThanOrEqual(rowRight - ring - 1)
    await expectNoClipping(row, { allowEllipsis: true })
  })
}

/** Left edge of the mark's own text glyphs. */
async function textLeft(l: Locator) {
  return l.evaluate((el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    return r.getBoundingClientRect().left
  })
}

for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
  test.describe(`${vp.width}px`, () => {
    test.use({ viewport: vp })
    test(`ring: adjacent right-side marks keep a visible gap, and nothing scrolls sideways (${vp.width}px)`, async ({ app, page }) => {
      await openSurface(app, page, SURFACES.tasks)
      await focusByJ(page, 'task-05')
      const row = rowOf(page, 'task-05')
      const project = mark(row, 'project')
      const due = mark(row, 'due')
      await expect(project).toHaveText('Nimble')
      await expect(due).toHaveText('Aug 3')
      const gap = (await textLeft(due)) - (await textRight(project))
      expect(gap, `"Nimble" → "Aug 3" text gap ${gap}px`).toBeGreaterThanOrEqual(6)
      // T1's horizontal-scroll fix still holds: no scroll container (page or
      // list) is wider than its box.
      const wide = await page.evaluate(() =>
        [document.scrollingElement!, ...Array.from(document.querySelectorAll<HTMLElement>('body *'))]
          .filter((el) => {
            const ox = getComputedStyle(el).overflowX
            const scrolls = el === document.scrollingElement || ox === 'auto' || ox === 'scroll'
            return scrolls && el.scrollWidth > el.clientWidth + 1
          })
          .map((el) => `${el.tagName}.${(el as HTMLElement).className} ${el.scrollWidth}>${el.clientWidth}`),
      )
      expect(wide, 'horizontal scroll').toEqual([])
    })
  })
}

// ── Sanity (must pass on the base) ───────────────────────────────────────

test('sanity: j reaches task-05 on Tasks and the row shows a focus ring', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  await focusByKeyboard(page, SURFACES.tasks, 'task-05')
})

test('sanity: Tab reaches task-04 on Today', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.today)
  await focusByKeyboard(page, SURFACES.today, 'task-04')
})

test('sanity: click-focus (mark click, Escape) lands on the row', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  await focusByClick(page, rowOf(page, 'task-05'), 'task-05')
})

test('sanity: task-10 has only a project mark; Inbox task-14 has none', async ({ app, page }) => {
  await openSurface(app, page, SURFACES.tasks)
  const bare = rowOf(page, BARE.row)
  for (const k of ['priority', 'due', 'label'] as const) await expect(mark(bare, k)).toHaveCount(0)
  await expect(mark(bare, 'project')).toHaveCount(1)
  await openSurface(app, page, SURFACES.inbox)
  for (const k of KINDS) await expect(mark(rowOf(page, SURFACES.inbox.row), k)).toHaveCount(0)
})

// ── Screenshots (before/after evidence; never fail on missing states) ───

const SHOT_DIR = process.env.SHOT_DIR
type Shot = { n: number; name: string; surface: Surface; row: string; kind?: Kind }
const SHOTS: Shot[] = [
  { n: 1, name: 'tasks-row-focused', surface: SURFACES.tasks, row: 'task-05' },
  { n: 2, name: 'tasks-p-priority', surface: SURFACES.tasks, row: 'task-05', kind: 'priority' },
  { n: 3, name: 'tasks-shiftD-due', surface: SURFACES.tasks, row: 'task-05', kind: 'due' },
  { n: 4, name: 'tasks-l-label', surface: SURFACES.tasks, row: 'task-05', kind: 'label' },
  { n: 5, name: 'tasks-m-project', surface: SURFACES.tasks, row: 'task-05', kind: 'project' },
  { n: 6, name: 'tasks-shiftD-due-no-date', surface: SURFACES.tasks, row: BARE.row, kind: 'due' },
  { n: 7, name: 'today-p-priority', surface: SURFACES.today, row: 'task-04', kind: 'priority' },
  { n: 8, name: 'inbox-m-project-no-mark', surface: SURFACES.inbox, row: 'task:task-14', kind: 'project' },
]

test.describe('screenshots', () => {
  test.skip(!SHOT_DIR, 'set SHOT_DIR to capture screenshots')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme, viewport: { width: 1440, height: 900 } })
      for (const shot of SHOTS) {
        test(`${String(shot.n).padStart(2, '0')} ${shot.name} ${theme}`, async ({ app, page }) => {
          await openSurface(app, page, shot.surface)
          let missing = false
          try {
            if (shot.surface.nav === 'j') await focusByJ(page, shot.row)
            else await focusByTab(page, shot.row)
            if (shot.kind) {
              await pressRowKey(page, shot.kind)
              await picker(page, shot.kind).first().waitFor({ state: 'visible', timeout: 2000 })
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
