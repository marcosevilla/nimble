// L3-C — Subtasks on the task detail page (Agentation pass 3, lane C).
// Acceptance: docs/superpowers/plans/2026-09-24-agentation-3.md → "C — Subtasks
// on the task detail page", items 1–4. Standing checks:
// docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "Standing checks".
//
// Only the SUBTASK LIST region is targeted: lane B rebuilds the header and the
// chip row in parallel, so nothing here depends on those (the one header
// control used is the parent's own status button, `Status: <label>`, which B
// does not touch; "back" is matched as /^(back to )?portfolio$/i so both main's
// breadcrumb text and B's back control work).
//
// Fixture: parent task-01 "Refresh portfolio case study…" (Portfolio, status
// In progress) with subtasks task-02, task-03 (mock data) plus two more the
// spec's init script creates through the mock's own `create_local_task`
// ("Draft outcome metrics slide", "Collect a client quote") — four subtasks,
// so a shift-click range has a middle.
//
// Contract for the builder (everything below that main 0df6197 lacks):
//
//   C1 Reorder
//   • Each subtask row (a TaskItem row, `main [data-nav-row="<id>"]`, one per
//     subtask, in position order) carries the grip button named exactly
//     "Drag to reorder" — the same dnd-kit sortable grip the main lists use
//     (SortableTaskList/SortableTaskItem: attributes + listeners on the grip).
//   • The grip is hidden at rest (opacity 0) and shows (opacity 1) while the
//     row is hovered or anything in it has focus — same as main lists.
//   • The grip is pointer-reachable at 1440×900: the element hit at its
//     centre is the grip (or inside it). Today the hover cluster hangs
//     `right-full` outside the row, and on the detail page it would sit under
//     the `overflow-x-hidden` scroll container's left edge — the builder must
//     make room (gutter/inset) so neither grip nor checkbox is clipped.
//   • Pointer-dragging subtask 2's grip above subtask 1 calls
//     `reorder_local_tasks` once with { taskIds: [all subtask ids in the new
//     order] } (only the parent's subtasks — no parent, no other tasks), the
//     rows re-render in that order, and the detail stays on the parent.
//   • Keyboard reorder exists on the main lists (dnd-kit KeyboardSensor with
//     sortableKeyboardCoordinates — verified on main's Portfolio project page:
//     grip focus → Space → ArrowDown → Space reorders), so subtasks get it too:
//     focus subtask 1's grip, Space, ArrowDown, Space → reorder with subtask 1
//     and 2 swapped.
//   • The order persists: leave via the back control to the Portfolio list,
//     click the parent row again → subtasks render in the new order (the mock
//     already persists `position` from `reorder_local_tasks`, and
//     useTaskDetail sorts by position).
//
//   C2 Multi-select + bulk actions
//   • Each subtask row has the SelectionCheckbox (button "Select"/"Deselect",
//     aria-pressed), pointer-reachable at its centre while the row is hovered.
//   • Click one checkbox, then Shift+click another → every subtask between
//     them (inclusive) is selected (`useSelectionStore.selectedIds`, the rows'
//     aria-pressed) — i.e. pass `allIds` = the subtask ids in display order.
//     (Note: main's own Tasks/project rows don't pass `allIds`, so Shift+click
//     there only toggles; the plan asks for range here.)
//   • While ≥1 subtask is selected a bulk bar is visible on the detail page:
//     it contains the text "<N> selected" (the bar = that text's parent
//     element, as in SelectionActionBar and BulkActionBar). It offers:
//       – Complete: a button named exactly "Complete", OR a "Status" menu
//         trigger whose menu has the menuitem "Complete";
//       – mark as todo: a button named /^(mark as )?to ?do$/i, OR the "Status"
//         menu's menuitem "Todo".
//     Complete sends, per selected id and for no other id, either
//     `complete_local_task {id}` or `update_task_status {id, status:'complete'}`;
//     Todo sends `update_task_status {id, status:'todo'}` (or
//     `uncomplete_local_task {id}`) per selected id only. The rows' status
//     buttons then read "Status: Complete" / "Status: Todo".
//   • Scope: the detail page opens with an empty selection even if rows were
//     selected on the list just before (select task-12 on Portfolio, click the
//     task-01 row → `selectedIds` empty, no bar, no pressed checkbox). Leaving
//     the detail (back to the list), drilling into another task (click a
//     subtask row) or switching page (Today and back) clears it — the list
//     shows no "selected" bar and `selectedIds` is empty.
//
//   C3 Parent reopen toast
//   • Reopening a parent (here: the detail page's own status button
//     `Status: Complete` → "Todo") whose completion cascaded shows exactly one
//     sonner toast (`[data-sonner-toast]`) with the text
//     "Reopen N subtasks too?" and a button named exactly "Reopen".
//   • N = subtasks still complete whose `completed_at` equals the parent's
//     `completed_at` as it was before the reopen (read it from the task before
//     calling the status change — the reopen nulls it). Subtasks completed
//     earlier (different `completed_at`) are excluded; open ones too.
//   • "Reopen" sends a reopen (`update_task_status {id, status:'todo'}` or
//     `uncomplete_local_task {id}`) for exactly those N ids; their rows then
//     read "Status: Todo" and the earlier-completed one stays complete.
//   • Ignoring the toast changes nothing: no status invoke for any subtask,
//     and after leaving and reopening the detail they're still complete.
//   • N = 0 (no subtask shares the timestamp, or no subtasks) → no toast.
//   • Two flavours are tested: (a) a cascade from an earlier session, seeded
//     through this spec's overlay (Rust-format `completed_at`
//     "YYYY-MM-DD HH:MM:SS"), which pins the completed_at rule; (b) the live
//     flow — pre-complete task-03 from its row, advance the clock a minute,
//     complete the parent from the detail header, reopen it.
//
//   MOCK GAPS the builder fills in tools/mock-tauri.js (mirror Rust
//   nimble-core/src/db/task_tx.rs set_status_tx):
//   • Completion cascade: `update_task_status` with status 'complete' and
//     `complete_local_task` on a task must also set every child with
//     `parent_id === id && !completed` to status 'complete', completed true,
//     and the SAME `completed_at` (and updated_at) as the parent.
//     Reopen (`update_task_status` non-complete, `uncomplete_local_task`)
//     touches only the task itself (completed_at → null), never children.
//   • `completed_at` must come from the current (page) clock, not the
//     constant iso(TODAY,'10:05:00') it uses today — otherwise a subtask
//     completed earlier and the cascade share a timestamp and the harness
//     can't tell them apart. Prefer Rust's format (local
//     "YYYY-MM-DD HH:MM:SS", second resolution). Playwright's
//     page.clock.setFixedTime drives `new Date()` in the page.
//   • Recurring parents keep today's behaviour (Rust reschedules and does
//     NOT cascade) — the mock doesn't model recurrence completion; leave it.
//   • `reorder_local_tasks` already persists position — no gap.
//
//   C4 Standing: grip + checkbox not clipped (hit tests above) and no text
//   clipping in the subtask list (light + dark, allowEllipsis for titles);
//   keyboard focus on the grip and on a checkbox shows a focus ring; axe on
//   the parent's detail page against baseline `task-detail` /
//   `task-detail:dark` (recorded by lane B QA on main 0df6197 for task-04),
//   at rest and with two subtasks selected (bar visible).
//
// Every test pins the clock to the mock world's "today" (Sat Aug 1 2026).
import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

