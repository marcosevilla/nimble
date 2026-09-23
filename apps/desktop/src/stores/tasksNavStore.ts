import { create } from 'zustand'
import { EMPTY_LABEL_FILTER, type LabelFilter } from '@/lib/labelFilter'

// The Tasks page's selected project (null = All tasks) and the Labels
// filter from TaskListHeader. Both live here, not in TasksPage, because
// the project tree is in the left nav and stays mounted on every page:
// picking a project there, or a project segment in TaskDetailPage's
// breadcrumb, sets it before or after TasksPage mounts. `labelFilter`
// applies across both All Tasks and a single project view, so it's shared
// state rather than per-page — same reasoning. Session-persistent only
// (not written to localStorage), like `selectedProjectId`.
interface TasksNavState {
  selectedProjectId: string | null
  /** Show this project's list (null = All tasks). */
  selectProject: (id: string | null) => void
  /** Cross-page "open this project" (breadcrumbs); same as selectProject. */
  requestProject: (id: string) => void
  labelFilter: LabelFilter
  setLabelFilter: (f: LabelFilter) => void
}

export const useTasksNavStore = create<TasksNavState>((set) => ({
  selectedProjectId: null,
  selectProject: (id) => set({ selectedProjectId: id }),
  requestProject: (id) => set({ selectedProjectId: id }),
  labelFilter: EMPTY_LABEL_FILTER,
  setLabelFilter: (f) => set({ labelFilter: f }),
}))
