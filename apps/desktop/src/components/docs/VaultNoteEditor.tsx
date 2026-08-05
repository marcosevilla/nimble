import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { TiptapEditor } from './TiptapEditor'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { VaultNoteSummary } from '@daily-triage/types'

/** Debounce for auto-save: long enough that a burst of typing is one write. */
const SAVE_DELAY_MS = 1200

export function VaultNoteEditor() {
  const dp = useDataProvider()
  const note = useDocsStore((s) => s.currentVaultNote)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)
  const refresh = useDocsStore((s) => s.refresh)

  const [backlinks, setBacklinks] = useState<VaultNoteSummary[]>([])
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The hash the app last read; sent with every save so a change made in
  // Obsidian meanwhile can never be silently overwritten.
  const expectedHash = useRef<string | null>(null)
  const lastSaved = useRef<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    expectedHash.current = note?.hash ?? null
    lastSaved.current = note?.content ?? ''
    setConflictPath(null)
    if (note?.path) {
      dp.vault.backlinks(note.path).then(setBacklinks).catch(() => setBacklinks([]))
    } else {
      setBacklinks([])
    }
  }, [note?.path, note?.hash, note?.content, dp])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = useCallback(async (content: string) => {
    if (!note) return
    setSaving(true)
    try {
      const result = await dp.vault.saveNote(note.path, content, expectedHash.current)
      if (result.kind === 'conflict') {
        setConflictPath(result.conflict_path)
        // Re-read so the editor shows what's actually on disk now.
        await selectVaultNote(note.path)
      } else {
        expectedHash.current = result.hash
        lastSaved.current = content
        setConflictPath(null)
      }
    } catch (e) {
      toast.error(`Couldn't save note — ${e}`)
    } finally {
      setSaving(false)
    }
  }, [note, dp, selectVaultNote])

  const handleChange = useCallback((content: string) => {
    if (!note || content === lastSaved.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { save(content) }, SAVE_DELAY_MS)
  }, [note, save])

  const openInObsidian = useCallback(async () => {
    if (!note) return
    try {
      await dp.vault.openInObsidian(note.path)
    } catch (e) {
      toast.error(`Couldn't open Obsidian — ${e}`)
    }
  }, [note, dp])

  if (!note) return null

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-3 px-8 pt-6">
        <Meta as="p" className="truncate" title={note.path}>{note.path}</Meta>
        <div className="flex items-center gap-2">
          {saving && <Meta as="span">Saving…</Meta>}
          <Button variant="secondary" size="sm" onClick={openInObsidian}>
            <ExternalLink className="size-3" />
            Open in Obsidian
          </Button>
        </div>
      </div>

      {conflictPath && (
        <div className="mx-8 mt-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
          <Meta as="p">
            This note changed on disk while you were editing, so your version was saved
            beside it as <span className="text-foreground">{conflictPath}</span>. The editor
            now shows what's on disk.
          </Meta>
          <button
            type="button"
            className="mt-1 text-meta text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => { setConflictPath(null); selectVaultNote(conflictPath); refresh() }}
          >
            Open my version
          </button>
        </div>
      )}

      <div className="px-8 py-4">
        <TiptapEditor
          key={note.id}
          content={note.content}
          onChange={handleChange}
          format="markdown"
          placeholder="Write…"
        />
      </div>

      {backlinks.length > 0 && (
        <div className="border-t border-border/20 px-8 py-4">
          <span className="text-label text-muted-foreground">Linked from</span>
          <div className="mt-2 space-y-1">
            {backlinks.map((b) => (
              <button
                key={b.id}
                onClick={() => selectVaultNote(b.path)}
                className="block w-full truncate text-left text-meta text-muted-foreground hover:text-foreground transition-colors"
              >
                {b.title || b.path}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