const MOCK_NOW = new Date('2026-08-01T10:00:00')

const PARENT = { id: 'task-01', title: /Refresh portfolio case study/, text: 'Refresh portfolio case study' }
const LEAF = { id: 'task-10', title: /Book dentist appointment/ } // Normal, Life Admin, no subtasks
const LIST_NEIGHBOUR = 'task-12' // the other top-level Portfolio task
const SEED_TITLES = ['Draft outcome metrics slide', 'Collect a client quote']

// Rust `datetime('now','localtime')` format.
const CASCADE_AT = '2026-07-31 18:00:00'
const EARLIER_AT = '2026-07-30 12:00:00'

test.beforeEach(async ({ app: _app, page }) => {
  await page.clock.setFixedTime(MOCK_NOW)
})

// ── mock extensions (init script, installed after tools/mock-tauri.js) ──

interface MockOpts {
  /** Overlay these tasks as complete with this completed_at until a status
   * command targets them (models a cascade from an earlier session). Keys are
   * task ids, or '$0' / '$1' for the two subtasks the init script creates. */
  seedComplete?: Record<string, string>
  /** Create the two extra subtasks under task-01 (default true). */
  extraSubtasks?: boolean
}

const STATUS_CMDS = ['update_task_status', 'complete_local_task', 'uncomplete_local_task']

/**
 * Records every invoke in `window.__invokes`, creates two more subtasks under
 * task-01 through the mock's own create_local_task, and optionally overlays a
 * "completed earlier" state on some tasks (dropped for a task as soon as any
 * status command targets it, so the mock's own record takes over).
 */
