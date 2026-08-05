import { useCallback, useState } from 'react'
import { getDataProvider } from '@/services/provider-context'
import { invalidateDocsFormatCache } from '@/components/docs/DocEditor'
import type { DocsMdPreview, DocsMdResult } from '@daily-triage/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta } from '@/components/shared/typography'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'

export function DocsMigrationSection() {
  const dp = getDataProvider()
  const [preview, setPreview] = useState<DocsMdPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [result, setResult] = useState<DocsMdResult | null>(null)

  const runPreview = useCallback(async () => {
    setPreviewing(true)
    setPreviewError(null)
    try {
      const p = await dp.docs.previewMarkdownMigration()
      setPreview(p)
    } catch (e) {
      setPreviewError(String(e))
      setPreview(null)
    } finally {
      setPreviewing(false)
    }
  }, [dp])

  const runMigrate = useCallback(async () => {
    setMigrating(true)
    try {
      const r = await dp.docs.migrateToMarkdown()
      setResult(r)
      invalidateDocsFormatCache()
      toast.success(`Converted ${r.converted} doc${r.converted !== 1 ? 's' : ''} to markdown`)
    } catch (e) {
      toast.error(`Migration failed: ${e}`)
    } finally {
      setMigrating(false)
    }
  }, [dp])

  return (
    <div className="space-y-5">
      {/* Preview */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runPreview} disabled={previewing}>
            {previewing ? 'Checking…' : preview ? 'Refresh preview' : 'Preview migration'}
          </Button>
          {preview && <Meta>Read-only — nothing is converted yet.</Meta>}
        </div>

        {previewError && (
          <p className="text-meta text-destructive">{previewError}</p>
        )}

        {previewing && !preview && (
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-56" />
          </div>
        )}

        {preview && (
          <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-label text-muted-foreground">
              <span>{preview.total} doc{preview.total !== 1 ? 's' : ''} total</span>
              <span>{preview.convertible} convertible</span>
              <span>{preview.already_plain} already plain</span>
            </div>
            {preview.flagged.length > 0 && (
              <details className="pt-1">
                <summary className="text-label text-muted-foreground cursor-pointer hover:text-muted-foreground">
                  {preview.flagged.length} doc{preview.flagged.length !== 1 ? 's' : ''} with unrecognized formatting
                </summary>
                <ul className="mt-2 space-y-1 text-label text-muted-foreground max-h-40 overflow-y-auto">
                  {preview.flagged.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2">
                      <FileText className="size-3 shrink-0" />
                      <span className="truncate">{doc.title || 'Untitled'}</span>
                      <span className="text-muted-foreground/70">
                        ({doc.unknown_tags.join(', ')})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Run */}
      <div className="flex items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button disabled={migrating || !preview}>
                {migrating ? 'Converting…' : 'Migrate to markdown'}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Convert docs to markdown?</AlertDialogTitle>
              <AlertDialogDescription>
                {preview
                  ? `This will convert ${preview.convertible} doc${preview.convertible !== 1 ? 's' : ''} from HTML to markdown. A backup of the database is saved first.`
                  : 'Run a preview first to see what will change.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={runMigrate}>
                Migrate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {!preview && <Meta>Run a preview first.</Meta>}
      </div>

      {/* Last result */}
      {result && (
        <div className="rounded-lg border border-border/30 bg-muted/10 p-3 space-y-1 text-meta">
          <p className="text-body-strong text-foreground">
            Converted {result.converted} doc{result.converted !== 1 ? 's' : ''}. Backup saved to {result.backup_path}.
          </p>
          <p className="text-muted-foreground">
            Reopen any doc you have open to pick up the new format.
          </p>
        </div>
      )}
    </div>
  )
}
