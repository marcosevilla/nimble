import type { CaptureRoute } from '@nimble/types'
import { parseRoutePrefix } from './captureRoutes.ts'

/** Command bar modes. 'route' is a user-defined capture route match;
 *  everything else is a built-in mode or one of its silent aliases. */
export type BarMode = 'search' | 'task' | 'capture' | 'breakdown' | 'doc' | 'route'

export interface ParsedBarMode {
  mode: BarMode
  query: string
  route: CaptureRoute | null
}

/** Parse a command-bar mode from the raw input. Built-in prefixes and their
 *  silent aliases (`/note`, `/capture`) are checked first — each keeps its
 *  trailing space so a user route (e.g. `/docs`) is never shadowed by a
 *  built-in check (e.g. `/doc `). A user route match falls through to
 *  `parseRoutePrefix`; anything else is plain search. `query` is always a
 *  suffix of `raw` (every branch returns a suffix of `trimmed`, which is
 *  itself a suffix of `raw`). */
export function parseMode(raw: string, routes: readonly CaptureRoute[]): ParsedBarMode {
  const trimmed = raw.trimStart()
  // Built-in modes and silent aliases first; route validation keeps user
  // routes off these names (lib/captureRoutes RESERVED_PREFIXES).
  if (trimmed.startsWith('/task ')) return { mode: 'task', query: trimmed.slice(6), route: null }
  if (trimmed.startsWith('/capture ')) return { mode: 'capture', query: trimmed.slice(9), route: null }
  if (trimmed.startsWith('/note ')) return { mode: 'capture', query: trimmed.slice(6), route: null }
  if (trimmed.startsWith('/doc ')) return { mode: 'doc', query: trimmed.slice(5), route: null }
  if (trimmed.startsWith('/search ')) return { mode: 'search', query: trimmed.slice(8), route: null }
  const { route, content } = parseRoutePrefix(trimmed, [...routes])
  if (route && content) return { mode: 'route', query: content, route }
  return { mode: 'search', query: trimmed, route: null }
}

/** ⌘K `/search ` hands its text to the ⌘F overlay (C4). Returns the text to
 *  hand over (possibly empty), or null when the input is not a search handoff. */
export function searchHandoff(raw: string): string | null {
  const trimmed = raw.trimStart()
  return trimmed.startsWith('/search ') ? trimmed.slice('/search '.length) : null
}
