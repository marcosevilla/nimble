import type { FocusEntry } from '@nimble/types'
import { query, str, text, TursoError } from './client'

export interface SettledFocusReplica {
  version: 1
  writer_device_id: string
  owner_epoch: string
  revision: number
  queue_revision: number
  queue: FocusEntry[]
  selected_occurrence_id: string | null
  occurrences: Array<{ id: string; title_snapshot: string; [key: string]: unknown }>
  sessions: Array<{ status: string; [key: string]: unknown }>
  import_totals: Array<{ id: string; duration_ms: number; source_kind: string; [key: string]: unknown }>
  totals: Record<string, number>
  as_of: string
}

export interface WebFocusQueueEntry {
  entry: FocusEntry
  title: string
  task_available: boolean
  availability_label: string | null
  actionable: false
}

export interface WebFocusReplica {
  snapshot: SettledFocusReplica
  queue: WebFocusQueueEntry[]
  as_of: string
  replica: true
}

/** Read the one atomic remote projection; missing task rows remain visible. */
export async function readFocusReplica(): Promise<WebFocusReplica | null> {
  const rows = await query("SELECT payload_json FROM focus_replica WHERE id='current'")
  if (rows.length === 0) return null
  let snapshot: SettledFocusReplica
  try {
    snapshot = JSON.parse(str(rows[0], 'payload_json')) as SettledFocusReplica
  } catch {
    throw new TursoError('Invalid settled focus replica')
  }
  if (snapshot.version !== 1 || !Number.isSafeInteger(snapshot.revision)
    || !Number.isSafeInteger(snapshot.queue_revision) || !Array.isArray(snapshot.queue)
    || !Array.isArray(snapshot.occurrences) || !Array.isArray(snapshot.sessions)
    || !Array.isArray(snapshot.import_totals)
    || snapshot.sessions.some((session) => session.status === 'running')
    || typeof snapshot.as_of !== 'string') {
    throw new TursoError('Invalid settled focus replica')
  }
  const ids = [...new Set(snapshot.queue.map((entry) => entry.task_id))]
  const taskRows = ids.length > 0
    ? await query(`SELECT id,content FROM local_tasks WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids.map(text))
    : []
  const titles = new Map(taskRows.map((row) => [str(row, 'id'), str(row, 'content')]))
  const historical = new Map(snapshot.occurrences.map((occurrence) =>
    [occurrence.id, occurrence.title_snapshot]))
  return {
    snapshot,
    queue: snapshot.queue.map((entry) => ({
      entry,
      title: titles.get(entry.task_id)
        ?? historical.get(entry.occurrence_id)
        ?? 'Task unavailable; sync pending',
      task_available: titles.has(entry.task_id),
      availability_label: titles.has(entry.task_id) ? null : 'Task unavailable; sync pending',
      actionable: false,
    })),
    as_of: snapshot.as_of,
    replica: true,
  }
}
