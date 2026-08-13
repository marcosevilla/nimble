import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionedTaskList } from '@/components/tasks/SectionedTaskList'
import { TaskListHeader } from '@/components/tasks/TaskListHeader'
import { PageDragRegion } from '@/components/shared/PageDragRegion'
import { Input } from '@/components/ui/input'
import { listSections, listLabels } from '@/services/tauri'
import { filterTasks, groupTasks, loadTaskView, saveTaskView } from '@/lib/task-view'
import { Plus } from 'lucide-react'
import type { Project, LocalTask, Section, Label } from '@nimble/types'

// ── Inline Task Creator ──

function TaskCreator({
  projectId,
  onAdd,
}: {
  projectId: string
  onAdd: (content: string, extra?: { projectId?: string }) => void
}) {
  const [value, setValue] = useState('')

  const handleSubmit = () => {
    const text = value.trim()
    if (!text) return
    onAdd(text, { projectId })
    setValue('')
  }

  return (
    <div className="pt-5 flex items-center gap-2 text-meta text-muted-foreground hover:text-foreground">
      <Plus className="size-3 shrink-0" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
        }}
        placeholder="Add a task..."
        className="h-7 text-body border-none shadow-none bg-transparent px-0 focus-visible:ring-0"
      />
    </div>
  )
}

interface ProjectDetailPageProps {
  project: Project
  tasks: LocalTask[]
  allProjects: Project[]
  onSelectProject: (id: string) => void
  onAddTask: (content: string, extra?: { projectId?: string }) => void
  onDeleteTask: (id: string) => void
  onAddSubtask: (parentId: string, content: string) => void
  onUpdated: () => void
}

export function ProjectDetailPage({
  project,
  tasks,
  allProjects,
  onSelectProject,
  onAddTask,
  onDeleteTask,
  onAddSubtask,
  onUpdated,
}: ProjectDetailPageProps) {
  const [sections, setSections] = useState<Section[]>([])
  const [labels, setLabels] = useState<Label[]>([])

  // Lazy-initialized from localStorage; the parent remounts this component
  // (key={project.id} in TasksPage) on project switch, so this only ever
  // needs to load once per mount rather than resync on prop change.
  const [viewState, setViewState] = useState(() => loadTaskView(project.id, 'section'))

  useEffect(() => {
    saveTaskView(project.id, viewState)
  }, [project.id, viewState])

  const setGroupBy = useCallback((groupBy: (typeof viewState)['groupBy']) => {
    setViewState((v) => ({ ...v, groupBy }))
  }, [])
  const setFilter = useCallback((filter: (typeof viewState)['filter']) => {
    setViewState((v) => ({ ...v, filter }))
  }, [])

  const refreshSections = useCallback(() => {
    listSections(project.id)
      .then(setSections)
      .catch(() => {})
  }, [project.id])

  useEffect(() => {
    refreshSections()
  }, [refreshSections])

  useEffect(() => {
    listLabels().then(setLabels).catch(() => {})
  }, [])

  // Sections can be created inline from the task editor (Task 11/13), so
  // refresh the lane list whenever a task mutation comes back, not just on
  // project switch.
  const handleUpdated = useCallback(() => {
    onUpdated()
    refreshSections()
  }, [onUpdated, refreshSections])

  const projectTasks = useMemo(() => {
    return tasks.filter((t) => t.project_id === project.id)
  }, [tasks, project.id])

  const filteredTasks = useMemo(
    () => filterTasks(projectTasks, viewState.filter),
    [projectTasks, viewState.filter],
  )

  const groups = useMemo(
    () => groupTasks(filteredTasks, viewState.groupBy, sections),
    [filteredTasks, viewState.groupBy, sections],
  )

  const dragEnabled = viewState.groupBy === 'section' || viewState.groupBy === 'manual'

  // Only surface labels that are actually applied to something in this
  // project — an empty label taxonomy in the filter menu is just noise.
  const usedLabelIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of projectTasks) for (const l of t.labels) set.add(l)
    return set
  }, [projectTasks])

  const visibleLabels = useMemo(
    () => labels.filter((l) => usedLabelIds.has(l.id)),
    [labels, usedLabelIds],
  )

  const parentProject = useMemo(
    () => (project.parent_id ? allProjects.find((p) => p.id === project.parent_id) ?? null : null),
    [project.parent_id, allProjects],
  )

  // Hidden entirely for top-level projects (Decision 2) — only nested
  // projects (parent_id set) show a `‹ Parent` breadcrumb back up.
  const breadcrumb = useMemo(
    () =>
      parentProject
        ? [{ label: parentProject.name, onClick: () => onSelectProject(parentProject.id) }]
        : undefined,
    [parentProject, onSelectProject],
  )

  const handleAddSubtask = useCallback(
    async (parentId: string, content: string) => {
      onAddSubtask(parentId, content)
    },
    [onAddSubtask],
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <PageDragRegion />
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        <div className="pb-6 min-w-0">
          <div className="w-full max-w-[600px] mx-auto min-w-0">
            <TaskListHeader
              title={project.name}
              breadcrumb={breadcrumb}
              groupBy={viewState.groupBy}
              onGroupBy={setGroupBy}
              filter={viewState.filter}
              onFilter={setFilter}
              labels={visibleLabels}
            />

            {/* Task list */}
            {filteredTasks.length === 0 ? (
              <p className="text-body text-muted-foreground text-center py-8">
                {projectTasks.length === 0 ? 'No tasks in this project yet.' : 'No tasks match this filter.'}
              </p>
            ) : (
              <SectionedTaskList
                groups={groups}
                allTasks={filteredTasks}
                dragEnabled={dragEnabled}
                projects={allProjects}
                projectName={project.name}
                projectColor={project.color}
                onDelete={onDeleteTask}
                onAddSubtask={handleAddSubtask}
                onUpdated={handleUpdated}
              />
            )}

            {/* Inline task creator */}
            <TaskCreator projectId={project.id} onAdd={onAddTask} />
          </div>
        </div>
      </div>
    </div>
  )
}
