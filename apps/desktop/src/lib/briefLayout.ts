// Pure helpers for the brief's module layout and settings (addendum §1–§2).
// Plain TS (type-only imports) so node tests import it directly.
import type { BriefGoals, BriefLayoutEntry, BriefLocation, BriefSettings, BriefSettingsPatch } from '@nimble/types'
import { daysOffError } from './momentum.ts'

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
  // Optimistic too, so the first-visit setup trigger can't reopen while
  // Rust's answer is still queued behind another save (Rust's stamp wins).
  if (patch.complete_setup && !next.setup_completed_at) next.setup_completed_at = new Date().toISOString()
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

export function moveEntry(entries: BriefLayoutEntry[], index: number, direction: 'up' | 'down'): BriefLayoutEntry[] {
  const to = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= entries.length || to < 0 || to >= entries.length) return entries
  const next = entries.slice()
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

export function reorderEntries(entries: BriefLayoutEntry[], activeId: string, overId: string): BriefLayoutEntry[] {
  const from = entries.findIndex((x) => x.id === activeId)
  const to = entries.findIndex((x) => x.id === overId)
  if (from < 0 || to < 0 || from === to) return entries
  const next = entries.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export type BoxRowIntent = { kind: 'focus'; index: number } | { kind: 'move'; direction: 'up' | 'down' }

/** Keys on a focused Boxes row. Only plain arrows/Home/End and ⌥↑/⌥↓. */
export function boxRowKey(
  key: string,
  mods: { alt?: boolean; meta?: boolean; ctrl?: boolean; shift?: boolean },
  index: number,
  length: number,
): BoxRowIntent | null {
  if (length <= 0 || index < 0 || index >= length || mods.meta || mods.ctrl || mods.shift) return null
  if (mods.alt) {
    if (key === 'ArrowUp') return index > 0 ? { kind: 'move', direction: 'up' } : null
    if (key === 'ArrowDown') return index < length - 1 ? { kind: 'move', direction: 'down' } : null
    return null
  }
  if (key === 'ArrowUp') return { kind: 'focus', index: Math.max(0, index - 1) }
  if (key === 'ArrowDown') return { kind: 'focus', index: Math.min(length - 1, index + 1) }
  if (key === 'Home') return { kind: 'focus', index: 0 }
  if (key === 'End') return { kind: 'focus', index: length - 1 }
  return null
}

export type PresetId = 'focused' | 'full' | 'minimal'

/** Setup step 1 (base §3.4; UX checkpoint 4). Presets only toggle; the
 *  order stays the user's. Phase 3 appends 'quick_wins' to Focused; Momentum
 *  (on by default, addendum A5) is in Focused too. */
export const PRESETS: { id: PresetId; name: string; description: string; enabled: string[] | 'all' }[] = [
  { id: 'focused', name: 'Focused', description: 'Your schedule, top priorities and what’s due today.', enabled: ['weather', 'schedule', 'priorities', 'due_today', 'vault', 'momentum'] },
  { id: 'full', name: 'Full', description: 'Every box, including habits and notes.', enabled: 'all' },
  { id: 'minimal', name: 'Minimal', description: 'Your schedule and what’s due today. No AI.', enabled: ['weather', 'schedule', 'due_today', 'vault'] },
]

export function applyPreset(entries: BriefLayoutEntry[], id: PresetId): BriefLayoutEntry[] {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return entries
  return entries.map((x) => ({ ...x, enabled: preset.enabled === 'all' || preset.enabled.includes(x.id) }))
}

export interface SetupDraft {
  preset: PresetId | null
  time: string
  location: BriefLocation | null
  modules: BriefLayoutEntry[]
  goals: BriefGoals
}

export function draftFrom(s: BriefSettings): SetupDraft {
  return {
    preset: null,
    time: s.time,
    location: s.location,
    modules: s.modules.map((x) => ({ ...x, config: { ...x.config } })),
    goals: { daily: s.goals.daily, weekly: s.goals.weekly, days_off: [...s.goals.days_off] },
  }
}

/** Finish (and Skip): every setup key in one save (addendum §3). */
export function setupPatch(d: SetupDraft): BriefSettingsPatch {
  // All seven days off is refused by Rust (`brief::settings`), which would fail
  // the whole save — so Finish later / Skip drops just that value and the
  // stored days off stay.
  const goals: BriefSettingsPatch['goals'] = daysOffError(d.goals.days_off)
    ? { daily: d.goals.daily, weekly: d.goals.weekly }
    : { daily: d.goals.daily, weekly: d.goals.weekly, days_off: d.goals.days_off }
  return {
    time: d.time,
    location: d.location,
    modules: d.modules,
    goals,
    complete_setup: true,
  }
}

/** A goal field's text as a whole number from 1 to `max`, else null (the
 *  field keeps the text and shows a hint; nothing is dropped silently). */
export function parseGoal(text: string, max: number): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= max ? n : null
}