async function installMocks(page: Page, opts: MockOpts = {}) {
  await page.addInitScript(
    ({ o, seedTitles, statusCmds }: { o: MockOpts; seedTitles: string[]; statusCmds: string[] }) => {
      const w = window as any
      w.__invokes = []
      w.__seeded = []
      const seeds: Record<string, string> = { ...(o.seedComplete ?? {}) }
      const cleared = new Set<string>()
      // Keys are task ids, or '$0' / '$1' for the two subtasks created below.
      const seedFor = (id: string) => {
        if (cleared.has(id)) return undefined
        const i = w.__seeded.indexOf(id)
        return seeds[id] ?? (i >= 0 ? seeds['$' + i] : undefined)
      }
      const orig = w.__TAURI_INTERNALS__.invoke
      if (o.extraSubtasks !== false) {
        for (const content of seedTitles)
          orig('create_local_task', { content, projectId: 'proj-portfolio', parentId: 'task-01' }).then((t: any) => w.__seeded.push(t.id))
      }
      const overlay = (list: any, includeCompleted: boolean) => {
        if (!Array.isArray(list)) return list
        const out = list.map((t: any) => {
          const at = t && seedFor(t.id)
          return at ? { ...t, status: 'complete', completed: true, completed_at: at } : t
        })
        return includeCompleted ? out : out.filter((t: any) => !(t && seedFor(t.id)))
      }
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any, io: any) => {
        w.__invokes.push({ cmd, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) })
        if (statusCmds.includes(cmd) && args?.id) cleared.add(args.id)
        const res = Promise.resolve(orig(cmd, args, io))
        if (cmd === 'get_local_tasks') return res.then((v: any) => overlay(v, !!args?.includeCompleted))
        return res
      }
    },
    { o: opts, seedTitles: SEED_TITLES, statusCmds: STATUS_CMDS },
  )
}

async function invokes(page: Page, cmd: string) {
  return page.evaluate((c) => (window as any).__invokes.filter((i: any) => i.cmd === c).map((i: any) => i.args), cmd)
}

/** Status changes sent so far, normalised to { id, status }. */
async function statusCalls(page: Page) {
  return page.evaluate((cmds) => {
    return (window as any).__invokes
      .filter((i: any) => cmds.includes(i.cmd) && i.args?.id)
      .map((i: any) => ({
        id: i.args.id as string,
        status: i.cmd === 'complete_local_task' ? 'complete' : i.cmd === 'uncomplete_local_task' ? 'todo' : (i.args.status as string),
      }))
  }, STATUS_CMDS)
}

const idsWhere = (calls: { id: string; status: string }[], pred: (s: string) => boolean, among?: string[]) =>
  [...new Set(calls.filter((c) => pred(c.status) && (!among || among.includes(c.id))).map((c) => c.id))].sort()

async function selectedIds(page: Page) {
  return page.evaluate(() => Array.from((window as any).__stores.useSelectionStore.getState().selectedIds as Set<string>).sort())
}

async function detailTarget(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__stores
    const cp = s.useAppStore.getState().currentPage
    return s.useDetailStore.getState().pageDetails?.[cp]?.target?.id ?? null
  })
}

// ── page helpers ─────────────────────────────────────────────────────────

const mainOf = (page: Page) => page.locator('main').first()
const popups = (page: Page) => page.locator('[role=dialog], [role=menu], [role=listbox]').filter({ visible: true })
const subRows = (page: Page) => mainOf(page).locator('[data-nav-row]')
const subRow = (page: Page, id: string) => mainOf(page).locator(`[data-nav-row="${id}"]`)
const grip = (row: Locator) => row.getByRole('button', { name: 'Drag to reorder', exact: true })
const checkbox = (row: Locator) => row.getByRole('button', { name: /^(select|deselect)$/i })
const rowStatus = (row: Locator) => row.getByRole('button', { name: /^Status:/ }).first()
const bulkCount = (page: Page) => page.getByText(/^\s*\d+ selected\s*$/).filter({ visible: true })
const bulkBar = (page: Page) => bulkCount(page).first().locator('xpath=..')
const reopenToasts = (page: Page) => page.locator('[data-sonner-toast]').filter({ hasText: /reopen \d+ subtasks? too\?/i })
const backControl = (page: Page) => mainOf(page).getByRole('button', { name: /^\s*(back to )?portfolio\s*$/i }).first()
/** The parent's own status button (first in the page, next to the title). */
const parentStatus = (page: Page) => mainOf(page).getByRole('button', { name: /^Status:/ }).first()

async function subIds(page: Page) {
  return subRows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-row')!))
}

/** Open the parent's detail from the Tasks page (the same hatch lane B uses). */
async function openParent(app: App, page: Page, opts?: MockOpts, t: { id: string; title: RegExp } = PARENT) {
  await installMocks(page, opts)
  await app.open('tasks')
  await page.evaluate((id) => (window as any).__stores.useDetailStore.getState().openTask(id, 'body'), t.id)
  await expect(mainOf(page).getByRole('heading', { name: t.title })).toBeVisible()
  if (t.id === PARENT.id && opts?.extraSubtasks !== false) await expect(subRows(page)).toHaveCount(4)
}

/** Portfolio project list (Tasks → nav "Portfolio"). */
async function openPortfolio(page: Page) {
  await page.getByRole('navigation').getByText('Portfolio', { exact: true }).first().click()
  await expect(mainOf(page).getByRole('heading', { name: 'Portfolio' })).toBeVisible()
}

/** Back to the list, then click the parent row again. */
async function leaveAndReturn(page: Page) {
  await backControl(page).click()
  await expect.poll(() => detailTarget(page)).toBeNull()
  await page.locator(`[data-nav-row="${PARENT.id}"]`).getByText(PARENT.text).click()
  await expect(mainOf(page).getByRole('heading', { name: PARENT.title })).toBeVisible()
}

