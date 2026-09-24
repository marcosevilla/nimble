// L3-B — Task detail consolidation + Normal priority icon (Agentation pass 3, lane B).
// Acceptance: docs/superpowers/plans/2026-09-24-agentation-3.md → "B — Task detail
// consolidation + Normal priority icon", items 1–4. Standing checks:
// docs/superpowers/plans/2026-09-24-loop2-chunk3.md → "Standing checks".
//
// Contract for the builder (everything below that main 0df6197 lacks):
//
//   B1 Reminder chip
//   • No `section[aria-label="Task reminder"]` (and no "Save reminder" button)
//     on the detail page at rest.
//   • The chip row is the parent element of the "Add field" button (the
//     MetadataChips flex-wrap row). One of its buttons has an accessible name
//     that STARTS with "Remind" (e.g. "Reminder" when none, "Remind 15 min
//     before" when set; a trailing "Clear reminder" ✕ is fine, its name starts
//     with "Clear"). Its chip (the chip row's direct child holding it) has the
//     same height as the priority chip (±1px) and the same vertical centre
//     (±2px) — i.e. same row, same anatomy.
//   • Chip text: no reminder → contains "Reminder"; offset 15 → contains
//     "15 min"; after saving 30 → contains "30 min"; after clearing → back to
//     "Reminder" (no minutes).
//   • Clicking the chip opens a popup (role=dialog|menu|listbox) holding what
//     the old row offered (enumerated on main from ReminderPicker.tsx):
//       - a number field (role=spinbutton, 0–40320, blank = off),
//       - a button named /save/i ("Save reminder"),
//       - the checkbox "Phone alert through Google Calendar" (enabled only
//         when Google is connected or already on, and minutes not blank),
//       - the helper copy "0 means at the task time" and "Leave minutes blank
//         to turn this reminder off",
//       - validation: 50000 + Save shows role=alert "Choose a whole number
//         from 0 to 40320 minutes." and sends nothing,
//       - untimed task (task-05: date, no time): the popup says "Set a due
//         date and time to add a reminder." (same rule as today).
//   • Saves go through the same invoke as today: `update_local_task` with
//     { id, reminderOffsetMinutes: N, clearReminder: false,
//       googleCalendarEnabled: <phone> } to set, { id, clearReminder: true }
//     to clear (blank + Save). The spec's init script persists those fields
//     in the mock (tools/mock-tauri.js ignores them) so the chip can re-read.
//   • Keyboard: the chip is a tab stop with a focus ring; Enter opens it.
//     "Tab stop" is measured in WebKit, which (like the real WKWebView)
//     skips a plain <button> without an explicit tabIndex={0} — the test
//     focuses the chip, presses Shift+Tab then Tab and expects it focused.
//
//   B2 Task actions menu
//   • No role=group "Focus" (and no header "Add to focus queue"/"Focus now"
//     buttons) outside a menu on the detail page.
//   • The trigger is still named exactly "Task actions"; it renders the
//     lucide Ellipsis/MoreHorizontal svg (`svg.lucide-ellipsis` or
//     `svg.lucide-more-horizontal`) and no `svg.lucide-settings`.
//   • The open menu lists menuitems "Add to focus queue" and "Focus now"
//     (when queued: an "In focus queue" status and "Remove from focus
//     queue") plus the existing "Move to project…", "Duplicate task",
//     "Copy ID", "View activity…", "Break down with AI", "Delete task".
//   • In the harness Focus is read-only: the focus items stay present but
//     disabled (aria-disabled / data-disabled), with the reason "Focus is
//     read-only in the browser harness." visible in the item or its title —
//     exactly as FocusTaskMenuItems renders it for rows.
//   • Same effect as the old header (measured on main with a writable focus
//     mock): Add → focus_execute {kind:'enqueue', task_ids:['task-04'],
//     source:{kind:'project',project_id:'proj-taskapp'}}; Remove (queued) →
//     {kind:'remove', occurrence_id}; Focus now (not queued) → 'enqueue'
//     then 'start'. ⇧F still toggles the right rail's Focus queue tab.
//
//   B3 Back control
//   • Tested on a top-level task (task-04 → one segment, "Nimble"); the text
//     may read "Nimble" or "Back to Nimble" (its own text node either way).
//   • The ChevronLeft (`svg.lucide-chevron-left`) and the breadcrumb text
//     are inside ONE element with role button or link
//     (the chevron's nearest interactive ancestor === the text's), with no
//     tabbable descendants (one tab stop). Clicking the chevron's centre or
//     the text's centre closes the detail and lands on the Nimble project
//     page (same as main's text button does).
//   • Text font-size 13px (`text-body`, one step up from main's 12px
//     `text-meta`) and not a heading; chevron 13–18px tall (sized to match).
//   • Hit area ≥28px tall: points 13.5px above and below the control's
//     centre (on the chevron's x and the text's x) hit the control.
//   • Keyboard focus (Shift+Tab, Tab back — WebKit needs tabIndex={0} on a
//     native button) shows a focus ring, and Enter goes back.
//
//   B4 Normal priority icon
//   • Normal rows (task-10 "Book dentist appointment", priority 1) get the
//     T1 mark: role=button named /priority: normal/i (never the row), with
//     the 3-bar glyph — exactly three thin bars (leaf boxes ≤4px wide,
//     3–16px tall) whose colours are all equal, equal to a Medium row's
//     unfilled bar colour (task-06) and different from Urgent's filled bars
//     (task-05). Title x and mark centre x equal the Urgent row's; row stays
//     36px. Clicking the mark opens the priority picker; `p` on the focused
//     row opens it anchored to (overlapping) the mark.
//   • The priority picker's four items (Normal/Medium/High/Urgent) each hold
//     a 3-bar glyph.
//   • The detail page's priority chip for a Normal task (task-10) holds the
//     same empty 3-bar glyph (all bars one muted colour).
//
//   Standing: no clipping on the detail header row and the chip row (light +
//   dark, allowEllipsis only for the breadcrumb/title); focus ring on the
//   reminder chip, the Task actions trigger and the back control; axe on the
//   detail page against baseline keys `task-detail` / `task-detail:dark`
//   (recorded on main 0df6197 for this spec) and on Tasks (`tasks`,
//   `tasks:dark`) with the Normal marks.
//
//   T1/T2 tests the builder must update ("Marco 2026-09-24: Normal gets an
//   empty icon"):
//   • t2-row-keys.spec.ts `AC2 tasks: with no priority mark the p picker
//     anchors to the row's right end` — task-10 now HAS a priority mark;
//     drop 'priority' from that loop (or retarget it to the mark-anchored
//     expectation).
//   • t2-row-keys.spec.ts `sanity: task-10 has only a project mark; Inbox
//     task-14 has none` — both rows now carry a priority mark.
//   • t2-row-keys.spec.ts `AC3 tasks: Escape from a right-end-anchored
//     picker (no mark) returns focus to the row` — still passes, but its
//     priority leg is no longer "no mark"; fix the comment/name. Same for the
//     BARE / inbox comments ("Normal priority, no due, no labels…") and the
//     contract header ("missing (Normal priority, …)").
//   • t1-row-marks.spec.ts has no Normal-has-no-mark assertion, but its
//     header lists priority names without "Priority: normal" and
//     `lastRowWithMark(page,'priority')` (AC5) will now pick the last row
//     overall — re-run AC5 and update the contract comment.
//   • tests/rowMarks.test.mjs: `rowMarkName` already yields "Priority:
//     normal"; nothing to change unless the builder changes the name.
//   • TaskItem.tsx comment "Normal has no bars, so no mark" / RowMarks.tsx
//     PriorityMark doc comment go stale.
//
// Every test pins the clock to the mock world's "today" (Sat Aug 1 2026).
import fs from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

