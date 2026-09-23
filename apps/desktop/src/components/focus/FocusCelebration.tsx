import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Caption, Meta } from '@/components/shared/typography'
import { completionNextAction, formatDurationMs } from '@/lib/focusModel'
import { shouldIgnoreKey } from '@/lib/keyGuard'
import type { FocusCelebrationState } from '@/stores/focusSurfaceStore'

const VISIBLE_MS = 2_500

/**
 * Completion acknowledgement, shown only after the engine committed the
 * completion. It is inline (never a full-screen overlay), so it cannot hide
 * a failure shown above it. The next entry is already selected paused;
 * dismissing — Enter, Escape, Space, a click or the timeout — never starts it.
 */
export function FocusCelebration({ celebration, onDismiss }: { celebration: FocusCelebrationState; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, VISIBLE_MS)
    return () => clearTimeout(id)
  }, [celebration.id, onDismiss])

  // While up, these keys only dismiss: the Enter that completed the task
  // (or a repeat) must not reach the next task's controls underneath.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== ' ') return
      if (shouldIgnoreKey(e.target as HTMLElement, { allowInteractive: true })) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (completionNextAction(e.key) == null) onDismiss()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-md bg-success/10 px-2.5 py-2 animate-in fade-in duration-(--transition-fast) motion-reduce:animate-none"
    >
      <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-success" aria-hidden>
        <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="checkmark-draw" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-body text-foreground">
          <span className="sr-only">Completed </span>
          <span className="line-through decoration-muted-foreground">{celebration.title}</span>
          {celebration.totalMs > 0 && <Meta as="span">{` · ${formatDurationMs(celebration.totalMs)}`}</Meta>}
        </p>
        {celebration.nextTitle ? (
          <Caption as="p">
            Next: <span className="text-foreground">{celebration.nextTitle}</span> is ready when you are.
          </Caption>
        ) : (
          celebration.queueEmpty && <Caption as="p">Queue is clear.</Caption>
        )}
      </div>
      <Button size="xs" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
