import { createContext, useContext } from 'react'
import type { BriefComposition } from '@/hooks/useBriefComposition'

/**
 * The day's composed brief for the boxes under TodayPage / PastBrief. Boxes
 * read items here instead of through module props, so they don't depend on
 * the registry's prop shape. `null` outside a provider (e.g. the setup
 * preview): boxes fall back to their snapshot rendering.
 */
export const BriefItemsContext = createContext<BriefComposition | null>(null)

export function useBriefItems(): BriefComposition | null {
  return useContext(BriefItemsContext)
}
