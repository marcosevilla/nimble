# Google Calendar connection setup

Nimble uses a Google **Desktop** OAuth client and the narrow `https://www.googleapis.com/auth/calendar.app.created` scope. Calendar connection is optional and separate from Mac reminders. It creates one dedicated secondary calendar named **Nimble** after consent. Only tasks with both a due date/time, a reminder offset, and the per-task Phone alert switch are published. Existing personal and work calendars are never edited.

1. In Google Cloud Console, create or select a project and enable **Google Calendar API**.
2. Configure the OAuth consent screen. Add the Calendar app-created scope. Choose an appropriate publishing status. In Testing mode, verify refresh-token lifetime before depending on unattended phone alerts; test-user refresh tokens may expire after seven days.
3. Create an OAuth client of type **Desktop app**. Copy its public client ID into Nimble Settings → Google Calendar client ID (`google_calendar_client_id`). No client secret belongs in the app.
4. Choose **Connect Google Calendar** in Nimble. The app opens the system browser, listens only on `127.0.0.1` with an ephemeral port, checks a random state and PKCE challenge, and stores the refresh token in the macOS Keychain for this app profile. The access token stays in memory. If calendar creation cannot be confirmed, Nimble shows a setup-needs-review state and does not retry creation blindly.
5. Opt in one disposable timed task, sync, and verify the event exists only on the new Nimble calendar. Verify the popup on a physical phone and make a two-way time edit before relying on this for a real deadline.

Disconnect revokes the token when possible and removes the local Keychain credential. It leaves the calendar and existing events in Google; the user can remove those manually in Google Calendar. It does not stop local Mac reminders.

Developer builds disable live Google network access and production Keychain use. Use an injected fake transport with a synthetic profile for automated reconciliation tests. A real account and physical-phone acceptance check are activation gates, not part of automated verification.
