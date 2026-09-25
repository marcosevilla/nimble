import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useDataProvider } from '@/services/provider-context'
import type { ParsedTodayMd } from '@nimble/types'
import { friendlyError, isMissingTodayNote, isVaultNotConfigured, isWebNotImplemented } from '@/lib/errors'
import { toast } from 'sonner'

export function useObsidian() {
  const dp = useDataProvider()
  const [todayData, setTodayData] = useState<ParsedTodayMd | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const setObsidianToday = useAppStore((s) => s.setObsidianToday)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await dp.obsidian.readTodayMd()
      setTodayData(data)
      const summary = [
        ...data.tasks.map((t) => `${t.checked ? '[x]' : '[ ]'} ${t.text}`),
        ...data.habits_core.map((h) => `${h.checked ? '[x]' : '[ ]'} ${h.text}`),
      ].join('\n')
      setObsidianToday(summary)
    } catch (e) {
      // No vault-root today.md, or no vault at all (optional since brief
      // phase 2): show no daily note, not a vault-path toast.
      if (isMissingTodayNote(e) || isVaultNotConfigured(e)) {
        setTodayData(null)
        setObsidianToday(null)
        return
      }
      // Web has no vault to read at all (Mac-only, architecture doc §6) —
      // treat the legacy today.md read as "no daily note" there too, rather
      // than toasting "Something went wrong" on every web Today load.
      if (isWebNotImplemented(e)) {
        setTodayData(null)
        setObsidianToday(null)
        return
      }
      const msg = friendlyError(e)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [dp, setObsidianToday])

  const toggleCheckbox = useCallback(
    async (lineNumber: number) => {
      try {
        const updated = await dp.obsidian.toggleCheckbox('today.md', lineNumber)
        setTodayData(updated)
      } catch (e) {
        const msg = friendlyError(e)
        setError(msg)
        toast.error(msg)
      }
    },
    [dp],
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  return { todayData, error, loading, refresh, toggleCheckbox }
}