const MOCK_NOW = new Date('2026-08-01T10:00:00')

const TIMED = { id: 'task-04', title: /Fix capture strip focus bug/ } // due today 14:00, High, Nimble / In progress
const UNTIMED = { id: 'task-05', title: /Ship v1\.5/ } // due Aug 3, no time, Urgent
const NORMAL = { id: 'task-10', title: /Book dentist appointment/, text: 'Book dentist appointment' } // Normal, Life Admin
const URGENT_ROW = { id: 'task-05', text: 'Ship v1.5: quick-capture polish' }
const MEDIUM_ROW = { id: 'task-06' }

const READ_ONLY_REASON = 'Focus is read-only in the browser harness.'
const OLD_MENU_ITEMS = ['Move to project…', 'Duplicate task', 'Copy ID', 'View activity…', 'Break down with AI', 'Delete task']

test.beforeEach(async ({ app: _app, page }) => {
  await page.clock.setFixedTime(MOCK_NOW)
})

// ── mock extensions (init scripts, installed after tools/mock-tauri.js) ──

interface MockOpts {
  /** Seed reminder offsets (minutes) per task id. */
  reminders?: Record<string, number>
  /** Google Calendar reports connected (enables the phone checkbox). */
  googleConnected?: boolean
  /** A writable, stateful focus engine; `queued` task ids start in the queue;
   * `liveTiming: false` blocks Focus now (queueing stays writable). */
  focus?: { queued?: string[]; liveTiming?: boolean }
}

/**
 * Records every invoke in `window.__invokes`, persists the reminder fields
 * `update_local_task` receives (the shared mock drops them) and overlays
 * them on every task the mock returns, and optionally swaps in a writable
 * focus engine that records `focus_execute` actions in `window.__focusCalls`.
 */
