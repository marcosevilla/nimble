import type { GoalStatus } from '@daily-triage/types'

export const GOAL_STATUSES: { value: GoalStatus; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not started', color: 'text-muted-foreground' },
  { value: 'active', label: 'Active', color: 'text-amber-500' },
  { value: 'paused', label: 'Paused', color: 'text-blue-400' },
  { value: 'achieved', label: 'Achieved', color: 'text-green-500' },
  { value: 'abandoned', label: 'Abandoned', color: 'text-muted-foreground' },
]

export function statusLabel(status: GoalStatus): string {
  return GOAL_STATUSES.find((s) => s.value === status)?.label ?? status
}

export function statusColor(status: GoalStatus): string {
  return GOAL_STATUSES.find((s) => s.value === status)?.color ?? 'text-muted-foreground'
}

export const GOAL_COLORS = [
  '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316',
]
