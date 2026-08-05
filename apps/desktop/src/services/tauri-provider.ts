/**
 * TauriProvider — Desktop implementation of DataProvider.
 *
 * Thin delegation layer: each method calls the corresponding
 * invoke() wrapper from tauri.ts. No logic, no transforms.
 */

import type { DataProvider } from './data-provider'
import * as tauri from './tauri'

export function createTauriProvider(): DataProvider {
  return {
    settings: {
      checkSetupComplete: tauri.checkSetupComplete,
      get: tauri.getSetting,
      set: tauri.setSetting,
      getAll: tauri.getAllSettings,
      clearAll: tauri.clearAllSettings,
    },

    obsidian: {
      readTodayMd: tauri.readTodayMd,
      toggleCheckbox: tauri.toggleObsidianCheckbox,
      importCaptures: tauri.importObsidianCaptures,
    },

    todoist: {
      previewMigration: tauri.previewTodoistMigration,
      migrate: tauri.migrateTodoist,
      migratedIds: tauri.migratedTodoistIds,
    },

    calendar: {
      fetchEvents: tauri.fetchCalendarEvents,
      getCachedEvents: tauri.getCachedCalendarEvents,
      getFeeds: tauri.getCalendarFeeds,
      addFeed: tauri.addCalendarFeed,
      removeFeed: tauri.removeCalendarFeed,
    },

    captures: {
      list: tauri.getCaptures,
      create: tauri.createCapture,
      convertToTask: tauri.convertCaptureToTask,
      delete: tauri.deleteCapture,
      readQuickCaptures: tauri.readQuickCaptures,
      writeQuickCapture: tauri.writeQuickCapture,
    },

    captureRoutes: {
      list: tauri.getCaptureRoutes,
      create: tauri.createCaptureRoute,
      update: tauri.updateCaptureRoute,
      delete: tauri.deleteCaptureRoute,
      route: tauri.routeCapture,
    },

    projects: {
      list: tauri.getProjects,
      create: tauri.createProject,
      update: tauri.updateProject,
      delete: tauri.deleteProject,
    },

    tasks: {
      list: tauri.getLocalTasks,
      create: tauri.createLocalTask,
      update: tauri.updateLocalTask,
      updateStatus: tauri.updateTaskStatus,
      complete: tauri.completeLocalTask,
      uncomplete: tauri.uncompleteLocalTask,
      delete: tauri.deleteLocalTask,
      reorder: tauri.reorderLocalTasks,
    },

    docs: {
      getFolders: tauri.getDocFolders,
      createFolder: tauri.createDocFolder,
      renameFolder: tauri.renameDocFolder,
      deleteFolder: tauri.deleteDocFolder,
      getDocuments: tauri.getDocuments,
      getDocument: tauri.getDocument,
      createDocument: tauri.createDocument,
      updateDocument: tauri.updateDocument,
      deleteDocument: tauri.deleteDocument,
      searchDocuments: tauri.searchDocuments,
      getNotes: tauri.getDocNotes,
      createNote: tauri.createDocNote,
      deleteNote: tauri.deleteDocNote,
      reorderNotes: tauri.reorderDocNotes,
      previewMarkdownMigration: tauri.previewDocsMarkdownMigration,
      migrateToMarkdown: tauri.migrateDocsToMarkdown,
    },

    activity: {
      log: tauri.logActivity,
      getLog: tauri.getActivityLog,
      getSummary: tauri.getActivitySummary,
    },

    focus: {
      startSession: tauri.startFocusSession,
      endSession: tauri.endFocusSession,
      getActive: tauri.getActiveFocus,
    },

    dailyState: {
      get: tauri.getDailyState,
      generatePriorities: tauri.generatePriorities,
      readSessionLog: tauri.readSessionLog,
      readDailyBrief: tauri.readDailyBrief,
      listBriefDates: tauri.listBriefDates,
      saveProgress: tauri.saveProgress,
    },

    goals: {
      list: tauri.getGoals,
      get: tauri.getGoal,
      create: tauri.createGoal,
      update: tauri.updateGoal,
      delete: tauri.deleteGoal,
      getMilestones: tauri.getMilestones,
      createMilestone: tauri.createMilestone,
      updateMilestone: tauri.updateMilestone,
      deleteMilestone: tauri.deleteMilestone,
      getLifeAreas: tauri.getLifeAreas,
      createLifeArea: tauri.createLifeArea,
      updateLifeArea: tauri.updateLifeArea,
      deleteLifeArea: tauri.deleteLifeArea,
      importFromVault: tauri.importGoalsFromVault,
    },

    habits: {
      list: tauri.getHabits,
      create: tauri.createHabit,
      update: tauri.updateHabit,
      delete: tauri.deleteHabit,
      log: tauri.logHabit,
      unlog: tauri.unlogHabit,
      getLogs: tauri.getHabitLogs,
      getHeatmap: tauri.getHabitHeatmap,
    },

    ai: {
      breakDownTask: tauri.breakDownTask,
    },

    system: {
      openUrl: tauri.openUrl,
      checkForUpdates: tauri.checkForUpdates,
      getDemoStatus: tauri.getDemoStatus,
      toggleDemoMode: tauri.toggleDemoMode,
    },

    sync: {
      push: tauri.syncPush,
      pull: tauri.syncPull,
      getStatus: tauri.syncGetStatus,
      configure: tauri.syncConfigure,
      testConnection: tauri.syncTestConnection,
      initializeRemote: tauri.syncInitializeRemote,
      seedExisting: tauri.syncSeedExisting,
    },

    todoistSync: {
      syncNow: tauri.todoistSyncNow,
      status: tauri.getTodoistSyncStatus,
      setEnabled: tauri.setTodoistSyncEnabled,
    },
  }
}
