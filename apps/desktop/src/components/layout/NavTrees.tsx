import { useCallback, useEffect } from 'react'
// Window-to-window event bus, not data access — the web build aliases
// '@tauri-apps/api/event' to a no-op stub (src/platform/), so this stays
// portable. Not part of the DataProvider seam.
// eslint-disable-next-line no-restricted-imports
import { listen } from '@tauri-apps/api/event'
import { useLocalTasks, useProjects } from '@/hooks/useLocalTasks'
import { ProjectSidebar } from '@/components/tasks/ProjectSidebar'
import { FolderTree } from '@/components/docs/FolderTree'
import { useAppStore } from '@/stores/appStore'
import { useDetailStore } from '@/stores/detailStore'
import { useDocsStore } from '@/stores/docsStore'
import { useTasksNavStore } from '@/stores/tasksNavStore'

/** Tasks' project tree under the Tasks nav button. Picking a row shows that
 *  project's list on the Tasks page, closing an open task detail first. */
export function NavTasksTree() {
  const { projects, addProject, renameProject, updateProjectColor, removeProject } = useProjects()
  const { tasks } = useLocalTasks()
  const selectedProjectId = useTasksNavStore((s) => s.selectedProjectId)
  const onTasksPage = useAppStore((s) => s.currentPage === 'tasks')
  const selectProject = useTasksNavStore((s) => s.selectProject)

  const handleSelect = useCallback(
    (id: string | null) => {
      const detail = useDetailStore.getState()
      if (detail.target?.type === 'task' && detail.mode === 'body') detail.close()
      selectProject(id)
      useAppStore.getState().setCurrentPage('tasks')
    },
    [selectProject],
  )

  return (
    <ProjectSidebar
      projects={projects}
      tasks={tasks}
      selectedProjectId={onTasksPage ? selectedProjectId : undefined}
      onSelectProject={handleSelect}
      onAddProject={addProject}
      onRenameProject={renameProject}
      onUpdateProjectColor={updateProjectColor}
      onDeleteProject={removeProject}
    />
  )
}

/** Docs' folder tree, vault library and search under the Docs nav button.
 *  Picking a row opens it on the Docs page. */
export function NavDocsTree() {
  const refresh = useDocsStore((s) => s.refresh)
  const onDocsPage = useAppStore((s) => s.currentPage === 'docs')

  // The Docs page loads and live-refreshes this data while it's open; off
  // it, the tree does both itself.
  useEffect(() => {
    if (onDocsPage) return
    refresh()
    const unlisten = listen('vault-changed', () => { refresh() })
    return () => { unlisten.then((fn) => fn()) }
  }, [onDocsPage, refresh])

  // Opening a doc or note from the tree, its search or New document shows
  // the Docs page. Clicks on folders only expand them.
  const showDocs = () => useAppStore.getState().setCurrentPage('docs')
  const OPENS_DOCS = '[data-tree-row][data-kind="leaf"], [role="option"], [data-opens-docs]'

  return (
    <div
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest(OPENS_DOCS)) showDocs()
      }}
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).closest('[role="combobox"], [role="option"]')) showDocs()
      }}
    >
      <FolderTree />
    </div>
  )
}
