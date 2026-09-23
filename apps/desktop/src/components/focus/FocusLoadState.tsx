import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Caption } from '@/components/shared/typography'

/**
 * What a focus surface shows before its first snapshot: a card-shaped
 * skeleton while loading, or the read failure with a retry. Never a blank
 * area, and never a control that could start timing.
 */
export function FocusLoadState({ error, onRetry }: { error: { message: string } | null; onRetry: () => void }) {
  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-4">
        <Caption as="p" tone="default">{`Focus couldn't load: ${error.message}`}</Caption>
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <div role="status" aria-label="Loading focus" className="flex flex-col gap-3 p-4">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
      <div className="flex items-end justify-between pt-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="size-11 rounded-full" />
      </div>
    </div>
  )
}