async function installMocks(page: Page, opts: MockOpts = {}) {
  await page.addInitScript((o: MockOpts) => {
    const w = window as any
    w.__invokes = []
    w.__focusCalls = []
    const rem: Record<string, { reminder_offset_minutes: number | null; google_calendar_enabled: boolean }> = {}
    for (const [id, m] of Object.entries(o.reminders ?? {})) rem[id] = { reminder_offset_minutes: m, google_calendar_enabled: false }
    const overlay = (v: any): any => {
      if (Array.isArray(v)) return v.map(overlay)
      if (v && typeof v === 'object' && typeof v.id === 'string' && 'priority' in v && 'content' in v) {
        const r = rem[v.id]
        return r ? { ...v, ...r } : { reminder_offset_minutes: null, google_calendar_enabled: false, ...v }
      }
      return v
    }
    let queue: any[] = []
    let sel: string | null = null
    let rev = 0
    const entry = (id: string, source: any) => ({
      id: 'e-' + id, task_id: id, occurrence_id: 'occ-' + id, added_at: new Date().toISOString(), source, explicit_still_open: false,
      config: { mode: 'count_up', budget_ms: null, work_ms: 1500000, break_ms: 300000, rounds: 1 },
    })
    if (o.focus) for (const id of o.focus.queued ?? []) queue.push(entry(id, { kind: 'local' }))
    const snap = () => ({
      queue_revision: rev, engine_revision: rev, owner_epoch: 'mock', process_generation: 1, writer_device_id: 'mock', queue: queue.slice(),
      selected_occurrence_id: sel, session: null, totals: {}, as_of: new Date().toISOString(), checkpoint_at: null, recovery_reason: null, replica: false,
    })
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any, io: any) => {
      w.__invokes.push({ cmd, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) })
      if (cmd === 'update_local_task' && args?.id) {
        if (args.clearReminder) rem[args.id] = { reminder_offset_minutes: null, google_calendar_enabled: false }
        else if (args.reminderOffsetMinutes !== undefined && args.reminderOffsetMinutes !== null)
          rem[args.id] = { reminder_offset_minutes: args.reminderOffsetMinutes, google_calendar_enabled: !!args.googleCalendarEnabled }
      }
      if (o.googleConnected && cmd === 'google_calendar_status')
        return Promise.resolve({ connected: true, clientSecretConfigured: true, calendarLabel: 'Nimble', timezone: 'America/Los_Angeles', errorCode: null })
      if (o.focus) {
        if (cmd === 'focus_capabilities')
          return Promise.resolve({ queue_read: true, queue_write: true, history_read: true, live_timing: o.focus.liveTiming ?? true, companion: false, import: false, reason: null })
        if (cmd === 'focus_snapshot') return Promise.resolve(snap())
        if (cmd === 'focus_execute') {
          const a = args.command.action
          w.__focusCalls.push(a)
          if (a.kind === 'enqueue') for (const id of a.task_ids) queue.push(entry(id, a.source))
          if (a.kind === 'remove') queue = queue.filter((e) => e.occurrence_id !== a.occurrence_id)
          if (a.kind === 'start') sel = a.occurrence_id
          rev++
          return Promise.resolve({ snapshot: snap(), replayed: false, committed_revision: rev })
        }
      }
      return Promise.resolve(orig(cmd, args, io)).then(overlay)
    }
  }, opts)
}

async function invokes(page: Page, cmd: string) {
  return page.evaluate((c) => (window as any).__invokes.filter((i: any) => i.cmd === c).map((i: any) => i.args), cmd)
}

async function focusCalls(page: Page) {
  return page.evaluate(() => (window as any).__focusCalls as any[])
}

// ── page helpers ─────────────────────────────────────────────────────────

const mainOf = (page: Page) => page.locator('main').first()
const popups = (page: Page) => page.locator('[role=dialog], [role=menu], [role=listbox]').filter({ visible: true })
const rowOf = (page: Page, id: string) => page.locator(`[data-nav-row="${id}"]`)

async function openDetail(app: App, page: Page, t: { id: string; title: RegExp }, opts?: MockOpts) {
  await installMocks(page, opts)
  await app.open('tasks')
  await page.evaluate((id) => (window as any).__stores.useDetailStore.getState().openTask(id, 'body'), t.id)
  await expect(mainOf(page).getByRole('heading', { name: t.title })).toBeVisible()
  await expect(addField(page)).toBeVisible()
}

async function detailTarget(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__stores
    const cp = s.useAppStore.getState().currentPage
    return s.useDetailStore.getState().pageDetails?.[cp]?.target?.id ?? null
  })
}

const addField = (page: Page) => mainOf(page).getByRole('button', { name: 'Add field', exact: true })
/** The metadata chip row: the "Add field" button's parent. */
const chipRow = (page: Page) => addField(page).locator('xpath=..')
const reminderChip = (page: Page) => chipRow(page).getByRole('button', { name: /^\s*remind/i }).first()
const actionsTrigger = (page: Page) => mainOf(page).getByRole('button', { name: 'Task actions', exact: true })

/** Box of the chip row's direct child that contains `inner`. */
async function chipBox(inner: Locator) {
  return inner.evaluate((el) => {
    const row = (el.closest('main')!.querySelector('button[aria-label="Add field"]') as HTMLElement).parentElement!
    let c: HTMLElement | null = el as HTMLElement
    while (c && c.parentElement !== row) c = c.parentElement
    const r = (c ?? (el as HTMLElement)).getBoundingClientRect()
    return { top: r.top, height: r.height, cy: r.top + r.height / 2, direct: !!c }
  })
}

/** The priority chip: the chip row's child whose text is Priority/Normal/Medium/High/Urgent. */
function priorityChip(page: Page) {
  return chipRow(page).locator(':scope > *').filter({ hasText: /^\s*(priority|normal|medium|high|urgent)\s*$/i }).first()
}

/** Thin bar boxes (≤4px wide, 3–16px tall leaf elements) and their colours. */
async function bars(scope: Locator) {
  return scope.evaluate((root) => {
    const out: { w: number; h: number; x: number; color: string }[] = []
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.children.length) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.width > 4 || r.height < 3 || r.height > 16) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const bg = cs.backgroundColor
      const transparent = !bg || bg === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)
      const color = !transparent ? bg : el instanceof SVGElement ? cs.fill : cs.color
      out.push({ w: r.width, h: r.height, x: r.left, color })
    }
    return out.sort((a, b) => a.x - b.x)
  })
}

/** Priority mark control on a row (T1 contract), never the row itself. */
function priorityMark(row: Locator, value = '') {
  const name = new RegExp(`\\bpriority\\b\\W*${value}`, 'i')
  return row.getByRole('button', { name }).and(row.page().locator(':not([data-nav-row])')).first()
}

async function rect(l: Locator) {
  return l.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  })
}

