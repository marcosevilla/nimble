import { renderToStaticMarkup } from 'react-dom/server'
import { DataProviderRoot } from '../../src/services/provider-context'
import { GoogleCalendarSection } from '../../src/components/settings/GoogleCalendarSection'
import { ReminderSection } from '../../src/components/settings/ReminderSection'
import type { DataProvider } from '@nimble/types'
const provider = {googleCalendar:{supported:true}, reminders:{supported:true}} as DataProvider
export function renderGoogleSetup() {
  return renderToStaticMarkup(<DataProviderRoot provider={provider}><GoogleCalendarSection /></DataProviderRoot>)
}
export function renderReminderSetup() {
  return renderToStaticMarkup(<DataProviderRoot provider={provider}><ReminderSection /></DataProviderRoot>)
}
