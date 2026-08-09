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
