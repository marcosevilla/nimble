/**
 * Quick wins actions (addendum §5, A4). Both are additive and user-started:
 * Break it down adds subtasks (Undo deletes exactly those), Copy for Claude
 * puts the task's focus prompt on the clipboard. Dependencies are injected so
 * node tests run without React or Tauri.
 */
import type { BriefItem, BriefItemActionState, FocusCapabilities, FocusSnapshot, LocalTask, Project } from '@nimble/types'
import { buildFocusPrompt, copyFocusPrompt, type CopyResult } from './focusPrompt.ts'

export const BREAKDOWN_UNDO_MS = 10_000
export const COPIED_MESSAGE = 'Copied. Paste into Claude Code.'
const GONE = 'This task is no longer available.'

type SetItemState = (id: string, state: BriefItemActionState, actionKind: string | null, producedRef: string | null) => Promise<unknown>

export interface BreakDownDeps {
  breakDown: (content: string, description?: string) => Promise<string[]>
  createSubtask: (opts: { content: string; parentId: string; projectId: string }) => Promise<{ id: string }>
  setItemState: SetItemState
}

/** The Undo toast's message. */
export function breakDownMessage(n: number): string {
  return n === 1 ? 'Added 1 subtask' : `Added ${n} subtasks`
}

/** The row's quiet line after Break it down, until Undo. */
export function subtasksAddedLabel(n: number): string {
  return n === 1 ? '1 subtask added' : `${n} subtasks added`
}

/** Returns the ids of the subtasks it created (empty = nothing changed). */
export async function breakDownItem(deps: BreakDownDeps, item: BriefItem): Promise<string[]> {
  const task = item.task
  const parentId = item.task_id
  if (!task || !parentId) throw new Error(GONE)
  const titles = (await deps.breakDown(task.content, task.description ?? undefined)).map((t) => t.trim()).filter(Boolean)
  const created: string[] = []
  for (const content of titles) {
    try {
      created.push((await deps.createSubtask({ content, parentId, projectId: task.project_id })).id)
    } catch {
      // Same as the task detail breakdown: one failed row doesn't stop the rest.
    }
  }
  if (created.length > 0) await deps.setItemState(item.id, 'produced', 'break_down', JSON.stringify(created))
  return created
}

export interface UndoDeps {
  deleteTask: (id: string) => Promise<unknown>
  setItemState: SetItemState
}

/** Deletes exactly the subtasks Break it down created; returns how many failed. */
export async function undoBreakDown(deps: UndoDeps, itemId: string, created: string[]): Promise<number> {
  let failed = 0
  for (const id of created) {
    try {
      await deps.deleteTask(id)
    } catch {
      failed += 1
    }
  }
  await deps.setItemState(itemId, 'none', null, null)
  return failed
}

export interface CopyDeps {
  listTasks: () => Promise<LocalTask[]>
  listProjects: () => Promise<Pick<Project, 'id' | 'name'>[]>
  focusSnapshot: () => Promise<FocusSnapshot>
  focusCapabilities: () => Promise<FocusCapabilities | null>
  write: ((text: string) => Promise<void>) | undefined
}

export async function copyItemForClaude(deps: CopyDeps, taskId: string): Promise<CopyResult> {
  const tasks = await deps.listTasks()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, text: '', message: GONE }
  const children = tasks.filter((t) => t.parent_id === taskId).sort((a, b) => a.position - b.position)
  const [projects, snapshot, capabilities] = await Promise.all([
    deps.listProjects().catch(() => []),
    deps.focusSnapshot(),
    deps.focusCapabilities().catch(() => null),
  ])
  const text = buildFocusPrompt(task, children, snapshot, {
    projectName: projects.find((p) => p.id === task.project_id)?.name,
    capabilities,
  })
  return copyFocusPrompt(text, deps.write)
}
