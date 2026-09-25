/**
 * Pure helpers for the composed brief (phase 3): which state the AI slots are
 * in, the header line, and each box's rows. Plain TS with type-only imports,
 * so node tests import it directly.
 */
import type { Brief, BriefCompose, BriefItem, BriefItemKind, BriefItemTask, Priority } from '@nimble/types'

export const FALLBACK_LINE = 'Sorted by priority. AI unavailable.'
export const MAX_PER_BOX = 3

export type ComposeView = 'pending' | 'ai' | 'fallback' | 'none'

type BriefLike = Pick<Brief, 'status' | 'composed_at'> & { snapshot?: unknown }

/**
 * `pending` (skeletons) only for today's brief on a client that composes,
 * until the composition lands or the first-open call settles. Everything else
 * is composed (`ai` / `fallback`) or `none` (calm empty states) — never an
 * endless skeleton (Review Focus 3).
 */
export function composeView(s: {
  brief: BriefLike | null | undefined
  date: string
  today: string
  supported: boolean
  settled: boolean
}): ComposeView {
  if (s.brief?.composed_at) return s.brief.status === 'fallback' ? 'fallback' : 'ai'
  const live = s.date === s.today && s.supported
  if (s.brief === undefined) return live ? 'pending' : 'none'
  return live && !s.settled ? 'pending' : 'none'
}

function snapshotOf(brief: BriefLike | null | undefined): Record<string, unknown> | null {
  const snapshot = brief?.snapshot
  return snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : null
}

export function composeOf(brief: BriefLike | null | undefined): BriefCompose | null {
  const compose = snapshotOf(brief)?.compose
  return compose && typeof compose === 'object' ? (compose as BriefCompose) : null
}

/** The header line: the fallback notice, the day's summary, or nothing. */
export function summaryLine(brief: BriefLike | null | undefined): string | null {
  if (!brief?.composed_at) return null
  if (brief.status === 'fallback') return FALLBACK_LINE
  const summary = composeOf(brief)?.summary
  return typeof summary === 'string' && summary.trim() ? summary.trim() : null
}

/** Phase-1/2 free-text priorities frozen in the snapshot (past days). */
export function legacyPriorities(brief: BriefLike | null | undefined): Priority[] | null {
  const p = snapshotOf(brief)?.priorities
  return Array.isArray(p) ? (p as Priority[]) : null
}

export function itemsOf(items: BriefItem[] | undefined, kind: BriefItemKind, limit: number = MAX_PER_BOX): BriefItem[] {
  return (items ?? []).filter((i) => i.kind === kind).sort((a, b) => a.position - b.position).slice(0, limit)
}

export function isItemDone(item: BriefItem): boolean {
  return !!item.task && (item.task.completed || item.task.status === 'complete')
}

/** Live rows follow a rename; frozen (past) rows keep the composed title. */
export function itemTitle(item: BriefItem, live: boolean): string {
  return live && item.task ? item.task.content : item.title
}

/** Compact strip: composed priorities first, else the legacy free-text ones. */
export function stripTitles(
  items: BriefItem[] | undefined,
  legacy: { title: string }[] | null | undefined,
): { title: string }[] | null | undefined {
  const rows = itemsOf(items, 'priority')
  return rows.length > 0 ? rows.map((i) => ({ title: itemTitle(i, true) })) : legacy
}

/** Subtask ids a Break it down produced (`produced_ref` is a JSON array). */
export function producedIds(item: BriefItem): string[] {
  if (item.action_state !== 'produced' || !item.produced_ref) return []
  try {
    const parsed: unknown = JSON.parse(item.produced_ref)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** A Turso row from `services/turso/briefs.ts` (`t_*` = the joined task). */
export function briefItemFromRow(row: Record<string, string | null>): BriefItem {
  const req = (k: string): string => {
    const v = row[k]
    if (v == null) throw new Error(`brief_items.${k} missing`)
    return v
  }
  const task: BriefItemTask | null =
    row.t_content != null && row.t_status != null && row.t_project_id != null
      ? {
          status: row.t_status as BriefItemTask['status'],
          completed: row.t_completed === '1',
          due_date: row.t_due_date ?? null,
          content: row.t_content,
          description: row.t_description ?? null,
          project_id: row.t_project_id,
        }
      : null
  return {
    id: req('id'),
    date: req('date'),
    module_id: req('module_id'),
    kind: req('kind') as BriefItemKind,
    title: req('title'),
    body: row.body ?? null,
    task_id: row.task_id ?? null,
    origin: req('origin') as BriefItem['origin'],
    dedupe_key: row.dedupe_key ?? null,
    action_kind: row.action_kind ?? null,
    action_state: req('action_state') as BriefItem['action_state'],
    produced_ref: row.produced_ref ?? null,
    position: Number(row.position ?? 0),
    created_at: req('created_at'),
    updated_at: req('updated_at'),
    composed_at: row.composed_at ?? null,
    task,
  }
}
