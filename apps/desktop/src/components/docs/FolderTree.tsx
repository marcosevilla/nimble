import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { ChevronRight, ChevronsDownUp, Plus, FolderOpen, Folder, FileText, Trash2, PanelLeftClose, Vault, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/shared/IconButton'
import { Button } from '@/components/ui/button'
import { DocsSearch } from './DocsSearch'
import type { Document, VaultNoteSummary } from '@nimble/types'

/* Tree rows are real <button>s carrying data-tree-row / data-kind /
   data-expanded / data-parent / data-key. One keydown handler on the list
   (handleTreeKeyDown) reads those attributes so every row type — native
   folder, native doc, vault folder, vault note, the Vault header — shares
   the same ↑ ↓ ← → Home End ⌫ behaviour without a per-row hook (docs audit
   P1-1, P2-8). Enter/Space is the button's native click. */

const ROW = 'flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-foreground transition-colors duration-(--transition-fast)'
const ROW_WRAP = 'group relative flex items-center rounded-md transition-colors duration-(--transition-fast)'
const ACTION = 'relative flex size-6 shrink-0 items-center justify-center rounded-md transition-[opacity,color,background-color] duration-(--transition-fast) before:absolute before:-inset-1 hover:bg-hover'
const REVEAL = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

type ConfirmTarget = { kind: 'doc' | 'folder'; id: string; name: string }

export function handleTreeKeyDown(e: React.KeyboardEvent<HTMLElement>, expand: (key: string) => void, collapse: (key: string) => void, requestDelete: (row: HTMLElement) => void) {
  const container = e.currentTarget
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-tree-row]'))
  const active = document.activeElement as HTMLElement | null
  const idx = active ? rows.indexOf(active) : -1
  if (idx === -1) return
  const row = rows[idx]
  const focusAt = (i: number) => { rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus() }

  switch (e.key) {
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
  }
}

