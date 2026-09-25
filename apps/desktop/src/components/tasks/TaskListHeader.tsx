import { ArrowUpDown, ChevronLeft, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PAGE_CRUMB, PAGE_CRUMB_ROW, PAGE_TITLE, PAGE_TITLE_ROW } from '@/components/shared/PageHeader'
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
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { STATUSES } from '@/components/tasks/StatusDropdown'
import { labelColor } from '@/lib/labelColors'
import { ALL_GROUP_BY, EMPTY_FILTER, type GroupBy, type TaskFilter } from '@/lib/task-view'
import { cycleLabelInFilter } from '@/lib/labelFilter'
import type { Label } from '@nimble/types'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { filterSections, isFlat } from '@/lib/labelTaxonomy'

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  section: 'Section',
  manual: 'Manual',
  status: 'Status',
  priority: 'Priority',
  due: 'Due date',
}

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
  labels: Label[]
  /** Restricts which options the sort menu offers — defaults to all 5.
   * All Tasks passes a narrower list since `section`/`manual` don't have a
   * coherent cross-project meaning (see task-view.ts). The caller is
   * responsible for keeping a persisted `groupBy` consistent with this via
   * `loadTaskView`'s `allowed` param — this prop only controls the menu. */
  availableGroupBy?: readonly GroupBy[]
}

export function TaskListHeader({
  title,
  breadcrumb,
  groupBy,
  onGroupBy,
  filter,
  onFilter,
  labels,
  availableGroupBy = ALL_GROUP_BY,
}: TaskListHeaderProps) {
  const hasBreadcrumb = !!breadcrumb && breadcrumb.length > 0
  const activeLabelCount = filter.labelFilter.include.length + filter.labelFilter.exclude.length
  const activeCount = filter.statuses.length + filter.priorities.length + activeLabelCount
  const groupByLabel = GROUP_BY_LABELS[groupBy] ?? groupBy
  const nimbleLabel = labels.find((l) => l.name === 'nimble')
  const { groups } = useLabelTaxonomy()
  // Callers pass the labels used in this list; archived ones drop out here.
  const labelSections = filterSections(labels, groups)
  const flatLabels = isFlat(labelSections)

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

  // Single label predicate for the whole task list (there is no second,
  // separate label filter anywhere in this header). Each row cycles
  // off → include ("Only") → exclude ("Hide") → off.
  const cycleLabel = (id: string) => {
    onFilter({ ...filter, labelFilter: cycleLabelInFilter(filter.labelFilter, id) })
  }

  return (
    <div className="flex flex-col pb-6" data-testid="task-list-header">
      {/* Breadcrumb row — only inside a project */}
      {hasBreadcrumb && (
        <div className={PAGE_CRUMB_ROW}>
          <ChevronLeft className="size-3 shrink-0 text-muted-foreground/70" />
          {breadcrumb!.map((seg, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="text-meta text-muted-foreground/70">/</span>}
              <button onClick={seg.onClick} className={PAGE_CRUMB}>
                {seg.label}
              </button>
            </span>
          ))}
        </div>
      )}
      {/* Title row — title left, sort/filter right (the shared PageHeader
          recipe). No drag region here — this header scrolls with the list,
          so a `data-tauri-drag-region` on it would go undraggable the
          moment the page scrolls. The window's drag surface is
          `PageDragRegion`, rendered outside the scroll container by each
          page shell. */}
      <div className={PAGE_TITLE_ROW}>
        <h1 className={cn(PAGE_TITLE, 'flex-1')}>{title}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className={triggerClass}>
              <ArrowUpDown className="size-3" />
              {groupByLabel}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => onGroupBy(v as GroupBy)}>
                {availableGroupBy.map((v) => (
                  <DropdownMenuRadioItem key={v} value={v}>
                    {GROUP_BY_LABELS[v]}
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

              {labelSections.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      Label
                      {activeLabelCount > 0 && (
                        <span className="ml-1 text-muted-foreground/70">({activeLabelCount})</span>
                      )}
                    </DropdownMenuLabel>

                    {/* Shortcuts against the auto-applied `nimble` label —
                        replace the whole label predicate rather than merge
                        with the per-label toggles below. */}
                    {nimbleLabel && (
                      <>
                        <DropdownMenuItem
                          onClick={() => onFilter({ ...filter, labelFilter: { include: [nimbleLabel.id], exclude: [] } })}
                        >
                          Made in Nimble
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onFilter({ ...filter, labelFilter: { include: [], exclude: [nimbleLabel.id] } })}
                        >
                          From Todoist
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuGroup>

                  {/* One group per taxonomy section; system groups come last. */}
                  {labelSections.map((section) => (
                    <DropdownMenuGroup key={section.group?.id ?? 'ungrouped'}>
                      {!flatLabels && (
                        <DropdownMenuLabel className="text-label">{section.group?.name ?? 'Ungrouped'}</DropdownMenuLabel>
                      )}
                      {section.labels.map((l) => {
                        const included = filter.labelFilter.include.includes(l.id)
                        const excluded = filter.labelFilter.exclude.includes(l.id)
                        return (
                          <DropdownMenuItem
                            key={l.id}
                            closeOnClick={false}
                            onClick={() => cycleLabel(l.id)}
                            className={cn(excluded && 'opacity-50')}
                          >
                            <span className="size-2 shrink-0 rounded-full" style={{ background: labelColor(l.color) }} />
                            <span className="flex-1 min-w-0 truncate">{l.name}</span>
                            {(included || excluded) && (
                              <DropdownMenuShortcut>{included ? 'Only' : 'Hide'}</DropdownMenuShortcut>
                            )}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuGroup>
                  ))}
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
    </div>
  )
}
