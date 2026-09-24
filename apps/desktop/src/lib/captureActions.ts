/* Capture writes that may carry a parsed date. There's no Rust change: the
   task is made by the existing call (route / convert), then dated with
   tasks.update. The update already announces nimble-data-changed, so
   every window (the capture strip included) refreshes.

   Plain TS — tests/captureActions.test.mjs imports it with a fake provider. */
import type { Capture, CaptureRoute, DataProvider, LocalTask, RouteCaptureResult } from '@nimble/types'
import { parseCaptureDate, type ParsedCaptureDate } from './captureDate.ts'

export type CaptureDp = Pick<DataProvider, 'captureRoutes' | 'captures' | 'tasks'>

export function dueFields(date: ParsedCaptureDate): { dueDate: string; dueTime?: string } {
  return date.dueTime ? { dueDate: date.dueDate, dueTime: date.dueTime } : { dueDate: date.dueDate }
}

/** Route a capture. A task route with a date gets the stripped title, then
 *  the date. If dating fails, the task still exists (undated) and the caller
 *  says so. */
export async function routeWithDate(
  dp: CaptureDp,
  route: CaptureRoute,
  content: string,
  date: ParsedCaptureDate | null,
): Promise<{ result: RouteCaptureResult; dateSet: boolean; dateFailed: boolean }> {
  const dated = route.target_type === 'task' && date !== null
  const result = await dp.captureRoutes.route(route.prefix, dated ? date.title : content)
  if (!dated || result.target_type !== 'task') return { result, dateSet: false, dateFailed: false }
  try {
    await dp.tasks.update({ id: result.created_id, ...dueFields(date) })
    return { result, dateSet: true, dateFailed: false }
  } catch {
    return { result, dateSet: false, dateFailed: true }
  }
}

/** Convert a note to a task; if its text holds a date, apply it and hand
 *  back an undo that restores the words. */
export async function convertWithDate(
  dp: CaptureDp,
  capture: Pick<Capture, 'id' | 'content'>,
  ref: Date,
): Promise<{ task: LocalTask; date: ParsedCaptureDate | null; keepAsText: (() => Promise<void>) | null }> {
  const task = await dp.captures.convertToTask(capture.id)
  const date = parseCaptureDate(capture.content, ref)
  if (!date) return { task, date: null, keepAsText: null }
  try {
    await dp.tasks.update({ id: task.id, content: date.title, ...dueFields(date) })
  } catch {
    return { task, date: null, keepAsText: null }
  }
  const keepAsText = async () => {
    await dp.tasks.update({ id: task.id, content: capture.content, clearDueDate: true, clearDueTime: true })
  }
  return { task, date, keepAsText }
}