/** True when the element hit at `l`'s centre is `l` or inside it. */
async function hittable(l: Locator) {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })
}

const opacity = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).opacity))

/** Keyboard-originated focus on `l`: focus it, step back, Tab forward. */
async function keyboardFocus(page: Page, l: Locator) {
  await l.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(l).toBeFocused()
}

async function clickCheckbox(page: Page, id: string, modifiers: ('Shift' | 'Meta')[] = []) {
  const row = subRow(page, id)
  await row.hover()
  await expect(checkbox(row), `subtask ${id} has a selection checkbox`).toHaveCount(1, { timeout: 2000 })
  expect(await hittable(checkbox(row)), `checkbox of ${id} is pointer-reachable (not clipped)`).toBe(true)
  await checkbox(row).click({ modifiers, timeout: 2000 })
}

/** After a pointer drop: the reorder is recorded, no row is still being
 * dragged, and dnd-kit's post-drop click suppression (a capture-phase
 * document listener it removes ~50ms after the drop) has lifted — probed
 * with a real click on a throwaway element rather than a blind sleep. */
async function waitForDropToSettle(page: Page) {
  await expect.poll(async () => (await invokes(page, 'reorder_local_tasks')).length).toBeGreaterThan(0)
  await expect(page.locator('main [aria-roledescription="sortable"][aria-pressed="true"]')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        let got = false
        const probe = document.createElement('div')
        probe.addEventListener('click', () => { got = true })
        document.body.appendChild(probe)
        probe.click()
        probe.remove()
        return got
      }),
    )
    .toBe(true)
}

async function dragAbove(page: Page, fromId: string, toId: string) {
  const from = subRow(page, fromId)
  await from.hover()
  const g = grip(from)
  await expect(g, `subtask ${fromId} has a drag grip`).toHaveCount(1, { timeout: 2000 })
  expect(await hittable(g), 'grip is pointer-reachable (not clipped)').toBe(true)
  const b = (await g.boundingBox())!
  const t = (await subRow(page, toId).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 8, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, t.y + 4, { steps: 8 })
  await page.mouse.up()
}

/** Run a bulk status action from the bar (button or Status menu). */
async function bulkStatus(page: Page, which: 'Complete' | 'Todo') {
  const bar = bulkBar(page)
  const direct = which === 'Complete'
    ? bar.getByRole('button', { name: 'Complete', exact: true })
    : bar.getByRole('button', { name: /^\s*(mark as )?to ?do\s*$/i })
  if ((await direct.count()) > 0) {
    await direct.first().click()
    return
  }
  const trigger = bar.getByRole('button', { name: /^\s*status\s*$/i })
  await expect(trigger, `bulk bar offers "${which}" (button or Status menu)`).toHaveCount(1, { timeout: 2000 })
  await trigger.click()
  await page.getByRole('menuitem', { name: new RegExp(`^\\s*${which}\\s*$`, 'i') }).first().click()
}

/** Set a subtask's (or the parent's) status through its own status menu. */
async function setStatusVia(page: Page, statusButton: Locator, label: 'Complete' | 'Todo') {
  await statusButton.click()
  const pop = popups(page).first()
  await expect(pop).toBeVisible()
  await pop.getByRole('button', { name: label, exact: true }).click()
}

// ── C1 — reorder ─────────────────────────────────────────────────────────

test('C1 subtask rows have a drag grip, hidden at rest, shown on hover and on focus', async ({ app, page }) => {
  await openParent(app, page)
  const [a, b] = await subIds(page)
  await expect(grip(subRow(page, a)), 'grip on every subtask row').toHaveCount(1, { timeout: 2000 })
  for (const id of await subIds(page)) await expect(grip(subRow(page, id))).toHaveCount(1)
  await mainOf(page).getByRole('heading', { name: PARENT.title }).hover()
  expect(await opacity(grip(subRow(page, a))), 'hidden at rest').toBeLessThan(0.1)
  await subRow(page, a).hover()
  await expect.poll(() => opacity(grip(subRow(page, a))), { message: 'shown on hover' }).toBeGreaterThan(0.9)
  expect(await hittable(grip(subRow(page, a))), 'hovered grip is pointer-reachable').toBe(true)
  await mainOf(page).getByRole('heading', { name: PARENT.title }).hover()
  await subRow(page, b).focus()
  await expect.poll(() => opacity(grip(subRow(page, b))), { message: 'shown on focus-within' }).toBeGreaterThan(0.9)
})

test('C1 dragging subtask 2 above subtask 1 persists the new subtask order via reorder_local_tasks', async ({ app, page }) => {
  await openParent(app, page)
  const before = await subIds(page)
  await dragAbove(page, before[1], before[0])
  const expected = [before[1], before[0], ...before.slice(2)]
  await expect.poll(() => invokes(page, 'reorder_local_tasks')).toEqual([{ taskIds: expected }])
  await expect.poll(() => subIds(page)).toEqual(expected)
  expect(await detailTarget(page), 'the drag does not open a subtask').toBe(PARENT.id)
})

