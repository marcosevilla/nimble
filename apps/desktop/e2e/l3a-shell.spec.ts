/*
 * Agentation pass 3, lane A — Shell polish (loop3/a-shell)
 * Plan: docs/superpowers/plans/2026-09-24-agentation-3.md → "A — Shell polish"
 * Pipeline + standing checks: docs/superpowers/plans/2026-09-24-loop2-chunk3.md
 *
 * ── Contract for the builder ────────────────────────────────────────────────
 * All "main" numbers were measured on main 0df6197 (frozen :4600), WebKit,
 * 1440×900, default nav width 240, light theme.
 *
 * Motion rule (every animation here): motion tokens only (no `duration-N`
 * literal, no `transition-all` in the lane A files — checked by source lint),
 * 150–250 ms, ease-out. Animated paths are sampled every frame for ~600 ms:
 * at least one frame must be *between* the start and end value, the value
 * must stop changing within 400 ms of the first change, and the end layout
 * must equal the reduced-motion end layout. With
 * `prefers-reduced-motion: reduce` no frame may be in between (instant).
 *
 * A1 Wordmark. Inside the NavSidebar header (the row holding the
 *    "Collapse sidebar" button) render an element with `data-wordmark`:
 *    - its visible text is exactly "Nimble"; the text uses the heading font
 *      (first family of `--font-heading`), weight ≥ 600, and the same
 *      font-size as the nav labels (`text-body-strong`);
 *    - it contains the mark: an element with `aria-hidden="true"` (inline
 *      svg or img), 14–22 px square;
 *    - nothing inside it is focusable (decorative; no tabindex/link/button);
 *    - it sits left of the collapse button, vertically centred on it (±3 px).
 *    Header unchanged: collapse button stays at (203, 12) 28×28, "Today"
 *    stays at y=44, h=36. At the 160 px min labelled width: no clipped or
 *    ellipsised text in the header and "Nimble" doesn't overlap the button.
 *    Icon-snapped (48 px): the mark is visible, no "Nimble" text is laid out
 *    wider than 2 px (drop it or sr-only it), the expand button still works,
 *    nothing overflows the 48 px nav.
 * A2 Condensed trees. Row pitch (top of row n+1 − top of row n, in document
 *    order, `[data-tree-row]`) ≤ 28 px everywhere in the Tasks project tree
 *    (`[role=tree][aria-label=Projects]`, main 38) and the nav Docs tree
 *    (`nav [role=group][aria-label="Docs list"]`, main 34; the section break
 *    before the Vault root row is exempt). Each treeitem's
 *    box is ≥ 24 px tall. No clipped text (deliberate ellipsis on names
 *    allowed; counts must never clip — NB on main "All tasks" count "15"
 *    already overflows its 12 px `w-3` slot, 14 > 12). Keyboard focus ring (outline +
 *    offset) on the first, a nested and the last row lies fully inside every
 *    clipping ancestor. Top-level page items stay 36 px (report whether they
 *    share the changed spacing class).
 * A3 Tree motion. Every expandable tree node renders its children inside a
 *    wrapper with `data-tree-children="<parent row's data-key>"` (e.g.
 *    `project:proj-taskapp`, `folder:folder-design`), kept mounted (or at
 *    least mounted through the exit) so height/opacity can animate open and
 *    closed. The nav-level page trees keep their existing
 *    `[role=group][aria-label="Tasks list" | "Docs list"]` container as the
 *    animated element. The wrapper's height (or its effective opacity) must
 *    pass through an in-between value. Chevrons keep a transform/rotate
 *    transition (150–250 ms). Keyboard: ←/→ on a project row and Enter on a
 *    docs folder row animate too and focus stays on that row.
 * A4 Sync toast. No top banner: `main`'s top y is identical before and after
 *    sync health turns unhealthy. The problem renders as ONE bottom-right
 *    surface with `role="status"` or `aria-live="polite"` containing the
 *    message, the action ("Sync now" when stale, "Open settings" on error)
 *    and a button named "Dismiss". It doesn't intersect the `?` button
 *    ("Keyboard shortcuts (?)") or any button/tab in the right rail at
 *    1440×900 and 1024×700; it is still there after 10 s (fake clock); every
 *    button in it is Tab-reachable with a focus ring; no clipping. Dismiss
 *    hides it for this app session: it stays hidden across in-app page
 *    changes and status re-polls of the same problem, comes back for a *new*
 *    problem (stale → error) and after a reload (= relaunch) while still
 *    unhealthy. Keep the dismissed state in memory, not in storage.
 * A5 Rail tab motion. Add an element with `data-tab-indicator` inside
 *    `[role=tablist][aria-label="Sidebar views"]` whose box lines up with the
 *    active tab (x and width ±2 px) and slides between tabs (some frame's x
 *    strictly between the old and new tab). The newly active panel
 *    (the tab's `aria-controls`) fades in (effective opacity passes through
 *    0.05–0.95). The tablist's x/y/height and the rail's collapse button
 *    never move — NB on main the collapse button already shifts ~4 px right
 *    when a wider tab (Habits with its count) is active, because the header
 *    row overflows; fix that too. ←/→ still move focus between tabs (focus ring visible);
 *    Enter activates.
 * Standing: no new axe violations (baseline e2e/axe-baseline.json) on today,
 *    tasks and docs with the toast showing and the trees open.
 *
 * Sync health is stubbed by wrapping the mock's invoke: `__syncMode` =
 * 'stale' | 'ok' | 'error' shapes `get_todoist_sync_status`; a window
 * `focus` event makes SyncHealthBanner re-poll (keep that refresh path).
 *
 * Run (frozen build only):
 *   BASE_URL=http://localhost:4600 npx playwright test -c e2e e2e/l3a-shell.spec.ts
 * Screenshots: add SHOT_DIR=<dir> and -g screenshots.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { test, expect, expectNoClipping, expectFocusRing, expectNoNewAxeViolations, type App } from './fixtures'

const here = path.dirname(fileURLToPath(import.meta.url))

// ── Measured on main 0df6197 (frozen :4600), WebKit 1440×900, nav 240 ───────
const MAIN = {
  collapseBtn: { x: 203, y: 12, width: 28, height: 28 },
  today: { y: 44, height: 36 },
  tasksTreePitch: 38,
  docsTreePitch: 34, // 32 folder→first child, 34 elsewhere; the Vault section break (42) is exempt
}
/** Section breaks allowed to exceed the pitch: the gap before the Vault root. */
const SECTION_BREAKS = new Set(['vault'])
const TARGET_PITCH = 28

