import { createContext, useContext } from 'react'
import type { Brief, CalendarEvent, LocalTask, Priority, WeatherView } from '@nimble/types'

/** Today's live data, loaded once by TodayPage and read by every module
 *  Box in `live` and `preview` mode (a .ts file: react-refresh wants
 *  contexts out of component files). */
export interface BriefLive {
  today: string
  events: CalendarEvent[]
  tomorrow: CalendarEvent[]
  calReady: boolean
  calError: string | null
  calendarOffline: boolean
  dueToday: LocalTask[]
  stillOpen: LocalTask[]
  tasksReady: boolean
  ready: boolean
  priorities: { list: Priority[] | null | undefined; generating: boolean; noKey: boolean; error: string | null; regenerate: () => void }
  weather: { view: WeatherView | null; loading: boolean }
  projectMap: Record<string, { name: string; color: string }>
  subtaskMap: Record<string, LocalTask[]>
  removeTask: (id: string) => void
  addSubtask: (parentId: string, content: string) => Promise<void>
  /** Today's stored row once the snapshot is written (notes live on it). */
  brief: Brief | null
}

export const BriefLiveContext = createContext<BriefLive | null>(null)

export function useBriefLive(): BriefLive | null {
  return useContext(BriefLiveContext)
}
