/**
 * TursoProvider — the web client's DataProvider implementation.
 *
 * SKELETON (step 2 of docs/web-client-architecture-decision.md §7). Every
 * method rejects. Reads land in step 3, writes in step 4.
 *
 * Two deliberate choices worth reading before extending this file:
 *
 * 1. Methods return a REJECTED PROMISE; they do not throw synchronously.
 *    App.tsx and useTheme guard their boot calls with `.catch()`, which only
 *    works for async rejection. A synchronous throw escapes the effect and
 *    blanks the page instead of degrading — which would defeat the entire
 *    point of this step (prove the build path, with the chrome rendering).
 *
 * 2. `settings.checkSetupComplete()` resolves `true` rather than rejecting.
 *    This is not a stub shortcut, it is the correct web semantics: there is
 *    no user-facing setup in the browser. Turso credentials live in Vercel
 *    environment variables behind `api/turso.ts` and are never reachable
 *    from client JS, so there is nothing for a setup dialog to collect.
 *    Rejecting here would park the web build permanently on SetupDialog.
 *
 * When implementing a method, delete its `ni(...)` and write the real thing.
 * The object is checked structurally against the DataProvider interface in
 * @nimble/types, so a missing or misnamed method is a compile error — that
 * is why this file is written out longhand instead of behind a Proxy.
 *
 * ⚠️ WRITES (step 4) must obey §3 of the architecture doc: re-read the FULL
 * row and write a complete snapshot, never a partial one. Receivers apply
 * snapshots with INSERT OR REPLACE, so any omitted column is destroyed on
 * every other device. Mobile gets this wrong today; do not copy it.
 */

import type { DataProvider } from '@nimble/types'

/** Thrown (as a rejection) by every not-yet-implemented provider method. */
export class WebNotImplementedError extends Error {
  // Declared explicitly rather than as a constructor parameter property —
  // `erasableSyntaxOnly` is enabled, which bans that syntax.
  readonly method: string

  constructor(method: string) {
    super(
      `${method}() is not implemented in the web client yet. ` +
        `See docs/web-client-architecture-decision.md §7 for the build sequence.`,
    )
    this.method = method
    this.name = 'WebNotImplementedError'
  }
}

/**
 * Builds a rejecting stand-in for one provider method.
 *
 * Returns `() => Promise<never>`, which TypeScript accepts in place of any
 * method signature on the interface: a zero-arg function is assignable to one
 * taking arguments, and `Promise<never>` is assignable to `Promise<T>`.
 */
function ni(method: string): () => Promise<never> {
  return () => Promise.reject(new WebNotImplementedError(method))
}