async function titleRect(row: Locator) {
  return row.evaluate((el) => {
    const t = document.getElementById(el.getAttribute('aria-labelledby') ?? '') ?? el.querySelector('span.truncate')
    const r = t!.getBoundingClientRect()
    return { left: r.left, top: r.top }
  })
}

/** Reach a Tasks row with j presses from no focus. */
async function focusByJ(page: Page, id: string) {
  const ids = await page.locator('[data-nav-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-row')!))
  const at = ids.indexOf(id)
  expect(at, `${id} is a row`).toBeGreaterThanOrEqual(0)
  for (let i = 0; i <= at; i++) await page.keyboard.press('j')
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-nav-row') ?? null)).toBe(id)
}

/** Keyboard-originated focus on `l`: focus it, step back, Tab forward. */
async function keyboardFocus(page: Page, l: Locator) {
  await l.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(l).toBeFocused()
}

async function openActionsMenu(page: Page) {
  await actionsTrigger(page).click()
  const menu = page.getByRole('menu').filter({ visible: true }).first()
  await expect(menu).toBeVisible()
  return menu
}

/** Escape only while a popup is open (a bare Escape may close the detail). */
async function closePopupIfOpen(page: Page) {
  if ((await popups(page).count()) > 0) {
    await page.keyboard.press('Escape')
    await expect(popups(page)).toHaveCount(0)
  }
}

async function openReminder(page: Page) {
  const chip = reminderChip(page)
  await expect(chip, 'reminder chip in the chip row').toBeVisible()
  await chip.click()
  await expect(popups(page).first(), 'reminder picker').toBeVisible()
  return popups(page).first()
}

/** Tag the header row (common ancestor of the back chevron and the Task actions trigger). */
async function headerRow(page: Page) {
  await actionsTrigger(page).evaluate((trigger) => {
    const chevron = trigger.closest('main')!.querySelector('svg.lucide-chevron-left')
    let a: HTMLElement | null = trigger.parentElement
    while (a && chevron && !a.contains(chevron)) a = a.parentElement
    a?.setAttribute('data-qa-header', '')
  })
  return page.locator('[data-qa-header]')
}

// ── B1 — reminder as a chip ──────────────────────────────────────────────

test('B1 the detail page has no separate reminder row/section', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  await expect(mainOf(page).locator('section[aria-label="Task reminder"]')).toHaveCount(0)
  await expect(mainOf(page).getByRole('region', { name: 'Task reminder' })).toHaveCount(0)
  await expect(mainOf(page).getByRole('button', { name: /save reminder/i }), 'no inline Save reminder at rest').toHaveCount(0)
})

test('B1 a Reminder chip sits in the metadata chip row with the same height and line as the priority chip', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const chip = reminderChip(page)
  await expect(chip, 'button named "Reminder…" in the chip row').toBeVisible()
  await expect(chip).toContainText(/reminder/i)
  const r = await chipBox(chip)
  const p = await chipBox(priorityChip(page))
  expect(r.direct && p.direct, 'both are chip-row children').toBe(true)
  expect(Math.abs(r.height - p.height), `reminder chip ${r.height}px vs priority chip ${p.height}px`).toBeLessThanOrEqual(1)
  expect(Math.abs(r.cy - p.cy), 'same line as the priority chip').toBeLessThanOrEqual(2)
})

test('B1 the chip shows the current reminder', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 } })
  await expect(reminderChip(page)).toContainText(/15\s*min/i)
})

test('B1 clicking the chip opens the reminder picker with everything the old row offered', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const pop = await openReminder(page)
  await expect(pop.getByRole('spinbutton'), 'minutes field').toBeVisible()
  await expect(pop.getByRole('button', { name: /save/i })).toBeVisible()
  await expect(pop.getByRole('checkbox', { name: /phone alert through google calendar/i })).toBeVisible()
  await expect(pop).toContainText(/0 means at the task time/i)
  await expect(pop).toContainText(/leave minutes blank to turn this reminder off/i)
})

test('B1 setting a reminder from the chip saves through update_local_task and updates the chip', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const pop = await openReminder(page)
  await pop.getByRole('spinbutton').fill('30')
  await pop.getByRole('button', { name: /save/i }).click()
  await expect.poll(() => invokes(page, 'update_local_task')).toContainEqual(expect.objectContaining({ id: TIMED.id, reminderOffsetMinutes: 30, clearReminder: false }))
  await closePopupIfOpen(page)
  await expect(reminderChip(page)).toContainText(/30\s*min/i)
})

test('B1 clearing the reminder (blank + save) sends clearReminder and the chip goes back to "Reminder"', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 } })
  await expect(reminderChip(page)).toContainText(/15\s*min/i)
  const pop = await openReminder(page)
  await pop.getByRole('spinbutton').fill('')
  await pop.getByRole('button', { name: /save/i }).click()
  await expect.poll(() => invokes(page, 'update_local_task')).toContainEqual(expect.objectContaining({ id: TIMED.id, clearReminder: true }))
  await closePopupIfOpen(page)
  await expect(reminderChip(page)).toContainText(/reminder/i)
  await expect(reminderChip(page)).not.toContainText(/\d+\s*min/i)
})

test('B1 the phone alert option still works from the chip (Google connected)', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 }, googleConnected: true })
  const pop = await openReminder(page)
  const phone = pop.getByRole('checkbox', { name: /phone alert through google calendar/i })
  await expect(phone).toBeEnabled()
  await phone.check()
  await pop.getByRole('button', { name: /save/i }).click()
  await expect.poll(() => invokes(page, 'update_local_task')).toContainEqual(
    expect.objectContaining({ id: TIMED.id, reminderOffsetMinutes: 15, googleCalendarEnabled: true }),
  )
})

