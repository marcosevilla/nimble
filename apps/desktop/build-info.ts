import { execSync } from 'node:child_process'

/**
 * Compile-time build stamp shared by the desktop and web Vite configs.
 * `tauri build` runs `npm run build` first, so the installed app's Help panel
 * shows the commit it was built from ("-dirty" = uncommitted changes).
 */
export function buildDefine(): Record<string, string> {
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    if (execSync('git status --porcelain', { encoding: 'utf8' }).trim()) sha += '-dirty'
  } catch {
    // Not a git checkout (e.g. a tarball build) — keep "unknown".
  }
  return {
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  }
}
