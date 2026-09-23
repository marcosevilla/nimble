import { useDataVersion } from '@/hooks/useDataVersion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { SectionedTaskList } from '@/components/tasks/SectionedTaskList'
import { TaskListHeader } from '@/components/tasks/TaskListHeader'
import { SelectionActionBar } from '@/components/tasks/SelectionActionBar'
import { PageDragRegion } from '@/components/shared/PageDragRegion'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus } from 'lucide-react'
import { useTaskNavigation } from '@/hooks/useTaskNavigation'
import { useTaskRowActions } from '@/components/tasks/useTaskRowActions'
import { useQuickCreateStore } from '@/stores/quickCreateStore'
import { ProjectDetailPage } from '@/components/tasks/ProjectDetailPage'
import { TaskDetailPage } from '@/components/detail/TaskDetailPage'
import { useTasksNavStore } from '@/stores/tasksNavStore'
import { useDetailStore } from '@/stores/detailStore'
import { useDataProvider } from '@/services/provider-context'
import { filterTasks, groupTasks, loadTaskView, saveTaskView, type GroupBy } from '@/lib/task-view'
import { matchesLabelFilter } from '@/lib/labelFilter'
import type { LocalTask, Label, Project } from '@nimble/types'

// Section/manual grouping don't have a coherent cross-project meaning here —
// `sections` are scoped to a single project (see task-view.ts), so a merged
// "section" lane in All Tasks would be an arbitrary, unlabeled interleaving
// of unrelated projects' sections. Rather than disambiguate lane titles
// (which the frozen `groupTasks(tasks, by, sections)` signature has no room
// for) or build a project-grouped special case, the simplest, least
// surprising fix is to just not offer those two modes here — per-project
// section/manual grouping still works from ProjectDetailPage.
const ALL_TASKS_GROUP_BY: readonly GroupBy[] = ['status', 'priority', 'due']

// ── All Tasks View ──

function AllTasksView({
  tasks,
  projects,
  visibleLabels,
  onDelete,
  onAddSubtask,
  refresh,
}: {
  tasks: LocalTask[]
  projects: Project[]
  visibleLabels: Label[]
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  refresh: () => void
}) {
  const [viewState, setViewState] = useState(() => loadTaskView('all', 'status', ALL_TASKS_GROUP_BY))
  const labelFilter = useTasksNavStore((s) => s.labelFilter)

  useEffect(() => {
    saveTaskView('all', viewState)
  }, [viewState])

  const setGroupBy = useCallback((groupBy: (typeof viewState)['groupBy']) => {
    setViewState((v) => ({ ...v, groupBy }))
  }, [])
  const setFilter = useCallback((filter: (typeof viewState)['filter']) => {
    setViewState((v) => ({ ...v, filter }))
  }, [])

  const filteredTasks = useMemo(
    () => filterTasks(tasks, viewState.filter).filter((t) => matchesLabelFilter(t.labels, labelFilter)),
    [tasks, viewState.filter, labelFilter],
  )
  const groups = useMemo(
    // `sections` is always [] — groupBy here is restricted to
    // status/priority/due (ALL_TASKS_GROUP_BY), none of which consult it.
    () => groupTasks(filteredTasks, viewState.groupBy, []),
    [filteredTasks, viewState.groupBy],
  )

  // j/k/x/s/f/Enter over the rows in display order (tasks audit P1-1).
  const visibleIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t.id)), [groups])
  const rowActions = useTaskRowActions(tasks)
  const { focusedId, focusRow } = useTaskNavigation(visibleIds, rowActions, { memoryKey: 'tasks:all' })

  // All Tasks mixes projects — each row resolves its own badge (P2-1).
  const projectsById = useMemo(() => {
    const map: Record<string, Project> = {}
    for (const p of projects) map[p.id] = p
    return map
  }, [projects])

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <PageDragRegion />
      {/* scrollbar-gutter keeps centered content from shifting when the
          classic 6px scrollbar appears after async content loads */}
      <div className="flex-1 overflow-y-auto min-w-0 [scrollbar-gutter:stable]">
        <div className="pb-6">
          <div className="w-full max-w-page mx-auto px-6 min-w-0">
            <TaskListHeader
              title="Tasks"
              groupBy={viewState.groupBy}
              onGroupBy={setGroupBy}
              filter={viewState.filter}
              onFilter={setFilter}
              labels={visibleLabels}
              availableGroupBy={ALL_TASKS_GROUP_BY}
            />

            {filteredTasks.length === 0 ? (
              <p className="text-body text-muted-foreground text-center py-8">
                {tasks.length === 0 ? (
                  <>
                    No tasks yet. Press <kbd className="rounded border border-border/30 px-1.5 py-0.5 text-meta font-mono">Q</kbd> to create one.
                  </>
                ) : (
                  'No tasks match this filter.'
                )}
              </p>
            ) : (
              <SectionedTaskList
                groups={groups}
                allTasks={filteredTasks}
                // All Tasks spans multiple projects, and section_id/position
                // are only meaningful scoped to a single project — cross-lane
                // drag here would silently assign a task to a section (or
                // renumber positions) belonging to a different project. Stay
                // read-only; per-project drag still works from
                // ProjectDetailPage. (Moot today since section/manual aren't
                // offered in this container's sort menu — see
                // ALL_TASKS_GROUP_BY — but kept explicit in case that ever
                // changes.)
                dragEnabled={false}
                onDelete={onDelete}
                onAddSubtask={onAddSubtask}
                onUpdated={refresh}
                focusedId={focusedId}
                onFocusRow={focusRow}
                projectsById={projectsById}
              />
            )}

            {/* Same "Add a task" row a project view has, with the shortcut
                it stands in for (tasks audit P2-7). */}
            {filteredTasks.length > 0 && (
              <div className="pt-5 pl-4">
                <button
                  type="button"
                  onClick={() => useQuickCreateStore.getState().openCreate()}
                  className="flex w-full items-center gap-2 rounded-md text-left text-meta text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="size-3 shrink-0" />
                  <span className="flex-1">Add a task…</span>
                  <kbd className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-label text-muted-foreground">Q</kbd>
                </button>
              </div>
            )}

            <SelectionActionBar />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tasks Page ──