const STALE_MSG = "Todoist hasn't synced in over an hour."
const ERROR_MSG = /Todoist sync paused/

type SyncMode = 'stale' | 'ok' | 'error'
type Box = { x: number; y: number; width: number; height: number }

// ── helpers ─────────────────────────────────────────────────────────────────

const navEl = (page: Page) => page.locator('nav').first()
const navBtn = (page: Page, name: string) => navEl(page).getByRole('button', { name, exact: true })
const tasksTree = (page: Page) => page.locator('[role="tree"][aria-label="Projects"]')
const docsTree = (page: Page) => navEl(page).locator('[role="group"][aria-label="Docs list"]')
const wordmark = (page: Page) => navEl(page).locator('[data-wordmark]')
const helpBtn = (page: Page) => page.getByRole('button', { name: 'Keyboard shortcuts (?)' })
const tablist = (page: Page) => page.locator('[role="tablist"][aria-label="Sidebar views"]')
const railTab = (page: Page, name: RegExp) => tablist(page).getByRole('tab', { name })
const railCollapse = (page: Page) => page.locator('aside').getByRole('button', { name: 'Collapse sidebar' })

/** Wraps the mock's invoke so `window.__syncMode` shapes Todoist sync status. */
async function stubSync(page: Page, mode: SyncMode = 'stale') {
  await page.addInitScript((m) => {
    type Inv = (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Inv }; __syncMode: string }
    w.__syncMode = m
    const orig = w.__TAURI_INTERNALS__.invoke
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
      if (cmd !== 'get_todoist_sync_status') return orig(cmd, args, opts)
      return Promise.resolve(orig(cmd, args, opts)).then((s) => {
        const base = s as Record<string, unknown>
        if (w.__syncMode === 'ok') return { ...base, enabled: true, last_sync_at: local(new Date()), last_error: null }
        if (w.__syncMode === 'error') return { ...base, enabled: true, last_error: 'HTTP 401 Unauthorized' }
        return { ...base, enabled: true, last_sync_at: '2026-01-01 08:00:00', last_error: null }
      })
    }
  }, mode)
}

/** Switch the stubbed sync health and make the shell re-poll it. */
async function setSync(page: Page, mode: SyncMode) {
  await page.evaluate((m) => {
    ;(window as unknown as { __syncMode: string }).__syncMode = m
    window.dispatchEvent(new Event('focus'))
  }, mode)
}

/** The innermost live region / status holding `text`. */
function syncSurface(page: Page, text: string | RegExp = STALE_MSG) {
  return page.locator('[role="status"], [aria-live="polite"]').filter({ hasText: text }).last()
}

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox()
  expect(b, 'element has a box').not.toBeNull()
  return b!
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Drag the nav's resize handle (`.cursor-col-resize`) so its right edge lands near `x`. */
async function dragNavTo(page: Page, x: number) {
  const h = await box(navEl(page).locator('.cursor-col-resize').first())
  const y = h.y + h.height / 2
  await page.mouse.move(h.x + h.width / 2, y)
  await page.mouse.down()
  // The drag listeners attach in an effect after mousedown re-renders.
  await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe('col-resize')
  await page.mouse.move(x + 40, y, { steps: 5 })
  await page.mouse.move(x, y, { steps: 5 })
  await page.mouse.up()
}

/** Tops of every `[data-tree-row]` under `scope`, in document order. */
async function rowTops(scope: Locator) {
  return scope.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-tree-row]'))
      .filter((r) => r.getClientRects().length > 0)
      .map((r) => ({ key: r.dataset.key ?? r.textContent ?? '', y: r.getBoundingClientRect().top, h: r.getBoundingClientRect().height })),
  )
}

/**
 * The keyboard-focused element's ring box (outline + offset, or box-shadow
 * spread) must lie inside every ancestor that clips (overflow ≠ visible).
 */
async function ringClippedBy(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    let ext = 0
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      ext = parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset) || 0)
    } else if (cs.boxShadow && cs.boxShadow !== 'none') {
      for (const part of cs.boxShadow.split(/,(?![^(]*\))/)) {
        const px = (part.match(/-?[\d.]+px/g) ?? []).map(parseFloat)
        ext = Math.max(ext, Math.abs(px[0] ?? 0) + (px[2] ?? 0) + (px[3] ?? 0))
      }
    }
    const r = el.getBoundingClientRect()
    const ring = { l: r.left - ext, t: r.top - ext, r: r.right + ext, b: r.bottom + ext }
    const out: string[] = []
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a)
      const clipX = acs.overflowX !== 'visible'
      const clipY = acs.overflowY !== 'visible'
      if (!clipX && !clipY) continue
      const ab = a.getBoundingClientRect()
      const inner = {
        l: ab.left + a.clientLeft,
        t: ab.top + a.clientTop,
        r: ab.left + a.clientLeft + a.clientWidth,
        b: ab.top + a.clientTop + a.clientHeight,
      }
      const bad =
        (clipX && (ring.l < inner.l - 0.5 || ring.r > inner.r + 0.5)) ||
        (clipY && (ring.t < inner.t - 0.5 || ring.b > inner.b + 0.5))
      if (bad) {
        out.push(
          `${el.getAttribute('data-key') ?? el.textContent?.trim().slice(0, 20)} ring ${JSON.stringify(ring)} ext=${ext} clipped by ${a.tagName.toLowerCase()}.${String(a.className).split(/\s+/).slice(0, 4).join('.')} ${JSON.stringify(inner)}`,
        )
      }
    }
    return { ext, out }
  })
}

type Sample = { t: number; h: number; o: number }

/**
 * Samples `selector`'s height and effective opacity on every animation frame
 * for `ms`, while `act` runs. Missing / display:none counts as h=0, o=0.
 */
