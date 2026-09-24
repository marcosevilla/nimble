export function friendlyError(raw: unknown): string {
  const msg = String(raw).toLowerCase()
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connect')) {
    return "Couldn't connect — check your internet"
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return 'API token may be invalid — check Settings (\u2318,)'
  }
  if (msg.includes('not found') || msg.includes('no such file')) {
    return 'File not found — check your vault path in Settings (\u2318,)'
  }
  if (msg.includes('not configured')) {
    return 'Missing configuration — check Settings (\u2318,)'
  }
  return 'Something went wrong. Try refreshing (\u2318R).'
}

/** Rust's `read_today_md` rejects with "Failed to read today.md: not found"
 * when the vault has no root `today.md`. That's the normal state now (the
 * legacy daily note is gone), so callers treat it as "no daily note". */
export function isMissingTodayNote(raw: unknown): boolean {
  return /today\.md: not found/i.test(String(raw))
}

export async function retryOnce<T>(fn: () => Promise<T>, delayMs = 2000): Promise<T> {
  try {
    return await fn()
  } catch (firstError) {
    await new Promise((r) => setTimeout(r, delayMs))
    try {
      return await fn()
    } catch {
      throw firstError // throw original error for better diagnostics
    }
  }
}
