import { useCallback, useEffect, useState } from 'react'
import type { GoogleCalendarConflict, GoogleConnectionStatus } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { useDetailStore } from '@/stores/detailStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Meta, SectionTitle } from '@/components/shared/typography'

export function GoogleCalendarSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null)
  const [conflicts, setConflicts] = useState<GoogleCalendarConflict[]>([])
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    const [next, reviews] = await Promise.all([dp.googleCalendar.getStatus(), dp.googleCalendar.listConflicts()])
    setStatus(next); setConflicts(reviews)
  }, [dp])
  useEffect(() => {
    if (!dp.googleCalendar.supported) return
    void refresh().catch(() => setError('Google Calendar status is unavailable.'))
    void dp.settings.get('google_calendar_client_id').then(value => setClientId(value ?? '')).catch(() => {})
    const timer = setInterval(() => void refresh().catch(() => {}), 30_000)
    return () => clearInterval(timer)
  }, [dp, refresh])
  if (!dp.googleCalendar.supported) return null
  async function act(operation: () => Promise<unknown>) {
    setBusy(true); setError('')
    try { await operation(); await refresh(); emitTasksChanged() }
    catch (e) {
      const code = String(e)
      setError(code.includes('setup_needed') ? 'Google connection setup is needed. Enter your Desktop OAuth client ID below.' : code.includes('disabled') ? 'Google connections are disabled in this test build.' : 'This Google Calendar step could not finish. Your Nimble tasks are kept. Try again or reconnect.')
    } finally { setBusy(false) }
  }
  return <section id="google-calendar" aria-label="Google Calendar phone alerts" className="space-y-4 border-t border-border pt-6">
    <SectionTitle>Phone alerts</SectionTitle>
    <Meta as="p">Connect a dedicated Nimble calendar. Turn on phone alerts only for the tasks you choose. Already-published alerts can fire while Nimble is closed; new changes sync while the Mac app is open.</Meta>
    {error && <p className="text-body text-destructive" role="alert">{error}</p>}
    {status?.errorCode && <Meta as="p">The calendar connection needs attention. Try syncing or reconnecting.</Meta>}
    <Meta as="p">{status?.connected ? `Connected to ${status.calendarLabel ?? 'Nimble'}` : 'Not connected'}</Meta>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => dp.googleCalendar.connect())}>{status?.connected ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}</Button>
      {status?.connected && <>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(async () => { const result = await dp.googleCalendar.syncNow(); if (result.errorCode) throw new Error(result.errorCode) })}>Sync now</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => dp.googleCalendar.disconnect())}>Disconnect</Button>
      </>}
    </div>
    {status?.connected && <Meta as="p">Disconnecting leaves the existing calendar and its events in Google.</Meta>}
    <details><summary className="text-body cursor-pointer">Google connection setup</summary>
      <form className="space-y-2 pt-3" onSubmit={e => { e.preventDefault(); void act(() => dp.settings.set('google_calendar_client_id', clientId.trim())) }}>
        <label htmlFor="google-client" className="text-body">Desktop OAuth client ID</label>
        <Input id="google-client" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off" disabled={busy || status?.connected} />
        <Button size="sm" variant="outline" disabled={busy || !clientId.trim() || status?.connected}>Save client ID</Button>
        <Meta as="p">Initial setup uses a Google Cloud Desktop OAuth client with Calendar API enabled. Enter only the client ID here.</Meta>
      </form>
    </details>
    {conflicts.length > 0 && <div className="space-y-3"><SectionTitle>Calendar changes to review</SectionTitle>
      {conflicts.map(conflict => <div key={conflict.taskId} className="rounded-md border border-border p-3 space-y-2">
        <Meta as="p">A task and its calendar event need reconciliation. Open the task before choosing which version to keep.</Meta>
        <div className="flex gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => useDetailStore.getState().openTask(conflict.taskId)}>View task</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => dp.googleCalendar.resolveConflict(conflict.taskId, 'keep_nimble'))}>Keep Nimble</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => dp.googleCalendar.resolveConflict(conflict.taskId, 'use_calendar'))}>Use Calendar</Button>
        </div>
      </div>)}
    </div>}
  </section>
}