test('B1 an out-of-range offset shows the validation message and sends nothing', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const pop = await openReminder(page)
  await pop.getByRole('spinbutton').fill('50000')
  await pop.getByRole('button', { name: /save/i }).click()
  await expect(page.getByRole('alert').filter({ hasText: /whole number from 0 to 40320/i })).toBeVisible()
  expect((await invokes(page, 'update_local_task')).filter((a: any) => 'reminderOffsetMinutes' in a || a.clearReminder)).toEqual([])
})

test('B1 a task without a due time explains the rule inside the reminder picker', async ({ app, page }) => {
  await openDetail(app, page, UNTIMED)
  await expect(reminderChip(page)).toContainText(/reminder/i)
  const pop = await openReminder(page)
  await expect(pop).toContainText('Set a due date and time to add a reminder.')
})

test('B1 the reminder chip is a tab stop with a focus ring and Enter opens its picker', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const chip = reminderChip(page)
  await expect(chip).toBeVisible()
  await keyboardFocus(page, chip)
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect(popups(page).first()).toBeVisible()
  await expect(popups(page).first().getByRole('spinbutton')).toBeVisible()
})

// ── B2 — Focus actions in the "…" task menu ─────────────────────────────

test('B2 the header has no Focus control group', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const main = mainOf(page)
  await expect(main.getByRole('group', { name: 'Focus' })).toHaveCount(0)
  await expect(main.getByRole('button', { name: /^(add to focus queue|focus now|remove from focus queue)$/i })).toHaveCount(0)
})

test('B2 the task actions trigger is named "Task actions" and shows a horizontal "…" icon, not the gear', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const trigger = actionsTrigger(page)
  await expect(trigger).toBeVisible()
  await expect(trigger.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal'), '… icon').toHaveCount(1)
  await expect(trigger.locator('svg.lucide-settings'), 'gear icon').toHaveCount(0)
})

test('B2 the task actions menu lists the focus actions plus every existing item', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const menu = await openActionsMenu(page)
  for (const name of ['Add to focus queue', 'Focus now', ...OLD_MENU_ITEMS]) {
    await expect(menu.getByRole('menuitem', { name, exact: false }).first(), `menu item "${name}"`).toBeVisible()
  }
})

test('B2 read-only focus: the menu items stay present, disabled, with the reason', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const menu = await openActionsMenu(page)
  for (const name of ['Add to focus queue', 'Focus now']) {
    const item = menu.getByRole('menuitem', { name: new RegExp(name, 'i') }).first()
    await expect(item, `menu item "${name}"`).toBeVisible()
    const state = await item.evaluate((el) => ({
      disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled'),
      reason: (el.textContent ?? '') + ' ' + (el.getAttribute('title') ?? ''),
    }))
    expect(state.disabled, `${name} disabled`).toBe(true)
    expect(state.reason, `${name} carries the reason`).toContain(READ_ONLY_REASON)
  }
})

test('B2 "Add to focus queue" in the menu enqueues the task exactly like the old header button', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { focus: {} })
  const menu = await openActionsMenu(page)
  const item = menu.getByRole('menuitem', { name: /add to focus queue/i }).first()
  await expect(item, 'menu item "Add to focus queue"').toBeVisible()
  await item.click()
  await expect.poll(() => focusCalls(page)).toEqual([
    // task-04 is due on the pinned "today", so the source is Today — the old
    // header button sends the same (checked on a frozen 3815def build).
    { kind: 'enqueue', task_ids: [TIMED.id], source: { kind: 'today' }, explicit_still_open: false },
  ])
})

test('B2 a queued task: the menu shows "In focus queue" and "Remove from focus queue" removes it', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { focus: { queued: [TIMED.id] } })
  const menu = await openActionsMenu(page)
  await expect(menu).toContainText('In focus queue')
  const item = menu.getByRole('menuitem', { name: /remove from focus queue/i }).first()
  await expect(item).toBeVisible()
  await item.click()
  await expect.poll(() => focusCalls(page)).toEqual([{ kind: 'remove', occurrence_id: `occ-${TIMED.id}` }])
})

test('B2 "Focus now" in the menu enqueues then starts, like the old header button', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { focus: {} })
  const menu = await openActionsMenu(page)
  const item = menu.getByRole('menuitem', { name: /focus now/i }).first()
  await expect(item, 'menu item "Focus now"').toBeVisible()
  await item.click()
  await expect.poll(async () => (await focusCalls(page)).map((a) => a.kind)).toEqual(['enqueue', 'start'])
  expect((await focusCalls(page))[1]).toEqual({ kind: 'start', occurrence_id: `occ-${TIMED.id}` })
})

// Moved from tests/focusTaskEntry.test.mjs's SSR "detail:" tests when the
// header Focus group (TaskFocusControlsView) was deleted: the menu section
// must keep the same order, blocked-reason and completed-task behaviour.
test('B2 blocked Focus now (no live timing) stays listed, disabled with its reason, after an enabled Add', async ({ app, page }) => {
  await openDetail(app, page, TIMED, { focus: { liveTiming: false } })
  const menu = await openActionsMenu(page)
  const add = menu.getByRole('menuitem', { name: /add to focus queue/i }).first()
  const now = menu.getByRole('menuitem', { name: /focus now/i }).first()
  await expect(add).toBeVisible()
  await expect(now).toBeVisible()
  const [a, n] = [await rect(add), await rect(now)]
  expect(a.top, 'Add to focus queue comes before Focus now').toBeLessThan(n.top)
  const state = (l: Locator) => l.evaluate((el) => ({
    disabled: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled'),
    text: (el.textContent ?? '').trim(),
  }))
  expect((await state(add)).disabled, 'Add stays enabled').toBe(false)
  const ns = await state(now)
  expect(ns.disabled, 'Focus now disabled').toBe(true)
  expect(ns.text.replace(/^Focus now/, '').trim().length, `Focus now carries its reason: "${ns.text}"`).toBeGreaterThan(0)
})

