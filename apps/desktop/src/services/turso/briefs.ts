/**
 * Briefs — read path for the web build. Mirrors nimble-core/src/db/briefs.rs
 * (`get_brief`, `list_brief_dates`); the web never writes briefs.
 */
import type { Brief } from '@nimble/types'
import { query, str, strOrNull, num, text, type Row } from './client'

const COLS = 'date, version, status, source, layout_json, snapshot_json, snapshot_schema, generated_at, updated_at'

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
  const rows = await query(`SELECT ${COLS} FROM briefs WHERE date = ?`, [text(date)])
  if (!rows.length) return null
  return { ...toBrief(rows[0]), notes: await getNotes(date) }
}

export async function listBriefDates(): Promise<string[]> {
  const rows = await query('SELECT date FROM briefs ORDER BY date DESC')
  return rows.map((r) => str(r, 'date'))
}
