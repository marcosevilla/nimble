import type { FocusConfig, FocusEntry, FocusHistoryPage, FocusSession, FocusSnapshot } from '@nimble/types'
import { query, str, text, TursoError } from './client'
import { validRecords, safeDuration, record } from './focus-validation'
import { FocusRequestError } from '../focus-events'

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
  if (!record(snapshot) || snapshot.version !== 1 || !safeDuration(snapshot.revision)
    || !safeDuration(snapshot.queue_revision) || snapshot.queue_revision > snapshot.revision
    || !Array.isArray(snapshot.queue)
    || !Array.isArray(snapshot.occurrences) || !Array.isArray(snapshot.sessions)
    || !Array.isArray(snapshot.import_totals)
    || typeof snapshot.as_of !== 'string' || !validRecords(snapshot)) {
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

/* ------------------------------------------------------------------ */
/* DataProvider.focus reads for the web (settled replica only)         */
/* ------------------------------------------------------------------ */

const noReplica = () => new FocusRequestError('not_found',
  'No settled focus replica has synced from the desktop yet.')

function sessionFor(snapshot: SettledFocusReplica, occurrenceId: string): FocusSession | null {
  // The replica keeps no insertion order, so prefer the highest-revision open
  // session, mirroring the desktop "latest non-ended session" read.
  const candidates = snapshot.sessions
    .filter((s) => s.occurrence_id === occurrenceId && s.status !== 'ended')
    .sort((a, b) => Number(b.session_revision ?? 0) - Number(a.session_revision ?? 0))
  const raw = candidates[0]
  if (!raw) return null
  let config: FocusConfig
  try {
    config = JSON.parse(String(raw.config_json)) as FocusConfig
  } catch {
    throw new TursoError('Invalid settled focus session configuration')
  }
  return {
    id: String(raw.id),
    occurrence_id: occurrenceId,
    // The replica already projects a running session as paused.
    status: raw.status === 'ended' ? 'ended' : 'paused',
    phase: raw.phase as FocusSession['phase'],
    work_ms: Number(raw.work_ms),
    break_ms: Number(raw.break_ms),
    round_work_ms: Number(raw.round_work_ms),
    round: Number(raw.round),
    config,
  }
}

/** Settled FocusSnapshot for web. `replica: true`; nothing here is live. */
export async function readFocusSnapshot(): Promise<FocusSnapshot> {
  const replica = await readFocusReplica()
  if (!replica) throw noReplica()
  const s = replica.snapshot
  const totals: Record<string, number> = {}
  for (const entry of s.queue) totals[entry.occurrence_id] = s.totals[entry.occurrence_id] ?? 0
  const selected = s.selected_occurrence_id
  const session = selected ? sessionFor(s, selected) : null
  const checkpoint = selected
    ? s.sessions.find((x) => x.id === session?.id)?.checkpoint_at
    : null
  return {
    queue_revision: s.queue_revision,
    engine_revision: s.revision,
    owner_epoch: s.owner_epoch,
    // Process generation is local runtime state and is never replicated.
    process_generation: 0,
    writer_device_id: s.writer_device_id,
    queue: s.queue,
    selected_occurrence_id: selected,
    session,
    totals,
    as_of: s.as_of,
    checkpoint_at: typeof checkpoint === 'string' ? checkpoint : null,
    recovery_reason: null,
    replica: true,
  }
}

const PAGE = 50

/** History rows from the settled replica, ordered and paged like the desktop. */
export async function readFocusHistory(opts?: { cursor?: string; task_id?: string }): Promise<FocusHistoryPage> {
  const replica = await readFocusReplica()
  if (!replica) throw noReplica()
  const s = replica.snapshot
  const imported = new Map<string, number>()
  for (const row of s.import_totals) {
    const oid = row.occurrence_id
    if (typeof oid === 'string') imported.set(oid, (imported.get(oid) ?? 0) + row.duration_ms)
  }
  // Mirrors FocusService::history (nimble-core db/focus/engine.rs): ORDER BY
  // COALESCE(completed_at,created_at) DESC, id DESC; the cursor is an
  // occurrence id looked up WITHOUT the task filter, and the next page is
  // every row strictly after its (key, id) position. Both sides compare the
  // RFC 3339/UUID ASCII strings bytewise.
  type Occurrence = SettledFocusReplica['occurrences'][number]
  const sortKey = (o: Occurrence) => String(o.completed_at ?? o.created_at ?? '')
  const after = (o: Occurrence, key: string, id: string) => {
    const k = sortKey(o)
    return k < key || (k === key && o.id < id)
  }
  let rows = s.occurrences
    .filter((o) => !opts?.task_id || o.original_task_id === opts.task_id)
  if (opts?.cursor) {
    const at = s.occurrences.find((o) => o.id === opts.cursor)
    if (!at) throw new FocusRequestError('invalid', 'history cursor missing')
    const key = sortKey(at)
    rows = rows.filter((o) => after(o, key, at.id))
  }
  rows.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b)
    if (ka !== kb) return ka < kb ? 1 : -1
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
  const page = rows.slice(0, PAGE)
  return {
    rows: page.map((o) => {
      const total = s.totals[o.id] ?? 0
      const importedMs = imported.get(o.id) ?? 0
      return {
        occurrence_id: o.id,
        task_id: typeof o.task_id === 'string' ? o.task_id : null,
        title: o.title_snapshot,
        total_ms: total,
        recorded_ms: total - importedMs,
        imported_ms: importedMs,
        completed_at: typeof o.completed_at === 'string' ? o.completed_at : null,
        archived: Number(o.archived ?? 0) !== 0,
      }
    }),
    next_cursor: rows.length > PAGE ? page[page.length - 1].id : null,
  }
}
