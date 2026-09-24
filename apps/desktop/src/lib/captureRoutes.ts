import type { CaptureRoute } from '@nimble/types'

export interface ParsedRoute {
  route: CaptureRoute | null
  content: string
}

/**
 * Parse a prefix from the input text and match against known routes.
 * Matches the longest prefix first so `/idea` beats `/i` if both exist.
 * Prefix must be followed by a space (e.g., "/i my idea").
 */
export function parseRoutePrefix(
  input: string,
  routes: CaptureRoute[],
): ParsedRoute {
  if (!input.startsWith('/')) {
    return { route: null, content: input }
  }

  // Sort routes by prefix length descending (longest match first)
  const sorted = [...routes].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )

  for (const route of sorted) {
    // Match exactly: prefix followed by space, or prefix is the entire input
    if (
      input.startsWith(route.prefix + ' ') ||
      input === route.prefix
    ) {
      const content = input.slice(route.prefix.length).trimStart()
      return { route, content }
    }
  }

  return { route: null, content: input }
}

/** Prefixes the command bar keeps for itself: `/doc` and `/search` are
 *  palette modes; `/task`, `/note` and `/capture` are its silent aliases
 *  (decision 2026-09-23). A capture route can't take one. */
export const RESERVED_PREFIXES: readonly string[] = ['/doc', '/search', '/task', '/note', '/capture']

/** Why `prefix` can't be saved as a route, or null when it can.
 *  `editingId` is the route being edited, so keeping its own prefix is fine. */
export function validateRoutePrefix(
  prefix: string,
  routes: readonly CaptureRoute[],
  editingId: string | null = null,
): string | null {
  const p = prefix.trim()
  if (!p) return 'Prefix is required'
  if (!p.startsWith('/')) return 'Prefix must start with /'
  if (p.length < 2) return 'Add at least one letter after /'
  if (/\s/.test(p)) return "Prefix can't contain spaces"
  const lower = p.toLowerCase()
  if (RESERVED_PREFIXES.includes(lower)) return `${p} is reserved for the command bar`
  if (routes.some((r) => r.id !== editingId && r.prefix.toLowerCase() === lower)) {
    return `${p} is already used by another route`
  }
  return null
}
