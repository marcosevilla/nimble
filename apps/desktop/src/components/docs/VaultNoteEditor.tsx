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
  // The path most recently displayed by this component — updated only on a
  // real navigation, never on a same-path re-read (see below). Read at save
  // time (via ref, not closure) to tell whether a scheduled save still
  // targets the note the user is currently looking at.
  const loadedPath = useRef<string | null>(null)
  // A debounced save not yet fired, so navigating away can flush it instead
  // of silently dropping it.
  const pending = useRef<{ path: string; content: string; hash: string | null } | null>(null)

  useEffect(() => {
    // Only a real navigation clears the banner. A same-path re-read is exactly
    // what a conflict triggers — clearing here would make the banner vanish the
    // moment the re-read lands, and the user would never learn that their
    // version was diverted to a conflict file.
    if (note?.path !== loadedPath.current) {
      // Leaving a note with an unfired debounced save — flush it now so the
      // edit is written (with the hash it was scheduled against) instead of
      // being discarded by the switch.
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        const p = pending.current
        pending.current = null
        if (p) save(p.path, p.content, p.hash)
      }
      setConflictPath(null)
      loadedPath.current = note?.path ?? null
    }
    expectedHash.current = note?.hash ?? null
    lastSaved.current = note?.content ?? ''
    if (note?.path) {
      dp.vault.backlinks(note.path).then(setBacklinks).catch(() => setBacklinks([]))
    } else {
      setBacklinks([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.path, note?.hash, note?.content, dp])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = useCallback(async (path: string, content: string, hash: string | null) => {
    setSaving(true)
    try {
      const result = await dp.vault.saveNote(path, content, hash)
      // The note being written may no longer be the one on screen — the user
      // can navigate away while a debounced save is in flight. Only touch
      // this component's visible state (banner, expected hash) when the
      // write still belongs to the currently-open note.
      const isCurrent = path === loadedPath.current
      if (result.kind === 'conflict') {
        if (isCurrent) {
          setConflictPath(result.conflict_path)
          // Re-read so the editor shows what's actually on disk now.
          await selectVaultNote(path)
        } else {
          // Abandoned note, but its conflict copy is real — say so neutrally
          // without yanking the user back to a note they've already left.
          toast.message(`"${path}" changed on disk while you were editing it`, {
            description: `Your version was saved as ${result.conflict_path}`,
          })
        }
      } else if (isCurrent) {
        expectedHash.current = result.hash
        lastSaved.current = content
      }
    } catch (e) {
      toast.error(`Couldn't save note — ${e}`)
    } finally {
      setSaving(false)
    }
  }, [dp, selectVaultNote])

  const handleChange = useCallback((content: string) => {
    if (!note || content === lastSaved.current) return
    // Capture what this save targets at schedule time, not at fire time —
    // by the time the timer fires the user may be looking at a different
    // note, and `note`/`expectedHash.current` would then describe that one.
    const scheduledPath = note.path
    const scheduledHash = expectedHash.current
    if (timer.current) clearTimeout(timer.current)
    pending.current = { path: scheduledPath, content, hash: scheduledHash }
    timer.current = setTimeout(() => {
      timer.current = null
      const p = pending.current
      pending.current = null
      if (p) save(p.path, p.content, p.hash)
    }, SAVE_DELAY_MS)
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
