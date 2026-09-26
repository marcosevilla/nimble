import { useDataVersion } from '@/hooks/useDataVersion'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useDetailStore } from '@/stores/detailStore'
import { useTaskDetail } from '@/hooks/useTaskDetail'
import { useProjects } from '@/hooks/useLocalTasks'
import { useDataProvider } from '@/services/provider-context'
import type { Section, Label } from '@nimble/types'
import { useAppStore } from '@/stores/appStore'
import { useTasksNavStore } from '@/stores/tasksNavStore'
import { emitTasksChanged } from '@/hooks/useLocalTasks'
import { StatusDropdown } from '@/components/tasks/StatusDropdown'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkles, Plus, Ellipsis, ChevronLeft } from 'lucide-react'
import { taskToast } from '@/lib/taskToast'
import { useDeleteTasks } from '@/components/tasks/useDeleteTasks'
import { todayLocalISO } from '@/lib/recurrence'
import { lockedRecurrenceCopy, recurringCompletionNotice } from '@/lib/todoistRecurrence'
import { useTodoistSyncOn } from '@/hooks/useTodoistSyncOn'
import { useQuickCreateStore } from '@/stores/quickCreateStore'
import { InlineTitle } from './InlineTitle'
import { TiptapEditor } from '@/components/docs/TiptapEditor'
import { Textarea } from '@/components/ui/textarea'
import { MetadataChips, type ChipValues } from '@/components/tasks/MetadataChips'
import { taskPatchToUpdate } from '@/lib/taskPatch'
import { TaskItem, type TaskItemData } from '@/components/tasks/TaskItem'
import { SortableRows, SortableRow } from '@/components/tasks/SortableTaskList'
import { useSelectionStore } from '@/stores/selectionStore'
import { labelColor } from '@/lib/labelColors'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { orderTaskLabels } from '@/lib/labelTaxonomy'
import { DetailBreadcrumbs } from './DetailBreadcrumbs'
import { TaskActivityLog } from './TaskActivityLog'
import { FocusTaskHistory } from '@/components/focus/FocusTaskHistory'
import { FocusTaskMenuItems } from '@/components/focus/FocusTaskEntry'
import { useFocusTaskEntry, type FocusEntryTask } from '@/components/focus/useFocusTaskEntry'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'

