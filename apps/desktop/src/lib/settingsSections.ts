/* Settings information architecture — ONE list drives the section nav,
   the render order and the scroll-spy (settings audit P2-1, P2-2).

   Rules:
   - Order here is page order. Adding a section = adding a row here and a
     matching `<section id>` in SettingsPage; the nav follows.
   - `requires` names the DataProvider capability that must be `supported`
     for the section to render (web build drops Backups / Reminders /
     Phone alerts). `standalone` sections draw their own top rule, so the
     page does not add a Separator before them.
   - Labels are sentence case.

   Plain TS, no JSX — tests/settingsSections.test.mjs imports it directly. */

export type SettingsCapability = 'backup' | 'reminders' | 'googleCalendar'

export interface SettingsSection {
  id: string
  label: string
  requires?: SettingsCapability
  standalone?: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'todoist-sync', label: 'Todoist sync' },
  { id: 'focus', label: 'Focus mode' },
  { id: 'capture-routes', label: 'Capture routes' },
  { id: 'labels', label: 'Labels' },
  { id: 'calendars', label: 'Calendars' },
  { id: 'sync', label: 'Sync' },
  { id: 'backups', label: 'Backups', requires: 'backup', standalone: true },
  { id: 'reminders', label: 'Reminders', requires: 'reminders', standalone: true },
  { id: 'google-calendar', label: 'Phone alerts', requires: 'googleCalendar', standalone: true },
  { id: 'demo', label: 'Demo mode' },
  { id: 'about', label: 'About' },
  { id: 'maintenance', label: 'Maintenance' },
]

/** Sections the current provider can actually render, in page order. */
export function visibleSections(
  caps: Record<SettingsCapability, boolean>,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingsSection[] {
  return sections.filter((s) => !s.requires || caps[s.requires])
}

export interface SectionBox {
  id: string
  /** Top edge, in the same coordinate space as `line`. */
  top: number
}

/** Scroll-spy: the active section is the LAST one whose top edge sits at or
 *  above the active line (just under the sticky header). Before the first
 *  section, the first is active; once the scroller is at its end the last
 *  section is (short trailing sections never reach the line otherwise).
 *  Boxes must be in page order. */
export function activeSectionId(boxes: readonly SectionBox[], line: number, atEnd = false): string | null {
  if (boxes.length === 0) return null
  if (atEnd) return boxes[boxes.length - 1].id
  let active = boxes[0].id
  for (const box of boxes) {
    if (box.top <= line) active = box.id
    else break
  }
  return active
}
