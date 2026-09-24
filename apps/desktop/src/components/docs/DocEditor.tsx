import { useState, useCallback, useEffect, useRef } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider, getDataProvider } from '@/services/provider-context'
import { TiptapEditor } from './TiptapEditor'
import { DocNoteEntry } from './DocNoteEntry'
import { VaultNoteEditor } from './VaultNoteEditor'
import { FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { DocNote } from '@nimble/types'
import { PageColumn } from '@/components/shared/PageFrame'
import { EmptyState } from '@/components/shared/EmptyState'
import { SectionTitle } from '@/components/shared/typography'

let cachedFormat: 'html' | 'markdown' | null = null
async function getDocsFormat(): Promise<'html' | 'markdown'> {
  if (cachedFormat) return cachedFormat
  // Module-scope helper — resolve the provider lazily at call time, never at
  // module eval (the provider isn't set until app startup).
  const v = await getDataProvider().settings.get('docs_content_format')
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
  const createDocument = useDocsStore((s) => s.createDocument)

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

  // Positive, actionable empty state (docs audit P2-6): the verb is
  // "open", not "edit" — vault notes in the tree are read-only.
  if (!currentDoc) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <PageColumn>
          <EmptyState
            icon={FileText}
            action={
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  createDocument(useDocsStore.getState().selectedFolderId ?? undefined)
                    .catch((e) => toast.error(`Couldn't create the document — ${e}`))
                }}
              >
                <Plus className="size-3.5" />
                New document
                <kbd aria-hidden="true" className="rounded bg-muted/60 px-1 font-mono text-label text-muted-foreground">N</kbd>
              </Button>
            }
          >
            Nothing open. Pick something from the tree, or start a new document.
          </EmptyState>
        </PageColumn>
      </div>
    )
  }

  const folder = folders.find((f) => f.id === currentDoc.folder_id)

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Page column (960) so the eyebrow and title align with every other
          page; the document itself keeps a 720 reading measure, left-aligned. */}
      <PageColumn className="[&>*]:max-w-measure space-y-4">
        {/* Folder badge */}
        {folder && (
          <p className="text-meta text-muted-foreground">{folder.name}</p>
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
          <SectionTitle
            count={notes.length > 0 ? notes.length : undefined}
            action={
              <button
                onClick={() => setNoteInputVisible(true)}
                className="flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="size-3" />
                Add
              </button>
            }
          >
            Notes
          </SectionTitle>

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
            <button
              type="button"
              onClick={() => setNoteInputVisible(true)}
              className="block w-full rounded-md text-left text-body text-muted-foreground hover:text-foreground transition-colors duration-(--transition-fast)"
            >
              Add a note…
            </button>
          )}
        </div>

        {/* Metadata */}
        <div className="text-label text-muted-foreground space-y-0.5 pt-4">
          <p>Created {new Date(currentDoc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          <p>Updated {new Date(currentDoc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
      </PageColumn>
    </div>
  )
}
