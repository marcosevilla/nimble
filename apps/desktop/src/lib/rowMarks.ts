/* Accessible names for a task row's clickable marks (loop 2 chunk 3, T1).
   Pure (no JSX, no `@/` imports) so `tests/rowMarks.test.mjs` can import it
   directly. The kind word comes first and the current value after it, so a
   screen reader hears what the control edits and what it holds now:
   "Priority: high" · "Due Aug 3" · "Label quick-win" · "Project Nimble". */

export type RowMark =
  | { kind: 'priority'; priority: number }
  | { kind: 'due'; label: string }
  | { kind: 'label'; name: string }
  | { kind: 'project'; name: string }

export type RowMarkKind = RowMark['kind']

export type PriorityWord = 'normal' | 'medium' | 'high' | 'urgent'

const PRIORITY_WORDS: PriorityWord[] = ['normal', 'medium', 'high', 'urgent']

/** 1 Normal · 2 Medium · 3 High · 4 Urgent (PriorityBars' scale); values
 * outside it clamp to the nearest end. */
export function priorityWord(priority: number): PriorityWord {
  const i = Math.min(Math.max(Math.round(priority), 1), 4) - 1
  return PRIORITY_WORDS[Number.isFinite(i) ? i : 0]
}

export function rowMarkName(mark: RowMark): string {
  switch (mark.kind) {
    case 'priority':
      return `Priority: ${priorityWord(mark.priority)}`
    case 'due':
      return `Due ${mark.label}`
    case 'label':
      return `Label ${mark.name}`
    case 'project':
      return `Project ${mark.name}`
  }
}