export function TasksPage() {
  const referenceVersion = useDataVersion('labels')
  const dp = useDataProvider()
  const { allProjects, loading: projectsLoading } = useProjects()
  const { tasks, loading: tasksLoading, addTask, remove, refresh } = useLocalTasks()
  const selectedProjectId = useTasksNavStore((s) => s.selectedProjectId)
  const setSelectedProjectId = useTasksNavStore((s) => s.selectProject)
  const [labels, setLabels] = useState<Label[]>([])

  // Task details opened while on this page render in the content area below
  // (instead of Dashboard replacing this whole page), so the project
  // sidebar stays mounted and interactive (Marco QA round 3, item 4).
  const detailTarget = useDetailStore((s) => s.target)
  const detailMode = useDetailStore((s) => s.mode)
  const closeDetail = useDetailStore((s) => s.close)
  const showingDetail = detailTarget?.type === 'task' && detailMode === 'body'

  const loading = projectsLoading || tasksLoading

  useEffect(() => {
    dp.labels.list().then(setLabels).catch(() => {})
  }, [dp, referenceVersion])

  // Only surface labels that are actually applied to something — an empty
  // label taxonomy in the filter menu is just noise.
  const usedLabelIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of tasks) for (const l of t.labels) set.add(l)
    return set
  }, [tasks])

  const visibleLabels = useMemo(
    () => labels.filter((l) => usedLabelIds.has(l.id)),
    [labels, usedLabelIds],
  )

  const handleAddSubtask = useCallback(
    async (parentId: string, content: string) => {
      const parent = tasks.find((t) => t.id === parentId)
      await addTask(content, { parentId, projectId: parent?.project_id })
      refresh()
    },
    [tasks, addTask, refresh],
  )

  // Selecting a project (breadcrumbs inside a project view) always shows
  // that project's list — if a task detail is currently open in the
  // content area, close it first so the list actually becomes visible.
  // The nav's project tree does the same (NavTasksTree).
  const handleSelectProject = useCallback(
    (id: string | null) => {
      if (showingDetail) closeDetail()
      setSelectedProjectId(id)
    },
    [showingDetail, closeDetail, setSelectedProjectId],
  )

  // Find the selected project object — looked up in `allProjects` (not the
  // active-only `projects`) so a breadcrumb back to an archived parent
  // still resolves instead of silently bouncing to All Tasks.
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null
    return allProjects.find((p) => p.id === selectedProjectId) ?? null
  }, [selectedProjectId, allProjects])

  if (loading) {
    return (
      <div className="flex flex-1 h-full overflow-hidden">
        <div className="space-y-3 p-6 flex-1">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Main content */}
      {showingDetail && detailTarget ? (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <PageDragRegion />
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-6">
            {/* Keyed by task id — same remount-per-task semantics Dashboard
                used to provide via its own `key={`detail-${id}`}` wrapper,
                now that this page stays mounted across detail open/close. */}
            <TaskDetailPage key={detailTarget.id} />
          </div>
        </div>
      ) : selectedProject ? (
        <ProjectDetailPage
          // Remount on project switch — each project's view state
          // (groupBy/filter, section list) is loaded fresh rather than
          // patched over the previous project's.
          key={selectedProject.id}
          project={selectedProject}
          tasks={tasks}
          allProjects={allProjects}
          onSelectProject={handleSelectProject}
          onDeleteTask={remove}
          onAddSubtask={handleAddSubtask}
          onUpdated={refresh}
        />
      ) : (
        <AllTasksView
          tasks={tasks}
          projects={allProjects}
          visibleLabels={visibleLabels}
          onDelete={remove}
          onAddSubtask={handleAddSubtask}
          refresh={refresh}
        />
      )}
    </div>
  )
}
