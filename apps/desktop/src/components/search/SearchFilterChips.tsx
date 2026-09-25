import { ChevronDown } from 'lucide-react'
import type { Project, TaskSearchFilters, TaskSearchStatus } from '@nimble/types'
import { cn } from '@/lib/utils'
import { STATUS_LABEL } from '@/lib/taskSearch'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { LabelPickerList } from '@/components/tasks/LabelPicker'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const chip = (active: boolean) =>
  cn(
    'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-meta outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'border-transparent bg-secondary text-secondary-foreground' : 'border-border/60 text-muted-foreground hover:bg-hover hover:text-foreground',
  )

const STATUSES: TaskSearchStatus[] = ['all', 'open', 'completed']

export function SearchFilterChips({
  filters,
  onChange,
  projects,
}: {
  filters: TaskSearchFilters
  onChange: (next: TaskSearchFilters) => void
  projects: Project[]
}) {
  const { labels } = useLabelTaxonomy()
  const status = filters.status ?? 'all'
  const labelIds = filters.label_ids ?? []
  const project = projects.find((p) => p.id === filters.project_id) ?? null
  const labelText =
    labelIds.length === 0 ? 'Label'
    : labelIds.length === 1 ? labels.find((l) => l.id === labelIds[0])?.name ?? '1 label'
    : `${labelIds.length} labels`

  return (
    // Menus and the label list are portaled but still bubble through React:
    // keep their Enter/arrows from also driving the results list (cmdk).
    <div
      role="group"
      aria-label="Filters"
      className="flex shrink-0 items-center gap-1"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') e.stopPropagation()
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className={chip(status !== 'all')} aria-label={`Status: ${STATUS_LABEL[status]}`}>
          {status === 'all' ? 'Status' : STATUS_LABEL[status]}
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup value={status} onValueChange={(v) => onChange({ ...filters, status: v as TaskSearchStatus })}>
            {STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>{STATUS_LABEL[s]}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger className={chip(labelIds.length > 0)} aria-label={`Label filter: ${labelIds.length === 0 ? 'any' : labelText}`}>
          {labelText}
          <ChevronDown className="size-3" aria-hidden />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" sideOffset={6} className="w-60 p-1.5">
          <LabelPickerList mode="filter" value={labelIds} onChange={(ids) => onChange({ ...filters, label_ids: ids })} />
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger className={chip(!!project)} aria-label={`Project filter: ${project?.name ?? 'any'}`}>
          <span className="max-w-28 truncate">{project?.name ?? 'Project'}</span>
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto">
          <DropdownMenuRadioGroup value={filters.project_id ?? ''} onValueChange={(v) => onChange({ ...filters, project_id: (v as string) || null })}>
            <DropdownMenuRadioItem value="">Any project</DropdownMenuRadioItem>
            {projects.filter((p) => !p.archived_at).map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