async function sampleWhile(page: Page, selector: string, act: () => Promise<unknown>, ms = 600): Promise<Sample[]> {
  const done = page.evaluate(
    ({ selector, ms }) =>
      new Promise<Sample[]>((resolve) => {
        const w = window as unknown as { __sampling?: boolean }
        const out: Sample[] = []
        const effOpacity = (el: Element | null) => {
          let o = 1
          for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
            const cs = getComputedStyle(e)
            if (cs.display === 'none' || cs.visibility === 'hidden') return 0
            o *= parseFloat(cs.opacity)
          }
          return o
        }
        const t0 = performance.now()
        const tick = () => {
          const el = document.querySelector(selector)
          const rect = el?.getBoundingClientRect()
          out.push({ t: performance.now() - t0, h: el && el.getClientRects().length ? rect!.height : 0, o: el ? effOpacity(el) : 0 })
          if (performance.now() - t0 < ms) requestAnimationFrame(tick)
          else resolve(out)
        }
        w.__sampling = true
        requestAnimationFrame(tick)
      }),
    { selector, ms },
  )
  await page.waitForFunction(() => (window as unknown as { __sampling?: boolean }).__sampling === true)
  await act()
  const samples = await done
  await page.evaluate(() => { (window as unknown as { __sampling?: boolean }).__sampling = false })
  return samples
}

function describeSamples(s: Sample[]) {
  return s.map((x) => `${Math.round(x.t)}ms h=${x.h.toFixed(1)} o=${x.o.toFixed(2)}`).join(' | ')
}

/** Frames strictly between the first and last sample (height or opacity). */
function inBetween(s: Sample[]) {
  const a = s[0]
  const z = s[s.length - 1]
  return s.filter(
    (x) =>
      (Math.abs(x.h - a.h) > 2 && Math.abs(x.h - z.h) > 2) ||
      (Math.abs(x.o - a.o) > 0.05 && Math.abs(x.o - z.o) > 0.05),
  )
}

function expectToggled(s: Sample[], what: string) {
  const a = s[0]
  const z = s[s.length - 1]
  expect(Math.abs(a.h - z.h) > 2 || Math.abs(a.o - z.o) > 0.05, `${what}: the toggle changed nothing — ${describeSamples(s)}`).toBe(true)
}

function expectAnimated(s: Sample[], what: string) {
  expectToggled(s, what)
  expect(inBetween(s).length, `${what}: no in-between frame (instant jump) — ${describeSamples(s)}`).toBeGreaterThan(0)
  // Settles within 400 ms of the first change.
  const first = s.findIndex((x) => Math.abs(x.h - s[0].h) > 0.5 || Math.abs(x.o - s[0].o) > 0.01)
  const z = s[s.length - 1]
  const settled = s.findIndex((x, i) => i >= first && s.slice(i).every((y) => Math.abs(y.h - z.h) <= 0.5 && Math.abs(y.o - z.o) <= 0.01))
  expect(s[settled].t - s[first].t, `${what}: took too long to settle — ${describeSamples(s)}`).toBeLessThanOrEqual(400)
}

function expectInstant(s: Sample[], what: string) {
  expectToggled(s, what)
  expect(inBetween(s), `${what}: reduced motion must be instant — ${describeSamples(s)}`).toEqual([])
}

/** Effective transition on the toggle's chevron svg. */
async function chevronTransition(chevron: Locator) {
  return chevron.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { prop: cs.transitionProperty, dur: cs.transitionDuration }
  })
}

function expectChevronMotion(t: { prop: string; dur: string }, what: string) {
  const props = t.prop.split(',').map((p) => p.trim())
  const durs = t.dur.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000))
  const i = props.findIndex((p) => p === 'transform' || p === 'rotate')
  expect(i, `${what}: chevron has no transform/rotate transition (${t.prop})`).toBeGreaterThanOrEqual(0)
  const dur = durs[i] ?? durs[0]
  expect(dur, `${what}: chevron duration ${t.dur}`).toBeGreaterThanOrEqual(150)
  expect(dur).toBeLessThanOrEqual(250)
}

// ── A1 Wordmark ─────────────────────────────────────────────────────────────

