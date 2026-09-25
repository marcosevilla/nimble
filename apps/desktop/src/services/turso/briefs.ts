/**
 * Briefs — read path for the web build. Mirrors nimble-core/src/db/briefs.rs
 * (`get_brief`, `list_brief_dates`); the web never writes briefs.
 */
import type { Brief, BriefItem } from '@nimble/types'
import { briefItemFromRow } from '@/lib/briefItems'
import { query, str, strOrNull, num, numOrNull, text, type Row } from './client'

function toBrief(row: Row): Brief {
  return {
    date: str(row, 'date'),
    version: num(row, 'version'),
    status: str(row, 'status') as Brief['status'],
    source: str(row, 'source') as Brief['source'],
    layout: JSON.parse(str(row, 'layout_json')),
    snapshot: JSON.parse(str(row, 'snapshot_json')),
    snapshot_schema: num(row, 'snapshot_schema'),
    notes: null,
    // `SELECT *`: a remote that hasn't run the v26 gate yet has none of these.
    model: strOrNull(row, 'model'),
    input_tokens: numOrNull(row, 'input_tokens'),
    output_tokens: numOrNull(row, 'output_tokens'),
    error_code: strOrNull(row, 'error_code'),
    composed_at: strOrNull(row, 'composed_at'),
    compose_attempts: numOrNull(row, 'compose_attempts') ?? 0,
    generated_at: str(row, 'generated_at'),
    updated_at: str(row, 'updated_at'),
  }
}

/** The day's notes live in their own synced row (`brief_notes`, v24). A
 *  remote the Mac hasn't upgraded yet has no such table: read as none. */
async function getNotes(date: string): Promise<string | null> {
  try {
    const rows = await query('SELECT notes FROM brief_notes WHERE date = ?', [text(date)])
    const notes = rows.length ? strOrNull(rows[0], 'notes') : null
    return notes && notes.trim() ? notes : null
  } catch {
    return null
  }
}

export async function getBrief(date: string): Promise<Brief | null> {
  const rows = await query('SELECT * FROM briefs WHERE date = ?', [text(date)])
  if (!rows.length) return null
  return { ...toBrief(rows[0]), notes: await getNotes(date) }
}

export async function listBriefDates(): Promise<string[]> {
  const rows = await query('SELECT date FROM briefs ORDER BY date DESC')
  return rows.map((r) => str(r, 'date'))
}

/** Mirrors `db::brief_items::list_items`: the brief's current composition
 *  plus anything acted on, each joined with its task. A remote the Mac hasn't
 *  upgraded yet (v26 gate) has no table: read as none. */
export async function listBriefItems(date: string): Promise<BriefItem[]> {
  try {
    const rows = await query(
      `SELECT bi.*, t.status AS t_status, t.completed AS t_completed, t.due_date AS t_due_date,
              t.content AS t_content, t.description AS t_description, t.project_id AS t_project_id
       FROM brief_items bi LEFT JOIN local_tasks t ON t.id = bi.task_id
       LEFT JOIN briefs b ON b.date = bi.date
       WHERE bi.date = ? AND (bi.action_state != 'none' OR bi.composed_at IS b.composed_at)
       ORDER BY CASE bi.kind WHEN 'priority' THEN 0 WHEN 'quick_help' THEN 1 WHEN 'quick_self' THEN 2 ELSE 3 END, bi.position, bi.id`,
      [text(date)],
    )
    return rows.map(briefItemFromRow)
  } catch (e) {
    if (e instanceof Error && /no such (table|column)/i.test(e.message)) return []
    throw e
  }
}
