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
  | 'Inbox'
  | 'Docs'
  | 'Goals'
  | 'Session'

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
  { section: 'Tasks', keys: 'x', label: 'Complete focused task' },
  { section: 'Tasks', keys: 's', label: 'Snooze focused task' },
  { section: 'Tasks', keys: 'Enter', label: 'Open focused task' },

  // ── Focus (Dashboard.tsx Space; FocusCelebration.tsx) ──
  { section: 'Focus', keys: 'Space', label: 'Pause a running timer (Resume and Start are on the focus card)' },
  { section: 'Focus', keys: '⇧F', label: 'Open / close the focus queue in the right column (starts nothing)' },
  { section: 'Focus', keys: 'Enter / Escape', label: 'Dismiss completion note (next task waits for Start)' },

  // ── Command bar (CommandBar.tsx) ──
  { section: 'Command bar', keys: '⌥C', label: 'Complete selected task' },
  { section: 'Command bar', keys: '⌥B', label: 'AI breakdown' },
  { section: 'Command bar', keys: '⌥M', label: 'Move to project' },
  { section: 'Command bar', keys: '/task', label: 'Force create mode' },
  { section: 'Command bar', keys: '/capture', label: 'Force note mode' },
  { section: 'Command bar', keys: '/doc', label: 'Search docs' },
  { section: 'Command bar', keys: '/search', label: 'Force search mode' },
  { section: 'Command bar', keys: 'Escape', label: 'Close' },

  // ── Calendar rail (CalendarPanel.tsx, while focus is in the calendar) ──
  { section: 'Calendar', keys: '← / →', label: 'Previous / next day (focus the calendar first: Tab or click)' },
  { section: 'Calendar', keys: 't', label: 'Back to today (calendar focused)' },

  // ── Selection ──
  { section: 'Selection', keys: 'Click', label: 'Select / deselect item' },
  { section: 'Selection', keys: '⇧Click', label: 'Select range' },
  { section: 'Selection', keys: 'Escape', label: 'Clear selection' },

  // ── General (Dashboard.tsx; src-tauri/src/lib.rs global shortcuts) ──
  { section: 'General', keys: '⌘R', label: 'Refresh all data' },
  { section: 'General', keys: '⌘⇧T', label: 'Show / hide window' },
  { section: 'General', keys: '⌥⌘Space', label: 'Quick-capture strip (anywhere on the Mac)' },
  { section: 'General', keys: 'Escape', label: 'Close detail view / help panel' },

  // ── Appended by Stage B4 (shell): later rows go below, never reorder above ──
  { section: 'Navigation', keys: '⌥Enter', label: 'Reorder sidebar page (then arrows, Enter)' },

  // ── B3a: Tasks rows (hooks/useTaskNavigation.ts via useTaskRowActions) ──
  // Appended, never reordered — the panel groups by section.
  { section: 'Tasks', keys: 'f', label: 'Focus now on focused task (explicit Start)' },
  { section: 'Tasks', keys: 'Escape', label: 'Clear row focus' },

  // ── Inbox (InboxPage.tsx) ──
  { section: 'Inbox', keys: 'c', label: 'Capture a note' },
  { section: 'Inbox', keys: 'j / ↓', label: 'Next item' },
  { section: 'Inbox', keys: 'k / ↑', label: 'Previous item' },
  { section: 'Inbox', keys: 'Enter', label: 'Open focused item' },
  { section: 'Inbox', keys: 't', label: 'Convert focused note to task' },
  { section: 'Inbox', keys: 'm', label: 'Move focused note to a doc' },
  { section: 'Inbox', keys: 'd', label: 'Dismiss focused note' },
  { section: 'Inbox', keys: 'Escape', label: 'Leave the capture field / clear row focus' },
  // ── Docs (FolderTree.tsx roving tree; DocsSearch.tsx; DocsPage.tsx `N` and `/`) ──
  { section: 'Docs', keys: '↑ / ↓', label: 'Move through the tree' },
  { section: 'Docs', keys: '← / →', label: 'Collapse / expand a folder' },
  { section: 'Docs', keys: 'Enter', label: 'Open the focused document or note' },
  { section: 'Docs', keys: '⌫', label: 'Delete the focused document or folder (asks first)' },
  { section: 'Docs', keys: 'N', label: 'New document' },
  { section: 'Docs', keys: '/', label: 'Search docs and vault (⌘K /doc searches native docs only)' },

  // ── Goals (HabitsSection.tsx habit circles; GoalTimeline.tsx) ──
  { section: 'Goals', keys: 'Enter / Space', label: 'Check off the focused habit' },
  { section: 'Goals', keys: 'T', label: 'Timeline: jump to today' },

  // ── Session (FocusView.tsx while expanded; FocusCelebration.tsx) ──
  { section: 'Session', keys: 'Enter', label: 'Complete the focused task' },
  { section: 'Session', keys: 'Escape', label: 'Minimize to the banner' },
  { section: 'Session', keys: 's', label: 'Stop (banks time, keeps the queue)' },
  { section: 'Session', keys: 'Enter (completion note)', label: 'Dismiss; the next task stays paused' },
  { section: 'Session', keys: 'Escape (completion note)', label: 'Dismiss' },

  // ── Tasks: nav project tree (ProjectSidebar.tsx via components/shared/treeKeys.ts) ──
  { section: 'Tasks', keys: '↑ / ↓', label: 'Move through the project list in the nav (Enter opens)' },
  { section: 'Tasks', keys: '← / →', label: 'Collapse / expand a parent project' },
  { section: 'Tasks', keys: 'e', label: 'Edit the focused project' },
  { section: 'Tasks', keys: '⌫', label: 'Delete the focused project (asks first)' },

  // ── Goals: habits in the right column (Dashboard.tsx ⇧H → lib/rightRail.ts toggleHabits) ──
  { section: 'Goals', keys: '⇧H', label: 'Open / close habits in the right column' },
]

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  'Navigation',
  'Tasks',
  'Focus',
  'Command bar',
  'Calendar',
  'Selection',
  'General',
  'Inbox',
  'Docs',
  'Goals',
  'Session',
]

export function shortcutsBySection(): { title: ShortcutSection; rows: Shortcut[] }[] {
  return SHORTCUT_SECTIONS.map((title) => ({
    title,
    rows: SHORTCUTS.filter((s) => s.section === title),
  })).filter((g) => g.rows.length > 0)
}

/* Keydowns that carry no character. A pending `g` chord ignores them so
   reaching for Shift (or Caps Lock) between `g` and the letter does not
   cancel the chord (Stage A reviewer minor). */
const MODIFIER_ONLY_KEYS = new Set(['Shift', 'Alt', 'Meta', 'Control', 'CapsLock', 'Fn', 'AltGraph'])

export function isModifierOnlyKey(key: string): boolean {
  return MODIFIER_ONLY_KEYS.has(key)
}

/** ⇧H: open / close habits in the right column (re-score goals N-P1-1). */
export function isHabitsShortcut(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean }): boolean {
  return e.key === 'H' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat
}
