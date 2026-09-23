// labelFilter.ts — pure predicate for the Tasks list header's Label facet
// (the Filter dropdown's "Label" section). `include` labels must ALL be
// present on the task; `exclude` labels must NONE be present. No value
// imports beyond what's needed at runtime, no `@/` aliases, so this loads
// under `node --experimental-strip-types`.

export type LabelFilter = { include: string[]; exclude: string[] }

export const EMPTY_LABEL_FILTER: LabelFilter = { include: [], exclude: [] }

export function matchesLabelFilter(taskLabelIds: string[], f: LabelFilter): boolean {
  const has = new Set(taskLabelIds)
  return f.include.every((id) => has.has(id)) && !f.exclude.some((id) => has.has(id))
}

/** Cycles one label's membership through the Label facet's tri-state UI
 * flow: off (in neither) → include ("only") → exclude ("hide") → off.
 * Pure — returns a new LabelFilter, never mutates `f`. */
export function cycleLabelInFilter(f: LabelFilter, id: string): LabelFilter {
  if (f.include.includes(id)) {
    return { include: f.include.filter((v) => v !== id), exclude: [...f.exclude, id] }
  }
  if (f.exclude.includes(id)) {
    return { include: f.include, exclude: f.exclude.filter((v) => v !== id) }
  }
  return { include: [...f.include, id], exclude: f.exclude }
}
