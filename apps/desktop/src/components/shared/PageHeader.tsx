import { cn } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'
import { Icon } from '@/components/shared/Icon'

/** `default`/`wide` align the header with PageFrame's content column
 *  (640/768, same 24px gutter); `full` spans the pane (Docs). */
export type PageHeaderWidth = 'default' | 'wide' | 'full'

const WIDTH_CLASS: Record<PageHeaderWidth, string> = {
  default: 'mx-auto max-w-page px-6',
  wide: 'mx-auto max-w-page-wide px-6',
  full: 'px-5',
}

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
      <div className={cn('w-full min-w-0', WIDTH_CLASS[width])} data-tauri-drag-region>
        {/* Main row — drag region on the non-interactive title area */}
        <div className={cn('flex items-center gap-2 py-2 min-h-[40px] border-b', secondary ? 'border-border/10' : 'border-border/20')}>
          {backAction && (
            <button
              onClick={backAction.onClick}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 -ml-1 text-meta text-muted-foreground transition-colors duration-(--transition-fast) hover:bg-hover hover:text-foreground"
            >
              <Icon icon={ArrowLeft} />
              {backAction.label}
            </button>
          )}

          <div
            className="flex flex-1 items-baseline gap-2 min-w-0"
            data-tauri-drag-region
          >
            <h1 className="text-title text-balance truncate">{title}</h1>
            {meta && (
              <span className="text-meta text-muted-foreground relative top-px shrink-0">
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
          <div className="flex items-center gap-1 py-1.5 border-b border-border/20 flex-wrap">
            {secondary}
          </div>
        )}
      </div>
    </div>
  )
}
