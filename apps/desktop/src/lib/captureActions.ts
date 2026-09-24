/* Capture writes that may carry a parsed date. There's no Rust change: the
   task is made by the existing call (route / convert) with its full,
   unstripped text, then reworded + dated with a single tasks.update. If that
   update throws, the task keeps its original words — never partially
   applied. The update already announces nimble-data-changed, so every
   window (the capture strip included) refreshes.

   Offer keepAsText only while the undo toast is showing — it restores
   unconditionally, and clearing the due date also clears its reminder and
   phone alert.

   Plain TS — tests/captureActions.test.mjs imports it with a fake provider. */
import type { Capture, CaptureRoute, DataProvider, LocalTask, RouteCaptureResult } from '@nimble/types'
import { parseCaptureDate, type ParsedCaptureDate } from './captureDate.ts'

export type CaptureDp = Pick<DataProvider, 'captureRoutes' | 'captures' | 'tasks'>

export function dueFields(date: ParsedCaptureDate): { dueDate: string; dueTime?: string } {
  return date.dueTime ? { dueDate: date.dueDate, dueTime: date.dueTime } : { dueDate: date.dueDate }
}

/** The routed-capture toast copy, shared by every surface that calls
 *  `routeWithDate` (Inbox, Command Bar, the capture strip). `neutral` (the
 *  plain `toast()`, not `toast.success`) is deliberate for the dating
 *  failure — the save itself worked, only the date didn't stick. */
export function routedToastMessage(
  label: string,
  out: { dateSet: boolean; dateFailed: boolean },
  date: ParsedCaptureDate | null,
): { kind: 'success' | 'neutral'; text: string } {
  if (out.dateSet && date) return { kind: 'success', text: `Saved to ${label} · due ${date.label}` }
  if (out.dateFailed) return { kind: 'neutral', text: `Saved to ${label}. The date didn't stick. Set it on the task.` }
  return { kind: 'success', text: `Saved to ${label}` }
}

/** Route a capture with its full, unstripped text. A task route with a date
 *  follows with one update that both rewords (strips the date words) and
 *  dates the task; if that throws, the task is left exactly as routed —
 *  original words, undated — and the caller is told dating failed. */
export async function routeWithDate(
  dp: CaptureDp,
  route: CaptureRoute,
  content: string,
  date: ParsedCaptureDate | null,
): Promise<{ result: RouteCaptureResult; dateSet: boolean; dateFailed: boolean }> {
  const result = await dp.captureRoutes.route(route.prefix, content)
  const dated = route.target_type === 'task' && date !== null && result.target_type === 'task'
  if (!dated) return { result, dateSet: false, dateFailed: false }
  try {
    await dp.tasks.update({ id: result.created_id, content: date.title, ...dueFields(date) })
    return { result, dateSet: true, dateFailed: false }
  } catch {
    return { result, dateSet: false, dateFailed: true }
  }
}

/** Convert a note to a task; if its text holds a date, reword + date it in
 *  one update and hand back the dated task plus an undo. Offer keepAsText
 *  only while the undo toast is showing — it restores unconditionally, and
 *  clearing the due date also clears its reminder and phone alert. */
export async function convertWithDate(
  dp: CaptureDp,
  capture: Pick<Capture, 'id' | 'content'>,
  ref: Date,
): Promise<{ task: LocalTask; date: ParsedCaptureDate | null; keepAsText: (() => Promise<void>) | null }> {
  const task = await dp.captures.convertToTask(capture.id)
  const date = parseCaptureDate(capture.content, ref)
  if (!date) return { task, date: null, keepAsText: null }
  let dated: LocalTask
  try {
    dated = await dp.tasks.update({ id: task.id, content: date.title, ...dueFields(date) })
  } catch {
    return { task, date: null, keepAsText: null }
  }
  const keepAsText = async () => {
    await dp.tasks.update({
      id: task.id,
      content: capture.content,
      clearDueDate: true,
      ...(date.dueTime ? { clearDueTime: true } : {}),
    })
  }
  return { task: dated, date, keepAsText }
}
