/* Swatch palette for native projects (tasks P3-6). Projects store a raw hex
   string in `projects.color` (unlike labels, which store a Todoist color
   name — see labelColors.ts), so this is user data rendered as a dot, not a
   UI color: the one sanctioned hex list beside labelColors. Was duplicated
   byte-for-byte in ProjectSidebar and ProjectEditDialog. */
export const PROJECT_COLORS = [
  '#6366f1', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4', '#f43f5e', '#8b5cf6', '#14b8a6',
] as const

/** Fallback when a project has no stored color — the same indigo the label
 * importer uses, so an unset project and an unknown label look alike. */
export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0]
