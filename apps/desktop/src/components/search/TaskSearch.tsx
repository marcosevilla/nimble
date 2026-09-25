import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Check, Circle, History, Search } from 'lucide-react'
import type { TaskSearchFilters, TaskSearchHit } from '@nimble/types'
import { cn } from '@/lib/utils'
import { Command, CommandGroup, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Icon } from '@/components/shared/Icon'
import { Meta } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { useProjects } from '@/hooks/useLocalTasks'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { rememberRowFocus } from '@/hooks/useTaskNavigation'
import { useTaskSearchStore } from '@/stores/taskSearchStore'
import { useDetailStore } from '@/stores/detailStore'
import { useTasksNavStore } from '@/stores/tasksNavStore'
import { navigateTo } from '@/stores/settingsNavStore'
import { hasOpenOverlay } from '@/lib/rowNav'
import {
  EMPTY_SEARCH_FILTERS, SEARCH_DEBOUNCE_MS, activeFilterLabels, createLatestGuard, formatDoneDate,
  groupHits, hasActiveFilters, markTitle, searchTokens, splitMarked, type Segment,
} from '@/lib/taskSearch'
import { loadRecent, pushRecent, safeStorage } from '@/lib/recentSearches'
import { SearchFilterChips } from './SearchFilterChips'

/** ⌘F — search every task, open or done (C4). Mounted once in Dashboard. */
export function TaskSearch() {
  const open = useTaskSearchStore((s) => s.open)
  const session = useTaskSearchStore((s) => s.session)
  const openSearch = useTaskSearchStore((s) => s.openSearch)

  // ⌘F from anywhere, including text fields — except while another overlay
  // (dialog, menu, popover, listbox) is up. A second ⌘F re-selects the query.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      if (useTaskSearchStore.getState().open) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-task-search-input]')?.select()
        return
      }
      if (hasOpenOverlay()) return
      e.preventDefault()
      openSearch('', document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

  // `session` remounts the dialog per open: fresh query, filters, results.
  // Nothing mounts (or fetches) until the first open.
  return session > 0 ? <TaskSearchDialog key={session} open={open} /> : null
}

function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.mark
          ? <mark key={i} className="rounded-[3px] bg-primary/15 px-px text-inherit">{s.text}</mark>
          : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  )
}

