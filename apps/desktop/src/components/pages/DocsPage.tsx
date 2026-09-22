import { useEffect } from 'react'
// Window-to-window event bus, not data access — the web build aliases
// '@tauri-apps/api/event' to a no-op stub (src/platform/), so this stays
// portable. Not part of the DataProvider seam.
// eslint-disable-next-line no-restricted-imports
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { useDocsStore } from '@/stores/docsStore'
import { FolderTree } from '@/components/docs/FolderTree'
import { DocEditor } from '@/components/docs/DocEditor'
import { DOCS_SEARCH_INPUT_ID } from '@/components/docs/DocsSearch'
import { IconButton } from '@/components/shared/IconButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { PanelLeftOpen } from 'lucide-react'

export function DocsPage() {
  const folderTreeCollapsed = useDocsStore((s) => s.folderTreeCollapsed)
  const setFolderTreeCollapsed = useDocsStore((s) => s.setFolderTreeCollapsed)
  const refresh = useDocsStore((s) => s.refresh)
  const createDocument = useDocsStore((s) => s.createDocument)
  const currentDoc = useDocsStore((s) => s.currentDoc)
  const currentVaultNote = useDocsStore((s) => s.currentVaultNote)

  // Load data on mount
  useEffect(() => {
    refresh()
  }, [refresh])

  // The vault watcher re-indexes on disk changes; pull the fresh tree in.
  useEffect(() => {
    const unlisten = listen('vault-changed', () => { refresh() })
    return () => { unlisten.then((fn) => fn()) }
  }, [refresh])

  // Page-scoped keys (registry: Docs). `n` → new document in the selected
  // folder, `/` → the sidebar search. Both are additive and skip inputs,
  // the editor's contenteditable, and every modifier chord (docs P1-1, P2-10).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      const isInput = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (isInput || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        createDocument(useDocsStore.getState().selectedFolderId ?? undefined)
          .catch((err) => toast.error(`Couldn't create the document — ${err}`))
        return
      }
      if (e.key === '/') {
        const input = document.getElementById(DOCS_SEARCH_INPUT_ID) as HTMLInputElement | null
        if (!input) return
        e.preventDefault()
        if (useDocsStore.getState().folderTreeCollapsed) setFolderTreeCollapsed(false)
        input.focus()
        input.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createDocument, setFolderTreeCollapsed])

  return (
    <div className="flex flex-1 h-full overflow-hidden flex-row">
      {/* Folder tree */}
      {folderTreeCollapsed ? (
        <div className="flex flex-col items-center border-r border-border/20 bg-muted/10 py-2 px-1">
          <IconButton
            onClick={() => setFolderTreeCollapsed(false)}
            size="lg"
            title="Expand folder tree"
            aria-label="Expand the folder tree"
          >
            <PanelLeftOpen className="size-4" />
          </IconButton>
        </div>
      ) : (
        <FolderTree />
      )}

      {/* Main column: PageHeader + editor */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <PageHeader
          title="Docs"
          meta={currentVaultNote ? currentVaultNote.title : currentDoc ? currentDoc.title : undefined}
        />
        <DocEditor />
      </div>
    </div>
  )
}