test('C1 the new order survives leaving the detail and coming back', async ({ app, page }) => {
  await openParent(app, page)
  const before = await subIds(page)
  await dragAbove(page, before[2], before[0])
  const expected = [before[2], before[0], before[1], before[3]]
  await expect.poll(() => subIds(page)).toEqual(expected)
  await waitForDropToSettle(page) // Back within ~50ms of the drop was swallowed (flake, it2)
  await leaveAndReturn(page)
  await expect.poll(() => subIds(page)).toEqual(expected)
})

test('C1 keyboard reorder like the main lists: grip → Space → ArrowDown → Space', async ({ app, page }) => {
  await openParent(app, page)
  const before = await subIds(page)
  const g = grip(subRow(page, before[0]))
  await expect(g, 'subtask grip').toHaveCount(1, { timeout: 2000 })
  await keyboardFocus(page, g)
  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  await page.keyboard.press('Space')
  const expected = [before[1], before[0], ...before.slice(2)]
  await expect.poll(() => invokes(page, 'reorder_local_tasks')).toEqual([{ taskIds: expected }])
  await expect.poll(() => subIds(page)).toEqual(expected)
})

// ── C2 — multi-select + bulk actions ─────────────────────────────────────

test('C2 subtask rows have selection checkboxes; click + shift-click selects the range', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  await clickCheckbox(page, ids[0])
  expect(await selectedIds(page)).toEqual([ids[0]])
  await clickCheckbox(page, ids[2], ['Shift'])
  expect(await selectedIds(page), 'shift-click selects 1..3').toEqual([ids[0], ids[1], ids[2]].sort())
  for (const id of ids.slice(0, 3)) await expect(checkbox(subRow(page, id))).toHaveAttribute('aria-pressed', 'true')
  await expect(checkbox(subRow(page, ids[3]))).toHaveAttribute('aria-pressed', 'false')
  await expect(bulkCount(page)).toHaveText(/3 selected/)
})

test('C2 the bulk bar completes, then marks as todo, exactly the selected subtasks', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  const pick = [ids[1], ids[3]]
  await clickCheckbox(page, pick[0])
  await clickCheckbox(page, pick[1])
  await expect(bulkCount(page)).toHaveText(/2 selected/)
  await bulkStatus(page, 'Complete')
  await expect.poll(async () => idsWhere(await statusCalls(page), (s) => s === 'complete')).toEqual([...pick].sort())
  for (const id of pick) await expect(rowStatus(subRow(page, id))).toHaveAccessibleName('Status: Complete')
  for (const id of [ids[0], ids[2]]) await expect(rowStatus(subRow(page, id))).not.toHaveAccessibleName('Status: Complete')
  expect(idsWhere(await statusCalls(page), () => true), 'no other task touched').toEqual([...pick].sort())

  if ((await bulkCount(page).count()) > 0) await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([])
  await clickCheckbox(page, pick[0])
  await clickCheckbox(page, pick[1])
  await bulkStatus(page, 'Todo')
  await expect.poll(async () => idsWhere(await statusCalls(page), (s) => s === 'todo')).toEqual([...pick].sort())
  for (const id of pick) await expect(rowStatus(subRow(page, id))).toHaveAccessibleName('Status: Todo')
  expect(idsWhere(await statusCalls(page), () => true), 'still only the selected subtasks').toEqual([...pick].sort())
})

test('C2 selection from the list does not carry into the detail page', async ({ app, page }) => {
  await installMocks(page)
  await app.open('tasks')
  await openPortfolio(page)
  const neighbour = page.locator(`[data-nav-row="${LIST_NEIGHBOUR}"]`)
  await neighbour.hover()
  await checkbox(neighbour).click()
  expect(await selectedIds(page), 'sanity: the list row is selected').toEqual([LIST_NEIGHBOUR])
  await page.locator(`[data-nav-row="${PARENT.id}"]`).getByText(PARENT.text).click()
  await expect(mainOf(page).getByRole('heading', { name: PARENT.title })).toBeVisible()
  await expect.poll(() => selectedIds(page), { message: 'detail opens with an empty selection' }).toEqual([])
  await expect(bulkCount(page)).toHaveCount(0)
})

test('C2 leaving the detail page clears the subtask selection (no bar on the list)', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  await clickCheckbox(page, ids[0])
  await clickCheckbox(page, ids[1])
  await expect(bulkCount(page)).toHaveText(/2 selected/)
  await backControl(page).click()
  await expect.poll(() => detailTarget(page)).toBeNull()
  await expect.poll(() => selectedIds(page)).toEqual([])
  await expect(bulkCount(page)).toHaveCount(0)
  for (const id of ids.slice(0, 2)) expect(await page.locator(`[data-nav-row="${id}"]`).count(), 'subtasks are not list rows').toBe(0)
})

