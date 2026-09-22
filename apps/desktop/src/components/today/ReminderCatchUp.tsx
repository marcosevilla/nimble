import { useCallback, useEffect, useState } from 'react'
import type { ReminderCatchUpItem } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { useDetailStore } from '@/stores/detailStore'
import { useDataVersion } from '@/hooks/useDataVersion'
import { Button } from '@/components/ui/button'
import { Meta, SectionTitle } from '@/components/shared/typography'

export function ReminderCatchUp() {
  const dp = useDataProvider()
  const version = useDataVersion('tasks')
  const [items, setItems] = useState<ReminderCatchUpItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    try { setItems(await dp.reminders.listCatchUp()); setError('') }
    catch { setError('Reminders could not refresh.') }
  }, [dp])
  useEffect(() => {
    if (!dp.reminders.supported) return
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(timer)
  }, [dp, refresh, version])
  if (!dp.reminders.supported || (!items.length && !error)) return null
  async function dismiss(keys: string[]) {
    setBusy(true)
    try { for (const key of keys) await dp.reminders.acknowledge(key); await refresh() }
    catch { setError('Some reminders could not be dismissed. Try again.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Reminders to review" className="m-5 rounded-lg border border-border p-4 space-y-3">
    <SectionTitle>Reminders to review</SectionTitle>
    {error && <p role="alert" className="text-body text-destructive">{error}</p>}
    {items.map(item => <div key={item.occurrenceKey} className="flex items-center gap-3">
      <div className="min-w-0 flex-1"><p className="text-body truncate">{item.title}</p><Meta>{item.errorCode === 'schedule_needs_attention' ? 'This reminder time needs attention. Open the task to choose a valid time.' : new Date(item.scheduledAt).toLocaleString()}</Meta></div>
      <Button size="sm" variant="ghost" onClick={() => useDetailStore.getState().openTask(item.taskId)}>View task</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss([item.occurrenceKey])}>Dismiss</Button>
    </div>)}
    {items.length > 1 && <Button size="sm" variant="outline" disabled={busy} onClick={() => void dismiss(items.map(i => i.occurrenceKey))}>Dismiss all shown</Button>}
  </section>
}
