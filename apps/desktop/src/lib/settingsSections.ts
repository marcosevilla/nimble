/* Settings information architecture — ONE list drives the page rail, the
   nested section links, the render order and the scroll-spy (settings
   audit P2-1, P2-2; sub-pages loop 2).

   Rules:
   - SETTINGS_PAGES order is rail order. SETTINGS_SECTIONS is grouped by
     page in that same order, and within a page its order is render order.
   - Adding a section = a row here (with its `page`) and a matching body in
     SettingsPage's `bodies` map. A section whose body is null does not
     render, and a page with no rendered section is hidden from the rail
     (that is how "Today & brief" stays out until Lane B mounts it).
   - `requires` names the DataProvider capability that must be `supported`
     for the section to render (web build drops Backups / Reminders /
     Phone alerts). `standalone` sections draw their own top rule, so the
     page does not add a Separator before them — never first on a page.
   - Labels are sentence case (acronyms like API excepted).

   Plain TS, no JSX — tests/settingsSections.test.mjs imports it directly. */

export type SettingsCapability = 'backup' | 'reminders' | 'googleCalendar'

export type SettingsPageId = 'general' | 'brief' | 'tasks' | 'connections' | 'data'

export interface SettingsPage {
  id: SettingsPageId
  label: string
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: 'general', label: 'General' },
  { id: 'brief', label: 'Today & brief' },
  { id: 'tasks', label: 'Tasks & capture' },
  { id: 'connections', label: 'Connections' },
  { id: 'data', label: 'Data' },
]

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'general'

export interface SettingsSection {
  id: string
  label: string
  page: SettingsPageId
  requires?: SettingsCapability
  standalone?: boolean
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', label: 'Appearance', page: 'general' },
  { id: 'demo', label: 'Demo mode', page: 'general' },
  { id: 'about', label: 'About', page: 'general' },
  { id: 'today-brief', label: 'Today & brief', page: 'brief' },
  { id: 'capture-routes', label: 'Capture routes', page: 'tasks' },
  { id: 'labels', label: 'Labels', page: 'tasks' },
  { id: 'reminders', label: 'Reminders', page: 'tasks', requires: 'reminders', standalone: true },
  { id: 'integrations', label: 'API keys', page: 'connections' },
  { id: 'obsidian', label: 'Obsidian', page: 'connections' },
  { id: 'todoist-sync', label: 'Todoist sync', page: 'connections' },
  { id: 'calendars', label: 'Calendars', page: 'connections' },
  { id: 'google-calendar', label: 'Phone alerts', page: 'connections', requires: 'googleCalendar', standalone: true },
  { id: 'sync', label: 'Sync', page: 'data' },
  { id: 'backups', label: 'Backups', page: 'data', requires: 'backup', standalone: true },
  { id: 'maintenance', label: 'Maintenance', page: 'data' },
]

/** Sections the current provider can actually render, in page order. */
export function visibleSections(
  caps: Record<SettingsCapability, boolean>,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): SettingsSection[] {
  return sections.filter((s) => !s.requires || caps[s.requires])
}

/** Pages holding at least one of `sections`, in rail order. */
export function visiblePages(
  sections: readonly SettingsSection[],
  pages: readonly SettingsPage[] = SETTINGS_PAGES,
): SettingsPage[] {
  const used = new Set(sections.map((s) => s.page))
  return pages.filter((p) => used.has(p.id))
}

/** The given sections that live on `page`, order kept. */
export function sectionsOnPage(sections: readonly SettingsSection[], page: SettingsPageId): SettingsSection[] {
  return sections.filter((s) => s.page === page)
}

/** The page to show: `requested` while it is visible, otherwise the first
 *  visible page (a remembered page can disappear, e.g. an empty slot). */
export function resolveSettingsPage(requested: SettingsPageId, pages: readonly SettingsPage[]): SettingsPageId | null {
  if (pages.some((p) => p.id === requested)) return requested
  return pages[0]?.id ?? null
}

/** Where a deep link to `sectionId` lands. Unknown ids open the default page. */
export function settingsTarget(
  sectionId: string,
  sections: readonly SettingsSection[] = SETTINGS_SECTIONS,
): { page: SettingsPageId; section: string | null } {
  const hit = sections.find((s) => s.id === sectionId)
  return hit ? { page: hit.page, section: hit.id } : { page: DEFAULT_SETTINGS_PAGE, section: null }
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
