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
