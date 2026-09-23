import { cn } from '@/lib/utils'
import { ChevronLeft } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'

/** `default`/`wide` align the header with PageFrame's content column
 *  (640/768, same 24px gutter); `full` spans the pane (Docs). */
export type PageHeaderWidth = 'default' | 'wide' | 'full'

const WIDTH_CLASS: Record<PageHeaderWidth, string> = {
  default: 'mx-auto max-w-page px-6',
  wide: 'mx-auto max-w-page-wide px-6',
  full: 'px-6',
}

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
  width?: PageHeaderWidth
  className?: string
}

export function PageHeader({
  title,
  meta,
  actions,
  secondary,
  backAction,
  width = 'full',
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
      <div className={cn('w-full min-w-0 pt-6', WIDTH_CLASS[width])} data-tauri-drag-region>
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
