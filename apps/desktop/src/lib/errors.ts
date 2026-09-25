/** True only for the "not found"-shaped errors that genuinely point at the
 * vault or a vault file (e.g. `Vault path not found`, `Failed to read
 * today.md: not found`) — not every "not found" (a 404 iCal feed, "Item not
 * found" from Todoist, "Document not found", etc.), which shouldn't send the
 * user to check their vault path in Settings. */
function isVaultNotFoundError(msg: string): boolean {
  const looksNotFound = msg.includes('not found') || msg.includes('no such file')
  if (!looksNotFound) return false
  return msg.includes('vault path') || msg.includes('.md')
}

export function friendlyError(raw: unknown): string {
  const msg = String(raw).toLowerCase()
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('connect')) {
    return "Couldn't connect — check your internet"
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return 'API token may be invalid — check Settings (\u2318,)'
  }
  if (isVaultNotFoundError(msg)) {
    return 'File not found — check your vault path in Settings (\u2318,)'
  }
  if (msg.includes('not configured')) {
    return 'Missing configuration — check Settings (\u2318,)'
  }
  if (msg.includes('not found') || msg.includes('no such file')) {
    return "Couldn't find that — check Settings (\u2318,)"
  }
  return 'Something went wrong. Try refreshing (\u2318R).'
}

/** Thrown (as a rejection) by every not-yet-implemented method on the web
 * client's DataProvider (`TursoProvider`, see `services/turso-provider.ts`).
 * Recognised by name rather than an import, so this stays a plain string/
 * error-shape check with no dependency on web-only code. */
export function isWebNotImplemented(raw: unknown): boolean {
  return raw instanceof Error && raw.name === 'WebNotImplementedError'
}

/** `friendlyError()`, but a not-yet-implemented web method resolves to
 * `null` instead of a message — callers show their calm empty/unavailable
 * state for that case rather than an error banner (e.g. the web calendar
 * panel showing no events instead of a permanent "Calendar offline. Retry"
 * that can never succeed). */
export function friendlyErrorOrNull(raw: unknown): string | null {
  if (isWebNotImplemented(raw)) return null
  return friendlyError(raw)
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
