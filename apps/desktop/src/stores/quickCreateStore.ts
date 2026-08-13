import { create } from 'zustand'
import type { TaskComposerDefaults } from '@/components/tasks/TaskComposerCard'

// Global open/close + defaults for the single QuickCreateDialog instance
// mounted once in Dashboard.tsx. Modal-only task creation (Marco QA round
// 3, item 3) means every "Add a task" / "Add subtask" affordance across the
// app now opens this same dialog instead of mounting its own inline
// TaskComposerCard — they just call `openCreate()` with the defaults
// appropriate to where they live (current project/section, or a subtask's
// parent + project). The "Q" global shortcut calls `openCreate()` with no
// args, which falls back to Inbox — matching the dialog's prior hardcoded
// default.
interface QuickCreateState {
  open: boolean
  defaults: TaskComposerDefaults
  openCreate: (defaults?: TaskComposerDefaults) => void
  close: () => void
}

const INBOX_DEFAULTS: TaskComposerDefaults = { projectId: 'inbox' }

export const useQuickCreateStore = create<QuickCreateState>((set) => ({
  open: false,
  defaults: INBOX_DEFAULTS,
  openCreate: (defaults) => set({ open: true, defaults: defaults ?? INBOX_DEFAULTS }),
  close: () => set({ open: false }),
}))
