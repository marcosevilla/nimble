import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { SectionedTaskList } from '@/components/tasks/SectionedTaskList'
import { TaskListHeader } from '@/components/tasks/TaskListHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { PanelLeftOpen } from 'lucide-react'
import { ProjectSidebar } from '@/components/tasks/ProjectSidebar'
import { ProjectDetailPage } from '@/components/tasks/ProjectDetailPage'
import { IconButton } from '@/components/shared/IconButton'
import { useLayoutStore } from '@/stores/layoutStore'
import { listLabels, listSections } from '@/services/tauri'
import { filterTasks, groupTasks, loadTaskView, saveTaskView } from '@/lib/task-view'
import type { LocalTask, Label, Project, Section } from '@nimble/types'

// ── All Tasks View ──

function AllTasksView({
  projects,
  tasks,
  visibleLabels,
  onDelete,
  onAddSubtask,
  refresh,
}: {
  projects: Project[]
  tasks: LocalTask[]
  visibleLabels: Label[]
  onDelete: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  refresh: () => void
}) {
  const [sections, setSections] = useState<Section[]>([])
  const [viewState, setViewState] = useState(() => loadTaskView('all', 'status'))

  useEffect(() => {
    saveTaskView('all', viewState)
  }, [viewState])

  const setGroupBy = useCallback((groupBy: (typeof viewState)['groupBy']) => {
    setViewState((v) => ({ ...v, groupBy }))
  }, [])
  const setFilter = useCallback((filter: (typeof viewState)['filter']) => {
    setViewState((v) => ({ ...v, filter }))
  }, [])

  // Sections are scoped per-project — merge every project's lanes into one
  // flat list so a `section`/`manual` grouping can resolve titles for
  // tasks from any project. (Cross-project drag stays disabled below —
  // see `dragEnabled`.)
  const refreshSections = useCallback(() => {
    Promise.all(projects.map((p) => listSections(p.id)))
      .then((lists) => setSections(lists.flat()))
      .catch(() => {})
  }, [projects])

  useEffect(() => {
    refreshSections()
  }, [refreshSections])

  const handleUpdated = useCallback(() => {
    refresh()
    refreshSections()
  }, [refresh, refreshSections])

  const filteredTasks = useMemo(() => filterTasks(tasks, viewState.filter), [tasks, viewState.filter])
  const groups = useMemo(
    () => groupTasks(filteredTasks, viewState.groupBy, sections),
    [filteredTasks, viewState.groupBy, sections],
  )

  return (
    // scrollbar-gutter keeps centered content from shifting when the
    // classic 6px scrollbar appears after async content loads
    <div className="flex-1 overflow-y-auto flex flex-col min-w-0 [scrollbar-gutter:stable]">
      <div className="py-6 flex-1">
        <div className="w-full max-w-[600px] mx-auto min-w-0">
          <TaskListHeader
            title="Tasks"
            groupBy={viewState.groupBy}
            onGroupBy={setGroupBy}
            filter={viewState.filter}
            onFilter={setFilter}
            labels={visibleLabels}
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
              // read-only regardless of grouping; per-project drag still
              // works from ProjectDetailPage.
              dragEnabled={false}
              projects={projects}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              onUpdated={handleUpdated}
            />
          )}
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

  const handleAddTask = useCallback(
    async (content: string, extra?: { projectId?: string }) => {
      await addTask(content, extra)
    },
    [addTask],
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
        <div className="flex flex-col items-center border-r border-border/20 bg-muted/10 py-2 px-1">
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
          onAddTask={handleAddTask}
          onDeleteTask={remove}
          onAddSubtask={handleAddSubtask}
          onUpdated={refresh}
        />
      ) : (
        <AllTasksView
          projects={projects}
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
