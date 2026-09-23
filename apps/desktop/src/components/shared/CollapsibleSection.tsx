import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { SectionTitle } from '@/components/shared/typography'

interface CollapsibleSectionProps {
  title: string
  count?: number
  defaultOpen?: boolean
  variant?: 'primary' | 'nested'
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  variant = 'primary',
  icon,
  action,
  className,
  children,
}: CollapsibleSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      <div className="group/section flex items-center">
        {/* The heading wraps the trigger (SectionTitle recipe: 13px medium +
            dimmer count) so every collapsible section reads as one style. */}
        <SectionTitle as="h3" className="flex flex-1 min-w-0">
          <CollapsibleTrigger
            className={cn(
              'flex flex-1 min-w-0 items-center gap-1.5 text-left transition-colors',
              'data-[panel-open]:[&>svg:first-child]:rotate-90',
              variant === 'primary'
                ? 'pt-5 pb-1'
                : 'rounded-md px-2 py-1.5 hover:bg-hover',
            )}
          >
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" />
            {icon}
            <span className="truncate">{title}</span>
            {count !== undefined && (
              <span className="text-meta text-muted-foreground tabular-nums">{count}</span>
            )}
          </CollapsibleTrigger>
        </SectionTitle>
        {action && (
          <div className="opacity-0 transition-opacity group-hover/section:opacity-100">
            {action}
          </div>
        )}
      </div>
      <CollapsibleContent className="overflow-hidden transition-all duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
        <div className={cn(variant === 'nested' && 'pl-2')}>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