test('C2 opening another task (drilling into a subtask) clears the selection', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  await clickCheckbox(page, ids[0])
  await clickCheckbox(page, ids[2])
  await subRow(page, ids[1]).getByText(/Write process section/).click()
  await expect.poll(() => detailTarget(page)).toBe(ids[1])
  await expect.poll(() => selectedIds(page)).toEqual([])
  await expect(bulkCount(page)).toHaveCount(0)
})

test('C2 switching page and back starts with an empty selection', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  await clickCheckbox(page, ids[0])
  await page.getByRole('navigation').getByText('Today', { exact: true }).first().click()
  await expect.poll(() => page.evaluate(() => (window as any).__stores.useAppStore.getState().currentPage)).toBe('today')
  await expect.poll(() => selectedIds(page)).toEqual([])
  await expect(bulkCount(page)).toHaveCount(0)
})

// ── C3 — parent reopen toast ─────────────────────────────────────────────

/** Parent, task-02 and the first created subtask cascaded at CASCADE_AT;
 * task-03 completed earlier; the second created subtask still open. */
const CASCADE_SEEDS = { [PARENT.id]: CASCADE_AT, 'task-02': CASCADE_AT, $0: CASCADE_AT, 'task-03': EARLIER_AT }

/** Open the parent with seeded completion state; returns the created ids. */
async function openSeeded(app: App, page: Page, seeds: Record<string, string>) {
  await openParent(app, page, { seedComplete: seeds })
  const seeded: string[] = await page.evaluate(() => (window as any).__seeded)
  expect((await subIds(page)).slice(0, 2), 'sanity: mock order').toEqual(['task-02', 'task-03'])
  return seeded
}

test('C3 reopening a parent whose completion cascaded offers "Reopen N subtasks too?" (earlier-completed excluded)', async ({ app, page }) => {
  const seeded = await openSeeded(app, page, CASCADE_SEEDS)
  await expect(parentStatus(page)).toHaveAccessibleName('Status: Complete')
  await setStatusVia(page, parentStatus(page), 'Todo')
  await expect(reopenToasts(page), 'one reopen toast').toHaveCount(1)
  await expect(reopenToasts(page)).toContainText(/reopen 2 subtasks too\?/i)
  await expect(reopenToasts(page).getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
  const subCalls = idsWhere(await statusCalls(page), () => true, ['task-02', 'task-03', ...seeded])
  expect(subCalls, 'reopening the parent touches no subtask by itself').toEqual([])
})

test('C3 clicking Reopen reopens exactly the cascade-completed subtasks', async ({ app, page }) => {
  const seeded = await openSeeded(app, page, CASCADE_SEEDS)
  await expect(parentStatus(page)).toHaveAccessibleName('Status: Complete')
  await setStatusVia(page, parentStatus(page), 'Todo')
  const toast = reopenToasts(page)
  await expect(toast).toHaveCount(1)
  await toast.getByRole('button', { name: 'Reopen', exact: true }).click()
  const subs = ['task-02', 'task-03', ...seeded]
  await expect.poll(async () => idsWhere(await statusCalls(page), (s) => s !== 'complete', subs)).toEqual(['task-02', seeded[0]].sort())
  expect(idsWhere(await statusCalls(page), () => true, subs), 'task-03 (done earlier) and the open one untouched').toEqual(['task-02', seeded[0]].sort())
  await expect(rowStatus(subRow(page, 'task-02'))).toHaveAccessibleName('Status: Todo')
  await expect(rowStatus(subRow(page, seeded[0]))).toHaveAccessibleName('Status: Todo')
  await expect(rowStatus(subRow(page, 'task-03'))).toHaveAccessibleName('Status: Complete')
})

test('C3 ignoring the toast leaves the cascaded subtasks complete', async ({ app, page }) => {
  const seeded = await openSeeded(app, page, CASCADE_SEEDS)
  await setStatusVia(page, parentStatus(page), 'Todo')
  await expect(reopenToasts(page)).toHaveCount(1)
  await leaveAndReturn(page)
  await expect(parentStatus(page)).not.toHaveAccessibleName('Status: Complete')
  for (const id of ['task-02', 'task-03', seeded[0]]) await expect(rowStatus(subRow(page, id))).toHaveAccessibleName('Status: Complete')
  expect(idsWhere(await statusCalls(page), () => true, ['task-02', 'task-03', ...seeded])).toEqual([])
})

test('C3 guard: no toast when no subtask was completed by the cascade (passes on main)', async ({ app, page }) => {
  // Every completed subtask has a different completed_at than the parent.
  await openSeeded(app, page, { [PARENT.id]: CASCADE_AT, 'task-02': EARLIER_AT, 'task-03': EARLIER_AT, $0: '2026-07-31 17:59:59' })
  await setStatusVia(page, parentStatus(page), 'Todo')
  await expect.poll(async () => idsWhere(await statusCalls(page), (s) => s !== 'complete')).toEqual([PARENT.id])
  await expect(parentStatus(page)).not.toHaveAccessibleName('Status: Complete')
  await page.waitForTimeout(300)
  await expect(reopenToasts(page)).toHaveCount(0)
})

test('C3 guard: no toast when reopening a task without subtasks (passes on main)', async ({ app, page }) => {
  await openParent(app, page, { seedComplete: { [LEAF.id]: CASCADE_AT }, extraSubtasks: false }, LEAF)
  await setStatusVia(page, parentStatus(page), 'Todo')
  await expect.poll(async () => idsWhere(await statusCalls(page), (s) => s !== 'complete')).toEqual([LEAF.id])
  await page.waitForTimeout(300)
  await expect(reopenToasts(page)).toHaveCount(0)
})

test('C3 live flow: pre-complete one subtask, complete the parent (cascade), reopen → toast counts only the cascade', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  // task-03 done at 10:00, the parent a minute later.
  await setStatusVia(page, rowStatus(subRow(page, 'task-03')), 'Complete')
  await expect(rowStatus(subRow(page, 'task-03'))).toHaveAccessibleName('Status: Complete')
  await page.clock.setFixedTime(new Date(MOCK_NOW.getTime() + 60_000))
  await setStatusVia(page, parentStatus(page), 'Complete')
  await expect(parentStatus(page)).toHaveAccessibleName('Status: Complete')
  for (const id of ids)
    await expect(rowStatus(subRow(page, id)), `mock cascade: completing the parent completes ${id} (builder extends tools/mock-tauri.js like Rust)`).toHaveAccessibleName('Status: Complete')

  await page.clock.setFixedTime(new Date(MOCK_NOW.getTime() + 120_000))
  await setStatusVia(page, parentStatus(page), 'Todo')
  const toast = reopenToasts(page)
  await expect(toast).toHaveCount(1)
  await expect(toast).toContainText(/reopen 3 subtasks too\?/i)
  const before = (await statusCalls(page)).length
  await toast.getByRole('button', { name: 'Reopen', exact: true }).click()
  const cascaded = ids.filter((id) => id !== 'task-03')
  await expect.poll(async () => idsWhere((await statusCalls(page)).slice(before), () => true)).toEqual([...cascaded].sort())
  for (const id of cascaded) await expect(rowStatus(subRow(page, id))).toHaveAccessibleName('Status: Todo')
  await expect(rowStatus(subRow(page, 'task-03'))).toHaveAccessibleName('Status: Complete')
})

