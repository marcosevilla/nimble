import type { GoalStatus } from '@nimble/types'

export const GOAL_STATUSES: { value: GoalStatus; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not started', color: 'text-muted-foreground' },
  { value: 'active', label: 'Active', color: 'text-status-in-progress' },
  { value: 'paused', label: 'Paused', color: 'text-status-todo' },
  { value: 'achieved', label: 'Achieved', color: 'text-success' },
  { value: 'abandoned', label: 'Abandoned', color: 'text-muted-foreground' },
]

export function statusLabel(status: GoalStatus): string {
  return GOAL_STATUSES.find((s) => s.value === status)?.label ?? status
}

export function statusColor(status: GoalStatus): string {
  return GOAL_STATUSES.find((s) => s.value === status)?.color ?? 'text-muted-foreground'
}

/* User-data swatch palette for goals and habits (stored as hex on the row,
   rendered as a dot) — the same sanctioned-hex class as projectColors.ts. */
export const GOAL_COLORS = [
  '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316',
]