test('B2 a completed task\'s menu has no focus items (the rest stay)', async ({ app, page }) => {
  await openDetail(app, page, { id: 'task-11', title: /Reply to Fillmore photo pass email/ }, { focus: {} })
  const menu = await openActionsMenu(page)
  await expect(menu.getByRole('menuitem', { name: 'Duplicate task' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /focus queue|focus now/i })).toHaveCount(0)
  await expect(menu).not.toContainText('In focus queue')
})

test('B2 guard: the Task actions trigger stays a tab stop with a focus ring (passes on main)', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  await keyboardFocus(page, actionsTrigger(page))
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu').filter({ visible: true }).first()).toBeVisible()
})

// ── B3 — one back control ────────────────────────────────────────────────

async function backParts(page: Page) {
  const main = mainOf(page)
  const chevron = main.locator('svg.lucide-chevron-left').first()
  const text = main.getByText(/^\s*(back to )?nimble\s*$/i).first()
  await expect(chevron).toBeVisible()
  await expect(text).toBeVisible()
  return { chevron, text }
}

/** Nearest role=button/link ancestor of `l` (native or ARIA), tagged `data-qa-<tag>`. */
async function interactiveOwner(l: Locator, tag: string) {
  return l.evaluate((el, t) => {
    const owner = el.closest('button, a[href], [role=button], [role=link]')
    if (!owner) return null
    owner.setAttribute(`data-qa-${t}`, '')
    return owner.outerHTML.slice(0, 120)
  }, tag)
}

test('B3 the chevron and the text are one interactive control with a single tab stop', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const { chevron, text } = await backParts(page)
  expect(await interactiveOwner(chevron, 'chev'), 'chevron sits inside a button/link').not.toBeNull()
  expect(await interactiveOwner(text, 'text'), 'text sits inside a button/link').not.toBeNull()
  const same = await page.evaluate(() => {
    const a = document.querySelector('[data-qa-chev]')
    const b = document.querySelector('[data-qa-text]')
    return !!a && a === b
  })
  expect(same, 'chevron and text share one control').toBe(true)
  const tabbableInside = await page.locator('[data-qa-chev]').evaluate(
    (el) => el.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
  )
  expect(tabbableInside, 'no nested tab stops').toBe(0)
})

for (const part of ['chevron', 'text'] as const) {
  test(`B3 ${part === 'text' ? 'guard: ' : ''}clicking the back ${part} closes the detail and lands on the project`, async ({ app, page }) => {
    await openDetail(app, page, TIMED)
    const parts = await backParts(page)
    const b = await rect(parts[part])
    await page.mouse.click(b.left + b.width / 2, b.top + b.height / 2)
    await expect.poll(() => detailTarget(page), 'detail closes').toBeNull()
    await expect(mainOf(page).getByRole('heading', { name: 'Nimble', exact: true })).toBeVisible()
  })
}

test('B3 back text is one type step up (13px), not a heading; chevron sized to match', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const { chevron, text } = await backParts(page)
  const fontSize = await text.evaluate((el) => getComputedStyle(el).fontSize)
  expect(fontSize, 'main 0df6197 uses text-meta 12px; next token up is text-body 13px').toBe('13px')
  expect(await text.evaluate((el) => !!el.closest('h1,h2,h3,h4,h5,h6,[role=heading]')), 'not a heading').toBe(false)
  const c = await rect(chevron)
  expect(c.height, `chevron ${c.height}px`).toBeGreaterThanOrEqual(13)
  expect(c.height).toBeLessThanOrEqual(18)
})

test('B3 the back control has a hit area at least 28px tall', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const { chevron, text } = await backParts(page)
  expect(await interactiveOwner(chevron, 'chev')).not.toBeNull()
  const owner = page.locator('[data-qa-chev]')
  const o = await rect(owner)
  const cy = o.top + o.height / 2
  const xs = [(await rect(chevron)).left + 2, (await rect(text)).left + 4]
  const misses = await owner.evaluate(
    (el, [ys, xs]) => {
      const out: string[] = []
      for (const x of xs) for (const y of ys) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || !el.contains(hit)) out.push(`${Math.round(x)},${Math.round(y)}`)
      }
      return out
    },
    [[cy - 13.5, cy, cy + 13.5], xs] as [number[], number[]],
  )
  expect(misses, `points of a 28px-tall band that miss the back control (box h=${o.height})`).toEqual([])
})

test('B3 the back control shows a focus ring when reached by keyboard', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const { chevron } = await backParts(page)
  expect(await interactiveOwner(chevron, 'chev'), 'chevron inside the back control').not.toBeNull()
  await keyboardFocus(page, page.locator('[data-qa-chev]'))
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await expect.poll(() => detailTarget(page), 'Enter goes back').toBeNull()
})

// ── B4 — Normal priority gets the empty icon ────────────────────────────

async function openTasks(app: App, page: Page) {
  await installMocks(page)
  await app.open('tasks')
  await expect(rowOf(page, NORMAL.id)).toBeVisible()
}