// ── C4 — standing checks ─────────────────────────────────────────────────

/** Tag the subtask list region (the "Subtask" label's parent). */
async function subtaskRegion(page: Page) {
  await mainOf(page).getByText('Subtask', { exact: true }).first().evaluate((el) => el.parentElement!.setAttribute('data-qa-subtasks', ''))
  return page.locator('[data-qa-subtasks]')
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ theme })

    test(`C4 standing: nothing clips in the subtask list, and the hovered grip + checkbox are not cut off (${theme})`, async ({ app, page }) => {
      await openParent(app, page)
      const region = await subtaskRegion(page)
      await expectNoClipping(region, { allowEllipsis: true })
      const row = subRow(page, (await subIds(page))[0])
      await row.hover()
      await expect(grip(row), 'grip').toHaveCount(1, { timeout: 2000 })
      await expect(checkbox(row), 'checkbox').toHaveCount(1, { timeout: 2000 })
      expect(await hittable(grip(row)), 'grip not clipped').toBe(true)
      expect(await hittable(checkbox(row)), 'checkbox not clipped').toBe(true)
    })

    test(`C4 standing: no new axe violations on the parent's detail page (${theme})`, async ({ app, page }) => {
      await openParent(app, page)
      await expectNoNewAxeViolations(page, 'task-detail')
    })

    test(`C4 standing: no new axe violations with two subtasks selected and the bulk bar up (${theme})`, async ({ app, page }) => {
      await openParent(app, page)
      const ids = await subIds(page)
      await clickCheckbox(page, ids[0])
      await clickCheckbox(page, ids[1])
      await expect(bulkCount(page)).toBeVisible()
      await page.mouse.move(5, 5)
      await expectNoNewAxeViolations(page, 'task-detail')
    })
  })
}

test('C4 standing: keyboard focus on a subtask grip shows a focus ring', async ({ app, page }) => {
  await openParent(app, page)
  const g = grip(subRow(page, (await subIds(page))[1]))
  await expect(g, 'grip').toHaveCount(1, { timeout: 2000 })
  await keyboardFocus(page, g)
  await expectFocusRing(page)
  expect(await opacity(g), 'focused grip is visible').toBeGreaterThan(0.9)
})

test('C4 standing: keyboard focus on a subtask checkbox shows a focus ring', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  await clickCheckbox(page, ids[0]) // with a selection every checkbox is a tab stop
  const cb = checkbox(subRow(page, ids[1]))
  await keyboardFocus(page, cb)
  await expectFocusRing(page)
})

