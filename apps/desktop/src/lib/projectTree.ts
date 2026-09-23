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