export function createTursoProvider(): DataProvider {
  return {
    settings: {
      // See note 2 in the file header — deliberately resolves.
      checkSetupComplete: () => Promise.resolve(true),
      get: ni('settings.get'),
      set: ni('settings.set'),
      getAll: ni('settings.getAll'),
      clearAll: ni('settings.clearAll'),
    },

    // Mac-only: reads and writes files in the Obsidian vault on disk.
    // Permanently unavailable on web (architecture doc §6).
    obsidian: {
      readTodayMd: ni('obsidian.readTodayMd'),
      toggleCheckbox: ni('obsidian.toggleCheckbox'),
      importCaptures: ni('obsidian.importCaptures'),
    },

    // Mac-only by choice: the Todoist migration and two-way sync stay on the
    // desktop. Web changes still reach Todoist via the Mac's pull (§3.4).
    todoist: {
      previewMigration: ni('todoist.previewMigration'),
      migrate: ni('todoist.migrate'),
      migratedIds: ni('todoist.migratedIds'),
    },

    // Out of v1: needs a CORS proxy for ICS feeds (§5).
    calendar: {
      fetchEvents: ni('calendar.fetchEvents'),
      getCachedEvents: ni('calendar.getCachedEvents'),
      getFeeds: ni('calendar.getFeeds'),
      addFeed: ni('calendar.addFeed'),
      removeFeed: ni('calendar.removeFeed'),
    },

    // v1 IN — step 3 (list) and step 4 (create).
    captures: {
      list: ni('captures.list'),
      create: ni('captures.create'),
      convertToTask: ni('captures.convertToTask'),
      delete: ni('captures.delete'),
      readQuickCaptures: ni('captures.readQuickCaptures'),
      writeQuickCapture: ni('captures.writeQuickCapture'),
    },

    captureRoutes: {
      list: ni('captureRoutes.list'),
      create: ni('captureRoutes.create'),
      update: ni('captureRoutes.update'),
      delete: ni('captureRoutes.delete'),
      route: ni('captureRoutes.route'),
    },

    // v1 IN — projects.list in step 3.
    projects: {
      list: ni('projects.list'),
      create: ni('projects.create'),
      update: ni('projects.update'),
      delete: ni('projects.delete'),
    },

    // v1 IN — labels.list in step 3, setForTask in step 5.
    labels: {
      list: ni('labels.list'),
      create: ni('labels.create'),
      update: ni('labels.update'),
      delete: ni('labels.delete'),
      setForTask: ni('labels.setForTask'),
    },

    // v1 IN — sections.list in step 3.
    sections: {
      list: ni('sections.list'),
      create: ni('sections.create'),
      rename: ni('sections.rename'),
      delete: ni('sections.delete'),
      reorder: ni('sections.reorder'),
    },

    // v1 IN — list in step 3; create/complete/uncomplete in step 4; update in
    // step 5. reorder is explicitly OUT of v1 (rewrites `position` across many
    // rows, §5).
    tasks: {
      list: ni('tasks.list'),
      create: ni('tasks.create'),
      update: ni('tasks.update'),
      updateStatus: ni('tasks.updateStatus'),
      complete: ni('tasks.complete'),
      uncomplete: ni('tasks.uncomplete'),
      delete: ni('tasks.delete'),
      reorder: ni('tasks.reorder'),
      previewMarkdownMigration: ni('tasks.previewMarkdownMigration'),
      migrateToMarkdown: ni('tasks.migrateToMarkdown'),
    },

    // v1 IN, READ-ONLY — step 6. Editing is deliberately never coming to web.
    docs: {
      getFolders: ni('docs.getFolders'),
      createFolder: ni('docs.createFolder'),
      renameFolder: ni('docs.renameFolder'),
      deleteFolder: ni('docs.deleteFolder'),
      getDocuments: ni('docs.getDocuments'),
      getDocument: ni('docs.getDocument'),
      createDocument: ni('docs.createDocument'),
      updateDocument: ni('docs.updateDocument'),
      deleteDocument: ni('docs.deleteDocument'),
      searchDocuments: ni('docs.searchDocuments'),
      getNotes: ni('docs.getNotes'),
      createNote: ni('docs.createNote'),
      deleteNote: ni('docs.deleteNote'),
      reorderNotes: ni('docs.reorderNotes'),
      previewMarkdownMigration: ni('docs.previewMarkdownMigration'),
      migrateToMarkdown: ni('docs.migrateToMarkdown'),
    },

    // v1 IN, READ-ONLY — step 6. The read half works because vault_notes is a
    // replicated index. saveNote/createNote/openInObsidian are permanently
    // Mac-only: whole-note writes go through vault/writer.rs, which hash-checks
    // against real files on disk that a browser cannot see (§5, OUT permanently).
    vault: {
      status: ni('vault.status'),
      rescan: ni('vault.rescan'),
      listNotes: ni('vault.listNotes'),
      getNote: ni('vault.getNote'),
      search: ni('vault.search'),
      backlinks: ni('vault.backlinks'),
      resolveLink: ni('vault.resolveLink'),
      saveNote: ni('vault.saveNote'),
      createNote: ni('vault.createNote'),
      openInObsidian: ni('vault.openInObsidian'),
    },

    activity: {
      log: ni('activity.log'),
      getLog: ni('activity.getLog'),
      getSummary: ni('activity.getSummary'),
    },

    // Out of v1: a timer you would run at your desk (§5).
    focus: {
      startSession: ni('focus.startSession'),
      endSession: ni('focus.endSession'),
      getActive: ni('focus.getActive'),
    },

    // Out of v1: the Today page needs AI priorities + calendar + the daily
    // review state machine — the biggest dependency cluster in the app (§5).
    dailyState: {
      get: ni('dailyState.get'),
      generatePriorities: ni('dailyState.generatePriorities'),
      readSessionLog: ni('dailyState.readSessionLog'),
      readDailyBrief: ni('dailyState.readDailyBrief'),
      listBriefDates: ni('dailyState.listBriefDates'),
      saveProgress: ni('dailyState.saveProgress'),
    },

    // Out of v1 (§5).
    goals: {
      list: ni('goals.list'),
      get: ni('goals.get'),
      create: ni('goals.create'),
      update: ni('goals.update'),
      delete: ni('goals.delete'),
      getMilestones: ni('goals.getMilestones'),
      createMilestone: ni('goals.createMilestone'),
      updateMilestone: ni('goals.updateMilestone'),
      deleteMilestone: ni('goals.deleteMilestone'),
      getLifeAreas: ni('goals.getLifeAreas'),
      createLifeArea: ni('goals.createLifeArea'),
      updateLifeArea: ni('goals.updateLifeArea'),
      deleteLifeArea: ni('goals.deleteLifeArea'),
      importFromVault: ni('goals.importFromVault'),
    },

    // Out of v1 (§5).
    habits: {
      list: ni('habits.list'),
      create: ni('habits.create'),
      update: ni('habits.update'),
      delete: ni('habits.delete'),
      log: ni('habits.log'),
      unlog: ni('habits.unlog'),
      getLogs: ni('habits.getLogs'),
      getHeatmap: ni('habits.getHeatmap'),
    },

    // Needs a serverless function so the Anthropic key stays server-side —
    // same leak problem as the Turso token. Never call it from browser JS (§6).
    ai: {
      breakDownTask: ni('ai.breakDownTask'),
    },

    system: {
      openUrl: ni('system.openUrl'),
      // Irrelevant on web: the web version updates when you deploy (§6).
      checkForUpdates: ni('system.checkForUpdates'),
      getDemoStatus: ni('system.getDemoStatus'),
      toggleDemoMode: ni('system.toggleDemoMode'),
    },

    // The web client is ONLINE-ONLY and reads Turso directly, so it has no
    // push/pull cycle of its own to expose — no local mirror, no watermark, no
    // sync_log bookkeeping (§3.5). These stay rejecting permanently; they are
    // not a step-3 gap.
    sync: {
      push: ni('sync.push'),
      pull: ni('sync.pull'),
      getStatus: ni('sync.getStatus'),
      configure: ni('sync.configure'),
      testConnection: ni('sync.testConnection'),
      initializeRemote: ni('sync.initializeRemote'),
      seedExisting: ni('sync.seedExisting'),
    },

    todoistSync: {
      syncNow: ni('todoistSync.syncNow'),
      status: ni('todoistSync.status'),
      setEnabled: ni('todoistSync.setEnabled'),
    },
  }
}
