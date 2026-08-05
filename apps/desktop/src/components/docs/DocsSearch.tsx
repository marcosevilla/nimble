import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'

interface DocsSearchHit {
  backend: 'native' | 'vault'
  key: string
  title: string
  subtitle: string
}

const DEBOUNCE_MS = 180

export function DocsSearch() {
  const dp = useDataProvider()
  const selectDoc = useDocsStore((s) => s.selectDoc)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocsSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards against an older, slower query overwriting a newer one's results.
  const requestId = useRef(0)

  const run = useCallback(async (q: string) => {
    const id = ++requestId.current
    setSearching(true)
    const [docs, notes] = await Promise.all([
      dp.docs.searchDocuments(q).catch(() => []),
      dp.vault.search(q, 20).catch(() => []),
    ])
    if (id !== requestId.current) return

    setHits([
      ...docs.map((d) => ({
        backend: 'native' as const,
        key: `native:${d.id}`,
        title: d.title || 'Untitled',
        subtitle: 'Doc',
      })),
      ...notes.map((n) => ({
        backend: 'vault' as const,
        key: `vault:${n.path}`,
        title: n.title || n.path,
        subtitle: n.snippet ? n.snippet : n.path,
      })),
    ])
    setSearching(false)
  }, [dp])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (!q) {
      setHits([])
      setSearching(false)
      return
    }
    timer.current = setTimeout(() => { run(q) }, DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query, run])

  const openHit = useCallback((hit: DocsSearchHit) => {
    const id = hit.key.slice(hit.key.indexOf(':') + 1)
    if (hit.backend === 'native') selectDoc(id)
    else selectVaultNote(id)
    setQuery('')
    setHits([])
  }, [selectDoc, selectVaultNote])

  return (
    <div className="border-b border-border/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5 rounded-md bg-muted/20 px-1.5 py-1">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setHits([]) } }}
          placeholder="Search docs and vault"
          className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={() => { setQuery(''); setHits([]) }} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="size-3" />
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="mt-1 space-y-0.5">
          {hits.map((hit) => (
            <button
              key={hit.key}
              onClick={() => openHit(hit)}
              className={cn(
                'flex w-full flex-col items-start rounded-md px-1.5 py-1 text-left transition-colors',
                'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
              )}
            >
              <span className="w-full truncate text-meta">{hit.title}</span>
              <span className="w-full truncate text-label text-muted-foreground">{hit.subtitle}</span>
            </button>
          ))}
          {!searching && hits.length === 0 && (
            <div className="px-1.5 py-1 text-meta text-muted-foreground">
              Nothing matches yet — try fewer words.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
