import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useDocsStore } from '@/stores/docsStore'
import { FolderTree } from '@/components/docs/FolderTree'
import { DocEditor } from '@/components/docs/DocEditor'
import { IconButton } from '@/components/shared/IconButton'
import { PageHeader } from '@/components/shared/PageHeader'
import { PanelLeftOpen } from 'lucide-react'

export function DocsPage() {
  const folderTreeCollapsed = useDocsStore((s) => s.folderTreeCollapsed)
  const setFolderTreeCollapsed = useDocsStore((s) => s.setFolderTreeCollapsed)
  const refresh = useDocsStore((s) => s.refresh)
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

  return (
    <div className="flex flex-1 h-full overflow-hidden flex-row">
      {/* Folder tree */}
      {folderTreeCollapsed ? (
        <div className="flex flex-col items-center border-r border-border/20 bg-muted/10 py-2 px-1">
          <IconButton
            onClick={() => setFolderTreeCollapsed(false)}
            size="lg"
            title="Expand folder tree"
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
