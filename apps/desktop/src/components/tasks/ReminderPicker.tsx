import { useEffect, useState } from 'react'
import type { LocalTask } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'

export type ReminderTask = Pick<LocalTask, 'id' | 'due_date' | 'due_time' | 'reminder_offset_minutes' | 'google_calendar_enabled'>

/**
 * The reminder form — minutes before the due time (blank = off), the phone
 * alert through Google Calendar, and Save. Rendered inside the task detail's
 * Reminder chip popover (MetadataChips); `onSaved` lets it close.
 */
export function ReminderPicker({ task, onSaved }: { task: ReminderTask; onSaved?: () => void }) {
  const dp = useDataProvider()
  const [offset, setOffset] = useState(task.reminder_offset_minutes?.toString() ?? '')
  const [phone, setPhone] = useState(task.google_calendar_enabled)
  const [connected, setConnected] = useState(false)
  useEffect(() => { if (dp.googleCalendar.supported) void dp.googleCalendar.getStatus().then(s => setConnected(s.connected)).catch(() => {}) }, [dp])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setOffset(task.reminder_offset_minutes?.toString() ?? ''); setPhone(task.google_calendar_enabled) }, [task.id, task.reminder_offset_minutes, task.google_calendar_enabled])
  const timed = !!task.due_date && !!task.due_time
  async function save() {
    const minutes = offset === '' ? null : Number(offset)
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 40320)) { setError('Choose a whole number from 0 to 40320 minutes.'); return }
    setBusy(true); setError('')
    try {
      await dp.tasks.update({ id: task.id, reminderOffsetMinutes: minutes ?? undefined, clearReminder: minutes === null, googleCalendarEnabled: minutes !== null && phone })
      emitTasksChanged()
      onSaved?.()
    } catch { setError('Reminder could not be saved. Check the task time and Google connection, then try again.') }
    finally { setBusy(false) }
  }
  return <div className="flex flex-col gap-2">
    <label htmlFor={`reminder-${task.id}`} className="text-body-strong">Reminder</label>
    {!timed ? <Meta as="p">Set a due date and time to add a reminder.</Meta> : <>
      <div className="flex items-center gap-2">
        <Input id={`reminder-${task.id}`} type="number" min={0} max={40320} step={1} placeholder="Off" value={offset} onChange={e => setOffset(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save() } }} disabled={busy} className="w-20" />
        <Meta>minutes before</Meta>
      </div>
      <Meta as="p">0 means at the task time. Leave minutes blank to turn this reminder off.</Meta>
      <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={phone} disabled={busy || offset === '' || (!connected && !phone)} onChange={e => setPhone(e.target.checked)} />Phone alert through Google Calendar</label>
      {!connected && !phone && <Meta as="p">Connect Google Calendar in Settings first.</Meta>}
      <Button variant="outline" size="sm" className="self-end" disabled={busy} onClick={() => void save()}>Save reminder</Button>
    </>}
    {error && <p role="alert" className="text-body text-destructive">{error}</p>}
  </div>
}
