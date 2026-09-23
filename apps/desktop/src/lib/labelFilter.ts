// labelFilter.ts — pure predicate for the Tasks list header's "Labels"
// dropdown. `include` labels must ALL be present on the task; `exclude`
// labels must NONE be present. No value imports beyond what's needed at
// runtime, no `@/` aliases, so this loads under
// `node --experimental-strip-types`.

export type LabelFilter = { include: string[]; exclude: string[] }

export const EMPTY_LABEL_FILTER: LabelFilter = { include: [], exclude: [] }

export function matchesLabelFilter(taskLabelIds: string[], f: LabelFilter): boolean {
  const has = new Set(taskLabelIds)
  return f.include.every((id) => has.has(id)) && !f.exclude.some((id) => has.has(id))
}