function TaskSearchDialog({ open }: { open: boolean }) {
  const dp = useDataProvider()
  const close = useTaskSearchStore((s) => s.close)
  const initialQuery = useTaskSearchStore((s) => s.initialQuery)
  const returnFocus = useTaskSearchStore((s) => s.returnFocus)
  const { projects } = useProjects()
  const { labels } = useLabelTaxonomy()
  const [query, setQuery] = useState(initialQuery)
  const [filters, setFilters] = useState<TaskSearchFilters>(EMPTY_SEARCH_FILTERS)
  const [result, setResult] = useState<{ key: string; hits: TaskSearchHit[] } | null>(null)
  const [recent, setRecent] = useState<string[]>(() => loadRecent(safeStorage()))
  const [selected, setSelected] = useState('')
  const guard = useRef(createLatestGuard())
  // Escape returns focus to the opener; opening a task hands focus onward.
  const restoreFocus = useRef(true)

  const trimmed = query.trim()
  const requestKey = JSON.stringify([trimmed, filters])
  const tokens = useMemo(() => searchTokens(trimmed), [trimmed])

  // Debounced; responses to anything but the latest request are dropped.
  useEffect(() => {
    if (!open || !trimmed) {
      guard.current.next()
      return
    }
    const timer = window.setTimeout(() => {
      const id = guard.current.next()
      dp.tasks.search(trimmed, filters).then(
        (hits) => { if (guard.current.isLatest(id)) setResult({ key: requestKey, hits }) },
        () => { if (guard.current.isLatest(id)) setResult({ key: requestKey, hits: [] }) },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, trimmed, filters, requestKey, dp])

  // The previous results stay up while the next query runs (no flicker).
  const hits = trimmed && result ? result.hits : []
  const settled = !trimmed || result?.key === requestKey
  const { open: openHits, completed } = groupHits(hits)
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const filtersOn = hasActiveFilters(filters)

  const remember = () => {
    if (trimmed) setRecent(pushRecent(safeStorage(), trimmed))
  }
  const openTask = (hit: TaskSearchHit) => {
    remember()
    restoreFocus.current = false
    close()
    useDetailStore.getState().openTask(hit.task.id)
  }
  const openInProject = (hit: TaskSearchHit) => {
    remember()
    restoreFocus.current = false
    close()
    const { id, project_id: projectId } = hit.task
    rememberRowFocus(`tasks:project:${projectId}`, id)
    useDetailStore.getState().close()
    useTasksNavStore.getState().requestProject(projectId)
    navigateTo('tasks')
    // Already showing that project? Its list is mounted: focus the row now.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-nav-row="${window.CSS.escape(id)}"]`)?.focus()
    })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const hit = hits.find((h) => h.task.id === selected) ?? hits[0]
    if (hit) openInProject(hit)
  }

  const renderHit = (hit: TaskSearchHit) => {
    const done = hit.task.status === 'complete'
    return (
      <CommandPrimitive.Item
        key={hit.task.id}
        value={hit.task.id}
        onSelect={() => openTask(hit)}
        className="flex cursor-default select-none items-start gap-2 rounded-lg px-2 py-1.5 outline-none data-[selected=true]:bg-hover"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          {done ? <Check className="size-3.5" /> : <Circle className="size-3" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-body', done && 'text-muted-foreground line-through')}>
              <Marked segments={markTitle(hit.task.content, tokens)} />
            </span>
            <Meta className="shrink-0">
              {done ? formatDoneDate(hit.task.completed_at) : projectName.get(hit.task.project_id) ?? ''}
            </Meta>
          </span>
          {hit.snippet && (
            <Meta className="truncate">
              <Marked segments={splitMarked(hit.snippet)} />
            </Meta>
          )}
        </span>
      </CommandPrimitive.Item>
    )
  }

  const showRecent = !trimmed && recent.length > 0
  const showList = showRecent || hits.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent
        showCloseButton={false}
        finalFocus={() => (restoreFocus.current && returnFocus?.isConnected ? returnFocus : false)}
        className="top-[28%] w-full max-w-xl translate-y-0 gap-0 bg-transparent p-0 ring-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search tasks</DialogTitle>
        <DialogDescription className="sr-only">
          Every task, open or done. Enter opens a task; Command-Enter opens it in its project.
        </DialogDescription>
        <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} onKeyDown={onKeyDown} className="gap-1 overflow-visible bg-transparent p-0">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-border/50 bg-popover px-4 shadow-lg shadow-black/10">
            <Icon icon={Search} className="text-muted-foreground" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              data-task-search-input=""
              aria-label="Search tasks"
              placeholder="Search tasks…"
              className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
            />
            <SearchFilterChips filters={filters} onChange={setFilters} projects={projects} />
          </div>

          {(showList || (trimmed && (!settled || hits.length === 0))) && (
            <div className="overflow-hidden rounded-xl border border-border/50 bg-popover shadow-lg">
              {showList && (
                <CommandList className="max-h-[min(60vh,28rem)] p-1">
                  {showRecent && (
                    <CommandGroup heading="Recent">
                      {recent.map((q) => (
                        <CommandPrimitive.Item
                          key={q}
                          value={`recent:${q}`}
                          onSelect={() => setQuery(q)}
                          className="flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-body outline-none data-[selected=true]:bg-hover"
                        >
                          <History className="size-3.5 text-muted-foreground" aria-hidden />
                          {q}
                        </CommandPrimitive.Item>
                      ))}
                    </CommandGroup>
                  )}
                  {openHits.length > 0 && <CommandGroup heading="Open">{openHits.map(renderHit)}</CommandGroup>}
                  {completed.length > 0 && <CommandGroup heading="Completed">{completed.map(renderHit)}</CommandGroup>}
                </CommandList>
              )}
              {trimmed && !settled && hits.length === 0 && (
                <div className="space-y-2 p-3" aria-hidden>
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              )}
              {trimmed && settled && hits.length === 0 && (
                <EmptyState
                  size="compact"
                  action={filtersOn ? (
                    <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_SEARCH_FILTERS)}>Clear filters</Button>
                  ) : undefined}
                >
                  No tasks match "{trimmed}".
                  {filtersOn && <> Filters: {activeFilterLabels(filters, labels, projects).join(' · ')}.</>}
                </EmptyState>
              )}
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