// ── Sanity (must pass on main 0df6197) ───────────────────────────────────

test('sanity: the parent detail lists its four subtasks in position order', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  expect(ids.slice(0, 2)).toEqual(['task-02', 'task-03'])
  const seeded = await page.evaluate(() => (window as any).__seeded)
  expect(ids.slice(2)).toEqual(seeded)
  await expect(subRow(page, seeded[0])).toContainText(SEED_TITLES[0])
})

test('sanity: the seed overlay marks tasks complete until a status command targets them', async ({ app, page }) => {
  await installMocks(page, { seedComplete: { 'task-02': CASCADE_AT } })
  await app.open('tasks')
  const read = () =>
    page.evaluate(async () => {
      const all = await (window as any).__TAURI_INTERNALS__.invoke('get_local_tasks', { includeCompleted: true })
      const t = all.find((x: any) => x.id === 'task-02')
      return [t.status, t.completed_at]
    })
  expect(await read()).toEqual(['complete', CASCADE_AT])
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('update_task_status', { id: 'task-02', status: 'todo' }))
  expect((await read())[0]).toBe('todo')
})

test('sanity: the mock persists reorder_local_tasks positions', async ({ app, page }) => {
  await openParent(app, page)
  const ids = await subIds(page)
  const next = [ids[3], ids[2], ids[1], ids[0]]
  await page.evaluate((taskIds) => (window as any).__TAURI_INTERNALS__.invoke('reorder_local_tasks', { taskIds }), next)
  await leaveAndReturn(page)
  await expect.poll(() => subIds(page)).toEqual(next)
})

test('sanity: a subtask status change from its row works on main', async ({ app, page }) => {
  await openParent(app, page)
  await setStatusVia(page, rowStatus(subRow(page, 'task-02')), 'Complete')
  await expect(rowStatus(subRow(page, 'task-02'))).toHaveAccessibleName('Status: Complete')
  expect(idsWhere(await statusCalls(page), (s) => s === 'complete')).toEqual(['task-02'])
})

test('sanity: reopening a seeded-complete parent sends one status change for the parent only', async ({ app, page }) => {
  await openSeeded(app, page, CASCADE_SEEDS)
  await setStatusVia(page, parentStatus(page), 'Todo')
  await expect.poll(async () => idsWhere(await statusCalls(page), () => true)).toEqual([PARENT.id])
})

// ── Screenshots (before/after evidence; never fail on missing states) ───

const SHOT_DIR = process.env.SHOT_DIR

type Shot = { n: number; name: string; run: (app: App, page: Page) => Promise<boolean> }

const SHOTS: Shot[] = [
  {
    n: 1,
    name: 'parent-subtasks-rest',
    run: async (app, page) => {
      await openParent(app, page)
      await page.mouse.move(5, 5)
      return true
    },
  },
  {
    n: 2,
    name: 'subtask-hover-grip',
    run: async (app, page) => {
      await openParent(app, page)
      const row = subRow(page, (await subIds(page))[1])
      await row.hover()
      await page.waitForTimeout(250)
      return (await grip(row).count()) > 0
    },
  },
  {
    n: 3,
    name: 'two-selected-bulk-bar',
    run: async (app, page) => {
      await openParent(app, page)
      const ids = await subIds(page)
      for (const id of [ids[0], ids[2]]) {
        const row = subRow(page, id)
        await row.hover()
        if ((await checkbox(row).count()) === 0) return false
        await checkbox(row).click({ timeout: 2000 })
      }
      await page.mouse.move(5, 5)
      await bulkCount(page).first().waitFor({ state: 'visible', timeout: 2000 })
      await page.waitForTimeout(250)
      return true
    },
  },
  {
    n: 4,
    name: 'reopen-toast',
    run: async (app, page) => {
      await openSeeded(app, page, CASCADE_SEEDS)
      await setStatusVia(page, parentStatus(page), 'Todo')
      await page.mouse.move(5, 5)
      await reopenToasts(page).first().waitFor({ state: 'visible', timeout: 2000 })
      await page.waitForTimeout(250)
      return true
    },
  },
]

test.describe('screenshots', () => {
  test.skip(!SHOT_DIR, 'set SHOT_DIR to capture screenshots')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme, viewport: { width: 1440, height: 900 } })
      for (const shot of SHOTS) {
        test(`${String(shot.n).padStart(2, '0')} ${shot.name} ${theme}`, async ({ app, page }) => {
          let ok = false
          try {
            ok = await shot.run(app, page)
          } catch {
            ok = false
          }
          fs.mkdirSync(SHOT_DIR!, { recursive: true })
          const file = `${String(shot.n).padStart(2, '0')}-${shot.name}-${theme}${ok ? '' : '-missing'}.png`
          await page.screenshot({ path: path.join(SHOT_DIR!, file) })
        })
      }
    })
  }
})
