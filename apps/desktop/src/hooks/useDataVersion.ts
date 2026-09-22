import { useEffect, useState } from 'react'
import { subscribeDataChanges, type DataDomain } from '@/lib/dataChanges'
/** Re-run data reads without remounting editors or discarding drafts. */
export function useDataVersion(domain: DataDomain): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeDataChanges(domain, () => setVersion(v => v + 1)), [domain])
  return version
}
