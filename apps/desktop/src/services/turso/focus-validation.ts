import type { SettledFocusReplica } from './focus'

export const safeDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function validRecords(snapshot: SettledFocusReplica): boolean {
  const totals = new Map<string, number>()
  for (const entry of snapshot.queue) {
    if (!record(entry) || typeof entry.task_id !== 'string' || typeof entry.occurrence_id !== 'string'
      || !record(entry.config) || !safeDuration(entry.config.work_ms)
      || !safeDuration(entry.config.break_ms)
      || (entry.config.budget_ms != null && !safeDuration(entry.config.budget_ms))) return false
  }
  for (const occurrence of snapshot.occurrences) {
    if (!record(occurrence) || !safeDuration(occurrence.generation) || occurrence.generation < 1) return false
  }
  for (const session of snapshot.sessions) {
    if (!record(session) || (session.status !== 'paused' && session.status !== 'ended')) return false
    for (const key of ['work_ms', 'break_ms', 'round_work_ms', 'round_break_ms', 'session_revision']) {
      if (!safeDuration(session[key])) return false
    }
    if (!safeDuration(session.round) || session.round < 1 || session.round > 100) return false
    if (!Number.isSafeInteger(session.timezone_offset_minutes)
      || (session.timezone_offset_minutes as number) < -840
      || (session.timezone_offset_minutes as number) > 840) return false
    let config: Record<string, unknown>
    try { config = JSON.parse(session.config_json as string) as Record<string, unknown> } catch { return false }
    if (!record(config) || !safeDuration(config.work_ms) || !safeDuration(config.break_ms)
      || (config.budget_ms != null && !safeDuration(config.budget_ms))) return false
    if (typeof session.occurrence_id !== 'string') return false
    const next = (totals.get(session.occurrence_id) ?? 0) + (session.work_ms as number)
    if (!safeDuration(next)) return false
    totals.set(session.occurrence_id, next)
  }
  for (const imported of snapshot.import_totals) {
    if (!record(imported)) return false
    if (!safeDuration(imported.duration_ms)) return false
    if (imported.occurrence_id != null && typeof imported.occurrence_id !== 'string') return false
    if (typeof imported.occurrence_id === 'string') {
      const next = (totals.get(imported.occurrence_id) ?? 0) + imported.duration_ms
      if (!safeDuration(next)) return false
      totals.set(imported.occurrence_id, next)
    }
  }
  if (!record(snapshot.totals)) return false
  return totals.size === Object.keys(snapshot.totals).length
    && [...totals].every(([key, value]) => safeDuration(snapshot.totals[key]) && snapshot.totals[key] === value)
}
