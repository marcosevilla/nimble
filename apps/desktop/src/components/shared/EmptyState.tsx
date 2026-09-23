import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** One calm, positive sentence (§1.1) — never "nothing to do" guilt. */
  children: React.ReactNode
  icon?: LucideIcon
  /** Single-key hint rendered as a <kbd> after the sentence. */
  kbd?: string
  /** At most one control (usually a small outline Button). */
  action?: React.ReactNode
  /** `compact` for empty states inside a card or rail (py-4 instead of py-12). */
  size?: 'default' | 'compact'
  className?: string
}

/** One empty state for every page (cross-cutting move 3): centered in the
 *  column, optional muted icon, one text-body line, optional kbd hint or one
 *  action. */
export function EmptyState({ children, icon: Icon, kbd, action, size = 'default', className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        size === 'compact' ? 'py-4' : 'py-12',
        className,
      )}
    >
      {Icon && <Icon className="size-5 text-muted-foreground" aria-hidden="true" />}
      <p className="text-body text-muted-foreground text-pretty">
        {children}
        {kbd && (
          <>
            {' '}
            <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-label text-muted-foreground">{kbd}</kbd>
          </>
        )}
      </p>
      {action}
    </div>
  )
}
