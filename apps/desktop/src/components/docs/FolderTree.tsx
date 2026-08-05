import { useState, useCallback, useEffect, useRef } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { ChevronRight, Plus, FolderOpen, Folder, FileText, Trash2, PanelLeftClose, Vault } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/shared/IconButton'
import type { Document, VaultNoteSummary } from '@daily-triage/types'

export function FolderTree() {
  const dp = useDataProvider()
  const folders = useDocsStore((s) => s.folders)
  const documents = useDocsStore((s) => s.documents)
  const selectedDocId = useDocsStore((s) => s.selectedDocId)
  const selectedFolderId = useDocsStore((s) => s.selectedFolderId)
  const selectDoc = useDocsStore((s) => s.selectDoc)
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

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(folders.map((f) => f.id)))
  const [newFolderInput, setNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(220)

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

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name) return
    try {
      await dp.docs.createFolder(name)
      setNewFolderName('')
      setNewFolderInput(false)
      refresh()
    } catch (e) {
      toast.error(`Failed to create folder: ${e}`)
    }
  }, [newFolderName, refresh, dp])

  const handleCreateDoc = useCallback(async (folderId?: string) => {
    try {
      const doc = await dp.docs.createDocument('Untitled', folderId)
      await refresh()
      selectDoc(doc.id)
    } catch (e) {
      toast.error(`Failed to create document: ${e}`)
    }
  }, [refresh, selectDoc, dp])

  const handleDeleteDoc = useCallback(async (id: string) => {
    try {
      await dp.docs.deleteDocument(id)
      if (selectedDocId === id) selectDoc(null)
      refresh()
    } catch (e) {
      toast.error(`Failed to delete: ${e}`)
    }
  }, [selectedDocId, selectDoc, refresh, dp])

  const handleDeleteFolder = useCallback(async (id: string) => {
    try {
      await dp.docs.deleteFolder(id)
      refresh()
    } catch (e) {
      toast.error(`Failed to delete folder: ${e}`)
    }
  }, [refresh, dp])

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
            title="New document"
          >
            <Plus className="size-3" />
          </IconButton>
          <IconButton
            onClick={() => setFolderTreeCollapsed(true)}
            size="sm"
            title="Collapse"
          >
            <PanelLeftClose className="size-3" />
          </IconButton>
        </div>
      </div>

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {folders.map((folder) => (
          <div key={folder.id}>
            {/* Folder header */}
            <div className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors">
              <button onClick={() => toggleFolder(folder.id)} className="shrink-0">
                <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', expandedFolders.has(folder.id) && 'rotate-90')} />
              </button>
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-meta truncate">{folder.name}</span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleCreateDoc(folder.id)}
                  className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-2.5" />
                </button>
                <button
                  onClick={() => handleDeleteFolder(folder.id)}
                  className="flex size-4 items-center justify-center rounded text-destructive/30 hover:text-destructive"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            </div>

            {/* Docs in folder */}
            {expandedFolders.has(folder.id) && (
              <div className="ml-4 space-y-0.5">
                {(docsByFolder[folder.id] || []).map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => selectDoc(doc.id)}
                    className={cn(
                      'group/doc flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left cursor-pointer transition-colors',
                      selectedDocId === doc.id
                        ? 'bg-accent/40 text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/10',
                    )}
                  >
                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-meta truncate">{doc.title || 'Untitled'}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                      className="flex size-4 items-center justify-center rounded text-destructive/30 opacity-0 group-hover/doc:opacity-100 hover:text-destructive"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Unfiled docs */}
        {unfiled.length > 0 && (
          <div>
            <div className="flex items-center gap-1 px-1.5 py-1">
              <span className="text-label text-muted-foreground">Unfiled</span>
            </div>
            <div className="space-y-0.5">
              {unfiled.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => selectDoc(doc.id)}
                  className={cn(
                    'group/doc flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left cursor-pointer transition-colors',
                    selectedDocId === doc.id
                      ? 'bg-accent/40 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/10',
                  )}
                >
                  <FileText className="size-3 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-meta truncate">{doc.title || 'Untitled'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                    className="flex size-4 items-center justify-center rounded text-destructive/30 opacity-0 group-hover/doc:opacity-100 hover:text-destructive"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vault notes */}
        {vaultNotes.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setVaultExpanded(!vaultExpanded)}
              className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors"
            >
              <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', vaultExpanded && 'rotate-90')} />
              <Vault className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left text-label text-muted-foreground">Vault</span>
              <span className="text-label text-muted-foreground">{vaultNotes.length}</span>
            </button>

            {vaultExpanded && (
              <div className="ml-4 space-y-0.5">
                {groupVaultNotes(vaultNotes).map(({ folder, notes }) => {
                  const isOpen = folder === '' || expandedVaultFolders.has(folder)
                  return (
                    <div key={folder || '__root__'}>
                      {folder !== '' && (
                        <button
                          onClick={() =>
                            setExpandedVaultFolders((prev) => {
                              const next = new Set(prev)
                              if (next.has(folder)) next.delete(folder)
                              else next.add(folder)
                              return next
                            })
                          }
                          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors"
                        >
                          <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 text-left text-meta truncate">{folder}</span>
                        </button>
                      )}
                      {isOpen && (
                        <div className={cn('space-y-0.5', folder !== '' && 'ml-4')}>
                          {notes.map((note) => (
                            <div
                              key={note.id}
                              onClick={() => selectVaultNote(note.path)}
                              title={note.path}
                              className={cn(
                                'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left cursor-pointer transition-colors',
                                selectedVaultPath === note.path
                                  ? 'bg-accent/40 text-foreground'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/10',
                              )}
                            >
                              <FileText className="size-3 shrink-0 text-muted-foreground" />
                              <span className="flex-1 text-meta truncate">{note.title || note.path}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
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
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') { setNewFolderInput(false); setNewFolderName('') }
              }}
              onBlur={() => { if (!newFolderName.trim()) setNewFolderInput(false) }}
              placeholder="Folder name..."
              className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground border-b border-border/20 py-0.5"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => setNewFolderInput(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-meta text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors"
          >
            <Plus className="size-3" />
            New folder
          </button>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute right-0 top-0 bottom-0 z-10 w-px cursor-col-resize transition-colors bg-border/20',
          dragging ? 'bg-accent-blue/50 w-1' : 'hover:bg-accent-blue/30 hover:w-1',
        )}
      />
    </div>
  )
}

export interface VaultFolderGroup {
  /** Vault-relative folder path; '' is the vault root. */
  folder: string
  notes: VaultNoteSummary[]
}

/** Group vault notes by their immediate parent folder, root first then A–Z. */
export function groupVaultNotes(notes: VaultNoteSummary[]): VaultFolderGroup[] {
  const byFolder = new Map<string, VaultNoteSummary[]>()
  for (const note of notes) {
    const slash = note.path.lastIndexOf('/')
    const folder = slash === -1 ? '' : note.path.slice(0, slash)
    const bucket = byFolder.get(folder)
    if (bucket) bucket.push(note)
    else byFolder.set(folder, [note])
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, notes]) => ({ folder, notes }))
}