export function TaskDetailPage() {
  const referenceVersion = useDataVersion('labels')
  const sectionVersion = useDataVersion('sections')
  const dp = useDataProvider()
  const target = useDetailStore((s) => s.target)
  const mode = useDetailStore((s) => s.mode)
  const close = useDetailStore((s) => s.close)
  const drillDown = useDetailStore((s) => s.drillDown)

  const { task, subtasks, project, loading } = useTaskDetail(target?.id ?? null)
  const { task: parentTask } = useTaskDetail(task?.parent_id ?? null)
  // `projects` (active-only) feeds the "Move to project…" picker below —
  // archived projects shouldn't be a move target.
  const { projects } = useProjects()

  // Subtask selection belongs to this page (C2): it starts empty — a list
  // selection from just before doesn't carry in — and clears when the page
  // goes (back to the list, drilling into another task), so it never bleeds
  // into a list either. Page switches clear it too (Dashboard).
  const targetId = target?.id
  useEffect(() => {
    useSelectionStore.getState().clear()
    return () => useSelectionStore.getState().clear()
  }, [targetId])

  const [breakingDown, setBreakingDown] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const [sections, setSections] = useState<Section[]>([])
  const [labels, setLabels] = useState<Label[]>([])

  useEffect(() => {
    dp.labels.list().then(setLabels).catch(() => setLabels([]))
  }, [dp, referenceVersion])

  useEffect(() => {
    if (!task?.project_id) {
      setSections([])
      return
    }
    dp.sections.list(task.project_id).then(setSections).catch(() => setSections([]))
  }, [dp, task?.project_id, sectionVersion])

  // Subtask rows: taxonomy order, system labels hidden (same as list rows).
  const { groups: labelGroups } = useLabelTaxonomy()

  const handleSaveTitle = useCallback(async (content: string) => {
    if (!task) return
    await dp.tasks.update({ id: task.id, content })
    emitTasksChanged()
  }, [task, dp])

  // Task 12 fix (review finding 1): unconditional markdown mode is a
  // corrupting load path for descriptions the one-time backfill hasn't
  // converted yet — loading an HTML description through the markdown parser
  // renders literal tag soup, and the next debounced save would persist that
  // garbled text as the new "markdown". Sniff per-row with the same
  // `<`-prefix heuristic the backfill migration uses (db::tasks::
  // preview_tasks_markdown_migration), so an un-migrated task keeps loading
  // and saving as HTML — lossless round-trip via TiptapEditor's HTML
  // path — until the Settings backfill converts it.
  //
  // Frozen for the life of this task view: keyed on `task?.id` only, not
  // `task?.description`, so a debounced save mid-edit (which changes
  // `task.description` to the just-saved value) can never flip the format
  // out from under an open editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not reacting to description changes, see comment above
  const descFormat = useMemo<'html' | 'markdown'>(() => {
    const initial = task?.description ?? ''
    return initial.trim().startsWith('<') ? 'html' : 'markdown'
  }, [task?.id])

  // Legacy-HTML path (descFormat === 'html') — UNTOUCHED. Same TiptapEditor,
  // same debounced autosave via onChange, same lastSavedDesc guard. Task 9
  // only replaces the editing surface for the markdown-canonical path below.
  const lastSavedDesc = useRef(task?.description ?? '')
  const handleSaveDescription = useCallback(async (description: string) => {
    if (!task) return
    // Skip if content hasn't actually changed (prevents save loops)
    if (description === lastSavedDesc.current) return
    lastSavedDesc.current = description
    await dp.tasks.update({ id: task.id, description })
    // Don't emit tasksChanged here — avoids refresh loop with Tiptap
  }, [task, dp])

  // Markdown-canonical path (Decision 15): raw string in, raw string out.
  // Never touches Tiptap's markdown serializer on the write side — the
  // display-only <TiptapEditor format="markdown"> below has no onChange, so
  // there is no callback it could even reach.
  const [descEditing, setDescEditing] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const descTextareaRef = useRef<HTMLTextAreaElement>(null)

  const startEditingDescription = useCallback(() => {
    if (!task) return
    setDescDraft(task.description ?? '')
    setDescEditing(true)
  }, [task])

  const cancelEditingDescription = useCallback(() => {
    setDescEditing(false)
    setDescDraft(task?.description ?? '')
  }, [task])

  const saveDescriptionDraft = useCallback(async () => {
    if (!task) return
    setDescEditing(false)
    if (descDraft === (task.description ?? '')) return
    try {
      await dp.tasks.update({ id: task.id, description: descDraft })
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to save description: ${e}`)
    }
  }, [task, dp, descDraft])

  const handleDescKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditingDescription()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      saveDescriptionDraft()
    }
  }, [cancelEditingDescription, saveDescriptionDraft])

  useEffect(() => {
    if (!descEditing) return
    requestAnimationFrame(() => {
      const el = descTextareaRef.current
      el?.focus()
      el?.setSelectionRange(el.value.length, el.value.length)
    })
  }, [descEditing])

  const handleAIBreakdown = useCallback(async () => {
    if (!task) return
    setBreakingDown(true)
    try {
      const subtaskTitles = await dp.ai.breakDownTask(task.content, task.description ?? undefined)
      let created = 0
      for (const content of subtaskTitles) {
        try {
          await dp.tasks.create({ content, parentId: task.id, projectId: task.project_id })
          created++
        } catch { /* skip */ }
      }
      dp.activity.log('task_breakdown_applied', task.id, { subtask_count: created }).catch(() => {})
      toast.success(`Created ${created} subtasks`)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Breakdown failed: ${e}`)
    } finally {
      setBreakingDown(false)
    }
  }, [task, dp])

  // Unified chip patch handler — same dp.tasks.update() call every other
  // field on this page already uses, just routed through MetadataChips'
  // single onChange(patch) contract instead of one handler per field. The
  // patch → update mapping lives in lib/taskPatch.ts, shared with the task
  // row's clickable marks.
  // Todoist owns this task's rule while sync is on: read-only here.
  const todoistSyncOn = useTodoistSyncOn()
  const recurrenceLocked = task ? lockedRecurrenceCopy(task, todoistSyncOn) : null
  const handleChipChange = useCallback(async (patch: Partial<ChipValues>) => {
    if (!task) return
    const updates = taskPatchToUpdate(task, patch, { recurrenceLocked: recurrenceLocked !== null })
    if (!updates) return

    try {
      await dp.tasks.update(updates)
      emitTasksChanged()
    } catch (e) {
      toast.error(`Failed to update task: ${e}`)
    }
  }, [task, dp, recurrenceLocked])

  const chipValues = useMemo<ChipValues>(() => ({
    priority: task?.priority ?? 1,
    due: {
      dueDate: task?.due_date ?? null,
      dueTime: task?.due_time ?? null,
      durationMinutes: task?.duration_minutes ?? null,
      recurrenceRule: task?.recurrence_rule ?? null,
    },
    labelIds: task?.labels ?? [],
    projectId: task?.project_id,
    sectionId: task?.section_id ?? null,
    linkedDocId: task?.linked_doc_id ?? null,
  }), [task])

  // Back control (Agentation pass 3, B3): one button to the nearest
  // ancestor — the parent task for a subtask, else the task's project.
  // Derived fresh from task/project data every render (unlike the shared
  // DetailBreadcrumbs, which replays the store's drillDown history), so it
  // is right no matter how the viewer arrived at this task. The full
  // project trail it replaced is one step up from there (the parent task's
  // own back control, or the sidebar's project tree).
  const backSegment = useMemo<{ label: string; onClick: () => void } | null>(() => {
    if (parentTask) {
      return {
        label: parentTask.content,
        onClick: () => useDetailStore.getState().openTask(parentTask.id, mode),
      }
    }
    if (!project) return null
    return {
      label: project.name,
      // TasksPage's selected-project is local state (and the component is
      // unmounted while a body-mode detail is open), so the target project
      // travels through the one-shot tasksNavStore handoff instead of a
      // prop or shared selection.
      onClick: () => {
        useTasksNavStore.getState().requestProject(project.id)
        close()
        useAppStore.getState().setCurrentPage('tasks')
      },
    }
  }, [project, parentTask, mode, close])

  const handleMoveToProject = useCallback(async (projectId: string) => {
    if (!task) return
    const targetProject = projects.find((p) => p.id === projectId)
    try {
      await dp.tasks.update({ id: task.id, projectId })
      emitTasksChanged()
      taskToast(`Moved to ${targetProject?.name ?? 'project'}`, task.id)
    } catch (e) {
      toast.error(`Failed to move: ${e}`)
    }
  }, [task, dp, projects])

  const handleDuplicateTask = useCallback(async () => {
    if (!task) return
    try {
      const created = await dp.tasks.create({
        content: task.content,
        description: task.description ?? undefined,
        projectId: task.project_id,
        parentId: task.parent_id ?? undefined,
        priority: task.priority,
        dueDate: task.due_date ?? undefined,
        dueTime: task.due_time ?? undefined,
        durationMinutes: task.duration_minutes ?? undefined,
        recurrenceRule: task.recurrence_rule ?? undefined,
        sectionId: task.section_id ?? undefined,
        labelIds: task.labels.length ? task.labels : undefined,
      })
      if (task.linked_doc_id) {
        await dp.tasks.update({ id: created.id, linkedDocId: task.linked_doc_id })
      }
      emitTasksChanged()
      taskToast('Task duplicated', created.id)
    } catch (e) {
      toast.error(`Failed to duplicate: ${e}`)
    }
  }, [task, dp])

  const handleCopyId = useCallback(() => {
    if (!task) return
    navigator.clipboard.writeText(task.id)
    toast.success('Task ID copied')
  }, [task])

  // A leaf leaves the page and deletes with Undo; a task with subtasks
  // confirms first (tasks audit P1-6, review I1 — see useDeleteTasks).
  const { requestDelete, dialog: deleteDialog } = useDeleteTasks()
  const handleDeleteTask = useCallback(() => {
    if (!task) return
    void requestDelete([task], close)
  }, [task, requestDelete, close])

  // Recurring tasks reschedule instead of completing (Task 8) — the row's
  // due date just advances, no guilt copy, just a quiet confirmation of
  // where it landed. Predicted client-side (see lib/recurrence) so the
  // toast can fire immediately rather than waiting on a refetch; this
  // mirrors the exact rule the backend is about to apply, so it stays right
  // even if it never gets the chance to double check the server's answer.
  // A Todoist-owned recurring task gets no prediction: Todoist picks the date.
  const handleTaskCompleted = useCallback(() => {
    if (!task) return
    const notice = recurringCompletionNotice(task, todayLocalISO())
    if (!notice) return
    taskToast(
      notice.kind === 'todoist' ? notice.message : `Rescheduled to ${format(parseISO(notice.nextDue), 'MMM d')}`,
      task.id,
    )
  }, [task])

  if (loading) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="space-y-4">
        <DetailBreadcrumbs />
        <p className="text-body text-muted-foreground">Task not found.</p>
      </div>
    )
  }

  const subtaskItems: TaskItemData[] = subtasks.map((sub) => ({
    id: sub.id,
    content: sub.content,
    priority: sub.priority,
    completed: sub.completed,
    status: sub.status,
    dueDate: sub.due_date,
    description: sub.description,
    source: 'local',
    labels: orderTaskLabels(sub.labels, labels, labelGroups).map((l) => ({ name: l.name, color: labelColor(l.color) })),
  }))
  const subtaskById = new Map(subtaskItems.map((item) => [item.id, item]))

  return (
    <>
    {deleteDialog}
    <div className="flex flex-col gap-6">
      {/* Top row: back control (left) + task actions "…" menu (right) —
          no paperclip (Decision 13); the Focus actions live in the menu
          (Agentation pass 3, B2). */}
      <div className="flex items-center justify-between gap-2 min-h-7">
        {backSegment ? (
          // One control, one tab stop: chevron and text both go back to the
          // nearest ancestor (the parent task, else the project). h-7 is the
          // 28px hit area — no negative margin, the page's scroll container
          // starts right above and would clip it; the ::after adds a little
          // below for edge clicks. The ring is inset for the same reason.
          // tabIndex={0} because WebKit skips plain buttons on Tab.
          <button
            type="button"
            tabIndex={0}
            onClick={backSegment.onClick}
            aria-label={`Back to ${backSegment.label}`}
            className="focus-ring focus-visible:-outline-offset-2 relative -ml-1.5 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-body text-muted-foreground transition-colors hover:text-foreground after:absolute after:inset-x-0 after:top-0 after:-bottom-1 after:content-['']"
          >
            <ChevronLeft className="size-3.5 shrink-0" />
            <span className="truncate max-w-[240px]">{backSegment.label}</span>
          </button>
        ) : (
          <div />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Task actions"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Ellipsis className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="w-56">
            <TaskFocusMenuSection task={task} />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to project…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.filter((p) => p.id !== task.project_id).map((p) => (
                  <DropdownMenuItem key={p.id} className="gap-2" onClick={() => handleMoveToProject(p.id)}>
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
                {projects.filter((p) => p.id !== task.project_id).length === 0 && (
                  <p className="px-1.5 py-1 text-label text-muted-foreground">No other projects</p>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={handleDuplicateTask}>Duplicate task</DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyId}>Copy ID</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActivityOpen(true)}>View activity…</DropdownMenuItem>
            <DropdownMenuItem onClick={handleAIBreakdown}>Break down with AI</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleDeleteTask}>
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status + Title — status icon matches the row size (StatusDropdown's
          default `sm`, same as TaskItem) and is vertically centered against
          the title's line via items-center, not a manual mt- nudge. */}
      <div className="flex items-center gap-2">
        <StatusDropdown taskId={task.id} status={task.status ?? 'todo'} dueDate={task.due_date} onComplete={handleTaskCompleted} />
        <div className="flex-1 min-w-0">
          <InlineTitle
            value={task.content}
            completed={task.completed}
            onSave={handleSaveTitle}
            className="text-display pl-4"
          />
        </div>
      </div>

      {/* Metadata chips — the reminder is one of them (B1) */}
      <MetadataChips
        values={chipValues}
        onChange={handleChipChange}
        context="details"
        projects={projects}
        sections={sections}
        labels={labels}
        reminderTask={task}
        recurrenceLocked={recurrenceLocked}
      />

      {/* Description + Subtasks — 48px gap between the two blocks (frame 79:2009).
          The description (first child, any of its three states) keeps the
          720 reading measure inside the 960 column; subtasks use the full row. */}
      <div className="flex flex-col gap-12 [&>*:first-child:not(textarea)]:max-w-measure">
        {/* Description — rich text with @mentions. Markdown-canonical
            (descFormat === 'markdown'): display is a read-only rendered
            markdown view; clicking anywhere swaps to a raw auto-grown
            Textarea seeded with task.description, blur/⌘Enter saves the
            RAW STRING verbatim, Esc reverts. Legacy-HTML tasks keep the
            original always-editable Tiptap surface untouched. */}
        {descFormat === 'markdown' ? (
          descEditing ? (
            <Textarea
              ref={descTextareaRef}
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={saveDescriptionDraft}
              onKeyDown={handleDescKeyDown}
              placeholder="Description"
              rows={1}
              variant="ghost"
              // The ghost well's -mx-2 px-2 already nets to the display
              // state's left edge (and keeps the caret clear of the page's
              // overflow-x-hidden scroll container); -my-1 cancels its py-1
              // so swapping display → edit doesn't move the subtasks below.
              // Measure + the well's 1rem bleed, so edit wraps exactly where
              // the 720 display does.
              className="-my-1 max-w-[calc(var(--container-measure)+1rem)] text-body placeholder:text-foreground/25"
            />
          ) : task.description ? (
            // TiptapEditor's shared editorProps force a 200px min-height
            // (sized for the docs editor) — override it for this compact,
            // read-only display so the 48px description→subtask gap below
            // is real space, not swallowed by dead min-height.
            <div onClick={startEditingDescription} className="cursor-text [&_.tiptap-editor]:min-h-0">
              <TiptapEditor key={task.id} content={task.description} format="markdown" />
            </div>
          ) : (
            <p onClick={startEditingDescription} className="text-body text-foreground/25 cursor-text">
              Description
            </p>
          )
        ) : (
          <TiptapEditor
            key={task.id}
            content={task.description ?? ''}
            onChange={handleSaveDescription}
            placeholder="Add a description..."
            format="html"
          />
        )}

        {/* Subtasks */}
        <div className="flex flex-col">
          <p className="text-body-strong pb-1">Subtask</p>

          {/* Same rows as the main lists (C1/C2): grip to reorder (pointer or
              grip → Space → arrows → Space), persisted with
              dp.tasks.reorder(subtask ids); a checkbox to select, with
              shift-click ranges over the subtasks in display order, acted
              on by the bulk action bar. */}
          {subtaskItems.length > 0 && (
            <SortableRows ids={subtaskItems.map((item) => item.id)} onReordered={emitTasksChanged}>
              {(order) => (
                <div className="space-y-0.5">
                  {order.map((id) => {
                    const item = subtaskById.get(id)
                    if (!item) return null
                    return (
                      <SortableRow key={id} id={id}>
                        {(dragHandleProps) => (
                          <TaskItem
                            task={item}
                            onOpen={() => drillDown({ type: 'task', id })}
                            allIds={order}
                            dragHandleProps={dragHandleProps}
                          />
                        )}
                      </SortableRow>
                    )
                  })}
                </div>
              )}
            </SortableRows>
          )}

          {/* AI breakdown loading state */}
          {breakingDown && (
            <div className="space-y-2 py-2 animate-in fade-in duration-(--transition-slow)">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  <Sparkles className="size-3.5 text-ai ai-star-1" />
                  <Sparkles className="size-3 text-ai/70 ai-star-2" />
                  <Sparkles className="size-2.5 text-ai/50 ai-star-3" />
                </div>
                <span className="text-meta text-muted-foreground">Breaking down with AI...</span>
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-7 w-full rounded-md" />
                <Skeleton className="h-7 w-5/6 rounded-md" />
                <Skeleton className="h-7 w-4/6 rounded-md" />
                <Skeleton className="h-7 w-5/6 rounded-md" />
              </div>
            </div>
          )}

          {!breakingDown && (
            <div className="pt-1">
              {/* Opens the shared QuickCreateDialog modal, seeded with this
                  task as parent, instead of swapping in an inline composer
                  (Marco QA round 3, item 3). */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    useQuickCreateStore
                      .getState()
                      .openCreate({ projectId: task.project_id, parentId: task.id })
                  }
                  className="flex items-center gap-2 text-left text-meta text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="size-3 shrink-0" />
                  Add subtask
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Focus time from the engine's history (not the activity log) */}
        <FocusTaskHistory taskId={task.id} />
      </div>

      {/* Activity log — moved off the page body into the gear menu's "View
          activity…" item (Marco QA item 1); reuses the same TaskActivityLog
          component inside a scrollable modal. */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <TaskActivityLog taskId={task.id} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </>
  )
}

/** The task menu's Focus section — the same items (and read-only reasons)
 * as a row's overflow menu; a completed task has none. */
function TaskFocusMenuSection({ task }: { task: FocusEntryTask }) {
  const { controls, toggle, start } = useFocusTaskEntry(task)
  if (!controls.visible) return null
  return (
    <>
      <FocusTaskMenuItems controls={controls} onToggle={toggle} onFocusNow={start} />
      <DropdownMenuSeparator />
    </>
  )
}
