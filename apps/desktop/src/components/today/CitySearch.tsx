import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { BriefLocation, GeoPlace } from '@nimble/types'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Meta } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { placeLabel } from '@/lib/weather'
import { cn } from '@/lib/utils'

/** City search, geocoded in Rust (Open-Meteo). A combobox: ↑/↓ move, ↵
 *  picks, Esc clears the field (or cancels when empty, if `onCancel`).
 *  Keys it handles are preventDefault-ed, so the setup's ↵/Esc stand down. */
export function CitySearch({
  onPick,
  onCancel,
  autoFocus = false,
  label = 'Search for a city',
}: {
  onPick: (loc: BriefLocation) => void
  onCancel?: () => void
  autoFocus?: boolean
  label?: string
}) {
  const dp = useDataProvider()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ q: string; places: GeoPlace[]; failed: boolean } | null>(null)
  const [active, setActive] = useState(0)
  const q = query.trim()

  useEffect(() => {
    if (q.length < 2) return
    let live = true
    const timer = setTimeout(() => {
      dp.weather
        .geocode(q)
        .then((places) => { if (live) { setFound({ q, places, failed: false }); setActive(0) } })
        .catch(() => { if (live) setFound({ q, places: [], failed: true }) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [dp, q])

  const results = q.length >= 2 && found?.q === q ? found : null
  const places = results?.places ?? []
  const pick = (p: GeoPlace) => {
    onPick({ name: placeLabel(p), lat: p.lat, lon: p.lon, tz: p.tz })
    setQuery('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && places.length > 0) { e.preventDefault(); setActive((i) => Math.min(places.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp' && places.length > 0) { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && places[active]) { e.preventDefault(); pick(places[active]) }
    else if (e.key === 'Escape' && (query || onCancel)) { e.preventDefault(); if (query) setQuery(''); else onCancel?.() }
  }

  return (
    <div className="space-y-1">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={places.length > 0}
        aria-controls={places.length > 0 ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={places[active] ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        placeholder="City, e.g. San Francisco"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        className="max-w-md"
      />
      {q.length >= 2 && !results && (
        <div className="max-w-md space-y-1 px-2 py-1">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-36" />
        </div>
      )}
      {results?.failed && <Meta as="p" className="px-2">Couldn't search right now. Try again in a moment.</Meta>}
      {results && !results.failed && places.length === 0 && <Meta as="p" className="px-2">No places found.</Meta>}
      {places.length > 0 && (
        <ul id={listId} role="listbox" data-inline-listbox aria-label="Matching places" className="max-w-md rounded-lg border p-1">
          {places.map((p, i) => (
            <li
              key={`${p.lat},${p.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(p)}
              className={cn('flex min-w-0 cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-body', i === active && 'bg-hover')}
            >
              <span className="truncate">{p.name}</span>
              <Meta className="truncate">{[p.admin1, p.country].filter(Boolean).join(', ')}</Meta>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
