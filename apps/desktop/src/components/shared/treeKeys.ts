/* Roving tree keys shared by the nav's Docs tree (FolderTree) and project
   tree (ProjectSidebar). Rows are real <button>s carrying data-tree-row /
   data-kind ("folder" | "leaf") / data-expanded / data-parent / data-key /
   data-deletable. One keydown handler on the role="tree" container reads
   those attributes, so every row type shares ↑ ↓ ← → Home End ⌫ without a
   per-row hook (docs audit P1-1, P2-8; re-score tasks N-P1-1). Enter/Space
   is the button's native click. `onRowKey` takes any other key; return
   true when it handled it. */

export function handleTreeKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  expand: (key: string) => void,
  collapse: (key: string) => void,
  requestDelete: (row: HTMLElement) => void,
  onRowKey?: (key: string, row: HTMLElement) => boolean,
) {
  const container = e.currentTarget
  // Rows inside a closing child list (inert while it animates out) are skipped.
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-tree-row]')).filter((r) => !r.closest('[inert]'))
  const active = document.activeElement as HTMLElement | null
  const idx = active ? rows.indexOf(active) : -1
  if (idx === -1) return
  const row = rows[idx]
  const focusAt = (i: number) => { rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus() }

  switch (e.key) {
    // Space is the row's native click. Stop it here so the Dashboard's
    // window-level Space (pause a focus session) never swallows it.
    case ' ': e.stopPropagation(); break
    case 'ArrowDown': e.preventDefault(); focusAt(idx + 1); break
    case 'ArrowUp': e.preventDefault(); focusAt(idx - 1); break
    case 'Home': e.preventDefault(); focusAt(0); break
    case 'End': e.preventDefault(); focusAt(rows.length - 1); break
    case 'ArrowRight': {
      e.preventDefault()
      if (row.dataset.kind === 'folder' && row.dataset.expanded === 'false') expand(row.dataset.key!)
      else if (row.dataset.kind === 'folder') focusAt(idx + 1)
      break
    }
    case 'ArrowLeft': {
      e.preventDefault()
      if (row.dataset.kind === 'folder' && row.dataset.expanded === 'true') { collapse(row.dataset.key!); break }
      const parent = row.dataset.parent
      if (parent) rows.find((r) => r.dataset.key === parent)?.focus()
      break
    }
    case 'Backspace':
    case 'Delete': {
      if (row.dataset.deletable === 'true') { e.preventDefault(); requestDelete(row) }
      break
    }
    default:
      if (!e.metaKey && !e.ctrlKey && !e.altKey && onRowKey?.(e.key, row)) e.preventDefault()
  }
}
