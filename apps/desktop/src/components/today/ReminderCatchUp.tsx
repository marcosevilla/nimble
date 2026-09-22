import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ReminderCatchUpItem } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { useDetailStore } from '@/stores/detailStore'
import { useDataVersion } from '@/hooks/useDataVersion'
import { formatReminderTime } from '@/lib/reminderTime'
import { Button } from '@/components/ui/button'
import { Meta, SectionTitle } from '@/components/shared/typography'

const UNDO_WINDOW_MS = 5_000

/**
 * Reminders that fired while the app was closed. Quiet row group below the
 * page header: the rows are the signal, nothing here performs urgency.
 * Dismiss is optimistic — the row leaves at once, the acknowledge fires
 * after a 5 s Undo window.
 */
export function ReminderCatchUp() {
  const dp = useDataProvider()
  const version = useDataVersion('tasks')
  const [items, setItems] = useState<ReminderCatchUpItem[]>([])
  const [error, setError] = useState('')
  // Keys hidden optimistically (undo pending or acknowledge in flight) so a
  // poll refresh cannot resurrect a row the user just dismissed.
  const hidden = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    try {
      const next = await dp.reminders.listCatchUp()
      setItems(next.filter(i => !hidden.current.has(i.occurrenceKey)))
      setError('')
    } catch { setError('Reminders could not refresh.') }
  }, [dp])

  useEffect(() => {
    if (!dp.reminders.supported) return
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(timer)
  }, [dp, refresh, version])

  if (!dp.reminders.supported || (!items.length && !error)) return null

  function dismiss(keys: string[]) {
    const removed = items.filter(i => keys.includes(i.occurrenceKey))
    for (const key of keys) hidden.current.add(key)
    setItems(prev => prev.filter(i => !keys.includes(i.occurrenceKey)))

    const commit = async () => {
      try {
        for (const key of keys) await dp.reminders.acknowledge(key)
      } catch {
        setError('Some reminders could not be dismissed. Try again.')
      } finally {
        for (const key of keys) hidden.current.delete(key)
        void refresh()
      }
    }
    const timer = setTimeout(() => void commit(), UNDO_WINDOW_MS)

    toast(keys.length === 1 ? 'Reminder dismissed' : `${keys.length} reminders dismissed`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timer)
          for (const key of keys) hidden.current.delete(key)
          setItems(prev => [...removed, ...prev])
          void refresh()
        },
      },
    })
  }

  return (
    <section aria-labelledby="reminders-heading" className="rounded-md bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle as="h2" id="reminders-heading" className="text-body-strong tabular-nums">
          Reminders · {items.length}
        </SectionTitle>
        {items.length > 1 && (
          <button
            type="button"
            onClick={() => dismiss(items.map(i => i.occurrenceKey))}
            className="text-label text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss all
          </button>
        )}
      </div>
      {error && <Meta as="p" className="py-1">{error}</Meta>}
      <ul className="divide-y divide-border/50">
        {items.map(item => (
          <li key={item.occurrenceKey} className="flex items-center gap-3 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-body truncate">{item.title}</p>
              {item.errorCode === 'schedule_needs_attention'
                ? <Meta as="p">No valid time yet — open the task to pick one</Meta>
                : <time dateTime={item.scheduledAt} className="text-meta text-muted-foreground tabular-nums">{formatReminderTime(item.scheduledAt)}</time>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => useDetailStore.getState().openTask(item.taskId)}>View task</Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss([item.occurrenceKey])}>Dismiss</Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
