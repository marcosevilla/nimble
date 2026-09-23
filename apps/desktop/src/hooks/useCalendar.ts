import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useDataProvider } from '@/services/provider-context'
import type { CalendarEvent } from '@nimble/types'
import { friendlyError } from '@/lib/errors'
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
  const setCalendarEvents = useAppStore((s) => s.setCalendarEvents)

  const isToday = selectedDate === todayString()

  // Latest requested date, so a slow revalidation can't overwrite a newer day.
  const latestDate = useRef(selectedDate)

  const loadEventsForDate = useCallback(async (date: string, forceRefresh = false) => {
    latestDate.current = date
    const show = (data: CalendarEvent[]) => {
      if (latestDate.current !== date) return
      setEvents(data)
      setLoading(false)
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
      if (latestDate.current === date) setError(friendlyError(e))
    } finally {
      if (latestDate.current === date) setLoading(false)
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
    isToday,
    setDate,
    goToToday,
    goNext,
    goPrev,
    refresh,
  }
}
