import { useState, useCallback, useEffect, useRef } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { TiptapEditor } from './TiptapEditor'
import { DocNoteEntry } from './DocNoteEntry'
import { VaultNoteEditor } from './VaultNoteEditor'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { DocNote } from '@daily-triage/types'
import { getSetting } from '@/services/tauri'

let cachedFormat: 'html' | 'markdown' | null = null
async function getDocsFormat(): Promise<'html' | 'markdown'> {
  if (cachedFormat) return cachedFormat
  const v = await getSetting('docs_content_format')
  cachedFormat = v === 'markdown' ? 'markdown' : 'html'
  return cachedFormat
}
export function invalidateDocsFormatCache() {
  cachedFormat = null
}

export function DocEditor() {
  const dp = useDataProvider()
  const currentDoc = useDocsStore((s) => s.currentDoc)
  const currentVaultNote = useDocsStore((s) => s.currentVaultNote)
  const folders = useDocsStore((s) => s.folders)
  const refresh = useDocsStore((s) => s.refresh)

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState<DocNote[]>([])
  const [noteInput, setNoteInput] = useState('')
  const [noteInputVisible, setNoteInputVisible] = useState(false)
  const [format, setFormat] = useState<'html' | 'markdown' | null>(null)

  useEffect(() => {
    getDocsFormat().then(setFormat)
  }, [])

  // Sync title when doc changes
  useEffect(() => {
    setTitle(currentDoc?.title ?? '')
  }, [currentDoc?.id, currentDoc?.title])

  // Load notes
  useEffect(() => {
    if (currentDoc?.id) {
      dp.docs.getNotes(currentDoc.id).then(setNotes).catch(() => setNotes([]))
    } else {
      setNotes([])
    }
  }, [currentDoc?.id, dp])

  const handleTitleBlur = useCallback(async () => {
    if (!currentDoc || title.trim() === currentDoc.title) return
    const newTitle = title.trim() || 'Untitled'
    try {
      await dp.docs.updateDocument(currentDoc.id, newTitle)
      refresh()
    } catch (e) {
      toast.error(`Failed to save title: ${e}`)
    }
  }, [currentDoc, title, refresh, dp])

  const lastSavedContent = useRef(currentDoc?.content ?? '')
  const handleContentChange = useCallback(async (html: string) => {
    if (!currentDoc) return
    if (html === lastSavedContent.current) return
    lastSavedContent.current = html
    try {
      await dp.docs.updateDocument(currentDoc.id, undefined, html)
    } catch {
      // Silent — auto-save shouldn't show errors for every keystroke
    }
  }, [currentDoc, dp])

  const handleAddNote = useCallback(async () => {
    if (!currentDoc || !noteInput.trim()) return
    try {
      const note = await dp.docs.createNote(currentDoc.id, noteInput.trim())
      setNotes((prev) => [...prev, note])
      setNoteInput('')
      setNoteInputVisible(false)
    } catch (e) {
      toast.error(`Failed to add note: ${e}`)
    }
  }, [currentDoc, noteInput, dp])

  const handleDeleteNote = useCallback(async (id: string) => {
    try {
      await dp.docs.deleteNote(id)
      setNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (e) {
      toast.error(`Failed to delete note: ${e}`)
    }
  }, [dp])

  // A vault note is selected — file-backed editing takes over the pane.
  if (currentVaultNote) {
    return <VaultNoteEditor />
  }

  if (!currentDoc) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p className="text-body">Select a document to start editing</p>
      </div>
    )
  }

  const folder = folders.find((f) => f.id === currentDoc.folder_id)

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl p-6 space-y-4">
        {/* Folder badge */}
        {folder && (
          <span className="text-meta text-muted-foreground">{folder.name}</span>
        )}

        {/* Title */}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder="Untitled"
          className="w-full bg-transparent text-display outline-none placeholder:text-muted-foreground"
        />

        {/* Editor */}
        {format && (
          <TiptapEditor
            key={format}
            content={currentDoc.content}
            onChange={handleContentChange}
            placeholder="Start writing..."
            format={format}
          />
        )}

        {/* Separator */}
        <div className="border-t border-border/20 pt-4" />

        {/* Notes section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-label text-muted-foreground">
              Notes
            </h3>
            <button
              onClick={() => setNoteInputVisible(true)}
              className="flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="size-3" />
              Add
            </button>
          </div>

          {notes.length > 0 && (
            <div className="space-y-0.5">
              {notes.map((note) => (
                <DocNoteEntry key={note.id} note={note} onDelete={handleDeleteNote} />
              ))}
            </div>
          )}

          {noteInputVisible && (
            <div className="flex items-center gap-2">
              <input
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleAddNote() }
                  if (e.key === 'Escape') { setNoteInputVisible(false); setNoteInput('') }
                }}
                placeholder="Add a note..."
                className="flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground border-b border-border/20 py-1"
                autoFocus
              />
            </div>
          )}

          {!noteInputVisible && notes.length === 0 && (
            <p
              onClick={() => setNoteInputVisible(true)}
              className="text-body text-muted-foreground cursor-text hover:text-muted-foreground transition-colors"
            >
              Add a note...
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="text-label text-muted-foreground space-y-0.5 pt-4">
          <p>Created {new Date(currentDoc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          <p>Updated {new Date(currentDoc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
      </div>
    </div>
  )
}
