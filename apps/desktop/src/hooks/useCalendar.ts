import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { useDataProvider } from '@/services/provider-context'
import type { CalendarEvent } from '@nimble/types'
import { friendlyError } from '@/lib/errors'
import { toast } from 'sonner'

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

  const loadEventsForDate = useCallback(async (date: string, forceRefresh = false) => {
    try {
      setError(null)
      setLoading(true)

      let data: CalendarEvent[]

      if (!forceRefresh) {
        // Try cache first for fast navigation
        data = await dp.calendar.getCachedEvents(date)
        if (data.length > 0) {
          setEvents(data)
          setLoading(false)
          // If this is today, also update the app store
          if (date === todayString()) {
            setCalendarEvents(data)
          }
          return
        }
      }

      // Fall back to network fetch (which caches a 7-day window)
      data = await dp.calendar.fetchEvents(date)
      setEvents(data)
      if (date === todayString()) {
        setCalendarEvents(data)
      }
    } catch (e) {
      const msg = friendlyError(e)
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
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
