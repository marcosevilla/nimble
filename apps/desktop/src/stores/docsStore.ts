import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
import type { DocFolder, Document, VaultNoteDetail, VaultNoteSummary } from '@nimble/types'

interface DocsStore {
  folders: DocFolder[]
  documents: Document[]
  selectedFolderId: string | null
  selectedDocId: string | null
  currentDoc: Document | null
  folderTreeCollapsed: boolean
  folderTreeWidth: number

  // Vault backend
  vaultNotes: VaultNoteSummary[]
  selectedVaultPath: string | null
  currentVaultNote: VaultNoteDetail | null
  vaultExpanded: boolean

  loadFolders: () => Promise<void>
  loadDocuments: (folderId?: string) => Promise<void>
  loadVaultNotes: () => Promise<void>
  selectFolder: (id: string | null) => void
  selectDoc: (id: string | null) => Promise<void>
  selectVaultNote: (path: string | null) => Promise<void>
  setVaultExpanded: (v: boolean) => void
  setFolderTreeCollapsed: (v: boolean) => void
  setFolderTreeWidth: (w: number) => void
  refresh: () => Promise<void>
}

export const useDocsStore = create<DocsStore>((set, get) => ({
  folders: [],
  documents: [],
  selectedFolderId: null,
  selectedDocId: null,
  currentDoc: null,
  folderTreeCollapsed: false,
  folderTreeWidth: 220,

  vaultNotes: [],
  selectedVaultPath: null,
  currentVaultNote: null,
  vaultExpanded: true,

  loadFolders: async () => {
    try {
      const dp = getDataProvider()
      const folders = await dp.docs.getFolders()
      set({ folders })
    } catch { /* silently fail */ }
  },

  loadDocuments: async (folderId) => {
    try {
      const dp = getDataProvider()
      const documents = await dp.docs.getDocuments(folderId)
      set({ documents })
    } catch { /* silently fail */ }
  },

  loadVaultNotes: async () => {
    try {
      const dp = getDataProvider()
      const vaultNotes = await dp.vault.listNotes()
      set({ vaultNotes })
    } catch {
      // An unconfigured vault is a normal state — the section just stays empty.
      set({ vaultNotes: [] })
    }
  },

  selectFolder: (id) => {
    set({ selectedFolderId: id })
    get().loadDocuments(id ?? undefined)
  },

  // Selecting one backend clears the other — exactly one note is open at a time.
  selectDoc: async (id) => {
    if (!id) {
      set({ selectedDocId: null, currentDoc: null })
      return
    }
    set({ selectedDocId: id, selectedVaultPath: null, currentVaultNote: null })
    try {
      const dp = getDataProvider()
      const doc = await dp.docs.getDocument(id)
      set({ currentDoc: doc })
    } catch {
      set({ currentDoc: null })
    }
  },

  selectVaultNote: async (path) => {
    if (!path) {
      set({ selectedVaultPath: null, currentVaultNote: null })
      return
    }
    set({ selectedVaultPath: path, selectedDocId: null, currentDoc: null })
    try {
      const dp = getDataProvider()
      const note = await dp.vault.getNote(path)
      set({ currentVaultNote: note })
    } catch {
      set({ currentVaultNote: null })
    }
  },

  setVaultExpanded: (v) => set({ vaultExpanded: v }),
  setFolderTreeCollapsed: (v) => set({ folderTreeCollapsed: v }),
  setFolderTreeWidth: (w) => set({ folderTreeWidth: w }),

  refresh: async () => {
    await get().loadFolders()
    await get().loadDocuments(get().selectedFolderId ?? undefined)
    await get().loadVaultNotes()

    const docId = get().selectedDocId
    if (docId) {
      try {
        const dp = getDataProvider()
        const doc = await dp.docs.getDocument(docId)
        set({ currentDoc: doc })
      } catch { /* skip */ }
    }

    const vaultPath = get().selectedVaultPath
    if (vaultPath) {
      try {
        const dp = getDataProvider()
        const note = await dp.vault.getNote(vaultPath)
        set({ currentVaultNote: note })
      } catch { /* skip */ }
    }
  },
}))
