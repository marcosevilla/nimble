import { cn } from '@/lib/utils'
import { ChevronLeft } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'

/** The one page-title recipe, shared with the Tasks list header: a 20px
 *  display title with its controls on the right of the same row, and any
 *  back link or breadcrumb on a small row above it. */
export const PAGE_TITLE_ROW = 'flex items-center gap-2 min-h-8 min-w-0'
export const PAGE_TITLE = 'text-display text-balance truncate'
export const PAGE_CRUMB_ROW = 'flex items-center gap-1 min-h-5 min-w-0 mb-1'
export const PAGE_CRUMB = 'truncate text-meta text-muted-foreground/70 transition-colors hover:text-foreground'

interface PageHeaderProps {
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  secondary?: React.ReactNode
  backAction?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function PageHeader({
  title,
  meta,
  actions,
  secondary,
  backAction,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-20 shrink-0 bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80',
        className,
      )}
      data-tauri-drag-region
    >
      {/* Same column as PageColumn (960, 24px gutter), so titles line up with content */}
      <div className="mx-auto w-full min-w-0 max-w-page px-6 pt-6" data-tauri-drag-region>
        {backAction && (
          <div className={PAGE_CRUMB_ROW}>
            <button onClick={backAction.onClick} className={cn('flex items-center gap-1', PAGE_CRUMB)}>
              <Icon icon={ChevronLeft} />
              {backAction.label}
            </button>
          </div>
        )}

        {/* Title row — drag region on the non-interactive title area */}
        <div className={PAGE_TITLE_ROW}>
          <div className="flex flex-1 items-baseline gap-2 min-w-0" data-tauri-drag-region>
            <h1 className={PAGE_TITLE}>{title}</h1>
            {meta && (
              <span className="text-meta text-muted-foreground shrink-0">
                {meta}
              </span>
            )}
          </div>

          {actions && (
            <div className="flex shrink-0 items-center gap-1">
              {actions}
            </div>
          )}
        </div>

        {/* Secondary row — sticks with the header (e.g. filter pills) */}
        {secondary && (
          <div className="flex items-center gap-1 pt-2 flex-wrap">
            {secondary}
          </div>
        )}
      </div>
    </div>
  )
}