test('B4 tasks: a Normal row has a priority mark named "Priority: normal"', async ({ app, page }) => {
  await openTasks(app, page)
  await expect(priorityMark(rowOf(page, NORMAL.id), 'normal')).toBeVisible()
})

test('B4 tasks: the Normal mark is the 3-bar glyph in the muted tone (= Medium\'s empty bars, ≠ Urgent\'s filled bars)', async ({ app, page }) => {
  await openTasks(app, page)
  const normal = priorityMark(rowOf(page, NORMAL.id), 'normal')
  await expect(normal).toBeVisible()
  const nb = await bars(normal)
  expect(nb.length, 'three bars').toBe(3)
  expect(new Set(nb.map((b) => b.color)).size, `one colour for all bars: ${nb.map((b) => b.color).join(' | ')}`).toBe(1)
  const ub = await bars(priorityMark(rowOf(page, URGENT_ROW.id), 'urgent'))
  const mb = await bars(priorityMark(rowOf(page, MEDIUM_ROW.id), 'medium'))
  expect(ub.length).toBe(3)
  expect(mb.length).toBe(3)
  expect(nb[0].color, 'differs from Urgent filled bars').not.toBe(ub[0].color)
  expect(nb[0].color, 'same muted tone as Medium\'s empty bars').toBe(mb[2].color)
})

test('B4 tasks: the Normal mark sits in the same slot — title x and mark x equal the Urgent row\'s, row 36px', async ({ app, page }) => {
  await openTasks(app, page)
  const nRow = rowOf(page, NORMAL.id)
  const uRow = rowOf(page, URGENT_ROW.id)
  const n = priorityMark(nRow, 'normal')
  const u = priorityMark(uRow, 'urgent')
  await expect(n).toBeVisible()
  const [nt, ut, nm, um, nr] = [await titleRect(nRow), await titleRect(uRow), await rect(n), await rect(u), await rect(nRow)]
  expect(nt.left, 'title x').toBeCloseTo(ut.left, 0)
  expect(nm.left + nm.width / 2, 'mark centre x').toBeCloseTo(um.left + um.width / 2, 0)
  expect(nr.height).toBe(36)
  await expectNoClipping(nRow, { allowEllipsis: true })
})

test('B4 tasks: clicking the Normal mark opens the priority picker, not the task', async ({ app, page }) => {
  await openTasks(app, page)
  const m = priorityMark(rowOf(page, NORMAL.id), 'normal')
  await expect(m).toBeVisible()
  await m.click()
  const menu = page.getByRole('menu').filter({ visible: true })
  await expect(menu.getByRole('menuitem', { name: /urgent$/i })).toBeVisible()
  expect(await detailTarget(page)).toBeNull()
})

test('B4 tasks: p on a focused Normal row opens the priority picker at its mark', async ({ app, page }) => {
  await openTasks(app, page)
  const row = rowOf(page, NORMAL.id)
  const m = priorityMark(row, 'normal')
  await expect(m, 'Normal row has a mark to anchor to').toBeVisible()
  await focusByJ(page, NORMAL.id)
  await page.keyboard.press('p')
  const menu = page.getByRole('menu').filter({ visible: true }).first()
  await expect(menu.getByRole('menuitem', { name: /urgent$/i })).toBeVisible()
  await page.waitForTimeout(250) // popup entry animation
  const [p, a] = [await rect(menu), await rect(m)]
  expect(Math.min(p.right, a.right) - Math.max(p.left, a.left), 'popup overlaps the mark horizontally').toBeGreaterThan(0)
})

test('B4 the priority picker gives every option an icon, Normal included', async ({ app, page }) => {
  await openTasks(app, page)
  await priorityMark(rowOf(page, URGENT_ROW.id), 'urgent').click()
  const menu = page.getByRole('menu').filter({ visible: true }).first()
  for (const name of ['Normal', 'Medium', 'High', 'Urgent']) {
    const item = menu.getByRole('menuitem', { name: new RegExp(`${name}$`, 'i') }).first()
    await expect(item).toBeVisible()
    expect((await bars(item)).length, `"${name}" item shows the 3-bar glyph`).toBe(3)
  }
  const nb = await bars(menu.getByRole('menuitem', { name: /normal$/i }).first())
  expect(new Set(nb.map((b) => b.color)).size, 'Normal item bars share one (muted) colour').toBe(1)
})

test('B4 detail: the priority chip of a Normal task shows the empty 3-bar icon', async ({ app, page }) => {
  await openDetail(app, page, NORMAL)
  const chip = priorityChip(page)
  await expect(chip).toBeVisible()
  const b = await bars(chip)
  expect(b.length, 'three bars in the Normal chip').toBe(3)
  expect(new Set(b.map((x) => x.color)).size, 'all bars muted, one colour').toBe(1)
})

// ── Standing checks ──────────────────────────────────────────────────────

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({ theme })

    test(`standing: nothing clips in the detail header row or the chip row (${theme})`, async ({ app, page }) => {
      await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 } })
      await expectNoClipping(await headerRow(page), { allowEllipsis: true })
      await expectNoClipping(chipRow(page))
    })

    test(`standing: nothing clips inside the reminder picker (${theme})`, async ({ app, page }) => {
      await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 } })
      await openReminder(page)
      await page.waitForTimeout(250) // popup entry animation
      await expectNoClipping(popups(page))
    })

    test(`standing: nothing clips inside the task actions menu (${theme})`, async ({ app, page }) => {
      await openDetail(app, page, TIMED)
      await openActionsMenu(page)
      await page.waitForTimeout(250)
      await expectNoClipping(popups(page))
    })

    test(`standing: no new axe violations on the task detail page (${theme})`, async ({ app, page }) => {
      await openDetail(app, page, TIMED)
      await expectNoNewAxeViolations(page, 'task-detail')
    })

    test(`standing: no new axe violations on Tasks with Normal marks (${theme})`, async ({ app, page }) => {
      await openTasks(app, page)
      await expectNoNewAxeViolations(page, 'tasks')
    })
  })
}

