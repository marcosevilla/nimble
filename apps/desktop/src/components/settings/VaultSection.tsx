import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'
import { toast } from 'sonner'
import type { VaultStatus } from '@nimble/types'

export function VaultSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [scanning, setScanning] = useState(false)

  const refresh = useCallback(() => {
    dp.vault.status().then(setStatus).catch(() => {})
  }, [dp])

  useEffect(() => { refresh() }, [refresh])

  const rescan = useCallback(async () => {
    setScanning(true)
    try {
      const report = await dp.vault.rescan()
      if (report) {
        toast.success(
          `Vault scanned — ${report.indexed} updated, ${report.unchanged} unchanged` +
            (report.skipped > 0 ? `, ${report.skipped} skipped` : ''),
        )
      }
    } catch (e) {
      toast.error(`Couldn't scan the vault — ${e}`)
    } finally {
      setScanning(false)
      refresh()
    }
  }, [dp, refresh])

  if (!status) return null

  if (!status.configured) {
    return <Meta as="p">Set your vault path above to index your notes.</Meta>
  }

  const statusLine = [
    `${status.note_count} note${status.note_count === 1 ? '' : 's'} indexed`,
    status.last_scan_at ? `last scanned ${status.last_scan_at}` : 'not scanned yet',
  ].join(' · ')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Meta as="p">{statusLine}</Meta>
        <Button variant="secondary" size="sm" disabled={scanning} onClick={rescan}>
          {scanning ? 'Scanning…' : 'Rescan vault'}
        </Button>
      </div>

      {status.excludes.length > 0 && (
        <Meta as="p">Skipping {status.excludes.join(', ')}</Meta>
      )}

      {status.last_error && (
        <Meta as="p">
          Last scan didn&apos;t finish ({status.last_error}) — it&apos;ll retry on next launch.
        </Meta>
      )}
    </div>
  )
}
