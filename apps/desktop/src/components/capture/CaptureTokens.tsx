import { CalendarDays, CheckSquare, FileText, Lightbulb, Quote } from 'lucide-react'
import type { CaptureRoute } from '@nimble/types'

const ROUTE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  Quote,
  CheckSquare,
  FileText,
}

export function RouteIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ROUTE_ICONS[name] ?? FileText
  return <Icon className={className} />
}

/** LabelChipPill recipe (inbox P2-8): the user's route color is a dot; the
 *  text stays on a theme token so contrast never depends on data. */
export function RoutePill({ route }: { route: CaptureRoute }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-label text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: route.color }} />
      <RouteIcon name={route.icon} className="size-3" />
      {route.label}
    </span>
  )
}

/** The date a task-bound capture will get, with the ⌫ escape hatch. */
export function DateChip({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-label text-muted-foreground"
    >
      <CalendarDays className="size-3" />
      <span className="text-foreground">{label}</span>
      <kbd className="font-mono">⌫</kbd>
      <span>keep as text</span>
    </span>
  )
}
