import { useCallback, useEffect, useState } from 'react'
import type { ReminderStatus } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Meta, SectionTitle } from '@/components/shared/typography'

export function ReminderSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<ReminderStatus | null>(null)
  const [timezone, setTimezone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try { const next = await dp.reminders.getStatus(); setStatus(next); setTimezone(next.timezone) }
    catch { setError('Reminder settings could not load. Try again.') }
  }, [dp])
  useEffect(() => { if (dp.reminders.supported) void refresh() }, [dp, refresh])
  if (!dp.reminders.supported) return null
  async function saveTimezone() {
    setBusy(true); setError('')
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
      await dp.settings.set('reminder_timezone', timezone)
      await refresh()
    } catch { setError('Enter a valid timezone, such as America/Los_Angeles.') }
    finally { setBusy(false) }
  }
  return <section id="reminders" aria-label="Reminders" className="space-y-4 border-t border-border pt-6">
    <SectionTitle size="lg">Reminders</SectionTitle>
    <Meta as="p">Alerts appear while Nimble is open. Missed reminders stay on Today for you to review.</Meta>
    {error && <p role="alert" className="text-body text-destructive">{error}</p>}
    <Meta as="p">Mac notifications: {status?.permission === 'granted' ? 'Enabled' : status?.permission === 'denied' ? 'Disabled in System Settings → Notifications → Nimble' : 'Not enabled yet'}</Meta>
    <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { setStatus(await dp.reminders.requestPermission()) } catch { setError('Permission could not be requested. Check System Settings → Notifications.') }
      finally { setBusy(false) }
    }}>Enable Mac notifications</Button>
    <form className="space-y-2" onSubmit={e => { e.preventDefault(); void saveTimezone() }}>
      <label htmlFor="reminder-zone" className="text-body">Reminder timezone</label>
      <div className="flex gap-2"><Input id="reminder-zone" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="America/Los_Angeles" disabled={busy} />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !timezone}>Save timezone</Button></div>
      <Meta as="p">Kept when you travel. Changing this timezone changes when your timed reminders fire.</Meta>
    </form>
  </section>
}
