import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label, Meta } from '@/components/shared/typography'
import { formatDurationMs } from '@/lib/focusModel'
import { queueBlockedReason } from '@/lib/focusQueueIntents'
import type { FocusAction, FocusCapabilities, FocusHistoryRow } from '@nimble/types'

interface FocusCompletedTrayProps {
  /** Completed, not-yet-archived tray rows (title snapshot + measured time). */
  rows: FocusHistoryRow[]
  capabilities: FocusCapabilities | null
  onAction: (action: FocusAction) => Promise<unknown>
}

/**
 * Completed tray under Up next: struck-through title with spent time, and
 * Show/Hide/Clear. Clear archives the tray entries — the task ledger and
 * recorded time are kept.
 */
export function FocusCompletedTray({ rows, capabilities, onAction }: FocusCompletedTrayProps) {
  const [show, setShow] = useState(true)
  if (rows.length === 0) return null
  const blocked = queueBlockedReason(capabilities)

  return (
    <section aria-label="Completed">
      <div className="flex items-center justify-between pt-3 pr-2.5 pb-1 pl-4">
        <Label>{`${rows.length} done`}</Label>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" aria-expanded={show} onClick={() => setShow((v) => !v)}>
            {show ? 'Hide' : 'Show'}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={blocked != null}
            title={blocked ?? 'Clear from this tray (history is kept)'}
            onClick={() => void onAction({ kind: 'archive_history', occurrence_ids: rows.map((r) => r.occurrence_id) })}
          >
            Clear
          </Button>
        </div>
      </div>
      {show && (
        <ul>
          {rows.map((row) => (
            <li key={row.occurrence_id} className="flex min-w-0 items-center gap-2.5 py-1.5 pr-4 pl-5">
              <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="size-2.5" strokeWidth={3} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-muted-foreground line-through">{row.title}</span>
              {row.total_ms > 0 && <Meta className="shrink-0">{formatDurationMs(row.total_ms)}</Meta>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
