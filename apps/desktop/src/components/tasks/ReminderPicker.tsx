import { useEffect, useState } from 'react'
import type { LocalTask } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'

export function ReminderPicker({ task }: { task: LocalTask }) {
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
    } catch { setError('Reminder could not be saved. Check the task time and Google connection, then try again.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Task reminder" className="space-y-2 border-b border-border px-5 py-3">
    <label htmlFor={`reminder-${task.id}`} className="text-body font-medium">Reminder</label>
    {!timed ? <Meta as="p">Set a due date and time to add a reminder.</Meta> : <>
      <div className="flex items-center gap-2">
        <Input id={`reminder-${task.id}`} type="number" min={0} max={40320} step={1} placeholder="Off" value={offset} onChange={e => setOffset(e.target.value)} disabled={busy} className="w-24" />
        <Meta>minutes before · 0 means at the task time</Meta>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void save()}>Save reminder</Button>
      </div>
      <label className="flex gap-2 items-center text-body"><input type="checkbox" checked={phone} disabled={busy || offset === '' || (!connected && !phone)} onChange={e => setPhone(e.target.checked)} />Phone alert through Google Calendar</label>
      <Meta as="p">Connect Google Calendar in Settings first. Leave minutes blank to turn this reminder off.</Meta>
    </>}
    {error && <p role="alert" className="text-body text-destructive">{error}</p>}
  </section>
}
