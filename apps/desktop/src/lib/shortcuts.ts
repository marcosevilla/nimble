/* Keyboard shortcut registry — the single source both the Dashboard
   handlers and the HelpPanel read (shell audit P1-1, P1-5, P2-2).

   Rules:
   - Every real handler has a row here; every row here has a real handler.
     Adding a shortcut without its registry row (or the reverse) is a bug.
   - `keys` is the display string (⌘ ⌥ ⇧ glyphs, `g t` chords with a space).
   - Section titles are sentence case. Later stages append their own rows.

   Tested by tests/shortcuts.test.mjs — plain TS, no JSX, so node imports
   it directly. */

import type { Page } from '@/stores/appStore'

export type ShortcutSection =
  | 'Navigation'
  | 'Tasks'
  | 'Focus'
  | 'Command bar'
  | 'Calendar'
  | 'Selection'
  | 'General'

export interface Shortcut {
  section: ShortcutSection
  keys: string
  label: string
}

/** `g` + one of these keys navigates; the prefix expires after G_PREFIX_TIMEOUT_MS. */
export const G_PREFIX_PAGES: Record<string, Page> = {
  t: 'today',
  k: 'tasks',
  i: 'inbox',
  d: 'docs',
  g: 'goals',
  s: 'session',
  ',': 'settings',
}

export const G_PREFIX_TIMEOUT_MS = 600

export const SHORTCUTS: Shortcut[] = [
  // ── Navigation (Dashboard.tsx global handler) ──
  { section: 'Navigation', keys: 'g t', label: 'Go to Today' },
  { section: 'Navigation', keys: 'g k', label: 'Go to Tasks' },
  { section: 'Navigation', keys: 'g i', label: 'Go to Inbox' },
  { section: 'Navigation', keys: 'g d', label: 'Go to Docs' },
  { section: 'Navigation', keys: 'g g', label: 'Go to Goals' },
  { section: 'Navigation', keys: 'g s', label: 'Go to Session' },
  { section: 'Navigation', keys: 'g ,', label: 'Go to Settings' },
  { section: 'Navigation', keys: '1–6', label: 'Jump to page (sidebar order)' },
  { section: 'Navigation', keys: '⌘1–6', label: 'Jump to page, even while typing' },
  { section: 'Navigation', keys: '⌘K', label: 'Command bar' },
  { section: 'Navigation', keys: '⌘,', label: 'Settings' },
  { section: 'Navigation', keys: '?', label: 'Keyboard shortcuts' },

  // ── Tasks (Dashboard.tsx `q`; hooks/useTaskNavigation.ts) ──
  { section: 'Tasks', keys: 'q', label: 'Quick create task' },
  { section: 'Tasks', keys: 'j / ↓', label: 'Next task' },
  { section: 'Tasks', keys: 'k / ↑', label: 'Previous task' },
  { section: 'Tasks', keys: 'x / Space', label: 'Complete focused task' },
  { section: 'Tasks', keys: 's', label: 'Snooze focused task' },
  { section: 'Tasks', keys: 'Enter', label: 'Open focused task' },

  // ── Focus (Dashboard.tsx Space; FocusCelebration.tsx) ──
  { section: 'Focus', keys: 'Space', label: 'Pause / resume timer' },
  { section: 'Focus', keys: 'Enter / Escape', label: 'Dismiss celebration' },

  // ── Command bar (CommandBar.tsx) ──
  { section: 'Command bar', keys: '⌥C', label: 'Complete selected task' },
  { section: 'Command bar', keys: '⌥B', label: 'AI breakdown' },
  { section: 'Command bar', keys: '⌥M', label: 'Move to project' },
  { section: 'Command bar', keys: '/task', label: 'Force create mode' },
  { section: 'Command bar', keys: '/capture', label: 'Force note mode' },
  { section: 'Command bar', keys: '/doc', label: 'Search docs' },
  { section: 'Command bar', keys: '/search', label: 'Force search mode' },
  { section: 'Command bar', keys: 'Escape', label: 'Close' },

  // ── Calendar rail (CalendarPanel.tsx, while the rail is hovered) ──
  { section: 'Calendar', keys: '← / →', label: 'Previous / next day' },
  { section: 'Calendar', keys: 't', label: 'Back to today' },

  // ── Selection ──
  { section: 'Selection', keys: 'Click', label: 'Select / deselect item' },
  { section: 'Selection', keys: '⇧Click', label: 'Select range' },
  { section: 'Selection', keys: 'Escape', label: 'Clear selection' },

  // ── General (Dashboard.tsx; src-tauri/src/lib.rs global shortcuts) ──
  { section: 'General', keys: '⌘R', label: 'Refresh all data' },
  { section: 'General', keys: '⌘⇧T', label: 'Show / hide window' },
  { section: 'General', keys: '⌥⌘Space', label: 'Quick-capture strip (anywhere on the Mac)' },
  { section: 'General', keys: 'Escape', label: 'Close detail view / help panel' },
]

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  'Navigation',
  'Tasks',
  'Focus',
  'Command bar',
  'Calendar',
  'Selection',
  'General',
]

export function shortcutsBySection(): { title: ShortcutSection; rows: Shortcut[] }[] {
  return SHORTCUT_SECTIONS.map((title) => ({
    title,
    rows: SHORTCUTS.filter((s) => s.section === title),
  })).filter((g) => g.rows.length > 0)
}
