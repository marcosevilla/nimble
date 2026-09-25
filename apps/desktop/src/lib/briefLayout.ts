// Pure helpers for the brief's module layout and settings (addendum §1–§2).
// Plain TS (type-only imports) so node tests import it directly.
import type { BriefLayoutEntry, BriefSettings, BriefSettingsPatch } from '@nimble/types'

/** The phase-1 boxes: a brief with no readable layout (the web without a
 *  synced row, or a malformed one) renders these. */
export const FALLBACK_LAYOUT: BriefLayoutEntry[] = ['schedule', 'priorities', 'due_today', 'still_open', 'vault'].map(
  (id) => ({ id, enabled: true, config: {} }),
)

/** A stored `layout_json`: phase-1 rows hold module ids, phase-2 rows the
 *  entries used that morning. Duplicates keep the first; junk items drop. */
export function normalizeLayout(layout: unknown): BriefLayoutEntry[] {
  if (!Array.isArray(layout)) return FALLBACK_LAYOUT
  const out: BriefLayoutEntry[] = []
  for (const item of layout) {
    if (typeof item === 'string') {
      if (!out.some((x) => x.id === item)) out.push({ id: item, enabled: true, config: {} })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const raw = item as { id?: unknown; enabled?: unknown; config?: unknown }
    if (typeof raw.id !== 'string' || out.some((x) => x.id === raw.id)) continue
    const config = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? (raw.config as Record<string, unknown>) : {}
    out.push({ id: raw.id, enabled: raw.enabled !== false, config })
  }
  return out
}

/** A module's option, or `fallback` when missing or of the wrong type. */
export function configValue<T extends boolean | number | string>(
  config: Record<string, unknown> | undefined,
  key: string,
  fallback: T,
): T {
  const v = config?.[key]
  return typeof v === typeof fallback ? (v as T) : fallback
}

export function setModuleConfig(entries: BriefLayoutEntry[], id: string, patch: Record<string, unknown>): BriefLayoutEntry[] {
  return entries.map((x) => (x.id === id ? { ...x, config: { ...x.config, ...patch } } : x))
}

export function setModuleEnabled(entries: BriefLayoutEntry[], id: string, enabled: boolean): BriefLayoutEntry[] {
  return entries.map((x) => (x.id === id ? { ...x, enabled } : x))
}

/** The store's optimistic merge; Rust's answer replaces it when the save lands. */
export function applySettingsPatch(settings: BriefSettings, patch: BriefSettingsPatch): BriefSettings {
  const next: BriefSettings = { ...settings }
  if (patch.time !== undefined) next.time = patch.time
  if (patch.location !== undefined) next.location = patch.location
  if (patch.modules !== undefined) next.modules = patch.modules
  if (patch.model !== undefined) next.model = patch.model
  if (patch.effort !== undefined) next.effort = patch.effort
  if (patch.goals !== undefined) next.goals = { ...settings.goals, ...patch.goals }
  return next
}

/** Where each enabled module renders. Expanded: `slot: 'header'` modules
 *  (the weather chip) go in the page header, the rest are boxes. Compact:
 *  every module with a Strip collapses into the one-row strip, header ones
 *  included (UX checkpoint 1); the rest stay boxes. */
export function arrangeBrief(
  entries: BriefLayoutEntry[],
  info: (id: string) => { slot?: 'header'; strip: boolean },
  compact: boolean,
): { header: BriefLayoutEntry[]; strip: BriefLayoutEntry[]; body: BriefLayoutEntry[] } {
  const on = entries.filter((x) => x.enabled)
  const isHeader = (x: BriefLayoutEntry) => info(x.id).slot === 'header'
  if (!compact) return { header: on.filter(isHeader), strip: [], body: on.filter((x) => !isHeader(x)) }
  return {
    header: on.filter((x) => isHeader(x) && !info(x.id).strip),
    strip: on.filter((x) => info(x.id).strip),
    body: on.filter((x) => !isHeader(x) && !info(x.id).strip),
  }
}
