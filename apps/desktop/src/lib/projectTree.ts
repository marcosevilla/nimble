// projectTree.ts — pure helper that turns the flat `projects` list into the
// root/children shape the sidebar renders: archived projects are excluded
// entirely, and a child whose parent is archived (or missing) surfaces as
// a root instead of disappearing. `import type` only (no value imports, no
// `@/` aliases) so this loads under `node --experimental-strip-types`.
import type { Project } from '@nimble/types'

export function buildProjectTree(projects: Project[]): {
  roots: Project[]
  childrenByParent: Record<string, Project[]>
} {
  const active = projects.filter((p) => !p.archived_at)
  const ids = new Set(active.map((p) => p.id))
  const roots: Project[] = []
  const childrenByParent: Record<string, Project[]> = {}
  for (const p of active) {
    if (p.parent_id && ids.has(p.parent_id)) {
      ;(childrenByParent[p.parent_id] ??= []).push(p)
    } else {
      roots.push(p)
    }
  }
  return { roots, childrenByParent }
}

/** Row keys the nav project tree renders, in order: "All tasks", then each
 *  root followed by its children unless it is collapsed. Feeds the roving
 *  tab stop (re-score tasks N-P1-1); pure for tests/projectTree. */
export function visibleProjectKeys(input: {
  roots: { id: string }[]
  childrenByParent: Record<string, { id: string }[]>
  collapsed: Set<string>
}): string[] {
  const keys = ['all']
  for (const root of input.roots) {
    keys.push(`project:${root.id}`)
    if (input.collapsed.has(root.id)) continue
    for (const child of input.childrenByParent[root.id] ?? []) keys.push(`project:${child.id}`)
  }
  return keys
}
