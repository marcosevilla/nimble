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

/** The Docs page's `/` key focuses this input by id (docs audit P2-10). */
export const DOCS_SEARCH_INPUT_ID = 'docs-search-input'

export function DocsSearch() {
  const dp = useDataProvider()
  const selectDoc = useDocsStore((s) => s.selectDoc)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocsSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards against an older, slower query overwriting a newer one's results.
  const requestId = useRef(0)
  const listId = `${DOCS_SEARCH_INPUT_ID}-results`

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
    setActiveIdx(0)
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

  const clear = useCallback(() => { setQuery(''); setHits([]); setActiveIdx(0) }, [])

  // Keep the active option in view as arrow keys move it — inside the nav's
  // capped tree region, the highlight can otherwise walk off screen (re-score
  // shell N-P1-1 review, docs search minor 1).
  useEffect(() => {
    if (hits.length === 0) return
    document.getElementById(`${listId}-${activeIdx}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, hits.length, listId])

  const openHit = useCallback((hit: DocsSearchHit) => {
    const id = hit.key.slice(hit.key.indexOf(':') + 1)
    if (hit.backend === 'native') selectDoc(id)
    else selectVaultNote(id)
    clear()
  }, [selectDoc, selectVaultNote, clear])

  // ↑ ↓ Enter walk the hits from inside the input — same contract as the
  // command bar's list (docs audit P1-2).
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); clear(); return }
    if (hits.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % hits.length); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i - 1 + hits.length) % hits.length); return }
    if (e.key === 'Enter') { e.preventDefault(); openHit(hits[activeIdx] ?? hits[0]) }
  }

  const showList = query.trim().length > 0

  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 rounded-md bg-muted/20 px-1.5 py-1 focus-within:bg-muted/40 transition-colors duration-(--transition-fast)">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <input
          id={DOCS_SEARCH_INPUT_ID}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search docs and vault"
          aria-label="Search docs and vault"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && hits[activeIdx] ? `${listId}-${activeIdx}` : undefined}
          aria-autocomplete="list"
          className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button type="button" onClick={clear} aria-label="Clear search" className="shrink-0 rounded text-muted-foreground hover:text-foreground">
            <X className="size-3" />
          </button>
        ) : (
          <kbd aria-hidden="true" className="shrink-0 rounded bg-muted/60 px-1 font-mono text-label text-muted-foreground">/</kbd>
        )}
      </div>

      {showList && (
        <div id={listId} role="listbox" aria-label="Search results" className="mt-1 space-y-0.5">
          {hits.map((hit, i) => {
            const active = i === activeIdx
            return (
              <button
                key={hit.key}
                id={`${listId}-${i}`}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={-1}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => openHit(hit)}
                className={cn(
                  'flex w-full flex-col items-start rounded-md px-1.5 py-1 text-left transition-colors duration-(--transition-fast)',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
                )}
              >
                <span className={cn('w-full truncate', active ? 'text-meta-strong' : 'text-meta')}>{hit.title}</span>
                <span className="w-full truncate text-label text-muted-foreground">{hit.subtitle}</span>
              </button>
            )
          })}
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
