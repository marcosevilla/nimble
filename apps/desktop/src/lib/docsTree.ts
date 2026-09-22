/* Roving-tabindex bookkeeping for the Docs tree (docs audit P1-1, §1.5).
   `visibleTreeKeys` lists the row keys FolderTree renders, in render order;
   `pickRovingKey` chooses the single row Tab lands on. A selected doc inside
   a collapsed folder is not rendered, so it cannot be the tab stop — the
   first visible row takes over instead of leaving the tree unreachable.
   Pure, no JSX (tests/docsTree.test.mjs). */

export interface VaultNodeLike {
  path: string
  children: VaultNodeLike[]
  notes: { path: string }[]
}

export function visibleTreeKeys(input: {
  folders: { id: string }[]
  docsByFolder: Record<string, { id: string }[]>
  unfiled: { id: string }[]
  expandedFolders: Set<string>
  /** Root of the vault tree; null when the vault has no notes (header hidden). */
  vaultRoot: VaultNodeLike | null
  vaultExpanded: boolean
  expandedVaultFolders: Set<string>
}): string[] {
  const keys: string[] = []
  for (const folder of input.folders) {
    keys.push(`folder:${folder.id}`)
    if (input.expandedFolders.has(folder.id)) {
      for (const doc of input.docsByFolder[folder.id] ?? []) keys.push(`doc:${doc.id}`)
    }
  }
  for (const doc of input.unfiled) keys.push(`doc:${doc.id}`)
  if (input.vaultRoot) {
    keys.push('vault')
    if (input.vaultExpanded) walkVault(input.vaultRoot, input.expandedVaultFolders, keys)
  }
  return keys
}

function walkVault(node: VaultNodeLike, open: Set<string>, keys: string[]) {
  for (const child of node.children) {
    keys.push(`vault:${child.path}`)
    if (open.has(child.path)) walkVault(child, open, keys)
  }
  for (const note of node.notes) keys.push(`note:${note.path}`)
}

export function pickRovingKey(visible: string[], ...preferred: (string | null | undefined)[]): string | null {
  for (const key of preferred) if (key && visible.includes(key)) return key
  return visible[0] ?? null
}
