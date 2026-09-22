import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { TiptapEditor } from './TiptapEditor'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'
import { splitFrontmatter } from '@/lib/frontmatter'
import { ExternalLink, Lock } from 'lucide-react'
import { toast } from 'sonner'
import type { VaultNoteSummary } from '@nimble/types'

/**
 * Vault notes are shown here, not edited here.
 *
 * `tiptap-markdown` parses with markdown-it and re-serialises with
 * prosemirror-markdown; neither knows Obsidian's dialect. A round trip turns
 * YAML frontmatter into an `##` heading, escapes `[[wikilinks]]` and
 * `![[embeds]]`, mangles `- [ ]` checkboxes and flattens callouts. The hash
 * guard in `vault::writer` cannot catch that — the read was correct, so the
 * hash matches and the corrupted bytes are written with no conflict.
 *
 * So this component originates no writes: it passes no `onChange` to
 * `TiptapEditor`, which makes the editor `editable: false` with no `onUpdate`
 * handler at all. Creating a *new* note (an unresolved wikilink) is still
 * fine — `vault_create_note` writes a file that does not exist yet, so there
 * is no round trip and nothing to corrupt.
 *
 * Frontmatter is split off before the body reaches the editor and shown as
 * a chip row under the path, so metadata is never the boldest line (P2-2).
 */
export function VaultNoteEditor() {
  const dp = useDataProvider()
  const note = useDocsStore((s) => s.currentVaultNote)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)
  const refresh = useDocsStore((s) => s.refresh)

  const [backlinks, setBacklinks] = useState<VaultNoteSummary[]>([])
  const { fields, body } = useMemo(() => splitFrontmatter(note?.content ?? ''), [note?.content])

  useEffect(() => {
    if (note?.path) {
      dp.vault.backlinks(note.path).then(setBacklinks).catch(() => setBacklinks([]))
    } else {
      setBacklinks([])
    }
  }, [note?.path, dp])

  const openInObsidian = useCallback(async () => {
    if (!note) return
    try {
      await dp.vault.openInObsidian(note.path)
    } catch (e) {
      toast.error(`Couldn't open Obsidian — ${e}`)
    }
  }, [note, dp])

  const handleWikilink = useCallback(async (raw: string) => {
    if (!note) return
    // Strip alias and heading/block fragment: `Note#Section|alias` → `Note`
    const target = raw.split('|')[0].split('#')[0].trim()
    if (!target) return

    try {
      const hit = await dp.vault.resolveLink(target)
      if (hit) {
        selectVaultNote(hit.path)
        return
      }
    } catch {
      // fall through to the create offer
    }

    // Unresolved: offer to create it. A bare name lands beside the current
    // note; a name with slashes is treated as vault-relative.
    const folder = note.path.includes('/')
      ? note.path.slice(0, note.path.lastIndexOf('/'))
      : ''
    const newPath = target.includes('/')
      ? `${target}.md`
      : folder
        ? `${folder}/${target}.md`
        : `${target}.md`

    toast(`No note called "${target}" yet.`, {
      action: {
        label: 'Create it',
        onClick: async () => {
          try {
            const created = await dp.vault.createNote(newPath, `# ${target}\n\n`)
            await refresh()
            selectVaultNote(created.path)
          } catch (e) {
            toast.error(`Couldn't create note — ${e}`)
          }
        },
      },
    })
  }, [note, dp, selectVaultNote, refresh])

  if (!note) return null

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-start justify-between gap-3 px-8 pt-6">
        <div className="min-w-0 space-y-1">
          <Meta as="p" className="truncate" title={note.path}>{note.path}</Meta>
          {/* Read-only cue sits with the path, not in the dimmest corner (P2-1). */}
          <p className="flex items-center gap-1 text-label text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden="true" />
            Read-only · edited in Obsidian
          </p>
          {fields.length > 0 && (
            <ul className="flex flex-wrap gap-1 pt-1" aria-label="Note properties">
              {fields.map((f) => (
                <li
                  key={f.key}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-label"
                >
                  <span className="text-muted-foreground">{f.key}</span>
                  {f.value && <span className="truncate text-foreground">{f.value}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={openInObsidian} className="shrink-0">
          <ExternalLink className="size-3" />
          Open in Obsidian
        </Button>
      </div>

      <div className="px-8 py-4 cursor-default select-text [&_.ProseMirror]:cursor-default" aria-readonly="true">
        <TiptapEditor
          key={note.id}
          content={body}
          format="markdown"
          onWikilinkClick={handleWikilink}
        />
      </div>

      {backlinks.length > 0 && (
        <div className="border-t border-border/20 px-8 py-4">
          <span className="text-label text-muted-foreground">Linked from</span>
          <div className="mt-2 space-y-1">
            {backlinks.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => selectVaultNote(b.path)}
                className="block w-full truncate rounded text-left text-meta text-muted-foreground hover:text-foreground transition-colors duration-(--transition-fast)"
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
