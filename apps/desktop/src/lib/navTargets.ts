/* Page ids and where a navigation id lands.

   - PAGE_IDS is the one list of top-level pages (appStore's `Page` type and
     detailStore's per-page state both derive from it).
   - Activity is no longer a page: it is the Settings → Activity sub-page.
     `activity` (the `g s` chord) and the retired page id `session` (still in
     persisted nav orders, old deep links) both resolve there.
   - normalizeNavOrder cleans a persisted sidebar order: unknown or retired
     ids drop out, duplicates collapse, pages added since are appended.

   Plain TS, type-only imports — tests/navTargets.test.mjs imports it directly. */

import type { SettingsPageId } from './settingsSections'

export const PAGE_IDS = ['today', 'tasks', 'inbox', 'docs', 'goals', 'settings'] as const
export type Page = (typeof PAGE_IDS)[number]

/** Pages the left nav shows, in default order (Settings sits in the footer). */
export const DEFAULT_NAV_ORDER = ['today', 'tasks', 'inbox', 'docs', 'goals'] as const satisfies readonly Page[]

export interface NavTarget {
  page: Page
  /** Settings sub-page to show when `page` is `settings`. */
  settingsPage?: SettingsPageId
}

/** Ids that are not pages but still navigate somewhere. */
const REDIRECTS: Record<string, NavTarget> = {
  activity: { page: 'settings', settingsPage: 'activity' },
  // Retired 2026-09-24: the Activity nav page moved into Settings.
  session: { page: 'settings', settingsPage: 'activity' },
}

/** Where `id` lands, or null for an id that goes nowhere. */
export function resolveNavTarget(id: string | null | undefined): NavTarget | null {
  if (!id) return null
  if ((PAGE_IDS as readonly string[]).includes(id)) return { page: id as Page }
  return Object.hasOwn(REDIRECTS, id) ? { ...REDIRECTS[id] } : null
}

/** A persisted nav order made safe to render: only known nav pages, each
 *  once, in the saved order, with any page missing from it appended. Anything
 *  unparseable falls back to the default order. */
export function normalizeNavOrder(saved: unknown, defaults: readonly string[] = DEFAULT_NAV_ORDER): string[] {
  const valid = new Set(defaults)
  const order: string[] = []
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === 'string' && valid.has(id) && !order.includes(id)) order.push(id)
    }
  }
  for (const id of defaults) {
    if (!order.includes(id)) order.push(id)
  }
  return order
}
