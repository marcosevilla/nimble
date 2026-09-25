/* Omnibar CREATE group (spec 2026-09-25 §1.6): which create rows show, in
   what order, and what each one creates. Pills carry over (label + project
   onto a new task; Doc/Goal/Project/Label ignore them; status pills never
   apply). The mapping is pure; `runCreate` is the thin effectful part and
   takes the provider so node tests can pass a fake. tests/omnibarCreate.test.mjs. */
import type { DataProvider, OmnibarCapability } from '@nimble/types'
import type { BarMode } from './commandBarMode.ts'
import type { ParsedCaptureDate } from './captureDate.ts'
import type { Pill } from './omnibarQuery.ts'
import { fold, pillFilters } from './omnibarQuery.ts'
import { DEFAULT_PROJECT_COLOR } from './projectColors.ts'
import { DEFAULT_LABEL_COLOR } from './labelColors.ts'

export type CreateKind = 'task' | 'note' | 'doc' | 'goal' | 'project' | 'label'

export const CREATE_ORDER: readonly CreateKind[] = ['task', 'note', 'doc', 'goal', 'project', 'label']

export const CREATE_NAME: Record<CreateKind, string> = {
  task: 'Task',
  note: 'Note',
  doc: 'Doc',
  goal: 'Goal',
  project: 'Project',
  label: 'Label',
}

export type CreateDate = Pick<ParsedCaptureDate, 'title' | 'dueDate' | 'dueTime'>

export interface TaskCreateArgs {
  content: string
  projectId?: string
  labelIds?: string[]
  dueDate?: string
  dueTime?: string
}

export interface Created {
  kind: CreateKind
  id: string
  name: string
}

export type CreateDp = Pick<DataProvider, 'tasks' | 'captures' | 'docs' | 'goals' | 'projects' | 'labels'>

/** The CREATE rows for this input, first row = Enter's fallback. `/task` and
 *  `/note` create only their kind; `/doc` and a `type:` pill promote theirs.
 *  Kinds this platform can't create are left out, and so is Label when that
 *  name already exists (labels.name is UNIQUE — archived ones included). */
export function createKinds(opts: {
  text: string
  mode: BarMode
  pills: readonly Pill[]
  capability: OmnibarCapability
  labelNames: readonly string[]
}): CreateKind[] {
  if (!opts.text.trim()) return []
  if (opts.mode === 'task') return ['task']
  if (opts.mode === 'capture') return ['note']
  if (opts.mode === 'route' || opts.mode === 'breakdown') return []
  const c = opts.capability
  const name = fold(opts.text)
  const allowed = CREATE_ORDER.filter((k) => {
    if (k === 'doc') return c.docs
    if (k === 'goal') return c.goals
    if (k === 'project') return c.createProject
    if (k === 'label') return c.createLabel && !opts.labelNames.some((n) => fold(n) === name)
    return true
  })
  const type = pillFilters(opts.pills).type
  const promoted: CreateKind | null = opts.mode === 'doc' ? 'doc' : type && type !== 'action' ? type : null
  if (!promoted || !allowed.includes(promoted)) return allowed
  return [promoted, ...allowed.filter((k) => k !== promoted)]
}

/** A new task from the text: label pills → labels (where the platform can
 *  set them on create), the project pill → its project, a parsed date → due. */
export function taskCreateArgs(text: string, pills: readonly Pill[], date: CreateDate | null, capability: OmnibarCapability): TaskCreateArgs {
  const f = pillFilters(pills)
  const args: TaskCreateArgs = { content: date ? date.title : text.trim() }
  if (f.projectId) args.projectId = f.projectId
  if (capability.taskLabelsOnCreate && f.labelIds.length > 0) args.labelIds = f.labelIds
  if (date) {
    args.dueDate = date.dueDate
    if (date.dueTime) args.dueTime = date.dueTime
  }
  return args
}

export async function runCreate(
  dp: CreateDp,
  kind: CreateKind,
  text: string,
  pills: readonly Pill[],
  date: CreateDate | null,
  capability: OmnibarCapability,
): Promise<Created> {
  const name = text.trim()
  switch (kind) {
    case 'task': {
      const task = await dp.tasks.create(taskCreateArgs(text, pills, date, capability))
      return { kind, id: task.id, name: task.content }
    }
    case 'note': {
      const capture = await dp.captures.create(name, 'command_bar')
      return { kind, id: capture.id, name }
    }
    case 'doc': {
      const doc = await dp.docs.createDocument(name)
      return { kind, id: doc.id, name: doc.title }
    }
    case 'goal': {
      const goal = await dp.goals.create({ name })
      return { kind, id: goal.id, name: goal.name }
    }
    case 'project': {
      const project = await dp.projects.create(name, DEFAULT_PROJECT_COLOR)
      return { kind, id: project.id, name: project.name }
    }
    case 'label': {
      const label = await dp.labels.create(name, DEFAULT_LABEL_COLOR)
      return { kind, id: label.id, name: label.name }
    }
  }
}

export function createdMessage(created: Created, dateLabel: string | null): string {
  if (created.kind === 'note') return `Note saved: "${created.name}"`
  const base = `${CREATE_NAME[created.kind]} created: "${created.name}"`
  return created.kind === 'task' && dateLabel ? `${base} · due ${dateLabel}` : base
}
