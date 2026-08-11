// R1 feature-surface capture script — mock-tauri backend, vite dev server.
const fs = require('fs')
const path = require('path')
const { chromium } = require('/Users/marcosevilla/Developer/portfolio/site/node_modules/playwright-core')

const CHROME =
  '/Users/marcosevilla/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const MOCK = fs.readFileSync(
  '/Users/marcosevilla/Developer/marco-task-app/nimble/tools/mock-tauri.js',
  'utf8',
)
const OUT = '/private/tmp/claude-501/-Users-marcosevilla-Developer-marco-task-app/f2a87ca4-d796-498d-851e-45f59fa057c2/scratchpad/r1-captures'
fs.mkdirSync(OUT, { recursive: true })

// tauri.conf.json main window: 1200x800
const VIEWPORT = { width: 1200, height: 800 }

async function newPage(context, url) {
  const page = await context.newPage()
  let deepLinkApplied = false
  page.on('console', (msg) => {
    if (msg.text().includes('[mock-tauri] deep-link applied')) deepLinkApplied = true
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  // Wait for the deep-link shim to have fired, then settle fonts/data.
  const start = Date.now()
  while (!deepLinkApplied && Date.now() - start < 8000) {
    await page.waitForTimeout(100)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(500)
  return page
}

// The Agentation dev toolbar (dark 44px circle bottom-right) is a dev-only
// overlay — hide it if present before any capture.
async function hideDevToolbar(page) {
  await page.evaluate(() => {
    const kill = (el) => { el.style.setProperty('display', 'none', 'important') }
    document
      .querySelectorAll('[data-agentation-root], [data-agentation-toolbar], [data-feedback-toolbar], [class*="agentation" i], [id*="agentation" i]')
      .forEach(kill)
    // Fallback: any fixed ~44px circle pinned to the bottom-right corner.
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed') continue
      const r = el.getBoundingClientRect()
      if (
        r.width >= 36 && r.width <= 56 && r.height >= 36 && r.height <= 56 &&
        r.right > innerWidth - 80 && r.bottom > innerHeight - 80
      ) kill(el)
    }
  })
}

async function settleAndShoot(page, file) {
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(760, 740) // park cursor off interactive rows (no hover artifacts)
  await page.waitForTimeout(500)
  await hideDevToolbar(page)
  await page.screenshot({ path: path.join(OUT, file) })
  console.log('captured', file)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: 'light',
    deviceScaleFactor: 2,
  })
  await context.addInitScript(MOCK)

  // ── 1. tasks-sections.png — Nimble project open: section lanes + nested sidebar ──
  {
    const page = await newPage(context, 'http://localhost:5173/?page=tasks')
    await page.getByText('Nimble', { exact: true }).first().click()
    await page.waitForTimeout(700) // sections fetch + lane render
    await settleAndShoot(page, 'tasks-sections.png')

    // ── 2. task-detail.png — inline TaskEditor open on the fully-loaded task ──
    // Body-mode TaskDetailPage doesn't render labels/duration/section (known
    // R1 UX gap) — the surface showing ALL R1 fields is the inline TaskEditor.
    await page.evaluate(() => {
      window.__stores.useSelectionStore.getState().setEditingTask('task-04')
    })
    await page.waitForTimeout(700) // listSections + listLabels inside editor
    await settleAndShoot(page, 'task-detail.png')

    // ── 4 (same page): label-picker.png — LabelPicker popover open ──
    await page.getByRole('button', { name: 'Add label' }).click()
    await page.waitForTimeout(600)
    await settleAndShoot(page, 'label-picker.png')
    await page.close()
  }

  // ── 3. settings-labels.png — Settings scrolled to the Labels manager ──
  {
    const page = await newPage(context, 'http://localhost:5173/?page=settings')
    const anchor = page.locator('a[href="#labels"]')
    if (await anchor.count()) {
      await anchor.first().click()
    } else {
      await page.evaluate(() => document.getElementById('labels')?.scrollIntoView())
    }
    await page.waitForTimeout(700)
    await settleAndShoot(page, 'settings-labels.png')
    await page.close()
  }

  await browser.close()
  console.log('done')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
