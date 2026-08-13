import { create } from 'zustand'

// One-shot navigation-target handoff into TasksPage's local selected-project
// state. TasksPage is unmounted while a body-mode detail view is open
// (Dashboard renders a different branch), so a cross-page "open this
// project" click — e.g. a project segment in TaskDetailPage's breadcrumb —
// has no live component to talk to. The caller stashes the target here
// before navigating; TasksPage consumes it on mount (or immediately, if
// already mounted in sidebar mode) and clears it. Not a persisted
// selection — that stays TasksPage-local.
interface TasksNavState {
  pendingProjectId: string | null
  requestProject: (id: string) => void
  clearPendingProject: () => void
}

export const useTasksNavStore = create<TasksNavState>((set) => ({
  pendingProjectId: null,
  requestProject: (id) => set({ pendingProjectId: id }),
  clearPendingProject: () => set({ pendingProjectId: null }),
}))
