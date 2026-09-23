import { useEffect } from 'react'
// Window-to-window event bus, not data access — the web build aliases
// '@tauri-apps/api/event' to a no-op stub (src/platform/), so this stays
// portable. Not part of the DataProvider seam.
// eslint-disable-next-line no-restricted-imports
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { useDocsStore } from '@/stores/docsStore'
import { shouldIgnoreKey } from '@/lib/keyGuard'
import { DocEditor } from '@/components/docs/DocEditor'
import { DOCS_SEARCH_INPUT_ID } from '@/components/docs/DocsSearch'
import { PageHeader } from '@/components/shared/PageHeader'
import { NAV_MIN_WIDTH, useLayoutStore } from '@/stores/layoutStore'

export function DocsPage() {
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
  // folder, `/` → the sidebar search. Both are additive and skip text entry,
  // open popovers/dialogs, nested controls other than a tree row, key
  // repeat and every modifier chord (docs P1-1, P2-10; lib/keyGuard).
  // rowSelector is scoped to FolderTree's own tree (`aria-label="Docs and
  // vault"`) — since Task 4 the nav project tree's rows also carry
  // data-tree-row, so an unscoped selector let `n`/`/` fire from a focused
  // project row too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (shouldIgnoreKey(e.target as HTMLElement, { rowSelector: '[aria-label="Docs and vault"] [data-tree-row]' })) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        createDocument(useDocsStore.getState().selectedFolderId ?? undefined)
          .catch((err) => toast.error(`Couldn't create the document — ${err}`))
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        const focusSearch = () => {
          const input = document.getElementById(DOCS_SEARCH_INPUT_ID) as HTMLInputElement | null
          input?.focus()
          input?.select()
        }
        // The search lives in the nav's Docs tree. A closed tree or an
        // icon-only nav unmounts it: open both, then focus next frame.
        const layout = useLayoutStore.getState()
        if (!layout.navTrees.docs || layout.navWidth <= NAV_MIN_WIDTH) {
          layout.setNavTreeOpen('docs', true)
          layout.setNavCollapsed(false)
          requestAnimationFrame(focusSearch)
        } else {
          focusSearch()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createDocument])

  return (
    <div className="flex flex-1 h-full overflow-hidden flex-row">
      {/* Main column: PageHeader + editor */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <PageHeader
          width="wide"
          title="Docs"
          meta={currentVaultNote ? currentVaultNote.title : currentDoc ? currentDoc.title : undefined}
        />
        <DocEditor />
      </div>
    </div>
  )
}
