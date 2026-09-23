export interface CalendarDaySource<E> {
  getCachedEvents(date: string): Promise<E[]>
  fetchEvents(date: string): Promise<E[]>
}

/**
 * Show a day's cached events at once, then revalidate from the feed. The
 * backend serves the cache while it is under 15 minutes old, so this only
 * hits the network when the cache is stale. A cache hit used to end the load,
 * which froze a day at whatever was fetched first.
 */
export async function loadCalendarDay<E>(
  src: CalendarDaySource<E>,
  date: string,
  forceRefresh: boolean,
  show: (events: E[]) => void,
): Promise<void> {
  let shown = false
  if (!forceRefresh) {
    const cached = await src.getCachedEvents(date)
    if (cached.length > 0) {
      show(cached)
      shown = true
    }
  }
  try {
    show(await src.fetchEvents(date))
  } catch (e) {
    if (!shown) throw e
  }
}
