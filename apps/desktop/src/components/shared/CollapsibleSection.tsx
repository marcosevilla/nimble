import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { BodyStrong } from '@/components/shared/typography'

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
        <CollapsibleTrigger
          className={cn(
            'flex flex-1 items-center gap-1.5 text-left rounded-md px-2 transition-colors hover:bg-accent/20',
            '[&>svg:first-child]:data-[panel-open]:rotate-90',
            variant === 'primary' ? 'py-2' : 'py-1.5',
          )}
        >
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150" />
          {icon}
          <BodyStrong>{title}</BodyStrong>
          {count !== undefined && (
            <span className="text-meta text-muted-foreground">{count}</span>
          )}
        </CollapsibleTrigger>
        {action && (
          <div className="opacity-0 transition-opacity group-hover/section:opacity-100">
            {action}
          </div>
        )}
      </div>
      <CollapsibleContent className="overflow-hidden transition-all duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
        <div className="pl-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
