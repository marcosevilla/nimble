/**
 * Task search for the web build — DEGRADED on purpose. Turso has no FTS5
 * index (tasks_fts is device-local), so this is a LIKE scan with the same
 * signature and open-first order as nimble-core/src/db/task_search.rs:
 * every token must appear in the title or description; title-only matches
 * rank first within open/completed. No prefix ranking, no diacritic folding,
 * ASCII-only case folding.
 */
import type { TaskSearchFilters, TaskSearchHit } from '@nimble/types'
import { likeSnippet, searchTokens } from '@/lib/taskSearch'
import { integer, query, str, text, type TursoArg } from './client'
import { SELECT_COLS, toTask } from './tasks'

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function searchTasksLike(input: string, filters: TaskSearchFilters = {}, limit = 50): Promise<TaskSearchHit[]> {
  const tokens = searchTokens(input)
  if (tokens.length === 0) return []
  const where: string[] = []
  const args: TursoArg[] = []
  for (const token of tokens) {
    const pattern = text(`%${escapeLike(token)}%`)
    where.push(`(content LIKE ? ESCAPE '\\' OR COALESCE(description, '') LIKE ? ESCAPE '\\')`)
    args.push(pattern, pattern)
  }
  const status = filters.status ?? 'all'
  if (status === 'open') where.push(`status != 'complete'`)
  if (status === 'completed') where.push(`status = 'complete'`)
  if (filters.project_id) {
    where.push('project_id = ?')
    args.push(text(filters.project_id))
  }
  const labelIds = filters.label_ids ?? []
  if (labelIds.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = local_tasks.id AND tl.label_id IN (${labelIds.map(() => '?').join(', ')}))`)
    for (const id of labelIds) args.push(text(id))
  }
  const titleHasAll = tokens.map(() => `content LIKE ? ESCAPE '\\'`).join(' AND ')
  for (const token of tokens) args.push(text(`%${escapeLike(token)}%`))
  args.push(integer(limit))

  const rows = await query(
    `SELECT ${SELECT_COLS} FROM local_tasks WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN status = 'complete' THEN 1 ELSE 0 END,
              CASE WHEN ${titleHasAll} THEN 0 ELSE 1 END,
              updated_at DESC
     LIMIT ?`,
    args,
  )
  // Labels for the hits only (≤ limit ids), never the whole join table.
  const ids = rows.map((r) => str(r, 'id'))
  const labelRows = ids.length === 0 ? [] : await query(
    `SELECT task_id, label_id FROM task_labels WHERE task_id IN (${ids.map(() => '?').join(', ')}) ORDER BY rowid`,
    ids.map((id) => text(id)),
  )
  const labelsByTask = new Map<string, string[]>()
  for (const row of labelRows) {
    const id = str(row, 'task_id')
    labelsByTask.set(id, [...(labelsByTask.get(id) ?? []), str(row, 'label_id')])
  }
  return rows.map((row) => {
    const task = toTask(row, labelsByTask.get(str(row, 'id')) ?? [])
    const title = task.content.toLowerCase()
    const inTitle = tokens.every((t) => title.includes(t.toLowerCase()))
    return {
      task,
      matched_in: inTitle ? 'title' : 'description',
      snippet: inTitle ? null : likeSnippet(task.description, tokens),
    }
  })
}
