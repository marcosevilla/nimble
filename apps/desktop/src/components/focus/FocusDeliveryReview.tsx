import { useCallback, useEffect, useState } from 'react'
import type { FocusDeliveryResolution, FocusDeliveryReviewItem } from '@nimble/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Caption, FieldLabel, Label } from '@/components/shared/typography'
import { formatDurationMs } from '@/lib/focusModel'
import {
  DELIVERY_STATE_LABEL,
  RESOLUTION_LABEL,
  availableResolutions,
  canCompleteNatively,
  canResolve,
  needsAttention,
  purposeLabel,
  sortForReview,
} from '@/lib/focusDelivery'
import { cn } from '@/lib/utils'
import { FocusRequestError } from '@/services/focus-events'
import { useDataProvider } from '@/services/provider-context'

function when(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/**
 * Review optional Todoist time comments and old Focus Queue pending sends.
 * Each shows its own state, target task/occurrence and raw evidence. A
 * decision is explicit and recorded with what was checked: "It arrived"
 * and "Archive" never send; "Send it" re-arms only a comment verified as
 * undelivered. An old close is never replayed: "Complete in Nimble" uses the
 * normal native completion (never on a repeating task). This view performs
 * no sends itself; adopted comments go out with the next sync.
 */
export function FocusDeliveryReview({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const dp = useDataProvider()
  const [items, setItems] = useState<FocusDeliveryReviewItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [resolution, setResolution] = useState<FocusDeliveryResolution | null>(null)
  const [evidence, setEvidence] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(sortForReview(await dp.focus.deliveries()))
    } catch (e) {
      setError(FocusRequestError.from(e).message)
    }
  }, [dp])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  function choose(id: string | null) {
    setSelected(id)
    setResolution(null)
    setEvidence('')
    setVerified(false)
    setError(null)
  }

  async function submit(item: FocusDeliveryReviewItem) {
    if (!resolution || !canResolve(resolution, evidence, verified)) return
    setBusy(true)
    setError(null)
    try {
      const updated = await dp.focus.resolveDelivery(item.id, resolution, evidence.trim())
      setItems((prev) => prev && sortForReview(prev.map((i) => (i.id === item.id ? updated : i))))
      choose(null)
    } catch (e) {
      setError(FocusRequestError.from(e).message)
      void load()
    } finally {
      setBusy(false)
    }
  }

  /** The normal native completion path; it creates no delivery of its own. */
  async function completeNatively(item: FocusDeliveryReviewItem) {
    if (!item.native_task_id) return
    setBusy(true)
    setError(null)
    try {
      await dp.tasks.complete(item.native_task_id, null)
      await load()
    } catch (e) {
      setError(FocusRequestError.from(e).message)
    } finally {
      setBusy(false)
    }
  }

  const attention = items?.filter(needsAttention).length ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Todoist sends</DialogTitle>
          <DialogDescription>
            Time comments for finished focus work and old Focus Queue sends. Nothing here is resent automatically:
            when delivery is unknown, check Todoist and record what you found.
          </DialogDescription>
        </DialogHeader>

        {error && <Caption as="p" role="alert" className="text-destructive">{error}</Caption>}
        {items == null && !error && <Caption tone="muted">Loading…</Caption>}
        {items?.length === 0 && <Caption tone="muted">No Todoist sends to show.</Caption>}
        {items != null && items.length > 0 && (
          <Caption as="p" tone="muted">
            {attention > 0 ? `${attention} to review` : 'Nothing needs review.'}
          </Caption>
        )}

        <ul className="flex flex-col gap-2">
          {items?.map((item) => {
            const actions = availableResolutions(item)
            const isOpen = selected === item.id
            return (
              <li key={item.id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-meta">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {purposeLabel(item)}
                    {' · '}
                    {item.task_title ?? item.occurrence_title ?? item.external_id ?? 'Unknown task'}
                  </span>
                  <Caption className={cn(needsAttention(item) && 'text-foreground')}>{DELIVERY_STATE_LABEL[item.state]}</Caption>
                </div>
                {item.occurrence_title && item.occurrence_title !== item.task_title && (
                  <Caption tone="muted">{`Focus occurrence: ${item.occurrence_title}`}</Caption>
                )}
                {item.content && <Caption tone="muted">{`“${item.content}”`}</Caption>}
                {item.recorded_ms != null && (
                  <Caption tone="muted">
                    {`New time recorded: ${formatDurationMs(item.recorded_ms)} (${item.recorded_ms.toLocaleString()} ms)`}
                    {item.budget_ms != null && ` · timebox ${formatDurationMs(item.budget_ms)}`}
                  </Caption>
                )}
                <Caption tone="muted">
                  {[
                    item.external_id && `Todoist task ${item.external_id}`,
                    when(item.created_at) && `created ${when(item.created_at)}`,
                    `${item.attempts} attempt${item.attempts === 1 ? '' : 's'}`,
                    item.next_attempt_at && `next try ${when(item.next_attempt_at)}`,
                  ].filter(Boolean).join(' · ')}
                </Caption>
                {item.last_error && <Caption tone="muted">{`Last result: ${item.last_error}`}</Caption>}
                {item.purpose === 'legacy_close' && item.recurring_task && (
                  <Caption as="p" className="text-foreground">
                    This task repeats. The old close can't be replayed: it could complete a later occurrence.
                  </Caption>
                )}
                {item.adopt_blocked_reason && actions.length > 0 && (
                  <Caption tone="muted">{`Can't send: ${item.adopt_blocked_reason}`}</Caption>
                )}
                {item.resolution && (
                  <Caption tone="muted">
                    {`Decision: ${String(item.resolution.resolution ?? '')} · “${String(item.resolution.evidence ?? '')}”`}
                  </Caption>
                )}
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Evidence</summary>
                  <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-muted/40 p-1 font-mono text-label">
                    {JSON.stringify(item.evidence, null, 2)}
                  </pre>
                </details>

                {actions.length > 0 && !isOpen && (
                  <div className="flex flex-wrap gap-1">
                    {canCompleteNatively(item) && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void completeNatively(item)}
                        title="Complete this task in Nimble; its normal sync sends the close. Then acknowledge this old one.">
                        Complete in Nimble
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => choose(item.id)}>Resolve…</Button>
                  </div>
                )}
                {isOpen && (
                  <div className="flex flex-col gap-2 border-t border-border pt-2">
                    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Decision">
                      {actions.map((r) => (
                        <Button
                          key={r}
                          size="sm"
                          variant={resolution === r ? 'default' : 'outline'}
                          role="radio"
                          aria-checked={resolution === r}
                          onClick={() => { setResolution(r); setVerified(false) }}
                        >
                          {RESOLUTION_LABEL[r]}
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor={`delivery-evidence-${item.id}`}>
                        {resolution === 'archive_with_reason' ? 'Reason' : 'What you checked in Todoist'}
                      </FieldLabel>
                      <Textarea id={`delivery-evidence-${item.id}`} value={evidence} onChange={(e) => setEvidence(e.target.value)}
                        rows={2} maxLength={2000} />
                    </div>
                    {resolution === 'adopt_verified_undelivered' && (
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="mt-0.5" />
                        <Caption>
                          I checked Todoist and this never arrived, and the old Focus Queue app is quit. Send it once with
                          the next sync.
                        </Caption>
                      </label>
                    )}
                    <div className="flex gap-1">
                      <Button size="sm" disabled={busy || !resolution || !canResolve(resolution, evidence, verified)}
                        onClick={() => void submit(item)}>
                        Record decision
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => choose(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Label as="span" tone="muted" className="mr-auto self-center">Sends go out only while Todoist time comments are turned on.</Label>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