export function FolderTree() {
  const dp = useDataProvider()
  const folders = useDocsStore((s) => s.folders)
  const documents = useDocsStore((s) => s.documents)
  const selectedDocId = useDocsStore((s) => s.selectedDocId)
  const selectedFolderId = useDocsStore((s) => s.selectedFolderId)
  const selectDoc = useDocsStore((s) => s.selectDoc)
  const createDocument = useDocsStore((s) => s.createDocument)
  const setFolderTreeCollapsed = useDocsStore((s) => s.setFolderTreeCollapsed)
  const folderTreeWidth = useDocsStore((s) => s.folderTreeWidth)
  const setFolderTreeWidth = useDocsStore((s) => s.setFolderTreeWidth)
  const refresh = useDocsStore((s) => s.refresh)
  const vaultNotes = useDocsStore((s) => s.vaultNotes)
  const selectedVaultPath = useDocsStore((s) => s.selectedVaultPath)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)
  const vaultExpanded = useDocsStore((s) => s.vaultExpanded)
  const setVaultExpanded = useDocsStore((s) => s.setVaultExpanded)
  const [expandedVaultFolders, setExpandedVaultFolders] = useState<Set<string>>(new Set())
  const vaultTree = useMemo(() => buildVaultTree(vaultNotes), [vaultNotes])
  const setVaultFolder = useCallback((path: string, open: boolean) => {
    setExpandedVaultFolders((prev) => {
      const next = new Set(prev)
      if (open) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])
  const toggleVaultFolder = useCallback((path: string) => {
    setExpandedVaultFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(folders.map((f) => f.id)))
  const [newFolderInput, setNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ConfirmTarget | null>(null)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(220)
  const listRef = useRef<HTMLDivElement>(null)

  // Load on mount
  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-expand new folders
  useEffect(() => {
    setExpandedFolders(new Set(folders.map((f) => f.id)))
  }, [folders])

  // Group docs by folder
  const docsByFolder: Record<string, Document[]> = {}
  const unfiled: Document[] = []
  for (const doc of documents) {
    if (doc.folder_id) {
      if (!docsByFolder[doc.folder_id]) docsByFolder[doc.folder_id] = []
      docsByFolder[doc.folder_id].push(doc)
    } else {
      unfiled.push(doc)
    }
  }

  const setFolder = (id: string, open: boolean) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const toggleFolder = (id: string) => setFolder(id, !expandedFolders.has(id))

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      await dp.docs.createFolder(name)
      setNewFolderName('')
      setNewFolderInput(false)
      refresh()
    } catch (e) {
      toast.error(`Couldn't create the folder — ${e}`)
    }
  }, [newFolderName, refresh, dp])

  const handleCreateDoc = useCallback(async (folderId?: string) => {
    try {
      await createDocument(folderId)
    } catch (e) {
      toast.error(`Couldn't create the document — ${e}`)
    }
  }, [createDocument])

  const handleDeleteDoc = useCallback(async (id: string) => {
    try {
      await dp.docs.deleteDocument(id)
      if (selectedDocId === id) selectDoc(null)
      refresh()
    } catch (e) {
      toast.error(`Couldn't delete — ${e}`)
    }
  }, [selectedDocId, selectDoc, refresh, dp])

  const handleDeleteFolder = useCallback(async (id: string) => {
    try {
      await dp.docs.deleteFolder(id)
      refresh()
    } catch (e) {
      toast.error(`Couldn't delete the folder — ${e}`)
    }
  }, [refresh, dp])

  const runConfirmedDelete = useCallback(() => {
    if (!confirmDelete) return
    if (confirmDelete.kind === 'doc') handleDeleteDoc(confirmDelete.id)
    else handleDeleteFolder(confirmDelete.id)
    setConfirmDelete(null)
  }, [confirmDelete, handleDeleteDoc, handleDeleteFolder])

  // Roving-tree key routing: which row types expand/collapse how.
  const expandKey = useCallback((key: string) => {
    if (key === 'vault') setVaultExpanded(true)
    else if (key.startsWith('vault:')) setVaultFolder(key.slice(6), true)
    else if (key.startsWith('folder:')) setFolder(key.slice(7), true)
  }, [setVaultExpanded, setVaultFolder]) // eslint-disable-line react-hooks/exhaustive-deps
  const collapseKey = useCallback((key: string) => {
    if (key === 'vault') setVaultExpanded(false)
    else if (key.startsWith('vault:')) setVaultFolder(key.slice(6), false)
    else if (key.startsWith('folder:')) setFolder(key.slice(7), false)
  }, [setVaultExpanded, setVaultFolder]) // eslint-disable-line react-hooks/exhaustive-deps
  const requestDelete = useCallback((row: HTMLElement) => {
    const key = row.dataset.key ?? ''
    const name = row.dataset.name ?? ''
    if (key.startsWith('doc:')) setConfirmDelete({ kind: 'doc', id: key.slice(4), name })
    else if (key.startsWith('folder:')) setConfirmDelete({ kind: 'folder', id: key.slice(7), name })
  }, [])

  // Roving tabindex: exactly one row is reachable by Tab — the selected
  // one, else the first. Arrow keys move focus from there (§1.5).
  const activeKey = selectedDocId
    ? `doc:${selectedDocId}`
    : selectedVaultPath
      ? `note:${selectedVaultPath}`
      : null
  const firstKeyRef = useRef<string | null>(null)
  firstKeyRef.current = null
  const tabIndexFor = (key: string) => {
    if (activeKey) return activeKey === key ? 0 : -1
    if (firstKeyRef.current === null) { firstKeyRef.current = key; return 0 }
    return -1
  }

  // Resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    startX.current = e.clientX
    startWidth.current = folderTreeWidth
  }, [folderTreeWidth])

  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    function handleMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX.current
      setFolderTreeWidth(Math.min(400, Math.max(160, startWidth.current + delta)))
    }
    function handleMouseUp() {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, setFolderTreeWidth])

  const renderConfirm = (target: ConfirmTarget, indent?: boolean) => (
    <div className={cn('flex h-8 items-center gap-1 px-1.5', indent && 'ml-4')} role="alertdialog" aria-label={`Delete ${target.name}?`}>
      <span className="flex-1 truncate text-label text-destructive">Delete {target.name}?</span>
      <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={runConfirmedDelete} aria-label={`Confirm delete ${target.name}`} autoFocus>
        <Check className="size-3" />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={() => setConfirmDelete(null)} aria-label="Keep it">
        <X className="size-3" />
      </Button>
    </div>
  )

  const renderDocRow = (doc: Document, parentKey: string | null) => {
    const key = `doc:${doc.id}`
    const name = doc.title || 'Untitled'
    if (confirmDelete?.kind === 'doc' && confirmDelete.id === doc.id) return <div key={doc.id}>{renderConfirm(confirmDelete)}</div>
    const selected = selectedDocId === doc.id
    return (
      <div key={doc.id} className={cn(ROW_WRAP, selected ? 'bg-muted' : 'hover:bg-hover')}>
        <button
          type="button"
          onClick={() => selectDoc(doc.id)}
          data-tree-row
          data-kind="leaf"
          data-key={key}
          data-name={name}
          data-deletable="true"
          data-parent={parentKey ?? undefined}
          tabIndex={tabIndexFor(key)}
          aria-current={selected ? 'true' : undefined}
          className={cn(ROW, selected ? 'text-meta-strong' : 'text-meta')}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete({ kind: 'doc', id: doc.id, name })}
          tabIndex={-1}
          aria-label={`Delete ${name}`}
          className={cn(ACTION, REVEAL, 'mr-0.5 text-destructive/40 hover:text-destructive')}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="relative flex flex-col border-r border-border/20 bg-muted/10 overflow-hidden"
      style={{ width: folderTreeWidth }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
        <span className="text-label text-muted-foreground">Docs</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            onClick={() => handleCreateDoc(selectedFolderId ?? undefined)}
            size="sm"
            title="New document (N)"
            aria-label="New document"
          >
            <Plus className="size-3" />
          </IconButton>
          <IconButton
            onClick={() => setFolderTreeCollapsed(true)}
            size="sm"
            title="Collapse"
            aria-label="Collapse the folder tree"
          >
            <PanelLeftClose className="size-3" />
          </IconButton>
        </div>
      </div>

      <DocsSearch />

      {/* Folder list */}
      <div
        ref={listRef}
        role="tree"
        aria-label="Docs and vault"
        className="flex-1 overflow-y-auto p-1.5 space-y-0.5"
        onKeyDown={(e) => handleTreeKeyDown(e, expandKey, collapseKey, requestDelete)}
      >
        {folders.map((folder) => {
          const key = `folder:${folder.id}`
          const open = expandedFolders.has(folder.id)
          return (
            <div key={folder.id}>
              {confirmDelete?.kind === 'folder' && confirmDelete.id === folder.id ? renderConfirm(confirmDelete) : (
                <div className={cn(ROW_WRAP, 'hover:bg-hover')}>
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder.id)}
                    data-tree-row
                    data-kind="folder"
                    data-key={key}
                    data-name={folder.name}
                    data-deletable="true"
                    data-expanded={open ? 'true' : 'false'}
                    tabIndex={tabIndexFor(key)}
                    aria-expanded={open}
                    className={cn(ROW, 'text-meta')}
                  >
                    <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)', open && 'rotate-90')} />
                    {open ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  </button>
                  <div className={cn('flex items-center gap-0.5 pr-0.5', REVEAL)}>
                    <button
                      type="button"
                      onClick={() => handleCreateDoc(folder.id)}
                      tabIndex={-1}
                      aria-label={`New document in ${folder.name}`}
                      className={cn(ACTION, 'text-muted-foreground hover:text-foreground')}
                    >
                      <Plus className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ kind: 'folder', id: folder.id, name: folder.name })}
                      tabIndex={-1}
                      aria-label={`Delete folder ${folder.name}`}
                      className={cn(ACTION, 'text-destructive/40 hover:text-destructive')}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              )}

              {open && (
                <div className="ml-4 space-y-0.5" role="group">
                  {(docsByFolder[folder.id] || []).map((doc) => renderDocRow(doc, key))}
                </div>
              )}
            </div>
          )
        })}

        {/* Unfiled docs */}
        {unfiled.length > 0 && (
          <div>
            <div className="flex items-center gap-1 px-1.5 py-1">
              <span className="text-label text-muted-foreground">Unfiled</span>
            </div>
            <div className="space-y-0.5" role="group">
              {unfiled.map((doc) => renderDocRow(doc, null))}
            </div>
          </div>
        )}

        {/* Vault notes */}
        {vaultNotes.length > 0 && (
          <div className="pt-2">
            <div className={cn(ROW_WRAP, 'hover:bg-hover')}>
              <button
                type="button"
                onClick={() => setVaultExpanded(!vaultExpanded)}
                data-tree-row
                data-kind="folder"
                data-key="vault"
                data-expanded={vaultExpanded ? 'true' : 'false'}
                tabIndex={tabIndexFor('vault')}
                aria-expanded={vaultExpanded}
                className={cn(ROW, 'text-label text-muted-foreground')}
              >
                <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-(--transition-fast)', vaultExpanded && 'rotate-90')} />
                <Vault className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">Vault</span>
                <span className="tabular-nums">{vaultNotes.length}</span>
              </button>
              {vaultExpanded && expandedVaultFolders.size > 0 && (
                <IconButton
                  onClick={() => setExpandedVaultFolders(new Set())}
                  size="sm"
                  title="Collapse all folders"
                  aria-label="Collapse all vault folders"
                  className="mr-0.5"
                >
                  <ChevronsDownUp className="size-3" />
                </IconButton>
              )}
            </div>

            {vaultExpanded && (
              <div className="ml-4 space-y-0.5" role="group">
                <VaultBranch
                  node={vaultTree}
                  parentKey="vault"
                  expanded={expandedVaultFolders}
                  onToggle={toggleVaultFolder}
                  selectedPath={selectedVaultPath}
                  onSelect={selectVaultNote}
                  tabIndexFor={tabIndexFor}
                />
              </div>
            )}
          </div>
        )}

        {/* New folder input */}
        {newFolderInput ? (
          <div className="px-1.5 py-1">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') { setNewFolderInput(false); setNewFolderName('') }
              }}
              onBlur={() => { if (!newFolderName.trim()) setNewFolderInput(false) }}
              placeholder="Folder name"
              aria-label="New folder name"
              className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground border-b border-border/20 py-0.5"
              autoFocus
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNewFolderInput(true)}
            className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-meta text-muted-foreground hover:text-foreground hover:bg-hover transition-colors duration-(--transition-fast)"
          >
            <Plus className="size-3" />
            New folder
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        aria-hidden="true"
        className={cn(
          'absolute right-0 top-0 bottom-0 z-10 w-px cursor-col-resize transition-colors bg-border/20',
          dragging ? 'bg-accent-blue/50 w-1' : 'hover:bg-accent-blue/30 hover:w-1',
        )}
      />
    </div>
  )
}

