import { ArrowUpDown, ChevronLeft, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import { labelColor } from '@/lib/labelColors'
import { EMPTY_FILTER, type GroupBy, type TaskFilter } from '@/lib/task-view'

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'section', label: 'Section' },
  { value: 'manual', label: 'Manual' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
]

const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 4, label: 'Urgent' },
  { value: 3, label: 'High' },
  { value: 2, label: 'Medium' },
  { value: 1, label: 'Normal' },
]

const triggerClass = cn(
  'flex h-6 items-center gap-1 rounded-[7px] px-1.5 text-meta text-muted-foreground transition-colors hover:bg-accent',
)

interface TaskListHeaderProps {
  title: string
  breadcrumb?: { label: string; onClick: () => void }[]
  groupBy: GroupBy
  onGroupBy: (g: GroupBy) => void
  filter: TaskFilter
  onFilter: (f: TaskFilter) => void
  labels: { id: string; name: string; color: string }[]
}

export function TaskListHeader({
  title,
  breadcrumb,
  groupBy,
  onGroupBy,
  filter,
  onFilter,
  labels,
}: TaskListHeaderProps) {
  const hasBreadcrumb = !!breadcrumb && breadcrumb.length > 0
  const activeCount = filter.statuses.length + filter.priorities.length + filter.labelIds.length
  const groupByLabel = GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? groupBy

  const toggleStatus = (s: (typeof STATUSES)[number]['value']) => {
    onFilter({
      ...filter,
      statuses: filter.statuses.includes(s)
        ? filter.statuses.filter((v) => v !== s)
        : [...filter.statuses, s],
    })
  }

  const togglePriority = (p: number) => {
    onFilter({
      ...filter,
      priorities: filter.priorities.includes(p)
        ? filter.priorities.filter((v) => v !== p)
        : [...filter.priorities, p],
    })
  }

  const toggleLabel = (id: string) => {
    onFilter({
      ...filter,
      labelIds: filter.labelIds.includes(id)
        ? filter.labelIds.filter((v) => v !== id)
        : [...filter.labelIds, id],
    })
  }

  return (
    <div className="flex flex-col" data-testid="task-list-header">
      {/* Top row — breadcrumb (left) + sort/filter controls (right) */}
      <div className="flex items-center justify-between gap-2 min-h-6">
        {hasBreadcrumb ? (
          <div className="flex min-w-0 items-center gap-1">
            <ChevronLeft className="size-3 shrink-0 text-muted-foreground/70" />
            {breadcrumb!.map((seg, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                {i > 0 && <span className="text-meta text-muted-foreground/70">/</span>}
                <button
                  onClick={seg.onClick}
                  className="truncate text-meta text-muted-foreground/70 transition-colors hover:text-foreground"
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div />
        )}

        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass}>
              <ArrowUpDown className="size-3" />
              {groupByLabel}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => onGroupBy(v as GroupBy)}>
                {GROUP_BY_OPTIONS.map((o) => (
                  <DropdownMenuRadioItem key={o.value} value={o.value}>
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass}>
              <ListFilter className="size-3" />
              {activeCount === 0 ? 'All' : `${activeCount} filter${activeCount === 1 ? '' : 's'}`}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUSES.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s.value}
                    checked={filter.statuses.includes(s.value)}
                    onCheckedChange={() => toggleStatus(s.value)}
                  >
                    {s.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Priority</DropdownMenuLabel>
                {PRIORITY_OPTIONS.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.value}
                    checked={filter.priorities.includes(p.value)}
                    onCheckedChange={() => togglePriority(p.value)}
                  >
                    {p.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>

              {labels.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Label</DropdownMenuLabel>
                    {labels.map((l) => (
                      <DropdownMenuCheckboxItem
                        key={l.id}
                        checked={filter.labelIds.includes(l.id)}
                        onCheckedChange={() => toggleLabel(l.id)}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: labelColor(l.color) }}
                        />
                        {l.name}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}

              {activeCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onFilter(EMPTY_FILTER)}>
                    Clear filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Second row — display title. The drag region lives here (not the
          top row, which is packed with interactive breadcrumb/menu
          triggers) so the frameless window stays draggable from this page. */}
      <div className="pt-1 pb-4" data-tauri-drag-region>
        <h1 className="pl-4 text-display truncate">{title}</h1>
      </div>
    </div>
  )
}
