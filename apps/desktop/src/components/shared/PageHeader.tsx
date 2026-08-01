import { cn } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'

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
        'sticky top-0 z-20 shrink-0 border-b border-border/20 bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80',
        className,
      )}
    >
      {/* Main row — drag region on the non-interactive title area */}
      <div className="flex items-center gap-2 px-5 py-2 min-h-[40px]">
        {backAction && (
          <button
            onClick={backAction.onClick}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 -ml-1 text-meta text-muted-foreground transition-colors hover:bg-accent/20 hover:text-muted-foreground"
          >
            <ArrowLeft className="size-3" />
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
        <div className="flex items-center gap-1 px-5 py-1.5 border-t border-border/10 flex-wrap">
          {secondary}
        </div>
      )}
    </div>
  )
}
