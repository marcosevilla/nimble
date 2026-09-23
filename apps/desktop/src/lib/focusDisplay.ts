/**
 * Display-only interpolation of a running focus timer.
 *
 * The engine settles time only at commits and 20-second heartbeats, so a raw
 * snapshot total would jump 20 s at a time. While a session is running (and
 * live timing is on) a surface may render `settled + (now - checkpoint_at)`.
 * The result is ONLY rendered: it is never persisted, never sent and never
 * used to build a command. Every new snapshot is still the authority.
 *
 * Reference time: `snapshot.checkpoint_at`, not `as_of`. Totals are settled
 * exactly through `checkpoint_at`: every settle (heartbeat, command) and
 * every newly opened work/break segment writes it. `as_of` is only when the
 * snapshot was read, so interpolating from it would drop the unsettled span
 * between the last checkpoint and the read (up to one heartbeat), and the
 * timer would visibly jump back.
 *
 * Kept dependency-free (type imports only) so node:test can load it directly.
 */
import type { FocusEntry, FocusSnapshot } from '@nimble/types'

/** Never show more unsettled time than the engine's gap rule could credit. */
export const MAX_DISPLAY_EXTRA_MS = 40_000

/** The running session's displayed quantity identity, or null when nothing ticks. */
export function displayKey(snapshot: FocusSnapshot | null, entry: FocusEntry | null, liveTiming: boolean): string | null {
  const session = snapshot?.session
  if (!liveTiming || !snapshot || !entry || !session) return null
  if (session.status !== 'running' || session.occurrence_id !== entry.occurrence_id) return null
  return `${snapshot.owner_epoch}:${snapshot.process_generation}:${session.id}:${session.phase}:${session.round}`
}

/** The settled value the card shows for this entry (the quantity that ticks). */
export function displayBaseMs(snapshot: FocusSnapshot, entry: FocusEntry): number {
  const session = snapshot.session
  const mine = session && session.occurrence_id === entry.occurrence_id ? session : null
  if (mine && mine.config.mode === 'pomodoro') return mine.phase === 'break' ? mine.break_ms : mine.round_work_ms
  return snapshot.totals[entry.occurrence_id] ?? 0
}

/** Unsettled running time since `checkpoint_at`, clamped to [0, 40 s]. */
export function displayExtraMs(snapshot: FocusSnapshot, key: string | null, nowMs: number): number {
  if (key == null || !snapshot.checkpoint_at) return 0
  const reference = Date.parse(snapshot.checkpoint_at)
  if (!Number.isFinite(reference) || !Number.isFinite(nowMs)) return 0
  return Math.floor(Math.min(Math.max(nowMs - reference, 0), MAX_DISPLAY_EXTRA_MS))
}

export interface DisplayMemo {
  key: string
  /** Last displayed total (settled base + extra) for this key. */
  total: number
}

/**
 * Advance the displayed total without ever going backwards for the same
 * running quantity; a new key (pause, phase/round change, new session)
 * starts fresh.
 */
export function nextDisplayTotal(prev: DisplayMemo | null, key: string, baseMs: number, extraMs: number): DisplayMemo {
  const candidate = baseMs + extraMs
  return { key, total: prev && prev.key === key ? Math.max(prev.total, candidate) : candidate }
}

/** Extra ms to add on top of the settled base for rendering. */
export function displayExtraFrom(memo: DisplayMemo | null, key: string | null, baseMs: number): number {
  if (key == null || !memo || memo.key !== key) return 0
  return Math.max(0, memo.total - baseMs)
}