/** One level of the vault tree: subfolders first (like Obsidian), then notes. */
function VaultBranch({
  node,
  parentKey,
  expanded,
  onToggle,
  selectedPath,
  onSelect,
  tabIndexFor,
}: {
  node: VaultTreeNode
  parentKey: string
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedPath: string | null
  onSelect: (path: string) => void
  tabIndexFor: (key: string) => number
}) {
  return (
    <>
      {node.children.map((child) => {
        const isOpen = expanded.has(child.path)
        const key = `vault:${child.path}`
        return (
          <div key={child.path}>
            <div className={cn(ROW_WRAP, 'hover:bg-hover')}>
              <button
                type="button"
                onClick={() => onToggle(child.path)}
                title={child.path}
                data-tree-row
                data-kind="folder"
                data-key={key}
                data-parent={parentKey}
                data-expanded={isOpen ? 'true' : 'false'}
                tabIndex={tabIndexFor(key)}
                aria-expanded={isOpen}
                className={cn(ROW, 'text-meta')}
              >
                <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform duration-(--transition-fast)', isOpen && 'rotate-90')} />
                {isOpen ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate text-left">{child.name}</span>
              </button>
            </div>
            {isOpen && (
              <div className="ml-4 space-y-0.5" role="group">
                <VaultBranch
                  node={child}
                  parentKey={key}
                  expanded={expanded}
                  onToggle={onToggle}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  tabIndexFor={tabIndexFor}
                />
              </div>
            )}
          </div>
        )
      })}
      {node.notes.map((note) => {
        const key = `note:${note.path}`
        const selected = selectedPath === note.path
        return (
          <div key={note.id} className={cn(ROW_WRAP, selected ? 'bg-muted' : 'hover:bg-hover')}>
            <button
              type="button"
              onClick={() => onSelect(note.path)}
              title={note.path}
              data-tree-row
              data-kind="leaf"
              data-key={key}
              data-parent={parentKey}
              tabIndex={tabIndexFor(key)}
              aria-current={selected ? 'true' : undefined}
              className={cn(ROW, selected ? 'text-meta-strong' : 'text-meta')}
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{note.title || note.path}</span>
            </button>
          </div>
        )
      })}
    </>
  )
}

export interface VaultTreeNode {
  /** Last path segment, shown as the folder label. */
  name: string
  /** Full vault-relative folder path — the key for expand/collapse state. */
  path: string
  children: VaultTreeNode[]
  /** Notes directly in this folder (not in subfolders). */
  notes: VaultNoteSummary[]
}

/**
 * Build a nested folder tree mirroring the vault's real hierarchy —
 * `journal/reflections/note.md` nests under `journal` → `reflections`
 * instead of one flat `journal/reflections` group. Returns the root:
 * its `notes` are vault-root notes, its `children` the top-level folders.
 * Folders and notes sort A–Z at every level.
 */
export function buildVaultTree(notes: VaultNoteSummary[]): VaultTreeNode {
  const root: VaultTreeNode = { name: '', path: '', children: [], notes: [] }
  const byPath = new Map<string, VaultTreeNode>([['', root]])

  const folderFor = (path: string): VaultTreeNode => {
    const existing = byPath.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parent = folderFor(slash === -1 ? '' : path.slice(0, slash))
    const node: VaultTreeNode = {
      name: slash === -1 ? path : path.slice(slash + 1),
      path,
      children: [],
      notes: [],
    }
    parent.children.push(node)
    byPath.set(path, node)
    return node
  }

  for (const note of notes) {
    const slash = note.path.lastIndexOf('/')
    folderFor(slash === -1 ? '' : note.path.slice(0, slash)).notes.push(note)
  }

  for (const node of byPath.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    node.notes.sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path))
  }
  return root
}
