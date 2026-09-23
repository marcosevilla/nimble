import { create } from 'zustand'

// The Tasks page's selected project (null = All tasks). It lives here, not
// in TasksPage, because the project tree is in the left nav and stays
// mounted on every page: picking a project there, or a project segment in
// TaskDetailPage's breadcrumb, sets it before or after TasksPage mounts.
// Not persisted across launches.
interface TasksNavState {
  selectedProjectId: string | null
  /** Show this project's list (null = All tasks). */
  selectProject: (id: string | null) => void
  /** Cross-page "open this project" (breadcrumbs); same as selectProject. */
  requestProject: (id: string) => void
}

export const useTasksNavStore = create<TasksNavState>((set) => ({
  selectedProjectId: null,
  selectProject: (id) => set({ selectedProjectId: id }),
  requestProject: (id) => set({ selectedProjectId: id }),
}))