test('standing: no new axe violations with the reminder picker open', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  await openReminder(page)
  await expectNoNewAxeViolations(page, 'task-detail')
})

// ── Sanity (must pass on main 0df6197) ───────────────────────────────────

test('sanity: the detail page opens with its title, chip row and Task actions trigger', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  await expect(actionsTrigger(page)).toBeVisible()
  await expect(priorityChip(page)).toContainText('High')
})

test('sanity: the Task actions menu still has its existing items', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  const menu = await openActionsMenu(page)
  for (const name of OLD_MENU_ITEMS) await expect(menu.getByRole('menuitem', { name }).first()).toBeVisible()
})

test('sanity: clicking the breadcrumb text goes back to the project', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  await mainOf(page).getByRole('button', { name: /^\s*(back to )?nimble\s*$/i }).first().click()
  await expect.poll(() => detailTarget(page)).toBeNull()
  await expect(mainOf(page).getByRole('heading', { name: 'Nimble', exact: true })).toBeVisible()
})

test('sanity: the mock persists reminder fields and records invokes', async ({ app, page }) => {
  await installMocks(page, { reminders: { [TIMED.id]: 15 } })
  await app.open('tasks')
  const t = await page.evaluate(async () => {
    const w = window as any
    await w.__TAURI_INTERNALS__.invoke('update_local_task', { id: 'task-05', reminderOffsetMinutes: 45, clearReminder: false })
    const all = await w.__TAURI_INTERNALS__.invoke('get_local_tasks', { includeCompleted: true })
    return all.filter((x: any) => x.id === 'task-04' || x.id === 'task-05').map((x: any) => [x.id, x.reminder_offset_minutes])
  })
  expect(t).toEqual([['task-04', 15], ['task-05', 45]])
  expect((await invokes(page, 'update_local_task')).length).toBeGreaterThan(0)
})

test('sanity: ⇧F on the detail page opens the Focus queue tab in the right rail', async ({ app, page }) => {
  await openDetail(app, page, TIMED)
  await mainOf(page).getByRole('heading', { name: TIMED.title }).click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Shift+F')
  await expect(page.getByRole('tab', { name: /focus queue/i })).toHaveAttribute('aria-selected', 'true')
})

test('sanity: Normal and Urgent rows share the title x on main already', async ({ app, page }) => {
  await openTasks(app, page)
  const [n, u] = [await titleRect(rowOf(page, NORMAL.id)), await titleRect(rowOf(page, URGENT_ROW.id))]
  expect(n.left).toBeCloseTo(u.left, 0)
})

// ── Screenshots (before/after evidence; never fail on missing states) ───

const SHOT_DIR = process.env.SHOT_DIR

type Shot = { n: number; name: string; run: (app: App, page: Page) => Promise<boolean> }

const SHOTS: Shot[] = [
  {
    n: 1,
    name: 'detail-rest',
    run: async (app, page) => {
      await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 } })
      return true
    },
  },
  {
    // After: the chip's picker open. Before (main): the old reminder row.
    n: 2,
    name: 'reminder',
    run: async (app, page) => {
      await openDetail(app, page, TIMED, { reminders: { [TIMED.id]: 15 } })
      if (await reminderChip(page).isVisible()) {
        await reminderChip(page).click({ timeout: 2000 })
        await popups(page).first().waitFor({ state: 'visible', timeout: 2000 })
        await page.waitForTimeout(250)
        return true
      }
      const old = mainOf(page).locator('section[aria-label="Task reminder"]')
      if (await old.isVisible()) {
        await old.scrollIntoViewIfNeeded()
        return true
      }
      return false
    },
  },
  {
    n: 3,
    name: 'task-actions-menu',
    run: async (app, page) => {
      await openDetail(app, page, TIMED)
      await actionsTrigger(page).click({ timeout: 2000 })
      await page.getByRole('menu').first().waitFor({ state: 'visible', timeout: 2000 })
      await page.waitForTimeout(250)
      return true
    },
  },
  {
    n: 4,
    name: 'back-focused',
    run: async (app, page) => {
      await openDetail(app, page, TIMED)
      const { chevron, text } = await backParts(page)
      const owner = (await interactiveOwner(chevron, 'chev')) ? page.locator('[data-qa-chev]') : ((await interactiveOwner(text, 'text')) ? page.locator('[data-qa-text]') : null)
      if (!owner) return false
      await keyboardFocus(page, owner)
      return true
    },
  },
  {
    n: 5,
    name: 'tasks-normal-rows',
    run: async (app, page) => {
      await openTasks(app, page)
      await rowOf(page, NORMAL.id).scrollIntoViewIfNeeded()
      return true
    },
  },
  {
    n: 6,
    name: 'priority-picker-normal-row',
    run: async (app, page) => {
      await openTasks(app, page)
      await focusByJ(page, NORMAL.id)
      await page.keyboard.press('p')
      await page.getByRole('menu').first().waitFor({ state: 'visible', timeout: 2000 })
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
