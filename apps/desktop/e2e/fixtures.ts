// Shared QA fixtures: mock backend injection plus the four standing checks
// every UI task must pass — visibility, no text clipping, keyboard focus ring
// and a per-page axe scan with no violations beyond the recorded baseline.
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MOCK = fs.readFileSync(path.join(here, '../../../tools/mock-tauri.js'), 'utf8')
const BASELINE_FILE = path.join(here, 'axe-baseline.json')

export type Theme = 'light' | 'dark'

export const test = base.extend<{ theme: Theme; app: App }>({
  theme: ['light', { option: true }],
  app: async ({ page, theme }, use) => {
    await page.addInitScript((mode) => {
      localStorage.setItem('theme', mode)
      // The app re-reads `theme` from settings after boot; seed the mock too.
      ;(window as unknown as { __MOCK_SETTINGS__: Record<string, string> }).__MOCK_SETTINGS__ = { theme: mode }
    }, theme)
    await page.addInitScript(MOCK)
    await use(new App(page))
  },
})

export { expect }

export class App {
  constructor(readonly page: Page) {}

  /** Open a page by its nav id (`today`, `tasks`, `inbox`, `docs`, `goals`, `settings`). */
  async open(pageId: string, query = '') {
    await this.page.goto(`/?page=${pageId}${query ? '&' + query : ''}`, { waitUntil: 'load' })
    // mock-tauri.js applies ?page= through the DEV-only window.__stores hatch.
    await this.page.waitForFunction(
      (id) => {
        const s = (window as unknown as { __stores?: { useAppStore: { getState(): { currentPage: string } } } }).__stores
        return !!s && s.useAppStore.getState().currentPage === id
      },
      pageId === 'activity' ? 'settings' : pageId,
    )
    await this.page.locator('main').first().waitFor({ state: 'visible' })
    // Let async loaders settle (mock resolves on the microtask queue).
    await this.page.waitForLoadState('networkidle').catch(() => {})
  }
}

/**
 * Elements under `scope` whose own text overflows their box
 * (scrollWidth > clientWidth). Hidden elements are ignored.
 * `allowEllipsis` skips deliberate `text-overflow: ellipsis` truncation.
 */
export async function findClipped(scope: Locator, opts: { allowEllipsis?: boolean } = {}) {
  return scope.evaluateAll(
    (roots, allowEllipsis) => {
      const out: string[] = []
      for (const root of roots) {
        const els = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]
        for (const el of els) {
          const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim())
          if (!ownText) continue
          const cs = getComputedStyle(el)
          if (cs.display === 'none' || cs.visibility === 'hidden' || el.getClientRects().length === 0) continue
          if (allowEllipsis && cs.textOverflow === 'ellipsis') continue
          // scrollWidth alone also counts invisible hit-area pseudo-elements;
          // confirm with the laid-out width of the element's own text.
          let textW = 0
          for (const n of Array.from(el.childNodes)) {
            if (n.nodeType !== 3 || !n.textContent!.trim()) continue
            const r = document.createRange()
            r.selectNodeContents(n)
            for (const rect of Array.from(r.getClientRects())) textW = Math.max(textW, rect.right - el.getBoundingClientRect().left - el.clientLeft)
          }
          const contentRight = el.clientWidth - parseFloat(cs.paddingRight)
          const clipsX = el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && textW > contentRight + 1
          const clipsY = cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0
          if (clipsX || clipsY) {
            out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(/\s+/).slice(0, 3).join('.') : ''} "${el.textContent!.trim().slice(0, 40)}" (${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight})`)
          }
        }
      }
      return out
    },
    !!opts.allowEllipsis,
  )
}

export async function expectNoClipping(scope: Locator, opts: { allowEllipsis?: boolean } = {}) {
  expect(await findClipped(scope, opts), 'clipped text').toEqual([])
}

/** The currently focused element shows a visible ring (outline or box-shadow). */
export async function expectFocusRing(page: Page) {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { ok: false, why: 'nothing focused' }
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    const shadow = cs.boxShadow && cs.boxShadow !== 'none'
    return { ok: !!(outline || shadow), why: `${el.tagName} outline=${cs.outlineStyle} ${cs.outlineWidth} shadow=${cs.boxShadow}` }
  })
  expect(ring.ok, `focus ring: ${ring.why}`).toBe(true)
}

type Baseline = Record<string, Record<string, number>>

function readBaseline(): Baseline {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * WCAG 2.1 A/AA axe scan of the whole page. Fails on any rule that is new for
 * `pageKey`, or that now hits more nodes than the baseline recorded on main.
 * Run with UPDATE_AXE_BASELINE=1 --workers=1 (against a frozen main build) to re-record.
 */
export async function expectNoNewAxeViolations(page: Page, pageKey: string) {
  // Dark mode has its own baseline row (`<page>:dark`).
  if (await page.evaluate(() => document.documentElement.classList.contains('dark'))) pageKey += ':dark'
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Base UI injects unnamed `role=button` focus guards (6) whenever any
    // popup is open — library-internal, present on main with any popover, so
    // a no-popup baseline can't account for them.
    .exclude('[data-base-ui-focus-guard]')
    .analyze()
  const counts: Record<string, number> = {}
  for (const v of results.violations) counts[v.id] = v.nodes.length
  if (process.env.UPDATE_AXE_BASELINE) {
    const all = readBaseline()
    all[pageKey] = counts
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(Object.fromEntries(Object.entries(all).sort()), null, 2) + '\n')
    return
  }
  const known = readBaseline()[pageKey] ?? {}
  const fresh = results.violations
    .filter((v) => v.nodes.length > (known[v.id] ?? 0))
    .map((v) => `${v.id} (${v.impact}) ${v.nodes.length} > baseline ${known[v.id] ?? 0}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(fresh, `new axe violations on ${pageKey}`).toEqual([])
}
