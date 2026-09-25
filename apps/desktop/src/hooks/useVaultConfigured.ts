import { useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'

/** Whether an Obsidian vault path is set: null while reading, and false on
 *  the web or when the read fails. The vault is optional since brief phase 2,
 *  so actions that need it hide instead of failing with a raw error. */
export function useVaultConfigured(): boolean | null {
  const dp = useDataProvider()
  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    dp.settings
      .get('obsidian_vault_path')
      .then((v) => { if (live) setConfigured(!!v?.trim()) })
      .catch(() => { if (live) setConfigured(false) })
    return () => { live = false }
  }, [dp])
  return configured
}
