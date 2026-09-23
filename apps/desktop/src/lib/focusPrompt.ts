/**
 * Copy-assistant-context for a focused task. Plain text only: the prompt
 * describes supported routes truthfully and never promises that comments
 * refresh in Nimble. Times come from the provider snapshot (settled totals);
 * nothing here runs a clock.
 */
import type { FocusCapabilities, FocusSnapshot, LocalTask } from '@nimble/types'
import { formatDurationMs } from './focusModel.ts'

const PRIORITY: Record<number, string> = { 1: 'Normal', 2: 'Medium', 3: 'High', 4: 'Urgent' }

export interface FocusPromptContext {
  /** Display name for `task.project_id`, when the caller has it. */
  projectName?: string
  capabilities?: FocusCapabilities | null
}

function timerLines(task: LocalTask, snapshot: FocusSnapshot, caps: FocusCapabilities | null): string[] {
  const entry = snapshot.queue.find((e) => e.task_id === task.id)
  if (!entry) return ['**Timer:** Not in the focus queue.']
  const session = snapshot.session?.occurrence_id === entry.occurrence_id ? snapshot.session : null
  const budget = session?.config.budget_ms ?? entry.config.budget_ms
  const total = snapshot.totals[entry.occurrence_id] ?? 0
  const state = session ? `${session.status} (${session.phase})` : 'not started'
  const settled = caps?.live_timing ? '' : ` (settled as of ${snapshot.as_of})`
  return [
    `**Timer:** ${state}`,
    `**Accumulated work:** ${formatDurationMs(total)}${settled}`,
    `**Budget:** ${budget == null ? 'none (count-up)' : `${formatDurationMs(budget)} timebox`}`,
  ]
}

function routeLines(task: LocalTask, caps: FocusCapabilities | null): string[] {
  const lines = [`Nimble is the source of truth for this task (native ID ${task.id}).`]
  if (task.external_id && task.sync_policy !== 'local_only') {
    const service = task.external_source ?? 'an external service'
    lines.push(
      `It is linked to ${service} task ${task.external_id}. Changes made there reach Nimble only through Nimble's regular sync.`,
      'Task comments are not shown in Nimble — put results in subtasks or the description, or reply here.',
    )
  } else {
    lines.push('It exists only in Nimble, with no external link — reply here and I will add the results myself.')
  }
  if (caps && !caps.queue_write) {
    lines.push(`Focus controls are read-only in this view${caps.reason ? `: ${caps.reason}` : '.'}`)
  }
  return lines
}

export function buildFocusPrompt(
  task: LocalTask,
  children: LocalTask[],
  snapshot: FocusSnapshot,
  context: FocusPromptContext = {},
): string {
  const caps = context.capabilities ?? null
  const project = context.projectName ? `${context.projectName} (${task.project_id})` : task.project_id
  const due = task.due_date ? [task.due_date, task.due_time].filter(Boolean).join(' ') : 'none'
  const subtasks = children.map((c) => `- [${c.completed || c.status === 'complete' ? 'x' : ' '}] ${c.content} (${c.id})`)

  const lines = [
    'Help me with this task from Nimble Focus.',
    '',
    `**Task:** ${task.content}`,
    `**Nimble task ID:** ${task.id}`,
  ]
  if (task.external_id) lines.push(`**External ID:** ${task.external_source ?? 'external'} ${task.external_id}`)
  lines.push(
    `**Project:** ${project}`,
    `**Due:** ${due}`,
    `**Priority:** ${PRIORITY[task.priority] ?? 'Normal'}`,
  )
  if (task.description?.trim()) lines.push(`**Description:** ${task.description.trim()}`)
  lines.push(subtasks.length ? '**Subtasks:**' : '**Subtasks:** none', ...subtasks)
  lines.push(...timerLines(task, snapshot, caps))
  lines.push('', '**How changes reach Nimble:**', ...routeLines(task, caps).map((l) => `- ${l}`))
  lines.push('', '**What I want:** [break this down / gather context / help me start]')
  return lines.join('\n')
}

export type CopyResult = { ok: true } | { ok: false; text: string; message: string }

/**
 * Copy via the given writer (e.g. `navigator.clipboard.writeText`). A
 * failure is reported, never swallowed, and returns the text so the UI can
 * show it for manual copy.
 */
export async function copyFocusPrompt(
  text: string,
  write: ((text: string) => Promise<void>) | undefined,
): Promise<CopyResult> {
  if (!write) return { ok: false, text, message: 'Clipboard is unavailable' }
  try {
    await write(text)
    return { ok: true }
  } catch (error) {
    return { ok: false, text, message: error instanceof Error ? error.message : String(error) }
  }
}
