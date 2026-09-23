/**
 * Pure helpers for the frozen Focus Queue import dialog. The Rust importer
 * owns every decision; these only label user-picked files and summarize a
 * preview for display. Type imports only so node:test can load it directly.
 */
import type { FocusImportPreview } from '@nimble/types'

export type LegacyFileRole = 'state' | 'manual' | 'pending' | 'config'

/** Assign a picked file by its name. `config` is refused by the caller. */
export function legacyFileRole(name: string): LegacyFileRole | null {
  const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (base === 'state.json') return 'state'
  if (base === 'manual.json') return 'manual'
  if (base === 'pending.json') return 'pending'
  if (base === 'config.json') return 'config'
  return null
}

/** Why Import is unavailable for this preview, or null when it can commit. */
export function importBlockedReason(preview: FocusImportPreview): string | null {
  const blocking = preview.issues.filter((i) => i.severity === 'blocking').map((i) => i.message)
  if (preview.blocked || blocking.length > 0) return blocking.join(' ') || 'This preview needs review before importing.'
  if (preview.noop) return 'Nothing new to import. These files match the last import.'
  return null
}

export interface ImportSummary {
  create: number
  includedMs: number
  excludedMs: number
  unresolved: number
  quarantined: number
  pending: number
}

export function importSummary(preview: FocusImportPreview): ImportSummary {
  const sum = (inclusion: string) => preview.contributions
    .filter((c) => c.inclusion === inclusion)
    .reduce((total, c) => total + c.duration_ms, 0)
  return {
    create: preview.tasks.filter((t) => t.action === 'create').length,
    includedMs: sum('included'),
    excludedMs: sum('excluded'),
    unresolved: preview.contributions.filter((c) => c.inclusion === 'unresolved').length,
    quarantined: preview.records.filter((r) => r.status === 'quarantined').length,
    pending: preview.records.filter((r) => r.kind === 'pending').length,
  }
}
