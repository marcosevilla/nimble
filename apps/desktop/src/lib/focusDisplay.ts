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
  /** The authoritative anchor the memo was last advanced from. */
  baseMs: number
  checkpointMs: number | null
}

/** Rounding slack when deciding whether a new snapshot continues the shown stretch. */
export const DISPLAY_CONTINUITY_SLACK_MS = 1_000

/** `checkpoint_at` as epoch ms, or null when absent/unparseable. */
export function checkpointMs(snapshot: FocusSnapshot | null): number | null {
  if (!snapshot?.checkpoint_at) return null
  const ms = Date.parse(snapshot.checkpoint_at)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Does the new authoritative anchor continue the stretch the memo was shown
 * from? A heartbeat settles exactly through its new checkpoint, so the
 * settled base grows by the checkpoint delta. A gap-pause, owner stall or
 * resume moves the checkpoint without that credit: the memo then holds
 * never-credited time and must be dropped.
 */
function continuesStretch(prev: DisplayMemo, baseMs: number, cp: number | null): boolean {
  if (prev.checkpointMs === cp) return baseMs === prev.baseMs
  if (prev.checkpointMs == null || cp == null || cp < prev.checkpointMs) return false
  return baseMs + DISPLAY_CONTINUITY_SLACK_MS >= prev.baseMs + (cp - prev.checkpointMs)
}

/**
 * Advance the displayed total. Within one uninterrupted running stretch it
 * never steps backwards (heartbeat rounding). It resets to the authoritative
 * value when nothing runs (null key -> null memo), when the key changes
 * (phase/round/session/owner) and when a new snapshot's settled total did
 * not credit the time the memo showed (gap-pause settle, resume).
 */
export function nextDisplayTotal(
  prev: DisplayMemo | null,
  key: string | null,
  baseMs: number,
  extraMs: number,
  cp: number | null,
): DisplayMemo | null {
  if (key == null) return null
  const candidate = baseMs + extraMs
  const hold = prev != null && prev.key === key && continuesStretch(prev, baseMs, cp)
  return { key, total: hold ? Math.max(prev.total, candidate) : candidate, baseMs, checkpointMs: cp }
}

/** Extra ms to add on top of the settled base for rendering. */
export function displayExtraFrom(memo: DisplayMemo | null, key: string | null, baseMs: number): number {
  if (key == null || !memo || memo.key !== key) return 0
  return Math.max(0, memo.total - baseMs)
}