test.describe('A1 wordmark', () => {
  test('A1 wordmark: "Nimble" + aria-hidden mark in the header, heading font, not a focus stop', async ({ app, page }) => {
    await app.open('today')
    const wm = wordmark(page)
    await expect(wm, 'sidebar header has a [data-wordmark]').toHaveCount(1)
    await expect(wm).toBeVisible()
    expect((await wm.innerText()).trim()).toBe('Nimble')

    const mark = wm.locator('[aria-hidden="true"]').first()
    await expect(mark, 'aria-hidden mark inside the wordmark').toBeVisible()
    const mb = await box(mark)
    expect(mb.width, 'mark ~18px').toBeGreaterThanOrEqual(14)
    expect(mb.width).toBeLessThanOrEqual(22)
    expect(mb.height).toBeGreaterThanOrEqual(14)
    expect(mb.height).toBeLessThanOrEqual(22)

    const type = await wm.evaluate((root) => {
      // The element that owns the "Nimble" text node.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let owner: HTMLElement | null = null
      while (walker.nextNode()) if (walker.currentNode.textContent!.includes('Nimble')) owner = walker.currentNode.parentElement
      const cs = getComputedStyle(owner!)
      const label = document.querySelector('nav button[aria-label="Today"] span')!
      const first = (f: string) => f.split(',')[0].replace(/["']/g, '').trim()
      return {
        family: first(cs.fontFamily),
        heading: first(getComputedStyle(document.documentElement).getPropertyValue('--font-heading')),
        weight: Number(cs.fontWeight),
        size: cs.fontSize,
        labelSize: getComputedStyle(label).fontSize,
      }
    })
    expect(type.family, 'heading font').toBe(type.heading)
    expect(type.weight, 'semibold').toBeGreaterThanOrEqual(600)
    expect(type.size, 'body-strong size (same as nav labels)').toBe(type.labelSize)

    const focusables = await wm.evaluate((root) =>
      [root, ...Array.from(root.querySelectorAll('*'))].filter((e) => (e as HTMLElement).tabIndex >= 0 || e.matches('a[href], button, input, [tabindex]')).length,
    )
    expect(focusables, 'wordmark is decorative, not a focus stop').toBe(0)

    const cb = await box(navBtn(page, 'Collapse sidebar'))
    const wb = await box(wm)
    expect(wb.x + wb.width, 'wordmark left of the collapse button').toBeLessThanOrEqual(cb.x)
    expect(Math.abs(wb.y + wb.height / 2 - (cb.y + cb.height / 2)), 'vertically centred on the collapse button').toBeLessThanOrEqual(3)
  })

  test('A1 header height unchanged: collapse button and first nav item stay put', async ({ app, page }) => {
    await app.open('today')
    const cb = await box(navBtn(page, 'Collapse sidebar'))
    expect(cb).toEqual(MAIN.collapseBtn)
    const today = await box(navBtn(page, 'Today'))
    expect(today.y).toBe(MAIN.today.y)
    expect(today.height).toBe(MAIN.today.height)
  })

  test('A1 icon-snapped sidebar shows only the mark', async ({ app, page }) => {
    await app.open('today')
    await navBtn(page, 'Collapse sidebar').click()
    await expect.poll(async () => (await box(navEl(page))).width).toBe(48)
    const wm = wordmark(page)
    await expect(wm.locator('[aria-hidden="true"]').first(), 'mark still visible when snapped').toBeVisible()
    const textW = await navEl(page).evaluate((nav) => {
      let w = 0
      const walker = document.createTreeWalker(nav, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent!.includes('Nimble')) continue
        if (walker.currentNode.parentElement!.closest('[role="group"], [role="tree"]')) continue // the "Nimble" project
        const r = document.createRange()
        r.selectNodeContents(walker.currentNode)
        for (const rect of Array.from(r.getClientRects())) w = Math.max(w, rect.width)
      }
      return w
    })
    expect(textW, '"Nimble" text not laid out when snapped').toBeLessThanOrEqual(2)
    const overflow = await navEl(page).evaluate((nav) =>
      Array.from(nav.querySelectorAll<HTMLElement>('*'))
        .filter((e) => e.getClientRects().length && !e.closest('.sr-only'))
        .filter((e) => {
          const r = e.getBoundingClientRect()
          const n = nav.getBoundingClientRect()
          return r.width > 1 && (r.left < n.left - 0.5 || r.right > n.right + 0.5) && getComputedStyle(e).position !== 'fixed'
        })
        .map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`),
    )
    expect(overflow, 'nothing overflows the 48px nav').toEqual([])
    await navBtn(page, 'Expand sidebar').click()
    await expect(wordmark(page)).toContainText('Nimble')
  })

  test('A1 no clipping at the 160px min sidebar width', async ({ app, page }) => {
    await app.open('today')
    await dragNavTo(page, 150) // released ≥120 snaps to the 160 min
    await expect.poll(async () => Math.round((await box(navEl(page))).width)).toBe(160)
    const wm = wordmark(page)
    await expect(wm).toBeVisible()
    const header = navBtn(page, 'Collapse sidebar').locator('xpath=..')
    await expectNoClipping(header)
    await expectNoClipping(wm)
    const wb = await box(wm)
    const cb = await box(navBtn(page, 'Collapse sidebar'))
    expect(wb.x + wb.width, 'no overlap with the collapse button at 160').toBeLessThanOrEqual(cb.x)
    expect(wb.x).toBeGreaterThanOrEqual(0)
  })
})

// ── A2 Condensed nav trees ──────────────────────────────────────────────────

async function expectPitch(scope: Locator, mainPitch: number, what: string) {
  const rows = await rowTops(scope)
  expect(rows.length, `${what}: rows`).toBeGreaterThan(3)
  const pitches = rows
    .slice(1)
    .map((r, i) => ({ from: rows[i].key, to: r.key, d: Math.round((r.y - rows[i].y) * 10) / 10 }))
    .filter((p) => !SECTION_BREAKS.has(p.to))
  const max = Math.max(...pitches.map((p) => p.d))
  expect(max, `${what}: row pitch ≤ ${TARGET_PITCH} (main ${mainPitch}) — ${JSON.stringify(pitches)}`).toBeLessThanOrEqual(TARGET_PITCH + 0.5)
  expect(max).toBeLessThan(mainPitch)
  for (const r of rows) expect(r.h, `${what}: ${r.key} hit height ≥ 24`).toBeGreaterThanOrEqual(24)
  for (const p of pitches) expect(p.d, `${what}: rows overlap ${p.from}→${p.to}`).toBeGreaterThanOrEqual(24)
}

/** Counts never clip, names may ellipsise. */
async function expectTreeTextFits(scope: Locator) {
  await expectNoClipping(scope, { allowEllipsis: true })
  const counts = await scope.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-tree-row] *, [data-tree-row]'))
      .filter((e) => /^\d+$/.test(e.textContent!.trim()) && e.children.length === 0)
      .filter((e) => {
        const r = document.createRange()
        r.selectNodeContents(e)
        const t = r.getBoundingClientRect()
        const b = e.getBoundingClientRect()
        return getComputedStyle(e).textOverflow === 'ellipsis' ? e.scrollWidth > e.clientWidth : t.right > b.right + 0.5 || t.left < b.left - 0.5
      })
      .map((e) => `"${e.textContent}" ${e.scrollWidth}>${e.clientWidth}`),
  )
  expect(counts, 'clipped counts').toEqual([])
}

async function expectRingInside(page: Page, what: string) {
  await expectFocusRing(page)
  const { ext, out } = await ringClippedBy(page)
  expect(ext, `${what}: ring extent`).toBeGreaterThan(0)
  expect(out, `${what}: focus ring clipped`).toEqual([])
}

test.describe('A2 condensed trees', () => {
  test('A2 tasks project tree: pitch ≤ 28 (main 38), rows ≥ 24 tall, no clipping', async ({ app, page }) => {
    await app.open('tasks')
    await expect(tasksTree(page).locator('[data-tree-row]').nth(3)).toBeVisible()
    await expectTreeTextFits(tasksTree(page))
    await expectPitch(tasksTree(page), MAIN.tasksTreePitch, 'tasks tree')
  })

  test('A2 docs tree: pitch ≤ 28 (main 34), rows ≥ 24 tall, no clipping', async ({ app, page }) => {
    await app.open('docs')
    await expect(docsTree(page).locator('[data-tree-row]').nth(3)).toBeVisible()
    await expectTreeTextFits(docsTree(page))
    await expectPitch(docsTree(page), MAIN.docsTreePitch, 'docs tree')
  })

  test('A2 focus ring fully visible on first, nested and last tree rows', async ({ app, page }) => {
    await app.open('tasks')
    const rows = tasksTree(page).locator('[data-tree-row]')
    await rows.first().focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    await expectRingInside(page, 'tasks first row')
    await tasksTree(page).locator('[data-key="project:proj-mobile"]').focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await expect(page.locator(':focus')).toHaveAttribute('data-key', 'project:proj-mobile')
    await expectRingInside(page, 'tasks nested row')
    await page.keyboard.press('End')
    await expectRingInside(page, 'tasks last row')

    await app.open('docs')
    const d = docsTree(page).locator('[data-tree-row]')
    await d.first().focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    await expectRingInside(page, 'docs first row')
    await page.keyboard.press('ArrowDown')
    await expectRingInside(page, 'docs nested row')
    await page.keyboard.press('End')
    await expectRingInside(page, 'docs last row')
  })

  test('A2 top-level page items keep their 36px rows', async ({ app, page }) => {
    await app.open('tasks')
    for (const name of ['Today', 'Tasks', 'Inbox', 'Docs', 'Goals']) {
      expect((await box(navBtn(page, name))).height, name).toBe(36)
    }
    expect((await box(navBtn(page, 'Today'))).y).toBe(MAIN.today.y)
  })
})

// ── A3 Tree expand/collapse motion ──────────────────────────────────────────

const TASKAPP = 'project:proj-taskapp'
const DESIGN = 'folder:folder-design'
const children = (key: string) => `[data-tree-children="${key}"]`

test.describe('A3 tree motion', () => {
  test('A3 project tree: ←/→ animate the child list, focus stays, final layout = reduced-motion layout', async ({ app, page }) => {
    await app.open('tasks')
    const row = tasksTree(page).locator(`[data-key="${TASKAPP}"]`)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(children(TASKAPP)), `children wrapper ${children(TASKAPP)}`).toHaveCount(1)
    await row.focus()

    const collapse = await sampleWhile(page, children(TASKAPP), () => page.keyboard.press('ArrowLeft'))
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator(':focus')).toHaveAttribute('data-key', TASKAPP)
    expectAnimated(collapse, 'project collapse (←)')

    const expand = await sampleWhile(page, children(TASKAPP), () => page.keyboard.press('ArrowRight'))
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(':focus')).toHaveAttribute('data-key', TASKAPP)
    expectAnimated(expand, 'project expand (→)')
    const animatedLayout = await rowTops(tasksTree(page))

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.keyboard.press('ArrowLeft')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('ArrowRight')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => rowTops(tasksTree(page)), 'no layout jump: end layout matches reduced motion').toEqual(animatedLayout)
  })

  test('A3 project tree: chevron click animates; chevron rotates with a transition', async ({ app, page }) => {
    await app.open('tasks')
    const chevronBtn = tasksTree(page).getByRole('button', { name: /^(Collapse|Expand) Nimble$/ })
    expectChevronMotion(await chevronTransition(chevronBtn.locator('svg')), 'project chevron')
    await expect(page.locator(children(TASKAPP)), `children wrapper ${children(TASKAPP)}`).toHaveCount(1)
    const s = await sampleWhile(page, children(TASKAPP), () => chevronBtn.click())
    expectAnimated(s, 'project chevron click')
  })

  test('A3 docs folder: Enter and click animate the child list, focus stays', async ({ app, page }) => {
    await app.open('docs')
    const row = docsTree(page).locator(`[data-key="${DESIGN}"]`)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    expectChevronMotion(await chevronTransition(row.locator('svg').first()), 'docs folder chevron')
    await expect(page.locator(children(DESIGN)), `children wrapper ${children(DESIGN)}`).toHaveCount(1)
    await row.focus()
    const byKey = await sampleWhile(page, children(DESIGN), () => page.keyboard.press('Enter'))
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator(':focus')).toHaveAttribute('data-key', DESIGN)
    expectAnimated(byKey, 'docs folder collapse (Enter)')
    const byClick = await sampleWhile(page, children(DESIGN), () => row.click())
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    expectAnimated(byClick, 'docs folder expand (click)')
  })

  test('A3 nav page tree (Docs list) animates open and closed', async ({ app, page }) => {
    await app.open('docs')
    const group = 'nav [role="group"][aria-label="Docs list"]'
    const toggle = navEl(page).getByRole('button', { name: /^(Hide|Show) Docs list$/ })
    expectChevronMotion(await chevronTransition(toggle.locator('svg')), 'nav tree chevron')
    const close = await sampleWhile(page, group, () => navEl(page).getByRole('button', { name: 'Hide Docs list' }).click())
    expectAnimated(close, 'nav Docs list close')
    const open = await sampleWhile(page, group, () => navEl(page).getByRole('button', { name: 'Show Docs list' }).click())
    expectAnimated(open, 'nav Docs list open')
  })

  test('A3 reduced motion: tree toggles are instant', async ({ app, page }) => {
    // Assumes a rAF cadence (~16 ms) longer than Collapse's 1 ms reduced-motion tween (reviewer note, it2).
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await app.open('docs')
    const group = 'nav [role="group"][aria-label="Docs list"]'
    expectInstant(await sampleWhile(page, group, () => navEl(page).getByRole('button', { name: 'Hide Docs list' }).click()), 'nav Docs list close (reduced)')
    expectInstant(await sampleWhile(page, group, () => navEl(page).getByRole('button', { name: 'Show Docs list' }).click()), 'nav Docs list open (reduced)')

    await app.open('tasks')
    const row = tasksTree(page).locator(`[data-key="${TASKAPP}"]`)
    await expect(page.locator(children(TASKAPP)), `children wrapper ${children(TASKAPP)}`).toHaveCount(1)
    await row.focus()
    expectInstant(await sampleWhile(page, children(TASKAPP), () => page.keyboard.press('ArrowLeft')), 'project collapse (reduced)')
    expectInstant(await sampleWhile(page, children(TASKAPP), () => page.keyboard.press('ArrowRight')), 'project expand (reduced)')
  })
})

// ── A4 Sync toast ───────────────────────────────────────────────────────────

test.describe('A4 sync toast', () => {
  test('A4 no top banner: main content does not shift when sync turns unhealthy', async ({ app, page }) => {
    await stubSync(page, 'ok')
    await app.open('today')
    await expect(page.getByText(STALE_MSG)).toHaveCount(0)
    const before = (await box(page.locator('main').first())).y
    await setSync(page, 'stale')
    await expect(page.getByText(STALE_MSG)).toBeVisible()
    const after = (await box(page.locator('main').first())).y
    expect(after, 'main top y with the sync problem showing').toBe(before)
  })

  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) {
    test(`A4 bottom-right toast with message, Sync now, Dismiss; clear of ? and rail controls (${vp.width}×${vp.height})`, async ({ app, page }) => {
      await page.setViewportSize(vp)
      await stubSync(page, 'stale')
      await app.open('today')
      const t = syncSurface(page)
      await expect(t).toBeVisible()
      await expect(t.getByRole('button', { name: 'Sync now' })).toBeVisible()
      await expect(t.getByRole('button', { name: 'Dismiss' })).toBeVisible()
      await expect(page.getByText(STALE_MSG), 'exactly one instance').toHaveCount(1)

      const tb = await box(t)
      expect(tb.x + tb.width / 2, 'right half').toBeGreaterThan(vp.width / 2)
      expect(tb.y + tb.height / 2, 'bottom half').toBeGreaterThan(vp.height / 2)
      expect(tb.x + tb.width).toBeLessThanOrEqual(vp.width)
      expect(tb.y + tb.height).toBeLessThanOrEqual(vp.height)
      expect(intersects(tb, await box(helpBtn(page))), 'overlaps the ? help button').toBe(false)

      for (const tab of [/Calendar/, /Habits/]) {
        await railTab(page, tab).click()
        const hits = await page.locator('aside').evaluate((aside, tbox) =>
          Array.from(aside.querySelectorAll<HTMLElement>('button, [role="tab"], a[href], input'))
            .filter((e) => e.getClientRects().length)
            .filter((e) => {
              const r = e.getBoundingClientRect()
              return r.left < tbox.x + tbox.width && tbox.x < r.right && r.top < tbox.y + tbox.height && tbox.y < r.bottom
            })
            .map((e) => e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 30)),
          tb,
        )
        expect(hits, `toast covers rail controls on ${tab}`).toEqual([])
      }
      await expectNoClipping(t)
    })
  }

  // ── it2: the notice follows the right column and never covers the page ──

  /** Every visible task row and the page's <main> — the notice must clear them all. */
  async function expectClearOfPage(page: Page, t: Locator, what: string) {
    const tb = await box(t)
    const vp = page.viewportSize()!
    expect(tb.x, `${what}: in viewport (left)`).toBeGreaterThanOrEqual(0)
    expect(tb.y, `${what}: in viewport (top)`).toBeGreaterThanOrEqual(0)
    expect(tb.x + tb.width, `${what}: in viewport (right)`).toBeLessThanOrEqual(vp.width)
    expect(tb.y + tb.height, `${what}: in viewport (bottom)`).toBeLessThanOrEqual(vp.height)
    expect(intersects(tb, await box(helpBtn(page))), `${what}: overlaps the ? button`).toBe(false)
    const hits = await page.evaluate((tbox) => {
      const els = [...Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row]')), ...Array.from(document.querySelectorAll<HTMLElement>('main'))]
      return els
        .filter((e) => e.getClientRects().length)
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.left < tbox.x + tbox.width && tbox.x < r.right && r.top < tbox.y + tbox.height && tbox.y < r.bottom
        })
        .map((e) => e.getAttribute('data-nav-row') ?? e.tagName.toLowerCase())
    }, tb)
    expect(hits, `${what}: covers page rows / main`).toEqual([])
  }

  test('A4 rail collapsed: a compact notice in the rail strip, clear of the task rows', async ({ app, page }) => {
    await stubSync(page, 'stale')
    await app.open('tasks')
    await expect(page.locator('[data-nav-row]').first()).toBeVisible()
    await railCollapse(page).click()
    await expect.poll(async () => Math.round((await box(page.locator('aside').first())).width)).toBe(36)
    const t = syncSurface(page)
    await expect(t).toBeVisible()
    await expectClearOfPage(page, t, 'collapsed rail')
    // Its button opens the rail, where the full notice shows.
    await t.getByRole('button').click()
    await expect(syncSurface(page).getByRole('button', { name: 'Sync now' })).toBeVisible()
    await expectClearOfPage(page, syncSurface(page), 'rail reopened')
  })

  test('A4 rail at its 200px minimum: the notice fits inside the rail, clear of the task rows', async ({ app, page }) => {
    await stubSync(page, 'stale')
    await app.open('tasks')
    await expect(page.locator('[data-nav-row]').first()).toBeVisible()
    const aside = page.locator('aside').first()
    const h = await box(aside.locator('.cursor-col-resize').first())
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe('col-resize')
    await page.mouse.move(h.x + 160, h.y + h.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await box(aside)).width)).toBe(200)
    const t = syncSurface(page)
    await expect(t).toBeVisible()
    await expect(t.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await expectClearOfPage(page, t, 'rail at 200')
    const ab = await box(aside)
    const tb = await box(t)
    expect(tb.x, 'inside the rail').toBeGreaterThanOrEqual(ab.x)
    await expectNoClipping(t)
  })

  test('A4 Settings (rail slot kept, rail hidden): the notice sits in the empty slot', async ({ app, page }) => {
    await stubSync(page, 'stale')
    await app.open('settings')
    const t = syncSurface(page)
    await expect(t).toBeVisible()
    await expectClearOfPage(page, t, 'settings')
  })

  for (const railState of ['open', 'collapsed'] as const) {
    test(`A4 a sonner toast stacks clear of the notice (rail ${railState})`, async ({ app, page }) => {
      await stubSync(page, 'stale')
      await app.open('tasks')
      await expect(page.locator('[data-nav-row]').first()).toBeVisible()
      if (railState === 'collapsed') {
        await railCollapse(page).click()
        await expect.poll(async () => Math.round((await box(page.locator('aside').first())).width)).toBe(36)
      }
      const t = syncSurface(page)
      await expect(t).toBeVisible()
      // f on a focused row answers with a sonner toast in the harness (see t1 AC6).
      await page.keyboard.press('j')
      await page.keyboard.press('f')
      const toastEl = page.locator('[data-sonner-toast]').filter({ hasText: /focus/i }).first()
      await expect(toastEl).toBeVisible()
      await page.waitForTimeout(600) // sonner's own 400ms enter transition
      const tb = await box(t)
      const sb = await box(toastEl)
      const vp = page.viewportSize()!
      expect(intersects(tb, sb), `sonner toast ${JSON.stringify(sb)} overlaps the notice ${JSON.stringify(tb)}`).toBe(false)
      for (const [name, b] of [['notice', tb], ['toast', sb]] as const) {
        expect(b.x, `${name} in viewport`).toBeGreaterThanOrEqual(0)
        expect(b.y, `${name} in viewport`).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width, `${name} in viewport`).toBeLessThanOrEqual(vp.width)
        expect(b.y + b.height, `${name} in viewport`).toBeLessThanOrEqual(vp.height)
      }
    })
  }

  test('A4 persists (still visible after 10s)', async ({ app, page }) => {
    await page.clock.install()
    await stubSync(page, 'stale')
    await app.open('today')
    const t = syncSurface(page)
    await expect(t).toBeVisible()
    await page.clock.runFor(10_000)
    await expect(t).toBeVisible()
    await expect(t.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  })

  test('A4 Dismiss hides it for the session; new problem or relaunch brings it back; never duplicated', async ({ app, page }) => {
    await stubSync(page, 'stale')
    await app.open('today')
    const t = syncSurface(page)
    await expect(t).toBeVisible()

    // Re-polls of the same problem never stack a second one.
    for (let i = 0; i < 3; i++) await setSync(page, 'stale')
    await navBtn(page, 'Inbox').click()
    await navBtn(page, 'Today').click()
    await expect(page.getByText(STALE_MSG)).toHaveCount(1)

    await expect(t.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await t.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText(STALE_MSG)).toHaveCount(0)
    await navBtn(page, 'Tasks').click()
    await navBtn(page, 'Docs').click()
    await setSync(page, 'stale')
    await navBtn(page, 'Today').click()
    await page.waitForTimeout(300) // give a (wrong) re-show a chance to render
    await expect(page.getByText(STALE_MSG), 'stays dismissed across pages and re-polls').toHaveCount(0)

    await setSync(page, 'error')
    const err = syncSurface(page, ERROR_MSG)
    await expect(err, 'a new problem shows again').toBeVisible()
    await expect(err.getByRole('button', { name: 'Open settings' })).toBeVisible()
    await expect(err.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    await expect(page.getByText(ERROR_MSG)).toHaveCount(1)

    await setSync(page, 'ok')
    await expect(page.getByText(ERROR_MSG), 'healthy clears it').toHaveCount(0)

    await page.evaluate(() => { (window as unknown as { __syncMode: string }).__syncMode = 'stale' })
    await setSync(page, 'stale')
    await expect(syncSurface(page)).toBeVisible()
    await syncSurface(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText(STALE_MSG)).toHaveCount(0)
    await app.open('today') // reload = relaunch, still unhealthy
    await expect(syncSurface(page), 'relaunch while unhealthy shows it again').toBeVisible()
  })

  test('A4 keyboard: Sync now and Dismiss are Tab-reachable with a focus ring', async ({ app, page }) => {
    await stubSync(page, 'stale')
    await app.open('today')
    const t = syncSurface(page)
    await expect(t).toBeVisible()
    await expect(t.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    const reached = new Set<string>()
    for (let i = 0; i < 150 && reached.size < 2; i++) {
      await page.keyboard.press('Tab')
      const name = await page.evaluate((msg) => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return null
        const live = el.closest('[role="status"], [aria-live="polite"]')
        if (!live || !live.textContent!.includes(msg)) return null
        return el.getAttribute('aria-label') ?? el.textContent!.trim()
      }, STALE_MSG)
      if (name === 'Sync now' || name === 'Dismiss') {
        await expectFocusRing(page)
        reached.add(name)
      }
    }
    expect([...reached].sort(), 'Tab reaches both toast buttons').toEqual(['Dismiss', 'Sync now'])
  })
})

// ── A5 Right rail tab motion ────────────────────────────────────────────────

type TabSample = { t: number; left: number; width: number; panelO: number; listY: number; listH: number; listX: number }

async function sampleTabSwitch(page: Page, to: RegExp, act: () => Promise<unknown>, ms = 600) {
  const targetId = await railTab(page, to).getAttribute('id')
  const panelId = await railTab(page, to).getAttribute('aria-controls')
  const done = page.evaluate(
    ({ panelId, ms }) =>
      new Promise<TabSample[]>((resolve) => {
        const w = window as unknown as { __sampling?: boolean }
        const out: TabSample[] = []
        const list = document.querySelector('[role="tablist"][aria-label="Sidebar views"]')!
        const effOpacity = (el: Element | null) => {
          if (!el) return 0
          let o = 1
          for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
            const cs = getComputedStyle(e)
            if (cs.display === 'none' || cs.visibility === 'hidden' || (e as HTMLElement).hidden) return 0
            o *= parseFloat(cs.opacity)
          }
          return o
        }
        const t0 = performance.now()
        const tick = () => {
          const ind = list.querySelector('[data-tab-indicator]')
          const ib = ind?.getBoundingClientRect()
          const lb = list.getBoundingClientRect()
          out.push({
            t: performance.now() - t0,
            left: ib ? ib.left : NaN,
            width: ib ? ib.width : NaN,
            panelO: effOpacity(panelId ? document.getElementById(panelId) : null),
            listY: lb.top,
            listH: lb.height,
            listX: lb.left,
          })
          if (performance.now() - t0 < ms) requestAnimationFrame(tick)
          else resolve(out)
        }
        w.__sampling = true
        requestAnimationFrame(tick)
      }),
    { panelId, ms },
  )
  await page.waitForFunction(() => (window as unknown as { __sampling?: boolean }).__sampling === true)
  await act()
  const s = await done
  await page.evaluate(() => { (window as unknown as { __sampling?: boolean }).__sampling = false })
  return { s, targetId, panelId }
}

const fmtTabs = (s: TabSample[]) => s.map((x) => `${Math.round(x.t)}ms L=${x.left.toFixed(1)} W=${x.width.toFixed(1)} o=${x.panelO.toFixed(2)}`).join(' | ')

async function openRail(app: App, page: Page, tab = 'calendar') {
  await page.addInitScript((t) => {
    try { localStorage.setItem('nimble.rightTab', t) } catch { /* storage blocked */ }
  }, tab)
  await app.open('today')
  await expect(tablist(page)).toBeVisible()
}

test.describe('A5 rail tab motion', () => {
  test('A5 indicator slides and the panel cross-fades (Calendar → Habits), ends aligned', async ({ app, page }) => {
    await openRail(app, page, 'calendar')
    const indicator = tablist(page).locator('[data-tab-indicator]')
    await expect(indicator, '[data-tab-indicator] inside the tablist').toHaveCount(1)
    const from = await box(railTab(page, /Calendar/))
    const ib0 = await box(indicator)
    expect(Math.abs(ib0.x - from.x), 'indicator starts on the active tab').toBeLessThanOrEqual(2)

    const { s, panelId } = await sampleTabSwitch(page, /Habits/, () => railTab(page, /Habits/).click())
    expect(panelId, 'tab has aria-controls').toBeTruthy()
    await expect(railTab(page, /Habits/)).toHaveAttribute('aria-selected', 'true')
    const to = await box(railTab(page, /Habits/))
    const end = s[s.length - 1]
    expect(Math.abs(end.left - to.x), `indicator ends on the new tab — ${fmtTabs(s)}`).toBeLessThanOrEqual(2)
    expect(Math.abs(end.width - to.width), 'indicator width matches the new tab').toBeLessThanOrEqual(2)
    const lo = Math.min(s[0].left, end.left)
    const hi = Math.max(s[0].left, end.left)
    expect(hi - lo, 'indicator moved').toBeGreaterThan(4)
    const between = s.filter((x) => x.left > lo + 2 && x.left < hi - 2)
    expect(between.length, `indicator slides (no frame between old and new tab) — ${fmtTabs(s)}`).toBeGreaterThan(0)
    const fading = s.filter((x) => x.panelO > 0.05 && x.panelO < 0.95)
    expect(fading.length, `panel cross-fades (no frame with 0.05<opacity<0.95) — ${fmtTabs(s)}`).toBeGreaterThan(0)
    expect(end.panelO, 'panel ends fully opaque').toBeGreaterThan(0.99)
    const moveStart = s.findIndex((x) => Math.abs(x.left - s[0].left) > 0.5)
    const settled = s.findIndex((x, i) => i >= moveStart && s.slice(i).every((y) => Math.abs(y.left - end.left) <= 0.5))
    expect(s[settled].t - s[moveStart].t, `indicator settles within 400ms — ${fmtTabs(s)}`).toBeLessThanOrEqual(400)
  })

  test('A5 reduced motion: tab switch is instant', async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openRail(app, page, 'calendar')
    await expect(tablist(page).locator('[data-tab-indicator]'), '[data-tab-indicator] inside the tablist').toHaveCount(1)
    const { s } = await sampleTabSwitch(page, /Habits/, () => railTab(page, /Habits/).click())
    const end = s[s.length - 1]
    const lo = Math.min(s[0].left, end.left)
    const hi = Math.max(s[0].left, end.left)
    expect(s.filter((x) => x.left > lo + 2 && x.left < hi - 2), `indicator jumps (reduced) — ${fmtTabs(s)}`).toEqual([])
    expect(s.filter((x) => x.panelO > 0.05 && x.panelO < 0.95), `panel instant (reduced) — ${fmtTabs(s)}`).toEqual([])
  })

  test('A5 tab bar never shifts while switching', async ({ app, page }) => {
    await openRail(app, page, 'calendar')
    const collapse0 = await box(railCollapse(page))
    const list0 = await box(tablist(page))
    for (const to of [/Habits/, /Activity/, /Focus queue/, /Calendar/]) {
      const { s } = await sampleTabSwitch(page, to, () => railTab(page, to).click(), 400)
      for (const x of s) {
        expect(x.listY, 'tablist y').toBeCloseTo(list0.y, 1)
        expect(x.listH, 'tablist height').toBeCloseTo(list0.height, 1)
        expect(x.listX, 'tablist x').toBeCloseTo(list0.x, 1)
      }
      expect(await box(railCollapse(page)), 'rail collapse button').toEqual(collapse0)
    }
  })

  test('A5 arrow keys still move between tabs with a focus ring; Enter activates', async ({ app, page }) => {
    await openRail(app, page, 'calendar')
    await railTab(page, /Calendar/).focus()
    await page.keyboard.press('ArrowRight')
    await expect(railTab(page, /Habits/)).toBeFocused()
    await expectFocusRing(page)
    await page.keyboard.press('Enter')
    await expect(railTab(page, /Habits/)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(railTab(page, /Calendar/)).toBeFocused()
    await expectFocusRing(page)
  })
})

// ── Standing checks across lane A ───────────────────────────────────────────

test.describe('A standing', () => {
  for (const pageId of ['today', 'tasks', 'docs']) {
    test(`A1–A5 axe: no new violations on ${pageId} (toast showing, trees open)`, async ({ app, page }) => {
      await stubSync(page, 'stale')
      await app.open(pageId)
      await expect(page.getByText(STALE_MSG)).toBeVisible()
      await page.waitForTimeout(400) // let entrance motion settle before scanning
      await expectNoNewAxeViolations(page, pageId)
    })
  }

  test('A1–A5 motion rule: lane A files use motion tokens (no duration-N literal, no transition-all)', async () => {
    const files = [
      'components/layout/NavSidebar.tsx',
      'components/layout/NavTrees.tsx',
      'components/layout/RightSidebar.tsx',
      'components/layout/Dashboard.tsx',
      'components/shared/SyncHealthBanner.tsx',
      'components/ui/tabs.tsx',
      'components/tasks/ProjectSidebar.tsx',
      'components/docs/FolderTree.tsx',
    ]
    const hits: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(path.join(here, '../src', f), 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/\bduration-\d/.test(line) || /\btransition-all\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })
})

// ── Screenshots (before/after evidence; never fail on main) ─────────────────

test.describe('screenshots', () => {
  test.skip(!process.env.SHOT_DIR, 'set SHOT_DIR to capture')
  for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
      test.use({ theme, viewport: { width: 1440, height: 900 } })
      const shot = (page: Page, nn: string, state: string) =>
        page.screenshot({ path: `${process.env.SHOT_DIR}/${nn}-${state}-${theme}.png` })
      const settle = (page: Page) => page.mouse.move(700, 890).then(() => page.waitForTimeout(500))

      test(`shell states (${theme})`, async ({ app, page }) => {
        await stubSync(page, 'stale')
        await openRail(app, page, 'calendar')
        await settle(page)
        await shot(page, '01', 'sidebar-header')

        await navBtn(page, 'Collapse sidebar').click()
        await settle(page)
        await shot(page, '02', 'sidebar-snapped')
        await navBtn(page, 'Expand sidebar').click()

        await app.open('tasks')
        await settle(page)
        await shot(page, '03', 'tasks-tree-expanded')

        await app.open('docs')
        await settle(page)
        await shot(page, '04', 'docs-tree-expanded')

        await app.open('today')
        await expect(page.getByText(STALE_MSG)).toBeVisible()
        await settle(page)
        await shot(page, '05', 'sync-toast')

        await railTab(page, /Calendar/).click()
        await settle(page)
        await shot(page, '06', 'rail-calendar')
        await railTab(page, /Habits/).click()
        await settle(page)
        await shot(page, '07', 'rail-habits')
      })
    })
  }
})

