import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { SectionedTaskList } from '@/components/tasks/SectionedTaskList'
import { TaskListHeader } from '@/components/tasks/TaskListHeader'
import { PageDragRegion } from '@/components/shared/PageDragRegion'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { List, PanelLeftOpen } from 'lucide-react'
import { ProjectSidebar } from '@/components/tasks/ProjectSidebar'
import { ProjectDetailPage } from '@/components/tasks/ProjectDetailPage'
import { IconButton } from '@/components/shared/IconButton'
import { useLayoutStore } from '@/stores/layoutStore'
import { listLabels } from '@/services/tauri'
import { filterTasks, groupTasks, loadTaskView, saveTaskView, type GroupBy } from '@/lib/task-view'
import type { LocalTask, Label } from '@nimble/types'

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
  visibleLabels,
  onDelete,
  onAddSubtask,
  refresh,
}: {
  tasks: LocalTask[]
  visibleLabels: Label[]
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  refresh: () => void
}) {
  const [viewState, setViewState] = useState(() => loadTaskView('all', 'status', ALL_TASKS_GROUP_BY))

  useEffect(() => {
    saveTaskView('all', viewState)
  }, [viewState])

  const setGroupBy = useCallback((groupBy: (typeof viewState)['groupBy']) => {
    setViewState((v) => ({ ...v, groupBy }))
  }, [])
  const setFilter = useCallback((filter: (typeof viewState)['filter']) => {
    setViewState((v) => ({ ...v, filter }))
  }, [])

  const filteredTasks = useMemo(() => filterTasks(tasks, viewState.filter), [tasks, viewState.filter])
  const groups = useMemo(
    // `sections` is always [] — groupBy here is restricted to
    // status/priority/due (ALL_TASKS_GROUP_BY), none of which consult it.
    () => groupTasks(filteredTasks, viewState.groupBy, []),
    [filteredTasks, viewState.groupBy],
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <PageDragRegion />
      {/* scrollbar-gutter keeps centered content from shifting when the
          classic 6px scrollbar appears after async content loads */}
      <div className="flex-1 overflow-y-auto min-w-0 [scrollbar-gutter:stable]">
        <div className="pb-6">
          <div className="w-full max-w-[600px] mx-auto min-w-0">
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
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tasks Page ──

export function TasksPage() {
  const { projects, loading: projectsLoading, addProject, renameProject, updateProjectColor, removeProject } = useProjects()
  const { tasks, loading: tasksLoading, addTask, remove, refresh } = useLocalTasks()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [labels, setLabels] = useState<Label[]>([])

  const sidebarCollapsed = useLayoutStore((s) => s.tasksProjectSidebarCollapsed)
  const setSidebarCollapsed = useLayoutStore((s) => s.setTasksProjectSidebarCollapsed)

  const loading = projectsLoading || tasksLoading

  useEffect(() => {
    listLabels().then(setLabels).catch(() => {})
  }, [])

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

  // Find the selected project object
  const selectedProject = useMemo(() => {
    if (!selectedProjectId) return null
    return projects.find((p) => p.id === selectedProjectId) ?? null
  }, [selectedProjectId, projects])

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
      {/* Project sidebar */}
      {sidebarCollapsed ? (
        <div className="flex flex-col items-center gap-1 border-r border-border/20 bg-muted/10 py-2 px-1">
          {/* Collapsing the sidebar hides ProjectSidebar's own "All Tasks"
              row — the list header dropped its old PageHeader back-link
              (Task 5), so without this a project view has no way back to
              All Tasks while the sidebar is collapsed. Always show it here
              regardless of collapsed state. */}
          <IconButton
            onClick={() => setSelectedProjectId(null)}
            size="lg"
            title="All Tasks"
            className={cn(selectedProjectId === null && 'bg-accent/30 text-foreground')}
          >
            <List className="size-4" />
          </IconButton>
          <IconButton
            onClick={() => setSidebarCollapsed(false)}
            size="lg"
            title="Expand project sidebar"
          >
            <PanelLeftOpen className="size-4" />
          </IconButton>
        </div>
      ) : (
        <ProjectSidebar
          projects={projects}
          tasks={tasks}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onAddProject={addProject}
          onRenameProject={renameProject}
          onUpdateProjectColor={updateProjectColor}
          onDeleteProject={removeProject}
        />
      )}

      {/* Main content */}
      {selectedProject ? (
        <ProjectDetailPage
          // Remount on project switch — each project's view state
          // (groupBy/filter, section list) is loaded fresh rather than
          // patched over the previous project's.
          key={selectedProject.id}
          project={selectedProject}
          tasks={tasks}
          allProjects={projects}
          onSelectProject={setSelectedProjectId}
          onDeleteTask={remove}
          onAddSubtask={handleAddSubtask}
          onUpdated={refresh}
        />
      ) : (
        <AllTasksView
          tasks={tasks}
          visibleLabels={visibleLabels}
          onDelete={remove}
          onAddSubtask={handleAddSubtask}
          refresh={refresh}
        />
      )}
    </div>
  )
}
