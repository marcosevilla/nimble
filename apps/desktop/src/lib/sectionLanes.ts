/**
 * Project lane order shared by the project task view (`task-view.ts`) and
 * Focus project candidates (`focusSources.ts`), so the two cannot drift:
 * the unsectioned lane first, then sections by `position`. A task whose
 * section is unknown falls into the unsectioned lane.
 *
 * Type-only imports keep this loadable directly by node:test.
 */
import type { LocalTask, Section } from '@nimble/types'

// Sentinel container id for tasks with no section — shared with
// SectionedTaskList, which special-cases this key to skip rendering a
// section header (an unlabeled top lane, matching pre-Task-5 behavior).
export const UNSECTIONED = '__unsectioned__'

/** Sections in lane order (the unsectioned lane is implicit and first). */
export function orderedSections(sections: readonly Section[]): Section[] {
  return [...sections].sort((a, b) => a.position - b.position)
}

/** The lane key a task renders in, given the set of known section ids. */
export function laneKeyOf(task: Pick<LocalTask, 'section_id'>, known: ReadonlySet<string>): string {
  return task.section_id && known.has(task.section_id) ? task.section_id : UNSECTIONED
}
