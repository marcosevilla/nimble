import { useRef, useState } from 'react'
import type { FocusImportPreview, FocusImportResult, LegacyFocusFiles } from '@nimble/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Caption, FieldLabel, Label } from '@/components/shared/typography'
import { formatDurationMs } from '@/lib/focusModel'
import { importBlockedReason, importSummary, legacyFileRole } from '@/lib/focusImport'
import { cn } from '@/lib/utils'
import { FocusRequestError } from '@/services/focus-events'
import { useDataProvider } from '@/services/provider-context'
import { refreshFocus } from '@/stores/focusStore'

type Role = 'state' | 'manual' | 'pending'
type Picked = Partial<Record<Role, { name: string; text: string }>>

const ORIGIN: Record<string, string> = { existing: 'In Nimble', source: 'Old Today/project', manual: 'Old manual list' }

/**
 * Import frozen Focus Queue files. The user picks state.json, manual.json and
 * pending.json explicitly (nothing scans the old app's folder); files are
 * read in the webview and never modified. Preview writes nothing. Import
 * commits exactly the previewed decisions, local-only, with no Todoist
 * calls; every old pending close/comment is kept as quarantined evidence
 * and nothing starts a timer.
 */
export function FocusImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const dp = useDataProvider()
  const [namespace, setNamespace] = useState('focus-queue')
  const [picked, setPicked] = useState<Picked>({})
  const [preview, setPreview] = useState<FocusImportPreview | null>(null)
  const [result, setResult] = useState<FocusImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // One command ID per preview token: an uncertain retry reuses it.
  const commandFor = useRef<{ token: string; id: string } | null>(null)

  const files = (): LegacyFocusFiles => ({
    source_namespace: namespace.trim(),
    state_json: picked.state?.text ?? null,
    manual_json: picked.manual?.text ?? null,
    pending_json: picked.pending?.text ?? null,
  })

  async function pick(list: FileList | null) {
    setError(null)
    setPreview(null)
    setResult(null)
    const next: Picked = { ...picked }
    for (const file of Array.from(list ?? [])) {
      const role = legacyFileRole(file.name)
      if (role === 'config') {
        // Never read: it holds the old app's credentials.
        setError('config.json holds credentials and is never imported. Choose state.json, manual.json and pending.json.')
        continue
      }
      if (!role) {
        setError(`${file.name} isn't a Focus Queue file. Choose state.json, manual.json or pending.json.`)
        continue
      }
      next[role] = { name: file.name, text: await file.text() }
    }
    setPicked(next)
  }

  async function runPreview() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setPreview(await dp.focus.previewImport(files()))
    } catch (e) {
      setPreview(null)
      setError(FocusRequestError.from(e).message)
    } finally {
      setBusy(false)
    }
  }

  async function runCommit() {
    if (!preview) return
    if (commandFor.current?.token !== preview.preview_token) {
      commandFor.current = { token: preview.preview_token, id: crypto.randomUUID() }
    }
    setBusy(true)
    setError(null)
    try {
      setResult(await dp.focus.commitImport(files(), preview.preview_token, commandFor.current.id))
      setPreview(null)
      void refreshFocus()
    } catch (e) {
      const failure = FocusRequestError.from(e)
      if (failure.code === 'conflict') {
        setPreview(null)
        setError('The files or your focus queue changed since this preview. Preview again to review the new state.')
      } else {
        setError(failure.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const blocked = preview ? importBlockedReason(preview) : null
  const summary = preview ? importSummary(preview) : null
  const chosen = (['state', 'manual', 'pending'] as const).filter((r) => picked[r])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Focus Queue</DialogTitle>
          <DialogDescription>
            Pick the old app's state.json, manual.json and pending.json after quitting it. Nothing is changed until you
            import, the files stay untouched, and nothing is sent to Todoist.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <FieldLabel>Source name</FieldLabel>
            <Input value={namespace} onChange={(e) => { setNamespace(e.target.value); setPreview(null) }} />
            <Caption tone="muted">Use the same name for every import from this Mac, so repeats are recognized.</Caption>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Files</FieldLabel>
            <input
              type="file"
              multiple
              accept=".json,application/json"
              onChange={(e) => { void pick(e.target.files); e.target.value = '' }}
              className="text-meta text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1 file:text-foreground"
            />
            <Caption tone="muted">
              {chosen.length ? `Chosen: ${chosen.map((r) => picked[r]!.name).join(', ')}` : 'No files chosen yet.'}
            </Caption>
          </label>
        </div>

        {error && <Caption as="p" role="alert" className="text-destructive">{error}</Caption>}

        {preview && summary && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <Caption as="p">
              {`${summary.create} new local-only task${summary.create === 1 ? '' : 's'} · ${formatDurationMs(summary.includedMs)} imported time`}
              {summary.excludedMs > 0 && ` · ${formatDurationMs(summary.excludedMs)} held back as possible overlap`}
              {` · ${summary.unresolved} unresolved · ${summary.quarantined} quarantined (${summary.pending} old pending sends, never replayed)`}
            </Caption>

            <section className="flex flex-col gap-1">
              <Label as="h3">Queue after import</Label>
              {preview.merged_order.length === 0 ? (
                <Caption tone="muted">No queue entries.</Caption>
              ) : (
                <ol className="flex flex-col gap-0.5">
                  {preview.merged_order.map((item, i) => (
                    <li key={item.task_id} className="flex items-baseline gap-2 text-meta">
                      <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <Caption tone="muted">{ORIGIN[item.origin] ?? item.origin}</Caption>
                    </li>
                  ))}
                </ol>
              )}
              <Caption tone="muted">Imported timers stay paused. Nothing starts.</Caption>
            </section>

            <section className="flex flex-col gap-1">
              <Label as="h3">Time totals</Label>
              {preview.contributions.map((c) => (
                <div key={c.record_key} className="flex items-baseline gap-2 text-meta">
                  <span className="w-16 shrink-0 tabular-nums">{formatDurationMs(c.duration_ms)}</span>
                  <span className="min-w-0 flex-1 truncate" title={c.legacy_task_id}>
                    {c.source_kind === 'completion' ? 'Completed' : 'Timer'} · {c.reason}
                    {c.replaces_ms != null && ` (replaces ${formatDurationMs(c.replaces_ms)})`}
                  </span>
                  <Caption tone="muted" className={cn(c.inclusion !== 'included' && 'text-foreground')}>{c.inclusion}</Caption>
                </div>
              ))}
            </section>

            {preview.issues.length > 0 && (
              <section className="flex flex-col gap-1">
                <Label as="h3">Needs attention</Label>
                {preview.issues.map((issue, i) => (
                  <Caption key={i} as="p" className={cn(issue.severity === 'blocking' ? 'text-destructive' : 'text-muted-foreground')}>
                    {issue.message}
                  </Caption>
                ))}
              </section>
            )}

            <details className="text-meta">
              <summary className="cursor-pointer text-muted-foreground">Provenance ({preview.records.length} records)</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {preview.records.map((r) => (
                  <li key={r.record_key}>
                    <span className="font-mono">{r.record_key}</span>
                    <Caption tone="muted">{` · ${r.status} · ${r.change} · ${r.reason}`}</Caption>
                    <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-muted/40 p-1 font-mono text-label">
                      {JSON.stringify(r.raw_evidence, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            </details>

            {blocked && <Caption as="p" role="status" className="text-destructive">{blocked}</Caption>}
          </div>
        )}

        {result && (
          <Caption as="p" role="status">
            {result.noop
              ? 'Nothing new to import.'
              : `Imported ${result.created_task_ids.length} task${result.created_task_ids.length === 1 ? '' : 's'} and ${formatDurationMs(result.included_ms)} of time. ${result.quarantined_records} records kept as quarantined evidence.`}
          </Caption>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="outline" size="sm" disabled={busy || chosen.length === 0 || !namespace.trim()} onClick={() => void runPreview()}>
            Preview
          </Button>
          <Button size="sm" disabled={busy || !preview || blocked != null} onClick={() => void runCommit()} title={blocked ?? undefined}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
