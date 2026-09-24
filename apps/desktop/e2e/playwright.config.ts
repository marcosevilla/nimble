// Browser QA against a *frozen* build served by tools/qa-frozen.sh — never
// against a worktree an agent is still editing. The app runs on synthetic data
// from tools/mock-tauri.js (injected by e2e/fixtures.ts), so nothing here
// touches a real profile, Todoist or the network.
//
//   BASE_URL=http://localhost:4610 npx playwright test -c e2e
//
// WebKit is the closest engine to the native WKWebView.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  outputDir: process.env.PW_OUTPUT_DIR || 'test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4610',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }],
})
