import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useDataProvider } from '@/services/provider-context'
import type { CalendarEvent } from '@nimble/types'
import { friendlyErrorOrNull } from '@/lib/errors'
import { loadCalendarDay } from '@/lib/calendarLoad'

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00') // noon to avoid DST issues
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useCalendar() {
  const dp = useDataProvider()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(todayString())
  // The date whose load has settled (events shown, or the load gave up), so
  // callers can tell "loaded this day" from "not loading yet" — just after a
  // date change `loading` is still false from the previous day.
  const [loadedDate, setLoadedDate] = useState<string | null>(null)
  const setCalendarEvents = useAppStore((s) => s.setCalendarEvents)

  const isToday = selectedDate === todayString()

  // Latest requested date, so a slow revalidation can't overwrite a newer day.
  const latestDate = useRef(selectedDate)
  // The date the shown `events` belong to.
  const shownDate = useRef<string | null>(null)

  const loadEventsForDate = useCallback(async (date: string, forceRefresh = false) => {
    latestDate.current = date
    const show = (data: CalendarEvent[]) => {
      if (latestDate.current !== date) return
      setEvents(data)
      shownDate.current = date
      setLoading(false)
      setLoadedDate(date)
      // If this is today, also update the app store
      if (date === todayString()) {
        setCalendarEvents(data)
      }
    }
    try {
      setError(null)
      setLoading(true)
      await loadCalendarDay(dp.calendar, date, forceRefresh, show)
    } catch (e) {
      // Inline "Calendar offline. / Retry" in the panel is the one channel;
      // a toast here fired on every day change (shell P2-6, §3.2).
      if (latestDate.current === date) {
        // Calendar reads aren't implemented on web yet (TursoProvider
        // ni()), so every load would otherwise permanently show "Calendar
        // offline" with a Retry that can never succeed. Show the plain
        // empty state there instead of an error.
        setError(friendlyErrorOrNull(e))
        // Nothing for this day could be shown: don't leave the previous
        // day's events standing under the new date.
        if (shownDate.current !== date) {
          setEvents([])
          shownDate.current = date
        }
      }
    } finally {
      if (latestDate.current === date) {
        setLoading(false)
        setLoadedDate(date)
      }
    }
  }, [dp, setCalendarEvents])

  const setDate = useCallback((date: string) => {
    setSelectedDate(date)
  }, [])

  const goToToday = useCallback(() => {
    setSelectedDate(todayString())
  }, [])

  const goNext = useCallback(() => {
    setSelectedDate((prev) => offsetDate(prev, 1))
  }, [])

  const goPrev = useCallback(() => {
    setSelectedDate((prev) => offsetDate(prev, -1))
  }, [])

  const refresh = useCallback(async () => {
    await loadEventsForDate(selectedDate, true)
  }, [selectedDate, loadEventsForDate])

  // Reload when selected date changes
  useEffect(() => {
    loadEventsForDate(selectedDate)
  }, [selectedDate, loadEventsForDate])

  return {
    events,
    error,
    loading,
    selectedDate,
    loadedDate,
    isToday,
    setDate,
    goToToday,
    goNext,
    goPrev,
    refresh,
  }
}
