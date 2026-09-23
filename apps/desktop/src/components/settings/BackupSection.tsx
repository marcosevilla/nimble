import { useCallback, useEffect, useRef, useState } from 'react'
import type { BackupStatus } from '@nimble/types'
import { useDataProvider } from '@/services/provider-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta, SectionTitle } from '@/components/shared/typography'

function backupMessage(code: unknown): string {
  const messages: Record<string, string> = {
    backup_busy: 'A backup is already running. Wait for it to finish.',
    backup_disabled: 'Backups are disabled in this profile.',
    backup_tool_unavailable: 'Install Git and the GitHub CLI to connect the online archive. Local backups still work.',
    remote_privacy_unverified: 'Sign in with the GitHub CLI and check access to this repository, then try again.',
    remote_must_be_private: 'Choose a private repository. Nothing was uploaded.',
    remote_identity_changed: 'The connected repository has changed. Check its identity before reconnecting.',
    invalid_repository_name: 'Enter the repository as owner/repository.',
    backup_repository_dirty: 'The backup folder has changes that need review before uploads can continue.',
    backup_branch_must_be_main: 'Use a dedicated backup repository whose branch is main.',
    unrelated_backup_repository: 'The backup folder belongs to another repository or has unexpected files. Your files were kept.',
    unexpected_backup_transport: 'Custom Git connection settings need review before uploads can continue.',
    backup_push_failed: 'The online copy could not upload. Check your connection and repository access. Local backups are separate.',
    backup_process_timeout: 'The online backup connection timed out. It will retry automatically.',
    backup_no_verified_backup: 'No usable latest backup was found. Create a new backup before verifying.',
    backup_test_profile_upload_disabled: 'Online uploads are disabled in this synthetic test profile.',
    backup_lock_replaced: 'The backup folder changed during the job. Cleanup was stopped; try again.',
    restore_activation_required: 'This restored profile isn’t activated yet. Activate it below first.',
    restore_activation_refused: 'Another Nimble process or device owns this profile, so it wasn’t activated. Quit the other copy and try again.',
  }
  return typeof code === 'string' && messages[code] ? messages[code] : 'This backup step could not finish. Previous verified copies are kept. Try again.'
}

function when(value: string | null) {
  if (!value) return 'Not saved yet'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString()
}

export function BackupSection() {
  const dp = useDataProvider()
  return dp.backup.supported ? <DesktopBackupSection /> : null
}

function DesktopBackupSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [verified, setVerified] = useState(false)
  const [repo, setRepo] = useState('')
  const mounted = useRef(false)
  const request = useRef(0)
  const invalidate = useCallback(() => { ++request.current }, [])
  const refresh = useCallback(async () => {
    const id = ++request.current
    try {
      const next = await dp.backup.status()
      if (mounted.current && id === request.current) {
        setStatus(next)
        setLoadError(null)
      }
    } catch {
      if (mounted.current && id === request.current) setLoadError('Backup status is unavailable. Try again.')
    }
  }, [dp])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => { void refresh() }, 15_000)
    return () => { mounted.current = false; invalidate(); clearInterval(timer) }
  }, [refresh, invalidate])

  const act = async (operation: () => Promise<unknown>, verification = false) => {
    setBusy(true)
    setVerified(false)
    setError(null)
    ++request.current
    try {
      await operation()
      if (mounted.current) {
        setVerified(verification)
        await refresh()
      }
    } catch (error) {
      if (mounted.current) setError(backupMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const disabled = busy || !!status?.running || !!status?.disabled_reason
  return (
    <section id="backups" className="space-y-4 border-t border-border pt-6" aria-label="Backups">
      <div className="space-y-1">
        <SectionTitle>Backups</SectionTitle>
        <Meta as="p">Automatic daily copies on this Mac, with a separate private online archive.</Meta>
      </div>
      {(error || loadError) && <p className="text-body text-destructive" role="alert">{error || loadError}</p>}
      {!status && !loadError && <Skeleton className="h-24 w-full" />}
      {!status && loadError && <Button variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button>}
      {status && <>
        {status.disabled_reason && <Meta as="p">{status.disabled_reason}</Meta>}
        {status.restore_activation_required && <div className="space-y-2 rounded-md border border-border p-3" role="region" aria-label="Restored profile">
          <p className="text-body">This profile was restored from a backup. Sync, backups, reminders and focus changes stay paused until you activate it on this Mac.</p>
          <Meta as="p">Only activate once the original Mac no longer uses this data. Nothing starts: paused focus time and deliveries waiting for review stay as they are.</Meta>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => dp.backup.activateRestoredProfile())}>Activate restored profile</Button>
        </div>}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted-foreground">On this Mac</dt><dd>{when(status.last_local_success_at)}</dd>
          <dt className="text-muted-foreground">Private online copy</dt><dd>{status.remote_configured ? when(status.last_push_at) : 'Not connected'}</dd>
          <dt className="text-muted-foreground">Saved copies</dt><dd>{status.retained_count ?? 'Unavailable'}</dd>
          <dt className="text-muted-foreground">Device sync waiting</dt><dd>{status.turso_pending ?? 'Unavailable'}</dd>
          <dt className="text-muted-foreground">Todoist waiting / failed</dt><dd>{status.todoist_pending ?? 'Unavailable'} / {status.todoist_failed ?? 'Unavailable'}</dd>
        </dl>
        <Meta as="p" className="break-all">{status.backup_directory}</Meta>
        {status.export_commit && <Meta as="p">Archive version {status.export_commit.slice(0, 8)}</Meta>}
        {status.error && <p className="text-body text-destructive" role="alert">
          {backupMessage(status.error.code)}
        </p>}
        {(busy || status.running) && <Meta as="p" role="status">Working on your backup…</Meta>}
        {verified && <Meta as="p" role="status">Latest backup restored and verified in a separate test copy.</Meta>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act(() => dp.backup.runNow())}>Back up now</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void act(() => dp.backup.openFolder())}>Open backup folder</Button>
          <Button size="sm" variant="outline" disabled={disabled || !status.last_local_success_at} onClick={() => void act(async () => {
            const result = await dp.backup.verifyLatest()
            if (!result.verified) throw new Error('verification_failed')
          }, true)}>Verify latest backup</Button>
        </div>
        {status.remote_configured ? <Meta as="p">Private repository: {status.remote_name}</Meta> :
          <form className="space-y-2" onSubmit={event => { event.preventDefault(); void act(() => dp.backup.configureRemote(repo.trim())) }}>
            <label htmlFor="backup-repo" className="text-body">Existing private GitHub repository</label>
            <div className="flex gap-2">
              <Input id="backup-repo" value={repo} onChange={event => setRepo(event.target.value)} placeholder="owner/repository" disabled={disabled} autoComplete="off" />
              <Button type="submit" variant="outline" size="sm" disabled={disabled || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim())}>Connect private repository</Button>
            </div>
            <Meta as="p">Local backups work without this. GitHub sign-in through the GitHub CLI is required for the online copy.</Meta>
          </form>}
      </>}
    </section>
  )
}
